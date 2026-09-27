import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { resetDb, signup } from './helpers.js';
import { startFakeS3, type FakeS3 } from './fake-s3.mjs';
import { prisma } from '../src/lib/prisma.js';
import { resetBlobStore } from '../src/modules/flashcards/media.js';
import { resetPlatformCache } from '../src/modules/flashcards/platform.js';

// Cards da plataforma: baralhos para todos os usuários, guardados só no R2 (aqui, um S3 falso)

let s3: FakeS3;

beforeAll(async () => {
  s3 = await startFakeS3({ pageSize: 3 });
  Object.assign(process.env, s3.env, { PLATFORM_ADMIN_EMAILS: 'outra@teste.com, Admin@teste.com' });
  resetBlobStore();
});

afterAll(async () => {
  for (const k of Object.keys(s3.env)) delete process.env[k];
  delete process.env.PLATFORM_ADMIN_EMAILS;
  resetBlobStore();
  await s3.close();
});

beforeEach(async () => {
  await resetDb();
  s3.objects.clear();
  resetPlatformCache();
});

const card = (id: string, text: string) => ({ id, front: `<p>${text}?</p>`, back: `<p>${text}!</p>`, tags: ['plataforma'] });
const decks = [
  { id: '1', name: 'Revisados', parent: null, own: 0, total: 3 },
  { id: '2', name: 'Revisados::Cardiologia', parent: '1', own: 2, total: 2 },
  { id: '3', name: 'Revisados::Pediatria', parent: '1', own: 1, total: 1 },
];

async function publish(agent: request.Agent, packageId?: string, text = 'IC') {
  const start = await agent.post('/api/flashcards/platform/publish').send(packageId ? { packageId } : {});
  expect(start.status).toBe(200);
  const { packageId: pkg, version } = start.body;
  const base = `/api/flashcards/platform/publish/${pkg}/${version}`;
  expect((await agent.post(`${base}/decks`).send({ decks: [{ id: '2', cards: [card('a1', text), card('a2', 'FA')] }] })).status).toBe(200);
  expect((await agent.post(`${base}/decks`).send({ decks: [{ id: '3', cards: [card('b1', 'Febre')] }] })).status).toBe(200);
  const fin = await agent.post(`${base}/finish`).send({ name: 'Flashcards Revisados', decks });
  expect(fin.status).toBe(200);
  return { pkg: pkg as string, version: version as string, entry: fin.body };
}

