import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CalendarClock, Pencil, Plus, Trash2, X } from 'lucide-react';
import { api } from '../api/client';
import type { MockExam } from '../api/types';
import { useAreas, useInvalidateStudyData, useMockExams } from '../hooks/api';
import { levelForPercent } from '../lib/constants';
import { duration, fmtShort, pct, relativeDay, todayLocal } from '../lib/format';
import { Button, ConfirmDialog, EmptyState, ErrorState, IconButton, Input, LevelBadge, Loading, Modal, NumberInput, PageHeader, Segmented, Select, StatTile, Textarea, useToast } from '../components/ui';
import { ChartCard, TrendLine } from '../components/charts';
import { AreaOptions } from '../components/study/SubjectPicker';

function MockDialog({ mock, onClose }: { mock?: MockExam; onClose: () => void }) {
  const invalidate = useInvalidateStudyData();
  const toast = useToast();
  const { data: areas = [] } = useAreas();
  const today = todayLocal();
  const [f, setF] = useState({
    name: mock?.name ?? '',
    board: mock?.board ?? '',
    examName: mock?.examName ?? '',
    year: mock?.year ?? (null as number | null),
    takenOn: mock?.takenOn ?? today,
    status: mock?.status ?? ('DONE' as 'DONE' | 'PLANNED'),
    totalQuestions: mock?.totalQuestions ?? (100 as number | null),
    correct: mock?.correct ?? (null as number | null),
    durationMinutes: mock?.durationMinutes ?? (null as number | null),
    notes: mock?.notes ?? '',
  });
  const [areaRows, setAreaRows] = useState(mock?.areaResults.map((r) => ({ areaId: r.areaId, total: r.total as number | null, correct: r.correct as number | null })) ?? []);
  const done = f.status === 'DONE';
  const invalid = done && (!f.totalQuestions || f.correct === null || f.correct > f.totalQuestions || f.takenOn > today);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        board: f.board || null,
        examName: f.examName || null,
        notes: f.notes || null,
        correct: done ? f.correct : null,
        areaResults: areaRows.filter((r) => r.areaId && r.total && r.correct !== null).map((r) => ({ areaId: r.areaId, total: r.total!, correct: r.correct! })),
      };
      return mock ? api.patch(`/mock-exams/${mock.id}`, body) : api.post('/mock-exams', body);
    },
    onSuccess: async () => {
      await invalidate();
      toast.success(mock ? 'Simulado atualizado.' : done ? 'Simulado registrado.' : 'Simulado agendado.');
      onClose();
    },
    onError: toast.error,
  });
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={mock ? 'Editar simulado' : 'Novo simulado'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} disabled={!f.name.trim() || invalid} onClick={() => save.mutate()}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented
          value={f.status}
          onChange={(status) => setF({ ...f, status })}
          options={[
            { value: 'DONE', label: 'Já realizei' },
            { value: 'PLANNED', label: 'Agendar' },
          ]}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Nome" placeholder="Ex.: ENAMED 2025" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={120} />
          <Input label="Banca" placeholder="Ex.: ENAMED" value={f.board} onChange={(e) => setF({ ...f, board: e.target.value })} maxLength={80} />
          <Input label="Prova" placeholder="Ex.: Simulado nacional 1" value={f.examName} onChange={(e) => setF({ ...f, examName: e.target.value })} maxLength={120} />
          <NumberInput label="Ano" min={1990} max={2100} value={f.year} onChange={(year) => setF({ ...f, year })} />
          <Input label={done ? 'Data realizada' : 'Data agendada'} type="date" max={done ? today : undefined} value={f.takenOn} onChange={(e) => setF({ ...f, takenOn: e.target.value })} />
          <NumberInput label="Número de questões" min={1} value={f.totalQuestions} onChange={(totalQuestions) => setF({ ...f, totalQuestions })} />
          {done && (
            <>
              <NumberInput
                label="Acertos"
                min={0}
                value={f.correct}
                onChange={(correct) => setF({ ...f, correct })}
                error={f.correct !== null && f.totalQuestions !== null && f.correct > f.totalQuestions ? 'Maior que o total' : undefined}
                hint={f.correct !== null && f.totalQuestions ? `${pct((f.correct / f.totalQuestions) * 100, 1)} de acertos` : undefined}
              />
              <NumberInput label="Tempo gasto (min)" min={0} value={f.durationMinutes} onChange={(durationMinutes) => setF({ ...f, durationMinutes })} />
            </>
          )}
        </div>
        {done && (
          <div className="rounded-2xl border border-line p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium text-ink">Resultado por área (opcional)</p>
              <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAreaRows([...areaRows, { areaId: '', total: null, correct: null }])}>
                Área
              </Button>
            </div>
            {areaRows.length === 0 && <p className="text-xs text-muted">Ex.: Cirurgia 18/20, Pediatria 15/20. Entra nas métricas por área.</p>}
            <div className="space-y-2">
              {areaRows.map((r, i) => (
                <div key={i} className="grid grid-cols-[1fr_80px_80px_36px] items-end gap-2">
                  <Select value={r.areaId} onChange={(e) => setAreaRows(areaRows.map((x, j) => (j === i ? { ...x, areaId: e.target.value } : x)))} aria-label="Área">
                    <option value="">Área…</option>
                    <AreaOptions areas={areas} />
                  </Select>
                  <NumberInput placeholder="Total" aria-label="Total" min={1} value={r.total} onChange={(v) => setAreaRows(areaRows.map((x, j) => (j === i ? { ...x, total: v } : x)))} />
                  <NumberInput placeholder="Acertos" aria-label="Acertos" min={0} value={r.correct} onChange={(v) => setAreaRows(areaRows.map((x, j) => (j === i ? { ...x, correct: v } : x)))} />
                  <IconButton label="Remover" onClick={() => setAreaRows(areaRows.filter((_, j) => j !== i))}>
                    <X className="h-4 w-4" />
                  </IconButton>
                </div>
              ))}
            </div>
          </div>
        )}
        <Textarea label="Observações" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </div>
    </Modal>
  );
}

