import { describe, expect, it } from 'vitest';
import { DEFAULT_SCHEDULER_CONFIG, computeScore, mergeConfig, questionCountFactor, reviewPlan, scheduleNext, studyTimeFactor, suggestedQuestions, type ContactEvidence, type HistoryPoint, type LearningSnapshot, type ScheduleResult } from './index.js';

const q = (correct: number, total: number) => ({ correct, total });

function contact(date: string, partial: Partial<ContactEvidence> = {}): ContactEvidence {
  return { date, methods: ['QUESTOES'], questions: null, quality: null, difficulty: null, ...partial };
}

/** Simula uma sequência de contatos, alimentando o estado e o histórico. */
function simulate(contacts: ContactEvidence[]) {
  let state: LearningSnapshot | null = null;
  let scheduledFor: string | null = null;
  const history: HistoryPoint[] = [];
  const results: ScheduleResult[] = [];
  for (const c of contacts) {
    const r = scheduleNext({ state, contact: c, history: [...history], scheduledFor });
    results.push(r);
    history.push({ date: c.date, score: r.score, accuracy: r.accuracy });
    state = r.nextState;
    scheduledFor = r.dueOn;
  }
  return results;
}

describe('primeiro contato (D0)', () => {
  it('só teoria agenda a revisão D1 (questões, flashcards, recall ou teoria)', () => {
    const r = scheduleNext({ state: null, contact: contact('2026-09-01', { methods: ['TEORIA'] }), history: [] });
    expect(r.intervalDays).toBe(1);
    expect(r.stageLabel).toBe('D1');
    expect(r.dueOn).toBe('2026-09-02');
    expect(r.checkup).toBe(true);
    expect(r.suggestedMethods).toEqual(['QUESTOES', 'FLASHCARDS', 'RECALL']);
    expect(r.suggestedQuestions).toEqual({ min: 20, max: 30 });
  });

  it('a data da 1ª revisão sai do percentual de acertos (tabela)', () => {
    const first = (correct: number, total: number) =>
      scheduleNext({ state: null, contact: contact('2026-09-01', { methods: ['TEORIA', 'QUESTOES'], questions: q(correct, total) }), history: [] })
        .intervalDays;
    expect(first(11, 20)).toBe(3); // 55%  → abaixo de 60%
    expect(first(12, 20)).toBe(10); // 60%
    expect(first(13, 20)).toBe(10); // 65%
    expect(first(14, 20)).toBe(13); // 70%
    expect(first(15, 20)).toBe(20); // 75%
    expect(first(16, 20)).toBe(20); // 80%
    expect(first(17, 20)).toBe(23); // 85%
    expect(first(20, 20)).toBe(23); // 100%
  });

  it('a explicação da 1ª revisão não diz "sem medida" quando houve questões', () => {
    const r = scheduleNext({ state: null, contact: contact('2026-09-01', { questions: q(16, 20), quality: 4 }), history: [] });
    expect(r.explanation.steps.map((s) => s.label)).not.toContain('Sem medida de desempenho');
    expect(r.explanation.steps.map((s) => s.label)).toContain('1ª revisão pelo percentual de acertos');
  });

  it('abaixo de 50% no 1º contato sugere voltar à teoria', () => {
    const r = scheduleNext({ state: null, contact: contact('2026-09-01', { questions: q(6, 20), quality: 1 }), history: [] });
    expect(r.intervalDays).toBe(3);
    expect(r.suggestTheory).toBe(true);
    expect(r.suggestedMethods).toContain('TEORIA');
  });

  it('com poucas questões no 1º contato não volta amanhã: pontuação (no máximo "Bom") e quantidade', () => {
    const r = scheduleNext({ state: null, contact: contact('2026-09-01', { questions: q(3, 3) }), history: [] });
    expect(r.checkup).toBe(false);
    expect(r.intervalDays).toBe(13); // 3/3 sem autoavaliação vale no máximo 80 → 20 dias × 0,66 (3 questões)
    const rated = scheduleNext({ state: null, contact: contact('2026-09-01', { questions: q(3, 3), quality: 5 }), history: [] });
    expect(rated.intervalDays).toBe(15); // Dominei → 23 dias × 0,66
  });

  it('D0 só de leitura: o percentual da verificação define a 1ª revisão', () => {
    const d0 = scheduleNext({ state: null, contact: contact('2026-09-01', { methods: ['LEITURA'] }), history: [] });
    expect(d0.checkup).toBe(true);
    const check = scheduleNext({ state: d0.nextState, contact: contact('2026-09-02', { questions: q(14, 20) }), history: [] });
    expect(check.checkup).toBe(false);
    expect(check.intervalDays).toBe(13); // 70% → 13 dias
  });

  it('a tabela da 1ª revisão é configurável', () => {
    const custom = mergeConfig(DEFAULT_SCHEDULER_CONFIG, {
      firstReview: { minQuestions: 5, tiers: [{ min: 80, days: 30, stage: 2 }, { min: 0, days: 2, stage: 0 }] },
    });
    const r = scheduleNext({ state: null, contact: contact('2026-09-01', { questions: q(16, 20) }), history: [] }, custom);
    expect(r.intervalDays).toBe(30);
  });

  it('a quantidade de questões ajusta a data da 1ª revisão', () => {
    const first = (correct: number, total: number) =>
      scheduleNext({ state: null, contact: contact('2026-09-01', { questions: q(correct, total) }), history: [] }).intervalDays;
    expect(first(34, 40)).toBe(28); // 85% com 40 questões: 23 × 1,2
    expect(first(17, 20)).toBe(23); // 85% com 20 questões: a tabela pura
    expect(first(6, 7)).toBe(17); // 86% com 7 questões: 23 × 0,74
    expect(first(3, 5)).toBe(7); // 60% com 5 questões: 10 × 0,7
    expect(first(2, 5)).toBe(3); // abaixo de 60% volta em 3 dias, qualquer quantidade
    expect(first(20, 40)).toBe(3);
  });
});

