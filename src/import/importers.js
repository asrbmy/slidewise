import { parsePptx } from './pptxImport.js';
import { parseDeckJson } from '../model/validate.js';
import { createDeck, createSlide, createImage } from '../model/factory.js';
import { assetFromFile } from '../model/imageImport.js';
import { LIMITS } from '../model/constants.js';
import { uid } from '../model/ids.js';
import * as ops from '../model/ops.js';

const kindOf = (f) => (/\.pptx$/i.test(f.name) ? 'pptx' : /\.json$/i.test(f.name) ? 'json' : /^image\//.test(f.type) || /\.(png|jpe?g|gif|webp)$/i.test(f.name) ? 'image' : null);
function checkFile(f) { if (f.size > LIMITS.maxImportFileBytes) throw new Error(`“${f.name}” is larger than ${Math.round(LIMITS.maxImportFileBytes / 1048576)} MB.`); }

export async function deckFromImage(size, file) {
  const { id, asset } = await assetFromFile(file);
  const k = Math.min(size.w * 0.9 / asset.w, size.h * 0.9 / asset.h);
  const w = Math.round(asset.w * k), h = Math.round(asset.h * k);
  const slide = createSlide(size, 'blank');
  slide.objects.push(createImage(id, w, h, { x: Math.round((size.w - w) / 2), y: Math.round((size.h - h) / 2), name: asset.name.slice(0, 100) }));
  return { id, asset, slide };
}

export async function importAsNewDeck(files) {
  files = files.slice(0, 50); files.forEach(checkFile);
  const first = files[0]; const kind = kindOf(first);
  if (kind === 'pptx') { const { deck, warnings } = await parsePptx(await first.arrayBuffer()); deck.warnings = warnings; delete deck.warnings; return { ...deck, id: uid('d') , name: deck.name }; }
  if (kind === 'json') {
    const text = await first.text(); let raw; try { raw = JSON.parse(text); } catch { throw new Error('Not valid JSON.'); }
    if (raw && raw.format === 'slidewise-backup') throw new Error('This is a full backup. Use “Restore from backup…” instead.');
    const d = parseDeckJson(text); return { ...d, id: uid('d'), name: d.name };
  }
  if (kind === 'image') {
    const deck = createDeck({ name: 'Imported images', slides: [createSlide({ w: 1280, h: 720 }, 'blank')] });
    let d = deck; const slides = [];
    for (const f of files.filter((x) => kindOf(x) === 'image')) { const r = await deckFromImage(deck.size, f); d = ops.addAsset(d, r.id, r.asset); slides.push(r.slide); }
    return { ...d, slides };
  }
  throw new Error('Unsupported file type. Use .pptx, .json (Slidewise) or PNG/JPEG/GIF/WebP images.');
}

// Insert files into an open deck: images become slides after the current one; PPTX/JSON slides are appended.
export async function importIntoDeck(deck, files, api) {
  files = files.slice(0, 50); files.forEach(checkFile);
  let next = deck; let added = 0; const msgs = [];
  const insertAfter = deck.slides.length - 1;
  let at = insertAfter;
  for (const f of files) {
    const kind = kindOf(f);
    if (kind === 'image') { const r = await deckFromImage(next.size, f); next = ops.addAsset(next, r.id, r.asset); const s = r.slide; next = { ...next, slides: [...next.slides.slice(0, at + 1), s, ...next.slides.slice(at + 1)] }; at++; added++; }
    else if (kind === 'pptx' || kind === 'json') {
      let d; if (kind === 'pptx') { const r = await parsePptx(await f.arrayBuffer()); d = r.deck; if (r.warnings.length) msgs.push(r.warnings.join(' ')); } else d = parseDeckJson(await f.text());
      if (d.size.w !== next.size.w || d.size.h !== next.size.h) d = ops.resizeDeck(d, next.size, true);
      const room = LIMITS.maxSlides - next.slides.length; const slides = d.slides.slice(0, room).map(ops.cloneSlide);
      let assets = { ...next.assets, ...d.assets };
      next = { ...next, assets, slides: [...next.slides.slice(0, at + 1), ...slides, ...next.slides.slice(at + 1)] }; at += slides.length; added += slides.length;
    } else throw new Error(`“${f.name}” is not a supported file (use .pptx, .json or PNG/JPEG/GIF/WebP).`);
  }
  next = { ...next, updatedAt: Date.now() };
  api.replaceDeck(next);
  return { message: `Imported ${added} slide${added === 1 ? '' : 's'}.${msgs.length ? ' ' + msgs.join(' ') : ''}` };
}
