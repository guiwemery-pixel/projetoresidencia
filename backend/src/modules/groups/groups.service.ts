import { randomInt } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { publicSummaries } from '../progress/public-summary.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_MEMBERS = 50;

function generateCode(length = 8) {
  let code = '';
  for (let i = 0; i < length; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

async function uniqueCode() {
  for (;;) {
    const code = generateCode();
    if (!(await prisma.group.findUnique({ where: { inviteCode: code } }))) return code;
  }
}

/** Garante que o usuário participa do grupo (senão 404, para não revelar a existência). */
export async function requireMembership(userId: string, groupId: string) {
  const membership = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } });
  if (!membership) throw notFound('Grupo não encontrado');
  return membership;
}

export async function listMyGroups(userId: string) {
  const memberships = await prisma.groupMember.findMany({
    where: { userId },
    include: { group: { include: { _count: { select: { members: true } } } } },
    orderBy: [{ favorite: 'desc' }, { joinedAt: 'asc' }],
  });
  return memberships.map((m) => ({
    id: m.group.id,
    name: m.group.name,
    description: m.group.description,
    role: m.role,
    favorite: m.favorite,
    memberCount: m.group._count.members,
    inviteCode: m.group.inviteCode,
    joinedAt: m.joinedAt,
  }));
}

/** Fixa (ou desafixa) o grupo na página inicial do próprio usuário. */
export async function setFavorite(userId: string, groupId: string, favorite: boolean) {
  await requireMembership(userId, groupId);
  await prisma.groupMember.update({ where: { groupId_userId: { groupId, userId } }, data: { favorite } });
  return { id: groupId, favorite };
}

export async function createGroup(userId: string, input: { name: string; description?: string | null }) {
  return prisma.group.create({
    data: {
      name: input.name,
      description: input.description ?? null,
      inviteCode: await uniqueCode(),
      createdById: userId,
      members: { create: { userId, role: 'OWNER' } },
    },
  });
}

export async function joinGroupByCode(userId: string, code: string) {
  const group = await prisma.group.findUnique({
    where: { inviteCode: code.trim().toUpperCase() },
    include: { _count: { select: { members: true } } },
  });
  if (!group) throw notFound('Código de convite inválido');
  const existing = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId: group.id, userId } } });
  if (existing) throw conflict('Você já participa deste grupo');
  if (group._count.members >= MAX_MEMBERS) throw badRequest('Este grupo atingiu o limite de integrantes');
  await prisma.groupMember.create({ data: { groupId: group.id, userId } });
  return group;
}

export async function leaveGroup(userId: string, groupId: string) {
  const membership = await requireMembership(userId, groupId);
  await prisma.$transaction(async (tx) => {
    await tx.groupMember.delete({ where: { groupId_userId: { groupId, userId } } });
    const remaining = await tx.groupMember.findMany({ where: { groupId }, orderBy: { joinedAt: 'asc' } });
    if (remaining.length === 0) {
      await tx.group.delete({ where: { id: groupId } });
    } else if (membership.role === 'OWNER' && !remaining.some((m) => m.role === 'OWNER')) {
      // Transfere a administração para o integrante mais antigo
      await tx.groupMember.update({
        where: { groupId_userId: { groupId, userId: remaining[0].userId } },
        data: { role: 'OWNER' },
      });
    }
  });
}

async function requireOwner(userId: string, groupId: string) {
  const membership = await requireMembership(userId, groupId);
  if (membership.role !== 'OWNER') throw forbidden('Apenas administradores do grupo podem fazer isso');
}

export async function updateGroup(userId: string, groupId: string, input: { name?: string; description?: string | null }) {
  await requireOwner(userId, groupId);
  return prisma.group.update({ where: { id: groupId }, data: input });
}

export async function regenerateInvite(userId: string, groupId: string) {
  await requireOwner(userId, groupId);
  return prisma.group.update({ where: { id: groupId }, data: { inviteCode: await uniqueCode() } });
}

export async function removeMember(userId: string, groupId: string, memberId: string) {
  await requireOwner(userId, groupId);
  if (memberId === userId) throw badRequest('Use "Sair do grupo" para sair');
  const target = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId: memberId } } });
  if (!target) throw notFound('Integrante não encontrado');
  await prisma.groupMember.delete({ where: { groupId_userId: { groupId, userId: memberId } } });
}

/**
 * Painel do grupo: para cada integrante, SOMENTE o resumo público
 * (ver progress/public-summary.ts).
 */
export async function groupBoard(userId: string, groupId: string) {
  const membership = await requireMembership(userId, groupId);
  const group = await prisma.group.findUniqueOrThrow({
    where: { id: groupId },
    include: { members: { select: { userId: true, role: true, joinedAt: true } } },
  });
  const summaries = await publicSummaries(group.members.map((m) => m.userId));
  const roleBy = new Map(group.members.map((m) => [m.userId, m.role]));
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    inviteCode: group.inviteCode,
    myRole: membership.role,
    favorite: membership.favorite,
    members: summaries
      .map((s) => ({ ...s, role: roleBy.get(s.userId)!, isMe: s.userId === userId }))
      .sort((a, b) => Number(b.isMe) - Number(a.isMe) || a.name.localeCompare(b.name, 'pt-BR')),
  };
}
