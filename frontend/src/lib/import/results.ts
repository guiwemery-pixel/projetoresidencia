// Notas de simulados e de provas antigas guardadas na planilha (sem DOM).
//
// Reconhece dois formatos:
// - lista: Instituição/Simulado | Nota (e, se houver, Data | Questões | Acertos);
// - tabela por ano: Instituição | 2021 | 2022 | 2023… com a nota de cada ano.
// A lista vira simulado; a tabela por ano vira resultado no banco de provas.

import { norm, parseDate, type Cell, type Grid } from './sheet';

export interface ResultItem {
  /** mock = simulado; exam = prova antiga (banco de provas, por instituição e ano) */
  kind: 'mock' | 'exam';
  name: string;
  board: string | null;
  year: number | null;
  /** 0–100 */
  accuracy: number;
  total: number | null;
  correct: number | null;
  /** Data realizada, quando a planilha informa */
  date: string | null;
  sheet: string;
  row: number;
  /** "Instituição 3" e parecidos: exemplo que veio com a planilha */
  placeholder: boolean;
}

const NAME_HEADER = /^(instituicao|instituicoes|simulado|simulados|prova|provas|concurso|exame|nome do simulado)$/;
const GRADE_HEADER = /^(nota|notas|nota final|%|% ?(de )?acertos?|acertos? ?\(%\)|acertos? %|percentual( de acertos)?|desempenho|resultado|aproveitamento)$/;
const DATE_HEADER = /^(data|dia|realizad[oa]( em)?|feito em|data realizada)$/;
const TOTAL_HEADER = /^(questoes|n(o|umero)? de questoes|total( de questoes)?)$/;
const CORRECT_HEADER = /^(acertos|n(o|umero)? de acertos)$/;
const STUDY_HEADER = /assunto|\btema\b|topico|conteudo/;
const PLACEHOLDER = /^(instituicao|simulado|prova|banca|exemplo)\s*\d*$/;

const text = (c: Cell | undefined) => (typeof c === 'string' ? c.replace(/\s+/g, ' ').trim() : typeof c === 'number' ? String(c) : '');

function yearOf(c: Cell | undefined, maxYear: number): number | null {
  const s = text(c);
  if (!/^\d{4}$/.test(s)) return null;
  const y = Number(s);
  return y >= 2000 && y <= maxYear ? y : null;
}

/** Nota bruta: número (0,57 / 57 / 5,7) ou texto ("57%", "57/100"). */
function rawGrade(c: Cell | undefined): { value: number; percent: boolean } | null {
  if (typeof c === 'number') return Number.isFinite(c) && c >= 0 ? { value: c, percent: false } : null;
  const s = text(c);
  if (!s) return null;
  const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac && +frac[2] > 0 && +frac[1] <= +frac[2]) return { value: (+frac[1] / +frac[2]) * 100, percent: true };
  const m = s.replace(',', '.').match(/^(\d+(?:\.\d+)?)\s*(%)?$/);
  return m ? { value: Number(m[1]), percent: !!m[2] } : null;
}

/** Escala da tabela inteira: tudo ≤ 1 → fração; tudo ≤ 10 → nota de 0 a 10; senão, %. */
function toPercent(values: { value: number; percent: boolean }[]) {
  const plain = values.filter((v) => !v.percent).map((v) => v.value);
  const scale = plain.length && plain.every((v) => v <= 1) ? 100 : plain.length && plain.every((v) => v <= 10) && plain.some((v) => v > 1) ? 10 : 1;
  return values.map((v) => {
    const p = v.percent ? v.value : v.value * scale;
    return p >= 0 && p <= 100 ? Math.round(p * 10) / 10 : null;
  });
}

