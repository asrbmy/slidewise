import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Thumb from './Thumb.jsx';
import Dialog from './Dialog.jsx';
import { ConfirmDialog } from './dialogs.jsx';
import { TEMPLATES, buildTemplate } from '../model/templates.js';
import * as store from '../storage/deckStore.js';
import { navigate } from '../router.js';
import { downloadBlob } from '../export/download.js';

function Card({ meta, folders, onOpen, onAct }) {
  const [first, setFirst] = useState(null);
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    let dead = false;
    if (!meta.locked) store.loadDeck(meta.id).then((r) => { if (!dead && r && r.deck) setFirst(r.deck); }).catch(() => {});
    return () => { dead = true; };
  }, [meta.id, meta.updatedAt, meta.locked]);
  const id = 'card-' + meta.id;
  return (
    <li className="card" data-deck-id={meta.id}>
      <button type="button" className="card-open" onClick={() => onOpen(meta)}>
        <div className="card-thumb">{first ? <Thumb deck={first} slide={first.slides[0]} width={240} /> : <div className="card-ph" aria-hidden="true">{meta.locked ? '🔒' : '…'}</div>}</div>
        <div className="card-name" id={id}>{meta.name}{meta.locked && <span className="sr-only"> (locked)</span>}</div>
        <div className="card-meta">{meta.slideCount} slide{meta.slideCount === 1 ? '' : 's'} · {new Date(meta.updatedAt).toLocaleDateString()}</div>
      </button>
      <button type="button" className={'fav' + (meta.favorite ? ' on' : '')} aria-pressed={meta.favorite} aria-label={meta.favorite ? `Remove ${meta.name} from favourites` : `Add ${meta.name} to favourites`} onClick={() => onAct('fav', meta)}>{meta.favorite ? '★' : '☆'}</button>
      <div className="card-menu">
        <button type="button" className="btn icon small" aria-haspopup="menu" aria-expanded={menu} aria-label={`Actions for ${meta.name}`} onClick={() => setMenu(!menu)}>⋯</button>
        {menu && (
          <div className="menu" role="menu" aria-label={`Actions for ${meta.name}`} onKeyDown={(e) => { if (e.key === 'Escape') setMenu(false); }}>
            {[['Open', 'open'], ['Rename…', 'rename'], ['Duplicate', 'duplicate'], ['Move to folder…', 'move'], ['Delete…', 'delete']].map(([l, a]) => <button key={a} type="button" role="menuitem" className="menu-item" autoFocus={a === 'open'} onClick={() => { setMenu(false); onAct(a, meta); }}><span className="menu-check" /><span className="menu-label">{l}</span></button>)}
          </div>
        )}
      </div>
    </li>
  );
}

