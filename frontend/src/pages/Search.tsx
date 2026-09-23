import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search as SearchIcon } from 'lucide-react';
import { api } from '../api/client';
import type { SearchResult } from '../api/types';
import { fmtShort, pct, plural, relativeDay } from '../lib/format';
import { AreaDot, Card, EmptyState, Loading, PageHeader } from '../components/ui';

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [input, setInput] = useState(q);
  useEffect(() => setInput(q), [q]);
  const { data, isFetching } = useQuery({
    queryKey: ['search', q],
    queryFn: () => api.get<SearchResult>('/search', { q }),
    enabled: q.trim().length >= 2,
  });
  const empty = data && !data.areas.length && !data.subjects.length && !data.mockExams.length && !data.exams.length && !data.goals.length;

  return (
    <div className="space-y-5">
      <PageHeader title="Pesquisa" />
      <form
        role="search"
        className="relative max-w-xl"
        onSubmit={(e) => {
          e.preventDefault();
          setParams(input.trim() ? { q: input.trim() } : {});
        }}
      >
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input autoFocus className="input pl-9" placeholder="Ex.: dengue, ENAMED, cirurgia" value={input} onChange={(e) => setInput(e.target.value)} aria-label="Pesquisar" />
      </form>
      {isFetching && <Loading label="Pesquisando…" />}
      {empty && <EmptyState icon="🔎" title={`Nada encontrado para “${q}”`} />}
      {data && !empty && (
        <div className="space-y-5">
          {data.subjects.length > 0 && (
            <Card title="Assuntos">
              <ul className="divide-y divide-line">
                {data.subjects.map((s) => (
                  <li key={s.id} className="py-3">
                    <Link to={`/assuntos/${s.id}`} className="font-medium text-ink hover:underline">
                      {s.name}
                    </Link>
                    <p className="flex items-center gap-1.5 text-xs text-ink2">
                      <AreaDot color={s.area?.color} /> → {s.area?.path}
                    </p>
                    <ul className="num mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink2">
                      <li>→ {plural(s.reviewsDone, 'revisão', 'revisões')}</li>
                      <li>→ {plural(s.simulados, 'simulado', 'simulados')}</li>
                      <li>→ {plural(s.questions, 'questão realizada', 'questões realizadas')}</li>
                      <li>→ {pct(s.accuracy)} de acertos</li>
                      {s.nextReview && (
                        <li style={s.overdue ? { color: 'var(--crit-text)' } : undefined}>
                          → próxima revisão {relativeDay(s.nextReview)} ({fmtShort(s.nextReview)})
                        </li>
                      )}
                    </ul>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <div className="grid gap-5 md:grid-cols-2">
            {data.areas.length > 0 && (
              <Card title="Áreas">
                <ul className="space-y-1.5 text-sm">
                  {data.areas.map((a) => (
                    <li key={a.id}>
                      <Link to="/assuntos" className="text-ink hover:underline">
                        {a.path}
                      </Link>{' '}
                      <span className="text-xs text-muted">· {plural(a.subjects, 'assunto', 'assuntos')}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {data.mockExams.length > 0 && (
              <Card title="Simulados">
                <ul className="space-y-1.5 text-sm">
                  {data.mockExams.map((m) => (
                    <li key={m.id} className="flex justify-between gap-2">
                      <Link to="/simulados" className="text-ink hover:underline">
                        {m.name}
                      </Link>
                      <span className="num text-xs text-ink2">{m.status === 'PLANNED' ? `agendado ${fmtShort(m.takenOn)}` : pct(m.accuracy, 1)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {data.exams.length > 0 && (
              <Card title="Provas">
                <ul className="space-y-1.5 text-sm">
                  {data.exams.map((e) => (
                    <li key={e.id} className="flex justify-between gap-2">
                      <Link to="/provas" className="text-ink hover:underline">
                        {e.board} › {e.name}
                      </Link>
                      <span className="text-xs text-ink2">{plural(e.attempts, 'tentativa', 'tentativas')}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {data.goals.length > 0 && (
              <Card title="Metas">
                <ul className="space-y-1.5 text-sm">
                  {data.goals.map((g) => (
                    <li key={g.id}>
                      <Link to="/metas" className="text-ink hover:underline">
                        {g.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
