import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Info, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import type { Insight, Progress } from '../../api/types';
import { useRescheduleReview } from '../../hooks/api';
import { LEVELS } from '../../lib/constants';
import { todayLocal } from '../../lib/format';
import { LevelBadge, ProgressBar, useToast } from '../ui';

// Blocos usados na página inicial e no Perfil.

export function ProgressOverview({ progress, compact }: { progress: Progress; compact?: boolean }) {
  const trend = {
    up: { icon: <TrendingUp className="h-4 w-4" style={{ color: 'var(--good)' }} />, label: 'evoluindo' },
    down: { icon: <TrendingDown className="h-4 w-4" style={{ color: 'var(--crit)' }} />, label: 'em queda' },
    steady: { icon: <Minus className="h-4 w-4 text-muted" />, label: 'estável' },
  }[progress.trend];
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs text-ink2">Progresso geral</p>
            <p className="text-3xl font-semibold text-ink">{progress.index ?? '—'}<span className="text-base text-muted">/100</span></p>
          </div>
          <span className="flex items-center gap-1 text-xs text-ink2">
            {trend.icon} {trend.label}
          </span>
        </div>
        <div className="mt-2">
          <ProgressBar value={progress.index ?? 0} color={LEVELS[progress.level].color} height={10} label="Progresso geral" />
        </div>
      </div>
      <ul className="space-y-2.5">
        {progress.components
          .filter((c) => !compact || c.key !== 'simulados' || c.score !== null)
          .map((c) => (
            <li key={c.key}>
              <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                <span className="text-ink">{c.label}</span>
                <LevelBadge level={c.level} label={c.statusLabel} />
              </div>
              <ProgressBar value={c.score ?? 0} color={LEVELS[c.level].color} height={6} label={c.label} />
            </li>
          ))}
      </ul>
    </div>
  );
}

export function InsightList({ items }: { items: Insight[] }) {
  const reschedule = useRescheduleReview();
  const toast = useToast();
  const navigate = useNavigate();
  const today = todayLocal();
  const icon = {
    positive: <CheckCircle2 className="h-4 w-4" style={{ color: 'var(--good)' }} />,
    warning: <AlertTriangle className="h-4 w-4" style={{ color: 'var(--serious)' }} />,
    info: <Info className="h-4 w-4 text-accent" />,
  };
  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <li key={i.id} className="flex gap-3 rounded-xl bg-subtle p-3">
          <span className="mt-0.5 shrink-0">{icon[i.kind]}</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-ink">{i.text}</p>
            {i.detail && <p className="num mt-0.5 text-xs text-ink2">{i.detail}</p>}
            {i.action && (
              <button
                className="mt-1 text-xs font-medium text-accent"
                onClick={async () => {
                  if (i.action?.anticipateReviewId) {
                    try {
                      await reschedule.mutateAsync({ id: i.action.anticipateReviewId, date: today });
                      toast.success('Revisão antecipada para hoje.');
                    } catch (err) {
                      toast.error(err);
                    }
                  } else if (i.action?.to) navigate(i.action.to);
                }}
              >
                {i.action.label} →
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
