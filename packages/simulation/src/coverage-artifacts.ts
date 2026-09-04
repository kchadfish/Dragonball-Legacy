import { z } from "zod";

import { canonicalHash } from "./canonical.js";
import {
  simulationCoverageCellSchema,
  validateSimulationCoverageCells,
  type SimulationCoverageCell,
} from "./coverage.js";
import {
  simulationMoveCoverageDatasetSchema,
  type SimulationMoveCoverageDataset,
} from "./move-coverage.js";
import type { SimulationCoveragePopulation } from "./coverage.js";
import type { SimulationFailure } from "./contracts.js";
import { simulationMoveMetricsSchema, type SimulationMoveMetrics } from "./metrics.js";
import {
  simulationStratifiedAccumulatorSchema,
  type SimulationStratifiedAccumulator,
} from "./statistics.js";

export const SIMULATION_MOVE_COVERAGE_ARTIFACT_VERSION =
  "simulation-move-coverage-artifact:v3" as const;
export const SIMULATION_MOVE_COVERAGE_CHECKPOINT_VERSION =
  "simulation-move-coverage-checkpoint:v3" as const;

export const SIMULATION_NATURAL_POPULATION_BLOCKER =
  "Natural population coverage was not scheduled in this artifact; run the natural AI population separately with the repository-authoritative TF1 source.";

export type SimulationCoverageArtifactErrorType =
  SimulationFailure["type"] | "invalid-fixture" | "runner-failure";

export interface SimulationCoverageArtifactError {
  readonly moveId: string;
  readonly runId: string;
  /** Population ownership was added in v2.1; omitted values remain readable for legacy artifacts. */
  readonly population?: SimulationCoveragePopulation;
  readonly type: SimulationCoverageArtifactErrorType;
  readonly detail: string;
}

export type SimulationMoveMetricsByPopulation = Readonly<
  Record<SimulationCoveragePopulation, Readonly<Record<string, SimulationMoveMetrics>>>
>;
export type SimulationStratifiedAccumulatorsByPopulation = Readonly<
  Record<SimulationCoveragePopulation, Readonly<Record<string, SimulationStratifiedAccumulator>>>
>;
export type SimulationMetricsByStratum = Readonly<Record<string, SimulationMoveMetrics>>;
export type SimulationStratifiedAccumulatorsByStratum = Readonly<
  Record<string, SimulationStratifiedAccumulator>
>;

export interface SimulationMoveCoverageArtifact {
  readonly schemaVersion: typeof SIMULATION_MOVE_COVERAGE_ARTIFACT_VERSION;
  readonly generatedFrom: Readonly<{
    readonly mechanicsIdentity: string;
    readonly scenarioFamily: string;
    readonly checkpointId: string;
    readonly targetPairs: number;
    readonly minimumEligibleStates: number;
    readonly isolationRunCount: number;
    readonly population?: SimulationCoveragePopulation;
    readonly populationRunCounts?: Readonly<Record<SimulationCoveragePopulation, number>>;
    /** Attempt offsets make precision continuation idempotent per move. */
    readonly populationAttemptedFightsByMove?: Readonly<
      Record<SimulationCoveragePopulation, Readonly<Record<string, number>>>
    >;
    /** Per-context attempt offsets preserve deterministic continuation when only some contexts remain incomplete. */
    readonly populationAttemptedFightsByMoveAndContext?: Readonly<
      Record<
        SimulationCoveragePopulation,
        Readonly<Record<string, Readonly<Record<string, number>>>>
      >
    >;
    /** Bounded combat seeds for deterministic representative replay reruns. */
    readonly representativeReplaySeedsByMove?: Readonly<
      Record<SimulationCoveragePopulation, Readonly<Record<string, readonly number[]>>>
    >;
    readonly rootSeed?: number;
    readonly fixedTime?: string;
    readonly naturalProfileId?: string;
    readonly naturalOverlayApprovalReference?: string;
    readonly naturalOverlayAuthority?: "repository" | "external-approval";
    readonly sourceLimitations?: readonly string[];
    readonly exposureContexts?: readonly (
      "target-present" | "target-removed" | "comparable-replacement"
    )[];
    readonly naturalPopulation: "draft" | "approved" | "observed" | "reviewed-exclusion";
    readonly naturalPopulationBlocker?: string;
    readonly mechanicPaths?: readonly ("decision" | "trigger")[];
    readonly source: string;
    readonly checkpoint?: Readonly<{
      readonly schemaVersion: typeof SIMULATION_MOVE_COVERAGE_CHECKPOINT_VERSION;
      readonly batchSize: 25;
      readonly completedBatchCount: number;
      readonly checkpointHash: string;
    }>;
    /** Compatibility alias; omitted from serialized v3 artifacts. */
    readonly targetFights?: number;
  }>;
  readonly dataset: SimulationMoveCoverageDataset;
  readonly coverageCells: readonly SimulationCoverageCell[];
  /** Streamed combat metrics retained separately from authoritative coverage counts. */
  readonly metricsByMove?: SimulationMoveMetricsByPopulation;
  /** v3 metrics retain the complete population/profile/exposure stratum key. */
  readonly metricsByStratum?: Readonly<
    Record<SimulationCoveragePopulation, SimulationMetricsByStratum>
  >;
  /** Mergeable mirrored-pair statistics retained separately from fight state. */
  readonly stratifiedAccumulators?: SimulationStratifiedAccumulatorsByPopulation;
  readonly stratifiedAccumulatorsByStratum?: Readonly<
    Record<SimulationCoveragePopulation, SimulationStratifiedAccumulatorsByStratum>
  >;
  readonly errors: readonly SimulationCoverageArtifactError[];
  readonly artifactHash: string;
}

