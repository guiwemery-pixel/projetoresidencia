import { Router } from 'express';
import { z } from 'zod';
import { parse } from '../../lib/validation.js';
import { todayIn } from '../../lib/dates.js';
import { currentUser } from '../../middleware/auth.js';
import { previewImport, runImport } from './import.service.js';

export const importRouter = Router();

const METHODS = ['TEORIA', 'QUESTOES', 'FLASHCARDS', 'RECALL', 'REVISAO', 'AULA', 'VIDEO', 'LEITURA', 'RESUMO', 'SIMULADO', 'OUTRO'] as const;
const text = (max: number) => z.string().trim().max(max);

const eventSchema = z.object({
  area: text(120).nullish(),
  subarea: text(120).nullish(),
  subject: text(160).min(1, 'Assunto vazio'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida'),
  total: z.number().int().min(1).max(1000).nullish(),
  correct: z.number().int().min(0).max(1000).nullish(),
  minutes: z.number().int().min(0).max(1440).nullish(),
  methods: z.array(z.enum(METHODS)).max(6).optional(),
  quality: z.number().int().min(1).max(5).nullish(),
  difficulty: z.number().int().min(1).max(3).nullish(),
  notes: text(2000).nullish(),
});

const today = (req: Parameters<typeof currentUser>[0]) => todayIn(currentUser(req).timezone);

/** Prévia (não grava): até 5000 estudos de uma vez. */
importRouter.post('/preview', async (req, res) => {
  const { events } = parse(z.object({ events: z.array(eventSchema).min(1).max(5000) }), req.body);
  res.json(await previewImport(currentUser(req).id, events, today(req)));
});

/** Importação em lotes (o navegador envia todos os estudos de um assunto no mesmo lote). */
importRouter.post('/run', async (req, res) => {
  const { events } = parse(z.object({ events: z.array(eventSchema).min(1).max(400) }), req.body);
  res.json(await runImport(currentUser(req).id, events, today(req)));
});