export default function MockExamsPage() {
  const { data, isLoading, error } = useMockExams();
  const invalidate = useInvalidateStudyData();
  const toast = useToast();
  const [dialog, setDialog] = useState<{ mock?: MockExam } | null>(null);
  const [deleting, setDeleting] = useState<MockExam | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/mock-exams/${id}`),
    onSuccess: async () => {
      await invalidate();
      setDeleting(null);
    },
    onError: toast.error,
  });

  // Séries de evolução por banca (até 5; o restante entra em "Outros")
  const chart = useMemo(() => {
    if (!data) return { rows: [], series: [] as { key: string; name: string }[] };
    const series = data.series.slice(0, 5).map((s, i) => ({ key: `s${i}`, name: s.key }));
    const keyOf = new Map(data.series.slice(0, 5).map((s, i) => [s.key, `s${i}`]));
    const rows = data.evolution.map((e) => {
      const k = keyOf.get(e.board || e.name);
      return { date: e.date, label: e.name, ...(k ? { [k]: e.accuracy } : { outros: e.accuracy }) };
    });
    if (data.series.length > 5) series.push({ key: 'outros', name: 'Outros' });
    return { rows, series };
  }, [data]);

  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorState error={error} />;
  const planned = data.items.filter((m) => m.status === 'PLANNED');
  const done = data.items.filter((m) => m.status === 'DONE');

  return (
    <div className="space-y-5">
      <PageHeader
        title="Simulados"
        subtitle="Registre simulados completos e acompanhe a evolução ao longo do tempo."
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setDialog({})}>
            Novo simulado
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Realizados" value={data.stats.done} />
        <StatTile label="Média de acertos" value={pct(data.stats.avgAccuracy, 1)} />
        <StatTile label="Melhor resultado" value={pct(data.stats.best, 1)} />
        <StatTile label="Último" value={pct(data.stats.last, 1)} tone={data.stats.last !== null ? levelForPercent(data.stats.last) : undefined} />
      </div>

      {chart.rows.length > 1 && (
        <ChartCard
          title="Evolução nos simulados"
          subtitle={chart.series.length > 1 ? 'Percentual de acertos por banca' : 'Percentual de acertos'}
          table={{ columns: ['Data', 'Simulado', 'Acertos'], rows: data.evolution.map((e) => [fmtShort(e.date), e.name, pct(e.accuracy, 1)]) }}
        >
          <TrendLine data={chart.rows} xKey="date" series={chart.series} formatter={(v) => `${Math.round(v)}%`} xFormatter={fmtShort} yDomain={[0, 100]} legend />
        </ChartCard>
      )}

      {planned.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink2">Agendados</h2>
          <ul className="card divide-y divide-line">
            {planned.map((m) => (
              <li key={m.id} className="flex items-center gap-3 p-3">
                <CalendarClock className="h-5 w-5 shrink-0 text-accent" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{m.name}</p>
                  <p className="text-xs text-muted">
                    {fmtShort(m.takenOn)} ({relativeDay(m.takenOn)}){m.totalQuestions ? ` · ${m.totalQuestions} questões` : ''}
                  </p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setDialog({ mock: { ...m, status: 'DONE' } })}>
                  Registrar resultado
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink2">Realizados</h2>
        {done.length === 0 ? (
          <EmptyState icon="🏁" title="Nenhum simulado registrado" action={<Button onClick={() => setDialog({})}>Registrar simulado</Button>} />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {done.map((m) => (
              <li key={m.id} className="card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{m.name}</p>
                    <p className="text-xs text-muted">
                      {[m.board, m.examName, m.year].filter(Boolean).join(' · ')} · {fmtShort(m.takenOn)}
                      {m.durationMinutes ? ` · ${duration(m.durationMinutes)}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0">
                    <IconButton label="Editar" onClick={() => setDialog({ mock: m })}>
                      <Pencil className="h-4 w-4" />
                    </IconButton>
                    <IconButton label="Excluir" onClick={() => setDeleting(m)}>
                      <Trash2 className="h-4 w-4" />
                    </IconButton>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <p className="num text-sm text-ink2">
                    {m.totalQuestions} questões · {m.correct} acertos
                  </p>
                  <div className="flex items-center gap-2">
                    <LevelBadge level={levelForPercent(m.accuracy)} compact />
                    <span className="num text-xl font-semibold text-ink">{pct(m.accuracy, 1)}</span>
                  </div>
                </div>
                {m.areaResults.length > 0 && (
                  <ul className="mt-3 space-y-1 border-t border-line pt-2 text-xs">
                    {m.areaResults.map((r) => (
                      <li key={r.areaId} className="num flex justify-between text-ink2">
                        <span>{r.areaName}</span>
                        <span className="text-ink">
                          {r.correct}/{r.total} · {pct(r.accuracy)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {m.notes && <p className="mt-2 text-xs text-ink2">{m.notes}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
      {dialog && <MockDialog mock={dialog.mock} onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={!!deleting}
        title="Excluir simulado?"
        message={`"${deleting?.name}" será excluído.`}
        confirmLabel="Excluir"
        danger
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
