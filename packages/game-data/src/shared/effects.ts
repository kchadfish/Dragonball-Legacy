import type { EFFECT_TARGET, EFFECT_TRIGGER } from "./constants.js";
import type { StatusId } from "./ids.js";
import type { Requirement } from "./requirements.js";
import type { NumericExpression } from "./types.js";

export type EffectCondition =
  | CombatResultCondition
  | CombatOutcomeCondition
  | RollThresholdCondition
  | PerfectRollCondition
  | RollComparisonCondition
  | RollDieResultCondition
  | RollDieThresholdCondition
  | RollModificationCondition
  | StoredRollMatchCondition
  | StoredRollThresholdCondition
  | StoredMoveSelectionCondition
  | MoveSelectorCondition
  | MoveSetCondition
  | MoveSetMoveCountCondition
  | PriorActionCondition
  | NoPriorActionCondition
  | ActionSequenceCondition
  | ActiveMoveCountCondition
  | PriorTurnRestrictionCondition
  | LocationCondition
  | TargetRelationCondition
  | StatusCondition
  | MoveEffectActiveCondition
  | MoveEffectInactiveCondition
  | ActivationUnavailableCondition
  | IncomingDamageCondition
  | SuccessfulHitCountCondition
  | StoppedHitFractionCondition
  | AttackRollResolutionCondition
  | MoveUseCountCondition
  | DefenseResponseCondition
  | CombatStateCondition
  | CombatContextCondition
  | CombatTurnCondition
  | TransformationMasteryCondition
  | ResourceThresholdCondition
  | ResourceComparisonCondition
  | ResourceChangeCondition
  | MoveModificationCondition
  | StatComparisonCondition
  | LevelComparisonCondition
  | PaidKiCostCondition;

export interface LevelComparisonCondition {
  readonly type: "level-comparison";
  readonly left: "self" | "opponent";
  readonly comparison: "at-least" | "higher-than" | "lower-than" | "equal";
  readonly right: "self" | "opponent";
  readonly difference?: NumericExpression;
  readonly sourceText: string;
}

export interface PaidKiCostCondition {
  readonly type: "paid-ki-cost";
  readonly subject: "self" | "opponent";
  readonly comparison: "at-least" | "at-most" | "exactly";
  readonly value: NumericExpression;
  readonly sourceText: string;
}

export interface SuccessfulHitCountCondition {
  readonly type: "successful-hit-count";
  readonly comparison: "at-least" | "at-most" | "exactly";
  readonly value: NumericExpression;
  readonly sourceText: string;
}

export interface StoppedHitFractionCondition {
  readonly type: "stopped-hit-fraction";
  readonly comparison: "more-than-half";
  readonly sourceText: string;
}

export interface AttackRollResolutionCondition {
  readonly type: "attack-roll-resolution";
  readonly actor: "self" | "opponent";
  readonly anyOf: readonly ("single-die-stopped" | "all-dice-stopped")[];
  readonly sourceText: string;
}

export interface MoveUseCountCondition {
  readonly type: "move-use-count";
  readonly selector: MoveSelectorCondition;
  readonly comparison: "exactly";
  readonly value: number;
  readonly timing: "including-current-use";
  readonly sourceText: string;
}

export interface ActiveMoveCountCondition {
  readonly type: "active-move-count";
  readonly subject: "self" | "opponent" | "either";
  readonly selector: MoveSelectorCondition;
  readonly comparison: "at-least" | "at-most" | "exactly";
  readonly value: NumericExpression;
  readonly sourceText: string;
}

export interface PriorTurnRestrictionCondition {
  readonly type: "prior-turn-restriction";
  readonly subject: "self" | "opponent";
  readonly anyOf: readonly ("attack-use" | "power-up" | "turn-skipped")[];
  readonly sourceText: string;
}

export interface LocationCondition {
  readonly type: "location";
  readonly subject: "self" | "opponent";
  readonly state: "planet-has-dragon-balls";
  readonly sourceText: string;
}

export interface TargetRelationCondition {
  readonly type: "target-relation";
  readonly subject: "source" | "target";
  readonly relation: "same-as-source-effect-target";
  readonly sourceText: string;
}

export interface StatusCondition {
  readonly type: "status";
  readonly subject: "self" | "opponent";
  readonly statusId: StatusId;
  readonly state: "active";
  readonly sourceText: string;
}

export interface MoveEffectActiveCondition {
  readonly type: "move-effect-active";
  readonly subject: "self" | "opponent";
  readonly selector: MoveSelectorCondition;
  readonly sourceText: string;
}

export interface MoveEffectInactiveCondition {
  readonly type: "move-effect-inactive";
  readonly subject: "self" | "opponent";
  readonly selector: MoveSelectorCondition;
  readonly sourceText: string;
}

export interface ActivationUnavailableCondition {
  readonly type: "activation-unavailable";
  readonly selector: MoveSelectorCondition;
  readonly sourceText: string;
}

export interface IncomingDamageCondition {
  readonly type: "incoming-damage";
  readonly subject: "self" | "opponent";
  readonly comparison: "at-least" | "at-most" | "exactly";
  readonly value: NumericExpression;
  readonly timing?: "after-last-turn";
  readonly sourceText: string;
}

export interface DefenseResponseCondition {
  readonly type: "defense-response";
  readonly blockUsed: boolean;
  readonly resultModified?: boolean;
  readonly rerolled?: boolean;
  readonly sourceText: string;
}

export interface CombatStateCondition {
  readonly type: "combat-state";
  readonly subject: "self" | "opponent";
  readonly state: "transformed";
  readonly sourceText: string;
}

export interface CombatContextCondition {
  readonly type: "combat-context";
  readonly mode: "battle";
  readonly sourceText: string;
}

export interface CombatTurnCondition {
  readonly type: "combat-turn";
  readonly comparison: "exactly";
  readonly value: number;
  readonly sourceText: string;
}

export interface TransformationMasteryCondition {
  readonly type: "transformation-mastery";
  readonly mastery: "mastered";
  readonly sourceText: string;
}

