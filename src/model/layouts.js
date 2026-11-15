import { makeTx, plainToParas } from './text.js';

// Layout placeholders are defined as fractions of the slide so they adapt to any slide size.
// Text defaults per role come from the master (theme) and scale with slide height.
export function roleTx(role, deckSize, text = '') {
  const k = deckSize.h / 720;
  const base = { paras: plainToParas(text) };
  switch (role) {
    case 'title': return makeTx({ ...base, font: '@heading', size: Math.round(48 * k), color: '@text', valign: 'middle', autofit: true });
    case 'subtitle': return makeTx({ ...base, font: '@body', size: Math.round(28 * k), color: '@muted', valign: 'top', autofit: true });
    case 'caption': return makeTx({ ...base, font: '@body', size: Math.round(22 * k), color: '@muted', valign: 'top', autofit: true });
    default: return makeTx({ ...base, font: '@body', size: Math.round(28 * k), color: '@text', valign: 'top', autofit: true });
  }
}
const bullets = (tx) => ({ ...tx, paras: tx.paras.map((p) => ({ ...p, list: 'bullet' })) });

export const LAYOUT_SPECS = {
  title: [
    { role: 'title', x: 0.1, y: 0.28, w: 0.8, h: 0.24, prompt: 'Click to add title', align: 'center' },
    { role: 'subtitle', x: 0.15, y: 0.55, w: 0.7, h: 0.14, prompt: 'Click to add subtitle', align: 'center' },
  ],
  titleContent: [
    { role: 'title', x: 0.07, y: 0.06, w: 0.86, h: 0.16, prompt: 'Click to add title' },
    { role: 'body', x: 0.07, y: 0.26, w: 0.86, h: 0.64, prompt: 'Click to add text', list: true },
  ],
  twoColumn: [
    { role: 'title', x: 0.07, y: 0.06, w: 0.86, h: 0.16, prompt: 'Click to add title' },
    { role: 'body', x: 0.07, y: 0.26, w: 0.41, h: 0.64, prompt: 'Left column', list: true },
    { role: 'body2', x: 0.52, y: 0.26, w: 0.41, h: 0.64, prompt: 'Right column', list: true },
  ],
  sectionHeader: [
    { role: 'title', x: 0.08, y: 0.36, w: 0.84, h: 0.2, prompt: 'Section title' },
    { role: 'subtitle', x: 0.08, y: 0.58, w: 0.7, h: 0.12, prompt: 'Section description' },
  ],
  blank: [],
  caption: [
    { role: 'body', x: 0.07, y: 0.07, w: 0.86, h: 0.68, prompt: '', list: false },
    { role: 'caption', x: 0.07, y: 0.78, w: 0.86, h: 0.14, prompt: 'Click to add caption' },
  ],
};

export function layoutPlaceholders(layout, size) {
  return (LAYOUT_SPECS[layout] || []).map((s) => {
    let tx = roleTx(s.role === 'body2' ? 'body' : s.role, size, '');
    if (s.align) tx = { ...tx, align: s.align };
    if (s.list) tx = bullets(tx);
    if (s.role === 'title' && layout === 'sectionHeader') tx = { ...tx, size: Math.round(54 * size.h / 720) };
    return { role: s.role, prompt: s.prompt, x: Math.round(s.x * size.w), y: Math.round(s.y * size.h), w: Math.round(s.w * size.w), h: Math.round(s.h * size.h), tx };
  });
}
