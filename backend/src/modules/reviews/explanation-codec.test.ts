import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SCHEDULER_CONFIG,
  accuracyOf,
  addDays,
  measuredScore,
  scheduleNext,
  type ContactEvidence,
  type Explanation,
  type HistoryPoint,
  type LearningSnapshot,
  type Method,
  type ScheduleResult,
} from '../scheduler/index.js';
import { EXPLANATION_DICTIONARY_V1 } from './explanation-dictionary.js';
import { packExplanation, readExplanation, unpackExplanation } from './explanation-codec.js';

// Explicações reais do motor em cenários variados (acertos, atraso, só leitura…)
function sampleExplanations(): Explanation[] {
  const methodSets: Method[][] = [['QUESTOES'], ['TEORIA', 'QUESTOES'], ['LEITURA'], ['FLASHCARDS'], ['RECALL', 'QUESTOES']];
  const out: Explanation[] = [];
  for (let s = 0; s < 40; s++) {
    let state: LearningSnapshot | null = null;
    let pending: ScheduleResult | null = null;
    const history: HistoryPoint[] = [];
    let date = addDays('2026-03-02', s);
    for (let c = 0; c < 6; c++) {
      if (pending) date = addDays(pending.dueOn, (s + c) % 4 === 0 ? 5 : 0);
      const methods = methodSets[(s + c) % methodSets.length];
      const total = methods.includes('QUESTOES') ? 10 + ((s * 7 + c * 3) % 30) : 0;
      const contact: ContactEvidence = {
        date,
        methods,
        questions: total ? { total, correct: Math.round(total * (0.35 + ((s * 13 + c * 11) % 60) / 100)) } : null,
        quality: c % 3 === 0 ? null : (((s + c) % 5) + 1) as 1 | 2 | 3 | 4 | 5,
        difficulty: c % 2 === 0 ? null : ((s % 3) + 1) as 1 | 2 | 3,
      };
      const result = scheduleNext(
        { state, contact, history: [...history], scheduledFor: pending?.dueOn ?? null, subjectSize: 'MEDIUM' },
        DEFAULT_SCHEDULER_CONFIG,
      );
      out.push(result.explanation);
      history.push({ date, score: measuredScore(contact, DEFAULT_SCHEDULER_CONFIG), accuracy: accuracyOf(contact.questions) });
      state = result.nextState;
      pending = result;
    }
  }
  return out;
}

describe('compressão da explicação ("Por quê?")', () => {
  it('o dicionário v1 nunca muda (os dados gravados dependem dele)', () => {
    const hash = createHash('sha256').update(EXPLANATION_DICTIONARY_V1, 'utf8').digest('hex');
    expect(hash).toBe('95a757aaa6872bca13967f8bc3ea90e36616fb51c9cb990df09a0d53b6ac50e8');
  });

  it('devolve exatamente o mesmo conteúdo e ocupa bem menos espaço', () => {
    let json = 0;
    let packed = 0;
    for (const e of sampleExplanations()) {
      const bytes = packExplanation(e);
      expect(JSON.stringify(unpackExplanation(bytes))).toBe(JSON.stringify(e));
      json += Buffer.byteLength(JSON.stringify(e));
      packed += bytes.length;
    }
    expect(packed / json).toBeLessThan(0.25);
  });

  it('lê o formato antigo (JSON) e não quebra com dado ilegível', () => {
    const legacy = { summary: 'Próxima revisão em 7 dias' };
    expect(readExplanation({ explanation: legacy, explanationPacked: null })).toEqual(legacy);
    expect(readExplanation({ explanation: null, explanationPacked: null })).toBeNull();
    expect(() => unpackExplanation(new Uint8Array([9, 1, 2]))).toThrow(/desconhecida/);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(readExplanation({ explanation: null, explanationPacked: new Uint8Array([1, 255, 0]) })).toBeNull();
    spy.mockRestore();
  });
});
