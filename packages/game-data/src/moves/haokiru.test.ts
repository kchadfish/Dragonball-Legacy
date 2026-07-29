import { describe, expect, it } from "vitest";

import { HAOKIRU_MOVES } from "./haokiru.js";

describe("HAOKIRU_MOVES", () => {
  it("gains total-HP healing once per power-up turn through Reserves", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Reserves")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-resource",
        resource: "hp",
        operation: "gain",
        useLimit: { scope: "turn", count: 1, sourceText: "once per turn" },
      }),
    ]);
  });

  it("sets HP to one and restores KI after Survival Instinct's below-zero trigger", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Survival Instinct")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-resource", resource: "hp", operation: "set" }),
        expect.objectContaining({ type: "modify-resource", resource: "ki", operation: "gain" }),
      ]),
    );
  });

  it("reduces successful unrestricted attack damage through Muscle Infusion", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Muscle Infusion")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-damage",
        percent: { type: "literal", value: -50 },
        useLimit: { scope: "combat", count: 2, sourceText: "RESTRICTEDx2" },
      }),
    ]);
  });

  it("adds total HP at match start when Dragon's Pride has no SP deficit", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Dragon's Pride")?.effects).toEqual([
      expect.objectContaining({ type: "modify-resource", resource: "hp", operation: "gain" }),
    ]);
  });

  it("reduces the next attack cost and starts with KI through Conservation Mastery", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Conservation Mastery")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-cost", amount: { type: "literal", value: -1 } }),
        expect.objectContaining({ type: "modify-resource", resource: "ki", operation: "gain" }),
      ]),
    );
  });

  it("reduces high-margin opposing attack damage through Advanced Behavior", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Advanced Behavior")?.effects).toEqual([
      expect.objectContaining({ type: "modify-damage", percent: { type: "literal", value: -10 } }),
    ]);
  });

  it("records Haokiru's result-gated attack effects declaratively", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Eye Laser Assault")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ trigger: "on-success", type: "modify-cost" }),
        expect.objectContaining({ trigger: "on-stopped", type: "modify-cost" }),
      ]),
    );
    expect(HAOKIRU_MOVES.find((move) => move.name === "Lion's Roar")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-damage",
        scope: expect.objectContaining({ type: "next-actions" }),
        conditions: expect.arrayContaining([
          expect.objectContaining({ type: "stat-comparison", stat: "max-hp" }),
        ]),
      }),
    ]);
  });

  it("captures hit-count scaling and target-selective locks", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Phantom Barrage")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-resource",
        cap: expect.objectContaining({ type: "maximum" }),
        conditions: expect.arrayContaining([
          expect.objectContaining({
            type: "successful-hit-count",
            value: { type: "literal", value: 3 },
          }),
        ]),
      }),
    ]);
    expect(HAOKIRU_MOVES.find((move) => move.name === "Dragon Blast")?.effects).toEqual([
      expect.objectContaining({ type: "lock", affectedType: "move" }),
    ]);
  });

  it("models Rapture's action lock and Soul Breaker's ordered penalties", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Rapture")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-resource", resource: "hp" }),
        expect.objectContaining({ type: "lock", affectedType: "power-up" }),
      ]),
    );
    expect(HAOKIRU_MOVES.find((move) => move.name === "Soul Breaker")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "prevent-resolution", prevention: "stop" }),
        expect.objectContaining({
          type: "modify-damage",
          scope: expect.objectContaining({ type: "following-action", offset: 2 }),
        }),
      ]),
    );
  });

  it("records Haokiru block rewards and subsequent roll prevention", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Ki Lock-Up")?.effects).toEqual([
      expect.objectContaining({ type: "modify-resource", resource: "ki", operation: "gain" }),
    ]);
    expect(HAOKIRU_MOVES.find((move) => move.name === "Neutralization")?.effects).toEqual([
      expect.objectContaining({ type: "prevent-move-modification" }),
    ]);
  });

  it("models Spirited Effort's low-HP next-attack benefits", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Spirited Effort")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-cost", amount: { type: "literal", value: -2 } }),
        expect.objectContaining({ type: "modify-resource", resource: "hp", operation: "gain" }),
      ]),
    );
  });

  it("records Dragon's Pride's start-of-combat SP gate", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Dragon's Pride")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-resource",
        trigger: "start-combat",
        conditions: [expect.objectContaining({ type: "stat-comparison", stat: "sp" })],
      }),
    ]);
  });

  it("records Dragon Spiral's two-hit next-attack heal", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Dragon Spiral")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-resource",
        resource: "hp",
        conditions: [expect.objectContaining({ type: "successful-hit-count" })],
      }),
    ]);
  });

  it("models Hellstorm's zero-cost repeat and follow-up side penalty", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Hellstorm")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "grant-extra-action", move: "source" }),
        expect.objectContaining({
          type: "modify-cost",
          operation: "set",
          amount: { type: "literal", value: 0 },
        }),
        expect.objectContaining({
          type: "modify-roll",
          modifier: "sides",
          amount: { type: "literal", value: -10 },
        }),
      ]),
    );
  });

  it("records Miracle Wave's result-gated total-HP heal", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Miracle Wave")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-resource",
        resource: "hp",
        conditions: [expect.objectContaining({ type: "roll-threshold" })],
      }),
    ]);
  });

  it("records Ki Lance's Mastery lock and Playtime's Over roll bonus", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Ki Lance")?.effects).toEqual([
      expect.objectContaining({ type: "lock", affectedType: "move" }),
    ]);
    expect(HAOKIRU_MOVES.find((move) => move.name === "Playtime's Over")?.effects).toEqual([
      expect.objectContaining({ type: "modify-roll", amount: { type: "literal", value: 3 } }),
    ]);
  });

  it("records Enervating Cannon, Dragon Fire, and Miraculous Recovery follow-ups", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Enervating Cannon")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-cost",
        operation: "set",
        amount: { type: "literal", value: 0 },
      }),
    ]);
    expect(HAOKIRU_MOVES.find((move) => move.name === "Dragon Fire")?.effects).toEqual([
      expect.objectContaining({ type: "modify-resource", resource: "hp" }),
    ]);
    expect(HAOKIRU_MOVES.find((move) => move.name === "Miraculous Recovery")?.effects).toEqual([
      expect.objectContaining({ type: "modify-cost", amount: { type: "literal", value: -1 } }),
    ]);
  });

  it("records Focused Spirit Cutter's current-HP-gated cost and penalty", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Focused Spirit Cutter")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-cost",
          conditions: [expect.objectContaining({ type: "resource-comparison", resource: "hp" })],
        }),
        expect.objectContaining({
          type: "modify-damage",
          percent: { type: "source-expression", text: "-50% Damage" },
        }),
      ]),
    );
  });

  it("records Dragon Effect's higher-current-HP cost reduction", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Dragon Effect")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-cost",
        minimum: { type: "literal", value: 0 },
        conditions: [
          expect.objectContaining({ type: "resource-comparison", comparison: "higher-than" }),
        ],
      }),
    ]);
  });

  it("records Indestructible Wave's unblockability", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Indestructible Wave")?.effects).toEqual([
      expect.objectContaining({ type: "prevent-resolution", prevention: "block" }),
    ]);
  });
});
