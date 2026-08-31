/* eslint-disable sonarjs/no-nested-conditional, sonarjs/cognitive-complexity, complexity, max-lines-per-function, sonarjs/no-redundant-optional, sonarjs/no-alphabetical-sort, sonarjs/no-nested-template-literals */
import type {
  AiDecisionRequest,
  AiDecisionResult,
  AiWorkLimits,
  AiEffectiveAnalysisCapabilities,
  CandidateEvaluation,
  DiagnosticRetention,
} from "./contracts.js";
import {
  canonicalDecisionKey,
  type MechanicsViewIdentity,
} from "@dragonball-resurgence/combat-engine";
import { canonicalHash, canonicalJson, canonicalLegalSetHash } from "./canonicalization.js";
import { selectAiDecision } from "./selection.js";
import { resolveDifficultySettings } from "./profiles.js";
import { resolveEffectiveAiAnalysisCapabilities } from "./capabilities.js";

export interface AiReplayRecordV1 {
  readonly schemaVersion: "ai-replay:v1";
  readonly fight: {
    readonly id: string;
    readonly snapshotSchemaVersion: number;
    readonly stateVersion: number;
    readonly stateHash: string;
    readonly snapshot?: unknown;
  };
  readonly rulesVersion: unknown;
  readonly actorId: string;
  readonly legalSet: { readonly keys: readonly string[]; readonly hash: string };
  readonly mechanics: {
    readonly version: string;
    readonly hash: string;
    readonly identity?: MechanicsViewIdentity;
  };
  readonly engine: { readonly version: string; readonly evaluator: string };
  readonly profile: { readonly id: string; readonly version: string; readonly hash: string };
  readonly seed: number;
  readonly budgets: AiDecisionRequest["workLimits"];
  readonly selectedDecisionKey: string;
  readonly rankingHash: string;
  readonly diagnosticRetention: DiagnosticRetention;
  readonly diagnostics?: AiDecisionResult["diagnostics"];
}

export interface AiReplayRecordV3 {
  readonly schemaVersion: "ai-replay:v3";
  readonly fight: AiReplayRecordV1["fight"];
  readonly rulesVersion: unknown;
  readonly actorId: string;
  readonly legalSet: AiReplayRecordV1["legalSet"];
  readonly mechanics: AiReplayRecordV1["mechanics"];
  readonly pipeline: {
    readonly id: "ai-engine";
    readonly version: "ai-engine:v3";
    readonly evaluator: string;
  };
  readonly profile: AiReplayRecordV1["profile"];
  readonly opponentProfile?: AiReplayRecordV1["profile"];
  readonly advisoryModifiers: { readonly version?: string; readonly hash: string };
  readonly advisoryHints: "enabled" | "disabled";
  readonly effectiveAnalysisCapabilities: AiEffectiveAnalysisCapabilities;
  readonly randomnessMode: "enabled" | "disabled";
  readonly workLimits: AiWorkLimits;
  readonly seed: number;
  readonly selectedDecisionKey: string;
  readonly rankingHash: string;
  readonly diagnosticRetention: DiagnosticRetention;
  readonly diagnostics?: AiDecisionResult["diagnostics"];
}

export type AiReplayRecordV2 = Omit<
  AiReplayRecordV3,
  "schemaVersion" | "pipeline" | "advisoryHints" | "effectiveAnalysisCapabilities"
> & {
  readonly schemaVersion: "ai-replay:v2";
  readonly pipeline: {
    readonly id: "ai-engine";
    readonly version: "ai-engine:v2";
    readonly evaluator: string;
  };
};

export type AiReplayRecord = AiReplayRecordV1 | AiReplayRecordV2 | AiReplayRecordV3;

export type ReplayMismatchCode =
  | "schema-version"
  | "fight-id"
  | "snapshot-schema"
  | "state-version"
  | "state-hash"
  | "rules-version"
  | "actor"
  | "legal-set"
  | "mechanics"
  | "profile"
  | "pipeline"
  | "opponent-profile"
  | "advisory-modifiers"
  | "advisory-hints"
  | "analysis-capabilities"
  | "randomness-mode"
  | "seed"
  | "work-limits"
  | "selected-decision"
  | "ranking";

export interface ReplayMismatch {
  readonly code: ReplayMismatchCode;
  readonly expected: string;
  readonly actual: string;
}

export type ReplayVerificationResult =
  | { readonly ok: true; readonly decisionKey: string }
  | { readonly ok: false; readonly mismatches: readonly ReplayMismatch[] };

const rankingHashFor = (evaluations: readonly CandidateEvaluation[]): string =>
  canonicalHash(
    evaluations.map((evaluation) => ({
      key: evaluation.canonicalKey,
      rank: evaluation.rank,
      score: evaluation.totalScore,
      factors: evaluation.scoreFactors,
      pruning: evaluation.pruning,
      searchValue: evaluation.searchValue,
    })),
  );

