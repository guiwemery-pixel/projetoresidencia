import { Router } from 'express';
import { z } from 'zod';
import { parse } from '../../lib/validation.js';
import { currentUser } from '../../middleware/auth.js';
import { addEmails, overview, removeEmail, requireAdmin, setFreeAccess, setSignupMode } from './admin.service.js';

// Página "Administração" (/admin): só para administradores do site
export const adminRouter = Router();

adminRouter.use(async (req, _res, next) => {
  try {
    await requireAdmin(currentUser(req).email);
    next();
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await overview());
});

const addSchema = z.object({
  emails: z.string().trim().min(3).max(40_000),
  role: z.enum(['ADMIN', 'MEMBER']).default('MEMBER'),
  note: z.string().trim().max(120).nullish(),
});

adminRouter.post('/emails', async (req, res) => {
  const { emails, role, note } = parse(addSchema, req.body);
  const added = await addEmails(emails, role, note || null, currentUser(req).id);
  res.status(201).json({ added, ...(await overview()) });
});

adminRouter.delete('/emails/:email', async (req, res) => {
  await removeEmail(req.params.email, currentUser(req).email);
  res.json(await overview());
});

adminRouter.put('/signup', async (req, res) => {
  const { mode } = parse(z.object({ mode: z.enum(['open', 'invite']) }), req.body);
  await setSignupMode(mode);
  res.json(await overview());
});

/** Conta gratuita para sempre: não é cobrada quando o site passar a cobrar. */
adminRouter.put('/users/:email/free', async (req, res) => {
  const { free } = parse(z.object({ free: z.boolean() }), req.body);
  await setFreeAccess(req.params.email, free);
  res.json(await overview());
});
