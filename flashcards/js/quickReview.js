/*
 * Quick Review — revisão rápida de TODOS os cards selecionados.
 *
 * Não toca no scheduler: não muda dueDate, intervalo, estabilidade, dificuldade,
 * estado nem o histórico principal. Guarda só o resumo da sessão (quickSessions).
 *
 * Reapresentação dinâmica dentro da sessão:
 *   Não sei → volta em breve (depois de 2 cards)
 *   Quase   → volta mais adiante (depois de 6 cards)
 *   Sei     → sai da sessão se acertou de primeira; se já tinha errado, o espaçamento
 *             dobra a cada "Sei" (10, 20...) e sai depois de dois "Sei" seguidos.
 */
(function (root, factory) {
  const util = typeof module === 'object' && module.exports ? require('./util.js') : root.FC.util;
  const mod = factory(util);
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.FC = root.FC || {}).quickReview = mod;
})(typeof self !== 'undefined' ? self : this, function (util) {
  'use strict';

  const ANSWERS = [
    { key: 'naosei', label: 'Não sei', score: 0 },
    { key: 'quase', label: 'Quase', score: 0.5 },
    { key: 'sei', label: 'Sei', score: 1 },
  ];
  const SCORE = { naosei: 0, quase: 0.5, sei: 1 };
  const GAP = { naosei: 2, quase: 6, sei: 10 };

  class QuickSession {
    /**
     * cardIds: ids na ordem desejada (a interface embaralha/ordena antes)
     * meta: { label, filter }
     */
    constructor(cardIds, meta) {
      this.id = util.uid('q');
      this.meta = meta || {};
      this.startedAt = Date.now();
      this.queue = cardIds.slice();
      this.initialOrder = cardIds.slice();
      this.total = cardIds.length;
      this.records = new Map(); // cardId → {first, presentations, streak, gap, done, last}
      this.history = []; // {cardId, answer, date}
      this.finished = this.queue.length === 0;
    }

    current() {
      return this.queue.length ? this.queue[0] : null;
    }

    answer(key, now = Date.now()) {
      if (!SCORE.hasOwnProperty(key)) throw new Error('Resposta inválida: ' + key);
      const id = this.queue.shift();
      if (id == null) return null;
      const rec = this.records.get(id) || { first: null, presentations: 0, streak: 0, gap: 0, done: false, last: null, missed: false };
      rec.presentations++;
      rec.last = key;
      if (rec.first == null) rec.first = key;
      this.history.push({ cardId: id, answer: key, date: now });
      let insertAt = null;
      if (key === 'naosei' || key === 'quase') {
        rec.streak = 0;
        rec.missed = true;
        rec.gap = GAP[key];
        insertAt = GAP[key];
      } else {
        rec.streak++;
        if (!rec.missed || rec.streak >= 2) rec.done = true;
        else {
          rec.gap = Math.max(GAP.sei, rec.gap * 2);
          insertAt = rec.gap;
        }
      }
      if (insertAt != null) this.queue.splice(Math.min(insertAt, this.queue.length), 0, id);
      this.records.set(id, rec);
      if (!this.queue.length) this.finished = true;
      return rec;
    }

    /**
     * Desfaz a última resposta (só dentro da sessão). A reapresentação é
     * determinística, então basta reaplicar o histórico a partir da ordem inicial.
     */
    undo() {
      const last = this.history[this.history.length - 1];
      if (!last) return null;
      const replay = this.history.slice(0, -1);
      this.queue = this.initialOrder.slice();
      this.records = new Map();
      this.history = [];
      this.finished = this.queue.length === 0;
      for (const h of replay) this.answer(h.answer, h.date);
      return last;
    }

    remaining() {
      return this.queue.length;
    }

    /** Cards distintos já vistos. */
    seenCount() {
      return this.records.size;
    }

    /**
     * Relatório. Conta a PRIMEIRA resposta de cada card:
     * Cards revisados = Sei + Quase + Não sei; Aproveitamento = Sei / revisados.
     */
    report() {
      const counts = { sei: 0, quase: 0, naosei: 0 };
      const firstAnswers = [];
      let presentations = 0;
      for (const [cardId, rec] of this.records) {
        counts[rec.first]++;
        presentations += rec.presentations;
        firstAnswers.push({ cardId, first: rec.first, score: SCORE[rec.first], presentations: rec.presentations, done: rec.done });
      }
      const reviewed = firstAnswers.length;
      return {
        reviewed,
        total: this.total,
        counts,
        presentations,
        accuracy: reviewed ? counts.sei / reviewed : null,
        durationMs: (this.history.length ? this.history[this.history.length - 1].date : Date.now()) - this.startedAt,
        firstAnswers,
        missedIds: firstAnswers.filter((a) => a.first !== 'sei').map((a) => a.cardId),
      };
    }
  }

  const create = (cardIds, meta) => new QuickSession(cardIds, meta);

  return { ANSWERS, SCORE, GAP, QuickSession, create };
});
