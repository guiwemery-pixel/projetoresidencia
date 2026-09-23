import type { BandKey, Method, SubjectSize } from './types.js';

// Parâmetros do algoritmo. Os valores abaixo são o padrão; qualquer um deles pode
// ser sobrescrito pela tabela `algorithm_configs` (chave "spaced-repetition"),
// sem recompilar a aplicação. Ver docs/ALGORITMO-REVISAO.md.

export interface BandRule {
  key: BandKey;
  /** Pontuação mínima (0–100) para cair nesta faixa */
  min: number;
  label: string;
  rule: string;
  /** Quanto a etapa anda na escada: +1 avança, 0 mantém, -1 volta uma etapa */
  stageDelta: number;
  /** Se definido, volta diretamente para esta etapa (ex.: 0 = D1) */
  resetToStage?: number;
  /** Multiplicador sobre o intervalo-base da nova etapa */
  factor: number;
  /** Ajuste no fator de facilidade individual do assunto */
  easeDelta: number;
  /** Faixas de crescimento recebem modificadores (facilidade, tendência, dificuldade) */
  growth: boolean;
  suggestTheory?: boolean;
}

export interface SchedulerConfig {
  version: string;
  /** Intervalos-base (dias) de cada etapa: D1 → D7 → D21 → D60 → D90 */
  ladder: number[];
  ladderLabels: string[];
  phases: string[];
  /** Após a última etapa, cada nova etapa multiplica o intervalo por este fator */
  maintenanceGrowth: number;
  /** Limites para o produto de todos os modificadores (evita saltos exagerados) */
  modifierBounds: { min: number; max: number };
  minIntervalDays: number;
  maxIntervalDays: number;
  score: {
    accuracyWeight: number;
    qualityWeight: number;
    /** Abaixo desta quantidade de questões o percentual pesa proporcionalmente menos */
    minQuestionsForFullWeight: number;
    /** Com menos questões que isso (e sem autoavaliação) a faixa máxima é "bom" */
    minQuestionsForExcellent: number;
    qualityScores: Record<string, number>;
    qualityLabels: Record<string, string>;
  };
  bands: BandRule[];
  firstContact: {
    /** No D0, pontuação mínima (com recuperação ativa) para pular o D1 e ir direto ao D7 */
    skipFirstReviewMinScore: number;
    minQuestionsToSkip: number;
  };
  ease: { initial: number; min: number; max: number };
  difficultyFactors: Record<string, number>;
  trend: { window: number; threshold: number; improvingFactor: number; decliningFactor: number };
  /** Contato só com métodos passivos (leitura, vídeo…) mede menos a retenção */
  passive: { factor: number; maxBand: BandKey };
  /** Se a revisão foi feita atrasada e o desempenho foi bom, o intervalo real conta a favor */
  lateCredit: { enabled: boolean; minGrowth: Partial<Record<BandKey, number>> };
  activeMethods: Method[];
  suggestedMethodsByStage: Method[][];
  theoryMethods: Method[];
  /** Faixa de questões sugeridas para um assunto novo (D0), por tamanho */
  newSubjectQuestions: Record<SubjectSize, [number, number]>;
  /** Faixa de questões sugeridas por etapa de revisão (assunto médio) */
  reviewQuestionsByStage: [number, number][];
  sizeMultipliers: Record<SubjectSize, number>;
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  version: 'adaptive-ladder-v1',
  ladder: [1, 7, 21, 60, 90],
  ladderLabels: ['D1', 'D7', 'D21', 'D60', 'D90'],
  phases: [
    'Evitar esquecimento precoce',
    'Consolidar',
    'Recuperação após intervalo maior',
    'Manutenção',
    'Manutenção de longo prazo',
  ],
  maintenanceGrowth: 1.5,
  modifierBounds: { min: 0.5, max: 1.6 },
  minIntervalDays: 1,
  maxIntervalDays: 180,
  score: {
    accuracyWeight: 0.7,
    qualityWeight: 0.3,
    minQuestionsForFullWeight: 10,
    minQuestionsForExcellent: 5,
    qualityScores: { '1': 20, '2': 50, '3': 70, '4': 85, '5': 100 },
    qualityLabels: {
      '1': 'Esqueci praticamente tudo',
      '2': 'Tive dificuldade',
      '3': 'Razoável',
      '4': 'Fui bem',
      '5': 'Dominei',
    },
  },
  bands: [
    {
      key: 'excelente',
      min: 90,
      label: 'Excelente',
      rule: '≥ 90%: aumentar o intervalo de forma significativa',
      stageDelta: 1,
      factor: 1.2,
      easeDelta: 0.05,
      growth: true,
    },
    {
      key: 'bom',
      min: 80,
      label: 'Bom',
      rule: '80–89%: aumentar o intervalo moderadamente',
      stageDelta: 1,
      factor: 1.0,
      easeDelta: 0.02,
      growth: true,
    },
    {
      key: 'medio',
      min: 70,
      label: 'Mediano',
      rule: '70–79%: manter a etapa e aumentar pouco o intervalo',
      stageDelta: 0,
      factor: 1.2,
      easeDelta: -0.05,
      growth: true,
    },
    {
      key: 'fraco',
      min: 50,
      label: 'Fraco',
      rule: '50–69%: reduzir o intervalo (voltar uma etapa)',
      stageDelta: -1,
      factor: 1.0,
      easeDelta: -0.15,
      growth: false,
    },
    {
      key: 'critico',
      min: 0,
      label: 'Crítico',
      rule: '< 50%: revisão precoce e retorno ao conteúdo teórico',
      stageDelta: 0,
      resetToStage: 0,
      factor: 1.0,
      easeDelta: -0.2,
      growth: false,
      suggestTheory: true,
    },
  ],
  firstContact: { skipFirstReviewMinScore: 80, minQuestionsToSkip: 5 },
  ease: { initial: 1.0, min: 0.6, max: 1.4 },
  difficultyFactors: { '1': 1.1, '2': 1.0, '3': 0.85 },
  trend: { window: 3, threshold: 10, improvingFactor: 1.1, decliningFactor: 0.85 },
  passive: { factor: 0.9, maxBand: 'bom' },
  lateCredit: { enabled: true, minGrowth: { excelente: 1.5, bom: 1.2, medio: 1.0 } },
  activeMethods: ['QUESTOES', 'FLASHCARDS', 'RECALL', 'SIMULADO'],
  suggestedMethodsByStage: [
    ['FLASHCARDS', 'RECALL', 'QUESTOES'],
    ['QUESTOES', 'FLASHCARDS', 'RECALL'],
    ['QUESTOES'],
    ['QUESTOES', 'FLASHCARDS'],
    ['QUESTOES', 'SIMULADO', 'RECALL'],
  ],
  theoryMethods: ['TEORIA', 'QUESTOES'],
  newSubjectQuestions: { SMALL: [10, 15], MEDIUM: [15, 25], LARGE: [20, 30] },
  reviewQuestionsByStage: [
    [5, 10],
    [10, 20],
    [15, 25],
    [15, 25],
    [20, 30],
  ],
  sizeMultipliers: { SMALL: 0.75, MEDIUM: 1, LARGE: 1.25 },
};

type DeepPartial<T> = T extends unknown[] ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Aplica sobrescritas parciais (ex.: vindas do banco) sobre a configuração padrão. */
export function mergeConfig(
  base: SchedulerConfig,
  override: DeepPartial<SchedulerConfig> | null | undefined,
): SchedulerConfig {
  if (!override) return base;
  const merge = (a: unknown, b: unknown): unknown => {
    if (b === undefined) return a;
    if (isPlainObject(a) && isPlainObject(b)) {
      const out: Record<string, unknown> = { ...a };
      for (const [k, v] of Object.entries(b)) out[k] = merge(a[k], v);
      return out;
    }
    return b;
  };
  const merged = merge(base, override) as SchedulerConfig;
  merged.bands = [...merged.bands].sort((x, y) => y.min - x.min);
  return merged;
}
