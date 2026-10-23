// Storage adapters with one small interface:
//   getAll(store) -> Promise<records[]>
//   batch([{ type: 'put', store, value } | { type: 'delete', store, key } | { type: 'clear', store }])
//   replaceAll({ store: records[] })  clears every store and writes the given records, atomically
// The browser uses IndexedDB; unit tests (and browsers without IndexedDB) use the memory adapter.

export const STORES = { banks: 'id', questions: 'id', attempts: 'id', sessions: 'id', wrong: 'qid', meta: 'key' };
const NAMES = Object.keys(STORES);

export function createMemoryDB() {
  const data = Object.fromEntries(NAMES.map(n => [n, new Map()]));
  const copy = v => structuredClone(v);
  return {
    kind: 'memory',
    async getAll(store) { return [...data[store].values()].map(copy); },
    async batch(ops) {
      for (const op of ops) {
        const m = data[op.store];
        if (op.type === 'put') m.set(op.value[STORES[op.store]], copy(op.value));
        else if (op.type === 'delete') m.delete(op.key);
        else if (op.type === 'clear') m.clear();
      }
    },
    async replaceAll(records) {
      for (const n of NAMES) {
        data[n].clear();
        for (const v of records[n] || []) data[n].set(v[STORES[n]], copy(v));
      }
    }
  };
}

export function openIndexedDB(name = 'review-app', version = 1) {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('浏览器不支持 IndexedDB')); return; }
    let req;
    try { req = indexedDB.open(name, version); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const n of NAMES) if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, { keyPath: STORES[n] });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(wrap(db));
    };
    req.onerror = () => reject(req.error || new Error('无法打开本地数据库'));
    req.onblocked = () => reject(new Error('本地数据库被另一个标签页占用，请关闭其他标签页后重试'));
  });
}

function wrap(db) {
  const run = (stores, fn) => new Promise((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('写入本地数据库失败（可能是存储空间不足）'));
    fn(tx);
  });
  return {
    kind: 'indexeddb',
    getAll(store) {
      return new Promise((resolve, reject) => {
        const r = db.transaction(store).objectStore(store).getAll();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    },
    batch(ops) {
      if (!ops.length) return Promise.resolve();
      return run([...new Set(ops.map(o => o.store))], tx => {
        for (const op of ops) {
          const os = tx.objectStore(op.store);
          if (op.type === 'put') os.put(op.value);
          else if (op.type === 'delete') os.delete(op.key);
          else if (op.type === 'clear') os.clear();
        }
      });
    },
    replaceAll(records) {
      return run(NAMES, tx => {
        for (const n of NAMES) {
          const os = tx.objectStore(n);
          os.clear();
          for (const v of records[n] || []) os.put(v);
        }
      });
    }
  };
}
