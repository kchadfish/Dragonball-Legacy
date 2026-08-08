import type {
  ATTACK_TAG,
  ATTACK_TYPE,
  ITEM_CATEGORY,
  LOCATION_TYPE,
  MOVE_CATEGORY,
  STATUS_STACKING,
  TRANSFORMATION_MASTERY,
} from "./constants.js";
import type { EffectDefinition } from "./effects.js";
import type {
  ItemId,
  LocationId,
  MoveId,
  NpcId,
  QuestId,
  RaceId,
  StatusId,
  StyleId,
  TransformationId,
} from "./ids.js";
import type { Requirement } from "./requirements.js";

export interface SourceReference {
  readonly path: string;
  readonly text: string;
}

export interface MoveDefinition {
  readonly id: MoveId;
  readonly name: string;
  readonly styleId?: StyleId;
  readonly category: (typeof MOVE_CATEGORY)[keyof typeof MOVE_CATEGORY];
  readonly tags: readonly (typeof ATTACK_TAG)[keyof typeof ATTACK_TAG][];
  readonly description: string;
  readonly effectText: string;
  readonly effectClauses: readonly EffectClauseDefinition[];
  readonly mechanics: MoveMechanics;
  readonly kiCost?: number;
  readonly restrictedUses?: number;
  readonly attack?: {
    readonly type: (typeof ATTACK_TYPE)[keyof typeof ATTACK_TYPE];
    readonly dice?: { readonly count: number; readonly sides: number };
    readonly powerPercent?: number;
  };
  readonly requirements?: readonly Requirement[];
  readonly effects?: readonly EffectDefinition[];
  readonly trainingDays?: number;
  readonly source: SourceReference;
}

export interface MoveSourceDefinition {
  readonly id: MoveId;
  readonly name: string;
  readonly declaredTags: readonly string[];
  readonly category?: MoveDefinition["category"];
  readonly description: string;
  readonly effectText: string;
  readonly effectClauses: readonly EffectClauseDefinition[];
  readonly mechanics: MoveMechanics;
  readonly requirementsText: string;
  readonly trainingDays?: number;
  readonly source: SourceReference;
}

export type EffectRuleToken =
  | "break"
  | "cooldown"
  | "counter"
  | "critical"
  | "deactivate"
  | "lock"
  | "negate"
  | "sever"
  | "stopped"
  | "stun"
  | "successful"
  | "suppress";

export interface EffectClauseDefinition {
  readonly order: number;
  readonly text: string;
  readonly ruleTokens: readonly EffectRuleToken[];
}

