import { prisma } from '../../lib/prisma.js';
import { badRequest, conflict, unauthorized } from '../../lib/errors.js';
import { getDummyHash, hashPassword, verifyPassword } from './password.js';
import { applyTemplate, type TemplateKey } from '../taxonomy/templates/index.js';
import { joinGroupByCode } from '../groups/groups.service.js';

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  timezone?: string;
  template: TemplateKey;
  inviteCode?: string | null;
}

export async function register(input: RegisterInput) {
  const email = input.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw conflict('Já existe uma conta com este e-mail');

  if (input.inviteCode) {
    const group = await prisma.group.findUnique({ where: { inviteCode: input.inviteCode.trim().toUpperCase() } });
    if (!group) throw badRequest('Código de convite inválido');
  }

  const passwordHash = await hashPassword(input.password);
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name: input.name.trim(),
        email,
        passwordHash,
        timezone: input.timezone ?? 'America/Sao_Paulo',
        domain: input.template,
      },
    });
    await applyTemplate(tx, created.id, input.template);
    return created;
  });

  if (input.inviteCode) await joinGroupByCode(user.id, input.inviteCode);
  return user;
}

export async function login(emailRaw: string, password: string) {
  const email = emailRaw.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  const ok = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !ok) throw unauthorized('E-mail ou senha incorretos');
  return user;
}
