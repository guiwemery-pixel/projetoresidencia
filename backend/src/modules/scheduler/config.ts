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
  /** Se definido, volta diretamente para esta etapa (ex.: 0 = D3, reforço) */
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
  /**
   * Intervalos-base (dias) de cada etapa: D10 → D21 → D60 → D90. A etapa 0 (D3)
   * é o reforço de quem ficou abaixo de 60% (ou caiu para "crítico").
   */
  ladder: number[];
  ladderLabels: string[];
  phases: string[];
  /** Após a última etapa, cada nova etapa multiplica o intervalo por este fator */
  maintenanceGrowth: number;
  /** Limites para o produto de todos os modificadores (evita saltos exagerados) */
  modifierBounds: { min: number; max: number };
  /**
   * Nas faixas de crescimento (≥ 70%) o intervalo parte de no mínimo o intervalo-base
   * da etapa (D10 ≥ 10 dias, D21 ≥ 21…); só a quantidade de questões (abaixo da
   * referência) pode trazê-lo para menos.
   */
  growthFloorAtBase: boolean;
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
  /**
   * 1ª revisão: a data sai do percentual de acertos do primeiro contato medido
   * (D0 com questões, ou a verificação com questões após um D0 só de leitura).
   * `stage` posiciona o assunto na escada para as revisões seguintes.
   */
  firstReview: {
    minQuestions: number;
    tiers: { min: number; days: number; stage: number }[];
    /** Sem questões suficientes nem autoavaliação: pontuação considerada (desempenho médio) */
    assumedScore: number;
    /** Com poucas questões e sem autoavaliação, a pontuação vai no máximo até aqui */
    fewQuestionsMaxScore: number;
  };
  ease: { initial: number; min: number; max: number };
  difficultyFactors: Record<string, number>;
  trend: { window: number; threshold: number; improvingFactor: number; decliningFactor: number };
  /**
   * Contato só de estudo/leitura (sem questões nem recuperação ativa) não mede
   * a retenção: agenda a revisão D1 no dia seguinte (questões, flashcards, recall
   * ou teoria) e mantém a etapa do assunto. A D1 nunca gera outra D1.
   */
  passiveFollowUp: { intervalDays: number; questionsMultiplier: number; methods: Method[]; label: string; phase: string };
  /**
   * Quantidade de questões do contato: `reference` vale ×1. Menos questões encurtam
   * o intervalo e mais questões o alongam, de forma gradual (interpolação linear
   * entre os pontos; fora deles vale o ponto da ponta). Aplica-se às faixas
   * ≥ 70% e à 1ª revisão (exceto a faixa mais baixa da tabela).
   */
  questionCount: { reference: number; points: { questions: number; factor: number }[] };
  /**
   * Tempo de estudo do contato quando não há questões (flashcards, recall, teoria):
   * `reference` minutos valem ×1; menos encurta e mais alonga, de forma gradual.
   */
  studyTime: { reference: number; points: { minutes: number; factor: number }[] };
  /** Se a revisão foi feita atrasada e o desempenho foi bom, o intervalo real conta a favor */
  lateCredit: { enabled: boolean; minGrowth: Partial<Record<BandKey, number>> };
  activeMethods: Method[];
  /** Recuperação ativa que vale mesmo sem números (sem questões registradas) */
  recallMethods: Method[];
  /** Estudo teórico: aula, vídeo, teoria, leitura, resumo… ("Questões" marcado sem quantidade não conta) */
  studyMethods: Method[];
  /**
   * Revisão feita só com estudo teórico (ex.: a D1 feita vendo aula): a autoavaliação
   * mede menos que questões, então o intervalo é multiplicado por `factor` e a etapa
   * não passa de `maxStage` (1 = D10) nem avança.
   */
  theoryReview: { factor: number; maxStage: number };
  suggestedMethodsByStage: Method[][];
  theoryMethods: Method[];
  /** Faixa de questões sugeridas para um assunto novo (D0), por tamanho */
  newSubjectQuestions: Record<SubjectSize, [number, number]>;
  /** Faixa de questões sugeridas por etapa de revisão (assunto médio; nunca abaixo da referência) */
  reviewQuestionsByStage: [number, number][];
  sizeMultipliers: Record<SubjectSize, number>;
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  version: 'adaptive-ladder-v2',
  ladder: [3, 10, 21, 60, 90],
  ladderLabels: ['D3', 'D10', 'D21', 'D60', 'D90'],
  phases: [
    'Reforço — rever os erros',
    'Consolidar',
    'Recuperação após intervalo maior',
    'Manutenção',
    'Manutenção de longo prazo',
  ],
  maintenanceGrowth: 1.5,
  modifierBounds: { min: 0.5, max: 1.6 },
  growthFloorAtBase: true,
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
  firstReview: {
    minQuestions: 5,
    tiers: [
      { min: 81, days: 23, stage: 2 },
      { min: 71, days: 20, stage: 2 },
      { min: 66, days: 13, stage: 1 },
      { min: 60, days: 10, stage: 1 },
      { min: 0, days: 3, stage: 0 },
    ],
    assumedScore: 70,
    fewQuestionsMaxScore: 80,
  },
  ease: { initial: 1.0, min: 0.6, max: 1.4 },
  difficultyFactors: { '1': 1.1, '2': 1.0, '3': 0.85 },
  trend: { window: 3, threshold: 10, improvingFactor: 1.1, decliningFactor: 0.85 },
  passiveFollowUp: {
    intervalDays: 1,
    questionsMultiplier: 1.5,
    methods: ['QUESTOES', 'FLASHCARDS', 'RECALL'],
    label: 'D1',
    phase: 'Revisar com questões, flashcards ou teoria',
  },
  studyTime: {
    reference: 30,
    points: [
      { minutes: 5, factor: 0.8 },
      { minutes: 15, factor: 0.9 },
      { minutes: 30, factor: 1.0 },
      { minutes: 60, factor: 1.1 },
      { minutes: 90, factor: 1.15 },
    ],
  },
  questionCount: {
    reference: 20,
    points: [
      { questions: 0, factor: 0.6 },
      { questions: 5, factor: 0.7 },
      { questions: 10, factor: 0.8 },
      { questions: 15, factor: 0.9 },
      { questions: 20, factor: 1.0 },
      { questions: 30, factor: 1.1 },
      { questions: 40, factor: 1.2 },
    ],
  },
  lateCredit: { enabled: true, minGrowth: { excelente: 1.5, bom: 1.2, medio: 1.0 } },
  activeMethods: ['QUESTOES', 'FLASHCARDS', 'RECALL', 'SIMULADO'],
  recallMethods: ['FLASHCARDS', 'RECALL'],
  studyMethods: ['TEORIA', 'AULA', 'VIDEO', 'LEITURA', 'RESUMO', 'REVISAO', 'OUTRO'],
  theoryReview: { factor: 0.4, maxStage: 1 },
  suggestedMethodsByStage: [
    ['QUESTOES', 'REVISAO'],
    ['QUESTOES', 'FLASHCARDS'],
    ['QUESTOES'],
    ['QUESTOES', 'FLASHCARDS'],
    ['QUESTOES', 'SIMULADO'],
  ],
  theoryMethods: ['TEORIA', 'QUESTOES'],
  newSubjectQuestions: { SMALL: [20, 25], MEDIUM: [20, 30], LARGE: [25, 35] },
  reviewQuestionsByStage: [
    [20, 25],
    [20, 30],
    [20, 30],
    [20, 30],
    [25, 40],
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
