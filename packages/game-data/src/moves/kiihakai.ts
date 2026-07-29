import type { EffectDefinition } from "../shared/effects.js";
import { KIIHAKAI_STYLE } from "../styles/kiihakai.js";
import { createStyleMoves } from "./create-style-moves.js";

const structuredEffectsByMoveId = new Map<string, readonly EffectDefinition[]>([
  [
    "move-kiihakai-orange-burst",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-damage",
        operation: "set",
        percent: { type: "literal", value: 20 },
        scope: { type: "current-action", sourceText: "this attack" },
        activationGroup: "orange-burst-reduced-damage-deactivation",
        sourceText: "SUCCESSFUL - You may choose for this attack to do (20% Power) Damage instead",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "deactivate",
        affectedType: "skill",
        selector: {
          type: "move-selector",
          subject: "target",
          constant: true,
          sourceText: "one of your opponent's CONSTANT Skills",
        },
        activationGroup: "orange-burst-reduced-damage-deactivation",
        sourceText:
          "SUCCESSFUL - You may choose for this attack to do (20% Power) Damage instead. If you do, you may DEACTIVATE one of your opponent's CONSTANT Skills",
      },
    ],
  ],
  [
    "move-kiihakai-kinetic-outburst",
    [
      {
        trigger: "before-attack-roll",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: -10 },
        scope: { type: "current-action", sourceText: "it" },
        activationGroup: "kinetic-outburst-roll-penalty-activation",
        sourceText:
          "Before you roll your attack roll, you may choose for it to gain -10 to the result",
      },
      {
        trigger: "before-attack-roll",
        target: "self",
        type: "activate",
        selector: {
          type: "move-selector",
          subject: "source",
          constant: true,
          sourceText: "a Skill with a CONSTANT effect",
        },
        activationGroup: "kinetic-outburst-roll-penalty-activation",
        sourceText:
          "Before you roll your attack roll, you may choose for it to gain -10 to the result. If you do, you may activate a Skill with a CONSTANT effect",
      },
    ],
  ],
  [
    "move-kiihakai-overdrive-mastery",
    [
      {
        trigger: "on-power-up",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "source-expression", text: "15% Power" },
        selector: {
          type: "move-selector",
          subject: "target",
          styleId: "style-kiihakai",
          category: "advanced-attack",
          sourceText: "a Kiihakai Advanced Attack",
        },
        scope: { type: "next-turn", subject: "self", sourceText: "on your next turn" },
        sourceText:
          "Activate when you Power Up. If you perform a Kiihakai Advanced Attack on your next turn, the attack does +(15% Power) Damage",
      },
    ],
  ],
  [
    "move-kiihakai-thunder-ball",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: {
          type: "source-expression",
          text: "The number of Skills with CONSTANT effects you have activated this combat x2",
        },
        cap: {
          type: "maximum",
          value: { type: "literal", value: 8 },
          sourceText: "may gain up to +8 to the result",
        },
        scope: { type: "current-action", sourceText: "Your attack roll" },
        sourceText:
          "Your attack roll gains +X to the result. X = The number of Skills with CONSTANT effects you have activated this combat x2 to a maximum of +6. This move ignores normal damage modification rules and may gain up to +8 to the result",
      },
    ],
  ],
  [
    "move-kiihakai-the-heartstopper",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: 2 },
        selector: {
          type: "move-selector",
          subject: "target",
          category: "advanced-attack",
          sourceText: "Advanced Attacks and Signature Techniques",
        },
        duration: {
          type: "until-roll-threshold",
          roll: "attack",
          comparison: "at-least",
          value: { type: "literal", value: 20 },
          sourceText: "until they roll a 20 or higher on an Advanced Attack or Signature Technique",
        },
        sourceText:
          "SUCCESSFUL - Your opponent's Advanced Attacks and Signature Techniques cost +2 KI to perform until they roll a 20 or higher on an Advanced Attack or Signature Technique",
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
          category: "signature",
          sourceText: "Advanced Attacks and Signature Techniques",
        },
        duration: {
          type: "until-roll-threshold",
          roll: "attack",
          comparison: "at-least",
          value: { type: "literal", value: 20 },
          sourceText: "until they roll a 20 or higher on an Advanced Attack or Signature Technique",
        },
        sourceText:
          "SUCCESSFUL - Your opponent's Advanced Attacks and Signature Techniques cost +2 KI to perform until they roll a 20 or higher on an Advanced Attack or Signature Technique",
      },
    ],
  ],
  [
    "move-kiihakai-negative-outburst",
    [
      {
        trigger: "on-stopped",
        target: "opponent",
        type: "force-action",
        allowedCategories: ["advanced-attack", "signature"],
        allowedTags: ["energy"],
        allowPass: true,
        scope: { type: "next-turn", subject: "opponent", sourceText: "on their next turn" },
        sourceText: "Your opponent must perform an energy attack on their next turn or pass",
      },
      {
        trigger: "on-stopped",
        target: "opponent",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: 1 },
        selector: {
          type: "move-selector",
          subject: "target",
          tags: ["energy"],
          sourceText: "Your opponent's next energy attack",
        },
        scope: { type: "next-action", sourceText: "Your opponent's next energy attack" },
        sourceText: "Your opponent's next energy attack costs +1 KI to perform",
      },
    ],
  ],
  [
    "move-kiihakai-boomerang",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-cost",
        operation: "set",
        amount: {
          type: "source-expression",
          text: "The cost of your opponent's next attack",
        },
        selector: {
          type: "move-selector",
          subject: "source",
          sourceText: "this attack",
        },
        scope: { type: "next-turn", subject: "self", sourceText: "on your next turn" },
        sourceText:
          "SUCCESSFUL - You may perform this attack on your next turn for X KI instead. X = The cost of your opponent's next attack",
      },
    ],
  ],
  [
    "move-kiihakai-fade-attack",
    [
      {
        trigger: "passive",
        target: "opponent",
        type: "set-roll-selection",
        roll: "defense",
        diceCount: { type: "literal", value: 2 },
        selection: "lowest",
        scope: { type: "current-action", sourceText: "against this attack" },
        sourceText: "Your opponent has DISADVANTAGE against this attack",
      },
    ],
  ],
  [
    "move-kiihakai-shooting-star",
    [
      {
        trigger: "passive",
        target: "opponent",
        type: "set-resolution-threshold",
        outcome: "stop",
        roll: "defense",
        comparison: "at-least",
        value: { type: "source-expression", text: "double your attack roll" },
        relativeTo: "attack-roll",
        resultScope: "current-attack",
        sourceText:
          "Your opponent's defensive roll must be double your attack roll to stop this attack",
      },
    ],
  ],
  [
    "move-kiihakai-channeled-chi-mastery",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-slot-capacity",
        slot: "skill",
        amount: { type: "literal", value: 1 },
        sourceText: "You gain +1 Skill slot in your moveset",
      },
      {
        trigger: "passive",
        target: "self",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: -2 },
        minimum: { type: "literal", value: 1 },
        selector: {
          type: "move-selector",
          subject: "target",
          styleId: "style-kiihakai",
          category: "skill",
          sourceText: "Your Kiihakai Skills",
        },
        sourceText: "Your Kiihakai Skills cost -2 KI to a minimum of 1",
      },
    ],
  ],
  [
    "move-kiihakai-aerial-domination-mastery",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "sides",
        amount: { type: "literal", value: 2 },
        selector: {
          type: "move-selector",
          subject: "target",
          effectTextIncludes: "Bukujutsu",
          sourceText: 'Your attacks with "Requirement: Bukujutsu"',
        },
        sourceText: 'Your attacks with "Requirement: Bukujutsu" gain +2 dice sides',
      },
    ],
  ],
  [
    "move-kiihakai-power-surge-mastery",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "source-expression", text: "5% Power" },
        selector: {
          type: "move-selector",
          subject: "target",
          styleId: KIIHAKAI_STYLE.id,
          category: "advanced-attack",
          sourceText: "Your Kiihakai attacks",
        },
        sourceText: "Your Kiihakai attacks do +(5% Power) Damage",
      },
      {
        trigger: "on-power-up",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: 1 },
        cap: {
          type: "maximum",
          value: { type: "literal", value: 4 },
          sourceText: "to a maximum of 4 KI that turn",
        },
        scope: { type: "current-action", sourceText: "that turn" },
        sourceText: "When you power up, gain +1 KI to a maximum of 4 KI that turn",
      },
    ],
  ],
  [
    "move-kiihakai-focused-chi-barrage",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "grant-extra-action",
        phase: "action-phase",
        moveCategory: "skill",
        constant: true,
        conditions: [
          {
            type: "successful-hit-count",
            comparison: "exactly",
            value: { type: "literal", value: 2 },
            sourceText: "If both dice rolls are SUCCESSFUL",
          },
        ],
        sourceText:
          "If both dice rolls are SUCCESSFUL, activate one of your Skills with a 'CONSTANT' effect",
      },
    ],
  ],
  [
    "move-kiihakai-focus-buster",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "skip-action",
        blockedCategories: ["advanced-attack", "signature"],
        scope: { type: "next-turn", subject: "self", sourceText: "on your next turns" },
        sourceText: "SUCCESSFUL - You and your opponent cannot attack on your next turns",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "skip-action",
        blockedCategories: ["advanced-attack", "signature"],
        scope: { type: "next-turn", subject: "opponent", sourceText: "on your next turns" },
        sourceText: "SUCCESSFUL - You and your opponent cannot attack on your next turns",
      },
    ],
  ],
  [
    "move-kiihakai-stray-bullet",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "source-expression", text: "10% Power" },
        scope: { type: "next-action", sourceText: "Your next attack" },
        sourceText: "SUCCESSFUL - Your next attack does +(10% Power) Damage",
      },
    ],
  ],
  [
    "move-kiihakai-sledgehammer",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: 2 },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 3 },
          sourceText: "for the next 3 turns",
        },
        stacking: "prevent",
        conditions: [
          {
            type: "stat-comparison",
            left: "self",
            stat: "power",
            comparison: "higher-than",
            right: "opponent",
            rightStat: "dexterity",
            rightMultiplier: { type: "literal", value: 20 },
            sourceText: "If your Power is more than 20 times your opponent's Dexterity",
          },
        ],
        sourceText:
          "SUCCESSFUL - If your Power is more than 20 times your opponent's Dexterity, your dice gain +2 results for the next 3 turns. This effect does not stack with itself",
      },
    ],
  ],
  [
    "move-kiihakai-omega-beam",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "deactivate",
        affectedType: "skill",
        count: { type: "literal", value: 1 },
        conditions: [
          {
            type: "move-selector",
            subject: "target",
            category: "skill",
            constant: true,
            sourceText: "a CONSTANT Skill",
          },
        ],
        sourceText: "SUCCESSFUL - You may DEACTIVATE a CONSTANT Skill",
      },
    ],
  ],
  [
    "move-kiihakai-orbital-cannon",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "lock",
        affectedType: "attack",
        selector: {
          type: "move-selector",
          subject: "target",
          category: "advanced-attack",
          baseKiCost: { comparison: "at-most", value: { type: "literal", value: 1 } },
          sourceText: "that cost 1 or less KI (including modifications)",
        },
        duration: {
          type: "until-roll-threshold",
          roll: "attack",
          comparison: "at-least",
          value: { type: "literal", value: 25 },
          sourceText: "until they roll an attack roll of 25 or higher",
        },
        sourceText:
          "SUCCESSFUL - LOCK your opponent's Advanced Attacks and Skills that cost 1 or less KI (including modifications) until they roll an attack roll of 25 or higher",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "lock",
        affectedType: "skill",
        selector: {
          type: "move-selector",
          subject: "target",
          category: "skill",
          baseKiCost: { comparison: "at-most", value: { type: "literal", value: 1 } },
          sourceText:
            "Advanced Attacks and Skills that cost 1 or less KI (including modifications)",
        },
        duration: {
          type: "until-roll-threshold",
          roll: "attack",
          comparison: "at-least",
          value: { type: "literal", value: 25 },
          sourceText: "until they roll an attack roll of 25 or higher",
        },
        sourceText:
          "SUCCESSFUL - LOCK your opponent's Advanced Attacks and Skills that cost 1 or less KI (including modifications) until they roll an attack roll of 25 or higher",
      },
    ],
  ],
  [
    "move-kiihakai-aura-burst",
    [
      {
        trigger: "action-phase",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: 2 },
        useLimit: { scope: "combat", count: 1, sourceText: "RESTRICTEDx1" },
        sourceText: "RESTRICTEDx1. Gain 2 KI",
      },
    ],
  ],
  [
    "move-kiihakai-eagle-eye",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "sides",
        amount: { type: "literal", value: 3 },
        selector: {
          type: "move-selector",
          subject: "target",
          effectTextIncludes: "Bukujutsu",
          sourceText: "Your attacks that require Bukujutsu",
        },
        sourceText:
          "Your attacks that require Bukujutsu gain +3 dice sides and do +(10% Power) Damage",
      },
      {
        trigger: "passive",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "source-expression", text: "10% Power" },
        selector: {
          type: "move-selector",
          subject: "target",
          effectTextIncludes: "Bukujutsu",
          sourceText: "Your attacks that require Bukujutsu",
        },
        sourceText:
          "Your attacks that require Bukujutsu gain +3 dice sides and do +(10% Power) Damage",
      },
    ],
  ],
  [
    "move-kiihakai-protective-aura",
    [
      {
        trigger: "passive",
        target: "opponent",
        type: "modify-damage",
        operation: "add",
        percent: { type: "literal", value: -10 },
        sourceText:
          "While this Skill is active, your opponent's attacks do -10% Damage against you",
      },
    ],
  ],
  [
    "move-kiihakai-heavy-jolt",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "lock",
        affectedType: "power-up",
        scope: { type: "next-turn", subject: "opponent", sourceText: "on their next turn" },
        sourceText: "SUCCESSFUL - Your opponent cannot Power Up on their next turn",
      },
    ],
  ],
  [
    "move-kiihakai-earthpound",
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
          tags: ["energy"],
          attackRoll: { dice: 1 },
          sourceText: "next single dice energy attack",
        },
        scope: { type: "next-action", sourceText: "next single dice energy attack" },
        sourceText: "SUCCESSFUL - Your next single dice energy attack gains +3 to the result",
      },
    ],
  ],
  [
    "move-kiihakai-aerial-beam",
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
          "SUCCESSFUL - If your attack roll is 20 or higher, LOCK your opponent's physical attacks for their next turn",
      },
    ],
  ],
  [
    "move-kiihakai-power-deflection",
    [
      {
        trigger: "on-stopped",
        target: "opponent",
        type: "modify-resource",
        resource: "hp",
        operation: "lose",
        amount: { type: "source-expression", text: "15% Power" },
        conditions: [
          {
            type: "move-selector",
            subject: "target",
            tags: ["energy"],
            sourceText: "an energy attack",
          },
          {
            type: "roll-threshold",
            roll: "defense",
            comparison: "at-least",
            value: { type: "literal", value: 20 },
            sourceText: "a defensive roll of 20 or higher",
          },
        ],
        sourceText:
          "Whenever you STOP an energy attack with a defensive roll of 20 or higher, your opponent loses (15% Power) HP",
      },
    ],
  ],
  [
    "move-kiihakai-ki-shield",
    [
      {
        trigger: "passive",
        target: "opponent",
        type: "set-resolution-threshold",
        outcome: "successful",
        roll: "attack",
        comparison: "at-least",
        value: { type: "literal", value: 3 },
        relativeTo: "defense-roll",
        resultScope: "matching-die",
        sourceText:
          "Your opponent must have an attack roll of +3 or higher your defensive roll in order for their attack to be SUCCESSFUL",
      },
      {
        trigger: "passive",
        target: "opponent",
        type: "set-resolution-threshold",
        outcome: "successful",
        roll: "attack",
        comparison: "at-least",
        value: { type: "literal", value: 5 },
        relativeTo: "defense-roll",
        resultScope: "matching-die",
        conditions: [
          {
            type: "roll-threshold",
            roll: "defense",
            comparison: "at-most",
            value: { type: "literal", value: 5 },
            sourceText: "If your defensive roll is 5 or less",
          },
        ],
        sourceText:
          "If your defensive roll is 5 or less, their attack roll must be +5 or more your defensive roll in order for their attack to be SUCCESSFUL instead",
      },
    ],
  ],
  [
    "move-kiihakai-overload",
    [
      {
        trigger: "on-power-up",
        target: "opponent",
        type: "set-resolution-threshold",
        outcome: "stop",
        roll: "defense",
        comparison: "at-most",
        value: { type: "literal", value: 15 },
        resultScope: "current-attack",
        selector: {
          type: "move-selector",
          subject: "target",
          category: "advanced-attack",
          sourceText: "your next non-Signature Technique attack roll",
        },
        scope: { type: "next-action", sourceText: "your next non-Signature Technique attack roll" },
        sourceText:
          "After Powering Up, your opponent cannot STOP your next non-Signature Technique attack roll with a defensive roll of 15 or less",
      },
    ],
  ],
  [
    "move-kiihakai-beam-redirection",
    [
      {
        trigger: "on-stopped",
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
        trigger: "on-stopped",
        target: "opponent",
        type: "lock",
        affectedType: "attack",
        selector: {
          type: "move-selector",
          subject: "target",
          tags: ["energy"],
          sourceText: "that same energy attack",
        },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 4 },
          sourceText: "for their next 4 turns",
        },
        sourceText: "LOCK that same energy attack for their next 4 turns",
      },
    ],
  ],
  [
    "move-kiihakai-ki-fist-block",
    [
      {
        trigger: "on-stopped",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: 1 },
        useLimit: { scope: "combat", count: 1, sourceText: "RESTRICTEDx1" },
        sourceText:
          "RESTRICTEDx1. Block. Stop a physical attack. If you have at least 2 CONSTANT Skills active, this Block costs 0 KI. Gain 1 KI",
      },
    ],
  ],
  [
    "move-kiihakai-too-hot-to-touch",
    [
      {
        trigger: "on-stopped",
        target: "opponent",
        type: "modify-resource",
        resource: "hp",
        operation: "lose",
        amount: { type: "source-expression", text: "10% Power" },
        sourceText: "Your opponent loses (10% Power) HP",
      },
      {
        trigger: "on-resource-threshold",
        target: "opponent",
        type: "modify-resource",
        resource: "hp",
        operation: "set",
        amount: { type: "literal", value: 1 },
        conditions: [
          {
            type: "resource-threshold",
            subject: "opponent",
            resource: "hp",
            basis: "current",
            comparison: "at-most",
            value: { type: "literal", value: -1 },
            sourceText: "If your opponent's HP falls below 0 with this effect",
          },
        ],
        sourceText:
          "If your opponent's HP falls below 0 with this effect, their HP is set to 1 instead",
      },
    ],
  ],
  [
    "move-kiihakai-static-shot",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "prevent-move-modification",
        actor: "opponent",
        aspects: ["cost", "damage", "dice-sides", "effects", "roll-results"],
        selector: {
          type: "move-selector",
          subject: "target",
          category: "advanced-attack",
          sourceText: "their attacks",
        },
        scope: { type: "next-turn", subject: "opponent", sourceText: "for their next 3 turns" },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 3 },
          sourceText: "for their next 3 turns",
        },
        conditions: [
          {
            type: "roll-comparison",
            left: "attack",
            comparison: "at-least",
            right: "defense",
            rightMultiplier: { type: "literal", value: 2 },
            sourceText: "If your attack roll is double or more your opponent's defensive roll",
          },
        ],
        sourceText:
          "SUCCESSFUL - If your attack roll is double or more your opponent's defensive roll, your opponent cannot modify the cost, damage, roll, or result of their attacks for their next 3 turns",
      },
    ],
  ],
  [
    "move-kiihakai-brutal-knockback",
    [
      {
        trigger: "before-attack-roll",
        target: "opponent",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: 2 },
        selector: {
          type: "move-selector",
          subject: "target",
          tags: ["physical"],
          sourceText: "All physical attacks",
        },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 3 },
          sourceText: "for the next 3 turns",
        },
        sourceText: "All physical attacks cost +2 KI to perform for the next 3 turns",
      },
    ],
  ],
  [
    "move-kiihakai-display-of-power",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "lock",
        affectedType: "attack",
        selector: {
          type: "move-selector",
          subject: "target",
          tags: ["energy"],
          sourceText: "your opponent's energy attacks",
        },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 2 },
          sourceText: "for their next 2 turns",
        },
        sourceText: "SUCCESSFUL - LOCK your opponent's energy attacks for their next 2 turns",
      },
    ],
  ],
  [
    "move-kiihakai-heat-seeking-blast",
    [
      {
        trigger: "before-attack-roll",
        target: "self",
        type: "skip-action",
        blockedCategories: ["advanced-attack", "signature"],
        scope: { type: "next-turn", subject: "self", sourceText: "on your next turn" },
        sourceText: "You may not attack or Power Up on your next turn",
      },
      {
        trigger: "before-attack-roll",
        target: "self",
        type: "lock",
        affectedType: "power-up",
        scope: { type: "next-turn", subject: "self", sourceText: "on your next turn" },
        sourceText: "You may not attack or Power Up on your next turn",
      },
    ],
  ],
  [
    "move-kiihakai-triple-shot",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-damage",
        operation: "add",
        percent: { type: "source-expression", text: "-20% Power" },
        scope: { type: "next-action", sourceText: "Your opponent's next attack" },
        sourceText: "SUCCESSFUL - Your opponent's next attack does -(20% Power) Damage",
      },
    ],
  ],
  [
    "move-kiihakai-golden-arrows",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "lock",
        affectedType: "power-up",
        duration: {
          type: "turns",
          turns: { type: "literal", value: 3 },
          sourceText: "until after their next 3 turns",
        },
        sourceText:
          "SUCCESSFUL - Your opponent cannot Power Up or use or activate a Skill until after their next 3 turns",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "lock",
        affectedType: "skill",
        duration: {
          type: "turns",
          turns: { type: "literal", value: 3 },
          sourceText: "until after their next 3 turns",
        },
        sourceText:
          "SUCCESSFUL - Your opponent cannot Power Up or use or activate a Skill until after their next 3 turns",
      },
    ],
  ],
  [
    "move-kiihakai-planetary-uproar",
    [
      {
        trigger: "on-stopped",
        target: "self",
        type: "modify-cost",
        operation: "set",
        amount: { type: "literal", value: 0 },
        selector: {
          type: "move-selector",
          subject: "target",
          category: "skill",
          sourceText: "Your Skills",
        },
        duration: { type: "combat", sourceText: "for the remainder of combat" },
        sourceText:
          "STOPPED - Your Skills for the remainder of combat cost 0 KI to use or activate",
      },
    ],
  ],
  [
    "move-kiihakai-raindance",
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
          baseKiCost: { comparison: "at-least", value: { type: "literal", value: 7 } },
          sourceText: "Signature Techniques with a base cost of 7 or more",
        },
        duration: { type: "combat", sourceText: "for the remainder of combat" },
        conditions: [
          {
            type: "successful-hit-count",
            comparison: "at-least",
            value: { type: "literal", value: 5 },
            sourceText: "If 5 or more dice rolls are SUCCESSFUL",
          },
        ],
        sourceText:
          "SUCCESSFUL - If 5 or more dice rolls are SUCCESSFUL, LOCK your opponent's Signature Techniques with a base cost of 7 or more for the remainder of combat",
      },
    ],
  ],
]);

export const KIIHAKAI_MOVES = createStyleMoves(KIIHAKAI_STYLE).map((move) => ({
  ...move,
  ...(structuredEffectsByMoveId.has(move.id)
    ? { effects: structuredEffectsByMoveId.get(move.id) }
    : {}),
}));
