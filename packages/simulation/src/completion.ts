import { canonicalHash } from "./canonical.js";
import {
  validateSimulationCoverageCells,
  type SimulationCoveragePopulation,
  type SimulationCoverageCell,
  type SimulationCoverageValidationOptions,
} from "./coverage.js";
import {
  validateSimulationMoveClosure,
  type SimulationMoveCoverageDataset,
} from "./move-coverage.js";

export interface SimulationCompletionAudit {
  readonly schemaVersion: "simulation-completion-audit:v2";
  readonly catalogHash: string;
  readonly coverageCellCount: number;
  readonly issues: readonly string[];
  readonly complete: boolean;
  readonly auditHash: string;
}

export type SimulationClosurePurpose = "screening" | "production";

export interface SimulationCompletionAuditOptions extends SimulationCoverageValidationOptions {
  readonly purpose?: SimulationClosurePurpose;
  readonly populations?: readonly SimulationCoveragePopulation[];
  readonly errors?: readonly { readonly type: string }[];
}

export const aggregateSimulationCoverageCellStatus = (
  cells: readonly SimulationCoverageCell[],
): SimulationCoverageCell["status"] => {
  if (cells.length === 0 || cells.every((cell) => cell.samplingStatus === "not-applicable"))
    return "not-scheduled";
  if (cells.every((cell) => cell.samplingStatus === "not-started")) return "unobserved";
  if (
    cells.some((cell) => cell.samplingStatus === "failed" && cell.failureType === "runner-failure")
  )
    return "runner-failure";
  if (cells.some((cell) => cell.samplingStatus === "failed")) return "invalid-fixture";
  if (cells.every((cell) => cell.samplingStatus === "sufficient")) {
    if (cells.every((cell) => cell.observationStatus === "never-eligible")) return "never-eligible";
    if (cells.every((cell) => cell.population === "natural")) return "observed-sufficient";
  }
  if (cells.some((cell) => cell.observationStatus === "eligible-never-selected"))
    return "eligible-never-selected";
  if (cells.every((cell) => cell.observationStatus === "never-eligible")) return "never-eligible";
  if (cells.every((cell) => cell.samplingStatus === "sufficient")) return "observed-sufficient";
  if (cells.every((cell) => cell.samplingStatus === "excluded")) return "audited-out-of-scope";
  return "observed-low-sample";
};

const statusForPopulation = (
  record: SimulationMoveCoverageDataset["records"][number],
  population: "natural" | "isolation" | "forced",
): string => {
  if (population === "natural") return record.naturalStatus;
  if (population === "isolation") return record.isolationStatus;
  return record.forcedStatus;
};

/* eslint-disable sonarjs/cognitive-complexity -- Coverage consistency compares two bounded population dimensions. */
const validateCoverageConsistency = (
  dataset: SimulationMoveCoverageDataset,
  coverageCells: readonly SimulationCoverageCell[],
  populations: readonly SimulationCoveragePopulation[],
): readonly string[] => {
  const issues: string[] = [];
  const cells = new Map<string, SimulationCoverageCell[]>();
  for (const cell of coverageCells) {
    const key = `${cell.moveId}:${cell.population}:${cell.mechanicPath}`;
    const matching = cells.get(key) ?? [];
    matching.push(cell);
    cells.set(key, matching);
  }
  for (const record of dataset.records)
    for (const population of populations) {
      const populationCells: SimulationCoverageCell[] = [];
      for (const mechanicPath of record.requiredMechanicPaths) {
        const matching = cells.get(`${record.moveId}:${population}:${mechanicPath}`) ?? [];
        if (matching.length === 0)
          issues.push(`Missing ${population}/${mechanicPath} coverage cell for ${record.moveId}.`);
        else {
          const targetPresent = matching.filter(
            (cell) => cell.strata.exposureContext === "target-present",
          );
          // v3 closure is intentionally based on the target-present
          // mechanic-exposure arm. Keep the old all-context behavior only for
          // pre-v3-shaped test fixtures that do not identify an exposure arm.
          populationCells.push(...(targetPresent.length > 0 ? targetPresent : matching));
        }
      }
      if (populationCells.length !== record.requiredMechanicPaths.length) continue;
      const expectedStatus = aggregateSimulationCoverageCellStatus(populationCells);
      const actualStatus = statusForPopulation(record, population);
      if (actualStatus !== expectedStatus)
        issues.push(
          `Coverage status mismatch for ${record.moveId}:${population}; record=${actualStatus}, cells=${expectedStatus}.`,
        );
    }
  return issues;
};
/* eslint-enable sonarjs/cognitive-complexity */

export const validateSimulationProductionClosure = (
  coverageCells: readonly SimulationCoverageCell[],
  errors: readonly { readonly type: string }[] = [],
): readonly string[] => {
  const issues: string[] = [];
  if (errors.length > 0)
    issues.push(
      `Production closure requires zero unresolved failures; found ${errors.length} error(s).`,
    );
  const failedCells = coverageCells.filter((cell) => cell.samplingStatus === "failed");
  if (failedCells.length > 0)
    issues.push(
      `Production closure requires zero failed coverage cells; found ${failedCells.length}.`,
    );
  const applicableCells = coverageCells.filter(
    (cell) =>
      cell.population !== "forced" &&
      cell.samplingStatus !== "not-applicable" &&
      cell.precision?.status !== "not-applicable",
  );
  if (applicableCells.length === 0) {
    issues.push("Production closure requires applicable precision cells.");
    return issues;
  }
  if (applicableCells.some((cell) => cell.targetPairs < 250))
    issues.push("Production closure requires a configured precision look of at least 250 pairs.");
  const underSampled = applicableCells.filter(
    (cell) => (cell.precision?.completedPairs ?? 0) < 250,
  );
  if (underSampled.length > 0)
    issues.push(
      `Production closure requires at least 250 completed pairs in every applicable cell; ${underSampled.length} cell(s) are below 250.`,
    );
  const imprecise = applicableCells.filter((cell) => cell.precision?.status !== "precise");
  if (imprecise.length > 0)
    issues.push(
      `Production closure requires precise applicable cells; ${imprecise.length} cell(s) are not marked precise.`,
    );
  return issues;
};

export const createSimulationCompletionAudit = (
  dataset: SimulationMoveCoverageDataset,
  coverageCells: readonly SimulationCoverageCell[],
  options: SimulationCompletionAuditOptions = {},
): SimulationCompletionAudit => {
  const populations = options.populations ?? (["natural", "isolation", "forced"] as const);
  const issues = [
    ...validateSimulationMoveClosure(dataset, {}, undefined, {
      ...options,
      populations,
    }),
    ...validateSimulationCoverageCells(coverageCells, options),
    ...validateCoverageConsistency(dataset, coverageCells, populations),
    ...(options.purpose === "production"
      ? validateSimulationProductionClosure(coverageCells, options.errors)
      : []),
  ];
  const audit = {
    schemaVersion: "simulation-completion-audit:v2" as const,
    catalogHash: dataset.datasetHash,
    coverageCellCount: coverageCells.length,
    issues,
    complete: issues.length === 0,
    auditHash: canonicalHash({
      catalogHash: dataset.datasetHash,
      coverageCells,
      issues,
      purpose: options.purpose ?? "screening",
      populations,
      errors: options.errors ?? [],
    }),
  } satisfies SimulationCompletionAudit;
  return Object.freeze(audit);
};

export const assertSimulationCompletion = (audit: SimulationCompletionAudit): void => {
  if (!audit.complete)
    throw new Error(`Simulation closure is incomplete:\n${audit.issues.join("\n")}`);
};
