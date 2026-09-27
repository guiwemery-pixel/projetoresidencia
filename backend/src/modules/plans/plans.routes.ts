import { Router } from 'express';
import { z } from 'zod';
import { dateString, parse } from '../../lib/validation.js';
import { currentUser, today } from '../../middleware/auth.js';
import * as svc from './plans.service.js';

export const plansRouter = Router();

const planSchema = z.object({
  name: z.string().trim().min(1, 'Dê um nome ao cronograma').max(120),
  source: z.string().trim().max(200).nullish(),
  items: z
    .array(
      z.object({
        subject: z.string().trim().min(1).max(160),
        area: z.string().trim().max(120).nullish(),
        weekStart: dateString,
        label: z.string().trim().max(60).nullish(),
        bonus: z.boolean().optional(),
      }),
    )
    .min(1, 'O cronograma não tem nenhum assunto')
    .max(1000),
});

plansRouter.get('/', async (req, res) => {
  res.json(await svc.listPlans(currentUser(req).id, today(req)));
});

/** Pendências de todos os cronogramas (atrasadas, desta semana e da próxima). */
plansRouter.get('/agenda', async (req, res) => {
  res.json(await svc.planAgenda(currentUser(req).id, today(req)));
});

/** Itens cuja semana cruza o período (calendário). */
plansRouter.get('/items', async (req, res) => {
  const { from, to } = parse(z.object({ from: dateString, to: dateString }), req.query);
  res.json(await svc.planItemsBetween(currentUser(req).id, from, to, today(req)));
});

plansRouter.post('/preview', async (req, res) => {
  res.json(await svc.previewPlan(currentUser(req).id, parse(planSchema, req.body)));
});

plansRouter.post('/', async (req, res) => {
  res.status(201).json(await svc.createPlan(currentUser(req).id, parse(planSchema, req.body)));
});

/** Adiar, pular, voltar a pendente ou marcar como feito. */
plansRouter.patch('/items/:itemId', async (req, res) => {
  const input = parse(z.object({ weekStart: dateString.optional(), status: z.enum(['PENDING', 'DONE', 'SKIPPED']).optional() }), req.body);
  res.json(await svc.updateItem(currentUser(req).id, req.params.itemId, input, today(req)));
});

plansRouter.get('/:id', async (req, res) => {
  res.json(await svc.getPlan(currentUser(req).id, req.params.id, today(req)));
});

plansRouter.patch('/:id', async (req, res) => {
  const { name } = parse(z.object({ name: z.string().trim().min(1).max(120) }), req.body);
  res.json(await svc.renamePlan(currentUser(req).id, req.params.id, name));
});

/** Empurra os pendentes (ex.: +7 dias). */
plansRouter.post('/:id/shift', async (req, res) => {
  const { days, fromWeek } = parse(z.object({ days: z.number().int().min(-366).max(366), fromWeek: dateString.optional() }), req.body);
  res.json(await svc.shiftPlan(currentUser(req).id, req.params.id, days, fromWeek));
});

plansRouter.delete('/:id', async (req, res) => {
  const { removeSubjects } = parse(z.object({ removeSubjects: z.enum(['0', '1']).optional() }), req.query);
  res.json(await svc.deletePlan(currentUser(req).id, req.params.id, removeSubjects === '1'));
});
