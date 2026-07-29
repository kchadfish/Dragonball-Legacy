import { describe, expect, it } from "vitest";

import { AOYOSUMU_MOVES } from "./aoyosumu.js";

describe("AOYOSUMU_MOVES", () => {
  it("promotes every source move without interpreting its effect prose", () => {
    expect(AOYOSUMU_MOVES).toHaveLength(61);
    expect(AOYOSUMU_MOVES.every((move) => move.styleId === "style-aoyosumu")).toBe(true);
    expect(AOYOSUMU_MOVES.every((move) => move.effectText.length > 0)).toBe(true);
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Calming Mastery")).toMatchObject({
      category: "mastery",
      trainingDays: 5,
    });
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Bullwhip")).toMatchObject({
      category: "advanced-attack",
      tags: ["physical", "throw", "kick"],
    });
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Calming Mastery")?.effects).toEqual([
      expect.objectContaining({
        type: "lock",
        affectedType: "attack",
        duration: expect.objectContaining({ type: "turns" }),
      }),
      expect.objectContaining({
        type: "modify-roll",
        roll: "defense",
        amount: { type: "literal", value: 4 },
      }),
    ]);
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Silence Gun")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "lock",
          affectedType: "skill",
          duration: expect.objectContaining({ type: "turns" }),
        }),
        expect.objectContaining({ type: "deactivate", affectedType: "skill" }),
      ]),
    );
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Breakout")?.effects).toEqual([
      expect.objectContaining({ type: "remove-move-from-combat", move: "source" }),
      expect.objectContaining({ type: "suppress", target: "opponent" }),
    ]);
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Inner Peace")?.effects).toEqual([
      expect.objectContaining({ type: "modify-resource", resource: "ki", operation: "gain" }),
    ]);
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Opportunist")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-damage", percent: { type: "literal", value: 5 } }),
        expect.objectContaining({ type: "modify-roll", roll: "defense" }),
      ]),
    );
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Floating Drop")?.effects).toEqual([
      expect.objectContaining({ type: "set-roll-selection", selection: "lowest" }),
    ]);
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Technique Mastery")?.effects).toMatchObject(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-slot-capacity", slot: "skill" }),
        expect.objectContaining({
          type: "grant-extra-action",
          maximumActions: { type: "literal", value: 2 },
        }),
      ]),
    );
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Reversal of Fortune")?.effects).toEqual([
      expect.objectContaining({
        type: "grant-counter-action",
        stopsTriggeringAttack: false,
        action: "repeat-triggering-attack",
        ignoreRequirements: true,
        useLimit: { scope: "combat", count: 2, sourceText: "RESTRICTEDx2" },
      }),
    ]);
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Karmic Possession")?.effects).toEqual([
      expect.objectContaining({
        type: "copy-move-effect",
        effectResult: "successful",
        resolveAs: "source-move",
        damage: { type: "total-damage", sourceMove: "selected-prior-move" },
      }),
    ]);
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Bomb Tag")?.effects).toEqual([
      expect.objectContaining({
        type: "schedule-effect",
        timing: { type: "turn-start", subject: "opponent", turnsAfter: 2 },
        effect: expect.objectContaining({ resource: "hp", operation: "lose" }),
        cancellation: expect.objectContaining({ target: "source" }),
      }),
    ]);
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Frost Wind Technique")?.effects).toEqual([
      expect.objectContaining({
        type: "lock",
        affectedType: "attack",
        duration: expect.objectContaining({ type: "until-roll-threshold" }),
        stacking: "prevent",
      }),
    ]);
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Weeping Willow")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-damage",
          operation: "set",
          cap: expect.objectContaining({ type: "maximum" }),
        }),
      ]),
    );
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Creeping Death")?.effects).toEqual([
      expect.objectContaining({
        type: "set-resolution-threshold",
        outcome: "stop",
        roll: "defense",
        value: { type: "source-expression", text: "source last defensive roll result" },
      }),
    ]);
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Dashing Fist Drive")?.effects).toEqual([
      expect.objectContaining({
        type: "set-roll-definition",
        roll: "attack",
        dice: 1,
        sides: 35,
        conditions: expect.arrayContaining([
          expect.objectContaining({ type: "move-selector", attackRoll: { dice: 1 } }),
        ]),
      }),
    ]);
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Braced Energy Beam")?.effects).toEqual([
      expect.objectContaining({
        type: "reroll",
        roll: "attack",
        rerollScope: "entire-attack",
        useLimit: { scope: "turn", count: 1, sourceText: "more than once per turn" },
      }),
    ]);
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Crescent Kick")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-critical-threshold",
        threshold: { type: "literal", value: 30 },
        basis: "final-result",
      }),
    ]);
    expect(AOYOSUMU_MOVES.find((move) => move.name === "One-Arm Shoulder Throw")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-cost",
        amount: { type: "literal", value: 1 },
        scope: { type: "next-turn", subject: "opponent", sourceText: "on their next turn" },
      }),
    ]);
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Return Fire")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-roll", roll: "attack", modifier: "sides" }),
        expect.objectContaining({ type: "modify-roll", roll: "defense", modifier: "sides" }),
        expect.objectContaining({ type: "prevent-combat-result", result: "critical" }),
      ]),
    );
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Close Shave")?.effects).toEqual([
      expect.objectContaining({
        type: "set-combat-result",
        result: "stopped",
        resultScope: "matching-die",
      }),
    ]);
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Heavenly Execution")?.effects).toEqual([
      expect.objectContaining({
        type: "set-resolution-threshold",
        outcome: "stop",
        resultScope: "matching-die",
      }),
    ]);
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Breathtaker")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-roll",
          roll: "attack",
          modifier: "result",
          amount: { type: "literal", value: -10 },
        }),
      ]),
    );
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Slow Charge")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-damage", operation: "add" }),
        expect.objectContaining({ type: "modify-roll", roll: "attack", modifier: "result" }),
      ]),
    );
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Tears of The Mystic")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-roll",
          roll: "attack",
          amount: { type: "source-expression", text: "2 per successful hit" },
        }),
        expect.objectContaining({ type: "modify-roll", roll: "defense" }),
      ]),
    );
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Bullwhip")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-roll",
        roll: "defense",
        scope: expect.objectContaining({
          type: "next-rolls",
          count: { type: "literal", value: 2 },
        }),
      }),
    ]);
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Serenity Wave")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "skip-action", target: "self" }),
        expect.objectContaining({ type: "skip-action", target: "opponent" }),
      ]),
    );
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Crushing Kick")?.effects).toEqual([
      expect.objectContaining({
        type: "set-resolution-threshold",
        relativeTo: "attack-roll",
        value: { type: "literal", value: 5 },
      }),
    ]);
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Tiger Strikes")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "reroll", roll: "defense" }),
        expect.objectContaining({
          type: "modify-roll",
          roll: "defense",
          amount: { type: "literal", value: 3 },
        }),
      ]),
    );
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Blast Shield")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-cost",
        amount: { type: "literal", value: -2 },
        minimum: { type: "literal", value: 1 },
      }),
    ]);
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Epitaph To War")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "set-resolution-threshold",
          outcome: "successful",
          value: { type: "literal", value: 25 },
        }),
        expect.objectContaining({
          type: "set-resolution-threshold",
          duration: { type: "combat", sourceText: "remainder of combat" },
        }),
      ]),
    );
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Serenity Explosion")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-roll", amount: { type: "literal", value: -2 } }),
        expect.objectContaining({ type: "modify-resource", resource: "hp", operation: "lose" }),
      ]),
    );
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Zen Explosion")?.effects).toEqual([
      expect.objectContaining({
        type: "reroll",
        roll: "defense",
        duration: { type: "combat", sourceText: "For the remainder of the match" },
      }),
    ]);
    expect(AOYOSUMU_MOVES.find((move) => move.name === "State of Zen")?.effects).toEqual([
      expect.objectContaining({
        type: "prevent-move-modification",
        aspects: ["dice-sides", "effects", "roll-results"],
        actor: "opponent",
      }),
    ]);
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Elevated Kick")?.effects).toEqual([
      expect.objectContaining({
        type: "prevent-roll-modification",
        roll: "attack",
        modifier: "result",
      }),
    ]);
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Sonic Whisper")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "skip-action",
          blockedCategories: ["advanced-attack", "signature"],
        }),
        expect.objectContaining({
          type: "modify-roll",
          amount: { type: "literal", value: -8 },
          scope: expect.objectContaining({
            type: "next-actions",
            count: { type: "literal", value: 3 },
          }),
        }),
      ]),
    );
    expect(
      AOYOSUMU_MOVES.find((move) => move.name === "The Secret of The Universe")?.effects,
    ).toEqual([
      expect.objectContaining({
        type: "set-resolution-threshold",
        relativeTo: "defense-roll",
        value: { type: "literal", value: 5 },
      }),
    ]);
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Untouchable Mastery")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-roll",
          modifier: "sides",
          amount: { type: "literal", value: 3 },
        }),
        expect.objectContaining({
          type: "modify-roll",
          modifier: "sides",
          amount: { type: "literal", value: 5 },
        }),
      ]),
    );
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Counterstrike Mastery")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "grant-counter-action",
          activationCost: {
            resource: "ki",
            operation: "lose",
            amount: { type: "literal", value: 1 },
          },
          useLimit: { scope: "combat", count: 2, sourceText: "Twice per combat" },
        }),
      ]),
    );
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Leverage Mastery")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-roll", roll: "defense" }),
        expect.objectContaining({ type: "modify-damage", percent: { type: "literal", value: 5 } }),
      ]),
    );
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Stoicism")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-roll-modifier",
        multiplier: { type: "literal", value: 2 },
        excludeSourceCategories: ["mastery"],
      }),
    ]);
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Quiet Preparation")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-damage",
        scope: expect.objectContaining({
          type: "next-actions",
          count: { type: "literal", value: 2 },
        }),
      }),
    ]);
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Lights Out Strike")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-damage",
        operation: "set",
        percent: { type: "literal", value: 0 },
      }),
    ]);
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Straightjacket")?.effects).toEqual([
      expect.objectContaining({
        type: "grant-counter-action",
        stopsTriggeringAttack: false,
        duration: {
          type: "turns",
          turns: { type: "literal", value: 6 },
          sourceText: "next 6 turns",
        },
      }),
    ]);
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Shaolin Cross Punch")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-cost",
        amount: { type: "literal", value: 1 },
        stacking: "prevent",
      }),
    ]);
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Super Arm Bar Takedown")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-roll", amount: { type: "literal", value: -2 } }),
        expect.objectContaining({
          type: "modify-remaining-uses",
          amount: { type: "literal", value: 1 },
        }),
      ]),
    );
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Swift Neck Chop")?.effects).toEqual([
      expect.objectContaining({ type: "modify-damage", percent: { type: "literal", value: 5 } }),
    ]);
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Trapped Strikes")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-roll", roll: "attack", modifier: "sides" }),
        expect.objectContaining({
          type: "modify-roll",
          roll: "defense",
          amount: { type: "literal", value: 2 },
        }),
      ]),
    );
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Hundred-Point Strike")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-cost",
        conditions: expect.arrayContaining([
          expect.objectContaining({ type: "successful-hit-count" }),
        ]),
      }),
    ]);
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Impenetrable Defense")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-roll",
        activationCost: {
          resource: "ki",
          operation: "lose",
          amount: { type: "literal", value: 2 },
        },
      }),
    ]);
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Tranquil Strike")?.effects).toEqual([
      expect.objectContaining({
        type: "set-combat-result",
        result: "stopped",
        scope: { type: "next-action", sourceText: "the next attack they perform against you" },
      }),
    ]);
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Sky Dance Technique")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "grant-extra-action",
          phase: "upkeep-phase",
          constant: true,
        }),
        expect.objectContaining({ type: "deactivate", affectedType: "skill" }),
        expect.objectContaining({ type: "modify-resource", resource: "ki", operation: "lose" }),
      ]),
    );
    expect(AOYOSUMU_MOVES.find((move) => move.name === "Somersault Roll")?.effects).toEqual([
      expect.objectContaining({
        type: "create-floating-effect",
        floatingEffectId: "somersault-roll-constant-skill-deactivation",
      }),
    ]);
  });
});
