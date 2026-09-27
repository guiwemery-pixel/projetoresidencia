import type { FlashcardsSummary } from '../api/types';

const DAY = 86_400_000;

/** Início do "dia de estudo" dos flashcards (vira às `rolloverHour`, hora local). */
export function studyDayStart(ts: number, rolloverHour: number) {
  const d = new Date(ts);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), rolloverHour, 0, 0, 0);
  if (d < start) start.setDate(start.getDate() - 1);
  return start.getTime();
}

export interface FlashcardsToday {
  /** Revisões (e cards em aprendizagem) que vencem até o fim de hoje */
  due: number;
  /** Cards novos liberados hoje (limite diário) */
  newToday: number;
  /** Tudo o que a revisão normal mostra hoje */
  total: number;
  reviewed: number;
  correct: number;
  minutes: number;
  streak: number;
  cards: number;
}

/**
 * O que há para hoje a partir do resumo salvo pelo app. Os cards só mudam
 * quando são revisados no app (que então salva um resumo novo); se o último
 * resumo é de outro dia, a previsão por dia diz quantos venceram desde então.
 */
export function flashcardsToday(s: FlashcardsSummary, now = Date.now()): FlashcardsToday {
  const today = studyDayStart(now, s.rolloverHour);
  const offset = Math.round((today - s.dayStart) / DAY);
  if (offset <= 0) {
    const newToday = s.newToday;
    return { due: s.due, newToday, total: s.due + newToday, reviewed: s.reviewed, correct: s.correct, minutes: s.minutes, streak: s.streak, cards: s.total };
  }
  const due = s.forecast.slice(0, offset + 1).reduce((a, b) => a + b, 0);
  const newToday = Math.min(s.newAvailable, s.newPerDay);
  // A sequência continua se houve estudo no dia do resumo e ele foi ontem
  const streak = offset === 1 && s.reviewed > 0 ? s.streak : 0;
  return { due, newToday, total: due + newToday, reviewed: 0, correct: 0, minutes: 0, streak, cards: s.total };
}
