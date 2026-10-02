import type { SubjectSize } from '@prisma/client';
import { addDays } from '../../lib/dates.js';

// Distribui os assuntos de uma semana do cronograma pelos dias de estudo da pessoa,
// mantendo a ordem do cronograma e equilibrando a carga de cada dia.
// Puro (sem banco), para testar sozinho.

export const WEEKDAY_LABEL = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];

/** Peso de cada assunto no dia (assunto grande ocupa mais que um pequeno). */
export const SIZE_WEIGHT: Record<SubjectSize, number> = { SMALL: 2, MEDIUM: 3, LARGE: 4 };

/** Dia da semana ISO: 1 = segunda … 7 = domingo. */
export function isoWeekday(date: string) {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Dias de estudo entre `start` e `start + 6` (a semana do cronograma pode começar em qualquer dia). */
export function studyDaysOfWeek(weekStart: string, weekdays: number[]) {
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i);
    if (weekdays.includes(isoWeekday(d))) days.push(d);
  }
  return days;
}

/**
 * Em que dia (índice de 0 a dias−1) fica cada assunto, na ordem.
 * - Menos assuntos que dias: espaçados (ex.: 3 assuntos em 5 dias → seg, qua, qui).
 * - Mais assuntos que dias: blocos seguidos com a carga mais parecida possível;
 *   no empate, os primeiros dias ficam com mais (sobra folga no fim da semana).
 */
export function spread(weights: number[], days: number): number[] {
  const k = weights.length;
  if (!k || days <= 0) return weights.map(() => 0);
  if (k <= days) return weights.map((_, i) => Math.round((i * days) / k));
  const prefix = [0];
  for (const w of weights) prefix.push(prefix[prefix.length - 1] + w);
  const load = (i: number, j: number) => prefix[j] - prefix[i]; // itens i..j-1
  // best[g][i]: menor soma dos quadrados das cargas dividindo os itens i..k-1 em g dias
  const best: number[][] = Array.from({ length: days + 1 }, () => Array(k + 1).fill(Infinity));
  const cut: number[][] = Array.from({ length: days + 1 }, () => Array(k + 1).fill(-1));
  best[0][k] = 0;
  for (let g = 1; g <= days; g++) {
    for (let i = k - g; i >= 0; i--) {
      // O dia leva os itens i..j-1; sobram pelo menos g−1 itens para os outros dias
      for (let j = k - (g - 1); j > i; j--) {
        const rest = best[g - 1][j];
        if (rest === Infinity) continue;
        const cost = load(i, j) ** 2 + rest;
        if (cost < best[g][i] - 1e-9) {
          best[g][i] = cost;
          cut[g][i] = j;
        }
      }
    }
  }
  const out: number[] = [];
  let i = 0;
  for (let g = days; g >= 1; g--) {
    const j = cut[g][i];
    while (i < j) out.push(days - g), i++;
  }
  return out;
}

export interface WeekItem {
  id: string;
  weight: number;
  status: 'PENDING' | 'DONE' | 'SKIPPED';
  plannedOn: string | null;
  doneOn: string | null;
}

/**
 * Dia previsto de cada item de uma semana. Semanas futuras e passadas: todos os itens
 * pelos dias de estudo. Semana atual: os estudados/pulados ficam onde estavam e os
 * pendentes vão para os dias de estudo de hoje em diante (se não sobrar nenhum, os
 * dias que restam da semana).
 */
export function planWeek(weekStart: string, items: WeekItem[], weekdays: number[], today: string): Map<string, string> {
  const out = new Map<string, string>();
  const weekEnd = addDays(weekStart, 6);
  const current = weekStart <= today && today <= weekEnd;
  let movable = items;
  let days = studyDaysOfWeek(weekStart, weekdays);
  if (current) {
    movable = items.filter((i) => i.status === 'PENDING');
    for (const i of items) {
      if (i.status === 'PENDING') continue;
      const kept = i.plannedOn ?? (i.doneOn && i.doneOn >= weekStart && i.doneOn <= weekEnd ? i.doneOn : weekStart);
      out.set(i.id, kept);
    }
    const ahead = days.filter((d) => d >= today);
    days = ahead.length ? ahead : studyDaysOfWeek(weekStart, [1, 2, 3, 4, 5, 6, 7]).filter((d) => d >= today);
  }
  const slots = spread(
    movable.map((i) => i.weight),
    days.length,
  );
  movable.forEach((i, n) => out.set(i.id, days[slots[n]]));
  return out;
}

/** Melhor dia para um assunto que entra agora na semana: hoje, se for dia de estudo; senão o próximo dia de estudo da semana. */
export function nextStudyDay(today: string, weekEnd: string, weekdays: number[]) {
  for (let d = today; d <= weekEnd; d = addDays(d, 1)) if (weekdays.includes(isoWeekday(d))) return d;
  return today;
}

/** "segunda a sexta", "segunda, quarta e sexta", "todos os dias" */
export function weekdaysText(weekdays: number[]) {
  const list = [...new Set(weekdays)].sort((a, b) => a - b);
  if (list.length === 7) return 'todos os dias';
  const consecutive = list.length >= 3 && list.every((d, i) => i === 0 || d === list[i - 1] + 1);
  if (consecutive) return `${WEEKDAY_LABEL[list[0]]} a ${WEEKDAY_LABEL[list[list.length - 1]]}`;
  const names = list.map((d) => WEEKDAY_LABEL[d]);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}` : (names[0] ?? '');
}
