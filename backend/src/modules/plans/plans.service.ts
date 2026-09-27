import { Prisma, type PlanItemStatus } from '@prisma/client';
import { prisma, type Tx } from '../../lib/prisma.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { fromDb, fromDbOrNull, toDb } from '../../lib/dates.js';
import { addDays, diffDays } from '../scheduler/dates.js';
import { getAreaMap } from '../taxonomy/taxonomy.service.js';
import { DEFAULT_AREA, areaKey, cleanName, normName } from '../import/import.service.js';

// Cronograma: assuntos previstos por semana (ex.: o cronograma do cursinho).
// Um item fica "atrasado" quando a semana termina sem estudo, como uma revisão.
// Registrar um estudo do assunto (pelo botão do cronograma ou normalmente)
// conclui o item; excluir esse estudo o devolve para pendente.

export interface PlanItemInput {
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
}

/** Última data da semana do item (7 dias a partir do início). */
export const weekEnd = (weekStart: string) => addDays(weekStart, 6);

const itemInclude = {
  subject: { select: { id: true, name: true, areaId: true } },
  plan: { select: { id: true, name: true } },
} satisfies Prisma.PlanItemInclude;
type ItemRow = Prisma.PlanItemGetPayload<{ include: typeof itemInclude }>;

function serializeItem(i: ItemRow, areaMap: Awaited<ReturnType<typeof getAreaMap>>, today: string) {
  const start = fromDb(i.weekStart);
  const end = weekEnd(start);
  const area = areaMap.get(i.subject.areaId);
  return {
    id: i.id,
    planId: i.planId,
    planName: i.plan.name,
    subject: { id: i.subject.id, name: i.subject.name, area: area ? { id: area.id, path: area.path, color: area.color } : null },
    weekStart: start,
    weekEnd: end,
    label: i.label,
    position: i.position,
    status: i.status,
    doneOn: fromDbOrNull(i.doneOn),
    studySessionId: i.studySessionId,
    overdue: i.status === 'PENDING' && end < today,
    current: start <= today && today <= end,
  };
}
export type PlanItemView = ReturnType<typeof serializeItem>;

async function serializeItems(userId: string, rows: ItemRow[], today: string) {
  const areaMap = await getAreaMap(userId);
  return rows.map((r) => serializeItem(r, areaMap, today));
}

const order = [{ weekStart: 'asc' }, { position: 'asc' }] satisfies Prisma.PlanItemOrderByWithRelationInput[];

// ── Leitura ──────────────────────────────────────────────────────────────

export async function listPlans(userId: string, today: string) {
  const plans = await prisma.studyPlan.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: { items: { select: { status: true, weekStart: true } } },
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
  return { ...summary, items: await serializeItems(userId, rows, today) };
}

/** Pendências de todos os cronogramas: atrasadas, desta semana e da próxima. */
export async function planAgenda(userId: string, today: string) {
  const rows = await prisma.planItem.findMany({
    where: { userId, status: 'PENDING', weekStart: { lte: toDb(addDays(today, 7)) } },
    include: itemInclude,
    orderBy: order,
  });
  const items = await serializeItems(userId, rows, today);
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
  return serializeItems(userId, rows, today);
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
  for (const item of items) {
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

export async function previewPlan(userId: string, input: PlanInput) {
  validateItems(input.items);
  const r = await resolveSubjects(prisma, userId, input.items, false);
  const weeks = new Set(input.items.map((i) => i.weekStart));
  const starts = [...weeks].sort();
  const sameName = await prisma.studyPlan.count({ where: { userId, name: { equals: cleanName(input.name), mode: 'insensitive' } } });
  return {
    items: input.items.length,
    weeks: weeks.size,
    firstWeek: starts[0],
    lastWeek: starts[starts.length - 1],
    newSubjects: r.newSubjects,
    existingSubjects: r.target.filter((t) => !t.created).length,
    newAreas: [...new Set(r.newAreas)],
    sameName: sameName > 0,
  };
}

export async function createPlan(userId: string, input: PlanInput) {
  validateItems(input.items);
  return prisma.$transaction(
    async (tx) => {
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
      return { id: plan.id, items: input.items.length, newSubjects: r.newSubjects, newAreas: [...new Set(r.newAreas)] };
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

/** Adiar (nova semana), pular, voltar a pendente ou marcar como feito sem registrar estudo. */
export async function updateItem(userId: string, id: string, input: { weekStart?: string; status?: PlanItemStatus }, today: string) {
  const item = await ownedItem(userId, id);
  const data: Prisma.PlanItemUpdateInput = {};
  if (input.weekStart) data.weekStart = toDb(input.weekStart);
  if (input.status === 'DONE') Object.assign(data, { status: 'DONE', doneOn: toDb(today) });
  if (input.status === 'SKIPPED') Object.assign(data, { status: 'SKIPPED', doneOn: null, studySession: { disconnect: true } });
  if (input.status === 'PENDING') Object.assign(data, { status: 'PENDING', doneOn: null, studySession: { disconnect: true } });
  const updated = await prisma.planItem.update({ where: { id: item.id }, data, include: itemInclude });
  return (await serializeItems(userId, [updated], today))[0];
}

/** Empurra os pendentes do cronograma (ex.: +7 dias quando a semana atrasou). */
export async function shiftPlan(userId: string, planId: string, days: number, fromWeek?: string) {
  const plan = await prisma.studyPlan.findFirst({ where: { id: planId, userId } });
  if (!plan) throw notFound('Cronograma não encontrado');
  if (!Number.isInteger(days) || days === 0 || Math.abs(days) > 366) throw badRequest('Deslocamento inválido');
  const shifted = await prisma.$executeRaw`
    UPDATE plan_items SET week_start = week_start + ${days}::int
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
