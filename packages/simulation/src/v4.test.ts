import { describe, expect, it } from "vitest";

import {
  SIMULATION_STATISTICS_ARTIFACT_VERSION,
  SIMULATION_V4_CONTINUATION_CEILING,
  createSimulationDashboard,
  createSimulationDashboardFromBundle,
  createSimulationMetricAggregateV2,
  simulationMetricAggregateV2Schema,
  createSimulationStatisticsBundleV1,
  createSimulationStatisticsArtifactV4,
  addSimulationMetricObservationV2,
  mergeSimulationMetricAggregatesV2,
  renderSimulationDashboardCsv,
  renderSimulationDashboardJson,
  renderSimulationDashboardMarkdown,
  simulationStatisticsArtifactV4Schema,
  simulationStatisticsDimensionsSchema,
  readSimulationStatisticsBundleV1,
  readSimulationStatisticsArtifactV4,
} from "./index.js";

const dimensions = {
  templateId: "template:alpha",
  buildId: "build:alpha",
  styleMatchup: "style:alpha-vs-style:beta",
  checkpointId: "early",
  level: "level:1",
  statAllocation: "fixed-total",
  hpDifferential: 0,
  powerDifferential: 5,
  dexterityDifferential: -2,
  aiProfile: "profile:normal",
  side: "a" as const,
  initiativeWinner: "a" as const,
  firstActor: "a" as const,
  evidenceRole: "natural-balance" as const,
  exposurePopulation: "natural" as const,
};

