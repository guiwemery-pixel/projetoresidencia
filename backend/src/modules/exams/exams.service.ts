import { prisma } from '../../lib/prisma.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { fromDb, toDb } from '../../lib/dates.js';
import { percent } from '../../lib/math.js';

// Banco de provas: Banca → Prova (ex.: ENAMED → ENAMED 2025) → Tentativas.

export async function listBoards(userId: string) {
  const boards = await prisma.board.findMany({
    where: { userId },
    orderBy: { name: 'asc' },
    include: {
      exams: {
        orderBy: [{ year: 'desc' }, { name: 'asc' }],
        include: { attempts: { orderBy: { takenOn: 'desc' } } },
      },
    },
  });
  return boards.map((b) => ({
    id: b.id,
    name: b.name,
    exams: b.exams.map((e) => {
      const best = e.attempts.length ? Math.max(...e.attempts.map((a) => a.accuracy)) : null;
      return {
        id: e.id,
        boardId: b.id,
        name: e.name,
        year: e.year,
        totalQuestions: e.totalQuestions,
        fileUrl: e.fileUrl,
        notes: e.notes,
        bestAccuracy: best,
        lastAttempt: e.attempts[0] ? serializeAttempt(e.attempts[0]) : null,
        attempts: e.attempts.map(serializeAttempt),
      };
    }),
  }));
}

function serializeAttempt(a: {
  id: string;
  examId: string;
  takenOn: Date;
  totalQuestions: number;
  correct: number;
  accuracy: number;
  durationMinutes: number | null;
  notes: string | null;
}) {
  return {
    id: a.id,
    examId: a.examId,
    takenOn: fromDb(a.takenOn),
    totalQuestions: a.totalQuestions,
    correct: a.correct,
    wrong: a.totalQuestions - a.correct,
    accuracy: a.accuracy,
    durationMinutes: a.durationMinutes,
    notes: a.notes,
  };
}

export async function createBoard(userId: string, name: string) {
  const existing = await prisma.board.findFirst({ where: { userId, name: { equals: name, mode: 'insensitive' } } });
  if (existing) throw conflict('Esta banca já existe', { id: existing.id });
  return prisma.board.create({ data: { userId, name } });
}

async function ownedBoard(userId: string, id: string) {
  const b = await prisma.board.findFirst({ where: { id, userId } });
  if (!b) throw notFound('Banca não encontrada');
  return b;
}

export async function renameBoard(userId: string, id: string, name: string) {
  await ownedBoard(userId, id);
  return prisma.board.update({ where: { id }, data: { name } });
}

export async function deleteBoard(userId: string, id: string) {
  await ownedBoard(userId, id);
  await prisma.board.delete({ where: { id } });
}

export interface ExamInput {
  boardId: string;
  name: string;
  year?: number | null;
  totalQuestions?: number | null;
  fileUrl?: string | null;
  notes?: string | null;
}

async function ownedExam(userId: string, id: string) {
  const e = await prisma.exam.findFirst({ where: { id, userId } });
  if (!e) throw notFound('Prova não encontrada');
  return e;
}

export async function createExam(userId: string, input: ExamInput) {
  await ownedBoard(userId, input.boardId);
  return prisma.exam.create({ data: { ...input, userId } });
}

export async function updateExam(userId: string, id: string, input: Partial<ExamInput>) {
  await ownedExam(userId, id);
  if (input.boardId) await ownedBoard(userId, input.boardId);
  return prisma.exam.update({ where: { id }, data: input });
}

export async function deleteExam(userId: string, id: string) {
  await ownedExam(userId, id);
  await prisma.exam.delete({ where: { id } });
}

export interface AttemptInput {
  takenOn: string;
  totalQuestions: number;
  correct: number;
  durationMinutes?: number | null;
  notes?: string | null;
}

export async function createAttempt(userId: string, examId: string, input: AttemptInput, today: string) {
  await ownedExam(userId, examId);
  if (input.correct > input.totalQuestions) throw badRequest('Acertos não podem ser maiores que o total');
  if (input.takenOn > today) throw badRequest('A data não pode estar no futuro');
  const a = await prisma.examAttempt.create({
    data: {
      userId,
      examId,
      takenOn: toDb(input.takenOn),
      totalQuestions: input.totalQuestions,
      correct: input.correct,
      accuracy: percent(input.correct, input.totalQuestions) ?? 0,
      durationMinutes: input.durationMinutes ?? null,
      notes: input.notes ?? null,
    },
  });
  return serializeAttempt(a);
}

export async function deleteAttempt(userId: string, id: string) {
  const a = await prisma.examAttempt.findFirst({ where: { id, userId } });
  if (!a) throw notFound('Tentativa não encontrada');
  await prisma.examAttempt.delete({ where: { id } });
}
