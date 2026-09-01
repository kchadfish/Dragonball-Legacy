import { canonicalHash } from "./canonical.js";
import { z } from "zod";
import type { SimulationMoveCoverageDataset } from "./move-coverage.js";

export type SimulationCoveragePopulation = "natural" | "isolation" | "forced";
export type SimulationCoverageStatus =
  "unobserved" | "underexposed" | "observed-sufficient" | "excluded";

export interface SimulationCoverageCell {
  readonly schemaVersion: "simulation-coverage-cell:v1";
  readonly cellId: string;
  readonly moveId: string;
  readonly scenarioFamily: string;
  readonly checkpointId: string;
  readonly population: SimulationCoveragePopulation;
  readonly strata: Readonly<Record<string, string>>;
  readonly targetFights: number;
  readonly minimumEligibleStates: number;
  readonly completedFights: number;
  readonly eligibleStates: number;
  readonly status: SimulationCoverageStatus;
  readonly exclusionReason?: string;
  readonly cellHash: string;
}

export const simulationCoverageCellSchema = z
  .object({
    schemaVersion: z.literal("simulation-coverage-cell:v1"),
    cellId: z.string().min(1),
    moveId: z.string().min(1),
    scenarioFamily: z.string().min(1),
    checkpointId: z.string().min(1),
    population: z.enum(["natural", "isolation", "forced"]),
    strata: z.record(z.string(), z.string()),
    targetFights: z.number().int().positive(),
    minimumEligibleStates: z.number().int().positive(),
    completedFights: z.number().int().nonnegative(),
    eligibleStates: z.number().int().nonnegative(),
    status: z.enum(["unobserved", "underexposed", "observed-sufficient", "excluded"]),
    exclusionReason: z.string().min(1).optional(),
    cellHash: z.string().min(1),
  })
  .strict();

export const createSimulationCoverageCell = (
  input: Omit<SimulationCoverageCell, "schemaVersion" | "cellHash">,
): SimulationCoverageCell => {
  if (
    !Number.isInteger(input.targetFights) ||
    input.targetFights < 1 ||
    input.targetFights > 10_000 ||
    !Number.isInteger(input.minimumEligibleStates) ||
    input.minimumEligibleStates < 1 ||
    !Number.isInteger(input.completedFights) ||
    input.completedFights < 0 ||
    !Number.isInteger(input.eligibleStates) ||
    input.eligibleStates < 0
  )
    throw new RangeError("Coverage cell counts are outside their valid ranges.");
  if (input.status === "excluded" && input.exclusionReason === undefined)
    throw new RangeError("Excluded coverage cells require a reviewed reason.");
  const cell = {
    schemaVersion: "simulation-coverage-cell:v1" as const,
    ...input,
    cellHash: canonicalHash({
      cellId: input.cellId,
      moveId: input.moveId,
      scenarioFamily: input.scenarioFamily,
      checkpointId: input.checkpointId,
      population: input.population,
      strata: input.strata,
      targetFights: input.targetFights,
      minimumEligibleStates: input.minimumEligibleStates,
    }),
  } satisfies SimulationCoverageCell;
  return Object.freeze(cell);
};

export const createSimulationCoverageMatrix = (
  dataset: SimulationMoveCoverageDataset,
  scenarioFamilies: readonly string[],
  checkpointId: string,
  options: {
    readonly targetFights?: number;
    readonly minimumEligibleStates?: number;
    readonly populations?: readonly SimulationCoveragePopulation[];
  } = {},
): readonly SimulationCoverageCell[] => {
  if (scenarioFamilies.length === 0) throw new RangeError("Coverage requires a scenario family.");
  const populations = options.populations ?? ["natural", "isolation"];
  const cells = dataset.records.flatMap((record) =>
    scenarioFamilies.flatMap((scenarioFamily) =>
      populations.map((population) =>
        createSimulationCoverageCell({
          cellId: `simulation-cell:${canonicalHash({ moveId: record.moveId, scenarioFamily, checkpointId, population }).slice("fnv1a-32:".length)}`,
          moveId: record.moveId,
          scenarioFamily,
          checkpointId,
          population,
          strata: { category: record.category },
          targetFights: options.targetFights ?? 10,
          minimumEligibleStates: options.minimumEligibleStates ?? 10,
          completedFights: 0,
          eligibleStates: 0,
          status: "unobserved",
        }),
      ),
    ),
  );
  const orderedCells = [...cells].sort((left, right) => left.cellId.localeCompare(right.cellId));
  return Object.freeze(orderedCells);
};

export const updateSimulationCoverageCell = (
  cell: SimulationCoverageCell,
  counts: Pick<SimulationCoverageCell, "completedFights" | "eligibleStates">,
): SimulationCoverageCell => {
  let status: SimulationCoverageStatus = "unobserved";
  if (counts.completedFights > 0 || counts.eligibleStates > 0) status = "underexposed";
  if (
    counts.completedFights >= cell.targetFights &&
    counts.eligibleStates >= cell.minimumEligibleStates
  )
    status = "observed-sufficient";
  return createSimulationCoverageCell({ ...cell, ...counts, status });
};

export const mergeSimulationCoverageCells = (
  left: SimulationCoverageCell,
  right: SimulationCoverageCell,
): SimulationCoverageCell => {
  if (left.cellId !== right.cellId || left.cellHash !== right.cellHash)
    throw new RangeError("Coverage cells must have matching immutable identities.");
  return updateSimulationCoverageCell(left, {
    completedFights: left.completedFights + right.completedFights,
    eligibleStates: left.eligibleStates + right.eligibleStates,
  });
};

export const validateSimulationCoverageCells = (
  cells: readonly SimulationCoverageCell[],
): readonly string[] => {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const cell of cells) {
    if (seen.has(cell.cellId)) issues.push(`Duplicate coverage cell: ${cell.cellId}`);
    seen.add(cell.cellId);
    if (cell.status === "unobserved" && cell.exclusionReason !== undefined)
      issues.push(`Unobserved coverage cell has an exclusion reason: ${cell.cellId}`);
    if (cell.status === "excluded" && cell.exclusionReason === undefined)
      issues.push(`Excluded coverage cell lacks a reviewed reason: ${cell.cellId}`);
    if (
      (cell.status === "unobserved" || cell.status === "underexposed") &&
      cell.exclusionReason === undefined
    )
      issues.push(`Coverage cell is not sufficient or excluded: ${cell.cellId}`);
  }
  return issues;
};
