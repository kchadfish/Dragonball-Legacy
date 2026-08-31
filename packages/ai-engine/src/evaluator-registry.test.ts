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
  contextualEvaluatorRegistryEntries,
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

  it("records strategic proof for supported surfaces and documents source-selection baselines", () => {
    expect(
      allAiEvaluatorRegistryEntries
        .filter(
          (entry) =>
            entry.surface !== "select-source-action" && entry.surface !== "select-source-effect",
        )
        .every((entry) => entry.classification === "supported"),
    ).toBe(true);
    expect(
      allAiEvaluatorRegistryEntries
        .filter(
          (entry) =>
            entry.surface === "select-source-action" || entry.surface === "select-source-effect",
        )
        .every(
          (entry) =>
            entry.classification === "contract-accounted-not-currently-emitted" &&
            entry.proofTarget !== undefined,
        ),
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

  it("registers every Phase 3 context evaluator with focused proof", () => {
    expect(contextualEvaluatorRegistryEntries).toHaveLength(9);
    expect(
      contextualEvaluatorRegistryEntries.every(
        (entry) =>
          entry.status === "complete" && entry.proof.includes("contextual-utility.test.ts"),
      ),
    ).toBe(true);
  });
});
