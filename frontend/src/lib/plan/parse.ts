// Interpreta um cronograma de cursinho (texto do PDF ou colado): semanas/módulos
// com data de início e os assuntos de cada uma. Sem DOM, para testar no Node.
//
// Formato típico:
//   MÓDULO 01 – 13/01/2025          ← início de uma semana
//   ■ HIPERTENSÃO ARTERIAL          ← assunto (a cor do ■ indica a grande área)
//   AULAS BÔNUS                     ← seção de extras
//   ■ VALVOPATIAS – 20/01/2025      ← assunto com data própria
// A legenda de cores (■ CLÍNICA MÉDICA…) costuma estar na capa.

import { norm } from '../import/sheet';
import type { PlanLine } from './pdf-lines';

export const BIG_AREAS = ['Clínica Médica', 'Cirurgia', 'Ginecologia e Obstetrícia', 'Pediatria', 'Medicina Preventiva'] as const;

export interface DraftItem {
  subject: string;
  /** Texto como veio do arquivo */
  original: string;
  marker: string | null;
  /** Área sugerida pela legenda de cores ou pelo nome do assunto */
  area: string | null;
  /** Data própria (ex.: aula bônus "VALVOPATIAS – 20/01/2025") */
  date: string | null;
  bonus: boolean;
}

export interface DraftWeek {
  label: string;
  date: string | null;
  items: DraftItem[];
}

export interface PlanDraft {
  weeks: DraftWeek[];
  /** cor do marcador → grande área (da legenda) */
  legend: Record<string, string>;
  /** Cores de marcador usadas nos assuntos */
  colors: string[];
  /** Primeira data do arquivo (início do 1º módulo) */
  firstDate: string | null;
}

export interface PlannedItem {
  subject: string;
  area: string | null;
  weekStart: string;
  label: string;
  bonus: boolean;
  position: number;
}

// ── Datas ────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};
export const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const diffDays = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
/** Próxima segunda-feira (ou hoje, se for segunda). */
export const nextMonday = (today: string) => addDays(today, (8 - new Date(`${today}T00:00:00Z`).getUTCDay()) % 7);

const DATE_RE = /(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?/;
interface RawDate {
  d: number;
  m: number;
  y: number | null;
}
const rawDate = (s: string): RawDate | null => {
  const m = s.match(DATE_RE);
  if (!m) return null;
  const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : m[3].length === 4 ? Number(m[3]) : null) : null;
  return { d: Number(m[1]), m: Number(m[2]), y };
};

// ── Texto ────────────────────────────────────────────────────────────────

const WEEK_WORD = /^(m[oó]dulo|semana|week|bloco|etapa|unidade|fase|ciclo)\b\.?\s*(n[oº°.]*\s*)?(\d+)?/i;
const RANGE_ONLY = /^\d{1,2}[/.]\d{1,2}([/.]\d{2,4})?\s*(a|at[eé]|-|–|—)\s*\d{1,2}[/.]\d{1,2}/i;
const TRAILING_DATE = /^(.*\S)\s*[-–—:|]\s*(\d{1,2}[/.]\d{1,2}(?:[/.]\d{0,4})?)\s*$/;
const BONUS = /b[oô]nus|extras?\b|complementar|opciona/i;
const NOISE = [/^p[aá]gina\s*\d+/i, /^\d+$/, /^\d+\s*m[oó]dulos?$/i, /^\d{4}$/, /todos os direitos/i, /^cronograma\b/i];

const ACRONYMS = new Set(
  'SUS HIV AIDS PCR AVC TDAH COVID REMIT DPOC IST ISTS ITU UTI TEP TVP SOP DII RN HAS DRC IRA TB DM HPV ECG IAM SCA TCE CIVD LES SNC TEA AINE DRGE HDA HDB SARS RCP ACLS ATLS PALS EMR CTI UTIN DHEG HELLP'.split(' '),
);
const ROMAN = /^(i|ii|iii|iv|v|vi|vii|viii|ix|x)$/i;

