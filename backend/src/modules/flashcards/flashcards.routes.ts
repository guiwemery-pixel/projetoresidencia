import { Router } from 'express';
import { z } from 'zod';
import { currentUser } from '../../middleware/auth.js';
import { parse } from '../../lib/validation.js';
import { SYNC_STORES, getSummary, pull, pullBody, push, readMedia, resetCollection, saveSummary, searchCards, status } from './flashcards.service.js';

export const flashcardsRouter = Router();

const cursor = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

flashcardsRouter.get('/sync', async (req, res) => {
  const { since, epoch } = parse(z.object({ since: cursor.default(0), epoch: z.coerce.number().int().positive().optional() }), req.query);
  const result = await pull(currentUser(req).id, since, epoch);
  res.type('application/json').setHeader('Cache-Control', 'no-store');
  res.send(pullBody(result));
});

const op = z
  .object({
    s: z.enum(SYNC_STORES),
    id: z.string().min(1).max(200),
    d: z.record(z.unknown()).optional(),
    del: z.boolean().optional(),
  })
  .refine((o) => o.del === true || o.d !== undefined, 'Cada operação precisa de "d" ou "del"');

flashcardsRouter.post('/sync', async (req, res) => {
  const body = parse(z.object({ epoch: z.number().int().positive().nullish(), ops: z.array(op).max(20_000) }), req.body);
  res.json(await push(currentUser(req).id, body.epoch, body.ops));
});

flashcardsRouter.get('/status', async (req, res) => {
  res.json(await status(currentUser(req).id));
});

/** Substitui a coleção da conta (restaurar backup, apagar tudo). */
flashcardsRouter.post('/reset', async (req, res) => {
  res.json(await resetCollection(currentUser(req).id));
});

flashcardsRouter.get('/summary', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await getSummary(currentUser(req).id));
});

flashcardsRouter.put('/summary', async (req, res) => {
  const summary = parse(z.record(z.unknown()), req.body);
  if (JSON.stringify(summary).length > 16_000) {
    res.status(413).json({ error: 'Resumo grande demais' });
    return;
  }
  await saveSummary(currentUser(req).id, summary);
  res.status(204).end();
});

/**
 * Uma imagem do próprio usuário. Sempre como download "opaco" (o app monta a imagem
 * com o tipo que guardou): um SVG enviado num baralho nunca roda como página do site.
 */
flashcardsRouter.get('/media', async (req, res) => {
  const { name } = parse(z.object({ name: z.string().min(1).max(200) }), req.query);
  const bytes = await readMedia(currentUser(req).id, name);
  if (!bytes) {
    res.status(404).json({ error: 'Imagem não encontrada' });
    return;
  }
  res.set({
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': 'attachment',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, max-age=86400',
  });
  res.send(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
});

flashcardsRouter.get('/search', async (req, res) => {
  const { q } = parse(z.object({ q: z.string().max(200).default('') }), req.query);
  res.json(await searchCards(currentUser(req).id, q, 20));
});
