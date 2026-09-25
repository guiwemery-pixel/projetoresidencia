import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, firstArea, resetDb, signup } from './helpers.js';
import { todayIn, addDays } from '../src/lib/dates.js';
import { prisma } from '../src/lib/prisma.js';
import { runMaintenance } from '../src/modules/maintenance/maintenance.service.js';

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

  it('salva a organização da página inicial', async () => {
    const { agent } = await signup('Layout');
    const layout = { main: ['hoje', 'revisoes'], side: ['progresso'], hidden: ['metas'] };
    const ok = await agent.patch('/api/me').send({ dashboardLayout: layout });
    expect(ok.status).toBe(200);
    expect((await agent.get('/api/auth/me')).body.user.dashboardLayout).toEqual(layout);
    const dup = await agent.patch('/api/me').send({ dashboardLayout: { main: ['hoje'], side: ['hoje'], hidden: [] } });
    expect(dup.status).toBe(400);
    const reset = await agent.patch('/api/me').send({ dashboardLayout: null });
    expect(reset.body.user.dashboardLayout).toBeNull();
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
  it('registra estudo com questões e agenda a 1ª revisão (16/20 → 20 dias)', async () => {
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
    expect(res.body.schedule.intervalDays).toBe(20);
    expect(res.body.schedule.dueOn).toBe(addDays(today, 20));
    expect(res.body.schedule.explanation.steps.length).toBeGreaterThan(0);

    const pending = await agent.get('/api/reviews?status=PENDING');
    expect(pending.body).toHaveLength(1);
    expect(pending.body[0].subject.name).toBe('Coledocolitíase');
    expect(pending.body[0].subject.area.path).toBe('Cirurgia › Vias Biliares');

    // Adiar a revisão
    const moved = await agent.patch(`/api/reviews/${pending.body[0].id}/reschedule`).send({ date: addDays(today, 22) });
    expect(moved.status).toBe(200);
    expect(moved.body.scheduledFor).toBe(addDays(today, 22));
    expect(moved.body.originalScheduledOn).toBe(addDays(today, 20));

    // Calendário do mês da revisão
    const month = addDays(today, 22).slice(0, 7);
    const cal = await agent.get(`/api/reviews/calendar?month=${month}`);
    expect(cal.body.days.some((d: { date: string }) => d.date === addDays(today, 22))).toBe(true);
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

  it('D1 feita com flashcards define a próxima revisão pela autoavaliação (sem outra D1)', async () => {
    const { agent } = await signup('Ana');
    const area = await firstArea(agent);
    const d0 = await agent.post('/api/studies').send({
      newSubject: { areaId: area.children[0].id, name: 'Anatomia' },
      date: addDays(today, -1),
      durationMinutes: 60,
      methods: ['LEITURA'],
    });
    expect(d0.body.schedule.stageLabel).toBe('D1');
    const subjectId = d0.body.session.subject.id;
    const d1 = await agent.post('/api/studies').send({ subjectId, date: today, durationMinutes: 20, methods: ['FLASHCARDS'], quality: 3 });
    expect(d1.status).toBe(201);
    expect(d1.body.completedReviewId).toBeTruthy();
    expect(d1.body.schedule).toMatchObject({ stageLabel: 'D10', intervalDays: 12, checkup: false });
    // Mais uma sessão no mesmo dia (reprocessa o histórico): continua sem voltar para D1
    const again = await agent.post('/api/studies').send({ subjectId, date: today, durationMinutes: 10, methods: ['RECALL'] });
    expect(again.body.schedule.checkup).toBe(false);
    expect(again.body.schedule.intervalDays).toBe(13); // Razoável → 13 dias × 1,0 (30 min no dia)
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

describe('armazenamento compacto', () => {
  async function studyWithReview() {
    const { agent, user } = await signup('Compacto');
    const cirurgia = await firstArea(agent);
    const res = await agent.post('/api/studies').send({
      newSubject: { areaId: cirurgia.children[0].id, name: 'Pancreatite aguda', size: 'MEDIUM' },
      date: today,
      durationMinutes: 60,
      methods: ['QUESTOES'],
      quality: 4,
      questions: { total: 20, correct: 15 },
    });
    expect(res.status).toBe(201);
    const subject = await prisma.subject.findFirstOrThrow({ where: { userId: user.id, name: 'Pancreatite aguda' } });
    return { agent, user, schedule: res.body.schedule, subjectId: subject.id };
  }

  it('grava o "Por quê?" comprimido e devolve exatamente o mesmo conteúdo', async () => {
    const { agent, schedule, subjectId } = await studyWithReview();
    const row = await prisma.review.findFirstOrThrow({ where: { subjectId } });
    expect(row.explanation).toBeNull();
    expect(row.explanationPacked!.length).toBeLessThan(JSON.stringify(schedule.explanation).length / 3);

    const pending = await agent.get('/api/reviews?status=PENDING');
    expect(pending.body[0].explanation).toEqual(schedule.explanation);
    const subject = await agent.get(`/api/subjects/${subjectId}`);
    expect(subject.body.timeline.reviews[0].explanation).toEqual(schedule.explanation);
    const exported = await agent.get('/api/me/export');
    expect(exported.body.reviews[0].explanation).toEqual(schedule.explanation);
    expect(exported.body.reviews[0]).not.toHaveProperty('explanationPacked');
  });

  it('converte explicações antigas (JSON) ao abrir o app, sem mudar o que aparece', async () => {
    const { agent, schedule, subjectId } = await studyWithReview();
    const row = await prisma.review.findFirstOrThrow({ where: { subjectId } });
    // Simula uma linha gravada antes da compressão
    const legacy = await prisma.review.update({
      where: { id: row.id },
      data: { explanation: schedule.explanation, explanationPacked: null },
    });
    expect((await agent.get('/api/reviews?status=PENDING')).body[0].explanation).toEqual(schedule.explanation);

    expect((await agent.get('/api/dashboard')).status).toBe(200);
    const converted = await prisma.review.findUniqueOrThrow({ where: { id: row.id } });
    expect(converted.explanation).toBeNull();
    expect(converted.explanationPacked).not.toBeNull();
    expect(converted.updatedAt).toEqual(legacy.updatedAt);
    expect((await agent.get('/api/reviews?status=PENDING')).body[0].explanation).toEqual(schedule.explanation);
  });

  it('a faxina apaga só sessões vencidas', async () => {
    const { agent, user } = await signup('Sessoes');
    await prisma.session.create({
      data: { userId: user.id, tokenHash: 'vencida', expiresAt: new Date(Date.now() - 86_400_000) },
    });
    const result = await runMaintenance();
    expect(result.expiredSessions).toBe(1);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
    expect((await agent.get('/api/auth/me')).status).toBe(200);
  });

  it('ao entrar, apaga as sessões vencidas do próprio usuário', async () => {
    const { user, email } = await signup('Login');
    await prisma.session.create({
      data: { userId: user.id, tokenHash: 'vencida-2', expiresAt: new Date(Date.now() - 86_400_000) },
    });
    expect((await request(app).post('/api/auth/login').send({ email, password: 'senha-segura-123' })).status).toBe(200);
    expect(await prisma.session.count({ where: { userId: user.id, expiresAt: { lt: new Date() } } })).toBe(0);
  });
});

describe('importar planilha', () => {
  const events = [
    { area: 'CM', subarea: 'Cardiologia', subject: 'Insuficiência cardíaca', date: addDays(today, -30), total: 20, correct: 16, minutes: 60, methods: ['TEORIA', 'QUESTOES'] },
    { area: 'CM', subarea: 'Cardiologia', subject: 'insuficiência  cardíaca', date: addDays(today, -10), total: 20, correct: 18, minutes: 30 },
    { area: 'Oftalmologia', subject: 'Glaucoma', date: addDays(today, -5), minutes: 40, methods: ['FLASHCARDS'], quality: 4 },
    { subject: 'Assunto sem área', date: addDays(today, -2), total: 10, correct: 7 },
  ];

  it('mostra a prévia, importa, recalcula as revisões e não duplica ao reimportar', async () => {
    const { agent } = await signup('Antonio');
    const preview = await agent.post('/api/import/preview').send({ events });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ studies: 4, duplicates: 0, questions: 50, subjects: 3, newSubjects: 3 });
    // "CM" é a Clínica Médica do modelo; Cardiologia já existe nela
    expect(preview.body.newAreas).toEqual(['Oftalmologia', 'Importados']);

    const run = await agent.post('/api/import/run').send({ events });
    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({ created: 4, duplicates: 0, subjects: 3 });

    const subjects = (await agent.get('/api/subjects')).body as { id: string; name: string; area: { path: string } }[];
    const ic = subjects.find((x) => x.name === 'Insuficiência cardíaca')!;
    expect(ic.area.path).toBe('Clínica Médica › Cardiologia');
    const timeline = (await agent.get(`/api/subjects/${ic.id}`)).body.timeline;
    expect(timeline.contacts).toHaveLength(2);
    expect(timeline.reviews.filter((r: { status: string }) => r.status === 'DONE')).toHaveLength(1);
    expect(timeline.reviews.filter((r: { status: string }) => r.status === 'PENDING')).toHaveLength(1);
    const studies = (await agent.get(`/api/studies?subjectId=${ic.id}`)).body as { isFirstContact: boolean; date: string }[];
    expect(studies.find((x) => x.isFirstContact)?.date).toBe(addDays(today, -30));

    const again = await agent.post('/api/import/run').send({ events });
    expect(again.body).toMatchObject({ created: 0, duplicates: 4 });
    expect((await agent.post('/api/import/preview').send({ events })).body).toMatchObject({ studies: 0, duplicates: 4 });
  });

  it('valida datas futuras e acertos maiores que o total', async () => {
    const { agent } = await signup('Validador');
    const future = await agent.post('/api/import/run').send({ events: [{ subject: 'X', date: addDays(today, 1) }] });
    expect(future.status).toBe(400);
    const wrong = await agent.post('/api/import/preview').send({ events: [{ subject: 'X', date: today, total: 5, correct: 6 }] });
    expect(wrong.status).toBe(400);
    expect((await request(app).post('/api/import/run').send({ events })).status).toBe(401);
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

  it('comparativos do grupo: só níveis relativos, destaques e ritmo — nunca números', async () => {
    const { a, b, outsider, groupId } = await setup();
    const area = await firstArea(b.agent);
    await b.agent.post('/api/studies').send({
      newSubject: { areaId: area.id, name: 'Colangite aguda' },
      date: today,
      durationMinutes: 30,
      methods: ['FLASHCARDS', 'QUESTOES'],
      questions: { total: 40, correct: 28 },
    });
    expect((await outsider.agent.get(`/api/groups/${groupId}/compare`)).status).toBe(404);

    const res = await b.agent.get(`/api/groups/${groupId}/compare?period=7`);
    expect(res.status).toBe(200);
    const body = res.body;
    const guilherme = body.members.find((m: { userId: string }) => m.userId === a.user.id);
    const maria = body.members.find((m: { userId: string }) => m.userId === b.user.id);

    // Guilherme: 20 questões (85%), 75 min · Maria: 40 questões (70%), 30 min, flashcards
    expect(maria.levels).toMatchObject({ questoes: 'acima', tempo: 'abaixo', acertos: 'abaixo', flashcards: 'muito-acima' });
    expect(guilherme.levels).toMatchObject({ questoes: 'abaixo', tempo: 'acima', acertos: 'acima', flashcards: 'sem-registro' });
    expect(guilherme.mix).toEqual({ questoes: 50, teoria: 50, flashcards: 0, simulados: 0 });
    const top = Object.fromEntries(body.highlights.map((h: { key: string; names: string[] }) => [h.key, h.names]));
    expect(top).toMatchObject({ questoes: ['Maria'], tempo: ['Guilherme'], acertos: ['Guilherme'], flashcards: ['Maria'] });
    expect(body.me).toMatchObject({ levels: maria.levels, comparedWith: 1, sharing: true });
    expect(body.pulse.questoes).toEqual({ direction: 'new', percent: null });

    // Lista de permissão: nenhum número além dos campos relativos/contagens de pessoas
    const allowed = /^(period|memberCount|sharingCount|activeCount|me\.comparedWith|members\.\d+\.mix\.\w+|pulse\.\w+\.(percent|points))$/;
    const walk = (v: unknown, path: string) => {
      if (typeof v === 'number') expect(path).toMatch(allowed);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
    };
    walk(body, '');
    const levels = new Set(['muito-acima', 'acima', 'media', 'abaixo', 'muito-abaixo', 'sem-registro']);
    for (const m of body.members) {
      expect(Object.keys(m).every((k) => ['userId', 'name', 'avatar', 'isMe', 'shared', 'levels', 'strengths', 'mix'].includes(k))).toBe(true);
      for (const l of Object.values(m.levels) as string[]) expect(levels.has(l)).toBe(true);
      for (const v of Object.values(m.mix) as number[]) expect(v % 10).toBe(0);
    }
    const json = JSON.stringify(body);
    for (const leak of ['Pancreatite', 'Colangite', 'minutes', '"questions"', '"correct"', today, a.email]) expect(json).not.toContain(leak);
  });

  it('comparativos respeitam quem não compartilha', async () => {
    const { a, b, groupId } = await setup();
    await a.agent.patch('/api/me').send({ shareProgress: false });
    const forMaria = (await b.agent.get(`/api/groups/${groupId}/compare`)).body;
    const guilherme = forMaria.members.find((m: { userId: string }) => m.userId === a.user.id);
    expect(guilherme).toEqual({ userId: a.user.id, name: 'Guilherme', avatar: null, isMe: false, shared: false });
    expect(forMaria.sharingCount).toBe(1);
    expect(forMaria.highlights).toEqual([]);
    // Quem não compartilha ainda vê a própria posição (só para si)
    const forGuilherme = (await a.agent.get(`/api/groups/${groupId}/compare`)).body;
    expect(forGuilherme.me).toMatchObject({ comparedWith: 1, sharing: false });
    expect(forGuilherme.members.find((m: { isMe: boolean }) => m.isMe).shared).toBe(false);
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
