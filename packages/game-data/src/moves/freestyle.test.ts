import { describe, expect, it } from "vitest";

import { FREESTYLE_MOVES } from "./freestyle.js";

describe("FREESTYLE_MOVES", () => {
  it("records Hidden Power Level's one-time threshold-paid zero-KI recovery", () => {
    expect(FREESTYLE_MOVES.find((move) => move.name === "Hidden Power Level")?.effects).toEqual([
      expect.objectContaining({
        type: "create-floating-effect",
        floatingEffectId: "hidden-power-level-zero-ki-recovery",
        useLimit: expect.objectContaining({ scope: "combat", count: 1 }),
      }),
    ]);
  });

  it("records Sense Power Level's initiative and level-gated defense bonuses", () => {
    expect(FREESTYLE_MOVES.find((move) => move.name === "Sense Power Level")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-roll", roll: "initiative" }),
        expect.objectContaining({ type: "modify-roll", roll: "defense" }),
        expect.objectContaining({ type: "modify-roll", roll: "escape" }),
      ]),
    );
  });

  it("records Unquenchable Bloodthirst's participant HP prohibition and match lock", () => {
    expect(
      FREESTYLE_MOVES.find((move) => move.name === "Unquenchable Bloodthirst")?.effects,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "prevent-resource-modification", operation: "gain" }),
        expect.objectContaining({ type: "prevent-resource-modification", operation: "set" }),
        expect.objectContaining({ type: "lock", affectedType: "skill", trigger: "on-deactivated" }),
      ]),
    );
  });

  it("records Straining Bodyslam's optional HP-paid recurring KI loss and roll penalty", () => {
    expect(FREESTYLE_MOVES.find((move) => move.name === "Straining Bodyslam")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-resource",
          activationGroup: "straining-bodyslam-paid-hp",
        }),
        expect.objectContaining({
          type: "schedule-effect",
          activationGroup: "straining-bodyslam-paid-hp",
        }),
        expect.objectContaining({ type: "modify-roll", amount: { type: "literal", value: -4 } }),
      ]),
    );
  });

  it("records Straining Knockback's optional HP-paid Advanced Attack cost increase", () => {
    expect(FREESTYLE_MOVES.find((move) => move.name === "Straining Knockback")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-resource",
          activationGroup: "straining-knockback-paid-hp",
        }),
        expect.objectContaining({ type: "modify-cost", amount: { type: "literal", value: 1 } }),
      ]),
    );
  });

  it("records Straining Aura Explosion's mandatory strain, anti-BLOCK, and KI branches", () => {
    expect(
      FREESTYLE_MOVES.find((move) => move.name === "Straining Aura Explosion")?.effects,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "prevent-resolution", prevention: "block" }),
        expect.objectContaining({ type: "modify-resource", resource: "hp", operation: "lose" }),
        expect.objectContaining({
          type: "modify-resource",
          target: "opponent",
          amount: { type: "literal", value: -2 },
        }),
      ]),
    );
  });

  it("records Multitasking Kick's prior-stop bonus and next-turn UPKEEP item use", () => {
    expect(FREESTYLE_MOVES.find((move) => move.name === "Multitasking Kick")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-roll", amount: { type: "literal", value: 3 } }),
        expect.objectContaining({
          type: "grant-extra-action",
          moveCategory: "item-use",
          phase: "upkeep-phase",
        }),
      ]),
    );
  });

  it("records Tricky Sword Maneuvers' Swordplay activation and Expert Swordplay branch", () => {
    expect(FREESTYLE_MOVES.find((move) => move.name === "Tricky Sword Maneuvers")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "activate",
          conditions: [expect.objectContaining({ type: "roll-threshold" })],
        }),
        expect.objectContaining({ type: "modify-roll", amount: { type: "literal", value: 3 } }),
        expect.objectContaining({ type: "modify-resource", resource: "ki", operation: "lose" }),
      ]),
    );
  });

  it("records Vile Energy's bounded CONSTANT Skill activation sequence", () => {
    expect(FREESTYLE_MOVES.find((move) => move.name === "Vile Energy")?.effects).toEqual([
      expect.objectContaining({
        type: "activate",
        repeatUntil: expect.objectContaining({
          type: "active-move-count-matches-opponent",
          fallback: "no-eligible-moves",
        }),
      }),
    ]);
  });

  it("records Monkey Maneuvers' anti-reduction and capped Dexterity Bonus rules", () => {
    expect(FREESTYLE_MOVES.find((move) => move.name === "Monkey Maneuvers")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "prevent-roll-modification", roll: "attack" }),
        expect.objectContaining({
          type: "modify-roll",
          amount: expect.objectContaining({ type: "bounded-stat", minimum: 1, maximum: 3 }),
        }),
        expect.objectContaining({
          type: "modify-roll",
          roll: "defense",
          amount: { type: "literal", value: 2 },
        }),
      ]),
    );
  });

  it("records Anger Manipulation's more-than-half-stopped reward and next-turn lock", () => {
    expect(FREESTYLE_MOVES.find((move) => move.name === "Anger Manipulation")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-resource",
          amount: { type: "triggering-move-ki-cost" },
          conditions: expect.arrayContaining([
            expect.objectContaining({ type: "stopped-hit-fraction" }),
          ]),
        }),
        expect.objectContaining({ type: "lock", affectedType: "attack" }),
      ]),
    );
  });

  it("records Guillotine Pummel's success-count KI-gain prohibition", () => {
    expect(FREESTYLE_MOVES.find((move) => move.name === "Guillotine Pummel")?.effects).toEqual([
      expect.objectContaining({
        type: "prevent-resource-modification",
        resource: "ki",
        exceptAction: "power-up",
        duration: expect.objectContaining({ turns: { type: "successful-hit-count" } }),
      }),
    ]);
  });

  it("records Effortless's optional Straining-attack HP-cost reduction", () => {
    expect(FREESTYLE_MOVES.find((move) => move.name === "Effortless")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-resource-cost",
        percent: { type: "literal", value: -5 },
        optional: true,
      }),
    ]);
  });

  it("records Monkey Sweep's BREAK/SEVER anti-BLOCK and Monkey Maneuvers fallbacks", () => {
    expect(FREESTYLE_MOVES.find((move) => move.name === "Monkey Sweep")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "prevent-resolution", prevention: "block" }),
        expect.objectContaining({ type: "activate" }),
        expect.objectContaining({ floatingEffectId: "monkey-sweep-next-stun-or-break-bonus" }),
        expect.objectContaining({
          floatingEffectId: "monkey-sweep-unavailable-next-stun-or-break-bonus",
        }),
      ]),
    );
  });
  it("records Underdog Evasion's level-gated block and next-attack stop", () => {
    expect(FREESTYLE_MOVES.find((move) => move.name === "Underdog Evasion")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "override-resolution-immunity", resolution: "block" }),
        expect.objectContaining({ type: "set-combat-result", result: "stopped" }),
      ]),
    );
  });

  it("records Straining Concussion Wave's mandatory HP loss and temporary move removal", () => {
    expect(
      FREESTYLE_MOVES.find((move) => move.name === "Straining Concussion Wave")?.effects,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-resource", operation: "lose", resource: "hp" }),
        expect.objectContaining({
          type: "remove-move-from-combat",
          duration: expect.objectContaining({ type: "until-perfect-roll" }),
        }),
      ]),
    );
  });

  it("records Ki Color Cascade's declared-style classification", () => {
    expect(FREESTYLE_MOVES.find((move) => move.name === "Ki Color Cascade")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-move-classification",
        replaceStyle: "declared-style",
        duration: expect.objectContaining({ type: "turns" }),
      }),
    ]);
  });

  it("converts Energy Redirection's per-die stopped result into a success", () => {
    expect(FREESTYLE_MOVES.find((move) => move.name === "Energy Redirection")?.effects).toEqual([
      expect.objectContaining({
        type: "set-combat-result",
        result: "successful",
        resultScope: "matching-die",
        useLimit: { scope: "combat", count: 2, sourceText: "RESTRICTEDx2" },
      }),
    ]);
  });

  it("negates and can remove a non-constant opposing skill with Nullifying Sphere", () => {
    expect(FREESTYLE_MOVES.find((move) => move.name === "Nullifying Sphere")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "negate", target: "opponent" }),
        expect.objectContaining({ type: "remove-move-from-combat", move: "target" }),
      ]),
    );
  });

  it("models Showdown, Aggressive Beatdown, and Suppressive Fire's bounded effects", () => {
    expect(FREESTYLE_MOVES.find((move) => move.name === "Showdown")?.effects).toEqual([
      expect.objectContaining({
        type: "suppress",
        target: "participants",
        aspects: ["all-effects"],
      }),
    ]);
    expect(FREESTYLE_MOVES.find((move) => move.name === "Aggressive Beatdown")?.effects).toEqual([
      expect.objectContaining({ type: "apply-status", statusId: "stun" }),
    ]);
    expect(FREESTYLE_MOVES.find((move) => move.name === "Suppressive Fire")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-cost",
        scope: expect.objectContaining({
          type: "next-actions",
          count: { type: "literal", value: 2 },
        }),
      }),
    ]);
  });

  it("records weapon-gated thresholds and recurring Bullet Ballet damage", () => {
    expect(FREESTYLE_MOVES.find((move) => move.name === "Way of The Gun")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "set-resolution-threshold", outcome: "stop" }),
      ]),
    );
    expect(FREESTYLE_MOVES.find((move) => move.name === "Bullet Ballet")?.effects).toEqual([
      expect.objectContaining({
        type: "schedule-effect",
        repeat: "each-turn",
        timing: expect.objectContaining({ type: "turn-end" }),
      }),
    ]);
  });

  it("models HP-gated skill rewards and cost-reduction prevention", () => {
    expect(FREESTYLE_MOVES.find((move) => move.name === "Immense Power")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-resource", resource: "ki", operation: "gain" }),
        expect.objectContaining({ type: "apply-status", statusId: "stun" }),
      ]),
    );
    expect(FREESTYLE_MOVES.find((move) => move.name === "Dragon Rush")?.effects).toEqual([
      expect.objectContaining({
        type: "prevent-move-modification",
        aspects: ["cost"],
        duration: expect.objectContaining({ type: "turns" }),
      }),
    ]);
  });

  it("records weapon follow-ups and multi-die status gates", () => {
    expect(FREESTYLE_MOVES.find((move) => move.name === "Sword Dance")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-roll",
        modifier: "sides",
        amount: { type: "literal", value: 3 },
      }),
    ]);
    expect(FREESTYLE_MOVES.find((move) => move.name === "Batter Up Blitz")?.effects).toEqual([
      expect.objectContaining({ type: "apply-status", statusId: "break" }),
    ]);
    expect(FREESTYLE_MOVES.find((move) => move.name === "Crossing Iron")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "apply-status", statusId: "stun" }),
        expect.objectContaining({ type: "modify-roll", modifier: "sides" }),
      ]),
    );
  });

  it("models delayed damage and explicit stacked stuns", () => {
    expect(FREESTYLE_MOVES.find((move) => move.name === "Cannons Sparking")?.effects).toEqual([
      expect.objectContaining({
        type: "schedule-effect",
        repeat: "each-turn",
        duration: expect.objectContaining({ type: "turns" }),
      }),
    ]);
    expect(
      FREESTYLE_MOVES.find((move) => move.name === "Straining Distraction Burst")?.effects,
    ).toEqual([
      expect.objectContaining({ type: "apply-status", statusId: "stun" }),
      expect.objectContaining({ type: "apply-status", statusId: "stun" }),
    ]);
  });

  it("records Heritage Calling's transformed-state roll bonus", () => {
    expect(FREESTYLE_MOVES.find((move) => move.name === "Heritage Calling")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-roll",
        roll: "transformation",
        scope: {
          type: "next-roll",
          roll: "transformation",
          sourceText: "your next Transformation Roll",
        },
      }),
    ]);
  });

  it("models last-turn and stopped-prior-attack gates", () => {
    expect(FREESTYLE_MOVES.find((move) => move.name === "Thwack!")?.effects).toEqual([
      expect.objectContaining({ type: "apply-status", statusId: "stun" }),
    ]);
    expect(FREESTYLE_MOVES.find((move) => move.name === "(Sword) Riposte!")?.effects).toEqual([
      expect.objectContaining({ type: "deactivate", affectedType: "skill" }),
    ]);
  });

  it("captures constant-skill deactivation and high-result BREAK effects", () => {
    expect(FREESTYLE_MOVES.find((move) => move.name === "Sternum Crusher")?.effects).toEqual([
      expect.objectContaining({ type: "deactivate", affectedType: "skill" }),
    ]);
    expect(FREESTYLE_MOVES.find((move) => move.name === "Baton Twirl")?.effects).toEqual([
      expect.objectContaining({ type: "apply-status", statusId: "break" }),
    ]);
  });

  it("records Vitality's status prevention and Combat Kick's selected skill cost", () => {
    expect(
      FREESTYLE_MOVES.find((move) => move.name === "Protecting Your Vitality")?.effects,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "prevent-status", statusId: "sever" }),
        expect.objectContaining({ type: "prevent-status", statusId: "break" }),
      ]),
    );
    expect(FREESTYLE_MOVES.find((move) => move.name === "________'s Combat Kick")?.effects).toEqual(
      [expect.objectContaining({ type: "modify-cost", amount: { type: "literal", value: 1 } })],
    );
  });

  it("records Heart Stab's Swordplay bonus and Straining Power Drain", () => {
    expect(FREESTYLE_MOVES.find((move) => move.name === "Heart Stab")?.effects).toEqual([
      expect.objectContaining({ type: "modify-roll", roll: "attack" }),
    ]);
    expect(FREESTYLE_MOVES.find((move) => move.name === "Straining Power Drain")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-resource",
        resource: "ki",
        amount: { type: "literal", value: 3 },
      }),
    ]);
  });

  it("records Underdog Dropkick's level-gated threshold and penalty", () => {
    expect(FREESTYLE_MOVES.find((move) => move.name === "Underdog Dropkick")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "set-resolution-threshold",
          conditions: [expect.objectContaining({ type: "level-comparison" })],
        }),
        expect.objectContaining({
          type: "modify-damage",
          conditions: [expect.objectContaining({ difference: { type: "literal", value: 2 } })],
        }),
      ]),
    );
  });

  it("records All-Out Triumphant Beam's transformed-opponent reversion", () => {
    expect(
      FREESTYLE_MOVES.find((move) => move.name === "All-Out Triumphant Beam")?.effects,
    ).toEqual([
      expect.objectContaining({
        type: "revert-transformation",
        conditions: expect.arrayContaining([
          expect.objectContaining({ type: "combat-state", state: "transformed" }),
        ]),
      }),
    ]);
  });
});
