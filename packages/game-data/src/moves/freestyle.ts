import { FREESTYLE_STYLE } from "../styles/freestyle.js";
import type { EffectDefinition } from "../shared/effects.js";
import type { MoveDefinition } from "../shared/types.js";
import { createStyleMoves } from "./create-style-moves.js";

const structuredEffectsByMoveId = new Map<string, readonly EffectDefinition[]>([
  [
    "move-freestyle-all-out-triumphant-beam",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "revert-transformation",
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 25 },
            sourceText: "If your attack roll result is 25 or higher",
          },
          {
            type: "combat-state",
            subject: "opponent",
            state: "transformed",
            sourceText: "your opponent is Transformed",
          },
        ],
        sourceText:
          "SUCCESSFUL - If your attack roll result is 25 or higher and your opponent is Transformed, your opponent reverts back to Base Form",
      },
    ],
  ],
  [
    "move-freestyle-underdog-dropkick",
    [
      {
        trigger: "passive",
        target: "opponent",
        type: "set-resolution-threshold",
        outcome: "stop",
        roll: "defense",
        comparison: "at-least",
        value: { type: "literal", value: 21 },
        resultScope: "current-attack",
        conditions: [
          {
            type: "level-comparison",
            left: "opponent",
            comparison: "higher-than",
            right: "self",
            sourceText: "If your opponent's Level is higher than your level",
          },
        ],
        sourceText:
          "If your opponent's Level is higher than your level, this attack cannot be STOPPED by defensive roll results of 20 or less",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-damage",
        operation: "add",
        percent: { type: "source-expression", text: "-10% Damage" },
        selector: {
          type: "move-selector",
          subject: "target",
          sourceText: "their next attack",
        },
        scope: { type: "next-action", sourceText: "their next attack" },
        conditions: [
          {
            type: "level-comparison",
            left: "opponent",
            comparison: "at-least",
            right: "self",
            difference: { type: "literal", value: 2 },
            sourceText: "If your opponent's Level is at least 2 higher than your level",
          },
        ],
        sourceText:
          "SUCCESSFUL - If your opponent's Level is at least 2 higher than your level, their next attack does -10% Damage",
      },
    ],
  ],
  [
    "move-freestyle-heart-stab",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: {
          type: "source-expression",
          text: 'twice the number of CONSTANT skills with "Swordplay" in the title you currently have activated',
        },
        scope: { type: "current-action", sourceText: "This attack" },
        sourceText:
          'This attack gains +X to the results, where X equals twice the number of CONSTANT skills with "Swordplay" in the title you currently have activated',
      },
    ],
  ],
  [
    "move-freestyle-straining-power-drain",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-resource",
        resource: "ki",
        operation: "lose",
        amount: { type: "literal", value: 3 },
        sourceText: "SUCCESSFUL - Your opponent loses 3 KI to a minimum of 0",
      },
    ],
  ],
  [
    "move-freestyle-protecting-your-vitality",
    [
      {
        trigger: "passive",
        target: "self",
        type: "prevent-status",
        statusId: "sever",
        sourceText: "You cannot be SEVERED",
      },
      {
        trigger: "passive",
        target: "self",
        type: "prevent-status",
        statusId: "break",
        sourceText: "You cannot receive a BREAK",
      },
    ],
  ],
  [
    "move-freestyle-s-combat-kick",
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
          category: "skill",
          sourceText: "one of your opponent's Skills",
        },
        scope: { type: "next-action", sourceText: "the next time they use it" },
        stacking: "prevent",
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 20 },
            sourceText: "If your attack roll result is 20 or more",
          },
        ],
        sourceText:
          "SUCCESSFUL - If your attack roll result is 20 or more, choose one of your opponent's Skills. That Skill costs +1 KI to use or activate the next time they use it. This ability does not stack with itself",
      },
    ],
  ],
  [
    "move-freestyle-energy-redirection",
    [
      {
        trigger: "after-defense-roll",
        target: "self",
        type: "set-combat-result",
        result: "successful",
        resultScope: "matching-die",
        conditions: [
          {
            type: "move-selector",
            subject: "source",
            category: "advanced-attack",
            tags: ["energy"],
            sourceText: "one of your energy Advanced Attacks",
          },
          {
            type: "combat-result",
            actor: "self",
            result: "stopped",
            sourceText: "is STOPPED",
          },
          {
            type: "roll-comparison",
            left: "defense",
            comparison: "at-most",
            right: "attack",
            difference: { type: "literal", value: 2 },
            sourceText: "defensive roll result that is +2 or less your attack roll result",
          },
        ],
        useLimit: { scope: "combat", count: 2, sourceText: "RESTRICTEDx2" },
        activationCost: {
          resource: "ki",
          operation: "lose",
          amount: { type: "literal", value: 1 },
        },
        sourceText:
          "RESTRICTEDx2. Activate when one of your energy Advanced Attacks is STOPPED by a defensive roll result that is +2 or less your attack roll result. That attack roll is SUCCESSFUL. (Apply individually to each roll.) Cost: 1 KI",
      },
    ],
  ],
  [
    "move-freestyle-nullifying-sphere",
    [
      {
        trigger: "action-phase",
        target: "self",
        type: "remove-move-from-combat",
        move: "source",
        sourceText:
          "You may remove a move from your moveset to remove that Skill from your opponent's moveset for the remainder of the match",
      },
      {
        trigger: "action-phase",
        target: "opponent",
        type: "negate",
        conditions: [
          {
            type: "move-selector",
            subject: "target",
            category: "skill",
            constant: false,
            sourceText: "your opponent uses a non-CONSTANT Skill",
          },
        ],
        useLimit: { scope: "combat", count: 1, sourceText: "RESTRICTEDx1" },
        activationCost: {
          resource: "ki",
          operation: "lose",
          amount: { type: "literal", value: 2 },
        },
        sourceText:
          "RESTRICTEDx1. Use when your opponent uses a non-CONSTANT Skill. NEGATE the effect. You may remove a move from your moveset to remove that Skill from your opponent's moveset for the remainder of the match. Cost: 2 KI",
      },
      {
        trigger: "action-phase",
        target: "opponent",
        type: "remove-move-from-combat",
        move: "target",
        conditions: [
          {
            type: "move-selector",
            subject: "target",
            category: "skill",
            constant: false,
            sourceText: "that Skill",
          },
        ],
        sourceText:
          "You may remove a move from your moveset to remove that Skill from your opponent's moveset for the remainder of the match",
      },
    ],
  ],
  [
    "move-freestyle-predictable",
    [
      {
        trigger: "passive",
        target: "opponent",
        type: "lock",
        affectedType: "move",
        selector: {
          type: "move-selector",
          subject: "target",
          sourceText:
            "Name a non-Latent Skill or an Advanced Attack that your opponent has already used this match",
        },
        duration: { type: "combat", sourceText: "while this Skill is active" },
        sourceText:
          "Name a non-Latent Skill or an Advanced Attack that your opponent has already used this match. LOCK that Skill or Advanced Attack for all participants while this Skill is active",
      },
    ],
  ],
  [
    "move-freestyle-combat-kick",
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
          category: "skill",
          sourceText: "one of your opponent's Skills",
        },
        scope: { type: "next-action", sourceText: "the next time they use it" },
        stacking: "prevent",
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 20 },
            sourceText: "If your attack roll result is 20 or more",
          },
        ],
        sourceText:
          "SUCCESSFUL - If your attack roll result is 20 or more, choose one of your opponent's Skills. That Skill costs +1 KI to use or activate the next time they use it. This ability does not stack with itself",
      },
    ],
  ],
  [
    "move-freestyle-suppressive-fire",
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
          category: "skill",
          sourceText: "next 2 skills",
        },
        scope: {
          type: "next-actions",
          count: { type: "literal", value: 2 },
          sourceText: "next 2 skills",
        },
        stacking: "prevent",
        conditions: [
          {
            type: "successful-hit-count",
            comparison: "at-least",
            value: { type: "literal", value: 5 },
            sourceText: "If 5 or more dice rolls are SUCCESSFUL",
          },
        ],
        sourceText:
          "SUCCESSFUL - If 5 or more dice rolls are SUCCESSFUL, your opponent's next 2 skills cost +1 KI to activate or use. This effect does not stack with itself",
      },
    ],
  ],
  [
    "move-freestyle-explosive-round",
    [
      {
        trigger: "on-success",
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
            value: { type: "literal", value: 5 },
            sourceText: "If you were at 5 KI or more before performing this attack",
          },
          {
            type: "move-selector",
            subject: "target",
            category: "skill",
            constant: true,
            sourceText: "a CONSTANT Skill",
          },
        ],
        sourceText:
          "SUCCESSFUL - If you were at 5 KI or more before performing this attack, you may DEACTIVATE a CONSTANT Skill",
      },
    ],
  ],
  [
    "move-freestyle-power-punch",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "lock",
        affectedType: "skill",
        scope: { type: "next-turn", subject: "opponent", sourceText: "for their next turn" },
        sourceText: "SUCCESSFUL - LOCK your opponent's Skills for their next turn",
      },
    ],
  ],
  [
    "move-freestyle-slice-n-hack",
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
    "move-freestyle-expert-swordplay",
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
          effectTextIncludes: "Sword",
          sourceText: "Your attacks that require a Sword",
        },
        sourceText: "Your attacks that require a Sword do +(5% Power) Damage",
      },
      {
        trigger: "passive",
        target: "self",
        type: "modify-roll",
        roll: "defense",
        modifier: "result",
        amount: { type: "literal", value: 2 },
        selector: {
          type: "move-selector",
          subject: "target",
          tags: ["weapon"],
          sourceText: "moves that require a Weapon",
        },
        sourceText: "Your defensive roll results against moves that require a Weapon gain +2",
      },
    ],
  ],
  [
    "move-freestyle-way-of-the-gun",
    [
      {
        trigger: "passive",
        target: "self",
        type: "set-resolution-threshold",
        outcome: "stop",
        roll: "defense",
        comparison: "at-most",
        value: { type: "literal", value: 11 },
        resultScope: "current-attack",
        selector: {
          type: "move-selector",
          subject: "source",
          effectTextIncludes: "Gun",
          sourceText: "Your attacks that require a Gun",
        },
        sourceText:
          "Your attacks that require a Gun cannot be STOPPED by defensive roll results of 11 or less",
      },
      {
        trigger: "passive",
        target: "self",
        type: "prevent-roll-modification",
        roll: "attack",
        modifier: "any",
        selector: {
          type: "move-selector",
          subject: "source",
          effectTextIncludes: "Gun",
          sourceText: "Your attacks that require a Gun",
        },
        sourceText:
          "Your attacks that require a Gun cannot have their dice rolls or results reduced by your opponent's effects",
      },
    ],
  ],
  [
    "move-freestyle-guarded-strikes",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-roll",
        roll: "defense",
        modifier: "result",
        amount: { type: "literal", value: 1 },
        scope: { type: "next-roll", roll: "defense", sourceText: "Your next defensive roll" },
        sourceText: "Your next defensive roll gains +1 to the result",
      },
    ],
  ],
  [
    "move-freestyle-pistol-whip",
    [
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
            sourceText: "If your attack roll result is 20 or more",
          },
        ],
        sourceText: "SUCCESSFUL - If your attack roll result is 20 or more, STUN",
      },
    ],
  ],
  [
    "move-freestyle-bullet-ballet",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "schedule-effect",
        timing: { type: "turn-end", subject: "opponent", turnsAfter: 1 },
        repeat: "each-turn",
        effect: {
          type: "modify-resource",
          resource: "hp",
          operation: "lose",
          amount: { type: "source-expression", text: "2% Their Total HP" },
        },
        conditions: [
          {
            type: "successful-hit-count",
            comparison: "at-least",
            value: { type: "literal", value: 3 },
            sourceText: "If three or more dice rolls are SUCCESSFUL",
          },
        ],
        duration: {
          type: "until-roll-threshold",
          roll: "attack",
          comparison: "at-least",
          value: { type: "literal", value: 25 },
          sourceText: "until they roll an attack roll result of 25 or more",
        },
        sourceText:
          "SUCCESSFUL - If three or more dice rolls are SUCCESSFUL, your opponent loses (2% Their Total HP) HP at the end of each of their turns until they roll an attack roll result of 25 or more",
      },
    ],
  ],
  [
    "move-freestyle-showdown",
    [
      {
        trigger: "upkeep-phase",
        target: "participants",
        type: "suppress",
        selector: {
          type: "move-selector",
          subject: "target",
          category: "skill",
          constant: true,
          sourceText: "Constant Skills",
        },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 4 },
          sourceText: "next 4 turns",
        },
        useLimit: { scope: "combat", count: 1, sourceText: "RESTRICTEDx1" },
        activationCost: {
          resource: "ki",
          operation: "lose",
          amount: { type: "literal", value: 1 },
        },
        sourceText:
          "RESTRICTEDx1. Activate during your UPKEEP phase or when your opponent activates a CONSTANT Skill. Constant Skills have no effect for the next 4 turns. If activated when your opponent activated a CONSTANT Skill, DEACTIVATE that CONSTANT Skill. Cost: 1 KI",
      },
    ],
  ],
  [
    "move-freestyle-aggressive-beatdown",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "apply-status",
        statusId: "stun",
        activationCost: {
          resource: "ki",
          operation: "lose",
          amount: { type: "literal", value: 1 },
        },
        conditions: [
          {
            type: "successful-hit-count",
            comparison: "exactly",
            value: { type: "literal", value: 3 },
            sourceText: "If all attack rolls are SUCCESSFUL",
          },
        ],
        sourceText: "SUCCESSFUL - If all attack rolls are SUCCESSFUL, you may lose 1 KI to STUN",
      },
    ],
  ],
  [
    "move-freestyle-immense-power",
    [
      {
        trigger: "action-phase",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: 5 },
        useLimit: { scope: "combat", count: 1, sourceText: "RESTRICTEDx1" },
        conditions: [
          {
            type: "resource-threshold",
            subject: "self",
            resource: "hp",
            basis: "current",
            comparison: "at-most",
            value: { type: "source-expression", text: "10% Total HP" },
            sourceText: "if you are at (10% Total HP) HP or less",
          },
        ],
        sourceText:
          "(You may only use this Skill if you are at (10% Total HP) HP or less.) RESTRICTEDx1. Gain 5 KI",
      },
      {
        trigger: "action-phase",
        target: "opponent",
        type: "apply-status",
        statusId: "stun",
        conditions: [
          {
            type: "resource-threshold",
            subject: "self",
            resource: "hp",
            basis: "current",
            comparison: "at-most",
            value: { type: "source-expression", text: "10% Total HP" },
            sourceText: "if you are at (10% Total HP) HP or less",
          },
        ],
        sourceText:
          "(You may only use this Skill if you are at (10% Total HP) HP or less.) RESTRICTEDx1. Gain 5 KI. STUN",
      },
      {
        trigger: "action-phase",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: 2 },
        scope: { type: "next-action", sourceText: "Your next attack" },
        sourceText: "Your next attack gains +2 to the result(s)",
      },
      {
        trigger: "action-phase",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "source-expression", text: "10% Power" },
        scope: { type: "next-action", sourceText: "Your next attack" },
        sourceText: "Your next attack gains +2 to the result(s) and does +(10% Power) Damage",
      },
    ],
  ],
  [
    "move-freestyle-dragon-rush",
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
          category: "advanced-attack",
          sourceText: "their attacks",
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
            value: { type: "literal", value: 25 },
            sourceText: "If your attack roll result is 25 or higher",
          },
        ],
        sourceText:
          "SUCCESSFUL - If your attack roll result is 25 or higher, your opponent cannot reduce the cost of their attacks for their next 3 turns",
      },
    ],
  ],
  [
    "move-freestyle-sword-dance",
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
          sourceText: "Your next Advanced Attack that requires a Sword",
        },
        scope: {
          type: "next-action",
          sourceText: "Your next Advanced Attack that requires a Sword",
        },
        sourceText:
          "SUCCESSFUL - Your next Advanced Attack that requires a Sword gains +3 dice sides",
      },
    ],
  ],
  [
    "move-freestyle-batter-up-blitz",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "apply-status",
        statusId: "break",
        conditions: [
          {
            type: "successful-hit-count",
            comparison: "at-least",
            value: { type: "literal", value: 4 },
            sourceText: "If 4 or more dice rolls are SUCCESSFUL",
          },
        ],
        sourceText: "SUCCESSFUL - If 4 or more dice rolls are SUCCESSFUL, BREAK!",
      },
    ],
  ],
  [
    "move-freestyle-crossing-iron",
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
        selector: {
          type: "move-selector",
          subject: "target",
          tags: ["weapon"],
          sourceText: "Your next attack that requires a Weapon",
        },
        scope: { type: "next-action", sourceText: "Your next attack that requires a Weapon" },
        sourceText: "Your next attack that requires a Weapon gains +2 dice sides",
      },
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
          category: "signature",
          tags: ["weapon"],
          sourceText: "If that attack is a Signature Technique",
        },
        scope: { type: "next-action", sourceText: "Your next attack that requires a Weapon" },
        sourceText:
          "Your next attack that requires a Weapon gains +2 dice sides. If that attack is a Signature Technique, it gains +2 to the result as well",
      },
    ],
  ],
  [
    "move-freestyle-heritage-calling",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-roll",
        roll: "transformation",
        modifier: "result",
        amount: { type: "literal", value: 5 },
        scope: {
          type: "next-roll",
          roll: "transformation",
          sourceText: "your next Transformation Roll",
        },
        conditions: [
          {
            type: "combat-state",
            subject: "self",
            state: "transformed",
            sourceText: "If you are currently Transformed",
          },
        ],
        sourceText:
          "If you are currently Transformed, your next Transformation Roll gains +5 to the results",
      },
    ],
  ],
  [
    "move-freestyle-thwack",
    [
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
            value: { type: "literal", value: 27 },
            sourceText: "If your attack roll is 27 or higher",
          },
          {
            type: "prior-action",
            actor: "opponent",
            sourceText: "your opponent acted last turn",
          },
        ],
        sourceText:
          "SUCCESSFUL - If your attack roll is 27 or higher and your opponent acted last turn, STUN",
      },
    ],
  ],
  [
    "move-freestyle-sword-riposte",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "deactivate",
        affectedType: "skill",
        count: { type: "literal", value: 1 },
        conditions: [
          {
            type: "prior-action",
            actor: "opponent",
            result: "stopped",
            sourceText: "If your opponent's last attack was STOPPED",
          },
          {
            type: "move-selector",
            subject: "target",
            category: "skill",
            constant: true,
            sourceText: "one of your opponent's Constant Skills",
          },
        ],
        sourceText:
          "If your opponent's last attack was STOPPED, this attack gains \"SUCCESSFUL - You may DEACTIVATE one of your opponent's Constant Skills\"",
      },
    ],
  ],
  [
    "move-freestyle-sternum-crusher",
    [
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
            constant: true,
            sourceText: "a CONSTANT Skill",
          },
        ],
        sourceText: "SUCCESSFUL - DEACTIVATE a CONSTANT Skill",
      },
    ],
  ],
  [
    "move-freestyle-baton-twirl",
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
            value: { type: "literal", value: 29 },
            sourceText: "If your result is 29 or more",
          },
        ],
        sourceText: "SUCCESSFUL - If your result is 29 or more, BREAK!",
      },
    ],
  ],
  [
    "move-freestyle-cannons-sparking",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "schedule-effect",
        timing: { type: "turn-end", subject: "opponent", turnsAfter: 1 },
        repeat: "each-turn",
        duration: {
          type: "turns",
          turns: { type: "literal", value: 2 },
          sourceText: "at the end of their next 2 turns",
        },
        effect: {
          type: "modify-resource",
          resource: "hp",
          operation: "lose",
          amount: { type: "source-expression", text: "5% Their total HP" },
        },
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 25 },
            sourceText: "If your attack roll result was 25 or more",
          },
        ],
        sourceText:
          "SUCCESSFUL - If your attack roll result was 25 or more, your opponent loses (5% Their total HP) HP at the end of their next 2 turns",
      },
    ],
  ],
  [
    "move-freestyle-straining-distraction-burst",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "apply-status",
        statusId: "stun",
        sourceText: "STUNx2",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "apply-status",
        statusId: "stun",
        sourceText: "STUNx2",
      },
    ],
  ],
  [
    "move-freestyle-suppressive-fire",
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
          category: "skill",
          sourceText: "skills",
        },
        scope: {
          type: "next-actions",
          count: { type: "literal", value: 2 },
          sourceText: "next 2 skills",
        },
        stacking: "prevent",
        conditions: [
          {
            type: "successful-hit-count",
            comparison: "at-least",
            value: { type: "literal", value: 5 },
            sourceText: "If 5 or more dice rolls are SUCCESSFUL",
          },
        ],
        sourceText:
          "SUCCESSFUL - If 5 or more dice rolls are SUCCESSFUL, your opponent's next 2 skills cost +1 KI to activate or use. This effect does not stack with itself",
      },
    ],
  ],
]);

export const FREESTYLE_MOVES: readonly MoveDefinition[] = createStyleMoves(FREESTYLE_STYLE).map(
  (move) => ({
    ...move,
    ...(structuredEffectsByMoveId.has(move.id)
      ? { effects: structuredEffectsByMoveId.get(move.id) }
      : {}),
  }),
);
