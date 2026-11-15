import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useEditor } from '../state/useEditor.js';
import { navigate } from '../router.js';
import SlideCanvas from './SlideCanvas.jsx';
import Sorter from './Sorter.jsx';
import MenuBar from './MenuBar.jsx';
import ContextMenu from './ContextMenu.jsx';
import { FormatPanel, SlidePanel, ThemePanel } from './Inspector.jsx';
import { ShortcutsDialog, FindDialog, VersionsDialog, SizeDialog, LockDialog } from './dialogs.jsx';
import { SHAPES, SHAPE_LABELS, CHART_KINDS, LAYOUTS, LAYOUT_LABELS, TRANSITIONS } from '../model/constants.js';
import { lockDeck, unlockPermanently, hasSession } from '../storage/deckStore.js';
import { MOD } from '../shortcuts.js';
import { slideIndex } from '../model/ops.js';

const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2];
const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

export default function Editor({ initialDeck, locked: initiallyLocked }) {
  const ed = useEditor(initialDeck);
  const { deck, slide, sel, selObjs, api, present } = ed;
  const [zoomMode, setZoomMode] = useState('fit'), [zoomVal, setZoomVal] = useState(1), [fitZoom, setFitZoom] = useState(0.6);
  const [editingId, setEditingId] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [ctx, setCtx] = useState(null);
  const [tab, setTab] = useState('format');
  const [snapOn, setSnapOn] = useState(true);
  const [showNotes, setShowNotes] = useState(true);
  const [locked, setLocked] = useState(!!initiallyLocked);
  const [busy, setBusy] = useState('');
  const bridge = useRef(null);
  const areaRef = useRef(null), fileRef = useRef(null), importRef = useRef(null);
  const zoom = zoomMode === 'fit' ? fitZoom : zoomVal;

  // fit-to-window
  useEffect(() => {
    const el = areaRef.current; if (!el) return undefined;
    const calc = () => { const r = el.getBoundingClientRect(); const pad = 32; const z = Math.min((r.width - pad) / deck.size.w, (r.height - pad) / deck.size.h); setFitZoom(Math.max(0.1, Math.min(3, z || 0.5))); };
    calc(); const ro = new ResizeObserver(calc); ro.observe(el); return () => ro.disconnect();
  }, [deck.size.w, deck.size.h, showNotes]);

  useEffect(() => { document.title = `${deck.name} — Slidewise`; return () => { document.title = 'Slidewise'; }; }, [deck.name]);
  useEffect(() => { if (editingId && !slide.objects.some((o) => o.id === editingId)) setEditingId(null); }, [slide, editingId]);
  useEffect(() => { setEditingId(null); }, [ed.slideId]);

  const setZoom = (z) => { setZoomMode('manual'); setZoomVal(Math.max(0.1, Math.min(4, z))); };
  const zoomStep = (dir) => { const cur = zoom; const next = dir > 0 ? ZOOMS.find((z) => z > cur + 0.01) : [...ZOOMS].reverse().find((z) => z < cur - 0.01); setZoom(next || cur); };
  const doPresent = (from) => { window.location.hash = '#/present/' + deck.id + (from > 0 ? '?s=' + from : ''); };
  const idx = slideIndex(deck, ed.slideId);
  const goSlide = (i) => { const s = deck.slides[Math.max(0, Math.min(deck.slides.length - 1, i))]; if (s) api.setSlide(s.id); };

  const openImagePicker = () => fileRef.current && fileRef.current.click();
  const onImagePicked = async (e) => { for (const f of Array.from(e.target.files || []).slice(0, 20)) await api.addImageFile(f); e.target.value = ''; };
  const runExport = async (kind) => {
    setBusy(`Exporting ${kind.toUpperCase()}…`);
    try { const m = await import('../export/exporters.js'); await m.exportDeck(kind, { ...deck, __current: slide.id }, (msg) => setBusy(msg)); ed.setMessage(`${kind.toUpperCase()} export ready.`); }
    catch (e) { ed.setMessage('Export failed: ' + (e.message || e)); } finally { setBusy(''); }
  };
  const runImport = async (e) => {
    const files = Array.from(e.target.files || []); e.target.value = ''; if (!files.length) return;
    setBusy('Importing…');
    try {
      const m = await import('../import/importers.js');
      const res = await m.importIntoDeck(deck, files, api);
      ed.setMessage(res.message);
    } catch (er) { ed.setMessage('Import failed: ' + (er.message || er)); } finally { setBusy(''); }
  };

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey; const k = e.key; const lk = k.length === 1 ? k.toLowerCase() : k;
      if (dialog) return;
      const typing = isTyping(e.target);
      if (mod && lk === 's') { e.preventDefault(); ed.saveNow('Manual save').then(() => ed.setMessage('Version saved.')).catch(() => {}); return; }
      if (mod && lk === 'f' && !e.shiftKey) { e.preventDefault(); setDialog('find'); return; }
      if (mod && (lk === '/' || k === '?')) { e.preventDefault(); setDialog('shortcuts'); return; }
      if (k === 'F5') { e.preventDefault(); doPresent(e.shiftKey || mod ? 0 : idx); return; }
      if (typing) { if (editingId && bridge.current && mod && lk === 'k') { e.preventDefault(); setTab('format'); } return; }
      if (k === '?' && !mod) { setDialog('shortcuts'); return; }
      if (mod && lk === 'z') { e.preventDefault(); e.shiftKey ? api.redo() : api.undo(); return; }
      if (mod && lk === 'y') { e.preventDefault(); api.redo(); return; }
      if (mod && lk === 'a') { e.preventDefault(); api.selectAll(); return; }
      if (mod && lk === 'c') { if (api.copy()) e.preventDefault(); return; }
      if (mod && lk === 'x') { if (sel.length) { e.preventDefault(); api.cut(); } return; }
      if (mod && lk === 'v') { e.preventDefault(); if (!api.paste()) api.pasteSlides(); return; }
      if (mod && lk === 'd') { e.preventDefault(); e.shiftKey ? api.duplicateSlides(ed.slideSel) : api.duplicateSel(); return; }
      if (mod && lk === 'g') { e.preventDefault(); e.shiftKey ? api.ungroup() : api.group(); return; }
      if (mod && lk === 'm') { e.preventDefault(); api.addSlide(); return; }
      if (mod && (k === ']' || k === '}')) { e.preventDefault(); api.z(e.shiftKey ? 'front' : 'forward'); return; }
      if (mod && (k === '[' || k === '{')) { e.preventDefault(); api.z(e.shiftKey ? 'back' : 'backward'); return; }
      if (mod && (k === '=' || k === '+')) { e.preventDefault(); zoomStep(1); return; }
      if (mod && k === '-') { e.preventDefault(); zoomStep(-1); return; }
      if (mod && k === '0') { e.preventDefault(); setZoomMode('fit'); return; }
      if (k === 'PageDown') { e.preventDefault(); goSlide(idx + 1); return; }
      if (k === 'PageUp') { e.preventDefault(); goSlide(idx - 1); return; }
      const onSorter = e.target.closest && e.target.closest('.sorter');
      if (onSorter) return;
      if ((k === 'Delete' || k === 'Backspace') && sel.length) { e.preventDefault(); api.deleteSel(); return; }
      if (k.startsWith('Arrow') && sel.length) { e.preventDefault(); const s = e.shiftKey ? 10 : 1; api.nudge(k === 'ArrowLeft' ? -s : k === 'ArrowRight' ? s : 0, k === 'ArrowUp' ? -s : k === 'ArrowDown' ? s : 0); return; }
      if (k === 'Escape') { if (ctx) setCtx(null); else api.setSel([]); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  // paste images from clipboard
  useEffect(() => {
    const onPaste = (e) => {
      if (isTyping(e.target) || dialog) return;
      const files = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith('image/'));
      if (files.length) { e.preventDefault(); files.slice(0, 10).forEach((f) => api.addImageFile(f)); }
    };
    document.addEventListener('paste', onPaste); return () => document.removeEventListener('paste', onPaste);
  });
  // drop images onto the stage
  const onDrop = (e) => { const files = Array.from(e.dataTransfer?.files || []); if (files.length) { e.preventDefault(); files.slice(0, 10).forEach((f) => api.addImageFile(f)); } };

  const has = sel.length > 0;
  const single = selObjs.length === 1 ? selObjs[0] : null;
  const objMenu = useMemo(() => [
    { label: 'Cut', shortcut: MOD + 'X', onSelect: api.cut, disabled: !has }, { label: 'Copy', shortcut: MOD + 'C', onSelect: api.copy, disabled: !has }, { label: 'Paste', shortcut: MOD + 'V', onSelect: () => { if (!api.paste()) api.pasteSlides(); } },
    { label: 'Duplicate', shortcut: MOD + 'D', onSelect: api.duplicateSel, disabled: !has }, { label: 'Delete', shortcut: 'Del', onSelect: api.deleteSel, disabled: !has }, { separator: true },
    { label: 'Bring to front', onSelect: () => api.z('front'), disabled: !has }, { label: 'Send to back', onSelect: () => api.z('back'), disabled: !has },
    { label: 'Group', shortcut: MOD + 'G', onSelect: api.group, disabled: selObjs.length < 2 }, { label: 'Ungroup', onSelect: api.ungroup, disabled: !selObjs.some((o) => o.type === 'group') },
    { label: selObjs.length && selObjs.every((o) => o.locked) ? 'Unlock' : 'Lock', onSelect: api.toggleLock, disabled: !has },
  ], [api, has, selObjs]);
  const slideMenu = useMemo(() => [
    { label: 'New slide', shortcut: MOD + 'M', onSelect: () => api.addSlide() }, { label: 'Duplicate slide', onSelect: () => api.duplicateSlides(ed.slideSel) },
    { label: 'Copy slide', onSelect: () => api.copySlides(ed.slideSel) }, { label: 'Paste slide', onSelect: () => api.pasteSlides() },
    { label: 'Hide / show slide', onSelect: () => api.toggleHidden(ed.slideSel) }, { label: 'Delete slide', onSelect: () => api.deleteSlides(ed.slideSel), disabled: deck.slides.length <= ed.slideSel.length },
  ], [api, ed.slideSel, deck.slides.length]);
  const canvasMenu = [{ label: 'Paste', shortcut: MOD + 'V', onSelect: () => { if (!api.paste()) api.pasteSlides(); } }, { label: 'Select all', shortcut: MOD + 'A', onSelect: api.selectAll }, { label: 'New text box', onSelect: api.addText }, { separator: true }, { label: 'Slide size…', onSelect: () => setDialog('size') }];

  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  const menus = [
    { label: 'File', items: [
      { label: 'All presentations', onSelect: () => navigate('home') }, { label: 'Rename…', onSelect: () => { const n = prompt('Presentation name', deck.name); if (n) api.rename(n); } }, { separator: true },
      { label: 'Save a version', shortcut: MOD + 'S', onSelect: () => ed.saveNow('Manual save').then(() => ed.setMessage('Version saved.')) }, { label: 'Version history…', onSelect: () => setDialog('versions') }, { separator: true },
      { label: 'Import PPTX, images or Slidewise JSON…', onSelect: () => importRef.current.click() }, { separator: true },
      { label: 'Export as PDF', onSelect: () => runExport('pdf') }, { label: 'Export slides as PNG (zip)', onSelect: () => runExport('png-zip') }, { label: 'Export current slide as PNG', onSelect: () => runExport('png') },
      { label: 'Export as PPTX', onSelect: () => runExport('pptx') }, { label: 'Export as HTML slideshow', onSelect: () => runExport('html') }, { label: 'Export as Slidewise JSON', onSelect: () => runExport('json') }, { separator: true },
      { label: locked ? 'Remove password lock…' : 'Password lock…', onSelect: () => setDialog('lock') }, { label: 'Slide size…', onSelect: () => setDialog('size') } ] },
    { label: 'Edit', items: [
      { label: 'Undo', shortcut: MOD + 'Z', onSelect: api.undo, disabled: !ed.canUndo }, { label: 'Redo', shortcut: MOD + 'Shift+Z', onSelect: api.redo, disabled: !ed.canRedo }, { separator: true },
      { label: 'Cut', shortcut: MOD + 'X', onSelect: api.cut, disabled: !has }, { label: 'Copy', shortcut: MOD + 'C', onSelect: api.copy, disabled: !has }, { label: 'Paste', shortcut: MOD + 'V', onSelect: () => { if (!api.paste()) api.pasteSlides(); } },
      { label: 'Duplicate', shortcut: MOD + 'D', onSelect: api.duplicateSel, disabled: !has }, { label: 'Delete', shortcut: 'Del', onSelect: api.deleteSel, disabled: !has }, { separator: true },
      { label: 'Select all', shortcut: MOD + 'A', onSelect: api.selectAll }, { label: 'Find and replace…', shortcut: MOD + 'F', onSelect: () => setDialog('find') } ] },
    { label: 'View', items: [
      { label: 'Zoom in', shortcut: MOD + '+', onSelect: () => zoomStep(1) }, { label: 'Zoom out', shortcut: MOD + '-', onSelect: () => zoomStep(-1) }, { label: 'Fit to window', shortcut: MOD + '0', onSelect: () => setZoomMode('fit') }, { label: 'Actual size (100%)', onSelect: () => setZoom(1) }, { separator: true },
      { label: 'Snap to guides', checked: snapOn, onSelect: () => setSnapOn(!snapOn) }, { label: 'Speaker notes', checked: showNotes, onSelect: () => setShowNotes(!showNotes) } ] },
    { label: 'Insert', items: [
      { label: 'Text box', onSelect: api.addText }, ...SHAPES.map((s) => ({ label: SHAPE_LABELS[s], onSelect: () => api.addShape(s) })), { separator: true },
      { label: 'Image…', onSelect: openImagePicker }, { label: 'Table', onSelect: () => api.addTable(3, 3) }, ...CHART_KINDS.map((c) => ({ label: cap(c) + ' chart', onSelect: () => api.addChart(c) })), { separator: true }, { label: 'New slide', shortcut: MOD + 'M', onSelect: () => api.addSlide() } ] },
    { label: 'Format', items: [
      { label: 'Bring to front', shortcut: MOD + 'Shift+]', onSelect: () => api.z('front'), disabled: !has }, { label: 'Bring forward', shortcut: MOD + ']', onSelect: () => api.z('forward'), disabled: !has }, { label: 'Send backward', shortcut: MOD + '[', onSelect: () => api.z('backward'), disabled: !has }, { label: 'Send to back', shortcut: MOD + 'Shift+[', onSelect: () => api.z('back'), disabled: !has }, { separator: true },
      { label: 'Group', shortcut: MOD + 'G', onSelect: api.group, disabled: selObjs.length < 2 }, { label: 'Ungroup', shortcut: MOD + 'Shift+G', onSelect: api.ungroup, disabled: !selObjs.some((o) => o.type === 'group') }, { label: 'Lock / unlock', onSelect: api.toggleLock, disabled: !has }, { separator: true },
      ...['left', 'center', 'right', 'top', 'middle', 'bottom'].map((m) => ({ label: 'Align ' + m, onSelect: () => api.align(m), disabled: !has })),
      { label: 'Distribute horizontally', onSelect: () => api.distribute('h'), disabled: selObjs.length < 3 }, { label: 'Distribute vertically', onSelect: () => api.distribute('v'), disabled: selObjs.length < 3 } ] },
    { label: 'Slide', items: [
      { label: 'New slide', onSelect: () => api.addSlide() }, { label: 'Duplicate slide', shortcut: MOD + 'Shift+D', onSelect: () => api.duplicateSlides(ed.slideSel) }, { label: 'Delete slide', onSelect: () => api.deleteSlides(ed.slideSel), disabled: deck.slides.length <= ed.slideSel.length },
      { label: slide.hidden ? 'Show slide' : 'Hide slide', onSelect: () => api.toggleHidden(ed.slideSel) }, { separator: true },
      ...LAYOUTS.map((l) => ({ label: 'Layout: ' + LAYOUT_LABELS[l], onSelect: () => api.applyLayout(l) })), { separator: true },
      ...TRANSITIONS.map((t) => ({ label: 'Transition: ' + cap(t), checked: slide.transition.type === t, onSelect: () => api.setSlideProps({ transition: { ...slide.transition, type: t } }) })) ] },
    { label: 'Present', items: [
      { label: 'From beginning', shortcut: MOD + 'F5', onSelect: () => doPresent(0) }, { label: 'From current slide', shortcut: 'F5', onSelect: () => doPresent(idx) }, { label: 'Open presenter view (second window)', onSelect: () => { window.open('#/presenter-view/' + deck.id, 'slidewise-pv'); doPresent(idx); } } ] },
    { label: 'Help', items: [{ label: 'Keyboard shortcuts', shortcut: MOD + '/', onSelect: () => setDialog('shortcuts') }, { label: 'About Slidewise', onSelect: () => ed.setMessage('Slidewise runs entirely in your browser. Nothing leaves your device.') }] },
  ];

  const statusText = { saved: 'Saved', saving: 'Saving…', error: 'Not saved' }[ed.saveState];
  const stagePad = ed.draft ? undefined : undefined; void stagePad;

  return (
    <div className="editor" onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); }} onDrop={onDrop}>
      <a className="skip-link" href="#main-stage" onClick={(e) => { e.preventDefault(); document.querySelector('[data-testid=stage] [role=option]')?.focus(); document.getElementById('main-stage')?.focus(); }}>Skip to slide</a>
      <header className="topbar">
        <button type="button" className="btn home-btn" onClick={() => navigate('home')} title="Back to all presentations"><span aria-hidden="true">◀</span> Home</button>
        <div className="title-block">
          <input className="title-input" aria-label="Presentation name" value={deck.name} onChange={(e) => api.rename(e.target.value)} maxLength={200} />
          <MenuBar menus={menus} />
        </div>
        <div className={'save-state ' + ed.saveState} role="status" aria-live="polite" data-testid="save-state">
          <span className="dot" aria-hidden="true" />{statusText}{locked && <span className="lock-badge" title="Encrypted on this device"> 🔒</span>}
          {ed.saveState === 'error' && <button type="button" className="btn small" onClick={ed.retrySave}>Retry</button>}
        </div>
        <button type="button" className="btn primary present-btn" onClick={() => doPresent(idx)}>▶ Present</button>
      </header>
      {ed.saveState === 'error' && <div className="banner error" role="alert">Could not save: {ed.saveError}. Your changes are still in this tab. Export a backup (File → Export as Slidewise JSON) and try again.</div>}
      <section className="toolbar-region" aria-label="Editing tools">
      <h1 className="sr-only">{deck.name}</h1>
      <div className="toolbar" role="toolbar" aria-label="Toolbar">
        <button type="button" className="btn icon" onClick={api.undo} disabled={!ed.canUndo} aria-label="Undo" title={'Undo (' + MOD + 'Z)'}>↶</button>
        <button type="button" className="btn icon" onClick={api.redo} disabled={!ed.canRedo} aria-label="Redo" title={'Redo (' + MOD + 'Shift+Z)'}>↷</button>
        <span className="tb-sep" />
        <button type="button" className="btn" onClick={api.addText}>Text</button>
        <label className="tb-select"><span className="sr-only">Insert shape</span><select aria-label="Insert shape" value="" onChange={(e) => { if (e.target.value) api.addShape(e.target.value); }}><option value="">Shape ▾</option>{SHAPES.map((s) => <option key={s} value={s}>{SHAPE_LABELS[s]}</option>)}</select></label>
        <button type="button" className="btn" onClick={openImagePicker}>Image</button>
        <button type="button" className="btn" onClick={() => api.addTable(3, 3)}>Table</button>
        <label className="tb-select"><span className="sr-only">Insert chart</span><select aria-label="Insert chart" value="" onChange={(e) => { if (e.target.value) api.addChart(e.target.value); }}><option value="">Chart ▾</option>{CHART_KINDS.map((c) => <option key={c} value={c}>{cap(c)} chart</option>)}</select></label>
        <span className="tb-sep" />
        <div className="tb-group" role="group" aria-label="Arrange">
          {[['left', 'Align left'], ['center', 'Align centres'], ['right', 'Align right'], ['top', 'Align top'], ['middle', 'Align middles'], ['bottom', 'Align bottom']].map(([m, l]) => <button key={m} type="button" className="btn icon small" disabled={!has} aria-label={l} title={l} onClick={() => api.align(m)}>{{ left: '⇤', center: '↔', right: '⇥', top: '⤒', middle: '↕', bottom: '⤓' }[m]}</button>)}
          <button type="button" className="btn small" disabled={selObjs.length < 3} onClick={() => api.distribute('h')}>Dist H</button>
          <button type="button" className="btn small" disabled={selObjs.length < 3} onClick={() => api.distribute('v')}>Dist V</button>
          <button type="button" className="btn small" disabled={selObjs.length < 2} onClick={api.group}>Group</button>
          <button type="button" className="btn small" disabled={!selObjs.some((o) => o.type === 'group')} onClick={api.ungroup}>Ungroup</button>
        </div>
        <span className="tb-spacer" />
        <label className="tb-select"><span className="sr-only">Zoom</span>
          <select aria-label="Zoom" value={zoomMode === 'fit' ? 'fit' : String(zoomVal)} onChange={(e) => (e.target.value === 'fit' ? setZoomMode('fit') : setZoom(parseFloat(e.target.value)))}>
            <option value="fit">Fit ({Math.round(fitZoom * 100)}%)</option>{ZOOMS.map((z) => <option key={z} value={z}>{Math.round(z * 100)}%</option>)}
            {zoomMode !== 'fit' && !ZOOMS.includes(zoomVal) && <option value={zoomVal}>{Math.round(zoomVal * 100)}%</option>}
          </select></label>
      </div>
      </section>
      <div className="workspace">
        <Sorter deck={deck} slideId={ed.slideId} slideSel={ed.slideSel} api={api} onContext={(c) => setCtx({ ...c })} />
        <main className="center" id="main-stage" tabIndex={-1} aria-label="Slide editor">
          <div className="canvas-area" ref={areaRef}>
            <SlideCanvas deck={deck} present={present} slide={slide} zoom={zoom} sel={sel} setSel={api.setSel} api={api} draft={ed.draft} setDraft={api.setDraft} commitDraft={ed.commitDraft} editingId={editingId} setEditingId={setEditingId} snapOn={snapOn} onContext={(c) => setCtx(c)} bridge={bridge} />
          </div>
          {showNotes && (
            <div className="notes">
              <label htmlFor="notes-box">Speaker notes — slide {idx + 1}</label>
              <textarea id="notes-box" rows={3} value={slide.notes} placeholder="Notes only you will see in presenter view" onChange={(e) => api.setNotes(slide.id, e.target.value)} />
            </div>
          )}
        </main>
        <aside className="right-panel" aria-label="Properties">
          <div className="tabs" role="tablist" aria-label="Property panels">
            {[['format', 'Format'], ['slide', 'Slide'], ['theme', 'Theme']].map(([k, l]) => <button key={k} role="tab" type="button" id={'tab-' + k} aria-selected={tab === k} aria-controls={'panel-' + k} tabIndex={tab === k ? 0 : -1} className={'tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}
              onKeyDown={(e) => { const order = ['format', 'slide', 'theme']; const i = order.indexOf(k); if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const n = order[(i + (e.key === 'ArrowRight' ? 1 : 2)) % 3]; setTab(n); setTimeout(() => document.getElementById('tab-' + n)?.focus(), 0); } }}>{l}</button>)}
          </div>
          <div role="tabpanel" id={'panel-' + tab} aria-labelledby={'tab-' + tab} className="tabpanel" data-keep-edit>
            {tab === 'format' && <FormatPanel deck={deck} slide={slide} selObjs={selObjs} api={api} ed={bridge} />}
            {tab === 'slide' && <SlidePanel deck={deck} slide={slide} api={api} />}
            {tab === 'theme' && <ThemePanel deck={deck} api={api} />}
          </div>
        </aside>
      </div>
      <div className="statusbar" role="region" aria-label="Status bar"><span>Slide {idx + 1} of {deck.slides.length}</span><span>{deck.size.w} × {deck.size.h}</span><span>{sel.length ? `${sel.length} selected` : ''}</span><span className="grow" /><span>{Math.round(zoom * 100)}%</span></div>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={onImagePicked} data-testid="image-input" />
      <input ref={importRef} type="file" accept=".pptx,.json,image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={runImport} data-testid="import-input" />
      <div className="toast-region" role="status" aria-live="polite">{(ed.message || busy) && <div className="toast">{busy || ed.message}{!busy && <button type="button" className="btn small" onClick={() => ed.setMessage('')} aria-label="Dismiss message">✕</button>}</div>}</div>
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctx.slide ? slideMenu : ctx.onObject ? objMenu : canvasMenu} onClose={() => setCtx(null)} />}
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={() => setDialog(null)} />}
      {dialog === 'find' && <FindDialog deck={deck} api={api} onClose={() => setDialog(null)} onGo={(id) => { api.setSlide(id); }} />}
      {dialog === 'versions' && <VersionsDialog deck={present} onClose={() => setDialog(null)} onRestore={(d) => api.replaceDeck(d)} />}
      {dialog === 'size' && <SizeDialog deck={deck} onClose={() => setDialog(null)} onApply={(s, scale) => api.resizeDeck(s, scale)} />}
      {dialog === 'lock' && <LockDialog locked={locked} onClose={() => setDialog(null)} onLock={async (pw) => { await lockDeck(present, pw); setLocked(true); ed.setMessage('Presentation locked.'); }} onUnlock={async () => { await unlockPermanently(present); setLocked(false); ed.setMessage('Lock removed.'); }} />}
    </div>
  );
}
