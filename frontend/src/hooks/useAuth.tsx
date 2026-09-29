import { createContext, useContext, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { User } from '../api/types';
import { setAppTimeZone } from '../lib/format';
import { closeFlashcards } from '../flashcards/local';
import { clearOfflineCopy, flushQueue, setOfflineOwner } from '../api/offline';

interface AuthState {
  user: User | null;
  loading: boolean;
  setUser: (u: User | null) => void;
  logout: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return (await api.get<{ user: User }>('/auth/me')).user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  // Datas do app ("hoje") no fuso do perfil
  setAppTimeZone(data?.timezone);
  // Fila de gravações sem internet: de cada conta
  setOfflineOwner(data?.id ?? null);

  const value: AuthState = {
    user: data ?? null,
    loading: isLoading,
    setUser: (u) => qc.setQueryData(['me'], u),
    logout: async () => {
      if (data) await closeFlashcards(data.id);
      await flushQueue();
      await api.post('/auth/logout');
      await clearOfflineCopy();
      // Primeiro o usuário sai (as páginas protegidas desmontam), depois o cache:
      // na ordem inversa o AuthProvider ficava preso ao usuário antigo por um
      // instante e as páginas refaziam chamadas já sem sessão (401).
      qc.setQueryData(['me'], null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    },
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth fora do AuthProvider');
  return ctx;
}
