import { describe, expect, it } from "vitest";

import { resolveContestedAttackRolls, blockedDiceForDeclaredBlock } from "./index.js";
import { SequenceRandomSource } from "./testing/index.js";

describe("contested attack rolls", () => {
  it("resolves each unblocked die independently with the combatants' Dexterity Bonuses", () => {
    const rolls = resolveContestedAttackRolls(
      {
        attack: { dice: 3, sides: 30 },
        attackerDexterityBonus: 1,
        defenderDexterityBonus: -1,
      },
      new SequenceRandomSource([10, 12, 5, 10, 30, 30]),
    );

    expect(rolls).toEqual([
      {
        attackNaturalResult: 10,
        attackResult: 11,
        defenseNaturalResult: 12,
        defenseResult: 11,
        outcome: "successful",
      },
      {
        attackNaturalResult: 5,
        attackResult: 6,
        defenseNaturalResult: 10,
        defenseResult: 9,
        outcome: "stopped",
      },
      {
        attackNaturalResult: 30,
        attackResult: 31,
        defenseNaturalResult: 30,
        defenseResult: 29,
        outcome: "successful",
      },
    ]);
  });

  it("stops the first half of a blocked multi-die attack and skips those defense rolls", () => {
    const rolls = resolveContestedAttackRolls(
      {
        attack: { dice: 5, sides: 30 },
        blockedDice: blockedDiceForDeclaredBlock(5),
        attackerDexterityBonus: 0,
        defenderDexterityBonus: 0,
      },
      new SequenceRandomSource([1, 2, 3, 10, 5, 20, 10]),
    );

    expect(rolls).toEqual([
      { attackNaturalResult: 1, attackResult: 1, outcome: "blocked" },
      { attackNaturalResult: 2, attackResult: 2, outcome: "blocked" },
      { attackNaturalResult: 3, attackResult: 3, outcome: "blocked" },
      {
        attackNaturalResult: 10,
        attackResult: 10,
        defenseNaturalResult: 5,
        defenseResult: 5,
        outcome: "successful",
      },
      {
        attackNaturalResult: 20,
        attackResult: 20,
        defenseNaturalResult: 10,
        defenseResult: 10,
        outcome: "successful",
      },
    ]);
  });

  it("replays persisted natural dice without consuming new randomness", () => {
    const rolls = resolveContestedAttackRolls(
      {
        attack: { dice: 1, sides: 30 },
        attackerDexterityBonus: 0,
        defenderDexterityBonus: 0,
        defenderResultModifier: 2,
        naturalRolls: [{ attack: 11, defense: 10 }],
      },
      new SequenceRandomSource([]),
    );

    expect(rolls).toEqual([
      {
        attackNaturalResult: 11,
        attackResult: 11,
        defenseNaturalResult: 10,
        defenseResult: 12,
        outcome: "stopped",
      },
    ]);
  });

  it("applies validated numeric result substitutions after natural dice and bonuses", () => {
    const rolls = resolveContestedAttackRolls(
      {
        attack: { dice: 2, sides: 30 },
        attackerDexterityBonus: 2,
        defenderDexterityBonus: -1,
        naturalRolls: [
          { attack: 4, defense: 20 },
          { attack: 21, defense: 1 },
        ],
        numericResultOverrides: [{ attack: 25, defense: 26 }, undefined],
      },
      new SequenceRandomSource([]),
    );

    expect(rolls).toEqual([
      {
        attackNaturalResult: 4,
        attackResult: 25,
        defenseNaturalResult: 20,
        defenseResult: 26,
        outcome: "stopped",
      },
      {
        attackNaturalResult: 21,
        attackResult: 23,
        defenseNaturalResult: 1,
        defenseResult: 0,
        outcome: "successful",
      },
    ]);
  });
});
