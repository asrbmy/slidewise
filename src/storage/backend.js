// Key-value backend over IndexedDB with an in-memory fallback if IndexedDB is unavailable (private mode, blocked, old browsers).
const DB_NAME = 'slidewise', DB_VERSION = 1;
const STORES = { decks: 'id', versions: 'vid', folders: 'id' };

function memoryBackend() {
  const data = { decks: new Map(), versions: new Map(), folders: new Map() };
  return {
    mode: 'memory',
    async getAll(store) { return [...data[store].values()].map((v) => structuredClone(v)); },
    async get(store, key) { const v = data[store].get(key); return v === undefined ? undefined : structuredClone(v); },
    async put(store, value) { data[store].set(value[STORES[store]], structuredClone(value)); },
    async delete(store, key) { data[store].delete(key); },
    async clear(store) { data[store].clear(); },
    async getAllByIndex(store, field, value) { return [...data[store].values()].filter((v) => v[field] === value).map((v) => structuredClone(v)); },
  };
}

function idbBackend(db) {
  const tx = (store, mode, fn) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    let result;
    if (req) req.onsuccess = () => { result = req.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error || new Error('IndexedDB transaction failed'));
    t.onabort = () => reject(t.error || new Error('IndexedDB transaction aborted (storage may be full)'));
  });
  return {
    mode: 'indexeddb',
    getAll: (s) => tx(s, 'readonly', (o) => o.getAll()),
    get: (s, k) => tx(s, 'readonly', (o) => o.get(k)),
    put: (s, v) => tx(s, 'readwrite', (o) => o.put(v)),
    delete: (s, k) => tx(s, 'readwrite', (o) => o.delete(k)),
    clear: (s) => tx(s, 'readwrite', (o) => o.clear()),
    getAllByIndex: (s, f, v) => tx(s, 'readonly', (o) => o.index(f).getAll(v)),
  };
}

let backendPromise = null;
export function openBackend({ force } = {}) {
  if (backendPromise && !force) return backendPromise;
  backendPromise = new Promise((resolve) => {
    if (force === 'memory' || typeof indexedDB === 'undefined' || !indexedDB) return resolve(memoryBackend());
    let settled = false;
    const done = (b) => { if (!settled) { settled = true; resolve(b); } };
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('decks', { keyPath: 'id' });
        const v = db.createObjectStore('versions', { keyPath: 'vid' }); v.createIndex('deckId', 'deckId');
        db.createObjectStore('folders', { keyPath: 'id' });
      };
      req.onsuccess = () => { try { done(idbBackend(req.result)); } catch { done(memoryBackend()); } };
      req.onerror = () => done(memoryBackend());
      req.onblocked = () => done(memoryBackend());
      setTimeout(() => done(memoryBackend()), 4000);
    } catch { done(memoryBackend()); }
  });
  return backendPromise;
}
export function resetBackendForTests() { backendPromise = null; }
