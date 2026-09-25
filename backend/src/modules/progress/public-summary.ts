import { prisma } from '../../lib/prisma.js';
import { todayIn } from '../../lib/dates.js';
import { computeProgress, type ComponentKey, type DetailedProgress, type Level, type TrendDir } from './progress.service.js';
import { invalidateCompareCache } from './group-compare.js';

// ─────────────────────────────────────────────────────────────────────────────
// FRONTEIRA DE PRIVACIDADE
//
// Este é o ÚNICO formato de dados de um usuário que outro usuário pode receber.
// Ele é montado campo a campo (lista de permissão), nunca por "spread" do objeto
// detalhado, para que um campo novo no cálculo jamais vaze por acidente.
//
// Não contém: números de questões, % de acertos, horas, assuntos, datas,
// quantidade de revisões, fórmula ou pesos.
// ─────────────────────────────────────────────────────────────────────────────

export interface PublicIndicator {
  level: Level;
  label: string;
}

export interface PublicSummary {
  userId: string;
  name: string;
  avatar: string | null;
  shared: boolean;
  /** Progresso geral arredondado de 5 em 5 (0–100) */
  progress?: number | null;
  level?: Level;
  trend?: TrendDir;
  indicators?: Record<ComponentKey, PublicIndicator> & { metas: PublicIndicator & { percent: number | null } };
}

const roundTo5 = (n: number | null) => (n === null ? null : Math.min(100, Math.max(0, Math.round(n / 5) * 5)));

export function toPublicSummary(
  user: { id: string; name: string; avatar: string | null; shareProgress: boolean },
  progress: DetailedProgress | null,
): PublicSummary {
  const base = { userId: user.id, name: user.name, avatar: user.avatar };
  if (!user.shareProgress || !progress) return { ...base, shared: false };
  const pick = (key: ComponentKey): PublicIndicator => {
    const c = progress.components.find((x) => x.key === key)!;
    return { level: c.level, label: c.statusLabel };
  };
  return {
    ...base,
    shared: true,
    progress: roundTo5(progress.index),
    level: progress.level,
    trend: progress.trend,
    indicators: {
      estudos: pick('estudos'),
      questoes: pick('questoes'),
      revisoes: pick('revisoes'),
      metas: { ...pick('metas'), percent: roundTo5(progress.goalsCompletionPercent) },
      simulados: pick('simulados'),
    },
  };
}

// Cache curto para o painel do grupo não recalcular tudo a cada acesso.
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; value: DetailedProgress }>();

export function invalidateProgressCache(userId: string) {
  cache.delete(userId);
  invalidateCompareCache(userId);
}

async function cachedProgress(userId: string, timezone: string) {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_MS && hit.value.today === todayIn(timezone)) return hit.value;
  const value = await computeProgress(userId, todayIn(timezone));
  cache.set(userId, { at: Date.now(), value });
  return value;
}

export async function publicSummaries(userIds: string[]): Promise<PublicSummary[]> {
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, avatar: true, shareProgress: true, timezone: true },
    orderBy: { name: 'asc' },
  });
  return Promise.all(
    users.map(async (u) => toPublicSummary(u, u.shareProgress ? await cachedProgress(u.id, u.timezone) : null)),
  );
}
