import type { Prisma, SubjectSize } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { fromDbOrNull } from '../../lib/dates.js';

// Áreas formam uma árvore de até dois níveis (Área → Subárea); assuntos podem
// ficar em qualquer um dos níveis. Toda consulta filtra por userId.

export interface AreaInfo {
  id: string;
  name: string;
  parentId: string | null;
  color: string | null;
  /** Área de nível superior (para agregações por área) */
  topId: string;
  topName: string;
  topColor: string | null;
  /** "Cirurgia › Vias Biliares" */
  path: string;
}

export async function findOwnedArea(userId: string, id: string) {
  const area = await prisma.area.findFirst({ where: { id, userId } });
  if (!area) throw notFound('Área não encontrada');
  return area;
}

export async function findOwnedSubject(userId: string, id: string) {
  const subject = await prisma.subject.findFirst({ where: { id, userId } });
  if (!subject) throw notFound('Assunto não encontrado');
  return subject;
}

/** Mapa id → informações da área (com a área-mãe resolvida). */
export async function getAreaMap(userId: string): Promise<Map<string, AreaInfo>> {
  const areas = await prisma.area.findMany({ where: { userId }, orderBy: [{ position: 'asc' }, { name: 'asc' }] });
  const byId = new Map(areas.map((a) => [a.id, a]));
  const map = new Map<string, AreaInfo>();
  for (const a of areas) {
    const parent = a.parentId ? byId.get(a.parentId) : undefined;
    const top = parent ?? a;
    map.set(a.id, {
      id: a.id,
      name: a.name,
      parentId: a.parentId,
      color: a.color ?? top.color,
      topId: top.id,
      topName: top.name,
      topColor: top.color,
      path: parent ? `${parent.name} › ${a.name}` : a.name,
    });
  }
  return map;
}

/** Ids da área e de todas as suas subáreas. */
export async function areaWithDescendants(userId: string, areaId: string): Promise<string[]> {
  const children = await prisma.area.findMany({ where: { userId, parentId: areaId }, select: { id: true } });
  return [areaId, ...children.map((c) => c.id)];
}

export async function getAreaTree(userId: string) {
  const [areas, counts] = await Promise.all([
    prisma.area.findMany({ where: { userId }, orderBy: [{ position: 'asc' }, { name: 'asc' }] }),
    prisma.subject.groupBy({ by: ['areaId'], where: { userId, archived: false }, _count: { _all: true } }),
  ]);
  const countBy = new Map(counts.map((c) => [c.areaId, c._count._all]));
  const node = (a: (typeof areas)[number]) => ({
    id: a.id,
    name: a.name,
    color: a.color,
    parentId: a.parentId,
    position: a.position,
    subjectCount: countBy.get(a.id) ?? 0,
  });
  return areas
    .filter((a) => !a.parentId)
    .map((a) => ({
      ...node(a),
      children: areas.filter((c) => c.parentId === a.id).map(node),
    }));
}

export async function createArea(userId: string, input: { name: string; parentId?: string | null; color?: string | null }) {
  if (input.parentId) {
    const parent = await findOwnedArea(userId, input.parentId);
    if (parent.parentId) throw badRequest('Subáreas não podem ter outras subáreas');
  }
  const duplicate = await prisma.area.findFirst({
    where: { userId, parentId: input.parentId ?? null, name: { equals: input.name, mode: 'insensitive' } },
  });
  if (duplicate) throw conflict('Já existe uma área com este nome aqui', { id: duplicate.id });
  const position = await prisma.area.count({ where: { userId, parentId: input.parentId ?? null } });
  return prisma.area.create({
    data: { userId, name: input.name, parentId: input.parentId ?? null, color: input.color ?? null, position },
  });
}

export async function updateArea(
  userId: string,
  id: string,
  input: { name?: string; parentId?: string | null; color?: string | null; position?: number },
) {
  const area = await findOwnedArea(userId, id);
  if (input.parentId !== undefined && input.parentId !== area.parentId) {
    if (input.parentId) {
      if (input.parentId === id) throw badRequest('Uma área não pode ser subárea de si mesma');
      const parent = await findOwnedArea(userId, input.parentId);
      if (parent.parentId) throw badRequest('Subáreas não podem ter outras subáreas');
      const hasChildren = await prisma.area.count({ where: { userId, parentId: id } });
      if (hasChildren) throw badRequest('Esta área tem subáreas e não pode virar subárea');
    }
  }
  return prisma.area.update({ where: { id }, data: input });
}

