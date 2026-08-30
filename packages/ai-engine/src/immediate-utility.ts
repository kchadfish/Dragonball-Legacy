/* eslint-disable sonarjs/no-nested-conditional */
import {
  canonicalDecisionKey,
  type CombatDecisionDescriptor,
  type FightState,
  type LegalDecision,
} from "@dragonball-resurgence/combat-engine";

import {
  type AiDecisionFeature,
  type AiDecisionRequest,
  type AiDecisionResult,
  type AiFailure,
  type AiImmediateUtilityRequest,
  type AiResult,
  type CandidateEvaluation,
  type CandidateProvenance,
  type DiagnosticRetention,
  type ScoreFactor,
  type ScoreFactorBasis,
} from "./contracts.js";
import { extractDecisionFeatures } from "./feature-extraction.js";
import { selectSafeLegalDecision } from "./safe-fallback.js";
import { selectContextualDecision } from "./contextual-utility.js";
import { selectStrategicDecision } from "./strategic-utility.js";
import { resolveDifficultySettings } from "./profiles.js";
import { selectLookaheadDecision } from "./lookahead.js";

export const IMMEDIATE_UTILITY_EVALUATOR = {
  id: "ai-evaluator:baseline-immediate",
  version: "baseline-immediate:v1",
} as const;

export const immediateUtilityEvaluatorRegistry = [
  "resource-utility",
  "damage-utility",
  "healing-utility",
  "survival-utility",
  "ko-utility",
  "terminal-utility",
  "action-economy",
  "tactical-clamp",
  "baseline-fallback",
] as const;

const factor = (
  code: string,
  value: number,
  basis: ScoreFactorBasis = { type: "none" },
): ScoreFactor => ({ code, value, evaluator: IMMEDIATE_UTILITY_EVALUATOR, basis });

const finite = (value: number) => (Number.isFinite(value) ? value : 0);
const normalized = (amount: number, maximum: number) =>
  maximum <= 0 ? 0 : Math.max(0, Math.min(1, amount / maximum));
const urgency = (current: number, maximum: number) =>
  maximum <= 0 ? 0 : Math.max(0, 1 - current / maximum);
const rangeValue = (range: { readonly minimum: number; readonly maximum: number } | undefined) =>
  range === undefined ? undefined : range.minimum + 0.25 * (range.maximum - range.minimum);

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

// Runtime descriptor validation intentionally checks the complete required summary shape.
// eslint-disable-next-line complexity
export const descriptorIsUsable = (descriptor: unknown): descriptor is CombatDecisionDescriptor => {
  if (descriptor === null || typeof descriptor !== "object") return false;
  const summary = (descriptor as { readonly immediateOutcome?: unknown }).immediateOutcome;
  if (summary === null || typeof summary !== "object") return false;
  const version = (summary as { readonly version?: unknown }).version;
  const completeness = (summary as { readonly completeness?: unknown }).completeness;
  const summaryRecord = summary as {
    readonly resources?: unknown;
    readonly damage?: unknown;
    readonly healing?: unknown;
    readonly defeatPrevention?: unknown;
    readonly actions?: unknown;
    readonly unknownFacts?: unknown;
  };
  const defeatPrevention = summaryRecord.defeatPrevention as
    { readonly guaranteed?: unknown; readonly possible?: unknown } | undefined;
  const actions = summaryRecord.actions as
    | {
        readonly free?: unknown;
        readonly extraOwnActions?: unknown;
        readonly skippedOwnActions?: unknown;
        readonly skippedOpponentActions?: unknown;
        readonly response?: unknown;
        readonly delayed?: unknown;
      }
    | undefined;
  return (
    version === "immediate-outcome:v1" &&
    (completeness === "complete" || completeness === "partial") &&
    Array.isArray(summaryRecord.resources) &&
    Array.isArray(summaryRecord.damage) &&
    Array.isArray(summaryRecord.healing) &&
    Array.isArray(summaryRecord.unknownFacts) &&
    typeof defeatPrevention === "object" &&
    typeof defeatPrevention.guaranteed === "boolean" &&
    typeof defeatPrevention.possible === "boolean" &&
    typeof actions === "object" &&
    typeof actions.free === "boolean" &&
    typeof actions.extraOwnActions === "number" &&
    typeof actions.skippedOwnActions === "number" &&
    typeof actions.skippedOpponentActions === "number" &&
    typeof actions.response === "boolean" &&
    typeof actions.delayed === "boolean"
  );
};

