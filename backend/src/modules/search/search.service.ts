import { prisma } from '../../lib/prisma.js';
import { fromDb } from '../../lib/dates.js';
import { percent } from '../../lib/math.js';
import { getAreaMap } from '../taxonomy/taxonomy.service.js';

// Pesquisa global nos dados do próprio usuário.
export async function globalSearch(userId: string, rawQuery: string, today: string) {
  const q = rawQuery.trim();
  if (q.length < 2) return { query: q, areas: [], subjects: [], mockExams: [], exams: [], goals: [] };
  const contains = { contains: q, mode: 'insensitive' as const };

  const [areaMap, areas, subjects, mockExams, exams, goals] = await Promise.all([
    getAreaMap(userId),
    prisma.area.findMany({ where: { userId, name: contains }, take: 10 }),
    prisma.subject.findMany({ where: { userId, OR: [{ name: contains }, { tags: { has: q.toLowerCase() } }] }, take: 20 }),
    prisma.mockExam.findMany({
      where: { userId, OR: [{ name: contains }, { board: contains }, { examName: contains }] },
      orderBy: { takenOn: 'desc' },
      take: 10,
    }),
    prisma.exam.findMany({
      where: { userId, OR: [{ name: contains }, { board: { name: contains } }] },
      include: { board: true, _count: { select: { attempts: true } } },
      take: 10,
    }),
    prisma.goal.findMany({ where: { userId, OR: [{ title: contains }, { description: contains }] }, take: 10 }),
  ]);

  const subjectIds = subjects.map((s) => s.id);
  const [qStats, reviewsDone, pending, simulados] = await Promise.all([
    prisma.questionSession.groupBy({ by: ['subjectId'], where: { userId, subjectId: { in: subjectIds } }, _sum: { total: true, correct: true } }),
    prisma.review.groupBy({ by: ['subjectId'], where: { userId, status: 'DONE', subjectId: { in: subjectIds } }, _count: { _all: true } }),
    prisma.review.findMany({ where: { userId, status: 'PENDING', subjectId: { in: subjectIds } }, select: { subjectId: true, scheduledFor: true } }),
    prisma.studySession.groupBy({
      by: ['subjectId'],
      where: { userId, subjectId: { in: subjectIds }, methods: { has: 'SIMULADO' } },
      _count: { _all: true },
    }),
  ]);
  const qBy = new Map(qStats.map((s) => [s.subjectId, s._sum]));
  const rBy = new Map(reviewsDone.map((s) => [s.subjectId, s._count._all]));
  const pBy = new Map(pending.map((p) => [p.subjectId, fromDb(p.scheduledFor)]));
  const sBy = new Map(simulados.map((s) => [s.subjectId, s._count._all]));

  const areaSubjectCounts = await prisma.subject.groupBy({
    by: ['areaId'],
    where: { userId, areaId: { in: areas.map((a) => a.id) } },
    _count: { _all: true },
  });

  return {
    query: q,
    areas: areas.map((a) => ({
      id: a.id,
      name: a.name,
      path: areaMap.get(a.id)?.path ?? a.name,
      subjects: areaSubjectCounts.find((c) => c.areaId === a.id)?._count._all ?? 0,
    })),
    subjects: subjects.map((s) => {
      const st = qBy.get(s.id);
      const nextReview = pBy.get(s.id) ?? null;
      return {
        id: s.id,
        name: s.name,
        area: areaMap.get(s.areaId) ?? null,
        reviewsDone: rBy.get(s.id) ?? 0,
        simulados: sBy.get(s.id) ?? 0,
        questions: st?.total ?? 0,
        accuracy: percent(st?.correct ?? 0, st?.total ?? 0),
        nextReview,
        overdue: nextReview !== null && nextReview < today,
      };
    }),
    mockExams: mockExams.map((m) => ({ id: m.id, name: m.name, board: m.board, takenOn: fromDb(m.takenOn), accuracy: m.accuracy, status: m.status })),
    exams: exams.map((e) => ({ id: e.id, name: e.name, board: e.board.name, year: e.year, attempts: e._count.attempts })),
    goals: goals.map((g) => ({ id: g.id, title: g.title, status: g.status })),
  };
}

