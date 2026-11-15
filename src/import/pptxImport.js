import { normalizeMerges } from '../model/tableMerge.js';
// PPTX import. A .pptx is an untrusted ZIP of XML: we cap sizes and counts, refuse DTDs/entities, never evaluate anything,
// only read an allow-list of elements, allow only raster images (sniffed by magic bytes), and finally pass the result through validateDeck().
import JSZip from 'jszip';
import { LIMITS, SIZE_PRESETS } from '../model/constants.js';
import { createDeck } from '../model/factory.js';
import { uid } from '../model/ids.js';
import { validateDeck } from '../model/validate.js';
import { sniffImageType } from '../model/imageImport.js';
import { b64encode } from '../crypto/lock.js';

const EMU = 9525;
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MAX_XML = 12 * 1024 * 1024;

export class ImportError extends Error { constructor(m) { super(m); this.name = 'ImportError'; } }

// ---- XML helpers ----
export function parseXml(text) {
  if (text.length > MAX_XML) throw new ImportError('An XML part is too large.');
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new ImportError('The file contains a DTD or entity declaration, which is not allowed.');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new ImportError('The file contains malformed XML.');
  return doc;
}
const kids = (el, ns, name) => Array.from(el ? el.childNodes : []).filter((n) => n.nodeType === 1 && n.localName === name && (!ns || n.namespaceURI === ns));
const kid = (el, ns, name) => kids(el, ns, name)[0] || null;
const path = (el, steps) => { let cur = el; for (const [ns, n] of steps) { cur = kid(cur, ns, n); if (!cur) return null; } return cur; };
const attrN = (el, name, def = 0) => { const v = el && el.getAttribute(name); const n = v === null || v === undefined ? NaN : parseFloat(v); return Number.isFinite(n) ? n : def; };

