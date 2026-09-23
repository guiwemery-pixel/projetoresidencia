import { Router } from 'express';
import { z } from 'zod';
import { dateString, id, parse } from '../../lib/validation.js';
import { currentUser, today } from '../../middleware/auth.js';
import { getSchedulerConfig } from './algorithm-config.js';
import * as svc from './reviews.service.js';

export const reviewsRouter = Router();

reviewsRouter.get('/', async (req, res) => {
  const opts = parse(
    z.object({
      status: z.enum(['PENDING', 'DONE']).optional(),
      from: dateString.optional(),
      to: dateString.optional(),
      subjectId: id.optional(),
      limit: z.coerce.number().int().min(1).max(1000).optional(),
      order: z.enum(['asc', 'desc']).optional(),
    }),
    req.query,
  );
  res.json(await svc.listReviews(currentUser(req).id, opts));
});

reviewsRouter.get('/agenda', async (req, res) => {
  const { days } = parse(z.object({ days: z.coerce.number().int().min(0).max(60).optional() }), req.query);
  res.json(await svc.reviewAgenda(currentUser(req).id, today(req), days ?? 7));
});

reviewsRouter.get('/calendar', async (req, res) => {
  const { month } = parse(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }), req.query);
  res.json(await svc.reviewCalendar(currentUser(req).id, month, today(req)));
});

/** Parâmetros ativos do algoritmo — transparência total para o usuário. */
reviewsRouter.get('/algorithm', async (_req, res) => {
  res.json(await getSchedulerConfig());
});

reviewsRouter.get('/:id', async (req, res) => {
  res.json(await svc.getReview(currentUser(req).id, req.params.id));
});

reviewsRouter.patch('/:id/reschedule', async (req, res) => {
  const { date } = parse(z.object({ date: dateString }), req.body);
  res.json(await svc.rescheduleReview(currentUser(req).id, req.params.id, date, today(req)));
});
