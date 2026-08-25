import { FREESTYLE_STYLE } from "../styles/freestyle.js";
import type { EffectDefinition } from "../shared/effects.js";
import type { MoveDefinition } from "../shared/types.js";
import { createStyleMoves } from "./create-style-moves.js";

const structuredEffectsByMoveId = new Map<string, readonly EffectDefinition[]>([
  [
    "move-freestyle-hidden-power-level",
    [
      {
        trigger: "upkeep-phase",
        target: "self",
        type: "create-floating-effect",
        floatingEffectId: "hidden-power-level-zero-ki-recovery",
        activationCost: {
          resource: "ki",
          operation: "lose",
          amount: { type: "literal", value: 2 },
        },
        useLimit: { scope: "combat", count: 1, sourceText: "Once per combat" },
        conditions: [
          {
            type: "resource-threshold",
            subject: "self",
            resource: "ki",
            basis: "current",
            comparison: "at-least",
            value: { type: "literal", value: 7 },
            sourceText: "when you are at 7 KI or more",
          },
        ],
        effects: [
          {
            trigger: "on-resource-threshold",
            target: "self",
            type: "modify-resource",
            resource: "ki",
            operation: "gain",
            amount: { type: "literal", value: 3 },
            conditions: [
              {
                type: "resource-threshold",
                subject: "self",
                resource: "ki",
                basis: "current",
                comparison: "at-most",
                value: { type: "literal", value: 0 },
                sourceText: "the next time your KI reach 0",
              },
            ],
            sourceText: "the next time your KI reach 0, you may gain 3 KI",
          },
        ],
        sourceText:
          "Timing: UPKEEP phase. Once per combat, when you are at 7 KI or more, you may spend 2 KI. If you do, the next time your KI reach 0, you may gain 3 KI",
      },
    ],
  ],
  [
    "move-freestyle-sense-power-level",
    [
      {
        trigger: "start-combat",
        target: "self",
        type: "modify-roll",
        roll: "initiative",
        modifier: "result",
        amount: { type: "literal", value: 10 },
        scope: { type: "current-action", sourceText: "your roll" },
        sourceText:
          "If you have to roll to see who begins the match, your roll gains +10 to the result",
      },
      {
        trigger: "start-combat",
        target: "self",
        type: "modify-roll",
        roll: "defense",
        modifier: "result",
        amount: { type: "literal", value: 5 },
        scope: {
          type: "next-rolls",
          roll: "defense",
          count: { type: "literal", value: 2 },
          sourceText: "your first two defensive roll result",
        },
        conditions: [
          {
            type: "level-comparison",
            left: "opponent",
            comparison: "higher-than",
            right: "self",
            sourceText: "If your opponent's Level is higher than yours",
          },
        ],
        sourceText:
          "If your opponent's Level is higher than yours, your first two defensive roll result gain +5 and your escape rolls gain +1 to the combined result",
      },
      {
        trigger: "start-combat",
        target: "self",
        type: "modify-roll",
        roll: "escape",
        modifier: "result",
        amount: { type: "literal", value: 1 },
        conditions: [
          {
            type: "level-comparison",
            left: "opponent",
            comparison: "higher-than",
            right: "self",
            sourceText: "If your opponent's Level is higher than yours",
          },
        ],
        sourceText:
          "If your opponent's Level is higher than yours, your first two defensive roll result gain +5 and your escape rolls gain +1 to the combined result",
      },
    ],
  ],
  [
    "move-freestyle-unquenchable-bloodthirst",
    [
      {
        trigger: "passive",
        target: "participants",
        type: "prevent-resource-modification",
        resource: "hp",
        operation: "gain",
        sourceText: "No player may gain HP or set their HP",
      },
      {
        trigger: "passive",
        target: "participants",
        type: "prevent-resource-modification",
        resource: "hp",
        operation: "set",
        sourceText: "No player may gain HP or set their HP",
      },
      {
        trigger: "on-deactivated",
        target: "self",
        type: "lock",
        affectedType: "skill",
        selector: {
          type: "move-selector",
          subject: "source",
          ids: ["move-freestyle-unquenchable-bloodthirst"],
          sourceText: "this Skill",
        },
        duration: { type: "combat", sourceText: "for the remainder of the match" },
        sourceText: "Once DEACTIVATED, LOCK this Skill for the remainder of the match",
      },
    ],
  ],
  [
    "move-freestyle-straining-bodyslam",
    [
      {
        trigger: "before-attack-roll",
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
        optional: true,
        activationGroup: "straining-bodyslam-paid-hp",
        sourceText: "You may lose (10% Current HP) HP when you perform this attack",
      },
      {
        trigger: "before-attack-roll",
        target: "opponent",
        type: "schedule-effect",
        timing: { type: "turn-end", subject: "opponent", turnsAfter: 0 },
        repeat: "each-turn",
        effect: {
          type: "modify-resource",
          resource: "ki",
          operation: "lose",
          amount: { type: "literal", value: 1 },
        },
        cancellation: {
          actor: "opponent",
          result: "successful",
          moveSelector: {
            type: "move-selector",
            subject: "target",
            category: "advanced-attack",
            attackRoll: { dice: 1 },
            sourceText: "a SUCCESSFUL single dice attack",
          },
          target: "source",
        },
        activationGroup: "straining-bodyslam-paid-hp",
        sourceText:
          "If you do, your opponent loses 1 KI at the end of each of their turns until they perform a SUCCESSFUL single dice attack",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: -4 },
        stacking: "prevent",
        duration: {
          type: "until-combat-result",
          actor: "opponent",
          result: "successful",
          moveSelector: {
            type: "move-selector",
            subject: "target",
            category: "advanced-attack",
            attackRoll: { dice: 1 },
            sourceText: "a SUCCESSFUL single dice attack",
          },
          sourceText: "until they perform a SUCCESSFUL single dice attack",
        },
        sourceText:
          "SUCCESSFUL - Your opponent's attack roll results gain -4 until they perform a SUCCESSFUL single dice attack. This effect cannot stack with itself",
      },
    ],
  ],
  [
    "move-freestyle-straining-knockback",
    [
      {
        trigger: "before-attack-roll",
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
        optional: true,
        activationGroup: "straining-knockback-paid-hp",
        sourceText: "You may lose (10% Current HP) HP when you perform this attack",
      },
      {
        trigger: "before-attack-roll",
        target: "opponent",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: 1 },
        selector: {
          type: "move-selector",
          subject: "target",
          category: "advanced-attack",
          sourceText: "your opponent's Advanced Attacks",
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
            sourceText: "a SUCCESSFUL single dice attack",
          },
          sourceText: "until they perform a SUCCESSFUL single dice attack",
        },
        activationGroup: "straining-knockback-paid-hp",
        sourceText:
          "If you do, your opponent's Advanced Attacks cost +1 KI until they perform a SUCCESSFUL single dice attack",
      },
    ],
  ],
  [
    "move-freestyle-straining-aura-explosion",
    [
      {
        trigger: "passive",
        target: "self",
        type: "prevent-resolution",
        prevention: "block",
        sourceText: "This attack cannot be BLOCKED",
      },
      {
        trigger: "before-attack-roll",
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
            type: "prior-action",
            actor: "self",
            action: "power-up",
            sourceText: "You can only perform this attack if you Powered Up on your last turn",
          },
        ],
        sourceText:
          "Energy attack. Deal (50% Power) damage. This attack cannot be BLOCKED. You must lose (10% Current HP) HP to perform this attack. You can only perform this attack if you Powered Up on your last turn. SUCCESSFUL - Your opponent gains -2 KI the next time they Power Up. If your attack roll result is 27 or more, gain 1 KI. Cost: 2 KI.",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: -2 },
        scope: {
          type: "next-resource-gain",
          resource: "ki",
          subject: "opponent",
          sourceText: "the next time they Power Up",
        },
        sourceText: "SUCCESSFUL - Your opponent gains -2 KI the next time they Power Up",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: 1 },
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 27 },
            sourceText: "If your attack roll result is 27 or more",
          },
        ],
        sourceText: "If your attack roll result is 27 or more, gain 1 KI",
      },
    ],
  ],
  [
    "move-freestyle-multitasking-kick",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: 3 },
        scope: { type: "current-action", sourceText: "this attack" },
        conditions: [
          {
            type: "prior-action",
            actor: "opponent",
            result: "stopped",
            sourceText: "If you STOPPED your opponent's last attack",
          },
        ],
        sourceText:
          "If you STOPPED your opponent's last attack, this attack gains +3 to its result",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "grant-extra-action",
        phase: "upkeep-phase",
        moveCategory: "item-use",
        scope: { type: "next-turn", subject: "self", sourceText: "On your next turn" },
        optional: true,
        sourceText:
          "SUCCESSFUL - On your next turn, you may use an item in your inventory during your UPKEEP phase instead of your ACTION phase",
      },
    ],
  ],
  [
    "move-freestyle-tricky-sword-maneuvers",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "activate",
        selector: {
          type: "move-selector",
          subject: "source",
          category: "skill",
          constant: true,
          effectTextIncludes: "Swordplay",
          sourceText: "a CONSTANT Skill with 'Swordplay' in the title",
        },
        optional: true,
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
          "SUCCESSFUL - If your attack roll result is 20 or more, you may activate a CONSTANT Skill with 'Swordplay' in the title",
      },
      {
        trigger: "passive",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: 3 },
        scope: { type: "current-action", sourceText: "this attack" },
        conditions: [
          {
            type: "move-effect-active",
            subject: "self",
            selector: {
              type: "move-selector",
              subject: "source",
              ids: ["move-freestyle-expert-swordplay"],
              sourceText: "'Expert Swordplay' is already activated",
            },
            sourceText: "If 'Expert Swordplay' is already activated",
          },
        ],
        sourceText:
          "If 'Expert Swordplay' is already activated, this attack gains +3 to the results and gains \"SUCCESSFUL - Your opponent loses 1 KI\"",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-resource",
        resource: "ki",
        operation: "lose",
        amount: { type: "literal", value: 1 },
        conditions: [
          {
            type: "move-effect-active",
            subject: "self",
            selector: {
              type: "move-selector",
              subject: "source",
              ids: ["move-freestyle-expert-swordplay"],
              sourceText: "If 'Expert Swordplay' is already activated",
            },
            sourceText: "If 'Expert Swordplay' is already activated",
          },
        ],
        sourceText:
          "If 'Expert Swordplay' is already activated, this attack gains +3 to the results and gains \"SUCCESSFUL - Your opponent loses 1 KI\"",
      },
    ],
  ],
  [
    "move-freestyle-vile-energy",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "activate",
        selector: {
          type: "move-selector",
          subject: "source",
          category: "skill",
          constant: true,
          sourceText: "CONSTANT Skills in your moveset",
        },
        repeatUntil: {
          type: "active-move-count-matches-opponent",
          selector: {
            type: "move-selector",
            subject: "source",
            category: "skill",
            constant: true,
            sourceText: "CONSTANT Skills activated",
          },
          fallback: "no-eligible-moves",
        },
        sourceText:
          "SUCCESSFUL - You may activate CONSTANT Skills in your moveset until you have the same number of CONSTANT Skills activated as your opponent, or until you have no more CONSTANT Skills that can be activated (whichever happens first)",
      },
    ],
  ],
  [
    "move-freestyle-monkey-maneuvers",
    [
      {
        trigger: "passive",
        target: "self",
        type: "prevent-roll-modification",
        roll: "attack",
        modifier: "any",
        selector: {
          type: "move-selector",
          subject: "source",
          requirementIncludes: ["blunt weapon"],
          sourceText: "attacks that require a Blunt Weapon",
        },
        sourceText:
          "Your attacks that require a Blunt Weapon cannot have their dice sides or results decreased by your opponent's effects",
      },
      {
        trigger: "passive",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: {
          type: "bounded-stat",
          subject: "self",
          stat: "dexterity-bonus",
          minimum: 1,
          maximum: 3,
        },
        selector: {
          type: "move-selector",
          subject: "source",
          requirementIncludes: ["blunt weapon"],
          sourceText: 'attacks with "Requirement: Blunt Weapon"',
        },
        scope: { type: "current-action", sourceText: "Your attack roll" },
        sourceText:
          'Your attacks with "Requirement: Blunt Weapon" gain "Your attack roll gains +X to the result, to a maximum of +3 from this Skill. X = Your Dexterity Bonus, minimum 1."',
      },
      {
        trigger: "passive",
        target: "self",
        type: "modify-roll",
        roll: "defense",
        modifier: "result",
        amount: { type: "literal", value: 2 },
        conditions: [
          {
            type: "move-selector",
            subject: "target",
            requirementIncludes: ["weapon"],
            sourceText: "moves that require a Weapon",
          },
        ],
        sourceText: "Your defensive roll results against moves that require a Weapon gain +2",
      },
    ],
  ],
  [
    "move-freestyle-anger-manipulation",
    [
      {
        trigger: "on-stopped",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "triggering-move-ki-cost" },
        conditions: [
          {
            type: "move-selector",
            subject: "source",
            category: "advanced-attack",
            attackRoll: { minimumDice: 2 },
            sourceText: "a multi-dice attack",
          },
          {
            type: "stopped-hit-fraction",
            comparison: "more-than-half",
            sourceText: "over half of the dice rolls were STOPPED",
          },
        ],
        useLimit: { scope: "combat", count: 1, sourceText: "RESTRICTEDx1" },
        sourceText:
          "RESTRICTEDx1. Use when you perform a multi-dice attack and over half of the dice rolls were STOPPED. Gain X KI. X = The cost of the attack you performed",
      },
      {
        trigger: "on-stopped",
        target: "self",
        type: "lock",
        affectedType: "attack",
        selector: { type: "move-selector", subject: "source", sourceText: "that attack" },
        scope: { type: "next-turn", subject: "self", sourceText: "for your next turn" },
        conditions: [
          {
            type: "move-selector",
            subject: "source",
            category: "advanced-attack",
            attackRoll: { minimumDice: 2 },
            sourceText: "a multi-dice attack",
          },
          {
            type: "stopped-hit-fraction",
            comparison: "more-than-half",
            sourceText: "over half of the dice rolls were STOPPED",
          },
        ],
        useLimit: { scope: "combat", count: 1, sourceText: "RESTRICTEDx1" },
        sourceText:
          "RESTRICTEDx1. Use when you perform a multi-dice attack and over half of the dice rolls were STOPPED. Gain X KI. X = The cost of the attack you performed. LOCK that attack for your next turn. Cost: 0 KI.",
      },
    ],
  ],
  [
    "move-freestyle-guillotine-pummel",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "prevent-resource-modification",
        resource: "ki",
        operation: "gain",
        exceptAction: "power-up",
        duration: {
          type: "turns",
          turns: { type: "successful-hit-count" },
          sourceText: "for X turns. X = The number of SUCCESSFUL attack rolls",
        },
        sourceText:
          "SUCCESSFUL - Your opponent cannot gain KI without Powering Up for X turns. X = The number of SUCCESSFUL attack rolls",
      },
    ],
  ],
  [
    "move-freestyle-effortless",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-resource-cost",
        resource: "hp",
        operation: "add",
        percent: { type: "literal", value: -5 },
        selector: {
          type: "move-selector",
          subject: "source",
          effectTextIncludes: "Straining",
          sourceText: "an attack with 'Straining' in the title",
        },
        optional: true,
        sourceText:
          "Whenever you perform an attack with 'Straining' in the title, you may lose -5% of whichever type of HP that attack states you may or must lose to gain the effects instead",
      },
    ],
  ],
  [
    "move-freestyle-monkey-sweep",
    [
      {
        trigger: "passive",
        target: "self",
        type: "prevent-resolution",
        prevention: "block",
        conditions: [
          {
            type: "combat-outcome",
            actor: "opponent",
            outcome: "break",
            sourceText: "If your opponent has a BREAK or SEVER effect on them",
          },
        ],
        sourceText:
          "If your opponent has a BREAK or SEVER effect on them, this attack cannot be BLOCKED",
      },
      {
        trigger: "passive",
        target: "self",
        type: "prevent-resolution",
        prevention: "block",
        conditions: [
          {
            type: "combat-outcome",
            actor: "opponent",
            outcome: "sever",
            sourceText: "If your opponent has a BREAK or SEVER effect on them",
          },
        ],
        sourceText:
          "If your opponent has a BREAK or SEVER effect on them, this attack cannot be BLOCKED",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "activate",
        selector: {
          type: "move-selector",
          subject: "source",
          ids: ["move-freestyle-monkey-maneuvers"],
          sourceText: "Monkey Maneuvers",
        },
        optional: true,
        sourceText: 'SUCCESSFUL - You may activate "Monkey Maneuvers"',
      },
      {
        trigger: "on-success",
        target: "self",
        type: "create-floating-effect",
        floatingEffectId: "monkey-sweep-next-stun-or-break-bonus",
        scope: {
          type: "next-action",
          sourceText: "your next attack with STUN or BREAK in the effect",
        },
        conditions: [
          {
            type: "move-effect-active",
            subject: "self",
            selector: {
              type: "move-selector",
              subject: "source",
              ids: ["move-freestyle-monkey-maneuvers"],
              sourceText: '"Monkey Maneuvers" is already in play',
            },
            sourceText:
              'If "Monkey Maneuvers" is already in play or cannot be activated by this attack',
          },
        ],
        effects: [
          {
            trigger: "passive",
            target: "self",
            type: "modify-damage",
            operation: "add",
            percent: { type: "literal", value: 10 },
            selector: {
              type: "move-selector",
              subject: "source",
              effectTextIncludesAny: ["STUN", "BREAK"],
              sourceText: "your next attack with STUN or BREAK in the effect",
            },
            scope: { type: "current-action", sourceText: "your next attack" },
            sourceText:
              "your next attack with STUN or BREAK in the effect deals +(10% Power) Damage",
          },
          {
            trigger: "before-defense-roll",
            target: "opponent",
            type: "modify-cost",
            operation: "add",
            amount: { type: "literal", value: 1 },
            selector: {
              type: "move-selector",
              subject: "target",
              category: "block",
              sourceText: "must pay +1 KI to BLOCK it",
            },
            scope: { type: "current-action", sourceText: "BLOCK it" },
            sourceText: "your opponent must pay +1 KI to BLOCK it",
          },
        ],
        sourceText:
          'If "Monkey Maneuvers" is already in play or cannot be activated by this attack, your next attack with STUN or BREAK in the effect deals +(10% Power) Damage and your opponent must pay +1 KI to BLOCK it',
      },
      {
        trigger: "on-success",
        target: "self",
        type: "create-floating-effect",
        floatingEffectId: "monkey-sweep-unavailable-next-stun-or-break-bonus",
        scope: {
          type: "next-action",
          sourceText: "your next attack with STUN or BREAK in the effect",
        },
        conditions: [
          {
            type: "activation-unavailable",
            selector: {
              type: "move-selector",
              subject: "source",
              ids: ["move-freestyle-monkey-maneuvers"],
              sourceText: "cannot be activated by this attack",
            },
            sourceText:
              'If "Monkey Maneuvers" is already in play or cannot be activated by this attack',
          },
        ],
        effects: [
          {
            trigger: "passive",
            target: "self",
            type: "modify-damage",
            operation: "add",
            percent: { type: "literal", value: 10 },
            selector: {
              type: "move-selector",
              subject: "source",
              effectTextIncludesAny: ["STUN", "BREAK"],
              sourceText: "your next attack with STUN or BREAK in the effect",
            },
            scope: { type: "current-action", sourceText: "your next attack" },
            sourceText:
              "your next attack with STUN or BREAK in the effect deals +(10% Power) Damage",
          },
          {
            trigger: "before-defense-roll",
            target: "opponent",
            type: "modify-cost",
            operation: "add",
            amount: { type: "literal", value: 1 },
            selector: {
              type: "move-selector",
              subject: "target",
              category: "block",
              sourceText: "must pay +1 KI to BLOCK it",
            },
            scope: { type: "current-action", sourceText: "BLOCK it" },
            sourceText: "your opponent must pay +1 KI to BLOCK it",
          },
        ],
        sourceText:
          'If "Monkey Maneuvers" is already in play or cannot be activated by this attack, your next attack with STUN or BREAK in the effect deals +(10% Power) Damage and your opponent must pay +1 KI to BLOCK it',
      },
    ],
  ],
  [
    "move-freestyle-underdog-evasion",
    [
      {
        trigger: "on-stopped",
        target: "self",
        type: "override-resolution-immunity",
        resolution: "block",
        conditions: [
          {
            type: "level-comparison",
            left: "opponent",
            comparison: "higher-than",
            right: "self",
            difference: { type: "literal", value: 2 },
            sourceText: "If your opponent's Level is 2 or more above your Level",
          },
        ],
        sourceText:
          "If your opponent's Level is 2 or more above your Level, this Block can Block Advanced Attacks that cannot be STOPPED or BLOCKED",
      },
      {
        trigger: "on-stopped",
        target: "opponent",
        type: "set-combat-result",
        result: "stopped",
        resultScope: "current-attack",
        scope: { type: "next-action", sourceText: "the next attack performed against you" },
        conditions: [
          {
            type: "level-comparison",
            left: "opponent",
            comparison: "higher-than",
            right: "self",
            difference: { type: "literal", value: 3 },
            sourceText: "If your opponent's Level is 3 or more above your Level",
          },
        ],
        sourceText:
          "If your opponent's Level is 3 or more above your Level, STOP the next attack performed against you",
      },
    ],
  ],
  [
    "move-freestyle-straining-concussion-wave",
    [
      {
        trigger: "before-attack-roll",
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
        scope: { type: "current-action", sourceText: "to perform this attack" },
        sourceText: "You must lose (10% Current HP) HP to perform this attack",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "remove-move-from-combat",
        move: "target",
        selector: {
          type: "move-selector",
          subject: "target",
          categories: ["advanced-attack", "skill"],
          sourceText: "one of your opponent's Advanced Attacks or Skills",
        },
        duration: {
          type: "until-perfect-roll",
          sourceText: "until the end of the match, or until they roll a perfect roll",
        },
        sourceText:
          "SUCCESSFUL - Choose one of your opponent's Advanced Attacks or Skills. That move is removed from your opponent's move set until the end of the match, or until they roll a perfect roll",
      },
    ],
  ],
  [
    "move-freestyle-ki-color-cascade",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-move-classification",
        replaceStyle: "declared-style",
        selector: {
          type: "move-selector",
          subject: "source",
          styleId: "style-freestyle",
          sourceText: "Your Freestyle attacks",
        },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 4 },
          sourceText: "for the next 4 turns",
        },
        sourceText:
          "SUCCESSFUL - Your Freestyle attacks are considered to match your declared Martial Arts Style instead for the next 4 turns",
      },
    ],
  ],
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
        percent: { type: "damage-percent", subject: "current-action", percent: -10 },
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
          type: "active-move-effect-text-count",
          subject: "self",
          category: "skill",
          constant: true,
          effectTextIncludes: "Swordplay",
          perMove: 2,
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
        percent: { type: "stat-percent", subject: "self", stat: "power", percent: 5 },
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
          amount: {
            type: "resource-percent",
            subject: "opponent",
            resource: "hp",
            basis: "total",
            percent: 2,
          },
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
        aspects: ["all-effects"],
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
            value: {
              type: "resource-percent",
              subject: "self",
              resource: "hp",
              basis: "total",
              percent: 10,
            },
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
            value: {
              type: "resource-percent",
              subject: "self",
              resource: "hp",
              basis: "total",
              percent: 10,
            },
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
        percent: { type: "stat-percent", subject: "self", stat: "power", percent: 10 },
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
          amount: {
            type: "resource-percent",
            subject: "opponent",
            resource: "hp",
            basis: "total",
            percent: 5,
          },
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