describe('revisão D1 flexível (sem questões)', () => {
  const d0 = scheduleNext({ state: null, contact: contact('2026-09-24', { methods: ['LEITURA'] }), history: [] });
  const d1 = (partial: Partial<ContactEvidence>) =>
    scheduleNext({ state: d0.nextState, contact: contact('2026-09-25', partial), history: [], scheduledFor: d0.dueOn, pendingCheckup: true });

  it('D1 com flashcards + "Razoável": a data sai da autoavaliação e do tempo, sem outra D1', () => {
    const r = d1({ methods: ['FLASHCARDS'], quality: 3, minutes: 20 });
    expect(r.checkup).toBe(false);
    expect(r.stageLabel).toBe('D10');
    expect(r.intervalDays).toBe(12); // Razoável (70) → 13 dias × 0,93 (20 min)
    const labels = r.explanation.steps.map((s) => s.label);
    expect(labels).toContain('1ª revisão pela autoavaliação');
    expect(labels).toContain('Tempo de estudo');
    expect(labels).not.toContain('Sem bônus');
    expect(r.explanation.stage.fromLabel).toBe('D1');
  });

  it('bom desempenho vai longe; dificuldade e tempo ajustam', () => {
    expect(d1({ methods: ['FLASHCARDS'], quality: 4, minutes: 30 }).intervalDays).toBe(23); // Fui bem → 23
    expect(d1({ methods: ['FLASHCARDS'], quality: 4, minutes: 45, difficulty: 3 }).intervalDays).toBe(21); // 23 × 0,85 ≈ 20 → × 1,05
    expect(d1({ methods: ['RECALL'], quality: 2, minutes: 90 }).intervalDays).toBe(3); // Tive dificuldade → 3 dias, sem ajuste
  });

  it('a D1 pode ser só teoria/leitura e nunca gera outra D1', () => {
    const teoria = d1({ methods: ['TEORIA'], quality: 4, minutes: 30 });
    expect(teoria.checkup).toBe(false);
    expect(teoria.intervalDays).toBe(23);
    const semNota = d1({ methods: ['LEITURA'] });
    expect(semNota.checkup).toBe(false);
    expect(semNota.intervalDays).toBe(13); // sem autoavaliação: desempenho médio (70)
    expect(semNota.nextState.lastScore).toBe(70);
  });

  it('revisão só de leitura numa etapa avançada: D1 amanhã, e a D1 feita com teoria avança normalmente', () => {
    const state: LearningSnapshot = { stage: 2, ease: 1, intervalDays: 21, lastContactOn: '2026-01-01', lastScore: 85, contacts: 3, lapses: 0 };
    const leitura = scheduleNext({ state, contact: contact('2026-01-22', { methods: ['LEITURA'], quality: 4 }), history: [] });
    expect(leitura.checkup).toBe(true);
    const dia1 = scheduleNext({
      state: leitura.nextState,
      contact: contact('2026-01-23', { methods: ['TEORIA'], quality: 4, minutes: 40 }),
      history: [],
      scheduledFor: leitura.dueOn,
      pendingCheckup: true,
    });
    expect(dia1.checkup).toBe(false);
    expect(dia1.band).toBe('bom');
    expect(dia1.stageLabel).toBe('D60');
  });

  it('tempo de estudo gradual (sem questões) e só quando não há questões', () => {
    expect([5, 10, 15, 20, 30, 45, 60, 90, 120].map((m) => studyTimeFactor(m))).toEqual([0.8, 0.85, 0.9, 0.93, 1, 1.05, 1.1, 1.15, 1.15]);
    const state: LearningSnapshot = { stage: 1, ease: 1, intervalDays: 10, lastContactOn: '2026-01-01', lastScore: 80, contacts: 2, lapses: 0 };
    const run = (partial: Partial<ContactEvidence>) =>
      scheduleNext({ state, contact: contact('2026-01-11', partial), history: [], scheduledFor: '2026-01-11' });
    const curto = run({ methods: ['FLASHCARDS'], quality: 4, minutes: 10 });
    const longo = run({ methods: ['FLASHCARDS'], quality: 4, minutes: 60 });
    expect(longo.intervalDays).toBeGreaterThan(curto.intervalDays);
    // Com questões, vale a quantidade de questões (o tempo não entra)
    const comQuestoes = run({ questions: q(17, 20), minutes: 10 });
    expect(comQuestoes.explanation.modifiers.some((m) => m.key === 'tempo')).toBe(false);
  });
});

