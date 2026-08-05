import { describe, expect, it } from "vitest";

import { HAOKIRU_MOVES } from "./haokiru.js";

describe("HAOKIRU_MOVES", () => {
  it("records Vengeance Wave's two-attack damage expression", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Vengeance Wave")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-damage",
        operation: "set",
        percent: { type: "prior-attack-damage-percent", actor: "opponent", count: 2 },
      }),
    ]);
  });

  it("records Sonic Kick's non-Haokiru cost-modification prevention", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Sonic Kick")?.effects).toEqual([
      expect.objectContaining({
        type: "prevent-move-modification",
        aspects: ["cost"],
        actor: "any",
        effectSourceStyleExcludes: "style-haokiru",
      }),
    ]);
  });

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
          percent: { type: "damage-percent", subject: "current-action", percent: -50 },
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

  it("records Healing Ray's protected thresholded healing and low-roll KI", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Healing Ray")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "roll-and-store", storageKey: "healing-ray-result" }),
        expect.objectContaining({
          type: "modify-resource",
          resource: "hp",
          amount: expect.objectContaining({ type: "resource-percent", percent: 25 }),
        }),
        expect.objectContaining({ type: "prevent-move-modification", aspects: ["effects"] }),
        expect.objectContaining({
          type: "modify-resource",
          resource: "ki",
          amount: { type: "literal", value: 1 },
        }),
      ]),
    );
  });

  it("records Halcyon Blow's last-turn healing-gated constant activation", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Halcyon Blow")?.effects).toEqual([
      expect.objectContaining({
        type: "activate",
        conditions: [expect.objectContaining({ type: "resource-change", timing: "last-turn" })],
      }),
    ]);
  });

  it("records Creationist's exclusive Haokiru cost-modification choices", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Creationist")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-cost",
          minimum: { type: "literal", value: 0 },
          exclusiveActivationGroup: "creationist-choice",
        }),
        expect.objectContaining({
          type: "modify-cost",
          amount: { type: "literal", value: -1 },
          exclusiveActivationGroup: "creationist-choice",
        }),
      ]),
    );
  });

  it("records Mind Reading's last-opponent-attack copy semantics", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Mind Reading")?.effects).toEqual([
      expect.objectContaining({
        type: "copy-move-effect",
        sourceMove: expect.objectContaining({ actor: "opponent" }),
        copies: ["cost", "dice-rolls", "source-modifiers"],
      }),
    ]);
  });

  it("records Willing Sacrifice's current-HP cost, optional rerolls, and free turn", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Willing Sacrifice")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-resource",
          amount: expect.objectContaining({ type: "resource-percent", basis: "current" }),
        }),
        expect.objectContaining({ type: "reroll", optional: true }),
        expect.objectContaining({ type: "grant-extra-action", phase: "action-phase" }),
      ]),
    );
  });

  it("records Immortal Burst's post-last-turn damage threshold Ki reward", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Immortal Burst")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-resource",
        resource: "ki",
        conditions: [
          expect.objectContaining({ type: "incoming-damage", timing: "after-last-turn" }),
        ],
      }),
    ]);
  });

  it("records Focused Mastery's combat locks and Haokiru successful effects", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Focused Mastery")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "lock",
          selector: expect.objectContaining({ custom: false }),
        }),
        expect.objectContaining({
          type: "lock",
          selector: expect.objectContaining({ styleProvenance: "effect" }),
        }),
        expect.objectContaining({ type: "modify-resource", resource: "hp" }),
        expect.objectContaining({ type: "modify-resource", resource: "ki" }),
      ]),
    );
  });

  it("records Dragon Dust's nonstacking HP-gain retaliation", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Dragon Dust")?.effects).toEqual([
      expect.objectContaining({
        type: "create-floating-effect",
        floatingEffectId: "dragon-dust-hp-gain-retaliation",
        stacking: "prevent",
        useLimit: { scope: "turn", count: 1, sourceText: "only be used once per turn" },
      }),
    ]);
  });

  it("records Channeling Mastery's HP-for-attack, retaliation, and signature branches", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Channeling Mastery")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-damage",
          activationGroup: "channeling-mastery-attack",
        }),
        expect.objectContaining({ type: "prevent-resolution", prevention: "block" }),
        expect.objectContaining({
          type: "modify-damage",
          percent: { type: "literal", value: -25 },
        }),
        expect.objectContaining({ type: "modify-cost", minimum: { type: "literal", value: 3 } }),
      ]),
    );
  });

  it("records Eternal Mastery's recovery, healing follow-up, and low-HP bonuses", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Eternal Mastery")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-resource",
          useLimit: expect.objectContaining({ scope: "combat", count: 1 }),
        }),
        expect.objectContaining({
          type: "modify-damage",
          scope: { type: "next-action", sourceText: "your next attack" },
        }),
        expect.objectContaining({ type: "modify-roll", amount: { type: "literal", value: 3 } }),
      ]),
    );
  });

  it("records Phoenix Tackle's roll-gated capped next-turn healing multiplier", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Phoenix Tackle")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-resource-modifier",
        multiplier: { type: "literal", value: 2 },
        cap: expect.objectContaining({ type: "maximum" }),
      }),
    ]);
  });

  it("records Five Finger Shot's damage-and-result modification lock", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Five Finger Shot")?.effects).toEqual([
      expect.objectContaining({
        type: "prevent-move-modification",
        aspects: ["damage", "roll-results"],
        duration: expect.objectContaining({ type: "until-combat-result" }),
      }),
    ]);
  });

  it("records Martyrdom's thresholded reactive base-damage retaliation", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Martyrdom")?.effects).toEqual([
      expect.objectContaining({
        type: "create-floating-effect",
        floatingEffectId: "martyrdom-retaliation",
        effects: expect.arrayContaining([
          expect.objectContaining({
            amount: { type: "triggering-move-base-damage", multiplier: 1 },
          }),
          expect.objectContaining({
            amount: { type: "triggering-move-base-damage", multiplier: 0.5 },
          }),
        ]),
      }),
    ]);
  });

  it("records Halting Stance's first-use, ten-turn Ki-loss extra restriction", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Halting Stance")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-remaining-uses",
        amount: { type: "literal", value: 1 },
        conditions: expect.arrayContaining([
          expect.objectContaining({ type: "move-use-count", value: 1 }),
          expect.objectContaining({ type: "resource-change", turns: 10 }),
        ]),
      }),
    ]);
  });

  it("records Display of Endurance's blocked-damage loss, heal, and Ki protection", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Display of Endurance")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-resource",
          amount: { type: "blocked-attack-damage", multiplier: 0.5 },
        }),
        expect.objectContaining({ type: "create-floating-effect" }),
        expect.objectContaining({
          type: "prevent-resource-modification",
          resource: "ki",
          operation: "lose",
        }),
      ]),
    );
  });

  it("records Tornado Uppercut's modifier multiplier, cap, and HP-loss choices", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Tornado Uppercut")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-damage-modifier",
          multiplier: { type: "literal", value: 3 },
        }),
        expect.objectContaining({
          type: "modify-damage",
          cap: expect.objectContaining({ type: "maximum" }),
        }),
        expect.objectContaining({
          type: "modify-resource-cost",
          percent: { type: "literal", value: -100 },
        }),
        expect.objectContaining({
          type: "modify-resource-cost",
          percent: { type: "literal", value: -50 },
        }),
      ]),
    );
  });

  it("records High Threshold's defensive substitution and thresholded refund", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "High Threshold")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "substitute-defense", outcome: "stop" }),
        expect.objectContaining({ type: "deactivate", affectedType: "skill" }),
        expect.objectContaining({
          type: "modify-resource",
          amount: { type: "paid-activation-cost", resource: "ki" },
        }),
      ]),
    );
  });

  it("records Karmic Chameleon Mastery's temporary opponent-technique grants", () => {
    expect(HAOKIRU_MOVES.find((move) => move.name === "Karmic Chameleon Mastery")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "grant-mastery", source: "opponent" }),
        expect.objectContaining({ type: "grant-temporary-move-use", category: "advanced-attack" }),
        expect.objectContaining({ type: "grant-temporary-move-use", category: "skill" }),
        expect.objectContaining({ type: "override-style-reference", styleId: "style-haokiru" }),
      ]),
    );
  });
});
