import type { EFFECT_TARGET, EFFECT_TRIGGER } from "./constants.js";
import type { StatusId } from "./ids.js";
import type { Requirement } from "./requirements.js";
import type { NumericExpression } from "./types.js";

export type EffectCondition =
  | CombatResultCondition
  | RollThresholdCondition
  | RollComparisonCondition
  | MoveSelectorCondition
  | PriorActionCondition
  | ActionSequenceCondition
  | SuccessfulHitCountCondition
  | DefenseResponseCondition
  | CombatStateCondition
  | ResourceThresholdCondition
  | ResourceComparisonCondition
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

export interface DefenseResponseCondition {
  readonly type: "defense-response";
  readonly blockUsed: boolean;
  readonly resultModified: boolean;
  readonly rerolled: boolean;
  readonly sourceText: string;
}

export interface CombatStateCondition {
  readonly type: "combat-state";
  readonly subject: "self" | "opponent";
  readonly state: "transformed";
  readonly sourceText: string;
}

export interface CombatResultCondition {
  readonly type: "combat-result";
  readonly actor: "self" | "opponent";
  readonly result: "successful" | "stopped" | "critical" | "counter";
  readonly sourceText: string;
}

export interface RollThresholdCondition {
  readonly type: "roll-threshold";
  readonly roll: "attack" | "defense" | "transformation";
  readonly comparison: "at-least" | "at-most";
  readonly value: NumericExpression;
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

export interface MoveSelectorCondition {
  readonly type: "move-selector";
  readonly subject: "source" | "target";
  readonly ids?: readonly string[];
  readonly styleId?: string;
  readonly category?: "advanced-attack" | "signature" | "block" | "skill" | "mastery";
  readonly tags?: readonly string[];
  readonly effectKinds?: readonly ("resource-loss" | "roll-side-reduction")[];
  readonly restriction?: "restricted" | "unrestricted";
  readonly constant?: boolean;
  readonly effectTextIncludes?: string;
  readonly effectTextExcludes?: string;
  readonly baseKiCost?: {
    readonly comparison: "at-least" | "at-most" | "exactly";
    readonly value: NumericExpression;
  };
  readonly attackRoll?: {
    readonly dice?: number;
    readonly sides?: number;
  };
  readonly sourceText: string;
}

export interface PriorActionCondition {
  readonly type: "prior-action";
  readonly actor: "self" | "opponent";
  readonly result?: "successful" | "stopped" | "critical" | "counter";
  readonly selector?: MoveSelectorCondition;
  readonly sourceText: string;
}

export interface ActionSequenceCondition {
  readonly type: "action-sequence";
  readonly actor: "self" | "opponent";
  readonly result: "successful" | "stopped" | "critical" | "counter";
  readonly count: number;
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
  readonly comparison: "at-least" | "at-most";
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

export interface StatComparisonCondition {
  readonly type: "stat-comparison";
  readonly left: "self" | "opponent";
  readonly stat: "dexterity" | "dexterity-bonus" | "power" | "sp" | "max-hp";
  readonly comparison: "at-least" | "at-most" | "higher-than" | "lower-than" | "equal";
  readonly right?: "self" | "opponent";
  readonly rightStat?: "dexterity" | "dexterity-bonus" | "power" | "sp" | "max-hp";
  readonly rightMultiplier?: NumericExpression;
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
      readonly type: "next-roll";
      readonly roll: "attack" | "defense" | "transformation";
      readonly sourceText: string;
    }
  | {
      readonly type: "next-rolls";
      readonly roll: "attack" | "defense" | "transformation";
      readonly count: NumericExpression;
      readonly sourceText: string;
    }
  | { readonly type: "combat"; readonly sourceText: string };

export interface BaseEffectDefinition {
  readonly trigger: (typeof EFFECT_TRIGGER)[keyof typeof EFFECT_TRIGGER];
  readonly target?: (typeof EFFECT_TARGET)[keyof typeof EFFECT_TARGET];
  readonly requirements?: readonly Requirement[];
  readonly conditions?: readonly EffectCondition[];
  readonly scope?: EffectScope;
  readonly duration?: EffectDuration;
  readonly stacking?: "allow" | "prevent";
  readonly useLimit?: {
    readonly scope: "combat" | "turn";
    readonly count: number;
    readonly sourceText: string;
  };
  readonly activationCost?: {
    readonly resource: "ki";
    readonly amount: NumericExpression;
    readonly operation: "lose";
  };
  readonly activationGroup?: string;
  readonly sourceText: string;
}

export type EffectDefinition =
  | ActivateEffect
  | ApplyStatusEffect
  | CopyMoveEffect
  | CreateFloatingEffect
  | ModifyRemainingUsesEffect
  | DeactivateEffect
  | EndFloatingEffect
  | ForceActionEffect
  | GrantRacialTraitsEffect
  | GrantCounterActionEffect
  | GrantExtraActionEffect
  | LockEffect
  | ModifyCostEffect
  | ModifyCriticalThresholdEffect
  | ModifySlotCapacityEffect
  | ModifyStatEffect
  | ModifyDamageEffect
  | ModifyResourceEffect
  | ModifyRollEffect
  | ModifyRollModifierEffect
  | NegateEffect
  | PreventResolutionEffect
  | PreventCombatResultEffect
  | PreventMoveModificationEffect
  | PreventRollModificationEffect
  | PreventStatusEffect
  | PreventMoveUseEffect
  | RerollEffect
  | RemoveMoveFromCombatEffect
  | RevertTransformationEffect
  | ScheduleEffect
  | SetCombatResultEffect
  | SetResolutionThresholdEffect
  | SetRollDefinitionEffect
  | SetRollSelectionEffect
  | SkipActionEffect
  | SuppressEffect;

export interface ApplyStatusEffect extends BaseEffectDefinition {
  readonly type: "apply-status";
  readonly statusId: StatusId;
  readonly selector?: MoveSelectorCondition;
}

export interface ActivateEffect extends BaseEffectDefinition {
  readonly type: "activate";
  readonly selector: MoveSelectorCondition;
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
        readonly type: "selected-move";
        readonly actor: "self" | "opponent";
        readonly category: "advanced-attack" | "signature";
        readonly restriction?: "restricted" | "unrestricted";
        readonly styleId?: string;
      };
  readonly effectResult: "successful" | "stopped";
  readonly resolveAs: "source-move";
  readonly damage?:
    | { readonly type: "total-damage"; readonly sourceMove: "selected-prior-move" }
    | { readonly type: "half-base-damage-per-die"; readonly sourceMove: "last-advanced-attack" };
  readonly cost?: { readonly type: "selected-move-base-cost" };
}

export interface CreateFloatingEffect extends BaseEffectDefinition {
  readonly type: "create-floating-effect";
  readonly floatingEffectId: string;
}

export interface ModifyRemainingUsesEffect extends BaseEffectDefinition {
  readonly type: "modify-remaining-uses";
  readonly amount: NumericExpression;
  readonly selector: MoveSelectorCondition;
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
}

export interface GrantRacialTraitsEffect extends BaseEffectDefinition {
  readonly type: "grant-racial-traits";
  readonly source: "opponent";
}

export interface GrantCounterActionEffect extends BaseEffectDefinition {
  readonly type: "grant-counter-action";
  readonly stopsTriggeringAttack: boolean;
  readonly action: "choose-attack" | "repeat-triggering-attack";
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
  readonly count?: NumericExpression;
  readonly selector?: MoveSelectorCondition;
}

export interface RevertTransformationEffect extends BaseEffectDefinition {
  readonly type: "revert-transformation";
}

export interface LockEffect extends BaseEffectDefinition {
  readonly type: "lock";
  readonly affectedType: "attack" | "block" | "escape" | "move" | "power-up" | "skill";
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

export interface ModifyCostEffect extends BaseEffectDefinition {
  readonly type: "modify-cost";
  readonly operation: "add" | "set";
  readonly amount: NumericExpression;
  readonly selector?: MoveSelectorCondition;
  readonly minimum?: NumericExpression;
  readonly maximum?: NumericExpression;
}

export interface ModifyCriticalThresholdEffect extends BaseEffectDefinition {
  readonly type: "modify-critical-threshold";
  readonly threshold: NumericExpression;
  readonly basis: "natural-result" | "final-result";
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
}

export interface ModifyRollEffect extends BaseEffectDefinition {
  readonly type: "modify-roll";
  readonly roll: "attack" | "defense" | "transformation";
  readonly modifier: "result" | "sides";
  readonly amount?: NumericExpression;
  readonly selector?: MoveSelectorCondition;
  readonly cap?:
    | { readonly type: "allow-exceed"; readonly sourceText: string }
    | { readonly type: "maximum"; readonly value: NumericExpression; readonly sourceText: string };
}

export interface ModifyRollModifierEffect extends BaseEffectDefinition {
  readonly type: "modify-roll-modifier";
  readonly multiplier?: NumericExpression;
  readonly increment?: NumericExpression;
  readonly modifier: "result" | "sides" | "any";
  readonly excludeSourceCategories?: readonly ("mastery" | "skill")[];
  readonly cap?: { readonly type: "allow-exceed"; readonly sourceText: string };
}

export interface NegateEffect extends BaseEffectDefinition {
  readonly type: "negate";
  readonly aspects?: readonly "prevent-attack"[];
}

export interface PreventResolutionEffect extends BaseEffectDefinition {
  readonly type: "prevent-resolution";
  readonly prevention: "block" | "stop";
  readonly selector?: MoveSelectorCondition;
}

export interface PreventCombatResultEffect extends BaseEffectDefinition {
  readonly type: "prevent-combat-result";
  readonly result: "critical" | "counter";
}

export interface PreventMoveModificationEffect extends BaseEffectDefinition {
  readonly type: "prevent-move-modification";
  readonly selector: MoveSelectorCondition;
  readonly aspects: readonly ("cost" | "damage" | "dice-sides" | "effects" | "roll-results")[];
  readonly actor: "self" | "opponent";
}

export interface PreventRollModificationEffect extends BaseEffectDefinition {
  readonly type: "prevent-roll-modification";
  readonly roll: "attack" | "defense";
  readonly modifier: "result" | "sides" | "any";
  readonly selector?: MoveSelectorCondition;
}

export interface PreventStatusEffect extends BaseEffectDefinition {
  readonly type: "prevent-status";
  readonly statusId: StatusId;
}

export interface PreventMoveUseEffect extends BaseEffectDefinition {
  readonly type: "prevent-move-use";
}

export interface RerollEffect extends BaseEffectDefinition {
  readonly type: "reroll";
  readonly roll: "attack" | "defense";
  readonly rerollScope?: "single-result" | "entire-attack";
  readonly selector?: MoveSelectorCondition;
}

export interface RemoveMoveFromCombatEffect extends BaseEffectDefinition {
  readonly type: "remove-move-from-combat";
  readonly move: "source" | "target";
}

export interface SetResolutionThresholdEffect extends BaseEffectDefinition {
  readonly type: "set-resolution-threshold";
  readonly outcome: "stop" | "successful";
  readonly roll: "attack" | "defense";
  readonly comparison: "at-least" | "at-most";
  readonly value: NumericExpression;
  readonly selector?: MoveSelectorCondition;
  readonly relativeTo?: "attack-roll" | "defense-roll";
  readonly resultScope?: "current-attack" | "matching-die";
}

export interface SetCombatResultEffect extends BaseEffectDefinition {
  readonly type: "set-combat-result";
  readonly result: "successful" | "stopped" | "critical";
  readonly resultScope: "current-attack" | "matching-die";
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
    readonly operation: "drain" | "gain" | "lose" | "set";
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
  readonly moveCategory?: "advanced-attack" | "skill" | "power-up";
  readonly move?: "source";
  readonly constant?: boolean;
  readonly maximumActions?: NumericExpression;
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
  readonly blockedCategories?: readonly ("advanced-attack" | "signature")[];
}

export interface SuppressEffect extends BaseEffectDefinition {
  readonly type: "suppress";
  readonly selector?: MoveSelectorCondition;
  readonly aspects?: readonly ("all-effects" | "successful-effects")[];
}
