import { prisma } from '../../lib/prisma.js';
import { addDays, diffDays, fromDb, minDate, maxDate, toDb } from '../../lib/dates.js';
import { br, clamp, percent, round, sum } from '../../lib/math.js';
import { loadActivity, reviewStatus } from '../metrics/metrics.service.js';
import { evaluateGoal } from '../goals/goals.service.js';

// Indicador geral de progresso. Esta versão DETALHADA (números, fórmula, pesos)
// só é entregue ao próprio usuário. O grupo recebe apenas public-summary.ts.

export type Level = 'bom' | 'atencao' | 'melhorar' | 'critico' | 'sem-dados';
export type ComponentKey = 'estudos' | 'questoes' | 'revisoes' | 'metas' | 'simulados';
export type TrendDir = 'up' | 'steady' | 'down';

export const WEIGHTS: Record<ComponentKey, number> = {
  estudos: 0.3,
  questoes: 0.25,
  revisoes: 0.25,
  metas: 0.1,
  simulados: 0.1,
};

export const COMPONENT_LABEL: Record<ComponentKey, string> = {
  estudos: 'Estudos',
  questoes: 'Questões',
  revisoes: 'Revisões',
  metas: 'Metas',
  simulados: 'Simulados',
};

/** Rótulos qualitativos — são os únicos textos de status exibidos ao grupo. */
export const STATUS_LABEL: Record<ComponentKey, Record<Level, string>> = {
  estudos: {
    bom: 'bom ritmo',
    atencao: 'ritmo moderado',
    melhorar: 'estudando pouco',
    critico: 'sem estudos recentes',
    'sem-dados': 'sem registros',
  },
  questoes: {
    bom: 'bom desempenho',
    atencao: 'desempenho regular',
    melhorar: 'precisa melhorar',
    critico: 'poucas questões ou desempenho baixo',
    'sem-dados': 'sem registros',
  },
  revisoes: {
    bom: 'em dia',
    atencao: 'algumas pendências',
    melhorar: 'revisões atrasadas',
    critico: 'muitas revisões atrasadas',
    'sem-dados': 'sem revisões ainda',
  },
  metas: {
    bom: 'cumprindo as metas',
    atencao: 'metas em andamento',
    melhorar: 'metas atrasadas',
    critico: 'metas paradas',
    'sem-dados': 'sem metas definidas',
  },
  simulados: {
    bom: 'fazendo simulados',
    atencao: 'poucos simulados',
    melhorar: 'simulados em queda',
    critico: 'sem simulados recentes',
    'sem-dados': 'nenhum simulado ainda',
  },
};

export function levelFor(score: number | null): Level {
  if (score === null) return 'sem-dados';
  if (score >= 75) return 'bom';
  if (score >= 50) return 'atencao';
  if (score >= 25) return 'melhorar';
  return 'critico';
}

export interface ProgressComponent {
  key: ComponentKey;
  label: string;
  weight: number;
  score: number | null;
  level: Level;
  statusLabel: string;
  explanation: string;
  details: Record<string, number | string | null>;
}

function component(key: ComponentKey, score: number | null, explanation: string, details: ProgressComponent['details']): ProgressComponent {
  const s = score === null ? null : Math.round(clamp(score, 0, 100));
  const level = levelFor(s);
  return { key, label: COMPONENT_LABEL[key], weight: WEIGHTS[key], score: s, level, statusLabel: STATUS_LABEL[key][level], explanation, details };
}

/** Ritmo de metas: compara o progresso com o esperado para o tempo já decorrido. */
async function goalPace(userId: string, today: string) {
  const from30 = addDays(today, -29);
  const goals = await prisma.goal.findMany({
    where: {
      userId,
      OR: [{ status: 'ACTIVE' }, { status: { in: ['COMPLETED', 'EXPIRED'] }, updatedAt: { gte: toDb(from30) } }],
    },
  });
  const items: { title: string; percent: number; pace: number }[] = [];
  for (const g of goals) {
    const view = await evaluateGoal(userId, g, today);
    let pace: number;
    if (g.status === 'COMPLETED' || view.status === 'COMPLETED') pace = 1;
    else if (g.period === 'DAILY') {
      // Média dos últimos 7 dias completos (ou desde a criação da meta)
      const start = maxDate(fromDb(g.startDate), addDays(today, -7));
      const days: string[] = [];
      for (let d = start; d < today; d = addDays(d, 1)) days.push(d);
      if (!days.length) pace = Math.min(1, view.progress / g.target);
      else {
        const vals = await Promise.all(
          days.map((d) => evaluateGoal(userId, g, d).then((v) => Math.min(1, v.progress / g.target))),
        );
        pace = sum(vals) / vals.length;
      }
    } else {
      const from = view.window.from;
      const to = view.window.to;
      const totalDays = Math.max(1, diffDays(from, to) + 1);
      const elapsed = clamp(diffDays(from, minDate(today, to)) + 1, 1, totalDays);
      const expected = g.target * (elapsed / totalDays);
      pace = expected > 0 ? Math.min(1, view.progress / expected) : 1;
    }
    items.push({ title: g.title, percent: view.status === 'COMPLETED' ? 100 : view.percent, pace: round(pace * 100, 0) });
  }
  return items;
}

