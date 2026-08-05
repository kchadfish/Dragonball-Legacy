import { describe, expect, it } from "vitest";

import { GENERIC_CLASS_DEFINITIONS, RACE_DEFINITIONS } from "./race-definitions.js";
import {
  TRANSFORMATION_DEFINITIONS,
  TRANSFORMATION_SOURCE_DEFINITIONS,
} from "./transformation-definitions.js";
import { validateTransformationDefinitions } from "./validation.js";

describe("race and transformation definitions", () => {
  it("covers each canonical race and transformation source", () => {
    expect(RACE_DEFINITIONS).toHaveLength(24);
    expect(TRANSFORMATION_SOURCE_DEFINITIONS).toHaveLength(25);
    expect(
      TRANSFORMATION_SOURCE_DEFINITIONS.filter((source) => source.status === "canonical"),
    ).toHaveLength(23);
    expect(TRANSFORMATION_SOURCE_DEFINITIONS.some((source) => source.status === "archive")).toBe(
      true,
    );
    expect(
      TRANSFORMATION_SOURCE_DEFINITIONS.some((source) => source.status === "no-mechanics"),
    ).toBe(true);
    expect(TRANSFORMATION_DEFINITIONS).toHaveLength(79);
  });

  it("links each transformation to its owning race and keeps source-traceable abilities", () => {
    const raceIds = new Set(RACE_DEFINITIONS.map((race) => race.id));
    expect(
      TRANSFORMATION_DEFINITIONS.every((transformation) => raceIds.has(transformation.raceId)),
    ).toBe(true);
    expect(validateTransformationDefinitions(TRANSFORMATION_DEFINITIONS)).toEqual([]);
  });

  it("normalizes named racial traits and classes without losing their source text", () => {
    expect(RACE_DEFINITIONS.flatMap((race) => race.racialTraits)).toHaveLength(35);
    expect(RACE_DEFINITIONS.flatMap((race) => race.classes)).toHaveLength(82);
    const saiyan = RACE_DEFINITIONS.find((race) => race.id === "race-saiyans");
    expect(saiyan?.racialTraits.map((trait) => trait.name)).toEqual([
      "Zenkai Power",
      "Saiyan Might",
    ]);
    expect(saiyan?.classes.map((raceClass) => raceClass.name)).toEqual([
      "Low Class Warrior",
      "Middle Class Warrior",
      "Elite Class Warrior",
      "Savage Saiyan",
      "Legendary Super Saiyan",
    ]);
    expect(
      RACE_DEFINITIONS.flatMap((race) => [...race.racialTraits, ...race.classes]).every(
        (definition) => definition.source.text.includes(definition.effectText),
      ),
    ).toBe(true);
    expect(GENERIC_CLASS_DEFINITIONS.map((raceClass) => raceClass.name)).toEqual([
      "Weaponmaster",
      "Dragon Ball Hunter",
      "Military Mentality",
      "Bodyguard",
      "Adventurer",
      "Bandit King",
      "Scientist",
      "Healer",
    ]);
    expect(
      GENERIC_CLASS_DEFINITIONS.every((raceClass) =>
        raceClass.source.text.includes(raceClass.effectText),
      ),
    ).toBe(true);
  });
});
