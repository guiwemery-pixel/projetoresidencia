import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck2, ChevronDown, Info, Lightbulb, Plus, Sparkles, WifiOff, X } from 'lucide-react';
import { api } from '../../api/client';
import { isQueuedOffline } from '../../api/offline';
import type { StudyMethod, StudyResult, StudySuggestion } from '../../api/types';
import { useCreateStudies, useCreateStudy, useSubjects } from '../../hooks/api';
import { DIFFICULTY, METHODS, METHOD_LABEL, QUALITY, SIZES } from '../../lib/constants';
import { duration, fmtLong, pct, relativeDay, todayLocal } from '../../lib/format';
import { questionCountFactor, type QuestionCountConfig } from '../../lib/questions';
import { splitCorrect, splitEven } from '../../lib/split';
import { Button, IconButton, Input, Modal, NumberInput, Textarea, cx, useToast } from '../ui';
import { SubjectPicker, normalize, type SubjectChoice } from './SubjectPicker';
import { WhyPanel } from './WhyPanel';

export interface OpenOptions {
  subjectId?: string;
  reviewId?: string;
  /** Assunto do cronograma que este estudo cumpre */
  planItemId?: string;
  methods?: StudyMethod[];
  /** Pré-preenchidos (ex.: ao registrar uma sessão de flashcards) */
  minutes?: number;
  notes?: string;
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
/** Linha "questões de cada assunto": no celular o nome ocupa a linha de cima. */
const PART_GRID = 'grid grid-cols-[1fr_1fr_3rem] gap-2 sm:grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_3.5rem]';
const QUESTION_METHODS: StudyMethod[] = ['QUESTOES', 'SIMULADO'];
/** Estudo teórico: sem questões registradas, a data não sai de percentual. */
const STUDY_ONLY_METHODS: StudyMethod[] = ['TEORIA', 'AULA', 'VIDEO', 'LEITURA', 'RESUMO', 'REVISAO', 'OUTRO'];

function StudyDialog({ opts, onClose }: { opts: OpenOptions; onClose: () => void }) {
  const toast = useToast();
  const { data: subjects } = useSubjects();
  const create = useCreateStudy();
  const createMany = useCreateStudies();

  const [subject, setSubject] = useState<SubjectChoice>(null);
  const [date, setDate] = useState(todayLocal());
  const [minutes, setMinutes] = useState<number | null>(opts.minutes ?? 60);
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
  const [notes, setNotes] = useState(opts.notes ?? '');
  const [result, setResult] = useState<StudyResult | null>(null);
  // Estudo que englobou vários assuntos: os outros assuntos e, se a pessoa quiser, as questões de cada um
  const [extras, setExtras] = useState<SubjectChoice[]>([]);
  const [perSubject, setPerSubject] = useState(false);
  const [manual, setManual] = useState<Record<string, { total: number | null; correct: number | null }>>({});
  const [results, setResults] = useState<StudyResult[] | null>(null);
  const [queued, setQueued] = useState(false);
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

  // Vários assuntos: cada um recebe a sua parte do tempo e das questões (igual, ou informada por assunto)
  const chosen = [subject, ...extras].filter((c): c is NonNullable<SubjectChoice> => !!c);
  const choiceKey = (c: NonNullable<SubjectChoice>) => (c.kind === 'existing' ? c.subject.id : `novo:${normalize(c.data.name.trim())}`);
  const isBatch = chosen.length >= 2;
  const duplicated = new Set(chosen.map(choiceKey)).size !== chosen.length;
  const minuteParts = minutes !== null ? splitEven(minutes, chosen.length) : [];
  const autoTotals = total ? splitEven(total, chosen.length) : [];
  const autoCorrect = total && correct !== null && correct <= total ? splitCorrect(correct, autoTotals) : [];
  const parts = chosen.map((c, i) =>
    perSubject ? manual[choiceKey(c)] ?? { total: null, correct: null } : { total: autoTotals[i] ?? null, correct: autoCorrect[i] ?? null },
  );
  const partsTotal = parts.reduce((a, p) => a + (p.total ?? 0), 0);
  const partsCorrect = parts.reduce((a, p) => a + (p.correct ?? 0), 0);
  const partsError = perSubject && parts.some((p) => p.total !== null && p.correct !== null && p.correct > p.total) ? 'Acertos maiores que as questões em algum assunto' : undefined;
  const startPerSubject = () => {
    setManual(Object.fromEntries(chosen.map((c, i) => [choiceKey(c), parts[i]])));
    setPerSubject(true);
  };
  const excludeIds = chosen.flatMap((c) => (c.kind === 'existing' ? [c.subject.id] : []));

  const newSuggestion = subject?.kind === 'new' ? SIZES.find((x) => x.value === subject.data.size)?.questions ?? null : null;
  const reference = suggestion?.questionCount?.reference ?? 25;

  // Sem questões: explica de onde sai a próxima data
  const activeRecall = methods.some((m) => m === 'FLASHCARDS' || m === 'RECALL');
  const theoryTicked = methods.some((m) => STUDY_ONLY_METHODS.includes(m));
  const questionsEmpty = hasQuestions && !total;
  let noQuestionsHint: string | null = null;
  if (methods.length && (!hasQuestions || questionsEmpty)) {
    if (activeRecall) noQuestionsHint = 'Sem questões, a próxima revisão sai de “Como foi?”, do tempo de estudo e da dificuldade.';
    else if (questionsEmpty && !theoryTicked) noQuestionsHint = 'Informe quantas questões fez: sem a quantidade, vale só o “Como foi?”.';
    else
      noQuestionsHint =
        (questionsEmpty ? '“Questões” sem a quantidade conta como estudo teórico. ' : '') +
        (suggestion?.checkup
          ? 'Revisão só teórica: vale o “Como foi?”, mas com prazo bem menor que com questões, e a etapa não avança.'
          : 'Estudo teórico (aula, vídeo, leitura): a revisão D1 fica para amanhã — com questões, flashcards, recall ou teoria.');
  }
  const questionsOk = !hasQuestions
    ? true
    : isBatch && perSubject
      ? !partsError && parts.every((p) => !p.total || p.correct !== null)
      : !questionsError && (total === null || (total > 0 && correct !== null));
  const canSubmit = !!subject && methods.length > 0 && minutes !== null && questionsOk && !duplicated;

  const toggle = (m: StudyMethod) => setMethods((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));

  async function submitBatch() {
    const qExtra = { board: board || null, examName: examName || null, difficulty: qDifficulty, notes: qNotes || null };
    const qTimes = qTime ? splitEven(qTime, chosen.length) : [];
    try {
      const res = await createMany.mutateAsync({
        date,
        methods,
        quality,
        difficulty,
        notes: notes || null,
        // O item do cronograma (ou a revisão) de onde veio o registro é do primeiro assunto
        planItemId: opts.planItemId ?? null,
        items: chosen.map((c, i) => ({
          ...(c.kind === 'existing' ? { subjectId: c.subject.id } : { newSubject: c.data }),
          durationMinutes: minuteParts[i] ?? 0,
          questions: hasQuestions && parts[i].total ? { total: parts[i].total, correct: parts[i].correct ?? 0, ...qExtra, timeSpentMinutes: qTimes[i] ?? null } : null,
        })),
      });
      setResults(res.results);
      toast.success(`Estudo registrado em ${res.results.length} assuntos!`);
    } catch (err) {
      if (isQueuedOffline(err)) setQueued(true);
      else toast.error(err);
    }
  }

  async function submit() {
    if (!subject) return;
    if (isBatch) return submitBatch();
    try {
      const res = await create.mutateAsync({
        ...(subject.kind === 'existing' ? { subjectId: subject.subject.id } : { newSubject: subject.data }),
        planItemId: opts.planItemId ?? null,
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
      // Sem internet: ficou na fila deste aparelho e vai quando a conexão voltar
      if (isQueuedOffline(err)) setQueued(true);
      else toast.error(err);
    }
  }

  if (queued) {
    return (
      <Modal open onClose={onClose} title="Salvo neste aparelho" footer={<Button onClick={onClose}>Fechar</Button>}>
        <div className="flex items-start gap-3 rounded-2xl bg-accent-wash p-4 text-sm text-ink2">
          <WifiOff className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
          <p>
            Você está sem internet. O estudo de{' '}
            <strong className="text-ink">{chosen.map((c) => (c.kind === 'existing' ? c.subject.name : c.data.name)).join(', ')}</strong> ficou salvo neste aparelho e
            será enviado quando a conexão voltar — aí a próxima revisão {isBatch ? 'de cada assunto' : ''} é calculada e aparece no calendário.
          </p>
        </div>
      </Modal>
    );
  }

  if (results) {
    return (
      <Modal open onClose={onClose} title={`Estudo registrado · ${results.length} assuntos`} footer={<Button variant="secondary" onClick={onClose}>Fechar</Button>}>
        <div className="space-y-3">
          <p className="text-sm text-ink2">Cada assunto ficou com o seu estudo e a sua próxima revisão, calculada pelo desempenho dele.</p>
          {results.map((r) => (
            <BatchResultRow key={r.session.id} result={r} />
          ))}
        </div>
      </Modal>
    );
  }

  const title = result ? 'Estudo registrado' : opts.reviewId ? 'Registrar revisão' : opts.planItemId ? 'Registrar estudo do cronograma' : 'Registrar estudo';

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
              {s?.shiftedFrom && (
                <p className="mt-1 text-sm text-ink2">
                  ↔ Seria {fmtLong(s.shiftedFrom)}, mas esse dia já tinha {s.dailyReviewLimit} revisões (seu limite por dia): foi para o dia vizinho.
                </p>
              )}
              {result.completedReviewId && <p className="mt-1 text-sm text-ink2">✔ A revisão pendente deste assunto foi concluída.</p>}
              {result.planItem && (
                <p className="mt-1 text-sm text-ink2">
                  ✔ {result.planItem.label ? `${result.planItem.label} do cronograma` : 'Assunto do cronograma'} concluído
                  {result.planItem.late ? ' (estava atrasado)' : ''}.
                </p>
              )}
            </div>
          </div>
          {s && (
            <>
              <div className="rounded-xl border border-line p-3 text-sm">
                <p className="flex items-center gap-2 font-medium text-ink">
                  <Lightbulb className="h-4 w-4 text-accent" /> Para a próxima revisão
                </p>
                <p className="mt-1 text-ink2">
                  {s.checkup && 'Como foi só estudo/leitura, amanhã faça a revisão D1: questões, flashcards, recall ou teoria. '}
                  {s.suggestTheory && 'Volte ao conteúdo teórico e depois faça questões. '}
                  Sugerido: {s.suggestedMethods.map((m) => METHOD_LABEL[m]).join(', ')} · {s.suggestedQuestions.min}–{s.suggestedQuestions.max} questões.
                  {' '}Com bom desempenho, menos de {reference} questões aproximam a próxima revisão e mais de {reference} a afastam, aos poucos.
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
          <Button onClick={submit} loading={create.isPending || createMany.isPending} disabled={!canSubmit}>
            {isBatch ? `Registrar ${chosen.length} assuntos` : 'Registrar'}
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
          <SubjectPicker value={subject} onChange={setSubject} exclude={excludeIds.filter((x) => subject?.kind !== 'existing' || x !== subject.subject.id)} />
          {extras.map((x, j) => (
            <div key={j} className="mt-2 flex items-start gap-1">
              <div className="min-w-0 flex-1">
                <SubjectPicker
                  value={x}
                  onChange={(v) => setExtras((all) => all.map((y, k) => (k === j ? v : y)))}
                  exclude={excludeIds.filter((id) => x?.kind !== 'existing' || id !== x.subject.id)}
                />
              </div>
              <IconButton label="Tirar este assunto" onClick={() => setExtras((all) => all.filter((_, k) => k !== j))}>
                <X className="h-4 w-4" />
              </IconButton>
            </div>
          ))}
          {subject && extras.length < 9 && extras.every(Boolean) && (
            <button type="button" onClick={() => setExtras((all) => [...all, null])} className="mt-2 flex items-start gap-1.5 text-left text-sm font-medium text-accent">
              <Plus className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Outro assunto <span className="font-normal text-ink2">(o estudo englobou mais de um)</span>
              </span>
            </button>
          )}
          {isBatch && (
            <p className="mt-2 rounded-xl bg-accent-wash px-3 py-2 text-xs text-ink">
              {chosen.length} assuntos: cada um vira um estudo com a sua parte das questões e do tempo, e a revisão de cada um é calculada separadamente.
            </p>
          )}
          {duplicated && <p className="mt-1 text-xs text-crit-text">O mesmo assunto aparece mais de uma vez.</p>}
          {suggestion && !isBatch && <SuggestionBox suggestion={suggestion} />}
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
            <NumberInput
              label="Duração (minutos)"
              min={0}
              max={1440}
              value={minutes}
              onChange={setMinutes}
              hint={minutes ? (isBatch ? `${duration(minutes)} · ≈ ${duration(minuteParts[0] ?? 0)} por assunto` : duration(minutes)) : undefined}
            />
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
            {!(isBatch && perSubject) && (
              <div className="grid grid-cols-3 gap-2">
                <NumberInput label={isBatch ? 'Quantidade (total)' : 'Quantidade'} min={1} max={1000} value={total} onChange={setTotal} />
                <NumberInput label="Acertos" min={0} max={1000} value={correct} onChange={setCorrect} error={questionsError} />
                <div>
                  <span className="label">Erros</span>
                  <div className="input num bg-subtle text-ink2">{wrong ?? '—'}</div>
                </div>
              </div>
            )}
            {isBatch && (
              <div className="space-y-2 rounded-xl bg-subtle p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium text-ink">{perSubject ? 'Questões de cada assunto' : 'Divididas igualmente entre os assuntos'}</p>
                  <button type="button" className="text-xs font-medium text-accent" onClick={() => (perSubject ? setPerSubject(false) : startPerSubject())}>
                    {perSubject ? 'Dividir igualmente' : 'Informar por assunto'}
                  </button>
                </div>
                {perSubject && (
                  <div className={cx(PART_GRID, 'text-[11px] text-muted')}>
                    <span className="hidden sm:block">Assunto</span>
                    <span>Questões</span>
                    <span>Acertos</span>
                    <span className="text-right">%</span>
                  </div>
                )}
                {chosen.map((c, i) => {
                  const p = parts[i];
                  const name = c.kind === 'existing' ? c.subject.name : c.data.name;
                  const acc = p.total && p.correct !== null && p.correct <= p.total ? (p.correct / p.total) * 100 : null;
                  const setPart = (patch: Partial<{ total: number | null; correct: number | null }>) =>
                    setManual((m) => ({ ...m, [choiceKey(c)]: { ...(m[choiceKey(c)] ?? { total: null, correct: null }), ...patch } }));
                  return perSubject ? (
                    // No celular o nome fica numa linha própria (os nomes parecidos não se confundem)
                    <div key={choiceKey(c)} className={cx(PART_GRID, 'items-center text-sm')}>
                      <span className="col-span-3 truncate text-ink sm:col-span-1">{name}</span>
                      <input className="input num px-2 py-1.5" type="number" min={0} aria-label={`Questões de ${name}`} placeholder="Qtd." value={p.total ?? ''} onChange={(e) => setPart({ total: e.target.value === '' ? null : Number(e.target.value) })} />
                      <input className="input num px-2 py-1.5" type="number" min={0} aria-label={`Acertos de ${name}`} placeholder="Acertos" value={p.correct ?? ''} onChange={(e) => setPart({ correct: e.target.value === '' ? null : Number(e.target.value) })} />
                      <span className="num text-right text-xs text-ink2">{acc !== null ? pct(acc) : '—'}</span>
                    </div>
                  ) : (
                    <div key={choiceKey(c)} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate text-ink">{name}</span>
                      <span className="num shrink-0 text-ink2">{p.total ? `${p.correct ?? '—'}/${p.total}${acc !== null ? ` · ${pct(acc)}` : ''}` : '—'}</span>
                    </div>
                  );
                })}
                {perSubject && (
                  <p className="num text-xs text-ink2">
                    Total: {partsCorrect}/{partsTotal}
                    {partsTotal ? ` = ${pct((partsCorrect / partsTotal) * 100)}` : ''} de acertos
                  </p>
                )}
                {partsError && <p className="text-xs text-crit-text">{partsError}</p>}
                <p className="text-xs text-muted">
                  Cada assunto conta só com a sua parte: com menos de {reference} questões num assunto, a próxima revisão dele fica um pouco mais próxima.
                </p>
              </div>
            )}
            {accuracy !== null && !(isBatch && perSubject) && (
              <p className="num rounded-xl bg-subtle px-3 py-2 text-sm text-ink">
                Resultado:{' '}
                <strong>
                  {correct}/{total} = {pct(accuracy)}
                </strong>{' '}
                de acertos
              </p>
            )}
            {!isBatch && total !== null && total > 0 && suggestion?.questionCount && <QuantityHint total={total} config={suggestion.questionCount} />}
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
          {noQuestionsHint && <p className="mt-2 text-xs text-ink2">{noQuestionsHint}</p>}
        </section>

        <Textarea label="Observações (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/** Um assunto de um estudo com vários assuntos: resultado e próxima revisão. */
function BatchResultRow({ result }: { result: StudyResult }) {
  const s = result.schedule;
  const q = result.session.questions;
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-good-wash p-3">
      <CalendarCheck2 className="mt-0.5 h-5 w-5 shrink-0" style={{ color: 'var(--good)' }} />
      <div className="min-w-0 text-sm">
        <p className="font-medium text-ink">
          {result.session.subject.name}
          {q && (
            <span className="text-ink2">
              {' '}
              · {q.correct}/{q.total} = {pct(q.accuracy)}
            </span>
          )}
        </p>
        {s && (
          <p className="mt-0.5 text-ink2">
            Próxima revisão <strong className="text-ink">{s.stageLabel}</strong> {relativeDay(s.dueOn)} ({fmtLong(s.dueOn)}).
            {s.shiftedFrom && ` Seria ${fmtLong(s.shiftedFrom)}, mas o dia já estava cheio (limite de ${s.dailyReviewLimit}).`}
          </p>
        )}
        {(result.completedReviewId || result.planItem) && (
          <p className="mt-0.5 text-xs text-ink2">
            {result.completedReviewId && '✔ Revisão pendente concluída. '}
            {result.planItem && `✔ ${result.planItem.label ? `${result.planItem.label} do cronograma` : 'Assunto do cronograma'} concluído.`}
          </p>
        )}
      </div>
    </div>
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
      return `Revisão D1${when}: o último contato foi só estudo/leitura. Revise como preferir — ${s.questions.min}–${s.questions.max} questões, flashcards, recall ou teoria — e marque "Como foi?". Sem questões, a próxima data sai da sua autoavaliação, do tempo de estudo e da dificuldade.`;
    }
    const ref = s.questionCount?.reference ?? 25;
    return `Revisão ${s.stageLabel}${when} — ${s.phase.toLowerCase()}. Sugerido: ${methods} · ${s.questions.min}–${s.questions.max} questões. ${ref} questões é a referência: indo bem, menos que isso aproxima a próxima revisão e mais que isso a afasta.`;
  }, [s]);
  return (
    <p className="mt-2 flex items-start gap-2 rounded-xl bg-accent-wash px-3 py-2 text-xs text-ink">
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
      {text}
    </p>
  );
}

