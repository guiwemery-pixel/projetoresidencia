import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, resetDb, signup } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';
import { purgeOldTombstones } from '../src/modules/flashcards/flashcards.service.js';

beforeEach(async () => {
  await resetDb();
});

type Agent = request.Agent;
const card = (id: string, extra: Record<string, unknown> = {}) => ({ id, front: `Pergunta ${id}?`, back: 'Resposta', deckId: 'd1', tags: [], state: 'new', ...extra });

async function pushOps(agent: Agent, ops: unknown[], epoch?: number) {
  return agent.post('/api/flashcards/sync').send({ epoch, ops });
}

async function pullAll(agent: Agent, since = 0, epoch?: number) {
  const records: { s: string; id: string; d: Record<string, unknown> | null }[] = [];
  let cursor = since;
  let meta: Record<string, unknown> = {};
  for (let i = 0; i < 50; i++) {
    const res = await agent.get('/api/flashcards/sync').query({ since: cursor, ...(epoch ? { epoch } : {}) });
    expect(res.status).toBe(200);
    meta = res.body;
    if (res.body.reset) return { reset: true, records, cursor, meta };
    records.push(...res.body.records);
    cursor = res.body.cursor;
    if (!res.body.more) break;
  }
  return { reset: false, records, cursor, meta };
}