export interface CombatResultCondition {
  readonly type: "combat-result";
  readonly actor: "self" | "opponent";
  readonly result: "successful" | "stopped" | "critical" | "counter";
  readonly sourceText: string;
}

export interface CombatOutcomeCondition {
  readonly type: "combat-outcome";
  readonly actor: "self" | "opponent";
  readonly outcome: "break" | "sever" | "stun" | "critical" | "counter";
  readonly sourceText: string;
}

export interface RollThresholdCondition {
  readonly type: "roll-threshold";
  readonly roll: "attack" | "defense" | "transformation";
  readonly natural?: boolean;
  readonly comparison: "at-least" | "at-most";
  readonly value: NumericExpression;
  readonly sourceText: string;
}

export interface PerfectRollCondition {
  readonly type: "perfect-roll";
  readonly roll: "attack";
  readonly natural: true;
  readonly negated?: boolean;
  readonly sourceText: string;
}

export interface RollComparisonCondition {
  readonly type: "roll-comparison";
  readonly left: "attack" | "defense";
  readonly comparison: "at-least" | "at-most" | "equal";
  readonly right: "attack" | "defense";
  readonly difference?: NumericExpression;
  readonly rightMultiplier?: NumericExpression;
  readonly sourceText: string;
}

export interface RollDieResultCondition {
  readonly type: "roll-die-result";
  readonly roll: "attack" | "defense";
  /** One-based die number as represented in the converted source definition. */
  readonly index: number;
  readonly result: "successful" | "stopped";
  readonly sourceText: string;
}

export interface RollDieThresholdCondition {
  readonly type: "roll-die-threshold";
  readonly roll: "attack" | "defense";
  /** One-based die number as represented in the converted source definition. */
  readonly index: number;
  readonly comparison: "at-least" | "at-most";
  readonly value: NumericExpression;
  readonly sourceText: string;
}

export interface RollModificationCondition {
  readonly type: "roll-modification";
  readonly actor: "self" | "opponent";
  readonly roll: "attack" | "defense";
  readonly modifiers: readonly ("result" | "sides")[];
  readonly excludeSource: "dexterity";
  readonly sourceText: string;
}

export interface StoredRollMatchCondition {
  readonly type: "stored-roll-match";
  readonly roll: "attack" | "defense";
  readonly natural: boolean;
  readonly storageKey: string;
  readonly sourceText: string;
}

export interface StoredRollThresholdCondition {
  readonly type: "stored-roll-threshold";
  readonly storageKey: string;
  readonly comparison: "at-least" | "at-most";
  readonly value: NumericExpression;
  readonly sourceText: string;
}

export interface StoredMoveSelectionCondition {
  readonly type: "stored-move-selection";
  readonly selectionKey: string;
  readonly sourceText: string;
}

export interface MoveSelectorCondition {
  readonly type: "move-selector";
  readonly subject: "source" | "target";
  readonly ids?: readonly string[];
  readonly styleId?: string;
  readonly styleIdExcludes?: string;
  readonly category?: "advanced-attack" | "signature" | "block" | "skill" | "mastery";
  readonly categoryExcludes?: readonly (
    "advanced-attack" | "signature" | "block" | "skill" | "mastery"
  )[];
  readonly categories?: readonly (
    "advanced-attack" | "signature" | "block" | "skill" | "mastery"
  )[];
  readonly tags?: readonly string[];
  readonly custom?: boolean;
  readonly styleProvenance?: "effect";
  readonly effectKinds?: readonly ("resource-loss" | "roll-side-reduction")[];
  readonly restriction?: "restricted" | "unrestricted";
  readonly constant?: boolean;
  readonly effectTextIncludes?: string;
  readonly effectTextIncludesAny?: readonly string[];
  readonly effectTextExcludes?: string;
  readonly selectionKey?: string;
  readonly requirementExcludes?: readonly string[];
  readonly requirementIncludes?: readonly string[];
  readonly baseKiCost?: {
    readonly comparison: "at-least" | "at-most" | "exactly";
    readonly value: NumericExpression;
  };
  readonly costModification?: "prevented";
  readonly attackRoll?: {
    readonly dice?: number;
    readonly minimumDice?: number;
    readonly sides?: number;
    readonly maximumSides?: number;
  };
  readonly sourceText: string;
}

export interface MoveSetCondition {
  readonly type: "moveset";
  readonly subject: "self" | "opponent";
  readonly excludesIds: readonly string[];
  readonly sourceText: string;
}

export interface MoveSetMoveCountCondition {
  readonly type: "moveset-move-count";
  readonly subject: "self" | "opponent";
  readonly category?: "advanced-attack" | "signature" | "block" | "skill" | "mastery";
  readonly tags?: readonly string[];
  readonly comparison: "at-least" | "at-most" | "exactly";
  readonly value: NumericExpression;
  readonly sourceText: string;
}

export interface PriorActionCondition {
  readonly type: "prior-action";
  readonly actor: "self" | "opponent";
  readonly action?: "power-up";
  readonly result?: "successful" | "stopped" | "critical" | "counter";
  readonly selector?: MoveSelectorCondition;
  readonly sourceText: string;
}

export interface NoPriorActionCondition {
  readonly type: "no-prior-action";
  readonly actor: "self" | "opponent";
  readonly selector: MoveSelectorCondition;
  readonly sourceText: string;
}

export interface ActionSequenceCondition {
  readonly type: "action-sequence";
  readonly actor: "self" | "opponent";
  readonly result: "successful" | "stopped" | "critical" | "counter";
  readonly count: number;
  readonly selector?: MoveSelectorCondition;
  readonly differentTurns?: boolean;
  readonly withoutResultBy?: {
    readonly actor: "self" | "opponent";
    readonly result: "successful" | "stopped" | "critical" | "counter";
  };
  readonly sourceText: string;
}

export interface ResourceThresholdCondition {
  readonly type: "resource-threshold";
  readonly subject: "self" | "opponent";
  readonly resource: "hp" | "ki";
  readonly basis: "current" | "total";
  readonly comparison: "at-least" | "at-most" | "lower-than";
  readonly value: NumericExpression;
  readonly sourceText: string;
}

