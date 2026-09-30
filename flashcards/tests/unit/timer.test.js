// Testes do cronômetro/timer de estudo (node --test): iniciar, pausar, retomar, zerar,
// timer que termina (inclusive com a página fechada) e estado que sobrevive a recarregar
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.FC = globalThis.FC || {};
const T = require('../../js/timer.js');

let now = 1_000_000;
T.clock.now = () => now;
const MIN = 60000;
const events = [];
T.on((type, p) => events.push([type, p]));

test('cronômetro: iniciar, pausar, retomar e zerar', () => {
  store.clear();
  T.use('u1');
  assert.equal(T.state.mode, 'stopwatch');
  T.start();
  now += 5 * MIN;
  assert.equal(T.elapsed(), 5 * MIN);
  T.pause();
  now += 10 * MIN; // parado: não conta
  assert.equal(T.elapsed(), 5 * MIN);
  T.resume();
  now += 2 * MIN;
  assert.equal(T.elapsed(), 7 * MIN);
  assert.equal(T.format(T.elapsed()), '7:00');
  const snap = T.snapshot();
  T.reset();
  assert.equal(T.elapsed(), 0);
  assert.equal(T.state.running, false);
  // Desfazer o "zerar": volta andando, sem perder o tempo
  T.restore(snap);
  now += 1 * MIN;
  assert.equal(T.elapsed(), 8 * MIN);
  T.pause();
  T.stop();
});

test('estado sobrevive a recarregar a página (e é de cada usuário)', () => {
  store.clear();
  T.use('u1');
  T.start();
  now += 3 * MIN;
  T.stop(); // "fecha a página"
  now += 2 * MIN;
  T.use('u1');
  assert.equal(T.elapsed(), 5 * MIN, 'contou enquanto a página estava fechada');
  T.use('u2');
  assert.equal(T.elapsed(), 0, 'outro usuário começa zerado');
  T.use('u1');
  T.pause();
  T.stop();
});

test('timer: conta para baixo, para em zero e avisa; só troca de modo parado e zerado', () => {
  store.clear();
  T.use('u1');
  assert.equal(T.setMode('timer'), true);
  assert.equal(T.setTarget(25), true);
  T.start();
  assert.equal(T.setTarget(10), false, 'não muda com o timer andando');
  now += 10 * MIN;
  assert.equal(T.remaining(), 15 * MIN);
  T.pause();
  assert.equal(T.setMode('stopwatch'), false, 'tem tempo marcado: zere antes');
  T.resume();
  events.length = 0;
  now += 20 * MIN; // passou do fim
  assert.equal(T.check(), true);
  assert.equal(T.elapsed(), 25 * MIN, 'marca só os 25 min');
  assert.equal(T.remaining(), 0);
  assert.equal(T.state.finished, true);
  assert.deepEqual(events.find((e) => e[0] === 'finished')[1], { late: false, minutes: 25 });
  T.start(); // terminado: não recomeça sem zerar
  assert.equal(T.state.running, false);
  T.reset();
  assert.equal(T.state.mode, 'timer');
  assert.equal(T.remaining(), 25 * MIN);
  T.stop();
});

test('timer que terminou com a página fechada avisa ao abrir (late)', () => {
  store.clear();
  T.use('u1');
  T.setMode('timer');
  T.setTarget(15);
  T.start();
  T.stop();
  now += 40 * MIN;
  events.length = 0;
  T.use('u1');
  assert.equal(T.elapsed(), 15 * MIN);
  assert.deepEqual(events.find((e) => e[0] === 'finished')[1], { late: true, minutes: 15 });
  assert.equal(T.format(61 * MIN + 5000), '1:01:05');
  T.stop();
});
