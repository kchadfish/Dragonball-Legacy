import { readFile } from "node:fs/promises";

import { CANONICAL_COMBAT_MECHANICS_VIEW } from "@dragonball-resurgence/combat-engine";

import {
  createSimulationCompletionAudit,
  simulationMoveCoverageArtifactSchema,
  validateSimulationMoveCoverageArtifact,
  validateSimulationMoveClosure,
  validateSimulationCoverageCells,
} from "../packages/simulation/src/index.js";

const artifact = simulationMoveCoverageArtifactSchema.parse(
  JSON.parse(await readFile("docs/architecture/simulation-move-coverage.json", "utf8")) as unknown,
);
const expectedMoveIds = new Set(CANONICAL_COMBAT_MECHANICS_VIEW.moves.map((move) => move.id));
const actualMoveIds = new Set(artifact.dataset.records.map((record) => record.moveId));
const allowsNaturalNotScheduled =
  artifact.generatedFrom.naturalPopulation === "draft" &&
  artifact.generatedFrom.naturalPopulationBlocker !== undefined;
const issues = [
  ...validateSimulationMoveCoverageArtifact(artifact),
  ...validateSimulationMoveClosure(artifact.dataset, {}, CANONICAL_COMBAT_MECHANICS_VIEW, {
    allowNaturalNotScheduled: allowsNaturalNotScheduled,
  }),
  ...validateSimulationCoverageCells(artifact.coverageCells, {
    allowNaturalNotScheduled: allowsNaturalNotScheduled,
  }),
  ...[...expectedMoveIds]
    .filter((moveId) => !actualMoveIds.has(moveId))
    .map((moveId) => `Coverage artifact lacks canonical move: ${moveId}`),
  ...[...actualMoveIds]
    .filter((moveId) => !expectedMoveIds.has(moveId))
    .map((moveId) => `Coverage artifact contains unknown move: ${moveId}`),
];
const audit = createSimulationCompletionAudit(artifact.dataset, artifact.coverageCells, {
  allowNaturalNotScheduled: allowsNaturalNotScheduled,
});
if (!audit.complete) issues.push(...audit.issues.filter((issue) => !issues.includes(issue)));
if (issues.length > 0) {
  console.error(`Simulation move closure has ${issues.length} issue(s):`);
  console.error(issues.join("\n"));
  process.exitCode = 1;
} else
  console.log(`Simulation move closure is complete for ${artifact.dataset.records.length} moves.`);
