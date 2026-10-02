import { prisma } from '../../lib/prisma.js';
import { addDays, diffDays, fromDb, startOfWeek, toDb } from '../../lib/dates.js';
import { notify } from '../notifications/notifications.service.js';
import { nextStudyDay } from './distribute.js';

// Revisão atrasada há muito tempo (padrão: 20 dias, em Perfil) = o assunto precisa ser
// estudado de novo. Ele volta para o cronograma, na semana atual (hoje, se for dia de
// estudo, ou o próximo dia de estudo da semana), num cronograma automático "Assuntos para repetir". Estudar o assunto conclui o item e a revisão.
// Uma vez por atraso: se o item for pulado, não volta de novo até a próxima revisão atrasar.

export const REQUEUE_SOURCE = 'auto:revisoes-atrasadas';
export const REQUEUE_PLAN_NAME = 'Assuntos para repetir';

const fmt = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

export async function requeueOverdue(userId: string, today: string, days?: number) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { requeueOverdueDays: true, studyWeekdays: true } });
  const threshold = days ?? user?.requeueOverdueDays ?? 0;
  if (threshold <= 0) return [];
  const overdue = await prisma.review.findMany({
    where: { userId, status: 'PENDING', scheduledFor: { lte: toDb(addDays(today, -threshold)) }, subject: { archived: false } },
    include: { subject: { select: { id: true, name: true } } },
    orderBy: { scheduledFor: 'asc' },
  });
  if (!overdue.length) return [];

  let plan = await prisma.studyPlan.findFirst({ where: { userId, source: REQUEUE_SOURCE } });
  const added: { subjectId: string; name: string; since: string; itemId: string }[] = [];
  const week = startOfWeek(today);
  const day = nextStudyDay(today, addDays(week, 6), user?.studyWeekdays.length ? user.studyWeekdays : [1, 2, 3, 4, 5]);
  for (const r of overdue) {
    const since = fromDb(r.scheduledFor);
    // Já está no cronograma (qualquer um), ou já voltou neste atraso
    const pending = await prisma.planItem.findFirst({ where: { userId, subjectId: r.subjectId, status: 'PENDING' }, select: { id: true } });
    if (pending) continue;
    if (plan) {
      const already = await prisma.planItem.findFirst({ where: { planId: plan.id, subjectId: r.subjectId, createdAt: { gte: r.scheduledFor } }, select: { id: true } });
      if (already) continue;
    }
    plan ??= await prisma.studyPlan.create({ data: { userId, name: REQUEUE_PLAN_NAME, source: REQUEUE_SOURCE } });
    const position = await prisma.planItem.count({ where: { planId: plan.id, weekStart: toDb(week) } });
    const item = await prisma.planItem.create({
      data: { userId, planId: plan.id, subjectId: r.subjectId, weekStart: toDb(week), plannedOn: toDb(day), label: `Revisão atrasada desde ${fmt(since)}`, position },
    });
    added.push({ subjectId: r.subjectId, name: r.subject.name, since, itemId: item.id });
    await notify(userId, {
      type: 'plan-requeue',
      title: `${r.subject.name} voltou para o cronograma desta semana.`,
      body: `A revisão está atrasada há ${diffDays(since, today)} dias (desde ${fmt(since)}): estude o assunto de novo. Ao registrar o estudo, o item do cronograma e a revisão são concluídos.`,
      link: '/cronograma',
      dedupeKey: `requeue:${r.subjectId}:${since}`,
    });
  }
  return added;
}
