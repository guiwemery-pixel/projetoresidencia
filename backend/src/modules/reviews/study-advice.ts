import type { StudyMethod } from '@prisma/client';

// Como estudar na próxima revisão, olhando como foram os últimos estudos do assunto:
// - só teoria, aula, leitura ou flashcards (sem questões) → fazer questões;
// - várias vezes só questões, sem voltar à teoria → rever a teoria e depois as questões;
// - desempenho baixo num estudo só de questões → teoria antes das questões;
// - equilibrado → segue o plano da etapa da revisão.
// Puro (sem banco), para testar sozinho. Calculado na hora em que a revisão é listada,
// então acompanha o que a pessoa registrou depois que a revisão foi agendada.

export interface PastSession {
  date: string;
  methods: StudyMethod[];
  /** Questões registradas nesse estudo (0 se não fez) */
  questions: number;
  /** Percentual de acerto das questões (null sem questões) */
  accuracy: number | null;
}

export type AdviceFocus = 'QUESTOES' | 'TEORIA' | 'EQUILIBRIO';

export interface StudyAdvice {
  focus: AdviceFocus;
  /** Métodos sugeridos (o primeiro é o principal) */
  methods: StudyMethod[];
  /** Frase curta: "Faça questões", "Reveja a teoria e depois faça questões"… */
  title: string;
  /** Por quê, em uma ou duas frases */
  reason: string;
  /** Como foram os últimos estudos (contagens dentro da janela) */
  mix: { sessions: number; theory: number; questions: number; recall: number; lastTheory: string | null; lastQuestions: string | null };
}

/** Quantos estudos recentes entram na conta. */
export const ADVICE_WINDOW = 4;
/** Sem teoria nos últimos N estudos, com questões em pelo menos 2 deles → rever a teoria. */
export const THEORY_GAP = 3;
/** Abaixo disso (% de acerto), num estudo sem teoria → teoria antes das questões. */
export const LOW_ACCURACY = 60;
/** Métodos que contam como teoria (para a consulta da última teoria no banco). */
export const THEORY_METHODS: StudyMethod[] = ['TEORIA', 'AULA', 'VIDEO', 'LEITURA', 'RESUMO', 'REVISAO'];

const PRACTICE: StudyMethod[] = ['QUESTOES', 'SIMULADO'];
const THEORY = THEORY_METHODS;
const RECALL: StudyMethod[] = ['FLASHCARDS', 'RECALL'];
const LABEL: Partial<Record<StudyMethod, string>> = {
  TEORIA: 'teoria',
  AULA: 'aula',
  VIDEO: 'vídeo',
  LEITURA: 'leitura',
  RESUMO: 'resumo',
  REVISAO: 'revisão do material',
  FLASHCARDS: 'flashcards',
  RECALL: 'recall ativo',
};
const PLAN_LABEL: Partial<Record<StudyMethod, string>> = { ...LABEL, QUESTOES: 'questões', SIMULADO: 'simulado' };

const isPractice = (s: PastSession) => s.questions > 0 || s.methods.some((m) => PRACTICE.includes(m));
const isTheory = (s: PastSession) => s.methods.some((m) => THEORY.includes(m));
const isRecall = (s: PastSession) => s.methods.some((m) => RECALL.includes(m));
const fmt = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const times = (n: number) => (n === 1 ? 'no último estudo' : `nos últimos ${n} estudos`);

function list(names: string[]) {
  const unique = [...new Set(names)];
  return unique.length > 1 ? `${unique.slice(0, -1).join(', ')} e ${unique[unique.length - 1]}` : (unique[0] ?? '');
}

/**
 * `history`: estudos do assunto, do mais recente para o mais antigo.
 * `planned`: métodos do plano da revisão (etapa); `lowScore`: a revisão já pede reforço (desempenho baixo).
 */
