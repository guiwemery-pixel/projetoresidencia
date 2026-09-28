import { Router, type Request } from 'express';
import { z } from 'zod';
import { parse } from '../../lib/validation.js';
import { currentUser } from '../../middleware/auth.js';
import { disableFeed, enableFeed, getFeed, optionsSchema, renderFeed, updateOptions } from './calendar.service.js';

// Endereço público do site (o Google Agenda busca a agenda nele)
const baseUrl = (req: Request) => `${req.protocol}://${req.get('host')}`;

/** Configuração da agenda do usuário logado (montado em /api/me/calendar). */
export const calendarRouter = Router();

calendarRouter.get('/', async (req, res) => {
  res.json(await getFeed(currentUser(req).id, baseUrl(req)));
});

/** Liga a agenda; `regenerate: true` troca o link (o anterior para de funcionar). */
calendarRouter.post('/', async (req, res) => {
  const { regenerate } = parse(z.object({ regenerate: z.boolean().default(false) }), req.body ?? {});
  res.json(await enableFeed(currentUser(req).id, baseUrl(req), regenerate));
});

calendarRouter.patch('/', async (req, res) => {
  const patch = parse(optionsSchema.partial(), req.body);
  res.json(await updateOptions(currentUser(req).id, baseUrl(req), patch));
});

calendarRouter.delete('/', async (req, res) => {
  await disableFeed(currentUser(req).id);
  res.status(204).end();
});

/** A agenda em si (sem login: o link secreto é a autorização). Montado em /api/ical. */
export const icalRouter = Router();

icalRouter.get('/:file', async (req, res) => {
  const m = /^([A-Za-z0-9_-]{20,64})\.ics$/.exec(req.params.file);
  const ics = m ? await renderFeed(m[1], baseUrl(req), req.get('user-agent')) : null;
  if (!ics) {
    res.status(404).type('text/plain').send('Agenda não encontrada');
    return;
  }
  res.set({
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': 'inline; filename="projeto-residente.ics"',
    'Cache-Control': 'private, max-age=300',
    'X-Robots-Tag': 'noindex',
  });
  res.send(ics);
});