export type NumericExpression =
  | { readonly type: "literal"; readonly value: number }
  | {
      readonly type: "turns-after-turn";
      readonly turn: number;
      readonly perTurn: number;
      readonly maximum: number;
    }
  | {
      readonly type: "participant-count";
      readonly excludeSelf: boolean;
      readonly perParticipant: number;
      readonly maximum: number;
    }
  | {
      readonly type: "moveset-move-count";
      readonly subject: "self" | "opponent";
      readonly category: "advanced-attack" | "signature" | "block" | "skill" | "mastery";
    }
  | {
      readonly type: "prior-move-activation-count";
      readonly move: "source";
      readonly perActivation: number;
    }
  | {
      readonly type: "consecutive-combat-results";
      readonly actor: "self" | "opponent";
      readonly result: "successful" | "stopped" | "critical" | "counter";
      readonly resetBy: "successful" | "stopped" | "critical" | "counter";
      readonly perResult: number;
      readonly maximum?: number;
    }
  | {
      readonly type: "bounded-stat";
      readonly subject: "self" | "opponent";
      readonly stat: "dexterity-bonus";
      readonly minimum: number;
      readonly maximum: number;
    }
  | {
      readonly type: "resource-percent";
      readonly subject: "self" | "opponent";
      readonly resource: "hp" | "ki";
      readonly basis: "current" | "total";
      readonly percent: number;
    }
  | {
      readonly type: "stat-percent";
      readonly subject: "self" | "opponent";
      readonly stat: "power";
      readonly percent: number;
    }
  | {
      readonly type: "stat-quotient";
      readonly subject: "self" | "opponent";
      readonly stat: "power";
      readonly divisor: number;
    }
  | {
      readonly type: "damage-percent";
      readonly subject: "current-action";
      readonly percent: number;
    }
  | {
      readonly type: "moveset-tag-count";
      readonly subject: "self" | "opponent";
      readonly tag: string;
      readonly perMove: number;
      readonly maximum?: number;
    }
  | {
      readonly type: "prior-move-ki-cost";
      readonly actor: "self" | "opponent";
      readonly addition?: number;
    }
  | {
      readonly type: "triggering-move-ki-cost";
      readonly addition?: number;
    }
  | { readonly type: "next-move-ki-cost"; readonly actor: "self" | "opponent" }
  | { readonly type: "source-move-ki-cost" }
  | { readonly type: "triggering-move-base-ki-cost" }
  | {
      readonly type: "prior-attack-damage-percent";
      readonly actor: "opponent";
      readonly count: number;
    }
  | {
      readonly type: "resource-percent-per-successful-roll-threshold";
      readonly subject: "self" | "opponent";
      readonly resource: "hp";
      readonly basis: "total";
      readonly percentPerRoll: number;
      readonly roll: "attack";
      readonly comparison: "above";
      readonly value: number;
    }
  | { readonly type: "triggering-move-base-damage-percent"; readonly divisor: number }
  | {
      readonly type: "resource-from-threshold";
      readonly subject: "self" | "opponent";
      readonly resource: "ki";
      readonly threshold: number;
      readonly sign: 1 | -1;
    }
  | {
      readonly type: "current-resource";
      readonly subject: "self" | "opponent";
      readonly resource: "ki";
    }
  | {
      readonly type: "triggering-resource-change";
      readonly resource: "ki";
      readonly operation: "drain";
    }
  | { readonly type: "source-move-calculated-ki-cost" }
  | {
      readonly type: "move-activation-count";
      readonly moveId: string;
      readonly perActivation: number;
    }
  | { readonly type: "minimum"; readonly values: readonly NumericExpression[] }
  | {
      readonly type: "selected-dice-count";
      readonly selectionKey: string;
      readonly operation: "negate" | "groups";
      readonly groupSize?: number;
      readonly perGroup?: number;
    }
  | {
      readonly type: "resource-percent-per-successful-hit";
      readonly subject: "self" | "opponent";
      readonly resource: "hp";
      readonly basis: "current" | "total";
      readonly percentPerHit: number;
    }
  | {
      readonly type: "active-move-effect-text-count";
      readonly subject: "self" | "opponent";
      readonly category: "skill";
      readonly constant: true;
      readonly effectTextIncludes: string;
      readonly perMove: number;
    }
  | {
      readonly type: "combat-result-count";
      readonly actor: "self" | "opponent";
      readonly result: "successful" | "stopped" | "counter" | "critical";
      readonly perResult: number;
      readonly minimum?: number;
      readonly maximum?: number;
    }
  | {
      readonly type: "prior-roll-result";
      readonly roll: "attack" | "defense";
      readonly multiplier?: number;
      readonly addition?: number;
    }
  | { readonly type: "completed-combat-turn-count"; readonly perTurn: number }
  | {
      readonly type: "stat-difference-percent";
      readonly left: "self" | "opponent";
      readonly right: "self" | "opponent";
      readonly stat: "dexterity-bonus";
      readonly percentPerPoint: number;
      readonly maximum?: number;
    }
  | {
      readonly type: "triggering-move-base-damage";
      readonly multiplier: number;
    }
  | {
      readonly type: "blocked-attack-damage";
      readonly multiplier: number;
    }
  | { readonly type: "paid-activation-cost"; readonly resource: "ki" }
  | {
      readonly type: "active-move-count";
      readonly subject: "self" | "opponent";
      readonly category: "skill";
      readonly constant: true;
      readonly perMove: number;
    }
  | { readonly type: "successful-hit-count-groups"; readonly groupSize: number }
  | { readonly type: "successful-hit-count"; readonly perHit?: number }
  | { readonly type: "stopped-hit-count"; readonly perHit: number }
  | { readonly type: "source-expression"; readonly text: string };

