import { useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowLeftRight, ArrowUp, EyeOff, GripVertical, Plus, RotateCcw } from 'lucide-react';
import type { Dashboard } from '../../api/types';
import { Button, IconButton, cx } from '../ui';
import { DEFAULT_LAYOUT, DashboardWidget, WIDGETS, type Column, type Layout, type WidgetId } from './widgets';

// Modo "Personalizar" da página inicial: arrastar pela alça (mouse, toque ou
// teclado), setas para subir/descer, trocar de coluna e ocultar/reexibir.

const COLUMN_LABEL: Record<Column, string> = { main: 'Coluna principal', side: 'Coluna lateral' };
const other = (c: Column): Column => (c === 'main' ? 'side' : 'main');
const containerId = (c: Column) => `col-${c}`;

interface Props {
  initial: Layout;
  data: Dashboard;
  hasFavoriteGroups: boolean;
  saving: boolean;
  onSave: (layout: Layout) => void;
  onCancel: () => void;
}

function SortableWidget({
  id,
  column,
  index,
  count,
  data,
  hasFavoriteGroups,
  onMove,
  onSwitch,
  onHide,
}: {
  id: WidgetId;
  column: Column;
  index: number;
  count: number;
  data: Dashboard;
  hasFavoriteGroups: boolean;
  onMove: (delta: -1 | 1) => void;
  onSwitch: () => void;
  onHide: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const meta = WIDGETS[id];
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cx('rounded-2xl border-2 border-dashed bg-page p-2', isDragging ? 'z-10 border-accent shadow-pop' : 'border-line')}
    >
      <div className="mb-2 flex items-center gap-1">
        <button
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Arrastar ${meta.title}`}
          className="flex h-9 w-9 cursor-grab touch-none items-center justify-center rounded-xl text-ink2 hover:bg-subtle active:cursor-grabbing"
        >
          <GripVertical className="h-5 w-5" />
        </button>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
          <span aria-hidden>{meta.emoji}</span> {meta.title}
        </span>
        <IconButton label="Subir" disabled={index === 0} onClick={() => onMove(-1)} className="disabled:opacity-30">
          <ArrowUp className="h-4 w-4" />
        </IconButton>
        <IconButton label="Descer" disabled={index === count - 1} onClick={() => onMove(1)} className="disabled:opacity-30">
          <ArrowDown className="h-4 w-4" />
        </IconButton>
        <IconButton label={`Mover para a ${COLUMN_LABEL[other(column)].toLowerCase()}`} onClick={onSwitch}>
          <ArrowLeftRight className="h-4 w-4" />
        </IconButton>
        <IconButton label="Ocultar" onClick={onHide}>
          <EyeOff className="h-4 w-4" />
        </IconButton>
      </div>
      {/* Prévia recolhida (não clicável) para facilitar a arrumação */}
      <div className="pointer-events-none relative max-h-44 select-none overflow-hidden rounded-2xl" aria-hidden>
        <DashboardWidget id={id} data={data} column={column} editing hasFavoriteGroups={hasFavoriteGroups} />
        <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-page to-transparent" />
      </div>
    </div>
  );
}

function ColumnZone({ column, children, empty }: { column: Column; children: React.ReactNode; empty: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: containerId(column) });
  return (
    <div ref={setNodeRef} className={cx('min-w-0 space-y-3 rounded-2xl p-1 transition', isOver && 'bg-accent-wash')}>
      <p className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">
        {COLUMN_LABEL[column]}
        {column === 'side' && <span className="font-normal normal-case tracking-normal"> · no celular aparece depois da principal</span>}
      </p>
      {children}
      {empty && <div className="rounded-2xl border-2 border-dashed border-line p-6 text-center text-sm text-muted">Arraste balões para cá</div>}
    </div>
  );
}

export function LayoutEditor({ initial, data, hasFavoriteGroups, saving, onSave, onCancel }: Props) {
  const [layout, setLayout] = useState<Layout>(initial);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const columnOf = (id: string): Column | null => {
    if (id === containerId('main')) return 'main';
    if (id === containerId('side')) return 'side';
    if (layout.main.includes(id as WidgetId)) return 'main';
    if (layout.side.includes(id as WidgetId)) return 'side';
    return null;
  };

  // Ao arrastar sobre a outra coluna, o balão já passa para ela
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const from = columnOf(String(active.id));
    const to = columnOf(String(over.id));
    if (!from || !to || from === to) return;
    setLayout((l) => {
      const id = active.id as WidgetId;
      const target = l[to].filter((x) => x !== id);
      const overIndex = target.indexOf(over.id as WidgetId);
      target.splice(overIndex >= 0 ? overIndex : target.length, 0, id);
      return { ...l, [from]: l[from].filter((x) => x !== id), [to]: target };
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const col = columnOf(String(active.id));
    if (!col || col !== columnOf(String(over.id))) return;
    setLayout((l) => {
      const list = l[col];
      const oldIndex = list.indexOf(active.id as WidgetId);
      const newIndex = over.id === containerId(col) ? list.length - 1 : list.indexOf(over.id as WidgetId);
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return l;
      return { ...l, [col]: arrayMove(list, oldIndex, newIndex) };
    });
  };

  const move = (col: Column, index: number, delta: -1 | 1) =>
    setLayout((l) => ({ ...l, [col]: arrayMove(l[col], index, index + delta) }));
  const switchColumn = (col: Column, id: WidgetId) =>
    setLayout((l) => ({ ...l, [col]: l[col].filter((x) => x !== id), [other(col)]: [id, ...l[other(col)]] }));
  const hide = (col: Column, id: WidgetId) =>
    setLayout((l) => ({ ...l, [col]: l[col].filter((x) => x !== id), hidden: [...l.hidden, id] }));
  const show = (id: WidgetId) =>
    setLayout((l) => {
      const col = WIDGETS[id].column;
      return { ...l, hidden: l.hidden.filter((x) => x !== id), [col]: [...l[col], id] };
    });

  const renderColumn = (col: Column) => (
    <ColumnZone column={col} empty={layout[col].length === 0}>
      <SortableContext id={containerId(col)} items={layout[col]} strategy={verticalListSortingStrategy}>
        {layout[col].map((id, i) => (
          <SortableWidget
            key={id}
            id={id}
            column={col}
            index={i}
            count={layout[col].length}
            data={data}
            hasFavoriteGroups={hasFavoriteGroups}
            onMove={(d) => move(col, i, d)}
            onSwitch={() => switchColumn(col, id)}
            onHide={() => hide(col, id)}
          />
        ))}
      </SortableContext>
    </ColumnZone>
  );

  return (
    <div className="space-y-4">
      <div className="sticky top-14 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent bg-accent-wash p-3 shadow-card">
        <div className="text-sm text-ink">
          <p className="font-semibold">Personalizando a página inicial</p>
          <p className="hidden text-ink2 sm:block">Arraste pelos ⋮⋮ ou use as setas. ⇄ troca de coluna.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" className="px-2" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setLayout({ ...DEFAULT_LAYOUT, main: [...DEFAULT_LAYOUT.main], side: [...DEFAULT_LAYOUT.side], hidden: [] })}>
            <span className="hidden sm:inline">Restaurar padrão</span>
            <span className="sm:hidden">Padrão</span>
          </Button>
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancelar
          </Button>
          <Button size="sm" loading={saving} onClick={() => onSave(layout)}>
            Salvar
          </Button>
        </div>
      </div>

      {layout.hidden.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface p-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">Ocultos</span>
          {layout.hidden.map((id) => (
            <button key={id} onClick={() => show(id)} className="chip text-ink2 hover:bg-subtle" aria-label={`Mostrar ${WIDGETS[id].title}`}>
              <Plus className="h-3.5 w-3.5" /> {WIDGETS[id].emoji} {WIDGETS[id].title}
            </button>
          ))}
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragOver={onDragOver} onDragEnd={onDragEnd}>
        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
          {renderColumn('main')}
          {renderColumn('side')}
        </div>
      </DndContext>
    </div>
  );
}
