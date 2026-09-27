/*
 * Resumo do dia para o resto do site (widget "Flashcards" do Início e contador no
 * menu). Calculado aqui, com as mesmas regras da fila de revisão (limites diários,
 * baralhos suspensos, aprendizagem), e guardado na conta a cada mudança.
 * Inclui a previsão dos próximos dias: o site descobre quantos cards vencem
 * "hoje" mesmo que o app não seja aberto há alguns dias (ver dueFromSummary no
 * frontend), porque os cards só mudam quando são revisados aqui.
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  const U = FC.util;

  const FORECAST_DAYS = 21;
  let timer = null;
  let lastSent = null;
  let unsubscribe = null;

  function compute(now = Date.now()) {
    const s = FC.settings.get();
    const c = FC.review.counts({}, now);
    const start = U.dayStart(now, s.rolloverHour);
    const forecast = FC.statistics.forecast(FC.cards.select({}), now, FORECAST_DAYS, s.rolloverHour).map((d) => d.count);
    let reviewed = 0;
    let correct = 0;
    let ms = 0;
    for (let i = FC.store.logs.length - 1; i >= 0; i--) {
      const log = FC.store.logs[i];
      if (log.date < start) break;
      if (log.source && log.source !== 'review') continue;
      reviewed++;
      if (log.rating > 1) correct++;
      ms += Math.min(log.responseTime || 0, 5 * 60000);
    }
    const streak = FC.statistics.streak(FC.store.logs, now, s.rolloverHour);
    return {
      v: 1,
      at: now,
      dayStart: start,
      rolloverHour: s.rolloverHour,
      due: c.dueToday + c.overdue,
      overdue: c.overdue,
      learning: c.learning,
      newToday: c.newToday,
      newAvailable: c.newAvailable,
      newPerDay: s.newPerDay,
      reviewsPerDay: s.reviewsPerDay,
      reviewsDone: c.reviewsDone,
      reviewed,
      correct,
      minutes: Math.round(ms / 60000),
      streak: streak.current,
      total: c.total,
      drafts: FC.store.drafts.length,
      forecast,
    };
  }

  async function send() {
    if (!FC.store.loaded) return;
    const summary = compute();
    // "at" muda sempre; só reenvia quando algo mais mudou
    const key = JSON.stringify(Object.assign({}, summary, { at: 0 }));
    if (FC.host && FC.host.onSummary) FC.host.onSummary(summary);
    if (key === lastSent) return;
    try {
      await FC.sync.request('PUT', '/summary', summary);
      lastSent = key;
    } catch (e) {
      /* sem conexão: vai na próxima mudança */
    }
  }

  function schedule(delay = 2000) {
    clearTimeout(timer);
    timer = setTimeout(send, delay);
  }

  function start() {
    if (unsubscribe) return;
    const offChange = FC.store.on('change', () => schedule());
    const offSettings = FC.store.on('settings', () => schedule(500));
    const offSync = FC.store.on('sync', (st) => st.status === 'ok' && !lastSent && schedule(500));
    // Virada do dia sem nenhuma revisão também muda o resumo
    const tick = setInterval(() => schedule(0), 10 * 60000);
    unsubscribe = () => {
      offChange();
      offSettings();
      offSync();
      clearInterval(tick);
      clearTimeout(timer);
    };
    schedule(300);
  }

  function stop() {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    lastSent = null;
  }

  FC.summary = { compute, send, schedule, start, stop };
})(typeof self !== 'undefined' ? self : globalThis);
