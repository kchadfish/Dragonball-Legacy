import { scopeDecisionForId } from "@dragonball-resurgence/combat-engine";
import { z } from "zod";

import { canonicalHash } from "./canonical.js";
import type { SimulationMechanicPath, SimulationMoveCoverageDataset } from "./move-coverage.js";

export const SIMULATION_COVERAGE_CELL_SCHEMA_VERSION = "simulation-coverage-cell:v2" as const;
export type SimulationCoveragePopulation = "natural" | "isolation" | "forced";
export type SimulationCoverageStatus =
  | "observed-sufficient"
  | "observed-low-sample"
  | "eligible-never-selected"
  | "never-eligible"
  | "incompatible-template"
  | "audited-out-of-scope"
  | "invalid-fixture"
  | "runner-failure"
  | "not-scheduled"
  // Only accepted for compatibility with the old cell factory; never closes a v2 cell.
  | "unobserved"
  | "underexposed"
  | "excluded";

export const simulationCoverageStatusSchema = z.enum([
  "observed-sufficient",
  "observed-low-sample",
  "eligible-never-selected",
  "never-eligible",
  "incompatible-template",
  "audited-out-of-scope",
  "invalid-fixture",
  "runner-failure",
  "not-scheduled",
  "unobserved",
  "underexposed",
  "excluded",
]);

export interface SimulationCoverageCell {
  readonly schemaVersion: typeof SIMULATION_COVERAGE_CELL_SCHEMA_VERSION;
  readonly cellId: string;
  readonly moveId: string;
  readonly scenarioFamily: string;
  readonly mechanicPath: SimulationMechanicPath;
  readonly checkpointId: string;
  readonly population: SimulationCoveragePopulation;
  readonly strata: Readonly<Record<string, string>>;
  readonly targetFights: number;
  readonly minimumEligibleStates: number;
  readonly completedFights: number;
  readonly eligibleStates: number;
  readonly selectedStates: number;
  readonly triggeredStates: number;
  readonly status: SimulationCoverageStatus;
  readonly exclusionReason?: string;
  readonly scopeDecisionId?: string;
  readonly failureType?:
    "invalid-fixture" | "runner-failure" | "ai-failure" | "combat-failure" | "not-scheduled";
  readonly precision?: Readonly<{
    readonly completedPairs: number;
    readonly targetPairs: number;
    readonly confidence: number;
    readonly primaryMetricHalfWidth?: number;
    readonly status: "precise" | "low-precision" | "not-applicable";
  }>;
  readonly cellHash: string;
}

export interface SimulationCoverageValidationOptions {
  /** A draft natural population is represented explicitly as not scheduled. */
  readonly allowNaturalNotScheduled?: boolean;
}

const precisionSchema = z
  .object({
    completedPairs: z.number().int().nonnegative(),
    targetPairs: z.number().int().positive(),
    confidence: z.number().positive().lt(1),
    primaryMetricHalfWidth: z.number().nonnegative().optional(),
    status: z.enum(["precise", "low-precision", "not-applicable"]),
  })
  .strict();

