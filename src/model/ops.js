// Pure, immutable operations on a deck. Every function returns a NEW deck (structural sharing) and never mutates its input.
import { uid } from './ids.js';
import { createSlide, createGroup } from './factory.js';
import { layoutPlaceholders } from './layouts.js';
import { cloneTheme } from './themes.js';
import { bounds, unionBounds, clamp } from './geometry.js';
import { parasToPlain, replaceInTx, countInText } from './text.js';
import { LIMITS } from './constants.js';

const touch = (deck) => ({ ...deck, updatedAt: Date.now() });
export const slideIndex = (deck, id) => deck.slides.findIndex((s) => s.id === id);
export const getSlide = (deck, id) => deck.slides.find((s) => s.id === id) || null;

// ---------- deep clone with fresh ids ----------
export function cloneObject(o) {
  const c = JSON.parse(JSON.stringify(o));
  const refresh = (x) => { x.id = uid('o'); if (x.children) x.children.forEach(refresh); };
  refresh(c);
  return c;
}
export function cloneSlide(s) {
  const c = JSON.parse(JSON.stringify(s));
  c.id = uid('s');
  c.objects.forEach(function refresh(x) { x.id = uid('o'); if (x.children) x.children.forEach(refresh); });
  return c;
}
export function countObjects(objs) { return objs.reduce((n, o) => n + 1 + (o.children ? countObjects(o.children) : 0), 0); }
export function deckObjectCount(deck) { return deck.slides.reduce((n, s) => n + countObjects(s.objects), 0); }

// ---------- slides ----------
function mapSlide(deck, id, fn) {
  const i = slideIndex(deck, id);
  if (i < 0) return deck;
  const next = fn(deck.slides[i]);
  if (next === deck.slides[i]) return deck;
  const slides = deck.slides.slice(); slides[i] = next;
  return touch({ ...deck, slides });
}
export function updateSlide(deck, id, patchOrFn) {
  return mapSlide(deck, id, (s) => ({ ...s, ...(typeof patchOrFn === 'function' ? patchOrFn(s) : patchOrFn) }));
}
export function addSlide(deck, afterIndex = deck.slides.length - 1, layout = 'titleContent') {
  if (deck.slides.length >= LIMITS.maxSlides) return deck;
  const slide = createSlide(deck.size, layout);
  const slides = deck.slides.slice();
  slides.splice(afterIndex + 1, 0, slide);
  return touch({ ...deck, slides });
}
export function duplicateSlides(deck, ids) {
  const set = new Set(ids);
  const slides = [];
  for (const s of deck.slides) { slides.push(s); if (set.has(s.id) && slides.length < LIMITS.maxSlides) slides.push(cloneSlide(s)); }
  return touch({ ...deck, slides });
}
export function deleteSlides(deck, ids) {
  const set = new Set(ids);
  const slides = deck.slides.filter((s) => !set.has(s.id));
  if (!slides.length) return deck; // a deck always keeps one slide
  return touch({ ...deck, slides });
}
export function moveSlides(deck, ids, toIndex) {
  const set = new Set(ids);
  const moving = deck.slides.filter((s) => set.has(s.id));
  if (!moving.length) return deck;
  const before = deck.slides.slice(0, toIndex).filter((s) => !set.has(s.id)).length;
  const rest = deck.slides.filter((s) => !set.has(s.id));
  rest.splice(before, 0, ...moving);
  if (rest.every((s, i) => s === deck.slides[i])) return deck;
  return touch({ ...deck, slides: rest });
}
export function toggleHidden(deck, ids) {
  const set = new Set(ids);
  const allHidden = deck.slides.filter((s) => set.has(s.id)).every((s) => s.hidden);
  return touch({ ...deck, slides: deck.slides.map((s) => (set.has(s.id) ? { ...s, hidden: !allHidden } : s)) });
}
export function pasteSlides(deck, slides, afterIndex) {
  const room = LIMITS.maxSlides - deck.slides.length;
  const add = slides.slice(0, room).map(cloneSlide);
  const out = deck.slides.slice(); out.splice(afterIndex + 1, 0, ...add);
  return touch({ ...deck, slides: out });
}

