import { renderSlideToCanvas, measurer } from '../render/canvasRender.js';
import { preloadImages } from '../render/images.js';
import { layoutText } from '../render/textLayout.js';
import { downloadBlob, safeName } from './download.js';
import { b64decode } from '../crypto/lock.js';

const canvasToBlob = (c, type = 'image/png', q) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode image'))), type, q));
const exportSlides = (deck) => { const vis = deck.slides.filter((s) => !s.hidden); return vis.length ? vis : deck.slides; };
const dataUrlBytes = (url) => b64decode(url.slice(url.indexOf(',') + 1));

export async function exportPngBlob(deck, slide, width = 1920) { await preloadImages(deck); return canvasToBlob(renderSlideToCanvas(deck, slide, width)); }

// Selectable/searchable text: the page image already shows everything, so we overlay each text line as
// *invisible* text (PDF render mode 3) at the laid-out position. Limits: top-level, un-rotated text only
// (not text inside groups, tables or charts); jsPDF's built-in font covers Latin-1 characters only.
export function textLinesOf(deck, slide, measure) {
  const out = [];
  for (const o of slide.objects) {
    if (!o.tx || o.type === 'group' || (o.rot || 0) % 360 !== 0 || o.shape === 'line') continue;
    const empty = o.tx.paras.every((p) => p.runs.every((r) => !r.t));
    if (empty) continue;
    const res = layoutText(o.tx, o.w, o.h, deck.theme, measure);
    for (const ln of res.lines) {
      const text = ln.items.map((it) => it.text).join('').replace(/\s+$/, '');
      if (!text.trim() || !ln.items.length) continue;
      const base = res.offsetY + ln.y + (ln.lh - ln.size) / 2 + ln.size * 0.82;
      out.push({ text: (ln.marker ? ln.marker.text + ' ' : '') + text, x: o.x + ln.items[0].x, y: o.y + base, size: ln.size });
    }
  }
  return out;
}
function addInvisibleText(pdf, deck, slide) {
  try {
    pdf.setFont('helvetica', 'normal');
    for (const l of textLinesOf(deck, slide, measurer())) {
      pdf.setFontSize(l.size * 0.75);
      pdf.text(l.text.replace(/[^\x20-\xff]/g, '?'), l.x, l.y, { renderingMode: 'invisible' });
    }
  } catch { /* text layer is best-effort; the visual page is already complete */ }
}

