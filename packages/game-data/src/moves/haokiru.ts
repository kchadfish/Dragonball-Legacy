import { HAOKIRU_STYLE } from "../styles/haokiru.js";
import type { EffectDefinition } from "../shared/effects.js";
import type { MoveDefinition } from "../shared/types.js";
import { createStyleMoves } from "./create-style-moves.js";

const structuredEffectsByMoveId = new Map<string, readonly EffectDefinition[]>([
  [
    "move-haokiru-vengeance-wave",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-damage",
        operation: "set",
        percent: { type: "prior-attack-damage-percent", actor: "opponent", count: 2 },
        scope: { type: "current-action", sourceText: "Deal (X% Power) damage" },
        sourceText:
          "Deal (X% Power) damage. X = The total percentages of damage dealt to you by your opponent from their last two Advanced Attacks combined",
      },
    ],
  ],
  [
    "move-haokiru-sonic-kick",
    [
      {
        trigger: "passive",
        target: "self",
        type: "prevent-move-modification",
        selector: {
          type: "move-selector",
          subject: "source",
          ids: ["move-haokiru-sonic-kick"],
          sourceText: "The cost of this attack",
        },
        aspects: ["cost"],
        actor: "any",
        effectSourceStyleExcludes: "style-haokiru",
        sourceText: "The cost of this attack cannot be modified by non-Haokiru effects",
      },
    ],
  ],
  [
    "move-haokiru-indestructible-wave",
    [
      {
        trigger: "passive",
        target: "self",
        type: "prevent-resolution",
        prevention: "block",
        scope: { type: "current-action", sourceText: "this attack" },
        sourceText: "Your opponent cannot BLOCK this attack",
      },
    ],
  ],
  [
    "move-haokiru-dragon-effect",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: -1 },
        minimum: { type: "literal", value: 0 },
        scope: { type: "current-action", sourceText: "this attack" },
        conditions: [
          {
            type: "resource-comparison",
            resource: "hp",
            basis: "current",
            left: "self",
            comparison: "higher-than",
            right: "opponent",
            sourceText: "If your current HP is higher than your opponent's",
          },
        ],
        sourceText:
          "If your current HP is higher than your opponent's, this attack costs -1 KI, to a minimum of 0",
      },
    ],
  ],
  [
    "move-haokiru-focused-spirit-cutter",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: -1 },
        scope: { type: "current-action", sourceText: "this attack" },
        conditions: [
          {
            type: "resource-comparison",
            resource: "hp",
            basis: "current",
            left: "self",
            comparison: "lower-than",
            right: "opponent",
            sourceText: "If your Current HP is less than your opponent's Current HP",
          },
        ],
        sourceText:
          "If your Current HP is less than your opponent's Current HP, this attack costs -1 KI",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-damage",
        operation: "add",
        percent: { type: "damage-percent", subject: "current-action", percent: -50 },
        selector: {
          type: "move-selector",
          subject: "target",
          category: "advanced-attack",
          sourceText: "Your opponent's next SUCCESSFUL Advanced Attack",
        },
        scope: {
          type: "next-action",
          sourceText: "Your opponent's next SUCCESSFUL Advanced Attack",
        },
        stacking: "prevent",
        conditions: [
          {
            type: "resource-comparison",
            resource: "hp",
            basis: "current",
            left: "self",
            comparison: "lower-than",
            right: "opponent",
            sourceText: "If your Current HP is less than your opponent's Current HP",
          },
        ],
        sourceText:
          "If your Current HP is less than your opponent's Current HP, this attack costs -1 KI and gains \"SUCCESSFUL - Your opponent's next SUCCESSFUL Advanced Attack deals -50% Damage. This effect does not stack and can exceed the damage modification limits.\"",
      },
    ],
  ],
  [
    "move-haokiru-enervating-cannon",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-cost",
        operation: "set",
        amount: { type: "literal", value: 0 },
        selector: {
          type: "move-selector",
          subject: "target",
          baseKiCost: { comparison: "at-most", value: { type: "literal", value: 2 } },
          sourceText: "next 2 attacks must be base cost 2 or less",
        },
        scope: {
          type: "next-actions",
          count: { type: "literal", value: 2 },
          sourceText: "next 2 attacks",
        },
        sourceText:
          "SUCCESSFUL - Your next 2 attacks must be base cost 2 or less. You do not have to pay the cost of either attack",
      },
    ],
  ],
  [
    "move-haokiru-dragon-fire",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-resource",
        resource: "hp",
        operation: "gain",
        amount: {
          type: "resource-percent-per-successful-roll-threshold",
          subject: "self",
          resource: "hp",
          basis: "total",
          percentPerRoll: 5,
          roll: "attack",
          comparison: "above",
          value: 20,
        },
        cap: {
          type: "maximum",
          value: {
            type: "resource-percent",
            subject: "self",
            resource: "hp",
            basis: "total",
            percent: 50,
          },
          sourceText: "to a maximum of (50% Total HP) HP",
        },
        sourceText:
          "SUCCESSFUL - Gain (5% Total HP) HP for every SUCCESSFUL dice roll result above 20 to a maximum of (50% Total HP) HP",
      },
    ],
  ],
  [
    "move-haokiru-miraculous-recovery",
    [
      {
        trigger: "on-stopped",
        target: "self",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: -1 },
        scope: { type: "next-action", sourceText: "Your next attack" },
        sourceText: "Your next attack costs -1 KI",
      },
    ],
  ],
  [
    "move-haokiru-ki-lance",
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
          turns: { type: "literal", value: 4 },
          sourceText: "for their next 4 turns",
        },
        sourceText: "SUCCESSFUL - LOCK your opponent's Mastery for their next 4 turns",
      },
    ],
  ],
  [
    "move-haokiru-playtime-s-over",
    [
      {
        trigger: "on-stopped",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: 3 },
        selector: {
          type: "move-selector",
          subject: "target",
          styleId: "style-haokiru",
          attackRoll: { dice: 2 },
          sourceText: "next Haokiru multi-dice attack",
        },
        scope: { type: "next-action", sourceText: "next Haokiru multi-dice attack" },
        sourceText: "Your next Haokiru multi-dice attack gains +3 to the results",
      },
    ],
  ],
  [
    "move-haokiru-immortal-mastery",
    [
      {
        trigger: "passive",
        target: "opponent",
        type: "modify-damage",
        operation: "add",
        percent: { type: "literal", value: -10 },
        selector: {
          type: "move-selector",
          subject: "source",
          category: "advanced-attack",
          sourceText: "Your opponent's Advanced Attacks",
        },
        sourceText: "Your opponent's Advanced Attacks do -10% Damage against you",
      },
      {
        trigger: "passive",
        target: "opponent",
        type: "modify-damage",
        operation: "add",
        percent: { type: "literal", value: -25 },
        selector: {
          type: "move-selector",
          subject: "source",
          category: "signature",
          sourceText: "Your opponent's Signature Techniques",
        },
        sourceText: "Your opponent's Signature Techniques do -25% Damage against you",
      },
      {
        trigger: "on-resource-threshold",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: 3 },
        conditions: [
          {
            type: "combat-result",
            actor: "opponent",
            result: "critical",
            sourceText: "If your opponent performs a CRITICAL attack against you",
          },
        ],
        sourceText:
          "If your opponent performs a CRITICAL attack against you, it deals 1.5x damage instead and you gain 3 KI",
      },
      {
        trigger: "passive",
        target: "opponent",
        type: "modify-damage",
        operation: "add",
        percent: { type: "literal", value: -10 },
        conditions: [
          {
            type: "move-selector",
            subject: "target",
            effectTextIncludes: "Halo",
            sourceText: "If battling with a Halo",
          },
        ],
        sourceText: "If battling with a Halo your opponent's attacks deal -10% Damage against you",
      },
    ],
  ],
  [
    "move-haokiru-reserves",
    [
      {
        trigger: "on-power-up",
        target: "self",
        type: "modify-resource",
        resource: "hp",
        operation: "gain",
        amount: {
          type: "resource-percent",
          subject: "self",
          resource: "hp",
          basis: "total",
          percent: 5,
        },
        useLimit: { scope: "turn", count: 1, sourceText: "once per turn" },
        activationCost: {
          resource: "ki",
          operation: "lose",
          amount: { type: "literal", value: 1 },
        },
        sourceText:
          "Timing: when you Power Up. Gain (5% Total HP) HP. You may only use this Skill once per turn. Cost: 1 KI",
      },
    ],
  ],
  [
    "move-haokiru-survival-instinct",
    [
      {
        trigger: "on-resource-threshold",
        target: "self",
        type: "modify-resource",
        resource: "hp",
        operation: "set",
        amount: { type: "literal", value: 1 },
        conditions: [
          {
            type: "resource-threshold",
            subject: "self",
            resource: "hp",
            basis: "current",
            comparison: "at-most",
            value: { type: "literal", value: -1 },
            sourceText: "Activate when your HP drops below 0",
          },
        ],
        useLimit: { scope: "combat", count: 1, sourceText: "RESTRICTEDx1" },
        activationCost: {
          resource: "ki",
          operation: "lose",
          amount: { type: "literal", value: 1 },
        },
        sourceText: "RESTRICTEDx1. Activate when your HP drops below 0. Set your HP to 1",
      },
      {
        trigger: "on-resource-threshold",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: 2 },
        conditions: [
          {
            type: "resource-threshold",
            subject: "self",
            resource: "hp",
            basis: "current",
            comparison: "at-most",
            value: { type: "literal", value: -1 },
            sourceText: "Activate when your HP drops below 0",
          },
        ],
        sourceText:
          "RESTRICTEDx1. Activate when your HP drops below 0. Set your HP to 1. This Skill may not be in the same moveset as Martyrdom. Gain 2 KI",
      },
    ],
  ],
  [
    "move-haokiru-spirited-effort",
    [
      {
        trigger: "action-phase",
        target: "self",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: -2 },
        scope: { type: "next-action", sourceText: "Your next attack" },
        useLimit: { scope: "combat", count: 1, sourceText: "RESTRICTEDx1" },
        conditions: [
          {
            type: "resource-threshold",
            subject: "self",
            resource: "hp",
            basis: "current",
            comparison: "at-most",
            value: {
              type: "resource-percent",
              subject: "self",
              resource: "hp",
              basis: "total",
              percent: 15,
            },
            sourceText: "when your HP falls below (15% Total HP) HP",
          },
        ],
        sourceText:
          "RESTRICTEDx1. Activate when your HP falls below (15% Total HP) HP. Your next attack costs -2 KI",
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
          percent: 10,
        },
        scope: { type: "next-action", sourceText: "Your next attack" },
        conditions: [
          {
            type: "resource-threshold",
            subject: "self",
            resource: "hp",
            basis: "current",
            comparison: "at-most",
            value: {
              type: "resource-percent",
              subject: "self",
              resource: "hp",
              basis: "total",
              percent: 15,
            },
            sourceText: "when your HP falls below (15% Total HP) HP",
          },
        ],
        sourceText:
          'RESTRICTEDx1. Activate when your HP falls below (15% Total HP) HP. Your next attack costs -2 KI and gains "SUCCESSFUL - Gain (10% Total HP) HP."',
      },
    ],
  ],
  [
    "move-haokiru-dragon-s-pride",
    [
      {
        trigger: "start-combat",
        target: "self",
        type: "modify-resource",
        resource: "hp",
        operation: "gain",
        amount: {
          type: "resource-percent",
          subject: "self",
          resource: "hp",
          basis: "total",
          percent: 10,
        },
        conditions: [
          {
            type: "stat-comparison",
            left: "self",
            stat: "sp",
            comparison: "at-most",
            right: "opponent",
            sourceText: "If you have equal or less SP than your opponent",
          },
        ],
        sourceText:
          "Timing: start of match. If you have equal or less SP than your opponent, you begin the match with +(10% Total HP)",
      },
    ],
  ],
  [
    "move-haokiru-dragon-spiral",
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
          basis: "total",
          percent: 10,
        },
        scope: { type: "next-action", sourceText: "your next attack" },
        conditions: [
          {
            type: "successful-hit-count",
            comparison: "exactly",
            value: { type: "literal", value: 2 },
            sourceText: "If both attack rolls are SUCCESSFUL",
          },
        ],
        sourceText:
          'If both attack rolls are SUCCESSFUL, your next attack gains "SUCCESSFUL - HEAL (10% Total HP)"',
      },
    ],
  ],
  [
    "move-haokiru-hellstorm",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "grant-extra-action",
        phase: "action-phase",
        moveCategory: "advanced-attack",
        move: "source",
        scope: { type: "current-action", sourceText: "this turn" },
        useLimit: { scope: "combat", count: 1, sourceText: "RESTRICTEDx1" },
        sourceText: "SUCCESSFUL - You can perform this attack again this turn for 0 KI",
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
          styleId: HAOKIRU_STYLE.id,
          category: "signature",
          sourceText: "this attack",
        },
        scope: { type: "next-action", sourceText: "again this turn" },
        sourceText: "SUCCESSFUL - You can perform this attack again this turn for 0 KI",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "sides",
        amount: { type: "literal", value: -10 },
        selector: {
          type: "move-selector",
          subject: "target",
          styleId: HAOKIRU_STYLE.id,
          category: "signature",
          sourceText: "this attack",
        },
        scope: { type: "next-action", sourceText: "the next time you perform it" },
        sourceText:
          "If you use this moves SUCCESSFUL effect, this attack gains -10 dice sides the next time you perform it",
      },
    ],
  ],
  [
    "move-haokiru-miracle-wave",
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
          basis: "total",
          percent: 20,
        },
        useLimit: { scope: "combat", count: 1, sourceText: "RESTRICTEDx1" },
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 20 },
            sourceText: "If your attack roll result is 20 or higher",
          },
        ],
        sourceText: "SUCCESSFUL - If your attack roll result is 20 or higher, HEAL (20% Total HP)",
      },
    ],
  ],
  [
    "move-haokiru-muscle-infusion",
    [
      {
        trigger: "on-damage",
        target: "opponent",
        type: "modify-damage",
        operation: "add",
        percent: { type: "damage-percent", subject: "current-action", percent: -50 },
        optional: true,
        conditions: [
          {
            type: "combat-result",
            actor: "opponent",
            result: "successful",
            sourceText: "receiving damage from a SUCCESSFUL UNRESTRICTED attack",
          },
          {
            type: "move-selector",
            subject: "target",
            category: "advanced-attack",
            restriction: "unrestricted",
            sourceText: "UNRESTRICTED attack",
          },
        ],
        useLimit: { scope: "combat", count: 2, sourceText: "RESTRICTEDx2" },
        activationCost: {
          resource: "ki",
          operation: "lose",
          amount: { type: "literal", value: 1 },
        },
        sourceText:
          "RESTRICTEDx2. Use when receiving damage from a SUCCESSFUL UNRESTRICTED attack. The attack does -50% Damage. This Skill may be used twice against the same attack. Cost: 1 KI",
      },
    ],
  ],
  [
    "move-haokiru-dragon-s-pride",
    [
      {
        trigger: "start-combat",
        target: "self",
        type: "modify-resource",
        resource: "hp",
        operation: "gain",
        amount: {
          type: "resource-percent",
          subject: "self",
          resource: "hp",
          basis: "total",
          percent: 10,
        },
        conditions: [
          {
            type: "stat-comparison",
            left: "self",
            stat: "sp",
            comparison: "at-most",
            right: "opponent",
            sourceText: "If you have equal or less SP than your opponent",
          },
        ],
        activationCost: {
          resource: "ki",
          operation: "lose",
          amount: { type: "literal", value: 1 },
        },
        sourceText:
          "Timing: start of match. If you have equal or less SP than your opponent, you begin the match with +(10% Total HP). Cost: 1 KI",
      },
    ],
  ],
  [
    "move-haokiru-conservation-mastery",
    [
      {
        trigger: "before-attack-roll",
        target: "self",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: -1 },
        selector: {
          type: "move-selector",
          subject: "target",
          category: "advanced-attack",
          sourceText: "your next attack",
        },
        scope: { type: "next-action", sourceText: "your next attack" },
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 20 },
            sourceText:
              "when you roll an attack roll result of 20 or higher with an Advanced Attack",
          },
        ],
        sourceText:
          "Once per attack, when you roll an attack roll result of 20 or higher with an Advanced Attack, your next attack costs -1 KI",
      },
      {
        trigger: "start-combat",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: 1 },
        sourceText: "You start all matches at +1 KI",
      },
    ],
  ],
  [
    "move-haokiru-advanced-behavior",
    [
      {
        trigger: "on-damage",
        target: "opponent",
        type: "modify-damage",
        operation: "add",
        percent: { type: "damage-percent", subject: "current-action", percent: -10 },
        conditions: [
          {
            type: "roll-comparison",
            left: "attack",
            comparison: "at-least",
            right: "defense",
            difference: { type: "literal", value: 5 },
            sourceText:
              "If your opponent's attack roll result is +5 or more your defensive roll result",
          },
        ],
        sourceText:
          "Constant. If your opponent's attack roll result is +5 or more your defensive roll result, their attack does -10% Damage",
      },
    ],
  ],
  [
    "move-haokiru-energy-absorption",
    [
      {
        trigger: "on-stopped",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "triggering-move-base-ki-cost" },
        conditions: [
          {
            type: "move-selector",
            subject: "target",
            category: "advanced-attack",
            tags: ["energy"],
            sourceText: "an energy attack",
          },
          {
            type: "roll-threshold",
            roll: "defense",
            comparison: "at-least",
            value: { type: "literal", value: 20 },
            sourceText: "a defensive dice roll result of 20 or higher",
          },
        ],
        sourceText:
          "Constant. Use when you STOP an energy attack with a defensive dice roll result of 20 or higher. Gain X amount of KI. X = The base cost of the attack",
      },
    ],
  ],
  [
    "move-haokiru-prolific-blast",
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
        sourceText: "SUCCESSFUL - HEAL (10% Current HP)",
      },
    ],
  ],
  [
    "move-haokiru-dragon-blast",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "lock",
        affectedType: "move",
        selector: {
          type: "move-selector",
          subject: "target",
          effectTextIncludes: "Power Up",
          sourceText: "moves with the word 'Power Up' in the effect",
        },
        scope: { type: "next-turn", subject: "opponent", sourceText: "for their next turn" },
        sourceText:
          "SUCCESSFUL - LOCK your opponent's moves with the word 'Power Up' in the effect for their next turn",
      },
    ],
  ],
  [
    "move-haokiru-phantom-barrage",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-resource",
        resource: "hp",
        operation: "gain",
        amount: { type: "triggering-move-base-damage", multiplier: 1 },
        cap: {
          type: "maximum",
          value: {
            type: "resource-percent",
            subject: "self",
            resource: "hp",
            basis: "total",
            percent: 15,
          },
          sourceText: "to a maximum of (15% Total HP)",
        },
        conditions: [
          {
            type: "successful-hit-count",
            comparison: "at-least",
            value: { type: "literal", value: 3 },
            sourceText: "If 3 or more dice are SUCCESSFUL",
          },
        ],
        sourceText:
          "SUCCESSFUL - If 3 or more dice are SUCCESSFUL, gain HP equal to the Base Damage dealt to a maximum of (15% Total HP)",
      },
    ],
  ],
  [
    "move-haokiru-dragon-swipes",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-damage",
        operation: "add",
        percent: { type: "successful-hit-count", perHit: -5 },
        scope: { type: "next-action", sourceText: "your opponent's next attack" },
        stacking: "prevent",
        sourceText:
          "SUCCESSFUL - Prevent X% damage from your opponent's next attack. X = The number of SUCCESSFUL hits x5. This effect does not stack with itself",
      },
    ],
  ],
  [
    "move-haokiru-sonic-punch",
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
          category: "advanced-attack",
          effectTextIncludes: "Sonic Kick",
          sourceText: "the next time you use Sonic Kick",
        },
        scope: { type: "next-action", sourceText: "the next time you use Sonic Kick" },
        sourceText: "SUCCESSFUL - The next time you use Sonic Kick, it costs -1 KI",
      },
    ],
  ],
  [
    "move-haokiru-eye-laser-assault",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: -1 },
        scope: { type: "next-action", sourceText: "Your next attack" },
        sourceText: "SUCCESSFUL - Your next attack costs -1 KI",
      },
      {
        trigger: "on-stopped",
        target: "self",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: -1 },
        minimum: { type: "literal", value: 0 },
        selector: {
          type: "move-selector",
          subject: "target",
          styleId: "style-haokiru",
          category: "skill",
          sourceText: "next Haokiru skill",
        },
        scope: { type: "next-action", sourceText: "next Haokiru skill" },
        sourceText:
          "STOPPED - Your next Haokiru skill costs -1 KI to use or activate, to a minimum of 0",
      },
    ],
  ],
  [
    "move-haokiru-handstand-kick",
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
          category: "advanced-attack",
          sourceText: "next 2 Advanced Attacks",
        },
        scope: {
          type: "next-actions",
          count: { type: "literal", value: 2 },
          sourceText: "next 2 Advanced Attacks",
        },
        conditions: [
          {
            type: "roll-comparison",
            left: "attack",
            comparison: "at-least",
            right: "defense",
            difference: { type: "literal", value: 5 },
            sourceText:
              "If your attack roll result is +5 or more your opponent's defensive roll result",
          },
        ],
        sourceText:
          "SUCCESSFUL - If your attack roll result is +5 or more your opponent's defensive roll result, your next 2 Advanced Attacks cost -1 KI to perform",
      },
    ],
  ],
  [
    "move-haokiru-lion-s-roar",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-damage",
        operation: "add",
        percent: { type: "literal", value: -10 },
        scope: {
          type: "next-actions",
          count: { type: "literal", value: 2 },
          sourceText: "next 2 attacks",
        },
        conditions: [
          {
            type: "stat-comparison",
            left: "self",
            stat: "max-hp",
            comparison: "higher-than",
            right: "opponent",
            sourceText: "If your Max HP is higher than your opponent's Max HP",
          },
        ],
        sourceText:
          "SUCCESSFUL - If your Max HP is higher than your opponent's Max HP, your opponent's next 2 attacks do -10% damage",
      },
    ],
  ],
  [
    "move-haokiru-rising-dragon-wave",
    [
      {
        trigger: "before-attack-roll",
        target: "opponent",
        type: "deactivate",
        affectedType: "skill",
        count: { type: "literal", value: 1 },
        conditions: [
          {
            type: "resource-threshold",
            subject: "self",
            resource: "ki",
            basis: "current",
            comparison: "at-least",
            value: { type: "literal", value: 9 },
            sourceText: "If your KI were at 9 or higher before performing this attack",
          },
          {
            type: "move-selector",
            subject: "target",
            category: "skill",
            constant: true,
            sourceText: "a Skill with a CONSTANT effect",
          },
        ],
        sourceText:
          "If your KI were at 9 or higher before performing this attack, DEACTIVATE a Skill with a CONSTANT effect",
      },
    ],
  ],
  [
    "move-haokiru-phoenix-ash-blast",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: -2 },
        minimum: { type: "literal", value: 1 },
        scope: { type: "next-action", sourceText: "Your next attack" },
        sourceText: "SUCCESSFUL - Your next attack costs -2 KI to a minimum of 1",
      },
    ],
  ],
  [
    "move-haokiru-spirit-walk",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: 3 },
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-most",
            value: { type: "literal", value: 10 },
            sourceText: "If your attack roll was 10 or less",
          },
        ],
        sourceText: "SUCCESSFUL - If your attack roll was 10 or less, gain 3 KI",
      },
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
            value: { type: "literal", value: 11 },
            sourceText: "If your attack roll was between 11 and 20",
          },
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-most",
            value: { type: "literal", value: 20 },
            sourceText: "If your attack roll was between 11 and 20",
          },
        ],
        sourceText: "If your attack roll was between 11 and 20, gain 2 KI",
      },
    ],
  ],
  [
    "move-haokiru-warped-ray",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: -1 },
        minimum: { type: "literal", value: 3 },
        selector: {
          type: "move-selector",
          subject: "target",
          category: "signature",
          sourceText: "Your Signature Techniques",
        },
        duration: { type: "combat", sourceText: "for the remainder of the match" },
        stacking: "allow",
        sourceText:
          "SUCCESSFUL - Your Signature Techniques cost -1 KI for the remainder of the match, to a minimum of 3. This effect stacks with itself",
      },
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
          category: "signature",
          sourceText: "a Signature Technique",
        },
        scope: { type: "next-turn", subject: "self", sourceText: "on your next turn" },
        sourceText:
          "If you perform a Signature Technique on your next turn, it gains +3 dice sides",
      },
    ],
  ],
  [
    "move-haokiru-dragon-beam",
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
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-most",
            value: { type: "literal", value: 24 },
            sourceText: "If your attack roll was 25 or higher",
          },
        ],
        sourceText: "SUCCESSFUL - HEAL (10% Current HP). If your attack roll was 25 or higher",
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
          percent: 10,
        },
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 25 },
            sourceText: "If your attack roll was 25 or higher",
          },
        ],
        sourceText: "If your attack roll was 25 or higher, HEAL (10% Total HP) instead",
      },
    ],
  ],
  [
    "move-haokiru-apocalyptic-chaos",
    [
      {
        trigger: "on-stopped",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: 3 },
        sourceText: "STOPPED - Gain 3 KI",
      },
    ],
  ],
  [
    "move-haokiru-spirit-cannon",
    [
      {
        trigger: "on-stopped",
        target: "opponent",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: -4 },
        scope: {
          type: "next-actions",
          count: { type: "literal", value: 2 },
          sourceText: "next 2 attacks",
        },
        sourceText: "STOPPED - Your opponent's next 2 attacks gain -4 to the result(s)",
      },
    ],
  ],
  [
    "move-haokiru-rapture",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-resource",
        resource: "hp",
        operation: "gain",
        amount: { type: "damage-percent", subject: "current-action", percent: 25 },
        sourceText: "SUCCESSFUL - HEAL (25% Damage) HP",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "lock",
        affectedType: "power-up",
        duration: {
          type: "turns",
          turns: { type: "literal", value: 2 },
          sourceText: "on their next 2 turns",
        },
        sourceText:
          "Your opponent cannot Power Up or perform a Signature Technique on their next 2 turns",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "lock",
        affectedType: "attack",
        selector: {
          type: "move-selector",
          subject: "target",
          category: "signature",
          sourceText: "perform a Signature Technique",
        },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 2 },
          sourceText: "on their next 2 turns",
        },
        sourceText:
          "Your opponent cannot Power Up or perform a Signature Technique on their next 2 turns",
      },
    ],
  ],
  [
    "move-haokiru-soul-breaker",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-damage",
        operation: "add",
        percent: { type: "literal", value: -100 },
        scope: { type: "next-action", sourceText: "Your opponent's next attack" },
        sourceText: "SUCCESSFUL - Your opponent's next attack does -100% Damage",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "prevent-resolution",
        prevention: "stop",
        scope: { type: "next-action", sourceText: "that attack" },
        sourceText: "You cannot STOP or BLOCK that attack",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-damage",
        operation: "add",
        percent: { type: "literal", value: -50 },
        scope: {
          type: "following-action",
          offset: 2,
          sourceText: "next attack following that one",
        },
        sourceText:
          "Your opponent's next attack following that one does -50% Damage against you and loses all SUCCESSFUL effects",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "suppress",
        aspects: ["successful-effects"],
        scope: {
          type: "following-action",
          offset: 2,
          sourceText: "next attack following that one",
        },
        sourceText:
          "Your opponent's next attack following that one does -50% Damage against you and loses all SUCCESSFUL effects",
      },
    ],
  ],
  [
    "move-haokiru-ki-lock-up",
    [
      {
        trigger: "on-stopped",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "triggering-move-base-damage-percent", divisor: 10 },
        sourceText:
          "Gain Y KI. Y = The percentage of damage the attack would have done divided by 10",
      },
    ],
  ],
  [
    "move-haokiru-neutralization",
    [
      {
        trigger: "on-stopped",
        target: "opponent",
        type: "prevent-move-modification",
        actor: "opponent",
        aspects: ["damage", "roll-results"],
        selector: {
          type: "move-selector",
          subject: "target",
          category: "advanced-attack",
          sourceText: "their attacks",
        },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 3 },
          sourceText: "for their next 3 turns",
        },
        sourceText:
          "Your opponent cannot modify the damage or results of their attacks for their next 3 turns",
      },
    ],
  ],
  [
    "move-haokiru-playtimes-over",
    [
      {
        trigger: "on-stopped",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: 3 },
        selector: {
          type: "move-selector",
          subject: "target",
          styleId: "style-haokiru",
          category: "advanced-attack",
          attackRoll: { dice: 2 },
          sourceText: "next Haokiru multi-dice attack",
        },
        scope: { type: "next-action", sourceText: "next Haokiru multi-dice attack" },
        sourceText: "Your next Haokiru multi-dice attack gains +3 to the results",
      },
    ],
  ],
  [
    "move-haokiru-double-arm-cannon",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-resource",
        resource: "hp",
        operation: "gain",
        amount: {
          type: "resource-percent-per-successful-hit",
          subject: "self",
          resource: "hp",
          basis: "total",
          percentPerHit: 5,
        },
        sourceText: "SUCCESSFUL - Gain (5% Total HP) per hit",
      },
    ],
  ],
  [
    "move-haokiru-healing-ray",
    [
      {
        trigger: "action-phase",
        target: "self",
        type: "roll-and-store",
        dice: 1,
        sides: 30,
        storageKey: "healing-ray-result",
        sourceText: "Roll a d30",
      },
      {
        trigger: "on-roll-result",
        target: "self",
        type: "modify-resource",
        resource: "hp",
        operation: "gain",
        amount: {
          type: "resource-percent",
          subject: "self",
          resource: "hp",
          basis: "total",
          percent: 25,
        },
        conditions: [
          {
            type: "stored-roll-threshold",
            storageKey: "healing-ray-result",
            comparison: "at-least",
            value: { type: "literal", value: 10 },
            sourceText:
              "Roll a d30. If the result is 10 or higher, you or an ally HEALS +(25% Your Total HP). The amount of healing from this skill cannot be modified in any way. If the result is less than 10, gain 1 KI",
          },
        ],
        exclusiveActivationGroup: "healing-ray-target",
        optional: true,
        sourceText:
          "Roll a d30. If the result is 10 or higher, you or an ally HEALS +(25% Your Total HP). The amount of healing from this skill cannot be modified in any way. If the result is less than 10, gain 1 KI",
      },
      {
        trigger: "on-roll-result",
        target: "ally",
        type: "modify-resource",
        resource: "hp",
        operation: "gain",
        amount: {
          type: "resource-percent",
          subject: "self",
          resource: "hp",
          basis: "total",
          percent: 25,
        },
        conditions: [
          {
            type: "stored-roll-threshold",
            storageKey: "healing-ray-result",
            comparison: "at-least",
            value: { type: "literal", value: 10 },
            sourceText:
              "Roll a d30. If the result is 10 or higher, you or an ally HEALS +(25% Your Total HP). The amount of healing from this skill cannot be modified in any way. If the result is less than 10, gain 1 KI",
          },
        ],
        exclusiveActivationGroup: "healing-ray-target",
        optional: true,
        sourceText:
          "Roll a d30. If the result is 10 or higher, you or an ally HEALS +(25% Your Total HP). The amount of healing from this skill cannot be modified in any way. If the result is less than 10, gain 1 KI",
      },
      {
        trigger: "on-roll-result",
        target: "self",
        type: "prevent-move-modification",
        selector: {
          type: "move-selector",
          subject: "source",
          ids: ["move-haokiru-healing-ray"],
          sourceText: "The amount of healing from this skill",
        },
        aspects: ["effects"],
        actor: "any",
        conditions: [
          {
            type: "stored-roll-threshold",
            storageKey: "healing-ray-result",
            comparison: "at-least",
            value: { type: "literal", value: 10 },
            sourceText:
              "Roll a d30. If the result is 10 or higher, you or an ally HEALS +(25% Your Total HP). The amount of healing from this skill cannot be modified in any way. If the result is less than 10, gain 1 KI",
          },
        ],
        scope: { type: "current-action", sourceText: "this skill" },
        sourceText:
          "Roll a d30. If the result is 10 or higher, you or an ally HEALS +(25% Your Total HP). The amount of healing from this skill cannot be modified in any way. If the result is less than 10, gain 1 KI",
      },
      {
        trigger: "on-roll-result",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: 1 },
        conditions: [
          {
            type: "stored-roll-threshold",
            storageKey: "healing-ray-result",
            comparison: "at-most",
            value: { type: "literal", value: 9 },
            sourceText:
              "Roll a d30. If the result is 10 or higher, you or an ally HEALS +(25% Your Total HP). The amount of healing from this skill cannot be modified in any way. If the result is less than 10, gain 1 KI",
          },
        ],
        sourceText:
          "Roll a d30. If the result is 10 or higher, you or an ally HEALS +(25% Your Total HP). The amount of healing from this skill cannot be modified in any way. If the result is less than 10, gain 1 KI",
      },
    ],
  ],
  [
    "move-haokiru-halcyon-blow",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "activate",
        selector: {
          type: "move-selector",
          subject: "source",
          styleId: "style-haokiru",
          category: "skill",
          constant: true,
          sourceText: "one of your Haokiru CONSTANT Skills",
        },
        conditions: [
          {
            type: "resource-change",
            subject: "self",
            resource: "hp",
            operation: "gain",
            timing: "last-turn",
            sourceText: "If you gained HP on your last turn",
          },
        ],
        optional: true,
        sourceText:
          "SUCCESSFUL - If you gained HP on your last turn, you may activate one of your Haokiru CONSTANT Skills",
      },
    ],
  ],
  [
    "move-haokiru-creationist",
    [
      {
        trigger: "on-cost-modified",
        target: "self",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: 0 },
        minimum: { type: "literal", value: 0 },
        conditions: [
          {
            type: "move-modification",
            aspect: "cost",
            sourceStyleId: "style-haokiru",
            sourceText:
              "Activate when modifying the cost of an attack due to a Haokiru effect. Choose one: They can be modified to a minimum of 0 instead OR the attack is reduced by an additional -1 KI",
          },
        ],
        exclusiveActivationGroup: "creationist-choice",
        sourceText:
          "Activate when modifying the cost of an attack due to a Haokiru effect. Choose one: They can be modified to a minimum of 0 instead OR the attack is reduced by an additional -1 KI",
      },
      {
        trigger: "on-cost-modified",
        target: "self",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: -1 },
        conditions: [
          {
            type: "move-modification",
            aspect: "cost",
            sourceStyleId: "style-haokiru",
            sourceText:
              "Activate when modifying the cost of an attack due to a Haokiru effect. Choose one: They can be modified to a minimum of 0 instead OR the attack is reduced by an additional -1 KI",
          },
        ],
        exclusiveActivationGroup: "creationist-choice",
        sourceText:
          "Activate when modifying the cost of an attack due to a Haokiru effect. Choose one: They can be modified to a minimum of 0 instead OR the attack is reduced by an additional -1 KI",
      },
    ],
  ],
  [
    "move-haokiru-mind-reading",
    [
      {
        trigger: "action-phase",
        target: "self",
        type: "copy-move-effect",
        sourceMove: {
          type: "selected-prior-move",
          actor: "opponent",
          categories: ["advanced-attack", "signature"],
          result: "successful",
        },
        effectResult: "successful",
        resolveAs: "source-move",
        cost: { type: "selected-move-base-cost" },
        copies: ["cost", "dice-rolls", "source-modifiers"],
        sourceText:
          "Perform the same attack your opponent performed on their last turn, including costs and dice rolls. This copies all modifiers added to that attack by your opponent's effects. You cannot use this Skill if you do not meet the requirement(s) to perform that attack",
      },
    ],
  ],
  [
    "move-haokiru-willing-sacrifice",
    [
      {
        trigger: "action-phase",
        target: "self",
        type: "modify-resource",
        resource: "hp",
        operation: "lose",
        amount: {
          type: "resource-percent",
          subject: "self",
          resource: "hp",
          basis: "current",
          percent: 10,
        },
        conditions: [
          {
            type: "resource-threshold",
            subject: "self",
            resource: "hp",
            basis: "total",
            comparison: "at-most",
            value: {
              type: "resource-percent",
              subject: "self",
              resource: "hp",
              basis: "total",
              percent: 25,
            },
            sourceText: "You cannot use this Skill if your HP is (25% Total HP) or less",
          },
        ],
        sourceText:
          "You lose (10% Current HP) HP. You may have your opponent re-roll their next 3 attack rolls. You must make that choice before rolling your defensive roll against those attack rolls. If your opponent's current HP is higher than yours, this Skill does not take up your turn. You cannot use this Skill if your HP is (25% Total HP) or less",
      },
      {
        trigger: "before-defense-roll",
        target: "opponent",
        type: "reroll",
        roll: "attack",
        rerollScope: "single-result",
        scope: {
          type: "next-rolls",
          roll: "attack",
          count: { type: "literal", value: 3 },
          sourceText: "your opponent re-roll their next 3 attack rolls",
        },
        optional: true,
        sourceText:
          "You lose (10% Current HP) HP. You may have your opponent re-roll their next 3 attack rolls. You must make that choice before rolling your defensive roll against those attack rolls. If your opponent's current HP is higher than yours, this Skill does not take up your turn. You cannot use this Skill if your HP is (25% Total HP) or less",
      },
      {
        trigger: "action-phase",
        target: "self",
        type: "grant-extra-action",
        phase: "action-phase",
        conditions: [
          {
            type: "resource-comparison",
            resource: "hp",
            basis: "current",
            left: "opponent",
            comparison: "higher-than",
            right: "self",
            sourceText: "If your opponent's current HP is higher than yours",
          },
        ],
        sourceText:
          "You lose (10% Current HP) HP. You may have your opponent re-roll their next 3 attack rolls. You must make that choice before rolling your defensive roll against those attack rolls. If your opponent's current HP is higher than yours, this Skill does not take up your turn. You cannot use this Skill if your HP is (25% Total HP) or less",
      },
    ],
  ],
  [
    "move-haokiru-immortal-burst",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: 10 },
        conditions: [
          {
            type: "incoming-damage",
            subject: "self",
            comparison: "at-least",
            value: {
              type: "resource-percent",
              subject: "self",
              resource: "hp",
              basis: "total",
              percent: 20,
            },
            timing: "after-last-turn",
            sourceText:
              "If you received a total amount of damage equal or greater to (20% Total HP) HP after your last turn",
          },
        ],
        sourceText:
          "If you received a total amount of damage equal or greater to (20% Total HP) HP after your last turn, this attack gains 'SUCCESSFUL - Gain 10 KI'",
      },
    ],
  ],
  [
    "move-haokiru-focused-mastery",
    [
      {
        trigger: "start-combat",
        target: "self",
        type: "lock",
        affectedType: "attack",
        selector: {
          type: "move-selector",
          subject: "source",
          styleId: "style-freestyle",
          category: "advanced-attack",
          custom: false,
          sourceText: "your non-custom Freestyle Advanced Attacks",
        },
        duration: { type: "combat", sourceText: "in combat" },
        sourceText:
          "LOCK your non-custom Freestyle Advanced Attacks and Signature Techniques in combat",
      },
      {
        trigger: "start-combat",
        target: "self",
        type: "lock",
        affectedType: "attack",
        selector: {
          type: "move-selector",
          subject: "source",
          styleId: "style-freestyle",
          category: "signature",
          custom: false,
          sourceText: "your non-custom Freestyle Advanced Attacks and Signature Techniques",
        },
        duration: { type: "combat", sourceText: "in combat" },
        sourceText:
          "LOCK your non-custom Freestyle Advanced Attacks and Signature Techniques in combat",
      },
      {
        trigger: "start-combat",
        target: "self",
        type: "lock",
        affectedType: "move",
        selector: {
          type: "move-selector",
          subject: "source",
          styleProvenance: "effect",
          sourceText: "moves that become styled through other effects",
        },
        sourceText: "LOCK moves that become styled through other effects",
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
          basis: "current",
          percent: 10,
        },
        selector: {
          type: "move-selector",
          subject: "source",
          styleId: "style-haokiru",
          category: "advanced-attack",
          sourceText: "All of your Haokiru attacks",
        },
        sourceText:
          'All of your Haokiru attacks gain "SUCCESSFUL - HEAL (10% Current HP) HP and gain 1 KI"',
      },
      {
        trigger: "on-success",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: 1 },
        selector: {
          type: "move-selector",
          subject: "source",
          styleId: "style-haokiru",
          category: "advanced-attack",
          sourceText: "All of your Haokiru attacks",
        },
        sourceText:
          'All of your Haokiru attacks gain "SUCCESSFUL - HEAL (10% Current HP) HP and gain 1 KI"',
      },
    ],
  ],
  [
    "move-haokiru-dragon-dust",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "create-floating-effect",
        floatingEffectId: "dragon-dust-hp-gain-retaliation",
        effects: [
          {
            trigger: "on-resource-gain",
            target: "opponent",
            type: "modify-resource",
            resource: "hp",
            operation: "lose",
            amount: { type: "stat-percent", subject: "self", stat: "power", percent: 10 },
            conditions: [
              {
                type: "resource-change",
                subject: "self",
                resource: "hp",
                operation: "gain",
                timing: "current-event",
                sourceText: "every time you use an effect to gain HP",
              },
            ],
            sourceText:
              "SUCCESSFUL - Your opponent loses (10% Power) HP every time you use an effect to gain HP until they roll an attack roll result of 23 or higher. This effect cannot stack with itself. This effect can only be used once per turn",
          },
        ],
        duration: {
          type: "until-roll-threshold",
          roll: "attack",
          comparison: "at-least",
          value: { type: "literal", value: 23 },
          sourceText: "until they roll an attack roll result of 23 or higher",
        },
        stacking: "prevent",
        useLimit: { scope: "turn", count: 1, sourceText: "only be used once per turn" },
        sourceText:
          "SUCCESSFUL - Your opponent loses (10% Power) HP every time you use an effect to gain HP until they roll an attack roll result of 23 or higher. This effect cannot stack with itself. This effect can only be used once per turn",
      },
    ],
  ],
  [
    "move-haokiru-channeling-mastery",
    [
      {
        trigger: "on-move-use",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "literal", value: 10 },
        scope: { type: "current-action", sourceText: "the attack" },
        activationCost: {
          resource: "hp",
          operation: "lose",
          amount: {
            type: "resource-percent",
            subject: "self",
            resource: "hp",
            basis: "current",
            percent: 5,
          },
        },
        activationGroup: "channeling-mastery-attack",
        optional: true,
        selector: {
          type: "move-selector",
          subject: "source",
          categories: ["advanced-attack", "signature"],
          sourceText: "When you perform an attack",
        },
        sourceText:
          "When you perform an attack, you may lose (5% Current HP) HP to have the attack do +(10% Power) Damage and become UNBLOCKABLE",
      },
      {
        trigger: "on-move-use",
        target: "self",
        type: "prevent-resolution",
        prevention: "block",
        scope: { type: "current-action", sourceText: "the attack" },
        activationCost: {
          resource: "hp",
          operation: "lose",
          amount: {
            type: "resource-percent",
            subject: "self",
            resource: "hp",
            basis: "current",
            percent: 5,
          },
        },
        activationGroup: "channeling-mastery-attack",
        optional: true,
        selector: {
          type: "move-selector",
          subject: "source",
          categories: ["advanced-attack", "signature"],
          sourceText: "When you perform an attack",
        },
        sourceText:
          "When you perform an attack, you may lose (5% Current HP) HP to have the attack do +(10% Power) Damage and become UNBLOCKABLE",
      },
      {
        trigger: "on-resource-drain",
        target: "opponent",
        type: "modify-damage",
        operation: "add",
        percent: { type: "literal", value: -25 },
        scope: { type: "next-action", sourceText: "your opponent's next attack" },
        conditions: [
          {
            type: "resource-change",
            subject: "self",
            resource: "hp",
            operation: "lose",
            timing: "current-event",
            cause: "non-damage-effect",
            sourceText: "When you lose HP from a non-damage effect",
          },
        ],
        sourceText:
          "When you lose HP from a non-damage effect, your opponent's next attack does -25% Damage",
      },
      {
        trigger: "on-move-use",
        target: "self",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: -3 },
        minimum: { type: "literal", value: 3 },
        selector: {
          type: "move-selector",
          subject: "source",
          category: "signature",
          sourceText: "When you perform a Signature Technique",
        },
        activationCost: {
          resource: "hp",
          operation: "lose",
          amount: {
            type: "resource-percent",
            subject: "self",
            resource: "hp",
            basis: "current",
            percent: 10,
          },
        },
        optional: true,
        sourceText:
          "When you perform a Signature Technique, you may lose (10% Current HP) HP to have your Signature Technique costs -3 KI (minimum 3 KI)",
      },
    ],
  ],
  [
    "move-haokiru-eternal-mastery",
    [
      {
        trigger: "on-resource-threshold",
        target: "self",
        type: "modify-resource",
        resource: "hp",
        operation: "gain",
        amount: {
          type: "resource-percent",
          subject: "self",
          resource: "hp",
          basis: "total",
          percent: 10,
        },
        conditions: [
          {
            type: "resource-threshold",
            subject: "self",
            resource: "hp",
            basis: "current",
            comparison: "at-most",
            value: { type: "literal", value: -1 },
            sourceText: "When your HP drops below 0 for the first time in combat",
          },
        ],
        useLimit: { scope: "combat", count: 1, sourceText: "for the first time in combat" },
        sourceText:
          "When your HP drops below 0 for the first time in combat, gain (10% Total HP) HP",
      },
      {
        trigger: "on-resource-gain",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "literal", value: 5 },
        scope: { type: "next-action", sourceText: "your next attack" },
        conditions: [
          {
            type: "resource-change",
            subject: "self",
            resource: "hp",
            operation: "gain",
            timing: "current-event",
            sourceStyleId: "style-haokiru",
            sourceText: "Whenever you gain HP from a Haokiru effect",
          },
        ],
        sourceText:
          "Whenever you gain HP from a Haokiru effect, your next attack does +(5% Power) Damage",
      },
      {
        trigger: "passive",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "literal", value: 5 },
        selector: {
          type: "move-selector",
          subject: "source",
          styleId: "style-haokiru",
          category: "advanced-attack",
          sourceText: "your Haokiru Advanced Attacks",
        },
        conditions: [
          {
            type: "resource-threshold",
            subject: "self",
            resource: "hp",
            basis: "total",
            comparison: "at-most",
            value: {
              type: "resource-percent",
              subject: "self",
              resource: "hp",
              basis: "total",
              percent: 25,
            },
            sourceText: "When at or below (25% Total HP) HP",
          },
        ],
        sourceText:
          "When at or below (25% Total HP) HP, your Haokiru Advanced Attacks do +(5% Power) Damage and have +3 to the result(s)",
      },
      {
        trigger: "passive",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: 3 },
        selector: {
          type: "move-selector",
          subject: "source",
          styleId: "style-haokiru",
          category: "advanced-attack",
          sourceText: "your Haokiru Advanced Attacks",
        },
        conditions: [
          {
            type: "resource-threshold",
            subject: "self",
            resource: "hp",
            basis: "total",
            comparison: "at-most",
            value: {
              type: "resource-percent",
              subject: "self",
              resource: "hp",
              basis: "total",
              percent: 25,
            },
            sourceText: "When at or below (25% Total HP) HP",
          },
        ],
        sourceText:
          "When at or below (25% Total HP) HP, your Haokiru Advanced Attacks do +(5% Power) Damage and have +3 to the result(s)",
      },
    ],
  ],
  [
    "move-haokiru-phoenix-tackle",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-resource-modifier",
        resource: "hp",
        operation: "gain",
        multiplier: { type: "literal", value: 2 },
        selector: {
          type: "move-selector",
          subject: "source",
          styleId: "style-haokiru",
          categoryExcludes: ["block"],
          sourceText: "a non-block Haokiru effect",
        },
        scope: { type: "next-turn", subject: "self", sourceText: "on your next turn" },
        cap: {
          type: "maximum",
          value: {
            type: "resource-percent",
            subject: "self",
            resource: "hp",
            basis: "total",
            percent: 30,
          },
          sourceText: "The total amount healed cannot exceed (30% Total HP) HP",
        },
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 20 },
            sourceText: "If your attack roll result is 20 or higher",
          },
        ],
        sourceText:
          "SUCCESSFUL - If your attack roll result is 20 or higher, double the amount of HP gained from a non-block Haokiru effect on your next turn. The total amount healed cannot exceed (30% Total HP) HP",
      },
    ],
  ],
  [
    "move-haokiru-five-finger-shot",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "prevent-move-modification",
        selector: {
          type: "move-selector",
          subject: "target",
          categories: ["advanced-attack", "signature"],
          sourceText: "their attack's damage or their dice results",
        },
        aspects: ["damage", "roll-results"],
        actor: "opponent",
        duration: {
          type: "until-combat-result",
          actor: "self",
          result: "stopped",
          conditions: [
            {
              type: "attack-roll-resolution",
              actor: "self",
              anyOf: ["single-die-stopped", "all-dice-stopped"],
              sourceText:
                "until one of your single dice attacks are STOPPED or all dice on one of your multi-dice attacks are STOPPED",
            },
          ],
          sourceText:
            "until one of your single dice attacks are STOPPED or all dice on one of your multi-dice attacks are STOPPED",
        },
        sourceText:
          "SUCCESSFUL - Your opponent cannot modify their attack's damage or their dice results until one of your single dice attacks are STOPPED or all dice on one of your multi-dice attacks are STOPPED",
      },
    ],
  ],
  [
    "move-haokiru-martyrdom",
    [
      {
        trigger: "action-phase",
        target: "opponent",
        type: "create-floating-effect",
        floatingEffectId: "martyrdom-retaliation",
        effects: [
          {
            trigger: "on-success",
            target: "opponent",
            type: "modify-resource",
            resource: "hp",
            operation: "lose",
            amount: { type: "triggering-move-base-damage", multiplier: 1 },
            selector: {
              type: "move-selector",
              subject: "target",
              category: "advanced-attack",
              sourceText: "a SUCCESSFUL Advanced Attack",
            },
            sourceText:
              "On your opponent's turn, after your opponent performs a SUCCESSFUL Advanced Attack or Signature Technique, you may have your opponent lose X HP. X = The base damage of the Advanced Attack",
          },
          {
            trigger: "on-success",
            target: "opponent",
            type: "modify-resource",
            resource: "hp",
            operation: "lose",
            amount: { type: "triggering-move-base-damage", multiplier: 0.5 },
            selector: {
              type: "move-selector",
              subject: "target",
              category: "signature",
              sourceText: "a SUCCESSFUL Advanced Attack or Signature Technique",
            },
            sourceText:
              "If that attack was a Signature Technique, X = 1/2 of the base damage for that attack",
          },
        ],
        conditions: [
          {
            type: "resource-threshold",
            subject: "self",
            resource: "hp",
            basis: "total",
            comparison: "at-most",
            value: {
              type: "resource-percent",
              subject: "self",
              resource: "hp",
              basis: "total",
              percent: 50,
            },
            sourceText: "Activate at any point when your HP is below (50% Total HP)",
          },
          {
            type: "moveset",
            subject: "self",
            excludesIds: ["move-haokiru-eternal-mastery", "move-haokiru-survival-instinct"],
            sourceText:
              "This skill may not be in the same moveset as Eternal Mastery or Survival Instinct",
          },
        ],
        duration: {
          type: "until-combat-result",
          actor: "opponent",
          result: "successful",
          moveSelector: {
            type: "move-selector",
            subject: "target",
            categories: ["advanced-attack", "signature"],
            sourceText: "a SUCCESSFUL Advanced Attack or Signature Technique",
          },
          sourceText:
            "after your opponent performs a SUCCESSFUL Advanced Attack or Signature Technique",
        },
        sourceText:
          "Activate at any point when your HP is below (50% Total HP). On your opponent's turn, after your opponent performs a SUCCESSFUL Advanced Attack or Signature Technique, you may have your opponent lose X HP. X = The base damage of the Advanced Attack. If that attack was a Signature Technique, X = 1/2 of the base damage for that attack. This skill may not be in the same moveset as Eternal Mastery or Survival Instinct. You may activate this Skill when your HP reaches 0",
      },
    ],
  ],
  [
    "move-haokiru-halting-stance",
    [
      {
        trigger: "on-stopped",
        target: "self",
        type: "modify-remaining-uses",
        amount: { type: "literal", value: 1 },
        selector: {
          type: "move-selector",
          subject: "source",
          ids: ["move-haokiru-halting-stance"],
          sourceText: "this Block",
        },
        conditions: [
          {
            type: "move-use-count",
            selector: {
              type: "move-selector",
              subject: "source",
              ids: ["move-haokiru-halting-stance"],
              sourceText: "The first time you use this Block",
            },
            comparison: "exactly",
            value: 1,
            timing: "including-current-use",
            sourceText: "The first time you use this Block",
          },
          {
            type: "resource-change",
            subject: "self",
            resource: "ki",
            operation: "lose",
            timing: "within-turns",
            turns: 10,
            cause: "opponent-effect",
            sourceText:
              "if you have lost KI due to your opponent's effects within the last 10 turns",
          },
        ],
        sourceText:
          "The first time you use this Block, if you have lost KI due to your opponent's effects within the last 10 turns, this Block gains RESTRICTED+1",
      },
    ],
  ],
  [
    "move-haokiru-display-of-endurance",
    [
      {
        trigger: "on-stopped",
        target: "self",
        type: "modify-resource",
        resource: "hp",
        operation: "lose",
        amount: { type: "blocked-attack-damage", multiplier: 0.5 },
        sourceText: "You lose (50% of the attack's damage) HP",
      },
      {
        trigger: "on-stopped",
        target: "self",
        type: "create-floating-effect",
        floatingEffectId: "display-of-endurance-blocked-damage-heal",
        effects: [
          {
            trigger: "on-success",
            target: "self",
            type: "modify-resource",
            resource: "hp",
            operation: "gain",
            amount: { type: "blocked-attack-damage", multiplier: 1 },
            scope: { type: "next-action", sourceText: "Your next attack" },
            sourceText:
              "Your next attack gains 'SUCCESSFUL - HEAL (100% of the attack you blocked's damage) HP'",
          },
        ],
        termination: [
          {
            trigger: "on-success",
            actor: "self",
            sourceText:
              "Your next attack gains 'SUCCESSFUL - HEAL (100% of the attack you blocked's damage) HP'",
          },
        ],
        sourceText:
          "Your next attack gains 'SUCCESSFUL - HEAL (100% of the attack you blocked's damage) HP'",
      },
      {
        trigger: "on-stopped",
        target: "self",
        type: "prevent-resource-modification",
        resource: "ki",
        operation: "lose",
        sourceActor: "opponent",
        duration: {
          type: "until-combat-result",
          actor: "opponent",
          result: "successful",
          sourceText: "until they perform a SUCCESSFUL attack",
        },
        sourceText:
          "You cannot lose KI from your opponent's effects until they perform a SUCCESSFUL attack",
      },
    ],
  ],
  [
    "move-haokiru-tornado-uppercut",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-damage-modifier",
        multiplier: { type: "literal", value: 3 },
        scope: { type: "current-action", sourceText: "this attack" },
        conditions: [
          {
            type: "resource-change",
            subject: "self",
            resource: "hp",
            operation: "gain",
            timing: "last-turn",
            sourceText: "If you gained HP on your last turn",
          },
        ],
        sourceText:
          "If you gained HP on your last turn, triple any damage modifiers made to this attack",
      },
      {
        trigger: "passive",
        target: "self",
        type: "modify-damage",
        operation: "add",
        cap: {
          type: "maximum",
          value: { type: "stat-percent", subject: "self", stat: "power", percent: 55 },
          sourceText: "This attack cannot deal more than (55% Power) damage",
        },
        scope: { type: "current-action", sourceText: "This attack" },
        sourceText: "This attack cannot deal more than (55% Power) damage",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "modify-resource-cost",
        resource: "hp",
        operation: "add",
        percent: { type: "literal", value: -100 },
        selector: {
          type: "move-selector",
          subject: "source",
          categories: ["advanced-attack", "mastery", "skill"],
          effectKinds: ["resource-loss"],
          sourceText:
            "the next Advanced Attack, Mastery, or Skill you use that requires you to lose HP to gain an effect",
        },
        scope: {
          type: "next-action",
          sourceText: "the next Advanced Attack, Mastery, or Skill you use",
        },
        activationCost: {
          resource: "ki",
          operation: "lose",
          amount: { type: "literal", value: 1 },
        },
        activationGroup: "tornado-uppercut-hp-loss-choice",
        optional: true,
        stacking: "prevent",
        sourceText:
          "SUCCESSFUL - You may pay 1 KI. If you do, the next Advanced Attack, Mastery, or Skill you use that requires you to lose HP to gain an effect, you do not have to lose HP to gain the effect. You may use this reduce the required HP loss by half on Signature Techniques instead; this effect does not stack",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "modify-resource-cost",
        resource: "hp",
        operation: "add",
        percent: { type: "literal", value: -50 },
        selector: {
          type: "move-selector",
          subject: "source",
          category: "signature",
          effectKinds: ["resource-loss"],
          sourceText: "Signature Techniques",
        },
        scope: { type: "next-action", sourceText: "on Signature Techniques instead" },
        activationCost: {
          resource: "ki",
          operation: "lose",
          amount: { type: "literal", value: 1 },
        },
        activationGroup: "tornado-uppercut-hp-loss-choice",
        optional: true,
        stacking: "prevent",
        sourceText:
          "SUCCESSFUL - You may pay 1 KI. If you do, the next Advanced Attack, Mastery, or Skill you use that requires you to lose HP to gain an effect, you do not have to lose HP to gain the effect. You may use this reduce the required HP loss by half on Signature Techniques instead; this effect does not stack",
      },
    ],
  ],
  [
    "move-haokiru-high-threshold",
    [
      {
        trigger: "before-defense-roll",
        target: "self",
        type: "substitute-defense",
        payment: {
          resource: "hp",
          amount: {
            type: "resource-percent",
            subject: "self",
            resource: "hp",
            basis: "total",
            percent: 10,
          },
        },
        selector: {
          type: "move-selector",
          subject: "target",
          tags: ["energy"],
          categoryExcludes: ["signature"],
          sourceText:
            "in place of a defensive roll to STOP an energy attack. This cannot stop Signature Techniques",
        },
        outcome: "stop",
        optional: true,
        sourceText:
          "You may lose (10% Total HP) HP in place of a defensive roll to STOP an energy attack. This cannot stop Signature Techniques",
      },
      {
        trigger: "on-resource-threshold",
        target: "self",
        type: "deactivate",
        affectedType: "skill",
        selector: {
          type: "move-selector",
          subject: "source",
          ids: ["move-haokiru-high-threshold"],
          sourceText: "This Skill is DEACTIVATED",
        },
        conditions: [
          {
            type: "resource-threshold",
            subject: "self",
            resource: "hp",
            basis: "total",
            comparison: "at-most",
            value: {
              type: "resource-percent",
              subject: "self",
              resource: "hp",
              basis: "total",
              percent: 50,
            },
            sourceText: "if you fall below (50% Total HP) HP",
          },
        ],
        sourceText:
          "This Skill is DEACTIVATED and refunds the Ki you spent on it if you fall below (50% Total HP) HP",
      },
      {
        trigger: "on-resource-threshold",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "paid-activation-cost", resource: "ki" },
        conditions: [
          {
            type: "resource-threshold",
            subject: "self",
            resource: "hp",
            basis: "total",
            comparison: "at-most",
            value: {
              type: "resource-percent",
              subject: "self",
              resource: "hp",
              basis: "total",
              percent: 50,
            },
            sourceText: "if you fall below (50% Total HP) HP",
          },
        ],
        sourceText:
          "This Skill is DEACTIVATED and refunds the Ki you spent on it if you fall below (50% Total HP) HP",
      },
    ],
  ],
  [
    "move-haokiru-karmic-chameleon-mastery",
    [
      {
        trigger: "start-combat",
        target: "self",
        type: "grant-mastery",
        source: "opponent",
        duration: { type: "combat", sourceText: "this Match" },
        sourceText:
          "At the start of the match, choose an opponent. You are considered to have that opponent's Mastery",
      },
      {
        trigger: "start-combat",
        target: "self",
        type: "grant-temporary-move-use",
        source: "opponent",
        category: "advanced-attack",
        selectionKey: "karmic-chameleon-advanced-attack",
        duration: { type: "combat", sourceText: "this Match" },
        sourceText:
          "Choose one of your opponent's Advanced Attacks. You may use that attack this Match",
      },
      {
        trigger: "start-combat",
        target: "self",
        type: "grant-temporary-move-use",
        source: "opponent",
        category: "skill",
        selectionKey: "karmic-chameleon-skill",
        duration: { type: "combat", sourceText: "this Match" },
        sourceText: "Choose one of your opponent's Skills. You may use that skill this Match",
      },
      {
        trigger: "start-combat",
        target: "self",
        type: "modify-move-classification",
        setStyleId: "style-haokiru",
        selector: {
          type: "move-selector",
          subject: "source",
          selectionKey: "karmic-chameleon-advanced-attack",
          sourceText: "All of your chosen techniques are considered Haokiru",
        },
        duration: { type: "combat", sourceText: "this Match" },
        sourceText: "All of your chosen techniques are considered Haokiru",
      },
      {
        trigger: "start-combat",
        target: "self",
        type: "modify-move-classification",
        setStyleId: "style-haokiru",
        selector: {
          type: "move-selector",
          subject: "source",
          selectionKey: "karmic-chameleon-skill",
          sourceText: "All of your chosen techniques are considered Haokiru",
        },
        duration: { type: "combat", sourceText: "this Match" },
        sourceText: "All of your chosen techniques are considered Haokiru",
      },
      {
        trigger: "start-combat",
        target: "self",
        type: "override-style-reference",
        selectionKeys: ["karmic-chameleon-advanced-attack", "karmic-chameleon-skill"],
        styleId: "style-haokiru",
        duration: { type: "combat", sourceText: "this Match" },
        sourceText:
          "Any effects referring to Martial Arts Style are considered to refer to Haokiru instead",
      },
    ],
  ],
]);

export const HAOKIRU_MOVES: readonly MoveDefinition[] = createStyleMoves(HAOKIRU_STYLE).map(
  (move) => ({
    ...move,
    ...(structuredEffectsByMoveId.has(move.id)
      ? { effects: structuredEffectsByMoveId.get(move.id) }
      : {}),
  }),
);
