/*
 * Difficulty — "Qual é a dificuldade estimada deste conteúdo/card?"
 *
 * Diferente do desempenho do usuário (performance.js): um card pode ser
 * objetivamente difícil e o usuário dominá-lo, ou fácil e ser errado com frequência.
 *
 * Estimativa (escala 1–10):
 *   parte da dificuldade atribuída (IA ou manual: Fácil 3,5 · Média 5,5 · Difícil 7,5)
 *   e é ajustada pela dificuldade do FSRS (que reflete as respostas, erros e
 *   esquecimentos) conforme o histórico cresce: peso 3 para a atribuída e
 *   1 por revisão (até 20) para o FSRS.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.FC = root.FC || {}).difficulty = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LABELS = { facil: 'Fácil', media: 'Média', dificil: 'Difícil' };
  const PRIOR = { facil: 3.5, media: 5.5, dificil: 7.5 };
  const PRIOR_WEIGHT = 3;

  function labelFor(value) {
    if (value == null) return null;
    if (value < 4.5) return 'facil';
    if (value < 6.5) return 'media';
    return 'dificil';
  }

  /** card: {estDifficulty, estDifficultyBy, difficulty (FSRS), repetitions, state} */
  function estimate(card) {
    const assigned = card.estDifficulty && PRIOR[card.estDifficulty] ? card.estDifficulty : null;
    const reviews = card.state && card.state !== 'new' ? Math.min(20, card.repetitions || 0) : 0;
    const hasFsrs = reviews > 0 && card.difficulty != null;
    if (!assigned && !hasFsrs) return { value: null, label: null, labelText: 'Sem estimativa', basis: 'sem-dados' };
    const prior = assigned ? PRIOR[assigned] : 5.5;
    const priorWeight = assigned ? PRIOR_WEIGHT : 0.5;
    const value = hasFsrs ? (prior * priorWeight + card.difficulty * reviews) / (priorWeight + reviews) : prior;
    const label = labelFor(value);
    let basis = assigned ? (card.estDifficultyBy === 'ia' ? 'ia' : 'atribuida') : 'historico';
    if (assigned && hasFsrs) basis = 'misto';
    return { value, label, labelText: LABELS[label], basis, assigned, reviews };
  }

  const BASIS_TEXT = {
    ia: 'estimada pela IA',
    atribuida: 'atribuída manualmente',
    historico: 'calculada pelas respostas',
    misto: 'atribuída e ajustada pelas respostas',
    'sem-dados': 'sem dados',
  };

  return { LABELS, PRIOR, labelFor, estimate, BASIS_TEXT };
});
