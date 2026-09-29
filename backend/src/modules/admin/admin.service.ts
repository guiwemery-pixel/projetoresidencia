import type { AccessRole } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { badRequest, forbidden } from '../../lib/errors.js';

// Administração do site (página /admin): quem administra e quem pode criar conta.
// - Administradores: os e-mails da variável PLATFORM_ADMIN_EMAILS (no Vercel) e os
//   cadastrados aqui. Sem nenhum dos dois, a conta mais antiga do site é a
//   administradora (a de quem instalou), para poder entrar e cadastrar os outros.
// - Cadastro: "open" (qualquer pessoa cria conta, o padrão) ou "invite" (só os e-mails
//   cadastrados aqui). Contas que já existem continuam entrando normalmente.

export type SignupMode = 'open' | 'invite';
const SIGNUP_KEY = 'signup';

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function envAdmins() {
  return (process.env.PLATFORM_ADMIN_EMAILS || '')
    .split(/[,;\s]+/)
    .map(normalizeEmail)
    .filter(Boolean);
}

/** Conta mais antiga, administradora enquanto ninguém foi cadastrado como administrador. */
async function bootstrapAdmin() {
  if (envAdmins().length) return null;
  if (await prisma.accessEmail.count({ where: { role: 'ADMIN' } })) return null;
  const first = await prisma.user.findFirst({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { email: true } });
  return first?.email ?? null;
}

export async function isAdmin(emailRaw: string) {
  const email = normalizeEmail(emailRaw);
  if (envAdmins().includes(email)) return true;
  const row = await prisma.accessEmail.findUnique({ where: { email }, select: { role: true } });
  if (row?.role === 'ADMIN') return true;
  return (await bootstrapAdmin()) === email;
}

export async function requireAdmin(email: string) {
  if (!(await isAdmin(email))) throw forbidden('Só os administradores do site podem fazer isso.');
}

export async function signupMode(): Promise<SignupMode> {
  const row = await prisma.siteSetting.findUnique({ where: { key: SIGNUP_KEY } });
  const mode = (row?.value as { mode?: string } | null)?.mode;
  return mode === 'invite' ? 'invite' : 'open';
}

export async function setSignupMode(mode: SignupMode) {
  await prisma.siteSetting.upsert({ where: { key: SIGNUP_KEY }, create: { key: SIGNUP_KEY, value: { mode } }, update: { value: { mode } } });
  return mode;
}

/** Pode criar conta com este e-mail? (cadastro aberto, ou e-mail liberado/administrador) */
export async function canRegister(emailRaw: string) {
  if ((await signupMode()) === 'open') return true;
  const email = normalizeEmail(emailRaw);
  if (envAdmins().includes(email)) return true;
  return !!(await prisma.accessEmail.findUnique({ where: { email }, select: { email: true } }));
}

/** Tudo o que a página de Administração mostra. */
export async function overview() {
  const [rows, users, mode, bootstrap] = await Promise.all([
    prisma.accessEmail.findMany({ orderBy: [{ role: 'asc' }, { email: 'asc' }] }),
    prisma.user.findMany({ orderBy: { createdAt: 'desc' }, select: { name: true, email: true, createdAt: true } }),
    signupMode(),
    bootstrapAdmin(),
  ]);
  const accounts = new Map(users.map((u) => [u.email, u]));
  const env = envAdmins();
  const entry = (email: string, role: AccessRole, source: 'env' | 'site' | 'first', extra: { note?: string | null; createdAt?: Date } = {}) => ({
    email,
    role,
    source,
    note: extra.note ?? null,
    addedAt: extra.createdAt ?? null,
    account: accounts.has(email) ? { name: accounts.get(email)!.name, createdAt: accounts.get(email)!.createdAt } : null,
  });
  const admins = [
    ...env.map((e) => entry(e, 'ADMIN', 'env')),
    ...rows.filter((r) => r.role === 'ADMIN' && !env.includes(r.email)).map((r) => entry(r.email, 'ADMIN', 'site', r)),
    ...(bootstrap ? [entry(bootstrap, 'ADMIN', 'first')] : []),
  ];
  const members = rows.filter((r) => r.role === 'MEMBER').map((r) => entry(r.email, 'MEMBER', 'site', r));
  return {
    signup: mode,
    admins,
    members,
    users: users.map((u) => ({ name: u.name, email: u.email, createdAt: u.createdAt })),
  };
}

/** Cadastra (ou muda o papel de) vários e-mails de uma vez: texto com vírgulas, espaços ou linhas. */
export async function addEmails(text: string, role: AccessRole, note: string | null, byUserId: string) {
  const emails = [...new Set(text.split(/[\s,;]+/).map(normalizeEmail).filter(Boolean))];
  if (!emails.length) throw badRequest('Informe pelo menos um e-mail.');
  const invalid = emails.filter((e) => !EMAIL_RE.test(e) || e.length > 160);
  if (invalid.length) throw badRequest(`E-mail inválido: ${invalid.slice(0, 3).join(', ')}`);
  if (emails.length > 500) throw badRequest('No máximo 500 e-mails de uma vez.');
  for (const email of emails) {
    await prisma.accessEmail.upsert({
      where: { email },
      create: { email, role, note, addedById: byUserId },
      update: { role, ...(note !== null ? { note } : {}) },
    });
  }
  return emails.length;
}

/** Tira o e-mail da lista. Nunca deixa o site sem administrador. */
export async function removeEmail(emailRaw: string, byEmail: string) {
  const email = normalizeEmail(emailRaw);
  if (envAdmins().includes(email)) throw badRequest('Este administrador está na variável PLATFORM_ADMIN_EMAILS do Vercel: tire-o de lá.');
  const row = await prisma.accessEmail.findUnique({ where: { email } });
  if (!row) return;
  if (row.role === 'ADMIN') {
    const others = envAdmins().length + (await prisma.accessEmail.count({ where: { role: 'ADMIN', email: { not: email } } }));
    if (!others) throw badRequest('É o único administrador: cadastre outro antes de tirar este.');
    if (email === normalizeEmail(byEmail)) throw badRequest('Você não pode tirar a si mesmo da administração; peça a outro administrador.');
  }
  await prisma.accessEmail.delete({ where: { email } });
}
