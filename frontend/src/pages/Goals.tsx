import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Archive, CheckCircle2, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import type { Goal, GoalMetric, GoalPeriod } from '../api/types';
import { useAreas, useGoals, useInvalidateStudyData, useSubjects } from '../hooks/api';
import { GOAL_METRICS, GOAL_PERIODS } from '../lib/constants';
import { addDaysStr, fmtShort, num, plural, todayLocal } from '../lib/format';
import { Button, ConfirmDialog, EmptyState, ErrorState, IconButton, Input, Loading, Modal, NumberInput, PageHeader, ProgressBar, Segmented, Select, Textarea, useToast } from '../components/ui';
import { AreaOptions } from '../components/study/SubjectPicker';

const PERIOD_LABEL: Record<GoalPeriod, string> = { DAILY: 'Diária', WEEKLY: 'Semanal', MONTHLY: 'Mensal', CUSTOM: 'Personalizada' };
const isHours = (m: GoalMetric) => m === 'STUDY_MINUTES';

function display(goal: Pick<Goal, 'metric'>, v: number) {
  return isHours(goal.metric) ? `${num(v / 60, 1)} h` : num(v, 1);
}

function GoalDialog({ goal, onClose }: { goal?: Goal; onClose: () => void }) {
  const invalidate = useInvalidateStudyData();
  const toast = useToast();
  const { data: areas = [] } = useAreas();
  const { data: subjects = [] } = useSubjects();
  const [form, setForm] = useState({
    title: goal?.title ?? '',
    description: goal?.description ?? '',
    metric: (goal?.metric ?? 'QUESTIONS') as GoalMetric,
    period: (goal?.period ?? 'WEEKLY') as GoalPeriod,
    target: goal ? (isHours(goal.metric) ? goal.target / 60 : goal.target) : (100 as number | null),
    areaId: goal?.areaId ?? '',
    subjectId: goal?.subjectId ?? '',
    dueDate: goal?.dueDate ?? addDaysStr(todayLocal(), 30),
    manualProgress: goal?.manualProgress ?? 0,
  });
  const metric = GOAL_METRICS.find((m) => m.value === form.metric)!;
  const scoped = ['QUESTIONS', 'CORRECT_ANSWERS', 'STUDY_MINUTES', 'STUDY_SESSIONS', 'STUDY_DAYS', 'REVIEWS_DONE', 'CLEAR_OVERDUE'].includes(form.metric);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: form.title,
        description: form.description || null,
        metric: form.metric,
        period: form.period,
        target: form.metric === 'CLEAR_OVERDUE' ? (goal ? undefined : 1) : isHours(form.metric) ? (form.target ?? 0) * 60 : form.target,
        areaId: scoped && form.areaId ? form.areaId : null,
        subjectId: scoped && form.subjectId ? form.subjectId : null,
        dueDate: form.period === 'CUSTOM' ? form.dueDate : null,
        ...(form.metric === 'CUSTOM' ? { manualProgress: form.manualProgress } : {}),
      };
      return goal ? api.patch(`/goals/${goal.id}`, body) : api.post('/goals', body);
    },
    onSuccess: async () => {
      await invalidate();
      toast.success(goal ? 'Meta atualizada.' : 'Meta criada.');
      onClose();
    },
    onError: toast.error,
  });
  const areaSubjects = subjects.filter((s) => !form.areaId || s.areaId === form.areaId || s.area?.topId === form.areaId);
  return (
    <Modal
      open
      onClose={onClose}
      title={goal ? 'Editar meta' : 'Nova meta'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} disabled={!form.title.trim() || (form.metric !== 'CLEAR_OVERDUE' && !form.target)} onClick={() => save.mutate()}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select label="Tipo de meta" value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value as GoalMetric })} disabled={!!goal}>
          {GOAL_METRICS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
        <Input label="Título" placeholder={metric.example} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={120} />
        <div>
          <span className="label">Período</span>
          <Segmented size="sm" value={form.period} onChange={(period) => setForm({ ...form, period })} options={GOAL_PERIODS.map((p) => ({ value: p.value, label: p.label.split(' ')[0] }))} />
          <p className="mt-1 text-xs text-muted">Metas diárias, semanais e mensais se renovam automaticamente a cada período.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {form.metric !== 'CLEAR_OVERDUE' ? (
            <NumberInput label={`Quantidade desejada (${metric.unit})`} min={1} value={form.target} onChange={(v) => setForm({ ...form, target: v })} />
          ) : (
            <p className="col-span-2 rounded-xl bg-subtle p-3 text-sm text-ink2">O alvo é o número de revisões atrasadas agora; o progresso sobe conforme você as conclui.</p>
          )}
          {form.period === 'CUSTOM' && <Input label="Prazo" type="date" min={todayLocal()} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />}
        </div>
        {form.metric === 'CUSTOM' && <NumberInput label="Progresso atual (manual)" min={0} value={form.manualProgress} onChange={(v) => setForm({ ...form, manualProgress: v ?? 0 })} />}
        {scoped && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Limitar a uma área (opcional)" value={form.areaId} onChange={(e) => setForm({ ...form, areaId: e.target.value, subjectId: '' })}>
              <option value="">Todas as áreas</option>
              <AreaOptions areas={areas} />
            </Select>
            <Select label="…ou a um assunto (opcional)" value={form.subjectId} onChange={(e) => setForm({ ...form, subjectId: e.target.value })}>
              <option value="">Todos os assuntos</option>
              {areaSubjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        <Textarea label="Descrição (opcional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </div>
    </Modal>
  );
}

function GoalCard({ goal, onEdit, onDelete, onArchive, onProgress }: { goal: Goal; onEdit: () => void; onDelete: () => void; onArchive: () => void; onProgress: (v: number) => void }) {
  const done = goal.status === 'COMPLETED' || goal.reachedThisPeriod;
  const statusText =
    goal.status === 'COMPLETED'
      ? 'Concluída'
      : goal.status === 'EXPIRED'
        ? 'Prazo encerrado'
        : goal.status === 'ARCHIVED'
          ? 'Arquivada'
          : goal.reachedThisPeriod
            ? 'Concluída neste período'
            : goal.daysLeft === 0
              ? 'Termina hoje'
              : `${plural(goal.daysLeft, 'dia restante', 'dias restantes')}`;
  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-ink">{goal.title}</p>
          <p className="text-xs text-muted">
            {PERIOD_LABEL[goal.period]}
            {goal.period === 'CUSTOM' && goal.dueDate ? ` · até ${fmtShort(goal.dueDate)}` : ` · ${fmtShort(goal.window.from)}–${fmtShort(goal.window.to)}`}
          </p>
        </div>
        <div className="flex shrink-0">
          <IconButton label="Editar" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
          </IconButton>
          <IconButton label={goal.status === 'ARCHIVED' ? 'Reativar' : 'Arquivar'} onClick={onArchive}>
            <Archive className="h-4 w-4" />
          </IconButton>
          <IconButton label="Excluir" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </IconButton>
        </div>
      </div>
      {goal.description && <p className="text-sm text-ink2">{goal.description}</p>}
      <div>
        <ProgressBar value={goal.percent} color={done ? 'var(--good)' : goal.status === 'EXPIRED' ? 'var(--muted)' : 'var(--accent)'} height={10} label={goal.title} />
        <div className="num mt-1.5 flex items-center justify-between text-sm">
          <span className="text-ink">
            {display(goal, goal.progress)}/{display(goal, goal.target)} <span className="text-xs text-muted">{goal.metricLabel}</span>
          </span>
          <span className="font-semibold text-ink">{Math.round(goal.percent)}%</span>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1 text-xs" style={{ color: done ? 'var(--good-text)' : 'var(--ink-2)' }}>
          {done && <CheckCircle2 className="h-3.5 w-3.5" />}
          {statusText}
        </span>
        {goal.metric === 'CUSTOM' && goal.status === 'ACTIVE' && (
          <Button size="sm" variant="secondary" onClick={() => onProgress(goal.manualProgress + 1)}>
            +1
          </Button>
        )}
      </div>
    </div>
  );
}

