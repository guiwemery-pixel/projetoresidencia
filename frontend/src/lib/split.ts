// Divisão de um estudo que englobou vários assuntos (Registrar estudo → "+ Outro assunto").

/** Divide um total em n partes inteiras quase iguais (as primeiras ficam com a sobra). */
export function splitEven(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n);
  const rest = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0));
}

/**
 * Divide os acertos na proporção das questões de cada parte (maiores restos), sem passar
 * das questões de nenhuma parte. Ex.: 21 acertos em 10/10/10 → 7/7/7; 20 → 7/7/6.
 */
export function splitCorrect(correct: number, totals: number[]): number[] {
  const sum = totals.reduce((a, b) => a + b, 0);
  if (!sum) return totals.map(() => 0);
  const exact = totals.map((t) => (Math.min(correct, sum) * t) / sum);
  const out = exact.map((x, i) => Math.min(totals[i], Math.floor(x)));
  let rest = Math.min(correct, sum) - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; rest > 0 && k < order.length * 2; k++) {
    const i = order[k % order.length][1];
    if (out[i] < totals[i]) {
      out[i]++;
      rest--;
    }
  }
  return out;
}
