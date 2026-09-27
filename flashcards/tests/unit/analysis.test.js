// Testes de Quick Review, desempenho/pontos fracos, dificuldade e estatísticas (node --test)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Q = require('../../js/quickReview.js');
const P = require('../../js/performance.js');
const D = require('../../js/difficulty.js');
const ST = require('../../js/statistics.js');
const { DAY } = require('../../js/util.js');

const NOW = new Date(2026, 8, 26, 15, 0).getTime();

// ── Quick Review ─────────────────────────────────────────────────────────────
test('Quick Review: "Sei" de primeira sai da sessão; "Não sei" volta logo', () => {
  const s = Q.create(['a', 'b', 'c', 'd', 'e']);
  assert.equal(s.current(), 'a');
  s.answer('sei');
  assert.equal(s.current(), 'b');
  s.answer('naosei'); // volta depois de 2 cards
  assert.deepEqual(s.queue.slice(0, 3), ['c', 'd', 'b']);
  s.answer('quase'); // c volta mais adiante
  assert.ok(s.queue.includes('c'));
  assert.ok(!s.queue.includes('a'));
});

test('Quick Review: depois de errar, precisa de dois "Sei" seguidos', () => {
  const s = Q.create(['x']);
  s.answer('naosei');
  assert.equal(s.current(), 'x');
  s.answer('sei');
  assert.equal(s.current(), 'x');
  s.answer('sei');
  assert.equal(s.current(), null);
  assert.equal(s.finished, true);
});

test('Quick Review: relatório conta a primeira resposta de cada card', () => {
  const s = Q.create(['a', 'b', 'c', 'd']);
  s.answer('sei');
  s.answer('naosei');
  s.answer('quase');
  s.answer('sei');
  while (s.current()) s.answer('sei');
  const r = s.report();
  assert.equal(r.reviewed, 4);
  assert.deepEqual(r.counts, { sei: 2, quase: 1, naosei: 1 });
  assert.equal(r.accuracy, 0.5);
  assert.ok(r.presentations > 4);
  assert.deepEqual(r.missedIds.sort(), ['b', 'c']);
});

test('Quick Review: desfazer reproduz exatamente o estado anterior', () => {
  const s = Q.create(['a', 'b', 'c', 'd', 'e', 'f']);
  s.answer('naosei');
  s.answer('sei');
  const snapshot = JSON.stringify([s.queue, [...s.records]]);
  s.answer('quase');
  s.undo();
  assert.equal(JSON.stringify([s.queue, [...s.records]]), snapshot);
});

// ── Pontos fracos ────────────────────────────────────────────────────────────
function scenario() {
  const nodes = [
    { id: 'cm', name: 'Clínica Médica', level: 0, parentId: null },
    { id: 'inf', name: 'Infectologia', level: 1, parentId: 'cm' },
    { id: 'tb', name: 'Tuberculose', level: 2, parentId: 'inf' },
    { id: 'epi', name: 'Epidemiologia', level: 3, parentId: 'tb' },
    { id: 'fisio', name: 'Fisiopatologia', level: 3, parentId: 'tb' },
    { id: 'trat', name: 'Tratamento', level: 3, parentId: 'tb' },
    { id: 'cir', name: 'Cirurgia', level: 0, parentId: null },
    { id: 'dig', name: 'Digestiva', level: 1, parentId: 'cir' },
    { id: 'aca', name: 'Acalasia', level: 2, parentId: 'dig' },
    { id: 'acaT', name: 'Tratamento', level: 3, parentId: 'aca' },
    { id: 'acaD', name: 'Diagnóstico', level: 3, parentId: 'aca' },
  ];
  const cards = [];
  const logs = [];
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const add = (nodeId, nCards, reviewsPerCard, acc, daysAgo = 40) => {
    for (let i = 0; i < nCards; i++) {
      const id = nodeId + i;
      cards.push({ id, nodeId, state: 'review', stability: 8, difficulty: 5, lastReview: NOW - DAY, repetitions: reviewsPerCard, lapses: 0, scheduledDays: 8 });
      for (let j = 0; j < reviewsPerCard; j++) logs.push({ cardId: id, date: NOW - (daysAgo - j) * DAY, rating: rnd() < acc ? 4 : 1 });
    }
  };
  add('epi', 6, 14, 0.92);
  add('fisio', 6, 14, 0.48);
  add('trat', 6, 14, 0.82);
  add('acaT', 1, 3, 0.33); // poucos dados
  add('acaD', 1, 4, 0.9);
  return { nodes, cards, logs };
}

