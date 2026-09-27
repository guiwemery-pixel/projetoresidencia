import { useEffect } from 'react';

/** Endereço da versão só de flashcards (mesma conta e mesmos dados da aba do site). */
export const CARDS_BASE = '/cards';

export const isCardsPath = (path: string) => path === CARDS_BASE || path.startsWith(`${CARDS_BASE}/`);

/**
 * Domínio próprio para os flashcards (ex.: flashcards-seunome.vercel.app apontando
 * para o mesmo projeto no Vercel): a página inicial abre direto a versão só de flashcards.
 */
export const isFlashcardsHost = () => /^(flashcards|cards)[.-]/i.test(window.location.hostname);

// [seletor, atributo, valor no app de flashcards, valor no site]
const HEAD: [string, string, string, string][] = [
  ['link[rel="manifest"]', 'href', '/cards.webmanifest', '/manifest.webmanifest'],
  ['link[rel="apple-touch-icon"]', 'href', '/icons/flashcards-apple-touch.png', '/icons/apple-touch-icon.png'],
  ['link[rel="icon"][type="image/png"]', 'href', '/icons/flashcards-32.png', '/icons/favicon-32.png'],
  ['meta[name="apple-mobile-web-app-title"]', 'content', 'Flashcards', 'Projeto Residente'],
  ['meta[name="application-name"]', 'content', 'Flashcards', 'Projeto Residente'],
];

/**
 * Nome, ícone e manifesto do app de flashcards enquanto a versão separada está aberta
 * (o theme-init.js faz o mesmo quando a página já abre em /cards). Ao sair, volta o do site.
 */
export function useFlashcardsAppHead() {
  useEffect(() => {
    for (const [sel, attr, app] of HEAD) document.querySelector(sel)?.setAttribute(attr, app);
    return () => {
      for (const [sel, attr, , site] of HEAD) document.querySelector(sel)?.setAttribute(attr, site);
      document.title = 'Projeto Residente';
    };
  }, []);
}
