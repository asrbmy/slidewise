// Shape path builders in local box coordinates (0,0)-(w,h).
export function roundRectPath(ctx, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(rr, 0); ctx.lineTo(w - rr, 0); ctx.arcTo(w, 0, w, rr, rr); ctx.lineTo(w, h - rr); ctx.arcTo(w, h, w - rr, h, rr);
  ctx.lineTo(rr, h); ctx.arcTo(0, h, 0, h - rr, rr); ctx.lineTo(0, rr); ctx.arcTo(0, 0, rr, 0, rr); ctx.closePath();
}
export function starPoints(w, h, points = 5, inner = 0.4) {
  const cx = w / 2, cy = h / 2, pts = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? 1 : inner, a = -Math.PI / 2 + (i * Math.PI) / points;
    pts.push([cx + Math.cos(a) * (w / 2) * r, cy + Math.sin(a) * (h / 2) * r]);
  }
  return pts;
}
export function arrowPoints(w, h) {
  const head = Math.min(w * 0.45, h * 0.9), shaft = h * 0.34;
  return [[0, h / 2 - shaft / 2], [w - head, h / 2 - shaft / 2], [w - head, 0], [w, h / 2], [w - head, h], [w - head, h / 2 + shaft / 2], [0, h / 2 + shaft / 2]];
}
export function trianglePoints(w, h) { return [[w / 2, 0], [w, h], [0, h]]; }
export function polyPath(ctx, pts) { ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); }
export function buildShapePath(ctx, shape, w, h, radius) {
  ctx.beginPath();
  switch (shape) {
    case 'ellipse': ctx.ellipse(w / 2, h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2); break;
    case 'triangle': polyPath(ctx, trianglePoints(w, h)); break;
    case 'arrow': polyPath(ctx, arrowPoints(w, h)); break;
    case 'star': polyPath(ctx, starPoints(w, h)); break;
    case 'roundRect': roundRectPath(ctx, w, h, radius || Math.min(w, h) * 0.2); break;
    case 'line': ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); break;
    default: if (radius) roundRectPath(ctx, w, h, radius); else ctx.rect(0, 0, w, h);
  }
}
// SVG path data for the same shapes (used by the DOM overlay outlines and HTML export if needed).
export function shapeSvgPoints(shape, w, h) {
  const f = (pts) => pts.map((p) => p.map((n) => +n.toFixed(2)).join(',')).join(' ');
  if (shape === 'triangle') return f(trianglePoints(w, h));
  if (shape === 'arrow') return f(arrowPoints(w, h));
  if (shape === 'star') return f(starPoints(w, h));
  return null;
}
