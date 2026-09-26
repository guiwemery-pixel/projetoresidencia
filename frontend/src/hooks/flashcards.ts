import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { FlashcardsSummary } from '../api/types';

export const flashcardsSummaryKey = ['flashcards', 'summary'] as const;

export interface FlashcardsSummaryResponse {
  summary: FlashcardsSummary | null;
  updatedAt: string | null;
}

/** Resumo do dia dos flashcards (menu lateral e widget do Início). */
export const useFlashcardsSummary = () =>
  useQuery({
    queryKey: flashcardsSummaryKey,
    queryFn: () => api.get<FlashcardsSummaryResponse>('/flashcards/summary'),
    staleTime: 60_000,
    refetchInterval: 10 * 60_000,
  });
