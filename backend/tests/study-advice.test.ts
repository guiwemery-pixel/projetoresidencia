import { beforeEach, describe, expect, it } from 'vitest';
import { firstArea, resetDb, signup } from './helpers.js';
import { addDays, todayIn } from '../src/lib/dates.js';
import { studyAdvice, type PastSession } from '../src/modules/reviews/study-advice.js';

// Como estudar na revisão, pelos últimos estudos do assunto

const s = (date: string, methods: PastSession['methods'], questions = 0, accuracy: number | null = null): PastSession => ({ date, methods, questions, accuracy });

describe('sugestão de como estudar (regras)', () => {
  it('só teoria, aula ou flashcards até aqui → questões', () => {
    const a = studyAdvice(
      [s('2026-09-20', ['FLASHCARDS']), s('2026-09-12', ['AULA', 'TEORIA'])],
      ['QUESTOES', 'FLASHCARDS'],
    )!;
    expect(a.focus).toBe('QUESTOES');
    expect(a.methods[0]).toBe('QUESTOES');
    expect(a.title).toBe('Faça questões');
    expect(a.reason).toMatch(/^Nos últimos 2 estudos você usou flashcards, aula e teoria, sem questões/);
    expect(a.mix).toMatchObject({ sessions: 2, theory: 1, questions: 0, recall: 1 });
  });

  it('muitas questões sem voltar à teoria → teoria e depois questões', () => {
    const a = studyAdvice(
      [s('2026-09-30', ['QUESTOES'], 30, 80), s('2026-09-20', ['QUESTOES', 'FLASHCARDS'], 25, 76), s('2026-09-10', ['QUESTOES'], 30, 70), s('2026-08-30', ['TEORIA'])],
      ['QUESTOES'],
    )!;
    expect(a.focus).toBe('TEORIA');
    expect(a.methods).toEqual(['TEORIA', 'QUESTOES']);
    expect(a.reason).toMatch(/Nos últimos 3 estudos foram questões e flashcards, sem voltar à teoria \(a última foi em 30\/08\)/);
  });

  it('desempenho baixo sem teoria recente → teoria antes das questões', () => {
    const a = studyAdvice([s('2026-09-30', ['QUESTOES'], 20, 45), s('2026-09-10', ['TEORIA', 'QUESTOES'], 20, 70)], ['QUESTOES'], { lastTheory: '2026-09-10' })!;
    expect(a.focus).toBe('TEORIA');
    expect(a.reason).toMatch(/O último desempenho foi 45% e você não voltou à teoria desde 10\/09/);
    // Revisão de reforço (desempenho baixo) mesmo sem o percentual aqui
    expect(studyAdvice([s('2026-09-30', ['QUESTOES'], 20, 70)], ['TEORIA', 'QUESTOES'], { lowScore: true })!.focus).toBe('TEORIA');
  });

  it('equilibrado → segue o plano da etapa; sem estudos → sem sugestão', () => {
    const a = studyAdvice([s('2026-09-30', ['QUESTOES'], 30, 82), s('2026-09-20', ['TEORIA', 'QUESTOES'], 25, 76)], ['QUESTOES', 'FLASHCARDS'])!;
    expect(a.focus).toBe('EQUILIBRIO');
    expect(a.methods).toEqual(['QUESTOES', 'FLASHCARDS']);
    expect(a.title).toBe('Siga o plano: questões e flashcards');
    expect(a.reason).toMatch(/1× teoria e 2× questões nos últimos 2 estudos/);
    // Teoria com questões no mesmo dia conta como as duas coisas
    expect(studyAdvice([s('2026-09-30', ['TEORIA'], 30, 40)], ['QUESTOES'])!.focus).toBe('EQUILIBRIO');
    expect(studyAdvice([], ['QUESTOES'])).toBeNull();
  });
});

describe('sugestão nas revisões (Calendário, Revisões, Início)', () => {
  beforeEach(async () => {
    await resetDb();
  });
  const today = todayIn('America/Sao_Paulo');

  it('acompanha os estudos registrados: teoria e flashcards → questões; depois de questões, segue o plano', async () => {
    const { agent } = await signup('Conselho');
    const area = await firstArea(agent, 'Clínica Médica');
    const first = await agent.post('/api/studies').send({
      newSubject: { areaId: area.children[0].id, name: 'Anatomia ocular' },
      date: addDays(today, -12),
      durationMinutes: 45,
      methods: ['AULA', 'TEORIA'],
      quality: 3,
    });
    const subjectId = first.body.session.subject.id;
    await agent.post('/api/studies').send({ subjectId, date: addDays(today, -10), durationMinutes: 20, methods: ['FLASHCARDS'], quality: 3 });
    const pending = async () => ((await agent.get(`/api/reviews?status=PENDING&subjectId=${subjectId}`)).body as { advice: { focus: string; methods: string[]; reason: string } | null }[])[0];
    let r = await pending();
    expect(r.advice).toMatchObject({ focus: 'QUESTOES', methods: expect.arrayContaining(['QUESTOES']) });
    expect(r.advice!.reason).toMatch(/sem questões/);

    // Fez questões: agora está equilibrado
    await agent.post('/api/studies').send({ subjectId, date: addDays(today, -1), durationMinutes: 40, methods: ['QUESTOES'], questions: { total: 30, correct: 24 } });
    r = await pending();
    expect(r.advice!.focus).toBe('EQUILIBRIO');

    // O calendário traz a mesma sugestão
    const month = (await agent.get(`/api/reviews/calendar?month=${today.slice(0, 7)}`)).body;
    const all = [...month.days.flatMap((d: { pending: unknown[] }) => d.pending)] as { advice: unknown }[];
    if (all.length) expect(all[0].advice).toBeTruthy();
    // Revisões feitas não têm sugestão
    const done = (await agent.get(`/api/reviews?status=DONE&subjectId=${subjectId}`)).body as { advice: unknown }[];
    expect(done.every((d) => d.advice === null)).toBe(true);
  });
});
