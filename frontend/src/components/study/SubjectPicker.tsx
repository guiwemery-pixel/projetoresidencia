import { useMemo, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import type { AreaNode, Subject, SubjectSize } from '../../api/types';
import { useAreas, useSubjects } from '../../hooks/api';
import { SIZES } from '../../lib/constants';
import { AreaDot, Button, Input, Segmented, Select, cx } from '../ui';

export const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export interface NewSubject {
  areaId: string;
  name: string;
  size: SubjectSize;
}

export type SubjectChoice = { kind: 'existing'; subject: Subject } | { kind: 'new'; data: NewSubject } | null;

/** Opções <option> de áreas com subáreas indentadas. */
export function AreaOptions({ areas }: { areas: AreaNode[] }) {
  return (
    <>
      {areas.map((a) => (
        <optgroup key={a.id} label={a.name}>
          <option value={a.id}>{a.name} (geral)</option>
          {a.children?.map((c) => (
            <option key={c.id} value={c.id}>
              {a.name} › {c.name}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

export function SubjectPicker({ value, onChange }: { value: SubjectChoice; onChange: (v: SubjectChoice) => void }) {
  const { data: subjects = [] } = useSubjects();
  const { data: areas = [] } = useAreas();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<NewSubject>({ areaId: '', name: '', size: 'MEDIUM' });

  const matches = useMemo(() => {
    const q = normalize(query.trim());
    const active = subjects.filter((s) => !s.archived);
    const list = q
      ? active.filter((s) => normalize(s.name).includes(q) || normalize(s.area?.path ?? '').includes(q))
      : [...active].sort((a, b) => (b.learning?.lastContactOn ?? '').localeCompare(a.learning?.lastContactOn ?? ''));
    return list.slice(0, 8);
  }, [subjects, query]);

  if (value?.kind === 'existing') {
    const s = value.subject;
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border border-line bg-subtle px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{s.name}</p>
          <p className="flex items-center gap-1.5 truncate text-xs text-ink2">
            <AreaDot color={s.area?.color} /> {s.area?.path}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
          Trocar
        </Button>
      </div>
    );
  }

  if (creating || value?.kind === 'new') {
    const d = value?.kind === 'new' ? value.data : draft;
    const update = (patch: Partial<NewSubject>) => {
      const next = { ...d, ...patch };
      setDraft(next);
      onChange(next.areaId && next.name.trim() ? { kind: 'new', data: next } : null);
    };
    return (
      <div className="space-y-3 rounded-xl border border-line p-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-ink">Novo assunto</p>
          <Button
            variant="ghost"
            size="sm"
            icon={<X className="h-3.5 w-3.5" />}
            onClick={() => {
              setCreating(false);
              onChange(null);
            }}
          >
            Cancelar
          </Button>
        </div>
        <Select label="Área / subárea" value={d.areaId} onChange={(e) => update({ areaId: e.target.value })} required>
          <option value="">Escolha…</option>
          <AreaOptions areas={areas} />
        </Select>
        <Input label="Assunto" placeholder="Ex.: Coledocolitíase" value={d.name} onChange={(e) => update({ name: e.target.value })} maxLength={120} />
        <div>
          <span className="label">Tamanho do assunto</span>
          <Segmented
            size="sm"
            ariaLabel="Tamanho do assunto"
            value={d.size}
            onChange={(size) => update({ size })}
            options={SIZES.map((s) => ({ value: s.value, label: s.label }))}
          />
          <p className="mt-1 text-xs text-muted">Usado para sugerir quantas questões fazer ({SIZES.find((s) => s.value === d.size)?.hint}).</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          className="input pl-9"
          placeholder="Buscar assunto (ex.: pancreatite)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Buscar assunto"
        />
      </div>
      <ul className="max-h-56 overflow-y-auto rounded-xl border border-line" role="listbox" aria-label="Assuntos">
        {matches.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onChange({ kind: 'existing', subject: s })}
              className="flex w-full items-center justify-between gap-2 border-b border-line px-3 py-2 text-left last:border-0 hover:bg-subtle"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink">{s.name}</span>
                <span className="flex items-center gap-1.5 truncate text-xs text-ink2">
                  <AreaDot color={s.area?.color} /> {s.area?.path}
                </span>
              </span>
              {s.nextReview && <span className="shrink-0 text-xs text-muted">revisão agendada</span>}
            </button>
          </li>
        ))}
        {matches.length === 0 && <li className="px-3 py-4 text-center text-sm text-muted">Nenhum assunto encontrado.</li>}
      </ul>
      <button
        type="button"
        onClick={() => {
          setCreating(true);
          setDraft((d) => ({ ...d, name: query.trim() }));
          if (query.trim() && draft.areaId) onChange({ kind: 'new', data: { ...draft, name: query.trim() } });
        }}
        className={cx('flex w-full items-center gap-2 rounded-xl border border-dashed border-line px-3 py-2 text-sm font-medium text-accent hover:bg-accent-wash')}
      >
        <Plus className="h-4 w-4" /> {query.trim() ? `Criar "${query.trim()}"` : 'Criar novo assunto'}
      </button>
    </div>
  );
}
