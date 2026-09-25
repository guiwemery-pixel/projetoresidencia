// Tipos das respostas da API (espelham os serviços do backend).

export type StudyMethod =
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
export type Level = 'bom' | 'atencao' | 'melhorar' | 'critico' | 'sem-dados';

export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  timezone: string;
  domain: string;
  shareProgress: boolean;
  weeklyStudyHoursTarget: number;
  weeklyStudyDaysTarget: number;
  dailyQuestionsTarget: number;
  /** Organização da página inicial (ids dos balões por coluna) */
  dashboardLayout?: { main: string[]; side: string[]; hidden: string[] } | null;
  createdAt: string;
}

export interface AreaInfo {
  id: string;
  name: string;
  parentId: string | null;
  color: string | null;
  topId: string;
  topName: string;
  topColor: string | null;
  path: string;
}

export interface AreaNode {
  id: string;
  name: string;
  color: string | null;
  parentId: string | null;
  position: number;
  subjectCount: number;
  children?: AreaNode[];
}

export interface Subject {
  id: string;
  name: string;
  size: SubjectSize;
  notes: string | null;
  tags: string[];
  archived: boolean;
  areaId: string;
  area: AreaInfo | null;
  learning: {
    stage: number;
    ease: number;
    lastContactOn: string | null;
    lastScore: number | null;
    contacts: number;
    lapses: number;
  } | null;
  nextReview: { id: string; scheduledFor: string; stage: number } | null;
  questions: { total: number; correct: number; accuracy: number | null };
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
    quality: number | null;
    qualityLabel: string | null;
    difficulty: number | null;
    methods: StudyMethod[];
    activeRecall: boolean;
    previousScore: number | null;
    trend: 'melhora' | 'estavel' | 'queda' | 'sem-historico';
    lastContactOn: string | null;
    elapsedDays: number | null;
    previousIntervalDays: number | null;
    scheduledFor: string | null;
    timing: 'no-prazo' | 'antecipada' | 'atrasada' | null;
    reviewsDone: number;
    lapses: number;
    expectedQuestions?: number | null;
  };
  checkup?: boolean;
  score: number | null;
  band: { key: string; label: string; rule: string } | null;
  stage: { from: number | null; to: number; fromLabel: string; toLabel: string };
  baseIntervalDays: number;
  modifiers: { key: string; label: string; factor: number }[];
  newIntervalDays: number;
  dueOn: string;
  ease: { from: number; to: number };
  steps: ExplanationStep[];
}

export interface Review {
  id: string;
  subjectId: string;
  stage: number;
  stageLabel: string;
  phase: string;
  scheduledFor: string;
  originalScheduledOn: string | null;
  intervalDays: number;
  status: 'PENDING' | 'DONE' | 'SKIPPED';
  completedOn: string | null;
  elapsedDays: number | null;
  performance: number | null;
  quality: number | null;
  score: number | null;
  nextIntervalDays: number | null;
  suggestedMethods: StudyMethod[];
  suggestedQuestions: number | null;
  suggestTheory: boolean;
  /** Verificação com questões após um contato só de estudo/leitura */
  checkup: boolean;
  explanation: Explanation | null;
  subject: { id: string; name: string; size: SubjectSize; area: AreaInfo | null };
}

export interface QuestionData {
  total: number;
  correct: number;
  wrong: number;
  accuracy: number;
  board: string | null;
  examName: string | null;
  difficulty: number | null;
  timeSpentMinutes: number | null;
  notes: string | null;
}

export interface Study {
  id: string;
  date: string;
  durationMinutes: number;
  methods: StudyMethod[];
  quality: number | null;
  difficulty: number | null;
  notes: string | null;
  isFirstContact: boolean;
  createdAt: string;
  subject: { id: string; name: string; area: AreaInfo | null };
  questions: QuestionData | null;
}

export interface ScheduleView {
  reviewId: string | null;
  dueOn: string;
  intervalDays: number;
  stageLabel: string;
  phase: string;
  band: string | null;
  score: number | null;
  accuracy: number | null;
  suggestTheory: boolean;
  checkup: boolean;
  suggestedMethods: StudyMethod[];
  suggestedQuestions: { min: number; max: number };
  explanation: Explanation;
}

export interface StudyResult {
  session: Study;
  isFirstContact: boolean;
  completedReviewId: string | null;
  schedule: ScheduleView | null;
}

export interface StudySuggestion {
  isNew: boolean;
  checkup?: boolean;
  stageLabel: string;
  phase: string;
  methods: StudyMethod[];
  questions: { min: number; max: number };
  pendingReview: { id: string; scheduledFor: string } | null;
  /** Referência de questões (×1) e pontos do ajuste gradual do intervalo */
  questionCount?: { reference: number; points: { questions: number; factor: number }[] };
}

