// Geração de arquivos iCalendar (RFC 5545) — o formato que o Google Agenda, o Apple
// Calendário e o Outlook assinam por URL. Só o necessário: eventos de dia inteiro ou
// com hora (em UTC), texto escapado e linhas dobradas em 75 bytes.

export interface IcsEvent {
  uid: string;
  summary: string;
  description?: string;
  url?: string;
  categories?: string[];
  /** Dia inteiro: `date` (YYYY-MM-DD) e `endDate` exclusivo (padrão: dia seguinte). */
  date?: string;
  endDate?: string;
  /** Com hora: início e fim em UTC. */
  start?: Date;
  end?: Date;
}

export interface IcsCalendar {
  name: string;
  description?: string;
  timeZone?: string;
  events: IcsEvent[];
}

/** Texto de propriedade: barra, ponto e vírgula, vírgula e quebras de linha escapados. */
export function escapeText(text: string) {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Dobra a linha em partes de até 75 bytes (UTF-8), sem cortar um caractere ao meio. */
export function foldLine(line: string) {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    const limit = parts.length ? 74 : 75; // as continuações começam com um espaço
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const compactDate = (date: string) => date.replace(/-/g, '');

/** Date → 20261005T220000Z */
export function utcStamp(d: Date) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function nextDay(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Diferença (ms) entre o horário local no fuso e o UTC, no instante dado. */
function zoneOffset(instant: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - instant;
}

/** "2026-10-05" às "19:30" no fuso do usuário → instante em UTC (considera horário de verão). */
export function zonedToUtc(date: string, time: string, timeZone: string) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let utc = wall - zoneOffset(wall, timeZone);
  utc = wall - zoneOffset(utc, timeZone);
  return new Date(utc);
}

export function renderCalendar(cal: IcsCalendar, now = new Date()) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Projeto Residente//Revisoes//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(cal.name)}`,
    ...(cal.description ? [`X-WR-CALDESC:${escapeText(cal.description)}`] : []),
    ...(cal.timeZone ? [`X-WR-TIMEZONE:${cal.timeZone}`] : []),
    // Sugestão de releitura (o Google decide sozinho; Apple e Outlook respeitam)
    'REFRESH-INTERVAL;VALUE=DURATION:PT2H',
    'X-PUBLISHED-TTL:PT2H',
  ];
  const stamp = utcStamp(now);
  for (const e of cal.events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${stamp}`);
    if (e.start && e.end) {
      lines.push(`DTSTART:${utcStamp(e.start)}`, `DTEND:${utcStamp(e.end)}`);
    } else if (e.date) {
      lines.push(`DTSTART;VALUE=DATE:${compactDate(e.date)}`, `DTEND;VALUE=DATE:${compactDate(e.endDate ?? nextDay(e.date))}`);
    }
    lines.push(`SUMMARY:${escapeText(e.summary)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    if (e.categories?.length) lines.push(`CATEGORIES:${e.categories.map(escapeText).join(',')}`);
    // Não ocupa o horário na agenda (é lembrete de estudo, não compromisso)
    lines.push('TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
