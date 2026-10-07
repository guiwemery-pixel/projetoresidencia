import { Prisma, type PlanItemStatus } from '@prisma/client';
import { prisma, type Tx } from '../../lib/prisma.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { fromDb, fromDbOrNull, toDb } from '../../lib/dates.js';
import { addDays, diffDays } from '../scheduler/dates.js';
import { getAreaMap } from '../taxonomy/taxonomy.service.js';
import { DEFAULT_AREA, areaKey, cleanName, normName } from '../import/import.service.js';
import { SIZE_WEIGHT, planWeek, type WeekItem } from './distribute.js';
import { composeWeeks, weeksUntil, type ComposeOrder, type Pace } from './compose.js';

// Cronograma: assuntos previstos por semana (ex.: o cronograma do cursinho).
// Dentro da semana, cada assunto tem um dia previsto, distribuído pelos dias de
// estudo da pessoa (ver distribute.ts); as horas por dia viram o tempo sugerido.
// Um item fica "atrasado" quando a semana termina sem estudo, como uma revisão.
// Registrar um estudo do assunto (pelo botão do cronograma ou normalmente)
// conclui o item; excluir esse estudo o devolve para pendente.

export interface PlanItemInput {
  /** Assunto que já existe na conta (cronograma montado na plataforma); sem ele, procura pelo nome */
  subjectId?: string | null;
  subject: string;
  area?: string | null;
  weekStart: string;
  label?: string | null;
  bonus?: boolean;
}

export interface PlanInput {
  name: string;
  source?: string | null;
  items: PlanItemInput[];
  /** Dias de estudo (1 = segunda … 7 = domingo) e minutos por dia; ficam salvos para a pessoa */
  schedule?: StudySchedule | null;
}

export interface StudySchedule {
  weekdays: number[];
  dailyMinutes: number;
}

const cleanSchedule = (s: StudySchedule): StudySchedule => ({ weekdays: [...new Set(s.weekdays)].sort((a, b) => a - b), dailyMinutes: s.dailyMinutes });

async function userSchedule(tx: Tx | typeof prisma, userId: string): Promise<StudySchedule> {
  const u = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { studyWeekdays: true, dailyStudyMinutes: true } });
  return { weekdays: u.studyWeekdays.length ? u.studyWeekdays : [1, 2, 3, 4, 5], dailyMinutes: u.dailyStudyMinutes };
}

async function saveSchedule(tx: Tx | typeof prisma, userId: string, schedule: StudySchedule) {
  const s = cleanSchedule(schedule);
  await tx.user.update({ where: { id: userId }, data: { studyWeekdays: s.weekdays, dailyStudyMinutes: s.dailyMinutes } });
  return s;
}

/** Última data da semana do item (7 dias a partir do início). */
export const weekEnd = (weekStart: string) => addDays(weekStart, 6);

const itemInclude = {
  subject: { select: { id: true, name: true, areaId: true, size: true } },
  plan: { select: { id: true, name: true } },
} satisfies Prisma.PlanItemInclude;
type ItemRow = Prisma.PlanItemGetPayload<{ include: typeof itemInclude }>;

/** Tempo sugerido para o assunto: as horas do dia divididas entre os assuntos do dia (pelo tamanho). */
function suggested(dailyMinutes: number, weight: number, dayLoad: number | undefined) {
  if (!dayLoad) return null;
  return Math.max(10, Math.round((dailyMinutes * weight) / dayLoad / 5) * 5);
}

