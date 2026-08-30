/* eslint-disable sonarjs/no-nested-conditional, sonarjs/cognitive-complexity, complexity, max-lines-per-function, max-statements */
import { canonicalDecisionKey } from "@dragonball-resurgence/combat-engine";

import {
  personalityDimensionNames,
  type AiDecisionFeature,
  type AiDecisionRequest,
  type AiDecisionResult,
  type AiFailure,
  type AiMechanicsReference,
  type AiResult,
  type CandidateEvaluation,
  type ScoreFactor,
} from "./contracts.js";
import { extractDecisionFeatures } from "./feature-extraction.js";
import { selectContextualDecision } from "./contextual-utility.js";
import { resolveDifficultySettings, resolvePersonalityDimensions } from "./profiles.js";
import { setupEdgesFor } from "./tactical.js";
import { evaluateExpectedUtility } from "./expected-utility.js";
import { pruneCandidates } from "./pruning.js";

export const STRATEGIC_EVALUATOR = {
  id: "ai-evaluator:strategic",
  version: "strategic:v1",
} as const;

const factorDimension: Readonly<
  Partial<Record<string, (typeof personalityDimensionNames)[number]>>
> = {
  "damage-utility": "damage",
  "guaranteed-win": "aggression",
  "guaranteed-self-loss": "risk-tolerance",
  "defeat-prevention": "defense",
  "pending-response": "defense",
  "status-control": "status",
  "transformation-context": "transformation-preference",
  "scarcity-conservation": "scarcity-conservation",
  "resource-utility": "ki-conservation",
  "overflow-waste": "ki-conservation",
  "action-economy": "aggression",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

const failure = (message: string): AiFailure => ({
  type: "invalid-request",
  issues: [{ path: "profile", message }],
});

const mechanicsReferenceFor = (feature: AiDecisionFeature): AiMechanicsReference | undefined =>
  feature.mechanics;

const hintAdjustmentFor = (feature: AiDecisionFeature): number => {
  const hints = mechanicsReferenceFor(feature)?.aiHints;
  if (hints === undefined) return 0;
  const roles = hints.roles ?? [];
  const moveTags = feature.mechanics?.type === "move" ? feature.mechanics.tags : undefined;
  const roleMatch =
    (feature.effects.some((effect) => effect.category === "damage") && roles.includes("damage")) ||
    (feature.effects.some((effect) => effect.category === "control") &&
      roles.includes("control")) ||
    (feature.decision.type === "activate-transformation" && roles.includes("transformation"));
  const preference = (hints.followUpPreferences ?? []).find(
    (entry) =>
      entry.category === feature.category ||
      entry.tags?.some((tag) =>
        moveTags === undefined ? false : moveTags.includes(tag as (typeof moveTags)[number]),
      ),
  );
  return Math.max(
    -25_000,
    Math.min(25_000, (roleMatch ? 8_000 : 0) + (preference?.weight ?? 0) * 10_000),
  );
};

const protectedCandidate = (evaluation: CandidateEvaluation): boolean =>
  evaluation.scoreFactors.some(
    (factor) =>
      (factor.code === "guaranteed-win" && factor.value > 0) ||
      (factor.code === "defeat-prevention" && factor.value > 0) ||
      (factor.code === "guaranteed-self-loss" && factor.value < 0),
  );

const adjustFactors = (
  evaluation: CandidateEvaluation,
  dimensions: ReturnType<typeof resolvePersonalityDimensions>,
): readonly ScoreFactor[] => {
  const adjustments = new Map<(typeof personalityDimensionNames)[number], number>();
  for (const base of evaluation.scoreFactors) {
    const dimension = factorDimension[base.code];
    if (dimension === undefined) continue;
    adjustments.set(
      dimension,
      (adjustments.get(dimension) ?? 0) + base.value * (dimensions[dimension] - 1),
    );
  }
  return personalityDimensionNames.map((dimension) => ({
    code: `personality-adjustment:${dimension}`,
    value: adjustments.get(dimension) ?? 0,
    evaluator: STRATEGIC_EVALUATOR,
    basis: { type: "adjustment", reason: "personality-adjustment" },
  }));
};

const rank = (
  evaluations: readonly CandidateEvaluation[],
  request: AiDecisionRequest,
  protectedKeys: ReadonlySet<string>,
): readonly CandidateEvaluation[] => {
  const difficulty = resolveDifficultySettings(request.profile.difficulty);
  const randomnessEnabled = request.dependencies.randomness === "enabled";
  const withVariation = evaluations.map((evaluation) => {
    const protectedAction = protectedKeys.has(evaluation.canonicalKey);
    const noise =
      randomnessEnabled && !protectedAction
        ? request.dependencies.random.boundedScoreNoise(
            evaluation.canonicalKey,
            Math.round(difficulty.scoreNoiseMinimum * difficulty.precision),
            Math.round(difficulty.scoreNoiseMaximum * difficulty.precision),
          )
        : 0;
    const noiseFactor: ScoreFactor | undefined =
      noise === 0
        ? undefined
        : {
            code: "difficulty-noise",
            value: noise,
            evaluator: STRATEGIC_EVALUATOR,
            basis: { type: "adjustment", reason: "noise" },
          };
    const factors = [
      ...evaluation.scoreFactors,
      ...(noiseFactor === undefined ? [] : [noiseFactor]),
    ];
    return {
      ...evaluation,
      evaluator: STRATEGIC_EVALUATOR,
      scoreFactors: factors,
      totalScore: factors.reduce((total, factor) => total + factor.value, 0),
      provenance: [
        ...evaluation.provenance,
        ...(noiseFactor === undefined
          ? []
          : [{ type: "controlled-noise" as const, key: evaluation.canonicalKey, value: noise }]),
      ],
    };
  });
  const sorted = [...withVariation].sort((left, right) => {
    if (left.totalScore !== right.totalScore) return right.totalScore - left.totalScore;
    if (randomnessEnabled) {
      const leftTie = request.dependencies.random.tieBreak(left.canonicalKey);
      const rightTie = request.dependencies.random.tieBreak(right.canonicalKey);
      if (leftTie !== rightTie) return rightTie - leftTie;
    }
    return left.canonicalKey.localeCompare(right.canonicalKey);
  });
  return sorted.map((evaluation, index) => ({ ...evaluation, rank: index + 1 }));
};

const extractFeatures = (
  request: AiDecisionRequest,
):
  | { readonly ok: true; readonly features: readonly AiDecisionFeature[] }
  | { readonly ok: false; readonly error: AiFailure } => {
  if (!isRecord(request) || request.legalDecisions.length === 0)
    return { ok: false, error: failure("A non-empty legal decision set is required.") };
  if (request.analysis?.describeDecision === undefined)
    return { ok: false, error: failure("A descriptor facade is required.") };
  const features: AiDecisionFeature[] = [];
  for (const [index, decision] of request.legalDecisions.entries()) {
    try {
      const descriptor = request.analysis.describeDecision(request.state, decision);
      const extracted = extractDecisionFeatures({
        state: request.state,
        decision,
        descriptor,
        mechanics: request.mechanics,
      });
      if (!extracted.ok)
        return {
          ok: false,
          error: {
            type: "candidate-analysis-failure",
            candidateIndex: index,
            canonicalKey: canonicalDecisionKey(decision),
            reason: "feature-extraction-failed",
            detail: extracted.error.type,
          },
        };
      features.push(extracted.value);
    } catch (error) {
      return {
        ok: false,
        error: {
          type: "candidate-analysis-failure",
          candidateIndex: index,
          canonicalKey: canonicalDecisionKey(decision),
          reason: "malformed-analysis",
          detail: error instanceof Error ? error.message : "Descriptor production failed.",
        },
      };
    }
  }
  return { ok: true, features };
};

export const selectStrategicDecision = (request: AiDecisionRequest): AiResult<AiDecisionResult> => {
  const profile = request.profile;
  const profileValidation = resolvePersonalityDimensions(profile.personality);
  const difficulty = resolveDifficultySettings(profile.difficulty);
  if (difficulty.scoreNoiseMinimum > difficulty.scoreNoiseMaximum)
    return { ok: false, error: failure("Noise bounds are ordered incorrectly.") };
  const contextResult = selectContextualDecision({ ...request, diagnosticRetention: "full" });
  if (!contextResult.ok) return contextResult;
  const extracted = extractFeatures(request);
  if (!extracted.ok) return extracted;
  const featureByKey = new Map(
    extracted.features.map((feature) => [feature.canonicalKey, feature]),
  );
  const descriptorByKey = new Map(
    extracted.features.map((feature) => [
      feature.canonicalKey,
      request.analysis?.describeDecision(request.state, feature.decision),
    ]),
  );
  const edges = setupEdgesFor(extracted.features);
  const contextualEvaluations =
    contextResult.value.evaluations.length > 0
      ? contextResult.value.evaluations
      : (contextResult.value.diagnostics?.evaluations ?? []);
  const enriched = contextualEvaluations.map((evaluation) => {
    const feature = featureByKey.get(evaluation.canonicalKey);
    const personality = feature === undefined ? [] : adjustFactors(evaluation, profileValidation);
    const hintValue = feature === undefined ? 0 : hintAdjustmentFor(feature);
    const hint =
      hintValue === 0
        ? []
        : [
            {
              code: "advisory-hint",
              value: hintValue,
              evaluator: STRATEGIC_EVALUATOR,
              basis: { type: "adjustment" as const, reason: "personality-adjustment" as const },
            },
          ];
    const setupValue =
      edges
        .filter((edge) => edge.sourceKey === evaluation.canonicalKey)
        .reduce((sum, edge) => sum + edge.value, 0) * difficulty.comboAwareness;
    const setup =
      setupValue === 0
        ? []
        : [
            {
              code: "setup-combo-value",
              value: setupValue,
              evaluator: STRATEGIC_EVALUATOR,
              basis: { type: "state" as const, metric: "horizon" as const, value: setupValue },
            },
          ];
    const factors = [...evaluation.scoreFactors, ...personality, ...hint, ...setup];
    const baseEvaluation = {
      ...evaluation,
      scoreFactors: factors,
      totalScore: factors.reduce((sum, factor) => sum + factor.value, 0),
    };
    const descriptor = descriptorByKey.get(evaluation.canonicalKey);
    return descriptor === undefined
      ? baseEvaluation
      : evaluateExpectedUtility({ evaluation: baseEvaluation, descriptor }).evaluation;
  });
  const protectedKeys = new Set(
    enriched.filter(protectedCandidate).map((evaluation) => evaluation.canonicalKey),
  );
  const ranked = rank(enriched, request, protectedKeys);
  const candidateLimit = Math.max(
    1,
    request.workLimits?.candidateLimit ?? difficulty.candidateLimit,
  );
  const pruned = pruneCandidates(ranked, candidateLimit);
  const retained = pruned.retained;
  const nearBest = retained.filter(
    (evaluation) => evaluation.totalScore >= (retained[0]?.totalScore ?? 0) - 25_000,
  );
  let selected = [...retained].sort((left, right) => left.rank - right.rank)[0];
  if (
    request.dependencies.randomness === "enabled" &&
    nearBest.length > 1 &&
    !protectedKeys.has(selected.canonicalKey) &&
    request.dependencies.random.probability("mistake", difficulty.mistakeProbability)
  ) {
    selected = request.dependencies.random.selectMistake(
      "retained-near-best",
      nearBest.map((evaluation) => ({ key: evaluation.canonicalKey, value: evaluation })),
    );
    selected = {
      ...selected,
      provenance: [
        ...selected.provenance,
        { type: "controlled-mistake", key: selected.canonicalKey },
      ],
    };
  }
  const ordered = [...pruned.evaluations].sort((left, right) =>
    left.canonicalKey.localeCompare(right.canonicalKey),
  );
  const level = request.diagnosticRetention ?? "none";
  return {
    ok: true,
    value: {
      decision: selected.decision,
      selectedDecision: selected.decision,
      evaluations: level === "none" ? [] : level === "selection-only" ? [selected] : ordered,
      ...(level === "none"
        ? {}
        : {
            diagnostics: {
              schemaVersion: "ai-decision-diagnostics:v2" as const,
              level,
              stateVersion: request.state.version,
              profileVersion: request.profile.identity.version,
              evaluator: STRATEGIC_EVALUATOR,
              selectedCanonicalKey: selected.canonicalKey,
              evaluations: level === "full" || level === "ranked-summary" ? ordered : undefined,
              setupEdges: edges,
              budget: {
                candidates: pruned.usage.candidates,
                outcomes: {
                  used: pruned.usage.outcomes.used,
                  limit: request.workLimits?.outcomeLimit ?? pruned.usage.outcomes.limit,
                },
                nodes: { used: 0, limit: request.workLimits?.nodeLimit ?? difficulty.maxNodes },
                probes: { used: 0, limit: request.workLimits?.probeLimit ?? difficulty.maxProbes },
              },
            },
          }),
    },
  };
};

export const selectPersonalityDecision = selectStrategicDecision;
export const selectControlledDecision = selectStrategicDecision;
