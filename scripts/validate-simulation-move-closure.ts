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
const issues = [
  ...validateSimulationMoveCoverageArtifact(artifact),
  ...validateSimulationMoveClosure(artifact.dataset, {}, CANONICAL_COMBAT_MECHANICS_VIEW),
  ...validateSimulationCoverageCells(artifact.coverageCells),
  ...[...expectedMoveIds]
    .filter((moveId) => !actualMoveIds.has(moveId))
    .map((moveId) => `Coverage artifact lacks canonical move: ${moveId}`),
  ...[...actualMoveIds]
    .filter((moveId) => !expectedMoveIds.has(moveId))
    .map((moveId) => `Coverage artifact contains unknown move: ${moveId}`),
];
const audit = createSimulationCompletionAudit(artifact.dataset, artifact.coverageCells);
if (!audit.complete) issues.push(...audit.issues.filter((issue) => !issues.includes(issue)));
if (issues.length > 0) {
  console.error(`Simulation move closure has ${issues.length} issue(s):`);
  console.error(issues.join("\n"));
  process.exitCode = 1;
} else
  console.log(`Simulation move closure is complete for ${artifact.dataset.records.length} moves.`);
