// Merged table cells. A table has `merges: [{ r, c, rs, cs }]` (anchor cell + row/column span).
// Cells covered by a merge (other than its anchor) are not drawn and their text is ignored.

// Keep only merges that are inside the grid, span more than one cell, and do not overlap an earlier one.
export function normalizeMerges(merges, rows, cols) {
  const out = []; const taken = new Set();
  for (const m of Array.isArray(merges) ? merges : []) {
    if (!m || typeof m !== 'object') continue;
    const r = Math.floor(Number(m.r)), c = Math.floor(Number(m.c));
    let rs = Math.floor(Number(m.rs)), cs = Math.floor(Number(m.cs));
    if (![r, c, rs, cs].every(Number.isFinite) || r < 0 || c < 0 || r >= rows || c >= cols) continue;
    rs = Math.max(1, Math.min(rs, rows - r)); cs = Math.max(1, Math.min(cs, cols - c));
    if (rs * cs < 2) continue;
    let clash = false; const keys = [];
    for (let i = r; i < r + rs; i++) for (let j = c; j < c + cs; j++) { const k = i + ',' + j; if (taken.has(k)) clash = true; keys.push(k); }
    if (clash) continue;
    keys.forEach((k) => taken.add(k)); out.push({ r, c, rs, cs });
  }
  return out;
}

// Map "r,c" -> { anchor: {r,c,rs,cs}, isAnchor }
export function mergeMap(merges) {
  const map = new Map();
  for (const m of merges || []) for (let i = m.r; i < m.r + m.rs; i++) for (let j = m.c; j < m.c + m.cs; j++) map.set(i + ',' + j, { m, isAnchor: i === m.r && j === m.c });
  return map;
}

// Merge a rectangle of cells into one. Any merges the new rectangle touches are removed first. Pure.
export function mergeRect(table, r, c, rs, cs) {
  const rows = table.rows, cols = table.cols;
  r = Math.max(0, Math.min(r, rows - 1)); c = Math.max(0, Math.min(c, cols - 1));
  rs = Math.max(1, Math.min(rs, rows - r)); cs = Math.max(1, Math.min(cs, cols - c));
  const touches = (m) => m.r < r + rs && m.r + m.rs > r && m.c < c + cs && m.c + m.cs > c;
  const kept = (table.merges || []).filter((m) => !touches(m));
  return normalizeMerges([...kept, { r, c, rs, cs }], rows, cols);
}

// Split the merge that contains (r, c), if any. Pure.
export function unmergeAt(table, r, c) {
  return (table.merges || []).filter((m) => !(r >= m.r && r < m.r + m.rs && c >= m.c && c < m.c + m.cs));
}
