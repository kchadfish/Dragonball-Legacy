import { describe, expect, it } from "vitest";
import { CANONICAL_COMBAT_MECHANICS_VIEW } from "@dragonball-resurgence/combat-engine";

import {
  createSimulationStatisticsArtifactV4,
  createSyntheticArchetypes,
  canonicalHash,
  migrateSimulationStatisticsArtifactV4ToV5,
  planSimulationStatisticsBackfill,
  readSimulationStatisticsArtifactV5,
  readSimulationStatisticsBackfillCheckpointV1,
  runSimulationStatisticsCatalogV4,
  runSimulationStatisticsBackfill,
  validateSimulationStatisticsArtifactV5Closure,
} from "./index.js";

describe("simulation statistics v5 selective backfill", () => {
  it("selects only evidence-bearing cells and excludes every other cell", () => {
    const source = runSimulationStatisticsCatalogV4({
      templates: createSyntheticArchetypes(CANONICAL_COMBAT_MECHANICS_VIEW).slice(0, 2),
      targetPairs: 1,
      batchSize: 1,
    }).checkpoint;
    const cells = source.cells.map((cell) => ({ ...cell, sparseStatus: "sufficient" as const }));
    const checkpointValue = {
      ...source,
      cells,
      canonicalResultOrderHash: canonicalHash(cells),
    };
    const checkpointWithoutHash = Object.fromEntries(
      Object.entries(checkpointValue).filter(([key]) => key !== "checkpointHash"),
    );
    const baseline = {
      ...checkpointValue,
      checkpointHash: canonicalHash(checkpointWithoutHash),
    };
    const plan = planSimulationStatisticsBackfill(baseline, {
      targetPairs: 1,
      baselineSha256: "cf5766224446540320438c98b98faaef34bc81fa38f1ca1fd8f3d7a4aa58aae1",
      quarantinedCheckpoint: {
        checkpointHash: "fnv1a-32:quarantined",
        sha256: "66c81ac1f573c0e147f8dd2c200ef62c5ea0d6ecad39c48d420aa11a81962bc0",
      },
    });

    expect(plan.cells).toHaveLength(1);
    expect(plan.cells.every((cell) => cell.disposition === "selected")).toBe(true);
    expect(plan.manifest).toMatchObject({
      targetPairs: 1,
      workers: 4,
      maximumInFlight: 8,
      checkpointEveryPairs: 5,
      rootSeed: source.manifest.rootSeed,
    });
    expect(readSimulationStatisticsBackfillCheckpointV1(plan)).toEqual(plan);
    expect(() =>
      readSimulationStatisticsBackfillCheckpointV1({ ...plan, checkpointHash: "tampered" }),
    ).toThrow(/checkpoint hash mismatch/u);
    const completed = runSimulationStatisticsBackfill({ baseline, checkpoint: plan, workers: 1 });
    expect(completed.checkpoint.cells[0]?.pairIdentities).toHaveLength(2);
    expect(completed.checkpoint.sequences.length).toBeGreaterThan(0);
    expect(
      validateSimulationStatisticsArtifactV5Closure(completed.artifact, completed.checkpoint),
    ).toEqual([]);
  }, 180_000);

  it("migrates v4 metrics byte-for-byte and marks unavailable provenance unknown", () => {
    const legacy = createSimulationStatisticsArtifactV4({
      catalogId: "catalog:fixture",
      mechanicsIdentity: "mechanics:fixture",
      rootSeed: 42,
      targetPairs: 1,
      sourceLimitations: ["fixture"],
    });
    const migrated = migrateSimulationStatisticsArtifactV4ToV5(legacy);

    expect(migrated.metrics).toEqual(legacy.metrics);
    expect(Object.values(migrated.metricLineage)).toEqual([]);
    expect(migrated.limitations).toContain("Unavailable historical provenance is unknown.");
    expect(readSimulationStatisticsArtifactV5(migrated)).toEqual(migrated);
  });
});
