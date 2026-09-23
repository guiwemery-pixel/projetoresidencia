/**
 * Dados de demonstração: grupo "Residência 2027" com 3 amigos e ~9 semanas de
 * histórico gerado pelos MESMOS serviços usados pela API (o algoritmo de
 * revisão é exercitado de verdade).
 *
 *   npm run db:seed        (senha de todos: estudos123)
 *
 * Remove e recria apenas as contas @demo.com. Não roda em produção.
 */
import { prisma } from '../src/lib/prisma.js';
import { addDays, todayIn, fromDb, toDb } from '../src/lib/dates.js';
import { register } from '../src/modules/auth/auth.service.js';
import { createGroup, joinGroupByCode } from '../src/modules/groups/groups.service.js';
import { createStudy } from '../src/modules/studies/studies.service.js';
import { createGoal } from '../src/modules/goals/goals.service.js';
import { createMockExam } from '../src/modules/mock-exams/mock-exams.service.js';
import { createAttempt, createExam } from '../src/modules/exams/exams.service.js';
import type { StudyMethod } from '@prisma/client';

if (process.env.NODE_ENV === 'production') {
  console.error('Seed de demonstração não roda em produção.');
  process.exit(1);
}

// PRNG determinístico (mesmos dados a cada execução)
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TOPICS: Record<string, string[]> = {
  'Cirurgia/Vias Biliares': ['Coledocolitíase', 'Colecistite aguda', 'Colangite aguda'],
  'Cirurgia/Cirurgia do Aparelho Digestivo': ['Pancreatite aguda', 'Apendicite aguda', 'Hérnias da parede abdominal'],
  'Cirurgia/Trauma': ['Trauma abdominal', 'Atendimento inicial ao politraumatizado'],
  'Clínica Médica/Cardiologia': ['Insuficiência cardíaca', 'Síndrome coronariana aguda', 'Fibrilação atrial'],
  'Clínica Médica/Pneumologia': ['Pneumonia adquirida na comunidade', 'DPOC', 'Asma'],
  'Clínica Médica/Endocrinologia': ['Diabetes mellitus tipo 2', 'Cetoacidose diabética', 'Hipotireoidismo'],
  'Clínica Médica/Infectologia': ['Tuberculose', 'HIV — terapia antirretroviral'],
  'Pediatria/Infectologia Pediátrica': ['Dengue', 'Doenças exantemáticas'],
  'Pediatria/Neonatologia': ['Icterícia neonatal', 'Reanimação neonatal'],
  'Pediatria/Puericultura': ['Aleitamento materno', 'Calendário vacinal'],
  'Ginecologia e Obstetrícia/Obstetrícia': ['Pré-eclâmpsia', 'Diabetes gestacional', 'Hemorragia pós-parto'],
  'Ginecologia e Obstetrícia/Ginecologia': ['Rastreamento do câncer do colo do útero', 'Sangramento uterino anormal'],
  'Medicina Preventiva/Epidemiologia': ['Medidas de associação', 'Testes diagnósticos', 'Vigilância em saúde'],
  'Medicina Preventiva/SUS e Políticas de Saúde': ['Princípios e diretrizes do SUS'],
};

interface Persona {
  name: string;
  email: string;
  skill: number; // acerto médio esperado
  regularity: number; // probabilidade de estudar em um dia
  reviewDiscipline: number; // probabilidade de fazer uma revisão vencida no dia
  seed: number;
}

const PERSONAS: Persona[] = [
  { name: 'Guilherme', email: 'guilherme@demo.com', skill: 0.8, regularity: 0.85, reviewDiscipline: 0.9, seed: 11 },
  { name: 'João', email: 'joao@demo.com', skill: 0.68, regularity: 0.55, reviewDiscipline: 0.55, seed: 22 },
  { name: 'Maria', email: 'maria@demo.com', skill: 0.76, regularity: 0.75, reviewDiscipline: 0.8, seed: 33 },
];

const DAYS = 63;

