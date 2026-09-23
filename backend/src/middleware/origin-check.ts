import type { NextFunction, Request, Response } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Defesa extra contra CSRF: requisições que alteram dados precisam vir de uma
 * origem conhecida (o próprio host ou CORS_ORIGIN). O cookie de sessão já é
 * SameSite=Lax, e a API só aceita JSON — isto é uma segunda camada.
 */
export function originCheck(allowedOrigins: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get('origin');
    if (!origin) return next(); // clientes não-navegador (curl, testes)
    const host = req.get('host');
    const sameHost = host && (origin === `http://${host}` || origin === `https://${host}`);
    if (sameHost || allowedOrigins.includes(origin)) return next();
    res.status(403).json({ error: 'Origem não permitida' });
  };
}
