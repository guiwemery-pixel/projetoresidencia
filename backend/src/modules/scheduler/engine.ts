import { DEFAULT_SCHEDULER_CONFIG, type BandRule, type SchedulerConfig } from './config.js';
import { addDays, diffDays } from './dates.js';
import type {
  BandKey,
  ContactEvidence,
  Explanation,
  ExplanationStep,
  HistoryPoint,
  LearningSnapshot,
  Method,
  Modifier,
  ScheduleInput,
  ScheduleResult,
  SubjectSize,
  Timing,
  Trend,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Motor de revisão espaçada "escada adaptativa" (adaptive-ladder-v2)
//
// 1. Mede o contato: % de acertos + autoavaliação → pontuação 0–100.
// 2. Classifica a pontuação numa faixa (excelente, bom, mediano, fraco, crítico).
//    A 1ª revisão sai direto do percentual de acertos (tabela firstReview).
// 3. A faixa move o assunto na escada D10 → D21 → D60 → D90+ (avança, mantém,
//    volta uma etapa ou reinicia no reforço D3).
// 4. Nas faixas de crescimento o intervalo-base da etapa é ajustado pela
//    facilidade individual do assunto, tendência e dificuldade percebida; nas
//    faixas de queda usa-se o intervalo-base da etapa anterior.
// 5. A quantidade de questões ajusta o resultado de forma gradual: 20 é a
//    referência; menos questões encurtam e mais questões alongam o intervalo.
// 6. Tudo é registrado numa explicação legível ("Por quê?").
// ─────────────────────────────────────────────────────────────────────────────

const pct = (n: number) => `${Math.round(n)}%`;
const fmt = (n: number, digits = 2) => n.toFixed(digits).replace('.', ',');
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function stageInterval(stage: number, config: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG): number {
  const { ladder, maintenanceGrowth, maxIntervalDays } = config;
  if (stage < ladder.length) return ladder[Math.max(0, stage)];
  const extra = stage - (ladder.length - 1);
  return Math.min(maxIntervalDays, Math.round(ladder[ladder.length - 1] * maintenanceGrowth ** extra));
}

export function stageLabel(stage: number, config: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG): string {
  if (stage < config.ladderLabels.length) return config.ladderLabels[Math.max(0, stage)];
  return `${config.ladderLabels[config.ladderLabels.length - 1]}+`;
}

export function stagePhase(stage: number, config: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG): string {
  return config.phases[Math.min(Math.max(0, stage), config.phases.length - 1)];
}

/** Rótulo de uma revisão: a verificação após estudo/leitura tem rótulo próprio (D1). */
export function reviewLabel(stage: number, checkup: boolean, config: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG): string {
  return checkup ? config.passiveFollowUp.label : stageLabel(stage, config);
}

export function isActiveRecall(methods: Method[], config: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG) {
  return methods.some((m) => config.activeMethods.includes(m));
}

export function accuracyOf(questions: ContactEvidence['questions']): number | null {
  if (!questions || questions.total <= 0) return null;
  return (questions.correct / questions.total) * 100;
}

/** Pontuação combinada 0–100 do contato (ou null se não houver nenhuma medida). */
export function computeScore(
  contact: Pick<ContactEvidence, 'questions' | 'quality'>,
  config: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG,
): { score: number | null; formula: string | null } {
  const accuracy = accuracyOf(contact.questions);
  const qualityScore = contact.quality ? config.score.qualityScores[String(contact.quality)] : null;
  if (accuracy !== null && qualityScore != null) {
    const { accuracyWeight, qualityWeight, minQuestionsForFullWeight } = config.score;
    const combined = (w: number) => (accuracy * w + qualityScore * qualityWeight) / (w + qualityWeight);
    const formula = (w: number, value: number) =>
      `(${fmt(accuracy, 0)} × ${fmt(w)} + ${qualityScore} × ${fmt(qualityWeight)}) ÷ ${fmt(w + qualityWeight)} = ${fmt(value, 1)}`;
    const w = accuracyWeight * Math.min(1, contact.questions!.total / minQuestionsForFullWeight);
    const reduced = combined(w);
    // Com poucas questões a autoavaliação pode puxar a pontuação para baixo, nunca para cima
    const full = combined(accuracyWeight);
    if (full < reduced) {
      return { score: full, formula: `${formula(accuracyWeight, full)} (com poucas questões a autoavaliação não aumenta a pontuação)` };
    }
    return { score: reduced, formula: formula(w, reduced) };
  }
  if (accuracy !== null) return { score: accuracy, formula: `acertos = ${fmt(accuracy, 1)}` };
  if (qualityScore != null) return { score: qualityScore, formula: `autoavaliação = ${qualityScore}` };
  return { score: null, formula: null };
}

function bandFor(score: number, config: SchedulerConfig): BandRule {
  const sorted = [...config.bands].sort((a, b) => b.min - a.min);
  return sorted.find((b) => score >= b.min) ?? sorted[sorted.length - 1];
}

function bandByKey(key: BandKey, config: SchedulerConfig): BandRule {
  return config.bands.find((b) => b.key === key)!;
}

/** Limita a faixa a um teto (ex.: sem recuperação ativa não há "excelente"). */
function capBand(band: BandRule, cap: BandKey, config: SchedulerConfig): BandRule {
  const capRule = bandByKey(cap, config);
  return band.min > capRule.min ? capRule : band;
}

/**
 * Contato só de estudo teórico (aula, vídeo, teoria, leitura…): sem questões
 * registradas e sem flashcards/recall. "Questões" marcado sem a quantidade, junto
 * com estudo teórico, também conta como teórico (não houve medida).
 */
export function isPassiveOnly(
  contact: Pick<ContactEvidence, 'methods' | 'questions'>,
  config: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG,
) {
  if (contact.questions && contact.questions.total > 0) return false;
  if (contact.methods.some((m) => config.recallMethods.includes(m))) return false;
  const questionTick = contact.methods.some((m) => config.activeMethods.includes(m));
  const study = contact.methods.some((m) => config.studyMethods.includes(m));
  return study || !questionTick;
}

/** Pontuação que conta como desempenho medido (leitura pura não conta). */
export function measuredScore(
  contact: Pick<ContactEvidence, 'methods' | 'questions' | 'quality'>,
  config: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG,
): number | null {
  return isPassiveOnly(contact, config) ? null : computeScore(contact, config).score;
}

/**
 * Fator da quantidade de questões (referência = ×1), interpolado entre os pontos
 * da configuração: ex.: 7 questões → ×0,74 · 15 → ×0,90 · 25 → ×1,05 · 34 → ×1,14.
 */
export function questionCountFactor(questions: number, config: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG): number {
  return interpolate(questions, config.questionCount.points.map((p) => ({ x: p.questions, factor: p.factor })));
}

/**
 * Fator do tempo de estudo quando não há questões (referência = ×1):
 * ex.: 5 min → ×0,80 · 15 → ×0,90 · 30 → ×1 · 45 → ×1,05 · 60 → ×1,10 · 90+ → ×1,15.
 */
export function studyTimeFactor(minutes: number, config: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG): number {
  return interpolate(minutes, config.studyTime.points.map((p) => ({ x: p.minutes, factor: p.factor })));
}

/** Interpolação linear entre pontos (fora deles vale o ponto da ponta), 2 casas. */
function interpolate(x: number, raw: { x: number; factor: number }[]): number {
  const points = [...raw].sort((a, b) => a.x - b.x);
  if (!points.length) return 1;
  if (x <= points[0].x) return points[0].factor;
  const last = points[points.length - 1];
  if (x >= last.x) return last.factor;
  const i = points.findIndex((p) => p.x >= x);
  const [a, b] = [points[i - 1], points[i]];
  return Math.round((a.factor + ((x - a.x) / (b.x - a.x)) * (b.factor - a.factor)) * 100) / 100;
}

/** "< 60% → 3 dias · 60–65% → 10 · …" (texto da tabela da 1ª revisão) */
export function firstReviewTableText(config: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG) {
  const tiers = [...config.firstReview.tiers].sort((a, b) => a.min - b.min);
  return tiers
    .map((t, i) => {
      const next = tiers[i + 1];
      const range = i === 0 ? `< ${next?.min ?? 100}%` : next ? `${t.min}–${next.min - 1}%` : `≥ ${t.min}%`;
      return `${range} → ${t.days} ${t.days === 1 ? 'dia' : 'dias'}`;
    })
    .join(' · ');
}

export function computeTrend(current: number | null, history: HistoryPoint[], config: SchedulerConfig): {
  trend: Trend;
  previousScore: number | null;
  reference: number | null;
} {
  const scored = history.filter((h) => h.score !== null) as { score: number }[];
  const previousScore = scored.length ? scored[scored.length - 1].score : null;
  if (current === null || scored.length === 0) return { trend: 'sem-historico', previousScore, reference: null };
  const window = scored.slice(-config.trend.window);
  const reference = window.reduce((s, h) => s + h.score, 0) / window.length;
  const diff = current - reference;
  const trend: Trend = diff >= config.trend.threshold ? 'melhora' : diff <= -config.trend.threshold ? 'queda' : 'estavel';
  return { trend, previousScore, reference };
}

export function suggestedQuestions(
  stage: number,
  size: SubjectSize,
  theory: boolean,
  config: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG,
): { min: number; max: number } {
  if (theory) {
    const [min, max] = config.newSubjectQuestions[size];
    return { min, max };
  }
  const table = config.reviewQuestionsByStage;
  const [min, max] = table[Math.min(stage, table.length - 1)];
  const k = config.sizeMultipliers[size] ?? 1;
  // Nunca sugere menos que a referência: seguir a sugestão não encurta o intervalo
  const lo = Math.max(config.questionCount.reference, Math.round(min * k));
  return { min: lo, max: Math.max(lo, Math.round(max * k)) };
}

export function suggestedMethods(stage: number, theory: boolean, config: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG) {
  if (theory) return config.theoryMethods;
  const table = config.suggestedMethodsByStage;
  return table[Math.min(stage, table.length - 1)];
}

/**
 * O que fazer na próxima revisão: rótulo, fase, métodos e faixa de questões.
 * `checkup` = verificação após contato só de estudo/leitura (mais questões);
 * `firstMeasure` = essa verificação ainda vai definir a 1ª revisão (quantidade de assunto novo).
 */
export function reviewPlan(
  stage: number,
  size: SubjectSize,
  opts: { theory?: boolean; checkup?: boolean; firstMeasure?: boolean },
  config: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG,
) {
  if (opts.checkup) {
    const f = config.passiveFollowUp;
    const base = suggestedQuestions(stage, size, false, config);
    const [nMin, nMax] = config.newSubjectQuestions[size];
    return {
      label: reviewLabel(stage, true, config),
      phase: f.phase,
      methods: f.methods,
      questions: opts.firstMeasure
        ? { min: nMin, max: nMax }
        : {
            min: Math.max(nMin, Math.round(base.min * f.questionsMultiplier)),
            max: Math.max(nMax, Math.round(base.max * f.questionsMultiplier)),
          },
    };
  }
  return {
    label: reviewLabel(stage, false, config),
    phase: stagePhase(stage, config),
    methods: suggestedMethods(stage, !!opts.theory, config),
    questions: suggestedQuestions(stage, size, !!opts.theory, config),
  };
}

const TREND_LABEL: Record<Trend, string> = {
  melhora: 'melhora',
  estavel: 'estável',
  queda: 'queda',
  'sem-historico': 'sem histórico',
};

/**
 * Calcula a próxima revisão de um assunto a partir do contato atual.
 * Função pura: mesmo input → mesmo output.
 */
export function scheduleNext(input: ScheduleInput, config: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG): ScheduleResult {
  const { state, contact, history } = input;
  const size = input.subjectSize ?? 'MEDIUM';
  const steps: ExplanationStep[] = [];
  const modifiers: Modifier[] = [];

  const accuracy = accuracyOf(contact.questions);
  const passiveOnly = isPassiveOnly(contact, config);
  // A revisão D1 pode ser feita com teoria/leitura: conta como revisão e nunca gera outra D1
  const pendingCheckup = !!input.pendingCheckup && !!state;
  const passiveAsReview = passiveOnly && pendingCheckup;
  // Fora da D1, só leitura/estudo não mede retenção: a autoavaliação é registrada, mas não pontua
  const { score, formula } = passiveOnly && !passiveAsReview ? { score: null, formula: null } : computeScore(contact, config);
  const { trend, previousScore, reference } = computeTrend(score, history, config);

  const qualityLabel = contact.quality ? config.score.qualityLabels[String(contact.quality)] : null;
  const questionCount = contact.questions?.total ?? 0;
  const minutes = contact.minutes ?? 0;
  // Quanto a pessoa praticou: quantidade de questões; sem questões, o tempo de estudo
  const amount =
    accuracy !== null
      ? { key: 'questoes', factor: questionCountFactor(questionCount, config) }
      : minutes > 0
        ? { key: 'tempo', factor: studyTimeFactor(minutes, config) }
        : null;
  // Ainda não há 1ª revisão definida (D0 ou verificação que vai defini-la)
  const noMeasureYet = !state || state.lastScore === null;
  const elapsedDays = state ? diffDays(state.lastContactOn, contact.date) : null;
  const scheduledFor = input.scheduledFor ?? null;
  let timing: Timing | null = null;
  if (state && scheduledFor) {
    const delta = diffDays(scheduledFor, contact.date);
    timing = delta > 0 ? 'atrasada' : delta < 0 ? 'antecipada' : 'no-prazo';
  }

  // ── 1. Medida do contato ───────────────────────────────────────────────
  if (contact.questions && accuracy !== null) {
    steps.push({
      label: 'Desempenho em questões',
      detail: `${contact.questions.correct}/${contact.questions.total} = ${pct(accuracy)}`,
    });
  }
  if (qualityLabel) {
    steps.push({
      label: 'Autoavaliação',
      detail: passiveOnly && !passiveAsReview
        ? `${qualityLabel} (registrada, mas sem questões ela não define o intervalo)`
        : `${qualityLabel} (${config.score.qualityScores[String(contact.quality)]} pontos)`,
    });
  }
  if (formula && accuracy !== null && contact.quality) {
    steps.push({ label: 'Pontuação combinada', detail: formula });
  }

  // Primeiro contato que define a 1ª revisão (D0 ativo, ou a revisão D1 após um D0 só de leitura)
  const firstMeasure = (!passiveOnly || passiveAsReview) && noMeasureYet;
  const hasPercentual = accuracy !== null && questionCount >= config.firstReview.minQuestions;

  // ── 2. Faixa de desempenho ─────────────────────────────────────────────
  let band: BandRule | null = score === null ? null : bandFor(score, config);
  if (band && !contact.quality && contact.questions && contact.questions.total < config.score.minQuestionsForExcellent) {
    const capped = capBand(band, 'bom', config);
    if (capped !== band) {
      steps.push({
        label: 'Poucas questões',
        detail: `Com menos de ${config.score.minQuestionsForExcellent} questões a faixa máxima é "${capped.label}".`,
      });
      band = capped;
    }
  }
  // Na 1ª revisão a data vem da tabela, não da regra da faixa
  if (band && !firstMeasure) steps.push({ label: `Faixa: ${band.label}`, detail: band.rule });
  else if (!band && !firstMeasure && (!passiveOnly || passiveAsReview))
    steps.push({ label: 'Sem medida de desempenho', detail: 'Nenhuma questão nem autoavaliação registrada neste contato.' });

  // ── 3. Movimento na escada ─────────────────────────────────────────────
  const easeFrom = state?.ease ?? config.ease.initial;
  let ease = easeFrom;
  let stage: number;
  let baseInterval: number;
  let growth: boolean;
  let isLapse = false;
  let suggestTheory = false;
  let quantityApplies = false;
  let theoryApplies = false;
  let measured: number | null = score; // pontuação que fica registrada como "último desempenho"
  // Só leitura (fora da própria D1) → revisão D1 amanhã
  const checkup = passiveOnly && !passiveAsReview;

  if (checkup) {
    stage = state ? state.stage : 0;
    growth = false;
    baseInterval = config.passiveFollowUp.intervalDays;
    const plan = reviewPlan(stage, size, { checkup: true, firstMeasure: noMeasureYet }, config);
    steps.push({
      label: state ? 'Revisão só de estudo/leitura' : 'Primeiro contato só com estudo/leitura',
      detail:
        (contact.methods.some((m) => config.activeMethods.includes(m))
          ? '"Questões" foi marcado sem a quantidade, então conta como estudo teórico. '
          : '') +
        `Estudo sem questões não mede quanto você lembra. Amanhã faça a revisão D1 como preferir — ${plan.questions.min}–${plan.questions.max} questões, ` +
        'flashcards, recall ou teoria — e marque como foi' +
        (noMeasureYet
          ? ': a data da 1ª revisão sai do seu desempenho nela.'
          : `; a etapa ${stageLabel(stage, config)} é mantida até essa revisão.`),
    });
  } else if (firstMeasure && !hasPercentual) {
    // 1ª revisão sem questões suficientes: autoavaliação (mesma tabela) + tempo + dificuldade
    const tiers = [...config.firstReview.tiers].sort((a, b) => b.min - a.min);
    const hasRating = contact.quality != null;
    const perf = score === null ? config.firstReview.assumedScore : hasRating ? score : Math.min(score, config.firstReview.fewQuestionsMaxScore);
    const tier = tiers.find((t) => perf >= t.min) ?? tiers[tiers.length - 1];
    const perfBand = bandFor(perf, config);
    stage = passiveAsReview ? Math.min(tier.stage, config.theoryReview.maxStage) : tier.stage;
    growth = false;
    baseInterval = tier.days;
    measured = score === null ? perf : Math.min(score, perf);
    suggestTheory = score !== null && (perfBand.suggestTheory ?? false);
    if (score !== null) ease = clamp(easeFrom + perfBand.easeDelta, config.ease.min, config.ease.max);
    const days = `${tier.days} ${tier.days === 1 ? 'dia' : 'dias'}`;
    steps.push({
      label: hasRating ? '1ª revisão pela autoavaliação' : score === null ? '1ª revisão sem medida' : '1ª revisão com poucas questões',
      detail:
        (hasRating
          ? `Sem ${config.firstReview.minQuestions} questões ou mais, vale sua autoavaliação: ${qualityLabel} (${fmt(perf, 0)} pontos) → ${days}`
          : score === null
            ? `Sem questões nem autoavaliação, consideramos desempenho médio (${perf} pontos) → ${days}`
            : `Com menos de ${config.firstReview.minQuestions} questões e sem autoavaliação, a pontuação vai no máximo até ${perf} → ${days}`) +
        ` (mesma tabela do percentual: ${firstReviewTableText(config)}).`,
    });
    // Tempo e dificuldade ajustam a data (exceto na faixa mais baixa, que já volta logo)
    quantityApplies = tier !== tiers[tiers.length - 1];
    theoryApplies = passiveAsReview && quantityApplies;
    if (quantityApplies && contact.difficulty) {
      const f = config.difficultyFactors[String(contact.difficulty)] ?? 1;
      const name = ['', 'fácil', 'média', 'difícil'][contact.difficulty];
      if (f !== 1) modifiers.push({ key: 'dificuldade', label: `Dificuldade percebida ${name}`, factor: f });
    }
  } else if (firstMeasure) {
    // 1ª revisão: data definida pela tabela de percentual de acertos
    const tiers = [...config.firstReview.tiers].sort((a, b) => b.min - a.min);
    const tier = tiers.find((t) => accuracy! >= t.min) ?? tiers[tiers.length - 1];
    stage = tier.stage;
    growth = false;
    baseInterval = tier.days;
    suggestTheory = band?.suggestTheory ?? false;
    ease = clamp(easeFrom + (band?.easeDelta ?? 0), config.ease.min, config.ease.max);
    steps.push({
      label: '1ª revisão pelo percentual de acertos',
      detail: `${pct(accuracy!)} de acertos → ${tier.days} ${tier.days === 1 ? 'dia' : 'dias'} (${firstReviewTableText(config)}).`,
    });
    // A quantidade de questões ajusta a data (exceto na faixa mais baixa, que já volta logo)
    quantityApplies = tier !== tiers[tiers.length - 1];
  } else if (!band) {
    // Contato ativo sem medida (ex.: flashcards sem autoavaliação): mantém a etapa
    // (aqui sempre há estado: o primeiro contato é tratado acima)
    stage = state!.stage;
    growth = false;
    baseInterval = stageInterval(stage, config);
    steps.push({
      label: 'Etapa mantida',
      detail: `Sem desempenho medido, a etapa ${stageLabel(stage, config)} é mantida.`,
    });
  } else {
    const from = state!.stage;
    // Revisão só teórica não avança a etapa (pode manter, voltar ou reiniciar)
    const delta = passiveAsReview ? Math.min(0, band.stageDelta) : band.stageDelta;
    stage = band.resetToStage ?? Math.max(0, from + delta);
    theoryApplies = passiveAsReview && band.growth;
    growth = band.growth;
    suggestTheory = band.suggestTheory ?? false;
    isLapse = !band.growth;
    ease = clamp(easeFrom + band.easeDelta, config.ease.min, config.ease.max);
    baseInterval = stageInterval(stage, config);
    quantityApplies = band.growth;
    const moved =
      stage > from ? 'avança' : stage === from ? 'mantém' : band.resetToStage !== undefined ? 'reinicia' : 'volta';
    steps.push({
      label: `Etapa ${moved}`,
      detail: `${stageLabel(from, config)} → ${stageLabel(stage, config)} (intervalo-base ${baseInterval} ${baseInterval === 1 ? 'dia' : 'dias'})`,
    });
    if (band.factor !== 1) modifiers.push({ key: 'faixa', label: `Faixa ${band.label}`, factor: band.factor });
  }

  // ── 4. Modificadores (somente nas faixas de crescimento) ───────────────
  if (growth) {
    if (Math.abs(ease - 1) > 1e-9) {
      modifiers.push({ key: 'facilidade', label: 'Facilidade individual do assunto', factor: ease });
    }
    if (trend === 'melhora') modifiers.push({ key: 'tendencia', label: 'Tendência de melhora', factor: config.trend.improvingFactor });
    if (trend === 'queda') modifiers.push({ key: 'tendencia', label: 'Tendência de queda', factor: config.trend.decliningFactor });
    if (contact.difficulty) {
      const f = config.difficultyFactors[String(contact.difficulty)] ?? 1;
      const name = ['', 'fácil', 'média', 'difícil'][contact.difficulty];
      if (f !== 1) modifiers.push({ key: 'dificuldade', label: `Dificuldade percebida ${name}`, factor: f });
    }
  } else if (state && band && !band.growth && !firstMeasure) {
    steps.push({
      label: 'Sem bônus',
      detail: 'Com desempenho abaixo de 70% o intervalo-base da etapa é aplicado sem aumentos nem ajuste pela quantidade de questões.',
    });
  }

  const product = modifiers.reduce((acc, m) => acc * m.factor, 1);
  const boundedProduct = clamp(product, config.modifierBounds.min, config.modifierBounds.max);
  if (boundedProduct !== product) {
    steps.push({
      label: 'Limite de ajuste',
      detail: `O efeito combinado dos modificadores (${fmt(product)}) foi limitado a ${fmt(boundedProduct)}.`,
    });
  }
  let raw = baseInterval * boundedProduct;

  // ── 5. Crédito pelo intervalo real (revisão feita atrasada com bom resultado) ──
  if (state && band && growth && config.lateCredit.enabled && elapsedDays !== null) {
    const g = config.lateCredit.minGrowth[band.key];
    if (g && elapsedDays * g > raw) {
      steps.push({
        label: 'Crédito pelo intervalo real',
        detail: `Você reteve o conteúdo por ${elapsedDays} dias; o novo intervalo não fica abaixo de ${elapsedDays} × ${fmt(g, 1)}.`,
      });
      raw = elapsedDays * g;
    }
  }

  const computed = Math.round(clamp(raw, config.minIntervalDays, config.maxIntervalDays));
  // Com bom desempenho, parte de no mínimo o intervalo-base da etapa…
  const floor = growth && config.growthFloorAtBase ? Math.min(stageInterval(stage, config), config.maxIntervalDays) : 0;
  const beforeQuantity = Math.max(computed, floor);
  // …e a quantidade de questões (ou, sem questões, o tempo de estudo) ajusta a partir daí
  const applyAmount = quantityApplies && amount !== null && amount.factor !== 1;
  const bound = (n: number) => Math.round(clamp(n, config.minIntervalDays, config.maxIntervalDays));
  const afterAmount = applyAmount ? bound(beforeQuantity * amount!.factor) : beforeQuantity;
  // Revisão só teórica: a autoavaliação vale menos que questões
  const intervalDays = theoryApplies ? bound(afterAmount * config.theoryReview.factor) : afterAmount;
  const dueOn = addDays(contact.date, intervalDays);
  const lapses = (state?.lapses ?? 0) + (isLapse ? 1 : 0);
  const reviewsDone = state ? state.contacts : 0;

  if (modifiers.length) {
    steps.push({
      label: 'Cálculo',
      detail: `${baseInterval} × ${modifiers.map((m) => fmt(m.factor)).join(' × ')} ≈ ${computed} ${computed === 1 ? 'dia' : 'dias'}`,
    });
  }
  if (beforeQuantity > computed) {
    steps.push({
      label: 'Mínimo da etapa',
      detail: `Com desempenho a partir de 70%, a etapa ${stageLabel(stage, config)} parte de no mínimo ${floor} dias.`,
    });
  }
  const days = (n: number) => `${n} ${n === 1 ? 'dia' : 'dias'}`;
  if (applyAmount && amount!.key === 'questoes') {
    const n = `${questionCount} ${questionCount === 1 ? 'questão' : 'questões'}`;
    steps.push({
      label: 'Quantidade de questões',
      detail:
        `${n} (referência: ${config.questionCount.reference}) → ×${fmt(amount!.factor)}: ${beforeQuantity} → ${days(afterAmount)}. ` +
        (amount!.factor < 1
          ? 'Com menos questões o resultado é menos seguro, então a próxima revisão fica um pouco mais próxima.'
          : 'Mais questões dão mais segurança ao resultado, então a próxima revisão pode ficar um pouco mais longe.'),
    });
  } else if (applyAmount) {
    steps.push({
      label: 'Tempo de estudo',
      detail:
        `${minutes} min sem questões (referência: ${config.studyTime.reference} min) → ×${fmt(amount!.factor)}: ${beforeQuantity} → ${days(afterAmount)}. ` +
        (amount!.factor < 1 ? 'Uma revisão curta fixa menos, então a próxima fica um pouco mais próxima.' : 'Uma revisão mais longa fixa mais, então a próxima pode ficar um pouco mais longe.'),
    });
  }
  if (theoryApplies) {
    steps.push({
      label: 'Revisão só teórica',
      detail:
        `Aula, vídeo, teoria e leitura medem menos o quanto você lembra do que questões: ×${fmt(config.theoryReview.factor)}` +
        ` e a etapa não avança (${afterAmount} → ${days(intervalDays)}). Na próxima revisão, faça questões.`,
    });
  }
  if (Math.abs(ease - easeFrom) > 1e-9) {
    steps.push({
      label: 'Facilidade do assunto',
      detail: `${fmt(easeFrom)} → ${fmt(ease)} (${ease > easeFrom ? 'o assunto está se mostrando mais fácil para você' : 'o assunto exige revisões mais próximas'})`,
    });
  }
  if (suggestTheory) {
    steps.push({ label: 'Retorno à teoria', detail: 'Recomendado revisar o conteúdo teórico antes de novas questões.' });
  }
  if (trend !== 'sem-historico' && reference !== null) {
    steps.push({
      label: `Tendência: ${TREND_LABEL[trend]}`,
      detail: `Atual ${pct(score!)} vs. média recente ${pct(reference)}`,
    });
  }

  const nextState: LearningSnapshot = {
    stage,
    ease: Math.round(ease * 1000) / 1000,
    intervalDays,
    lastContactOn: contact.date,
    lastScore: measured === null ? (state?.lastScore ?? null) : Math.round(measured * 10) / 10,
    contacts: (state?.contacts ?? 0) + 1,
    lapses,
  };

  const plan = reviewPlan(stage, size, { theory: suggestTheory, checkup, firstMeasure: checkup && noMeasureYet }, config);
  const shownModifiers = [...modifiers];
  if (applyAmount && amount!.key === 'questoes')
    shownModifiers.push({ key: 'questoes', label: `Quantidade de questões (${questionCount}; referência ${config.questionCount.reference})`, factor: amount!.factor });
  else if (applyAmount)
    shownModifiers.push({ key: 'tempo', label: `Tempo de estudo (${minutes} min; referência ${config.studyTime.reference})`, factor: amount!.factor });
  if (theoryApplies) shownModifiers.push({ key: 'teoria', label: 'Revisão só teórica', factor: config.theoryReview.factor });
  const label = plan.label;
  const explanation: Explanation = {
    algorithm: config.version,
    summary: `Próxima revisão em ${intervalDays} ${intervalDays === 1 ? 'dia' : 'dias'} (${label} — ${plan.phase.toLowerCase()})`,
    inputs: {
      accuracy: accuracy === null ? null : Math.round(accuracy * 10) / 10,
      questions: contact.questions,
      quality: contact.quality,
      qualityLabel,
      difficulty: contact.difficulty,
      methods: contact.methods,
      activeRecall: !passiveOnly,
      previousScore,
      trend,
      lastContactOn: state?.lastContactOn ?? null,
      elapsedDays,
      previousIntervalDays: state?.intervalDays ?? null,
      scheduledFor,
      timing,
      reviewsDone,
      lapses,
      expectedQuestions: config.questionCount.reference,
    },
    checkup,
    score: score === null ? null : Math.round(score * 10) / 10,
    band: band ? { key: band.key, label: band.label, rule: band.rule } : null,
    stage: {
      from: state ? state.stage : null,
      to: stage,
      fromLabel: state ? reviewLabel(state.stage, pendingCheckup, config) : 'D0',
      toLabel: label,
    },
    baseIntervalDays: baseInterval,
    modifiers: shownModifiers.map((m) => ({ ...m, factor: Math.round(m.factor * 1000) / 1000 })),
    newIntervalDays: intervalDays,
    dueOn,
    ease: { from: easeFrom, to: nextState.ease },
    steps,
  };

  return {
    nextState,
    intervalDays,
    dueOn,
    stageLabel: label,
    phase: plan.phase,
    band: band?.key ?? null,
    score: explanation.score,
    accuracy: explanation.inputs.accuracy,
    isLapse,
    checkup,
    suggestTheory,
    suggestedMethods: plan.methods,
    suggestedQuestions: plan.questions,
    explanation,
  };
}
