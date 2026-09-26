/*
 * Banco local (IndexedDB). Só persistência: nenhuma regra de negócio aqui.
 * Todas as operações devolvem Promises. Para trocar por um backend no futuro,
 * basta reimplementar esta mesma interface (getAll/put/bulkPut/del/...) chamando a API.
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});

  const DB_NAME = 'flashcards-medicina';
  const DB_VERSION = 1;

  const STORES = {
    cards: { keyPath: 'id', indexes: ['deckId', 'nodeId'] },
    nodes: { keyPath: 'id' },
    decks: { keyPath: 'id' },
    logs: { keyPath: 'id', indexes: ['cardId', 'date'] },
    quickSessions: { keyPath: 'id' },
    sessions: { keyPath: 'id' },
    sources: { keyPath: 'id' },
    sourceFiles: { keyPath: 'id' },
    media: { keyPath: 'name' },
    drafts: { keyPath: 'id' },
    kv: { keyPath: 'key' },
  };

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!root.indexedDB) {
        reject(new Error('Este navegador não oferece IndexedDB; não é possível guardar os cards.'));
        return;
      }
      const req = root.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const [name, def] of Object.entries(STORES)) {
          if (db.objectStoreNames.contains(name)) continue;
          const store = db.createObjectStore(name, { keyPath: def.keyPath });
          for (const idx of def.indexes || []) store.createIndex(idx, idx, { unique: false });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      req.onerror = () => reject(req.error || new Error('Falha ao abrir o banco local'));
      req.onblocked = () => reject(new Error('Feche as outras abas do app para atualizar o banco local.'));
    });
    return dbPromise;
  }

  function promisify(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Falha ao gravar no banco local'));
      tx.onabort = () => reject(tx.error || new Error('Gravação cancelada (espaço insuficiente?)'));
    });
  }

  async function getAll(storeName) {
    const db = await open();
    return promisify(db.transaction(storeName, 'readonly').objectStore(storeName).getAll());
  }

  async function get(storeName, key) {
    const db = await open();
    return promisify(db.transaction(storeName, 'readonly').objectStore(storeName).get(key));
  }

  async function put(storeName, value) {
    const db = await open();
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    return txDone(tx);
  }

  async function bulkPut(storeName, values) {
    if (!values.length) return;
    const db = await open();
    const CHUNK = 2000;
    for (let i = 0; i < values.length; i += CHUNK) {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      for (const v of values.slice(i, i + CHUNK)) store.put(v);
      await txDone(tx);
    }
  }

  async function del(storeName, key) {
    const db = await open();
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    return txDone(tx);
  }

  async function bulkDel(storeName, keys) {
    if (!keys.length) return;
    const db = await open();
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    for (const k of keys) store.delete(k);
    return txDone(tx);
  }

  async function clear(storeName) {
    const db = await open();
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).clear();
    return txDone(tx);
  }

  /** Várias gravações numa única transação: [{store, put?: value, del?: key}] */
  async function batch(ops) {
    if (!ops.length) return;
    const db = await open();
    const names = [...new Set(ops.map((o) => o.store))];
    const tx = db.transaction(names, 'readwrite');
    for (const op of ops) {
      const store = tx.objectStore(op.store);
      if (op.del !== undefined) store.delete(op.del);
      else store.put(op.put);
    }
    return txDone(tx);
  }

  async function getKV(key, fallback) {
    const row = await get('kv', key);
    return row ? row.value : fallback;
  }

  const setKV = (key, value) => put('kv', { key, value });

  async function wipe() {
    for (const name of Object.keys(STORES)) await clear(name);
  }

  /** Pede ao navegador para não apagar os dados em caso de pouco espaço. */
  async function requestPersistence() {
    try {
      if (root.navigator && navigator.storage && navigator.storage.persist) {
        if (await navigator.storage.persisted()) return true;
        return await navigator.storage.persist();
      }
    } catch (e) {
      /* sem suporte */
    }
    return false;
  }

  async function estimate() {
    try {
      if (root.navigator && navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate();
    } catch (e) {
      /* sem suporte */
    }
    return null;
  }

  FC.db = { STORES, open, getAll, get, put, bulkPut, del, bulkDel, clear, batch, getKV, setKV, wipe, requestPersistence, estimate };
})(typeof self !== 'undefined' ? self : this);