/** "HIPERTENSÃO ARTERIAL" → "Hipertensão arterial" (mantém siglas como SUS, HIV, AVC). */
export function tidySubject(text: string) {
  const t = text
    .replace(/^[\s•●▪■◆\-–—*·]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const letters = t.replace(/[^A-Za-zÀ-ÿ]/g, '');
  const upper = letters.replace(/[^A-ZÀ-Þ]/g, '').length;
  if (!letters || upper / letters.length < 0.8) return t;
  let first = true;
  return t.replace(/[A-Za-zÀ-ÿ]+/g, (w) => {
    let out: string;
    if (ACRONYMS.has(w.toUpperCase()) || ROMAN.test(w)) out = w.toUpperCase();
    else out = w.toLowerCase();
    if (first && !ACRONYMS.has(w.toUpperCase())) out = out.charAt(0).toUpperCase() + out.slice(1);
    first = false;
    return out;
  });
}

/** Nome de área na legenda → grande área (ou o próprio texto, arrumado). */
export function legendArea(text: string): string {
  const n = norm(text);
  if (/clinica|^cm$/.test(n)) return 'Clínica Médica';
  if (/cirurg/.test(n)) return 'Cirurgia';
  if (/gineco|obstet|^go$/.test(n)) return 'Ginecologia e Obstetrícia';
  if (/pediat/.test(n)) return 'Pediatria';
  if (/preventiva|coletiva|saude publica/.test(n)) return 'Medicina Preventiva';
  return tidySubject(text);
}

/** Palpite pela palavra-chave, quando o arquivo não tem legenda de cores. */
const KEYWORDS: [RegExp, string][] = [
  [/rec[eé]m-?nascid|neonat|pediatr|inf[aâ]ncia|crian[cç]a|puericult|aleitament|imuniza|vacina|crescimento e desenvolvimento|puberdade|exantem|autista|tdah|bronquiolite/, 'Pediatria'],
  [/gravidez|gesta|pr[eé]-?natal|parto|puerp|obst[eé]t|ginec|menstru|anticoncep|ov[aá]rio|endometri|climat[eé]rio|mama\b|colo uterino|uterin|fetal|amniorrexe|gemelar|infertil|dismenorr|distopia|sexualmente|amenorreia/, 'Ginecologia e Obstetrícia'],
  [/h[eé]rnia|abdome agudo|trauma|perioperat|cirurg|anestes|urolog|ortoped|proctolog|obstru[cç][aã]o intestinal|vias biliares|queimad|neoplasias intestinais|cabe[cç]a e pesco[cç]o/, 'Cirurgia'],
  [/\bsus\b|sa[uú]de da fam|aten[cç][aã]o prim|vigil[aâ]ncia|epidemiol|bio[eé]tica|[oó]bito|rastreio|medicina de fam|sa[uú]de do trabalhador|preven[cç][aã]o de/, 'Medicina Preventiva'],
];
export function guessArea(subject: string): string | null {
  const n = norm(subject);
  return KEYWORDS.find(([re]) => re.test(n))?.[1] ?? null;
}

const rgb = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
function nearestColor(color: string, options: string[]) {
  const [r, g, b] = rgb(color);
  let best: string | null = null;
  let dist = 70;
  for (const o of options) {
    const [r2, g2, b2] = rgb(o);
    const d = Math.hypot(r - r2, g - g2, b - b2);
    if (d < dist) [best, dist] = [o, d];
  }
  return best;
}

// ── Leitura ──────────────────────────────────────────────────────────────

/** Texto colado → linhas (sem cores). */
export const textToLines = (text: string): PlanLine[] =>
  text.split(/\r?\n/).map((t, i) => ({ page: 1, text: t.trim(), x: 0, y: -i, size: 10, marker: null })).filter((l) => l.text);

export function parsePlan(lines: PlanLine[], today: string): PlanDraft {
  // Cabeçalho/rodapé repetido em várias páginas não é assunto
  const pages = new Set(lines.map((l) => l.page)).size;
  const seenOn = new Map<string, Set<number>>();
  for (const l of lines) seenOn.set(norm(l.text), (seenOn.get(norm(l.text)) ?? new Set()).add(l.page));
  const repeated = (l: PlanLine) => pages >= 3 && (seenOn.get(norm(l.text))?.size ?? 0) >= Math.max(2, pages / 2);
  const clean = lines.filter((l) => l.text && !NOISE.some((re) => re.test(l.text.trim())) && !repeated(l));

  const isHeader = (t: string) => WEEK_WORD.test(t.trim()) || RANGE_ONLY.test(t.trim());
  const firstHeader = clean.findIndex((l) => isHeader(l.text));

  // Legenda: linhas coloridas antes do primeiro módulo (ex.: capa)
  const legend: Record<string, string> = {};
  for (const l of clean.slice(0, Math.max(0, firstHeader))) if (l.marker) legend[l.marker] = legendArea(l.text);

  // O arquivo usa marcadores nos assuntos? Então linha sem marcador é título, não assunto.
  const body = clean.slice(Math.max(0, firstHeader)).filter((l) => !isHeader(l.text));
  const marked = body.filter((l) => l.marker).length;
  const usesMarkers = marked >= 3 && marked / Math.max(1, body.length) >= 0.6;

  const weeks: (DraftWeek & { raw: RawDate | null })[] = [];
  const own: { item: DraftItem; raw: RawDate }[] = [];
  let bonus = false;
  for (const l of clean.slice(Math.max(0, firstHeader))) {
    const t = l.text.trim();
    if (isHeader(t)) {
      const m = t.match(WEEK_WORD);
      const raw = rawDate(t);
      const num = m?.[3] ?? String(weeks.length + 1);
      const word = m ? tidySubject(m[1]) : 'Semana';
      weeks.push({ label: `${word} ${num.padStart(2, '0')}`, date: null, items: [], raw });
      bonus = false;
      continue;
    }
    if (usesMarkers && !l.marker) {
      if (BONUS.test(t)) bonus = true;
      continue;
    }
    if (!usesMarkers && BONUS.test(t) && !TRAILING_DATE.test(t) && t.split(' ').length <= 4) {
      bonus = true;
      continue;
    }
    if (!weeks.length) continue;
    const dated = t.match(TRAILING_DATE);
    const text = dated ? dated[1] : t;
    const raw = dated ? rawDate(dated[2]) : null;
    const subject = tidySubject(text);
    if (!subject || subject.length < 2) continue;
    const item: DraftItem = { subject: subject.slice(0, 160), original: text, marker: l.marker, area: null, date: null, bonus: bonus || !!raw };
    weeks[weeks.length - 1].items.push(item);
    if (raw) own.push({ item, raw });
  }

  // Ano das datas: o mais comum entre as datas completas; ano ausente ou fora
  // do contexto (ex.: "07/07/20" num cronograma de 2025) segue o cronograma
  const years = weeks.map((w) => w.raw?.y).filter((y): y is number => !!y && y >= 2000);
  const counts = new Map<number, number>();
  for (const y of years) counts.set(y, (counts.get(y) ?? 0) + 1);
  const baseYear = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? Number(today.slice(0, 4));
  let prev: string | null = null;
  let year = baseYear;
  for (const w of weeks) {
    if (!w.raw) continue;
    let y = w.raw.y && Math.abs(w.raw.y - baseYear) <= 1 ? w.raw.y : year;
    let date = isoOf(y, w.raw.m, w.raw.d);
    if (date && prev && !w.raw.y && diffDays(prev, date) < -60) date = isoOf(++y, w.raw.m, w.raw.d);
    if (date) {
      w.date = date;
      prev = date;
      year = y;
    }
  }
  const firstDate = weeks.find((w) => w.date)?.date ?? null;
  for (const { item, raw } of own) {
    const y = raw.y && Math.abs(raw.y - baseYear) <= 1 ? raw.y : baseYear;
    let date = isoOf(y, raw.m, raw.d);
    if (date && firstDate && !raw.y && diffDays(firstDate, date) < -60) date = isoOf(y + 1, raw.m, raw.d);
    item.date = date;
  }

  // Área: cor do marcador pela legenda; sem legenda, palpite pelo nome
  const legendColors = Object.keys(legend);
  const colors = [...new Set(weeks.flatMap((w) => w.items.map((i) => i.marker)).filter((c): c is string => !!c))];
  for (const w of weeks) {
    for (const i of w.items) {
      const c = i.marker ? (legend[i.marker] ? i.marker : nearestColor(i.marker, legendColors)) : null;
      i.area = (c && legend[c]) || guessArea(i.subject);
    }
  }
  return {
    weeks: weeks.filter((w) => w.items.length).map(({ raw: _raw, ...w }) => w),
    legend,
    colors,
    firstDate,
  };
}

/** Data sugerida para o 1º módulo: a do arquivo, se ainda não passou; senão a próxima segunda. */
export function suggestedStart(draft: PlanDraft, today: string) {
  return draft.firstDate && draft.firstDate >= addDays(today, -7) ? draft.firstDate : nextMonday(today);
}

/**
 * Datas finais: o 1º módulo começa em `start` e os demais mantêm o espaçamento
 * do arquivo (módulo sem data = 7 dias depois do anterior). Aula com data
 * própria vai para a semana que contém essa data (deslocada do mesmo jeito).
 */
export function schedulePlan(draft: PlanDraft, start: string, areaOf: (item: DraftItem) => string | null = (i) => i.area): PlannedItem[] {
  const offset = draft.firstDate ? diffDays(draft.firstDate, start) : 0;
  const starts: string[] = [];
  draft.weeks.forEach((w, i) => {
    const date = w.date ? addDays(w.date, offset) : i === 0 ? start : addDays(starts[i - 1], 7);
    starts.push(i > 0 && date < starts[i - 1] ? addDays(starts[i - 1], 7) : date);
  });
  const out: PlannedItem[] = [];
  draft.weeks.forEach((w, wi) => {
    for (const item of w.items) {
      let weekIndex = wi;
      if (item.date) {
        const d = addDays(item.date, offset);
        weekIndex = 0;
        starts.forEach((s, si) => {
          if (s <= d) weekIndex = si;
        });
      }
      out.push({
        subject: item.subject,
        area: areaOf(item),
        weekStart: starts[weekIndex],
        label: item.bonus ? `${draft.weeks[weekIndex].label} · bônus` : draft.weeks[weekIndex].label,
        bonus: item.bonus,
        position: 0,
      });
    }
  });
  out.sort((a, b) => a.weekStart.localeCompare(b.weekStart) || Number(a.bonus) - Number(b.bonus));
  out.forEach((it, i) => (it.position = i));
  return out;
}
