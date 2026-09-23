import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, HelpCircle, PenLine } from 'lucide-react';
import { api } from '../api/client';
import type { Review, SubjectDetail } from '../api/types';
import { METHOD_LABEL, QUALITY, SIZES } from '../lib/constants';
import { fmtShort, pct, plural, relativeDay } from '../lib/format';
import { AreaDot, Button, Card, ErrorState, Loading, StatTile } from '../components/ui';
import { ChartCard, TrendLine } from '../components/charts';
import { useStudyDialog } from '../components/study/StudyDialog';
import { WhyDialog } from '../components/study/ReviewCard';

const LADDER = ['D1', 'D7', 'D21', 'D60', 'D90', 'D90+'];

export default function SubjectDetailPage() {
  const { id } = useParams();
  const openStudy = useStudyDialog();
  const [why, setWhy] = useState<Review | null>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ['subject', id], queryFn: () => api.get<SubjectDetail>(`/subjects/${id}`) });
  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorState error={error} />;

  const { timeline } = data;
  const state = timeline.state;
  const pending = timeline.reviews.find((r) => r.status === 'PENDING');
  const done = timeline.reviews.filter((r) => r.status === 'DONE');
  const chart = timeline.contacts.map((c) => ({ date: c.date, score: c.score === null ? null : Math.round(c.score), accuracy: c.accuracy === null ? null : Math.round(c.accuracy) }));
  const toReview = (r: (typeof timeline.reviews)[number]): Review => ({
    ...r,
    stageLabel: LADDER[Math.min(r.stage, LADDER.length - 1)],
    phase: '',
    subject: { id: data.id, name: data.name, size: data.size, area: data.area },
  });

  return (
    <div className="space-y-5">
      <Link to="/assuntos" className="inline-flex items-center gap-1 text-sm text-ink2 hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Áreas e assuntos
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm text-ink2">
            <AreaDot color={data.area?.color} /> {data.area?.path}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{data.name}</h1>
          <p className="mt-1 text-xs text-muted">
            Assunto {SIZES.find((s) => s.value === data.size)?.label.toLowerCase()}
            {data.tags.length > 0 && ` · ${data.tags.map((t) => `#${t}`).join(' ')}`}
            {data.archived && ' · arquivado'}
          </p>
        </div>
        <Button icon={<PenLine className="h-4 w-4" />} onClick={() => openStudy({ subjectId: data.id })}>
          Registrar estudo
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Questões" value={data.questions.total} sub={`${data.questions.correct} acertos`} />
        <StatTile label="Acertos" value={pct(data.questions.accuracy)} />
        <StatTile label="Contatos" value={state?.contacts ?? 0} sub={state ? `${plural(state.lapses, 'queda', 'quedas')} de retenção` : 'ainda não estudado'} />
        <StatTile
          label="Próxima revisão"
          value={pending ? relativeDay(pending.scheduledFor) : '—'}
          sub={pending ? `${LADDER[Math.min(pending.stage, LADDER.length - 1)]} · ${fmtShort(pending.scheduledFor)}` : undefined}
        />
      </div>

      {state && (
        <Card title="Estado de aprendizagem" subtitle="Cada assunto tem seu próprio histórico: o algoritmo aprende com ele.">
          <div className="flex flex-wrap items-center gap-1.5">
            {LADDER.map((l, i) => (
              <span
                key={l}
                className="rounded-lg px-2.5 py-1 text-xs font-semibold"
                style={i === Math.min(state.stage, LADDER.length - 1) ? { background: 'var(--accent)', color: 'white' } : { background: 'var(--subtle)', color: i < state.stage ? 'var(--ink)' : 'var(--muted)' }}
              >
                {l}
              </span>
            ))}
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted">Facilidade do assunto</dt>
              <dd className="num font-medium text-ink">×{state.ease.toLocaleString('pt-BR')}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Último desempenho</dt>
              <dd className="num font-medium text-ink">{pct(state.lastScore)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Último contato</dt>
              <dd className="font-medium text-ink">{relativeDay(state.lastContactOn)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Intervalo atual</dt>
              <dd className="font-medium text-ink">{plural(state.intervalDays, 'dia', 'dias')}</dd>
            </div>
          </dl>
          {pending && (
            <button className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent" onClick={() => setWhy(toReview(pending))}>
              <HelpCircle className="h-4 w-4" /> Por que a próxima revisão é {relativeDay(pending.scheduledFor)}?
            </button>
          )}
        </Card>
      )}

      {chart.length > 1 && (
        <ChartCard
          title="Curva de desempenho neste assunto"
          subtitle="Pontuação de cada contato (acertos combinados com a autoavaliação)"
          table={{ columns: ['Data', 'Pontuação', 'Acertos'], rows: chart.map((c) => [fmtShort(c.date), pct(c.score), pct(c.accuracy)]) }}
        >
          <TrendLine data={chart} xKey="date" series={[{ key: 'score', name: 'pontuação' }]} formatter={(v) => `${v}%`} xFormatter={fmtShort} yDomain={[0, 100]} />
        </ChartCard>
      )}

      <Card title="Linha do tempo">
        {timeline.contacts.length === 0 ? (
          <p className="text-sm text-muted">Nenhum estudo registrado neste assunto.</p>
        ) : (
          <ol className="relative space-y-4 border-l-2 border-line pl-5">
            {timeline.contacts.map((c, i) => {
              const review = i === 0 ? null : done[i - 1];
              return (
                <li key={c.date}>
                  <span className="absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full border-2" style={{ background: 'var(--surface)', borderColor: 'var(--accent)' }} aria-hidden />
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium text-ink">
                      {i === 0 ? 'D0 — primeiro contato' : `Revisão ${review ? LADDER[Math.min(review.stage, LADDER.length - 1)] : ''}`}
                      <span className="ml-2 text-sm font-normal text-ink2">{fmtShort(c.date)}</span>
                    </p>
                    {c.questions && (
                      <span className="num text-sm text-ink">
                        {c.questions.correct}/{c.questions.total} = <strong>{pct(c.accuracy)}</strong>
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted">
                    {c.methods.map((m) => METHOD_LABEL[m]).join(' + ')}
                    {c.quality && ` · ${QUALITY.find((q) => q.value === c.quality)?.emoji} ${QUALITY.find((q) => q.value === c.quality)?.label}`}
                    {review?.elapsedDays != null && ` · após ${plural(review.elapsedDays, 'dia', 'dias')}`}
                  </p>
                  {review?.nextIntervalDays != null && (
                    <p className="mt-1 text-xs text-ink2">→ próximo intervalo: {plural(review.nextIntervalDays, 'dia', 'dias')}</p>
                  )}
                </li>
              );
            })}
            {pending && (
              <li>
                <span className="absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full" style={{ background: 'var(--accent)' }} aria-hidden />
                <p className="font-medium text-ink">
                  Próxima: {LADDER[Math.min(pending.stage, LADDER.length - 1)]} <span className="text-sm font-normal text-ink2">{fmtShort(pending.scheduledFor)}</span>
                </p>
                <p className="text-xs text-muted">
                  Sugerido: {pending.suggestedMethods.map((m) => METHOD_LABEL[m]).join(', ')}
                  {pending.suggestedQuestions ? ` · ~${pending.suggestedQuestions} questões` : ''}
                </p>
              </li>
            )}
          </ol>
        )}
      </Card>
      {why && <WhyDialog review={why} onClose={() => setWhy(null)} />}
    </div>
  );
}
