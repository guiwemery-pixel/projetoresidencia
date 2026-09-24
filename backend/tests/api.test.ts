import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, firstArea, resetDb, signup } from './helpers.js';
import { todayIn, addDays } from '../src/lib/dates.js';

const today = todayIn('America/Sao_Paulo');

beforeEach(async () => {
  await resetDb();
});

describe('autenticação', () => {
  it('cadastra, entra, sai e protege rotas', async () => {
    const { agent, email } = await signup('Guilherme');
    expect((await agent.get('/api/auth/me')).status).toBe(200);

    expect((await request(app).get('/api/dashboard')).status).toBe(401);
    const bad = await request(app).post('/api/auth/login').send({ email, password: 'errada-123' });
    expect(bad.status).toBe(401);

    const other = request.agent(app);
    expect((await other.post('/api/auth/login').send({ email, password: 'senha-segura-123' })).status).toBe(200);
    expect((await other.post('/api/auth/logout')).status).toBe(204);
    expect((await other.get('/api/auth/me')).status).toBe(401);
  });

  it('responde 400 para JSON malformado', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{ruim');
    expect(res.status).toBe(400);
  });

  it('protege o endpoint do agendador', async () => {
    expect((await request(app).get('/api/cron/notifications')).status).toBe(401);
  });

  it('não expõe o hash da senha', async () => {
    const { agent } = await signup('Maria');
    const me = await agent.get('/api/auth/me');
    expect(JSON.stringify(me.body)).not.toMatch(/password/i);
  });

  it('rejeita e-mail duplicado', async () => {
    const { email } = await signup('João');
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'João 2', email: email.toUpperCase(), password: 'senha-segura-123' });
    expect(res.status).toBe(409);
  });

  it('cria as áreas do template de Medicina', async () => {
    const { agent } = await signup('Ana');
    const areas = (await agent.get('/api/areas')).body;
    expect(areas.map((a: { name: string }) => a.name)).toContain('Cirurgia');
    const cirurgia = areas.find((a: { name: string }) => a.name === 'Cirurgia');
    expect(cirurgia.children.map((c: { name: string }) => c.name)).toContain('Vias Biliares');
  });
});

describe('fluxo principal: estudo → revisão → reagendamento', () => {
  it('registra estudo com questões e agenda a revisão (16/20 → D7)', async () => {
    const { agent } = await signup('Guilherme');
    const cirurgia = await firstArea(agent);
    const vias = cirurgia.children.find((c) => c.name === 'Vias Biliares')!;

    const res = await agent.post('/api/studies').send({
      newSubject: { areaId: vias.id, name: 'Coledocolitíase', size: 'MEDIUM' },
      date: today,
      durationMinutes: 90,
      methods: ['TEORIA', 'QUESTOES'],
      quality: 4,
      questions: { total: 20, correct: 16, board: 'ENARE' },
    });
    expect(res.status).toBe(201);
    expect(res.body.isFirstContact).toBe(true);
    expect(res.body.session.questions).toMatchObject({ total: 20, correct: 16, wrong: 4, accuracy: 80 });
    expect(res.body.schedule.stageLabel).toBe('D7');
    expect(res.body.schedule.dueOn).toBe(addDays(today, 7));
    expect(res.body.schedule.explanation.steps.length).toBeGreaterThan(0);

    const pending = await agent.get('/api/reviews?status=PENDING');
    expect(pending.body).toHaveLength(1);
    expect(pending.body[0].subject.name).toBe('Coledocolitíase');
    expect(pending.body[0].subject.area.path).toBe('Cirurgia › Vias Biliares');

    // Adiar a revisão
    const moved = await agent.patch(`/api/reviews/${pending.body[0].id}/reschedule`).send({ date: addDays(today, 9) });
    expect(moved.status).toBe(200);
    expect(moved.body.scheduledFor).toBe(addDays(today, 9));
    expect(moved.body.originalScheduledOn).toBe(addDays(today, 7));

    // Calendário do mês da revisão
    const month = addDays(today, 9).slice(0, 7);
    const cal = await agent.get(`/api/reviews/calendar?month=${month}`);
    expect(cal.body.days.some((d: { date: string }) => d.date === addDays(today, 9))).toBe(true);
  });

  it('agrega sessões do mesmo dia e reprocessa ao excluir', async () => {
    const { agent } = await signup('João');
    const ped = await firstArea(agent, 'Pediatria');
    const first = await agent.post('/api/studies').send({
      newSubject: { areaId: ped.id, name: 'Dengue' },
      date: addDays(today, -10),
      durationMinutes: 60,
      methods: ['TEORIA'],
    });
    expect(first.body.schedule.stageLabel).toBe('D1');
    const subjectId = first.body.session.subject.id;

    // Revisão 9 dias atrasada com ótimo desempenho
    const review = await agent.post('/api/studies').send({
      subjectId,
      date: addDays(today, -1),
      durationMinutes: 30,
      methods: ['QUESTOES'],
      questions: { total: 20, correct: 19 },
    });
    expect(review.body.completedReviewId).toBeTruthy();
    expect(review.body.schedule.explanation.inputs.timing).toBe('atrasada');

    // Segunda sessão no mesmo dia → mesmo contato (agregado)
    const sameDay = await agent.post('/api/studies').send({
      subjectId,
      date: addDays(today, -1),
      durationMinutes: 20,
      methods: ['FLASHCARDS'],
      questions: { total: 10, correct: 4 },
    });
    expect(sameDay.status).toBe(201);
    expect(sameDay.body.schedule.explanation.inputs.questions).toEqual({ total: 30, correct: 23 });
    const all = (await agent.get(`/api/reviews?subjectId=${subjectId}`)).body;
    expect(all.filter((r: { status: string }) => r.status === 'PENDING')).toHaveLength(1);
    expect(all.filter((r: { status: string }) => r.status === 'DONE')).toHaveLength(1);

    // Excluir todas as sessões → histórico e revisões somem
    const studies = (await agent.get(`/api/studies?subjectId=${subjectId}`)).body;
    for (const s of studies) expect((await agent.delete(`/api/studies/${s.id}`)).status).toBe(204);
    expect((await agent.get(`/api/reviews?subjectId=${subjectId}`)).body).toHaveLength(0);
  });

  it('não aceita estudo com data futura nem acertos > total', async () => {
    const { agent } = await signup('Pedro');
    const area = await firstArea(agent, 'Pediatria');
    const future = await agent.post('/api/studies').send({
      newSubject: { areaId: area.id, name: 'X' },
      date: addDays(today, 2),
      durationMinutes: 10,
      methods: ['TEORIA'],
    });
    expect(future.status).toBe(400);
    const invalid = await agent.post('/api/studies').send({
      newSubject: { areaId: area.id, name: 'Y' },
      date: today,
      durationMinutes: 10,
      methods: ['QUESTOES'],
      questions: { total: 5, correct: 6 },
    });
    expect(invalid.status).toBe(400);
  });
});

