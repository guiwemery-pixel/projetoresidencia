// Testes do scheduler (node --test)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../js/scheduler.js');
const { DAY, MIN, dayStart, addDays } = require('../../js/util.js');

const NOW = new Date(2026, 8, 26, 15, 0).getTime();
const fresh = () => S.newState();
const apply = (card, rating, t) => Object.assign({}, card, S.next(card, rating, t).card);

test('primeira aprendizagem: intervalos exatos', () => {
  const p = S.preview(fresh(), NOW).map((x) => x.text);
  assert.deepEqual(p, ['1 min', '5 min', '10 min', '1 dia', '2 dias']);
  const due = (r) => S.next(fresh(), r, NOW).card.dueDate;
  assert.equal(due(1) - NOW, 1 * MIN);
  assert.equal(due(2) - NOW, 5 * MIN);
  assert.equal(due(3) - NOW, 10 * MIN);
  assert.equal(due(4), addDays(dayStart(NOW, 4), 1));
  assert.equal(due(5), addDays(dayStart(NOW, 4), 2));
});

test('continua nos passos fixos até "Bom" ou "Fácil" formar o card', () => {
  let c = apply(fresh(), 1, NOW);
  assert.equal(c.state, 'learning');
  assert.deepEqual(S.preview(c, NOW + MIN).map((x) => x.text), ['1 min', '5 min', '10 min', '1 dia', '2 dias']);
  c = apply(c, 3, NOW + MIN);
  assert.equal(c.state, 'learning');
  c = apply(c, 4, NOW + 11 * MIN);
  assert.equal(c.state, 'review');
  assert.equal(c.scheduledDays, 1);
  assert.equal(c.lapses, 0);
});

test('depois da primeira aprendizagem: 5 intervalos calculados e em ordem', () => {
  let c = apply(fresh(), 4, NOW);
  let t = c.dueDate + 5 * 3600e3;
  for (let i = 0; i < 4; i++) {
    const days = S.preview(c, t).map((x) => x.intervalDays);
    assert.ok(days.every((d) => d >= 1), 'no mínimo 1 dia');
    for (let k = 2; k < 5; k++) assert.ok(days[k] > days[k - 1], 'Difícil < Quase < Bom < Fácil: ' + days);
    assert.ok(days[0] <= days[1], 'Errei ≤ Difícil');
    c = apply(c, 4, t);
    t = c.dueDate + 3600e3;
  }
  assert.ok(c.scheduledDays > 10, 'intervalos crescem com acertos');
});

test('"Errei" numa revisão é esquecimento: conta lapso e reduz a estabilidade', () => {
  let c = apply(fresh(), 4, NOW);
  c = apply(c, 4, c.dueDate + 3600e3);
  const t = c.dueDate + 3600e3;
  const before = c.stability;
  const res = S.next(c, 1, t);
  assert.equal(res.card.lapses, 1);
  assert.ok(res.card.stability < before);
  assert.ok(res.card.scheduledDays >= 1);
  assert.equal(res.log.rating, 1);
  assert.equal(res.log.stateBefore, 'review');
  assert.ok(res.card.difficulty > c.difficulty, 'errar aumenta a dificuldade FSRS');
});

test('determinístico: mesma entrada, mesma saída', () => {
  const c = apply(fresh(), 4, NOW);
  const a = S.next(c, 3, c.dueDate + 7200e3);
  const b = S.next(c, 3, c.dueDate + 7200e3);
  assert.deepEqual(a, b);
});

test('registro da revisão tem intervalos anterior e novo', () => {
  const c = apply(fresh(), 4, NOW);
  const res = S.next(c, 5, c.dueDate + 3600e3);
  assert.equal(res.log.previousInterval, 1);
  assert.equal(res.log.newInterval, res.card.scheduledDays);
  assert.ok(res.log.retrievability > 0.9 && res.log.retrievability <= 1);
});

test('replay reconstrói o estado a partir do histórico', () => {
  const hist = [
    { date: NOW, rating: 4 },
    { date: NOW + 2 * DAY, rating: 4 },
    { date: NOW + 10 * DAY, rating: 1 },
    { date: NOW + 12 * DAY, rating: 4 },
  ];
  const c = S.replay(hist);
  assert.equal(c.state, 'review');
  assert.equal(c.lapses, 1);
  assert.equal(c.repetitions, 4);
  assert.ok(c.stability > 0 && c.difficulty >= 1 && c.difficulty <= 10);
});

test('retenção desejada maior encurta os intervalos', () => {
  const c = apply(apply(fresh(), 4, NOW), 4, NOW + DAY + 3600e3);
  const t = c.dueDate + 3600e3;
  const low = S.preview(c, t, { desiredRetention: 0.8 })[3].intervalDays;
  const high = S.preview(c, t, { desiredRetention: 0.95 })[3].intervalDays;
  assert.ok(high < low);
});

test('formatação dos intervalos', () => {
  assert.equal(S.formatInterval(1 / 1440), '1 min');
  assert.equal(S.formatInterval(1), '1 dia');
  assert.equal(S.formatInterval(14), '14 dias');
  assert.equal(S.formatInterval(45), '1,5 meses');
  assert.equal(S.formatInterval(400), '1,1 anos');
});
