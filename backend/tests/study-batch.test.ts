import { beforeEach, describe, expect, it } from 'vitest';
import { firstArea, resetDb, signup } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';
import { addDays, fromDb, todayIn } from '../src/lib/dates.js';

// Um estudo que englobou vários assuntos: cada assunto tem a sua parte e a sua revisão

beforeEach(async () => {
  await resetDb();
});

const today = todayIn('America/Sao_Paulo');
const NAMES = ['Pancreatite aguda', 'Pancreatite crônica', 'Neoplasias de pâncreas'];

async function setup(name: string) {
  const s = await signup(name);
  const cirurgia = await firstArea(s.agent);
  return { ...s, areaId: cirurgia.children[0].id };
}

describe('estudo com vários assuntos', () => {
  it('30 questões em 3 assuntos: cada um vira um estudo com a sua parte e a sua própria revisão', async () => {
    const { agent, user, areaId } = await setup('Varios');
    const split = [
      { total: 10, correct: 9 },
      { total: 10, correct: 6 },
      { total: 10, correct: 3 },
    ];
    const res = await agent.post('/api/studies/batch').send({
      date: today,
      methods: ['QUESTOES'],
      quality: 3,
      items: NAMES.map((name, i) => ({ newSubject: { areaId, name, size: 'MEDIUM' }, durationMinutes: 20, questions: { ...split[i], board: 'ENARE' } })),
    });
    expect(res.status).toBe(201);
    expect(res.body.results).toHaveLength(3);
    expect(res.body.results.map((r: { session: { subject: { name: string } } }) => r.session.subject.name)).toEqual(NAMES);
    expect(res.body.results.map((r: { session: { questions: { total: number; correct: number } } }) => [r.session.questions.total, r.session.questions.correct])).toEqual([
      [10, 9],
      [10, 6],
      [10, 3],
    ]);

    // Três estudos e três revisões pendentes, uma por assunto
    expect(await prisma.studySession.count({ where: { userId: user.id } })).toBe(3);
    const pending = await prisma.review.findMany({ where: { userId: user.id, status: 'PENDING' }, include: { subject: true } });
    expect(pending.map((r) => r.subject.name).sort()).toEqual([...NAMES].sort());
    // Quem acertou mais revisa mais tarde
    const due = Object.fromEntries(res.body.results.map((r: { session: { subject: { name: string } }; schedule: { dueOn: string } }) => [r.session.subject.name, r.schedule.dueOn]));
    expect(due['Pancreatite aguda'] >= due['Pancreatite crônica']).toBe(true);
    expect(due['Pancreatite crônica'] >= due['Neoplasias de pâncreas']).toBe(true);
    expect(due['Pancreatite aguda'] > due['Neoplasias de pâncreas']).toBe(true);

    // Igual a registrar cada assunto separadamente
    const other = await setup('Separado');
    const dates = [];
    for (const [i, name] of NAMES.entries()) {
      const one = await other.agent.post('/api/studies').send({
        date: today,
        methods: ['QUESTOES'],
        quality: 3,
        durationMinutes: 20,
        newSubject: { areaId: other.areaId, name, size: 'MEDIUM' },
        questions: split[i],
      });
      dates.push(one.body.schedule.dueOn);
    }
    expect(res.body.results.map((r: { schedule: { dueOn: string } }) => r.schedule.dueOn)).toEqual(dates);
  });

  it('assuntos que já tinham revisão pendente: cada revisão é concluída e reagendada', async () => {
    const { agent, user, areaId } = await setup('Pendentes');
    const ids: string[] = [];
    for (const name of NAMES) {
      const r = await agent.post('/api/studies').send({
        date: addDays(today, -25),
        methods: ['TEORIA', 'QUESTOES'],
        durationMinutes: 60,
        newSubject: { areaId, name, size: 'MEDIUM' },
        questions: { total: 25, correct: 20 },
      });
      ids.push(r.body.session.subject.id);
    }
    const before = await prisma.review.findMany({ where: { userId: user.id, status: 'PENDING' } });
    expect(before).toHaveLength(3);

    const res = await agent.post('/api/studies/batch').send({
      date: today,
      methods: ['QUESTOES'],
      items: ids.map((subjectId) => ({ subjectId, durationMinutes: 15, questions: { total: 10, correct: 8 } })),
    });
    expect(res.status).toBe(201);
    for (const r of res.body.results) expect(r.completedReviewId).toBeTruthy();
    const done = await prisma.review.findMany({ where: { id: { in: before.map((r) => r.id) } } });
    expect(done.every((r) => r.status === 'DONE')).toBe(true);
    const next = await prisma.review.findMany({ where: { userId: user.id, status: 'PENDING' } });
    expect(next).toHaveLength(3);
    expect(next.every((r) => fromDb(r.scheduledFor) > today)).toBe(true);
    // Um estudo por assunto, com o tempo de cada um
    const sessions = await prisma.studySession.findMany({ where: { userId: user.id, studiedOn: new Date(today + 'T00:00:00Z') } });
    expect(sessions.map((s) => s.durationMinutes)).toEqual([15, 15, 15]);
  });

  it('valida: pelo menos dois assuntos, sem repetir, acertos ≤ questões, sem data futura', async () => {
    const { agent, areaId } = await setup('Valida');
    const first = await agent.post('/api/studies').send({ date: today, methods: ['TEORIA'], durationMinutes: 30, newSubject: { areaId, name: 'Pancreatite aguda' } });
    const id = first.body.session.subject.id;
    const item = { subjectId: id, durationMinutes: 10 };
    expect((await agent.post('/api/studies/batch').send({ date: today, methods: ['TEORIA'], items: [item] })).status).toBe(400);
    const dup = await agent.post('/api/studies/batch').send({ date: today, methods: ['TEORIA'], items: [item, item] });
    expect(dup.status).toBe(400);
    expect(dup.body.error).toMatch(/mais de uma vez/);
    const bad = await agent.post('/api/studies/batch').send({
      date: today,
      methods: ['QUESTOES'],
      items: [
        { ...item, questions: { total: 5, correct: 6 } },
        { newSubject: { areaId, name: 'Outro' }, durationMinutes: 10 },
      ],
    });
    expect(bad.status).toBe(400);
    const future = await agent.post('/api/studies/batch').send({
      date: addDays(today, 1),
      methods: ['TEORIA'],
      items: [item, { newSubject: { areaId, name: 'Outro' }, durationMinutes: 10 }],
    });
    expect(future.status).toBe(400);
  });
});
