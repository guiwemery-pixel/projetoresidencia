/*
 * Scheduler — "Quando devo revisar este card?"
 *
 * Determinístico, sem DOM e sem IA. Recebe o estado do card + a resposta e devolve
 * o novo estado e o registro da revisão. Nada aqui lê estatísticas ou desempenho.
 *
 * 1. Primeira aprendizagem (card novo, até "formar"): intervalos fixos
 *      Errei 1 min · Difícil 5 min · Quase 10 min · Bom 1 dia · Fácil 2 dias
 *    "Bom" ou "Fácil" formam o card, que passa ao agendamento normal.
 * 2. Depois disso: FSRS-5 (Free Spaced Repetition Scheduler) com os 19 parâmetros
 *    padrão. O FSRS tem 4 notas; as 5 respostas entram assim:
 *      Errei → Again (1) · Difícil → Hard (2) · Quase → entre Hard e Good (2,5)
 *      Bom → Good (3) · Fácil → Easy (4)
 *    "Quase" usa metade da penalidade de "Difícil" (média geométrica), então os
 *    intervalos ficam sempre em ordem: Errei < Difícil < Quase < Bom < Fácil.
 * 3. "Errei" numa revisão é um esquecimento (lapso): estabilidade pós-lapso do FSRS.
 */
