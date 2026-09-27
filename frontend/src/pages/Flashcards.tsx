import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Subject } from '../api/types';
import { useAuth } from '../hooks/useAuth';
import { keys } from '../hooks/api';
import { flashcardsSummaryKey } from '../hooks/flashcards';
import { useStudyDialog } from '../components/study/StudyDialog';
import { normalize } from '../components/study/SubjectPicker';
import { ErrorState, Loading } from '../components/ui';
import type { FlashcardsEngine, FlashcardsStudyInfo } from '../flashcards/types';
import { CARDS_BASE } from '../flashcards/standalone';

/** Assunto da plataforma com o mesmo nome do assunto dos cards (de preferência na mesma área). */
export function matchSubject(subjects: Subject[], info: FlashcardsStudyInfo['subject']) {
  if (!info) return null;
  const name = normalize(info.name.trim());
  const same = subjects.filter((s) => !s.archived && normalize(s.name.trim()) === name);
  if (same.length <= 1) return same[0] ?? null;
  const area = normalize(info.area);
  const sub = normalize(info.subarea);
  const score = (s: Subject) => {
    const path = normalize(s.area?.path ?? '');
    return (path.includes(sub) ? 2 : 0) + (path.includes(area) ? 1 : 0);
  };
  return same.sort((a, b) => score(b) - score(a))[0];
}

/**
 * O motor (flashcards/js) desenha os flashcards dentro desta div, com os dados da
 * conta. O React continua dono da URL, do menu e do tema. Usado pela aba do site
 * (/flashcards) e pela versão só de flashcards (/cards).
 */
export function FlashcardsView({ base, standalone = false }: { base: string; standalone?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const engine = useRef<FlashcardsEngine | null>(null);
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const openStudy = useStudyDialog();
  const qc = useQueryClient();
  const [state, setState] = useState<'loading' | 'ready' | Error>('loading');

  // Sempre a versão mais nova das funções, sem remontar a aba
  const latest = useRef({ navigate, openStudy });
  latest.current = { navigate, openStudy };

  const userId = user?.id;
  useEffect(() => {
    if (!userId || !ref.current) return;
    const el = ref.current;
    let cancelled = false;
    // A versão antiga (site separado) tinha service worker próprio em /flashcards/
    navigator.serviceWorker
      ?.getRegistrations()
      .then((regs) => regs.filter((r) => new URL(r.scope).pathname.startsWith('/flashcards')).forEach((r) => r.unregister()))
      .catch(() => {});

    import('../flashcards/engine')
      .then(({ FC }) => {
        if (cancelled) return;
        engine.current = FC;
        setState('ready');
        return FC.app.mount(el, {
          userId,
          base,
          standalone,
          alternate: standalone ? { base: '/flashcards', label: 'Abrir dentro do Projeto Residente' } : { base: CARDS_BASE, label: 'Abrir só os flashcards (app separado)' },
          navigate: (url, opts) => latest.current.navigate(url, { replace: opts?.replace }),
          onSummary: (summary) => qc.setQueryData(flashcardsSummaryKey, { summary, updatedAt: new Date().toISOString() }),
          registerStudy: async (info) => {
            const subjects = await qc
              .fetchQuery({ queryKey: keys.subjects(), queryFn: () => api.get<Subject[]>('/subjects', { includeArchived: true }), staleTime: 30_000 })
              .catch(() => [] as Subject[]);
            const subject = matchSubject(subjects, info.subject);
            latest.current.openStudy({ subjectId: subject?.id, methods: ['FLASHCARDS'], minutes: info.minutes, notes: info.notes });
          },
        });
      })
      .catch((err: unknown) => !cancelled && setState(err instanceof Error ? err : new Error(String(err))));
    return () => {
      cancelled = true;
      engine.current?.app.unmount();
    };
  }, [userId, qc, base, standalone]);

  useEffect(() => {
    engine.current?.app.onLocation();
  }, [location.pathname, location.search]);

  return (
    <>
      {state === 'loading' && <Loading label="Abrindo os flashcards…" />}
      {state instanceof Error && <ErrorState error={state} />}
      <div ref={ref} />
    </>
  );
}

/** Aba Flashcards do Projeto Residente. */
export default function FlashcardsPage() {
  return <FlashcardsView base="/flashcards" />;
}
