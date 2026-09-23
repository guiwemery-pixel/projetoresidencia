import { addDays, diffDays } from '../modules/scheduler/index.js';

export { addDays, diffDays };

// Datas "locais" trafegam como string YYYY-MM-DD e são gravadas em colunas DATE.

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Data de hoje no fuso do usuário. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** String YYYY-MM-DD → Date (meia-noite UTC), formato esperado pelo Prisma em colunas DATE. */
export function toDb(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/** Date vinda de uma coluna DATE → YYYY-MM-DD. */
export function fromDb(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function fromDbOrNull(date: Date | null | undefined): string | null {
  return date ? fromDb(date) : null;
}

/** Segunda-feira da semana de `date`. */
export function startOfWeek(date: string): string {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = domingo
  return addDays(date, d === 0 ? -6 : 1 - d);
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: string): string {
  const [y, m] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function maxDate(a: string, b: string) {
  return a > b ? a : b;
}

export function minDate(a: string, b: string) {
  return a < b ? a : b;
}

/** Lista de datas de `from` até `to` (inclusive). */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