const artifactMetadataSchema = z
  .object({
    mechanicsIdentity: z.string().min(1),
    scenarioFamily: z.string().min(1),
    checkpointId: z.string().min(1),
    targetPairs: z.number().int().positive().max(10_000),
    minimumEligibleStates: z.number().int().positive(),
    isolationRunCount: z.number().int().positive(),
    population: z.enum(["natural", "isolation", "forced"]).optional(),
    populationRunCounts: z
      .object({
        natural: z.number().int().nonnegative(),
        isolation: z.number().int().nonnegative(),
        forced: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    populationAttemptedFightsByMove: z
      .object({
        natural: z.record(z.string(), z.number().int().nonnegative()),
        isolation: z.record(z.string(), z.number().int().nonnegative()),
        forced: z.record(z.string(), z.number().int().nonnegative()),
      })
      .strict()
      .optional(),
    populationAttemptedFightsByMoveAndContext: z
      .object({
        natural: z.record(z.string(), z.record(z.string(), z.number().int().nonnegative())),
        isolation: z.record(z.string(), z.record(z.string(), z.number().int().nonnegative())),
        forced: z.record(z.string(), z.record(z.string(), z.number().int().nonnegative())),
      })
      .strict()
      .optional(),
    representativeReplaySeedsByMove: z
      .object({
        natural: z.record(
          z.string(),
          z.array(z.number().int().nonnegative().max(4_294_967_295)).max(8),
        ),
        isolation: z.record(
          z.string(),
          z.array(z.number().int().nonnegative().max(4_294_967_295)).max(8),
        ),
        forced: z.record(
          z.string(),
          z.array(z.number().int().nonnegative().max(4_294_967_295)).max(8),
        ),
      })
      .strict()
      .optional(),
    rootSeed: z.number().int().nonnegative().max(4_294_967_295).optional(),
    fixedTime: z.iso.datetime({ offset: true }).optional(),
    naturalProfileId: z.string().min(1).optional(),
    naturalOverlayApprovalReference: z.string().min(1).optional(),
    naturalOverlayAuthority: z.enum(["repository", "external-approval"]).optional(),
    sourceLimitations: z.array(z.string().min(1)).optional(),
    exposureContexts: z
      .array(z.enum(["target-present", "target-removed", "comparable-replacement"]))
      .min(1)
      .optional(),
    naturalPopulation: z.enum(["draft", "approved", "observed", "reviewed-exclusion"]),
    naturalPopulationBlocker: z.string().min(1).optional(),
    mechanicPaths: z
      .array(z.enum(["decision", "trigger"]))
      .min(1)
      .optional(),
    source: z.string().min(1),
    checkpoint: z
      .object({
        schemaVersion: z.literal(SIMULATION_MOVE_COVERAGE_CHECKPOINT_VERSION),
        batchSize: z.literal(25),
        completedBatchCount: z.number().int().nonnegative(),
        checkpointHash: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict();

export const simulationMoveCoverageArtifactSchema = z
  .object({
    schemaVersion: z.literal(SIMULATION_MOVE_COVERAGE_ARTIFACT_VERSION),
    generatedFrom: artifactMetadataSchema,
    dataset: simulationMoveCoverageDatasetSchema,
    coverageCells: z.array(simulationCoverageCellSchema),
    metricsByMove: z
      .object({
        natural: z.record(z.string().min(1), simulationMoveMetricsSchema),
        isolation: z.record(z.string().min(1), simulationMoveMetricsSchema),
        forced: z.record(z.string().min(1), simulationMoveMetricsSchema),
      })
      .strict()
      .optional(),
    metricsByStratum: z
      .object({
        natural: z.record(z.string().min(1), simulationMoveMetricsSchema),
        isolation: z.record(z.string().min(1), simulationMoveMetricsSchema),
        forced: z.record(z.string().min(1), simulationMoveMetricsSchema),
      })
      .strict()
      .optional(),
    stratifiedAccumulators: z
      .object({
        natural: z.record(z.string().min(1), simulationStratifiedAccumulatorSchema),
        isolation: z.record(z.string().min(1), simulationStratifiedAccumulatorSchema),
        forced: z.record(z.string().min(1), simulationStratifiedAccumulatorSchema),
      })
      .strict()
      .optional(),
    stratifiedAccumulatorsByStratum: z
      .object({
        natural: z.record(z.string().min(1), simulationStratifiedAccumulatorSchema),
        isolation: z.record(z.string().min(1), simulationStratifiedAccumulatorSchema),
        forced: z.record(z.string().min(1), simulationStratifiedAccumulatorSchema),
      })
      .strict()
      .optional(),
    errors: z.array(
      z
        .object({
          moveId: z.string().min(1),
          runId: z.string().min(1),
          population: z.enum(["natural", "isolation", "forced"]).optional(),
          type: z.enum([
            "malformed-input",
            "unknown-reference",
            "incompatible-loadout",
            "unsupported-scope",
            "combat-failure",
            "ai-failure",
            "exhausted-safeguard",
            "cancelled",
            "unexpected-runner-failure",
            "invalid-fixture",
            "runner-failure",
          ]),
          detail: z.string().min(1),
        })
        .strict(),
    ),
    artifactHash: z.string().min(1),
  })
  .strict();

const legacyStatusForArtifactCell = (
  cell: SimulationCoverageCell,
): SimulationCoverageCell["status"] => {
  if (cell.samplingStatus === "failed") {
    if (cell.failureType === "invalid-fixture") return "invalid-fixture";
    return "runner-failure";
  }
  if (cell.samplingStatus === "excluded") return "excluded";
  if (cell.observationStatus === "never-eligible") return "never-eligible";
  if (cell.samplingStatus === "sufficient" && cell.population === "natural")
    return "observed-sufficient";
  if (cell.observationStatus === "eligible-never-selected") return "eligible-never-selected";
  if (cell.samplingStatus === "not-applicable") return "not-scheduled";
  if (cell.samplingStatus === "not-started") return "unobserved";
  return "observed-low-sample";
};

export const createSimulationMoveCoverageArtifact = (input: {
  readonly generatedFrom: Omit<
    SimulationMoveCoverageArtifact["generatedFrom"],
    "targetPairs" | "targetFights"
  > & { readonly targetPairs?: number; readonly targetFights?: number };
  readonly dataset: SimulationMoveCoverageDataset;
  readonly coverageCells: readonly SimulationCoverageCell[];
  readonly metricsByMove?: SimulationMoveMetricsByPopulation;
  readonly metricsByStratum?: Readonly<
    Record<SimulationCoveragePopulation, SimulationMetricsByStratum>
  >;
  readonly stratifiedAccumulators?: SimulationStratifiedAccumulatorsByPopulation;
  readonly stratifiedAccumulatorsByStratum?: Readonly<
    Record<SimulationCoveragePopulation, SimulationStratifiedAccumulatorsByStratum>
  >;
  readonly errors?: readonly SimulationCoverageArtifactError[];
}): SimulationMoveCoverageArtifact => {
  if (input.generatedFrom.mechanicsIdentity !== input.dataset.mechanicsIdentity)
    throw new RangeError("Coverage artifact mechanics identity does not match its dataset.");
  if (
    input.generatedFrom.targetPairs !== undefined &&
    input.generatedFrom.targetFights !== undefined
  )
    throw new RangeError(
      "Coverage accepts either targetPairs or deprecated targetFights, not both.",
    );
  const targetPairs = input.generatedFrom.targetPairs ?? input.generatedFrom.targetFights;
  if (targetPairs === undefined)
    throw new RangeError("Coverage artifacts require a target pair count.");
  const canonicalGeneratedFrom = { ...input.generatedFrom };
  delete canonicalGeneratedFrom.targetFights;
  const completedBatchCount = Math.max(
    0,
    ...input.coverageCells.map((cell) =>
      Math.floor(
        (cell.completedFights + (cell.population === "forced" ? cell.coverageSatisfiedRuns : 0)) /
          2 /
          25,
      ),
    ),
  );
  const generatedFrom = {
    ...canonicalGeneratedFrom,
    targetPairs,
    mechanicPaths: input.generatedFrom.mechanicPaths ?? ["decision", "trigger"],
    checkpoint: input.generatedFrom.checkpoint ?? {
      schemaVersion: SIMULATION_MOVE_COVERAGE_CHECKPOINT_VERSION,
      batchSize: 25 as const,
      completedBatchCount,
      checkpointHash: canonicalHash({ batchSize: 25, completedBatchCount }),
    },
  };
  const artifact = {
    schemaVersion: SIMULATION_MOVE_COVERAGE_ARTIFACT_VERSION,
    generatedFrom,
    dataset: input.dataset,
    coverageCells: Object.freeze([...input.coverageCells]),
    ...(input.metricsByMove === undefined ? {} : { metricsByMove: input.metricsByMove }),
    ...(input.metricsByStratum === undefined ? {} : { metricsByStratum: input.metricsByStratum }),
    ...(input.stratifiedAccumulators === undefined
      ? {}
      : { stratifiedAccumulators: input.stratifiedAccumulators }),
    ...(input.stratifiedAccumulatorsByStratum === undefined
      ? {}
      : { stratifiedAccumulatorsByStratum: input.stratifiedAccumulatorsByStratum }),
    errors: Object.freeze([...(input.errors ?? [])]),
    artifactHash: canonicalHash({
      generatedFrom,
      dataset: input.dataset,
      coverageCells: input.coverageCells,
      metricsByMove: input.metricsByMove,
      metricsByStratum: input.metricsByStratum,
      stratifiedAccumulators: input.stratifiedAccumulators,
      stratifiedAccumulatorsByStratum: input.stratifiedAccumulatorsByStratum,
      errors: input.errors ?? [],
    }),
  } satisfies SimulationMoveCoverageArtifact;
  const parsed = simulationMoveCoverageArtifactSchema.parse(
    artifact,
  ) as unknown as SimulationMoveCoverageArtifact;
  for (const cell of parsed.coverageCells)
    Object.defineProperties(cell, {
      targetFights: { value: cell.targetPairs, enumerable: false },
      status: {
        value: legacyStatusForArtifactCell(cell),
        enumerable: false,
      },
    });
  Object.defineProperty(parsed.generatedFrom, "targetFights", {
    value: targetPairs,
    enumerable: false,
  });
  return parsed;
};

export const validateSimulationMoveCoverageArtifact = (
  artifact: SimulationMoveCoverageArtifact,
): readonly string[] => {
  const issues: string[] = [];
  if (artifact.schemaVersion !== SIMULATION_MOVE_COVERAGE_ARTIFACT_VERSION)
    issues.push("Coverage artifacts must use simulation-move-coverage-artifact:v3.");
  const allowsNaturalNotScheduled =
    artifact.generatedFrom.naturalPopulation === "draft" &&
    artifact.generatedFrom.naturalPopulationBlocker !== undefined;
  if (artifact.dataset.mechanicsIdentity !== artifact.generatedFrom.mechanicsIdentity)
    issues.push("Coverage artifact dataset identity does not match its manifest identity.");
  const expectedHash = canonicalHash({
    generatedFrom: artifact.generatedFrom,
    dataset: artifact.dataset,
    coverageCells: artifact.coverageCells,
    metricsByMove: artifact.metricsByMove,
    metricsByStratum: artifact.metricsByStratum,
    stratifiedAccumulators: artifact.stratifiedAccumulators,
    stratifiedAccumulatorsByStratum: artifact.stratifiedAccumulatorsByStratum,
    errors: artifact.errors,
  });
  if (artifact.artifactHash !== expectedHash)
    issues.push("Coverage artifact hash is stale or invalid.");
  if (
    artifact.generatedFrom.checkpoint !== undefined &&
    artifact.generatedFrom.checkpoint.checkpointHash !==
      canonicalHash({
        batchSize: artifact.generatedFrom.checkpoint.batchSize,
        completedBatchCount: artifact.generatedFrom.checkpoint.completedBatchCount,
      })
  )
    issues.push("Coverage checkpoint hash is stale or invalid.");
  const expectedDatasetHash = canonicalHash({
    mechanicsIdentity: artifact.dataset.mechanicsIdentity,
    records: artifact.dataset.records,
  });
  if (artifact.dataset.datasetHash !== expectedDatasetHash)
    issues.push("Coverage dataset hash is stale or invalid.");
  issues.push(
    ...validateSimulationCoverageCells(artifact.coverageCells, {
      allowNaturalNotScheduled: allowsNaturalNotScheduled,
    }),
  );
  return issues;
};
