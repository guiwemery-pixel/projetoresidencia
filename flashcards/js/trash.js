/*
 * Lixeira: o que a pessoa exclui (cards, baralhos, áreas/temas) fica 30 dias aqui e
 * pode ser restaurado. Cada exclusão é um "lote" (o baralho X com os cards dele).
 * Cada item do lote é um registro do store 'trash', sincronizado com a conta como os
 * outros (um registro por item, para caber no limite por registro):
 *   { id: 't:<store>:<id>', batch, label, deletedAt, store: 'cards'|'decks'|'nodes',
 *     value, logs?: [...], cardIds?: [...] }
 * - card: vai com o histórico (logs), que volta junto;
 * - área/tema excluído mantendo os cards: `cardIds` lembra quais cards estavam nele,
 *   para voltarem ao lugar ao restaurar.
 * Os cards da plataforma sobem sem frente/verso (sync.js) e são completados ao restaurar.
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});

  const KEEP_DAYS = 30;
  const DAY = 86400000;
  const ORDER = { nodes: 0, decks: 1, cards: 2 };

  const key = (storeName, id) => 't:' + storeName + ':' + id;
  const store = () => FC.store;

  function batch(label) {
    return { id: FC.util.uid('tb'), label, deletedAt: Date.now() };
  }

  /** Guarda os itens num lote. items: [{store, value, logs?, cardIds?}] */
  async function put(b, items) {
    if (!items.length) return;
    const rows = items.map((it) => {
      const row = { id: key(it.store, it.value.id), batch: b.id, label: b.label, deletedAt: b.deletedAt, store: it.store, value: it.value };
      if (it.logs && it.logs.length) row.logs = it.logs;
      if (it.cardIds && it.cardIds.length) row.cardIds = it.cardIds;
      return row;
    });
    await FC.db.bulkPut('trash', rows);
    store().emit('trash');
  }

  /** Lotes da lixeira, do mais recente ao mais antigo. */
  async function list() {
    const rows = await FC.db.getAll('trash');
    const byBatch = new Map();
    for (const r of rows) {
      if (!byBatch.has(r.batch)) byBatch.set(r.batch, { id: r.batch, label: r.label, deletedAt: r.deletedAt, cards: 0, decks: 0, nodes: 0, rows: [] });
      const b = byBatch.get(r.batch);
      b[r.store] = (b[r.store] || 0) + 1;
      b.rows.push(r);
      if (r.deletedAt < b.deletedAt) b.deletedAt = r.deletedAt;
    }
    return [...byBatch.values()].map((b) => Object.assign(b, { expiresAt: b.deletedAt + KEEP_DAYS * DAY })).sort((a, b) => b.deletedAt - a.deletedAt);
  }

  async function count() {
    return (await list()).length;
  }

  async function rowsOf(batchIds) {
    const set = new Set([].concat(batchIds));
    return (await FC.db.getAll('trash')).filter((r) => set.has(r.batch));
  }

  /**
   * Devolve o lote ao lugar. Área/baralho que já existe de novo com o mesmo nome recebe
   * os cards; o que perdeu o "pai" volta para o primeiro nível; card sem baralho vai
   * para o baralho padrão.
   */
  async function restore(batchId) {
    const rows = (await rowsOf(batchId)).sort((a, b) => ORDER[a.store] - ORDER[b.store] || (a.value.level || 0) - (b.value.level || 0));
    if (!rows.length) return { cards: 0 };
    const nodeMap = new Map();
    const deckMap = new Map();
    const nodes = [];
    const decks = [];
    const moveBack = [];
    const batchNodes = new Map(rows.filter((x) => x.store === 'nodes').map((x) => [x.value.id, x.value]));
    // Mantendo os cards, os de toda a árvore excluída foram para o "pai" dela
    const keptIn = (n) => {
      while (n.parentId && batchNodes.has(n.parentId)) n = batchNodes.get(n.parentId);
      return n.parentId || null;
    };
    for (const r of rows.filter((x) => x.store === 'nodes')) {
      const n = Object.assign({}, r.value);
      if (store().nodes.has(n.id)) {
        nodeMap.set(n.id, n.id);
        continue;
      }
      const parentId = n.parentId ? nodeMap.get(n.parentId) || (store().nodes.has(n.parentId) ? n.parentId : null) : null;
      const twin = FC.areas.findChild(parentId, n.name);
      if (twin) {
        nodeMap.set(n.id, twin.id);
      } else {
        const parent = parentId ? store().nodes.get(parentId) : null;
        n.parentId = parentId;
        n.level = parent ? parent.level + 1 : 0;
        if (n.level >= FC.areas.LEVELS.length) continue;
        store().nodes.set(n.id, n);
        nodes.push(n);
        nodeMap.set(n.id, n.id);
      }
      if (r.cardIds) moveBack.push({ nodeId: nodeMap.get(n.id), from: keptIn(r.value), cardIds: r.cardIds });
    }
    for (const r of rows.filter((x) => x.store === 'decks')) {
      const d = Object.assign({}, r.value);
      if (store().decks.has(d.id)) continue;
      const twin = FC.decks.findByName(d.name);
      if (twin) deckMap.set(d.id, twin.id);
      else {
        store().decks.set(d.id, d);
        decks.push(d);
      }
    }
    const cardRows = rows.filter((x) => x.store === 'cards' && !store().cards.has(x.value.id));
    // Cards da plataforma que chegaram de outro aparelho sem o texto
    const changes = cardRows.map((r) => ({ store: 'cards', id: r.value.id, value: Object.assign({}, r.value) }));
    if (FC.platform) await FC.platform.hydrate(changes);
    let fallbackDeck = null;
    const cards = [];
    const logs = [];
    for (const c of changes) {
      const card = c.value;
      if (deckMap.has(card.deckId)) card.deckId = deckMap.get(card.deckId);
      if (!store().decks.has(card.deckId)) card.deckId = (fallbackDeck = fallbackDeck || (await FC.decks.ensureDefault())).id;
      if (card.nodeId && nodeMap.has(card.nodeId)) card.nodeId = nodeMap.get(card.nodeId);
      if (card.nodeId && !store().nodes.has(card.nodeId)) card.nodeId = null;
      Object.assign(card, FC.areas.pathFields(card.nodeId));
      cards.push(card);
      const row = cardRows.find((r) => r.value.id === card.id);
      for (const l of (row && row.logs) || []) logs.push(l);
    }
    // Área excluída "mantendo os cards": os que continuam onde ficaram voltam para ela
    const moved = [];
    for (const m of moveBack) {
      if (!m.nodeId) continue;
      for (const id of m.cardIds) {
        const card = store().cards.get(id);
        if (card && (card.nodeId || null) === m.from) {
          card.nodeId = m.nodeId;
          Object.assign(card, FC.areas.pathFields(card.nodeId));
          moved.push(card);
        }
      }
    }
    for (const c of cards) store().cards.set(c.id, c);
    if (nodes.length) await FC.db.bulkPut('nodes', nodes);
    if (decks.length) await FC.db.bulkPut('decks', decks);
    if (cards.length) await FC.db.bulkPut('cards', cards);
    if (moved.length) await FC.db.bulkPut('cards', moved);
    if (logs.length) {
      const known = new Set(store().logs.map((l) => l.id));
      const fresh = logs.filter((l) => !known.has(l.id)).sort((a, b) => a.date - b.date);
      await FC.db.bulkPut('logs', fresh);
      store().addLogs(fresh);
    }
    await FC.db.bulkDel('trash', rows.map((r) => r.id));
    FC.cards.invalidateIndex();
    if (nodes.length) store().emit('nodes');
    if (decks.length) store().emit('decks');
    store().emit('cards', { restored: cards.map((c) => c.id) });
    store().emit('trash');
    return { cards: cards.length + moved.length, decks: decks.length, nodes: nodes.length };
  }

  /** Exclui de vez (um lote, vários ou tudo). */
  async function purge(batchIds) {
    const rows = batchIds == null ? await FC.db.getAll('trash') : await rowsOf(batchIds);
    await FC.db.bulkDel('trash', rows.map((r) => r.id));
    store().emit('trash');
    return rows.length;
  }

  /** Lotes com mais de 30 dias saem sozinhos (na abertura do app). */
  async function expire(now = Date.now()) {
    const old = (await list()).filter((b) => b.expiresAt <= now).map((b) => b.id);
    return old.length ? purge(old) : 0;
  }

  FC.trash = { KEEP_DAYS, batch, put, list, count, restore, purge, expire };
})(typeof self !== 'undefined' ? self : globalThis);
