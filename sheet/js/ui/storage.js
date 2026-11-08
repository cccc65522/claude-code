// Autosave to IndexedDB (falls back to localStorage). Everything stays on this device.

const DB_NAME = 'gesuan';
const STORE = 'kv';
const KEY = 'current';
const LS_KEY = 'gesuan.current';

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no indexedDB')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const req = fn(store);
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export function createStorage() {
  let dbPromise = null;
  const db = () => (dbPromise ??= openDB());

  return {
    async load() {
      try {
        const v = await tx(await db(), 'readonly', s => s.get(KEY));
        if (v) return v;
      } catch { /* fall through */ }
      try {
        const raw = localStorage.getItem(LS_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    async save(doc) {
      try {
        await tx(await db(), 'readwrite', s => s.put(doc, KEY));
        return true;
      } catch {
        try {
          localStorage.setItem(LS_KEY, JSON.stringify(doc));
          return true;
        } catch {
          return false;
        }
      }
    }
  };
}
