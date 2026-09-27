import type { SimulationV4CatalogCheckpoint } from "./catalog-v4-runner.js";
import type { SimulationStatisticsBackfillCheckpointV1 } from "./statistics-v5.js";

const missingFights = (
  cellId: string,
  target: number,
  branches: readonly string[],
  saved: ReadonlySet<string> | undefined,
  execution: SimulationV4CatalogCheckpoint["cells"][number] | undefined,
): string[] => {
  const missing: string[] = [];
  for (let iteration = 0; iteration < target; iteration++)
    for (const mirror of ["original", "mirrored"])
      for (const branch of branches) {
        const key = `${iteration}:${mirror}:${branch}`;
        const complete =
          saved === undefined
            ? execution?.completedIterations.includes(iteration) ||
              Object.hasOwn(execution?.acceptedMirrorResults ?? {}, key)
            : saved.has(`${cellId}:${key}`);
        if (!complete) missing.push(key);
      }
  return missing;
};

/** Fight-count completion is deliberately independent of statistical sufficiency. */
export const createSimulationRunInventory = (
  checkpoint: SimulationV4CatalogCheckpoint | SimulationStatisticsBackfillCheckpointV1,
  checkpointPath: string,
) => {
  const analytics = checkpoint.schemaVersion === "simulation-statistics-backfill-checkpoint:v1";
  const target = analytics
    ? checkpoint.manifest.targetPairs
    : checkpoint.manifest.requestedTargetPairs;
  const role = analytics ? checkpoint.manifest.evidenceRole : checkpoint.manifest.evidenceRoles[0];
  const branches = role === "controlled" ? ["baseline", "variant"] : ["baseline"];
  const cells = checkpoint.cells.map((cell) => {
    const execution = analytics
      ? checkpoint.executionCheckpoint?.cells.find((entry) => entry.cellId === cell.cellId)
      : undefined;
    const v4Cell = "completedIterations" in cell ? cell : execution;
    const saved = "pairIdentities" in cell ? new Set(cell.pairIdentities) : undefined;
    const missing = missingFights(cell.cellId, target, branches, saved, v4Cell);
    const requiredFights = target * 2 * branches.length;
    return {
      cellId: cell.cellId,
      templateAId: cell.templateAId,
      templateBId: cell.templateBId,
      recipeId: analytics
        ? checkpoint.manifest.capabilitySelection?.recipes.find(
            (recipe) => recipe.cellId === cell.cellId,
          )?.recipeId
        : undefined,
      targetPairs: target,
      savedFights: requiredFights - missing.length,
      requiredFights,
      missing,
      failures: cell.failures,
      statisticalSufficiency: v4Cell?.sparseStatus ?? "pending",
      continuationPairs:
        v4Cell?.completedIterations.filter((iteration) => iteration >= target).length ?? 0,
      collectors: "collectorCompletion" in cell ? cell.collectorCompletion : undefined,
      checkpointPath,
    };
  });
  return {
    checkpointPath,
    checkpointHash: checkpoint.checkpointHash,
    role,
    targetPairs: target,
    cells,
    completeCells: cells.filter((cell) => cell.missing.length === 0).length,
    unstartedCells: cells.filter((cell) => cell.savedFights === 0).length,
    savedFights: cells.reduce((sum, cell) => sum + cell.savedFights, 0),
    remainingFights: cells.reduce((sum, cell) => sum + cell.missing.length, 0),
    unresolvedFailures: cells.flatMap((cell) => cell.failures),
    continuationPairs: cells.reduce((sum, cell) => sum + cell.continuationPairs, 0),
  };
};

export const renderSimulationRunInventoryMarkdown = (
  inventory: ReturnType<typeof createSimulationRunInventory>,
): string =>
  [
    `# ${inventory.role} completion inventory`,
    "",
    `Checkpoint: ${inventory.checkpointPath} (${inventory.checkpointHash})`,
    `Target: ${inventory.targetPairs} mirrored pairs. Saved: ${inventory.savedFights} fights. Remaining: ${inventory.remainingFights}. Failures: ${inventory.unresolvedFailures.length}.`,
    `Sparse continuation: ${inventory.continuationPairs} pairs. Fight counts do not establish statistical sufficiency.`,
    "",
    "| Cell / recipe | Saved / required fights | Missing iteration:orientation:branch | Failures | Sufficiency |",
    "| --- | --- | --- | --- | --- |",
    ...inventory.cells.map(
      (cell) =>
        `| ${cell.recipeId ?? cell.cellId} | ${cell.savedFights}/${cell.requiredFights} | ${cell.missing.join(", ")} | ${cell.failures.join(", ")} | ${cell.statisticalSufficiency} |`,
    ),
    "",
  ].join("\n");
