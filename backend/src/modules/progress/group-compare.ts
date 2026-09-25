import type { StudyMethod } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { addDays, fromDb, todayIn, toDb } from '../../lib/dates.js';
import { sum } from '../../lib/math.js';

// ─────────────────────────────────────────────────────────────────────────────
// COMPARATIVOS DO GRUPO — também é FRONTEIRA DE PRIVACIDADE
//
// Os números de cada pessoa (questões, acertos, minutos, dias, revisões,
// assuntos) são calculados aqui e NUNCA saem deste módulo. Para o grupo saem só:
// - níveis relativos à mediana do grupo (faixas largas: "acima", "na média"…);
// - quem se destacou em cada dimensão (sem o valor);
// - a composição do próprio estudo em faixas de 10% (sem horas);
// - a variação do grupo como um todo, em % arredondado de 5 em 5.
// Faixas largas impedem que alguém descubra os números dos outros comparando com
// os próprios. Só entra quem compartilha o progresso (shareProgress).
// ─────────────────────────────────────────────────────────────────────────────

export type DimKey = 'questoes' | 'acertos' | 'tempo' | 'flashcards' | 'constancia' | 'revisoes' | 'assuntos';
export type RelLevel = 'muito-acima' | 'acima' | 'media' | 'abaixo' | 'muito-abaixo' | 'sem-registro';
export type MixKey = 'questoes' | 'teoria' | 'flashcards' | 'simulados';
export type Period = 7 | 30;

export const DIMENSIONS: DimKey[] = ['questoes', 'acertos', 'tempo', 'flashcards', 'constancia', 'revisoes', 'assuntos'];
const VOLUME_DIMS: DimKey[] = ['questoes', 'tempo', 'flashcards', 'constancia', 'revisoes', 'assuntos'];
const PULSE_DIMS = ['questoes', 'tempo', 'flashcards', 'revisoes'] as const;
const MIX_KEYS: MixKey[] = ['questoes', 'teoria', 'flashcards', 'simulados'];
/** Mínimo de questões no período para o percentual de acertos entrar na comparação */
export const MIN_QUESTIONS_FOR_ACCURACY = 20;

/** Números de um período — uso interno, nunca enviados a outra pessoa. */
interface RawStats {
  questions: number;
  correct: number;
  minutes: number;
  flashSessions: number;
  days: number;
  reviews: number;
  subjects: number;
  mix: Record<MixKey, { minutes: number; count: number }>;
}

const methodMix = (m: StudyMethod): MixKey =>
  m === 'QUESTOES' ? 'questoes' : m === 'SIMULADO' ? 'simulados' : m === 'FLASHCARDS' || m === 'RECALL' ? 'flashcards' : 'teoria';

function emptyStats(): RawStats {
  return {
    questions: 0,
    correct: 0,
    minutes: 0,
    flashSessions: 0,
    days: 0,
    reviews: 0,
    subjects: 0,
    mix: { questoes: { minutes: 0, count: 0 }, teoria: { minutes: 0, count: 0 }, flashcards: { minutes: 0, count: 0 }, simulados: { minutes: 0, count: 0 } },
  };
}

/** Período atual e o anterior (para a variação do grupo), no fuso de cada pessoa. */
async function loadStats(userId: string, timezone: string, period: Period) {
  const today = todayIn(timezone);
  const from = addDays(today, -(period - 1));
  const prevFrom = addDays(from, -period);
  const range = { gte: toDb(prevFrom), lte: toDb(today) };
  const [sessions, questions, mocks, attempts, reviews] = await Promise.all([
    prisma.studySession.findMany({ where: { userId, studiedOn: range }, select: { studiedOn: true, durationMinutes: true, methods: true, subjectId: true } }),
    prisma.questionSession.findMany({ where: { userId, doneOn: range }, select: { doneOn: true, total: true, correct: true } }),
    prisma.mockExam.findMany({
      where: { userId, status: 'DONE', takenOn: range },
      select: { takenOn: true, totalQuestions: true, correct: true, durationMinutes: true },
    }),
    prisma.examAttempt.findMany({ where: { userId, takenOn: range }, select: { takenOn: true, totalQuestions: true, correct: true } }),
    prisma.review.findMany({ where: { userId, status: 'DONE', completedOn: range }, select: { completedOn: true } }),
  ]);

  const build = (lo: string, hi: string): RawStats => {
    const inside = (d: Date | null) => !!d && fromDb(d) >= lo && fromDb(d) <= hi;
    const s = emptyStats();
    const days = new Set<string>();
    const subjects = new Set<string>();
    for (const x of sessions.filter((x) => inside(x.studiedOn))) {
      s.minutes += x.durationMinutes;
      days.add(fromDb(x.studiedOn));
      subjects.add(x.subjectId);
      if (x.methods.some((m) => m === 'FLASHCARDS' || m === 'RECALL')) s.flashSessions++;
      const kinds = [...new Set(x.methods.map(methodMix))];
      for (const k of kinds) {
        s.mix[k].minutes += x.durationMinutes / kinds.length;
        s.mix[k].count += 1 / kinds.length;
      }
    }
    for (const q of questions.filter((q) => inside(q.doneOn))) {
      s.questions += q.total;
      s.correct += q.correct;
      days.add(fromDb(q.doneOn));
    }
    for (const m of mocks.filter((m) => inside(m.takenOn))) {
      s.questions += m.totalQuestions ?? 0;
      s.correct += m.correct ?? 0;
      s.mix.simulados.minutes += m.durationMinutes ?? 0;
      s.mix.simulados.count += 1;
      days.add(fromDb(m.takenOn));
    }
    for (const a of attempts.filter((a) => inside(a.takenOn))) {
      s.questions += a.totalQuestions ?? 0;
      s.correct += a.correct ?? 0;
      days.add(fromDb(a.takenOn));
    }
    s.reviews = reviews.filter((r) => inside(r.completedOn)).length;
    s.days = days.size;
    s.subjects = subjects.size;
    return s;
  };
  return { current: build(from, today), previous: build(prevFrom, addDays(from, -1)) };
}