export async function computeProgress(userId: string, today: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { weeklyStudyDaysTarget: true, weeklyStudyHoursTarget: true, dailyQuestionsTarget: true },
  });
  const from7 = addDays(today, -6);
  const from14 = addDays(today, -13);
  const from30 = addDays(today, -29);
  const prevFrom14 = addDays(today, -27);
  const prevTo14 = addDays(today, -14);

  const [act30, actPrev14, everSessions, everQuestions, learningStates, reviews, goals, mocks60, everMocks] = await Promise.all([
    loadActivity(userId, from30, today),
    loadActivity(userId, prevFrom14, prevTo14),
    prisma.studySession.count({ where: { userId } }),
    prisma.questionSession.count({ where: { userId } }),
    prisma.learningState.count({ where: { userId } }),
    reviewStatus(userId, today, from30),
    goalPace(userId, today),
    prisma.mockExam.findMany({
      where: { userId, status: 'DONE', takenOn: { gte: toDb(addDays(today, -59)), lte: toDb(today) } },
      orderBy: { takenOn: 'asc' },
      select: { totalQuestions: true, correct: true },
    }),
    prisma.mockExam.count({ where: { userId, status: 'DONE' } }),
  ]);

  const inRange = (d: Date, from: string) => fromDb(d) >= from;

  // ── Estudos: regularidade (dias) + volume (horas) ────────────────────────
  const days14 = new Set(act30.sessions.filter((s) => inRange(s.studiedOn, from14)).map((s) => fromDb(s.studiedOn))).size;
  const minutes7 = sum(act30.sessions.filter((s) => inRange(s.studiedOn, from7)).map((s) => s.durationMinutes));
  const daysTarget14 = user.weeklyStudyDaysTarget * 2;
  const minutesTarget7 = user.weeklyStudyHoursTarget * 60;
  const regularity = Math.min(1, days14 / daysTarget14);
  const volume = Math.min(1, minutes7 / minutesTarget7);
  const estudos = component(
    'estudos',
    everSessions === 0 ? null : 100 * (0.5 * regularity + 0.5 * volume),
    `50% regularidade (${days14} de ${daysTarget14} dias nas últimas 2 semanas) + 50% volume (${br(minutes7 / 60)} h de ${user.weeklyStudyHoursTarget} h nos últimos 7 dias).`,
    { diasEstudados14: days14, metaDias14: daysTarget14, horas7: round(minutes7 / 60, 1), metaHoras7: user.weeklyStudyHoursTarget },
  );

  // ── Questões: acerto (70%) + volume (30%) ────────────────────────────────
  const qTotal30 =
    sum(act30.questions.map((q) => q.total)) + sum(act30.mocks.map((m) => m.totalQuestions ?? 0)) + sum(act30.attempts.map((a) => a.totalQuestions ?? 0));
  const qCorrect30 =
    sum(act30.questions.map((q) => q.correct)) + sum(act30.mocks.map((m) => m.correct ?? 0)) + sum(act30.attempts.map((a) => a.correct ?? 0));
  const q14 = sum(act30.questions.filter((q) => inRange(q.doneOn, from14)).map((q) => q.total));
  const acc30 = percent(qCorrect30, qTotal30);
  const expected14 = user.dailyQuestionsTarget * user.weeklyStudyDaysTarget * 2;
  const accScore = acc30 === null ? 0 : clamp((acc30 - 50) / 35, 0, 1);
  const qVolume = expected14 > 0 ? Math.min(1, q14 / expected14) : 1;
  const questoes = component(
    'questoes',
    everQuestions === 0 && qTotal30 === 0 ? null : 100 * (0.7 * accScore + 0.3 * qVolume),
    `70% taxa de acerto em 30 dias (${br(acc30)}%; 50% vale 0 e 85% ou mais vale o máximo) + 30% volume (${q14} de ${expected14} questões esperadas em 2 semanas).`,
    { acerto30: acc30, questoes30: qTotal30, questoes14: q14, esperado14: expected14 },
  );

  // ── Revisões: conclusão + pontualidade − atrasos ─────────────────────────
  let revScore: number | null = null;
  if (learningStates > 0) {
    const base = reviews.dueInPeriod > 0 ? 0.6 * (reviews.completionRate ?? 0) + 0.4 * (reviews.onTimeRate ?? 0) : 100;
    revScore = base - Math.min(50, reviews.overdue * 4);
    if (reviews.overdue >= 10) revScore = Math.min(revScore, 20);
  }
  const revisoes = component(
    'revisoes',
    revScore,
    `60% revisões concluídas + 40% feitas no prazo (das ${reviews.dueInPeriod} previstas nos últimos 30 dias), menos 4 pontos por revisão atrasada (${reviews.overdue} hoje).`,
    {
      previstas30: reviews.dueInPeriod,
      concluidas: reviews.completedOfDue,
      noPrazo: reviews.onTime,
      atrasadas: reviews.overdue,
      pendentes: reviews.pending,
    },
  );

  // ── Metas: ritmo em relação ao esperado ──────────────────────────────────
  const goalsCompletionPercent = goals.length ? round(sum(goals.map((g) => g.percent)) / goals.length, 0) : null;
  const metas = component(
    'metas',
    goals.length ? sum(goals.map((g) => g.pace)) / goals.length : null,
    'Média do ritmo de cada meta: progresso atual dividido pelo esperado para o tempo já decorrido do período.',
    { metasConsideradas: goals.length, conclusaoMedia: goalsCompletionPercent },
  );

  // ── Simulados: frequência (60 dias) + evolução ───────────────────────────
  let mockScore: number | null = null;
  let mockTrend: string | null = null;
  if (everMocks > 0) {
    if (mocks60.length === 0) mockScore = 10;
    else {
      const accs = mocks60.map((m) => percent(m.correct ?? 0, m.totalQuestions ?? 0)).filter((v): v is number => v !== null);
      let trendComp = 0.75;
      if (accs.length >= 2) {
        const [prev, last] = accs.slice(-2);
        trendComp = last >= prev - 2 ? 1 : 0.4;
        mockTrend = last >= prev - 2 ? 'estável ou em alta' : 'em queda';
      }
      mockScore = 100 * (0.6 * Math.min(1, mocks60.length / 2) + 0.4 * trendComp);
    }
  }
  const simulados = component(
    'simulados',
    mockScore,
    '60% frequência (2 ou mais simulados em 60 dias vale o máximo) + 40% evolução do último simulado em relação ao anterior.',
    { simulados60: mocks60.length, evolucao: mockTrend },
  );

  const components = [estudos, questoes, revisoes, metas, simulados];
  const available = components.filter((c) => c.score !== null);
  const weightSum = sum(available.map((c) => c.weight));
  const index = available.length ? Math.round(sum(available.map((c) => c.score! * c.weight)) / weightSum) : null;

  // ── Tendência: últimas 2 semanas vs. 2 semanas anteriores ────────────────
  const m14 = sum(act30.sessions.filter((s) => inRange(s.studiedOn, from14)).map((s) => s.durationMinutes));
  const mPrev = sum(actPrev14.sessions.map((s) => s.durationMinutes));
  const qs14 = act30.questions.filter((q) => inRange(q.doneOn, from14));
  const acc14 = percent(sum(qs14.map((q) => q.correct)), sum(qs14.map((q) => q.total)));
  const accPrev = percent(sum(actPrev14.questions.map((q) => q.correct)), sum(actPrev14.questions.map((q) => q.total)));
  const enoughQ = sum(qs14.map((q) => q.total)) >= 20 && sum(actPrev14.questions.map((q) => q.total)) >= 20;
  const accDiff = acc14 !== null && accPrev !== null && enoughQ ? acc14 - accPrev : 0;
  const up = (m14 > 0 && m14 >= mPrev * 1.15) || accDiff >= 3;
  const down = (mPrev > 0 && m14 <= mPrev * 0.7) || accDiff <= -5;
  const trend: TrendDir = up && !down ? 'up' : down && !up ? 'down' : 'steady';

  return {
    today,
    index,
    level: levelFor(index),
    trend,
    trendDetail: {
      minutes14: m14,
      minutesPrev14: mPrev,
      accuracy14: acc14,
      accuracyPrev14: accPrev,
    },
    goalsCompletionPercent,
    goals,
    components,
    formula: `Índice = ${components.map((c) => `${Math.round(c.weight * 100)}% ${c.label}`).join(' + ')} (componentes sem dados são ignorados e os pesos redistribuídos)`,
  };
}

export type DetailedProgress = Awaited<ReturnType<typeof computeProgress>>;
