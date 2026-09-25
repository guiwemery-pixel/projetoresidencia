// Leitura "inteligente" de planilhas de estudo/revisão (sem depender do DOM).
//
// Aceita os dois formatos mais comuns:
// - uma linha por estudo (Data | Área | Assunto | Questões | Acertos | Tempo…);
// - uma linha por assunto, com várias revisões na mesma linha
//   (Assunto | Data | % | Data R1 | % R1 | Data R2 | % R2…), inclusive com
//   cabeçalho em duas linhas ("1ª REVISÃO" mesclado sobre Data | Questões | %).
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
  /** Data prevista: só usada se a realizada estiver vazia mas houver resultado */
  planned?: number | null;
}

/** O que fazer com registros que só têm o % de acertos (sem a quantidade de questões). */
export type PercentOnlyMode = 'quality' | 'estimate';

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
  percentOnly: PercentOnlyMode;
  /** "NEFRO 2" → Clínica Médica › Nefrologia (em vez de criar uma área para cada módulo) */
  bigAreas: boolean;
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
  /** Registros só com % que ganharam uma quantidade estimada de questões */
  estimated: number;
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

/** Título de etapa num cabeçalho de cima ("CONTATO INICIAL", "1ª REVISÃO"…) → chave do grupo. */
function stageKey(text: string): string | null {
  return groupKey(text) ?? (/contato|inicial|primeiro estudo|1o estudo/.test(norm(text)) ? 'r0' : null);
}

/** "1ª REVISÃO" → "1ª revisão" (títulos em caixa-alta ficam mais legíveis). */
const tidyLabel = (s: string) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t;
};

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

// ── Grandes áreas ────────────────────────────────────────────────────────

const CM = 'Clínica Médica';
const CIR = 'Cirurgia';
const PED = 'Pediatria';
const GO = 'Ginecologia e Obstetrícia';
const PREV = 'Medicina Preventiva';

/** Especialidade/módulo (sem o número) → grande área e subárea, nos nomes do modelo de Medicina. */
const SPECIALTIES: [RegExp, string, string | null][] = [
  [/^(cm|clinica|clinica medica)$/, CM, null],
  [/^cardio/, CM, 'Cardiologia'],
  [/^pneumo/, CM, 'Pneumologia'],
  [/^gastro/, CM, 'Gastroenterologia'],
  [/^hepato/, CM, 'Hepatologia'],
  [/^nefro/, CM, 'Nefrologia'],
  [/^endocrino/, CM, 'Endocrinologia'],
  [/^reumato/, CM, 'Reumatologia'],
  [/^hemato/, CM, 'Hematologia'],
  [/^infecto/, CM, 'Infectologia'],
  [/^neuro(logia)?$/, CM, 'Neurologia'],
  [/^psiq/, CM, 'Psiquiatria'],
  [/^(cir|cirurgia|cirurgia geral)$/, CIR, null],
  [/^trauma/, CIR, 'Trauma'],
  [/^uro(logia)?$/, CIR, 'Urologia'],
  [/^orto(pedia)?$/, CIR, 'Ortopedia'],
  [/^(ped|pedi|pediatria)$/, PED, null],
  [/^neo(nato|natologia)?$/, PED, 'Neonatologia'],
  [/^(go|gineco e obstetricia|ginecologia e obstetricia|ginecologia\/obstetricia)$/, GO, null],
  [/^gin(eco|ecologia)?$/, GO, 'Ginecologia'],
  [/^(obs|obst|obstetricia)$/, GO, 'Obstetrícia'],
  [/^masto/, GO, 'Mastologia'],
  [/^(prev|preventiva|medicina preventiva|mp|saude coletiva)$/, PREV, null],
  [/^sus$/, PREV, 'SUS e Políticas de Saúde'],
  [/^epidemio/, PREV, 'Epidemiologia'],
  [/^bioestat/, PREV, 'Bioestatística'],
  [/^etica/, PREV, 'Ética Médica'],
];

/**
 * Coloca siglas de especialidade/módulo nas grandes áreas: "NEFRO 2" →
 * Clínica Médica › Nefrologia; "PED BONUS" → Pediatria; "OBS1" → GO › Obstetrícia.
 * O que não for reconhecido fica como está.
 */
