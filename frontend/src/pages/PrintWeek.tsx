import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronLeft, ChevronRight, Printer } from 'lucide-react';
import { api } from '../api/client';
import type { Review } from '../api/types';
import { useAuth } from '../hooks/useAuth';
import { METHOD_LABEL, QUALITY } from '../lib/constants';
import { addDaysStr, fmtDay, fmtShort, parseDay, plural, startOfWeekStr, todayLocal } from '../lib/format';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Button, Loading, cx } from '../components/ui';

// Folha semanal de revisões para imprimir (ou salvar em PDF) e controlar no papel.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const weekdayName = (d: string) => format(parseDay(d), 'EEEE', { locale: ptBR });

function Checkbox({ done }: { done?: boolean }) {
  return (
    <span
      aria-hidden
      className={cx('inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border-[1.5px] text-[10px] font-bold', done ? 'border-[#0ca30c] bg-[#e7f6e7] text-[#006300]' : 'border-[#52514e]')}
    >
      {done ? '✓' : ''}
    </span>
  );
}

function StageChip({ review }: { review: Review }) {
  return (
    <span className="inline-block whitespace-nowrap rounded-md bg-[#e6f0fc] px-1.5 py-0.5 text-[10px] font-bold text-[#1c5cab]">
      {review.stageLabel}
      {review.checkup && ' ✎'}
    </span>
  );
}

function ReviewRow({ review, today, carried }: { review: Review; today: string; carried?: boolean }) {
  const done = review.status === 'DONE';
  const late = !done && review.scheduledFor < today;
  const methods = review.suggestedMethods.map((m) => METHOD_LABEL[m]).join(', ');
  return (
    <tr className="border-t border-[#e1e0d9] align-top">
      <td className="py-1.5 pl-2 pr-2">
        <Checkbox done={done} />
      </td>
      <td className="py-1.5 pr-2">
        <div className="flex items-start gap-1.5">
          <span aria-hidden className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: review.subject.area?.color ?? '#898781' }} />
          <div className="min-w-0">
            <p className="text-[12px] font-semibold leading-tight text-[#0b0b0b]">{review.subject.name}</p>
            <p className="text-[10px] leading-tight text-[#52514e]">
              {review.subject.area?.path}
              {carried && <span className="text-[#b02a2a]"> · prevista {fmtShort(review.scheduledFor)}</span>}
              {late && !carried && <span className="text-[#b02a2a]"> · atrasada</span>}
            </p>
          </div>
        </div>
      </td>
      <td className="py-1.5 pr-2">
        <StageChip review={review} />
      </td>
      <td className="py-1.5 pr-2 text-[10px] leading-tight text-[#52514e]">
        {done ? (
          <span className="font-medium text-[#006300]">
            Feita {review.completedOn ? `em ${fmtShort(review.completedOn)}` : ''}
            {review.performance !== null ? ` · ${Math.round(review.performance)}%` : ''}
          </span>
        ) : (
          <>
            {review.suggestTheory && <span className="font-semibold text-[#0b0b0b]">Rever teoria · </span>}
            {review.suggestedQuestions ? <span className="font-semibold text-[#0b0b0b]">~{review.suggestedQuestions} questões</span> : null}
            <span className="block">{methods}</span>
          </>
        )}
      </td>
      <td className="py-1.5 pr-2">
        {!done && <span className="whitespace-nowrap text-[11px] text-[#898781]">____ / ____</span>}
      </td>
      <td className="py-1.5 pr-2">
        {!done && (
          <span className="whitespace-nowrap text-[13px] tracking-[2px]" title={QUALITY.map((q) => q.label).join(', ')}>
            {QUALITY.map((q) => q.emoji).join('')}
          </span>
        )}
      </td>
    </tr>
  );
}

function ReviewTable({ reviews, today, carried }: { reviews: Review[]; today: string; carried?: boolean }) {
  return (
    <table className="w-full border-collapse text-left">
      <colgroup>
        <col className="w-7" />
        <col />
        <col className="w-12" />
        <col className="w-[27%]" />
        <col className="w-[13%]" />
        <col className="w-[16%]" />
      </colgroup>
      <thead>
        <tr className="text-[9px] uppercase tracking-wide text-[#898781]">
          <th className="pb-1 pl-2 font-semibold" />
          <th className="pb-1 font-semibold">Assunto</th>
          <th className="pb-1 font-semibold">Etapa</th>
          <th className="pb-1 font-semibold">O que fazer</th>
          <th className="pb-1 font-semibold">Acertos</th>
          <th className="pb-1 font-semibold">Como foi</th>
        </tr>
      </thead>
      <tbody>
        {reviews.map((r) => (
          <ReviewRow key={r.id} review={r} today={today} carried={carried} />
        ))}
      </tbody>
    </table>
  );
}