describe('privacidade entre usuários', () => {
  async function setup() {
    const a = await signup('Guilherme');
    const group = await a.agent.post('/api/groups').send({ name: 'Residência 2027' });
    const b = await signup('Maria', { inviteCode: group.body.inviteCode });
    const outsider = await signup('Intruso');
    const area = await firstArea(a.agent);
    const study = await a.agent.post('/api/studies').send({
      newSubject: { areaId: area.id, name: 'Pancreatite aguda' },
      date: today,
      durationMinutes: 75,
      methods: ['TEORIA', 'QUESTOES'],
      questions: { total: 20, correct: 17 },
    });
    return { a, b, outsider, groupId: group.body.id as string, study: study.body };
  }

  it('um usuário não acessa dados de outro pela API (IDOR)', async () => {
    const { b, study } = await setup();
    const subjectId = study.session.subject.id;
    const reviewId = study.schedule.reviewId;

    expect((await b.agent.get(`/api/studies/${study.session.id}`)).status).toBe(404);
    expect((await b.agent.patch(`/api/studies/${study.session.id}`).send({ durationMinutes: 1 })).status).toBe(404);
    expect((await b.agent.delete(`/api/studies/${study.session.id}`)).status).toBe(404);
    expect((await b.agent.get(`/api/subjects/${subjectId}`)).status).toBe(404);
    expect((await b.agent.patch(`/api/subjects/${subjectId}`).send({ name: 'hack' })).status).toBe(404);
    expect((await b.agent.get(`/api/reviews/${reviewId}`)).status).toBe(404);
    expect((await b.agent.patch(`/api/reviews/${reviewId}/reschedule`).send({ date: today })).status).toBe(404);
    // Registrar estudo num assunto alheio
    const steal = await b.agent.post('/api/studies').send({ subjectId, date: today, durationMinutes: 5, methods: ['TEORIA'] });
    expect(steal.status).toBe(404);

    // Listagens só retornam dados próprios
    expect((await b.agent.get('/api/studies')).body).toHaveLength(0);
    expect((await b.agent.get('/api/reviews')).body).toHaveLength(0);
    expect((await b.agent.get('/api/subjects')).body).toHaveLength(0);
    expect((await b.agent.get('/api/search?q=pancreatite')).body.subjects).toHaveLength(0);
  });

  it('o grupo recebe apenas o resumo visual, sem números detalhados', async () => {
    const { b, a, groupId } = await setup();
    const board = await b.agent.get(`/api/groups/${groupId}`);
    expect(board.status).toBe(200);
    const guilherme = board.body.members.find((m: { userId: string }) => m.userId === a.user.id);
    expect(guilherme.shared).toBe(true);

    // Lista de permissão de campos
    expect(Object.keys(guilherme).sort()).toEqual(
      ['avatar', 'indicators', 'isMe', 'level', 'name', 'progress', 'role', 'shared', 'trend', 'userId'].sort(),
    );
    for (const ind of Object.values(guilherme.indicators) as Record<string, unknown>[]) {
      expect(Object.keys(ind).every((k) => ['level', 'label', 'percent'].includes(k))).toBe(true);
    }
    expect(guilherme.progress % 5).toBe(0);
    const json = JSON.stringify(board.body);
    for (const leak of ['Pancreatite', 'accuracy', 'minutes', 'questions', 'hours', today, '"score"', 'details', 'formula']) {
      expect(json).not.toContain(leak);
    }
    expect(json).not.toContain(a.email);
  });

  it('quem não é do grupo não vê o painel; quem desativa o compartilhamento aparece como privado', async () => {
    const { outsider, a, b, groupId } = await setup();
    expect((await outsider.agent.get(`/api/groups/${groupId}`)).status).toBe(404);

    await a.agent.patch('/api/me').send({ shareProgress: false });
    const board = await b.agent.get(`/api/groups/${groupId}`);
    const guilherme = board.body.members.find((m: { userId: string }) => m.userId === a.user.id);
    expect(guilherme).toEqual({ userId: a.user.id, name: 'Guilherme', avatar: null, shared: false, role: 'OWNER', isMe: false });
  });

  it('fixa o grupo na página inicial só para quem é integrante', async () => {
    const { a, b, outsider, groupId } = await setup();
    expect((await b.agent.put(`/api/groups/${groupId}/favorite`).send({ favorite: true })).status).toBe(200);
    expect((await b.agent.get('/api/groups')).body[0]).toMatchObject({ id: groupId, favorite: true });
    expect((await b.agent.get(`/api/groups/${groupId}`)).body.favorite).toBe(true);
    // A preferência é pessoal: para o dono do grupo nada muda
    expect((await a.agent.get('/api/groups')).body[0].favorite).toBe(false);
    expect((await outsider.agent.put(`/api/groups/${groupId}/favorite`).send({ favorite: true })).status).toBe(404);
  });

  it('o próprio usuário vê o cálculo detalhado do indicador', async () => {
    const { a } = await setup();
    const progress = await a.agent.get('/api/me/progress');
    expect(progress.status).toBe(200);
    expect(progress.body.formula).toContain('Estudos');
    const q = progress.body.components.find((c: { key: string }) => c.key === 'questoes');
    expect(q.details.acerto30).toBe(85);
  });
});

