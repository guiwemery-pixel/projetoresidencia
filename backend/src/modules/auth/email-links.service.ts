import { createHash, randomBytes } from 'node:crypto';
import type { Request } from 'express';
import type { EmailTokenKind, User } from '@prisma/client';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { HttpError, badRequest } from '../../lib/errors.js';
import { mailEnabled, trySendMail } from '../mail/mailer.js';
import { RESET_TTL_MINUTES, VERIFY_TTL_HOURS, passwordChangedMail, resetPasswordMail, verifyEmailMail } from '../mail/templates.js';
import { hashPassword } from './password.js';

// Links enviados por e-mail: confirmar o e-mail do cadastro e criar uma nova senha.
// O link leva um token aleatório (256 bits); o banco guarda só o hash. Cada link vale
// uma vez, por tempo limitado, e um link novo do mesmo tipo invalida os anteriores.

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
/** Menos de 1 minuto desde o último link do mesmo tipo: não manda outro. */
const RESEND_INTERVAL_MS = 60_000;
const TTL_MS: Record<EmailTokenKind, number> = {
  VERIFY_EMAIL: VERIFY_TTL_HOURS * 3_600_000,
  RESET_PASSWORD: RESET_TTL_MINUTES * 60_000,
};
const INVALID_LINK = 'Este link não vale mais: ele já foi usado, venceu ou foi trocado por um mais novo.';

/**
 * Endereço do site para os links. APP_URL, se definida; senão a origem do pedido
 * (para POST, o originCheck já recusou origens desconhecidas) ou o próprio host.
 */
export function siteUrl(req: Request) {
  if (env.APP_URL) return env.APP_URL.replace(/\/+$/, '');
  const origin = req.get('origin');
  if (origin && /^https?:\/\/[^/\s]+$/.test(origin)) return origin;
  return `${req.protocol}://${req.get('host')}`;
}

/** Cria o link (token) — ou null se já foi criado um há menos de 1 minuto. */
async function issue(user: Pick<User, 'id' | 'email'>, kind: EmailTokenKind) {
  const recent = await prisma.emailToken.findFirst({
    where: { userId: user.id, kind, usedAt: null, createdAt: { gt: new Date(Date.now() - RESEND_INTERVAL_MS) } },
    select: { id: true },
  });
  if (recent) return null;
  const token = randomBytes(32).toString('base64url');
  await prisma.$transaction([
    // Só o link mais recente vale
    prisma.emailToken.deleteMany({ where: { userId: user.id, kind, usedAt: null } }),
    prisma.emailToken.create({
      data: { userId: user.id, kind, tokenHash: hashToken(token), email: user.email, expiresAt: new Date(Date.now() + TTL_MS[kind]) },
    }),
  ]);
  return token;
}

async function findLink(token: string, kind: EmailTokenKind) {
  if (!token || token.length > 200) return null;
  const row = await prisma.emailToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  // Link de outro tipo, ou de um e-mail que a conta não usa mais
  if (!row || row.kind !== kind || row.email !== row.user.email) return null;
  return row;
}

export type ConfirmationResult = 'sent' | 'already-verified' | 'too-soon' | 'failed';

/** Manda o link de confirmação do e-mail (no cadastro e quando a pessoa pede de novo). */
export async function sendEmailConfirmation(user: User, base: string): Promise<ConfirmationResult> {
  if (user.emailVerifiedAt) return 'already-verified';
  const token = await issue(user, 'VERIFY_EMAIL');
  if (!token) return 'too-soon';
  const ok = await trySendMail(verifyEmailMail(user.email, user.name, `${base}/confirmar-email?token=${token}`));
  if (!ok) await prisma.emailToken.deleteMany({ where: { tokenHash: hashToken(token) } });
  return ok ? 'sent' : 'failed';
}

/** Abre o link de confirmação. Abrir de novo um link já usado não dá erro. */
export async function confirmEmail(token: string) {
  const row = await findLink(token, 'VERIFY_EMAIL');
  if (!row) throw badRequest(INVALID_LINK);
  if (row.usedAt) {
    if (row.user.emailVerifiedAt) return { email: row.email, alreadyVerified: true };
    throw badRequest(INVALID_LINK);
  }
  if (row.expiresAt < new Date()) throw badRequest('Este link venceu. Entre no site e peça um novo link de confirmação.');
  const now = new Date();
  await prisma.$transaction([
    prisma.emailToken.update({ where: { id: row.id }, data: { usedAt: now } }),
    prisma.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: row.user.emailVerifiedAt ?? now } }),
  ]);
  return { email: row.email, alreadyVerified: !!row.user.emailVerifiedAt };
}

/**
 * "Esqueci minha senha". Responde igual exista ou não a conta (não revela quem tem
 * conta); o e-mail só sai quando a conta existe.
 */
export async function requestPasswordReset(emailRaw: string, base: string) {
  const user = await prisma.user.findUnique({ where: { email: emailRaw.trim().toLowerCase() } });
  if (!user) return;
  const token = await issue(user, 'RESET_PASSWORD');
  if (!token) return;
  const ok = await trySendMail(resetPasswordMail(user.email, user.name, `${base}/redefinir-senha?token=${token}`));
  if (!ok) await prisma.emailToken.deleteMany({ where: { tokenHash: hashToken(token) } });
}

async function validResetLink(token: string) {
  const row = await findLink(token, 'RESET_PASSWORD');
  if (!row || row.usedAt) throw badRequest(INVALID_LINK);
  if (row.expiresAt < new Date()) throw badRequest(`Este link venceu (vale por ${RESET_TTL_MINUTES} minutos). Peça um novo em "Esqueci minha senha".`);
  return row;
}

/** A tela de nova senha confere o link antes de a pessoa digitar. */
export async function checkResetLink(token: string) {
  const row = await validResetLink(token);
  return { email: row.email };
}

/**
 * Troca a senha pelo link. Encerra todas as sessões abertas (quem estava com a conta
 * em outro aparelho sai) e conta como e-mail confirmado: a pessoa abriu o link.
 */
export async function resetPassword(token: string, password: string) {
  const row = await validResetLink(token);
  const passwordHash = await hashPassword(password);
  const now = new Date();
  const user = await prisma.$transaction(async (tx) => {
    // Marca como usado só se ainda não foi (dois cliques ao mesmo tempo: só um vale)
    const { count } = await tx.emailToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
    if (!count) throw badRequest(INVALID_LINK);
    await tx.emailToken.deleteMany({ where: { userId: row.userId, kind: 'RESET_PASSWORD', usedAt: null } });
    await tx.session.deleteMany({ where: { userId: row.userId } });
    return tx.user.update({
      where: { id: row.userId },
      data: { passwordHash, emailVerifiedAt: row.user.emailVerifiedAt ?? now },
    });
  });
  return user;
}

/** Aviso de segurança depois de trocar a senha (pela tela de perfil ou pelo link). */
export async function notifyPasswordChanged(user: Pick<User, 'email' | 'name'>, base: string) {
  if (!mailEnabled()) return;
  await trySendMail(passwordChangedMail(user.email, user.name, new Date(), `${base}/esqueci-senha`));
}

/** Pedido repetido em menos de 1 minuto. */
export const tooSoon = () => new HttpError(429, 'Acabamos de enviar um e-mail. Aguarde um minuto antes de pedir outro.');
