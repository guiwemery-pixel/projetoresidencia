// Leitura "inteligente" de planilhas de estudo/revisão (sem depender do DOM).
//
// Aceita os dois formatos mais comuns:
// - uma linha por estudo (Data | Área | Assunto | Questões | Acertos | Tempo…);
// - uma linha por assunto, com várias revisões na mesma linha
//   (Assunto | Data | % | Data R1 | % R1 | Data R2 | % R2…).
// A detecção é só um palpite: a pessoa confere e ajusta o mapeamento na tela.

export type Cell = string | number | boolean | Date | null;
export type Grid = Cell[][];

export type StudyMethod = 'TEORIA' | 'QUESTOES' | 'FLASHCARDS' | 'RECALL' | 'REVISAO' | 'AULA' | 'VIDEO' | 'LEITURA' | 'RESUMO' | 'SIMULADO' | 'OUTRO';

/** Colunas de um "registro" (um dia de estudo) dentro da linha. */
export interface GroupMap {
  label: string;
  include: boolean;
  date: number | null;
  total: number | null;
  correct: number | null;
  wrong: number | null;
  percent: number | null;
  minutes: number | null;
  method: number | null;
}

export interface Mapping {
  headerRow: number;
  area: number | null;
  subarea: number | null;
  subject: number | null;
  notes: number | null;
  groups: GroupMap[];
  minutesUnit: 'min' | 'h';
  /** Usada quando a planilha não tem coluna de data */
  fallbackDate: string | null;
}

export interface ImportEvent {
  area: string | null;
  subarea: string | null;
  subject: string;
  date: string;
  total: number | null;
  correct: number | null;
  minutes: number | null;
  methods: StudyMethod[];
  quality: number | null;
  notes: string | null;
}

export interface BuildResult {
  events: ImportEvent[];
  skipped: { row: number; reason: string }[];
  future: number;
  percentOnly: number;
}

export const GROUP_FIELDS = ['date', 'total', 'correct', 'wrong', 'percent', 'minutes', 'method'] as const;
export type GroupField = (typeof GROUP_FIELDS)[number];

export const norm = (v: unknown) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[ºª°]/g, 'o')
    .replace(/\s+/g, ' ')
    .trim();

const isEmpty = (c: Cell) => c === null || c === undefined || (typeof c === 'string' && c.trim() === '');

// ── Reconhecimento de cabeçalhos ─────────────────────────────────────────

type Kind = 'area' | 'subarea' | 'subject' | 'notes' | GroupField;

const HEADER_RULES: [Kind, RegExp][] = [
  ['notes', /\b(obs|observ|anota|comentario)/],
  ['percent', /%|percent|aproveitamento|desempenho|taxa|rendimento/],
  ['correct', /acert|certas|corretas/],
  ['wrong', /\berr(o|os|adas)\b|erradas/],
  ['total', /quest|qtd|quant|\btotal\b|feitas|\bn(o|umero)? ?(de )?q\b|#q/],
  ['minutes', /tempo|minut|\bmin\b|duracao|\bhoras?\b|\bh\b/],
  ['method', /metodo|\btipo\b|\bforma\b|atividade|como estud|material/],
  ['date', /\bdata\b|\bdia\b|\bdate\b|realizad|feito em|estudad[oa] em|^d ?\d+$|^r ?\d+$|revis/],
  ['subarea', /sub ?-?area|especialidade|disciplina|materia|modulo|bloco|cadeira/],
  ['area', /\barea\b|grande area/],
  ['subject', /assunto|\btema\b|topico|conteudo|\baula\b|capitulo|\bitem\b/],
];

function kindOf(header: string): Kind | null {
  const h = norm(header);
  if (!h) return null;
  for (const [kind, re] of HEADER_RULES) if (re.test(h)) return kind;
  return null;
}

/** Datas previstas/agendadas (ainda não feitas) começam desmarcadas. */
const isPlanned = (header: string) => /previst|agend|proxim|marcad|programad|planejad/.test(norm(header));

/** "R1", "1a revisão", "Rev 2", "D7"… → chave do grupo (para juntar colunas do mesmo registro). */
function groupKey(header: string): string | null {
  const h = norm(header);
  let m = h.match(/\b(?:r|rev|revisao)\s*\.?\s*(\d+)\b/) ?? h.match(/\b(\d+)\s*o?\s*(?:rev|revisao)/);
  if (m) return `r${m[1]}`;
  m = h.match(/\bd\s*(\d+)\b/);
  if (m) return `d${m[1]}`;
  return null;
}

// ── Conversão de valores ─────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};

export function parseDate(c: Cell): string | null {
  if (c instanceof Date) {
    if (Number.isNaN(c.getTime()) || c.getUTCFullYear() < 2000) return null;
    return iso(c.getUTCFullYear(), c.getUTCMonth() + 1, c.getUTCDate());
  }
  if (typeof c === 'number') {
    // Número de série do Excel (dias desde 1899-12-30)
    if (c > 36526 && c < 73051) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(c) * 86400000);
      return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    return null;
  }
  if (typeof c !== 'string') return null;
  const s = c.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return iso(y, +m[2], +m[1]);
  }
  return null;
}