export interface ResourceComparisonCondition {
  readonly type: "resource-comparison";
  readonly resource: "hp" | "ki";
  readonly basis: "current" | "total";
  readonly left: "self" | "opponent";
  readonly comparison: "higher-than" | "lower-than" | "equal";
  readonly right: "self" | "opponent";
  readonly sourceText: string;
}

export interface ResourceChangeCondition {
  readonly type: "resource-change";
  readonly subject: "self" | "opponent";
  readonly resource: "hp" | "ki";
  readonly operation: "gain" | "lose";
  readonly timing: "current-event" | "last-turn" | "within-turns";
  readonly turns?: number;
  readonly cause?: "non-damage-effect" | "opponent-effect";
  readonly sourceStyleId?: string;
  readonly sourceText: string;
}

export interface MoveModificationCondition {
  readonly type: "move-modification";
  readonly aspect: "cost" | "damage";
  readonly sourceStyleId: string;
  readonly sourceText: string;
}

export interface StatComparisonCondition {
  readonly type: "stat-comparison";
  readonly left: "self" | "opponent";
  readonly stat: "dexterity" | "dexterity-bonus" | "power" | "sp" | "max-hp";
  readonly comparison: "at-least" | "at-most" | "higher-than" | "lower-than" | "equal";
  readonly right?: "self" | "opponent";
  readonly rightStat?: "dexterity" | "dexterity-bonus" | "power" | "sp" | "max-hp";
  readonly rightMultiplier?: NumericExpression;
  readonly difference?: NumericExpression;
  readonly value?: NumericExpression;
  readonly sourceText: string;
}

export type EffectDuration =
  | { readonly type: "turns"; readonly turns: NumericExpression; readonly sourceText: string }
  | {
      readonly type: "until-roll-threshold";
      readonly roll: "attack" | "defense" | "transformation";
      readonly comparison: "at-least" | "at-most";
      readonly value: NumericExpression;
      readonly moveSelector?: MoveSelectorCondition;
      readonly sourceText: string;
    }
  | {
      readonly type: "until-turn-start-roll-threshold";
      readonly subject: "self" | "opponent";
      readonly dice: number;
      readonly sides: number;
      readonly comparison: "at-least" | "at-most";
      readonly value: NumericExpression;
      readonly ignoreFirstCheck?: boolean;
      readonly startAfterTurns?: number;
      readonly sourceText: string;
    }
  | { readonly type: "until-perfect-roll"; readonly sourceText: string }
  | {
      readonly type: "turns-or-until-perfect-roll";
      readonly turns: NumericExpression;
      readonly sourceText: string;
    }
  | {
      readonly type: "until-resource-threshold";
      readonly subject: "self" | "opponent";
      readonly resource: "hp" | "ki";
      readonly comparison: "at-least" | "at-most";
      readonly value: NumericExpression;
      readonly sourceText: string;
    }
  | {
      readonly type: "until-combat-result";
      readonly actor: "self" | "opponent";
      readonly result: "successful" | "stopped" | "critical" | "counter";
      readonly moveSelector?: MoveSelectorCondition;
      readonly conditions?: readonly EffectCondition[];
      readonly sourceText: string;
    }
  | { readonly type: "combat"; readonly sourceText: string };

export type EffectScope =
  | { readonly type: "current-action"; readonly sourceText: string }
  | { readonly type: "next-action"; readonly sourceText: string }
  | {
      readonly type: "next-actions";
      readonly count: NumericExpression;
      readonly sourceText: string;
    }
  | {
      readonly type: "following-action";
      readonly offset: number;
      readonly sourceText: string;
    }
  | {
      readonly type: "next-turn";
      readonly subject: "self" | "opponent";
      readonly sourceText: string;
    }
  | {
      readonly type: "next-phase";
      readonly subject: "self" | "opponent";
      readonly phase: "upkeep" | "action" | "end";
      readonly sourceText: string;
    }
  | {
      readonly type: "next-roll";
      readonly roll: "attack" | "defense" | "escape" | "initiative" | "transformation";
      readonly sourceText: string;
    }
  | {
      readonly type: "next-rolls";
      readonly roll: "attack" | "defense" | "transformation";
      readonly count: NumericExpression;
      readonly sourceText: string;
    }
  | {
      readonly type: "next-resource-gain";
      readonly resource: "hp" | "ki";
      readonly subject: "self" | "opponent";
      readonly sourceText: string;
    }
  | { readonly type: "next-cost-modification"; readonly sourceText: string }
  | { readonly type: "combat"; readonly sourceText: string };

/**
 * Source-backed conflict semantics for effects that survive the current
 * resolution.  `stacking` remains available as a legacy shorthand while the
 * catalog is migrated to this explicit vocabulary.
 */
export type EffectConflictPolicy =
  | { readonly type: "allow"; readonly sourceText: string }
  | { readonly type: "prevent-duplicate"; readonly sourceText: string }
  | {
      readonly type: "replace";
      readonly provenance: "existing" | "incoming";
      readonly sourceText: string;
    }
  | {
      readonly type: "refresh";
      readonly duration: "existing" | "incoming";
      readonly uses: "existing" | "incoming";
      readonly provenance: "existing" | "incoming";
      readonly sourceText: string;
    }
  | {
      readonly type: "retain";
      readonly selection: "highest" | "lowest";
      readonly value: "amount";
      readonly tie: "existing" | "incoming";
      readonly sourceText: string;
    }
  | { readonly type: "unique-group"; readonly group: string; readonly sourceText: string }
  | {
      readonly type: "mutually-exclusive-group";
      readonly group: string;
      readonly sourceText: string;
    };

