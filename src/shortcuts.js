const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');
export const MOD = mac ? '⌘' : 'Ctrl+';
export const SHORTCUTS = [
  { group: 'General', keys: [
    ['Undo', MOD + 'Z'], ['Redo', MOD + 'Shift+Z / ' + MOD + 'Y'], ['Find and replace', MOD + 'F'], ['Show keyboard shortcuts', MOD + '/ or ?'], ['Save a version now', MOD + 'S'], ['Present from start', MOD + 'F5 / Shift+F5'], ['Present from current slide', 'F5'] ] },
  { group: 'Objects', keys: [
    ['Select all', MOD + 'A'], ['Copy / Cut / Paste', MOD + 'C / X / V'], ['Duplicate', MOD + 'D'], ['Delete', 'Delete / Backspace'], ['Nudge 1 px (10 px with Shift)', 'Arrow keys'], ['Group / Ungroup', MOD + 'G / ' + MOD + 'Shift+G'],
    ['Bring to front / Send to back', MOD + 'Shift+] / ' + MOD + 'Shift+['], ['Bring forward / Send backward', MOD + '] / ' + MOD + '['], ['Edit text of selected object', 'Enter or F2'], ['Stop editing text', 'Esc'], ['Select next / previous object', 'Tab / Shift+Tab'], ['Constrain drag / rotate (15°)', 'Shift'], ['Disable snapping while dragging', 'Alt'] ] },
  { group: 'Text (while editing)', keys: [ ['Bold / Italic / Underline', MOD + 'B / I / U'], ['Link', MOD + 'K'] ] },
  { group: 'Slides', keys: [ ['New slide', MOD + 'M'], ['Duplicate slide', MOD + 'Shift+D'], ['Next / previous slide', 'Page Down / Page Up'], ['Move slide up / down (slide list)', MOD + '↑ / ↓'], ['Delete slide (slide list)', 'Delete'] ] },
  { group: 'View', keys: [ ['Zoom in / out', MOD + '+ / ' + MOD + '-'], ['Fit to window', MOD + '0'] ] },
  { group: 'Presenting', keys: [ ['Next', '→ ↓ Space PageDown Enter or click / swipe left'], ['Previous', '← ↑ PageUp Backspace or swipe right'], ['First / last slide', 'Home / End'], ['Black screen / White screen', 'B / W'], ['Laser pointer', 'L'], ['Pen / Clear pen', 'P / E'], ['Show / hide progress bar', 'G'], ['Exit', 'Esc'] ] },
];
