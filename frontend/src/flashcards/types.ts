import type { FlashcardsSummary } from '../api/types';

/** Dados de uma sessão de flashcards para o diálogo "Registrar estudo". */
export interface FlashcardsStudyInfo {
  method: 'FLASHCARDS';
  minutes: number;
  /** Assunto mais frequente da sessão (Grande área › Subárea › Assunto) */
  subject: { area: string; subarea: string; name: string } | null;
  notes: string;
}

export interface FlashcardsMountOptions {
  userId: string;
  navigate: (url: string, opts?: { replace?: boolean }) => void;
  registerStudy?: (info: FlashcardsStudyInfo) => void;
  onSummary?: (summary: FlashcardsSummary) => void;
}

/** Parte do motor (flashcards/js, window.FC) usada pelo React. */
export interface FlashcardsEngine {
  app: {
    mount(el: HTMLElement, opts: FlashcardsMountOptions): Promise<void>;
    unmount(): void;
    shutdown(opts?: { clearLocal?: boolean; skipFlush?: boolean }): Promise<boolean>;
    onLocation(): void;
    userId(): string | null;
  };
}
