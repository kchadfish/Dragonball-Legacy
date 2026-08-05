import { AKAIKARU_STYLE } from "../styles/akaikaru.js";
import { createStyleMoves } from "./create-style-moves.js";
import type { EffectDefinition } from "../shared/effects.js";
import type { MoveDefinition } from "../shared/types.js";

const structuredEffectsByMoveId = new Map<string, readonly EffectDefinition[]>([
  [
    "move-akaikaru-fury-strikes",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: -1 },
        scope: {
          type: "next-resource-gain",
          resource: "ki",
          subject: "opponent",
          sourceText: "The next time your opponent gains KI",
        },
        sourceText: "SUCCESSFUL - The next time your opponent gains KI, they gain 1 less KI",
      },
    ],
  ],
  [
    "move-akaikaru-intensity-mastery",
    [
      {
        trigger: "start-combat",
        target: "self",
        type: "modify-move-classification",
        setStyleId: "style-akaikaru",
        selector: {
          type: "move-selector",
          subject: "source",
          styleId: "style-freestyle",
          category: "advanced-attack",
          sourceText: "a single Freestyle Advanced Attack",
        },
        sourceText:
          "At the start of each match, you may choose a single Freestyle Advanced Attack to be counted as an Akaikaru attack",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "prevent-resolution",
        prevention: "block",
        scope: { type: "next-action", sourceText: "your next single-dice Akaikaru attack" },
        selector: {
          type: "move-selector",
          subject: "source",
          styleId: "style-akaikaru",
          attackRoll: { dice: 1 },
          sourceText: "your next single-dice Akaikaru attack",
        },
        conditions: [
          {
            type: "combat-result",
            actor: "opponent",
            result: "successful",
            sourceText:
              "Whenever your opponent performs a SUCCESSFUL Advanced Attack against you with a base cost of 2 or more",
          },
          {
            type: "move-selector",
            subject: "target",
            category: "advanced-attack",
            baseKiCost: { comparison: "at-least", value: { type: "literal", value: 2 } },
            sourceText:
              "Whenever your opponent performs a SUCCESSFUL Advanced Attack against you with a base cost of 2 or more",
          },
        ],
        sourceText:
          'Whenever your opponent performs a SUCCESSFUL Advanced Attack against you with a base cost of 2 or more, your next single-dice Akaikaru attack gains "This attack cannot be Blocked. SUCCESSFUL - If your attack roll result is 15 or higher, STUN."',
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "apply-status",
        statusId: "stun",
        scope: { type: "next-action", sourceText: "your next single-dice Akaikaru attack" },
        conditions: [
          {
            type: "combat-result",
            actor: "opponent",
            result: "successful",
            sourceText:
              "Whenever your opponent performs a SUCCESSFUL Advanced Attack against you with a base cost of 2 or more",
          },
          {
            type: "move-selector",
            subject: "target",
            category: "advanced-attack",
            baseKiCost: { comparison: "at-least", value: { type: "literal", value: 2 } },
            sourceText:
              "Whenever your opponent performs a SUCCESSFUL Advanced Attack against you with a base cost of 2 or more",
          },
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 15 },
            sourceText: "If your attack roll result is 15 or higher",
          },
        ],
        sourceText:
          'Whenever your opponent performs a SUCCESSFUL Advanced Attack against you with a base cost of 2 or more, your next single-dice Akaikaru attack gains "This attack cannot be Blocked. SUCCESSFUL - If your attack roll result is 15 or higher, STUN."',
      },
    ],
  ],
  [
    "move-akaikaru-spinebreaker",
    [
      {
        trigger: "passive",
        target: "self",
        type: "prevent-move-modification",
        selector: {
          type: "move-selector",
          subject: "source",
          ids: ["move-akaikaru-spinebreaker"],
          sourceText: "The cost of this attack",
        },
        aspects: ["cost"],
        actor: "any",
        sourceText: "The cost of this attack cannot be reduced",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "apply-status",
        statusId: "stun",
        activationCost: {
          resource: "ki",
          amount: { type: "prior-move-ki-cost", actor: "opponent", addition: 1 },
          operation: "lose",
        },
        exclusiveActivationGroup: "spinebreaker-success-choice",
        sourceText:
          "SUCCESSFUL - You may pay the cost of your opponent's last attack +1. If you do, STUN",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-roll",
        roll: "transformation",
        modifier: "result",
        amount: { type: "literal", value: -3 },
        scope: {
          type: "next-phase",
          subject: "opponent",
          phase: "end",
          sourceText: "during the END phase of this turn",
        },
        exclusiveActivationGroup: "spinebreaker-success-choice",
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 25 },
            sourceText: "If your attack roll is 25 or higher",
          },
        ],
        sourceText:
          "If your attack roll is 25 or higher, you may instead choose to have your opponent roll a Transformation roll during the END phase of this turn, with -3 to the result",
      },
    ],
  ],
  [
    "move-akaikaru-naginata",
    [
      {
        trigger: "passive",
        target: "self",
        type: "set-roll-definition",
        roll: "attack",
        dice: 1,
        sides: 35,
        conditions: [
          {
            type: "paid-ki-cost",
            subject: "self",
            comparison: "at-least",
            value: { type: "literal", value: 3 },
            sourceText: "if you spent 3 or more KI on this attack",
          },
        ],
        sourceText:
          "Your attack roll for this attack is 1d35 if you spent 3 or more KI on this attack",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "modify-stat",
        stat: "dexterity-bonus",
        operation: "multiply",
        amount: { type: "literal", value: 2 },
        scope: { type: "next-action", sourceText: "your next Akaikaru Advanced Attack" },
        selector: {
          type: "move-selector",
          subject: "source",
          styleId: "style-akaikaru",
          category: "advanced-attack",
          sourceText: "your next Akaikaru Advanced Attack",
        },
        sourceText:
          "SUCCESSFUL - Your Dexterity Bonus is doubled on your next Akaikaru Advanced Attack and your next defense roll",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "modify-stat",
        stat: "dexterity-bonus",
        operation: "multiply",
        amount: { type: "literal", value: 2 },
        scope: { type: "next-roll", roll: "defense", sourceText: "your next defense roll" },
        sourceText:
          "SUCCESSFUL - Your Dexterity Bonus is doubled on your next Akaikaru Advanced Attack and your next defense roll",
      },
    ],
  ],
  [
    "move-akaikaru-dazzling-gymnastics",
    [
      {
        trigger: "on-stopped",
        target: "opponent",
        type: "set-combat-result",
        result: "stopped",
        resultScope: "matching-die",
        conditions: [
          {
            type: "move-selector",
            subject: "target",
            attackRoll: { minimumDice: 2 },
            sourceText: "multi-dice attacks",
          },
        ],
        sourceText: "This STOPS all dice of multi-dice attacks",
      },
      {
        trigger: "on-stopped",
        target: "self",
        type: "modify-stat",
        stat: "dexterity-bonus",
        operation: "add",
        amount: { type: "literal", value: 1 },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 3 },
          sourceText: "for the next 3 turns",
        },
        sourceText: "Your Dexterity Bonus is considered to be 1 higher for the next 3 turns",
      },
    ],
  ],
  [
    "move-akaikaru-blitzkrieg",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-move-classification",
        addTags: ["ENERGY"],
        scope: { type: "current-action", sourceText: "This attack" },
        sourceText: "This attack also counts as an energy attack for all effects",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "modify-stat",
        stat: "dexterity-bonus",
        operation: "add",
        amount: { type: "literal", value: 2 },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 3 },
          sourceText: "for three turns",
        },
        conditions: [
          {
            type: "successful-hit-count",
            comparison: "exactly",
            value: { type: "literal", value: 2 },
            sourceText: "If two dice are SUCCESSFUL",
          },
        ],
        sourceText:
          "SUCCESSFUL - If two dice are SUCCESSFUL, your Dexterity bonus increases by 2 for three turns",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "modify-stat",
        stat: "dexterity-bonus",
        operation: "add",
        amount: { type: "literal", value: 3 },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 4 },
          sourceText: "for four turns instead",
        },
        conditions: [
          {
            type: "successful-hit-count",
            comparison: "exactly",
            value: { type: "literal", value: 3 },
            sourceText: "If three dice are SUCCESSFUL",
          },
        ],
        sourceText:
          "SUCCESSFUL - If two dice are SUCCESSFUL, your Dexterity bonus increases by 2 for three turns. If three dice are SUCCESSFUL, your Dexterity bonus increases by 3 for four turns instead",
      },
    ],
  ],
  [
    "move-akaikaru-no-shadow-kick",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-move-classification",
        addTags: ["PUNCH"],
        scope: { type: "current-action", sourceText: "This attack" },
        sourceText: "This attack also counts as a Punch-type attack for all effects",
      },
    ],
  ],
  [
    "move-akaikaru-stampede-rush",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "literal", value: 10 },
        scope: { type: "current-action", sourceText: "this attack" },
        conditions: [
          {
            type: "stat-comparison",
            left: "self",
            stat: "dexterity-bonus",
            comparison: "at-least",
            value: { type: "literal", value: 2 },
            sourceText: "If your Dexterity bonus is +2 or higher",
          },
        ],
        sourceText:
          "If your Dexterity bonus is +2 or higher, this attack does +(10%) Power Damage per hit",
      },
    ],
  ],
  [
    "move-akaikaru-sniping-shot",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "apply-status",
        statusId: "cooldown",
        selector: {
          type: "move-selector",
          subject: "source",
          ids: ["move-akaikaru-sniping-shot"],
          sourceText: "COOLDOWN 1",
        },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 1 },
          sourceText: "COOLDOWN 1",
        },
        sourceText: "SUCCESSFUL - COOLDOWN 1",
      },
    ],
  ],
  [
    "move-akaikaru-scorched-earth",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "lock",
        affectedType: "escape",
        duration: { type: "combat", sourceText: "for the remainder of the match" },
        sourceText: "SUCCESSFUL - Your opponents cannot escape for the remainder of the match",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "modify-cost",
        operation: "set",
        amount: { type: "literal", value: 0 },
        selector: {
          type: "move-selector",
          subject: "target",
          category: "advanced-attack",
          effectTextIncludes: "STUN",
          sourceText: "next Advanced Attack with STUN in the effect",
        },
        scope: { type: "next-action", sourceText: "next Advanced Attack with STUN in the effect" },
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 25 },
            sourceText: "If your attack roll result is 25 or higher",
          },
        ],
        sourceText:
          "If your attack roll result is 25 or higher, your next Advanced Attack with STUN in the effect costs 0 KI (regardless of any other effects)",
      },
    ],
  ],
  [
    "move-akaikaru-dexterous-glaive",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "sides",
        amount: { type: "literal", value: 2 },
        selector: {
          type: "move-selector",
          subject: "target",
          category: "advanced-attack",
          tags: ["physical"],
          attackRoll: { dice: 1 },
          sourceText: "next single dice physical Advanced Attack",
        },
        scope: {
          type: "next-action",
          sourceText: "next single dice physical Advanced Attack",
        },
        conditions: [
          {
            type: "successful-hit-count",
            comparison: "exactly",
            value: { type: "literal", value: 2 },
            sourceText: "If both rolls are SUCCESSFUL",
          },
        ],
        sourceText:
          "If both rolls are SUCCESSFUL, your next single dice physical Advanced Attack gains +2 sides",
      },
    ],
  ],
  [
    "move-akaikaru-pressure-cooker",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "stat-percent", subject: "self", stat: "power", percent: 20 },
        scope: { type: "current-action", sourceText: "this attack" },
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
          "If your Dexterity is higher than your opponent's, this attack does +(20% Power) Damage",
      },
    ],
  ],
  [
    "move-akaikaru-hypersonic-knockout",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "apply-status",
        statusId: "stun",
        sourceText: "SUCCESSFUL - STUN",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "apply-status",
        statusId: "stun",
        conditions: [
          {
            type: "stat-comparison",
            left: "self",
            stat: "dexterity-bonus",
            comparison: "higher-than",
            right: "opponent",
            sourceText: "If your Dexterity bonus is higher than your opponent's",
          },
        ],
        sourceText: "If your Dexterity bonus is higher than your opponent's, STUNx2 instead",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "apply-status",
        statusId: "stun",
        conditions: [
          {
            type: "roll-comparison",
            left: "attack",
            comparison: "at-least",
            right: "defense",
            rightMultiplier: { type: "literal", value: 2 },
            sourceText: "If your attack roll was at least double your opponent's defense roll",
          },
        ],
        sourceText:
          "If your attack roll was at least double your opponent's defense roll , increase the STUN amount by +1",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "apply-status",
        statusId: "stun",
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 28 },
            sourceText: "If your attack roll result was 28 or higher",
          },
        ],
        sourceText: "If your attack roll result was 28 or higher, increase the STUN amount by +1",
      },
    ],
  ],
  [
    "move-akaikaru-buzzsaw-kick",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: 4 },
        selector: {
          type: "move-selector",
          subject: "target",
          styleId: "style-akaikaru",
          category: "advanced-attack",
          effectTextExcludes: "STUN",
          sourceText: "next Akaikaru Advanced Attack roll without a STUN effect",
        },
        scope: {
          type: "next-action",
          sourceText: "next Akaikaru Advanced Attack roll without a STUN effect",
        },
        sourceText:
          "SUCCESSFUL - Your next Akaikaru Advanced Attack roll without a STUN effect gains +4 to the results",
      },
    ],
  ],
  [
    "move-akaikaru-bullrush",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "set-roll-selection",
        roll: "attack",
        diceCount: { type: "literal", value: 2 },
        selection: "highest",
        selector: {
          type: "move-selector",
          subject: "target",
          styleId: "style-akaikaru",
          category: "advanced-attack",
          restriction: "unrestricted",
          attackRoll: { dice: 1 },
          effectTextIncludes: "STUN",
          sourceText:
            "next UNRESTRICTED single-dice Akaikaru Advanced Attack with 'STUN' in the effect",
        },
        scope: {
          type: "next-roll",
          roll: "attack",
          sourceText:
            "next UNRESTRICTED single-dice Akaikaru Advanced Attack with 'STUN' in the effect",
        },
        conditions: [
          {
            type: "successful-hit-count",
            comparison: "exactly",
            value: { type: "literal", value: 2 },
            sourceText: "If both attack rolls are SUCCESSFUL",
          },
        ],
        sourceText:
          "SUCCESSFUL - If both attack rolls are SUCCESSFUL, your next UNRESTRICTED single-dice Akaikaru Advanced Attack with 'STUN' in the effect gains ADVANTAGE",
      },
    ],
  ],
  [
    "move-akaikaru-lord-of-the-flies",
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
            value: { type: "literal", value: 5 },
            sourceText: "If 5 or more dice rolls are SUCCESSFUL",
          },
        ],
        sourceText: "If 5 or more dice rolls are SUCCESSFUL, STUN",
      },
    ],
  ],
  [
    "move-akaikaru-adrenaline-rush-mastery",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: -1 },
        minimum: { type: "literal", value: 1 },
        scope: {
          type: "next-actions",
          count: { type: "literal", value: 2 },
          sourceText: "your next 2 attacks",
        },
        conditions: [
          {
            type: "combat-result",
            actor: "self",
            result: "critical",
            sourceText: "If you CRITICAL against your opponent",
          },
        ],
        sourceText:
          "If you CRITICAL against your opponent, your next 2 attacks cost -1, to a minimum of 1",
      },
    ],
  ],
  [
    "move-akaikaru-blazing-speed-mastery",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "sides",
        amount: { type: "literal", value: 2 },
        sourceText: "Your attack rolls gain +2 dice sides",
      },
    ],
  ],
  [
    "move-akaikaru-berserker-mastery",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "apply-status",
        statusId: "stun",
        conditions: [
          {
            type: "action-sequence",
            actor: "self",
            result: "successful",
            count: 2,
            sourceText:
              "After you perform two SUCCESSFUL single dice Akaikaru attacks on different turns in a row",
          },
          {
            type: "move-selector",
            subject: "source",
            styleId: AKAIKARU_STYLE.id,
            category: "advanced-attack",
            attackRoll: { dice: 1 },
            sourceText: "single dice Akaikaru attacks",
          },
        ],
        activationCost: {
          resource: "ki",
          operation: "lose",
          amount: { type: "literal", value: 2 },
        },
        sourceText:
          "After you perform two SUCCESSFUL single dice Akaikaru attacks on different turns in a row, you may lose 2 KI to STUN",
      },
      {
        trigger: "passive",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "stat-percent", subject: "self", stat: "power", percent: 5 },
        selector: {
          type: "move-selector",
          subject: "target",
          effectTextIncludes: "STUN",
          sourceText: "Your attacks with STUN in the effect",
        },
        sourceText: "Your attacks with STUN in the effect do +(5% Power) damage",
      },
      {
        trigger: "passive",
        target: "self",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: -1 },
        minimum: { type: "literal", value: 1 },
        selector: {
          type: "move-selector",
          subject: "target",
          styleId: AKAIKARU_STYLE.id,
          effectTextIncludes: "STUN",
          sourceText: "Your Akaikaru attacks with STUN in the effect",
        },
        sourceText:
          "Your Akaikaru attacks with STUN in the effect cost -1 KI to perform, to a minimum of 1",
      },
    ],
  ],
  [
    "move-akaikaru-follow-up",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "copy-move-effect",
        sourceMove: {
          type: "selected-move",
          actor: "self",
          category: "advanced-attack",
          restriction: "unrestricted",
          styleId: AKAIKARU_STYLE.id,
        },
        effectResult: "successful",
        resolveAs: "source-move",
        damage: { type: "half-base-damage-per-die", sourceMove: "last-advanced-attack" },
        cost: { type: "selected-move-base-cost" },
        duration: { type: "combat", sourceText: "for the remainder of the match" },
        sourceText:
          "At the start of the match, choose one of your unrestricted Akaikaru Advanced Attacks. Follow Up now has the SUCCESSFUL effect of that chosen attack for the remainder of the match",
      },
    ],
  ],
  [
    "move-akaikaru-chained-strikes",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "grant-extra-action",
        phase: "action-phase",
        moveCategory: "advanced-attack",
        move: "source",
        scope: { type: "current-action", sourceText: "this turn" },
        useLimit: {
          scope: "turn",
          count: 1,
          sourceText: "You cannot use this effect more than once per turn",
        },
        sourceText:
          "SUCCESSFUL - You may use this attack again in the ACTION phase this turn. You cannot use this effect more than once per turn",
      },
    ],
  ],
  [
    "move-akaikaru-firestorm",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "sides",
        amount: { type: "literal", value: 4 },
        scope: { type: "next-action", sourceText: "Your next physical attack" },
        conditions: [
          {
            type: "move-selector",
            subject: "target",
            category: "advanced-attack",
            tags: ["physical"],
            sourceText: "Your next physical attack",
          },
        ],
        sourceText: "SUCCESSFUL - Your next physical attack gains +4 dice sides",
      },
    ],
  ],
  [
    "move-akaikaru-back-brain-kick",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "deactivate",
        affectedType: "skill",
        conditions: [
          {
            type: "move-selector",
            subject: "target",
            category: "skill",
            constant: true,
            sourceText: "a Skill with a 'CONSTANT' effect",
          },
        ],
        sourceText: "SUCCESSFUL - DEACTIVATE a Skill with a 'CONSTANT' effect",
      },
    ],
  ],
  [
    "move-akaikaru-blown-fuse",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: -1 },
        selector: {
          type: "move-selector",
          subject: "target",
          category: "skill",
          sourceText: "Skills",
        },
        scope: {
          type: "next-actions",
          count: { type: "literal", value: 2 },
          sourceText: "Your next 2 Skills",
        },
        sourceText: "SUCCESSFUL - Your next 2 Skills cost -1 KI",
      },
    ],
  ],
  [
    "move-akaikaru-continuous-knee-smash",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "lock",
        affectedType: "power-up",
        duration: { type: "turns", turns: { type: "literal", value: 1 }, sourceText: "next turn" },
        sourceText: "SUCCESSFUL - Your opponent cannot Power Up on their next turn",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "schedule-effect",
        timing: { type: "phase-start", phase: "upkeep", subject: "opponent", turnsAfter: 1 },
        effect: {
          type: "modify-resource",
          resource: "hp",
          operation: "lose",
          amount: { type: "stat-percent", subject: "self", stat: "power", percent: 5 },
        },
        sourceText:
          "SUCCESSFUL - Your opponent cannot Power Up on their next turn. Your opponent loses (5% Power) HP during their next UPKEEP phase",
      },
    ],
  ],
  [
    "move-akaikaru-torpedo-kick",
    [
      {
        trigger: "on-success",
        target: "participants",
        type: "lock",
        affectedType: "block",
        selector: {
          type: "move-selector",
          subject: "target",
          category: "block",
          sourceText: "Choose a Block",
        },
        duration: {
          type: "until-roll-threshold",
          roll: "attack",
          comparison: "at-most",
          value: { type: "literal", value: 5 },
          sourceText: "until you roll an attack roll result of 5 or less",
        },
        stacking: "prevent",
        sourceText:
          "SUCCESSFUL - Choose a Block. LOCK that Block for all participants until you roll an attack roll result of 5 or less. This effect may not affect more than one Block at a time",
      },
    ],
  ],
  [
    "move-akaikaru-swift-reaction",
    [
      {
        trigger: "after-defense-roll",
        target: "self",
        type: "reroll",
        roll: "attack",
        rerollScope: "entire-attack",
        selector: {
          type: "move-selector",
          subject: "source",
          styleId: AKAIKARU_STYLE.id,
          category: "advanced-attack",
          baseKiCost: { comparison: "at-most", value: { type: "literal", value: 4 } },
          sourceText: "an Akaikaru Advanced Attack with a base cost of 4 or less",
        },
        sourceText:
          "You may re-roll your attack roll on an Akaikaru Advanced Attack with a base cost of 4 or less. You may use this Skill after your opponent has rolled their defensive roll",
      },
    ],
  ],
  [
    "move-akaikaru-speed-demon",
    [
      {
        trigger: "upkeep-phase",
        target: "opponent",
        type: "set-roll-definition",
        roll: "defense",
        dice: 1,
        sides: 30,
        sourceText: "Reset your opponent's defensive dice to 1d30",
      },
      {
        trigger: "upkeep-phase",
        target: "opponent",
        type: "prevent-roll-modification",
        roll: "defense",
        modifier: "any",
        sourceText:
          "Your opponent's defensive roll cannot be modified by their effects or Dexterity",
      },
    ],
  ],
  [
    "move-akaikaru-agile-medley",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-roll-modifier",
        modifier: "any",
        increment: { type: "literal", value: 1 },
        sourceText:
          "SUCCESSFUL - For the remainder of combat, when you increase dice sides or dice results, increase that amount by +1",
      },
    ],
  ],
  [
    "move-akaikaru-flamethrower",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: 2 },
        selector: {
          type: "move-selector",
          subject: "target",
          category: "advanced-attack",
          effectTextIncludes: "STUN",
          sourceText: "next attack with a STUN effect",
        },
        scope: { type: "next-action", sourceText: "next attack with a STUN effect" },
        sourceText: "SUCCESSFUL - Your next attack with a STUN effect gains +2 to the result(s)",
      },
    ],
  ],
  [
    "move-akaikaru-firewall",
    [
      {
        trigger: "on-stopped",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: 1 },
        sourceText: "STOPPED - Gain 1 KI",
      },
    ],
  ],
  [
    "move-akaikaru-volcanic-smash",
    [
      {
        trigger: "before-attack-roll",
        target: "self",
        type: "modify-critical-threshold",
        threshold: { type: "literal", value: 30 },
        basis: "final-result",
        sourceText: "If your attack roll result is 30 or higher, CRITICAL",
      },
    ],
  ],
  [
    "move-akaikaru-windmill-kick",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "grant-extra-action",
        phase: "action-phase",
        moveCategory: "skill",
        conditions: [
          {
            type: "successful-hit-count",
            comparison: "exactly",
            value: { type: "literal", value: 3 },
            sourceText: "If all dice rolls are successful",
          },
        ],
        sourceText: "SUCCESSFUL - If all dice rolls are successful you may activate a skill",
      },
    ],
  ],
  [
    "move-akaikaru-buckshot",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "set-roll-definition",
        roll: "attack",
        dice: 2,
        sides: 30,
        scope: {
          type: "next-action",
          sourceText: "your next single dice Akaikaru Advanced Attack roll",
        },
        conditions: [
          {
            type: "successful-hit-count",
            comparison: "at-least",
            value: { type: "literal", value: 6 },
            sourceText: "If 6 or more dice rolls are SUCCESSFUL",
          },
          {
            type: "move-selector",
            subject: "target",
            styleId: AKAIKARU_STYLE.id,
            category: "advanced-attack",
            attackRoll: { dice: 1 },
            sourceText: "your next single dice Akaikaru Advanced Attack roll",
          },
        ],
        sourceText:
          "SUCCESSFUL - If 6 or more dice rolls are SUCCESSFUL your next single dice Akaikaru Advanced Attack roll is considered 2d30",
      },
    ],
  ],
  [
    "move-akaikaru-machine-gun-kicks",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "apply-status",
        statusId: "stun",
        conditions: [
          {
            type: "successful-hit-count",
            comparison: "exactly",
            value: { type: "literal", value: 4 },
            sourceText: "If 4 dice rolls are successful",
          },
        ],
        sourceText: "SUCCESSFUL - If 4 dice rolls are successful, STUN",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "apply-status",
        statusId: "stun",
        conditions: [
          {
            type: "successful-hit-count",
            comparison: "exactly",
            value: { type: "literal", value: 5 },
            sourceText: "If all 5 dice rolls are SUCCESSFUL",
          },
        ],
        sourceText: "If all 5 dice rolls are SUCCESSFUL, STUNx2",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "apply-status",
        statusId: "stun",
        conditions: [
          {
            type: "successful-hit-count",
            comparison: "exactly",
            value: { type: "literal", value: 5 },
            sourceText: "If all 5 dice rolls are SUCCESSFUL",
          },
        ],
        sourceText: "If all 5 dice rolls are SUCCESSFUL, STUNx2",
      },
    ],
  ],
  [
    "move-akaikaru-prism-inferno",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "schedule-effect",
        timing: { type: "phase-start", phase: "upkeep", subject: "opponent", turnsAfter: 1 },
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
            subject: "target",
            category: "skill",
            sourceText: "until they activate a Skill",
          },
          target: "other-than-source",
        },
        stacking: "prevent",
        sourceText:
          "SUCCESSFUL - Your opponent loses (5% Power) HP during their UPKEEP phase until they activate a Skill. This effect cannot stack with itself",
      },
    ],
  ],
  [
    "move-akaikaru-rolling-thunder",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-resource",
        resource: "hp",
        operation: "lose",
        amount: {
          type: "resource-percent",
          subject: "self",
          resource: "hp",
          basis: "total",
          percent: 5,
        },
        sourceText: "SUCCESSFUL - You lose (5% Total HP) HP",
      },
      {
        trigger: "on-roll-modified",
        target: "self",
        type: "modify-roll-modifier",
        modifier: "any",
        multiplier: { type: "literal", value: 2 },
        scope: { type: "next-roll", roll: "attack", sourceText: "The next time" },
        cap: { type: "allow-exceed", sourceText: "This can exceed the dice cap rule" },
        sourceText:
          "The next time one of your Advanced Attacks effects modify your dice sides and/or results, double the amount. This can exceed the dice cap rule",
      },
    ],
  ],
  [
    "move-akaikaru-jackknife-beam",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "apply-status",
        statusId: "stun",
        sourceText: "SUCCESSFUL - STUN",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-roll",
        roll: "defense",
        modifier: "result",
        amount: { type: "literal", value: -4 },
        scope: { type: "next-turn", subject: "self", sourceText: "on your next turn" },
        sourceText: "Your opponent's defense roll result on your next turn gains -4 to the results",
      },
    ],
  ],
  [
    "move-akaikaru-burnout",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "apply-status",
        statusId: "stun",
        sourceText: "STUN",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "sides",
        amount: { type: "literal", value: 2 },
        scope: { type: "next-action", sourceText: "Your next attack roll" },
        sourceText: "Your next attack roll gains +2 sides",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "stat-percent", subject: "self", stat: "power", percent: 10 },
        scope: { type: "next-action", sourceText: "Your next attack roll" },
        sourceText: "Your next attack roll gains +2 sides and does +(10% Power) Damage",
      },
    ],
  ],
  [
    "move-akaikaru-chained-mauler",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "grant-extra-action",
        phase: "action-phase",
        moveCategory: "advanced-attack",
        move: "source",
        scope: { type: "current-action", sourceText: "on the same turn" },
        useLimit: {
          scope: "combat",
          count: 3,
          sourceText: "You cannot use this attack more than 3 times per combat",
        },
        sourceText:
          "SUCCESSFUL - You may use this Signature Technique again on the same turn. If you do, it costs 0 KI. You cannot use this attack more than 3 times per combat",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "modify-cost",
        operation: "set",
        amount: { type: "literal", value: 0 },
        selector: {
          type: "move-selector",
          subject: "target",
          styleId: AKAIKARU_STYLE.id,
          category: "signature",
          sourceText: "this Signature Technique",
        },
        scope: { type: "next-action", sourceText: "again on the same turn" },
        sourceText:
          "SUCCESSFUL - You may use this Signature Technique again on the same turn. If you do, it costs 0 KI",
      },
    ],
  ],
  [
    "move-akaikaru-backflip",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-roll",
        roll: "defense",
        modifier: "result",
        amount: { type: "literal", value: -5 },
        scope: {
          type: "next-roll",
          roll: "defense",
          sourceText: "Your opponent's next defensive roll",
        },
        sourceText: "Your opponent's next defensive roll has -5 to the results",
      },
    ],
  ],
  [
    "move-akaikaru-dodging-bullets",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "sides",
        amount: { type: "literal", value: 1 },
        scope: { type: "next-action", sourceText: "Your next attack" },
        sourceText: "Your next attack gains +1 to its dice sides",
      },
    ],
  ],
  [
    "move-akaikaru-kip-up-and-over",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: -2 },
        minimum: { type: "literal", value: 1 },
        selector: {
          type: "move-selector",
          subject: "target",
          effectTextIncludes: "STUN",
          sourceText: 'Your next attack with "STUN" in the effect',
        },
        scope: { type: "next-action", sourceText: 'Your next attack with "STUN" in the effect' },
        sourceText: 'Your next attack with "STUN" in the effect costs -2 KI to a minimum of 1',
      },
    ],
  ],
  [
    "move-akaikaru-limb-twist",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "grant-extra-action",
        phase: "action-phase",
        moveCategory: "advanced-attack",
        activationCost: {
          resource: "ki",
          operation: "lose",
          amount: { type: "literal", value: 1 },
        },
        scope: { type: "current-action", sourceText: "before the end of this turn" },
        sourceText:
          "You may pay 1 KI to perform an Advanced Attack before the end of this turn. You must pay the cost for that attack",
      },
    ],
  ],
  [
    "move-akaikaru-vehemence",
    [
      {
        trigger: "action-phase",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: 3 },
        scope: {
          type: "next-actions",
          count: { type: "literal", value: 3 },
          sourceText: "For your next 3 ACTION phases",
        },
        stacking: "prevent",
        sourceText:
          "For your next 3 ACTION phases, your attack rolls gain +3 to the result(s). Your opponent loses (10% Power) HP when they perform a physical attack against you until they STOP one of your attacks. This Skill's effects cannot stack with itself",
      },
    ],
  ],
  [
    "move-akaikaru-sonic-boom",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: 1 },
        sourceText: "SUCCESSFUL - Gain 1 KI",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "apply-status",
        statusId: "stun",
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 20 },
            sourceText: "If your attack roll result is 20 or higher",
          },
        ],
        sourceText: "If your attack roll result is 20 or higher, STUN",
      },
    ],
  ],
  [
    "move-akaikaru-great-finale",
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
            sourceText: "If four or more dice rolls are SUCCESSFUL",
          },
        ],
        sourceText: "SUCCESSFUL - If four or more dice rolls are SUCCESSFUL, STUN",
      },
    ],
  ],
  [
    "move-akaikaru-anger-management",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "create-floating-effect",
        floatingEffectId: "anger-management-next-single-die-stun",
        effects: [
          {
            trigger: "on-success",
            target: "opponent",
            type: "apply-status",
            statusId: "stun",
            conditions: [
              {
                type: "move-selector",
                subject: "source",
                category: "advanced-attack",
                attackRoll: { dice: 1 },
                effectTextExcludes: "STUN",
                sourceText: "next single dice attack without stun in the effect",
              },
              {
                type: "roll-threshold",
                roll: "attack",
                comparison: "at-least",
                value: { type: "literal", value: 23 },
                sourceText: "If your attack roll is 23 or higher",
              },
            ],
            sourceText: "SUCCESSFUL - If your attack roll is 23 or higher, STUN",
          },
        ],
        termination: [
          {
            trigger: "on-success",
            actor: "self",
            selector: {
              type: "move-selector",
              subject: "source",
              category: "advanced-attack",
              attackRoll: { dice: 1 },
              effectTextExcludes: "STUN",
              sourceText: "next single dice attack without stun in the effect",
            },
            sourceText: "SUCCESSFUL - If your attack roll is 23 or higher, STUN",
          },
        ],
        sourceText:
          'SUCCESSFUL - Your next single dice attack without stun in the effect gains "SUCCESSFUL - If your attack roll is 23 or higher, STUN." If that attack is BLOCKED, this added SUCCESSFUL clause carries over to your next single-dice attack',
      },
    ],
  ],
  [
    "move-akaikaru-backflip-kick",
    [
      {
        trigger: "on-roll-result",
        target: "self",
        type: "create-floating-effect",
        floatingEffectId: "backflip-kick-next-dexterity-stun",
        scope: { type: "next-action", sourceText: "your next attack" },
        conditions: [
          {
            type: "roll-comparison",
            left: "attack",
            comparison: "at-least",
            right: "defense",
            difference: { type: "literal", value: 7 },
            sourceText: "If your attack roll result is +7 or more your opponent's defensive roll",
          },
        ],
        effects: [
          {
            trigger: "passive",
            target: "self",
            type: "prevent-resolution",
            prevention: "block",
            selector: {
              type: "move-selector",
              subject: "source",
              effectTextIncludes: "Dexterity",
              sourceText: "your next attack with the word 'Dexterity' in the effect",
            },
            sourceText:
              "your next attack with the word 'Dexterity' in the effect cannot be BLOCKED",
          },
          {
            trigger: "on-success",
            target: "opponent",
            type: "apply-status",
            statusId: "stun",
            conditions: [
              {
                type: "move-selector",
                subject: "source",
                effectTextIncludes: "Dexterity",
                sourceText: "your next attack with the word 'Dexterity' in the effect",
              },
              {
                type: "roll-threshold",
                roll: "attack",
                comparison: "at-least",
                value: { type: "literal", value: 23 },
                sourceText: "If your attack roll result is 23 or more",
              },
            ],
            sourceText: "SUCCESSFUL - If your attack roll result is 23 or more, STUN",
          },
        ],
        sourceText:
          "If your attack roll result is +7 or more your opponent's defensive roll, your next attack with the word 'Dexterity' in the effect cannot be BLOCKED and gains 'SUCCESSFUL - If your attack roll result is 23 or more, STUN'",
      },
    ],
  ],
  [
    "move-akaikaru-accelerated-shoulder-tackle",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: 3 },
        scope: { type: "next-action", sourceText: "your next attack roll" },
        conditions: [
          {
            type: "moveset-move-count",
            subject: "self",
            category: "advanced-attack",
            tags: ["physical"],
            comparison: "exactly",
            value: { type: "literal", value: 4 },
            sourceText: "If you have at least 4 physical attacks in your moveset",
          },
        ],
        sourceText:
          "If you have at least 4 physical attacks in your moveset, your next attack roll gains +3 to the result",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: 4 },
        scope: { type: "current-action", sourceText: "the result of this" },
        conditions: [
          {
            type: "moveset-move-count",
            subject: "self",
            category: "advanced-attack",
            tags: ["physical"],
            comparison: "at-least",
            value: { type: "literal", value: 5 },
            sourceText: "If you have at least 5 physical attacks in your moveset",
          },
        ],
        sourceText:
          "If you have at least 5 physical attacks in your moveset, the result of this and your next attack roll gain +4 instead",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: 4 },
        scope: { type: "next-action", sourceText: "your next attack roll" },
        conditions: [
          {
            type: "moveset-move-count",
            subject: "self",
            category: "advanced-attack",
            tags: ["physical"],
            comparison: "at-least",
            value: { type: "literal", value: 5 },
            sourceText: "If you have at least 5 physical attacks in your moveset",
          },
        ],
        sourceText:
          "If you have at least 5 physical attacks in your moveset, the result of this and your next attack roll gain +4 instead",
      },
    ],
  ],
  [
    "move-akaikaru-delta-storm",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "grant-combat-outcome",
        outcome: "sever",
        conditions: [
          {
            type: "roll-die-threshold",
            roll: "attack",
            index: 3,
            comparison: "at-least",
            value: { type: "literal", value: 30 },
            sourceText: "If the last dice roll is 30 or higher",
          },
        ],
        sourceText: "SUCCESSFUL - If the last dice roll is 30 or higher, SEVER",
      },
    ],
  ],
  [
    "move-akaikaru-ticking-time-bomb",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "turns-after-turn", turn: 10, perTurn: 15, maximum: 75 },
        scope: { type: "current-action", sourceText: "this attack" },
        sourceText:
          "For every turn that passes after the minimum amount of turns after Turn 10, this attack does +(15% Power) Damage to a maximum of +(75% Power) Damage",
      },
    ],
  ],
  [
    "move-akaikaru-relentless",
    [
      {
        trigger: "passive",
        target: "participants",
        type: "lock",
        affectedType: "escape",
        sourceText: "Escape rolls cannot be made while this Skill is active",
      },
      {
        trigger: "on-move-use",
        target: "self",
        type: "modify-cost",
        operation: "add",
        amount: {
          type: "participant-count",
          excludeSelf: true,
          perParticipant: 1,
          maximum: 9,
        },
        selector: {
          type: "move-selector",
          subject: "source",
          ids: ["move-akaikaru-relentless"],
          sourceText: "This Skill",
        },
        scope: { type: "current-action", sourceText: "This Skill costs" },
        sourceText:
          "This Skill costs +1 KI for every participant in battle, excluding yourself to a maximum of +9 KI",
      },
      {
        trigger: "turn-end",
        target: "self",
        type: "deactivate",
        affectedType: "skill",
        optional: true,
        selector: {
          type: "move-selector",
          subject: "source",
          ids: ["move-akaikaru-relentless"],
          sourceText: "this skill",
        },
        activationCost: {
          resource: "ki",
          operation: "lose",
          amount: { type: "literal", value: 1 },
        },
        sourceText: "You may DEACTIVATE this skill during your END phase by paying 1 KI",
      },
    ],
  ],
  [
    "move-akaikaru-impulsive",
    [
      {
        trigger: "upkeep-phase",
        target: "self",
        type: "roll-and-store",
        dice: 1,
        sides: { type: "moveset-move-count", subject: "self", category: "advanced-attack" },
        storageKey: "impulsive-advanced-attack-index",
        sourceText: "Roll 1dX (X = number of Advanced Attacks in your move set) every turn",
      },
      {
        trigger: "upkeep-phase",
        target: "self",
        type: "select-move-by-stored-roll",
        storageKey: "impulsive-advanced-attack-index",
        selectionKey: "impulsive-selected-advanced-attack",
        subject: "self",
        selector: {
          type: "move-selector",
          subject: "source",
          category: "advanced-attack",
          sourceText: "Advanced Attack appears in your move set",
        },
        ordering: "character-sheet-top-to-bottom",
        reindex: "on-moveset-change",
        sourceText:
          "The number you roll corresponds to the number that an Advanced Attack appears in your move set",
      },
      {
        trigger: "action-phase",
        target: "self",
        type: "force-action",
        allowedCategories: ["advanced-attack"],
        allowPass: true,
        selectedMoveStorageKey: "impulsive-selected-advanced-attack",
        sourceText: "You must perform that attack, or pass if you cannot pay the cost",
      },
      {
        trigger: "passive",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "literal", value: 10 },
        scope: { type: "current-action", sourceText: "That attack" },
        conditions: [
          {
            type: "stored-move-selection",
            selectionKey: "impulsive-selected-advanced-attack",
            sourceText: "That attack",
          },
        ],
        sourceText: "That attack does +(10% Power) damage",
      },
      {
        trigger: "passive",
        target: "self",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: -1 },
        minimum: { type: "literal", value: 1 },
        scope: { type: "current-action", sourceText: "That attack" },
        conditions: [
          {
            type: "stored-move-selection",
            selectionKey: "impulsive-selected-advanced-attack",
            sourceText: "That attack",
          },
        ],
        sourceText:
          "That attack does +(10% Power) damage and costs -1 KI to perform to a minimum of 1",
      },
      {
        trigger: "upkeep-phase",
        target: "self",
        type: "deactivate",
        affectedType: "skill",
        optional: true,
        selector: {
          type: "move-selector",
          subject: "source",
          ids: ["move-akaikaru-impulsive"],
          sourceText: "this Skill",
        },
        sourceText: "You may DEACTIVATE this Skill at the start of any turn",
      },
      {
        trigger: "on-move-use",
        target: "self",
        type: "modify-cost",
        operation: "add",
        amount: { type: "prior-move-activation-count", move: "source", perActivation: 2 },
        selector: {
          type: "move-selector",
          subject: "source",
          ids: ["move-akaikaru-impulsive"],
          sourceText: "this Skill",
        },
        scope: { type: "current-action", sourceText: "this Skill costs" },
        sourceText:
          "This Skill costs +2 KI to activate for every time it's been activated during combat",
      },
    ],
  ],
  [
    "move-akaikaru-rage-mastery",
    [
      {
        trigger: "before-attack-roll",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "dice",
        amount: { type: "literal", value: 1 },
        selector: {
          type: "move-selector",
          subject: "source",
          styleId: "style-akaikaru",
          category: "advanced-attack",
          attackRoll: { dice: 1 },
          sourceText: "an Akaikaru single dice attack",
        },
        scope: { type: "current-action", sourceText: "it be a 2d attack" },
        optional: true,
        activationGroup: "rage-mastery-single-die-doubling",
        sourceText:
          "When you perform an Akaikaru single dice attack you may have it be a 2d attack",
      },
      {
        trigger: "before-attack-roll",
        target: "self",
        type: "modify-damage",
        operation: "multiply",
        percent: { type: "literal", value: 0.5 },
        selector: {
          type: "move-selector",
          subject: "source",
          styleId: "style-akaikaru",
          category: "advanced-attack",
          attackRoll: { dice: 1 },
          sourceText: "an Akaikaru single dice attack",
        },
        scope: { type: "current-action", sourceText: "base damage cut in half" },
        activationGroup: "rage-mastery-single-die-doubling",
        sourceText:
          "When you perform an Akaikaru single dice attack you may have it be a 2d attack with base damage cut in half",
      },
      {
        trigger: "passive",
        target: "self",
        type: "require-all-dice-success",
        selector: {
          type: "move-selector",
          subject: "source",
          styleId: "style-akaikaru",
          category: "advanced-attack",
          attackRoll: { dice: 1 },
          sourceText: "attacks changed in this way",
        },
        appliesTo: "successful-effects",
        activationGroup: "rage-mastery-single-die-doubling",
        sourceText:
          "Any successful effects on attacks changed in this way require both dice to hit to gain the effect",
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
          subject: "source",
          styleId: "style-akaikaru",
          category: "advanced-attack",
          attackRoll: { minimumDice: 2 },
          sourceText: "Your multi-dice attacks",
        },
        scope: { type: "current-action", sourceText: "Your multi-dice attacks" },
        sourceText: "Your multi-dice attacks gain +2 to their results",
      },
      {
        trigger: "before-defense-roll",
        target: "opponent",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: 2 },
        selector: {
          type: "move-selector",
          subject: "target",
          category: "block",
          sourceText: "cost +2 KI to block",
        },
        scope: { type: "current-action", sourceText: "cost +2 KI to block" },
        conditions: [
          {
            type: "move-selector",
            subject: "source",
            styleId: "style-akaikaru",
            category: "advanced-attack",
            attackRoll: { minimumDice: 2 },
            sourceText: "Your multi-dice attacks",
          },
        ],
        sourceText: "Your multi-dice attacks gain +2 to their results and cost +2 KI to block",
      },
    ],
  ],
  [
    "move-akaikaru-shock-fist",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-move-classification",
        addTags: ["ENERGY"],
        scope: { type: "current-action", sourceText: "This attack" },
        sourceText: "This attack is also considered an energy attack for all effects",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-roll",
        roll: "defense",
        modifier: "result",
        amount: { type: "literal", value: -3 },
        stacking: "allow",
        cap: {
          type: "minimum",
          value: { type: "literal", value: -6 },
          sourceText: "This effect stacks up to -6",
        },
        duration: {
          type: "until-combat-result",
          actor: "opponent",
          result: "successful",
          moveSelector: {
            type: "move-selector",
            subject: "target",
            category: "advanced-attack",
            attackRoll: { dice: 1 },
            sourceText: "a SUCCESSFUL single-dice attack",
          },
          conditions: [
            {
              type: "action-sequence",
              actor: "opponent",
              result: "successful",
              count: 2,
              sourceText: "minimum 2 defense rolls",
            },
          ],
          sourceText: "until they perform a SUCCESSFUL single-dice attack, minimum 2 defense rolls",
        },
        sourceText:
          "SUCCESSFUL - Your opponent's defensive dice rolls gain -3 to the result until they perform a SUCCESSFUL single-dice attack, minimum 2 defense rolls. This effect stacks up to -6",
      },
    ],
  ],
  [
    "move-akaikaru-gone-in-a-sixtieth-of-a-second",
    [
      {
        trigger: "on-stopped",
        target: "opponent",
        type: "block-all-dice",
        selector: {
          type: "move-selector",
          subject: "target",
          category: "advanced-attack",
          tags: ["energy"],
          attackRoll: { minimumDice: 2 },
          sourceText: "energy multi-dice attacks",
        },
        sourceText: "This can STOP all dice from energy multi-dice attacks",
      },
      {
        trigger: "on-stopped",
        target: "self",
        type: "create-floating-effect",
        floatingEffectId: "gone-in-a-sixtieth-next-base-cost-one-stun",
        scope: { type: "next-action", sourceText: "Your next base cost 1 attack" },
        effects: [
          {
            trigger: "on-success",
            target: "opponent",
            type: "apply-status",
            statusId: "stun",
            unpreventable: true,
            conditions: [
              {
                type: "move-selector",
                subject: "source",
                baseKiCost: { comparison: "exactly", value: { type: "literal", value: 1 } },
                sourceText: "Your next base cost 1 attack",
              },
              {
                type: "roll-threshold",
                roll: "attack",
                comparison: "at-least",
                value: { type: "literal", value: 20 },
                sourceText: "If your dice roll result is 20 or higher",
              },
            ],
            sourceText:
              "SUCCESSFUL - If your dice roll result is 20 or higher, STUN. This STUN cannot be prevented by any means",
          },
        ],
        sourceText:
          'Your next base cost 1 attack gains "SUCCESSFUL - If your dice roll result is 20 or higher, STUN. This STUN cannot be prevented by any means."',
      },
    ],
  ],
  [
    "move-akaikaru-letting-off-steam",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: {
          type: "consecutive-combat-results",
          actor: "self",
          result: "stopped",
          resetBy: "successful",
          perResult: 5,
          maximum: 40,
        },
        scope: { type: "current-action", sourceText: "This attack" },
        sourceText:
          "This attack does +(5% Power) Damage and gains +1 to the result for every attack roll of yours that's been STOPPED in a row since your last SUCCESSFUL attack roll to a maximum of +(40% Power) and +4 to the result",
      },
      {
        trigger: "passive",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: {
          type: "consecutive-combat-results",
          actor: "self",
          result: "stopped",
          resetBy: "successful",
          perResult: 1,
          maximum: 4,
        },
        scope: { type: "current-action", sourceText: "This attack" },
        sourceText:
          "This attack does +(5% Power) Damage and gains +1 to the result for every attack roll of yours that's been STOPPED in a row since your last SUCCESSFUL attack roll to a maximum of +(40% Power) and +4 to the result",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-roll",
        roll: "escape",
        modifier: "result",
        amount: { type: "literal", value: -5 },
        scope: { type: "next-roll", roll: "escape", sourceText: "their next escape roll" },
        stacking: "prevent",
        sourceText:
          "SUCCESSFUL - Your opponent suffers -5 to their next escape roll. This does not stack with itself",
      },
    ],
  ],
  [
    "move-akaikaru-chained-mastery",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: {
          type: "consecutive-combat-results",
          actor: "self",
          result: "successful",
          resetBy: "stopped",
          perResult: 5,
        },
        selector: {
          type: "move-selector",
          subject: "source",
          styleId: "style-akaikaru",
          category: "advanced-attack",
          sourceText: "Your Akaikaru Advanced Attacks",
        },
        scope: { type: "current-action", sourceText: "that attack" },
        sourceText:
          "Your Akaikaru Advanced Attacks do +(5% Power) Damage for every SUCCESSFUL attack you performed in a row prior to that attack. This effect resets when one of your attacks are STOPPED",
      },
      {
        trigger: "on-move-use",
        target: "self",
        type: "create-floating-effect",
        floatingEffectId: "chained-mastery-next-turn-kick-follow-up",
        scope: { type: "next-turn", subject: "self", sourceText: "on your next turn" },
        conditions: [
          {
            type: "move-selector",
            subject: "source",
            tags: ["punch"],
            sourceText: "Your Punch-type attacks",
          },
        ],
        effects: [
          {
            trigger: "passive",
            target: "self",
            type: "modify-damage",
            operation: "add",
            percent: { type: "literal", value: 5 },
            selector: {
              type: "move-selector",
              subject: "source",
              tags: ["kick"],
              restriction: "unrestricted",
              sourceText: "an UNRESTRICTED Kick-type attack",
            },
            scope: { type: "current-action", sourceText: "the attack" },
            sourceText: "the attack does +(5% Power) Damage",
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
              subject: "source",
              tags: ["kick"],
              restriction: "unrestricted",
              sourceText: "an UNRESTRICTED Kick-type attack",
            },
            scope: { type: "current-action", sourceText: "the attack" },
            sourceText: "the attack gains +2 to the results",
          },
        ],
        sourceText:
          'Your Punch-type attacks gain "If you perform an UNRESTRICTED Kick-type attack on your next turn, the attack does +(5% Power) Damage and gains +2 to the results."',
      },
      {
        trigger: "on-move-use",
        target: "self",
        type: "create-floating-effect",
        floatingEffectId: "chained-mastery-next-turn-punch-follow-up",
        scope: { type: "next-turn", subject: "self", sourceText: "on your next turn" },
        conditions: [
          {
            type: "move-selector",
            subject: "source",
            tags: ["kick"],
            sourceText: "Your Kick-type attacks",
          },
        ],
        effects: [
          {
            trigger: "passive",
            target: "self",
            type: "modify-damage",
            operation: "add",
            percent: { type: "literal", value: 5 },
            selector: {
              type: "move-selector",
              subject: "source",
              tags: ["punch"],
              restriction: "unrestricted",
              sourceText: "an UNRESTRICTED Punch-type attack",
            },
            scope: { type: "current-action", sourceText: "the attack" },
            sourceText: "the attack does +(5% Power) Damage",
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
              subject: "source",
              tags: ["punch"],
              restriction: "unrestricted",
              sourceText: "an UNRESTRICTED Punch-type attack",
            },
            scope: { type: "current-action", sourceText: "the attack" },
            sourceText: "the attack gains +2 to the results",
          },
        ],
        sourceText:
          'Your Kick-type attacks gain "If you perform an UNRESTRICTED Punch-type attack on your next turn, the attack does +(5% Power) Damage and gains +2 to the results."',
      },
    ],
  ],
  [
    "move-akaikaru-shotgun-blast",
    [
      {
        trigger: "on-roll-modified",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: 1 },
        scope: { type: "next-turn", subject: "self", sourceText: "on your next turn" },
        conditions: [
          {
            type: "roll-modification",
            actor: "self",
            roll: "attack",
            modifiers: ["sides", "result"],
            excludeSource: "dexterity",
            sourceText:
              "If you modify the dice sides or result of your attack on your next turn from effects other than dexterity",
          },
        ],
        sourceText:
          "SUCCESSFUL - If you modify the dice sides or result of your attack on your next turn from effects other than dexterity, gain 1 KI",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "prevent-roll-modification",
        roll: "defense",
        modifier: "any",
        duration: {
          type: "until-combat-result",
          actor: "opponent",
          result: "successful",
          moveSelector: {
            type: "move-selector",
            subject: "target",
            category: "advanced-attack",
            attackRoll: { dice: 1 },
            sourceText: "single dice attacks",
          },
          conditions: [
            {
              type: "action-sequence",
              actor: "opponent",
              result: "successful",
              count: 2,
              sourceText: "two SUCCESSFUL single dice attacks in a row",
            },
          ],
          sourceText: "until they perform two SUCCESSFUL single dice attacks in a row",
        },
        conditions: [
          {
            type: "successful-hit-count",
            comparison: "exactly",
            value: { type: "literal", value: 3 },
            sourceText: "If all dice rolls are SUCCESSFUL",
          },
        ],
        sourceText:
          "If all dice rolls are SUCCESSFUL, your opponent cannot modify their defense roll results or dice sides until they perform two SUCCESSFUL single dice attacks in a row",
      },
    ],
  ],
]);

export const AKAIKARU_MOVES: readonly MoveDefinition[] = createStyleMoves(AKAIKARU_STYLE).map(
  (move) => ({
    ...move,
    ...(structuredEffectsByMoveId.has(move.id)
      ? { effects: structuredEffectsByMoveId.get(move.id) }
      : {}),
  }),
);
