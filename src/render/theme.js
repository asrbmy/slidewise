import { FONTS } from '../model/constants.js';
export function resolveColor(theme, v, fallback = '#000000') {
  if (!v) return fallback;
  if (v === 'none' || v === 'transparent') return 'transparent';
  if (v[0] === '@') return theme.colors[v.slice(1)] || fallback;
  return v;
}
export function fontKey(theme, v) {
  if (v === '@heading') return theme.fonts.heading;
  if (v === '@body' || !v) return theme.fonts.body;
  return v;
}
export function fontStack(theme, v) { return (FONTS[fontKey(theme, v)] || FONTS.sans).stack; }
export function slideBackground(theme, slide) {
  if (slide && slide.background && slide.background.color) return { type: 'solid', color: resolveColor(theme, slide.background.color, '#ffffff') };
  const b = theme.background || { type: 'solid', color: '@bg' };
  if (b.type === 'gradient') return { type: 'gradient', colors: b.colors.map((c) => resolveColor(theme, c, '#ffffff')), angle: b.angle };
  return { type: 'solid', color: resolveColor(theme, b.color, theme.colors.bg) };
}
export const ACCENTS = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];
export function seriesColor(theme, s, i) { return s.color ? resolveColor(theme, s.color) : theme.colors[ACCENTS[i % ACCENTS.length]]; }