describe("simulation statistics v4", () => {
  it("uses the v4 schemas and rejects v3 artifacts on the dashboard path", () => {
    const artifact = createSimulationStatisticsArtifactV4({
      catalogId: "catalog:natural-normal-100",
      mechanicsIdentity: "mechanics:test",
      rootSeed: 7,
      targetPairs: 100,
    });
    expect(artifact.schemaVersion).toBe(SIMULATION_STATISTICS_ARTIFACT_VERSION);
    expect(simulationStatisticsArtifactV4Schema.safeParse(artifact).success).toBe(true);
    expect(
      simulationStatisticsArtifactV4Schema.safeParse({
        ...artifact,
        schemaVersion: "simulation-move-coverage-artifact:v3",
      }).success,
    ).toBe(false);
  });

  it("folds bounded Welford, histogram, quantile, and denominator evidence", () => {
    let metric = createSimulationMetricAggregateV2({
      metricId: "core:mirrored-win-rate",
      dimensions,
      unit: "proportion",
      intervalMethod: "wilson-95",
    });
    metric = addSimulationMetricObservationV2(metric, {
      value: 1,
      success: true,
      eligible: true,
      completed: true,
      pairId: "pair:1",
      pairedDifference: 1,
      replaySeed: 11,
    });
    metric = addSimulationMetricObservationV2(metric, {
      value: 0,
      success: false,
      eligible: true,
      completed: true,
      pairId: "pair:2",
      pairedDifference: -1,
      replaySeed: 13,
    });
    expect(metric.denominators).toEqual({
      attempted: 2,
      eligible: 2,
      completed: 2,
      incomplete: 0,
      forced: 0,
      errors: 0,
    });
    expect(metric.successes).toBe(1);
    expect(metric.values.mean).toBe(0.5);
    expect(
      (metric.histogram?.counts.reduce((sum, count) => sum + count, 0) ?? 0) +
        (metric.histogram?.underflow ?? 0) +
        (metric.histogram?.overflow ?? 0),
    ).toBe(2);
    expect(metric.quantiles?.count).toBe(2);
    expect(metric.pairedObservations).toHaveLength(2);
    expect(metric.representativeReplaySeeds).toEqual([11, 13]);
  });

  it("merges metrics deterministically regardless of operand order", () => {
    const make = (pairId: string, value: number) =>
      addSimulationMetricObservationV2(
        createSimulationMetricAggregateV2({
          metricId: "core:turns",
          dimensions,
          unit: "turns",
        }),
        { value, completed: true, eligible: true, pairId, pairedDifference: value },
      );
    const left = mergeSimulationMetricAggregatesV2(make("pair:1", 5), make("pair:2", 10));
    const right = mergeSimulationMetricAggregatesV2(make("pair:2", 10), make("pair:1", 5));
    expect(left).toEqual(right);
  });

  it("renders deterministic dashboard projections with explicit limitations", () => {
    const metric = addSimulationMetricObservationV2(
      createSimulationMetricAggregateV2({
        metricId: "core:mirrored-win-rate",
        dimensions,
        unit: "proportion",
        intervalMethod: "wilson-95",
      }),
      { value: 1, success: true, eligible: true, completed: true, replaySeed: 17 },
    );
    const artifact = createSimulationStatisticsArtifactV4({
      catalogId: "catalog:natural-normal-100",
      mechanicsIdentity: "mechanics:test",
      rootSeed: 7,
      targetPairs: 100,
      sourceLimitations: [
        "Natural Normal exposure does not prove never-eligible moves are balanced.",
      ],
      metrics: { ["core:mirrored-win-rate"]: metric },
    });
    const dashboard = createSimulationDashboard(artifact);
    expect(dashboard.rows[0]).toMatchObject({
      numerator: 1,
      denominator: 1,
      sampleSize: 1,
      evidenceLabel: "observed",
    });
    expect(renderSimulationDashboardJson(dashboard)).toBe(renderSimulationDashboardJson(dashboard));
    expect(renderSimulationDashboardCsv(dashboard)).toContain("metricId,dimensionKey,numerator");
    expect(renderSimulationDashboardMarkdown(dashboard)).toContain("Source limitations");
  });

  it("caps v4 continuation at 400 pairs", () => {
    expect(SIMULATION_V4_CONTINUATION_CEILING).toBe(400);
    expect(() =>
      createSimulationStatisticsArtifactV4({
        catalogId: "catalog:invalid",
        mechanicsIdentity: "mechanics:test",
        rootSeed: 0,
        targetPairs: SIMULATION_V4_CONTINUATION_CEILING + 1,
      }),
    ).toThrow(/between 1 and 400/);
  });

  it("validates explicit dimensions rather than accepting array-position identities", () => {
    expect(simulationStatisticsDimensionsSchema.safeParse(dimensions).success).toBe(true);
    expect(
      simulationStatisticsDimensionsSchema.safeParse({
        ...dimensions,
        side: "index-0",
      }).success,
    ).toBe(false);
  });

  it("bundles natural, controlled, and diagnostic evidence without pooling roles", () => {
    const artifactFor = (evidenceRole: "natural-balance" | "controlled" | "diagnostic") =>
      createSimulationStatisticsArtifactV4({
        catalogId: `catalog:${evidenceRole}`,
        mechanicsIdentity: "mechanics:test",
        rootSeed: 7,
        targetPairs: 100,
        evidenceRole,
        exposurePopulation: evidenceRole === "natural-balance" ? "natural" : "isolation",
      });
    const bundle = createSimulationStatisticsBundleV1({
      natural: artifactFor("natural-balance"),
      controlled: artifactFor("controlled"),
      diagnostic: artifactFor("diagnostic"),
      checkpointHashes: { natural: "n", controlled: "c", diagnostic: "d" },
    });
    expect(readSimulationStatisticsBundleV1(bundle)).toEqual(bundle);
    expect(createSimulationDashboardFromBundle(bundle).rows).toEqual([]);
    expect(() =>
      createSimulationStatisticsBundleV1({
        natural: artifactFor("controlled"),
        controlled: artifactFor("controlled"),
        diagnostic: artifactFor("diagnostic"),
        checkpointHashes: { natural: "n", controlled: "c", diagnostic: "d" },
      }),
    ).toThrow(/evidence roles/);
  });

  it("retains fractional draw-aware success mass and verifies nested artifact hashes", () => {
    const metric = addSimulationMetricObservationV2(
      createSimulationMetricAggregateV2({
        metricId: "simulation:mirrored-adjusted-win-rate",
        dimensions,
        unit: "proportion",
        intervalMethod: "wilson-95",
      }),
      {
        value: 0.5,
        successWeight: 0.5,
        eligible: true,
        completed: true,
        pairId: "pair:draw",
        pairedDifference: 0,
      },
    );
    expect(metric.successes).toBe(0.5);
    expect(simulationMetricAggregateV2Schema.safeParse(metric).success).toBe(true);
    const artifact = createSimulationStatisticsArtifactV4({
      catalogId: "catalog:hash-check",
      mechanicsIdentity: "mechanics:test",
      rootSeed: 7,
      targetPairs: 100,
      metrics: { metric: { ...metric, metricHash: metric.metricHash } },
    });
    expect(readSimulationStatisticsArtifactV4(artifact)).toEqual(artifact);
    expect(() =>
      readSimulationStatisticsArtifactV4({ ...artifact, artifactHash: "tampered" }),
    ).toThrow(/artifact hash mismatch/);
  });
});
