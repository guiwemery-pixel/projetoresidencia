import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { addDays, fromDb, todayIn, toDb } from '../../lib/dates.js';

export interface NotificationInput {
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  /** Chave única por usuário — a mesma notificação nunca é criada duas vezes */
  dedupeKey?: string | null;
}

/** Cria uma notificação (ignorada silenciosamente se a dedupeKey já existir). */
export async function notify(userId: string, n: NotificationInput) {
  try {
    await prisma.notification.create({ data: { userId, ...n } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return;
    throw err;
  }
}

export async function listNotifications(userId: string, opts: { unreadOnly?: boolean; limit?: number }) {
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId, ...(opts.unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(opts.limit ?? 30, 100),
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { items, unread };
}

export async function markRead(userId: string, ids: string[] | 'all') {
  await prisma.notification.updateMany({
    where: { userId, readAt: null, ...(ids === 'all' ? {} : { id: { in: ids } }) },
    data: { readAt: new Date() },
  });
}

const STREAK_MILESTONES = [3, 7, 14, 21, 30, 45, 60, 90, 120, 180, 365];

/** Sequência atual de dias consecutivos com estudo (termina hoje ou ontem). */
export async function currentStreak(userId: string, today: string): Promise<{ days: number; startedOn: string | null }> {
  const rows = await prisma.studySession.findMany({
    where: { userId, studiedOn: { gte: toDb(addDays(today, -400)), lte: toDb(today) } },
    select: { studiedOn: true },
    distinct: ['studiedOn'],
    orderBy: { studiedOn: 'desc' },
  });
  const days = new Set(rows.map((r) => fromDb(r.studiedOn)));
  let cursor = days.has(today) ? today : addDays(today, -1);
  let count = 0;
  let startedOn: string | null = null;
  while (days.has(cursor)) {
    count++;
    startedOn = cursor;
    cursor = addDays(cursor, -1);
  }
  return { days: count, startedOn };
}

/**
 * Gera as notificações "de rotina" de um usuário. Idempotente (dedupeKey),
 * então pode rodar a cada abertura do app e também pelo job periódico.
 */
export async function generateNotifications(userId: string, today?: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } });
  if (!user) return;
  const day = today ?? todayIn(user.timezone);

  const [dueToday, overdue, plannedMocks, streak] = await Promise.all([
    prisma.review.count({ where: { userId, status: 'PENDING', scheduledFor: toDb(day) } }),
    prisma.review.findMany({
      where: { userId, status: 'PENDING', scheduledFor: { lt: toDb(day) } },
      include: { subject: { select: { name: true } } },
      orderBy: { scheduledFor: 'asc' },
      take: 20,
    }),
    prisma.mockExam.findMany({
      where: { userId, status: 'PLANNED', takenOn: { gte: toDb(day), lte: toDb(addDays(day, 2)) } },
    }),
    currentStreak(userId, day),
  ]);

  if (dueToday > 0) {
    await notify(userId, {
      type: 'reviews-due',
      title: `Você tem ${dueToday} ${dueToday === 1 ? 'revisão' : 'revisões'} para hoje.`,
      link: '/revisoes',
      dedupeKey: `reviews-due:${day}`,
    });
  }

  if (overdue.length > 0 && overdue.length <= 3) {
    for (const r of overdue) {
      await notify(userId, {
        type: 'review-overdue',
        title: `A revisão de ${r.subject.name} está atrasada.`,
        body: `Estava prevista para ${fromDb(r.scheduledFor).split('-').reverse().join('/')}.`,
        link: '/revisoes',
        dedupeKey: `overdue:${r.id}:${fromDb(r.scheduledFor)}`,
      });
    }
  } else if (overdue.length > 3) {
    await notify(userId, {
      type: 'review-overdue',
      title: `Você tem ${overdue.length}${overdue.length === 20 ? '+' : ''} revisões atrasadas.`,
      body: 'Que tal começar pelas mais antigas? Você também pode redistribuí-las no calendário.',
      link: '/revisoes',
      dedupeKey: `overdue-count:${day}`,
    });
  }

  for (const m of plannedMocks) {
    const when = fromDb(m.takenOn) === day ? 'hoje' : fromDb(m.takenOn) === addDays(day, 1) ? 'amanhã' : 'em 2 dias';
    await notify(userId, {
      type: 'mock-scheduled',
      title: `Simulado agendado para ${when}: ${m.name}.`,
      link: '/simulados',
      dedupeKey: `mock:${m.id}:${fromDb(m.takenOn)}`,
    });
  }

  const milestone = [...STREAK_MILESTONES].reverse().find((n) => streak.days >= n);
  if (milestone && streak.startedOn) {
    await notify(userId, {
      type: 'streak',
      title: `🔥 ${milestone} dias seguidos estudando!`,
      body: 'Constância é o que mais pesa na preparação. Continue assim.',
      link: '/metricas',
      dedupeKey: `streak:${milestone}:${streak.startedOn}`,
    });
  }
}

/** Executa o gerador para todos os usuários (job periódico). */
export async function runNotificationJob() {
  let cursor: string | undefined;
  for (;;) {
    const users = await prisma.user.findMany({
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 200,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (!users.length) break;
    for (const u of users) {
      try {
        await generateNotifications(u.id);
      } catch (err) {
        console.error('Falha ao gerar notificações para', u.id, err);
      }
    }
    cursor = users[users.length - 1].id;
  }
}
