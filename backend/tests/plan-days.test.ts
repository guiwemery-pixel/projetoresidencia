import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb, signup } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';
import { addDays, fromDb, startOfWeek, toDb, todayIn } from '../src/lib/dates.js';
import { isoWeekday, nextStudyDay, planWeek, spread, studyDaysOfWeek, weekdaysText } from '../src/modules/plans/distribute.js';
import { requeueOverdue } from '../src/modules/plans/requeue.service.js';

// Cronograma distribuído pelos dias de estudo da pessoa (e não tudo na segunda-feira)

beforeEach(async () => {
  await resetDb();
});

const today = todayIn('America/Sao_Paulo');
const MON = '2026-10-05'; // segunda-feira
const SUBJECTS = ['Hipertensão', 'Insuficiência cardíaca', 'Arritmias', 'Valvopatias', 'Endocardite', 'Pericardite', 'Dislipidemia'];

describe('distribuição: regras', () => {
  it('espalha poucos assuntos e divide muitos em blocos seguidos, com folga no fim da semana', () => {
    expect(isoWeekday(MON)).toBe(1);
    expect(isoWeekday(addDays(MON, 6))).toBe(7);
    expect(spread([3], 5)).toEqual([0]);
    expect(spread([3, 3], 5)).toEqual([0, 3]); // seg e qui
    expect(spread([3, 3, 3], 5)).toEqual([0, 2, 3]);
    expect(spread([3, 3, 3, 3, 3], 5)).toEqual([0, 1, 2, 3, 4]);
    // 7 em 5 dias: 2, 2, 1, 1, 1 (os primeiros dias levam a sobra)
    expect(spread(Array(7).fill(3), 5)).toEqual([0, 0, 1, 1, 2, 3, 4]);
    // 12 em 5: 3, 3, 2, 2, 2
    expect(spread(Array(12).fill(3), 5).filter((d) => d === 0)).toHaveLength(3);
    // Assunto grande ocupa mais: o dia dele leva menos assuntos
    expect(spread([4, 4, 2, 2, 2, 2], 3)).toEqual([0, 1, 1, 2, 2, 2]);
  });

  it('dias de estudo dentro da semana do cronograma (que pode começar em qualquer dia)', () => {
    expect(studyDaysOfWeek(MON, [1, 3, 5])).toEqual([MON, addDays(MON, 2), addDays(MON, 4)]);
    // Semana que começa na quinta: quinta, sexta, (sáb, dom fora), segunda, terça, quarta
    const thu = addDays(MON, 3);
    expect(studyDaysOfWeek(thu, [1, 2, 3, 4, 5])).toEqual([thu, addDays(thu, 1), addDays(thu, 4), addDays(thu, 5), addDays(thu, 6)]);
    expect(weekdaysText([1, 2, 3, 4, 5])).toBe('segunda a sexta');
    expect(weekdaysText([1, 3, 5])).toBe('segunda, quarta e sexta');
    expect(weekdaysText([6, 7])).toBe('sábado e domingo');
    expect(weekdaysText([1, 2, 3, 4, 5, 6, 7])).toBe('todos os dias');
  });

  it('semana atual: estudados ficam onde estavam e pendentes vão de hoje em diante', () => {
    const wed = addDays(MON, 2);
    const items = [
      { id: 'a', weight: 3, status: 'DONE' as const, plannedOn: MON, doneOn: MON },
      { id: 'b', weight: 3, status: 'PENDING' as const, plannedOn: MON, doneOn: null },
      { id: 'c', weight: 3, status: 'PENDING' as const, plannedOn: addDays(MON, 1), doneOn: null },
      { id: 'd', weight: 3, status: 'PENDING' as const, plannedOn: null, doneOn: null },
    ];
    const days = planWeek(MON, items, [1, 2, 3, 4, 5], wed);
    expect(days.get('a')).toBe(MON);
    expect([days.get('b'), days.get('c'), days.get('d')]).toEqual([wed, addDays(MON, 3), addDays(MON, 4)]);
    // Sábado, estudando de segunda a sexta: o que falta fica para os dias que restam (sáb, dom)
    const sat = addDays(MON, 5);
    const late = planWeek(MON, items.slice(1), [1, 2, 3, 4, 5], sat);
    expect([...late.values()].every((d) => d >= sat)).toBe(true);
    expect(nextStudyDay(sat, addDays(MON, 6), [1, 2, 3, 4, 5])).toBe(sat);
    expect(nextStudyDay(MON, addDays(MON, 6), [3, 5])).toBe(wed);
  });
});

