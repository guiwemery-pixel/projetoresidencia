import type { User } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { readExplanation } from '../reviews/explanation-codec.js';
import { TEMPLATES, applyTemplate, type TemplateKey } from '../taxonomy/templates/index.js';

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
    reviews: reviews.map(({ explanationPacked, ...r }) => ({ ...r, explanation: readExplanation({ ...r, explanationPacked }) })),
    goals,
    mockExams,
    boards,
    exams,
    examAttempts,
  };
}

/**
 * Recomeçar do zero sem excluir a conta.
 * - "progress": apaga estudos, questões, revisões, simulados, resultados de
 *   provas e notificações; mantém áreas, assuntos, banco de provas e metas
 *   (as metas voltam a ficar ativas, sem progresso).
 * - "everything": apaga também áreas, assuntos, metas e o banco de provas e
 *   recria a estrutura inicial do modelo escolhido no cadastro.
 * Conta, grupos, sessões e preferências continuam como estão.
 */
export async function resetProgress(userId: string, scope: 'progress' | 'everything') {
  return prisma.$transaction(
    async (tx) => {
      const where = { userId };
      const [studies, questions, mocks, attempts] = await Promise.all([
        tx.studySession.count({ where }),
        tx.questionSession.count({ where }),
        tx.mockExam.count({ where }),
        tx.examAttempt.count({ where }),
      ]);
      await tx.review.deleteMany({ where });
      await tx.questionSession.deleteMany({ where });
      await tx.studySession.deleteMany({ where });
      await tx.learningState.deleteMany({ where });
      await tx.mockExam.deleteMany({ where });
      await tx.examAttempt.deleteMany({ where });
      await tx.notification.deleteMany({ where });
      if (scope === 'everything') {
        await tx.goal.deleteMany({ where });
        await tx.exam.deleteMany({ where });
        await tx.board.deleteMany({ where });
        await tx.subject.deleteMany({ where });
        await tx.area.deleteMany({ where: { userId, parentId: { not: null } } });
        await tx.area.deleteMany({ where });
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { domain: true } });
        if (user.domain in TEMPLATES) await applyTemplate(tx, userId, user.domain as TemplateKey);
      } else {
        await tx.goal.updateMany({ where: { userId, status: { in: ['COMPLETED', 'EXPIRED'] } }, data: { status: 'ACTIVE', completedAt: null } });
        await tx.goal.updateMany({ where, data: { manualProgress: 0 } });
      }
      return { scope, studies, questions, mocks, attempts };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}
