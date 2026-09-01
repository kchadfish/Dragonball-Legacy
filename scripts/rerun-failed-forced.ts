import { readFile, writeFile } from "node:fs/promises";

import {
  canonicalJson,
  runSimulationMoveCoverage,
  runSimulationMoveCoverageCatalog,
} from "../packages/simulation/src/index.js";
import type { SimulationMoveCoverageArtifact } from "../packages/simulation/src/index.js";

const artifactPath = "docs/architecture/simulation-move-coverage.json";
const source = JSON.parse(await readFile(artifactPath, "utf8")) as SimulationMoveCoverageArtifact;
const moveIds = [...new Set(source.errors.map((error) => error.moveId))].sort();
const inspectMoveId = process.argv[2];
if (inspectMoveId !== undefined) {
  const result = runSimulationMoveCoverage({
    moveIds: [inspectMoveId],
    targetFights: 1,
    minimumEligibleStates: 10,
    concurrency: 1,
    workers: 4,
    population: "forced",
  });
  console.log(JSON.stringify(result.failures, null, 2));
  process.exit(0);
}
const result = runSimulationMoveCoverageCatalog({
  moveIds,
  targetFights: 1,
  minimumEligibleStates: 10,
  concurrency: 1,
  workers: 4,
  populations: ["forced"],
  resumeFrom: source,
  retryFailed: true,
});
await writeFile(artifactPath, `${canonicalJson(result.artifact)}\n`, "utf8");
console.log(
  JSON.stringify(
    {
      moveCount: moveIds.length,
      runCount: result.runCount,
      failedRunCount: result.failedRunCount,
      failureTypes: result.failureTypes,
    },
    null,
    2,
  ),
);
