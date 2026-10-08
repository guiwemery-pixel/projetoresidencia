import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, resetDb, signup } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';
import { outbox } from '../src/modules/mail/mailer.js';
import { billingNoticeMail, receiptMail } from '../src/modules/mail/templates.js';

// E-mails: confirmar o e-mail do cadastro, "Esqueci minha senha" e avisos

beforeEach(async () => {
  await resetDb();
  outbox.length = 0;
});

const mailsTo = (to: string, tag: string) => outbox.filter((m) => m.to === to && m.tag === tag);
const tokenOf = (m: { text: string }) => m.text.match(/token=([\w-]+)/)![1];
/** Libera pedir outro link (o site espera 1 minuto entre um e outro). */
const ageLinks = (userId: string) => prisma.emailToken.updateMany({ where: { userId }, data: { createdAt: new Date(Date.now() - 120_000) } });

describe('confirmar e-mail', () => {
  it('o cadastro manda o link; abrir confirma (também em outro aparelho) e o aviso some', async () => {
    const { agent, user, email } = await signup('Ana Clara');
    expect(user).toMatchObject({ emailVerified: false, emailConfirmationPending: true });
    const [mail] = mailsTo(email, 'confirmar-email');
    expect(mail.subject).toContain('Confirme seu e-mail');
    expect(mail.text).toContain('Olá, Ana!');
    expect(mail.html).toContain('/confirmar-email?token=');

    // Aberto sem login (outro navegador)
    const res = await request(app).post('/api/auth/verify-email').send({ token: tokenOf(mail) });
    expect(res.body).toEqual({ email, alreadyVerified: false });
    const me = (await agent.get('/api/auth/me')).body.user;
    expect(me).toMatchObject({ emailVerified: true, emailConfirmationPending: false });
    // Clicar de novo no mesmo link não assusta ninguém
    expect((await request(app).post('/api/auth/verify-email').send({ token: tokenOf(mail) })).body.alreadyVerified).toBe(true);
    // Já confirmado: não manda outro
    expect((await agent.post('/api/auth/verify-email/send')).body.result).toBe('already-verified');
  });

  it('pedir de novo: espera 1 minuto, e o link novo invalida o anterior', async () => {
    const { agent, user, email } = await signup('Bruno');
    expect((await agent.post('/api/auth/verify-email/send')).status).toBe(429);
    await ageLinks(user.id);
    const again = await agent.post('/api/auth/verify-email/send');
    expect(again.body).toEqual({ result: 'sent', email });
    const [first, second] = mailsTo(email, 'confirmar-email');
    expect((await request(app).post('/api/auth/verify-email').send({ token: tokenOf(first) })).status).toBe(400);
    expect((await request(app).post('/api/auth/verify-email').send({ token: 'inventado' })).status).toBe(400);
    expect((await request(app).post('/api/auth/verify-email').send({ token: tokenOf(second) })).status).toBe(200);
    // Precisa estar logado para pedir
    expect((await request(app).post('/api/auth/verify-email/send')).status).toBe(401);
  });

  it('link vencido não confirma', async () => {
    const { user, email } = await signup('Carla');
    await prisma.emailToken.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await request(app).post('/api/auth/verify-email').send({ token: tokenOf(mailsTo(email, 'confirmar-email')[0]) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/venceu/);
  });
});

describe('esqueci minha senha', () => {
  it('manda o link, troca a senha, encerra as sessões abertas e já entra', async () => {
    const { agent, user, email } = await signup('Dani');
    expect((await request(app).get('/api/auth/signup')).body).toMatchObject({ passwordRecovery: true });

    // Mesma resposta para quem não tem conta, mas sem e-mail
    const unknown = await request(app).post('/api/auth/forgot-password').send({ email: 'ninguem@teste.com' });
    expect(unknown.body).toEqual({ ok: true });
    expect(outbox.filter((m) => m.tag === 'nova-senha')).toHaveLength(0);

    const res = await request(app).post('/api/auth/forgot-password').send({ email: email.toUpperCase() });
    expect(res.body).toEqual({ ok: true });
    const [mail] = mailsTo(email, 'nova-senha');
    expect(mail.subject).toContain('nova senha');
    expect(mail.text).toContain('60 minutos');
    const token = tokenOf(mail);
    expect((await request(app).post('/api/auth/reset-password/check').send({ token })).body).toEqual({ email });

    expect((await request(app).post('/api/auth/reset-password').send({ token, password: 'curta' })).status).toBe(400);
    const phone = request.agent(app);
    const done = await phone.post('/api/auth/reset-password').send({ token, password: 'senha-nova-456' });
    expect(done.status).toBe(200);
    // Entrou com a senha nova; abrir o link conta como e-mail confirmado
    expect(done.body.user).toMatchObject({ id: user.id, emailVerified: true });
    expect((await phone.get('/api/auth/me')).status).toBe(200);
    // A sessão antiga (outro aparelho) caiu
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email, password: 'senha-segura-123' })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email, password: 'senha-nova-456' })).status).toBe(200);
    // Link usado não vale de novo; aviso de segurança enviado
    expect((await request(app).post('/api/auth/reset-password').send({ token, password: 'outra-senha-789' })).status).toBe(400);
    expect((await request(app).post('/api/auth/reset-password/check').send({ token })).status).toBe(400);
    expect(mailsTo(email, 'senha-alterada')).toHaveLength(1);
  });

  it('link vencido ou trocado por um mais novo não vale', async () => {
    const { user, email } = await signup('Edu');
    await request(app).post('/api/auth/forgot-password').send({ email });
    // Pedido repetido em menos de 1 minuto: não manda outro
    await request(app).post('/api/auth/forgot-password').send({ email });
    expect(mailsTo(email, 'nova-senha')).toHaveLength(1);
    await ageLinks(user.id);
    await request(app).post('/api/auth/forgot-password').send({ email });
    const [old, recent] = mailsTo(email, 'nova-senha');
    expect((await request(app).post('/api/auth/reset-password').send({ token: tokenOf(old), password: 'senha-nova-456' })).status).toBe(400);
    // O link de confirmação de e-mail não serve para trocar a senha
    const verify = tokenOf(mailsTo(email, 'confirmar-email')[0]);
    expect((await request(app).post('/api/auth/reset-password').send({ token: verify, password: 'senha-nova-456' })).status).toBe(400);

    await prisma.emailToken.updateMany({ where: { userId: user.id, kind: 'RESET_PASSWORD' }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await request(app).post('/api/auth/reset-password').send({ token: tokenOf(recent), password: 'senha-nova-456' });
    expect(expired.status).toBe(400);
    expect(expired.body.error).toMatch(/venceu/);
  });

  it('trocar a senha pelo perfil também manda o aviso de segurança', async () => {
    const { agent, email } = await signup('Fabi');
    const res = await agent.post('/api/me/password').send({ currentPassword: 'senha-segura-123', newPassword: 'senha-nova-456' });
    expect(res.status).toBe(204);
    const [mail] = mailsTo(email, 'senha-alterada');
    expect(mail.text).toContain('/esqueci-senha');
  });
});