export const simulationCoverageCellSchema = z
  .object({
    schemaVersion: z.literal(SIMULATION_COVERAGE_CELL_SCHEMA_VERSION),
    cellId: z.string().min(1),
    moveId: z.string().min(1),
    scenarioFamily: z.string().min(1),
    mechanicPath: z.enum(["decision", "trigger"]),
    checkpointId: z.string().min(1),
    population: z.enum(["natural", "isolation", "forced"]),
    strata: z.record(z.string(), z.string()),
    targetFights: z.number().int().positive(),
    minimumEligibleStates: z.number().int().positive(),
    completedFights: z.number().int().nonnegative(),
    eligibleStates: z.number().int().nonnegative(),
    selectedStates: z.number().int().nonnegative(),
    triggeredStates: z.number().int().nonnegative(),
    status: simulationCoverageStatusSchema,
    exclusionReason: z.string().min(1).optional(),
    scopeDecisionId: z.string().min(1).optional(),
    failureType: z
      .enum(["invalid-fixture", "runner-failure", "ai-failure", "combat-failure", "not-scheduled"])
      .optional(),
    precision: precisionSchema.optional(),
    cellHash: z.string().min(1),
  })
  .strict()
  .superRefine((cell, context) => {
    if (cell.selectedStates > cell.eligibleStates)
      context.addIssue({
        code: "custom",
        path: ["selectedStates"],
        message: "Selected states cannot exceed eligible states.",
      });
    if (cell.triggeredStates > cell.eligibleStates)
      context.addIssue({
        code: "custom",
        path: ["triggeredStates"],
        message: "Triggered states cannot exceed eligible states.",
      });
    const exercisedStates =
      cell.mechanicPath === "decision" ? cell.selectedStates : cell.triggeredStates;
    if (
      cell.status === "observed-sufficient" &&
      (cell.completedFights < cell.targetFights ||
        cell.eligibleStates < cell.minimumEligibleStates ||
        exercisedStates === 0)
    )
      context.addIssue({
        code: "custom",
        path: ["status"],
        message:
          "Observed-sufficient cells must meet configured thresholds and exercise their mechanic path.",
      });
    if (
      cell.status === "eligible-never-selected" &&
      !(cell.eligibleStates > 0 && cell.selectedStates === 0)
    )
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Eligible-never-selected cells require eligible and zero selected states.",
      });
    if (cell.status === "never-eligible" && cell.eligibleStates !== 0)
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Never-eligible cells cannot contain eligible states.",
      });
  });

export const createSimulationCoverageCell = (
  input: Omit<
    SimulationCoverageCell,
    "schemaVersion" | "cellHash" | "mechanicPath" | "selectedStates" | "triggeredStates"
  > &
    Partial<Pick<SimulationCoverageCell, "mechanicPath" | "selectedStates" | "triggeredStates">>,
): SimulationCoverageCell => {
  const mechanicPath = input.mechanicPath ?? "decision";
  const selectedStates = input.selectedStates ?? 0;
  const triggeredStates = input.triggeredStates ?? 0;
  if (
    !Number.isInteger(input.targetFights) ||
    input.targetFights < 1 ||
    input.targetFights > 10_000 ||
    !Number.isInteger(input.minimumEligibleStates) ||
    input.minimumEligibleStates < 1 ||
    !Number.isInteger(input.completedFights) ||
    input.completedFights < 0 ||
    !Number.isInteger(input.eligibleStates) ||
    input.eligibleStates < 0 ||
    !Number.isInteger(selectedStates) ||
    selectedStates < 0 ||
    !Number.isInteger(triggeredStates) ||
    triggeredStates < 0
  )
    throw new RangeError("Coverage cell counts are outside their valid ranges.");
  if (input.status === "audited-out-of-scope" && input.scopeDecisionId === undefined)
    throw new RangeError("Audited out-of-scope cells require a registered scope decision.");
  const cell = {
    schemaVersion: SIMULATION_COVERAGE_CELL_SCHEMA_VERSION,
    ...input,
    mechanicPath,
    selectedStates,
    triggeredStates,
    cellHash: canonicalHash({
      cellId: input.cellId,
      moveId: input.moveId,
      scenarioFamily: input.scenarioFamily,
      mechanicPath,
      checkpointId: input.checkpointId,
      population: input.population,
      strata: input.strata,
      targetFights: input.targetFights,
      minimumEligibleStates: input.minimumEligibleStates,
    }),
  } satisfies SimulationCoverageCell;
  return Object.freeze(simulationCoverageCellSchema.parse(cell));
};

