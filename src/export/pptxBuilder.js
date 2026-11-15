import { mergeMap } from '../model/tableMerge.js';
// Builds a PPTX (OOXML) package from a deck. Pure apart from the injected providers, so it can be unit tested without a canvas.
// providers: { imageBytes(o) -> Promise<{bytes, ext}>, chartPng(o) -> Promise<Uint8Array>, textScale(o) -> number }
import JSZip from 'jszip';
import { resolveColor, fontKey } from '../render/theme.js';
import { FONTS } from '../model/constants.js';
import { parasToPlain } from '../model/text.js';

export const EMU = 9525; // 1 CSS px at 96 dpi
const e = (px) => Math.round(px * EMU);
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const HDR = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
// eslint-disable-next-line no-control-regex
const BAD = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;
export const esc = (s) => String(s ?? '').replace(BAD, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const FACE = { sans: 'Arial', serif: 'Georgia', mono: 'Courier New', arial: 'Arial', times: 'Times New Roman', verdana: 'Verdana', trebuchet: 'Trebuchet MS', courier: 'Courier New', impact: 'Impact', rounded: 'Arial' };
export const faceFor = (theme, v) => FACE[fontKey(theme, v)] || 'Arial';

export function hexOf(theme, v, fb = '000000') {
  const c = resolveColor(theme, v, '#' + fb);
  if (c === 'transparent') return null;
  let m = /^#([0-9a-f]{6})$/i.exec(c); if (m) return { hex: m[1].toUpperCase(), alpha: 1 };
  m = /^#([0-9a-f]{3})$/i.exec(c); if (m) return { hex: m[1].split('').map((x) => x + x).join('').toUpperCase(), alpha: 1 };
  m = /^#([0-9a-f]{6})([0-9a-f]{2})$/i.exec(c); if (m) return { hex: m[1].toUpperCase(), alpha: parseInt(m[2], 16) / 255 };
  m = /^#([0-9a-f]{4})$/i.exec(c); if (m) { const x = m[1].split('').map((y) => y + y).join(''); return { hex: x.slice(0, 6).toUpperCase(), alpha: parseInt(x.slice(6), 16) / 255 }; }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\)$/i.exec(c);
  if (m) return { hex: [m[1], m[2], m[3]].map((n) => Math.min(255, +n).toString(16).padStart(2, '0')).join('').toUpperCase(), alpha: m[4] === undefined ? 1 : parseFloat(m[4]) };
  return { hex: fb, alpha: 1 };
}
const solid = (theme, v, opacity = 1, fb) => { const c = hexOf(theme, v, fb); if (!c) return '<a:noFill/>'; const a = c.alpha * opacity; return `<a:solidFill><a:srgbClr val="${c.hex}">${a < 0.999 ? `<a:alpha val="${Math.round(a * 100000)}"/>` : ''}</a:srgbClr></a:solidFill>`; };
const lineXml = (theme, st) => {
  if (!st || !st.width) return '<a:ln><a:noFill/></a:ln>';
  const dash = st.dash === 'dashed' ? 'dash' : st.dash === 'dotted' ? 'sysDot' : 'solid';
  return `<a:ln w="${e(st.width)}">${solid(theme, st.color, 1)}<a:prstDash val="${dash}"/></a:ln>`;
};
const shadowXml = (theme, sh) => {
  if (!sh || !sh.on) return '';
  const c = hexOf(theme, sh.color, '000000') || { hex: '000000', alpha: 0.4 };
  const dist = Math.hypot(sh.x, sh.y); const dir = Math.round(((Math.atan2(sh.y, sh.x) * 180) / Math.PI + 360) % 360 * 60000);
  return `<a:effectLst><a:outerShdw blurRad="${e(sh.blur)}" dist="${e(dist)}" dir="${dir}" algn="ctr" rotWithShape="0"><a:srgbClr val="${c.hex}"><a:alpha val="${Math.round(Math.max(0.05, c.alpha) * 100000)}"/></a:srgbClr></a:outerShdw></a:effectLst>`;
};
const xfrm = (o, tag = 'a:xfrm') => `<${tag}${o.rot ? ` rot="${Math.round((((o.rot % 360) + 360) % 360) * 60000)}"` : ''}><a:off x="${e(o.x)}" y="${e(o.y)}"/><a:ext cx="${Math.max(0, e(o.w))}" cy="${Math.max(0, e(o.h))}"/></${tag}>`;

// ---- text ----
function runsXml(theme, tx, para, scale, rels) {
  let out = '';
  for (const r of para.runs) {
    if (!r.t) continue;
    const sz = Math.max(100, Math.round((r.size || tx.size) * scale * 75));
    const attrs = `lang="en-US" sz="${sz}"${r.b ? ' b="1"' : ''}${r.i ? ' i="1"' : ''}${r.u ? ' u="sng"' : ''}${r.s ? ' strike="sngStrike"' : ''} dirty="0"`;
    let inner = solid(theme, r.color || tx.color, 1, '000000');
    if (r.hl) { const h = hexOf(theme, r.hl); if (h) inner += `<a:highlight><a:srgbClr val="${h.hex}"/></a:highlight>`; }
    inner += `<a:latin typeface="${esc(faceFor(theme, r.font || tx.font))}"/>`;
    if (r.link) inner += `<a:hlinkClick r:id="${rels.link(r.link)}"/>`;
    out += `<a:r><a:rPr ${attrs}>${inner}</a:rPr><a:t>${esc(r.t)}</a:t></a:r>`;
  }
  return out;
}
export function txBodyXml(theme, tx, scale, rels, { anchorOverride, cellPad } = {}) {
  const pad = cellPad ?? tx.padding;
  const anchor = { top: 't', middle: 'ctr', bottom: 'b' }[anchorOverride || tx.valign] || 't';
  const body = `<a:bodyPr wrap="square" lIns="${e(pad)}" tIns="${e(pad)}" rIns="${e(pad)}" bIns="${e(pad)}" anchor="${anchor}" rtlCol="0">${tx.autofit ? '<a:normAutofit/>' : '<a:noAutofit/>'}</a:bodyPr>`;
  const paras = tx.paras.map((p) => {
    const size = (p.runs[0] && p.runs[0].size || tx.size) * scale;
    const align = { left: 'l', center: 'ctr', right: 'r', justify: 'just' }[p.align || tx.align] || 'l';
    const lvl = p.indent || 0; const list = p.list && p.list !== 'none';
    const mar = (lvl * 1.6 + (list ? 1.2 : 0)) * size;
    let ppr = `<a:pPr algn="${align}" marL="${e(mar)}" indent="${list ? -e(size * 1.2) : 0}"><a:lnSpc><a:spcPct val="${Math.round(tx.lineSpacing * 100000 / 1.2)}"/></a:lnSpc><a:spcBef><a:spcPts val="0"/></a:spcBef>`;
    ppr += list ? (p.list === 'number' ? '<a:buFont typeface="+mj-lt"/><a:buAutoNum type="arabicPeriod"/>' : '<a:buFont typeface="Arial"/><a:buChar char="&#8226;"/>') : '<a:buNone/>';
    ppr += '</a:pPr>';
    const runs = runsXml(theme, tx, p, scale, rels);
    return `<a:p>${ppr}${runs}<a:endParaRPr lang="en-US" sz="${Math.max(100, Math.round(size * 75))}" dirty="0"/></a:p>`;
  }).join('');
  return `<p:txBody>${body}<a:lstStyle/>${paras}</p:txBody>`;
}

const PRST = { rect: 'rect', roundRect: 'roundRect', ellipse: 'ellipse', triangle: 'triangle', arrow: 'rightArrow', line: 'line', star: 'star5' };

class Rels {
  constructor() { this.items = []; this.map = new Map(); this.n = 0; }
  add(type, target, external) { const id = 'rId' + (++this.n); this.items.push({ id, type, target, external }); return id; }
  link(url) { if (!this.map.has(url)) this.map.set(url, this.add('http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink', url, true)); return this.map.get(url); }
  xml() { return HDR + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${this.items.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`; }
}
const RT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';

export async function buildPptx(deck, providers, onProgress = () => {}) {
  const theme = deck.theme; const zip = new JSZip();
  const media = new Map(); // key -> { name, ext }
  let mediaN = 0, warnings = [];
  const addMedia = (key, bytes, ext) => { if (!media.has(key)) { const name = `image${++mediaN}.${ext}`; zip.file('ppt/media/' + name, bytes); media.set(key, { name, ext }); } return media.get(key); };
  const slides = deck.slides; const types = new Set();
  let ids = 1;
  const nid = () => ++ids;

  const objXml = async (o, rels, depth = 0) => {
    const nm = esc(o.name || o.type), descr = o.alt ? ` descr="${esc(o.alt)}"` : '';
    if (o.type === 'group') {
      const kids = []; for (const c of o.children) kids.push(await objXml(c, rels, depth + 1));
      return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${nid()}" name="${nm}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm${o.rot ? ` rot="${Math.round((((o.rot % 360) + 360) % 360) * 60000)}"` : ''}><a:off x="${e(o.x)}" y="${e(o.y)}"/><a:ext cx="${e(o.w)}" cy="${e(o.h)}"/><a:chOff x="0" y="0"/><a:chExt cx="${e(o.w)}" cy="${e(o.h)}"/></a:xfrm></p:grpSpPr>${kids.join('')}</p:grpSp>`;
    }
    if (o.type === 'image' || o.type === 'chart') {
      let bytes, ext, key, crop = '';
      if (o.type === 'chart') { bytes = await providers.chartPng(o); ext = 'png'; key = 'chart:' + o.id; }
      else { const r = await providers.imageBytes(o); bytes = r.bytes; ext = r.ext; key = r.baked ? 'img:' + o.id : 'asset:' + o.assetId; if (r.baked) { /* crop already applied */ } else if (o.crop) { const c = o.crop; const pc = (v) => Math.round(v * 100000); crop = `<a:srcRect l="${pc(c.x)}" t="${pc(c.y)}" r="${pc(1 - c.x - c.w)}" b="${pc(1 - c.y - c.h)}"/>`; } }
      const m = addMedia(key, bytes, ext); types.add(ext);
      const rid = rels.add(RT + 'image', '../media/' + m.name);
      const alpha = (o.opacity ?? 1) < 0.999 ? `<a:alphaModFix amt="${Math.round(o.opacity * 100000)}"/>` : '';
      const geom = o.radius && o.type === 'image' ? `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${Math.round(Math.min(50000, (o.radius / Math.max(1, Math.min(o.w, o.h))) * 100000))}"/></a:avLst></a:prstGeom>` : '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
      return `<p:pic><p:nvPicPr><p:cNvPr id="${nid()}" name="${nm}"${o.type === 'chart' ? ` descr="${esc(o.alt || (o.title ? o.kind + ' chart: ' + o.title : o.kind + ' chart'))}"` : descr}/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}">${alpha}</a:blip>${crop}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(o)}${geom}${o.type === 'image' ? lineXml(theme, o.stroke) : ''}${shadowXml(theme, o.shadow)}</p:spPr></p:pic>`;
    }
    if (o.type === 'table') {
      const st = o.tstyle, rowH = o.h / o.rows; const mm = mergeMap(o.merges);
      const grid = o.colW.map((f) => `<a:gridCol w="${e(f * o.w)}"/>`).join('');
      const rows = o.cells.map((row, r) => `<a:tr h="${e(rowH)}">${row.map((txt, c) => {
        const head = st.headerRow && r === 0; const fill = head ? st.headerFill : (st.zebra && r % 2 === 0 ? st.fill : '@bg');
        const tx = { paras: [{ runs: [{ t: txt, b: head }] }], font: st.font, size: st.size, color: head ? st.headerColor : st.color, align: 'left', valign: 'middle', lineSpacing: 1.2, autofit: false, padding: 0 };
        const b = (t) => `<a:${t} w="${e(1)}">${solid(theme, st.border, 1)}</a:${t}>`;
        const mi = mm.get(r + ',' + c); const tcAttr = mi ? (mi.isAnchor ? (mi.m.cs > 1 ? ` gridSpan="${mi.m.cs}"` : '') + (mi.m.rs > 1 ? ` rowSpan="${mi.m.rs}"` : '') : (c > mi.m.c ? ' hMerge="1"' : '') + (r > mi.m.r ? ' vMerge="1"' : '')) : '';
        return `<a:tc${tcAttr}><a:txBody><a:bodyPr/><a:lstStyle/>${txBodyXml(theme, tx, 1, rels).replace(/^<p:txBody>[\s\S]*?<a:lstStyle\/>/, '').replace(/<\/p:txBody>$/, '')}</a:txBody><a:tcPr marL="${e(8)}" marR="${e(8)}" marT="${e(4)}" marB="${e(4)}" anchor="ctr">${b('lnL')}${b('lnR')}${b('lnT')}${b('lnB')}${solid(theme, fill, o.opacity ?? 1)}</a:tcPr></a:tc>`;
      }).join('')}</a:tr>`).join('');
      return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${nid()}" name="${nm}"${descr}/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>${xfrm(o, 'p:xfrm').replace(/ rot="\d+"/, '')}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="${st.headerRow ? 1 : 0}" bandRow="${st.zebra ? 1 : 0}"/><a:tblGrid>${grid}</a:tblGrid>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
    }
    // text / shape
    const shape = o.type === 'shape' ? o.shape : 'rect';
    if (shape === 'line') return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${nid()}" name="${nm}"${descr}/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm(o)}<a:prstGeom prst="line"><a:avLst/></a:prstGeom>${lineXml(theme, o.stroke)}${shadowXml(theme, o.shadow)}</p:spPr></p:cxnSp>`;
    let geom = `<a:prstGeom prst="${PRST[shape] || 'rect'}"><a:avLst/></a:prstGeom>`;
    const rad = o.radius || (shape === 'roundRect' ? Math.min(o.w, o.h) * 0.2 : 0);
    if ((shape === 'roundRect' || shape === 'rect') && rad > 0) geom = `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${Math.round(Math.min(50000, (rad / Math.max(1, Math.min(o.w, o.h))) * 100000))}"/></a:avLst></a:prstGeom>`;
    const gradStop = (pos, v) => { const c = hexOf(theme, v, 'FFFFFF'); return `<a:gs pos="${pos}"><a:srgbClr val="${c.hex}"/></a:gs>`; };
    const fill = o.type === 'shape' && o.grad ? `<a:gradFill rotWithShape="1"><a:gsLst>${gradStop(0, o.grad.colors[0])}${gradStop(100000, o.grad.colors[1])}</a:gsLst><a:lin ang="${Math.round((((o.grad.angle || 0) % 360) + 360) % 360 * 60000)}" scaled="0"/></a:gradFill>` : o.fill === 'none' ? '<a:noFill/>' : solid(theme, o.fill, o.opacity ?? 1);
    const hasText = parasToPlain(o.tx.paras).trim() !== '';
    const txb = txBodyXml(theme, o.tx, hasText ? providers.textScale(o) : 1, rels);
    return `<p:sp><p:nvSpPr><p:cNvPr id="${nid()}" name="${nm}"${descr}/><p:cNvSpPr${o.type === 'text' ? ' txBox="1"' : ''}/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(o)}${geom}${fill}${lineXml(theme, o.stroke)}${shadowXml(theme, o.shadow)}</p:spPr>${txb}</p:sp>`;
  };

  const TRANS = { fade: '<p:fade/>', slide: '<p:push dir="l"/>', zoom: '<p:zoom/>' };
  const bgXml = (s) => {
    const bg = s.background && s.background.color ? { type: 'solid', color: s.background.color } : theme.background;
    if (bg.type === 'gradient') { const c = bg.colors.map((x) => hexOf(theme, x, 'FFFFFF')); return `<p:bg><p:bgPr><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="${c[0].hex}"/></a:gs><a:gs pos="100000"><a:srgbClr val="${c[1].hex}"/></a:gs></a:gsLst><a:lin ang="${Math.round((((bg.angle || 0) - 90 + 360) % 360) * 60000)}" scaled="0"/></a:gradFill><a:effectLst/></p:bgPr></p:bg>`; }
    const c = hexOf(theme, bg.color, 'FFFFFF'); return `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${c.hex}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`;
  };
  const GRP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

  const hasNotes = slides.some((s) => (s.notes || '').trim());
  for (let i = 0; i < slides.length; i++) {
    onProgress(`Building slide ${i + 1} of ${slides.length}…`);
    const s = slides[i]; const rels = new Rels(); ids = 1;
    rels.add(RT + 'slideLayout', '../slideLayouts/slideLayout1.xml');
    const body = []; for (const o of s.objects) body.push(await objXml(o, rels));
    const tr = s.transition && TRANS[s.transition.type] ? `<p:transition spd="med">${TRANS[s.transition.type]}</p:transition>` : '';
    zip.file(`ppt/slides/slide${i + 1}.xml`, HDR + `<p:sld ${NS}${s.hidden ? ' show="0"' : ''}><p:cSld>${bgXml(s)}<p:spTree>${GRP}${body.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${tr}</p:sld>`);
    if ((s.notes || '').trim()) {
      rels.add(RT + 'notesSlide', `../notesSlides/notesSlide${i + 1}.xml`);
      const paras = s.notes.split(/\r?\n/).map((l) => `<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${esc(l)}</a:t></a:r></a:p>`).join('');
      zip.file(`ppt/notesSlides/notesSlide${i + 1}.xml`, HDR + `<p:notes ${NS}><p:cSld><p:spTree>${GRP}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`);
      zip.file(`ppt/notesSlides/_rels/notesSlide${i + 1}.xml.rels`, HDR + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RT}notesMaster" Target="../notesMasters/notesMaster1.xml"/><Relationship Id="rId2" Type="${RT}slide" Target="../slides/slide${i + 1}.xml"/></Relationships>`);
    }
    zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`, rels.xml());
  }

  const cm = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';
  const hx = (k) => (hexOf(theme, '@' + k, '888888') || { hex: '888888' }).hex;
  const themeXml = (name) => HDR + `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="${esc(name)}"><a:themeElements><a:clrScheme name="Slidewise"><a:dk1><a:srgbClr val="${hx('text')}"/></a:dk1><a:lt1><a:srgbClr val="${hx('bg')}"/></a:lt1><a:dk2><a:srgbClr val="${hx('muted')}"/></a:dk2><a:lt2><a:srgbClr val="${hx('surface')}"/></a:lt2>${[1, 2, 3, 4, 5, 6].map((n) => `<a:accent${n}><a:srgbClr val="${hx('accent' + n)}"/></a:accent${n}>`).join('')}<a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme><a:fontScheme name="Slidewise"><a:majorFont><a:latin typeface="${esc(faceFor(theme, '@heading'))}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${esc(faceFor(theme, '@body'))}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
  zip.file('ppt/theme/theme1.xml', themeXml('Slidewise'));
  zip.file('ppt/slideMasters/slideMaster1.xml', HDR + `<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GRP}</p:spTree></p:cSld>${cm}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`);
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', HDR + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RT}slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${RT}theme" Target="../theme/theme1.xml"/></Relationships>`);
  zip.file('ppt/slideLayouts/slideLayout1.xml', HDR + `<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${GRP}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', HDR + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RT}slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`);
  if (hasNotes) {
    zip.file('ppt/theme/theme2.xml', themeXml('Slidewise notes'));
    zip.file('ppt/notesMasters/notesMaster1.xml', HDR + `<p:notesMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GRP}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="1143000"/><a:ext cx="5486400" cy="3086100"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp></p:spTree></p:cSld>${cm}</p:notesMaster>`);
    zip.file('ppt/notesMasters/_rels/notesMaster1.xml.rels', HDR + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RT}theme" Target="../theme/theme2.xml"/></Relationships>`);
  }
  const prels = new Rels(); prels.add(RT + 'slideMaster', 'slideMasters/slideMaster1.xml');
  const slideRids = slides.map((_, i) => prels.add(RT + 'slide', `slides/slide${i + 1}.xml`));
  const notesRid = hasNotes ? prels.add(RT + 'notesMaster', 'notesMasters/notesMaster1.xml') : null;
  zip.file('ppt/_rels/presentation.xml.rels', prels.xml());
  zip.file('ppt/presentation.xml', HDR + `<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>${notesRid ? `<p:notesMasterIdLst><p:notesMasterId r:id="${notesRid}"/></p:notesMasterIdLst>` : ''}<p:sldIdLst>${slideRids.map((r, i) => `<p:sldId id="${256 + i}" r:id="${r}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${e(deck.size.w)}" cy="${e(deck.size.h)}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
  zip.file('docProps/core.xml', HDR + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(deck.name)}</dc:title><dc:creator>Slidewise</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date(deck.createdAt).toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`);
  zip.file('_rels/.rels', HDR + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RT}officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  const defaults = ['png', 'jpeg', 'gif', 'webp'].filter((x) => types.has(x)).map((x) => `<Default Extension="${x}" ContentType="image/${x}"/>`).join('');
  const ct = HDR + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${defaults}<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${hasNotes ? '<Override PartName="/ppt/theme/theme2.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>' : ''}${slides.map((s, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>${(s.notes || '').trim() ? `<Override PartName="/ppt/notesSlides/notesSlide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>` : ''}`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  zip.file('[Content_Types].xml', ct);
  void warnings;
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
}
void FONTS;
