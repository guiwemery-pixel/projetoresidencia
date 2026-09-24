import { Link } from 'react-router-dom';
import { EyeOff, Minus, Star, TrendingDown, TrendingUp } from 'lucide-react';
import type { GroupMember } from '../../api/types';
import { useGroup, useGroups } from '../../hooks/api';
import { GROUP_INDICATORS, LEVELS } from '../../lib/constants';
import { Avatar, Card, LevelBadge, ProgressBar, Spinner } from '../ui';

// Grupos fixados pelo usuário na página inicial. Mostra só o resumo público de
// cada integrante (mesmo conteúdo da aba Grupo — sem números detalhados).

const TREND = {
  up: { icon: TrendingUp, label: 'evoluindo', color: 'var(--good)' },
  down: { icon: TrendingDown, label: 'em queda', color: 'var(--crit)' },
  steady: { icon: Minus, label: 'estável', color: 'var(--muted)' },
} as const;

function MemberRow({ m }: { m: GroupMember }) {
  const trend = TREND[m.trend ?? 'steady'];
  return (
    <li className="flex items-start gap-3 py-2.5">
      <Avatar name={m.name} src={m.avatar} size={30} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-ink">
            {m.name}
            {m.isMe && <span className="ml-1 text-xs font-normal text-muted">(você)</span>}
          </span>
          {m.shared && (
            <span className="flex shrink-0 items-center gap-1 text-[11px] text-ink2" title={trend.label}>
              <trend.icon className="h-3.5 w-3.5" style={{ color: trend.color }} aria-hidden />
              <span className="sr-only">{trend.label}</span>
            </span>
          )}
        </div>
        {m.shared ? (
          <>
            <div className="mt-1">
              <ProgressBar value={m.progress ?? 0} color={LEVELS[m.level!].color} height={6} label={`Progresso geral de ${m.name}`} />
            </div>
            <ul className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1">
              {GROUP_INDICATORS.map(({ key, label, emoji }) => {
                const ind = m.indicators![key];
                return (
                  <li key={key} className="flex items-center gap-0.5 text-xs" title={`${label}: ${ind.label}`}>
                    <span aria-hidden>{emoji}</span>
                    <LevelBadge level={ind.level} compact />
                    <span className="sr-only">
                      {label}: {ind.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
            <EyeOff className="h-3 w-3" /> não compartilha o progresso
          </p>
        )}
      </div>
    </li>
  );
}

function FavoriteGroupCard({ id }: { id: string }) {
  const { data, isLoading } = useGroup(id);
  return (
    <Card
      title={
        <span className="flex items-center gap-1.5">
          <Star className="h-4 w-4 text-accent" fill="currentColor" aria-hidden />
          {data?.name ?? 'Grupo'}
        </span>
      }
      action={
        <Link to={`/grupo/${id}`} className="text-xs font-medium text-accent">
          Ver grupo
        </Link>
      }
    >
      {isLoading || !data ? (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      ) : (
        <ul className="-my-2.5 divide-y divide-line">
          {data.members.map((m) => (
            <MemberRow key={m.userId} m={m} />
          ))}
        </ul>
      )}
    </Card>
  );
}

export function FavoriteGroups() {
  const { data: groups } = useGroups();
  const favorites = (groups ?? []).filter((g) => g.favorite);
  if (!favorites.length) return null;
  return (
    <>
      {favorites.map((g) => (
        <FavoriteGroupCard key={g.id} id={g.id} />
      ))}
    </>
  );
}
