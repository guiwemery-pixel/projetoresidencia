import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck2, ChevronDown, Info, Lightbulb, Sparkles } from 'lucide-react';
import { api } from '../../api/client';
import type { StudyMethod, StudyResult, StudySuggestion } from '../../api/types';
import { useCreateStudy, useSubjects } from '../../hooks/api';
import { DIFFICULTY, METHODS, METHOD_LABEL, QUALITY } from '../../lib/constants';
import { duration, fmtLong, pct, relativeDay, todayLocal } from '../../lib/format';
import { questionCountFactor, type QuestionCountConfig } from '../../lib/questions';
import { Button, Input, Modal, NumberInput, Textarea, cx, useToast } from '../ui';
import { SubjectPicker, type SubjectChoice } from './SubjectPicker';
import { WhyPanel } from './WhyPanel';

interface OpenOptions {
  subjectId?: string;
  reviewId?: string;
  methods?: StudyMethod[];
}

const Ctx = createContext<(opts?: OpenOptions) => void>(() => undefined);
export const useStudyDialog = () => useContext(Ctx);

export function StudyDialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; opts: OpenOptions; key: number }>({ open: false, opts: {}, key: 0 });
  const open = useCallback((opts: OpenOptions = {}) => setState((s) => ({ open: true, opts, key: s.key + 1 })), []);
  return (
    <Ctx.Provider value={open}>
      {children}
      {state.open && <StudyDialog key={state.key} opts={state.opts} onClose={() => setState((s) => ({ ...s, open: false }))} />}
    </Ctx.Provider>
  );
}

const DURATIONS = [15, 30, 45, 60, 90, 120];
const QUESTION_METHODS: StudyMethod[] = ['QUESTOES', 'SIMULADO'];

