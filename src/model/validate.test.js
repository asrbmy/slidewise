import { describe, it, expect } from 'vitest';
import { validateDeck, parseDeckJson, validateBackup, ValidationError, isColor, validateAssetData } from './validate.js';
import { createDeck, createImage, createTextBox, createShape, createTable, createChart } from './factory.js';
import * as ops from './ops.js';
import { LIMITS } from './constants.js';
import { txFromPlain } from './text.js';

// 1x1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const withImage = () => {
  let d = createDeck(); const sid = d.slides[0].id;
  d = ops.addAsset(d, 'img1', { mime: 'image/png', name: 'a.png', w: 1, h: 1, data: PNG });
  d = ops.addObjects(d, sid, [createImage('img1', 100, 100), createTextBox(), createShape('star'), createTable(), createChart('line')]);
  return d;
};

describe('validateDeck: round trip', () => {
  it('accepts a deck with every object type unchanged in substance', () => {
    const d = withImage();
    const v = validateDeck(JSON.parse(JSON.stringify(d)));
    expect(v.slides[0].objects.map((o) => o.type)).toEqual(d.slides[0].objects.map((o) => o.type));
    expect(v.assets.img1.mime).toBe('image/png');
    expect(v.name).toBe(d.name);
  });
});

describe('validateDeck: hostile input', () => {
  const base = () => JSON.parse(JSON.stringify(withImage()));
  it('rejects non-objects, empty decks and newer schemas', () => {
    expect(() => validateDeck(null)).toThrow(ValidationError);
    expect(() => validateDeck([])).toThrow(ValidationError);
    expect(() => validateDeck({ ...base(), slides: [] })).toThrow(/no slides/);
    expect(() => validateDeck({ ...base(), v: 99 })).toThrow(/newer version/);
  });
  it('rejects invalid JSON text and oversized text', () => {
    expect(() => parseDeckJson('{not json')).toThrow(/Not valid JSON/);
    expect(() => parseDeckJson('x'.repeat(LIMITS.maxImportFileBytes + 1))).toThrow(/too large/);
  });
  it('drops unknown keys and never copies through script-ish fields', () => {
    const d = base();
    d.evil = '<script>alert(1)</script>';
    d.slides[0].objects[1].onclick = 'alert(1)';
    d.slides[0].objects[1].html = '<img src=x onerror=alert(1)>';
    const v = validateDeck(d);
    expect(v.evil).toBeUndefined();
    expect(v.slides[0].objects[1].onclick).toBeUndefined();
    expect(v.slides[0].objects[1].html).toBeUndefined();
  });
  it('is not vulnerable to prototype pollution', () => {
    const d = JSON.parse('{"__proto__":{"polluted":true},"slides":[]}');
    expect(() => validateDeck(d)).toThrow();
    const d2 = base(); d2.slides[0].objects[0] = JSON.parse('{"type":"text","__proto__":{"polluted":1},"tx":{"paras":[{"runs":[{"t":"x"}]}]}}');
    validateDeck(d2);
    expect({}.polluted).toBeUndefined();
  });
  it('rejects bad colours and clamps numbers', () => {
    const d = base(); d.slides[0].objects[1].fill = 'url(javascript:alert(1))';
    expect(() => validateDeck(d)).toThrow(/Invalid colour/);
    const d2 = base(); d2.slides[0].objects[1].x = Infinity;
    expect(() => validateDeck(JSON.parse(JSON.stringify(d2).replace('null', '1')))).not.toThrow();
    const d3 = base(); d3.slides[0].objects[1].w = 1e12; d3.slides[0].objects[1].opacity = 5;
    const v = validateDeck(d3);
    expect(v.slides[0].objects[1].w).toBeLessThanOrEqual(1e5); expect(v.slides[0].objects[1].opacity).toBe(1);
    expect(isColor('#fff')).toBe(true); expect(isColor('rgb(1,2,3)')).toBe(true); expect(isColor('red;background:url(x)')).toBe(false); expect(isColor('@accent1')).toBe(true);
  });
  it('strips unsafe link schemes from text runs', () => {
    const d = base();
    d.slides[0].objects[1].tx.paras = [{ runs: [{ t: 'a', link: 'javascript:alert(1)' }, { t: 'b', link: 'https://ok.example/' }] }];
    const runs = validateDeck(d).slides[0].objects[1].tx.paras[0].runs;
    expect(runs[0].link).toBeUndefined(); expect(runs[1].link).toBe('https://ok.example/');
  });
  it('enforces object and slide caps', () => {
    const d = base();
    d.slides[0].objects = Array.from({ length: LIMITS.maxObjectsPerSlide + 1 }, () => d.slides[0].objects[1]);
    expect(() => validateDeck(d)).toThrow(/Too many objects/);
    const many = base(); many.slides = Array.from({ length: LIMITS.maxSlides + 1 }, () => many.slides[0]);
    expect(() => validateDeck(many)).toThrow(/Too many slides/);
  });
  it('caps group nesting depth', () => {
    const d = base();
    let g = JSON.parse(JSON.stringify(d.slides[0].objects[1]));
    for (let i = 0; i < LIMITS.maxGroupDepth + 2; i++) g = { type: 'group', x: 0, y: 0, w: 10, h: 10, children: [g] };
    d.slides[0].objects = [g];
    expect(() => validateDeck(d)).toThrow(/nested too deeply/);
  });
  it('caps table and chart sizes', () => {
    const d = base(); const t = d.slides[0].objects.find((o) => o.type === 'table');
    t.rows = 100; t.cols = 50; t.cells = [];
    expect(() => validateDeck(d)).toThrow(/Table is too large/);
    const d2 = base(); const c = d2.slides[0].objects.find((o) => o.type === 'chart');
    c.categories = Array(200).fill('x'); c.series = Array(24).fill({ name: 's', values: [] });
    expect(() => validateDeck(d2)).toThrow(/Chart is too large/);
  });
});

