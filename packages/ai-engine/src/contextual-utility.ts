/* eslint-disable sonarjs/cognitive-complexity, sonarjs/no-nested-conditional, complexity, max-lines-per-function */
import { canonicalDecisionKey, type CombatantId } from "@dragonball-resurgence/combat-engine";

import {
  type AiDecisionFeature,
  type AiDecisionRequest,
  type AiDecisionResult,
  type AiFailure,
  type AiResult,
  type CandidateEvaluation,
  type CandidateProvenance,
  type DiagnosticRetention,
  type ScoreFactor,
  type ScoreFactorBasis,
} from "./contracts.js";
import { extractDecisionFeatures } from "./feature-extraction.js";
import { descriptorIsUsable, evaluateImmediateCandidate } from "./immediate-utility.js";
import { advisoryFactorsFor, validateAiAdvisoryPriorities } from "./advisory.js";

export const CONTEXTUAL_EVALUATOR = {
  id: "ai-evaluator:combat-context",
  version: "combat-context:v1",
} as const;

export const contextualEvaluatorRegistry = [
  "state-survival-pressure",
  "state-resource-pressure",
  "state-tempo",
  "state-recent-momentum",
  "state-horizon",
  "status-control",
  "transformation-context",
  "scarcity-conservation",
  "pending-response",
] as const;

const factor = (code: string, value: number, basis: ScoreFactorBasis): ScoreFactor => ({
  code,
  value: Number.isFinite(value) ? value : 0,
  evaluator: CONTEXTUAL_EVALUATOR,
  basis,
});

const clamp = (value: number, minimum = -1, maximum = 1) =>
  Math.max(minimum, Math.min(maximum, value));

const hasEffectCategory = (feature: AiDecisionFeature, categories: readonly string[]) =>
  feature.effects.some((effect) => categories.includes(effect.category));

const contextFactorsFor = (feature: AiDecisionFeature): readonly ScoreFactor[] => {
  const context = feature.strategicContext;
  if (context === undefined)
    return [
      factor("context-baseline", 0, {
        type: "state",
        metric: "horizon",
        value: 0,
      }),
    ];

  const survivalPressure = context.actor.hp.pressure;
  const resourcePressure = context.actor.ki.pressure;
  const hasImmediateSurvivalValue =
    feature.immediateOutcome.healing.some((entry) => entry.target === "self") ||
    feature.immediateOutcome.defeatPrevention.guaranteed ||
    feature.decision.type === "respond-to-pending-decision";
  const survivalValue = hasImmediateSurvivalValue ? survivalPressure * 140_000 : 0;
  const resourceValue =
    feature.decision.type === "power-up"
      ? resourcePressure * 45_000
      : feature.decision.type === "use-move" && resourcePressure > 0.75
        ? -resourcePressure * 7_500
        : 0;
  const tempoValue =
    feature.actionConsumption === "free"
      ? 18_000
      : feature.actionConsumption === "response"
        ? 2_000
        : 0;
  const recent = context.recentAction;
  const recentMomentum =
    recent === undefined
      ? 0
      : recent.relation === "self" && recent.outcome === "successful"
        ? 1
        : recent.relation === "opponent" && recent.outcome === "successful"
          ? -1
          : 0;
  const momentumValue =
    recentMomentum *
    (feature.immediateOutcome.damage.some((entry) => entry.target === "opponent") ? 8_000 : 0);
  const horizonValue =
    ((feature.immediateOutcome.actions.delayed ? -1 : 1) / Math.max(1, context.horizon.long)) *
    (hasEffectCategory(feature, ["status", "control", "transformation"]) ? 10_000 : 0);

  return [
    factor("state-survival-pressure", survivalValue, {
      type: "state",
      metric: "survival-pressure",
      value: survivalPressure,
    }),
    factor("state-resource-pressure", resourceValue, {
      type: "state",
      metric: "resource-pressure",
      value: resourcePressure,
    }),
    factor("state-tempo", tempoValue, {
      type: "state",
      metric: "tempo",
      value: feature.actionConsumption === "free" ? 1 : 0,
    }),
    factor("state-recent-momentum", momentumValue, {
      type: "state",
      metric: "momentum",
      value: recentMomentum,
    }),
    factor("state-horizon", horizonValue, {
      type: "state",
      metric: "horizon",
      value: context.horizon.long,
    }),
  ];
};

