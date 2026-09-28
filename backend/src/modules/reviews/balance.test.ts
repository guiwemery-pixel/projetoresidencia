import { describe, expect, it } from 'vitest';
import { planBalance } from './balance.service.js';

// Limite de revisões por dia: o excedente vai para o dia vizinho com vaga

const TODAY = '2026-10-01';
let seq = 0;
function rev(scheduledFor: string, extra: Partial<Parameters<typeof planBalance>[0][number]> = {}) {
  seq++;
  return {
    id: `r${seq}`,
    subjectId: `s${seq}`,
    scheduledFor,
    shiftedFrom: null as string | null,
    manual: false,
    intervalDays: 20,
    createdAt: new Date(Date.UTC(2026, 8, 1, 0, seq)),
    ...extra,
  };
}
/** Revisões por dia depois de aplicar os movimentos. */
function loads(rows: ReturnType<typeof rev>[], moves: ReturnType<typeof planBalance>) {
  const to = new Map(moves.map((m) => [m.id, m.to]));
  const out: Record<string, number> = {};
  for (const r of rows) {
    const d = to.get(r.id) ?? r.scheduledFor;
    out[d] = (out[d] ?? 0) + 1;
  }
  return out;
}

describe('limite de revisões por dia', () => {
  it('7 no dia 18: as 2 que chegaram por último vão uma para o dia 17 e outra para o 19', () => {
    const rows = Array.from({ length: 7 }, () => rev('2026-10-18'));
    const moves = planBalance(rows, TODAY, 5);
    expect(moves.map((m) => [m.id, m.from, m.to, m.ideal])).toEqual([
      [rows[6].id, '2026-10-18', '2026-10-17', '2026-10-18'],
      [rows[5].id, '2026-10-18', '2026-10-19', '2026-10-18'],
    ]);
    expect(loads(rows, moves)).toEqual({ '2026-10-17': 1, '2026-10-18': 5, '2026-10-19': 1 });
  });

  it('dias vizinhos cheios: procura mais longe, sem nunca passar de 5', () => {
    const rows = [...Array.from({ length: 5 }, () => rev('2026-10-17')), ...Array.from({ length: 8 }, () => rev('2026-10-18')), ...Array.from({ length: 5 }, () => rev('2026-10-19'))];
    const moves = planBalance(rows, TODAY, 5);
    const after = loads(rows, moves);
    expect(Object.values(after).every((n) => n <= 5)).toBe(true);
    expect(after).toEqual({ '2026-10-16': 2, '2026-10-17': 5, '2026-10-18': 5, '2026-10-19': 5, '2026-10-20': 1 });
  });

  it('remarcadas à mão ficam; nunca antes do dia seguinte ao estudo; hoje não recebe', () => {
    // Todas no dia 2 (amanhã): D1 de ontem não pode ir para trás; manual não sai do lugar
    const manual = Array.from({ length: 3 }, () => rev('2026-10-02', { manual: true }));
    const d1 = Array.from({ length: 3 }, () => rev('2026-10-02', { intervalDays: 1 }));
    const moves = planBalance([...manual, ...d1], TODAY, 5);
    expect(moves).toHaveLength(1);
    expect(manual.map((m) => m.id)).not.toContain(moves[0].id);
    expect(moves[0].to).toBe('2026-10-03');
    // Hoje acima do limite: o excedente vai para amanhã (nunca para trás)
    const todayRows = Array.from({ length: 6 }, () => rev(TODAY));
    expect(planBalance(todayRows, TODAY, 5).map((m) => m.to)).toEqual(['2026-10-02']);
  });

  it('reforço curto (≤ 2 dias) é o último a sair do lugar', () => {
    const rows = [rev('2026-10-10', { intervalDays: 2 }), ...Array.from({ length: 5 }, () => rev('2026-10-10', { intervalDays: 30 }))];
    const [m] = planBalance(rows, TODAY, 5);
    expect(m.id).not.toBe(rows[0].id);
  });

  it('quando abre vaga, a revisão volta para a data calculada; sem limite, todas voltam', () => {
    const rows = [...Array.from({ length: 4 }, () => rev('2026-10-18')), rev('2026-10-17', { shiftedFrom: '2026-10-18' })];
    const moves = planBalance(rows, TODAY, 5);
    expect(moves).toEqual([{ id: rows[4].id, subjectId: rows[4].subjectId, from: '2026-10-17', to: '2026-10-18', ideal: '2026-10-18' }]);
    const full = [...Array.from({ length: 5 }, () => rev('2026-10-18')), rev('2026-10-17', { shiftedFrom: '2026-10-18' })];
    expect(planBalance(full, TODAY, 5)).toEqual([]);
    expect(planBalance(full, TODAY, 0).map((m) => m.to)).toEqual(['2026-10-18']);
  });

  it('dentro do limite, nada muda', () => {
    const rows = Array.from({ length: 5 }, () => rev('2026-10-18'));
    expect(planBalance(rows, TODAY, 5)).toEqual([]);
  });
});
