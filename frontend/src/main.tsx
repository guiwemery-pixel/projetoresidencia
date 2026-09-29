import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from './api/client';
import { App } from './App';
import { AuthProvider } from './hooks/useAuth';
import { ToastProvider } from './components/ui';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    // "always": sem internet as telas ainda pedem os dados, e o service worker responde com
    // a última cópia guardada (em vez de ficarem carregando para sempre)
    queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: (n, err) => n < 1 && !(err instanceof ApiError && err.status === 0), networkMode: 'always' },
    mutations: { networkMode: 'always' },
  },
});

// Abre sem internet (public/sw.js). Só no site publicado: no desenvolvimento o Vite recarrega tudo.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
