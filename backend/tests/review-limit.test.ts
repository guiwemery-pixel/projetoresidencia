import { beforeEach, describe, expect, it } from 'vitest';
import { firstArea, resetDb, signup } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';
import { addDays, fromDb, startOfWeek, toDb, todayIn } from '../src/lib/dates.js';
import { requeueOverdue, REQUEUE_PLAN_NAME } from '../src/modules/plans/requeue.service.js';

// Limite de revisões por dia (padrão 5) e revisão muito atrasada de volta ao cronograma

beforeEach(async () => {
  await resetDb();
});

const today = todayIn('America/Sao_Paulo');

async function studySeven() {
  const s = await signup('Limite');
  const cirurgia = await firstArea(s.agent);
  const vias = cirurgia.children.find((c) => c.name === 'Vias Biliares')!;
  const results = [];
  for (let i = 1; i <= 7; i++) {
    // Mesmo resultado (80% em 25 questões) = mesma data calculada para os 7 assuntos
    const res = await s.agent.post('/api/studies').send({
      newSubject: { areaId: vias.id, name: `Assunto ${i}`, size: 'MEDIUM' },
      date: today,
      durationMinutes: 60,
      methods: ['TEORIA', 'QUESTOES'],
      questions: { total: 25, correct: 20 },
    });
    expect(res.status).toBe(201);
    results.push(res.body);
  }
  return { ...s, results };
}

async function perDay(userId: string) {
  const rows = await prisma.review.findMany({ where: { userId, status: 'PENDING' }, select: { scheduledFor: true } });
  const out: Record<string, number> = {};
  for (const r of rows) out[fromDb(r.scheduledFor)] = (out[fromDb(r.scheduledFor)] ?? 0) + 1;
  return out;
}

describe('limite de revisões por dia', () => {
  it('7 assuntos no mesmo dia: 5 ficam e os 2 últimos vão para o dia anterior e o seguinte', async () => {
    const { agent, user, results } = await studySeven();
    const ideal = addDays(today, 20);
    expect(results[4].schedule).toMatchObject({ dueOn: ideal, shiftedFrom: null, dailyReviewLimit: 5 });
    // O 6º já não cabe: a resposta mostra a data nova e a calculada
    expect(results[5].schedule).toMatchObject({ dueOn: addDays(ideal, -1), shiftedFrom: ideal });
    expect(results[6].schedule).toMatchObject({ dueOn: addDays(ideal, 1), shiftedFrom: ideal });
    expect(await perDay(user.id)).toEqual({ [addDays(ideal, -1)]: 1, [ideal]: 5, [addDays(ideal, 1)]: 1 });

    const list = await agent.get('/api/reviews').query({ status: 'PENDING' });
    const moved = list.body.filter((r: { shiftedFrom: string | null }) => r.shiftedFrom);
    expect(moved).toHaveLength(2);
    expect(moved.every((r: { shiftedFrom: string }) => r.shiftedFrom === ideal)).toBe(true);
  });

  it('o limite muda no Perfil: mais vagas trazem as revisões de volta; menos, remaneja', async () => {
    const { agent, user } = await studySeven();
    const ideal = addDays(today, 20);
    const more = await agent.patch('/api/me').send({ dailyReviewLimit: 10 });
    expect(more.body.user.dailyReviewLimit).toBe(10);
    expect(await perDay(user.id)).toEqual({ [ideal]: 7 });
    expect(await prisma.review.count({ where: { userId: user.id, shiftedFrom: { not: null } } })).toBe(0);

    await agent.patch('/api/me').send({ dailyReviewLimit: 3 });
    const three = await perDay(user.id);
    expect(Object.values(three).every((n) => n <= 3)).toBe(true);
    expect(three[ideal]).toBe(3);

    // 0 = sem limite: tudo na data calculada
    await agent.patch('/api/me').send({ dailyReviewLimit: 0 });
    expect(await perDay(user.id)).toEqual({ [ideal]: 7 });
    expect((await agent.patch('/api/me').send({ dailyReviewLimit: -1 })).status).toBe(400);
  });

  it('remarcar à mão: a data escolhida fica, mesmo com o dia cheio', async () => {
    const { agent, user } = await studySeven();
    const ideal = addDays(today, 20);
    const moved = await prisma.review.findFirstOrThrow({ where: { userId: user.id, shiftedFrom: { not: null } } });
    const res = await agent.patch(`/api/reviews/${moved.id}/reschedule`).send({ date: ideal });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ scheduledFor: ideal, shiftedFrom: null, originalScheduledOn: ideal });
    // O dia fica com 6 (escolha da pessoa); a próxima rodada não mexe na remarcada
    await agent.patch('/api/me').send({ dailyReviewLimit: 5 });
    const after = await prisma.review.findUniqueOrThrow({ where: { id: moved.id } });
    expect(fromDb(after.scheduledFor)).toBe(ideal);
  });
});

