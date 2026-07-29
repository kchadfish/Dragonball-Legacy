import type { EffectDefinition } from "../shared/effects.js";
import type { MoveDefinition } from "../shared/types.js";
import { createMovesForSource } from "./create-style-moves.js";

const structuredEffectsByMoveId = new Map<string, readonly EffectDefinition[]>([
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
          type: "source-expression",
          text: "25% Power for every time you have used 'Give Me Energy!' this combat",
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
        amount: { type: "source-expression", text: "10% Total HP" },
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
        percent: { type: "source-expression", text: "65% Power" },
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
        percent: { type: "source-expression", text: "-20% Damage" },
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
          amount: { type: "source-expression", text: "5% Power" },
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
        percent: { type: "source-expression", text: "15% Power" },
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
        amount: { type: "source-expression", text: "-1 per SUCCESSFUL roll" },
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
            value: { type: "source-expression", text: "15% Total HP" },
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
        amount: { type: "source-expression", text: "-3 per SUCCESSFUL dice roll" },
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
        percent: { type: "source-expression", text: "40% Power" },
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
        amount: { type: "source-expression", text: "10% Current HP" },
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
        amount: {
          type: "source-expression",
          text: "the amount of Advanced Attacks in their moveset",
        },
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
        percent: { type: "source-expression", text: "15% Power" },
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
        percent: { type: "source-expression", text: "10% Power" },
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
        amount: { type: "source-expression", text: "40% Their Total HP" },
        sourceText: "SUCCESSFUL - Your opponent loses (40% Their Total HP) HP",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "modify-resource",
        resource: "hp",
        operation: "gain",
        amount: { type: "source-expression", text: "15% Total HP" },
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
]);

export const AFTERLIFE_MOVES: readonly MoveDefinition[] = createMovesForSource({
  sourcePath: "reference/moves/afterlife.md",
}).map((move) => ({
  ...move,
  ...(structuredEffectsByMoveId.has(move.id)
    ? { effects: structuredEffectsByMoveId.get(move.id) }
    : {}),
}));