export interface BaseEffectDefinition {
  readonly trigger: (typeof EFFECT_TRIGGER)[keyof typeof EFFECT_TRIGGER];
  readonly target?: (typeof EFFECT_TARGET)[keyof typeof EFFECT_TARGET];
  readonly requirements?: readonly Requirement[];
  readonly conditions?: readonly EffectCondition[];
  readonly scope?: EffectScope;
  readonly duration?: EffectDuration;
  readonly stacking?: "allow" | "prevent";
  readonly conflictPolicy?: EffectConflictPolicy;
  readonly useLimit?: {
    readonly scope: "combat" | "turn";
    readonly count: number | NumericExpression;
    readonly sourceText: string;
  };
  readonly activationCost?: {
    readonly resource: "hp" | "ki";
    readonly amount: NumericExpression;
    readonly operation: "lose";
    readonly minimum?: NumericExpression;
  };
  readonly activationGroup?: string;
  readonly exclusiveActivationGroup?: string;
  readonly optional?: boolean;
  readonly selectionLimit?: number;
  readonly cooldown?: number;
  readonly sourceText: string;
}

export type EffectDefinition =
  | ActivateEffect
  | ApplyStatusEffect
  | BlockAllDiceEffect
  | CopyMoveEffect
  | CopyMoveEffectsEffect
  | CreateFloatingEffect
  | SelectMoveByStoredRollEffect
  | RequireAllDiceSuccessEffect
  | ModifyRemainingUsesEffect
  | DeactivateEffect
  | DelayedDeactivateEffect
  | DeferMoveEffect
  | EndFloatingEffect
  | ForceActionEffect
  | ResolveContestEffect
  | ForceTransformationEffect
  | RequireTransformationRollEffect
  | GrantEquipmentEffect
  | GrantDefenseResponseEffect
  | GrantEscapeRollEffect
  | GrantTransformationActionEffect
  | GrantCombatOutcomeEffect
  | JoinAttackEffect
  | GrantRacialTraitsEffect
  | GrantCounterActionEffect
  | GrantExtraActionEffect
  | GrantMasteryEffect
  | GrantTemporaryMoveUseEffect
  | LockEffect
  | ModifyCostEffect
  | ModifyCostModifierEffect
  | ModifyCriticalThresholdEffect
  | ModifySlotCapacityEffect
  | ModifyStatEffect
  | ModifyDamageEffect
  | ModifyCombatOutcomeEffect
  | ModifyDamageModifierEffect
  | ModifyDamageReductionCostEffect
  | ModifyResourceEffect
  | ModifyResourceModifierEffect
  | ModifyResourceCostEffect
  | ModifyRollEffect
  | ModifyRollModifierEffect
  | ModifyMoveClassificationEffect
  | ModifyMoveRequirementsEffect
  | OverrideStyleReferenceEffect
  | ReplaceMoveEffect
  | NegateEffect
  | NegateDeactivationEffect
  | PreventResolutionEffect
  | PreventLowRollStopEffect
  | OverrideResolutionImmunityEffect
  | PreventCombatResultEffect
  | PreventMoveModificationEffect
  | PreventResourceModificationEffect
  | PreventRollModificationEffect
  | PreventStatusEffect
  | PreventMoveUseEffect
  | RerollEffect
  | RollAndStoreEffect
  | RemoveMoveFromCombatEffect
  | RevertTransformationEffect
  | ScheduleEffect
  | SetCombatResultEffect
  | SetStatComparisonEffect
  | SetRollResultEffect
  | SetResolutionThresholdEffect
  | SetRollDefinitionEffect
  | SetRollSelectionEffect
  | SkipActionEffect
  | SuppressRequirementEffect
  | SuppressEffect
  | SubstituteDefenseEffect
  | StopAttackByDeactivationEffect
  | ExchangeConstantSkillEffect
  | ReactivateRecentSkillEffect
  | ReactivateDeactivatedConstantSkillEffect
  | ActivateProtectedConstantEffect
  | OverrideSkillActivationPreventionEffect
  | ReplaceActiveConstantEffectsEffect
  | GrantDestructionMasteryEffect
  | SwapCombatantStateEffect
  | TravelEffect;

export interface ApplyStatusEffect extends BaseEffectDefinition {
  readonly type: "apply-status";
  readonly statusId: StatusId;
  readonly unpreventable?: boolean;
  readonly selector?: MoveSelectorCondition;
}

export interface BlockAllDiceEffect extends BaseEffectDefinition {
  readonly type: "block-all-dice";
  readonly selector: MoveSelectorCondition;
}

export interface ActivateEffect extends BaseEffectDefinition {
  readonly type: "activate";
  readonly selector: MoveSelectorCondition;
  readonly asIf?: "power-up";
  readonly repeatCount?: NumericExpression;
  readonly ignoreRequirements?: boolean;
  readonly selectionKey?: string;
  readonly repeatUntil?: {
    readonly type: "active-move-count-matches-opponent";
    readonly selector: MoveSelectorCondition;
    readonly fallback: "no-eligible-moves";
  };
}

export interface CopyMoveEffect extends BaseEffectDefinition {
  readonly type: "copy-move-effect";
  readonly sourceMove:
    | {
        readonly type: "selected-prior-move";
        readonly actor: "self" | "opponent";
        readonly category: "advanced-attack" | "signature";
        readonly result: "successful" | "stopped";
      }
    | {
        readonly type: "selected-prior-move";
        readonly actor: "self" | "opponent";
        readonly categories: readonly ("advanced-attack" | "signature")[];
        readonly result: "successful" | "stopped";
      }
    | {
        readonly type: "selected-move";
        readonly actor: "self" | "opponent";
        readonly category: "advanced-attack" | "signature";
        readonly restriction?: "restricted" | "unrestricted";
        readonly styleId?: string;
      }
    | {
        readonly type: "last-prior-move";
        readonly actor: "self";
        readonly restriction: "unrestricted";
      };
  readonly effectResult: "successful" | "stopped";
  readonly resolveAs: "source-move";
  readonly damage?:
    | { readonly type: "total-damage"; readonly sourceMove: "selected-prior-move" }
    | { readonly type: "half-base-damage-per-die"; readonly sourceMove: "last-advanced-attack" }
    | { readonly type: "add-percent"; readonly value: NumericExpression };
  readonly cost?: { readonly type: "selected-move-base-cost" };
  readonly ignoreRequirements?: boolean;
  readonly copies?: readonly ("cost" | "dice-rolls" | "source-modifiers")[];
}

