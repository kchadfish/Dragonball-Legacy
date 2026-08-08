import { describe, expect, it } from "vitest";

import { resolveMoveAttack } from "./move-attacks.js";
import { SequenceRandomSource } from "./testing/index.js";

const attacker = {
  id: "combatant:attacker" as never,
  hitPoints: { current: 100, maximum: 100 },
  ki: { current: 10, maximum: 10 },
  stats: { power: 20, dexterity: 5, dexterityBonus: 0 },
  moveIds: [],
  moveUses: {},
  activeStatuses: [],
  status: "active" as const,
};
const defender = {
  ...attacker,
  id: "combatant:defender" as never,
  stats: { power: 10, dexterity: 4, dexterityBonus: 0 },
};

describe("resolveMoveAttack", () => {
  it("divides a multi-die attack's base damage across its successful dice", () => {
    const result = resolveMoveAttack(
      attacker,
      defender,
      { attack: { dice: 3, sides: 30 }, baseDamage: 90 },
      new SequenceRandomSource([20, 10, 5, 20, 25, 10]),
    );

    expect(result).toMatchObject({ successfulHitCount: 2, damage: 60, critical: false });
  });

  it("only allows critical damage on a single-die move", () => {
    const result = resolveMoveAttack(
      attacker,
      defender,
      { attack: { dice: 1, sides: 30 }, baseDamage: 40 },
      new SequenceRandomSource([30, 1]),
    );

    expect(result).toMatchObject({ successfulHitCount: 1, critical: true, damage: 80 });
  });

  it("uses the full listed damage for every successful die on a damage-per-hit move", () => {
    const result = resolveMoveAttack(
      attacker,
      defender,
      { attack: { dice: 3, sides: 30 }, baseDamage: 7, damagePerHit: true },
      new SequenceRandomSource([20, 1, 20, 1, 20, 1]),
    );

    expect(result).toMatchObject({ successfulHitCount: 3, damage: 21 });
  });

  it("only grants a counter when the multi-die attack dealt no successful hits", () => {
    const result = resolveMoveAttack(
      attacker,
      defender,
      { attack: { dice: 2, sides: 30 }, baseDamage: 60 },
      new SequenceRandomSource([3, 30, 30, 1]),
    );

    expect(result).toMatchObject({ successfulHitCount: 1, counter: false });
  });

  it("applies a declared defense-result modifier before resolving every unblocked die", () => {
    const result = resolveMoveAttack(
      attacker,
      defender,
      {
        attack: { dice: 2, sides: 30 },
        baseDamage: 20,
        defenseResultModifier: 3,
      },
      new SequenceRandomSource([12, 10, 12, 10]),
    );

    expect(result).toMatchObject({ successfulHitCount: 0, damage: 0 });
    expect(result.rolls.map((roll) => roll.defenseResult)).toEqual([13, 13]);
  });
});
