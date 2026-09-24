import { prisma } from '../../lib/prisma.js';
import { addDays, fromDb, toDb } from '../../lib/dates.js';
import { sum } from '../../lib/math.js';
import { reviewAgenda } from '../reviews/reviews.service.js';
import { listGoals } from '../goals/goals.service.js';
import { listStudies } from '../studies/studies.service.js';
import { computeProgress } from '../progress/progress.service.js';
import { computeInsights } from '../insights/insights.service.js';
import { overview } from '../metrics/metrics.service.js';
import { generateNotifications } from '../notifications/notifications.service.js';
import { tidyUpUser } from '../maintenance/maintenance.service.js';

export async function dashboard(userId: string, today: string) {
  // Notificações de rotina e faxina do banco rodam de forma preguiçosa ao abrir o app
  await Promise.all([
    generateNotifications(userId, today).catch((err) => console.error(err)),
    tidyUpUser(userId).catch((err) => console.error(err)),
  ]);

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { dailyQuestionsTarget: true, weeklyStudyHoursTarget: true, weeklyStudyDaysTarget: true },
  });
  const [agenda, goals, recent, progress, insights, week, mocks, todayQuestions] = await Promise.all([
    reviewAgenda(userId, today, 7),
    listGoals(userId, today, { status: 'active' }),
    listStudies(userId, { limit: 5 }),
    computeProgress(userId, today),
    computeInsights(userId, today),
    overview(userId, addDays(today, -6), today, today),
    prisma.mockExam.findMany({
      where: { userId, status: 'PLANNED', takenOn: { gte: toDb(today), lte: toDb(addDays(today, 14)) } },
      orderBy: { takenOn: 'asc' },
    }),
    prisma.questionSession.aggregate({ where: { userId, doneOn: toDb(today) }, _sum: { total: true } }),
  ]);

  const goalsToday = goals.filter((g) => g.period === 'DAILY' || (g.dueDate !== null && g.dueDate === today));
  const reviewQuestions = sum([...agenda.today, ...agenda.overdue].map((r) => r.suggestedQuestions ?? 0));
  const plannedQuestions = Math.max(reviewQuestions, user.dailyQuestionsTarget);

  const upcomingByDay = new Map<string, { date: string; reviews: number; subjects: string[] }>();
  for (const r of agenda.upcoming) {
    const d = upcomingByDay.get(r.scheduledFor) ?? { date: r.scheduledFor, reviews: 0, subjects: [] };
    d.reviews++;
    if (d.subjects.length < 4) d.subjects.push(r.subject.name);
    upcomingByDay.set(r.scheduledFor, d);
  }

  const comparisons = [...insights.comparisons];
  if (progress.goalsCompletionPercent !== null) {
    comparisons.push({
      id: 'cmp-goals',
      kind: progress.goalsCompletionPercent >= 70 ? 'positive' : 'info',
      text: `Você completou ${progress.goalsCompletionPercent}% das suas metas.`,
    });
  }

  return {
    today,
    summary: {
      reviewsToday: agenda.today.length,
      overdue: agenda.overdue.length,
      plannedQuestions,
      questionsDoneToday: todayQuestions._sum.total ?? 0,
      goalsToday: goalsToday.length,
    },
    reviews: { today: agenda.today, overdue: agenda.overdue },
    goalsToday,
    goals: goals.slice(0, 6),
    recentStudies: recent,
    upcoming: {
      reviewsByDay: [...upcomingByDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
      mockExams: mocks.map((m) => ({ id: m.id, name: m.name, date: fromDb(m.takenOn) })),
      goalsDue: goals.filter((g) => g.period === 'CUSTOM' && g.dueDate && g.daysLeft >= 0 && g.daysLeft <= 7),
    },
    week: {
      hours: week.studies.hours,
      targetHours: user.weeklyStudyHoursTarget,
      daysStudied: week.studies.daysStudied,
      targetDays: user.weeklyStudyDaysTarget,
      questions: week.questions.total,
      accuracy: week.questions.accuracy,
      reviewsDone: week.reviews.done,
      streak: week.studies.currentStreak,
    },
    progress,
    insights: insights.insights,
    comparisons,
  };
}
