/*
 * Baralhos (decks): coleções de cards, independentes da hierarquia de conteúdo.
 * Nomes com "::" formam sub-baralhos, como no Anki ("Tutoria CG::Caso 11").
 * Baralho suspenso ou arquivado não entra na revisão normal.
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  const { uid, normalizeText } = FC.util;
  const store = () => FC.store;

  const DEFAULT_NAME = 'Meus cards';

  function all() {
    return [...store().decks.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  const get = (id) => (id ? store().decks.get(id) || null : null);

  function findByName(name) {
    const key = normalizeText(name);
    return all().find((d) => normalizeText(d.name) === key) || null;
  }

  function cleanName(name) {
    return String(name || '')
      .split('::')
      .map((p) => p.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('::')
      .slice(0, 200);
  }

  async function create(name, extra) {
    const clean = cleanName(name) || DEFAULT_NAME;
    const existing = findByName(clean);
    if (existing) return existing;
    const deck = Object.assign({ id: uid('d'), name: clean, archived: false, suspended: false, createdAt: Date.now(), description: '' }, extra || {});
    store().decks.set(deck.id, deck);
    await FC.db.put('decks', deck);
    store().emit('decks');
    return deck;
  }

  const getOrCreate = (name) => create(name);

  async function ensureDefault() {
    if (store().decks.size) return all()[0];
    return create(DEFAULT_NAME);
  }

  /** Ids do baralho e de todos os sub-baralhos ("Pai::Filho"). */
  function descendantIds(id) {
    const deck = get(id);
    if (!deck) return new Set();
    const prefix = deck.name + '::';
    return new Set(all().filter((d) => d.id === id || d.name.startsWith(prefix)).map((d) => d.id));
  }

  function cardsIn(id) {
    const ids = descendantIds(id);
    return [...store().cards.values()].filter((c) => ids.has(c.deckId));
  }

  /** Baralhos que bloqueiam a revisão normal (suspenso/arquivado, inclusive por herança). */
  function blockedIds() {
    const blocked = new Set();
    for (const d of all()) {
      if (d.archived || d.suspended) for (const id of descendantIds(d.id)) blocked.add(id);
    }
    return blocked;
  }

  async function update(id, patch) {
    const deck = get(id);
    if (!deck) return;
    Object.assign(deck, patch);
    await FC.db.put('decks', deck);
    store().emit('decks');
    return deck;
  }

  async function rename(id, name) {
    const deck = get(id);
    const clean = cleanName(name);
    if (!deck || !clean) return;
    const twin = findByName(clean);
    if (twin && twin.id !== id) throw new Error('Já existe um baralho com esse nome.');
    const oldPrefix = deck.name + '::';
    const ops = [];
    for (const d of all()) {
      if (d.name.startsWith(oldPrefix)) {
        d.name = clean + '::' + d.name.slice(oldPrefix.length);
        ops.push({ store: 'decks', put: d });
      }
    }
    deck.name = clean;
    ops.push({ store: 'decks', put: deck });
    await FC.db.batch(ops);
    store().emit('decks');
  }

  /** Duplica o baralho com cópias dos cards (agendamento zerado, como cards novos). */
  async function duplicate(id) {
    const deck = get(id);
    if (!deck) return null;
    let name = deck.name + ' (cópia)';
    let i = 2;
    while (findByName(name)) name = deck.name + ' (cópia ' + i++ + ')';
    const copy = await create(name, { description: deck.description || '' });
    const cards = [...store().cards.values()].filter((c) => c.deckId === id);
    await FC.cards.bulkCreate(
      cards.map((c) => ({
        front: c.front,
        back: c.back,
        nodeId: c.nodeId,
        tags: c.tags,
        source: c.source,
        reference: c.reference,
        estDifficulty: c.estDifficulty,
        estDifficultyBy: c.estDifficultyBy,
        cardType: c.cardType,
        origin: 'duplicado',
        deckId: copy.id,
      })),
    );
    return copy;
  }

  /** Exclui o baralho. mode 'move' manda os cards para targetId; 'delete' exclui os cards. */
  async function remove(id, mode = 'delete', targetId = null) {
    const ids = descendantIds(id);
    const cards = [...store().cards.values()].filter((c) => ids.has(c.deckId));
    if (mode === 'move' && targetId && !ids.has(targetId)) {
      await FC.cards.move(cards.map((c) => c.id), { deckId: targetId });
    } else {
      await FC.cards.remove(cards.map((c) => c.id));
    }
    for (const did of ids) store().decks.delete(did);
    await FC.db.bulkDel('decks', [...ids]);
    store().emit('decks');
  }

  /** Árvore para exibição: [{deck, children:[...], depth}] */
  function tree() {
    const list = all();
    const byName = new Map(list.map((d) => [d.name, { deck: d, children: [] }]));
    const rootsOut = [];
    for (const d of list) {
      const parts = d.name.split('::');
      let parent = null;
      for (let i = parts.length - 1; i > 0 && !parent; i--) parent = byName.get(parts.slice(0, i).join('::')) || null;
      if (parent) parent.children.push(byName.get(d.name));
      else rootsOut.push(byName.get(d.name));
    }
    return rootsOut;
  }

  const shortName = (deck) => (deck ? deck.name.split('::').pop() : '—');

  FC.decks = { DEFAULT_NAME, all, get, findByName, create, getOrCreate, ensureDefault, descendantIds, cardsIn, blockedIds, update, rename, duplicate, remove, tree, shortName, cleanName };
})(typeof self !== 'undefined' ? self : this);
