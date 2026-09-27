import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { CalendarPlus, Trash2, Upload } from 'lucide-react';
import { api } from '../api/client';
import type { PlanItem } from '../api/types';
import { useInvalidateStudyData, usePlan, usePlans } from '../hooks/api';
import { fmtShort, plural, todayLocal } from '../lib/format';
import { Button, Card, EmptyState, ErrorState, Loading, Modal, PageHeader, ProgressBar, Segmented, StatTile, cx, useToast } from '../components/ui';
import { PlanItemCard, weekLabel, weekRange } from '../components/study/PlanItemCard';

type Filter = 'pendentes' | 'todos';

function ShiftDialog({ planId, pending, onClose }: { planId: string; pending: number; onClose: () => void }) {
  const invalidate = useInvalidateStudyData();
  const toast = useToast();
  const [weeks, setWeeks] = useState(1);
  const shift = useMutation({
    mutationFn: () => api.post<{ shifted: number }>(`/plans/${planId}/shift`, { days: weeks * 7 }),
    onSuccess: async (r) => {
      await invalidate();
      toast.success(`${plural(r.shifted, 'assunto foi', 'assuntos foram')} ${plural(weeks, 'semana', 'semanas')} para frente.`);
      onClose();
    },
    onError: toast.error,
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Empurrar o cronograma"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={shift.isPending} onClick={() => shift.mutate()}>
            Empurrar
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-ink2">
        Os {plural(pending, 'assunto pendente', 'assuntos pendentes')} (inclusive os atrasados) vão para frente, mantendo a ordem. Os já estudados não mudam.
      </p>
      <Segmented
        value={weeks}
        onChange={setWeeks}
        ariaLabel="Quantas semanas"
        options={[1, 2, 3, 4].map((n) => ({ value: n, label: plural(n, 'semana', 'semanas') }))}
      />
    </Modal>
  );
}

function DeleteDialog({ planId, name, onClose }: { planId: string; name: string; onClose: () => void }) {
  const invalidate = useInvalidateStudyData();
  const toast = useToast();
  const [removeSubjects, setRemoveSubjects] = useState(true);
  const del = useMutation({
    mutationFn: () => api.del<{ removedSubjects: number }>(`/plans/${planId}?removeSubjects=${removeSubjects ? 1 : 0}`),
    onSuccess: async (r) => {
      await invalidate();
      toast.success(r && r.removedSubjects ? `Cronograma excluído, com ${plural(r.removedSubjects, 'assunto', 'assuntos')} que nunca foram estudados.` : 'Cronograma excluído.');
      onClose();
    },
    onError: toast.error,
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Excluir “${name}”?`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="danger" loading={del.isPending} onClick={() => del.mutate()}>
            Excluir
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-ink2">Seus estudos e revisões continuam; só a programação por semana sai.</p>
      <label className="flex items-start gap-2 text-sm text-ink">
        <input type="checkbox" checked={removeSubjects} onChange={(e) => setRemoveSubjects(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
        Apagar também os assuntos que o cronograma criou e que você nunca estudou
      </label>
    </Modal>
  );
}

export default function PlanPage() {
  const today = todayLocal();
  const [params, setParams] = useSearchParams();
  const plans = usePlans();
  const planId = params.get('plano') ?? plans.data?.[0]?.id;
  const plan = usePlan(planId);
  const [filter, setFilter] = useState<Filter>('pendentes');
  const [dialog, setDialog] = useState<'shift' | 'delete' | null>(null);
  // Semanas futuras visíveis (as passadas e a atual aparecem sempre)
  const [ahead, setAhead] = useState(4);
  const scrolled = useRef(false);

  const weeks = useMemo(() => {
    const byWeek = new Map<string, PlanItem[]>();
    for (const i of plan.data?.items ?? []) {
      if (filter === 'pendentes' && i.status !== 'PENDING' && !i.current) continue;
      byWeek.set(i.weekStart, [...(byWeek.get(i.weekStart) ?? []), i]);
    }
    return [...byWeek.entries()].map(([start, items]) => ({
      start,
      items,
      label: weekLabel(items.find((i) => !/b[oô]nus/i.test(i.label ?? ''))?.label ?? items[0].label),
      current: items[0].current,
      overdue: items.some((i) => i.overdue),
      done: items.every((i) => i.status !== 'PENDING'),
    }));
  }, [plan.data, filter]);

  const future = weeks.filter((w) => w.start > today && !w.current);
  const visible = weeks.filter((w) => !(w.start > today && !w.current) || future.indexOf(w) < ahead);
  const hidden = weeks.length - visible.length;

  // Abre na semana atual
  useEffect(() => {
    if (scrolled.current || !weeks.length) return;
    scrolled.current = true;
    document.getElementById('semana-atual')?.scrollIntoView({ block: 'start' });
  }, [weeks]);

  const importButton = (
    <Link to="/cronograma/importar" className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90">
      <Upload className="h-4 w-4" /> Importar cronograma
    </Link>
  );

  if (plans.isLoading) return <Loading />;
  if (plans.error) return <ErrorState error={plans.error} />;

  return (
    <div className="space-y-5">
      <PageHeader title="Cronograma" subtitle="Assuntos previstos por semana. Estude pelo botão de cada um; os que passarem da semana aparecem como atrasados." actions={importButton} />

      {!plans.data?.length ? (
        <EmptyState icon="🗓️" title="Nenhum cronograma ainda" action={importButton}>
          Importe o PDF do cronograma do seu cursinho (ex.: “Módulo 01 – 13/01 · Hipertensão, Hérnias…”). Cada assunto entra na sua semana, aparece no calendário e, depois de
          estudado, ganha revisões automáticas.
        </EmptyState>
      ) : (
        <>
          {plans.data.length > 1 && (
            <label className="block max-w-sm">
              <span className="label">Cronograma</span>
              <select className="input" value={planId} onChange={(e) => setParams({ plano: e.target.value })}>
                {plans.data.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {plan.error && <ErrorState error={plan.error} />}
          {plan.data && (
            <>
              <Card
                title={plan.data.name}
                subtitle={plan.data.firstWeek && plan.data.lastWeek ? `Semanas de ${fmtShort(plan.data.firstWeek)} a ${fmtShort(plan.data.lastWeek)}` : undefined}
                action={
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" icon={<CalendarPlus className="h-4 w-4" />} disabled={!plan.data.pending} onClick={() => setDialog('shift')}>
                      Empurrar
                    </Button>
                    <Button variant="ghost" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDialog('delete')}>
                      Excluir
                    </Button>
                  </div>
                }
              >
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <StatTile label="Estudados" value={`${plan.data.done}/${plan.data.total}`} />
                  <StatTile label="Atrasados" value={plan.data.overdue} />
                  <StatTile label="Pendentes" value={plan.data.pending} />
                  <StatTile label="Pulados" value={plan.data.skipped} />
                </div>
                <div className="mt-4">
                  <ProgressBar value={plan.data.total ? (plan.data.done / plan.data.total) * 100 : 0} label="Progresso do cronograma" />
                </div>
              </Card>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <Segmented<Filter>
                  value={filter}
                  onChange={setFilter}
                  ariaLabel="Mostrar"
                  options={[
                    { value: 'pendentes', label: 'Pendentes' },
                    { value: 'todos', label: 'Todas as semanas' },
                  ]}
                />
              </div>

              {weeks.length === 0 ? (
                <EmptyState icon="🎉" title="Nada pendente neste cronograma">
                  Todos os assuntos foram estudados ou pulados. Veja “Todas as semanas” para rever.
                </EmptyState>
              ) : (
                <div className="space-y-4">
                  {visible.map((w) => (
                    <section key={w.start} id={w.current ? 'semana-atual' : undefined} className="scroll-mt-20">
                      <h2 className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                        {w.label}
                        <span className="num font-normal text-ink2">· {weekRange(w.items[0])}</span>
                        {w.current && <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-white">esta semana</span>}
                        {w.overdue && <span className="rounded-full bg-crit-wash px-2 py-0.5 text-[11px] font-medium text-crit-text">atrasada</span>}
                        {w.done && !w.overdue && (
                          <span className="rounded-full bg-good-wash px-2 py-0.5 text-[11px] font-medium" style={{ color: 'var(--good-text)' }}>
                            concluída
                          </span>
                        )}
                      </h2>
                      <div className={cx('space-y-2', w.start > today && !w.current && 'opacity-90')}>
                        {w.items.map((i) => (
                          <PlanItemCard key={i.id} item={i} showWeek={false} full />
                        ))}
                      </div>
                    </section>
                  ))}
                  {hidden > 0 && (
                    <div className="text-center">
                      <Button variant="secondary" onClick={() => setAhead((n) => n + 8)}>
                        Ver mais semanas ({hidden} restantes)
                      </Button>
                    </div>
                  )}
                </div>
              )}
              {dialog === 'shift' && <ShiftDialog planId={plan.data.id} pending={plan.data.pending} onClose={() => setDialog(null)} />}
              {dialog === 'delete' && (
                <DeleteDialog
                  planId={plan.data.id}
                  name={plan.data.name}
                  onClose={() => {
                    setDialog(null);
                    setParams({});
                  }}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