function serializeItem(i: ItemRow, areaMap: Awaited<ReturnType<typeof getAreaMap>>, today: string, ctx: { dailyMinutes: number; loads: Map<string, number> }) {
  const start = fromDb(i.weekStart);
  const end = weekEnd(start);
  const area = areaMap.get(i.subject.areaId);
  const day = i.plannedOn ? fromDb(i.plannedOn) : null;
  const overdue = i.status === 'PENDING' && end < today;
  return {
    id: i.id,
    planId: i.planId,
    planName: i.plan.name,
    subject: { id: i.subject.id, name: i.subject.name, area: area ? { id: area.id, path: area.path, color: area.color } : null },
    weekStart: start,
    weekEnd: end,
    // Dia previsto (sem distribuição: o início da semana)
    plannedOn: day ?? start,
    distributed: !!day,
    // Passou o dia previsto e a semana ainda não acabou (ainda dá tempo)
    behind: i.status === 'PENDING' && !overdue && !!day && day < today,
    suggestedMinutes: day && i.status !== 'SKIPPED' ? suggested(ctx.dailyMinutes, SIZE_WEIGHT[i.subject.size], ctx.loads.get(day)) : null,
    label: i.label,
    position: i.position,
    status: i.status,
    doneOn: fromDbOrNull(i.doneOn),
    studySessionId: i.studySessionId,
    overdue,
    current: start <= today && today <= end,
  };
}
export type PlanItemView = ReturnType<typeof serializeItem>;

async function serializeItems(userId: string, rows: ItemRow[], today: string) {
  const days = [...new Set(rows.filter((r) => r.plannedOn).map((r) => fromDb(r.plannedOn!)))];
  const [areaMap, user, sameDay] = await Promise.all([
    getAreaMap(userId),
    prisma.user.findUnique({ where: { id: userId }, select: { dailyStudyMinutes: true } }),
    days.length
      ? prisma.planItem.findMany({
          where: { userId, plannedOn: { in: days.map(toDb) }, status: { not: 'SKIPPED' } },
          select: { plannedOn: true, subject: { select: { size: true } } },
        })
      : Promise.resolve([]),
  ]);
  // Carga de cada dia (todos os cronogramas): base do tempo sugerido por assunto
  const loads = new Map<string, number>();
  for (const s of sameDay) {
    const d = fromDb(s.plannedOn!);
    loads.set(d, (loads.get(d) ?? 0) + SIZE_WEIGHT[s.subject.size]);
  }
  const ctx = { dailyMinutes: user?.dailyStudyMinutes ?? 240, loads };
  return rows.map((r) => serializeItem(r, areaMap, today, ctx));
}

const order = [{ weekStart: 'asc' }, { position: 'asc' }] satisfies Prisma.PlanItemOrderByWithRelationInput[];
/** Na mesma semana: pelo dia previsto, depois pela ordem do cronograma. */
const byDay = (a: PlanItemView, b: PlanItemView) => a.weekStart.localeCompare(b.weekStart) || a.plannedOn.localeCompare(b.plannedOn) || a.position - b.position;

// ── Leitura ──────────────────────────────────────────────────────────────

export async function listPlans(userId: string, today: string) {
  const plans = await prisma.studyPlan.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: { items: { select: { status: true, weekStart: true, plannedOn: true } } },
  });
  return plans.map((p) => {
    const starts = p.items.map((i) => fromDb(i.weekStart)).sort();
    const count = (s: PlanItemStatus) => p.items.filter((i) => i.status === s).length;
    return {
      id: p.id,
      name: p.name,
      source: p.source,
      createdAt: p.createdAt,
      total: p.items.length,
      done: count('DONE'),
      skipped: count('SKIPPED'),
      pending: count('PENDING'),
      overdue: p.items.filter((i) => i.status === 'PENDING' && weekEnd(fromDb(i.weekStart)) < today).length,
      // Pendentes ainda sem dia (cronograma de antes da distribuição pelos dias de estudo)
      undistributed: p.items.filter((i) => i.status === 'PENDING' && !i.plannedOn && weekEnd(fromDb(i.weekStart)) >= today).length,
      firstWeek: starts[0] ?? null,
      lastWeek: starts[starts.length - 1] ?? null,
    };
  });
}

export async function getPlan(userId: string, planId: string, today: string) {
  const plan = await prisma.studyPlan.findFirst({ where: { id: planId, userId } });
  if (!plan) throw notFound('Cronograma não encontrado');
  const rows = await prisma.planItem.findMany({ where: { userId, planId }, include: itemInclude, orderBy: order });
  const summary = (await listPlans(userId, today)).find((p) => p.id === planId)!;
  return { ...summary, items: (await serializeItems(userId, rows, today)).sort(byDay) };
}

