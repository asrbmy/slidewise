import { useReducer, useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { createHistory, commit as hCommit, undo as hUndo, redo as hRedo, canUndo, canRedo } from '../model/history.js';
import * as ops from '../model/ops.js';
import { createTextBox, createShape, createImage, createTable, createChart } from '../model/factory.js';
import { applyTextFormat } from '../model/text.js';
import { saveDeck, saveVersion } from '../storage/deckStore.js';
import { assetFromFile } from '../model/imageImport.js';

// ---- in-app clipboard (works across decks in one tab) ----
let clip = null;
export const getClip = () => clip;

function reducer(state, a) {
  switch (a.type) {
    case 'commit': {
      const h = hCommit(state.h, a.deck, a.key || null);
      return h === state.h ? state : { ...state, h };
    }
    case 'undo': return { ...state, h: hUndo(state.h) };
    case 'redo': return { ...state, h: hRedo(state.h) };
    case 'sel': return { ...state, sel: a.ids };
    case 'slide': return { ...state, slideId: a.id, sel: [], slideSel: [a.id] };
    case 'slideSel': return { ...state, slideSel: a.ids, slideId: a.ids.length ? a.ids[a.ids.length - 1] : state.slideId, sel: [] };
    case 'commitSel': {
      const h = hCommit(state.h, a.deck, a.key || null);
      return { ...state, h, sel: a.sel ?? state.sel, slideId: a.slideId ?? state.slideId, slideSel: a.slideSel ?? state.slideSel };
    }
    default: return state;
  }
}

export function useEditor(initialDeck) {
  const [state, dispatch] = useReducer(reducer, null, () => ({ h: createHistory(initialDeck), sel: [], slideId: initialDeck.slides[0].id, slideSel: [initialDeck.slides[0].id] }));
  const [draft, setDraft] = useState(null); // transient drag/resize patches: { slideId, patches: Map }
  const [saveState, setSaveState] = useState('saved');
  const [saveError, setSaveError] = useState('');
  const [message, setMessage] = useState('');
  const present = state.h.present;

  const deck = useMemo(() => {
    if (!draft) return present;
    let d = present;
    for (const [id, patch] of draft.patches) d = ops.updateObjects(d, draft.slideId, [id], patch);
    return d;
  }, [present, draft]);
  const slide = ops.getSlide(deck, state.slideId) || deck.slides[0];
  const slideRef = useRef(slide); slideRef.current = slide;
  const stateRef = useRef(state); stateRef.current = state;
  const presentRef = useRef(present); presentRef.current = present;

  // ---- autosave (debounced) with visible state ----
  const lastSaved = useRef(initialDeck);
  const lastVersionAt = useRef(Date.now());
  const timer = useRef(null);
  const doSave = useCallback(async () => {
    const d = presentRef.current;
    try {
      await saveDeck(d);
      lastSaved.current = d;
      if (Date.now() - lastVersionAt.current > 5 * 60 * 1000) { lastVersionAt.current = Date.now(); await saveVersion(d, 'Autosave'); }
      if (presentRef.current === d) { setSaveState('saved'); setSaveError(''); } else setSaveState('saving');
    } catch (e) { setSaveState('error'); setSaveError(e && e.message ? e.message : 'Could not save'); }
  }, []);
  useEffect(() => {
    if (present === lastSaved.current) return undefined;
    setSaveState('saving');
    clearTimeout(timer.current);
    timer.current = setTimeout(doSave, 500);
    return () => clearTimeout(timer.current);
  }, [present, doSave]);
  useEffect(() => {
    const flush = () => { if (presentRef.current !== lastSaved.current) { clearTimeout(timer.current); doSave(); } };
    const vis = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush); document.addEventListener('visibilitychange', vis);
    return () => { window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', vis); flush(); };
  }, [doSave]);
  const retrySave = useCallback(() => { setSaveState('saving'); doSave(); }, [doSave]);
  const saveNow = useCallback(async (label) => { clearTimeout(timer.current); await doSave(); await saveVersion(presentRef.current, label || 'Manual save'); lastVersionAt.current = Date.now(); }, [doSave]);

  // keep slide selection valid
  useEffect(() => {
    if (!ops.getSlide(present, state.slideId)) dispatch({ type: 'slide', id: present.slides[0].id });
  }, [present, state.slideId]);

  const sel = state.sel.filter((id) => slide.objects.some((o) => o.id === id));
  const selObjs = slide.objects.filter((o) => sel.includes(o.id));

  const commit = useCallback((fnOrDeck, key) => {
    const base = presentRef.current;
    const next = typeof fnOrDeck === 'function' ? fnOrDeck(base) : fnOrDeck;
    dispatch({ type: 'commit', deck: next, key });
  }, []);
  const setSel = useCallback((ids) => dispatch({ type: 'sel', ids }), []);
  const setSlide = useCallback((id) => dispatch({ type: 'slide', id }), []);
  const setSlideSel = useCallback((ids) => dispatch({ type: 'slideSel', ids }), []);
  const toast = useCallback((m) => { setMessage(m); }, []);

  const api = useMemo(() => {
    const sid = () => slideRef.current.id;
    const S = () => stateRef.current;
    const selIds = () => S().sel.filter((id) => slideRef.current.objects.some((o) => o.id === id));
    const unlocked = (ids) => slideRef.current.objects.filter((o) => ids.includes(o.id) && !o.locked).map((o) => o.id);
    const place = (o) => { // centre new objects, cascading a little if the spot is taken
      const d = presentRef.current; const n = slideRef.current.objects.length % 6;
      return { ...o, x: Math.round((d.size.w - o.w) / 2 + n * 14), y: Math.round((d.size.h - o.h) / 2 + n * 14) };
    };
    const insert = (objs, key) => { const placed = objs; dispatch({ type: 'commitSel', deck: ops.addObjects(presentRef.current, sid(), placed), sel: placed.map((o) => o.id), key }); };
    return {
      addText: () => insert([place(createTextBox())]),
      addShape: (kind) => insert([place(createShape(kind))]),
      addTable: (r = 3, c = 3) => insert([place(createTable(r, c))]),
      addChart: (k) => insert([place(createChart(k))]),
      addImageFile: async (file) => {
        try {
          const { id, asset } = await assetFromFile(file);
          const d = presentRef.current; const k = Math.min(1, (d.size.w * 0.6) / asset.w, (d.size.h * 0.6) / asset.h);
          const o = place(createImage(id, Math.round(asset.w * k), Math.round(asset.h * k), { name: asset.name, alt: '' }));
          let next = ops.addAsset(d, id, asset); next = ops.addObjects(next, sid(), [o]);
          dispatch({ type: 'commitSel', deck: next, sel: [o.id] });
          return o.id;
        } catch (e) { setMessage(e.message || 'Could not add image'); return null; }
      },
      deleteSel: () => { const ids = unlocked(selIds()); if (ids.length) dispatch({ type: 'commitSel', deck: ops.pruneAssets(ops.deleteObjects(presentRef.current, sid(), ids)), sel: [] }); },
      duplicateSel: () => {
        const objs = slideRef.current.objects.filter((o) => selIds().includes(o.id)); if (!objs.length) return;
        const copies = objs.map((o) => ({ ...ops.cloneObject(o), x: o.x + 20, y: o.y + 20 }));
        dispatch({ type: 'commitSel', deck: ops.addObjects(presentRef.current, sid(), copies), sel: copies.map((o) => o.id) });
      },
      copy: () => {
        const objs = slideRef.current.objects.filter((o) => selIds().includes(o.id)); if (!objs.length) return false;
        const assets = {}; const d = presentRef.current;
        const visit = (list) => list.forEach((o) => { if (o.assetId && d.assets[o.assetId]) assets[o.assetId] = d.assets[o.assetId]; if (o.children) visit(o.children); });
        visit(objs); clip = { kind: 'objects', objs: JSON.parse(JSON.stringify(objs)), assets, pastes: 0 }; return true;
      },
      cut() { if (this.copy()) this.deleteSel(); },
      paste: () => {
        if (!clip || clip.kind !== 'objects') return false;
        clip.pastes++;
        const off = 20 * clip.pastes;
        const copies = clip.objs.map((o) => ({ ...ops.cloneObject(o), x: o.x + off, y: o.y + off }));
        let d = presentRef.current; for (const [k, v] of Object.entries(clip.assets)) if (!d.assets[k]) d = ops.addAsset(d, k, v);
        dispatch({ type: 'commitSel', deck: ops.addObjects(d, sid(), copies), sel: copies.map((o) => o.id) }); return true;
      },
      selectAll: () => setSel(slideRef.current.objects.map((o) => o.id)),
      nudge: (dx, dy) => { const ids = unlocked(selIds()); if (ids.length) dispatch({ type: 'commit', deck: ops.updateObjects(presentRef.current, sid(), ids, (o) => ({ x: o.x + dx, y: o.y + dy })), key: 'nudge:' + ids.join() }); },
      patch: (patch, key) => { const ids = selIds(); if (ids.length) dispatch({ type: 'commit', deck: ops.updateObjects(presentRef.current, sid(), ids, patch), key }); },
      patchObj: (id, patch, key) => dispatch({ type: 'commit', deck: ops.updateObjects(presentRef.current, sid(), [id], patch), key }),
      format: (fmt, key) => {
        const ids = selIds(); if (!ids.length) return;
        dispatch({ type: 'commit', key, deck: ops.updateObjects(presentRef.current, sid(), ids, (o) => {
          if (o.tx) return { tx: applyTextFormat(o.tx, fmt) };
          if (o.type === 'table' && ('size' in fmt || 'color' in fmt || 'font' in fmt)) return { tstyle: { ...o.tstyle, ...(fmt.size ? { size: fmt.size } : {}), ...(fmt.color ? { color: fmt.color } : {}), ...(fmt.font ? { font: fmt.font } : {}) } };
          return {};
        }) });
      },
      group: () => { const ids = selIds(); if (ids.length < 2) return; const r = ops.groupObjects(presentRef.current, sid(), ids); dispatch({ type: 'commitSel', deck: r.deck, sel: r.groupId ? [r.groupId] : [] }); },
      ungroup: () => { const ids = selIds().filter((id) => slideRef.current.objects.find((o) => o.id === id && o.type === 'group')); if (!ids.length) return; const r = ops.ungroupObjects(presentRef.current, sid(), ids); dispatch({ type: 'commitSel', deck: r.deck, sel: r.freedIds }); },
      toggleLock: () => { const ids = selIds(); if (!ids.length) return; const all = slideRef.current.objects.filter((o) => ids.includes(o.id)).every((o) => o.locked); dispatch({ type: 'commit', deck: ops.updateObjects(presentRef.current, sid(), ids, { locked: !all }) }); },
      z: (mode) => { const ids = selIds(); if (ids.length) dispatch({ type: 'commit', deck: ops.reorderZ(presentRef.current, sid(), ids, mode) }); },
      align: (mode, rel) => { const ids = selIds(); if (ids.length) dispatch({ type: 'commit', deck: ops.alignObjects(presentRef.current, sid(), ids, mode, rel) }); },
      distribute: (axis) => { const ids = selIds(); if (ids.length > 2) dispatch({ type: 'commit', deck: ops.distributeObjects(presentRef.current, sid(), ids, axis) }); },
      // slides
      addSlide: (layout = 'titleContent') => { const d = presentRef.current; const i = ops.slideIndex(d, sid()); const next = ops.addSlide(d, i, layout); const ns = next.slides[i + 1]; dispatch({ type: 'commitSel', deck: next, slideId: ns.id, slideSel: [ns.id], sel: [] }); },
      duplicateSlides: (ids) => { const d = presentRef.current; const next = ops.duplicateSlides(d, ids); const first = ops.slideIndex(next, ids[ids.length - 1]) + 1; const ns = next.slides[first]; dispatch({ type: 'commitSel', deck: next, slideId: ns.id, slideSel: [ns.id], sel: [] }); },
      deleteSlides: (ids) => { const d = presentRef.current; const next = ops.pruneAssets(ops.deleteSlides(d, ids)); if (next === d) return; const idx = Math.min(ops.slideIndex(d, ids[0]), next.slides.length - 1); const ns = next.slides[Math.max(0, idx)]; dispatch({ type: 'commitSel', deck: next, slideId: ns.id, slideSel: [ns.id], sel: [] }); },
      moveSlides: (ids, to) => dispatch({ type: 'commit', deck: ops.moveSlides(presentRef.current, ids, to) }),
      toggleHidden: (ids) => dispatch({ type: 'commit', deck: ops.toggleHidden(presentRef.current, ids) }),
      copySlides: (ids) => { const d = presentRef.current; const ss = d.slides.filter((s) => ids.includes(s.id)); const assets = {}; ss.forEach((s) => { const visit = (l) => l.forEach((o) => { if (o.assetId && d.assets[o.assetId]) assets[o.assetId] = d.assets[o.assetId]; if (o.children) visit(o.children); }); visit(s.objects); }); clip = { kind: 'slides', slides: JSON.parse(JSON.stringify(ss)), assets }; },
      pasteSlides: () => { if (!clip || clip.kind !== 'slides') return false; let d = presentRef.current; for (const [k, v] of Object.entries(clip.assets)) if (!d.assets[k]) d = ops.addAsset(d, k, v); const i = ops.slideIndex(d, sid()); const next = ops.pasteSlides(d, clip.slides, i); const ns = next.slides[i + 1]; dispatch({ type: 'commitSel', deck: next, slideId: ns.id, slideSel: [ns.id], sel: [] }); return true; },
      setSlideProps: (patch, id) => dispatch({ type: 'commit', deck: ops.updateSlide(presentRef.current, id || sid(), patch) }),
      setNotes: (id, notes) => dispatch({ type: 'commit', deck: ops.updateSlide(presentRef.current, id, { notes }), key: 'notes:' + id }),
      applyLayout: (layout) => dispatch({ type: 'commit', deck: ops.applyLayout(presentRef.current, sid(), layout) }),
      setTheme: (id) => dispatch({ type: 'commit', deck: ops.setTheme(presentRef.current, id) }),
      setPalette: (key, val) => dispatch({ type: 'commit', deck: ops.setPaletteColor(presentRef.current, key, val), key: 'palette:' + key }),
      setThemePart: (p) => dispatch({ type: 'commit', deck: ops.setThemePart(presentRef.current, p) }),
      resizeDeck: (size, scale) => dispatch({ type: 'commit', deck: ops.resizeDeck(presentRef.current, ops.clampSize(size), scale) }),
      rename: (name) => dispatch({ type: 'commit', deck: ops.rename(presentRef.current, name), key: 'rename' }),
      replaceAll: (find, repl, o) => { const r = ops.replaceAll(presentRef.current, find, repl, o); if (r.count) dispatch({ type: 'commit', deck: r.deck }); return r.count; },
      replaceDeck: (deck) => dispatch({ type: 'commit', deck }),
      undo: () => dispatch({ type: 'undo' }), redo: () => dispatch({ type: 'redo' }),
      setDraft, setSel, setSlide, setSlideSel,
      commitDraft: (key) => { /* handled by canvas through commitFromDraft */ },
    };
  }, [setSel]);

  const commitDraft = useCallback((d, key) => { setDraft(null); dispatch({ type: 'commit', deck: d, key }); }, []);

  return { deck, present, slide, sel, selObjs, slideId: slide.id, slideSel: state.slideSel, setSel, setSlide, setSlideSel, commit, api, draft, setDraft, commitDraft, canUndo: canUndo(state.h), canRedo: canRedo(state.h), saveState, saveError, retrySave, saveNow, message, setMessage: toast };
}
