import { describe, it, expect } from 'vitest';
import { layoutText } from './textLayout.js';
import { makeTx, txFromPlain } from '../model/text.js';
import { cloneTheme } from '../model/themes.js';

const theme = cloneTheme('aurora');
const measure = (font, text) => { const size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)[1]); return text.length * size * 0.5; }; // 0.5em per char

describe('layoutText', () => {
  it('wraps greedily at the box width', () => {
    const tx = txFromPlain('aaaa bbbb cccc dddd', { size: 20, padding: 0 }); // each word 40px, space 10px
    const r = layoutText(tx, 100, 400, theme, measure);
    expect(r.lines.map((l) => l.items.filter((i) => !i.space).map((i) => i.text).join(' '))).toEqual(['aaaa bbbb', 'cccc dddd']);
  });
  it('splits paragraphs and applies line spacing + paragraph gap', () => {
    const tx = txFromPlain('one\ntwo', { size: 20, padding: 0, lineSpacing: 1.5 });
    const r = layoutText(tx, 300, 400, theme, measure);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0].lh).toBe(30);
    expect(r.lines[1].y).toBeCloseTo(30 + 20 * 0.3);
  });
  it('aligns centre/right and vertical middle/bottom', () => {
    const base = { size: 20, padding: 0 };
    const c = layoutText(txFromPlain('abcd', { ...base, align: 'center' }), 200, 100, theme, measure).lines[0];
    expect(c.items[0].x).toBeCloseTo((200 - 40) / 2);
    const r = layoutText(txFromPlain('abcd', { ...base, align: 'right' }), 200, 100, theme, measure).lines[0];
    expect(r.items[0].x).toBeCloseTo(160);
    expect(layoutText(txFromPlain('abcd', { ...base, valign: 'middle' }), 200, 100, theme, measure).offsetY).toBeCloseTo((100 - 24) / 2);
    expect(layoutText(txFromPlain('abcd', { ...base, valign: 'bottom' }), 200, 100, theme, measure).offsetY).toBeCloseTo(76);
  });
  it('justifies all lines except the last of a paragraph', () => {
    const tx = txFromPlain('aa bb cc dd ee ff', { size: 20, padding: 0, align: 'justify' });
    const r = layoutText(tx, 100, 400, theme, measure);
    const first = r.lines[0]; const last = r.lines[r.lines.length - 1];
    expect(first.x0 + first.width).toBeCloseTo(100);
    expect(last.x0 + last.width).toBeLessThan(100);
  });
  it('mixes run styles and uses the biggest size on a line', () => {
    const tx = makeTx({ paras: [{ runs: [{ t: 'small ' }, { t: 'BIG', size: 40, b: true }] }], size: 20, padding: 0 });
    const l = layoutText(tx, 500, 200, theme, measure).lines[0];
    expect(l.size).toBe(40);
    expect(l.items.find((i) => i.text === 'BIG').style.b).toBe(true);
  });
  it('numbers and bullets paragraphs, resetting numbers after a non-list paragraph', () => {
    const tx = makeTx({ paras: [{ runs: [{ t: 'a' }], list: 'number' }, { runs: [{ t: 'b' }], list: 'number' }, { runs: [{ t: 'c' }] }, { runs: [{ t: 'd' }], list: 'number' }, { runs: [{ t: 'e' }], list: 'bullet' }], size: 20, padding: 0 });
    const markers = layoutText(tx, 300, 400, theme, measure).lines.map((l) => l.marker && l.marker.text);
    expect(markers).toEqual(['1.', '2.', undefined, '1.', '•']);
  });
  it('draws no bullet for an empty list paragraph', () => {
    const tx = makeTx({ paras: [{ runs: [{ t: '' }], list: 'bullet' }], size: 20, padding: 0 });
    expect(layoutText(tx, 300, 100, theme, measure).lines[0].marker).toBeUndefined();
  });
  it('autofit shrinks text until it fits and reports the scale; without autofit it overflows', () => {
    const long = txFromPlain('word '.repeat(80), { size: 40, padding: 0 });
    const plain = layoutText(long, 300, 100, theme, measure);
    expect(plain.overflow).toBe(true); expect(plain.scale).toBe(1);
    const fit = layoutText({ ...long, autofit: true }, 300, 100, theme, measure);
    expect(fit.scale).toBeLessThan(1); expect(fit.overflow).toBe(false); expect(fit.contentH).toBeLessThanOrEqual(100);
  });
  it('handles empty text and a single over-long word without looping forever', () => {
    expect(layoutText(txFromPlain(''), 100, 100, theme, measure).lines).toHaveLength(1);
    const r = layoutText(txFromPlain('x'.repeat(200), { size: 20, padding: 0 }), 50, 100, theme, measure);
    expect(r.lines).toHaveLength(1);
  });
});
