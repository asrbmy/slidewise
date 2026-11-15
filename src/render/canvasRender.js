import { mergeMap } from '../model/tableMerge.js';
import { layoutText, fontString } from './textLayout.js';
import { resolveColor, slideBackground, seriesColor, fontStack } from './theme.js';
import { buildShapePath } from './shapes.js';
import { getImage } from './images.js';

let measureCtx = null;
export function measurer() {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  return (font, text) => { measureCtx.font = font; return measureCtx.measureText(text).width; };
}

// env: { deck, theme, measure, onImage, prompts: bool, hideId: string|null, hideText: Set<string> }
export function drawBackground(ctx, deck, slide) {
  const bg = slideBackground(deck.theme, slide);
  const { w, h } = deck.size;
  if (bg.type === 'gradient') {
    const a = ((bg.angle || 0) - 90) * Math.PI / 180, cx = w / 2, cy = h / 2, r = Math.hypot(w, h) / 2;
    const g = ctx.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    g.addColorStop(0, bg.colors[0]); g.addColorStop(1, bg.colors[1]); ctx.fillStyle = g;
  } else ctx.fillStyle = bg.color;
  ctx.fillRect(0, 0, w, h);
}

export function drawTextBlock(ctx, tx, w, h, env, o) {
  const { theme, measure } = env;
  const res = layoutText(tx, w, h, theme, measure);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
  const empty = tx.paras.every((p) => p.runs.every((r) => !r.t));
  if (empty && env.prompts && o && o.prompt) {
    ctx.fillStyle = resolveColor(theme, '@muted'); ctx.globalAlpha *= 0.7;
    ctx.font = fontString({ size: tx.size * (res.scale || 1), font: tx.font, i: true }, theme); ctx.textBaseline = 'alphabetic';
    const tw = measure(ctx.font, o.prompt);
    const x = tx.align === 'center' ? (w - tw) / 2 : tx.align === 'right' ? w - tw - tx.padding : tx.padding;
    ctx.fillText(o.prompt, x, res.offsetY + tx.size * (res.scale || 1) * 0.95);
    ctx.restore(); return;
  }
  for (const ln of res.lines) {
    const base = res.offsetY + ln.y + (ln.lh - ln.size) / 2 + ln.size * 0.82;
    if (ln.marker) { ctx.font = fontString(ln.marker.style, theme); ctx.fillStyle = ln.marker.style.color; ctx.textBaseline = 'alphabetic'; ctx.fillText(ln.marker.text, ln.marker.x + tx.padding, base); }
    for (const it of ln.items) {
      if (it.space && !it.style.hl && !it.style.u && !it.style.s) continue;
      ctx.font = fontString(it.style, theme); ctx.textBaseline = 'alphabetic';
      if (it.style.hl) { ctx.fillStyle = it.style.hl; ctx.fillRect(it.x, res.offsetY + ln.y + (ln.lh - ln.size * 1.15) / 2, it.w, ln.size * 1.15); }
      const col = it.style.link ? '#2563eb' : it.style.color;
      ctx.fillStyle = col; if (!it.space) ctx.fillText(it.text, it.x, base);
      if (it.style.u || it.style.link) { ctx.fillRect(it.x, base + ln.size * 0.1, it.w, Math.max(1, ln.size / 18)); }
      if (it.style.s) { ctx.fillRect(it.x, base - ln.size * 0.3, it.w, Math.max(1, ln.size / 18)); }
    }
  }
  ctx.restore();
}

function applyShadow(ctx, o, theme) {
  if (o.shadow && o.shadow.on) { ctx.shadowColor = resolveColor(theme, o.shadow.color, '#00000066'); ctx.shadowOffsetX = o.shadow.x; ctx.shadowOffsetY = o.shadow.y; ctx.shadowBlur = o.shadow.blur; }
}
function clearShadow(ctx) { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; }
function strokeStyle(ctx, st, theme) {
  ctx.lineWidth = st.width; ctx.strokeStyle = resolveColor(theme, st.color);
  ctx.setLineDash(st.dash === 'dashed' ? [st.width * 3, st.width * 2] : st.dash === 'dotted' ? [st.width, st.width * 1.6] : []);
  ctx.lineCap = st.dash === 'dotted' ? 'round' : 'butt';
}

