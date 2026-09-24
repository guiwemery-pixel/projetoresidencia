// API pública do módulo de revisão espaçada. O restante da aplicação só deve
// importar a partir daqui — assim o algoritmo pode ser trocado/evoluído
// (ex.: FSRS) sem mexer em rotas, banco ou frontend.
export * from './types.js';
export { DEFAULT_SCHEDULER_CONFIG, mergeConfig, type SchedulerConfig, type BandRule } from './config.js';
export {
  scheduleNext,
  computeScore,
  computeTrend,
  stageInterval,
  stageLabel,
  stagePhase,
  suggestedMethods,
  suggestedQuestions,
  reviewPlan,
  firstReviewTableText,
  isPassiveOnly,
  measuredScore,
  isActiveRecall,
  accuracyOf,
} from './engine.js';
export { addDays, diffDays } from './dates.js';
