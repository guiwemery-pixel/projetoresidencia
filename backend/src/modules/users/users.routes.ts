import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { badRequest, unauthorized } from '../../lib/errors.js';
import { parse } from '../../lib/validation.js';
import { currentUser, today } from '../../middleware/auth.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { SESSION_COOKIE, destroyOtherSessions, sessionCookieOptions } from '../auth/session.js';
import { computeProgress } from '../progress/progress.service.js';
import { exportUserData, resetProgress, toPrivateUser } from './users.service.js';

export const usersRouter = Router();

const MAX_AVATAR_BYTES = 150_000;
const avatarSchema = z
  .string()
  .max(MAX_AVATAR_BYTES, 'Imagem muito grande (máx. ~100 KB)')
  .refine(
    (v) => /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v) || /^https:\/\/\S+$/.test(v),
    'Avatar deve ser uma imagem PNG/JPEG/WebP ou um link https',
  )
  .nullable();

const isValidTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

// Organização da página inicial (ids dos "balões" definidos pelo frontend)
const widgetId = z.string().regex(/^[a-z][a-z-]{0,29}$/);
const dashboardLayoutSchema = z
  .object({ main: z.array(widgetId).max(30), side: z.array(widgetId).max(30), hidden: z.array(widgetId).max(30) })
  .refine((l) => {
    const all = [...l.main, ...l.side, ...l.hidden];
    return new Set(all).size === all.length && all.length <= 30;
  }, 'Organização inválida');

const profileSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  avatar: avatarSchema.optional(),
  timezone: z.string().max(64).refine(isValidTimeZone, 'Fuso horário inválido').optional(),
  shareProgress: z.boolean().optional(),
  weeklyStudyHoursTarget: z.number().int().min(1).max(100).optional(),
  weeklyStudyDaysTarget: z.number().int().min(1).max(7).optional(),
  dailyQuestionsTarget: z.number().int().min(0).max(1000).optional(),
  dashboardLayout: dashboardLayoutSchema.nullable().optional(),
});

usersRouter.patch('/', async (req, res) => {
  const { dashboardLayout, ...rest } = parse(profileSchema, req.body);
  const user = await prisma.user.update({
    where: { id: currentUser(req).id },
    data: {
      ...rest,
      ...(dashboardLayout !== undefined ? { dashboardLayout: dashboardLayout ?? Prisma.DbNull } : {}),
    },
  });
  res.json({ user: toPrivateUser(user) });
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'A nova senha deve ter pelo menos 8 caracteres').max(128),
});

usersRouter.post('/password', async (req, res) => {
  const { currentPassword, newPassword } = parse(passwordSchema, req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: currentUser(req).id } });
  if (!(await verifyPassword(currentPassword, user.passwordHash))) throw unauthorized('Senha atual incorreta');
  if (currentPassword === newPassword) throw badRequest('A nova senha deve ser diferente da atual');
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword) } });
  // Encerra as outras sessões (outros dispositivos)
  await destroyOtherSessions(user.id, req.sessionId);
  res.status(204).end();
});

/** Indicador de progresso detalhado — visível apenas para o próprio usuário. */
usersRouter.get('/progress', async (req, res) => {
  res.json(await computeProgress(currentUser(req).id, today(req)));
});

usersRouter.get('/export', async (req, res) => {
  const data = await exportUserData(currentUser(req).id);
  res.setHeader('Content-Disposition', `attachment; filename="meus-dados-${today(req)}.json"`);
  res.json(data);
});

/** Apaga o progresso (ou tudo, voltando ao modelo inicial) sem excluir a conta. */
usersRouter.post('/reset', async (req, res) => {
  const { password, scope } = parse(z.object({ password: z.string().min(1), scope: z.enum(['progress', 'everything']).default('progress') }), req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: currentUser(req).id } });
  if (!(await verifyPassword(password, user.passwordHash))) throw unauthorized('Senha incorreta');
  res.json(await resetProgress(user.id, scope));
});

usersRouter.delete('/', async (req, res) => {
  const { password } = parse(z.object({ password: z.string().min(1) }), req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: currentUser(req).id } });
  if (!(await verifyPassword(password, user.passwordHash))) throw unauthorized('Senha incorreta');
  await prisma.user.delete({ where: { id: user.id } });
  res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
  res.status(204).end();
});