function parseNumber(c: Cell): number | null {
  if (typeof c === 'number') return Number.isFinite(c) ? c : null;
  if (typeof c !== 'string') return null;
  const s = c.trim().replace(/\s/g, '');
  if (!s) return null;
  // 1.234,5 / 1234,5 / 1234.5
  const t = /,\d{1,3}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const n = Number(t.replace(/%$/, ''));
  return Number.isFinite(n) ? n : null;
}

/** "17/20" numa célula só → acertos/total. */
function parseFraction(c: Cell): { correct: number; total: number } | null {
  if (typeof c !== 'string') return null;
  const m = c.match(/(\d+)\s*\/\s*(\d+)/);
  if (!m) return null;
  const correct = +m[1];
  const total = +m[2];
  return total > 0 && correct <= total ? { correct, total } : null;
}

export function parsePercent(c: Cell, header = ''): number | null {
  const frac = parseFraction(c);
  if (frac) return (frac.correct / frac.total) * 100;
  const n = parseNumber(c);
  if (n === null || n < 0) return null;
  const explicit = typeof c === 'string' && c.includes('%');
  // Células formatadas como % chegam como 0,85
  if (!explicit && n <= 1 && !/\b(pontos|nota)\b/.test(norm(header))) return n * 100;
  return n <= 100 ? n : null;
}

export function parseMinutes(c: Cell, unit: 'min' | 'h'): number | null {
  if (c instanceof Date) {
    // Hora formatada (ex.: 01:30) chega como data de 1899/1900
    if (c.getUTCFullYear() <= 1900) return c.getUTCHours() * 60 + c.getUTCMinutes();
    return null;
  }
  if (typeof c === 'string') {
    const s = norm(c);
    let m = s.match(/^(\d+):(\d{2})(?::\d{2})?$/);
    if (m) return +m[1] * 60 + +m[2];
    m = s.match(/^(\d+(?:[.,]\d+)?)\s*h(?:oras?)?\s*(?:(\d+)\s*(?:min|m)?)?$/);
    if (m) return Math.round(parseFloat(m[1].replace(',', '.')) * 60 + (m[2] ? +m[2] : 0));
    m = s.match(/^(\d+)\s*(?:min|m|minutos?)$/);
    if (m) return +m[1];
  }
  const n = parseNumber(c);
  if (n === null || n < 0) return null;
  if (typeof c === 'number' && n > 0 && n < 1 && unit === 'min') return Math.round(n * 1440); // fração do dia (Excel)
  return Math.round(unit === 'h' ? n * 60 : n);
}

const METHOD_RULES: [StudyMethod, RegExp][] = [
  ['SIMULADO', /simul/],
  ['QUESTOES', /quest|banca|prova/],
  ['FLASHCARDS', /flash|anki|card/],
  ['RECALL', /recall|recupera|active/],
  ['AULA', /aula|curso/],
  ['VIDEO', /video|youtube/],
  ['RESUMO', /resumo|mapa/],
  ['LEITURA', /leitura|livro|apostila|\bler\b/],
  ['REVISAO', /revis/],
  ['TEORIA', /teori|estudo/],
];

export function parseMethods(c: Cell): StudyMethod[] {
  const s = norm(c);
  if (!s) return [];
  return METHOD_RULES.filter(([, re]) => re.test(s)).map(([m]) => m);
}

/** Percentual sem quantidade de questões → autoavaliação aproximada. */
const qualityFromPercent = (p: number) => (p >= 90 ? 5 : p >= 80 ? 4 : p >= 70 ? 3 : p >= 50 ? 2 : 1);

// ── Detecção automática ──────────────────────────────────────────────────

