import { Router } from 'express';
import { z } from 'zod';
import { parse } from '../../lib/validation.js';
import { todayIn } from '../../lib/dates.js';
import { currentUser } from '../../middleware/auth.js';
import { previewImport, runImport } from './import.service.js';

export const importRouter = Router();

const METHODS = ['TEORIA', 'QUESTOES', 'FLASHCARDS', 'RECALL', 'REVISAO', 'AULA', 'VIDEO', 'LEITURA', 'RESUMO', 'SIMULADO', 'OUTRO'] as const;
const text = (max: number) => z.string().trim().max(max);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');

const eventSchema = z.object({
  area: text(120).nullish(),
  subarea: text(120).nullish(),
  subject: text(160).min(1, 'Assunto vazio'),
  date,
  total: z.number().int().min(1).max(1000).nullish(),
  correct: z.number().int().min(0).max(1000).nullish(),
  minutes: z.number().int().min(0).max(1440).nullish(),
  methods: z.array(z.enum(METHODS)).max(6).optional(),
  quality: z.number().int().min(1).max(5).nullish(),
  difficulty: z.number().int().min(1).max(3).nullish(),
  notes: text(2000).nullish(),
});

const count = z.number().int().min(0).max(1000).nullish();
const result = {
  date,
  accuracy: z.number().min(0).max(100),
  total: z.number().int().min(1).max(1000).nullish(),
  correct: count,
};

const mockSchema = z.object({
  name: text(120).min(1, 'Simulado sem nome'),
  board: text(80).nullish(),
  year: z.number().int().min(1990).max(2100).nullish(),
  ...result,
});

const examSchema = z.object({
  board: text(80).min(1, 'Prova sem instituição'),
  year: z.number().int().min(1990).max(2100),
  ...result,
});

const payload = (maxEvents: number) =>
  z
    .object({
      events: z.array(eventSchema).max(maxEvents).default([]),
      mocks: z.array(mockSchema).max(500).default([]),
      exams: z.array(examSchema).max(1000).default([]),
    })
    .refine((p) => p.events.length + p.mocks.length + p.exams.length > 0, 'Nada para importar');

const today = (req: Parameters<typeof currentUser>[0]) => todayIn(currentUser(req).timezone);

/** Prévia (não grava): até 5000 estudos de uma vez, mais simulados e provas. */
importRouter.post('/preview', async (req, res) => {
  res.json(await previewImport(currentUser(req).id, parse(payload(5000), req.body), today(req)));
});

/** Importação em lotes (o navegador envia poucos assuntos por vez, cada um inteiro no mesmo lote). */
importRouter.post('/run', async (req, res) => {
  res.json(await runImport(currentUser(req).id, parse(payload(400), req.body), today(req)));
});
