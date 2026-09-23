import { Router } from 'express';
import { currentUser, today } from '../../middleware/auth.js';
import { computeInsights } from '../insights/insights.service.js';
import { dashboard } from './dashboard.service.js';

export const dashboardRouter = Router();

dashboardRouter.get('/', async (req, res) => {
  res.json(await dashboard(currentUser(req).id, today(req)));
});

dashboardRouter.get('/insights', async (req, res) => {
  res.json(await computeInsights(currentUser(req).id, today(req)));
});
