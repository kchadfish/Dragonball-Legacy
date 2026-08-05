import type { EffectDefinition } from "../shared/effects.js";
import type { MoveDefinition } from "../shared/types.js";
import { createMovesForSource } from "./create-style-moves.js";

const TEAMWORK_KAMEHAMEHA_SOURCE =
  "RESTRICTEDx1. Energy attack. Deal (70% Power) damage per hit. You may have an ally in combat perform this attack with you on your turn. Each attacker rolls an attack roll and pays the cost of this attack. Alternatively, you may have up to two players on the same planet as you who also possess this attack join in combat for one turn and perform this attack with you. Attack roll: 1d40 for each attacker. Cost: 3 KI.";
const GALICK_GUN_RESPONSE_SOURCE =
  "You may forget this move and pay its cost after your opponent rolls their attack roll on a Beam-type attack that is not a Signature Technique to NEGATE the damage from that attack. If you do, LOCK that attack for your opponent's next 4 turns.";
const WARP_KAMEHAMEHA_SOURCE =
  "RESTRICTEDx1. You skip your turn when you activate this attack. Warp Kamehameha is performed on your next turn. Energy attack. Deal (100% Power) damage. Your opponent must attack on their next turn or pass. Defense roll: 1d50 for that turn. Attack roll: 1d40. If their attack against you is SUCCESSFUL, Instant Transmission fails; LOCK Warp Kamehameha for the remainder of combat. Cost: 5 KI.";
const PETRIFYING_SPIT_SOURCE =
  "RESTRICTEDx1. You roll 1d30. If the result of your dice roll is 15 or higher, your opponent is turned to stone and must skip their next turn. At the start of their turn after that, your opponent must roll 1d30. If the result of their dice roll is below 15, they must pass. They must pass on their turns until their dice roll is 15 or higher. If you do not have Time Freeze in your moveset, this Skill does not take up your turn. Cost: 2 KI.";
const X20_KAIOKEN_KAMEHAMEHA_SOURCE =
  "RESTRICTEDx1. Energy attack. Deal (90% Power) damage. If Kaio-Ken's effect is active, this attack does +(25% Power) Damage and costs -2 KI. You may use this attack when your opponent performs a Beam-type energy attack instead of rolling a defensive roll (your defensive roll counts as 0 for all effects and purposes). If you do, that attack does -(75% Power) Damage. If you would take no damage from that attack, your opponent loses (30% Power) HP. SUCCESSFUL - Kaio-Ken gains RESTRICTED+2 and costs -2 KI for the remainder of combat. This is the only effect that can affect Kaio-Ken's cost. Cost: 6 KI.";

