import { describe, expect, it } from "vitest";

import type { EffectDefinition } from "@dragonball-resurgence/game-data";

import { compileEffectPlan } from "./effect-executors.js";
import { hasSelectionSpec, selectionType, staticSelectionLimit } from "./effect-selection.js";

const effect = (selectionSpec?: EffectDefinition["selectionSpec"]): EffectDefinition => ({
  type: "modify-damage",
  trigger: "passive",
  target: "self",
  operation: "add",
  percent: { type: "literal", value: 10 },
  ...(selectionSpec === undefined ? {} : { selectionSpec }),
  sourceText: "selection test",
});

describe("normalized effect selection", () => {
  it.each([
    [{ type: "one" } as const, "one", 1],
    [{ type: "up-to", limit: { type: "literal", value: 3 } } as const, "up-to", 3],
    [{ type: "all" } as const, "all", undefined],
  ])("normalizes %s selection semantics", (selection, type, limit) => {
    const candidate = effect(selection);
    expect(selectionType(candidate)).toBe(type);
    expect(staticSelectionLimit(candidate)).toBe(limit);
    expect(hasSelectionSpec(candidate)).toBe(true);
  });

  it("retains optionality independently from cardinality", () => {
    const candidate = { ...effect({ type: "one" }), optional: true };
    expect(candidate.optional).toBe(true);
    expect(selectionType(candidate)).toBe("one");
  });

  it("rejects a non-positive up-to limit during plan compilation", () => {
    const result = compileEffectPlan({
      sourceDefinitionId: "move:selection-test",
      effectIndex: 0,
      effect: effect({ type: "up-to", limit: { type: "literal", value: 0 } }),
    });

    expect(result).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          message: "Up-to effect selections require a positive integer limit.",
        }),
      ],
    });
  });

  it("requires a selection specification for per-target costs", () => {
    const candidate = {
      ...effect(),
      activationCost: {
        timing: "per-selected-target" as const,
        resource: "ki" as const,
        amount: { type: "literal" as const, value: 1 },
        operation: "lose" as const,
      },
    };
    const result = compileEffectPlan({
      sourceDefinitionId: "move:selection-cost-test",
      effectIndex: 0,
      effect: candidate,
    });

    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? [] : result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "Per-selected-target activation costs require an effect selection.",
        }),
      ]),
    );
  });
});
