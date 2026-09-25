import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import type { Board, Exam } from '../api/types';
import { useBoards } from '../hooks/api';
import { levelForPercent } from '../lib/constants';
import { duration, fmtShort, pct, todayLocal } from '../lib/format';
import { Button, ConfirmDialog, EmptyState, ErrorState, IconButton, Input, LevelBadge, Loading, Modal, NumberInput, PageHeader, Textarea, cx, useToast } from '../components/ui';

function useInvalidate() {
  const qc = useQueryClient();
  return () => Promise.all(['boards', 'metrics', 'dashboard', 'goals', 'progress'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

function BoardDialog({ board, onClose }: { board?: Board; onClose: () => void }) {
  const invalidate = useInvalidate();
  const toast = useToast();
  const [name, setName] = useState(board?.name ?? '');
  const save = useMutation({
    mutationFn: () => (board ? api.patch(`/exams/boards/${board.id}`, { name }) : api.post('/exams/boards', { name })),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
    onError: toast.error,
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={board ? 'Renomear banca' : 'Nova banca'}
      footer={
        <Button loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>
          Salvar
        </Button>
      }
    >
      <Input label="Nome da banca" placeholder="Ex.: SES-DF" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
    </Modal>
  );
}

function ExamDialog({ boardId, exam, onClose }: { boardId: string; exam?: Exam; onClose: () => void }) {
  const invalidate = useInvalidate();
  const toast = useToast();
  const [f, setF] = useState({
    name: exam?.name ?? '',
    year: exam?.year ?? (new Date().getFullYear() as number | null),
    totalQuestions: exam?.totalQuestions ?? (100 as number | null),
    fileUrl: exam?.fileUrl ?? '',
    notes: exam?.notes ?? '',
  });
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, boardId, fileUrl: f.fileUrl || null, notes: f.notes || null };
      return exam ? api.patch(`/exams/${exam.id}`, body) : api.post('/exams', body);
    },
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
    onError: toast.error,
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={exam ? 'Editar prova' : 'Nova prova'}
      footer={
        <Button loading={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate()}>
          Salvar
        </Button>
      }
    >
      <div className="space-y-4">
        <Input label="Nome" placeholder="Ex.: ENAMED 2025" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={120} />
        <div className="grid grid-cols-2 gap-3">
          <NumberInput label="Ano" min={1990} max={2100} value={f.year} onChange={(year) => setF({ ...f, year })} />
          <NumberInput label="Questões" min={1} value={f.totalQuestions} onChange={(totalQuestions) => setF({ ...f, totalQuestions })} />
        </div>
        <Input
          label="Link do arquivo (opcional)"
          type="url"
          placeholder="https://…"
          value={f.fileUrl}
          onChange={(e) => setF({ ...f, fileUrl: e.target.value })}
          hint="Use links para arquivos que você tem permissão de acessar e compartilhar (ex.: provas públicas das bancas)."
        />
        <Textarea label="Observações" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </div>
    </Modal>
  );
}

function AttemptDialog({ exam, onClose }: { exam: Exam; onClose: () => void }) {
  const invalidate = useInvalidate();
  const toast = useToast();
  const today = todayLocal();
  const [f, setF] = useState({ takenOn: today, totalQuestions: exam.totalQuestions ?? (null as number | null), correct: null as number | null, durationMinutes: null as number | null, notes: '' });
  const invalid = !f.totalQuestions || f.correct === null || f.correct > f.totalQuestions;
  const save = useMutation({
    mutationFn: () => api.post(`/exams/${exam.id}/attempts`, { ...f, notes: f.notes || null }),
    onSuccess: async () => {
      await invalidate();
      toast.success('Resultado registrado.');
      onClose();
    },
    onError: toast.error,
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Resultado — ${exam.name}`}
      footer={
        <Button loading={save.isPending} disabled={invalid} onClick={() => save.mutate()}>
          Salvar
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Data" type="date" max={today} value={f.takenOn} onChange={(e) => setF({ ...f, takenOn: e.target.value })} />
        <NumberInput label="Tempo (min)" min={0} value={f.durationMinutes} onChange={(durationMinutes) => setF({ ...f, durationMinutes })} />
        <NumberInput label="Questões" min={1} value={f.totalQuestions} onChange={(totalQuestions) => setF({ ...f, totalQuestions })} />
        <NumberInput
          label="Acertos"
          min={0}
          value={f.correct}
          onChange={(correct) => setF({ ...f, correct })}
          hint={f.correct !== null && f.totalQuestions ? `${pct((f.correct / f.totalQuestions) * 100, 1)} de acertos` : undefined}
        />
        <div className="sm:col-span-2">
          <Textarea label="Observações" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </div>
      </div>
    </Modal>
  );
}

export default function ExamsPage() {
  const { data, isLoading, error } = useBoards();
  const invalidate = useInvalidate();
  const toast = useToast();
  const [selected, setSelected] = useState<string | null>(null);
  const [boardDialog, setBoardDialog] = useState<{ board?: Board } | null>(null);
  const [examDialog, setExamDialog] = useState<{ exam?: Exam } | null>(null);
  const [attemptFor, setAttemptFor] = useState<Exam | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; message: string; run: () => Promise<unknown> } | null>(null);
  const [busy, setBusy] = useState(false);

  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorState error={error} />;
  const board = data.find((b) => b.id === selected) ?? data.find((b) => b.exams.length) ?? data[0];

  const runConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      await confirm.run();
      await invalidate();
      setConfirm(null);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Banco de provas"
        subtitle="Organize provas anteriores por banca e registre seus resultados."
        actions={
          <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setBoardDialog({})}>
            Nova banca
          </Button>
        }
      />
      {data.length === 0 ? (
        <EmptyState icon="🏛️" title="Nenhuma banca cadastrada" action={<Button onClick={() => setBoardDialog({})}>Criar banca</Button>} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
          <nav className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible" aria-label="Bancas">
            {data.map((b) => (
              <button
                key={b.id}
                onClick={() => setSelected(b.id)}
                className={cx(
                  'flex shrink-0 items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm',
                  board?.id === b.id ? 'bg-accent-wash font-medium text-ink' : 'text-ink2 hover:bg-subtle',
                )}
              >
                {b.name}
                <span className="text-xs text-muted">{b.exams.length}</span>
              </button>
            ))}
          </nav>
          {board && (
            <section className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-ink">{board.name}</h2>
                <div className="flex items-center gap-1">
                  <IconButton label="Renomear banca" onClick={() => setBoardDialog({ board })}>
                    <Pencil className="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    label="Excluir banca"
                    onClick={() => setConfirm({ title: `Excluir ${board.name}?`, message: 'Todas as provas e resultados desta banca serão excluídos.', run: () => api.del(`/exams/boards/${board.id}`) })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                  <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setExamDialog({})}>
                    Nova prova
                  </Button>
                </div>
              </div>
              {board.exams.length === 0 && <EmptyState icon="📄" title={`Nenhuma prova de ${board.name}`}>Adicione, por exemplo, “{board.name} 2025”.</EmptyState>}
              {board.exams.map((exam) => (
                <article key={exam.id} className="card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-ink">{exam.name}</p>
                      <p className="text-xs text-muted">
                        {[exam.year, exam.totalQuestions && `${exam.totalQuestions} questões`].filter(Boolean).join(' · ')}
                        {exam.fileUrl && (
                          <a href={exam.fileUrl} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex items-center gap-0.5 text-accent">
                            arquivo <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      {exam.bestAccuracy !== null && (
                        <span className="mr-2 text-xs text-ink2">
                          melhor: <strong className="num text-ink">{pct(exam.bestAccuracy, 1)}</strong>
                        </span>
                      )}
                      <IconButton label="Editar prova" onClick={() => setExamDialog({ exam })}>
                        <Pencil className="h-4 w-4" />
                      </IconButton>
                      <IconButton label="Excluir prova" onClick={() => setConfirm({ title: `Excluir ${exam.name}?`, message: 'Os resultados registrados também serão excluídos.', run: () => api.del(`/exams/${exam.id}`) })}>
                        <Trash2 className="h-4 w-4" />
                      </IconButton>
                      <Button size="sm" variant="secondary" onClick={() => setAttemptFor(exam)}>
                        Registrar resultado
                      </Button>
                    </div>
                  </div>
                  {exam.notes && <p className="mt-2 text-sm text-ink2">{exam.notes}</p>}
                  {exam.attempts.length > 0 && (
                    <ul className="mt-3 divide-y divide-line border-t border-line text-sm">
                      {exam.attempts.map((a) => (
                        <li key={a.id} className="num flex flex-wrap items-center justify-between gap-2 py-2">
                          <span className="text-ink2">
                            {fmtShort(a.takenOn)}
                            {a.durationMinutes ? ` · ${duration(a.durationMinutes)}` : ''}
                          </span>
                          <span className="flex items-center gap-2 text-ink">
                            {a.totalQuestions !== null && `${a.correct}/${a.totalQuestions} · `}
                            <strong>{pct(a.accuracy, 1)}</strong>
                            <LevelBadge level={levelForPercent(a.accuracy)} compact />
                            <IconButton label="Excluir resultado" onClick={() => setConfirm({ title: 'Excluir resultado?', message: `Resultado de ${fmtShort(a.takenOn)}.`, run: () => api.del(`/exams/attempts/${a.id}`) })}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </IconButton>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              ))}
              <p className="text-xs text-muted">Upload de PDFs próprio fica para uma próxima versão — por enquanto, guarde o link do arquivo, respeitando direitos autorais e permissões de uso.</p>
            </section>
          )}
        </div>
      )}
      {boardDialog && <BoardDialog board={boardDialog.board} onClose={() => setBoardDialog(null)} />}
      {examDialog && board && <ExamDialog boardId={board.id} exam={examDialog.exam} onClose={() => setExamDialog(null)} />}
      {attemptFor && <AttemptDialog exam={attemptFor} onClose={() => setAttemptFor(null)} />}
      <ConfirmDialog open={!!confirm} title={confirm?.title ?? ''} message={confirm?.message} confirmLabel="Excluir" danger loading={busy} onConfirm={runConfirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
