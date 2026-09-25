// Ajuste gradual do intervalo pela quantidade de questões (espelha o motor do
// backend: interpolação linear entre os pontos; a referência vale ×1).

export interface QuestionCountConfig {
  reference: number;
  points: { questions: number; factor: number }[];
}

export function questionCountFactor(questions: number, config: QuestionCountConfig): number {
  const points = [...config.points].sort((a, b) => a.questions - b.questions);
  if (!points.length) return 1;
  if (questions <= points[0].questions) return points[0].factor;
  const last = points[points.length - 1];
  if (questions >= last.questions) return last.factor;
  const i = points.findIndex((p) => p.questions >= questions);
  const [a, b] = [points[i - 1], points[i]];
  return Math.round((a.factor + ((questions - a.questions) / (b.questions - a.questions)) * (b.factor - a.factor)) * 100) / 100;
}
