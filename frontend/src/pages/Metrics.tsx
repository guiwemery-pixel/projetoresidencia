import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronDown, TrendingDown, TrendingUp } from 'lucide-react';
import { api } from '../api/client';
import type { AreaMetric, Bucket, Overview, SubjectMetric } from '../api/types';
import { METHOD_LABEL, PERIOD_PRESETS, levelForPercent } from '../lib/constants';
import { addDaysStr, duration, fmtShort, pct, plural, todayLocal } from '../lib/format';
import { AreaDot, Card, ErrorState, Input, LevelBadge, Loading, PageHeader, ProgressBar, StatTile, cx } from '../components/ui';
import { ChartCard, Columns, TrendLine } from '../components/charts';

type Range = { days: number } | { from: string; to: string };

function rangeQuery(r: Range) {
  return 'days' in r ? { days: r.days } : { from: r.from, to: r.to };
}

function Delta({ value }: { value: number | null }) {
  if (value === null || Math.abs(value) < 0.5) return <span className="text-xs text-muted">—</span>;
  const up = value > 0;
  return (
    <span className="num inline-flex items-center gap-0.5 text-xs font-medium" style={{ color: up ? 'var(--good-text)' : 'var(--crit-text)' }}>
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {up ? '+' : ''}
      {value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} p.p.
    </span>
  );
}

