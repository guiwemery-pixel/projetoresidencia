import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useDistributePlan } from '../../hooks/api';
import { duration, plural } from '../../lib/format';
import { Button, Modal, cx, useToast } from '../ui';

// Dias de estudo e horas por dia: o cronograma distribui os assuntos de cada semana
// por esses dias (backend: plans/distribute.ts) e as horas viram o tempo sugerido.

export const WEEKDAYS = [
  { value: 1, short: 'Seg', long: 'segunda' },
  { value: 2, short: 'Ter', long: 'terça' },
  { value: 3, short: 'Qua', long: 'quarta' },
  { value: 4, short: 'Qui', long: 'quinta' },
  { value: 5, short: 'Sex', long: 'sexta' },
  { value: 6, short: 'Sáb', long: 'sábado' },
  { value: 7, short: 'Dom', long: 'domingo' },
];
const HOURS = [60, 120, 180, 240, 300, 360, 480];
const PRESETS = [
  { label: 'Seg a sex', days: [1, 2, 3, 4, 5] },
  { label: 'Seg a sáb', days: [1, 2, 3, 4, 5, 6] },
  { label: 'Todos os dias', days: [1, 2, 3, 4, 5, 6, 7] },
];
export const DEFAULT_DAYS = [1, 2, 3, 4, 5];
export const DEFAULT_MINUTES = 240;

const sameDays = (a: number[], b: number[]) => a.length === b.length && a.every((d, i) => d === b[i]);

/** "segunda a sexta", "segunda, quarta e sexta", "todos os dias" */
export function weekdaysText(days: number[]) {
  const list = [...new Set(days)].sort((a, b) => a - b);
  if (list.length === 7) return 'todos os dias';
  const names = list.map((d) => WEEKDAYS[d - 1].long);
  if (list.length >= 3 && list.every((d, i) => i === 0 || d === list[i - 1] + 1)) return `${names[0]} a ${names[names.length - 1]}`;
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}` : (names[0] ?? '');
}

/** Escolha dos dias da semana e das horas por dia (controlado). */
export function StudyDaysFields({ weekdays, minutes, onChange }: { weekdays: number[]; minutes: number; onChange: (v: { weekdays: number[]; minutes: number }) => void }) {
  const [custom, setCustom] = useState(!HOURS.includes(minutes));
  const toggle = (d: number) => {
    const next = weekdays.includes(d) ? weekdays.filter((x) => x !== d) : [...weekdays, d].sort((a, b) => a - b);
    onChange({ weekdays: next, minutes });
  };
  return (
    <div className="space-y-4">
      <div>
        <p className="label">Em quais dias você estuda?</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Dias de estudo">
          {WEEKDAYS.map((d) => {
            const on = weekdays.includes(d.value);
            return (
              <button
                key={d.value}
                type="button"
                aria-pressed={on}
                aria-label={d.long}
                onClick={() => toggle(d.value)}
                className={cx(
                  'h-10 min-w-[3rem] rounded-xl border px-2 text-sm font-medium transition',
                  on ? 'border-accent bg-accent text-white' : 'border-line bg-surface text-ink2 hover:bg-subtle',
                )}
              >
                {d.short}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => onChange({ weekdays: p.days, minutes })}
              className={cx('chip text-xs', sameDays(weekdays, p.days) ? 'border-accent bg-accent-wash text-ink' : 'text-ink2')}
            >
              {p.label}
            </button>
          ))}
        </div>
        {!weekdays.length && <p className="mt-1 text-xs text-crit-text">Escolha pelo menos um dia.</p>}
      </div>
      <div>
        <p className="label">Quantas horas por dia?</p>
        <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Horas de estudo por dia">
          {HOURS.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={!custom && minutes === m}
              onClick={() => (setCustom(false), onChange({ weekdays, minutes: m }))}
              className={cx('chip', !custom && minutes === m ? 'border-accent bg-accent-wash font-medium text-ink' : 'text-ink2')}
            >
              {m / 60} h
            </button>
          ))}
          <button type="button" onClick={() => setCustom(true)} className={cx('chip', custom ? 'border-accent bg-accent-wash font-medium text-ink' : 'text-ink2')}>
            Outro
          </button>
          {custom && (
            <label className="flex items-center gap-1.5 text-sm text-ink2">
              <input
                type="number"
                inputMode="decimal"
                min={0.5}
                max={16}
                step={0.5}
                className="input w-20 py-1"
                aria-label="Horas por dia"
                value={minutes / 60}
                onChange={(e) => {
                  const h = Number(e.target.value);
                  if (Number.isFinite(h) && h > 0) onChange({ weekdays, minutes: Math.min(960, Math.max(30, Math.round(h * 2) * 30)) });
                }}
              />
              horas
            </label>
          )}
        </div>
      </div>
      {weekdays.length > 0 && (
        <p className="text-xs text-ink2">
          {plural(weekdays.length, 'dia', 'dias')} por semana ({weekdaysText(weekdays)}) · {duration(minutes)} por dia · {duration(minutes * weekdays.length)} por semana
        </p>
      )}
    </div>
  );
}

/** Mudar os dias e as horas e redistribuir os assuntos do cronograma. */
export function StudyDaysDialog({ onClose, intro }: { onClose: () => void; intro?: string }) {
  const { user } = useAuth();
  const toast = useToast();
  const distribute = useDistributePlan();
  const [value, setValue] = useState({ weekdays: user?.studyWeekdays?.length ? user.studyWeekdays : DEFAULT_DAYS, minutes: user?.dailyStudyMinutes ?? DEFAULT_MINUTES });
  const save = async () => {
    try {
      const r = await distribute.mutateAsync({ weekdays: value.weekdays, dailyMinutes: value.minutes });
      toast.success(`Pronto! Os assuntos de cada semana estão distribuídos de ${weekdaysText(r.weekdays)}, ${duration(r.dailyMinutes)} por dia.`);
      onClose();
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Dias de estudo"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={distribute.isPending} disabled={!value.weekdays.length} icon={<CalendarDays className="h-4 w-4" />} onClick={save}>
            Distribuir pelos dias
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-ink2">
        {intro ??
          'Os assuntos de cada semana do cronograma são distribuídos por estes dias, na ordem do cronograma e com o mesmo tanto em cada dia. As horas por dia viram o tempo sugerido para cada assunto.'}
      </p>
      <StudyDaysFields weekdays={value.weekdays} minutes={value.minutes} onChange={setValue} />
      <p className="mt-4 text-xs text-muted">Vale para todos os seus cronogramas. Assuntos já estudados e semanas que já passaram não mudam.</p>
    </Modal>
  );
}