export interface MoveMechanics {
  readonly kiCost?: NumericExpression;
  readonly restrictedUses?: NumericExpression;
  readonly timingText?: string;
  readonly attack?: {
    readonly type: (typeof ATTACK_TYPE)[keyof typeof ATTACK_TYPE];
    readonly baseDamagePercent?: NumericExpression;
    readonly damagePerHit?: boolean;
    readonly attackRoll?: { readonly dice: number; readonly sides: number };
  };
  /** Declarative eligibility and base-cost formula for a Block move. */
  readonly block?: {
    readonly allowedAttackTypes?: readonly ("physical" | "energy")[];
    readonly allowedAttackTags?: readonly ("beam" | "blast" | "weapon")[];
    readonly stopsAllDice?: boolean;
    readonly baseCostAdjustment: number;
  };
}

export interface UnresolvedMoveSource {
  readonly sourcePath: string;
  readonly line: number;
  readonly name: string;
  readonly reason: string;
  readonly sourceText: string;
}

export interface StyleDefinition {
  readonly id: StyleId;
  readonly name: string;
  readonly description: string;
  readonly masteryMoveIds: readonly MoveId[];
  readonly skillMoveIds: readonly MoveId[];
  readonly advancedAttackMoveIds: readonly MoveId[];
  readonly signatureMoveIds: readonly MoveId[];
  readonly blockMoveIds: readonly MoveId[];
  readonly source: SourceReference;
}

export interface RaceDefinition {
  readonly id: RaceId;
  readonly name: string;
  readonly description: string;
  readonly startingItemNames: readonly string[];
  readonly racialTraitsText: string;
  readonly classesText: string;
  readonly racialTraits: readonly RaceTraitDefinition[];
  readonly classes: readonly RaceClassDefinition[];
  readonly transformationIds: readonly TransformationId[];
  readonly source: SourceReference;
}

export interface RaceTraitDefinition {
  readonly id: string;
  readonly name: string;
  readonly effectText: string;
  readonly effectClauses: readonly EffectClauseDefinition[];
  readonly source: SourceReference;
}

export interface RaceClassDefinition {
  readonly id: string;
  readonly name: string;
  readonly effectText: string;
  readonly effectClauses: readonly EffectClauseDefinition[];
  readonly source: SourceReference;
}

export interface GenericClassDefinition {
  readonly id: string;
  readonly name: string;
  readonly effectText: string;
  readonly effectClauses: readonly EffectClauseDefinition[];
  readonly source: SourceReference;
}

export interface TransformationStatModifiers {
  readonly powerPercent: number;
  readonly hpPercent: number;
  readonly dexterityPercent: number;
}

export interface TransformationAbilityDefinition {
  readonly name?: string;
  readonly effectText?: string;
  readonly effectClauses?: readonly EffectClauseDefinition[];
  readonly effects?: readonly EffectDefinition[];
}

export type TransformationMastery =
  (typeof TRANSFORMATION_MASTERY)[keyof typeof TRANSFORMATION_MASTERY];

export type TransformationAbilities = Readonly<
  Record<TransformationMastery, TransformationAbilityDefinition>
>;

export interface TransformationDefinition {
  readonly id: TransformationId;
  readonly raceId: RaceId;
  readonly name: string;
  readonly tier: number;
  readonly prerequisites: readonly Requirement[];
  readonly statModifiers: TransformationStatModifiers;
  readonly abilities: TransformationAbilities;
  readonly appearance?: string;
  readonly notes?: readonly string[];
  readonly source: SourceReference;
}