describe('cronograma pelos dias de estudo', () => {
  // Uma semana inteira no futuro, começando na segunda
  const week = startOfWeek(addDays(today, 14));
  const items = SUBJECTS.map((subject) => ({ subject, area: 'Clínica Médica', weekStart: week, label: 'Módulo 07' }));
  const day = (n: number) => addDays(week, n);

  it('pergunta os dias e as horas: prévia, criação distribuída e tempo sugerido por assunto', async () => {
    const { agent } = await signup('Distribui');
    const me = (await agent.get('/api/auth/me')).body.user;
    expect(me).toMatchObject({ studyWeekdays: [1, 2, 3, 4, 5], dailyStudyMinutes: 240 });

    const schedule = { weekdays: [5, 1, 3], dailyMinutes: 180 };
    const preview = await agent.post('/api/plans/preview').send({ name: 'Extensivo', items, schedule });
    expect(preview.status).toBe(200);
    expect(preview.body.distribution).toMatchObject({ weekdays: [1, 3, 5], dailyMinutes: 180, averageMinutes: 75 });
    expect(preview.body.distribution.sample.days).toEqual([
      { date: day(0), subjects: SUBJECTS.slice(0, 3) },
      { date: day(2), subjects: SUBJECTS.slice(3, 5) },
      { date: day(4), subjects: SUBJECTS.slice(5) },
    ]);

    const created = await agent.post('/api/plans').send({ name: 'Extensivo', items, schedule });
    expect(created.status).toBe(201);
    // A escolha fica salva para a próxima vez
    expect((await agent.get('/api/auth/me')).body.user).toMatchObject({ studyWeekdays: [1, 3, 5], dailyStudyMinutes: 180 });
    const plan = (await agent.get(`/api/plans/${created.body.id}`)).body;
    expect(plan.undistributed).toBe(0);
    expect(plan.items.map((i: { subject: { name: string } }) => i.subject.name)).toEqual(SUBJECTS);
    expect(plan.items.map((i: { plannedOn: string }) => i.plannedOn)).toEqual([day(0), day(0), day(0), day(2), day(2), day(4), day(4)]);
    // 3 h na segunda divididas por 3 assuntos; na quarta, por 2
    expect(plan.items.map((i: { suggestedMinutes: number }) => i.suggestedMinutes)).toEqual([60, 60, 60, 90, 90, 90, 90]);
    expect(plan.items.every((i: { distributed: boolean; behind: boolean }) => i.distributed && !i.behind)).toBe(true);

    // Calendário: cada assunto no seu dia
    const between = (await agent.get(`/api/plans/items?from=${day(2)}&to=${day(2)}`)).body as { plannedOn: string }[];
    expect(between.filter((i) => i.plannedOn === day(2))).toHaveLength(2);
  });

  it('mudar os dias redistribui; mover um assunto para um dia; empurrar leva o dia junto', async () => {
    const { agent, user } = await signup('Muda');
    const created = await agent.post('/api/plans').send({ name: 'Extensivo', items });
    const planId = created.body.id;
    let plan = (await agent.get(`/api/plans/${planId}`)).body;
    // Padrão: segunda a sexta, 4 h
    expect(plan.items.map((i: { plannedOn: string }) => i.plannedOn)).toEqual([day(0), day(0), day(1), day(1), day(2), day(3), day(4)]);

    const res = await agent.post('/api/plans/distribute').send({ weekdays: [1, 2, 3, 4, 5, 6], dailyMinutes: 300 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ weekdays: [1, 2, 3, 4, 5, 6], dailyMinutes: 300 });
    plan = (await agent.get(`/api/plans/${planId}`)).body;
    expect(plan.items.map((i: { plannedOn: string }) => i.plannedOn)).toEqual([day(0), day(0), day(1), day(2), day(3), day(4), day(5)]);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).studyWeekdays).toEqual([1, 2, 3, 4, 5, 6]);
    expect((await agent.post('/api/plans/distribute').send({ weekdays: [], dailyMinutes: 300 })).status).toBe(400);
    expect((await agent.post('/api/plans/distribute').send({ weekdays: [1], dailyMinutes: 10 })).status).toBe(400);

    // Mover para um dia da semana seguinte: o item muda de semana junto
    const last = plan.items[6];
    const moved = await agent.patch(`/api/plans/items/${last.id}`).send({ plannedOn: day(8) });
    expect(moved.body).toMatchObject({ plannedOn: day(8), weekStart: day(7) });
    // Empurrar 1 semana: o dia vai junto
    await agent.post(`/api/plans/${planId}/shift`).send({ days: 7 });
    plan = (await agent.get(`/api/plans/${planId}`)).body;
    expect(plan.items[0]).toMatchObject({ weekStart: day(7), plannedOn: day(7) });

    // Outra pessoa não redistribui o cronograma de ninguém
    const other = await signup('Outro');
    expect((await other.agent.post('/api/plans/distribute').send({ weekdays: [1], dailyMinutes: 60, planId })).status).toBe(404);
  });

  it('cronograma de antes: sem dia até a pessoa escolher; semanas passadas não mudam', async () => {
    const { agent, user } = await signup('Antigo');
    const past = startOfWeek(addDays(today, -21));
    const created = await agent.post('/api/plans').send({
      name: 'Antigo',
      items: [...items, { subject: 'Hérnias', area: 'Cirurgia', weekStart: past, label: 'Módulo 01' }],
    });
    const planId = created.body.id;
    const pastItem = await prisma.planItem.findFirstOrThrow({ where: { planId, weekStart: toDb(past) } });
    expect(fromDb(pastItem.plannedOn!)).toBe(past);
    // Simula o cronograma importado antes desta versão
    await prisma.planItem.updateMany({ where: { planId, weekStart: toDb(week) }, data: { plannedOn: null } });
    let plan = (await agent.get(`/api/plans/${planId}`)).body;
    expect((await agent.get('/api/plans')).body[0].undistributed).toBe(7);
    expect(plan.items.find((i: { weekStart: string }) => i.weekStart === week)).toMatchObject({ distributed: false, plannedOn: week, suggestedMinutes: null });

    await agent.post('/api/plans/distribute').send({ weekdays: [2, 4], dailyMinutes: 120, planId });
    plan = (await agent.get(`/api/plans/${planId}`)).body;
    expect(plan.undistributed).toBe(0);
    expect(new Set(plan.items.filter((i: { weekStart: string }) => i.weekStart === week).map((i: { plannedOn: string }) => i.plannedOn))).toEqual(new Set([day(1), day(3)]));
    // A semana que já passou continua com o dia que tinha
    expect(fromDb((await prisma.planItem.findUniqueOrThrow({ where: { id: pastItem.id } })).plannedOn!)).toBe(past);
    expect(user.id).toBeTruthy();
  });

  it('assunto que volta ao cronograma (revisão muito atrasada) cai num dia de estudo', async () => {
    const { agent, user } = await signup('Repete');
    const area = (await agent.get('/api/areas')).body.find((a: { name: string }) => a.name === 'Cirurgia');
    await agent.post('/api/studies').send({
      newSubject: { areaId: area.children[0].id, name: 'Apendicite' },
      date: addDays(today, -40),
      durationMinutes: 60,
      methods: ['TEORIA', 'QUESTOES'],
      questions: { total: 20, correct: 15 },
    });
    // Estuda só no fim de semana
    await agent.post('/api/plans/distribute').send({ weekdays: [6, 7], dailyMinutes: 240 });
    const [added] = await requeueOverdue(user.id, today, 20);
    expect(added).toBeTruthy();
    const item = await prisma.planItem.findUniqueOrThrow({ where: { id: added.itemId } });
    const expected = nextStudyDay(today, addDays(startOfWeek(today), 6), [6, 7]);
    expect(fromDb(item.plannedOn!)).toBe(expected);
    expect([6, 7].includes(isoWeekday(expected)) || expected === today).toBe(true);
  });
});
