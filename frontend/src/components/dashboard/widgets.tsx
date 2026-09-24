import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Flame, PenLine, RefreshCcw, Target } from 'lucide-react';
import type { Dashboard } from '../../api/types';
import { duration, fmtShort, fmtWeekday, pct, plural, relativeDay } from '../../lib/format';
import { Card, EmptyState, ProgressBar, cx } from '../ui';
import { ReviewCard } from '../study/ReviewCard';
import { FavoriteGroups } from '../groups/FavoriteGroups';
import { InsightList, ProgressOverview } from './shared';

// "Balões" da página inicial. Cada um sabe se desenhar na coluna larga
// (principal) ou estreita (lateral). A ordem é escolhida pelo usuário.

export type WidgetId =
  | 'hoje'
  | 'revisoes'
  | 'semana'
  | 'proximas'
  | 'recentes'
  | 'progresso'
  | 'grupos'
  | 'recomendacoes'
  | 'comparacoes'
  | 'metas';

export type Column = 'main' | 'side';

export interface Layout {
  main: WidgetId[];
  side: WidgetId[];
  hidden: WidgetId[];
}

export const WIDGETS: Record<WidgetId, { title: string; emoji: string; column: Column }> = {
  hoje: { title: 'Resumo de hoje', emoji: '📌', column: 'main' },
  revisoes: { title: 'Revisões de hoje', emoji: '🔄', column: 'main' },
  semana: { title: 'Esta semana', emoji: '📅', column: 'main' },
  proximas: { title: 'Próximas atividades', emoji: '⏭️', column: 'main' },
  recentes: { title: 'Estudos recentes', emoji: '📚', column: 'main' },
  progresso: { title: 'Seu progresso', emoji: '📈', column: 'side' },
  grupos: { title: 'Grupos fixados', emoji: '⭐', column: 'side' },
  recomendacoes: { title: 'Recomendações', emoji: '💡', column: 'side' },
  comparacoes: { title: 'Você em relação a você', emoji: '🪞', column: 'side' },
  metas: { title: 'Metas', emoji: '🎯', column: 'side' },
};

const IDS = Object.keys(WIDGETS) as WidgetId[];

export const DEFAULT_LAYOUT: Layout = {
  main: ['hoje', 'revisoes', 'semana', 'proximas', 'recentes'],
  side: ['progresso', 'grupos', 'recomendacoes', 'comparacoes', 'metas'],
  hidden: [],
};

/** Aceita qualquer layout salvo: remove ids desconhecidos/duplicados e inclui balões novos. */
export function normalizeLayout(raw: { main?: string[]; side?: string[]; hidden?: string[] } | null | undefined): Layout {
  if (!raw) return { main: [...DEFAULT_LAYOUT.main], side: [...DEFAULT_LAYOUT.side], hidden: [] };
  const seen = new Set<WidgetId>();
  const clean = (list: string[] | undefined) =>
    (list ?? []).filter((id): id is WidgetId => (IDS as string[]).includes(id) && !seen.has(id as WidgetId) && !!seen.add(id as WidgetId));
  const layout: Layout = { main: clean(raw.main), side: clean(raw.side), hidden: clean(raw.hidden) };
  for (const id of IDS) if (!seen.has(id)) layout[WIDGETS[id].column].push(id);
  return layout;
}

function TodayTile({ icon, value, label, tone, to }: { icon: ReactNode; value: ReactNode; label: string; tone?: 'crit'; to: string }) {
  return (
    <Link to={to} className="card flex items-center gap-3 p-4 transition hover:border-accent">
      <span className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', tone === 'crit' ? 'bg-crit-wash' : 'bg-accent-wash')}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-2xl font-semibold leading-tight text-ink">{value}</span>
        <span className="block truncate text-xs text-ink2">{label}</span>
      </span>
    </Link>
  );
}

function Placeholder({ id, text }: { id: WidgetId; text: string }) {
  return (
    <Card title={WIDGETS[id].title}>
      <p className="text-sm text-muted">{text}</p>
    </Card>
  );
}

/**
 * Conteúdo de um balão. Retorna null quando não há nada a mostrar
 * (exceto no modo de edição, em que um aviso ocupa o lugar para poder ser movido).
 */
