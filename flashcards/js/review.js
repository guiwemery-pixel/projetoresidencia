/*
 * Revisão normal (espaçada): monta a fila de cards devidos respeitando o
 * scheduler, os limites diários e as suspensões; grava cada resposta.
 * Sem DOM — a tela (ui/reviewView.js) só chama next()/answer()/undo().
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  const { uid, dayStart, DAY, MIN } = FC.util;
  const store = () => FC.store;

  const LEARN_AHEAD_MIN = 20; // sem mais nada, mostra cards em aprendizagem que vencem em até 20 min

  function todayCounts(now) {
    const s = FC.settings.get();
    const start = dayStart(now, s.rolloverHour);
    let newDone = 0;
    let reviewsDone = 0;
    for (let i = store().logs.length - 1; i >= 0; i--) {
      const log = store().logs[i];
      if (log.date < start) break;
      if (log.source && log.source !== 'review') continue;
      if (log.stateBefore === 'new') newDone++;
      else if (log.stateBefore === 'review') reviewsDone++;
    }
    return { newDone, reviewsDone, start };
  }

  /**
   * Cards novos que ficam fora dos novos do dia: baralho ou nó da hierarquia marcado
   * "Nunca entrar como card novo" (assuntos paralelos). Entram pelo "Estudar tudo".
   */
  function heldBack() {
    const decks = FC.decks.noNewIds();
    const nodes = FC.areas.noNewIds();
    if (!decks.size && !nodes.size) return () => false;
    return (c) => decks.has(c.deckId) || nodes.has(c.nodeId);
  }

  function newOrder(cards, now) {
    const s = FC.settings.get();
    if (s.newOrder === 'random') {
      const seed = FC.util.dayKey(now, s.rolloverHour);
      return cards.slice().sort((a, b) => FC.util.hashString(seed + a.id) - FC.util.hashString(seed + b.id));
    }
    return cards.slice().sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }

  /** Resumo do dia para o dashboard / tela de início. filter igual ao de FC.cards.select. */
  function counts(filter, now = Date.now()) {
    const s = FC.settings.get();
    const cards = FC.cards.select(filter || {});
    const { newDone, reviewsDone, start } = todayCounts(now);
    const tomorrow = FC.util.addDays(start, 1);
    const held = heldBack();
    let newAvailable = 0;
    let newHeld = 0;
    let learning = 0;
    let dueToday = 0;
    let overdue = 0;
    let dueNow = 0;
    for (const c of cards) {
      const state = c.state || 'new';
      if (state === 'new') {
        if (held(c)) newHeld++;
        else newAvailable++;
        continue;
      }
      if (c.dueDate == null) continue;
      if (state === 'learning' && c.dueDate < tomorrow) learning++;
      if (c.dueDate <= now) dueNow++;
      if (state === 'review' && c.dueDate < start) overdue++;
      else if (c.dueDate < tomorrow) dueToday++;
    }
    const newToday = Math.max(0, Math.min(newAvailable, s.newPerDay - newDone));
    const reviewBudget = Math.max(0, s.reviewsPerDay - reviewsDone);
    return { newAvailable, newHeld, newToday, newDone, reviewsDone, learning, dueToday, overdue, dueNow, reviewBudget, total: cards.length };
  }

  class Session {
    /**
     * opts.all: estudar tudo da seleção — novos sem limite diário e também os que ainda não venceram.
     * opts.noNew: só revisões — cards já estudados que venceram, sem novos.
     */
    constructor(filter, label, opts) {
      this.id = uid('s');
      this.filter = filter || {};
      this.label = label || 'Revisão';
      this.startedAt = Date.now();
      this.answers = []; // {cardId, rating, date, correct, logId}
      this.undoStack = [];
      this.seenNew = 0;
      this.seenReviews = 0;
      this.current = null;
      this.shownAt = null;
      const s = FC.settings.get();
      const today = todayCounts(this.startedAt);
      this.all = !!(opts && opts.all);
      this.noNew = !this.all && !!(opts && opts.noNew);
      this.newLimit = this.all ? Infinity : this.noNew ? 0 : Math.max(0, s.newPerDay - today.newDone);
      this.reviewLimit = this.all ? Infinity : Math.max(0, s.reviewsPerDay - today.reviewsDone);
      this.answered = new Set(); // no modo "tudo", cada card em revisão aparece uma vez
    }

    pool() {
      return FC.cards.select(this.filter);
    }

    /** Próximo card: {card, kind, early} | {waitUntil} | null (acabou). */
    next(now = Date.now()) {
      const cards = this.pool();
      const learning = [];
      const reviews = [];
      const fresh = [];
      const ahead = []; // modo "tudo": em revisão, mas ainda não venceram
      const held = this.all ? () => false : heldBack();
      for (const c of cards) {
        const state = c.state || 'new';
        if (state === 'new') {
          if (!held(c)) fresh.push(c);
        } else if (state === 'learning') learning.push(c);
        else if (c.dueDate != null && c.dueDate <= now) reviews.push(c);
        else if (this.all && !this.answered.has(c.id)) ahead.push(c);
      }
      ahead.sort((a, b) => (a.dueDate || 0) - (b.dueDate || 0));
      learning.sort((a, b) => a.dueDate - b.dueDate);
      const learnDue = learning.filter((c) => c.dueDate <= now);
      let pick = null;
      let kind = null;
      let early = false;
      if (learnDue.length) {
        pick = learnDue[0];
        kind = 'learning';
      } else if (reviews.length && this.seenReviews < this.reviewLimit) {
        reviews.sort((a, b) => a.dueDate - b.dueDate || (a.stability || 0) - (b.stability || 0));
        pick = reviews[0];
        kind = 'review';
      } else if (fresh.length && this.seenNew < this.newLimit) {
        pick = newOrder(fresh, now)[0];
        kind = 'new';
      } else if (ahead.length) {
        pick = ahead[0];
        kind = 'review';
        early = 'ahead';
      } else if (learning.length) {
        const soonest = learning[0];
        if (soonest.dueDate - now <= LEARN_AHEAD_MIN * MIN) {
          pick = soonest;
          kind = 'learning';
          early = true;
        } else {
          return { waitUntil: soonest.dueDate, remainingLearning: learning.length };
        }
      }
      if (!pick) return null;
      this.current = pick.id;
      this.shownAt = Date.now();
      return {
        card: pick,
        kind,
        early,
        remaining: {
          // Inclui o que volta daqui a pouco (ex.: "Errei" → 1 min), que ainda sai nesta sessão
          learning: learning.filter((c) => c.dueDate <= now + LEARN_AHEAD_MIN * MIN).length,
          review: Math.min(reviews.length, Math.max(0, this.reviewLimit - this.seenReviews)) + ahead.length,
          new: Math.min(fresh.length, Math.max(0, this.newLimit - this.seenNew)),
        },
      };
    }

    preview(cardId, now = Date.now()) {
      const card = FC.cards.get(cardId);
      return FC.scheduler.preview(card, now, FC.settings.schedulerOptions());
    }

    async answer(cardId, rating, responseTime) {
      const card = FC.cards.get(cardId);
      if (!card) throw new Error('Card não encontrado');
      const now = Date.now();
      const snapshot = FC.cards.schedulingSnapshot(card);
      const result = FC.scheduler.next(card, rating, now, FC.settings.schedulerOptions());
      const log = Object.assign({ id: uid('l'), cardId, sessionId: this.id, responseTime: Math.max(0, Math.min(responseTime || 0, 10 * MIN)), source: 'review' }, result.log);
      Object.assign(card, result.card, { updatedAt: now });
      await FC.db.batch([
        { store: 'cards', put: card },
        { store: 'logs', put: log },
      ]);
      store().addLogs([log]);
      if (log.stateBefore === 'new') this.seenNew++;
      else if (log.stateBefore === 'review') this.seenReviews++;
      this.answered.add(cardId);
      const correct = rating >= 2;
      this.answers.push({ cardId, rating, date: now, correct, logId: log.id, responseTime: log.responseTime, nodeId: card.nodeId });
      this.undoStack.push({ cardId, snapshot, logId: log.id, stateBefore: log.stateBefore });
      store().emit('review', { cardId, rating });
      return { card, log };
    }

    canUndo() {
      return this.undoStack.length > 0;
    }

    async undo() {
      const last = this.undoStack.pop();
      if (!last) return null;
      const card = FC.cards.get(last.cardId);
      if (card) Object.assign(card, last.snapshot, { updatedAt: Date.now() });
      await FC.db.batch([card ? { store: 'cards', put: card } : null, { store: 'logs', del: last.logId }].filter(Boolean));
      store().removeLogs([last.logId]);
      this.answers = this.answers.filter((a) => a.logId !== last.logId);
      if (!this.answers.some((a) => a.cardId === last.cardId)) this.answered.delete(last.cardId);
      if (last.stateBefore === 'new') this.seenNew = Math.max(0, this.seenNew - 1);
      else if (last.stateBefore === 'review') this.seenReviews = Math.max(0, this.seenReviews - 1);
      store().emit('review', { cardId: last.cardId, undo: true });
      return card;
    }

    summary() {
      const reviewed = this.answers.length;
      const correct = this.answers.filter((a) => a.correct).length;
      const errors = reviewed - correct;
      const durationMs = this.answers.reduce((s, a) => s + (a.responseTime || 0), 0) || Date.now() - this.startedAt;
      const hardest = FC.performance.hardestInSession(
        this.answers.map((a) => ({ cardId: a.cardId, score: a.correct ? 1 : 0, nodeId: FC.cards.get(a.cardId) ? FC.cards.get(a.cardId).nodeId : a.nodeId })),
      );
      const errorIds = [...new Set(this.answers.filter((a) => !a.correct).map((a) => a.cardId))];
      return { reviewed, uniqueCards: new Set(this.answers.map((a) => a.cardId)).size, correct, errors, accuracy: reviewed ? correct / reviewed : null, durationMs, hardest, errorIds };
    }

    async finish() {
      if (!this.answers.length) return null;
      if (this.record && this.record.reviewed === this.answers.length) return this.record;
      const sum = this.summary();
      const record = {
        id: this.id,
        startedAt: this.startedAt,
        endedAt: Date.now(),
        label: this.label,
        reviewed: sum.reviewed,
        correct: sum.correct,
        errors: sum.errors,
        durationMs: sum.durationMs,
        hardestNodeId: sum.hardest ? sum.hardest.nodeId : null,
      };
      const idx = store().sessions.findIndex((s) => s.id === record.id);
      if (idx >= 0) store().sessions[idx] = record;
      else store().sessions.push(record);
      this.record = record;
      await FC.db.put('sessions', record);
      return record;
    }
  }

  FC.review = { counts, todayCounts, heldBack, Session, createSession: (filter, label, opts) => new Session(filter, label, opts) };
})(typeof self !== 'undefined' ? self : globalThis);
