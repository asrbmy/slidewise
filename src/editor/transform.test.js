import { describe, it, expect } from 'vitest';
import { computeSnap, resizeBox, rotationFromPointer } from './transform.js';

const size = { w: 1280, h: 720 };
describe('computeSnap', () => {
  it('snaps edges/centres to the slide and to other objects within the threshold', () => {
    let r = computeSnap({ x: 3, y: 300, w: 100, h: 50 }, [], size, 6);
    expect(r.dx).toBe(-3);
    r = computeSnap({ x: 590, y: 100, w: 100, h: 50 }, [], size, 6); // centre at 640
    expect(r.dx).toBe(0 + 0); expect(590 + 50 + r.dx).toBe(640);
    r = computeSnap({ x: 100, y: 100, w: 50, h: 50 }, [{ x: 400, y: 98, w: 80, h: 80 }], size, 6);
    expect(r.dy).toBe(-2); // top edge aligns with the other's top
    expect(r.guides.some((g) => g.axis === 'y' && g.pos === 98)).toBe(true);
  });
  it('does nothing beyond the threshold or when disabled', () => {
    expect(computeSnap({ x: 20, y: 20, w: 10, h: 10 }, [], size, 6)).toMatchObject({ dx: 0, dy: 0 });
    expect(computeSnap({ x: 3, y: 3, w: 10, h: 10 }, [], size, 6, false)).toMatchObject({ dx: 0, dy: 0, guides: [] });
  });
});

describe('resizeBox', () => {
  const s = { x: 100, y: 100, w: 200, h: 100, rot: 0 };
  it('east handle grows width and keeps the left edge fixed', () => {
    const r = resizeBox(s, [1, 0], 50, 0);
    expect(r).toMatchObject({ x: 100, y: 100, w: 250, h: 100 });
  });
  it('north-west handle keeps the opposite (SE) corner fixed', () => {
    const r = resizeBox(s, [-1, -1], -40, -20);
    expect(r.x + r.w).toBeCloseTo(300); expect(r.y + r.h).toBeCloseTo(200);
    expect(r.w).toBe(240); expect(r.h).toBe(120);
  });
  it('keeps the opposite corner fixed even when rotated', () => {
    const rot = { ...s, rot: 90 };
    const corner = (b, rr, lx, ly) => { const a = (rr * Math.PI) / 180, cx = b.x + b.w / 2, cy = b.y + b.h / 2; return { x: cx + lx * Math.cos(a) - ly * Math.sin(a), y: cy + lx * Math.sin(a) + ly * Math.cos(a) }; };
    const before = corner(rot, 90, -rot.w / 2, -rot.h / 2); // NW anchor when dragging SE
    const r = resizeBox(rot, [1, 1], 30, 60);
    const after = corner(r, 90, -r.w / 2, -r.h / 2);
    expect(after.x).toBeCloseTo(before.x); expect(after.y).toBeCloseTo(before.y);
  });
  it('preserves aspect ratio with a corner handle and enforces a minimum', () => {
    const r = resizeBox(s, [1, 1], 100, 0, { keepAspect: true });
    expect(r.w / r.h).toBeCloseTo(2);
    expect(resizeBox(s, [1, 1], -1000, -1000).w).toBe(8);
  });
  it('resizes from the centre with alt', () => {
    const r = resizeBox(s, [1, 0], 20, 0, { fromCenter: true });
    expect(r.w).toBe(240); expect(r.x + r.w / 2).toBeCloseTo(200);
  });
  it('lines only change width', () => {
    const line = { x: 0, y: 50, w: 300, h: 0, rot: 0 };
    expect(resizeBox(line, [1, 1], 20, 80, { lineLike: true }).h).toBe(0);
  });
});

describe('rotationFromPointer', () => {
  it('is 0 when the pointer is straight above and snaps to 15 degrees with shift', () => {
    expect(rotationFromPointer({ x: 100, y: 100 }, 100, 0)).toBe(0);
    expect(rotationFromPointer({ x: 100, y: 100 }, 200, 100)).toBe(90);
    expect(rotationFromPointer({ x: 100, y: 100 }, 200, 90, true) % 15).toBe(0);
  });
});
