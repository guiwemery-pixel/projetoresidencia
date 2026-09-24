import type { User } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

/** Dados do próprio usuário (nunca inclui o hash da senha). */
export function toPrivateUser(user: User) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatar: user.avatar,
    timezone: user.timezone,
    domain: user.domain,
    shareProgress: user.shareProgress,
    weeklyStudyHoursTarget: user.weeklyStudyHoursTarget,
    weeklyStudyDaysTarget: user.weeklyStudyDaysTarget,
    dailyQuestionsTarget: user.dailyQuestionsTarget,
    dashboardLayout: user.dashboardLayout,
    createdAt: user.createdAt,
  };
}

export async function getSettings(userId: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      timezone: true,
      weeklyStudyHoursTarget: true,
      weeklyStudyDaysTarget: true,
      dailyQuestionsTarget: true,
      shareProgress: true,
    },
  });
}

/** Exporta todos os dados do usuário (portabilidade — LGPD art. 18). */
export async function exportUserData(userId: string) {
  const [user, areas, subjects, studySessions, questionSessions, learningStates, reviews, goals, mockExams, boards, exams, examAttempts] =
    await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      prisma.area.findMany({ where: { userId } }),
      prisma.subject.findMany({ where: { userId } }),
      prisma.studySession.findMany({ where: { userId } }),
      prisma.questionSession.findMany({ where: { userId } }),
      prisma.learningState.findMany({ where: { userId } }),
      prisma.review.findMany({ where: { userId } }),
      prisma.goal.findMany({ where: { userId } }),
      prisma.mockExam.findMany({ where: { userId }, include: { areaResults: true } }),
      prisma.board.findMany({ where: { userId } }),
      prisma.exam.findMany({ where: { userId } }),
      prisma.examAttempt.findMany({ where: { userId } }),
    ]);
  return {
    exportedAt: new Date().toISOString(),
    user: toPrivateUser(user),
    areas,
    subjects,
    studySessions,
    questionSessions,
    learningStates,
    reviews,
    goals,
    mockExams,
    boards,
    exams,
    examAttempts,
  };
}