test('ponto fraco: aponta o tema específico (Fisiopatologia da TB), não a área', () => {
  const ctx = P.buildContext(Object.assign(scenario(), { now: NOW }));
  const aggs = P.nodeStats(ctx);
  const weak = P.weakPoints(ctx, aggs);
  assert.ok(weak.enoughData);
  assert.equal(weak.items[0].nodeId, 'fisio');
  assert.ok(!weak.items.some((a) => ['cm', 'inf', 'tb'].includes(a.nodeId)), 'nunca um nível genérico quando o específico tem dados');
});

test('ponto fraco: 3 revisões não bastam (dados insuficientes)', () => {
  const ctx = P.buildContext(Object.assign(scenario(), { now: NOW }));
  const aggs = P.nodeStats(ctx);
  assert.equal(aggs.get('acaT').eligible, false);
  assert.equal(aggs.get('aca').eligible, false, 'o assunto também tem só 7 revisões');
  assert.ok(!P.weakPoints(ctx, aggs).items.some((a) => a.nodeId === 'acaT'));
});

test('ponto fraco: sobe um nível quando o tema não tem dados suficientes', () => {
  const data = scenario();
  // Acalasia com dados espalhados em temas pequenos: só o assunto é elegível
  data.cards = data.cards.filter((c) => !c.nodeId.startsWith('aca'));
  data.logs = data.logs.filter((l) => !l.cardId.startsWith('aca'));
  for (let i = 0; i < 4; i++) {
    const id = 'x' + i;
    const nodeId = i % 2 ? 'acaT' : 'acaD';
    data.cards.push({ id, nodeId, state: 'review', stability: 3, difficulty: 7, lastReview: NOW - DAY, repetitions: 5, lapses: 2 });
    for (let j = 0; j < 4; j++) data.logs.push({ cardId: id, date: NOW - (10 - j) * DAY, rating: j % 2 ? 4 : 1 });
  }
  const ctx = P.buildContext(Object.assign(data, { now: NOW, opts: { minReviews: 10, minCards: 3 } }));
  const aggs = P.nodeStats(ctx);
  assert.equal(aggs.get('acaT').eligible, false);
  assert.equal(aggs.get('aca').eligible, true);
  const ids = P.deepestEligible(ctx, aggs).map((a) => a.nodeId);
  assert.ok(ids.includes('aca'));
});

test('taxa suavizada: poucas revisões ficam perto da média geral', () => {
  const ctx = P.buildContext(Object.assign(scenario(), { now: NOW }));
  const aggs = P.nodeStats(ctx);
  const small = aggs.get('acaT');
  assert.ok(small.smoothed > small.accuracy, '33% em 3 revisões é puxado para a média');
});

test('tendência: detecta melhora significativa', () => {
  const entries = [];
  for (let i = 0; i < 40; i++) entries.push({ date: i, correct: i < 20 ? i % 3 === 0 : i % 10 !== 0 });
  const t = P.trend(entries);
  assert.equal(t.direction, 'up');
  assert.ok(t.significant);
  assert.ok(t.now > t.before);
});

test('tendência: estável quando não varia', () => {
  const entries = [];
  for (let i = 0; i < 40; i++) entries.push({ date: i, correct: i % 5 !== 0 });
  assert.equal(P.trend(entries).direction, 'stable');
  assert.equal(P.trend(entries.slice(0, 10)), null, 'menos de 16 revisões: sem tendência');
});

