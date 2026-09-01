import { z } from "zod";

import { canonicalHash } from "./canonical.js";
import { simulationCoverageCellSchema, type SimulationCoverageCell } from "./coverage.js";
import {
  simulationMoveCoverageDatasetSchema,
  type SimulationMoveCoverageDataset,
} from "./move-coverage.js";

export const SIMULATION_MOVE_COVERAGE_ARTIFACT_VERSION =
  "simulation-move-coverage-artifact:v1" as const;

export interface SimulationMoveCoverageArtifact {
  readonly schemaVersion: typeof SIMULATION_MOVE_COVERAGE_ARTIFACT_VERSION;
  readonly generatedFrom: Readonly<{
    readonly mechanicsIdentity: string;
    readonly scenarioFamily: "move-isolation";
    readonly checkpointId: string;
    readonly targetFights: number;
    readonly minimumEligibleStates: number;
    readonly isolationRunCount: number;
    readonly naturalPopulation: "reviewed-exclusion" | "observed";
    readonly source: string;
  }>;
  readonly dataset: SimulationMoveCoverageDataset;
  readonly coverageCells: readonly SimulationCoverageCell[];
  readonly artifactHash: string;
}

const artifactMetadataSchema = z
  .object({
    mechanicsIdentity: z.string().min(1),
    scenarioFamily: z.literal("move-isolation"),
    checkpointId: z.string().min(1),
    targetFights: z.number().int().positive().max(10_000),
    minimumEligibleStates: z.number().int().positive(),
    isolationRunCount: z.number().int().positive(),
    naturalPopulation: z.enum(["reviewed-exclusion", "observed"]),
    source: z.string().min(1),
  })
  .strict();

export const simulationMoveCoverageArtifactSchema = z
  .object({
    schemaVersion: z.literal(SIMULATION_MOVE_COVERAGE_ARTIFACT_VERSION),
    generatedFrom: artifactMetadataSchema,
    dataset: simulationMoveCoverageDatasetSchema,
    coverageCells: z.array(simulationCoverageCellSchema),
    artifactHash: z.string().min(1),
  })
  .strict();

export const createSimulationMoveCoverageArtifact = (input: {
  readonly generatedFrom: SimulationMoveCoverageArtifact["generatedFrom"];
  readonly dataset: SimulationMoveCoverageDataset;
  readonly coverageCells: readonly SimulationCoverageCell[];
}): SimulationMoveCoverageArtifact => {
  if (input.generatedFrom.mechanicsIdentity !== input.dataset.mechanicsIdentity)
    throw new RangeError("Coverage artifact mechanics identity does not match its dataset.");
  const artifact = {
    schemaVersion: SIMULATION_MOVE_COVERAGE_ARTIFACT_VERSION,
    generatedFrom: input.generatedFrom,
    dataset: input.dataset,
    coverageCells: Object.freeze([...input.coverageCells]),
    artifactHash: canonicalHash({
      generatedFrom: input.generatedFrom,
      dataset: input.dataset,
      coverageCells: input.coverageCells,
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
  });
  if (artifact.artifactHash !== expectedHash)
    issues.push("Coverage artifact hash is stale or invalid.");
  const expectedDatasetHash = canonicalHash({
    mechanicsIdentity: artifact.dataset.mechanicsIdentity,
    records: artifact.dataset.records,
  });
  if (artifact.dataset.datasetHash !== expectedDatasetHash)
    issues.push("Coverage dataset hash is stale or invalid.");
  return issues;
};