describe('flashcards: sincronização entre aparelhos', () => {
  it('exige login', async () => {
    expect((await request(app).get('/api/flashcards/sync')).status).toBe(401);
    expect((await request(app).post('/api/flashcards/sync').send({ ops: [] })).status).toBe(401);
  });

  it('envia, baixa tudo e depois só o que mudou', async () => {
    const { agent } = await signup('Ana');
    const first = await pushOps(agent, [
      { s: 'cards', id: 'c1', d: card('c1') },
      { s: 'cards', id: 'c2', d: card('c2') },
      { s: 'decks', id: 'd1', d: { id: 'd1', name: 'Cirurgia::Estômago' } },
      { s: 'kv', id: 'settings', d: { key: 'settings', value: { newPerDay: 30 } } },
    ]);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ version: 4, epoch: 1 });
    expect(first.body.bytes).toBeGreaterThan(0);

    // Outro aparelho: primeira carga
    const all = await pullAll(agent);
    expect(all.records).toHaveLength(4);
    expect(all.meta.total).toBe(4);
    const c1 = all.records.find((r) => r.id === 'c1')!;
    expect(c1.d).toEqual(card('c1'));
    expect(all.cursor).toBe(4);

    // Alteração e exclusão chegam como mudanças depois do cursor
    await pushOps(agent, [{ s: 'cards', id: 'c1', d: card('c1', { state: 'review', stability: 3.141592653589793 }) }, { s: 'cards', id: 'c2', del: true }], 1);
    const delta = await pullAll(agent, all.cursor, 1);
    expect(delta.records.map((r) => [r.id, r.d === null])).toEqual([
      ['c1', false],
      ['c2', true],
    ]);
    expect(delta.records[0].d?.stability).toBe(3.141592653589793);
    expect((await pullAll(agent, delta.cursor, 1)).records).toHaveLength(0);

    // Na primeira carga as exclusões não vêm
    const fresh = await pullAll(agent);
    expect(fresh.records.map((r) => r.id).sort()).toEqual(['c1', 'd1', 'settings']);
  });

  it('a última gravação de um mesmo registro vence (também dentro do lote)', async () => {
    const { agent } = await signup('Bia');
    await pushOps(agent, [
      { s: 'cards', id: 'x', d: card('x', { back: 'primeira' }) },
      { s: 'cards', id: 'x', d: card('x', { back: 'segunda' }) },
    ]);
    await pushOps(agent, [{ s: 'cards', id: 'x', d: card('x', { back: 'terceira' }) }]);
    const all = await pullAll(agent);
    expect(all.records).toHaveLength(1);
    expect(all.records[0].d?.back).toBe('terceira');
  });

  it('pagina respostas grandes sem perder registros', async () => {
    const { agent } = await signup('Caio');
    const big = 'x'.repeat(300_000);
    const ops = Array.from({ length: 12 }, (_, i) => ({ s: 'sources', id: `s${i}`, d: { id: `s${i}`, text: big } }));
    for (let i = 0; i < ops.length; i += 4) expect((await pushOps(agent, ops.slice(i, i + 4))).status).toBe(200);
    const res = await agent.get('/api/flashcards/sync').query({ since: 0 });
    expect(res.body.more).toBe(true);
    expect(res.body.records.length).toBeLessThan(12);
    const all = await pullAll(agent);
    expect(all.records.map((r) => r.id).sort()).toEqual(ops.map((o) => o.id).sort());
  });

  it('cada usuário só vê os próprios flashcards', async () => {
    const a = await signup('Dora');
    const b = await signup('Edu');
    await pushOps(a.agent, [{ s: 'cards', id: 'segredo', d: card('segredo') }]);
    await pushOps(b.agent, [{ s: 'cards', id: 'segredo', d: card('segredo', { back: 'do Edu' }) }]);
    const fromA = await pullAll(a.agent);
    const fromB = await pullAll(b.agent);
    expect(fromA.records[0].d?.back).toBe('Resposta');
    expect(fromB.records[0].d?.back).toBe('do Edu');
    const search = await b.agent.get('/api/flashcards/search').query({ q: 'Pergunta' });
    expect(search.body.total).toBe(1);
    expect(search.body.cards[0].back).toBe('do Edu');
  });

  it('restaurar/apagar tudo muda o epoch e os outros aparelhos recomeçam', async () => {
    const { agent } = await signup('Fábio');
    await pushOps(agent, [{ s: 'cards', id: 'c1', d: card('c1') }]);
    const before = await pullAll(agent);

    const reset = await agent.post('/api/flashcards/reset');
    expect(reset.status).toBe(200);
    expect(reset.body.epoch).toBe(2);
    expect((await pullAll(agent)).records).toHaveLength(0);

    // Aparelho antigo: o pull pede para recomeçar e o push não grava nada
    expect((await pullAll(agent, before.cursor, 1)).reset).toBe(true);
    const stale = await pushOps(agent, [{ s: 'cards', id: 'velho', d: card('velho') }], 1);
    expect(stale.status).toBe(200);
    expect(stale.body).toEqual({ reset: true, epoch: 2 });
    expect((await pullAll(agent)).records).toHaveLength(0);

    // Depois de recomeçar, grava normalmente no epoch novo
    expect((await pushOps(agent, [{ s: 'cards', id: 'novo', d: card('novo') }], 2)).status).toBe(200);
    expect((await pullAll(agent)).records.map((r) => r.id)).toEqual(['novo']);
  });

  it('pede para recomeçar quando as exclusões antigas já foram descartadas', async () => {
    const { agent, user } = await signup('Gabi');
    await pushOps(agent, [{ s: 'cards', id: 'c1', d: card('c1') }]);
    const old = await pullAll(agent);
    await pushOps(agent, [{ s: 'cards', id: 'c1', del: true }], 1);
    await prisma.flashcardRecord.updateMany({ where: { userId: user.id }, data: { updatedAt: new Date(Date.now() - 200 * 86400_000) } });
    await purgeOldTombstones(90);
    expect(await prisma.flashcardRecord.count({ where: { userId: user.id } })).toBe(0);
    expect((await pullAll(agent, old.cursor, 1)).reset).toBe(true);
  });

  it('respeita a cota da conta e contabiliza exclusões', async () => {
    const { agent } = await signup('Hugo');
    const huge = 'y'.repeat(3_000_000);
    let last = { status: 200, body: {} as { bytes?: number; error?: string } };
    for (let i = 0; i < 20 && last.status === 200; i++) last = await pushOps(agent, [{ s: 'media', id: `img${i}`, d: { name: `img${i}`, dataUrl: huge } }]);
    expect(last.status).toBe(413);
    expect(last.body.error).toMatch(/limite de 20 MB/);
    const status = await agent.get('/api/flashcards/status');
    expect(status.body.bytes).toBeLessThanOrEqual(status.body.quota);
    // Excluir libera espaço
    const del = await pushOps(agent, [{ s: 'media', id: 'img0', del: true }]);
    expect(del.status).toBe(200);
    expect(del.body.bytes).toBeLessThan(status.body.bytes);
  });

  it('valida tabelas, ids e tamanho dos registros', async () => {
    const { agent } = await signup('Iara');
    expect((await pushOps(agent, [{ s: 'users', id: 'x', d: {} }])).status).toBe(400);
    expect((await pushOps(agent, [{ s: 'cards', id: '', d: {} }])).status).toBe(400);
    expect((await pushOps(agent, [{ s: 'cards', id: 'x' }])).status).toBe(400);
    const tooBig = await pushOps(agent, [{ s: 'media', id: 'x', d: { dataUrl: 'z'.repeat(3_600_000) } }]);
    expect(tooBig.status).toBe(413);
  });

  it('gravações simultâneas recebem versões sem buracos', async () => {
    const { agent } = await signup('Juca');
    const res = await Promise.all(Array.from({ length: 8 }, (_, i) => pushOps(agent, [{ s: 'logs', id: `l${i}`, d: { id: `l${i}` } }, { s: 'logs', id: `m${i}`, d: { id: `m${i}` } }])));
    expect(res.every((r) => r.status === 200)).toBe(true);
    const versions = res.map((r) => r.body.version).sort((a, b) => a - b);
    expect(versions).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
    expect((await pullAll(agent)).records).toHaveLength(16);
  });
});

