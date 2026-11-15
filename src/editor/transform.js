// Pure geometry for dragging, snapping, resizing and rotating. All values in slide units.
const rad = (d) => (d * Math.PI) / 180;

export function computeSnap(b, others, size, threshold, enabled = true) {
  if (!enabled) return { dx: 0, dy: 0, guides: [] };
  const mineX = [b.x, b.x + b.w / 2, b.x + b.w], mineY = [b.y, b.y + b.h / 2, b.y + b.h];
  const tx = [{ v: 0, r: null }, { v: size.w / 2, r: null }, { v: size.w, r: null }];
  const ty = [{ v: 0, r: null }, { v: size.h / 2, r: null }, { v: size.h, r: null }];
  for (const o of others) { for (const v of [o.x, o.x + o.w / 2, o.x + o.w]) tx.push({ v, r: o }); for (const v of [o.y, o.y + o.h / 2, o.y + o.h]) ty.push({ v, r: o }); }
  const best = (mine, targets) => {
    let bd = Infinity, pick = null;
    for (const m of mine) for (const t of targets) { const d = t.v - m; if (Math.abs(d) < Math.abs(bd) && Math.abs(d) <= threshold) { bd = d; pick = t; } }
    return pick ? { d: bd } : { d: 0 };
  };
  const dx = best(mineX, tx).d, dy = best(mineY, ty).d;
  const guides = [];
  const nb = { x: b.x + dx, y: b.y + dy, w: b.w, h: b.h };
  const eps = 0.01;
  // A guide is drawn for every edge/centre of the moved box that lines up with a target, spanning the objects involved.
  const addGuides = (axis, mineVals, targets) => {
    for (const m of mineVals) {
      const hit = targets.filter((t) => Math.abs(t.v - m) < eps);
      if (!hit.length) continue;
      const refs = hit.map((t) => t.r).filter(Boolean);
      if (axis === 'x') {
        const ys = [nb.y, nb.y + nb.h, ...refs.flatMap((r) => [r.y, r.y + r.h])];
        guides.push({ axis, pos: m, from: refs.length ? Math.min(...ys) : 0, to: refs.length ? Math.max(...ys) : size.h });
      } else {
        const xs = [nb.x, nb.x + nb.w, ...refs.flatMap((r) => [r.x, r.x + r.w])];
        guides.push({ axis, pos: m, from: refs.length ? Math.min(...xs) : 0, to: refs.length ? Math.max(...xs) : size.w });
      }
    }
  };
  addGuides('x', [nb.x, nb.x + nb.w / 2, nb.x + nb.w], tx);
  addGuides('y', [nb.y, nb.y + nb.h / 2, nb.y + nb.h], ty);
  return { dx, dy, guides };
}

// handle = [hx, hy] with hx,hy in {-1,0,1}. start = {x,y,w,h,rot}; (dx,dy) = pointer delta in slide space.
export function resizeBox(start, handle, dx, dy, { keepAspect = false, fromCenter = false, min = 8, lineLike = false } = {}) {
  const [hx, hy] = handle;
  const a = rad(start.rot || 0), cos = Math.cos(a), sin = Math.sin(a);
  const ldx = dx * cos + dy * sin, ldy = -dx * sin + dy * cos; // pointer delta in the object's local frame
  const k = fromCenter ? 2 : 1;
  let w = start.w + hx * ldx * k, h = lineLike ? start.h : start.h + hy * ldy * k;
  if (keepAspect && hx !== 0 && hy !== 0 && start.w > 0 && start.h > 0) {
    const s = Math.max(Math.abs(w / start.w), Math.abs(h / start.h));
    w = start.w * s; h = start.h * s;
  } else if (keepAspect && start.w > 0 && start.h > 0 && (hx === 0 || hy === 0)) {
    if (hx === 0) w = start.w * (h / start.h); else h = start.h * (w / start.w);
  }
  w = Math.max(min, w); if (!lineLike) h = Math.max(min, h);
  // New centre = old centre + R * (half the growth towards the dragged side), so the opposite side stays put.
  const cx0 = start.x + start.w / 2, cy0 = start.y + start.h / 2;
  const ox = fromCenter ? 0 : hx * (w - start.w) / 2, oy = fromCenter ? 0 : hy * (h - start.h) / 2;
  const cx = cx0 + ox * cos - oy * sin, cy = cy0 + ox * sin + oy * cos;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export function rotationFromPointer(center, px, py, snap) {
  let deg = (Math.atan2(py - center.y, px - center.x) * 180) / Math.PI + 90;
  deg = ((deg % 360) + 360) % 360;
  if (snap) deg = Math.round(deg / 15) * 15 % 360;
  return Math.round(deg * 10) / 10;
}
