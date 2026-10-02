import { useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, Check, Clock, Play, SkipForward, Undo2 } from 'lucide-react';
import type { PlanItem } from '../../api/types';
import { useUpdatePlanItem } from '../../hooks/api';
import { useAuth } from '../../hooks/useAuth';
import { addDaysStr, dayLabel, duration, fmtShort, relativeDay, todayLocal, weekdayLong } from '../../lib/format';
import { AreaDot, Button, Input, Modal, cx, useToast } from '../ui';
import { useStudyDialog } from './StudyDialog';

/** "13/10 a 19/10" */
export const weekRange = (item: Pick<PlanItem, 'weekStart' | 'weekEnd'>) => `${fmtShort(item.weekStart)} a ${fmtShort(item.weekEnd)}`;

/** Rótulo da semana sem o " · bônus" (ex.: "Módulo 03"). */
export const weekLabel = (label: string | null) => (label ?? '').replace(/\s*·\s*b[oô]nus$/i, '') || 'Semana';

export function PlanRescheduleDialog({ item, onClose }: { item: PlanItem; onClose: () => void }) {
  const { user } = useAuth();
  const today = todayLocal();
  const studyDays = user?.studyWeekdays?.length ? user.studyWeekdays : [1, 2, 3, 4, 5];
  const isStudyDay = (d: string) => studyDays.includes(new Date(`${d}T00:00:00Z`).getUTCDay() || 7);
  // Próximos dias de estudo (a partir de hoje) e o mesmo dia na semana seguinte
  const options = useMemo(() => {
    const list: { label: string; date: string }[] = [];
    for (let d = today; list.length < 5 && d <= addDaysStr(today, 14); d = addDaysStr(d, 1)) if (isStudyDay(d) || d === today) list.push({ label: dayLabel(d, today), date: d });
    const nextWeek = addDaysStr(item.plannedOn < today ? today : item.plannedOn, 7);
    if (!list.some((o) => o.date === nextWeek)) list.push({ label: `Semana que vem (${dayLabel(nextWeek, today)})`, date: nextWeek });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, item.plannedOn, studyDays.join()]);
  const [date, setDate] = useState(options.find((o) => o.date > item.plannedOn)?.date ?? options[0].date);
  const update = useUpdatePlanItem();
  const toast = useToast();
  const save = async () => {
    try {
      await update.mutateAsync({ id: item.id, plannedOn: date });
      toast.success(`${item.subject.name} foi para ${dayLabel(date, today) === 'hoje' ? 'hoje' : `${weekdayLong(date)}, ${fmtShort(date)}`}.`);
      onClose();
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Mudar o dia"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={update.isPending} onClick={save}>
            Salvar
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-ink2">
        {item.subject.name} — previsto para {item.distributed ? `${weekdayLong(item.plannedOn)}, ${fmtShort(item.plannedOn)}` : `a semana de ${weekRange(item)}`}. Num dia de outra semana, o assunto
        passa para aquela semana e só aparece como atrasado depois dela.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        {options.map((o) => (
          <button key={o.date} type="button" onClick={() => setDate(o.date)} className={cx('chip', date === o.date ? 'border-accent bg-accent-wash text-ink' : 'text-ink2')}>
            {o.label}
          </button>
        ))}
      </div>
      <Input label="Dia" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
    </Modal>
  );
}

/**
 * Assunto previsto no cronograma. "Estudar" abre o registro de estudo já com o
 * assunto e o tempo sugerido; ao salvar, o item fica concluído e as revisões são agendadas.
 * `showDay`: mostra o dia previsto (listas que não estão agrupadas por dia).
 */
export function PlanItemCard({
  item,
  compact,
  showWeek = true,
  showDay = true,
  full,
}: {
  item: PlanItem;
  compact?: boolean;
  showWeek?: boolean;
  showDay?: boolean;
  full?: boolean;
}) {
  const openStudy = useStudyDialog();
  const update = useUpdatePlanItem();
  const toast = useToast();
  const [move, setMove] = useState(false);
  const today = todayLocal();
  const pending = item.status === 'PENDING';
  const set = async (status: PlanItem['status'], message: string) => {
    try {
      await update.mutateAsync({ id: item.id, status });
      toast.success(message);
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <div
      className={cx('flex flex-col gap-2 rounded-xl border border-line bg-surface p-3', !compact && 'md:flex-row md:items-center', item.overdue && 'border-l-4', !pending && 'opacity-75')}
      style={item.overdue ? { borderLeftColor: 'var(--crit)' } : undefined}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {showWeek && item.label && <span className="rounded-md bg-accent-wash px-1.5 py-0.5 text-[11px] font-semibold text-ink">{item.label}</span>}
          <p className={cx('truncate font-medium text-ink', item.status === 'SKIPPED' && 'line-through')}>{item.subject.name}</p>
          {item.overdue && (
            <span className="inline-flex items-center gap-1 rounded-full bg-crit-wash px-2 py-0.5 text-[11px] font-medium text-crit-text">
              <AlertTriangle className="h-3 w-3" /> atrasado {relativeDay(item.weekEnd, today)}
            </span>
          )}
          {item.status === 'DONE' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-good-wash px-2 py-0.5 text-[11px] font-medium" style={{ color: 'var(--good-text)' }}>
              <Check className="h-3 w-3" /> estudado{item.doneOn ? ` em ${fmtShort(item.doneOn)}` : ''}
            </span>
          )}
          {item.status === 'SKIPPED' && <span className="rounded-full bg-subtle px-2 py-0.5 text-[11px] font-medium text-ink2">pulado</span>}
          {pending && item.behind && (
            <span className="inline-flex items-center gap-1 rounded-full bg-warn-wash px-2 py-0.5 text-[11px] font-medium text-ink">
              era para {dayLabel(item.plannedOn, today) === 'ontem' ? 'ontem' : `${weekdayLong(item.plannedOn)}, ${fmtShort(item.plannedOn)}`}
            </span>
          )}
          {pending && showDay && item.distributed && !item.behind && !item.overdue && (
            <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-medium', item.plannedOn === today ? 'bg-accent text-white' : 'bg-subtle text-ink2')}>
              {dayLabel(item.plannedOn, today)}
            </span>
          )}
        </div>
        <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-ink2">
          <AreaDot color={item.subject.area?.color} /> {item.subject.area?.path}
          {pending && item.suggestedMinutes ? (
            <span className="inline-flex shrink-0 items-center gap-0.5 text-muted" title="Tempo sugerido: suas horas do dia divididas entre os assuntos do dia">
              · <Clock className="h-3 w-3" /> ~{duration(item.suggestedMinutes)}
            </span>
          ) : null}
          {showWeek && <span className="text-muted">· semana de {weekRange(item)}</span>}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1 whitespace-nowrap">
        {pending ? (
          <>
            {full && (
              <Button variant="ghost" size="sm" icon={<Check className="h-3.5 w-3.5" />} loading={update.isPending} onClick={() => set('DONE', `${item.subject.name} marcado como estudado.`)}>
                Já estudei
              </Button>
            )}
            <Button variant="ghost" size="sm" icon={<SkipForward className="h-3.5 w-3.5" />} onClick={() => set('SKIPPED', `${item.subject.name} foi pulado. Dá para desfazer no Cronograma.`)}>
              Pular
            </Button>
            <Button variant="ghost" size="sm" icon={<CalendarClock className="h-3.5 w-3.5" />} onClick={() => setMove(true)}>
              Mudar o dia
            </Button>
            <Button
              size="sm"
              icon={<Play className="h-3.5 w-3.5" />}
              onClick={() => openStudy({ subjectId: item.subject.id, planItemId: item.id, minutes: item.suggestedMinutes ?? undefined })}
            >
              Estudar
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" icon={<Undo2 className="h-3.5 w-3.5" />} loading={update.isPending} onClick={() => set('PENDING', `${item.subject.name} voltou a ficar pendente.`)}>
            Desfazer
          </Button>
        )}
      </div>
      {move && <PlanRescheduleDialog item={item} onClose={() => setMove(false)} />}
    </div>
  );
}