describe('escada de revisões', () => {
  /** Faz cada revisão no dia previsto, com o resultado indicado. */
  function onSchedule(first: ContactEvidence, reviews: { correct: number; total: number }[]) {
    const results = simulate([first]);
    for (const r of reviews) {
      const prev = results[results.length - 1];
      const history = results.map((x, i) => ({ date: i === 0 ? first.date : results[i - 1].dueOn, score: x.score, accuracy: x.accuracy }));
      results.push(scheduleNext({ state: prev.nextState, contact: contact(prev.dueOn, { questions: q(r.correct, r.total) }), history, scheduledFor: prev.dueOn }));
    }
    return results;
  }

  it('D0 → D10 → D21 → D60 → D90+, sem D1 nem D7', () => {
    const results = onSchedule(contact('2026-01-05', { methods: ['TEORIA', 'QUESTOES'], questions: q(13, 20) }), [
      { correct: 17, total: 20 },
      { correct: 17, total: 20 },
      { correct: 17, total: 20 },
      { correct: 17, total: 20 },
    ]);
    expect(results.map((r) => r.stageLabel)).toEqual(['D10', 'D21', 'D60', 'D90', 'D90+']);
    expect(results[0].intervalDays).toBe(10); // 65% → 10 dias
    // Começou fraco (65%) e foi bem no D10: a facilidade menor não derruba o D21 abaixo de 21 dias
    expect(results[1].intervalDays).toBeGreaterThanOrEqual(21);
    expect(results[1].explanation.steps.some((s) => s.label === 'Mínimo da etapa')).toBe(true);
    expect(results.map((r) => r.suggestedMethods)).toEqual([
      ['QUESTOES', 'FLASHCARDS'],
      ['QUESTOES'],
      ['QUESTOES', 'FLASHCARDS'],
      ['QUESTOES', 'SIMULADO'],
      ['QUESTOES', 'SIMULADO'],
    ]);
    expect(results.some((r) => ['D1', 'D7'].includes(r.stageLabel))).toBe(false);
  });

  it('abaixo de 60% volta em 3 dias (reforço D3) e, indo bem, segue para o D10', () => {
    const [d0, reforco] = onSchedule(contact('2026-01-05', { methods: ['TEORIA', 'QUESTOES'], questions: q(11, 20) }), [
      { correct: 17, total: 20 },
    ]);
    expect(d0.intervalDays).toBe(3);
    expect(d0.stageLabel).toBe('D3');
    expect(d0.suggestedMethods).toContain('QUESTOES');
    expect(reforco.stageLabel).toBe('D10');
    expect(reforco.intervalDays).toBeGreaterThanOrEqual(10);
  });

  it('D10 e D21 podem ficar maiores com bom desempenho', () => {
    const [d0] = onSchedule(contact('2026-01-05', { questions: q(14, 20) }), []);
    expect(d0.stageLabel).toBe('D10');
    expect(d0.intervalDays).toBe(13); // 70% → 13 dias
    const [first, excelente] = onSchedule(contact('2026-01-05', { questions: q(17, 20) }), [{ correct: 20, total: 20 }]);
    expect(first.stageLabel).toBe('D21');
    expect(first.intervalDays).toBe(23); // 85% → 23 dias
    expect(excelente.intervalDays).toBeGreaterThan(60);
  });
});