export interface TransformationSourceDefinition {
  readonly sourcePath: string;
  readonly raceId?: RaceId;
  readonly status: "canonical" | "archive" | "no-mechanics";
  readonly source: SourceReference;
}

export interface ItemDefinition {
  readonly id: ItemId;
  readonly name: string;
  readonly category: (typeof ITEM_CATEGORY)[keyof typeof ITEM_CATEGORY];
  readonly description: string;
  readonly effectText: string;
  readonly effectClauses: readonly EffectClauseDefinition[];
  readonly rules: readonly ItemRuleDefinition[];
  readonly inventorySlots: number;
  readonly inventorySlotCondition?: string;
  readonly price?: number;
  readonly maxUses?: number;
  readonly equipmentSlot?: "upper-body" | "lower-body" | "full-body" | "accessory";
  readonly shipSlot?: "weapon" | "defense";
  readonly availability: "all" | "listed" | "unavailable";
  readonly locations: readonly string[];
  readonly notes: readonly string[];
  readonly ship?: {
    readonly maximumCapacity?: number;
    readonly weaponSlots?: number;
    readonly defenseSlots?: number;
    readonly travelDays?: number;
    readonly supportSystems: readonly string[];
  };
  readonly requirements?: readonly Requirement[];
  readonly effects?: readonly ItemEffectDefinition[];
  readonly source: SourceReference;
}

/**
 * Effects that are evaluated outside a move's combat-resolution lifecycle.
 * These remain separate from move effects so an item can express persistent
 * inventory, travel, economy, and progression mechanics without inventing a
 * combat trigger.
 */
export type ItemEffectDefinition =
  | EffectDefinition
  | ItemStatPercentEffect
  | ItemExperiencePercentEffect
  | ItemInventoryCapacityEffect
  | ItemShipCapacityEffect
  | ItemDurationReductionEffect
  | ItemMarketplaceDiscountEffect
  | ItemResourceEffect
  | ItemRollModifierEffect
  | ItemDamageModifierEffect
  | ItemPreventCombatOutcomeEffect
  | ItemTravelPermissionEffect
  | ItemSpaceCombatEffect
  | ItemStateRuleEffect;

export interface ItemEffectBase {
  readonly trigger:
    | "passive"
    | "on-item-use"
    | "after-spar-or-battle"
    | "on-quest-start"
    | "on-travel-start"
    | "combat-action"
    | "before-roll"
    | "after-defense-roll";
  readonly sourceText: string;
}

export interface ItemStatPercentEffect extends ItemEffectBase {
  readonly type: "item-modify-stat-percent";
  readonly stat: "power" | "hp" | "dexterity" | "all-stats";
  readonly percent: number;
  readonly duration?: { readonly unit: "week"; readonly value: number };
}

export interface ItemExperiencePercentEffect extends ItemEffectBase {
  readonly type: "item-modify-experience-percent";
  readonly activity: "spar" | "battle" | "spar-or-battle";
  readonly percent: number;
  readonly rounding: "nearest";
}

export interface ItemInventoryCapacityEffect extends ItemEffectBase {
  readonly type: "item-modify-inventory-capacity";
  readonly slots: number;
}

export interface ItemShipCapacityEffect extends ItemEffectBase {
  readonly type: "item-modify-ship-capacity";
  readonly capacity: number;
}

export interface ItemDurationReductionEffect extends ItemEffectBase {
  readonly type: "item-reduce-duration";
  readonly activity: "dragon-ball-search" | "quest" | "ship-travel";
  readonly amount: number;
  readonly minimum?: number;
  readonly unit: "days" | "wpd";
  readonly useLimit?: { readonly scope: "saga" | "week"; readonly count: number };
}

export interface ItemMarketplaceDiscountEffect extends ItemEffectBase {
  readonly type: "item-modify-marketplace-price";
  readonly operation: "discount";
  readonly percent: number;
}

