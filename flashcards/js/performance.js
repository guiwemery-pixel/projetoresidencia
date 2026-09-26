/*
 * Performance — "Como estou me saindo?"
 *
 * Tudo é calculado a partir do histórico real (logs de revisão). A IA não entra aqui.
 * Separado do scheduler (quando revisar) e da dificuldade estimada (difficulty.js).
 *
 * Acerto = qualquer resposta diferente de "Errei". Qualidade da resposta:
 *   Errei 0 · Difícil 0,5 · Quase 0,75 · Bom 1 · Fácil 1
 *
 * Ponto fraco (necessidade de revisão) de um nó da hierarquia combina:
 *   taxa de acerto suavizada (encolhida para a média geral quando há poucos dados,
 *   com peso maior para revisões recentes), erros recentes, frequência de
 *   esquecimento (lapsos), dificuldade FSRS média, quanto já foi esquecido
 *   (retrievability atual — reflete o tempo desde a última revisão), cards com
 *   erros consecutivos e tendência de piora.
 * Só entra na lista o nível mais específico com dados suficientes (mínimo de
 * revisões e de cards); sem dados suficientes no tema, sobe para o assunto, etc.
 */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const util = isNode ? require('./util.js') : root.FC.util;
  const scheduler = isNode ? require('./scheduler.js') : root.FC.scheduler;
  const mod = factory(util, scheduler, root);
  if (isNode) module.exports = mod;
  else (root.FC = root.FC || {}).performance = mod;
})(typeof self !== 'undefined' ? self : this, function (util, scheduler, root) {
  'use strict';

  const { DAY } = util;
  const QUALITY = { 1: 0, 2: 0.5, 3: 0.75, 4: 1, 5: 1 };
  const HALF_LIFE_DAYS = 30;
  const PRIOR_STRENGTH = 8;

  const DEFAULT_OPTS = {
    minReviews: 10,
    minCards: 3,
    recentDays: 14,
    includeQuick: false,
    weakAccuracy: 0.8,
  };

  // ── Contexto ───────────────────────────────────────────────────────────────
  /**
   * data: { cards: [], logs: [], nodes: [] | Map, quickSessions: [], now, opts }
   * Entradas de avaliação normalizadas: {cardId, date, correct, quality, source}
   */
  function buildContext(data) {
    const opts = Object.assign({}, DEFAULT_OPTS, data.opts || {});
    const now = data.now || Date.now();
    const nodes = data.nodes instanceof Map ? data.nodes : new Map((data.nodes || []).map((n) => [n.id, n]));
    const cards = data.cards || [];
    const cardById = new Map(cards.map((c) => [c.id, c]));
    const entries = [];
    for (const log of data.logs || []) {
      if (!cardById.has(log.cardId) || !QUALITY.hasOwnProperty(log.rating)) continue;
      entries.push({ cardId: log.cardId, date: log.date, correct: log.rating >= 2, quality: QUALITY[log.rating], rating: log.rating, source: 'review' });
    }
    if (opts.includeQuick) {
      for (const s of data.quickSessions || []) {
        for (const a of s.answers || []) {
          if (!cardById.has(a.cardId)) continue;
          entries.push({ cardId: a.cardId, date: s.startedAt, correct: a.first === 'sei', quality: a.first === 'sei' ? 1 : a.first === 'quase' ? 0.5 : 0, rating: a.first === 'sei' ? 4 : 1, source: 'quick' });
        }
      }
    }
    entries.sort((a, b) => a.date - b.date);
    const byCard = new Map();
    for (const e of entries) {
      if (!byCard.has(e.cardId)) byCard.set(e.cardId, []);
      byCard.get(e.cardId).push(e);
    }
    const pathCache = new Map();
    function pathIds(nodeId) {
      if (!nodeId) return [];
      if (pathCache.has(nodeId)) return pathCache.get(nodeId);
      const out = [];
      let n = nodes.get(nodeId);
      let guard = 0;
      while (n && guard++ < 10) {
        out.unshift(n.id);
        n = nodes.get(n.parentId);
      }
      pathCache.set(nodeId, out);
      return out;
    }
    const total = entries.length;
    const correct = entries.reduce((s, e) => s + (e.correct ? 1 : 0), 0);
    const prior = total >= 20 ? correct / total : 0.75;
    return { opts, now, nodes, cards, cardById, entries, byCard, pathIds, prior };
  }

  // ── Por card ───────────────────────────────────────────────────────────────
  function cardStats(card, entries, now, opts) {
    opts = Object.assign({}, DEFAULT_OPTS, opts || {});
    const list = entries || [];
    const recentFrom = now - opts.recentDays * DAY;
    let correct = 0;
    let recentN = 0;
    let recentErrors = 0;
    let quality = 0;
    for (const e of list) {
      if (e.correct) correct++;
      quality += e.quality;
      if (e.date >= recentFrom) {
        recentN++;
        if (!e.correct) recentErrors++;
      }
    }
    let consecutiveErrors = 0;
    for (let i = list.length - 1; i >= 0 && !list[i].correct; i--) consecutiveErrors++;
    const n = list.length;
    return {
      n,
      correct,
      errors: n - correct,
      accuracy: n ? correct / n : null,
      quality: n ? quality / n : null,
      recentN,
      recentErrors,
      consecutiveErrors,
      lastRating: n ? list[n - 1].rating : null,
      lastDate: n ? list[n - 1].date : null,
      lapses: card.lapses || 0,
      retrievability: scheduler.retrievability(card, now),
    };
  }

  /** Prioridade analítica (não mexe no agendamento): erros, erros recentes, estabilidade baixa, dificuldade alta. */
  function cardPriority(card, stats) {
    const s = stats;
    if (!s || !s.n) return 0;
    const errRate = s.errors / s.n;
    const recent = s.recentN ? s.recentErrors / s.recentN : 0;
    const stability = card.stability ? Math.min(1, 1 / Math.log2(2 + card.stability)) : 0.5;
    const diff = card.difficulty ? (card.difficulty - 1) / 9 : 0.5;
    const forgetting = s.retrievability != null ? 1 - s.retrievability : 0;
    return 0.3 * errRate + 0.25 * recent + 0.15 * Math.min(1, s.consecutiveErrors / 2) + 0.1 * stability + 0.1 * diff + 0.1 * forgetting;
  }

  // ── Tendência ──────────────────────────────────────────────────────────────
  /** Compara a primeira e a segunda metade das últimas revisões (até 60). */
  function trend(entries) {
    const list = entries.slice(-60);
    if (list.length < 16) return null;
    const half = Math.floor(list.length / 2);
    const a = list.slice(0, half);
    const b = list.slice(half);
    const p1 = a.filter((e) => e.correct).length / a.length;
    const p2 = b.filter((e) => e.correct).length / b.length;
    const pooled = (p1 * a.length + p2 * b.length) / list.length;
    const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.length + 1 / b.length));
    const z = se > 0 ? (p2 - p1) / se : 0;
    const significant = Math.abs(z) >= 1.96;
    const third = Math.floor(list.length / 3);
    const points = [list.slice(0, third), list.slice(third, 2 * third), list.slice(2 * third)].map((chunk) => chunk.filter((e) => e.correct).length / chunk.length);
    const diff = p2 - p1;
    let direction = 'stable';
    if (significant) direction = diff > 0 ? 'up' : 'down';
    else if (Math.abs(diff) >= 0.1 || Math.max(...points) - Math.min(...points) >= 0.15) direction = 'uncertain';
    return { before: p1, now: p2, diff, z, significant, direction, points, n: list.length, from: list[0].date, to: list[list.length - 1].date };
  }

  // ── Por nó da hierarquia ───────────────────────────────────────────────────
  function emptyAgg(nodeId, level) {
    return {
      nodeId,
      level,
      cards: 0,
      reviewedCards: 0,
      n: 0,
      correct: 0,
      quality: 0,
      wN: 0,
      wCorrect: 0,
      recentN: 0,
      recentCorrect: 0,
      recentErrors: 0,
      lapses: 0,
      reviewReps: 0,
      dSum: 0,
      dCount: 0,
      rSum: 0,
      rCount: 0,
      consecutiveCards: 0,
      lastDate: null,
      entries: [],
    };
  }

  /** Estatísticas de todos os nós (e da coleção inteira em "__all__"). */
  function nodeStats(ctx) {
    const { opts, now, prior } = ctx;
    const recentFrom = now - opts.recentDays * DAY;
    const aggs = new Map();
    const getAgg = (id, level) => {
      if (!aggs.has(id)) aggs.set(id, emptyAgg(id, level));
      return aggs.get(id);
    };
    for (const card of ctx.cards) {
      const path = ctx.pathIds(card.nodeId);
      const targets = [getAgg('__all__', -1)].concat(path.map((id, i) => getAgg(id, i)));
      const list = ctx.byCard.get(card.id) || [];
      const cs = list.length ? cardStats(card, list, now, opts) : null;
      for (const agg of targets) {
        agg.cards++;
        if (!cs) continue;
        agg.reviewedCards++;
        agg.lapses += card.lapses || 0;
        agg.reviewReps += Math.max(0, (card.repetitions || 0) - 1);
        if (card.difficulty != null && card.state !== 'new') {
          agg.dSum += card.difficulty;
          agg.dCount++;
        }
        if (cs.retrievability != null) {
          agg.rSum += cs.retrievability;
          agg.rCount++;
        }
        if (cs.consecutiveErrors >= 2) agg.consecutiveCards++;
        if (!agg.lastDate || cs.lastDate > agg.lastDate) agg.lastDate = cs.lastDate;
        for (const e of list) {
          const w = Math.pow(0.5, Math.max(0, now - e.date) / DAY / HALF_LIFE_DAYS);
          agg.n++;
          agg.quality += e.quality;
          agg.wN += w;
          if (e.correct) {
            agg.correct++;
            agg.wCorrect += w;
          }
          if (e.date >= recentFrom) {
            agg.recentN++;
            if (e.correct) agg.recentCorrect++;
            else agg.recentErrors++;
          }
          agg.entries.push(e);
        }
      }
    }
    for (const agg of aggs.values()) finalize(agg, ctx, prior);
    return aggs;
  }

  function finalize(agg, ctx, prior) {
    const { opts } = ctx;
    agg.entries.sort((a, b) => a.date - b.date);
    agg.errors = agg.n - agg.correct;
    agg.accuracy = agg.n ? agg.correct / agg.n : null;
    agg.meanQuality = agg.n ? agg.quality / agg.n : null;
    agg.smoothed = (agg.wCorrect + PRIOR_STRENGTH * prior) / (agg.wN + PRIOR_STRENGTH);
    agg.recentAccuracy = agg.recentN ? agg.recentCorrect / agg.recentN : null;
    agg.recentSmoothed = (agg.recentCorrect + 4 * prior) / (agg.recentN + 4);
    agg.lapseRate = agg.reviewReps ? Math.min(1, agg.lapses / agg.reviewReps) : 0;
    agg.meanD = agg.dCount ? agg.dSum / agg.dCount : null;
    agg.meanR = agg.rCount ? agg.rSum / agg.rCount : null;
    agg.trend = trend(agg.entries);
    agg.eligible = agg.n >= opts.minReviews && agg.reviewedCards >= Math.min(opts.minCards, agg.cards);
    const recentErrRate = agg.recentN >= 3 ? agg.recentErrors / agg.recentN : 1 - agg.smoothed;
    const worsening = agg.trend && agg.trend.direction === 'down' ? Math.min(1, -agg.trend.diff * 2) : 0;
    agg.need =
      0.4 * (1 - agg.smoothed) +
      0.15 * recentErrRate +
      0.1 * agg.lapseRate +
      0.1 * (agg.meanD != null ? (agg.meanD - 1) / 9 : 0.5) +
      0.1 * (agg.meanR != null ? 1 - agg.meanR : 0) +
      0.1 * (agg.reviewedCards ? agg.consecutiveCards / agg.reviewedCards : 0) +
      0.05 * worsening;
    agg.isWeak = agg.eligible && (agg.smoothed < opts.weakAccuracy || (agg.recentN >= 5 && recentErrRate >= 0.3) || agg.consecutiveCards >= 2);
    agg.recentErrRate = recentErrRate;
    // As entradas completas ficam só no nó (usadas em tendência/drill-down)
  }

  /** Nós elegíveis sem nenhum descendente elegível (o nível mais específico com dados). */
  function deepestEligible(ctx, aggs, predicate) {
    const pred = predicate || ((a) => a.eligible);
    const ok = [...aggs.values()].filter((a) => a.nodeId !== '__all__' && pred(a));
    const okIds = new Set(ok.map((a) => a.nodeId));
    const hasEligibleDescendant = new Set();
    for (const a of ok) {
      const node = ctx.nodes.get(a.nodeId);
      let parentId = node ? node.parentId : null;
      while (parentId) {
        if (okIds.has(parentId)) hasEligibleDescendant.add(parentId);
        const parent = ctx.nodes.get(parentId);
        parentId = parent ? parent.parentId : null;
      }
    }
    return ok.filter((a) => !hasEligibleDescendant.has(a.nodeId));
  }

  /**
   * Lista "Onde estou tendo mais dificuldade?".
   * Retorna { items, eligibleCount, enoughData }.
   */
  function weakPoints(ctx, aggs, limit = 10) {
    aggs = aggs || nodeStats(ctx);
    const candidates = deepestEligible(ctx, aggs);
    const items = candidates.filter((a) => a.isWeak).sort((a, b) => b.need - a.need).slice(0, limit);
    return { items, eligibleCount: candidates.length, enoughData: candidates.length > 0, aggs };
  }

  /** Indicadores: maior dificuldade atual, recente, maior evolução e maior piora. */
  function indicators(ctx, aggs) {
    aggs = aggs || nodeStats(ctx);
    const { opts, now } = ctx;
    const weak = weakPoints(ctx, aggs, 1);
    const minRecent = Math.max(5, Math.ceil(opts.minReviews / 2));
    const recentCands = deepestEligible(ctx, aggs, (a) => a.recentN >= minRecent && a.reviewedCards >= Math.min(2, a.cards));
    const recent = recentCands.filter((a) => a.recentSmoothed < opts.weakAccuracy).sort((a, b) => a.recentSmoothed - b.recentSmoothed)[0] || null;
    const trendCands = deepestEligible(ctx, aggs, (a) => a.trend && a.eligible);
    const active = (a) => a.lastDate && now - a.lastDate <= 30 * DAY;
    const improved = trendCands.filter((a) => a.trend.direction === 'up').sort((a, b) => b.trend.diff - a.trend.diff)[0] || null;
    const worsened = trendCands.filter((a) => a.trend.direction === 'down' && active(a)).sort((a, b) => a.trend.diff - b.trend.diff)[0] || null;
    return { current: weak.items[0] || null, recent, improved, worsened, enoughData: weak.enoughData };
  }

  /**
   * Maior dificuldade de uma sessão (normal ou Quick Review).
   * entries: [{cardId, nodeId, score 0..1}]; pathIds: nodeId → [ids da raiz até o nó]
   * Escolhe o nó mais específico com pelo menos minN respostas e pior desempenho.
   */
  function hardestInSession(entries, pathIds, minN = 3) {
    if (typeof pathIds === 'number') {
      minN = pathIds;
      pathIds = null;
    }
    if (!pathIds && root && root.FC && root.FC.areas) pathIds = (id) => root.FC.areas.path(id).map((n) => n.id);
    if (!pathIds) return null;
    const aggs = new Map();
    for (const e of entries) {
      const path = pathIds(e.nodeId);
      path.forEach((id, level) => {
        if (!aggs.has(id)) aggs.set(id, { nodeId: id, level, n: 0, score: 0, errors: 0, cards: new Set() });
        const a = aggs.get(id);
        a.n++;
        a.score += e.score;
        if (e.score < 1) a.errors++;
        a.cards.add(e.cardId);
      });
    }
    const eligible = [...aggs.values()].filter((a) => a.n >= minN && a.errors > 0);
    if (!eligible.length) return null;
    for (const a of eligible) a.accuracy = a.score / a.n;
    eligible.sort((a, b) => a.accuracy - b.accuracy || b.level - a.level || b.n - a.n);
    const best = eligible[0];
    return { nodeId: best.nodeId, level: best.level, n: best.n, errors: best.errors, accuracy: best.accuracy, cards: best.cards.size };
  }

  /** "O que eu preciso estudar novamente?" — texto baseado só nos dados. */
  function studyAgain(ctx, aggs, titleOf) {
    const weak = weakPoints(ctx, aggs, 5);
    if (!weak.enoughData) return { enoughData: false, items: [], main: null };
    const items = weak.items.map((a) => {
      const reasons = [];
      reasons.push(util.pct(a.accuracy) + ' de acerto em ' + a.n + ' revisões');
      if (a.recentErrors) reasons.push(a.recentErrors + (a.recentErrors === 1 ? ' erro' : ' erros') + ' nos últimos ' + ctx.opts.recentDays + ' dias');
      if (a.consecutiveCards) reasons.push(a.consecutiveCards + (a.consecutiveCards === 1 ? ' card errado' : ' cards errados') + ' duas ou mais vezes seguidas');
      if (a.trend && a.trend.direction === 'down') reasons.push('desempenho em queda (' + util.pct(a.trend.before) + ' → ' + util.pct(a.trend.now) + ')');
      if (a.meanR != null && a.meanR < 0.8) reasons.push('memória estimada em ' + util.pct(a.meanR));
      return { agg: a, title: titleOf ? titleOf(a.nodeId) : a.nodeId, reasons };
    });
    return { enoughData: true, items, main: items[0] || null };
  }

  /** Estatísticas de um card para a tela de detalhe. */
  function cardReport(card, logs, now, opts) {
    const entries = (logs || []).filter((l) => QUALITY.hasOwnProperty(l.rating)).map((l) => ({ cardId: l.cardId, date: l.date, correct: l.rating >= 2, quality: QUALITY[l.rating], rating: l.rating }));
    const stats = cardStats(card, entries, now, opts);
    stats.priority = cardPriority(card, stats);
    return stats;
  }

  return { QUALITY, DEFAULT_OPTS, buildContext, cardStats, cardPriority, cardReport, trend, nodeStats, deepestEligible, weakPoints, indicators, hardestInSession, studyAgain };
});
