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
  "simulation-move-coverage-artifact:v2" as const;

export type SimulationCoverageArtifactErrorType =
  SimulationFailure["type"] | "invalid-fixture" | "runner-failure";

export interface SimulationCoverageArtifactError {
  readonly moveId: string;
  readonly runId: string;
  readonly type: SimulationCoverageArtifactErrorType;
  readonly detail: string;
}

export type SimulationMoveMetricsByPopulation = Readonly<
  Record<SimulationCoveragePopulation, Readonly<Record<string, SimulationMoveMetrics>>>
>;
export type SimulationStratifiedAccumulatorsByPopulation = Readonly<
  Record<SimulationCoveragePopulation, Readonly<Record<string, SimulationStratifiedAccumulator>>>
>;

export interface SimulationMoveCoverageArtifact {
  readonly schemaVersion: typeof SIMULATION_MOVE_COVERAGE_ARTIFACT_VERSION;
  readonly generatedFrom: Readonly<{
    readonly mechanicsIdentity: string;
    readonly scenarioFamily: string;
    readonly checkpointId: string;
    readonly targetFights: number;
    readonly minimumEligibleStates: number;
    readonly isolationRunCount: number;
    readonly population?: SimulationCoveragePopulation;
    readonly populationRunCounts?: Readonly<Record<SimulationCoveragePopulation, number>>;
    /** Attempt offsets make precision continuation idempotent per move. */
    readonly populationAttemptedFightsByMove?: Readonly<
      Record<SimulationCoveragePopulation, Readonly<Record<string, number>>>
    >;
    /** Bounded combat seeds for deterministic representative replay reruns. */
    readonly representativeReplaySeedsByMove?: Readonly<
      Record<SimulationCoveragePopulation, Readonly<Record<string, readonly number[]>>>
    >;
    readonly rootSeed?: number;
    readonly fixedTime?: string;
    readonly naturalProfileId?: string;
    readonly naturalOverlayApprovalReference?: string;
    readonly naturalPopulation: "draft" | "approved" | "observed" | "reviewed-exclusion";
    readonly mechanicPaths?: readonly ("decision" | "trigger")[];
    readonly source: string;
  }>;
  readonly dataset: SimulationMoveCoverageDataset;
  readonly coverageCells: readonly SimulationCoverageCell[];
  /** Streamed combat metrics retained separately from authoritative coverage counts. */
  readonly metricsByMove?: SimulationMoveMetricsByPopulation;
  /** Mergeable mirrored-pair statistics retained separately from fight state. */
  readonly stratifiedAccumulators?: SimulationStratifiedAccumulatorsByPopulation;
  readonly errors: readonly SimulationCoverageArtifactError[];
  readonly artifactHash: string;
}

const artifactMetadataSchema = z
  .object({
    mechanicsIdentity: z.string().min(1),
    scenarioFamily: z.string().min(1),
    checkpointId: z.string().min(1),
    targetFights: z.number().int().positive().max(10_000),
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
    naturalPopulation: z.enum(["draft", "approved", "observed", "reviewed-exclusion"]),
    mechanicPaths: z
      .array(z.enum(["decision", "trigger"]))
      .min(1)
      .optional(),
    source: z.string().min(1),
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
    stratifiedAccumulators: z
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

export const createSimulationMoveCoverageArtifact = (input: {
  readonly generatedFrom: SimulationMoveCoverageArtifact["generatedFrom"];
  readonly dataset: SimulationMoveCoverageDataset;
  readonly coverageCells: readonly SimulationCoverageCell[];
  readonly metricsByMove?: SimulationMoveMetricsByPopulation;
  readonly stratifiedAccumulators?: SimulationStratifiedAccumulatorsByPopulation;
  readonly errors?: readonly SimulationCoverageArtifactError[];
}): SimulationMoveCoverageArtifact => {
  if (input.generatedFrom.mechanicsIdentity !== input.dataset.mechanicsIdentity)
    throw new RangeError("Coverage artifact mechanics identity does not match its dataset.");
  const generatedFrom = {
    ...input.generatedFrom,
    mechanicPaths: input.generatedFrom.mechanicPaths ?? ["decision", "trigger"],
  };
  const artifact = {
    schemaVersion: SIMULATION_MOVE_COVERAGE_ARTIFACT_VERSION,
    generatedFrom,
    dataset: input.dataset,
    coverageCells: Object.freeze([...input.coverageCells]),
    ...(input.metricsByMove === undefined ? {} : { metricsByMove: input.metricsByMove }),
    ...(input.stratifiedAccumulators === undefined
      ? {}
      : { stratifiedAccumulators: input.stratifiedAccumulators }),
    errors: Object.freeze([...(input.errors ?? [])]),
    artifactHash: canonicalHash({
      generatedFrom,
      dataset: input.dataset,
      coverageCells: input.coverageCells,
      metricsByMove: input.metricsByMove,
      stratifiedAccumulators: input.stratifiedAccumulators,
      errors: input.errors ?? [],
    }),
  } satisfies SimulationMoveCoverageArtifact;
  return simulationMoveCoverageArtifactSchema.parse(artifact);
};

export const validateSimulationMoveCoverageArtifact = (
  artifact: SimulationMoveCoverageArtifact,
): readonly string[] => {
  const issues: string[] = [];
  if (artifact.dataset.mechanicsIdentity !== artifact.generatedFrom.mechanicsIdentity)
    issues.push("Coverage artifact dataset identity does not match its manifest identity.");
  const expectedHash = canonicalHash({
    generatedFrom: artifact.generatedFrom,
    dataset: artifact.dataset,
    coverageCells: artifact.coverageCells,
    metricsByMove: artifact.metricsByMove,
    stratifiedAccumulators: artifact.stratifiedAccumulators,
    errors: artifact.errors,
  });
  if (artifact.artifactHash !== expectedHash)
    issues.push("Coverage artifact hash is stale or invalid.");
  const expectedDatasetHash = canonicalHash({
    mechanicsIdentity: artifact.dataset.mechanicsIdentity,
    records: artifact.dataset.records,
  });
  if (artifact.dataset.datasetHash !== expectedDatasetHash)
    issues.push("Coverage dataset hash is stale or invalid.");
  issues.push(...validateSimulationCoverageCells(artifact.coverageCells));
  return issues;
};
