import { createHash, randomBytes } from 'node:crypto';
import { env, isProduction } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import type { CookieOptions } from 'express';
import type { AuthUser } from '../../types.js';

// Sessões opacas guardadas no banco: o cookie carrega um token aleatório e o
// banco guarda apenas o hash SHA-256. Permite revogar sessões (logout em todos
// os dispositivos, troca de senha) sem depender de expiração de JWT.

export const SESSION_COOKIE = 'ce_session';
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: env.SESSION_TTL_DAYS * 86_400_000,
  };
}

export async function createSession(userId: string, userAgent?: string) {
  const token = randomBytes(32).toString('base64url');
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      userAgent: userAgent?.slice(0, 255),
      expiresAt: new Date(Date.now() + env.SESSION_TTL_DAYS * 86_400_000),
    },
  });
  return token;
}

export async function resolveSession(token: string): Promise<{ id: string; user: AuthUser } | null> {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, name: true, email: true, timezone: true } } },
  });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  if (Date.now() - session.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.session
      .update({ where: { id: session.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
  }
  return { id: session.id, user: session.user };
}

export async function destroySession(token: string) {
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export async function destroyOtherSessions(userId: string, keepSessionId?: string) {
  await prisma.session.deleteMany({ where: { userId, NOT: keepSessionId ? { id: keepSessionId } : undefined } });
}