describe('image assets', () => {
  const asset = (over) => ({ mime: 'image/png', name: 'x', w: 1, h: 1, data: PNG, ...over });
  it('allow-lists image types: SVG and HTML are refused', () => {
    expect(() => validateAssetData(asset({ mime: 'image/svg+xml', data: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }), 'a')).toThrow(/not allowed/);
    expect(() => validateAssetData(asset({ mime: 'text/html', data: 'data:text/html;base64,PGI+' }), 'a')).toThrow(/not allowed/);
  });
  it('requires a base64 data URL that matches the declared type and magic bytes', () => {
    expect(() => validateAssetData(asset({ data: 'https://evil.example/a.png' }), 'a')).toThrow(/data URL/);
    expect(() => validateAssetData(asset({ data: 'data:image/jpeg;base64,' + PNG.split(',')[1] }), 'a')).toThrow(/data URL/);
    expect(() => validateAssetData(asset({ mime: 'image/jpeg', data: 'data:image/jpeg;base64,' + PNG.split(',')[1] }), 'a')).toThrow(/does not match/);
    const html = btoa('<script>alert(1)</script>');
    expect(() => validateAssetData(asset({ data: 'data:image/png;base64,' + html }), 'a')).toThrow(/does not match/);
    expect(() => validateAssetData(asset({ data: 'data:image/png;base64,@@@@' }), 'a')).toThrow(/base64/);
  });
  it('caps image size', () => {
    const big = 'data:image/png;base64,' + btoa('\x89PNG\r\n\x1a\n').replace(/=+$/, '') + 'A'.repeat(Math.ceil((LIMITS.maxImageBytes * 4) / 3) + 8);
    expect(() => validateAssetData(asset({ data: big }), 'a')).toThrow(/too large/);
  });
  it('rejects images that reference missing data and drops unreferenced assets', () => {
    const d = JSON.parse(JSON.stringify(withImage())); delete d.assets.img1;
    expect(() => validateDeck(d)).toThrow(/missing data/);
    const d2 = JSON.parse(JSON.stringify(withImage())); d2.assets.extra = { mime: 'image/png', name: 'e', w: 1, h: 1, data: PNG };
    expect(Object.keys(validateDeck(d2).assets)).toEqual(['img1']);
  });
});

