/*
 * Cards: criação, edição, organização, busca e seleção.
 * O estado de agendamento é criado pelo scheduler; aqui só se guarda.
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  const { uid, normalizeText, stripHtml } = FC.util;
  const store = () => FC.store;

  const SCHED_FIELDS = ['state', 'dueDate', 'lastReview', 'stability', 'difficulty', 'repetitions', 'lapses', 'scheduledDays'];
  const EST_DIFFICULTY = { facil: 'Fácil', media: 'Média', dificil: 'Difícil' };

  const get = (id) => store().cards.get(id) || null;
  const all = () => [...store().cards.values()];

  function normalizeTags(tags) {
    const list = Array.isArray(tags) ? tags : String(tags || '').split(/[\s,]+/);
    const seen = new Set();
    const out = [];
    for (const t of list) {
      const clean = String(t || '')
        .trim()
        .replace(/^#+/, '')
        .replace(/\s+/g, '-')
        .slice(0, 80);
      if (!clean) continue;
      const key = clean.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(clean);
    }
    return out;
  }

  function normalizeDifficulty(value) {
    const v = normalizeText(value);
    if (!v) return null;
    if (v.startsWith('fac') || v === 'easy' || v === '1') return 'facil';
    if (v.startsWith('dif') || v === 'hard' || v === '3') return 'dificil';
    if (v.startsWith('med') || v === 'medium' || v === '2') return 'media';
    return null;
  }

  const clean = (html) => (FC.sanitize ? FC.sanitize(html) : String(html || ''));

  async function build(data, pendingOps) {
    let nodeId = data.nodeId || null;
    if (!nodeId && Array.isArray(data.path) && data.path.some(Boolean)) nodeId = await FC.areas.ensurePath(data.path, pendingOps);
    let deckId = data.deckId || null;
    if (!deckId && data.deckName) deckId = (await FC.decks.getOrCreate(data.deckName)).id;
    if (!deckId) deckId = (await FC.decks.ensureDefault()).id;
    const now = Date.now();
    const card = Object.assign(
      {
        id: data.id || uid('c'),
        front: clean(data.front),
        back: clean(data.back),
        deckId,
        nodeId,
        tags: normalizeTags(data.tags),
        source: data.source && (data.source.fileName || data.source.page) ? { fileName: data.source.fileName || '', page: data.source.page || null, sourceId: data.source.sourceId || null } : null,
        reference: data.reference || '',
        createdAt: data.createdAt || now,
        updatedAt: now,
        estDifficulty: normalizeDifficulty(data.estDifficulty),
        estDifficultyBy: data.estDifficultyBy || (data.estDifficulty ? 'manual' : null),
        cardType: data.cardType || '',
        origin: data.origin || 'manual',
        favorite: !!data.favorite,
        suspended: !!data.suspended,
        externalId: data.externalId || null,
      },
      FC.scheduler.newState(),
    );
    if (data.scheduling) {
      for (const f of SCHED_FIELDS) if (data.scheduling[f] !== undefined) card[f] = data.scheduling[f];
    }
    Object.assign(card, FC.areas.pathFields(nodeId));
    return card;
  }

  async function create(data) {
    const card = await build(data);
    store().cards.set(card.id, card);
    await FC.db.put('cards', card);
    invalidateIndex(card.id);
    store().emit('cards', { created: [card.id] });
    return card;
  }

  /** Criação em lote (importações/IA). logs opcionais por card: data.logs = [{...}] */
  async function bulkCreate(list, onProgress) {
    const created = [];
    const logs = [];
    const ops = [];
    let i = 0;
    for (const data of list) {
      const card = await build(data, ops);
      created.push(card);
      if (Array.isArray(data.logs)) for (const l of data.logs) logs.push(Object.assign({ id: uid('l') }, l, { cardId: card.id }));
      if (onProgress && ++i % 200 === 0) onProgress(i, list.length);
    }
    for (const c of created) store().cards.set(c.id, c);
    await FC.db.batch(ops);
    await FC.db.bulkPut('cards', created);
    if (logs.length) {
      await FC.db.bulkPut('logs', logs);
      store().addLogs(logs.sort((a, b) => a.date - b.date));
    }
    invalidateIndex();
    store().emit('cards', { created: created.map((c) => c.id) });
    return created;
  }

  async function update(id, patch) {
    const card = get(id);
    if (!card) return null;
    const p = Object.assign({}, patch);
    if ('front' in p) p.front = clean(p.front);
    if ('back' in p) p.back = clean(p.back);
    if ('tags' in p) p.tags = normalizeTags(p.tags);
    if ('estDifficulty' in p) {
      p.estDifficulty = normalizeDifficulty(p.estDifficulty);
      if (!('estDifficultyBy' in p)) p.estDifficultyBy = 'manual';
    }
    if (Array.isArray(p.path)) {
      p.nodeId = p.path.some(Boolean) ? await FC.areas.ensurePath(p.path) : null;
      delete p.path;
    }
    Object.assign(card, p, { updatedAt: Date.now() });
    if ('nodeId' in p) Object.assign(card, FC.areas.pathFields(card.nodeId));
    await FC.db.put('cards', card);
    invalidateIndex(id);
    store().emit('cards', { updated: [id] });
    return card;
  }

  async function updateMany(ids, patchFn) {
    const ops = [];
    for (const id of ids) {
      const card = get(id);
      if (!card) continue;
      patchFn(card);
      card.updatedAt = Date.now();
      ops.push({ store: 'cards', put: card });
      invalidateIndex(id);
    }
    await FC.db.batch(ops);
    store().emit('cards', { updated: ids });
  }

  async function remove(ids) {
    ids = [].concat(ids).filter((id) => store().cards.has(id));
    if (!ids.length) return;
    const set = new Set(ids);
    const logIds = store().logs.filter((l) => set.has(l.cardId)).map((l) => l.id);
    for (const id of ids) store().cards.delete(id);
    await FC.db.bulkDel('cards', ids);
    await FC.db.bulkDel('logs', logIds);
    store().removeLogs(logIds);
    invalidateIndex();
    store().emit('cards', { removed: ids });
  }

  async function duplicate(id) {
    const card = get(id);
    if (!card) return null;
    return create({
      front: card.front,
      back: card.back,
      deckId: card.deckId,
      nodeId: card.nodeId,
      tags: card.tags,
      source: card.source,
      reference: card.reference,
      estDifficulty: card.estDifficulty,
      estDifficultyBy: card.estDifficultyBy,
      cardType: card.cardType,
      origin: 'duplicado',
    });
  }

  async function move(ids, target) {
    let nodeId = target.nodeId;
    if (target.path) nodeId = await FC.areas.ensurePath(target.path);
    await updateMany(ids, (card) => {
      if (target.deckId) card.deckId = target.deckId;
      if (nodeId !== undefined) {
        card.nodeId = nodeId || null;
        Object.assign(card, FC.areas.pathFields(card.nodeId));
      }
    });
  }

  const setFavorite = (ids, value) => updateMany([].concat(ids), (c) => (c.favorite = !!value));
  const setSuspended = (ids, value) => updateMany([].concat(ids), (c) => (c.suspended = !!value));

  async function addTags(ids, tags) {
    const extra = normalizeTags(tags);
    await updateMany([].concat(ids), (c) => (c.tags = normalizeTags((c.tags || []).concat(extra))));
  }

  async function removeTag(ids, tag) {
    const key = String(tag).replace(/^#/, '').toLowerCase();
    await updateMany([].concat(ids), (c) => (c.tags = (c.tags || []).filter((t) => t.toLowerCase() !== key)));
  }

  /** Volta o card a "novo" (o histórico continua guardado para as estatísticas). */
  async function resetScheduling(ids) {
    const fresh = FC.scheduler.newState();
    await updateMany([].concat(ids), (c) => Object.assign(c, fresh));
  }

  function schedulingSnapshot(card) {
    const out = {};
    for (const f of SCHED_FIELDS) out[f] = card[f];
    return out;
  }

  // ── Busca ──────────────────────────────────────────────────────────────────
  let index = new Map();
  function invalidateIndex(id) {
    if (id) index.delete(id);
    else index = new Map();
  }

  function searchText(card) {
    let t = index.get(card.id);
    if (t == null) {
      const deck = FC.decks.get(card.deckId);
      t = normalizeText(
        [
          stripHtml(card.front),
          stripHtml(card.back),
          FC.areas.pathNames(card.nodeId).join(' '),
          deck ? deck.name.replace(/::/g, ' ') : '',
          (card.tags || []).map((x) => '#' + x).join(' '),
          card.source ? card.source.fileName : '',
          card.reference || '',
        ].join(' \n '),
      );
      index.set(card.id, t);
    }
    return t;
  }

  /**
   * Seleção de cards por filtro:
   * { deckIds, nodeIds, tags, cardIds, query, favorites, suspended: 'exclude'|'only'|'include',
   *   includeBlockedDecks, state: 'new'|'learning'|'review' }
   */
  function select(filter = {}) {
    let deckSet = null;
    if (filter.deckIds && filter.deckIds.length) {
      deckSet = new Set();
      for (const id of filter.deckIds) for (const d of FC.decks.descendantIds(id)) deckSet.add(d);
    }
    let nodeSet = null;
    if (filter.nodeIds && filter.nodeIds.length) {
      nodeSet = new Set();
      for (const id of filter.nodeIds) for (const n of FC.areas.descendantIds(id)) nodeSet.add(n);
    }
    const idSet = filter.cardIds ? new Set(filter.cardIds) : null;
    const tags = (filter.tags || []).map((t) => String(t).replace(/^#/, '').toLowerCase());
    const blocked = filter.includeBlockedDecks ? null : FC.decks.blockedIds();
    const terms = filter.query ? normalizeText(filter.query).split(' ').filter(Boolean) : [];
    const suspended = filter.suspended || 'exclude';
    const out = [];
    for (const card of store().cards.values()) {
      if (idSet && !idSet.has(card.id)) continue;
      if (deckSet && !deckSet.has(card.deckId)) continue;
      if (nodeSet && !nodeSet.has(card.nodeId)) continue;
      if (blocked && blocked.has(card.deckId)) continue;
      if (suspended === 'exclude' && card.suspended) continue;
      if (suspended === 'only' && !card.suspended) continue;
      if (filter.favorites && !card.favorite) continue;
      if (filter.state && (card.state || 'new') !== filter.state) continue;
      if (tags.length && !tags.every((t) => (card.tags || []).some((ct) => ct.toLowerCase() === t || ct.toLowerCase().startsWith(t + '::')))) continue;
      if (terms.length) {
        const text = searchText(card);
        if (!terms.every((t) => text.includes(t))) continue;
      }
      out.push(card);
    }
    return out;
  }

  function allTags() {
    const counts = new Map();
    for (const c of store().cards.values()) for (const t of c.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count }));
  }

  /** Cards do mesmo tema, assunto, subárea e área (do mais próximo ao mais amplo). */
  function related(id, limit = 12) {
    const card = get(id);
    if (!card) return [];
    const groups = [];
    const used = new Set([id]);
    const levels = [
      ['subtopicId', 'Mesmo subtema'],
      ['topicId', 'Mesmo tema'],
      ['subjectId', 'Mesmo assunto'],
      ['subareaId', 'Mesma subárea'],
      ['areaId', 'Mesma grande área'],
    ];
    let total = 0;
    for (const [field, label] of levels) {
      if (!card[field] || total >= limit) continue;
      const list = [];
      for (const other of store().cards.values()) {
        if (used.has(other.id) || other[field] !== card[field]) continue;
        list.push(other);
        used.add(other.id);
        if (total + list.length >= limit) break;
      }
      if (list.length) {
        groups.push({ label, nodeId: card[field], cards: list });
        total += list.length;
      }
    }
    return groups;
  }

  FC.cards = {
    SCHED_FIELDS,
    EST_DIFFICULTY,
    get,
    all,
    normalizeTags,
    normalizeDifficulty,
    create,
    bulkCreate,
    update,
    updateMany,
    remove,
    duplicate,
    move,
    setFavorite,
    setSuspended,
    addTags,
    removeTag,
    resetScheduling,
    schedulingSnapshot,
    invalidateIndex,
    searchText,
    select,
    allTags,
    related,
  };
})(typeof self !== 'undefined' ? self : this);
