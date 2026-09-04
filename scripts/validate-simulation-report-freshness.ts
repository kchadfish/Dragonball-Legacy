import { readFile } from "node:fs/promises";

import {
  createSimulationMoveBalanceReport,
  createSimulationMoveDossiers,
  renderSimulationMoveDossiersJson,
  renderSimulationReportJson,
  renderSimulationReportCsv,
  renderSimulationReportMarkdown,
  simulationMoveCoverageArtifactSchema,
} from "../packages/simulation/src/index.js";

const artifact = simulationMoveCoverageArtifactSchema.parse(
  JSON.parse(await readFile("docs/architecture/simulation-move-coverage.json", "utf8")) as unknown,
);
const expected = createSimulationMoveBalanceReport(artifact.dataset, undefined, {
  errors: artifact.errors,
  coverageCells: artifact.coverageCells,
  metricsByMove: artifact.metricsByMove,
  metricsByStratum: artifact.metricsByStratum,
  stratifiedAccumulators: artifact.stratifiedAccumulators,
  stratifiedAccumulatorsByStratum: artifact.stratifiedAccumulatorsByStratum,
  generatedFrom: artifact.generatedFrom,
});
const expectedDossiers = createSimulationMoveDossiers(artifact.dataset, {
  errors: artifact.errors,
  coverageCells: artifact.coverageCells,
  metricsByMove: artifact.metricsByMove,
  metricsByStratum: artifact.metricsByStratum,
  stratifiedAccumulators: artifact.stratifiedAccumulators,
  stratifiedAccumulatorsByStratum: artifact.stratifiedAccumulatorsByStratum,
  generatedFrom: artifact.generatedFrom,
});
const json = JSON.parse(
  await readFile("docs/architecture/simulation-move-balance-matrix.json", "utf8"),
) as unknown;
const markdown = await readFile("docs/architecture/simulation-move-balance-matrix.md", "utf8");
const csv = await readFile("docs/architecture/simulation-move-balance-matrix.csv", "utf8");
const dossiers = JSON.parse(
  await readFile("docs/architecture/simulation-move-dossiers.json", "utf8"),
) as unknown;
if (JSON.stringify(json) !== JSON.stringify(JSON.parse(renderSimulationReportJson(expected))))
  throw new Error("Simulation move balance JSON is stale.");
if (markdown !== renderSimulationReportMarkdown(expected))
  throw new Error("Simulation move balance Markdown is stale.");
if (csv !== renderSimulationReportCsv(expected))
  throw new Error("Simulation move balance CSV is stale.");
if (
  JSON.stringify(dossiers) !==
  JSON.stringify(JSON.parse(renderSimulationMoveDossiersJson(expectedDossiers)))
)
  throw new Error("Simulation move dossier JSON is stale.");
console.log(`Simulation move report freshness verified (${expected.freshnessHash}).`);
