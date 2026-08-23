import type { EffectDefinition } from "../shared/effects.js";
import { FREESTYLE_STYLE } from "../styles/freestyle.js";
import { MIDORIKATAI_STYLE } from "../styles/midorikatai.js";
import { createStyleMoves } from "./create-style-moves.js";

const structuredEffectsByMoveId = new Map<string, readonly EffectDefinition[]>([
  [
    "move-midorikatai-test-of-strength",
    [
      {
        trigger: "on-move-use",
        target: "participants",
        type: "resolve-contest",
        rolls: { dice: 1, sides: 10, repetitions: 3 },
        qualifyingThreshold: { default: 5, whenSelfPowerHigher: 6 },
        loser: "lower-qualifying-count",
        tie: "self-wins",
        penalty: {
          resource: "hp",
          amount: { type: "stat-percent", subject: "self", stat: "power", percent: 55 },
        },
        sourceText:
          "You and your opponent roll 1d10 three times each. The person who rolls 5 or higher the most times loses (55% Your Power) HP. If you have higher power than your opponent, you count how many roll are 6 or higher instead",
      },
    ],
  ],
  [
    "move-midorikatai-leg-vice",
    [
      {
        trigger: "on-move-use",
        target: "opponent",
        type: "modify-stat",
        stat: "dexterity-bonus",
        operation: "set",
        amount: { type: "literal", value: 0 },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 2 },
          sourceText: "for their next 2 turns",
        },
        useLimit: { scope: "combat", count: 1, sourceText: "RESTRICTEDx1" },
        sourceText: "Your opponent loses their Dexterity Bonus for their next 2 turns",
      },
      {
        trigger: "on-move-use",
        target: "opponent",
        type: "prevent-resolution",
        prevention: "block",
        scope: { type: "next-action", sourceText: "your next attack" },
        conditions: [
          {
            type: "active-move-count",
            subject: "either",
            selector: {
              type: "move-selector",
              subject: "source",
              category: "skill",
              constant: true,
              sourceText: "any CONSTANT Skills are active",
            },
            comparison: "at-least",
            value: { type: "literal", value: 1 },
            sourceText: "If any CONSTANT Skills are active",
          },
        ],
        sourceText: "If any CONSTANT Skills are active, your next attack cannot be BLOCKED",
      },
    ],
  ],
  [
    "move-midorikatai-smackdown",
    [
      {
        trigger: "passive",
        target: "self",
        type: "prevent-move-modification",
        selector: {
          type: "move-selector",
          subject: "source",
          ids: ["move-midorikatai-smackdown"],
          sourceText: "The cost of this attack",
        },
        aspects: ["cost"],
        actor: "any",
        sourceText: "The cost of this attack cannot be reduced",
      },
      {
        trigger: "passive",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "literal", value: 15 },
        scope: { type: "current-action", sourceText: "this attack" },
        conditions: [
          {
            type: "prior-action",
            actor: "opponent",
            selector: {
              type: "move-selector",
              subject: "target",
              category: "advanced-attack",
              requirementIncludes: ["Bukujutsu"],
              sourceText: "your opponent's last Advanced Attack required Bukujutsu",
            },
            sourceText: "If your opponent's last Advanced Attack required Bukujutsu",
          },
        ],
        sourceText:
          "If your opponent's last Advanced Attack required Bukujutsu, this attack does +(15% Power) Damage",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "suppress-requirement",
        requirement: "Bukujutsu",
        duration: {
          type: "turns",
          turns: { type: "literal", value: 2 },
          sourceText: "for their next 2 turns",
        },
        sourceText:
          "SUCCESSFUL - Your opponent is considered to not have Bukujutsu for their next 2 turns",
      },
    ],
  ],
  [
    "move-midorikatai-back-suplex",
    [
      {
        trigger: "passive",
        target: "self",
        type: "set-combat-result",
        result: "successful",
        resultScope: "current-attack",
        sourceText:
          "This attack counts as SUCCESSFUL for all effects. If a SUCCESSFUL effect is applied to this attack, you gain the effect even if it is STOPPED",
      },
    ],
  ],
  [
    "move-midorikatai-rocket-fire",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-stat",
        stat: "dexterity",
        operation: "set",
        amount: { type: "stat-quotient", subject: "self", stat: "power", divisor: 20 },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 2 },
          sourceText: "For your next 2 turns",
        },
        sourceText:
          "SUCCESSFUL - For your next 2 turns, your Dexterity is equal to your [Power / 20] instead",
      },
    ],
  ],
  [
    "move-midorikatai-gut-punch",
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
          category: "skill",
          sourceText: "Your opponent's Skills",
        },
        duration: {
          type: "until-combat-result",
          actor: "opponent",
          result: "successful",
          moveSelector: {
            type: "move-selector",
            subject: "source",
            sourceText: "they perform a SUCCESSFUL attack",
          },
          sourceText: "until they perform a SUCCESSFUL attack",
        },
        stacking: "prevent",
        sourceText:
          "SUCCESSFUL - Your opponent's Skills cost +2 KI to use or activate until they perform a SUCCESSFUL attack. This effect does not stack with itself",
      },
    ],
  ],
  [
    "move-midorikatai-kneebreaker",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "apply-status",
        statusId: "break",
        conditions: [
          {
            type: "prior-action",
            actor: "opponent",
            selector: {
              type: "move-selector",
              subject: "source",
              baseKiCost: { comparison: "at-least", value: { type: "literal", value: 2 } },
              sourceText: "an attack on their last turn with a base KI cost of 2 or higher",
            },
            sourceText:
              "If your opponent performed an attack on their last turn with a base KI cost of 2 or higher",
          },
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 22 },
            sourceText: "If your attack roll result is 22 or higher",
          },
        ],
        sourceText:
          'If your opponent performed an attack on their last turn with a base KI cost of 2 or higher, this attack gains "SUCCESSFUL - If your attack roll result is 22 or higher, BREAK!."',
      },
    ],
  ],
  [
    "move-midorikatai-spinebuster",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "apply-status",
        statusId: "break",
        conditions: [
          {
            type: "paid-ki-cost",
            subject: "self",
            comparison: "at-least",
            value: { type: "literal", value: 4 },
            sourceText: "If you paid 4 KI or more to use this attack",
          },
        ],
        sourceText: "SUCCESSFUL - If you paid 4 KI or more to use this attack, BREAK",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "apply-status",
        statusId: "break",
        conditions: [
          {
            type: "paid-ki-cost",
            subject: "self",
            comparison: "exactly",
            value: { type: "literal", value: 3 },
            sourceText: "If you paid 3 KI to use this attack",
          },
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 22 },
            sourceText: "your attack roll is 22 or higher",
          },
        ],
        sourceText:
          "SUCCESSFUL - If you paid 4 KI or more to use this attack, BREAK. If you paid 3 KI to use this attack and your attack roll is 22 or higher, BREAK",
      },
    ],
  ],
  [
    "move-midorikatai-flapjack",
    [
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
          effectTextIncludes: "BREAK",
          sourceText: "an attack with 'BREAK' in the effect",
        },
        scope: { type: "next-turn", subject: "self", sourceText: "on your next turn" },
        sourceText:
          "If you perform an attack with 'BREAK' in the effect on your next turn, the result gains +2",
      },
    ],
  ],
  [
    "move-midorikatai-stranglehold",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: 1 },
        scope: { type: "next-action", sourceText: "Your opponent's next attack" },
        sourceText: "SUCCESSFUL - Your opponent's next attack costs +1 KI",
      },
    ],
  ],
  [
    "move-midorikatai-energy-breaker",
    [
      {
        trigger: "on-stopped",
        target: "self",
        type: "prevent-move-modification",
        actor: "opponent",
        aspects: ["damage"],
        selector: {
          type: "move-selector",
          subject: "target",
          sourceText: "Your damage",
        },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 4 },
          sourceText: "for the next 4 turns",
        },
        sourceText: "Your damage cannot be prevented or reduced for the next 4 turns",
      },
    ],
  ],
  [
    "move-midorikatai-flawless-execution-mastery",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: -2 },
        minimum: { type: "literal", value: 3 },
        selector: {
          type: "move-selector",
          subject: "target",
          category: "signature",
          sourceText: "Your Signature Techniques",
        },
        sourceText: "Your Signature Techniques cost -2 KI to perform to a minimum of 3",
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
          subject: "target",
          category: "signature",
          sourceText: "Your Signature Techniques",
        },
        cap: { type: "allow-exceed", sourceText: "can exceed the dice side and dice result cap" },
        sourceText:
          "Your Signature Techniques gain +3 to the results. Your Signature Techniques can exceed the dice side and dice result cap",
      },
    ],
  ],
  [
    "move-midorikatai-critical-mass-mastery",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-critical-threshold",
        threshold: { type: "literal", value: 29 },
        basis: "final-result",
        selector: {
          type: "move-selector",
          subject: "target",
          styleId: MIDORIKATAI_STYLE.id,
          attackRoll: { dice: 1, maximumSides: 32 },
          sourceText: "Midorikatai attacks with a base roll of 1d32 or lower",
        },
        sourceText:
          "All of your Midorikatai or non-Custom Freestyle attacks with a base roll of 1d32 or lower can CRITICAL with an attack roll result of 29 or higher",
      },
      {
        trigger: "passive",
        target: "self",
        type: "modify-critical-threshold",
        threshold: { type: "literal", value: 29 },
        basis: "final-result",
        selector: {
          type: "move-selector",
          subject: "target",
          styleId: FREESTYLE_STYLE.id,
          custom: false,
          attackRoll: { dice: 1, maximumSides: 32 },
          sourceText: "non-Custom Freestyle attacks with a base roll of 1d32 or lower",
        },
        sourceText:
          "All of your Midorikatai or non-Custom Freestyle attacks with a base roll of 1d32 or lower can CRITICAL with an attack roll result of 29 or higher",
      },
      {
        trigger: "on-damage",
        target: "opponent",
        type: "modify-damage",
        operation: "multiply",
        percent: { type: "damage-percent", subject: "current-action", percent: 150 },
        conditions: [
          {
            type: "combat-result",
            actor: "opponent",
            result: "critical",
            sourceText: "Your opponent's CRITICAL attacks against you",
          },
        ],
        sourceText: "Your opponent's CRITICAL attacks against you only do 1.5x damage instead",
      },
    ],
  ],
  [
    "move-midorikatai-absolute-might-mastery",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-slot-capacity",
        slot: "advanced-attack",
        amount: { type: "literal", value: 1 },
        sourceText: "You gain +1 Advanced Attack slot in your move set",
      },
      {
        trigger: "passive",
        target: "self",
        type: "set-resolution-threshold",
        outcome: "stop",
        roll: "defense",
        comparison: "at-most",
        value: { type: "literal", value: 12 },
        selector: {
          type: "move-selector",
          subject: "source",
          styleId: MIDORIKATAI_STYLE.id,
          category: "advanced-attack",
          sourceText: "Your Midorikatai Advanced Attacks",
        },
        sourceText:
          "Your Midorikatai Advanced Attacks cannot be STOPPED by defensive roll results of 12 or less",
      },
    ],
  ],
  [
    "move-midorikatai-bonecrusher-mastery",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "stat-percent", subject: "self", stat: "power", percent: 10 },
        selector: {
          type: "move-selector",
          subject: "target",
          effectTextIncludes: "BREAK!",
          sourceText: "Your attacks with 'BREAK!' in the effect",
        },
        sourceText: "Your attacks with 'BREAK!' in the effect do +(10% Power) Damage",
      },
    ],
  ],
  [
    "move-midorikatai-overwhelming-mastery",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "stat-percent", subject: "self", stat: "power", percent: 5 },
        selector: {
          type: "move-selector",
          subject: "target",
          styleId: MIDORIKATAI_STYLE.id,
          category: "advanced-attack",
          sourceText: "Your Midorikatai attacks",
        },
        sourceText: "Your Midorikatai attacks do +(5% Power) Damage",
      },
    ],
  ],
  [
    "move-midorikatai-big-bopper",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "suppress",
        aspects: ["all-effects"],
        selector: {
          type: "move-selector",
          subject: "target",
          category: "skill",
          constant: true,
          sourceText: "one of your opponent's CONSTANT skills",
        },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 2 },
          sourceText: "for your next 2 turns",
        },
        sourceText:
          "SUCCESSFUL - Choose one of your opponent's CONSTANT skills. That Skill has no effect for your next 2 turns",
      },
    ],
  ],
  [
    "move-midorikatai-armbreaker",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "apply-status",
        statusId: "break",
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 28 },
            sourceText: "If your attack roll result is 28 or higher",
          },
        ],
        sourceText: "SUCCESSFUL - If your attack roll result is 28 or higher, BREAK!",
      },
    ],
  ],
  [
    "move-midorikatai-enraged-piledriver",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: 1 },
        conditions: [
          {
            type: "prior-action",
            actor: "opponent",
            result: "successful",
            sourceText: "If your opponent's last attack was SUCCESSFUL",
          },
        ],
        sourceText: "SUCCESSFUL - If your opponent's last attack was SUCCESSFUL, gain 1 KI",
      },
    ],
  ],
  [
    "move-midorikatai-finger-cuffs",
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
          tags: ["punch"],
          sourceText: "your opponent's next Punch-type attack",
        },
        scope: { type: "next-action", sourceText: "your opponent's next Punch-type attack" },
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
          "SUCCESSFUL - If your attack roll result is 20 or higher, your opponent's next Punch-type attack costs +2 KI to use",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "apply-status",
        statusId: "break",
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 28 },
            sourceText: "If your attack roll result is 28 or higher",
          },
        ],
        sourceText: "If your attack roll result is 28 or higher, BREAK!",
      },
    ],
  ],
  [
    "move-midorikatai-doomsday-device",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "apply-status",
        statusId: "break",
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 20 },
            sourceText: "If your attack roll result is 20 or higher",
          },
        ],
        sourceText: "If your attack roll result is 20 or higher, BREAK!",
      },
    ],
  ],
  [
    "move-midorikatai-falling-star-charge",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "apply-status",
        statusId: "break",
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 20 },
            sourceText: "If your attack roll result is 20 or higher",
          },
        ],
        sourceText: "If your attack roll result is 20 or higher, BREAK!x3",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "apply-status",
        statusId: "break",
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 20 },
            sourceText: "If your attack roll result is 20 or higher",
          },
        ],
        sourceText: "If your attack roll result is 20 or higher, BREAK!x3",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "apply-status",
        statusId: "break",
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 20 },
            sourceText: "If your attack roll result is 20 or higher",
          },
        ],
        sourceText: "If your attack roll result is 20 or higher, BREAK!x3",
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
          tags: ["physical"],
          sourceText: "next 3 physical Advanced Attacks",
        },
        scope: {
          type: "next-actions",
          count: { type: "literal", value: 3 },
          sourceText: "next 3 physical Advanced Attacks",
        },
        sourceText: "SUCCESSFUL - Your next 3 physical Advanced Attacks cost 0 KI to perform",
      },
    ],
  ],
  [
    "move-midorikatai-gorilla-press",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-damage",
        operation: "add",
        percent: { type: "stat-percent", subject: "self", stat: "power", percent: -20 },
        selector: {
          type: "move-selector",
          subject: "target",
          tags: ["physical"],
          sourceText: "Your opponent's next physical attack",
        },
        scope: { type: "next-action", sourceText: "Your opponent's next physical attack" },
        sourceText:
          "SUCCESSFUL - Your opponent's next physical attack does -(20% Your Power) Damage",
      },
    ],
  ],
  [
    "move-midorikatai-energy-gorged",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "stat-percent", subject: "self", stat: "power", percent: 10 },
        sourceText: "Your attacks do +(10% Power) damage",
      },
    ],
  ],
  [
    "move-midorikatai-war-cry",
    [
      {
        trigger: "upkeep-phase",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "stat-percent", subject: "self", stat: "power", percent: 15 },
        selector: {
          type: "move-selector",
          subject: "target",
          styleId: "style-midorikatai",
          category: "advanced-attack",
          sourceText: "Your next Midorikatai attack",
        },
        scope: { type: "next-action", sourceText: "Your next Midorikatai attack" },
        stacking: "prevent",
        useLimit: { scope: "combat", count: 2, sourceText: "RESTRICTEDx2" },
        sourceText:
          "Timing: UPKEEP phase. RESTRICTEDx2. Your next Midorikatai attack does +(15% Power) Damage. This effect cannot stack with itself",
      },
    ],
  ],
  [
    "move-midorikatai-airplane-spin",
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
          baseKiCost: { comparison: "at-least", value: { type: "literal", value: 2 } },
          sourceText: "energy attacks with a base cost of 2 or more",
        },
        scope: { type: "next-turn", subject: "opponent", sourceText: "for their next turn" },
        sourceText:
          "SUCCESSFUL - LOCK your opponent's energy attacks with a base cost of 2 or more for their next turn",
      },
    ],
  ],
  [
    "move-midorikatai-knee-stomp",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "prevent-move-modification",
        actor: "opponent",
        aspects: ["dice-sides", "roll-results"],
        selector: {
          type: "move-selector",
          subject: "target",
          category: "advanced-attack",
          sourceText: "their attacks",
        },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 4 },
          sourceText: "for their next 4 turns",
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
          "If your attack roll result is 20 or higher, your opponent cannot modify the results or dice sides of their attacks for their next 4 turns",
      },
    ],
  ],
  [
    "move-midorikatai-chokeslam",
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
          sourceText: "an energy attack",
        },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 2 },
          sourceText: "for your opponent's next 2 turns",
        },
        sourceText:
          "SUCCESSFUL - Choose an energy attack. LOCK that energy attack for your opponent's next 2 turns",
      },
    ],
  ],
  [
    "move-midorikatai-football-tackle",
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
          baseKiCost: { comparison: "at-most", value: { type: "literal", value: 2 } },
          sourceText: "energy attacks with a base cost of 2 or less",
        },
        scope: { type: "next-turn", subject: "opponent", sourceText: "for their next turn" },
        sourceText:
          "SUCCESSFUL - LOCK your opponent's energy attacks with a base cost of 2 or less for their next turn",
      },
    ],
  ],
  [
    "move-midorikatai-palm-crusher",
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
          attackRoll: { dice: 2 },
          sourceText: "multi-dice attacks",
        },
        duration: {
          type: "until-resource-threshold",
          subject: "opponent",
          resource: "ki",
          comparison: "at-least",
          value: { type: "literal", value: 8 },
          sourceText: "until their KI are at 8 or higher",
        },
        sourceText:
          "SUCCESSFUL - LOCK your opponent's multi-dice attacks until their KI are at 8 or higher",
      },
    ],
  ],
  [
    "move-midorikatai-fallaway-slam",
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
          attackRoll: { dice: 2 },
          sourceText: "multi-dice attacks",
        },
        scope: { type: "next-turn", subject: "opponent", sourceText: "for their next turn" },
        sourceText: "SUCCESSFUL - LOCK your opponent's multi-dice attacks for their next turn",
      },
    ],
  ],
  [
    "move-midorikatai-dim-mak",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "lock",
        affectedType: "attack",
        scope: { type: "next-turn", subject: "opponent", sourceText: "for their next turn" },
        sourceText: "SUCCESSFUL - LOCK your opponent's attacks for their next turn",
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
          sourceText: "one of your opponent's Signature Techniques",
        },
        duration: { type: "combat", sourceText: "for the remainder of the match" },
        sourceText:
          "Choose one of your opponent's Signature Techniques. LOCK that attack for the remainder of the match",
      },
    ],
  ],
  [
    "move-midorikatai-monster-mash",
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
          tags: ["physical"],
          sourceText: "Your opponent's physical attacks",
        },
        duration: { type: "combat", sourceText: "for the remainder of the match" },
        sourceText:
          "SUCCESSFUL - Your opponent's physical attacks cost +1 KI for the remainder of the match",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-damage",
        operation: "add",
        percent: { type: "literal", value: -20 },
        selector: {
          type: "move-selector",
          subject: "target",
          tags: ["energy"],
          sourceText: "Your opponent's energy attacks",
        },
        duration: { type: "combat", sourceText: "for the remainder of combat" },
        sourceText:
          "Your opponent's energy attacks do -20% Damage against you for the remainder of combat",
      },
    ],
  ],
  [
    "move-midorikatai-violence-party",
    [
      {
        trigger: "on-stopped",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: 4 },
        conditions: [
          {
            type: "action-sequence",
            actor: "self",
            result: "stopped",
            count: 3,
            sourceText: "If 3 or more dice rolls are STOPPED",
          },
        ],
        sourceText: "If 3 or more dice rolls are STOPPED, gain 4 KI",
      },
    ],
  ],
  [
    "move-midorikatai-cross-stance",
    [
      {
        trigger: "on-stopped",
        target: "opponent",
        type: "lock",
        affectedType: "attack",
        duration: {
          type: "until-resource-threshold",
          subject: "opponent",
          resource: "ki",
          comparison: "at-least",
          value: { type: "literal", value: 8 },
          sourceText: "until your opponent's KI are at 8 or more",
        },
        sourceText: "LOCK that attack until your opponent's KI are at 8 or more",
      },
    ],
  ],
  [
    "move-midorikatai-trapping-headbutts",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "deactivate",
        affectedType: "skill",
        count: { type: "literal", value: 1 },
        conditions: [
          {
            type: "successful-hit-count",
            comparison: "at-least",
            value: { type: "literal", value: 2 },
            sourceText: "If two or more dice are SUCCESSFUL",
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
          "If two or more dice are SUCCESSFUL, DEACTIVATE one of your opponent's CONSTANT Skills",
      },
    ],
  ],
  [
    "move-midorikatai-jawbreaker",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "stat-percent", subject: "self", stat: "power", percent: 10 },
        selector: {
          type: "move-selector",
          subject: "target",
          effectTextIncludes: "BREAK!",
          sourceText: "Your attacks with 'BREAK!' in the effect",
        },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 3 },
          sourceText: "for your next 3 turns",
        },
        sourceText:
          "SUCCESSFUL - Your attacks with 'BREAK!' in the effect do +(10% Power) for your next 3 turns",
      },
    ],
  ],
  [
    "move-midorikatai-aggravated-assault",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "prevent-resolution",
        prevention: "stop",
        selector: {
          type: "move-selector",
          subject: "target",
          styleId: "midorikatai",
          category: "advanced-attack",
          sourceText: "your next Midorikatai Advanced Attack",
        },
        scope: {
          type: "next-action",
          sourceText: "your next Midorikatai Advanced Attack",
        },
        activationCost: {
          resource: "ki",
          operation: "lose",
          amount: { type: "literal", value: 2 },
        },
        conditions: [
          {
            type: "successful-hit-count",
            comparison: "exactly",
            value: { type: "literal", value: 2 },
            sourceText: "If both dice rolls are SUCCESSFUL",
          },
        ],
        sourceText:
          "SUCCESSFUL - If both dice rolls are SUCCESSFUL, you may lose 2 KI to have your next Midorikatai Advanced Attack be unable to be STOPPED",
      },
    ],
  ],
  [
    "move-midorikatai-nothing-pretty",
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
          category: "advanced-attack",
          tags: ["punch", "kick"],
          sourceText: "a Kick or Punch type Advanced Attack",
        },
        scope: { type: "next-turn", subject: "self", sourceText: "next turn" },
        conditions: [
          {
            type: "successful-hit-count",
            comparison: "at-least",
            value: { type: "literal", value: 2 },
            sourceText: "If at least two dice are SUCCESSFUL",
          },
        ],
        sourceText:
          "SUCCESSFUL - If at least two dice are SUCCESSFUL, you may use a Kick or Punch type Advanced Attack next turn for 0 KI",
      },
    ],
  ],
  [
    "move-midorikatai-omega-strike",
    [
      {
        trigger: "passive",
        target: "self",
        type: "prevent-resolution",
        prevention: "stop",
        scope: { type: "current-action", sourceText: "this attack" },
        conditions: [
          {
            type: "stat-comparison",
            left: "opponent",
            stat: "sp",
            comparison: "higher-than",
            right: "self",
            sourceText: "If your opponent has more SP than you",
          },
          {
            type: "resource-threshold",
            subject: "self",
            resource: "ki",
            basis: "current",
            comparison: "at-least",
            value: { type: "literal", value: 8 },
            sourceText: "your KI were 8 or higher before you performed this attack",
          },
        ],
        sourceText:
          "If your opponent has more SP than you and your KI were 8 or higher before you performed this attack, this attack cannot be STOPPED",
      },
    ],
  ],
  [
    "move-midorikatai-ankle-buster",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "lock",
        affectedType: "attack",
        selector: {
          type: "move-selector",
          subject: "target",
          tags: ["kick"],
          sourceText: "your opponent's Kick-type attacks",
        },
        duration: {
          type: "turns",
          turns: { type: "successful-hit-count" },
          sourceText: "for 1 turn per SUCCESSFUL hit",
        },
        stacking: "prevent",
        sourceText:
          "SUCCESSFUL - LOCK your opponent's Kick-type attacks for 1 turn per SUCCESSFUL hit. This effect does not stack with itself",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-damage",
        operation: "add",
        percent: { type: "damage-percent", subject: "current-action", percent: -10 },
        selector: {
          type: "move-selector",
          subject: "target",
          tags: ["energy"],
          sourceText: "they perform an energy attack",
        },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 2 },
          sourceText: "on their next 2 turns",
        },
        sourceText:
          "If they perform an energy attack on their next 2 turns, that attack does -10% Damage",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-damage",
        operation: "add",
        percent: { type: "damage-percent", subject: "current-action", percent: -10 },
        selector: {
          type: "move-selector",
          subject: "target",
          tags: ["energy"],
          sourceText: "they perform an energy attack",
        },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 2 },
          sourceText: "on their next 2 turns",
        },
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
          "If they perform an energy attack on their next 2 turns, that attack does -10% Damage. If your Power is higher than your opponent's Power, that attack does -20% Damage, instead",
      },
    ],
  ],
  [
    "move-midorikatai-power-drill",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "suppress",
        aspects: ["successful-effects"],
        selector: {
          type: "move-selector",
          subject: "target",
          sourceText: "your opponent performs an attack on their next turn",
        },
        scope: {
          type: "next-action",
          sourceText: "your opponent performs an attack on their next turn",
        },
        sourceText:
          "SUCCESSFUL - If your opponent performs an attack on their next turn, you may choose to have that attack lose its SUCCESSFUL effect",
      },
    ],
  ],
  [
    "move-midorikatai-megaton-cannon",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "lock",
        affectedType: "attack",
        selector: {
          type: "move-selector",
          subject: "target",
          tags: ["physical"],
          sourceText: "Neither you nor your opponent can use a physical attack",
        },
        scope: {
          type: "next-turn",
          subject: "self",
          sourceText: "until the end of your next turn",
        },
        sourceText:
          "SUCCESSFUL - Neither you nor your opponent can use a physical attack until the end of your next turn",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "lock",
        affectedType: "attack",
        selector: {
          type: "move-selector",
          subject: "target",
          tags: ["physical"],
          sourceText: "Neither you nor your opponent can use a physical attack",
        },
        scope: {
          type: "next-turn",
          subject: "self",
          sourceText: "until the end of your next turn",
        },
        sourceText:
          "SUCCESSFUL - Neither you nor your opponent can use a physical attack until the end of your next turn",
      },
    ],
  ],
  [
    "move-midorikatai-rioter",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-resource",
        resource: "ki",
        operation: "lose",
        amount: {
          type: "moveset-tag-count",
          subject: "opponent",
          tag: "energy",
          perMove: 1,
          maximum: 4,
        },
        sourceText:
          "SUCCESSFUL - Your opponent loses 1 KI for every energy attack in their moveset, to a maximum of 4 KI",
      },
    ],
  ],
  [
    "move-midorikatai-galactic-punisher",
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
            sourceText: "If your attack roll result is 28 or higher",
          },
        ],
        sourceText: "SUCCESSFUL - If your attack roll result is 28 or higher, CRITICAL",
      },
    ],
  ],
  [
    "move-midorikatai-against-the-odds",
    [
      {
        trigger: "upkeep-phase",
        target: "opponent",
        type: "suppress",
        selector: {
          type: "move-selector",
          subject: "target",
          category: "advanced-attack",
          sourceText: "your opponent's attacks",
        },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 3 },
          sourceText: "for their next 3 turns",
        },
        useLimit: { scope: "combat", count: 2, sourceText: "RESTRICTEDx2" },
        sourceText:
          "Activate during your UPKEEP phase after taking damage from two SUCCESSFUL attacks on your opponent's consecutive turns. RESTRICTEDx2. SUPPRESS your opponent's attacks for their next 3 turns",
      },
    ],
  ],
  [
    "move-midorikatai-sucker-punch",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "negate",
        conditions: [
          {
            type: "move-selector",
            subject: "target",
            category: "skill",
            sourceText: "your opponent uses or activates a Skill",
          },
        ],
        useLimit: { scope: "combat", count: 1, sourceText: "RESTRICTEDx1" },
        sourceText:
          "RESTRICTEDx1. Use when your opponent uses or activates a Skill. This does not take up your turn. Physical attack. Deal (10% Power) damage. SUCCESSFUL - NEGATE the effect or DEACTIVATE the Skill",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "deactivate",
        affectedType: "skill",
        count: { type: "literal", value: 1 },
        conditions: [
          {
            type: "move-selector",
            subject: "target",
            category: "skill",
            sourceText: "your opponent uses or activates a Skill",
          },
        ],
        sourceText:
          "RESTRICTEDx1. Use when your opponent uses or activates a Skill. This does not take up your turn. Physical attack. Deal (10% Power) damage. SUCCESSFUL - NEGATE the effect or DEACTIVATE the Skill",
      },
    ],
  ],
  [
    "move-midorikatai-overcharged-wave",
    [
      {
        trigger: "before-attack-roll",
        target: "opponent",
        type: "prevent-resolution",
        prevention: "block",
        sourceText: "This attack cannot be BLOCKED",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "prevent-resolution",
        prevention: "block",
        selector: {
          type: "move-selector",
          subject: "target",
          tags: ["physical"],
          sourceText: "Your next physical attack",
        },
        scope: { type: "next-action", sourceText: "Your next physical attack" },
        sourceText: "Your next physical attack cannot be BLOCKED",
      },
    ],
  ],
  [
    "move-midorikatai-built-like-a-mountain",
    [
      {
        trigger: "on-stopped",
        target: "opponent",
        type: "prevent-resolution",
        prevention: "block",
        scope: { type: "next-action", sourceText: "Your next attack" },
        sourceText:
          'Your next attack gains "This attack cannot be BLOCKED or STOPPED by defensive roll results of 14 or less"',
      },
      {
        trigger: "on-stopped",
        target: "opponent",
        type: "set-resolution-threshold",
        outcome: "stop",
        roll: "defense",
        comparison: "at-most",
        value: { type: "literal", value: 14 },
        resultScope: "current-attack",
        scope: { type: "next-action", sourceText: "Your next attack" },
        sourceText:
          'Your next attack gains "This attack cannot be BLOCKED or STOPPED by defensive roll results of 14 or less"',
      },
    ],
  ],
  [
    "move-midorikatai-whiplash",
    [
      {
        trigger: "passive",
        target: "opponent",
        type: "set-resolution-threshold",
        outcome: "stop",
        roll: "defense",
        comparison: "at-most",
        value: { type: "literal", value: 15 },
        resultScope: "current-attack",
        scope: { type: "current-action", sourceText: "this attack" },
        conditions: [
          {
            type: "active-move-count",
            subject: "opponent",
            selector: {
              type: "move-selector",
              subject: "target",
              category: "skill",
              sourceText: "If your opponent has any Skills activated",
            },
            comparison: "at-least",
            value: { type: "literal", value: 1 },
            sourceText: "If your opponent has any Skills activated",
          },
        ],
        sourceText:
          "If your opponent has any Skills activated, this attack cannot be STOPPED by a defensive roll result of 15 or less",
      },
    ],
  ],
  [
    "move-midorikatai-one-two-punch",
    [
      {
        trigger: "before-attack-roll",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        dieIndex: 2,
        amount: { type: "literal", value: 5 },
        conditions: [
          {
            type: "roll-die-result",
            roll: "attack",
            index: 1,
            result: "successful",
            sourceText: "If the first roll is SUCCESSFUL",
          },
        ],
        sourceText:
          "If the first roll is SUCCESSFUL, the result of the second roll gains +5 to the result",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-damage",
        operation: "add",
        percent: { type: "literal", value: -10 },
        scope: { type: "next-turn", subject: "opponent", sourceText: "on their next turn" },
        conditions: [
          {
            type: "successful-hit-count",
            comparison: "at-least",
            value: { type: "literal", value: 2 },
            sourceText: "If both attacks are successful",
          },
        ],
        sourceText:
          "If both attacks are successful and your opponent attacks on their next turn, that attack deals -(10% Power) Damage",
      },
    ],
  ],
  [
    "move-midorikatai-raining-bombs",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-cost",
        operation: "set",
        amount: { type: "literal", value: 0 },
        minimum: { type: "literal", value: 2 },
        selector: {
          type: "move-selector",
          subject: "source",
          ids: ["move-midorikatai-raining-bombs"],
          sourceText: "The cost of this attack",
        },
        sourceText: "The cost of this attack cannot be reduced below 2 KI",
      },
      {
        trigger: "on-stopped",
        target: "self",
        type: "grant-escape-roll",
        phase: "end-phase",
        optional: true,
        conditions: [
          {
            type: "attack-roll-resolution",
            actor: "self",
            anyOf: ["all-dice-stopped"],
            sourceText: "If all 3 attack rolls are STOPPED",
          },
        ],
        sourceText:
          "STOPPED - If all 3 attack rolls are STOPPED, you may perform an escape roll during your END phase",
      },
    ],
  ],
  [
    "move-midorikatai-grapple",
    [
      {
        trigger: "on-move-use",
        target: "self",
        type: "reactivate-deactivated-constant-skill",
        selector: {
          type: "move-selector",
          subject: "source",
          category: "skill",
          constant: true,
          sourceText: "one of your CONSTANT Skills that has been DEACTIVATED this combat",
        },
        deactivatedTiming: "combat",
        optional: true,
        selectionLimit: 1,
        useLimit: { scope: "combat", count: 1, sourceText: "RESTRICTEDx1" },
        sourceText:
          "RESTRICTEDx1. Block. Stop a physical attack. You may reactivate one of your CONSTANT Skills that has been DEACTIVATED this combat, including Energy Gorged",
      },
    ],
  ],
  [
    "move-midorikatai-torture-rack",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "grant-transformation-action",
        turnCost: "none",
        scope: { type: "next-action", sourceText: "The next time you Transform" },
        useLimit: { scope: "combat", count: 2, sourceText: "RESTRICTEDx2" },
        sourceText: "SUCCESSFUL - The next time you Transform, it doesn't take up your turn",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "modify-roll",
        roll: "transformation",
        modifier: "result",
        amount: { type: "literal", value: 2 },
        scope: { type: "combat", sourceText: "for the remainder of the match" },
        conditions: [
          {
            type: "move-use-count",
            selector: {
              type: "move-selector",
              subject: "source",
              ids: ["move-midorikatai-torture-rack"],
              sourceText: "this attack",
            },
            comparison: "exactly",
            value: 1,
            timing: "including-current-use",
            sourceText: "If this is the first time you are performing this attack",
          },
        ],
        sourceText:
          "If this is the first time you are performing this attack, your Transformation rolls gain +2 to their results for the remainder of the match",
      },
    ],
  ],
  [
    "move-midorikatai-cobra-clutch-drop",
    [
      {
        trigger: "passive",
        target: "opponent",
        type: "modify-damage",
        operation: "add",
        percent: { type: "literal", value: 10 },
        scope: { type: "current-action", sourceText: "this attack" },
        conditions: [
          {
            type: "stat-comparison",
            left: "self",
            stat: "power",
            comparison: "higher-than",
            right: "opponent",
            rightStat: "power",
            sourceText: "If your power is higher than your opponent's power",
          },
        ],
        sourceText:
          "If your power is higher than your opponent's power, this attack does +(10% Power) Damage",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: -3 },
        selector: {
          type: "move-selector",
          subject: "target",
          tags: ["beam", "blast"],
          sourceText: "Your opponent's Beam-Type and Blast-Type attacks",
        },
        duration: {
          type: "until-combat-result",
          actor: "self",
          result: "stopped",
          moveSelector: {
            type: "move-selector",
            subject: "source",
            category: "advanced-attack",
            sourceText: "one of your attacks",
          },
          conditions: [
            {
              type: "defense-response",
              blockUsed: false,
              sourceText: "without the use of a BLOCK",
            },
            {
              type: "roll-die-result",
              roll: "attack",
              index: 1,
              result: "stopped",
              sourceText: "In the case of multi-dice attacks, only the first die roll counts",
            },
          ],
          sourceText:
            "until one of your attacks is STOPPED without the use of a BLOCK. In the case of multi-dice attacks, only the first die roll counts for ending this effect",
        },
        sourceText:
          "SUCCESSFUL - Your opponent's Beam-Type and Blast-Type attacks gain -3 to the result until one of your attacks is STOPPED without the use of a BLOCK. In the case of multi-dice attacks, only the first die roll counts for ending this effect",
      },
    ],
  ],
  [
    "move-midorikatai-x-attack",
    [
      {
        trigger: "on-stopped",
        target: "opponent",
        type: "modify-roll",
        roll: "transformation",
        modifier: "result",
        amount: { type: "stopped-hit-count", perHit: -3 },
        scope: {
          type: "next-roll",
          roll: "transformation",
          sourceText: "your opponent's next Transformation roll",
        },
        stacking: "allow",
        conditions: [
          {
            type: "successful-hit-count",
            comparison: "at-most",
            value: { type: "literal", value: 3 },
            sourceText: "If 3 or more dice rolls are STOPPED",
          },
        ],
        sourceText:
          "STOPPED - If 3 or more dice rolls are STOPPED, your opponent's next Transformation roll gains -3 to the result for each STOPPED attack roll. This effect stacks with itself",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "require-transformation-roll",
        phase: "upkeep-phase",
        ignoreTransformationDice: true,
        scope: {
          type: "next-phase",
          subject: "opponent",
          phase: "upkeep",
          sourceText: "during their next UPKEEP phase",
        },
        conditions: [
          {
            type: "combat-state",
            subject: "opponent",
            state: "transformed",
            sourceText: "If your opponent is transformed",
          },
          {
            type: "resource-threshold",
            subject: "opponent",
            resource: "hp",
            basis: "current",
            comparison: "lower-than",
            value: {
              type: "resource-percent",
              subject: "opponent",
              resource: "hp",
              basis: "total",
              percent: 50,
            },
            sourceText: "below (50% Total HP)",
          },
        ],
        sourceText:
          "SUCCESSFUL - If your opponent is transformed and below (50% Total HP) they must make a Transformation Roll during their next UPKEEP phase regardless of their transformation dice",
      },
    ],
  ],
  [
    "move-midorikatai-breaker-breaker",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "grant-combat-outcome",
        outcome: "break",
        conditions: [
          {
            type: "combat-turn",
            comparison: "exactly",
            value: 1,
            sourceText: "If you perform this attack on your first turn",
          },
        ],
        sourceText:
          'If you perform this attack on your first turn, this attack gains "SUCCESSFUL - BREAK"',
      },
      {
        trigger: "on-success",
        target: "self",
        type: "modify-combat-outcome",
        outcome: "break",
        multiplier: { type: "literal", value: 2 },
        selector: {
          type: "move-selector",
          subject: "source",
          category: "advanced-attack",
          effectTextIncludes: "BREAK",
          sourceText: "The next attack you perform that can cause BREAK",
        },
        scope: { type: "next-action", sourceText: "The next attack you perform" },
        duration: { type: "combat", sourceText: "For the remainder of the match" },
        sourceText:
          'For the remainder of the match, this attack gains "SUCCESSFUL - The next attack you perform that can cause BREAK instead can cause BREAKx2"',
      },
    ],
  ],
  [
    "move-midorikatai-fall-7-times-get-up-8",
    [
      {
        trigger: "upkeep-phase",
        target: "self",
        type: "create-floating-effect",
        floatingEffectId: "fall-7-times-next-low-cost-attack",
        activationCost: {
          resource: "ki",
          operation: "lose",
          amount: { type: "literal", value: 1 },
        },
        conditions: [
          {
            type: "action-sequence",
            actor: "self",
            result: "stopped",
            count: 2,
            sourceText: "after two of your attacks are stopped in a row",
          },
        ],
        scope: {
          type: "next-action",
          sourceText: "Your next attack with a base cost of 2 or less",
        },
        effects: [
          {
            trigger: "passive",
            target: "opponent",
            type: "prevent-resolution",
            prevention: "block",
            selector: {
              type: "move-selector",
              subject: "source",
              category: "advanced-attack",
              baseKiCost: { comparison: "at-most", value: { type: "literal", value: 2 } },
              sourceText: "Your next attack with a base cost of 2 or less",
            },
            sourceText: "cannot be BLOCKED",
          },
          {
            trigger: "passive",
            target: "opponent",
            type: "prevent-resolution",
            prevention: "stop",
            source: "effect",
            selector: {
              type: "move-selector",
              subject: "source",
              category: "advanced-attack",
              baseKiCost: { comparison: "at-most", value: { type: "literal", value: 2 } },
              sourceText: "Your next attack with a base cost of 2 or less",
            },
            sourceText: "cannot be STOPPED by an effect",
          },
          {
            trigger: "before-defense-roll",
            target: "opponent",
            type: "set-resolution-threshold",
            outcome: "stop",
            roll: "defense",
            comparison: "at-least",
            value: { type: "literal", value: 2 },
            relativeTo: "attack-roll",
            relativeOperation: "multiply",
            resultScope: "current-attack",
            selector: {
              type: "move-selector",
              subject: "source",
              category: "advanced-attack",
              baseKiCost: { comparison: "at-most", value: { type: "literal", value: 2 } },
              sourceText: "Your next attack with a base cost of 2 or less",
            },
            sourceText:
              "Your opponent's defensive roll result has to be 2x or more your attack roll result to STOP this attack",
          },
        ],
        sourceText:
          "Activate during your UPKEEP phase after two of your attacks are stopped in a row. Your next attack with a base cost of 2 or less cannot be BLOCKED or STOPPED by an effect. Your opponent's defensive roll result has to be 2x or more your attack roll result to STOP this attack. Cost: 1 KI",
      },
    ],
  ],
  [
    "move-midorikatai-not-over-till-it-s-over",
    [
      {
        trigger: "upkeep-phase",
        target: "self",
        type: "create-floating-effect",
        floatingEffectId: "not-over-next-unrestricted-advanced-attack",
        activationCost: {
          resource: "ki",
          operation: "lose",
          amount: { type: "literal", value: 1 },
        },
        optional: true,
        selectionLimit: 1,
        useLimit: { scope: "combat", count: 1, sourceText: "RESTRICTEDx1" },
        scope: { type: "next-action", sourceText: "your next unrestricted Advanced Attack" },
        effects: [
          {
            trigger: "on-move-use",
            target: "self",
            type: "remove-move-from-combat",
            move: "source",
            selector: {
              type: "move-selector",
              subject: "source",
              category: "advanced-attack",
              selectionKey: "not-over-sacrificed-advanced-attack",
              sourceText:
                "remove an Advanced Attack from your moveset for the remainder of the match",
            },
            sourceText:
              "remove an Advanced Attack from your moveset for the remainder of the match",
          },
          {
            trigger: "before-attack-roll",
            target: "self",
            type: "modify-roll",
            roll: "attack",
            modifier: "result",
            multiplier: { type: "literal", value: 2 },
            affectedDice: "ceiling-half",
            selector: {
              type: "move-selector",
              subject: "source",
              category: "advanced-attack",
              restriction: "unrestricted",
              sourceText: "your next unrestricted Advanced Attack",
            },
            scope: { type: "current-action", sourceText: "your next unrestricted Advanced Attack" },
            sourceText:
              "double the attack roll result(s) of your next unrestricted Advanced Attack. If used on a multi-dice attack roll, only half of the attack rolls (rounded up) are affected",
          },
          {
            trigger: "before-attack-roll",
            target: "opponent",
            type: "prevent-combat-result",
            result: "sever",
            selector: {
              type: "move-selector",
              subject: "source",
              category: "advanced-attack",
              restriction: "unrestricted",
              sourceText: "that attack",
            },
            scope: { type: "current-action", sourceText: "that attack" },
            sourceText: "You cannot SEVER with that attack",
          },
        ],
        sourceText:
          "RESTRICTEDx1. Activate during your UPKEEP phase. You may remove an Advanced Attack from your moveset for the remainder of the match to double the attack roll result(s) of your next unrestricted Advanced Attack. If used on a multi-dice attack roll, only half of the attack rolls (rounded up) are affected. You cannot SEVER with that attack. Cost: 1 KI",
      },
    ],
  ],
  [
    "move-midorikatai-domination-mastery",
    [
      {
        trigger: "passive",
        target: "opponent",
        type: "modify-damage-reduction-cost",
        resource: "ki",
        amount: { type: "literal", value: 1 },
        reductions: "reduce-or-nullify",
        selector: {
          type: "move-selector",
          subject: "source",
          styleId: "midorikatai",
          category: "advanced-attack",
          sourceText: "the damage of your attacks",
        },
        sourceText:
          "Your opponent must spend +1 KI to reduce or nullify the damage of your attacks",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "create-floating-effect",
        floatingEffectId: "domination-mastery-next-midorikatai-advanced-attack",
        scope: { type: "next-action", sourceText: "your next Midorikatai Advanced Attack" },
        conditions: [
          {
            type: "action-sequence",
            actor: "self",
            result: "successful",
            count: 2,
            selector: {
              type: "move-selector",
              subject: "source",
              categories: ["advanced-attack", "signature"],
              sourceText: "two SUCCESSFUL Advanced Attacks and/or Signature Techniques",
            },
            differentTurns: true,
            sourceText:
              "After you perform two SUCCESSFUL Advanced Attacks and/or Signature Techniques on different turns in a row",
          },
        ],
        effects: [
          {
            trigger: "passive",
            target: "opponent",
            type: "prevent-resolution",
            prevention: "block",
            selector: {
              type: "move-selector",
              subject: "source",
              styleId: "midorikatai",
              category: "advanced-attack",
              sourceText: "your next Midorikatai Advanced Attack",
            },
            sourceText: "your next Midorikatai Advanced Attack cannot be BLOCKED",
          },
          {
            trigger: "passive",
            target: "opponent",
            type: "set-resolution-threshold",
            outcome: "stop",
            roll: "defense",
            comparison: "at-most",
            value: { type: "literal", value: 22 },
            resultScope: "current-attack",
            selector: {
              type: "move-selector",
              subject: "source",
              styleId: "midorikatai",
              category: "advanced-attack",
              sourceText: "your next Midorikatai Advanced Attack",
            },
            sourceText:
              "your next Midorikatai Advanced Attack cannot be STOPPED with a defense roll of 22 or lower",
          },
        ],
        sourceText:
          "After you perform two SUCCESSFUL Advanced Attacks and/or Signature Techniques on different turns in a row, your next Midorikatai Advanced Attack cannot be BLOCKED and cannot be STOPPED with a defense roll of 22 or lower. This effect resets after you use that attack",
      },
    ],
  ],
]);

export const MIDORIKATAI_MOVES = createStyleMoves(MIDORIKATAI_STYLE).map((move) => ({
  ...move,
  ...(structuredEffectsByMoveId.has(move.id)
    ? { effects: structuredEffectsByMoveId.get(move.id) }
    : {}),
}));
