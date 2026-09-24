import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { HttpError } from '../lib/errors.js';

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: 'Rota não encontrada' });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'Não encontrado' });
      return;
    }
    if (err.code === 'P2002') {
      res.status(409).json({ error: 'Registro duplicado' });
      return;
    }
  }
  if (err instanceof SyntaxError && 'body' in (err as object)) {
    res.status(400).json({ error: 'JSON inválido' });
    return;
  }
  // Erros de cliente vindos de middlewares/runtime (ex.: corpo inválido no Vercel)
  const status = (err as { status?: unknown; statusCode?: unknown })?.statusCode ?? (err as { status?: unknown })?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(status).json({ error: 'Requisição inválida' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Erro interno do servidor' });
}