function StudyDialog({ opts, onClose }: { opts: OpenOptions; onClose: () => void }) {
  const toast = useToast();
  const { data: subjects } = useSubjects();
  const create = useCreateStudy();

  const [subject, setSubject] = useState<SubjectChoice>(null);
  const [date, setDate] = useState(todayLocal());
  const [minutes, setMinutes] = useState<number | null>(60);
  const [methods, setMethods] = useState<StudyMethod[]>(opts.methods ?? []);
  const [total, setTotal] = useState<number | null>(null);
  const [correct, setCorrect] = useState<number | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [board, setBoard] = useState('');
  const [examName, setExamName] = useState('');
  const [qDifficulty, setQDifficulty] = useState<number | null>(null);
  const [qTime, setQTime] = useState<number | null>(null);
  const [qNotes, setQNotes] = useState('');
  const [quality, setQuality] = useState<number | null>(null);
  const [difficulty, setDifficulty] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [result, setResult] = useState<StudyResult | null>(null);
  const [showWhy, setShowWhy] = useState(false);

  // Pré-seleciona o assunto (ex.: ao abrir a partir de uma revisão)
  useEffect(() => {
    if (opts.subjectId && subjects && !subject) {
      const s = subjects.find((x) => x.id === opts.subjectId);
      if (s) setSubject({ kind: 'existing', subject: s });
    }
  }, [opts.subjectId, subjects, subject]);

  const subjectId = subject?.kind === 'existing' ? subject.subject.id : null;
  const { data: suggestion } = useQuery({
    queryKey: ['suggestion', subjectId],
    queryFn: () => api.get<StudySuggestion>(`/studies/suggestion/${subjectId}`),
    enabled: !!subjectId,
  });

  // Pré-marca os métodos sugeridos na primeira vez que a sugestão chega
  useEffect(() => {
    if (suggestion && methods.length === 0) setMethods(suggestion.isNew ? ['TEORIA', 'QUESTOES'] : suggestion.methods.slice(0, 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestion]);

  const hasQuestions = methods.some((m) => QUESTION_METHODS.includes(m));
  const wrong = total !== null && correct !== null ? total - correct : null;
  const accuracy = total && correct !== null && correct <= total ? (correct / total) * 100 : null;
  const questionsError = total !== null && correct !== null && correct > total ? 'Acertos maiores que o total' : undefined;

  const newSuggestion = subject?.kind === 'new' ? { SMALL: '10–15', MEDIUM: '15–25', LARGE: '20–30' }[subject.data.size] : null;

  const canSubmit = !!subject && methods.length > 0 && minutes !== null && !questionsError && (!hasQuestions || total === null || (total > 0 && correct !== null));

  const toggle = (m: StudyMethod) => setMethods((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));

  async function submit() {
    if (!subject) return;
    try {
      const res = await create.mutateAsync({
        ...(subject.kind === 'existing' ? { subjectId: subject.subject.id } : { newSubject: subject.data }),
        date,
        durationMinutes: minutes ?? 0,
        methods,
        quality,
        difficulty,
        notes: notes || null,
        questions:
          hasQuestions && total
            ? {
                total,
                correct: correct ?? 0,
                board: board || null,
                examName: examName || null,
                difficulty: qDifficulty,
                timeSpentMinutes: qTime,
                notes: qNotes || null,
              }
            : null,
      });
      setResult(res);
      toast.success('Estudo registrado!');
    } catch (err) {
      toast.error(err);
    }
  }

  const title = result ? 'Estudo registrado' : opts.reviewId ? 'Registrar revisão' : 'Registrar estudo';

  if (result) {
    const s = result.schedule;
    return (
      <Modal
        open
        onClose={onClose}
        title={title}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Fechar
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-2xl bg-good-wash p-4">
            <CalendarCheck2 className="mt-0.5 h-5 w-5 shrink-0" style={{ color: 'var(--good)' }} />
            <div>
              <p className="font-medium text-ink">
                {result.session.subject.name}
                {result.session.questions && (
                  <span className="text-ink2">
                    {' '}
                    · {result.session.questions.correct}/{result.session.questions.total} = {pct(result.session.questions.accuracy)}
                  </span>
                )}
              </p>
              {s && (
                <p className="mt-1 text-sm text-ink2">
                  Próxima revisão <strong className="text-ink">{s.stageLabel}</strong> {relativeDay(s.dueOn)} ({fmtLong(s.dueOn)}) —{' '}
                  {s.phase.toLowerCase()}.
                </p>
              )}
              {result.completedReviewId && <p className="mt-1 text-sm text-ink2">✔ A revisão pendente deste assunto foi concluída.</p>}
            </div>
          </div>
          {s && (
            <>
              <div className="rounded-xl border border-line p-3 text-sm">
                <p className="flex items-center gap-2 font-medium text-ink">
                  <Lightbulb className="h-4 w-4 text-accent" /> Para a próxima revisão
                </p>
                <p className="mt-1 text-ink2">
                  {s.checkup && 'Como foi só estudo/leitura, amanhã meça a retenção com questões. '}
                  {s.suggestTheory && 'Volte ao conteúdo teórico e depois faça questões. '}
                  Sugerido: {s.suggestedMethods.map((m) => METHOD_LABEL[m]).join(', ')} · {s.suggestedQuestions.min}–{s.suggestedQuestions.max} questões.
                  {' '}Com bom desempenho, menos de 20 questões aproximam a próxima revisão e mais de 20 a afastam, aos poucos.
                </p>
              </div>
              <button type="button" onClick={() => setShowWhy((v) => !v)} className="flex items-center gap-1 text-sm font-medium text-accent" aria-expanded={showWhy}>
                Por que {s.intervalDays} {s.intervalDays === 1 ? 'dia' : 'dias'}?
                <ChevronDown className={cx('h-4 w-4 transition', showWhy && 'rotate-180')} />
              </button>
              {showWhy && <WhyPanel explanation={s.explanation} />}
            </>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={create.isPending} disabled={!canSubmit}>
            Registrar
          </Button>
        </>
      }
    >
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) submit();
        }}
      >
        <section>
          <h3 className="label">1. Assunto</h3>
          <SubjectPicker value={subject} onChange={setSubject} />
          {suggestion && <SuggestionBox suggestion={suggestion} />}
          {newSuggestion && (
            <p className="mt-2 flex items-start gap-2 rounded-xl bg-accent-wash px-3 py-2 text-xs text-ink">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
              Assunto novo (D0 — aprender): sugerimos teoria + {newSuggestion} questões. Seu percentual de acertos define a data da 1ª revisão.
            </p>
          )}
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <Input label="Data" type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} />
          <div>
            <NumberInput label="Duração (minutos)" min={0} max={1440} value={minutes} onChange={setMinutes} hint={minutes ? duration(minutes) : undefined} />
            <div className="mt-1.5 flex flex-wrap gap-1">
              {DURATIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setMinutes(d)}
                  className={cx('rounded-lg px-2 py-0.5 text-xs', minutes === d ? 'bg-accent text-white' : 'bg-subtle text-ink2 hover:text-ink')}
                >
                  {duration(d)}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section>
          <h3 className="label">2. Tipo de estudo (pode marcar mais de um)</h3>
          <div className="flex flex-wrap gap-2">
            {METHODS.map((m) => {
              const on = methods.includes(m.value);
              return (
                <button
                  key={m.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(m.value)}
                  className={cx('chip', on ? 'border-accent bg-accent-wash font-medium text-ink' : 'text-ink2 hover:bg-subtle')}
                >
                  <span aria-hidden>{m.emoji}</span> {m.label}
                </button>
              );
            })}
          </div>
        </section>

        {hasQuestions && (
          <section className="space-y-3 rounded-2xl border border-line p-3">
            <h3 className="text-sm font-medium text-ink">3. Questões</h3>
            <div className="grid grid-cols-3 gap-2">
              <NumberInput label="Quantidade" min={1} max={1000} value={total} onChange={setTotal} />
              <NumberInput label="Acertos" min={0} max={1000} value={correct} onChange={setCorrect} error={questionsError} />
              <div>
                <span className="label">Erros</span>
                <div className="input num bg-subtle text-ink2">{wrong ?? '—'}</div>
              </div>
            </div>
            {accuracy !== null && (
              <p className="num rounded-xl bg-subtle px-3 py-2 text-sm text-ink">
                Resultado:{' '}
                <strong>
                  {correct}/{total} = {pct(accuracy)}
                </strong>{' '}
                de acertos
              </p>
            )}
            {total !== null && total > 0 && suggestion?.questionCount && <QuantityHint total={total} config={suggestion.questionCount} />}
            <button type="button" className="flex items-center gap-1 text-xs font-medium text-accent" onClick={() => setShowMore((v) => !v)} aria-expanded={showMore}>
              Banca, prova, dificuldade e tempo <ChevronDown className={cx('h-3.5 w-3.5 transition', showMore && 'rotate-180')} />
            </button>
            {showMore && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Banca" placeholder="Ex.: ENARE" value={board} onChange={(e) => setBoard(e.target.value)} maxLength={80} />
                <Input label="Prova" placeholder="Ex.: ENARE 2024" value={examName} onChange={(e) => setExamName(e.target.value)} maxLength={120} />
                <div>
                  <span className="label">Dificuldade percebida das questões</span>
                  <DifficultyPicker value={qDifficulty} onChange={setQDifficulty} />
                </div>
                <NumberInput label="Tempo gasto (min)" min={0} value={qTime} onChange={setQTime} />
                <div className="sm:col-span-2">
                  <Textarea label="Observações sobre as questões" value={qNotes} onChange={(e) => setQNotes(e.target.value)} maxLength={2000} />
                </div>
              </div>
            )}
          </section>
        )}

        <section>
          <h3 className="label">{hasQuestions ? '4' : '3'}. Como foi?</h3>
          <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Qualidade do estudo">
            {QUALITY.map((q) => (
              <button
                key={q.value}
                type="button"
                role="radio"
                aria-checked={quality === q.value}
                onClick={() => setQuality(quality === q.value ? null : q.value)}
                className={cx(
                  'flex flex-col items-center gap-1 rounded-xl border px-1 py-2 text-center transition',
                  quality === q.value ? 'border-accent bg-accent-wash' : 'border-line hover:bg-subtle',
                )}
              >
                <span className="text-2xl" aria-hidden>
                  {q.emoji}
                </span>
                <span className="text-[11px] leading-tight text-ink2">{q.label}</span>
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink2">Dificuldade do assunto:</span>
            <DifficultyPicker value={difficulty} onChange={setDifficulty} />
          </div>
        </section>

        <Textarea label="Observações (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function DifficultyPicker({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="flex gap-1">
      {DIFFICULTY.map((d) => (
        <button
          key={d.value}
          type="button"
          aria-pressed={value === d.value}
          onClick={() => onChange(value === d.value ? null : d.value)}
          className={cx('rounded-lg border px-2.5 py-1 text-xs', value === d.value ? 'border-accent bg-accent-wash text-ink' : 'border-line text-ink2 hover:bg-subtle')}
        >
          {d.label}
        </button>
      ))}
    </div>
  );
}

/** Quanto a quantidade de questões aproxima ou afasta a próxima revisão (com bom desempenho). */
function QuantityHint({ total, config }: { total: number; config: QuestionCountConfig }) {
  const factor = questionCountFactor(total, config);
  const change = Math.round(Math.abs(1 - factor) * 100);
  const n = `${total} ${total === 1 ? 'questão' : 'questões'}`;
  const text =
    change === 0
      ? `${n}: na referência de ${config.reference}. A próxima revisão segue só o seu desempenho.`
      : factor < 1
        ? `${n}: abaixo da referência de ${config.reference}. Indo bem, a próxima revisão fica ${change}% mais próxima (×${factor.toLocaleString('pt-BR')}).`
        : `${n}: acima da referência de ${config.reference}. Indo bem, a próxima revisão fica ${change}% mais distante (×${factor.toLocaleString('pt-BR')}).`;
  return (
    <p className="flex items-start gap-1.5 text-xs text-ink2">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
      {text}
    </p>
  );
}

function SuggestionBox({ suggestion: s }: { suggestion: StudySuggestion }) {
  const text = useMemo(() => {
    const methods = s.methods.map((m) => METHOD_LABEL[m]).join(', ');
    if (s.isNew)
      return `Assunto novo (D0 — aprender): sugerimos teoria + ${s.questions.min}–${s.questions.max} questões. Seu percentual de acertos define a data da 1ª revisão, ajustada pela quantidade de questões.`;
    const when = s.pendingReview ? ` prevista ${relativeDay(s.pendingReview.scheduledFor)}` : '';
    if (s.checkup) {
      return `Verificação${when}: o último contato foi só estudo/leitura. Faça ${s.questions.min}–${s.questions.max} questões — acertando bem, o próximo intervalo cresce.`;
    }
    const ref = s.questionCount?.reference ?? 20;
    return `Revisão ${s.stageLabel}${when} — ${s.phase.toLowerCase()}. Sugerido: ${methods} · ${s.questions.min}–${s.questions.max} questões. ${ref} questões é a referência: indo bem, menos que isso aproxima a próxima revisão e mais que isso a afasta.`;
  }, [s]);
  return (
    <p className="mt-2 flex items-start gap-2 rounded-xl bg-accent-wash px-3 py-2 text-xs text-ink">
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
      {text}
    </p>
  );
}

