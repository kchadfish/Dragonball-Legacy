import { GLOBAL_RULES, type RulesVersion } from "@dragonball-resurgence/game-config";
import type {
  EffectCostTiming,
  EffectDefinition,
  EffectSelection,
  MoveDefinition,
  MoveSelectorCondition,
  NumericExpression,
} from "@dragonball-resurgence/game-data";
import type { ItemId, MoveId, StatusId, TransformationId } from "@dragonball-resurgence/game-data";
import { z } from "zod";

import type {
  ActiveEffectId,
  CombatDecisionId,
  CombatEventId,
  CombatantId,
  FightId,
  PendingDecisionId,
  ResolutionFrameId,
} from "./ids.js";
import type { CandidateReference } from "./candidate-resolution.js";

export type CombatMode = "spar" | "battle";

export type CombatPhase = "upkeep" | "action" | "counter" | "end";

export interface CombatResources {
  readonly current: number;
  readonly maximum: number;
}

export interface CombatantStats {
  readonly power: number;
  readonly dexterity: number;
  readonly dexterityBonus: number;
}

export type CombatSlot = "mastery" | "skill" | "advanced-attack" | "signature" | "block";

export type CombatSlotCapacities = Readonly<Record<CombatSlot, number>>;

/** A passive declarative change to one moveset slot capacity. */
export interface SlotCapacityModification {
  readonly sourceCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly sourceEffectIndex: number;
  readonly slot: CombatSlot;
  readonly amount: number;
}

/** A combat-local status whose semantics remain owned by game data and the effect runtime. */
export interface ActiveStatus {
  readonly statusId: StatusId;
  readonly sourceCombatantId: CombatantId;
  readonly sourceDefinitionId: string;
  readonly selector?: MoveSelectorCondition;
  readonly stacks: number;
  readonly duration:
    | { readonly type: "combat" }
    | {
        readonly type: "turns";
        readonly ownerCombatantId: CombatantId;
        readonly remaining: number;
      }
    | {
        readonly type: "until-turn-start-roll-threshold";
        readonly combatantId: CombatantId;
        readonly dice: number;
        readonly sides: number;
        readonly comparison: "at-least" | "at-most";
        readonly value: number;
        readonly remainingIgnoredChecks: number;
      }
    | { readonly type: "uses"; readonly remaining: number };
}

/** The transformation currently active on a combatant; permanent unlocks remain outside combat. */
export interface ActiveTransformation {
  readonly transformationId: TransformationId;
  readonly activatedOnTurn: number;
  readonly baseline?: {
    readonly currentHitPoints: number;
    readonly maximumHitPoints: number;
    readonly stats: CombatantStats;
  };
}

/** A natural die result retained by a declarative move for later combat resolution. */
export interface StoredRoll {
  readonly sourceDefinitionId: MoveId;
  readonly storageKey: string;
  readonly naturalResults: readonly number[];
  readonly sides: number;
  readonly storedOnTurn: number;
}

/** A move selected from a retained declarative roll for later effect conditions. */
export interface StoredMoveSelection {
  readonly sourceDefinitionId: MoveId;
  readonly selectionKey: string;
  readonly moveId: MoveId;
  readonly selectedOnTurn: number;
}

export interface CombatantState {
  readonly id: CombatantId;
  /** The declared martial-arts style used by durable Freestyle classifications. */
  readonly declaredStyleId?: string;
  readonly hitPoints: CombatResources;
  readonly ki: CombatResources;
  readonly stats: CombatantStats;
  /** Permanent specialization points used by declarative combat comparisons. */
  readonly specializationPoints?: number;
  readonly level?: number;
  readonly planetHasDragonBalls?: boolean;
  readonly masteredTransformationIds?: readonly TransformationId[];
  readonly moveIds: readonly MoveId[];
  /** Canonical moveset capacities after passive combat modifiers are applied. */
  readonly slotCapacities?: CombatSlotCapacities;
  /** Source-preserving passive capacity applications used to derive slotCapacities. */
  readonly slotCapacityModifications?: readonly SlotCapacityModification[];
  readonly itemIds?: readonly ItemId[];
  readonly transformationIds?: readonly TransformationId[];
  /** Number of pending transformations that do not consume the action phase. */
  readonly freeTransformationActions?: number;
  /** Transformation opportunities retained until the next END phase. */
  readonly forcedTransformationOpportunities?: readonly {
    readonly sourceDefinitionId: MoveId;
    readonly sourceEffectIndex: number;
    readonly targetTransformation: "highest";
    readonly optional: boolean;
  }[];
  readonly moveUses: Readonly<Record<MoveId, number>>;
  /** Combat-local counts for immediate declarative effects with their own use limits. */
  readonly effectUseCounts?: Readonly<Record<string, number>>;
  /** Combat-local positive increases to a move's canonical restricted-use limit. */
  readonly moveUseLimitModifiers?: Readonly<Record<MoveId, number>>;
  /** Combat-local named rolls; a later roll with the same key replaces the prior value. */
  readonly storedRolls?: Readonly<Record<string, StoredRoll>>;
  /** Combat-local named move selections; a later selection with the same key replaces the prior value. */
  readonly storedMoveSelections?: Readonly<Record<string, StoredMoveSelection>>;
  /** Combat-local selections and protections granted by Destruction Mastery. */
  readonly destructionMastery?: {
    readonly advancedAttackId?: MoveId;
    readonly signatureTechniqueId?: MoveId;
    readonly zeroCostSignatureUsesRemaining: number;
    readonly naturalDefenseStopPreventionAtMost: number;
    readonly damageBonusAfterOpponentInterferencePercent: number;
  };
  /** Per-fight consumption counts for combat-usable inventory items. */
  readonly itemUses?: Readonly<Record<ItemId, number>>;
  readonly activeStatuses: readonly ActiveStatus[];
  readonly transformation?: ActiveTransformation;
  readonly status: "active" | "defeated";
}