export interface CopyMoveEffectsEffect extends BaseEffectDefinition {
  readonly type: "copy-move-effects";
  readonly sourceMove: {
    readonly actor: "opponent";
    readonly categories: readonly ("advanced-attack" | "signature")[];
    readonly restriction: "unrestricted";
    readonly usedDuring: "combat";
  };
  readonly sourceEffectResult: "successful";
  readonly resultingEffectResult: "successful";
}

export interface CreateFloatingEffect extends BaseEffectDefinition {
  readonly type: "create-floating-effect";
  readonly floatingEffectId: string;
  readonly effects?: readonly EffectDefinition[];
  readonly termination?: readonly {
    readonly trigger: "on-power-up" | "on-stopped" | "on-success";
    readonly actor: "self" | "opponent";
    readonly selector?: MoveSelectorCondition;
    readonly sourceText: string;
  }[];
}

export interface SelectMoveByStoredRollEffect extends BaseEffectDefinition {
  readonly type: "select-move-by-stored-roll";
  readonly storageKey: string;
  readonly selectionKey: string;
  readonly subject: "self";
  readonly selector: MoveSelectorCondition;
  readonly ordering: "character-sheet-top-to-bottom";
  readonly reindex: "on-moveset-change";
}

export interface ModifyRemainingUsesEffect extends BaseEffectDefinition {
  readonly type: "modify-remaining-uses";
  readonly amount: NumericExpression;
  readonly selector: MoveSelectorCondition;
}

export interface RequireAllDiceSuccessEffect extends BaseEffectDefinition {
  readonly type: "require-all-dice-success";
  readonly selector: MoveSelectorCondition;
  readonly appliesTo: "successful-effects";
}

export interface EndFloatingEffect extends BaseEffectDefinition {
  readonly type: "end-floating-effect";
  readonly selector: "self" | "opponent" | "any";
}

export interface ForceActionEffect extends BaseEffectDefinition {
  readonly type: "force-action";
  readonly allowedCategories: readonly ("advanced-attack" | "signature")[];
  readonly allowedTags?: readonly string[];
  readonly allowPass: boolean;
  readonly selector?: MoveSelectorCondition;
  readonly selectedMoveStorageKey?: string;
  readonly fallback?: "basic-attack";
}

export interface ResolveContestEffect extends BaseEffectDefinition {
  readonly type: "resolve-contest";
  readonly rolls: { readonly dice: number; readonly sides: number; readonly repetitions: number };
  readonly qualifyingThreshold: {
    readonly default: number;
    readonly whenSelfPowerHigher: number;
  };
  readonly loser: "lower-qualifying-count";
  readonly tie: "self-wins";
  readonly penalty: { readonly resource: "hp"; readonly amount: NumericExpression };
}

export interface ForceTransformationEffect extends BaseEffectDefinition {
  readonly type: "force-transformation";
  readonly targetTransformation: "highest";
  readonly required: boolean;
}

export interface RequireTransformationRollEffect extends BaseEffectDefinition {
  readonly type: "require-transformation-roll";
  readonly phase: "upkeep-phase";
  readonly ignoreTransformationDice: true;
}

export interface GrantRacialTraitsEffect extends BaseEffectDefinition {
  readonly type: "grant-racial-traits";
  readonly source: "opponent";
}

export interface GrantEquipmentEffect extends BaseEffectDefinition {
  readonly type: "grant-equipment";
  readonly equipment: "sword";
}

export interface GrantDefenseResponseEffect extends BaseEffectDefinition {
  readonly type: "grant-defense-response";
  readonly roll: "defense";
  readonly againstAttackDieIndex: number;
}

export interface GrantEscapeRollEffect extends BaseEffectDefinition {
  readonly type: "grant-escape-roll";
  readonly phase: "end-phase";
}

export interface GrantTransformationActionEffect extends BaseEffectDefinition {
  readonly type: "grant-transformation-action";
  readonly turnCost: "none";
}

export interface SubstituteDefenseEffect extends BaseEffectDefinition {
  readonly type: "substitute-defense";
  readonly payment: {
    readonly resource: "hp";
    readonly amount: NumericExpression;
  };
  readonly selector: MoveSelectorCondition;
  readonly outcome: "stop";
}

export interface StopAttackByDeactivationEffect extends BaseEffectDefinition {
  readonly type: "stop-attack-by-deactivation";
  readonly sacrificedMove: MoveSelectorCondition;
  readonly attack: MoveSelectorCondition;
  readonly lockDuration: { readonly type: "combat"; readonly sourceText: string };
}

export interface ExchangeConstantSkillEffect extends BaseEffectDefinition {
  readonly type: "exchange-constant-skill";
  readonly selfSkill: MoveSelectorCondition;
  readonly opponentSkill: MoveSelectorCondition;
  readonly optionalNoTurnCost: { readonly resource: "ki"; readonly amount: number };
  readonly reactivateWhen: {
    readonly attack: MoveSelectorCondition;
    readonly result: "stopped";
    readonly blockUsed: false;
  };
}

export interface ReactivateRecentSkillEffect extends BaseEffectDefinition {
  readonly type: "reactivate-recent-skill";
  readonly deactivatedTiming: "last-turn";
  readonly payment: { readonly resource: "ki"; readonly amount: number };
}

export interface ReactivateDeactivatedConstantSkillEffect extends BaseEffectDefinition {
  readonly type: "reactivate-deactivated-constant-skill";
  readonly selector: MoveSelectorCondition;
  readonly deactivatedTiming: "combat";
}

export interface ActivateProtectedConstantEffect extends BaseEffectDefinition {
  readonly type: "activate-protected-constant";
  readonly selector: MoveSelectorCondition;
  readonly payment: { readonly resource: "ki"; readonly amount: number };
  readonly protectionDuration: {
    readonly type: "turns";
    readonly turns: number;
    readonly sourceText: string;
  };
}

export interface OverrideSkillActivationPreventionEffect extends BaseEffectDefinition {
  readonly type: "override-skill-activation-prevention";
}

export interface ReplaceActiveConstantEffectsEffect extends BaseEffectDefinition {
  readonly type: "replace-active-constant-effects";
  readonly sourceSkill: MoveSelectorCondition;
  readonly targetSkill: MoveSelectorCondition;
}

