import React, { useEffect, useRef, useState, useCallback, useLayoutEffect } from 'react';
import { drawSlide } from '../render/canvasRender.js';
import { bounds, unionBounds, rectsIntersect, pointInObject } from '../model/geometry.js';
import { computeSnap, resizeBox, rotationFromPointer } from '../editor/transform.js';
import { describeObject } from '../editor/describe.js';
import { updateObjects } from '../model/ops.js';
import TextEditor from './TextEditor.jsx';

const HANDLES = [[-1, -1, 'nw'], [0, -1, 'n'], [1, -1, 'ne'], [1, 0, 'e'], [1, 1, 'se'], [0, 1, 's'], [-1, 1, 'sw'], [-1, 0, 'w']];
const CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
const hasText = (o) => o.type === 'text' || o.type === 'shape';

export default function SlideCanvas({ deck, present, slide, zoom, sel, setSel, api, draft, setDraft, commitDraft, editingId, setEditingId, snapOn, onContext, bridge, readOnly }) {
  const canvasRef = useRef(null), stageRef = useRef(null);
  const [imgTick, setImgTick] = useState(0);
  const [guides, setGuides] = useState([]);
  const [marquee, setMarquee] = useState(null);
  const drag = useRef(null);
  // Window listeners must have a stable identity (they are added once per drag and removed on release); they call the latest handlers via a ref.
  const latest = useRef({});
  const stableMove = useRef((e) => latest.current.move(e)).current;
  const stableUp = useRef((e) => latest.current.up(e)).current;
  const raf = useRef(0);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const { w: SW, h: SH } = deck.size;

  // ---- draw the slide to the canvas (coalesced to one paint per frame) ----
  useLayoutEffect(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const c = canvasRef.current; if (!c) return;
      const pw = Math.min(4096, Math.round(SW * zoom * dpr)), ph = Math.round(pw * (SH / SW));
      if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
      const ctx = c.getContext('2d');
      ctx.setTransform(pw / SW, 0, 0, pw / SW, 0, 0);
      ctx.clearRect(0, 0, SW, SH);
      const hideText = editingId ? new Set([editingId]) : null;
      drawSlide(ctx, deck, slide, { prompts: !readOnly, hideText, onImage: () => setImgTick((t) => t + 1) });
      c.dataset.painted = String(Number(c.dataset.painted || 0) + 1);
    });
    return () => cancelAnimationFrame(raf.current);
  }, [deck, slide, zoom, dpr, SW, SH, editingId, imgTick, readOnly]);

  const toSlide = useCallback((e) => {
    const r = stageRef.current.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  }, [zoom]);

  const selected = slide.objects.filter((o) => sel.includes(o.id));
  const selSet = new Set(sel);

  // ---- pointer interactions ----
  const beginDrag = (e, mode, extra = {}) => {
    const p = toSlide(e);
    const starts = new Map(slide.objects.filter((o) => selSet.has(o.id) || extra.ids?.includes(o.id)).map((o) => [o.id, { x: o.x, y: o.y, w: o.w, h: o.h, rot: o.rot || 0 }]));
    drag.current = { mode, p0: p, starts, moved: false, slideId: slide.id, ...extra };
    window.addEventListener('pointermove', stableMove);
    window.addEventListener('pointerup', stableUp);
    window.addEventListener('pointercancel', stableUp);
  };
  const onMove = (e) => {
    const d = drag.current; if (!d) return;
    const p = toSlide(e);
    let dx = p.x - d.p0.x, dy = p.y - d.p0.y;
    if (!d.moved && Math.hypot(dx, dy) * zoom < 3) return;
    d.moved = true;
    const patches = new Map();
    if (d.mode === 'move') {
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const items = [...d.starts.entries()].filter(([id]) => !slide.objects.find((o) => o.id === id).locked);
      const startObjs = items.map(([id, s]) => ({ id, ...s }));
      const ub = unionBounds(startObjs);
      const moved = { x: ub.x + dx, y: ub.y + dy, w: ub.w, h: ub.h };
      const others = slide.objects.filter((o) => !d.starts.has(o.id)).map(bounds);
      const sn = computeSnap(moved, others, deck.size, 6 / zoom, snapOn && !e.altKey);
      dx += sn.dx; dy += sn.dy; setGuides(sn.guides);
      for (const [id, s] of items) patches.set(id, { x: s.x + dx, y: s.y + dy });
    } else if (d.mode === 'resize') {
      const [id, s] = [...d.starts.entries()][0];
      const o = slide.objects.find((x) => x.id === id);
      const r = resizeBox(s, d.handle, dx, dy, { keepAspect: e.shiftKey || o.type === 'image', fromCenter: e.altKey, lineLike: o.type === 'shape' && o.shape === 'line' });
      patches.set(id, r);
    } else if (d.mode === 'rotate') {
      const [id, s] = [...d.starts.entries()][0];
      const c = { x: s.x + s.w / 2, y: s.y + s.h / 2 };
      patches.set(id, { rot: rotationFromPointer(c, p.x, p.y, e.shiftKey) });
    } else if (d.mode === 'marquee') {
      const r = { x: Math.min(d.p0.x, p.x), y: Math.min(d.p0.y, p.y), w: Math.abs(p.x - d.p0.x), h: Math.abs(p.y - d.p0.y) };
      setMarquee(r);
      const hit = slide.objects.filter((o) => rectsIntersect(bounds(o), r)).map((o) => o.id);
      setSel(e.shiftKey ? Array.from(new Set([...d.base, ...hit])) : hit);
      return;
    }
    d.patches = patches;
    setDraft({ slideId: d.slideId, patches });
  };
  const onUp = () => {
    window.removeEventListener('pointermove', stableMove); window.removeEventListener('pointerup', stableUp); window.removeEventListener('pointercancel', stableUp);
    const d = drag.current; drag.current = null; setGuides([]); setMarquee(null);
    if (!d) return;
    if (d.mode === 'marquee') return;
    if (d.moved && d.patches && d.patches.size) {
      let next = present;
      for (const [id, patch] of d.patches) next = updateObjects(next, d.slideId, [id], patch);
      commitDraft(next, null);
    } else {
      setDraft(null);
      if (d.mode === 'move' && d.clickId && !d.shift) { if (sel.length > 1 && selSet.has(d.clickId)) setSel([d.clickId]); }
    }
  };
  latest.current = { move: onMove, up: onUp };
  useEffect(() => () => { window.removeEventListener('pointermove', stableMove); window.removeEventListener('pointerup', stableUp); window.removeEventListener('pointercancel', stableUp); drag.current = null; }, [stableMove, stableUp]);

  const onObjectDown = (e, o) => {
    if (readOnly || e.button === 2) { if (e.button === 2 && !selSet.has(o.id)) setSel([o.id]); return; }
    e.stopPropagation();
    if (editingId === o.id) return;
    if (editingId) setEditingId(null);
    let nextSel = sel;
    if (e.shiftKey || e.metaKey || e.ctrlKey) { nextSel = selSet.has(o.id) ? sel.filter((i) => i !== o.id) : [...sel, o.id]; setSel(nextSel); if (!nextSel.includes(o.id)) return; }
    else if (!selSet.has(o.id)) { nextSel = [o.id]; setSel(nextSel); }
    if (o.locked) return;
    // begin move for every selected object
    const ids = nextSel;
    const starts = new Map(slide.objects.filter((x) => ids.includes(x.id)).map((x) => [x.id, { x: x.x, y: x.y, w: x.w, h: x.h, rot: x.rot || 0 }]));
    drag.current = { mode: 'move', p0: toSlide(e), starts, moved: false, slideId: slide.id, clickId: o.id, shift: e.shiftKey };
    window.addEventListener('pointermove', stableMove); window.addEventListener('pointerup', stableUp); window.addEventListener('pointercancel', stableUp);
  };
  const onStageDown = (e) => {
    if (readOnly || e.button === 2) return;
    if (editingId) setEditingId(null);
    const base = e.shiftKey ? sel : [];
    if (!e.shiftKey) setSel([]);
    drag.current = { mode: 'marquee', p0: toSlide(e), starts: new Map(), moved: false, slideId: slide.id, base };
    window.addEventListener('pointermove', stableMove); window.addEventListener('pointerup', stableUp); window.addEventListener('pointercancel', stableUp);
  };
  const onHandleDown = (e, h, o) => { e.stopPropagation(); e.preventDefault(); beginDrag(e, 'resize', { handle: h, ids: [o.id] }); };
  const onRotateDown = (e, o) => { e.stopPropagation(); e.preventDefault(); beginDrag(e, 'rotate', { ids: [o.id] }); };

  const startEdit = (o) => { if (hasText(o) && !o.locked && !readOnly) { setSel([o.id]); setEditingId(o.id); } };
  const onObjectKey = (e, o) => {
    if (e.key === 'Enter' || e.key === 'F2') { if (hasText(o)) { e.preventDefault(); startEdit(o); } }
  };

  const ctxMenu = (e, o) => {
    if (readOnly) return;
    e.preventDefault();
    if (o && !selSet.has(o.id)) setSel([o.id]);
    onContext({ x: e.clientX, y: e.clientY, onObject: !!o });
  };

  const single = selected.length === 1 ? selected[0] : null;
  const showHandles = single && !single.locked && editingId !== single.id && !readOnly;
  const unionSel = selected.length > 1 ? unionBounds(selected) : null;
  const editing = editingId ? slide.objects.find((o) => o.id === editingId) : null;

  return (
    <div className="stage-scroll" data-testid="stage-scroll">
      <div className="stage" ref={stageRef} style={{ width: SW * zoom, height: SH * zoom, '--zoom': zoom }} data-testid="stage">
        <canvas ref={canvasRef} className="slide-canvas" aria-hidden="true" data-testid="slide-canvas" style={{ width: SW * zoom, height: SH * zoom }} />
        <div
          className="overlay"
          style={{ width: SW, height: SH, transform: `scale(${zoom})` }}
          role="listbox"
          aria-multiselectable="true"
          aria-label={`Slide objects (${slide.objects.length})`}
          onPointerDown={onStageDown}
          onContextMenu={(e) => ctxMenu(e, null)}
        >
          {slide.objects.map((o, i) => {
            const isSel = selSet.has(o.id);
            return (
              <div
                key={o.id}
                className={'obj' + (isSel ? ' selected' : '') + (o.locked ? ' locked' : '') + (editingId === o.id ? ' editing' : '')}
                data-obj-id={o.id}
                data-type={o.type}
                role="option"
                aria-selected={isSel}
                aria-roledescription={o.type === 'text' ? 'text box' : o.type}
                aria-label={describeObject(o) + (o.locked ? ' (locked)' : '')}
                tabIndex={readOnly ? -1 : 0}
                style={{ left: o.x, top: o.y, width: o.w, height: Math.max(o.h, 1), transform: o.rot ? `rotate(${o.rot}deg)` : undefined, zIndex: i + 1, cursor: o.locked ? 'default' : editingId === o.id ? 'text' : 'move', touchAction: isSel ? 'none' : 'auto' }}
                onPointerDown={(e) => onObjectDown(e, o)}
                onDoubleClick={(e) => { e.stopPropagation(); startEdit(o); }}
                onKeyDown={(e) => onObjectKey(e, o)}
                onFocus={() => { if (!readOnly && !selSet.has(o.id) && !drag.current) setSel([o.id]); }}
                onContextMenu={(e) => { e.stopPropagation(); ctxMenu(e, o); }}
              >
                {editingId === o.id && hasText(o) && (
                  <TextEditor obj={o} deck={deck} bridge={bridge} onDone={(paras) => { setEditingId(null); if (paras) api.patchObj(o.id, { tx: { ...o.tx, paras } }, 'text:' + o.id); }} />
                )}
              </div>
            );
          })}
          {guides.map((g, i) => <div key={i} className={'guide ' + g.axis} style={g.axis === 'x' ? { left: g.pos, top: g.from, height: g.to - g.from } : { top: g.pos, left: g.from, width: g.to - g.from }} />)}
          {unionSel && <div className="sel-box multi" style={{ left: unionSel.x, top: unionSel.y, width: unionSel.w, height: unionSel.h }} />}
          {showHandles && (
            <div className="sel-box" style={{ left: single.x, top: single.y, width: single.w, height: Math.max(single.h, 1), transform: single.rot ? `rotate(${single.rot}deg)` : undefined }}>
              {HANDLES.filter(([hx, hy]) => !(single.type === 'shape' && single.shape === 'line' && hy !== 0)).map(([hx, hy, name]) => (
                <div key={name} className={'handle h-' + name} data-handle={name} style={{ cursor: CURSORS[name] }} onPointerDown={(e) => onHandleDown(e, [hx, hy], single)} />
              ))}
              <div className="rotate-stem" /><div className="handle rotate" data-handle="rotate" title="Rotate" onPointerDown={(e) => onRotateDown(e, single)} />
            </div>
          )}
          {marquee && <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
        </div>
      </div>
    </div>
  );
}
export { pointInObject };