test('maior dificuldade da sessão: nível mais específico com respostas suficientes', () => {
  const nodes = scenario().nodes;
  const pathIds = (id) => {
    const out = [];
    let n = nodes.find((x) => x.id === id);
    while (n) {
      out.unshift(n.id);
      n = nodes.find((x) => x.id === n.parentId);
    }
    return out;
  };
  const entries = [
    { cardId: '1', nodeId: 'acaT', score: 0 },
    { cardId: '2', nodeId: 'acaT', score: 0 },
    { cardId: '3', nodeId: 'acaT', score: 1 },
    { cardId: '4', nodeId: 'acaD', score: 1 },
    { cardId: '5', nodeId: 'epi', score: 1 },
  ];
  const h = P.hardestInSession(entries, pathIds);
  assert.equal(h.nodeId, 'acaT');
  assert.equal(Math.round(h.accuracy * 100), 33);
  // Com só 2 respostas no tema, sobe para o assunto
  const h2 = P.hardestInSession(entries.filter((e) => e.cardId !== '3').concat([{ cardId: '6', nodeId: 'acaD', score: 1 }]), pathIds);
  assert.equal(h2.nodeId, 'aca');
});

test('"O que preciso estudar novamente?" usa só os dados', () => {
  const ctx = P.buildContext(Object.assign(scenario(), { now: NOW }));
  const res = P.studyAgain(ctx, null, (id) => id);
  assert.equal(res.main.agg.nodeId, 'fisio');
  assert.match(res.main.reasons[0], /% de acerto em \d+ revisões/);
});

// ── Dificuldade estimada ─────────────────────────────────────────────────────
test('dificuldade estimada: atribuída pela IA, ajustada pelas respostas', () => {
  assert.equal(D.estimate({ estDifficulty: 'facil', estDifficultyBy: 'ia', state: 'new' }).label, 'facil');
  const hard = D.estimate({ estDifficulty: 'facil', estDifficultyBy: 'ia', state: 'review', difficulty: 9.5, repetitions: 20 });
  assert.equal(hard.label, 'dificil', 'muitos erros tornam o card difícil');
  assert.equal(hard.basis, 'misto');
  assert.equal(D.estimate({ state: 'new' }).label, null);
});

// ── Estatísticas ─────────────────────────────────────────────────────────────
test('estatísticas: contagens, sequência e previsão', () => {
  const today = new Date(2026, 8, 26, 10).getTime();
  const cards = [
    { state: 'new' },
    { state: 'learning', dueDate: today - 1000 },
    { state: 'review', scheduledDays: 5, dueDate: today - 3 * DAY },
    { state: 'review', scheduledDays: 30, dueDate: today + 2 * DAY },
    { state: 'review', scheduledDays: 30, dueDate: today + 2 * DAY, suspended: true },
  ];
  const ov = ST.overview(cards, today);
  assert.equal(ov.total, 5);
  assert.equal(ov.new, 1);
  assert.equal(ov.mature, 1);
  assert.equal(ov.young, 1);
  assert.equal(ov.suspended, 1);
  assert.equal(ov.overdue, 1);
  const logs = [0, 1, 2, 4].map((d) => ({ date: today - d * DAY, rating: 4, cardId: 'a' }));
  const st = ST.streak(logs, today);
  assert.equal(st.current, 3);
  assert.equal(st.longest, 3);
  const fc = ST.forecast(cards, today, 7);
  assert.equal(fc[0].overdue, 1);
  assert.equal(fc[2].count, 1);
  const ps = ST.periodStats(logs.concat([{ date: today, rating: 1, cardId: 'b', stateBefore: 'new' }]), null, null);
  assert.equal(ps.reviews, 5);
  assert.equal(ps.errors, 1);
  assert.equal(ps.newCards, 1);
});