export type GoalMetric =
  | 'QUESTIONS'
  | 'CORRECT_ANSWERS'
  | 'STUDY_MINUTES'
  | 'STUDY_SESSIONS'
  | 'STUDY_DAYS'
  | 'REVIEWS_DONE'
  | 'MOCK_EXAMS'
  | 'CLEAR_OVERDUE'
  | 'CUSTOM';
export type GoalPeriod = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';

export interface Goal {
  id: string;
  title: string;
  description: string | null;
  metric: GoalMetric;
  metricLabel: string;
  period: GoalPeriod;
  target: number;
  manualProgress: number;
  areaId: string | null;
  subjectId: string | null;
  startDate: string;
  dueDate: string | null;
  status: 'ACTIVE' | 'COMPLETED' | 'EXPIRED' | 'ARCHIVED';
  completedAt: string | null;
  recurring: boolean;
  window: { from: string; to: string; key: string };
  progress: number;
  percent: number;
  remaining: number;
  reachedThisPeriod: boolean;
  daysLeft: number;
}

export interface Insight {
  id: string;
  kind: 'positive' | 'warning' | 'info';
  text: string;
  detail?: string;
  action?: { label: string; to?: string; anticipateReviewId?: string };
}

export interface ProgressComponent {
  key: 'estudos' | 'questoes' | 'revisoes' | 'metas' | 'simulados';
  label: string;
  weight: number;
  score: number | null;
  level: Level;
  statusLabel: string;
  explanation: string;
  details: Record<string, number | string | null>;
}

export interface Progress {
  today: string;
  index: number | null;
  level: Level;
  trend: 'up' | 'steady' | 'down';
  trendDetail: { minutes14: number; minutesPrev14: number; accuracy14: number | null; accuracyPrev14: number | null };
  goalsCompletionPercent: number | null;
  goals: { title: string; percent: number; pace: number }[];
  components: ProgressComponent[];
  formula: string;
}

export interface Dashboard {
  today: string;
  summary: { reviewsToday: number; overdue: number; plannedQuestions: number; questionsDoneToday: number; goalsToday: number };
  reviews: { today: Review[]; overdue: Review[] };
  goalsToday: Goal[];
  goals: Goal[];
  recentStudies: Study[];
  upcoming: {
    reviewsByDay: { date: string; reviews: number; subjects: string[] }[];
    mockExams: { id: string; name: string; date: string }[];
    goalsDue: Goal[];
  };
  week: {
    hours: number;
    targetHours: number;
    daysStudied: number;
    targetDays: number;
    questions: number;
    accuracy: number | null;
    reviewsDone: number;
    streak: number;
  };
  progress: Progress;
  insights: Insight[];
  comparisons: Insight[];
}

export interface Overview {
  period: { from: string; to: string; days: number };
  studies: {
    minutes: number;
    hours: number;
    sessions: number;
    daysStudied: number;
    avgMinutesPerStudyDay: number;
    avgMinutesPerDay: number;
    currentStreak: number;
    bestStreak: number;
    byMethod: Partial<Record<StudyMethod, number>>;
    subjectsStudied: number;
  };
  questions: {
    total: number;
    correct: number;
    wrong: number;
    accuracy: number | null;
    perDay: number;
    bySource: Record<'sessions' | 'mocks' | 'exams', { total: number; correct: number }>;
  };
  reviews: {
    pending: number;
    overdue: number;
    dueInPeriod: number;
    completedOfDue: number;
    onTime: number;
    late: number;
    completionRate: number | null;
    onTimeRate: number | null;
    done: number;
    avgPerformance: number | null;
  };
  mocks: { count: number; avgAccuracy: number | null };
}

export interface Bucket {
  start: string;
  minutes: number;
  hours: number;
  sessions: number;
  daysStudied: number;
  questions: number;
  correct: number;
  accuracy: number | null;
  reviewsDone: number;
}

export interface AreaMetric {
  id: string;
  name: string;
  color: string | null;
  questions: number;
  correct: number;
  accuracy: number | null;
  minutes: number;
  sessions: number;
  subjectsStudied: number;
  previousAccuracy: number | null;
  previousQuestions: number;
  deltaAccuracy: number | null;
  children?: AreaMetric[];
}

export interface SubjectMetric {
  id: string;
  name: string;
  area: AreaInfo | null;
  questions: number;
  correct: number;
  accuracy: number | null;
  minutes: number;
  sessions: number;
  lastStudiedOn: string | null;
  recentAccuracy: number[];
  trend: 'queda' | 'melhora' | 'estavel' | null;
  stage: number | null;
  nextReviewOn: string | null;
}

export interface MockExam {
  id: string;
  name: string;
  board: string | null;
  examName: string | null;
  year: number | null;
  takenOn: string;
  status: 'PLANNED' | 'DONE';
  totalQuestions: number | null;
  correct: number | null;
  wrong: number | null;
  accuracy: number | null;
  durationMinutes: number | null;
  notes: string | null;
  examId: string | null;
  areaResults: { areaId: string; areaName: string; color: string | null; total: number; correct: number; accuracy: number | null }[];
}

