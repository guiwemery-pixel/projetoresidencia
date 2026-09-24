import { format, formatDistanceToNowStrict, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

/** "YYYY-MM-DD" → Date local (sem deslocamento de fuso). */
export const parseDay = (d: string) => parseISO(d);

export const fmtDay = (d: string, pattern = "dd 'de' MMM") => format(parseDay(d), pattern, { locale: ptBR });
export const fmtShort = (d: string) => format(parseDay(d), 'dd/MM', { locale: ptBR });
export const fmtLong = (d: string) => format(parseDay(d), "EEEE, dd 'de' MMMM", { locale: ptBR });
export const fmtWeekday = (d: string) => format(parseDay(d), 'EEE', { locale: ptBR });
export const fmtMonth = (d: string) => format(parseDay(d), "MMMM 'de' yyyy", { locale: ptBR });
export const fmtRelative = (iso: string) =>
  formatDistanceToNowStrict(new Date(iso), { locale: ptBR, addSuffix: true });

// "Hoje" segue o fuso do perfil do usuário (o mesmo que o servidor usa),
// não o do aparelho — evita datas "no futuro" com o celular em outro fuso.
let appTimeZone: string | undefined;
export function setAppTimeZone(timeZone?: string | null) {
  appTimeZone = timeZone ?? undefined;
}

export function todayLocal(): string {
  if (appTimeZone) {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: appTimeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    } catch {
      /* fuso inválido: usa o do aparelho */
    }
  }
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDaysStr(d: string, n: number): string {
  const date = parseDay(d);
  date.setDate(date.getDate() + n);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function diffDaysStr(from: string, to: string): number {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86_400_000);
}

/** Segunda-feira da semana de `d`. */
export function startOfWeekStr(d: string): string {
  const day = parseDay(d).getDay(); // 0 = domingo
  return addDaysStr(d, day === 0 ? -6 : 1 - day);
}

/** "em 3 dias", "amanhã", "hoje", "há 2 dias" */
export function relativeDay(d: string, today = todayLocal()): string {
  const n = diffDaysStr(today, d);
  if (n === 0) return 'hoje';
  if (n === 1) return 'amanhã';
  if (n === -1) return 'ontem';
  if (n > 1) return `em ${n} dias`;
  return `há ${-n} dias`;
}

export const pct = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: digits })}%`;

export const num = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined ? '—' : v.toLocaleString('pt-BR', { maximumFractionDigits: digits });

export function duration(minutes: number): string {
  if (!minutes) return '0 min';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
