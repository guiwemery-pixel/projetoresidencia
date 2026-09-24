import { useState } from 'react';
import { LayoutGrid, PenLine } from 'lucide-react';
import { api } from '../api/client';
import type { User } from '../api/types';
import { useDashboard, useGroups } from '../hooks/api';
import { useAuth } from '../hooks/useAuth';
import { fmtLong } from '../lib/format';
import { Button, ErrorState, Loading, useToast } from '../components/ui';
import { useStudyDialog } from '../components/study/StudyDialog';
import { DashboardWidget, normalizeLayout, type Column, type Layout } from '../components/dashboard/widgets';
import { LayoutEditor } from '../components/dashboard/LayoutEditor';

// Mantidos aqui por compatibilidade com importações antigas
export { InsightList, ProgressOverview } from '../components/dashboard/shared';

export function DashboardPage() {
  const { user, setUser } = useAuth();
  const { data, isLoading, error } = useDashboard();
  const { data: groups } = useGroups();
  const openStudy = useStudyDialog();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorState error={error} />;

  const layout = normalizeLayout(user?.dashboardLayout);
  const hasFavoriteGroups = (groups ?? []).some((g) => g.favorite);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

  async function save(next: Layout) {
    setSaving(true);
    try {
      const { user: updated } = await api.patch<{ user: User }>('/me', { dashboardLayout: next });
      setUser(updated);
      setEditing(false);
      toast.success('Página inicial salva.');
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  }

  const renderColumn = (col: Column) => (
    <div className="min-w-0 space-y-5">
      {layout[col].map((id) => (
        <DashboardWidget key={id} id={id} data={data} column={col} hasFavoriteGroups={hasFavoriteGroups} />
      ))}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm first-letter:uppercase text-ink2">{fmtLong(data.today)}</p>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            {greeting}, {user?.name.split(' ')[0]}!
          </h1>
        </div>
        {!editing && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<LayoutGrid className="h-4 w-4" />} onClick={() => setEditing(true)}>
              Personalizar
            </Button>
            <Button icon={<PenLine className="h-4 w-4" />} onClick={() => openStudy()}>
              Registrar estudo
            </Button>
          </div>
        )}
      </div>

      {editing ? (
        <LayoutEditor
          initial={layout}
          data={data}
          hasFavoriteGroups={hasFavoriteGroups}
          saving={saving}
          onSave={save}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
          {renderColumn('main')}
          {renderColumn('side')}
        </div>
      )}
    </div>
  );
}