export default function PrintWeekPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const today = todayLocal();
  const param = params.get('semana');
  const weekStart = startOfWeekStr(param && DATE_RE.test(param) ? param : today);
  const weekEnd = addDaysStr(weekStart, 6);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysStr(weekStart, i)), [weekStart]);
  const isCurrentWeek = today >= weekStart && today <= weekEnd;
  const [showDone, setShowDone] = useState(true);

  const pending = useQuery({
    queryKey: ['reviews', 'print', 'pending', weekStart],
    queryFn: () => api.get<Review[]>('/reviews', { status: 'PENDING', from: weekStart, to: weekEnd }),
  });
  const done = useQuery({
    queryKey: ['reviews', 'print', 'done', weekStart],
    queryFn: () => api.get<Review[]>('/reviews', { status: 'DONE', from: weekStart, to: weekEnd }),
  });
  const carried = useQuery({
    queryKey: ['reviews', 'print', 'carried', weekStart],
    queryFn: () => api.get<Review[]>('/reviews', { status: 'PENDING', to: addDaysStr(weekStart, -1) }),
    enabled: isCurrentWeek,
  });

  const byDay = useMemo(() => {
    const map = new Map<string, Review[]>(days.map((d) => [d, []]));
    if (showDone) for (const r of done.data ?? []) if (r.completedOn && map.has(r.completedOn)) map.get(r.completedOn)!.push(r);
    for (const r of pending.data ?? []) map.get(r.scheduledFor)?.push(r);
    return map;
  }, [days, pending.data, done.data, showDone]);

  const loading = pending.isLoading || done.isLoading || (isCurrentWeek && carried.isLoading);
  const pendingCount = (pending.data?.length ?? 0) + (carried.data?.length ?? 0);
  const doneCount = done.data?.length ?? 0;
  const questions = [...(pending.data ?? []), ...(carried.data ?? [])].reduce((s, r) => s + (r.suggestedQuestions ?? 0), 0);
  const range = `${fmtDay(weekStart, "dd 'de' MMMM")} a ${fmtDay(weekEnd, "dd 'de' MMMM 'de' yyyy")}`;
  const goWeek = (delta: number) => setParams({ semana: addDaysStr(weekStart, delta * 7) });

  return (
    <div className="min-h-screen bg-subtle print:bg-white">
      {/* Barra de ações (não sai na impressão) */}
      <div className="no-print sticky top-0 z-10 border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[210mm] flex-wrap items-center gap-2 px-4 py-3">
          <Link to="/calendario" className="inline-flex items-center gap-1 rounded-xl px-2 py-1.5 text-sm text-ink2 hover:bg-subtle hover:text-ink">
            <ArrowLeft className="h-4 w-4" /> Calendário
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" aria-label="Semana anterior" onClick={() => goWeek(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[10rem] text-center text-sm font-medium text-ink">
              {fmtShort(weekStart)} – {fmtShort(weekEnd)}
            </span>
            <Button variant="ghost" size="sm" aria-label="Próxima semana" onClick={() => goWeek(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <label className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm text-ink2">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            Incluir revisões feitas
          </label>
          <Button icon={<Printer className="h-4 w-4" />} onClick={() => window.print()} disabled={loading}>
            Imprimir / salvar PDF
          </Button>
        </div>
        <p className="mx-auto max-w-[210mm] px-4 pb-3 text-xs text-muted">
          Dica: na janela de impressão, escolha “Salvar como PDF” para guardar ou mandar para o grupo.
        </p>
      </div>

      {loading ? (
        <Loading label="Montando a folha da semana…" />
      ) : (
        <article className="print-sheet force-light mx-auto my-6 max-w-[210mm] bg-white p-[10mm] text-[#0b0b0b] shadow-pop print:my-0 print:max-w-none print:p-0 print:shadow-none">
          {/* Cabeçalho */}
          <header className="flex items-start justify-between gap-4 border-b-2 border-[#012563] pb-3">
            <div className="flex items-center gap-3">
              <img src="/icons/mark-128.png" alt="" className="h-11 w-11 rounded-xl" />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#1c5cab]">Projeto Residente</p>
                <h1 className="text-[20px] font-bold leading-tight text-[#012563]">Revisões da semana</h1>
                <p className="text-[11px] text-[#52514e]">
                  {range}
                  {user && ` · ${user.name}`}
                </p>
              </div>
            </div>
            <dl className="grid shrink-0 grid-cols-3 gap-2 text-center">
              {[
                ['Revisões', pendingCount],
                ['Questões', questions ? `~${questions}` : '—'],
                ['Feitas', doneCount],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-[#e1e0d9] px-3 py-1.5">
                  <dd className="text-[16px] font-bold leading-tight text-[#012563]">{value}</dd>
                  <dt className="text-[9px] uppercase tracking-wide text-[#898781]">{label}</dt>
                </div>
              ))}
            </dl>
          </header>

          {/* Legenda */}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[9.5px] text-[#52514e]">
            <span className="flex items-center gap-1">
              <Checkbox /> marque ao terminar
            </span>
            <span>
              <b className="text-[#1c5cab]">D10 · D21 · D60 · D90</b> etapa da revisão
            </span>
            <span>
              <b className="text-[#1c5cab]">D3</b> reforço (desempenho abaixo de 60%)
            </span>
            <span>
              <b className="text-[#1c5cab]">✎</b> revisão D1 após leitura (questões, flashcards ou teoria)
            </span>
            <span>Como foi: circule 😄 dominei · 🙂 fui bem · 😐 razoável · 😕 dificuldade · 😣 esqueci</span>
          </div>

          {/* Atrasadas de semanas anteriores */}
          {isCurrentWeek && (carried.data?.length ?? 0) > 0 && (
            <section className="avoid-break mt-4 overflow-hidden rounded-xl border border-[#f2c4c4]">
              <h2 className="flex items-center justify-between bg-[#fbeaea] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-[#b02a2a]">
                <span>⚠ Atrasadas — fazer primeiro</span>
                <span>{plural(carried.data!.length, 'revisão', 'revisões')}</span>
              </h2>
              <div className="px-1 pb-1">
                <ReviewTable reviews={carried.data!} today={today} carried />
              </div>
            </section>
          )}

          {/* Dias da semana */}
          <div className="mt-4 space-y-3">
            {days.map((d) => {
              const list = byDay.get(d) ?? [];
              const isToday = d === today;
              return (
                <section key={d} className={cx('avoid-break overflow-hidden rounded-xl border', isToday ? 'border-[#2a78d6]' : 'border-[#e1e0d9]')}>
                  <h2 className={cx('flex items-center justify-between px-3 py-1.5', isToday ? 'bg-[#2a78d6] text-white' : 'bg-[#f0efec] text-[#0b0b0b]')}>
                    <span className="text-[12px] font-bold">
                      <span className="uppercase">{weekdayName(d)}</span>
                      <span className={cx('ml-2 font-medium', isToday ? 'text-white/90' : 'text-[#52514e]')}>{fmtShort(d)}</span>
                      {isToday && <span className="ml-2 rounded bg-white/20 px-1.5 py-0.5 text-[9px] uppercase tracking-wide">hoje</span>}
                    </span>
                    <span className={cx('text-[10px] font-semibold', isToday ? 'text-white' : 'text-[#52514e]')}>
                      {list.length ? plural(list.length, 'revisão', 'revisões') : 'livre'}
                    </span>
                  </h2>
                  {list.length ? (
                    <div className="px-1 pb-1">
                      <ReviewTable reviews={list} today={today} />
                    </div>
                  ) : (
                    <div className="px-3 py-2">
                      <p className="text-[10.5px] text-[#898781]">Nenhuma revisão — dia livre para conteúdo novo ✍️</p>
                      <div className="mt-2 h-4 border-b border-dashed border-[#c3c2b7]" />
                    </div>
                  )}
                </section>
              );
            })}
          </div>

          {/* Anotações */}
          <section className="avoid-break mt-4 rounded-xl border border-[#e1e0d9] px-3 py-2">
            <h2 className="text-[11px] font-bold uppercase tracking-wide text-[#012563]">Anotações da semana</h2>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-6 border-b border-dashed border-[#c3c2b7]" />
            ))}
          </section>

          <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[9px] text-[#898781]">
            <span>Depois de revisar, registre no app (Registrar estudo) — o algoritmo recalcula as próximas datas.</span>
            <span>Gerado em {fmtShort(today)}</span>
          </footer>
        </article>
      )}
    </div>
  );
}
