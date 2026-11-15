const rad = (d) => (d * Math.PI) / 180;
export function corners(o) {
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2, a = rad(o.rot || 0), c = Math.cos(a), s = Math.sin(a);
  return [[-o.w / 2, -o.h / 2], [o.w / 2, -o.h / 2], [o.w / 2, o.h / 2], [-o.w / 2, o.h / 2]].map(([dx, dy]) => ({ x: cx + dx * c - dy * s, y: cy + dx * s + dy * c }));
}
export function bounds(o) {
  const cs = corners(o);
  const xs = cs.map((p) => p.x), ys = cs.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
export function unionBounds(objs) {
  if (!objs.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const o of objs) { const b = bounds(o); x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y); x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h); }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
export function rectsIntersect(a, b) { return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y; }
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const round1 = (v) => Math.round(v * 10) / 10;
export function pointInObject(o, px, py) {
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2, a = -rad(o.rot || 0);
  const dx = px - cx, dy = py - cy;
  const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
  const pad = o.h < 8 ? 6 : 0; // thin lines get a forgiving hit area
  return Math.abs(lx) <= o.w / 2 + pad && Math.abs(ly) <= o.h / 2 + pad;
}
