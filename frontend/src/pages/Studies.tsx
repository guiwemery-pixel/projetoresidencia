import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import type { Study, StudyMethod } from '../api/types';
import { useInvalidateStudyData, useStudies } from '../hooks/api';
import { DIFFICULTY, METHODS, METHOD_LABEL, QUALITY } from '../lib/constants';
import { duration, fmtLong, pct, todayLocal } from '../lib/format';
import { AreaDot, Button, ConfirmDialog, EmptyState, ErrorState, IconButton, Input, Loading, Modal, NumberInput, PageHeader, Select, Textarea, cx, useToast } from '../components/ui';
import { useStudyDialog } from '../components/study/StudyDialog';

function EditStudyDialog({ study, onClose }: { study: Study; onClose: () => void }) {
  const invalidate = useInvalidateStudyData();
  const toast = useToast();
  const [date, setDate] = useState(study.date);
  const [minutes, setMinutes] = useState<number | null>(study.durationMinutes);
  const [methods, setMethods] = useState<StudyMethod[]>(study.methods);
  const [total, setTotal] = useState<number | null>(study.questions?.total ?? null);
  const [correct, setCorrect] = useState<number | null>(study.questions?.correct ?? null);
  const [quality, setQuality] = useState<number | null>(study.quality);
  const [difficulty, setDifficulty] = useState<number | null>(study.difficulty);
  const [notes, setNotes] = useState(study.notes ?? '');
  const save = useMutation({
    mutationFn: () =>
      api.patch(`/studies/${study.id}`, {
        date,
        durationMinutes: minutes ?? 0,
        methods,
        quality,
        difficulty,
        notes: notes || null,
        questions: total ? { ...(study.questions ?? {}), total, correct: correct ?? 0 } : null,
      }),
    onSuccess: async () => {
      await invalidate();
      toast.success('Registro atualizado. As revisões do assunto foram recalculadas.');
      onClose();
    },
    onError: toast.error,
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Editar — ${study.subject.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} disabled={!methods.length || (total !== null && (correct ?? 0) > total)} onClick={() => save.mutate()}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Input label="Data" type="date" max={todayLocal()} value={date} onChange={(e) => setDate(e.target.value)} />
          <NumberInput label="Duração (min)" min={0} value={minutes} onChange={setMinutes} />
        </div>
        <div className="flex flex-wrap gap-2">
          {METHODS.map((m) => (
            <button
              key={m.value}
              type="button"
              aria-pressed={methods.includes(m.value)}
              onClick={() => setMethods((c) => (c.includes(m.value) ? c.filter((x) => x !== m.value) : [...c, m.value]))}
              className={cx('chip', methods.includes(m.value) ? 'border-accent bg-accent-wash text-ink' : 'text-ink2')}
            >
              {m.emoji} {m.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumberInput label="Questões" min={0} value={total} onChange={setTotal} />
          <NumberInput label="Acertos" min={0} value={correct} onChange={setCorrect} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Select label="Como foi?" value={quality ?? ''} onChange={(e) => setQuality(e.target.value ? Number(e.target.value) : null)}>
            <option value="">—</option>
            {QUALITY.map((q) => (
              <option key={q.value} value={q.value}>
                {q.emoji} {q.label}
              </option>
            ))}
          </Select>
          <Select label="Dificuldade" value={difficulty ?? ''} onChange={(e) => setDifficulty(e.target.value ? Number(e.target.value) : null)}>
            <option value="">—</option>
            {DIFFICULTY.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </Select>
        </div>
        <Textarea label="Observações" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Modal>
  );
}

export default function StudiesPage() {
  const { data, isLoading, error } = useStudies({ limit: 200 });
  const openStudy = useStudyDialog();
  const invalidate = useInvalidateStudyData();
  const toast = useToast();
  const [editing, setEditing] = useState<Study | null>(null);
  const [deleting, setDeleting] = useState<Study | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/studies/${id}`),
    onSuccess: async () => {
      await invalidate();
      toast.success('Registro excluído.');
      setDeleting(null);
    },
    onError: toast.error,
  });

  const byDay = (data ?? []).reduce<Record<string, Study[]>>((acc, s) => ((acc[s.date] ??= []).push(s), acc), {});

  return (
    <div>
      <PageHeader
        title="Estudos"
        subtitle="Histórico de sessões. Editar ou excluir um registro recalcula as revisões do assunto."
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => openStudy()}>
            Registrar estudo
          </Button>
        }
      />
      {isLoading && <Loading />}
      {error && <ErrorState error={error} />}
      {data && data.length === 0 && (
        <EmptyState icon="📚" title="Nenhum estudo registrado" action={<Button onClick={() => openStudy()}>Registrar o primeiro</Button>}>
          Cada registro alimenta suas métricas e o algoritmo de revisão.
        </EmptyState>
      )}
      <div className="space-y-5">
        {Object.entries(byDay).map(([day, list]) => (
          <section key={day}>
            <h2 className="mb-2 text-sm font-semibold first-letter:uppercase text-ink2">
              {fmtLong(day)} · {duration(list.reduce((s, x) => s + x.durationMinutes, 0))}
            </h2>
            <ul className="card divide-y divide-line">
              {list.map((s) => (
                <li key={s.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <Link to={`/assuntos/${s.subject.id}`} className="font-medium text-ink hover:underline">
                      {s.subject.name}
                    </Link>
                    {s.isFirstContact && <span className="ml-2 rounded-md bg-accent-wash px-1.5 py-0.5 text-[11px] font-semibold text-ink">D0</span>}
                    <p className="flex items-center gap-1.5 text-xs text-ink2">
                      <AreaDot color={s.subject.area?.color} /> {s.subject.area?.path}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {s.methods.map((m) => METHOD_LABEL[m]).join(' + ')} · {duration(s.durationMinutes)}
                      {s.quality && ` · ${QUALITY.find((q) => q.value === s.quality)?.emoji}`}
                    </p>
                  </div>
                  {s.questions && (
                    <span className="num shrink-0 rounded-lg bg-subtle px-2 py-1 text-sm text-ink">
                      {s.questions.correct}/{s.questions.total} = <strong>{pct(s.questions.accuracy)}</strong>
                    </span>
                  )}
                  <div className="flex shrink-0">
                    <IconButton label="Editar" onClick={() => setEditing(s)}>
                      <Pencil className="h-4 w-4" />
                    </IconButton>
                    <IconButton label="Excluir" onClick={() => setDeleting(s)}>
                      <Trash2 className="h-4 w-4" />
                    </IconButton>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {editing && <EditStudyDialog study={editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        title="Excluir registro?"
        message={`O registro de ${deleting?.subject.name} será excluído e as revisões do assunto serão recalculadas a partir do histórico restante.`}
        confirmLabel="Excluir"
        danger
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
