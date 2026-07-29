import { AKAIKARU_STYLE } from "../styles/akaikaru.js";
import { createStyleMoves } from "./create-style-moves.js";
import type { EffectDefinition } from "../shared/effects.js";
import type { MoveDefinition } from "../shared/types.js";

const structuredEffectsByMoveId = new Map<string, readonly EffectDefinition[]>([
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
        percent: { type: "source-expression", text: "20% Power" },
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
        percent: { type: "source-expression", text: "5% Power" },
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
          amount: { type: "source-expression", text: "5% Power" },
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
          amount: { type: "source-expression", text: "5% Power" },
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
        amount: { type: "source-expression", text: "5% Total HP" },
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
        percent: { type: "source-expression", text: "10% Power" },
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
]);

export const AKAIKARU_MOVES: readonly MoveDefinition[] = createStyleMoves(AKAIKARU_STYLE).map(
  (move) => ({
    ...move,
    ...(structuredEffectsByMoveId.has(move.id)
      ? { effects: structuredEffectsByMoveId.get(move.id) }
      : {}),
  }),
);