export interface GrantDestructionMasteryEffect extends BaseEffectDefinition {
  readonly type: "grant-destruction-mastery";
  readonly advancedAttack: MoveSelectorCondition;
  readonly signatureTechnique: MoveSelectorCondition;
  readonly naturalDefenseStopPreventionAtMost: number;
  readonly zeroCostSignatureUses: number;
  readonly targetsInterferers: true;
  readonly damageBonusAfterOpponentInterferencePercent: number;
}

export interface GrantCombatOutcomeEffect extends BaseEffectDefinition {
  readonly type: "grant-combat-outcome";
  readonly outcome: "break" | "sever" | "stun";
  readonly requireAllDiceSuccess?: boolean;
  readonly selector?: MoveSelectorCondition;
}

export interface JoinAttackEffect extends BaseEffectDefinition {
  readonly type: "join-attack";
  readonly participants: {
    readonly eligibility: "ally-in-combat" | "same-planet-move-owner";
    readonly maximum: number;
    readonly duration?: "one-turn";
  };
  readonly attackRoll: { readonly dice: number; readonly sides: number };
  readonly eachParticipantPaysCost: boolean;
}

export interface GrantCounterActionEffect extends BaseEffectDefinition {
  readonly type: "grant-counter-action";
  readonly stopsTriggeringAttack: boolean;
  readonly action: "choose-attack" | "repeat-triggering-attack" | "use-source-attack";
  readonly ignoreRequirements?: boolean;
  readonly costModifier?: {
    readonly operation: "add" | "set";
    readonly amount: NumericExpression;
    readonly minimum?: NumericExpression;
  };
}

export interface DeactivateEffect extends BaseEffectDefinition {
  readonly type: "deactivate";
  readonly affectedType: "skill" | "transformation";
  readonly optional?: boolean;
  /** Whether this effect removes one eligible target or every eligible target. */
  readonly selection?: "one" | "all";
  readonly count?: NumericExpression;
  readonly selector?: MoveSelectorCondition;
}

export interface DelayedDeactivateEffect extends BaseEffectDefinition {
  readonly type: "delayed-deactivate";
  readonly affectedType: "skill";
  readonly selectionKey: string;
  readonly turnsAfter: number;
}

export interface DeferMoveEffect extends BaseEffectDefinition {
  readonly type: "defer-move";
  readonly move: "source";
  /** Whether the acting combatant may decline the deferred branch. */
  readonly optional?: boolean;
  readonly performAfterTurns: number;
  readonly damage?: { readonly operation: "set"; readonly percent: NumericExpression };
  readonly cancellation: {
    readonly actor: "opponent";
    readonly result: "successful";
    readonly sourceText: string;
  };
  readonly onCancellation?: {
    readonly type: "lock";
    readonly affectedType: "attack";
    readonly duration: { readonly type: "combat"; readonly sourceText: string };
  };
}

export interface RevertTransformationEffect extends BaseEffectDefinition {
  readonly type: "revert-transformation";
}

export interface LockEffect extends BaseEffectDefinition {
  readonly type: "lock";
  readonly affectedType: "attack" | "block" | "escape" | "mastery" | "move" | "power-up" | "skill";
  readonly selector?: MoveSelectorCondition;
}

export interface ModifyDamageEffect extends BaseEffectDefinition {
  readonly type: "modify-damage";
  readonly percent?: NumericExpression;
  readonly operation?: "add" | "multiply" | "set";
  readonly selector?: MoveSelectorCondition;
  readonly cap?: {
    readonly type: "maximum";
    readonly value: NumericExpression;
    readonly sourceText: string;
  };
}

export interface ModifyCombatOutcomeEffect extends BaseEffectDefinition {
  readonly type: "modify-combat-outcome";
  readonly outcome: "break" | "sever" | "stun";
  readonly multiplier: NumericExpression;
  readonly selector: MoveSelectorCondition;
}

export interface ModifyDamageModifierEffect extends BaseEffectDefinition {
  readonly type: "modify-damage-modifier";
  readonly multiplier: NumericExpression;
  readonly selector?: MoveSelectorCondition;
}

export interface ModifyDamageReductionCostEffect extends BaseEffectDefinition {
  readonly type: "modify-damage-reduction-cost";
  readonly resource: "ki";
  readonly amount: NumericExpression;
  readonly reductions: "reduce-or-nullify";
  readonly selector: MoveSelectorCondition;
}

export interface ModifyCostEffect extends BaseEffectDefinition {
  readonly type: "modify-cost";
  readonly operation: "add" | "set";
  readonly amount: NumericExpression;
  readonly selector?: MoveSelectorCondition;
  readonly minimum?: NumericExpression;
  readonly maximum?: NumericExpression;
}

export interface ModifyCostModifierEffect extends BaseEffectDefinition {
  readonly type: "modify-cost-modifier";
  readonly multiplier: NumericExpression;
}

export interface ModifyCriticalThresholdEffect extends BaseEffectDefinition {
  readonly type: "modify-critical-threshold";
  readonly threshold: NumericExpression;
  readonly basis: "natural-result" | "final-result";
  readonly selector?: MoveSelectorCondition;
}

export interface ModifySlotCapacityEffect extends BaseEffectDefinition {
  readonly type: "modify-slot-capacity";
  readonly slot: "advanced-attack" | "block" | "mastery" | "signature" | "skill";
  readonly amount: NumericExpression;
}

export interface ModifyStatEffect extends BaseEffectDefinition {
  readonly type: "modify-stat";
  readonly stat: "dexterity" | "dexterity-bonus";
  readonly operation: "add" | "set" | "multiply";
  readonly amount: NumericExpression;
  readonly selector?: MoveSelectorCondition;
}

