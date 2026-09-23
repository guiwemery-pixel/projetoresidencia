import { Router } from 'express';
import { z } from 'zod';
import { addDays, diffDays } from '../../lib/dates.js';
import { badRequest } from '../../lib/errors.js';
import { dateString, id, parse } from '../../lib/validation.js';
import { currentUser, today } from '../../middleware/auth.js';
import * as svc from './metrics.service.js';

export const metricsRouter = Router();

const rangeSchema = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
  days: z.coerce.number().int().min(1).max(730).optional(),
});

function range(req: Parameters<Parameters<typeof metricsRouter.get>[1]>[0]) {
  const q = parse(rangeSchema, req.query);
  const t = today(req);
  const to = q.to ?? t;
  const from = q.from ?? addDays(to, -((q.days ?? 30) - 1));
  if (from > to) throw badRequest('Período inválido');
  if (diffDays(from, to) > 730) throw badRequest('Período máximo de 2 anos');
  return { from, to, today: t };
}

metricsRouter.get('/overview', async (req, res) => {
  const { from, to, today: t } = range(req);
  res.json(await svc.overview(currentUser(req).id, from, to, t));
});

metricsRouter.get('/timeseries', async (req, res) => {
  const { from, to } = range(req);
  const { granularity } = parse(z.object({ granularity: z.enum(['day', 'week', 'month']).optional() }), {
    granularity: req.query.granularity,
  });
  const g = granularity ?? (diffDays(from, to) > 120 ? 'month' : diffDays(from, to) > 31 ? 'week' : 'day');
  res.json({ granularity: g, from, to, buckets: await svc.timeseries(currentUser(req).id, from, to, g) });
});

metricsRouter.get('/by-area', async (req, res) => {
  const { from, to } = range(req);
  res.json(await svc.byArea(currentUser(req).id, from, to));
});

metricsRouter.get('/by-subject', async (req, res) => {
  const { from, to } = range(req);
  const { areaId } = parse(z.object({ areaId: id.optional() }), { areaId: req.query.areaId });
  res.json(await svc.bySubject(currentUser(req).id, from, to, areaId));
});
