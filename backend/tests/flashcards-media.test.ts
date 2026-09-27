import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, resetDb, signup } from './helpers.js';
import { startFakeS3, type FakeS3 } from './fake-s3.mjs';
import { prisma } from '../src/lib/prisma.js';
import { mediaKey, resetBlobStore } from '../src/modules/flashcards/media.js';
import { migrateMediaToBlobStore } from '../src/modules/flashcards/flashcards.service.js';

// Imagens dos flashcards no Cloudflare R2 (aqui, um S3 falso em memória)

let s3: FakeS3;

beforeAll(async () => {
  s3 = await startFakeS3({ pageSize: 2 });
  Object.assign(process.env, s3.env);
  resetBlobStore();
});

afterAll(async () => {
  for (const k of Object.keys(s3.env)) delete process.env[k];
  resetBlobStore();
  await s3.close();
});

beforeEach(async () => {
  await resetDb();
  s3.objects.clear();
});

const png = (n: number, fill = 7) => Buffer.alloc(n, fill);
const dataUrl = (buf: Buffer, type = 'image/png') => `data:${type};base64,${buf.toString('base64')}`;
const pushMedia = (agent: request.Agent, name: string, buf: Buffer, epoch?: number) =>
  agent.post('/api/flashcards/sync').send({ epoch, ops: [{ s: 'media', id: name, d: { name, dataUrl: dataUrl(buf) } }] });

