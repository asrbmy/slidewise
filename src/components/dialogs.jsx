import React, { useEffect, useState } from 'react';
import Dialog from './Dialog.jsx';
import { SHORTCUTS } from '../shortcuts.js';
import { findMatches } from '../model/ops.js';
import { listVersions, loadVersion, saveVersion } from '../storage/deckStore.js';
import { SIZE_PRESETS, LIMITS } from '../model/constants.js';

export function ShortcutsDialog({ onClose }) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose} wide>
      <div className="shortcut-groups">{SHORTCUTS.map((g) => (
        <section key={g.group}><h3>{g.group}</h3><dl>{g.keys.map(([a, k]) => (<React.Fragment key={a}><dt>{a}</dt><dd><kbd>{k}</kbd></dd></React.Fragment>))}</dl></section>
      ))}</div>
    </Dialog>
  );
}

export function FindDialog({ deck, api, onClose, onGo }) {
  const [find, setFind] = useState(''), [repl, setRepl] = useState(''), [matchCase, setMatchCase] = useState(false), [notes, setNotes] = useState(true), [status, setStatus] = useState('');
  const matches = findMatches(deck, find, { matchCase, notes });
  const total = matches.reduce((n, m) => n + m.count, 0);
  return (
    <Dialog title="Find and replace" onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Close</button>
        <button type="button" className="btn primary" disabled={!find || !total} onClick={() => { const n = api.replaceAll(find, repl, { matchCase, notes }); setStatus(`Replaced ${n} occurrence${n === 1 ? '' : 's'}.`); }}>Replace all</button></>}>
      <label className="field"><span className="field-label">Find</span><input data-autofocus value={find} onChange={(e) => { setFind(e.target.value); setStatus(''); }} /></label>
      <label className="field"><span className="field-label">Replace with</span><input value={repl} onChange={(e) => setRepl(e.target.value)} /></label>
      <label className="check"><input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case</label>
      <label className="check"><input type="checkbox" checked={notes} onChange={(e) => setNotes(e.target.checked)} /> Include speaker notes</label>
      <p role="status" aria-live="polite" className="status-line">{status || (find ? `${total} match${total === 1 ? '' : 'es'} on ${matches.length} slide${matches.length === 1 ? '' : 's'}` : 'Searches text boxes, shapes, tables, chart labels and notes on every slide.')}</p>
      {matches.length > 0 && <ul className="match-list">{matches.slice(0, 60).map((m) => <li key={m.slideId}><button type="button" className="link-btn" onClick={() => onGo(m.slideId)}>Slide {m.index + 1}</button> — {m.count}</li>)}</ul>}
    </Dialog>
  );
}

export function VersionsDialog({ deck, onClose, onRestore }) {
  const [list, setList] = useState(null), [err, setErr] = useState('');
  const refresh = () => listVersions(deck.id).then(setList).catch((e) => setErr(e.message));
  useEffect(() => { refresh(); }, []);
  const restore = async (v) => {
    try { const d = await loadVersion(v.vid); if (!d) throw new Error('Version not found'); await saveVersion(deck, 'Before restore'); onRestore({ ...d, id: deck.id }); onClose(); } catch (e) { setErr(e.message); }
  };
  return (
    <Dialog title="Version history" onClose={onClose} footer={<button type="button" className="btn" onClick={onClose}>Close</button>}>
      <p className="hint">The last 30 versions are kept on this device. Restoring first saves your current state as a version, and can be undone with Undo.</p>
      {err && <p role="alert" className="error-text">{err}</p>}
      {list === null ? <p>Loading…</p> : list.length === 0 ? <p>No versions yet. Press Ctrl+S to save one; the app also saves one automatically every few minutes.</p> :
        <ul className="version-list">{list.map((v) => (<li key={v.vid}><div><strong>{new Date(v.at).toLocaleString()}</strong><div className="muted">{v.label || 'Version'} · {v.slideCount} slides · {v.objectCount} objects</div></div><button type="button" className="btn" onClick={() => restore(v)}>Restore</button></li>))}</ul>}
    </Dialog>
  );
}

