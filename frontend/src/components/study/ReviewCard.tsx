import { useState } from 'react';
import { AlertTriangle, CalendarClock, HelpCircle, Lightbulb, Play } from 'lucide-react';
import type { Review, StudyAdvice } from '../../api/types';
import { useRescheduleReview } from '../../hooks/api';
import { METHOD_LABEL } from '../../lib/constants';
import { addDaysStr, fmtShort, relativeDay, todayLocal } from '../../lib/format';
import { AreaDot, Button, Input, Modal, cx, useToast } from '../ui';
import { useStudyDialog } from './StudyDialog';
import { WhyPanel } from './WhyPanel';
import { AdviceNote } from './AdviceNote';

/** Métodos para já deixar marcados no "Registrar estudo" da revisão. */
const startMethods = (review: Review) =>
  review.advice ? review.advice.methods.slice(0, review.advice.focus === 'TEORIA' ? 2 : 1) : review.suggestedMethods.slice(0, 1);

/** Como foram os últimos estudos ("2× teoria · 1× questões · 1× flashcards"). */
function mixText(advice: StudyAdvice) {
  const m = advice.mix;
  return [`${m.theory}× teoria`, `${m.questions}× questões`, m.recall ? `${m.recall}× flashcards/recall` : null].filter(Boolean).join(' · ');
}

export function WhyDialog({ review, onClose }: { review: Review; onClose: () => void }) {
  const advice = review.advice;
  return (
    <Modal open onClose={onClose} title={`Por que ${review.subject.name} ${relativeDay(review.scheduledFor)}?`} wide>
      {advice && (
        <section className="mb-4 rounded-xl border border-line p-3">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Lightbulb className="h-4 w-4 text-accent" /> Como estudar nesta revisão: {advice.title.charAt(0).toLowerCase() + advice.title.slice(1)}
          </h3>
          <p className="mt-1 text-sm text-ink2">{advice.reason}</p>
          <p className="mt-2 flex flex-wrap gap-1.5 text-xs">
            <span className="rounded-full bg-subtle px-2 py-0.5 text-ink2">
              {advice.mix.sessions === 1 ? 'Último estudo' : `Últimos ${advice.mix.sessions} estudos`}: {mixText(advice)}
            </span>
            {advice.mix.lastTheory && <span className="rounded-full bg-subtle px-2 py-0.5 text-ink2">Última teoria: {fmtShort(advice.mix.lastTheory)}</span>}
            {advice.mix.lastQuestions && <span className="rounded-full bg-subtle px-2 py-0.5 text-ink2">Últimas questões: {fmtShort(advice.mix.lastQuestions)}</span>}
          </p>
        </section>
      )}
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
          {review.suggestTheory && review.advice?.focus !== 'TEORIA' && <span className="rounded-full bg-warn-wash px-2 py-0.5 text-[11px] font-medium text-ink">rever teoria</span>}
        </div>
        <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-ink2">
          <AreaDot color={review.subject.area?.color} /> {review.subject.area?.path}
          {!compact && !overdue && <span className="text-muted">· {relativeDay(review.scheduledFor, today)}</span>}
        </p>
        {review.shiftedFrom && review.shiftedFrom !== review.scheduledFor && (
          <p className="mt-0.5 text-xs text-muted" title="O dia calculado já tinha o máximo de revisões (Perfil → Revisões por dia)">
            ↔ era {fmtShort(review.shiftedFrom)} · limite de revisões por dia
          </p>
        )}
        {!compact && (
          <p className="mt-1 text-xs text-muted">
            {review.phase} · {(review.advice?.methods ?? review.suggestedMethods).map((m) => METHOD_LABEL[m]).join(', ')}
            {review.suggestedQuestions ? ` · ~${review.suggestedQuestions} questões` : ''}
          </p>
        )}
        {review.status === 'PENDING' && review.advice && <AdviceNote advice={review.advice} compact={compact} />}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1 whitespace-nowrap">
        <Button variant="ghost" size="sm" icon={<HelpCircle className="h-3.5 w-3.5" />} onClick={() => setWhy(true)}>
          Por quê?
        </Button>
        <Button variant="ghost" size="sm" icon={<CalendarClock className="h-3.5 w-3.5" />} onClick={() => setMove(true)}>
          {overdue ? 'Reagendar' : 'Adiar'}
        </Button>
        <Button size="sm" icon={<Play className="h-3.5 w-3.5" />} onClick={() => openStudy({ subjectId: review.subject.id, reviewId: review.id, methods: startMethods(review) })}>
          Revisar
        </Button>
      </div>
      {why && <WhyDialog review={review} onClose={() => setWhy(false)} />}
      {move && <RescheduleDialog review={review} onClose={() => setMove(false)} />}
    </div>
  );
}
