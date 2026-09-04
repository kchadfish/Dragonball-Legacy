import { scopeDecisionForId } from "@dragonball-resurgence/combat-engine";
import { z } from "zod";

import { canonicalHash } from "./canonical.js";
import type { SimulationMechanicPath, SimulationMoveCoverageDataset } from "./move-coverage.js";
import { summarizeSimulationRate, wilsonHalfWidth } from "./statistics.js";

export const SIMULATION_COVERAGE_CELL_SCHEMA_VERSION = "simulation-coverage-cell:v3" as const;
export type SimulationCoveragePopulation = "natural" | "isolation" | "forced";
export type SimulationEvidenceRole =
  "natural-observation" | "mechanic-exposure" | "balance-control";
export type SimulationSamplingStatus =
  "not-started" | "incomplete" | "sufficient" | "failed" | "excluded" | "not-applicable";
export type SimulationObservationStatus =
  "observed" | "eligible-never-selected" | "never-eligible" | "untriggered" | "not-applicable";

export interface SimulationCoverageStratumIdentity {
  readonly moveId: string;
  readonly population: SimulationCoveragePopulation;
  readonly profileId: string;
  readonly exposureContext: string;
  readonly evidenceRole: SimulationEvidenceRole;
}

/** Stable, human-readable identity for a non-pooled coverage context. */
export const simulationCoverageStratumIdFor = (
  identity: SimulationCoverageStratumIdentity,
): string =>
  [
    "simulation-stratum",
    identity.population,
    identity.moveId,
    identity.profileId,
    identity.exposureContext,
    identity.evidenceRole,
  ].join(":");
export type SimulationCoverageStatus =
  | "observed-sufficient"
  | "observed-low-sample"
  | "sufficient"
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
  readonly targetPairs: number;
  readonly minimumEligibleStates: number;
  readonly completedFights: number;
  /** Forced coverage may stop before fight completion; these runs are tracked separately. */
  readonly coverageSatisfiedRuns: number;
  readonly eligibleStates: number;
  readonly selectedStates: number;
  readonly triggeredStates: number;
  readonly evidenceRole: SimulationEvidenceRole;
  readonly samplingStatus: SimulationSamplingStatus;
  readonly observationStatus: SimulationObservationStatus;
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
  /** Compatibility alias; omitted from serialized v3 artifacts. */
  readonly targetFights: number;
  /** Compatibility alias; use samplingStatus/observationStatus. */
  readonly status: SimulationCoverageStatus;
  /** @internal Compatibility marker for v2 callers that expressed a fight target. */
  readonly legacyTargetFights?: number;
}

export interface SimulationCoverageValidationOptions {
  /** A draft natural population is represented explicitly as not scheduled. */
  readonly allowNaturalNotScheduled?: boolean;
}

const completedTargetReachedFor = (
  cell: Pick<
    SimulationCoverageCell,
    | "legacyTargetFights"
    | "population"
    | "completedFights"
    | "coverageSatisfiedRuns"
    | "targetPairs"
  >,
  completedFights = cell.completedFights,
  coverageSatisfiedRuns = cell.coverageSatisfiedRuns,
): boolean => {
  if (cell.legacyTargetFights !== undefined) return completedFights >= cell.legacyTargetFights;
  if (cell.population === "forced")
    return Math.floor((completedFights + coverageSatisfiedRuns) / 2) >= cell.targetPairs;
  return Math.floor(completedFights / 2) >= cell.targetPairs;
};

const legacyStatusFor = (
  samplingStatus: SimulationSamplingStatus,
  observationStatus: SimulationObservationStatus,
  population: SimulationCoveragePopulation,
): SimulationCoverageStatus => {
  if (samplingStatus === "failed") return "runner-failure";
  if (samplingStatus === "excluded") return "excluded";
  if (observationStatus === "never-eligible") return "never-eligible";
  if (samplingStatus === "sufficient" && population === "natural") return "observed-sufficient";
  if (observationStatus === "eligible-never-selected") return "eligible-never-selected";
  if (samplingStatus === "sufficient") return "observed-sufficient";
  if (samplingStatus === "not-applicable") return "not-scheduled";
  if (samplingStatus === "not-started") return "unobserved";
  return "observed-low-sample";
};

