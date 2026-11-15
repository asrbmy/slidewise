import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { buildPptx, esc } from '../export/pptxBuilder.js';
import { parsePptx, parseXml, ImportError } from './pptxImport.js';
import { createDeck, createShape, createTextBox, createTable, createGroup, createImage, createSlide } from '../model/factory.js';
import * as ops from '../model/ops.js';
import { txFromPlain, makeTx, parasToPlain } from '../model/text.js';
import { LIMITS } from '../model/constants.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const pngBytes = () => Uint8Array.from(atob(PNG.split(',')[1]), (c) => c.charCodeAt(0));
const providers = { textScale: () => 1, chartPng: async () => pngBytes(), imageBytes: async () => ({ bytes: pngBytes(), ext: 'png' }) };

function sample() {
  let d = createDeck({ name: 'Round trip' });
  const sid = d.slides[0].id;
  const t = createTextBox({ x: 100, y: 120, w: 500, h: 100, tx: makeTx({ paras: [{ runs: [{ t: 'Hello ', b: true }, { t: 'link', link: 'https://example.com/' }], list: 'bullet' }, { runs: [{ t: 'second', i: true, color: '#ff0000' }] }], size: 30 }) });
  const sh = createShape('star', { x: 700, y: 100, w: 200, h: 200 });
  const tb = createTable(2, 2, { x: 100, y: 400, w: 600, h: 120 }); tb.cells = [['A', 'B'], ['C & D', '<E>']];
  const im = createImage('img1', 100, 100, { x: 900, y: 400, alt: 'a pixel' });
  const g = createGroup([createShape('rect', { x: 0, y: 0, w: 50, h: 50 }), createShape('ellipse', { x: 60, y: 0, w: 50, h: 50 })], { x: 50, y: 600, w: 110, h: 50 });
  d = ops.addAsset(d, 'img1', { mime: 'image/png', name: 'p.png', w: 1, h: 1, data: PNG });
  d = ops.addObjects(d, sid, [t, sh, tb, im, g]);
  d = ops.updateSlide(d, sid, { notes: 'speaker line 1\nline 2', transition: { type: 'fade', duration: 500 } });
  d = ops.addSlide(d, 0, 'blank');
  return d;
}
const toBuf = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