// Resource scoring intentionally combines HP/Ki direction, urgency, timing, and overflow in one evaluator.
// eslint-disable-next-line sonarjs/cognitive-complexity, complexity
const evaluateResourceUtility = (feature: AiDecisionFeature, state: FightState): ScoreFactor[] => {
  const activeState = state.status === "active" ? state : undefined;
  const actor = activeState?.combatants[feature.decision.actorId];
  const opponentId = feature.targets.find((target) => target.relation === "opponent")?.combatantId;
  const opponent = opponentId === undefined ? undefined : activeState?.combatants[opponentId];
  let value = 0;
  let overflowWaste = 0;
  for (const entry of feature.immediateOutcome.resources) {
    if (entry.amount === undefined) continue;
    const subject = entry.target === "self" ? actor : opponent;
    const resource = entry.resource === "hp" ? subject?.hitPoints : subject?.ki;
    if (resource === undefined) continue;
    const amount = rangeValue(entry.amount) ?? 0;
    const amountNormalized = normalized(amount, resource.maximum);
    const resourceUrgency = urgency(resource.current, resource.maximum);
    const timingMultiplier = entry.timing === "delayed" ? 0.5 : 1;
    overflowWaste += normalized(rangeValue(entry.overflow) ?? 0, resource.maximum);
    const direction = entry.target === "self" ? 1 : -1;
    if (entry.operation === "gain") {
      value +=
        direction *
        (entry.resource === "hp" ? 12_000 : 6_000) *
        amountNormalized *
        resourceUrgency *
        timingMultiplier;
    } else if (entry.resource === "hp") {
      value -= direction * 15_000 * amountNormalized * resourceUrgency * timingMultiplier;
    } else {
      value -=
        ((direction * (8_000 * (entry.effective ?? amount))) / Math.max(resource.current, 1)) *
        timingMultiplier;
    }
  }
  return [
    factor("resource-utility", finite(value)),
    factor("overflow-waste", finite(-2_000 * overflowWaste)),
  ];
};

const evaluateDamage = (feature: AiDecisionFeature, state: FightState): ScoreFactor[] => {
  const activeState = state.status === "active" ? state : undefined;
  const opponentId = feature.targets.find((target) => target.relation === "opponent")?.combatantId;
  let value = 0;
  let overkill = 0;
  for (const damage of feature.immediateOutcome.damage) {
    if (damage.amount === undefined) continue;
    const combatantId = damage.target === "self" ? feature.decision.actorId : opponentId;
    const target = combatantId === undefined ? undefined : activeState?.combatants[combatantId];
    if (target === undefined) continue;
    const amount = rangeValue(damage.amount) ?? 0;
    const multiplier = damage.timing === "delayed" ? 0.5 : 1;
    const sign = damage.selfHarm ? -1.5 : 1;
    value += sign * 10_000 * normalized(amount, target.hitPoints.maximum) * multiplier;
    overkill += normalized(rangeValue(damage.overkill) ?? 0, target.hitPoints.maximum);
  }
  return [
    factor("damage-utility", finite(value)),
    factor("overkill-waste", finite(-1_000 * overkill)),
  ];
};

const evaluateHealing = (feature: AiDecisionFeature, state: FightState): ScoreFactor => {
  const activeState = state.status === "active" ? state : undefined;
  const opponentId = feature.targets.find((target) => target.relation === "opponent")?.combatantId;
  let value = 0;
  for (const healing of feature.immediateOutcome.healing) {
    if (healing.amount === undefined) continue;
    const combatantId = healing.target === "self" ? feature.decision.actorId : opponentId;
    const target = combatantId === undefined ? undefined : activeState?.combatants[combatantId];
    if (target === undefined) continue;
    const amount = rangeValue(healing.amount) ?? 0;
    const maximum = target.hitPoints.maximum;
    const multiplier = healing.timing === "delayed" ? 0.5 : 1;
    value +=
      12_000 *
      normalized(amount, maximum) *
      urgency(target.hitPoints.current, maximum) *
      multiplier;
    value -= 2_000 * normalized(rangeValue(healing.overflow) ?? 0, maximum);
  }
  return factor("healing-utility", finite(value));
};

const evaluateSurvival = (feature: AiDecisionFeature): ScoreFactor =>
  factor("defeat-prevention", feature.immediateOutcome.defeatPrevention.guaranteed ? 750_000 : 0, {
    type: "boolean",
    value: feature.immediateOutcome.defeatPrevention.guaranteed,
  });

