import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { addDays, endOfMonth, fromDb, toDb } from '../../lib/dates.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { getAreaMap } from '../taxonomy/taxonomy.service.js';
import { reviewPlan } from '../scheduler/index.js';
import { getSchedulerConfig } from './algorithm-config.js';
import { serializeReview } from './learning.service.js';
import { ADVICE_WINDOW, THEORY_METHODS, studyAdvice, type PastSession, type StudyAdvice } from './study-advice.js';

export type ReviewView = Awaited<ReturnType<typeof listReviews>>[number];

/** Rótulo (D10, D21…) e fase da revisão; verificações após leitura aparecem como D1. */
function labels(
  r: { stage: number; checkup: boolean; suggestTheory: boolean; subject: { size: import('@prisma/client').SubjectSize } },
  config: Awaited<ReturnType<typeof getSchedulerConfig>>,
) {
  const plan = reviewPlan(r.stage, r.subject.size, { checkup: r.checkup, theory: r.suggestTheory }, config);
  return { stageLabel: plan.label, phase: plan.phase };
}

/**
 * Como estudar em cada revisão pendente, pelos últimos estudos do assunto (study-advice.ts).
 * Uma consulta para todos os assuntos: os últimos estudos de cada um e a data da última teoria.
 */
async function adviceFor(
  userId: string,
  reviews: { id: string; subjectId: string; status: string; suggestedMethods: import('@prisma/client').StudyMethod[]; suggestTheory: boolean }[],
) {
  const out = new Map<string, StudyAdvice | null>();
  const pending = reviews.filter((r) => r.status === 'PENDING');
  const ids = [...new Set(pending.map((r) => r.subjectId))];
  if (!ids.length) return out;
  const [rows, theory] = await Promise.all([
    prisma.$queryRaw<{ subject_id: string; studied_on: Date; methods: string[]; questions: number; correct: number }[]>`
      SELECT s.subject_id, s.studied_on, s.methods::text[] AS methods,
             COALESCE(SUM(q.total), 0)::int AS questions, COALESCE(SUM(q.correct), 0)::int AS correct
      FROM (
        SELECT id, subject_id, studied_on, created_at, methods,
               ROW_NUMBER() OVER (PARTITION BY subject_id ORDER BY studied_on DESC, created_at DESC) AS rn
        FROM study_sessions
        WHERE user_id = ${userId} AND subject_id = ANY(${ids})
      ) s
      LEFT JOIN question_sessions q ON q.study_session_id = s.id
      WHERE s.rn <= ${ADVICE_WINDOW}
      GROUP BY s.id, s.subject_id, s.studied_on, s.created_at, s.methods
      ORDER BY s.subject_id, s.studied_on DESC, s.created_at DESC`,
    prisma.$queryRaw<{ subject_id: string; last: Date }[]>`
      SELECT subject_id, MAX(studied_on) AS last
      FROM study_sessions
      WHERE user_id = ${userId} AND subject_id = ANY(${ids}) AND methods && ${THEORY_METHODS}::"StudyMethod"[]
      GROUP BY subject_id`,
  ]);
  const history = new Map<string, PastSession[]>();
  for (const r of rows) {
    const list = history.get(r.subject_id) ?? [];
    list.push({
      date: fromDb(r.studied_on),
      methods: r.methods as PastSession['methods'],
      questions: r.questions,
      accuracy: r.questions > 0 ? (r.correct / r.questions) * 100 : null,
    });
    history.set(r.subject_id, list);
  }
  const lastTheory = new Map(theory.map((t) => [t.subject_id, fromDb(t.last)]));
  for (const r of pending) {
    out.set(r.id, studyAdvice(history.get(r.subjectId) ?? [], r.suggestedMethods, { lowScore: r.suggestTheory, lastTheory: lastTheory.get(r.subjectId) ?? null }));
  }
  return out;
}

/** Sugestão de como estudar das revisões indicadas (ex.: a próxima revisão logo depois de registrar um estudo). */
export async function adviceForReviewIds(userId: string, ids: string[]) {
  if (!ids.length) return new Map<string, StudyAdvice | null>();
  const reviews = await prisma.review.findMany({
    where: { userId, id: { in: ids } },
    select: { id: true, subjectId: true, status: true, suggestedMethods: true, suggestTheory: true },
  });
  return adviceFor(userId, reviews);
}

