import { uid } from './ids.js';
import { SCHEMA_VERSION, SIZE_PRESETS } from './constants.js';
import { cloneTheme, DEFAULT_THEME_ID } from './themes.js';
import { makeTx, txFromPlain } from './text.js';
import { layoutPlaceholders } from './layouts.js';

const baseObj = (type, over) => ({ id: uid('o'), type, name: '', x: 100, y: 100, w: 300, h: 160, rot: 0, locked: false, opacity: 1, alt: '', anim: { type: 'none', dir: 'left', order: 0, duration: 500 }, ...over });
const stroke = (color = '@accent1', width = 0, dash = 'solid') => ({ color, width, dash });
const noShadow = () => ({ on: false, x: 4, y: 4, blur: 10, color: '#00000066' });

export function createTextBox(over = {}) {
  return baseObj('text', { name: 'Text box', w: 420, h: 90, fill: 'none', stroke: stroke('@muted', 0), radius: 0, shadow: noShadow(), tx: makeTx({ paras: [{ runs: [{ t: 'Text' }] }] }), ...over });
}
export function createShape(shape = 'rect', over = {}) {
  const isLine = shape === 'line';
  return baseObj('shape', {
    name: shape, shape, w: isLine ? 300 : 220, h: isLine ? 0 : 140,
    fill: isLine ? 'none' : '@accent1', stroke: isLine ? stroke('@accent1', 4) : stroke('@accent1', 0), radius: shape === 'roundRect' ? 24 : 0,
    shadow: noShadow(), tx: makeTx({ paras: [{ runs: [{ t: '' }] }], color: '#ffffff', align: 'center', valign: 'middle', size: 24 }), ...over,
  });
}
export function createImage(assetId, w, h, over = {}) {
  return baseObj('image', { name: 'Image', assetId, w, h, crop: { x: 0, y: 0, w: 1, h: 1 }, adjust: { brightness: 100, contrast: 100, saturation: 100, grayscale: 0 }, stroke: stroke('@muted', 0), radius: 0, shadow: noShadow(), ...over });
}
export function createTable(rows = 3, cols = 3, over = {}) {
  const cells = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => (r === 0 ? 'Header ' + (c + 1) : '')));
  return baseObj('table', { name: 'Table', w: 560, h: rows * 56, rows, cols, cells, colW: Array(cols).fill(1 / cols), tstyle: { headerRow: true, zebra: true, headerFill: '@accent1', headerColor: '#ffffff', border: '@muted', fill: '@surface', color: '@text', size: 20, font: '@body' }, shadow: noShadow(), ...over });
}
export function createChart(kind = 'bar', over = {}) {
  return baseObj('chart', {
    name: kind + ' chart', kind, w: 560, h: 340, title: 'Chart title', legend: true,
    categories: ['Q1', 'Q2', 'Q3', 'Q4'],
    series: [{ name: 'Series A', values: [12, 19, 8, 15] }, { name: 'Series B', values: [7, 11, 14, 9] }],
    shadow: noShadow(), ...over,
  });
}
export function createGroup(children, bounds, over = {}) {
  return baseObj('group', { name: 'Group', x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h, children, ...over });
}

export function createSlide(deckSize, layout = 'blank', opts = {}) {
  const slide = { id: uid('s'), layout, hidden: false, notes: '', background: null, transition: { type: 'none', duration: 500 }, objects: [] };
  for (const ph of layoutPlaceholders(layout, deckSize)) {
    slide.objects.push(baseObj('text', { name: ph.role[0].toUpperCase() + ph.role.slice(1), role: ph.role, prompt: ph.prompt, x: ph.x, y: ph.y, w: ph.w, h: ph.h, fill: 'none', stroke: stroke('@muted', 0), radius: 0, shadow: noShadow(), tx: ph.tx }));
  }
  if (opts.title) { const t = slide.objects.find((o) => o.role === 'title'); if (t) t.tx = { ...t.tx, paras: txFromPlain(opts.title).paras }; }
  if (opts.body) { const b = slide.objects.find((o) => o.role === 'body'); if (b) b.tx = { ...b.tx, paras: txFromPlain(opts.body).paras }; }
  if (opts.subtitle) { const s = slide.objects.find((o) => o.role === 'subtitle'); if (s) s.tx = { ...s.tx, paras: txFromPlain(opts.subtitle).paras }; }
  return slide;
}

export function createDeck({ name = 'Untitled presentation', size = SIZE_PRESETS['16:9'], themeId = DEFAULT_THEME_ID, slides = null, folderId = null } = {}) {
  const now = Date.now();
  const sz = { w: size.w, h: size.h };
  return {
    v: SCHEMA_VERSION, id: uid('d'), name, createdAt: now, updatedAt: now, favorite: false, folderId,
    size: sz, theme: cloneTheme(themeId), assets: {},
    slides: slides || [createSlide(sz, 'title', { title: 'Presentation title', subtitle: 'Subtitle' })],
  };
}
