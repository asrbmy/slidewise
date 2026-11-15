// Strict validation + sanitisation of untrusted deck JSON. Output is rebuilt from allow-listed fields only; nothing is copied through verbatim.
import { normalizeMerges } from './tableMerge.js';
import { LIMITS, SCHEMA_VERSION, SHAPES, CHART_KINDS, ANIM_TYPES, ANIM_DIRS, TRANSITIONS, LAYOUTS, ROLES, FONT_KEYS, FONT_TOKENS, COLOR_TOKENS, IMAGE_MIMES } from './constants.js';
import { uid } from './ids.js';
import { safeLink } from './text.js';
import { validateEnc } from '../crypto/lock.js';

export class ValidationError extends Error {
  constructor(message, path = '') { super(path ? `${message} (at ${path})` : message); this.name = 'ValidationError'; this.path = path; }
}
const fail = (m, p) => { throw new ValidationError(m, p); };
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

const num = (v, p, { min = -1e6, max = 1e6, def = 0 } = {}) => {
  if (v === undefined || v === null) return def;
  if (typeof v !== 'number' || !Number.isFinite(v)) fail('Expected a finite number', p);
  return Math.min(max, Math.max(min, v));
};
const str = (v, p, max = 1000, def = '') => {
  if (v === undefined || v === null) return def;
  if (typeof v !== 'string') fail('Expected a string', p);
  return v.length > max ? v.slice(0, max) : v;
};
const bool = (v, def = false) => (typeof v === 'boolean' ? v : def);
const oneOf = (v, list, def, p) => { if (v === undefined || v === null) return def; if (!list.includes(v)) fail(`Unexpected value "${String(v).slice(0, 40)}"`, p); return v; };
const safeId = (v) => (typeof v === 'string' && /^[\w-]{1,64}$/.test(v) ? v : null);

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i;
export function isColor(v) { return typeof v === 'string' && (HEX.test(v) || RGB.test(v) || COLOR_TOKENS.includes(v) || v === 'none' || v === 'transparent'); }
const color = (v, p, def) => { if (v === undefined || v === null) return def; if (!isColor(v)) fail('Invalid colour', p); return v; };
const fontv = (v, p, def) => { if (v === undefined || v === null) return def; if (FONT_TOKENS.includes(v) || FONT_KEYS.includes(v)) return v; fail('Unknown font', p); };

export function validateAssetData(asset, p) {
  if (!isObj(asset)) fail('Asset must be an object', p);
  const mime = asset.mime;
  if (typeof mime !== 'string' || !IMAGE_MIMES.includes(mime)) fail('Image type not allowed (PNG, JPEG, GIF and WebP only)', p + '.mime');
  const data = asset.data;
  if (typeof data !== 'string') fail('Missing image data', p + '.data');
  const prefix = `data:${mime};base64,`;
  if (!data.startsWith(prefix)) fail('Image data must be a base64 data URL matching its type', p + '.data');
  const b64 = data.slice(prefix.length);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) fail('Image data is not valid base64', p + '.data');
  const bytes = Math.floor((b64.length * 3) / 4);
  if (bytes > LIMITS.maxImageBytes) fail('Image is too large', p + '.data');
  // magic-byte check: content must actually be the declared type
  let head; try { head = atob(b64.slice(0, 24)); } catch { fail('Image data is not valid base64', p + '.data'); }
  const ok = mime === 'image/png' ? head.startsWith('\x89PNG')
    : mime === 'image/jpeg' ? head.startsWith('\xff\xd8\xff')
    : mime === 'image/gif' ? head.startsWith('GIF8')
    : head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP';
  if (!ok) fail('Image content does not match its declared type', p + '.data');
  return { mime, name: str(asset.name, p + '.name', 200, 'image'), w: num(asset.w, p + '.w', { min: 0, max: 65535, def: 0 }), h: num(asset.h, p + '.h', { min: 0, max: 65535, def: 0 }), data };
}