describe('flashcards: resumo e busca global', () => {
  it('guarda o resumo do dia para a página inicial', async () => {
    const { agent } = await signup('Lia');
    expect((await agent.get('/api/flashcards/summary')).body).toEqual({ summary: null, updatedAt: null });
    const summary = { dayStart: 1, due: 12, newToday: 5, forecast: [12, 3, 4] };
    expect((await agent.put('/api/flashcards/summary').send(summary)).status).toBe(204);
    const res = await agent.get('/api/flashcards/summary');
    expect(res.body.summary).toEqual(summary);
    expect(res.body.updatedAt).toBeTruthy();
    expect((await agent.put('/api/flashcards/summary').send({ big: 'x'.repeat(20_000) })).status).toBe(413);
  });

  it('a busca global inclui os cards (texto sem HTML) com o nome do baralho', async () => {
    const { agent } = await signup('Mia');
    await pushOps(agent, [
      { s: 'cards', id: 'c1', d: card('c1', { front: 'Classificação de <b>Borrmann</b>?', back: 'I a IV&nbsp;tipos', deckId: 'd9' }) },
      { s: 'cards', id: 'c2', d: card('c2', { front: 'Outro', back: 'nada' }) },
      { s: 'decks', id: 'd9', d: { id: 'd9', name: 'Câncer gástrico' } },
    ]);
    const res = await agent.get('/api/search').query({ q: 'borrmann' });
    expect(res.status).toBe(200);
    expect(res.body.flashcards.total).toBe(1);
    expect(res.body.flashcards.cards[0]).toEqual({ id: 'c1', front: 'Classificação de Borrmann?', back: 'I a IV tipos', deck: 'Câncer gástrico' });
    // "front" é nome de campo no JSON, não conteúdo do card
    expect((await agent.get('/api/search').query({ q: 'front' })).body.flashcards.total).toBe(0);
  });

  it('excluir a conta apaga os flashcards', async () => {
    const { agent, user } = await signup('Nina');
    await pushOps(agent, [{ s: 'cards', id: 'c1', d: card('c1') }]);
    await agent.put('/api/flashcards/summary').send({ due: 1 });
    expect((await agent.delete('/api/me').send({ password: 'senha-segura-123' })).status).toBe(204);
    expect(await prisma.flashcardRecord.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.flashcardSync.count({ where: { userId: user.id } })).toBe(0);
  });
});