const evaluateKo = (feature: AiDecisionFeature): ScoreFactor[] => {
  const wins = feature.immediateOutcome.damage.some(
    (damage) => damage.target === "opponent" && damage.guaranteedLethality,
  );
  const losses = feature.immediateOutcome.damage.some(
    (damage) => damage.target === "self" && damage.guaranteedLethality,
  );
  return [
    factor("guaranteed-win", wins ? 1_000_000 : 0, { type: "boolean", value: wins }),
    factor("guaranteed-self-loss", losses ? -1_250_000 : 0, { type: "boolean", value: losses }),
  ];
};

const evaluateActionEconomy = (feature: AiDecisionFeature): ScoreFactor => {
  const actions = feature.immediateOutcome.actions;
  const immediateValue =
    (actions.free ? 500 : 0) +
    (actions.extraOwnActions + actions.skippedOpponentActions) * 4_000 -
    actions.skippedOwnActions * 8_000;
  const value = immediateValue * (actions.delayed ? 0.5 : 1);
  return factor("action-economy", value, {
    type: "range",
    minimum: actions.skippedOwnActions,
    maximum: actions.extraOwnActions + actions.skippedOpponentActions,
    timing: actions.delayed ? "delayed" : "immediate",
  });
};

const tacticalCodes = new Set([
  "resource-utility",
  "damage-utility",
  "overkill-waste",
  "overflow-waste",
  "healing-utility",
  "action-economy",
]);

export const evaluateImmediateCandidate = (
  feature: AiDecisionFeature,
  state: FightState,
  hasPositiveAlternative: boolean,
  hasViableAlternative: boolean,
  profileVersion: string,
): CandidateEvaluation => {
  const resource = evaluateResourceUtility(feature, state);
  const damage = evaluateDamage(feature, state);
  const healing = evaluateHealing(feature, state);
  const survival = evaluateSurvival(feature);
  const ko = evaluateKo(feature);
  const terminalValue =
    feature.decision.type === "surrender" && hasViableAlternative ? -2_000_000 : 0;
  const terminal = factor("terminal-utility", terminalValue, {
    type: "boolean",
    value: terminalValue !== 0,
  });
  const action = evaluateActionEconomy(feature);
  const beforeClamp = [...resource, ...damage, healing, survival, ...ko, terminal, action];
  const tactical = beforeClamp
    .filter((entry) => tacticalCodes.has(entry.code))
    .reduce((total, entry) => total + entry.value, 0);
  const clamped = Math.max(-100_000, Math.min(100_000, tactical));
  const clamp = factor("tactical-clamp", clamped - tactical, {
    type: "adjustment",
    reason: "tactical-clamp",
  });
  const passValue = feature.decision.type === "pass" && hasPositiveAlternative ? -2_000 : 0;
  const baseline = factor("baseline-fallback", passValue);
  const scoreFactors = [...beforeClamp, clamp, baseline];
  return {
    decision: feature.decision,
    canonicalKey: feature.canonicalKey,
    candidateIdentity: {
      canonicalKey: feature.canonicalKey,
      decisionType: feature.decision.type,
    },
    evaluator: IMMEDIATE_UTILITY_EVALUATOR,
    profileVersion,
    scoreFactors,
    provenance: [],
    totalScore: scoreFactors.reduce((total, entry) => total + entry.value, 0),
    rank: 0,
  };
};

const retainedEvaluations = (
  evaluations: readonly CandidateEvaluation[],
  selected: CandidateEvaluation,
  level: DiagnosticRetention,
) => {
  if (level === "none") return [];
  if (level === "selection-only") return [selected];
  return evaluations;
};

