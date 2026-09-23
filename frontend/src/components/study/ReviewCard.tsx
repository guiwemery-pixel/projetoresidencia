import { useState } from 'react';
import { AlertTriangle, CalendarClock, HelpCircle, Play } from 'lucide-react';
import type { Review } from '../../api/types';
import { useRescheduleReview } from '../../hooks/api';
import { METHOD_LABEL } from '../../lib/constants';
import { addDaysStr, fmtShort, relativeDay, todayLocal } from '../../lib/format';
import { AreaDot, Button, Input, Modal, cx, useToast } from '../ui';
import { useStudyDialog } from './StudyDialog';
import { WhyPanel } from './WhyPanel';

export function WhyDialog({ review, onClose }: { review: Review; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={`Por que ${review.subject.name} ${relativeDay(review.scheduledFor)}?`} wide>
      {review.explanation ? <WhyPanel explanation={review.explanation} /> : <p className="text-sm text-ink2">Sem explicação registrada.</p>}
    </Modal>
  );
}

export function RescheduleDialog({ review, onClose }: { review: Review; onClose: () => void }) {
  const today = todayLocal();
  const [date, setDate] = useState(review.scheduledFor < today ? today : review.scheduledFor);
  const mutation = useRescheduleReview();
  const toast = useToast();
  const save = async (d: string) => {
    try {
      await mutation.mutateAsync({ id: review.id, date: d });
      toast.success(`Revisão de ${review.subject.name} movida para ${fmtShort(d)}.`);
      onClose();
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Reagendar revisão"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={mutation.isPending} onClick={() => save(date)}>
            Salvar
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-ink2">
        {review.subject.name} — prevista para {fmtShort(review.scheduledFor)}. Adiar muito pode reduzir a retenção; o algoritmo leva o atraso em conta na próxima revisão.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        {[
          ['Hoje', today],
          ['Amanhã', addDaysStr(today, 1)],
          ['+2 dias', addDaysStr(review.scheduledFor < today ? today : review.scheduledFor, 2)],
          ['+7 dias', addDaysStr(review.scheduledFor < today ? today : review.scheduledFor, 7)],
        ].map(([label, d]) => (
          <button key={label} type="button" onClick={() => setDate(d)} className={cx('chip', date === d ? 'border-accent bg-accent-wash text-ink' : 'text-ink2')}>
            {label}
          </button>
        ))}
      </div>
      <Input label="Nova data" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
    </Modal>
  );
}

export function ReviewCard({ review, compact }: { review: Review; compact?: boolean }) {
  const openStudy = useStudyDialog();
  const [why, setWhy] = useState(false);
  const [move, setMove] = useState(false);
  const today = todayLocal();
  const overdue = review.scheduledFor < today;
  return (
    <div className={cx('flex flex-col gap-2 rounded-xl border border-line bg-surface p-3', !compact && 'md:flex-row md:items-center', overdue && 'border-l-4')} style={overdue ? { borderLeftColor: 'var(--crit)' } : undefined}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-accent-wash px-1.5 py-0.5 text-[11px] font-semibold text-ink">{review.stageLabel}</span>
          <p className="truncate font-medium text-ink">{review.subject.name}</p>
          {overdue && (
            <span className="inline-flex items-center gap-1 rounded-full bg-crit-wash px-2 py-0.5 text-[11px] font-medium text-crit-text">
              <AlertTriangle className="h-3 w-3" /> atrasada {relativeDay(review.scheduledFor, today)}
            </span>
          )}
          {review.suggestTheory && <span className="rounded-full bg-warn-wash px-2 py-0.5 text-[11px] font-medium text-ink">rever teoria</span>}
        </div>
        <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-ink2">
          <AreaDot color={review.subject.area?.color} /> {review.subject.area?.path}
          {!compact && !overdue && <span className="text-muted">· {relativeDay(review.scheduledFor, today)}</span>}
        </p>
        {!compact && (
          <p className="mt-1 text-xs text-muted">
            {review.phase} · {review.suggestedMethods.map((m) => METHOD_LABEL[m]).join(', ')}
            {review.suggestedQuestions ? ` · ~${review.suggestedQuestions} questões` : ''}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1 whitespace-nowrap">
        <Button variant="ghost" size="sm" icon={<HelpCircle className="h-3.5 w-3.5" />} onClick={() => setWhy(true)}>
          Por quê?
        </Button>
        <Button variant="ghost" size="sm" icon={<CalendarClock className="h-3.5 w-3.5" />} onClick={() => setMove(true)}>
          {overdue ? 'Reagendar' : 'Adiar'}
        </Button>
        <Button size="sm" icon={<Play className="h-3.5 w-3.5" />} onClick={() => openStudy({ subjectId: review.subject.id, reviewId: review.id, methods: review.suggestedMethods.slice(0, 1) })}>
          Revisar
        </Button>
      </div>
      {why && <WhyDialog review={review} onClose={() => setWhy(false)} />}
      {move && <RescheduleDialog review={review} onClose={() => setMove(false)} />}
    </div>
  );
}
