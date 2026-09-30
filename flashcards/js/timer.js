/*
 * Cronômetro e timer de estudo dos flashcards (opcional: Configurações → Cronômetro).
 * - Cronômetro: conta para cima. Timer: contagem regressiva até o tempo escolhido.
 * - Iniciar, pausar, retomar e zerar. O estado fica neste aparelho (localStorage) e
 *   é calculado pelo relógio: recarregar a página ou trocar de aba não perde tempo.
 * - O tempo marcado vai para o "Registrar estudo" (método Flashcards) — é assim que
 *   entra no tempo estudado do Projeto Residente (ver ui/timerView.js).
 * Sem DOM: a tela escuta FC.timer.on(fn) — eventos 'state', 'tick' e 'finished'.
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});

  const MIN = 60000;
  const MAX_TARGET_MIN = 360;
  const TICK_MS = 500;

  const fresh = () => ({ mode: 'stopwatch', running: false, startedAt: null, acc: 0, target: 25 * MIN, finished: false });
  let state = fresh();
  let key = null;
  let tick = null;
  const listeners = new Set();
  const clock = { now: () => Date.now() };

  function emit(type, payload) {
    for (const fn of listeners) {
      try {
        fn(type, payload);
      } catch (e) {
        console.error(e);
      }
    }
  }

  function save() {
    if (!key) return;
    try {
      root.localStorage.setItem(key, JSON.stringify(state));
    } catch (e) {
      /* sem armazenamento: continua só na memória */
    }
  }

  function raw(now) {
    return state.acc + (state.running && state.startedAt != null ? Math.max(0, now - state.startedAt) : 0);
  }

  /** Tempo marcado (ms). No timer, nunca passa do tempo escolhido. */
  function elapsed(now = clock.now()) {
    const e = raw(now);
    return state.mode === 'timer' ? Math.min(e, state.target) : e;
  }

  /** Timer: quanto falta (ms). */
  function remaining(now = clock.now()) {
    return Math.max(0, state.target - raw(now));
  }

  function ensureTick() {
    const want = state.running && typeof root.setInterval === 'function';
    if (want && !tick) {
      tick = root.setInterval(() => {
        check();
        emit('tick');
      }, TICK_MS);
    } else if (!want && tick) {
      root.clearInterval(tick);
      tick = null;
    }
  }

  /** Timer chegou a zero: para, marca o tempo inteiro e avisa (late = terminou com a página fechada). */
  function check(now = clock.now(), late = false) {
    if (state.mode !== 'timer' || !state.running || raw(now) < state.target) return false;
    state.acc = state.target;
    state.running = false;
    state.startedAt = null;
    state.finished = true;
    save();
    ensureTick();
    emit('state');
    emit('finished', { late, minutes: Math.round(state.target / MIN) });
    return true;
  }

  function start(now = clock.now()) {
    if (state.running) return;
    if (state.mode === 'timer' && raw(now) >= state.target) return; // já terminou: zere antes
    state.running = true;
    state.startedAt = now;
    state.finished = false;
    save();
    ensureTick();
    emit('state');
  }

  function pause(now = clock.now()) {
    if (!state.running) return;
    state.acc = state.mode === 'timer' ? Math.min(raw(now), state.target) : raw(now);
    state.running = false;
    state.startedAt = null;
    save();
    ensureTick();
    emit('state');
  }

  function reset() {
    state = Object.assign(fresh(), { mode: state.mode, target: state.target });
    save();
    ensureTick();
    emit('state');
  }

  /** Troca cronômetro ↔ timer (só parado e zerado, para não misturar tempos). */
  function setMode(mode) {
    if (mode !== 'stopwatch' && mode !== 'timer') return false;
    if (mode === state.mode) return true;
    if (state.running || state.acc > 0) return false;
    state.mode = mode;
    state.finished = false;
    save();
    emit('state');
    return true;
  }

  /** Tempo do timer, em minutos (1 a 360). Não muda com o timer andando. */
  function setTarget(minutes) {
    const m = Math.round(Number(minutes));
    if (!Number.isFinite(m) || state.running) return false;
    state.target = Math.min(MAX_TARGET_MIN, Math.max(1, m)) * MIN;
    state.finished = false;
    save();
    emit('state');
    return true;
  }

  /** Estado anterior (para "Desfazer" depois de zerar). */
  function snapshot() {
    return Object.assign({}, state, { at: clock.now() });
  }

  function restore(snap) {
    if (!snap) return;
    const { at, ...s } = snap;
    state = Object.assign(fresh(), s);
    // Estava andando: continua de onde estava (o tempo entre zerar e desfazer conta)
    if (state.running && state.startedAt == null) state.startedAt = at;
    save();
    ensureTick();
    emit('state');
  }

  /** Um cronômetro por usuário neste aparelho. */
  function use(userId) {
    key = userId ? 'fc-timer:' + userId : null;
    state = fresh();
    if (key) {
      try {
        const saved = JSON.parse(root.localStorage.getItem(key) || 'null');
        if (saved && typeof saved === 'object') state = Object.assign(fresh(), saved);
      } catch (e) {
        /* estado inválido: começa zerado */
      }
    }
    check(clock.now(), true);
    ensureTick();
    emit('state');
  }

  function stop() {
    key = null;
    if (tick) root.clearInterval(tick);
    tick = null;
  }

  /** 0:05 · 12:34 · 1:02:03 */
  function format(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
  }

  function on(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  FC.timer = {
    MIN,
    clock,
    get state() {
      return Object.assign({}, state);
    },
    elapsed,
    remaining,
    start,
    pause,
    resume: start,
    reset,
    setMode,
    setTarget,
    snapshot,
    restore,
    check,
    use,
    stop,
    format,
    on,
  };
  if (typeof module !== 'undefined') module.exports = FC.timer;
})(typeof self !== 'undefined' ? self : globalThis);
