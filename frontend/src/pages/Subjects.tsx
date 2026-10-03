import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Archive, ChevronDown, FolderPlus, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { api, ApiError } from '../api/client';
import type { AreaNode, Subject } from '../api/types';
import { useAreas, useSubjects } from '../hooks/api';
import { CATEGORICAL } from '../lib/palette';
import { fmtShort, pct, relativeDay } from '../lib/format';
import { ActionMenu, AreaDot, Button, EmptyState, ErrorState, IconButton, Input, Loading, Modal, PageHeader, Select, cx, useToast } from '../components/ui';
import { AreaOptions, normalize } from '../components/study/SubjectPicker';
import { DeleteSubjectDialog, SubjectDialog, useInvalidateTaxonomy } from '../components/study/SubjectDialog';

function AreaDialog({ area, parentId, areas, onClose }: { area?: AreaNode; parentId?: string | null; areas: AreaNode[]; onClose: () => void }) {
  const invalidate = useInvalidateTaxonomy();
  const toast = useToast();
  const [name, setName] = useState(area?.name ?? '');
  const [parent, setParent] = useState<string>(area ? (area.parentId ?? '') : (parentId ?? ''));
  const [color, setColor] = useState<string | null>(area?.color ?? CATEGORICAL[areas.length % CATEGORICAL.length]);
  const isTop = !parent;
  const save = useMutation({
    mutationFn: () => {
      const body = { name, parentId: parent || null, color: isTop ? color : null };
      return area ? api.patch(`/areas/${area.id}`, body) : api.post('/areas', body);
    },
    onSuccess: async () => {
      await invalidate();
      toast.success(area ? 'Área atualizada.' : 'Área criada.');
      onClose();
    },
    onError: toast.error,
  });
  const hasChildren = !!area?.children?.length;
  return (
    <Modal
      open
      onClose={onClose}
      title={area ? 'Editar área' : parent ? 'Nova subárea' : 'Nova área'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="Nome" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Ex.: Cirurgia do Aparelho Digestivo" />
        <Select label="Dentro de" value={parent} disabled={hasChildren} onChange={(e) => setParent(e.target.value)} hint={hasChildren ? 'Áreas com subáreas ficam no nível principal.' : undefined}>
          <option value="">— Nível principal (área) —</option>
          {areas
            .filter((a) => a.id !== area?.id)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </Select>
        {isTop && (
          <div>
            <span className="label">Cor</span>
            <div className="flex flex-wrap gap-2">
              {CATEGORICAL.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Cor ${c}`}
                  aria-pressed={color === c}
                  onClick={() => setColor(c)}
                  className={cx('h-7 w-7 rounded-full border-2', color === c ? 'border-ink' : 'border-transparent')}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function DeleteAreaDialog({ area, areas, onClose }: { area: AreaNode; areas: AreaNode[]; onClose: () => void }) {
  const invalidate = useInvalidateTaxonomy();
  const toast = useToast();
  const [conflict, setConflict] = useState<{ subjects: number; subareas: number } | null>(null);
  const [moveTo, setMoveTo] = useState('');
  const del = useMutation({
    mutationFn: (opts: { moveTo?: string; force?: boolean }) =>
      api.del(`/areas/${area.id}`, { moveTo: opts.moveTo, force: opts.force ? 'true' : undefined }),
    onSuccess: async () => {
      await invalidate();
      toast.success('Área excluída.');
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) setConflict(err.details as { subjects: number; subareas: number });
      else toast.error(err);
    },
  });
  const excluded = new Set([area.id, ...(area.children ?? []).map((c) => c.id)]);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Excluir "${area.name}"?`}
      footer={
        conflict ? (
          <>
            <Button variant="danger" loading={del.isPending} onClick={() => del.mutate({ force: true })}>
              Excluir tudo
            </Button>
            <Button disabled={!moveTo} loading={del.isPending} onClick={() => del.mutate({ moveTo })}>
              Mover e excluir
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button variant="danger" loading={del.isPending} onClick={() => del.mutate({})}>
              Excluir
            </Button>
          </>
        )
      }
    >
      {conflict ? (
        <div className="space-y-3 text-sm text-ink2">
          <p>
            Esta área tem {conflict.subjects} assunto(s){conflict.subareas ? ` e ${conflict.subareas} subárea(s)` : ''}. Mova os assuntos para outra área (o histórico é
            preservado) ou exclua tudo, incluindo estudos e revisões.
          </p>
          <Select label="Mover assuntos para" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
            <option value="">Escolha…</option>
            <AreaOptions areas={areas.filter((a) => !excluded.has(a.id)).map((a) => ({ ...a, children: a.children?.filter((c) => !excluded.has(c.id)) }))} />
          </Select>
        </div>
      ) : (
        <p className="text-sm text-ink2">A área será removida.</p>
      )}
    </Modal>
  );
}

function SubjectRow({ s, onEdit, onDelete, onArchive }: { s: Subject; onEdit: () => void; onDelete: () => void; onArchive: () => void }) {
  return (
    <li className={cx('flex items-center gap-3 px-3 py-2', s.archived && 'opacity-60')}>
      <Link to={`/assuntos/${s.id}`} className="min-w-0 flex-1 hover:underline">
        <span className="block truncate text-sm text-ink">
          {s.name} {s.archived && <span className="text-xs text-muted">(arquivado)</span>}
        </span>
        <span className="block truncate text-xs text-muted">
          {s.learning ? `${s.learning.contacts} contato(s)` : 'ainda não estudado'}
          {s.nextReview && ` · revisão ${relativeDay(s.nextReview.scheduledFor)} (${fmtShort(s.nextReview.scheduledFor)})`}
        </span>
      </Link>
      {s.questions.total > 0 && <span className="num shrink-0 text-xs text-ink2">{pct(s.questions.accuracy)}</span>}
      <ActionMenu
        label={`Ações de ${s.name}`}
        items={[
          { label: 'Editar / mover', icon: Pencil, onClick: onEdit },
          { label: s.archived ? 'Reativar' : 'Arquivar', icon: Archive, onClick: onArchive },
          { label: 'Excluir', icon: Trash2, onClick: onDelete, danger: true },
        ]}
      />
    </li>
  );
}

export default function SubjectsPage() {
  const areas = useAreas();
  const subjects = useSubjects();
  const invalidate = useInvalidateTaxonomy();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [areaDialog, setAreaDialog] = useState<{ area?: AreaNode; parentId?: string | null } | null>(null);
  const [subjectDialog, setSubjectDialog] = useState<{ subject?: Subject; areaId?: string } | null>(null);
  const [deleteArea, setDeleteArea] = useState<AreaNode | null>(null);
  const [deleteSubject, setDeleteSubject] = useState<Subject | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const archive = useMutation({
    mutationFn: (s: Subject) => api.patch(`/subjects/${s.id}`, { archived: !s.archived }),
    onSuccess: invalidate,
    onError: toast.error,
  });

  const bySubjectArea = useMemo(() => {
    const q = normalize(query.trim());
    const map = new Map<string, Subject[]>();
    for (const s of subjects.data ?? []) {
      if (!showArchived && s.archived) continue;
      if (q && !normalize(s.name).includes(q) && !s.tags.some((t) => normalize(t).includes(q))) continue;
      (map.get(s.areaId) ?? map.set(s.areaId, []).get(s.areaId)!).push(s);
    }
    return map;
  }, [subjects.data, query, showArchived]);

  if (areas.isLoading || subjects.isLoading) return <Loading />;
  if (areas.error) return <ErrorState error={areas.error} />;
  const tree = areas.data ?? [];
  const searching = query.trim().length > 0;

  const renderSubjects = (areaId: string) => {
    const list = bySubjectArea.get(areaId) ?? [];
    if (!list.length) return null;
    return (
      <ul className="divide-y divide-line">
        {list.map((s) => (
          <SubjectRow key={s.id} s={s} onEdit={() => setSubjectDialog({ subject: s })} onArchive={() => archive.mutate(s)} onDelete={() => setDeleteSubject(s)} />
        ))}
      </ul>
    );
  };

  return (
    <div>
      <PageHeader
        title="Áreas e assuntos"
        subtitle="Organize Área → Subárea → Assunto. Crie, renomeie, mova e arquive livremente."
        actions={
          <>
            <Button variant="secondary" icon={<FolderPlus className="h-4 w-4" />} onClick={() => setAreaDialog({})}>
              Nova área
            </Button>
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setSubjectDialog({})}>
              Novo assunto
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[14rem] max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder="Pesquisar assuntos ou tags" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Pesquisar assuntos" />
        </div>
        <label className="flex items-center gap-2 text-sm text-ink2">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Mostrar arquivados
        </label>
      </div>

      {tree.length === 0 && (
        <EmptyState icon="🗂️" title="Nenhuma área criada" action={<Button onClick={() => setAreaDialog({})}>Criar área</Button>}>
          Comece criando as grandes áreas do seu estudo.
        </EmptyState>
      )}

      <div className="space-y-3">
        {tree.map((area) => {
          const childIds = (area.children ?? []).map((c) => c.id);
          const count = [area.id, ...childIds].reduce((n, id) => n + (bySubjectArea.get(id)?.length ?? 0), 0);
          if (searching && count === 0) return null;
          const isOpen = searching || open[area.id];
          return (
            <section key={area.id} className="card overflow-hidden">
              <header className="flex items-center gap-3 px-4 py-3">
                <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setOpen((o) => ({ ...o, [area.id]: !o[area.id] }))} aria-expanded={!!isOpen}>
                  <AreaDot color={area.color} />
                  {/* No celular a contagem vai para baixo do nome (lado a lado, o nome sumia) */}
                  <span className="flex min-w-0 flex-col sm:flex-row sm:items-center sm:gap-3">
                    <span className="truncate font-semibold text-ink">{area.name}</span>
                    <span className="truncate text-xs text-muted sm:shrink-0">
                      {count} assunto(s) · {area.children?.length ?? 0} subárea(s)
                    </span>
                  </span>
                  <ChevronDown className={cx('ml-auto h-4 w-4 shrink-0 text-muted transition', isOpen && 'rotate-180')} />
                </button>
                <div className="flex shrink-0">
                  <IconButton label="Nova subárea" onClick={() => setAreaDialog({ parentId: area.id })}>
                    <FolderPlus className="h-4 w-4" />
                  </IconButton>
                  <IconButton label="Editar área" onClick={() => setAreaDialog({ area })}>
                    <Pencil className="h-4 w-4" />
                  </IconButton>
                  <IconButton label="Excluir área" onClick={() => setDeleteArea(area)}>
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </div>
              </header>
              {isOpen && (
                <div className="border-t border-line">
                  {renderSubjects(area.id)}
                  {(area.children ?? []).map((sub) => {
                    const list = bySubjectArea.get(sub.id) ?? [];
                    if (searching && !list.length) return null;
                    return (
                      <div key={sub.id} className="border-t border-line first:border-t-0">
                        <div className="flex items-center gap-2 bg-subtle px-4 py-2">
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">↳ {sub.name}</span>
                          <span className="text-xs text-muted">{list.length}</span>
                          <IconButton label={`Novo assunto em ${sub.name}`} onClick={() => setSubjectDialog({ areaId: sub.id })}>
                            <Plus className="h-4 w-4" />
                          </IconButton>
                          <IconButton label={`Editar ${sub.name}`} onClick={() => setAreaDialog({ area: sub })}>
                            <Pencil className="h-3.5 w-3.5" />
                          </IconButton>
                          <IconButton label={`Excluir ${sub.name}`} onClick={() => setDeleteArea(sub)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </IconButton>
                        </div>
                        <div className="pl-4">{renderSubjects(sub.id)}</div>
                      </div>
                    );
                  })}
                  <button className="flex w-full items-center gap-2 border-t border-line px-4 py-2 text-sm font-medium text-accent hover:bg-subtle" onClick={() => setSubjectDialog({ areaId: area.id })}>
                    <Plus className="h-4 w-4" /> Novo assunto em {area.name}
                  </button>
                </div>
              )}
            </section>
          );
        })}
      </div>

      {areaDialog && <AreaDialog area={areaDialog.area} parentId={areaDialog.parentId} areas={tree} onClose={() => setAreaDialog(null)} />}
      {subjectDialog && <SubjectDialog subject={subjectDialog.subject} areaId={subjectDialog.areaId} areas={tree} onClose={() => setSubjectDialog(null)} />}
      {deleteArea && <DeleteAreaDialog area={deleteArea} areas={tree} onClose={() => setDeleteArea(null)} />}
      {deleteSubject && <DeleteSubjectDialog subject={deleteSubject} onClose={() => setDeleteSubject(null)} />}
    </div>
  );
}