export function studyAdvice(
  history: PastSession[],
  planned: StudyMethod[],
  opts: { lowScore?: boolean; lastTheory?: string | null } = {},
): StudyAdvice | null {
  if (!history.length) return null;
  const lowScore = !!opts.lowScore;
  const recent = history.slice(0, ADVICE_WINDOW);
  const all = history;
  const mix = {
    sessions: recent.length,
    theory: recent.filter(isTheory).length,
    questions: recent.filter(isPractice).length,
    recall: recent.filter(isRecall).length,
    // Última teoria em todo o histórico (a janela pode não alcançar)
    lastTheory: opts.lastTheory ?? all.find(isTheory)?.date ?? null,
    lastQuestions: all.find(isPractice)?.date ?? null,
  };
  const withoutPractice = (m: StudyMethod[]) => m.filter((x) => !PRACTICE.includes(x));

  // 1. Nenhuma questão nos estudos recentes: hora de se testar
  if (mix.questions === 0) {
    const used = recent.flatMap((s) => s.methods.map((m) => LABEL[m]).filter((x): x is string => !!x));
    return {
      focus: 'QUESTOES',
      methods: ['QUESTOES', ...withoutPractice(planned).filter((m) => RECALL.includes(m))],
      title: 'Faça questões',
      reason:
        `${times(recent.length).replace(/^./, (c) => c.toUpperCase())} você usou ${used.length ? list(used) : 'outros métodos'}, sem questões. ` +
        'Nesta revisão, resolva questões: elas mostram o que ficou e o percentual de acertos ajusta as próximas revisões.',
      mix,
    };
  }

  // 2. Desempenho baixo (ou a revisão já é de reforço) sem teoria recente: teoria antes das questões
  const lastScored = recent.find((s) => s.accuracy !== null);
  const low = lowScore || (lastScored?.accuracy !== null && lastScored !== undefined && lastScored.accuracy! < LOW_ACCURACY);
  // O último estudo (o do desempenho baixo) foi sem teoria
  const noRecentTheory = !isTheory(recent[0]);
  if (low && noRecentTheory) {
    return {
      focus: 'TEORIA',
      methods: ['TEORIA', 'QUESTOES'],
      title: 'Reveja a teoria e depois faça questões',
      reason:
        `${lastScored ? `O último desempenho foi ${Math.round(lastScored.accuracy!)}%` : 'O último desempenho ficou baixo'} e você não voltou à teoria ` +
        `${mix.lastTheory ? `desde ${fmt(mix.lastTheory)}` : 'neste assunto'}. Releia o resumo ou assista à aula dos pontos em que errou e depois faça as questões.`,
      mix,
    };
  }

  // 3. Muitas questões e nenhuma teoria nos últimos estudos: rever a teoria
  const gap = recent.slice(0, THEORY_GAP);
  if (gap.length >= THEORY_GAP && !gap.some(isTheory) && gap.filter(isPractice).length >= 2) {
    return {
      focus: 'TEORIA',
      methods: ['TEORIA', 'QUESTOES'],
      title: 'Reveja a teoria e depois faça questões',
      reason:
        `Nos últimos ${gap.length} estudos foram ${gap.some(isRecall) ? 'questões e flashcards' : 'só questões'}, sem voltar à teoria` +
        `${mix.lastTheory ? ` (a última foi em ${fmt(mix.lastTheory)})` : ''}. Faça uma revisão rápida da teoria (resumo, mapa mental ou aula) antes das questões.`,
      mix,
    };
  }

  // 4. Equilibrado: segue o plano da etapa
  const methods: StudyMethod[] = planned.length ? planned : ['QUESTOES'];
  const plan = list(methods.map((m) => PLAN_LABEL[m]).filter((x): x is string => !!x));
  return {
    focus: 'EQUILIBRIO',
    methods,
    title: `Siga o plano: ${plan}`,
    reason:
      recent.length === 1
        ? `No último estudo você fez ${mix.theory ? 'teoria e questões' : 'questões'}. Siga o plano desta etapa.`
        : mix.theory > 0
          ? `Teoria e questões estão em equilíbrio (${mix.theory}× teoria e ${mix.questions}× questões ${times(recent.length)}). Siga o plano desta etapa.`
          : `Você vem fazendo questões (${mix.questions}× ${times(recent.length)}). Siga o plano desta etapa.`,
    mix,
  };
}