function AreaRow({ area }: { area: AreaMetric }) {
  const [open, setOpen] = useState(false);
  const level = levelForPercent(area.accuracy);
  return (
    <li className="py-2.5">
      <button className="flex w-full items-center gap-3 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open} disabled={!area.children?.length}>
        <AreaDot color={area.color} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium text-ink">{area.name}</span>
            <span className="flex shrink-0 items-center gap-2">
              <Delta value={area.deltaAccuracy} />
              <span className="num w-12 text-right text-sm font-semibold text-ink">{pct(area.accuracy)}</span>
            </span>
          </span>
          <span className="mt-1 block">
            <ProgressBar value={area.accuracy ?? 0} height={6} label={`Acertos em ${area.name}`} />
          </span>
          <span className="mt-1 flex justify-between text-xs text-muted">
            <span>
              {plural(area.questions, 'questão', 'questões')} · {duration(area.minutes)}
            </span>
            {area.accuracy !== null && <LevelBadge level={level} />}
          </span>
        </span>
        {!!area.children?.length && <ChevronDown className={cx('h-4 w-4 shrink-0 text-muted transition', open && 'rotate-180')} />}
      </button>
      {open && (
        <ul className="ml-6 mt-2 space-y-2 border-l border-line pl-4">
          {area.children!.map((c) => (
            <li key={c.id}>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-ink2">{c.name}</span>
                <span className="flex items-center gap-2">
                  <Delta value={c.deltaAccuracy} />
                  <span className="num w-12 text-right font-medium text-ink">{pct(c.accuracy)}</span>
                </span>
              </div>
              <ProgressBar value={c.accuracy ?? 0} height={4} label={`Acertos em ${c.name}`} />
              <p className="mt-0.5 text-xs text-muted">{plural(c.questions, 'questão', 'questões')}</p>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export default function MetricsPage() {
  const today = todayLocal();
  const [range, setRange] = useState<Range>({ days: 30 });
  const [custom, setCustom] = useState({ from: addDaysStr(today, -29), to: today });
  const q = rangeQuery(range);

  const overview = useQuery({ queryKey: ['metrics', 'overview', q], queryFn: () => api.get<Overview>('/metrics/overview', q), placeholderData: (p) => p });
  const series = useQuery({
    queryKey: ['metrics', 'timeseries', q],
    queryFn: () => api.get<{ granularity: string; buckets: Bucket[] }>('/metrics/timeseries', q),
    placeholderData: (p) => p,
  });
  const areas = useQuery({
    queryKey: ['metrics', 'by-area', q],
    queryFn: () => api.get<{ areas: AreaMetric[] }>('/metrics/by-area', q),
    placeholderData: (p) => p,
  });
  const subjects = useQuery({
    queryKey: ['metrics', 'by-subject', q],
    queryFn: () => api.get<SubjectMetric[]>('/metrics/by-subject', q),
    placeholderData: (p) => p,
  });

  const o = overview.data;
  const buckets = series.data?.buckets ?? [];
  const g = series.data?.granularity ?? 'day';
  const unit = g === 'day' ? 'dia' : g === 'week' ? 'semana' : 'mês';
  const xFmt = (d: string) => (g === 'month' ? d.slice(5, 7) + '/' + d.slice(2, 4) : fmtShort(d));
  const topMethods = o ? Object.entries(o.studies.byMethod).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).slice(0, 4) : [];
  const refetching = overview.isFetching || series.isFetching;

  return (
    <div>
      <PageHeader title="Métricas" subtitle="Seus números detalhados. Só você tem acesso a esta página." />

      {/* Filtros: uma linha acima de tudo o que eles afetam */}
      <div className="mb-5 flex flex-wrap items-end gap-2">
        {PERIOD_PRESETS.map((p) => (
          <button
            key={p.days}
            onClick={() => setRange({ days: p.days })}
            className={cx('chip', 'days' in range && range.days === p.days ? 'border-accent bg-accent-wash font-medium text-ink' : 'text-ink2 hover:bg-subtle')}
          >
            {p.label}
          </button>
        ))}
        <details className="relative">
          <summary className={cx('chip cursor-pointer list-none', 'from' in range ? 'border-accent bg-accent-wash text-ink' : 'text-ink2')}>Personalizado</summary>
          <div className="absolute z-20 mt-2 flex w-72 flex-col gap-2 rounded-2xl border border-line bg-surface p-3 shadow-pop">
            <Input label="De" type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            <Input label="Até" type="date" value={custom.to} max={today} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
            <button className="rounded-xl bg-accent px-3 py-2 text-sm font-medium text-white" onClick={() => setRange({ ...custom })}>
              Aplicar
            </button>
          </div>
        </details>
      </div>

      {overview.error && <ErrorState error={overview.error} />}
      {!o ? (
        <Loading />
      ) : (
        <div className={cx('space-y-6 transition-opacity', refetching && 'opacity-60')}>
          <section>
            <h2 className="mb-2 text-sm font-semibold text-ink">📚 Estudos</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatTile label="Tempo estudado" value={duration(o.studies.minutes)} sub={`média ${duration(o.studies.avgMinutesPerStudyDay)} por dia de estudo`} />
              <StatTile label="Sessões" value={o.studies.sessions} sub={`${o.studies.subjectsStudied} assuntos diferentes`} />
              <StatTile label="Dias estudados" value={`${o.studies.daysStudied}/${o.period.days}`} sub={`maior sequência: ${plural(o.studies.bestStreak, 'dia', 'dias')}`} />
              <StatTile label="Sequência atual" value={`🔥 ${o.studies.currentStreak}`} sub={topMethods.length ? `mais usados: ${topMethods.map(([m]) => METHOD_LABEL[m as keyof typeof METHOD_LABEL]).join(', ')}` : 'dias seguidos'} />
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-ink">📝 Questões</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatTile label="Total de questões" value={o.questions.total.toLocaleString('pt-BR')} sub={`${o.questions.perDay.toLocaleString('pt-BR')} por dia`} />
              <StatTile label="Acertos" value={o.questions.correct.toLocaleString('pt-BR')} sub={`${o.questions.wrong.toLocaleString('pt-BR')} erros`} />
              <StatTile label="Percentual de acertos" value={pct(o.questions.accuracy, 1)} tone={levelForPercent(o.questions.accuracy)} />
              <StatTile
                label="Origem"
                value={<span className="text-base">{o.questions.bySource.sessions.total} em estudos</span>}
                sub={`${o.questions.bySource.mocks.total} em simulados · ${o.questions.bySource.exams.total} em provas`}
              />
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-ink">🔄 Revisões</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatTile label="Revisões realizadas" value={o.reviews.done} sub={`${o.reviews.onTime} no prazo · ${o.reviews.late} com atraso`} />
              <StatTile label="Pendentes" value={o.reviews.pending} sub={o.reviews.overdue ? `${o.reviews.overdue} atrasadas` : 'nenhuma atrasada'} tone={o.reviews.overdue > 5 ? 'critico' : o.reviews.overdue > 0 ? 'atencao' : undefined} />
              <StatTile label="Taxa de conclusão" value={pct(o.reviews.completionRate)} sub={`${o.reviews.completedOfDue} de ${o.reviews.dueInPeriod} previstas no período`} />
              <StatTile label="Desempenho nas revisões" value={pct(o.reviews.avgPerformance)} sub="média da pontuação" />
            </div>
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <ChartCard
              title="Percentual de acertos ao longo do tempo"
              subtitle={`Por ${unit}`}
              table={{ columns: ['Período', 'Questões', 'Acertos', '%'], rows: buckets.map((b) => [xFmt(b.start), b.questions, b.correct, pct(b.accuracy, 1)]) }}
            >
              <TrendLine data={buckets} xKey="start" series={[{ key: 'accuracy', name: 'acertos' }]} formatter={(v) => `${Math.round(v)}%`} xFormatter={xFmt} yDomain={[0, 100]} area />
            </ChartCard>
            <ChartCard
              title={`Questões por ${unit}`}
              table={{ columns: ['Período', 'Questões'], rows: buckets.map((b) => [xFmt(b.start), b.questions]) }}
            >
              <Columns data={buckets} xKey="start" yKey="questions" name="questões" xFormatter={xFmt} />
            </ChartCard>
            <ChartCard
              title={`Horas estudadas por ${unit}`}
              table={{ columns: ['Período', 'Horas', 'Sessões'], rows: buckets.map((b) => [xFmt(b.start), b.hours, b.sessions]) }}
            >
              <Columns data={buckets} xKey="start" yKey="hours" name="horas" xFormatter={xFmt} formatter={(v) => `${v.toLocaleString('pt-BR')} h`} />
            </ChartCard>
            <ChartCard
              title={`Revisões realizadas por ${unit}`}
              table={{ columns: ['Período', 'Revisões'], rows: buckets.map((b) => [xFmt(b.start), b.reviewsDone]) }}
            >
              <Columns data={buckets} xKey="start" yKey="reviewsDone" name="revisões" xFormatter={xFmt} />
            </ChartCard>
          </div>

          <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
            <Card title="Desempenho por área" subtitle="Variação em pontos percentuais vs. o período anterior de mesmo tamanho. Toque para ver subáreas.">
              {areas.data?.areas.filter((a) => a.questions || a.minutes).length ? (
                <ul className="divide-y divide-line">
                  {areas.data.areas
                    .filter((a) => a.questions || a.minutes)
                    .map((a) => (
                      <AreaRow key={a.id} area={a} />
                    ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">Sem questões no período.</p>
              )}
            </Card>
            <Card title="Desempenho por assunto" subtitle="Tendência calculada pelas três últimas sessões de questões.">
              {subjects.data?.length ? (
                <div className="-mx-4 max-h-[28rem] overflow-auto sm:mx-0">
                  <table className="num w-full min-w-[520px] text-left text-sm">
                    <thead className="sticky top-0 bg-surface text-xs text-muted">
                      <tr>
                        <th className="px-4 py-2 pr-3 font-medium sm:pl-0">Assunto</th>
                        <th className="py-2 pr-3 font-medium">Questões</th>
                        <th className="py-2 pr-3 font-medium">Acertos</th>
                        <th className="py-2 pr-3 font-medium">Últimas</th>
                        <th className="whitespace-nowrap py-2 font-medium">Tempo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subjects.data.map((s) => (
                        <tr key={s.id} className="border-t border-line">
                          <td className="px-4 py-2 sm:px-0">
                            <Link to={`/assuntos/${s.id}`} className="block hover:underline">
                              <span className="block truncate text-ink">{s.name}</span>
                              <span className="flex items-center gap-1 text-xs text-muted">
                                <AreaDot color={s.area?.color} /> {s.area?.path}
                              </span>
                            </Link>
                          </td>
                          <td className="py-2 pr-3 text-ink2">{s.questions}</td>
                          <td className="py-2 pr-3 font-medium text-ink">{pct(s.accuracy)}</td>
                          <td className="py-2 pr-3 text-xs text-ink2">
                            {s.recentAccuracy.length ? s.recentAccuracy.map((v) => `${Math.round(v)}%`).join(' → ') : '—'}
                            {s.trend === 'queda' && <TrendingDown className="ml-1 inline h-3 w-3" style={{ color: 'var(--crit)' }} aria-label="queda" />}
                            {s.trend === 'melhora' && <TrendingUp className="ml-1 inline h-3 w-3" style={{ color: 'var(--good)' }} aria-label="melhora" />}
                          </td>
                          <td className="whitespace-nowrap py-2 text-ink2">{duration(s.minutes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted">Sem estudos no período.</p>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