export default function GoalsPage() {
  const { data, isLoading, error } = useGoals();
  const invalidate = useInvalidateStudyData();
  const toast = useToast();
  const [dialog, setDialog] = useState<{ goal?: Goal } | null>(null);
  const [deleting, setDeleting] = useState<Goal | null>(null);
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) => api.patch(`/goals/${id}`, body),
    onSuccess: invalidate,
    onError: toast.error,
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/goals/${id}`),
    onSuccess: async () => {
      await invalidate();
      setDeleting(null);
    },
    onError: toast.error,
  });

  const active = (data ?? []).filter((g) => g.status === 'ACTIVE');
  const finished = (data ?? []).filter((g) => g.status !== 'ACTIVE');
  const renderList = (list: Goal[]) => (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {list.map((g) => (
        <GoalCard
          key={g.id}
          goal={g}
          onEdit={() => setDialog({ goal: g })}
          onDelete={() => setDeleting(g)}
          onArchive={() => update.mutate({ id: g.id, body: { status: g.status === 'ARCHIVED' ? 'ACTIVE' : 'ARCHIVED' } })}
          onProgress={(v) => update.mutate({ id: g.id, body: { manualProgress: v } })}
        />
      ))}
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Metas"
        subtitle="Metas diárias, semanais, mensais ou com prazo. O progresso é calculado automaticamente a partir dos seus registros."
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setDialog({})}>
            Nova meta
          </Button>
        }
      />
      {isLoading && <Loading />}
      {error && <ErrorState error={error} />}
      {data && data.length === 0 && (
        <EmptyState icon="🎯" title="Nenhuma meta ainda" action={<Button onClick={() => setDialog({})}>Criar meta</Button>}>
          Ex.: “Fazer 500 questões esta semana”, “Estudar 20 horas este mês”, “Fazer 3 simulados este mês”.
        </EmptyState>
      )}
      {active.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-ink2">Ativas ({active.length})</h2>
          {renderList(active)}
        </section>
      )}
      {finished.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink2">Encerradas ({finished.length})</h2>
          {renderList(finished)}
        </section>
      )}
      {dialog && <GoalDialog goal={dialog.goal} onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={!!deleting}
        title="Excluir meta?"
        message={`A meta "${deleting?.title}" será excluída.`}
        confirmLabel="Excluir"
        danger
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