const statusControlFactorsFor = (feature: AiDecisionFeature): readonly ScoreFactor[] => {
  const context = feature.strategicContext;
  if (context === undefined) return [];
  const controlEffects = feature.effects.filter((effect) =>
    ["status", "control"].includes(effect.category),
  );
  if (controlEffects.length === 0)
    return [
      factor("status-control", 0, {
        type: "effect-control",
        executorType: "none",
        affectedOptionCount: 0,
        redundant: false,
      }),
    ];

  let value = 0;
  let affectedOptionCount = 0;
  let redundant = false;
  for (const effect of controlEffects) {
    const impacts = context.controlImpacts.filter(
      (impact) =>
        impact.relation === "opponent" &&
        (impact.executorType === effect.type || impact.kind === "immunity"),
    );
    if (impacts.length === 0) {
      value += 24_000;
      continue;
    }
    for (const impact of impacts) {
      affectedOptionCount += impact.affectedOptionCount;
      redundant ||= impact.redundant;
      value += impact.redundant ? -20_000 : impact.kind === "immunity" ? -35_000 : 18_000;
      value += Math.min(12_000, impact.affectedOptionCount * 1_500);
      if (impact.duration.expiresSoon) value -= 4_000;
    }
  }
  return [
    factor("status-control", value, {
      type: "effect-control",
      executorType: controlEffects[0]?.type ?? "unknown",
      affectedOptionCount,
      redundant,
    }),
  ];
};

const transformationFactorsFor = (feature: AiDecisionFeature): readonly ScoreFactor[] => {
  const transformation = feature.strategicContext?.transformation;
  if (transformation === undefined)
    return [
      factor("transformation-context", 0, {
        type: "transformation",
        operation:
          feature.decision.type === "deactivate-transformation" ? "deactivate" : "activate",
        netCombatValue: 0,
        horizon: feature.strategicContext?.horizon.medium ?? 0,
      }),
    ];
  const horizon =
    feature.strategicContext?.horizon.medium ?? Math.max(1, transformation.currentDurationTurns);
  const value = clamp(transformation.netCombatValue / 100) * 100_000;
  return [
    factor("transformation-context", value, {
      type: "transformation",
      operation: transformation.operation,
      netCombatValue: transformation.netCombatValue,
      horizon,
    }),
  ];
};

const scarcityFactorsFor = (feature: AiDecisionFeature): readonly ScoreFactor[] => {
  const context = feature.strategicContext;
  if (context === undefined) return [];
  const urgent =
    feature.immediateOutcome.defeatPrevention.guaranteed ||
    feature.immediateOutcome.damage.some(
      (entry) => entry.target === "opponent" && entry.guaranteedLethality,
    );
  const horizon = context.horizon.long;
  const scarce = context.scarcity.filter((entry) => entry.consumedByDecision || entry.finalUse);
  if (scarce.length === 0)
    return [
      factor("scarcity-conservation", 0, {
        type: "scarcity",
        kind: "none",
        finalUse: false,
      }),
    ];
  const value = scarce.reduce((total, entry) => {
    if (!entry.finalUse || urgent) return total;
    const renewableMultiplier =
      entry.renewable === "never" ? 1.5 : entry.renewable === "slow" ? 1 : 0.5;
    return total - 9_000 * renewableMultiplier * Math.min(2, horizon / 3);
  }, 0);
  const first = scarce[0];
  return [
    factor("scarcity-conservation", value, {
      type: "scarcity",
      kind: first?.kind ?? "unknown",
      ...(first?.remaining === undefined ? {} : { remaining: first.remaining }),
      finalUse: scarce.some((entry) => entry.finalUse),
    }),
  ];
};

