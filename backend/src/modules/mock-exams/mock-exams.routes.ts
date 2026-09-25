import { Router } from 'express';
import { z } from 'zod';
import { dateString, id, optionalText, parse } from '../../lib/validation.js';
import { currentUser, today } from '../../middleware/auth.js';
import * as svc from './mock-exams.service.js';

export const mockExamsRouter = Router();

const fields = {
  name: z.string().trim().min(1, 'Informe o nome').max(120),
  board: optionalText(80),
  examName: optionalText(120),
  year: z.number().int().min(1990).max(2100).nullish(),
  takenOn: dateString,
  status: z.enum(['PLANNED', 'DONE']).optional(),
  totalQuestions: z.number().int().min(1).max(1000).nullish(),
  correct: z.number().int().min(0).max(1000).nullish(),
  // Só a nota em %, quando não se sabe a quantidade de questões
  accuracy: z.number().min(0).max(100).nullish(),
  durationMinutes: z.number().int().min(0).max(1440).nullish(),
  notes: optionalText(),
  examId: id.nullish(),
  areaResults: z
    .array(z.object({ areaId: id, total: z.number().int().min(1).max(1000), correct: z.number().int().min(0).max(1000) }))
    .max(50)
    .optional(),
};

mockExamsRouter.get('/', async (req, res) => {
  res.json(await svc.listMockExams(currentUser(req).id));
});

mockExamsRouter.post('/', async (req, res) => {
  const input = parse(z.object(fields), req.body);
  res.status(201).json(await svc.createMockExam(currentUser(req).id, input, today(req)));
});

mockExamsRouter.get('/:id', async (req, res) => {
  res.json(await svc.getMockExam(currentUser(req).id, req.params.id));
});

mockExamsRouter.patch('/:id', async (req, res) => {
  const input = parse(z.object(fields).partial(), req.body);
  res.json(await svc.updateMockExam(currentUser(req).id, req.params.id, input, today(req)));
});

mockExamsRouter.delete('/:id', async (req, res) => {
  await svc.deleteMockExam(currentUser(req).id, req.params.id);
  res.status(204).end();
});
