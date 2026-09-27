/*
 * Banco local (IndexedDB). Só persistência: nenhuma regra de negócio aqui.
 *
 * Os dados pertencem à conta do Projeto Residente e ficam no servidor; este banco
 * é a cópia do aparelho (abre na hora e funciona sem internet). Há um banco por
 * usuário. Cada gravação registra, na MESMA transação, uma entrada na fila de
 * envio ("outbox"), que o sync.js manda para a conta. A fila guarda só a chave:
 * o conteúdo enviado é sempre o mais recente.
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});

  const LEGACY_NAME = 'flashcards-medicina'; // versão antiga do app, só neste navegador
  const DB_VERSION = 1;
  const SEP = '\u0001';

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
    outbox: { keyPath: 'k' },
    meta: { keyPath: 'key' },
  };

  /** Ficam só neste aparelho: PDFs originais (grandes), controle da sincronização e a chave da IA. */
  const LOCAL_STORES = new Set(['sourceFiles', 'outbox', 'meta']);
  const LOCAL_KV = new Set(['aiKey']);
  const DATA_STORES = Object.keys(STORES).filter((s) => s !== 'outbox' && s !== 'meta');

  let dbName = null;
  let dbPromise = null;
  let stamp = 0;
  const listeners = new Set();

  const keyPathOf = (storeName) => STORES[storeName].keyPath;
  const synced = (storeName, key) => !LOCAL_STORES.has(storeName) && !(storeName === 'kv' && LOCAL_KV.has(key));
  const outboxKey = (storeName, key) => storeName + SEP + key;
  // Carimbo único por gravação: a confirmação do envio só apaga a entrada da fila
  // se ninguém gravou o mesmo registro depois
  const nextStamp = () => Date.now() * 1000 + (stamp = (stamp + 1) % 1000);

  /** Escolhe o banco do usuário (fecha o anterior). */
  function use(name) {
    if (name === dbName) return;
    close();
    dbName = name;
  }

  function close() {
    if (dbPromise) dbPromise.then((db) => db.close()).catch(() => {});
    dbPromise = null;
  }

  function openNamed(name) {
    return new Promise((resolve, reject) => {
      if (!root.indexedDB) {
        reject(new Error('Este navegador não oferece IndexedDB; não é possível guardar os cards neste aparelho.'));
        return;
      }
      const req = root.indexedDB.open(name, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const [store, def] of Object.entries(STORES)) {
          if (db.objectStoreNames.contains(store)) continue;
          const os = db.createObjectStore(store, { keyPath: def.keyPath });
          for (const idx of def.indexes || []) os.createIndex(idx, idx, { unique: false });
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
  }

  function open() {
    if (!dbName) return Promise.reject(new Error('Banco local não configurado'));
    if (!dbPromise) {
      dbPromise = openNamed(dbName);
      dbPromise.catch(() => (dbPromise = null));
    }
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

  function changed() {
    for (const fn of listeners) {
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    }
  }

  /** Avisado depois de cada gravação local que precisa ir para a conta. */
  function onLocalChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function mark(tx, storeName, key, del) {
    if (!synced(storeName, key)) return false;
    tx.objectStore('outbox').put({ k: outboxKey(storeName, key), s: storeName, id: key, del: !!del, t: nextStamp() });
    return true;
  }

  async function write(storeNames, fn) {
    const db = await open();
    const tx = db.transaction([...new Set(storeNames.concat('outbox'))], 'readwrite');
    const marked = fn(tx);
    await txDone(tx);
    if (marked) changed();
  }

  async function getAll(storeName) {
    const db = await open();
    return promisify(db.transaction(storeName, 'readonly').objectStore(storeName).getAll());
  }

  async function get(storeName, key) {
    const db = await open();
    return promisify(db.transaction(storeName, 'readonly').objectStore(storeName).get(key));
  }

  /** Vários registros de uma tabela, na ordem das chaves pedidas (undefined se não existir). */
  async function getMany(storeName, keys) {
    if (!keys.length) return [];
    const db = await open();
    const store = db.transaction(storeName, 'readonly').objectStore(storeName);
    return Promise.all(keys.map((k) => promisify(store.get(k))));
  }

  function put(storeName, value) {
    return write([storeName], (tx) => {
      tx.objectStore(storeName).put(value);
      return mark(tx, storeName, value[keyPathOf(storeName)], false);
    });
  }

  async function bulkPut(storeName, values) {
    const CHUNK = 2000;
    for (let i = 0; i < values.length; i += CHUNK) {
      await write([storeName], (tx) => {
        const store = tx.objectStore(storeName);
        let marked = false;
        for (const v of values.slice(i, i + CHUNK)) {
          store.put(v);
          marked = mark(tx, storeName, v[keyPathOf(storeName)], false) || marked;
        }
        return marked;
      });
    }
  }

  function del(storeName, key) {
    return write([storeName], (tx) => {
      tx.objectStore(storeName).delete(key);
      return mark(tx, storeName, key, true);
    });
  }

  async function bulkDel(storeName, keys) {
    const CHUNK = 2000;
    for (let i = 0; i < keys.length; i += CHUNK) {
      await write([storeName], (tx) => {
        const store = tx.objectStore(storeName);
        let marked = false;
        for (const k of keys.slice(i, i + CHUNK)) {
          store.delete(k);
          marked = mark(tx, storeName, k, true) || marked;
        }
        return marked;
      });
    }
  }

  /** Várias gravações numa única transação: [{store, put?: value, del?: key}] */
  function batch(ops) {
    if (!ops.length) return Promise.resolve();
    return write(
      ops.map((o) => o.store),
      (tx) => {
        let marked = false;
        for (const op of ops) {
          const store = tx.objectStore(op.store);
          if (op.del !== undefined) {
            store.delete(op.del);
            marked = mark(tx, op.store, op.del, true) || marked;
          } else {
            store.put(op.put);
            marked = mark(tx, op.store, op.put[keyPathOf(op.store)], false) || marked;
          }
        }
        return marked;
      },
    );
  }

  /** Grava só neste aparelho, sem ir para a fila de envio (ex.: imagem baixada da conta). */
  async function putQuiet(storeName, value) {
    const db = await open();
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    return txDone(tx);
  }

  async function getKV(key, fallback) {
    const row = await get('kv', key);
    return row ? row.value : fallback;
  }

  const setKV = (key, value) => put('kv', { key, value });

  async function getMeta(key, fallback) {
    const row = await get('meta', key);
    return row ? row.value : fallback;
  }

  async function setMeta(values) {
    const db = await open();
    const tx = db.transaction('meta', 'readwrite');
    for (const [key, value] of Object.entries(values)) tx.objectStore('meta').put({ key, value });
    return txDone(tx);
  }

  /**
   * Apaga toda a coleção (restaurar backup, apagar tudo). A conta é substituída
   * no próximo envio (pendingReset), inclusive nos outros aparelhos.
   */
  async function wipe() {
    const db = await open();
    const tx = db.transaction(DATA_STORES.concat('outbox', 'meta'), 'readwrite');
    for (const name of DATA_STORES) tx.objectStore(name).clear();
    tx.objectStore('outbox').clear();
    tx.objectStore('meta').put({ key: 'pendingReset', value: true });
    await txDone(tx);
    changed();
  }

  /** Limpa a cópia local sem tocar na conta (o servidor pediu para recomeçar). */
  async function resetLocal() {
    const db = await open();
    const names = DATA_STORES.filter((s) => s !== 'sourceFiles');
    const tx = db.transaction(names.concat('outbox'), 'readwrite');
    for (const name of names) {
      if (name === 'kv') {
        // A chave da IA é deste aparelho
        const store = tx.objectStore('kv');
        const req = store.getAll();
        req.onsuccess = () => {
          for (const row of req.result) if (!LOCAL_KV.has(row.key)) store.delete(row.key);
        };
      } else tx.objectStore(name).clear();
    }
    tx.objectStore('outbox').clear();
    return txDone(tx);
  }

  // ── Fila de envio ──────────────────────────────────────────────────────────
  async function outboxBatch(limit) {
    const db = await open();
    return promisify(db.transaction('outbox', 'readonly').objectStore('outbox').getAll(null, limit));
  }

  async function outboxCount() {
    const db = await open();
    return promisify(db.transaction('outbox', 'readonly').objectStore('outbox').count());
  }

  /** Tira da fila o que foi enviado, se não houve gravação nova do mesmo registro. */
  async function outboxAck(entries) {
    if (!entries.length) return;
    const db = await open();
    const tx = db.transaction('outbox', 'readwrite');
    const store = tx.objectStore('outbox');
    for (const e of entries) {
      const req = store.get(e.k);
      req.onsuccess = () => {
        if (req.result && req.result.t === e.t) store.delete(e.k);
      };
    }
    return txDone(tx);
  }

  /**
   * Grava alterações vindas da conta: [{store, id, value|null}]. Registros com
   * alteração local ainda não enviada ficam como estão (a local vence e será enviada).
   * Devolve só as alterações aplicadas.
   */
  async function applyRemote(changes) {
    if (!changes.length) return [];
    const db = await open();
    const names = [...new Set(changes.map((c) => c.store))].concat('outbox');
    const tx = db.transaction(names, 'readwrite');
    const outbox = tx.objectStore('outbox');
    const applied = [];
    for (const c of changes) {
      const req = outbox.get(outboxKey(c.store, c.id));
      req.onsuccess = () => {
        if (req.result) return;
        const store = tx.objectStore(c.store);
        if (c.value == null) store.delete(c.id);
        else store.put(c.value);
        applied.push(c);
      };
    }
    await txDone(tx);
    return applied;
  }

  // ── Versão antiga (dados só no navegador) ──────────────────────────────────
  /** Abre o banco da versão antiga sem criá-lo quando não existe. */
  function openLegacy() {
    return new Promise((resolve) => {
      if (!root.indexedDB) return resolve(null);
      let created = false;
      const req = root.indexedDB.open(LEGACY_NAME);
      req.onupgradeneeded = (e) => {
        if (e.oldVersion === 0) {
          created = true;
          req.transaction.abort();
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('cards')) {
          db.close();
          return resolve(null);
        }
        resolve(db);
      };
      req.onerror = () => resolve(created ? null : null);
      req.onblocked = () => resolve(null);
    });
  }

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

  function deleteDatabase(name) {
    return new Promise((resolve) => {
      if (!root.indexedDB) return resolve(false);
      const req = root.indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
      req.onblocked = () => resolve(false);
    });
  }

  FC.db = {
    STORES,
    DATA_STORES,
    LOCAL_KV,
    LEGACY_NAME,
    use,
    close,
    open,
    name: () => dbName,
    synced,
    keyPathOf,
    getAll,
    get,
    getMany,
    put,
    putQuiet,
    bulkPut,
    del,
    bulkDel,
    batch,
    getKV,
    setKV,
    getMeta,
    setMeta,
    wipe,
    resetLocal,
    outboxBatch,
    outboxCount,
    outboxAck,
    applyRemote,
    onLocalChange,
    openLegacy,
    promisify,
    txDone,
    requestPersistence,
    estimate,
    deleteDatabase,
  };
})(typeof self !== 'undefined' ? self : globalThis);