(function (root, factory) {
  const util = typeof module === 'object' && module.exports ? require('./util.js') : root.FC.util;
  const mod = factory(util);
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.FC = root.FC || {}).scheduler = mod;
})(typeof self !== 'undefined' ? self : this, function (util) {
  'use strict';

  const { MIN, DAY, clamp, dayStart, addDays, fmtNum } = util;

  const RATINGS = [
    { value: 1, key: 'errei', label: 'Errei', grade: 1 },
    { value: 2, key: 'dificil', label: 'Difícil', grade: 2 },
    { value: 3, key: 'quase', label: 'Quase', grade: 2.5 },
    { value: 4, key: 'bom', label: 'Bom', grade: 3 },
    { value: 5, key: 'facil', label: 'Fácil', grade: 4 },
  ];
  const RATING_BY_VALUE = Object.fromEntries(RATINGS.map((r) => [r.value, r]));

  /** Intervalos exatos da primeira aprendizagem. */
  const FIRST_LEARNING = {
    1: { minutes: 1 },
    2: { minutes: 5 },
    3: { minutes: 10 },
    4: { days: 1 },
    5: { days: 2 },
  };

  // Parâmetros padrão do FSRS-5
  const DEFAULT_W = [
    0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11,
    0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
  ];
  const DECAY = -0.5;
  const FACTOR = 19 / 81; // R(S, S) = 90%

  const DEFAULTS = {
    desiredRetention: 0.9,
    maximumInterval: 3650,
    rolloverHour: 4,
    w: DEFAULT_W,
  };

  function options(opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    if (!Array.isArray(o.w) || o.w.length < 19 || o.w.some((x) => typeof x !== 'number' || !isFinite(x))) o.w = DEFAULT_W;
    o.desiredRetention = clamp(Number(o.desiredRetention) || 0.9, 0.7, 0.99);
    o.maximumInterval = clamp(Math.round(Number(o.maximumInterval) || 3650), 1, 36500);
    o.rolloverHour = clamp(Math.round(Number(o.rolloverHour) || 0), 0, 23);
    return o;
  }

  // ── Fórmulas FSRS-5 ────────────────────────────────────────────────────────
  function initStability(g, w) {
    const lo = Math.floor(g);
    const hi = Math.ceil(g);
    if (lo === hi) return w[lo - 1];
    const t = g - lo;
    return Math.exp(Math.log(w[lo - 1]) * (1 - t) + Math.log(w[hi - 1]) * t);
  }

  const rawInitDifficulty = (g, w) => w[4] - Math.exp(w[5] * (g - 1)) + 1;
  const initDifficulty = (g, w) => clamp(rawInitDifficulty(g, w), 1, 10);

  function nextDifficulty(d, g, w) {
    const delta = -w[6] * (g - 3);
    const damped = d + (delta * (10 - d)) / 9;
    const reverted = w[7] * rawInitDifficulty(4, w) + (1 - w[7]) * damped;
    return clamp(reverted, 1, 10);
  }

  function retrievabilityAt(elapsedDays, stability) {
    if (!stability || stability <= 0) return 0;
    return Math.pow(1 + (FACTOR * Math.max(0, elapsedDays)) / stability, DECAY);
  }

  function intervalFor(stability, o) {
    const ivl = (stability / FACTOR) * (Math.pow(o.desiredRetention, 1 / DECAY) - 1);
    return clamp(Math.round(ivl), 1, o.maximumInterval);
  }

  function successFactor(g, w) {
    if (g < 3) return Math.pow(w[15], 3 - g);
    if (g > 3) return Math.pow(w[16], g - 3);
    return 1;
  }

  function recallStability(d, s, r, g, w) {
    const inc = Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * (Math.exp(w[10] * (1 - r)) - 1) * successFactor(g, w);
    return s * (inc + 1);
  }

  function forgetStability(d, s, r, w) {
    const longTerm = w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp(w[14] * (1 - r));
    const shortTerm = s / Math.exp(w[17] * w[18]);
    return Math.min(longTerm, shortTerm);
  }

  const shortTermStability = (s, g, w) => s * Math.exp(w[17] * (g - 3 + w[18]));

  // ── Estado do card ─────────────────────────────────────────────────────────
  function newState() {
    return {
      state: 'new',
      dueDate: null,
      lastReview: null,
      stability: null,
      difficulty: null,
      repetitions: 0,
      lapses: 0,
      scheduledDays: 0,
    };
  }

  const isNew = (card) => !card.state || card.state === 'new';
  const isLearning = (card) => card.state === 'learning';

  function isDue(card, now) {
    if (isNew(card)) return false;
    return card.dueDate != null && card.dueDate <= now;
  }

  function lastReviewOf(card) {
    if (card.lastReview) return card.lastReview;
    if (card.dueDate && card.scheduledDays) return card.dueDate - card.scheduledDays * DAY;
    return null;
  }

  /** Probabilidade estimada de lembrar agora (null para cards novos). */
  function retrievability(card, now) {
    if (isNew(card) || !card.stability) return null;
    const last = lastReviewOf(card);
    if (last == null) return null;
    return retrievabilityAt((now - last) / DAY, card.stability);
  }

  /**
   * Calcula o resultado das 5 respostas possíveis de uma vez (os botões mostram
   * exatamente o que será aplicado).
   */
  function outcomes(card, now, opts) {
    const o = options(opts);
    const w = o.w;
    const today = dayStart(now, o.rolloverHour);
    const results = {};

    if (isNew(card) || isLearning(card)) {
      const first = isNew(card);
      const prevS = card.stability;
      const last = lastReviewOf(card);
      const r = first || !prevS || last == null ? null : retrievabilityAt((now - last) / DAY, prevS);
      for (const rating of RATINGS) {
        const g = rating.grade;
        const s = first || !prevS ? initStability(g, w) : shortTermStability(prevS, g, w);
        const d = first || card.difficulty == null ? initDifficulty(g, w) : nextDifficulty(card.difficulty, g, w);
        const step = FIRST_LEARNING[rating.value];
        const graduates = !!step.days;
        const due = graduates ? addDays(today, step.days) : now + step.minutes * MIN;
        results[rating.value] = {
          rating: rating.value,
          state: graduates ? 'review' : 'learning',
          stability: s,
          difficulty: d,
          due,
          intervalDays: graduates ? step.days : step.minutes / 1440,
          retrievability: r,
          lapse: false,
        };
      }
      return results;
    }

    // Revisão (FSRS)
    const s = card.stability > 0 ? card.stability : Math.max(1, card.scheduledDays || 1);
    const d = card.difficulty != null ? card.difficulty : initDifficulty(3, w);
    const last = lastReviewOf(card);
    const elapsed = last == null ? card.scheduledDays || 0 : (now - last) / DAY;
    const r = retrievabilityAt(elapsed, s);
    const sameDay = last != null && dayStart(last, o.rolloverHour) === today;

    const ivls = {};
    const memo = {};
    for (const rating of RATINGS) {
      const g = rating.grade;
      let ns;
      if (rating.value === 1) ns = forgetStability(d, s, r, w);
      else if (sameDay) ns = Math.max(s, shortTermStability(s, g, w));
      else ns = recallStability(d, s, r, g, w);
      memo[rating.value] = { s: ns, d: nextDifficulty(d, g, w) };
      ivls[rating.value] = intervalFor(ns, o);
    }
    // Ordem garantida entre as respostas de acerto
    ivls[2] = Math.max(ivls[2], 1);
    ivls[3] = Math.max(ivls[3], ivls[2] + 1);
    ivls[4] = Math.max(ivls[4], ivls[3] + 1);
    ivls[5] = Math.max(ivls[5], ivls[4] + 1);
    for (const v of [2, 3, 4, 5]) ivls[v] = Math.min(ivls[v], o.maximumInterval);

    for (const rating of RATINGS) {
      const v = rating.value;
      results[v] = {
        rating: v,
        state: 'review',
        stability: memo[v].s,
        difficulty: memo[v].d,
        due: addDays(today, ivls[v]),
        intervalDays: ivls[v],
        retrievability: r,
        lapse: v === 1,
      };
    }
    return results;
  }

  /** Intervalos para mostrar embaixo dos botões. */
  function preview(card, now, opts) {
    const all = outcomes(card, now, opts);
    return RATINGS.map((r) => ({
      rating: r.value,
      label: r.label,
      intervalDays: all[r.value].intervalDays,
      text: formatInterval(all[r.value].intervalDays),
      due: all[r.value].due,
    }));
  }

  /**
   * Aplica uma resposta. Retorna { card: campos atualizados, log: registro da revisão }.
   * Não altera o objeto recebido.
   */
  function next(card, rating, now, opts) {
    if (!RATING_BY_VALUE[rating]) throw new Error('Resposta inválida: ' + rating);
    const before = {
      state: card.state || 'new',
      stability: card.stability,
      difficulty: card.difficulty,
      scheduledDays: card.scheduledDays || 0,
      dueDate: card.dueDate,
    };
    const out = outcomes(card, now, opts)[rating];
    const last = lastReviewOf(card);
    const updated = {
      state: out.state,
      dueDate: out.due,
      lastReview: now,
      stability: out.stability,
      difficulty: out.difficulty,
      repetitions: (card.repetitions || 0) + 1,
      lapses: (card.lapses || 0) + (out.lapse ? 1 : 0),
      scheduledDays: out.intervalDays,
    };
    const log = {
      date: now,
      rating,
      previousInterval: before.scheduledDays,
      newInterval: out.intervalDays,
      stateBefore: before.state,
      stateAfter: out.state,
      stabilityBefore: before.stability == null ? null : before.stability,
      stabilityAfter: out.stability,
      difficultyBefore: before.difficulty == null ? null : before.difficulty,
      difficultyAfter: out.difficulty,
      retrievability: out.retrievability,
      elapsedDays: last == null ? null : (now - last) / DAY,
      scheduledDue: before.dueDate == null ? null : before.dueDate,
    };
    return { card: updated, log };
  }

  /**
   * Reconstrói o estado de memória a partir de um histórico (ex.: importação do Anki).
   * history: [{date, rating(1-5)}] em qualquer ordem.
   */
  function replay(history, opts) {
    let card = newState();
    const sorted = history.slice().sort((a, b) => a.date - b.date);
    for (const h of sorted) {
      if (!RATING_BY_VALUE[h.rating]) continue;
      card = Object.assign(card, next(card, h.rating, h.date, opts).card);
    }
    return card;
  }

  function formatInterval(days) {
    if (days == null) return '—';
    const minutes = days * 1440;
    if (minutes < 60) return Math.max(1, Math.round(minutes)) + ' min';
    if (days < 1) return Math.round(minutes / 60) + ' h';
    if (days < 31) {
      const d = Math.round(days);
      return d + (d === 1 ? ' dia' : ' dias');
    }
    if (days < 365) {
      const m = days / 30.4;
      const txt = m < 10 ? fmtNum(m, 1).replace(/,0$/, '') : fmtNum(Math.round(m));
      return txt + (txt === '1' ? ' mês' : ' meses');
    }
    const y = days / 365;
    const txt = fmtNum(y, 1).replace(/,0$/, '');
    return txt + (txt === '1' ? ' ano' : ' anos');
  }

  return {
    RATINGS,
    RATING_BY_VALUE,
    FIRST_LEARNING,
    DEFAULT_W,
    DEFAULTS,
    newState,
    isNew,
    isLearning,
    isDue,
    retrievability,
    retrievabilityAt,
    outcomes,
    preview,
    next,
    replay,
    formatInterval,
    // expostos para testes
    _internal: { initStability, initDifficulty, nextDifficulty, recallStability, forgetStability, intervalFor, options },
  };
});
