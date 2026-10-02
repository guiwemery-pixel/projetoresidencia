import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { StudyMethod } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { addDays, diffDays, todayIn } from '../../lib/dates.js';
import { reviewPlan } from '../scheduler/index.js';
import { getSchedulerConfig } from '../reviews/algorithm-config.js';
import { listReviews } from '../reviews/reviews.service.js';
import { planItemsBetween } from '../plans/plans.service.js';
import { renderCalendar, zonedToUtc, type IcsEvent } from './ical.js';

// Agenda para o Google Agenda (e Apple/Outlook): um link iCal secreto por usuário,
// que o calendário assina e relê sozinho. Mostra as revisões pendentes (as atrasadas
// no dia de hoje), as semanas do cronograma e os flashcards previstos por dia.

export const optionsSchema = z.object({
  /** Semanas do cronograma */
  plan: z.boolean().default(true),
  /** Cards dos flashcards para revisar em cada dia */
  flashcards: z.boolean().default(true),
  /** Horário fixo ("19:00") ou null para eventos de dia inteiro */
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable()
    .default(null),
  /** Duração (min) quando há horário */
  duration: z.number().int().min(15).max(480).default(60),
  /** Um evento por dia com todas as revisões, em vez de um por revisão */
  group: z.boolean().default(false),
});
export type FeedOptions = z.infer<typeof optionsSchema>;

const DAYS_AHEAD = 180;
const FETCH_MARK_MS = 10 * 60 * 1000;
const newToken = () => randomBytes(24).toString('base64url');

const METHOD_LABEL: Record<StudyMethod, string> = {
  TEORIA: 'Teoria',
  QUESTOES: 'Questões',
  FLASHCARDS: 'Flashcards',
  RECALL: 'Recall',
  REVISAO: 'Revisão',
  AULA: 'Aula',
  VIDEO: 'Vídeo',
  LEITURA: 'Leitura',
  RESUMO: 'Resumo',
  SIMULADO: 'Simulado',
  OUTRO: 'Outro',
};

function readOptions(raw: unknown): FeedOptions {
  const parsed = optionsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : optionsSchema.parse({});
}

export const feedPath = (token: string) => `/api/ical/${token}.ics`;

function view(feed: { token: string; options: unknown; createdAt: Date; lastFetchedAt: Date | null; lastClient: string | null } | null, baseUrl: string) {
  if (!feed) return { enabled: false as const, options: readOptions(null) };
  const url = baseUrl + feedPath(feed.token);
  return {
    enabled: true as const,
    url,
    webcalUrl: url.replace(/^https?:/, 'webcal:'),
    options: readOptions(feed.options),
    createdAt: feed.createdAt.toISOString(),
    lastFetchedAt: feed.lastFetchedAt?.toISOString() ?? null,
    lastClient: feed.lastClient,
  };
}

export async function getFeed(userId: string, baseUrl: string) {
  return view(await prisma.calendarFeed.findUnique({ where: { userId } }), baseUrl);
}

/** Liga a agenda (ou gera um link novo, invalidando o anterior). */
export async function enableFeed(userId: string, baseUrl: string, regenerate: boolean) {
  const existing = await prisma.calendarFeed.findUnique({ where: { userId } });
  if (existing && !regenerate) return view(existing, baseUrl);
  const feed = await prisma.calendarFeed.upsert({
    where: { userId },
    create: { userId, token: newToken(), options: optionsSchema.parse({}) },
    update: { token: newToken(), lastFetchedAt: null, lastClient: null },
  });
  return view(feed, baseUrl);
}

export async function updateOptions(userId: string, baseUrl: string, patch: Partial<FeedOptions>) {
  const existing = await prisma.calendarFeed.findUnique({ where: { userId } });
  if (!existing) return getFeed(userId, baseUrl);
  const options = optionsSchema.parse({ ...readOptions(existing.options), ...patch });
  const feed = await prisma.calendarFeed.update({ where: { userId }, data: { options } });
  return view(feed, baseUrl);
}

export async function disableFeed(userId: string) {
  await prisma.calendarFeed.deleteMany({ where: { userId } });
}

