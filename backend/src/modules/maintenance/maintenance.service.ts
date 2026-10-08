import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { packExplanation } from '../reviews/explanation-codec.js';
import { migrateMediaToBlobStore, purgeOldTombstones } from '../flashcards/flashcards.service.js';
import { getSchedulerConfig } from '../reviews/algorithm-config.js';
import { rebuildSubject } from '../reviews/learning.service.js';
import { balanceReviews } from '../reviews/balance.service.js';
import { requeueOverdue } from '../plans/requeue.service.js';
import { todayIn } from '../../lib/dates.js';

// Faxina do banco para ocupar menos espaço, sem mudar nada do que se vê no app:
// - apaga sessões de login vencidas (já seriam recusadas de qualquer forma) e os links
//   de e-mail (confirmar, nova senha) já usados ou vencidos;
// - converte explicações do "Por quê?" gravadas no formato antigo (JSON) para o
//   comprimido (ver reviews/explanation-codec.ts);
// - descarta marcas de exclusão antigas dos flashcards e, com o R2 configurado,
//   leva para lá as imagens que ainda estão no banco (ver flashcards.service.ts);
// - quando o algoritmo de revisão muda de versão, recalcula o histórico dos
//   assuntos calculados pela versão anterior (as revisões pendentes seguem a regra nova);
// - todo dia: limite de revisões por dia e revisões muito atrasadas de volta ao cronograma.

export async function deleteExpiredSessions(userId?: string) {
  const { count } = await prisma.session.deleteMany({
    where: { ...(userId ? { userId } : {}), expiresAt: { lt: new Date() } },
  });
  return count;
}

/** Links de e-mail (confirmar, nova senha) usados ou vencidos há mais de um dia. */
export async function deleteOldEmailTokens() {
  const dayAgo = new Date(Date.now() - 86_400_000);
  const { count } = await prisma.emailToken.deleteMany({ where: { OR: [{ expiresAt: { lt: dayAgo } }, { usedAt: { lt: dayAgo } }] } });
  return count;
}

/** Converte explicações ainda em JSON para o formato comprimido, preservando `updated_at`. */
export async function compactLegacyExplanations(opts: { userId?: string; maxRows?: number } = {}) {
  const maxRows = opts.maxRows ?? 5000;
  let converted = 0;
  while (converted < maxRows) {
    const rows = await prisma.review.findMany({
      where: { ...(opts.userId ? { userId: opts.userId } : {}), explanationPacked: null, explanation: { not: Prisma.DbNull } },
      select: { id: true, explanation: true },
      take: Math.min(200, maxRows - converted),
    });
    if (!rows.length) return { converted, done: true };
    await prisma.$transaction(
      rows.map(
        (r) => prisma.$executeRaw`
          UPDATE reviews SET explanation_packed = ${packExplanation(r.explanation)}, explanation = NULL
          WHERE id = ${r.id} AND explanation_packed IS NULL`,
      ),
    );
    converted += rows.length;
  }
  return { converted, done: false };
}

/**
 * Recalcula os assuntos cujo estado foi calculado por outra versão do algoritmo,
 * aos poucos (limite de tempo), para as revisões pendentes seguirem a regra atual.
 */
export async function upgradeAlgorithm(opts: { userId?: string; timeBudgetMs?: number } = {}) {
  const { version } = await getSchedulerConfig();
  const deadline = Date.now() + (opts.timeBudgetMs ?? 20_000);
  let upgraded = 0;
  const users = new Set<string>();
  const finish = async (done: boolean) => {
    // Revisões recalculadas: aplica de novo o limite por dia
    for (const id of users) {
      const u = await prisma.user.findUnique({ where: { id }, select: { timezone: true } });
      if (u) await balanceReviews(prisma, id, todayIn(u.timezone));
    }
    return { upgraded, done };
  };
  while (Date.now() < deadline) {
    const states = await prisma.learningState.findMany({
      where: { ...(opts.userId ? { userId: opts.userId } : {}), algorithmVersion: { not: version } },
      select: { userId: true, subjectId: true },
      take: 20,
    });
    if (!states.length) return finish(true);
    for (const s of states) {
      if (Date.now() >= deadline) break;
      await prisma.$transaction((tx) => rebuildSubject(tx, s.userId, s.subjectId), { timeout: 30_000 });
      users.add(s.userId);
      upgraded++;
    }
  }
  return finish(false);
}

const upkeepDay = new Map<string, string>();

/**
 * Rotina do dia de um usuário: limite de revisões por dia e revisões muito atrasadas
 * de volta ao cronograma. Ao abrir o Início (uma vez por dia por instância) e no job diário.
 */
export async function dailyUpkeep(userId: string, today: string, opts: { force?: boolean } = {}) {
  if (!opts.force && upkeepDay.get(userId) === today) return null;
  const moves = await balanceReviews(prisma, userId, today);
  const requeued = await requeueOverdue(userId, today);
  upkeepDay.set(userId, today);
  return { moves: moves.length, requeued: requeued.length };
}

/** Rotina do dia para todos os usuários com revisões pendentes (job diário). */
export async function upkeepAllUsers(timeBudgetMs = 20_000) {
  const deadline = Date.now() + timeBudgetMs;
  const users = await prisma.user.findMany({ where: { reviews: { some: { status: 'PENDING' } } }, select: { id: true, timezone: true } });
  let moved = 0;
  let requeued = 0;
  for (const u of users) {
    if (Date.now() >= deadline) break;
    const r = await dailyUpkeep(u.id, todayIn(u.timezone), { force: true });
    moved += r?.moves ?? 0;
    requeued += r?.requeued ?? 0;
  }
  return { moved, requeued };
}

const tidyUsers = new Set<string>();

/** Faxina do próprio usuário ao abrir o app (uma vez por instância do servidor). */
export async function tidyUpUser(userId: string) {
  if (tidyUsers.has(userId)) return;
  const [compact, upgrade] = [await compactLegacyExplanations({ userId, maxRows: 1000 }), await upgradeAlgorithm({ userId, timeBudgetMs: 4000 })];
  if (compact.done && upgrade.done) tidyUsers.add(userId);
}

/** Faxina geral (job diário). */
export async function runMaintenance() {
  const expiredSessions = await deleteExpiredSessions();
  const oldEmailLinks = await deleteOldEmailTokens();
  const { converted } = await compactLegacyExplanations();
  const flashcardUsersPurged = await purgeOldTombstones();
  const { migrated: flashcardImagesMoved } = await migrateMediaToBlobStore();
  const { upgraded: subjectsRecalculated } = await upgradeAlgorithm({ timeBudgetMs: 25_000 });
  const { moved: reviewsMoved, requeued: subjectsRequeued } = await upkeepAllUsers();
  return { expiredSessions, oldEmailLinks, convertedExplanations: converted, flashcardUsersPurged, flashcardImagesMoved, subjectsRecalculated, reviewsMoved, subjectsRequeued };
}
