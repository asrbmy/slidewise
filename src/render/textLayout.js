// Pure text layout (no DOM): turns a rich-text block into positioned runs. `measure(fontString, text)` returns pixel width.
import { fontStack } from './theme.js';
import { resolveColor } from './theme.js';

export const PARA_GAP = 0.3; // fraction of font size between paragraphs
export const BULLET_INDENT = 0.9; // em
export const LEVEL_INDENT = 1.6; // em per indent level

export function fontString(style, theme) {
  return `${style.i ? 'italic ' : ''}${style.b ? 'bold ' : ''}${Math.max(1, style.size)}px ${fontStack(theme, style.font)}`;
}

function tokenize(para, tx, theme, scale) {
  const tokens = [];
  for (const r of para.runs) {
    const style = { b: !!r.b, i: !!r.i, u: !!r.u, s: !!r.s, size: (r.size || tx.size) * scale, font: r.font || tx.font, color: resolveColor(theme, r.color || tx.color), hl: r.hl ? resolveColor(theme, r.hl) : null, link: r.link || null };
    const parts = String(r.t || '').replace(/[\n\r\v]/g, ' ').split(/(\s+)/).filter((p) => p !== '');
    for (const p of parts) tokens.push({ text: p, space: /^\s+$/.test(p), style });
  }
  return tokens;
}

export function layoutText(tx, boxW, boxH, theme, measure, opts = {}) {
  const run = (scale) => layoutOnce(tx, boxW, boxH, theme, measure, scale, opts);
  let scale = 1, out = run(1);
  if (tx.autofit && out.contentH > boxH - tx.padding * 2) {
    let lo = 0.2, hi = 1;
    for (let i = 0; i < 9; i++) { const mid = (lo + hi) / 2; const t = run(mid); if (t.contentH <= boxH - tx.padding * 2) lo = mid; else hi = mid; }
    scale = lo; out = run(scale);
  }
  return { ...out, scale };
}

function layoutOnce(tx, boxW, boxH, theme, measure, scale, opts) {
  const pad = tx.padding;
  const innerW = Math.max(1, boxW - pad * 2);
  const lines = [];
  let numberCounter = 0;
  let y = 0;
  tx.paras.forEach((para, pi) => {
    const list = para.list || 'none';
    const level = para.indent || 0;
    const baseSize = (para.runs[0] && para.runs[0].size || tx.size) * scale;
    const indent = (level * LEVEL_INDENT + (list !== 'none' ? BULLET_INDENT + 0.3 : 0)) * baseSize;
    if (list === 'number') numberCounter++; else numberCounter = 0;
    const align = para.align || tx.align;
    const avail = Math.max(1, innerW - indent);
    const tokens = tokenize(para, tx, theme, scale);
    // greedy wrap
    const rows = [[]]; let rowW = 0;
    for (const t of tokens) {
      t.width = measure(fontString(t.style, theme), t.text);
      const cur = rows[rows.length - 1];
      if (t.space) { if (cur.length) { cur.push(t); rowW += t.width; } continue; }
      if (rowW + t.width > avail && cur.some((x) => !x.space)) {
        while (cur.length && cur[cur.length - 1].space) rowW -= cur.pop().width;
        rows.push([t]); rowW = t.width;
      } else { cur.push(t); rowW += t.width; }
    }
    rows.forEach((row, ri) => {
      while (row.length && row[row.length - 1].space) row.pop();
      const width = row.reduce((n, t) => n + t.width, 0);
      const maxSize = row.reduce((n, t) => Math.max(n, t.style.size), baseSize);
      const lh = maxSize * tx.lineSpacing;
      const lastOfPara = ri === rows.length - 1;
      let x = pad + indent;
      let extra = 0;
      if (align === 'center') x += (avail - width) / 2; else if (align === 'right') x += avail - width;
      else if (align === 'justify' && !lastOfPara) { const spaces = row.filter((t) => t.space).length; if (spaces) extra = (avail - width) / spaces; }
      const items = [];
      let cx = x;
      for (const t of row) { const w = t.width + (t.space ? extra : 0); items.push({ text: t.text, space: t.space, style: t.style, x: cx, w }); cx += w; }
      const line = { y, lh, size: maxSize, items, x0: x, width: width + extra * row.filter((t) => t.space).length, para: pi };
      if (ri === 0 && list !== 'none' && para.runs.some((r) => r.t)) {
        const first = row[0] ? row[0].style : { b: false, i: false, size: baseSize, font: tx.font, color: resolveColor(theme, tx.color) };
        line.marker = { text: list === 'bullet' ? (level % 2 ? '–' : '•') : numberCounter + '.', x: pad + level * LEVEL_INDENT * baseSize, style: { ...first, u: false, s: false, hl: null, link: null } };
      }
      lines.push(line);
      y += lh;
    });
    if (pi < tx.paras.length - 1) y += baseSize * PARA_GAP;
  });
  const contentH = y;
  let offY = pad;
  const free = boxH - pad * 2 - contentH;
  if (tx.valign === 'middle') offY += Math.max(0, free / 2); else if (tx.valign === 'bottom') offY += Math.max(0, free);
  return { lines, contentH: contentH + 0, offsetY: offY, overflow: contentH > boxH - pad * 2 + 0.5 };
}
