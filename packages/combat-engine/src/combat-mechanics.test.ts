import { describe, expect, it } from "vitest";

import {
  calculateAttackDamage,
  calculateBlockKiCost,
  calculateKiCost,
  canContinueCounterChain,
  isRestrictedUseAvailable,
  isSignatureTurnAvailable,
  qualifiesForCounter,
  qualifiesForCritical,
  resolveMultiDieBlock,
  resolveMultiDieOutcomes,
} from "./index.js";
import { createTestCombatMove } from "./testing/index.js";

describe("generic combat mechanics", () => {
  it("uses synthetic single- and multi-die fixtures to qualify criticals and counters", () => {
    const singleDie = createTestCombatMove({ id: "move:test-single", kiCost: 2 });
    const multiDie = createTestCombatMove({
      id: "move:test-multi",
      dice: { count: 3, sides: 30 },
      kiCost: 2,
    });

    expect(
      qualifiesForCritical({
        attackerDexterity: 5,
        defenderDexterity: 4,
        diceCount: singleDie.dice!.count,
        diceSides: singleDie.dice!.sides,
        naturalAttackResult: 29,
        naturalDefenseResult: 1,
        outcome: "successful",
      }),
    ).toBe(true);
    expect(
      qualifiesForCritical({
        attackerDexterity: 5,
        defenderDexterity: 4,
        diceCount: multiDie.dice!.count,
        diceSides: multiDie.dice!.sides,
        naturalAttackResult: 30,
        naturalDefenseResult: 1,
        outcome: "successful",
      }),
    ).toBe(false);
    expect(
      qualifiesForCounter({
        attackerDexterity: 4,
        defenderDexterity: 5,
        diceCount: 1,
        diceSides: 30,
        naturalAttackResult: 1,
        naturalDefenseResult: 29,
        outcome: "stopped",
      }),
    ).toBe(true);
  });

  it("applies shared cost, restriction, signature, counter-chain, and rounding rules", () => {
    const restricted = createTestCombatMove({
      id: "move:test-restricted",
      kiCost: 2,
      restrictedUses: 1,
    });

    expect(calculateAttackDamage(2.5, true)).toBe(5);
    expect(calculateKiCost(restricted.kiCost, [-1, 2])).toBe(3);
    expect(calculateBlockKiCost(1, -2)).toBe(1);
    expect(resolveMultiDieBlock(3)).toEqual({ blockedDice: 2, defendingDice: 1 });
    expect(resolveMultiDieOutcomes([15, 4, 20], [10, 5, 20])).toEqual([true, false, true]);
    expect(isRestrictedUseAvailable(0, restricted.restrictedUses)).toBe(true);
    expect(isRestrictedUseAvailable(1, restricted.restrictedUses)).toBe(false);
    expect(isSignatureTurnAvailable(9)).toBe(false);
    expect(isSignatureTurnAvailable(10)).toBe(true);
    expect(canContinueCounterChain(2)).toBe(true);
    expect(canContinueCounterChain(3)).toBe(false);
  });
});
