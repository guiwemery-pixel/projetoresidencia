import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { User } from '../api/types';
import { useAuth } from '../hooks/useAuth';
import { Button, Input, Select, useToast } from '../components/ui';
import { isCardsPath, isFlashcardsHost } from '../flashcards/standalone';

/** Para onde voltar depois de entrar, e se a pessoa veio pelo app só de flashcards. */
function useReturnTo() {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  return { from, cards: isFlashcardsHost() || isCardsPath(from ?? '') };
}

/** Como o site está configurado: cadastro aberto ou só convidados, e se manda e-mails. */
function useSignupInfo() {
  const [info, setInfo] = useState<{ mode: string; passwordRecovery: boolean } | null>(null);
  useEffect(() => {
    api
      .get<{ mode: string; passwordRecovery?: boolean }>('/auth/signup')
      .then((r) => setInfo({ mode: r.mode, passwordRecovery: !!r.passwordRecovery }))
      .catch(() => {});
  }, []);
  return info;
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
  const info = useSignupInfo();

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
        <div>
          <Input label="Senha" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          {info?.passwordRecovery && (
            <p className="mt-1.5 text-right text-sm">
              <Link to="/esqueci-senha" state={{ ...(location.state as object | null), email }} className="font-medium text-accent">
                Esqueci minha senha
              </Link>
            </p>
          )}
        </div>
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
  const inviteOnly = useSignupInfo()?.mode === 'invite';

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

const linkButton = 'inline-flex w-full items-center justify-center rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-strong';
const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

/** "Esqueci minha senha": manda o link para criar uma nova. */
export function ForgotPasswordPage() {
  const location = useLocation();
  const { cards } = useReturnTo();
  const [email, setEmail] = useState((location.state as { email?: string } | null)?.email ?? '');
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(email.trim());
    } catch (err) {
      setError(errorText(err, 'Não foi possível enviar agora. Tente de novo em alguns minutos.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell cards={cards} title="Esqueci minha senha" subtitle="Enviamos um link para o seu e-mail. Com ele você cria uma senha nova.">
      {sent ? (
        <div className="space-y-3 text-sm text-ink2" role="status">
          <p className="rounded-xl bg-accent-wash px-3 py-2 text-ink">
            Se existir uma conta com <strong className="break-all">{sent}</strong>, o link para criar uma nova senha já está a caminho.
          </p>
          <p>O link vale por 1 hora. Não chegou em alguns minutos? Confira a caixa de spam e as abas Promoções/Atualizações, ou peça de novo.</p>
          <Button variant="secondary" className="w-full" onClick={() => setSent(null)}>
            Pedir de novo
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Input label="E-mail da sua conta" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          {error && <p className="rounded-xl bg-crit-wash px-3 py-2 text-sm text-crit-text">{error}</p>}
          <Button type="submit" loading={loading} className="w-full">
            Enviar link
          </Button>
        </form>
      )}
      <p className="mt-4 text-center text-sm text-ink2">
        Lembrou a senha?{' '}
        <Link to="/entrar" state={location.state} className="font-medium text-accent">
          Entrar
        </Link>
      </p>
    </AuthShell>
  );
}

/** Link do e-mail "Crie uma nova senha": confere o link, troca a senha e já entra. */
export function ResetPasswordPage() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [link, setLink] = useState<{ email?: string; error?: string } | null>(null);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) {
      setLink({ error: 'O endereço está incompleto. Abra o link direto do e-mail, ou peça um novo.' });
      return;
    }
    api
      .post<{ email: string }>('/auth/reset-password/check', { token })
      .then((r) => setLink({ email: r.email }))
      .catch((err) => setLink({ error: errorText(err, 'Não foi possível conferir o link.') }));
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== repeat) {
      setError('As duas senhas não são iguais.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { user } = await api.post<{ user: User }>('/auth/reset-password', { token, password });
      setUser(user);
      toast.success('Senha nova criada. Você já entrou na sua conta.');
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorText(err, 'Não foi possível trocar a senha.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell title="Criar nova senha" subtitle={link?.email ? `Para a conta ${link.email}` : 'Escolha uma senha nova para a sua conta.'}>
      {!link ? (
        <p className="text-sm text-ink2">Conferindo o link…</p>
      ) : link.error ? (
        <div className="space-y-3">
          <p className="rounded-xl bg-crit-wash px-3 py-2 text-sm text-crit-text">{link.error}</p>
          <Link to="/esqueci-senha" className={linkButton}>
            Pedir um link novo
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {/* Ajuda o gerenciador de senhas a salvar a senha nova na conta certa */}
          <input type="email" autoComplete="username" value={link.email} readOnly hidden />
          <Input label="Nova senha" type="password" autoComplete="new-password" required minLength={8} hint="Mínimo de 8 caracteres." value={password} onChange={(e) => setPassword(e.target.value)} />
          <Input label="Repita a nova senha" type="password" autoComplete="new-password" required minLength={8} value={repeat} onChange={(e) => setRepeat(e.target.value)} />
          {error && <p className="rounded-xl bg-crit-wash px-3 py-2 text-sm text-crit-text">{error}</p>}
          <Button type="submit" loading={loading} className="w-full">
            Salvar e entrar
          </Button>
          <p className="text-xs text-muted">Por segurança, a sua conta sai dos outros aparelhos onde estava aberta.</p>
        </form>
      )}
    </AuthShell>
  );
}

/** Link do e-mail "Confirme seu e-mail": funciona com ou sem login, em qualquer aparelho. */
export function ConfirmEmailPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [result, setResult] = useState<{ email?: string; error?: string } | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!token) {
      setResult({ error: 'O endereço está incompleto. Abra o link direto do e-mail.' });
      return;
    }
    api
      .post<{ email: string }>('/auth/verify-email', { token })
      .then((r) => {
        setResult({ email: r.email });
        qc.invalidateQueries({ queryKey: ['me'] });
      })
      .catch((err) => setResult({ error: errorText(err, 'Não foi possível confirmar o e-mail.') }));
  }, [token, qc]);

  return (
    <AuthShell title="Confirmar e-mail" subtitle="Assim você consegue recuperar a senha e recebe os avisos da sua conta.">
      {!result ? (
        <p className="text-sm text-ink2">Confirmando…</p>
      ) : result.error ? (
        <div className="space-y-3">
          <p className="rounded-xl bg-crit-wash px-3 py-2 text-sm text-crit-text">{result.error}</p>
          <p className="text-sm text-ink2">{user ? 'Peça um link novo no aviso amarelo no alto do site.' : 'Entre na sua conta para pedir um link novo.'}</p>
          <Link to={user ? '/' : '/entrar'} className={linkButton}>
            {user ? 'Ir para o início' : 'Entrar'}
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="rounded-xl bg-good-wash px-3 py-2 text-sm text-ink" role="status">
            Pronto! O e-mail <strong className="break-all">{result.email}</strong> está confirmado.
          </p>
          <Link to={user ? '/' : '/entrar'} className={linkButton}>
            {user ? 'Ir para o início' : 'Entrar'}
          </Link>
        </div>
      )}
    </AuthShell>
  );
}
