import type { Goal, GoalMetric, GoalPeriod, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { addDays, diffDays, endOfMonth, fromDb, minDate, startOfMonth, startOfWeek, toDb } from '../../lib/dates.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { round } from '../../lib/math.js';
import { areaWithDescendants, findOwnedArea, findOwnedSubject } from '../taxonomy/taxonomy.service.js';
import { notify } from '../notifications/notifications.service.js';

export interface GoalInput {
  title: string;
  description?: string | null;
  metric: GoalMetric;
  period: GoalPeriod;
  target: number;
  areaId?: string | null;
  subjectId?: string | null;
  startDate?: string;
  dueDate?: string | null;
  manualProgress?: number;
}

export const METRIC_LABEL: Record<GoalMetric, string> = {
  QUESTIONS: 'questões',
  CORRECT_ANSWERS: 'acertos',
  STUDY_MINUTES: 'minutos de estudo',
  STUDY_SESSIONS: 'sessões de estudo',
  STUDY_DAYS: 'dias de estudo',
  REVIEWS_DONE: 'revisões',
  MOCK_EXAMS: 'simulados',
  CLEAR_OVERDUE: 'revisões atrasadas zeradas',
  CUSTOM: 'unidades',
};

/** Janela de apuração atual da meta. */
export function goalWindow(goal: Pick<Goal, 'period' | 'startDate' | 'dueDate'>, today: string) {
  switch (goal.period) {
    case 'DAILY':
      return { from: today, to: today, key: today };
    case 'WEEKLY': {
      const from = startOfWeek(today);
      return { from, to: addDays(from, 6), key: from };
    }
    case 'MONTHLY':
      return { from: startOfMonth(today), to: endOfMonth(today), key: today.slice(0, 7) };
    default:
      return { from: fromDb(goal.startDate), to: goal.dueDate ? fromDb(goal.dueDate) : today, key: 'custom' };
  }
}

async function subjectFilter(userId: string, goal: Goal): Promise<string[] | null> {
  if (goal.subjectId) return [goal.subjectId];
  if (goal.areaId) {
    const areas = await areaWithDescendants(userId, goal.areaId);
    const subjects = await prisma.subject.findMany({ where: { userId, areaId: { in: areas } }, select: { id: true } });
    return subjects.map((s) => s.id);
  }
  return null;
}

async function measure(userId: string, goal: Goal, from: string, to: string, today: string): Promise<number> {
  const end = minDate(to, today);
  if (goal.metric === 'CUSTOM') return goal.manualProgress;
  const subjects = await subjectFilter(userId, goal);
  const bySubject = subjects ? { subjectId: { in: subjects } } : {};
  const range = { gte: toDb(from), lte: toDb(end) };
  if (end < from && goal.metric !== 'CLEAR_OVERDUE') return 0;

  switch (goal.metric) {
    case 'QUESTIONS':
    case 'CORRECT_ANSWERS': {
      const field = goal.metric === 'QUESTIONS' ? 'total' : 'correct';
      const qs = await prisma.questionSession.aggregate({ where: { userId, doneOn: range, ...bySubject }, _sum: { total: true, correct: true } });
      let value = qs._sum[field] ?? 0;
      if (!subjects) {
        const [mocks, attempts] = await Promise.all([
          prisma.mockExam.aggregate({ where: { userId, status: 'DONE', takenOn: range }, _sum: { totalQuestions: true, correct: true } }),
          prisma.examAttempt.aggregate({ where: { userId, takenOn: range }, _sum: { totalQuestions: true, correct: true } }),
        ]);
        value +=
          goal.metric === 'QUESTIONS'
            ? (mocks._sum.totalQuestions ?? 0) + (attempts._sum.totalQuestions ?? 0)
            : (mocks._sum.correct ?? 0) + (attempts._sum.correct ?? 0);
      }
      return value;
    }
    case 'STUDY_MINUTES': {
      const r = await prisma.studySession.aggregate({ where: { userId, studiedOn: range, ...bySubject }, _sum: { durationMinutes: true } });
      return r._sum.durationMinutes ?? 0;
    }
    case 'STUDY_SESSIONS':
      return prisma.studySession.count({ where: { userId, studiedOn: range, ...bySubject } });
    case 'STUDY_DAYS': {
      const days = await prisma.studySession.findMany({
        where: { userId, studiedOn: range, ...bySubject },
        select: { studiedOn: true },
        distinct: ['studiedOn'],
      });
      return days.length;
    }
    case 'REVIEWS_DONE':
      return prisma.review.count({ where: { userId, status: 'DONE', completedOn: range, ...bySubject } });
    case 'MOCK_EXAMS':
      return prisma.mockExam.count({ where: { userId, status: 'DONE', takenOn: range } });
    case 'CLEAR_OVERDUE': {
      const overdue = await prisma.review.count({
        where: { userId, status: 'PENDING', scheduledFor: { lt: toDb(today) }, ...bySubject },
      });
      return Math.max(0, goal.target - overdue);
    }
  }
  return 0;
}

export async function evaluateGoal(userId: string, goal: Goal, today: string) {
  const window = goalWindow(goal, today);
  const progress = await measure(userId, goal, window.from, window.to, today);
  const percent = goal.target > 0 ? Math.min(100, round((progress / goal.target) * 100, 1)) : 0;
  const reached = progress >= goal.target;
  const recurring = goal.period !== 'CUSTOM';
  let status = goal.status;
  if (!recurring && goal.status === 'ACTIVE') {
    if (reached) status = 'COMPLETED';
    else if (goal.dueDate && fromDb(goal.dueDate) < today) status = 'EXPIRED';
  }
  return {
    id: goal.id,
    title: goal.title,
    description: goal.description,
    metric: goal.metric,
    metricLabel: METRIC_LABEL[goal.metric],
    period: goal.period,
    target: goal.target,
    manualProgress: goal.manualProgress,
    areaId: goal.areaId,
    subjectId: goal.subjectId,
    startDate: fromDb(goal.startDate),
    dueDate: goal.dueDate ? fromDb(goal.dueDate) : null,
    status,
    completedAt: goal.completedAt,
    recurring,
    window,
    progress: round(progress, 1),
    percent,
    remaining: Math.max(0, round(goal.target - progress, 1)),
    reachedThisPeriod: reached,
    daysLeft: diffDays(today, window.to),
    createdAt: goal.createdAt,
  };
}

export type GoalView = Awaited<ReturnType<typeof evaluateGoal>>;

export async function listGoals(userId: string, today: string, opts: { status?: 'active' | 'all' } = {}) {
  const goals = await prisma.goal.findMany({
    where: { userId, ...(opts.status === 'active' ? { status: 'ACTIVE' } : {}) },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
  });
  return Promise.all(goals.map((g) => evaluateGoal(userId, g, today)));
}

async function validateRefs(userId: string, input: Partial<GoalInput>) {
  if (input.areaId) await findOwnedArea(userId, input.areaId);
  if (input.subjectId) await findOwnedSubject(userId, input.subjectId);
}

export async function createGoal(userId: string, input: GoalInput, today: string) {
  await validateRefs(userId, input);
  if (input.period === 'CUSTOM' && !input.dueDate) throw badRequest('Metas personalizadas precisam de um prazo');
  let target = input.target;
  if (input.metric === 'CLEAR_OVERDUE') {
    target = await prisma.review.count({ where: { userId, status: 'PENDING', scheduledFor: { lt: toDb(today) } } });
    if (target === 0) throw badRequest('Você não tem revisões atrasadas no momento 🎉');
  }
  const goal = await prisma.goal.create({
    data: {
      userId,
      title: input.title,
      description: input.description ?? null,
      metric: input.metric,
      period: input.period,
      target,
      areaId: input.areaId ?? null,
      subjectId: input.subjectId ?? null,
      startDate: toDb(input.startDate ?? today),
      dueDate: input.dueDate ? toDb(input.dueDate) : null,
      manualProgress: input.manualProgress ?? 0,
    },
  });
  await refreshGoals(userId, today);
  return evaluateGoal(userId, (await prisma.goal.findUniqueOrThrow({ where: { id: goal.id } })), today);
}

export async function updateGoal(userId: string, id: string, input: Partial<GoalInput> & { status?: 'ACTIVE' | 'ARCHIVED' }, today: string) {
  const goal = await prisma.goal.findFirst({ where: { id, userId } });
  if (!goal) throw notFound('Meta não encontrada');
  await validateRefs(userId, input);
  const data: Prisma.GoalUpdateInput = {
    title: input.title,
    description: input.description,
    target: input.target,
    manualProgress: input.manualProgress,
    period: input.period,
    metric: input.metric,
    area: input.areaId === undefined ? undefined : input.areaId ? { connect: { id: input.areaId } } : { disconnect: true },
    subject:
      input.subjectId === undefined ? undefined : input.subjectId ? { connect: { id: input.subjectId } } : { disconnect: true },
    startDate: input.startDate ? toDb(input.startDate) : undefined,
    dueDate: input.dueDate === undefined ? undefined : input.dueDate ? toDb(input.dueDate) : null,
  };
  if (input.status) data.status = input.status;
  // Mudou alvo/prazo de uma meta encerrada → volta a ficar ativa para reavaliação
  if (!input.status && (input.target !== undefined || input.dueDate !== undefined || input.manualProgress !== undefined)) {
    data.status = 'ACTIVE';
    data.completedAt = null;
  }
  await prisma.goal.update({ where: { id }, data });
  await refreshGoals(userId, today);
  return evaluateGoal(userId, await prisma.goal.findUniqueOrThrow({ where: { id } }), today);
}

export async function deleteGoal(userId: string, id: string) {
  const goal = await prisma.goal.findFirst({ where: { id, userId } });
  if (!goal) throw notFound('Meta não encontrada');
  await prisma.goal.delete({ where: { id } });
}

/**
 * Reavalia metas ativas: marca concluídas/expiradas e dispara notificações
 * (meta concluída, prazo próximo). Chamado após cada registro e pelo job.
 */
export async function refreshGoals(userId: string, today: string) {
  const goals = await prisma.goal.findMany({ where: { userId, status: 'ACTIVE' } });
  for (const goal of goals) {
    const view = await evaluateGoal(userId, goal, today);
    if (view.status !== goal.status) {
      await prisma.goal.update({
        where: { id: goal.id },
        data: { status: view.status, completedAt: view.status === 'COMPLETED' ? new Date() : null },
      });
    }
    if (view.reachedThisPeriod) {
      await notify(userId, {
        type: 'goal-completed',
        title: `🎯 Meta concluída: ${goal.title}`,
        body: `${view.progress}/${goal.target} — parabéns!`,
        link: '/metas',
        dedupeKey: `goal-done:${goal.id}:${view.window.key}`,
      });
    } else if (view.status === 'ACTIVE') {
      const nearDeadline =
        (goal.period === 'CUSTOM' && view.daysLeft >= 0 && view.daysLeft <= 2) ||
        (goal.period === 'WEEKLY' && view.daysLeft <= 1) ||
        (goal.period === 'MONTHLY' && view.daysLeft <= 3);
      if (nearDeadline && view.percent < 100) {
        await notify(userId, {
          type: 'goal-deadline',
          title: `⏳ A meta "${goal.title}" termina ${view.daysLeft === 0 ? 'hoje' : `em ${view.daysLeft} ${view.daysLeft === 1 ? 'dia' : 'dias'}`}.`,
          body: `Progresso atual: ${view.percent}% (${view.progress}/${goal.target}).`,
          link: '/metas',
          dedupeKey: `goal-deadline:${goal.id}:${view.window.key}`,
        });
      }
    }
  }
}
