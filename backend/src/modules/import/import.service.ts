import { randomUUID } from 'node:crypto';
import { Prisma, type StudyMethod } from '@prisma/client';
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
//
// O banco pode estar longe do servidor (cada consulta custa uma ida e volta):
// por isso tudo é lido e gravado em bloco, e o navegador manda poucos assuntos
// por vez.

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

/** Simulado com nota (a quantidade de questões é opcional). */
export interface ImportMock {
  name: string;
  board?: string | null;
  year?: number | null;
  date: string;
  /** 0–100 */
  accuracy: number;
  total?: number | null;
  correct?: number | null;
}

/** Nota numa prova antiga (banco de provas: banca + ano). */
export interface ImportExamResult {
  board: string;
  year: number;
  date: string;
  /** 0–100 */
  accuracy: number;
  total?: number | null;
  correct?: number | null;
}

export interface ImportPayload {
  events: ImportEvent[];
  mocks?: ImportMock[];
  exams?: ImportExamResult[];
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

function validateResults(items: (ImportMock | ImportExamResult)[], today: string) {
  items.forEach((m) => {
    const where = 'name' in m ? m.name : `${m.board} ${m.year}`;
    if (m.date > today) throw badRequest(`${where}: data no futuro`);
    if (m.date < '2000-01-01') throw badRequest(`${where}: data inválida`);
    if ((m.total == null) !== (m.correct == null)) throw badRequest(`${where}: informe questões e acertos juntos`);
    if (m.total != null && m.correct != null && m.correct > m.total) throw badRequest(`${where}: acertos maiores que o total`);
  });
}

async function resolve(tx: Tx | typeof prisma, userId: string, events: ImportEvent[], create: boolean): Promise<Resolved> {
  const [areas, existing] = await Promise.all([
    tx.area.findMany({ where: { userId } }),
    tx.subject.findMany({ where: { userId }, select: { id: true, areaId: true, name: true, archived: true } }),
  ]);
  const tops = new Map(areas.filter((a) => !a.parentId).map((a) => [areaKey(a.name), a]));
  const children = new Map(areas.filter((a) => a.parentId).map((a) => [`${a.parentId}|${normName(a.name)}`, a]));
  const byName = new Map<string, (typeof existing)[number]>();
  for (const s of existing) if (!byName.has(`${s.areaId}|${normName(s.name)}`)) byName.set(`${s.areaId}|${normName(s.name)}`, s);
  const newAreas: string[] = [];
  const subjects: Resolved['subjects'] = new Map();
  const toCreate = new Map<string, { areaId: string; name: string }>();
  const toUnarchive: string[] = [];

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
    const found = byName.get(`${target.id}|${normName(name)}`);
    if (found) {
      subjects.set(key, { id: found.id, areaKey: target.id, name });
      if (found.archived) toUnarchive.push(found.id);
    } else {
      subjects.set(key, { id: null, areaKey: target.id, name });
      toCreate.set(`${target.id}|${normName(name)}`, { areaId: target.id, name });
    }
  }
  if (create && toCreate.size) {
    const created = await tx.subject.createManyAndReturn({
      data: [...toCreate.values()].map((s) => ({ userId, areaId: s.areaId, name: s.name })),
      select: { id: true, areaId: true, name: true },
    });
    const ids = new Map(created.map((c) => [`${c.areaId}|${normName(c.name)}`, c.id]));
    for (const s of subjects.values()) if (!s.id) s.id = ids.get(`${s.areaKey}|${normName(s.name)}`) ?? null;
  }
  if (create && toUnarchive.length) await tx.subject.updateMany({ where: { id: { in: toUnarchive } }, data: { archived: false } });
  return { subjects, newAreas, newSubjects: [...toCreate.values()].map((s) => s.name) };
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

const mockKey = (name: string, accuracy: number) => `${normName(name)}|${round(accuracy, 1)}`;
const accuracyOfResult = (m: ImportMock | ImportExamResult) =>
  m.total && m.correct != null ? round((m.correct / m.total) * 100, 1) : round(m.accuracy, 1);

/**
 * Simulados e provas: o que é novo (reimportar não duplica) e, com `create`,
 * grava. Prova antiga vira resultado no banco de provas (banca → prova do ano).
 */
async function saveResults(tx: Tx | typeof prisma, userId: string, mocks: ImportMock[], exams: ImportExamResult[], create: boolean) {
  const out = { mocks: 0, mockDuplicates: 0, exams: 0, examDuplicates: 0, newBoards: [] as string[] };
  if (mocks.length) {
    const existing = await tx.mockExam.findMany({ where: { userId, accuracy: { not: null } }, select: { name: true, accuracy: true } });
    const seen = new Set(existing.map((m) => mockKey(m.name, m.accuracy!)));
    const fresh: Prisma.MockExamCreateManyInput[] = [];
    const base = Date.now();
    for (const m of mocks) {
      const accuracy = accuracyOfResult(m);
      const key = mockKey(m.name, accuracy);
      if (seen.has(key)) {
        out.mockDuplicates++;
        continue;
      }
      seen.add(key);
      fresh.push({
        userId,
        name: cleanName(m.name),
        board: m.board ? cleanName(m.board).slice(0, 80) : null,
        year: m.year ?? null,
        takenOn: toDb(m.date),
        status: 'DONE',
        totalQuestions: m.total ?? null,
        correct: m.correct ?? null,
        accuracy,
        notes: 'Importado de planilha',
        // Mesma data para vários: a ordem da planilha é mantida
        createdAt: new Date(base + fresh.length),
      });
    }
    out.mocks = fresh.length;
    if (create && fresh.length) await tx.mockExam.createMany({ data: fresh });
  }
  if (exams.length) {
    const boards = await tx.board.findMany({
      where: { userId },
      include: { exams: { select: { id: true, name: true, year: true, attempts: { select: { accuracy: true } } } } },
    });
    const byBoard = new Map(boards.map((b) => [normName(b.name), b]));
    const attempts: Prisma.ExamAttemptCreateManyInput[] = [];
    for (const x of exams) {
      const boardName = cleanName(x.board).slice(0, 80);
      const accuracy = accuracyOfResult(x);
      let board = byBoard.get(normName(boardName));
      if (!board) {
        out.newBoards.push(boardName);
        board = create
          ? { ...(await tx.board.create({ data: { userId, name: boardName } })), exams: [] }
          : ({ id: `new:${boardName}`, name: boardName, exams: [] } as unknown as (typeof boards)[number]);
        byBoard.set(normName(boardName), board);
      }
      const examName = `${board.name} ${x.year}`;
      let exam = board.exams.find((e) => normName(e.name) === normName(examName)) ?? board.exams.find((e) => e.year === x.year);
      if (!exam) {
        exam = create
          ? { ...(await tx.exam.create({ data: { userId, boardId: board.id, name: examName, year: x.year }, select: { id: true, name: true, year: true } })), attempts: [] }
          : { id: `new:${examName}`, name: examName, year: x.year, attempts: [] };
        board.exams.push(exam);
      }
      if (exam.attempts.some((a) => round(a.accuracy, 1) === accuracy)) {
        out.examDuplicates++;
        continue;
      }
      exam.attempts.push({ accuracy });
      attempts.push({
        userId,
        examId: exam.id,
        takenOn: toDb(x.date),
        totalQuestions: x.total ?? null,
        correct: x.correct ?? null,
        accuracy,
        notes: 'Importado de planilha',
      });
    }
    out.exams = attempts.length;
    if (create && attempts.length) await tx.examAttempt.createMany({ data: attempts });
  }
  return out;
}

/** Prévia: o que seria criado, sem gravar nada. */
export async function previewImport(userId: string, payload: ImportPayload, today: string) {
  const { events, mocks = [], exams = [] } = payload;
  validateEvents(events, today);
  validateResults([...mocks, ...exams], today);
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
    ...(await saveResults(prisma, userId, mocks, exams, false)),
  };
}

