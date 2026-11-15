import { describe, it, expect } from 'vitest';
import { createDeck, createSlide, createShape, createTextBox, createTable, createChart, createImage } from './factory.js';
import * as ops from './ops.js';
import { createHistory, commit, undo, redo, canUndo, canRedo } from './history.js';
import { bounds } from './geometry.js';
import { applyTextFormat, txFromPlain, parasToPlain, safeLink } from './text.js';
import { THEMES } from './themes.js';
import { LAYOUTS } from './constants.js';

const mkDeck = () => createDeck({ name: 'T' });

describe('factory & themes', () => {
  it('creates a valid deck with a title slide', () => {
    const d = mkDeck();
    expect(d.slides).toHaveLength(1);
    expect(d.slides[0].objects.map((o) => o.role)).toEqual(['title', 'subtitle']);
    expect(d.size).toEqual({ w: 1280, h: 720 });
  });
  it('ships at least six themes with complete palettes', () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(6);
    for (const t of THEMES) for (const k of ['bg', 'surface', 'text', 'muted', 'accent1', 'accent6']) expect(t.colors[k]).toMatch(/^#/);
  });
  it('every layout builds placeholders inside the slide', () => {
    for (const l of LAYOUTS) {
      const s = createSlide({ w: 1280, h: 720 }, l);
      for (const o of s.objects) { expect(o.x).toBeGreaterThanOrEqual(0); expect(o.x + o.w).toBeLessThanOrEqual(1280); expect(o.y + o.h).toBeLessThanOrEqual(720); }
    }
    expect(createSlide({ w: 1280, h: 720 }, 'blank').objects).toHaveLength(0);
  });
});

describe('slide ops', () => {
  it('adds, duplicates (fresh ids), hides, moves and deletes', () => {
    let d = mkDeck();
    d = ops.addSlide(d, 0, 'titleContent');
    d = ops.addSlide(d, 1, 'blank');
    expect(d.slides).toHaveLength(3);
    const first = d.slides[0];
    d = ops.duplicateSlides(d, [first.id]);
    expect(d.slides).toHaveLength(4);
    expect(d.slides[1].id).not.toBe(first.id);
    expect(d.slides[1].objects[0].id).not.toBe(first.objects[0].id);
    d = ops.toggleHidden(d, [d.slides[1].id]);
    expect(d.slides[1].hidden).toBe(true);
    const ids = d.slides.map((s) => s.id);
    d = ops.moveSlides(d, [ids[3]], 0);
    expect(d.slides[0].id).toBe(ids[3]);
    d = ops.deleteSlides(d, [ids[0], ids[1]]);
    expect(d.slides).toHaveLength(2);
  });
  it('never deletes the last slide', () => {
    const d = mkDeck();
    expect(ops.deleteSlides(d, [d.slides[0].id]).slides).toHaveLength(1);
  });
  it('does not mutate its input', () => {
    const d = mkDeck();
    const snap = JSON.stringify(d);
    ops.addSlide(d); ops.setTheme(d, 'midnight'); ops.duplicateSlides(d, [d.slides[0].id]);
    expect(JSON.stringify(d)).toBe(snap);
  });
});