export interface ItemResourceEffect extends ItemEffectBase {
  readonly type: "item-modify-resource";
  readonly target: "self" | "opponent";
  readonly resource: "hp" | "ki";
  readonly operation: "gain" | "lose";
  readonly amount:
    | { readonly type: "literal"; readonly value: number }
    | {
        readonly type: "resource-percent";
        readonly basis: "current" | "total";
        readonly percent: number;
      };
  readonly duration?: { readonly unit: "combat" | "day"; readonly value?: number };
}

export interface ItemRollModifierEffect extends ItemEffectBase {
  readonly type: "item-modify-roll";
  readonly target: "self" | "opponent";
  readonly roll: "attack" | "defense" | "escape" | "transformation";
  readonly modifier: "result" | "sides";
  readonly amount: number;
  readonly duration?: { readonly unit: "combat"; readonly value?: number };
  readonly selectorText?: string;
}

export interface ItemDamageModifierEffect extends ItemEffectBase {
  readonly type: "item-modify-damage";
  readonly target: "self" | "opponent";
  readonly percent: number;
  readonly selectorText?: string;
  readonly duration?: { readonly unit: "combat"; readonly value?: number };
}

export interface ItemPreventCombatOutcomeEffect extends ItemEffectBase {
  readonly type: "item-prevent-combat-outcome";
  readonly outcomes: readonly ("break" | "sever")[];
}

export interface ItemTravelPermissionEffect extends ItemEffectBase {
  readonly type: "item-grant-travel-permission";
  readonly destination: "another-planet";
}

export interface ItemSpaceCombatEffect extends ItemEffectBase {
  readonly type: "item-space-combat";
  readonly role: "challenger" | "challenged" | "either";
  readonly operation:
    | "roll-defense-twice-use-lower"
    | "reroll-single-die-advanced-attack"
    | "act-first"
    | "modify-first-attack-roll"
    | "gain-starting-ki"
    | "increase-first-attack-cost"
    | "set-first-attack-success-threshold"
    | "ignore-opponent-ship-weapon"
    | "ignore-opponent-ship-defense"
    | "grant-extra-basic-attack"
    | "grant-escape-roll-before-combat";
  readonly amount?: number;
  readonly threshold?: number;
}

/** Stateful item mechanics whose operation is independent of move resolution. */
export interface ItemStateRuleEffect extends ItemEffectBase {
  readonly type: "item-state-rule";
  readonly operation:
    | "allow-use-after-combat-loss"
    | "limit-healing-item-uses"
    | "modify-recovery-rate"
    | "modify-all-roll-sides"
    | "limit-consecutive-stat-boost-weeks"
    | "modify-skill-slot-capacity"
    | "grant-extra-basic-weapon-action"
    | "prevent-interference"
    | "permit-equipment-change"
    | "prevent-equipment-change-during-combat"
    | "grant-marketplace-access"
    | "waive-ship-pilot-requirement"
    | "pay-activation-ki"
    | "heal-current-hp"
    | "reduce-training-days"
    | "grant-zenni-on-npc-kill"
    | "grant-transformation-roll-sides"
    | "grant-ki-per-combat"
    | "allow-quest-without-battle"
    | "permit-accessory-slot-overflow"
    | "restrict-use-in-purchase-week"
    | "limit-race-item-uses"
    | "grant-resource-when-race"
    | "reflect-attack-damage"
    | "make-advanced-attack-unblockable"
    | "stop-low-roll-unrestricted-attack"
    | "set-attack-roll-result"
    | "reroll-defense-dice"
    | "modify-tagged-attack-cost"
    | "modify-block-cost"
    | "declare-after-defense-roll"
    | "declare-before-roll"
    | "modify-transformation-roll-result"
    | "heal-total-hp-per-day"
    | "grant-ship-storage-access"
    | "transfer-stored-items-on-raid"
    | "increase-other-ship-travel-time"
    | "restrict-space-quest-work"
    | "challenge-dragon-ball-carrier"
    | "activate-after-defense-roll"
    | "activate-on-advanced-attack"
    | "stop-low-firearm-roll"
    | "modify-selected-roll"
    | "deny-challenge"
    | "apply-challenge-cooldown"
    | "select-escape-roll-modifier"
    | "heal-after-item-healing"
    | "select-persistent-stat"
    | "increase-single-die-drain"
    | "protect-combat-state"
    | "forbid-defense-reroll-after-restricted-attack"
    | "roll-space-combat-dice"
    | "set-space-combat-starting-hp"
    | "disable-selected-item-copies"
    | "limit-space-combat-item-use"
    | "resolve-self-destruct"
    | "destroy-item-on-roll-threshold"
    | "grant-post-combat-reward"
    | "declare-after-roll"
    | "pay-hp-for-roll-modifier"
    | "exchange-experience-for-resources"
    | "require-unrestricted-single-physical-attack"
    | "exclude-multi-die-attacks"
    | "activate-on-block"
    | "roll-first-advanced-attack-twice-lower"
    | "cap-hp-at-precombat-value"
    | "require-hp-threshold"
    | "roll-self-destruct-die"
    | "allow-target-item-attack";
  readonly amount?: number;
  readonly duration?: { readonly unit: "day" | "week" | "combat"; readonly value: number };
  readonly conditionText?: string;
}

