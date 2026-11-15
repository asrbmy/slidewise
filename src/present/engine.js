import { patchObject } from '../model/ops.js';

export const easeOut = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
export function visibleSlides(deck) {
  const vis = deck.slides.map((s, i) => ({ s, i })).filter((x) => !x.s.hidden);
  return vis.length ? vis : deck.slides.map((s, i) => ({ s, i }));
}
// Distinct animation orders on a slide, ascending. Each is one "click".
export function animOrders(slide) {
  return Array.from(new Set(slide.objects.filter((o) => o.anim && o.anim.type !== 'none').map((o) => o.anim.order))).sort((a, b) => a - b);
}
// Objects whose order is greater than `shownOrder` are hidden. step k => shownOrder = orders[k-1] (or -1 when k=0).
export function shownOrderForStep(slide, step) {
  if (step >= animOrders(slide).length) return Infinity;
  const o = animOrders(slide); return step === 0 ? -1 : o[step - 1];
}
// visibleCount semantic of drawSlide: skip objects with anim.type!=none and order > limit.
export function visibleLimit(slide, step) { const s = shownOrderForStep(slide, step); return s === Infinity ? Number.MAX_SAFE_INTEGER : s; }
export function entranceObjects(slide, step) { const o = animOrders(slide); const ord = o[step]; return ord === undefined ? [] : slide.objects.filter((x) => x.anim.type !== 'none' && x.anim.order === ord); }

// Returns a patch to apply to object `o` at progress t (0..1) of its entrance animation.
export function animPatch(o, t, size) {
  const e = easeOut(t); const a = o.anim;
  const op = (o.opacity ?? 1);
  if (a.type === 'fade') return { opacity: op * e };
  if (a.type === 'slide') {
    const d = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[a.dir] || [-1, 0];
    const dist = 0.35; return { opacity: op * Math.min(1, e * 1.5), x: o.x + d[0] * size.w * dist * (1 - e), y: o.y + d[1] * size.h * dist * (1 - e) };
  }
  if (a.type === 'zoom') { const k = 0.2 + 0.8 * e; return { opacity: op * Math.min(1, e * 1.4), x: o.x + (o.w * (1 - k)) / 2, y: o.y + (o.h * (1 - k)) / 2, w: o.w * k, h: o.h * k }; }
  return {};
}
export function applyAnimPatch(o, patch) { return patchObject(o, patch); }

// Composite two rendered slide canvases for a transition. `dir` 1 = forward, -1 = backward.
export function drawTransition(ctx, from, to, type, t, w, h, dir = 1) {
  const e = easeOut(t);
  ctx.save(); ctx.clearRect(0, 0, w, h);
  if (type === 'slide') {
    const off = w * (1 - e) * dir; ctx.drawImage(from, -w * e * dir, 0, w, h); ctx.drawImage(to, off, 0, w, h);
  } else if (type === 'zoom') {
    ctx.drawImage(from, 0, 0, w, h); ctx.globalAlpha = e; const k = 0.8 + 0.2 * e; ctx.drawImage(to, (w * (1 - k)) / 2, (h * (1 - k)) / 2, w * k, h * k);
  } else { ctx.drawImage(from, 0, 0, w, h); ctx.globalAlpha = e; ctx.drawImage(to, 0, 0, w, h); }
  ctx.restore();
}
export const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// Navigation state machine (pure) so it can be unit-tested. state = { pos, step }; pos indexes visibleSlides(deck).
export function nextState(deck, st) {
  const vis = visibleSlides(deck); const slide = vis[st.pos].s; const n = animOrders(slide).length;
  if (st.step < n) return { pos: st.pos, step: st.step + 1, kind: 'step' };
  if (st.pos < vis.length - 1) return { pos: st.pos + 1, step: 0, kind: 'slide' };
  return { ...st, kind: 'end' };
}
export function prevState(deck, st) {
  const vis = visibleSlides(deck);
  if (st.step > 0) return { pos: st.pos, step: st.step - 1, kind: 'unstep' };
  if (st.pos > 0) { const p = vis[st.pos - 1].s; return { pos: st.pos - 1, step: animOrders(p).length, kind: 'slide' }; }
  return { ...st, kind: 'start' };
}
