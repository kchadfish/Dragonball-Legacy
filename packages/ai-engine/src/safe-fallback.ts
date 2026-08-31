import { canonicalDecisionKey, type LegalDecision } from "@dragonball-resurgence/combat-engine";

import type {
  AiDecisionRequest,
  AiDecisionResult,
  AiFailure,
  AiResult,
  CandidateEvaluation,
  CandidateProvenance,
  DiagnosticRetention,
  ScoreFactor,
} from "./contracts.js";

interface InternalEvaluation {
  readonly decision: LegalDecision;
  readonly canonicalKey: string;
  readonly baseline: number;
  readonly tieValue?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

const invalidRequest = (
  issues: readonly { readonly path: string; readonly message: string }[],
): AiFailure => ({ type: "invalid-request", issues });

export const mechanicsViewMismatchFor = (request: AiDecisionRequest): AiFailure | undefined => {
  const identity = request.mechanics.identity;
  if (identity === undefined) return undefined;
  if (
    request.state.mechanicsView !== undefined &&
    request.state.mechanicsView.schemaVersion === identity.schemaVersion &&
    request.state.mechanicsView.contentHash === identity.contentHash
  )
    return undefined;
  return {
    type: "mechanics-view-mismatch",
    expected: identity.contentHash,
    actual: request.state.mechanicsView?.contentHash,
  };
};

const validateState = (request: AiDecisionRequest): AiFailure | undefined => {
  const state = request.state;
  if (!isRecord(state)) {
    return { type: "invalid-request", issues: [{ path: "state", message: "State is required." }] };
  }
  if (state.status === "completed") {
    return typeof state.version === "number"
      ? { type: "completed-state", stateVersion: state.version }
      : invalidRequest([{ path: "state.version", message: "State version is required." }]);
  }
  if (
    state.status !== "active" ||
    !isRecord(state.combatants) ||
    typeof state.activeCombatantId !== "string"
  ) {
    return invalidRequest([{ path: "state", message: "Active fight state is malformed." }]);
  }
  if (state.combatants[request.actorId] === undefined) {
    return {
      type: "invalid-request",
      issues: [{ path: "actorId", message: "Actor is not present in the fight state." }],
    };
  }
  const expectedActorId = state.pendingDecision?.combatantId ?? state.activeCombatantId;
  if (expectedActorId !== request.actorId) {
    return {
      type: "actor-mismatch",
      actorId: request.actorId,
      expectedActorId,
    };
  }
  return undefined;
};

const validateProfileAndDependencies = (request: AiDecisionRequest): AiFailure | undefined => {
  if (
    !isRecord(request.profile) ||
    !isRecord(request.profile.identity) ||
    !isRecord(request.profile.personality) ||
    !isRecord(request.profile.difficulty) ||
    !isRecord(request.mechanics) ||
    !isRecord(request.dependencies) ||
    !isRecord(request.dependencies.random)
  ) {
    return invalidRequest([{ path: "request", message: "AI request dependencies are malformed." }]);
  }
  if (
    typeof request.profile.identity.version !== "string" ||
    request.profile.identity.version.length === 0
  ) {
    return invalidRequest([{ path: "profile.identity.version", message: "Version is required." }]);
  }
  if (
    typeof request.profile.personality.version !== "string" ||
    request.profile.personality.version.length === 0
  ) {
    return invalidRequest([
      { path: "profile.personality.version", message: "Version is required." },
    ]);
  }
  if (
    typeof request.profile.difficulty.version !== "string" ||
    request.profile.difficulty.version.length === 0
  ) {
    return invalidRequest([
      { path: "profile.difficulty.version", message: "Version is required." },
    ]);
  }
  if (typeof request.mechanics.version !== "string" || request.mechanics.version.length === 0) {
    return invalidRequest([{ path: "mechanics.version", message: "Version is required." }]);
  }
  if (
    request.mechanics.identity !== undefined &&
    (request.state.mechanicsView === undefined ||
      request.state.mechanicsView.contentHash !== request.mechanics.identity.contentHash ||
      request.state.mechanicsView.schemaVersion !== request.mechanics.identity.schemaVersion)
  ) {
    return {
      type: "mechanics-view-mismatch",
      expected: request.mechanics.identity.contentHash,
      actual: request.state.mechanicsView?.contentHash,
    };
  }
  if (
    typeof request.dependencies.random.tieBreak !== "function" ||
    typeof request.dependencies.random.probability !== "function" ||
    typeof request.dependencies.random.boundedScoreNoise !== "function" ||
    typeof request.dependencies.random.selectMistake !== "function"
  ) {
    return invalidRequest([
      { path: "dependencies.random", message: "AI randomness is malformed." },
    ]);
  }
  return undefined;
};

const validateCandidates = (request: AiDecisionRequest): AiFailure | undefined => {
  const seen = new Map<string, number>();
  for (const [candidateIndex, candidate] of request.legalDecisions.entries()) {
    if (!isRecord(candidate) || typeof candidate.actorId !== "string") {
      return invalidRequest([
        { path: `legalDecisions[${candidateIndex}]`, message: "Candidate is malformed." },
      ]);
    }
    if (candidate.actorId !== request.actorId) {
      return {
        type: "candidate-actor-mismatch",
        actorId: request.actorId,
        candidateActorId: candidate.actorId as typeof request.actorId,
        candidateIndex,
      };
    }
    let key: string;
    try {
      key = canonicalDecisionKey(candidate as LegalDecision);
    } catch {
      return invalidRequest([
        { path: `legalDecisions[${candidateIndex}]`, message: "Candidate is malformed." },
      ]);
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

const validateRequest = (request: AiDecisionRequest): AiFailure | undefined => {
  if (!isRecord(request)) {
    return invalidRequest([{ path: "request", message: "Request is required." }]);
  }
  const stateFailure = validateState(request);
  if (stateFailure !== undefined) return stateFailure;
  if (!Array.isArray(request.legalDecisions)) {
    return invalidRequest([{ path: "legalDecisions", message: "Legal decisions are required." }]);
  }
  if (request.legalDecisions.length === 0) {
    return { type: "empty-legal-set", actorId: request.actorId };
  }
  const profileFailure = validateProfileAndDependencies(request);
  if (profileFailure !== undefined) return profileFailure;
  return validateCandidates(request);
};

const toEvaluation = (evaluation: InternalEvaluation, rank: number): CandidateEvaluation => {
  const baselineProvenance: CandidateProvenance = {
    type: "baseline",
    reason: evaluation.baseline < 0 ? "surrender" : "viable-alternative",
  };
  const provenance: CandidateProvenance[] = [baselineProvenance];
  if (evaluation.tieValue !== undefined) {
    provenance.push({
      type: "keyed-tie-break",
      key: evaluation.canonicalKey,
      value: evaluation.tieValue,
    });
  } else {
    provenance.push({ type: "canonical-key-fallback", key: evaluation.canonicalKey });
  }
  const scoreFactors: ScoreFactor[] = [
    {
      code: "baseline-fallback",
      value: evaluation.baseline,
      evaluator: { id: "ai-evaluator:baseline-fallback", version: "baseline-immediate:v1" },
      basis: { type: "none" },
    },
  ];
  return {
    decision: evaluation.decision,
    canonicalKey: evaluation.canonicalKey,
    candidateIdentity: {
      canonicalKey: evaluation.canonicalKey,
      decisionType: evaluation.decision.type,
    },
    evaluator: { id: "ai-evaluator:baseline-fallback", version: "baseline-immediate:v1" },
    profileVersion: "fallback",
    scoreFactors,
    provenance,
    totalScore: evaluation.baseline,
    rank,
  };
};

const retainedEvaluations = (
  evaluations: readonly CandidateEvaluation[],
  selected: CandidateEvaluation,
  level: DiagnosticRetention,
): readonly CandidateEvaluation[] => {
  if (level === "none") return [];
  if (level === "selection-only") return [selected];
  return evaluations;
};

export const selectSafeLegalDecision = (request: AiDecisionRequest): AiResult<AiDecisionResult> => {
  const failure = validateRequest(request);
  if (failure !== undefined) return { ok: false, error: failure };

  const randomnessEnabled = request.dependencies.randomness === "enabled";
  const internal = request.legalDecisions.map((decision) => {
    const key = canonicalDecisionKey(decision);
    return {
      decision,
      canonicalKey: key,
      baseline: decision.type === "surrender" ? -1 : 0,
      ...(randomnessEnabled ? { tieValue: request.dependencies.random.tieBreak(key) } : {}),
    } satisfies InternalEvaluation;
  });
  const ordered = [...internal].sort((left, right) => {
    if (left.baseline !== right.baseline) return right.baseline - left.baseline;
    if (
      left.tieValue !== undefined &&
      right.tieValue !== undefined &&
      left.tieValue !== right.tieValue
    ) {
      return right.tieValue - left.tieValue;
    }
    return left.canonicalKey.localeCompare(right.canonicalKey);
  });
  const evaluations = ordered.map((evaluation, index) => toEvaluation(evaluation, index + 1));
  const selectedEvaluation = evaluations[0];
  const level = request.diagnosticRetention ?? "none";
  const retained = retainedEvaluations(evaluations, selectedEvaluation, level);
  const result: AiDecisionResult = {
    decision: selectedEvaluation.decision,
    selectedDecision: selectedEvaluation.decision,
    evaluations: retained,
    ...(level === "none"
      ? {}
      : {
          diagnostics: {
            schemaVersion: "ai-decision-diagnostics:v1",
            level,
            stateVersion: request.state.version,
            profileVersion: request.profile.identity.version,
            evaluator: { id: "ai-evaluator:baseline-fallback", version: "baseline-immediate:v1" },
            selectedCanonicalKey: selectedEvaluation.canonicalKey,
            ...(level === "full" || level === "ranked-summary" ? { evaluations } : {}),
          },
        }),
  };
  return { ok: true, value: result };
};