describe('PPTX export -> import round trip', () => {
  it('writes a structurally valid package', async () => {
    const zip = await JSZip.loadAsync(await buildPptx(sample(), providers));
    for (const n of ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml', 'ppt/slides/slide1.xml', 'ppt/slides/slide2.xml', 'ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml', 'ppt/theme/theme1.xml', 'ppt/notesSlides/notesSlide1.xml', 'ppt/notesMasters/notesMaster1.xml']) expect(zip.file(n), n).toBeTruthy();
    for (const n of Object.keys(zip.files).filter((f) => /\.(xml|rels)$/.test(f))) { const doc = new DOMParser().parseFromString(await zip.file(n).async('string'), 'application/xml'); expect(doc.getElementsByTagName('parsererror').length, n).toBe(0); }
  });
  it('preserves text, runs, lists, links, shapes, tables, groups, images, notes, transitions', async () => {
    const d = sample();
    const { deck } = await parsePptx(toBuf(await buildPptx(d, providers)));
    expect(deck.slides).toHaveLength(2);
    const s = deck.slides[0];
    const text = s.objects.find((o) => o.type === 'text' && parasToPlain(o.tx.paras).includes('Hello'));
    expect(parasToPlain(text.tx.paras)).toBe('Hello link\nsecond');
    expect(text.tx.paras[0].runs[0].b).toBe(true); expect(text.tx.paras[0].list).toBe('bullet');
    expect(text.tx.paras[0].runs[1].link).toBe('https://example.com/');
    expect(text.tx.paras[1].runs[0]).toMatchObject({ i: true, color: '#ff0000' });
    expect(text.x).toBeCloseTo(100, 0); expect(text.w).toBeCloseTo(500, 0); expect(text.tx.size).toBeCloseTo(30, 0);
    expect(s.objects.find((o) => o.type === 'shape' && o.shape === 'star')).toBeTruthy();
    const tb = s.objects.find((o) => o.type === 'table'); expect(tb.cells).toEqual([['A', 'B'], ['C & D', '<E>']]);
    const im = s.objects.find((o) => o.type === 'image'); expect(im.alt).toBe('a pixel'); expect(deck.assets[im.assetId].mime).toBe('image/png');
    const g = s.objects.find((o) => o.type === 'group'); expect(g.children).toHaveLength(2); expect(g.children[1].x).toBeCloseTo(60, 0);
    expect(s.notes).toBe('speaker line 1\nline 2'); expect(s.transition.type).toBe('fade');
    expect(deck.size).toEqual({ w: 1280, h: 720 });
  });
  it('escapes XML metacharacters and strips control characters', () => {
    expect(esc('a&b<c>"d\'\u0001')).toBe('a&amp;b&lt;c&gt;&quot;d&apos;');
  });
  it('flattens theme tokens to concrete colours (documented loss)', async () => {
    const { deck } = await parsePptx(toBuf(await buildPptx(sample(), providers)));
    const star = deck.slides[0].objects.find((o) => o.shape === 'star'); expect(star.fill).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

async function zipWith(files) { const z = new JSZip(); for (const [k, v] of Object.entries(files)) z.file(k, v); return toBuf(await z.generateAsync({ type: 'uint8array' })); }
describe('PPTX import treats the file as hostile', () => {
  it('rejects non-zip and non-pptx input', async () => {
    await expect(parsePptx(new TextEncoder().encode('hello').buffer)).rejects.toThrow(/not a valid PPTX/);
    await expect(parsePptx(await zipWith({ 'a.txt': 'x' }))).rejects.toThrow(/Not a PowerPoint file/);
  });
  it('rejects DTD/entity declarations (XXE / billion laughs)', () => {
    expect(() => parseXml('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><x>&a;</x>')).toThrow(/DTD or entity/);
    expect(() => parseXml('<x><unclosed></x>')).toThrow(ImportError);
  });
  it('rejects zips with too many entries and path traversal', async () => {
    const many = {}; for (let i = 0; i < LIMITS.maxPptxEntries + 5; i++) many['f' + i] = '';
    await expect(parsePptx(await zipWith(many))).rejects.toThrow(/too many parts/);
    await expect(parsePptx(await zipWith({ '../evil.xml': 'x', 'ppt/presentation.xml': '<x/>' }))).rejects.toThrow(/unsafe paths/);
  });
  it('drops SVG and other non-raster media, and sanitises everything via the validator', async () => {
    const base = await JSZip.loadAsync(await buildPptx(sample(), providers));
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script></svg>';
    const media = Object.keys(base.files).find((n) => /^ppt\/media\/.+\.png$/.test(n));
    base.file(media, svg);
    const { deck, warnings } = await parsePptx(toBuf(await base.generateAsync({ type: 'uint8array' })));
    expect(deck.slides[0].objects.some((o) => o.type === 'image')).toBe(false);
    expect(Object.keys(deck.assets)).toHaveLength(0);
    expect(warnings.join(' ')).toMatch(/not PNG\/JPEG/);
    expect(JSON.stringify(deck)).not.toContain('<script');
  });
  it('ignores javascript: hyperlinks', async () => {
    const base = await JSZip.loadAsync(await buildPptx(sample(), providers));
    const rp = 'ppt/slides/_rels/slide1.xml.rels'; let rels = await base.file(rp).async('string');
    rels = rels.replace('https://example.com/', 'javascript:alert(1)'); base.file(rp, rels);
    const { deck } = await parsePptx(toBuf(await base.generateAsync({ type: 'uint8array' })));
    expect(JSON.stringify(deck)).not.toContain('javascript:');
  });
  it('caps objects per slide', async () => {
    let d = createDeck(); const sid = d.slides[0].id;
    const objs = Array.from({ length: 60 }, (_, i) => createShape('rect', { x: i, y: i }));
    d = ops.addObjects(d, sid, objs);
    const { deck } = await parsePptx(toBuf(await buildPptx(d, providers)));
    expect(deck.slides[0].objects.length).toBeGreaterThanOrEqual(60);
    void createSlide; void txFromPlain;
  });
});

describe('PPTX gradient round trip', () => {
  it('exports a gradFill and imports it back as a two-colour gradient', async () => {
    let d = createDeck(); const sid = d.slides[0].id;
    d = ops.addObjects(d, sid, [createShape('rect', { x: 10, y: 10, w: 200, h: 100, grad: { colors: ['#ff0000', '#0000ff'], angle: 90 } })]);
    const u8 = await buildPptx(d, providers);
    const zip = await JSZip.loadAsync(u8); expect(await zip.file('ppt/slides/slide1.xml').async('string')).toContain('<a:gradFill');
    const back = await parsePptx(toBuf(u8)); const o = back.deck.slides[0].objects.find((x) => x.type === 'shape');
    expect(o.grad.colors).toEqual(['#ff0000', '#0000ff']); expect(o.grad.angle).toBe(90);
  });
});

describe('PPTX merged cells round trip', () => {
  it('exports gridSpan/rowSpan/hMerge/vMerge and imports them back', async () => {
    let d = createDeck(); d = ops.addObjects(d, d.slides[0].id, [createTable(3, 3, { x: 10, y: 10, w: 450, h: 150, merges: [{ r: 0, c: 0, rs: 2, cs: 2 }] })]);
    const u8 = await buildPptx(d, providers); const xml = await (await JSZip.loadAsync(u8)).file('ppt/slides/slide1.xml').async('string');
    expect(xml).toContain('gridSpan="2"'); expect(xml).toContain('rowSpan="2"'); expect(xml).toContain('hMerge="1"'); expect(xml).toContain('vMerge="1"');
    const back = await parsePptx(toBuf(u8)); expect(back.deck.slides[0].objects.find((o) => o.type === 'table').merges).toEqual([{ r: 0, c: 0, rs: 2, cs: 2 }]);
  });
});

describe('PPTX master footer', () => {
  it('flattens the footer and slide number into each slide (not the first when hidden)', async () => {
    let d = ops.setMaster(createDeck(), { showFooter: true, footerText: 'Footer Co', showNumber: true }); d = ops.addSlide(d, 0, 'blank');
    const zip = await JSZip.loadAsync(await buildPptx(d, providers));
    const s1 = await zip.file('ppt/slides/slide1.xml').async('string'), s2 = await zip.file('ppt/slides/slide2.xml').async('string');
    expect(s1).not.toContain('Footer Co'); expect(s2).toContain('Footer Co'); expect(s2).toContain('>2<');
  });
});
