import { Router } from 'express';
import { z } from 'zod';
import { dateString, id, optionalText, parse } from '../../lib/validation.js';
import { currentUser, today } from '../../middleware/auth.js';
import * as svc from './studies.service.js';

export const studiesRouter = Router();

export const METHODS = [
  'TEORIA',
  'QUESTOES',
  'FLASHCARDS',
  'RECALL',
  'REVISAO',
  'AULA',
  'VIDEO',
  'LEITURA',
  'RESUMO',
  'SIMULADO',
  'OUTRO',
] as const;

const questionsSchema = z
  .object({
    total: z.number().int().min(1, 'Informe a quantidade de questões').max(1000),
    correct: z.number().int().min(0).max(1000),
    board: optionalText(80),
    examName: optionalText(120),
    difficulty: z.number().int().min(1).max(3).nullish(),
    timeSpentMinutes: z.number().int().min(0).max(1440).nullish(),
    notes: optionalText(),
  })
  .refine((q) => q.correct <= q.total, { message: 'Acertos não podem ser maiores que o total', path: ['correct'] });

const base = {
  date: dateString,
  durationMinutes: z.number().int().min(0).max(1440),
  methods: z.array(z.enum(METHODS)).min(1, 'Escolha pelo menos um tipo de estudo').max(METHODS.length),
  quality: z.number().int().min(1).max(5).nullish(),
  difficulty: z.number().int().min(1).max(3).nullish(),
  notes: optionalText(),
  questions: questionsSchema.nullish(),
};

const createSchema = z
  .object({
    ...base,
    subjectId: id.optional(),
    newSubject: z
      .object({ areaId: id, name: z.string().trim().min(1).max(120), size: z.enum(['SMALL', 'MEDIUM', 'LARGE']).optional() })
      .optional(),
  })
  .refine((v) => v.subjectId || v.newSubject, { message: 'Escolha ou crie um assunto', path: ['subjectId'] });

const updateSchema = z.object({
  subjectId: id.optional(),
  date: base.date.optional(),
  durationMinutes: base.durationMinutes.optional(),
  methods: base.methods.optional(),
  quality: base.quality,
  difficulty: base.difficulty,
  notes: base.notes,
  questions: base.questions,
});

studiesRouter.get('/', async (req, res) => {
  const opts = parse(
    z.object({
      from: dateString.optional(),
      to: dateString.optional(),
      subjectId: id.optional(),
      areaId: id.optional(),
      limit: z.coerce.number().int().min(1).max(500).optional(),
    }),
    req.query,
  );
  res.json(await svc.listStudies(currentUser(req).id, opts));
});

studiesRouter.get('/suggestion/:subjectId', async (req, res) => {
  res.json(await svc.studySuggestion(currentUser(req).id, req.params.subjectId));
});

studiesRouter.post('/', async (req, res) => {
  const input = parse(createSchema, req.body);
  res.status(201).json(await svc.createStudy(currentUser(req).id, input, today(req)));
});

studiesRouter.get('/:id', async (req, res) => {
  res.json(await svc.getStudy(currentUser(req).id, req.params.id));
});

studiesRouter.patch('/:id', async (req, res) => {
  const input = parse(updateSchema, req.body);
  res.json(await svc.updateStudy(currentUser(req).id, req.params.id, input, today(req)));
});

studiesRouter.delete('/:id', async (req, res) => {
  await svc.deleteStudy(currentUser(req).id, req.params.id, today(req));
  res.status(204).end();
});
