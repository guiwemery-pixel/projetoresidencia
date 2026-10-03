import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus, ChevronLeft, ChevronRight, Printer } from 'lucide-react';
import { useCalendar, usePlanItems } from '../hooks/api';
import { fmtLong, fmtMonth, plural, startOfWeekStr, todayLocal } from '../lib/format';
import { AreaDot, Card, ErrorState, IconButton, PageHeader, cx } from '../components/ui';
import { ReviewCard } from '../components/study/ReviewCard';
import { PlanItemCard, weekLabel } from '../components/study/PlanItemCard';
import { GoogleCalendarDialog } from '../components/calendar/GoogleCalendarDialog';
import { ReviewLimitButton } from '../components/study/ReviewLimit';

const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function CalendarPage() {
  const today = todayLocal();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState<string | null>(today);
  const [syncOpen, setSyncOpen] = useState(false);
  const { data, error, isFetching } = useCalendar(month);
  const monthEnd = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
  }, [month]);
  const planItems = usePlanItems(`${month}-01`, monthEnd).data ?? [];

  const cells = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const offset = (first.getDay() + 6) % 7; // segunda = 0
    const daysInMonth = new Date(y, m, 0).getDate();
    const list: (string | null)[] = Array(offset).fill(null);
    for (let d = 1; d <= daysInMonth; d++) list.push(`${month}-${String(d).padStart(2, '0')}`);
    while (list.length % 7) list.push(null);
    return list;
  }, [month]);

  const byDate = new Map((data?.days ?? []).map((d) => [d.date, d]));
  const day = selected ? byDate.get(selected) : undefined;
  // Cronograma: cada assunto no seu dia de estudo; hoje mostra também o que ficou para trás nesta semana
  const planByDay = new Map<string, typeof planItems>();
  for (const i of planItems) planByDay.set(i.plannedOn, [...(planByDay.get(i.plannedOn) ?? []), i]);
  const selectedDay = selected ? (planByDay.get(selected) ?? []) : [];
  const behind = selected === today ? planItems.filter((i) => i.behind) : [];
  const planInMonth = planItems.filter((i) => i.plannedOn >= `${month}-01` && i.plannedOn <= monthEnd);

  return (
    <div>
      <PageHeader
        title="Calendário"
        subtitle={
          <>
            Suas revisões dia a dia e os assuntos do cronograma em cada dia de estudo. Apenas você vê este calendário.
            <ReviewLimitButton className="mt-1.5 flex" />
          </>
        }
        actions={
          <>
            <button
              type="button"
              onClick={() => setSyncOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-subtle"
            >
              <CalendarPlus className="h-4 w-4" /> Google Agenda
            </button>
            <Link
              to={`/calendario/imprimir?semana=${startOfWeekStr(selected ?? today)}`}
              className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-subtle"
            >
              <Printer className="h-4 w-4" /> Imprimir semana
            </Link>
          </>
        }
      />
      <GoogleCalendarDialog open={syncOpen} onClose={() => setSyncOpen(false)} />
      {error && <ErrorState error={error} />}
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <IconButton label="Mês anterior" onClick={() => setMonth(shiftMonth(month, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </IconButton>
            <div className="text-center">
              <p className="font-semibold first-letter:uppercase text-ink">{fmtMonth(`${month}-01`)}</p>
              {data && (
                <p className="text-xs text-muted">
                  {plural(data.totals.pending, 'pendente', 'pendentes')} · {plural(data.totals.done, 'feita', 'feitas')}
                  {data.totals.overdue > 0 && ` · ${data.totals.overdue} atrasadas`}
                  {planInMonth.length > 0 && ` · ${plural(planInMonth.length, 'assunto', 'assuntos')} do cronograma`}
                </p>
              )}
            </div>
            <IconButton label="Próximo mês" onClick={() => setMonth(shiftMonth(month, 1))}>
              <ChevronRight className="h-4 w-4" />
            </IconButton>
          </div>
          <div className={cx('grid grid-cols-7 gap-1 transition-opacity', isFetching && 'opacity-60')} role="grid" aria-label="Calendário de revisões">
            {WEEKDAYS.map((w) => (
              <div key={w} className="pb-1 text-center text-[11px] font-medium text-muted">
                {w}
              </div>
            ))}
            {cells.map((date, i) => {
              if (!date) return <div key={`e${i}`} />;
              const d = byDate.get(date);
              const pending = d?.pending.length ?? 0;
              const done = d?.done.length ?? 0;
              const overdue = pending > 0 && date < today;
              const planned = planByDay.get(date) ?? [];
              const plannedPending = planned.filter((i) => i.status === 'PENDING');
              return (
                <button
                  key={date}
                  role="gridcell"
                  aria-selected={selected === date}
                  aria-label={`${fmtLong(date)}: ${pending} pendentes, ${done} feitas${planned.length ? `, ${planned.length} assuntos do cronograma` : ''}`}
                  onClick={() => setSelected(date)}
                  className={cx(
                    'flex aspect-square flex-col items-center justify-start gap-0.5 rounded-xl border p-1 text-sm transition sm:aspect-[4/3]',
                    selected === date ? 'border-accent bg-accent-wash' : 'border-transparent hover:bg-subtle',
                    date === today && selected !== date && 'border-line',
                  )}
                >
                  <span className={cx('num text-xs sm:text-sm', date === today ? 'font-bold text-accent' : 'text-ink')}>{Number(date.slice(8))}</span>
                  {pending > 0 && (
                    <span
                      className={cx('num rounded-full px-1.5 text-[10px] font-semibold sm:text-[11px]', overdue ? 'bg-crit-wash text-crit-text' : 'bg-accent text-white')}
                      title={`${pending} revisões`}
                    >
                      {pending}
                    </span>
                  )}
                  {done > 0 && pending === 0 && (
                    <span className="text-[10px] sm:text-[11px]" style={{ color: 'var(--good-text)' }}>
                      ✓{done}
                    </span>
                  )}
                  {planned.length > 0 && (
                    <span
                      className={cx('num text-[10px] font-medium sm:text-[11px]', plannedPending.some((i) => i.overdue) ? 'text-crit-text' : 'text-ink2')}
                      title={`${planned.length} assuntos do cronograma neste dia`}
                    >
                      📚{plannedPending.length || '✓'}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {/* Legenda (só as cores; os números de cada dia estão no próprio calendário) */}
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-ink2">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-accent" /> revisões pendentes
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-crit-wash ring-1 ring-crit" /> revisões atrasadas
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden style={{ color: 'var(--good-text)' }}>
                ✓
              </span>{' '}
              revisões feitas
            </span>
            {planItems.length > 0 && (
              <span className="flex items-center gap-1.5">
                <span aria-hidden>📚</span> assuntos do cronograma
              </span>
            )}
          </div>
        </Card>

        <Card title={selected ? <span className="inline-block first-letter:uppercase">{fmtLong(selected)}</span> : 'Escolha um dia'}>
          {selectedDay.length > 0 && (
            <div className="mb-4 space-y-2">
              <p className="text-sm font-medium text-ink">
                📚 Cronograma do dia · {weekLabel(selectedDay.find((i) => !/b[oô]nus/i.test(i.label ?? ''))?.label ?? selectedDay[0].label)}
                {!selectedDay[0].distributed && <span className="font-normal text-ink2"> (semana toda — escolha seus dias de estudo no Cronograma)</span>}
              </p>
              {selectedDay.map((i) => (
                <PlanItemCard key={i.id} item={i} compact showWeek={false} showDay={false} />
              ))}
            </div>
          )}
          {behind.length > 0 && (
            <div className="mb-4 space-y-2">
              <p className="text-sm font-medium text-ink">📚 Ficaram para trás nesta semana</p>
              {behind.map((i) => (
                <PlanItemCard key={i.id} item={i} compact showWeek={false} />
              ))}
            </div>
          )}
          {!day || (day.pending.length === 0 && day.done.length === 0) ? (
            <p className="text-sm text-muted">Nenhuma revisão neste dia.</p>
          ) : (
            <div className="space-y-4">
              {day.pending.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-ink">🔄 {plural(day.pending.length, 'revisão', 'revisões')}</p>
                  {day.pending.map((r) => (
                    <ReviewCard key={r.id} review={r} compact />
                  ))}
                </div>
              )}
              {day.done.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-medium text-ink">✓ Realizadas</p>
                  <ul className="space-y-1.5">
                    {day.done.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="flex min-w-0 items-center gap-2 truncate text-ink">
                          <AreaDot color={r.subject.area?.color} /> {r.subject.name}
                        </span>
                        <span className="num shrink-0 text-xs text-ink2">{r.performance !== null ? `${Math.round(r.performance)}%` : ''}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
