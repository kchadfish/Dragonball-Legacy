import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { CANONICAL_COMBAT_MECHANICS_VIEW } from "@dragonball-resurgence/combat-engine";
import {
  ALL_SIMULATION_TEMPLATES,
  canonicalJson,
  createSimulationRunInventory,
  planSimulationStatisticsBackfill,
  readSimulationStatisticsArtifactV5,
  readSimulationStatisticsBackfillCheckpointV1,
  readSimulationCapabilitySelection,
  renderSimulationRunInventoryMarkdown,
  selectSimulationCapabilityRecipes,
  simulationV4CatalogCheckpointSchema,
  validateSimulationV4CatalogCheckpoint,
  validateSimulationStatisticsArtifactV5Closure,
  type SimulationV4CatalogCheckpoint,
} from "@dragonball-resurgence/simulation";

const directory = "artifacts/simulation/catalog-100-complete";
const original = "artifacts/simulation/catalog-v4-natural-100.json.checkpoint.json";
mkdirSync(directory, { recursive: true });
const pathFor = (name: string) => join(directory, name);
const json = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const write = (path: string, value: unknown) => {
  writeFileSync(`${path}.tmp`, `${canonicalJson(value)}\n`);
  renameSync(`${path}.tmp`, path);
};
const freeze = (path: string, text: string) => {
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") !== text) throw new Error(`Frozen identity mismatch: ${path}`);
    return;
  }
  writeFileSync(path, text, { flag: "wx", mode: 0o444 });
  chmodSync(path, 0o444);
};
const readV4 = (path: string) => {
  const checkpoint = simulationV4CatalogCheckpointSchema.parse(json(path));
  const issues = validateSimulationV4CatalogCheckpoint(checkpoint);
  if (issues.length) throw new Error(issues.join("\n"));
  return checkpoint;
};
const inventory = (
  checkpoint: Parameters<typeof createSimulationRunInventory>[0],
  path: string,
  name: string,
) => {
  const value = createSimulationRunInventory(checkpoint, path);
  write(pathFor(`${name}-inventory.json`), value);
  writeFileSync(pathFor(`${name}-inventory.md`), renderSimulationRunInventoryMarkdown(value));
  return value;
};
const selection = (
  anomalies?: Parameters<typeof selectSimulationCapabilityRecipes>[0]["anomalyFindings"],
) =>
  selectSimulationCapabilityRecipes({
    view: CANONICAL_COMBAT_MECHANICS_VIEW,
    templates: ALL_SIMULATION_TEMPLATES(),
    capabilityIds: [
      "restricted-use",
      "status-control",
      "transformation",
      ...(anomalies === undefined ? [] : ["anomaly" as const]),
    ],
    maxRecipesPerCapability: "all",
    ...(anomalies === undefined ? {} : { anomalyFindings: anomalies }),
  });
const recordSavedV4Baseline = (checkpoint: SimulationV4CatalogCheckpoint, path: string) => {
  const value = inventory(checkpoint, path, "v4");
  const issues = validateSimulationV4CatalogCheckpoint(checkpoint);
  write(pathFor("v4-baseline-status.json"), {
    status: "saved-baseline-incomplete",
    fightsRunForV4: 0,
    inventory: value,
    integrityIssues: issues,
  });
  if (value.cells.length !== 1128 || issues.length || value.unresolvedFailures.length)
    throw new Error(`Saved V4 baseline integrity check failed: ${issues.join(", ")}`);
};

