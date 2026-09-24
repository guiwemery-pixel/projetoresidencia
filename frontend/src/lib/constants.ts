import type { GoalMetric, GoalPeriod, Level, StudyMethod, SubjectSize } from '../api/types';

export const METHODS: { value: StudyMethod; label: string; emoji: string }[] = [
  { value: 'TEORIA', label: 'Teoria', emoji: '📖' },
  { value: 'QUESTOES', label: 'Questões', emoji: '📝' },
  { value: 'FLASHCARDS', label: 'Flashcards', emoji: '🗂️' },
  { value: 'RECALL', label: 'Recall ativo', emoji: '🧠' },
  { value: 'REVISAO', label: 'Revisão', emoji: '🔄' },
  { value: 'AULA', label: 'Aula', emoji: '🎓' },
  { value: 'VIDEO', label: 'Vídeo', emoji: '🎬' },
  { value: 'LEITURA', label: 'Leitura', emoji: '📚' },
  { value: 'RESUMO', label: 'Resumo', emoji: '✍️' },
  { value: 'SIMULADO', label: 'Simulado', emoji: '🏁' },
  { value: 'OUTRO', label: 'Outro', emoji: '✨' },
];

export const METHOD_LABEL = Object.fromEntries(METHODS.map((m) => [m.value, m.label])) as Record<StudyMethod, string>;

export const QUALITY: { value: number; emoji: string; label: string }[] = [
  { value: 5, emoji: '😄', label: 'Dominei' },
  { value: 4, emoji: '🙂', label: 'Fui bem' },
  { value: 3, emoji: '😐', label: 'Razoável' },
  { value: 2, emoji: '😕', label: 'Tive dificuldade' },
  { value: 1, emoji: '😣', label: 'Esqueci praticamente tudo' },
];

export const DIFFICULTY = [
  { value: 1, label: 'Fácil' },
  { value: 2, label: 'Média' },
  { value: 3, label: 'Difícil' },
];

export const SIZES: { value: SubjectSize; label: string; hint: string }[] = [
  { value: 'SMALL', label: 'Pequeno', hint: '10–15 questões' },
  { value: 'MEDIUM', label: 'Médio', hint: '15–25 questões' },
  { value: 'LARGE', label: 'Grande', hint: '20–30 questões' },
];

/** Estados → cor + ícone + rótulo (status nunca vai só na cor). */
export const LEVELS: Record<Level, { label: string; icon: string; color: string; wash: string }> = {
  bom: { label: 'Bom', icon: '●', color: 'var(--good)', wash: 'var(--good-wash)' },
  atencao: { label: 'Atenção', icon: '▲', color: 'var(--warn)', wash: 'var(--warn-wash)' },
  melhorar: { label: 'Precisa melhorar', icon: '◆', color: 'var(--serious)', wash: 'var(--serious-wash)' },
  critico: { label: 'Crítico', icon: '■', color: 'var(--crit)', wash: 'var(--crit-wash)' },
  'sem-dados': { label: 'Sem dados', icon: '○', color: 'var(--muted)', wash: 'var(--subtle)' },
};

/** Indicadores públicos exibidos para o grupo (sempre com emoji + status). */
export const GROUP_INDICATORS = [
  { key: 'estudos', label: 'Estudos', emoji: '📚' },
  { key: 'questoes', label: 'Questões', emoji: '📝' },
  { key: 'revisoes', label: 'Revisões', emoji: '🔄' },
  { key: 'metas', label: 'Metas', emoji: '🎯' },
  { key: 'simulados', label: 'Simulados', emoji: '🏁' },
] as const;

export const levelForPercent = (p: number | null | undefined): Level =>
  p === null || p === undefined ? 'sem-dados' : p >= 80 ? 'bom' : p >= 65 ? 'atencao' : p >= 50 ? 'melhorar' : 'critico';

export const GOAL_METRICS: { value: GoalMetric; label: string; unit: string; example: string }[] = [
  { value: 'QUESTIONS', label: 'Resolver questões', unit: 'questões', example: 'Fazer 500 questões esta semana' },
  { value: 'CORRECT_ANSWERS', label: 'Acertar questões', unit: 'acertos', example: 'Acertar 300 questões no mês' },
  { value: 'STUDY_MINUTES', label: 'Horas de estudo', unit: 'horas', example: 'Estudar 20 horas este mês' },
  { value: 'STUDY_DAYS', label: 'Dias de estudo', unit: 'dias', example: 'Estudar 6 dias por semana' },
  { value: 'STUDY_SESSIONS', label: 'Sessões de estudo', unit: 'sessões', example: 'Revisar Cirurgia (5 sessões)' },
  { value: 'REVIEWS_DONE', label: 'Fazer revisões', unit: 'revisões', example: 'Fazer 40 revisões na semana' },
  { value: 'MOCK_EXAMS', label: 'Fazer simulados', unit: 'simulados', example: 'Fazer 3 simulados este mês' },
  { value: 'CLEAR_OVERDUE', label: 'Zerar revisões atrasadas', unit: 'revisões', example: 'Completar todas as revisões atrasadas' },
  { value: 'CUSTOM', label: 'Personalizada (manual)', unit: 'unidades', example: 'Ler 3 capítulos do Harrison' },
];

export const GOAL_PERIODS: { value: GoalPeriod; label: string }[] = [
  { value: 'DAILY', label: 'Diária' },
  { value: 'WEEKLY', label: 'Semanal' },
  { value: 'MONTHLY', label: 'Mensal' },
  { value: 'CUSTOM', label: 'Personalizada (com prazo)' },
];

export const PERIOD_PRESETS = [
  { days: 7, label: '7 dias' },
  { days: 30, label: '30 dias' },
  { days: 90, label: '90 dias' },
  { days: 180, label: '6 meses' },
  { days: 365, label: '1 ano' },
];