describe('flashcards: imagens no R2', () => {
  it('a imagem vai para o bucket e o banco guarda só nome, tipo e tamanho', async () => {
    const { agent, user } = await signup('Ana');
    const img = png(5000);
    const res = await pushMedia(agent, 'figura 1.png', img);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ mediaStore: 'r2', mediaBytes: 5000 });
    expect(s3.objects.get(mediaKey(user.id, 'figura 1.png'))).toEqual(img);

    const rec = await prisma.flashcardRecord.findUniqueOrThrow({ where: { userId_store_id: { userId: user.id, store: 'media', id: 'figura 1.png' } } });
    expect(JSON.parse(rec.data!)).toEqual({ name: 'figura 1.png', type: 'image/png', size: 5000, stored: 'r2' });
    expect(rec.size).toBeLessThan(200);
    expect(rec.blobSize).toBe(5000);

    // Outro aparelho recebe os dados da imagem e baixa o arquivo pela API
    const pulled = await agent.get('/api/flashcards/sync').query({ since: 0 });
    expect(pulled.body.records[0].d).toEqual({ name: 'figura 1.png', type: 'image/png', size: 5000, stored: 'r2' });
    const file = await agent.get('/api/flashcards/media').query({ name: 'figura 1.png' }).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(file.status).toBe(200);
    expect(file.body).toEqual(img);
    expect(file.headers['content-type']).toBe('application/octet-stream');
    expect(file.headers['content-disposition']).toBe('attachment');
    expect(file.headers['content-security-policy']).toContain('sandbox');
  });

  it('só o dono baixa a imagem', async () => {
    const a = await signup('Bia');
    const b = await signup('Caio');
    await pushMedia(a.agent, 'x.png', png(100));
    expect((await b.agent.get('/api/flashcards/media').query({ name: 'x.png' })).status).toBe(404);
    expect((await request(app).get('/api/flashcards/media').query({ name: 'x.png' })).status).toBe(401);
  });

  it('excluir a imagem apaga o arquivo e libera a cota de imagens', async () => {
    const { agent, user } = await signup('Dora');
    await pushMedia(agent, 'a.png', png(3000));
    const del = await agent.post('/api/flashcards/sync').send({ ops: [{ s: 'media', id: 'a.png', del: true }] });
    expect(del.body.mediaBytes).toBe(0);
    expect(s3.objects.has(mediaKey(user.id, 'a.png'))).toBe(false);
    expect((await agent.get('/api/flashcards/media').query({ name: 'a.png' })).status).toBe(404);
  });

  it('respeita a cota de imagens (e não sobe nada além dela)', async () => {
    const { agent, user } = await signup('Edu');
    const mb = 1024 * 1024;
    expect((await pushMedia(agent, 'um.png', png(1.5 * mb))).status).toBe(200);
    const over = await pushMedia(agent, 'dois.png', png(1 * mb));
    expect(over.status).toBe(413);
    expect(over.body.error).toMatch(/imagens .* limite de 2 MB/);
    expect(s3.objects.has(mediaKey(user.id, 'dois.png'))).toBe(false);
    // Trocar a imagem por uma menor continua valendo
    expect((await pushMedia(agent, 'um.png', png(0.5 * mb))).status).toBe(200);
    expect((await agent.get('/api/flashcards/status')).body.mediaBytes).toBe(0.5 * mb);
  });

  it('recusa data URL inválida e imagem grande demais', async () => {
    const { agent } = await signup('Fábio');
    const bad = await agent.post('/api/flashcards/sync').send({ ops: [{ s: 'media', id: 'x', d: { name: 'x', dataUrl: 'não é imagem' } }] });
    expect(bad.status).toBe(400);
    expect((await pushMedia(agent, 'y', png(3_100_000))).status).toBe(413);
  });

  it('restaurar/apagar tudo e excluir a conta apagam as imagens do bucket', async () => {
    const a = await signup('Gabi');
    const b = await signup('Hugo');
    for (const n of ['1.png', '2.png', '3.png']) await pushMedia(a.agent, n, png(10));
    await pushMedia(b.agent, 'b.png', png(10));
    expect(s3.objects.size).toBe(4);

    await a.agent.post('/api/flashcards/reset');
    expect([...s3.objects.keys()]).toEqual([mediaKey(b.user.id, 'b.png')]);
    expect((await a.agent.get('/api/flashcards/status')).body.mediaBytes).toBe(0);

    expect((await b.agent.delete('/api/me').send({ password: 'senha-segura-123' })).status).toBe(204);
    expect(s3.objects.size).toBe(0);
  });

  it('a faxina leva para o R2 as imagens que estavam no banco, sem mudar a versão', async () => {
    const { agent, user } = await signup('Iara');
    const img = png(800, 3);
    const meta = JSON.stringify({ name: 'velha.png', dataUrl: dataUrl(img) });
    await prisma.flashcardRecord.create({ data: { userId: user.id, store: 'media', id: 'velha.png', data: meta, size: meta.length, version: 7n } });
    await prisma.flashcardSync.create({ data: { userId: user.id, version: 7n, bytes: meta.length } });

    // Ainda no banco: a API entrega a partir do próprio registro
    expect((await agent.get('/api/flashcards/media').query({ name: 'velha.png' })).status).toBe(200);

    expect(await migrateMediaToBlobStore()).toEqual({ migrated: 1, done: true });
    expect(s3.objects.get(mediaKey(user.id, 'velha.png'))).toEqual(img);
    const rec = await prisma.flashcardRecord.findUniqueOrThrow({ where: { userId_store_id: { userId: user.id, store: 'media', id: 'velha.png' } } });
    expect(rec.version).toBe(7n);
    expect(JSON.parse(rec.data!).stored).toBe('r2');
    const st = (await agent.get('/api/flashcards/status')).body;
    expect(st.mediaBytes).toBe(800);
    expect(st.bytes).toBe(rec.size);
    expect(await migrateMediaToBlobStore()).toEqual({ migrated: 0, done: true });
  });

  it('todos os pedidos ao bucket vão assinados (AWS4) e a listagem é paginada', async () => {
    const { agent } = await signup('Juca');
    for (const n of ['1', '2', '3', '4', '5']) await pushMedia(agent, n, png(5));
    await agent.post('/api/flashcards/reset');
    expect(s3.objects.size).toBe(0);
    expect(s3.requests.filter((r) => r.query.includes('list-type=2')).length).toBeGreaterThanOrEqual(3);
  });
});