/** "SUS-BA 2023" → banca "SUS-BA", 2023; "UNIFESP (25)" → "UNIFESP", 2025; "INEP 24" → "INEP", 2024. */
export function splitExamName(name: string, maxYear: number): { board: string; year: number | null } {
  const s = name.replace(/\s+/g, ' ').trim();
  const four = s.match(/(^|[^\d])((?:19|20)\d{2})(?!\d)/);
  const two = four ? null : (s.match(/\(\s*(\d{2})\s*\)/) ?? s.match(/[\s-](\d{2})$/));
  let year: number | null = null;
  let cut = s.length;
  if (four) {
    year = Number(four[2]);
    cut = four.index! + four[1].length;
  } else if (two) {
    year = 2000 + Number(two[1]);
    cut = two.index!;
  }
  if (year !== null && (year < 2000 || year > maxYear)) {
    year = null;
    cut = s.length;
  }
  const board = s.slice(0, cut).replace(/[\s(\-–:,]+$/, '').trim();
  return { board: board || s, year };
}

function readSheet(name: string, grid: Grid, today: string): ResultItem[] {
  const maxYear = Number(today.slice(0, 4)) + 1;
  const items: ResultItem[] = [];
  const used = new Set<string>();
  for (let r = 0; r < Math.min(grid.length, 80); r++) {
    const row = grid[r] ?? [];
    // Cabeçalho de registro de estudos (com assunto) não é tabela de notas
    if (row.some((c) => STUDY_HEADER.test(norm(text(c))))) continue;
    for (let c = 0; c < row.length; c++) {
      if (!NAME_HEADER.test(norm(text(row[c]))) || used.has(`${r}:${c}`)) continue;
      const right = Array.from({ length: 16 }, (_, i) => c + 1 + i);
      const yearCols = right.map((col) => ({ col, year: yearOf(row[col], maxYear) })).filter((y): y is { col: number; year: number } => y.year !== null);
      const table: { row: number; name: string; cells: { year: number | null; grade: Cell; date: Cell; total: Cell; correct: Cell }[] }[] = [];
      let kind: ResultItem['kind'];
      if (yearCols.length >= 2) {
        // Tabela por ano (instituição × ano)
        kind = 'exam';
        for (let rr = r + 1; rr < grid.length; rr++) {
          const n = text(grid[rr]?.[c]);
          if (!n) break;
          table.push({ row: rr, name: n, cells: yearCols.map(({ col, year }) => ({ year, grade: grid[rr]?.[col] ?? null, date: null, total: null, correct: null })) });
        }
      } else {
        const gradeCol = right.slice(0, 3).find((col) => GRADE_HEADER.test(norm(text(row[col]))));
        if (gradeCol === undefined) continue;
        kind = 'mock';
        const find = (re: RegExp) => row.findIndex((cell, i) => i !== c && i !== gradeCol && re.test(norm(text(cell))));
        const [dateCol, totalCol, correctCol] = [find(DATE_HEADER), find(TOTAL_HEADER), find(CORRECT_HEADER)];
        for (let rr = r + 1; rr < grid.length; rr++) {
          const n = text(grid[rr]?.[c]);
          if (!n) break;
          const at = (col: number) => (col >= 0 ? (grid[rr]?.[col] ?? null) : null);
          table.push({ row: rr, name: n, cells: [{ year: null, grade: at(gradeCol), date: at(dateCol), total: at(totalCol), correct: at(correctCol) }] });
        }
      }
      used.add(`${r}:${c}`);
      const flat = table.flatMap((t) => t.cells.map((cell) => ({ t, cell, raw: rawGrade(cell.grade) })));
      const withGrade = flat.filter((f) => f.raw);
      const percents = toPercent(withGrade.map((f) => f.raw!));
      withGrade.forEach(({ t, cell }, i) => {
        const total = typeof cell.total === 'number' && cell.total > 0 ? Math.round(cell.total) : null;
        const correct = total !== null && typeof cell.correct === 'number' && cell.correct >= 0 && cell.correct <= total ? Math.round(cell.correct) : null;
        const accuracy = total !== null && correct !== null ? Math.round((correct / total) * 1000) / 10 : percents[i];
        if (accuracy === null) return;
        const parsed = kind === 'exam' ? { board: t.name, year: cell.year } : splitExamName(t.name, maxYear);
        const date = parseDate(cell.date ?? null);
        items.push({
          kind,
          name: kind === 'exam' ? `${t.name} ${cell.year}` : t.name,
          board: parsed.board || null,
          year: parsed.year,
          accuracy,
          total: correct === null ? null : total,
          correct,
          date: date && date <= today ? date : null,
          sheet: name,
          row: t.row + 1,
          placeholder: PLACEHOLDER.test(norm(t.name)),
        });
      });
    }
  }
  return items;
}

/** Simulados e provas de todas as abas da planilha. */
export function findResults(sheets: { name: string; grid: Grid }[], today: string): ResultItem[] {
  return sheets.flatMap((s) => readSheet(s.name, s.grid, today));
}
