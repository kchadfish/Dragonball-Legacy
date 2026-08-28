import type { EffectDefinition } from "../shared/effects.js";
import { KUROKONWAKU_STYLE } from "../styles/kurokonwaku.js";
import { createStyleMoves } from "./create-style-moves.js";

const SWEET_DREAMS_LOCK_SOURCE =
  "SUCCESSFUL - Your opponent cannot Power Up, attack, activate Skills, or BLOCK. At the beginning of their turn, they roll a 1d30. This effect ends when your opponent rolls a 20 or higher on that roll. If your opponent rolls a 20 or higher on their first roll, this effect is not ended";

const structuredEffectsByMoveId = new Map<string, readonly EffectDefinition[]>([
  [
    "move-kurokonwaku-childish-taunt",
    [
      {
        trigger: "on-resource-drain",
        target: "opponent",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: -2 },
        duration: {
          type: "turns-or-until-perfect-roll",
          turns: { type: "literal", value: 2 },
          sourceText: "for their next 2 turns unless they roll a perfect roll",
        },
        conflictPolicy: { type: "prevent-duplicate", sourceText: "canonical conflict rule" },
        requirements: [
          {
            type: "moveset-excludes",
            moveIds: ["move-kurokonwaku-killer-gaze"],
          },
        ],
        sourceText:
          "When your opponent loses KI, they gain -2 to their attack roll results for their next 2 turns unless they roll a perfect roll. This cannot be in the same moveset as Killer Gaze. This effect cannot stack with itself",
      },
    ],
  ],
  [
    "move-kurokonwaku-killer-gaze",
    [
      {
        trigger: "on-resource-gain",
        target: "opponent",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: -3 },
        scope: { type: "next-action", sourceText: "their next attack" },
        conflictPolicy: { type: "prevent-duplicate", sourceText: "canonical conflict rule" },
        requirements: [
          {
            type: "moveset-excludes",
            moveIds: ["move-kurokonwaku-childish-taunt"],
          },
        ],
        sourceText:
          "When your opponent gains KI, their next attack gains -3 to all results. This effect does not stack with itself",
      },
      {
        trigger: "passive",
        target: "opponent",
        type: "prevent-move-use",
        operation: "deactivate",
        selector: {
          type: "move-selector",
          subject: "source",
          ids: ["move-kurokonwaku-killer-gaze"],
          sourceText: "this Skill",
        },
        conditions: [
          {
            type: "resource-threshold",
            subject: "opponent",
            resource: "ki",
            basis: "current",
            comparison: "at-most",
            value: { type: "literal", value: 5 },
            sourceText: "unless they are at 6 KI or higher",
          },
        ],
        sourceText:
          "Your opponent cannot DEACTIVATE this Skill unless they are at 6 KI or higher and they meet all other requirements",
      },
    ],
  ],
  [
    "move-kurokonwaku-living-voodoo",
    [
      {
        trigger: "on-stopped",
        target: "self",
        type: "set-combat-result",
        result: "stopped",
        resultScope: "matching-die",
        conditions: [
          {
            type: "move-selector",
            subject: "source",
            restriction: "unrestricted",
            sourceText: "your next UNRESTRICTED attack",
          },
          {
            type: "combat-result",
            actor: "self",
            result: "successful",
            sourceText: "all SUCCESSFUL effects become STOPPED effects instead",
          },
        ],
        scope: { type: "next-action", sourceText: "your next UNRESTRICTED attack" },
        sourceText:
          "If your next UNRESTRICTED attack is STOPPED, you may have all SUCCESSFUL effects become STOPPED effects instead",
      },
    ],
  ],
  [
    "move-kurokonwaku-dimension-scream",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "suppress",
        selector: {
          type: "move-selector",
          subject: "target",
          categories: ["advanced-attack", "signature"],
          sourceText: "Your opponent's attacks",
        },
        aspects: ["all-effects"],
        duration: {
          type: "until-roll-threshold",
          roll: "attack",
          comparison: "at-least",
          value: { type: "prior-roll-result", roll: "attack", addition: 1 },
          sourceText:
            "until the results of one of their attacks exceeds the attack roll result of this attack",
        },
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-most",
            value: { type: "literal", value: 25 },
            sourceText: "If the result of this attack is 26 or higher",
          },
        ],
        sourceText:
          "SUCCESSFUL - Your opponent's attacks do not gain their effects until the results of one of their attacks exceeds the attack roll result of this attack. If the result of this attack is 26 or higher, your opponent's attacks do not gain their effects until the results of one of their attacks exceeds 25 instead",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "suppress",
        selector: {
          type: "move-selector",
          subject: "target",
          categories: ["advanced-attack", "signature"],
          sourceText: "your opponent's attacks",
        },
        aspects: ["all-effects"],
        duration: {
          type: "until-roll-threshold",
          roll: "attack",
          comparison: "at-least",
          value: { type: "literal", value: 26 },
          sourceText: "until the results of one of their attacks exceeds 25 instead",
        },
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 26 },
            sourceText: "If the result of this attack is 26 or higher",
          },
        ],
        sourceText:
          "If the result of this attack is 26 or higher, your opponent's attacks do not gain their effects until the results of one of their attacks exceeds 25 instead",
      },
    ],
  ],
  [
    "move-kurokonwaku-shadow-stalker",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "activate",
        selector: {
          type: "move-selector",
          subject: "source",
          ids: ["move-kurokonwaku-shadow-stalker"],
          sourceText: "this",
        },
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 25 },
            sourceText: "after performing a SUCCESSFUL attack with a roll of 25 or higher",
          },
        ],
        activationCost: {
          timing: "activation" as const,
          resource: "ki",
          operation: "lose",
          amount: { type: "source-move-ki-cost" },
        },
        sourceText:
          "You may activate this after performing a SUCCESSFUL attack with a roll of 25 or higher without taking up your turn. You must pay the cost of this skill to activate it in this way",
      },
      {
        trigger: "passive",
        target: "self",
        type: "prevent-move-use",
        selector: {
          type: "move-selector",
          subject: "target",
          restriction: "restricted",
          categories: ["advanced-attack", "signature"],
          sourceText: "RESTRICTED attacks",
        },
        duration: {
          type: "until-combat-result",
          actor: "opponent",
          result: "stopped",
          conditions: [
            {
              type: "roll-threshold",
              roll: "defense",
              natural: true,
              comparison: "at-least",
              value: { type: "literal", value: 23 },
              sourceText: "a natural defense roll of 23 or higher",
            },
          ],
          sourceText:
            "until your opponent STOPS one of your attacks with a natural defense roll of 23 or higher",
        },
        sourceText:
          "You cannot be the target of RESTRICTED attacks until your opponent STOPS one of your attacks with a natural defense roll of 23 or higher",
      },
      {
        trigger: "passive",
        target: "self",
        type: "modify-cost",
        operation: "add",
        amount: { type: "prior-move-activation-count", move: "source", perActivation: 1 },
        selector: {
          type: "move-selector",
          subject: "source",
          ids: ["move-kurokonwaku-shadow-stalker"],
          sourceText: "this skill",
        },
        sourceText: "Each time you activate this skill, it costs an additional KI",
      },
    ],
  ],
  [
    "move-kurokonwaku-control-mastery",
    [
      {
        trigger: "start-combat",
        target: "opponent",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: 2 },
        selector: {
          type: "move-selector",
          subject: "target",
          categories: ["skill", "advanced-attack", "signature"],
          sourceText: "one of their Skills, Advanced Attacks, or Signature Techniques",
        },
        duration: { type: "combat", sourceText: "For the remainder of combat" },
        sourceText:
          "At the start of each match, select one opponent. You may choose one of their Skills, Advanced Attacks, or Signature Techniques. For the remainder of combat, that move costs +2 KI for them to use or perform",
      },
      {
        trigger: "start-combat",
        target: "self",
        type: "modify-roll",
        roll: "defense",
        modifier: "result",
        amount: { type: "literal", value: 5 },
        selector: {
          type: "move-selector",
          subject: "target",
          categories: ["advanced-attack", "signature"],
          costModification: "prevented",
          sourceText: "that attack cannot have its cost modified",
        },
        duration: { type: "combat", sourceText: "For the remainder of combat" },
        sourceText:
          "For the remainder of combat, that move costs +2 KI for them to use or perform. If that attack cannot have its cost modified, add +5 to your Defense rolls against it",
      },
      {
        trigger: "start-combat",
        target: "opponent",
        type: "apply-status",
        statusId: "cooldown",
        selector: {
          type: "move-selector",
          subject: "target",
          categories: ["advanced-attack", "signature"],
          sourceText: "The same attack",
        },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 1 },
          sourceText: "COOLDOWN 1",
        },
        sourceText: "The same attack has COOLDOWN 1 against you",
      },
    ],
  ],
  [
    "move-kurokonwaku-cancellation-mastery",
    [
      {
        trigger: "on-move-use",
        target: "opponent",
        type: "deactivate",
        affectedType: "skill",
        selectionSpec: { type: "all" },
        selector: {
          type: "move-selector",
          subject: "target",
          category: "skill",
          constant: true,
          sourceText: "an opponent uses or activates a CONSTANT Skill",
        },
        activationCost: {
          timing: "activation" as const,
          resource: "ki",
          operation: "lose",
          amount: { type: "triggering-move-ki-cost", addition: -1 },
          minimum: { type: "literal", value: 1 },
        },
        sourceText:
          "Whenever an opponent uses or activates a CONSTANT Skill, you may lose X-1 KI to a minimum of 1 to DEACTIVATE it",
      },
      {
        trigger: "on-move-use",
        target: "opponent",
        type: "negate",
        selector: {
          type: "move-selector",
          subject: "target",
          category: "skill",
          constant: false,
          sourceText: "your opponent uses a non-CONSTANT Skill",
        },
        activationCost: {
          timing: "activation" as const,
          resource: "ki",
          operation: "lose",
          amount: { type: "triggering-move-ki-cost", addition: -1 },
          minimum: { type: "literal", value: 1 },
        },
        sourceText:
          "Whenever your opponent uses a non-CONSTANT Skill, you may lose X-1 KI, to a minimum of 1, to NEGATE the effect",
      },
      ...(["stun", "critical", "counter"] as const).map((outcome) => ({
        trigger: "on-combat-result" as const,
        target: "opponent" as const,
        type: "negate" as const,
        conditions: [
          {
            type: "combat-outcome" as const,
            actor: "opponent" as const,
            outcome,
            sourceText: "an opponent performs a STUN, CRITICAL, or COUNTER",
          },
        ],
        activationCost: {
          timing: "activation" as const,
          resource: "ki" as const,
          operation: "lose" as const,
          amount: { type: "triggering-move-ki-cost" as const, addition: -1 },
          minimum: { type: "literal" as const, value: 1 },
        },
        sourceText:
          "Whenever an opponent performs a STUN, CRITICAL, or COUNTER you may lose X-1 KI to a minimum of 1 to NEGATE it",
      })),
      {
        trigger: "on-success",
        target: "opponent",
        type: "lock",
        affectedType: "mastery",
        duration: {
          type: "turns",
          turns: { type: "literal", value: 1 },
          sourceText: "until the end of your next turn",
        },
        conditions: [
          {
            type: "move-selector",
            subject: "source",
            styleId: "style-kurokonwaku",
            categories: ["advanced-attack", "signature"],
            sourceText: "a SUCCESSFUL Kurokonwaku attack",
          },
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 22 },
            sourceText: "with an attack roll result of 22 or higher",
          },
        ],
        sourceText:
          "Whenever you perform a SUCCESSFUL Kurokonwaku attack with an attack roll result of 22 or higher, LOCK your opponent's Mastery effect until the end of your next turn",
      },
    ],
  ],
  [
    "move-kurokonwaku-flashback",
    [
      {
        trigger: "action-phase",
        target: "self",
        type: "copy-move-effect",
        sourceMove: {
          type: "last-prior-move",
          actor: "self",
          restriction: "unrestricted",
        },
        effectResult: "successful",
        resolveAs: "source-move",
        damage: { type: "add-percent", value: { type: "literal", value: 10 } },
        cost: { type: "selected-move-base-cost" },
        sourceText:
          "RESTRICTEDx2.Perform the last UNRESTRICTED attack you performed this match, paying the ki cost. That attack does +(10% Power) damage",
      },
    ],
  ],
  [
    "move-kurokonwaku-breaking-the-cycle",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-remaining-uses",
        amount: { type: "literal", value: 1 },
        selector: {
          type: "move-selector",
          subject: "source",
          ids: ["move-kurokonwaku-breaking-the-cycle"],
          sourceText: "this attack",
        },
        conditions: [
          {
            type: "moveset",
            subject: "self",
            excludesIds: ["move-kurokonwaku-concussion-shot", "move-kurokonwaku-neuron-disruptor"],
            sourceText: "If you do not have Concussion Shot or Neuron Disruptor in your moveset",
          },
        ],
        sourceText:
          "If you do not have Concussion Shot or Neuron Disruptor in your moveset, this attack is RESTRICTEDx2 instead",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "suppress",
        selector: {
          type: "move-selector",
          subject: "source",
          restriction: "unrestricted",
          effectRuleTokens: ["successful"],
          sourceText: "one of your UNRESTRICTED attacks with a SUCCESSFUL effect",
        },
        aspects: ["successful-effects"],
        duration: { type: "combat", sourceText: "for the remainder of combat" },
        selectionSpec: { type: "up-to", limit: { type: "literal", value: 1 } },
        activationGroup: "breaking-the-cycle-paired-suppression",
        sourceText:
          "SUCCESSFUL - You may choose one of your UNRESTRICTED attacks with a SUCCESSFUL effect. You may have that attack lose all SUCCESSFUL effects for the remainder of combat",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "suppress",
        selector: {
          type: "move-selector",
          subject: "target",
          restriction: "unrestricted",
          effectRuleTokens: ["successful"],
          sourceText: "one of your opponent's UNRESTRICTED attacks",
        },
        aspects: ["successful-effects"],
        duration: { type: "combat", sourceText: "for the remainder of combat" },
        selectionSpec: { type: "up-to", limit: { type: "literal", value: 1 } },
        activationGroup: "breaking-the-cycle-paired-suppression",
        sourceText:
          "If you do, choose one of your opponent's UNRESTRICTED attacks. That attack loses all SUCCESSFUL effects for the remainder of combat",
      },
    ],
  ],
  [
    "move-kurokonwaku-trickster-mastery",
    [
      {
        trigger: "passive",
        target: "opponent",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: -2 },
        sourceText: "Your opponent's attack and defensive roll results against you gain -2",
      },
      {
        trigger: "passive",
        target: "opponent",
        type: "modify-roll",
        roll: "defense",
        modifier: "result",
        amount: { type: "literal", value: -2 },
        sourceText: "Your opponent's attack and defensive roll results against you gain -2",
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
          sourceText: "a CONSTANT Skill",
        },
        conditions: [
          {
            type: "move-selector",
            subject: "source",
            styleId: "style-kurokonwaku",
            tags: ["PHYSICAL"],
            sourceText: "All of your Kurokonwaku physical attacks",
          },
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 25 },
            sourceText: "If your attack roll result is 25 or higher",
          },
        ],
        sourceText:
          'All of your Kurokonwaku physical attacks gain "SUCCESSFUL - If your attack roll result is 25 or higher, DEACTIVATE a CONSTANT Skill"',
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "prevent-resource-modification",
        resource: "hp",
        operation: "gain",
        scope: { type: "next-turn", subject: "opponent", sourceText: "on their next turn" },
        conditions: [
          {
            type: "move-selector",
            subject: "source",
            styleId: "style-kurokonwaku",
            tags: ["ENERGY"],
            sourceText: "All of your Kurokonwaku energy attacks",
          },
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 25 },
            sourceText: "If your attack roll result is 25 or higher",
          },
        ],
        sourceText:
          'All of your Kurokonwaku energy attacks gain "SUCCESSFUL - If your attack roll result is 25 or higher, your opponent cannot gain HP or KI on their next turn."',
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "prevent-resource-modification",
        resource: "ki",
        operation: "gain",
        scope: { type: "next-turn", subject: "opponent", sourceText: "on their next turn" },
        conditions: [
          {
            type: "move-selector",
            subject: "source",
            styleId: "style-kurokonwaku",
            tags: ["ENERGY"],
            sourceText: "All of your Kurokonwaku energy attacks",
          },
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 25 },
            sourceText: "If your attack roll result is 25 or higher",
          },
        ],
        sourceText:
          'All of your Kurokonwaku energy attacks gain "SUCCESSFUL - If your attack roll result is 25 or higher, your opponent cannot gain HP or KI on their next turn."',
      },
    ],
  ],
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
        amount: {
          type: "resource-from-threshold",
          subject: "opponent",
          resource: "ki",
          threshold: 5,
          sign: 1,
        },
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
        amount: { type: "damage-percent", subject: "current-action", percent: 20 },
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
        amount: {
          type: "resource-from-threshold",
          subject: "opponent",
          resource: "ki",
          threshold: 10,
          sign: -1,
        },
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
        amount: {
          type: "resource-from-threshold",
          subject: "opponent",
          resource: "ki",
          threshold: 10,
          sign: -1,
        },
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
        amount: { type: "successful-hit-count", perHit: 1 },
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
        optional: true,
        roll: "defense",
        rerollScope: "single-result",
        resultModifier: { type: "literal", value: 5 },
        useLimit: { scope: "combat", count: 1, sourceText: "RESTRICTEDx1" },
        sourceText:
          "RESTRICTEDx1. Use after you roll your defensive roll. You may re-roll your defensive roll",
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
        amount: { type: "stat-percent", subject: "self", stat: "power", percent: 10 },
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
          timing: "activation" as const,
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
        trigger: "passive",
        target: "self",
        type: "modify-remaining-uses",
        amount: { type: "literal", value: 1 },
        selector: {
          type: "move-selector",
          subject: "source",
          ids: ["move-kurokonwaku-neuron-disruptor"],
          sourceText: "this attack",
        },
        conditions: [
          {
            type: "moveset",
            subject: "self",
            excludesIds: ["move-kurokonwaku-concussion-shot"],
            sourceText: "If Concussion Shot is not in your moveset",
          },
        ],
        sourceText:
          "If Concussion Shot is not in your moveset, this attack is RESTRICTEDx2 instead",
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
        conflictPolicy: { type: "allow", sourceText: "canonical conflict rule" },
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
          moveSelector: {
            type: "move-selector",
            subject: "source",
            attackRoll: { dice: 1 },
            sourceText: "a single dice attack",
          },
          sourceText:
            "until they roll an attack roll result of 23 or higher on a single dice attack",
        },
        conflictPolicy: { type: "prevent-duplicate", sourceText: "canonical conflict rule" },
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
        blockedCategories: ["basic-attack", "advanced-attack", "signature"],
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
        amount: { type: "stat-percent", subject: "self", stat: "power", percent: 55 },
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
        amount: { type: "stat-percent", subject: "self", stat: "power", percent: 15 },
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
        amount: { type: "current-resource", subject: "self", resource: "ki" },
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
  [
    "move-kurokonwaku-mimicry-mastery",
    [
      {
        trigger: "before-defense-roll",
        target: "self",
        type: "suppress",
        selector: {
          type: "move-selector",
          subject: "source",
          attackRoll: { dice: 1 },
          sourceText: "a single dice attack",
        },
        aspects: ["successful-effects"],
        sourceText:
          "When you perform a single dice attack, you may have it lose all SUCCESSFUL effects attached to it",
      },
      {
        trigger: "before-defense-roll",
        target: "self",
        type: "copy-move-effects",
        sourceMove: {
          actor: "opponent",
          categories: ["advanced-attack", "signature"],
          restriction: "unrestricted",
          usedDuring: "combat",
        },
        sourceEffectResult: "successful",
        resultingEffectResult: "successful",
        conditions: [
          {
            type: "move-selector",
            subject: "source",
            attackRoll: { dice: 1 },
            sourceText: "When you perform a single dice attack",
          },
        ],
        activationGroup: "mimicry-mastery-single-die-effect-exchange",
        sourceText:
          'When you perform a single dice attack, you may have it lose all SUCCESSFUL effects attached to it to gain the same SUCCESSFUL effects of an UNRESTRICTED attack used against you this Match. All of your opponent\'s effects are now "SUCCESSFUL" effects',
      },
      {
        trigger: "action-phase",
        target: "self",
        type: "copy-move-effect",
        sourceMove: {
          type: "selected-move",
          actor: "opponent",
          category: "advanced-attack",
        },
        effectResult: "successful",
        resolveAs: "source-move",
        cost: { type: "selected-move-base-cost" },
        ignoreRequirements: true,
        useLimit: { scope: "combat", count: 1, sourceText: "Once per combat" },
        sourceText:
          "Once per combat, you may perform an Advanced Attack known by your opponent. You must pay the cost but do not have to meet the Requirements",
      },
    ],
  ],
  [
    "move-kurokonwaku-puppet-master",
    [
      {
        trigger: "on-stopped",
        target: "opponent",
        type: "force-action",
        allowedCategories: ["advanced-attack"],
        allowPass: false,
        selector: {
          type: "move-selector",
          subject: "target",
          category: "advanced-attack",
          sourceText: "choose which of their Advanced Attacks they perform",
        },
        fallback: "basic-attack",
        scope: { type: "next-turn", subject: "opponent", sourceText: "on their next turn" },
        sourceText:
          "Whenever you STOP one of your opponent's attacks, you may then choose which of their Advanced Attacks they perform on their next turn. They must be able to perform that attack and suffer a -2 penalty to the result(s). If they are unable to perform any Advanced Attack, you may choose a Basic Attack",
      },
      {
        trigger: "on-stopped",
        target: "opponent",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: -2 },
        selector: {
          type: "move-selector",
          subject: "target",
          category: "advanced-attack",
          sourceText: "that attack",
        },
        scope: { type: "next-turn", subject: "opponent", sourceText: "on their next turn" },
        sourceText:
          "They must be able to perform that attack and suffer a -2 penalty to the result(s)",
      },
    ],
  ],
  [
    "move-kurokonwaku-ki-trap",
    [
      {
        trigger: "action-phase",
        target: "self",
        type: "roll-and-store",
        dice: 1,
        sides: 30,
        storageKey: "ki-trap-roll",
        sourceText: "Roll 1d30",
      },
      {
        trigger: "on-roll-result",
        target: "opponent",
        type: "modify-resource",
        resource: "hp",
        operation: "lose",
        amount: { type: "literal", value: 60 },
        prevention: "prohibited",
        conditions: [
          {
            type: "stored-roll-match",
            roll: "attack",
            natural: true,
            storageKey: "ki-trap-roll",
            sourceText: "The next time your opponent rolls that number on a natural roll",
          },
        ],
        useLimit: { scope: "combat", count: 1, sourceText: "The next time" },
        sourceText:
          "The next time your opponent rolls that number on a natural roll, they lose (60% Your Power) HP. This damage may not be prevented",
      },
      ...(["attack", "defense"] as const).map((roll) => ({
        trigger: "on-roll-result" as const,
        target: "self" as const,
        type: "reroll" as const,
        roll,
        conditions: [
          {
            type: "stored-roll-match" as const,
            roll,
            natural: true,
            storageKey: "ki-trap-roll",
            sourceText: "The next time you roll that number on an attack or defense roll",
          },
        ],
        useLimit: { scope: "combat" as const, count: 1, sourceText: "The next time" },
        exclusiveActivationGroup: "ki-trap-self-reroll",
        sourceText:
          "The next time you roll that number on an attack or defense roll, you may choose to re-roll",
      })),
    ],
  ],
  [
    "move-kurokonwaku-spiked-ball",
    [
      {
        trigger: "passive",
        target: "self",
        type: "prevent-move-modification",
        actor: "any",
        aspects: ["cost"],
        operations: ["reduce"],
        selector: {
          type: "move-selector",
          subject: "source",
          ids: ["move-kurokonwaku-spiked-ball"],
          sourceText: "The cost of this attack",
        },
        sourceText: "The cost of this attack cannot be reduced",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "modify-remaining-uses",
        amount: { type: "literal", value: 1 },
        selector: {
          type: "move-selector",
          subject: "source",
          restriction: "restricted",
          categoryExcludes: ["signature"],
          sourceText: "Choose one of your RESTRICTED moves that is not a Signature Technique",
        },
        activationGroup: "spiked-ball-selected-move",
        sourceText:
          "SUCCESSFUL - Choose one of your RESTRICTED moves that is not a Signature Technique. That move gains RESTRICTED+1",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "replace-move-effect",
        selector: {
          type: "move-selector",
          subject: "source",
          restriction: "restricted",
          categoryExcludes: ["signature"],
          sourceText: "this move",
        },
        remove: "source-effect",
        replacement: {
          trigger: "on-resource-drain",
          target: "self",
          type: "modify-resource",
          resource: "ki",
          operation: "gain",
          amount: { type: "triggering-resource-change", resource: "ki", operation: "drain" },
          sourceText: "SUCCESSFUL - The next time you DRAIN Ki, gain the same amount of Ki",
        },
        activationGroup: "spiked-ball-selected-move",
        sourceText:
          "After this move is SUCCESSFUL, it loses this effect and instead gains 'SUCCESSFUL - The next time you DRAIN Ki, gain the same amount of Ki.'",
      },
    ],
  ],
  [
    "move-kurokonwaku-vampiric-lust",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "create-floating-effect",
        floatingEffectId: "vampiric-lust-ki-siphon",
        effects: [
          {
            trigger: "on-resource-gain",
            target: "opponent",
            type: "modify-resource",
            resource: "ki",
            operation: "drain",
            amount: { type: "literal", value: 1 },
            exclusions: [
              {
                type: "power-up-while-target-was-losing-ki-to-floating-effect-on-creation",
                sourceText:
                  "If your opponent is losing KI due to a floating effect when you use this move, they do not DRAIN 1 KI when they Power Up from this move's effect",
              },
            ],
            sourceText: "Whenever your opponent gains KI, DRAIN 1 KI",
          },
          {
            trigger: "on-resource-gain",
            target: "self",
            type: "modify-resource",
            resource: "ki",
            operation: "gain",
            amount: { type: "literal", value: 1 },
            sourceText: "and you gain 1 KI",
          },
        ],
        termination: [
          {
            trigger: "on-stopped",
            actor: "self",
            selector: {
              type: "move-selector",
              subject: "source",
              categories: ["advanced-attack", "signature"],
              sourceText: "one of your attacks",
            },
            sourceText: "This effect ends when one of your attacks is STOPPED",
          },
          {
            trigger: "on-power-up",
            actor: "self",
            sourceText: "or until you Power Up",
          },
        ],
        sourceText:
          "SUCCESSFUL - Whenever your opponent gains KI, DRAIN 1 KI and you gain 1 KI. This effect ends when one of your attacks is STOPPED or until you Power Up. If your opponent is losing KI due to a floating effect when you use this move, they do not DRAIN 1 KI when they Power Up from this move's effect",
      },
    ],
  ],
  [
    "move-kurokonwaku-sweet-dreams",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-cost",
        operation: "set",
        amount: { type: "source-move-calculated-ki-cost" },
        minimum: { type: "literal", value: 3 },
        selector: {
          type: "move-selector",
          subject: "source",
          ids: ["move-kurokonwaku-sweet-dreams"],
          sourceText: "The cost of this attack cannot be reduced below 3 KI",
        },
        sourceText: "The cost of this attack cannot be reduced below 3 KI",
      },
      ...(
        [
          {
            affectedType: "power-up",
            selector: undefined,
            sourceText: SWEET_DREAMS_LOCK_SOURCE,
          },
          {
            affectedType: "attack",
            selector: undefined,
            sourceText: SWEET_DREAMS_LOCK_SOURCE,
          },
          {
            affectedType: "skill",
            selector: {
              type: "move-selector" as const,
              subject: "target" as const,
              category: "skill" as const,
              sourceText: "Your opponent cannot activate Skills",
            },
            sourceText: SWEET_DREAMS_LOCK_SOURCE,
          },
          { affectedType: "block", selector: undefined, sourceText: SWEET_DREAMS_LOCK_SOURCE },
        ] as const
      ).map(({ affectedType, selector, sourceText }) => ({
        trigger: "on-success" as const,
        target: "opponent" as const,
        type: "lock" as const,
        affectedType,
        ...(selector === undefined ? {} : { selector }),
        duration: {
          type: "until-turn-start-roll-threshold" as const,
          subject: "opponent" as const,
          dice: 1,
          sides: 30,
          comparison: "at-least" as const,
          value: { type: "literal" as const, value: 20 },
          ignoreFirstCheck: true,
          sourceText: SWEET_DREAMS_LOCK_SOURCE,
        },
        sourceText,
      })),
    ],
  ],
]);

export const KUROKONWAKU_MOVES = createStyleMoves(KUROKONWAKU_STYLE).map((move) => ({
  ...move,
  ...(structuredEffectsByMoveId.has(move.id)
    ? { effects: structuredEffectsByMoveId.get(move.id) }
    : {}),
}));