const structuredEffectsByMoveId = new Map<string, readonly EffectDefinition[]>([
  [
    "move-afterlife-time-freeze",
    [
      {
        trigger: "action-phase",
        target: "participants",
        type: "apply-status",
        statusId: "stun",
        duration: {
          type: "turns",
          turns: { type: "literal", value: 2 },
          sourceText: "for their next 2 turns",
        },
        useLimit: { scope: "combat", count: 1, sourceText: "RESTRICTEDx1" },
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 20 },
            sourceText: "If the result is 20 or higher",
          },
        ],
        sourceText:
          "If the result is 20 or higher, Time Freeze is successful. STUN all opponents and allies for their next 2 turns",
      },
      {
        trigger: "action-phase",
        target: "self",
        type: "lock",
        affectedType: "attack",
        selector: {
          type: "move-selector",
          subject: "source",
          category: "advanced-attack",
          tags: ["energy"],
          sourceText: "energy attacks",
        },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 2 },
          sourceText: "for their next 2 turns",
        },
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 20 },
            sourceText: "If the result is 20 or higher",
          },
        ],
        sourceText:
          "RESTRICTEDx1. The user rolls 1d30. If the result is 20 or higher, Time Freeze is successful. STUN all opponents and allies for their next 2 turns. You cannot perform energy attacks while using Time Freeze. Cost: 1 KI.",
      },
    ],
  ],
  [
    "move-afterlife-kaio-ken-attack",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "prevent-low-roll-stop",
        roll: "defense",
        comparison: "at-most",
        value: { type: "literal", value: 7 },
        scope: { type: "next-action", sourceText: "your next attack" },
        conditions: [
          {
            type: "stat-comparison",
            left: "self",
            stat: "dexterity",
            comparison: "higher-than",
            right: "opponent",
            sourceText: "If your Dexterity is higher than your opponent's Dexterity",
          },
        ],
        sourceText:
          "SUCCESSFUL - If your Dexterity is higher than your opponent's Dexterity, your next attack cannot be STOPPED by dice rolls of 7 or less",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "literal", value: 10 },
        scope: { type: "next-action", sourceText: "Your next Styled Advanced Attack" },
        selector: {
          type: "move-selector",
          subject: "source",
          category: "advanced-attack",
          styleIdExcludes: "style-freestyle",
          sourceText: "Your next Styled Advanced Attack",
        },
        sourceText: "SUCCESSFUL - Your next Styled Advanced Attack does +(10% Power) Damage",
      },
    ],
  ],
  [
    "move-afterlife-supernova",
    [
      {
        trigger: "before-attack-roll",
        target: "self",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: 2 },
        scope: { type: "current-action", sourceText: "pay +2 KI" },
        activationGroup: "supernova-paid-d35",
        sourceText: "You may pay +2 KI to have your attack roll be 1d35 for this attack",
      },
      {
        trigger: "before-attack-roll",
        target: "self",
        type: "set-roll-definition",
        roll: "attack",
        dice: 1,
        sides: 35,
        activationGroup: "supernova-paid-d35",
        sourceText: "You may pay +2 KI to have your attack roll be 1d35 for this attack",
      },
      {
        trigger: "passive",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: 2 },
        scope: { type: "current-action", sourceText: "this attack" },
        conditions: [
          {
            type: "transformation-mastery",
            mastery: "mastered",
            sourceText: "If you have MASTERED the current Transformation you are in (if any)",
          },
        ],
        sourceText:
          "If you have MASTERED the current Transformation you are in (if any), this attack gains +2 to the result",
      },
    ],
  ],
  [
    "move-afterlife-burst-rush",
    [
      {
        trigger: "passive",
        target: "self",
        type: "set-roll-definition",
        roll: "attack",
        dice: 13,
        sides: 32,
        conditions: [
          {
            type: "stat-comparison",
            left: "self",
            stat: "dexterity",
            comparison: "higher-than",
            right: "opponent",
            sourceText: "If your Dexterity is higher than your opponent's",
          },
        ],
        sourceText:
          "If your Dexterity is higher than your opponent's, your dice roll for this attack is 13d32",
      },
      {
        trigger: "passive",
        target: "self",
        type: "set-roll-definition",
        roll: "attack",
        dice: 13,
        sides: 33,
        conditions: [
          {
            type: "stat-comparison",
            left: "self",
            stat: "dexterity-bonus",
            comparison: "higher-than",
            right: "opponent",
            sourceText: "If your Dexterity Bonus is higher than your opponent's",
          },
        ],
        sourceText:
          "If your Dexterity Bonus is higher than your opponent's, your dice roll for this attack is 13d33",
      },
      {
        trigger: "passive",
        target: "self",
        type: "set-roll-definition",
        roll: "attack",
        dice: 13,
        sides: 34,
        conditions: [
          {
            type: "stat-comparison",
            left: "self",
            stat: "dexterity-bonus",
            comparison: "higher-than",
            right: "opponent",
            difference: { type: "literal", value: 2 },
            sourceText: "If your Dexterity Bonus is 2 higher than your opponent's",
          },
        ],
        sourceText:
          "If your Dexterity Bonus is 2 higher than your opponent's, your dice roll for this attack is 13d34",
      },
      {
        trigger: "passive",
        target: "self",
        type: "set-roll-definition",
        roll: "attack",
        dice: 13,
        sides: 35,
        conditions: [
          {
            type: "stat-comparison",
            left: "self",
            stat: "dexterity-bonus",
            comparison: "higher-than",
            right: "opponent",
            difference: { type: "literal", value: 3 },
            sourceText: "If your Dexterity Bonus is 3 higher than your opponent's",
          },
        ],
        sourceText:
          "If your Dexterity Bonus is 3 higher than your opponent's, your dice roll for this attack is 13d35",
      },
    ],
  ],
  [
    "move-afterlife-masenko",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: -5 },
        scope: { type: "next-action", sourceText: "your opponent's next attack roll" },
        conditions: [
          {
            type: "no-prior-action",
            actor: "opponent",
            selector: {
              type: "move-selector",
              subject: "target",
              sourceText: "attacked",
            },
            sourceText: "If you weren't attacked on the last turn",
          },
        ],
        sourceText:
          "SUCCESSFUL - If you weren't attacked on the last turn, your opponent's next attack roll gains -5 to the result",
      },
    ],
  ],
  [
    "move-afterlife-kaio-ken",
    [
      {
        trigger: "upkeep-phase",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "literal", value: 10 },
        scope: {
          type: "next-actions",
          count: { type: "literal", value: 3 },
          sourceText: "next 3 attacks",
        },
        sourceText: "Your next 3 attacks do +(10% Power) Damage",
      },
      {
        trigger: "upkeep-phase",
        target: "self",
        type: "modify-stat",
        stat: "dexterity-bonus",
        operation: "add",
        amount: { type: "literal", value: 2 },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 6 },
          sourceText: "for the next 6 turns",
        },
        sourceText: "Your Dexterity bonus gains +2 for the next 6 turns",
      },
      {
        trigger: "upkeep-phase",
        target: "self",
        type: "set-stat-comparison",
        left: "self",
        stat: "dexterity",
        comparison: "higher-than",
        right: "opponent",
        duration: {
          type: "turns",
          turns: { type: "literal", value: 6 },
          sourceText: "for the next 6 turns",
        },
        sourceText: "Your Dexterity is considered higher than your opponent's for the next 6 turns",
      },
      {
        trigger: "upkeep-phase",
        target: "self",
        type: "prevent-move-modification",
        selector: {
          type: "move-selector",
          subject: "source",
          ids: ["move-afterlife-kaio-ken"],
          sourceText: "The cost of this Skill",
        },
        aspects: ["cost"],
        actor: "any",
        sourceText: "The cost of this Skill cannot be modified",
      },
    ],
  ],
  [
    "move-afterlife-x20-kaioken-kamehameha",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "literal", value: 25 },
        scope: { type: "current-action", sourceText: "this attack" },
        conditions: [
          {
            type: "move-effect-active",
            subject: "self",
            selector: {
              type: "move-selector",
              subject: "source",
              ids: ["move-afterlife-kaio-ken"],
              sourceText: "Kaio-Ken's effect",
            },
            sourceText: "If Kaio-Ken's effect is active",
          },
        ],
        sourceText: X20_KAIOKEN_KAMEHAMEHA_SOURCE,
      },
      {
        trigger: "passive",
        target: "self",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: -2 },
        scope: { type: "current-action", sourceText: "this attack" },
        conditions: [
          {
            type: "move-effect-active",
            subject: "self",
            selector: {
              type: "move-selector",
              subject: "source",
              ids: ["move-afterlife-kaio-ken"],
              sourceText: "Kaio-Ken's effect",
            },
            sourceText: "If Kaio-Ken's effect is active",
          },
        ],
        sourceText: X20_KAIOKEN_KAMEHAMEHA_SOURCE,
      },
      {
        trigger: "before-defense-roll",
        target: "self",
        type: "grant-counter-action",
        stopsTriggeringAttack: false,
        action: "use-source-attack",
        activationGroup: "x20-kaioken-kamehameha-beam-response",
        conditions: [
          {
            type: "move-selector",
            subject: "target",
            tags: ["beam", "energy"],
            sourceText: "a Beam-type energy attack",
          },
        ],
        sourceText: X20_KAIOKEN_KAMEHAMEHA_SOURCE,
      },
      {
        trigger: "before-defense-roll",
        target: "self",
        type: "set-roll-result",
        roll: "defense",
        value: { type: "literal", value: 0 },
        resultScope: "matching-die",
        scope: { type: "current-action", sourceText: "your defensive roll" },
        activationGroup: "x20-kaioken-kamehameha-beam-response",
        conditions: [
          {
            type: "move-selector",
            subject: "target",
            tags: ["beam", "energy"],
            sourceText: "a Beam-type energy attack",
          },
        ],
        sourceText: X20_KAIOKEN_KAMEHAMEHA_SOURCE,
      },
      {
        trigger: "before-defense-roll",
        target: "opponent",
        type: "modify-damage",
        operation: "add",
        percent: { type: "literal", value: -75 },
        selector: {
          type: "move-selector",
          subject: "target",
          tags: ["beam", "energy"],
          sourceText: "that attack",
        },
        scope: { type: "current-action", sourceText: "that attack" },
        activationGroup: "x20-kaioken-kamehameha-beam-response",
        conditions: [
          {
            type: "move-selector",
            subject: "target",
            tags: ["beam", "energy"],
            sourceText: "a Beam-type energy attack",
          },
        ],
        sourceText: X20_KAIOKEN_KAMEHAMEHA_SOURCE,
      },
      {
        trigger: "on-damage",
        target: "opponent",
        type: "modify-resource",
        resource: "hp",
        operation: "lose",
        amount: { type: "stat-percent", subject: "self", stat: "power", percent: 30 },
        activationGroup: "x20-kaioken-kamehameha-beam-response",
        conditions: [
          {
            type: "incoming-damage",
            subject: "self",
            comparison: "exactly",
            value: { type: "literal", value: 0 },
            sourceText: "If you would take no damage from that attack",
          },
          {
            type: "move-selector",
            subject: "target",
            tags: ["beam", "energy"],
            sourceText: "that attack",
          },
        ],
        sourceText: X20_KAIOKEN_KAMEHAMEHA_SOURCE,
      },
      {
        trigger: "on-success",
        target: "self",
        type: "modify-remaining-uses",
        amount: { type: "literal", value: 2 },
        selector: {
          type: "move-selector",
          subject: "source",
          ids: ["move-afterlife-kaio-ken"],
          sourceText: "Kaio-Ken gains RESTRICTED+2",
        },
        sourceText: X20_KAIOKEN_KAMEHAMEHA_SOURCE,
      },
      {
        trigger: "on-success",
        target: "self",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: -2 },
        selector: {
          type: "move-selector",
          subject: "source",
          ids: ["move-afterlife-kaio-ken"],
          sourceText: "Kaio-Ken",
        },
        duration: { type: "combat", sourceText: "for the remainder of combat" },
        sourceText: X20_KAIOKEN_KAMEHAMEHA_SOURCE,
      },
      {
        trigger: "on-success",
        target: "self",
        type: "prevent-move-modification",
        selector: {
          type: "move-selector",
          subject: "source",
          ids: ["move-afterlife-kaio-ken"],
          sourceText: "Kaio-Ken's cost",
        },
        aspects: ["cost"],
        actor: "any",
        exceptSourceMoveIds: ["move-afterlife-x20-kaioken-kamehameha"],
        duration: { type: "combat", sourceText: "for the remainder of combat" },
        sourceText: X20_KAIOKEN_KAMEHAMEHA_SOURCE,
      },
    ],
  ],
  [
    "move-afterlife-spirit-ball",
    [
      {
        trigger: "before-defense-roll",
        target: "self",
        type: "set-roll-result",
        roll: "attack",
        value: { type: "literal", value: 10 },
        resultScope: "matching-die",
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-most",
            value: { type: "literal", value: 5 },
            sourceText: "If you roll a 5 or less on any of these attack rolls",
          },
        ],
        sourceText:
          "If you roll a 5 or less on any of these attack rolls, that dice result is considered to be a 10 instead",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "literal", value: 5 },
        scope: { type: "current-action", sourceText: "this attack" },
        conditions: [
          {
            type: "roll-die-result",
            roll: "attack",
            index: 5,
            result: "successful",
            sourceText: "If your fifth dice is SUCCESSFUL",
          },
        ],
        sourceText:
          "SUCCESSFUL - If your fifth dice is SUCCESSFUL, this attack does +(5% Power) Damage per hit",
      },
    ],
  ],
  [
    "move-afterlife-energy-blade",
    [
      {
        trigger: "passive",
        target: "self",
        type: "grant-equipment",
        equipment: "sword",
        sourceText: "You are considered to have a sword equipped",
      },
      {
        trigger: "passive",
        target: "self",
        type: "modify-move-requirements",
        addRequirements: ["Sword Weapon"],
        selector: {
          type: "move-selector",
          subject: "source",
          tags: ["PHYSICAL"],
          requirementExcludes: ["sword"],
          sourceText: "Your Physical Attacks that do not require a sword",
        },
        sourceText:
          'You are considered to have a sword equipped. Your Physical Attacks that do not require a sword gain "Requirements: Sword Weapon"',
      },
    ],
  ],
  [
    "move-afterlife-give-me-energy",
    [
      {
        trigger: "action-phase",
        target: "opponent",
        type: "negate",
        aspects: ["prevent-attack"],
        sourceText:
          "Timing: ACTION phase. NEGATE any effects preventing your opponent from attacking",
      },
    ],
  ],
  [
    "move-afterlife-spirit-bomb",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: {
          type: "move-activation-count",
          moveId: "move-afterlife-give-me-energy",
          perActivation: 25,
        },
        scope: { type: "current-action", sourceText: "This attack" },
        sourceText:
          "This attack does +(25% Power) Damage for every time you have used 'Give Me Energy!' this combat",
      },
    ],
  ],
  [
    "move-afterlife-tri-beam",
    [
      {
        trigger: "passive",
        target: "self",
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
        scope: { type: "current-action", sourceText: "this attack" },
        sourceText: "You lose (10% Total HP) HP",
      },
    ],
  ],
  [
    "move-afterlife-present-bomb",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "stat-percent", subject: "self", stat: "power", percent: 65 },
        scope: { type: "current-action", sourceText: "this attack" },
        conditions: [
          {
            type: "stat-comparison",
            left: "opponent",
            stat: "sp",
            comparison: "higher-than",
            right: "self",
            sourceText: "If your opponent has more SP than you do",
          },
        ],
        sourceText:
          "If your opponent has more SP than you do, this attack does +(65% Power) Damage",
      },
    ],
  ],
  [
    "move-afterlife-gigantic-hammer",
    [
      {
        trigger: "passive",
        target: "self",
        type: "prevent-resolution",
        prevention: "block",
        scope: { type: "current-action", sourceText: "This attack" },
        sourceText: "This attack cannot be BLOCKED",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-damage",
        operation: "add",
        percent: { type: "damage-percent", subject: "current-action", percent: -20 },
        selector: {
          type: "move-selector",
          subject: "target",
          sourceText: "your opponent's next attack against you",
        },
        scope: { type: "next-action", sourceText: "your opponent's next attack against you" },
        conditions: [
          {
            type: "stat-comparison",
            left: "self",
            stat: "power",
            comparison: "at-least",
            right: "opponent",
            rightMultiplier: { type: "literal", value: 1.25 },
            sourceText: "If your Power is 1.25x or more your opponent's Power",
          },
        ],
        sourceText:
          "SUCCESSFUL - If your Power is 1.25x or more your opponent's Power, your opponent's next attack against you does -(20% Damage)",
      },
    ],
  ],
  [
    "move-afterlife-burning-shoot",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "schedule-effect",
        timing: { type: "turn-start", subject: "opponent", turnsAfter: 0 },
        repeat: "each-turn",
        effect: {
          type: "modify-resource",
          resource: "hp",
          operation: "lose",
          amount: { type: "stat-percent", subject: "self", stat: "power", percent: 5 },
        },
        cancellation: {
          actor: "opponent",
          result: "successful",
          moveSelector: {
            type: "move-selector",
            subject: "source",
            attackRoll: { dice: 1 },
            sourceText: "with a single dice attack",
          },
          target: "source",
          rollThreshold: {
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 20 },
            sourceText: "perform a SUCCESSFUL attack roll of 20 or higher",
          },
        },
        stacking: "prevent",
        sourceText:
          "SUCCESSFUL - Your opponent loses (5% Power) HP at the start of each of their turns until they perform a SUCCESSFUL attack roll of 20 or higher with a single dice attack. You cannot prevent your opponent from performing attacks while this effect is active. This attack's effect cannot stack with itself",
      },
    ],
  ],
  [
    "move-afterlife-thunder-flash",
    [
      {
        trigger: "passive",
        target: "opponent",
        type: "apply-status",
        statusId: "stun",
        conditions: [
          {
            type: "roll-comparison",
            left: "defense",
            comparison: "at-least",
            right: "attack",
            difference: { type: "literal", value: 7 },
            sourceText: "If your opponent's defensive roll is +7 or higher your attack roll",
          },
        ],
        sourceText: "If your opponent's defensive roll is +7 or higher your attack roll, STUNx2",
      },
      {
        trigger: "passive",
        target: "opponent",
        type: "apply-status",
        statusId: "stun",
        conditions: [
          {
            type: "roll-comparison",
            left: "defense",
            comparison: "at-least",
            right: "attack",
            difference: { type: "literal", value: 7 },
            sourceText: "If your opponent's defensive roll is +7 or higher your attack roll",
          },
        ],
        sourceText: "If your opponent's defensive roll is +7 or higher your attack roll, STUNx2",
      },
    ],
  ],
  [
    "move-afterlife-super-galick-gun",
    [
      {
        trigger: "after-defense-roll",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: 10 },
        cap: { type: "allow-exceed", sourceText: "may exceed the standard dice result cap" },
        scope: { type: "current-action", sourceText: "your attack roll" },
        activationCost: {
          resource: "ki",
          operation: "lose",
          amount: { type: "literal", value: 2 },
        },
        activationGroup: "super-galick-gun-reactive-boost",
        conditions: [
          {
            type: "roll-threshold",
            roll: "defense",
            comparison: "at-least",
            value: { type: "literal", value: 24 },
            sourceText: "If your opponent's defensive roll was 24 or higher",
          },
        ],
        sourceText:
          "If your opponent's defensive roll was 24 or higher, you may lose 2 KI to have your attack roll gain +10 to the result",
      },
      {
        trigger: "after-defense-roll",
        target: "opponent",
        type: "set-combat-result",
        result: "critical",
        resultScope: "current-attack",
        activationCost: {
          resource: "ki",
          operation: "lose",
          amount: { type: "literal", value: 2 },
        },
        activationGroup: "super-galick-gun-reactive-boost",
        conditions: [
          {
            type: "roll-threshold",
            roll: "defense",
            comparison: "at-least",
            value: { type: "literal", value: 24 },
            sourceText: "If your opponent's defensive roll was 24 or higher",
          },
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 30 },
            sourceText: "CRITICAL if that result is 30 or higher",
          },
        ],
        sourceText:
          "If your opponent's defensive roll was 24 or higher, you may lose 2 KI to have your attack roll gain +10 to the result and CRITICAL if that result is 30 or higher",
      },
    ],
  ],
  [
    "move-afterlife-death-slicer",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "prevent-move-modification",
        actor: "opponent",
        aspects: ["cost"],
        selector: {
          type: "move-selector",
          subject: "target",
          sourceText: "their attacks",
        },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 4 },
          sourceText: "for the next 4 turns",
        },
        sourceText:
          "SUCCESSFUL - Your opponent cannot lower the cost of their attacks for the next 4 turns",
      },
    ],
  ],
  [
    "move-afterlife-kamehameha",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "stat-percent", subject: "self", stat: "power", percent: 15 },
        scope: { type: "current-action", sourceText: "this attack" },
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 27 },
            sourceText: "If you roll a 27 or higher with this attack",
          },
        ],
        sourceText:
          "SUCCESSFUL - If you roll a 27 or higher with this attack, this attack does +(15% Power) Damage",
      },
    ],
  ],
  [
    "move-afterlife-final-revenger",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: 4 },
        scope: { type: "current-action", sourceText: "this attack" },
        conditions: [
          {
            type: "prior-action",
            actor: "opponent",
            result: "successful",
            sourceText: "If your opponent performed a SUCCESSFUL attack last turn",
          },
        ],
        sourceText:
          "If your opponent performed a SUCCESSFUL attack last turn, this attack gains +4 to the result",
      },
      {
        trigger: "passive",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: 4 },
        scope: {
          type: "next-actions",
          count: { type: "literal", value: 3 },
          sourceText: "your next 3 attacks",
        },
        conditions: [
          {
            type: "prior-action",
            actor: "opponent",
            result: "critical",
            sourceText: "If that attack was a CRITICAL",
          },
        ],
        sourceText:
          "If your opponent performed a SUCCESSFUL attack last turn, this attack gains +4 to the result. If that attack was a CRITICAL, this attack and your next 3 attacks all gain +4 to the result instead",
      },
    ],
  ],
  [
    "move-afterlife-bakuretsu-ranma",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "successful-hit-count", perHit: -1 },
        scope: { type: "next-roll", roll: "attack", sourceText: "next attack roll" },
        sourceText:
          "SUCCESSFUL - For every roll that was SUCCESSFUL, your opponent's next attack roll gains -1 to the result",
      },
    ],
  ],
  [
    "move-afterlife-dragon-fist",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-resource",
        resource: "hp",
        operation: "set",
        amount: { type: "literal", value: 0 },
        conditions: [
          {
            type: "resource-threshold",
            subject: "opponent",
            resource: "hp",
            basis: "total",
            comparison: "at-most",
            value: {
              type: "resource-percent",
              subject: "opponent",
              resource: "hp",
              basis: "total",
              percent: 15,
            },
            sourceText: "If your opponent's HP is 15% or less their total HP",
          },
        ],
        sourceText:
          "SUCCESSFUL - If your opponent's HP is 15% or less their total HP, reduce their HP to 0",
      },
    ],
  ],
  [
    "move-afterlife-gigantic-meteor",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "set-resolution-threshold",
        outcome: "stop",
        roll: "defense",
        comparison: "at-least",
        value: { type: "literal", value: 8 },
        selector: {
          type: "move-selector",
          subject: "target",
          tags: ["physical"],
          sourceText: "Your physical attacks",
        },
        duration: {
          type: "until-roll-threshold",
          roll: "defense",
          comparison: "at-least",
          value: { type: "literal", value: 25 },
          sourceText: "until your opponent rolls a defensive roll of 25 or more",
        },
        sourceText:
          "SUCCESSFUL - Your physical attacks cannot be STOPPED by a defensive roll of 7 or less until your opponent rolls a defensive roll of 25 or more",
      },
    ],
  ],
  [
    "move-afterlife-revenge-death-bomber",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-resource",
        resource: "hp",
        operation: "set",
        amount: { type: "literal", value: 1 },
        sourceText: "SUCCESSFUL - Set your HP to 1",
      },
      {
        trigger: "on-stopped",
        target: "self",
        type: "modify-resource",
        resource: "hp",
        operation: "set",
        amount: { type: "literal", value: 0 },
        sourceText: "STOPPED - Set your HP to 0",
      },
    ],
  ],
  [
    "move-afterlife-big-bang-crash",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-roll",
        roll: "transformation",
        modifier: "result",
        amount: { type: "successful-hit-count", perHit: -3 },
        scope: {
          type: "next-roll",
          roll: "transformation",
          sourceText: "next Transformation Roll",
        },
        sourceText:
          "SUCCESSFUL - For every dice roll that was SUCCESSFUL, your opponent's next Transformation Roll gains -3 to the result",
      },
    ],
  ],
  [
    "move-afterlife-scatter-shot",
    [
      {
        trigger: "passive",
        target: "opponent",
        type: "set-resolution-threshold",
        outcome: "stop",
        roll: "defense",
        comparison: "at-least",
        value: { type: "literal", value: 11 },
        resultScope: "current-attack",
        conditions: [
          {
            type: "stat-comparison",
            left: "self",
            stat: "power",
            comparison: "higher-than",
            right: "opponent",
            sourceText: "If your Power is higher than your opponent's Power",
          },
        ],
        sourceText:
          "If your Power is higher than your opponent's Power, your opponent cannot STOP this attack with a defensive roll of 10 or less",
      },
    ],
  ],
  [
    "move-afterlife-ki-blade-rush",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "apply-status",
        statusId: "sever",
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 29 },
            sourceText: "If your attack roll is 29 or higher",
          },
        ],
        sourceText: "SUCCESSFUL - If your attack roll is 29 or higher, SEVER",
      },
    ],
  ],
  [
    "move-afterlife-death-chaser",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: 1 },
        selector: {
          type: "move-selector",
          subject: "target",
          tags: ["energy"],
          sourceText: "next energy attack",
        },
        scope: { type: "next-action", sourceText: "Your next energy attack" },
        stacking: "prevent",
        sourceText: "Your next energy attack gains +1 to the result",
      },
      {
        trigger: "passive",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: 2 },
        selector: {
          type: "move-selector",
          subject: "target",
          category: "signature",
          tags: ["energy"],
          sourceText: "If that energy attack is a Signature Technique",
        },
        scope: { type: "next-action", sourceText: "Your next energy attack" },
        stacking: "prevent",
        sourceText:
          "Your next energy attack gains +1 to the result. If that energy attack is a Signature Technique, it gains +3 to the result instead. This effect does not stack with itself",
      },
    ],
  ],
  [
    "move-afterlife-crusher-ball",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: 2 },
        scope: { type: "next-roll", roll: "attack", sourceText: "next attack roll" },
        sourceText: "SUCCESSFUL - Your next attack roll gains +2 to the result",
      },
    ],
  ],
  [
    "move-afterlife-kienzan",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: 2 },
        scope: { type: "current-action", sourceText: "This attack" },
        sourceText: "This attack gains +2 to the result",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "apply-status",
        statusId: "sever",
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 28 },
            sourceText: "If your attack roll result is 28 or higher",
          },
        ],
        sourceText: "SUCCESSFUL - If your attack roll result is 28 or higher, SEVER",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "grant-extra-action",
        phase: "action-phase",
        moveCategory: "power-up",
        scope: { type: "next-turn", subject: "self", sourceText: "on your next turn" },
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 20 },
            sourceText: "If your attack roll is 20 or higher",
          },
        ],
        sourceText:
          "If your attack roll is 20 or higher, you may Power Up on your next turn without it taking up your turn",
      },
    ],
  ],
  [
    "move-afterlife-eraser-cannon",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "stat-percent", subject: "self", stat: "power", percent: 40 },
        scope: { type: "current-action", sourceText: "this attack" },
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 20 },
            sourceText: "If your attack roll is 20 or higher",
          },
        ],
        sourceText: "If your attack roll is 20 or higher, this attack does +(40% Power) Damage",
      },
      {
        trigger: "passive",
        target: "opponent",
        type: "set-resolution-threshold",
        outcome: "stop",
        roll: "defense",
        comparison: "at-least",
        value: { type: "literal", value: 10 },
        resultScope: "current-attack",
        conditions: [
          {
            type: "stat-comparison",
            left: "self",
            stat: "power",
            comparison: "higher-than",
            right: "opponent",
            rightStat: "dexterity",
            rightMultiplier: { type: "literal", value: 20 },
            sourceText: "If your Power is more than your opponent's Dexterity times 20",
          },
        ],
        sourceText:
          "If your Power is more than your opponent's Dexterity times 20, your opponent's defensive roll must be 10 or higher to STOP this attack",
      },
    ],
  ],
  [
    "move-afterlife-light-grenade",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-resource",
        resource: "hp",
        operation: "gain",
        amount: {
          type: "resource-percent",
          subject: "self",
          resource: "hp",
          basis: "current",
          percent: 10,
        },
        sourceText: "SUCCESSFUL - Gain (10% Current HP) HP",
      },
    ],
  ],
  [
    "move-afterlife-special-beam-cannon",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: 2 },
        conditions: [
          {
            type: "roll-comparison",
            left: "attack",
            comparison: "at-most",
            right: "defense",
            difference: { type: "literal", value: 14 },
            sourceText: "If your attack roll is +15 or more your opponent's defensive roll",
          },
        ],
        sourceText:
          "SUCCESSFUL - Gain 2 KI. If your attack roll is +15 or more your opponent's defensive roll",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: 3 },
        conditions: [
          {
            type: "roll-comparison",
            left: "attack",
            comparison: "at-least",
            right: "defense",
            difference: { type: "literal", value: 15 },
            sourceText: "If your attack roll is +15 or more your opponent's defensive roll",
          },
        ],
        sourceText:
          "If your attack roll is +15 or more your opponent's defensive roll, gain 3 KI instead",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-resource",
        resource: "ki",
        operation: "lose",
        amount: { type: "literal", value: 2 },
        sourceText: "Your opponent loses 2 KI",
      },
    ],
  ],
  [
    "move-afterlife-meteor-smash",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "apply-status",
        statusId: "stun",
        conditions: [
          {
            type: "successful-hit-count",
            comparison: "at-least",
            value: { type: "literal", value: 4 },
            sourceText: "If 4 or more attack rolls are SUCCESSFUL",
          },
        ],
        sourceText: "SUCCESSFUL - If 4 or more attack rolls are SUCCESSFUL, STUN",
      },
    ],
  ],
  [
    "move-afterlife-super-kamehameha",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "set-combat-result",
        result: "critical",
        resultScope: "current-attack",
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 28 },
            sourceText: "If your natural attack roll result is 28 or higher",
          },
        ],
        sourceText: "SUCCESSFUL - If your natural attack roll result is 28 or higher, CRITICAL",
      },
    ],
  ],
  [
    "move-afterlife-future-sight",
    [
      {
        trigger: "upkeep-phase",
        target: "opponent",
        type: "lock",
        affectedType: "power-up",
        scope: { type: "next-turn", subject: "opponent", sourceText: "on their next turn" },
        useLimit: { scope: "combat", count: 1, sourceText: "RESTRICTEDx1" },
        sourceText:
          "RESTRICTEDx1. Use during your UPKEEP phase. Your opponent cannot Power Up on their next turn",
      },
    ],
  ],
  [
    "move-afterlife-final-spirit-cannon",
    [
      {
        trigger: "before-attack-roll",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: 1 },
        duration: { type: "combat", sourceText: "for the remainder of combat" },
        sourceText: "Your attack rolls gain +1 to the result for the remainder of combat",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: 3 },
        duration: { type: "combat", sourceText: "for the remainder of combat" },
        sourceText:
          "SUCCESSFUL - Your attack roll gains +3 to the result for the remainder of combat instead",
      },
    ],
  ],
  [
    "move-afterlife-burning-attack",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "lock",
        affectedType: "attack",
        selector: {
          type: "move-selector",
          subject: "target",
          category: "signature",
          sourceText: "Signature Techniques",
        },
        scope: { type: "next-turn", subject: "opponent", sourceText: "for their next turn" },
        sourceText:
          "SUCCESSFUL - LOCK your opponent's Signature Techniques and Power Up for their next turn",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "lock",
        affectedType: "power-up",
        scope: { type: "next-turn", subject: "opponent", sourceText: "for their next turn" },
        sourceText:
          "SUCCESSFUL - LOCK your opponent's Signature Techniques and Power Up for their next turn",
      },
    ],
  ],
  [
    "move-afterlife-telekinesis",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "deactivate",
        affectedType: "skill",
        count: { type: "literal", value: 1 },
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 20 },
            sourceText: "If your attack roll is 20 or higher",
          },
          {
            type: "move-selector",
            subject: "target",
            category: "skill",
            constant: true,
            sourceText: "one of your opponent's CONSTANT Skills",
          },
        ],
        sourceText:
          "SUCCESSFUL - If your attack roll is 20 or higher, DEACTIVATE one of your opponent's CONSTANT Skills",
      },
    ],
  ],
  [
    "move-afterlife-dodon-ray",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "lock",
        affectedType: "skill",
        selector: {
          type: "move-selector",
          subject: "target",
          category: "skill",
          constant: false,
          sourceText: "one of your opponent's non-CONSTANT Skills",
        },
        duration: { type: "combat", sourceText: "for the remainder of combat" },
        sourceText:
          "SUCCESSFUL - Choose one of your opponent's non-CONSTANT Skills. LOCK that Skill for the remainder of combat",
      },
    ],
  ],
  [
    "move-afterlife-sword-blast",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "sides",
        amount: { type: "literal", value: 3 },
        selector: {
          type: "move-selector",
          subject: "target",
          category: "advanced-attack",
          effectTextIncludes: "Sword",
          sourceText: 'next attack that requires a "sword"',
        },
        scope: { type: "next-action", sourceText: 'next attack that requires a "sword"' },
        sourceText: 'SUCCESSFUL - Your next attack that requires a "sword" gains +3 dice sides',
      },
    ],
  ],
  [
    "move-afterlife-satan-miracle-special-ultra-super-megaton-punch",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: 5 },
        sourceText: "SUCCESSFUL - Gain 5 KI",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-roll",
        roll: "defense",
        modifier: "result",
        amount: { type: "literal", value: -3 },
        scope: {
          type: "next-rolls",
          roll: "defense",
          count: { type: "literal", value: 3 },
          sourceText: "your opponent's next 3 defense rolls",
        },
        sourceText: "your opponent's next 3 defense rolls gain -3 to the results",
      },
      {
        trigger: "on-stopped",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: 2 },
        sourceText: "STOPPED - Gain 2 KI",
      },
    ],
  ],
  [
    "move-afterlife-lightning-arrows",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: 3 },
        selector: {
          type: "move-selector",
          subject: "target",
          category: "advanced-attack",
          attackRoll: { dice: 2 },
          sourceText: "any attacks you use with multiple dice rolls",
        },
        duration: { type: "combat", sourceText: "For the remainder of combat" },
        sourceText:
          "SUCCESSFUL - For the remainder of combat, any attacks you use with multiple dice rolls gain +3 to all the results",
      },
    ],
  ],
  [
    "move-afterlife-rolling-satan-punch",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "lock",
        affectedType: "skill",
        duration: {
          type: "until-roll-threshold",
          roll: "attack",
          comparison: "at-least",
          value: { type: "literal", value: 25 },
          sourceText: "until they roll an attack roll of 25 or higher",
        },
        sourceText:
          "SUCCESSFUL - LOCK your opponent's Skills until they roll an attack roll of 25 or higher",
      },
    ],
  ],
  [
    "move-afterlife-finish-buster",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: 1 },
        selector: {
          type: "move-selector",
          subject: "target",
          category: "block",
          sourceText: "that Block",
        },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 4 },
          sourceText: "within the next 4 turns",
        },
        sourceText:
          "SUCCESSFUL - If your opponent uses a Block within the next 4 turns, that Block costs +1 KI to use",
      },
    ],
  ],
  [
    "move-afterlife-heat-dome-attack",
    [
      {
        trigger: "passive",
        target: "opponent",
        type: "prevent-resolution",
        prevention: "block",
        duration: { type: "combat", sourceText: "for the remainder of combat" },
        sourceText: "Your opponent cannot Block your attacks for the remainder of combat",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "prevent-move-modification",
        actor: "opponent",
        aspects: ["damage"],
        selector: {
          type: "move-selector",
          subject: "target",
          category: "advanced-attack",
          sourceText: "your attacks",
        },
        duration: { type: "combat", sourceText: "for the remainder of combat" },
        sourceText:
          "SUCCESSFUL - Your opponent cannot prevent damage or reduce the damage of your attacks for the remainder of combat, unless by BREAK or SEVER",
      },
    ],
  ],
  [
    "move-afterlife-destructo-disc",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "grant-extra-action",
        phase: "upkeep-phase",
        moveCategory: "power-up",
        scope: { type: "next-turn", subject: "self", sourceText: "on your next turn" },
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 20 },
            sourceText: "If your attack roll is 20 or higher",
          },
        ],
        sourceText:
          "If your attack roll is 20 or higher, you may Power Up on your next turn without it taking up your turn",
      },
    ],
  ],
  [
    "move-afterlife-big-bang-attack",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "prevent-combat-result",
        result: "critical",
        scope: {
          type: "next-actions",
          count: { type: "literal", value: 2 },
          sourceText: "for their next 2 attacks",
        },
        sourceText:
          "SUCCESSFUL - Your opponent's dice sides cannot exceed 1d30 for the remainder of combat. Your opponent cannot CRITICAL or modify their dice sides for their next 2 attacks",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "prevent-roll-modification",
        roll: "attack",
        modifier: "sides",
        scope: {
          type: "next-actions",
          count: { type: "literal", value: 2 },
          sourceText: "for their next 2 attacks",
        },
        sourceText:
          "SUCCESSFUL - Your opponent's dice sides cannot exceed 1d30 for the remainder of combat. Your opponent cannot CRITICAL or modify their dice sides for their next 2 attacks",
      },
    ],
  ],
  [
    "move-afterlife-final-flash",
    [
      {
        trigger: "before-attack-roll",
        target: "opponent",
        type: "set-resolution-threshold",
        outcome: "stop",
        roll: "defense",
        comparison: "at-most",
        value: { type: "literal", value: 12 },
        resultScope: "current-attack",
        conditions: [
          {
            type: "combat-state",
            subject: "self",
            state: "transformed",
            sourceText: "If performed while you are in a Transformation",
          },
        ],
        sourceText:
          "If performed while you are in a Transformation, this attack cannot be STOPPED by a defensive roll of 12 or less",
      },
    ],
  ],
  [
    "move-afterlife-super-big-bang-attack",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "prevent-combat-result",
        result: "critical",
        scope: {
          type: "next-actions",
          count: { type: "literal", value: 2 },
          sourceText: "with their next 2 attacks",
        },
        sourceText:
          "SUCCESSFUL - Your opponent's dice sides cannot exceed 30 for the remainder of combat. Your opponent cannot CRITICAL with their next 2 attacks",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-roll",
        roll: "attack",
        modifier: "sides",
        cap: {
          type: "maximum",
          value: { type: "literal", value: 30 },
          sourceText: "cannot exceed 30 for the remainder of combat",
        },
        duration: { type: "combat", sourceText: "for the remainder of combat" },
        sourceText:
          "SUCCESSFUL - Your opponent's dice sides cannot exceed 30 for the remainder of combat. Your opponent cannot CRITICAL with their next 2 attacks",
      },
    ],
  ],
  [
    "move-afterlife-black-kamehameha",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-resource",
        resource: "ki",
        operation: "lose",
        amount: { type: "literal", value: 1 },
        sourceText: "SUCCESSFUL - Your opponent loses 1 KI",
      },
    ],
  ],
  [
    "move-afterlife-death-beam",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: 1 },
        selector: {
          type: "move-selector",
          subject: "target",
          category: "advanced-attack",
          baseKiCost: { comparison: "exactly", value: { type: "literal", value: 1 } },
          sourceText: "next base cost 1 attack",
        },
        scope: { type: "next-action", sourceText: "next base cost 1 attack" },
        sourceText: "SUCCESSFUL - Your opponent's next base cost 1 attack costs +1 KI to perform",
      },
    ],
  ],
  [
    "move-afterlife-crazy-finger-beam",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-resource",
        resource: "ki",
        operation: "lose",
        amount: { type: "moveset-move-count", subject: "opponent", category: "advanced-attack" },
        conditions: [
          {
            type: "successful-hit-count",
            comparison: "at-least",
            value: { type: "literal", value: 4 },
            sourceText: "If 4 or more attack rolls are SUCCESSFUL",
          },
        ],
        sourceText:
          "SUCCESSFUL - If 4 or more attack rolls are SUCCESSFUL, your opponent loses KI equal to the amount of Advanced Attacks in their moveset",
      },
    ],
  ],
  [
    "move-afterlife-imprisonment-ball",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: 1 },
        maximum: { type: "literal", value: 10 },
        selector: {
          type: "move-selector",
          subject: "target",
          sourceText: "next Advanced Attack or Signature Technique",
        },
        scope: { type: "next-action", sourceText: "next Advanced Attack or Signature Technique" },
        sourceText:
          "SUCCESSFUL - Your opponent's next Advanced Attack or Signature Technique costs +1 KI to perform to a maximum of 10",
      },
    ],
  ],
  [
    "move-afterlife-evil-impulse",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "lock",
        affectedType: "attack",
        selector: {
          type: "move-selector",
          subject: "target",
          baseKiCost: { comparison: "exactly", value: { type: "literal", value: 1 } },
          sourceText: "attacks with a base cost of 1",
        },
        scope: { type: "next-turn", subject: "opponent", sourceText: "for their next turn" },
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 10 },
            sourceText: "If your attack roll is 10 or higher",
          },
        ],
        sourceText:
          "SUCCESSFUL - If your attack roll is 10 or higher, LOCK your opponent's attacks with a base cost of 1 for their next turn",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "lock",
        affectedType: "power-up",
        scope: { type: "next-turn", subject: "opponent", sourceText: "for their next turn" },
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 20 },
            sourceText: "If your attack roll is 20 or higher",
          },
        ],
        sourceText:
          "If your attack roll is 20 or higher, LOCK your opponent's Power Up for their next turn",
      },
    ],
  ],
  [
    "move-afterlife-hellfire-blitz",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: 2 },
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 25 },
            sourceText: "If your dice roll is 25 or higher",
          },
        ],
        sourceText: "If your dice roll is 25 or higher, gain 2 KI",
      },
    ],
  ],
  [
    "move-afterlife-angry-explosion",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "stat-percent", subject: "self", stat: "power", percent: 15 },
        scope: {
          type: "next-actions",
          count: { type: "literal", value: 2 },
          sourceText: "Your next 2 attacks",
        },
        sourceText: "SUCCESSFUL - Your next 2 attacks do +(15% Power) Damage",
      },
    ],
  ],
  [
    "move-afterlife-blaster-shell",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "lock",
        affectedType: "attack",
        selector: {
          type: "move-selector",
          subject: "target",
          baseKiCost: { comparison: "at-least", value: { type: "literal", value: 3 } },
          sourceText: "attacks with a base cost of 3 or higher",
        },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 4 },
          sourceText: "for their next 4 turns",
        },
        sourceText:
          "SUCCESSFUL - LOCK your opponent's attacks with a base cost of 3 or higher for their next 4 turns",
      },
    ],
  ],
  [
    "move-afterlife-blazing-storm",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "lock",
        affectedType: "attack",
        selector: {
          type: "move-selector",
          subject: "target",
          tags: ["physical"],
          sourceText: "your opponent's physical attacks",
        },
        scope: { type: "next-turn", subject: "opponent", sourceText: "for their next turn" },
        sourceText: "SUCCESSFUL - LOCK your opponent's physical attacks for their next turn",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-resource",
        resource: "ki",
        operation: "lose",
        amount: { type: "literal", value: 2 },
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 20 },
            sourceText: "If your attack roll is 20 or higher",
          },
        ],
        sourceText: "If your attack roll is 20 or higher, your opponent loses 2 KI",
      },
    ],
  ],
  [
    "move-afterlife-volcano-explosion",
    [
      {
        trigger: "before-attack-roll",
        target: "opponent",
        type: "lock",
        affectedType: "attack",
        selector: {
          type: "move-selector",
          subject: "target",
          tags: ["energy"],
          sourceText: "your opponent's energy attacks",
        },
        scope: { type: "next-turn", subject: "opponent", sourceText: "for their next turn" },
        sourceText: "LOCK your opponent's energy attacks for their next turn",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: 2 },
        selector: {
          type: "move-selector",
          subject: "target",
          tags: ["energy"],
          sourceText: "Your opponent's next energy attack",
        },
        scope: { type: "next-action", sourceText: "Your opponent's next energy attack" },
        sourceText: "SUCCESSFUL - Your opponent's next energy attack costs +2 KI to perform",
      },
    ],
  ],
  [
    "move-afterlife-special-fighting-pose-1",
    [
      {
        trigger: "action-phase",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "stat-percent", subject: "self", stat: "power", percent: 10 },
        scope: { type: "next-action", sourceText: "Your next attack" },
        useLimit: { scope: "combat", count: 1, sourceText: "RESTRICTEDx1" },
        sourceText: "RESTRICTEDx1. Your next attack does +(10% Power) Damage",
      },
      {
        trigger: "action-phase",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: 2 },
        sourceText: "Gain 2 KI",
      },
    ],
  ],
  [
    "move-afterlife-special-fighting-pose-2",
    [
      {
        trigger: "action-phase",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "sides",
        amount: { type: "literal", value: 3 },
        scope: { type: "next-roll", roll: "attack", sourceText: "Your next attack roll" },
        useLimit: { scope: "combat", count: 1, sourceText: "RESTRICTEDx1" },
        sourceText: "RESTRICTEDx1. Your next attack roll gains +3 sides",
      },
      {
        trigger: "action-phase",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: 2 },
        sourceText: "Gain 2 KI",
      },
    ],
  ],
  [
    "move-afterlife-special-fighting-pose-4",
    [
      {
        trigger: "action-phase",
        target: "opponent",
        type: "modify-resource",
        resource: "ki",
        operation: "lose",
        amount: { type: "literal", value: 1 },
        useLimit: { scope: "combat", count: 1, sourceText: "RESTRICTEDx1" },
        sourceText: "RESTRICTEDx1. Your opponent loses 1 KI",
      },
      {
        trigger: "action-phase",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: 2 },
        sourceText: "Gain 2 KI",
      },
    ],
  ],
  [
    "move-afterlife-special-fighting-pose-5",
    [
      {
        trigger: "action-phase",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: 2 },
        selector: {
          type: "move-selector",
          subject: "target",
          category: "signature",
          sourceText: "Your next Signature Technique",
        },
        scope: { type: "next-action", sourceText: "Your next Signature Technique" },
        useLimit: { scope: "combat", count: 1, sourceText: "RESTRICTEDx1" },
        sourceText: "RESTRICTEDx1. Your next Signature Technique gains +2 to the results",
      },
      {
        trigger: "action-phase",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: 2 },
        sourceText: "Gain 2 KI",
      },
    ],
  ],
  [
    "move-afterlife-space-mach-attack",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "sides",
        amount: { type: "literal", value: 1 },
        scope: { type: "next-roll", roll: "attack", sourceText: "Your next attack roll" },
        sourceText: "SUCCESSFUL - Your next attack roll gains +1 side and +1 to the result",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: 1 },
        scope: { type: "next-roll", roll: "attack", sourceText: "Your next attack roll" },
        sourceText: "SUCCESSFUL - Your next attack roll gains +1 side and +1 to the result",
      },
    ],
  ],
  [
    "move-afterlife-psychic-throw",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "lock",
        affectedType: "move",
        selector: {
          type: "move-selector",
          subject: "target",
          category: "mastery",
          sourceText: "your opponent's Mastery",
        },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 3 },
          sourceText: "for their next 3 turns",
        },
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 20 },
            sourceText: "If your attack roll is 20 or higher",
          },
        ],
        sourceText:
          "SUCCESSFUL - If your attack roll is 20 or higher, LOCK your opponent's Mastery for their next 3 turns",
      },
    ],
  ],
  [
    "move-afterlife-life-drain",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-resource",
        resource: "hp",
        operation: "lose",
        amount: {
          type: "resource-percent",
          subject: "opponent",
          resource: "hp",
          basis: "total",
          percent: 40,
        },
        sourceText: "SUCCESSFUL - Your opponent loses (40% Their Total HP) HP",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "modify-resource",
        resource: "hp",
        operation: "gain",
        amount: {
          type: "resource-percent",
          subject: "self",
          resource: "hp",
          basis: "total",
          percent: 15,
        },
        sourceText: "you gain (15% Total HP) HP",
      },
    ],
  ],
  [
    "move-afterlife-s-s-deadly-bomb",
    [
      {
        trigger: "before-defense-roll",
        target: "opponent",
        type: "set-resolution-threshold",
        outcome: "stop",
        roll: "defense",
        comparison: "at-least",
        value: { type: "literal", value: 5 },
        relativeTo: "attack-roll",
        resultScope: "current-attack",
        sourceText:
          "Your opponent's defensive roll must be at least +5 your attack roll to stop this attack",
      },
    ],
  ],
  [
    "move-afterlife-burning-slash",
    [
      {
        trigger: "on-stopped",
        target: "self",
        type: "grant-extra-action",
        phase: "action-phase",
        move: "source",
        sourceText:
          "If you performed Burning Attack and it was STOPPED, perform this attack in the same turn",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "literal", value: 15 },
        conditions: [
          {
            type: "roll-die-result",
            roll: "attack",
            index: 6,
            result: "successful",
            sourceText: "If your sixth dice is successful",
          },
        ],
        sourceText: "If your sixth dice is successful, this attack does +(15% Power) Damage",
      },
    ],
  ],
  [
    "move-afterlife-expanding-energy-blast",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "prevent-move-use",
        operation: "deactivate",
        selector: {
          type: "move-selector",
          subject: "source",
          category: "skill",
          sourceText: "choose one of your Skills. That Skill cannot be DEACTIVATED",
        },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 4 },
          sourceText: "for the next 4 turns",
        },
        conditions: [
          {
            type: "successful-hit-count",
            comparison: "at-least",
            value: { type: "literal", value: 4 },
            sourceText: "If 4 or more attack rolls are SUCCESSFUL",
          },
          {
            type: "successful-hit-count",
            comparison: "at-most",
            value: { type: "literal", value: 6 },
            sourceText: "If 4 or more attack rolls are SUCCESSFUL",
          },
        ],
        sourceText:
          "SUCCESSFUL - If 4 or more attack rolls are SUCCESSFUL, choose one of your Skills. That Skill cannot be DEACTIVATED for the next 4 turns",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "prevent-move-use",
        operation: "deactivate",
        selector: {
          type: "move-selector",
          subject: "source",
          category: "skill",
          sourceText: "choose up to 2 Skills and they cannot be DEACTIVATED",
        },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 10 },
          sourceText: "for the next 10 turns instead",
        },
        conditions: [
          {
            type: "successful-hit-count",
            comparison: "at-least",
            value: { type: "literal", value: 7 },
            sourceText: "If 7 or more dice rolls are SUCCESSFUL",
          },
        ],
        sourceText:
          "If 7 or more dice rolls are SUCCESSFUL, choose up to 2 Skills and they cannot be DEACTIVATED for the next 10 turns instead",
      },
    ],
  ],
  [
    "move-afterlife-evil-flame",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "lock",
        affectedType: "power-up",
        duration: {
          type: "until-roll-threshold",
          roll: "attack",
          comparison: "at-least",
          value: {
            type: "minimum",
            values: [
              { type: "prior-roll-result", roll: "attack" },
              { type: "literal", value: 25 },
            ],
          },
          sourceText:
            "until one of their attack rolls exceeds your attack roll result or 25 - whichever is lower",
        },
        sourceText:
          "SUCCESSFUL - Your opponent may not Power Up until one of their attack rolls exceeds your attack roll result or 25 - whichever is lower",
      },
    ],
  ],
  [
    "move-afterlife-blade-rush",
    [
      {
        trigger: "on-stopped",
        target: "self",
        type: "grant-extra-action",
        phase: "action-phase",
        move: "source",
        conditions: [
          {
            type: "prior-action",
            actor: "self",
            result: "stopped",
            selector: {
              type: "move-selector",
              subject: "source",
              ids: ["move-afterlife-hellfire-blitz"],
              sourceText: "you performed Hellfire Blitz and it was STOPPED",
            },
            sourceText: "Use only if you performed Hellfire Blitz and it was STOPPED",
          },
        ],
        sourceText:
          "Use only if you performed Hellfire Blitz and it was STOPPED. Perform this attack in the same turn",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "literal", value: 25 },
        conditions: [
          {
            type: "roll-die-result",
            roll: "attack",
            index: 8,
            result: "successful",
            sourceText: "If your eighth dice is successful",
          },
        ],
        sourceText: "If your eighth dice is successful, this attack does +(25% Power) Damage",
      },
    ],
  ],
  [
    "move-afterlife-vanishing-ball",
    [
      {
        trigger: "before-attack-roll",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "sides",
        amount: { type: "literal", value: 0 },
        cap: {
          type: "maximum",
          value: { type: "literal", value: 35 },
          sourceText: "Your dice sides cannot exceed 1d35 with this attack",
        },
        sourceText: "Your dice sides cannot exceed 1d35 with this attack",
      },
      {
        trigger: "before-attack-roll",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: 0 },
        cap: {
          type: "maximum",
          value: { type: "literal", value: 3 },
          sourceText: "The results of this attack cannot gain more than +3 from any effects",
        },
        sourceText: "The results of this attack cannot gain more than +3 from any effects",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-resource",
        resource: "hp",
        operation: "set",
        amount: { type: "literal", value: 0 },
        conditions: [
          {
            type: "combat-context",
            mode: "battle",
            sourceText: "If used in a Battle",
          },
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 31 },
            sourceText: "your attack roll is 31 or higher",
          },
        ],
        sourceText:
          "SUCCESSFUL - If used in a Battle and your attack roll is 31 or higher, set your opponent's HP to 0",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "prevent-resource-modification",
        resource: "hp",
        operation: "gain",
        duration: { type: "combat", sourceText: "Your opponent cannot gain HP or set their HP" },
        conditions: [
          {
            type: "combat-context",
            mode: "battle",
            sourceText: "If used in a Battle",
          },
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 31 },
            sourceText: "your attack roll is 31 or higher",
          },
        ],
        sourceText:
          "SUCCESSFUL - If used in a Battle and your attack roll is 31 or higher, set your opponent's HP to 0. Your opponent cannot gain HP or set their HP",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "prevent-resource-modification",
        resource: "hp",
        operation: "set",
        duration: { type: "combat", sourceText: "Your opponent cannot gain HP or set their HP" },
        conditions: [
          {
            type: "combat-context",
            mode: "battle",
            sourceText: "If used in a Battle",
          },
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 31 },
            sourceText: "your attack roll is 31 or higher",
          },
        ],
        sourceText:
          "SUCCESSFUL - If used in a Battle and your attack roll is 31 or higher, set your opponent's HP to 0. Your opponent cannot gain HP or set their HP",
      },
    ],
  ],
  [
    "move-afterlife-special-fighting-pose-3",
    [
      {
        trigger: "action-phase",
        target: "self",
        type: "create-floating-effect",
        floatingEffectId: "special-fighting-pose-3-constant-skill-activation",
        scope: { type: "next-action", sourceText: "Your next energy attack" },
        effects: [
          {
            trigger: "on-success",
            target: "self",
            type: "activate",
            selector: {
              type: "move-selector",
              subject: "source",
              category: "skill",
              constant: true,
              sourceText: "Activate one of your CONSTANT Skills",
            },
            conditions: [
              {
                type: "move-selector",
                subject: "source",
                tags: ["energy"],
                sourceText: "Your next energy attack",
              },
            ],
            sourceText: "SUCCESSFUL - Activate one of your CONSTANT Skills",
          },
        ],
        sourceText:
          'Your next energy attack gains "SUCCESSFUL - Activate one of your CONSTANT Skills"',
      },
      {
        trigger: "action-phase",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: 2 },
        sourceText: "Gain 2 KI",
      },
      {
        trigger: "action-phase",
        target: "self",
        type: "grant-extra-action",
        phase: "action-phase",
        conditions: [
          {
            type: "active-move-count",
            subject: "opponent",
            selector: {
              type: "move-selector",
              subject: "target",
              category: "skill",
              constant: true,
              sourceText: "your opponent has no CONSTANT Skills active",
            },
            comparison: "exactly",
            value: { type: "literal", value: 0 },
            sourceText: "If your opponent has no CONSTANT Skills active",
          },
        ],
        sourceText:
          "If your opponent has no CONSTANT Skills active, this Skill does not take up your turn",
      },
    ],
  ],
  [
    "move-afterlife-wolf-fang-fist",
    [
      {
        trigger: "before-attack-roll",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: 5 },
        conditions: [
          {
            type: "active-move-count",
            subject: "self",
            selector: {
              type: "move-selector",
              subject: "source",
              category: "skill",
              constant: true,
              sourceText: "CONSTANT Skills currently active",
            },
            comparison: "exactly",
            value: { type: "literal", value: 0 },
            sourceText: "If you have no CONSTANT Skills currently active",
          },
        ],
        sourceText:
          "If you have no CONSTANT Skills currently active, this attack gains +5 to the results",
      },
      {
        trigger: "before-attack-roll",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: 2 },
        conditions: [
          {
            type: "active-move-count",
            subject: "self",
            selector: {
              type: "move-selector",
              subject: "source",
              category: "skill",
              constant: true,
              sourceText: "CONSTANT Skill active",
            },
            comparison: "exactly",
            value: { type: "literal", value: 1 },
            sourceText: "If you have only one CONSTANT Skill active",
          },
        ],
        sourceText:
          "If you have only one CONSTANT Skill active, this attack gains +2 to the results",
      },
    ],
  ],
  [
    "move-afterlife-four-arms",
    [
      {
        trigger: "on-roll-result",
        target: "self",
        type: "set-roll-result",
        roll: "defense",
        value: { type: "prior-roll-result", roll: "defense", multiplier: 2 },
        resultScope: "matching-die",
        scope: {
          type: "next-roll",
          roll: "defense",
          sourceText: "The next time your defensive roll",
        },
        conditions: [
          {
            type: "roll-threshold",
            roll: "defense",
            comparison: "at-most",
            value: { type: "literal", value: 10 },
            sourceText: "your defensive roll is 10 or less",
          },
        ],
        stacking: "prevent",
        sourceText:
          "SUCCESSFUL - The next time your defensive roll is 10 or less, double your defensive roll. This effect cannot be stacked",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "prevent-roll-modification",
        roll: "defense",
        modifier: "any",
        exemptSourceEffect: true,
        duration: {
          type: "turns",
          turns: { type: "literal", value: 3 },
          sourceText: "for the next 3 turns",
        },
        sourceText:
          "Your defensive roll cannot be modified for the next 3 turns other than this effect",
      },
    ],
  ],
  [
    "move-afterlife-multi-form",
    [
      {
        trigger: "before-attack-roll",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "dice",
        amount: {
          type: "selected-dice-count",
          selectionKey: "multi-form-dice-for-sides",
          operation: "negate",
        },
        activationGroup: "multi-form-dice-for-sides",
        sourceText: "You may have this attack lose any amount of dice",
      },
      {
        trigger: "before-attack-roll",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "sides",
        amount: {
          type: "selected-dice-count",
          selectionKey: "multi-form-dice-for-sides",
          operation: "groups",
          groupSize: 2,
          perGroup: 3,
        },
        cap: { type: "allow-exceed", sourceText: "You may exceed the standard dice side cap" },
        activationGroup: "multi-form-dice-for-sides",
        sourceText:
          "For every 2 dice you lose, this attack gains +3 dice sides. You may exceed the standard dice side cap with this effect",
      },
      {
        trigger: "before-attack-roll",
        target: "self",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: -1 },
        conditions: [
          {
            type: "prior-action",
            actor: "self",
            action: "power-up",
            sourceText: "If you Powered Up on your last turn",
          },
        ],
        sourceText: "If you Powered Up on your last turn, this attack costs -1 KI",
      },
    ],
  ],
  [
    "move-afterlife-hellzone-grenade",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-cost-modifier",
        multiplier: { type: "literal", value: 2 },
        scope: {
          type: "next-cost-modification",
          sourceText: "the next time you modify the cost of an attack",
        },
        conditions: [
          {
            type: "successful-hit-count",
            comparison: "at-least",
            value: { type: "literal", value: 7 },
            sourceText: "If 7 or more dice rolls are SUCCESSFUL",
          },
        ],
        sourceText:
          "SUCCESSFUL - If 7 or more dice rolls are SUCCESSFUL, the next time you modify the cost of an attack, double the amount it is modified by",
      },
    ],
  ],
  [
    "move-afterlife-mass-genocide-attack",
    [
      ...(
        [
          {
            priorSuccessfulDice: [1],
            dieIndex: 2,
            bonus: 2,
            conditionText: "If the first attack roll is SUCCESSFUL",
            sourceText:
              "If the first attack roll is SUCCESSFUL, the second attack roll gains +2 to the result",
          },
          {
            priorSuccessfulDice: [1, 2],
            dieIndex: 3,
            bonus: 3,
            conditionText: "If the first two attacks rolls are SUCCESSFUL",
            sourceText:
              "If the first two attacks rolls are SUCCESSFUL, the third attack roll gains +3 to the result",
          },
          {
            priorSuccessfulDice: [1, 2, 3],
            dieIndex: 4,
            bonus: 4,
            conditionText: "If the first three attack rolls are SUCCESSFUL",
            sourceText:
              "If the first three attack rolls are SUCCESSFUL, the fourth attack roll gains +4 to the result",
          },
          {
            priorSuccessfulDice: [1, 2, 3, 4],
            dieIndex: 5,
            bonus: 5,
            conditionText: "If the first four attack rolls are SUCCESSFUL",
            sourceText:
              "If the first four attack rolls are SUCCESSFUL, the fifth attack roll gains +5 to the result",
          },
        ] as const
      ).map(({ priorSuccessfulDice, dieIndex, bonus, conditionText, sourceText }) => ({
        trigger: "on-roll-result" as const,
        target: "self" as const,
        type: "modify-roll" as const,
        roll: "attack" as const,
        modifier: "result" as const,
        amount: { type: "literal" as const, value: bonus },
        dieIndex,
        conditions: priorSuccessfulDice.map((index) => ({
          type: "roll-die-result" as const,
          roll: "attack" as const,
          index,
          result: "successful" as const,
          sourceText: conditionText,
        })),
        sourceText,
      })),
      {
        trigger: "before-defense-roll",
        target: "interferers",
        type: "grant-defense-response",
        roll: "defense",
        againstAttackDieIndex: 1,
        sourceText:
          "If anyone has interfered during this combat, you may choose for them to roll a defense roll against the first die, as well",
      },
    ],
  ],
  [
    "move-afterlife-instant-transmission",
    [
      {
        trigger: "out-of-combat",
        target: "self",
        type: "travel",
        destination: "another-planet",
        frequency: {
          maximumUses: 1,
          period: "week",
          prohibitConsecutivePeriods: true,
        },
        exception: {
          condition: "current-planet-destroyed",
          sourceText:
            "In the event that the planet you are on is destroyed, you may use Instant Transmission to take you to another planet (regardless if you used it the week before)",
        },
        sourceText:
          "Once per week, you can Instant Transmission yourself to another planet. You cannot use Instant Transmission to teleport you to another planet 2 weeks in a row. In the event that the planet you are on is destroyed, you may use Instant Transmission to take you to another planet (regardless if you used it the week before)",
      },
    ],
  ],
  [
    "move-afterlife-body-change",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "swap-combatant-state",
        fields: ["moveset", "items", "hp", "ki"],
        revertWhen: "either-player-dies-or-escapes",
        defeatBasis: "player",
        sourceText:
          "SUCCESSFUL - Switch bodies with your opponent. Both participants will have to use the Battle page of the opponent they switched bodies with, including current moveset and items. Both participants inherit their opponent's HP and KI amounts at the time Body Change was completed. When one player dies or flees, both characters switch bodies back to their old bodies. Death/Escape in this method are determined by Player, not by character",
      },
    ],
  ],
  [
    "move-afterlife-guldo-special",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "grant-combat-outcome",
        outcome: "break",
        conditions: [
          {
            type: "prior-turn-restriction",
            subject: "opponent",
            anyOf: ["attack-use", "power-up", "turn-skipped"],
            sourceText:
              "If your opponent was prevented from using an attack on their last turn, prevented from Powering Up on their last turn, or if their turn was skipped",
          },
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 20 },
            sourceText: "If your attack roll is 20 or higher, BREAK",
          },
        ],
        sourceText:
          'If your opponent was prevented from using an attack on their last turn, prevented from Powering Up on their last turn, or if their turn was skipped, this attack gains "SUCCESSFUL - If your attack roll is 20 or higher, BREAK. If your attack roll is 28 or higher, SEVER"',
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "grant-combat-outcome",
        outcome: "sever",
        conditions: [
          {
            type: "prior-turn-restriction",
            subject: "opponent",
            anyOf: ["attack-use", "power-up", "turn-skipped"],
            sourceText:
              "If your opponent was prevented from using an attack on their last turn, prevented from Powering Up on their last turn, or if their turn was skipped",
          },
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 28 },
            sourceText: "If your attack roll is 28 or higher, SEVER",
          },
        ],
        sourceText:
          'If your opponent was prevented from using an attack on their last turn, prevented from Powering Up on their last turn, or if their turn was skipped, this attack gains "SUCCESSFUL - If your attack roll is 20 or higher, BREAK. If your attack roll is 28 or higher, SEVER"',
      },
    ],
  ],
  [
    "move-afterlife-teamwork-kamehameha",
    [
      {
        trigger: "action-phase",
        target: "ally",
        type: "join-attack",
        participants: { eligibility: "ally-in-combat", maximum: 1 },
        attackRoll: { dice: 1, sides: 40 },
        eachParticipantPaysCost: true,
        exclusiveActivationGroup: "teamwork-kamehameha-participants",
        sourceText: TEAMWORK_KAMEHAMEHA_SOURCE,
      },
      {
        trigger: "action-phase",
        target: "remote-target",
        type: "join-attack",
        participants: {
          eligibility: "same-planet-move-owner",
          maximum: 2,
          duration: "one-turn",
        },
        attackRoll: { dice: 1, sides: 40 },
        eachParticipantPaysCost: true,
        exclusiveActivationGroup: "teamwork-kamehameha-participants",
        sourceText: TEAMWORK_KAMEHAMEHA_SOURCE,
      },
    ],
  ],
  [
    "move-afterlife-death-ball",
    [
      {
        trigger: "action-phase",
        target: "self",
        type: "defer-move",
        move: "source",
        performAfterTurns: 1,
        damage: { operation: "set", percent: { type: "literal", value: 170 } },
        cancellation: {
          actor: "opponent",
          result: "successful",
          sourceText:
            "If your opponent performs a successful attack against you before this move is performed, the Death Ball is not completed and you may not use it",
        },
        sourceText:
          "You may choose to not perform this attack on this turn and to have this attack do (170% Power) Damage instead. If your opponent performs a successful attack against you before this move is performed, the Death Ball is not completed and you may not use it",
      },
      {
        trigger: "before-attack-roll",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "sides",
        amount: { type: "literal", value: 3 },
        cap: { type: "allow-exceed", sourceText: "You may exceed the standard dice side cap" },
        conditions: [
          {
            type: "location",
            subject: "self",
            state: "planet-has-dragon-balls",
            sourceText: "if you are on a planet that has Dragon Balls",
          },
        ],
        sourceText:
          "This attack gains +3 dice sides if you are on a planet that has Dragon Balls. You may exceed the standard dice side cap with this effect",
      },
    ],
  ],
  [
    "move-afterlife-galick-gun",
    [
      {
        trigger: "before-attack-roll",
        target: "self",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: -1 },
        conditions: [
          {
            type: "stat-comparison",
            left: "self",
            stat: "power",
            comparison: "higher-than",
            right: "opponent",
            rightStat: "power",
            sourceText: "If your Power is higher than your opponent's power",
          },
        ],
        sourceText: "If your Power is higher than your opponent's power, this attack costs -1 KI",
      },
      {
        trigger: "before-defense-roll",
        target: "self",
        type: "remove-move-from-combat",
        move: "source",
        selector: {
          type: "move-selector",
          subject: "source",
          ids: ["move-afterlife-galick-gun"],
          sourceText: "forget this move",
        },
        activationCost: {
          resource: "ki",
          operation: "lose",
          amount: { type: "source-move-ki-cost" },
        },
        conditions: [
          {
            type: "move-selector",
            subject: "target",
            category: "advanced-attack",
            categoryExcludes: ["signature"],
            tags: ["beam"],
            sourceText: "a Beam-type attack that is not a Signature Technique",
          },
        ],
        activationGroup: "galick-gun-sacrifice-response",
        sourceText: GALICK_GUN_RESPONSE_SOURCE,
      },
      {
        trigger: "before-defense-roll",
        target: "opponent",
        type: "negate",
        aspects: ["prevent-damage"],
        conditions: [
          {
            type: "move-selector",
            subject: "target",
            category: "advanced-attack",
            categoryExcludes: ["signature"],
            tags: ["beam"],
            sourceText: "a Beam-type attack that is not a Signature Technique",
          },
        ],
        activationGroup: "galick-gun-sacrifice-response",
        sourceText: GALICK_GUN_RESPONSE_SOURCE,
      },
      {
        trigger: "before-defense-roll",
        target: "opponent",
        type: "lock",
        affectedType: "attack",
        selector: {
          type: "move-selector",
          subject: "target",
          category: "advanced-attack",
          categoryExcludes: ["signature"],
          tags: ["beam"],
          sourceText: "that attack",
        },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 4 },
          sourceText: "for your opponent's next 4 turns",
        },
        activationGroup: "galick-gun-sacrifice-response",
        sourceText: GALICK_GUN_RESPONSE_SOURCE,
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-roll",
        roll: "defense",
        modifier: "result",
        amount: { type: "literal", value: -2 },
        selector: {
          type: "move-selector",
          subject: "source",
          tags: ["physical"],
          sourceText: "your physical attacks",
        },
        duration: {
          type: "until-combat-result",
          actor: "opponent",
          result: "successful",
          sourceText: "until they perform a SUCCESSFUL attack",
        },
        sourceText:
          "SUCCESSFUL - Your opponent's defensive rolls gain -2 against your physical attacks until they perform a SUCCESSFUL attack",
      },
    ],
  ],
  [
    "move-afterlife-warp-kamehameha",
    [
      {
        trigger: "action-phase",
        target: "self",
        type: "defer-move",
        move: "source",
        performAfterTurns: 1,
        cancellation: {
          actor: "opponent",
          result: "successful",
          sourceText: "If their attack against you is SUCCESSFUL, Instant Transmission fails",
        },
        onCancellation: {
          type: "lock",
          affectedType: "attack",
          duration: {
            type: "combat",
            sourceText: "LOCK Warp Kamehameha for the remainder of combat",
          },
        },
        sourceText: WARP_KAMEHAMEHA_SOURCE,
      },
      {
        trigger: "action-phase",
        target: "opponent",
        type: "force-action",
        allowedCategories: ["advanced-attack", "signature"],
        allowPass: true,
        scope: { type: "next-turn", subject: "opponent", sourceText: "on their next turn" },
        sourceText: "Your opponent must attack on their next turn or pass",
      },
      {
        trigger: "before-defense-roll",
        target: "self",
        type: "set-roll-definition",
        roll: "defense",
        dice: 1,
        sides: 50,
        scope: {
          type: "next-roll",
          roll: "defense",
          sourceText: "Defense roll: 1d50 for that turn",
        },
        sourceText: "Defense roll: 1d50 for that turn",
      },
    ],
  ],
  [
    "move-afterlife-solar-flare",
    [
      {
        trigger: "upkeep-phase",
        target: "self",
        type: "roll-and-store",
        dice: 1,
        sides: 30,
        storageKey: "solar-flare-roll",
        sourceText: "Timing: UPKEEP phase. Roll 1d30",
      },
      {
        trigger: "on-roll-result",
        target: "opponent",
        type: "apply-status",
        statusId: "stun",
        conditions: [
          {
            type: "stored-roll-threshold",
            storageKey: "solar-flare-roll",
            comparison: "at-least",
            value: { type: "literal", value: 15 },
            sourceText: "If your roll is 15 or higher, STUN",
          },
        ],
        sourceText: "If your roll is 15 or higher, STUN",
      },
      {
        trigger: "upkeep-phase",
        target: "self",
        type: "create-floating-effect",
        floatingEffectId: "solar-flare-same-turn-single-die-follow-up",
        scope: { type: "next-action", sourceText: "another single dice attack on this turn" },
        effects: [
          {
            trigger: "before-attack-roll",
            target: "self",
            type: "set-roll-definition",
            roll: "attack",
            dice: 1,
            sides: 35,
            conditions: [
              {
                type: "move-selector",
                subject: "source",
                attackRoll: { dice: 1 },
                sourceText: "another single dice attack on this turn",
              },
              {
                type: "target-relation",
                subject: "source",
                relation: "same-as-source-effect-target",
                sourceText: "attack the same opponent",
              },
            ],
            sourceText: "your attack roll is 1d35",
          },
          {
            trigger: "before-defense-roll",
            target: "opponent",
            type: "set-roll-definition",
            roll: "defense",
            dice: 1,
            sides: 25,
            conditions: [
              {
                type: "move-selector",
                subject: "source",
                attackRoll: { dice: 1 },
                sourceText: "another single dice attack on this turn",
              },
              {
                type: "target-relation",
                subject: "source",
                relation: "same-as-source-effect-target",
                sourceText: "attack the same opponent",
              },
            ],
            sourceText: "their defensive roll is 1d25",
          },
        ],
        sourceText:
          "If you attack the same opponent with another single dice attack on this turn, your attack roll is 1d35 and their defensive roll is 1d25",
      },
      {
        trigger: "upkeep-phase",
        target: "self",
        type: "create-floating-effect",
        floatingEffectId: "solar-flare-next-turn-single-die-follow-up",
        scope: { type: "next-turn", subject: "self", sourceText: "On your next turn" },
        effects: [
          {
            trigger: "before-attack-roll",
            target: "self",
            type: "set-roll-definition",
            roll: "attack",
            dice: 1,
            sides: 32,
            conditions: [
              {
                type: "move-selector",
                subject: "source",
                attackRoll: { dice: 1 },
                sourceText: "if you attack with a single dice attack",
              },
            ],
            sourceText: "your attack roll is 1d32",
          },
          {
            trigger: "before-defense-roll",
            target: "opponent",
            type: "set-roll-definition",
            roll: "defense",
            dice: 1,
            sides: 28,
            conditions: [
              {
                type: "move-selector",
                subject: "source",
                attackRoll: { dice: 1 },
                sourceText: "if you attack with a single dice attack",
              },
            ],
            sourceText: "their defensive roll is 1d28",
          },
        ],
        sourceText:
          "On your next turn, if you attack with a single dice attack, your attack roll is 1d32 and their defensive roll is 1d28",
      },
      {
        trigger: "upkeep-phase",
        target: "self",
        type: "lock",
        affectedType: "skill",
        selector: {
          type: "move-selector",
          subject: "source",
          ids: ["move-afterlife-solar-flare"],
          sourceText: "this Skill",
        },
        duration: { type: "combat", sourceText: "LOCK this Skill for the remainder of combat" },
        sourceText: "LOCK this Skill for the remainder of combat",
      },
    ],
  ],
  [
    "move-afterlife-petrifying-spit",
    [
      {
        trigger: "action-phase",
        target: "self",
        type: "roll-and-store",
        dice: 1,
        sides: 30,
        storageKey: "petrifying-spit-roll",
        sourceText: PETRIFYING_SPIT_SOURCE,
      },
      {
        trigger: "on-roll-result",
        target: "opponent",
        type: "apply-status",
        statusId: "petrified",
        duration: {
          type: "until-turn-start-roll-threshold",
          subject: "opponent",
          dice: 1,
          sides: 30,
          comparison: "at-least",
          value: { type: "literal", value: 15 },
          startAfterTurns: 1,
          sourceText: PETRIFYING_SPIT_SOURCE,
        },
        conditions: [
          {
            type: "stored-roll-threshold",
            storageKey: "petrifying-spit-roll",
            comparison: "at-least",
            value: { type: "literal", value: 15 },
            sourceText: "If the result of your dice roll is 15 or higher",
          },
        ],
        sourceText: PETRIFYING_SPIT_SOURCE,
      },
      {
        trigger: "on-roll-result",
        target: "opponent",
        type: "skip-action",
        scope: { type: "next-turn", subject: "opponent", sourceText: "must skip their next turn" },
        conditions: [
          {
            type: "stored-roll-threshold",
            storageKey: "petrifying-spit-roll",
            comparison: "at-least",
            value: { type: "literal", value: 15 },
            sourceText: "If the result of your dice roll is 15 or higher",
          },
        ],
        sourceText: PETRIFYING_SPIT_SOURCE,
      },
      {
        trigger: "turn-end",
        target: "opponent",
        type: "skip-action",
        duration: {
          type: "until-turn-start-roll-threshold",
          subject: "opponent",
          dice: 1,
          sides: 30,
          comparison: "at-least",
          value: { type: "literal", value: 15 },
          startAfterTurns: 1,
          sourceText: PETRIFYING_SPIT_SOURCE,
        },
        conditions: [
          {
            type: "status",
            subject: "opponent",
            statusId: "petrified",
            state: "active",
            sourceText: "your opponent is turned to stone",
          },
        ],
        sourceText: PETRIFYING_SPIT_SOURCE,
      },
      {
        trigger: "action-phase",
        target: "self",
        type: "grant-extra-action",
        phase: "action-phase",
        conditions: [
          {
            type: "moveset",
            subject: "self",
            excludesIds: ["move-afterlife-time-freeze"],
            sourceText: "If you do not have Time Freeze in your moveset",
          },
        ],
        sourceText: PETRIFYING_SPIT_SOURCE,
      },
    ],
  ],
]);

export const AFTERLIFE_MOVES: readonly MoveDefinition[] = createMovesForSource({
  sourcePath: "reference/moves/afterlife.md",
}).map((move) => ({
  ...move,
  ...(structuredEffectsByMoveId.has(move.id)
    ? { effects: structuredEffectsByMoveId.get(move.id) }
    : {}),
}));
