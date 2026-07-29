import { describe, expect, it } from "vitest";

import { MIDORIKATAI_MOVES } from "./midorikatai.js";

describe("MIDORIKATAI_MOVES", () => {
  it("records Rocket Fire's temporary Dexterity replacement", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Rocket Fire")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-stat",
        stat: "dexterity",
        operation: "set",
        amount: { type: "source-expression", text: "Power / 20" },
      }),
    ]);
  });

  it("records passive damage, gated prevention, and selected attack locks", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Energy Gorged")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-damage",
        percent: { type: "source-expression", text: "10% Power" },
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
        percent: { type: "source-expression", text: "10% Power" },
      }),
    ]);
  });

  it("records Overwhelming Master's Midorikatai attack damage bonus", () => {
    expect(MIDORIKATAI_MOVES.find((move) => move.name === "Overwhelming Mastery")?.effects).toEqual(
      [
        expect.objectContaining({
          type: "modify-damage",
          percent: { type: "source-expression", text: "5% Power" },
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
        percent: { type: "source-expression", text: "-20% Your Power" },
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
          percent: { type: "source-expression", text: "-10% Damage" },
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
});
