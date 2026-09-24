import type { Prisma, StudyMethod, SubjectSize } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { fromDb, toDb } from '../../lib/dates.js';
import { round } from '../../lib/math.js';
import { areaWithDescendants, createSubject, findOwnedSubject, getAreaMap } from '../taxonomy/taxonomy.service.js';
import { processContact, rebuildSubject, type ContactOutcome } from '../reviews/learning.service.js';
import { getSchedulerConfig } from '../reviews/algorithm-config.js';
import { reviewPlan, suggestedQuestions } from '../scheduler/index.js';
import { notify } from '../notifications/notifications.service.js';
import { refreshGoals } from '../goals/goals.service.js';

export interface QuestionInput {
  total: number;
  correct: number;
  board?: string | null;
  examName?: string | null;
  difficulty?: number | null;
  timeSpentMinutes?: number | null;
  notes?: string | null;
}

export interface StudyInput {
  subjectId?: string;
  newSubject?: { areaId: string; name: string; size?: SubjectSize };
  date: string;
  durationMinutes: number;
  methods: StudyMethod[];
  quality?: number | null;
  difficulty?: number | null;
  notes?: string | null;
  questions?: QuestionInput | null;
}

const DROP_ALERT_POINTS = 15;

function questionData(userId: string, subjectId: string, date: string, q: QuestionInput) {
  if (q.correct > q.total) throw badRequest('Acertos não podem ser maiores que o total de questões');
  return {
    userId,
    subjectId,
    doneOn: toDb(date),
    total: q.total,
    correct: q.correct,
    wrong: q.total - q.correct,
    accuracy: round((q.correct / q.total) * 100, 2),
    board: q.board ?? null,
    examName: q.examName ?? null,
    difficulty: q.difficulty ?? null,
    timeSpentMinutes: q.timeSpentMinutes ?? null,
    notes: q.notes ?? null,
  };
}

function scheduleView(outcome: ContactOutcome) {
  const r = outcome.result;
  if (!r) return null;
  return {
    reviewId: outcome.nextReview?.id ?? null,
    dueOn: r.dueOn,
    intervalDays: r.intervalDays,
    stageLabel: r.stageLabel,
    checkup: r.checkup,
    phase: r.phase,
    band: r.band,
    score: r.score,
    accuracy: r.accuracy,
    suggestTheory: r.suggestTheory,
    suggestedMethods: r.suggestedMethods,
    suggestedQuestions: r.suggestedQuestions,
    explanation: r.explanation,
  };
}

async function afterContact(userId: string, subjectId: string, subjectName: string, date: string, outcome: ContactOutcome, today: string) {
  const score = outcome.result?.score ?? null;
  if (score !== null && outcome.previousScore !== null && outcome.previousScore - score >= DROP_ALERT_POINTS) {
    await notify(userId, {
      type: 'performance-drop',
      title: `Seu desempenho em ${subjectName} caiu de ${Math.round(outcome.previousScore)}% para ${Math.round(score)}%.`,
      body: 'O intervalo até a próxima revisão foi reduzido automaticamente.',
      link: `/assuntos/${subjectId}`,
      dedupeKey: `drop:${subjectId}:${date}`,
    });
  }
  await refreshGoals(userId, today);
}

export async function createStudy(userId: string, input: StudyInput, today: string) {
  if (input.date > today) throw badRequest('A data do estudo não pode estar no futuro');
  if (!input.methods.length) throw badRequest('Escolha pelo menos um tipo de estudo');

  let subjectId = input.subjectId;
  if (!subjectId && input.newSubject) {
    subjectId = (await createSubject(userId, input.newSubject)).id;
  }
  if (!subjectId) throw badRequest('Escolha ou crie um assunto');
  const subject = await findOwnedSubject(userId, subjectId);

  const { session, outcome, isFirstContact } = await prisma.$transaction(async (tx) => {
    const earlier = await tx.studySession.count({ where: { userId, subjectId, studiedOn: { lt: toDb(input.date) } } });
    const session = await tx.studySession.create({
      data: {
        userId,
        subjectId: subject.id,
        studiedOn: toDb(input.date),
        durationMinutes: input.durationMinutes,
        methods: input.methods,
        quality: input.quality ?? null,
        difficulty: input.difficulty ?? null,
        notes: input.notes ?? null,
        isFirstContact: earlier === 0,
      },
    });
    if (input.questions && input.questions.total > 0) {
      await tx.questionSession.create({
        data: { ...questionData(userId, subject.id, input.date, input.questions), studySessionId: session.id },
      });
    }
    if (subject.archived) await tx.subject.update({ where: { id: subject.id }, data: { archived: false } });
    const outcome = await processContact(tx, userId, subject.id, input.date);
    return { session, outcome, isFirstContact: earlier === 0 };
  });

  await afterContact(userId, subject.id, subject.name, input.date, outcome, today);
  return {
    session: await getStudy(userId, session.id),
    isFirstContact,
    completedReviewId: outcome.completedReviewId,
    schedule: scheduleView(outcome),
  };
}

