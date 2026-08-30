/* eslint-disable sonarjs/no-nested-conditional, sonarjs/cognitive-complexity, complexity, max-lines-per-function, sonarjs/no-redundant-optional, sonarjs/no-alphabetical-sort, sonarjs/no-nested-template-literals */
import type {
  AiDecisionRequest,
  AiDecisionResult,
  CandidateEvaluation,
  DiagnosticRetention,
} from "./contracts.js";
import { canonicalDecisionKey } from "@dragonball-resurgence/combat-engine";
import { canonicalHash, canonicalJson, canonicalLegalSetHash } from "./canonicalization.js";
import { selectLegalDecision } from "./immediate-utility.js";

export interface AiReplayRecord {
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
  readonly mechanics: { readonly version: string; readonly hash: string };
  readonly engine: { readonly version: string; readonly evaluator: string };
  readonly profile: { readonly id: string; readonly version: string; readonly hash: string };
  readonly seed: number;
  readonly budgets: AiDecisionRequest["workLimits"];
  readonly selectedDecisionKey: string;
  readonly rankingHash: string;
  readonly diagnosticRetention: DiagnosticRetention;
  readonly diagnostics?: AiDecisionResult["diagnostics"];
}

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
  | "seed"
  | "budgets"
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
): AiReplayRecord => {
  const evaluations = result.diagnostics?.evaluations ?? result.evaluations;
  const state = request.state;
  return {
    schemaVersion: "ai-replay:v1",
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
    mechanics: { version: request.mechanics.version, hash: canonicalHash(request.mechanics) },
    engine: { version: "ai-engine:v1", evaluator: result.diagnostics?.evaluator.id ?? "unknown" },
    profile: {
      id: request.profile.identity.id,
      version: request.profile.identity.version,
      hash: canonicalHash(request.profile),
    },
    seed: request.dependencies.random.rootSeed,
    budgets: request.workLimits,
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
  const expected = createAiReplayRecord(request, {
    decision: request.legalDecisions[0]!,
    selectedDecision: request.legalDecisions[0]!,
    evaluations: [],
  });
  const mismatches: ReplayMismatch[] = [];
  if (record.schemaVersion !== "ai-replay:v1")
    mismatches.push(mismatch("schema-version", "ai-replay:v1", record.schemaVersion));
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
  if (record.seed !== expected.seed) mismatches.push(mismatch("seed", record.seed, expected.seed));
  if (canonicalJson(record.budgets) !== canonicalJson(expected.budgets))
    mismatches.push(mismatch("budgets", record.budgets, expected.budgets));
  if (mismatches.length > 0) return { ok: false, mismatches };
  const rerun = selectLegalDecision({ ...request, diagnosticRetention: "full" });
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
