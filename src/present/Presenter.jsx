import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { drawSlide, measurer, renderSlideToCanvas, drawObject } from '../render/canvasRender.js';
import { preloadImages } from '../render/images.js';
import { visibleSlides, animOrders, visibleLimit, entranceObjects, animPatch, drawTransition, nextState, prevState, prefersReducedMotion } from './engine.js';
import { navigate } from '../router.js';
import { parseHash } from '../router.js';
import { applyAnimPatch } from './engine.js';

const FOCUSABLE_KEYS = new Set(['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', ' ', 'PageDown', 'PageUp', 'Enter', 'Backspace', 'Home', 'End']);

export default function Presenter({ deck }) {
  const vis = useMemo(() => visibleSlides(deck), [deck]);
  const query = parseHash(window.location.hash).query;
  const startPos = Math.max(0, vis.findIndex((x) => x.i >= (parseInt(query.s, 10) || 0)));
  const [st, setSt] = useState({ pos: startPos < 0 ? 0 : startPos, step: 0 });
  const [cover, setCover] = useState(null); // 'black' | 'white' | null
  const [tool, setTool] = useState(null); // null | 'laser' | 'pen'
  const [progress, setProgress] = useState(true);
  const [hideCursor, setHideCursor] = useState(false);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [announce, setAnnounce] = useState('');
  const rootRef = useRef(null), canvasRef = useRef(null), inkRef = useRef(null), laserRef = useRef(null);
  const stRef = useRef(st); stRef.current = st;
  const anim = useRef({ raf: 0, token: 0 });
  const strokes = useRef(new Map()); // slide id -> [[{x,y}...]] normalized
  const drawing = useRef(null);
  const channel = useRef(null);
  const startedAt = useRef(Date.now());
  const entered = useRef(false);

  const fit = useMemo(() => { const k = Math.min(size.w / deck.size.w, size.h / deck.size.h); return { k, w: Math.floor(deck.size.w * k), h: Math.floor(deck.size.h * k) }; }, [size, deck.size]);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const measure = useMemo(() => measurer(), []);

  const paint = useCallback((slide, step, extra = {}) => {
    const c = canvasRef.current; if (!c) return;
    const pw = Math.round(fit.w * dpr), ph = Math.round(fit.h * dpr);
    if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
    const ctx = c.getContext('2d'); ctx.setTransform(pw / deck.size.w, 0, 0, pw / deck.size.w, 0, 0); ctx.clearRect(0, 0, deck.size.w, deck.size.h);
    drawSlide(ctx, deck, slide, { measure, visibleCount: visibleLimit(slide, step), onImage: () => paint(slide, step), ...extra });
    c.dataset.painted = String(Number(c.dataset.painted || 0) + 1);
  }, [deck, fit, dpr, measure]);

  const drawInk = useCallback(() => {
    const c = inkRef.current; if (!c) return;
    const pw = Math.round(fit.w * dpr), ph = Math.round(fit.h * dpr);
    if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
    const ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height);
    const slide = vis[stRef.current.pos].s; const list = strokes.current.get(slide.id) || [];
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#ef4444'; ctx.lineWidth = Math.max(3, c.width / 260);
    for (const s of list) { if (!s.length) continue; ctx.beginPath(); ctx.moveTo(s[0].x * c.width, s[0].y * c.height); for (const p of s.slice(1)) ctx.lineTo(p.x * c.width, p.y * c.height); if (s.length === 1) ctx.lineTo(s[0].x * c.width + 0.1, s[0].y * c.height); ctx.stroke(); }
  }, [fit, dpr, vis]);

  // ---- run an entrance animation / transition on the canvas ----
  const cancelAnim = () => { cancelAnimationFrame(anim.current.raf); anim.current.token++; };
  const runFrames = (duration, onFrame, onDone) => {
    const token = ++anim.current.token; const t0 = performance.now();
    const tick = (now) => { if (token !== anim.current.token) return; const t = Math.min(1, (now - t0) / duration); onFrame(t); if (t < 1) anim.current.raf = requestAnimationFrame(tick); else onDone(); };
    anim.current.raf = requestAnimationFrame(tick);
  };
  const show = useCallback((next, prev, kind) => {
    const slide = vis[next.pos].s; const reduced = prefersReducedMotion();
    if (kind === 'step' && !reduced) {
      const objs = entranceObjects(slide, next.step - 1); const dur = Math.max(100, ...objs.map((o) => o.anim.duration));
      const override = (t) => new Map(objs.map((o) => [o.id, animPatch(o, Math.min(1, t * dur / o.anim.duration), deck.size)]));
      runFrames(dur, (t) => paint(slide, next.step, { visibleCount: visibleLimit(slide, next.step), override: override(t) }), () => paint(slide, next.step));
      return;
    }
    if (kind === 'slide' && !reduced && slide.transition && slide.transition.type !== 'none' && prev) {
      const pw = Math.round(fit.w * dpr), ph = Math.round(fit.h * dpr);
      const mk = (sl, step) => { const c = document.createElement('canvas'); c.width = pw; c.height = ph; const x = c.getContext('2d'); x.setTransform(pw / deck.size.w, 0, 0, pw / deck.size.w, 0, 0); drawSlide(x, deck, sl, { measure, visibleCount: visibleLimit(sl, step) }); return c; };
      const from = mk(vis[prev.pos].s, prev.step), to = mk(slide, next.step); const dir = next.pos >= prev.pos ? 1 : -1;
      const c = canvasRef.current; const ctx = c.getContext('2d');
      runFrames(slide.transition.duration, (t) => { ctx.setTransform(1, 0, 0, 1, 0, 0); drawTransition(ctx, from, to, slide.transition.type, t, pw, ph, dir); }, () => paint(slide, next.step));
      return;
    }
    cancelAnim(); paint(slide, next.step);
  }, [vis, deck, paint, fit, dpr, measure]);

  const go = useCallback((fn) => {
    const prev = stRef.current; const nxt = fn(deck, prev);
    if (nxt.kind === 'end' || nxt.kind === 'start') { if (nxt.kind === 'end') setCover('endcard'); return; }
    if (cover === 'endcard') setCover(null);
    setSt({ pos: nxt.pos, step: nxt.step }); stRef.current = { pos: nxt.pos, step: nxt.step };
    show(nxt, prev, nxt.kind);
    setAnnounce(`Slide ${vis[nxt.pos].i + 1} of ${deck.slides.length}`);
  }, [deck, show, vis, cover]);
  const next = useCallback(() => { if (cover && cover !== 'endcard') { setCover(null); return; } go(nextState); }, [go, cover]);
  const prev = useCallback(() => { if (cover && cover !== 'endcard') { setCover(null); return; } go(prevState); }, [go, cover]);
  const jump = useCallback((pos) => { const p = Math.max(0, Math.min(vis.length - 1, pos)); const old = stRef.current; const n = { pos: p, step: 0 }; setSt(n); stRef.current = n; setCover(null); show(n, old, 'slide'); setAnnounce(`Slide ${vis[p].i + 1} of ${deck.slides.length}`); }, [vis, show, deck.slides.length]);
  const exit = useCallback(() => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); navigate('editor', deck.id); }, [deck.id]);

  // initial paint + resize
  useEffect(() => { preloadImages(deck).then(() => paint(vis[stRef.current.pos].s, stRef.current.step)); paint(vis[stRef.current.pos].s, stRef.current.step); }, [deck, paint, vis]);
  useEffect(() => { const on = () => setSize({ w: window.innerWidth, h: window.innerHeight }); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, []);
  useEffect(() => { drawInk(); }, [st.pos, fit, drawInk]);
  useEffect(() => () => cancelAnim(), []);

  // fullscreen (best effort; needs a user gesture in some browsers)
  useEffect(() => {
    const el = rootRef.current; el.focus();
    if (el.requestFullscreen && !query.nofs) el.requestFullscreen().then(() => { entered.current = true; }).catch(() => {});
    const onFs = () => { if (!document.fullscreenElement && entered.current) navigate('editor', deck.id); };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // cursor autohide
  useEffect(() => { let t; const on = () => { setHideCursor(false); clearTimeout(t); t = setTimeout(() => setHideCursor(true), 2500); }; window.addEventListener('pointermove', on); on(); return () => { window.removeEventListener('pointermove', on); clearTimeout(t); }; }, []);

  // ---- second-window presenter view over BroadcastChannel (no server) ----
  const snapshot = useCallback(() => ({ type: 'state', pos: stRef.current.pos, step: stRef.current.step, slideIndex: vis[stRef.current.pos].i, cover }), [vis, cover]);
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return undefined;
    const ch = new BroadcastChannel('slidewise-' + deck.id); channel.current = ch;
    ch.onmessage = (e) => {
      const m = e.data; if (!m || typeof m !== 'object') return;
      if (m.type === 'hello') ch.postMessage({ ...snapshot(), type: 'init', deck });
      else if (m.type === 'cmd') { if (m.cmd === 'next') next(); else if (m.cmd === 'prev') prev(); else if (m.cmd === 'black') setCover((c) => (c === 'black' ? null : 'black')); else if (m.cmd === 'white') setCover((c) => (c === 'white' ? null : 'white')); else if (m.cmd === 'goto' && Number.isInteger(m.pos)) jump(m.pos); }
    };
    return () => { ch.close(); channel.current = null; };
  }, [deck, snapshot, next, prev, jump]);
  useEffect(() => { channel.current && channel.current.postMessage(snapshot()); }, [st, cover, snapshot]);

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      if (k === 'Escape') { e.preventDefault(); exit(); return; }
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(k)) { e.preventDefault(); next(); }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) { e.preventDefault(); prev(); }
      else if (k === 'Home') { e.preventDefault(); jump(0); } else if (k === 'End') { e.preventDefault(); jump(vis.length - 1); }
      else if (k.toLowerCase() === 'b') setCover((c) => (c === 'black' ? null : 'black'));
      else if (k.toLowerCase() === 'w') setCover((c) => (c === 'white' ? null : 'white'));
      else if (k.toLowerCase() === 'l') setTool((t) => (t === 'laser' ? null : 'laser'));
      else if (k.toLowerCase() === 'p') setTool((t) => (t === 'pen' ? null : 'pen'));
      else if (k.toLowerCase() === 'e') { strokes.current.delete(vis[stRef.current.pos].s.id); drawInk(); }
      else if (k.toLowerCase() === 'g') setProgress((p) => !p);
      else if (k.toLowerCase() === 's') window.open('#/presenter-view/' + deck.id, 'slidewise-pv');
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, jump, exit, vis, drawInk, deck.id]);

  // ---- pointer: click/tap = next, swipe = navigate, pen/laser ----
  const ptr = useRef(null);
  const norm = (e) => { const r = canvasRef.current.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };
  const onDown = (e) => {
    if (e.target.closest && e.target.closest('.present-hud')) return;
    ptr.current = { x: e.clientX, y: e.clientY, t: Date.now(), moved: false };
    if (tool === 'pen') { const slide = vis[stRef.current.pos].s; const list = strokes.current.get(slide.id) || []; const s = [norm(e)]; list.push(s); strokes.current.set(slide.id, list); drawing.current = s; drawInk(); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
  };
  const onMove = (e) => {
    if (tool === 'laser' && laserRef.current) { const r = rootRef.current.getBoundingClientRect(); laserRef.current.style.left = e.clientX - r.left + 'px'; laserRef.current.style.top = e.clientY - r.top + 'px'; laserRef.current.style.display = 'block'; }
    if (ptr.current && Math.hypot(e.clientX - ptr.current.x, e.clientY - ptr.current.y) > 6) ptr.current.moved = true;
    if (tool === 'pen' && drawing.current) { drawing.current.push(norm(e)); drawInk(); }
  };
  const onUp = (e) => {
    const p = ptr.current; ptr.current = null; const wasDrawing = drawing.current; drawing.current = null;
    if (!p || wasDrawing) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { dx < 0 ? next() : prev(); return; }
    if (!p.moved && tool !== 'pen') next();
  };

  const slide = vis[st.pos].s; const total = vis.length;
  return (
    <div ref={rootRef} className={'present-root' + (hideCursor && tool !== 'pen' ? ' hide-cursor' : '')} tabIndex={-1} role="application" aria-roledescription="slideshow" aria-label={`${deck.name}, slideshow`} data-testid="present-root"
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { ptr.current = null; drawing.current = null; }}>
      <div className="sr-only" role="status" aria-live="polite" data-testid="present-announce">{announce}</div>
      <div className="present-canvas" style={{ width: fit.w, height: fit.h }}>
        <canvas ref={canvasRef} data-testid="present-canvas" data-pos={st.pos} data-step={st.step} style={{ width: fit.w, height: fit.h, display: 'block' }} role="img" aria-label={`Slide ${vis[st.pos].i + 1}: ${slide.notes ? '' : ''}${slide.objects.find((o) => o.role === 'title')?.tx.paras.map((p) => p.runs.map((r) => r.t).join('')).join(' ') || 'slide content'}`} />
        <canvas ref={inkRef} className="present-layer" style={{ width: fit.w, height: fit.h, pointerEvents: 'none' }} aria-hidden="true" />
      </div>
      {tool === 'laser' && <div className="laser" ref={laserRef} style={{ display: 'none' }} data-testid="laser" />}
      {progress && <div className="progress" role="progressbar" aria-label="Presentation progress" aria-valuemin={1} aria-valuemax={total} aria-valuenow={st.pos + 1}><div style={{ width: ((st.pos + 1) / total) * 100 + '%' }} /></div>}
      {cover === 'black' && <div className="screen-cover" style={{ background: '#000' }} data-testid="cover-black" />}
      {cover === 'white' && <div className="screen-cover" style={{ background: '#fff' }} data-testid="cover-white" />}
      {cover === 'endcard' && <div className="screen-cover" style={{ background: '#000', display: 'grid', placeContent: 'center', textAlign: 'center' }} data-testid="end-card"><p style={{ fontSize: 22 }}>End of slideshow</p><p style={{ opacity: .7 }}>Click or press ← to go back, Esc to exit</p></div>}
      <div className="present-hud">
        <button type="button" className="btn small" onClick={prev} aria-label="Previous">◀</button>
        <button type="button" className="btn small" onClick={next} aria-label="Next">▶</button>
        <button type="button" className="btn small" aria-pressed={tool === 'laser'} onClick={() => setTool(tool === 'laser' ? null : 'laser')}>Laser</button>
        <button type="button" className="btn small" aria-pressed={tool === 'pen'} onClick={() => setTool(tool === 'pen' ? null : 'pen')}>Pen</button>
        <button type="button" className="btn small" onClick={() => { strokes.current.delete(slide.id); drawInk(); }}>Clear pen</button>
        <button type="button" className="btn small" onClick={() => window.open('#/presenter-view/' + deck.id, 'slidewise-pv')}>Presenter view</button>
        <button type="button" className="btn small" onClick={() => { const el = rootRef.current; if (document.fullscreenElement) document.exitFullscreen(); else if (el.requestFullscreen) { entered.current = true; el.requestFullscreen().catch(() => {}); } }}>Fullscreen</button>
        <button type="button" className="btn small" onClick={exit}>Exit</button>
      </div>
    </div>
  );
}
void FOCUSABLE_KEYS; void applyAnimPatch; void renderSlideToCanvas; void drawObject; void animOrders;
