import { describe, expect, it } from "vitest";

import { MIDORIKATAI_MOVES } from "./midorikatai.js";

describe("MIDORIKATAI_MOVES", () => {
  it("preserves Critical Mass Mastery's exact style, custom, and base-roll selectors", () => {
    expect(
      MIDORIKATAI_MOVES.find((move) => move.name === "Critical Mass Mastery")?.effects,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-critical-threshold",
          threshold: { type: "literal", value: 29 },
          basis: "final-result",
          selector: expect.objectContaining({
            styleId: "style-midorikatai",
            attackRoll: { dice: 1, maximumSides: 32 },
          }),
        }),
        expect.objectContaining({
          type: "modify-critical-threshold",
          selector: expect.objectContaining({
            styleId: "style-freestyle",
            custom: false,
            attackRoll: { dice: 1, maximumSides: 32 },
          }),
        }),
      ]),
    );
  });

  it("records Test of Strength's contest thresholds, attacker-wins ties, and HP penalty", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Test of Strength")?.effects).toEqual([
      expect.objectContaining({
        type: "resolve-contest",
        tie: "self-wins",
        qualifyingThreshold: { default: 5, whenSelfPowerHigher: 6 },
      }),
    ]);
  });

  it("records Leg Vice's two-turn bonus loss and either-combatant CONSTANT condition", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Leg Vice")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-stat", stat: "dexterity-bonus" }),
        expect.objectContaining({
          type: "prevent-resolution",
          conditions: [expect.objectContaining({ type: "active-move-count", subject: "either" })],
        }),
      ]),
    );
  });
  it("records Smackdown's cost protection, Bukujutsu bonus, and suppression", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Smackdown")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "prevent-move-modification", aspects: ["cost"] }),
        expect.objectContaining({ type: "modify-damage", percent: { type: "literal", value: 15 } }),
        expect.objectContaining({ type: "suppress-requirement", requirement: "Bukujutsu" }),
      ]),
    );
  });

  it("records Back Suplex's successful-result override", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Back Suplex")?.effects).toEqual([
      expect.objectContaining({ type: "set-combat-result", result: "successful" }),
    ]);
  });

  it("records Rocket Fire's temporary Dexterity replacement", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Rocket Fire")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-stat",
        stat: "dexterity",
        operation: "set",
        amount: { type: "stat-quotient", subject: "self", stat: "power", divisor: 20 },
      }),
    ]);
  });

  it("records passive damage, gated prevention, and selected attack locks", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Energy Gorged")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-damage",
        percent: { type: "stat-percent", subject: "self", stat: "power", percent: 10 },
      }),
    ]);
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Knee Stomp")?.effects).toEqual([
      expect.objectContaining({ type: "prevent-move-modification", trigger: "on-success" }),
    ]);
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Football Tackle")?.effects).toEqual([
      expect.objectContaining({ type: "lock", affectedType: "attack" }),
    ]);
  });

  it("tracks combat-long costs and resource-threshold locks", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Monster Mash")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-cost",
          duration: expect.objectContaining({ type: "combat" }),
        }),
      ]),
    );
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Cross Stance")?.effects).toEqual([
      expect.objectContaining({
        type: "lock",
        duration: expect.objectContaining({ type: "until-resource-threshold", resource: "ki" }),
      }),
    ]);
  });

  it("captures hit-count deactivation and conditional critical results", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Trapping Headbutts")?.effects).toEqual([
      expect.objectContaining({ type: "deactivate", affectedType: "skill" }),
    ]);
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Galactic Punisher")?.effects).toEqual([
      expect.objectContaining({ type: "set-combat-result", result: "critical" }),
    ]);
  });

  it("records reactive suppression and next-action block prevention", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Against The Odds")?.effects).toEqual([
      expect.objectContaining({
        type: "suppress",
        aspects: ["all-effects"],
        duration: expect.objectContaining({ type: "turns" }),
      }),
    ]);
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Overcharged Wave")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "prevent-resolution", prevention: "block" }),
      ]),
    );
  });

  it("models Absolute Might's slot and defensive-stop threshold bonuses", () => {
    expect(
      MIDORIKATAI_MOVES.find((move) => move.name === "Absolute Might Mastery")?.effects,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-slot-capacity", slot: "advanced-attack" }),
        expect.objectContaining({
          type: "set-resolution-threshold",
          outcome: "stop",
          value: { type: "literal", value: 12 },
        }),
      ]),
    );
  });

  it("records Bonecrusher's BREAK-gated damage bonus", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Bonecrusher Mastery")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-damage",
        percent: { type: "stat-percent", subject: "self", stat: "power", percent: 10 },
      }),
    ]);
  });

  it("records Overwhelming Master's Midorikatai attack damage bonus", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Overwhelming Mastery")?.effects).toEqual(
      [
        expect.objectContaining({
          type: "modify-damage",
          percent: { type: "stat-percent", subject: "self", stat: "power", percent: 5 },
        }),
      ],
    );
  });
  it("records Big Bopper's selected constant-skill suppression", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Big Bopper")?.effects).toEqual([
      expect.objectContaining({ type: "suppress", aspects: ["all-effects"] }),
    ]);
  });

  it("records Armbreaker's result-gated BREAK", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Armbreaker")?.effects).toEqual([
      expect.objectContaining({ type: "apply-status", statusId: "break" }),
    ]);
  });

  it("records Enraged Piledriver's prior-success KI gain", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Enraged Piledriver")?.effects).toEqual([
      expect.objectContaining({ type: "modify-resource", resource: "ki", operation: "gain" }),
    ]);
  });

  it("records Finger Cuffs' result-gated cost increase and BREAK", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Finger Cuffs")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-cost", amount: { type: "literal", value: 2 } }),
        expect.objectContaining({ type: "apply-status", statusId: "break" }),
      ]),
    );
  });

  it("records Doomsday Device's result-gated BREAK", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Doomsday Device")?.effects).toEqual([
      expect.objectContaining({ type: "apply-status", statusId: "break" }),
    ]);
  });

  it("records Falling Star Charge's triple BREAK and zero-cost follow-up", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Falling Star Charge")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "apply-status", statusId: "break" }),
        expect.objectContaining({
          type: "modify-cost",
          operation: "set",
          amount: { type: "literal", value: 0 },
        }),
      ]),
    );
  });

  it("records Gorilla Press's next physical-attack damage penalty", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Gorilla Press")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-damage",
        percent: { type: "stat-percent", subject: "self", stat: "power", percent: -20 },
      }),
    ]);
  });

  it("records Aggravated Assault's paid next-attack stop prevention", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Aggravated Assault")?.effects).toEqual([
      expect.objectContaining({
        type: "prevent-resolution",
        prevention: "stop",
        activationCost: {
          resource: "ki",
          operation: "lose",
          amount: { type: "literal", value: 2 },
        },
      }),
    ]);
  });

  it("records Nothing Pretty's hit-gated next-turn zero-cost attack", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Nothing Pretty")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-cost",
        operation: "set",
        amount: { type: "literal", value: 0 },
        conditions: [expect.objectContaining({ type: "successful-hit-count" })],
      }),
    ]);
  });

  it("records Omega Strike's resource- and SP-gated stop prevention", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Omega Strike")?.effects).toEqual([
      expect.objectContaining({
        type: "prevent-resolution",
        prevention: "stop",
        conditions: expect.arrayContaining([
          expect.objectContaining({ type: "stat-comparison", stat: "sp" }),
          expect.objectContaining({ type: "resource-threshold", resource: "ki" }),
        ]),
      }),
    ]);
  });

  it("records Power Drill's optional next-attack successful-effect suppression", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Power Drill")?.effects).toEqual([
      expect.objectContaining({ type: "suppress", aspects: ["successful-effects"] }),
    ]);
  });

  it("records Ankle Buster's hit-scaled kick lock and energy penalty", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Ankle Buster")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "lock", stacking: "prevent" }),
        expect.objectContaining({
          type: "modify-damage",
          percent: { type: "damage-percent", subject: "current-action", percent: -10 },
        }),
      ]),
    );
  });

  it("records Flawless Execution's Signature cost and result bonuses", () => {
    expect(
      MIDORIKATAI_MOVES.find((move) => move.name === "Flawless Execution Mastery")?.effects,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-cost", minimum: { type: "literal", value: 3 } }),
        expect.objectContaining({
          type: "modify-roll",
          cap: { type: "allow-exceed", sourceText: "can exceed the dice side and dice result cap" },
        }),
      ]),
    );
  });

  it("records Flapjack, Stranglehold, and Energy Breaker's follow-up protection", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Flapjack")?.effects).toEqual([
      expect.objectContaining({ type: "modify-roll", amount: { type: "literal", value: 2 } }),
    ]);
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Stranglehold")?.effects).toEqual([
      expect.objectContaining({ type: "modify-cost", amount: { type: "literal", value: 1 } }),
    ]);
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Energy Breaker")?.effects).toEqual([
      expect.objectContaining({ type: "prevent-move-modification", aspects: ["damage"] }),
    ]);
  });

  it("records Spinebuster's paid-cost BREAK branches", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Spinebuster")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "apply-status",
          conditions: [expect.objectContaining({ type: "paid-ki-cost", comparison: "at-least" })],
        }),
        expect.objectContaining({
          type: "apply-status",
          conditions: expect.arrayContaining([
            expect.objectContaining({ type: "paid-ki-cost", comparison: "exactly" }),
          ]),
        }),
      ]),
    );
  });

  it("records Kneebreaker's prior-cost-gated BREAK", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Kneebreaker")?.effects).toEqual([
      expect.objectContaining({
        type: "apply-status",
        conditions: expect.arrayContaining([
          expect.objectContaining({
            type: "prior-action",
            selector: expect.objectContaining({
              baseKiCost: { comparison: "at-least", value: { type: "literal", value: 2 } },
            }),
          }),
        ]),
      }),
    ]);
  });

  it("records Gut Punch's successful-attack-ended Skill cost penalty", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Gut Punch")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-cost",
        amount: { type: "literal", value: 2 },
        duration: expect.objectContaining({ type: "until-combat-result" }),
      }),
    ]);
  });

  it("records Whiplash's active-opponent-skill low-defense stop prevention", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Whiplash")?.effects).toEqual([
      expect.objectContaining({
        type: "set-resolution-threshold",
        value: { type: "literal", value: 15 },
        conditions: [expect.objectContaining({ type: "active-move-count", subject: "opponent" })],
      }),
    ]);
  });

  it("records One-Two Punch's first-hit second-roll bonus and two-hit penalty", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "One-Two Punch")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-roll",
          dieIndex: 2,
          amount: { type: "literal", value: 5 },
        }),
        expect.objectContaining({
          type: "modify-damage",
          percent: { type: "literal", value: -10 },
        }),
      ]),
    );
  });

  it("records Raining Bombs's cost floor and all-stopped end-phase escape roll", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Raining Bombs")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-cost",
          minimum: { type: "literal", value: 2 },
        }),
        expect.objectContaining({
          type: "grant-escape-roll",
          phase: "end-phase",
          conditions: [expect.objectContaining({ type: "attack-roll-resolution" })],
        }),
      ]),
    );
  });

  it("records Grapple's optional one-constant-skill combat reactivation", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Grapple")?.effects).toEqual([
      expect.objectContaining({
        type: "reactivate-deactivated-constant-skill",
        deactivatedTiming: "combat",
        selectionLimit: 1,
      }),
    ]);
  });

  it("records Torture Rack's no-turn transformation and first-use roll bonus", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Torture Rack")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "grant-transformation-action", turnCost: "none" }),
        expect.objectContaining({
          type: "modify-roll",
          roll: "transformation",
          conditions: [expect.objectContaining({ type: "move-use-count", value: 1 })],
        }),
      ]),
    );
  });

  it("records Cobra Clutch Drop's power bonus and Beam/Blast roll penalty", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Cobra Clutch Drop")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-damage",
          conditions: [expect.objectContaining({ type: "stat-comparison", stat: "power" })],
        }),
        expect.objectContaining({
          type: "modify-roll",
          amount: { type: "literal", value: -3 },
          selector: expect.objectContaining({ tags: ["beam", "blast"] }),
          duration: expect.objectContaining({ type: "until-combat-result" }),
        }),
      ]),
    );
  });

  it("records X-Attack's stopped-die transformation penalty and forced roll", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "X-Attack")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-roll",
          roll: "transformation",
          amount: { type: "stopped-hit-count", perHit: -3 },
          stacking: "allow",
        }),
        expect.objectContaining({
          type: "require-transformation-roll",
          ignoreTransformationDice: true,
        }),
      ]),
    );
  });

  it("records Breaker Breaker's first-turn BREAK and subsequent BREAKx2 effect", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Breaker Breaker")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "grant-combat-outcome",
          outcome: "break",
          conditions: [expect.objectContaining({ type: "combat-turn", value: 1 })],
        }),
        expect.objectContaining({
          type: "modify-combat-outcome",
          outcome: "break",
          multiplier: { type: "literal", value: 2 },
        }),
      ]),
    );
  });

  it("records Fall 7 Times's two-stopped activation and low-cost attack protection", () => {
    expect(
      MIDORIKATAI_MOVES.find((move) => move.name === "Fall 7 Times, Get Up 8")?.effects,
    ).toEqual([
      expect.objectContaining({
        type: "create-floating-effect",
        activationCost: expect.objectContaining({ amount: { type: "literal", value: 1 } }),
        conditions: [expect.objectContaining({ type: "action-sequence", count: 2 })],
        effects: expect.arrayContaining([
          expect.objectContaining({ type: "prevent-resolution", prevention: "block" }),
          expect.objectContaining({
            type: "prevent-resolution",
            prevention: "stop",
            source: "effect",
          }),
          expect.objectContaining({ type: "set-resolution-threshold", relativeTo: "attack-roll" }),
        ]),
      }),
    ]);
  });

  it("records Not Over Till It's Over's sacrifice, partial doubling, and SEVER prevention", () => {
    expect(
      MIDORIKATAI_MOVES.find((move) => move.name === "Not Over Till It's Over!")?.effects,
    ).toEqual([
      expect.objectContaining({
        type: "create-floating-effect",
        selectionLimit: 1,
        effects: expect.arrayContaining([
          expect.objectContaining({ type: "remove-move-from-combat" }),
          expect.objectContaining({
            type: "modify-roll",
            multiplier: { type: "literal", value: 2 },
            affectedDice: "ceiling-half",
          }),
          expect.objectContaining({ type: "prevent-combat-result", result: "sever" }),
        ]),
      }),
    ]);
  });

  it("records Domination Master's damage-reduction surcharge and two-turn attack reward", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Domination Mastery")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-damage-reduction-cost",
          amount: { type: "literal", value: 1 },
        }),
        expect.objectContaining({
          type: "create-floating-effect",
          conditions: [
            expect.objectContaining({ type: "action-sequence", count: 2, differentTurns: true }),
          ],
          effects: expect.arrayContaining([
            expect.objectContaining({ type: "prevent-resolution", prevention: "block" }),
            expect.objectContaining({
              type: "set-resolution-threshold",
              value: { type: "literal", value: 22 },
            }),
          ]),
        }),
      ]),
    );
  });
});
