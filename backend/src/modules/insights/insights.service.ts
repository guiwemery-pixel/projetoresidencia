import { prisma } from '../../lib/prisma.js';
import { addDays, fromDb, toDb } from '../../lib/dates.js';
import { percent, round, sum } from '../../lib/math.js';
import { getAreaMap } from '../taxonomy/taxonomy.service.js';
import { loadActivity } from '../metrics/metrics.service.js';
import { computeScore, type Difficulty, type Quality } from '../scheduler/index.js';
import { getSchedulerConfig } from '../reviews/algorithm-config.js';
import { groupContacts } from '../reviews/learning.service.js';

// Recomendações automáticas baseadas nos dados reais do próprio usuário.
// Regras simples e explicáveis; cada uma pode ser ajustada ou substituída por
// um modelo mais sofisticado no futuro sem mudar o contrato da API.

export type InsightKind = 'positive' | 'warning' | 'info';

export interface Insight {
  id: string;
  kind: InsightKind;
  text: string;
  detail?: string;
  action?: { label: string; to?: string; anticipateReviewId?: string };
}

const MIN_AREA_QUESTIONS = 15;
const AREA_DELTA_PP = 8;

export async function computeInsights(userId: string, today: string) {
  const insights: Insight[] = [];
  const comparisons: Insight[] = [];
  const config = await getSchedulerConfig();

  const from7 = addDays(today, -6);
  const prev7From = addDays(today, -13);
  const prev7To = addDays(today, -7);
  const from14 = addDays(today, -13);
  const prevFrom = addDays(today, -41);
  const prevTo = addDays(today, -14);

  const [cur14, prev28, week, prevWeek, areaMap, overdue, loadRows, recentSessions] = await Promise.all([
    loadActivity(userId, from14, today),
    loadActivity(userId, prevFrom, prevTo),
    loadActivity(userId, from7, today),
    loadActivity(userId, prev7From, prev7To),
    getAreaMap(userId),
    prisma.review.count({ where: { userId, status: 'PENDING', scheduledFor: { lt: toDb(today) } } }),
    prisma.review.groupBy({
      by: ['scheduledFor'],
      where: { userId, status: 'PENDING', scheduledFor: { gt: toDb(today), lte: toDb(addDays(today, 14)) } },
      _count: { _all: true },
    }),
    prisma.studySession.findMany({
      where: { userId, studiedOn: { gte: toDb(addDays(today, -120)) } },
      orderBy: [{ studiedOn: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        subjectId: true,
        studiedOn: true,
        methods: true,
        quality: true,
        difficulty: true,
        questionSessions: { select: { total: true, correct: true } },
        subject: { select: { name: true } },
      },
    }),
  ]);

  // ── Por área: queda / melhora / poucas questões ─────────────────────────
  const byTopArea = (a: Awaited<ReturnType<typeof loadActivity>>) => {
    const m = new Map<string, { total: number; correct: number }>();
    for (const q of a.questions) {
      const top = areaMap.get(q.subject.areaId)?.topId;
      if (!top) continue;
      const v = m.get(top) ?? { total: 0, correct: 0 };
      v.total += q.total;
      v.correct += q.correct;
      m.set(top, v);
    }
    return m;
  };
  const curAreas = byTopArea(cur14);
  const prevAreas = byTopArea(prev28);
  const weekAreas = byTopArea(week);
  for (const [areaId, prev] of prevAreas) {
    const name = areaMap.get(areaId)?.name ?? 'uma área';
    const cur = curAreas.get(areaId);
    if (cur && cur.total >= MIN_AREA_QUESTIONS && prev.total >= MIN_AREA_QUESTIONS) {
      const delta = percent(cur.correct, cur.total)! - percent(prev.correct, prev.total)!;
      if (delta <= -AREA_DELTA_PP) {
        insights.push({
          id: `area-drop:${areaId}`,
          kind: 'warning',
          text: `Você está errando mais questões de ${name} do que nas últimas semanas.`,
          detail: `${percent(prev.correct, prev.total)}% → ${percent(cur.correct, cur.total)}% de acertos`,
          action: { label: 'Ver métricas', to: '/metricas' },
        });
      } else if (delta >= AREA_DELTA_PP) {
        insights.push({
          id: `area-up:${areaId}`,
          kind: 'positive',
          text: `Seu desempenho em ${name} melhorou ${round(delta, 0)} pontos percentuais.`,
          detail: `${percent(prev.correct, prev.total)}% → ${percent(cur.correct, cur.total)}% de acertos`,
        });
      }
    }
    // Volume semanal da área bem abaixo da média das 4 semanas anteriores
    const avgWeekly = prev.total / 4;
    const thisWeek = weekAreas.get(areaId)?.total ?? 0;
    if (avgWeekly >= 30 && thisWeek < avgWeekly * 0.4) {
      insights.push({
        id: `area-low:${areaId}`,
        kind: 'info',
        text: `Você realizou poucas questões de ${name} nesta semana.`,
        detail: `${thisWeek} nos últimos 7 dias (média recente: ~${Math.round(avgWeekly)}/semana)`,
      });
    }
  }

  // ── Por assunto: queda de desempenho entre contatos ─────────────────────
  const bySubject = new Map<string, typeof recentSessions>();
  for (const s of recentSessions) {
    const list = bySubject.get(s.subjectId) ?? [];
    list.push(s);
    bySubject.set(s.subjectId, list);
  }
  const pendingBySubject = new Map(
    (
      await prisma.review.findMany({
        where: { userId, status: 'PENDING', subjectId: { in: [...bySubject.keys()] } },
        select: { id: true, subjectId: true, scheduledFor: true },
      })
    ).map((r) => [r.subjectId, r]),
  );
  const drops: Insight[] = [];
  for (const [subjectId, sessions] of bySubject) {
    const contacts = groupContacts(
      sessions.map((s) => ({ ...s, quality: s.quality as Quality | null, difficulty: s.difficulty as Difficulty | null })),
    );
    const scores = contacts.map((c) => computeScore(c.evidence, config).score).filter((v): v is number => v !== null);
    if (scores.length < 2) continue;
    const last3 = scores.slice(-3);
    const [prev, last] = scores.slice(-2);
    const falling3 = last3.length === 3 && last3[0] > last3[1] && last3[1] > last3[2] && last3[2] < 75;
    const bigDrop = prev - last >= 15;
    if (falling3 || bigDrop) {
      const pending = pendingBySubject.get(subjectId);
      const name = sessions[0].subject.name;
      drops.push({
        id: `subject-drop:${subjectId}`,
        kind: 'warning',
        text: falling3
          ? `Seu desempenho em ${name} caiu nas últimas três revisões.`
          : `${name} apresenta queda de desempenho. Considere antecipar a revisão.`,
        detail: (falling3 ? last3 : [prev, last]).map((v) => `${Math.round(v)}%`).join(' → '),
        action:
          pending && fromDb(pending.scheduledFor) > today
            ? { label: 'Antecipar para hoje', anticipateReviewId: pending.id }
            : { label: 'Ver assunto', to: `/assuntos/${subjectId}` },
      });
    }
  }
  insights.push(...drops.slice(0, 3));

  // ── Carga de revisões ────────────────────────────────────────────────────
  const tomorrow = addDays(today, 1);
  const load = loadRows.map((r) => ({ date: fromDb(r.scheduledFor), count: r._count._all }));
  const tomorrowCount = load.find((l) => l.date === tomorrow)?.count ?? 0;
  const avgLoad = sum(load.map((l) => l.count)) / 14;
  if (tomorrowCount >= 8 && tomorrowCount >= avgLoad * 1.5) {
    insights.push({
      id: 'load-tomorrow',
      kind: 'info',
      text: `Você tem muitas revisões acumuladas para amanhã (${tomorrowCount}). Considere distribuir algumas hoje.`,
      action: { label: 'Ver calendário', to: '/calendario' },
    });
  }
  if (overdue > 0) {
    insights.unshift({
      id: 'overdue',
      kind: 'warning',
      text: `Você está atrasado em ${overdue} ${overdue === 1 ? 'revisão' : 'revisões'}.`,
      action: { label: 'Fazer agora', to: '/revisoes' },
    });
  }

  // ── Comparações com o próprio histórico (sem ranking) ───────────────────
  const minutes = sum(week.sessions.map((s) => s.durationMinutes));
  const prevMinutes = sum(prevWeek.sessions.map((s) => s.durationMinutes));
  if (minutes > 0 || prevMinutes > 0) {
    if (prevMinutes === 0) {
      comparisons.push({ id: 'cmp-time', kind: 'positive', text: 'Você voltou a estudar esta semana. Ótimo recomeço!' });
    } else {
      const change = (minutes - prevMinutes) / prevMinutes;
      if (change >= 0.1)
        comparisons.push({
          id: 'cmp-time',
          kind: 'positive',
          text: 'Você está estudando mais do que na semana passada.',
          detail: `${round(minutes / 60, 1)} h vs. ${round(prevMinutes / 60, 1)} h`,
        });
      else if (change <= -0.1)
        comparisons.push({
          id: 'cmp-time',
          kind: 'info',
          text: 'Você estudou menos do que na semana passada.',
          detail: `${round(minutes / 60, 1)} h vs. ${round(prevMinutes / 60, 1)} h`,
        });
      else comparisons.push({ id: 'cmp-time', kind: 'info', text: 'Seu tempo de estudo está estável em relação à semana passada.' });
    }
  }
  const wq = { t: sum(week.questions.map((q) => q.total)), c: sum(week.questions.map((q) => q.correct)) };
  const pq = { t: sum(prevWeek.questions.map((q) => q.total)), c: sum(prevWeek.questions.map((q) => q.correct)) };
  if (wq.t >= 20 && pq.t >= 20) {
    const diff = percent(wq.c, wq.t)! - percent(pq.c, pq.t)!;
    if (diff >= 3)
      comparisons.push({
        id: 'cmp-acc',
        kind: 'positive',
        text: 'Seu desempenho em questões aumentou.',
        detail: `${percent(pq.c, pq.t)}% → ${percent(wq.c, wq.t)}%`,
      });
    else if (diff <= -3)
      comparisons.push({
        id: 'cmp-acc',
        kind: 'warning',
        text: 'Seu desempenho em questões caiu em relação à semana passada.',
        detail: `${percent(pq.c, pq.t)}% → ${percent(wq.c, wq.t)}%`,
      });
  }
  if (wq.t > 0 && pq.t > 0 && wq.t >= pq.t * 1.2) {
    comparisons.push({ id: 'cmp-qvol', kind: 'positive', text: `Você fez ${wq.t - pq.t} questões a mais que na semana passada.` });
  }

  return { insights, comparisons };
}