export interface ItemRuleDefinition {
  readonly family:
    | "combat"
    | "escape"
    | "marketplace"
    | "quest"
    | "search"
    | "ship"
    | "travel"
    | "weekly"
    | "other";
  readonly timing:
    | "inventory-passive"
    | "equipped-passive"
    | "before-combat"
    | "combat-action"
    | "combat-trigger"
    | "marketplace"
    | "quest"
    | "travel"
    | "weekly"
    | "saga";
  readonly executable: boolean;
  /** Present only when the source rule is intentionally retained rather than executable. */
  readonly unresolvedReason?:
    "requires-dedicated-effect-family" | "narrative-or-administrator-rule";
  readonly sourceText: string;
}

export interface NpcDefinition {
  readonly id: NpcId;
  readonly name: string;
  readonly raceId?: RaceId;
  readonly styleId?: StyleId;
  readonly raceName?: string;
  readonly styleName?: string;
  readonly combatProfile?: NpcCombatProfile;
  readonly moveIds: readonly MoveId[];
  readonly unresolvedMoveNames: readonly string[];
  readonly description?: string;
  readonly source: SourceReference;
}

export interface SourceNumericValue {
  readonly sourceText: string;
  readonly baseValue?: number;
  readonly resolvedValue?: number;
}

export interface NpcCombatProfile {
  readonly levelText: string;
  readonly transformationText?: string;
  readonly hitPoints?: SourceNumericValue;
  readonly power?: SourceNumericValue;
  readonly dexterity?: SourceNumericValue;
  readonly equipmentNames: readonly string[];
  readonly battleNotes?: string;
}

export interface QuestDefinition {
  readonly id: QuestId;
  readonly name: string;
  readonly description: string;
  readonly prerequisites: readonly Requirement[];
  readonly requirementsText: string;
  readonly rewardsText: string;
  readonly rewards: readonly QuestRewardDefinition[];
  readonly battleText?: string;
  readonly locationId?: LocationId;
  readonly npcIds: readonly NpcId[];
  readonly encounterIds: readonly string[];
  readonly source: SourceReference;
}

export type QuestRewardDefinition =
  | QuestZenniReward
  | QuestExperienceReward
  | QuestItemReward
  | QuestMoveReward
  | QuestOutcomeReward
  | QuestSourceRuleReward;

export interface QuestRewardBase {
  readonly sourceText: string;
  readonly executable: boolean;
}

export interface QuestZenniReward extends QuestRewardBase {
  readonly type: "grant-zenni";
  readonly amount: number;
  readonly executable: true;
}

export interface QuestExperienceReward extends QuestRewardBase {
  readonly type: "grant-base-experience-multiplier";
  readonly multiplier: number;
  readonly executable: true;
}