describe('métricas, metas e simulados', () => {
  it('calcula métricas e progresso de metas', async () => {
    const { agent } = await signup('Clara');
    const area = await firstArea(agent, 'Clínica Médica');
    const goal = await agent
      .post('/api/goals')
      .send({ title: 'Fazer 30 questões hoje', metric: 'QUESTIONS', period: 'DAILY', target: 30 });
    expect(goal.status).toBe(201);
    await agent.post('/api/studies').send({
      newSubject: { areaId: area.id, name: 'Insuficiência cardíaca' },
      date: today,
      durationMinutes: 120,
      methods: ['QUESTOES'],
      questions: { total: 30, correct: 21 },
    });
    const overview = await agent.get('/api/metrics/overview?days=7');
    expect(overview.body.questions).toMatchObject({ total: 30, correct: 21, accuracy: 70 });
    expect(overview.body.studies.minutes).toBe(120);

    const goals = await agent.get('/api/goals');
    expect(goals.body[0]).toMatchObject({ progress: 30, percent: 100, reachedThisPeriod: true });
    const notes = await agent.get('/api/notifications');
    expect(notes.body.items.some((n: { type: string }) => n.type === 'goal-completed')).toBe(true);

    const byArea = await agent.get('/api/metrics/by-area?days=30');
    const clinica = byArea.body.areas.find((a: { name: string }) => a.name === 'Clínica Médica');
    expect(clinica.accuracy).toBe(70);

    const dash = await agent.get('/api/dashboard');
    expect(dash.status).toBe(200);
    expect(dash.body.summary.plannedQuestions).toBeGreaterThan(0);
  });

  it('registra simulados e mostra a evolução', async () => {
    const { agent } = await signup('Rafa');
    for (const [year, correct] of [
      [2023, 65],
      [2024, 72],
      [2025, 78],
    ]) {
      const r = await agent.post('/api/mock-exams').send({
        name: `ENAMED ${year}`,
        board: 'ENAMED',
        year,
        takenOn: addDays(today, -(2026 - year)),
        totalQuestions: 100,
        correct,
      });
      expect(r.status).toBe(201);
    }
    const list = await agent.get('/api/mock-exams');
    expect(list.body.series[0].points.map((p: { accuracy: number }) => p.accuracy)).toEqual([65, 72, 78]);
  });
});
