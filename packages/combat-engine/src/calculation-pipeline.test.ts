import { describe, expect, it } from "vitest";

import {
  CALCULATION_STAGE_ORDER,
  applyCalculationBounds,
  calculateCost,
  calculateDamage,
  calculateValue,
  percentageOfCalculationBase,
  roundCalculationToInteger,
} from "./index.js";

describe("calculation pipeline", () => {
  it("applies shuffled operations by declared precedence and stable source order", () => {
    const result = calculateValue({
      baseValue: 10,
      replacements: [{ value: 8, provenance: "substitution" }],
      operations: [
        { operation: "multiply", amount: 2, provenance: "multiply", order: 5 },
        { operation: "add", amount: 3, provenance: "add-late", order: 8 },
        { operation: "set", amount: 7, provenance: "set", order: 2 },
        { operation: "add", amount: 4, provenance: "add-early", order: 1 },
      ],
      rounding: { type: "integer" },
    });

    expect(result.value).toBe(28);
    expect(result.trace?.map(({ stage, provenance }) => `${stage}:${provenance}`)).toEqual([
      "replacement:substitution",
      "set:set",
      "additive:add-early",
      "additive:add-late",
      "multiplicative:multiply",
      "rounding:rounding",
    ]);
  });

  it("uses declared percentage bases and rounds once after the formula", () => {
    expect(percentageOfCalculationBase(37, 25)).toBe(9.25);
    expect(roundCalculationToInteger(12.5)).toBe(13);
    expect(
      calculateValue({
        baseValue: 10,
        operations: [
          { operation: "add", amount: 25, percentageBase: 37, provenance: "damage-percent" },
          { operation: "multiply", amount: 1.5, provenance: "critical" },
        ],
        rounding: { type: "integer" },
      }).value,
    ).toBe(29);
  });

  it("resolves damage percentages against the declared base and floors at zero", () => {
    expect(
      calculateDamage({
        baseDamage: 37,
        modifiers: [
          { operation: "add", amount: 25, basis: "damage-percent", provenance: "bonus" },
          { operation: "multiply", amount: 50, basis: "damage-percent", provenance: "reduction" },
        ],
      }).value,
    ).toBe(23);
    expect(
      calculateDamage({
        baseDamage: 4,
        modifiers: [{ operation: "add", amount: -200, provenance: "penalty" }],
      }).value,
    ).toBe(0);
  });

  it("distinguishes full calculation prevention from prevented modifiers", () => {
    const preventedModifier = calculateValue({
      baseValue: 10,
      operations: [
        { operation: "add", amount: 5, provenance: "blocked" },
        { operation: "add", amount: 2, provenance: "allowed" },
      ],
      modifierPreventions: [{ provenance: "blocked" }],
    });
    expect(preventedModifier.value).toBe(12);
    expect(preventedModifier.trace?.map((entry) => entry.status)).toEqual(["skipped", "applied"]);

    const preventedCalculation = calculateValue({
      baseValue: 10,
      operations: [{ operation: "add", amount: 100, provenance: "ignored" }],
      prevention: { preventedValue: 4, provenance: "negation" },
    });
    expect(preventedCalculation.value).toBe(4);
    expect(preventedCalculation.trace).toEqual([
      {
        stage: "prevention",
        provenance: "negation",
        input: 10,
        output: 4,
        status: "applied",
      },
    ]);
  });

  it("resolves costs with one rounding pass and a zero floor", () => {
    const result = calculateCost({
      baseCost: 5,
      operations: [
        { operation: "add", amount: -1.5, provenance: "discount" },
        { operation: "multiply", amount: 0.5, provenance: "half-cost" },
      ],
    });

    expect(result.value).toBe(2);
    expect(result.trace?.at(-1)).toMatchObject({
      stage: "bounds",
      provenance: "cost:minimum-zero",
      status: "applied",
    });
  });

  it("applies conflicting bounds in deterministic declared order", () => {
    expect(
      applyCalculationBounds(8, [
        { type: "minimum", value: 10, provenance: "floor" },
        { type: "maximum", value: 5, provenance: "cap" },
      ]),
    ).toBe(5);
    expect(CALCULATION_STAGE_ORDER).toEqual([
      "prevention",
      "replacement",
      "set",
      "additive",
      "multiplicative",
      "rounding",
      "bounds",
    ]);
  });
});
