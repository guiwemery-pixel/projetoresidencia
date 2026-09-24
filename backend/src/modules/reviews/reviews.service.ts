import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { addDays, endOfMonth, fromDb, toDb } from '../../lib/dates.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { getAreaMap } from '../taxonomy/taxonomy.service.js';
import { reviewPlan } from '../scheduler/index.js';
import { getSchedulerConfig } from './algorithm-config.js';
import { serializeReview } from './learning.service.js';

export type ReviewView = Awaited<ReturnType<typeof listReviews>>[number];

/** Rótulo (D1, D7…) e fase da revisão; verificações após leitura aparecem como D1. */
function labels(
  r: { stage: number; checkup: boolean; suggestTheory: boolean; subject: { size: import('@prisma/client').SubjectSize } },
  config: Awaited<ReturnType<typeof getSchedulerConfig>>,
) {
  const plan = reviewPlan(r.stage, r.subject.size, { checkup: r.checkup, theory: r.suggestTheory }, config);
  return { stageLabel: plan.label, phase: plan.phase };
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
  return reviews.map((r) => ({
    ...serializeReview(r),
    ...labels(r, config),
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
  return reviews.map((r) => ({
    ...serializeReview(r),
    ...labels(r, config),
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
    data: { scheduledFor: toDb(date), originalScheduledOn: review.originalScheduledOn ?? review.scheduledFor },
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
