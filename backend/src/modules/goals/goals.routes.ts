import { Router } from 'express';
import { z } from 'zod';
import { dateString, id, optionalText, parse } from '../../lib/validation.js';
import { currentUser, today } from '../../middleware/auth.js';
import * as svc from './goals.service.js';

export const goalsRouter = Router();

const metric = z.enum([
  'QUESTIONS',
  'CORRECT_ANSWERS',
  'STUDY_MINUTES',
  'STUDY_SESSIONS',
  'STUDY_DAYS',
  'REVIEWS_DONE',
  'MOCK_EXAMS',
  'CLEAR_OVERDUE',
  'CUSTOM',
]);
const period = z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM']);

const fields = {
  title: z.string().trim().min(1, 'Informe um título').max(120),
  description: optionalText(500),
  metric,
  period,
  target: z.number().positive('A quantidade desejada deve ser maior que zero').max(1_000_000),
  areaId: id.nullish(),
  subjectId: id.nullish(),
  startDate: dateString.optional(),
  dueDate: dateString.nullish(),
  manualProgress: z.number().min(0).max(1_000_000).optional(),
};

goalsRouter.get('/', async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['active', 'all']).optional() }), req.query);
  res.json(await svc.listGoals(currentUser(req).id, today(req), { status }));
});

goalsRouter.post('/', async (req, res) => {
  const input = parse(z.object(fields), req.body);
  res.status(201).json(await svc.createGoal(currentUser(req).id, input, today(req)));
});

goalsRouter.patch('/:id', async (req, res) => {
  const input = parse(
    z.object({ ...fields, status: z.enum(['ACTIVE', 'ARCHIVED']).optional() }).partial(),
    req.body,
  );
  res.json(await svc.updateGoal(currentUser(req).id, req.params.id, input, today(req)));
});

goalsRouter.delete('/:id', async (req, res) => {
  await svc.deleteGoal(currentUser(req).id, req.params.id);
  res.status(204).end();
});
