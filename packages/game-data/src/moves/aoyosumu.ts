import { MOVE_SOURCE_DEFINITIONS } from "../move-source-definitions.js";
import { ATTACK_TAG, MOVE_CATEGORY } from "../shared/constants.js";
import type { EffectDefinition } from "../shared/effects.js";
import type { MoveDefinition, MoveSourceDefinition } from "../shared/types.js";
import { AOYOSUMU_STYLE } from "../styles/aoyosumu.js";

const categoryByMoveId = new Map<string, MoveDefinition["category"]>([
  ...AOYOSUMU_STYLE.masteryMoveIds.map((id) => [id, MOVE_CATEGORY.MASTERY] as const),
  ...AOYOSUMU_STYLE.skillMoveIds.map((id) => [id, MOVE_CATEGORY.SKILL] as const),
  ...AOYOSUMU_STYLE.advancedAttackMoveIds.map((id) => [id, MOVE_CATEGORY.ADVANCED_ATTACK] as const),
  ...AOYOSUMU_STYLE.signatureMoveIds.map((id) => [id, MOVE_CATEGORY.SIGNATURE] as const),
  ...AOYOSUMU_STYLE.blockMoveIds.map((id) => [id, MOVE_CATEGORY.BLOCK] as const),
]);

const attackTagBySourceTag = {
  PHYSICAL: ATTACK_TAG.PHYSICAL,
  ENERGY: ATTACK_TAG.ENERGY,
  PUNCH: ATTACK_TAG.PUNCH,
  KICK: ATTACK_TAG.KICK,
  BEAM: ATTACK_TAG.BEAM,
  BLAST: ATTACK_TAG.BLAST,
  VOLLEY: ATTACK_TAG.VOLLEY,
  WEAPON: ATTACK_TAG.WEAPON,
  HOLD: ATTACK_TAG.HOLD,
  THROW: ATTACK_TAG.THROW,
} as const;