// ---- zip ----
async function openZip(buffer) {
  if (buffer.byteLength > LIMITS.maxImportFileBytes) throw new ImportError('The file is too large.');
  let zip; try { zip = await JSZip.loadAsync(buffer, { checkCRC32: false }); } catch { throw new ImportError('This is not a valid PPTX (ZIP) file.'); }
  const names = Object.keys(zip.files);
  if (names.length > LIMITS.maxPptxEntries) throw new ImportError(`The file has too many parts (limit ${LIMITS.maxPptxEntries}).`);
  let declared = 0;
  for (const n of names) { const f = zip.files[n]; const sz = f._data && Number.isFinite(f._data.uncompressedSize) ? f._data.uncompressedSize : 0; declared += sz; if (/(^|\/)\.\.(\/|$)/.test(n) || n.startsWith('/')) throw new ImportError('The file contains unsafe paths.'); }
  if (declared > LIMITS.maxPptxUncompressed) throw new ImportError('The file expands to too much data (possible zip bomb).');
  let used = 0;
  const read = async (name, type) => {
    const f = zip.file(name); if (!f) return null;
    const out = await f.async(type); used += type === 'string' ? out.length : out.length;
    if (used > LIMITS.maxPptxUncompressed) throw new ImportError('The file expands to too much data (possible zip bomb).');
    return out;
  };
  return { zip, read, has: (n) => !!zip.file(n) };
}
const resolve = (base, target) => {
  if (/^[a-z]+:/i.test(target)) return null;
  const parts = target.startsWith('/') ? [] : base.split('/').slice(0, -1);
  for (const seg of target.replace(/^\//, '').split('/')) { if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg); }
  return parts.join('/');
};
async function relsOf(pkg, partPath) {
  const dir = partPath.split('/').slice(0, -1).join('/'), file = partPath.split('/').pop();
  const rp = (dir ? dir + '/' : '') + '_rels/' + file + '.rels';
  const text = await pkg.read(rp, 'string'); const map = {};
  if (!text) return map;
  const doc = parseXml(text);
  for (const r of Array.from(doc.getElementsByTagName('Relationship'))) { const id = r.getAttribute('Id'); if (id) map[id] = { type: (r.getAttribute('Type') || '').split('/').pop(), target: r.getAttribute('Target') || '', external: r.getAttribute('TargetMode') === 'External', abs: r.getAttribute('TargetMode') === 'External' ? null : resolve(partPath, r.getAttribute('Target') || '') }; }
  return map;
}

// ---- theme colours ----
function readTheme(doc) {
  const cs = doc && doc.getElementsByTagNameNS(A, 'clrScheme')[0]; const colors = {};
  if (cs) for (const n of Array.from(cs.childNodes)) { if (n.nodeType !== 1) continue; const c = n.firstElementChild; if (!c) continue; colors[n.localName] = c.localName === 'srgbClr' ? '#' + c.getAttribute('val') : c.localName === 'sysClr' ? '#' + (c.getAttribute('lastClr') || '000000') : null; }
  const fonts = {}; const fs = doc && doc.getElementsByTagNameNS(A, 'fontScheme')[0];
  if (fs) { const mj = path(fs, [[A, 'majorFont'], [A, 'latin']]), mn = path(fs, [[A, 'minorFont'], [A, 'latin']]); fonts.major = mj && mj.getAttribute('typeface'); fonts.minor = mn && mn.getAttribute('typeface'); }
  return { colors, fonts };
}
const hex6 = (v) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v.toLowerCase() : null);
function fontKeyFor(face) {
  const f = (face || '').toLowerCase();
  if (/georgia|garamond|palatino|cambria|serif(?!.*sans)|book/.test(f) && !/sans/.test(f)) return 'serif';
  if (/times/.test(f)) return 'times'; if (/courier/.test(f)) return 'courier'; if (/consolas|mono|menlo/.test(f)) return 'mono';
  if (/verdana/.test(f)) return 'verdana'; if (/trebuchet/.test(f)) return 'trebuchet'; if (/impact/.test(f)) return 'impact'; if (/arial|helvetica/.test(f)) return 'arial';
  return 'sans';
}

export async function parsePptx(buffer) {
  const pkg = await openZip(buffer);
  const warnings = []; const skipped = {};
  const skip = (what) => { skipped[what] = (skipped[what] || 0) + 1; };
  const presText = await pkg.read('ppt/presentation.xml', 'string');
  if (!presText) throw new ImportError('Not a PowerPoint file: ppt/presentation.xml is missing.');
  const pres = parseXml(presText);
  const presRels = await relsOf(pkg, 'ppt/presentation.xml');
  const sz = pres.getElementsByTagNameNS(P, 'sldSz')[0];
  let cx = attrN(sz, 'cx', 12192000), cy = attrN(sz, 'cy', 6858000);
  let wpx = cx / EMU, hpx = cy / EMU;
  const k0 = Math.min(1, LIMITS.maxSlideSize / Math.max(wpx, hpx)), k1 = Math.max(1, LIMITS.minSlideSize / Math.min(wpx, hpx));
  const kScale = k0 < 1 ? k0 : k1;
  wpx = Math.round(wpx * kScale); hpx = Math.round(hpx * kScale);
  const S = EMU / kScale; // emu per slide unit
  const size = { w: wpx, h: hpx };

  // theme
  let themeInfo = { colors: {}, fonts: {} };
  const masterRel = Object.values(presRels).find((r) => r.type === 'slideMaster');
  let masterDoc = null, masterRels = {};
  if (masterRel && masterRel.abs) {
    const mt = await pkg.read(masterRel.abs, 'string'); if (mt) masterDoc = parseXml(mt);
    masterRels = await relsOf(pkg, masterRel.abs);
    const tRel = Object.values(masterRels).find((r) => r.type === 'theme');
    if (tRel && tRel.abs) { const tt = await pkg.read(tRel.abs, 'string'); if (tt) themeInfo = readTheme(parseXml(tt)); }
  }
  const tc = themeInfo.colors;
  const schemeColor = (name) => { const map = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' }; return hex6(tc[map[name] || name]) || null; };
  const readColor = (el) => {
    if (!el) return null; const c = el.firstElementChild; if (!c) return null;
    if (c.localName === 'srgbClr') return hex6('#' + c.getAttribute('val'));
    if (c.localName === 'schemeClr') return schemeColor(c.getAttribute('val'));
    if (c.localName === 'sysClr') return hex6('#' + (c.getAttribute('lastClr') || '000000'));
    return null;
  };
  const fillOf = (spPr) => { if (!spPr) return undefined; if (kid(spPr, A, 'noFill')) return 'none'; const sf = kid(spPr, A, 'solidFill'); if (sf) return readColor(sf) || undefined; const gf = kid(spPr, A, 'gradFill'); if (gf) { const gs = gf.getElementsByTagNameNS(A, 'gs')[0]; return gs ? readColor(gs) || undefined : undefined; } return undefined; };

  // slide list in order
  const slideIds = Array.from(pres.getElementsByTagNameNS(P, 'sldId')).map((n) => n.getAttributeNS(R, 'id') || n.getAttribute('r:id'));
  if (!slideIds.length) throw new ImportError('The presentation has no slides.');
  if (slideIds.length > LIMITS.maxSlides) { warnings.push(`Only the first ${LIMITS.maxSlides} slides were imported.`); slideIds.length = LIMITS.maxSlides; }

  const assets = {}; const assetByPath = new Map(); let assetBytes = 0;
  const loadImage = async (abs) => {
    if (!abs) return null; if (assetByPath.has(abs)) return assetByPath.get(abs);
    const bytes = await pkg.read(abs, 'uint8array'); let res = null;
    if (bytes && bytes.length <= LIMITS.maxImageBytes) {
      const mime = sniffImageType(bytes);
      if (mime) { assetBytes += bytes.length; if (assetBytes <= LIMITS.maxAssetsBytes) { const id = 'a' + uid().slice(0, 14); assets[id] = { mime, name: abs.split('/').pop().slice(0, 100), w: 0, h: 0, data: `data:${mime};base64,${b64encode(bytes)}` }; res = id; } else skip('images over the total size limit'); }
      else skip('images that are not PNG/JPEG/GIF/WebP (e.g. SVG, EMF)');
    } else if (bytes) skip('images over the size limit');
    assetByPath.set(abs, res); return res;
  };

  // placeholder geometry inheritance (layout, then master)
  const phIndex = (doc) => { const out = []; if (!doc) return out; for (const sp of Array.from(doc.getElementsByTagNameNS(P, 'sp'))) { const ph = sp.getElementsByTagNameNS(P, 'ph')[0]; if (!ph) continue; const x = path(sp, [[P, 'spPr'], [A, 'xfrm']]); if (x) out.push({ type: ph.getAttribute('type') || 'body', idx: ph.getAttribute('idx'), xfrm: x }); } return out; };
  const masterPh = phIndex(masterDoc);
  const layoutCache = new Map();
  const getLayout = async (abs) => { if (!layoutCache.has(abs)) { const t = await pkg.read(abs, 'string'); layoutCache.set(abs, t ? phIndex(parseXml(t)) : []); } return layoutCache.get(abs); };
  const findPh = (list, ph) => list.find((x) => (ph.getAttribute('idx') && x.idx === ph.getAttribute('idx')) || (!ph.getAttribute('idx') && x.type === (ph.getAttribute('type') || 'body'))) || list.find((x) => x.type === (ph.getAttribute('type') || 'body'));

  const xfrmOf = (xf) => {
    if (!xf) return null; const off = kid(xf, A, 'off'), ext = kid(xf, A, 'ext');
    if (!off || !ext) return null;
    return { x: attrN(off, 'x') / S, y: attrN(off, 'y') / S, w: attrN(ext, 'cx') / S, h: attrN(ext, 'cy') / S, rot: attrN(xf, 'rot') / 60000, flipH: xf.getAttribute('flipH') === '1', flipV: xf.getAttribute('flipV') === '1' };
  };

  // ---- text ----
  const readParas = (txBody, ctx) => {
    const paras = []; let size = 0, color = null, font = null;
    for (const p of kids(txBody, A, 'p')) {
      const pPr = kid(p, A, 'pPr'); const para = { runs: [] };
      const al = pPr && pPr.getAttribute('algn'); if (al) para.align = { l: 'left', ctr: 'center', r: 'right', just: 'justify' }[al] || 'left';
      if (pPr) { if (kid(pPr, A, 'buChar')) para.list = 'bullet'; else if (kid(pPr, A, 'buAutoNum')) para.list = 'number'; const lvl = parseInt(pPr.getAttribute('lvl'), 10); if (lvl > 0 && lvl <= 8) para.indent = lvl; }
      for (const r of Array.from(p.childNodes)) {
        if (r.nodeType !== 1) continue;
        if (r.localName === 'br') { para.runs.push({ t: ' ' }); continue; }
        if (r.localName !== 'r' && r.localName !== 'fld') continue;
        const t = kid(r, A, 't'); const text = t ? t.textContent : ''; if (!text) continue;
        const rPr = kid(r, A, 'rPr'); const run = { t: text.slice(0, LIMITS.maxTextChars) };
        if (rPr) {
          if (rPr.getAttribute('b') === '1') run.b = true; if (rPr.getAttribute('i') === '1') run.i = true;
          const u = rPr.getAttribute('u'); if (u && u !== 'none') run.u = true; const st = rPr.getAttribute('strike'); if (st && st !== 'noStrike') run.s = true;
          const sz = parseFloat(rPr.getAttribute('sz')); if (Number.isFinite(sz) && sz > 0) { run.size = Math.round((sz / 100 / 0.75) * 10) / 10; if (!size) size = run.size; }
          const c = readColor(kid(rPr, A, 'solidFill')); if (c) { run.color = c; if (!color) color = c; }
          const hl = readColor(kid(rPr, A, 'highlight')); if (hl) run.hl = hl;
          const lat = kid(rPr, A, 'latin'); if (lat && lat.getAttribute('typeface') && !lat.getAttribute('typeface').startsWith('+')) { run.font = fontKeyFor(lat.getAttribute('typeface')); if (!font) font = run.font; }
          const hl2 = kid(rPr, A, 'hlinkClick'); if (hl2) { const rid = hl2.getAttributeNS(R, 'id') || hl2.getAttribute('r:id'); const rel = ctx.rels[rid]; if (rel && rel.external && /^(https?:\/\/|mailto:)/i.test(rel.target)) run.link = rel.target; }
        }
        para.runs.push(run);
      }
      if (!para.runs.length) para.runs.push({ t: '' });
      paras.push(para);
    }
    return { paras: paras.length ? paras : [{ runs: [{ t: '' }] }], size, color, font };
  };
  const baseTx = (txBody, ctx, over = {}) => {
    const { paras, size, color, font } = readParas(txBody, ctx);
    const bp = txBody && kid(txBody, A, 'bodyPr'); const anchor = bp && bp.getAttribute('anchor');
    const pad = bp ? Math.round(((attrN(bp, 'lIns', 91440) / S) ) * 10) / 10 : 12;
    return { paras, font: font || '@body', size: size || 24, color: color || '@text', align: 'left', valign: anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : 'top', lineSpacing: 1.2, autofit: !!(bp && kid(bp, A, 'normAutofit')), padding: Math.max(0, Math.min(60, pad)), ...over };
  };

  const PRESET = { rect: 'rect', roundRect: 'roundRect', ellipse: 'ellipse', triangle: 'triangle', rtTriangle: 'triangle', rightArrow: 'arrow', star5: 'star', line: 'line', straightConnector1: 'line' };
  let objCount = 0;
  const mkBase = (type, name, geo, descr) => ({ id: uid('o'), type, name: (name || type).slice(0, 100), x: geo.x, y: geo.y, w: Math.max(0, geo.w), h: Math.max(0, geo.h), rot: geo.rot || 0, locked: false, opacity: 1, alt: (descr || '').slice(0, 1000), anim: { type: 'none', dir: 'left', order: 0, duration: 500 } });
  const stroke = (spPr) => { const ln = spPr && kid(spPr, A, 'ln'); if (!ln || kid(ln, A, 'noFill')) return { color: '@muted', width: 0, dash: 'solid' }; const w = attrN(ln, 'w', 12700) / S; const c = readColor(kid(ln, A, 'solidFill')) || '#000000'; const d = kid(ln, A, 'prstDash'); const dv = d && d.getAttribute('val'); return { color: c, width: Math.min(100, Math.max(0, Math.round(w * 10) / 10)), dash: dv && /dash/i.test(dv) && !/sys/i.test(dv) ? 'dashed' : dv && /dot|sys/i.test(dv) ? 'dotted' : 'solid' }; };
  const shadow = (spPr) => { const ef = spPr && kid(spPr, A, 'effectLst'); const sh = ef && kid(ef, A, 'outerShdw'); if (!sh) return { on: false, x: 4, y: 4, blur: 10, color: '#00000066' }; const dist = attrN(sh, 'dist') / S, dir = (attrN(sh, 'dir') / 60000) * Math.PI / 180; return { on: true, x: Math.round(Math.cos(dir) * dist), y: Math.round(Math.sin(dir) * dist), blur: Math.round(attrN(sh, 'blurRad') / S), color: '#00000066' }; };

  const readShapeTree = async (tree, ctx, out, depth) => {
    for (const node of Array.from(tree.childNodes)) {
      if (node.nodeType !== 1) continue;
      if (++objCount > LIMITS.maxTotalObjects) { skip('objects over the limit'); return; }
      if (out.length >= LIMITS.maxObjectsPerSlide) { skip('objects over the per-slide limit'); continue; }
      const ln = node.localName;
      try {
        if (ln === 'sp' || ln === 'cxnSp') {
          const nv = kid(node, P, ln === 'sp' ? 'nvSpPr' : 'nvCxnSpPr'); const cNv = kid(nv, P, 'cNvPr');
          const spPr = kid(node, P, 'spPr'); let geo = xfrmOf(kid(spPr, A, 'xfrm'));
          const ph = nv && nv.getElementsByTagNameNS(P, 'ph')[0];
          if (!geo && ph) { const f = (ctx.layoutPh && findPh(ctx.layoutPh, ph)) || findPh(masterPh, ph); if (f) geo = xfrmOf(f.xfrm); }
          if (!geo) { skip('shapes without a position'); continue; }
          const prst = path(spPr, [[A, 'prstGeom']]); const pv = prst && prst.getAttribute('prst');
          const isLine = ln === 'cxnSp' || pv === 'line' || pv === 'straightConnector1';
          const txBody = kid(node, P, 'txBody'); const hasText = txBody && Array.from(txBody.getElementsByTagNameNS(A, 't')).some((t) => t.textContent.trim());
          const descr = cNv && cNv.getAttribute('descr'); const name = cNv && cNv.getAttribute('name');
          if (isLine) { const st = stroke(spPr); out.push({ ...mkBase('shape', name, { ...geo, h: 0 }, descr), shape: 'line', fill: 'none', stroke: { ...st, width: st.width || 2 }, radius: 0, shadow: shadow(spPr), tx: baseTx(null, ctx) }); continue; }
          if (!pv && !hasText && !fillOf(spPr)) { skip('empty or custom-geometry shapes'); continue; }
          const shape = PRESET[pv] || (pv ? 'rect' : 'rect'); if (pv && !PRESET[pv]) skip(`shapes with unsupported geometry (drawn as rectangles)`);
          const fill = fillOf(spPr); const isTextBox = !!(nv && kid(nv, P, 'cNvSpPr') && kid(nv, P, 'cNvSpPr').getAttribute('txBox') === '1') || (!!ph && !fill);
          const o = { ...mkBase(isTextBox && shape === 'rect' ? 'text' : 'shape', name, geo, descr), fill: fill === undefined ? (isTextBox ? 'none' : '@accent1') : fill, stroke: stroke(spPr), radius: 0, shadow: shadow(spPr), tx: baseTx(txBody, ctx) };
          const gfill = spPr && kid(spPr, A, 'gradFill');
          if (gfill && o.type === 'shape') { const stops = [...gfill.getElementsByTagNameNS(A, 'gs')]; const c0 = stops[0] && readColor(stops[0]), c1 = stops.length > 1 && readColor(stops[stops.length - 1]); const lin = kid(gfill, A, 'lin'); if (c0 && c1) o.grad = { colors: [c0, c1], angle: lin ? Math.round(attrN(lin, 'ang') / 60000) % 360 : 90 }; }
          if (o.type === 'shape') o.shape = shape; if (shape === 'roundRect') o.radius = Math.round(Math.min(geo.w, geo.h) * 0.16);
          if (ph && ph.getAttribute('type') && /title/i.test(ph.getAttribute('type'))) { o.tx = { ...o.tx, font: '@heading', size: o.tx.size === 24 ? 40 : o.tx.size }; }
          out.push(o);
        } else if (ln === 'pic') {
          const nv = kid(node, P, 'nvPicPr'); const cNv = kid(nv, P, 'cNvPr'); const bf = kid(node, P, 'blipFill'); const blip = bf && kid(bf, A, 'blip');
          const rid = blip && (blip.getAttributeNS(R, 'embed') || blip.getAttribute('r:embed')); const rel = rid && ctx.rels[rid];
          const geo = xfrmOf(path(node, [[P, 'spPr'], [A, 'xfrm']])); if (!geo || !rel) { skip('pictures without data'); continue; }
          const id = await loadImage(rel.abs); if (!id) continue;
          const src = bf && kid(bf, A, 'srcRect'); const pc = (n) => Math.min(0.95, Math.max(0, attrN(src, n, 0) / 100000));
          const l = pc('l'), t = pc('t'), r = pc('r'), b = pc('b');
          out.push({ ...mkBase('image', cNv && cNv.getAttribute('name'), geo, cNv && cNv.getAttribute('descr')), assetId: id, crop: { x: l, y: t, w: Math.max(0.05, 1 - l - r), h: Math.max(0.05, 1 - t - b) }, adjust: { brightness: 100, contrast: 100, saturation: 100, grayscale: 0 }, stroke: stroke(kid(node, P, 'spPr')), radius: 0, shadow: shadow(kid(node, P, 'spPr')) });
        } else if (ln === 'graphicFrame') {
          const gd = node.getElementsByTagNameNS(A, 'graphicData')[0]; const tbl = gd && kid(gd, A, 'tbl');
          const geo = xfrmOf(kid(node, P, 'xfrm')); const cNv = path(node, [[P, 'nvGraphicFramePr'], [P, 'cNvPr']]);
          if (!tbl || !geo) { skip('charts, diagrams and embedded objects'); continue; }
          const trs = kids(tbl, A, 'tr').slice(0, 100); const cols = Math.min(50, kids(kid(tbl, A, 'tblGrid'), A, 'gridCol').length || 1);
          if (trs.length * cols > LIMITS.maxTableCells) { skip('oversized tables'); continue; }
          const cells = trs.map((tr) => Array.from({ length: cols }, (_, c) => { const tc2 = kids(tr, A, 'tc')[c]; return tc2 ? Array.from(tc2.getElementsByTagNameNS(A, 'p')).map((p) => Array.from(p.getElementsByTagNameNS(A, 't')).map((t) => t.textContent).join('')).join(' ').slice(0, 5000) : ''; }));
          const gw = kids(kid(tbl, A, 'tblGrid'), A, 'gridCol').map((g) => attrN(g, 'w', 1)); const sum = gw.reduce((a, b) => a + b, 0) || 1;
          out.push({ ...mkBase('table', cNv && cNv.getAttribute('name'), geo, cNv && cNv.getAttribute('descr')), rows: trs.length, cols, cells, merges: normalizeMerges(trs.flatMap((tr, r) => kids(tr, A, 'tc').map((tc2, c) => ({ r, c, rs: attrN(tc2, 'rowSpan', 1), cs: attrN(tc2, 'gridSpan', 1) }))), trs.length, cols), colW: gw.length === cols ? gw.map((g) => g / sum) : Array(cols).fill(1 / cols), tstyle: { headerRow: kid(kid(tbl, A, 'tblPr'), A, 'x') === null && (kid(tbl, A, 'tblPr') ? kid(tbl, A, 'tblPr').getAttribute('firstRow') !== '0' : true), zebra: true, headerFill: '@accent1', headerColor: '#ffffff', border: '@muted', fill: '@surface', color: '@text', size: 18, font: '@body' }, shadow: { on: false, x: 4, y: 4, blur: 10, color: '#00000066' } });
        } else if (ln === 'grpSp') {
          if (depth >= LIMITS.maxGroupDepth) { skip('deeply nested groups'); continue; }
          const grp = kid(node, P, 'grpSpPr'); const xf = grp && kid(grp, A, 'xfrm'); const geo = xfrmOf(xf);
          if (!geo) { skip('groups without a position'); continue; }
          const chOff = xf && kid(xf, A, 'chOff'), chExt = xf && kid(xf, A, 'chExt');
          const inner = []; await readShapeTree(node, ctx, inner, depth + 1);
          if (!inner.length) continue;
          const cox = chOff ? attrN(chOff, 'x') / S : geo.x, coy = chOff ? attrN(chOff, 'y') / S : geo.y;
          const cew = chExt ? attrN(chExt, 'cx') / S : geo.w, ceh = chExt ? attrN(chExt, 'cy') / S : geo.h;
          const sx = cew ? geo.w / cew : 1, sy = ceh ? geo.h / ceh : 1;
          const children = inner.map((c) => ({ ...c, x: (c.x - cox) * sx, y: (c.y - coy) * sy, w: c.w * sx, h: c.h * sy }));
          const cNv = path(node, [[P, 'nvGrpSpPr'], [P, 'cNvPr']]);
          out.push({ ...mkBase('group', cNv && cNv.getAttribute('name'), geo), children });
        } else if (ln === 'AlternateContent' || ln === 'contentPart' || ln === 'oleObj') skip('unsupported content');
      } catch (e) { if (e instanceof ImportError) throw e; skip('elements that could not be read'); }
    }
  };

  const slides = [];
  for (let i = 0; i < slideIds.length; i++) {
    const rel = presRels[slideIds[i]]; if (!rel || !rel.abs) continue;
    const text = await pkg.read(rel.abs, 'string'); if (!text) continue;
    const doc = parseXml(text); const rels = await relsOf(pkg, rel.abs);
    const layoutRel = Object.values(rels).find((r) => r.type === 'slideLayout');
    const ctx = { rels, layoutPh: layoutRel && layoutRel.abs ? await getLayout(layoutRel.abs) : null };
    const tree = path(doc.documentElement, [[P, 'cSld'], [P, 'spTree']]); const objects = [];
    if (tree) await readShapeTree(tree, ctx, objects, 0);
    // notes
    let notes = ''; const nRel = Object.values(rels).find((r) => r.type === 'notesSlide');
    if (nRel && nRel.abs) { const nt = await pkg.read(nRel.abs, 'string'); if (nt) { const nd = parseXml(nt); for (const sp of Array.from(nd.getElementsByTagNameNS(P, 'sp'))) { const ph = sp.getElementsByTagNameNS(P, 'ph')[0]; if (ph && ph.getAttribute('type') === 'body') { const tb = kid(sp, P, 'txBody'); if (tb) notes = kids(tb, A, 'p').map((p) => Array.from(p.getElementsByTagNameNS(A, 't')).map((t) => t.textContent).join('')).join('\n').slice(0, 50000); } } } }
    // background
    const bgFill = path(doc.documentElement, [[P, 'cSld'], [P, 'bg'], [P, 'bgPr']]); const bgc = bgFill && fillOf(bgFill);
    const tr = doc.documentElement.getElementsByTagNameNS(P, 'transition')[0]; let ttype = 'none';
    if (tr) { if (kid(tr, P, 'fade')) ttype = 'fade'; else if (kid(tr, P, 'push') || kid(tr, P, 'cover') || kid(tr, P, 'pull')) ttype = 'slide'; else if (kid(tr, P, 'zoom')) ttype = 'zoom'; }
    slides.push({ id: uid('s'), layout: 'blank', hidden: doc.documentElement.getAttribute('show') === '0', notes, background: bgc && bgc !== 'none' ? { color: bgc } : null, transition: { type: ttype, duration: 500 }, objects });
  }
  if (!slides.length) throw new ImportError('No slides could be read from this file.');

  const lt = hex6(tc.lt1) || '#ffffff', dk = hex6(tc.dk1) || '#111111';
  const accents = [1, 2, 3, 4, 5, 6].map((n) => hex6(tc['accent' + n]) || '#4f46e5');
  const theme = { id: 'imported', name: 'Imported', colors: { bg: lt, surface: hex6(tc.lt2) || '#eeeeee', text: dk, muted: hex6(tc.dk2) || '#666666', accent1: accents[0], accent2: accents[1], accent3: accents[2], accent4: accents[3], accent5: accents[4], accent6: accents[5] }, fonts: { heading: fontKeyFor(themeInfo.fonts.major), body: fontKeyFor(themeInfo.fonts.minor) }, background: { type: 'solid', color: '@bg' } };
  const title = presText && (await pkg.read('docProps/core.xml', 'string').then((t) => { if (!t) return ''; try { const d = parseXml(t); const e = d.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'title')[0]; return e ? e.textContent : ''; } catch { return ''; } }).catch(() => ''));
  const raw = { ...createDeck({ name: (title || 'Imported presentation').slice(0, 200), size, slides }), theme, assets };
  // drop assets' w/h unknowns, run through the strict validator (the final gate)
  const deck = validateDeck(raw);
  const notesSkipped = Object.entries(skipped).map(([k, v]) => `${v} ${k}`);
  if (notesSkipped.length) warnings.push('Not imported: ' + notesSkipped.join('; ') + '.');
  return { deck, warnings };
}
void SIZE_PRESETS;
