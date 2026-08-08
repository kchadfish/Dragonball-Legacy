import { describe, expect, it } from "vitest";

import { MOVE_SOURCE_DEFINITIONS } from "./move-source-definitions.js";
import { MOVE_DEFINITIONS } from "./move-definitions.js";
import { validateMoveDefinitions } from "./validation.js";

describe("typed move catalog", () => {
  it("covers every generated move source with auditable effect text", () => {
    expect(MOVE_DEFINITIONS).toHaveLength(499);
    expect(new Set(MOVE_DEFINITIONS.map((move) => move.id))).toEqual(
      new Set(MOVE_SOURCE_DEFINITIONS.map((move) => move.id)),
    );
    expect(MOVE_DEFINITIONS.filter((move) => move.mechanics.kiCost !== undefined)).toHaveLength(
      457,
    );
    expect(MOVE_DEFINITIONS.filter((move) => move.mechanics.attack !== undefined)).toHaveLength(
      382,
    );
    expect(MOVE_DEFINITIONS.reduce((count, move) => count + move.effectClauses.length, 0)).toBe(
      2776,
    );
    expect(
      MOVE_DEFINITIONS.every((move) =>
        move.effectClauses.every((clause, index) => clause.order === index + 1),
      ),
    ).toBe(true);
    expect(validateMoveDefinitions(MOVE_DEFINITIONS)).toEqual([]);
  });

  it("preserves literal and variable mechanics without evaluating them", () => {
    const spiritBomb = MOVE_DEFINITIONS.find((move) => move.id === "move-afterlife-spirit-bomb");
    const lifeDrain = MOVE_DEFINITIONS.find((move) => move.id === "move-afterlife-life-drain");

    expect(spiritBomb?.mechanics).toMatchObject({
      kiCost: { type: "literal", value: 7 },
      restrictedUses: { type: "literal", value: 1 },
      attack: {
        type: "energy",
        baseDamagePercent: { type: "literal", value: 100 },
      },
    });
    expect(lifeDrain?.mechanics.attack?.baseDamagePercent).toEqual({
      type: "literal",
      value: 0,
    });
  });

  it("converts Block eligibility, multi-die behavior, and X-based cost formulas", () => {
    const defiantStance = MOVE_DEFINITIONS.find(
      (move) => move.id === "move-aoyosumu-defiant-stance",
    );
    const dazzlingGymnastics = MOVE_DEFINITIONS.find(
      (move) => move.id === "move-akaikaru-dazzling-gymnastics",
    );

    expect(defiantStance?.mechanics.block).toEqual({
      allowedAttackTypes: ["physical", "energy"],
      baseCostAdjustment: -1,
    });
    expect(dazzlingGymnastics?.mechanics.block).toEqual({
      allowedAttackTypes: ["physical"],
      stopsAllDice: true,
      baseCostAdjustment: 0,
    });
  });
});