const structuredEffectsByMoveId = new Map<string, readonly EffectDefinition[]>([
  ["move-aoyosumu-defiant-stance", []],
  [
    "move-aoyosumu-calming-mastery",
    [
      {
        trigger: "on-stopped",
        target: "opponent",
        type: "lock",
        affectedType: "attack",
        conditions: [
          {
            type: "combat-result",
            actor: "opponent",
            result: "stopped",
            sourceText: "When you STOP an opponent's Advanced Attack",
          },
          {
            type: "move-selector",
            subject: "target",
            category: "advanced-attack",
            sourceText: "Advanced Attack",
          },
        ],
        duration: { type: "turns", turns: { type: "literal", value: 1 }, sourceText: "next turn" },
        sourceText:
          "When you STOP an opponent's Advanced Attack without using a Block, LOCK that Advanced Attack for your opponent's next turn.",
      },
      {
        trigger: "on-power-up",
        target: "self",
        type: "modify-roll",
        roll: "defense",
        modifier: "result",
        amount: { type: "literal", value: 4 },
        scope: { type: "next-roll", roll: "defense", sourceText: "your next defensive roll" },
        stacking: "prevent",
        sourceText: "When you Power Up, your next defensive roll gains +4 to the results.",
      },
    ],
  ],
  [
    "move-aoyosumu-the-untroubled-mind",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "negate",
        conditions: [
          {
            type: "combat-result",
            actor: "opponent",
            result: "successful",
            sourceText: "opponent uses a SUCCESSFUL effect",
          },
          {
            type: "move-selector",
            subject: "target",
            restriction: "unrestricted",
            sourceText: "UNRESTRICTED attack",
          },
        ],
        sourceText:
          "Activate when your opponent uses a SUCCESSFUL effect on an UNRESTRICTED attack. The effect is NEGATED.",
      },
    ],
  ],
  [
    "move-aoyosumu-reversal-of-fortune",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "grant-counter-action",
        stopsTriggeringAttack: false,
        action: "repeat-triggering-attack",
        ignoreRequirements: true,
        costModifier: {
          operation: "add",
          amount: { type: "literal", value: -1 },
          minimum: { type: "literal", value: 0 },
        },
        conditions: [
          {
            type: "action-sequence",
            actor: "opponent",
            result: "successful",
            count: 2,
            withoutResultBy: { actor: "self", result: "stopped" },
            sourceText:
              "Activate immediately after your opponent performs two SUCCESSFUL attacks against you without you stopping any of their attacks in between",
          },
        ],
        useLimit: { scope: "combat", count: 2, sourceText: "RESTRICTEDx2" },
        sourceText:
          "Activate immediately after your opponent performs two SUCCESSFUL attacks against you without you stopping any of their attacks in between. COUNTER. Their attack is not STOPPED by this effect. Your COUNTER turn is spent performing the attack they just used against you; you do not have to meet its Requirements. You must pay the cost of that attack -1, to a minimum of 0 KI.",
      },
    ],
  ],
  [
    "move-aoyosumu-ceasefire-mastery",
    [
      {
        trigger: "start-combat",
        target: "self",
        type: "modify-remaining-uses",
        amount: { type: "literal", value: 1 },
        selector: {
          type: "move-selector",
          subject: "source",
          category: "block",
          restriction: "restricted",
          sourceText: "select one of your Aoyosumu Blocks; that Block gains RESTRICTED+1",
        },
        sourceText:
          "At the start of combat, select one of your Aoyosumu Blocks; that Block gains RESTRICTED+1.",
      },
    ],
  ],
  [
    "move-aoyosumu-technique-mastery",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-slot-capacity",
        slot: "skill",
        amount: { type: "literal", value: 1 },
        sourceText: "You gain +1 Skill Slots.",
      },
      {
        trigger: "passive",
        target: "self",
        type: "grant-extra-action",
        phase: "action-phase",
        moveCategory: "skill",
        constant: false,
        maximumActions: { type: "literal", value: 2 },
        sourceText: "You can use up to 2 non-CONSTANT Skills per turn, including the same Skill.",
      },
    ],
  ],
  [
    "move-aoyosumu-inner-peace",
    [
      {
        trigger: "on-stopped",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: 1 },
        sourceText: "Whenever you STOP a single dice attack, gain 1 KI.",
      },
    ],
  ],
  [
    "move-aoyosumu-calming-the-battlefield",
    [
      {
        trigger: "action-phase",
        target: "opponent",
        type: "lock",
        affectedType: "attack",
        duration: {
          type: "until-roll-threshold",
          roll: "attack",
          comparison: "at-least",
          value: { type: "literal", value: 20 },
          sourceText: "until your opponent rolls a 20 or higher on a single dice attack",
        },
        conditions: [
          {
            type: "move-selector",
            subject: "target",
            category: "advanced-attack",
            sourceText: "LOCK Advanced Attacks",
          },
        ],
        sourceText:
          "LOCK Advanced Attacks until your opponent rolls a 20 or higher on a single dice attack.",
      },
    ],
  ],
  [
    "move-aoyosumu-opportunist",
    [
      {
        trigger: "action-phase",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "literal", value: 5 },
        scope: { type: "next-action", sourceText: "Your next attack" },
        sourceText: "Your next attack does +(5% Power) Damage.",
      },
      {
        trigger: "action-phase",
        target: "self",
        type: "modify-roll",
        roll: "defense",
        modifier: "result",
        amount: { type: "literal", value: 5 },
        scope: { type: "next-roll", roll: "defense", sourceText: "Your next defensive roll" },
        sourceText: "Your next defensive roll gains +5 to the result.",
      },
      {
        trigger: "action-phase",
        target: "self",
        type: "modify-roll",
        roll: "defense",
        modifier: "result",
        amount: { type: "combat-result-count", actor: "self", result: "counter", perResult: 1 },
        scope: { type: "next-roll", roll: "defense", sourceText: "Your next defensive roll" },
        cap: {
          type: "allow-exceed",
          sourceText: "You may exceed the dice results cap with this effect.",
        },
        sourceText:
          "Your next defensive roll gains +1 to the result for each time you have COUNTERED this match. You may exceed the dice results cap with this effect.",
      },
      {
        trigger: "action-phase",
        target: "opponent",
        type: "force-action",
        allowedCategories: ["advanced-attack", "signature"],
        allowPass: true,
        scope: { type: "next-action", sourceText: "On your opponent's next turn" },
        conditions: [
          {
            type: "resource-threshold",
            subject: "opponent",
            resource: "ki",
            basis: "current",
            comparison: "at-least",
            value: { type: "literal", value: 5 },
            sourceText: "opponent has 5 or more KI",
          },
        ],
        sourceText:
          "On your opponent's next turn, if your opponent has 5 or more KI, your opponent must perform an Advanced Attack, Signature Technique, or pass.",
      },
    ],
  ],
  [
    "move-aoyosumu-weeping-willow",
    [
      {
        trigger: "before-attack-roll",
        target: "self",
        type: "modify-damage",
        operation: "set",
        percent: { type: "prior-roll-result", roll: "defense", multiplier: 2 },
        cap: {
          type: "maximum",
          value: { type: "literal", value: 50 },
          sourceText: "to a maximum of 50%",
        },
        scope: { type: "current-action", sourceText: "Deal (X% Power) damage" },
        sourceText:
          "Deal (X% Power) damage. X = The result of your last defensive roll x2 to a maximum of 50%.",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "lock",
        affectedType: "attack",
        conditions: [
          { type: "combat-result", actor: "self", result: "successful", sourceText: "SUCCESSFUL" },
        ],
        duration: { type: "turns", turns: { type: "literal", value: 1 }, sourceText: "next turn" },
        sourceText:
          "SUCCESSFUL - LOCK your opponent's attacks with a base damage of 40% or higher for their next turn.",
      },
    ],
  ],
  [
    "move-aoyosumu-breakout",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "remove-move-from-combat",
        move: "source",
        conditions: [
          {
            type: "combat-result",
            actor: "opponent",
            result: "successful",
            sourceText: "opponent performs a SUCCESSFUL Advanced Attack",
          },
          {
            type: "move-selector",
            subject: "target",
            category: "advanced-attack",
            sourceText: "Advanced Attack",
          },
        ],
        sourceText:
          "You may forget this attack after your opponent performs a SUCCESSFUL Advanced Attack to SUPPRESS that attack.",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "suppress",
        conditions: [
          {
            type: "combat-result",
            actor: "opponent",
            result: "successful",
            sourceText: "opponent performs a SUCCESSFUL Advanced Attack",
          },
          {
            type: "move-selector",
            subject: "target",
            category: "advanced-attack",
            sourceText: "Advanced Attack",
          },
        ],
        sourceText:
          "You may forget this attack after your opponent performs a SUCCESSFUL Advanced Attack to SUPPRESS that attack.",
      },
    ],
  ],
  [
    "move-aoyosumu-wind-shove",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "sides",
        amount: { type: "literal", value: 2 },
        scope: { type: "next-action", sourceText: "Your next energy attack" },
        conditions: [
          { type: "combat-result", actor: "self", result: "successful", sourceText: "SUCCESSFUL" },
          {
            type: "move-selector",
            subject: "source",
            tags: ["energy"],
            sourceText: "energy attack",
          },
        ],
        sourceText: "SUCCESSFUL - Your next energy attack gains +2 dice sides.",
      },
    ],
  ],
  [
    "move-aoyosumu-floating-drop",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "set-roll-selection",
        roll: "attack",
        diceCount: { type: "literal", value: 2 },
        selection: "lowest",
        scope: { type: "next-roll", roll: "attack", sourceText: "next attack roll" },
        conditions: [
          { type: "combat-result", actor: "self", result: "successful", sourceText: "SUCCESSFUL" },
          {
            type: "prior-action",
            actor: "opponent",
            result: "stopped",
            sourceText: "If you stopped your opponents last attack",
          },
        ],
        sourceText:
          "SUCCESSFUL - If you stopped your opponents last attack, your opponent gains DISADVANTAGE on their next attack roll.",
      },
    ],
  ],
  [
    "move-aoyosumu-heart-punch",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "prevent-status",
        statusId: "stun",
        duration: {
          type: "turns",
          turns: { type: "literal", value: 6 },
          sourceText: "next 6 turns",
        },
        conditions: [
          { type: "combat-result", actor: "self", result: "successful", sourceText: "SUCCESSFUL" },
        ],
        sourceText: "SUCCESSFUL - Choose one: Your opponent cannot STUN you for the next 6 turns",
      },
    ],
  ],
  [
    "move-aoyosumu-breathtaker",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "lock",
        affectedType: "attack",
        conditions: [
          { type: "combat-result", actor: "self", result: "successful", sourceText: "SUCCESSFUL" },
        ],
        duration: { type: "turns", turns: { type: "literal", value: 1 }, sourceText: "next turn" },
        sourceText:
          "SUCCESSFUL - LOCK the last attack your opponent performed against you for their next turn.",
      },
    ],
  ],
  [
    "move-aoyosumu-slow-charge",
    [
      {
        trigger: "before-attack-roll",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "completed-combat-turn-count", perTurn: 5 },
        cap: {
          type: "maximum",
          value: { type: "literal", value: 60 },
          sourceText: "to a maximum of +(60% Power) Damage",
        },
        scope: { type: "current-action", sourceText: "This attack" },
        sourceText:
          "This attack does +(5% Power) Damage and gains +1 to the result for every turn that has passed in the match to a maximum of +(60% Power) Damage and +5 to the result.",
      },
      {
        trigger: "before-attack-roll",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "completed-combat-turn-count", perTurn: 1 },
        cap: {
          type: "maximum",
          value: { type: "literal", value: 5 },
          sourceText: "and +5 to the result",
        },
        scope: { type: "current-action", sourceText: "This attack" },
        sourceText:
          "This attack does +(5% Power) Damage and gains +1 to the result for every turn that has passed in the match to a maximum of +(60% Power) Damage and +5 to the result.",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "end-floating-effect",
        selector: "any",
        conditions: [
          { type: "combat-result", actor: "self", result: "successful", sourceText: "SUCCESSFUL" },
        ],
        sourceText: "SUCCESSFUL - You may end a floating effect.",
      },
    ],
  ],
  [
    "move-aoyosumu-tears-of-the-mystic",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "successful-hit-count", perHit: 2 },
        scope: { type: "next-action", sourceText: "Your next Aoyosumu Advanced Attack roll" },
        conditions: [
          { type: "combat-result", actor: "self", result: "successful", sourceText: "SUCCESSFUL" },
          {
            type: "move-selector",
            subject: "source",
            styleId: "style-aoyosumu",
            category: "advanced-attack",
            sourceText: "Aoyosumu Advanced Attack",
          },
        ],
        sourceText:
          "SUCCESSFUL - Your next Aoyosumu Advanced Attack roll gains +2 to the result per hit.",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "modify-roll",
        roll: "defense",
        modifier: "result",
        amount: { type: "successful-hit-count", perHit: 2 },
        scope: { type: "next-roll", roll: "defense", sourceText: "Your next defensive roll" },
        conditions: [
          { type: "combat-result", actor: "self", result: "successful", sourceText: "SUCCESSFUL" },
        ],
        sourceText:
          "SUCCESSFUL - Your next Aoyosumu Advanced Attack roll gains +2 to the result per hit. Your next defensive roll gains +2 to the result per hit.",
      },
    ],
  ],
  [
    "move-aoyosumu-push",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "lock",
        affectedType: "skill",
        conditions: [
          { type: "combat-result", actor: "self", result: "successful", sourceText: "SUCCESSFUL" },
        ],
        duration: { type: "turns", turns: { type: "literal", value: 1 }, sourceText: "next turn" },
        sourceText:
          "SUCCESSFUL - LOCK your opponent's Skills for their next turn, and they cannot benefit from any CONSTANT skills until the end of your next turn.",
      },
    ],
  ],
  [
    "move-aoyosumu-karmic-possession",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "copy-move-effect",
        sourceMove: {
          type: "selected-prior-move",
          actor: "opponent",
          category: "advanced-attack",
          result: "successful",
        },
        effectResult: "successful",
        resolveAs: "source-move",
        damage: { type: "total-damage", sourceMove: "selected-prior-move" },
        sourceText:
          "SUCCESSFUL - Apply the SUCCESSFUL effect of the Advanced Attack chosen to determine this attack's damage.",
      },
    ],
  ],
  [
    "move-aoyosumu-frost-wind-technique",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "lock",
        affectedType: "attack",
        conditions: [
          { type: "combat-result", actor: "self", result: "successful", sourceText: "SUCCESSFUL" },
          {
            type: "move-selector",
            subject: "target",
            category: "signature",
            sourceText: "one of your opponent's Signature Techniques",
          },
        ],
        duration: {
          type: "until-roll-threshold",
          roll: "attack",
          comparison: "at-least",
          value: { type: "literal", value: 25 },
          sourceText:
            "until they perform a SUCCESSFUL attack roll result of 25 or higher with a single dice attack",
        },
        stacking: "prevent",
        sourceText:
          "SUCCESSFUL - You may choose one of your opponent's Signature Techniques. LOCK that attack until they perform a SUCCESSFUL attack roll result of 25 or higher with a single dice attack. You cannot use this effect against more than one Signature Technique at a time.",
      },
    ],
  ],
  [
    "move-aoyosumu-creeping-death",
    [
      {
        trigger: "before-attack-roll",
        target: "opponent",
        type: "set-resolution-threshold",
        outcome: "stop",
        roll: "defense",
        comparison: "at-least",
        value: { type: "prior-roll-result", roll: "defense" },
        scope: { type: "current-action", sourceText: "STOP this attack" },
        sourceText:
          "Your opponent's defensive roll result must be equal to or greater than your last defensive roll result to STOP this attack.",
      },
    ],
  ],
  [
    "move-aoyosumu-bomb-tag",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "schedule-effect",
        timing: { type: "turn-start", subject: "opponent", turnsAfter: 2 },
        effect: {
          type: "modify-resource",
          resource: "hp",
          operation: "lose",
          amount: { type: "stat-percent", subject: "self", stat: "power", percent: 35 },
        },
        cancellation: {
          actor: "opponent",
          result: "successful",
          moveSelector: {
            type: "move-selector",
            subject: "source",
            tags: ["physical"],
            sourceText: "performing a SUCCESSFUL physical attack",
          },
          target: "source",
        },
        stacking: "prevent",
        sourceText:
          "SUCCESSFUL - Your opponent takes (35% Power) Damage at the beginning of their second turn following this attack. Your opponent can NEGATE this damage by performing a SUCCESSFUL physical attack. If your opponent performs a SUCCESSFUL Physical attack against someone besides you during this time, they take the (35% Power) Damage. The duration of this effect cannot stack; it must expire before you can renew it.",
      },
    ],
  ],
  [
    "move-aoyosumu-dashing-fist-drive",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "set-roll-definition",
        roll: "attack",
        dice: 1,
        sides: 35,
        scope: { type: "next-action", sourceText: "your next single-die attack" },
        conditions: [
          {
            type: "roll-comparison",
            left: "attack",
            comparison: "at-least",
            right: "defense",
            difference: { type: "literal", value: 3 },
            sourceText:
              "If your attack roll result is +3 or more your opponent's defensive roll result",
          },
          {
            type: "move-selector",
            subject: "source",
            attackRoll: { dice: 1 },
            sourceText: "single-die attack",
          },
        ],
        sourceText:
          "If your attack roll result is +3 or more your opponent's defensive roll result, your next single-die attack changes its base roll to 1d35.",
      },
    ],
  ],
  [
    "move-aoyosumu-one-arm-shoulder-throw",
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
          sourceText: "physical attack",
        },
        scope: {
          type: "next-turn",
          subject: "opponent",
          sourceText: "on their next turn",
        },
        conditions: [
          { type: "combat-result", actor: "self", result: "successful", sourceText: "SUCCESSFUL" },
        ],
        sourceText:
          "SUCCESSFUL - If your opponent performs a physical attack on their next turn, it costs +1 KI.",
      },
    ],
  ],
  [
    "move-aoyosumu-close-shave",
    [
      {
        trigger: "after-defense-roll",
        target: "opponent",
        type: "set-combat-result",
        result: "stopped",
        resultScope: "matching-die",
        conditions: [
          {
            type: "roll-comparison",
            left: "defense",
            comparison: "equal",
            right: "attack",
            difference: { type: "literal", value: 0 },
            sourceText:
              "Whenever your defensive roll result is equal to your opponent's attack roll result",
          },
        ],
        sourceText:
          "Whenever your defensive roll result is equal to your opponent's attack roll result, the attack is STOPPED.",
      },
    ],
  ],
  [
    "move-aoyosumu-heavenly-execution",
    [
      {
        trigger: "before-attack-roll",
        target: "opponent",
        type: "set-resolution-threshold",
        outcome: "stop",
        roll: "defense",
        comparison: "at-least",
        value: { type: "prior-roll-result", roll: "attack", addition: 4 },
        resultScope: "matching-die",
        scope: { type: "current-action", sourceText: "STOP this attack" },
        sourceText:
          "Your opponent's defensive roll result must be at least +4 your attack roll result in order to STOP this attack.",
      },
    ],
  ],
  [
    "move-aoyosumu-breathtaker",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: -10 },
        scope: { type: "next-action", sourceText: "your opponent's next attack roll result" },
        conditions: [
          { type: "combat-result", actor: "self", result: "successful", sourceText: "SUCCESSFUL" },
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 25 },
            sourceText: "If your attack roll result is 25 or higher",
          },
        ],
        sourceText:
          "SUCCESSFUL - LOCK the last attack your opponent performed against you for their next turn. If your attack roll result is 25 or higher, your opponent's next attack roll result gains -10 to the result.",
      },
    ],
  ],
  [
    "move-aoyosumu-return-fire",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-roll",
        roll: "attack",
        modifier: "sides",
        amount: { type: "literal", value: -2 },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 4 },
          sourceText: "next 4 turns",
        },
        conditions: [
          { type: "combat-result", actor: "self", result: "successful", sourceText: "SUCCESSFUL" },
        ],
        sourceText: "SUCCESSFUL - Your opponent's dice gain -2 sides for the next 4 turns.",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-roll",
        roll: "defense",
        modifier: "sides",
        amount: { type: "literal", value: -2 },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 4 },
          sourceText: "next 4 turns",
        },
        conditions: [
          { type: "combat-result", actor: "self", result: "successful", sourceText: "SUCCESSFUL" },
        ],
        sourceText: "SUCCESSFUL - Your opponent's dice gain -2 sides for the next 4 turns.",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "prevent-combat-result",
        result: "critical",
        duration: {
          type: "turns",
          turns: { type: "literal", value: 4 },
          sourceText: "next 4 turns",
        },
        conditions: [
          { type: "combat-result", actor: "self", result: "successful", sourceText: "SUCCESSFUL" },
        ],
        sourceText:
          "SUCCESSFUL - Your opponent's dice gain -2 sides for the next 4 turns. Your opponent cannot CRITICAL for the next 4 turns.",
      },
    ],
  ],
  [
    "move-aoyosumu-braced-energy-beam",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "reroll",
        roll: "attack",
        rerollScope: "entire-attack",
        scope: { type: "next-action", sourceText: "your opponent's next attack roll" },
        useLimit: { scope: "turn", count: 1, sourceText: "more than once per turn" },
        conditions: [
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 20 },
            sourceText: "attack roll result is 20 or higher",
          },
        ],
        sourceText:
          "SUCCESSFUL - If your opponent's next attack roll result is 20 or higher, they must re-roll their attack roll. They do not have to re-roll their attack roll more than once per turn.",
      },
    ],
  ],
  [
    "move-aoyosumu-crescent-kick",
    [
      {
        trigger: "before-attack-roll",
        target: "self",
        type: "modify-critical-threshold",
        threshold: { type: "literal", value: 30 },
        basis: "final-result",
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
          "If you STOPPED your opponent's last attack, this attack can CRITICAL with a roll of 30 or higher.",
      },
    ],
  ],
  [
    "move-aoyosumu-silence-gun",
    [
      {
        trigger: "on-stopped",
        target: "opponent",
        type: "lock",
        affectedType: "skill",
        conditions: [
          {
            type: "prior-action",
            actor: "opponent",
            result: "stopped",
            sourceText: "If you STOPPED your opponent's last attack",
          },
        ],
        duration: {
          type: "turns",
          turns: { type: "literal", value: 2 },
          sourceText: "next 2 turns",
        },
        sourceText:
          "If you STOPPED your opponent's last attack, LOCK your opponent's Skills for their next 2 turns.",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "deactivate",
        affectedType: "skill",
        conditions: [
          { type: "combat-result", actor: "self", result: "successful", sourceText: "SUCCESSFUL" },
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 25 },
            sourceText: "attack roll result is 25 or higher",
          },
        ],
        sourceText:
          "SUCCESSFUL - If your attack roll result is 25 or higher, DEACTIVATE one of your opponent's Skills with a CONSTANT effect.",
      },
    ],
  ],
  [
    "move-aoyosumu-stepping-on-toes",
    [
      {
        trigger: "on-stopped",
        target: "opponent",
        type: "lock",
        affectedType: "attack",
        conditions: [
          {
            type: "move-selector",
            subject: "target",
            tags: ["kick"],
            sourceText: "Kick-type attack",
          },
        ],
        duration: {
          type: "turns",
          turns: { type: "literal", value: 4 },
          sourceText: "next 4 turns",
        },
        sourceText:
          "If this is used against a Kick-type attack, LOCK your opponent's Kick-type attacks for their next 4 turns.",
      },
    ],
  ],
  [
    "move-aoyosumu-screening",
    [
      {
        trigger: "on-stopped",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: 2 },
        sourceText: "If you STOP your opponent's next attack, gain 2 KI.",
      },
    ],
  ],
  [
    "move-aoyosumu-bullwhip",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "modify-roll",
        roll: "defense",
        modifier: "result",
        amount: { type: "literal", value: 2 },
        scope: {
          type: "next-rolls",
          roll: "defense",
          count: { type: "literal", value: 2 },
          sourceText: "Your next 2 defensive rolls",
        },
        sourceText: "SUCCESSFUL - Your next 2 defensive rolls gain +2 to their result",
      },
    ],
  ],
  [
    "move-aoyosumu-serenity-wave",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "skip-action",
        scope: { type: "next-turn", subject: "opponent", sourceText: "on their next turn" },
        sourceText: "SUCCESSFUL - Your opponent cannot attack on their next turn",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "skip-action",
        scope: { type: "next-turn", subject: "self", sourceText: "on your next turn" },
        sourceText:
          "SUCCESSFUL - Your opponent cannot attack on their next turn. You cannot attack on your next turn",
      },
    ],
  ],
  [
    "move-aoyosumu-crushing-kick",
    [
      {
        trigger: "before-attack-roll",
        target: "opponent",
        type: "set-resolution-threshold",
        outcome: "stop",
        roll: "defense",
        comparison: "at-least",
        value: { type: "literal", value: 5 },
        relativeTo: "attack-roll",
        resultScope: "current-attack",
        sourceText:
          "Your opponent's defensive roll result must be +5 or more your attack roll result to STOP this attack",
      },
    ],
  ],
  [
    "move-aoyosumu-tiger-strikes",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "reroll",
        roll: "defense",
        scope: { type: "next-roll", roll: "defense", sourceText: "your next defensive roll" },
        sourceText: "SUCCESSFUL - You may re-roll your next defensive roll with +3 to the result",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "modify-roll",
        roll: "defense",
        modifier: "result",
        amount: { type: "literal", value: 3 },
        scope: { type: "next-roll", roll: "defense", sourceText: "your next defensive roll" },
        sourceText: "SUCCESSFUL - You may re-roll your next defensive roll with +3 to the result",
      },
    ],
  ],
  [
    "move-aoyosumu-nowhere-wave",
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
          sourceText: "base cost 1 attacks",
        },
        duration: {
          type: "turns",
          turns: { type: "literal", value: 3 },
          sourceText: "next 3 turns",
        },
        sourceText:
          "SUCCESSFUL - Your opponent's base cost 1 attacks cost +1 KI for their next 3 turns",
      },
    ],
  ],
  [
    "move-aoyosumu-blast-shield",
    [
      {
        trigger: "on-stopped",
        target: "self",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: -2 },
        minimum: { type: "literal", value: 1 },
        selector: {
          type: "move-selector",
          subject: "target",
          styleId: AOYOSUMU_STYLE.id,
          category: "advanced-attack",
          effectTextIncludes: "Dexterity",
          sourceText: 'Aoyosumu attack with the word "Dexterity" in the effect',
        },
        scope: {
          type: "next-action",
          sourceText: 'Your next Aoyosumu attack with the word "Dexterity" in the effect',
        },
        sourceText:
          'Your next Aoyosumu attack with the word "Dexterity" in the effect costs -2 KI to a minimum of 1 to perform',
      },
    ],
  ],
  [
    "move-aoyosumu-epitaph-to-war",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "set-resolution-threshold",
        outcome: "successful",
        roll: "attack",
        comparison: "at-least",
        value: { type: "literal", value: 25 },
        resultScope: "current-attack",
        scope: { type: "next-action", sourceText: "Your opponent's next attack" },
        sourceText:
          "SUCCESSFUL - Your opponent's next attack must be 25 or higher to be successful",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "set-resolution-threshold",
        outcome: "successful",
        roll: "attack",
        comparison: "at-least",
        value: { type: "literal", value: 13 },
        resultScope: "current-attack",
        duration: { type: "combat", sourceText: "remainder of combat" },
        sourceText:
          "SUCCESSFUL - Your opponent's next attack must be 25 or higher to be successful. All attacks performed against you for the remainder of combat must have an attack roll result of 13 or higher to be SUCCESSFUL",
      },
    ],
  ],
  [
    "move-aoyosumu-serenity-explosion",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-roll",
        roll: "attack",
        modifier: "sides",
        amount: { type: "literal", value: -2 },
        conditions: [
          {
            type: "stat-comparison",
            left: "self",
            stat: "dexterity",
            comparison: "higher-than",
            right: "opponent",
            sourceText: "If your Dexterity is more than your opponent's Dexterity",
          },
        ],
        duration: { type: "combat", sourceText: "remainder of the match" },
        sourceText:
          "SUCCESSFUL - If your Dexterity is more than your opponent's Dexterity, your opponent's attack dice gain -2 dice sides for the remainder of the match",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-resource",
        resource: "hp",
        operation: "lose",
        amount: {
          type: "stat-difference-percent",
          left: "self",
          right: "opponent",
          stat: "dexterity-bonus",
          percentPerPoint: 15,
          maximum: 60,
        },
        conditions: [
          {
            type: "stat-comparison",
            left: "self",
            stat: "dexterity",
            comparison: "higher-than",
            right: "opponent",
            sourceText: "If your Dexterity is more than your opponent's Dexterity",
          },
        ],
        sourceText:
          "SUCCESSFUL - If your Dexterity is more than your opponent's Dexterity, your opponent's attack dice gain -2 dice sides for the remainder of the match. Your opponent loses (15% Power) HP for every point that your Dexterity bonus is above theirs to a maximum of (60% Power) HP",
      },
    ],
  ],
  [
    "move-aoyosumu-zen-explosion",
    [
      {
        trigger: "after-defense-roll",
        target: "self",
        type: "reroll",
        roll: "defense",
        conditions: [
          {
            type: "roll-threshold",
            roll: "defense",
            comparison: "at-most",
            value: { type: "literal", value: 7 },
            sourceText: "when your defensive roll result is 7 or less",
          },
        ],
        duration: { type: "combat", sourceText: "For the remainder of the match" },
        sourceText:
          "SUCCESSFUL - For the remainder of the match, when your defensive roll result is 7 or less, you may re-roll your defensive roll",
      },
    ],
  ],
  [
    "move-aoyosumu-state-of-zen",
    [
      {
        trigger: "passive",
        target: "self",
        type: "prevent-move-modification",
        selector: {
          type: "move-selector",
          subject: "source",
          category: "advanced-attack",
          sourceText: "Your Advanced Attacks",
        },
        aspects: ["dice-sides", "effects", "roll-results"],
        actor: "opponent",
        sourceText:
          "Constant. Your Advanced Attacks cannot have their dice sides, results, or effects manipulated, changed, or erased by an opponent's effects",
      },
    ],
  ],
  [
    "move-aoyosumu-elevated-kick",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "prevent-roll-modification",
        roll: "attack",
        modifier: "result",
        duration: {
          type: "until-roll-threshold",
          roll: "attack",
          comparison: "at-least",
          value: { type: "literal", value: 20 },
          sourceText: "until they perform a single dice attack of 20 or more",
        },
        sourceText:
          "SUCCESSFUL - Your opponent cannot modify their attack roll results until they perform a single dice attack of 20 or more",
      },
    ],
  ],
  [
    "move-aoyosumu-sonic-whisper",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "skip-action",
        blockedCategories: ["advanced-attack", "signature"],
        scope: { type: "next-turn", subject: "opponent", sourceText: "on their next turn" },
        sourceText: "SUCCESSFUL - Your opponent cannot attack you on their next turn",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: -8 },
        scope: {
          type: "next-actions",
          count: { type: "literal", value: 3 },
          sourceText: "Your opponent's next 3 attacks",
        },
        sourceText:
          "SUCCESSFUL - Your opponent cannot attack you on their next turn. Your opponent's next 3 attacks gain -8 to the results",
      },
    ],
  ],
  [
    "move-aoyosumu-the-secret-of-the-universe",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "set-resolution-threshold",
        outcome: "successful",
        roll: "attack",
        comparison: "at-least",
        value: { type: "literal", value: 5 },
        relativeTo: "defense-roll",
        resultScope: "current-attack",
        duration: { type: "combat", sourceText: "For the rest of combat" },
        sourceText:
          "SUCCESSFUL - For the rest of combat, your opponent's attack roll result(s) must be 5 higher than your defensive result to count as SUCCESSFUL for any effects",
      },
    ],
  ],
  [
    "move-aoyosumu-untouchable-mastery",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-roll",
        roll: "defense",
        modifier: "sides",
        amount: { type: "literal", value: 3 },
        sourceText: "Your defensive rolls gain +3 sides",
      },
      {
        trigger: "on-stopped",
        target: "self",
        type: "modify-roll",
        roll: "defense",
        modifier: "sides",
        amount: { type: "literal", value: 5 },
        scope: { type: "next-roll", roll: "defense", sourceText: "your next defensive roll" },
        sourceText: "After you STOP an attack, your next defensive roll gains +5 sides instead",
      },
      {
        trigger: "passive",
        target: "self",
        type: "modify-roll",
        roll: "defense",
        modifier: "result",
        amount: { type: "literal", value: 5 },
        conditions: [
          {
            type: "move-selector",
            subject: "source",
            category: "signature",
            sourceText: "against Signature Techniques",
          },
        ],
        sourceText: "Your defensive rolls against Signature Techniques gain +5 to the result",
      },
    ],
  ],
  [
    "move-aoyosumu-counterstrike-mastery",
    [
      {
        trigger: "after-defense-roll",
        target: "self",
        type: "grant-counter-action",
        stopsTriggeringAttack: true,
        action: "choose-attack",
        activationCost: {
          resource: "ki",
          operation: "lose",
          amount: { type: "literal", value: 1 },
        },
        useLimit: { scope: "combat", count: 2, sourceText: "Twice per combat" },
        conditions: [
          {
            type: "move-selector",
            subject: "target",
            category: "advanced-attack",
            restriction: "unrestricted",
            attackRoll: { dice: 1 },
            sourceText: "an UNRESTRICTED single dice attack",
          },
        ],
        sourceText:
          "Twice per combat, you may lose 1 KI and choose to not roll a defensive roll against an UNRESTRICTED single dice attack. If you do, the attack is STOPPED and COUNTERED",
      },
      {
        trigger: "passive",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "literal", value: 10 },
        scope: { type: "current-action", sourceText: "during a COUNTER" },
        sourceText: "Your attacks performed during a COUNTER deal +(10% Power) Damage",
      },
      {
        trigger: "passive",
        target: "self",
        type: "modify-cost",
        operation: "add",
        amount: { type: "literal", value: -1 },
        minimum: { type: "literal", value: 1 },
        scope: { type: "current-action", sourceText: "during a COUNTER" },
        sourceText:
          "Your attacks performed during a COUNTER deal +(10% Power) Damage and cost -1 KI, to a minimum of 1",
      },
    ],
  ],
  [
    "move-aoyosumu-leverage-mastery",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-roll",
        roll: "defense",
        modifier: "result",
        amount: { type: "combat-result-count", actor: "self", result: "stopped", perResult: 1 },
        sourceText:
          "Your defensive roll results gain +1 for every attack you've STOPPED prior to that roll",
      },
      {
        trigger: "on-stopped",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "literal", value: 5 },
        scope: { type: "next-action", sourceText: "your attack on your next turn" },
        sourceText:
          "After stopping an attack, your attack on your next turn does +(5% Power) Damage and gains +3 to the result(s)",
      },
      {
        trigger: "on-stopped",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: 3 },
        scope: { type: "next-action", sourceText: "your attack on your next turn" },
        sourceText:
          "After stopping an attack, your attack on your next turn does +(5% Power) Damage and gains +3 to the result(s)",
      },
    ],
  ],
  [
    "move-aoyosumu-stoicism",
    [
      {
        trigger: "on-roll-modified",
        target: "self",
        type: "modify-roll-modifier",
        multiplier: { type: "literal", value: 2 },
        modifier: "any",
        excludeSourceCategories: ["mastery"],
        cap: { type: "allow-exceed", sourceText: "You can exceed the normal cap with this effect" },
        useLimit: { scope: "combat", count: 2, sourceText: "RESTRICTEDx2" },
        activationCost: {
          resource: "ki",
          operation: "lose",
          amount: { type: "literal", value: 1 },
        },
        sourceText:
          "RESTRICTEDx2. Activate when modifying your dice sides and/or result(s). Double the amount modified, except modifications from a Mastery. You can exceed the normal cap with this effect. Cost: 1 KI",
      },
    ],
  ],
  [
    "move-aoyosumu-quiet-preparation",
    [
      {
        trigger: "action-phase",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: {
          type: "combat-result-count",
          actor: "self",
          result: "counter",
          perResult: 5,
          minimum: 5,
          maximum: 15,
        },
        selector: {
          type: "move-selector",
          subject: "target",
          styleId: AOYOSUMU_STYLE.id,
          category: "advanced-attack",
          sourceText: "Aoyosumu attacks",
        },
        scope: {
          type: "next-actions",
          count: { type: "literal", value: 2 },
          sourceText: "Your next 2 Aoyosumu attacks",
        },
        activationCost: {
          resource: "ki",
          operation: "lose",
          amount: { type: "literal", value: 2 },
        },
        sourceText:
          "Your next 2 Aoyosumu attacks do +(5% Power) for every time you have COUNTERED this match to a maximum of +(15% Power) and a minimum of +(5% Power). Your next defensive roll with a base roll of 1d30 can COUNTER on a result of 30 or higher. You may activate this skill during the COUNTER phase instead of the ACTION phase. If you do, it costs 0 KI. Cost: 2 KI",
      },
    ],
  ],
  [
    "move-aoyosumu-lights-out-strike",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-damage",
        operation: "set",
        percent: { type: "literal", value: 0 },
        selector: {
          type: "move-selector",
          subject: "target",
          category: "advanced-attack",
          sourceText: "Choose one of your opponent's Advanced Attacks",
        },
        duration: {
          type: "until-roll-threshold",
          roll: "attack",
          comparison: "at-least",
          value: { type: "literal", value: 25 },
          sourceText: "until your opponent rolls a 25 or higher on a single dice attack",
        },
        stacking: "prevent",
        sourceText:
          "SUCCESSFUL - Choose one of your opponent's Advanced Attacks. The base damage of that attack is changed to (0% Power) until your opponent rolls a 25 or higher on a single dice attack. You may not use this effect on more than one attack at a time",
      },
    ],
  ],
  [
    "move-aoyosumu-straightjacket",
    [
      {
        trigger: "after-defense-roll",
        target: "self",
        type: "grant-counter-action",
        stopsTriggeringAttack: false,
        action: "choose-attack",
        conditions: [
          {
            type: "roll-threshold",
            roll: "defense",
            comparison: "at-least",
            value: { type: "literal", value: 25 },
            sourceText: "if you roll a defensive roll result of 25 or higher",
          },
        ],
        duration: {
          type: "turns",
          turns: { type: "literal", value: 6 },
          sourceText: "next 6 turns",
        },
        stacking: "prevent",
        sourceText:
          "SUCCESSFUL - For the next 6 turns, if you roll a defensive roll result of 25 or higher, COUNTER. If your defensive dice roll result was lower than your opponent's attack roll result, their attack is still SUCCESSFUL. The duration of this effect cannot stack; it must expire before you can renew it",
      },
    ],
  ],
  [
    "move-aoyosumu-shaolin-cross-punch",
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
          baseKiCost: { comparison: "at-most", value: { type: "literal", value: 2 } },
          sourceText: "base cost 2 or lower attacks",
        },
        conditions: [
          {
            type: "prior-action",
            actor: "self",
            result: "stopped",
            sourceText: "If you stopped your opponent's last attack",
          },
        ],
        duration: {
          type: "until-roll-threshold",
          roll: "attack",
          comparison: "at-least",
          value: { type: "literal", value: 25 },
          sourceText: "until they roll a 25 or higher on a single dice attack",
        },
        stacking: "prevent",
        sourceText:
          "SUCCESSFUL - If you stopped your opponent's last attack, your opponent's base cost 2 or lower attacks cost +1 KI until they roll a 25 or higher on a single dice attack. This effect cannot stack with itself",
      },
    ],
  ],
  [
    "move-aoyosumu-super-arm-bar-takedown",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: -2 },
        selector: {
          type: "move-selector",
          subject: "target",
          category: "advanced-attack",
          tags: ["physical"],
          sourceText: "Choose two of your opponent's physical Advanced Attacks",
        },
        duration: { type: "combat", sourceText: "remainder of the match" },
        sourceText:
          "SUCCESSFUL - Choose two of your opponent's physical Advanced Attacks. Those attacks gain -2 to their result(s) for the remainder of the match",
      },
      {
        trigger: "on-stopped",
        target: "self",
        type: "modify-remaining-uses",
        amount: { type: "literal", value: 1 },
        selector: {
          type: "move-selector",
          subject: "source",
          category: "advanced-attack",
          sourceText: "this attack",
        },
        conditions: [
          {
            type: "action-sequence",
            actor: "self",
            result: "stopped",
            count: 1,
            sourceText: "If this attack is STOPPED the first time you perform it during the match",
          },
        ],
        sourceText:
          "STOPPED - If this attack is STOPPED the first time you perform it during the match, it gains RESTRICTED+1",
      },
    ],
  ],
  [
    "move-aoyosumu-swift-neck-chop",
    [
      {
        trigger: "before-attack-roll",
        target: "self",
        type: "modify-damage",
        operation: "add",
        percent: { type: "literal", value: 5 },
        conditions: [
          {
            type: "stat-comparison",
            left: "self",
            stat: "dexterity",
            comparison: "higher-than",
            right: "opponent",
            sourceText: "If your Dexterity is more than your opponent's Dexterity",
          },
        ],
        sourceText:
          "If your Dexterity is more than your opponent's Dexterity, this attack does +(5% Power) Damage",
      },
    ],
  ],
  [
    "move-aoyosumu-trapped-strikes",
    [
      {
        trigger: "before-attack-roll",
        target: "self",
        type: "modify-roll",
        roll: "attack",
        modifier: "sides",
        amount: { type: "literal", value: 2 },
        conditions: [
          {
            type: "prior-action",
            actor: "self",
            result: "successful",
            sourceText: "If you performed a SUCCESSFUL attack during the COUNTER phase last turn",
          },
        ],
        sourceText:
          "If you performed a SUCCESSFUL attack during the COUNTER phase last turn, this attack gains +2 dice sides and cannot be blocked",
      },
      {
        trigger: "on-success",
        target: "self",
        type: "modify-roll",
        roll: "defense",
        modifier: "result",
        amount: { type: "literal", value: 2 },
        scope: { type: "next-roll", roll: "defense", sourceText: "Your next defensive roll" },
        stacking: "prevent",
        sourceText:
          "SUCCESSFUL - Your next defensive roll and next attack roll during your COUNTER phase gains +2 to the result. This effect cannot stack with itself",
      },
    ],
  ],
  [
    "move-aoyosumu-hundred-point-strike",
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
          sourceText: "to attack you",
        },
        conditions: [
          {
            type: "successful-hit-count",
            comparison: "at-least",
            value: { type: "literal", value: 6 },
            sourceText: "If 6 or more dice hit",
          },
        ],
        scope: { type: "next-turn", subject: "opponent", sourceText: "on their next turn" },
        useLimit: { scope: "turn", count: 1, sourceText: "once every 4 turns" },
        sourceText:
          "SUCCESSFUL - If 6 or more dice hit, your opponent must lose 2 KI to attack you on their next turn. This effect can only trigger once every 4 turns",
      },
    ],
  ],
  [
    "move-aoyosumu-impenetrable-defense",
    [
      {
        trigger: "before-defense-roll",
        target: "self",
        type: "modify-roll",
        roll: "defense",
        modifier: "result",
        amount: { type: "literal", value: 5 },
        activationCost: {
          resource: "ki",
          operation: "lose",
          amount: { type: "literal", value: 2 },
        },
        duration: { type: "combat", sourceText: "For the remainder of the match" },
        useLimit: { scope: "turn", count: 1, sourceText: "COOLDOWN 1" },
        sourceText:
          "For the remainder of the match, before you roll your defensive die you may lose 2 KI to gain +5 to the result of your defensive roll. This effect has COOLDOWN 1",
      },
    ],
  ],
  [
    "move-aoyosumu-tranquil-strike",
    [
      {
        trigger: "on-stopped",
        target: "opponent",
        type: "set-combat-result",
        result: "stopped",
        resultScope: "current-attack",
        scope: { type: "next-action", sourceText: "the next attack they perform against you" },
        conditions: [
          {
            type: "combat-result",
            actor: "opponent",
            result: "stopped",
            sourceText: "If your opponent STOPPED this attack",
          },
          {
            type: "defense-response",
            blockUsed: false,
            resultModified: false,
            rerolled: false,
            sourceText:
              "without using a Block or activating any result modifiers or re-rolls after their defense roll",
          },
        ],
        sourceText:
          "STOPPED - If your opponent STOPPED this attack without using a Block or activating any result modifiers or re-rolls after their defense roll, STOP the next attack they perform against you this combat",
      },
    ],
  ],
  [
    "move-aoyosumu-sky-dance-technique",
    [
      {
        trigger: "on-success",
        target: "self",
        type: "grant-extra-action",
        phase: "upkeep-phase",
        moveCategory: "skill",
        constant: true,
        scope: { type: "next-turn", subject: "self", sourceText: "At the start of your next turn" },
        sourceText:
          "SUCCESSFUL - At the start of your next turn, you may activate one of your Skills with a CONSTANT effect during your UPKEEP phase",
      },
      {
        trigger: "on-success",
        target: "opponent",
        type: "deactivate",
        affectedType: "skill",
        count: { type: "successful-hit-count-groups", groupSize: 2 },
        conditions: [
          {
            type: "move-selector",
            subject: "target",
            category: "skill",
            constant: true,
            sourceText: "one of your opponent's Skills with a CONSTANT effect",
          },
        ],
        sourceText:
          "SUCCESSFUL - At the start of your next turn, you may activate one of your Skills with a CONSTANT effect during your UPKEEP phase. For every 2 SUCCESSFUL hits, DEACTIVATE one of your opponent's Skills with a CONSTANT effect",
      },
      {
        trigger: "on-stopped",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "lose",
        amount: { type: "literal", value: 1 },
        conditions: [
          {
            type: "action-sequence",
            actor: "self",
            result: "stopped",
            count: 3,
            sourceText: "If three or more dice rolls are STOPPED",
          },
        ],
        sourceText: "STOPPED - If three or more dice rolls are STOPPED, lose 1 KI",
      },
    ],
  ],
  [
    "move-aoyosumu-somersault-roll",
    [
      {
        trigger: "on-stopped",
        target: "self",
        type: "create-floating-effect",
        floatingEffectId: "somersault-roll-constant-skill-deactivation",
        scope: { type: "next-turn", subject: "self", sourceText: "on your next turn" },
        sourceText:
          'If you perform an attack that matches any of the traits (not including PHYSICAL or ENERGY) on your next turn, that attack gains "SUCCESSFUL - Choose up to 2 Skills with CONSTANT effects. Those Skills are now DEACTIVATED"',
      },
    ],
  ],
]);

