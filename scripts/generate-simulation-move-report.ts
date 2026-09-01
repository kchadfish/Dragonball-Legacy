import { readFile, writeFile } from "node:fs/promises";

import {
  createSimulationMoveBalanceReport,
  createSimulationMoveDossiers,
  renderSimulationReportJson,
  renderSimulationReportCsv,
  renderSimulationReportMarkdown,
  renderSimulationMoveDossiersJson,
  simulationMoveCoverageArtifactSchema,
} from "../packages/simulation/src/index.js";

const artifact = simulationMoveCoverageArtifactSchema.parse(
  JSON.parse(await readFile("docs/architecture/simulation-move-coverage.json", "utf8")) as unknown,
);
const report = createSimulationMoveBalanceReport(artifact.dataset, undefined, {
  errors: artifact.errors,
  coverageCells: artifact.coverageCells,
  metricsByMove: artifact.metricsByMove,
  stratifiedAccumulators: artifact.stratifiedAccumulators,
  generatedFrom: artifact.generatedFrom,
});
const dossiers = createSimulationMoveDossiers(artifact.dataset, {
  errors: artifact.errors,
  coverageCells: artifact.coverageCells,
  metricsByMove: artifact.metricsByMove,
  stratifiedAccumulators: artifact.stratifiedAccumulators,
  generatedFrom: artifact.generatedFrom,
});
await writeFile(
  "docs/architecture/simulation-move-balance-matrix.json",
  `${renderSimulationReportJson(report)}\n`,
  "utf8",
);
await writeFile(
  "docs/architecture/simulation-move-balance-matrix.md",
  renderSimulationReportMarkdown(report),
  "utf8",
);
await writeFile(
  "docs/architecture/simulation-move-balance-matrix.csv",
  renderSimulationReportCsv(report),
  "utf8",
);
await writeFile(
  "docs/architecture/simulation-move-dossiers.json",
  `${renderSimulationMoveDossiersJson(dossiers)}\n`,
  "utf8",
);
console.log(
  `Generated ${report.rows.length} simulation move balance rows and ${dossiers.length} dossiers (${report.freshnessHash}).`,
);