describe('modelos de recibo e aviso de cobrança', () => {
  it('formata valor e data em português e protege o nome no HTML', () => {
    const receipt = receiptMail('a@teste.com', '<b>Gui</b> Silva', {
      product: 'Plano anual',
      amountCents: 49790,
      paidAt: new Date('2026-10-08T15:30:00Z'),
      method: 'Pix',
      reference: 'PED-123',
      accessUntil: new Date('2027-10-08T15:30:00Z'),
    });
    expect(receipt.subject).toContain('Recibo');
    expect(receipt.text).toContain('R$ 497,90');
    expect(receipt.text).toContain('08/10/2026, 12:30');
    expect(receipt.text).toContain('8 de outubro de 2027');
    expect(receipt.html).toContain('Obrigado, &lt;b&gt;Gui&lt;/b&gt;!');
    expect(receipt.html).not.toContain('<b>Gui</b>');

    const failed = billingNoticeMail('a@teste.com', 'Gui', { kind: 'failed', product: 'Plano mensal', amountCents: 4990, date: new Date('2026-10-11T12:00:00Z'), url: 'https://site/pagar' });
    expect(failed.subject).toContain('Não conseguimos cobrar');
    expect(failed.text).toContain('Atualizar pagamento: https://site/pagar');
    for (const kind of ['upcoming', 'expired'] as const)
      expect(billingNoticeMail('a@teste.com', 'Gui', { kind, product: 'P', amountCents: 100, date: new Date(), url: 'https://x' }).tag).toBe(`cobranca-${kind}`);
  });
});