describe('object ops', () => {
  const setup = () => {
    let d = mkDeck(); const sid = d.slides[0].id;
    const a = createShape('rect', { x: 0, y: 0, w: 100, h: 100 }), b = createShape('ellipse', { x: 300, y: 50, w: 100, h: 100 }), c = createShape('star', { x: 600, y: 200, w: 100, h: 100 });
    d = ops.addObjects(d, sid, [a, b, c]);
    return { d, sid, a, b, c };
  };
  it('updates, z-orders and deletes', () => {
    let { d, sid, a, b, c } = setup();
    d = ops.updateObjects(d, sid, [a.id], { x: 50 });
    expect(d.slides[0].objects.find((o) => o.id === a.id).x).toBe(50);
    const order = () => d.slides[0].objects.map((o) => o.id);
    d = ops.reorderZ(d, sid, [a.id], 'front'); expect(order().at(-1)).toBe(a.id);
    d = ops.reorderZ(d, sid, [a.id], 'back'); expect(order()[0]).toBe(a.id);
    d = ops.reorderZ(d, sid, [a.id], 'forward'); expect(order().indexOf(a.id)).toBe(1);
    d = ops.reorderZ(d, sid, [a.id], 'backward'); expect(order()[0]).toBe(a.id);
    d = ops.deleteObjects(d, sid, [b.id, c.id]);
    expect(d.slides[0].objects.filter((o) => !o.role)).toHaveLength(1);
  });
  it('aligns and distributes using rotated bounds', () => {
    let { d, sid, a, b, c } = setup();
    d = ops.alignObjects(d, sid, [a.id, b.id, c.id], 'left');
    for (const id of [a.id, b.id, c.id]) expect(d.slides[0].objects.find((o) => o.id === id).x).toBe(0);
    d = ops.alignObjects(d, sid, [a.id, b.id, c.id], 'top');
    for (const id of [a.id, b.id, c.id]) expect(d.slides[0].objects.find((o) => o.id === id).y).toBe(0);
    let s2 = setup();
    let dd = ops.updateObjects(s2.d, s2.sid, [s2.b.id], { x: 150 });
    dd = ops.distributeObjects(dd, s2.sid, [s2.a.id, s2.b.id, s2.c.id], 'h');
    const xs = [s2.a.id, s2.b.id, s2.c.id].map((id) => dd.slides[0].objects.find((o) => o.id === id).x);
    expect(xs[1] - (xs[0] + 100)).toBeCloseTo(xs[2] - (xs[1] + 100));
    const rot = { x: 0, y: 0, w: 200, h: 100, rot: 90 };
    const bb = bounds(rot);
    expect(bb.w).toBeCloseTo(100); expect(bb.h).toBeCloseTo(200);
  });
  it('groups and ungroups preserving position, scaling children on resize', () => {
    let { d, sid, a, b } = setup();
    const r = ops.groupObjects(d, sid, [a.id, b.id]);
    d = r.deck;
    const g = d.slides[0].objects.find((o) => o.id === r.groupId);
    expect(g.type).toBe('group'); expect(g.children).toHaveLength(2);
    expect(g.x).toBe(0); expect(g.w).toBe(400);
    d = ops.updateObjects(d, sid, [g.id], { w: 800 });
    expect(d.slides[0].objects.find((o) => o.id === g.id).children[1].x).toBe(600);
    const u = ops.ungroupObjects(d, sid, [g.id]);
    const freed = u.deck.slides[0].objects.filter((o) => u.freedIds.includes(o.id));
    expect(freed).toHaveLength(2);
    expect(freed.find((o) => o.shape === 'ellipse').x).toBeCloseTo(600);
  });
  it('ungroup of a rotated group keeps child centres on the right circle', () => {
    let { d, sid, a, b } = setup();
    let r = ops.groupObjects(d, sid, [a.id, b.id]); d = r.deck;
    d = ops.updateObjects(d, sid, [r.groupId], { rot: 180 });
    const g = d.slides[0].objects.find((o) => o.id === r.groupId);
    const u = ops.ungroupObjects(d, sid, [g.id]);
    const ell = u.deck.slides[0].objects.find((o) => o.shape === 'ellipse');
    expect(ell.x + ell.w / 2).toBeCloseTo(0 + 200 - (350 - 200) + 0, 0); // mirrored about the group centre (200, 75)
    expect(ell.rot).toBe(180);
  });
  it('applies a layout without losing text', () => {
    let d = mkDeck(); const sid = d.slides[0].id;
    d = ops.updateObjects(d, sid, [d.slides[0].objects[0].id], (o) => ({ tx: { ...o.tx, paras: txFromPlain('Hello').paras } }));
    d = ops.applyLayout(d, sid, 'twoColumn');
    expect(d.slides[0].layout).toBe('twoColumn');
    expect(d.slides[0].objects.map((o) => o.role)).toEqual(['title', 'body', 'body2', undefined]); // the old subtitle had text, so it survives as a plain text box
    expect(parasToPlain(d.slides[0].objects[3].tx.paras)).toBe('Subtitle');
    expect(parasToPlain(d.slides[0].objects[0].tx.paras)).toBe('Hello');
    d = ops.applyLayout(d, sid, 'blank');
    expect(d.slides[0].objects.some((o) => parasToPlain(o.tx.paras) === 'Hello')).toBe(true); // kept as a plain text box
  });
  it('changing theme changes master colours/fonts once, objects keep tokens', () => {
    let d = mkDeck();
    const before = JSON.stringify(d.slides);
    d = ops.setTheme(d, 'midnight');
    expect(d.theme.id).toBe('midnight');
    expect(JSON.stringify(d.slides)).toBe(before);
    d = ops.setPaletteColor(d, 'accent1', '#ff0000');
    expect(d.theme.colors.accent1).toBe('#ff0000'); expect(d.theme.id).toBe('custom');
  });
  it('resizes a deck and scales content', () => {
    let d = mkDeck();
    const w0 = d.slides[0].objects[0].w;
    d = ops.resizeDeck(d, { w: 960, h: 720 });
    expect(d.size).toEqual({ w: 960, h: 720 });
    expect(d.slides[0].objects[0].w).toBeCloseTo(w0 * 0.75);
  });
});

