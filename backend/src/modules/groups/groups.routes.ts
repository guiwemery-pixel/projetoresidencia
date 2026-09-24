import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { optionalText, parse } from '../../lib/validation.js';
import { currentUser } from '../../middleware/auth.js';
import * as svc from './groups.service.js';

export const groupsRouter = Router();

const groupFields = { name: z.string().trim().min(2, 'Informe o nome do grupo').max(80), description: optionalText(300) };

groupsRouter.get('/', async (req, res) => {
  res.json(await svc.listMyGroups(currentUser(req).id));
});

groupsRouter.post('/', async (req, res) => {
  const input = parse(z.object(groupFields), req.body);
  res.status(201).json(await svc.createGroup(currentUser(req).id, input));
});

// Limita tentativas de código de convite (evita força bruta)
const joinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'Muitas tentativas. Aguarde alguns minutos.' },
});

groupsRouter.post('/join', joinLimiter, async (req, res) => {
  const { code } = parse(z.object({ code: z.string().trim().min(4).max(16) }), req.body);
  const group = await svc.joinGroupByCode(currentUser(req).id, code);
  res.status(201).json({ id: group.id, name: group.name });
});

groupsRouter.get('/:id', async (req, res) => {
  res.json(await svc.groupBoard(currentUser(req).id, req.params.id));
});

groupsRouter.patch('/:id', async (req, res) => {
  const input = parse(z.object(groupFields).partial(), req.body);
  res.json(await svc.updateGroup(currentUser(req).id, req.params.id, input));
});

groupsRouter.put('/:id/favorite', async (req, res) => {
  const { favorite } = parse(z.object({ favorite: z.boolean() }), req.body);
  res.json(await svc.setFavorite(currentUser(req).id, req.params.id, favorite));
});

groupsRouter.post('/:id/invite', async (req, res) => {
  const g = await svc.regenerateInvite(currentUser(req).id, req.params.id);
  res.json({ inviteCode: g.inviteCode });
});

groupsRouter.post('/:id/leave', async (req, res) => {
  await svc.leaveGroup(currentUser(req).id, req.params.id);
  res.status(204).end();
});

groupsRouter.delete('/:id/members/:userId', async (req, res) => {
  await svc.removeMember(currentUser(req).id, req.params.id, req.params.userId);
  res.status(204).end();
});