async function pdfBlob(deck, progress) {
  const { jsPDF } = await import('jspdf');
  const slides = exportSlides(deck);
  const W = deck.size.w, H = deck.size.h;
  const pdf = new jsPDF({ orientation: W >= H ? 'landscape' : 'portrait', unit: 'px', format: [W, H], compress: true, hotfixes: ['px_scaling'] });
  pdf.setProperties({ title: deck.name, creator: 'Slidewise' });
  for (let i = 0; i < slides.length; i++) {
    progress(`Rendering page ${i + 1} of ${slides.length}…`);
    const c = renderSlideToCanvas(deck, slides[i], Math.min(2000, Math.max(1280, W)));
    if (i > 0) pdf.addPage([W, H], W >= H ? 'landscape' : 'portrait');
    pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, W, H, undefined, 'FAST');
    addInvisibleText(pdf, deck, slides[i]);
    await new Promise((r) => setTimeout(r, 0));
  }
  return pdf.output('blob');
}
async function pngZipBlob(deck, progress) {
  const { default: JSZip } = await import('jszip'); const zip = new JSZip(); const slides = deck.slides;
  for (let i = 0; i < slides.length; i++) { progress(`Rendering slide ${i + 1} of ${slides.length}…`); zip.file(`slide-${String(i + 1).padStart(3, '0')}.png`, await exportPngBlob(deck, slides[i])); }
  return zip.generateAsync({ type: 'blob' });
}
async function pptxBlob(deck, progress) {
  const { buildPptx } = await import('./pptxBuilder.js');
  const measure = measurer();
  const providers = {
    textScale: (o) => (o.tx.autofit ? layoutText(o.tx, o.w, o.h, deck.theme, measure).scale : 1),
    chartPng: async (o) => dataUrlBytes(renderSlideToCanvasObject(deck, o).toDataURL('image/png')),
    imageBytes: async (o) => {
      const a = deck.assets[o.assetId]; const adj = o.adjust || {};
      const dirty = (adj.brightness ?? 100) !== 100 || (adj.contrast ?? 100) !== 100 || (adj.saturation ?? 100) !== 100 || adj.grayscale;
      if (!dirty) return { bytes: dataUrlBytes(a.data), ext: a.mime === 'image/jpeg' ? 'jpeg' : a.mime.split('/')[1] };
      const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = a.data; });
      const c = document.createElement('canvas'); const cr = o.crop || { x: 0, y: 0, w: 1, h: 1 };
      c.width = Math.max(1, Math.round(img.naturalWidth * cr.w)); c.height = Math.max(1, Math.round(img.naturalHeight * cr.h));
      const ctx = c.getContext('2d'); const f = []; if (adj.brightness !== 100) f.push(`brightness(${adj.brightness}%)`); if (adj.contrast !== 100) f.push(`contrast(${adj.contrast}%)`); if (adj.saturation !== 100) f.push(`saturate(${adj.saturation}%)`); if (adj.grayscale) f.push(`grayscale(${adj.grayscale}%)`);
      ctx.filter = f.join(' ') || 'none'; ctx.drawImage(img, cr.x * img.naturalWidth, cr.y * img.naturalHeight, cr.w * img.naturalWidth, cr.h * img.naturalHeight, 0, 0, c.width, c.height);
      return { bytes: dataUrlBytes(c.toDataURL('image/png')), ext: 'png', baked: true };
    },
  };
  await preloadImages(deck);
  const bytes = await buildPptx(deck, providers, progress);
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
}
// Render a single object (used for charts) to a transparent PNG at 2x.
function renderSlideToCanvasObject(deck, o) {
  const k = 2; const c = document.createElement('canvas'); c.width = Math.ceil(o.w * k); c.height = Math.ceil(o.h * k);
  const ctx = c.getContext('2d'); ctx.scale(k, k);
  const { drawObject } = renderModule;
  drawObject(ctx, { ...o, x: 0, y: 0, rot: 0 }, { deck, theme: deck.theme, measure: measurer(), prompts: false });
  return c;
}
import * as renderModule from '../render/canvasRender.js';

async function htmlBlob(deck, progress) {
  const { buildHtmlSlideshow } = await import('./htmlExport.js');
  await preloadImages(deck); const slides = exportSlides(deck); const pngs = [];
  for (let i = 0; i < slides.length; i++) { progress(`Rendering slide ${i + 1} of ${slides.length}…`); pngs.push(renderSlideToCanvas(deck, slides[i], Math.min(1920, Math.max(1280, deck.size.w))).toDataURL('image/png')); await new Promise((r) => setTimeout(r, 0)); }
  return new Blob([await buildHtmlSlideshow(deck, slides, pngs)], { type: 'text/html' });
}

export async function exportDeck(kind, deck, progress = () => {}) {
  const base = safeName(deck.name);
  await preloadImages(deck);
  if (kind === 'pdf') return downloadBlob(await pdfBlob(deck, progress), base + '.pdf');
  if (kind === 'png-zip') return downloadBlob(await pngZipBlob(deck, progress), base + '-slides.zip');
  if (kind === 'png') { const i = Math.max(0, deck.slides.findIndex((s) => s.id === (deck.__current || deck.slides[0].id))); return downloadBlob(await exportPngBlob(deck, deck.slides[i]), `${base}-slide-${i + 1}.png`); }
  if (kind === 'pptx') return downloadBlob(await pptxBlob(deck, progress), base + '.pptx');
  if (kind === 'html') return downloadBlob(await htmlBlob(deck, progress), base + '.html');
  if (kind === 'json') return downloadBlob(new Blob([JSON.stringify((({ __current, ...d }) => d)(deck))], { type: 'application/json' }), base + '.slidewise.json');
  throw new Error('Unknown export type: ' + kind);
}