const pendingFactorsFor = (feature: AiDecisionFeature): readonly ScoreFactor[] => {
  const context = feature.strategicContext;
  if (context === undefined || feature.decision.type !== "respond-to-pending-decision") return [];
  const selected = context.pendingOptions.filter((option) => option.selected);
  if (selected.length === 0)
    return [
      factor("pending-response", 0, {
        type: "pending",
        role: "none",
        selected: false,
        optional: context.pendingWork.optional,
      }),
    ];
  let value = 0;
  for (const option of selected) {
    value += option.decline ? (context.pendingWork.optional ? -18_000 : -50_000) : 0;
    value += option.role === "roll-defense" || option.role === "use-block" ? 12_000 : 0;
    value += option.role === "activate-effect" ? 6_000 : 0;
    value += option.targetIds.length * 1_000;
  }
  const first = selected[0];
  return [
    factor("pending-response", value, {
      type: "pending",
      role: first?.role ?? "unknown",
      selected: true,
      optional: context.pendingWork.optional,
    }),
  ];
};

const contextualFactorsFor = (feature: AiDecisionFeature): readonly ScoreFactor[] => [
  ...contextFactorsFor(feature),
  ...statusControlFactorsFor(feature),
  ...transformationFactorsFor(feature),
  ...scarcityFactorsFor(feature),
  ...pendingFactorsFor(feature),
];

const analysisFailure = (
  candidateIndex: number,
  reason: Extract<AiFailure, { type: "candidate-analysis-failure" }>["reason"],
  detail: string,
  canonicalKey?: string,
): AiFailure => ({
  type: "candidate-analysis-failure",
  candidateIndex,
  reason,
  detail,
  ...(canonicalKey === undefined ? {} : { canonicalKey }),
});

const retainedEvaluations = (
  evaluations: readonly CandidateEvaluation[],
  selected: CandidateEvaluation,
  level: DiagnosticRetention,
) => (level === "none" ? [] : level === "selection-only" ? [selected] : evaluations);

const validateRequest = (request: AiDecisionRequest): AiFailure | undefined => {
  if (request.state.status === "completed")
    return { type: "completed-state", stateVersion: request.state.version };
  if (request.state.activeCombatantId !== request.actorId)
    return {
      type: "actor-mismatch",
      actorId: request.actorId,
      expectedActorId: request.state.activeCombatantId,
    };
  if (request.legalDecisions.length === 0)
    return { type: "empty-legal-set", actorId: request.actorId };
  const seen = new Map<string, number>();
  for (const [candidateIndex, decision] of request.legalDecisions.entries()) {
    const candidate = decision as unknown as { readonly actorId?: string };
    if (candidate.actorId !== request.actorId)
      return {
        type: "candidate-actor-mismatch",
        actorId: request.actorId,
        candidateActorId: candidate.actorId as CombatantId | undefined,
        candidateIndex,
      } as AiFailure;
    const key = canonicalDecisionKey(decision);
    const firstIndex = seen.get(key);
    if (firstIndex !== undefined)
      return {
        type: "duplicate-candidate",
        canonicalKey: key,
        firstIndex,
        duplicateIndex: candidateIndex,
      };
    seen.set(key, candidateIndex);
  }
  if (request.analysis?.describeDecision === undefined)
    return {
      type: "invalid-request",
      issues: [{ path: "analysis.describeDecision", message: "A descriptor facade is required." }],
    };
  return undefined;
};

const contextualEvaluationFor = (
  feature: AiDecisionFeature,
  request: AiDecisionRequest,
  hasViableAlternative: boolean,
  hasPositiveAlternative: boolean,
): CandidateEvaluation => {
  const base = evaluateImmediateCandidate(
    feature,
    request.state,
    hasPositiveAlternative,
    hasViableAlternative,
    request.profile.identity.version,
  );
  const baseFactors = base.scoreFactors.map((entry) => ({
    ...entry,
    evaluator: CONTEXTUAL_EVALUATOR,
  }));
  const scoreFactors = [
    ...baseFactors,
    ...contextualFactorsFor(feature),
    ...advisoryFactorsFor(feature, request.advisoryPriorities),
  ];
  return {
    ...base,
    evaluator: CONTEXTUAL_EVALUATOR,
    scoreFactors,
    totalScore: scoreFactors.reduce((total, entry) => total + entry.value, 0),
  };
};