// ---------- objects ----------
function mapObjects(list, ids, fn) {
  let changed = false;
  const out = list.map((o) => { if (ids.has(o.id)) { const n = fn(o); if (n !== o) changed = true; return n; } return o; });
  return changed ? out : list;
}
export function scaleGroupChildren(children, sx, sy) {
  return children.map((c) => ({ ...c, x: c.x * sx, y: c.y * sy, w: c.w * sx, h: c.h * sy, ...(c.children ? { children: scaleGroupChildren(c.children, sx, sy) } : {}) }));
}
export function patchObject(o, patch) {
  const next = { ...o, ...patch };
  if (o.type === 'group' && ('w' in patch || 'h' in patch) && o.w > 0 && o.h > 0) {
    next.children = scaleGroupChildren(o.children, next.w / o.w, next.h / o.h);
  }
  return next;
}
export function updateObjects(deck, slideId, ids, patchOrFn) {
  const set = new Set(ids);
  return mapSlide(deck, slideId, (s) => {
    const objects = mapObjects(s.objects, set, (o) => patchObject(o, typeof patchOrFn === 'function' ? patchOrFn(o) : patchOrFn));
    return objects === s.objects ? s : { ...s, objects };
  });
}
export function addObjects(deck, slideId, objs) {
  return mapSlide(deck, slideId, (s) => {
    if (s.objects.length + objs.length > LIMITS.maxObjectsPerSlide) return s;
    return { ...s, objects: [...s.objects, ...objs] };
  });
}
export function deleteObjects(deck, slideId, ids) {
  const set = new Set(ids);
  return mapSlide(deck, slideId, (s) => {
    const objects = s.objects.filter((o) => !set.has(o.id));
    return objects.length === s.objects.length ? s : { ...s, objects };
  });
}
export function reorderZ(deck, slideId, ids, mode) {
  const set = new Set(ids);
  return mapSlide(deck, slideId, (s) => {
    let objs = s.objects.slice();
    const sel = objs.filter((o) => set.has(o.id));
    if (!sel.length) return s;
    if (mode === 'front') objs = [...objs.filter((o) => !set.has(o.id)), ...sel];
    else if (mode === 'back') objs = [...sel, ...objs.filter((o) => !set.has(o.id))];
    else if (mode === 'forward') { for (let i = objs.length - 2; i >= 0; i--) if (set.has(objs[i].id) && !set.has(objs[i + 1].id)) [objs[i], objs[i + 1]] = [objs[i + 1], objs[i]]; }
    else if (mode === 'backward') { for (let i = 1; i < objs.length; i++) if (set.has(objs[i].id) && !set.has(objs[i - 1].id)) [objs[i], objs[i - 1]] = [objs[i - 1], objs[i]]; }
    return objs.every((o, i) => o === s.objects[i]) ? s : { ...s, objects: objs };
  });
}

