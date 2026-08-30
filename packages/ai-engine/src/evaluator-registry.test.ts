import { describe, expect, it } from "vitest";

import {
  allAiEvaluatorRegistryEntries,
  legalDecisionEvaluatorRegistry,
  legalDecisionTypes,
  pendingDecisionEvaluatorRegistry,
  pendingDecisionTypes,
  responseShapeEvaluatorRegistry,
  responseShapeTypes,
  immediateUtilityEvaluatorRegistry,
} from "./index.js";

describe("AI evaluator registry", () => {
  it("covers every closed legal, pending, and response-shape union exactly once", () => {
    expect(Object.keys(legalDecisionEvaluatorRegistry).sort()).toEqual(
      [...legalDecisionTypes].sort(),
    );
    expect(Object.keys(pendingDecisionEvaluatorRegistry).sort()).toEqual(
      [...pendingDecisionTypes].sort(),
    );
    expect(Object.keys(responseShapeEvaluatorRegistry).sort()).toEqual(
      [...responseShapeTypes].sort(),
    );
    expect(new Set(allAiEvaluatorRegistryEntries.map((entry) => entry.id)).size).toBe(
      allAiEvaluatorRegistryEntries.length,
    );
  });

  it("keeps Phase 0 fallback accounting baseline and records proof for every entry", () => {
    expect(
      allAiEvaluatorRegistryEntries.every((entry) => entry.classification === "baseline"),
    ).toBe(true);
    expect(
      allAiEvaluatorRegistryEntries.every(
        (entry) =>
          entry.featureExtractor.length > 0 &&
          entry.representativeScenario.length > 0 &&
          entry.focusedProof.length > 0,
      ),
    ).toBe(true);
  });

  it("keeps the immediate utility evaluator order exhaustive and stable", () => {
    expect(immediateUtilityEvaluatorRegistry).toEqual([
      "resource-utility",
      "damage-utility",
      "healing-utility",
      "survival-utility",
      "ko-utility",
      "terminal-utility",
      "action-economy",
      "tactical-clamp",
      "baseline-fallback",
    ]);
  });
});
