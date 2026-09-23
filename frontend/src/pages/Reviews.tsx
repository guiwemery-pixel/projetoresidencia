import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { Review } from '../api/types';
import { useAgenda } from '../hooks/api';
import { fmtShort, fmtWeekday, pct, plural } from '../lib/format';
import { QUALITY } from '../lib/constants';
import { AreaDot, Card, EmptyState, ErrorState, Loading, PageHeader, Segmented } from '../components/ui';
import { ReviewCard, WhyDialog } from '../components/study/ReviewCard';

type Tab = 'hoje' | 'proximas' | 'historico';

export default function ReviewsPage() {
  const [tab, setTab] = useState<Tab>('hoje');
  const agenda = useAgenda(30);
  const history = useQuery({
    queryKey: ['reviews', 'history'],
    queryFn: () => api.get<Review[]>('/reviews', { status: 'DONE', order: 'desc', limit: 100 }),
    enabled: tab === 'historico',
  });
  const [why, setWhy] = useState<Review | null>(null);

  const overdue = agenda.data?.overdue ?? [];
  const today = agenda.data?.today ?? [];
  const upcoming = agenda.data?.upcoming ?? [];
  const byDay = upcoming.reduce<Record<string, Review[]>>((acc, r) => ((acc[r.scheduledFor] ??= []).push(r), acc), {});

  return (
    <div>
      <PageHeader
        title="Revisões"
        subtitle="Agendadas automaticamente pelo algoritmo a partir do seu desempenho em cada assunto."
        actions={
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            ariaLabel="Filtro de revisões"
            options={[
              { value: 'hoje', label: `Hoje${overdue.length + today.length ? ` (${overdue.length + today.length})` : ''}` },
              { value: 'proximas', label: 'Próximas 30 dias' },
              { value: 'historico', label: 'Histórico' },
            ]}
          />
        }
      />
      {agenda.isLoading && <Loading />}
      {agenda.error && <ErrorState error={agenda.error} />}

      {tab === 'hoje' && agenda.data && (
        <div className="space-y-5">
          {overdue.length > 0 && (
            <Card title={`⚠️ Atrasadas (${overdue.length})`} subtitle="Comece pelas mais antigas. Se estiver sobrecarregado, reagende algumas para os próximos dias.">
              <div className="space-y-2">
                {overdue.map((r) => (
                  <ReviewCard key={r.id} review={r} />
                ))}
              </div>
            </Card>
          )}
          <Card title={`🔄 Para hoje (${today.length})`}>
            {today.length ? (
              <div className="space-y-2">
                {today.map((r) => (
                  <ReviewCard key={r.id} review={r} />
                ))}
              </div>
            ) : (
              <EmptyState icon="✅" title="Nenhuma revisão para hoje">
                {upcoming[0] ? `A próxima é ${upcoming[0].subject.name}, em ${fmtShort(upcoming[0].scheduledFor)}.` : 'Registre estudos para gerar revisões.'}
              </EmptyState>
            )}
          </Card>
        </div>
      )}

      {tab === 'proximas' && agenda.data && (
        <div className="space-y-4">
          {Object.keys(byDay).length === 0 && <EmptyState icon="📭" title="Nenhuma revisão nos próximos 30 dias" />}
          {Object.entries(byDay).map(([day, list]) => (
            <Card key={day} title={<span className="inline-block first-letter:uppercase">{`${fmtWeekday(day)}, ${fmtShort(day)} — ${plural(list.length, 'revisão', 'revisões')}`}</span>}>
              <div className="space-y-2">
                {list.map((r) => (
                  <ReviewCard key={r.id} review={r} compact />
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {tab === 'historico' && (
        <Card title="Revisões realizadas" subtitle="Cada linha registra o desempenho e o intervalo calculado em seguida.">
          {history.isLoading ? (
            <Loading />
          ) : history.data?.length ? (
            <div className="-mx-4 overflow-x-auto sm:mx-0">
              <table className="num w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium sm:px-0">Assunto</th>
                    <th className="py-2 font-medium">Etapa</th>
                    <th className="py-2 font-medium">Prevista</th>
                    <th className="py-2 font-medium">Feita</th>
                    <th className="py-2 font-medium">Desempenho</th>
                    <th className="py-2 font-medium">Autoavaliação</th>
                    <th className="py-2 font-medium">Próx. intervalo</th>
                  </tr>
                </thead>
                <tbody>
                  {history.data.map((r) => (
                    <tr key={r.id} className="border-t border-line">
                      <td className="px-4 py-2 sm:px-0">
                        <Link to={`/assuntos/${r.subject.id}`} className="flex items-center gap-2 text-ink hover:underline">
                          <AreaDot color={r.subject.area?.color} /> {r.subject.name}
                        </Link>
                      </td>
                      <td className="py-2 text-ink2">{r.stageLabel}</td>
                      <td className="py-2 text-ink2">{fmtShort(r.scheduledFor)}</td>
                      <td className="py-2 text-ink2">{r.completedOn ? fmtShort(r.completedOn) : '—'}</td>
                      <td className="py-2 text-ink">{r.performance !== null ? pct(r.performance) : r.score !== null ? `${pct(r.score)}*` : '—'}</td>
                      <td className="py-2">{QUALITY.find((q) => q.value === r.quality)?.emoji ?? '—'}</td>
                      <td className="py-2">
                        <button className="text-accent hover:underline" onClick={() => setWhy(r)}>
                          {r.nextIntervalDays !== null ? plural(r.nextIntervalDays, 'dia', 'dias') : '—'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon="🗂️" title="Nenhuma revisão realizada ainda" />
          )}
        </Card>
      )}
      {why && <WhyDialog review={why} onClose={() => setWhy(null)} />}
    </div>
  );
}