export function detectHeaderRow(grid: Grid): number {
  let best = 0;
  let bestScore = -1;
  for (let r = 0; r < Math.min(grid.length, 20); r++) {
    const row = grid[r] ?? [];
    const texts = row.filter((c) => typeof c === 'string' && c.trim() && parseDate(c) === null && parseNumber(c) === null);
    const known = texts.filter((c) => kindOf(String(c))).length;
    const score = known * 3 + texts.length;
    if (texts.length >= 2 && score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

function columnLooksLikeDate(grid: Grid, headerRow: number, col: number) {
  const values = grid.slice(headerRow + 1, headerRow + 60).map((r) => r[col]).filter((c) => !isEmpty(c));
  return values.length > 0 && values.filter((c) => parseDate(c ?? null) !== null).length / values.length >= 0.6;
}

function columnDistinctText(grid: Grid, headerRow: number, col: number) {
  const values = grid.slice(headerRow + 1, headerRow + 200).map((r) => r[col]).filter((c) => typeof c === 'string' && c.trim() && parseDate(c) === null);
  return new Set(values.map(norm)).size;
}

const emptyGroup = (label: string): GroupMap => ({ label, include: true, date: null, total: null, correct: null, wrong: null, percent: null, minutes: null, method: null });

export function guessMapping(grid: Grid, headerRow = detectHeaderRow(grid)): Mapping {
  const header = grid[headerRow] ?? [];
  const width = Math.max(header.length, ...grid.slice(headerRow, headerRow + 30).map((r) => r.length));
  const mapping: Mapping = { headerRow, area: null, subarea: null, subject: null, notes: null, groups: [], minutesUnit: 'min', fallbackDate: null };

  // 1) Classifica cada coluna
  const cols: { col: number; kind: Kind | null; key: string | null; title: string }[] = [];
  for (let col = 0; col < width; col++) {
    const title = String(header[col] ?? '').trim();
    let kind = kindOf(title);
    if (kind === 'date' && !columnLooksLikeDate(grid, headerRow, col) && /revis|^r ?\d/.test(norm(title))) kind = null;
    if (!kind && columnLooksLikeDate(grid, headerRow, col)) kind = 'date';
    cols.push({ col, kind, key: groupKey(title), title });
  }
  for (const c of cols) {
    if (c.kind === 'area' && mapping.area === null) mapping.area = c.col;
    else if (c.kind === 'subarea' && mapping.subarea === null) mapping.subarea = c.col;
    else if (c.kind === 'subject' && mapping.subject === null) mapping.subject = c.col;
    else if (c.kind === 'notes' && mapping.notes === null) mapping.notes = c.col;
  }
  // Sem coluna "assunto": a coluna de texto com mais valores diferentes
  if (mapping.subject === null) {
    const candidates = cols.filter((c) => !c.kind && ![mapping.area, mapping.subarea, mapping.notes].includes(c.col));
    const best = candidates.map((c) => ({ c, n: columnDistinctText(grid, headerRow, c.col) })).sort((a, b) => b.n - a.n)[0];
    if (best && best.n > 0) mapping.subject = best.c.col;
  }
  if (cols.some((c) => c.kind === 'minutes' && /\bhoras?\b|\bh\b/.test(norm(c.title)) && !/min/.test(norm(c.title)))) mapping.minutesUnit = 'h';

  // 2) Agrupa as colunas de cada registro: cada coluna de data abre um grupo;
  //    colunas com a mesma chave (R1, D7…) vão para o grupo dessa chave.
  const groups: (GroupMap & { key: string | null })[] = [];
  const pendingBeforeFirstDate: typeof cols = [];
  let current: (typeof groups)[number] | null = null;
  for (const c of cols) {
    if (!c.kind || ['area', 'subarea', 'subject', 'notes'].includes(c.kind)) continue;
    if (c.kind === 'date') {
      const g = { ...emptyGroup(c.title || `Registro ${groups.length + 1}`), key: c.key, date: c.col, include: !isPlanned(c.title) };
      groups.push(g);
      current = g;
      continue;
    }
    const field = c.kind as GroupField;
    const byKey = c.key ? groups.find((g) => g.key === c.key) : undefined;
    const target = byKey ?? current;
    if (!target) {
      pendingBeforeFirstDate.push(c);
      continue;
    }
    if (target[field] === null) target[field] = c.col;
  }
  if (!groups.length) groups.push({ ...emptyGroup('Registro'), key: null });
  for (const c of pendingBeforeFirstDate) {
    const field = c.kind as GroupField;
    const target = (c.key && groups.find((g) => g.key === c.key)) || groups[0];
    if (target[field] === null) target[field] = c.col;
  }
  // Grupos sem nenhum número e marcados como previstos continuam desmarcados
  mapping.groups = groups.map(({ key: _key, ...g }) => g);
  return mapping;
}

// ── Conversão linha → estudos ────────────────────────────────────────────

const cellText = (c: Cell) => (c instanceof Date ? '' : String(c ?? '').replace(/\s+/g, ' ').trim());

export function buildEvents(grid: Grid, m: Mapping, today: string): BuildResult {
  const result: BuildResult = { events: [], skipped: [], future: 0, percentOnly: 0 };
  const header = grid[m.headerRow] ?? [];
  let lastArea = '';
  let lastSubarea = '';
  let lastSubject = '';
  for (let r = m.headerRow + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    if (row.every(isEmpty)) continue;
    const rowNumber = r + 1;
    // Células mescladas chegam só na 1ª linha: repete área/subárea/assunto da linha anterior
    const area = (m.area !== null && cellText(row[m.area])) || lastArea;
    const subarea = (m.subarea !== null && cellText(row[m.subarea])) || (m.area !== null && cellText(row[m.area]) ? '' : lastSubarea);
    let subject = m.subject !== null ? cellText(row[m.subject]) : '';
    const notes = m.notes !== null ? cellText(row[m.notes]) || null : null;

    const rowEvents: ImportEvent[] = [];
    let groupIndex = 0;
    for (const g of m.groups) {
      if (!g.include) continue;
      const get = (col: number | null) => (col === null ? null : (row[col] ?? null));
      const hasAny = [g.total, g.correct, g.wrong, g.percent, g.minutes, g.method, g.date].some((c) => c !== null && !isEmpty(get(c)));
      if (!hasAny) continue;
      const date = g.date !== null ? parseDate(get(g.date)) : m.fallbackDate;
      if (!date) {
        if (g.date !== null && !isEmpty(get(g.date))) result.skipped.push({ row: rowNumber, reason: `data não reconhecida em "${g.label}"` });
        else if (g.date === null) result.skipped.push({ row: rowNumber, reason: 'sem data' });
        continue;
      }
      if (date > today) {
        result.future++;
        continue;
      }
      let total: number | null = null;
      let correct: number | null = null;
      const frac = parseFraction(get(g.correct)) ?? parseFraction(get(g.total)) ?? parseFraction(get(g.percent));
      const t = parseNumber(get(g.total));
      const c = parseNumber(get(g.correct));
      const w = parseNumber(get(g.wrong));
      const p = g.percent !== null ? parsePercent(get(g.percent), String(header[g.percent] ?? '')) : null;
      if (frac) ({ total, correct } = frac);
      else if (t !== null && c !== null) [total, correct] = [t, c];
      else if (t !== null && p !== null) [total, correct] = [t, Math.round((t * p) / 100)];
      else if (c !== null && w !== null) [total, correct] = [c + w, c];
      else if (t !== null && w !== null) [total, correct] = [t, t - w];
      if (total !== null) {
        total = Math.round(total);
        correct = Math.round(correct ?? 0);
        if (total <= 0) total = correct = null;
        else if (correct < 0 || correct > total || total > 1000) {
          result.skipped.push({ row: rowNumber, reason: `questões/acertos inválidos em "${g.label}"` });
          continue;
        }
      }
      let quality: number | null = null;
      if (total === null && p !== null) {
        quality = qualityFromPercent(p);
        result.percentOnly++;
      }
      const minutes = g.minutes !== null ? parseMinutes(get(g.minutes), m.minutesUnit) : null;
      let methods = g.method !== null ? parseMethods(get(g.method)) : [];
      if (!methods.length) methods = total !== null || p !== null ? ['QUESTOES'] : groupIndex === 0 ? ['TEORIA'] : ['REVISAO'];
      rowEvents.push({
        area: area || null,
        subarea: subarea || null,
        subject,
        date,
        total,
        correct: total === null ? null : correct,
        minutes: minutes === null ? null : Math.min(1440, minutes),
        methods,
        quality,
        notes: [notes, total === null && p !== null ? `Percentual importado: ${Math.round(p)}% (sem quantidade de questões)` : null].filter(Boolean).join(' · ') || null,
      });
      groupIndex++;
    }
    if (!rowEvents.length) continue;
    if (!subject) subject = lastSubject;
    if (!subject) {
      result.skipped.push({ row: rowNumber, reason: 'sem assunto' });
      continue;
    }
    for (const e of rowEvents) result.events.push({ ...e, subject: subject.slice(0, 160) });
    lastArea = area;
    lastSubarea = subarea;
    lastSubject = subject;
  }
  return result;
}

/**
 * Lotes para enviar ao servidor, mantendo os estudos de um assunto juntos sempre
 * que couberem (um assunto grande pode ser dividido: o histórico é recalculado
 * inteiro a cada lote).
 */
export function batches(events: ImportEvent[], max = 300): ImportEvent[][] {
  const bySubject = new Map<string, ImportEvent[]>();
  for (const e of events) {
    const k = [norm(e.area), norm(e.subarea), norm(e.subject)].join('|');
    bySubject.set(k, [...(bySubject.get(k) ?? []), e]);
  }
  const out: ImportEvent[][] = [];
  let cur: ImportEvent[] = [];
  for (const list of bySubject.values()) {
    if (cur.length && cur.length + list.length > max) {
      out.push(cur);
      cur = [];
    }
    for (const e of list) {
      if (cur.length >= max) {
        out.push(cur);
        cur = [];
      }
      cur.push(e);
    }
  }
  if (cur.length) out.push(cur);
  return out;
}
