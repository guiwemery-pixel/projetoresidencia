import { Router } from 'express';
import { z } from 'zod';
import { currentUser } from '../../middleware/auth.js';
import { parse } from '../../lib/validation.js';
import { SYNC_STORES, getSummary, pull, pullBody, push, readMedia, resetCollection, saveSummary, searchCards, status } from './flashcards.service.js';
import { finishPublish, listPlatform, readDeckCards, removePackage, startPublish, uploadDecks } from './platform.js';

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

// ── Cards da plataforma (conteúdo no Cloudflare R2; ver platform.ts) ──────────

const platformId = z.string().regex(/^[a-z0-9]{4,40}$/, 'Identificador inválido');
const deckId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, 'Baralho inválido');

flashcardsRouter.get('/platform', async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.json(await listPlatform(currentUser(req).email));
});

/** Cards de um baralho. A versão está no endereço: o navegador pode guardar a resposta. */
flashcardsRouter.get('/platform/cards', async (req, res) => {
  const q = parse(z.object({ package: platformId, version: platformId, deck: deckId }), req.query);
  const bytes = await readDeckCards(q.package, q.version, q.deck);
  res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, max-age=604800, immutable' });
  res.send(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
});

flashcardsRouter.post('/platform/publish', async (req, res) => {
  const body = parse(z.object({ packageId: platformId.optional() }), req.body);
  res.json(await startPublish(currentUser(req).email, body.packageId));
});

const platformCard = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,60}$/),
  front: z.string().max(300_000),
  back: z.string().max(300_000),
  tags: z.array(z.string().max(200)).max(100).default([]),
});

flashcardsRouter.post('/platform/publish/:packageId/:version/decks', async (req, res) => {
  const p = parse(z.object({ packageId: platformId, version: platformId }), req.params);
  const body = parse(z.object({ decks: z.array(z.object({ id: deckId, cards: z.array(platformCard).max(5000) })).min(1).max(1000) }), req.body);
  res.json(await uploadDecks(currentUser(req).email, p.packageId, p.version, body.decks));
});

flashcardsRouter.post('/platform/publish/:packageId/:version/finish', async (req, res) => {
  const p = parse(z.object({ packageId: platformId, version: platformId }), req.params);
  const body = parse(
    z.object({
      name: z.string().trim().min(1).max(200),
      decks: z
        .array(
          z.object({
            id: deckId,
            name: z.string().min(1).max(500),
            parent: deckId.nullable(),
            own: z.number().int().min(0),
            total: z.number().int().min(0),
          }),
        )
        .min(1)
        .max(20_000),
    }),
    req.body,
  );
  res.json(await finishPublish(currentUser(req).email, p.packageId, p.version, body.name, body.decks));
});

flashcardsRouter.delete('/platform/packages/:packageId', async (req, res) => {
  const p = parse(z.object({ packageId: platformId }), req.params);
  await removePackage(currentUser(req).email, p.packageId);
  res.status(204).end();
});