describe('find & replace', () => {
  it('searches and replaces in text, tables, charts, notes and groups', () => {
    let d = mkDeck(); const sid = d.slides[0].id;
    const t = createTextBox({ tx: txFromPlain('Foo bar foo') });
    const tb = createTable(2, 2); tb.cells[1][1] = 'FOO cell';
    const ch = createChart('bar'); ch.title = 'foo chart';
    d = ops.addObjects(d, sid, [t, tb, ch]);
    d = ops.updateSlide(d, sid, { notes: 'a foo note' });
    d = ops.groupObjects(d, sid, [t.id, tb.id]).deck;
    const m = ops.findMatches(d, 'foo', { notes: true });
    expect(m[0].count).toBe(5);
    expect(ops.findMatches(d, 'foo', { matchCase: true })[0].count).toBe(2); // text box 'foo' + chart title 'foo' (not 'Foo'/'FOO')
    const r = ops.replaceAll(d, 'foo', 'baz', { notes: true });
    expect(r.count).toBe(5);
    expect(ops.findMatches(r.deck, 'foo', { notes: true })).toHaveLength(0);
    expect(ops.replaceAll(d, 'zzz', 'y').deck).toBe(d);
  });
  it('treats regex metacharacters literally', () => {
    let d = mkDeck(); const sid = d.slides[0].id;
    d = ops.addObjects(d, sid, [createTextBox({ tx: txFromPlain('a.b (c) a.b') })]);
    expect(ops.replaceAll(d, 'a.b', 'X').count).toBe(2);
    expect(ops.replaceAll(d, '(c)', 'Y').count).toBe(1);
  });
});

