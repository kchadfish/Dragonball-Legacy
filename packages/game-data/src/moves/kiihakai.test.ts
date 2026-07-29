import { describe, expect, it } from "vitest";

import { KIIHAKAI_MOVES } from "./kiihakai.js";

describe("KIIHAKAI_MOVES", () => {
  it("records Orange Burst's linked damage replacement and deactivation", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Orange Burst")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-damage",
          operation: "set",
          activationGroup: "orange-burst-reduced-damage-deactivation",
        }),
        expect.objectContaining({
          type: "deactivate",
          activationGroup: "orange-burst-reduced-damage-deactivation",
        }),
      ]),
    );
  });

  it("records Kinetic Outburst's linked roll penalty and constant activation", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Kinetic Outburst")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-roll", amount: { type: "literal", value: -10 } }),
        expect.objectContaining({
          type: "activate",
          selector: expect.objectContaining({ constant: true }),
        }),
      ]),
    );
  });

  it("records representative passive, success, and stopped mechanics declaratively", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Channeled Chi Mastery")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-slot-capacity", slot: "skill" }),
        expect.objectContaining({ type: "modify-cost", minimum: { type: "literal", value: 1 } }),
      ]),
    );
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Aerial Beam")?.effects).toEqual([
      expect.objectContaining({ type: "lock", trigger: "on-success" }),
    ]);
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Power Deflection")?.effects).toEqual([
      expect.objectContaining({ type: "modify-resource", trigger: "on-stopped", resource: "hp" }),
    ]);
  });

  it("keeps multi-turn locks and hit-count gates in effect data", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Golden Arrows")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "lock",
          duration: expect.objectContaining({
            type: "turns",
            turns: { type: "literal", value: 3 },
          }),
        }),
      ]),
    );
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Raindance")?.effects).toEqual([
      expect.objectContaining({
        type: "lock",
        conditions: expect.arrayContaining([
          expect.objectContaining({
            type: "successful-hit-count",
            value: { type: "literal", value: 5 },
          }),
        ]),
      }),
    ]);
  });

  it("sets declarative roll thresholds for Ki Shield and Overload", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Ki Shield")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "set-resolution-threshold",
          outcome: "successful",
          relativeTo: "defense-roll",
        }),
      ]),
    );
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Overload")?.effects).toEqual([
      expect.objectContaining({ type: "set-resolution-threshold", outcome: "stop" }),
    ]);
  });

  it("records block-triggered locks and resource effects", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Beam Redirection")?.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "lock", trigger: "on-stopped" })]),
    );
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Too Hot To Touch")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-resource", resource: "hp", operation: "lose" }),
        expect.objectContaining({ type: "modify-resource", resource: "hp", operation: "set" }),
      ]),
    );
  });

  it("models Bukujutsu-gated sides and capped Power Surge gains", () => {
    expect(
      KIIHAKAI_MOVES.find((move) => move.name === "Aerial Domination Mastery")?.effects,
    ).toEqual([
      expect.objectContaining({ type: "modify-roll", roll: "attack", modifier: "sides" }),
    ]);
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Power Surge Mastery")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-damage" }),
        expect.objectContaining({
          type: "modify-resource",
          trigger: "on-power-up",
          cap: expect.objectContaining({ type: "maximum" }),
        }),
      ]),
    );
  });

  it("models full-hit constant activation and low-cost locks", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Focused Chi Barrage")?.effects).toEqual([
      expect.objectContaining({ type: "grant-extra-action", constant: true }),
    ]);
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Omega Beam")?.effects).toEqual([
      expect.objectContaining({ type: "deactivate", affectedType: "skill" }),
    ]);
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Orbital Cannon")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "lock", affectedType: "attack" }),
        expect.objectContaining({ type: "lock", affectedType: "skill" }),
      ]),
    );
  });

  it("records next-attack damage and multiplied stat comparisons", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Stray Bullet")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-damage",
        scope: expect.objectContaining({ type: "next-action" }),
      }),
    ]);
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Sledgehammer")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-roll",
        conditions: [
          expect.objectContaining({
            type: "stat-comparison",
            rightMultiplier: { type: "literal", value: 20 },
          }),
        ],
      }),
    ]);
  });

  it("records Focus Buster's mutual next-turn attack skip", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Focus Buster")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "skip-action", target: "self" }),
        expect.objectContaining({ type: "skip-action", target: "opponent" }),
      ]),
    );
  });

  it("records Fade Attack's defensive disadvantage", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Fade Attack")?.effects).toEqual([
      expect.objectContaining({
        type: "set-roll-selection",
        roll: "defense",
        selection: "lowest",
      }),
    ]);
  });

  it("records Shooting Star's doubled defensive-stop threshold", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Shooting Star")?.effects).toEqual([
      expect.objectContaining({
        type: "set-resolution-threshold",
        outcome: "stop",
        value: { type: "source-expression", text: "double your attack roll" },
      }),
    ]);
  });

  it("records Overdrive and Thunder Ball's conditional roll and damage bonuses", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Overdrive Mastery")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-damage",
        trigger: "on-power-up",
        percent: { type: "source-expression", text: "15% Power" },
      }),
    ]);
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Thunder Ball")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-roll",
        cap: expect.objectContaining({ value: { type: "literal", value: 8 } }),
      }),
    ]);
  });

  it("records The Heartstopper's Advanced and Signature cost penalty", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "The Heartstopper")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-cost",
          selector: expect.objectContaining({ category: "advanced-attack" }),
        }),
        expect.objectContaining({
          type: "modify-cost",
          selector: expect.objectContaining({ category: "signature" }),
        }),
      ]),
    );
  });

  it("records Negative Outburst's energy-or-pass constraint and cost penalty", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Negative Outburst")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "force-action",
          allowedTags: ["energy"],
          allowPass: true,
        }),
        expect.objectContaining({ type: "modify-cost", amount: { type: "literal", value: 1 } }),
      ]),
    );
  });

  it("records BOOMerang's opponent-cost-derived repeat", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "BOOMerang")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-cost",
        operation: "set",
        amount: { type: "source-expression", text: "The cost of your opponent's next attack" },
      }),
    ]);
  });
});
