import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { AreaNode, Subject, SubjectSize } from '../../api/types';
import { SIZES } from '../../lib/constants';
import { Button, ConfirmDialog, Input, Modal, Segmented, Select, Textarea, useToast } from '../ui';
import { AreaOptions } from './SubjectPicker';

// Criar, editar e excluir um assunto (Áreas e assuntos, e o menu ⋯ dos assuntos do cronograma).

export function useInvalidateTaxonomy() {
  const qc = useQueryClient();
  return () =>
    Promise.all(['areas', 'subjects', 'subject', 'reviews', 'dashboard', 'metrics', 'plans', 'studies'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

export function SubjectDialog({ subject, areaId, areas, onClose }: { subject?: Subject; areaId?: string; areas: AreaNode[]; onClose: () => void }) {
  const invalidate = useInvalidateTaxonomy();
  const toast = useToast();
  const [form, setForm] = useState({
    name: subject?.name ?? '',
    areaId: subject?.areaId ?? areaId ?? '',
    size: (subject?.size ?? 'MEDIUM') as SubjectSize,
    notes: subject?.notes ?? '',
    tags: subject?.tags.join(', ') ?? '',
  });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name,
        areaId: form.areaId,
        size: form.size,
        notes: form.notes || null,
        tags: form.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      };
      return subject ? api.patch(`/subjects/${subject.id}`, body) : api.post('/subjects', body);
    },
    onSuccess: async () => {
      await invalidate();
      toast.success(subject ? 'Assunto atualizado.' : 'Assunto criado.');
      onClose();
    },
    onError: toast.error,
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={subject ? 'Editar assunto' : 'Novo assunto'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} disabled={!form.name.trim() || !form.areaId} onClick={() => save.mutate()}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="Assunto" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} placeholder="Ex.: Pancreatite aguda" />
        <Select label="Área / subárea" value={form.areaId} onChange={(e) => setForm({ ...form, areaId: e.target.value })} hint={subject ? 'Mudar a área move o assunto com todo o histórico.' : undefined}>
          <option value="">Escolha…</option>
          <AreaOptions areas={areas} />
        </Select>
        <div>
          <span className="label">Tamanho</span>
          <Segmented size="sm" value={form.size} onChange={(size) => setForm({ ...form, size })} options={SIZES.map((s) => ({ value: s.value, label: `${s.label} (${s.hint})` }))} />
        </div>
        <Input label="Tags (separadas por vírgula)" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="alta incidência, urgência" />
        <Textarea label="Anotações" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </div>
    </Modal>
  );
}

/** Excluir o assunto com todo o histórico (pede confirmação). */
export function DeleteSubjectDialog({ subject, onClose, onDeleted }: { subject: Pick<Subject, 'id' | 'name'>; onClose: () => void; onDeleted?: () => void }) {
  const invalidate = useInvalidateTaxonomy();
  const toast = useToast();
  const remove = useMutation({
    mutationFn: () => api.del(`/subjects/${subject.id}`),
    onSuccess: async () => {
      await invalidate();
      toast.success('Assunto excluído.');
      onClose();
      onDeleted?.();
    },
    onError: toast.error,
  });
  return (
    <ConfirmDialog
      open
      title={`Excluir "${subject.name}"?`}
      message="Todo o histórico de estudos, questões e revisões deste assunto será apagado, e ele sai de todos os cronogramas. Se quiser apenas tirá-lo do calendário, use Arquivar (em Áreas e assuntos)."
      confirmLabel="Excluir"
      danger
      loading={remove.isPending}
      onConfirm={() => remove.mutate()}
      onClose={onClose}
    />
  );
}
