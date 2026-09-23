import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCalendar } from '../hooks/api';
import { fmtLong, fmtMonth, plural, todayLocal } from '../lib/format';
import { AreaDot, Card, ErrorState, IconButton, PageHeader, cx } from '../components/ui';
import { ReviewCard } from '../components/study/ReviewCard';

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
  const { data, error, isFetching } = useCalendar(month);

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

  return (
    <div>
      <PageHeader title="Calendário" subtitle="Suas revisões dia a dia. Apenas você vê este calendário." />
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
              return (
                <button
                  key={date}
                  role="gridcell"
                  aria-selected={selected === date}
                  aria-label={`${fmtLong(date)}: ${pending} pendentes, ${done} feitas`}
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
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-ink2">
            <span className="flex items-center gap-1">
              <span className="num rounded-full bg-accent px-1.5 text-[10px] font-semibold text-white">3</span> pendentes
            </span>
            <span className="flex items-center gap-1">
              <span className="num rounded-full bg-crit-wash px-1.5 text-[10px] font-semibold text-crit-text">2</span> atrasadas
            </span>
            <span className="flex items-center gap-1" style={{ color: 'var(--good-text)' }}>
              ✓4 <span className="text-ink2">feitas</span>
            </span>
          </div>
        </Card>

        <Card title={selected ? <span className="inline-block first-letter:uppercase">{fmtLong(selected)}</span> : 'Escolha um dia'}>
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
