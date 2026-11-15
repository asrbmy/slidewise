import React, { useEffect, useRef, useState } from 'react';
import { renderSlideToCanvas } from '../render/canvasRender.js';
import { preloadImages } from '../render/images.js';
import { visibleSlides, visibleLimit } from './engine.js';

function Mini({ deck, slide, step, width, label }) {
  const ref = useRef(null);
  useEffect(() => {
    let dead = false;
    const paint = () => { if (dead) return; const c = renderSlideToCanvas(deck, slide, Math.round(width * Math.min(2, window.devicePixelRatio || 1)), { visibleCount: visibleLimit(slide, step), onImage: () => requestAnimationFrame(paint) }); const t = ref.current; if (!t) return; t.width = c.width; t.height = c.height; t.getContext('2d').drawImage(c, 0, 0); };
    preloadImages(deck).then(paint); paint();
    return () => { dead = true; };
  }, [deck, slide, step, width]);
  return <canvas ref={ref} role="img" aria-label={label} style={{ width, height: width * deck.size.h / deck.size.w, background: '#fff' }} />;
}
const fmt = (ms) => { const s = Math.floor(ms / 1000); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0'); };

export default function PresenterView({ id }) {
  const [deck, setDeck] = useState(null), [pos, setPos] = useState(0), [step, setStep] = useState(0), [connected, setConnected] = useState(false);
  const [elapsed, setElapsed] = useState(0), [running, setRunning] = useState(true);
  const ch = useRef(null), base = useRef(Date.now()), acc = useRef(0);
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return undefined;
    const c = new BroadcastChannel('slidewise-' + id); ch.current = c;
    c.onmessage = (e) => { const m = e.data; if (!m) return; if (m.type === 'init' && m.deck) { setDeck(m.deck); setPos(m.pos); setStep(m.step); setConnected(true); } else if (m.type === 'state') { setPos(m.pos); setStep(m.step); setConnected(true); } };
    const hello = () => c.postMessage({ type: 'hello' }); hello(); const t = setInterval(() => { if (!deck) hello(); }, 1000);
    return () => { clearInterval(t); c.close(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => { const t = setInterval(() => { if (running) setElapsed(acc.current + Date.now() - base.current); }, 500); return () => clearInterval(t); }, [running]);
  // per-slide timer for rehearsal: resets when the slide changes, pauses with the main timer
  const [slideMs, setSlideMs] = useState(0); const sl = useRef({ pos: -1, ms: 0, t: Date.now() });
  useEffect(() => { sl.current = { pos, ms: 0, t: Date.now() }; setSlideMs(0); }, [pos]);
  useEffect(() => { const t = setInterval(() => { const now = Date.now(); if (running) { sl.current.ms += now - sl.current.t; setSlideMs(sl.current.ms); } sl.current.t = now; }, 500); return () => clearInterval(t); }, [running]);
  const toggle = () => { if (running) { acc.current += Date.now() - base.current; setRunning(false); } else { base.current = Date.now(); setRunning(true); } };
  const reset = () => { acc.current = 0; base.current = Date.now(); setElapsed(0); };
  const cmd = (c, extra) => ch.current && ch.current.postMessage({ type: 'cmd', cmd: c, ...extra });
  useEffect(() => {
    const on = (e) => { if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); cmd('next'); } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); cmd('prev'); } else if (e.key.toLowerCase() === 'b') cmd('black'); else if (e.key.toLowerCase() === 'w') cmd('white'); };
    window.addEventListener('keydown', on); return () => window.removeEventListener('keydown', on);
  }, []);
  useEffect(() => { document.title = 'Presenter view — Slidewise'; }, []);

  if (!deck) return <main className="center-msg" role="main"><h1>Presenter view</h1><div role="status"><p>Waiting for the slideshow… Start “Present” in the main Slidewise window (same browser). This view talks to it directly on your device; no server is used.</p>{typeof BroadcastChannel === 'undefined' && <p role="alert">This browser does not support BroadcastChannel.</p>}</div></main>;
  const vis = visibleSlides(deck); const cur = vis[Math.min(pos, vis.length - 1)]; const nxt = vis[pos + 1];
  return (
    <main className="pv">
      <h1 className="sr-only">Presenter view</h1>
      <div className="pv-bar"><span className="pv-timer" role="timer" aria-label="Elapsed time" data-testid="pv-timer">{fmt(elapsed)}</span>
        <button type="button" className="btn" onClick={toggle}>{running ? 'Pause' : 'Resume'}</button><button type="button" className="btn" onClick={reset}>Reset timer</button>
        <span className={'pv-slide-timer' + (cur.s.targetSec && slideMs > cur.s.targetSec * 1000 ? ' over' : '')} data-testid="pv-slide-timer" role="timer" aria-label="Time on this slide">{fmt(slideMs)}{cur.s.targetSec ? ' / ' + fmt(cur.s.targetSec * 1000) : ''}{cur.s.targetSec && slideMs > cur.s.targetSec * 1000 ? ' · over target' : ''}</span>
        <span className="grow" /><span data-testid="pv-pos" role="status">Slide {cur.i + 1} of {deck.slides.length}</span>
        <button type="button" className="btn" onClick={() => cmd('prev')}>◀ Previous</button><button type="button" className="btn primary" onClick={() => cmd('next')}>Next ▶</button>
        <button type="button" className="btn" onClick={() => cmd('black')}>Black</button><button type="button" className="btn" onClick={() => cmd('white')}>White</button></div>
      <div className="pv-current"><div><Mini deck={deck} slide={cur.s} step={step} width={Math.min(760, Math.max(260, window.innerWidth * 0.55))} label={`Current slide ${cur.i + 1}`} /></div></div>
      <div className="pv-next"><div>{nxt ? <Mini deck={deck} slide={nxt.s} step={0} width={Math.min(380, Math.max(200, window.innerWidth * 0.3))} label={`Next slide ${nxt.i + 1}`} /> : <p style={{ color: '#fff' }}>End of slideshow</p>}</div></div>
      <div className="pv-notes" aria-label="Speaker notes" data-testid="pv-notes" tabIndex={0}>{cur.s.notes || <span className="muted">No notes for this slide.</span>}</div>
    </main>
  );
}
