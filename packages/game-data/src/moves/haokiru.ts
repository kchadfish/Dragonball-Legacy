import { HAOKIRU_STYLE } from "../styles/haokiru.js";
import type { EffectDefinition } from "../shared/effects.js";
import type { MoveDefinition } from "../shared/types.js";
import { createStyleMoves } from "./create-style-moves.js";

const structuredEffectsByMoveId = new Map<string, readonly EffectDefinition[]>([
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
        percent: { type: "source-expression", text: "-50% Damage" },
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
          type: "source-expression",
          text: "5% Total HP for every SUCCESSFUL dice roll result above 20",
        },
        cap: {
          type: "maximum",
          value: { type: "source-expression", text: "50% Total HP" },
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
        amount: { type: "source-expression", text: "5% Total HP" },
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
            value: { type: "source-expression", text: "15% Total HP" },
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
        amount: { type: "source-expression", text: "10% Total HP" },
        scope: { type: "next-action", sourceText: "Your next attack" },
        conditions: [
          {
            type: "resource-threshold",
            subject: "self",
            resource: "hp",
            basis: "current",
            comparison: "at-most",
            value: { type: "source-expression", text: "15% Total HP" },
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
        amount: { type: "source-expression", text: "10% Total HP" },
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
        amount: { type: "source-expression", text: "10% Total HP" },
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
        amount: { type: "source-expression", text: "20% Total HP" },
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
        percent: { type: "literal", value: -50 },
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
        amount: { type: "source-expression", text: "10% Total HP" },
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
        percent: { type: "literal", value: -10 },
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
        amount: { type: "source-expression", text: "The base cost of the attack" },
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
        amount: { type: "source-expression", text: "10% Current HP" },
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
        amount: { type: "source-expression", text: "the Base Damage dealt" },
        cap: {
          type: "maximum",
          value: { type: "source-expression", text: "15% Total HP" },
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
        percent: {
          type: "source-expression",
          text: "The number of SUCCESSFUL hits x5",
        },
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
        amount: { type: "source-expression", text: "10% Current HP" },
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
        amount: { type: "source-expression", text: "10% Total HP" },
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
        amount: { type: "source-expression", text: "25% Damage" },
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
        amount: {
          type: "source-expression",
          text: "The percentage of damage the attack would have done divided by 10",
        },
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
        amount: { type: "source-expression", text: "5% Total HP per hit" },
        sourceText: "SUCCESSFUL - Gain (5% Total HP) per hit",
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
