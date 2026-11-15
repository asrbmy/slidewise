// Rich text model: tx = { paras: [{ runs: [{ t, b, i, u, s, color, hl, size, font, link }], align?, list?, indent? }], font, size, color, align, valign, lineSpacing, autofit, padding }
export const RUN_FLAGS = ['b', 'i', 'u', 's'];

export function makeTx(partial = {}) {
  return {
    paras: [{ runs: [{ t: '' }] }],
    font: '@body', size: 28, color: '@text', align: 'left', valign: 'top', lineSpacing: 1.2, autofit: false, padding: 12,
    ...partial,
  };
}
export function plainToParas(str) {
  return String(str ?? '').split(/\r\n|\r|\n/).map((line) => ({ runs: [{ t: line }] }));
}
export function parasToPlain(paras) {
  return (paras || []).map((p) => (p.runs || []).map((r) => r.t || '').join('')).join('\n');
}
export function txFromPlain(str, partial = {}) { return makeTx({ paras: plainToParas(str), ...partial }); }
export function isTxEmpty(tx) { return !tx || parasToPlain(tx.paras).trim() === ''; }

// Apply a formatting change to every run of a text block (used when an object is selected but not being edited).
export function applyTextFormat(tx, fmt) {
  const next = { ...tx, paras: tx.paras.map((p) => ({ ...p, runs: p.runs.map((r) => ({ ...r })) })) };
  for (const k of ['font', 'size', 'color', 'align', 'valign', 'lineSpacing', 'autofit', 'padding']) {
    if (k in fmt) next[k] = fmt[k];
  }
  const clearRun = { font: 'font', size: 'size', color: 'color' };
  for (const k of Object.keys(clearRun)) {
    if (k in fmt) next.paras.forEach((p) => p.runs.forEach((r) => { delete r[clearRun[k]]; }));
  }
  if ('align' in fmt) next.paras.forEach((p) => { delete p.align; });
  for (const flag of RUN_FLAGS) {
    if (flag in fmt) {
      const val = fmt[flag] === 'toggle' ? !next.paras.every((p) => p.runs.every((r) => !r.t || r[flag])) : !!fmt[flag];
      next.paras.forEach((p) => p.runs.forEach((r) => { if (val) r[flag] = true; else delete r[flag]; }));
    }
  }
  if ('hl' in fmt) next.paras.forEach((p) => p.runs.forEach((r) => { if (fmt.hl) r.hl = fmt.hl; else delete r.hl; }));
  if ('link' in fmt) next.paras.forEach((p) => p.runs.forEach((r) => { if (fmt.link) r.link = fmt.link; else delete r.link; }));
  if ('list' in fmt) next.paras.forEach((p) => { if (fmt.list === 'none') delete p.list; else p.list = fmt.list; });
  return next;
}

export function safeLink(url) {
  if (typeof url !== 'string') return null;
  const u = url.trim();
  if (/^(https?:\/\/|mailto:)/i.test(u) && u.length <= 2000 && !/[\s<>"']/.test(u)) return u;
  return null;
}

// Replace within runs of a paragraph list. Matching is done per run (a match spanning two differently formatted runs is not replaced).
export function replaceInTx(tx, find, repl, opts = {}) {
  if (!find) return { tx, count: 0 };
  const flags = opts.matchCase ? 'g' : 'gi';
  const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  let count = 0;
  const paras = tx.paras.map((p) => ({ ...p, runs: p.runs.map((r) => {
    if (!r.t) return r;
    const t = r.t.replace(re, () => { count++; return repl; });
    return t === r.t ? r : { ...r, t };
  }) }));
  return { tx: count ? { ...tx, paras } : tx, count };
}
export function countInText(str, find, matchCase) {
  if (!find) return 0;
  const hay = matchCase ? str : str.toLowerCase();
  const needle = matchCase ? find : find.toLowerCase();
  let i = 0, n = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}
