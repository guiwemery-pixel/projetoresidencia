import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { packExplanation } from '../reviews/explanation-codec.js';

// Faxina do banco para ocupar menos espaço, sem mudar nada do que se vê no app:
// - apaga sessões de login vencidas (já seriam recusadas de qualquer forma);
// - converte explicações do "Por quê?" gravadas no formato antigo (JSON) para o
//   comprimido (ver reviews/explanation-codec.ts).

export async function deleteExpiredSessions(userId?: string) {
  const { count } = await prisma.session.deleteMany({
    where: { ...(userId ? { userId } : {}), expiresAt: { lt: new Date() } },
  });
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

const tidyUsers = new Set<string>();

/** Faxina do próprio usuário ao abrir o app (uma vez por instância do servidor). */
export async function tidyUpUser(userId: string) {
  if (tidyUsers.has(userId)) return;
  const { done } = await compactLegacyExplanations({ userId, maxRows: 1000 });
  if (done) tidyUsers.add(userId);
}

/** Faxina geral (job diário). */
export async function runMaintenance() {
  const expiredSessions = await deleteExpiredSessions();
  const { converted } = await compactLegacyExplanations();
  return { expiredSessions, convertedExplanations: converted };
}
