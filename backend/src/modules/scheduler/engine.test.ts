import { describe, expect, it } from 'vitest';
import { DEFAULT_SCHEDULER_CONFIG, mergeConfig, scheduleNext, type ContactEvidence, type HistoryPoint, type LearningSnapshot, type ScheduleResult } from './index.js';

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
  it('só teoria agenda D1', () => {
    const r = scheduleNext({ state: null, contact: contact('2026-09-01', { methods: ['TEORIA'] }), history: [] });
    expect(r.intervalDays).toBe(1);
    expect(r.stageLabel).toBe('D1');
    expect(r.dueOn).toBe('2026-09-02');
    expect(r.suggestedMethods).toEqual(['FLASHCARDS', 'RECALL', 'QUESTOES']);
  });

  it('16/20 (80%) no D0 agenda D7 (exemplo do enunciado)', () => {
    const r = scheduleNext({
      state: null,
      contact: contact('2026-09-01', { methods: ['TEORIA', 'QUESTOES'], questions: q(16, 20) }),
      history: [],
    });
    expect(r.band).toBe('bom');
    expect(r.intervalDays).toBe(7);
    expect(r.stageLabel).toBe('D7');
  });

  it('desempenho mediano no D0 mantém D1', () => {
    const r = scheduleNext({ state: null, contact: contact('2026-09-01', { questions: q(14, 20) }), history: [] });
    expect(r.band).toBe('medio');
    expect(r.intervalDays).toBe(1);
  });

  it('desempenho crítico no D0 sugere voltar à teoria', () => {
    const r = scheduleNext({ state: null, contact: contact('2026-09-01', { questions: q(6, 20), quality: 1 }), history: [] });
    expect(r.band).toBe('critico');
    expect(r.intervalDays).toBe(1);
    expect(r.suggestTheory).toBe(true);
    expect(r.suggestedMethods).toContain('TEORIA');
  });

  it('a regra de pular o D1 é configurável', () => {
    const strict = mergeConfig(DEFAULT_SCHEDULER_CONFIG, { firstContact: { skipFirstReviewMinScore: 90 } });
    const r = scheduleNext(
      { state: null, contact: contact('2026-09-01', { questions: q(16, 20) }), history: [] },
      strict,
    );
    expect(r.intervalDays).toBe(1);
  });
});

describe('revisão adaptativa', () => {
  it('reproduz o exemplo: 80% → D7; 90% → ~D21–30; 50% → ~D7–10', () => {
    const [d0, d7, d30] = simulate([
      contact('2026-09-01', { methods: ['TEORIA', 'QUESTOES'], questions: q(16, 20) }),
      contact('2026-09-08', { questions: q(18, 20) }),
      contact('2026-10-08', { questions: q(10, 20) }),
    ]);
    expect(d0.intervalDays).toBe(7);
    expect(d7.band).toBe('excelente');
    expect(d7.intervalDays).toBeGreaterThanOrEqual(21);
    expect(d7.intervalDays).toBeLessThanOrEqual(30);
    expect(d30.band).toBe('fraco');
    expect(d30.intervalDays).toBeGreaterThanOrEqual(7);
    expect(d30.intervalDays).toBeLessThanOrEqual(10);
    expect(d30.isLapse).toBe(true);
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

  it('contato apenas passivo não chega a "excelente" e recebe fator menor', () => {
    const state: LearningSnapshot = { stage: 1, ease: 1, intervalDays: 7, lastContactOn: '2026-01-01', lastScore: 80, contacts: 1, lapses: 0 };
    const r = scheduleNext({ state, contact: contact('2026-01-08', { methods: ['LEITURA'], quality: 5 }), history: [] });
    expect(r.band).toBe('bom');
    expect(r.explanation.modifiers.some((m) => m.key === 'passivo')).toBe(true);
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
    expect(r.explanation.inputs.previousIntervalDays).toBe(1);
    expect(r.explanation.steps.length).toBeGreaterThan(2);
  });
});