export function SizeDialog({ deck, onClose, onApply }) {
  const match = Object.entries(SIZE_PRESETS).find(([, s]) => s.w === deck.size.w && s.h === deck.size.h);
  const [preset, setPreset] = useState(match ? match[0] : 'custom');
  const [w, setW] = useState(deck.size.w), [h, setH] = useState(deck.size.h), [scale, setScale] = useState(true);
  const pick = (p) => { setPreset(p); if (SIZE_PRESETS[p]) { setW(SIZE_PRESETS[p].w); setH(SIZE_PRESETS[p].h); } };
  const ok = w >= LIMITS.minSlideSize && w <= LIMITS.maxSlideSize && h >= LIMITS.minSlideSize && h <= LIMITS.maxSlideSize;
  return (
    <Dialog title="Slide size" onClose={onClose} footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={!ok} onClick={() => { onApply({ w, h }, scale); onClose(); }}>Apply</button></>}>
      <fieldset className="radio-group"><legend>Preset</legend>
        {[['16:9', 'Widescreen 16:9 (1280 × 720)'], ['4:3', 'Standard 4:3 (960 × 720)'], ['custom', 'Custom']].map(([k, l]) => <label key={k} className="check"><input type="radio" name="sz" checked={preset === k} onChange={() => pick(k)} /> {l}</label>)}
      </fieldset>
      <div className="row"><label className="field"><span className="field-label">Width (px)</span><input type="number" min={LIMITS.minSlideSize} max={LIMITS.maxSlideSize} value={w} onChange={(e) => { setPreset('custom'); setW(parseInt(e.target.value, 10) || 0); }} /></label>
        <label className="field"><span className="field-label">Height (px)</span><input type="number" min={LIMITS.minSlideSize} max={LIMITS.maxSlideSize} value={h} onChange={(e) => { setPreset('custom'); setH(parseInt(e.target.value, 10) || 0); }} /></label></div>
      {!ok && <p role="alert" className="error-text">Width and height must be between {LIMITS.minSlideSize} and {LIMITS.maxSlideSize}.</p>}
      <label className="check"><input type="checkbox" checked={scale} onChange={(e) => setScale(e.target.checked)} /> Scale existing content to the new size</label>
    </Dialog>
  );
}

export function LockDialog({ locked, onClose, onLock, onUnlock }) {
  const [pw, setPw] = useState(''), [pw2, setPw2] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const go = async () => {
    setErr('');
    if (!locked) { if (pw.length < 4) return setErr('Use at least 4 characters (a long passphrase is much stronger).'); if (pw !== pw2) return setErr('The two passwords do not match.'); }
    setBusy(true);
    try { await (locked ? onUnlock() : onLock(pw)); onClose(); } catch (e) { setErr(e.message || 'Failed'); setBusy(false); }
  };
  return (
    <Dialog title={locked ? 'Remove password lock' : 'Lock this presentation with a password'} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={busy} onClick={go}>{busy ? 'Working…' : locked ? 'Remove lock' : 'Lock presentation'}</button></>}>
      {locked ? <p>This presentation is encrypted on this device. Removing the lock stores it unencrypted again.</p> : (<>
        <label className="field"><span className="field-label">Password</span><input data-autofocus type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        <label className="field"><span className="field-label">Repeat password</span><input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
      </>)}
      <div className="notice"><strong>What this does:</strong> encrypts the slides, notes, images and version history of this deck in this browser's storage (and in backup files) with AES-256-GCM, using a key derived from your password with PBKDF2 (600,000 iterations).
        <br /><strong>What it does not do:</strong> hide the deck's title or slide count on the home screen; protect the deck while it is open on screen; protect files you export (PDF, PPTX, HTML, PNG are not encrypted); defend against a weak password, malware or someone watching you type.
        <br /><strong>There is no recovery.</strong> If you forget the password, the deck cannot be opened — not by you, and not by us.</div>
      {err && <p role="alert" className="error-text">{err}</p>}
    </Dialog>
  );
}

export function ConfirmDialog({ title, message, confirmLabel = 'OK', onConfirm, onClose, danger }) {
  return (
    <Dialog title={title} onClose={onClose} footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" data-autofocus className={'btn ' + (danger ? 'danger' : 'primary')} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button></>}>
      <p>{message}</p>
    </Dialog>
  );
}
