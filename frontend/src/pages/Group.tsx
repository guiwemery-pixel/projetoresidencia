import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, EyeOff, Lock, LogOut, Minus, RefreshCw, TrendingDown, TrendingUp, UserMinus, UserPlus, Users } from 'lucide-react';
import { api } from '../api/client';
import type { GroupMember } from '../api/types';
import { useGroup, useGroups } from '../hooks/api';
import { LEVELS } from '../lib/constants';
import { Avatar, Button, Card, ConfirmDialog, EmptyState, ErrorState, IconButton, Input, LevelBadge, Loading, Modal, PageHeader, ProgressBar, cx, useToast } from '../components/ui';

const INDICATORS = [
  { key: 'estudos', label: 'Estudos', emoji: '📚' },
  { key: 'questoes', label: 'Questões', emoji: '📝' },
  { key: 'revisoes', label: 'Revisões', emoji: '🔄' },
  { key: 'metas', label: 'Metas', emoji: '🎯' },
  { key: 'simulados', label: 'Simulados', emoji: '🏁' },
] as const;

function MemberCard({ m, canRemove, onRemove }: { m: GroupMember; canRemove: boolean; onRemove: () => void }) {
  const trend = m.trend === 'up' ? { icon: TrendingUp, label: 'evoluindo', color: 'var(--good)' } : m.trend === 'down' ? { icon: TrendingDown, label: 'em queda', color: 'var(--crit)' } : { icon: Minus, label: 'estável', color: 'var(--muted)' };
  return (
    <article className={cx('card p-4', m.isMe && 'ring-2 ring-accent-wash')}>
      <header className="flex items-center gap-3">
        <Avatar name={m.name} src={m.avatar} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold uppercase tracking-wide text-ink">
            {m.name} {m.isMe && <span className="ml-1 rounded-md bg-accent-wash px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-ink">você</span>}
          </p>
          {m.shared && (
            <p className="flex items-center gap-1 text-xs text-ink2">
              <trend.icon className="h-3.5 w-3.5" style={{ color: trend.color }} /> {trend.label}
            </p>
          )}
        </div>
        {canRemove && (
          <IconButton label={`Remover ${m.name}`} onClick={onRemove}>
            <UserMinus className="h-4 w-4" />
          </IconButton>
        )}
      </header>
      {!m.shared ? (
        <p className="mt-4 flex items-center gap-2 rounded-xl bg-subtle p-3 text-sm text-ink2">
          <EyeOff className="h-4 w-4" /> Preferiu não compartilhar o progresso.
        </p>
      ) : (
        <>
          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between text-xs text-ink2">
              <span>Progresso geral</span>
              <LevelBadge level={m.level!} />
            </div>
            <ProgressBar value={m.progress ?? 0} color={LEVELS[m.level!].color} height={12} label={`Progresso geral de ${m.name}`} />
          </div>
          <ul className="mt-4 space-y-1.5 text-sm">
            {INDICATORS.map(({ key, label, emoji }) => {
              const ind = m.indicators![key];
              return (
                <li key={key} className="flex items-center justify-between gap-2">
                  <span className="text-ink">
                    <span aria-hidden>{emoji}</span> {label}
                  </span>
                  <span className="flex items-center gap-1.5 text-right text-xs text-ink2">
                    {key === 'metas' && ind.percent != null ? `${ind.percent}% concluídas` : ind.label}
                    <LevelBadge level={ind.level} compact />
                  </span>
                </li>
              );
            })}
          </ul>
          {m.isMe && (
            <Link to="/perfil#indicador" className="mt-3 block text-xs font-medium text-accent">
              Ver meu cálculo detalhado →
            </Link>
          )}
        </>
      )}
    </article>
  );
}

function JoinCreate({ onDone }: { onDone: (id: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const join = useMutation({
    mutationFn: () => api.post<{ id: string }>('/groups/join', { code }),
    onSuccess: async (g) => {
      await qc.invalidateQueries({ queryKey: ['groups'] });
      toast.success('Você entrou no grupo!');
      onDone(g.id);
    },
    onError: toast.error,
  });
  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/groups', { name }),
    onSuccess: async (g) => {
      await qc.invalidateQueries({ queryKey: ['groups'] });
      toast.success('Grupo criado! Compartilhe o código com seus amigos.');
      onDone(g.id);
    },
    onError: toast.error,
  });
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="Entrar com código de convite">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            join.mutate();
          }}
        >
          <Input aria-label="Código de convite" placeholder="Ex.: K7M2Q9XA" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={16} />
          <Button type="submit" loading={join.isPending} disabled={code.trim().length < 4} icon={<UserPlus className="h-4 w-4" />}>
            Entrar
          </Button>
        </form>
      </Card>
      <Card title="Criar um grupo">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Input aria-label="Nome do grupo" placeholder="Ex.: Residência 2027" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          <Button type="submit" loading={create.isPending} disabled={name.trim().length < 2} icon={<Users className="h-4 w-4" />}>
            Criar
          </Button>
        </form>
      </Card>
    </div>
  );
}