function vStroke(v, p) {
  const s = isObj(v) ? v : {};
  return { color: color(s.color, p + '.color', '@muted'), width: num(s.width, p + '.width', { min: 0, max: 100, def: 0 }), dash: oneOf(s.dash, ['solid', 'dashed', 'dotted'], 'solid', p + '.dash') };
}
function vShadow(v, p) {
  const s = isObj(v) ? v : {};
  return { on: bool(s.on), x: num(s.x, p + '.x', { min: -200, max: 200, def: 4 }), y: num(s.y, p + '.y', { min: -200, max: 200, def: 4 }), blur: num(s.blur, p + '.blur', { min: 0, max: 200, def: 10 }), color: color(s.color, p + '.color', '#00000066') };
}
function vTx(v, p, budget) {
  if (!isObj(v)) fail('Missing text block', p);
  if (!Array.isArray(v.paras) || v.paras.length > 5000) fail('Invalid paragraphs', p + '.paras');
  const paras = v.paras.map((para, i) => {
    const pp = `${p}.paras[${i}]`;
    if (!isObj(para) || !Array.isArray(para.runs) || para.runs.length > 5000) fail('Invalid paragraph', pp);
    const runs = para.runs.map((r, j) => {
      const rp = `${pp}.runs[${j}]`;
      if (!isObj(r)) fail('Invalid run', rp);
      const t = str(r.t, rp + '.t', LIMITS.maxTextChars, '');
      budget.chars += t.length;
      if (budget.chars > LIMITS.maxTextChars * 5) fail('Too much text in one deck', rp);
      const out = { t };
      for (const f of ['b', 'i', 'u', 's']) if (r[f] === true) out[f] = true;
      if (r.color !== undefined) out.color = color(r.color, rp + '.color');
      if (r.hl !== undefined && r.hl !== null) out.hl = color(r.hl, rp + '.hl');
      if (r.size !== undefined) out.size = num(r.size, rp + '.size', { min: 1, max: 1000, def: 24 });
      if (r.font !== undefined) out.font = fontv(r.font, rp + '.font');
      if (r.link !== undefined && r.link !== null) { const l = safeLink(r.link); if (l) out.link = l; }
      return out;
    });
    const out = { runs: runs.length ? runs : [{ t: '' }] };
    if (para.align !== undefined) out.align = oneOf(para.align, ['left', 'center', 'right', 'justify'], 'left', pp + '.align');
    if (para.list !== undefined && para.list !== 'none') out.list = oneOf(para.list, ['bullet', 'number'], 'bullet', pp + '.list');
    if (para.indent !== undefined) out.indent = Math.round(num(para.indent, pp + '.indent', { min: 0, max: 8, def: 0 }));
    return out;
  });
  return {
    paras: paras.length ? paras : [{ runs: [{ t: '' }] }],
    font: fontv(v.font, p + '.font', '@body'), size: num(v.size, p + '.size', { min: 1, max: 1000, def: 28 }), color: color(v.color, p + '.color', '@text'),
    align: oneOf(v.align, ['left', 'center', 'right', 'justify'], 'left', p + '.align'), valign: oneOf(v.valign, ['top', 'middle', 'bottom'], 'top', p + '.valign'),
    lineSpacing: num(v.lineSpacing, p + '.lineSpacing', { min: 0.5, max: 4, def: 1.2 }), autofit: bool(v.autofit), padding: num(v.padding, p + '.padding', { min: 0, max: 200, def: 12 }),
  };
}

