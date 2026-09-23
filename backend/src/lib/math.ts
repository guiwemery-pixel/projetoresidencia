export const round = (n: number, digits = 1) => {
  const k = 10 ** digits;
  return Math.round(n * k) / k;
};

export const ratio = (num: number, den: number) => (den > 0 ? num / den : null);

export const percent = (num: number, den: number, digits = 1) => (den > 0 ? round((num / den) * 100, digits) : null);

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Número formatado em pt-BR (vírgula decimal). */
export const br = (n: number | null | undefined, digits = 1) =>
  n === null || n === undefined ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: digits });

export const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