export interface ModifyResourceEffect extends BaseEffectDefinition {
  readonly type: "modify-resource";
  readonly resource: "hp" | "ki";
  readonly operation: "drain" | "gain" | "lose" | "set";
  readonly amount?: NumericExpression;
  readonly cap?: {
    readonly type: "maximum" | "minimum";
    readonly value: NumericExpression;
    readonly sourceText: string;
  };
  readonly prevention?: "prohibited";
  readonly selector?: MoveSelectorCondition;
  readonly exclusions?: readonly {
    readonly type: "power-up-while-target-was-losing-ki-to-floating-effect-on-creation";
    readonly sourceText: string;
  }[];
}

export interface ModifyResourceModifierEffect extends BaseEffectDefinition {
  readonly type: "modify-resource-modifier";
  readonly resource: "hp" | "ki";
  readonly operation: "gain" | "lose";
  readonly multiplier: NumericExpression;
  readonly selector: MoveSelectorCondition;
  readonly cap?: {
    readonly type: "maximum";
    readonly value: NumericExpression;
    readonly sourceText: string;
  };
}

export interface ModifyResourceCostEffect extends BaseEffectDefinition {
  readonly type: "modify-resource-cost";
  readonly resource: "hp";
  readonly operation: "add";
  readonly percent: NumericExpression;
  readonly selector: MoveSelectorCondition;
}

export interface ModifyRollEffect extends BaseEffectDefinition {
  readonly type: "modify-roll";
  readonly roll: "attack" | "defense" | "escape" | "initiative" | "transformation";
  readonly modifier: "dice" | "result" | "sides";
  readonly amount?: NumericExpression;
  readonly multiplier?: NumericExpression;
  readonly dieIndex?: number;
  readonly affectedDice?: "all" | "ceiling-half";
  readonly selector?: MoveSelectorCondition;
  readonly cap?:
    | {
        readonly type: "allow-exceed";
        readonly scope?: "amount" | "total" | "roll";
        readonly sourceText: string;
      }
    | {
        readonly type: "maximum" | "minimum";
        readonly value: NumericExpression;
        readonly scope?: "amount" | "total" | "roll";
        readonly sourceText: string;
      };
}

export interface ModifyRollModifierEffect extends BaseEffectDefinition {
  readonly type: "modify-roll-modifier";
  readonly multiplier?: NumericExpression;
  readonly increment?: NumericExpression;
  readonly modifier: "result" | "sides" | "any";
  readonly excludeSourceCategories?: readonly ("mastery" | "skill")[];
  readonly cap?: { readonly type: "allow-exceed"; readonly sourceText: string };
}

export interface ModifyMoveClassificationEffect extends BaseEffectDefinition {
  readonly type: "modify-move-classification";
  readonly addTags?: readonly string[];
  readonly replaceStyle?: "declared-style";
  readonly setStyleId?: string;
  readonly selector?: MoveSelectorCondition;
}

export interface ModifyMoveRequirementsEffect extends BaseEffectDefinition {
  readonly type: "modify-move-requirements";
  readonly addRequirements: readonly string[];
  readonly selector: MoveSelectorCondition;
}

export interface ReplaceMoveEffect extends BaseEffectDefinition {
  readonly type: "replace-move-effect";
  readonly selector: MoveSelectorCondition;
  readonly remove: "source-effect";
  readonly replacement: {
    readonly trigger: "on-resource-drain";
    readonly target: "self";
    readonly type: "modify-resource";
    readonly resource: "ki";
    readonly operation: "gain";
    readonly amount: NumericExpression;
    readonly sourceText: string;
  };
}

export interface NegateEffect extends BaseEffectDefinition {
  readonly type: "negate";
  readonly aspects?: readonly ("prevent-attack" | "prevent-damage")[];
  readonly selector?: MoveSelectorCondition;
}

export interface NegateDeactivationEffect extends BaseEffectDefinition {
  readonly type: "negate-deactivation";
  readonly selector: MoveSelectorCondition;
}

export interface PreventResolutionEffect extends BaseEffectDefinition {
  readonly type: "prevent-resolution";
  readonly prevention: "block" | "stop";
  readonly source?: "effect";
  readonly selector?: MoveSelectorCondition;
}

export interface PreventLowRollStopEffect extends BaseEffectDefinition {
  readonly type: "prevent-low-roll-stop";
  readonly roll: "defense";
  readonly comparison: "at-most";
  readonly value: NumericExpression;
}

export interface OverrideResolutionImmunityEffect extends BaseEffectDefinition {
  readonly type: "override-resolution-immunity";
  readonly resolution: "block";
}

export interface PreventCombatResultEffect extends BaseEffectDefinition {
  readonly type: "prevent-combat-result";
  readonly result: "critical" | "counter" | "sever";
  readonly selector?: MoveSelectorCondition;
}

export interface PreventMoveModificationEffect extends BaseEffectDefinition {
  readonly type: "prevent-move-modification";
  readonly selector: MoveSelectorCondition;
  readonly aspects: readonly ("cost" | "damage" | "dice-sides" | "effects" | "roll-results")[];
  readonly actor: "self" | "opponent" | "any";
  readonly effectSourceStyleExcludes?: string;
  readonly exceptSourceMoveIds?: readonly string[];
  readonly exceptSourceStatusIds?: readonly StatusId[];
  readonly operations?: readonly "reduce"[];
}

export interface PreventResourceModificationEffect extends BaseEffectDefinition {
  readonly type: "prevent-resource-modification";
  readonly resource: "hp" | "ki";
  readonly operation: "gain" | "lose" | "set";
  readonly sourceActor?: "opponent";
  readonly exceptAction?: "power-up";
}

export interface PreventRollModificationEffect extends BaseEffectDefinition {
  readonly type: "prevent-roll-modification";
  readonly roll: "attack" | "defense";
  readonly modifier: "result" | "sides" | "any";
  readonly selector?: MoveSelectorCondition;
  readonly exemptSourceEffect?: boolean;
}

export interface PreventStatusEffect extends BaseEffectDefinition {
  readonly type: "prevent-status";
  readonly statusId: StatusId;
}

export interface PreventMoveUseEffect extends BaseEffectDefinition {
  readonly type: "prevent-move-use";
  readonly operation?: "use" | "activate" | "deactivate";
  readonly selector?: MoveSelectorCondition;
}

