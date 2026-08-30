/* eslint-disable sonarjs/no-nested-conditional, sonarjs/cognitive-complexity, complexity, max-lines-per-function, max-statements, sonarjs/no-misleading-array-reverse, sonarjs/different-types-comparison */
import {
  canonicalDecisionKey,
  createBranchCombatDependencies,
  enumerateAnalysisDecisions,
  type FightState,
} from "@dragonball-resurgence/combat-engine";

import type {
  AiBudgetUsage,
  AiDecisionRequest,
  AiDecisionResult,
  AiFailure,
  AiResult,
  AiSearchPath,
} from "./contracts.js";
import { canonicalHash } from "./canonicalization.js";
import { resolveDifficultySettings } from "./profiles.js";
import { selectStrategicDecision } from "./strategic-utility.js";

export type AiLookaheadResult = AiDecisionResult;

const use = (used: number, limit: number): boolean => used < limit;

const actorForPending = (state: FightState): string => {
  if (state.status !== "active") return "";
  const pending = state.pendingDecision as unknown as { readonly actorId?: string } | undefined;
  return pending?.actorId ?? state.activeCombatantId;
};

const responseValue = (
  state: FightState,
  request: AiDecisionRequest,
  profile: AiDecisionRequest["profile"],
  responseLimit: number,
): {
  readonly value: number;
  readonly paths: readonly AiSearchPath[];
  readonly nodes: number;
  readonly probes: number;
} => {
  if (state.status === "completed")
    return {
      value: state.completion.winnerCombatantId === request.actorId ? 1_000_000 : -1_000_000,
      paths: [],
      nodes: 0,
      probes: 0,
    };
  const actorId = actorForPending(state) as AiDecisionRequest["actorId"];
  const legal = enumerateAnalysisDecisions(state, actorId);
  if (legal.length === 0 || request.analysis?.probeDecision === undefined)
    return { value: 0, paths: [], nodes: 0, probes: 0 };
  const response = selectStrategicDecision({
    ...request,
    state,
    actorId,
    legalDecisions: legal,
    profile: {
      ...profile,
      difficulty: { ...profile.difficulty, candidateLimit: Math.max(1, responseLimit) },
    },
    diagnosticRetention: "full",
  });
  if (!response.ok) return { value: 0, paths: [], nodes: 0, probes: 0 };
  const selected = response.value.evaluations[0]?.totalScore ?? 0;
  return {
    value: actorId === request.actorId ? selected : -selected,
    paths: [],
    nodes: legal.length,
    probes: 0,
  };
};

