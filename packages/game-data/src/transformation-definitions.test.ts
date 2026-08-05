import { describe, expect, it } from "vitest";

import type { TransformationDefinition } from "./shared/types.js";
import { validateTransformationDefinitions } from "./validation.js";

const passiveDamageEffect = {
  type: "modify-damage",
  trigger: "passive",
  percent: { type: "literal", value: 5 },
  operation: "add",
  sourceText: "Your attacks do +(5% Power) Damage.",
} as const;

const validTransformation = {
  id: "saiyan-super-saiyan",
  raceId: "saiyan",
  name: "Super Saiyan",
  tier: 2,
  prerequisites: [],
  statModifiers: {
    powerPercent: 50,
    hpPercent: 30,
    dexterityPercent: 20,
  },
  abilities: {
    novice: {
      effects: [passiveDamageEffect],
    },
    intermediate: {
      name: "Practiced Super Saiyan",
      effects: [passiveDamageEffect],
    },
    mastered: {
      name: "Mastered Super Saiyan",
      effects: [passiveDamageEffect],
    },
  },
  source: {
    path: "reference/races.transformations/saiyans/transformation.md",
    text: "Level 2 — Super Saiyan",
  },
} satisfies TransformationDefinition;

describe("transformation definitions", () => {
  it("separates stat modifiers from mastery-ranked Transformation Abilities", () => {
    expect(validTransformation.statModifiers).toEqual({
      powerPercent: 50,
      hpPercent: 30,
      dexterityPercent: 20,
    });
    expect(Object.keys(validTransformation.abilities)).toEqual([
      "novice",
      "intermediate",
      "mastered",
    ]);
    expect(validateTransformationDefinitions([validTransformation])).toEqual([]);
  });

  it("accepts finite negative stat modifiers", () => {
    const transformation = {
      ...validTransformation,
      id: "saiyan-oozaru",
      tier: 1,
      statModifiers: {
        ...validTransformation.statModifiers,
        dexterityPercent: -10,
      },
    } satisfies TransformationDefinition;

    expect(validateTransformationDefinitions([transformation])).toEqual([]);
  });

  it("rejects transformation tiers beyond the four defined levels", () => {
    const transformation = {
      ...validTransformation,
      id: "saiyan-unsupported-tier",
      tier: 5,
    } satisfies TransformationDefinition;

    expect(validateTransformationDefinitions([transformation])).toEqual([
      "Invalid transformation tier: saiyan-unsupported-tier",
    ]);
  });

  it("reports invalid identity, tier, source, stats, abilities, and duplicates", () => {
    const invalidTransformation = {
      ...validTransformation,
      id: "Invalid ID",
      raceId: "Invalid Race",
      tier: 0,
      statModifiers: {
        ...validTransformation.statModifiers,
        powerPercent: Number.NaN,
      },
      abilities: {
        ...validTransformation.abilities,
        novice: {
          name: " ",
          effects: [],
        },
      },
      source: {
        ...validTransformation.source,
        path: "reference/moves/afterlife.md",
      },
    } satisfies TransformationDefinition;

    expect(
      validateTransformationDefinitions([invalidTransformation, invalidTransformation]),
    ).toEqual([
      "Invalid transformation ID: Invalid ID",
      "Invalid transformation race ID: Invalid ID",
      "Invalid transformation tier: Invalid ID",
      "Invalid transformation source path: Invalid ID",
      "Invalid transformation stat modifier: Invalid ID",
      "Invalid novice Transformation Ability name: Invalid ID",
      "Missing novice Transformation Ability effect text: Invalid ID",
      "Invalid transformation ID: Invalid ID",
      "Invalid transformation race ID: Invalid ID",
      "Duplicate transformation ID: Invalid ID",
      "Invalid transformation tier: Invalid ID",
      "Invalid transformation source path: Invalid ID",
      "Invalid transformation stat modifier: Invalid ID",
      "Invalid novice Transformation Ability name: Invalid ID",
      "Missing novice Transformation Ability effect text: Invalid ID",
    ]);
  });
});