export function drawObject(ctx, o, env) {
  const { theme } = env;
  if (env.hideId === o.id) return;
  ctx.save();
  ctx.translate(o.x + o.w / 2, o.y + o.h / 2);
  if (o.rot) ctx.rotate((o.rot * Math.PI) / 180);
  ctx.translate(-o.w / 2, -o.h / 2);
  ctx.globalAlpha *= o.opacity ?? 1;
  const w = o.w, h = o.h;
  switch (o.type) {
    case 'shape':
    case 'text': {
      const shape = o.type === 'shape' ? o.shape : 'rect';
      const fill = resolveColor(theme, o.fill, 'transparent');
      const grad = o.type === 'shape' && o.grad && shape !== 'line' ? o.grad : null;
      const hasFill = (fill !== 'transparent' || !!grad) && shape !== 'line';
      if (hasFill || (o.stroke && o.stroke.width > 0)) {
        buildShapePath(ctx, shape, w, h, o.radius);
        applyShadow(ctx, o, theme);
        if (hasFill) {
          if (grad) {
            const a = ((grad.angle || 0) - 90) * Math.PI / 180, cx = w / 2, cy = h / 2, r = (Math.abs(Math.cos(a)) * w + Math.abs(Math.sin(a)) * h) / 2;
            const g = ctx.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
            g.addColorStop(0, resolveColor(theme, grad.colors[0], '#000000')); g.addColorStop(1, resolveColor(theme, grad.colors[1], '#000000')); ctx.fillStyle = g;
          } else ctx.fillStyle = fill;
          ctx.fill();
        }
        clearShadow(ctx);
        if (o.stroke && o.stroke.width > 0) { strokeStyle(ctx, o.stroke, theme); if (!hasFill) applyShadow(ctx, o, theme); ctx.stroke(); clearShadow(ctx); ctx.setLineDash([]); }
      }
      if (o.tx && shape !== 'line' && !(env.hideText && env.hideText.has(o.id))) {
        if (o.shadow && o.shadow.on && !hasFill && !(o.stroke && o.stroke.width > 0)) applyShadow(ctx, o, theme);
        // triangles/stars/ellipses: text uses the box; keep within the bounding box.
        drawTextBlock(ctx, o.tx, w, h, env, o);
        clearShadow(ctx);
      }
      break;
    }
    case 'image': {
      const asset = env.deck.assets[o.assetId];
      const img = getImage(o.assetId, asset, env.onImage);
      ctx.save();
      buildShapePath(ctx, o.radius ? 'roundRect' : 'rect', w, h, o.radius);
      applyShadow(ctx, o, theme);
      ctx.fillStyle = img ? '#ffffff00' : resolveColor(theme, '@surface'); ctx.fill(); clearShadow(ctx);
      ctx.clip();
      if (img) {
        const c = o.crop || { x: 0, y: 0, w: 1, h: 1 }, a = o.adjust || {};
        const f = [];
        if (a.brightness !== undefined && a.brightness !== 100) f.push(`brightness(${a.brightness}%)`);
        if (a.contrast !== undefined && a.contrast !== 100) f.push(`contrast(${a.contrast}%)`);
        if (a.saturation !== undefined && a.saturation !== 100) f.push(`saturate(${a.saturation}%)`);
        if (a.grayscale) f.push(`grayscale(${a.grayscale}%)`);
        if (f.length && 'filter' in ctx) ctx.filter = f.join(' ');
        ctx.drawImage(img, c.x * img.naturalWidth, c.y * img.naturalHeight, c.w * img.naturalWidth, c.h * img.naturalHeight, 0, 0, w, h);
        if (f.length && 'filter' in ctx) ctx.filter = 'none';
      }
      ctx.restore();
      if (o.stroke && o.stroke.width > 0) { buildShapePath(ctx, o.radius ? 'roundRect' : 'rect', w, h, o.radius); strokeStyle(ctx, o.stroke, theme); ctx.stroke(); }
      break;
    }
    case 'table': drawTable(ctx, o, env); break;
    case 'chart': drawChart(ctx, o, env); break;
    case 'group': for (const c of o.children) drawObject(ctx, c, env); break;
    default: break;
  }
  ctx.restore();
}

