import { describe, expect, it } from "vitest";

import { AFTERLIFE_MOVES } from "./afterlife.js";

describe("AFTERLIFE_MOVES", () => {
  it("records Time Freeze's successful two-turn stun and matching energy-attack lock", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Time Freeze")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "apply-status", statusId: "stun" }),
        expect.objectContaining({
          type: "lock",
          affectedType: "attack",
          duration: expect.objectContaining({ turns: { type: "literal", value: 2 } }),
        }),
      ]),
    );
  });
  it("records Kaio-ken Attack's low-defense stop prevention and styled bonus", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Kaio-ken Attack")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "prevent-low-roll-stop",
          value: { type: "literal", value: 7 },
        }),
        expect.objectContaining({
          type: "modify-damage",
          selector: expect.objectContaining({ styleIdExcludes: "style-freestyle" }),
        }),
      ]),
    );
  });

  it("records Supernova's paid d35 branch and Mastered Transformation bonus", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Supernova")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-cost", activationGroup: "supernova-paid-d35" }),
        expect.objectContaining({
          type: "set-roll-definition",
          dice: 1,
          sides: 35,
          activationGroup: "supernova-paid-d35",
        }),
        expect.objectContaining({
          type: "modify-roll",
          conditions: [expect.objectContaining({ type: "transformation-mastery" })],
        }),
      ]),
    );
  });

  it("records Burst Rush's Dexterity-based 13-die definitions", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Burst Rush")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "set-roll-definition", dice: 13, sides: 32 }),
        expect.objectContaining({ type: "set-roll-definition", dice: 13, sides: 33 }),
        expect.objectContaining({ type: "set-roll-definition", dice: 13, sides: 34 }),
        expect.objectContaining({ type: "set-roll-definition", dice: 13, sides: 35 }),
      ]),
    );
  });

  it("records Masenko's no-prior-attack roll penalty", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Masenko")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-roll",
        amount: { type: "literal", value: -5 },
        conditions: [expect.objectContaining({ type: "no-prior-action" })],
      }),
    ]);
  });

  it("records Kaio-ken's attack, Dexterity, comparison, and cost effects", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Kaio-ken")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-damage",
          scope: expect.objectContaining({ type: "next-actions" }),
        }),
        expect.objectContaining({ type: "modify-stat", stat: "dexterity-bonus" }),
        expect.objectContaining({ type: "set-stat-comparison", stat: "dexterity" }),
        expect.objectContaining({ type: "prevent-move-modification", aspects: ["cost"] }),
      ]),
    );
  });

  it("records X20 Kaioken Kamehameha's active-Kaio-ken, beam-response, and success branches", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "x20 Kaioken Kamehameha")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-damage",
          percent: { type: "literal", value: 25 },
          conditions: [expect.objectContaining({ type: "move-effect-active" })],
        }),
        expect.objectContaining({
          type: "grant-counter-action",
          action: "use-source-attack",
          activationGroup: "x20-kaioken-kamehameha-beam-response",
        }),
        expect.objectContaining({
          type: "set-roll-result",
          roll: "defense",
          value: { type: "literal", value: 0 },
        }),
        expect.objectContaining({
          type: "modify-resource",
          resource: "hp",
          conditions: [expect.objectContaining({ type: "incoming-damage" }), expect.anything()],
        }),
        expect.objectContaining({
          type: "modify-remaining-uses",
          amount: { type: "literal", value: 2 },
        }),
        expect.objectContaining({
          type: "prevent-move-modification",
          exceptSourceMoveIds: ["move-afterlife-x20-kaioken-kamehameha"],
        }),
      ]),
    );
  });

  it("records Spirit Ball's low-die replacement and fifth-die damage bonus", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Spirit Ball")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "set-roll-result", value: { type: "literal", value: 10 } }),
        expect.objectContaining({
          type: "modify-damage",
          conditions: [expect.objectContaining({ type: "roll-die-result", index: 5 })],
        }),
      ]),
    );
  });

  it("records Energy Blade's Sword Weapon requirements", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Energy Blade")?.effects).toEqual([
      expect.objectContaining({ type: "grant-equipment", equipment: "sword" }),
      expect.objectContaining({
        type: "modify-move-requirements",
        addRequirements: ["Sword Weapon"],
        selector: expect.objectContaining({ requirementExcludes: ["sword"] }),
      }),
    ]);
  });

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
        expect.objectContaining({
          type: "prevent-move-modification",
          target: "self",
          actor: "opponent",
          aspects: ["damage"],
          operations: ["reduce"],
          exceptSourceStatusIds: ["break", "sever"],
          selector: expect.objectContaining({
            subject: "source",
            categories: ["advanced-attack", "signature"],
          }),
        }),
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
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Death Beam")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "prevent-resolution", prevention: "block" }),
        expect.objectContaining({ type: "modify-cost", amount: { type: "literal", value: 1 } }),
      ]),
    );
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
        percent: { type: "stat-percent", subject: "self", stat: "power", percent: 15 },
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
        amount: {
          type: "resource-percent",
          subject: "self",
          resource: "hp",
          basis: "total",
          percent: 10,
        },
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
        percent: {
          type: "move-activation-count",
          moveId: "move-afterlife-give-me-energy",
          perActivation: 25,
        },
      }),
    ]);
  });

  it("records Burning Slash's same-turn follow-up and sixth-die bonus", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Burning Slash")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "grant-extra-action", move: "source" }),
        expect.objectContaining({
          type: "modify-damage",
          conditions: [expect.objectContaining({ type: "roll-die-result", index: 6 })],
        }),
      ]),
    );
  });

  it("records Expanding Energy Blast's mutually exclusive Skill deactivation protections", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Expanding Energy Blast")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "prevent-move-use",
          duration: expect.objectContaining({ turns: { type: "literal", value: 4 } }),
        }),
        expect.objectContaining({
          type: "prevent-move-use",
          duration: expect.objectContaining({ turns: { type: "literal", value: 10 } }),
        }),
      ]),
    );
  });

  it("records Evil Flame's lower-threshold power-up lock", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Evil Flame")?.effects).toEqual([
      expect.objectContaining({
        type: "lock",
        affectedType: "power-up",
        duration: expect.objectContaining({ type: "until-roll-threshold" }),
      }),
    ]);
  });

  it("records Blade Rush's stopped-Hellfire follow-up and eighth-die damage", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Blade Rush")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "grant-extra-action", move: "source" }),
        expect.objectContaining({
          type: "modify-damage",
          conditions: [expect.objectContaining({ type: "roll-die-result", index: 8 })],
        }),
      ]),
    );
  });

  it("records Vanishing Ball's battle-only defeat branch and result caps", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Vanishing Ball")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-roll",
          roll: "attack",
          cap: expect.objectContaining({ value: { type: "literal", value: 35 } }),
        }),
        expect.objectContaining({
          type: "modify-resource",
          operation: "set",
          amount: { type: "literal", value: 0 },
          conditions: expect.arrayContaining([expect.objectContaining({ type: "combat-context" })]),
        }),
        expect.objectContaining({ type: "prevent-resource-modification", operation: "gain" }),
      ]),
    );
  });

  it("records Special Fighting Pose 3's next-energy grant, Ki gain, and free-use condition", () => {
    expect(
      AFTERLIFE_MOVES.find((move) => move.name === "Special Fighting Pose 3")?.effects,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "create-floating-effect",
          floatingEffectId: "special-fighting-pose-3-constant-skill-activation",
        }),
        expect.objectContaining({
          type: "modify-resource",
          resource: "ki",
          amount: { type: "literal", value: 2 },
        }),
        expect.objectContaining({
          type: "grant-extra-action",
          conditions: [expect.objectContaining({ type: "active-move-count" })],
        }),
      ]),
    );
  });

  it("records Wolf Fang Fist's mutually exclusive active-CONSTANT bonuses", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Wolf Fang Fist")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-roll",
          amount: { type: "literal", value: 5 },
          conditions: [
            expect.objectContaining({
              type: "active-move-count",
              value: expect.objectContaining({ value: 0 }),
            }),
          ],
        }),
        expect.objectContaining({
          type: "modify-roll",
          amount: { type: "literal", value: 2 },
          conditions: [
            expect.objectContaining({
              type: "active-move-count",
              value: expect.objectContaining({ value: 1 }),
            }),
          ],
        }),
      ]),
    );
  });

  it("records Four Arms' nonstacking low-defense doubling and self-effect exemption", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Four Arms")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "set-roll-result",
          roll: "defense",
          stacking: "prevent",
          scope: expect.objectContaining({ type: "next-roll" }),
        }),
        expect.objectContaining({
          type: "prevent-roll-modification",
          roll: "defense",
          exemptSourceEffect: true,
        }),
      ]),
    );
  });

  it("records Multi-Form's selected dice-for-sides exchange and power-up discount", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Multi-Form")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-roll", modifier: "dice" }),
        expect.objectContaining({
          type: "modify-roll",
          modifier: "sides",
          cap: expect.objectContaining({ type: "allow-exceed" }),
        }),
        expect.objectContaining({
          type: "modify-cost",
          amount: { type: "literal", value: -1 },
          conditions: [expect.objectContaining({ type: "prior-action", action: "power-up" })],
        }),
      ]),
    );
  });

  it("records Hellzone Grenade's seven-hit next-cost-modifier doubling", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Hellzone Grenade")?.effects).toEqual([
      expect.objectContaining({
        type: "modify-cost-modifier",
        multiplier: { type: "literal", value: 2 },
        scope: expect.objectContaining({ type: "next-cost-modification" }),
        conditions: [expect.objectContaining({ type: "successful-hit-count" })],
      }),
    ]);
  });

  it("records Mass Genocide Attack's chained die bonuses and interferer defense", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Mass Genocide Attack")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-roll", dieIndex: 2 }),
        expect.objectContaining({ type: "modify-roll", dieIndex: 5 }),
        expect.objectContaining({
          type: "grant-defense-response",
          target: "interferers",
          againstAttackDieIndex: 1,
        }),
      ]),
    );
  });

  it("records Instant Transmission's weekly interplanetary travel rule and emergency exception", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Instant Transmission")?.effects).toEqual([
      expect.objectContaining({
        type: "travel",
        destination: "another-planet",
        frequency: expect.objectContaining({
          maximumUses: 1,
          period: "week",
          prohibitConsecutivePeriods: true,
        }),
        exception: expect.objectContaining({ condition: "current-planet-destroyed" }),
      }),
    ]);
  });

  it("records Body Change's player-scoped combatant-state swap and reversion", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Body Change")?.effects).toEqual([
      expect.objectContaining({
        type: "swap-combatant-state",
        fields: ["moveset", "items", "hp", "ki"],
        revertWhen: "either-player-dies-or-escapes",
        defeatBasis: "player",
      }),
    ]);
  });

  it("records Guldo Special's prior-turn restriction outcomes", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Guldo Special")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "grant-combat-outcome",
          outcome: "break",
          conditions: expect.arrayContaining([
            expect.objectContaining({ type: "prior-turn-restriction" }),
          ]),
        }),
        expect.objectContaining({ type: "grant-combat-outcome", outcome: "sever" }),
      ]),
    );
  });

  it("records Teamwork Kamehameha's mutually exclusive participant options", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Teamwork Kamehameha")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "join-attack",
          participants: expect.objectContaining({ eligibility: "ally-in-combat", maximum: 1 }),
        }),
        expect.objectContaining({
          type: "join-attack",
          participants: expect.objectContaining({
            eligibility: "same-planet-move-owner",
            maximum: 2,
            duration: "one-turn",
          }),
        }),
      ]),
    );
  });

  it("records Death Ball's deferred completion and Dragon Ball location bonus", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Death Ball")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "defer-move",
          performAfterTurns: 1,
          damage: { operation: "set", percent: { type: "literal", value: 170 } },
        }),
        expect.objectContaining({
          type: "modify-roll",
          modifier: "sides",
          conditions: [expect.objectContaining({ type: "location" })],
        }),
      ]),
    );
  });

  it("records Galick Gun's sacrificed Beam response and physical defense penalty", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Galick Gun")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "remove-move-from-combat" }),
        expect.objectContaining({ type: "negate", aspects: ["prevent-damage"] }),
        expect.objectContaining({ type: "lock", affectedType: "attack" }),
        expect.objectContaining({ type: "modify-roll", roll: "defense", modifier: "result" }),
      ]),
    );
  });

  it("records Warp Kamehameha's deferral, forced response, defense die, and failure lock", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Warp Kamehameha")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "defer-move",
          performAfterTurns: 1,
          onCancellation: expect.objectContaining({ type: "lock" }),
        }),
        expect.objectContaining({ type: "force-action", allowPass: true }),
        expect.objectContaining({ type: "set-roll-definition", roll: "defense", sides: 50 }),
      ]),
    );
  });

  it("records Solar Flare's threshold stun, single-die follow-ups, and combat lock", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Solar Flare")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "roll-and-store", storageKey: "solar-flare-roll" }),
        expect.objectContaining({ type: "apply-status", statusId: "stun" }),
        expect.objectContaining({
          type: "create-floating-effect",
          floatingEffectId: "solar-flare-same-turn-single-die-follow-up",
        }),
        expect.objectContaining({
          type: "create-floating-effect",
          floatingEffectId: "solar-flare-next-turn-single-die-follow-up",
        }),
        expect.objectContaining({ type: "lock", affectedType: "skill" }),
      ]),
    );
  });

  it("records Petrifying Spit's threshold petrification, delayed release rolls, and free-use exception", () => {
    expect(AFTERLIFE_MOVES.find((move) => move.name === "Petrifying Spit")?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "roll-and-store", storageKey: "petrifying-spit-roll" }),
        expect.objectContaining({ type: "apply-status", statusId: "petrified" }),
        expect.objectContaining({
          type: "skip-action",
          scope: expect.objectContaining({ type: "next-turn" }),
        }),
        expect.objectContaining({
          type: "grant-extra-action",
          conditions: [expect.objectContaining({ type: "moveset" })],
        }),
      ]),
    );
  });
});