/** Nome curto de quem leu a agenda, pelo User-Agent. */
export function clientName(userAgent: string | undefined) {
  const ua = userAgent ?? '';
  if (/google/i.test(ua)) return 'Google Agenda';
  if (/microsoft|outlook/i.test(ua)) return 'Outlook';
  if (/iOS|Mac OS|CalendarAgent|dataaccessd|Darwin/i.test(ua)) return 'Apple Calendário';
  return null;
}

const fmtDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const shortList = (names: string[], max = 3) => names.slice(0, max).join(', ') + (names.length > max ? ` (+${names.length - max})` : '');
/** 90 → "1h30", 45 → "45 min" */
const duration = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`);

/** O arquivo .ics da agenda, ou null se o link não existe (mais). */
export async function renderFeed(token: string, baseUrl: string, userAgent?: string, now = new Date()) {
  const feed = await prisma.calendarFeed.findUnique({ where: { token }, include: { user: { select: { id: true, timezone: true } } } });
  if (!feed) return null;
  const { id: userId, timezone } = feed.user;
  const options = readOptions(feed.options);
  const today = todayIn(timezone, now);
  const until = addDays(today, DAYS_AHEAD);

  const [reviews, planItems, fcSync, config] = await Promise.all([
    listReviews(userId, { status: 'PENDING', to: until, limit: 2000 }),
    options.plan ? planItemsBetween(userId, addDays(today, -365), until, today) : Promise.resolve([]),
    options.flashcards ? prisma.flashcardSync.findUnique({ where: { userId }, select: { summary: true } }) : Promise.resolve(null),
    getSchedulerConfig(),
  ]);

  const events: IcsEvent[] = [];
  /** Dia inteiro ou no horário escolhido (em UTC, pelo fuso do usuário). */
  const when = (date: string): Pick<IcsEvent, 'date' | 'start' | 'end'> => {
    if (!options.time) return { date };
    const start = zonedToUtc(date, options.time, timezone);
    return { start, end: new Date(start.getTime() + options.duration * 60_000) };
  };

  // ── Revisões (atrasadas aparecem hoje) ──
  const reviewItems = reviews.map((r) => {
    const plan = reviewPlan(r.stage, r.subject.size, { checkup: r.checkup, theory: r.suggestTheory }, config);
    const overdue = r.scheduledFor < today;
    const methods = (r.suggestedMethods.length ? r.suggestedMethods : plan.methods).map((m) => METHOD_LABEL[m]).join(', ');
    const detail = [
      r.subject.area?.path,
      `Fase: ${r.phase}`,
      `Sugerido: ${methods} · ${plan.questions.min}–${plan.questions.max} questões`,
      r.suggestTheory ? 'Volte ao conteúdo teórico antes das questões.' : null,
      overdue ? `Atrasada: prevista para ${fmtDate(r.scheduledFor)}.` : null,
    ].filter(Boolean) as string[];
    return { r, date: overdue ? today : r.scheduledFor, overdue, detail };
  });
  if (options.group) {
    const byDate = new Map<string, typeof reviewItems>();
    for (const item of reviewItems) byDate.set(item.date, [...(byDate.get(item.date) ?? []), item]);
    for (const [date, items] of byDate) {
      const late = items.filter((i) => i.overdue).length;
      events.push({
        uid: `reviews-${date}@projeto-residente`,
        summary: `${plural(items.length, 'revisão', 'revisões')}${late ? ` (${late} atrasada${late > 1 ? 's' : ''})` : ''}: ${shortList(items.map((i) => i.r.subject.name))}`,
        description:
          items.map((i) => `• ${i.overdue ? 'Atrasada · ' : ''}${i.r.stageLabel} · ${i.r.subject.name}\n  ${i.detail.join('\n  ')}`).join('\n\n') + `\n\nAbrir: ${baseUrl}/revisoes`,
        url: `${baseUrl}/revisoes`,
        categories: ['Revisão'],
        ...when(date),
      });
    }
  } else {
    for (const { r, date, overdue, detail } of reviewItems) {
      events.push({
        uid: `review-${r.id}@projeto-residente`,
        summary: `${overdue ? 'Atrasada · ' : ''}Revisão ${r.stageLabel} · ${r.subject.name}`,
        description: `${detail.join('\n')}\n\nAbrir: ${baseUrl}/assuntos/${r.subject.id}`,
        url: `${baseUrl}/assuntos/${r.subject.id}`,
        categories: ['Revisão'],
        ...when(date),
      });
    }
  }

  // ── Cronograma: um evento por dia de estudo (o que passou do dia, ainda nesta semana, vai para hoje);
  //    sem distribuição pelos dias, a semana inteira; o que ficou de semanas passadas, hoje ──
  if (options.plan) {
    const pending = planItems.filter((i) => i.status === 'PENDING');
    const late = pending.filter((i) => i.overdue);
    if (late.length) {
      events.push({
        uid: `plan-late@projeto-residente`,
        summary: `Cronograma atrasado · ${plural(late.length, 'assunto', 'assuntos')}: ${shortList(late.map((i) => i.subject.name))}`,
        description: late.map((i) => `• ${i.subject.name}${i.subject.area ? ` (${i.subject.area.path})` : ''} — semana de ${fmtDate(i.weekStart)}`).join('\n') + `\n\nAbrir: ${baseUrl}/cronograma`,
        url: `${baseUrl}/cronograma`,
        categories: ['Cronograma'],
        date: today,
      });
    }
    const groups = new Map<string, typeof pending>();
    for (const i of pending.filter((x) => !x.overdue)) {
      const key = i.distributed ? `${i.planId}|day|${i.plannedOn < today ? today : i.plannedOn}` : `${i.planId}|week|${i.weekStart}`;
      groups.set(key, [...(groups.get(key) ?? []), i]);
    }
    for (const [key, items] of groups) {
      const [, kind, date] = key.split('|');
      const first = items[0];
      const label = first.label ?? `Semana de ${fmtDate(first.weekStart)}`;
      const time = (i: (typeof items)[number]) => (i.suggestedMinutes ? ` · ~${duration(i.suggestedMinutes)}` : '');
      events.push({
        uid: `plan-${first.planId}-${kind === 'day' ? date : `w${date}`}@projeto-residente`,
        summary: `Cronograma · ${label}: ${shortList(items.map((i) => i.subject.name))}`,
        description:
          `${first.planName}\n\n` +
          items.map((i) => `• ${i.subject.name}${i.subject.area ? ` (${i.subject.area.path})` : ''}${time(i)}${i.behind ? ` — era para ${fmtDate(i.plannedOn)}` : ''}`).join('\n') +
          `\n\nAbrir: ${baseUrl}/cronograma`,
        url: `${baseUrl}/cronograma`,
        categories: ['Cronograma'],
        date,
        ...(kind === 'week' ? { endDate: addDays(date, 7) } : {}),
      });
    }
  }

  // ── Flashcards: previsão por dia calculada pelo app (resumo enviado ao abrir a aba) ──
  const summary = fcSync?.summary as { dayStart?: number; forecast?: number[] } | null | undefined;
  if (options.flashcards && summary?.forecast?.length && summary.dayStart) {
    const summaryDay = todayIn(timezone, new Date(summary.dayStart));
    const offset = diffDays(summaryDay, today);
    const forecast = summary.forecast;
    if (offset >= 0 && offset < forecast.length) {
      for (let k = offset; k < forecast.length; k++) {
        // Hoje: o previsto para hoje + o que venceu desde o último resumo (ainda por fazer)
        const count = k === offset ? forecast.slice(0, offset + 1).reduce((a, b) => a + b, 0) : forecast[k];
        if (!count) continue;
        const date = addDays(summaryDay, k);
        events.push({
          uid: `flashcards-${date}@projeto-residente`,
          summary: `Flashcards · ${plural(count, 'card', 'cards')} para revisar`,
          description: `Previsão da aba Flashcards (fora os cards novos do dia).\n\nAbrir: ${baseUrl}/flashcards/revisar`,
          url: `${baseUrl}/flashcards/revisar`,
          categories: ['Flashcards'],
          ...when(date),
        });
      }
    }
  }

  // Marca a leitura (no máximo a cada 10 min, para não gravar a cada acesso)
  if (!feed.lastFetchedAt || now.getTime() - feed.lastFetchedAt.getTime() > FETCH_MARK_MS) {
    await prisma.calendarFeed.update({ where: { userId }, data: { lastFetchedAt: now, lastClient: clientName(userAgent) } }).catch(() => {});
  }

  return renderCalendar(
    {
      name: 'Revisões · Projeto Residente',
      description: 'Revisões, cronograma e flashcards do Projeto Residente. Atualiza sozinha.',
      timeZone: timezone,
      events,
    },
    now,
  );
}
