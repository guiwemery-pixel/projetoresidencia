import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { SlidersHorizontal } from 'lucide-react';
import { api } from '../../api/client';
import type { User } from '../../api/types';
import { useInvalidateStudyData } from '../../hooks/api';
import { useAuth } from '../../hooks/useAuth';
import { Button, Modal, NumberInput, Segmented, cx, useToast } from '../ui';

// Limite de revisões (assuntos) por dia, ajustável onde as revisões aparecem
// (Revisões e Calendário) — o mesmo campo do Perfil. Ver balance.service.ts no backend.

const QUICK = [3, 5, 7, 10, 0] as const;
const label = (n: number) => (n ? `Até ${n} revisões por dia` : 'Sem limite de revisões por dia');

export function ReviewLimitButton({ className }: { className?: string }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  const n = user.dailyReviewLimit;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cx('inline-flex items-center gap-1.5 text-xs text-ink2 hover:text-ink', className)}
        title="Quantos assuntos podem ser revisados por dia"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        {label(n)} · <span className="font-medium text-accent">Alterar</span>
      </button>
      {open && <ReviewLimitDialog current={n} onClose={() => setOpen(false)} />}
    </>
  );
}

function ReviewLimitDialog({ current, onClose }: { current: number; onClose: () => void }) {
  const { setUser } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidateStudyData();
  const [value, setValue] = useState<number | null>(current);
  const quick = QUICK.includes(value as (typeof QUICK)[number]) ? String(value) : 'outro';
  const save = useMutation({
    mutationFn: (dailyReviewLimit: number) => api.patch<{ user: User }>('/me', { dailyReviewLimit }),
    onSuccess: async ({ user }) => {
      setUser(user);
      // O servidor já remanejou as revisões para o novo limite
      await invalidate();
      toast.success(`${label(user.dailyReviewLimit)}. O calendário foi reorganizado.`);
      onClose();
    },
    onError: toast.error,
  });
  const valid = value !== null && Number.isInteger(value) && value >= 0 && value <= 50;
  return (
    <Modal
      open
      onClose={onClose}
      title="Revisões por dia"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} disabled={!valid || value === current} onClick={() => valid && save.mutate(value!)}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm text-ink2">
        <p>
          Quantos <strong className="text-ink">assuntos</strong> você quer revisar no máximo por dia. Se um dia passar disso, as revisões que chegaram por último
          vão para o dia anterior ou o seguinte — e voltam para a data calculada quando abrir vaga. As que você remarcou à mão ficam onde estão.
        </p>
        <Segmented
          ariaLabel="Limite por dia"
          value={quick}
          onChange={(v) => setValue(v === 'outro' ? (value && !QUICK.includes(value as (typeof QUICK)[number]) ? value : 4) : Number(v))}
          options={[...QUICK.map((q) => ({ value: String(q), label: q ? String(q) : 'Sem limite' })), { value: 'outro', label: 'Outro' }]}
        />
        {quick === 'outro' && <NumberInput label="Máximo por dia" min={1} max={50} value={value} onChange={setValue} hint="De 1 a 50 assuntos." />}
        <p className="text-xs text-muted">Também fica em Perfil › Revisões por dia.</p>
      </div>
    </Modal>
  );
}
