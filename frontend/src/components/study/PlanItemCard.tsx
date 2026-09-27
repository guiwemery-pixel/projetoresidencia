import { useState } from 'react';
import { AlertTriangle, CalendarClock, Check, Play, SkipForward, Undo2 } from 'lucide-react';
import type { PlanItem } from '../../api/types';
import { useUpdatePlanItem } from '../../hooks/api';
import { addDaysStr, fmtShort, relativeDay, startOfWeekStr, todayLocal } from '../../lib/format';
import { AreaDot, Button, Input, Modal, cx, useToast } from '../ui';
import { useStudyDialog } from './StudyDialog';

/** "13/10 a 19/10" */
export const weekRange = (item: Pick<PlanItem, 'weekStart' | 'weekEnd'>) => `${fmtShort(item.weekStart)} a ${fmtShort(item.weekEnd)}`;

/** Rótulo da semana sem o " · bônus" (ex.: "Módulo 03"). */
export const weekLabel = (label: string | null) => (label ?? '').replace(/\s*·\s*b[oô]nus$/i, '') || 'Semana';

export function PlanRescheduleDialog({ item, onClose }: { item: PlanItem; onClose: () => void }) {
  const today = todayLocal();
  const thisWeek = startOfWeekStr(today);
  const [date, setDate] = useState(item.weekStart < thisWeek ? thisWeek : addDaysStr(item.weekStart, 7));
  const update = useUpdatePlanItem();
  const toast = useToast();
  const save = async () => {
    try {
      await update.mutateAsync({ id: item.id, weekStart: date });
      toast.success(`${item.subject.name} foi para a semana de ${fmtShort(date)}.`);
      onClose();
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Mudar a semana"
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
        {item.subject.name} — previsto para a semana de {weekRange(item)}. O assunto fica 7 dias na nova semana e só aparece como atrasado depois dela.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        {[
          ['Esta semana', thisWeek],
          ['Próxima semana', addDaysStr(thisWeek, 7)],
          ['Daqui a 2 semanas', addDaysStr(thisWeek, 14)],
        ].map(([label, d]) => (
          <button key={label} type="button" onClick={() => setDate(d)} className={cx('chip', date === d ? 'border-accent bg-accent-wash text-ink' : 'text-ink2')}>
            {label}
          </button>
        ))}
      </div>
      <Input label="Começo da semana" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
    </Modal>
  );
}

/**
 * Assunto previsto no cronograma. "Estudar" abre o registro de estudo já com o
 * assunto; ao salvar, o item fica concluído e as revisões são agendadas.
 */
export function PlanItemCard({ item, compact, showWeek = true, full }: { item: PlanItem; compact?: boolean; showWeek?: boolean; full?: boolean }) {
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
        </div>
        <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-ink2">
          <AreaDot color={item.subject.area?.color} /> {item.subject.area?.path}
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
              Adiar
            </Button>
            <Button size="sm" icon={<Play className="h-3.5 w-3.5" />} onClick={() => openStudy({ subjectId: item.subject.id, planItemId: item.id })}>
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
