import { describe, expect, it } from "vitest";

import {
  detectSimulationAnomalyAggregates,
  type SimulationAnomalyAggregateInput,
} from "./index.js";

describe("aggregate simulation anomalies", () => {
  it("reports population confidence, seeds, and contributing actions", () => {
    const input: SimulationAnomalyAggregateInput = {
      rule: {
        id: "simulation-anomaly-rule:selection",
        version: "simulation-anomaly-rules:v1",
        code: "selection-rate",
        threshold: 0.5,
        population: "normal-natural-catalog",
        recommendation: "Inspect the selected action distribution.",
      },
      observations: [
        { runId: "run:b", value: 1, triggered: true, contributingActions: ["move:b"] },
        { runId: "run:a", value: 0, triggered: false, contributingActions: [] },
        { runId: "run:c", value: 1, triggered: true, contributingActions: ["move:a"] },
      ],
      investigationTarget: "move:selection-rate",
    };
    const [finding] = detectSimulationAnomalyAggregates([input]);
    expect(finding).toMatchObject({
      sampleCount: 3,
      population: "normal-natural-catalog",
      uncertainty: "wilson-95",
      representativeRunIds: ["run:b", "run:c"],
      contributingActions: ["move:a", "move:b"],
      investigationTarget: "move:selection-rate",
    });
    expect(finding?.confidenceInterval.lower).toBeLessThanOrEqual(
      finding?.confidenceInterval.upper ?? 0,
    );
  });
});