export function bigArea(area: string | null, subarea: string | null): { area: string | null; subarea: string | null } {
  if (!area) return { area, subarea };
  const base = norm(area)
    .replace(/[-_.]/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/\b(bonus|extra|modulo|mod|parte|bloco)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const hit = SPECIALTIES.find(([re]) => re.test(base));
  if (!hit) return { area, subarea };
  return { area: hit[1], subarea: subarea || hit[2] };
}

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

function columnValues(grid: Grid, headerRow: number, col: number, rows = 60) {
  return grid.slice(headerRow + 1, headerRow + 1 + rows).map((r) => r[col]).filter((c) => !isEmpty(c ?? null)) as Cell[];
}

function columnLooksLikeDate(grid: Grid, headerRow: number, col: number) {
  const values = columnValues(grid, headerRow, col);
  return values.length > 0 && values.filter((c) => parseDate(c) !== null).length / values.length >= 0.6;
}

function columnDistinctText(grid: Grid, headerRow: number, col: number) {
  const values = grid.slice(headerRow + 1, headerRow + 200).map((r) => r[col]).filter((c) => typeof c === 'string' && c.trim() && parseDate(c) === null);
  return new Set(values.map(norm)).size;
}

interface ColumnInfo {
  col: number;
  /** Título na linha do cabeçalho (ou, se vazio, na linha de cima — célula mesclada na vertical) */
  title: string;
  /** Etapa a que a coluna pertence pelo cabeçalho de cima ("1ª REVISÃO" mesclado sobre várias colunas) */
  stage: { key: string; label: string } | null;
}

/**
 * Lê o cabeçalho considerando a linha de cima quando ela agrupa colunas
 * (Grande Área | Assunto | CONTATO INICIAL | 1ª REVISÃO… com Data | Questões |
 * Acertos | % embaixo de cada etapa).
 */
export function headerColumns(grid: Grid, headerRow: number): ColumnInfo[] {
  const header = grid[headerRow] ?? [];
  const above = headerRow > 0 ? (grid[headerRow - 1] ?? []) : [];
  const width = Math.max(header.length, ...grid.slice(Math.max(0, headerRow - 1), headerRow + 30).map((r) => r.length), 0);
  const text = (c: Cell | undefined) => (typeof c === 'string' ? c.replace(/\s+/g, ' ').trim() : '');
  // A linha de cima só vale como agrupamento se nomear ao menos duas etapas
  const stagesAbove = new Set(above.map((c) => stageKey(text(c))).filter(Boolean));
  const grouped = stagesAbove.size >= 2;
  const cols: ColumnInfo[] = [];
  let span: ColumnInfo['stage'] = null;
  for (let col = 0; col < width; col++) {
    const own = text(header[col]);
    const up = text(above[col]);
    if (grouped && up) {
      const key = stageKey(up);
      span = key ? { key, label: tidyLabel(up) } : null;
    }
    cols.push({ col, title: own || (grouped ? up : ''), stage: grouped && own ? span : null });
  }
  return cols;
}

/** Nome de cada coluna para os seletores ("1ª revisão · Data Realizada"). */
export function columnTitles(grid: Grid, headerRow: number): string[] {
  return headerColumns(grid, headerRow).map((c) => [c.stage?.label, c.title].filter(Boolean).join(' · '));
}

const emptyGroup = (label: string): GroupMap => ({ label, include: true, date: null, total: null, correct: null, wrong: null, percent: null, minutes: null, method: null, planned: null });

export function guessMapping(grid: Grid, headerRow = detectHeaderRow(grid)): Mapping {
  const mapping: Mapping = { headerRow, area: null, subarea: null, subject: null, notes: null, groups: [], minutesUnit: 'min', fallbackDate: null, percentOnly: 'quality', bigAreas: true };

  // 1) Classifica cada coluna
  const cols: (ColumnInfo & { kind: Kind | null; key: string | null })[] = [];
  for (const info of headerColumns(grid, headerRow)) {
    const { col, title } = info;
    let kind = kindOf(title);
    const values = columnValues(grid, headerRow, col);
    // "Dia" com "seg", "ter"… (dia da semana) não é data
    if (kind === 'date' && values.length > 0 && !columnLooksLikeDate(grid, headerRow, col)) kind = null;
    if (!kind && columnLooksLikeDate(grid, headerRow, col)) kind = 'date';
    // "R1", "D7", "2ª revisão" com números embaixo → % de acertos daquela etapa
    if (!kind && groupKey(title) && values.length > 0 && values.every((c) => parsePercent(c) !== null)) kind = 'percent';
    cols.push({ ...info, kind, key: groupKey(title) });
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

  // 2) Agrupa as colunas de cada registro. Com cabeçalho de etapas em cima, cada
  //    etapa é um registro (a data realizada vale; a programada só se faltar a
  //    realizada). Sem ele, cada coluna de data abre um grupo e colunas com a
  //    mesma chave (R1, D7…) vão para o grupo dessa chave.
  const groups: (GroupMap & { key: string | null })[] = [];
  const pendingBeforeFirstDate: typeof cols = [];
  let current: (typeof groups)[number] | null = null;
  for (const c of cols) {
    if (!c.kind || ['area', 'subarea', 'subject', 'notes'].includes(c.kind)) continue;
    const field = c.kind as GroupField;
    if (c.stage) {
      let g = groups.find((x) => x.key === `etapa:${c.stage!.key}`);
      if (!g) {
        g = { ...emptyGroup(c.stage.label), key: `etapa:${c.stage.key}` };
        groups.push(g);
      }
      if (field === 'date') {
        if (isPlanned(c.title)) g.planned ??= c.col;
        else if (g.date === null) g.date = c.col;
      } else if (g[field] === null) g[field] = c.col;
      current = g;
      continue;
    }
    if (field === 'date') {
      const g = { ...emptyGroup(c.title || `Registro ${groups.length + 1}`), key: c.key, date: c.col, include: !isPlanned(c.title) };
      groups.push(g);
      current = g;
      continue;
    }
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
  // Etapa só com data programada (nenhuma realizada) é plano, não estudo feito
  for (const g of groups) if (g.date === null && g.planned != null) g.include = false;
  mapping.groups = groups.map(({ key: _key, ...g }) => g);
  return mapping;
}

// ── Conversão linha → estudos ────────────────────────────────────────────

const cellText = (c: Cell) => (c instanceof Date ? '' : String(c ?? '').replace(/\s+/g, ' ').trim());

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};

/** Quantidade usada quando não há nenhuma referência na planilha (a mesma do algoritmo). */
export const REFERENCE_QUESTIONS = 20;

export function buildEvents(grid: Grid, m: Mapping, today: string): BuildResult {
  const result: BuildResult = { events: [], skipped: [], future: 0, percentOnly: 0, estimated: 0 };
  const header = grid[m.headerRow] ?? [];
  // Planilha de revisões lado a lado (várias etapas por linha) com colunas de questões:
  // etapa com data e sem resultado anotado continua sendo uma revisão com questões.
  const ladder = m.groups.filter((g) => g.include).length > 1;
  const allTotals: number[] = [];
  const toEstimate: { event: ImportEvent; percent: number; rowTotals: number[] }[] = [];
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
    const rowTotals: number[] = [];
    const rowEstimates: typeof toEstimate = [];
    let groupIndex = 0;
    for (const g of m.groups) {
      if (!g.include) continue;
      const get = (col: number | null | undefined) => (col == null ? null : (row[col] ?? null));
      const hasResult = [g.total, g.correct, g.wrong, g.percent, g.minutes, g.method].some((c) => c !== null && !isEmpty(get(c)));
      if (!hasResult && (g.date === null || isEmpty(get(g.date)))) continue;
      let date = g.date !== null ? parseDate(get(g.date)) : m.fallbackDate;
      // Resultado anotado sem a data realizada: vale a data programada (se já passou)
      if (!date && hasResult && g.planned != null && (g.date === null || isEmpty(get(g.date)))) date = parseDate(get(g.planned));
      if (!date) {
        if (g.date !== null && !isEmpty(get(g.date))) result.skipped.push({ row: rowNumber, reason: `data não reconhecida em "${g.label}"` });
        else result.skipped.push({ row: rowNumber, reason: `sem data em "${g.label}"` });
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
      if (total !== null) rowTotals.push(total);
      const percentOnly = total === null && p !== null;
      if (percentOnly) result.percentOnly++;
      const minutes = g.minutes !== null ? parseMinutes(get(g.minutes), m.minutesUnit) : null;
      let methods = g.method !== null ? parseMethods(get(g.method)) : [];
      const questionColumns = [g.total, g.correct, g.wrong, g.percent].some((col) => col !== null);
      if (!methods.length) methods = total !== null || p !== null || (ladder && questionColumns) ? ['QUESTOES'] : groupIndex === 0 ? ['TEORIA'] : ['REVISAO'];
      const event: ImportEvent = {
        ...(m.bigAreas ? bigArea(area || null, subarea || null) : { area: area || null, subarea: subarea || null }),
        subject,
        date,
        total,
        correct: total === null ? null : correct,
        minutes: minutes === null ? null : Math.min(1440, minutes),
        methods,
        // Só o %: vira autoavaliação aproximada (ou ganha uma quantidade estimada, abaixo)
        quality: percentOnly && m.percentOnly === 'quality' ? qualityFromPercent(p!) : null,
        notes: percentOnly && m.percentOnly === 'quality' ? `Percentual importado: ${Math.round(p!)}% (sem quantidade de questões)` : null,
      };
      if (percentOnly && m.percentOnly === 'estimate') rowEstimates.push({ event, percent: p!, rowTotals });
      rowEvents.push(event);
      groupIndex++;
    }
    if (!rowEvents.length) continue;
    if (!subject) subject = lastSubject;
    if (!subject) {
      result.skipped.push({ row: rowNumber, reason: 'sem assunto' });
      continue;
    }
    // A observação da linha vai só no primeiro estudo (não repete em cada revisão)
    if (notes) rowEvents[0].notes = [notes, rowEvents[0].notes].filter(Boolean).join(' · ');
    for (const e of rowEvents) {
      e.subject = subject.slice(0, 160);
      result.events.push(e);
    }
    allTotals.push(...rowTotals);
    toEstimate.push(...rowEstimates);
    lastArea = area;
    lastSubarea = subarea;
    lastSubject = subject;
  }
  // Quantidade estimada: a mediana das outras etapas do mesmo assunto; sem nenhuma, a da planilha
  const sheetMedian = median(allTotals) ?? REFERENCE_QUESTIONS;
  for (const { event, percent, rowTotals } of toEstimate) {
    const total = median(rowTotals) ?? sheetMedian;
    event.total = total;
    event.correct = Math.round((total * percent) / 100);
    event.notes = [event.notes, `Nº de questões estimado (${total}): a planilha só tinha o percentual, ${Math.round(percent)}%`].filter(Boolean).join(' · ');
    result.estimated++;
  }
  return result;
}

/** Aba mais provável de conter o histórico: a com mais estudos com resultado (questões ou %). */
export function pickSheet(sheets: { name: string; grid: Grid }[], today: string) {
  let best = 0;
  let bestScore = -1;
  sheets.forEach((s, i) => {
    const events = buildEvents(s.grid, guessMapping(s.grid), today).events;
    const measured = events.filter((e) => e.total !== null || e.quality !== null).length;
    // Abas de resumo (calendário, mapa, painel…) repetem as datas sem os resultados
    const derived = /calend|mapa|menu|param|painel|dashboard|resumo|grafico|instruc/.test(norm(s.name));
    const score = (measured * 3 + events.length) * (derived ? 0.5 : 1);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/**
 * Lotes para enviar ao servidor, mantendo os estudos de um assunto juntos sempre
 * que couberem (um assunto grande pode ser dividido: o histórico é recalculado
 * inteiro a cada lote). Poucos assuntos por lote: cada assunto tem o histórico
 * recalculado no servidor, e o lote precisa terminar em poucos segundos.
 */
export function batches(events: ImportEvent[], maxEvents = 150, maxSubjects = 8): ImportEvent[][] {
  const bySubject = new Map<string, ImportEvent[]>();
  for (const e of events) {
    const k = [norm(e.area), norm(e.subarea), norm(e.subject)].join('|');
    bySubject.set(k, [...(bySubject.get(k) ?? []), e]);
  }
  const out: ImportEvent[][] = [];
  let cur: ImportEvent[] = [];
  let subjects = 0;
  const flush = () => {
    if (cur.length) out.push(cur);
    cur = [];
    subjects = 0;
  };
  for (const list of bySubject.values()) {
    if (cur.length && (cur.length + list.length > maxEvents || subjects >= maxSubjects)) flush();
    subjects++;
    for (const e of list) {
      if (cur.length >= maxEvents) {
        flush();
        subjects = 1;
      }
      cur.push(e);
    }
  }
  flush();
  return out;
}
