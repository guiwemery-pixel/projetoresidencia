import { Router } from 'express';
import { z } from 'zod';
import { dateString, parse } from '../../lib/validation.js';
import { currentUser, today } from '../../middleware/auth.js';
import * as svc from './plans.service.js';
import { dailyUpkeep } from '../maintenance/maintenance.service.js';

export const plansRouter = Router();

// Dias de estudo (1 = segunda … 7 = domingo) e minutos por dia (30 min a 16 h)
const scheduleSchema = z.object({
  weekdays: z.array(z.number().int().min(1).max(7)).min(1, 'Escolha pelo menos um dia de estudo').max(7),
  dailyMinutes: z.number().int().min(30, 'Pelo menos 30 minutos por dia').max(960),
});

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
  schedule: scheduleSchema.nullish(),
});

plansRouter.get('/', async (req, res) => {
  // Revisões atrasadas há muito tempo voltam para o cronograma (uma vez por dia)
  await dailyUpkeep(currentUser(req).id, today(req)).catch((err) => console.error(err));
  res.json(await svc.listPlans(currentUser(req).id, today(req)));
});

/** Pendências de todos os cronogramas (atrasadas, desta semana e da próxima). */
plansRouter.get('/agenda', async (req, res) => {
  await dailyUpkeep(currentUser(req).id, today(req)).catch((err) => console.error(err));
  res.json(await svc.planAgenda(currentUser(req).id, today(req)));
});

/** Itens cuja semana cruza o período (calendário). */
plansRouter.get('/items', async (req, res) => {
  const { from, to } = parse(z.object({ from: dateString, to: dateString }), req.query);
  res.json(await svc.planItemsBetween(currentUser(req).id, from, to, today(req)));
});

plansRouter.post('/preview', async (req, res) => {
  res.json(await svc.previewPlan(currentUser(req).id, parse(planSchema, req.body), today(req)));
});

plansRouter.post('/', async (req, res) => {
  res.status(201).json(await svc.createPlan(currentUser(req).id, parse(planSchema, req.body), today(req)));
});

/** Dias e horas de estudo: salva e distribui os assuntos de cada semana por esses dias. */
plansRouter.post('/distribute', async (req, res) => {
  const { planId, ...schedule } = parse(scheduleSchema.extend({ planId: z.string().min(1).max(40).optional() }), req.body);
  res.json(await svc.setStudySchedule(currentUser(req).id, schedule, today(req), planId));
});

/** Mudar o dia (ou a semana), pular, voltar a pendente ou marcar como feito. */
plansRouter.patch('/items/:itemId', async (req, res) => {
  const input = parse(
    z.object({ weekStart: dateString.optional(), plannedOn: dateString.optional(), status: z.enum(['PENDING', 'DONE', 'SKIPPED']).optional() }),
    req.body,
  );
  res.json(await svc.updateItem(currentUser(req).id, req.params.itemId, input, today(req)));
});

/** Tira o assunto do cronograma (sem apagar o assunto). */
plansRouter.delete('/items/:itemId', async (req, res) => {
  await svc.removeItem(currentUser(req).id, req.params.itemId);
  res.status(204).end();
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
