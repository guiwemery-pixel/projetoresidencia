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
  const active = isActiveRecall(contact.methods, config);
  const { score, formula } = computeScore(contact, config);
  const { trend, previousScore, reference } = computeTrend(score, history, config);

  const qualityLabel = contact.quality ? config.score.qualityLabels[String(contact.quality)] : null;
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
      detail: `${qualityLabel} (${config.score.qualityScores[String(contact.quality)]} pontos)`,
    });
  }
  if (formula && accuracy !== null && contact.quality) {
    steps.push({ label: 'Pontuação combinada', detail: formula });
  }

  // ── 2. Faixa de desempenho ─────────────────────────────────────────────
  let band: BandRule | null = score === null ? null : bandFor(score, config);
  if (band && !active) {
    const capped = capBand(band, config.passive.maxBand, config);
    if (capped !== band) {
      steps.push({
        label: 'Sem recuperação ativa',
        detail: `Apenas métodos passivos: a faixa máxima considerada é "${capped.label}".`,
      });
      band = capped;
    }
  }
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
  if (band) steps.push({ label: `Faixa: ${band.label}`, detail: band.rule });
  else steps.push({ label: 'Sem medida de desempenho', detail: 'Nenhuma questão nem autoavaliação registrada neste contato.' });

  // ── 3. Movimento na escada ─────────────────────────────────────────────
  const easeFrom = state?.ease ?? config.ease.initial;
  let ease = easeFrom;
  let stage: number;
  let baseInterval: number;
  let growth: boolean;
  let isLapse = false;
  let suggestTheory = false;

  if (!state) {
    // Primeiro contato (D0 — aprender)
    const canSkip =
      band !== null &&
      band.min >= config.firstContact.skipFirstReviewMinScore &&
      active &&
      (contact.questions?.total ?? 0) >= config.firstContact.minQuestionsToSkip;
    stage = canSkip ? 1 : 0;
    growth = canSkip;
    suggestTheory = band?.suggestTheory ?? false;
    ease = clamp(easeFrom + (band?.easeDelta ?? 0), config.ease.min, config.ease.max);
    baseInterval = stageInterval(stage, config);
    steps.push({
      label: 'Primeiro contato (D0)',
      detail: canSkip
        ? `Desempenho ≥ ${config.firstContact.skipFirstReviewMinScore}% com questões já no D0: pula o D1 e agenda o ${stageLabel(stage, config)}.`
        : `Agenda o ${stageLabel(0, config)} para evitar o esquecimento precoce.`,
    });
    if (canSkip && band!.factor !== 1) {
      modifiers.push({ key: 'faixa', label: `Faixa ${band!.label}`, factor: band!.factor });
    }
  } else if (!band) {
    // Contato sem medida (ex.: só leitura): mantém a etapa
    stage = state.stage;
    growth = false;
    baseInterval = stageInterval(stage, config);
    steps.push({
      label: 'Etapa mantida',
      detail: `Sem desempenho medido, a etapa ${stageLabel(stage, config)} é mantida.`,
    });
  } else {
    const from = state.stage;
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
    if (!active) modifiers.push({ key: 'passivo', label: 'Somente métodos passivos', factor: config.passive.factor });
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

  const label = stageLabel(stage, config);
  const explanation: Explanation = {
    algorithm: config.version,
    summary: `Próxima revisão em ${intervalDays} ${intervalDays === 1 ? 'dia' : 'dias'} (${label} — ${stagePhase(stage, config).toLowerCase()})`,
    inputs: {
      accuracy: accuracy === null ? null : Math.round(accuracy * 10) / 10,
      questions: contact.questions,
      quality: contact.quality,
      qualityLabel,
      difficulty: contact.difficulty,
      methods: contact.methods,
      activeRecall: active,
      previousScore,
      trend,
      lastContactOn: state?.lastContactOn ?? null,
      elapsedDays,
      previousIntervalDays: state?.intervalDays ?? null,
      scheduledFor,
      timing,
      reviewsDone,
      lapses,
    },
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
    phase: stagePhase(stage, config),
    band: band?.key ?? null,
    score: explanation.score,
    accuracy: explanation.inputs.accuracy,
    isLapse,
    suggestTheory,
    suggestedMethods: suggestedMethods(stage, suggestTheory, config),
    suggestedQuestions: suggestedQuestions(stage, size, suggestTheory, config),
    explanation,
  };
}