export interface QuestItemReward extends QuestRewardBase {
  readonly type: "grant-item";
  readonly itemName: string;
  readonly quantity: number;
  readonly itemId?: ItemId;
  readonly executable: boolean;
}

export interface QuestMoveReward extends QuestRewardBase {
  readonly type: "grant-move";
  readonly moveName: string;
  readonly moveId?: MoveId;
  readonly executable: boolean;
}

export interface QuestOutcomeReward extends QuestRewardBase {
  readonly type: "quest-outcome";
  readonly operation:
    | "heal-combat-outcomes"
    | "reduce-move-training-days"
    | "modify-transformation-roll"
    | "reduce-quest-duration"
    | "swap-player-locations"
    | "swap-afterlife-transformation"
    | "exchange-equipment"
    | "grant-transit-use"
    | "convert-move-style"
    | "grant-conditional-battle-stat"
    | "fuse-weapons"
    | "grant-move-slot"
    | "apply-temporary-race"
    | "teach-move-between-allies"
    | "grant-extra-mastery"
    | "complete-selected-quest"
    | "roll-on-arrival"
    | "exchange-equal-value-item"
    | "grant-selected-item-by-value"
    | "grant-placement-experience-multiplier";
  readonly amount?: number;
  readonly executable: true;
}

/** A source-traceable reward that needs an administrator or a new effect family. */
export interface QuestSourceRuleReward extends QuestRewardBase {
  readonly type: "source-rule";
  readonly executable: false;
  readonly unresolvedReason:
    "administrator-mediated" | "external-catalog-reference" | "requires-dedicated-outcome-family";
}

export interface QuestEncounterDefinition {
  readonly id: string;
  readonly questId: QuestId;
  readonly battleText: string;
  readonly notesText?: string;
  readonly npcIds: readonly NpcId[];
  /** Source describes these opponents but does not supply a named combat profile. */
  readonly unresolvedCombatantTexts: readonly string[];
  readonly source: SourceReference;
}

export interface SagaSectionDefinition {
  readonly id: string;
  readonly title: string;
  readonly level: 2 | 3;
  readonly content: string;
  readonly source: SourceReference;
}

export interface SagaDefinition {
  readonly id: string;
  readonly name: string;
  readonly overview: string;
  readonly sections: readonly SagaSectionDefinition[];
  readonly source: SourceReference;
}

export interface SagaSourceDefinition {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly source: SourceReference;
}

export interface RuleSectionDefinition {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly content: string;
  readonly source: SourceReference;
}

export interface LocationDefinition {
  readonly id: LocationId;
  readonly name: string;
  readonly type: (typeof LOCATION_TYPE)[keyof typeof LOCATION_TYPE];
  readonly description: string;
  readonly parentLocationId?: LocationId;
  readonly source: SourceReference;
}

export interface TrainerCatalogDefinition {
  readonly id: string;
  readonly locationId: LocationId;
  readonly content: string;
  readonly source: SourceReference;
}

export interface TrainerDefinition {
  readonly id: string;
  readonly locationId: LocationId;
  readonly styleName: string;
  readonly name: string;
  readonly moveIds: readonly MoveId[];
  readonly unresolvedMoveNames: readonly string[];
  readonly source: SourceReference;
}

export interface StatusDefinition {
  readonly id: StatusId;
  readonly name: string;
  readonly stacking: (typeof STATUS_STACKING)[keyof typeof STATUS_STACKING];
  readonly defaultDuration?: number;
  readonly effects: readonly EffectDefinition[];
}

export type GameDataDocumentKind =
  | "rules"
  | "moves"
  | "items"
  | "race"
  | "transformations"
  | "quest"
  | "location"
  | "trainers"
  | "reference";

export interface GameDataDocument {
  readonly id: string;
  readonly kind: GameDataDocumentKind;
  readonly sourcePath: string;
  readonly content: string;
}