const createFightCombatantInputSchema = z
  .object({
    maximumHitPoints: z.number().positive(),
    stats: z
      .object({
        power: z.number().nonnegative(),
        dexterity: z.number().nonnegative(),
        dexterityBonus: z
          .number()
          .min(GLOBAL_RULES.combat.minimumDexterityBonus)
          .max(GLOBAL_RULES.combat.maximumDexterityBonus),
      })
      .strict(),
    declaredStyleId: z.string().min(1).optional(),
    specializationPoints: z.number().nonnegative().optional(),
    level: z.number().nonnegative().optional(),
    planetHasDragonBalls: z.boolean().optional(),
    masteredTransformationIds: z.array(z.string().min(1)).optional(),
    moveIds: z.array(z.string().min(1)).superRefine((moveIds, context) => {
      const seenMoveIds = new Set<string>();

      for (const [index, moveId] of moveIds.entries()) {
        if (seenMoveIds.has(moveId)) {
          context.addIssue({
            code: "custom",
            message: "Move IDs must not contain duplicates.",
            path: [index],
          });
        }
        seenMoveIds.add(moveId);
      }
    }),
    itemIds: z
      .array(z.string().min(1))
      .superRefine((itemIds, context) => {
        const seenItemIds = new Set<string>();
        for (const [index, itemId] of itemIds.entries()) {
          if (seenItemIds.has(itemId)) {
            context.addIssue({
              code: "custom",
              message: "Item IDs must not contain duplicates.",
              path: [index],
            });
          }
          seenItemIds.add(itemId);
        }
      })
      .optional(),
    transformationIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const createFightInputSchema = z
  .object({
    mode: z.enum(["spar", "battle"]),
    combatants: z.tuple([createFightCombatantInputSchema, createFightCombatantInputSchema]),
  })
  .strict();

export type CreateFightInput = z.output<typeof createFightInputSchema>;

export interface FightSetupIssue {
  readonly path: string;
  readonly message: string;
}

export interface PendingDecisionOption {
  readonly id: string;
  readonly type:
    | "activate-effect"
    | "decline"
    | "roll-defense"
    | "select-combatant"
    | "select-move"
    | "select-source-action"
    | "select-source-effect"
    | "use-block";
  readonly combatantId?: CombatantId;
  readonly itemId?: ItemId;
  readonly moveId?: MoveId;
  /** Active CONSTANT Skill selected as the replacement target. */
  readonly activeEffectId?: ActiveEffectId;
  readonly transformationId?: TransformationId;
  readonly forcedTransformation?: {
    readonly sourceDefinitionId: MoveId;
    readonly sourceEffectIndex: number;
  };
  /** The completed source action selected by a prior-action copy effect. */
  readonly sourceActionId?: CombatDecisionId;
  /** A selected move retained by a compound defense response choice. */
  readonly selectedMoveId?: MoveId;
  /** Immutable source move snapshot retained with a serialized selection. */
  readonly sourceMoveSnapshot?: MoveDefinition;
  /** Exact damage retained from the selected completed source action. */
  readonly sourceDamageDealt?: number;
  /** Exact source-side attack resolution retained from a prior-action copy. */
  readonly sourceResolutionSnapshot?: AttackResolutionSnapshot;
  /** Resolved counter permission selected at the post-defense boundary. */
  readonly counterAction?: CounterActionReference;
  /** Exact deactivation-negation listener selected for the pending lifecycle response. */
  readonly deactivationNegation?: {
    readonly sourceDefinitionId: MoveId;
    readonly sourceEffectIndex: number;
    readonly useLimit?: { readonly scope: "combat"; readonly count: number };
  };
  readonly effectIndices?: readonly number[];
  readonly combatResultOverride?: {
    readonly sourceDefinitionId: MoveId;
    readonly sourceEffectIndex: number;
    readonly dieIndex: number;
  };
  readonly combatResultNegation?: {
    readonly sourceDefinitionId: MoveId;
    readonly sourceEffectIndex: number;
    readonly outcome: "stun" | "critical" | "counter";
  };
  readonly selectedNumericValue?: number;
  /** Normalized selection semantics retained for a resumable effect choice. */
  readonly selection?: EffectSelection;
  readonly optional?: boolean;
  readonly costTiming?: EffectCostTiming;
  /** Exact candidate represented by this option for generic selections. */
  readonly candidate?: CandidateReference;
}

export interface PendingDecision {
  readonly id: PendingDecisionId;
  readonly stateVersion: number;
  readonly combatantId: CombatantId;
  readonly type:
    | "defense-response"
    | "post-defense-roll"
    | "optional-effect"
    | "select-combatant"
    | "select-move"
    | "select-source-action"
    | "select-source-effect";
  readonly options: readonly PendingDecisionOption[];
  /** Persisted candidate set; omitted only for legacy specialized choices. */
  readonly candidates?: readonly CandidateReference[];
  readonly selection?: EffectSelection;
  readonly optional?: boolean;
}

export interface AdvancedAttackCostSelector {
  readonly category: "advanced-attack";
  readonly baseKiCost: number;
}

/** Normalized, runtime-safe conflict semantics for durable combat effects. */
export type ConflictPolicy =
  | { readonly type: "allow" }
  | { readonly type: "prevent-duplicate" }
  | {
      readonly type: "replace";
      readonly provenance: "existing" | "incoming";
    }
  | {
      readonly type: "refresh";
      readonly duration: "existing" | "incoming";
      readonly uses: "existing" | "incoming";
      readonly provenance: "existing" | "incoming";
    }
  | {
      readonly type: "retain";
      readonly selection: "highest" | "lowest";
      readonly value: "amount";
      readonly tie: "existing" | "incoming";
    }
  | { readonly type: "unique-group"; readonly group: string }
  | { readonly type: "mutually-exclusive-group"; readonly group: string };

export interface ActiveEffectConflictMetadata {
  /** Explicit policy compiled from source-backed game data. */
  readonly conflictPolicy?: ConflictPolicy;
  /** Canonical identity used by the shared conflict resolver. */
  readonly conflictKey?: string;
}

/** A durable permission to bypass the standard dice-side/result limit. */
export interface ActiveRollModificationCap {
  readonly type: "allow-exceed";
  readonly scope: "amount" | "total" | "roll";
}

/** A serializable temporary modifier that expires after one matching action. */
export interface ActiveCostModifierEffect {
  readonly id: ActiveEffectId;
  readonly type: "modify-ki-cost";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly amount: number;
  readonly selector: AdvancedAttackCostSelector;
  readonly scope: "next-eligible-action";
}

export type CombatRollType = "attack" | "defense" | "escape" | "initiative" | "transformation";

/** A combat-persistent item modifier applied to a named roll before it is made. */
export interface ActiveRollModifierEffect {
  readonly id: ActiveEffectId;
  readonly type: "modify-roll";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: ItemId | MoveId;
  readonly roll: CombatRollType;
  readonly modifier: "dice" | "result" | "sides";
  readonly amount: number;
  readonly cap?:
    | ActiveRollModificationCap
    | {
        readonly type: "maximum" | "minimum";
        readonly scope: "amount" | "total" | "roll";
        readonly value: number;
      };
  readonly selector?: MoveSelectorCondition;
  readonly stacking?: "allow" | "prevent";
  readonly duration:
    | "combat"
    | {
        readonly type: "turns" | "turns-or-until-perfect-roll";
        readonly ownerCombatantId: CombatantId;
        readonly remaining: number;
      };
}

/** A durable transformation applied to later declarative roll modifiers. */
export interface ActiveRollModifierTransformerEffect {
  readonly id: ActiveEffectId;
  readonly type: "modify-roll-modifier";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly sourceEffectIndex: number;
  readonly modifier: "result" | "sides" | "any";
  readonly multiplier?: number;
  readonly increment?: number;
  readonly excludeSourceCategories?: readonly ("mastery" | "skill")[];
  readonly cap?: ActiveRollModificationCap;
  readonly duration:
    | "combat"
    | {
        readonly type: "next-roll";
        readonly combatantId: CombatantId;
        readonly roll: "attack" | "defense";
      };
}

/** A durable reaction that replaces one or more persisted attack dice. */
export interface ActiveRerollEffect {
  readonly id: ActiveEffectId;
  readonly type: "reroll";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly sourceEffectIndex: number;
  readonly roll: "attack" | "defense";
  readonly rerollScope: "single-result" | "entire-attack";
  readonly selector?: MoveSelectorCondition;
  readonly bonus: number;
  readonly conditions: EffectDefinition["conditions"];
  readonly optional: boolean;
  readonly activationResource?: "ki";
  readonly activationCost?: number;
  readonly useLimit?: { readonly scope: "combat" | "turn"; readonly remaining: number };
  readonly duration:
    | { readonly type: "combat" }
    | { readonly type: "next-action"; readonly combatantId: CombatantId }
    | {
        readonly type: "next-roll";
        readonly combatantId: CombatantId;
        readonly roll: "attack" | "defense";
      }
    | {
        readonly type: "next-rolls";
        readonly combatantId: CombatantId;
        readonly roll: "attack" | "defense";
        readonly remaining: number;
      };
}

/** A durable constraint on the roll result required for an attack outcome. */
export interface ActiveResolutionThresholdEffect {
  readonly id: ActiveEffectId;
  readonly type: "set-resolution-threshold";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly outcome: "successful" | "stopped";
  readonly roll: "attack" | "defense";
  readonly comparison: "at-least" | "at-most";
  readonly value: number;
  readonly relativeTo?: "attack-roll" | "defense-roll";
  readonly relativeOperation?: "add" | "multiply";
  readonly resultScope: "current-attack" | "matching-die";
  readonly selector?: MoveSelectorCondition;
  readonly appliesTo: "source" | "target";
  readonly scope?: "next-action";
  readonly duration:
    | { readonly type: "combat" }
    | {
        readonly type: "until-roll-threshold";
        readonly combatantId: CombatantId;
        readonly roll: "attack" | "defense";
        readonly comparison: "at-least" | "at-most";
        readonly value: number;
      };
  readonly useLimit?: { readonly scope: "combat" | "turn"; readonly count: number };
}

type ActiveNextActionModifier =
  | {
      readonly type: "damage";
      readonly amount: number;
      readonly cap?: { readonly type: "maximum" | "minimum"; readonly value: number };
      readonly capOnly?: boolean;
      readonly basis?: "power-percent" | "damage-percent";
      /** Omitted means additive damage, preserving the compact legacy form. */
      readonly operation?: "add" | "multiply" | "set";
    }
  | {
      readonly type: "roll";
      readonly roll: CombatRollType;
      readonly modifier: "dice" | "result" | "sides";
      readonly amount: number;
      readonly cap?: NonNullable<ActiveRollModifierEffect["cap"]>;
    }
  | {
      /** Replaces a matching die result instead of adding a modifier to it. */
      readonly type: "roll-result";
      readonly roll: "attack" | "defense";
      readonly value: number;
      readonly resultScope: "matching-die";
    }
  | {
      readonly type: "roll-definition";
      readonly roll: "attack" | "defense";
      readonly dice?: number;
      readonly sides: number;
    }
  | {
      readonly type: "combat-outcome";
      readonly outcome: "break" | "sever" | "stun";
      readonly multiplier: number;
    }
  | {
      readonly type: "stat";
      readonly stat: "dexterity" | "dexterity-bonus";
      readonly operation: "add" | "set" | "multiply";
      readonly amount: number;
      readonly roll?: "attack" | "defense";
    }
  | {
      readonly type: "resource";
      readonly resource: "hp" | "ki";
      readonly operation: "drain" | "gain" | "lose" | "set";
      readonly amount: number;
      readonly basis: "damage-percent";
    }
  | {
      readonly type: "resource-cost";
      readonly resource: "hp";
      readonly operation: "add";
      /** Percentage adjustment applied to the matching next action's resource loss. */
      readonly amount: number;
    }
  | {
      readonly type: "cost-modifier";
      readonly multiplier: number;
    }
  | {
      readonly type: "resource-modifier";
      readonly resource: "hp" | "ki";
      readonly operation: "gain" | "lose";
      readonly multiplier: number;
      readonly cap?: { readonly type: "maximum"; readonly value: number };
    }
  | {
      readonly type: "cost";
      readonly operation: "add" | "set";
      readonly amount: number;
      /** A deferred amount resolved from the next qualifying attack in history. */
      readonly amountExpression?: Extract<
        NumericExpression,
        { readonly type: "next-move-ki-cost" }
      >;
      readonly minimum?: number;
      readonly maximum?: number;
    }
  | {
      readonly type: "combat-result";
      readonly result: "successful" | "stopped";
      readonly resultScope: "current-attack" | "matching-die";
    };

/** A resolved move effect that modifies its owner's immediately following action. */
export interface ActiveNextActionModifierEffect {
  readonly id: ActiveEffectId;
  readonly type: "modify-next-action";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly sourceEffectIndex?: number;
  readonly selector?: MoveSelectorCondition;
  /** The first matching action/roll at or after this scope becomes eligible. */
  readonly scope?:
    | "next-action"
    | "following-action"
    | "next-actions"
    | "next-phase"
    | "next-roll"
    | "next-rolls"
    | "next-turn";
  /** Remaining actions or individual rolls for counted scopes. */
  readonly remaining?: number;
  readonly stacking?: "allow" | "prevent";
  /** Following-action modifiers become eligible only after this turn. */
  readonly availableFromTurn?: number;
  /** Action-history boundary retained for deferred numeric expressions. */
  readonly createdAfterActionCount?: number;
  readonly modifier: ActiveNextActionModifier;
}

/** A turn-limited stat modifier whose resolved value remains in fight state. */
export interface ActiveStatModifierEffect {
  readonly id: ActiveEffectId;
  readonly type: "modify-stat";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly stat: "dexterity" | "dexterity-bonus";
  readonly operation: "add" | "set" | "multiply";
  readonly amount: number;
  readonly selector?: MoveSelectorCondition;
  readonly duration: {
    readonly type: "turns";
    readonly ownerCombatantId: CombatantId;
    readonly remaining: number;
  };
}

/** A temporary declarative override for a stat comparison condition. */
export interface ActiveStatComparisonEffect {
  readonly id: ActiveEffectId;
  readonly type: "set-stat-comparison";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly leftCombatantId: CombatantId;
  readonly rightCombatantId: CombatantId;
  readonly stat: "dexterity";
  readonly comparison: "higher-than";
  readonly duration: {
    readonly type: "turns";
    readonly ownerCombatantId: CombatantId;
    readonly remaining: number;
  };
}

/** A durable classification applied to matching future moves. */
export interface ActiveMoveClassificationEffect {
  readonly id: ActiveEffectId;
  readonly type: "modify-move-classification";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly sourceEffectIndex: number;
  readonly selector: MoveSelectorCondition;
  readonly classification:
    | { readonly type: "replace-style"; readonly style: "declared-style" }
    | { readonly type: "replace-style"; readonly style: "style-id"; readonly styleId: string };
  readonly duration:
    | {
        readonly type: "turns";
        readonly ownerCombatantId: CombatantId;
        readonly remaining: number;
      }
    | { readonly type: "combat" };
}

/** A durable advantage/disadvantage selection for the next matching roll. */
export interface ActiveRollSelectionEffect {
  readonly id: ActiveEffectId;
  readonly type: "set-roll-selection";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly sourceEffectIndex: number;
  readonly roll: "attack" | "defense";
  readonly diceCount: number;
  readonly selection: "highest" | "lowest";
  readonly selector?: MoveSelectorCondition;
  readonly duration: {
    readonly type: "next-roll";
    readonly combatantId: CombatantId;
    readonly roll: "attack" | "defense";
  };
}

/** A durable suppression of selected future effects from a target move. */
export interface ActiveSuppressionEffect {
  readonly id: ActiveEffectId;
  readonly type: "suppress";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly sourceEffectIndex?: number;
  readonly selector?: MoveSelectorCondition;
  /** When present, the declarative selector was resolved to one combat-local move. */
  readonly selectedMoveId?: MoveId;
  /** A requirement suppressed on the target's future move uses. */
  readonly requirement?: string;
  readonly aspects: readonly ("all-effects" | "successful-effects")[];
  readonly duration:
    | { readonly type: "combat" }
    | { readonly type: "turns"; readonly ownerCombatantId: CombatantId; readonly remaining: number }
    | {
        readonly type: "next-actions";
        readonly ownerCombatantId: CombatantId;
        readonly remaining: number;
      }
    | {
        readonly type: "following-action";
        readonly ownerCombatantId: CombatantId;
        readonly remaining: number;
      }
    | {
        readonly type: "until-roll-threshold";
        readonly combatantId: CombatantId;
        readonly roll: "attack";
        readonly comparison: "at-least" | "at-most";
        readonly value: number;
      };
  readonly useLimit?: { readonly scope: "combat" | "turn"; readonly count: number };
}

/** A selector-scoped damage modifier with an explicit combat lifecycle. */
export interface ActiveDamageModifierEffect {
  readonly id: ActiveEffectId;
  readonly type: "modify-damage";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly sourceEffectIndex?: number;
  readonly selector?: MoveSelectorCondition;
  /** When present, the selector was resolved to this immutable combat-local move choice. */
  readonly selectedMoveId?: MoveId;
  readonly operation: "add" | "multiply" | "set";
  /** Power-percent is resolved to damage points; damage-percent scales resolved damage. */
  readonly basis: "power-percent" | "damage-percent";
  readonly amount: number;
  readonly cap?: { readonly type: "maximum" | "minimum"; readonly value: number };
  readonly capOnly?: boolean;
  readonly availableFromTurn?: number;
  readonly duration:
    | { readonly type: "combat" }
    | { readonly type: "turns"; readonly ownerCombatantId: CombatantId; readonly remaining: number }
    | {
        readonly type: "until-roll-threshold";
        readonly combatantId: CombatantId;
        readonly roll: "attack";
        readonly comparison: "at-least" | "at-most";
        readonly value: number;
      };
}

/** A combat-item damage bonus retained until its declared attack uses are spent. */
export interface ActiveItemDamageModifierEffect {
  readonly id: ActiveEffectId;
  readonly type: "modify-item-next-attack-damage";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: ItemId;
  readonly amount: number;
  readonly remainingAttacks: number;
}

/** A serialized instruction limiting its target's immediately next action. */
export interface ActiveForcedActionEffect {
  readonly id: ActiveEffectId;
  readonly type: "force-next-action";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly allowedCategories: readonly ("advanced-attack" | "signature")[];
  readonly allowedTags?: readonly string[];
  readonly allowPass: boolean;
  readonly fallback?: "basic-attack";
  readonly selectedMoveStorageKey?: string;
}

/** A durable restriction on the target's choices during one or more future turns. */
export interface ActiveActionRestrictionEffect {
  readonly id: ActiveEffectId;
  readonly type: "action-restriction";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly sourceEffectIndex: number;
  /** Omitted means the target's entire action is skipped. */
  readonly blockedCategories?: readonly ("basic-attack" | "advanced-attack" | "signature")[];
  readonly availableFromTurn: number;
  readonly remainingTurns: number;
  readonly duration?: {
    readonly type: "until-turn-start-roll-threshold";
    readonly combatantId: CombatantId;
    readonly dice: number;
    readonly sides: number;
    readonly comparison: "at-least" | "at-most";
    readonly value: number;
    readonly remainingIgnoredChecks: number;
  };
}

/** A serialized, target-local prohibition created by a converted LOCK effect. */
export interface ActiveActionLockEffect {
  readonly id: ActiveEffectId;
  readonly type: "action-lock";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly affectedType: "attack" | "block" | "escape" | "mastery" | "move" | "power-up" | "skill";
  readonly selector?: MoveSelectorCondition;
  readonly duration:
    | { readonly type: "combat" }
    | { readonly type: "turns"; readonly ownerCombatantId: CombatantId; readonly remaining: number }
    | {
        readonly type: "next-actions";
        readonly ownerCombatantId: CombatantId;
        readonly remaining: number;
      }
    | {
        readonly type: "until-roll-threshold";
        readonly combatantId: CombatantId;
        readonly roll: CombatRollType;
        readonly comparison: "at-least" | "at-most";
        readonly value: number;
      }
    | {
        readonly type: "until-resource-threshold";
        readonly combatantId: CombatantId;
        readonly resource: "hp" | "ki";
        readonly comparison: "at-least" | "at-most";
        readonly value: number;
      }
    | {
        readonly type: "until-combat-result";
        readonly combatantId: CombatantId;
        readonly result: "successful" | "stopped" | "critical" | "counter";
        readonly selector?: MoveSelectorCondition;
      }
    | {
        readonly type: "until-turn-start-roll-threshold";
        readonly combatantId: CombatantId;
        readonly dice: number;
        readonly sides: number;
        readonly comparison: "at-least" | "at-most";
        readonly value: number;
        readonly remainingIgnoredChecks: number;
      };
}

/** A selector-scoped prevention retained independently from ordinary action locks. */
export interface ActiveMoveUsePreventionEffect {
  readonly id: ActiveEffectId;
  readonly type: "prevent-move-use";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly operation: "use" | "activate" | "deactivate";
  readonly selector?: MoveSelectorCondition;
  readonly duration: ActiveActionLockEffect["duration"];
}

/** A duration-bound prohibition on applying a specific combat status. */
export interface ActiveStatusPreventionEffect {
  readonly id: ActiveEffectId;
  readonly type: "prevent-status";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly statusId: StatusId;
  readonly duration: ActiveActionLockEffect["duration"];
}

/** A duration-bound prohibition on a combat result earned by its target. */
export interface ActiveCombatResultPreventionEffect {
  readonly id: ActiveEffectId;
  readonly type: "prevent-combat-result";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly result: "critical" | "counter" | "sever";
  readonly selector?: MoveSelectorCondition;
  readonly duration: ActiveActionLockEffect["duration"];
}

/** Prevents matching attack or defense roll modifiers while its duration remains active. */
export interface ActiveRollModificationPreventionEffect {
  readonly id: ActiveEffectId;
  readonly type: "prevent-roll-modification";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly roll: CombatRollType;
  readonly modifier: "dice" | "result" | "sides" | "any";
  readonly selector?: MoveSelectorCondition;
  /** Allows the effect that established this prevention to make its declared exception. */
  readonly exemptSourceEffect?: boolean;
  readonly duration: ActiveActionLockEffect["duration"];
}

/** Prevents selected cost modifiers from changing a matching move. */
export interface ActiveMoveModificationPreventionEffect {
  readonly id: ActiveEffectId;
  readonly type: "prevent-move-modification";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly actor: "self" | "opponent" | "any";
  readonly aspects: readonly ("cost" | "damage" | "dice-sides" | "effects" | "roll-results")[];
  readonly effectSourceStyleExcludes?: string;
  readonly exceptSourceMoveIds?: readonly string[];
  readonly exceptSourceStatusIds?: readonly StatusId[];
  readonly operations?: readonly "reduce"[];
  /** First turn on which a next-turn scoped prevention can affect actions. */
  readonly availableFromTurn?: number;
  readonly selector: MoveSelectorCondition;
  readonly duration: ActiveActionLockEffect["duration"];
}

/** A durable prohibition against a matching HP or KI change. */
export interface ActiveResourceModificationPreventionEffect {
  readonly id: ActiveEffectId;
  readonly type: "prevent-resource-modification";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly resource: "hp" | "ki";
  readonly operation: "gain" | "lose" | "set";
  readonly sourceActor?: "opponent";
  readonly exceptAction?: "power-up";
  /** First turn on which a next-turn scoped prevention can affect changes. */
  readonly availableFromTurn?: number;
  readonly duration: ActiveActionLockEffect["duration"];
}

/** A combat-local CONSTANT Skill that has been explicitly activated by its owner. */
export interface ActiveConstantEffect {
  readonly id: ActiveEffectId;
  readonly type: "active-constant";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly activatedOnTurn: number;
  readonly duration: "combat";
  /** The literal KI cost paid when this CONSTANT Skill was activated. */
  readonly paidActivationCost?: number;
  /** Selection identity retained for effects that refer to this activation group. */
  readonly selectionKey?: string;
  /** Omitted legacy values are active; deactivation remains durable for reactivation effects. */
  readonly lifecycle?: "active" | "deactivated";
  readonly deactivatedOnTurn?: number;
  /** A temporary immutable replacement for this constant's effects. */
  readonly replacement?: {
    readonly sourceDefinitionId: MoveId;
    readonly sourceMoveSnapshot: MoveDefinition;
    readonly duration: {
      readonly type: "turns";
      readonly ownerCombatantId: CombatantId;
      readonly remaining: number;
    };
  };
}

/** A typed declarative effect bundle that remains active until its scope or termination rule ends. */
export interface ActiveFloatingEffect {
  readonly id: ActiveEffectId;
  readonly type: "floating-effect";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  /** Target retained for nested target-relation conditions, when distinct from the bundle recipient. */
  readonly targetRelationCombatantId?: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly sourceEffectIndex?: number;
  /** Immutable damage snapshot captured when a blocked-attack bundle is created. */
  readonly blockedAttackDamage?: number;
  readonly floatingEffectId: string;
  readonly effects: readonly EffectDefinition[];
  readonly termination: readonly {
    readonly trigger: "on-power-up" | "on-stopped" | "on-success";
    readonly actor: "self" | "opponent";
    readonly selector?: MoveSelectorCondition;
  }[];
  readonly duration?:
    | {
        readonly type: "until-combat-result";
        readonly combatantId: CombatantId;
        readonly result: "successful" | "stopped" | "critical" | "counter";
        readonly moveSelector?: MoveSelectorCondition;
        readonly rollThreshold?: {
          readonly roll: "attack" | "defense" | "transformation";
          readonly comparison: "at-least" | "at-most";
          readonly value: number;
        };
      }
    | {
        readonly type: "until-roll-threshold";
        readonly combatantId: CombatantId;
        readonly roll: "attack" | "defense";
        readonly comparison: "at-least" | "at-most";
        readonly value: number;
        readonly moveSelector?: MoveSelectorCondition;
      };
  readonly stacking?: "allow" | "prevent";
  readonly scope:
    | { readonly type: "combat" }
    | { readonly type: "next-action" }
    | { readonly type: "next-turn"; readonly combatantId: CombatantId };
  readonly createdOnTurn: number;
}

/** A durable allowance for one or more declaratively eligible extra actions. */
export interface ActiveExtraActionEffect {
  readonly id: ActiveEffectId;
  readonly type: "extra-action";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly sourceEffectIndex: number;
  readonly phase: "action" | "upkeep";
  readonly moveCategory?: "advanced-attack" | "item-use" | "skill" | "power-up";
  readonly sourceMoveOnly: boolean;
  readonly constant?: boolean;
  readonly remainingActions: number;
  readonly availableFromTurn: number;
  readonly expiresAfterTurn: number;
  /** A future upkeep allowance that has not yet been paid for or activated. */
  readonly activationCost?: {
    /** Optional only for pre-CE-220 snapshots. */
    readonly timing?: EffectCostTiming;
    readonly resource: "ki";
    readonly amount: number;
    readonly minimum?: number;
  };
  readonly useLimit?: { readonly scope: "combat" | "turn"; readonly count: number };
}

/** Serializable future resource work owned by the generic combat scheduler. */
export interface ActiveScheduledResourceEffect {
  readonly id: ActiveEffectId;
  readonly type: "scheduled-resource";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly sourceEffectIndex: number;
  readonly timing: {
    readonly type: "turn-start" | "turn-end" | "phase-start";
    readonly combatantId: CombatantId;
    readonly phase?: "upkeep" | "action" | "end";
  };
  readonly remainingBoundaries: number;
  readonly repeat: "once" | "each-turn";
  readonly resource: "hp" | "ki";
  readonly operation: "damage" | "drain" | "gain" | "lose" | "set";
  readonly amount: NumericExpression;
  readonly stacking?: "prevent";
  readonly duration?:
    | { readonly type: "turns"; readonly remaining: number }
    | {
        readonly type: "until-roll-threshold";
        readonly combatantId: CombatantId;
        readonly roll: CombatRollType;
        readonly comparison: "at-least" | "at-most";
        readonly value: number;
        readonly moveSelector?: MoveSelectorCondition;
      };
  readonly cancellation?: {
    readonly actorCombatantId: CombatantId;
    readonly result: "successful" | "stopped";
    readonly moveSelector: MoveSelectorCondition;
    readonly target: "source" | "other-than-source";
    readonly rollThreshold?: {
      readonly roll: CombatRollType;
      readonly comparison: "at-least" | "at-most";
      readonly value: number;
    };
  };
}

/** A move declaration retained until its owner's next eligible turn. */
export interface ActiveDeferredMoveEffect {
  readonly id: ActiveEffectId;
  readonly type: "deferred-move";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly sourceEffectIndex: number;
  readonly declarationDecisionId: CombatDecisionId;
  readonly performOnTurn: number;
  readonly damageOverridePercent?: number;
  readonly cancellation: {
    readonly actorCombatantId: CombatantId;
    readonly result: "successful";
  };
  readonly onCancellation?: {
    readonly affectedType: "attack";
    readonly duration: "combat";
  };
}

/** A move removed from a combatant's current combat-local moveset. */
export interface ActiveMoveRemovalEffect {
  readonly id: ActiveEffectId;
  readonly type: "remove-move-from-combat";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly sourceEffectIndex: number;
  readonly moveId: MoveId;
  readonly removedFromIndex: number;
  readonly duration:
    "combat" | { readonly type: "until-perfect-roll"; readonly combatantId: CombatantId };
}

/** A combat-local replacement for one effect on one immutable move definition. */
export interface ActiveMoveEffectReplacementEffect {
  readonly id: ActiveEffectId;
  readonly type: "move-effect-replacement";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly sourceEffectIndex: number;
  readonly targetMoveId: MoveId;
  readonly replacement: EffectDefinition;
  readonly remainingTriggers: number;
}

/** A forced transformation stability roll retained until the target's next upkeep. */
export interface ActiveTransformationRollRequirementEffect {
  readonly id: ActiveEffectId;
  readonly type: "require-transformation-roll";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly sourceEffectIndex: number;
  readonly ignoreTransformationDice: true;
}

/** A pending Evening The Field reactivation tied to the opponent's next single-die attack. */
export interface ActiveExchangeSkillReactivationEffect {
  readonly id: ActiveEffectId;
  readonly type: "exchange-skill-reactivation";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly deactivatedEffectId: ActiveEffectId;
  readonly attackSelector: MoveSelectorCondition;
}

/** The cooldown created after an Evening The Field exchange resolves. */
export interface ActiveExchangeSkillCooldownEffect {
  readonly id: ActiveEffectId;
  readonly type: "exchange-skill-cooldown";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly remainingTurns: number;
}

export type ActiveCombatEffect = (
  | ActiveCostModifierEffect
  | ActiveRollModifierEffect
  | ActiveRollModifierTransformerEffect
  | ActiveRollSelectionEffect
  | ActiveRerollEffect
  | ActiveResolutionThresholdEffect
  | ActiveNextActionModifierEffect
  | ActiveDamageModifierEffect
  | ActiveStatModifierEffect
  | ActiveStatComparisonEffect
  | ActiveMoveClassificationEffect
  | ActiveSuppressionEffect
  | ActiveItemDamageModifierEffect
  | ActiveForcedActionEffect
  | ActiveActionRestrictionEffect
  | ActiveActionLockEffect
  | ActiveMoveUsePreventionEffect
  | ActiveStatusPreventionEffect
  | ActiveCombatResultPreventionEffect
  | ActiveRollModificationPreventionEffect
  | ActiveMoveModificationPreventionEffect
  | ActiveResourceModificationPreventionEffect
  | ActiveConstantEffect
  | ActiveFloatingEffect
  | ActiveExtraActionEffect
  | ActiveScheduledResourceEffect
  | ActiveDeferredMoveEffect
  | ActiveMoveRemovalEffect
  | ActiveMoveEffectReplacementEffect
  | ActiveTransformationRollRequirementEffect
  | ActiveExchangeSkillReactivationEffect
  | ActiveExchangeSkillCooldownEffect
) &
  ActiveEffectConflictMetadata;

/**
 * An effective resource change retained with the action that caused it.
 * Absolute combatant identity keeps historical conditions deterministic when
 * the same action is later evaluated from the other combatant's perspective.
 */
export interface ResourceChangeHistoryRecord {
  readonly affectedCombatantId: CombatantId;
  readonly resource: "hp" | "ki";
  readonly operation: "gain" | "lose";
  readonly amount: number;
  readonly turnNumber: number;
  readonly sourceCombatantId?: CombatantId;
  readonly sourceDefinitionId?: MoveId;
  readonly sourceEffectIndex?: number;
  readonly cause?: "non-damage-effect" | "opponent-effect";
  readonly sourceStyleId?: string;
}

/**
 * A completed player action, retained as minimal rule-relevant history rather
 * than reconstructed from display-oriented combat events.
 */
export type CombatActionRecord =
  | {
      /** An implicit action boundary caused by a status or full-action restriction. */
      readonly type: "turn-skipped";
      readonly actorId: CombatantId;
      readonly turnNumber: number;
      readonly phase: "action";
      readonly reason: "status" | "effect";
    }
  | {
      readonly type: "activate-transformation" | "pass" | "power-up" | "surrender";
      readonly decisionId: CombatDecisionId;
      readonly actorId: CombatantId;
      readonly turnNumber: number;
      readonly phase: "action" | "counter";
    }
  | {
      readonly type: "basic-attack";
      readonly decisionId: CombatDecisionId;
      readonly actorId: CombatantId;
      readonly targetCombatantId: CombatantId;
      readonly basicAttack: BasicAttackType;
      readonly outcome?: "successful" | "stopped";
      readonly critical?: boolean;
      readonly counter?: boolean;
      /** A single-die attack's resolved result, when the action produced one. */
      readonly attackRollResult?: number;
      /** A single-die defense roll's resolved result, when the action produced one. */
      readonly defenseRollResult?: number;
      /** Damage dealt by the completed attack, when it resolved damage. */
      readonly damageDealt?: number;
      /** Immutable source-resolution data available to exact prior-attack copies. */
      readonly resolutionSnapshot?: AttackResolutionSnapshot;
      readonly resourceChanges?: readonly ResourceChangeHistoryRecord[];
      readonly turnNumber: number;
      readonly phase: "action" | "counter";
    }
  | {
      readonly type: "use-move";
      readonly decisionId: CombatDecisionId;
      readonly actorId: CombatantId;
      readonly targetCombatantId: CombatantId;
      readonly moveId: MoveId;
      readonly outcome?: "successful" | "stopped";
      readonly critical?: boolean;
      readonly counter?: boolean;
      /** A single-die attack's resolved result, when the action produced one. */
      readonly attackRollResult?: number;
      /** A single-die defense roll's resolved result, when the action produced one. */
      readonly defenseRollResult?: number;
      /** Damage dealt by the completed attack, when it resolved damage. */
      readonly damageDealt?: number;
      /** Immutable source-resolution data available to exact prior-attack copies. */
      readonly resolutionSnapshot?: AttackResolutionSnapshot;
      readonly resourceChanges?: readonly ResourceChangeHistoryRecord[];
      readonly turnNumber: number;
      readonly phase: "action" | "counter";
    }
  | {
      readonly type: "use-item";
      readonly decisionId: CombatDecisionId;
      readonly actorId: CombatantId;
      readonly itemId: ItemId;
      readonly turnNumber: number;
      readonly phase: "action" | "counter";
    };

/**
 * Serializable suspended work. Concrete stages are intentionally narrow and
 * will be widened only by the attack, counter, and effect-resolution slices.
 */
export interface CopiedMoveAttackReference {
  readonly type: "move";
  readonly moveId: MoveId;
  /** The immutable source move snapshot used to reconstruct a copied attack. */
  readonly copiedFromMoveId?: MoveId;
  /** Immutable source definition retained for deterministic suspended resolution. */
  readonly copiedSourceMove?: MoveDefinition;
  /** The declarative additive Power percentage applied by the copying move. */
  readonly copiedDamageBonusPercent?: number;
  /** Fixed damage captured from the selected prior source action. */
  readonly copiedDamageOverride?: number;
  /** Whether only the source move's SUCCESSFUL clauses were copied. */
  readonly copiedSuccessfulEffectsOnly?: boolean;
  /** Whether the current attack keeps its mechanics while replacing effects. */
  readonly copiedEffectsOnly?: boolean;
  /** Immutable source attack-resolution snapshot for exact prior-attack copies. */
  readonly copiedSourceResolution?: AttackResolutionSnapshot;
}

/**
 * Deterministic source-side attack data retained for a copy effect that
 * explicitly repeats a completed attack's cost, dice, and modifiers.
 */
export interface AttackResolutionSnapshot {
  readonly paidKiCost: number;
  readonly attack: { readonly dice: number; readonly sides: number };
  readonly blockedDice: number;
  readonly attackResultModifier: number;
  readonly defenseSides: number;
  readonly defenseResultModifier: number;
  readonly baseDamage: number;
  readonly damagePerHit: boolean;
  readonly naturalAttackRolls: readonly number[];
  readonly naturalDefenseRolls: readonly (number | undefined)[];
  readonly criticalThresholds: readonly {
    readonly threshold: number;
    readonly basis: "natural-result" | "final-result";
  }[];
  readonly resolutionThresholds: readonly {
    readonly outcome: "successful" | "stopped";
    readonly roll: "attack" | "defense";
    readonly comparison: "at-least" | "at-most";
    readonly value: number;
    readonly relativeTo?: "attack-roll" | "defense-roll";
    readonly relativeOperation?: "add" | "multiply";
    readonly resultScope: "current-attack" | "matching-die";
  }[];
  readonly resultOverrides: readonly ("stopped" | "successful" | undefined)[];
  readonly numericResultOverrides: readonly (
    { readonly attack?: number; readonly defense?: number } | undefined
  )[];
  readonly preventCritical: boolean;
  readonly preventCounter: boolean;
}

/** Serialized counter permission that must survive the transition into COUNTER. */
export interface CounterActionReference {
  readonly action: "choose-attack" | "repeat-triggering-attack" | "use-source-attack";
  readonly sourceDefinitionId: MoveId;
  readonly sourceEffectIndex: number;
  readonly stopsTriggeringAttack: boolean;
  readonly ignoreRequirements: boolean;
  readonly activationCost?: {
    /** Optional only for pre-CE-220 snapshots. */
    readonly timing?: EffectCostTiming;
    readonly resource: "ki";
    readonly amount: number;
    readonly minimum?: number;
  };
  readonly costModifier?: {
    readonly operation: "add" | "set";
    readonly amount: number;
    readonly minimum?: number;
  };
  readonly sourceAction?: Extract<
    CombatActionRecord,
    { readonly type: "basic-attack" | "use-move" }
  >;
  readonly sourceMoveSnapshot?: MoveDefinition;
}

export type ResolutionFrame =
  | {
      readonly id: ResolutionFrameId;
      readonly type: "attack";
      readonly decisionId: CombatDecisionId;
      readonly attackerId: CombatantId;
      readonly targetCombatantId: CombatantId;
      readonly returnPhase: "action" | "counter";
      readonly stage: "awaiting-counter";
      readonly counterAction?: CounterActionReference;
    }
  | {
      readonly id: ResolutionFrameId;
      readonly type: "attack";
      readonly decisionId: CombatDecisionId;
      readonly attackerId: CombatantId;
      readonly targetCombatantId: CombatantId;
      readonly returnPhase: "action" | "counter";
      readonly stage: "awaiting-defense";
      readonly pendingDecisionId: PendingDecisionId;
      readonly attack:
        | { readonly type: "basic-attack"; readonly basicAttack: BasicAttackType }
        | CopiedMoveAttackReference;
      readonly enabledOptionalEffectIndices?: readonly number[];
      readonly resolvedOptionalEffectIndices?: readonly number[];
      /** Selected on-move-use cost listener source and effects, retained through defense. */
      readonly costEffectSourceDefinitionId?: MoveId;
      readonly costEffectIndices?: readonly number[];
      readonly costEffectTrigger?: "on-move-use" | "on-cost-modified";
      readonly costEffectOwnerId?: CombatantId;
      /** Defender-owned before-defense reroll choices retained through the defense response. */
      readonly beforeDefenseEffectChoices?: readonly {
        readonly sourceDefinitionId: MoveId;
        readonly effectIndices: readonly number[];
        readonly sacrificedMoveId?: MoveId;
        readonly sourceActionId?: CombatDecisionId;
        readonly sourceMoveSnapshot?: MoveDefinition;
      }[];
      readonly deferredExecution?: {
        readonly activeEffectId: ActiveEffectId;
        readonly declarationDecisionId: CombatDecisionId;
        readonly damageOverridePercent?: number;
      };
    }
  | {
      readonly id: ResolutionFrameId;
      readonly type: "attack";
      readonly decisionId: CombatDecisionId;
      readonly attackerId: CombatantId;
      readonly targetCombatantId: CombatantId;
      readonly returnPhase: "action" | "counter";
      readonly stage: "awaiting-post-defense-reaction";
      readonly pendingDecisionId?: PendingDecisionId;
      /** The participant who must select the currently offered after-roll reaction. */
      readonly reactionCombatantId: CombatantId;
      readonly attack:
        | { readonly type: "basic-attack"; readonly basicAttack: BasicAttackType }
        | CopiedMoveAttackReference;
      /** All rolled dice are persisted before an after-roll reaction can modify resolution. */
      readonly naturalRolls: readonly { readonly attack: number; readonly defense: number }[];
      /** Declarative after-defense effects resolved from the persisted roll results. */
      readonly resultOverrides: readonly ("stopped" | "successful" | undefined)[];
      /** Numeric substitutions established before the contest, retained for deterministic replay. */
      readonly numericResultOverrides: readonly (
        { readonly attack?: number; readonly defense?: number } | undefined
      )[];
    }
  | {
      readonly id: ResolutionFrameId;
      readonly type: "attack";
      readonly decisionId: CombatDecisionId;
      readonly attackerId: CombatantId;
      readonly targetCombatantId: CombatantId;
      readonly returnPhase: "action" | "counter";
      readonly stage: "awaiting-effect-choice";
      readonly pendingDecisionId: PendingDecisionId;
      readonly attack: CopiedMoveAttackReference;
      readonly effectIndices: readonly number[];
      /** Normalized selection semantics retained for a resumable attack choice. */
      readonly selection?: EffectSelection;
      /** Whether this serialized attack choice may be declined. */
      readonly optional?: boolean;
      /** Activation-cost timing retained across the suspended attack. */
      readonly costTiming?: EffectCostTiming;
      /** Alternative effect-index sets for an exclusive activation group. */
      readonly effectAlternatives?: readonly (readonly number[])[];
      readonly resolvedEffectIndices: readonly number[];
      readonly enabledEffectIndices: readonly number[];
      /** Move selections retained for selected suppression effects before resuming the attack. */
      readonly selectedSuppressionMoves?: readonly {
        readonly effectIndex: number;
        readonly moveId: MoveId;
      }[];
      /** Move selections retained for grouped effects that target one move. */
      readonly selectedMoveTargets?: readonly {
        readonly effectIndex: number;
        readonly moveId: MoveId;
      }[];
      /** Source move for a selected cost listener that is not the attack move. */
      readonly effectSourceDefinitionId?: MoveId;
      /** Combatant owning a selected move-use listener that is not the attacker. */
      readonly effectSourceCombatantId?: CombatantId;
      readonly selectedNumericValues?: Readonly<Record<string, number>>;
      /** Active floating effect selected by an exact end-floating-effect choice. */
      readonly selectedFloatingEffectId?: ActiveEffectId;
      /** Candidate floating effects retained while an end-floating-effect choice is pending. */
      readonly floatingEffectIds?: readonly ActiveEffectId[];
      /** The trigger whose grouped effects are awaiting the acting player's choice. */
      readonly effectTrigger?:
        | "before-attack-roll"
        | "on-success"
        | "on-move-use"
        | "on-cost-modified"
        | "on-roll-modified"
        | "start-combat"
        | "on-damage";
      /** Natural rolls are retained when the choice occurs after the attack roll. */
      readonly naturalRolls?: readonly { readonly attack: number; readonly defense?: number }[];
      readonly blockedDice?: number;
      readonly block?: {
        readonly blockId: MoveId;
        readonly cost: number;
        readonly responseDecisionId: CombatDecisionId;
      };
      readonly defenseItem?: {
        readonly itemId: ItemId;
        readonly responseDecisionId: CombatDecisionId;
        readonly preventedStatuses?: readonly ("break" | "sever")[];
      };
      readonly defenseResultModifier?: number;
      readonly preventCritical?: boolean;
      readonly preventCounter?: boolean;
      readonly resultOverrides?: readonly ("stopped" | "successful" | undefined)[];
      readonly numericResultOverrides?: readonly (
        { readonly attack?: number; readonly defense?: number } | undefined
      )[];
      readonly priorEnabledOptionalEffectIndices?: readonly number[];
      readonly priorResolvedOptionalEffectIndices?: readonly number[];
      readonly enabledAfterDefenseEffectIndices?: readonly number[];
      /** Roll events are already emitted when this is false. */
      readonly includeRollEvents?: boolean;
    }
  | {
      readonly id: ResolutionFrameId;
      readonly type: "effect-choice";
      readonly decisionId: CombatDecisionId;
      readonly actorId: CombatantId;
      readonly targetCombatantId: CombatantId;
      readonly returnPhase: "action" | "end" | "upkeep";
      readonly pendingDecisionId?: PendingDecisionId;
      readonly sourceDefinitionId: MoveId;
      /** Action move being resumed when the selected listener is a different source. */
      readonly actionMoveId?: MoveId;
      readonly sourceCombatantId?: CombatantId;
      readonly effectIndices: readonly number[];
      readonly effectTrigger:
        | "action-phase"
        | "on-power-up"
        | "on-roll-result"
        | "on-move-use"
        | "upkeep-phase"
        | "start-combat";
      /** Selected indices are replayed by the owning phase before the frame is removed. */
      readonly selectedEffectIndices?: readonly number[];
      readonly resolved?: boolean;
      /** Stored roll results are retained when an on-roll-result choice pauses a simple action. */
      readonly storedRolls?: readonly StoredRoll[];
    }
  | {
      readonly id: ResolutionFrameId;
      readonly type: "effect";
      /** The original action decision that opened a copied-move selection. */
      readonly decisionId?: CombatDecisionId;
      readonly sourceCombatantId: CombatantId;
      readonly targetCombatantId: CombatantId;
      readonly sourceDefinitionId: string;
      readonly effectIndex: number;
      /** Legacy effect frames omitted this field and represent deactivation. */
      readonly operation?:
        | "activate"
        | "deactivate"
        | "activate-extra-action"
        | "copy-move"
        | "negate-deactivation"
        | "replace-constant"
        | "select-damage-target"
        | "select-suppression-target"
        | "select-move-target"
        | "select-move-removal"
        | "defer-move";
      readonly returnPhase: CombatPhase;
      readonly trigger:
        | "upkeep"
        | "action"
        | "end"
        | "on-success"
        | "on-stopped"
        | "before-attack-roll"
        | "start-combat"
        | "on-roll-result";
      readonly pendingDecisionId?: PendingDecisionId;
      readonly eligibleMoveIds?: readonly MoveId[];
      /** Prior completed source actions offered by a selected-prior copy effect. */
      readonly eligibleSourceActionIds?: readonly CombatDecisionId[];
      readonly remainingSelections?: number;
      /** Normalized declarative selection retained across a resumed frame. */
      readonly selection?: EffectSelection;
      /** Whether this serialized selection may be declined by its acting combatant. */
      readonly optional?: boolean;
      /** Whether activation choices must reuse constants in the deactivated lifecycle. */
      readonly reactivationOnly?: boolean;
      /** Whether reactivation is restricted to constants deactivated on the immediately prior turn. */
      readonly reactivationTiming?: "last-turn";
      /** Turns during which the selected constant cannot be deactivated. */
      readonly deactivationProtectionTurns?: number;
      /** Resolved declarative KI activation cost retained across the pending choice. */
      readonly activationCost?: {
        /** Optional for pre-CE-220 snapshots; new frames always persist it. */
        readonly timing?: EffectCostTiming;
        readonly amount: number;
        readonly minimum?: number;
        readonly resource?: "hp" | "ki";
      };
      /** Cost timing is optional only when reading a pre-CE-220 snapshot. */
      readonly costTiming?: EffectCostTiming;
      /** Absolute KI activation cost retained across a paired current-cost set effect. */
      readonly activationCostOverride?: number;
      /** The durable allowance being resolved by an extra-action activation choice. */
      readonly activeEffectId?: ActiveEffectId;
      /** Activation context retained across the serialized CONSTANT choice. */
      readonly activationAsIf?: "power-up";
      /** Original attack resumed after an action-phase activation choice. */
      readonly activationContinuation?: {
        readonly decisionId: CombatDecisionId;
        readonly targetCombatantId: CombatantId;
      };
      /** The activation consumes every eligible CONSTANT Skill in one group. */
      readonly activationSelection?: "all";
      /** The active constant whose deactivation is awaiting an optional negation response. */
      readonly deactivationEffectId?: ActiveEffectId;
      /** The exact listener choices retained for this deactivation boundary. */
      readonly deactivationNegations?: readonly {
        readonly sourceDefinitionId: MoveId;
        readonly sourceEffectIndex: number;
        readonly useLimit?: { readonly scope: "combat"; readonly count: number };
      }[];
      /** Original deactivation operation resumed after the owner answers. */
      readonly deactivationContinuation?: {
        readonly sourceCombatantId: CombatantId;
        readonly targetCombatantId: CombatantId;
        readonly sourceDefinitionId: MoveId;
        readonly effectIndex: number;
        readonly trigger: "upkeep" | "action" | "end" | "on-success" | "on-stopped";
        readonly eligibleMoveIds: readonly MoveId[];
        readonly excludedMoveIds?: readonly MoveId[];
        readonly remainingSelections: number;
        readonly optional: boolean;
        readonly activationCost?: {
          readonly timing?: EffectCostTiming;
          readonly amount: number;
          readonly minimum?: number;
          readonly resource?: "hp" | "ki";
        };
        /** Additional deactivation applications from one compound effect. */
        readonly remainingApplications?: readonly {
          readonly target: "self" | "opponent";
          readonly affectedType: "skill" | "transformation";
          readonly selection: "one" | "all";
          readonly optional: boolean;
          readonly selector?: MoveSelectorCondition;
          readonly count?: number;
          readonly activationCost?: {
            readonly timing?: EffectCostTiming;
            readonly resource: "hp" | "ki";
            readonly amount: number;
            readonly minimum?: number;
          };
          readonly sourceDefinitionId: string;
          readonly sourceText: string;
        }[];
      };
      /** Additional deactivation applications awaiting this selection. */
      readonly remainingDeactivationApplications?: readonly {
        readonly target: "self" | "opponent";
        readonly affectedType: "skill" | "transformation";
        readonly selection: "one" | "all";
        readonly optional: boolean;
        readonly selector?: MoveSelectorCondition;
        readonly count?: number;
        readonly activationCost?: {
          readonly timing?: EffectCostTiming;
          readonly resource: "hp" | "ki";
          readonly amount: number;
          readonly minimum?: number;
        };
        readonly sourceDefinitionId: string;
        readonly sourceText: string;
      }[];
      /** Reactivation and cooldown metadata for Evening The Field. */
      readonly exchangeSkillReactivation?: {
        readonly sourceCombatantId: CombatantId;
        readonly targetCombatantId: CombatantId;
        readonly sourceDefinitionId: MoveId;
        readonly selfSelector: MoveSelectorCondition;
        readonly attackSelector: MoveSelectorCondition;
      };
      /** Selection identity retained on every CONSTANT Skill activated by this frame. */
      readonly selectionKey?: string;
      /** Immutable source and target selections retained while replacing a constant's effects. */
      readonly replacementSourceMoveSnapshot?: MoveDefinition;
      readonly replacementTargetEffectId?: ActiveEffectId;
      /** Lifecycle choices remain as a resolved marker until their phase boundary resumes. */
      readonly resolved?: boolean;
    };

interface FightStateBase {
  readonly id: FightId;
  readonly version: number;
  readonly rulesVersion: RulesVersion;
  readonly mode: CombatMode;
  readonly turnNumber: number;
  readonly combatants: Readonly<Record<CombatantId, CombatantState>>;
  readonly activeEffects: readonly ActiveCombatEffect[];
  readonly actionHistory: readonly CombatActionRecord[];
  readonly resolutionFrames: readonly ResolutionFrame[];
  readonly eventSequence: number;
}

export interface ActiveFightState extends FightStateBase {
  readonly status: "active";
  readonly phase: CombatPhase;
  readonly activeCombatantId: CombatantId;
  readonly pendingDecision?: PendingDecision;
}

export interface CompletedFightState extends FightStateBase {
  readonly status: "completed";
  readonly completion: {
    readonly type: "cancelled" | "defeat" | "surrender";
    readonly winnerCombatantId?: CombatantId;
  };
}

export type FightState = ActiveFightState | CompletedFightState;

export interface FightStateInvariantViolation {
  readonly type:
    | "invalid-active-combatant"
    | "invalid-active-effect"
    | "invalid-action-history"
    | "invalid-combatant-count"
    | "invalid-combatant-identity"
    | "invalid-combatant-state"
    | "invalid-completion"
    | "invalid-resolution-frame"
    | "invalid-pending-decision"
    | "invalid-resource"
    | "invalid-rules-version"
    | "invalid-state-counter"
    | "invalid-stat"
    | "invalid-status"
    | "invalid-slot-capacity"
    | "invalid-transformation"
    | "invalid-use-count";
  readonly message: string;
  readonly subject?: string;
}

export interface PassDecision {
  readonly type: "pass";
  readonly id: CombatDecisionId;
  readonly actorId: CombatantId;
  readonly expectedStateVersion: number;
}

export interface PowerUpDecision {
  readonly type: "power-up";
  readonly id: CombatDecisionId;
  readonly actorId: CombatantId;
  readonly expectedStateVersion: number;
}

export interface SurrenderDecision {
  readonly type: "surrender";
  readonly id: CombatDecisionId;
  readonly actorId: CombatantId;
  readonly expectedStateVersion: number;
}

/** Authorization for moderator cancellation belongs to the calling application. */
export interface CancelFightDecision {
  readonly type: "cancel-fight";
  readonly id: CombatDecisionId;
  readonly expectedStateVersion: number;
}

export type BasicAttackType = "basic-punch" | "basic-kick" | "basic-ki-blast";

export interface BasicAttackDecision {
  readonly type: "basic-attack";
  readonly id: CombatDecisionId;
  readonly actorId: CombatantId;
  readonly expectedStateVersion: number;
  readonly basicAttack: BasicAttackType;
  readonly targetCombatantId: CombatantId;
}

export interface UseMoveDecision {
  readonly type: "use-move";
  readonly id: CombatDecisionId;
  readonly actorId: CombatantId;
  readonly expectedStateVersion: number;
  readonly moveId: MoveId;
  readonly targetCombatantId: CombatantId;
}

export interface ActivateTransformationDecision {
  readonly type: "activate-transformation";
  readonly id: CombatDecisionId;
  readonly actorId: CombatantId;
  readonly expectedStateVersion: number;
  readonly transformationId: TransformationId;
}

export interface UseItemDecision {
  readonly type: "use-item";
  readonly id: CombatDecisionId;
  readonly actorId: CombatantId;
  readonly expectedStateVersion: number;
  readonly itemId: ItemId;
}

export interface RespondToPendingDecision {
  readonly type: "respond-to-pending-decision";
  readonly id: CombatDecisionId;
  readonly actorId: CombatantId;
  readonly expectedStateVersion: number;
  readonly pendingDecisionId: PendingDecisionId;
  readonly optionId: string;
  /** Additional option IDs for a generic up-to/all selection. */
  readonly optionIds?: readonly string[];
}

export type CombatDecision =
  | PassDecision
  | PowerUpDecision
  | SurrenderDecision
  | CancelFightDecision
  | BasicAttackDecision
  | UseMoveDecision
  | ActivateTransformationDecision
  | UseItemDecision
  | RespondToPendingDecision;

export type LegalDecision =
  | {
      readonly type: "pass";
      readonly actorId: CombatantId;
    }
  | {
      readonly type: "power-up";
      readonly actorId: CombatantId;
    }
  | {
      readonly type: "surrender";
      readonly actorId: CombatantId;
    }
  | {
      readonly type: "basic-attack";
      readonly actorId: CombatantId;
      readonly basicAttack: BasicAttackType;
      readonly targetCombatantId: CombatantId;
    }
  | {
      readonly type: "use-move";
      readonly actorId: CombatantId;
      readonly moveId: MoveId;
      readonly targetCombatantId: CombatantId;
    }
  | {
      readonly type: "activate-transformation";
      readonly actorId: CombatantId;
      readonly transformationId: TransformationId;
    }
  | {
      readonly type: "use-item";
      readonly actorId: CombatantId;
      readonly itemId: ItemId;
    }
  | {
      readonly type: "respond-to-pending-decision";
      readonly actorId: CombatantId;
      readonly pendingDecisionId: PendingDecisionId;
      readonly optionId: string;
    };

export interface CombatEventBase {
  readonly id: CombatEventId;
  readonly sequence: number;
  readonly fightId: FightId;
  readonly causedByDecisionId?: CombatDecisionId;
  readonly causedByEffectId?: ActiveEffectId;
  readonly sourceDefinitionId?: string;
}

export interface FightStartedEvent extends CombatEventBase {
  readonly type: "fight-started";
  readonly mode: CombatMode;
}

export interface TurnStartedEvent extends CombatEventBase {
  readonly type: "turn-started";
  readonly combatantId: CombatantId;
  readonly turnNumber: number;
}

export interface InitiativeRolledEvent extends CombatEventBase {
  readonly type: "initiative-rolled";
  readonly combatantId: CombatantId;
  readonly naturalResult?: number;
  readonly result: number;
}

export interface PhaseChangedEvent extends CombatEventBase {
  readonly type: "phase-changed";
  readonly phase: CombatPhase;
}

export interface MoveUsedEvent extends CombatEventBase {
  readonly type: "move-used";
  readonly combatantId: CombatantId;
  readonly moveId: MoveId;
  readonly targetCombatantId: CombatantId;
}

export interface MoveUseLimitChangedEvent extends CombatEventBase {
  readonly type: "move-use-limit-changed";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly moveId: MoveId;
  readonly amount: number;
  readonly newUseLimit: number;
}

export interface ItemUsedEvent extends CombatEventBase {
  readonly type: "item-used";
  readonly combatantId: CombatantId;
  readonly itemId: ItemId;
}

export interface AttackRolledEvent extends CombatEventBase {
  readonly type: "attack-rolled";
  readonly combatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly basicAttack?: BasicAttackType;
  readonly moveId?: MoveId;
  readonly naturalResult: number;
  readonly result: number;
}

export interface DefenseRolledEvent extends CombatEventBase {
  readonly type: "defense-rolled";
  readonly combatantId: CombatantId;
  readonly sourceCombatantId: CombatantId;
  readonly naturalResult: number;
  readonly result: number;
}

export interface DefenseRequestedEvent extends CombatEventBase {
  readonly type: "defense-requested";
  readonly attackerCombatantId: CombatantId;
  readonly defenderCombatantId: CombatantId;
  readonly pendingDecisionId: PendingDecisionId;
}

export interface AttackResolvedEvent extends CombatEventBase {
  readonly type: "attack-resolved";
  readonly combatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly basicAttack?: BasicAttackType;
  readonly moveId?: MoveId;
  readonly outcome: "successful" | "stopped";
  /** Whether the attack qualified for a critical result under shared or declarative rules. */
  readonly critical: boolean;
  /** Whether the stopped defense qualified to hand off to the Counter phase. */
  readonly counter: boolean;
}

export interface EffectActivatedEvent extends CombatEventBase {
  readonly type: "effect-activated";
  readonly activeEffectId: ActiveEffectId;
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
}

export interface EffectExpiredEvent extends CombatEventBase {
  readonly type: "effect-expired";
  readonly activeEffectId: ActiveEffectId;
  readonly targetCombatantId: CombatantId;
}

/** A CONSTANT Skill was explicitly removed from the active combat effects. */
export interface EffectDeactivatedEvent extends CombatEventBase {
  readonly type: "effect-deactivated";
  readonly activeEffectId: ActiveEffectId;
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
}

export interface EffectNegatedEvent extends CombatEventBase {
  readonly type: "effect-negated";
  readonly activeEffectId: ActiveEffectId;
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
}

/** A CONSTANT Skill's active effect source was temporarily replaced. */
export interface EffectReplacedEvent extends CombatEventBase {
  readonly type: "effect-replaced";
  readonly activeEffectId: ActiveEffectId;
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly replacementSourceDefinitionId: MoveId;
  readonly duration: number;
}

/** A mandatory duration check, retained so turn-start randomness is replayable. */
export interface EffectRolledEvent extends CombatEventBase {
  readonly type: "effect-rolled";
  readonly activeEffectId: ActiveEffectId;
  readonly combatantId: CombatantId;
  readonly naturalResult: number;
  readonly result: number;
}

/** A declarative roll retained in combat state for exact later condition evaluation. */
export interface RollStoredEvent extends CombatEventBase {
  readonly type: "roll-stored";
  readonly combatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly storageKey: string;
  readonly naturalResults: readonly number[];
  readonly sides: number;
}

/** A deterministic move selection retained from a declarative stored roll. */
export interface MoveSelectionUpdatedEvent extends CombatEventBase {
  readonly type: "move-selection-updated";
  readonly combatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly storageKey: string;
  readonly selectionKey: string;
  readonly moveId?: MoveId;
}

export interface MoveRemovedFromCombatEvent extends CombatEventBase {
  readonly type: "move-removed-from-combat";
  readonly combatantId: CombatantId;
  readonly moveId: MoveId;
  readonly activeEffectId: ActiveEffectId;
}

export interface StatusAppliedEvent extends CombatEventBase {
  readonly type: "status-applied";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly statusId: StatusId;
  readonly stacks: number;
}

export interface StatusRemovedEvent extends CombatEventBase {
  readonly type: "status-removed";
  readonly targetCombatantId: CombatantId;
  readonly statusId: StatusId;
}

/** A mandatory status duration check, retained so turn-start randomness is replayable. */
export interface StatusRolledEvent extends CombatEventBase {
  readonly type: "status-rolled";
  readonly combatantId: CombatantId;
  readonly statusId: StatusId;
  readonly naturalResult: number;
  readonly result: number;
}

export interface TransformationActivatedEvent extends CombatEventBase {
  readonly type: "transformation-activated";
  readonly combatantId: CombatantId;
  readonly transformationId: TransformationId;
}

export interface TransformationDeactivatedEvent extends CombatEventBase {
  readonly type: "transformation-deactivated";
  readonly combatantId: CombatantId;
  readonly transformationId: TransformationId;
}

export interface TransformationRolledEvent extends CombatEventBase {
  readonly type: "transformation-rolled";
  readonly combatantId: CombatantId;
  readonly naturalResult: number;
  readonly result: number;
  readonly sides: number;
  readonly forced: true;
}

export interface KiChangedEvent extends CombatEventBase {
  readonly type: "ki-changed";
  readonly combatantId: CombatantId;
  readonly amount: number;
  readonly remainingKi: number;
}

export interface HpChangedEvent extends CombatEventBase {
  readonly type: "hp-changed";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly amount: number;
  readonly remainingHitPoints: number;
  readonly activeEffectId?: ActiveEffectId;
}

export interface DamageAppliedEvent extends CombatEventBase {
  readonly type: "damage-applied";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly amount: number;
  readonly remainingHitPoints: number;
}

export interface CombatantDefeatedEvent extends CombatEventBase {
  readonly type: "combatant-defeated";
  readonly combatantId: CombatantId;
}

export interface ActionSkippedEvent extends CombatEventBase {
  readonly type: "action-skipped";
  readonly combatantId: CombatantId;
  readonly reason: "status" | "effect";
}

export interface DeferredMoveScheduledEvent extends CombatEventBase {
  readonly type: "deferred-move-scheduled";
  readonly activeEffectId: ActiveEffectId;
  readonly combatantId: CombatantId;
  readonly moveId: MoveId;
  readonly targetCombatantId: CombatantId;
  readonly performOnTurn: number;
}

export interface DeferredMoveCancelledEvent extends CombatEventBase {
  readonly type: "deferred-move-cancelled";
  readonly activeEffectId: ActiveEffectId;
  readonly combatantId: CombatantId;
  readonly moveId: MoveId;
  readonly reason: "successful-opponent-attack";
}

export interface DeferredMovePerformedEvent extends CombatEventBase {
  readonly type: "deferred-move-performed";
  readonly activeEffectId: ActiveEffectId;
  readonly combatantId: CombatantId;
  readonly moveId: MoveId;
  readonly targetCombatantId: CombatantId;
}

export interface CounterChainLimitReachedEvent extends CombatEventBase {
  readonly type: "counter-chain-limit-reached";
  readonly counterAttackCount: number;
}

export interface CombatantSurrenderedEvent extends CombatEventBase {
  readonly type: "combatant-surrendered";
  readonly combatantId: CombatantId;
}

export interface FightEndedEvent extends CombatEventBase {
  readonly type: "fight-ended";
  readonly completion: CompletedFightState["completion"];
}

export type CombatEvent =
  | FightStartedEvent
  | TurnStartedEvent
  | InitiativeRolledEvent
  | PhaseChangedEvent
  | MoveUsedEvent
  | MoveUseLimitChangedEvent
  | ItemUsedEvent
  | AttackRolledEvent
  | DefenseRolledEvent
  | DefenseRequestedEvent
  | AttackResolvedEvent
  | EffectActivatedEvent
  | EffectExpiredEvent
  | EffectDeactivatedEvent
  | EffectNegatedEvent
  | EffectReplacedEvent
  | EffectRolledEvent
  | RollStoredEvent
  | MoveSelectionUpdatedEvent
  | MoveRemovedFromCombatEvent
  | StatusAppliedEvent
  | StatusRemovedEvent
  | StatusRolledEvent
  | TransformationActivatedEvent
  | TransformationDeactivatedEvent
  | TransformationRolledEvent
  | KiChangedEvent
  | HpChangedEvent
  | DamageAppliedEvent
  | CombatantDefeatedEvent
  | ActionSkippedEvent
  | DeferredMoveScheduledEvent
  | DeferredMoveCancelledEvent
  | DeferredMovePerformedEvent
  | CounterChainLimitReachedEvent
  | CombatantSurrenderedEvent
  | FightEndedEvent;

export interface CombatTransition {
  readonly state: FightState;
  readonly events: readonly CombatEvent[];
  readonly pendingDecision?: PendingDecision;
}

export type CombatFailure =
  | {
      readonly type: "invalid-fight-setup";
      readonly issues: readonly FightSetupIssue[];
    }
  | {
      readonly type: "invalid-fight-state";
      readonly violations: readonly FightStateInvariantViolation[];
    }
  | {
      readonly type: "stale-decision";
      readonly expectedVersion: number;
      readonly actualVersion: number;
    }
  | {
      readonly type: "wrong-phase";
      readonly expected: readonly CombatPhase[];
      readonly actual: CombatPhase | "completed";
    }
  | {
      readonly type: "not-active-combatant";
      readonly combatantId: CombatantId;
      readonly activeCombatantId?: CombatantId;
    }
  | {
      readonly type: "invalid-target";
      readonly targetCombatantId: CombatantId;
    }
  | {
      readonly type: "insufficient-ki";
      readonly required: number;
      readonly available: number;
    }
  | {
      readonly type: "unknown-move";
      readonly moveId: MoveId;
    }
  | {
      readonly type: "move-not-owned";
      readonly moveId: MoveId;
      readonly combatantId: CombatantId;
    }
  | {
      readonly type: "unknown-item";
      readonly itemId: ItemId;
    }
  | {
      readonly type: "item-not-owned";
      readonly itemId: ItemId;
      readonly combatantId: CombatantId;
    }
  | {
      readonly type: "item-use-exhausted";
      readonly itemId: ItemId;
    }
  | {
      readonly type: "move-locked";
      readonly moveId: MoveId;
    }
  | {
      readonly type: "restricted-use-exhausted";
      readonly moveId: MoveId;
    }
  | {
      readonly type: "signature-turn-requirement";
      readonly moveId: MoveId;
      readonly minimumTurn: number;
      readonly currentTurn: number;
    }
  | {
      readonly type: "block-limit-reached";
      readonly combatantId: CombatantId;
    }
  | {
      readonly type: "action-skipped";
      readonly combatantId: CombatantId;
    }
  | {
      readonly type: "no-pending-decision";
      readonly pendingDecisionId: PendingDecisionId;
    }
  | {
      readonly type: "invalid-pending-decision-option";
      readonly pendingDecisionId: PendingDecisionId;
      readonly optionId: string;
    }
  | {
      readonly type: "unsupported-mechanic";
      readonly mechanic: string;
    }
  | {
      readonly type: "illegal-decision";
      readonly decisionType: CombatDecision["type"];
    };

export type CombatResult<TSuccess> =
  | { readonly ok: true; readonly value: TSuccess }
  | { readonly ok: false; readonly error: CombatFailure };
