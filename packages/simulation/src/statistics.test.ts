import { describe, expect, it } from "vitest";

import {
  addSimulationHistogramValue,
  addSimulationPairedDifference,
  addSimulationValue,
  createSimulationHistogram,
  createSimulationMeanVariance,
  createSimulationPairedDifferenceAggregate,
  createSimulationQuantileSketch,
  addSimulationQuantileValue,
  mergeSimulationHistograms,
  mergeSimulationMeanVariances,
  mergeSimulationPairedDifferences,
  mergeSimulationQuantileSketches,
  seededBootstrapPairedDifference,
  simulationQuantile,
  simulationStandardDeviation,
  simulationVariance,
  summarizeSimulationRate,
  adjustSimulationPValues,
  wilsonInterval,
} from "./index.js";

describe("simulation mergeable statistics", () => {
  it("merges Welford aggregates deterministically", () => {
    const left = [1, 2, 3].reduce(addSimulationValue, createSimulationMeanVariance());
    const right = [4, 5].reduce(addSimulationValue, createSimulationMeanVariance());
    const merged = mergeSimulationMeanVariances(left, right);
    const direct = [1, 2, 3, 4, 5].reduce(addSimulationValue, createSimulationMeanVariance());
    expect(merged).toEqual(direct);
    expect(merged.mean).toBe(3);
    expect(simulationVariance(merged)).toBe(2.5);
    expect(simulationStandardDeviation(merged)).toBeCloseTo(Math.sqrt(2.5));
  });

  it("keeps histogram bins and quantiles bounded and mergeable", () => {
    const first = [0, 1, 2, 4].reduce(
      addSimulationHistogramValue,
      createSimulationHistogram([1, 3]),
    );
    const second = [-1, 3, 5].reduce(
      addSimulationHistogramValue,
      createSimulationHistogram([1, 3]),
    );
    expect(mergeSimulationHistograms(first, second)).toEqual({
      boundaries: [1, 3],
      counts: [0, 2, 0],
      underflow: 2,
      overflow: 3,
    });
    const left = [1, 2, 3].reduce(addSimulationQuantileValue, createSimulationQuantileSketch(2));
    const right = [4, 5].reduce(addSimulationQuantileValue, createSimulationQuantileSketch(2));
    const merged = mergeSimulationQuantileSketches(left, right);
    expect(merged.centroids.length).toBeLessThanOrEqual(2);
    expect(simulationQuantile(merged, 0.5)).toBeDefined();
  });

  it("preserves stable paired identities and rejects conflicting merges", () => {
    const left = addSimulationPairedDifference(
      createSimulationPairedDifferenceAggregate(),
      "fight:a",
      2,
    );
    const right = addSimulationPairedDifference(
      createSimulationPairedDifferenceAggregate(),
      "fight:b",
      -1,
    );
    expect(mergeSimulationPairedDifferences(left, right).observations).toEqual([
      { identity: "fight:a", difference: 2 },
      { identity: "fight:b", difference: -1 },
    ]);
    expect(() =>
      mergeSimulationPairedDifferences(
        left,
        addSimulationPairedDifference(createSimulationPairedDifferenceAggregate(), "fight:a", 3),
      ),
    ).toThrow(RangeError);
  });

  it("returns bounded Wilson and seeded bootstrap intervals", () => {
    const interval = wilsonInterval(0, 10);
    expect(interval.lower).toBe(0);
    expect(interval.upper).toBeGreaterThan(0);
    const observations = [
      { identity: "b", difference: 2 },
      { identity: "a", difference: 1 },
      { identity: "c", difference: 3 },
    ];
    const first = seededBootstrapPairedDifference(observations, 77, { resamples: 100 });
    const second = seededBootstrapPairedDifference([...observations].reverse(), 77, {
      resamples: 100,
    });
    expect(first).toEqual(second);
    expect(first.estimate).toBe(2);
    expect(first.lower).toBeLessThanOrEqual(first.upper);
    expect(summarizeSimulationRate(5, 10).rate).toBe(0.5);
    expect(
      adjustSimulationPValues([
        { identity: "b", pValue: 0.04 },
        { identity: "a", pValue: 0.01 },
      ]),
    ).toEqual([
      { identity: "a", pValue: 0.01, adjustedPValue: 0.02, exploratoryFlag: true },
      { identity: "b", pValue: 0.04, adjustedPValue: 0.04, exploratoryFlag: true },
    ]);
  });
});
