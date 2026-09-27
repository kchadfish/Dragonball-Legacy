import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CANONICAL_COMBAT_MECHANICS_VIEW } from "@dragonball-resurgence/combat-engine";
import {
  ALL_SIMULATION_TEMPLATES,
  assertSimulationStatisticsBackfillResume,
  canonicalHash,
  createSimulationRunInventory,
  planSimulationStatisticsBackfill,
  readSimulationStatisticsBackfillCheckpointV1,
  selectSimulationCapabilityRecipes,
  simulationV4CatalogCheckpointSchema,
  validateSimulationV4CatalogCheckpoint,
} from "@dragonball-resurgence/simulation";

const baseline = simulationV4CatalogCheckpointSchema.parse(
  JSON.parse(
    readFileSync(
      new URL(
        "../artifacts/simulation/catalog-v4-natural-100.json.checkpoint.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ),
);

describe("100-pair catalog preparation", () => {
  it("accounts for every saved fight independently of sufficiency", () => {
    expect(validateSimulationV4CatalogCheckpoint(baseline)).toEqual([]);
    const inventory = createSimulationRunInventory(baseline, "original.checkpoint.json");
    expect(inventory.cells).toHaveLength(1128);
    expect(inventory.completeCells).toBe(11);
    expect(inventory.unstartedCells).toBe(1116);
    expect(inventory.remainingFights).toBe(223202);
    expect(inventory.cells.filter((cell) => cell.missing.length === 2)).toHaveLength(1);
    expect(inventory.unresolvedFailures).toEqual([]);
  });

  it("selects the entire catalog while preserving the older default", () => {
    const all = planSimulationStatisticsBackfill(baseline, {
      cellScope: "all",
      baselineSha256: "original",
    });
    expect(all.cells).toHaveLength(1128);
    const legacy = planSimulationStatisticsBackfill(baseline);
    expect(legacy.cells.length).toBe(
      baseline.cells.filter((cell) => cell.sparseStatus === "sufficient").length,
    );
    expect(legacy.manifest.cellScope).toBeUndefined();
    expect(readSimulationStatisticsBackfillCheckpointV1(legacy)).toEqual(legacy);
    assertSimulationStatisticsBackfillResume(
      legacy,
      planSimulationStatisticsBackfill(baseline, { cellScope: "sufficient", workers: 8 }),
    );
    expect(() => assertSimulationStatisticsBackfillResume(legacy, all)).toThrow(/mismatch/);
    for (const options of [
      { targetPairs: 99 },
      { evidenceRole: "controlled" as const },
      { baselineSha256: "different" },
    ]) {
      expect(() =>
        assertSimulationStatisticsBackfillResume(
          all,
          planSimulationStatisticsBackfill(baseline, {
            cellScope: "all",
            baselineSha256: "original",
            ...options,
          }),
        ),
      ).toThrow(/mismatch/);
    }
  }, 30_000);

  it("freezes one deterministic recipe per eligible definition without the representative cap", () => {
    const input = {
      view: CANONICAL_COMBAT_MECHANICS_VIEW,
      templates: ALL_SIMULATION_TEMPLATES(),
      capabilityIds: ["restricted-use", "status-control", "transformation"] as const,
    };
    const all = selectSimulationCapabilityRecipes({ ...input, maxRecipesPerCapability: "all" });
    expect(all.recipes).toHaveLength(143);
    expect(all.recipes.filter((recipe) => recipe.capabilityId === "restricted-use")).toHaveLength(
      85,
    );
    expect(all.recipes.filter((recipe) => recipe.capabilityId === "status-control")).toHaveLength(
      51,
    );
    expect(all.recipes.filter((recipe) => recipe.capabilityId === "transformation")).toHaveLength(
      7,
    );
    expect(
      selectSimulationCapabilityRecipes({
        ...input,
        templates: [...input.templates].reverse(),
        maxRecipesPerCapability: "all",
      }),
    ).toEqual(all);
    const capped = selectSimulationCapabilityRecipes(input);
    expect(capped.recipes).toHaveLength(31);
    const plan = planSimulationStatisticsBackfill(baseline, {
      evidenceRole: "controlled",
      capabilitySelection: all,
    });
    expect(createSimulationRunInventory(plan, "controlled").remainingFights).toBe(57200);
    expect(() =>
      assertSimulationStatisticsBackfillResume(
        plan,
        planSimulationStatisticsBackfill(baseline, {
          evidenceRole: "controlled",
          capabilitySelection: capped,
        }),
      ),
    ).toThrow(/mismatch/);
    const noAnomalies = selectSimulationCapabilityRecipes({
      ...input,
      capabilityIds: ["anomaly"],
      maxRecipesPerCapability: "all",
      anomalyFindings: [],
    });
    expect(noAnomalies.recipes).toEqual([]);
  }, 30_000);

  it("counts partial branches and orientations without duplicating saved work", () => {
    const planned = planSimulationStatisticsBackfill(baseline, {
      cellScope: "all",
      evidenceRole: "controlled",
      targetPairs: 1,
    });
    const cell = planned.cells[0]!;
    const identities = [`${cell.cellId}:0:original:baseline`, `${cell.cellId}:0:mirrored:variant`];
    const partial = { ...planned, cells: [{ ...cell, pairIdentities: identities }] };
    const inventory = createSimulationRunInventory(partial, "partial");
    expect(inventory.savedFights).toBe(2);
    expect(inventory.cells[0]?.missing).toEqual(["0:original:variant", "0:mirrored:baseline"]);
    expect(canonicalHash(planned)).toBe(
      canonicalHash(
        planSimulationStatisticsBackfill(baseline, {
          cellScope: "all",
          evidenceRole: "controlled",
          targetPairs: 1,
        }),
      ),
    );
  }, 30_000);
});