/** One ply is a normal transition plus its mandatory pending-decision chain. */
export const selectLookaheadDecision = (
  request: AiDecisionRequest,
): AiResult<AiLookaheadResult> => {
  const difficulty = resolveDifficultySettings(request.profile.difficulty);
  const baseline = selectStrategicDecision({ ...request, diagnosticRetention: "full" });
  if (!baseline.ok) return baseline;
  const evaluations = baseline.value.diagnostics?.evaluations ?? baseline.value.evaluations;
  const limits = {
    nodes: request.workLimits?.nodeLimit ?? difficulty.maxNodes,
    probes: request.workLimits?.probeLimit ?? difficulty.maxProbes,
  };
  let nodes = 0;
  let probes = 0;
  const paths: AiSearchPath[] = [];
  const searchValues = new Map<string, number>();
  const stateHashes = new Set<string>([canonicalHash(request.state)]);
  const candidates = [...evaluations]
    .filter((evaluation) => evaluation.pruning === "retained" || evaluation.pruning === "protected")
    .slice(0, Math.max(1, request.workLimits?.candidateLimit ?? difficulty.candidateLimit))
    .sort((left, right) => left.canonicalKey.localeCompare(right.canonicalKey));
  for (const evaluation of candidates) {
    if (!use(nodes, limits.nodes) || !use(probes, limits.probes)) break;
    if (request.analysis?.probeDecision === undefined) break;
    nodes += 1;
    probes += 1;
    const branch = createBranchCombatDependencies({
      rootSeed: request.dependencies.random.rootSeed,
      branchPath: ["root", evaluation.canonicalKey],
      fixedTime: new Date(0),
      workBudget: { maxNodes: limits.nodes - nodes, maxProbes: limits.probes - probes },
    });
    const result = request.analysis.probeDecision(request.state, evaluation.decision, branch);
    if (!result.ok) continue;
    let successor = result.value.successorState;
    const path = [evaluation.canonicalKey];
    let completed = true;
    while (
      successor.status === "active" &&
      successor.pendingDecision !== undefined &&
      use(nodes, limits.nodes) &&
      use(probes, limits.probes)
    ) {
      const pendingActor = actorForPending(successor) as AiDecisionRequest["actorId"];
      const legal = enumerateAnalysisDecisions(successor, pendingActor);
      if (legal.length === 0) {
        completed = false;
        break;
      }
      const pendingResult = selectStrategicDecision({
        ...request,
        state: successor,
        actorId: pendingActor,
        legalDecisions: legal,
        diagnosticRetention: "full",
      });
      if (!pendingResult.ok) {
        completed = false;
        break;
      }
      const pendingDecision = pendingResult.value.decision;
      nodes += 1;
      probes += 1;
      const pendingProbe = request.analysis.probeDecision(successor, pendingDecision, branch);
      if (!pendingProbe.ok) {
        completed = false;
        break;
      }
      successor = pendingProbe.value.successorState;
      path.push(canonicalDecisionKey(pendingDecision));
    }
    const stateHash = canonicalHash(successor);
    if (stateHashes.has(stateHash)) {
      completed = false;
    }
    stateHashes.add(stateHash);
    const response = responseValue(
      successor,
      request,
      request.opponentProfile ?? request.profile,
      difficulty.responseLimit,
    );
    const value = response.value;
    searchValues.set(evaluation.canonicalKey, value);
    paths.push({ path, stateHash, depth: 1, completed, value });
  }
  const ranked = [...evaluations].map((evaluation) => ({
    ...evaluation,
    searchValue: searchValues.get(evaluation.canonicalKey) ?? 0,
    totalScore: evaluation.totalScore + (searchValues.get(evaluation.canonicalKey) ?? 0),
  }));
  const ordered = ranked.sort(
    (left, right) =>
      right.totalScore - left.totalScore || left.canonicalKey.localeCompare(right.canonicalKey),
  );
  const selected = ordered[0] ?? baseline.value.evaluations[0];
  if (selected === undefined)
    return {
      ok: false,
      error: { type: "empty-legal-set", actorId: request.actorId } satisfies AiFailure,
    };
  const level = request.diagnosticRetention ?? "none";
  const usage: AiBudgetUsage = {
    candidates: {
      used: candidates.length,
      limit: request.workLimits?.candidateLimit ?? difficulty.candidateLimit,
    },
    outcomes: {
      used: candidates.reduce((total, candidate) => total + (candidate.outcomes?.length ?? 0), 0),
      limit: request.workLimits?.outcomeLimit ?? candidates.length,
    },
    nodes: { used: nodes, limit: limits.nodes },
    probes: { used: probes, limit: limits.probes },
  };
  return {
    ok: true,
    value: {
      ...baseline.value,
      decision: selected.decision,
      selectedDecision: selected.decision,
      evaluations: level === "none" ? [] : level === "selection-only" ? [selected] : ordered,
      diagnostics:
        level === "none"
          ? undefined
          : {
              ...(baseline.value.diagnostics ?? {
                schemaVersion: "ai-decision-diagnostics:v2" as const,
                level,
                stateVersion: request.state.version,
                profileVersion: request.profile.identity.version,
                evaluator: { id: "ai-evaluator:strategic-lookahead", version: "lookahead:v1" },
                selectedCanonicalKey: selected.canonicalKey,
              }),
              selectedCanonicalKey: selected.canonicalKey,
              budget: usage,
              searchPaths: paths,
            },
    },
  };
};

export const selectWithLookahead = selectLookaheadDecision;