async function seedUser(p: Persona, today: string, inviteCode?: string) {
  const rnd = mulberry32(p.seed);
  const pick = <T>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
  const user = await register({ name: p.name, email: p.email, password: 'estudos123', template: 'medicina', inviteCode: inviteCode ?? null });

  const areas = await prisma.area.findMany({ where: { userId: user.id }, include: { parent: true } });
  const areaId = (path: string) => {
    const [top, sub] = path.split('/');
    return areas.find((a) => a.name === sub && a.parent?.name === top)!.id;
  };
  const queue = Object.entries(TOPICS).flatMap(([path, names]) => names.map((name) => ({ path, name })));
  queue.sort(() => rnd() - 0.5);
  const subjectIds = new Map<string, string>();
  // "Facilidade" individual de cada assunto para esta pessoa
  const affinity = new Map<string, number>();

  for (let offset = -DAYS; offset <= 0; offset++) {
    const date = addDays(today, offset);
    if (rnd() > p.regularity && offset !== 0) continue;

    // 1) Revisões vencidas
    const due = await prisma.review.findMany({
      where: { userId: user.id, status: 'PENDING', scheduledFor: { lte: toDb(date) } },
      include: { subject: true },
      orderBy: [{ scheduledFor: 'asc' }, { subject: { name: 'asc' } }],
      take: 6,
    });
    for (const r of due) {
      if (rnd() > p.reviewDiscipline) continue;
      if (offset === 0 && rnd() < 0.5) continue; // deixa algumas para "hoje"
      const elapsed = Math.max(1, Math.round((toDb(date).getTime() - toDb(fromDb(r.scheduledFor)).getTime()) / 86_400_000) + r.intervalDays);
      const decay = Math.min(0.2, elapsed / 400);
      const base = p.skill + (affinity.get(r.subjectId) ?? 0) - decay + (rnd() - 0.5) * 0.25;
      const total = pick([10, 15, 20, 20, 25]);
      const correct = Math.max(0, Math.min(total, Math.round(total * Math.min(0.98, base))));
      const acc = correct / total;
      const methods: StudyMethod[] = r.stage === 0 ? ['FLASHCARDS', 'QUESTOES'] : ['QUESTOES'];
      await createStudy(
        user.id,
        {
          subjectId: r.subjectId,
          date,
          durationMinutes: pick([25, 30, 40, 45, 60]),
          methods,
          quality: acc >= 0.9 ? 5 : acc >= 0.8 ? 4 : acc >= 0.65 ? 3 : acc >= 0.5 ? 2 : 1,
          difficulty: acc < 0.6 ? 3 : acc > 0.85 ? 1 : 2,
          questions: { total, correct, board: pick(['ENARE', 'USP', 'SUS-SP', 'UNIFESP', null]) },
        },
        today,
      );
    }

    // 2) Assunto novo (D0) em parte dos dias
    if (queue.length && rnd() < 0.55) {
      const t = queue.shift()!;
      const subject = await prisma.subject.create({
        data: { userId: user.id, areaId: areaId(t.path), name: t.name, size: pick(['SMALL', 'MEDIUM', 'MEDIUM', 'LARGE']) },
      });
      subjectIds.set(t.name, subject.id);
      affinity.set(subject.id, (rnd() - 0.5) * 0.25);
      const theoryOnly = rnd() < 0.3;
      const total = pick([15, 20, 20, 25]);
      const correct = Math.round(total * Math.min(0.97, p.skill + (affinity.get(subject.id) ?? 0) + (rnd() - 0.5) * 0.2));
      await createStudy(
        user.id,
        {
          subjectId: subject.id,
          date,
          durationMinutes: pick([60, 75, 90, 120]),
          methods: theoryOnly ? ['TEORIA', 'RESUMO'] : ['TEORIA', 'QUESTOES'],
          quality: theoryOnly ? pick([3, 4]) : null,
          questions: theoryOnly ? null : { total, correct },
        },
        today,
      );
    }
  }

  // Simulados (evolução)
  const mocks = [
    { name: 'Simulado ENAMED 1', offset: -56, base: -0.08 },
    { name: 'Simulado ENAMED 2', offset: -35, base: -0.04 },
    { name: 'Simulado ENAMED 3', offset: -14, base: 0 },
  ];
  for (const m of mocks) {
    const correct = Math.round(100 * Math.min(0.95, p.skill + m.base + (rnd() - 0.5) * 0.06));
    await createMockExam(user.id, { name: m.name, board: 'ENAMED', year: 2026, takenOn: addDays(today, m.offset), totalQuestions: 100, correct, durationMinutes: 300 }, today);
  }
  await createMockExam(user.id, { name: 'Simulado ENAMED 4', board: 'ENAMED', year: 2026, takenOn: addDays(today, 2), status: 'PLANNED', totalQuestions: 100 }, today);

  // Banco de provas
  const enamed = await prisma.board.findFirst({ where: { userId: user.id, name: 'ENAMED' } });
  if (enamed) {
    for (const year of [2024, 2025]) {
      const exam = await createExam(user.id, { boardId: enamed.id, name: `ENAMED ${year}`, year, totalQuestions: 100 });
      if (year === 2025 || p.name !== 'João') {
        const correct = Math.round(100 * Math.min(0.95, p.skill + (rnd() - 0.5) * 0.08));
        await createAttempt(user.id, exam.id, { takenOn: addDays(today, -20 - year + 2024), totalQuestions: 100, correct, durationMinutes: 280 }, today);
      }
    }
  }

  // Metas
  await createGoal(user.id, { title: 'Fazer 30 questões por dia', metric: 'QUESTIONS', period: 'DAILY', target: 30 }, today);
  await createGoal(user.id, { title: 'Fazer 250 questões esta semana', metric: 'QUESTIONS', period: 'WEEKLY', target: 250 }, today);
  await createGoal(user.id, { title: 'Estudar 20 horas este mês', metric: 'STUDY_MINUTES', period: 'MONTHLY', target: 20 * 60 }, today);
  await createGoal(user.id, { title: 'Fazer 3 simulados este mês', metric: 'MOCK_EXAMS', period: 'MONTHLY', target: 3 }, today);
  const cirurgia = areas.find((a) => a.name === 'Cirurgia' && !a.parentId);
  if (cirurgia) {
    await createGoal(
      user.id,
      { title: 'Revisar Cirurgia', metric: 'REVIEWS_DONE', period: 'CUSTOM', target: 12, areaId: cirurgia.id, startDate: addDays(today, -10), dueDate: addDays(today, 5) },
      today,
    );
  }
  return user;
}

