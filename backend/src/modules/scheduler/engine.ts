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
// Motor de revisão espaçada "escada adaptativa" (adaptive-ladder-v1)
//
// 1. Mede o contato: % de acertos + autoavaliação → pontuação 0–100.
// 2. Classifica a pontuação numa faixa (excelente, bom, mediano, fraco, crítico).
// 3. A faixa move o assunto na escada D1 → D7 → D21 → D60 → D90+ (avança,
//    mantém, volta uma etapa ou reinicia).
// 4. Nas faixas de crescimento o intervalo-base da etapa é ajustado pela
//    facilidade individual do assunto, tendência, dificuldade percebida e tipo
//    de método; nas faixas de queda usa-se o intervalo-base da etapa anterior.
// 5. Tudo é registrado numa explicação legível ("Por quê?").
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
    const w = accuracyWeight * Math.min(1, contact.questions!.total / minQuestionsForFullWeight);
    const score = (accuracy * w + qualityScore * qualityWeight) / (w + qualityWeight);
    return {
      score,
      formula: `(${fmt(accuracy, 0)} × ${fmt(w)} + ${qualityScore} × ${fmt(qualityWeight)}) ÷ ${fmt(w + qualityWeight)} = ${fmt(score, 1)}`,
    };
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

/** Contato só de estudo/leitura: nenhum método de recuperação ativa e nenhuma questão. */
export function isPassiveOnly(
  contact: Pick<ContactEvidence, 'methods' | 'questions'>,
  config: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG,
) {
  return !isActiveRecall(contact.methods, config) && !(contact.questions && contact.questions.total > 0);
}

/** Pontuação que conta como desempenho medido (leitura pura não conta). */
export function measuredScore(
  contact: Pick<ContactEvidence, 'methods' | 'questions' | 'quality'>,
  config: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG,
): number | null {
  return isPassiveOnly(contact, config) ? null : computeScore(contact, config).score;
}

const mid = (r: { min: number; max: number }) => Math.round((r.min + r.max) / 2);

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
  return { min: Math.max(1, Math.round(min * k)), max: Math.max(1, Math.round(max * k)) };
}

export function suggestedMethods(stage: number, theory: boolean, config: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG) {
  if (theory) return config.theoryMethods;
  const table = config.suggestedMethodsByStage;
  return table[Math.min(stage, table.length - 1)];
}

/**
 * O que fazer na próxima revisão: rótulo, fase, métodos e faixa de questões.
 * `checkup` = verificação após contato só de estudo/leitura (mais questões).
 */
