/*
 * Estatísticas gerais: contagens da coleção, métricas por período, séries
 * temporais, sequência de estudos e previsão de revisões. Funções puras.
 */
(function (root, factory) {
  const util = typeof module === 'object' && module.exports ? require('./util.js') : root.FC.util;
  const mod = factory(util);
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.FC = root.FC || {}).statistics = mod;
})(typeof self !== 'undefined' ? self : this, function (util) {
  'use strict';

  const { DAY, dayStart, dayKey, addDays } = util;
  const MATURE_DAYS = 21;

  const PERIODS = [
    { key: '7', label: '7 dias', days: 7 },
    { key: '30', label: '30 dias', days: 30 },
    { key: '90', label: '90 dias', days: 90 },
    { key: '180', label: '6 meses', days: 182 },
    { key: '365', label: '1 ano', days: 365 },
    { key: 'all', label: 'Tudo', days: null },
  ];

  /** Contagens da coleção. "Aprendidos" = em revisão com intervalo ≥ 21 dias. */
  function overview(cards, now, rolloverHour = 4) {
    const start = dayStart(now, rolloverHour);
    const tomorrow = addDays(start, 1);
    const out = { total: 0, new: 0, learning: 0, young: 0, mature: 0, review: 0, suspended: 0, favorites: 0, dueNow: 0, dueToday: 0, overdue: 0 };
    for (const c of cards) {
      out.total++;
      if (c.favorite) out.favorites++;
      if (c.suspended) {
        out.suspended++;
        continue;
      }
      const state = c.state || 'new';
      if (state === 'new') {
        out.new++;
        continue;
      }
      if (state === 'learning') out.learning++;
      else {
        out.review++;
        if ((c.scheduledDays || 0) >= MATURE_DAYS) out.mature++;
        else out.young++;
      }
      if (c.dueDate != null) {
        if (c.dueDate <= now) out.dueNow++;
        if (state === 'review' && c.dueDate < start) out.overdue++;
        else if (c.dueDate < tomorrow) out.dueToday++;
      }
    }
    return out;
  }

  function periodStart(periodKey, now, rolloverHour = 4) {
    const p = PERIODS.find((x) => x.key === String(periodKey));
    if (!p || p.days == null) return null;
    return addDays(dayStart(now, rolloverHour), -(p.days - 1));
  }

  /** Métricas das revisões no período [from, to). from null = desde sempre. */
  function periodStats(logs, from, to) {
    let reviews = 0;
    let correct = 0;
    let timeMs = 0;
    let newCards = 0;
    const cards = new Set();
    for (const l of logs) {
      if (from != null && l.date < from) continue;
      if (to != null && l.date >= to) continue;
      reviews++;
      if (l.rating >= 2) correct++;
      timeMs += l.responseTime || 0;
      cards.add(l.cardId);
      if (l.stateBefore === 'new') newCards++;
    }
    return {
      reviews,
      correct,
      errors: reviews - correct,
      accuracy: reviews ? correct / reviews : null,
      timeMs,
      avgTimeMs: reviews ? timeMs / reviews : null,
      uniqueCards: cards.size,
      newCards,
    };
  }

  /** Sequência de dias com pelo menos uma revisão (atual e maior). */
  function streak(logs, now, rolloverHour = 4) {
    const days = new Set(logs.map((l) => dayKey(l.date, rolloverHour)));
    if (!days.size) return { current: 0, longest: 0, days: 0 };
    let current = 0;
    let cursor = dayStart(now, rolloverHour);
    if (!days.has(dayKey(cursor, rolloverHour))) cursor = addDays(cursor, -1); // hoje ainda pode ser estudado
    while (days.has(dayKey(cursor, rolloverHour))) {
      current++;
      cursor = addDays(cursor, -1);
    }
    const sorted = [...days].sort();
    let longest = 1;
    let run = 1;
    for (let i = 1; i < sorted.length; i++) {
      const prev = util.keyToDate(sorted[i - 1]);
      const cur = util.keyToDate(sorted[i]);
      const diff = Math.round((cur - prev) / DAY);
      run = diff === 1 ? run + 1 : 1;
      longest = Math.max(longest, run);
    }
    return { current, longest: Math.max(longest, current), days: days.size };
  }

  function bucketStart(ts, bucket, rolloverHour) {
    const d = new Date(dayStart(ts, rolloverHour));
    if (bucket === 'week') {
      const dow = (d.getDay() + 6) % 7; // semana começa na segunda
      d.setDate(d.getDate() - dow);
    } else if (bucket === 'month') {
      d.setDate(1);
    }
    return d.getTime();
  }

  function nextBucket(ts, bucket) {
    const d = new Date(ts);
    if (bucket === 'week') d.setDate(d.getDate() + 7);
    else if (bucket === 'month') d.setMonth(d.getMonth() + 1);
    else d.setDate(d.getDate() + 1);
    return d.getTime();
  }

  /**
   * Série temporal das revisões: [{start, label, reviews, correct, errors, accuracy, timeMs, newCards, learned}]
   * learned = cards que formaram (primeira vez em revisão) naquele período.
   */
  function series(logs, from, to, bucket = 'day', rolloverHour = 4) {
    if (from == null) from = logs.length ? logs[0].date : to;
    const out = [];
    const index = new Map();
    let cursor = bucketStart(from, bucket, rolloverHour);
    let guard = 0;
    while (cursor < to && guard++ < 2000) {
      const row = { start: cursor, reviews: 0, correct: 0, errors: 0, accuracy: null, timeMs: 0, newCards: 0, learned: 0 };
      index.set(cursor, row);
      out.push(row);
      cursor = nextBucket(cursor, bucket);
    }
    const graduated = new Set();
    for (const l of logs) {
      const firstGrad = l.stateAfter === 'review' && l.stateBefore !== 'review' && !graduated.has(l.cardId);
      if (firstGrad) graduated.add(l.cardId);
      if (l.date < from || l.date >= to) continue;
      const row = index.get(bucketStart(l.date, bucket, rolloverHour));
      if (!row) continue;
      row.reviews++;
      if (l.rating >= 2) row.correct++;
      else row.errors++;
      row.timeMs += l.responseTime || 0;
      if (l.stateBefore === 'new') row.newCards++;
      if (firstGrad) row.learned++;
    }
    for (const row of out) row.accuracy = row.reviews ? row.correct / row.reviews : null;
    return out;
  }

  function bucketFor(from, to) {
    const days = (to - from) / DAY;
    if (days <= 45) return 'day';
    if (days <= 400) return 'week';
    return 'month';
  }

  /** Total acumulado de cards formados até cada ponto da série. */
  function cumulativeLearned(logs, seriesRows) {
    const firstGrad = new Map();
    for (const l of logs) {
      if (l.stateAfter === 'review' && l.stateBefore !== 'review' && !firstGrad.has(l.cardId)) firstGrad.set(l.cardId, l.date);
    }
    const dates = [...firstGrad.values()].sort((a, b) => a - b);
    let i = 0;
    return seriesRows.map((row, idx) => {
      const end = idx + 1 < seriesRows.length ? seriesRows[idx + 1].start : Infinity;
      while (i < dates.length && dates[i] < end) i++;
      return i;
    });
  }

  /** Revisões previstas por dia de estudo (atrasadas somam no dia de hoje). */
  function forecast(cards, now, days = 30, rolloverHour = 4) {
    const start = dayStart(now, rolloverHour);
    const out = [];
    const index = new Map();
    for (let i = 0; i < days; i++) {
      const s = addDays(start, i);
      const row = { start: s, key: dayKey(s, rolloverHour), count: 0, overdue: 0 };
      out.push(row);
      index.set(row.key, row);
    }
    for (const c of cards) {
      if (c.suspended || !c.state || c.state === 'new' || c.dueDate == null) continue;
      if (c.dueDate < start) {
        out[0].count++;
        out[0].overdue++;
        continue;
      }
      const row = index.get(dayKey(c.dueDate, rolloverHour));
      if (row) row.count++;
    }
    return out;
  }

  /** Mapa dia → número de cards previstos (para o calendário; inclui dias passados = revisões feitas). */
  function calendarMonth(cards, logs, year, month, now, rolloverHour = 4) {
    const first = new Date(year, month, 1, rolloverHour).getTime();
    const last = new Date(year, month + 1, 1, rolloverHour).getTime();
    const today = dayStart(now, rolloverHour);
    const days = new Map();
    const row = (key) => {
      if (!days.has(key)) days.set(key, { due: 0, overdue: 0, done: 0, correct: 0 });
      return days.get(key);
    };
    for (const c of cards) {
      if (c.suspended || !c.state || c.state === 'new' || c.dueDate == null) continue;
      const due = c.dueDate < today ? today : c.dueDate;
      if (due < first || due >= last) continue;
      const r = row(dayKey(due, rolloverHour));
      r.due++;
      if (c.dueDate < today) r.overdue++;
    }
    for (const l of logs) {
      if (l.date < first || l.date >= last) continue;
      const r = row(dayKey(l.date, rolloverHour));
      r.done++;
      if (l.rating >= 2) r.correct++;
    }
    return days;
  }

  return { MATURE_DAYS, PERIODS, overview, periodStart, periodStats, streak, series, bucketFor, cumulativeLearned, forecast, calendarMonth };
});
