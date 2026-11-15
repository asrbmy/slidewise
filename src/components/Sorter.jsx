import React, { useRef, useState } from 'react';
import Thumb from './Thumb.jsx';
import { slideTitle } from '../editor/describe.js';

export default function Sorter({ deck, slideId, slideSel, api, onContext }) {
  const [dragIds, setDragIds] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const anchor = useRef(slideId);
  const listRef = useRef(null);

  const click = (e, s, i) => {
    if (e.shiftKey) {
      const a = deck.slides.findIndex((x) => x.id === anchor.current);
      const [lo, hi] = [Math.min(a, i), Math.max(a, i)];
      api.setSlideSel(deck.slides.slice(lo, hi + 1).map((x) => x.id));
    } else if (e.metaKey || e.ctrlKey) {
      const has = slideSel.includes(s.id);
      const next = has ? slideSel.filter((x) => x !== s.id) : [...slideSel, s.id];
      api.setSlideSel(next.length ? next : [s.id]);
    } else { anchor.current = s.id; api.setSlide(s.id); }
  };
  const onKey = (e, s, i) => {
    const focusIdx = (n) => { const el = listRef.current.querySelectorAll('[role=option]')[n]; if (el) el.focus(); };
    if (e.key === 'ArrowDown') { e.preventDefault(); const n = Math.min(deck.slides.length - 1, i + 1); if (e.altKey || e.ctrlKey) { api.moveSlides([s.id], n + 1); setTimeout(() => focusIdx(n), 0); } else { api.setSlide(deck.slides[n].id); focusIdx(n); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); const n = Math.max(0, i - 1); if (e.altKey || e.ctrlKey) { api.moveSlides([s.id], n); setTimeout(() => focusIdx(n), 0); } else { api.setSlide(deck.slides[n].id); focusIdx(n); } }
    else if (e.key === 'Home') { e.preventDefault(); api.setSlide(deck.slides[0].id); focusIdx(0); }
    else if (e.key === 'End') { e.preventDefault(); const n = deck.slides.length - 1; api.setSlide(deck.slides[n].id); focusIdx(n); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); api.deleteSlides(slideSel.includes(s.id) ? slideSel : [s.id]); }
    else if (e.key === 'Enter') { e.preventDefault(); document.querySelector('[data-testid=stage] [role=option]')?.focus(); }
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); onContext({ x: r.right - 20, y: r.top + 20, slide: true }); }
  };
  const drop = (e, index) => {
    e.preventDefault();
    if (dragIds) api.moveSlides(dragIds, index);
    setDragIds(null); setOverIdx(null);
  };

  return (
    <nav className="sorter" aria-label="Slides">
      <div className="sorter-list" ref={listRef} role="listbox" aria-label="Slide list" aria-multiselectable="true"
        onDragOver={(e) => { if (dragIds) e.preventDefault(); }}
        onDrop={(e) => drop(e, deck.slides.length)}>
        {deck.slides.map((s, i) => {
          const isCur = s.id === slideId, isSel = slideSel.includes(s.id);
          return (
            <div key={s.id} className="sorter-row"
              onDragOver={(e) => { if (!dragIds) return; e.preventDefault(); e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setOverIdx(e.clientY < r.top + r.height / 2 ? i : i + 1); }}
              onDrop={(e) => { e.stopPropagation(); drop(e, overIdx ?? i); }}>
              {overIdx === i && dragIds && <div className="drop-line" />}
              <span className="sorter-num" aria-hidden="true">{i + 1}</span>
              <div role="option" aria-selected={isSel} aria-current={isCur ? 'true' : undefined}
                aria-label={`Slide ${i + 1} of ${deck.slides.length}: ${slideTitle(s)}${s.hidden ? ' (hidden)' : ''}`}
                tabIndex={isCur ? 0 : -1} draggable
                className={'sorter-item' + (isSel ? ' selected' : '') + (isCur ? ' current' : '') + (s.hidden ? ' hidden-slide' : '')}
                data-slide-id={s.id}
                onClick={(e) => click(e, s, i)} onKeyDown={(e) => onKey(e, s, i)}
                onContextMenu={(e) => { e.preventDefault(); if (!slideSel.includes(s.id)) api.setSlide(s.id); onContext({ x: e.clientX, y: e.clientY, slide: true }); }}
                onDragStart={(e) => { const ids = slideSel.includes(s.id) ? slideSel : [s.id]; setDragIds(ids); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'slide'); }}
                onDragEnd={() => { setDragIds(null); setOverIdx(null); }}>
                <Thumb deck={deck} slide={s} width={168} />
                {s.hidden && <span className="hidden-badge" title="Hidden in the slideshow">Hidden</span>}
              </div>
            </div>
          );
        })}
        {overIdx === deck.slides.length && dragIds && <div className="drop-line" />}
      </div>
      <div className="sorter-actions">
        <button type="button" className="btn" onClick={() => api.addSlide()} aria-label="Add slide">+ Slide</button>
        <button type="button" className="btn" onClick={() => api.duplicateSlides(slideSel)} aria-label="Duplicate selected slides">Duplicate</button>
        <button type="button" className="btn" onClick={() => api.deleteSlides(slideSel)} aria-label="Delete selected slides" disabled={slideSel.length >= deck.slides.length}>Delete</button>
        <button type="button" className="btn" onClick={() => api.toggleHidden(slideSel)} aria-label="Hide or show selected slides">Hide</button>
      </div>
    </nav>
  );
}
