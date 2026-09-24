import { describe, expect, it } from 'vitest';
import { DEFAULT_SCHEDULER_CONFIG, mergeConfig, scheduleNext, suggestedQuestions, type ContactEvidence, type HistoryPoint, type LearningSnapshot, type ScheduleResult } from './index.js';

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
  it('só teoria agenda D1 com questões (mais que o normal)', () => {
    const r = scheduleNext({ state: null, contact: contact('2026-09-01', { methods: ['TEORIA'] }), history: [] });
    expect(r.intervalDays).toBe(1);
    expect(r.stageLabel).toBe('D1');
    expect(r.dueOn).toBe('2026-09-02');
    expect(r.checkup).toBe(true);
    expect(r.suggestedMethods).toEqual(['QUESTOES']);
    expect(r.suggestedQuestions).toEqual({ min: 15, max: 25 });
  });

  it('a data da 1ª revisão sai do percentual de acertos (tabela)', () => {
    const first = (correct: number, total: number) =>
      scheduleNext({ state: null, contact: contact('2026-09-01', { methods: ['TEORIA', 'QUESTOES'], questions: q(correct, total) }), history: [] })
        .intervalDays;
    expect(first(11, 20)).toBe(3); // 55%  → abaixo de 60%
    expect(first(12, 20)).toBe(10); // 60%
    expect(first(13, 20)).toBe(10); // 65%
    expect(first(10, 15)).toBe(13); // 66,7%
    expect(first(14, 20)).toBe(13); // 70%
    expect(first(15, 20)).toBe(20); // 75%
    expect(first(16, 20)).toBe(20); // 80%
    expect(first(17, 20)).toBe(23); // 85%
    expect(first(20, 20)).toBe(23); // 100%
  });

  it('abaixo de 50% no 1º contato sugere voltar à teoria', () => {
    const r = scheduleNext({ state: null, contact: contact('2026-09-01', { questions: q(6, 20), quality: 1 }), history: [] });
    expect(r.intervalDays).toBe(3);
    expect(r.suggestTheory).toBe(true);
    expect(r.suggestedMethods).toContain('TEORIA');
  });

  it('com poucas questões no 1º contato pede verificação no dia seguinte', () => {
    const r = scheduleNext({ state: null, contact: contact('2026-09-01', { questions: q(3, 3) }), history: [] });
    expect(r.checkup).toBe(true);
    expect(r.intervalDays).toBe(1);
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

  it('mais questões no 1º contato aumentam o intervalo', () => {
    const r = scheduleNext({ state: null, contact: contact('2026-09-01', { questions: q(34, 40) }), history: [] });
    expect(r.intervalDays).toBe(Math.round(23 * 1.2)); // 85% com 2× o sugerido
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
      intervalDays: 7,
      lastContactOn: '2026-09-01',
      lastScore: 80,
      contacts: 2,
      lapses: 0,
    };
    const run = (correct: number, quality: 1 | 2 | 3 | 4 | 5) =>
      scheduleNext({ state, contact: contact('2026-09-08', { questions: q(correct, 20), quality }), history: [], scheduledFor: '2026-09-08' });

    const dominei = run(18, 5); // 90% + Dominei
    const razoavel = run(14, 3); // 70% + Razoável
    const dificuldade = run(10, 2); // 50% + Tive dificuldade
    const esqueci = run(4, 1); // 20% + Esqueci

    expect(dominei.intervalDays).toBeGreaterThan(20); // aumenta bastante
    expect(razoavel.intervalDays).toBeGreaterThan(7); // aumento pequeno
    expect(razoavel.intervalDays).toBeLessThan(12);
    expect(dificuldade.intervalDays).toBeLessThan(7); // diminui
    expect(esqueci.intervalDays).toBe(1); // revisão próxima
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
    expect(r.suggestedMethods).toEqual(['QUESTOES']);

    // No dia seguinte, as questões decidem: bom desempenho avança a etapa normalmente
    // (fazer as questões extras sugeridas já conta como volume acima do normal)
    const next = scheduleNext({ state: r.nextState, contact: contact('2026-01-23', { questions: q(26, 30) }), history: [] });
    expect(next.checkup).toBe(false);
    expect(next.nextState.stage).toBe(3);
    expect(next.stageLabel).toBe('D60');
    expect(next.explanation.modifiers.some((m) => m.key === 'volume')).toBe(true);
  });

  it('flashcards/recall contam como recuperação ativa (não viram verificação)', () => {
    const state: LearningSnapshot = { stage: 1, ease: 1, intervalDays: 7, lastContactOn: '2026-01-01', lastScore: 80, contacts: 2, lapses: 0 };
    const r = scheduleNext({ state, contact: contact('2026-01-08', { methods: ['FLASHCARDS'], quality: 4 }), history: [] });
    expect(r.checkup).toBe(false);
    expect(r.band).toBe('bom');
  });

  it('mais questões que o sugerido (com bom desempenho) dão intervalo maior', () => {
    const state: LearningSnapshot = { stage: 1, ease: 1, intervalDays: 7, lastContactOn: '2026-01-01', lastScore: 80, contacts: 2, lapses: 0 };
    const run = (correct: number, total: number) =>
      scheduleNext({ state, contact: contact('2026-01-08', { questions: q(correct, total) }), history: [], expectedQuestions: 15 });
    const sugerido = run(12, 15); // 80%, o sugerido
    const dobro = run(24, 30); // 80%, 2× o sugerido
    const triplo = run(36, 45); // 80%, 3× o sugerido
    expect(sugerido.explanation.modifiers.some((m) => m.key === 'volume')).toBe(false);
    expect(dobro.intervalDays).toBeGreaterThan(sugerido.intervalDays);
    expect(triplo.intervalDays).toBeGreaterThanOrEqual(dobro.intervalDays);
    // Muitas questões com desempenho ruim não ganham bônus
    const ruim = run(15, 30);
    expect(ruim.explanation.modifiers.some((m) => m.key === 'volume')).toBe(false);
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