describe('text formatting', () => {
  it('toggles bold across runs and sets box-level props', () => {
    const tx = txFromPlain('one\ntwo');
    const bold = applyTextFormat(tx, { b: 'toggle' });
    expect(bold.paras.every((p) => p.runs.every((r) => r.b))).toBe(true);
    expect(applyTextFormat(bold, { b: 'toggle' }).paras[0].runs[0].b).toBeUndefined();
    const big = applyTextFormat({ ...tx, paras: [{ runs: [{ t: 'x', size: 10 }] }] }, { size: 40, list: 'bullet', align: 'center' });
    expect(big.size).toBe(40); expect(big.paras[0].runs[0].size).toBeUndefined(); expect(big.paras[0].list).toBe('bullet'); expect(big.align).toBe('center');
  });
  it('only allows http(s) and mailto links', () => {
    expect(safeLink('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeLink('mailto:a@b.co')).toBe('mailto:a@b.co');
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', ' JaVaScRiPt:1', 'https://a b', 'ftp://x', 'https://x"onmouseover=']) expect(safeLink(bad)).toBeNull();
  });
});

describe('history (undo/redo)', () => {
  it('undoes and redoes structural changes', () => {
    const d0 = mkDeck();
    let h = createHistory(d0);
    const d1 = ops.addSlide(d0); h = commit(h, d1);
    const d2 = ops.setTheme(d1, 'paper'); h = commit(h, d2);
    expect(canUndo(h)).toBe(true);
    h = undo(h); expect(h.present).toBe(d1);
    h = undo(h); expect(h.present).toBe(d0); expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(true);
    h = redo(h); h = redo(h); expect(h.present).toBe(d2);
  });
  it('clears redo on a new commit and ignores no-op commits', () => {
    const d0 = mkDeck(); let h = createHistory(d0);
    h = commit(h, ops.addSlide(d0)); h = undo(h);
    expect(canRedo(h)).toBe(true);
    expect(commit(h, h.present)).toBe(h);
    h = commit(h, ops.setTheme(d0, 'forest'));
    expect(canRedo(h)).toBe(false);
  });
  it('coalesces rapid commits with the same key into one step', () => {
    const d0 = mkDeck(); const sid = d0.slides[0].id; const oid = d0.slides[0].objects[0].id;
    let h = createHistory(d0, { windowMs: 1000 });
    h = commit(h, ops.addSlide(d0), null, 0);
    let d = h.present;
    for (let i = 1; i <= 5; i++) { d = ops.updateObjects(d, sid, [oid], { x: i * 10 }); h = commit(h, d, 'nudge', 100 + i * 10); }
    expect(h.past).toHaveLength(2); // initial, plus the state before the first nudge
    h = undo(h);
    expect(h.present.slides[0].objects[0].x).toBe(d0.slides[0].objects[0].x);
    // a different key or a long pause starts a new step
    let h2 = createHistory(d0, { windowMs: 100 });
    h2 = commit(h2, ops.updateObjects(d0, sid, [oid], { x: 1 }), 'k', 0);
    h2 = commit(h2, ops.updateObjects(h2.present, sid, [oid], { x: 2 }), 'k', 500);
    expect(h2.past).toHaveLength(2);
  });
  it('caps the stack', () => {
    let h = createHistory(mkDeck(), { limit: 5 });
    for (let i = 0; i < 20; i++) h = commit(h, ops.addSlide(h.present));
    expect(h.past).toHaveLength(5);
  });
  it('undo covers every object type edit', () => {
    let d = mkDeck(); const sid = d.slides[0].id; let h = createHistory(d);
    for (const o of [createTextBox(), createShape('arrow'), createImage('a1', 100, 100), createTable(), createChart('pie')]) h = commit(h, ops.addObjects(h.present, sid, [o]));
    expect(h.present.slides[0].objects).toHaveLength(7);
    for (let i = 0; i < 5; i++) h = undo(h);
    expect(h.present.slides[0].objects).toHaveLength(2);
  });
});

import { normalizeMerges, mergeRect, unmergeAt, mergeMap } from './tableMerge.js';
describe('table merges', () => {
  const tbl = () => ({ rows: 4, cols: 4, merges: [] });
  it('normalises: drops out-of-range, single-cell, overlapping and non-numeric merges; clamps spans', () => {
    const m = normalizeMerges([{ r: 0, c: 0, rs: 2, cs: 2 }, { r: 1, c: 1, rs: 2, cs: 2 }, { r: 9, c: 0, rs: 2, cs: 2 }, { r: 0, c: 3, rs: 1, cs: 1 }, { r: 3, c: 2, rs: 5, cs: 5 }, { r: 'x', c: 0, rs: 2, cs: 2 }, null], 4, 4);
    expect(m).toEqual([{ r: 0, c: 0, rs: 2, cs: 2 }, { r: 3, c: 2, rs: 1, cs: 2 }]);
  });
  it('merge replaces touched merges and unmerge splits', () => {
    let t = { ...tbl(), merges: mergeRect(tbl(), 0, 0, 2, 2) }; expect(t.merges).toHaveLength(1);
    t = { ...t, merges: mergeRect(t, 1, 1, 2, 2) }; expect(t.merges).toEqual([{ r: 1, c: 1, rs: 2, cs: 2 }]);
    expect(unmergeAt(t, 2, 2)).toEqual([]);
    expect(mergeMap(t.merges).get('2,2').isAnchor).toBe(false); expect(mergeMap(t.merges).get('1,1').isAnchor).toBe(true);
  });
  it('validateDeck sanitises merges from hostile input', async () => {
    const { validateDeck } = await import('./validate.js'); const { createDeck, createTable } = await import('./factory.js'); const ops = await import('./ops.js');
    let d = createDeck(); d = ops.addObjects(d, d.slides[0].id, [createTable(3, 3, { merges: [{ r: 0, c: 0, rs: 99, cs: 99 }, { r: -1, c: 0, rs: 2, cs: 2 }, { r: '__proto__', c: 0, rs: 2, cs: 2 }] })]);
    const o = validateDeck(JSON.parse(JSON.stringify(d))).slides[0].objects.find((x) => x.type === 'table'); expect(o.merges).toEqual([{ r: 0, c: 0, rs: 3, cs: 3 }]);
  });
});

import { masterObjects, masterOf } from './master.js';
describe('slide master footer and numbers', () => {
  const d0 = () => ops.setMaster(createDeck(), { showFooter: true, footerText: 'Acme Corp', showNumber: true, hideOnFirst: true });
  it('draws nothing by default and nothing on the first slide when hideOnFirst', () => {
    expect(masterObjects(createDeck(), 3)).toEqual([]); expect(masterObjects(d0(), 0)).toEqual([]);
  });
  it('produces a footer and the 1-based slide number on later slides, inside the slide', () => {
    const d = d0(); const o = masterObjects(d, 4); expect(o.map((x) => x.name)).toEqual(['Footer', 'Slide number']);
    expect(o[1].tx.paras[0].runs[0].t).toBe('5');
    for (const x of o) { expect(x.x).toBeGreaterThanOrEqual(0); expect(x.x + x.w).toBeLessThanOrEqual(d.size.w); expect(x.y + x.h).toBeLessThanOrEqual(d.size.h); }
  });
  it('can show on the first slide, and needs non-blank footer text', () => {
    expect(masterObjects(ops.setMaster(d0(), { hideOnFirst: false }), 0)).toHaveLength(2);
    expect(masterObjects(ops.setMaster(createDeck(), { showFooter: true, footerText: '   ' }), 2)).toEqual([]);
  });
  it('is sanitised by validateDeck (length cap, booleans) and survives a round trip', async () => {
    const { validateDeck } = await import('./validate.js');
    const v = validateDeck(JSON.parse(JSON.stringify(ops.setMaster(createDeck(), { footerText: 'Hello', showNumber: 'yes' }))));
    expect(masterOf(v).footerText).toBe('Hello'); expect(v.master.showNumber).toBe(false);
    const long = (() => { try { return masterOf(validateDeck(JSON.parse(JSON.stringify(ops.setMaster(createDeck(), { footerText: 'x'.repeat(500) }))))).footerText.length; } catch { return 'rejected'; } })(); expect(long === 'rejected' || long <= 200).toBe(true);
  });
});
