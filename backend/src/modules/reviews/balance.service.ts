import { prisma, type Tx } from '../../lib/prisma.js';
import { addDays, fromDb, toDb } from '../../lib/dates.js';

// Limite de revisões por dia (padrão 5 assuntos, em Perfil). Quando um dia passa do
// limite, as revisões que chegaram por último vão para o dia vizinho com vaga,
// alternando: uma para o dia anterior, a seguinte para o dia seguinte; sem vaga, dois
// dias antes/depois… (até uma semana; depois, o primeiro dia livre). Ficam onde estão:
// - as revisões de hoje para trás (hoje nunca recebe revisão de outro dia);
// - as remarcadas à mão (a pessoa escolheu a data);
// - nunca antes do dia seguinte ao estudo que gerou a revisão.
// A data calculada fica em `shifted_from`: quando abre vaga nela, a revisão volta.

const NEAR_DAYS = 7;
const FAR_DAYS = 90;

export interface ReviewMove {
  id: string;
  subjectId: string;
  from: string;
  to: string;
  /** Data calculada pelo algoritmo */
  ideal: string;
}

type Row = {
  id: string;
  subjectId: string;
  scheduledFor: string;
  shiftedFrom: string | null;
  manual: boolean;
  intervalDays: number;
  createdAt: Date;
};

/** Limite do usuário (0 = sem limite). */
export async function reviewLimitOf(db: Tx | typeof prisma, userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { dailyReviewLimit: true } });
  return u?.dailyReviewLimit ?? 0;
}

/**
 * Plano de remanejamento (puro, testável): devolve as mudanças de data para que
 * nenhum dia a partir de amanhã (e hoje, como origem) passe de `limit`.
 */
export function planBalance(rows: Row[], today: string, limit: number): ReviewMove[] {
  const tomorrow = addDays(today, 1);
  const byId = new Map(rows.map((r) => [r.id, { ...r }]));
  const load = new Map<string, number>();
  for (const r of byId.values()) load.set(r.scheduledFor, (load.get(r.scheduledFor) ?? 0) + 1);
  const moved = new Map<string, string>(); // id → data nova
  const place = (r: Row, date: string) => {
    load.set(r.scheduledFor, (load.get(r.scheduledFor) ?? 1) - 1);
    load.set(date, (load.get(date) ?? 0) + 1);
    r.scheduledFor = date;
    moved.set(r.id, date);
  };
  const hasRoom = (date: string) => (load.get(date) ?? 0) < limit;

  // 1. Sem limite: tudo volta para a data calculada
  if (limit <= 0) {
    for (const r of byId.values()) if (r.shiftedFrom && r.shiftedFrom !== r.scheduledFor && r.shiftedFrom >= tomorrow) place(r, r.shiftedFrom);
  } else {
    // 2. Abriu vaga na data calculada: volta para ela
    const shifted = [...byId.values()].filter((r) => r.shiftedFrom && r.shiftedFrom !== r.scheduledFor && r.shiftedFrom >= tomorrow);
    shifted.sort((a, b) => a.shiftedFrom!.localeCompare(b.shiftedFrom!) || a.createdAt.getTime() - b.createdAt.getTime());
    for (const r of shifted) if (hasRoom(r.shiftedFrom!)) place(r, r.shiftedFrom!);

    // 3. Dias acima do limite: as que chegaram por último vão para o vizinho com vaga
    const days = [...new Set([...byId.values()].map((r) => r.scheduledFor))].filter((d) => d >= today).sort();
    for (const day of days) {
      let excess = (load.get(day) ?? 0) - limit;
      if (excess <= 0) continue;
      const movable = [...byId.values()]
        .filter((r) => r.scheduledFor === day && !r.manual)
        // Intervalos curtos (reforço, D1) por último: um dia a mais pesa mais neles
        .sort((a, b) => Number(a.intervalDays <= 2) - Number(b.intervalDays <= 2) || b.createdAt.getTime() - a.createdAt.getTime());
      for (const r of movable) {
        if (excess <= 0) break;
        const ideal = r.shiftedFrom ?? r.scheduledFor;
        const earliest = [tomorrow, addDays(ideal, -r.intervalDays + 1)].sort().pop()!;
        // Alterna: uma para o dia anterior, a seguinte para o dia seguinte (o intervalo médio não muda)
        const out = [...byId.values()].filter((x) => x.shiftedFrom === day && x.scheduledFor !== day);
        const beforeFirst = out.filter((x) => x.scheduledFor < day).length <= out.filter((x) => x.scheduledFor > day).length;
        let target: string | null = null;
        for (let k = 1; k <= NEAR_DAYS && !target; k++) {
          const before = addDays(day, -k);
          const after = addDays(day, k);
          const okBefore = before >= earliest && hasRoom(before);
          const okAfter = after >= tomorrow && hasRoom(after);
          if (beforeFirst) target = okBefore ? before : okAfter ? after : null;
          else target = okAfter ? after : okBefore ? before : null;
        }
        for (let k = NEAR_DAYS + 1; k <= FAR_DAYS && !target; k++) {
          const after = addDays(day, k);
          if (hasRoom(after)) target = after;
        }
        if (!target) break; // tudo cheio: fica onde está
        if (!r.shiftedFrom) r.shiftedFrom = ideal;
        place(r, target);
        excess--;
      }
    }
  }

  const original = new Map(rows.map((r) => [r.id, r]));
  return [...moved.entries()]
    .filter(([id, to]) => original.get(id)!.scheduledFor !== to)
    .map(([id, to]) => {
      const r = byId.get(id)!;
      return { id, subjectId: r.subjectId, from: original.get(id)!.scheduledFor, to, ideal: r.shiftedFrom ?? to };
    });
}

/** Aplica o limite às revisões pendentes do usuário. Devolve o que mudou de data. */
export async function balanceReviews(db: Tx | typeof prisma, userId: string, today: string, limit?: number): Promise<ReviewMove[]> {
  const max = limit ?? (await reviewLimitOf(db, userId));
  const rows = await db.review.findMany({
    where: { userId, status: 'PENDING', scheduledFor: { gte: toDb(today) } },
    select: { id: true, subjectId: true, scheduledFor: true, shiftedFrom: true, originalScheduledOn: true, intervalDays: true, createdAt: true },
  });
  if (!rows.length) return [];
  const moves = planBalance(
    rows.map((r) => ({
      id: r.id,
      subjectId: r.subjectId,
      scheduledFor: fromDb(r.scheduledFor),
      shiftedFrom: r.shiftedFrom ? fromDb(r.shiftedFrom) : null,
      manual: !!r.originalScheduledOn && !r.shiftedFrom,
      intervalDays: r.intervalDays,
      createdAt: r.createdAt,
    })),
    today,
    max,
  );
  for (const m of moves) {
    await db.review.update({
      where: { id: m.id },
      data: { scheduledFor: toDb(m.to), shiftedFrom: m.to === m.ideal ? null : toDb(m.ideal) },
    });
  }
  return moves;
}