describe('revisão muito atrasada volta ao cronograma', () => {
  async function overdueSubject(daysLate: number, name = 'Atrasada') {
    const s = await signup(name);
    const cirurgia = await firstArea(s.agent);
    const vias = cirurgia.children.find((c) => c.name === 'Vias Biliares')!;
    const studied = addDays(today, -daysLate - 10);
    const res = await s.agent.post('/api/studies').send({
      newSubject: { areaId: vias.id, name: 'Colelitíase', size: 'MEDIUM' },
      date: studied,
      durationMinutes: 60,
      methods: ['TEORIA', 'QUESTOES'],
      questions: { total: 25, correct: 20 },
    });
    expect(res.status).toBe(201);
    await prisma.review.updateMany({ where: { userId: s.user.id, status: 'PENDING' }, data: { scheduledFor: toDb(addDays(today, -daysLate)) } });
    return { ...s, subjectId: res.body.session.subject.id as string };
  }

  it('atrasada há 20 dias: entra em "Assuntos para repetir" nesta semana, com aviso', async () => {
    const { agent, user, subjectId } = await overdueSubject(20);
    const agenda = await agent.get('/api/plans/agenda');
    expect(agenda.status).toBe(200);
    const items = [...agenda.body.overdue, ...agenda.body.thisWeek];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ planName: REQUEUE_PLAN_NAME, weekStart: startOfWeek(today), subject: { id: subjectId, name: 'Colelitíase' } });
    expect(items[0].label).toMatch(/^Revisão atrasada desde \d{2}\/\d{2}$/);
    const notes = await agent.get('/api/notifications');
    expect(JSON.stringify(notes.body)).toContain('Colelitíase voltou para o cronograma desta semana');

    // Estudar o assunto conclui o item e a revisão
    const study = await agent.post('/api/studies').send({ subjectId, date: today, durationMinutes: 50, methods: ['TEORIA', 'QUESTOES'], questions: { total: 25, correct: 22 } });
    expect(study.body.planItem).toMatchObject({ id: items[0].id });
    expect(study.body.completedReviewId).toBeTruthy();
    expect(await prisma.planItem.count({ where: { userId: user.id, status: 'PENDING' } })).toBe(0);
  });

  it('menos de 20 dias não volta; pulado não volta de novo; 0 desliga', async () => {
    const early = await overdueSubject(19);
    expect(await requeueOverdue(early.user.id, today)).toEqual([]);

    const late = await overdueSubject(30, 'Atrasada Trinta');
    const [added] = await requeueOverdue(late.user.id, today);
    expect(added).toMatchObject({ subjectId: late.subjectId, name: 'Colelitíase', since: addDays(today, -30) });
    // Já está no cronograma: não duplica
    expect(await requeueOverdue(late.user.id, today)).toEqual([]);
    // Pulado: não volta neste atraso
    await late.agent.patch(`/api/plans/items/${added.itemId}`).send({ status: 'SKIPPED' });
    expect(await requeueOverdue(late.user.id, today)).toEqual([]);

    const off = await overdueSubject(40, 'Atrasada Quarenta');
    await off.agent.patch('/api/me').send({ requeueOverdueDays: 0 });
    expect(await requeueOverdue(off.user.id, today)).toEqual([]);
    expect(await prisma.studyPlan.count({ where: { userId: off.user.id } })).toBe(0);
  });
});