// Cache curto (invalidado quando a pessoa registra algo — ver invalidateCompareCache)
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; day: string; value: Awaited<ReturnType<typeof loadStats>> }>();

export function invalidateCompareCache(userId: string) {
  for (const key of cache.keys()) if (key.startsWith(`${userId}:`)) cache.delete(key);
}

async function cachedStats(userId: string, timezone: string, period: Period) {
  const key = `${userId}:${period}`;
  const day = todayIn(timezone);
  const hit = cache.get(key);
  if (hit && hit.day === day && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await loadStats(userId, timezone, period);
  cache.set(key, { at: Date.now(), day, value });
  return value;
}

// ── Conversão números → níveis relativos ─────────────────────────────────

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const accuracyOf = (s: RawStats) => (s.questions >= MIN_QUESTIONS_FOR_ACCURACY ? (s.correct / s.questions) * 100 : null);

function volumeOf(s: RawStats, dim: DimKey): number {
  switch (dim) {
    case 'questoes':
      return s.questions;
    case 'tempo':
      return s.minutes;
    case 'flashcards':
      return s.flashSessions;
    case 'constancia':
      return s.days;
    case 'revisoes':
      return s.reviews;
    case 'assuntos':
      return s.subjects;
    default:
      return 0;
  }
}

/** Volume em relação à mediana do grupo (faixas largas de propósito). */
export function volumeLevel(value: number, med: number | null): RelLevel {
  if (value <= 0) return 'sem-registro';
  if (med === null || med <= 0) return 'muito-acima';
  const r = value / med;
  if (r >= 1.5) return 'muito-acima';
  if (r >= 1.15) return 'acima';
  if (r > 0.85) return 'media';
  if (r >= 0.5) return 'abaixo';
  return 'muito-abaixo';
}

/** Acertos em pontos percentuais em relação à mediana do grupo. */
export function accuracyLevel(acc: number | null, med: number | null): RelLevel {
  if (acc === null || med === null) return 'sem-registro';
  const d = acc - med;
  if (d >= 8) return 'muito-acima';
  if (d >= 3) return 'acima';
  if (d > -3) return 'media';
  if (d > -8) return 'abaixo';
  return 'muito-abaixo';
}

interface Medians {
  volume: Record<string, number | null>;
  accuracy: number | null;
}

function mediansOf(stats: RawStats[]): Medians {
  const volume: Record<string, number | null> = {};
  for (const d of VOLUME_DIMS) volume[d] = median(stats.map((s) => volumeOf(s, d)));
  return { volume, accuracy: median(stats.map(accuracyOf).filter((a): a is number => a !== null)) };
}

function levelsOf(s: RawStats, m: Medians): Record<DimKey, RelLevel> {
  const out = {} as Record<DimKey, RelLevel>;
  for (const d of VOLUME_DIMS) out[d] = volumeLevel(volumeOf(s, d), m.volume[d]);
  out.acertos = accuracyLevel(accuracyOf(s), m.accuracy);
  return out;
}

/** Até 2 dimensões em que a pessoa mais se destaca (só as "acima"). */
function strengthsOf(levels: Record<DimKey, RelLevel>): DimKey[] {
  const rank: Partial<Record<RelLevel, number>> = { 'muito-acima': 2, acima: 1 };
  return DIMENSIONS.filter((d) => rank[levels[d]])
    .sort((a, b) => rank[levels[b]]! - rank[levels[a]]!)
    .slice(0, 2);
}

/** Composição do próprio estudo em faixas de 10% (soma 100), sem horas. */
export function mixShares(s: RawStats): Record<MixKey, number> | null {
  const useMinutes = sum(MIX_KEYS.map((k) => s.mix[k].minutes)) > 0;
  const raw = MIX_KEYS.map((k) => (useMinutes ? s.mix[k].minutes : s.mix[k].count));
  const total = sum(raw);
  if (total <= 0) return null;
  // Maior resto: arredonda para dezenas mantendo a soma em 100
  const tenths = raw.map((v) => (v / total) * 10);
  const floors = tenths.map(Math.floor);
  let left = 10 - sum(floors);
  const order = tenths.map((v, i) => ({ i, rest: v - floors[i] })).sort((a, b) => b.rest - a.rest);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i]++;
    left--;
  }
  return Object.fromEntries(MIX_KEYS.map((k, i) => [k, floors[i] * 10])) as Record<MixKey, number>;
}

