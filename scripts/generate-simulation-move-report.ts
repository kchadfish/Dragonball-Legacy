import { readFile, writeFile } from "node:fs/promises";

import {
  createSimulationMoveBalanceReport,
  renderSimulationReportJson,
  renderSimulationReportMarkdown,
  simulationMoveCoverageArtifactSchema,
} from "../packages/simulation/src/index.js";

const artifact = simulationMoveCoverageArtifactSchema.parse(
  JSON.parse(await readFile("docs/architecture/simulation-move-coverage.json", "utf8")) as unknown,
);
const report = createSimulationMoveBalanceReport(artifact.dataset);
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
console.log(
  `Generated ${report.rows.length} simulation move balance rows (${report.freshnessHash}).`,
);
