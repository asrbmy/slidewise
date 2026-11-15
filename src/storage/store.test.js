import { describe, it, expect, beforeEach } from 'vitest';
import { openBackend, resetBackendForTests } from './backend.js';
import * as store from './deckStore.js';
import { createDeck, createTextBox } from '../model/factory.js';
import * as ops from '../model/ops.js';
import { txFromPlain, parasToPlain } from '../model/text.js';
import { createLockSession, encryptJson, unlock, WrongPasswordError } from '../crypto/lock.js';

async function wipe() {
  const b = await openBackend();
  for (const s of ['decks', 'versions', 'folders']) await b.clear(s);
  store.dropAllSessions();
}

for (const mode of ['indexeddb', 'memory']) {
  describe(`deck store (${mode})`, () => {
    beforeEach(async () => { resetBackendForTests(); await openBackend({ force: mode === 'memory' ? 'memory' : undefined }); await wipe(); });

    it('uses the expected backend', async () => { expect(await store.storageMode()).toBe(mode); });

    it('saves, lists, loads, renames, favourites and deletes', async () => {
      const d = createDeck({ name: 'Alpha' }); await store.saveDeck(d);
      let list = await store.listDecks();
      expect(list).toHaveLength(1); expect(list[0]).toMatchObject({ id: d.id, name: 'Alpha', slideCount: 1, locked: false });
      expect((await store.loadDeck(d.id)).deck.name).toBe('Alpha');
      await store.patchMeta(d.id, { name: 'Beta', favorite: true });
      list = await store.listDecks(); expect(list[0]).toMatchObject({ name: 'Beta', favorite: true });
      expect((await store.loadDeck(d.id)).deck.favorite).toBe(true);
      await store.deleteDeck(d.id);
      expect(await store.listDecks()).toHaveLength(0);
      expect(await store.loadDeck('nope')).toBeNull();
    });

    it('persists edits across a fresh read (reload simulation)', async () => {
      let d = createDeck(); const sid = d.slides[0].id;
      d = ops.addObjects(d, sid, [createTextBox({ tx: txFromPlain('persist me') })]);
      await store.saveDeck(d);
      resetBackendForTests(); // drop cached handle like a page reload would; memory mode keeps its own map per open so re-save there
      if (mode === 'memory') await store.saveDeck(d);
      const back = (await store.loadDeck(d.id)).deck;
      expect(parasToPlain(back.slides[0].objects.at(-1).tx.paras)).toBe('persist me');
    });

    it('duplicates a deck with new ids', async () => {
      const d = createDeck({ name: 'Orig' }); await store.saveDeck(d);
      const c = await store.duplicateDeck(d.id);
      expect(c.id).not.toBe(d.id); expect(c.name).toBe('Copy of Orig'); expect(c.slides[0].id).not.toBe(d.slides[0].id);
      expect(await store.listDecks()).toHaveLength(2);
    });

    it('keeps version history, caps it, and restores an old version', async () => {
      let d = createDeck(); await store.saveDeck(d);
      const v1 = await store.saveVersion(d, 'first');
      d = ops.addSlide(d); await store.saveDeck(d);
      await store.saveVersion(d, 'second');
      const vs = await store.listVersions(d.id);
      expect(vs.map((v) => v.label).sort()).toEqual(['first', 'second']);
      expect((await store.loadVersion(v1)).slides).toHaveLength(1);
      for (let i = 0; i < store.MAX_VERSIONS + 5; i++) await store.saveVersion(d, 'n' + i);
      expect((await store.listVersions(d.id)).length).toBe(store.MAX_VERSIONS);
      await store.deleteDeck(d.id);
      expect(await store.listVersions(d.id)).toHaveLength(0);
    });

    it('manages folders and un-files decks when a folder is deleted', async () => {
      const f = await store.createFolder('Work');
      const d = { ...createDeck(), folderId: f.id }; await store.saveDeck(d);
      expect((await store.listDecks())[0].folderId).toBe(f.id);
      await store.renameFolder(f.id, 'Office');
      expect((await store.listFolders())[0].name).toBe('Office');
      await store.deleteFolder(f.id);
      expect((await store.listDecks())[0].folderId).toBeNull();
    });

    it('exports and strictly re-imports a backup', async () => {
      const a = createDeck({ name: 'A' }), b = createDeck({ name: 'B' });
      await store.saveDeck(a); await store.saveDeck(b);
      const backup = await store.exportBackup();
      expect(backup.format).toBe('slidewise-backup'); expect(backup.decks).toHaveLength(2);
      const text = JSON.stringify(backup);
      await wipe();
      const r = await store.importBackup(text);
      expect(r.added).toBe(2);
      expect((await store.listDecks()).map((x) => x.name).sort()).toEqual(['A', 'B']);
      const r2 = await store.importBackup(text); // importing again as copies must not overwrite
      expect(r2.added).toBe(2); expect(await store.listDecks()).toHaveLength(4);
      const r3 = await store.importBackup(text, { mode: 'replace' });
      expect(r3.replaced).toBe(2); expect(await store.listDecks()).toHaveLength(4);
    });

    it('rejects malformed or hostile backups without touching existing data', async () => {
      const a = createDeck({ name: 'Keep' }); await store.saveDeck(a);
      await expect(store.importBackup('not json')).rejects.toThrow(/Not valid JSON/);
      await expect(store.importBackup(JSON.stringify({ format: 'x' }))).rejects.toThrow(/Not a Slidewise backup/);
      const bad = JSON.stringify({ format: 'slidewise-backup', version: 1, decks: [{ ...createDeck(), slides: [{ id: 's', objects: [{ type: 'text', fill: 'javascript:1', tx: { paras: [] } }] }] }] });
      await expect(store.importBackup(bad)).rejects.toThrow();
      expect(await store.listDecks()).toHaveLength(1);
    });
  });
}

