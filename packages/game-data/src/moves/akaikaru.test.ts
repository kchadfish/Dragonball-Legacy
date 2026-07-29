import { describe, expect, it } from "vitest";

import { AKAIKARU_MOVES } from "./akaikaru.js";

describe("AKAIKARU_MOVES", () => {
  it("records Stampede Rush's Dexterity Bonus damage condition", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "Stampede Rush")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-damage",
        percent: { type: "literal", value: 10 },
        conditions: [expect.objectContaining({ type: "stat-comparison" })],
      }),
    ]);
  });

  it("records Sniping Shot's successful-result cooldown", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "Sniping Shot")?.effects).toEqual([
      expect.objectContaining({
        type: "apply-status",
        statusId: "cooldown",
        selector: expect.objectContaining({ ids: ["move-akaikaru-sniping-shot"] }),
      }),
    ]);
  });

  it("models Follow Up's copied successful effect and per-die damage", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "Follow Up")?.effects).toEqual([
      expect.objectContaining({
        type: "copy-move-effect",
        effectResult: "successful",
        damage: { type: "half-base-damage-per-die", sourceMove: "last-advanced-attack" },
      }),
    ]);
  });

  it("allows a successful Chained Strikes to repeat itself once that turn", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "Chained Strikes")?.effects).toEqual([
      expect.objectContaining({
        type: "grant-extra-action",
        phase: "action-phase",
        moveCategory: "advanced-attack",
        move: "source",
        useLimit: {
          scope: "turn",
          count: 1,
          sourceText: "You cannot use this effect more than once per turn",
        },
      }),
    ]);
  });

  it("gives the next physical attack four additional sides after Firestorm", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "Firestorm")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-roll",
        roll: "attack",
        modifier: "sides",
        amount: { type: "literal", value: 4 },
        scope: { type: "next-action", sourceText: "Your next physical attack" },
      }),
    ]);
  });

  it("deactivates an opposing constant skill after Back Brain Kick", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "Back Brain Kick")?.effects).toEqual([
      expect.objectContaining({ type: "deactivate", affectedType: "skill", target: "opponent" }),
    ]);
  });

  it("reduces the cost of the next two skills after Blown Fuse", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "Blown Fuse")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-cost",
        amount: { type: "literal", value: -1 },
        scope: expect.objectContaining({
          type: "next-actions",
          count: { type: "literal", value: 2 },
        }),
      }),
    ]);
  });

  it("prevents a power up and schedules upkeep damage after Continuous Knee Smash", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "Continuous Knee Smash")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "lock", affectedType: "power-up" }),
        expect.objectContaining({
          type: "schedule-effect",
          timing: { type: "phase-start", phase: "upkeep", subject: "opponent", turnsAfter: 1 },
        }),
      ]),
    );
  });

  it("locks one selected block for all participants after Torpedo Kick", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "Torpedo Kick")?.effects).toEqual([
      expect.objectContaining({
        type: "lock",
        affectedType: "block",
        target: "participants",
        stacking: "prevent",
      }),
    ]);
  });

  it("records post-defense rerolls and fixed defensive dice", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "Swift Reaction")?.effects).toEqual([
      expect.objectContaining({ type: "reroll", roll: "attack", rerollScope: "entire-attack" }),
    ]);
    expect(AKAIKARU_MOVES.find((move) => move.name === "Speed Demon")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "set-roll-definition",
          roll: "defense",
          dice: 1,
          sides: 30,
        }),
        expect.objectContaining({ type: "prevent-roll-modification", roll: "defense" }),
      ]),
    );
  });

  it("records mastery critical follow-ups and stun-gated modifiers", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "Adrenaline Rush Mastery")?.effects).toEqual(
      [expect.objectContaining({ type: "modify-cost", minimum: { type: "literal", value: 1 } })],
    );
    expect(AKAIKARU_MOVES.find((move) => move.name === "Berserker Mastery")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "apply-status", statusId: "stun" }),
        expect.objectContaining({ type: "modify-damage" }),
      ]),
    );
  });

  it("models hit-count gated actions, repeated upkeep damage, and delayed roll changes", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "Windmill Kick")?.effects).toEqual([
      expect.objectContaining({
        type: "grant-extra-action",
        moveCategory: "skill",
        conditions: [expect.objectContaining({ type: "successful-hit-count" })],
      }),
    ]);
    expect(AKAIKARU_MOVES.find((move) => move.name === "Prism Inferno")?.effects).toEqual([
      expect.objectContaining({
        type: "schedule-effect",
        repeat: "each-turn",
        stacking: "prevent",
      }),
    ]);
    expect(AKAIKARU_MOVES.find((move) => move.name === "Buckshot")?.effects).toEqual([
      expect.objectContaining({ type: "set-roll-definition", dice: 2, sides: 30 }),
    ]);
  });

  it("captures signature and block follow-up effects", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "Burnout")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "apply-status", statusId: "stun" }),
        expect.objectContaining({
          type: "modify-damage",
          percent: { type: "source-expression", text: "10% Power" },
        }),
      ]),
    );
    expect(AKAIKARU_MOVES.find((move) => move.name === "Chained Mauler")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "grant-extra-action",
          useLimit: expect.objectContaining({ scope: "combat" }),
        }),
        expect.objectContaining({
          type: "modify-cost",
          operation: "set",
          amount: { type: "literal", value: 0 },
        }),
      ]),
    );
    expect(AKAIKARU_MOVES.find((move) => move.name === "Limb Twist")?.effects).toEqual([
      expect.objectContaining({ type: "grant-extra-action", activationCost: expect.anything() }),
    ]);
  });

  it("captures phase-scoped bonuses and result-gated effects", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "Vehemence")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-roll",
        scope: expect.objectContaining({ type: "next-actions" }),
        stacking: "prevent",
      }),
    ]);
    expect(AKAIKARU_MOVES.find((move) => move.name === "Sonic Boom")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-resource", resource: "ki" }),
        expect.objectContaining({ type: "apply-status", statusId: "stun" }),
      ]),
    );
    expect(AKAIKARU_MOVES.find((move) => move.name === "Great Finale")?.effects).toEqual([
      expect.objectContaining({ type: "apply-status", statusId: "stun" }),
    ]);
  });

  it("records Buzzsaw Kick, Bullrush, and Lord of the Flies follow-ups", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "Buzzsaw Kick")?.effects).toEqual([
      expect.objectContaining({ type: "modify-roll", amount: { type: "literal", value: 4 } }),
    ]);
    expect(AKAIKARU_MOVES.find((move) => move.name === "Bullrush")?.effects).toEqual([
      expect.objectContaining({ type: "set-roll-selection", selection: "highest" }),
    ]);
    expect(AKAIKARU_MOVES.find((move) => move.name === "Lord of the Flies")?.effects).toEqual([
      expect.objectContaining({ type: "apply-status", statusId: "stun" }),
    ]);
  });

  it("records Hypersonic Knockout's layered STUN thresholds", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "Hypersonic Knockout")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "apply-status", statusId: "stun" }),
        expect.objectContaining({
          type: "apply-status",
          conditions: [expect.objectContaining({ type: "roll-comparison" })],
        }),
      ]),
    );
  });

  it("records Dexterous Glaive and Pressure Cooker conditional bonuses", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "Dexterous Glaive")?.effects).toEqual([
      expect.objectContaining({ type: "modify-roll", modifier: "sides" }),
    ]);
    expect(AKAIKARU_MOVES.find((move) => move.name === "Pressure Cooker")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-damage",
        conditions: [expect.objectContaining({ type: "stat-comparison", stat: "dexterity" })],
      }),
    ]);
  });

  it("records Scorched Earth's escape lock and STUN-attack cost", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "Scorched Earth")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "lock", affectedType: "escape" }),
        expect.objectContaining({
          type: "modify-cost",
          operation: "set",
          amount: { type: "literal", value: 0 },
        }),
      ]),
    );
  });
});