/**
 * Exclui uma área. Se houver assuntos/subáreas, exige `moveTo` (para onde
 * mover os assuntos) ou `force` (apaga tudo, inclusive o histórico).
 */
export async function deleteArea(userId: string, id: string, opts: { moveTo?: string; force?: boolean }) {
  await findOwnedArea(userId, id);
  const ids = await areaWithDescendants(userId, id);
  const subjects = await prisma.subject.count({ where: { userId, areaId: { in: ids } } });
  const subareas = ids.length - 1;
  if ((subjects || subareas) && !opts.moveTo && !opts.force) {
    throw conflict('A área não está vazia', { subjects, subareas });
  }
  await prisma.$transaction(async (tx) => {
    if (opts.moveTo) {
      if (ids.includes(opts.moveTo)) throw badRequest('Escolha uma área de destino diferente');
      const target = await tx.area.findFirst({ where: { id: opts.moveTo, userId } });
      if (!target) throw notFound('Área de destino não encontrada');
      await tx.subject.updateMany({ where: { userId, areaId: { in: ids } }, data: { areaId: target.id } });
    }
    await tx.area.delete({ where: { id } });
  });
}

// ─────────────────────────────── Assuntos ────────────────────────────────

export interface SubjectInput {
  areaId: string;
  name: string;
  size?: SubjectSize;
  notes?: string | null;
  tags?: string[];
}

export async function createSubject(userId: string, input: SubjectInput) {
  await findOwnedArea(userId, input.areaId);
  const duplicate = await prisma.subject.findFirst({
    where: { userId, areaId: input.areaId, name: { equals: input.name, mode: 'insensitive' } },
  });
  if (duplicate) throw conflict('Este assunto já existe nesta área', { id: duplicate.id });
  return prisma.subject.create({
    data: {
      userId,
      areaId: input.areaId,
      name: input.name,
      size: input.size ?? 'MEDIUM',
      notes: input.notes ?? null,
      tags: input.tags ?? [],
    },
  });
}

export async function updateSubject(userId: string, id: string, input: Partial<SubjectInput> & { archived?: boolean }) {
  await findOwnedSubject(userId, id);
  if (input.areaId) await findOwnedArea(userId, input.areaId);
  const subject = await prisma.subject.update({ where: { id }, data: input });
  if (input.archived === true) {
    // Assunto arquivado sai do calendário
    await prisma.review.deleteMany({ where: { userId, subjectId: id, status: 'PENDING' } });
  }
  return subject;
}

export async function deleteSubject(userId: string, id: string) {
  await findOwnedSubject(userId, id);
  await prisma.subject.delete({ where: { id } });
}

export async function listSubjects(userId: string, opts: { q?: string; areaId?: string; includeArchived?: boolean }) {
  const where: Prisma.SubjectWhereInput = { userId };
  if (!opts.includeArchived) where.archived = false;
  if (opts.q) where.name = { contains: opts.q, mode: 'insensitive' };
  if (opts.areaId) where.areaId = { in: await areaWithDescendants(userId, opts.areaId) };

  const [subjects, areaMap] = await Promise.all([
    prisma.subject.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        learningState: true,
        reviews: { where: { status: 'PENDING' }, orderBy: { scheduledFor: 'asc' }, take: 1 },
      },
      take: 500,
    }),
    getAreaMap(userId),
  ]);

  const stats = await prisma.questionSession.groupBy({
    by: ['subjectId'],
    where: { userId, subjectId: { in: subjects.map((s) => s.id) } },
    _sum: { total: true, correct: true },
  });
  const statBy = new Map(stats.map((s) => [s.subjectId, s._sum]));

  return subjects.map((s) => {
    const st = statBy.get(s.id);
    const total = st?.total ?? 0;
    const correct = st?.correct ?? 0;
    return {
      id: s.id,
      name: s.name,
      size: s.size,
      notes: s.notes,
      tags: s.tags,
      archived: s.archived,
      areaId: s.areaId,
      area: areaMap.get(s.areaId) ?? null,
      learning: s.learningState
        ? {
            stage: s.learningState.stage,
            ease: s.learningState.ease,
            lastContactOn: fromDbOrNull(s.learningState.lastContactOn),
            lastScore: s.learningState.lastScore,
            contacts: s.learningState.contacts,
            lapses: s.learningState.lapses,
          }
        : null,
      nextReview: s.reviews[0]
        ? { id: s.reviews[0].id, scheduledFor: fromDbOrNull(s.reviews[0].scheduledFor), stage: s.reviews[0].stage }
        : null,
      questions: { total, correct, accuracy: total ? Math.round((correct / total) * 1000) / 10 : null },
    };
  });
}
