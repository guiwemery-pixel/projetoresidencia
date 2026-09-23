import type { MockExamStatus, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { fromDb, toDb } from '../../lib/dates.js';
import { percent } from '../../lib/math.js';
import { findOwnedArea, getAreaMap } from '../taxonomy/taxonomy.service.js';

export interface MockExamInput {
  name: string;
  board?: string | null;
  examName?: string | null;
  year?: number | null;
  takenOn: string;
  status?: MockExamStatus;
  totalQuestions?: number | null;
  correct?: number | null;
  durationMinutes?: number | null;
  notes?: string | null;
  examId?: string | null;
  areaResults?: { areaId: string; total: number; correct: number }[];
}

async function validate(userId: string, input: Partial<MockExamInput>, today: string) {
  const status = input.status ?? 'DONE';
  if (status === 'DONE') {
    if (input.takenOn && input.takenOn > today) throw badRequest('Simulado realizado não pode ter data futura');
    if (input.totalQuestions != null && input.correct != null && input.correct > input.totalQuestions) {
      throw badRequest('Acertos não podem ser maiores que o número de questões');
    }
  }
  if (input.examId) {
    const exam = await prisma.exam.findFirst({ where: { id: input.examId, userId } });
    if (!exam) throw notFound('Prova não encontrada');
  }
  for (const r of input.areaResults ?? []) {
    await findOwnedArea(userId, r.areaId);
    if (r.correct > r.total) throw badRequest('Acertos por área não podem ser maiores que o total');
  }
}

function data(input: Partial<MockExamInput>) {
  const total = input.totalQuestions ?? null;
  const correct = input.correct ?? null;
  return {
    name: input.name,
    board: input.board,
    examName: input.examName,
    year: input.year,
    takenOn: input.takenOn ? toDb(input.takenOn) : undefined,
    status: input.status,
    totalQuestions: input.totalQuestions,
    correct: input.correct,
    accuracy: input.totalQuestions !== undefined || input.correct !== undefined ? (total && correct !== null ? percent(correct, total) : null) : undefined,
    durationMinutes: input.durationMinutes,
    notes: input.notes,
    examId: input.examId,
  };
}

export async function createMockExam(userId: string, input: MockExamInput, today: string) {
  await validate(userId, input, today);
  const mock = await prisma.mockExam.create({
    data: {
      ...(data(input) as Prisma.MockExamUncheckedCreateInput),
      userId,
      name: input.name,
      takenOn: toDb(input.takenOn),
      areaResults: input.areaResults?.length ? { create: input.areaResults } : undefined,
    },
  });
  return getMockExam(userId, mock.id);
}

export async function updateMockExam(userId: string, id: string, input: Partial<MockExamInput>, today: string) {
  const existing = await prisma.mockExam.findFirst({ where: { id, userId } });
  if (!existing) throw notFound('Simulado não encontrado');
  await validate(userId, { ...input, status: input.status ?? existing.status }, today);
  const merged = {
    totalQuestions: input.totalQuestions !== undefined ? input.totalQuestions : existing.totalQuestions,
    correct: input.correct !== undefined ? input.correct : existing.correct,
  };
  await prisma.$transaction(async (tx) => {
    await tx.mockExam.update({ where: { id }, data: { ...data({ ...input, ...merged }) } });
    if (input.areaResults) {
      await tx.mockExamAreaResult.deleteMany({ where: { mockExamId: id } });
      if (input.areaResults.length) {
        await tx.mockExamAreaResult.createMany({ data: input.areaResults.map((r) => ({ ...r, mockExamId: id })) });
      }
    }
  });
  return getMockExam(userId, id);
}

export async function deleteMockExam(userId: string, id: string) {
  const existing = await prisma.mockExam.findFirst({ where: { id, userId } });
  if (!existing) throw notFound('Simulado não encontrado');
  await prisma.mockExam.delete({ where: { id } });
}

type MockRow = Prisma.MockExamGetPayload<{ include: { areaResults: true } }>;

function serialize(m: MockRow, areaMap: Awaited<ReturnType<typeof getAreaMap>>) {
  return {
    id: m.id,
    name: m.name,
    board: m.board,
    examName: m.examName,
    year: m.year,
    takenOn: fromDb(m.takenOn),
    status: m.status,
    totalQuestions: m.totalQuestions,
    correct: m.correct,
    wrong: m.totalQuestions != null && m.correct != null ? m.totalQuestions - m.correct : null,
    accuracy: m.accuracy,
    durationMinutes: m.durationMinutes,
    notes: m.notes,
    examId: m.examId,
    areaResults: m.areaResults.map((r) => ({
      areaId: r.areaId,
      areaName: areaMap.get(r.areaId)?.path ?? '—',
      color: areaMap.get(r.areaId)?.color ?? null,
      total: r.total,
      correct: r.correct,
      accuracy: percent(r.correct, r.total),
    })),
  };
}

export async function getMockExam(userId: string, id: string) {
  const [m, areaMap] = await Promise.all([
    prisma.mockExam.findFirst({ where: { id, userId }, include: { areaResults: true } }),
    getAreaMap(userId),
  ]);
  if (!m) throw notFound('Simulado não encontrado');
  return serialize(m, areaMap);
}

export async function listMockExams(userId: string) {
  const [rows, areaMap] = await Promise.all([
    prisma.mockExam.findMany({ where: { userId }, include: { areaResults: true }, orderBy: { takenOn: 'desc' } }),
    getAreaMap(userId),
  ]);
  const items = rows.map((m) => serialize(m, areaMap));
  const done = items.filter((m) => m.status === 'DONE' && m.accuracy !== null).reverse();

  // Séries de evolução: por banca/prova (ex.: ENAMED 2023 → 2024 → 2025) e geral
  const series = new Map<string, { key: string; points: { id: string; label: string; date: string; accuracy: number }[] }>();
  for (const m of done) {
    const key = m.board || m.name;
    if (!series.has(key)) series.set(key, { key, points: [] });
    series.get(key)!.points.push({ id: m.id, label: m.year ? `${m.name}` : m.name, date: m.takenOn, accuracy: m.accuracy! });
  }
  return {
    items,
    evolution: done.map((m) => ({ id: m.id, name: m.name, board: m.board, date: m.takenOn, accuracy: m.accuracy! })),
    series: [...series.values()].filter((s) => s.points.length > 0),
    stats: {
      done: done.length,
      planned: items.filter((m) => m.status === 'PLANNED').length,
      avgAccuracy: done.length ? Math.round((done.reduce((s, m) => s + m.accuracy!, 0) / done.length) * 10) / 10 : null,
      best: done.length ? Math.max(...done.map((m) => m.accuracy!)) : null,
      last: done.length ? done[done.length - 1].accuracy : null,
    },
  };
}