describe('password lock (Web Crypto)', () => {
  beforeEach(async () => { resetBackendForTests(); await openBackend({ force: 'memory' }); await wipe(); });
  const ITER = 1000; // fast for tests; production default is 600000

  it('round-trips and fails on the wrong password', async () => {
    const session = await createLockSession('hunter22', ITER);
    const enc = await encryptJson({ secret: 'value' }, session);
    expect(enc.ct).not.toContain('value');
    expect((await unlock(enc, 'hunter22')).obj).toEqual({ secret: 'value' });
    await expect(unlock(enc, 'wrong-pass')).rejects.toBeInstanceOf(WrongPasswordError);
  });
  it('detects tampering (AES-GCM authentication)', async () => {
    const session = await createLockSession('hunter22', ITER);
    const enc = await encryptJson({ a: 1 }, session);
    const raw = atob(enc.ct); const flipped = String.fromCharCode(raw.charCodeAt(0) ^ 1) + raw.slice(1);
    await expect(unlock({ ...enc, ct: btoa(flipped) }, 'hunter22')).rejects.toBeInstanceOf(WrongPasswordError);
  });
  it('uses a fresh IV every time', async () => {
    const session = await createLockSession('hunter22', ITER);
    const a = await encryptJson({ a: 1 }, session), b = await encryptJson({ a: 1 }, session);
    expect(a.iv).not.toBe(b.iv); expect(a.ct).not.toBe(b.ct);
  });
  it('rejects short passwords', async () => { await expect(createLockSession('abc', ITER)).rejects.toThrow(/at least 4/); });

  it('stores a locked deck encrypted, requires the password, and never keeps plaintext slide text', async () => {
    let d = createDeck({ name: 'Locked deck' });
    d = ops.addObjects(d, d.slides[0].id, [createTextBox({ tx: txFromPlain('TOP-SECRET-CONTENT') })]);
    await store.saveDeck(d);
    await store.saveVersion(d, 'plain');
    await store.lockDeck(d, 'correct horse', ITER);
    const b = await openBackend();
    const rec = await b.get('decks', d.id);
    expect(rec.deck).toBeUndefined();
    expect(JSON.stringify(rec)).not.toContain('TOP-SECRET-CONTENT');
    expect((await b.getAllByIndex('versions', 'deckId', d.id))).toHaveLength(0); // plaintext history wiped
    expect((await store.listDecks())[0]).toMatchObject({ locked: true, name: 'Locked deck' });
    store.dropSession(d.id);
    expect(await store.loadDeck(d.id)).toMatchObject({ needsPassword: true });
    await expect(store.loadDeck(d.id, 'nope nope')).rejects.toBeInstanceOf(WrongPasswordError);
    const ok = await store.loadDeck(d.id, 'correct horse');
    expect(parasToPlain(ok.deck.slides[0].objects.at(-1).tx.paras)).toBe('TOP-SECRET-CONTENT');
    // saves while unlocked stay encrypted, versions too
    await store.saveVersion(ok.deck, 'enc');
    const vs = await b.getAllByIndex('versions', 'deckId', d.id);
    expect(vs[0].enc).toBeDefined(); expect(JSON.stringify(vs[0])).not.toContain('TOP-SECRET-CONTENT');
    // removing the lock stores plaintext again
    await store.unlockPermanently(ok.deck);
    expect((await b.get('decks', d.id)).deck).toBeDefined();
  });

  it('exports locked decks still encrypted and re-imports them', async () => {
    let d = createDeck({ name: 'Locked' });
    d = ops.addObjects(d, d.slides[0].id, [createTextBox({ tx: txFromPlain('HIDDEN-TEXT') })]);
    await store.lockDeck(d, 'pass-1234', ITER);
    const text = JSON.stringify(await store.exportBackup());
    expect(text).not.toContain('HIDDEN-TEXT');
    await wipe();
    const r = await store.importBackup(text);
    expect(r.added).toBe(1);
    expect((await store.listDecks())[0].locked).toBe(true);
    expect((await store.loadDeck(d.id, 'pass-1234')).deck.name).toBe('Locked');
  });
});
