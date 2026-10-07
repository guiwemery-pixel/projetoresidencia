import { Clock } from 'lucide-react';
import { duration, fmtShort, plural, weekdayLong } from '../../lib/format';
import { addDays } from '../../lib/plan/parse';
import { weekdaysText } from './StudyDays';

// Como fica o cronograma com os dias e horas escolhidos (resposta das prévias do backend).

interface WeekPreview {
  weekStart: string;
  label: string | null;
  subjects: number;
  minutesEach: number;
}

export interface PlanDistribution {
  weekdays: number[];
  dailyMinutes: number;
  sample: WeekPreview & { days: { date: string; subjects: string[] }[] };
  busiest: WeekPreview | null;
  averageMinutes: number;
}

/** Uma semana de exemplo, dia a dia, e o tempo por assunto com os dias e horas escolhidos. */
export function DistributionPreview({ distribution: d }: { distribution: PlanDistribution }) {
  return (
    <div className="mt-3 rounded-xl border border-line bg-surface p-3">
      <p className="text-sm font-medium text-ink">
        Como fica {d.sample.label ? `${/^semana/i.test(d.sample.label) ? 'a' : 'o'} ${d.sample.label}` : 'a semana'} ({fmtShort(d.sample.weekStart)} a {fmtShort(addDays(d.sample.weekStart, 6))}), estudando de {weekdaysText(d.weekdays)},{' '}
        {duration(d.dailyMinutes)} por dia:
      </p>
      <ul className="mt-2 space-y-1.5">
        {d.sample.days.map((day) => (
          <li key={day.date} className="grid grid-cols-[6.5rem_1fr] gap-2 text-sm">
            <span className="font-medium text-ink2 first-letter:uppercase">
              {weekdayLong(day.date)} {fmtShort(day.date)}
            </span>
            <span className="min-w-0 text-ink">{day.subjects.join(' · ')}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 flex flex-wrap items-center gap-1 text-xs text-ink2">
        <Clock className="h-3.5 w-3.5" /> Em média ~{duration(d.averageMinutes)} por assunto.
        {d.busiest && (
          <span>
            Semana mais cheia: {d.busiest.label ?? fmtShort(d.busiest.weekStart)} — {plural(d.busiest.subjects, 'assunto', 'assuntos')}, ~{duration(d.busiest.minutesEach)} cada.
          </span>
        )}
      </p>
    </div>
  );
}
