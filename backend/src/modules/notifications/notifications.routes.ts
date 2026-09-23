import { Router } from 'express';
import { z } from 'zod';
import { id, parse } from '../../lib/validation.js';
import { currentUser, today } from '../../middleware/auth.js';
import * as svc from './notifications.service.js';

export const notificationsRouter = Router();

notificationsRouter.get('/', async (req, res) => {
  const opts = parse(
    z.object({
      unreadOnly: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      refresh: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
    }),
    req.query,
  );
  if (opts.refresh) await svc.generateNotifications(currentUser(req).id, today(req));
  res.json(await svc.listNotifications(currentUser(req).id, opts));
});

notificationsRouter.post('/read', async (req, res) => {
  const { ids } = parse(z.object({ ids: z.union([z.literal('all'), z.array(id).max(200)]) }), req.body);
  await svc.markRead(currentUser(req).id, ids);
  res.status(204).end();
});