type Change = { direction: 'up' | 'down' | 'steady' | 'new' | 'none'; percent: number | null };

function change(cur: number, prev: number): Change {
  if (prev <= 0) return cur > 0 ? { direction: 'new', percent: null } : { direction: 'none', percent: null };
  const pct = Math.round(((cur - prev) / prev) * 20) * 5; // de 5 em 5
  return { direction: pct >= 5 ? 'up' : pct <= -5 ? 'down' : 'steady', percent: pct };
}

// ── Montagem da resposta (lista de permissão) ────────────────────────────

export interface CompareMember {
  userId: string;
  name: string;
  avatar: string | null;
  isMe: boolean;
  shared: boolean;
  levels?: Record<DimKey, RelLevel>;
  strengths?: DimKey[];
  mix?: Record<MixKey, number> | null;
}

export async function groupComparison(viewerId: string, memberIds: string[], period: Period) {
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set([...memberIds, viewerId])] } },
    select: { id: true, name: true, avatar: true, shareProgress: true, timezone: true },
  });
  const sharing = users.filter((u) => u.shareProgress && memberIds.includes(u.id));
  const statsBy = new Map<string, Awaited<ReturnType<typeof loadStats>>>();
  await Promise.all(sharing.map(async (u) => statsBy.set(u.id, await cachedStats(u.id, u.timezone, period))));

  const current = sharing.map((u) => statsBy.get(u.id)!.current);
  const med = mediansOf(current);

  const members: CompareMember[] = users
    .filter((u) => memberIds.includes(u.id))
    .map((u) => {
      const base = { userId: u.id, name: u.name, avatar: u.avatar, isMe: u.id === viewerId };
      const st = statsBy.get(u.id);
      if (!st) return { ...base, shared: false };
      const levels = levelsOf(st.current, med);
      return { ...base, shared: true, levels, strengths: strengthsOf(levels), mix: mixShares(st.current) };
    })
    .sort((a, b) => Number(b.isMe) - Number(a.isMe) || a.name.localeCompare(b.name, 'pt-BR'));

  // Destaques: quem foi mais longe em cada dimensão (sem o valor)
  const highlights: { key: DimKey; names: string[] }[] = [];
  if (sharing.length >= 2) {
    for (const d of DIMENSIONS) {
      const values = sharing.map((u) => {
        const s = statsBy.get(u.id)!.current;
        return { name: u.name, v: d === 'acertos' ? accuracyOf(s) : volumeOf(s, d) };
      });
      const eligible = values.filter((x): x is { name: string; v: number } => x.v !== null && x.v > 0);
      if (d === 'acertos' && eligible.length < 2) continue;
      if (!eligible.length) continue;
      const top = Math.max(...eligible.map((x) => x.v));
      const names = eligible.filter((x) => x.v === top).map((x) => x.name);
      if (names.length <= 3) highlights.push({ key: d, names });
    }
  }

  // Você em relação ao grupo (quem não compartilha também vê a própria posição)
  const viewer = users.find((u) => u.id === viewerId)!;
  let me: { levels: Record<DimKey, RelLevel>; comparedWith: number; sharing: boolean } | null = null;
  const others = sharing.filter((u) => u.id !== viewerId);
  if (others.length > 0) {
    const mine = statsBy.get(viewerId) ?? (await cachedStats(viewerId, viewer.timezone, period));
    const ref = viewer.shareProgress ? med : mediansOf(others.map((u) => statsBy.get(u.id)!.current));
    me = { levels: levelsOf(mine.current, ref), comparedWith: others.length, sharing: viewer.shareProgress };
  }

  // Ritmo do grupo: soma de quem compartilha, período atual vs. anterior
  const previous = sharing.map((u) => statsBy.get(u.id)!.previous);
  const total = (list: RawStats[], d: DimKey) => sum(list.map((s) => volumeOf(s, d)));
  const pulse = Object.fromEntries(PULSE_DIMS.map((d) => [d, change(total(current, d), total(previous, d))])) as Record<
    (typeof PULSE_DIMS)[number],
    Change
  >;
  const qCur = sum(current.map((s) => s.questions));
  const qPrev = sum(previous.map((s) => s.questions));
  const accuracyPoints =
    qCur >= MIN_QUESTIONS_FOR_ACCURACY && qPrev >= MIN_QUESTIONS_FOR_ACCURACY
      ? Math.round((sum(current.map((s) => s.correct)) / qCur - sum(previous.map((s) => s.correct)) / qPrev) * 100)
      : null;

  return {
    period,
    memberCount: memberIds.length,
    sharingCount: sharing.length,
    activeCount: current.filter((s) => s.days > 0 || s.questions > 0 || s.reviews > 0).length,
    members,
    highlights,
    me,
    pulse: { ...pulse, acertos: accuracyPoints === null ? null : { points: accuracyPoints } },
  };
}
