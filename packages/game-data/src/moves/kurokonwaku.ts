import type { EffectDefinition } from "../shared/effects.js";
import { KUROKONWAKU_STYLE } from "../styles/kurokonwaku.js";
import { createStyleMoves } from "./create-style-moves.js";

const structuredEffectsByMoveId = new Map<string, readonly EffectDefinition[]>([
  [
    "move-kurokonwaku-darkness-buster",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-roll",
        roll: "attack",
        modifier: "sides",
        amount: { type: "literal", value: -2 },
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
        sourceText:
          "SUCCESSFUL - Your opponent's attack and defensive dice gain -2 dice sides and -2 to the result until they perform a SUCCESSFUL attack",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: -2 },
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
        sourceText:
          "SUCCESSFUL - Your opponent's attack and defensive dice gain -2 dice sides and -2 to the result until they perform a SUCCESSFUL attack",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-roll",
        roll: "defense",
        modifier: "sides",
        amount: { type: "literal", value: -2 },
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
        sourceText:
          "SUCCESSFUL - Your opponent's attack and defensive dice gain -2 dice sides and -2 to the result until they perform a SUCCESSFUL attack",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-roll",
        roll: "defense",
        modifier: "result",
        amount: { type: "literal", value: -2 },
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
        sourceText:
          "SUCCESSFUL - Your opponent's attack and defensive dice gain -2 dice sides and -2 to the result until they perform a SUCCESSFUL attack",
      },
    ],
  ],
  [
    "move-kurokonwaku-energy-lob",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "source-expression", text: "5 - your opponent's current KI" },
        scope: { type: "current-action", sourceText: "Your results" },
        sourceText: "Your results gain +X. X = 5 - your opponent's current KI",
      },
    ],
  ],
  [
    "move-kurokonwaku-sixty-second-meltdown",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "grant-extra-action",
        phase: "action-phase",
        moveCategory: "advanced-attack",
        maximumActions: { type: "literal", value: 2 },
        scope: { type: "current-action", sourceText: "this turn" },
        activationGroup: "sixty-second-meltdown-extra-actions",
        sourceText: "SUCCESSFUL - You may perform 2 more attacks this turn",
      },
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
          sourceText: "they cost -1 KI to a minimum of 1",
        },
        activationGroup: "sixty-second-meltdown-extra-actions",
        sourceText: "If you do, they cost -1 KI to a minimum of 1",
      },
    ],
  ],
  [
    "move-kurokonwaku-fade-to-black",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "set-roll-definition",
        roll: "attack",
        sides: 20,
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
        sourceText:
          "SUCCESSFUL - Your opponent's attack and defensive dice sides are d20 until they perform a SUCCESSFUL attack",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "set-roll-definition",
        roll: "defense",
        sides: 20,
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
        sourceText:
          "SUCCESSFUL - Your opponent's attack and defensive dice sides are d20 until they perform a SUCCESSFUL attack",
      },
    ],
  ],
  [
    "move-kurokonwaku-dance-with-the-devil",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "deactivate",
        affectedType: "skill",
        selector: {
          type: "move-selector",
          subject: "target",
          category: "skill",
          constant: true,
          sourceText: "all of your opponent's CONSTANT Skills",
        },
        sourceText: "SUCCESSFUL - DEACTIVATE all of your opponent's CONSTANT Skills",
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
          constant: true,
          sourceText: "They cannot be reactivated",
        },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 4 },
          sourceText: "for 4 turns",
        },
        sourceText: "They cannot be reactivated for 4 turns",
      },
    ],
  ],
  [
    "move-kurokonwaku-psycho-driver",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-resource",
        resource: "hp",
        operation: "lose",
        amount: { type: "source-expression", text: "20% That Attack's Total Damage" },
        scope: {
          type: "next-action",
          sourceText: "your opponent performs an attack on their next turn",
        },
        sourceText:
          "SUCCESSFUL - If your opponent performs an attack on their next turn, they lose (20% That Attack's Total Damage) HP",
      },
    ],
  ],
  [
    "move-kurokonwaku-ear-piercer",
    [
      {
        trigger: "passive",
        target: "self",
        type: "prevent-resolution",
        prevention: "block",
        scope: { type: "current-action", sourceText: "This attack" },
        sourceText: "This attack cannot be BLOCKED",
      },
    ],
  ],
  [
    "move-kurokonwaku-aerial-maneuvers",
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
    "move-kurokonwaku-cursed-spheres",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "source-expression", text: "-(10 - their current KI)" },
        cap: {
          type: "maximum",
          value: { type: "literal", value: -5 },
          sourceText: "to a maximum penalty of -5",
        },
        scope: { type: "next-roll", roll: "attack", sourceText: "next attack-roll" },
        conditions: [
          {
            type: "successful-hit-count",
            comparison: "exactly",
            value: { type: "literal", value: 2 },
            sourceText: "If both attack rolls are SUCCESSFUL",
          },
        ],
        sourceText:
          "SUCCESSFUL - If both attack rolls are SUCCESSFUL, your opponent's next attack-roll and defensive-roll results suffer a penalty of X. X = 10 - their current KI, to a maximum penalty of -5",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-roll",
        roll: "defense",
        modifier: "result",
        amount: { type: "source-expression", text: "-(10 - their current KI)" },
        cap: {
          type: "maximum",
          value: { type: "literal", value: -5 },
          sourceText: "to a maximum penalty of -5",
        },
        scope: { type: "next-roll", roll: "defense", sourceText: "defensive-roll" },
        conditions: [
          {
            type: "successful-hit-count",
            comparison: "exactly",
            value: { type: "literal", value: 2 },
            sourceText: "If both attack rolls are SUCCESSFUL",
          },
        ],
        sourceText:
          "SUCCESSFUL - If both attack rolls are SUCCESSFUL, your opponent's next attack-roll and defensive-roll results suffer a penalty of X. X = 10 - their current KI, to a maximum penalty of -5",
      },
    ],
  ],
  [
    "move-kurokonwaku-purple-people-skewer",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-resource",
        resource: "ki",
        operation: "lose",
        amount: { type: "source-expression", text: "1 KI per hit" },
        sourceText: "SUCCESSFUL - Your opponent loses 1 KI per hit",
      },
    ],
  ],
  [
    "move-kurokonwaku-sand-in-the-eyes",
    [
      {
        trigger: "on-stopped",
        target: "opponent",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: -4 },
        scope: { type: "next-roll", roll: "attack", sourceText: "next attack" },
        sourceText: "Your opponent's next attack gains -4 to the results",
      },
    ],
  ],
  [
    "move-kurokonwaku-second-chance",
    [
      {
        trigger: "after-defense-roll",
        target: "self",
        type: "reroll",
        roll: "defense",
        rerollScope: "single-result",
        useLimit: { scope: "combat", count: 1, sourceText: "RESTRICTEDx1" },
        sourceText:
          "RESTRICTEDx1. Use after you roll your defensive roll. You may re-roll your defensive roll",
      },
      {
        trigger: "after-defense-roll",
        target: "self",
        type: "modify-roll",
        roll: "defense",
        modifier: "result",
        amount: { type: "literal", value: 5 },
        scope: { type: "next-roll", roll: "defense", sourceText: "the second roll" },
        sourceText:
          "You may re-roll your defensive roll, gaining +5 to the result of the second roll",
      },
      {
        trigger: "passive",
        target: "self",
        type: "prevent-move-modification",
        actor: "opponent",
        aspects: ["cost"],
        selector: {
          type: "move-selector",
          subject: "target",
          category: "skill",
          sourceText: "The cost of this Skill",
        },
        sourceText: "The cost of this Skill cannot be increased",
      },
    ],
  ],
  [
    "move-kurokonwaku-after-image-mastery",
    [
      {
        trigger: "after-defense-roll",
        target: "opponent",
        type: "modify-resource",
        resource: "ki",
        operation: "drain",
        amount: { type: "literal", value: 1 },
        conditions: [
          {
            type: "move-selector",
            subject: "source",
            styleId: KUROKONWAKU_STYLE.id,
            category: "advanced-attack",
            attackRoll: { dice: 1 },
            sourceText: "on a single dice attack",
          },
          {
            type: "roll-comparison",
            left: "attack",
            comparison: "at-least",
            right: "defense",
            difference: { type: "literal", value: 10 },
            sourceText:
              "Whenever your attack roll result is +10 or more than your opponent's defensive roll result",
          },
        ],
        sourceText:
          "Whenever your attack roll result is +10 or more than your opponent's defensive roll result on a single dice attack, DRAIN 1 KI",
      },
      {
        trigger: "after-defense-roll",
        target: "opponent",
        type: "modify-resource",
        resource: "ki",
        operation: "drain",
        amount: { type: "literal", value: 1 },
        conditions: [
          {
            type: "move-selector",
            subject: "source",
            styleId: KUROKONWAKU_STYLE.id,
            category: "advanced-attack",
            attackRoll: { dice: 1 },
            sourceText: "on a single dice attack",
          },
          {
            type: "roll-comparison",
            left: "attack",
            comparison: "at-least",
            right: "defense",
            rightMultiplier: { type: "literal", value: 2 },
            sourceText:
              "Whenever your attack roll result is double your opponent's defense roll result",
          },
        ],
        sourceText:
          "Whenever your attack roll result is double your opponent's defense roll result on a single dice attack, DRAIN 1 KI",
      },
    ],
  ],
  [
    "move-kurokonwaku-darkness-choke",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "lock",
        affectedType: "power-up",
        scope: { type: "next-turn", subject: "opponent", sourceText: "on their next turn" },
        conditions: [
          {
            type: "roll-comparison",
            left: "attack",
            comparison: "at-least",
            right: "defense",
            difference: { type: "literal", value: 6 },
            sourceText:
              "If your attack roll result is +6 or more your opponent's defensive roll result",
          },
        ],
        sourceText:
          "If your attack roll result is +6 or more your opponent's defensive roll result, your opponent cannot Power Up on their next turn",
      },
    ],
  ],
  [
    "move-kurokonwaku-firebreath",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-resource",
        resource: "ki",
        operation: "drain",
        amount: { type: "literal", value: 1 },
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-most",
            value: { type: "literal", value: 24 },
            sourceText: "If your attack roll was 25 or higher",
          },
        ],
        sourceText: "SUCCESSFUL - DRAIN 1 KI. If your attack roll was 25 or higher",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-resource",
        resource: "ki",
        operation: "drain",
        amount: { type: "literal", value: 2 },
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 25 },
            sourceText: "If your attack roll was 25 or higher",
          },
        ],
        sourceText: "If your attack roll was 25 or higher, DRAIN 2 KI instead",
      },
    ],
  ],
  [
    "move-kurokonwaku-cannonball",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-resource",
        resource: "ki",
        operation: "drain",
        amount: { type: "literal", value: 2 },
        sourceText: "SUCCESSFUL - DRAIN 2 KI",
      },
    ],
  ],
  [
    "move-kurokonwaku-empty-beam",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "lock",
        affectedType: "power-up",
        duration: {
          type: "turns",
          turns: { type: "literal", value: 2 },
          sourceText: "for their next 2 turns",
        },
        conditions: [
          {
            type: "resource-threshold",
            subject: "opponent",
            resource: "ki",
            basis: "current",
            comparison: "at-most",
            value: { type: "literal", value: 0 },
            sourceText: "If your opponent's KI are at 0",
          },
        ],
        sourceText:
          "SUCCESSFUL - If your opponent's KI are at 0, your opponent cannot Power Up for their next 2 turns",
      },
      {
        trigger: "on-stopped",
        target: "opponent",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: -1 },
        scope: { type: "next-roll", roll: "attack", sourceText: "next attack roll" },
        sourceText: "STOPPED - Your opponent's next attack roll gains -1 to the result",
      },
    ],
  ],
  [
    "move-kurokonwaku-shockwave",
    [
      {
        trigger: "on-stopped",
        target: "opponent",
        type: "modify-resource",
        resource: "hp",
        operation: "lose",
        amount: { type: "source-expression", text: "10% Power" },
        sourceText: "STOPPED - Your opponent loses (10% Power) HP",
      },
    ],
  ],
  [
    "move-kurokonwaku-strategic-breakdown",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "lock",
        affectedType: "move",
        scope: {
          type: "next-turn",
          subject: "opponent",
          sourceText: "for your opponent's next turn",
        },
        sourceText:
          "SUCCESSFUL - Choose two of your opponent's Skills, Advanced Attacks, or Signature Techniques. LOCK those moves for your opponent's next turn",
      },
    ],
  ],
  [
    "move-kurokonwaku-eggsplosives",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "apply-status",
        statusId: "stun",
        conditions: [
          {
            type: "resource-threshold",
            subject: "opponent",
            resource: "ki",
            basis: "current",
            comparison: "at-most",
            value: { type: "literal", value: 0 },
            sourceText: "If your opponent's KI are at 0",
          },
        ],
        sourceText: "SUCCESSFUL - If your opponent's KI are at 0, STUN",
      },
    ],
  ],
  [
    "move-kurokonwaku-launching-kick",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "grant-extra-action",
        phase: "upkeep-phase",
        moveCategory: "skill",
        constant: true,
        scope: { type: "next-turn", subject: "self", sourceText: "At the start of your next turn" },
        activationCost: {
          resource: "ki",
          operation: "lose",
          amount: { type: "literal", value: 1 },
        },
        sourceText:
          "SUCCESSFUL - At the start of your next turn, you may pay 1 KI to activate a Kurokonwaku CONSTANT Skill",
      },
    ],
  ],
  [
    "move-kurokonwaku-neuron-disruptor",
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
          sourceText: "one of your opponent's Skills",
        },
        duration: { type: "combat", sourceText: "for the remainder of the match" },
        sourceText:
          "SUCCESSFUL - Choose one of your opponent's Skills. LOCK that Skill for the remainder of the match",
      },
    ],
  ],
  [
    "move-kurokonwaku-proximity-blast",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "set-roll-definition",
        roll: "attack",
        dice: 1,
        sides: 35,
        scope: {
          type: "next-action",
          sourceText: "Your next single dice UNRESTRICTED Advanced Attack",
        },
        sourceText:
          "SUCCESSFUL - Your next single dice UNRESTRICTED Advanced Attack has a base roll of 1d35 instead",
      },
    ],
  ],
  [
    "move-kurokonwaku-sinister-claw",
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
          sourceText: "Your opponent's next Skill",
        },
        scope: { type: "next-action", sourceText: "Your opponent's next Skill" },
        stacking: "allow",
        sourceText:
          "Your opponent's next Skill costs +1 KI to use or activate. If you DRAINED Ki in the last 2 turns, this amount increases to +2 KI. This effect stacks up to +4 KI",
      },
    ],
  ],
  [
    "move-kurokonwaku-surprise",
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
        scope: {
          type: "next-turn",
          subject: "self",
          sourceText: "until the end of your next turn",
        },
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 15 },
            sourceText: "If your attack roll result is 15 or higher",
          },
        ],
        sourceText:
          "SUCCESSFUL - If your attack roll result is 15 or higher, LOCK your opponent's Mastery until the end of your next turn",
      },
    ],
  ],
  [
    "move-kurokonwaku-poison-mist",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "schedule-effect",
        timing: { type: "phase-start", phase: "upkeep", subject: "opponent", turnsAfter: 1 },
        repeat: "each-turn",
        effect: {
          type: "modify-resource",
          resource: "ki",
          operation: "drain",
          amount: { type: "literal", value: 1 },
        },
        duration: {
          type: "until-roll-threshold",
          roll: "attack",
          comparison: "at-least",
          value: { type: "literal", value: 23 },
          sourceText:
            "until they roll an attack roll result of 23 or higher on a single dice attack",
        },
        stacking: "prevent",
        sourceText:
          "SUCCESSFUL - DRAIN 1 KI during your opponent's UPKEEP phase until they roll an attack roll result of 23 or higher on a single dice attack. This effect does not stack with itself",
      },
    ],
  ],
  [
    "move-kurokonwaku-kick-them-when-they-re-down",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-resource",
        resource: "ki",
        operation: "drain",
        amount: { type: "literal", value: 2 },
        conditions: [
          {
            type: "action-sequence",
            actor: "opponent",
            result: "stopped",
            count: 2,
            sourceText:
              "immediately after two of your opponent's consecutive attacks have been STOPPED",
          },
        ],
        sourceText:
          "Timing: immediately after two of your opponent's consecutive attacks have been STOPPED. This does not take up your turn. COOLDOWN 1. Physical attack. Deal (20% Power) damage. SUCCESSFUL - DRAIN 2 KI",
      },
    ],
  ],
  [
    "move-kurokonwaku-burrowing-beam",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: -4 },
        selector: {
          type: "move-selector",
          subject: "target",
          effectTextExcludes: "Bukujutsu",
          sourceText: "attacks that do not require Bukujutsu",
        },
        duration: {
          type: "until-resource-threshold",
          subject: "opponent",
          resource: "ki",
          comparison: "at-least",
          value: { type: "literal", value: 5 },
          sourceText: "until your opponent's KI are at 5 or higher",
        },
        sourceText:
          "SUCCESSFUL - Your opponent's attacks that do not require Bukujutsu gain -4 to the results until your opponent's KI are at 5 or higher",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-roll",
        roll: "defense",
        modifier: "result",
        amount: { type: "literal", value: -4 },
        selector: {
          type: "move-selector",
          subject: "target",
          effectTextExcludes: "Bukujutsu",
          sourceText: "attacks that do not require Bukujutsu",
        },
        duration: {
          type: "until-resource-threshold",
          subject: "opponent",
          resource: "ki",
          comparison: "at-least",
          value: { type: "literal", value: 5 },
          sourceText: "until your opponent's KI are at 5 or higher",
        },
        sourceText:
          "SUCCESSFUL - Your opponent's attacks that do not require Bukujutsu gain -4 to the results until your opponent's KI are at 5 or higher",
      },
    ],
  ],
  [
    "move-kurokonwaku-dismissive-kick",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "suppress",
        aspects: ["successful-effects"],
        selector: {
          type: "move-selector",
          subject: "target",
          category: "advanced-attack",
          sourceText: "Choose one of your opponent's Advanced Attacks",
        },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 2 },
          sourceText: "for their next 2 turns",
        },
        sourceText:
          "SUCCESSFUL - Choose one of your opponent's Advanced Attacks. That attack loses all SUCCESSFUL effects for their next 2 turns",
      },
    ],
  ],
  [
    "move-kurokonwaku-dark-energy-spiral",
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
          restriction: "unrestricted",
          sourceText: "next UNRESTRICTED Advanced Attack",
        },
        scope: { type: "next-action", sourceText: "next UNRESTRICTED Advanced Attack" },
        sourceText:
          "SUCCESSFUL - Your opponent's next UNRESTRICTED Advanced Attack costs +1 KI to perform",
      },
    ],
  ],
  [
    "move-kurokonwaku-squeezebox",
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
            sourceText: "one of your opponent's CONSTANT skills",
          },
        ],
        sourceText: "SUCCESSFUL - DEACTIVATE one of your opponent's CONSTANT skills",
      },
    ],
  ],
  [
    "move-kurokonwaku-shadow-realm",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "lock",
        affectedType: "power-up",
        duration: {
          type: "turns",
          turns: { type: "literal", value: 2 },
          sourceText: "for their next 2 turns",
        },
        sourceText: "Your opponent cannot Power Up for their next 2 turns",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "skip-action",
        blockedCategories: ["advanced-attack", "signature"],
        duration: {
          type: "turns",
          turns: { type: "literal", value: 2 },
          sourceText: "on your next 2 turns",
        },
        sourceText: "You cannot attack them on your next 2 turns",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "schedule-effect",
        timing: { type: "turn-start", subject: "opponent", turnsAfter: 3 },
        effect: {
          type: "modify-resource",
          resource: "ki",
          operation: "gain",
          amount: { type: "literal", value: 4 },
        },
        sourceText: "On their third turn, they gain +4 KI",
      },
    ],
  ],
  [
    "move-kurokonwaku-shinobi-slash",
    [
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
    "move-kurokonwaku-concussion-shot",
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
          restriction: "unrestricted",
          sourceText: "one of your opponent's UNRESTRICTED Advanced Attacks",
        },
        duration: { type: "combat", sourceText: "for the remainder of the match" },
        sourceText:
          "SUCCESSFUL - Choose one of your opponent's UNRESTRICTED Advanced Attacks. LOCK that Advanced Attack for the remainder of the match",
      },
    ],
  ],
  [
    "move-kurokonwaku-black-hole-slam",
    [
      {
        trigger: "on-stopped",
        target: "opponent",
        type: "modify-resource",
        resource: "hp",
        operation: "lose",
        amount: { type: "source-expression", text: "55% Your Power" },
        conditions: [
          {
            type: "resource-threshold",
            subject: "opponent",
            resource: "ki",
            basis: "current",
            comparison: "at-most",
            value: { type: "literal", value: 4 },
            sourceText: "If your opponent's KI are 4 or less",
          },
        ],
        sourceText:
          "STOPPED - If your opponent's KI are 4 or less, your opponent loses (55% Your Power) HP",
      },
    ],
  ],
  [
    "move-kurokonwaku-chaos-detonation",
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
          sourceText: "one of your opponent's Advanced Attacks",
        },
        duration: { type: "combat", sourceText: "for the remainder of the match" },
        sourceText:
          "SUCCESSFUL - Choose one of your opponent's Advanced Attacks. LOCK that Advanced Attack for the remainder of the match",
      },
    ],
  ],
  [
    "move-kurokonwaku-mirage",
    [
      {
        trigger: "on-stopped",
        target: "opponent",
        type: "lock",
        affectedType: "attack",
        selector: {
          type: "move-selector",
          subject: "target",
          sourceText: "that attack",
        },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 1 },
          sourceText: "for your opponent's next turn",
        },
        sourceText: "LOCK that attack against you for your opponent's next turn",
      },
    ],
  ],
  [
    "move-kurokonwaku-go-boom",
    [
      {
        trigger: "on-stopped",
        target: "opponent",
        type: "modify-resource",
        resource: "hp",
        operation: "lose",
        amount: { type: "source-expression", text: "15% Your Power" },
        cap: {
          type: "minimum",
          value: { type: "literal", value: 1 },
          sourceText: "If this effect would bring them to 0 HP, set their HP to 1 instead",
        },
        sourceText:
          "Your opponent loses (15% Your Power) HP. If this effect would bring them to 0 HP, set their HP to 1 instead",
      },
    ],
  ],
  [
    "move-kurokonwaku-smokescreen",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-resource",
        resource: "ki",
        operation: "lose",
        amount: { type: "literal", value: 1 },
        scope: { type: "next-action", sourceText: "your next attack" },
        conditions: [
          {
            type: "prior-action",
            actor: "opponent",
            result: "stopped",
            selector: {
              type: "move-selector",
              subject: "target",
              tags: ["ENERGY"],
              sourceText: "an energy attack",
            },
            sourceText: "If this Block STOPPED an energy attack",
          },
        ],
        sourceText:
          'If this Block STOPPED an energy attack, your next attack gains "SUCCESSFUL - Your opponent loses 1 KI"',
      },
    ],
  ],
  [
    "move-kurokonwaku-setting-up-the-punchline",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: 5 },
        selector: {
          type: "move-selector",
          subject: "source",
          ids: [
            "move-kurokonwaku-concussion-shot",
            "move-kurokonwaku-breaking-the-cycle",
            "move-kurokonwaku-neuron-disruptor",
          ],
          sourceText: "Concussion Shot, Breaking the Cycle, and Neuron Disruptor",
        },
        sourceText:
          "While this attack is in your moveset, Concussion Shot, Breaking the Cycle, and Neuron Disruptor gain +5 to their results",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: 5 },
        scope: { type: "next-turn", subject: "self", sourceText: "on your next turn" },
        selector: {
          type: "move-selector",
          subject: "source",
          ids: [
            "move-kurokonwaku-concussion-shot",
            "move-kurokonwaku-breaking-the-cycle",
            "move-kurokonwaku-neuron-disruptor",
          ],
          sourceText: "Concussion Shot, Breaking the Cycle, or Neuron Disruptor",
        },
        sourceText:
          "SUCCESSFUL - If you perform Concussion Shot, Breaking the Cycle, or Neuron Disruptor on your next turn, it gains +5 to the result",
      },
    ],
  ],
  [
    "move-kurokonwaku-bloodletter",
    [
      {
        trigger: "on-resource-drain",
        target: "opponent",
        type: "modify-resource",
        resource: "ki",
        operation: "drain",
        amount: { type: "literal", value: 1 },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 2 },
          sourceText: "For your next 2 turns",
        },
        sourceText: "For your next 2 turns, when you DRAIN Ki, DRAIN +1 KI",
      },
    ],
  ],
  [
    "move-kurokonwaku-tesla-coil",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-resource",
        resource: "ki",
        operation: "set",
        amount: { type: "source-expression", text: "your current KI" },
        conditions: [
          {
            type: "roll-comparison",
            left: "attack",
            comparison: "at-least",
            right: "defense",
            rightMultiplier: { type: "literal", value: 2 },
            sourceText: "If your attack roll is 2x or more your opponent's defensive roll result",
          },
          {
            type: "resource-comparison",
            resource: "ki",
            basis: "current",
            left: "opponent",
            comparison: "higher-than",
            right: "self",
            sourceText: "until they are equal or lower than yours",
          },
        ],
        sourceText:
          "SUCCESSFUL - If your attack roll is 2x or more your opponent's defensive roll result, your opponent loses KI until they are equal or lower than yours",
      },
      {
        trigger: "on-stopped",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: 2 },
        scope: { type: "next-action", sourceText: "Your next attack" },
        selector: {
          type: "move-selector",
          subject: "source",
          effectKinds: ["resource-loss", "roll-side-reduction"],
          sourceText: "attack with an effect to have your opponent lose dice sides or KI",
        },
        sourceText:
          "STOPPED - Your next attack with an effect to have your opponent lose dice sides or KI gains +2 to the result(s)",
      },
    ],
  ],
  [
    "move-kurokonwaku-power-drain",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "grant-racial-traits",
        source: "opponent",
        duration: {
          type: "turns",
          turns: { type: "literal", value: 1 },
          sourceText: "until the end of your next turn",
        },
        sourceText:
          "SUCCESSFUL - You gain your opponent's Racial Traits until the end of your next turn",
      },
    ],
  ],
  [
    "move-kurokonwaku-manipulation-mastery",
    [
      {
        trigger: "before-defense-roll",
        target: "self",
        type: "set-combat-result",
        result: "stopped",
        resultScope: "matching-die",
        conditions: [
          {
            type: "combat-result",
            actor: "self",
            result: "successful",
            sourceText: 'change any "SUCCESSFUL" effects on your dice to "STOPPED" effects',
          },
          {
            type: "move-selector",
            subject: "source",
            styleId: "style-kurokonwaku",
            sourceText: "on a Kurokonwaku attack",
          },
        ],
        sourceText:
          'Timing: after you roll your attack roll on a Kurokonwaku attack and before your opponent rolls their defensive roll. You may choose to change any "SUCCESSFUL" effects on your dice to "STOPPED" effects and vise versa',
      },
      {
        trigger: "before-defense-roll",
        target: "self",
        type: "set-combat-result",
        result: "successful",
        resultScope: "matching-die",
        conditions: [
          {
            type: "combat-result",
            actor: "self",
            result: "stopped",
            sourceText:
              'change any "SUCCESSFUL" effects on your dice to "STOPPED" effects and vise versa',
          },
          {
            type: "move-selector",
            subject: "source",
            styleId: "style-kurokonwaku",
            sourceText: "on a Kurokonwaku attack",
          },
        ],
        sourceText:
          'Timing: after you roll your attack roll on a Kurokonwaku attack and before your opponent rolls their defensive roll. You may choose to change any "SUCCESSFUL" effects on your dice to "STOPPED" effects and vise versa',
      },
    ],
  ],
]);

export const KUROKONWAKU_MOVES = createStyleMoves(KUROKONWAKU_STYLE).map((move) => ({
  ...move,
  ...(structuredEffectsByMoveId.has(move.id)
    ? { effects: structuredEffectsByMoveId.get(move.id) }
    : {}),
}));