export const createAiReplayRecord = (
  request: AiDecisionRequest,
  result: AiDecisionResult,
  options: { readonly includeSnapshot?: boolean } = {},
): AiReplayRecordV3 => {
  const completeResult =
    result.evaluations.length > 0 || result.diagnostics?.evaluations !== undefined
      ? result
      : (() => {
          const rerun = selectAiDecision({ ...request, diagnosticRetention: "full" });
          return rerun.ok ? rerun.value : result;
        })();
  const evaluations = completeResult.diagnostics?.evaluations ?? completeResult.evaluations;
  const state = request.state;
  const difficulty = resolveDifficultySettings(request.profile.difficulty);
  const workLimits: AiWorkLimits = {
    candidateLimit: request.workLimits?.candidateLimit ?? difficulty.candidateLimit,
    outcomeLimit: request.workLimits?.outcomeLimit ?? Number.MAX_SAFE_INTEGER,
    nodeLimit: request.workLimits?.nodeLimit ?? difficulty.maxNodes,
    probeLimit: request.workLimits?.probeLimit ?? difficulty.maxProbes,
  };
  return {
    schemaVersion: "ai-replay:v3",
    fight: {
      id: state.id,
      snapshotSchemaVersion: state.schemaVersion ?? 0,
      stateVersion: state.version,
      stateHash: canonicalHash(state),
      ...(options.includeSnapshot ? { snapshot: state } : {}),
    },
    rulesVersion: state.rulesVersion,
    actorId: request.actorId,
    legalSet: {
      keys: request.legalDecisions.map((decision) => canonicalJson(decision)).sort(),
      hash: canonicalLegalSetHash(request.legalDecisions),
    },
    mechanics: {
      version: request.mechanics.version,
      hash: canonicalHash(request.mechanics),
      ...(request.mechanics.identity === undefined ? {} : { identity: request.mechanics.identity }),
    },
    pipeline: {
      id: "ai-engine",
      version: "ai-engine:v3",
      evaluator: completeResult.diagnostics?.evaluator.id ?? "unknown",
    },
    profile: {
      id: request.profile.identity.id,
      version: request.profile.identity.version,
      hash: canonicalHash(request.profile),
    },
    ...(request.opponentProfile === undefined
      ? {}
      : {
          opponentProfile: {
            id: request.opponentProfile.identity.id,
            version: request.opponentProfile.identity.version,
            hash: canonicalHash(request.opponentProfile),
          },
        }),
    advisoryModifiers: {
      ...(request.advisoryPriorities === undefined
        ? {}
        : { version: request.advisoryPriorities.version }),
      hash: canonicalHash(request.advisoryPriorities ?? { modifiers: [] }),
    },
    advisoryHints: request.advisoryHints ?? "enabled",
    effectiveAnalysisCapabilities: resolveEffectiveAiAnalysisCapabilities(request),
    randomnessMode: request.dependencies.randomness ?? "enabled",
    workLimits,
    seed: request.dependencies.random.rootSeed,
    selectedDecisionKey: canonicalDecisionKey(result.selectedDecision),
    rankingHash: rankingHashFor(evaluations),
    diagnosticRetention: request.diagnosticRetention ?? "none",
    ...(result.diagnostics === undefined ? {} : { diagnostics: result.diagnostics }),
  };
};

const mismatch = (
  code: ReplayMismatchCode,
  expected: unknown,
  actual: unknown,
): ReplayMismatch => ({
  code,
  expected: canonicalJson(expected),
  actual: canonicalJson(actual),
});