const precisionForCoverageCell = (
  cell: Pick<SimulationCoverageCell, "population" | "targetPairs">,
  completedPairs: number,
  exercisedStates: number,
  eligibleStates: number,
  completedTargetReached: boolean,
): NonNullable<SimulationCoverageCell["precision"]> => {
  const base = {
    completedPairs,
    targetPairs: cell.targetPairs,
    confidence: 0.95,
  } as const;
  if (cell.population === "forced" || eligibleStates === 0)
    return { ...base, status: "not-applicable" };
  const primaryMetricHalfWidth = wilsonHalfWidth(
    summarizeSimulationRate(exercisedStates, eligibleStates),
  );
  return {
    ...base,
    primaryMetricHalfWidth,
    status: completedTargetReached && primaryMetricHalfWidth <= 0.05 ? "precise" : "low-precision",
  };
};

const observationStatusFor = (
  cell: Pick<SimulationCoverageCell, "evidenceRole" | "mechanicPath">,
  eligibleStates: number,
  exercisedStates: number,
): SimulationObservationStatus => {
  if (cell.evidenceRole === "balance-control") return "not-applicable";
  if (eligibleStates === 0) return "never-eligible";
  if (exercisedStates > 0) return "observed";
  return cell.mechanicPath === "decision" ? "eligible-never-selected" : "untriggered";
};

const samplingStatusFor = (
  cell: Pick<
    SimulationCoverageCell,
    "evidenceRole" | "minimumEligibleStates" | "population" | "targetPairs"
  >,
  completedFights: number,
  eligibleStates: number,
  observationStatus: SimulationObservationStatus,
  precisionStatus: NonNullable<SimulationCoverageCell["precision"]>["status"],
  completedTargetReached: boolean,
): SimulationSamplingStatus => {
  const meetsEligibility =
    observationStatus === "never-eligible" || eligibleStates >= cell.minimumEligibleStates;
  const meetsPrecision =
    cell.population === "forced" || cell.targetPairs < 250 || precisionStatus === "precise";
  if (
    completedTargetReached &&
    (cell.evidenceRole === "balance-control" || (meetsEligibility && meetsPrecision))
  )
    return "sufficient";
  if (completedFights > 0 || eligibleStates > 0) return "incomplete";
  return "not-started";
};

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
    targetPairs: z.number().int().positive(),
    legacyTargetFights: z.number().int().positive().optional(),
    minimumEligibleStates: z.number().int().positive(),
    completedFights: z.number().int().nonnegative(),
    coverageSatisfiedRuns: z.number().int().nonnegative(),
    eligibleStates: z.number().int().nonnegative(),
    selectedStates: z.number().int().nonnegative(),
    triggeredStates: z.number().int().nonnegative(),
    evidenceRole: z.enum(["natural-observation", "mechanic-exposure", "balance-control"]),
    samplingStatus: z.enum([
      "not-started",
      "incomplete",
      "sufficient",
      "failed",
      "excluded",
      "not-applicable",
    ]),
    observationStatus: z.enum([
      "observed",
      "eligible-never-selected",
      "never-eligible",
      "untriggered",
      "not-applicable",
    ]),
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
    const balanceControl = cell.evidenceRole === "balance-control";
    const completedTargetReached = completedTargetReachedFor(cell);
    if (
      cell.samplingStatus === "sufficient" &&
      (!completedTargetReached ||
        (!balanceControl &&
          cell.observationStatus !== "never-eligible" &&
          cell.eligibleStates < cell.minimumEligibleStates) ||
        (cell.population !== "forced" &&
          cell.targetPairs >= 250 &&
          cell.precision?.status !== "precise"))
    )
      context.addIssue({
        code: "custom",
        path: ["status"],
        message:
          "Sufficient cells must meet the configured pair, eligibility, and precision thresholds.",
      });
    if (
      cell.observationStatus === "eligible-never-selected" &&
      !(cell.eligibleStates > 0 && cell.selectedStates === 0)
    )
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Eligible-never-selected cells require eligible and zero selected states.",
      });
    if (cell.observationStatus === "never-eligible" && cell.eligibleStates !== 0)
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Never-eligible cells cannot contain eligible states.",
      });
  });

