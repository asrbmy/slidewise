// Undo/redo over immutable deck snapshots. Snapshots share structure, so memory stays small.
// Consecutive commits with the same coalesce key within `windowMs` collapse into one undo step (typing, nudging, dragging).
export function createHistory(initial, { limit = 200, windowMs = 800 } = {}) {
  return { past: [], present: initial, future: [], limit, windowMs, lastKey: null, lastAt: 0 };
}
export function commit(h, next, key = null, now = Date.now()) {
  if (next === h.present) return h;
  const coalesce = key && h.lastKey === key && now - h.lastAt < h.windowMs && h.past.length > 0;
  const past = coalesce ? h.past : [...h.past, h.present].slice(-h.limit);
  return { ...h, past, present: next, future: [], lastKey: key, lastAt: now };
}
export function undo(h) {
  if (!h.past.length) return h;
  const prev = h.past[h.past.length - 1];
  return { ...h, past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future], lastKey: null };
}
export function redo(h) {
  if (!h.future.length) return h;
  const [next, ...rest] = h.future;
  return { ...h, past: [...h.past, h.present], present: next, future: rest, lastKey: null };
}
export const canUndo = (h) => h.past.length > 0;
export const canRedo = (h) => h.future.length > 0;
// Replace the present without recording history (e.g. when reloading a deck or restoring a stored version).
export function reset(h, deck) { return { ...h, past: [], present: deck, future: [], lastKey: null }; }