/**
 * Grava os estudos (e os simulados/provas) e reprocessa o histórico dos assuntos
 * afetados. O cliente envia em lotes (todos os estudos de um mesmo assunto no mesmo lote).
 */
export async function runImport(userId: string, payload: ImportPayload, today: string) {
  const { events, mocks = [], exams = [] } = payload;
  validateEvents(events, today);
  validateResults([...mocks, ...exams], today);
  return prisma.$transaction(
    async (tx) => {
      let created = 0;
      let duplicates = 0;
      const touched = new Set<string>();
      let newSubjects = 0;
      let newAreas: string[] = [];
      if (events.length) {
        const r = await resolve(tx, userId, events, true);
        newSubjects = r.newSubjects.length;
        newAreas = [...new Set(r.newAreas)];
        const ids = [...new Set([...r.subjects.values()].map((s) => s.id!))];
        const seen = await existingFingerprints(tx, userId, ids);
        const sessions: Prisma.StudySessionCreateManyInput[] = [];
        const questions: Prisma.QuestionSessionCreateManyInput[] = [];
        for (const e of events) {
          const subjectId = r.subjects.get(subjectKey(e))!.id!;
          const minutes = e.minutes ?? 0;
          const fp = fingerprint(subjectId, e.date, e.total ?? null, e.correct ?? null, minutes);
          if (seen.has(fp)) {
            duplicates++;
            continue;
          }
          seen.add(fp);
          const id = randomUUID();
          sessions.push({
            id,
            userId,
            subjectId,
            studiedOn: toDb(e.date),
            durationMinutes: minutes,
            methods: methodsFor(e),
            quality: e.quality ?? null,
            difficulty: e.difficulty ?? null,
            notes: e.notes ? e.notes.slice(0, 2000) : null,
          });
          if (e.total && e.correct != null) {
            questions.push({
              userId,
              subjectId,
              studySessionId: id,
              doneOn: toDb(e.date),
              total: e.total,
              correct: e.correct,
              wrong: e.total - e.correct,
              accuracy: round((e.correct / e.total) * 100, 2),
            });
          }
          touched.add(subjectId);
        }
        created = sessions.length;
        if (sessions.length) await tx.studySession.createMany({ data: sessions });
        if (questions.length) await tx.questionSession.createMany({ data: questions });
        if (touched.size) {
          // Marca o primeiro contato de cada assunto e reprocessa o histórico (revisões feitas e a próxima)
          const list = [...touched];
          await tx.studySession.updateMany({ where: { userId, subjectId: { in: list }, isFirstContact: true }, data: { isFirstContact: false } });
          await tx.$executeRaw`
            UPDATE study_sessions SET is_first_contact = true
            WHERE id IN (
              SELECT DISTINCT ON (subject_id) id FROM study_sessions
              WHERE user_id = ${userId} AND subject_id = ANY(${list})
              ORDER BY subject_id, studied_on ASC, created_at ASC
            )`;
          for (const subjectId of list) await rebuildSubject(tx, userId, subjectId);
        }
      }
      const results = await saveResults(tx, userId, mocks, exams, true);
      return { created, duplicates, subjects: touched.size, newSubjects, newAreas, ...results };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}