function vObject(o, p, ctx, depth) {
  if (!isObj(o)) fail('Object must be an object', p);
  if (depth > LIMITS.maxGroupDepth) fail('Groups nested too deeply', p);
  if (++ctx.objects > LIMITS.maxTotalObjects) fail('Too many objects', p);
  const type = oneOf(o.type, ['text', 'shape', 'image', 'table', 'chart', 'group'], undefined, p + '.type');
  if (!type) fail('Missing object type', p);
  let id = safeId(o.id);
  if (!id || ctx.ids.has(id)) id = uid('o');
  ctx.ids.add(id);
  const out = {
    id, type, name: str(o.name, p + '.name', 200), x: num(o.x, p + '.x', { min: -1e5, max: 1e5 }), y: num(o.y, p + '.y', { min: -1e5, max: 1e5 }),
    w: num(o.w, p + '.w', { min: 0, max: 1e5, def: 100 }), h: num(o.h, p + '.h', { min: 0, max: 1e5, def: 100 }), rot: num(o.rot, p + '.rot', { min: -3600, max: 3600 }),
    locked: bool(o.locked), opacity: num(o.opacity, p + '.opacity', { min: 0, max: 1, def: 1 }), alt: str(o.alt, p + '.alt', 1000),
    anim: (() => { const a = isObj(o.anim) ? o.anim : {}; return { type: oneOf(a.type, ANIM_TYPES, 'none', p + '.anim.type'), dir: oneOf(a.dir, ANIM_DIRS, 'left', p + '.anim.dir'), order: Math.round(num(a.order, p + '.anim.order', { min: 0, max: 1000 })), duration: num(a.duration, p + '.anim.duration', { min: 50, max: 10000, def: 500 }) }; })(),
  };
  if (o.role !== undefined && o.role !== null) out.role = oneOf(o.role, ROLES, undefined, p + '.role');
  if (o.prompt !== undefined) out.prompt = str(o.prompt, p + '.prompt', 200);
  const withVisual = () => { out.opacity = out.opacity; out.shadow = vShadow(o.shadow, p + '.shadow'); };
  if (type === 'text' || type === 'shape') {
    out.fill = color(o.fill, p + '.fill', type === 'shape' ? '@accent1' : 'none'); out.stroke = vStroke(o.stroke, p + '.stroke');
    if (type === 'shape' && o.grad !== undefined && o.grad !== null) {
      if (!isObj(o.grad) || !Array.isArray(o.grad.colors) || o.grad.colors.length !== 2) fail('Gradient needs exactly two colours', p + '.grad');
      out.grad = { colors: [color(o.grad.colors[0], p + '.grad.colors[0]', '@accent1'), color(o.grad.colors[1], p + '.grad.colors[1]', '@accent2')], angle: num(o.grad.angle, p + '.grad.angle', { min: -360, max: 360, def: 90 }) };
    }
    out.radius = num(o.radius, p + '.radius', { min: 0, max: 2000 }); withVisual(); out.tx = vTx(o.tx, p + '.tx', ctx);
    if (type === 'shape') out.shape = oneOf(o.shape, SHAPES, 'rect', p + '.shape');
  } else if (type === 'image') {
    const aid = safeId(o.assetId); if (!aid) fail('Image has no asset reference', p + '.assetId');
    out.assetId = aid; ctx.refs.add(aid);
    const c = isObj(o.crop) ? o.crop : {};
    const cx = num(c.x, p + '.crop.x', { min: 0, max: 0.95, def: 0 }), cy = num(c.y, p + '.crop.y', { min: 0, max: 0.95, def: 0 });
    out.crop = { x: cx, y: cy, w: num(c.w, p + '.crop.w', { min: 0.05, max: 1 - cx, def: 1 - cx }), h: num(c.h, p + '.crop.h', { min: 0.05, max: 1 - cy, def: 1 - cy }) };
    const a = isObj(o.adjust) ? o.adjust : {};
    out.adjust = { brightness: num(a.brightness, p + '.adjust.brightness', { min: 0, max: 300, def: 100 }), contrast: num(a.contrast, p + '.adjust.contrast', { min: 0, max: 300, def: 100 }), saturation: num(a.saturation, p + '.adjust.saturation', { min: 0, max: 300, def: 100 }), grayscale: num(a.grayscale, p + '.adjust.grayscale', { min: 0, max: 100, def: 0 }) };
    out.stroke = vStroke(o.stroke, p + '.stroke'); out.radius = num(o.radius, p + '.radius', { min: 0, max: 2000 }); withVisual();
  } else if (type === 'table') {
    const rows = Math.round(num(o.rows, p + '.rows', { min: 1, max: 100, def: 1 })), cols = Math.round(num(o.cols, p + '.cols', { min: 1, max: 50, def: 1 }));
    if (rows * cols > LIMITS.maxTableCells) fail('Table is too large', p);
    if (!Array.isArray(o.cells)) fail('Table cells missing', p + '.cells');
    out.rows = rows; out.cols = cols; out.merges = normalizeMerges(o.merges, rows, cols);
    out.cells = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => str(Array.isArray(o.cells[r]) ? o.cells[r][c] : '', `${p}.cells[${r}][${c}]`, 5000)));
    const cw = Array.isArray(o.colW) && o.colW.length === cols ? o.colW.map((x, i) => num(x, `${p}.colW[${i}]`, { min: 0.02, max: 1, def: 1 / cols })) : Array(cols).fill(1 / cols);
    const sum = cw.reduce((a, b) => a + b, 0) || 1; out.colW = cw.map((x) => x / sum);
    const t = isObj(o.tstyle) ? o.tstyle : {};
    out.tstyle = { headerRow: bool(t.headerRow, true), zebra: bool(t.zebra, true), headerFill: color(t.headerFill, p + '.tstyle.headerFill', '@accent1'), headerColor: color(t.headerColor, p + '.tstyle.headerColor', '#ffffff'), border: color(t.border, p + '.tstyle.border', '@muted'), fill: color(t.fill, p + '.tstyle.fill', '@surface'), color: color(t.color, p + '.tstyle.color', '@text'), size: num(t.size, p + '.tstyle.size', { min: 4, max: 300, def: 20 }), font: fontv(t.font, p + '.tstyle.font', '@body') };
    withVisual();
  } else if (type === 'chart') {
    out.kind = oneOf(o.kind, CHART_KINDS, 'bar', p + '.kind'); out.title = str(o.title, p + '.title', 300); out.legend = bool(o.legend, true); out.stacked = bool(o.stacked, false); out.area = bool(o.area, false); out.labels = bool(o.labels, false); out.xTitle = str(o.xTitle, p + '.xTitle', 100, ''); out.yTitle = str(o.yTitle, p + '.yTitle', 100, '');
    if (!Array.isArray(o.categories) || !Array.isArray(o.series)) fail('Chart data missing', p);
    if (o.categories.length > 200 || o.series.length > 24 || o.categories.length * o.series.length > LIMITS.maxChartPoints) fail('Chart is too large', p);
    out.categories = o.categories.map((c, i) => str(c, `${p}.categories[${i}]`, 100));
    out.series = o.series.map((s, i) => {
      if (!isObj(s)) fail('Invalid series', `${p}.series[${i}]`);
      const vals = Array.isArray(s.values) ? s.values : [];
      const ser = { name: str(s.name, `${p}.series[${i}].name`, 100, 'Series ' + (i + 1)), values: out.categories.map((_, j) => num(vals[j], `${p}.series[${i}].values[${j}]`, { min: -1e12, max: 1e12, def: 0 })) };
      if (s.color !== undefined && s.color !== null) ser.color = color(s.color, `${p}.series[${i}].color`);
      return ser;
    });
    withVisual();
  } else if (type === 'group') {
    if (!Array.isArray(o.children) || o.children.length > LIMITS.maxObjectsPerSlide) fail('Invalid group', p + '.children');
    out.children = o.children.map((c, i) => vObject(c, `${p}.children[${i}]`, ctx, depth + 1));
  }
  return out;
}

