import { Router } from 'express';
import { z } from 'zod';
import { parse, id, optionalText } from '../../lib/validation.js';
import { currentUser } from '../../middleware/auth.js';
import { subjectTimeline } from '../reviews/learning.service.js';
import * as svc from './taxonomy.service.js';

export const areasRouter = Router();
export const subjectsRouter = Router();

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida').nullish();
const name = z.string().trim().min(1, 'Informe o nome').max(120);

areasRouter.get('/', async (req, res) => {
  res.json(await svc.getAreaTree(currentUser(req).id));
});

areasRouter.post('/', async (req, res) => {
  const input = parse(z.object({ name, parentId: id.nullish(), color }), req.body);
  res.status(201).json(await svc.createArea(currentUser(req).id, input));
});

areasRouter.patch('/:id', async (req, res) => {
  const input = parse(
    z.object({ name: name.optional(), parentId: id.nullish(), color, position: z.number().int().min(0).optional() }),
    req.body,
  );
  res.json(await svc.updateArea(currentUser(req).id, req.params.id, input));
});

areasRouter.delete('/:id', async (req, res) => {
  const opts = parse(
    z.object({ moveTo: id.optional(), force: z.enum(['true', 'false']).optional().transform((v) => v === 'true') }),
    req.query,
  );
  await svc.deleteArea(currentUser(req).id, req.params.id, opts);
  res.status(204).end();
});

const size = z.enum(['SMALL', 'MEDIUM', 'LARGE']);
const tags = z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20);

subjectsRouter.get('/', async (req, res) => {
  const opts = parse(
    z.object({
      q: z.string().max(100).optional(),
      areaId: id.optional(),
      includeArchived: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
    }),
    req.query,
  );
  res.json(await svc.listSubjects(currentUser(req).id, opts));
});

subjectsRouter.post('/', async (req, res) => {
  const input = parse(z.object({ areaId: id, name, size: size.optional(), notes: optionalText(), tags: tags.optional() }), req.body);
  res.status(201).json(await svc.createSubject(currentUser(req).id, { ...input, notes: input.notes ?? null }));
});

subjectsRouter.get('/:id', async (req, res) => {
  const userId = currentUser(req).id;
  const subject = await svc.findOwnedSubject(userId, req.params.id);
  const [list, timeline] = await Promise.all([
    svc.listSubjects(userId, { includeArchived: true, q: undefined }),
    subjectTimeline(userId, subject.id),
  ]);
  res.json({ ...list.find((s) => s.id === subject.id), timeline });
});

subjectsRouter.patch('/:id', async (req, res) => {
  const input = parse(
    z.object({
      areaId: id.optional(),
      name: name.optional(),
      size: size.optional(),
      notes: optionalText(),
      tags: tags.optional(),
      archived: z.boolean().optional(),
    }),
    req.body,
  );
  res.json(await svc.updateSubject(currentUser(req).id, req.params.id, input));
});

subjectsRouter.delete('/:id', async (req, res) => {
  await svc.deleteSubject(currentUser(req).id, req.params.id);
  res.status(204).end();
});
