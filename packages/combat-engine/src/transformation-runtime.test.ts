import { TRANSFORMATION_DEFINITIONS } from "@dragonball-resurgence/game-data";
import { describe, expect, it } from "vitest";

import { applyTransformation, revertTransformation } from "./transformation-runtime.js";

const combatant = {
  id: "combatant:ghost" as never,
  hitPoints: { current: 80, maximum: 100 },
  ki: { current: 5, maximum: 10 },
  stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
  moveIds: [],
  moveUses: {},
  activeStatuses: [],
  status: "active" as const,
};

describe("transformation runtime", () => {
  it.each([
    "transformation-humans-2-super-human",
    "transformation-saiyans-1-oozaru",
    "transformation-hybrid-saiyan-1-high-tension",
    "transformation-namek-1-giant-form",
    "transformation-changeling-1-form-2",
    "transformation-bio-androids-1-semi-perfect-form",
  ])("applies and reverses the converted %s stat layer", (transformationId) => {
    const transformation = TRANSFORMATION_DEFINITIONS.find(
      (candidate) => candidate.id === transformationId,
    );
    if (transformation === undefined) throw new Error(`Expected ${transformationId} data.`);

    const transformed = applyTransformation(combatant, transformation);
    expect(transformed.combatant.stats.power).toBe(
      Math.round((combatant.stats.power * (100 + transformation.statModifiers.powerPercent)) / 100),
    );
    expect(transformed.combatant.hitPoints.maximum).toBe(
      Math.round(
        (combatant.hitPoints.maximum * (100 + transformation.statModifiers.hpPercent)) / 100,
      ),
    );
    expect(revertTransformation(transformed.combatant, transformed.baseline)).toMatchObject(
      combatant,
    );
  });

  it("applies and exactly reverses a converted transformation's base stat layer", () => {
    const ghoul = TRANSFORMATION_DEFINITIONS.find(
      (transformation) => transformation.id === "transformation-ghost-2-ghoul",
    );
    if (ghoul === undefined) throw new Error("Expected Ghoul transformation data.");

    const transformed = applyTransformation(combatant, ghoul);
    expect(transformed.combatant).toMatchObject({
      hitPoints: { current: 120, maximum: 140 },
      stats: { power: 24, dexterity: 14 },
    });
    expect(revertTransformation(transformed.combatant, transformed.baseline)).toMatchObject(
      combatant,
    );
  });
});
