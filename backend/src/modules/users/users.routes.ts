import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { badRequest, unauthorized } from '../../lib/errors.js';
import { parse } from '../../lib/validation.js';
import { currentUser, today } from '../../middleware/auth.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { SESSION_COOKIE, destroyOtherSessions, sessionCookieOptions } from '../auth/session.js';
import { computeProgress } from '../progress/progress.service.js';
import { exportUserData, toPrivateUser } from './users.service.js';

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

const profileSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  avatar: avatarSchema.optional(),
  timezone: z.string().max(64).refine(isValidTimeZone, 'Fuso horário inválido').optional(),
  shareProgress: z.boolean().optional(),
  weeklyStudyHoursTarget: z.number().int().min(1).max(100).optional(),
  weeklyStudyDaysTarget: z.number().int().min(1).max(7).optional(),
  dailyQuestionsTarget: z.number().int().min(0).max(1000).optional(),
});

usersRouter.patch('/', async (req, res) => {
  const data = parse(profileSchema, req.body);
  const user = await prisma.user.update({ where: { id: currentUser(req).id }, data });
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

usersRouter.delete('/', async (req, res) => {
  const { password } = parse(z.object({ password: z.string().min(1) }), req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: currentUser(req).id } });
  if (!(await verifyPassword(password, user.passwordHash))) throw unauthorized('Senha incorreta');
  await prisma.user.delete({ where: { id: user.id } });
  res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
  res.status(204).end();
});