export default function Home({ mode }) {
  const [decks, setDecks] = useState(null), [folders, setFolders] = useState([]);
  const [query, setQuery] = useState(''), [sort, setSort] = useState(() => { try { return localStorage.getItem('sw.sort') || 'modified'; } catch { return 'modified'; } });
  const [folder, setFolder] = useState('all'), [favOnly, setFavOnly] = useState(false);
  const [dlg, setDlg] = useState(null), [msg, setMsg] = useState(''), [err, setErr] = useState('');
  const importRef = useRef(null), backupRef = useRef(null);

  const refresh = useCallback(async () => { try { const [d, f] = await Promise.all([store.listDecks(), store.listFolders()]); setDecks(d); setFolders(f.sort((a, b) => a.name.localeCompare(b.name))); } catch (e) { setErr(e.message); setDecks([]); } }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { try { localStorage.setItem('sw.sort', sort); } catch { /* preferences only */ } }, [sort]);

  const shown = useMemo(() => {
    let list = (decks || []).filter((d) => (folder === 'all' ? true : folder === 'none' ? !d.folderId : d.folderId === folder) && (!favOnly || d.favorite) && d.name.toLowerCase().includes(query.trim().toLowerCase()));
    const cmp = { modified: (a, b) => b.updatedAt - a.updatedAt, created: (a, b) => b.createdAt - a.createdAt, name: (a, b) => a.name.localeCompare(b.name) }[sort];
    return list.sort((a, b) => (b.favorite - a.favorite) || cmp(a, b));
  }, [decks, query, sort, folder, favOnly]);

  const create = async (tid) => { const d = buildTemplate(tid); if (folder !== 'all' && folder !== 'none') d.folderId = folder; await store.saveDeck(d); navigate('editor', d.id); };
  const open = async (meta) => { if (meta.locked && !store.hasSession(meta.id)) setDlg({ kind: 'unlock', meta }); else navigate('editor', meta.id); };
  const act = async (a, meta) => {
    try {
      if (a === 'open') open(meta);
      else if (a === 'fav') { await store.patchMeta(meta.id, { favorite: !meta.favorite }); refresh(); }
      else if (a === 'rename') setDlg({ kind: 'rename', meta });
      else if (a === 'delete') setDlg({ kind: 'delete', meta });
      else if (a === 'move') setDlg({ kind: 'move', meta });
      else if (a === 'duplicate') {
        if (meta.locked && !store.hasSession(meta.id)) { setDlg({ kind: 'unlock', meta, then: 'duplicate' }); return; }
        const c = await store.duplicateDeck(meta.id); setMsg(c ? `Created “${c.name}”.` : 'Could not duplicate.'); refresh();
      }
    } catch (e) { setErr(e.message || String(e)); }
  };
  const doExportBackup = async () => { const b = await store.exportBackup(); downloadBlob(new Blob([JSON.stringify(b)], { type: 'application/json' }), `slidewise-backup-${new Date().toISOString().slice(0, 10)}.json`); setMsg('Backup downloaded.'); };
  const doImportBackup = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return; setErr('');
    try {
      if (f.size > 200 * 1024 * 1024) throw new Error('File is too large (limit 200 MB).');
      const text = await f.text(); const r = await store.importBackup(text, { mode: 'copy' });
      setMsg(`Imported ${r.added} presentation${r.added === 1 ? '' : 's'}. Nothing existing was overwritten.`); refresh();
    } catch (er) { setErr('Import rejected: ' + (er.message || er)); }
  };
  const doImportFiles = async (e) => {
    const files = Array.from(e.target.files || []); e.target.value = ''; if (!files.length) return; setErr('');
    try { const m = await import('../import/importers.js'); const deck = await m.importAsNewDeck(files); await store.saveDeck(deck); setMsg(`Imported “${deck.name}”.`); refresh(); }
    catch (er) { setErr('Import failed: ' + (er.message || er)); }
  };

  return (
    <div className="home">
      <header className="home-top">
        <div className="brand"><img src="./icons/icon.svg" alt="" width="32" height="32" /><h1>Slidewise</h1></div>
        <div className="home-tools">
          <label className="search"><span className="sr-only">Search presentations</span><input type="search" placeholder="Search presentations" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
          <label className="tb-select"><span className="sr-only">Sort by</span><select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort by"><option value="modified">Last modified</option><option value="created">Date created</option><option value="name">Name</option></select></label>
        </div>
      </header>
      {mode === 'memory' && <div className="banner error" role="alert">Browser storage is unavailable, so presentations are kept in memory only and will be lost when you close this tab. Use File → Export or “Back up all” often.</div>}
      {err && <div className="banner error" role="alert">{err} <button type="button" className="btn small" onClick={() => setErr('')}>Dismiss</button></div>}
      {msg && <div className="banner ok" role="status">{msg} <button type="button" className="btn small" onClick={() => setMsg('')}>Dismiss</button></div>}
      <main className="home-main">
        <section aria-labelledby="tpl-h"><h2 id="tpl-h">Start a new presentation</h2>
          <ul className="templates">{TEMPLATES.map((t) => <li key={t.id}><button type="button" className="tpl" onClick={() => create(t.id)} data-template={t.id}><span className="tpl-name">{t.name}</span><span className="tpl-desc">{t.description}</span></button></li>)}</ul>
        </section>
        <div className="home-cols">
          <nav className="folders" aria-label="Folders">
            <h2>Folders</h2>
            <ul>
              <li><button type="button" className={'folder-btn' + (folder === 'all' && !favOnly ? ' on' : '')} aria-current={folder === 'all' && !favOnly ? 'true' : undefined} onClick={() => { setFolder('all'); setFavOnly(false); }}>All presentations</button></li>
              <li><button type="button" className={'folder-btn' + (favOnly ? ' on' : '')} aria-current={favOnly ? 'true' : undefined} onClick={() => { setFavOnly(true); setFolder('all'); }}>★ Favourites</button></li>
              <li><button type="button" className={'folder-btn' + (folder === 'none' ? ' on' : '')} aria-current={folder === 'none' ? 'true' : undefined} onClick={() => { setFolder('none'); setFavOnly(false); }}>Not in a folder</button></li>
              {folders.map((f) => (<li key={f.id} className="folder-row"><button type="button" className={'folder-btn' + (folder === f.id ? ' on' : '')} aria-current={folder === f.id ? 'true' : undefined} onClick={() => { setFolder(f.id); setFavOnly(false); }}>📁 {f.name}</button>
                <button type="button" className="btn icon small" aria-label={`Rename folder ${f.name}`} onClick={() => setDlg({ kind: 'renameFolder', f })}>✎</button>
                <button type="button" className="btn icon small" aria-label={`Delete folder ${f.name}`} onClick={() => setDlg({ kind: 'deleteFolder', f })}>🗑</button></li>))}
            </ul>
            <button type="button" className="btn" onClick={() => setDlg({ kind: 'newFolder' })}>+ New folder</button>
            <h2>Your data</h2>
            <button type="button" className="btn" onClick={() => importRef.current.click()}>Import PPTX / JSON / images…</button>
            <button type="button" className="btn" onClick={doExportBackup}>Back up all (JSON)</button>
            <button type="button" className="btn" onClick={() => backupRef.current.click()}>Restore from backup…</button>
            <p className="hint">Everything is stored only on this device ({mode === 'indexeddb' ? 'IndexedDB' : 'memory'}). Nothing is uploaded.</p>
            <input ref={importRef} type="file" hidden multiple accept=".pptx,.json,image/png,image/jpeg,image/gif,image/webp" onChange={doImportFiles} data-testid="home-import" />
            <input ref={backupRef} type="file" hidden accept=".json,application/json" onChange={doImportBackup} data-testid="backup-input" />
          </nav>
          <section className="deck-list" aria-labelledby="decks-h">
            <h2 id="decks-h">Presentations {decks && <span className="muted">({shown.length})</span>}</h2>
            {decks === null ? <p>Loading…</p> : shown.length === 0 ? <p className="empty">{decks.length ? 'No presentations match.' : 'No presentations yet. Pick a template above to begin.'}</p> :
              <ul className="cards" data-testid="deck-list">{shown.map((m) => <Card key={m.id} meta={m} folders={folders} onOpen={open} onAct={act} />)}</ul>}
          </section>
        </div>
      </main>
      {dlg && dlg.kind === 'rename' && <PromptDialog title="Rename presentation" label="Name" initial={dlg.meta.name} onClose={() => setDlg(null)} onSubmit={async (v) => { await store.patchMeta(dlg.meta.id, { name: v }); refresh(); }} />}
      {dlg && dlg.kind === 'newFolder' && <PromptDialog title="New folder" label="Folder name" initial="" onClose={() => setDlg(null)} onSubmit={async (v) => { const f = await store.createFolder(v); setFolder(f.id); refresh(); }} />}
      {dlg && dlg.kind === 'renameFolder' && <PromptDialog title="Rename folder" label="Folder name" initial={dlg.f.name} onClose={() => setDlg(null)} onSubmit={async (v) => { await store.renameFolder(dlg.f.id, v); refresh(); }} />}
      {dlg && dlg.kind === 'deleteFolder' && <ConfirmDialog danger title="Delete folder" message={`Delete the folder “${dlg.f.name}”? Presentations inside are kept and moved to “Not in a folder”.`} confirmLabel="Delete folder" onClose={() => setDlg(null)} onConfirm={async () => { await store.deleteFolder(dlg.f.id); setFolder('all'); refresh(); }} />}
      {dlg && dlg.kind === 'delete' && <ConfirmDialog danger title="Delete presentation" message={`Permanently delete “${dlg.meta.name}” and its version history from this device? This cannot be undone. Consider backing up first.`} confirmLabel="Delete" onClose={() => setDlg(null)} onConfirm={async () => { await store.deleteDeck(dlg.meta.id); refresh(); setMsg('Deleted.'); }} />}
      {dlg && dlg.kind === 'move' && (
        <Dialog title="Move to folder" onClose={() => setDlg(null)}>
          <ul className="move-list"><li><button type="button" className="btn" data-autofocus onClick={async () => { await store.patchMeta(dlg.meta.id, { folderId: null }); setDlg(null); refresh(); }}>No folder</button></li>
            {folders.map((f) => <li key={f.id}><button type="button" className="btn" onClick={async () => { await store.patchMeta(dlg.meta.id, { folderId: f.id }); setDlg(null); refresh(); }}>{f.name}</button></li>)}</ul>
          {folders.length === 0 && <p className="hint">Create a folder first using “New folder”.</p>}
        </Dialog>)}
      {dlg && dlg.kind === 'unlock' && <UnlockDialog meta={dlg.meta} onClose={() => setDlg(null)} onUnlocked={async () => { setDlg(null); if (dlg.then === 'duplicate') { await store.duplicateDeck(dlg.meta.id); refresh(); } else navigate('editor', dlg.meta.id); }} />}
    </div>
  );
}

export function PromptDialog({ title, label, initial, onSubmit, onClose }) {
  const [v, setV] = useState(initial);
  const go = async () => { if (!v.trim()) return; await onSubmit(v.trim()); onClose(); };
  return (<Dialog title={title} onClose={onClose} footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={!v.trim()} onClick={go}>OK</button></>}>
    <label className="field"><span className="field-label">{label}</span><input data-autofocus value={v} maxLength={200} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go(); }} /></label></Dialog>);
}
export function UnlockDialog({ meta, onClose, onUnlocked }) {
  const [pw, setPw] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); setErr(''); try { await store.loadDeck(meta.id, pw); onUnlocked(); } catch (e) { setErr(e.name === 'WrongPasswordError' ? 'Wrong password.' : (e.message || 'Could not unlock')); setBusy(false); } };
  return (<Dialog title={`Unlock “${meta.name}”`} onClose={onClose} footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={busy || !pw} onClick={go}>{busy ? 'Unlocking…' : 'Unlock'}</button></>}>
    <label className="field"><span className="field-label">Password</span><input data-autofocus type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && pw) go(); }} /></label>
    {err && <p role="alert" className="error-text">{err}</p>}</Dialog>);
}
