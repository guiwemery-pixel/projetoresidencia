import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { parse } from '../../lib/validation.js';
import { requireAuth } from '../../middleware/auth.js';
import { sessionUser } from '../users/users.service.js';
import { prisma } from '../../lib/prisma.js';
import { login, register } from './auth.service.js';
import { signupMode } from '../admin/admin.service.js';
import { SESSION_COOKIE, createSession, destroySession, sessionCookieOptions } from './session.js';
import { checkResetLink, confirmEmail, notifyPasswordChanged, requestPasswordReset, resetPassword, sendEmailConfirmation, siteUrl, tooSoon } from './email-links.service.js';
import { mailEnabled } from '../mail/mailer.js';
import { HttpError } from '../../lib/errors.js';
import { TEMPLATE_KEYS } from '../taxonomy/templates/index.js';

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
});

// Pedidos que mandam e-mail: limite menor (evita usar o site para encher a caixa de alguém)
const mailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'Muitos pedidos de e-mail. Aguarde um pouco e tente novamente.' },
});

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome').max(80),
  email: z.string().trim().email('E-mail inválido').max(160),
  password: z.string().min(8, 'A senha deve ter pelo menos 8 caracteres').max(128),
  timezone: z.string().max(64).optional(),
  template: z.enum(TEMPLATE_KEYS).default('medicina'),
  inviteCode: z.string().trim().max(16).nullish(),
});

const loginSchema = z.object({
  email: z.string().trim().email().max(160),
  password: z.string().min(1).max(128),
});

/**
 * Cadastro aberto ou só para e-mails liberados (a tela de criar conta avisa) e se o site
 * manda e-mails (sem isso a tela de entrar não mostra "Esqueci minha senha").
 */
authRouter.get('/signup', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ mode: await signupMode(), passwordRecovery: mailEnabled() });
});

authRouter.post('/register', authLimiter, async (req, res) => {
  const input = parse(registerSchema, req.body);
  const user = await register(input);
  const token = await createSession(user.id, req.get('user-agent'));
  // Link para confirmar o e-mail (se falhar, a conta já existe: a pessoa pede de novo pelo aviso no site)
  if (mailEnabled()) await sendEmailConfirmation(user, siteUrl(req)).catch((err) => console.error('Confirmação de e-mail no cadastro falhou', err));
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
  res.status(201).json({ user: await sessionUser(user) });
});

authRouter.post('/login', authLimiter, async (req, res) => {
  const { email, password } = parse(loginSchema, req.body);
  const user = await login(email, password);
  const token = await createSession(user.id, req.get('user-agent'));
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
  res.json({ user: await sessionUser(user) });
});

authRouter.post('/logout', async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) await destroySession(token);
  res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
  res.status(204).end();
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  res.json({ user: await sessionUser(user) });
});

const tokenSchema = z.object({ token: z.string().min(1).max(200) });
const requireMail = () => {
  if (!mailEnabled()) throw new HttpError(503, 'O envio de e-mails ainda não foi configurado neste site. Fale com o administrador.');
};

/** Manda de novo o link de confirmação para o e-mail da conta. */
authRouter.post('/verify-email/send', mailLimiter, requireAuth, async (req, res) => {
  requireMail();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  const result = await sendEmailConfirmation(user, siteUrl(req));
  if (result === 'too-soon') throw tooSoon();
  if (result === 'failed') throw new HttpError(502, 'Não conseguimos enviar o e-mail agora. Tente de novo em alguns minutos.');
  res.json({ result, email: user.email });
});

/** Link do e-mail de confirmação (funciona sem estar logado, em qualquer aparelho). */
authRouter.post('/verify-email', authLimiter, async (req, res) => {
  const { token } = parse(tokenSchema, req.body);
  res.json(await confirmEmail(token));
});

/** "Esqueci minha senha": a resposta é sempre a mesma, exista ou não a conta. */
authRouter.post('/forgot-password', mailLimiter, async (req, res) => {
  requireMail();
  const { email } = parse(z.object({ email: z.string().trim().email('E-mail inválido').max(160) }), req.body);
  await requestPasswordReset(email, siteUrl(req));
  res.json({ ok: true });
});

/** Confere o link de nova senha antes de a pessoa digitar (vencido, já usado…). */
authRouter.post('/reset-password/check', authLimiter, async (req, res) => {
  const { token } = parse(tokenSchema, req.body);
  res.json(await checkResetLink(token));
});

/** Nova senha pelo link: encerra as sessões abertas e já entra no site. */
authRouter.post('/reset-password', authLimiter, async (req, res) => {
  const { token, password } = parse(
    tokenSchema.extend({ password: z.string().min(8, 'A senha deve ter pelo menos 8 caracteres').max(128) }),
    req.body,
  );
  const user = await resetPassword(token, password);
  await notifyPasswordChanged(user, siteUrl(req));
  const session = await createSession(user.id, req.get('user-agent'));
  res.cookie(SESSION_COOKIE, session, sessionCookieOptions());
  res.json({ user: await sessionUser(user) });
});
