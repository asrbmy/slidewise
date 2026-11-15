import { openBackend } from './backend.js';
import { validateDeck, validateBackup, ValidationError } from '../model/validate.js';
import { createLockSession, encryptJson, unlock, decryptWithSession, validateEnc, WrongPasswordError } from '../crypto/lock.js';
import { uid } from '../model/ids.js';
import { cloneSlide, deckObjectCount } from '../model/ops.js';
import { LIMITS } from '../model/constants.js';

export const MAX_VERSIONS = 30;
// Unlocked-deck sessions (derived keys) live only in memory, never persisted.
const sessions = new Map();
export const hasSession = (id) => sessions.has(id);
export const dropSession = (id) => sessions.delete(id);
export const dropAllSessions = () => sessions.clear();

const metaOf = (deck, locked) => ({ name: deck.name, createdAt: deck.createdAt, updatedAt: deck.updatedAt, favorite: !!deck.favorite, folderId: deck.folderId || null, slideCount: deck.slides.length, locked: !!locked });

export async function storageMode() { return (await openBackend()).mode; }

export async function listDecks() {
  const b = await openBackend();
  return (await b.getAll('decks')).map((r) => ({ id: r.id, ...r.meta }));
}

// Strips thumbnail-irrelevant bulk: returns the first slide only for home screen previews.
export async function loadDeckRecord(id) { return (await openBackend()).get('decks', id); }

export async function loadDeck(id, password) {
  const b = await openBackend();
  const rec = await b.get('decks', id);
  if (!rec) return null;
  if (rec.enc) {
    if (hasSession(id)) {
      return { deck: validateDeck(await decryptWithSession(rec.enc, sessions.get(id))), locked: true };
    }
    if (password === undefined) return { locked: true, needsPassword: true, meta: { id, ...rec.meta } };
    const { obj, session } = await unlock(rec.enc, password);
    sessions.set(id, session);
    return { deck: validateDeck(obj), locked: true };
  }
  return { deck: validateDeck(rec.deck), locked: false };
}

export async function saveDeck(deck) {
  const b = await openBackend();
  const session = sessions.get(deck.id);
  if (session) {
    const enc = await encryptJson(deck, session);
    await b.put('decks', { id: deck.id, meta: metaOf(deck, true), enc });
  } else {
    await b.put('decks', { id: deck.id, meta: metaOf(deck, false), deck });
  }
}
export async function deleteDeck(id) {
  const b = await openBackend();
  await b.delete('decks', id);
  for (const v of await b.getAllByIndex('versions', 'deckId', id)) await b.delete('versions', v.vid);
  dropSession(id);
}
export async function duplicateDeck(id, password) {
  const r = await loadDeck(id, password);
  if (!r || !r.deck) return null;
  const copy = { ...r.deck, id: uid('d'), name: `Copy of ${r.deck.name}`.slice(0, LIMITS.maxNameLength), createdAt: Date.now(), updatedAt: Date.now(), favorite: false, slides: r.deck.slides.map(cloneSlide) };
  // Copy of a locked deck is stored unlocked only if the caller already holds the session; keep it locked with the same key.
  if (r.locked && sessions.has(id)) sessions.set(copy.id, sessions.get(id));
  await saveDeck(copy);
  return copy;
}
export async function patchMeta(id, patch) {
  const b = await openBackend();
  const rec = await b.get('decks', id);
  if (!rec) return;
  const allowed = {};
  if ('name' in patch) allowed.name = String(patch.name).slice(0, LIMITS.maxNameLength) || 'Untitled presentation';
  if ('favorite' in patch) allowed.favorite = !!patch.favorite;
  if ('folderId' in patch) allowed.folderId = patch.folderId || null;
  const meta = { ...rec.meta, ...allowed };
  if (rec.deck) { rec.deck = { ...rec.deck, ...allowed }; }
  // For locked decks the name/favorite/folder live in the plain meta; they are re-synced into the encrypted deck at the next save.
  await b.put('decks', { ...rec, meta });
}

// ---------- password lock ----------
export async function lockDeck(deck, password, iterations) {
  const session = await createLockSession(password, iterations);
  sessions.set(deck.id, session);
  await saveDeck(deck);
  // Remove plaintext version history of this deck; keep new snapshots encrypted.
  const b = await openBackend();
  for (const v of await b.getAllByIndex('versions', 'deckId', deck.id)) { if (!v.enc) await b.delete('versions', v.vid); }
}
export async function unlockPermanently(deck) {
  dropSession(deck.id);
  await saveDeck(deck);
  const b = await openBackend();
  for (const v of await b.getAllByIndex('versions', 'deckId', deck.id)) { if (v.enc) await b.delete('versions', v.vid); }
}