const command = process.argv[2];
if (command === "prepare") {
  const text = readFileSync(original, "utf8");
  const checkpoint = readV4(original);
  freeze(pathFor("original.checkpoint.json"), text);
  freeze(pathFor("original.sha256"), `${sha256(text)}  original.checkpoint.json\n`);
  const recipes = selection();
  freeze(pathFor("capabilities.json"), `${canonicalJson(recipes)}\n`);
  const provenance = {
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    originalPath: original,
    originalSha256: sha256(text),
    manifest: checkpoint.manifest,
    templateIdentities: ALL_SIMULATION_TEMPLATES().map((template) => template.id),
    targetPairs: 100,
    workers: 8,
    outputDirectory: directory,
    recipeSelectionHash: recipes.selectionHash,
    limitation:
      "Coverage is restricted to definitions selectable in the current template catalog. Fight-count completion does not imply statistical sufficiency.",
  };
  freeze(pathFor("provenance.json"), `${canonicalJson(provenance)}\n`);
  inventory(checkpoint, original, "original");
  inventory(
    planSimulationStatisticsBackfill(checkpoint, {
      cellScope: "all",
      targetPairs: 100,
      workers: 8,
    }),
    pathFor("natural.json.checkpoint.json"),
    "planned-natural",
  );
  for (const role of ["controlled", "diagnostic"] as const)
    inventory(
      planSimulationStatisticsBackfill(checkpoint, {
        evidenceRole: role,
        capabilitySelection: recipes,
        targetPairs: 100,
        workers: 8,
      }),
      pathFor(`${role}.json.checkpoint.json`),
      `planned-${role}`,
    );
  console.log(
    JSON.stringify({
      recipeCount: recipes.recipes.length,
      analyticsRemainingBeforeAnomalies: 311400,
      v4ContinuationFightsAvoided: 223202,
      directory,
    }),
  );
} else if (command === "freeze-baseline") {
  const path = pathFor("original.checkpoint.json");
  recordSavedV4Baseline(readV4(path), path);
  const text = readFileSync(path, "utf8");
  freeze(pathFor("baseline.checkpoint.json"), text);
  freeze(pathFor("baseline.sha256"), `${sha256(text)}  baseline.checkpoint.json\n`);
} else if (command === "freeze-recipes") {
  const natural = readSimulationStatisticsArtifactV5(json(pathFor("natural.json")));
  const recipes = selection(natural.anomalies);
  freeze(pathFor("recipes.json"), `${canonicalJson(recipes)}\n`);
  const anomalyRecipes = recipes.recipes.filter((recipe) => recipe.capabilityId === "anomaly");
  write(pathFor("anomaly-selection.json"), {
    count: anomalyRecipes.length,
    additionalFights: anomalyRecipes.length * 600,
    recipes: anomalyRecipes,
    naturalArtifactHash: natural.artifactHash,
  });
  const baseline = readV4(pathFor("baseline.checkpoint.json"));
  for (const role of ["controlled", "diagnostic"] as const)
    inventory(
      planSimulationStatisticsBackfill(baseline, {
        evidenceRole: role,
        capabilitySelection: recipes,
        targetPairs: 100,
        workers: 8,
      }),
      pathFor(`${role}.json.checkpoint.json`),
      `selected-${role}`,
    );
} else if (command === "verify-v5") {
  const role = process.argv[3];
  if (!["natural", "controlled", "diagnostic"].includes(role ?? ""))
    throw new Error("Expected analytics role");
  const path = pathFor(`${role}.json.checkpoint.json`);
  const checkpoint = readSimulationStatisticsBackfillCheckpointV1(json(path));
  const artifact = readSimulationStatisticsArtifactV5(json(pathFor(`${role}.json`)));
  const value = inventory(checkpoint, path, role!);
  const issues = validateSimulationStatisticsArtifactV5Closure(artifact, checkpoint);
  const expectedCells =
    role === "natural"
      ? 1128
      : readSimulationCapabilitySelection(json(pathFor("recipes.json"))).recipes.length;
  if (
    value.cells.length !== expectedCells ||
    value.remainingFights ||
    value.unresolvedFailures.length ||
    issues.length
  )
    throw new Error(
      `Analytics completion check failed: ${JSON.stringify({ role, remaining: value.remainingFights, issues })}`,
    );
} else if (command === "final") {
  const baselineStatus = json(pathFor("v4-baseline-status.json"));
  const stages = ["natural", "controlled", "diagnostic"].map((role) =>
    json(pathFor(`${role}-inventory.json`)),
  );
  write(pathFor("completion-inventory.json"), {
    baseline: baselineStatus,
    analytics: stages,
    completedAt: new Date().toISOString(),
  });
  writeFileSync(
    pathFor("completion-inventory.md"),
    [
      "# Completed 100-pair analytics catalog",
      "",
      "The saved v4 checkpoint was used as the baseline and was not extended. Its incomplete cells are recorded in v4-baseline-status.json.",
      "",
      "[Saved v4 baseline inventory](v4-inventory.md)",
      ...["natural", "controlled", "diagnostic"].map(
        (role) => `[${role} inventory](${role}-inventory.md)`,
      ),
      "",
      "Statistical sufficiency and unavailable observations remain recorded separately in the inventories and evidence reports.",
      "",
    ].join("\n"),
  );
} else {
  throw new Error("Expected prepare, freeze-baseline, freeze-recipes, verify-v5, or final");
}
