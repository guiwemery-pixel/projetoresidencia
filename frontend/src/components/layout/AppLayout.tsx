import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  ClipboardList,
  FileText,
  FolderTree,
  Home,
  Layers,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Plus,
  RefreshCcw,
  Search,
  Sun,
  Target,
  Trophy,
  User as UserIcon,
  Users,
  X,
} from 'lucide-react';
import { api } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { useNotifications, keys } from '../../hooks/api';
import { useTheme, type ThemeChoice } from '../../hooks/useTheme';
import { fmtRelative } from '../../lib/format';
import { useStudyDialog } from '../study/StudyDialog';
import { Avatar, IconButton, cx } from '../ui';

const NAV = [
  { to: '/', label: 'Início', icon: Home, end: true },
  { to: '/revisoes', label: 'Revisões', icon: RefreshCcw },
  { to: '/calendario', label: 'Calendário', icon: CalendarDays },
  { to: '/metricas', label: 'Métricas', icon: BarChart3 },
  { to: '/estudos', label: 'Estudos', icon: BookOpen },
  { to: '/assuntos', label: 'Áreas e assuntos', icon: FolderTree },
  { to: '/metas', label: 'Metas', icon: Target },
  { to: '/simulados', label: 'Simulados', icon: Trophy },
  { to: '/provas', label: 'Provas', icon: FileText },
  { to: '/grupo', label: 'Grupo', icon: Users },
];

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Navegação principal">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cx(
              'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition',
              isActive ? 'bg-accent-wash text-ink' : 'text-ink2 hover:bg-subtle hover:text-ink',
            )
          }
        >
          {({ isActive }) => (
            <>
              <Icon className="h-4 w-4" style={isActive ? { color: 'var(--accent)' } : undefined} />
              {label}
            </>
          )}
        </NavLink>
      ))}
      {/* App de flashcards (estático, dados no próprio navegador): página separada */}
      <a
        href="/flashcards/index.html"
        onClick={onNavigate}
        className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-ink2 transition hover:bg-subtle hover:text-ink"
      >
        <Layers className="h-4 w-4" />
        Flashcards
      </a>
    </nav>
  );
}

const THEMES: { value: ThemeChoice; label: string; icon: ReactNode }[] = [
  { value: 'light', label: 'Claro', icon: <Sun className="h-4 w-4" /> },
  { value: 'dark', label: 'Escuro', icon: <Moon className="h-4 w-4" /> },
  { value: 'system', label: 'Sistema', icon: <Monitor className="h-4 w-4" /> },
];

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const next = THEMES[(THEMES.findIndex((t) => t.value === theme) + 1) % THEMES.length];
  const current = THEMES.find((t) => t.value === theme)!;
  return (
    <IconButton label={`Tema: ${current.label} (mudar para ${next.label})`} onClick={() => setTheme(next.value)}>
      {current.icon}
    </IconButton>
  );
}

