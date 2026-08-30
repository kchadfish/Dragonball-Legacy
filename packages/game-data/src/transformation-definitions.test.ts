import { describe, expect, it } from "vitest";

import { TRANSFORMATION_DEFINITIONS } from "./transformation-definitions.js";
import { RACE_DEFINITIONS } from "./race-definitions.js";
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
  it("captures every labeled mastery, including hyphenated ability names", () => {
    const transformation = TRANSFORMATION_DEFINITIONS.find(
      (candidate) => candidate.id === "transformation-changeling-1-form-2",
    );

    expect(transformation?.abilities.intermediate).toMatchObject({
      name: "The Power of Intimidation",
      effectText: expect.stringContaining("defense roll of 25 or higher"),
    });
    expect(transformation?.abilities.novice.name).toBe("The Element of Fear");
    expect(transformation?.abilities.mastered.name).toBe("The Great Intimidator");
  });

  it("keeps active-family innate overlays source-mapped to canonical clauses", () => {
    const activeRaces = new Set([
      "race-humans",
      "race-saiyans",
      "race-hybrid-saiyan",
      "race-namek",
      "race-changeling",
      "race-bio-androids",
    ]);
    const activeTransformations = TRANSFORMATION_DEFINITIONS.filter((transformation) =>
      activeRaces.has(transformation.raceId),
    );
    expect(activeTransformations.length).toBeGreaterThan(0);
    for (const transformation of activeTransformations)
      for (const ability of Object.values(transformation.abilities)) {
        const sourceClauseOrders = new Set(
          (ability.sourceClauses ?? []).map((sourceClause) => sourceClause.clauseOrder),
        );
        expect(
          (ability.effects ?? [])
            .filter((effect) => effect.sourceClauseOrder !== undefined)
            .every((effect) => sourceClauseOrders.has(effect.sourceClauseOrder!)),
        ).toBe(true);
        for (const sourceClause of ability.sourceClauses ?? [])
          expect(ability.effectClauses?.[sourceClause.clauseOrder - 1]?.text).toBe(
            sourceClause.sourceText,
          );
      }
  });

  it("retains source-mapped race and generic innate definitions", () => {
    const mapped = [
      ...RACE_DEFINITIONS.flatMap((race) => [...race.racialTraits, ...race.classes]),
    ].filter((definition) => definition.effects !== undefined);
    expect(mapped.length).toBeGreaterThan(0);
    for (const definition of mapped)
      for (const sourceClause of definition.sourceClauses ?? [])
        expect(definition.effectClauses[sourceClause.clauseOrder - 1]?.text).toBe(
          sourceClause.sourceText,
        );
  });

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