function drawTable(ctx, o, env) {
  const { theme, measure } = env, st = o.tstyle;
  const rowH = o.h / o.rows;
  const mm = mergeMap(o.merges);
  applyShadow(ctx, o, theme);
  let y = 0;
  for (let r = 0; r < o.rows; r++) {
    let x = 0;
    for (let c = 0; c < o.cols; c++) {
      const mi = mm.get(r + ',' + c);
      if (mi && !mi.isAnchor) { x += o.colW[c] * o.w; continue; }
      const span = mi ? mi.m : { rs: 1, cs: 1 };
      let cw = 0; for (let k = 0; k < span.cs; k++) cw += o.colW[c + k] * o.w;
      const cellH = rowH * span.rs;
      const head = st.headerRow && r === 0;
      const fill = head ? st.headerFill : (st.zebra && r % 2 === 0 ? st.fill : '@bg');
      ctx.fillStyle = resolveColor(theme, fill); ctx.fillRect(x, y, cw, cellH); clearShadow(ctx);
      ctx.strokeStyle = resolveColor(theme, st.border); ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, cw - 1, cellH - 1);
      const tx = { paras: [{ runs: [{ t: o.cells[r][c], b: head }] }], font: st.font, size: st.size, color: head ? st.headerColor : st.color, align: 'left', valign: 'middle', lineSpacing: 1.15, autofit: true, padding: 8 };
      ctx.save(); ctx.translate(x, y); drawTextBlock(ctx, tx, cw, cellH, env, null); ctx.restore();
      x += o.colW[c] * o.w;
    }
    y += rowH;
  }
}

