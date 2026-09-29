import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { User } from '../api/types';
import { useAuth } from '../hooks/useAuth';
import { Button, Input, Select } from '../components/ui';
import { isCardsPath, isFlashcardsHost } from '../flashcards/standalone';

/** Para onde voltar depois de entrar, e se a pessoa veio pelo app só de flashcards. */
function useReturnTo() {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  return { from, cards: isFlashcardsHost() || isCardsPath(from ?? '') };
}

function AuthShell({ title, subtitle, children, cards }: { title: string; subtitle: string; children: ReactNode; cards?: boolean }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          {cards ? (
            <img src="/icons/flashcards-192.png" alt="Flashcards" width={112} height={112} className="mb-4 h-28 w-28 rounded-3xl shadow-card" />
          ) : (
            <img src="/icons/icon-192.png" alt="Projeto Residente" width={112} height={112} className="mb-4 h-28 w-28 rounded-3xl shadow-card" />
          )}
          <h1 className="text-xl font-semibold text-ink">{title}</h1>
          <p className="mt-1 text-sm text-ink2">{subtitle}</p>
        </div>
        <div className="card p-5">{children}</div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { from, cards } = useReturnTo();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { user } = await api.post<{ user: User }>('/auth/login', { email, password });
      setUser(user);
      navigate(from ?? '/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao entrar');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      cards={cards}
      title={cards ? 'Entrar nos Flashcards' : 'Entrar'}
      subtitle={cards ? 'Seus flashcards com revisão espaçada. Use a mesma conta do Projeto Residente.' : 'Organize seus estudos, revise no momento certo e acompanhe o grupo.'}
    >
      <form onSubmit={submit} className="space-y-4">
        <Input label="E-mail" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input label="Senha" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="rounded-xl bg-crit-wash px-3 py-2 text-sm text-crit-text">{error}</p>}
        <Button type="submit" loading={loading} className="w-full">
          Entrar
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-ink2">
        Ainda não tem conta?{' '}
        <Link to="/cadastro" state={location.state} className="font-medium text-accent">
          Criar conta
        </Link>
      </p>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { from, cards } = useReturnTo();
  const [params] = useSearchParams();
  const [form, setForm] = useState({ name: '', email: '', password: '', inviteCode: params.get('convite') ?? '', template: 'medicina' });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  // Cadastro só para e-mails liberados pela Administração: avisa antes de preencher
  const [inviteOnly, setInviteOnly] = useState(false);
  useEffect(() => {
    api
      .get<{ mode: string }>('/auth/signup')
      .then((r) => setInviteOnly(r.mode === 'invite'))
      .catch(() => {});
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { user } = await api.post<{ user: User }>('/auth/register', {
        ...form,
        inviteCode: form.inviteCode.trim() || null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setUser(user);
      navigate(from ?? '/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar conta');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      cards={cards}
      title="Criar conta"
      subtitle={cards ? 'Uma conta do Projeto Residente vale para os flashcards e para o site completo.' : 'Seus dados detalhados ficam privados. O grupo vê apenas um resumo visual.'}
    >
      <form onSubmit={submit} className="space-y-4">
        {inviteOnly && <p className="rounded-xl bg-accent-wash px-3 py-2 text-sm text-ink2">O cadastro está liberado só para e-mails autorizados. Use o e-mail que você informou ao administrador.</p>}
        <Input label="Nome" autoComplete="name" required minLength={2} value={form.name} onChange={set('name')} />
        <Input label="E-mail" type="email" autoComplete="email" required value={form.email} onChange={set('email')} />
        <Input label="Senha" type="password" autoComplete="new-password" required minLength={8} hint="Mínimo de 8 caracteres." value={form.password} onChange={set('password')} />
        <Select label="Área de estudo" value={form.template} onChange={set('template')} hint="Cria áreas e subáreas iniciais (você pode editar tudo depois).">
          <option value="medicina">Medicina (residência / ENAMED)</option>
          <option value="vazio">Começar do zero (outra área)</option>
        </Select>
        <Input label="Código de convite do grupo (opcional)" placeholder="Ex.: K7M2Q9XA" value={form.inviteCode} onChange={set('inviteCode')} />
        {error && <p className="rounded-xl bg-crit-wash px-3 py-2 text-sm text-crit-text">{error}</p>}
        <Button type="submit" loading={loading} className="w-full">
          Criar conta
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-ink2">
        Já tem conta?{' '}
        <Link to="/entrar" state={location.state} className="font-medium text-accent">
          Entrar
        </Link>
      </p>
    </AuthShell>
  );
}
