import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { fmtRelative } from '../lib/format';
import { Button, Card, ConfirmDialog, ErrorState, IconButton, Input, Loading, PageHeader, Segmented, Textarea, useToast } from '../components/ui';

// Administração do site: quem administra (publica os cards da plataforma, cuida desta
// página) e quem pode criar conta. Ver backend/src/modules/admin.

type Role = 'ADMIN' | 'MEMBER';
interface Entry {
  email: string;
  role: Role;
  source: 'env' | 'site' | 'first';
  note: string | null;
  addedAt: string | null;
  account: { name: string; createdAt: string } | null;
}
interface Overview {
  signup: 'open' | 'invite';
  admins: Entry[];
  members: Entry[];
  users: { name: string; email: string; createdAt: string }[];
}

const KEY = ['admin'] as const;

const SOURCE: Record<Entry['source'], string> = {
  env: 'variável PLATFORM_ADMIN_EMAILS (Vercel)',
  site: 'cadastrado aqui',
  first: 'primeira conta do site (até cadastrar um administrador)',
};

function EmailList({ entries, onRemove, me }: { entries: Entry[]; onRemove: (e: Entry) => void; me: string }) {
  if (!entries.length) return <p className="text-sm text-muted">Ninguém cadastrado.</p>;
  return (
    <ul className="divide-y divide-line">
      {entries.map((e) => (
        <li key={e.email} className="flex items-center gap-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">
              {e.email}
              {e.email === me && <span className="ml-2 text-xs font-normal text-muted">(você)</span>}
            </p>
            <p className="truncate text-xs text-muted">
              {e.account ? `Conta de ${e.account.name}` : 'Ainda sem conta'}
              {e.note ? ` · ${e.note}` : ''}
              {e.role === 'ADMIN' ? ` · ${SOURCE[e.source]}` : e.addedAt ? ` · liberado ${fmtRelative(e.addedAt)}` : ''}
            </p>
          </div>
          {e.source === 'site' && (
            <IconButton label={`Tirar ${e.email}`} onClick={() => onRemove(e)}>
              <Trash2 className="h-4 w-4" />
            </IconButton>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function AdminPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const { data, error, isLoading } = useQuery({ queryKey: KEY, queryFn: () => api.get<Overview>('/admin'), enabled: !!user?.isAdmin });
  const [emails, setEmails] = useState('');
  const [note, setNote] = useState('');
  const [role, setRole] = useState<Role>('MEMBER');
  const [removing, setRemoving] = useState<Entry | null>(null);
  const [showUsers, setShowUsers] = useState(false);

  const done = (next: Overview) => {
    qc.setQueryData(KEY, next);
    // Mudou quem administra: o menu (e o "admin" dos flashcards) acompanham
    qc.invalidateQueries({ queryKey: ['me'] });
  };
  const add = useMutation({
    mutationFn: () => api.post<Overview & { added: number }>('/admin/emails', { emails, role, note: note || null }),
    onSuccess: (res) => {
      done(res);
      setEmails('');
      setNote('');
      toast.success(`${res.added} e-mail(s) ${role === 'ADMIN' ? 'agora administram o site' : 'liberado(s)'}.`);
    },
  });
  const remove = useMutation({
    mutationFn: (email: string) => api.del<Overview>(`/admin/emails/${encodeURIComponent(email)}`),
    onSuccess: (res) => {
      done(res);
      setRemoving(null);
    },
  });
  const signup = useMutation({
    mutationFn: (mode: Overview['signup']) => api.put<Overview>('/admin/signup', { mode }),
    onSuccess: done,
  });

  if (!user) return null;
  if (!user.isAdmin) return <Navigate to="/" replace />;

  return (
    <div className="space-y-5">
      <PageHeader title="Administração" subtitle="Quem administra o site e quem pode criar conta. Só administradores veem esta página." />
      {isLoading && <Loading />}
      {error && <ErrorState error={error} />}
      {data && (
        <>
          <Card title="Cadastrar e-mails" subtitle="Cole um ou vários e-mails (separados por vírgula, espaço ou um por linha). A pessoa não precisa ter conta ainda.">
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                add.mutate();
              }}
            >
              <Textarea label="E-mails" rows={3} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder={'aluno1@gmail.com\naluno2@gmail.com'} />
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <p className="label">Cadastrar como</p>
                  <Segmented
                    ariaLabel="Papel"
                    value={role}
                    onChange={setRole}
                    options={[
                      { value: 'MEMBER', label: 'Acesso liberado' },
                      { value: 'ADMIN', label: 'Administrador' },
                    ]}
                  />
                </div>
                <div className="min-w-[12rem] flex-1">
                  <Input label="Observação (opcional)" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: Turma 2027" />
                </div>
                <Button type="submit" icon={<UserPlus className="h-4 w-4" />} loading={add.isPending} disabled={!emails.trim()}>
                  Cadastrar
                </Button>
              </div>
              <p className="text-xs text-muted">
                {role === 'ADMIN'
                  ? 'Administradores publicam os cards da plataforma (aba Flashcards › Cards da plataforma) e acessam esta página.'
                  : 'Com o cadastro "Só e-mails liberados", só quem está nesta lista consegue criar conta.'}
              </p>
              {add.error && <ErrorState error={add.error} />}
            </form>
          </Card>

          <Card title="Quem pode criar conta">
            <Segmented
              ariaLabel="Cadastro"
              value={data.signup}
              onChange={(mode) => signup.mutate(mode)}
              options={[
                { value: 'open', label: 'Qualquer pessoa' },
                { value: 'invite', label: 'Só e-mails liberados' },
              ]}
            />
            <p className="mt-2 text-xs text-muted">
              {data.signup === 'open'
                ? 'Qualquer pessoa com o link cria conta.'
                : 'Só os e-mails liberados abaixo (e os administradores) criam conta. Quem já tem conta continua entrando normalmente.'}
            </p>
            {signup.error && <ErrorState error={signup.error} />}
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title={<span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-accent" /> Administradores ({data.admins.length})</span>}>
              <EmailList entries={data.admins} onRemove={setRemoving} me={user.email} />
            </Card>
            <Card title={`Acesso liberado (${data.members.length})`} subtitle={data.signup === 'open' ? 'Vale quando o cadastro estiver em "Só e-mails liberados".' : undefined}>
              <EmailList entries={data.members} onRemove={setRemoving} me={user.email} />
            </Card>
          </div>

          <Card
            title={`Contas no site (${data.users.length})`}
            action={
              <Button size="sm" variant="ghost" onClick={() => setShowUsers((v) => !v)}>
                {showUsers ? 'Esconder' : 'Mostrar'}
              </Button>
            }
          >
            {showUsers ? (
              <ul className="divide-y divide-line">
                {data.users.map((u) => (
                  <li key={u.email} className="flex items-center gap-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-ink">{u.name}</span>
                    <span className="min-w-0 truncate text-ink2">{u.email}</span>
                    <span className="hidden shrink-0 text-xs text-muted sm:inline">{fmtRelative(u.createdAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Nomes e e-mails de quem criou conta (o conteúdo dos estudos de cada um continua privado).</p>
            )}
          </Card>
        </>
      )}
      <ConfirmDialog
        open={!!removing}
        title={`Tirar ${removing?.email}?`}
        message={
          removing?.role === 'ADMIN'
            ? 'A pessoa deixa de administrar o site (a conta dela continua).'
            : 'O e-mail sai da lista de acesso liberado. Se já tem conta, continua entrando normalmente.'
        }
        confirmLabel="Tirar"
        danger
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.email, { onError: (err) => (toast.error(err), setRemoving(null)) })}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}
