import { beforeEach, describe, expect, it } from 'vitest';
import { firstArea, resetDb, signup } from './helpers.js';
import { addDays, startOfWeek, todayIn } from '../src/lib/dates.js';
import { composeWeeks, orderSubjects, weekIndexes, weeksUntil } from '../src/modules/plans/compose.js';

// Cronograma montado na plataforma (sem PDF): assuntos escolhidos, ritmo e ordem

describe('montar cronograma: regras', () => {
  it('intercalar espalha cada grande área pelo cronograma inteiro', () => {
    const s = (area: string, n: number) => ({ area, name: `${area}${n}` });
    const list = [s('A', 1), s('A', 2), s('A', 3), s('A', 4), s('B', 1), s('B', 2), s('C', 1)];
    expect(orderSubjects(list, 'interleave').map((x) => x.name)).toEqual(['A1', 'B1', 'A2', 'C1', 'A3', 'B2', 'A4']);
    expect(orderSubjects(list, 'sequence').map((x) => x.name)).toEqual(list.map((x) => x.name));
  });

  it('ritmo: N por semana, ou repartidos até uma data (as primeiras semanas levam a sobra)', () => {
    const MON = '2026-10-12';
    expect(weekIndexes(7, { kind: 'perWeek', perWeek: 3 }, MON)).toEqual([0, 0, 0, 1, 1, 1, 2]);
    expect(weeksUntil(MON, addDays(MON, 20))).toBe(3);
    expect(weeksUntil(MON, MON)).toBe(1);
    expect(weekIndexes(7, { kind: 'until', until: addDays(MON, 20) }, MON)).toEqual([0, 0, 0, 1, 1, 2, 2]);
    // Menos assuntos que semanas: um a cada tantas semanas até a data
    expect(weekIndexes(2, { kind: 'until', until: addDays(MON, 27) }, MON)).toEqual([0, 2]);
    const placed = composeWeeks([{ area: 'A' }, { area: 'B' }, { area: 'A' }], { start: MON, pace: { kind: 'perWeek', perWeek: 2 }, order: 'sequence' });
    expect(placed.map((p) => p.weekStart)).toEqual([MON, MON, addDays(MON, 7)]);
  });
});