describe('flashcards: cards da plataforma no R2', () => {
  it('o administrador publica e todos os usuários leem; nada vai para o banco', async () => {
    const admin = await signup('Admin');
    const { pkg, version, entry } = await publish(admin.agent);
    expect(entry).toMatchObject({ id: pkg, name: 'Flashcards Revisados', version, cards: 3, decks: 3 });
    expect([...s3.objects.keys()].every((k) => k.startsWith('platform/'))).toBe(true);
    expect(s3.objects.has(`platform/packages/${pkg}/upload.json`)).toBe(false);

    const { agent } = await signup('Bia');
    const list = await agent.get('/api/flashcards/platform');
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ enabled: true, admin: false });
    expect(list.body.packages).toHaveLength(1);
    expect(list.body.packages[0]).toMatchObject({ id: pkg, version, cards: 3, decks });

    const cards = await agent.get('/api/flashcards/platform/cards').query({ package: pkg, version, deck: '2' });
    expect(cards.status).toBe(200);
    expect(cards.headers['cache-control']).toContain('immutable');
    expect(cards.body).toEqual([card('a1', 'IC'), card('a2', 'FA')]);
    expect((await agent.get('/api/flashcards/platform/cards').query({ package: pkg, version, deck: '9' })).status).toBe(404);

    // Nada da plataforma no banco
    expect(await prisma.flashcardRecord.count()).toBe(0);
  });

  it('só administradores publicam ou removem', async () => {
    const { agent } = await signup('Caio');
    expect((await agent.post('/api/flashcards/platform/publish').send({})).status).toBe(403);
    const admin = await signup('Admin');
    expect((await admin.agent.get('/api/flashcards/platform')).body.admin).toBe(true);
    const { pkg } = await publish(admin.agent);
    expect((await agent.delete(`/api/flashcards/platform/packages/${pkg}`)).status).toBe(403);
    expect((await agent.post(`/api/flashcards/platform/publish/${pkg}/abcdef/decks`).send({ decks: [{ id: '2', cards: [] }] })).status).toBe(403);
  });

  it('não termina a publicação sem os cards de todos os baralhos', async () => {
    const admin = await signup('Admin');
    const start = await admin.agent.post('/api/flashcards/platform/publish').send({});
    const base = `/api/flashcards/platform/publish/${start.body.packageId}/${start.body.version}`;
    await admin.agent.post(`${base}/decks`).send({ decks: [{ id: '2', cards: [card('a1', 'IC')] }] });
    const fin = await admin.agent.post(`${base}/finish`).send({ name: 'X', decks });
    expect(fin.status).toBe(409);
    expect(fin.body.error).toContain('Pediatria');
    expect((await admin.agent.get('/api/flashcards/platform')).body.packages).toEqual([]);
  });

  it('uma versão nova troca a anterior (que é apagada) e publicação pela metade é descartada', async () => {
    const admin = await signup('Admin');
    const first = await publish(admin.agent);
    // Começa outra e abandona
    const abandoned = await admin.agent.post('/api/flashcards/platform/publish').send({ packageId: first.pkg });
    await admin.agent.post(`/api/flashcards/platform/publish/${first.pkg}/${abandoned.body.version}/decks`).send({ decks: [{ id: '2', cards: [card('a1', 'x')] }] });
    // A publicação seguinte descarta a abandonada
    const second = await publish(admin.agent, first.pkg, 'Insuficiência cardíaca');
    expect(second.pkg).toBe(first.pkg);
    const keys = [...s3.objects.keys()];
    expect(keys.some((k) => k.includes(`/${first.version}/`))).toBe(false);
    expect(keys.some((k) => k.includes(`/${abandoned.body.version}/`))).toBe(false);
    // A versão antiga não serve mais; a nova sim
    const bia = await signup('Bia');
    expect((await bia.agent.get('/api/flashcards/platform/cards').query({ package: first.pkg, version: first.version, deck: '2' })).status).toBe(404);
    const now = await bia.agent.get('/api/flashcards/platform/cards').query({ package: second.pkg, version: second.version, deck: '2' });
    expect(now.body[0].front).toContain('Insuficiência cardíaca');
    // A parte de uma publicação que não está mais em andamento é recusada
    const late = await admin.agent.post(`/api/flashcards/platform/publish/${first.pkg}/${abandoned.body.version}/decks`).send({ decks: [{ id: '2', cards: [] }] });
    expect(late.status).toBe(409);

    // Remover o pacote apaga tudo dele
    expect((await admin.agent.delete(`/api/flashcards/platform/packages/${first.pkg}`)).status).toBe(204);
    expect([...s3.objects.keys()].filter((k) => k.startsWith('platform/packages/'))).toEqual([]);
    expect((await bia.agent.get('/api/flashcards/platform')).body.packages).toEqual([]);
  });
});

describe('flashcards: cards da plataforma sem o R2', () => {
  it('a aba avisa que não está disponível e a publicação é recusada', async () => {
    const saved = { ...s3.env };
    for (const k of Object.keys(saved)) delete process.env[k];
    resetBlobStore();
    try {
      const admin = await signup('Admin');
      const list = await admin.agent.get('/api/flashcards/platform');
      expect(list.body).toEqual({ enabled: false, admin: true, packages: [] });
      const start = await admin.agent.post('/api/flashcards/platform/publish').send({});
      expect(start.status).toBe(503);
      expect(start.body.error).toContain('R2');
    } finally {
      Object.assign(process.env, saved);
      resetBlobStore();
    }
  });
});