const toMoveDefinition = (sourceMove: MoveSourceDefinition): MoveDefinition => {
  const category = categoryByMoveId.get(sourceMove.id);
  if (category === undefined) {
    throw new Error(`Aoyosumu move is missing a category: ${sourceMove.id}`);
  }
  const structuredEffects = structuredEffectsByMoveId.get(sourceMove.id);

  return {
    id: sourceMove.id,
    name: sourceMove.name,
    styleId: AOYOSUMU_STYLE.id,
    category,
    tags: sourceMove.declaredTags.flatMap((tag) => {
      const attackTag = attackTagBySourceTag[tag as keyof typeof attackTagBySourceTag];
      return attackTag === undefined ? [] : [attackTag];
    }),
    description: sourceMove.description,
    effectText: sourceMove.effectText,
    effectClauses: sourceMove.effectClauses,
    mechanics: sourceMove.mechanics,
    ...(structuredEffects === undefined ? {} : { effects: structuredEffects }),
    ...(sourceMove.requirementsText === "None"
      ? {}
      : {
          requirements: [{ type: "source-text", text: sourceMove.requirementsText }],
        }),
    ...(sourceMove.trainingDays === undefined ? {} : { trainingDays: sourceMove.trainingDays }),
    source: sourceMove.source,
  };
};

export const AOYOSUMU_MOVES: readonly MoveDefinition[] = MOVE_SOURCE_DEFINITIONS.filter((move) =>
  move.id.startsWith("move-aoyosumu-"),
).map(toMoveDefinition);
