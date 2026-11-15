// Slide master extras: an optional footer and slide numbers drawn on every slide.
// Kept as deck.master = { showFooter, footerText, showNumber, hideOnFirst }.
import { createTextBox } from './factory.js';
import { makeTx, txFromPlain } from './text.js';

export const DEFAULT_MASTER = { showFooter: false, footerText: '', showNumber: false, hideOnFirst: true };

export function masterOf(deck) { return { ...DEFAULT_MASTER, ...(deck && deck.master ? deck.master : {}) }; }

// Text boxes (not part of slide.objects, never selectable) for the slide at `index`.
export function masterObjects(deck, index) {
  const m = masterOf(deck); const out = [];
  if (m.hideOnFirst && index === 0) return out;
  const { w, h } = deck.size; const size = Math.max(10, Math.round(h * 0.02)); const bh = size * 2.2; const y = h - bh - h * 0.02; const margin = w * 0.04;
  const box = (id, name, text, align, x, bw) => ({ ...createTextBox({ name, x, y, w: bw, h: bh, tx: makeTx({ paras: txFromPlain(text).paras, size, color: '@muted', align, valign: 'middle', autofit: false, padding: 0 }) }), id });
  if (m.showFooter && m.footerText.trim()) out.push(box('master-footer', 'Footer', m.footerText, 'left', margin, w * 0.7));
  if (m.showNumber) out.push(box('master-number', 'Slide number', String(index + 1), 'right', w - margin - w * 0.15, w * 0.15));
  return out;
}