export const createSimulationCoverageMatrix = (
  dataset: SimulationMoveCoverageDataset,
  scenarioFamilies: readonly string[],
  checkpointId: string,
  options: {
    readonly targetFights?: number;
    readonly minimumEligibleStates?: number;
    readonly populations?: readonly SimulationCoveragePopulation[];
    readonly mechanicPaths?: readonly SimulationMechanicPath[];
  } = {},
): readonly SimulationCoverageCell[] => {
  if (scenarioFamilies.length === 0) throw new RangeError("Coverage requires a scenario family.");
  const populations = options.populations ?? ["natural", "isolation", "forced"];
  const mechanicPaths = options.mechanicPaths ?? ["decision"];
  const cells: SimulationCoverageCell[] = [];
  for (const record of dataset.records)
    for (const scenarioFamily of scenarioFamilies)
      for (const population of populations)
        for (const mechanicPath of mechanicPaths)
          cells.push(
            createSimulationCoverageCell({
              cellId: `simulation-cell:${canonicalHash({ moveId: record.moveId, scenarioFamily, checkpointId, population, mechanicPath }).slice("fnv1a-32:".length)}`,
              moveId: record.moveId,
              scenarioFamily,
              mechanicPath,
              checkpointId,
              population,
              strata: { category: record.category },
              targetFights: options.targetFights ?? 10,
              minimumEligibleStates: options.minimumEligibleStates ?? 10,
              completedFights: 0,
              eligibleStates: 0,
              selectedStates: 0,
              triggeredStates: 0,
              status: "unobserved",
            }),
          );
  return Object.freeze([...cells].sort((left, right) => left.cellId.localeCompare(right.cellId)));
};

export const updateSimulationCoverageCell = (
  cell: SimulationCoverageCell,
  counts: Partial<
    Pick<
      SimulationCoverageCell,
      "completedFights" | "eligibleStates" | "selectedStates" | "triggeredStates"
    >
  > &
    Pick<SimulationCoverageCell, "completedFights" | "eligibleStates">,
): SimulationCoverageCell => {
  const completedFights = counts.completedFights;
  const eligibleStates = counts.eligibleStates;
  const selectedStates = counts.selectedStates ?? cell.selectedStates;
  const triggeredStates = counts.triggeredStates ?? cell.triggeredStates;
  const exercisedStates = cell.mechanicPath === "decision" ? selectedStates : triggeredStates;
  let status: SimulationCoverageStatus = "unobserved";
  if (completedFights > 0 || eligibleStates > 0) status = "observed-low-sample";
  if (eligibleStates > 0 && exercisedStates === 0) status = "eligible-never-selected";
  if (
    completedFights >= cell.targetFights &&
    eligibleStates >= cell.minimumEligibleStates &&
    exercisedStates > 0
  )
    status = "observed-sufficient";
  return createSimulationCoverageCell({
    ...cell,
    completedFights,
    eligibleStates,
    selectedStates,
    triggeredStates,
    status,
  });
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
    selectedStates: left.selectedStates + right.selectedStates,
    triggeredStates: left.triggeredStates + right.triggeredStates,
  });
};

export const validateSimulationCoverageCells = (
  cells: readonly SimulationCoverageCell[],
  options: SimulationCoverageValidationOptions = {},
): readonly string[] => {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const cell of cells) {
    if (seen.has(cell.cellId)) issues.push(`Duplicate coverage cell: ${cell.cellId}`);
    seen.add(cell.cellId);
    if (cell.status === "audited-out-of-scope") {
      if (cell.scopeDecisionId === undefined)
        issues.push(`Audited coverage cell lacks a scope decision: ${cell.cellId}`);
      else if (scopeDecisionForId(cell.scopeDecisionId) === undefined)
        issues.push(`Coverage cell has an unregistered scope decision: ${cell.cellId}`);
    } else if (
      !(
        options.allowNaturalNotScheduled === true &&
        cell.population === "natural" &&
        cell.status === "not-scheduled"
      ) &&
      [
        "unobserved",
        "underexposed",
        "observed-low-sample",
        "eligible-never-selected",
        "never-eligible",
        "incompatible-template",
        "invalid-fixture",
        "runner-failure",
        "not-scheduled",
      ].includes(cell.status)
    ) {
      issues.push(`Coverage cell is not sufficient or registered out of scope: ${cell.cellId}`);
    }
    if (
      cell.cellHash !==
      canonicalHash({
        cellId: cell.cellId,
        moveId: cell.moveId,
        scenarioFamily: cell.scenarioFamily,
        mechanicPath: cell.mechanicPath,
        checkpointId: cell.checkpointId,
        population: cell.population,
        strata: cell.strata,
        targetFights: cell.targetFights,
        minimumEligibleStates: cell.minimumEligibleStates,
      })
    )
      issues.push(`Coverage cell hash is stale: ${cell.cellId}`);
  }
  return issues;
};