export function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
function drawChart(ctx, o, env) {
  const { theme, measure } = env;
  const w = o.w, h = o.h;
  const text = resolveColor(theme, '@text'), muted = resolveColor(theme, '@muted');
  const fs = Math.max(10, Math.min(w, h) * 0.045);
  const font = (b) => `${b ? 'bold ' : ''}${fs}px ${fontStack(theme, '@body')}`;
  let top = 6;
  if (o.title) { ctx.font = `bold ${fs * 1.25}px ${fontStack(theme, '@heading')}`; ctx.fillStyle = text; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(o.title, w / 2, top); top += fs * 1.25 + 10; }
  let bottom = h - 6;
  const legendItems = o.kind === 'pie' ? o.categories.map((c, i) => ({ name: c, color: theme.colors['accent' + ((i % 6) + 1)] })) : o.series.map((s, i) => ({ name: s.name, color: seriesColor(theme, s, i) }));
  if (o.legend && legendItems.length) {
    ctx.font = font(false); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const sw = fs, gap = fs * 0.5;
    const total = legendItems.reduce((n, it) => n + sw + gap + measure(ctx.font, it.name) + fs, 0);
    let lx = Math.max(6, (w - total) / 2); const ly = bottom - fs / 2;
    for (const it of legendItems) { ctx.fillStyle = it.color; ctx.fillRect(lx, ly - sw / 2, sw, sw); ctx.fillStyle = text; ctx.fillText(it.name, lx + sw + gap, ly); lx += sw + gap + measure(ctx.font, it.name) + fs; }
    bottom -= fs * 1.8;
  }
  if (o.kind === 'pie') {
    const vals = (o.series[0] ? o.series[0].values : []).map((v) => Math.max(0, v)), total = vals.reduce((a, b) => a + b, 0);
    const r = Math.max(10, Math.min(w, bottom - top) / 2 - 8), cx = w / 2, cy = top + (bottom - top) / 2;
    if (total > 0) {
      let a0 = -Math.PI / 2;
      vals.forEach((v, i) => {
        const a1 = a0 + (v / total) * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a0, a1); ctx.closePath();
        ctx.fillStyle = theme.colors['accent' + ((i % 6) + 1)]; ctx.fill(); ctx.strokeStyle = resolveColor(theme, '@bg'); ctx.lineWidth = 2; ctx.stroke();
        if (v / total > 0.06) { const am = (a0 + a1) / 2; ctx.fillStyle = '#ffffff'; ctx.font = font(true); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(Math.round((v / total) * 100) + '%', cx + Math.cos(am) * r * 0.65, cy + Math.sin(am) * r * 0.65); }
        a0 = a1;
      });
    }
    return;
  }
  const stacked = o.kind === 'bar' && o.stacked && o.series.length > 1;
  const all = stacked
    ? o.categories.flatMap((_, i) => [o.series.reduce((a, s) => a + Math.max(0, s.values[i] || 0), 0), o.series.reduce((a, s) => a + Math.min(0, s.values[i] || 0), 0)])
    : o.series.flatMap((s) => s.values);
  const maxV = niceMax(Math.max(0, ...all)), minV = Math.min(0, ...all) < 0 ? -niceMax(-Math.min(...all)) : 0;
  ctx.font = font(false);
  const labelW = Math.max(...[minV, maxV].map((v) => measure(ctx.font, String(v)))) + 8;
  const px0 = labelW + 8, px1 = w - 12, py0 = top + 4, py1 = bottom - fs * 1.6;
  const yOf = (v) => py1 - ((v - minV) / (maxV - minV || 1)) * (py1 - py0);
  const ticks = 4;
  ctx.save(); ctx.strokeStyle = muted; ctx.globalAlpha *= 0.35; ctx.lineWidth = 1;
  for (let i = 0; i <= ticks; i++) { const v = minV + ((maxV - minV) * i) / ticks, y = yOf(v); ctx.beginPath(); ctx.moveTo(px0, y); ctx.lineTo(px1, y); ctx.stroke(); }
  ctx.restore();
  ctx.fillStyle = muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let i = 0; i <= ticks; i++) { const v = minV + ((maxV - minV) * i) / ticks; ctx.fillText(String(+v.toFixed(2)), px0 - 6, yOf(v)); }
  const n = o.categories.length || 1, band = (px1 - px0) / n;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  o.categories.forEach((c, i) => { ctx.fillStyle = text; ctx.fillText(c, px0 + band * (i + 0.5), py1 + 6, band - 2); });
  if (o.kind === 'bar') {
    const ns = o.series.length || 1, gw = band * 0.72, bw = gw / ns;
    if (stacked) {
      const posAcc = o.categories.map(() => 0), negAcc = o.categories.map(() => 0);
      o.series.forEach((sr, si) => { ctx.fillStyle = seriesColor(theme, sr, si); sr.values.forEach((v, i) => {
        const base = v >= 0 ? posAcc[i] : negAcc[i]; const ya = yOf(base), yb = yOf(base + v); if (v >= 0) posAcc[i] += v; else negAcc[i] += v;
        ctx.fillRect(px0 + band * i + (band - gw) / 2, Math.min(ya, yb), Math.max(1, gw - 2), Math.abs(yb - ya)); }); });
      ctx.strokeStyle = muted; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(px0, yOf(0)); ctx.lineTo(px1, yOf(0)); ctx.stroke();
      return;
    }
    o.series.forEach((s, si) => { ctx.fillStyle = seriesColor(theme, s, si); s.values.forEach((v, i) => { const x = px0 + band * i + (band - gw) / 2 + bw * si, y0 = yOf(0), y1 = yOf(v); ctx.fillRect(x, Math.min(y0, y1), Math.max(1, bw - 2), Math.abs(y1 - y0)); }); });
  } else {
    o.series.forEach((s, si) => {
      const col = seriesColor(theme, s, si); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 3; ctx.lineJoin = 'round';
      if (o.area && s.values.length) {
        ctx.save(); ctx.globalAlpha *= 0.22; ctx.beginPath(); s.values.forEach((v, i) => { const x = px0 + band * (i + 0.5), y = yOf(v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.lineTo(px0 + band * (s.values.length - 0.5), yOf(0)); ctx.lineTo(px0 + band * 0.5, yOf(0)); ctx.closePath(); ctx.fill(); ctx.restore();
      }
      ctx.beginPath(); s.values.forEach((v, i) => { const x = px0 + band * (i + 0.5), y = yOf(v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
      s.values.forEach((v, i) => { ctx.beginPath(); ctx.arc(px0 + band * (i + 0.5), yOf(v), 4, 0, Math.PI * 2); ctx.fill(); });
    });
  }
  ctx.strokeStyle = muted; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(px0, yOf(0)); ctx.lineTo(px1, yOf(0)); ctx.stroke();
}

// Draw a whole slide at logical size (caller sets the transform for scaling).
export function drawSlide(ctx, deck, slide, opts = {}) {
  const env = { deck, theme: deck.theme, measure: opts.measure || measurer(), onImage: opts.onImage, prompts: !!opts.prompts, hideId: opts.hideId || null, hideText: opts.hideText || null };
  ctx.save();
  drawBackground(ctx, deck, slide);
  const limit = opts.visibleCount; // for animation steps: objects with anim.order > limit are skipped
  for (const o of slide.objects) {
    if (limit !== undefined && o.anim && o.anim.type !== 'none' && o.anim.order > limit) continue;
    if (opts.skip && opts.skip.has(o.id)) continue;
    if (opts.override && opts.override.has(o.id)) { drawObject(ctx, { ...o, ...opts.override.get(o.id) }, env); continue; }
    drawObject(ctx, o, env);
  }
  ctx.restore();
}

export function renderSlideToCanvas(deck, slide, pixelWidth, opts = {}) {
  const scale = pixelWidth / deck.size.w;
  const c = document.createElement('canvas');
  c.width = Math.round(deck.size.w * scale); c.height = Math.round(deck.size.h * scale);
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);
  drawSlide(ctx, deck, slide, opts);
  return c;
}
