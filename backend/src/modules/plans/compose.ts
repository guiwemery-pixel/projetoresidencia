import { addDays, diffDays } from '../../lib/dates.js';

// Montar um cronograma do zero (sem PDF de cursinho): os assuntos escolhidos vão para
// semanas seguidas a partir do início, num ritmo de N por semana ou até uma data
// (ex.: a prova). "Intercalar" espalha cada grande área ao longo de todo o cronograma,
// em vez de terminar uma área para começar a outra. Puro (sem banco), para testar sozinho.

export type Pace = { kind: 'perWeek'; perWeek: number } | { kind: 'until'; until: string };
export type ComposeOrder = 'interleave' | 'sequence';

export interface ComposeSubject {
  /** Grande área (agrupa para intercalar); null = sem área */
  area: string | null;
}

/**
 * Ordem dos assuntos. `sequence` = como vieram (área por área). `interleave` = cada área
 * espalhada por igual: o i-ésimo assunto de uma área com n assuntos fica na posição
 * (i + ½) / n do cronograma; no empate, a ordem em que as áreas apareceram.
 */
export function orderSubjects<T extends ComposeSubject>(subjects: T[], order: ComposeOrder): T[] {
  if (order === 'sequence') return [...subjects];
  const groups = new Map<string, T[]>();
  for (const s of subjects) {
    const key = s.area ?? '';
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const keyed = [...groups.values()].flatMap((list, g) => list.map((s, i) => ({ s, at: (i + 0.5) / list.length, g })));
  keyed.sort((a, b) => a.at - b.at || a.g - b.g);
  return keyed.map((k) => k.s);
}

/** Quantas semanas cabem de `start` até a semana que contém `until` (pelo menos 1). */
export function weeksUntil(start: string, until: string) {
  return Math.max(1, Math.floor(diffDays(start, until) / 7) + 1);
}

/**
 * Semana (0, 1, 2…) de cada assunto, na ordem. Por semana: blocos de N. Até uma data: os
 * assuntos repartidos pelas semanas disponíveis, com no máximo 1 de diferença entre elas
 * (as primeiras levam a sobra).
 */
export function weekIndexes(count: number, pace: Pace, start: string): number[] {
  if (pace.kind === 'perWeek') {
    const n = Math.max(1, Math.floor(pace.perWeek));
    return Array.from({ length: count }, (_, k) => Math.floor(k / n));
  }
  const weeks = weeksUntil(start, pace.until);
  return Array.from({ length: count }, (_, k) => Math.floor((k * weeks) / count));
}

/** Os assuntos já em ordem, cada um com o início da sua semana. */
export function composeWeeks<T extends ComposeSubject>(subjects: T[], opts: { start: string; pace: Pace; order: ComposeOrder }) {
  const ordered = orderSubjects(subjects, opts.order);
  const idx = weekIndexes(ordered.length, opts.pace, opts.start);
  return ordered.map((s, k) => ({ subject: s, week: idx[k], weekStart: addDays(opts.start, idx[k] * 7) }));
}
