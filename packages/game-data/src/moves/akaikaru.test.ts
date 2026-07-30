import { describe, expect, it } from "vitest";

import { AKAIKARU_MOVES } from "./akaikaru.js";

describe("AKAIKARU_MOVES", () => {
  it("records Fury Strikes' next KI-gain reduction", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "Fury Strikes")?.effects).toEqual([
      expect.objectContaining({
        trigger: "on-success",
        type: "modify-resource",
        amount: { type: "literal", value: -1 },
        scope: expect.objectContaining({ type: "next-resource-gain", resource: "ki" }),
      }),
    ]);
  });

  it("records Intensity Mastery's selected style conversion and reactive next attack", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "Intensity Mastery")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-move-classification",
          setStyleId: "style-akaikaru",
        }),
        expect.objectContaining({ type: "prevent-resolution", prevention: "block" }),
        expect.objectContaining({ type: "apply-status", statusId: "stun" }),
      ]),
    );
  });

  it("records Spinebreaker's cost protection, paid Stun, and alternate Transformation penalty", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "Spinebreaker")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "prevent-move-modification", aspects: ["cost"] }),
        expect.objectContaining({ type: "apply-status", statusId: "stun" }),
        expect.objectContaining({
          type: "modify-roll",
          roll: "transformation",
          amount: { type: "literal", value: -3 },
        }),
      ]),
    );
  });

  it("records Naginata's paid d35 and Dexterity Bonus doubling", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "Naginata")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "set-roll-definition", dice: 1, sides: 35 }),
        expect.objectContaining({
          type: "modify-stat",
          operation: "multiply",
          scope: expect.objectContaining({ type: "next-action" }),
        }),
        expect.objectContaining({
          type: "modify-stat",
          scope: expect.objectContaining({ type: "next-roll", roll: "defense" }),
        }),
      ]),
    );
  });

  it("records Dazzling Gymnastics' multi-die stop and Dexterity Bonus", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "Dazzling Gymnastics")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "set-combat-result", result: "stopped" }),
        expect.objectContaining({
          type: "modify-stat",
          stat: "dexterity-bonus",
          amount: { type: "literal", value: 1 },
        }),
      ]),
    );
  });

  it("records Blitzkrieg's Energy type and mutually exclusive Dexterity branches", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "Blitzkrieg")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-move-classification", addTags: ["ENERGY"] }),
        expect.objectContaining({
          type: "modify-stat",
          amount: { type: "literal", value: 2 },
          duration: expect.objectContaining({ type: "turns" }),
        }),
        expect.objectContaining({ type: "modify-stat", amount: { type: "literal", value: 3 } }),
      ]),
    );
  });

  it("records No Shadow Kick's Punch-type classification", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "No Shadow Kick")?.effects).toEqual([
      expect.objectContaining({ type: "modify-move-classification", addTags: ["PUNCH"] }),
    ]);
  });

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

  it("records Anger Management's carried single-die STUN clause", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "Anger Management")?.effects).toEqual([
      expect.objectContaining({
        type: "create-floating-effect",
        floatingEffectId: "anger-management-next-single-die-stun",
        termination: [expect.objectContaining({ trigger: "on-success" })],
      }),
    ]);
  });

  it("records Backflip Kick's next-Dexterity anti-BLOCK and STUN effect", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "Backflip Kick")?.effects).toEqual([
      expect.objectContaining({
        type: "create-floating-effect",
        floatingEffectId: "backflip-kick-next-dexterity-stun",
        conditions: [expect.objectContaining({ type: "roll-comparison" })],
      }),
    ]);
  });

  it("records Accelerated Shoulder Tackle's physical-moveset bonus branches", () => {
    expect(
      AKAIKARU_MOVES.find((move) => move.name === "Accelerated Shoulder Tackle")?.effects,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amount: { type: "literal", value: 3 } }),
        expect.objectContaining({
          amount: { type: "literal", value: 4 },
          conditions: [expect.objectContaining({ type: "moveset-move-count" })],
        }),
      ]),
    );
  });

  it("records Delta Storm's last-die SEVER threshold", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "Delta Storm")?.effects).toEqual([
      expect.objectContaining({
        type: "grant-combat-outcome",
        outcome: "sever",
        conditions: [expect.objectContaining({ type: "roll-die-threshold", index: 3 })],
      }),
    ]);
  });

  it("records Ticking Time Bomb's post-turn-ten capped damage scaling", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "Ticking Time Bomb")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-damage",
        percent: { type: "turns-after-turn", turn: 10, perTurn: 15, maximum: 75 },
      }),
    ]);
  });

  it("records Relentless's escape lock, participant-scaled cost, and paid deactivation", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "Relentless")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "lock", affectedType: "escape", target: "participants" }),
        expect.objectContaining({
          type: "modify-cost",
          amount: { type: "participant-count", excludeSelf: true, perParticipant: 1, maximum: 9 },
        }),
        expect.objectContaining({
          type: "deactivate",
          optional: true,
          activationCost: expect.objectContaining({ amount: { type: "literal", value: 1 } }),
        }),
      ]),
    );
  });

  it("records Impulsive's reindexed random Advanced Attack selection and forced use", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "Impulsive")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "roll-and-store",
          sides: { type: "moveset-move-count", subject: "self", category: "advanced-attack" },
        }),
        expect.objectContaining({
          type: "select-move-by-stored-roll",
          ordering: "character-sheet-top-to-bottom",
          reindex: "on-moveset-change",
        }),
        expect.objectContaining({
          type: "force-action",
          selectedMoveStorageKey: "impulsive-selected-advanced-attack",
          allowPass: true,
        }),
        expect.objectContaining({
          type: "modify-cost",
          minimum: { type: "literal", value: 1 },
        }),
      ]),
    );
  });

  it("records Rage Mastery's optional doubled-die and multi-die branches", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "Rage Mastery")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-roll",
          modifier: "dice",
          optional: true,
          activationGroup: "rage-mastery-single-die-doubling",
        }),
        expect.objectContaining({
          type: "require-all-dice-success",
          appliesTo: "successful-effects",
        }),
        expect.objectContaining({
          type: "modify-cost",
          amount: { type: "literal", value: 2 },
          target: "opponent",
        }),
      ]),
    );
  });

  it("records Shock Fist's energy classification and stacked defense penalty", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "Shock Fist")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-move-classification", addTags: ["ENERGY"] }),
        expect.objectContaining({
          type: "modify-roll",
          roll: "defense",
          amount: { type: "literal", value: -3 },
          cap: expect.objectContaining({ type: "minimum", value: { type: "literal", value: -6 } }),
        }),
      ]),
    );
  });

  it("records Gone In A Sixtieth of A Second's all-dice Block and carried STUN", () => {
    expect(
      AKAIKARU_MOVES.find((move) => move.name === "Gone In A Sixtieth of A Second")?.effects,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "block-all-dice" }),
        expect.objectContaining({
          type: "create-floating-effect",
          floatingEffectId: "gone-in-a-sixtieth-next-base-cost-one-stun",
        }),
      ]),
    );
  });

  it("records Letting Off Steam's stopped-roll scaling and nonstacking escape penalty", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "Letting Off Steam")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-damage",
          percent: expect.objectContaining({ type: "consecutive-combat-results", maximum: 40 }),
        }),
        expect.objectContaining({
          type: "modify-roll",
          roll: "escape",
          stacking: "prevent",
        }),
      ]),
    );
  });

  it("records Chained Master's escalating attack chain and alternating follow-ups", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "Chained Mastery")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-damage",
          percent: expect.objectContaining({
            type: "consecutive-combat-results",
            result: "successful",
          }),
        }),
        expect.objectContaining({
          type: "create-floating-effect",
          floatingEffectId: "chained-mastery-next-turn-kick-follow-up",
        }),
        expect.objectContaining({
          type: "create-floating-effect",
          floatingEffectId: "chained-mastery-next-turn-punch-follow-up",
        }),
      ]),
    );
  });

  it("records Shotgun Blast's modified-roll KI reward and three-hit defense lock", () => {
    expect(AKAIKARU_MOVES.find((move) => move.name === "Shotgun Blast")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-resource",
          resource: "ki",
          conditions: [expect.objectContaining({ type: "roll-modification" })],
        }),
        expect.objectContaining({
          type: "prevent-roll-modification",
          conditions: [
            expect.objectContaining({
              type: "successful-hit-count",
              value: { type: "literal", value: 3 },
            }),
          ],
        }),
      ]),
    );
  });
});
