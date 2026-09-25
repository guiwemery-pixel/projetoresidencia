import type { StudyMethod } from '@prisma/client';
import { prisma, type Tx } from '../../lib/prisma.js';
import { badRequest } from '../../lib/errors.js';
import { fromDb, toDb } from '../../lib/dates.js';
import { round } from '../../lib/math.js';
import { rebuildSubject } from '../reviews/learning.service.js';

// Importação de planilhas: o arquivo é lido no navegador e chegam aqui só os
// estudos já convertidos (um por data). Tudo é gravado na conta de quem envia.
// Reimportar a mesma planilha não duplica: estudos iguais (assunto, data,
// questões, acertos e tempo) são ignorados. Ao final, o histórico de cada
// assunto é reprocessado pelo motor de revisão.

export interface ImportEvent {
  area?: string | null;
  subarea?: string | null;
  subject: string;
  date: string;
  total?: number | null;
  correct?: number | null;
  minutes?: number | null;
  methods?: StudyMethod[];
  quality?: number | null;
  difficulty?: number | null;
  notes?: string | null;
}

/** Área usada quando a linha não informa nenhuma. */
export const DEFAULT_AREA = 'Importados';

/** Abreviações comuns de grandes áreas nas planilhas de residência. */
const AREA_ALIASES: Record<string, string> = {
  cm: 'clinica medica',
  clinica: 'clinica medica',
  cir: 'cirurgia',
  'cirurgia geral': 'cirurgia',
  ped: 'pediatria',
  pedi: 'pediatria',
  go: 'ginecologia e obstetricia',
  gineco: 'ginecologia e obstetricia',
  'gineco e obstetricia': 'ginecologia e obstetricia',
  'ginecologia/obstetricia': 'ginecologia e obstetricia',
  prev: 'medicina preventiva',
  mp: 'medicina preventiva',
  preventiva: 'medicina preventiva',
  'saude coletiva': 'medicina preventiva',
};

export const normName = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const cleanName = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 120);
const areaKey = (s: string) => AREA_ALIASES[normName(s)] ?? normName(s);

interface Resolved {
  /** chave do assunto → id existente (ou null se será criado) */
  subjects: Map<string, { id: string | null; areaKey: string; name: string }>;
  newAreas: string[];
  newSubjects: string[];
}

/** Assunto de destino de cada evento: "área|subárea|assunto" normalizados. */
function subjectKey(e: ImportEvent) {
  return [areaKey(e.area || DEFAULT_AREA), normName(e.subarea ?? ''), normName(e.subject)].join('|');
}

export function validateEvents(events: ImportEvent[], today: string) {
  events.forEach((e, i) => {
    const where = `Registro ${i + 1} (${e.subject})`;
    if (e.date > today) throw badRequest(`${where}: data no futuro`);
    if (e.date < '2000-01-01') throw badRequest(`${where}: data inválida`);
    if (e.total != null && e.correct != null && e.correct > e.total) throw badRequest(`${where}: acertos maiores que o total`);
    if ((e.total == null) !== (e.correct == null)) throw badRequest(`${where}: informe questões e acertos juntos`);
  });
}

async function resolve(tx: Tx | typeof prisma, userId: string, events: ImportEvent[], create: boolean): Promise<Resolved> {
  const areas = await tx.area.findMany({ where: { userId } });
  const tops = new Map(areas.filter((a) => !a.parentId).map((a) => [areaKey(a.name), a]));
  const children = new Map(areas.filter((a) => a.parentId).map((a) => [`${a.parentId}|${normName(a.name)}`, a]));
  const newAreas: string[] = [];
  const newSubjects: string[] = [];
  const subjects: Resolved['subjects'] = new Map();

  for (const e of events) {
    const key = subjectKey(e);
    if (subjects.has(key)) continue;
    const topName = cleanName(e.area || DEFAULT_AREA);
    let top = tops.get(areaKey(topName));
    if (!top) {
      newAreas.push(topName);
      top = create
        ? await tx.area.create({ data: { userId, name: topName, position: tops.size } })
        : ({ id: `new:${topName}`, name: topName } as (typeof areas)[number]);
      tops.set(areaKey(topName), top);
    }
    let target = top;
    if (e.subarea && normName(e.subarea)) {
      const subName = cleanName(e.subarea);
      const ck = `${top.id}|${normName(subName)}`;
      let sub = children.get(ck);
      if (!sub) {
        newAreas.push(`${top.name} › ${subName}`);
        sub = create
          ? await tx.area.create({ data: { userId, name: subName, parentId: top.id } })
          : ({ id: `new:${ck}`, name: subName } as (typeof areas)[number]);
        children.set(ck, sub);
      }
      target = sub;
    }
    const name = cleanName(e.subject).slice(0, 160);
    const existing = target.id.startsWith('new:')
      ? null
      : await tx.subject.findFirst({ where: { userId, areaId: target.id, name: { equals: name, mode: 'insensitive' } } });
    if (existing) {
      subjects.set(key, { id: existing.id, areaKey: target.id, name });
      if (create && existing.archived) await tx.subject.update({ where: { id: existing.id }, data: { archived: false } });
    } else {
      newSubjects.push(name);
      const created = create ? await tx.subject.create({ data: { userId, areaId: target.id, name } }) : null;
      subjects.set(key, { id: created?.id ?? null, areaKey: target.id, name });
    }
  }
  return { subjects, newAreas, newSubjects };
}

