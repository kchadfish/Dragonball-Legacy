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
import type { SimulationFailure } from "./contracts.js";

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

export interface SimulationMoveCoverageArtifact {
  readonly schemaVersion: typeof SIMULATION_MOVE_COVERAGE_ARTIFACT_VERSION;
  readonly generatedFrom: Readonly<{
    readonly mechanicsIdentity: string;
    readonly scenarioFamily: string;
    readonly checkpointId: string;
    readonly targetFights: number;
    readonly minimumEligibleStates: number;
    readonly isolationRunCount: number;
    readonly naturalPopulation: "draft" | "approved" | "observed" | "reviewed-exclusion";
    readonly mechanicPaths?: readonly ("decision" | "trigger")[];
    readonly source: string;
  }>;
  readonly dataset: SimulationMoveCoverageDataset;
  readonly coverageCells: readonly SimulationCoverageCell[];
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
    errors: Object.freeze([...(input.errors ?? [])]),
    artifactHash: canonicalHash({
      generatedFrom,
      dataset: input.dataset,
      coverageCells: input.coverageCells,
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