function vTheme(t, p) {
  if (!isObj(t)) fail('Missing theme', p);
  const c = isObj(t.colors) ? t.colors : {}, f = isObj(t.fonts) ? t.fonts : {}, b = isObj(t.background) ? t.background : {};
  const colors = {};
  for (const k of ['bg', 'surface', 'text', 'muted', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6']) {
    const v = color(c[k], `${p}.colors.${k}`, '#888888');
    colors[k] = v.startsWith('@') ? '#888888' : v;
  }
  const bgType = oneOf(b.type, ['solid', 'gradient'], 'solid', p + '.background.type');
  const background = bgType === 'gradient'
    ? { type: 'gradient', colors: [color(b.colors && b.colors[0], p + '.background.colors[0]', '#ffffff'), color(b.colors && b.colors[1], p + '.background.colors[1]', '#eeeeee')], angle: num(b.angle, p + '.background.angle', { min: 0, max: 360, def: 135 }) }
    : { type: 'solid', color: color(b.color, p + '.background.color', '@bg') };
  return { id: str(t.id, p + '.id', 40, 'custom').replace(/[^\w-]/g, '') || 'custom', name: str(t.name, p + '.name', 80, 'Custom'), colors, fonts: { heading: oneOf(f.heading, FONT_KEYS, 'sans', p + '.fonts.heading'), body: oneOf(f.body, FONT_KEYS, 'sans', p + '.fonts.body') }, background };
}

export function validateDeck(raw, ctxIn) {
  if (!isObj(raw)) fail('Deck must be a JSON object', '$');
  if (own(raw, '__proto__') || own(raw, 'constructor')) fail('Forbidden key', '$');
  if (typeof raw.v === 'number' && raw.v > SCHEMA_VERSION) fail('This file was made by a newer version of Slidewise', '$.v');
  const ctx = ctxIn || { objects: 0, ids: new Set(), refs: new Set() };
  const size = isObj(raw.size) ? raw.size : {};
  const out = {
    v: SCHEMA_VERSION, id: safeId(raw.id) || uid('d'), name: str(raw.name, '$.name', LIMITS.maxNameLength, 'Untitled presentation') || 'Untitled presentation',
    createdAt: num(raw.createdAt, '$.createdAt', { min: 0, max: 8.64e15, def: Date.now() }), updatedAt: num(raw.updatedAt, '$.updatedAt', { min: 0, max: 8.64e15, def: Date.now() }),
    favorite: bool(raw.favorite), folderId: safeId(raw.folderId) || null,
    size: { w: num(size.w, '$.size.w', { min: LIMITS.minSlideSize, max: LIMITS.maxSlideSize, def: 1280 }), h: num(size.h, '$.size.h', { min: LIMITS.minSlideSize, max: LIMITS.maxSlideSize, def: 720 }) },
    theme: vTheme(raw.theme, '$.theme'), assets: {}, slides: [],
  };
  { const m = isObj(raw.master) ? raw.master : {}; out.master = { showFooter: bool(m.showFooter, false), footerText: str(m.footerText, '$.master.footerText', 200, ''), showNumber: bool(m.showNumber, false), hideOnFirst: bool(m.hideOnFirst, true) }; }
  if (!Array.isArray(raw.slides) || raw.slides.length === 0) fail('Deck has no slides', '$.slides');
  if (raw.slides.length > LIMITS.maxSlides) fail(`Too many slides (limit ${LIMITS.maxSlides})`, '$.slides');
  const slideIds = new Set();
  out.slides = raw.slides.map((s, i) => {
    const p = `$.slides[${i}]`;
    if (!isObj(s)) fail('Slide must be an object', p);
    if (!Array.isArray(s.objects) || s.objects.length > LIMITS.maxObjectsPerSlide) fail(`Too many objects on a slide (limit ${LIMITS.maxObjectsPerSlide})`, p + '.objects');
    let id = safeId(s.id); if (!id || slideIds.has(id)) id = uid('s'); slideIds.add(id);
    const tr = isObj(s.transition) ? s.transition : {};
    const bg = isObj(s.background) ? { color: color(s.background.color, p + '.background.color', '@bg') } : null;
    return { id, layout: oneOf(s.layout, LAYOUTS, 'blank', p + '.layout'), hidden: bool(s.hidden), notes: str(s.notes, p + '.notes', 50000), targetSec: Math.round(num(s.targetSec, p + '.targetSec', { min: 0, max: 3600, def: 0 })), background: bg, transition: { type: oneOf(tr.type, TRANSITIONS, 'none', p + '.transition.type'), duration: num(tr.duration, p + '.transition.duration', { min: 50, max: 5000, def: 500 }) }, objects: s.objects.map((o, j) => vObject(o, `${p}.objects[${j}]`, ctx, 0)) };
  });
  if (raw.assets !== undefined && !isObj(raw.assets)) fail('Assets must be an object', '$.assets');
  let total = 0;
  for (const [k, a] of Object.entries(raw.assets || {})) {
    const id = safeId(k); if (!id) fail('Invalid asset id', '$.assets');
    if (!ctx.refs.has(id)) continue; // unreferenced assets are dropped
    out.assets[id] = validateAssetData(a, `$.assets.${id}`);
    total += out.assets[id].data.length;
    if (total > LIMITS.maxAssetsBytes) fail('Deck images are too large in total', '$.assets');
  }
  for (const ref of ctx.refs) if (!out.assets[ref]) fail(`An image refers to missing data (${ref})`, '$.assets');
  return out;
}

export function parseDeckJson(text) {
  if (typeof text !== 'string') fail('Expected text', '$');
  if (text.length > LIMITS.maxImportFileBytes) fail('File is too large', '$');
  let raw; try { raw = JSON.parse(text); } catch { fail('Not valid JSON', '$'); }
  return validateDeck(raw);
}

// Backup file: { format: 'slidewise-backup', version: 1, exportedAt, folders: [...], decks: [deck | { locked: true, id, meta, enc }] }
export function validateLockedEntry(e, p) {
  const id = safeId(e.id); if (!id) fail('Invalid deck id', p + '.id');
  try { validateEnc(e.enc); } catch (err) { fail('Invalid encrypted deck: ' + err.message, p + '.enc'); }
  if (JSON.stringify(e.enc).length > LIMITS.maxImportFileBytes) fail('Encrypted deck is too large', p);
  const m = isObj(e.meta) ? e.meta : {};
  return { id, meta: { name: str(m.name, p + '.meta.name', LIMITS.maxNameLength, 'Locked presentation') || 'Locked presentation', createdAt: num(m.createdAt, p + '.meta.createdAt', { min: 0, max: 8.64e15, def: Date.now() }), updatedAt: num(m.updatedAt, p + '.meta.updatedAt', { min: 0, max: 8.64e15, def: Date.now() }), favorite: bool(m.favorite), folderId: safeId(m.folderId) || null, slideCount: Math.round(num(m.slideCount, p + '.meta.slideCount', { min: 0, max: LIMITS.maxSlides, def: 0 })), locked: true }, enc: { v: 1, alg: e.enc.alg, iter: e.enc.iter, salt: e.enc.salt, iv: e.enc.iv, ct: e.enc.ct } };
}
export function validateBackup(raw) {
  if (!isObj(raw) || raw.format !== 'slidewise-backup') fail('Not a Slidewise backup file', '$');
  if (raw.version !== 1) fail('Unsupported backup version', '$.version');
  if (!Array.isArray(raw.decks) || raw.decks.length > LIMITS.maxDecksInBackup) fail('Invalid deck list', '$.decks');
  const decks = [], locked = [];
  raw.decks.forEach((d, i) => {
    const p = `$.decks[${i}]`;
    if (isObj(d) && d.locked === true) { locked.push(validateLockedEntry(d, p)); return; }
    try { decks.push(validateDeck(d)); } catch (e) { throw new ValidationError(e.message, `${p}${e.path ? ' ' + e.path : ''}`); }
  });
  const folders = Array.isArray(raw.folders) ? raw.folders.slice(0, 200).filter((f) => isObj(f) && safeId(f.id)).map((f) => ({ id: safeId(f.id), name: str(f.name, '$.folders', 100, 'Folder') })) : [];
  return { decks, locked, folders };
}