const fingerprint = (subjectId: string, date: string, total: number | null, correct: number | null, minutes: number) =>
  `${subjectId}|${date}|${total ?? '-'}|${correct ?? '-'}|${minutes}`;

/** Estudos que já existem (para reimportar sem duplicar). */
async function existingFingerprints(tx: Tx | typeof prisma, userId: string, subjectIds: string[]) {
  if (!subjectIds.length) return new Set<string>();
  const sessions = await tx.studySession.findMany({
    where: { userId, subjectId: { in: subjectIds } },
    select: { subjectId: true, studiedOn: true, durationMinutes: true, questionSessions: { select: { total: true, correct: true } } },
  });
  return new Set(
    sessions.map((s) => {
      const q = s.questionSessions[0];
      return fingerprint(s.subjectId, fromDb(s.studiedOn), q?.total ?? null, q?.correct ?? null, s.durationMinutes);
    }),
  );
}

const methodsFor = (e: ImportEvent): StudyMethod[] =>
  e.methods?.length ? [...new Set(e.methods)] : e.total ? ['QUESTOES'] : ['TEORIA'];

/** Prévia: o que seria criado, sem gravar nada. */
export async function previewImport(userId: string, events: ImportEvent[], today: string) {
  validateEvents(events, today);
  const r = await resolve(prisma, userId, events, false);
  const existingIds = [...r.subjects.values()].map((s) => s.id).filter((id): id is string => !!id);
  const seen = await existingFingerprints(prisma, userId, existingIds);
  let duplicates = 0;
  let studies = 0;
  let questions = 0;
  const bySubject = new Map<string, number>();
  for (const e of events) {
    const s = r.subjects.get(subjectKey(e))!;
    if (s.id && seen.has(fingerprint(s.id, e.date, e.total ?? null, e.correct ?? null, e.minutes ?? 0))) {
      duplicates++;
      continue;
    }
    studies++;
    questions += e.total ?? 0;
    bySubject.set(subjectKey(e), (bySubject.get(subjectKey(e)) ?? 0) + 1);
  }
  const dates = events.map((e) => e.date).sort();
  return {
    studies,
    duplicates,
    questions,
    subjects: bySubject.size,
    newSubjects: r.newSubjects.length,
    newAreas: [...new Set(r.newAreas)],
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
  };
}

/**
 * Grava os estudos e reprocessa o histórico dos assuntos afetados.
 * O cliente envia em lotes (todos os estudos de um mesmo assunto no mesmo lote).
 */
export async function runImport(userId: string, events: ImportEvent[], today: string) {
  validateEvents(events, today);
  return prisma.$transaction(
    async (tx) => {
      const r = await resolve(tx, userId, events, true);
      const ids = [...new Set([...r.subjects.values()].map((s) => s.id!))];
      const seen = await existingFingerprints(tx, userId, ids);
      let created = 0;
      let duplicates = 0;
      const touched = new Set<string>();
      for (const e of events) {
        const subjectId = r.subjects.get(subjectKey(e))!.id!;
        const minutes = e.minutes ?? 0;
        const fp = fingerprint(subjectId, e.date, e.total ?? null, e.correct ?? null, minutes);
        if (seen.has(fp)) {
          duplicates++;
          continue;
        }
        seen.add(fp);
        const session = await tx.studySession.create({
          data: {
            userId,
            subjectId,
            studiedOn: toDb(e.date),
            durationMinutes: minutes,
            methods: methodsFor(e),
            quality: e.quality ?? null,
            difficulty: e.difficulty ?? null,
            notes: e.notes ? e.notes.slice(0, 2000) : null,
          },
        });
        if (e.total && e.correct != null) {
          await tx.questionSession.create({
            data: {
              userId,
              subjectId,
              studySessionId: session.id,
              doneOn: toDb(e.date),
              total: e.total,
              correct: e.correct,
              wrong: e.total - e.correct,
              accuracy: round((e.correct / e.total) * 100, 2),
            },
          });
        }
        created++;
        touched.add(subjectId);
      }
      for (const subjectId of touched) {
        // Marca o primeiro contato e reprocessa o histórico (revisões feitas e a próxima)
        const first = await tx.studySession.findFirst({ where: { userId, subjectId }, orderBy: [{ studiedOn: 'asc' }, { createdAt: 'asc' }] });
        await tx.studySession.updateMany({ where: { userId, subjectId }, data: { isFirstContact: false } });
        if (first) await tx.studySession.update({ where: { id: first.id }, data: { isFirstContact: true } });
        await rebuildSubject(tx, userId, subjectId);
      }
      return { created, duplicates, subjects: touched.size, newSubjects: r.newSubjects.length, newAreas: [...new Set(r.newAreas)] };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}
