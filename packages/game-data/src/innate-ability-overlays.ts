import type { EffectDefinition } from "./shared/effects.js";
import type { InnateAbilityOverlay, SourceClauseReference } from "./shared/types.js";

const clause = (
  sourceDefinitionId: string,
  clauseOrder: number,
  sourceText: string,
): SourceClauseReference => ({ sourceDefinitionId, clauseOrder, sourceText });

const overlay = (
  sourceDefinitionId: string,
  effects: readonly EffectDefinition[],
  coveredClauseOrders?: readonly number[],
): InnateAbilityOverlay => {
  const sourceClauses = effects.flatMap((effect) =>
    effect.sourceClauseOrder === undefined
      ? []
      : [clause(sourceDefinitionId, effect.sourceClauseOrder, effect.sourceText)],
  );
  return {
    sourceDefinitionId,
    sourceClauses: sourceClauses.filter(
      (sourceClause, index, clauses) =>
        clauses.findIndex((candidate) => candidate.clauseOrder === sourceClause.clauseOrder) ===
        index,
    ),
    ...(coveredClauseOrders === undefined ? {} : { coveredClauseOrders }),
    effects,
  };
};

const advancedAttackSlot = (sourceClauseOrder: number, sourceText: string) =>
  ({
    trigger: "passive",
    target: "self",
    type: "modify-slot-capacity",
    slot: "advanced-attack",
    amount: { type: "literal", value: 1 },
    sourceClauseOrder,
    sourceText,
  }) as const;

const transformationStability = (sourceClauseOrder: number, sourceText: string) =>
  ({
    trigger: "passive",
    target: "self",
    type: "prevent-transformation-reversion",
    sourceClauseOrder,
    sourceText,
  }) as const;

const attackDamage = (sourceClauseOrder: number, percent: number, sourceText: string) =>
  ({
    trigger: "passive",
    target: "self",
    type: "modify-damage",
    operation: "add",
    percent: { type: "literal", value: percent },
    sourceClauseOrder,
    sourceText,
  }) as const;

const statBonus = (
  sourceClauseOrder: number,
  stat: "dexterity" | "dexterity-bonus",
  amount: number,
  sourceText: string,
) =>
  ({
    trigger: "passive",
    target: "self",
    type: "modify-stat",
    stat,
    operation: "add",
    amount: { type: "literal", value: amount },
    sourceClauseOrder,
    sourceText,
  }) as const;

const weaponAttackSides = (sourceClauseOrder: number, sourceText: string) =>
  ({
    trigger: "passive",
    target: "self",
    type: "modify-roll",
    roll: "attack",
    modifier: "sides",
    amount: { type: "literal", value: 2 },
    selector: {
      type: "move-selector",
      subject: "source",
      requirementIncludes: ["Weapon"],
      sourceText,
    },
    sourceClauseOrder,
    sourceText,
  }) as const;

const weaponSkillCost = (sourceClauseOrder: number, sourceText: string) =>
  ({
    trigger: "passive",
    target: "self",
    type: "modify-cost",
    operation: "add",
    amount: { type: "literal", value: -1 },
    minimum: { type: "literal", value: 1 },
    selector: {
      type: "move-selector",
      subject: "source",
      category: "skill",
      requirementIncludes: ["Weapon"],
      sourceText,
    },
    sourceClauseOrder,
    sourceText,
  }) as const;

const costReduction = (
  sourceClauseOrder: number,
  amount: number,
  minimum: number,
  sourceText: string,
) =>
  ({
    trigger: "passive",
    target: "self",
    type: "modify-cost",
    operation: "add",
    amount: { type: "literal", value: amount },
    minimum: { type: "literal", value: minimum },
    selector: {
      type: "move-selector",
      subject: "source",
      baseKiCost: { comparison: "at-least", value: { type: "literal", value: minimum + 2 } },
      sourceText,
    },
    sourceClauseOrder,
    sourceText,
  }) as const;

const resourceGain = (
  sourceClauseOrder: number,
  trigger: "start-combat" | "on-power-up",
  amount: number,
  sourceText: string,
) =>
  ({
    trigger,
    target: "self",
    type: "modify-resource",
    resource: "ki",
    operation: "gain",
    amount: { type: "literal", value: amount },
    sourceClauseOrder,
    sourceText,
  }) as const;

const attackSides = (sourceClauseOrder: number, amount: number, sourceText: string) =>
  attackRollModifier(sourceClauseOrder, "sides", amount, sourceText);

const preventSever = (sourceClauseOrder: number, sourceText: string) =>
  ({
    trigger: "before-attack-roll",
    target: "self",
    type: "prevent-combat-result",
    result: "sever",
    sourceClauseOrder,
    sourceText,
  }) as const;

const styleClassification = (sourceClauseOrder: number, sourceText: string) =>
  ({
    trigger: "passive",
    target: "self",
    type: "modify-move-classification",
    replaceStyle: "declared-style",
    selector: {
      type: "move-selector",
      subject: "source",
      styleId: "style-freestyle",
      sourceText,
    },
    sourceClauseOrder,
    sourceText,
  }) as const;

const copiedRollSides = (
  sourceClauseOrder: number,
  amount: number,
  sourceText: string,
  roll: "attack" | "defense",
) =>
  ({
    trigger: roll === "attack" ? "before-attack-roll" : "before-defense-roll",
    target: "self",
    type: "modify-roll",
    roll,
    modifier: "sides",
    amount: { type: "literal", value: amount },
    selector: {
      type: "move-selector",
      subject: "source",
      effectTextIncludes: "copied",
      sourceText,
    },
    sourceClauseOrder,
    sourceText,
  }) as const;

const oozaruForcedAction = (
  sourceKey: string,
  sourceText: string,
  sourceClauseOrders: { readonly roll: number; readonly select: number; readonly force: number },
) => [
  {
    trigger: "upkeep-phase" as const,
    target: "self" as const,
    type: "roll-and-store" as const,
    dice: 1,
    sides: 2,
    storageKey: `${sourceKey}-trigger-roll`,
    sourceClauseOrder: sourceClauseOrders.roll,
    sourceText,
  },
  {
    trigger: "upkeep-phase" as const,
    target: "self" as const,
    type: "select-move-by-stored-roll" as const,
    storageKey: `${sourceKey}-trigger-roll`,
    selectionKey: `${sourceKey}-selected-attack`,
    subject: "self" as const,
    selector: {
      type: "move-selector" as const,
      subject: "source" as const,
      category: "advanced-attack" as const,
      sourceText: "Advanced Attack in your moveset.",
    },
    ordering: "character-sheet-top-to-bottom" as const,
    reindex: "on-moveset-change" as const,
    sourceClauseOrder: sourceClauseOrders.select,
    sourceText: "The result corresponds to the order of the moves in your moveset.",
  },
  {
    trigger: "action-phase" as const,
    target: "self" as const,
    type: "force-action" as const,
    allowedCategories: ["advanced-attack" as const],
    allowPass: true,
    selectedMoveStorageKey: `${sourceKey}-selected-attack`,
    sourceClauseOrder: sourceClauseOrders.force,
    sourceText: "You must perform that attack or pass.",
  },
];

const highTensionSlot = "You gain +1 Advanced Attack slot.";
const fivePercentDamage = "Your attacks do +(5% Power) Damage.";
const tenPercentDamage = "Your attacks do +(10% Power) Damage.";
const dexterityBonus = "Dexterity Bonus +1.";
const weaponAttackBonus = "Your attacks that require a Weapon gain +2 dice sides.";
const weaponSkillDiscount =
  "Your Skills that require a Weapon cost -1 KI Point to a minimum of 1 to use or activate.";

const damageReduction = (sourceClauseOrder: number, percent: number, sourceText: string) =>
  ({
    trigger: "passive",
    target: "self",
    type: "modify-damage",
    operation: "add",
    percent: { type: "damage-percent", subject: "current-action", percent },
    selector: {
      type: "move-selector",
      subject: "source",
      tags: ["physical"],
      sourceText,
    },
    sourceClauseOrder,
    sourceText,
  }) as const;

const attackRollModifier = (
  sourceClauseOrder: number,
  modifier: "result" | "sides",
  amount: number,
  sourceText: string,
  dieIndex?: number,
) =>
  ({
    trigger: "before-attack-roll",
    target: "self",
    type: "modify-roll",
    roll: "attack",
    modifier,
    amount: { type: "literal", value: amount },
    ...(dieIndex === undefined ? {} : { dieIndex }),
    sourceClauseOrder,
    sourceText,
  }) as const;

const defenseRollModifier = (sourceClauseOrder: number, amount: number, sourceText: string) =>
  ({
    trigger: "before-defense-roll",
    target: "self",
    type: "modify-roll",
    roll: "defense",
    modifier: "result",
    amount: { type: "literal", value: amount },
    sourceClauseOrder,
    sourceText,
  }) as const;