/** Pendências de todos os cronogramas: atrasadas, desta semana e da próxima. */
export async function planAgenda(userId: string, today: string) {
  const rows = await prisma.planItem.findMany({
    where: { userId, status: 'PENDING', weekStart: { lte: toDb(addDays(today, 7)) } },
    include: itemInclude,
    orderBy: order,
  });
  const items = (await serializeItems(userId, rows, today)).sort(byDay);
  return {
    overdue: items.filter((i) => i.overdue),
    thisWeek: items.filter((i) => i.current),
    next: items.filter((i) => i.weekStart > today),
    hasPlan: rows.length > 0 || (await prisma.studyPlan.count({ where: { userId } })) > 0,
  };
}

/** Itens cuja semana cruza o período (para o calendário). */
export async function planItemsBetween(userId: string, from: string, to: string, today: string) {
  const rows = await prisma.planItem.findMany({
    where: { userId, weekStart: { gte: toDb(addDays(from, -6)), lte: toDb(to) } },
    include: itemInclude,
    orderBy: order,
  });
  return (await serializeItems(userId, rows, today)).sort(byDay);
}

// ── Criação ──────────────────────────────────────────────────────────────

/**
 * Assunto de cada item: procura pelo nome dentro da grande área (inclusive nas
 * subáreas); sem área, em qualquer área. Se não existir, será criado na área.
 */
async function resolveSubjects(tx: Tx | typeof prisma, userId: string, items: PlanItemInput[], create: boolean) {
  const [areas, subjects] = await Promise.all([
    tx.area.findMany({ where: { userId } }),
    tx.subject.findMany({ where: { userId }, select: { id: true, areaId: true, name: true } }),
  ]);
  const topOf = new Map(areas.map((a) => [a.id, a.parentId ?? a.id]));
  const tops = new Map(areas.filter((a) => !a.parentId).map((a) => [areaKey(a.name), a]));
  const inTop = new Map<string, string>();
  const anywhere = new Map<string, string[]>();
  for (const s of subjects) {
    const key = normName(s.name);
    inTop.set(`${topOf.get(s.areaId)}|${key}`, inTop.get(`${topOf.get(s.areaId)}|${key}`) ?? s.id);
    anywhere.set(key, [...(anywhere.get(key) ?? []), s.id]);
  }
  const newAreas: string[] = [];
  const toCreate = new Map<string, { areaId: string; name: string }>();
  const target: { subjectId: string | null; key: string; created: boolean }[] = [];
  const owned = new Set(subjects.map((s) => s.id));
  for (const item of items) {
    // Escolhido na lista de assuntos da pessoa: usa esse mesmo
    if (item.subjectId) {
      if (!owned.has(item.subjectId)) throw badRequest('Assunto não encontrado');
      target.push({ subjectId: item.subjectId, key: item.subjectId, created: false });
      continue;
    }
    const name = cleanName(item.subject).slice(0, 160);
    const key = normName(name);
    // Sem área: aproveita um assunto de mesmo nome em qualquer área, se for único
    if (!item.area && anywhere.get(key)?.length === 1) {
      target.push({ subjectId: anywhere.get(key)![0], key, created: false });
      continue;
    }
    const areaName = cleanName(item.area || DEFAULT_AREA);
    let top = tops.get(areaKey(areaName));
    if (!top) {
      newAreas.push(areaName);
      top = create
        ? await tx.area.create({ data: { userId, name: areaName, position: tops.size } })
        : ({ id: `new:${areaName}`, name: areaName } as (typeof areas)[number]);
      tops.set(areaKey(areaName), top);
    }
    const found = inTop.get(`${top.id}|${key}`);
    if (found) {
      target.push({ subjectId: found, key, created: false });
      continue;
    }
    toCreate.set(`${top.id}|${key}`, { areaId: top.id, name });
    target.push({ subjectId: null, key: `${top.id}|${key}`, created: true });
  }
  if (create && toCreate.size) {
    const created = await tx.subject.createManyAndReturn({
      data: [...toCreate.values()].map((s) => ({ userId, areaId: s.areaId, name: s.name })),
      select: { id: true, areaId: true, name: true },
    });
    const ids = new Map(created.map((c) => [`${c.areaId}|${normName(c.name)}`, c.id]));
    for (const t of target) if (!t.subjectId) t.subjectId = ids.get(t.key) ?? null;
  }
  return { target, newAreas, newSubjects: toCreate.size };
}