describe('revisão adaptativa', () => {
  it('depois da 1ª revisão, o intervalo se adapta ao desempenho', () => {
    const [d0, r1, r2] = simulate([
      contact('2026-09-01', { methods: ['TEORIA', 'QUESTOES'], questions: q(16, 20) }),
      contact('2026-09-21', { questions: q(18, 20) }),
      contact('2026-12-15', { questions: q(10, 20) }),
    ]);
    expect(d0.intervalDays).toBe(20); // 80% → 20 dias
    expect(r1.band).toBe('excelente');
    expect(r1.intervalDays).toBeGreaterThan(60); // aumenta bastante
    expect(r2.band).toBe('fraco');
    expect(r2.intervalDays).toBeLessThan(r1.intervalDays); // perda de retenção → encurta
    expect(r2.isLapse).toBe(true);
  });

  it('percebe queda de retenção após intervalo maior e encurta os próximos intervalos', () => {
    const results = simulate([
      contact('2026-01-01', { questions: q(16, 20) }),
      contact('2026-01-08', { questions: q(18, 20) }),
      contact('2026-02-05', { questions: q(17, 20) }),
      contact('2026-04-06', { questions: q(12, 20) }),
    ]);
    const last = results[3];
    expect(last.band).toBe('fraco');
    expect(last.intervalDays).toBeLessThan(results[2].intervalDays);
    expect(last.nextState.ease).toBeLessThan(results[2].nextState.ease);
    expect(last.explanation.inputs.trend).toBe('queda');
  });

  it('regras da qualidade da revisão (seção 8)', () => {
    const state: LearningSnapshot = {
      stage: 1,
      ease: 1,
      intervalDays: 10,
      lastContactOn: '2026-09-01',
      lastScore: 80,
      contacts: 2,
      lapses: 0,
    };
    const run = (correct: number, quality: 1 | 2 | 3 | 4 | 5) =>
      scheduleNext({ state, contact: contact('2026-09-11', { questions: q(correct, 20), quality }), history: [], scheduledFor: '2026-09-11' });

    const dominei = run(18, 5); // 90% + Dominei
    const razoavel = run(14, 3); // 70% + Razoável
    const dificuldade = run(10, 2); // 50% + Tive dificuldade
    const esqueci = run(4, 1); // 20% + Esqueci

    expect(dominei.intervalDays).toBeGreaterThan(21); // aumenta bastante (D10 → D21)
    expect(razoavel.intervalDays).toBeGreaterThan(10); // aumento pequeno, mantém D10
    expect(razoavel.intervalDays).toBeLessThanOrEqual(13);
    expect(dificuldade.intervalDays).toBe(3); // volta para o reforço D3
    expect(dificuldade.stageLabel).toBe('D3');
    expect(esqueci.intervalDays).toBe(3); // reforço em 3 dias + teoria
    expect(esqueci.suggestTheory).toBe(true);
  });

  it('bom desempenho nunca encurta o intervalo', () => {
    const state: LearningSnapshot = { stage: 2, ease: 1, intervalDays: 21, lastContactOn: '2026-01-01', lastScore: 85, contacts: 3, lapses: 0 };
    const r = scheduleNext({ state, contact: contact('2026-01-22', { questions: q(17, 20) }), history: [{ date: '2025-12-01', score: 85, accuracy: 85 }] });
    expect(r.intervalDays).toBeGreaterThanOrEqual(21);
  });

  it('dá crédito ao intervalo real quando a revisão foi feita atrasada e bem', () => {
    const state: LearningSnapshot = { stage: 1, ease: 1, intervalDays: 7, lastContactOn: '2026-01-01', lastScore: 80, contacts: 1, lapses: 0 };
    const r = scheduleNext({
      state,
      contact: contact('2026-02-10', { questions: q(19, 20) }),
      history: [],
      scheduledFor: '2026-01-08',
    });
    expect(r.explanation.inputs.timing).toBe('atrasada');
    expect(r.intervalDays).toBeGreaterThanOrEqual(40 * 1.5);
  });

  it('revisão só de leitura: verificação no dia seguinte com mais questões, etapa mantida', () => {
    const state: LearningSnapshot = { stage: 2, ease: 1.1, intervalDays: 21, lastContactOn: '2026-01-01', lastScore: 85, contacts: 3, lapses: 0 };
    const r = scheduleNext({ state, contact: contact('2026-01-22', { methods: ['LEITURA', 'RESUMO'], quality: 5 }), history: [] });
    expect(r.checkup).toBe(true);
    expect(r.intervalDays).toBe(1);
    expect(r.stageLabel).toBe('D1');
    expect(r.nextState.stage).toBe(2); // não avança nem volta
    expect(r.nextState.ease).toBe(1.1);
    expect(r.score).toBeNull(); // leitura não conta como desempenho medido
    expect(r.nextState.lastScore).toBe(85);
    const normal = suggestedQuestions(2, 'MEDIUM', false);
    expect(r.suggestedQuestions.min).toBeGreaterThan(normal.min);
    expect(r.suggestedQuestions.max).toBeGreaterThan(normal.max);
    expect(r.suggestedMethods).toEqual(['QUESTOES', 'FLASHCARDS', 'RECALL']);

    // No dia seguinte, as questões decidem: bom desempenho avança a etapa normalmente
    // (fazer as questões extras sugeridas já conta como volume acima do normal)
    const next = scheduleNext({ state: r.nextState, contact: contact('2026-01-23', { questions: q(26, 30) }), history: [] });
    expect(next.checkup).toBe(false);
    expect(next.nextState.stage).toBe(3);
    expect(next.stageLabel).toBe('D60');
    expect(next.explanation.modifiers.find((m) => m.key === 'questoes')?.factor).toBe(1.1);
  });

  it('flashcards/recall contam como recuperação ativa (não viram verificação)', () => {
    const state: LearningSnapshot = { stage: 1, ease: 1, intervalDays: 7, lastContactOn: '2026-01-01', lastScore: 80, contacts: 2, lapses: 0 };
    const r = scheduleNext({ state, contact: contact('2026-01-08', { methods: ['FLASHCARDS'], quality: 4 }), history: [] });
    expect(r.checkup).toBe(false);
    expect(r.band).toBe('bom');
  });

  it('fator da quantidade de questões: 20 é a referência, gradual para menos e para mais', () => {
    const f = (n: number) => questionCountFactor(n);
    expect(f(20)).toBe(1);
    expect([f(1), f(5), f(7), f(10), f(12), f(15), f(18)]).toEqual([0.62, 0.7, 0.74, 0.8, 0.84, 0.9, 0.96]);
    expect([f(22), f(25), f(30), f(34), f(40), f(60)]).toEqual([1.02, 1.05, 1.1, 1.14, 1.2, 1.2]);
  });

  it('poucas questões encurtam e muitas alongam o intervalo, questão a questão', () => {
    const state: LearningSnapshot = { stage: 1, ease: 1, intervalDays: 10, lastContactOn: '2026-01-01', lastScore: 80, contacts: 2, lapses: 0 };
    const run = (total: number) =>
      scheduleNext({ state, contact: contact('2026-01-11', { questions: q(total, total) }), history: [], scheduledFor: '2026-01-11' }).intervalDays;
    const days = [5, 7, 10, 15, 20, 25, 30, 40].map(run);
    for (let i = 1; i < days.length; i++) expect(days[i]).toBeGreaterThan(days[i - 1]);
    expect(run(20)).toBe(26); // 100% → D21 × 1,2 (excelente) × 1,05 (facilidade)
    expect(run(50)).toBe(run(40)); // acima de 40 não cresce mais
  });

  it('7 questões certas + "Razoável" não levam mais para longe como 20 questões', () => {
    const state: LearningSnapshot = { stage: 1, ease: 1, intervalDays: 10, lastContactOn: '2026-01-01', lastScore: 80, contacts: 2, lapses: 0 };
    const run = (total: number) =>
      scheduleNext({ state, contact: contact('2026-01-11', { questions: q(total, total), quality: 3 }), history: [], scheduledFor: '2026-01-11' });
    const sete = run(7);
    expect(sete.score).toBe(88.6);
    expect(sete.intervalDays).toBe(16); // D21 (21 dias) × 0,74
    expect(sete.explanation.steps.find((s) => s.label === 'Quantidade de questões')?.detail).toMatch(/7 questões \(referência: 20\) → ×0,74: 21 → 16 dias/);
    expect(run(20).intervalDays).toBeGreaterThanOrEqual(21);
  });

  it('com poucas questões a autoavaliação só puxa a pontuação para baixo', () => {
    expect(computeScore({ questions: q(7, 7), quality: 3 }).score).toBeCloseTo(88.6, 1); // Razoável puxa para baixo
    expect(computeScore({ questions: q(4, 5), quality: 5 }).score).toBe(86); // Dominei não infla: peso normal
    expect(computeScore({ questions: q(16, 20), quality: 5 }).score).toBe(86); // mesmo resultado com 20 questões
    // 7 questões nunca vão mais longe que 21 com o mesmo percentual e a mesma autoavaliação
    const state: LearningSnapshot = { stage: 1, ease: 1, intervalDays: 10, lastContactOn: '2026-01-01', lastScore: 80, contacts: 2, lapses: 0 };
    const run = (correct: number, total: number) =>
      scheduleNext({ state, contact: contact('2026-01-11', { questions: q(correct, total), quality: 5 }), history: [], scheduledFor: '2026-01-11' });
    expect(run(5, 7).intervalDays).toBeLessThan(run(15, 21).intervalDays);
  });

  it('com desempenho abaixo de 70% a quantidade não muda o intervalo', () => {
    const state: LearningSnapshot = { stage: 3, ease: 1, intervalDays: 60, lastContactOn: '2026-01-01', lastScore: 85, contacts: 4, lapses: 0 };
    const run = (correct: number, total: number) =>
      scheduleNext({ state, contact: contact('2026-03-02', { questions: q(correct, total) }), history: [], scheduledFor: '2026-03-02' });
    expect(run(6, 10).intervalDays).toBe(21); // fraco → volta para D21
    expect(run(24, 40).intervalDays).toBe(21);
    expect(run(24, 40).explanation.modifiers.some((m) => m.key === 'questoes')).toBe(false);
  });

  it('sugestões nunca ficam abaixo da referência de 20 questões', () => {
    for (const size of ['SMALL', 'MEDIUM', 'LARGE'] as const) {
      for (let stage = 0; stage < 6; stage++) expect(suggestedQuestions(stage, size, false).min).toBeGreaterThanOrEqual(20);
      expect(suggestedQuestions(0, size, true).min).toBeGreaterThanOrEqual(20);
    }
    // Verificação que ainda vai definir a 1ª revisão: quantidade de assunto novo
    expect(reviewPlan(0, 'MEDIUM', { checkup: true, firstMeasure: true }).questions).toEqual({ min: 20, max: 30 });
    // Verificação depois de uma revisão só de leitura: mais questões que o normal
    expect(reviewPlan(1, 'MEDIUM', { checkup: true }).questions).toEqual({ min: 30, max: 45 });
  });

  it('respeita o intervalo máximo configurado', () => {
    const state: LearningSnapshot = { stage: 8, ease: 1.4, intervalDays: 180, lastContactOn: '2026-01-01', lastScore: 95, contacts: 9, lapses: 0 };
    const r = scheduleNext({ state, contact: contact('2026-06-30', { questions: q(20, 20), quality: 5 }), history: [] });
    expect(r.intervalDays).toBe(DEFAULT_SCHEDULER_CONFIG.maxIntervalDays);
  });

  it('gera explicação transparente', () => {
    const [, r] = simulate([
      contact('2026-09-01', { questions: q(15, 20) }),
      contact('2026-09-02', { questions: q(17, 20), quality: 4 }),
    ]);
    expect(r.explanation.summary).toMatch(/Próxima revisão em \d+ dias/);
    expect(r.explanation.inputs.previousScore).toBe(75);
    expect(r.explanation.inputs.lastContactOn).toBe('2026-09-01');
    expect(r.explanation.inputs.previousIntervalDays).toBe(20);
    expect(r.explanation.steps.length).toBeGreaterThan(2);
  });
});
