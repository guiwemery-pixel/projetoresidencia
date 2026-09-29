import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, resetDb, signup } from './helpers.js';

// Administração: e-mails de administradores e de acesso liberado, sem mexer no Vercel

beforeEach(async () => {
  await resetDb();
  delete process.env.PLATFORM_ADMIN_EMAILS;
});

afterEach(() => {
  delete process.env.PLATFORM_ADMIN_EMAILS;
});

describe('administração', () => {
  it('sem ninguém cadastrado, a conta mais antiga administra; os outros não entram', async () => {
    const owner = await signup('Dona');
    const other = await signup('Outra');
    expect((await owner.agent.get('/api/auth/me')).body.user.isAdmin).toBe(true);
    expect((await other.agent.get('/api/auth/me')).body.user.isAdmin).toBe(false);
    expect((await other.agent.get('/api/admin')).status).toBe(403);

    const res = await owner.agent.get('/api/admin');
    expect(res.status).toBe(200);
    expect(res.body.signup).toBe('open');
    expect(res.body.admins).toEqual([expect.objectContaining({ email: owner.email, source: 'first', role: 'ADMIN' })]);
    expect(res.body.users.map((u: { email: string }) => u.email).sort()).toEqual([owner.email, other.email].sort());
  });

  it('cadastra administradores pelo site (vários de uma vez) e eles publicam os cards da plataforma', async () => {
    const owner = await signup('Dona');
    const other = await signup('Outra');
    const add = await owner.agent.post('/api/admin/emails').send({ emails: `${other.email.toUpperCase()}\nnova@teste.com, ainda-sem-conta@teste.com`, role: 'ADMIN' });
    expect(add.status).toBe(201);
    expect(add.body.added).toBe(3);
    // Com administradores cadastrados, a "conta mais antiga" deixa de valer
    expect(add.body.admins.map((a: { email: string }) => a.email).sort()).toEqual(['ainda-sem-conta@teste.com', 'nova@teste.com', other.email].sort());
    expect(add.body.admins.find((a: { email: string }) => a.email === other.email).account).toMatchObject({ name: 'Outra' });
    expect((await other.agent.get('/api/auth/me')).body.user.isAdmin).toBe(true);
    expect((await owner.agent.get('/api/admin')).status).toBe(403);
    expect((await other.agent.get('/api/flashcards/platform')).body.admin).toBe(true);

    expect((await other.agent.post('/api/admin/emails').send({ emails: 'isso não é e-mail' })).status).toBe(400);
  });

  it('não deixa o site sem administrador nem tirar a si mesmo; os do Vercel não saem por aqui', async () => {
    const owner = await signup('Dona');
    await owner.agent.post('/api/admin/emails').send({ emails: owner.email, role: 'ADMIN' });
    const alone = await owner.agent.delete(`/api/admin/emails/${encodeURIComponent(owner.email)}`);
    expect(alone.status).toBe(400);
    expect(alone.body.error).toMatch(/único administrador/);

    process.env.PLATFORM_ADMIN_EMAILS = 'vercel@teste.com';
    const self = await owner.agent.delete(`/api/admin/emails/${encodeURIComponent(owner.email)}`);
    expect(self.body.error).toMatch(/a si mesmo/);
    const env = await owner.agent.delete('/api/admin/emails/vercel@teste.com');
    expect(env.body.error).toMatch(/PLATFORM_ADMIN_EMAILS/);
    const list = await owner.agent.get('/api/admin');
    expect(list.body.admins.map((a: { email: string; source: string }) => [a.email, a.source])).toEqual([
      ['vercel@teste.com', 'env'],
      [owner.email, 'site'],
    ]);
  });

  it('cadastro só para e-mails liberados: quem não está na lista não cria conta; contas antigas continuam', async () => {
    const owner = await signup('Dona');
    const old = await signup('Antiga');
    const mode = await owner.agent.put('/api/admin/signup').send({ mode: 'invite' });
    expect(mode.body.signup).toBe('invite');
    expect((await request(app).get('/api/auth/signup')).body).toEqual({ mode: 'invite' });

    const blocked = await request(app).post('/api/auth/register').send({ name: 'Nova', email: 'nova@teste.com', password: 'senha-segura-123' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toMatch(/e-mails autorizados/);

    await owner.agent.post('/api/admin/emails').send({ emails: 'Nova@Teste.com', role: 'MEMBER', note: 'Turma 2027' });
    const ok = await request(app).post('/api/auth/register').send({ name: 'Nova', email: 'nova@teste.com', password: 'senha-segura-123' });
    expect(ok.status).toBe(201);
    expect(ok.body.user.isAdmin).toBe(false);
    const list = await owner.agent.get('/api/admin');
    expect(list.body.members).toEqual([expect.objectContaining({ email: 'nova@teste.com', note: 'Turma 2027', account: expect.objectContaining({ name: 'Nova' }) })]);

    // Conta que já existia entra normalmente
    expect((await request(app).post('/api/auth/login').send({ email: old.email, password: 'senha-segura-123' })).status).toBe(200);
    // Tirar da lista não apaga a conta
    await owner.agent.delete('/api/admin/emails/nova@teste.com');
    expect((await request(app).post('/api/auth/login').send({ email: 'nova@teste.com', password: 'senha-segura-123' })).status).toBe(200);

    await owner.agent.put('/api/admin/signup').send({ mode: 'open' });
    expect((await request(app).post('/api/auth/register').send({ name: 'Livre', email: 'livre@teste.com', password: 'senha-segura-123' })).status).toBe(201);
  });
});
