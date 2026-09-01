import { writeFile } from "node:fs/promises";

import { canonicalJson, runSimulationMoveCoverage } from "../packages/simulation/src/index.js";

const positiveIntegerFromEnv = (name: string): number | undefined => {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new RangeError(`${name} must be positive.`);
  return parsed;
};

const moveIdsFromEnv = (): readonly string[] | undefined => {
  const value = process.env.SIMULATION_COVERAGE_MOVE_IDS;
  if (value === undefined) return undefined;
  const moveIds = value
    .split(",")
    .map((moveId) => moveId.trim())
    .filter(Boolean);
  if (moveIds.length === 0) throw new RangeError("SIMULATION_COVERAGE_MOVE_IDS must not be empty.");
  return moveIds;
};

const result = runSimulationMoveCoverage({
  targetFights: positiveIntegerFromEnv("SIMULATION_COVERAGE_TARGET"),
  concurrency: positiveIntegerFromEnv("SIMULATION_COVERAGE_CONCURRENCY"),
  moveIds: moveIdsFromEnv(),
});
await writeFile(
  "docs/architecture/simulation-move-coverage.json",
  `${canonicalJson(result.artifact)}\n`,
  "utf8",
);
console.log(
  `Generated ${result.artifact.dataset.records.length} move coverage records from ${result.runCount} runs (${result.failedRunCount} failed: ${JSON.stringify(result.failureTypes)}).`,
);