export default function GroupPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const groups = useGroups();
  const groupId = id ?? groups.data?.[0]?.id;
  const board = useGroup(groupId);
  const [joinOpen, setJoinOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; message: string; run: () => Promise<unknown> } | null>(null);
  const [busy, setBusy] = useState(false);
  const regen = useMutation({
    mutationFn: () => api.post(`/groups/${groupId}/invite`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['group', groupId] }),
    onError: toast.error,
  });

  if (groups.isLoading) return <Loading />;
  if (groups.error) return <ErrorState error={groups.error} />;

  if (!groups.data?.length) {
    return (
      <div>
        <PageHeader title="Grupo" subtitle="Acompanhe o ritmo dos amigos — sem expor os números de ninguém." />
        <EmptyState icon="👥" title="Você ainda não participa de um grupo">
          Crie um grupo e compartilhe o código, ou entre com o código de um amigo.
        </EmptyState>
        <div className="mt-5">
          <JoinCreate onDone={(gid) => navigate(`/grupo/${gid}`)} />
        </div>
      </div>
    );
  }

  const data = board.data;
  const inviteLink = data ? `${window.location.origin}/cadastro?convite=${data.inviteCode}` : '';
  const runConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      await confirm.run();
      await qc.invalidateQueries({ queryKey: ['groups'] });
      await qc.invalidateQueries({ queryKey: ['group'] });
      setConfirm(null);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={data?.name ?? 'Grupo'}
        subtitle={data?.description ?? 'Visão geral do progresso de cada integrante.'}
        actions={
          <>
            {groups.data.length > 1 && (
              <select className="input w-auto" value={groupId} onChange={(e) => navigate(`/grupo/${e.target.value}`)} aria-label="Escolher grupo">
                {groups.data.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            )}
            <Button variant="secondary" icon={<UserPlus className="h-4 w-4" />} onClick={() => setJoinOpen(true)}>
              Outro grupo
            </Button>
          </>
        }
      />

      <div className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-4 text-sm text-ink2">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <p>
          Aqui cada pessoa aparece só com <strong className="text-ink">indicadores resumidos</strong> (ritmo, desempenho, revisões em dia, metas). Números de questões, percentuais de acerto, horas,
          assuntos e datas continuam privados. Você pode desativar o compartilhamento em{' '}
          <Link to="/perfil" className="font-medium text-accent">
            Perfil
          </Link>
          .
        </p>
      </div>

      {board.isLoading && <Loading />}
      {board.error && <ErrorState error={board.error} />}
      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.members.map((m) => (
              <MemberCard
                key={m.userId}
                m={m}
                canRemove={data.myRole === 'OWNER' && !m.isMe}
                onRemove={() => setConfirm({ title: `Remover ${m.name}?`, message: 'A pessoa sai do grupo, mas nada dos dados dela é apagado.', run: () => api.del(`/groups/${data.id}/members/${m.userId}`) })}
              />
            ))}
          </div>
          <Card title="Convidar amigos" subtitle="Quem entrar com este código verá apenas os indicadores resumidos do grupo.">
            <div className="flex flex-wrap items-center gap-2">
              <code className="num rounded-xl bg-subtle px-3 py-2 text-lg font-semibold tracking-widest text-ink">{data.inviteCode}</code>
              <Button
                variant="secondary"
                size="sm"
                icon={<Copy className="h-4 w-4" />}
                onClick={() => navigator.clipboard?.writeText(inviteLink).then(() => toast.success('Link de convite copiado.'))}
              >
                Copiar link
              </Button>
              {data.myRole === 'OWNER' && (
                <Button variant="ghost" size="sm" loading={regen.isPending} icon={<RefreshCw className="h-4 w-4" />} onClick={() => regen.mutate()}>
                  Gerar novo código
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                icon={<LogOut className="h-4 w-4" />}
                onClick={() =>
                  setConfirm({
                    title: 'Sair do grupo?',
                    message: 'Você deixa de ver o grupo e os outros deixam de ver seu resumo. Seus dados continuam intactos.',
                    run: async () => {
                      await api.post(`/groups/${data.id}/leave`);
                      navigate('/grupo');
                    },
                  })
                }
              >
                Sair do grupo
              </Button>
            </div>
          </Card>
        </>
      )}
      <Modal open={joinOpen} onClose={() => setJoinOpen(false)} title="Entrar ou criar outro grupo" wide>
        <JoinCreate
          onDone={(gid) => {
            setJoinOpen(false);
            navigate(`/grupo/${gid}`);
          }}
        />
      </Modal>
      <ConfirmDialog open={!!confirm} title={confirm?.title ?? ''} message={confirm?.message} danger loading={busy} onConfirm={runConfirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