const validateRequest = (request: AiImmediateUtilityRequest): AiFailure | undefined => {
  if (request.state.status === "completed") {
    return { type: "completed-state", stateVersion: request.state.version };
  }
  if (request.state.activeCombatantId !== request.actorId) {
    return {
      type: "actor-mismatch",
      actorId: request.actorId,
      expectedActorId: request.state.activeCombatantId,
    };
  }
  if (request.legalDecisions.length === 0)
    return { type: "empty-legal-set", actorId: request.actorId };
  const suppliedAnalysis = (
    request as unknown as {
      readonly analysis?: AiImmediateUtilityRequest["analysis"];
    }
  ).analysis;
  if (suppliedAnalysis === undefined || typeof suppliedAnalysis.describeDecision !== "function") {
    return {
      type: "invalid-request",
      issues: [
        {
          path: "analysis.describeDecision",
          message: "A descriptor-producing analysis facade is required.",
        },
      ],
    };
  }
  const seen = new Map<string, number>();
  for (const [candidateIndex, candidate] of request.legalDecisions.entries()) {
    const candidateValue: unknown = candidate;
    if (candidateValue === null || typeof candidateValue !== "object") {
      return {
        type: "invalid-request",
        issues: [
          { path: `legalDecisions.${candidateIndex}`, message: "A legal decision is required." },
        ],
      };
    }
    const candidateActorId = (candidateValue as { readonly actorId?: LegalDecision["actorId"] })
      .actorId;
    if (candidateActorId !== request.actorId) {
      return {
        type: "candidate-actor-mismatch",
        actorId: request.actorId,
        candidateActorId,
        candidateIndex,
      };
    }
    let key: string;
    try {
      key = canonicalDecisionKey(candidate);
    } catch {
      return {
        type: "invalid-request",
        issues: [
          {
            path: `legalDecisions.${candidateIndex}`,
            message: "A legal decision must have a valid canonical key.",
          },
        ],
      };
    }
    const firstIndex = seen.get(key);
    if (firstIndex !== undefined) {
      return {
        type: "duplicate-candidate",
        canonicalKey: key,
        firstIndex,
        duplicateIndex: candidateIndex,
      };
    }
    seen.set(key, candidateIndex);
  }
  return undefined;
};

// Candidate analysis, evaluation, ranking, and retention form one atomic deterministic selection operation.
/* eslint-disable sonarjs/cognitive-complexity, max-lines-per-function */
export const selectImmediateUtilityDecision = (
  request: AiImmediateUtilityRequest,
): AiResult<AiDecisionResult> => {
  const failure = validateRequest(request);
  if (failure !== undefined) return { ok: false, error: failure };
  const features: AiDecisionFeature[] = [];
  for (const [candidateIndex, decision] of request.legalDecisions.entries()) {
    let descriptor: unknown;
    try {
      descriptor = request.analysis.describeDecision(request.state, decision);
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
    if (descriptor === undefined || descriptor === null) {
      return {
        ok: false,
        error: analysisFailure(candidateIndex, "missing-analysis", "Descriptor was not supplied."),
      };
    }
    if (!descriptorIsUsable(descriptor)) {
      return {
        ok: false,
        error: analysisFailure(
          candidateIndex,
          "incomplete-required-facts",
          "Descriptor must contain immediate-outcome:v1 facts.",
        ),
      };
    }
    const extracted = extractDecisionFeatures({
      state: request.state,
      decision,
      descriptor,
      mechanics: request.mechanics,
    });
    if (!extracted.ok) {
      return {
        ok: false,
        error: analysisFailure(
          candidateIndex,
          extracted.error.type === "descriptor-decision-mismatch"
            ? "descriptor-mismatch"
            : "feature-extraction-failed",
          extracted.error.type,
          canonicalDecisionKey(decision),
        ),
      };
    }
    features.push(extracted.value);
  }

  const hasViableAlternative = features.some((feature) => feature.decision.type !== "surrender");
  const preliminary = features.map((feature) =>
    evaluateImmediateCandidate(
      feature,
      request.state,
      false,
      hasViableAlternative,
      request.profile.identity.version,
    ),
  );
  const hasPositiveAlternative = preliminary.some(
    (evaluation) => evaluation.decision.type !== "surrender" && evaluation.totalScore > 0,
  );
  const evaluated = features.map((feature) =>
    evaluateImmediateCandidate(
      feature,
      request.state,
      hasPositiveAlternative,
      hasViableAlternative,
      request.profile.identity.version,
    ),
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
              evaluator: IMMEDIATE_UTILITY_EVALUATOR,
              selectedCanonicalKey: selected.canonicalKey,
              ...(level === "full" || level === "ranked-summary" ? { evaluations: ordered } : {}),
            },
          }),
    },
  };
};
/* eslint-enable sonarjs/cognitive-complexity, max-lines-per-function */

export const selectLegalDecision = (request: AiDecisionRequest): AiResult<AiDecisionResult> =>
  request.analysis?.describeDecision === undefined
    ? selectSafeLegalDecision(request)
    : request.profile.personality.dimensions !== undefined
      ? resolveDifficultySettings(request.profile.difficulty).lookaheadDepth > 0
        ? selectLookaheadDecision(request)
        : selectStrategicDecision(request)
      : selectContextualDecision(request);
