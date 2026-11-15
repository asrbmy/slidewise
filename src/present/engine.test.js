import { describe, it, expect } from 'vitest';
import { visibleSlides, animOrders, nextState, prevState, animPatch, visibleLimit, entranceObjects } from './engine.js';
import { createDeck, createSlide, createShape } from '../model/factory.js';
import * as ops from '../model/ops.js';

function mk() {
  let d = createDeck({ slides: [createSlide({ w: 1280, h: 720 }, 'blank'), createSlide({ w: 1280, h: 720 }, 'blank'), createSlide({ w: 1280, h: 720 }, 'blank')] });
  const a = createShape('rect'), b = createShape('ellipse'), c = createShape('star');
  a.anim = { type: 'fade', dir: 'left', order: 1, duration: 300 }; b.anim = { type: 'slide', dir: 'left', order: 2, duration: 300 }; c.anim = { type: 'zoom', dir: 'left', order: 2, duration: 300 };
  d = ops.addObjects(d, d.slides[0].id, [a, b, c]);
  return { d, a, b, c };
}
describe('presentation engine', () => {
  it('skips hidden slides, but falls back to all if every slide is hidden', () => {
    let { d } = mk(); d = ops.toggleHidden(d, [d.slides[1].id]);
    expect(visibleSlides(d).map((x) => x.i)).toEqual([0, 2]);
    d = ops.toggleHidden(d, d.slides.map((s) => s.id).filter((id) => id !== d.slides[1].id));
    expect(visibleSlides(d)).toHaveLength(3);
  });
  it('groups animations by order into clicks', () => {
    const { d } = mk(); expect(animOrders(d.slides[0])).toEqual([1, 2]);
    expect(entranceObjects(d.slides[0], 1)).toHaveLength(2);
    expect(visibleLimit(d.slides[0], 0)).toBe(-1); expect(visibleLimit(d.slides[0], 1)).toBe(1); expect(visibleLimit(d.slides[0], 2)).toBeGreaterThan(1e9);
  });
  it('steps through animations before changing slide, and back again', () => {
    const { d } = mk(); let st = { pos: 0, step: 0 };
    const seq = []; for (let i = 0; i < 5; i++) { st = nextState(d, st); seq.push(`${st.kind}:${st.pos}.${st.step}`); }
    expect(seq).toEqual(['step:0.1', 'step:0.2', 'slide:1.0', 'slide:2.0', 'end:2.0']);
    st = { pos: 1, step: 0 }; st = prevState(d, st); expect(st).toMatchObject({ pos: 0, step: 2 });
    st = prevState(d, st); expect(st).toMatchObject({ pos: 0, step: 1, kind: 'unstep' });
    expect(prevState(d, { pos: 0, step: 0 }).kind).toBe('start');
  });
  it('animation patches start hidden and end at the resting state', () => {
    const o = { x: 100, y: 100, w: 200, h: 100, opacity: 1, anim: { type: 'slide', dir: 'left', order: 1 } };
    const p0 = animPatch(o, 0, { w: 1280, h: 720 }), p1 = animPatch(o, 1, { w: 1280, h: 720 });
    expect(p0.opacity).toBe(0); expect(p0.x).toBeLessThan(100); expect(p1.x).toBeCloseTo(100); expect(p1.opacity).toBe(1);
    const z = animPatch({ ...o, anim: { type: 'zoom' } }, 1, { w: 1, h: 1 }); expect(z.w).toBeCloseTo(200);
    expect(animPatch({ ...o, anim: { type: 'fade' }, opacity: 0.5 }, 1, { w: 1, h: 1 }).opacity).toBeCloseTo(0.5);
  });
});
