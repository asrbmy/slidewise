import { describe, it, expect } from 'vitest';
import { buildEditorDom, domToParas, htmlToParas, sanitizePastedHtml } from './richtext.js';
import { makeTx } from '../model/text.js';
import { cloneTheme } from '../model/themes.js';

const theme = cloneTheme('aurora');
const html = (s) => { const d = document.createElement('div'); d.innerHTML = s; return d; };

describe('model <-> DOM round trip', () => {
  it('preserves runs, styles, tokens, links and paragraph attributes', () => {
    const tx = makeTx({ paras: [
      { runs: [{ t: 'Hello ', b: true }, { t: 'world', i: true, u: true, color: '@accent2' }, { t: ' link', link: 'https://example.com/' }], list: 'bullet', align: 'center' },
      { runs: [{ t: 'second', s: true, hl: '#ffee00', size: 40, font: 'serif' }], list: 'number' },
      { runs: [{ t: '' }] },
    ] });
    const root = document.createElement('div');
    buildEditorDom(root, tx, theme, 1);
    const back = domToParas(root, 1);
    expect(back).toEqual(tx.paras);
  });
  it('maps rendered sizes back through the autofit scale', () => {
    const tx = makeTx({ paras: [{ runs: [{ t: 'x', size: 40 }] }] });
    const root = document.createElement('div'); buildEditorDom(root, tx, theme, 0.5);
    expect(root.querySelector('span').style.fontSize).toBe('20px');
    expect(domToParas(root, 0.5)[0].runs[0].size).toBe(40);
  });
});

describe('parsing browser-produced markup', () => {
  it('handles execCommand-style output (b/i/u/strike, font color, nested divs)', () => {
    const r = domToParas(html('<div>one <b>bold <i>both</i></b> <u>u</u> <strike>s</strike></div><div><font color="#ff0000">red</font></div>'));
    expect(r).toHaveLength(2);
    expect(r[0].runs.map((x) => [x.t, !!x.b, !!x.i, !!x.u, !!x.s])).toEqual([['one ', false, false, false, false], ['bold ', true, false, false, false], ['both', true, true, false, false], [' ', false, false, false, false], ['u', false, false, true, false], [' ', false, false, false, false], ['s', false, false, false, true]]);
    expect(r[1].runs[0].color).toBe('#ff0000');
  });
  it('treats bare text + divs as separate paragraphs and an empty div as an empty paragraph', () => {
    const r = domToParas(html('first<div>second</div><div><br></div><div>fourth</div>'));
    expect(r.map((p) => p.runs.map((x) => x.t).join(''))).toEqual(['first', 'second', '', 'fourth']);
  });
  it('converts <ul>/<ol> lists', () => {
    const r = domToParas(html('<ul><li>a</li><li>b</li></ul><ol><li>c</li></ol>'));
    expect(r.map((p) => p.list)).toEqual(['bullet', 'bullet', 'number']);
  });
  it('drops unsafe link schemes found in the DOM', () => {
    const r = domToParas(html('<a href="javascript:alert(1)">bad</a><a href="https://ok.example">ok</a>'));
    expect(r[0].runs.find((x) => x.t === 'bad').link).toBeUndefined();
    expect(r[0].runs.find((x) => x.t === 'ok').link).toBe('https://ok.example');
  });
  it('reads CSS colours, highlight, size and weight from span styles', () => {
    const r = domToParas(html('<div><span style="color: rgb(255, 0, 0); background-color: rgb(0, 255, 0); font-size: 30px; font-weight: 700">x</span></div>'));
    expect(r[0].runs[0]).toMatchObject({ color: '#ff0000', hl: '#00ff00', size: 30, b: true });
  });
});

describe('pasted HTML is sanitised', () => {
  const evil = '<p onclick="alert(1)">hi<script>alert(2)</script><img src=x onerror=alert(3)><iframe src="https://evil.example"></iframe><a href="javascript:alert(4)">j</a><a href="https://ok.example" onmouseover="x()">ok</a><style>*{display:none}</style></p><svg onload=alert(5)></svg><object data="x"></object>';
  it('strips scripts, handlers, iframes, images, svg and javascript: URLs', () => {
    const clean = sanitizePastedHtml(evil);
    for (const bad of ['script', 'onclick', 'onerror', 'iframe', '<img', 'javascript:', 'onmouseover', '<svg', '<object', '<style']) expect(clean.toLowerCase()).not.toContain(bad);
    expect(clean).toContain('https://ok.example');
  });
  it('yields only plain model runs', () => {
    const paras = htmlToParas(evil);
    const text = paras.map((p) => p.runs.map((r) => r.t).join('')).join('|');
    expect(text).toContain('hi'); expect(text).not.toContain('alert');
    expect(JSON.stringify(paras)).not.toContain('javascript:');
  });
  it('drops inline styles from pasted content (no hidden text / layout tricks)', () => {
    const paras = htmlToParas('<span style="font-size:1px;color:white">sneaky</span><b>bold</b>');
    const r = paras[0].runs.find((x) => x.t === 'sneaky');
    expect(r.size).toBeUndefined(); expect(r.color).toBeUndefined();
  });
});
