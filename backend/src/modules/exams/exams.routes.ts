import { Router } from 'express';
import { z } from 'zod';
import { dateString, id, optionalText, parse } from '../../lib/validation.js';
import { currentUser, today } from '../../middleware/auth.js';
import * as svc from './exams.service.js';

export const examsRouter = Router();

const boardName = z.object({ name: z.string().trim().min(1, 'Informe o nome da banca').max(80) });
const fileUrl = z
  .string()
  .trim()
  .max(500)
  .url('Link inválido')
  .refine((u) => /^https?:\/\//.test(u), 'Use um link http(s)')
  .nullish();
const examFields = {
  boardId: id,
  name: z.string().trim().min(1, 'Informe o nome da prova').max(120),
  year: z.number().int().min(1990).max(2100).nullish(),
  totalQuestions: z.number().int().min(1).max(1000).nullish(),
  fileUrl,
  notes: optionalText(),
};

examsRouter.get('/boards', async (req, res) => {
  res.json(await svc.listBoards(currentUser(req).id));
});

examsRouter.post('/boards', async (req, res) => {
  const { name } = parse(boardName, req.body);
  res.status(201).json(await svc.createBoard(currentUser(req).id, name));
});

examsRouter.patch('/boards/:id', async (req, res) => {
  const { name } = parse(boardName, req.body);
  res.json(await svc.renameBoard(currentUser(req).id, req.params.id, name));
});

examsRouter.delete('/boards/:id', async (req, res) => {
  await svc.deleteBoard(currentUser(req).id, req.params.id);
  res.status(204).end();
});

examsRouter.post('/', async (req, res) => {
  const input = parse(z.object(examFields), req.body);
  res.status(201).json(await svc.createExam(currentUser(req).id, input));
});

examsRouter.patch('/:id', async (req, res) => {
  const input = parse(z.object(examFields).partial(), req.body);
  res.json(await svc.updateExam(currentUser(req).id, req.params.id, input));
});

examsRouter.delete('/:id', async (req, res) => {
  await svc.deleteExam(currentUser(req).id, req.params.id);
  res.status(204).end();
});

examsRouter.post('/:id/attempts', async (req, res) => {
  const input = parse(
    z
      .object({
        takenOn: dateString,
        totalQuestions: z.number().int().min(1).max(1000),
        correct: z.number().int().min(0).max(1000),
        durationMinutes: z.number().int().min(0).max(1440).nullish(),
        notes: optionalText(),
      })
      .refine((v) => v.correct <= v.totalQuestions, { message: 'Acertos não podem ser maiores que o total', path: ['correct'] }),
    req.body,
  );
  res.status(201).json(await svc.createAttempt(currentUser(req).id, req.params.id, input, today(req)));
});

examsRouter.delete('/attempts/:id', async (req, res) => {
  await svc.deleteAttempt(currentUser(req).id, req.params.id);
  res.status(204).end();
});
