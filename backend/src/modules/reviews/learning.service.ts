import type { LearningState, Prisma, Review, StudyMethod } from '@prisma/client';
import { prisma, type Tx } from '../../lib/prisma.js';
import { fromDb, toDb } from '../../lib/dates.js';
import {
  computeScore,
  accuracyOf,
  diffDays,
  scheduleNext,
  type ContactEvidence,
  type Difficulty,
  type HistoryPoint,
  type LearningSnapshot,
  type Quality,
  type ScheduleResult,
  type SchedulerConfig,
} from '../scheduler/index.js';
import { getSchedulerConfig } from './algorithm-config.js';

// Ponte entre o banco e o motor de revisão (que é puro).
//
// Cada DIA de estudo de um assunto é um "contato". Sessões do mesmo dia são
// agregadas (ex.: teoria de manhã + questões à noite). Cada contato conclui a
// revisão pendente (se houver) e agenda a próxima.
//
// - Caminho rápido: novo contato posterior ao último → aplica um passo.
// - Reconstrução: contato no mesmo dia/retroativo, edição ou exclusão de sessão
//   → reprocessa todo o histórico do assunto (o motor é determinístico).

export interface DayContact {
  date: string;
  lastSessionId: string;
  evidence: ContactEvidence;
}

export interface ContactOutcome {
  result: ScheduleResult | null;
  completedReviewId: string | null;
  nextReview: Review | null;
  previousScore: number | null;
}

type SessionRow = {
  id: string;
  studiedOn: Date;
  methods: StudyMethod[];
  quality: number | null;
  difficulty: number | null;
  questionSessions: { total: number; correct: number }[];
};

