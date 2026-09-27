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
  /** Prefixo das rotas: /flashcards (aba do site) ou /cards (versão só de flashcards) */
  base: string;
  /** Versão só de flashcards: sem o título "Flashcards" (a casca já mostra) */
  standalone?: boolean;
  /** Atalho no menu ⋯ para a outra versão (mesma tela) */
  alternate?: { base: string; label: string };
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
