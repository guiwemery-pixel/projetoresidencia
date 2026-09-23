import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { parse } from '../../lib/validation.js';
import { requireAuth } from '../../middleware/auth.js';
import { toPrivateUser } from '../users/users.service.js';
import { prisma } from '../../lib/prisma.js';
import { login, register } from './auth.service.js';
import { SESSION_COOKIE, createSession, destroySession, sessionCookieOptions } from './session.js';
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

authRouter.post('/register', authLimiter, async (req, res) => {
  const input = parse(registerSchema, req.body);
  const user = await register(input);
  const token = await createSession(user.id, req.get('user-agent'));
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
  res.status(201).json({ user: toPrivateUser(user) });
});

authRouter.post('/login', authLimiter, async (req, res) => {
  const { email, password } = parse(loginSchema, req.body);
  const user = await login(email, password);
  const token = await createSession(user.id, req.get('user-agent'));
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
  res.json({ user: toPrivateUser(user) });
});

authRouter.post('/logout', async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) await destroySession(token);
  res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
  res.status(204).end();
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  res.json({ user: toPrivateUser(user) });
});