describe('validateBackup', () => {
  it('accepts a good backup and rejects wrong format/version/bad decks with a path', () => {
    const good = { format: 'slidewise-backup', version: 1, decks: [JSON.parse(JSON.stringify(withImage()))], folders: [{ id: 'f1', name: 'Work' }] };
    const r = validateBackup(good);
    expect(r.decks).toHaveLength(1); expect(r.folders).toEqual([{ id: 'f1', name: 'Work' }]);
    expect(() => validateBackup({ format: 'other', version: 1, decks: [] })).toThrow(/Not a Slidewise backup/);
    expect(() => validateBackup({ ...good, version: 2 })).toThrow(/Unsupported/);
    const bad = JSON.parse(JSON.stringify(good)); bad.decks[0].slides = 'nope';
    expect(() => validateBackup(bad)).toThrow(/\$\.decks\[0\]/);
  });
  it('validates locked entries structurally', () => {
    const entry = { locked: true, id: 'abc', meta: { name: 'Secret' }, enc: { v: 1, alg: 'PBKDF2-SHA256/AES-GCM-256', iter: 1000, salt: btoa('x'.repeat(16)), iv: btoa('y'.repeat(12)), ct: btoa('z'.repeat(32)) } };
    const r = validateBackup({ format: 'slidewise-backup', version: 1, decks: [entry] });
    expect(r.locked[0].meta.locked).toBe(true);
    expect(() => validateBackup({ format: 'slidewise-backup', version: 1, decks: [{ ...entry, enc: { ...entry.enc, iter: 1 } }] })).toThrow(/Invalid encrypted/);
  });
});

describe('gradient fills', () => {
  const withGrad = (grad) => { let d = createDeck(); const sid = d.slides[0].id; d = ops.addObjects(d, sid, [createShape('rect', { grad })]); return d; };
  it('accepts a two-colour gradient and keeps it', () => {
    const d = validateDeck(JSON.parse(JSON.stringify(withGrad({ colors: ['#ff0000', '@accent2'], angle: 45 }))));
    const o = d.slides[0].objects.find((x) => x.type === 'shape'); expect(o.grad).toEqual({ colors: ['#ff0000', '@accent2'], angle: 45 });
  });
  it('rejects hostile gradient colours and wrong stop counts', () => {
    expect(() => validateDeck(JSON.parse(JSON.stringify(withGrad({ colors: ['url(javascript:alert(1))', '#000'], angle: 0 }))))).toThrow(ValidationError);
    expect(() => validateDeck(JSON.parse(JSON.stringify(withGrad({ colors: ['#000'], angle: 0 }))))).toThrow(ValidationError);
    expect(() => validateDeck(JSON.parse(JSON.stringify(withGrad({ colors: ['#000', '#fff'], angle: 'x' }))))).toThrow(ValidationError);
  });
});

describe('chart options', () => {
  it('keeps stacked/area flags as booleans and defaults them to false', () => {
    let d = createDeck(); const sid = d.slides[0].id;
    d = ops.addObjects(d, sid, [createChart('bar', { stacked: true }), createChart('line', { area: 'yes' })]);
    const v = validateDeck(JSON.parse(JSON.stringify(d))); const [a, b] = v.slides[0].objects.filter((o) => o.type === 'chart');
    expect(a.stacked).toBe(true); expect(a.area).toBe(false); expect(b.stacked).toBe(false); expect(typeof b.area).toBe('boolean');
  });
});

describe('rehearsal target', () => {
  it('is clamped to 0..3600 whole seconds and defaults to 0', () => {
    let d = createDeck(); d = ops.updateSlide(d, d.slides[0].id, { targetSec: 99999 });
    expect(validateDeck(JSON.parse(JSON.stringify(d))).slides[0].targetSec).toBe(3600);
    d = ops.updateSlide(d, d.slides[0].id, { targetSec: 12.6 }); expect(validateDeck(JSON.parse(JSON.stringify(d))).slides[0].targetSec).toBe(13);
    const raw = JSON.parse(JSON.stringify(createDeck())); delete raw.slides[0].targetSec; expect(validateDeck(raw).slides[0].targetSec).toBe(0);
  });
});

describe('chart kinds and labels', () => {
  it('accepts scatter, keeps labels/axis titles, and caps title length', () => {
    let d = createDeck(); d = ops.addObjects(d, d.slides[0].id, [createChart('scatter', { labels: true, xTitle: 'Time', yTitle: 'Speed', categories: ['1', '2.5', '4'], series: [{ name: 'A', values: [3, 5, 4] }] })]);
    const o = validateDeck(JSON.parse(JSON.stringify(d))).slides[0].objects.find((x) => x.type === 'chart');
    expect(o.kind).toBe('scatter'); expect(o.labels).toBe(true); expect([o.xTitle, o.yTitle]).toEqual(['Time', 'Speed']); expect(o.categories).toEqual(['1', '2.5', '4']);
  });
  it('rejects unknown chart kinds', () => {
    let d = createDeck(); d = ops.addObjects(d, d.slides[0].id, [createChart('bar', { kind: 'radar' })]);
    expect(() => validateDeck(JSON.parse(JSON.stringify(d)))).toThrow(ValidationError);
  });
});