export async function listReviews(
  userId: string,
  opts: { status?: 'PENDING' | 'DONE'; from?: string; to?: string; subjectId?: string; limit?: number; order?: 'asc' | 'desc' },
) {
  const where: Prisma.ReviewWhereInput = { userId };
  if (opts.status) where.status = opts.status;
  if (opts.subjectId) where.subjectId = opts.subjectId;
  const dateField = opts.status === 'DONE' ? 'completedOn' : 'scheduledFor';
  if (opts.from || opts.to) {
    where[dateField] = {
      ...(opts.from ? { gte: toDb(opts.from) } : {}),
      ...(opts.to ? { lte: toDb(opts.to) } : {}),
    };
  }
  const [reviews, areaMap, config] = await Promise.all([
    prisma.review.findMany({
      where,
      orderBy: [{ [dateField]: opts.order ?? 'asc' }, { createdAt: 'asc' }],
      include: { subject: { select: { id: true, name: true, areaId: true, size: true } } },
      take: opts.limit ?? 500,
    }),
    getAreaMap(userId),
    getSchedulerConfig(),
  ]);
  const advice = await adviceFor(userId, reviews);
  return reviews.map((r) => ({
    ...serializeReview(r),
    ...labels(r, config),
    // Como estudar nesta revisão (só nas pendentes)
    advice: advice.get(r.id) ?? null,
    subject: { id: r.subject.id, name: r.subject.name, size: r.subject.size, area: areaMap.get(r.subject.areaId) ?? null },
  }));
}

/** Revisões de hoje, atrasadas e próximas. */
export async function reviewAgenda(userId: string, today: string, days = 7) {
  const pending = await listReviews(userId, { status: 'PENDING', to: addDays(today, days) });
  return {
    today: pending.filter((r) => r.scheduledFor === today),
    overdue: pending.filter((r) => r.scheduledFor < today),
    upcoming: pending.filter((r) => r.scheduledFor > today),
  };
}

/** Calendário mensal: revisões pendentes e realizadas agrupadas por dia. */
export async function reviewCalendar(userId: string, month: string, today: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw badRequest('Mês inválido (use AAAA-MM)');
  const from = `${month}-01`;
  const to = endOfMonth(from);
  const [pending, done] = await Promise.all([
    listReviews(userId, { status: 'PENDING', from, to }),
    listReviews(userId, { status: 'DONE', from, to }),
  ]);
  const days: Record<string, { date: string; pending: typeof pending; done: typeof done }> = {};
  const ensure = (d: string) => (days[d] ??= { date: d, pending: [], done: [] });
  for (const r of pending) ensure(r.scheduledFor).pending.push(r);
  for (const r of done) ensure(r.completedOn!).done.push(r);
  return {
    month,
    today,
    days: Object.values(days).sort((a, b) => a.date.localeCompare(b.date)),
    totals: {
      pending: pending.length,
      overdue: pending.filter((r) => r.scheduledFor < today).length,
      done: done.length,
    },
  };
}

export async function getReview(userId: string, id: string) {
  const [review] = await listReviewsByIds(userId, [id]);
  if (!review) throw notFound('Revisão não encontrada');
  return review;
}

async function listReviewsByIds(userId: string, ids: string[]) {
  const [reviews, areaMap, config] = await Promise.all([
    prisma.review.findMany({
      where: { userId, id: { in: ids } },
      include: { subject: { select: { id: true, name: true, areaId: true, size: true } } },
    }),
    getAreaMap(userId),
    getSchedulerConfig(),
  ]);
  const advice = await adviceFor(userId, reviews);
  return reviews.map((r) => ({
    ...serializeReview(r),
    ...labels(r, config),
    advice: advice.get(r.id) ?? null,
    subject: { id: r.subject.id, name: r.subject.name, size: r.subject.size, area: areaMap.get(r.subject.areaId) ?? null },
  }));
}

/** Adiar ou antecipar uma revisão pendente. */
export async function rescheduleReview(userId: string, id: string, date: string, today: string) {
  const review = await prisma.review.findFirst({ where: { id, userId } });
  if (!review) throw notFound('Revisão não encontrada');
  if (review.status !== 'PENDING') throw badRequest('Só é possível reagendar revisões pendentes');
  if (date < today) throw badRequest('Escolha hoje ou uma data futura');
  await prisma.review.update({
    where: { id },
    data: { scheduledFor: toDb(date), originalScheduledOn: review.originalScheduledOn ?? review.shiftedFrom ?? review.scheduledFor, shiftedFrom: null },
  });
  return getReview(userId, id);
}

/** Carga de revisões por dia (para distribuir revisões e alertas). */
export async function reviewLoad(userId: string, from: string, to: string) {
  const rows = await prisma.review.groupBy({
    by: ['scheduledFor'],
    where: { userId, status: 'PENDING', scheduledFor: { gte: toDb(from), lte: toDb(to) } },
    _count: { _all: true },
  });
  return rows.map((r) => ({ date: fromDb(r.scheduledFor), count: r._count._all }));
}