type SimulationCoverageCellInput = Omit<
  SimulationCoverageCell,
  | "schemaVersion"
  | "cellHash"
  | "mechanicPath"
  | "selectedStates"
  | "triggeredStates"
  | "coverageSatisfiedRuns"
  | "targetPairs"
  | "evidenceRole"
  | "samplingStatus"
  | "observationStatus"
  | "targetFights"
  | "status"
  | "legacyTargetFights"
> &
  Partial<
    Pick<
      SimulationCoverageCell,
      | "mechanicPath"
      | "selectedStates"
      | "triggeredStates"
      | "coverageSatisfiedRuns"
      | "targetPairs"
      | "evidenceRole"
      | "samplingStatus"
      | "observationStatus"
      | "status"
    >
  > & { readonly targetFights?: number; readonly legacyTargetFights?: number };

const validateCoverageCellInput = (
  input: SimulationCoverageCellInput,
  targetPairs: number,
  selectedStates: number,
  triggeredStates: number,
  coverageSatisfiedRuns: number,
  mechanicPath: SimulationMechanicPath,
  legacyStatus: SimulationCoverageStatus | undefined,
): void => {
  if (
    !Number.isInteger(targetPairs) ||
    targetPairs < 1 ||
    targetPairs > 10_000 ||
    !Number.isInteger(input.minimumEligibleStates) ||
    input.minimumEligibleStates < 1 ||
    !Number.isInteger(input.completedFights) ||
    input.completedFights < 0 ||
    !Number.isInteger(coverageSatisfiedRuns) ||
    coverageSatisfiedRuns < 0 ||
    !Number.isInteger(input.eligibleStates) ||
    input.eligibleStates < 0 ||
    !Number.isInteger(selectedStates) ||
    selectedStates < 0 ||
    !Number.isInteger(triggeredStates) ||
    triggeredStates < 0
  )
    throw new RangeError("Coverage cell counts are outside their valid ranges.");
  if (legacyStatus === "audited-out-of-scope" && input.scopeDecisionId === undefined)
    throw new RangeError("Audited out-of-scope cells require a registered scope decision.");
  if (
    legacyStatus === "observed-sufficient" &&
    ((mechanicPath === "decision" && selectedStates === 0) ||
      (mechanicPath === "trigger" && triggeredStates === 0))
  )
    throw new RangeError("Legacy sufficient cells must exercise their mechanic path.");
};

