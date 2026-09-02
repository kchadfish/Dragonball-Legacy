import { writeFile } from "node:fs/promises";

import {
  canonicalJson,
  runSimulationMoveCoverage,
  runSimulationMoveCoverageCatalog,
} from "../packages/simulation/src/index.js";

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

const populationFromEnv = (): "natural" | "isolation" | "forced" | undefined => {
  const value = process.env.SIMULATION_COVERAGE_POPULATION;
  if (value === undefined) return undefined;
  if (value !== "natural" && value !== "isolation" && value !== "forced")
    throw new RangeError("SIMULATION_COVERAGE_POPULATION must be natural, isolation, or forced.");
  return value;
};

const naturalProfileFromEnv = ():
  "profile:normal" | "profile:hard" | "profile:simulation-quality" | undefined => {
  const value = process.env.SIMULATION_COVERAGE_NATURAL_PROFILE;
  if (value === undefined) return undefined;
  if (
    value !== "profile:normal" &&
    value !== "profile:hard" &&
    value !== "profile:simulation-quality"
  )
    throw new RangeError(
      "SIMULATION_COVERAGE_NATURAL_PROFILE must be profile:normal, profile:hard, or profile:simulation-quality.",
    );
  return value;
};

const populationsFromEnv = (): readonly ("natural" | "isolation" | "forced")[] | undefined => {
  const value = process.env.SIMULATION_COVERAGE_POPULATIONS;
  if (value === undefined) return undefined;
  const populations = value
    .split(",")
    .map((population) => population.trim())
    .filter(Boolean);
  if (
    populations.length === 0 ||
    populations.some(
      (population) =>
        population !== "natural" && population !== "isolation" && population !== "forced",
    ) ||
    new Set(populations).size !== populations.length
  )
    throw new RangeError(
      "SIMULATION_COVERAGE_POPULATIONS must contain unique natural, isolation, or forced values.",
    );
  return populations as readonly ("natural" | "isolation" | "forced")[];
};

const coverageOptions = {
  targetFights: positiveIntegerFromEnv("SIMULATION_COVERAGE_TARGET"),
  minimumEligibleStates: positiveIntegerFromEnv("SIMULATION_COVERAGE_MINIMUM_ELIGIBLE"),
  concurrency: positiveIntegerFromEnv("SIMULATION_COVERAGE_CONCURRENCY"),
  workers: positiveIntegerFromEnv("SIMULATION_COVERAGE_WORKERS"),
  population: populationFromEnv(),
  naturalOverlayApprovalReference: process.env.SIMULATION_COVERAGE_NATURAL_APPROVAL,
  naturalProfileId: naturalProfileFromEnv(),
  moveIds: moveIdsFromEnv(),
};
const populations = populationsFromEnv();
const result =
  populations === undefined
    ? runSimulationMoveCoverage(coverageOptions)
    : runSimulationMoveCoverageCatalog({ ...coverageOptions, populations });
await writeFile(
  "docs/architecture/simulation-move-coverage.json",
  `${canonicalJson(result.artifact)}\n`,
  "utf8",
);
console.log(
  `Generated ${result.artifact.dataset.records.length} move coverage records from ${result.runCount} runs (${result.failedRunCount} failed: ${JSON.stringify(result.failureTypes)}).`,
);