export interface MockExamList {
  items: MockExam[];
  evolution: { id: string; name: string; board: string | null; date: string; accuracy: number }[];
  series: { key: string; points: { id: string; label: string; date: string; accuracy: number }[] }[];
  stats: { done: number; planned: number; avgAccuracy: number | null; best: number | null; last: number | null };
}

export interface ExamAttempt {
  id: string;
  examId: string;
  takenOn: string;
  /** null quando só se sabe a nota (ex.: importada de planilha) */
  totalQuestions: number | null;
  correct: number | null;
  wrong: number | null;
  accuracy: number;
  durationMinutes: number | null;
  notes: string | null;
}

export interface Exam {
  id: string;
  boardId: string;
  name: string;
  year: number | null;
  totalQuestions: number | null;
  fileUrl: string | null;
  notes: string | null;
  bestAccuracy: number | null;
  lastAttempt: ExamAttempt | null;
  attempts: ExamAttempt[];
}

export interface Board {
  id: string;
  name: string;
  exams: Exam[];
}

export interface GroupListItem {
  id: string;
  name: string;
  description: string | null;
  role: 'OWNER' | 'MEMBER';
  favorite: boolean;
  memberCount: number;
  inviteCode: string;
  joinedAt: string;
}

export interface PublicIndicator {
  level: Level;
  label: string;
  percent?: number | null;
}

export interface GroupMember {
  userId: string;
  name: string;
  avatar: string | null;
  shared: boolean;
  progress?: number | null;
  level?: Level;
  trend?: 'up' | 'steady' | 'down';
  indicators?: Record<'estudos' | 'questoes' | 'revisoes' | 'metas' | 'simulados', PublicIndicator>;
  role: 'OWNER' | 'MEMBER';
  isMe: boolean;
}

export type RelLevel = 'muito-acima' | 'acima' | 'media' | 'abaixo' | 'muito-abaixo' | 'sem-registro';
export type CompareDim = 'questoes' | 'acertos' | 'tempo' | 'flashcards' | 'constancia' | 'revisoes' | 'assuntos';
export type MixKey = 'questoes' | 'teoria' | 'flashcards' | 'simulados';
export type PulseChange = { direction: 'up' | 'down' | 'steady' | 'new' | 'none'; percent: number | null };

/** Comparativos do grupo: só posições relativas, nunca números de ninguém. */
export interface GroupCompare {
  period: 7 | 30;
  memberCount: number;
  sharingCount: number;
  activeCount: number;
  members: {
    userId: string;
    name: string;
    avatar: string | null;
    isMe: boolean;
    shared: boolean;
    levels?: Record<CompareDim, RelLevel>;
    strengths?: CompareDim[];
    mix?: Record<MixKey, number> | null;
  }[];
  highlights: { key: CompareDim; names: string[] }[];
  me: { levels: Record<CompareDim, RelLevel>; comparedWith: number; sharing: boolean } | null;
  pulse: Record<'questoes' | 'tempo' | 'flashcards' | 'revisoes', PulseChange> & { acertos: { points: number } | null };
}

export interface GroupBoard {
  id: string;
  name: string;
  description: string | null;
  inviteCode: string;
  myRole: 'OWNER' | 'MEMBER';
  favorite: boolean;
  members: GroupMember[];
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface SearchResult {
  query: string;
  areas: { id: string; name: string; path: string; subjects: number }[];
  subjects: {
    id: string;
    name: string;
    area: AreaInfo | null;
    reviewsDone: number;
    simulados: number;
    questions: number;
    accuracy: number | null;
    nextReview: string | null;
    overdue: boolean;
  }[];
  mockExams: { id: string; name: string; board: string | null; takenOn: string; accuracy: number | null; status: string }[];
  exams: { id: string; name: string; board: string; year: number | null; attempts: number }[];
  goals: { id: string; title: string; status: string }[];
}

export interface CalendarDay {
  date: string;
  pending: Review[];
  done: Review[];
}

export interface CalendarData {
  month: string;
  today: string;
  days: CalendarDay[];
  totals: { pending: number; overdue: number; done: number };
}

export interface SubjectDetail extends Subject {
  timeline: {
    state: {
      stage: number;
      ease: number;
      intervalDays: number;
      lastContactOn: string;
      lastScore: number | null;
      contacts: number;
      lapses: number;
      algorithmVersion: string;
    } | null;
    contacts: {
      date: string;
      label: string;
      methods: StudyMethod[];
      questions: { total: number; correct: number } | null;
      accuracy: number | null;
      quality: number | null;
      difficulty: number | null;
      score: number | null;
    }[];
    /** Etapas da escada (ex.: D3 · D10 · D21 · D60 · D90 · D90+) */
    ladder: string[];
    reviews: Omit<Review, 'subject' | 'phase'>[];
  };
}