function validateItems(items: PlanItemInput[]) {
  if (!items.length) throw badRequest('O cronograma não tem nenhum assunto');
  for (const i of items) if (!cleanName(i.subject)) throw badRequest('Assunto sem nome no cronograma');
}

// ── Distribuição pelos dias de estudo ────────────────────────────────────

const MEDIUM = SIZE_WEIGHT.MEDIUM;

/** Como fica o cronograma com estes dias e horas (antes de criar): uma semana de exemplo e o tempo por assunto. */
function previewDistribution(items: PlanItemInput[], schedule: StudySchedule, today: string) {
  const weeks = new Map<string, PlanItemInput[]>();
  for (const i of items) weeks.set(i.weekStart, [...(weeks.get(i.weekStart) ?? []), i]);
  const views = [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([start, list]) => {
      const days = planWeek(
        start,
        list.map((_, n) => ({ id: String(n), weight: MEDIUM, status: 'PENDING', plannedOn: null, doneOn: null })),
        schedule.weekdays,
        today,
      );
      const byDate = new Map<string, string[]>();
      list.forEach((it, n) => {
        const d = days.get(String(n))!;
        byDate.set(d, [...(byDate.get(d) ?? []), cleanName(it.subject)]);
      });
      // Horas dos dias usados divididas pelos assuntos da semana
      const minutesEach = Math.round((schedule.dailyMinutes * byDate.size) / list.length / 5) * 5;
      return { weekStart: start, label: list.find((i) => !i.bonus)?.label ?? list[0].label ?? null, subjects: list.length, minutesEach, days: [...byDate.entries()].sort().map(([date, subjects]) => ({ date, subjects })) };
    });
  const upcoming = views.filter((w) => weekEnd(w.weekStart) >= today);
  const sample = upcoming[0] ?? views[0];
  const busiest = [...(upcoming.length ? upcoming : views)].sort((a, b) => a.minutesEach - b.minutesEach || b.subjects - a.subjects)[0];
  const total = items.length;
  const usedMinutes = views.reduce((s, w) => s + w.minutesEach * w.subjects, 0);
  return {
    weekdays: schedule.weekdays,
    dailyMinutes: schedule.dailyMinutes,
    sample,
    busiest: busiest && busiest.weekStart !== sample.weekStart ? { weekStart: busiest.weekStart, label: busiest.label, subjects: busiest.subjects, minutesEach: busiest.minutesEach } : null,
    averageMinutes: total ? Math.round(usedMinutes / total / 5) * 5 : 0,
  };
}

/**
 * Distribui os assuntos pelos dias de estudo (todos os cronogramas, ou um). Semanas que
 * já passaram só recebem dia se ainda não tinham: mudar os dias não reescreve o passado.
 * Devolve quantos assuntos mudaram de dia.
 */
