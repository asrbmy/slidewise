// Built-in themes. A theme IS the slide master: fonts, colours and the background are defined here once.
const mk = (id, name, c, fonts, bg) => ({ id, name, colors: c, fonts, background: bg });
export const THEMES = [
  mk('aurora', 'Aurora', { bg: '#ffffff', surface: '#eef2ff', text: '#1e1b4b', muted: '#6b7280', accent1: '#4f46e5', accent2: '#06b6d4', accent3: '#f59e0b', accent4: '#10b981', accent5: '#ec4899', accent6: '#8b5cf6' }, { heading: 'sans', body: 'sans' }, { type: 'solid', color: '@bg' }),
  mk('midnight', 'Midnight', { bg: '#0f172a', surface: '#1e293b', text: '#f1f5f9', muted: '#94a3b8', accent1: '#38bdf8', accent2: '#a78bfa', accent3: '#fb7185', accent4: '#34d399', accent5: '#fbbf24', accent6: '#f472b6' }, { heading: 'sans', body: 'sans' }, { type: 'gradient', colors: ['#0f172a', '#1e293b'], angle: 135 }),
  mk('paper', 'Paper', { bg: '#fbf7ef', surface: '#f1e9d8', text: '#2b2118', muted: '#7a6a58', accent1: '#b45309', accent2: '#0f766e', accent3: '#9f1239', accent4: '#4d7c0f', accent5: '#1d4ed8', accent6: '#7e22ce' }, { heading: 'serif', body: 'serif' }, { type: 'solid', color: '@bg' }),
  mk('forest', 'Forest', { bg: '#f3f8f3', surface: '#dcebdc', text: '#14281d', muted: '#5b7266', accent1: '#15803d', accent2: '#0e7490', accent3: '#ca8a04', accent4: '#9a3412', accent5: '#6d28d9', accent6: '#be185d' }, { heading: 'trebuchet', body: 'trebuchet' }, { type: 'solid', color: '@bg' }),
  mk('sunset', 'Sunset', { bg: '#fff7f2', surface: '#ffe4d6', text: '#3b1d12', muted: '#8a5a48', accent1: '#e11d48', accent2: '#f97316', accent3: '#eab308', accent4: '#14b8a6', accent5: '#6366f1', accent6: '#a21caf' }, { heading: 'rounded', body: 'sans' }, { type: 'gradient', colors: ['#fff7f2', '#ffe1e8'], angle: 160 }),
  mk('mono', 'Monochrome', { bg: '#ffffff', surface: '#f3f4f6', text: '#111111', muted: '#6b7280', accent1: '#111111', accent2: '#4b5563', accent3: '#9ca3af', accent4: '#374151', accent5: '#6b7280', accent6: '#d1d5db' }, { heading: 'arial', body: 'arial' }, { type: 'solid', color: '@bg' }),
  mk('ocean', 'Ocean', { bg: '#06283d', surface: '#0b3b57', text: '#e6f6ff', muted: '#8fc1d9', accent1: '#47b5ff', accent2: '#1dd3b0', accent3: '#ffd166', accent4: '#ff6b6b', accent5: '#b79ced', accent6: '#f9a8d4' }, { heading: 'verdana', body: 'verdana' }, { type: 'gradient', colors: ['#06283d', '#0b4f6c'], angle: 160 }),
  mk('slate', 'Slate Pro', { bg: '#f8fafc', surface: '#e2e8f0', text: '#0f172a', muted: '#64748b', accent1: '#0ea5e9', accent2: '#f43f5e', accent3: '#22c55e', accent4: '#f59e0b', accent5: '#8b5cf6', accent6: '#14b8a6' }, { heading: 'serif', body: 'sans' }, { type: 'solid', color: '@bg' }),
];
export const THEME_BY_ID = Object.fromEntries(THEMES.map((t) => [t.id, t]));
export const DEFAULT_THEME_ID = 'aurora';
export function cloneTheme(id) { return JSON.parse(JSON.stringify(THEME_BY_ID[id] || THEME_BY_ID[DEFAULT_THEME_ID])); }
