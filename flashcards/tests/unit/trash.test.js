// Testes da lixeira: excluir baralho/área/cards e restaurar tudo no lugar, com o
// histórico (node --test, com um banco em memória no lugar do IndexedDB)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../../js/util.js');

// Banco em memória com a mesma API que os módulos usam
function memoryDb() {
  const data = new Map();
  const keyOf = (s, v) => (s === 'kv' ? v.key : v.id);
  const st = (s) => (data.has(s) ? data.get(s) : data.set(s, new Map()).get(s));
  const clone = (v) => JSON.parse(JSON.stringify(v));
  return {
    data,
    async getAll(s) {
      return [...st(s).values()].map(clone);
    },
    async get(s, k) {
      return st(s).has(k) ? clone(st(s).get(k)) : undefined;
    },
    async getMany(s, keys) {
      return keys.map((k) => (st(s).has(k) ? clone(st(s).get(k)) : undefined));
    },
    async put(s, v) {
      st(s).set(keyOf(s, v), clone(v));
    },
    async bulkPut(s, list) {
      for (const v of list) st(s).set(keyOf(s, v), clone(v));
    },
    async del(s, k) {
      st(s).delete(k);
    },
    async bulkDel(s, keys) {
      for (const k of keys) st(s).delete(k);
    },
    async batch(ops) {
      for (const o of ops) if (o.del !== undefined) st(o.store).delete(o.del);
      else st(o.store).set(keyOf(o.store, o.put), clone(o.put));
    },
  };
}

globalThis.FC = Object.assign(globalThis.FC || {}, { util: U });
require('../../js/store.js');
require('../../js/areas.js');
require('../../js/decks.js');
require('../../js/cards.js');
require('../../js/trash.js');
const FC = globalThis.FC;

async function fresh() {
  FC.db = memoryDb();
  FC.store.cards = new Map();
  FC.store.nodes = new Map();
  FC.store.decks = new Map();
  FC.store.logs = [];
  FC.store.reindexLogs();
  const deck = await FC.decks.create('Oftalmo');
  const sub = await FC.decks.create('Oftalmo::Retina');
  const other = await FC.decks.create('Cardio');
  const area = await FC.areas.create('Oftalmologia', null);
  const topic = await FC.areas.create('Retina', area.id);
  const mk = async (i, deckId, nodeId) => {
    const card = { id: 'c' + i, front: '<p>Pergunta ' + i + '</p>', back: 'R' + i, deckId, nodeId, state: 'review', dueDate: 1, createdAt: i };
    Object.assign(card, FC.areas.pathFields(nodeId));
    FC.store.cards.set(card.id, card);
    await FC.db.put('cards', card);
    const log = { id: 'l' + i, cardId: card.id, date: 1000 + i, rating: 3 };
    FC.store.addLogs([log]);
    await FC.db.put('logs', log);
    return card;
  };
  await mk(1, deck.id, area.id);
  await mk(2, sub.id, topic.id);
  await mk(3, other.id, null);
  return { deck, sub, other, area, topic };
}

test('lixeira: baralho excluído com os cards volta inteiro, com sub-baralho e histórico', async () => {
  const { deck, sub } = await fresh();
  const batch = await FC.decks.remove(deck.id, 'delete');
  assert.ok(batch && batch.id);
  assert.deepEqual([...FC.store.cards.keys()], ['c3']);
  assert.equal(FC.store.logs.length, 1);
  assert.ok(!FC.decks.get(deck.id));

  const [b] = await FC.trash.list();
  assert.equal(b.label, 'Baralho "Oftalmo"');
  assert.deepEqual([b.decks, b.cards, b.nodes], [2, 2, 0]);

  const r = await FC.trash.restore(b.id);
  assert.equal(r.cards, 2);
  assert.equal(FC.cards.get('c2').deckId, sub.id);
  assert.ok(FC.decks.get(deck.id) && FC.decks.get(sub.id));
  assert.deepEqual(FC.store.cardLogs('c1').map((l) => l.id), ['l1']);
  assert.equal((await FC.trash.list()).length, 0);
  // O banco local também voltou
  assert.ok(await FC.db.get('cards', 'c1'));
  assert.ok(await FC.db.get('logs', 'l2'));
});

test('lixeira: área excluída mantendo os cards — ao restaurar, os cards voltam para ela', async () => {
  const { area, topic } = await fresh();
  await FC.areas.remove(area.id, 'parent');
  assert.equal(FC.cards.get('c1').nodeId, null);
  assert.equal(FC.cards.get('c2').nodeId, null);
  assert.deepEqual(FC.cards.select({ nodeIds: ['__none__'] }).map((c) => c.id).sort(), ['c1', 'c2', 'c3']);

  const [b] = await FC.trash.list();
  assert.equal(b.label, 'Grande área "Oftalmologia"');
  await FC.trash.restore(b.id);
  assert.equal(FC.cards.get('c1').nodeId, area.id);
  assert.equal(FC.cards.get('c2').nodeId, topic.id);
  assert.equal(FC.cards.get('c2').areaId, area.id);
  assert.equal(FC.cards.get('c3').nodeId, null);
});

test('lixeira: área excluída com os cards; baralho sumiu e área recriada com o mesmo nome', async () => {
  const { area, deck, sub } = await fresh();
  await FC.areas.remove(area.id, 'delete');
  assert.deepEqual([...FC.store.cards.keys()], ['c3']);
  // Enquanto isso: o baralho saiu de vez e a área foi criada de novo
  FC.store.decks.delete(deck.id);
  FC.store.decks.delete(sub.id);
  const again = await FC.areas.create('Oftalmologia', null);
  const [b] = await FC.trash.list();
  await FC.trash.restore(b.id);
  // Junta com a área de mesmo nome; card sem baralho vai para um baralho que existe
  assert.equal(FC.cards.get('c1').nodeId, again.id);
  assert.equal(FC.areas.path(FC.cards.get('c2').nodeId).map((n) => n.name).join(' › '), 'Oftalmologia › Retina');
  assert.ok(FC.decks.get(FC.cards.get('c1').deckId));
  assert.ok(FC.decks.get(FC.cards.get('c2').deckId));
});

test('lixeira: excluir de vez, esvaziar e prazo de 30 dias', async () => {
  await fresh();
  const b1 = await FC.cards.remove('c3');
  assert.match(b1.label, /^Card "Pergunta 3"$/);
  const b2 = await FC.cards.remove(['c1', 'c2'], { trash: 'Sem classificação' });
  assert.equal((await FC.trash.list()).length, 2);
  // Excluir sem lixeira (desfazer "adicionar" nos cards da plataforma)
  FC.store.cards.set('x', { id: 'x', front: 'a', back: 'b' });
  assert.equal(await FC.cards.remove('x', { trash: false }), null);
  assert.equal((await FC.trash.list()).length, 2);

  assert.equal(await FC.trash.purge([b1.id]), 1);
  assert.deepEqual((await FC.trash.list()).map((b) => b.id), [b2.id]);
  assert.equal(await FC.trash.expire(Date.now() + 29 * 86400000), 0);
  assert.equal(await FC.trash.expire(Date.now() + 31 * 86400000), 2);
  assert.equal((await FC.trash.list()).length, 0);
});
