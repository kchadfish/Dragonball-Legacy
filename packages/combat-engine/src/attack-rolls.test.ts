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

  it("selects the highest attack candidate and the lowest defense candidate", () => {
    const advantage = resolveContestedAttackRolls(
      {
        attack: { dice: 1, sides: 30 },
        attackerDexterityBonus: 0,
        defenderDexterityBonus: 0,
        rollSelection: { roll: "attack", diceCount: 2, selection: "highest" },
      },
      new SequenceRandomSource([4, 20, 1]),
    );
    const disadvantage = resolveContestedAttackRolls(
      {
        attack: { dice: 1, sides: 30 },
        attackerDexterityBonus: 0,
        defenderDexterityBonus: 0,
        rollSelection: { roll: "defense", diceCount: 2, selection: "lowest" },
      },
      new SequenceRandomSource([20, 4, 18]),
    );

    expect(advantage[0]).toMatchObject({ attackNaturalResult: 20, defenseNaturalResult: 1 });
    expect(disadvantage[0]).toMatchObject({ attackNaturalResult: 20, defenseNaturalResult: 4 });
  });

  it("replays the selected roll without consuming candidate randomness", () => {
    expect(
      resolveContestedAttackRolls(
        {
          attack: { dice: 1, sides: 30 },
          attackerDexterityBonus: 0,
          defenderDexterityBonus: 0,
          rollSelection: { roll: "attack", diceCount: 2, selection: "highest" },
          naturalRolls: [{ attack: 20, defense: 1 }],
        },
        new SequenceRandomSource([]),
      ),
    ).toMatchObject([{ attackNaturalResult: 20, defenseNaturalResult: 1 }]);
  });

  it("enforces stop thresholds at their exact boundary, including cannot-stop ceilings", () => {
    expect(
      resolveContestedAttackRolls(
        {
          attack: { dice: 1, sides: 30 },
          attackerDexterityBonus: 0,
          defenderDexterityBonus: 0,
          resolutionThresholds: [
            {
              outcome: "stopped",
              roll: "defense",
              comparison: "at-least",
              value: 11,
              resultScope: "current-attack",
            },
          ],
          naturalRolls: [{ attack: 1, defense: 10 }],
        },
        new SequenceRandomSource([]),
      ),
    ).toEqual([
      {
        attackNaturalResult: 1,
        attackResult: 1,
        defenseNaturalResult: 10,
        defenseResult: 10,
        outcome: "successful",
      },
    ]);

    expect(
      resolveContestedAttackRolls(
        {
          attack: { dice: 1, sides: 30 },
          attackerDexterityBonus: 0,
          defenderDexterityBonus: 0,
          resolutionThresholds: [
            {
              outcome: "stopped",
              roll: "defense",
              comparison: "at-most",
              value: 12,
              resultScope: "current-attack",
            },
          ],
          naturalRolls: [{ attack: 10, defense: 12 }],
        },
        new SequenceRandomSource([]),
      ),
    ).toMatchObject([{ outcome: "successful" }]);

    expect(
      resolveContestedAttackRolls(
        {
          attack: { dice: 1, sides: 30 },
          attackerDexterityBonus: 0,
          defenderDexterityBonus: 0,
          resolutionThresholds: [
            {
              outcome: "stopped",
              roll: "defense",
              comparison: "at-most",
              value: 12,
              resultScope: "current-attack",
            },
          ],
          naturalRolls: [{ attack: 10, defense: 13 }],
        },
        new SequenceRandomSource([]),
      ),
    ).toMatchObject([{ outcome: "stopped" }]);
  });

  it("evaluates typed additive and multiplicative thresholds from the matching die results", () => {
    expect(
      resolveContestedAttackRolls(
        {
          attack: { dice: 1, sides: 30 },
          attackerDexterityBonus: 0,
          defenderDexterityBonus: 0,
          resolutionThresholds: [
            {
              outcome: "stopped",
              roll: "defense",
              comparison: "at-least",
              value: 5,
              relativeTo: "attack-roll",
              relativeOperation: "add",
              resultScope: "current-attack",
            },
          ],
          naturalRolls: [{ attack: 10, defense: 14 }],
        },
        new SequenceRandomSource([]),
      ),
    ).toMatchObject([{ outcome: "successful" }]);

    expect(
      resolveContestedAttackRolls(
        {
          attack: { dice: 1, sides: 30 },
          attackerDexterityBonus: 0,
          defenderDexterityBonus: 0,
          resolutionThresholds: [
            {
              outcome: "stopped",
              roll: "defense",
              comparison: "at-least",
              value: 2,
              relativeTo: "attack-roll",
              relativeOperation: "multiply",
              resultScope: "matching-die",
            },
          ],
          naturalRolls: [{ attack: 10, defense: 19 }],
        },
        new SequenceRandomSource([]),
      ),
    ).toMatchObject([{ outcome: "successful" }]);
  });

  it("rejects incomplete relative threshold rules before rolling", () => {
    expect(() =>
      resolveContestedAttackRolls(
        {
          attack: { dice: 1, sides: 30 },
          attackerDexterityBonus: 0,
          defenderDexterityBonus: 0,
          resolutionThresholds: [
            {
              outcome: "stopped",
              roll: "defense",
              comparison: "at-least",
              value: 5,
              relativeTo: "attack-roll",
              resultScope: "current-attack",
            },
          ],
        },
        new SequenceRandomSource([10, 15]),
      ),
    ).toThrow("A relative threshold requires an explicit operation.");
  });

  it("rejects malformed threshold and selection shapes at the runtime boundary", () => {
    expect(() =>
      resolveContestedAttackRolls(
        {
          attack: { dice: 1, sides: 30 },
          attackerDexterityBonus: 0,
          defenderDexterityBonus: 0,
          resolutionThresholds: [
            {
              outcome: "invalid",
              roll: "defense",
              comparison: "at-most",
              value: 10,
              resultScope: "matching-die",
            } as never,
          ],
        },
        new SequenceRandomSource([]),
      ),
    ).toThrow("Resolution thresholds must contain a valid outcome.");

    expect(() =>
      resolveContestedAttackRolls(
        {
          attack: { dice: 1, sides: 30 },
          attackerDexterityBonus: 0,
          defenderDexterityBonus: 0,
          rollSelection: {
            roll: "defense",
            diceCount: 1,
            selection: "lowest",
          },
        },
        new SequenceRandomSource([]),
      ),
    ).toThrow("Roll selection requires at least two candidate dice.");
  });

  it("uses a declared defense die size for both random and persisted rolls", () => {
    expect(
      resolveContestedAttackRolls(
        {
          attack: { dice: 1, sides: 30 },
          attackerDexterityBonus: 0,
          defenderDexterityBonus: 0,
          defenseSides: 3,
        },
        new SequenceRandomSource([10, 3]),
      ),
    ).toEqual([
      {
        attackNaturalResult: 10,
        attackResult: 10,
        defenseNaturalResult: 3,
        defenseResult: 3,
        outcome: "successful",
      },
    ]);

    expect(
      resolveContestedAttackRolls(
        {
          attack: { dice: 1, sides: 30 },
          attackerDexterityBonus: 0,
          defenderDexterityBonus: 0,
          defenseSides: 3,
          naturalRolls: [{ attack: 2, defense: 3 }],
        },
        new SequenceRandomSource([]),
      )[0]?.defenseNaturalResult,
    ).toBe(3);
  });

  it("rejects invalid custom defense sides and persisted values above that die", () => {
    expect(() =>
      resolveContestedAttackRolls(
        {
          attack: { dice: 1, sides: 30 },
          attackerDexterityBonus: 0,
          defenderDexterityBonus: 0,
          defenseSides: 0,
        },
        new SequenceRandomSource([]),
      ),
    ).toThrow(RangeError);

    expect(() =>
      resolveContestedAttackRolls(
        {
          attack: { dice: 1, sides: 30 },
          attackerDexterityBonus: 0,
          defenderDexterityBonus: 0,
          defenseSides: 3,
          naturalRolls: [{ attack: 2, defense: 4 }],
        },
        new SequenceRandomSource([]),
      ),
    ).toThrow(RangeError);
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