export const verifyAiReplayRecord = (
  record: AiReplayRecord,
  request: AiDecisionRequest,
): ReplayVerificationResult => {
  if (record.schemaVersion !== "ai-replay:v3")
    return {
      ok: false,
      mismatches: [mismatch("schema-version", "ai-replay:v3", record.schemaVersion)],
    };
  const expected = createAiReplayRecord(request, {
    decision: request.legalDecisions[0]!,
    selectedDecision: request.legalDecisions[0]!,
    evaluations: [],
  });
  const mismatches: ReplayMismatch[] = [];
  if (record.fight.id !== expected.fight.id)
    mismatches.push(mismatch("fight-id", record.fight.id, expected.fight.id));
  if (record.fight.snapshotSchemaVersion !== expected.fight.snapshotSchemaVersion)
    mismatches.push(
      mismatch(
        "snapshot-schema",
        record.fight.snapshotSchemaVersion,
        expected.fight.snapshotSchemaVersion,
      ),
    );
  if (record.fight.stateVersion !== expected.fight.stateVersion)
    mismatches.push(
      mismatch("state-version", record.fight.stateVersion, expected.fight.stateVersion),
    );
  if (record.fight.stateHash !== expected.fight.stateHash)
    mismatches.push(mismatch("state-hash", record.fight.stateHash, expected.fight.stateHash));
  if (canonicalJson(record.rulesVersion) !== canonicalJson(expected.rulesVersion))
    mismatches.push(mismatch("rules-version", record.rulesVersion, expected.rulesVersion));
  if (record.actorId !== expected.actorId)
    mismatches.push(mismatch("actor", record.actorId, expected.actorId));
  if (record.legalSet.hash !== expected.legalSet.hash)
    mismatches.push(mismatch("legal-set", record.legalSet.hash, expected.legalSet.hash));
  if (
    record.mechanics.hash !== expected.mechanics.hash ||
    record.mechanics.version !== expected.mechanics.version
  )
    mismatches.push(mismatch("mechanics", record.mechanics, expected.mechanics));
  if (
    record.profile.hash !== expected.profile.hash ||
    record.profile.version !== expected.profile.version
  )
    mismatches.push(mismatch("profile", record.profile, expected.profile));
  if (
    record.pipeline.id !== expected.pipeline.id ||
    record.pipeline.version !== expected.pipeline.version
  )
    mismatches.push(mismatch("pipeline", record.pipeline, expected.pipeline));
  if (canonicalJson(record.opponentProfile) !== canonicalJson(expected.opponentProfile))
    mismatches.push(mismatch("opponent-profile", record.opponentProfile, expected.opponentProfile));
  if (canonicalJson(record.advisoryModifiers) !== canonicalJson(expected.advisoryModifiers))
    mismatches.push(
      mismatch("advisory-modifiers", record.advisoryModifiers, expected.advisoryModifiers),
    );
  if (record.advisoryHints !== expected.advisoryHints)
    mismatches.push(mismatch("advisory-hints", record.advisoryHints, expected.advisoryHints));
  if (
    canonicalJson(record.effectiveAnalysisCapabilities) !==
    canonicalJson(expected.effectiveAnalysisCapabilities)
  )
    mismatches.push(
      mismatch(
        "analysis-capabilities",
        record.effectiveAnalysisCapabilities,
        expected.effectiveAnalysisCapabilities,
      ),
    );
  if (record.randomnessMode !== expected.randomnessMode)
    mismatches.push(mismatch("randomness-mode", record.randomnessMode, expected.randomnessMode));
  if (record.seed !== expected.seed) mismatches.push(mismatch("seed", record.seed, expected.seed));
  if (canonicalJson(record.workLimits) !== canonicalJson(expected.workLimits))
    mismatches.push(mismatch("work-limits", record.workLimits, expected.workLimits));
  if (mismatches.length > 0) return { ok: false, mismatches };
  const rerun = selectAiDecision({ ...request, diagnosticRetention: "full" });
  if (!rerun.ok)
    return {
      ok: false,
      mismatches: [mismatch("selected-decision", "successful replay", rerun.error)],
    };
  const rerunRecord = createAiReplayRecord(request, rerun.value);
  if (record.selectedDecisionKey !== rerunRecord.selectedDecisionKey)
    mismatches.push(
      mismatch("selected-decision", record.selectedDecisionKey, rerunRecord.selectedDecisionKey),
    );
  if (record.rankingHash !== rerunRecord.rankingHash)
    mismatches.push(mismatch("ranking", record.rankingHash, rerunRecord.rankingHash));
  return mismatches.length === 0
    ? { ok: true, decisionKey: record.selectedDecisionKey }
    : { ok: false, mismatches };
};

export const renderAiExplanation = (
  result: Pick<AiDecisionResult, "selectedDecision" | "evaluations" | "diagnostics">,
): string => {
  const selectedKey =
    result.diagnostics?.selectedCanonicalKey ??
    result.evaluations.find((evaluation) => evaluation.rank === 1)?.canonicalKey ??
    "unknown";
  const selected = result.evaluations.find((evaluation) => evaluation.canonicalKey === selectedKey);
  if (selected === undefined) return `Selected decision: ${selectedKey}.`;
  const factors = selected.scoreFactors
    .map((factor) => `${factor.code}=${factor.value}`)
    .join(", ");
  const outcomes = selected.outcomes
    ?.map((outcome) => `${outcome.category}:${outcome.probability}`)
    .join(", ");
  return `Selected ${selected.canonicalKey} with score ${selected.totalScore}. Factors: ${factors || "none"}.${outcomes === undefined ? "" : ` Outcomes: ${outcomes}.`}`;
};

export const explainDecision = renderAiExplanation;
