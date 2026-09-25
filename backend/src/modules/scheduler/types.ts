// Tipos públicos do motor de revisão espaçada.
// O motor é puro: recebe o estado de aprendizagem de um assunto + a evidência do
// contato atual e devolve o próximo estado, o intervalo e uma explicação completa.

export type Method =
  | 'TEORIA'
  | 'QUESTOES'
  | 'FLASHCARDS'
  | 'RECALL'
  | 'REVISAO'
  | 'AULA'
  | 'VIDEO'
  | 'LEITURA'
  | 'RESUMO'
  | 'SIMULADO'
  | 'OUTRO';

export type SubjectSize = 'SMALL' | 'MEDIUM' | 'LARGE';

/** 1 = Esqueci praticamente tudo · 2 = Tive dificuldade · 3 = Razoável · 4 = Fui bem · 5 = Dominei */
export type Quality = 1 | 2 | 3 | 4 | 5;

/** 1 = fácil · 2 = médio · 3 = difícil */
export type Difficulty = 1 | 2 | 3;

export type BandKey = 'excelente' | 'bom' | 'medio' | 'fraco' | 'critico';

export type Trend = 'melhora' | 'estavel' | 'queda' | 'sem-historico';

export type Timing = 'no-prazo' | 'antecipada' | 'atrasada';

/** Evidência de um dia de estudo sobre o assunto (sessões do mesmo dia são agregadas). */
export interface ContactEvidence {
  date: string;
  methods: Method[];
  questions: { total: number; correct: number } | null;
  quality: Quality | null;
  difficulty: Difficulty | null;
}

export interface LearningSnapshot {
  stage: number;
  ease: number;
  intervalDays: number;
  lastContactOn: string;
  lastScore: number | null;
  contacts: number;
  lapses: number;
}

export interface HistoryPoint {
  date: string;
  score: number | null;
  accuracy: number | null;
}

export interface ScheduleInput {
  /** null = primeiro contato com o assunto (D0) */
  state: LearningSnapshot | null;
  contact: ContactEvidence;
  /** Contatos anteriores com pontuação (do mais antigo para o mais recente), sem o atual */
  history: HistoryPoint[];
  /** Data para a qual a revisão concluída por este contato estava prevista */
  scheduledFor?: string | null;
  subjectSize?: SubjectSize;
}

export interface Modifier {
  key: string;
  label: string;
  factor: number;
}

export interface ExplanationStep {
  label: string;
  detail: string;
}

export interface Explanation {
  algorithm: string;
  summary: string;
  inputs: {
    accuracy: number | null;
    questions: { total: number; correct: number } | null;
    quality: Quality | null;
    qualityLabel: string | null;
    difficulty: Difficulty | null;
    methods: Method[];
    activeRecall: boolean;
    previousScore: number | null;
    trend: Trend;
    lastContactOn: string | null;
    elapsedDays: number | null;
    previousIntervalDays: number | null;
    scheduledFor: string | null;
    timing: Timing | null;
    reviewsDone: number;
    lapses: number;
    /** Quantidade de questões de referência (vale ×1 no intervalo) */
    expectedQuestions: number | null;
  };
  /** Revisão de verificação (após contato só de estudo/leitura) */
  checkup: boolean;
  score: number | null;
  band: { key: BandKey; label: string; rule: string } | null;
  stage: { from: number | null; to: number; fromLabel: string; toLabel: string };
  baseIntervalDays: number;
  modifiers: Modifier[];
  newIntervalDays: number;
  dueOn: string;
  ease: { from: number; to: number };
  steps: ExplanationStep[];
}

export interface ScheduleResult {
  nextState: LearningSnapshot;
  intervalDays: number;
  dueOn: string;
  stageLabel: string;
  phase: string;
  band: BandKey | null;
  score: number | null;
  accuracy: number | null;
  isLapse: boolean;
  /** Próxima revisão é uma verificação com questões (contato foi só estudo/leitura) */
  checkup: boolean;
  suggestTheory: boolean;
  suggestedMethods: Method[];
  suggestedQuestions: { min: number; max: number };
  explanation: Explanation;
}
