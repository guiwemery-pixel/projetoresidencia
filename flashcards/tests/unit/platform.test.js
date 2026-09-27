// Testes dos cards da plataforma: pacote do Anki → baralhos, referência ao texto
// original (não vai para a conta) e caminho na hierarquia (node --test)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../../js/util.js');
const Q = require('../../js/quickReview.js');

globalThis.FC = Object.assign(globalThis.FC || {}, { util: U });
require('../../js/platform.js');
const P = globalThis.FC.platform;

const ROOT = 'Flashcards Revisados 2026';
const pkgData = {
  cards: [
    { ankiId: 11, deck: ROOT + '::Clínica Médica::Cardiologia', front: 'IC?', back: 'FE', tags: ['cardio'] },
    { ankiId: 12, deck: ROOT + '::Clínica Médica::Cardiologia', front: 'FA?', back: 'ritmo', tags: [] },
    { ankiId: 13, deck: ROOT + '::Clínica Cirúrgica::Trauma', front: 'ATLS?', back: 'ABCDE', tags: [] },
    { ankiId: 14, deck: ROOT + '::Clínica Médica', front: 'Geral?', back: 'sim', tags: [] },
  ],
};

test('plataforma: pacote do Anki vira árvore de baralhos com contagens', () => {
  const b = P.buildPackage(pkgData);
  assert.equal(b.name, ROOT);
  assert.equal(b.cards, 4);
  const byName = Object.fromEntries(b.decks.map((d) => [d.name, d]));
  // Baralhos intermediários existem mesmo sem cards próprios; ordem alfabética por nível
  assert.deepEqual(
    b.decks.map((d) => d.name),
    [ROOT, ROOT + '::Clínica Cirúrgica', ROOT + '::Clínica Cirúrgica::Trauma', ROOT + '::Clínica Médica', ROOT + '::Clínica Médica::Cardiologia'],
  );
  assert.equal(byName[ROOT].parent, null);
  assert.equal(byName[ROOT + '::Clínica Médica::Cardiologia'].parent, byName[ROOT + '::Clínica Médica'].id);
  assert.deepEqual([byName[ROOT].own, byName[ROOT].total], [0, 4]);
  assert.deepEqual([byName[ROOT + '::Clínica Médica'].own, byName[ROOT + '::Clínica Médica'].total], [1, 3]);
  // Um arquivo por baralho com cards próprios; ids estáveis entre publicações
  assert.equal(b.files.length, 3);
  assert.deepEqual(b.files.find((f) => f.name.endsWith('Cardiologia')).cards.map((c) => c.id), ['11', '12']);
  assert.deepEqual(P.buildPackage(pkgData).decks.map((d) => d.id), b.decks.map((d) => d.id));
  assert.equal(new Set(b.decks.map((d) => d.id)).size, b.decks.length);
  for (const d of b.decks) assert.match(d.id, /^[A-Za-z0-9_-]{1,40}$/);
});

test('plataforma: caminho sem o baralho-raiz do pacote e com os nomes de área do app', () => {
  const b = P.buildPackage(pkgData);
  const pkg = { id: 'pk1', version: 'v1', decks: b.decks.map((d) => Object.assign({}, d)) };
  // Mesmo índice que load() monta
  pkg.byId = new Map(pkg.decks.map((d) => [d.id, Object.assign(d, { children: [] })]));
  pkg.roots = [];
  for (const d of pkg.decks) (d.parent ? pkg.byId.get(d.parent).children : pkg.roots).push(d);
  pkg.dropRoot = true;
  const trauma = pkg.decks.find((d) => d.name.endsWith('Trauma'));
  assert.deepEqual(P.pathFor(pkg, trauma), ['Cirurgia', 'Trauma']);
  const cardio = pkg.decks.find((d) => d.name.endsWith('Cardiologia'));
  assert.deepEqual(P.pathFor(pkg, cardio), ['Clínica Médica', 'Cardiologia']);
  // Cabeçalho do modelo (assunto › tema) manda a partir do assunto
  assert.deepEqual(P.pathFor(pkg, cardio, { subject: 'Insuficiência cardíaca', topics: ['Diagnóstico'] }), ['Clínica Médica', 'Cardiologia', 'Insuficiência cardíaca', 'Diagnóstico']);
  pkg.dropRoot = false;
  assert.deepEqual(P.pathFor(pkg, trauma), [ROOT, 'Clínica Cirúrgica', 'Trauma']);
});

test('plataforma: card com o texto original vai para a conta sem frente/verso', () => {
  const card = { id: 'c1', front: '<p>IC?</p>', back: '<p>FE</p>', state: 'review', platform: { p: 'pk1', d: 'd1', c: '11' } };
  card.platform.h = P.contentHash(card.front, card.back);
  assert.equal(P.isOriginal(card), true);
  const slim = P.slim(card);
  assert.equal('front' in slim, false);
  assert.equal('back' in slim, false);
  assert.equal(slim.state, 'review');
  assert.deepEqual(slim.platform, card.platform);
  assert.equal(card.front, '<p>IC?</p>', 'não altera o card do aparelho');
  // Editado: o texto passa a ser do usuário e vai inteiro
  const edited = Object.assign({}, card, { back: '<p>FE &lt; 40%</p>' });
  assert.equal(P.isOriginal(edited), false);
  assert.equal(P.slim(edited).back, '<p>FE &lt; 40%</p>');
  // Editado antes de entrar na coleção (sem marca) e cards comuns também vão inteiros
  assert.equal(P.slim(Object.assign({}, card, { platform: { p: 'pk1', d: 'd1', c: '11', h: null } })).front, '<p>IC?</p>');
  assert.equal(P.slim({ id: 'c2', front: 'x', back: 'y' }).front, 'x');
});

test('Quick Review: mais cards no fim da fila (sessão que carrega aos poucos)', () => {
  const s = Q.create(['a', 'b'], {});
  s.answer('sei');
  s.answer('sei');
  assert.equal(s.current(), null);
  s.append(['c', 'd']);
  assert.equal(s.finished, false);
  assert.equal(s.total, 4);
  assert.equal(s.current(), 'c');
  s.answer('naosei');
  assert.deepEqual(s.queue, ['d', 'c']);
  // Desfazer continua funcionando com os cards acrescentados
  s.undo();
  assert.deepEqual(s.queue, ['c', 'd']);
  assert.equal(s.report().reviewed, 2);
});