const signatureAttackSides = (sourceClauseOrder: number, amount: number, sourceText: string) =>
  ({
    trigger: "before-attack-roll",
    target: "self",
    type: "modify-roll",
    roll: "attack",
    modifier: "sides",
    amount: { type: "literal", value: amount },
    selector: {
      type: "move-selector",
      subject: "source",
      category: "signature",
      sourceText,
    },
    sourceClauseOrder,
    sourceText,
  }) as const;

const firstDefenseRollBonus = (sourceClauseOrder: number, sourceText: string) =>
  ({
    ...defenseRollModifier(sourceClauseOrder, 3, sourceText),
    useLimit: { scope: "combat", count: 1, sourceText },
  }) as const;

const attackRollModifierForCost = (
  sourceClauseOrder: number,
  minimumCost: number,
  amount: number,
  sourceText: string,
) =>
  ({
    trigger: "before-attack-roll",
    target: "self",
    type: "modify-roll",
    roll: "attack",
    modifier: "result",
    amount: { type: "literal", value: amount },
    selector: {
      type: "move-selector",
      subject: "source",
      baseKiCost: { comparison: "at-least", value: { type: "literal", value: minimumCost } },
      sourceText,
    },
    sourceClauseOrder,
    sourceText,
  }) as const;

const gainKiWhenCombatOutcome = (sourceClauseOrder: number, outcome: "stun", sourceText: string) =>
  ({
    trigger: "on-combat-result",
    target: "self",
    type: "modify-resource",
    resource: "ki",
    operation: "gain",
    amount: { type: "literal", value: 1 },
    conditions: [
      {
        type: "combat-outcome",
        actor: "self",
        outcome,
        sourceText,
      },
    ],
    sourceClauseOrder,
    sourceText,
  }) as const;

const resourceChangeOnStoppedDefense = (sourceClauseOrder: number, sourceText: string) =>
  ({
    trigger: "on-stopped",
    target: "self",
    type: "modify-resource",
    resource: "ki",
    operation: "gain",
    amount: { type: "literal", value: 1 },
    conditions: [
      {
        type: "move-selector",
        subject: "target",
        tags: ["energy"],
        sourceText: "energy attack",
      },
      {
        type: "roll-threshold",
        roll: "defense",
        comparison: "at-least",
        value: { type: "literal", value: 25 },
        sourceText: "a defensive dice result of 25 or more",
      },
    ],
    sourceClauseOrder,
    sourceText,
  }) as const;

const powerAbsorptionAttackResourceChange = (
  sourceClauseOrder: number,
  target: "self" | "opponent",
  operation: "gain" | "lose",
  sourceText: string,
) =>
  ({
    trigger: "on-success",
    target,
    type: "modify-resource",
    resource: "ki",
    operation,
    amount: { type: "literal", value: 1 },
    conditions: [
      {
        type: "move-selector",
        subject: "target",
        category: "advanced-attack",
        tags: ["physical"],
        attackRoll: { dice: 1 },
        sourceText: "single dice physical Advance Attacks",
      },
      {
        type: "roll-threshold",
        roll: "attack",
        comparison: "at-least",
        value: { type: "literal", value: 28 },
        sourceText: "an attack roll result of 28 or more",
      },
    ],
    sourceClauseOrder,
    sourceText,
  }) as const;

const firstAttacksKiDrain = (sourceClauseOrder: number, sourceText: string) =>
  ({
    trigger: "on-success",
    target: "opponent",
    type: "modify-resource",
    resource: "ki",
    operation: "lose",
    amount: { type: "literal", value: 1 },
    useLimit: { scope: "combat", count: 2, sourceText },
    sourceClauseOrder,
    sourceText,
  }) as const;

const successfulAttackStatus = (
  sourceClauseOrder: number,
  statusId: string,
  sourceText: string,
  conditions: EffectDefinition["conditions"],
  activationCost?: NonNullable<EffectDefinition["activationCost"]>,
  useLimit?: NonNullable<EffectDefinition["useLimit"]>,
) =>
  ({
    trigger: "on-success",
    target: "opponent",
    type: "apply-status",
    statusId,
    conditions,
    ...(activationCost === undefined ? {} : { activationCost }),
    ...(useLimit === undefined ? {} : { useLimit }),
    sourceClauseOrder,
    sourceText,
  }) as const;

const conditionalAttackDamage = (
  sourceClauseOrder: number,
  percent: number,
  sourceText: string,
  conditions: EffectDefinition["conditions"],
) =>
  ({
    trigger: "passive",
    target: "self",
    type: "modify-damage",
    operation: "add",
    percent: { type: "damage-percent", subject: "current-action", percent },
    conditions,
    sourceClauseOrder,
    sourceText,
  }) as const;

const firstAttackCostReduction = (sourceClauseOrder: number, sourceText: string) => ({
  trigger: "passive" as const,
  target: "self" as const,
  type: "modify-cost" as const,
  operation: "add" as const,
  amount: { type: "literal" as const, value: -1 },
  minimum: { type: "literal" as const, value: 1 },
  selector: {
    type: "move-selector" as const,
    subject: "source" as const,
    tags: ["physical"],
    sourceText: "first physical attack each match",
  },
  useLimit: { scope: "combat" as const, count: 1, sourceText },
  sourceClauseOrder,
  sourceText,
});

const resourceThresholdGain = (
  sourceClauseOrder: number,
  resource: "hp" | "ki",
  comparison: "at-most" | "lower-than",
  percent: number,
  amount: number,
  sourceText: string,
) =>
  ({
    trigger: "on-resource-threshold",
    target: "self",
    type: "modify-resource",
    resource: "ki",
    operation: "gain",
    amount: { type: "literal", value: amount },
    conditions: [
      {
        type: "resource-threshold",
        subject: "self",
        resource,
        basis: "current",
        comparison,
        value: { type: "resource-percent", subject: "self", resource, basis: "total", percent },
        sourceText,
      },
    ],
    sourceClauseOrder,
    sourceText,
  }) as const;

const attackCostReduction = (sourceClauseOrder: number, sourceText: string) =>
  ({
    trigger: "passive",
    target: "self",
    type: "modify-cost",
    operation: "add",
    amount: { type: "literal", value: -1 },
    selector: {
      type: "move-selector",
      subject: "source",
      category: "advanced-attack",
      baseKiCost: { comparison: "at-least", value: { type: "literal", value: 4 } },
      sourceText,
    },
    sourceClauseOrder,
    sourceText,
  }) as const;

const unmodifiableAttackCostReduction = (sourceClauseOrder: number, sourceText: string) =>
  ({
    ...attackCostReduction(sourceClauseOrder, sourceText),
    allowUnmodifiable: true,
  }) as const;

const averageInTheExtremeReroll = (
  sourceClauseOrder: number,
  roll: "attack" | "defense",
  sourceText: string,
) =>
  ({
    trigger: "on-roll-result",
    target: "self",
    type: "reroll",
    roll,
    rerollScope: roll === "attack" ? "entire-attack" : "single-result",
    optional: true,
    conditions: [
      {
        type: "roll-threshold",
        roll,
        comparison: "at-least",
        value: { type: "literal", value: 13 },
        sourceText,
      },
      {
        type: "roll-threshold",
        roll,
        comparison: "at-most",
        value: { type: "literal", value: 17 },
        sourceText,
      },
    ],
    useLimit: {
      scope: "turn",
      count: { type: "literal", value: 1 },
      group: "average-in-the-extreme-reroll",
      sourceText,
    },
    sourceClauseOrder,
    sourceText,
  }) as const;

const powerUpAttackPenalty = (sourceClauseOrder: number, amount: number, sourceText: string) =>
  ({
    trigger: "on-power-up",
    target: "opponent",
    type: "modify-roll",
    roll: "attack",
    modifier: "result",
    amount: { type: "literal", value: -amount },
    scope: { type: "next-action", sourceText },
    sourceClauseOrder,
    sourceText,
  }) as const;

const stoppedAttackCost = (sourceClauseOrder: number, threshold: number, sourceText: string) =>
  ({
    trigger: "on-stopped",
    target: "opponent",
    type: "modify-cost",
    operation: "add",
    amount: { type: "literal", value: 1 },
    scope: { type: "next-action", sourceText },
    conditions: [
      {
        type: "roll-threshold",
        roll: "defense",
        comparison: "at-least",
        value: { type: "literal", value: threshold },
        sourceText,
      },
    ],
    sourceClauseOrder,
    sourceText,
  }) as const;

const nextAttackDamage = (sourceClauseOrder: number, sourceText: string, sides?: number) =>
  [
    attackDamage(sourceClauseOrder, 5, sourceText),
    ...(sides === undefined
      ? []
      : [attackRollModifier(sourceClauseOrder, "sides", sides, sourceText)]),
  ].map((effect) => ({
    ...effect,
    trigger: "on-stopped" as const,
    scope: { type: "next-action" as const, sourceText: effect.sourceText },
    conflictPolicy: { type: "prevent-duplicate" as const, sourceText },
  }));

/**
 * Hand-authored semantic overlays for generated innate definitions. The
 * generated catalogs retain the complete source prose; these entries identify
 * the exact clauses that have typed combat meaning.
 */