export function reviewPlan(
  stage: number,
  size: SubjectSize,
  opts: { theory?: boolean; checkup?: boolean },
  config: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG,
) {
  if (opts.checkup) {
    const f = config.passiveFollowUp;
    const base = suggestedQuestions(stage, size, false, config);
    const [nMin, nMax] = config.newSubjectQuestions[size];
    return {
      label: f.label,
      phase: f.phase,
      methods: f.methods,
      questions: {
        min: Math.max(nMin, Math.round(base.min * f.questionsMultiplier)),
        max: Math.max(nMax, Math.round(base.max * f.questionsMultiplier)),
      },
    };
  }
  return {
    label: stageLabel(stage, config),
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
  // Só leitura/estudo não mede retenção: a autoavaliação é registrada, mas não pontua
  const { score, formula } = passiveOnly ? { score: null, formula: null } : computeScore(contact, config);
  const { trend, previousScore, reference } = computeTrend(score, history, config);

  const qualityLabel = contact.quality ? config.score.qualityLabels[String(contact.quality)] : null;
  const expectedQuestions =
    input.expectedQuestions ??
    (state ? mid(suggestedQuestions(state.stage, size, false, config)) : mid(suggestedQuestions(0, size, true, config)));
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
      detail: passiveOnly
        ? `${qualityLabel} (registrada, mas sem questões ela não define o intervalo)`
        : `${qualityLabel} (${config.score.qualityScores[String(contact.quality)]} pontos)`,
    });
  }
  if (formula && accuracy !== null && contact.quality) {
    steps.push({ label: 'Pontuação combinada', detail: formula });
  }

  // Primeiro contato com desempenho medido (D0, ou a verificação após um D0 só de leitura)
  const firstMeasure = !passiveOnly && (!state || state.lastScore === null);
  const questionCount = contact.questions?.total ?? 0;
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
  // Na 1ª revisão a data vem da tabela de percentual, não da regra da faixa
  if (band && !(firstMeasure && hasPercentual)) steps.push({ label: `Faixa: ${band.label}`, detail: band.rule });
  else if (!passiveOnly) steps.push({ label: 'Sem medida de desempenho', detail: 'Nenhuma questão nem autoavaliação registrada neste contato.' });

  // ── 3. Movimento na escada ─────────────────────────────────────────────
  const easeFrom = state?.ease ?? config.ease.initial;
  let ease = easeFrom;
  let stage: number;
  let baseInterval: number;
  let growth: boolean;
  let isLapse = false;
  let suggestTheory = false;
  // Sem percentual confiável no 1º contato, ou só leitura → verificação com questões amanhã
  const checkup = passiveOnly || (firstMeasure && !hasPercentual);

  if (checkup) {
    stage = state ? state.stage : 0;
    growth = false;
    baseInterval = config.passiveFollowUp.intervalDays;
    const plan = reviewPlan(stage, size, { checkup: true }, config);
    const next = `${plan.questions.min}–${plan.questions.max} questões`;
    if (passiveOnly) {
      steps.push({
        label: state ? 'Revisão só de estudo/leitura' : 'Primeiro contato só com estudo/leitura',
        detail:
          `Estudo sem questões não mede quanto você lembra. A próxima revisão fica para o dia seguinte, com ${next}` +
          (firstMeasure
            ? '; o percentual dessas questões define a data da 1ª revisão.'
            : `; a etapa ${stageLabel(stage, config)} é mantida até o resultado das questões.`),
      });
    } else {
      steps.push({
        label: questionCount ? 'Poucas questões para medir' : 'Sem percentual de acertos',
        detail:
          (questionCount
            ? `Com ${questionCount} ${questionCount === 1 ? 'questão' : 'questões'} o percentual ainda não é confiável. `
            : 'A 1ª revisão é definida pelo percentual em questões. ') +
          `Amanhã faça ${next} para definir a data da 1ª revisão.`,
      });
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
    // Mais questões que o sugerido para um assunto novo → intervalo maior (exceto na faixa mais baixa)
    const lowest = tiers[tiers.length - 1];
    const expected = input.expectedQuestions ?? mid(suggestedQuestions(0, size, true, config));
    if (tier !== lowest && expected > 0) {
      const ratio = questionCount / expected;
      const vt = [...config.volume.tiers].sort((a, b) => b.ratio - a.ratio).find((t) => ratio >= t.ratio);
      if (vt) {
        modifiers.push({ key: 'volume', label: `Volume de questões (${questionCount} de ~${expected} sugeridas)`, factor: vt.factor });
      }
    }
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
    stage = band.resetToStage ?? Math.max(0, from + band.stageDelta);
    growth = band.growth;
    suggestTheory = band.suggestTheory ?? false;
    isLapse = !band.growth;
    ease = clamp(easeFrom + band.easeDelta, config.ease.min, config.ease.max);
    baseInterval = stageInterval(stage, config);
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
    if (contact.questions && contact.questions.total > 0 && expectedQuestions > 0) {
      const ratio = contact.questions.total / expectedQuestions;
      const tier = [...config.volume.tiers].sort((a, b) => b.ratio - a.ratio).find((t) => ratio >= t.ratio);
      if (tier) {
        modifiers.push({
          key: 'volume',
          label: `Volume de questões (${contact.questions.total} de ~${expectedQuestions} sugeridas)`,
          factor: tier.factor,
        });
      }
    }
  } else if (state && band) {
    steps.push({
      label: 'Sem bônus',
      detail: 'Com desempenho abaixo de 70% o intervalo-base da etapa é aplicado sem aumentos.',
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

  const intervalDays = Math.round(clamp(raw, config.minIntervalDays, config.maxIntervalDays));
  const dueOn = addDays(contact.date, intervalDays);
  const lapses = (state?.lapses ?? 0) + (isLapse ? 1 : 0);
  const reviewsDone = state ? state.contacts : 0;

  if (modifiers.length) {
    steps.push({
      label: 'Cálculo',
      detail: `${baseInterval} × ${modifiers.map((m) => fmt(m.factor)).join(' × ')} ≈ ${intervalDays} ${intervalDays === 1 ? 'dia' : 'dias'}`,
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
    lastScore: score === null ? (state?.lastScore ?? null) : Math.round(score * 10) / 10,
    contacts: (state?.contacts ?? 0) + 1,
    lapses,
  };

  const plan = reviewPlan(stage, size, { theory: suggestTheory, checkup }, config);
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
      expectedQuestions,
    },
    checkup,
    score: score === null ? null : Math.round(score * 10) / 10,
    band: band ? { key: band.key, label: band.label, rule: band.rule } : null,
    stage: {
      from: state ? state.stage : null,
      to: stage,
      fromLabel: state ? stageLabel(state.stage, config) : 'D0',
      toLabel: label,
    },
    baseIntervalDays: baseInterval,
    modifiers: modifiers.map((m) => ({ ...m, factor: Math.round(m.factor * 1000) / 1000 })),
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
