import type { StudyMethod } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { addDays, diffDays, eachDay, fromDb, startOfMonth, startOfWeek, toDb } from '../../lib/dates.js';
import { percent, round, sum } from '../../lib/math.js';
import { getAreaMap, areaWithDescendants } from '../taxonomy/taxonomy.service.js';
import { currentStreak } from '../notifications/notifications.service.js';

// Métricas detalhadas — SEMPRE do próprio usuário. Nada daqui é exposto ao grupo
// (o grupo recebe apenas o resumo de progress/public-summary.ts).

export type Granularity = 'day' | 'week' | 'month';

export async function loadActivity(userId: string, from: string, to: string) {
  const range = { gte: toDb(from), lte: toDb(to) };
  const [sessions, questions, mocks, attempts, reviewsDone] = await Promise.all([
    prisma.studySession.findMany({
      where: { userId, studiedOn: range },
      select: { id: true, subjectId: true, studiedOn: true, durationMinutes: true, methods: true, subject: { select: { areaId: true } } },
    }),
    prisma.questionSession.findMany({
      where: { userId, doneOn: range },
      select: { subjectId: true, doneOn: true, total: true, correct: true, subject: { select: { areaId: true } } },
    }),
    prisma.mockExam.findMany({
      where: { userId, status: 'DONE', takenOn: range },
      select: { takenOn: true, totalQuestions: true, correct: true, areaResults: true },
    }),
    prisma.examAttempt.findMany({ where: { userId, takenOn: range }, select: { takenOn: true, totalQuestions: true, correct: true } }),
    prisma.review.findMany({
      where: { userId, status: 'DONE', completedOn: range },
      select: { subjectId: true, completedOn: true, scheduledFor: true, performance: true, score: true },
    }),
  ]);
  return { sessions, questions, mocks, attempts, reviewsDone };
}

type Activity = Awaited<ReturnType<typeof loadActivity>>;

function questionTotals(a: Activity) {
  const fromSessions = { total: sum(a.questions.map((q) => q.total)), correct: sum(a.questions.map((q) => q.correct)) };
  const fromMocks = {
    total: sum(a.mocks.map((m) => m.totalQuestions ?? 0)),
    correct: sum(a.mocks.map((m) => m.correct ?? 0)),
  };
  const fromExams = { total: sum(a.attempts.map((x) => x.totalQuestions)), correct: sum(a.attempts.map((x) => x.correct)) };
  const total = fromSessions.total + fromMocks.total + fromExams.total;
  const correct = fromSessions.correct + fromMocks.correct + fromExams.correct;
  return { total, correct, wrong: total - correct, accuracy: percent(correct, total), bySource: { sessions: fromSessions, mocks: fromMocks, exams: fromExams } };
}