export const selectContextualDecision = (
  request: AiDecisionRequest,
): AiResult<AiDecisionResult> => {
  if (request.advisoryPriorities !== undefined) {
    const advisory = validateAiAdvisoryPriorities(request.advisoryPriorities);
    if (!advisory.ok)
      return {
        ok: false,
        error: {
          type: "invalid-request",
          issues: advisory.issues.map((entry) => ({
            path: `advisoryPriorities.${entry.path}`,
            message: entry.message,
          })),
        },
      };
  }
  const failure = validateRequest(request);
  if (failure !== undefined) return { ok: false, error: failure };
  const features: AiDecisionFeature[] = [];
  for (const [candidateIndex, decision] of request.legalDecisions.entries()) {
    let descriptor: unknown;
    try {
      descriptor = request.analysis?.describeDecision(request.state, decision);
    } catch (error) {
      return {
        ok: false,
        error: analysisFailure(
          candidateIndex,
          "malformed-analysis",
          error instanceof Error ? error.message : "Descriptor production failed.",
        ),
      };
    }
    if (descriptor === undefined || descriptor === null)
      return {
        ok: false,
        error: analysisFailure(candidateIndex, "missing-analysis", "Descriptor was not supplied."),
      };
    if (!descriptorIsUsable(descriptor))
      return {
        ok: false,
        error: analysisFailure(
          candidateIndex,
          "incomplete-required-facts",
          "Descriptor must contain immediate-outcome:v1 facts.",
        ),
      };
    const extracted = extractDecisionFeatures({
      state: request.state,
      decision,
      descriptor,
      mechanics: request.mechanics,
    });
    if (!extracted.ok)
      return {
        ok: false,
        error: analysisFailure(
          candidateIndex,
          "feature-extraction-failed",
          extracted.error.type,
          canonicalDecisionKey(decision),
        ),
      };
    features.push(extracted.value);
  }
  const hasViableAlternative = features.some((feature) => feature.decision.type !== "surrender");
  const preliminary = features.map((feature) =>
    contextualEvaluationFor(feature, request, hasViableAlternative, false),
  );
  const hasPositiveAlternative = preliminary.some(
    (evaluation) => evaluation.decision.type !== "surrender" && evaluation.totalScore > 0,
  );
  const evaluated = features.map((feature) =>
    contextualEvaluationFor(feature, request, hasViableAlternative, hasPositiveAlternative),
  );
  const randomnessEnabled = request.dependencies.randomness === "enabled";
  const tieValues = new Map<string, number>();
  const tieValueFor = (key: string) => {
    const existing = tieValues.get(key);
    if (existing !== undefined) return existing;
    const value = request.dependencies.random.tieBreak(key);
    tieValues.set(key, value);
    return value;
  };
  const ordered = [...evaluated]
    .sort((left, right) => {
      if (left.totalScore !== right.totalScore) return right.totalScore - left.totalScore;
      if (randomnessEnabled) {
        const leftValue = tieValueFor(left.canonicalKey);
        const rightValue = tieValueFor(right.canonicalKey);
        if (leftValue !== rightValue) return rightValue - leftValue;
      }
      return left.canonicalKey.localeCompare(right.canonicalKey);
    })
    .map((evaluation, index) => ({
      ...evaluation,
      rank: index + 1,
      provenance: [
        randomnessEnabled
          ? {
              type: "keyed-tie-break" as const,
              key: evaluation.canonicalKey,
              value: tieValueFor(evaluation.canonicalKey),
            }
          : { type: "canonical-key-fallback" as const, key: evaluation.canonicalKey },
      ] satisfies readonly CandidateProvenance[],
    }));
  const selected = ordered[0];
  const level = request.diagnosticRetention ?? "none";
  const retained = retainedEvaluations(ordered, selected, level);
  return {
    ok: true,
    value: {
      decision: selected.decision,
      selectedDecision: selected.decision,
      evaluations: retained,
      ...(level === "none"
        ? {}
        : {
            diagnostics: {
              schemaVersion: "ai-decision-diagnostics:v1",
              level,
              stateVersion: request.state.version,
              profileVersion: request.profile.identity.version,
              evaluator: CONTEXTUAL_EVALUATOR,
              selectedCanonicalKey: selected.canonicalKey,
              ...(level === "full" || level === "ranked-summary" ? { evaluations: ordered } : {}),
            },
          }),
    },
  };
};

export const selectContextAwareDecision = selectContextualDecision;