async function main() {
  const today = todayIn('America/Sao_Paulo');
  await prisma.user.deleteMany({ where: { email: { endsWith: '@demo.com' } } });
  await prisma.group.deleteMany({ where: { name: 'Residência 2027', members: { none: {} } } });

  const first = await seedUser(PERSONAS[0], today);
  const group = await createGroup(first.id, { name: 'Residência 2027', description: 'Grupo de estudos para a residência médica' });
  for (const p of PERSONAS.slice(1)) {
    await seedUser(p, today, group.inviteCode);
  }
  // Garante que todos estejam no grupo (joinGroupByCode já foi chamado no cadastro)
  const members = await prisma.groupMember.count({ where: { groupId: group.id } });
  if (members < PERSONAS.length) {
    for (const p of PERSONAS.slice(1)) {
      const u = await prisma.user.findUniqueOrThrow({ where: { email: p.email } });
      await joinGroupByCode(u.id, group.inviteCode).catch(() => undefined);
    }
  }

  const counts = await Promise.all([prisma.studySession.count(), prisma.review.count(), prisma.questionSession.aggregate({ _sum: { total: true } })]);
  console.log(`✔ Demo criada: ${PERSONAS.length} usuários, ${counts[0]} sessões, ${counts[1]} revisões, ${counts[2]._sum.total} questões.`);
  console.log(`  Grupo "Residência 2027" — código de convite: ${group.inviteCode}`);
  console.log('  Logins: guilherme@demo.com, joao@demo.com, maria@demo.com — senha: estudos123');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
