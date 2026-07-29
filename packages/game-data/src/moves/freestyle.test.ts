import { describe, expect, it } from "vitest";

import { FREESTYLE_MOVES } from "./freestyle.js";

describe("FREESTYLE_MOVES", () => {
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
      expect.objectContaining({ type: "suppress", target: "participants" }),
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
