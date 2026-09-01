import {
  type CustomMoveDraftId,
  type SimulationReportId,
  type SimulationRunId,
  type SimulationScenarioId,
  type SimulationSeriesId,
  type SimulationTemplateId,
  type SimulationVariantId,
} from "./ids.js";
import { z } from "zod";

export const ARTIFACT_SCHEMA_VERSIONS = Object.freeze({
  fightResult: "simulation-fight-result:v1",
  runManifest: "simulation-run-manifest:v1",
  aggregateReport: "simulation-aggregate-report:v1",
  moveBalanceRecord: "simulation-move-balance:v1",
  replayRecord: "simulation-replay:v1",
  anomalyRecord: "simulation-anomaly:v1",
  customMoveReport: "simulation-custom-move-report:v1",
});

export type ArtifactKind = keyof typeof ARTIFACT_SCHEMA_VERSIONS;
export type ArtifactSchemaVersion = (typeof ARTIFACT_SCHEMA_VERSIONS)[ArtifactKind];

export interface VersionedSimulationArtifact<TKind extends ArtifactKind = ArtifactKind> {
  readonly artifactKind: TKind;
  readonly schemaVersion: (typeof ARTIFACT_SCHEMA_VERSIONS)[TKind];
}

export interface SimulationFightResult extends VersionedSimulationArtifact<"fightResult"> {
  readonly runId: SimulationRunId;
  readonly scenarioId: SimulationScenarioId;
  readonly seriesId?: SimulationSeriesId;
  readonly iteration: number;
  readonly mirror: "original" | "mirrored";
  readonly variantId: SimulationVariantId;
  readonly seed: number;
  readonly winnerCombatantId?: string;
  readonly loserCombatantId?: string;
  readonly engineCompletionReason?: "defeat" | "surrender" | "cancelled";
  readonly simulationTerminationReason:
    | "engine-completed"
    | "maximum-turns"
    | "maximum-transitions"
    | "semantic-no-progress"
    | "cancelled"
    | "combat-failure"
    | "ai-failure"
    | "invalid-fixture"
    | "unsupported-scope";
  readonly turns: number;
  readonly transitions: number;
  readonly finalResources: Readonly<Record<string, { readonly hp: number; readonly ki: number }>>;
  readonly actionCounts: Readonly<Record<string, number>>;
  readonly stateHash: string;
  readonly eventHash: string;
  readonly decisionHash: string;
  readonly diagnosticReference?: string;
}

export interface SimulationRunManifest extends VersionedSimulationArtifact<"runManifest"> {
  readonly runId: SimulationRunId;
  readonly scope: string;
  readonly sourceCommit: string;
  readonly rootSeed: number;
  readonly seedDerivationVersion: string;
  readonly templateIds: readonly SimulationTemplateId[];
  readonly scenarioIds: readonly SimulationScenarioId[];
  readonly variantId: SimulationVariantId;
  readonly retention: "summary" | "diagnostic" | "anomaly";
  readonly canonicalInputHash: string;
}

export const simulationRunManifestSchema = z
  .object({
    artifactKind: z.literal("runManifest"),
    schemaVersion: z.literal("simulation-run-manifest:v1"),
    runId: z.string().min(1),
    scope: z.string().min(1),
    sourceCommit: z.string().min(1),
    rootSeed: z
      .number()
      .int()
      .nonnegative()
      .max(2 ** 32 - 1),
    seedDerivationVersion: z.string().min(1),
    templateIds: z.array(z.string().min(1)),
    scenarioIds: z.array(z.string().min(1)),
    variantId: z.string().min(1),
    retention: z.enum(["summary", "diagnostic", "anomaly"]),
    canonicalInputHash: z.string().min(1),
  })
  .strict();

export interface SimulationAggregateReport extends VersionedSimulationArtifact<"aggregateReport"> {
  readonly reportId: SimulationReportId;
  readonly runId: SimulationRunId;
  readonly sampleCount: number;
  readonly completedCount: number;
  readonly missingCount: number;
  readonly errorCount: number;
  readonly canonicalLogicalHash: string;
}

export interface SimulationMoveBalanceRecord extends VersionedSimulationArtifact<"moveBalanceRecord"> {
  readonly moveId: string;
  readonly catalogHash: string;
  readonly coverageStatus: "not-started" | "observed" | "excluded";
  readonly exclusionReason?: string;
}

export interface SimulationReplayArtifact extends VersionedSimulationArtifact<"replayRecord"> {
  readonly runId: SimulationRunId;
  readonly scenarioId: SimulationScenarioId;
  readonly seed: number;
  readonly decisions: readonly unknown[];
  readonly stateHashes: readonly string[];
}

export interface SimulationAnomalyRecord extends VersionedSimulationArtifact<"anomalyRecord"> {
  readonly reportId: SimulationReportId;
  readonly anomalyCode: string;
  readonly metric: string;
  readonly sampleCount: number;
  readonly representativeSeeds: readonly number[];
}

export interface CustomMoveReport extends VersionedSimulationArtifact<"customMoveReport"> {
  readonly draftId: CustomMoveDraftId;
  readonly conclusion:
    | "cannot-evaluate"
    | "insufficient-evidence"
    | "no-flag-detected"
    | "potential-balance-concern"
    | "potential-rules-concern"
    | "staff-review-required";
  readonly baselineHash: string;
  readonly variantHash: string;
  readonly unsupportedMechanics: readonly string[];
}

export type AnySimulationArtifact =
  | SimulationFightResult
  | SimulationRunManifest
  | SimulationAggregateReport
  | SimulationMoveBalanceRecord
  | SimulationReplayArtifact
  | SimulationAnomalyRecord
  | CustomMoveReport;

export type ArtifactReadResult<TArtifact extends AnySimulationArtifact> =
  | { readonly ok: true; readonly value: TArtifact }
  | {
      readonly ok: false;
      readonly error: {
        readonly type: "schema-mismatch" | "malformed-artifact";
        readonly artifactKind: ArtifactKind;
        readonly expectedSchemaVersion: ArtifactSchemaVersion;
        readonly actualSchemaVersion?: unknown;
      };
    };

/**
 * Phase 0 migration policy: old artifacts are rejected explicitly until a
 * versioned migrator is added; they are never silently reinterpreted.
 */
export const readVersionedArtifact = <TArtifact extends AnySimulationArtifact>(
  value: unknown,
  artifactKind: TArtifact["artifactKind"],
): ArtifactReadResult<TArtifact> => {
  if (value === null || typeof value !== "object")
    return {
      ok: false,
      error: {
        type: "malformed-artifact",
        artifactKind,
        expectedSchemaVersion: ARTIFACT_SCHEMA_VERSIONS[artifactKind],
      },
    };
  const candidate = value as { readonly artifactKind?: unknown; readonly schemaVersion?: unknown };
  const expectedSchemaVersion = ARTIFACT_SCHEMA_VERSIONS[artifactKind];
  if (candidate.artifactKind !== artifactKind || candidate.schemaVersion !== expectedSchemaVersion)
    return {
      ok: false,
      error: {
        type: "schema-mismatch",
        artifactKind,
        expectedSchemaVersion,
        actualSchemaVersion: candidate.schemaVersion,
      },
    };
  return { ok: true, value: value as TArtifact };
};
