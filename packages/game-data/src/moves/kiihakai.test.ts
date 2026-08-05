import { describe, expect, it } from "vitest";

import { KIIHAKAI_MOVES } from "./kiihakai.js";

describe("KIIHAKAI_MOVES", () => {
  it("records Redirected Energy's deactivated-skill cost reduction", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Redirected Energy")?.effects).toEqual([
      expect.objectContaining({
        trigger: "on-deactivated",
        type: "modify-cost",
        amount: { type: "triggering-move-ki-cost", addition: -1 },
      }),
    ]);
  });

  it("records Aura Clash's successful and stopped delayed transformations", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Aura Clash")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "force-transformation",
          trigger: "on-success",
          target: "self",
        }),
        expect.objectContaining({
          type: "force-transformation",
          trigger: "on-stopped",
          target: "participants",
        }),
      ]),
    );
  });

  it("records Overdrive Blast's power-up-context Mastery activation", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Overdrive Blast")?.effects).toEqual([
      expect.objectContaining({
        type: "activate",
        asIf: "power-up",
        selector: expect.objectContaining({ ids: ["move-kiihakai-overdrive-mastery"] }),
      }),
    ]);
  });

  it("records Turn Up The Heat's Energy-type classification", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Turn Up The Heat")?.effects).toEqual([
      expect.objectContaining({ type: "modify-move-classification", addTags: ["ENERGY"] }),
    ]);
  });

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
        value: { type: "literal", value: 2 },
      }),
    ]);
  });

  it("records Overdrive and Thunder Ball's conditional roll and damage bonuses", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Overdrive Mastery")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-damage",
        trigger: "on-power-up",
        percent: { type: "stat-percent", subject: "self", stat: "power", percent: 15 },
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
        amount: { type: "next-move-ki-cost", actor: "opponent" },
      }),
    ]);
  });

  it("records Energy Gathering's Ki-gain follow-up", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Energy Gathering")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-resource",
        resource: "ki",
        amount: { type: "literal", value: 1 },
        conditions: [expect.objectContaining({ type: "resource-change", timing: "current-event" })],
      }),
    ]);
  });

  it("records The Rising Sun's combat-long physical-attack retaliation", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "The Rising Sun")?.effects).toEqual([
      expect.objectContaining({
        type: "create-floating-effect",
        floatingEffectId: "the-rising-sun-physical-attack-retaliation",
      }),
    ]);
  });

  it("records Twisting Beam's active-CONSTANT-skill damage scaling", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Twisting Beam")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-damage",
        percent: expect.objectContaining({ type: "active-move-count", perMove: 5 }),
      }),
    ]);
  });

  it("records Triple Torpedo's thresholded constant activation and protection", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Triple Torpedo")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "activate", optional: true }),
        expect.objectContaining({ type: "prevent-move-use", operation: "deactivate" }),
      ]),
    );
  });

  it("records Ki Jammer's nonstacking Power-Up damage penalty", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Ki Jammer")?.effects).toEqual([
      expect.objectContaining({
        type: "create-floating-effect",
        stacking: "prevent",
        duration: expect.objectContaining({ type: "until-combat-result" }),
      }),
    ]);
  });

  it("records Shaolin Focused Beam's two-skill deactivation protection", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Shaolin Focused Beam")?.effects).toEqual([
      expect.objectContaining({
        type: "prevent-move-use",
        operation: "deactivate",
        selectionLimit: 2,
        duration: expect.objectContaining({ type: "until-combat-result" }),
      }),
    ]);
  });

  it("records Focus Breaker's constant-skill sacrifice to stop an attack", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Focus Breaker")?.effects).toEqual([
      expect.objectContaining({
        type: "stop-attack-by-deactivation",
        lockDuration: { type: "combat", sourceText: "for the remainder of combat" },
      }),
    ]);
  });

  it("records Energy Slasher's stopped-physical-attack Power-Up Ki gain", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Energy Slasher")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-resource",
        resource: "ki",
        amount: { type: "literal", value: 2 },
        scope: {
          type: "next-turn",
          subject: "self",
          sourceText: "if you Power Up on your next turn",
        },
      }),
    ]);
  });

  it("records Devastating Blade's next constant-skill deactivation prevention", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Devastating Blade")?.effects).toEqual([
      expect.objectContaining({
        type: "prevent-move-use",
        operation: "deactivate",
        useLimit: { scope: "combat", count: 1, sourceText: "The next time" },
      }),
    ]);
  });

  it("records Power Boost's skipped-turn energy-attack bonuses", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Power Boost")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "skip-action", optional: true }),
        expect.objectContaining({ type: "modify-damage", percent: { type: "literal", value: 20 } }),
        expect.objectContaining({ type: "modify-roll", amount: { type: "literal", value: 5 } }),
        expect.objectContaining({ type: "modify-resource", amount: { type: "literal", value: 3 } }),
      ]),
    );
  });

  it("records Rollback Barrage's per-two-success constant reactivation", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Rollback Barrage")?.effects).toEqual([
      expect.objectContaining({
        type: "activate",
        repeatCount: { type: "successful-hit-count-groups", groupSize: 2 },
        ignoreRequirements: true,
      }),
    ]);
  });

  it("records Big Shot's high-roll constant activation and delayed deactivation", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Big Shot")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "activate", selectionKey: "big-shot-activated-constants" }),
        expect.objectContaining({ type: "delayed-deactivate", turnsAfter: 3 }),
      ]),
    );
  });

  it("records Fierce Focus Master's start activation and deactivation negations", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Fierce Focus Mastery")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-cost", amount: { type: "literal", value: 0 } }),
        expect.objectContaining({ type: "activate", optional: true }),
        expect.objectContaining({
          type: "negate-deactivation",
          useLimit: expect.objectContaining({ count: 2 }),
        }),
        expect.objectContaining({
          type: "negate-deactivation",
          useLimit: expect.objectContaining({ count: 1 }),
        }),
      ]),
    );
  });

  it("records Ki Barbs' exclusive Power-Up damage choices and all-dice stun", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Ki Barbs")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-damage", percent: { type: "literal", value: 15 } }),
        expect.objectContaining({ type: "modify-damage", percent: { type: "literal", value: 25 } }),
        expect.objectContaining({
          type: "grant-combat-outcome",
          outcome: "stun",
          requireAllDiceSuccess: true,
        }),
      ]),
    );
  });

  it("records Evening The Field's typed constant-skill exchange", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Evening The Field")?.effects).toEqual([
      expect.objectContaining({
        type: "exchange-constant-skill",
        optionalNoTurnCost: { resource: "ki", amount: 1 },
        cooldown: 4,
      }),
    ]);
  });

  it("records Synergy's no-turn trigger, damage-modification bonus, and End-phase activation", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Synergy")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "grant-extra-action", phase: "action-phase" }),
        expect.objectContaining({ type: "modify-roll", amount: { type: "literal", value: 2 } }),
        expect.objectContaining({
          type: "activate",
          scope: expect.objectContaining({ phase: "end" }),
        }),
      ]),
    );
  });

  it("records Diving Elbow's recent reactivation and protected constant activation", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Diving Elbow")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "reactivate-recent-skill",
          deactivatedTiming: "last-turn",
        }),
        expect.objectContaining({
          type: "activate-protected-constant",
          protectionDuration: expect.objectContaining({ turns: 4 }),
        }),
      ]),
    );
  });

  it("records Downward Spiral's skill-activation immunity and effect replacement", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Downward Spiral")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "override-skill-activation-prevention" }),
        expect.objectContaining({ type: "replace-active-constant-effects", optional: true }),
      ]),
    );
  });

  it("records Destruction Mastery's selected-move protections and interference effects", () => {
    expect(KIIHAKAI_MOVES.find((move) => move.name === "Destruction Mastery")?.effects).toEqual([
      expect.objectContaining({
        type: "grant-destruction-mastery",
        naturalDefenseStopPreventionAtMost: 12,
        zeroCostSignatureUses: 1,
        targetsInterferers: true,
        damageBonusAfterOpponentInterferencePercent: 5,
      }),
    ]);
  });
});