export const createSimulationCoverageCell = (
  input: SimulationCoverageCellInput,
  // The factory is an intentional compatibility adapter between legacy v2 callers and the v3 split status model.
  // eslint-disable-next-line sonarjs/cognitive-complexity -- compatibility normalization is centralized here
): SimulationCoverageCell => {
  const mechanicPath = input.mechanicPath ?? "decision";
  const selectedStates = input.selectedStates ?? 0;
  const triggeredStates = input.triggeredStates ?? 0;
  const coverageSatisfiedRuns = input.coverageSatisfiedRuns ?? 0;
  const targetPairs = input.targetPairs ?? input.targetFights;
  if (targetPairs === undefined)
    throw new RangeError("Coverage cells require a target pair count.");
  let evidenceRole = input.evidenceRole;
  if (evidenceRole === undefined) {
    evidenceRole = "mechanic-exposure";
    if (input.population === "natural") evidenceRole = "natural-observation";
    else if (
      input.strata.exposureContext === "target-removed" ||
      input.strata.exposureContext === "comparable-replacement"
    )
      evidenceRole = "balance-control";
  }
  const legacyStatus = input.status;
  let legacyTargetFights = input.legacyTargetFights;
  if (legacyTargetFights === undefined && input.targetPairs === undefined)
    legacyTargetFights = input.targetFights;
  let samplingStatus = input.samplingStatus;
  if (samplingStatus === undefined) {
    samplingStatus = "incomplete";
    if (legacyStatus === "observed-sufficient" || legacyStatus === "sufficient")
      samplingStatus = "sufficient";
    else if (legacyStatus === "excluded" || legacyStatus === "audited-out-of-scope")
      samplingStatus = "excluded";
    else if (legacyStatus === "not-scheduled") samplingStatus = "not-applicable";
    else if (legacyStatus === "invalid-fixture" || legacyStatus === "runner-failure")
      samplingStatus = "failed";
    else if (legacyStatus === "unobserved") samplingStatus = "not-started";
  }
  let observationStatus = input.observationStatus;
  if (observationStatus === undefined) {
    observationStatus = "observed";
    if (evidenceRole === "balance-control") observationStatus = "not-applicable";
    else if (legacyStatus === "eligible-never-selected")
      observationStatus = "eligible-never-selected";
    else if (legacyStatus === "never-eligible") observationStatus = "never-eligible";
    else if (legacyStatus === "not-scheduled") observationStatus = "not-applicable";
    else if (mechanicPath === "trigger" && legacyStatus === "observed-low-sample")
      observationStatus = "untriggered";
  }
  const exclusionReason =
    input.exclusionReason ??
    (legacyStatus === "audited-out-of-scope" ? "Registered out-of-scope coverage." : undefined);
  validateCoverageCellInput(
    input,
    targetPairs,
    selectedStates,
    triggeredStates,
    coverageSatisfiedRuns,
    mechanicPath,
    legacyStatus,
  );
  const canonicalInput = { ...input };
  delete canonicalInput.targetFights;
  delete canonicalInput.status;
  delete canonicalInput.legacyTargetFights;
  const cell = {
    schemaVersion: SIMULATION_COVERAGE_CELL_SCHEMA_VERSION,
    ...canonicalInput,
    targetPairs,
    evidenceRole,
    samplingStatus,
    observationStatus,
    coverageSatisfiedRuns,
    ...(exclusionReason === undefined ? {} : { exclusionReason }),
    ...(legacyTargetFights === undefined ? {} : { legacyTargetFights }),
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
      targetPairs,
      minimumEligibleStates: input.minimumEligibleStates,
      evidenceRole,
    }),
  } satisfies Omit<SimulationCoverageCell, "targetFights" | "status">;
  const parsed = simulationCoverageCellSchema.parse(cell) as SimulationCoverageCell;
  delete (parsed as { legacyTargetFights?: number }).legacyTargetFights;
  Object.defineProperties(parsed, {
    targetFights: { value: targetPairs, enumerable: false },
    status: {
      value: legacyStatus ?? legacyStatusFor(samplingStatus, observationStatus, input.population),
      enumerable: false,
    },
  });
  if (legacyTargetFights !== undefined)
    Object.defineProperty(parsed, "legacyTargetFights", {
      value: legacyTargetFights,
      enumerable: false,
    });
  return Object.freeze(parsed);
};

export const createSimulationCoverageMatrix = (
  dataset: SimulationMoveCoverageDataset,
  scenarioFamilies: readonly string[],
  checkpointId: string,
  options: {
    readonly targetPairs?: number;
    /** Compatibility alias; use targetPairs. */
    readonly targetFights?: number;
    readonly minimumEligibleStates?: number;
    readonly populations?: readonly SimulationCoveragePopulation[];
    readonly mechanicPaths?: readonly SimulationMechanicPath[];
    readonly strata?: Readonly<Record<string, string>>;
  } = {},
): readonly SimulationCoverageCell[] => {
  if (options.targetPairs !== undefined && options.targetFights !== undefined)
    throw new RangeError(
      "Coverage accepts either targetPairs or deprecated targetFights, not both.",
    );
  if (scenarioFamilies.length === 0) throw new RangeError("Coverage requires a scenario family.");
  const populations = options.populations ?? ["natural", "isolation", "forced"];
  const mechanicPaths = options.mechanicPaths ?? ["decision"];
  const targetPairs = options.targetPairs ?? options.targetFights ?? 10;
  const cells: SimulationCoverageCell[] = [];
  for (const record of dataset.records)
    for (const scenarioFamily of scenarioFamilies)
      for (const population of populations)
        for (const mechanicPath of mechanicPaths) {
          const strata = { category: record.category, ...(options.strata ?? {}) };
          cells.push(
            createSimulationCoverageCell({
              cellId: `simulation-cell:${canonicalHash({ moveId: record.moveId, scenarioFamily, checkpointId, population, mechanicPath, strata }).slice("fnv1a-32:".length)}`,
              moveId: record.moveId,
              scenarioFamily,
              mechanicPath,
              checkpointId,
              population,
              strata,
              targetPairs,
              minimumEligibleStates: options.minimumEligibleStates ?? 10,
              completedFights: 0,
              eligibleStates: 0,
              selectedStates: 0,
              triggeredStates: 0,
              status: "unobserved",
            }),
          );
        }
  return Object.freeze([...cells].sort((left, right) => left.cellId.localeCompare(right.cellId)));
};

