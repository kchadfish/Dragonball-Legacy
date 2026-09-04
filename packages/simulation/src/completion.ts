import { canonicalHash } from "./canonical.js";
import {
  validateSimulationCoverageCells,
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

export type SimulationCompletionAuditOptions = SimulationCoverageValidationOptions;

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
    for (const population of ["natural", "isolation", "forced"] as const) {
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

export const createSimulationCompletionAudit = (
  dataset: SimulationMoveCoverageDataset,
  coverageCells: readonly SimulationCoverageCell[],
  options: SimulationCompletionAuditOptions = {},
): SimulationCompletionAudit => {
  const issues = [
    ...validateSimulationMoveClosure(dataset, {}, undefined, options),
    ...validateSimulationCoverageCells(coverageCells, options),
    ...validateCoverageConsistency(dataset, coverageCells),
  ];
  const audit = {
    schemaVersion: "simulation-completion-audit:v2" as const,
    catalogHash: dataset.datasetHash,
    coverageCellCount: coverageCells.length,
    issues,
    complete: issues.length === 0,
    auditHash: canonicalHash({ catalogHash: dataset.datasetHash, coverageCells, issues }),
  } satisfies SimulationCompletionAudit;
  return Object.freeze(audit);
};

export const assertSimulationCompletion = (audit: SimulationCompletionAudit): void => {
  if (!audit.complete)
    throw new Error(`Simulation closure is incomplete:\n${audit.issues.join("\n")}`);
};
