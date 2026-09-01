import { readFile } from "node:fs/promises";

import {
  createSimulationMoveBalanceReport,
  renderSimulationReportJson,
  renderSimulationReportMarkdown,
  simulationMoveCoverageArtifactSchema,
} from "../packages/simulation/src/index.js";

const artifact = simulationMoveCoverageArtifactSchema.parse(
  JSON.parse(await readFile("docs/architecture/simulation-move-coverage.json", "utf8")) as unknown,
);
const expected = createSimulationMoveBalanceReport(artifact.dataset);
const json = JSON.parse(
  await readFile("docs/architecture/simulation-move-balance-matrix.json", "utf8"),
) as unknown;
const markdown = await readFile("docs/architecture/simulation-move-balance-matrix.md", "utf8");
if (JSON.stringify(json) !== JSON.stringify(JSON.parse(renderSimulationReportJson(expected))))
  throw new Error("Simulation move balance JSON is stale.");
if (markdown !== renderSimulationReportMarkdown(expected))
  throw new Error("Simulation move balance Markdown is stale.");
console.log(`Simulation move report freshness verified (${expected.freshnessHash}).`);
