import { Link, useNavigate } from 'react-router-dom';
import { ExternalLink, LogOut } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { ThemeToggle } from '../components/layout/AppLayout';
import { Avatar, IconButton } from '../components/ui';
import { CARDS_BASE, useFlashcardsAppHead } from '../flashcards/standalone';
import { FlashcardsView } from './Flashcards';

/** Nome, ícone e manifesto do app de flashcards (componente à parte: ver o comentário abaixo). */
function AppHead() {
  useFlashcardsAppHead();
  return null;
}

/**
 * Versão só de flashcards (/cards): os mesmos flashcards e a mesma conta da aba do
 * site, numa tela própria, sem o menu do Projeto Residente — instalável no celular
 * como um app separado ("Flashcards").
 */
export default function FlashcardsAppPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-page backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 py-2.5 sm:px-6">
          <Link to={CARDS_BASE} className="flex items-center gap-2.5" aria-label="Flashcards — início">
            <img src="/icons/flashcards-128.png" alt="" className="h-8 w-8 rounded-lg" />
            <span className="text-lg font-semibold tracking-tight text-ink">Flashcards</span>
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <Link
              to="/"
              className="flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-sm font-medium text-ink2 hover:bg-subtle hover:text-ink"
              title="Abrir o Projeto Residente (mesma conta)"
            >
              <img src="/icons/mark-128.png" alt="" className="h-5 w-5 rounded" />
              <span className="hidden sm:inline">Projeto Residente</span>
              <ExternalLink className="hidden h-3.5 w-3.5 sm:inline" />
            </Link>
            <ThemeToggle />
            <Link to="/perfil" className="rounded-xl p-1 hover:bg-subtle" aria-label="Meu perfil (Projeto Residente)">
              <Avatar name={user.name} src={user.avatar} size={30} />
            </Link>
            <IconButton
              label="Sair"
              onClick={async () => {
                await logout();
                navigate('/entrar', { state: { from: CARDS_BASE } });
              }}
            >
              <LogOut className="h-4 w-4" />
            </IconButton>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 pb-10 pt-5 sm:px-6">
        <FlashcardsView base={CARDS_BASE} standalone />
      </main>
      {/* Depois do FlashcardsView de propósito: ao sair, o React desfaz os efeitos na ordem
          da árvore, e o nome/ícone do site precisam ser restaurados por último. */}
      <AppHead />
    </div>
  );
}