export const INNATE_ABILITY_OVERLAYS: readonly InnateAbilityOverlay[] = [
  overlay("race-trait-taifuu-jins-runner-s-high", [
    statBonus(1, "dexterity-bonus", 1, dexterityBonus),
  ]),
  overlay("generic-class-weaponmaster", [
    weaponAttackSides(2, weaponAttackBonus),
    weaponSkillCost(3, weaponSkillDiscount),
  ]),
  overlay("race-class-humans-weaponmaster", [
    weaponAttackSides(1, weaponAttackBonus),
    weaponSkillCost(2, weaponSkillDiscount),
  ]),
  overlay("race-class-humans-average-in-the-extreme", [
    averageInTheExtremeReroll(
      1,
      "attack",
      "Once per turn, you may reroll an attack or defense roll that is between 13-17.",
    ),
    averageInTheExtremeReroll(
      1,
      "defense",
      "Once per turn, you may reroll an attack or defense roll that is between 13-17.",
    ),
  ]),
  overlay("race-class-konatsian-paladin", [
    firstDefenseRollBonus(2, "You first defense roll of the match gains +3 to the result."),
  ]),
  overlay(
    "race-trait-androids-power-core",
    [
      {
        ...costReduction(
          1,
          -1,
          1,
          "Your techniques with a KI Point cost of 3 or higher cost -1 KI Points to perform, to a minimum of 1 KI Point.",
        ),
        allowUnmodifiable: true,
      },
    ],
    [2, 3],
  ),
  overlay("race-trait-androids-power-absorption", [
    resourceChangeOnStoppedDefense(
      1,
      "When you STOP an energy attack with a defensive dice result of 25 or more, gain 1 KI Point.",
    ),
    powerAbsorptionAttackResourceChange(
      2,
      "opponent",
      "lose",
      'Your single dice physical Advance Attacks gain "SUCCESSFUL - If your attack roll result was 28 or more, your opponent loses 1 KI Point and you gain 1 KI Point".',
    ),
    powerAbsorptionAttackResourceChange(
      2,
      "self",
      "gain",
      'Your single dice physical Advance Attacks gain "SUCCESSFUL - If your attack roll result was 28 or more, your opponent loses 1 KI Point and you gain 1 KI Point".',
    ),
  ]),
  overlay("race-trait-namek-meditative-preparation", [
    resourceGain(1, "start-combat", 1, "Start combat with +1 Ki."),
    resourceGain(2, "on-power-up", 1, "Power Up grants +1 additional Ki."),
  ]),
  overlay("race-class-hybrid-saiyan-weaponmaster", [
    weaponAttackSides(1, "Your attacks that require a Weapon gain +2 dice sides."),
    weaponSkillCost(
      1,
      "Your Skills that require a Weapon cost -1 KI Point to a minimum of 1 to use or activate.",
    ),
  ]),
  overlay("race-class-maguma-jin-maguma-jin-with-style", [
    signatureAttackSides(2, 2, "Signature Techniques gain +2 dice sides."),
  ]),
  overlay("race-class-maguma-jin-it-s-the-accent", [
    firstAttacksKiDrain(
      1,
      "Your first two attacks each match gain a successful effect that removes 1 Ki from the opponent.",
    ),
  ]),
  overlay("race-class-makaioshin-magic-materializer", [
    weaponAttackSides(
      2,
      "Weapon attacks +2 dice sides; Weapon-required Skills cost -1 Ki, minimum 1.",
    ),
    weaponSkillCost(
      2,
      "Weapon attacks +2 dice sides; Weapon-required Skills cost -1 Ki, minimum 1.",
    ),
  ]),
  overlay("race-class-taifuu-jins-grease-lightning", [
    statBonus(1, "dexterity-bonus", 2, "Runner’s High becomes +2."),
  ]),
  overlay(
    "race-class-bio-androids-power-seeker",
    [attackSides(2, 1, "While Transformed, your attacks gain +1 dice side.")],
    [3, 6],
  ),
  overlay(
    "race-trait-bio-androids-regeneration",
    [
      {
        trigger: "on-combat-result",
        target: "self",
        type: "modify-resource",
        resource: "hp",
        operation: "gain",
        amount: {
          type: "resource-percent",
          subject: "self",
          resource: "hp",
          basis: "total",
          percent: 100,
        },
        conditions: [
          {
            type: "combat-outcome",
            actor: "self",
            outcome: "sever",
            sourceText: "SEVER effects",
          },
        ],
        useLimit: { scope: "combat", count: 1, sourceText: "RESTRICTEDx1." },
        sourceClauseOrder: 1,
        sourceText: "You heal from SEVER effects immediately.",
      },
    ],
    [2],
  ),
  overlay("race-class-hybrid-saiyan-human-heart-saiyan-pride", [
    {
      trigger: "passive",
      target: "self",
      type: "prevent-resource-modification",
      resource: "hp",
      operation: "lose",
      sourceActor: "opponent",
      conditions: [
        {
          type: "resource-threshold",
          subject: "self",
          resource: "hp",
          basis: "total",
          comparison: "at-most",
          value: {
            type: "resource-percent",
            subject: "self",
            resource: "hp",
            basis: "total",
            percent: 50,
          },
          sourceText: "50% Total HP or less",
        },
      ],
      sourceClauseOrder: 3,
      sourceText:
        "If your Health is (50% Total HP) HP or less, you cannot lose Health to your opponent's non-damage effects.",
    },
  ]),
  overlay("race-class-konatsian-honor-bound-duelist", [
    {
      trigger: "on-success",
      target: "opponent",
      type: "modify-resource",
      resource: "hp",
      operation: "set",
      amount: {
        type: "resource-percent",
        subject: "opponent",
        resource: "hp",
        basis: "total",
        percent: 10,
      },
      sourceClauseOrder: 3,
      sourceText: "If used on a player, they are set to (10% Total) HP.",
    },
  ]),
  overlay("race-class-majins-pain-bringer", [
    {
      trigger: "on-success",
      target: "self",
      type: "modify-resource",
      resource: "hp",
      operation: "gain",
      amount: {
        type: "resource-percent",
        subject: "self",
        resource: "hp",
        basis: "current",
        percent: 5,
      },
      conditions: [
        {
          type: "move-selector",
          subject: "target",
          tags: ["physical"],
          baseKiCost: { comparison: "at-least", value: { type: "literal", value: 3 } },
          sourceText: "successful physical attacks with base cost 3+",
        },
      ],
      sourceClauseOrder: 1,
      sourceText:
        "Successful physical attacks with base cost 3+ heal 5% Current HP; pay 1 Ki to negate an opponent’s move-effect healing.",
    },
    {
      trigger: "passive",
      target: "self",
      type: "prevent-resource-modification",
      resource: "hp",
      operation: "gain",
      sourceActor: "opponent",
      conditions: [
        {
          type: "move-selector",
          subject: "target",
          effectKinds: ["resource-loss"],
          sourceText: "opponent’s move-effect healing",
        },
      ],
      sourceClauseOrder: 1,
      sourceText: "pay 1 Ki to negate an opponent’s move-effect healing.",
    },
  ]),
  overlay("race-class-majins-made-from-finer-magic", [
    {
      trigger: "passive",
      target: "self",
      type: "prevent-status",
      statusId: "break",
      sourceClauseOrder: 1,
      sourceText: "BREAK has no effect; may negate STUN effects from opposing Advanced Attacks.",
    },
    {
      trigger: "passive",
      target: "self",
      type: "prevent-status",
      statusId: "stun",
      sourceClauseOrder: 1,
      sourceText: "BREAK has no effect; may negate STUN effects from opposing Advanced Attacks.",
    },
  ]),
  overlay(
    "race-trait-konatsian-bravery",
    [
      {
        trigger: "on-combat-result",
        target: "opponent",
        type: "negate",
        aspects: ["prevent-damage"],
        conditions: [
          {
            type: "combat-outcome",
            actor: "opponent",
            outcome: "stun",
            sourceText: "a SUCCESSFUL effect",
          },
        ],
        useLimit: { scope: "combat", count: 1, sourceText: "RESTRICTEDx1." },
        sourceClauseOrder: 2,
        sourceText: "You may negate a SUCCESSFUL effect.",
      },
    ],
    [1, 3],
  ),
  ...(
    [
      "race-trait-humans-where-there-s-life-there-s-hope",
      "race-trait-hybrid-saiyan-where-there-s-life-there-s-hope",
    ] as const
  ).map((id) =>
    overlay(id, [
      {
        trigger: "on-damage",
        target: "self",
        type: "roll-and-store",
        dice: 1,
        sides: 30,
        storageKey: `${id}-survival-roll`,
        conditions: [
          {
            type: "incoming-damage",
            subject: "self",
            comparison: "at-least",
            value: { type: "current-resource", subject: "self", resource: "hp" },
            sourceText: "Health drops below 0",
          },
        ],
        sourceClauseOrder: 1,
        sourceText:
          "When your Health drops below 0 for the first time in combat, you may roll 1d30.",
      },
      {
        trigger: "on-damage",
        target: "self",
        type: "modify-resource",
        resource: "hp",
        operation: "set",
        amount: { type: "literal", value: 1 },
        conditions: [
          {
            type: "stored-roll-threshold",
            storageKey: `${id}-survival-roll`,
            comparison: "at-least",
            value: { type: "literal", value: 10 },
            sourceText: "If the result is 10 or higher",
          },
        ],
        sourceClauseOrder: 2,
        sourceText: "If the result is 10 or higher, you may set your Health to 1.",
      },
    ]),
  ),
  overlay(
    "race-class-humans-will-of-iron",
    [
      {
        trigger: "on-power-up",
        target: "self",
        type: "end-floating-effect",
        selector: "self",
        sourceClauseOrder: 2,
        sourceText:
          "Restricted x1: Activate when powering up, you may pay 1 ki point to erase all negative floating effects on yourself.",
      },
    ],
    [1],
  ),
  overlay("race-class-androids-the-marvelous-wo-man-chine", [
    damageReduction(
      1,
      -10,
      "You take -10% damage from all sources and have a maximum Ki pool of 12.",
    ),
  ]),
  overlay("race-trait-konatsian-enhanced-hearing", [
    {
      ...attackRollModifier(
        1,
        "result",
        2,
        "Your attack rolls or defense rolls gain +2 to the results.",
      ),
    },
    defenseRollModifier(1, 2, "Your attack rolls or defense rolls gain +2 to the results."),
  ]),
  overlay("race-class-makaioshin-the-baddest-seed-of-the-kaiju-tree", [
    attackRollModifierForCost(2, 2, 1, "Attack rolls costing 2+ Ki gain +1 result."),
  ]),
  overlay("race-class-taifuu-jins-speed-demon", [
    gainKiWhenCombatOutcome(1, "stun", "Whenever you STUN, gain 1 Ki."),
    {
      trigger: "on-success",
      target: "self",
      type: "modify-resource",
      resource: "ki",
      operation: "gain",
      amount: { type: "literal", value: 1 },
      conditions: [
        {
          type: "combat-outcome",
          actor: "self",
          outcome: "stun",
          sourceText: "After a STUN",
        },
        {
          type: "move-selector",
          subject: "target",
          category: "advanced-attack",
          attackRoll: { dice: 1 },
          sourceText: "your next single-die attack",
        },
      ],
      sourceClauseOrder: 2,
      sourceText: "After a STUN, if your next single-die attack is successful, gain another 1 Ki.",
    },
  ]),
  overlay("race-class-taifuu-jins-grease-lightning", [
    statBonus(1, "dexterity-bonus", 2, "Runner"),
    {
      trigger: "upkeep-phase",
      target: "self",
      type: "set-stat-comparison",
      left: "self",
      stat: "dexterity",
      comparison: "higher-than",
      right: "opponent",
      duration: {
        type: "turns",
        turns: { type: "literal", value: 1 },
        sourceText: "until the next upkeep",
      },
      conditions: [
        {
          type: "stat-comparison",
          left: "self",
          stat: "dexterity-bonus",
          comparison: "higher-than",
          right: "opponent",
          rightStat: "dexterity-bonus",
          sourceText: "When your Dex Bonus exceeds opponent’s",
        },
      ],
      sourceClauseOrder: 2,
      sourceText: "When your Dex Bonus exceeds opponent’s, your Dexterity is treated as higher.",
    },
    successfulAttackStatus(
      2,
      "stun",
      "single-die attacks with base 1d32 or lower gain a 33+ SUCCESSFUL STUN effect.",
      [
        {
          type: "move-selector",
          subject: "target",
          category: "advanced-attack",
          attackRoll: { dice: 1, maximumSides: 32 },
          sourceText: "single-die attacks with base 1d32 or lower",
        },
        {
          type: "roll-threshold",
          roll: "attack",
          comparison: "at-least",
          value: { type: "literal", value: 33 },
          sourceText: "33+ SUCCESSFUL",
        },
      ],
    ),
  ]),
  overlay(
    "race-class-maguma-jin-hot-blooded-check-it-and-see",
    [
      {
        trigger: "on-power-up",
        target: "opponent",
        type: "modify-resource",
        resource: "ki",
        operation: "lose",
        amount: { type: "literal", value: 1 },
        conditions: [
          {
            type: "resource-comparison",
            resource: "ki",
            basis: "current",
            left: "self",
            comparison: "higher-than",
            right: "opponent",
            sourceText: "puts you above the opponent’s Ki total",
          },
        ],
        conflictPolicy: {
          type: "prevent-duplicate",
          sourceText: "It cannot trigger again until your Ki has first fallen below theirs.",
        },
        sourceClauseOrder: 1,
        sourceText:
          "When Powering Up puts you above the opponent’s Ki total, that opponent loses 1 Ki.",
      },
    ],
    [2],
  ),
  overlay("race-class-namek-warrior-clan", [
    {
      trigger: "passive",
      target: "self",
      type: "modify-damage",
      operation: "add",
      percent: {
        type: "stat-percent",
        subject: "self",
        stat: "power",
        percent: 5,
      },
      conditions: [
        {
          type: "action-sequence",
          actor: "self",
          result: "successful",
          count: 1,
          differentTurns: true,
          selector: {
            type: "move-selector",
            subject: "source",
            attackRoll: { dice: 1 },
            sourceText: "successful single-die attacks",
          },
          sourceText: "Consecutive successful single-die attacks",
        },
      ],
      cap: {
        type: "maximum",
        value: { type: "stat-percent", subject: "self", stat: "power", percent: 25 },
        sourceText: "capped +25%",
      },
      sourceClauseOrder: 2,
      sourceText: "Consecutive successful single-die attacks add +5% damage each, capped +25%.",
    },
  ]),
  overlay("race-class-saiyans-legendary-super-saiyan", [
    conditionalAttackDamage(
      2,
      5,
      "Later addendum treats the LSSJ as DESTROY POTENTIAL and gives +5% attack damage while below 50% Total HP.",
      [
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
            percent: 50,
          },
          sourceText: "below 50% Total HP",
        },
      ],
    ),
  ]),
  overlay("race-trait-androids-android-signature", [
    {
      trigger: "passive",
      target: "opponent",
      type: "prevent-roll-modification",
      roll: "attack",
      modifier: "sides",
      conditions: [
        {
          type: "level-comparison",
          left: "opponent",
          comparison: "higher-than",
          right: "self",
          difference: { type: "literal", value: 1 },
          sourceText: "their bukujutsu level is two levels higher than yours or lower",
        },
      ],
      sourceClauseOrder: 2,
      sourceText:
        "Your opponent does not gain bonus sides if their bukujutsu level is two levels higher than yours or lower.",
    },
  ]),
  overlay(
    "race-class-androids-annihilation-protocol",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-critical-threshold",
        threshold: { type: "literal", value: 30 },
        basis: "final-result",
        sourceClauseOrder: 3,
        sourceText: "This attack may CRITICAL with result modifications.",
      },
    ],
    [1],
  ),
  overlay("race-class-bio-androids-genetic-masterpiece", [
    {
      trigger: "action-phase",
      target: "opponent",
      type: "negate",
      aspects: ["prevent-attack"],
      sourceClauseOrder: 1,
      sourceText:
        "Your opponent's non-Mastery effects cannot prevent you from performing attacks on your turn, unless you are STUNNED.",
    },
  ]),
  overlay(
    "race-class-bio-androids-power-seeker",
    [
      attackSides(2, 1, "While Transformed, your attacks gain +1 dice side."),
      {
        trigger: "after-defense-roll",
        target: "opponent",
        type: "modify-roll",
        roll: "attack",
        modifier: "result",
        amount: { type: "literal", value: 5 },
        useLimit: { scope: "combat", count: 1, sourceText: "RESTRICTEDx1." },
        conditions: [
          {
            type: "move-selector",
            subject: "target",
            category: "advanced-attack",
            sourceText: "an Advanced Attack that you do not know",
          },
        ],
        sourceClauseOrder: 4,
        sourceText:
          "You may add +5 to your opponent's attack roll result on an Advanced Attack that you do not know.",
      },
      {
        trigger: "on-damage",
        target: "opponent",
        type: "modify-damage",
        operation: "add",
        percent: {
          type: "damage-percent",
          subject: "current-action",
          percent: -25,
        },
        conditions: [
          {
            type: "move-selector",
            subject: "target",
            category: "advanced-attack",
            sourceText: "that attack",
          },
        ],
        sourceClauseOrder: 5,
        sourceText: "Reduce the damage of that attack by 25%.",
      },
    ],
    [3, 6],
  ),
  overlay("race-class-majins-average-pink-blob", [
    {
      trigger: "passive",
      target: "self",
      type: "modify-roll",
      roll: "defense",
      modifier: "sides",
      amount: { type: "literal", value: 2 },
      sourceClauseOrder: 1,
      sourceText: "dice +2 sides",
    },
    firstAttackCostReduction(1, "first physical attack each match costs -1 Ki, minimum 1."),
  ]),
  overlay("race-trait-majins-regeneration", [
    {
      trigger: "on-combat-result",
      target: "self",
      type: "modify-resource",
      resource: "hp",
      operation: "gain",
      amount: {
        type: "resource-percent",
        subject: "self",
        resource: "hp",
        basis: "total",
        percent: 100,
      },
      conditions: [
        {
          type: "combat-outcome",
          actor: "self",
          outcome: "sever",
          sourceText: "SEVER heals immediately",
        },
      ],
      sourceClauseOrder: 1,
      sourceText:
        "SEVER heals immediately; RESTRICTEDx1 allows skipping a turn to negate one BREAK; RECOVER is increased by 5% Total HP.",
    },
    {
      trigger: "passive",
      target: "self",
      type: "prevent-status",
      statusId: "break",
      sourceClauseOrder: 1,
      sourceText: "RESTRICTEDx1 allows skipping a turn to negate one BREAK.",
    },
  ]),
  overlay(
    "race-trait-shamoians-size-matters",
    [
      {
        trigger: "passive",
        target: "self",
        type: "modify-roll",
        roll: "defense",
        modifier: "sides",
        amount: { type: "literal", value: 1 },
        sourceClauseOrder: 1,
        sourceText: "Defense rolls +1 die side",
      },
    ],
    [2],
  ),
  overlay("race-class-konatsian-paladin", [
    firstDefenseRollBonus(2, "You first defense roll of the match gains +3 to the result."),
    {
      trigger: "before-defense-roll",
      target: "self",
      type: "prevent-resolution",
      prevention: "block",
      selector: {
        type: "move-selector",
        subject: "target",
        attackRoll: { dice: 1 },
        sourceText: "first single dice attack of the match",
      },
      useLimit: { scope: "combat", count: 1, sourceText: "first ... attack of the match" },
      sourceClauseOrder: 1,
      sourceText: "Your first single dice attack of the match is UNBLOCKABLE.",
    },
    {
      trigger: "on-success",
      target: "self",
      type: "activate",
      selector: {
        type: "move-selector",
        subject: "source",
        category: "skill",
        constant: true,
        sourceText: "one of your Constant Skills",
      },
      selectionSpec: { type: "one" },
      optional: true,
      sourceClauseOrder: 1,
      sourceText: "SUCCESSFUL - You may activate one of your Constant Skills",
    },
  ]),
  overlay("race-trait-makaioshin-petrifying-spit", [
    successfulAttackStatus(
      1,
      "stun",
      "RESTRICTEDx1 after a successful single-die attack: pay 1 Ki to STUN.",
      [
        {
          type: "move-selector",
          subject: "target",
          attackRoll: { dice: 1 },
          sourceText: "successful single-die attack",
        },
      ],
      {
        timing: "activation",
        resource: "ki",
        amount: { type: "literal", value: 1 },
        operation: "lose",
      },
      { scope: "combat", count: 1, sourceText: "RESTRICTEDx1" },
    ),
    {
      trigger: "on-success",
      target: "opponent",
      type: "prevent-resolution",
      prevention: "block",
      scope: { type: "next-turn", subject: "self", sourceText: "If you attack next turn" },
      sourceClauseOrder: 2,
      sourceText: "If you attack next turn, the opponent cannot BLOCK.",
    },
    {
      trigger: "on-success",
      target: "opponent",
      type: "modify-roll",
      roll: "defense",
      modifier: "result",
      amount: { type: "literal", value: -5 },
      scope: { type: "next-turn", subject: "self", sourceText: "If you attack next turn" },
      sourceClauseOrder: 2,
      sourceText: "If you attack next turn, the opponent ... suffers -5 defensive result.",
    },
  ]),
  overlay("race-trait-maguma-jin-maguma-pressure", [
    {
      trigger: "passive",
      target: "opponent",
      type: "modify-cost",
      operation: "add",
      amount: { type: "literal", value: 1 },
      sourceClauseOrder: 1,
      sourceText: "Opponents pay +1 Ki when a non-damage effect costs or loses Ki.",
    },
  ]),
  overlay("race-class-changeling-power-hungerer", [
    {
      trigger: "upkeep-phase",
      target: "self",
      type: "modify-roll",
      roll: "transformation",
      modifier: "dice",
      amount: { type: "literal", value: 1 },
      sourceClauseOrder: 1,
      sourceText:
        "When your opponent transforms in a Battle, you gain an additional +1d10 to your Transformation roll from that Battle.",
    },
    {
      trigger: "on-roll-result",
      target: "self",
      type: "modify-resource",
      resource: "ki",
      operation: "gain",
      amount: { type: "literal", value: 2 },
      sourceClauseOrder: 2,
      sourceText: "When your opponent transforms in Battle, you gain +2 KI Points.",
    },
  ]),
  overlay("race-trait-kaizoku-jin-chou-no-ryoku", [
    successfulAttackStatus(
      1,
      "stun",
      "When using a single dice attacks with a base roll of 32 or lower, if your attack roll is 27 or higher, you may lose 1 KI Point to STUN your opponent.",
      [
        {
          type: "move-selector",
          subject: "target",
          attackRoll: { dice: 1, maximumSides: 32 },
          sourceText: "single dice attacks with a base roll of 32 or lower",
        },
        {
          type: "roll-threshold",
          roll: "attack",
          comparison: "at-least",
          value: { type: "literal", value: 27 },
          sourceText: "attack roll is 27 or higher",
        },
      ],
      {
        timing: "activation",
        resource: "ki",
        amount: { type: "literal", value: 1 },
        operation: "lose",
      },
    ),
  ]),
  overlay("race-class-kaizoku-jin-string-theorist", [
    {
      trigger: "on-success",
      target: "opponent",
      type: "modify-resource",
      resource: "hp",
      operation: "lose",
      amount: { type: "stat-percent", subject: "self", stat: "power", percent: 10 },
      conditions: [
        {
          type: "roll-threshold",
          roll: "attack",
          comparison: "at-least",
          value: { type: "literal", value: 25 },
          sourceText: "activated on a 25 or higher",
        },
      ],
      sourceClauseOrder: 1,
      sourceText:
        "Chou No Ryoku can be activated on a 25 or higher and deals (10% power)HP damage to the target.",
    },
  ]),
  overlay(
    "race-class-hybrid-saiyan-ruthless-brawler",
    [
      resourceThresholdGain(
        1,
        "hp",
        "at-most",
        50,
        3,
        "Gain 3 Ki Points when you fall below (50% HP).",
      ),
      {
        trigger: "on-success",
        target: "self",
        type: "prevent-low-roll-stop",
        roll: "defense",
        comparison: "at-most",
        value: { type: "literal", value: 12 },
        scope: { type: "next-action", sourceText: "Your Punch-Type and Kick-Type attacks" },
        conditions: [
          {
            type: "move-selector",
            subject: "target",
            tags: ["punch", "kick"],
            sourceText: "Punch-Type and Kick-Type attacks",
          },
        ],
        sourceClauseOrder: 2,
        sourceText:
          "Your Punch-Type and Kick-Type attacks cannot be STOPPED by a defensive roll of 12 or less.",
      },
    ],
    [3, 4, 5],
  ),
  overlay("race-class-hybrid-saiyan-mixed-blood-potential", [
    {
      trigger: "upkeep-phase",
      target: "self",
      type: "modify-roll",
      roll: "transformation",
      modifier: "sides",
      amount: { type: "literal", value: 30 },
      sourceClauseOrder: 1,
      sourceText: "Your Transformation Rolls all begin at 1d50.",
    },
    {
      trigger: "action-phase",
      target: "self",
      type: "grant-transformation-action",
      turnCost: "none",
      scope: { type: "next-action", sourceText: "without spending your turn" },
      sourceClauseOrder: 2,
      sourceText: "You may transform without spending your turn.",
    },
  ]),
  overlay("transformation-humans-1-high-tension:novice", [advancedAttackSlot(1, highTensionSlot)]),
  overlay("transformation-humans-1-high-tension:intermediate", [
    advancedAttackSlot(1, highTensionSlot),
    attackDamage(3, 5, fivePercentDamage),
  ]),
  overlay("transformation-humans-1-high-tension:mastered", [
    transformationStability(
      0,
      "You do not have to roll a Transformation Roll to stay in this form.",
    ),
    advancedAttackSlot(2, highTensionSlot),
    attackDamage(4, 5, fivePercentDamage),
  ]),
  overlay("transformation-humans-2-super-human:novice", [
    advancedAttackSlot(1, highTensionSlot),
    attackDamage(3, 5, fivePercentDamage),
  ]),
  overlay("transformation-humans-2-super-human:intermediate", [
    transformationStability(
      0,
      "You do not have to roll a Transformation Roll to stay in this form.",
    ),
    advancedAttackSlot(2, highTensionSlot),
    attackDamage(4, 5, fivePercentDamage),
  ]),
  overlay("transformation-humans-2-super-human:mastered", [
    transformationStability(
      0,
      "You do not have to roll a Transformation Roll to stay in this form.",
    ),
    advancedAttackSlot(2, highTensionSlot),
    attackDamage(5, 5, fivePercentDamage),
  ]),
  overlay("transformation-humans-3-unlocked-potential:novice", [
    transformationStability(
      0,
      "You do not have to roll a Transformation Roll to stay in this form.",
    ),
    advancedAttackSlot(2, highTensionSlot),
    attackDamage(4, 5, fivePercentDamage),
  ]),
  overlay("transformation-humans-3-unlocked-potential:intermediate", [
    transformationStability(
      0,
      "You do not have to roll a Transformation Roll to stay in this form.",
    ),
    advancedAttackSlot(2, highTensionSlot),
    attackDamage(5, 5, fivePercentDamage),
  ]),
  overlay("transformation-humans-3-unlocked-potential:mastered", [
    transformationStability(
      0,
      "You do not have to roll a Transformation Roll to stay in this form.",
    ),
    advancedAttackSlot(2, highTensionSlot),
    attackDamage(5, 5, fivePercentDamage),
  ]),
  overlay("transformation-humans-4-mythic-form:novice", [
    transformationStability(
      0,
      "You do not have to roll a Transformation Roll to stay in this form.",
    ),
    advancedAttackSlot(2, "You gain +2 Advanced Attack slots."),
    attackDamage(4, 10, tenPercentDamage),
  ]),
  overlay("transformation-humans-4-mythic-form:intermediate", [
    transformationStability(
      0,
      "You do not have to roll a Transformation Roll to stay in this form.",
    ),
    advancedAttackSlot(2, "You gain +2 Advanced Attack slots."),
    attackDamage(5, 10, tenPercentDamage),
  ]),
  overlay("transformation-humans-4-mythic-form:mastered", [
    transformationStability(
      0,
      "You do not have to roll a Transformation Roll to stay in this form.",
    ),
    advancedAttackSlot(2, "You gain +3 Advanced Attack slots."),
    attackDamage(5, 10, tenPercentDamage),
  ]),
  ...(
    [
      "transformation-bio-androids-1-semi-perfect-form",
      "transformation-bio-androids-2-perfect-form",
    ] as const
  ).flatMap((id) =>
    (["novice", "intermediate", "mastered"] as const).map((mastery) =>
      overlay(`${id}:${mastery}`, [
        styleClassification(
          1,
          "All of your attacks count as Martial Arts Styled attacks, matching your declared Style.",
        ),
      ]),
    ),
  ),
  overlay("transformation-hybrid-saiyan-1-high-tension:novice", [
    advancedAttackSlot(1, "You gain +1 Advanced Attack slot."),
  ]),
  overlay("transformation-hybrid-saiyan-1-high-tension:intermediate", [
    advancedAttackSlot(1, "You gain +1 Advanced Attack slot."),
    attackDamage(2, 2, "Your attacks do +(2% Power) Damage."),
  ]),
  overlay("transformation-hybrid-saiyan-1-high-tension:mastered", [
    transformationStability(
      0,
      "You do not have to roll a Transformation Roll to stay in this form.",
    ),
    advancedAttackSlot(2, "You gain +1 Advanced Attack slot."),
    attackDamage(3, 2, "Your attacks do +(2% Power) Damage."),
  ]),
  ...(["novice", "intermediate", "mastered"] as const).map((mastery) => {
    const rollResult = mastery === "novice" ? 1 : 2;
    const rollSides = mastery === "novice" ? 1 : 2;
    const attackSlotText = "You gain +2 Advanced Attack slots.";
    const rollText = `You may have your attack roll gain +${rollSides} dice sides and +${rollResult} to the results.`;
    return overlay(
      `transformation-hybrid-saiyan-4-ascended-super-saiyan-2:${mastery}`,
      [
        advancedAttackSlot(1, attackSlotText),
        attackRollModifier(3, "sides", rollSides, rollText, 1),
        attackRollModifier(3, "result", rollResult, rollText, 1),
        preventSever(4, "You cannot SEVER with that roll."),
        attackDamage(5, 5, fivePercentDamage),
      ],
      [2],
    );
  }),
  overlay("transformation-saiyans-1-oozaru:novice", [
    damageReduction(1, -20, "Opponent physical attacks -20% damage."),
    ...oozaruForcedAction(
      "saiyans-oozaru-novice",
      "On your turn, roll 1d2; on 2, randomly select an Advanced Attack and use it or pass.",
      { roll: 2, select: 2, force: 2 },
    ),
  ]),
  overlay("transformation-saiyans-1-oozaru:intermediate", [
    damageReduction(1, -25, "Physical damage reduction becomes -25%; random-attack rule remains."),
    ...oozaruForcedAction(
      "saiyans-oozaru-intermediate",
      "On your turn, roll 1d2; on 2, randomly select an Advanced Attack and use it or pass.",
      { roll: 1, select: 1, force: 1 },
    ),
  ]),
  overlay("transformation-saiyans-1-oozaru:mastered", [
    damageReduction(1, -25, "Physical attacks -25%; your attacks +5% Power damage."),
    attackDamage(1, 5, "Physical attacks -25%; your attacks +5% Power damage."),
  ]),
  overlay("transformation-hybrid-saiyan-1-oozaru:novice", [
    damageReduction(1, -20, "Your opponent's physical attacks do -20% Damage against you."),
    ...oozaruForcedAction(
      "hybrid-oozaru-novice",
      "On your turn, roll 1d2; on 2, randomly select an Advanced Attack and use it or pass.",
      { roll: 2, select: 4, force: 5 },
    ),
  ]),
  overlay("transformation-hybrid-saiyan-1-oozaru:intermediate", [
    damageReduction(1, -25, "Your opponent's physical attacks do -25% Damage against you."),
    ...oozaruForcedAction(
      "hybrid-oozaru-intermediate",
      "On your turn, roll 1d2; on 2, randomly select an Advanced Attack and use it or pass.",
      { roll: 2, select: 4, force: 5 },
    ),
  ]),
  overlay("transformation-hybrid-saiyan-1-oozaru:mastered", [
    damageReduction(1, -25, "Your opponent's physical attacks do -25% Damage against you."),
    attackDamage(1, 5, "Your attacks do +(5% Power) Damage."),
  ]),
  ...(
    [
      "transformation-saiyans-2-super-saiyan",
      "transformation-hybrid-saiyan-2-super-saiyan",
    ] as const
  ).flatMap((id) => [
    overlay(
      `${id}:novice`,
      [
        attackRollModifier(
          1,
          "result",
          1,
          "May add +1 attack result; that roll cannot SEVER; multi-die only first die gains it.",
          1,
        ),
        preventSever(2, "You cannot SEVER with that roll."),
        attackDamage(1, 5, "Attacks +5% Power damage."),
      ],
      [3],
    ),
    overlay(
      `${id}:intermediate`,
      [
        attackRollModifier(
          1,
          "result",
          2,
          "Bonus becomes +2 result; may instead enter Ultra Super Saiyan at +65% Power, +45% HP, -10% Dexterity. +5% damage.",
          1,
        ),
        preventSever(2, "You cannot SEVER with that roll."),
        attackDamage(
          1,
          5,
          "Bonus becomes +2 result; may instead enter Ultra Super Saiyan at +65% Power, +45% HP, -10% Dexterity. +5% damage.",
        ),
      ],
      [3, 5],
    ),
    overlay(
      `${id}:mastered`,
      [
        attackRollModifier(
          1,
          "result",
          2,
          "+2 result; +5% damage; Advanced Attacks with base cost 4+ cost -1 Ki, including normally unmodifiable costs. | USS option remains.",
          1,
        ),
        preventSever(2, "You cannot SEVER with that roll."),
        attackDamage(
          1,
          5,
          "+2 result; +5% damage; Advanced Attacks with base cost 4+ cost -1 Ki, including normally unmodifiable costs. | USS option remains.",
        ),
        unmodifiableAttackCostReduction(
          1,
          "Advanced Attacks with a base cost of 4 or more cost -1 KI Point to perform.",
        ),
      ],
      [3, 6],
    ),
  ]),
  ...(
    [
      "transformation-saiyans-3-super-saiyan-2",
      "transformation-hybrid-saiyan-3-super-saiyan-2",
    ] as const
  ).flatMap((id) => [
    overlay(
      `${id}:novice`,
      [
        attackRollModifier(
          1,
          "sides",
          1,
          "Attack roll may gain +1 side and +1 result; cannot SEVER with that roll; multi-die bonus applies to first die. +5% damage.",
          1,
        ),
        attackRollModifier(
          1,
          "result",
          1,
          "Attack roll may gain +1 side and +1 result; cannot SEVER with that roll; multi-die bonus applies to first die. +5% damage.",
          1,
        ),
        preventSever(2, "You cannot SEVER with that roll."),
        attackDamage(
          1,
          5,
          "Attack roll may gain +1 side and +1 result; cannot SEVER with that roll; multi-die bonus applies to first die. +5% damage.",
        ),
      ],
      [3],
    ),
    overlay(
      `${id}:intermediate`,
      [
        attackRollModifier(
          1,
          "sides",
          2,
          "+2 sides and +1 result; multi-die first result receives the stated bonus; +5% damage.",
          1,
        ),
        attackRollModifier(
          1,
          "result",
          1,
          "+2 sides and +1 result; multi-die first result receives the stated bonus; +5% damage.",
          1,
        ),
        preventSever(2, "You cannot SEVER with that roll."),
        attackDamage(
          1,
          5,
          "+2 sides and +1 result; multi-die first result receives the stated bonus; +5% damage.",
        ),
      ],
      [3],
    ),
    overlay(
      `${id}:mastered`,
      [
        attackRollModifier(
          1,
          "sides",
          2,
          "+2 sides and +2 result; multi-die first die gains the bonus; +5% damage; Advanced base-cost 4+ costs -1 Ki.",
          1,
        ),
        attackRollModifier(
          1,
          "result",
          2,
          "+2 sides and +2 result; multi-die first die gains the bonus; +5% damage; Advanced base-cost 4+ costs -1 Ki.",
          1,
        ),
        preventSever(2, "You cannot SEVER with that roll."),
        attackDamage(
          1,
          5,
          "+2 sides and +2 result; multi-die first die gains the bonus; +5% damage; Advanced base-cost 4+ costs -1 Ki.",
        ),
        unmodifiableAttackCostReduction(1, "Advanced base-cost 4+ costs -1 Ki."),
      ],
      [3, 6],
    ),
  ]),
  overlay("transformation-saiyans-4-super-saiyan-3:novice", [
    attackRollModifier(
      1,
      "sides",
      1,
      "Attack roll gains +1 side/result modification; multi-die first die only; attacks +10% Power damage.",
      1,
    ),
    attackRollModifier(
      1,
      "result",
      1,
      "Attack roll gains +1 side/result modification; multi-die first die only; attacks +10% Power damage.",
      1,
    ),
    attackDamage(
      1,
      10,
      "Attack roll gains +1 side/result modification; multi-die first die only; attacks +10% Power damage.",
    ),
  ]),
  overlay("transformation-saiyans-4-super-saiyan-3:intermediate", [
    attackRollModifier(
      1,
      "sides",
      2,
      "Up to +2 sides and +1 result; multi-die benefit expands as listed; +10% damage.",
      1,
    ),
    attackRollModifier(
      1,
      "result",
      1,
      "Up to +2 sides and +1 result; multi-die benefit expands as listed; +10% damage.",
      1,
    ),
    attackDamage(
      1,
      10,
      "Up to +2 sides and +1 result; multi-die benefit expands as listed; +10% damage.",
    ),
  ]),
  overlay(
    "transformation-saiyans-4-super-saiyan-3:mastered",
    [
      attackRollModifier(
        1,
        "sides",
        2,
        "+2 sides and/or +2 result; first two dice receive the listed bonus; +10% damage; attacks with base cost 4+ cost -1 Ki.",
        1,
      ),
      attackRollModifier(
        1,
        "result",
        2,
        "+2 sides and/or +2 result; first two dice receive the listed bonus; +10% damage; attacks with base cost 4+ cost -1 Ki.",
        1,
      ),
      attackDamage(
        1,
        10,
        "+2 sides and/or +2 result; first two dice receive the listed bonus; +10% damage; attacks with base cost 4+ cost -1 Ki.",
      ),
      unmodifiableAttackCostReduction(1, "attacks with base cost 4+ cost -1 Ki."),
    ],
    [6],
  ),
  overlay("transformation-namek-1-giant-form:novice", [
    damageReduction(
      1,
      -10,
      "Opponent physical attacks -10% damage; Meditative Preparation is lost in form.",
    ),
  ]),
  overlay("transformation-namek-1-giant-form:intermediate", [
    damageReduction(
      1,
      -15,
      "Physical attacks against you -15%; your attacks +5% Power damage; Meditative Preparation lost.",
    ),
    attackDamage(
      1,
      5,
      "Physical attacks against you -15%; your attacks +5% Power damage; Meditative Preparation lost.",
    ),
  ]),
  overlay("transformation-namek-1-giant-form:mastered", [
    damageReduction(
      1,
      -15,
      "Physical attacks against you -15%; your attacks +5% Power damage; Meditative Preparation no longer removed.",
    ),
    attackDamage(
      1,
      5,
      "Physical attacks against you -15%; your attacks +5% Power damage; Meditative Preparation no longer removed.",
    ),
  ]),
  ...(
    [
      "transformation-namek-2-super-namek",
      "transformation-namek-3-soul-alignment",
      "transformation-namek-4-planetary-master",
    ] as const
  ).flatMap((id) => [
    overlay(
      `${id}:novice`,
      [
        damageReduction(
          1,
          id.endsWith("planetary-master") ? -15 : -10,
          "Opponent attacks -10% damage; Power Up gives opponent next attack -1 result.",
        ),
        powerUpAttackPenalty(
          1,
          1,
          "Opponent attacks -10% damage; Power Up gives opponent next attack -1 result.",
        ),
      ],
      [1],
    ),
    overlay(`${id}:intermediate`, [
      damageReduction(
        1,
        id.endsWith("planetary-master") ? -15 : -10,
        "Same, next attack -2 result.",
      ),
      powerUpAttackPenalty(1, 2, "Same, next attack -2 result."),
    ]),
    overlay(`${id}:mastered`, [
      damageReduction(1, -15, "Same -10% and -4."),
      powerUpAttackPenalty(1, 4, "Same -10% and -4."),
    ]),
  ]),
  ...(
    [
      "transformation-bio-androids-3-buff-perfect-form",
      "transformation-bio-androids-4-super-perfect-form",
    ] as const
  ).flatMap((id) =>
    (["novice", "intermediate", "mastered"] as const).map((mastery) =>
      overlay(
        `${id}:${mastery}`,
        [
          styleClassification(
            1,
            "All of your attacks count as Martial Arts Styled attacks, matching your declared Style.",
          ),
          attackDamage(6, 5, "Your attacks do +(5% Power) Damage."),
          copiedRollSides(
            7,
            id.endsWith("super-perfect-form") ? 2 : 1,
            id.endsWith("super-perfect-form")
              ? "Your copied attacks gain +2 dice sides."
              : "Your copied attacks gain +1 dice side.",
            "attack",
          ),
          ...(id.endsWith("super-perfect-form")
            ? [
                copiedRollSides(
                  8,
                  mastery === "mastered" ? 2 : 1,
                  mastery === "mastered"
                    ? "You gain +2 dice sides to your defense rolls against your copied attacks."
                    : "You gain +1 dice side to your defense rolls against your copied attacks.",
                  "defense",
                ),
              ]
            : []),
        ],
        [2, 3, 4, 5, 8],
      ),
    ),
  ),
  ...(
    [
      "transformation-changeling-1-form-2",
      "transformation-changeling-2-form-3",
      "transformation-changeling-3-final-form",
      "transformation-changeling-4-golden-form",
    ] as const
  ).flatMap((id) => {
    let threshold: readonly number[];
    let sides: readonly (number | undefined)[];
    if (id.endsWith("form-2")) {
      threshold = [26, 25, 24];
      sides = [undefined, undefined, undefined];
    } else if (id.endsWith("form-3")) {
      threshold = [24, 24, 23];
      sides = [undefined, 1, 2];
    } else if (id.endsWith("final-form")) {
      threshold = [23, 22, 22];
      sides = [2, 2, 2];
    } else {
      threshold = [21, 21, 20];
      sides = [2, 3, 3];
    }
    return (["novice", "intermediate", "mastered"] as const).map((mastery, index) =>
      overlay(
        `${id}:${mastery}`,
        [
          stoppedAttackCost(
            1,
            threshold[index],
            `Whenever you STOP an attack with a Block or a defense roll of ${threshold[index]} or higher, that attack costs +1 KI Point the next time your opponent uses it.`,
          ),
          ...nextAttackDamage(
            2,
            "Whenever your opponent STOPS one of your attacks, your next attack does +(5% Power) Damage.",
            sides[index],
          ),
        ],
        [1, 2, 3, 4],
      ),
    );
  }),
  overlay(
    "race-class-humans-monk",
    [
      {
        trigger: "passive",
        target: "opponent",
        type: "set-resolution-threshold",
        outcome: "stop",
        roll: "defense",
        comparison: "at-least",
        value: { type: "literal", value: 10 },
        sourceClauseOrder: 2,
        sourceText:
          "Whenever you COUNTER, your opponent must have a defensive roll of 10 or more to STOP your attack.",
      },
    ],
    [1, 3],
  ),
  overlay(
    "race-class-konatsian-konatsian-wizard",
    [
      {
        trigger: "passive",
        target: "self",
        type: "override-skill-activation-prevention",
        duration: {
          type: "turns",
          turns: { type: "literal", value: 5 },
          sourceText: "combat",
        },
        sourceClauseOrder: 1,
        sourceText:
          "Nothing can increase the cost of your Skills or prevent you from using your Skills.",
      },
    ],
    [2, 3],
  ),
  overlay(
    "race-class-makaioshin-meditative-evil",
    [
      {
        trigger: "action-phase",
        target: "self",
        type: "modify-resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: 2 },
        conditions: [
          {
            type: "resource-threshold",
            subject: "self",
            resource: "ki",
            basis: "current",
            comparison: "at-most",
            value: { type: "literal", value: 0 },
            sourceText: "at 0 Ki",
          },
        ],
        useLimit: { scope: "combat", count: 1, sourceText: "RESTRICTEDx1." },
        sourceClauseOrder: 2,
        sourceText: "RESTRICTEDx1 at 0 Ki: gain 2 Ki without using the turn.",
      },
    ],
    [1],
  ),
  overlay(
    "race-class-makaioshin-feared-by-the-gods",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "revert-transformation",
        conditions: [
          {
            type: "combat-state",
            subject: "opponent",
            state: "transformed",
            sourceText: "opponent transformation",
          },
          {
            type: "roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 10 },
            sourceText: "even with 1d100",
          },
        ],
        sourceClauseOrder: 2,
        sourceText:
          "RESTRICTEDx1: revert opponent one transformation level without using your turn.",
        useLimit: { scope: "combat", count: 1, sourceText: "RESTRICTEDx1." },
      },
    ],
    [1],
  ),
  overlay(
    "race-class-tuffles-guerrilla-tactics",
    [
      {
        trigger: "start-combat",
        target: "opponent",
        type: "modify-resource",
        resource: "ki",
        operation: "lose",
        amount: { type: "literal", value: 2 },
        sourceClauseOrder: 1,
        sourceText: "When you initiate Battle, opponent starts -2 Ki.",
      },
    ],
    [2],
  ),
  overlay("race-class-wizards-war-mage", [
    {
      trigger: "on-success",
      target: "self",
      type: "modify-damage",
      operation: "add",
      percent: { type: "damage-percent", subject: "current-action", percent: 10 },
      scope: { type: "next-action", sourceText: "the next Energy attack" },
      selector: {
        type: "move-selector",
        subject: "source",
        tags: ["energy"],
        sourceText: "the next Energy attack",
      },
      sourceClauseOrder: 1,
      sourceText:
        "Physical attacks gain a SUCCESSFUL effect making the next Energy attack +10% Power damage.",
    },
    {
      trigger: "on-success",
      target: "self",
      type: "modify-cost",
      operation: "add",
      amount: { type: "literal", value: -1 },
      minimum: { type: "literal", value: 1 },
      scope: { type: "next-action", sourceText: "the next physical attack" },
      selector: {
        type: "move-selector",
        subject: "source",
        tags: ["physical"],
        sourceText: "the next physical attack",
      },
      sourceClauseOrder: 1,
      sourceText:
        "Energy attacks gain a SUCCESSFUL effect making the next physical attack cost -1 Ki, minimum 1.",
    },
  ]),
  overlay("race-trait-makaioshin-demonic-potential", [
    {
      trigger: "start-combat",
      target: "self",
      type: "roll-and-store",
      dice: 1,
      sides: 10,
      storageKey: "demonic-potential-start-roll",
      sourceClauseOrder: 1,
      sourceText: "At match start roll 1d10; 5+ allows starting at 10 Ki.",
    },
    {
      trigger: "start-combat",
      target: "self",
      type: "modify-resource",
      resource: "ki",
      operation: "set",
      amount: { type: "literal", value: 10 },
      conditions: [
        {
          type: "stored-roll-threshold",
          storageKey: "demonic-potential-start-roll",
          comparison: "at-least",
          value: { type: "literal", value: 5 },
          sourceText: "5+",
        },
      ],
      sourceClauseOrder: 1,
      sourceText: "At match start roll 1d10; 5+ allows starting at 10 Ki.",
    },
    {
      trigger: "passive",
      target: "self",
      type: "prevent-resource-modification",
      resource: "ki",
      operation: "lose",
      sourceActor: "opponent",
      sourceClauseOrder: 2,
      sourceText: "Opponents cannot reduce starting Ki.",
    },
    {
      trigger: "on-power-up",
      target: "self",
      type: "modify-resource",
      resource: "ki",
      operation: "gain",
      amount: { type: "literal", value: 5 },
      sourceClauseOrder: 3,
      sourceText: "If delayed, gain 5 Ki when it activates.",
    },
  ]),
  overlay("race-class-kaizoku-jin-known-throughout-the-galaxies", [], [2]),
  overlay(
    "race-class-konatsian-konatsian-wizard",
    [
      {
        trigger: "passive",
        target: "self",
        type: "override-skill-activation-prevention",
        duration: {
          type: "turns",
          turns: { type: "literal", value: 5 },
          sourceText: "combat",
        },
        sourceClauseOrder: 1,
        sourceText:
          "Nothing can increase the cost of your Skills or prevent you from using your Skills.",
      },
      {
        trigger: "before-defense-roll",
        target: "self",
        type: "prevent-resolution",
        prevention: "stop",
        selector: {
          type: "move-selector",
          subject: "target",
          category: "advanced-attack",
          restriction: "unrestricted",
          sourceText: "Konats Ocarinas",
        },
        conditions: [
          {
            type: "roll-threshold",
            roll: "defense",
            comparison: "at-most",
            value: { type: "literal", value: 15 },
            sourceText: "with a roll of 15 or less",
          },
        ],
        sourceClauseOrder: 3,
        sourceText: "Your Konats Ocarinas stop UNRESTRICTED attacks with a roll of 15 or less.",
      },
    ],
    [2],
  ),
  overlay(
    "race-class-majins-fatty-fatty-2x4",
    [
      {
        trigger: "on-stopped",
        target: "opponent",
        type: "modify-resource",
        resource: "ki",
        operation: "lose",
        amount: { type: "literal", value: 1 },
        conditions: [
          {
            type: "combat-result",
            actor: "self",
            result: "stopped",
            sourceText: "stopping a SEVER/BREAK attack",
          },
        ],
        sourceClauseOrder: 2,
        sourceText: "Stopping a SEVER/BREAK attack makes the opponent lose 1 Ki.",
      },
    ],
    [1],
  ),
  overlay(
    "race-class-majins-thin-is-in",
    [
      {
        trigger: "before-defense-roll",
        target: "self",
        type: "modify-roll",
        roll: "defense",
        modifier: "sides",
        amount: { type: "literal", value: 2 },
        sourceClauseOrder: 2,
        sourceText: "Defensive dice +2 sides.",
      },
    ],
    [1],
  ),
  overlay("race-class-namek-dragon-clan", [], [1]),
  overlay(
    "race-class-tuffles-guerrilla-tactics",
    [
      {
        trigger: "before-defense-roll",
        target: "opponent",
        type: "set-roll-result",
        roll: "defense",
        value: { type: "literal", value: 10 },
        resultScope: "matching-die",
        conditions: [
          {
            type: "roll-threshold",
            roll: "defense",
            comparison: "at-most",
            value: { type: "literal", value: 6 },
            sourceText: "defense results 6 or less",
          },
        ],
        sourceClauseOrder: 2,
        sourceText: "If their Level is lower, defense results 6 or less are treated as 10.",
      },
    ],
    [1],
  ),
  overlay(
    "race-class-shikirian-eager-to-advance",
    [
      {
        trigger: "passive",
        target: "self",
        type: "prevent-move-modification",
        actor: "opponent",
        aspects: ["cost", "damage", "dice-sides", "effects", "roll-results"],
        selector: {
          type: "move-selector",
          subject: "target",
          sourceText: "your costs and effects",
        },
        conditions: [
          {
            type: "resource-comparison",
            resource: "ki",
            basis: "current",
            left: "self",
            comparison: "higher-than",
            right: "opponent",
            sourceText: "more Ki than any opponent",
          },
        ],
        sourceClauseOrder: 2,
        sourceText:
          "While you have more Ki than any opponent, opponents cannot manipulate your costs/effects.",
      },
      {
        trigger: "on-resource-gain",
        target: "opponent",
        type: "modify-resource",
        resource: "ki",
        operation: "lose",
        amount: { type: "literal", value: 1 },
        sourceClauseOrder: 3,
        sourceText:
          "When a transformation effect grants you Ki, choose an opponent to lose the same amount.",
      },
    ],
    [1],
  ),
  overlay(
    "race-class-tuffles-tuffle-avenger",
    [
      {
        trigger: "on-success",
        target: "opponent",
        type: "skip-action",
        blockedCategories: ["basic-attack", "advanced-attack", "signature"],
        scope: { type: "next-turn", subject: "opponent", sourceText: "opponent's next attack" },
        sourceClauseOrder: 3,
        sourceText:
          "RESTRICTEDx1 choose opponent's next attack, preventing other moves/effects that turn.",
      },
    ],
    [1, 2],
  ),
];

export const INNATE_ABILITY_OVERLAY_BY_ID = new Map(
  INNATE_ABILITY_OVERLAYS.map((entry) => [entry.sourceDefinitionId, entry]),
);