function bestStreak(days: Set<string>, from: string, to: string) {
  let best = 0;
  let run = 0;
  for (const d of eachDay(from, to)) {
    run = days.has(d) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

export async function reviewStatus(userId: string, today: string, from?: string) {
  const [pending, overdue, dueDone, dueOverdue] = await Promise.all([
    prisma.review.count({ where: { userId, status: 'PENDING' } }),
    prisma.review.count({ where: { userId, status: 'PENDING', scheduledFor: { lt: toDb(today) } } }),
    from
      ? prisma.review.findMany({
          where: { userId, status: 'DONE', scheduledFor: { gte: toDb(from), lt: toDb(today) } },
          select: { scheduledFor: true, completedOn: true },
        })
      : Promise.resolve([]),
    from
      ? prisma.review.count({ where: { userId, status: 'PENDING', scheduledFor: { gte: toDb(from), lt: toDb(today) } } })
      : Promise.resolve(0),
  ]);
  const onTime = dueDone.filter((r) => r.completedOn && diffDays(fromDb(r.scheduledFor), fromDb(r.completedOn)) <= 1).length;
  const dueTotal = dueDone.length + dueOverdue;
  return {
    pending,
    overdue,
    dueInPeriod: dueTotal,
    completedOfDue: dueDone.length,
    onTime,
    late: dueDone.length - onTime,
    completionRate: percent(dueDone.length, dueTotal),
    onTimeRate: percent(onTime, dueTotal),
  };
}

export async function overview(userId: string, from: string, to: string, today: string) {
  const [a, streak, reviews] = await Promise.all([
    loadActivity(userId, from, to),
    currentStreak(userId, today),
    reviewStatus(userId, today, from),
  ]);
  const days = new Set(a.sessions.map((s) => fromDb(s.studiedOn)));
  const minutes = sum(a.sessions.map((s) => s.durationMinutes));
  const periodDays = diffDays(from, to) + 1;
  const methodCount: Partial<Record<StudyMethod, number>> = {};
  for (const s of a.sessions) for (const m of s.methods) methodCount[m] = (methodCount[m] ?? 0) + 1;
  const q = questionTotals(a);
  const reviewScores = a.reviewsDone.map((r) => r.score ?? r.performance).filter((v): v is number => v !== null);

  return {
    period: { from, to, days: periodDays },
    studies: {
      minutes,
      hours: round(minutes / 60, 1),
      sessions: a.sessions.length,
      daysStudied: days.size,
      avgMinutesPerStudyDay: days.size ? Math.round(minutes / days.size) : 0,
      avgMinutesPerDay: Math.round(minutes / periodDays),
      currentStreak: streak.days,
      bestStreak: bestStreak(days, from, to),
      byMethod: methodCount,
      subjectsStudied: new Set(a.sessions.map((s) => s.subjectId)).size,
    },
    questions: { ...q, perDay: round(q.total / periodDays, 1) },
    reviews: {
      ...reviews,
      done: a.reviewsDone.length,
      avgPerformance: reviewScores.length ? round(sum(reviewScores) / reviewScores.length, 1) : null,
    },
    mocks: {
      count: a.mocks.length,
      avgAccuracy: percent(sum(a.mocks.map((m) => m.correct ?? 0)), sum(a.mocks.map((m) => m.totalQuestions ?? 0))),
    },
  };
}

function bucketKey(date: string, g: Granularity) {
  return g === 'day' ? date : g === 'week' ? startOfWeek(date) : startOfMonth(date);
}

export async function timeseries(userId: string, from: string, to: string, granularity: Granularity) {
  const a = await loadActivity(userId, from, to);
  const buckets = new Map<string, { minutes: number; sessions: number; questions: number; correct: number; reviewsDone: number; days: Set<string> }>();
  for (const d of eachDay(from, to)) {
    const k = bucketKey(d, granularity);
    if (!buckets.has(k)) buckets.set(k, { minutes: 0, sessions: 0, questions: 0, correct: 0, reviewsDone: 0, days: new Set() });
  }
  const at = (date: Date) => buckets.get(bucketKey(fromDb(date), granularity))!;
  for (const s of a.sessions) {
    const b = at(s.studiedOn);
    b.minutes += s.durationMinutes;
    b.sessions++;
    b.days.add(fromDb(s.studiedOn));
  }
  for (const q of a.questions) {
    const b = at(q.doneOn);
    b.questions += q.total;
    b.correct += q.correct;
  }
  for (const m of a.mocks) {
    const b = at(m.takenOn);
    b.questions += m.totalQuestions ?? 0;
    b.correct += m.correct ?? 0;
  }
  for (const x of a.attempts) {
    const b = at(x.takenOn);
    b.questions += x.totalQuestions;
    b.correct += x.correct;
  }
  for (const r of a.reviewsDone) at(r.completedOn!).reviewsDone++;
  return [...buckets.entries()].map(([start, b]) => ({
    start,
    minutes: b.minutes,
    hours: round(b.minutes / 60, 1),
    sessions: b.sessions,
    daysStudied: b.days.size,
    questions: b.questions,
    correct: b.correct,
    accuracy: percent(b.correct, b.questions),
    reviewsDone: b.reviewsDone,
  }));
}

interface AreaAgg {
  questions: number;
  correct: number;
  minutes: number;
  sessions: number;
  subjects: Set<string>;
}

const emptyAgg = (): AreaAgg => ({ questions: 0, correct: 0, minutes: 0, sessions: 0, subjects: new Set() });

function aggregateByArea(a: Activity) {
  const agg = new Map<string, AreaAgg>();
  const get = (id: string) => {
    let v = agg.get(id);
    if (!v) agg.set(id, (v = emptyAgg()));
    return v;
  };
  for (const s of a.sessions) {
    const v = get(s.subject.areaId);
    v.minutes += s.durationMinutes;
    v.sessions++;
    v.subjects.add(s.subjectId);
  }
  for (const q of a.questions) {
    const v = get(q.subject.areaId);
    v.questions += q.total;
    v.correct += q.correct;
  }
  for (const m of a.mocks) {
    for (const r of m.areaResults) {
      const v = get(r.areaId);
      v.questions += r.total;
      v.correct += r.correct;
    }
  }
  return agg;
}

/** Desempenho por área (com subáreas) e variação em relação ao período anterior. */
export async function byArea(userId: string, from: string, to: string) {
  const len = diffDays(from, to) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(len - 1));
  const [cur, prev, areaMap] = await Promise.all([
    loadActivity(userId, from, to),
    loadActivity(userId, prevFrom, prevTo),
    getAreaMap(userId),
  ]);
  const curAgg = aggregateByArea(cur);
  const prevAgg = aggregateByArea(prev);

  const roll = (source: Map<string, AreaAgg>) => {
    const tops = new Map<string, AreaAgg>();
    for (const [areaId, v] of source) {
      const info = areaMap.get(areaId);
      if (!info) continue;
      const t = tops.get(info.topId) ?? emptyAgg();
      t.questions += v.questions;
      t.correct += v.correct;
      t.minutes += v.minutes;
      t.sessions += v.sessions;
      v.subjects.forEach((s) => t.subjects.add(s));
      tops.set(info.topId, t);
    }
    return tops;
  };
  const curTop = roll(curAgg);
  const prevTop = roll(prevAgg);

  const view = (id: string, v: AreaAgg | undefined, p: AreaAgg | undefined) => {
    const accuracy = v ? percent(v.correct, v.questions) : null;
    const prevAccuracy = p ? percent(p.correct, p.questions) : null;
    return {
      id,
      name: areaMap.get(id)?.name ?? '—',
      color: areaMap.get(id)?.color ?? null,
      questions: v?.questions ?? 0,
      correct: v?.correct ?? 0,
      accuracy,
      minutes: v?.minutes ?? 0,
      sessions: v?.sessions ?? 0,
      subjectsStudied: v?.subjects.size ?? 0,
      previousAccuracy: prevAccuracy,
      previousQuestions: p?.questions ?? 0,
      deltaAccuracy: accuracy !== null && prevAccuracy !== null ? round(accuracy - prevAccuracy, 1) : null,
    };
  };

  const topIds = [...new Set([...areaMap.values()].filter((a) => !a.parentId).map((a) => a.id))];
  return {
    period: { from, to },
    previousPeriod: { from: prevFrom, to: prevTo },
    areas: topIds
      .map((id) => ({
        ...view(id, curTop.get(id), prevTop.get(id)),
        children: [...areaMap.values()]
          .filter((c) => c.parentId === id)
          .map((c) => view(c.id, curAgg.get(c.id), prevAgg.get(c.id)))
          .filter((c) => c.questions > 0 || c.minutes > 0),
      }))
      .sort((x, y) => y.questions + y.minutes - (x.questions + x.minutes)),
  };
}

/** Desempenho por assunto no período, com tendência das últimas sessões de questões. */
export async function bySubject(userId: string, from: string, to: string, areaId?: string) {
  const areaIds = areaId ? await areaWithDescendants(userId, areaId) : null;
  const subjectWhere = { userId, ...(areaIds ? { areaId: { in: areaIds } } : {}) };
  const range = { gte: toDb(from), lte: toDb(to) };
  const [subjects, areaMap, qs, ss] = await Promise.all([
    prisma.subject.findMany({
      where: subjectWhere,
      include: { learningState: true, reviews: { where: { status: 'PENDING' }, take: 1, orderBy: { scheduledFor: 'asc' } } },
    }),
    getAreaMap(userId),
    prisma.questionSession.findMany({
      where: { userId, doneOn: range, subject: subjectWhere },
      select: { subjectId: true, doneOn: true, total: true, correct: true },
      orderBy: { doneOn: 'asc' },
    }),
    prisma.studySession.findMany({
      where: { userId, studiedOn: range, subject: subjectWhere },
      select: { subjectId: true, durationMinutes: true, studiedOn: true },
    }),
  ]);
  return subjects
    .map((s) => {
      const q = qs.filter((x) => x.subjectId === s.id);
      const st = ss.filter((x) => x.subjectId === s.id);
      const total = sum(q.map((x) => x.total));
      const correct = sum(q.map((x) => x.correct));
      const recent = q.slice(-3).map((x) => round((x.correct / x.total) * 100, 1));
      const declining = recent.length === 3 && recent[0] > recent[1] && recent[1] > recent[2];
      const improving = recent.length === 3 && recent[0] < recent[1] && recent[1] < recent[2];
      return {
        id: s.id,
        name: s.name,
        area: areaMap.get(s.areaId) ?? null,
        questions: total,
        correct,
        accuracy: percent(correct, total),
        minutes: sum(st.map((x) => x.durationMinutes)),
        sessions: st.length,
        lastStudiedOn: st.length ? fromDb(st.reduce((m, x) => (x.studiedOn > m ? x.studiedOn : m), st[0].studiedOn)) : null,
        recentAccuracy: recent,
        trend: declining ? 'queda' : improving ? 'melhora' : recent.length ? 'estavel' : null,
        stage: s.learningState?.stage ?? null,
        nextReviewOn: s.reviews[0] ? fromDb(s.reviews[0].scheduledFor) : null,
      };
    })
    .filter((s) => s.questions > 0 || s.minutes > 0)
    .sort((a, b) => b.questions - a.questions || b.minutes - a.minutes);
}
