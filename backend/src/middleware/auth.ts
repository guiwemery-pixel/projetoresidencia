import type { NextFunction, Request, Response } from 'express';
import { todayIn } from '../lib/dates.js';
import { unauthorized } from '../lib/errors.js';
import { SESSION_COOKIE, resolveSession } from '../modules/auth/session.js';
import type { AuthUser } from '../types.js';

/** Exige sessão válida e injeta `req.user`. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!token) throw unauthorized();
  const session = await resolveSession(token);
  if (!session) throw unauthorized('Sessão expirada. Entre novamente.');
  req.user = session.user;
  req.sessionId = session.id;
  next();
}

/** Usuário autenticado (usar apenas em rotas protegidas por requireAuth). */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

/** "Hoje" no fuso horário do usuário. */
export function today(req: Request): string {
  return todayIn(currentUser(req).timezone);
}