export const updateSimulationCoverageCell = (
  cell: SimulationCoverageCell,
  counts: Partial<
    Pick<
      SimulationCoverageCell,
      | "completedFights"
      | "eligibleStates"
      | "selectedStates"
      | "triggeredStates"
      | "coverageSatisfiedRuns"
    >
  > &
    Pick<SimulationCoverageCell, "completedFights" | "eligibleStates">,
): SimulationCoverageCell => {
  const completedFights = counts.completedFights;
  const eligibleStates = counts.eligibleStates;
  const selectedStates = counts.selectedStates ?? cell.selectedStates;
  const triggeredStates = counts.triggeredStates ?? cell.triggeredStates;
  const coverageSatisfiedRuns = counts.coverageSatisfiedRuns ?? cell.coverageSatisfiedRuns;
  const exercisedStates = cell.mechanicPath === "decision" ? selectedStates : triggeredStates;
  const completedPairs = Math.floor(completedFights / 2);
  const completedTargetReached = completedTargetReachedFor(
    cell,
    completedFights,
    coverageSatisfiedRuns,
  );
  const precision = precisionForCoverageCell(
    cell,
    completedPairs,
    exercisedStates,
    eligibleStates,
    completedTargetReached,
  );
  const observationStatus = observationStatusFor(cell, eligibleStates, exercisedStates);
  const samplingStatus = samplingStatusFor(
    cell,
    completedFights,
    eligibleStates,
    observationStatus,
    precision.status,
    completedTargetReached,
  );
  return createSimulationCoverageCell({
    ...cell,
    completedFights,
    coverageSatisfiedRuns,
    eligibleStates,
    selectedStates,
    triggeredStates,
    precision,
    samplingStatus,
    observationStatus,
    legacyTargetFights: cell.legacyTargetFights,
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
    coverageSatisfiedRuns: left.coverageSatisfiedRuns + right.coverageSatisfiedRuns,
    eligibleStates: left.eligibleStates + right.eligibleStates,
    selectedStates: left.selectedStates + right.selectedStates,
    triggeredStates: left.triggeredStates + right.triggeredStates,
  });
};

const coverageCellValidationIssuesFor = (
  cell: SimulationCoverageCell,
  options: SimulationCoverageValidationOptions,
): readonly string[] => {
  const issues: string[] = [];
  if (cell.samplingStatus === "excluded") {
    if (cell.exclusionReason === undefined)
      issues.push(`Excluded coverage cell lacks an exclusion reason: ${cell.cellId}`);
    if (
      cell.scopeDecisionId !== undefined &&
      scopeDecisionForId(cell.scopeDecisionId) === undefined
    )
      issues.push(`Coverage cell has an unregistered scope decision: ${cell.cellId}`);
  } else {
    const draftNatural =
      options.allowNaturalNotScheduled === true &&
      cell.population === "natural" &&
      cell.samplingStatus === "not-applicable";
    const balanceControl =
      cell.evidenceRole === "balance-control" && cell.samplingStatus === "not-applicable";
    const registeredExclusion =
      cell.samplingStatus === "not-applicable" && cell.exclusionReason !== undefined;
    const insufficient = ["not-started", "incomplete", "failed", "not-applicable"].includes(
      cell.samplingStatus,
    );
    if (!draftNatural && !balanceControl && !registeredExclusion && insufficient)
      issues.push(`Coverage cell is not sufficient or registered out of scope: ${cell.cellId}`);
  }
  const expectedHash = canonicalHash({
    cellId: cell.cellId,
    moveId: cell.moveId,
    scenarioFamily: cell.scenarioFamily,
    mechanicPath: cell.mechanicPath,
    checkpointId: cell.checkpointId,
    population: cell.population,
    strata: cell.strata,
    targetPairs: cell.targetPairs,
    minimumEligibleStates: cell.minimumEligibleStates,
    evidenceRole: cell.evidenceRole,
  });
  if (cell.cellHash !== expectedHash) issues.push(`Coverage cell hash is stale: ${cell.cellId}`);
  return issues;
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
    issues.push(...coverageCellValidationIssuesFor(cell, options));
  }
  return issues;
};
