// Utilitários de data (YYYY-MM-DD) usados pelo motor. Mantidos aqui para que o
// módulo de revisão não dependa do restante da aplicação.

const DAY_MS = 86_400_000;

function toUtc(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(date: string, days: number): string {
  return new Date(toUtc(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Dias corridos de `from` até `to` (positivo se `to` for depois). */
export function diffDays(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}