export async function distributeItems(tx: Tx | typeof prisma, userId: string, today: string, weekdays: number[], planId?: string) {
  const rows = await tx.planItem.findMany({
    where: { userId, ...(planId ? { planId } : {}) },
    select: { id: true, planId: true, weekStart: true, status: true, plannedOn: true, doneOn: true, subject: { select: { size: true } } },
    orderBy: order,
  });
  const weeks = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.planId}|${fromDb(r.weekStart)}`;
    weeks.set(key, [...(weeks.get(key) ?? []), r]);
  }
  const changes: { id: string; day: string }[] = [];
  for (const [key, list] of weeks) {
    const start = key.split('|')[1];
    const past = weekEnd(start) < today;
    if (past && list.every((i) => i.plannedOn)) continue;
    const items: WeekItem[] = list.map((i) => ({
      id: i.id,
      weight: SIZE_WEIGHT[i.subject.size],
      status: i.status,
      plannedOn: fromDbOrNull(i.plannedOn),
      doneOn: fromDbOrNull(i.doneOn),
    }));
    const days = planWeek(start, items, weekdays, today);
    for (const i of items) {
      if (past && i.plannedOn) continue;
      const d = days.get(i.id)!;
      if (d !== i.plannedOn) changes.push({ id: i.id, day: d });
    }
  }
  for (let n = 0; n < changes.length; n += 500) {
    const chunk = changes.slice(n, n + 500);
    await tx.$executeRaw`
      UPDATE plan_items AS p SET planned_on = v.d::date
      FROM (VALUES ${Prisma.join(chunk.map((c) => Prisma.sql`(${c.id}, ${c.day})`))}) AS v(id, d)
      WHERE p.id = v.id AND p.user_id = ${userId}`;
  }
  return changes.length;
}

/** Salva os dias e horas de estudo e redistribui o cronograma (todos, ou um). */
export async function setStudySchedule(userId: string, schedule: StudySchedule, today: string, planId?: string) {
  if (planId && !(await prisma.studyPlan.findFirst({ where: { id: planId, userId }, select: { id: true } }))) throw notFound('Cronograma não encontrado');
  return prisma.$transaction(
    async (tx) => {
      const s = await saveSchedule(tx, userId, schedule);
      const moved = await distributeItems(tx, userId, today, s.weekdays, planId);
      return { ...s, moved };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

export async function previewPlan(userId: string, input: PlanInput, today: string) {
  validateItems(input.items);
  const r = await resolveSubjects(prisma, userId, input.items, false);
  const weeks = new Set(input.items.map((i) => i.weekStart));
  const starts = [...weeks].sort();
  const sameName = await prisma.studyPlan.count({ where: { userId, name: { equals: cleanName(input.name), mode: 'insensitive' } } });
  const schedule = input.schedule ? cleanSchedule(input.schedule) : await userSchedule(prisma, userId);
  return {
    items: input.items.length,
    weeks: weeks.size,
    firstWeek: starts[0],
    lastWeek: starts[starts.length - 1],
    newSubjects: r.newSubjects,
    existingSubjects: r.target.filter((t) => !t.created).length,
    newAreas: [...new Set(r.newAreas)],
    sameName: sameName > 0,
    distribution: previewDistribution(input.items, schedule, today),
  };
}

export async function createPlan(userId: string, input: PlanInput, today: string) {
  validateItems(input.items);
  return prisma.$transaction(
    async (tx) => {
      const schedule = input.schedule ? await saveSchedule(tx, userId, input.schedule) : await userSchedule(tx, userId);
      const r = await resolveSubjects(tx, userId, input.items, true);
      const plan = await tx.studyPlan.create({ data: { userId, name: cleanName(input.name) || 'Cronograma', source: input.source ? cleanName(input.source) : null } });
      await tx.planItem.createMany({
        data: input.items.map((item, i) => ({
          userId,
          planId: plan.id,
          subjectId: r.target[i].subjectId!,
          weekStart: toDb(item.weekStart),
          label: item.label ? cleanName(item.label).slice(0, 60) : null,
          position: i,
          createdSubject: r.target[i].created,
        })),
      });
      await distributeItems(tx, userId, today, schedule.weekdays, plan.id);
      return { id: plan.id, items: input.items.length, newSubjects: r.newSubjects, newAreas: [...new Set(r.newAreas)] };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

// ── Montar um cronograma na plataforma (sem PDF) ─────────────────────────

export type ComposeSubjectInput = { subjectId: string } | { name: string; area?: string | null };

export interface ComposeInput {
  name?: string;
  /** Acrescentar a um cronograma que já existe (em vez de criar outro) */
  planId?: string;
  start: string;
  pace: Pace;
  order: ComposeOrder;
  subjects: ComposeSubjectInput[];
  schedule?: StudySchedule | null;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Os itens do cronograma montado: cada assunto na sua semana, com o rótulo da semana. */
async function composeItems(userId: string, input: ComposeInput) {
  if (!input.subjects.length) throw badRequest('Escolha pelo menos um assunto');
  if (input.pace.kind === 'until' && input.pace.until < input.start) throw badRequest('A data final vem antes do início');
  if (input.pace.kind === 'until' && weeksUntil(input.start, input.pace.until) > 260) throw badRequest('Período longo demais (até 5 anos)');
  const plan = input.planId ? await prisma.studyPlan.findFirst({ where: { id: input.planId, userId }, select: { id: true } }) : null;
  if (input.planId && !plan) throw notFound('Cronograma não encontrado');

  const ids = input.subjects.flatMap((s) => ('subjectId' in s ? [s.subjectId] : []));
  const [rows, areas, existing] = await Promise.all([
    ids.length ? prisma.subject.findMany({ where: { userId, id: { in: ids } }, select: { id: true, name: true, areaId: true } }) : Promise.resolve([]),
    prisma.area.findMany({ where: { userId }, select: { id: true, name: true, parentId: true } }),
    plan
      ? prisma.planItem.findMany({ where: { planId: plan.id }, select: { subjectId: true, status: true, weekStart: true, label: true } })
      : Promise.resolve([]),
  ]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const areaById = new Map(areas.map((a) => [a.id, a]));
  const topName = (areaId: string) => {
    const a = areaById.get(areaId);
    return a ? (a.parentId ? (areaById.get(a.parentId)?.name ?? a.name) : a.name) : null;
  };
  // Já pendente neste cronograma: não entra de novo
  const pendingInPlan = new Set(existing.filter((i) => i.status === 'PENDING').map((i) => i.subjectId));

  const seen = new Set<string>();
  const list: { subjectId: string | null; name: string; area: string | null }[] = [];
  let skipped = 0;
  for (const s of input.subjects) {
    if ('subjectId' in s) {
      const row = byId.get(s.subjectId);
      if (!row) throw badRequest('Assunto não encontrado');
      if (seen.has(row.id) || pendingInPlan.has(row.id)) {
        skipped++;
        continue;
      }
      seen.add(row.id);
      list.push({ subjectId: row.id, name: row.name, area: topName(row.areaId) });
    } else {
      const name = cleanName(s.name).slice(0, 160);
      if (!name) continue;
      const area = s.area ? cleanName(s.area) : null;
      const key = `${areaKey(area ?? '')}|${normName(name)}`;
      if (seen.has(key)) {
        skipped++;
        continue;
      }
      seen.add(key);
      list.push({ subjectId: null, name, area });
    }
  }
  if (!list.length) throw badRequest('Todos os assuntos escolhidos já estão neste cronograma');

  const placed = composeWeeks(list, { start: input.start, pace: input.pace, order: input.order });
  // Rótulo de cada semana: o que a semana já tinha no cronograma, ou "Semana NN" na ordem das semanas
  const labelOf = new Map<string, string>();
  for (const i of existing) if (i.label && !/b[oô]nus/i.test(i.label)) labelOf.set(fromDb(i.weekStart), i.label);
  const allWeeks = [...new Set([...existing.map((i) => fromDb(i.weekStart)), ...placed.map((p) => p.weekStart)])].sort();
  const label = (w: string) => labelOf.get(w) ?? `Semana ${pad2(allWeeks.indexOf(w) + 1)}`;
  const items: PlanItemInput[] = placed.map((p) => ({
    subjectId: p.subject.subjectId,
    subject: p.subject.name,
    area: p.subject.area,
    weekStart: p.weekStart,
    label: label(p.weekStart),
  }));
  return { items, skipped, planId: plan?.id ?? null };
}

/** Como fica o cronograma montado: as semanas com os assuntos, e o tempo por assunto pelos dias e horas. */
export async function previewCompose(userId: string, input: ComposeInput, today: string) {
  const { items, skipped } = await composeItems(userId, input);
  const schedule = input.schedule ? cleanSchedule(input.schedule) : await userSchedule(prisma, userId);
  const r = await resolveSubjects(prisma, userId, items, false);
  const weeks = new Map<string, { weekStart: string; label: string; subjects: { name: string; area: string | null }[] }>();
  for (const i of items) {
    const w = weeks.get(i.weekStart) ?? { weekStart: i.weekStart, label: i.label ?? '', subjects: [] };
    w.subjects.push({ name: i.subject, area: i.area ?? null });
    weeks.set(i.weekStart, w);
  }
  const list = [...weeks.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  return {
    items: items.length,
    skipped,
    newSubjects: r.newSubjects,
    newAreas: [...new Set(r.newAreas)],
    firstWeek: list[0].weekStart,
    lastWeek: list[list.length - 1].weekStart,
    weeks: list,
    distribution: previewDistribution(items, schedule, today),
  };
}

/** Cria o cronograma montado (ou acrescenta os assuntos a um que já existe) e distribui pelos dias de estudo. */
export async function createComposed(userId: string, input: ComposeInput, today: string) {
  const { items, planId } = await composeItems(userId, input);
  if (!planId) return createPlan(userId, { name: input.name?.trim() || 'Meu cronograma', source: null, items, schedule: input.schedule }, today);
  return prisma.$transaction(
    async (tx) => {
      const schedule = input.schedule ? await saveSchedule(tx, userId, input.schedule) : await userSchedule(tx, userId);
      const r = await resolveSubjects(tx, userId, items, true);
      const offset = await tx.planItem.count({ where: { planId } });
      await tx.planItem.createMany({
        data: items.map((item, i) => ({
          userId,
          planId,
          subjectId: r.target[i].subjectId!,
          weekStart: toDb(item.weekStart),
          label: item.label ? cleanName(item.label).slice(0, 60) : null,
          position: offset + i,
          createdSubject: r.target[i].created,
        })),
      });
      await distributeItems(tx, userId, today, schedule.weekdays, planId);
      return { id: planId, items: items.length, newSubjects: r.newSubjects, newAreas: [...new Set(r.newAreas)] };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

// ── Alterações ───────────────────────────────────────────────────────────

async function ownedItem(userId: string, id: string) {
  const item = await prisma.planItem.findFirst({ where: { id, userId } });
  if (!item) throw notFound('Assunto do cronograma não encontrado');
  return item;
}

/**
 * Mudar o dia (ou a semana), pular, voltar a pendente ou marcar como feito sem registrar
 * estudo. Num dia de outra semana, o item vai para a semana do cronograma que contém o dia.
 */
export async function updateItem(userId: string, id: string, input: { weekStart?: string; plannedOn?: string; status?: PlanItemStatus }, today: string) {
  const item = await ownedItem(userId, id);
  const data: Prisma.PlanItemUpdateInput = {};
  const start = fromDb(item.weekStart);
  if (input.plannedOn) {
    data.plannedOn = toDb(input.plannedOn);
    data.weekStart = toDb(addDays(start, Math.floor(diffDays(start, input.plannedOn) / 7) * 7));
  } else if (input.weekStart) {
    data.weekStart = toDb(input.weekStart);
    // O dia previsto acompanha a semana
    if (item.plannedOn) data.plannedOn = toDb(addDays(fromDb(item.plannedOn), diffDays(start, input.weekStart)));
  }
  if (input.status === 'DONE') Object.assign(data, { status: 'DONE', doneOn: toDb(today) });
  if (input.status === 'SKIPPED') Object.assign(data, { status: 'SKIPPED', doneOn: null, studySession: { disconnect: true } });
  if (input.status === 'PENDING') Object.assign(data, { status: 'PENDING', doneOn: null, studySession: { disconnect: true } });
  const updated = await prisma.planItem.update({ where: { id: item.id }, data, include: itemInclude });
  return (await serializeItems(userId, [updated], today))[0];
}

/** Tira o assunto do cronograma (o assunto, os estudos e as revisões continuam). */
export async function removeItem(userId: string, id: string) {
  const item = await ownedItem(userId, id);
  await prisma.planItem.delete({ where: { id: item.id } });
}

/** Empurra os pendentes do cronograma (ex.: +7 dias quando a semana atrasou). */
export async function shiftPlan(userId: string, planId: string, days: number, fromWeek?: string) {
  const plan = await prisma.studyPlan.findFirst({ where: { id: planId, userId } });
  if (!plan) throw notFound('Cronograma não encontrado');
  if (!Number.isInteger(days) || days === 0 || Math.abs(days) > 366) throw badRequest('Deslocamento inválido');
  const shifted = await prisma.$executeRaw`
    UPDATE plan_items SET week_start = week_start + ${days}::int, planned_on = planned_on + ${days}::int
    WHERE plan_id = ${planId} AND user_id = ${userId} AND status = 'PENDING'
      ${fromWeek ? Prisma.sql`AND week_start >= ${toDb(fromWeek)}` : Prisma.empty}`;
  return { shifted };
}

export async function renamePlan(userId: string, planId: string, name: string) {
  const plan = await prisma.studyPlan.findFirst({ where: { id: planId, userId } });
  if (!plan) throw notFound('Cronograma não encontrado');
  return prisma.studyPlan.update({ where: { id: planId }, data: { name: cleanName(name) } });
}

/**
 * Exclui o cronograma. Com `removeSubjects`, apaga também os assuntos que ele
 * criou e que nunca foram estudados (nem estão em outro cronograma).
 */
export async function deletePlan(userId: string, planId: string, removeSubjects: boolean) {
  const plan = await prisma.studyPlan.findFirst({ where: { id: planId, userId } });
  if (!plan) throw notFound('Cronograma não encontrado');
  return prisma.$transaction(async (tx) => {
    let removed = 0;
    if (removeSubjects) {
      const created = await tx.planItem.findMany({ where: { planId, createdSubject: true }, select: { subjectId: true } });
      const ids = [...new Set(created.map((c) => c.subjectId))];
      if (ids.length) {
        const r = await tx.subject.deleteMany({
          where: {
            id: { in: ids },
            userId,
            studySessions: { none: {} },
            planItems: { none: { planId: { not: planId } } },
          },
        });
        removed = r.count;
      }
    }
    await tx.studyPlan.delete({ where: { id: planId } });
    return { removedSubjects: removed };
  });
}

// ── Vínculo com os estudos ───────────────────────────────────────────────

/**
 * Um estudo registrado conclui um item do cronograma: o indicado (botão
 * "Estudar" do cronograma) ou o pendente mais antigo do assunto cuja semana
 * começa até 7 dias depois do estudo (estudar adiantado uma semana vale).
 */
export async function linkStudy(tx: Tx | typeof prisma, userId: string, subjectId: string, date: string, sessionId: string, planItemId?: string | null) {
  let item = planItemId ? await tx.planItem.findFirst({ where: { id: planItemId, userId, subjectId, status: { not: 'DONE' } } }) : null;
  item ??= await tx.planItem.findFirst({
    where: { userId, subjectId, status: 'PENDING', weekStart: { lte: toDb(addDays(date, 7)) } },
    orderBy: order,
  });
  if (!item) return null;
  await tx.planItem.update({ where: { id: item.id }, data: { status: 'DONE', doneOn: toDb(date), studySessionId: sessionId } });
  return { id: item.id, label: item.label, weekStart: fromDb(item.weekStart), late: diffDays(weekEnd(fromDb(item.weekStart)), date) > 0 };
}

/** O estudo que concluía o item foi excluído (ou mudou de assunto): o item volta a pendente. */
export async function unlinkStudy(tx: Tx | typeof prisma, userId: string, sessionId: string) {
  await tx.planItem.updateMany({ where: { userId, studySessionId: sessionId }, data: { status: 'PENDING', doneOn: null, studySessionId: null } });
}