export function DashboardWidget({
  id,
  data,
  column,
  editing,
  hasFavoriteGroups,
}: {
  id: WidgetId;
  data: Dashboard;
  column: Column;
  editing?: boolean;
  hasFavoriteGroups: boolean;
}) {
  const narrow = column === 'side';
  const { summary, week } = data;

  switch (id) {
    case 'hoje':
      return (
        <section aria-label="Hoje" className={cx('grid grid-cols-2 gap-3', !narrow && 'xl:grid-cols-4')}>
          <TodayTile to="/revisoes" icon={<RefreshCcw className="h-5 w-5 text-accent" />} value={summary.reviewsToday} label={summary.reviewsToday === 1 ? 'revisão para hoje' : 'revisões para hoje'} />
          <TodayTile
            to="/revisoes"
            tone={summary.overdue ? 'crit' : undefined}
            icon={<AlertTriangle className="h-5 w-5" style={{ color: summary.overdue ? 'var(--crit)' : 'var(--muted)' }} />}
            value={summary.overdue}
            label={summary.overdue === 1 ? 'revisão atrasada' : 'revisões atrasadas'}
          />
          <TodayTile
            to="/metricas"
            icon={<PenLine className="h-5 w-5 text-accent" />}
            value={
              <span className="num">
                {summary.questionsDoneToday}
                <span className="text-base text-muted">/{summary.plannedQuestions}</span>
              </span>
            }
            label="questões planejadas"
          />
          <TodayTile to="/metas" icon={<Target className="h-5 w-5 text-accent" />} value={summary.goalsToday} label={summary.goalsToday === 1 ? 'meta para hoje' : 'metas para hoje'} />
        </section>
      );

    case 'revisoes': {
      const reviews = [...data.reviews.overdue, ...data.reviews.today];
      return (
        <Card
          title="Revisões de hoje"
          subtitle={reviews.length && !narrow ? 'Atrasadas primeiro. Registre o desempenho para o algoritmo recalcular o próximo intervalo.' : undefined}
          action={
            <Link to="/revisoes" className="text-xs font-medium text-accent">
              Ver todas
            </Link>
          }
        >
          {reviews.length ? (
            <div className="space-y-2">
              {reviews.slice(0, 8).map((r) => (
                <ReviewCard key={r.id} review={r} compact={narrow} />
              ))}
              {reviews.length > 8 && (
                <Link to="/revisoes" className="block pt-1 text-center text-sm text-accent">
                  + {reviews.length - 8} revisões
                </Link>
              )}
            </div>
          ) : (
            <EmptyState icon="🎉" title="Nenhuma revisão pendente para hoje">
              Registre um estudo novo e o sistema agenda as revisões automaticamente.
            </EmptyState>
          )}
        </Card>
      );
    }

    case 'semana':
      return (
        <Card title="Esta semana" subtitle="Últimos 7 dias">
          <div className={cx('grid gap-4', !narrow && 'sm:grid-cols-2')}>
            <div>
              <div className="mb-1 flex justify-between text-sm">
                <span className="text-ink2">Horas estudadas</span>
                <span className="num font-medium text-ink">
                  {week.hours.toLocaleString('pt-BR')} h / {week.targetHours} h
                </span>
              </div>
              <ProgressBar value={(week.hours / week.targetHours) * 100} label="Horas estudadas na semana" />
            </div>
            <div>
              <div className="mb-1 flex justify-between text-sm">
                <span className="text-ink2">Dias com estudo</span>
                <span className="num font-medium text-ink">
                  {week.daysStudied} / {week.targetDays}
                </span>
              </div>
              <ProgressBar value={(week.daysStudied / week.targetDays) * 100} label="Dias estudados na semana" />
            </div>
          </div>
          <dl className={cx('mt-4 grid grid-cols-2 gap-3 text-sm', !narrow && 'sm:grid-cols-4')}>
            <div>
              <dt className="text-xs text-muted">Questões</dt>
              <dd className="num font-semibold text-ink">{week.questions}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Acertos</dt>
              <dd className="num font-semibold text-ink">{pct(week.accuracy)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Revisões feitas</dt>
              <dd className="num font-semibold text-ink">{week.reviewsDone}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Sequência</dt>
              <dd className="flex items-center gap-1 font-semibold text-ink">
                <Flame className="h-4 w-4" style={{ color: week.streak ? 'var(--serious)' : 'var(--muted)' }} /> {plural(week.streak, 'dia', 'dias')}
              </dd>
            </div>
          </dl>
        </Card>
      );

    case 'proximas':
      return (
        <Card title="Próximas atividades">
          {data.upcoming.reviewsByDay.length || data.upcoming.mockExams.length || data.upcoming.goalsDue.length ? (
            <ul className="space-y-2 text-sm">
              {data.upcoming.mockExams.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">🏁 {m.name}</span>
                  <span className="shrink-0 text-xs text-muted">{relativeDay(m.date, data.today)}</span>
                </li>
              ))}
              {data.upcoming.goalsDue.map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">🎯 {g.title}</span>
                  <span className="shrink-0 text-xs text-muted">prazo {relativeDay(g.dueDate!, data.today)}</span>
                </li>
              ))}
              {data.upcoming.reviewsByDay.map((d) => (
                <li key={d.date} className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="text-ink">🔄 {plural(d.reviews, 'revisão', 'revisões')}</span>
                    <span className="block truncate text-xs text-muted">{d.subjects.join(', ')}</span>
                  </span>
                  <span className="inline-block shrink-0 text-xs first-letter:uppercase text-muted">
                    {fmtWeekday(d.date)} {fmtShort(d.date)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Nada agendado para os próximos 7 dias.</p>
          )}
        </Card>
      );

    case 'recentes':
      return (
        <Card
          title="Estudos recentes"
          action={
            <Link to="/estudos" className="text-xs font-medium text-accent">
              Histórico
            </Link>
          }
        >
          {data.recentStudies.length ? (
            <ul className="space-y-2 text-sm">
              {data.recentStudies.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2">
                  <Link to={`/assuntos/${s.subject.id}`} className="min-w-0 hover:underline">
                    <span className="block truncate text-ink">{s.subject.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {relativeDay(s.date, data.today)} · {duration(s.durationMinutes)}
                    </span>
                  </Link>
                  {s.questions && (
                    <span className="num shrink-0 text-xs text-ink2">
                      {s.questions.correct}/{s.questions.total} · {pct(s.questions.accuracy)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Nenhum estudo registrado ainda.</p>
          )}
        </Card>
      );

    case 'progresso':
      return (
        <Card
          title="Seu progresso"
          action={
            <Link to="/perfil#indicador" className="flex items-center gap-1 text-xs font-medium text-accent">
              Como é calculado <ArrowRight className="h-3 w-3" />
            </Link>
          }
        >
          <ProgressOverview progress={data.progress} compact />
        </Card>
      );

    case 'grupos':
      if (!hasFavoriteGroups) {
        return editing ? <Placeholder id={id} text="Fixe um grupo na aba Grupo (★ Fixar no início) para vê-lo aqui." /> : null;
      }
      return (
        <div className="space-y-5">
          <FavoriteGroups />
        </div>
      );

    case 'recomendacoes':
      if (!data.insights.length) return editing ? <Placeholder id={id} text="Nenhuma recomendação no momento." /> : null;
      return (
        <Card title="Recomendações">
          <InsightList items={data.insights} />
        </Card>
      );

    case 'comparacoes':
      if (!data.comparisons.length) return editing ? <Placeholder id={id} text="Ainda sem histórico suficiente para comparar." /> : null;
      return (
        <Card title="Você em relação a você" subtitle="Sem ranking: a comparação é sempre com o seu próprio histórico.">
          <InsightList items={data.comparisons} />
        </Card>
      );

    case 'metas':
      if (!data.goals.length) return editing ? <Placeholder id={id} text="Nenhuma meta ativa. Crie metas na aba Metas." /> : null;
      return (
        <Card
          title="Metas"
          action={
            <Link to="/metas" className="text-xs font-medium text-accent">
              Ver metas
            </Link>
          }
        >
          <ul className="space-y-3">
            {data.goals.map((g) => (
              <li key={g.id}>
                <div className="mb-1 flex justify-between gap-2 text-sm">
                  <span className="truncate text-ink">{g.title}</span>
                  <span className="num shrink-0 text-xs text-ink2">{pct(g.percent)}</span>
                </div>
                <ProgressBar value={g.percent} color={g.reachedThisPeriod ? 'var(--good)' : 'var(--accent)'} height={6} label={g.title} />
              </li>
            ))}
          </ul>
        </Card>
      );
  }
}