// ---------- grouping ----------
export function groupObjects(deck, slideId, ids) {
  let newId = null;
  const next = mapSlide(deck, slideId, (s) => {
    const sel = s.objects.filter((o) => ids.includes(o.id));
    if (sel.length < 2) return s;
    const b = unionBounds(sel);
    const children = sel.map((o) => ({ ...o, x: o.x - b.x, y: o.y - b.y }));
    const g = createGroup(children, b);
    newId = g.id;
    const lastIdx = Math.max(...sel.map((o) => s.objects.indexOf(o)));
    const rest = s.objects.filter((o) => !ids.includes(o.id));
    const insertAt = rest.filter((o) => s.objects.indexOf(o) < lastIdx).length;
    rest.splice(Math.min(insertAt, rest.length), 0, g);
    return { ...s, objects: rest };
  });
  return { deck: next, groupId: newId };
}
export function ungroupObjects(deck, slideId, ids) {
  const freed = [];
  const next = mapSlide(deck, slideId, (s) => {
    const objects = [];
    for (const o of s.objects) {
      if (ids.includes(o.id) && o.type === 'group') {
        const a = ((o.rot || 0) * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
        const gcx = o.x + o.w / 2, gcy = o.y + o.h / 2;
        for (const ch of o.children) {
          const dx = ch.x + ch.w / 2 - o.w / 2, dy = ch.y + ch.h / 2 - o.h / 2;
          const cx = gcx + dx * c - dy * sn, cy = gcy + dx * sn + dy * c;
          const out = { ...ch, x: cx - ch.w / 2, y: cy - ch.h / 2, rot: ((ch.rot || 0) + (o.rot || 0)) % 360, opacity: (ch.opacity ?? 1) * (o.opacity ?? 1) };
          objects.push(out); freed.push(out.id);
        }
      } else objects.push(o);
    }
    return { ...s, objects };
  });
  return { deck: next, freedIds: freed };
}

// ---------- align / distribute (on rotated bounds) ----------
export function alignObjects(deck, slideId, ids, mode, relativeTo = 'selection') {
  return mapSlide(deck, slideId, (s) => {
    const sel = s.objects.filter((o) => ids.includes(o.id) && !o.locked);
    if (!sel.length) return s;
    const frame = relativeTo === 'slide' || sel.length === 1 ? { x: 0, y: 0, w: deck.size.w, h: deck.size.h } : unionBounds(sel);
    const set = new Set(sel.map((o) => o.id));
    return { ...s, objects: s.objects.map((o) => {
      if (!set.has(o.id)) return o;
      const b = bounds(o); let dx = 0, dy = 0;
      if (mode === 'left') dx = frame.x - b.x;
      if (mode === 'center') dx = frame.x + frame.w / 2 - (b.x + b.w / 2);
      if (mode === 'right') dx = frame.x + frame.w - (b.x + b.w);
      if (mode === 'top') dy = frame.y - b.y;
      if (mode === 'middle') dy = frame.y + frame.h / 2 - (b.y + b.h / 2);
      if (mode === 'bottom') dy = frame.y + frame.h - (b.y + b.h);
      return dx || dy ? { ...o, x: o.x + dx, y: o.y + dy } : o;
    }) };
  });
}
export function distributeObjects(deck, slideId, ids, axis) {
  return mapSlide(deck, slideId, (s) => {
    const sel = s.objects.filter((o) => ids.includes(o.id) && !o.locked);
    if (sel.length < 3) return s;
    const items = sel.map((o) => ({ o, b: bounds(o) })).sort((a, b) => (axis === 'h' ? a.b.x - b.b.x : a.b.y - b.b.y));
    const first = items[0].b, last = items[items.length - 1].b;
    const total = items.reduce((n, it) => n + (axis === 'h' ? it.b.w : it.b.h), 0);
    const span = axis === 'h' ? last.x + last.w - first.x : last.y + last.h - first.y;
    const gap = (span - total) / (items.length - 1);
    const shift = new Map();
    let cursor = axis === 'h' ? first.x : first.y;
    for (const it of items) { shift.set(it.o.id, cursor - (axis === 'h' ? it.b.x : it.b.y)); cursor += (axis === 'h' ? it.b.w : it.b.h) + gap; }
    return { ...s, objects: s.objects.map((o) => (shift.has(o.id) ? { ...o, [axis === 'h' ? 'x' : 'y']: o[axis === 'h' ? 'x' : 'y'] + shift.get(o.id) } : o)) };
  });
}

// ---------- layout, theme, size ----------
export function applyLayout(deck, slideId, layout) {
  return mapSlide(deck, slideId, (s) => {
    const phs = layoutPlaceholders(layout, deck.size);
    const old = s.objects.filter((o) => o.role);
    const others = s.objects.filter((o) => !o.role);
    const used = new Set();
    const placeholders = phs.map((ph) => {
      const match = old.find((o) => o.role === ph.role && !used.has(o.id)) || old.find((o) => !used.has(o.id) && (o.role === 'body' || o.role === 'body2') && (ph.role === 'body' || ph.role === 'body2'));
      if (match) used.add(match.id);
      const base = match ? { ...match } : { id: uid('o'), type: 'text', name: ph.role, anim: { type: 'none', dir: 'left', order: 0, duration: 500 }, locked: false, opacity: 1, rot: 0, alt: '', fill: 'none', stroke: { color: '@muted', width: 0, dash: 'solid' }, radius: 0, shadow: { on: false, x: 4, y: 4, blur: 10, color: '#00000066' } };
      const keepText = match && parasToPlain(match.tx.paras).trim() !== '';
      return { ...base, role: ph.role, prompt: ph.prompt, x: ph.x, y: ph.y, w: ph.w, h: ph.h, rot: 0, tx: keepText ? { ...ph.tx, paras: match.tx.paras } : ph.tx };
    });
    // Old placeholders that did not map and contain text are kept as plain text boxes so no content is lost.
    const orphans = old.filter((o) => !used.has(o.id) && parasToPlain(o.tx.paras).trim() !== '').map((o) => { const { role, prompt, ...rest } = o; return rest; });
    return { ...s, layout, objects: [...placeholders, ...others, ...orphans] };
  });
}
export function setTheme(deck, themeId) { return touch({ ...deck, theme: cloneTheme(themeId) }); }
export function setThemePart(deck, patch) { return touch({ ...deck, theme: { ...deck.theme, ...patch, id: 'custom', name: 'Custom' } }); }
export function setPaletteColor(deck, key, value) { return setThemePart(deck, { colors: { ...deck.theme.colors, [key]: value } }); }
export function resizeDeck(deck, size, scaleContent = true) {
  const sx = size.w / deck.size.w, sy = size.h / deck.size.h, sf = Math.min(sx, sy);
  const scaleObj = (o) => ({ ...o, x: o.x * sx, y: o.y * sy, w: o.w * sx, h: o.h * sy, ...(o.tx ? { tx: { ...o.tx, size: Math.round(o.tx.size * sf) } } : {}), ...(o.children ? { children: scaleGroupChildren(o.children, sx, sy) } : {}) });
  if (!scaleContent) return touch({ ...deck, size: { ...size } });
  return touch({ ...deck, size: { ...size }, slides: deck.slides.map((s) => ({ ...s, objects: s.objects.map(scaleObj) })) });
}
export function clampSize(size) {
  return { w: Math.round(clamp(size.w, LIMITS.minSlideSize, LIMITS.maxSlideSize)), h: Math.round(clamp(size.h, LIMITS.minSlideSize, LIMITS.maxSlideSize)) };
}

// ---------- find & replace ----------
export function* walkTexts(objs) {
  for (const o of objs) {
    if (o.type === 'group') yield* walkTexts(o.children);
    else yield o;
  }
}
export function objectSearchText(o) {
  const parts = [];
  if (o.tx) parts.push(parasToPlain(o.tx.paras));
  if (o.type === 'table') parts.push(...o.cells.flat());
  if (o.type === 'chart') parts.push(o.title || '', ...o.categories, ...o.series.map((s) => s.name));
  return parts.join('\n');
}
export function findMatches(deck, find, opts = {}) {
  const out = [];
  if (!find) return out;
  deck.slides.forEach((s, si) => {
    let count = 0;
    for (const o of walkTexts(s.objects)) count += countInText(objectSearchText(o), find, opts.matchCase);
    if (opts.notes) count += countInText(s.notes || '', find, opts.matchCase);
    if (count) out.push({ slideId: s.id, index: si, count });
  });
  return out;
}
export function replaceAll(deck, find, repl, opts = {}) {
  if (!find) return { deck, count: 0 };
  let total = 0;
  const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), opts.matchCase ? 'g' : 'gi');
  const str = (t) => t.replace(re, () => { total++; return repl; });
  const mapObj = (o) => {
    if (o.type === 'group') { const children = o.children.map(mapObj); return children.some((c, i) => c !== o.children[i]) ? { ...o, children } : o; }
    let n = o;
    if (o.tx) { const r = replaceInTx(o.tx, find, repl, opts); if (r.count) { total += r.count; n = { ...n, tx: r.tx }; } }
    if (o.type === 'table') { const cells = o.cells.map((row) => row.map(str)); n = { ...n, cells }; }
    if (o.type === 'chart') n = { ...n, title: str(o.title || ''), categories: o.categories.map(str), series: o.series.map((s) => ({ ...s, name: str(s.name) })) };
    return n;
  };
  const slides = deck.slides.map((s) => {
    const objects = s.objects.map(mapObj);
    const notes = opts.notes ? str(s.notes || '') : s.notes;
    const changed = notes !== s.notes || objects.some((o, i) => o !== s.objects[i]);
    return changed ? { ...s, objects, notes } : s;
  });
  return { deck: total ? touch({ ...deck, slides }) : deck, count: total };
}

// ---------- assets ----------
export function usedAssetIds(deck) {
  const ids = new Set();
  const visit = (objs) => objs.forEach((o) => { if (o.assetId) ids.add(o.assetId); if (o.children) visit(o.children); });
  deck.slides.forEach((s) => { visit(s.objects); if (s.background && s.background.assetId) ids.add(s.background.assetId); });
  return ids;
}
export function pruneAssets(deck) {
  const used = usedAssetIds(deck);
  const assets = {};
  for (const [k, v] of Object.entries(deck.assets || {})) if (used.has(k)) assets[k] = v;
  return Object.keys(assets).length === Object.keys(deck.assets || {}).length ? deck : { ...deck, assets };
}
export function addAsset(deck, id, asset) { return { ...deck, assets: { ...deck.assets, [id]: asset } }; }
export function assetBytes(deck) { return Object.values(deck.assets || {}).reduce((n, a) => n + (a.data ? a.data.length : 0), 0); }

export const rename = (deck, name) => touch({ ...deck, name: String(name).slice(0, LIMITS.maxNameLength) || 'Untitled presentation' });
