import DOMPurify from 'dompurify';
import { resolveColor, fontStack } from '../render/theme.js';
import { FONT_KEYS, FONTS } from '../model/constants.js';
import { safeLink } from '../model/text.js';
import { isColor } from '../model/validate.js';

const BLOCK = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE']);

// ---------- model -> DOM (built with createElement/textContent only; never innerHTML) ----------
export function buildEditorDom(root, tx, theme, scale = 1) {
  root.textContent = '';
  tx.paras.forEach((p) => {
    const div = document.createElement('div');
    if (p.list && p.list !== 'none') div.dataset.list = p.list;
    if (p.align) div.dataset.align = p.align;
    if (p.indent) div.dataset.indent = String(p.indent);
    let any = false;
    for (const r of p.runs) {
      if (!r.t) continue; any = true;
      let node = document.createElement('span');
      node.textContent = r.t;
      const st = node.style;
      if (r.b) st.fontWeight = 'bold';
      if (r.i) st.fontStyle = 'italic';
      const deco = [r.u ? 'underline' : '', r.s ? 'line-through' : ''].filter(Boolean).join(' ');
      if (deco) st.textDecoration = deco;
      if (r.color) { const rc = resolveColor(theme, r.color); st.color = rc; node.dataset.c = r.color; node.dataset.rc = rc; }
      if (r.hl) { const rc = resolveColor(theme, r.hl); st.backgroundColor = rc; node.dataset.h = r.hl; node.dataset.rh = rc; }
      if (r.size) st.fontSize = (r.size * scale) + 'px';
      if (r.font) { st.fontFamily = fontStack(theme, r.font); node.dataset.f = r.font; }
      if (r.link) { const a = document.createElement('a'); a.href = r.link; a.rel = 'noopener noreferrer'; a.appendChild(node); node = a; }
      div.appendChild(node);
    }
    if (!any) div.appendChild(document.createElement('br'));
    root.appendChild(div);
  });
}

