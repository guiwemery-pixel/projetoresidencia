import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CheckCircle2, Flame, Info, RefreshCcw, Target, TrendingDown, TrendingUp, PenLine, Minus } from 'lucide-react';
import type { Insight, Progress } from '../api/types';
import { useDashboard, useRescheduleReview } from '../hooks/api';
import { useAuth } from '../hooks/useAuth';
import { LEVELS } from '../lib/constants';
import { duration, fmtLong, fmtShort, fmtWeekday, pct, plural, relativeDay, todayLocal } from '../lib/format';
import { Button, Card, EmptyState, ErrorState, LevelBadge, Loading, ProgressBar, cx, useToast } from '../components/ui';
import { ReviewCard } from '../components/study/ReviewCard';
import { useStudyDialog } from '../components/study/StudyDialog';
import { FavoriteGroups } from '../components/groups/FavoriteGroups';

function TodayTile({ icon, value, label, tone, to }: { icon: React.ReactNode; value: React.ReactNode; label: string; tone?: 'crit'; to: string }) {
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

export function DashboardPage() {
  const { user } = useAuth();
  const { data, isLoading, error } = useDashboard();
  const openStudy = useStudyDialog();
  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorState error={error} />;

  const { summary, week } = data;
  const reviews = [...data.reviews.overdue, ...data.reviews.today];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm first-letter:uppercase text-ink2">{fmtLong(data.today)}</p>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            {greeting}, {user?.name.split(' ')[0]}!
          </h1>
        </div>
        <Button icon={<PenLine className="h-4 w-4" />} onClick={() => openStudy()}>
          Registrar estudo
        </Button>
      </div>

      <section aria-label="Hoje" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-5">
          <Card
            title="Revisões de hoje"
            subtitle={reviews.length ? 'Atrasadas primeiro. Registre o desempenho para o algoritmo recalcular o próximo intervalo.' : undefined}
            action={
              <Link to="/revisoes" className="text-xs font-medium text-accent">
                Ver todas
              </Link>
            }
          >
            {reviews.length ? (
              <div className="space-y-2">
                {reviews.slice(0, 8).map((r) => (
                  <ReviewCard key={r.id} review={r} />
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

          <Card title="Esta semana" subtitle="Últimos 7 dias">
            <div className="grid gap-4 sm:grid-cols-2">
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
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
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

          <div className="grid gap-5 md:grid-cols-2">
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
          </div>
        </div>

        <div className="space-y-5">
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

          <FavoriteGroups />

          {data.insights.length > 0 && (
            <Card title="Recomendações">
              <InsightList items={data.insights} />
            </Card>
          )}

          {data.comparisons.length > 0 && (
            <Card title="Você em relação a você" subtitle="Sem ranking: a comparação é sempre com o seu próprio histórico.">
              <InsightList items={data.comparisons} />
            </Card>
          )}

          {data.goals.length > 0 && (
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
          )}
        </div>
      </div>
    </div>
  );
}