export async function updateStudy(userId: string, id: string, input: Partial<StudyInput>, today: string) {
  const existing = await prisma.studySession.findFirst({ where: { id, userId }, include: { questionSessions: true } });
  if (!existing) throw notFound('Registro de estudo não encontrado');
  if (input.date && input.date > today) throw badRequest('A data do estudo não pode estar no futuro');
  const newSubjectId = input.subjectId ?? existing.subjectId;
  if (newSubjectId !== existing.subjectId) await findOwnedSubject(userId, newSubjectId);
  const date = input.date ?? fromDb(existing.studiedOn);

  const outcome = await prisma.$transaction(async (tx) => {
    await tx.studySession.update({
      where: { id },
      data: {
        subjectId: newSubjectId,
        studiedOn: toDb(date),
        durationMinutes: input.durationMinutes,
        methods: input.methods,
        quality: input.quality,
        difficulty: input.difficulty,
        notes: input.notes,
      },
    });
    if (input.questions !== undefined) {
      await tx.questionSession.deleteMany({ where: { studySessionId: id, userId } });
      if (input.questions && input.questions.total > 0) {
        await tx.questionSession.create({
          data: { ...questionData(userId, newSubjectId, date, input.questions), studySessionId: id },
        });
      }
    } else {
      await tx.questionSession.updateMany({
        where: { studySessionId: id, userId },
        data: { subjectId: newSubjectId, doneOn: toDb(date) },
      });
    }
    if (newSubjectId !== existing.subjectId) await rebuildSubject(tx, userId, existing.subjectId);
    return rebuildSubject(tx, userId, newSubjectId);
  });
  await refreshGoals(userId, today);
  return { session: await getStudy(userId, id), schedule: scheduleView(outcome) };
}

export async function deleteStudy(userId: string, id: string, today: string) {
  const existing = await prisma.studySession.findFirst({ where: { id, userId } });
  if (!existing) throw notFound('Registro de estudo não encontrado');
  await prisma.$transaction(async (tx) => {
    await tx.studySession.delete({ where: { id } });
    await rebuildSubject(tx, userId, existing.subjectId);
  });
  await refreshGoals(userId, today);
}

const studyInclude = {
  subject: { select: { id: true, name: true, areaId: true } },
  questionSessions: true,
} satisfies Prisma.StudySessionInclude;

type StudyRow = Prisma.StudySessionGetPayload<{ include: typeof studyInclude }>;

function serializeStudy(s: StudyRow, areaMap: Awaited<ReturnType<typeof getAreaMap>>) {
  const q = s.questionSessions[0];
  return {
    id: s.id,
    date: fromDb(s.studiedOn),
    durationMinutes: s.durationMinutes,
    methods: s.methods,
    quality: s.quality,
    difficulty: s.difficulty,
    notes: s.notes,
    isFirstContact: s.isFirstContact,
    createdAt: s.createdAt,
    subject: { id: s.subject.id, name: s.subject.name, area: areaMap.get(s.subject.areaId) ?? null },
    questions: q
      ? {
          total: q.total,
          correct: q.correct,
          wrong: q.wrong,
          accuracy: q.accuracy,
          board: q.board,
          examName: q.examName,
          difficulty: q.difficulty,
          timeSpentMinutes: q.timeSpentMinutes,
          notes: q.notes,
        }
      : null,
  };
}

export async function getStudy(userId: string, id: string) {
  const [s, areaMap] = await Promise.all([
    prisma.studySession.findFirst({ where: { id, userId }, include: studyInclude }),
    getAreaMap(userId),
  ]);
  if (!s) throw notFound('Registro de estudo não encontrado');
  return serializeStudy(s, areaMap);
}

export async function listStudies(
  userId: string,
  opts: { from?: string; to?: string; subjectId?: string; areaId?: string; limit?: number },
) {
  const where: Prisma.StudySessionWhereInput = { userId };
  if (opts.subjectId) where.subjectId = opts.subjectId;
  if (opts.areaId) where.subject = { areaId: { in: await areaWithDescendants(userId, opts.areaId) } };
  if (opts.from || opts.to) {
    where.studiedOn = { ...(opts.from ? { gte: toDb(opts.from) } : {}), ...(opts.to ? { lte: toDb(opts.to) } : {}) };
  }
  const [rows, areaMap] = await Promise.all([
    prisma.studySession.findMany({
      where,
      include: studyInclude,
      orderBy: [{ studiedOn: 'desc' }, { createdAt: 'desc' }],
      take: Math.min(opts.limit ?? 50, 500),
    }),
    getAreaMap(userId),
  ]);
  return rows.map((s) => serializeStudy(s, areaMap));
}

/** Sugestão para o próximo estudo de um assunto (quantidade de questões e métodos). */
export async function studySuggestion(userId: string, subjectId: string) {
  const subject = await findOwnedSubject(userId, subjectId);
  const config = await getSchedulerConfig();
  const [state, pending] = await Promise.all([
    prisma.learningState.findUnique({ where: { subjectId } }),
    prisma.review.findFirst({ where: { userId, subjectId, status: 'PENDING' }, orderBy: { scheduledFor: 'asc' } }),
  ]);
  if (!state) {
    return {
      isNew: true,
      stageLabel: 'D0',
      phase: 'Aprender',
      methods: config.theoryMethods,
      questions: suggestedQuestions(0, subject.size, true, config),
      pendingReview: null,
    };
  }
  const plan = reviewPlan(
    pending?.stage ?? state.stage,
    subject.size,
    { theory: pending?.suggestTheory ?? false, checkup: pending?.checkup ?? false },
    config,
  );
  return {
    isNew: false,
    checkup: pending?.checkup ?? false,
    stageLabel: plan.label,
    phase: plan.phase,
    methods: plan.methods,
    questions: plan.questions,
    pendingReview: pending ? { id: pending.id, scheduledFor: fromDb(pending.scheduledFor) } : null,
  };
}