export function groupContacts(sessions: SessionRow[]): DayContact[] {
  const byDay = new Map<string, DayContact>();
  for (const s of sessions) {
    const date = fromDb(s.studiedOn);
    let day = byDay.get(date);
    if (!day) {
      day = { date, lastSessionId: s.id, evidence: { date, methods: [], questions: null, quality: null, difficulty: null } };
      byDay.set(date, day);
    }
    day.lastSessionId = s.id;
    const ev = day.evidence;
    for (const m of s.methods) if (!ev.methods.includes(m)) ev.methods.push(m);
    for (const q of s.questionSessions) {
      ev.questions = { total: (ev.questions?.total ?? 0) + q.total, correct: (ev.questions?.correct ?? 0) + q.correct };
    }
    if (s.quality) ev.quality = s.quality as Quality;
    if (s.difficulty) ev.difficulty = s.difficulty as Difficulty;
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function loadContacts(tx: Tx, userId: string, subjectId: string): Promise<DayContact[]> {
  const sessions = await tx.studySession.findMany({
    where: { userId, subjectId },
    orderBy: [{ studiedOn: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      studiedOn: true,
      methods: true,
      quality: true,
      difficulty: true,
      questionSessions: { select: { total: true, correct: true } },
    },
  });
  return groupContacts(sessions);
}

function historyPoint(contact: DayContact, config: SchedulerConfig): HistoryPoint {
  return {
    date: contact.date,
    score: computeScore(contact.evidence, config).score,
    accuracy: accuracyOf(contact.evidence.questions),
  };
}

function snapshot(state: LearningState): LearningSnapshot {
  return {
    stage: state.stage,
    ease: state.ease,
    intervalDays: state.intervalDays,
    lastContactOn: fromDb(state.lastContactOn),
    lastScore: state.lastScore,
    contacts: state.contacts,
    lapses: state.lapses,
  };
}

function pendingReviewData(userId: string, subjectId: string, r: ScheduleResult): Prisma.ReviewUncheckedCreateInput {
  return {
    userId,
    subjectId,
    stage: r.nextState.stage,
    scheduledFor: toDb(r.dueOn),
    intervalDays: r.intervalDays,
    status: 'PENDING',
    suggestedMethods: r.suggestedMethods as StudyMethod[],
    suggestedQuestions: Math.round((r.suggestedQuestions.min + r.suggestedQuestions.max) / 2),
    suggestTheory: r.suggestTheory,
    explanation: r.explanation as unknown as Prisma.InputJsonValue,
  };
}

function completionData(contact: DayContact, r: ScheduleResult, previousContactOn: string) {
  return {
    status: 'DONE' as const,
    completedOn: toDb(contact.date),
    elapsedDays: diffDays(previousContactOn, contact.date),
    performance: r.accuracy,
    quality: contact.evidence.quality,
    score: r.score,
    nextIntervalDays: r.intervalDays,
    studySessionId: contact.lastSessionId,
  };
}

function stateData(userId: string, subjectId: string, s: LearningSnapshot, version: string) {
  return {
    userId,
    subjectId,
    stage: s.stage,
    ease: s.ease,
    intervalDays: s.intervalDays,
    lastContactOn: toDb(s.lastContactOn),
    lastScore: s.lastScore,
    contacts: s.contacts,
    lapses: s.lapses,
    algorithmVersion: version,
  };
}

/** Reprocessa todo o histórico do assunto do zero. */
export async function rebuildSubject(tx: Tx, userId: string, subjectId: string): Promise<ContactOutcome> {
  const config = await getSchedulerConfig();
  const subject = await tx.subject.findFirstOrThrow({ where: { id: subjectId, userId } });
  const contacts = await loadContacts(tx, userId, subjectId);

  await tx.review.deleteMany({ where: { userId, subjectId } });
  if (contacts.length === 0) {
    await tx.learningState.deleteMany({ where: { subjectId, userId } });
    return { result: null, completedReviewId: null, nextReview: null, previousScore: null };
  }

  let state: LearningSnapshot | null = null;
  let pending: ScheduleResult | null = null;
  const history: HistoryPoint[] = [];
  const done: Prisma.ReviewUncheckedCreateInput[] = [];
  let last: ScheduleResult | null = null;
  let previousScore: number | null = null;

  for (const contact of contacts) {
    const result = scheduleNext(
      { state, contact: contact.evidence, history: [...history], scheduledFor: pending?.dueOn ?? null, subjectSize: subject.size },
      config,
    );
    if (state && pending) {
      done.push({ ...pendingReviewData(userId, subjectId, pending), ...completionData(contact, result, state.lastContactOn) });
    }
    previousScore = [...history].reverse().find((h) => h.score !== null)?.score ?? null;
    history.push(historyPoint(contact, config));
    state = result.nextState;
    pending = result;
    last = result;
  }

  if (done.length) await tx.review.createMany({ data: done });
  const nextReview = subject.archived
    ? null
    : await tx.review.create({ data: pendingReviewData(userId, subjectId, last!) });
  const data = stateData(userId, subjectId, state!, config.version);
  await tx.learningState.upsert({ where: { subjectId }, create: data, update: data });

  const lastDone = done.length
    ? await tx.review.findFirst({ where: { userId, subjectId, status: 'DONE' }, orderBy: { completedOn: 'desc' } })
    : null;
  const lastContact = contacts[contacts.length - 1];
  return {
    result: last,
    completedReviewId: lastDone && lastDone.completedOn && fromDb(lastDone.completedOn) === lastContact.date ? lastDone.id : null,
    nextReview,
    previousScore,
  };
}

/**
 * Registra o efeito de um novo contato (dia `date`) sobre o assunto: conclui a
 * revisão pendente e agenda a próxima. Deve ser chamado depois que a sessão de
 * estudo já foi gravada.
 */
export async function processContact(tx: Tx, userId: string, subjectId: string, date: string): Promise<ContactOutcome> {
  const state = await tx.learningState.findUnique({ where: { subjectId } });
  if (state && fromDb(state.lastContactOn) >= date) {
    // Mesmo dia ou lançamento retroativo: reprocessa o histórico
    return rebuildSubject(tx, userId, subjectId);
  }

  const config = await getSchedulerConfig();
  const subject = await tx.subject.findFirstOrThrow({ where: { id: subjectId, userId } });
  const contacts = await loadContacts(tx, userId, subjectId);
  const contact = contacts.find((c) => c.date === date);
  if (!contact) return rebuildSubject(tx, userId, subjectId);

  const history = contacts.filter((c) => c.date < date).map((c) => historyPoint(c, config));
  const pending = await tx.review.findFirst({
    where: { userId, subjectId, status: 'PENDING' },
    orderBy: { scheduledFor: 'asc' },
  });

  const result = scheduleNext(
    {
      state: state ? snapshot(state) : null,
      contact: contact.evidence,
      history,
      scheduledFor: pending ? fromDb(pending.scheduledFor) : null,
      subjectSize: subject.size,
    },
    config,
  );

  let completedReviewId: string | null = null;
  if (pending && state) {
    await tx.review.update({
      where: { id: pending.id },
      data: completionData(contact, result, fromDb(state.lastContactOn)),
    });
    completedReviewId = pending.id;
  }
  await tx.review.deleteMany({
    where: { userId, subjectId, status: 'PENDING', ...(completedReviewId ? { id: { not: completedReviewId } } : {}) },
  });
  const nextReview = subject.archived ? null : await tx.review.create({ data: pendingReviewData(userId, subjectId, result) });
  const data = stateData(userId, subjectId, result.nextState, config.version);
  await tx.learningState.upsert({ where: { subjectId }, create: data, update: data });

  const previousScore = [...history].reverse().find((h) => h.score !== null)?.score ?? null;
  return { result, completedReviewId, nextReview, previousScore };
}

/** Linha do tempo de aprendizagem de um assunto (para a tela do assunto). */
export async function subjectTimeline(userId: string, subjectId: string) {
  const config = await getSchedulerConfig();
  const [contacts, reviews, state] = await Promise.all([
    loadContacts(prisma, userId, subjectId),
    prisma.review.findMany({ where: { userId, subjectId }, orderBy: { scheduledFor: 'asc' } }),
    prisma.learningState.findFirst({ where: { userId, subjectId } }),
  ]);
  return {
    state: state
      ? {
          ...snapshot(state),
          algorithmVersion: state.algorithmVersion,
        }
      : null,
    contacts: contacts.map((c, i) => {
      const { score } = computeScore(c.evidence, config);
      return {
        date: c.date,
        label: i === 0 ? 'D0' : `Contato ${i + 1}`,
        methods: c.evidence.methods,
        questions: c.evidence.questions,
        accuracy: accuracyOf(c.evidence.questions),
        quality: c.evidence.quality,
        difficulty: c.evidence.difficulty,
        score,
      };
    }),
    reviews: reviews.map(serializeReview),
  };
}

export function serializeReview(r: Review) {
  return {
    id: r.id,
    subjectId: r.subjectId,
    stage: r.stage,
    scheduledFor: fromDb(r.scheduledFor),
    originalScheduledOn: r.originalScheduledOn ? fromDb(r.originalScheduledOn) : null,
    intervalDays: r.intervalDays,
    status: r.status,
    completedOn: r.completedOn ? fromDb(r.completedOn) : null,
    elapsedDays: r.elapsedDays,
    performance: r.performance,
    quality: r.quality,
    score: r.score,
    nextIntervalDays: r.nextIntervalDays,
    suggestedMethods: r.suggestedMethods,
    suggestedQuestions: r.suggestedQuestions,
    suggestTheory: r.suggestTheory,
    explanation: r.explanation,
  };
}