export interface RerollEffect extends BaseEffectDefinition {
  readonly type: "reroll";
  readonly roll: "attack" | "defense";
  readonly rerollScope?: "single-result" | "entire-attack";
  /** A modifier applied only to the replacement roll, never the original roll. */
  readonly resultModifier?: NumericExpression;
  readonly bonus?: NumericExpression;
  readonly selector?: MoveSelectorCondition;
  /** A durable reroll is unavailable until its source move records this result. */
  readonly requiresPriorSourceResult?: "successful";
}

export interface RollAndStoreEffect extends BaseEffectDefinition {
  readonly type: "roll-and-store";
  readonly dice: number;
  readonly sides: number | NumericExpression;
  readonly storageKey: string;
}

export interface RemoveMoveFromCombatEffect extends BaseEffectDefinition {
  readonly type: "remove-move-from-combat";
  readonly move: "source" | "target";
  readonly selector?: MoveSelectorCondition;
}

export interface SetResolutionThresholdEffect extends BaseEffectDefinition {
  readonly type: "set-resolution-threshold";
  readonly outcome: "stop" | "successful";
  readonly roll: "attack" | "defense";
  readonly comparison: "at-least" | "at-most";
  readonly value: NumericExpression;
  readonly selector?: MoveSelectorCondition;
  readonly relativeTo?: "attack-roll" | "defense-roll";
  /** How the declared value combines with the referenced roll result. */
  readonly relativeOperation?: "add" | "multiply";
  readonly resultScope?: "current-attack" | "matching-die";
}

export interface SetCombatResultEffect extends BaseEffectDefinition {
  readonly type: "set-combat-result";
  readonly result: "successful" | "stopped" | "critical";
  readonly resultScope: "current-attack" | "matching-die";
}

export interface SetStatComparisonEffect extends BaseEffectDefinition {
  readonly type: "set-stat-comparison";
  readonly left: "self" | "opponent";
  readonly stat: "dexterity";
  readonly comparison: "higher-than";
  readonly right: "self" | "opponent";
}

export interface SetRollResultEffect extends BaseEffectDefinition {
  readonly type: "set-roll-result";
  readonly roll: "attack" | "defense";
  readonly value: NumericExpression;
  readonly resultScope: "matching-die";
}

export interface SwapCombatantStateEffect extends BaseEffectDefinition {
  readonly type: "swap-combatant-state";
  readonly fields: readonly ("hp" | "ki" | "items" | "moveset")[];
  readonly revertWhen: "either-player-dies-or-escapes";
  readonly defeatBasis: "player";
}

export interface SetRollDefinitionEffect extends BaseEffectDefinition {
  readonly type: "set-roll-definition";
  readonly roll: "attack" | "defense";
  readonly dice?: number;
  readonly sides: number;
}

export interface ScheduleEffect extends BaseEffectDefinition {
  readonly type: "schedule-effect";
  readonly timing: {
    readonly type: "turn-start" | "turn-end" | "phase-start";
    readonly subject: "self" | "opponent";
    readonly turnsAfter: number;
    readonly phase?: "upkeep" | "action" | "end";
  };
  readonly repeat?: "each-turn";
  readonly effect: {
    readonly type: "modify-resource";
    readonly resource: "hp" | "ki";
    readonly operation: "damage" | "drain" | "gain" | "lose" | "set";
    readonly amount: NumericExpression;
  };
  readonly cancellation?: {
    readonly actor: "self" | "opponent";
    readonly result: "successful" | "stopped";
    readonly moveSelector: MoveSelectorCondition;
    readonly target: "source" | "other-than-source";
    readonly rollThreshold?: {
      readonly roll: "attack" | "defense" | "transformation";
      readonly comparison: "at-least" | "at-most";
      readonly value: NumericExpression;
      readonly sourceText: string;
    };
  };
}

export interface GrantExtraActionEffect extends BaseEffectDefinition {
  readonly type: "grant-extra-action";
  readonly phase: "action-phase" | "upkeep-phase";
  readonly moveCategory?: "advanced-attack" | "item-use" | "skill" | "power-up";
  readonly move?: "source";
  readonly constant?: boolean;
  readonly maximumActions?: NumericExpression;
}

export interface GrantMasteryEffect extends BaseEffectDefinition {
  readonly type: "grant-mastery";
  readonly source: "opponent";
  readonly duration: { readonly type: "combat"; readonly sourceText: string };
}

export interface GrantTemporaryMoveUseEffect extends BaseEffectDefinition {
  readonly type: "grant-temporary-move-use";
  readonly source: "opponent";
  readonly category: "advanced-attack" | "skill";
  readonly selectionKey: string;
  readonly duration: { readonly type: "combat"; readonly sourceText: string };
}

export interface OverrideStyleReferenceEffect extends BaseEffectDefinition {
  readonly type: "override-style-reference";
  readonly selectionKeys: readonly string[];
  readonly styleId: string;
}

export interface SetRollSelectionEffect extends BaseEffectDefinition {
  readonly type: "set-roll-selection";
  readonly roll: "attack" | "defense";
  readonly diceCount: NumericExpression;
  readonly selection: "highest" | "lowest";
  readonly selector?: MoveSelectorCondition;
}

export interface SkipActionEffect extends BaseEffectDefinition {
  readonly type: "skip-action";
  readonly blockedCategories?: readonly ("basic-attack" | "advanced-attack" | "signature")[];
}

export interface SuppressEffect extends BaseEffectDefinition {
  readonly type: "suppress";
  readonly selector?: MoveSelectorCondition;
  readonly aspects?: readonly ("all-effects" | "successful-effects")[];
}

export interface SuppressRequirementEffect extends BaseEffectDefinition {
  readonly type: "suppress-requirement";
  readonly requirement: string;
}

export interface TravelEffect extends BaseEffectDefinition {
  readonly type: "travel";
  readonly destination: "another-planet";
  readonly frequency: {
    readonly maximumUses: number;
    readonly period: "week";
    readonly prohibitConsecutivePeriods: boolean;
  };
  readonly exception?: {
    readonly condition: "current-planet-destroyed";
    readonly sourceText: string;
  };
}
