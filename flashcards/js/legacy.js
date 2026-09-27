/*
 * Dados da versão anterior do app, que guardava tudo só no navegador (banco
 * "flashcards-medicina"). Na primeira vez em que a aba de flashcards abre neste
 * navegador, o app oferece levar esses dados para a conta. O banco antigo não é
 * apagado: só fica marcado como levado (ou dispensado) para não perguntar de novo.
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});

  const STORES = ['nodes', 'decks', 'cards', 'logs', 'quickSessions', 'sessions', 'sources', 'sourceFiles', 'media', 'drafts'];

  async function withLegacy(fn) {
    const db = await FC.db.openLegacy();
    if (!db) return null;
    try {
      return await fn(db);
    } finally {
      db.close();
    }
  }

  const has = (db, name) => db.objectStoreNames.contains(name);
  const read = (db, name, method, arg) => FC.db.promisify(db.transaction(name, 'readonly').objectStore(name)[method](arg));

  /** {cards, logs} quando há dados antigos ainda não levados para a conta; senão null. */
  function check() {
    return withLegacy(async (db) => {
      const cards = await read(db, 'cards', 'count');
      if (!cards) return null;
      if (has(db, 'kv')) {
        const done = await read(db, 'kv', 'get', 'migratedTo');
        const dismissed = await read(db, 'kv', 'get', 'migrationDismissed');
        if (done || dismissed) return null;
      }
      const logs = has(db, 'logs') ? await read(db, 'logs', 'count') : 0;
      return { cards, logs };
    }).catch(() => null);
  }

  async function markLegacy(db, key, value) {
    if (!has(db, 'kv')) return;
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put({ key, value });
    await FC.db.txDone(tx);
  }

  /** Copia tudo para a coleção da conta (junta com o que já existir). */
  async function importAll(userId, onProgress) {
    const progress = onProgress || (() => {});
    const result = await withLegacy(async (db) => {
      const counts = {};
      for (const name of STORES) {
        if (!has(db, name)) continue;
        progress('Copiando ' + name + '…');
        const rows = await read(db, name, 'getAll');
        counts[name] = rows.length;
        await FC.db.bulkPut(name, rows);
      }
      if (has(db, 'kv')) {
        const kv = await read(db, 'kv', 'getAll');
        const settings = kv.find((r) => r.key === 'settings');
        if (settings && !(await FC.db.get('kv', 'settings'))) await FC.db.put('kv', settings);
        const aiKey = kv.find((r) => r.key === 'aiKey');
        if (aiKey && aiKey.value && !(await FC.db.getKV('aiKey', ''))) await FC.db.put('kv', aiKey);
      }
      await markLegacy(db, 'migratedTo', userId);
      return counts;
    });
    if (!result) return null;
    // O baralho padrão vazio criado ao abrir a aba some se os dados antigos trazem um com o mesmo nome
    const decks = await FC.db.getAll('decks');
    const auto = decks.find((d) => d.id === 'd_default');
    if (auto && decks.some((d) => d.id !== auto.id && d.name === auto.name)) {
      const cards = await FC.db.getAll('cards');
      if (!cards.some((c) => c.deckId === auto.id)) await FC.db.del('decks', auto.id);
    }
    await FC.settings.load();
    await FC.store.load();
    FC.cards.invalidateIndex();
    for (const ev of ['cards', 'decks', 'nodes', 'drafts', 'sources']) FC.store.emit(ev, { imported: true });
    return result;
  }

  function dismiss() {
    return withLegacy((db) => markLegacy(db, 'migrationDismissed', Date.now()));
  }

  FC.legacy = { check, importAll, dismiss };
})(typeof self !== 'undefined' ? self : globalThis);