// ---------- DOM -> model ----------
function rgbToHex(v) {
  if (!v) return null;
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\)$/.exec(v.trim());
  if (m) { if (m[4] !== undefined && parseFloat(m[4]) === 0) return null; return '#' + [m[1], m[2], m[3]].map((n) => Math.min(255, +n).toString(16).padStart(2, '0')).join(''); }
  return /^#[0-9a-f]{3,8}$/i.test(v.trim()) ? v.trim().toLowerCase() : null;
}
function fontFromCss(family) {
  if (!family) return null;
  const f = family.toLowerCase();
  for (const k of FONT_KEYS) { const first = FONTS[k].stack.split(',')[0].replace(/["']/g, '').trim().toLowerCase(); if (f.includes(first)) return k; }
  return null;
}
function styleOf(el, inherit, scale) {
  const s = { ...inherit };
  const tag = el.tagName;
  if (tag === 'B' || tag === 'STRONG') s.b = true;
  if (tag === 'I' || tag === 'EM') s.i = true;
  if (tag === 'U') s.u = true;
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') s.s = true;
  if (tag === 'A') { const l = safeLink(el.getAttribute('href')); if (l) s.link = l; }
  const st = el.style;
  if (st) {
    const fw = st.fontWeight; if (fw && (fw === 'bold' || fw === 'bolder' || parseInt(fw, 10) >= 600)) s.b = true; else if (fw && (fw === 'normal' || parseInt(fw, 10) < 600)) delete s.b;
    if (st.fontStyle === 'italic') s.i = true; else if (st.fontStyle === 'normal') delete s.i;
    const td = (st.textDecorationLine || st.textDecoration || '');
    if (td.includes('underline')) s.u = true; if (td.includes('line-through')) s.s = true;
    if (td === 'none') { delete s.u; delete s.s; }
    if (st.color) { const hex = rgbToHex(st.color); if (hex) { s.color = el.dataset && el.dataset.c && el.dataset.rc && rgbToHex(el.dataset.rc) === hex ? el.dataset.c : hex; } }
    if (st.backgroundColor) { const hex = rgbToHex(st.backgroundColor); if (hex) s.hl = el.dataset && el.dataset.h && el.dataset.rh && rgbToHex(el.dataset.rh) === hex ? el.dataset.h : hex; }
    const fs = /^([\d.]+)px$/.exec(st.fontSize || ''); if (fs) s.size = Math.round((parseFloat(fs[1]) / scale) * 10) / 10;
    if (st.fontFamily) { const k = (el.dataset && el.dataset.f) || fontFromCss(st.fontFamily); if (k) s.font = k; }
  }
  if (tag === 'FONT') {
    const c = rgbToHex(el.getAttribute('color')); if (c) s.color = c;
    const px = /^([\d.]+)px$/.exec(el.style.fontSize || ''); if (px) s.size = Math.round((parseFloat(px[1]) / scale) * 10) / 10;
  }
  return s;
}
const pushRun = (runs, text, s) => {
  if (!text) return;
  const r = { t: text };
  for (const k of ['b', 'i', 'u', 's']) if (s[k]) r[k] = true;
  if (s.color && isColor(s.color)) r.color = s.color;
  if (s.hl && isColor(s.hl)) r.hl = s.hl;
  if (s.size) r.size = s.size;
  if (s.font) r.font = s.font;
  if (s.link) r.link = s.link;
  const last = runs[runs.length - 1];
  const same = last && ['b', 'i', 'u', 's', 'color', 'hl', 'size', 'font', 'link'].every((k) => last[k] === r[k]);
  if (same) last.t += text; else runs.push(r);
};

export function domToParas(root, scale = 1) {
  const paras = [];
  let cur = null;
  const startPara = (el) => {
    cur = { runs: [] };
    if (el && el.dataset) {
      if (el.dataset.list === 'bullet' || el.dataset.list === 'number') cur.list = el.dataset.list;
      if (['left', 'center', 'right', 'justify'].includes(el.dataset.align)) cur.align = el.dataset.align;
      const ind = parseInt(el.dataset.indent, 10); if (ind > 0 && ind <= 8) cur.indent = ind;
    }
    if (el && (el.tagName === 'LI')) { const p = el.parentElement; if (p && p.tagName === 'OL') cur.list = 'number'; else if (!cur.list) cur.list = 'bullet'; }
    paras.push(cur);
  };
  const endPara = () => { cur = null; };
  const walk = (node, style, blockCtx) => {
    for (const ch of Array.from(node.childNodes)) {
      if (ch.nodeType === 3) { if (!cur) startPara(blockCtx); pushRun(cur.runs, ch.nodeValue.replace(/ /g, ' ').replace(/[\r\n]+/g, ' '), style); continue; }
      if (ch.nodeType !== 1) continue;
      const tag = ch.tagName;
      if (tag === 'BR') { if (!cur) startPara(blockCtx); else if (!cur.runs.length || ch.nextSibling) { /* line break inside paragraph -> new paragraph */ if (ch.nextSibling) { endPara(); } } continue; }
      if (tag === 'SCRIPT' || tag === 'STYLE') continue;
      if (BLOCK.has(tag) && tag !== 'UL' && tag !== 'OL') { endPara(); startPara(ch); walk(ch, styleOf(ch, style, scale), ch); endPara(); continue; }
      if (tag === 'UL' || tag === 'OL') { endPara(); walk(ch, style, ch); endPara(); continue; }
      walk(ch, styleOf(ch, style, scale), blockCtx);
    }
  };
  walk(root, {}, null);
  const out = paras.map((p) => ({ ...p, runs: p.runs.length ? p.runs : [{ t: '' }] }));
  return out.length ? out : [{ runs: [{ t: '' }] }];
}

// ---------- paste: sanitise first, then insert ----------
export function sanitizePastedHtml(html) {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS: ['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'a', 'br', 'p', 'div', 'span', 'ul', 'ol', 'li'], ALLOWED_ATTR: ['href'], ALLOW_DATA_ATTR: false, ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i, FORBID_ATTR: ['style', 'class', 'id'] });
}
export function htmlToParas(html) {
  const clean = sanitizePastedHtml(html);
  const doc = new DOMParser().parseFromString('<body>' + clean + '</body>', 'text/html');
  return domToParas(doc.body, 1);
}
