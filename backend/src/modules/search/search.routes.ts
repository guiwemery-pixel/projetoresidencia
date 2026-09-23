import { Router } from 'express';
import { z } from 'zod';
import { parse } from '../../lib/validation.js';
import { currentUser, today } from '../../middleware/auth.js';
import { globalSearch } from './search.service.js';

export const searchRouter = Router();

searchRouter.get('/', async (req, res) => {
  const { q } = parse(z.object({ q: z.string().max(100).default('') }), req.query);
  res.json(await globalSearch(currentUser(req).id, q, today(req)));
});