function GlobalSearch({ className }: { className?: string }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  return (
    <form
      role="search"
      className={cx('relative', className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim().length >= 2) navigate(`/busca?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <input className="input h-9 pl-9" placeholder="Pesquisar assuntos, simulados, metas…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Pesquisa global" />
    </form>
  );
}

function NotificationsBell() {
  const { data } = useNotifications();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const markAll = useMutation({
    mutationFn: () => api.post('/notifications/read', { ids: 'all' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notifications }),
  });
  useEffect(() => {
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  const unread = data?.unread ?? 0;
  return (
    <div className="relative" ref={ref}>
      <IconButton label={`Notificações${unread ? ` (${unread} não lidas)` : ''}`} onClick={() => setOpen((v) => !v)}>
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-crit px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </IconButton>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface shadow-pop">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <p className="text-sm font-semibold text-ink">Notificações</p>
            {unread > 0 && (
              <button className="text-xs font-medium text-accent" onClick={() => markAll.mutate()}>
                Marcar todas como lidas
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {(data?.items ?? []).map((n) => (
              <li key={n.id}>
                <button
                  className={cx('flex w-full gap-3 border-b border-line px-4 py-3 text-left last:border-0 hover:bg-subtle', !n.readAt && 'bg-accent-wash')}
                  onClick={() => {
                    setOpen(false);
                    api.post('/notifications/read', { ids: [n.id] }).then(() => qc.invalidateQueries({ queryKey: keys.notifications }));
                    if (n.link) navigate(n.link);
                  }}
                >
                  <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-accent')} aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-sm text-ink">{n.title}</span>
                    {n.body && <span className="block text-xs text-ink2">{n.body}</span>}
                    <span className="mt-0.5 block text-[11px] text-muted">{fmtRelative(n.createdAt)}</span>
                  </span>
                </button>
              </li>
            ))}
            {!data?.items.length && <li className="px-4 py-8 text-center text-sm text-muted">🔔 Nenhuma notificação por enquanto.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  return (
    <div className="flex items-center gap-1">
      <NavLink to="/perfil" className="flex items-center gap-2 rounded-xl px-1.5 py-1 hover:bg-subtle" aria-label="Meu perfil">
        <Avatar name={user.name} src={user.avatar} size={30} />
        <span className="hidden text-sm font-medium text-ink xl:inline">{user.name.split(' ')[0]}</span>
      </NavLink>
      <IconButton
        label="Sair"
        className="hidden lg:inline-flex"
        onClick={async () => {
          await logout();
          navigate('/entrar');
        }}
      >
        <LogOut className="h-4 w-4" />
      </IconButton>
    </div>
  );
}

export function AppLayout() {
  const openStudy = useStudyDialog();
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  const { logout } = useAuth();
  const navigate = useNavigate();
  useEffect(() => setDrawer(false), [location.pathname]);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      {/* Barra lateral (desktop) */}
      <aside className="sticky top-0 hidden h-screen flex-col gap-4 border-r border-line bg-surface px-3 py-4 lg:flex">
        <NavLink to="/" className="flex items-center gap-2 px-2">
          <img src="/icons/mark-128.png" alt="" className="h-8 w-8 rounded-lg" />
          <span className="font-semibold text-ink">Projeto Residente</span>
        </NavLink>
        <button
          onClick={() => openStudy()}
          className="flex items-center justify-center gap-2 rounded-xl bg-accent px-3 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-accent-strong"
        >
          <Plus className="h-4 w-4" /> Registrar estudo
        </button>
        <NavItems />
        <div className="mt-auto">
          <NavLink
            to="/perfil"
            className={({ isActive }) => cx('flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium', isActive ? 'bg-accent-wash text-ink' : 'text-ink2 hover:bg-subtle')}
          >
            <UserIcon className="h-4 w-4" /> Perfil e configurações
          </NavLink>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        {/* Topo */}
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-page px-4 py-2.5 backdrop-blur sm:px-6">
          <IconButton label="Abrir menu" className="lg:hidden" onClick={() => setDrawer(true)}>
            <Menu className="h-5 w-5" />
          </IconButton>
          <NavLink to="/" className="flex items-center gap-2 lg:hidden" aria-label="Projeto Residente — início">
            <img src="/icons/mark-128.png" alt="" className="h-7 w-7 rounded-lg" />
          </NavLink>
          <GlobalSearch className="hidden max-w-md flex-1 sm:block" />
          <div className="ml-auto flex items-center gap-1">
            <IconButton label="Pesquisar" className="sm:hidden" onClick={() => navigate('/busca')}>
              <Search className="h-4 w-4" />
            </IconButton>
            <ThemeToggle />
            <NotificationsBell />
            <UserMenu />
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-5 sm:px-6 lg:pb-10">
          <Outlet />
        </main>
      </div>

      {/* Navegação inferior (celular) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Navegação rápida">
        {[
          { to: '/', label: 'Início', icon: Home, end: true },
          { to: '/revisoes', label: 'Revisões', icon: RefreshCcw },
        ].map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => cx('flex flex-col items-center gap-0.5 py-2 text-[11px]', isActive ? 'text-accent' : 'text-ink2')}>
            <Icon className="h-5 w-5" />
            {label}
          </NavLink>
        ))}
        <button onClick={() => openStudy()} className="flex flex-col items-center justify-center" aria-label="Registrar estudo">
          <span className="-mt-6 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-white shadow-pop">
            <Plus className="h-6 w-6" />
          </span>
        </button>
        <NavLink to="/calendario" className={({ isActive }) => cx('flex flex-col items-center gap-0.5 py-2 text-[11px]', isActive ? 'text-accent' : 'text-ink2')}>
          <CalendarDays className="h-5 w-5" />
          Calendário
        </NavLink>
        <button onClick={() => setDrawer(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-ink2">
          <ClipboardList className="h-5 w-5" />
          Mais
        </button>
      </nav>

      {/* Menu lateral (celular/tablet) */}
      {drawer && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setDrawer(false)}>
          <div className="flex h-full w-72 flex-col gap-4 overflow-y-auto bg-surface p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 font-semibold text-ink">
                <img src="/icons/mark-128.png" alt="" className="h-7 w-7 rounded-lg" /> Projeto Residente
              </span>
              <IconButton label="Fechar menu" onClick={() => setDrawer(false)}>
                <X className="h-5 w-5" />
              </IconButton>
            </div>
            <NavItems onNavigate={() => setDrawer(false)} />
            <div className="mt-auto flex flex-col gap-1 border-t border-line pt-3">
              <NavLink to="/perfil" className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-ink2 hover:bg-subtle">
                <UserIcon className="h-4 w-4" /> Perfil e configurações
              </NavLink>
              <button
                className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-ink2 hover:bg-subtle"
                onClick={async () => {
                  await logout();
                  navigate('/entrar');
                }}
              >
                <LogOut className="h-4 w-4" /> Sair
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
