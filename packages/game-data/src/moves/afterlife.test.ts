import { describe, expect, it } from "vitest";

import { AFTERLIFE_MOVES } from "./afterlife.js";

describe("AFTERLIFE_MOVES", () => {
  it("records Give Me Energy's attack-prevention negation", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Give Me Energy!")?.effects).toEqual([
      expect.objectContaining({ type: "negate", aspects: ["prevent-attack"] }),
    ]);
  });

  it("records result-gated resource, status, lock, and critical mechanics", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Light Grenade")?.effects).toEqual([
      expect.objectContaining({ type: "modify-resource", resource: "hp" }),
    ]);
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Meteor Smash")?.effects).toEqual([
      expect.objectContaining({ type: "apply-status", statusId: "stun" }),
    ]);
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Burning Attack")?.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "lock", affectedType: "power-up" })]),
    );
  });

  it("records selected-skill locks and combat-long multi-die bonuses", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Dodon Ray")?.effects).toEqual([
      expect.objectContaining({ type: "lock", affectedType: "skill" }),
    ]);
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Lightning Arrows")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-roll",
        duration: { type: "combat", sourceText: "For the remainder of combat" },
      }),
    ]);
  });

  it("captures the Afterlife catalog's anti-block and free power-up effects", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Heat Dome Attack")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "prevent-resolution", prevention: "block" }),
      ]),
    );
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Destructo Disc")?.effects).toEqual([
      expect.objectContaining({ type: "grant-extra-action", moveCategory: "power-up" }),
    ]);
  });

  it("represents transformed stop thresholds and permanent dice-side caps", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Final Flash")?.effects).toEqual([
      expect.objectContaining({
        type: "set-resolution-threshold",
        conditions: expect.arrayContaining([expect.objectContaining({ type: "combat-state" })]),
      }),
    ]);
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Super Big Bang Attack")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-roll",
          cap: expect.objectContaining({ type: "maximum" }),
        }),
      ]),
    );
  });

  it("captures threshold-gated cost, lock, and resource effects from Hell", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Death Beam")?.effects).toEqual([
      expect.objectContaining({ type: "modify-cost", amount: { type: "literal", value: 1 } }),
    ]);
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Evil Impulse")?.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "lock", affectedType: "power-up" })]),
    );
  });

  it("records the Hell catalog's next-action and selected attack locks", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Angry Explosion")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-damage",
        scope: expect.objectContaining({ type: "next-actions" }),
      }),
    ]);
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Volcano Explosion")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "lock", affectedType: "attack" }),
        expect.objectContaining({ type: "modify-cost", amount: { type: "literal", value: 2 } }),
      ]),
    );
  });

  it("captures pose bonuses, next-roll bonuses, and Life Drain's HP transfer", () => {
    expect(
      AFTERLIFE_MOVES.find((move) => move.name === "Special Fighting Pose 5")?.effects,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-roll",
          selector: expect.objectContaining({ category: "signature" }),
        }),
        expect.objectContaining({ type: "modify-resource", resource: "ki", operation: "gain" }),
      ]),
    );
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Life Drain")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-resource", target: "opponent", operation: "lose" }),
        expect.objectContaining({ type: "modify-resource", target: "self", operation: "gain" }),
      ]),
    );
  });

  it("represents S.S Deadly Bomb's relative stop threshold", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "S.S Deadly Bomb")?.effects).toEqual([
      expect.objectContaining({
        type: "set-resolution-threshold",
        outcome: "stop",
        relativeTo: "attack-roll",
      }),
    ]);
  });

  it("records Big Bang Crash, Scatter Shot, and Ki Blade Rush thresholds", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Big Bang Crash")?.effects).toEqual([
      expect.objectContaining({ type: "modify-roll", roll: "transformation" }),
    ]);
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Scatter Shot")?.effects).toEqual([
      expect.objectContaining({ type: "set-resolution-threshold", outcome: "stop" }),
    ]);
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Ki Blade Rush")?.effects).toEqual([
      expect.objectContaining({ type: "apply-status", statusId: "sever" }),
    ]);
  });

  it("records Death Chaser's next-energy bonus and Crusher Ball's roll bonus", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Death Chaser")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-roll", amount: { type: "literal", value: 1 } }),
        expect.objectContaining({ type: "modify-roll", amount: { type: "literal", value: 2 } }),
      ]),
    );
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Crusher Ball")?.effects).toEqual([
      expect.objectContaining({ type: "modify-roll", amount: { type: "literal", value: 2 } }),
    ]);
  });

  it("records Kienzan and Eraser Cannon's conditional thresholds", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Kienzan")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "apply-status", statusId: "sever" }),
        expect.objectContaining({ type: "grant-extra-action", moveCategory: "power-up" }),
      ]),
    );
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Eraser Cannon")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-damage" }),
        expect.objectContaining({
          type: "set-resolution-threshold",
          conditions: [expect.objectContaining({ rightStat: "dexterity" })],
        }),
      ]),
    );
  });

  it("records Dragon Fist, Gigantic Meteor, and Revenge Death Bomber HP effects", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Dragon Fist")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-resource",
        resource: "hp",
        amount: { type: "literal", value: 0 },
      }),
    ]);
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Gigantic Meteor")?.effects).toEqual([
      expect.objectContaining({ type: "set-resolution-threshold", outcome: "stop" }),
    ]);
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Revenge Death Bomber")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-resource", amount: { type: "literal", value: 1 } }),
        expect.objectContaining({ type: "modify-resource", amount: { type: "literal", value: 0 } }),
      ]),
    );
  });

  it("records Kamehameha, Final Revenger, and Bakuretsu Ranma follow-ups", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Kamehameha")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-damage",
        percent: { type: "source-expression", text: "15% Power" },
      }),
    ]);
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Final Revenger")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-roll",
          scope: { type: "current-action", sourceText: "this attack" },
        }),
        expect.objectContaining({
          type: "modify-roll",
          scope: expect.objectContaining({ type: "next-actions" }),
        }),
      ]),
    );
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Bakuretsu Ranma")?.effects).toEqual([
      expect.objectContaining({ type: "modify-roll", roll: "attack" }),
    ]);
  });

  it("records Super Galick Gun's shared paid boost and Death Slicer's cost lock", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Super Galick Gun")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-roll",
          activationGroup: "super-galick-gun-reactive-boost",
        }),
        expect.objectContaining({
          type: "set-combat-result",
          activationGroup: "super-galick-gun-reactive-boost",
        }),
      ]),
    );
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Death Slicer")?.effects).toEqual([
      expect.objectContaining({ type: "prevent-move-modification", aspects: ["cost"] }),
    ]);
  });

  it("records Thunder Flash's defense-relative double STUN", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Thunder Flash")?.effects).toEqual([
      expect.objectContaining({
        type: "apply-status",
        statusId: "stun",
        conditions: [expect.objectContaining({ type: "roll-comparison" })],
      }),
      expect.objectContaining({ type: "apply-status", statusId: "stun" }),
    ]);
  });

  it("records Burning Shoot's scheduled single-die threshold cancellation", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Burning Shoot")?.effects).toEqual([
      expect.objectContaining({
        type: "schedule-effect",
        repeat: "each-turn",
        cancellation: expect.objectContaining({
          rollThreshold: expect.objectContaining({
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 20 },
          }),
        }),
      }),
    ]);
  });

  it("records Tri-Beam's HP cost and Present Bomb's SP gate", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Tri-Beam")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-resource",
        resource: "hp",
        operation: "lose",
        amount: { type: "source-expression", text: "10% Total HP" },
      }),
    ]);
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Present Bomb")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-damage",
        conditions: [expect.objectContaining({ type: "stat-comparison", stat: "sp" })],
      }),
    ]);
  });

  it("records Gigantic Hammer's unblockability and Power-gated penalty", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Gigantic Hammer")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "prevent-resolution", prevention: "block" }),
        expect.objectContaining({
          type: "modify-damage",
          conditions: [
            expect.objectContaining({ rightMultiplier: { type: "literal", value: 1.25 } }),
          ],
        }),
      ]),
    );
  });

  it("records Spirit Bomb's Give Me Energy!-scaled damage", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Spirit Bomb")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-damage",
        percent: expect.objectContaining({ text: expect.stringContaining("Give Me Energy!") }),
      }),
    ]);
  });
});
