import { canonicalHash } from "./canonical.js";
import { validateSimulationCoverageCells, type SimulationCoverageCell } from "./coverage.js";
import {
  validateSimulationMoveClosure,
  type SimulationMoveCoverageDataset,
} from "./move-coverage.js";

export interface SimulationCompletionAudit {
  readonly schemaVersion: "simulation-completion-audit:v1";
  readonly catalogHash: string;
  readonly coverageCellCount: number;
  readonly issues: readonly string[];
  readonly complete: boolean;
  readonly auditHash: string;
}

const recordStatusForCell = (
  cell: SimulationCoverageCell,
): "sufficient" | "excluded" | "observed" | "unobserved" => {
  if (cell.status === "observed-sufficient") return "sufficient";
  if (cell.status === "excluded") return "excluded";
  if (cell.status === "underexposed") return "observed";
  return "unobserved";
};

/* eslint-disable sonarjs/cognitive-complexity -- Coverage consistency compares two bounded population dimensions. */
const validateCoverageConsistency = (
  dataset: SimulationMoveCoverageDataset,
  coverageCells: readonly SimulationCoverageCell[],
): readonly string[] => {
  const issues: string[] = [];
  const cells = new Map(coverageCells.map((cell) => [`${cell.moveId}:${cell.population}`, cell]));
  for (const record of dataset.records)
    for (const population of ["natural", "isolation"] as const) {
      const cell = cells.get(`${record.moveId}:${population}`);
      if (cell === undefined) {
        issues.push(`Missing ${population} coverage cell for ${record.moveId}.`);
        continue;
      }
      const expectedStatus = recordStatusForCell(cell);
      const actualStatus = population === "natural" ? record.naturalStatus : record.isolationStatus;
      if (actualStatus !== expectedStatus)
        issues.push(
          `Coverage status mismatch for ${record.moveId}:${population}; record=${actualStatus}, cell=${cell.status}.`,
        );
      const recordReason =
        population === "natural" ? record.naturalExclusionReason : record.isolationExclusionReason;
      if (cell.exclusionReason !== undefined && recordReason !== cell.exclusionReason)
        issues.push(`Coverage exclusion reason mismatch for ${record.moveId}:${population}.`);
    }
  return issues;
};
/* eslint-enable sonarjs/cognitive-complexity */

export const createSimulationCompletionAudit = (
  dataset: SimulationMoveCoverageDataset,
  coverageCells: readonly SimulationCoverageCell[],
): SimulationCompletionAudit => {
  const issues = [
    ...validateSimulationMoveClosure(dataset),
    ...validateSimulationCoverageCells(coverageCells),
    ...validateCoverageConsistency(dataset, coverageCells),
  ];
  const audit = {
    schemaVersion: "simulation-completion-audit:v1" as const,
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
