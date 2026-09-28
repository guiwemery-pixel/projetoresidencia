import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, firstArea, resetDb, signup } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';
import { addDays, toDb, todayIn } from '../src/lib/dates.js';
import { escapeText, foldLine, renderCalendar, zonedToUtc } from '../src/modules/calendar/ical.js';

// Agenda para o Google Agenda: link iCal secreto com revisões, cronograma e flashcards

beforeEach(async () => {
  await resetDb();
});

const today = todayIn('America/Sao_Paulo');
const compact = (d: string) => d.replace(/-/g, '');
/** Linhas do .ics já "desdobradas" (continuações começam com espaço). */
const unfold = (ics: string) => ics.replace(/\r\n /g, '');
const events = (ics: string) => unfold(ics).split('BEGIN:VEVENT').slice(1);
/** Valor de uma propriedade do evento, com o texto já sem os escapes do iCal. */
const field = (event: string, name: string) =>
  (new RegExp(`^${name}[:;](.*)$`, 'm').exec(event)?.[1] ?? '')
    .trim()
    .replace(/\\([,;\\])/g, '$1')
    .replace(/\\n/g, '\n');
const feedPath = (url: string) => new URL(url).pathname;

describe('ical: formato', () => {
  it('escapa texto, dobra linhas em 75 bytes sem cortar acentos e usa CRLF', () => {
    expect(escapeText('a, b; c\\d\nlinha')).toBe('a\\, b\\; c\\\\d\\nlinha');
    const long = 'DESCRIPTION:' + 'Coledocolitíase › Vias biliares · '.repeat(8);
    const folded = foldLine(long);
    for (const line of folded.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, '')).toBe(long);
    const ics = renderCalendar({ name: 'Teste', events: [{ uid: 'a@x', summary: 'Revisão', date: '2026-10-05' }] }, new Date('2026-09-28T12:00:00Z'));
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261005\r\nDTEND;VALUE=DATE:20261006\r\n');
    expect(ics).toContain('DTSTAMP:20260928T120000Z');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('horário local vira UTC pelo fuso do usuário, com horário de verão', () => {
    expect(zonedToUtc('2026-10-05', '19:00', 'America/Sao_Paulo').toISOString()).toBe('2026-10-05T22:00:00.000Z');
    expect(zonedToUtc('2026-07-01', '09:00', 'America/New_York').toISOString()).toBe('2026-07-01T13:00:00.000Z');
    expect(zonedToUtc('2026-12-01', '09:00', 'America/New_York').toISOString()).toBe('2026-12-01T14:00:00.000Z');
    expect(zonedToUtc('2026-10-05', '23:30', 'America/Manaus').toISOString()).toBe('2026-10-06T03:30:00.000Z');
  });
});

describe('agenda: link para o Google Agenda', () => {
  async function setup() {
    const s = await signup('Agenda');
    const cirurgia = await firstArea(s.agent);
    const vias = cirurgia.children.find((c) => c.name === 'Vias Biliares')!;
    const study = await s.agent.post('/api/studies').send({
      newSubject: { areaId: vias.id, name: 'Coledocolitíase', size: 'MEDIUM' },
      date: today,
      durationMinutes: 60,
      methods: ['TEORIA', 'QUESTOES'],
      questions: { total: 25, correct: 20 },
    });
    expect(study.status).toBe(201);
    return { ...s, dueOn: study.body.schedule.dueOn as string };
  }

  it('liga, entrega as revisões sem login e guarda quem leu', async () => {
    const { agent, dueOn } = await setup();
    expect((await agent.get('/api/me/calendar')).body).toMatchObject({ enabled: false });
    const on = await agent.post('/api/me/calendar').send({});
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({ enabled: true, options: { plan: true, flashcards: true, time: null, group: false } });
    expect(on.body.url).toMatch(/\/api\/ical\/[A-Za-z0-9_-]{30,}\.ics$/);
    expect(on.body.webcalUrl).toMatch(/^webcal:\/\//);
    // Ligar de novo não troca o link
    expect(feedPath((await agent.post('/api/me/calendar').send({})).body.url)).toBe(feedPath(on.body.url));

    // Sem cookie: o link secreto basta
    const res = await request(app).get(feedPath(on.body.url)).set('User-Agent', 'Google-Calendar-Importer');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/calendar');
    const ics = res.text;
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(unfold(ics)).toContain('X-WR-CALNAME:Revisões · Projeto Residente');
    const [review] = events(ics);
    expect(field(review, 'SUMMARY')).toMatch(/^Revisão D\d+ · Coledocolitíase$/);
    expect(field(review, 'DTSTART')).toBe(`VALUE=DATE:${compact(dueOn)}`);
    expect(field(review, 'DESCRIPTION')).toContain('Cirurgia › Vias Biliares');
    expect(field(review, 'DESCRIPTION')).toMatch(/25–30 questões/);
    expect(field(review, 'UID')).toMatch(/^review-.+@projeto-residente$/);

    const after = await agent.get('/api/me/calendar');
    expect(after.body.lastClient).toBe('Google Agenda');
    expect(after.body.lastFetchedAt).toBeTruthy();
  });

  it('revisão atrasada aparece hoje; horário fixo e um evento por dia', async () => {
    const { agent, user } = await setup();
    const on = await agent.post('/api/me/calendar').send({});
    await prisma.review.updateMany({ where: { userId: user.id, status: 'PENDING' }, data: { scheduledFor: toDb(addDays(today, -4)) } });
    let [ev] = events((await request(app).get(feedPath(on.body.url))).text);
    expect(field(ev, 'SUMMARY')).toMatch(/^Atrasada · Revisão/);
    expect(field(ev, 'DTSTART')).toBe(`VALUE=DATE:${compact(today)}`);
    expect(field(ev, 'DESCRIPTION')).toContain(`prevista para ${addDays(today, -4).split('-').reverse().join('/')}`);

    const patched = await agent.patch('/api/me/calendar').send({ time: '19:00', duration: 30, group: true });
    expect(patched.body.options).toMatchObject({ time: '19:00', duration: 30, group: true });
    [ev] = events((await request(app).get(feedPath(on.body.url))).text);
    // America/Sao_Paulo (padrão da conta): 19:00 = 22:00 UTC
    expect(field(ev, 'DTSTART')).toBe(`${compact(today)}T220000Z`);
    expect(field(ev, 'DTEND')).toBe(`${compact(today)}T223000Z`);
    expect(field(ev, 'SUMMARY')).toBe('1 revisão (1 atrasada): Coledocolitíase');
    expect(field(ev, 'UID')).toBe(`reviews-${today}@projeto-residente`);

    expect((await agent.patch('/api/me/calendar').send({ time: '25:00' })).status).toBe(400);
  });

  it('inclui as semanas do cronograma e os flashcards previstos (e dá para tirar)', async () => {
    const { agent } = await setup();
    const on = await agent.post('/api/me/calendar').send({});
    const week = addDays(today, 7);
    await agent.post('/api/plans').send({
      name: 'Extensivo',
      items: [
        { subject: 'Asma', area: 'Pediatria', weekStart: week, label: 'Módulo 05' },
        { subject: 'Bronquiolite', area: 'Pediatria', weekStart: week, label: 'Módulo 05' },
        { subject: 'Hérnias', area: 'Cirurgia', weekStart: addDays(today, -21), label: 'Módulo 01' },
      ],
    });
    // Resumo dos flashcards enviado pelo app ontem: 3 hoje, 0 amanhã, 5 depois
    const yesterdayStart = Date.parse(`${addDays(today, -1)}T12:00:00-03:00`);
    await agent.put('/api/flashcards/summary').send({ v: 1, dayStart: yesterdayStart, forecast: [2, 3, 0, 5] });

    const all = events((await request(app).get(feedPath(on.body.url))).text);
    const plan = all.find((e) => field(e, 'SUMMARY').startsWith('Cronograma · Módulo 05'))!;
    expect(field(plan, 'SUMMARY')).toBe('Cronograma · Módulo 05: Asma, Bronquiolite');
    expect(field(plan, 'DTSTART')).toBe(`VALUE=DATE:${compact(week)}`);
    expect(field(plan, 'DTEND')).toBe(`VALUE=DATE:${compact(addDays(week, 7))}`);
    const late = all.find((e) => field(e, 'SUMMARY').startsWith('Cronograma atrasado'))!;
    expect(field(late, 'SUMMARY')).toBe('Cronograma atrasado · 1 assunto: Hérnias');
    expect(field(late, 'DTSTART')).toBe(`VALUE=DATE:${compact(today)}`);
    const cards = all.filter((e) => field(e, 'SUMMARY').startsWith('Flashcards'));
    // Hoje soma o de ontem que ficou por fazer (2 + 3); amanhã não tem; depois, 5
    expect(cards.map((e) => [field(e, 'DTSTART'), field(e, 'SUMMARY')])).toEqual([
      [`VALUE=DATE:${compact(today)}`, 'Flashcards · 5 cards para revisar'],
      [`VALUE=DATE:${compact(addDays(today, 2))}`, 'Flashcards · 5 cards para revisar'],
    ]);

    await agent.patch('/api/me/calendar').send({ plan: false, flashcards: false });
    const only = events((await request(app).get(feedPath(on.body.url))).text);
    expect(only.map((e) => field(e, 'SUMMARY').split(' ')[0])).toEqual(['Revisão']);
  });

  it('novo link invalida o anterior; desligar apaga; link de outro usuário não existe', async () => {
    const { agent } = await setup();
    const first = await agent.post('/api/me/calendar').send({});
    const second = await agent.post('/api/me/calendar').send({ regenerate: true });
    expect(feedPath(second.body.url)).not.toBe(feedPath(first.body.url));
    expect((await request(app).get(feedPath(first.body.url))).status).toBe(404);
    expect((await request(app).get(feedPath(second.body.url))).status).toBe(200);

    expect((await agent.delete('/api/me/calendar')).status).toBe(204);
    expect((await request(app).get(feedPath(second.body.url))).status).toBe(404);
    expect((await agent.get('/api/me/calendar')).body).toMatchObject({ enabled: false });

    expect((await request(app).get('/api/ical/naoexiste-naoexiste-naoexiste.ics')).status).toBe(404);
    expect((await request(app).get('/api/ical/curto.ics')).status).toBe(404);
    // Configurar exige login
    expect((await request(app).get('/api/me/calendar')).status).toBe(401);
  });
});