describe('montar cronograma na plataforma', () => {
  beforeEach(async () => {
    await resetDb();
  });
  const today = todayIn('America/Sao_Paulo');
  const start = startOfWeek(addDays(today, 7));

  async function setup(name: string) {
    const s = await signup(name);
    const cm = await firstArea(s.agent, 'Clínica Médica');
    const cir = await firstArea(s.agent, 'Cirurgia');
    const mk = async (areaId: string, n: string) => (await s.agent.post('/api/subjects').send({ areaId, name: n })).body.id as string;
    const ids = {
      has: await mk(cm.children[0].id, 'Hipertensão'),
      ic: await mk(cm.children[0].id, 'Insuficiência cardíaca'),
      asma: await mk(cm.children[1].id, 'Asma'),
      hernia: await mk(cir.children[0].id, 'Hérnias'),
    };
    return { ...s, ids };
  }

  it('escolhe assuntos da conta e um novo, intercala as áreas e cria com "Semana 01", "Semana 02"…', async () => {
    const { agent, ids } = await setup('Monta');
    const body = {
      name: 'Meu extensivo',
      start,
      pace: { kind: 'perWeek', perWeek: 2 },
      order: 'interleave',
      subjects: [{ subjectId: ids.has }, { subjectId: ids.ic }, { subjectId: ids.asma }, { subjectId: ids.hernia }, { name: 'Apendicite', area: 'Cirurgia' }, { subjectId: ids.has }],
      schedule: { weekdays: [1, 3, 5], dailyMinutes: 180 },
    };
    const preview = await agent.post('/api/plans/compose/preview').send(body);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ items: 5, skipped: 1, newSubjects: 1, firstWeek: start, lastWeek: addDays(start, 14) });
    // Clínica Médica (3) e Cirurgia (2) intercaladas
    expect(preview.body.weeks.map((w: { label: string; subjects: { name: string }[] }) => [w.label, w.subjects.map((s) => s.name)])).toEqual([
      ['Semana 01', ['Hipertensão', 'Hérnias']],
      ['Semana 02', ['Insuficiência cardíaca', 'Apendicite']],
      ['Semana 03', ['Asma']],
    ]);
    expect(preview.body.distribution).toMatchObject({ weekdays: [1, 3, 5], dailyMinutes: 180 });

    const created = await agent.post('/api/plans/compose').send(body);
    expect(created.status).toBe(201);
    const plan = (await agent.get(`/api/plans/${created.body.id}`)).body;
    expect(plan).toMatchObject({ name: 'Meu extensivo', total: 5, undistributed: 0 });
    // Usa os mesmos assuntos (não cria cópias) e cada um já tem o seu dia de estudo
    const has = plan.items.find((i: { subject: { name: string } }) => i.subject.name === 'Hipertensão');
    expect(has.subject.id).toBe(ids.has);
    expect(plan.items.every((i: { distributed: boolean }) => i.distributed)).toBe(true);
    const names = ((await agent.get('/api/subjects')).body as { name: string }[]).map((s) => s.name);
    expect(names.filter((n) => n === 'Hipertensão')).toHaveLength(1);
    expect(names).toContain('Apendicite');
  });

  it('até a data da prova e acrescentar assuntos a um cronograma que já existe', async () => {
    const { agent, ids } = await setup('Acrescenta');
    const first = await agent.post('/api/plans/compose').send({
      start,
      pace: { kind: 'until', until: addDays(start, 13) },
      order: 'sequence',
      subjects: [{ subjectId: ids.has }, { subjectId: ids.ic }, { subjectId: ids.asma }],
    });
    expect(first.status).toBe(201);
    let plan = (await agent.get(`/api/plans/${first.body.id}`)).body;
    expect(plan.name).toBe('Meu cronograma');
    expect(plan.items.map((i: { weekStart: string }) => i.weekStart)).toEqual([start, start, addDays(start, 7)]);

    // Acrescenta: o que já está pendente não entra de novo; a semana nova continua a numeração
    const more = { planId: first.body.id, start: addDays(start, 14), pace: { kind: 'perWeek', perWeek: 5 }, order: 'sequence', subjects: [{ subjectId: ids.has }, { subjectId: ids.hernia }] };
    const preview = (await agent.post('/api/plans/compose/preview').send(more)).body;
    expect(preview).toMatchObject({ items: 1, skipped: 1 });
    expect(preview.weeks[0].label).toBe('Semana 03');
    expect((await agent.post('/api/plans/compose').send(more)).status).toBe(201);
    plan = (await agent.get(`/api/plans/${first.body.id}`)).body;
    expect(plan.total).toBe(4);
    expect(plan.items.at(-1)).toMatchObject({ label: 'Semana 03', subject: { name: 'Hérnias' }, distributed: true });

    // Só repetidos: nada a acrescentar
    const again = await agent.post('/api/plans/compose').send({ ...more, subjects: [{ subjectId: ids.hernia }] });
    expect(again.status).toBe(400);
  });

  it('valida: data final antes do início, assunto ou cronograma de outra pessoa', async () => {
    const { agent, ids } = await setup('Valida');
    const other = await setup('Outra');
    const base = { start, pace: { kind: 'perWeek', perWeek: 3 }, order: 'interleave', subjects: [{ subjectId: ids.has }] };
    expect((await agent.post('/api/plans/compose').send({ ...base, pace: { kind: 'until', until: addDays(start, -1) } })).status).toBe(400);
    expect((await agent.post('/api/plans/compose').send({ ...base, subjects: [] })).status).toBe(400);
    expect((await other.agent.post('/api/plans/compose').send(base)).status).toBe(400);
    const mine = await agent.post('/api/plans/compose').send(base);
    expect((await other.agent.post('/api/plans/compose').send({ ...base, subjects: [{ subjectId: other.ids.has }], planId: mine.body.id })).status).toBe(404);
  });
});