// ---------- versions ----------
export async function saveVersion(deck, label = '') {
  const b = await openBackend();
  const vid = uid('v');
  const session = sessions.get(deck.id);
  const base = { vid, deckId: deck.id, at: Date.now(), label: String(label).slice(0, 100), slideCount: deck.slides.length, objectCount: deckObjectCount(deck) };
  await b.put('versions', session ? { ...base, enc: await encryptJson(deck, session) } : { ...base, deck });
  const all = (await b.getAllByIndex('versions', 'deckId', deck.id)).sort((a, c) => c.at - a.at);
  for (const old of all.slice(MAX_VERSIONS)) await b.delete('versions', old.vid);
  return vid;
}
export async function listVersions(deckId) {
  const b = await openBackend();
  return (await b.getAllByIndex('versions', 'deckId', deckId)).map(({ vid, at, label, slideCount, objectCount }) => ({ vid, at, label, slideCount, objectCount })).sort((a, c) => c.at - a.at);
}
export async function loadVersion(vid) {
  const b = await openBackend();
  const v = await b.get('versions', vid);
  if (!v) return null;
  if (v.enc) { const s = sessions.get(v.deckId); if (!s) throw new WrongPasswordError(); return validateDeck(await decryptWithSession(v.enc, s)); }
  return validateDeck(v.deck);
}

// ---------- folders ----------
export async function listFolders() { return (await openBackend()).getAll('folders'); }
export async function createFolder(name) { const f = { id: uid('f'), name: String(name).trim().slice(0, 100) || 'Folder' }; await (await openBackend()).put('folders', f); return f; }
export async function renameFolder(id, name) { await (await openBackend()).put('folders', { id, name: String(name).trim().slice(0, 100) || 'Folder' }); }
export async function deleteFolder(id) {
  const b = await openBackend();
  await b.delete('folders', id);
  for (const r of await b.getAll('decks')) if (r.meta.folderId === id) await patchMeta(r.id, { folderId: null });
}

// ---------- backup (all decks in one JSON file) ----------
export async function exportBackup() {
  const b = await openBackend();
  const decks = (await b.getAll('decks')).map((r) => (r.enc ? { locked: true, id: r.id, meta: r.meta, enc: r.enc } : r.deck));
  return { format: 'slidewise-backup', version: 1, exportedAt: new Date().toISOString(), folders: await listFolders(), decks };
}
export async function importBackup(text, { mode = 'copy' } = {}) {
  if (typeof text !== 'string' || text.length > LIMITS.maxImportFileBytes) throw new ValidationError('Backup file is too large', '$');
  let raw; try { raw = JSON.parse(text); } catch { throw new ValidationError('Not valid JSON', '$'); }
  const { decks, locked, folders } = validateBackup(raw);
  const b = await openBackend();
  const existing = new Set((await b.getAll('decks')).map((r) => r.id));
  const folderIds = new Set((await listFolders()).map((f) => f.id));
  for (const f of folders) { if (!folderIds.has(f.id)) { await b.put('folders', f); folderIds.add(f.id); } }
  let added = 0, replaced = 0;
  for (const d of decks) {
    let deck = d;
    if (existing.has(d.id)) {
      if (mode === 'replace') replaced++;
      else deck = { ...d, id: uid('d'), name: `${d.name} (imported)`.slice(0, LIMITS.maxNameLength) };
    }
    if (deck.folderId && !folderIds.has(deck.folderId)) deck = { ...deck, folderId: null };
    await b.put('decks', { id: deck.id, meta: metaOf(deck, false), deck });
    added++;
  }
  for (const l of locked) {
    let id = l.id;
    if (existing.has(id)) { if (mode === 'replace') replaced++; else id = uid('d'); }
    const meta = l.meta.folderId && !folderIds.has(l.meta.folderId) ? { ...l.meta, folderId: null } : l.meta;
    await b.put('decks', { id, meta, enc: l.enc });
    added++;
  }
  return { added, replaced };
}
export { WrongPasswordError, ValidationError };
