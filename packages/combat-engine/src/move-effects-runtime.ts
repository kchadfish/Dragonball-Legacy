import type {
  EffectDefinition,
  MoveDefinition,
  MoveSelectorCondition,
  NumericExpression,
} from "@dragonball-resurgence/game-data";

import { evaluateDurableNumericExpression, matchesMoveSelector } from "./declarative-runtime.js";
import { compileEffectPlan, executeCompiledEffect } from "./effect-executors.js";

import type {
  ActiveCombatEffect,
  ActiveStatus,
  CombatActionRecord,
  CombatantState,
} from "./contracts.js";
import type { AttackDieRoll, ResolutionThresholdRule } from "./attack-rolls.js";
import type { CombatantId } from "./ids.js";

export interface MoveEffectRuntimeContext {
  readonly self: CombatantState;
  readonly opponent: CombatantState;
  readonly turnNumber: number;
  readonly completedTurnCount: number;
  readonly moves: ReadonlyMap<string, MoveDefinition>;
  readonly moveActivationCounts: ReadonlyMap<string, number>;
  readonly successfulHitCount: number;
  /** Completed actions are authoritative context for prior-action conditions. */
  readonly actionHistory?: readonly CombatActionRecord[];
  /** Durable effects are authoritative for move-effect-active conditions. */
  readonly activeEffects?: readonly ActiveCombatEffect[];
  /** Current-resolution suppressions are discarded with the attack transition. */
  readonly resolutionSuppressions?: readonly SuppressionApplication[];
  /** The attack currently being resolved, available to action-sequence conditions. */
  readonly currentAction?: Extract<
    CombatActionRecord,
    { readonly type: "basic-attack" | "use-move" }
  >;
  readonly rolls?: readonly AttackDieRoll[];
  /** Declarative roll modifiers applied to the current roll event. */
  readonly rollModification?: {
    readonly actor: "self" | "opponent";
    readonly roll: "attack" | "defense";
    readonly modifiers: readonly ("sides" | "result")[];
    readonly excludeSource: "dexterity";
  };
  readonly paidKiCost?: number;
  /** The activation cost recorded for the CONSTANT Skill currently resolving. */
  readonly paidActivationCost?: number;
  /** Damage entering the current on-damage response point, if any. */
  readonly incomingDamage?: number;
  /** Final damage dealt by the current attack when a resource effect consumes it. */
  readonly currentDamage?: number;
  /** Damage dealt by the attack stopped by the current block resolution. */
  readonly blockedAttackDamage?: number;
  /** Whether the completed defense used a block, changed a result, or rerolled. */
  readonly defenseResponse?: {
    readonly blockUsed: boolean;
    readonly resultModified: boolean;
    readonly rerolled: boolean;
  };
  readonly selectedNumericValues?: Readonly<Record<string, number>>;
  readonly mode?: "spar" | "battle";
  /** The attack that caused a passive effect owned by another move to trigger. */
  readonly triggeringMove?: MoveDefinition;
  /** Which combatant owns triggeringMove; required for base-cost/base-damage expressions. */
  readonly triggeringMoveOwner?: "self" | "opponent";
  /** The resource event currently being observed by an on-resource trigger. */
  readonly resourceChange?: ResourceChangeEvent;
  /** The combat result currently being observed by an on-combat-result trigger. */
  readonly combatOutcome?: "stun" | "critical" | "counter";
  /** The actor whose result is currently being observed. */
  readonly combatOutcomeActor?: "self" | "opponent";
  /** The declarative source currently dispatching a resource event. */
  readonly sourceDefinitionId?: string;
  /** The resource state immediately before the current threshold transition. */
  readonly previousResourceState?: {
    readonly self: CombatantState;
    readonly opponent: CombatantState;
  };
  /** Direct source resolution opts into bundles owned by the acting combatant. */
  readonly includeActiveFloatingEffects?: boolean;
  /** Collect optional effect groups that can be resumed before a roll. */
  readonly collectPendingChoices?: boolean;
  /** Effect indices explicitly enabled by a pending-choice response. */
  readonly enabledOptionalEffectIndices?: readonly number[];
  /** Effect indices whose optional decision has already been resolved. */
  readonly resolvedOptionalEffectIndices?: readonly number[];
  /** Target retained by the floating effect whose nested effects are dispatching. */
  readonly floatingEffectTargetCombatantId?: CombatantId;
}

export interface PendingEffectChoice {
  readonly sourceDefinitionId: MoveDefinition["id"];
  readonly effectIndices: readonly number[];
  readonly activationGroup?: string;
  readonly numericSelection?: {
    readonly key: string;
    readonly minimum: number;
    readonly maximum: number;
  };
}

type RollComparisonRuntimeCondition = Extract<
  RuntimeCondition,
  { readonly type: "roll-comparison" }
>;
type RollThresholdRuntimeCondition = Extract<RuntimeCondition, { readonly type: "roll-threshold" }>;
type SuccessfulHitCountRuntimeCondition = Extract<
  RuntimeCondition,
  { readonly type: "successful-hit-count" }
>;
type CombatResultRuntimeCondition = Extract<RuntimeCondition, { readonly type: "combat-result" }>;

export interface ResourceChangeEvent {
  readonly resource: "hp" | "ki";
  readonly operation: "gain" | "lose";
  readonly amount: number;
  /** The affected combatant relative to the move currently being evaluated. */
  readonly subject: "self" | "opponent";
  readonly cause?: "non-damage-effect" | "opponent-effect";
  readonly sourceStyleId?: string;
}

export interface ResourceChange {
  readonly resource: "hp" | "ki";
  readonly target: "self" | "opponent";
  readonly operation: "drain" | "gain" | "lose" | "set";
  readonly amount: number;
  readonly cap?: { readonly type: "maximum" | "minimum"; readonly value: number };
  readonly sourceCombatantId?: CombatantState["id"];
  readonly sourceDefinitionId?: MoveDefinition["id"];
  readonly sourceEffectIndex?: number;
  readonly useLimit?: { readonly scope: "combat" | "turn"; readonly count: number };
  readonly preventable?: boolean;
  readonly activationCost?: {
    readonly resource: "hp" | "ki";
    readonly amount: number;
    readonly minimum?: number;
  };
  readonly cause?: "non-damage-effect" | "opponent-effect";
  readonly sourceStyleId?: string;
}

export interface ResourceActionModifierApplication {
  readonly target: "self" | "opponent";
  readonly effectIndex: number;
  readonly resource: "hp" | "ki";
  readonly operation: "drain" | "gain" | "lose" | "set";
  readonly amount: number;
  readonly basis: "damage-percent";
  readonly scope: "next-action";
}

export interface ResourceCostModifierApplication {
  readonly target: "self" | "opponent";
  readonly sourceCombatantId: CombatantState["id"];
  readonly sourceDefinitionId: MoveDefinition["id"];
  readonly effectIndex: number;
  readonly resource: "hp";
  readonly operation: "add";
  readonly percent: number;
  readonly selector: MoveSelectorCondition;
  readonly scope: "next-action";
  readonly stacking: "prevent";
  readonly activationCost?: {
    readonly resource: "ki";
    readonly amount: number;
    readonly minimum?: number;
  };
}

export interface StoredRollRequest {
  readonly target: "self";
  readonly sourceDefinitionId: MoveDefinition["id"];
  readonly effectIndex: number;
  readonly storageKey: string;
  readonly dice: number;
  readonly sides: number;
}

export interface StoredMoveSelectionRequest {
  readonly target: "self";
  readonly sourceDefinitionId: MoveDefinition["id"];
  readonly effectIndex: number;
  readonly storageKey: string;
  readonly selectionKey: string;
  readonly selector: MoveSelectorCondition;
  readonly ordering: "character-sheet-top-to-bottom";
  readonly reindex: "on-moveset-change";
}

export interface StatusApplication {
  readonly status: ActiveStatus;
  readonly target: "self" | "opponent";
}

export interface RerollApplication {
  readonly target: "self" | "opponent";
  readonly sourceDefinitionId: MoveDefinition["id"];
  readonly effectIndex: number;
  readonly trigger?: "after-defense-roll" | "on-success" | "before-defense-roll" | "on-roll-result";
  readonly roll: "attack" | "defense";
  readonly rerollScope: "single-result" | "entire-attack";
  readonly resultModifier: number;
  readonly bonus?: number;
  readonly selector?: MoveSelectorCondition;
  readonly conditions: EffectDefinition["conditions"];
  readonly optional: boolean;
  readonly duration:
    | "combat"
    | { readonly type: "next-action" }
    | { readonly type: "next-roll"; readonly roll: "attack" | "defense" }
    | {
        readonly type: "next-rolls";
        readonly roll: "attack" | "defense";
        readonly remaining: number;
      };
  readonly useLimit?: { readonly scope: "combat" | "turn"; readonly count: number };
  readonly activationResource?: "ki" | "hp";
  readonly activationCost?: number;
  readonly requiresPriorSourceResult?: "successful";
}

export interface ForcedActionApplication {
  readonly target: "self" | "opponent";
  readonly allowedCategories: readonly ("advanced-attack" | "signature")[];
  readonly allowedTags?: readonly string[];
  readonly allowPass: boolean;
  readonly fallback?: "basic-attack";
  readonly selectedMoveStorageKey?: string;
}

export interface ActionRestrictionApplication {
  readonly target: "self" | "opponent";
  /** Omitted means the target's entire action is skipped. */
  readonly blockedCategories?: readonly ("basic-attack" | "advanced-attack" | "signature")[];
  readonly remainingTurns: number;
  readonly effectIndex: number;
}

export interface MoveRemovalApplication {
  readonly target: "self" | "opponent";
  readonly move: "source" | "target";
  readonly effectIndex: number;
}

export interface ExtraActionApplication {
  readonly target: "self" | "opponent";
  readonly sourceDefinitionId?: MoveDefinition["id"];
  readonly phase: "action" | "upkeep";
  readonly moveCategory?: "advanced-attack" | "item-use" | "skill" | "power-up";
  readonly sourceMoveOnly: boolean;
  readonly constant?: boolean;
  readonly maximumActions?: number;
  readonly scope: "current-turn" | "next-turn";
  readonly useLimit?: { readonly scope: "combat" | "turn"; readonly count: number };
  readonly effectIndex: number;
}

/** A declarative counter permission retained until its counter transition. */
export interface CounterActionApplication {
  readonly target: "self" | "opponent";
  readonly sourceDefinitionId: MoveDefinition["id"];
  readonly effectIndex: number;
  readonly action: "choose-attack" | "repeat-triggering-attack" | "use-source-attack";
  readonly stopsTriggeringAttack: boolean;
  readonly ignoreRequirements: boolean;
  readonly activationCost?: {
    readonly resource: "ki";
    readonly amount: number;
    readonly minimum?: number;
  };
  readonly costModifier?: {
    readonly operation: "add" | "set";
    readonly amount: number;
    readonly minimum?: number;
  };
  readonly useLimit?: { readonly scope: "combat"; readonly count: number };
  readonly duration?: { readonly type: "turns"; readonly remaining: number };
  readonly stacking?: "prevent";
  readonly sourceAction?: Extract<
    CombatActionRecord,
    { readonly type: "basic-attack" | "use-move" }
  >;
  readonly sourceMove?: MoveDefinition;
}

type ScheduledRoll = "attack" | "defense" | "transformation";

export interface ScheduledResourceApplication {
  readonly target: "self" | "opponent";
  readonly effectIndex: number;
  readonly timing: {
    readonly type: "turn-start" | "turn-end" | "phase-start";
    readonly subject: "self" | "opponent";
    readonly turnsAfter: number;
    readonly phase?: "upkeep" | "action" | "end";
  };
  readonly repeat: "once" | "each-turn";
  readonly resource: "hp" | "ki";
  readonly operation: "damage" | "drain" | "gain" | "lose" | "set";
  readonly amount: Extract<
    EffectDefinition,
    { readonly type: "schedule-effect" }
  >["effect"]["amount"];
  readonly stacking?: "prevent";
  readonly duration?:
    | { readonly type: "turns"; readonly remaining: number }
    | {
        readonly type: "until-roll-threshold";
        readonly roll: ScheduledRoll;
        readonly comparison: "at-least" | "at-most";
        readonly value: number;
        readonly moveSelector?: MoveSelectorCondition;
      };
  readonly cancellation?: {
    readonly actor: "self" | "opponent";
    readonly result: "successful" | "stopped";
    readonly moveSelector: MoveSelectorCondition;
    readonly target: "source" | "other-than-source";
    readonly rollThreshold?: {
      readonly roll: ScheduledRoll;
      readonly comparison: "at-least" | "at-most";
      readonly value: number;
    };
  };
}

type LockDuration =
  | { readonly type: "combat" }
  | { readonly type: "turns"; readonly remaining: number }
  | { readonly type: "next-actions"; readonly remaining: number }
  | {
      readonly type: "until-roll-threshold";
      readonly roll: "attack" | "defense" | "transformation";
      readonly comparison: "at-least" | "at-most";
      readonly value: number;
    }
  | {
      readonly type: "until-resource-threshold";
      readonly subject: "self" | "opponent";
      readonly resource: "hp" | "ki";
      readonly comparison: "at-least" | "at-most";
      readonly value: number;
    }
  | {
      readonly type: "until-combat-result";
      readonly actor: "self" | "opponent";
      readonly result: "successful" | "stopped" | "critical" | "counter";
      readonly selector?: MoveSelectorCondition;
    }
  | {
      readonly type: "until-turn-start-roll-threshold";
      readonly subject: "self" | "opponent";
      readonly dice: number;
      readonly sides: number;
      readonly comparison: "at-least" | "at-most";
      readonly value: number;
      readonly remainingIgnoredChecks: number;
    };

export interface LockApplication {
  readonly target: "self" | "opponent";
  readonly affectedType: Extract<EffectDefinition, { readonly type: "lock" }>["affectedType"];
  readonly selector?: MoveSelectorCondition;
  readonly duration: LockDuration;
}

export interface DeactivationApplication {
  readonly target: "self" | "opponent";
  readonly affectedType: "skill" | "transformation";
  readonly selection: "one" | "all";
  readonly optional: boolean;
  readonly selector?: MoveSelectorCondition;
  readonly count?: number;
  /** The declarative move that produced this application, retained for replay. */
  readonly sourceDefinitionId: string;
  readonly sourceText: string;
}

export interface ActivationApplication {
  readonly trigger: "before-attack-roll" | "on-success" | "start-combat" | "on-roll-result";
  readonly scope?: {
    readonly type: "next-phase";
    readonly subject: "self" | "opponent";
    readonly phase: "upkeep" | "action" | "end";
  };
  readonly target: "self" | "opponent";
  readonly selector: MoveSelectorCondition;
  readonly optional: boolean;
  readonly effectIndex: number;
  readonly sourceCombatantId: CombatantState["id"];
  /** Absolute activation cost supplied by a paired current-cost set effect. */
  readonly activationCostOverride?: number;
  /** Resolved declarative KI cost required by this activation path. */
  readonly activationCost?: { readonly amount: number; readonly minimum?: number };
  /** Number of distinct constants to reactivate for a resolved repeat expression. */
  readonly selectionLimit?: number;
  /** Restricts the selector to constants currently in the deactivated lifecycle. */
  readonly reactivationOnly?: boolean;
  /** The declarative move that produced this application, retained for replay. */
  readonly sourceDefinitionId: string;
  readonly sourceText: string;
}

export interface FloatingEffectApplication {
  readonly target: "self" | "opponent";
  /** Target retained for nested target-relation conditions. */
  readonly targetRelationCombatantId?: CombatantId;
  /** Immutable damage snapshot captured at the blocked-attack response point. */
  readonly blockedAttackDamage?: number;
  readonly sourceEffectIndex: number;
  readonly floatingEffectId: string;
  readonly effects: readonly EffectDefinition[];
  readonly termination: readonly {
    readonly trigger: "on-power-up" | "on-stopped" | "on-success";
    readonly actor: "self" | "opponent";
    readonly selector?: MoveSelectorCondition;
  }[];
  readonly scope: Extract<EffectDefinition, { readonly type: "create-floating-effect" }>["scope"];
  readonly duration?:
    | {
        readonly type: "until-combat-result";
        readonly actor: "self" | "opponent";
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
        readonly roll: "attack" | "defense";
        readonly comparison: "at-least" | "at-most";
        readonly value: number;
        readonly moveSelector?: MoveSelectorCondition;
      };
  readonly stacking?: "allow" | "prevent";
  readonly activationCost?: {
    readonly resource: "hp" | "ki";
    readonly amount: number;
    readonly minimum?: number;
  };
  readonly useLimit?: { readonly scope: "combat" | "turn"; readonly count: number };
}

export interface MoveUsePreventionApplication {
  readonly target: "self" | "opponent";
  readonly operation: "use" | "activate" | "deactivate";
  readonly selector?: MoveSelectorCondition;
  readonly duration: LockApplication["duration"];
}

export interface RemainingUseModificationApplication {
  readonly sourceCombatantId: CombatantState["id"];
  readonly sourceDefinitionId: MoveDefinition["id"];
  readonly target: "self" | "opponent";
  readonly amount: number;
  readonly selector: MoveSelectorCondition;
}

export interface StatusPreventionApplication {
  readonly target: "self" | "opponent";
  readonly statusId: ActiveStatus["statusId"];
  readonly duration: LockApplication["duration"];
}

export interface NegationApplication {
  readonly target: "self" | "opponent";
  readonly aspects: readonly ("prevent-attack" | "prevent-damage")[];
  readonly selector?: MoveSelectorCondition;
  readonly combatOutcomes?: readonly ("stun" | "critical" | "counter" | "sever" | "break")[];
  readonly sourceDefinitionId?: MoveDefinition["id"];
  readonly sourceEffectIndex?: number;
  readonly useLimit?: { readonly scope: "combat" | "turn"; readonly count: number };
}

type RollModificationModifier = "dice" | "result" | "sides";
type RollModificationCap =
  | {
      readonly type: "maximum" | "minimum";
      readonly scope: "amount" | "total" | "roll";
      readonly value: number;
    }
  | { readonly type: "allow-exceed"; readonly scope: "amount" | "total" | "roll" };

export interface RollModification {
  readonly target: "self" | "opponent";
  readonly roll: "attack" | "defense" | "escape" | "initiative" | "transformation";
  readonly modifier: RollModificationModifier;
  readonly amount: number;
  readonly multiplier?: number;
  readonly affectedDice?: "all" | "ceiling-half";
  readonly cap?: RollModificationCap;
  /** One-based die index for an immediate per-die result modifier. */
  readonly dieIndex?: number;
  readonly selector?: MoveSelectorCondition;
  readonly stacking?: "allow" | "prevent";
  /** Retained so state mutation can distinguish immediate from durable roll changes. */
  readonly scope?:
    | "current-action"
    | "combat"
    | "following-action"
    | "next-action"
    | "next-actions"
    | "next-phase"
    | "next-roll"
    | "next-rolls"
    | "next-turn";
  /** Resolved count for next-actions/next-rolls scopes. */
  readonly remaining?: number;
  readonly duration?:
    | { readonly type: "combat" }
    | { readonly type: "turns"; readonly remaining: number }
    | { readonly type: "turns-or-until-perfect-roll"; readonly remaining: number };
  /** Source provenance is required by modifier-transforming effects. */
  readonly sourceDefinitionId?: MoveDefinition["id"];
  readonly sourceEffectIndex?: number;
}

export interface RollModificationTransformerApplication {
  readonly target: "self" | "opponent";
  readonly sourceDefinitionId: MoveDefinition["id"];
  readonly effectIndex: number;
  readonly modifier: "result" | "sides" | "any";
  readonly multiplier?: number;
  readonly increment?: number;
  readonly excludeSourceCategories?: readonly ("mastery" | "skill")[];
  readonly cap?: { readonly type: "allow-exceed"; readonly scope?: "amount" | "total" | "roll" };
  readonly duration: "combat" | { readonly type: "next-roll"; readonly roll: "attack" | "defense" };
}

export interface RollSelectionApplication {
  readonly target: "self" | "opponent";
  readonly sourceDefinitionId: MoveDefinition["id"];
  readonly effectIndex: number;
  readonly roll: "attack" | "defense";
  readonly diceCount: number;
  readonly selection: "highest" | "lowest";
  readonly selector?: MoveSelectorCondition;
  readonly scope: "current-action" | "next-roll";
}

export interface SlotCapacityModificationApplication {
  readonly sourceCombatantId: CombatantState["id"];
  readonly sourceDefinitionId: MoveDefinition["id"];
  readonly sourceEffectIndex: number;
  readonly slot: "mastery" | "skill" | "advanced-attack" | "signature" | "block";
  readonly amount: number;
}

export interface DamageModification {
  readonly target: "self" | "opponent";
  readonly effectIndex: number;
  /** Provenance for immediate response effects that may require a choice. */
  readonly sourceCombatantId?: CombatantState["id"];
  readonly sourceDefinitionId?: MoveDefinition["id"];
  readonly operation: "add" | "multiply" | "set";
  /** Resolved damage amount, or the percentage for a multiplicative change. */
  readonly amount: number;
  readonly basis: "power-percent" | "damage-percent";
  readonly cap?: { readonly type: "maximum" | "minimum"; readonly value: number };
  readonly capOnly?: boolean;
  readonly selector?: MoveSelectorCondition;
  readonly scope?: "current-action" | "following-action" | "next-action" | "next-actions";
  readonly remaining?: number;
  readonly availableFromTurn?: number;
  readonly stacking?: "allow" | "prevent";
  readonly useLimit?: { readonly scope: "combat"; readonly count: number };
  readonly activationCost?: {
    readonly resource: "hp" | "ki";
    readonly amount: number;
    readonly minimum?: number;
  };
  readonly duration?:
    | { readonly type: "combat" }
    | {
        readonly type: "turns";
        readonly ownerCombatantId: CombatantState["id"];
        readonly remaining: number;
      }
    | {
        readonly type: "until-roll-threshold";
        readonly combatantId: CombatantState["id"];
        readonly roll: "attack";
        readonly comparison: "at-least" | "at-most";
        readonly value: number;
      };
}

export interface StatModification {
  readonly target: "self" | "opponent";
  readonly stat: "dexterity" | "dexterity-bonus";
  readonly operation: "add" | "set" | "multiply";
  readonly amount: number;
  readonly selector?: MoveSelectorCondition;
  readonly scope?: "next-action" | "next-roll";
  readonly roll?: "attack" | "defense";
  readonly duration?: {
    readonly type: "turns";
    readonly ownerCombatantId: CombatantState["id"];
    readonly remaining: number;
  };
}

export interface SuppressionApplication {
  readonly target: "self" | "opponent";
  readonly selector?: MoveSelectorCondition;
  readonly aspects: readonly ("all-effects" | "successful-effects")[];
  readonly duration:
    | { readonly type: "current-resolution" }
    | { readonly type: "combat" }
    | { readonly type: "turns"; readonly remaining: number }
    | { readonly type: "next-actions"; readonly remaining: number }
    | { readonly type: "following-action"; readonly remaining: number }
    | {
        readonly type: "until-roll-threshold";
        readonly roll: "attack";
        readonly comparison: "at-least" | "at-most";
        readonly value: number;
      };
}

export interface CostModification {
  readonly target: "self" | "opponent";
  readonly operation: "add" | "set";
  readonly amount: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly selector?: MoveSelectorCondition;
  readonly scope: "next-action" | "next-actions";
  readonly remaining?: number;
}

export interface CurrentActionCostModification {
  readonly target: "self" | "opponent";
  readonly operation: "add" | "set";
  readonly amount: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly selector?: MoveSelectorCondition;
  readonly sourceDefinitionId?: string;
  readonly sourceEffectIndex?: number;
  readonly sourceCombatantId?: CombatantId;
  readonly activationCost?: {
    readonly resource: "hp" | "ki";
    readonly amount: number;
    readonly minimum?: number;
  };
}

export interface RollDefinitionOverride {
  readonly target: "self" | "opponent";
  readonly roll: "attack" | "defense";
  readonly dice?: number;
  readonly sides: number;
}

export interface RollResultOverride {
  readonly target: "self" | "opponent";
  readonly roll: "attack" | "defense";
  readonly value: number;
  readonly resultScope: "matching-die";
}

export interface CombatResultOverrideApplication {
  readonly target: "self" | "opponent";
  readonly result: "successful" | "stopped" | "critical";
  readonly resultScope: "current-attack" | "matching-die";
  readonly scope?: "next-action";
  readonly selector?: MoveSelectorCondition;
  readonly effectIndex?: number;
}

export interface CriticalThresholdApplication {
  readonly target: "self";
  readonly threshold: number;
  readonly basis: "natural-result" | "final-result";
  readonly selector?: MoveSelectorCondition;
}

export interface ResolutionThresholdApplication extends ResolutionThresholdRule {
  readonly target: "self" | "opponent";
  readonly selector?: MoveSelectorCondition;
  readonly scope?: "current-action" | "next-action";
  readonly duration?:
    | { readonly type: "combat" }
    | {
        readonly type: "until-roll-threshold";
        readonly roll: "attack" | "defense";
        readonly comparison: "at-least" | "at-most";
        readonly value: number;
      };
}

/** A declared prohibition against a resolution outcome for the current action. */
export interface ResolutionPreventionApplication {
  readonly target: "self" | "opponent";
  readonly prevention: "block" | "stop";
}

export interface CombatResultPreventionApplication {
  readonly target: "self" | "opponent";
  readonly result: "critical" | "counter" | "sever";
  readonly selector?: MoveSelectorCondition;
  readonly duration: LockApplication["duration"];
}

export interface RollModificationPreventionApplication {
  readonly target: "self" | "opponent";
  readonly roll: "attack" | "defense" | "escape" | "initiative" | "transformation";
  readonly modifier: "dice" | "result" | "sides" | "any";
  readonly selector?: MoveSelectorCondition;
  readonly exemptSourceEffect?: boolean;
  readonly duration: LockApplication["duration"];
}

export interface MoveModificationPreventionApplication {
  readonly target: "self" | "opponent";
  readonly actor: "self" | "opponent" | "any";
  readonly selector: MoveSelectorCondition;
  readonly aspects: readonly ("cost" | "damage" | "dice-sides" | "effects" | "roll-results")[];
  readonly effectSourceStyleExcludes?: string;
  readonly exceptSourceMoveIds?: readonly string[];
  readonly exceptSourceStatusIds?: readonly ActiveStatus["statusId"][];
  readonly operations?: readonly "reduce"[];
  /** Turn on which a next-turn scoped prevention becomes active. */
  readonly availableFromTurn?: number;
  readonly duration: LockApplication["duration"];
}

export interface CurrentActionMoveModificationPreventionApplication {
  readonly target: "self" | "opponent";
  readonly actor: "self" | "opponent" | "any";
  readonly selector: MoveSelectorCondition;
  readonly aspects: readonly ("cost" | "damage" | "dice-sides" | "effects" | "roll-results")[];
  readonly effectSourceStyleExcludes?: string;
  readonly exceptSourceMoveIds?: readonly string[];
  readonly exceptSourceStatusIds?: readonly ActiveStatus["statusId"][];
  readonly operations?: readonly "reduce"[];
}

export interface ResourceModificationPreventionApplication {
  readonly target: "self" | "opponent";
  readonly resource: "hp" | "ki";
  readonly operation: "gain" | "lose" | "set";
  readonly sourceActor?: "opponent";
  readonly exceptAction?: "power-up";
  readonly duration?: LockApplication["duration"];
}

type RuntimeCondition = NonNullable<EffectDefinition["conditions"]>[number];

const compare = (left: number, comparison: "at-least" | "at-most" | "exactly", right: number) => {
  if (comparison === "at-least") return left >= right;
  if (comparison === "at-most") return left <= right;
  return left === right;
};

const rollValue = (roll: AttackDieRoll, type: "attack" | "defense", natural: boolean) => {
  if (type === "attack") return natural ? roll.attackNaturalResult : roll.attackResult;
  return natural ? roll.defenseNaturalResult : roll.defenseResult;
};

const rollThresholdMatches = (
  condition: Extract<RuntimeCondition, { readonly type: "roll-threshold" }>,
  context: MoveEffectRuntimeContext,
) => {
  const rollType = condition.roll;
  if (rollType === "transformation") return false;
  const value = numeric(condition.value, context);
  return (
    value !== undefined &&
    (context.rolls ?? []).some((roll) => {
      const rollResult = rollValue(roll, rollType, condition.natural === true);
      return (
        rollResult !== undefined &&
        (condition.comparison === "at-least" ? rollResult >= value : rollResult <= value)
      );
    })
  );
};

const rollComparisonMatches = (
  condition: Extract<RuntimeCondition, { readonly type: "roll-comparison" }>,
  context: MoveEffectRuntimeContext,
) => {
  const difference =
    condition.difference === undefined ? 0 : numeric(condition.difference, context);
  const multiplier =
    condition.rightMultiplier === undefined ? 1 : numeric(condition.rightMultiplier, context);
  return (
    difference !== undefined &&
    multiplier !== undefined &&
    (context.rolls ?? []).some((roll) => {
      if (roll.defenseResult === undefined) return false;
      const left = rollValue(roll, condition.left, false);
      const right = rollValue(roll, condition.right, false);
      if (left === undefined || right === undefined) return false;
      const target = right * multiplier + difference;
      return compare(
        left,
        condition.comparison === "equal" ? "exactly" : condition.comparison,
        target,
      );
    })
  );
};

const combatantStatValue = (
  combatant: CombatantState,
  stat: Extract<RuntimeCondition, { readonly type: "stat-comparison" }>["stat"],
) => {
  if (stat === "power") return combatant.stats.power;
  if (stat === "dexterity") return combatant.stats.dexterity;
  if (stat === "dexterity-bonus") return combatant.stats.dexterityBonus;
  if (stat === "max-hp") return combatant.hitPoints.maximum;
  return combatant.specializationPoints;
};

const statComparisonRightValue = (
  condition: Extract<RuntimeCondition, { readonly type: "stat-comparison" }>,
  context: MoveEffectRuntimeContext,
) => {
  if (condition.right === undefined)
    return condition.value === undefined ? undefined : numeric(condition.value, context);
  const rightCombatant = condition.right === "self" ? context.self : context.opponent;
  const rightValue = combatantStatValue(rightCombatant, condition.rightStat ?? condition.stat);
  if (rightValue === undefined) return undefined;
  let multiplier: number | undefined = 1;
  if (condition.rightMultiplier !== undefined)
    multiplier = optionalNumeric(condition.rightMultiplier, context);
  let difference: number | undefined = 0;
  if (condition.difference !== undefined)
    difference = optionalNumeric(condition.difference, context);
  if (multiplier === undefined || difference === undefined) return undefined;
  return rightValue * multiplier + difference;
};

const statComparisonSatisfied = (
  left: number,
  comparison: Extract<RuntimeCondition, { readonly type: "stat-comparison" }>["comparison"],
  right: number,
) => {
  if (comparison === "at-least") return left >= right;
  if (comparison === "at-most") return left <= right;
  if (comparison === "higher-than") return left > right;
  if (comparison === "lower-than") return left < right;
  return left === right;
};

const statComparisonMatches = (
  condition: Extract<RuntimeCondition, { readonly type: "stat-comparison" }>,
  context: MoveEffectRuntimeContext,
) => {
  const leftCombatant = condition.left === "self" ? context.self : context.opponent;
  const left = combatantStatValue(leftCombatant, condition.stat);
  if (left === undefined) return false;
  const right = statComparisonRightValue(condition, context);
  if (right === undefined) return false;
  return statComparisonSatisfied(left, condition.comparison, right);
};

const rollModificationMatches = (
  condition: Extract<RuntimeCondition, { readonly type: "roll-modification" }>,
  context: MoveEffectRuntimeContext,
) => {
  const event = context.rollModification;
  return (
    event !== undefined &&
    event.actor === condition.actor &&
    event.roll === condition.roll &&
    event.excludeSource === condition.excludeSource &&
    condition.modifiers.every((modifier) => event.modifiers.includes(modifier))
  );
};

const storedRollMatchMatches = (
  condition: Extract<RuntimeCondition, { readonly type: "stored-roll-match" }>,
  context: MoveEffectRuntimeContext,
) => {
  const storedRoll = context.self.storedRolls?.[condition.storageKey];
  if (storedRoll === undefined || storedRoll.naturalResults.length !== 1) return false;
  return (context.rolls ?? []).some((roll) => {
    const result = rollValue(roll, condition.roll, condition.natural);
    return result !== undefined && result === storedRoll.naturalResults[0];
  });
};

const paidKiCostMatches = (
  condition: Extract<RuntimeCondition, { readonly type: "paid-ki-cost" }>,
  context: MoveEffectRuntimeContext,
) => {
  const value = numeric(condition.value, context);
  return (
    value !== undefined &&
    context.paidKiCost !== undefined &&
    compare(context.paidKiCost, condition.comparison, value)
  );
};

const resourceThresholdMatches = (
  condition: Extract<RuntimeCondition, { readonly type: "resource-threshold" }>,
  context: MoveEffectRuntimeContext,
) => {
  const value = numeric(condition.value, context);
  if (value === undefined) return false;
  const combatant = condition.subject === "self" ? context.self : context.opponent;
  const resource = condition.resource === "hp" ? combatant.hitPoints : combatant.ki;
  const actual = condition.basis === "current" ? resource.current : resource.maximum;
  if (condition.comparison === "at-least") return actual >= value;
  if (condition.comparison === "lower-than") return actual < value;
  return actual <= value;
};

const resourceComparisonMatches = (
  condition: Extract<RuntimeCondition, { readonly type: "resource-comparison" }>,
  context: MoveEffectRuntimeContext,
) => {
  const leftCombatant = condition.left === "self" ? context.self : context.opponent;
  const rightCombatant = condition.right === "self" ? context.self : context.opponent;
  const leftResource = condition.resource === "hp" ? leftCombatant.hitPoints : leftCombatant.ki;
  const rightResource = condition.resource === "hp" ? rightCombatant.hitPoints : rightCombatant.ki;
  const left = condition.basis === "current" ? leftResource.current : leftResource.maximum;
  const right = condition.basis === "current" ? rightResource.current : rightResource.maximum;
  if (condition.comparison === "higher-than") return left > right;
  if (condition.comparison === "lower-than") return left < right;
  return left === right;
};

const moveSelectorMatches = (
  condition: Extract<RuntimeCondition, { readonly type: "move-selector" }>,
  context: MoveEffectRuntimeContext,
) => {
  const move = context.triggeringMove;
  if (move === undefined) return false;
  if (condition.category !== undefined && move.category !== condition.category) return false;
  if (condition.styleId !== undefined && move.styleId !== condition.styleId) return false;
  if (
    condition.tags !== undefined &&
    !condition.tags.every((tag) => move.tags.includes(tag as (typeof move.tags)[number]))
  )
    return false;
  if (condition.attackRoll === undefined) return true;
  const attackRoll = move.mechanics.attack?.attackRoll ?? { dice: 1, sides: 30 };
  return (
    (condition.attackRoll.dice === undefined || attackRoll.dice === condition.attackRoll.dice) &&
    (condition.attackRoll.minimumDice === undefined ||
      attackRoll.dice >= condition.attackRoll.minimumDice) &&
    (condition.attackRoll.sides === undefined || attackRoll.sides === condition.attackRoll.sides) &&
    (condition.attackRoll.maximumSides === undefined ||
      attackRoll.sides <= condition.attackRoll.maximumSides)
  );
};

const stoppedHitFractionMatches = (
  condition: Extract<RuntimeCondition, { readonly type: "stopped-hit-fraction" }>,
  context: MoveEffectRuntimeContext,
) => {
  if (condition.comparison !== "more-than-half") return false;
  const rolls = context.rolls;
  if (rolls === undefined || rolls.length === 0) return false;
  const stoppedCount = rolls.filter((roll) => roll.outcome === "stopped").length;
  return stoppedCount * 2 > rolls.length;
};

const currentAttackAction = (context: MoveEffectRuntimeContext) =>
  context.currentAction ??
  [...(context.actionHistory ?? [])]
    .reverse()
    .find(
      (
        action,
      ): action is Extract<CombatActionRecord, { readonly type: "basic-attack" | "use-move" }> =>
        action.type === "basic-attack" || action.type === "use-move",
    );

const combatResultMatches = (
  condition: Extract<RuntimeCondition, { readonly type: "combat-result" }>,
  context: MoveEffectRuntimeContext,
) => {
  if (context.combatOutcome !== undefined)
    return (
      context.combatOutcomeActor === condition.actor &&
      condition.result === (context.combatOutcome === "stun" ? "stopped" : "successful")
    );
  const actorId = actionActorId(condition.actor, context);
  const action = currentAttackAction(context);
  if (action !== undefined && action.actorId === actorId)
    return actionResultMatches(action, condition.result);
  if (
    action !== undefined &&
    condition.actor === "opponent" &&
    action.targetCombatantId === context.opponent.id
  )
    return actionResultMatches(action, condition.result);
  return condition.actor === "self" && condition.result === combatResultFor(context);
};

const defenseResponseMatches = (
  condition: Extract<RuntimeCondition, { readonly type: "defense-response" }>,
  context: MoveEffectRuntimeContext,
) => {
  const response = context.defenseResponse;
  return (
    response !== undefined &&
    response.blockUsed === condition.blockUsed &&
    (condition.resultModified === undefined ||
      response.resultModified === condition.resultModified) &&
    (condition.rerolled === undefined || response.rerolled === condition.rerolled)
  );
};

const combatResultFor = (context: MoveEffectRuntimeContext) =>
  context.successfulHitCount > 0 ? "successful" : "stopped";

const combatOutcomeMatches = (
  condition: Extract<RuntimeCondition, { readonly type: "combat-outcome" }>,
  context: MoveEffectRuntimeContext,
) => {
  if (context.combatOutcome !== undefined)
    return (
      context.combatOutcomeActor === condition.actor && context.combatOutcome === condition.outcome
    );

  const combatant = condition.actor === "self" ? context.self : context.opponent;
  return combatant.activeStatuses.some((status) => status.statusId === condition.outcome);
};

const incomingDamageMatches = (
  condition: Extract<RuntimeCondition, { readonly type: "incoming-damage" }>,
  context: MoveEffectRuntimeContext,
) => {
  const value = numeric(condition.value, context);
  const actual = context.incomingDamage;
  return (
    value !== undefined && actual !== undefined && compare(actual, condition.comparison, value)
  );
};

const numericComparison = (
  expression: Parameters<typeof evaluateDurableNumericExpression>[0],
  actual: number,
  comparison: "at-least" | "at-most" | "exactly",
  context: MoveEffectRuntimeContext,
) => {
  const value = numeric(expression, context);
  return value !== undefined && compare(actual, comparison, value);
};

const conditionCombatStateMatches = (
  condition: Extract<RuntimeCondition, { readonly type: "combat-state" }>,
  context: MoveEffectRuntimeContext,
) => {
  const combatant = condition.subject === "self" ? context.self : context.opponent;
  return condition.state !== "transformed" || combatant.transformation !== undefined;
};

const conditionStatusMatches = (
  condition: Extract<RuntimeCondition, { readonly type: "status" }>,
  context: MoveEffectRuntimeContext,
) => {
  const combatant = condition.subject === "self" ? context.self : context.opponent;
  return (
    condition.state === "active" &&
    combatant.activeStatuses.some((status) => status.statusId === condition.statusId)
  );
};

const activeMoveEffectMatches = (
  condition: Extract<
    RuntimeCondition,
    { readonly type: "move-effect-active" | "move-effect-inactive" }
  >,
  context: MoveEffectRuntimeContext,
) => {
  const subject = condition.subject === "self" ? context.self : context.opponent;
  const active = (context.activeEffects ?? []).some((effect) => {
    if (
      effect.sourceCombatantId !== subject.id ||
      (effect.type === "active-constant" && effect.lifecycle === "deactivated")
    )
      return false;
    const sourceMove = context.moves.get(effect.sourceDefinitionId);
    return sourceMove !== undefined && matchesMoveSelector(sourceMove, condition.selector);
  });
  return condition.type === "move-effect-active" ? active : !active;
};

const targetRelationMatches = (
  condition: Extract<RuntimeCondition, { readonly type: "target-relation" }>,
  context: MoveEffectRuntimeContext,
) =>
  condition.subject === "source" &&
  context.currentAction !== undefined &&
  context.floatingEffectTargetCombatantId !== undefined &&
  context.currentAction.targetCombatantId === context.floatingEffectTargetCombatantId;

const activeMoveCountForSubject = (
  subject: CombatantState,
  selector: MoveSelectorCondition,
  context: MoveEffectRuntimeContext,
) => {
  const seen = new Set<string>();
  for (const effect of context.activeEffects ?? []) {
    if (
      effect.type !== "active-constant" ||
      effect.sourceCombatantId !== subject.id ||
      effect.lifecycle === "deactivated"
    )
      continue;
    const sourceMove = context.moves.get(effect.sourceDefinitionId);
    if (sourceMove === undefined || !matchesMoveSelector(sourceMove, selector)) continue;
    seen.add(`${subject.id}:${effect.sourceDefinitionId}`);
  }
  return seen.size;
};

const activeMoveCount = (
  condition: Extract<RuntimeCondition, { readonly type: "active-move-count" }>,
  context: MoveEffectRuntimeContext,
) => {
  const subjects =
    condition.subject === "either"
      ? [context.self, context.opponent]
      : [condition.subject === "self" ? context.self : context.opponent];
  return subjects.reduce(
    (total, subject) => total + activeMoveCountForSubject(subject, condition.selector, context),
    0,
  );
};

const activeMoveCountMatches = (
  condition: Extract<RuntimeCondition, { readonly type: "active-move-count" }>,
  context: MoveEffectRuntimeContext,
) => {
  const value = numeric(condition.value, context);
  return (
    value !== undefined && compare(activeMoveCount(condition, context), condition.comparison, value)
  );
};

const movesetMoveCountMatches = (
  condition: Extract<RuntimeCondition, { readonly type: "moveset-move-count" }>,
  context: MoveEffectRuntimeContext,
) => {
  const subject = condition.subject === "self" ? context.self : context.opponent;
  const count = subject.moveIds.reduce((total, moveId) => {
    const move = context.moves.get(moveId);
    if (
      move === undefined ||
      (condition.category !== undefined && move.category !== condition.category) ||
      (condition.tags !== undefined &&
        !condition.tags.every((tag) => move.tags.includes(tag as never)))
    )
      return total;
    return total + 1;
  }, 0);
  const value = numeric(condition.value, context);
  return value !== undefined && compare(count, condition.comparison, value);
};

const moveUseCountMatches = (
  condition: Extract<RuntimeCondition, { readonly type: "move-use-count" }>,
  context: MoveEffectRuntimeContext,
) => {
  const actions = [
    ...(context.actionHistory ?? []),
    ...(context.currentAction === undefined ? [] : [context.currentAction]),
  ];
  const count = actions.filter(
    (action) =>
      action.actorId === context.self.id &&
      actionMoveMatchesSelector(action as AttackActionRecord, condition.selector, context),
  ).length;
  return count === condition.value;
};

const movesetMatches = (
  condition: Extract<RuntimeCondition, { readonly type: "moveset" }>,
  context: MoveEffectRuntimeContext,
) => {
  const subject = condition.subject === "self" ? context.self : context.opponent;
  return condition.excludesIds.every((moveId) => !subject.moveIds.includes(moveId));
};

const conditionPerfectRollMatches = (
  condition: Extract<RuntimeCondition, { readonly type: "perfect-roll" }>,
  context: MoveEffectRuntimeContext,
) => {
  const hasPerfectRoll = (context.rolls ?? []).some((roll) => roll.attackNaturalResult === 30);
  return condition.negated === true ? !hasPerfectRoll : hasPerfectRoll;
};

const conditionRollDieResultMatches = (
  condition: Extract<RuntimeCondition, { readonly type: "roll-die-result" }>,
  context: MoveEffectRuntimeContext,
) => {
  const roll = context.rolls?.[condition.index - 1];
  if (roll === undefined) return false;
  const result = rollValue(roll, condition.roll, false);
  return result !== undefined && (condition.result === "successful" ? result >= 16 : result < 16);
};

const conditionRollDieThresholdMatches = (
  condition: Extract<RuntimeCondition, { readonly type: "roll-die-threshold" }>,
  context: MoveEffectRuntimeContext,
) => {
  const roll = context.rolls?.[condition.index - 1];
  if (roll === undefined) return false;
  return numericComparison(
    condition.value,
    rollValue(roll, condition.roll, false) ?? Number.NaN,
    condition.comparison,
    context,
  );
};

const storedRollThresholdMatches = (
  condition: Extract<RuntimeCondition, { readonly type: "stored-roll-threshold" }>,
  context: MoveEffectRuntimeContext,
) => {
  const storedRoll = context.self.storedRolls?.[condition.storageKey];
  if (storedRoll === undefined || storedRoll.naturalResults.length !== 1) return false;
  return numericComparison(
    condition.value,
    storedRoll.naturalResults[0],
    condition.comparison,
    context,
  );
};

const storedMoveSelectionMatches = (
  condition: Extract<RuntimeCondition, { readonly type: "stored-move-selection" }>,
  context: MoveEffectRuntimeContext,
) => {
  const selection = context.self.storedMoveSelections?.[condition.selectionKey];
  if (selection === undefined) return false;
  const selectedActionMoveId =
    context.currentAction?.type === "use-move"
      ? context.currentAction.moveId
      : context.triggeringMove?.id;
  return selectedActionMoveId === selection.moveId;
};

const actionActorId = (actor: "self" | "opponent", context: MoveEffectRuntimeContext) =>
  actor === "self" ? context.self.id : context.opponent.id;

const actionResultMatches = (
  action: Extract<CombatActionRecord, { readonly type: "basic-attack" | "use-move" }>,
  result: "successful" | "stopped" | "critical" | "counter",
) => {
  if (result === "critical") return action.critical === true;
  if (result === "counter") return action.counter === true;
  return action.outcome === result;
};

const actionMoveMatchesSelector = (
  action: Extract<CombatActionRecord, { readonly type: "basic-attack" | "use-move" }>,
  selector: MoveSelectorCondition,
  context: MoveEffectRuntimeContext,
) => {
  if (action.type !== "use-move") return false;
  const move = context.moves.get(action.moveId);
  return move !== undefined && matchesMoveSelector(move, selector);
};

const priorActionMatches = (
  condition: Extract<RuntimeCondition, { readonly type: "prior-action" | "no-prior-action" }>,
  context: MoveEffectRuntimeContext,
) => {
  const actorId = actionActorId(condition.actor, context);
  const action = [...(context.actionHistory ?? [])]
    .reverse()
    .find((candidate) => candidate.actorId === actorId);
  if (action === undefined) return false;
  if (condition.type === "prior-action" && condition.action === "power-up")
    return action.type === "power-up";
  if (action.type !== "basic-attack" && action.type !== "use-move") return false;
  if (condition.type === "prior-action" && condition.result !== undefined) {
    if (!actionResultMatches(action, condition.result)) return false;
  }
  if (condition.selector !== undefined) {
    return actionMoveMatchesSelector(action, condition.selector, context);
  }
  return true;
};

type AttackActionRecord = Extract<
  CombatActionRecord,
  { readonly type: "basic-attack" | "use-move" }
>;

const actionSequenceMatches = (
  condition: Extract<RuntimeCondition, { readonly type: "action-sequence" }>,
  context: MoveEffectRuntimeContext,
) => {
  const actions = [
    ...(context.actionHistory ?? []),
    ...(context.currentAction === undefined ? [] : [context.currentAction]),
  ];
  const actorId = actionActorId(condition.actor, context);
  const attacks = actions.flatMap((action, index) =>
    action.actorId === actorId && (action.type === "basic-attack" || action.type === "use-move")
      ? [{ action, index }]
      : [],
  );
  const matching: { readonly action: AttackActionRecord; readonly index: number }[] = [];
  for (const entry of [...attacks].reverse()) {
    if (!actionResultMatches(entry.action, condition.result)) break;
    if (
      condition.selector !== undefined &&
      !actionMoveMatchesSelector(entry.action, condition.selector, context)
    )
      break;
    matching.push(entry);
  }
  if (matching.length < condition.count) return false;

  const selected = matching.slice(0, condition.count);
  if (
    condition.differentTurns === true &&
    new Set(selected.map(({ action }) => action.turnNumber)).size !== condition.count
  )
    return false;

  if (condition.withoutResultBy === undefined) return true;
  const earliestSelectedIndex = selected.at(-1)?.index;
  if (earliestSelectedIndex === undefined) return false;
  const excludedActorId = actionActorId(condition.withoutResultBy.actor, context);
  return !actions.some(
    (action, index) =>
      index > earliestSelectedIndex &&
      action.actorId === excludedActorId &&
      (action.type === "basic-attack" || action.type === "use-move") &&
      actionResultMatches(action, condition.withoutResultBy!.result),
  );
};

const resourceChangeMatches = (
  condition: Extract<RuntimeCondition, { readonly type: "resource-change" }>,
  context: MoveEffectRuntimeContext,
) => {
  const event = context.resourceChange;
  return (
    condition.timing === "current-event" &&
    event !== undefined &&
    condition.subject === event.subject &&
    condition.resource === event.resource &&
    condition.operation === event.operation &&
    (condition.cause === undefined || condition.cause === event.cause) &&
    (condition.sourceStyleId === undefined || condition.sourceStyleId === event.sourceStyleId)
  );
};

const levelComparisonMatches = (
  condition: Extract<RuntimeCondition, { readonly type: "level-comparison" }>,
  context: MoveEffectRuntimeContext,
) => {
  const left = condition.left === "self" ? context.self.level : context.opponent.level;
  const right = condition.right === "self" ? context.self.level : context.opponent.level;
  if (left === undefined || right === undefined) return false;
  const difference =
    condition.difference === undefined ? 0 : numeric(condition.difference, context);
  if (difference === undefined) return false;
  const target = right + difference;
  if (condition.comparison === "higher-than") return left > target;
  if (condition.comparison === "lower-than") return left < target;
  if (condition.comparison === "at-least") return left >= target;
  return left === target;
};

const locationMatches = (
  condition: Extract<RuntimeCondition, { readonly type: "location" }>,
  context: MoveEffectRuntimeContext,
) => {
  const combatant = condition.subject === "self" ? context.self : context.opponent;
  return condition.state === "planet-has-dragon-balls" && combatant.planetHasDragonBalls === true;
};

const transformationMasteryMatches = (
  _condition: Extract<RuntimeCondition, { readonly type: "transformation-mastery" }>,
  context: MoveEffectRuntimeContext,
) =>
  context.self.transformation !== undefined &&
  context.self.masteredTransformationIds?.includes(context.self.transformation.transformationId) ===
    true;

const priorTurnRestrictionMatches = (
  condition: Extract<RuntimeCondition, { readonly type: "prior-turn-restriction" }>,
  context: MoveEffectRuntimeContext,
) => {
  const actorId = condition.subject === "self" ? context.self.id : context.opponent.id;
  const priorTurn = [...(context.actionHistory ?? [])]
    .reverse()
    .find(
      (action) => action.actorId === actorId && action.turnNumber < context.turnNumber,
    )?.turnNumber;
  if (priorTurn === undefined) return false;
  return (context.actionHistory ?? []).some(
    (action) =>
      action.actorId === actorId &&
      action.turnNumber === priorTurn &&
      ((condition.anyOf.includes("attack-use") &&
        (action.type === "basic-attack" || action.type === "use-move")) ||
        (condition.anyOf.includes("power-up") && action.type === "power-up") ||
        (condition.anyOf.includes("turn-skipped") && action.type === "turn-skipped")),
  );
};

const moveModificationMatches = (
  condition: Extract<RuntimeCondition, { readonly type: "move-modification" }>,
  context: MoveEffectRuntimeContext,
) => {
  const currentMove =
    context.triggeringMove ??
    (context.currentAction?.type === "use-move"
      ? context.moves.get(context.currentAction.moveId)
      : undefined);
  if (currentMove === undefined) return false;
  if (
    currentMove.styleId === condition.sourceStyleId &&
    currentMove.effects?.some(
      (effect) => effect.type === "modify-cost" && effect.trigger !== "on-cost-modified",
    ) === true
  )
    return true;
  return [...(context.activeEffects ?? [])].some((activeEffect) => {
    if (activeEffect.type !== "active-constant" || activeEffect.lifecycle === "deactivated") {
      return false;
    }
    const sourceMove = context.moves.get(activeEffect.sourceDefinitionId);
    return (
      sourceMove?.styleId === condition.sourceStyleId &&
      sourceMove.effects?.some(
        (effect) =>
          (condition.aspect === "damage" && effect.type === "modify-damage") ||
          (condition.aspect === "cost" &&
            effect.type === "modify-cost" &&
            effect.trigger !== "on-cost-modified"),
      ) === true
    );
  });
};

type RuntimeConditionHandler = (
  condition: RuntimeCondition,
  context: MoveEffectRuntimeContext,
) => boolean;
type RuntimeConditionType = RuntimeCondition["type"];

const rollThresholdHandler: RuntimeConditionHandler = (condition, context) =>
  rollThresholdMatches(condition as RollThresholdRuntimeCondition, context);
const successfulHitCountHandler: RuntimeConditionHandler = (condition, context) => {
  const typed = condition as SuccessfulHitCountRuntimeCondition;
  return numericComparison(typed.value, context.successfulHitCount, typed.comparison, context);
};
const combatResultHandler: RuntimeConditionHandler = (condition, context) =>
  combatResultMatches(condition as CombatResultRuntimeCondition, context);
const combatOutcomeHandler: RuntimeConditionHandler = (condition, context) =>
  combatOutcomeMatches(
    condition as Extract<RuntimeCondition, { readonly type: "combat-outcome" }>,
    context,
  );
const combatTurnHandler: RuntimeConditionHandler = (condition, context) => {
  const typed = condition as Extract<RuntimeCondition, { readonly type: "combat-turn" }>;
  return typed.comparison === "exactly" && context.turnNumber === typed.value;
};

const runtimeConditionHandlers: Partial<Record<RuntimeConditionType, RuntimeConditionHandler>> = {
  "combat-result": combatResultHandler,
  "defense-response": (condition, context) =>
    defenseResponseMatches(
      condition as Extract<RuntimeCondition, { readonly type: "defense-response" }>,
      context,
    ),
  "combat-outcome": combatOutcomeHandler,
  "combat-turn": combatTurnHandler,
  "successful-hit-count": successfulHitCountHandler,
  "stopped-hit-fraction": (condition, context) =>
    stoppedHitFractionMatches(
      condition as Extract<RuntimeCondition, { readonly type: "stopped-hit-fraction" }>,
      context,
    ),
  "roll-threshold": rollThresholdHandler,
  "roll-comparison": (condition, context) =>
    rollComparisonMatches(condition as RollComparisonRuntimeCondition, context),
  "paid-ki-cost": (condition, context) =>
    paidKiCostMatches(
      condition as Extract<RuntimeCondition, { readonly type: "paid-ki-cost" }>,
      context,
    ),
  "stat-comparison": (condition, context) =>
    statComparisonMatches(
      condition as Extract<RuntimeCondition, { readonly type: "stat-comparison" }>,
      context,
    ),
  "roll-modification": (condition, context) =>
    rollModificationMatches(
      condition as Extract<RuntimeCondition, { readonly type: "roll-modification" }>,
      context,
    ),
  "resource-threshold": (condition, context) =>
    resourceThresholdMatches(
      condition as Extract<RuntimeCondition, { readonly type: "resource-threshold" }>,
      context,
    ),
  "resource-comparison": (condition, context) =>
    resourceComparisonMatches(
      condition as Extract<RuntimeCondition, { readonly type: "resource-comparison" }>,
      context,
    ),
  "move-selector": (condition, context) =>
    moveSelectorMatches(
      condition as Extract<RuntimeCondition, { readonly type: "move-selector" }>,
      context,
    ),
  "combat-context": (condition, context) =>
    context.mode ===
    (condition as Extract<RuntimeCondition, { readonly type: "combat-context" }>).mode,
  "combat-state": (condition, context) =>
    conditionCombatStateMatches(
      condition as Extract<RuntimeCondition, { readonly type: "combat-state" }>,
      context,
    ),
  status: (condition, context) =>
    conditionStatusMatches(
      condition as Extract<RuntimeCondition, { readonly type: "status" }>,
      context,
    ),
  "move-effect-active": (condition, context) =>
    activeMoveEffectMatches(
      condition as Extract<RuntimeCondition, { readonly type: "move-effect-active" }>,
      context,
    ),
  "move-effect-inactive": (condition, context) =>
    activeMoveEffectMatches(
      condition as Extract<RuntimeCondition, { readonly type: "move-effect-inactive" }>,
      context,
    ),
  "target-relation": (condition, context) =>
    targetRelationMatches(
      condition as Extract<RuntimeCondition, { readonly type: "target-relation" }>,
      context,
    ),
  "active-move-count": (condition, context) =>
    activeMoveCountMatches(
      condition as Extract<RuntimeCondition, { readonly type: "active-move-count" }>,
      context,
    ),
  "moveset-move-count": (condition, context) =>
    movesetMoveCountMatches(
      condition as Extract<RuntimeCondition, { readonly type: "moveset-move-count" }>,
      context,
    ),
  "move-use-count": (condition, context) =>
    moveUseCountMatches(
      condition as Extract<RuntimeCondition, { readonly type: "move-use-count" }>,
      context,
    ),
  moveset: (condition, context) =>
    movesetMatches(condition as Extract<RuntimeCondition, { readonly type: "moveset" }>, context),
  "perfect-roll": (condition, context) =>
    conditionPerfectRollMatches(
      condition as Extract<RuntimeCondition, { readonly type: "perfect-roll" }>,
      context,
    ),
  "roll-die-result": (condition, context) =>
    conditionRollDieResultMatches(
      condition as Extract<RuntimeCondition, { readonly type: "roll-die-result" }>,
      context,
    ),
  "roll-die-threshold": (condition, context) =>
    conditionRollDieThresholdMatches(
      condition as Extract<RuntimeCondition, { readonly type: "roll-die-threshold" }>,
      context,
    ),
  "prior-action": (condition, context) =>
    priorActionMatches(
      condition as Extract<RuntimeCondition, { readonly type: "prior-action" }>,
      context,
    ),
  "no-prior-action": (condition, context) =>
    !priorActionMatches(
      condition as Extract<RuntimeCondition, { readonly type: "no-prior-action" }>,
      context,
    ),
  "action-sequence": (condition, context) =>
    actionSequenceMatches(
      condition as Extract<RuntimeCondition, { readonly type: "action-sequence" }>,
      context,
    ),
  "incoming-damage": (condition, context) =>
    incomingDamageMatches(
      condition as Extract<RuntimeCondition, { readonly type: "incoming-damage" }>,
      context,
    ),
  "resource-change": (condition, context) =>
    resourceChangeMatches(
      condition as Extract<RuntimeCondition, { readonly type: "resource-change" }>,
      context,
    ),
  "level-comparison": (condition, context) =>
    levelComparisonMatches(
      condition as Extract<RuntimeCondition, { readonly type: "level-comparison" }>,
      context,
    ),
  location: (condition, context) =>
    locationMatches(condition as Extract<RuntimeCondition, { readonly type: "location" }>, context),
  "transformation-mastery": (condition, context) =>
    transformationMasteryMatches(
      condition as Extract<RuntimeCondition, { readonly type: "transformation-mastery" }>,
      context,
    ),
  "prior-turn-restriction": (condition, context) =>
    priorTurnRestrictionMatches(
      condition as Extract<RuntimeCondition, { readonly type: "prior-turn-restriction" }>,
      context,
    ),
  "move-modification": (condition, context) =>
    moveModificationMatches(
      condition as Extract<RuntimeCondition, { readonly type: "move-modification" }>,
      context,
    ),
  "stored-roll-threshold": (condition, context) =>
    storedRollThresholdMatches(
      condition as Extract<RuntimeCondition, { readonly type: "stored-roll-threshold" }>,
      context,
    ),
  "stored-roll-match": (condition, context) =>
    storedRollMatchMatches(
      condition as Extract<RuntimeCondition, { readonly type: "stored-roll-match" }>,
      context,
    ),
  "stored-move-selection": (condition, context) =>
    storedMoveSelectionMatches(
      condition as Extract<RuntimeCondition, { readonly type: "stored-move-selection" }>,
      context,
    ),
};

const conditionMatches = (condition: RuntimeCondition, context: MoveEffectRuntimeContext) =>
  runtimeConditionHandlers[condition.type]?.(condition, context) ?? false;

const requirementsMatch = (effect: EffectDefinition, context: MoveEffectRuntimeContext) =>
  (effect.requirements ?? []).every(
    (requirement) =>
      requirement.type === "moveset-excludes" &&
      requirement.moveIds.every((moveId) => !context.self.moveIds.includes(moveId)),
  );

const turnLimitedEffectAlreadyUsed = (
  effect: EffectDefinition,
  context: MoveEffectRuntimeContext,
) => {
  if (effect.useLimit?.scope !== "turn") return false;
  const currentAction = context.currentAction;
  if (currentAction?.type !== "use-move") return false;
  return (context.actionHistory ?? []).some(
    (action) =>
      action.type === "use-move" &&
      action.actorId === context.self.id &&
      action.turnNumber === context.turnNumber &&
      action.moveId === currentAction.moveId,
  );
};

const turnLimitedResourceEventMatches = (
  effect: EffectDefinition,
  context: MoveEffectRuntimeContext,
) => {
  if (
    effect.type !== "modify-resource" ||
    (effect.trigger !== "on-resource-gain" && effect.trigger !== "on-resource-drain") ||
    effect.duration === undefined
  )
    return true;
  if (effect.duration.type !== "turns") return false;
  const duration = numeric(effect.duration.turns, context);
  if (duration === undefined || duration < 1) return false;
  const activation = [...(context.actionHistory ?? [])]
    .reverse()
    .find(
      (action) =>
        action.type === "use-move" &&
        action.actorId === context.self.id &&
        action.moveId === context.sourceDefinitionId &&
        action.outcome === "successful",
    );
  if (activation === undefined) return false;
  const turnsSinceActivation = context.turnNumber - activation.turnNumber;
  return turnsSinceActivation >= 1 && turnsSinceActivation <= duration;
};

const rollModifiedScopeMatches = (effect: EffectDefinition, context: MoveEffectRuntimeContext) => {
  if (effect.trigger !== "on-roll-modified" || effect.scope === undefined) return true;
  if (
    effect.scope.type !== "next-turn" ||
    effect.scope.subject !== "self" ||
    context.currentAction?.actorId !== context.self.id ||
    context.sourceDefinitionId === undefined
  )
    return false;
  const activation = [...(context.actionHistory ?? [])]
    .reverse()
    .find(
      (action) =>
        action.type === "use-move" &&
        action.actorId === context.self.id &&
        action.moveId === context.sourceDefinitionId &&
        action.outcome === "successful",
    );
  if (activation === undefined) return false;
  // turnNumber advances at every participant boundary, so an owner's next
  // turn is two combat turns after the owner's triggering action.
  return context.turnNumber - activation.turnNumber === 2;
};

export const effectConditionsMatch = (
  conditions: EffectDefinition["conditions"],
  context: MoveEffectRuntimeContext,
) => (conditions ?? []).every((condition) => conditionMatches(condition, context));

const effectConditionsMatchForEvaluation = (
  effect: EffectDefinition,
  context: MoveEffectRuntimeContext,
) => {
  if (effect.type === "deactivate") {
    return (effect.conditions ?? [])
      .filter((condition) => condition.type !== "move-selector")
      .every((condition) => conditionMatches(condition, context));
  }
  if (
    effect.type === "reroll" &&
    effect.trigger === "on-success" &&
    (effect.scope?.type === "next-action" ||
      effect.scope?.type === "next-roll" ||
      effect.scope?.type === "next-rolls")
  ) {
    return (effect.conditions ?? [])
      .filter((condition) => condition.type !== "roll-threshold")
      .every((condition) => conditionMatches(condition, context));
  }
  if (
    effect.type === "set-combat-result" &&
    effect.scope?.type === "next-action" &&
    effect.resultScope === "matching-die"
  ) {
    return (effect.conditions ?? [])
      .filter(
        (condition) => condition.type !== "move-selector" && condition.type !== "combat-result",
      )
      .every((condition) => conditionMatches(condition, context));
  }
  return effectConditionsMatch(effect.conditions, context);
};

const effectMatches = (effect: EffectDefinition, context: MoveEffectRuntimeContext) =>
  requirementsMatch(effect, context) &&
  !turnLimitedEffectAlreadyUsed(effect, context) &&
  turnLimitedResourceEventMatches(effect, context) &&
  rollModifiedScopeMatches(effect, context) &&
  effectConditionsMatchForEvaluation(effect, context);

const numeric = (
  expression: Parameters<typeof evaluateDurableNumericExpression>[0],
  context: MoveEffectRuntimeContext,
  sourceMoveId?: string,
) =>
  evaluateDurableNumericExpression(expression, {
    self: context.self,
    opponent: context.opponent,
    turnNumber: context.turnNumber,
    participantCount: 2,
    completedTurnCount: context.completedTurnCount,
    successfulHitCount: context.successfulHitCount,
    actionHistory: context.actionHistory,
    currentAction: context.currentAction,
    activeEffects: context.activeEffects,
    moves: context.moves,
    moveActivationCounts: context.moveActivationCounts,
    paidActivationCost: context.paidActivationCost,
    rolls: context.rolls,
    triggeringMove: context.triggeringMove,
    triggeringMoveOwner: context.triggeringMoveOwner,
    currentDamage: context.currentDamage,
    blockedAttackDamage: context.blockedAttackDamage,
    selectedNumericValues: context.selectedNumericValues,
    sourceMoveId,
  });

const optionalNumeric = (
  expression: NumericExpression | undefined,
  context: MoveEffectRuntimeContext,
) => (expression === undefined ? undefined : numeric(expression, context));

const resolvedUseLimitCount = (
  useLimit: { readonly count: number | NumericExpression } | undefined,
  context: MoveEffectRuntimeContext,
) => {
  if (useLimit === undefined) return undefined;
  if (typeof useLimit.count === "number") return useLimit.count;
  return numeric(useLimit.count, context);
};

const damageAmount = (
  expression: NonNullable<Extract<EffectDefinition, { readonly type: "modify-damage" }>["percent"]>,
  value: number,
  context: MoveEffectRuntimeContext,
) => {
  if (expression.type === "damage-percent" || expression.type === "stat-percent") return value;
  return Math.round((context.self.stats.power * value) / 100);
};

const damageBasis = (
  expression: NonNullable<Extract<EffectDefinition, { readonly type: "modify-damage" }>["percent"]>,
) =>
  expression.type === "damage-percent" ? ("damage-percent" as const) : ("power-percent" as const);

const damageDuration = (
  duration: Extract<EffectDefinition, { readonly type: "modify-damage" }>["duration"],
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
) => {
  if (duration === undefined) return undefined;
  if (duration.type === "combat") return { type: "combat" as const };
  const targetCombatantId = target === "self" ? context.self.id : context.opponent.id;
  if (duration.type === "turns") {
    const remaining = numeric(duration.turns, context);
    return remaining === undefined || remaining < 1
      ? undefined
      : { type: "turns" as const, ownerCombatantId: targetCombatantId, remaining };
  }
  if (duration.type !== "until-roll-threshold" || duration.roll !== "attack") return undefined;
  const value = numeric(duration.value, context);
  return value === undefined
    ? undefined
    : {
        type: "until-roll-threshold" as const,
        combatantId: targetCombatantId,
        roll: "attack" as const,
        comparison: duration.comparison,
        value,
      };
};

export const adjustedMoveDamage = (
  move: MoveDefinition,
  baseDamage: number,
  context: MoveEffectRuntimeContext,
) =>
  (move.effects ?? []).reduce((damage, effect) => {
    if (
      effect.type !== "modify-damage" ||
      effect.trigger !== "passive" ||
      !effectMatches(effect, context)
    )
      return damage;
    const value = effect.percent === undefined ? 0 : numeric(effect.percent, context);
    if (value === undefined) return damage;
    if (
      effect.selector !== undefined &&
      (context.triggeringMove === undefined ||
        !matchesMoveSelector(context.triggeringMove, effect.selector))
    )
      return damage;
    if (effect.cap !== undefined && effect.percent === undefined) {
      const cap = numeric(effect.cap.value, context);
      if (cap === undefined) return damage;
      return effect.cap.type === "maximum" ? Math.min(damage, cap) : Math.max(damage, cap);
    }
    if (effect.operation === "set") return damageAmount(effect.percent!, value, context);
    if (effect.operation === "multiply") return Math.round((damage * value) / 100);
    return damage + damageAmount(effect.percent!, value, context);
  }, baseDamage);

const supportedDamageScope = (scope: string | undefined) =>
  scope === undefined ||
  scope === "current-action" ||
  scope === "following-action" ||
  scope === "next-action" ||
  scope === "next-actions" ||
  scope === "next-turn";

const damageModificationRemaining = (
  effect: Extract<EffectDefinition, { readonly type: "modify-damage" }>,
  context: MoveEffectRuntimeContext,
) => (effect.scope?.type === "next-actions" ? numeric(effect.scope.count, context) : undefined);

const damageModificationNextTurnDuration = (
  effect: Extract<EffectDefinition, { readonly type: "modify-damage" }>,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
) =>
  effect.scope?.type === "next-turn"
    ? {
        type: "turns" as const,
        ownerCombatantId: target === "self" ? context.self.id : context.opponent.id,
        remaining: 1,
      }
    : undefined;

const damageModificationCap = (
  effect: Extract<EffectDefinition, { readonly type: "modify-damage" }>,
  context: MoveEffectRuntimeContext,
) => {
  if (effect.cap === undefined) return undefined;
  const value = numeric(effect.cap.value, context);
  if (value === undefined) return undefined;
  const resolvedValue =
    effect.percent === undefined || effect.percent.type === "damage-percent"
      ? value
      : damageAmount(effect.percent, value, context);
  return { type: effect.cap.type, value: resolvedValue };
};

const damageModificationAmount = (
  effect: Extract<EffectDefinition, { readonly type: "modify-damage" }>,
  resolvedAmount: number,
  context: MoveEffectRuntimeContext,
) => {
  if (effect.percent === undefined) return 0;
  if (effect.operation === "multiply") return resolvedAmount;
  return damageAmount(effect.percent, resolvedAmount, context);
};

const damageModificationValue = (
  effect: Extract<EffectDefinition, { readonly type: "modify-damage" }>,
  context: MoveEffectRuntimeContext,
) => {
  if (effect.percent === undefined)
    return effect.cap === undefined ? undefined : { resolvedAmount: 0 };
  const amount = numeric(effect.percent, context);
  const resolvedAmount = effect.percent.type === "damage-percent" ? effect.percent.percent : amount;
  return resolvedAmount === undefined ? undefined : { resolvedAmount };
};

const damageModificationLifecycle = (
  effect: Extract<EffectDefinition, { readonly type: "modify-damage" }>,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
) => {
  const scope = effect.scope?.type;
  if (!supportedDamageScope(scope)) return undefined;
  const remaining = damageModificationRemaining(effect, context);
  if (remaining !== undefined && remaining < 1) return undefined;
  const duration = damageDuration(effect.duration, context, target);
  if (effect.duration !== undefined && duration === undefined) return undefined;
  const cap = damageModificationCap(effect, context);
  if (effect.cap !== undefined && cap === undefined) return undefined;
  const nextTurn = damageModificationNextTurnDuration(effect, context, target);
  return {
    scope:
      scope === undefined || scope === "next-turn"
        ? undefined
        : (scope as "current-action" | "following-action" | "next-action" | "next-actions"),
    remaining,
    duration,
    cap,
    nextTurn,
  };
};

const damageModificationActivationCost = (
  effect: Extract<EffectDefinition, { readonly type: "modify-damage" }>,
  context: MoveEffectRuntimeContext,
) => {
  if (effect.activationCost === undefined) return undefined;
  const amount = numeric(effect.activationCost.amount, context);
  const minimum =
    effect.activationCost.minimum === undefined
      ? undefined
      : numeric(effect.activationCost.minimum, context);
  return amount === undefined ||
    (effect.activationCost.minimum !== undefined && minimum === undefined)
    ? undefined
    : {
        resource: effect.activationCost.resource,
        amount,
        ...(minimum === undefined ? {} : { minimum }),
      };
};

const resolvedDamageModification = (
  move: MoveDefinition,
  effect: Extract<EffectDefinition, { readonly type: "modify-damage" }>,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
  effectIndex: number,
): DamageModification | undefined => {
  const value = damageModificationValue(effect, context);
  if (value === undefined) return undefined;
  const lifecycle = damageModificationLifecycle(effect, context, target);
  if (lifecycle === undefined) return undefined;
  const activationCost = damageModificationActivationCost(effect, context);
  if (effect.activationCost !== undefined && activationCost === undefined) return undefined;
  return {
    target,
    operation: effect.operation ?? "add",
    effectIndex,
    sourceCombatantId: context.self.id,
    sourceDefinitionId: move.id,
    amount: damageModificationAmount(effect, value.resolvedAmount, context),
    basis: effect.percent === undefined ? "power-percent" : damageBasis(effect.percent),
    ...(lifecycle.cap === undefined ? {} : { cap: lifecycle.cap }),
    ...(effect.percent === undefined ? { capOnly: true } : {}),
    ...(effect.selector === undefined ? {} : { selector: effect.selector }),
    ...(lifecycle.scope === undefined ? {} : { scope: lifecycle.scope }),
    ...(lifecycle.remaining === undefined ? {} : { remaining: lifecycle.remaining }),
    ...(effect.scope?.type === "next-turn" ? { availableFromTurn: context.turnNumber + 1 } : {}),
    ...(lifecycle.duration === undefined && lifecycle.nextTurn === undefined
      ? {}
      : { duration: lifecycle.duration ?? lifecycle.nextTurn }),
    ...(activationCost === undefined ? {} : { activationCost }),
  };
};

const damageModificationEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "modify-damage" }>,
  move: MoveDefinition,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
  effectIndex: number,
): EffectChanges => {
  const modification = resolvedDamageModification(move, effect, context, target, effectIndex);
  return modification === undefined
    ? emptyEffectChanges()
    : {
        ...emptyEffectChanges(),
        damageModifications: [
          {
            ...modification,
            ...(effect.stacking === undefined ? {} : { stacking: effect.stacking }),
            ...(effect.useLimit?.scope === "combat"
              ? (() => {
                  const count =
                    typeof effect.useLimit.count === "number"
                      ? effect.useLimit.count
                      : numeric(effect.useLimit.count, context);
                  return count === undefined
                    ? {}
                    : { useLimit: { scope: "combat" as const, count } };
                })()
              : {}),
          },
        ],
      };
};

const statModificationEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "modify-stat" }>,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
): EffectChanges => {
  const amount = numeric(effect.amount, context);
  if (amount === undefined) return emptyEffectChanges();
  const duration =
    effect.duration?.type === "turns"
      ? (() => {
          const remaining = numeric(effect.duration.turns, context);
          return remaining === undefined
            ? undefined
            : {
                type: "turns" as const,
                ownerCombatantId: (target === "self" ? context.self : context.opponent).id,
                remaining: Math.max(1, remaining),
              };
        })()
      : undefined;
  if (effect.duration !== undefined && duration === undefined) return emptyEffectChanges();
  return {
    ...emptyEffectChanges(),
    statModifications: [
      {
        target,
        stat: effect.stat,
        operation: effect.operation,
        amount,
        ...(effect.selector === undefined ? {} : { selector: effect.selector }),
        ...(effect.scope === undefined
          ? {}
          : { scope: effect.scope.type as "next-action" | "next-roll" }),
        ...(effect.scope?.type === "next-roll"
          ? { roll: effect.scope.roll as "attack" | "defense" }
          : {}),
        ...(duration === undefined ? {} : { duration }),
      },
    ],
  };
};

const slotCapacityModificationEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "modify-slot-capacity" }>,
  move: MoveDefinition,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
  effectIndex: number,
): EffectChanges => {
  const amount = numeric(effect.amount, context);
  if (target !== "self" || amount === undefined || !Number.isInteger(amount) || amount === 0)
    return emptyEffectChanges();
  return {
    ...emptyEffectChanges(),
    slotCapacityModifications: [
      {
        sourceCombatantId: context.self.id,
        sourceDefinitionId: move.id,
        sourceEffectIndex: effectIndex,
        slot: effect.slot,
        amount,
      },
    ],
  };
};

const suppressionDuration = (
  effect: Extract<EffectDefinition, { readonly type: "suppress" }>,
  context: MoveEffectRuntimeContext,
  trigger: string,
): SuppressionApplication["duration"] | undefined => {
  if (effect.scope?.type === "next-action") {
    return { type: "next-actions", remaining: 1 };
  }
  if (effect.scope?.type === "following-action")
    return { type: "following-action", remaining: effect.scope.offset };
  const duration = effect.duration;
  if (duration === undefined)
    return trigger === "before-defense-roll" || trigger === "on-success"
      ? { type: "current-resolution" }
      : undefined;
  if (duration.type === "combat") return { type: "combat" };
  if (duration.type === "turns") {
    const turns = numeric(duration.turns, context);
    return turns === undefined ? undefined : { type: "turns", remaining: Math.max(1, turns) };
  }
  if (duration.type !== "until-roll-threshold" || duration.roll !== "attack") return undefined;
  const value = numeric(duration.value, context);
  return value === undefined
    ? undefined
    : {
        type: "until-roll-threshold",
        roll: "attack",
        comparison: duration.comparison,
        value,
      };
};

const suppressionEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "suppress" }>,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
  trigger: string,
): EffectChanges => {
  const resolvedDuration = suppressionDuration(effect, context, trigger);
  if (resolvedDuration === undefined) return emptyEffectChanges();
  if (effect.aspects === undefined || effect.aspects.length === 0) return emptyEffectChanges();
  const selector =
    effect.selector ??
    effect.conditions?.find(
      (
        condition,
      ): condition is Extract<
        NonNullable<EffectDefinition["conditions"]>[number],
        { type: "move-selector" }
      > => condition.type === "move-selector",
    );
  return {
    ...emptyEffectChanges(),
    suppressions: [
      {
        target,
        ...(selector === undefined ? {} : { selector }),
        aspects: effect.aspects,
        duration: resolvedDuration,
      },
    ],
  };
};

const effectTargets = (effect: EffectDefinition): readonly ("self" | "opponent")[] => {
  if (effect.target === "self") return ["self"];
  if (effect.target === "opponent") return ["opponent"];
  return effect.target === "participants" ? ["self", "opponent"] : [];
};

const emptyEffectChanges = () => ({
  resources: [] as ResourceChange[],
  resourceActionModifiers: [] as ResourceActionModifierApplication[],
  resourceCostModifications: [] as ResourceCostModifierApplication[],
  storedRollRequests: [] as StoredRollRequest[],
  storedMoveSelectionRequests: [] as StoredMoveSelectionRequest[],
  statuses: [] as StatusApplication[],
  extraActions: [] as ExtraActionApplication[],
  counterActions: [] as CounterActionApplication[],
  scheduledResources: [] as ScheduledResourceApplication[],
  damageModifications: [] as DamageModification[],
  statModifications: [] as StatModification[],
  suppressions: [] as SuppressionApplication[],
  forcedActions: [] as ForcedActionApplication[],
  actionRestrictions: [] as ActionRestrictionApplication[],
  moveRemovals: [] as MoveRemovalApplication[],
  activations: [] as ActivationApplication[],
  locks: [] as LockApplication[],
  deactivations: [] as DeactivationApplication[],
  floatingEffects: [] as FloatingEffectApplication[],
  moveUsePreventions: [] as MoveUsePreventionApplication[],
  remainingUseModifications: [] as RemainingUseModificationApplication[],
  statusPreventions: [] as StatusPreventionApplication[],
  negations: [] as NegationApplication[],
  rollModifications: [] as RollModification[],
  rollModificationTransformers: [] as RollModificationTransformerApplication[],
  rollSelections: [] as RollSelectionApplication[],
  rollDefinitions: [] as RollDefinitionOverride[],
  rollResultOverrides: [] as RollResultOverride[],
  combatResultOverrides: [] as CombatResultOverrideApplication[],
  criticalThresholds: [] as CriticalThresholdApplication[],
  resolutionThresholds: [] as ResolutionThresholdApplication[],
  resolutionPreventions: [] as ResolutionPreventionApplication[],
  combatResultPreventions: [] as CombatResultPreventionApplication[],
  rollModificationPreventions: [] as RollModificationPreventionApplication[],
  moveModificationPreventions: [] as MoveModificationPreventionApplication[],
  currentActionMoveModificationPreventions:
    [] as CurrentActionMoveModificationPreventionApplication[],
  resourceModificationPreventions: [] as ResourceModificationPreventionApplication[],
  costModifications: [] as CostModification[],
  currentActionCostModifications: [] as CurrentActionCostModification[],
  slotCapacityModifications: [] as SlotCapacityModificationApplication[],
  rerolls: [] as RerollApplication[],
});

const moveRemovalEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "remove-move-from-combat" }>,
  target: "self" | "opponent",
  effectIndex: number,
): EffectChanges => ({
  ...emptyEffectChanges(),
  moveRemovals: [
    {
      target,
      move: effect.move,
      effectIndex,
    },
  ],
});

const lockDuration = (
  duration: Extract<EffectDefinition, { readonly type: "lock" }>["duration"],
  context: MoveEffectRuntimeContext,
): LockApplication["duration"] | undefined => {
  if (duration === undefined || duration.type === "combat") return { type: "combat" };
  if (duration.type === "turns") {
    const remaining = numeric(duration.turns, context);
    return remaining === undefined
      ? undefined
      : { type: "turns", remaining: Math.max(1, remaining) };
  }
  if (duration.type === "until-combat-result") {
    return {
      type: "until-combat-result",
      actor: duration.actor,
      result: duration.result,
      ...(duration.moveSelector === undefined ? {} : { selector: duration.moveSelector }),
    };
  }
  if (duration.type === "until-perfect-roll" || duration.type === "turns-or-until-perfect-roll") {
    throw new Error(`Unsupported converted LOCK duration: ${duration.type}`);
  }
  const value = numeric(duration.value, context);
  if (value === undefined) return undefined;
  if (duration.type === "until-roll-threshold") return { ...duration, value };
  if (duration.type === "until-resource-threshold") return { ...duration, value };
  return {
    type: "until-turn-start-roll-threshold",
    subject: duration.subject,
    dice: duration.dice,
    sides: duration.sides,
    comparison: duration.comparison,
    value,
    remainingIgnoredChecks: (duration.ignoreFirstCheck ? 1 : 0) + (duration.startAfterTurns ?? 0),
  };
};

const lockApplication = (
  effect: Extract<EffectDefinition, { readonly type: "lock" }>,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
): LockApplication | undefined => {
  if (effect.scope?.type === "next-turn") {
    return {
      target,
      affectedType: effect.affectedType,
      ...(effect.selector === undefined ? {} : { selector: effect.selector }),
      duration: { type: "turns", remaining: 1 },
    };
  }
  const duration = lockDuration(effect.duration, context);
  return duration === undefined
    ? undefined
    : {
        target,
        affectedType: effect.affectedType,
        ...(effect.selector === undefined ? {} : { selector: effect.selector }),
        duration,
      };
};

const statusApplicationChanges = (
  statusId: ActiveStatus["statusId"],
  durationDefinition: Extract<EffectDefinition, { readonly type: "apply-status" }>["duration"],
  move: MoveDefinition,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
) => {
  const turns =
    durationDefinition?.type === "turns" ? numeric(durationDefinition.turns, context) : undefined;
  const ownerCombatantId = target === "self" ? context.self.id : context.opponent.id;
  let duration: ActiveStatus["duration"];
  if (durationDefinition?.type === "combat") {
    duration = { type: "combat" };
  } else if (turns === undefined) {
    duration = { type: "turns", ownerCombatantId, remaining: 1 };
  } else {
    duration = { type: "turns", ownerCombatantId, remaining: Math.max(1, turns) };
  }
  return {
    resources: [],
    storedRollRequests: [],
    storedMoveSelectionRequests: [],
    statuses: [
      {
        target,
        status: {
          statusId,
          sourceCombatantId: context.self.id,
          sourceDefinitionId: move.id,
          stacks: 1,
          duration,
        },
      },
    ],
    scheduledResources: [],
    combatResultOverrides: [],
    criticalThresholds: [],
    extraActions: [],
    counterActions: [],
    damageModifications: [],
    statModifications: [],
    suppressions: [],
    forcedActions: [],
    actionRestrictions: [],
    activations: [],
    locks: [],
    deactivations: [],
    floatingEffects: [],
    moveUsePreventions: [],
    remainingUseModifications: [],
    statusPreventions: [],
    negations: [],
    rollModifications: [],
    rollModificationTransformers: [],
    rollSelections: [],
    rollDefinitions: [],
    rollResultOverrides: [],
    resolutionThresholds: [],
    resolutionPreventions: [],
    combatResultPreventions: [],
    rollModificationPreventions: [],
    moveModificationPreventions: [],
    currentActionMoveModificationPreventions: [],
    resourceModificationPreventions: [],
    costModifications: [],
    currentActionCostModifications: [],
    slotCapacityModifications: [],
    rerolls: [],
  };
};

const combatOutcomeStatusIds = {
  break: "break",
  sever: "sever",
  stun: "stun",
} as const;

const statusEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "apply-status" }>,
  move: MoveDefinition,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
) => statusApplicationChanges(effect.statusId, effect.duration, move, context, target);

const combatOutcomeEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "grant-combat-outcome" }>,
  move: MoveDefinition,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
) => {
  return statusApplicationChanges(
    combatOutcomeStatusIds[effect.outcome],
    undefined,
    move,
    context,
    target,
  );
};

const floatingActivationCost = (
  effect: Extract<EffectDefinition, { readonly type: "create-floating-effect" }>,
  context: MoveEffectRuntimeContext,
) => {
  if (effect.activationCost === undefined) return undefined;
  const amount = numeric(effect.activationCost.amount, context);
  if (amount === undefined) return null;
  const minimum =
    effect.activationCost.minimum === undefined
      ? undefined
      : numeric(effect.activationCost.minimum, context);
  if (effect.activationCost.minimum !== undefined && minimum === undefined) return null;
  return {
    resource: effect.activationCost.resource,
    amount,
    ...(minimum === undefined ? {} : { minimum }),
  };
};

const floatingUseLimitCount = (
  effect: Extract<EffectDefinition, { readonly type: "create-floating-effect" }>,
  context: MoveEffectRuntimeContext,
) => {
  if (effect.useLimit === undefined) return undefined;
  if (typeof effect.useLimit.count === "number") return effect.useLimit.count;
  return numeric(effect.useLimit.count, context);
};

const hasValidFloatingUseLimit = (
  effect: Extract<EffectDefinition, { readonly type: "create-floating-effect" }>,
  count: number | undefined,
) =>
  effect.useLimit === undefined || (count !== undefined && Number.isInteger(count) && count >= 1);

const normalizedFloatingDuration = (
  duration: Extract<EffectDefinition, { readonly type: "create-floating-effect" }>["duration"],
  context: MoveEffectRuntimeContext,
): FloatingEffectApplication["duration"] | null => {
  if (duration === undefined) return undefined;
  if (duration.type === "combat") return undefined;
  if (duration.type === "until-combat-result") {
    const threshold = duration.conditions?.find((condition) => condition.type === "roll-threshold");
    const rollThreshold =
      threshold?.type === "roll-threshold"
        ? {
            roll: threshold.roll,
            comparison: threshold.comparison,
            value: numeric(threshold.value, context),
          }
        : undefined;
    return {
      type: "until-combat-result",
      actor: duration.actor,
      result: duration.result,
      ...(duration.moveSelector === undefined ? {} : { moveSelector: duration.moveSelector }),
      ...(rollThreshold?.value === undefined
        ? {}
        : {
            rollThreshold: {
              roll: rollThreshold.roll,
              comparison: rollThreshold.comparison,
              value: rollThreshold.value,
            },
          }),
    };
  }
  if (duration.type !== "until-roll-threshold") return null;
  if (duration.roll === "transformation") return null;
  const value = numeric(duration.value, context);
  if (value === undefined) return null;
  return {
    type: "until-roll-threshold",
    roll: duration.roll,
    comparison: duration.comparison,
    value,
    ...(duration.moveSelector === undefined ? {} : { moveSelector: duration.moveSelector }),
  };
};

const floatingEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "create-floating-effect" }>,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
  effectIndex: number,
): EffectChanges => {
  const activationCost = floatingActivationCost(effect, context);
  const useLimitCount = floatingUseLimitCount(effect, context);
  if (activationCost === null || !hasValidFloatingUseLimit(effect, useLimitCount))
    return emptyEffectChanges();
  const normalizedDuration = normalizedFloatingDuration(effect.duration, context);
  if (normalizedDuration === null) return emptyEffectChanges();
  const retainsTargetRelation = effect.effects?.some((nestedEffect) =>
    nestedEffect.conditions?.some(
      (condition) =>
        condition.type === "target-relation" &&
        condition.subject === "source" &&
        condition.relation === "same-as-source-effect-target",
    ),
  );
  return {
    ...emptyEffectChanges(),
    floatingEffects: [
      {
        target,
        ...(retainsTargetRelation ? { targetRelationCombatantId: context.opponent.id } : {}),
        ...(context.blockedAttackDamage === undefined
          ? {}
          : { blockedAttackDamage: context.blockedAttackDamage }),
        sourceEffectIndex: effectIndex,
        floatingEffectId: effect.floatingEffectId,
        effects: effect.effects ?? [],
        termination: (effect.termination ?? []).map(({ trigger, actor, selector }) => ({
          trigger,
          actor,
          ...(selector === undefined ? {} : { selector }),
        })),
        scope: effect.scope,
        ...(normalizedDuration === undefined ? {} : { duration: normalizedDuration }),
        ...(effect.stacking === undefined ? {} : { stacking: effect.stacking }),
        ...(activationCost === undefined
          ? {}
          : {
              activationCost: {
                resource: activationCost.resource,
                amount: activationCost.amount,
                ...(activationCost.minimum === undefined
                  ? {}
                  : { minimum: activationCost.minimum }),
              },
            }),
        ...(effect.useLimit === undefined
          ? {}
          : { useLimit: { scope: effect.useLimit.scope, count: useLimitCount! } }),
      },
    ],
  };
};

const rollAndStoreEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "roll-and-store" }>,
  move: MoveDefinition,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
  effectIndex: number,
): EffectChanges => {
  const sides = typeof effect.sides === "number" ? effect.sides : numeric(effect.sides, context);
  if (
    target !== "self" ||
    sides === undefined ||
    !Number.isInteger(sides) ||
    sides < 1 ||
    !Number.isInteger(effect.dice) ||
    effect.dice < 1
  )
    return emptyEffectChanges();
  return {
    ...emptyEffectChanges(),
    storedRollRequests: [
      {
        target,
        sourceDefinitionId: move.id,
        effectIndex,
        storageKey: effect.storageKey,
        dice: effect.dice,
        sides,
      },
    ],
  };
};

const selectMoveByStoredRollEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "select-move-by-stored-roll" }>,
  move: MoveDefinition,
  target: "self" | "opponent",
  effectIndex: number,
): EffectChanges => {
  if (
    target !== "self" ||
    effect.subject !== "self" ||
    effect.selector.subject !== "source" ||
    effect.ordering !== "character-sheet-top-to-bottom" ||
    effect.reindex !== "on-moveset-change"
  )
    return emptyEffectChanges();
  return {
    ...emptyEffectChanges(),
    storedMoveSelectionRequests: [
      {
        target,
        sourceDefinitionId: move.id,
        effectIndex,
        storageKey: effect.storageKey,
        selectionKey: effect.selectionKey,
        selector: effect.selector,
        ordering: effect.ordering,
        reindex: effect.reindex,
      },
    ],
  };
};

const extraActionEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "grant-extra-action" }>,
  move: MoveDefinition,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
  trigger: string,
  effectIndex: number,
): EffectChanges => {
  const maximumActions =
    effect.maximumActions === undefined ? undefined : numeric(effect.maximumActions, context);
  let useLimitCount: number | undefined;
  if (effect.useLimit !== undefined)
    useLimitCount =
      typeof effect.useLimit.count === "number"
        ? effect.useLimit.count
        : numeric(effect.useLimit.count, context);
  if (effect.maximumActions !== undefined && maximumActions === undefined)
    return emptyEffectChanges();
  if (effect.useLimit !== undefined && useLimitCount === undefined) return emptyEffectChanges();
  return {
    ...emptyEffectChanges(),
    extraActions: [
      {
        target,
        sourceDefinitionId: move.id,
        phase: effect.phase === "action-phase" ? "action" : "upkeep",
        ...(effect.moveCategory === undefined ? {} : { moveCategory: effect.moveCategory }),
        sourceMoveOnly: effect.move === "source",
        ...(effect.constant === undefined ? {} : { constant: effect.constant }),
        ...(maximumActions === undefined ? {} : { maximumActions }),
        scope: effect.scope?.type === "next-turn" ? "next-turn" : "current-turn",
        ...(effect.useLimit === undefined
          ? {}
          : { useLimit: { scope: effect.useLimit.scope, count: useLimitCount! } }),
        effectIndex,
      },
    ],
  };
};

type ScheduleEffectDefinition = Extract<EffectDefinition, { readonly type: "schedule-effect" }>;

const scheduledDuration = (
  effect: ScheduleEffectDefinition,
  context: MoveEffectRuntimeContext,
): ScheduledResourceApplication["duration"] | null => {
  if (effect.duration === undefined) return undefined;
  if (effect.duration.type === "turns") {
    const remaining = numeric(effect.duration.turns, context);
    return remaining === undefined || remaining < 1 ? null : { type: "turns", remaining };
  }
  if (effect.duration.type !== "until-roll-threshold") return null;
  const value = numeric(effect.duration.value, context);
  return value === undefined
    ? null
    : {
        type: "until-roll-threshold",
        roll: effect.duration.roll,
        comparison: effect.duration.comparison,
        value,
        ...(effect.duration.moveSelector === undefined
          ? {}
          : { moveSelector: effect.duration.moveSelector }),
      };
};

const scheduledCancellation = (
  effect: ScheduleEffectDefinition,
  context: MoveEffectRuntimeContext,
): ScheduledResourceApplication["cancellation"] | null => {
  const cancellation = effect.cancellation;
  if (cancellation === undefined) return undefined;
  const rollThreshold = cancellation.rollThreshold;
  if (rollThreshold === undefined)
    return {
      actor: cancellation.actor,
      result: cancellation.result,
      moveSelector: cancellation.moveSelector,
      target: cancellation.target,
    };
  const value = numeric(rollThreshold.value, context);
  if (value === undefined) return null;
  return {
    actor: cancellation.actor,
    result: cancellation.result,
    moveSelector: cancellation.moveSelector,
    target: cancellation.target,
    rollThreshold: {
      roll: rollThreshold.roll,
      comparison: rollThreshold.comparison,
      value,
    },
  };
};

const scheduledResourceEffectChanges = (
  effect: ScheduleEffectDefinition,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
  effectIndex: number,
): EffectChanges => {
  const duration = scheduledDuration(effect, context);
  const cancellation = scheduledCancellation(effect, context);
  if (duration === null || cancellation === null) return emptyEffectChanges();
  return {
    ...emptyEffectChanges(),
    scheduledResources: [
      {
        target,
        effectIndex,
        timing: effect.timing,
        repeat: effect.repeat ?? "once",
        resource: effect.effect.resource,
        operation: effect.effect.operation,
        amount: effect.effect.amount,
        ...(effect.stacking === "prevent" ? { stacking: "prevent" as const } : {}),
        ...(duration === undefined ? {} : { duration }),
        ...(cancellation === undefined ? {} : { cancellation }),
      },
    ],
  };
};

const counterSourceAction = (
  effect: Extract<EffectDefinition, { readonly type: "grant-counter-action" }>,
  context: MoveEffectRuntimeContext,
) => {
  if (effect.action !== "repeat-triggering-attack") return undefined;
  const actions = [...(context.actionHistory ?? [])].reverse();
  if (context.currentAction !== undefined) actions.unshift(context.currentAction);
  return actions.find(
    (
      action,
    ): action is Extract<CombatActionRecord, { readonly type: "basic-attack" | "use-move" }> =>
      (action.type === "basic-attack" || action.type === "use-move") &&
      action.actorId === context.opponent.id &&
      action.targetCombatantId === context.self.id,
  );
};

const counterActionParameters = (
  effect: Extract<EffectDefinition, { readonly type: "grant-counter-action" }>,
  context: MoveEffectRuntimeContext,
) => {
  const activationAmount = optionalNumeric(effect.activationCost?.amount, context);
  const activationMinimum = optionalNumeric(effect.activationCost?.minimum, context);
  const costModifierAmount = optionalNumeric(effect.costModifier?.amount, context);
  const costModifierMinimum = optionalNumeric(effect.costModifier?.minimum, context);
  const useLimitCount = resolvedUseLimitCount(effect.useLimit, context);
  const durationRemaining =
    effect.duration?.type === "turns" ? numeric(effect.duration.turns, context) : undefined;
  if (effect.activationCost?.amount !== undefined && activationAmount === undefined)
    return undefined;
  if (effect.activationCost?.minimum !== undefined && activationMinimum === undefined)
    return undefined;
  if (effect.costModifier?.amount !== undefined && costModifierAmount === undefined)
    return undefined;
  if (effect.costModifier?.minimum !== undefined && costModifierMinimum === undefined)
    return undefined;
  if (effect.useLimit !== undefined && useLimitCount === undefined) return undefined;
  if (effect.duration?.type === "turns" && durationRemaining === undefined) return undefined;
  return {
    activationAmount,
    activationMinimum,
    costModifierAmount,
    costModifierMinimum,
    useLimitCount,
    durationRemaining,
  };
};

const counterActionEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "grant-counter-action" }>,
  move: MoveDefinition,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
  effectIndex: number,
): EffectChanges => {
  const parameters = counterActionParameters(effect, context);
  if (parameters === undefined) return emptyEffectChanges();
  const {
    activationAmount,
    activationMinimum,
    costModifierAmount,
    costModifierMinimum,
    useLimitCount,
    durationRemaining,
  } = parameters;

  const sourceAction = counterSourceAction(effect, context);
  const sourceMove =
    sourceAction?.type === "use-move" ? context.moves.get(sourceAction.moveId) : undefined;
  if (effect.action === "repeat-triggering-attack" && sourceAction === undefined)
    return emptyEffectChanges();
  return {
    ...emptyEffectChanges(),
    counterActions: [
      {
        target,
        sourceDefinitionId: move.id,
        effectIndex,
        action: effect.action,
        stopsTriggeringAttack: effect.stopsTriggeringAttack,
        ignoreRequirements: effect.ignoreRequirements === true,
        ...(activationAmount === undefined
          ? {}
          : {
              activationCost: {
                resource: "ki" as const,
                amount: activationAmount,
                ...(activationMinimum === undefined ? {} : { minimum: activationMinimum }),
              },
            }),
        ...(costModifierAmount === undefined
          ? {}
          : {
              costModifier: {
                operation: effect.costModifier!.operation,
                amount: costModifierAmount,
                ...(costModifierMinimum === undefined ? {} : { minimum: costModifierMinimum }),
              },
            }),
        ...(useLimitCount === undefined
          ? {}
          : { useLimit: { scope: "combat" as const, count: useLimitCount } }),
        ...(durationRemaining === undefined
          ? {}
          : { duration: { type: "turns" as const, remaining: durationRemaining } }),
        ...(effect.stacking === "prevent" ? { stacking: "prevent" as const } : {}),
        ...(sourceAction === undefined ? {} : { sourceAction }),
        ...(sourceMove === undefined ? {} : { sourceMove }),
      },
    ],
  };
};

type EffectChanges = Omit<
  ReturnType<typeof emptyEffectChanges>,
  "resourceActionModifiers" | "resourceCostModifications" | "moveRemovals"
> & {
  readonly resourceActionModifiers?: readonly ResourceActionModifierApplication[];
  readonly resourceCostModifications?: readonly ResourceCostModifierApplication[];
  readonly moveRemovals?: readonly MoveRemovalApplication[];
};
type TriggeredEffectHandler = (
  effect: EffectDefinition,
  move: MoveDefinition,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
  trigger: string,
  effectIndex: number,
) => EffectChanges;

const resourceEffectAmount = (
  effect: Extract<EffectDefinition, { readonly type: "modify-resource" }>,
  context: MoveEffectRuntimeContext,
): number | undefined => {
  if (effect.amount === undefined) return undefined;
  if (effect.amount.type !== "damage-percent") return numeric(effect.amount, context);
  if (context.currentDamage === undefined) return undefined;
  return Math.round((context.currentDamage * effect.amount.percent) / 100);
};

const resourceActivationCost = (
  effect: Extract<EffectDefinition, { readonly type: "modify-resource" }>,
  context: MoveEffectRuntimeContext,
) => {
  if (effect.activationCost === undefined) return undefined;
  const amount = numeric(effect.activationCost.amount, context);
  const minimum =
    effect.activationCost.minimum === undefined
      ? undefined
      : numeric(effect.activationCost.minimum, context);
  return amount === undefined ||
    (effect.activationCost.minimum !== undefined && minimum === undefined)
    ? null
    : {
        resource: effect.activationCost.resource,
        amount,
        ...(minimum === undefined ? {} : { minimum }),
      };
};

const resourceEffectCap = (
  effect: Extract<EffectDefinition, { readonly type: "modify-resource" }>,
  context: MoveEffectRuntimeContext,
) => {
  if (effect.cap === undefined) return undefined;
  const value = numeric(effect.cap.value, context);
  return value === undefined ? null : { type: effect.cap.type, value };
};

const resourceChangeFromEffect = (
  effect: Extract<EffectDefinition, { readonly type: "modify-resource" }>,
  move: MoveDefinition,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
  amount: number,
  cap: ReturnType<typeof resourceEffectCap>,
  activationCost: Exclude<ReturnType<typeof resourceActivationCost>, null>,
  useLimit: { readonly scope: "combat" | "turn"; readonly count: number } | undefined,
  effectIndex: number,
): ResourceChange => ({
  resource: effect.resource,
  target,
  operation: effect.operation,
  amount,
  ...(cap === undefined || cap === null ? {} : { cap }),
  sourceCombatantId: context.self.id,
  ...(activationCost === undefined && useLimit === undefined
    ? {}
    : { sourceDefinitionId: move.id, sourceEffectIndex: effectIndex }),
  ...(useLimit === undefined ? {} : { useLimit }),
  ...(effect.prevention === "prohibited" ? { preventable: false } : {}),
  ...(activationCost === undefined
    ? {}
    : {
        activationCost: {
          resource: activationCost.resource,
          amount: activationCost.amount,
          ...(activationCost.minimum === undefined ? {} : { minimum: activationCost.minimum }),
        },
      }),
  cause: "non-damage-effect" as const,
  ...(move.styleId === undefined ? {} : { sourceStyleId: move.styleId }),
});

const resourceEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "modify-resource" }>,
  move: MoveDefinition,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
  effectIndex: number,
): EffectChanges => {
  const cap = resourceEffectCap(effect, context);
  const activationCost = resourceActivationCost(effect, context);
  const useLimitCount = resolvedUseLimitCount(effect.useLimit, context);
  let useLimit: { readonly scope: "combat" | "turn"; readonly count: number } | undefined;
  if (effect.useLimit !== undefined && useLimitCount !== undefined)
    useLimit = { scope: effect.useLimit.scope, count: useLimitCount };
  if (cap === null) return emptyEffectChanges();
  if (activationCost === null) return emptyEffectChanges();
  if (effect.trigger === "on-power-up" && effect.scope?.type === "next-turn") {
    const amount = effect.amount;
    if (
      amount === undefined ||
      (amount.type !== "literal" &&
        amount.type !== "resource-percent" &&
        amount.type !== "stat-percent")
    )
      return emptyEffectChanges();
    return {
      ...emptyEffectChanges(),
      scheduledResources: [
        {
          target,
          effectIndex,
          timing: {
            type: "turn-start",
            subject: effect.scope.subject,
            turnsAfter: 1,
          },
          repeat: "once",
          resource: effect.resource,
          operation: effect.operation,
          amount,
        },
      ],
    };
  }
  if (effect.scope?.type === "next-action" && effect.amount?.type === "damage-percent") {
    return {
      ...emptyEffectChanges(),
      resourceActionModifiers: [
        {
          target,
          effectIndex,
          resource: effect.resource,
          operation: effect.operation,
          amount: effect.amount.percent,
          basis: "damage-percent",
          scope: "next-action",
        },
      ],
    };
  }
  const amount = resourceEffectAmount(effect, context);
  if (effect.amount !== undefined && amount === undefined) return emptyEffectChanges();
  return {
    ...emptyEffectChanges(),
    resources:
      amount === undefined
        ? []
        : [
            resourceChangeFromEffect(
              effect,
              move,
              context,
              target,
              amount,
              cap,
              activationCost,
              useLimit,
              effectIndex,
            ),
          ],
  };
};

const resourceCostModifierChanges = (
  effect: Extract<EffectDefinition, { readonly type: "modify-resource-cost" }>,
  move: MoveDefinition,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
  effectIndex: number,
): EffectChanges => {
  if (target !== "self") return emptyEffectChanges();
  const percent = numeric(effect.percent, context);
  const activationCost =
    effect.activationCost === undefined
      ? undefined
      : numeric(effect.activationCost.amount, context);
  const minimum =
    effect.activationCost?.minimum === undefined
      ? undefined
      : numeric(effect.activationCost.minimum, context);
  if (
    percent === undefined ||
    (effect.activationCost !== undefined &&
      (activationCost === undefined ||
        (effect.activationCost.minimum !== undefined && minimum === undefined)))
  )
    return emptyEffectChanges();
  return {
    ...emptyEffectChanges(),
    resourceCostModifications: [
      {
        target,
        sourceCombatantId: context.self.id,
        sourceDefinitionId: move.id,
        effectIndex,
        resource: effect.resource,
        operation: effect.operation,
        percent,
        selector: effect.selector,
        scope: "next-action",
        stacking: "prevent",
        ...(effect.activationCost === undefined
          ? {}
          : {
              activationCost: {
                resource: "ki" as const,
                amount: activationCost!,
                ...(minimum === undefined ? {} : { minimum }),
              },
            }),
      },
    ],
  };
};

const resourceModificationPreventionEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "prevent-resource-modification" }>,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
): EffectChanges => {
  let duration: ResourceModificationPreventionApplication["duration"] = { type: "combat" };
  if (effect.duration?.type === "turns") {
    const turns = numeric(effect.duration.turns, context);
    if (turns === undefined) return emptyEffectChanges();
    duration = { type: "turns", remaining: Math.max(1, turns) };
  } else if (effect.duration?.type === "until-combat-result") {
    duration = {
      type: "until-combat-result",
      actor: effect.duration.actor,
      result: effect.duration.result,
    };
  } else if (effect.duration !== undefined && effect.duration.type !== "combat") {
    return emptyEffectChanges();
  }
  return {
    ...emptyEffectChanges(),
    resourceModificationPreventions: [
      {
        target,
        resource: effect.resource,
        operation: effect.operation,
        ...(effect.sourceActor === undefined ? {} : { sourceActor: effect.sourceActor }),
        ...(effect.exceptAction === undefined ? {} : { exceptAction: effect.exceptAction }),
        duration,
      },
    ],
  };
};

interface ResolvedCostModificationValues {
  readonly amount: number;
  readonly minimum?: number;
  readonly maximum?: number;
}

const resolvedCostModificationValues = (
  effect: Extract<EffectDefinition, { readonly type: "modify-cost" }>,
  context: MoveEffectRuntimeContext,
  sourceMoveId: string,
): ResolvedCostModificationValues | undefined => {
  const amount = numeric(effect.amount, context, sourceMoveId);
  const minimum =
    effect.minimum === undefined ? undefined : numeric(effect.minimum, context, sourceMoveId);
  const maximum =
    effect.maximum === undefined ? undefined : numeric(effect.maximum, context, sourceMoveId);
  if (
    amount === undefined ||
    (effect.minimum !== undefined && minimum === undefined) ||
    (effect.maximum !== undefined && maximum === undefined)
  )
    return undefined;
  return {
    amount,
    ...(minimum === undefined ? {} : { minimum }),
    ...(maximum === undefined ? {} : { maximum }),
  };
};

const resolvedCostActivation = (
  effect: Extract<EffectDefinition, { readonly type: "modify-cost" }>,
  context: MoveEffectRuntimeContext,
  sourceMoveId: string,
) => {
  if (effect.activationCost === undefined) return undefined;
  const amount = numeric(effect.activationCost.amount, context, sourceMoveId);
  const minimum =
    effect.activationCost.minimum === undefined
      ? undefined
      : numeric(effect.activationCost.minimum, context, sourceMoveId);
  if (
    amount === undefined ||
    (effect.activationCost.minimum !== undefined && minimum === undefined)
  )
    return undefined;
  return {
    resource: effect.activationCost.resource,
    amount,
    ...(minimum === undefined ? {} : { minimum }),
  };
};

const isCurrentActionCostModification = (
  effect: Extract<EffectDefinition, { readonly type: "modify-cost" }>,
  trigger: string,
) =>
  effect.scope?.type === "current-action" ||
  (effect.scope === undefined &&
    (trigger === "passive" || trigger === "on-move-use" || trigger === "on-cost-modified"));

const currentActionCostEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "modify-cost" }>,
  move: MoveDefinition,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
  values: ResolvedCostModificationValues,
  activationCost: ReturnType<typeof resolvedCostActivation>,
  effectIndex: number,
): EffectChanges => ({
  ...emptyEffectChanges(),
  currentActionCostModifications: [
    {
      target,
      operation: effect.operation,
      ...values,
      ...(effect.selector === undefined ? {} : { selector: effect.selector }),
      sourceDefinitionId: move.id,
      sourceEffectIndex: effectIndex,
      sourceCombatantId: context.self.id,
      ...(activationCost === undefined ? {} : { activationCost }),
    },
  ],
});

const costModificationEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "modify-cost" }>,
  move: MoveDefinition,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
  trigger: string,
  effectIndex: number,
): EffectChanges => {
  const values = resolvedCostModificationValues(effect, context, move.id);
  if (values === undefined) return emptyEffectChanges();
  const activationCost = resolvedCostActivation(effect, context, move.id);
  if (effect.activationCost !== undefined && activationCost === undefined)
    return emptyEffectChanges();
  if (isCurrentActionCostModification(effect, trigger))
    return currentActionCostEffectChanges(
      effect,
      move,
      context,
      target,
      values,
      activationCost,
      effectIndex,
    );
  const scope = effect.scope?.type;
  if (scope !== "next-action" && scope !== "next-actions") return emptyEffectChanges();
  if (scope === "next-action" && effect.selector === undefined) return emptyEffectChanges();
  const remaining = scope === "next-actions" ? numeric(effect.scope!.count, context) : undefined;
  if (scope === "next-actions" && (remaining === undefined || remaining < 1))
    return emptyEffectChanges();
  return {
    ...emptyEffectChanges(),
    costModifications: [
      {
        target,
        operation: effect.operation,
        ...values,
        ...(effect.selector === undefined ? {} : { selector: effect.selector }),
        scope,
        ...(remaining === undefined ? {} : { remaining }),
      },
    ],
  };
};

const forcedActionEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "force-action" }>,
  target: "self" | "opponent",
): EffectChanges => ({
  ...emptyEffectChanges(),
  forcedActions: [
    {
      target,
      allowedCategories: effect.allowedCategories,
      ...(effect.allowedTags === undefined ? {} : { allowedTags: effect.allowedTags }),
      allowPass: effect.allowPass,
      ...(effect.selectedMoveStorageKey === undefined
        ? {}
        : { selectedMoveStorageKey: effect.selectedMoveStorageKey }),
      ...(effect.fallback === undefined ? {} : { fallback: effect.fallback }),
    },
  ],
});

const actionRestrictionRemainingTurns = (
  effect: Extract<EffectDefinition, { readonly type: "skip-action" }>,
  context: MoveEffectRuntimeContext,
) => {
  if (effect.scope?.type === "next-turn") return 1;
  if (effect.duration?.type === "turns") return numeric(effect.duration.turns, context);
  return undefined;
};

const actionRestrictionEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "skip-action" }>,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
  effectIndex: number,
): EffectChanges => {
  const remainingTurns = actionRestrictionRemainingTurns(effect, context);
  if (remainingTurns === undefined || !Number.isInteger(remainingTurns) || remainingTurns < 1)
    return emptyEffectChanges();
  return {
    ...emptyEffectChanges(),
    actionRestrictions: [
      {
        target,
        ...(effect.blockedCategories === undefined
          ? {}
          : { blockedCategories: effect.blockedCategories }),
        remainingTurns,
        effectIndex,
      },
    ],
  };
};

const lockEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "lock" }>,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
): EffectChanges => {
  const lock = lockApplication(effect, context, target);
  return { ...emptyEffectChanges(), locks: lock === undefined ? [] : [lock] };
};

const deactivationEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "deactivate" }>,
  move: MoveDefinition,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
): EffectChanges => {
  const count = effect.count === undefined ? undefined : numeric(effect.count, context);
  if (count === undefined && effect.count !== undefined) return emptyEffectChanges();
  const selector = effect.conditions?.find(
    (condition): condition is MoveSelectorCondition => condition.type === "move-selector",
  );
  return {
    ...emptyEffectChanges(),
    deactivations: [
      {
        target,
        affectedType: effect.affectedType,
        selection: effect.selection ?? "one",
        optional: effect.optional === true,
        ...(selector === undefined ? {} : { selector }),
        ...(count === undefined ? {} : { count }),
        sourceDefinitionId: move.id,
        sourceText: effect.sourceText,
      },
    ],
  };
};

const startCombatActivationCost = (
  effect: Extract<EffectDefinition, { readonly type: "activate" }>,
  move: MoveDefinition,
  target: "self" | "opponent",
  trigger: string,
) => {
  if (trigger !== "start-combat" || effect.selector.selectionKey === undefined) return undefined;
  return (move.effects ?? []).find(
    (candidate) =>
      candidate.trigger === "start-combat" &&
      candidate.target === target &&
      candidate.type === "modify-cost" &&
      candidate.operation === "set" &&
      candidate.amount.type === "literal" &&
      candidate.amount.value === 0 &&
      candidate.selector?.selectionKey === effect.selector.selectionKey,
  );
};

const activationCostApplication = (
  activationCost: number | undefined,
  activationMinimum: number | undefined,
  selectedStartCombatCost: unknown,
): ActivationApplication["activationCost"] => {
  if (selectedStartCombatCost !== undefined) return { amount: 0 };
  if (activationCost === undefined) return undefined;
  return {
    amount: activationCost,
    ...(activationMinimum === undefined ? {} : { minimum: activationMinimum }),
  };
};

const activationEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "activate" }>,
  move: MoveDefinition,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
  trigger: string,
  effectIndex: number,
): EffectChanges => {
  const repeatCount =
    effect.repeatCount === undefined ? undefined : numeric(effect.repeatCount, context);
  const repeatUntilSelectionLimit =
    effect.repeatUntil === undefined
      ? undefined
      : Math.max(
          0,
          activeMoveCountForSubject(context.opponent, effect.repeatUntil.selector, context) -
            activeMoveCountForSubject(context.self, effect.repeatUntil.selector, context),
        );
  const selectionLimit = repeatCount ?? repeatUntilSelectionLimit;
  const activationCost =
    effect.activationCost === undefined
      ? undefined
      : numeric(effect.activationCost.amount, context, move.id);
  const activationMinimum =
    effect.activationCost?.minimum === undefined
      ? undefined
      : numeric(effect.activationCost.minimum, context, move.id);
  const selectedStartCombatCost = startCombatActivationCost(effect, move, target, trigger);
  if (
    (effect.repeatCount !== undefined &&
      (selectionLimit === undefined || !Number.isInteger(selectionLimit) || selectionLimit < 1)) ||
    (effect.repeatUntil !== undefined &&
      (target !== "self" ||
        selectionLimit === undefined ||
        !Number.isInteger(selectionLimit) ||
        selectionLimit < 1)) ||
    (effect.activationCost !== undefined &&
      (activationCost === undefined ||
        activationCost < 0 ||
        (activationMinimum !== undefined && activationMinimum < 0) ||
        (effect.activationCost.minimum !== undefined && activationMinimum === undefined)))
  )
    return emptyEffectChanges();
  const resolvedActivationCost = activationCostApplication(
    activationCost,
    activationMinimum,
    selectedStartCombatCost,
  );
  return {
    ...emptyEffectChanges(),
    activations: [
      {
        trigger: trigger as ActivationApplication["trigger"],
        ...(effect.scope?.type === "next-phase"
          ? {
              scope: {
                type: "next-phase" as const,
                subject: effect.scope.subject,
                phase: effect.scope.phase,
              },
            }
          : {}),
        target,
        selector: effect.selector,
        optional: effect.optional === true,
        effectIndex,
        sourceCombatantId: context.self.id,
        ...(selectedStartCombatCost === undefined ? {} : { activationCostOverride: 0 }),
        ...(resolvedActivationCost === undefined ? {} : { activationCost: resolvedActivationCost }),
        ...(selectionLimit === undefined ? {} : { selectionLimit }),
        ...(effect.ignoreRequirements === true ? { reactivationOnly: true } : {}),
        sourceDefinitionId: move.id,
        sourceText: effect.sourceText,
      },
    ],
  };
};

const remainingUseModificationEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "modify-remaining-uses" }>,
  move: MoveDefinition,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
): EffectChanges => {
  const amount = numeric(effect.amount, context);
  return amount === undefined
    ? emptyEffectChanges()
    : {
        ...emptyEffectChanges(),
        remainingUseModifications: [
          {
            sourceCombatantId: context.self.id,
            sourceDefinitionId: move.id,
            target,
            amount,
            selector: effect.selector,
          },
        ],
      };
};

const moveUsePreventionEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "prevent-move-use" }>,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
): EffectChanges => {
  const duration = lockDuration(effect.duration, context);
  return duration === undefined
    ? emptyEffectChanges()
    : {
        ...emptyEffectChanges(),
        moveUsePreventions: [
          {
            target,
            operation: effect.operation ?? "use",
            ...(effect.selector === undefined ? {} : { selector: effect.selector }),
            ...(effect.stacking === undefined ? {} : { stacking: effect.stacking }),
            duration,
          },
        ],
      };
};

const statusPreventionEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "prevent-status" }>,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
): EffectChanges => {
  const duration = lockDuration(effect.duration, context);
  return duration === undefined
    ? emptyEffectChanges()
    : {
        ...emptyEffectChanges(),
        statusPreventions: [{ target, statusId: effect.statusId, duration }],
      };
};

const rollModificationPreventionEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "prevent-roll-modification" }>,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
): EffectChanges => {
  const scopeCount =
    effect.duration === undefined && effect.scope?.type === "next-actions"
      ? numeric(effect.scope.count, context)
      : undefined;
  const duration =
    scopeCount === undefined
      ? lockDuration(effect.duration, context)
      : { type: "next-actions" as const, remaining: Math.max(1, scopeCount) };
  return duration === undefined
    ? emptyEffectChanges()
    : {
        ...emptyEffectChanges(),
        rollModificationPreventions: [
          {
            target,
            roll: effect.roll,
            modifier: effect.modifier,
            ...(effect.selector === undefined ? {} : { selector: effect.selector }),
            duration,
          },
        ],
      };
};

const moveModificationPreventionEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "prevent-move-modification" }>,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
): EffectChanges => {
  const prevention = {
    target,
    actor: effect.actor,
    selector: effect.selector,
    aspects: effect.aspects,
    ...(effect.effectSourceStyleExcludes === undefined
      ? {}
      : { effectSourceStyleExcludes: effect.effectSourceStyleExcludes }),
    ...(effect.exceptSourceMoveIds === undefined
      ? {}
      : { exceptSourceMoveIds: effect.exceptSourceMoveIds }),
    ...(effect.exceptSourceStatusIds === undefined
      ? {}
      : { exceptSourceStatusIds: effect.exceptSourceStatusIds }),
    ...(effect.operations === undefined ? {} : { operations: effect.operations }),
  } satisfies CurrentActionMoveModificationPreventionApplication;
  if (effect.scope?.type === "current-action")
    return {
      ...emptyEffectChanges(),
      currentActionMoveModificationPreventions: [prevention],
    };
  const duration = lockDuration(effect.duration, context);
  return duration === undefined
    ? emptyEffectChanges()
    : {
        ...emptyEffectChanges(),
        moveModificationPreventions: [
          {
            ...prevention,
            ...(effect.scope?.type === "next-turn"
              ? { availableFromTurn: context.turnNumber + 1 }
              : {}),
            duration,
          },
        ],
      };
};

const rollModificationCapScope = (
  definition: NonNullable<Extract<EffectDefinition, { readonly type: "modify-roll" }>["cap"]>,
  modifier: "dice" | "result" | "sides",
  amountOmitted: boolean,
): "amount" | "total" | "roll" => {
  if (!amountOmitted) return "amount";
  if (definition.type === "allow-exceed") return "amount";
  return modifier === "sides" || modifier === "dice" ? "roll" : "total";
};

const rollModificationDuration = (
  duration: Extract<EffectDefinition, { readonly type: "modify-roll" }>["duration"],
  context: MoveEffectRuntimeContext,
): RollModification["duration"] => {
  if (duration === undefined) return undefined;
  if (duration.type === "combat") return { type: "combat" as const };
  if (duration.type !== "turns" && duration.type !== "turns-or-until-perfect-roll")
    return undefined;
  const turns = numeric(duration.turns, context);
  return turns === undefined || turns < 1 ? undefined : { type: duration.type, remaining: turns };
};

const resolvedRollModificationCap = (
  definition: Extract<EffectDefinition, { readonly type: "modify-roll" }>["cap"],
  context: MoveEffectRuntimeContext,
  modifier: "dice" | "result" | "sides",
  amountOmitted: boolean,
): RollModification["cap"] => {
  if (definition === undefined) return undefined;
  const scope = definition.scope ?? rollModificationCapScope(definition, modifier, amountOmitted);
  if (definition.type === "allow-exceed") return { type: definition.type, scope };
  const value = numeric(definition.value, context);
  if (value === undefined) return undefined;
  return { type: definition.type, scope, value };
};

const isResolvedRollModification = (
  amount: number | undefined,
  definition: Extract<EffectDefinition, { readonly type: "modify-roll" }>["cap"],
  cap: RollModification["cap"],
  countedScope: number | undefined,
): amount is number =>
  amount !== undefined &&
  !(definition !== undefined && cap === undefined) &&
  !(countedScope !== undefined && countedScope < 1);

const numericSelectionForEffect = (
  move: MoveDefinition,
  effect: Extract<EffectDefinition, { readonly type: "modify-roll" }>,
): PendingEffectChoice["numericSelection"] => {
  const expression = effect.amount;
  if (expression?.type !== "selected-dice-count") return undefined;
  const maximum = move.mechanics.attack?.attackRoll?.dice;
  return maximum === undefined ? undefined : { key: expression.selectionKey, minimum: 0, maximum };
};

const rollModificationEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "modify-roll" }>,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
): EffectChanges => {
  if (effect.amount === undefined && effect.cap === undefined) {
    return emptyEffectChanges();
  }
  const amount = effect.amount === undefined ? 0 : numeric(effect.amount, context);
  const multiplier = effect.multiplier === undefined ? 1 : numeric(effect.multiplier, context);
  const cap = resolvedRollModificationCap(
    effect.cap,
    context,
    effect.modifier,
    effect.amount === undefined,
  );
  const countedScope =
    effect.scope?.type === "next-actions" || effect.scope?.type === "next-rolls"
      ? numeric(effect.scope.count, context)
      : undefined;
  const duration = rollModificationDuration(effect.duration, context);
  if (
    !isResolvedRollModification(amount, effect.cap, cap, countedScope) ||
    (effect.duration !== undefined && duration === undefined) ||
    multiplier === undefined
  )
    return emptyEffectChanges();
  return {
    ...emptyEffectChanges(),
    rollModifications: [
      {
        target,
        roll: effect.roll,
        modifier: effect.modifier,
        amount: amount * multiplier,
        ...(effect.affectedDice === undefined ? {} : { affectedDice: effect.affectedDice }),
        ...(cap === undefined ? {} : { cap }),
        ...(effect.dieIndex === undefined ? {} : { dieIndex: effect.dieIndex }),
        ...(effect.selector === undefined ? {} : { selector: effect.selector }),
        ...(effect.scope?.type === "current-action" ||
        effect.scope?.type === "combat" ||
        effect.scope?.type === "following-action" ||
        effect.scope?.type === "next-action" ||
        effect.scope?.type === "next-actions" ||
        effect.scope?.type === "next-roll" ||
        effect.scope?.type === "next-rolls" ||
        effect.scope?.type === "next-phase" ||
        effect.scope?.type === "next-turn"
          ? { scope: effect.scope.type }
          : {}),
        ...(countedScope === undefined ? {} : { remaining: countedScope }),
        ...(duration === undefined ? {} : { duration }),
      },
    ],
  };
};

const rollModificationTransformerEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "modify-roll-modifier" }>,
  move: MoveDefinition,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
  effectIndex: number,
): EffectChanges => {
  const multiplier =
    effect.multiplier === undefined ? undefined : numeric(effect.multiplier, context, move.id);
  const increment =
    effect.increment === undefined ? undefined : numeric(effect.increment, context, move.id);
  if (!validRollModificationTransformerNumbers(effect, multiplier, increment))
    return emptyEffectChanges();
  const nextRoll = effect.scope?.type === "next-roll" ? effect.scope.roll : undefined;
  if (
    (nextRoll !== undefined && nextRoll !== "attack" && nextRoll !== "defense") ||
    (nextRoll === undefined && effect.duration !== undefined && effect.duration.type !== "combat")
  )
    return emptyEffectChanges();
  const duration =
    nextRoll === undefined ? "combat" : { type: "next-roll" as const, roll: nextRoll };
  return {
    ...emptyEffectChanges(),
    rollModificationTransformers: [
      {
        target,
        sourceDefinitionId: move.id,
        effectIndex,
        modifier: effect.modifier,
        ...(multiplier === undefined ? {} : { multiplier }),
        ...(increment === undefined ? {} : { increment }),
        ...(effect.excludeSourceCategories === undefined
          ? {}
          : { excludeSourceCategories: effect.excludeSourceCategories }),
        ...(effect.cap === undefined ? {} : { cap: effect.cap }),
        duration,
      },
    ],
  };
};

const validRollModificationTransformerNumbers = (
  effect: Extract<EffectDefinition, { readonly type: "modify-roll-modifier" }>,
  multiplier: number | undefined,
  increment: number | undefined,
) =>
  !(
    (effect.multiplier !== undefined && multiplier === undefined) ||
    (effect.increment !== undefined && increment === undefined) ||
    (multiplier === undefined && increment === undefined)
  );

const rollDefinitionEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "set-roll-definition" }>,
  target: "self" | "opponent",
): EffectChanges => ({
  ...emptyEffectChanges(),
  rollDefinitions: [
    {
      target,
      roll: effect.roll,
      ...(effect.dice === undefined ? {} : { dice: effect.dice }),
      sides: effect.sides,
    },
  ],
});

const rollSelectionEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "set-roll-selection" }>,
  move: MoveDefinition,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
  effectIndex: number,
): EffectChanges => {
  const diceCount = numeric(effect.diceCount, context, move.id);
  if (diceCount === undefined || !Number.isInteger(diceCount) || diceCount < 2)
    return emptyEffectChanges();
  const scope = effect.scope?.type;
  if (scope !== "current-action" && scope !== "next-roll") return emptyEffectChanges();
  if (scope === "next-roll" && effect.scope.roll !== effect.roll) return emptyEffectChanges();
  return {
    ...emptyEffectChanges(),
    rollSelections: [
      {
        target,
        sourceDefinitionId: move.id,
        effectIndex,
        roll: effect.roll,
        diceCount,
        selection: effect.selection,
        ...(effect.selector === undefined ? {} : { selector: effect.selector }),
        scope,
      },
    ],
  };
};

const rollResultEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "set-roll-result" }>,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
): EffectChanges => {
  const value = numeric(effect.value, context);
  return value === undefined
    ? emptyEffectChanges()
    : {
        ...emptyEffectChanges(),
        rollResultOverrides: [
          { target, roll: effect.roll, value, resultScope: effect.resultScope },
        ],
      };
};

const combatResultEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "set-combat-result" }>,
  target: "self" | "opponent",
): EffectChanges => {
  const selector = effect.conditions?.find(
    (condition): condition is MoveSelectorCondition => condition.type === "move-selector",
  );
  return {
    ...emptyEffectChanges(),
    combatResultOverrides: [
      {
        target,
        result: effect.result,
        resultScope: effect.resultScope,
        ...(effect.scope?.type === "next-action" ? { scope: "next-action" as const } : {}),
        ...(selector === undefined ? {} : { selector }),
      },
    ],
  };
};

const resolutionThresholdDuration = (
  effect: Extract<EffectDefinition, { readonly type: "set-resolution-threshold" }>,
  context: MoveEffectRuntimeContext,
) => {
  if (effect.duration?.type === "combat") return { type: "combat" as const };
  if (effect.duration?.type !== "until-roll-threshold") return undefined;
  if (effect.duration.roll !== "attack" && effect.duration.roll !== "defense") return undefined;
  const threshold = numeric(effect.duration.value, context);
  if (threshold === undefined) return undefined;
  return {
    type: "until-roll-threshold" as const,
    roll: effect.duration.roll,
    comparison: effect.duration.comparison,
    value: threshold,
  };
};

const resolutionThresholdEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "set-resolution-threshold" }>,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
): EffectChanges => {
  const value = numeric(effect.value, context);
  const scope = effect.scope?.type;
  const duration = resolutionThresholdDuration(effect, context);
  return value === undefined ||
    (scope !== undefined && scope !== "current-action" && scope !== "next-action")
    ? emptyEffectChanges()
    : {
        ...emptyEffectChanges(),
        resolutionThresholds: [
          {
            target,
            outcome: effect.outcome === "stop" ? "stopped" : "successful",
            roll: effect.roll,
            comparison: effect.comparison,
            value,
            ...(effect.relativeTo === undefined ? {} : { relativeTo: effect.relativeTo }),
            ...(effect.relativeOperation === undefined
              ? {}
              : { relativeOperation: effect.relativeOperation }),
            resultScope: effect.resultScope ?? "current-attack",
            ...(effect.selector === undefined ? {} : { selector: effect.selector }),
            ...(scope === undefined ? {} : { scope }),
            ...(duration === undefined ? {} : { duration }),
          },
        ],
      };
};

const resolutionPreventionEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "prevent-resolution" }>,
  target: "self" | "opponent",
): EffectChanges => ({
  ...emptyEffectChanges(),
  resolutionPreventions: [{ target, prevention: effect.prevention }],
});

const combatResultPreventionEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "prevent-combat-result" }>,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
): EffectChanges => {
  const duration = lockDuration(effect.duration, context);
  return duration === undefined
    ? emptyEffectChanges()
    : {
        ...emptyEffectChanges(),
        combatResultPreventions: [
          {
            target,
            result: effect.result,
            ...(effect.selector === undefined ? {} : { selector: effect.selector }),
            duration,
          },
        ],
      };
};

const negateEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "negate" }>,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
  move: MoveDefinition,
  effectIndex: number,
): EffectChanges => {
  let useLimitCount: number | undefined;
  if (effect.useLimit !== undefined)
    useLimitCount =
      typeof effect.useLimit.count === "number"
        ? effect.useLimit.count
        : numeric(effect.useLimit.count, context);
  if (
    effect.useLimit !== undefined &&
    (useLimitCount === undefined || !Number.isInteger(useLimitCount) || useLimitCount < 1)
  )
    return emptyEffectChanges();
  const selector =
    effect.selector ??
    effect.conditions?.find(
      (
        condition,
      ): condition is Extract<
        NonNullable<EffectDefinition["conditions"]>[number],
        { type: "move-selector" }
      > => condition.type === "move-selector",
    );
  return {
    ...emptyEffectChanges(),
    negations: [
      {
        target,
        aspects: effect.aspects ?? [],
        ...(selector === undefined ? {} : { selector }),
        ...(effect.conditions === undefined
          ? {}
          : {
              combatOutcomes: effect.conditions.flatMap((condition) =>
                condition.type === "combat-outcome" ? [condition.outcome] : [],
              ),
            }),
        sourceDefinitionId: move.id,
        sourceEffectIndex: effectIndex,
        ...(effect.useLimit === undefined
          ? {}
          : { useLimit: { scope: effect.useLimit.scope, count: useLimitCount! } }),
      },
    ],
  };
};

const criticalThresholdEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "modify-critical-threshold" }>,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
): EffectChanges => {
  const threshold = numeric(effect.threshold, context);
  return target !== "self" || threshold === undefined
    ? emptyEffectChanges()
    : {
        ...emptyEffectChanges(),
        criticalThresholds: [
          {
            target,
            threshold,
            basis: effect.basis,
            ...(effect.selector === undefined ? {} : { selector: effect.selector }),
          },
        ],
      };
};

type RerollDurationResolution =
  | { readonly valid: true; readonly duration: RerollApplication["duration"] }
  | { readonly valid: false };

const rerollDuration = (
  effect: Extract<EffectDefinition, { readonly type: "reroll" }>,
  context: MoveEffectRuntimeContext,
): RerollDurationResolution => {
  if (effect.scope === undefined || effect.scope.type === "combat")
    return { valid: true, duration: "combat" };
  if (effect.scope.type === "next-action")
    return { valid: true, duration: { type: "next-action" } };
  if (effect.scope.type === "next-roll") {
    if (effect.scope.roll !== "attack" && effect.scope.roll !== "defense") return { valid: false };
    return { valid: true, duration: { type: "next-roll", roll: effect.scope.roll } };
  }
  if (effect.scope.type !== "next-rolls") return { valid: false };
  if (effect.scope.roll !== "attack" && effect.scope.roll !== "defense") return { valid: false };
  const remaining = numeric(effect.scope.count, context);
  if (remaining === undefined || !Number.isInteger(remaining) || remaining < 1)
    return { valid: false };
  return {
    valid: true,
    duration: { type: "next-rolls", roll: effect.scope.roll, remaining },
  };
};

const rerollUseLimitCount = (
  effect: Extract<EffectDefinition, { readonly type: "reroll" }>,
  context: MoveEffectRuntimeContext,
) => {
  if (effect.useLimit === undefined) return undefined;
  return typeof effect.useLimit.count === "number"
    ? effect.useLimit.count
    : numeric(effect.useLimit.count, context);
};

const resolvedRerollUseLimit = (
  effect: Extract<EffectDefinition, { readonly type: "reroll" }>,
  count: number | undefined,
) => {
  if (effect.useLimit === undefined || count === undefined) return undefined;
  return { scope: effect.useLimit.scope, count };
};

const rerollEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "reroll" }>,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
  move: MoveDefinition,
  effectIndex: number,
): EffectChanges => {
  const bonusExpression = effect.bonus ?? effect.resultModifier;
  const bonus = bonusExpression === undefined ? 0 : numeric(bonusExpression, context);
  const useLimitCount = rerollUseLimitCount(effect, context);
  const activationCost =
    effect.activationCost === undefined
      ? undefined
      : numeric(effect.activationCost.amount, context);
  const resolvedUseLimit = resolvedRerollUseLimit(effect, useLimitCount);
  if (
    bonus === undefined ||
    (effect.useLimit !== undefined && useLimitCount === undefined) ||
    (resolvedUseLimit !== undefined && resolvedUseLimit.count < 1) ||
    (activationCost === undefined && effect.activationCost !== undefined)
  )
    return emptyEffectChanges();
  const duration = rerollDuration(effect, context);
  if (!duration.valid) return emptyEffectChanges();
  return {
    ...emptyEffectChanges(),
    rerolls: [
      {
        sourceDefinitionId: move.id,
        effectIndex,
        target,
        roll: effect.roll,
        rerollScope: effect.rerollScope ?? "single-result",
        ...(effect.selector === undefined ? {} : { selector: effect.selector }),
        resultModifier: bonus,
        bonus,
        conditions: effect.conditions,
        optional: effect.optional === true,
        ...(effect.activationCost === undefined
          ? {}
          : { activationResource: effect.activationCost.resource }),
        duration: duration.duration,
        ...(resolvedUseLimit === undefined ? {} : { useLimit: resolvedUseLimit }),
        ...(activationCost === undefined ? {} : { activationCost }),
      },
    ],
  };
};

const triggeredEffectHandlers: Partial<Record<EffectDefinition["type"], TriggeredEffectHandler>> = {
  activate: (effect, move, context, target, trigger, effectIndex) =>
    activationEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "activate" }>,
      move,
      context,
      target,
      trigger,
      effectIndex,
    ),
  "roll-and-store": (effect, move, context, target, _trigger, effectIndex) =>
    rollAndStoreEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "roll-and-store" }>,
      move,
      context,
      target,
      effectIndex,
    ),
  "create-floating-effect": (effect, _move, context, target, _trigger, effectIndex) =>
    floatingEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "create-floating-effect" }>,
      context,
      target,
      effectIndex,
    ),
  "grant-extra-action": (effect, move, context, target, trigger, effectIndex) =>
    extraActionEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "grant-extra-action" }>,
      move,
      context,
      target,
      trigger,
      effectIndex,
    ),
  "schedule-effect": (effect, _move, context, target, _trigger, effectIndex) =>
    scheduledResourceEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "schedule-effect" }>,
      context,
      target,
      effectIndex,
    ),
  "modify-damage": (effect, move, context, target, _trigger, effectIndex) =>
    damageModificationEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "modify-damage" }>,
      move,
      context,
      target,
      effectIndex,
    ),
  "modify-critical-threshold": (effect, _move, context, target) =>
    criticalThresholdEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "modify-critical-threshold" }>,
      context,
      target,
    ),
  "modify-stat": (effect, _move, context, target) =>
    statModificationEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "modify-stat" }>,
      context,
      target,
    ),
  "modify-slot-capacity": (effect, move, context, target, _trigger, effectIndex) =>
    slotCapacityModificationEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "modify-slot-capacity" }>,
      move,
      context,
      target,
      effectIndex,
    ),
  suppress: (effect, _move, context, target, trigger) =>
    suppressionEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "suppress" }>,
      context,
      target,
      trigger,
    ),
  "modify-cost": (effect, move, context, target, trigger, effectIndex) =>
    costModificationEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "modify-cost" }>,
      move,
      context,
      target,
      trigger,
      effectIndex,
    ),
  "modify-resource": (effect, move, context, target, _trigger, effectIndex) =>
    resourceEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "modify-resource" }>,
      move,
      context,
      target,
      effectIndex,
    ),
  "modify-resource-cost": (effect, move, context, target, _trigger, effectIndex) =>
    resourceCostModifierChanges(
      effect as Extract<EffectDefinition, { readonly type: "modify-resource-cost" }>,
      move,
      context,
      target,
      effectIndex,
    ),
  "modify-roll-modifier": (effect, move, context, target, _trigger, effectIndex) =>
    rollModificationTransformerEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "modify-roll-modifier" }>,
      move,
      context,
      target,
      effectIndex,
    ),
  "modify-remaining-uses": (effect, move, context, target) =>
    remainingUseModificationEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "modify-remaining-uses" }>,
      move,
      context,
      target,
    ),
  "force-action": (effect, _move, _context, target) =>
    forcedActionEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "force-action" }>,
      target,
    ),
  "select-move-by-stored-roll": (effect, move, _context, target, _trigger, effectIndex) =>
    selectMoveByStoredRollEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "select-move-by-stored-roll" }>,
      move,
      target,
      effectIndex,
    ),
  "skip-action": (effect, _move, context, target, _trigger, effectIndex) =>
    actionRestrictionEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "skip-action" }>,
      context,
      target,
      effectIndex,
    ),
  "remove-move-from-combat": (effect, _move, _context, target, _trigger, effectIndex) =>
    moveRemovalEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "remove-move-from-combat" }>,
      target,
      effectIndex,
    ),
  lock: (effect, _move, context, target) =>
    lockEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "lock" }>,
      context,
      target,
    ),
  deactivate: (effect, move, context, target) =>
    deactivationEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "deactivate" }>,
      move,
      context,
      target,
    ),
  "prevent-move-use": (effect, _move, context, target) =>
    moveUsePreventionEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "prevent-move-use" }>,
      context,
      target,
    ),
  "prevent-status": (effect, _move, context, target) =>
    statusPreventionEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "prevent-status" }>,
      context,
      target,
    ),
  "prevent-roll-modification": (effect, _move, context, target) =>
    rollModificationPreventionEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "prevent-roll-modification" }>,
      context,
      target,
    ),
  "prevent-move-modification": (effect, _move, context, target) =>
    moveModificationPreventionEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "prevent-move-modification" }>,
      context,
      target,
    ),
  "prevent-resource-modification": (effect, _move, context, target) =>
    resourceModificationPreventionEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "prevent-resource-modification" }>,
      context,
      target,
    ),
  "modify-roll": (effect, _move, context, target) =>
    rollModificationEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "modify-roll" }>,
      context,
      target,
    ),
  "set-roll-definition": (effect, _move, _context, target) =>
    rollDefinitionEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "set-roll-definition" }>,
      target,
    ),
  "set-roll-selection": (effect, move, context, target, _trigger, effectIndex) =>
    rollSelectionEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "set-roll-selection" }>,
      move,
      context,
      target,
      effectIndex,
    ),
  "set-roll-result": (effect, _move, context, target) =>
    rollResultEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "set-roll-result" }>,
      context,
      target,
    ),
  "set-combat-result": (effect, _move, _context, target) =>
    combatResultEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "set-combat-result" }>,
      target,
    ),
  "set-resolution-threshold": (effect, _move, context, target) =>
    resolutionThresholdEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "set-resolution-threshold" }>,
      context,
      target,
    ),
  "prevent-resolution": (effect, _move, _context, target) =>
    resolutionPreventionEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "prevent-resolution" }>,
      target,
    ),
  "prevent-combat-result": (effect, _move, context, target) =>
    combatResultPreventionEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "prevent-combat-result" }>,
      context,
      target,
    ),
  negate: (effect, move, context, target, _trigger, effectIndex) =>
    negateEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "negate" }>,
      context,
      target,
      move,
      effectIndex,
    ),
  reroll: (effect, move, context, target, _trigger, effectIndex) =>
    rerollEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "reroll" }>,
      context,
      target,
      move,
      effectIndex,
    ),
  "apply-status": (effect, move, context, target) =>
    statusEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "apply-status" }>,
      move,
      context,
      target,
    ),
  "grant-combat-outcome": (effect, move, context, target) =>
    combatOutcomeEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "grant-combat-outcome" }>,
      move,
      context,
      target,
    ),
  "grant-counter-action": (effect, move, context, target, _trigger, effectIndex) =>
    counterActionEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "grant-counter-action" }>,
      move,
      context,
      target,
      effectIndex,
    ),
};

const triggeredEffectChanges = (
  effect: EffectDefinition,
  move: MoveDefinition,
  context: MoveEffectRuntimeContext,
  trigger:
    | "action-phase"
    | "after-defense-roll"
    | "before-attack-roll"
    | "before-defense-roll"
    | "passive"
    | "on-stopped"
    | "on-success"
    | "on-combat-result"
    | "on-damage"
    | "on-deactivated"
    | "on-move-use"
    | "on-cost-modified"
    | "on-power-up"
    | "on-resource-gain"
    | "on-resource-drain"
    | "on-resource-threshold"
    | "on-roll-modified"
    | "on-roll-result"
    | "start-combat"
    | "upkeep-phase",
  target: "self" | "opponent",
  effectIndex: number,
) => {
  if (
    effect.trigger !== trigger ||
    (effect.optional === true &&
      effect.type !== "reroll" &&
      !context.enabledOptionalEffectIndices?.includes(effectIndex) &&
      !(
        context.collectPendingChoices === true &&
        (trigger === "on-success" || trigger === "start-combat" || trigger === "on-roll-result") &&
        effect.type === "activate"
      )) ||
    (effect.activationGroup !== undefined &&
      effect.type !== "reroll" &&
      !context.enabledOptionalEffectIndices?.includes(effectIndex) &&
      !(
        context.collectPendingChoices === true &&
        (trigger === "on-success" || trigger === "start-combat" || trigger === "on-roll-result") &&
        effect.type === "activate"
      )) ||
    ((trigger === "on-resource-gain" || trigger === "on-resource-drain") &&
      !effect.conditions?.some((condition) => condition.type === "resource-change") &&
      context.resourceChange?.subject !== target) ||
    (trigger === "on-resource-threshold" &&
      (context.previousResourceState === undefined ||
        !effect.conditions?.some(
          (condition) =>
            condition.type === "resource-threshold" &&
            !resourceThresholdMatches(condition, {
              ...context,
              self: context.previousResourceState!.self,
              opponent: context.previousResourceState!.opponent,
            }) &&
            resourceThresholdMatches(condition, context),
        ))) ||
    !effectMatches(effect, context)
  ) {
    return emptyEffectChanges();
  }
  const handler = triggeredEffectHandlers[effect.type];
  return handler === undefined
    ? emptyEffectChanges()
    : handler(effect, move, context, target, trigger, effectIndex);
};

const moveEffectsSuppressed = (
  move: MoveDefinition,
  trigger: Parameters<typeof moveEffectsForTriggerInternal>[1],
  context: MoveEffectRuntimeContext,
) =>
  (context.resolutionSuppressions ?? []).some(
    (effect) =>
      effect.target === "self" &&
      (effect.aspects.includes("all-effects") ||
        (trigger === "on-success" && effect.aspects.includes("successful-effects"))) &&
      (effect.selector === undefined || matchesMoveSelector(move, effect.selector)),
  ) ||
  (context.activeEffects ?? []).some(
    (effect) =>
      effect.type === "suppress" &&
      effect.targetCombatantId === context.self.id &&
      (effect.duration.type !== "following-action" || effect.duration.remaining <= 1) &&
      (effect.aspects.includes("all-effects") ||
        (trigger === "on-success" && effect.aspects.includes("successful-effects"))) &&
      (effect.selector === undefined || matchesMoveSelector(move, effect.selector)),
  );

/**
 * Resolves only rerolls accepted by the compiled executor. Optionality is
 * retained for the serialized post-defense decision instead of being treated
 * as an automatic effect.
 */
export const rerollEffectsAfterDefense = (
  move: MoveDefinition,
  context: MoveEffectRuntimeContext,
): readonly RerollApplication[] => {
  if (moveEffectsSuppressed(move, "after-defense-roll", context)) return [];
  return (move.effects ?? []).flatMap((effect, effectIndex) => {
    const compiled = compileEffectPlan({ sourceDefinitionId: move.id, effectIndex, effect });
    if (!compiled.ok || compiled.value.type !== "reroll") return [];
    const resolved = executeCompiledEffect(compiled.value, { move, target: "self" });
    if (
      resolved.effect.type !== "reroll" ||
      resolved.effect.trigger !== "after-defense-roll" ||
      resolved.effect.target !== "self" ||
      !effectMatches(resolved.effect, context)
    )
      return [];
    const resultModifierExpression = resolved.effect.resultModifier ?? resolved.effect.bonus;
    const resultModifier =
      resultModifierExpression === undefined ? 0 : numeric(resultModifierExpression, context);
    if (resultModifier === undefined) return [];
    let useLimitCount: number | undefined;
    if (resolved.effect.useLimit !== undefined)
      useLimitCount =
        typeof resolved.effect.useLimit.count === "number"
          ? resolved.effect.useLimit.count
          : numeric(resolved.effect.useLimit.count, context);
    if (resolved.effect.useLimit !== undefined && useLimitCount === undefined) return [];
    return [
      {
        target: "self" as const,
        sourceDefinitionId: move.id,
        effectIndex,
        trigger: "after-defense-roll" as const,
        roll: resolved.effect.roll,
        rerollScope: resolved.effect.rerollScope ?? "single-result",
        resultModifier,
        conditions: resolved.effect.conditions,
        optional: resolved.effect.optional === true,
        duration: "combat" as const,
        ...(resolved.effect.selector === undefined ? {} : { selector: resolved.effect.selector }),
        ...(resolved.effect.useLimit?.scope === "combat" && useLimitCount !== undefined
          ? {
              useLimit: {
                scope: "combat" as const,
                count: useLimitCount,
              },
            }
          : {}),
        ...(resolved.effect.requiresPriorSourceResult === undefined
          ? {}
          : { requiresPriorSourceResult: resolved.effect.requiresPriorSourceResult }),
      },
    ];
  });
};

export interface CurrentActionMoveClassification {
  readonly move: MoveDefinition;
  readonly addedTags: ReadonlyArray<MoveDefinition["tags"][number]>;
}

/** Resolves an intrinsic additive classification for the move being performed. */
export const classifyCurrentActionMove = (
  move: MoveDefinition,
  context: MoveEffectRuntimeContext,
): CurrentActionMoveClassification => {
  if (moveEffectsSuppressed(move, "passive", context)) return { move, addedTags: [] };
  const addedTags = (move.effects ?? []).flatMap((effect, effectIndex) => {
    const compiled = compileEffectPlan({ sourceDefinitionId: move.id, effectIndex, effect });
    if (!compiled.ok || compiled.value.type !== "modify-move-classification") return [];
    const resolved = executeCompiledEffect(compiled.value, { move, target: "self" });
    if (
      resolved.effect.type !== "modify-move-classification" ||
      resolved.effect.trigger !== "passive" ||
      resolved.effect.target !== "self" ||
      resolved.effect.scope?.type !== "current-action" ||
      resolved.effect.addTags === undefined
    )
      return [];
    return resolved.effect.addTags.map(
      (tag) => tag.toLowerCase() as MoveDefinition["tags"][number],
    );
  });
  const uniqueAddedTags = [...new Set(addedTags)];
  if (uniqueAddedTags.length === 0) return { move, addedTags: [] };
  return {
    move: { ...move, tags: [...new Set([...move.tags, ...uniqueAddedTags])] },
    addedTags: uniqueAddedTags,
  };
};

/**
 * Resolves the exact stored-roll-match rerolls that may be offered after a
 * persisted attack or defense die. The listener remains a catalog definition;
 * use limits are consumed by the transition that accepts the choice.
 */
export const rerollEffectsOnRollResult = (
  move: MoveDefinition,
  context: MoveEffectRuntimeContext,
): readonly RerollApplication[] => {
  if (moveEffectsSuppressed(move, "on-roll-result", context)) return [];
  return (move.effects ?? []).flatMap((effect, effectIndex) => {
    const compiled = compileEffectPlan({
      sourceDefinitionId: move.id,
      effectIndex,
      effect,
      allowPendingChoice: true,
    });
    if (!compiled.ok || compiled.value.type !== "reroll") return [];
    const resolved = executeCompiledEffect(compiled.value, { move, target: "self" });
    const condition = resolved.effect.conditions?.[0];
    if (
      resolved.effect.type !== "reroll" ||
      resolved.effect.trigger !== "on-roll-result" ||
      resolved.effect.target !== "self" ||
      resolved.effect.conditions?.length !== 1 ||
      condition?.type !== "stored-roll-match" ||
      condition.roll !== resolved.effect.roll ||
      condition.natural !== true ||
      resolved.effect.scope !== undefined ||
      resolved.effect.duration !== undefined ||
      resolved.effect.useLimit?.scope !== "combat" ||
      resolved.effect.activationCost !== undefined ||
      !effectMatches(resolved.effect, context)
    )
      return [];
    const resultModifierExpression = resolved.effect.resultModifier ?? resolved.effect.bonus;
    const resultModifier =
      resultModifierExpression === undefined ? 0 : numeric(resultModifierExpression, context);
    const useLimitCount =
      resolved.effect.useLimit === undefined
        ? undefined
        : typeof resolved.effect.useLimit.count === "number"
          ? resolved.effect.useLimit.count
          : numeric(resolved.effect.useLimit.count, context);
    if (
      resultModifier === undefined ||
      useLimitCount === undefined ||
      !Number.isInteger(useLimitCount) ||
      useLimitCount < 1
    )
      return [];
    return [
      {
        target: "self" as const,
        sourceDefinitionId: move.id,
        effectIndex,
        trigger: "on-roll-result" as const,
        roll: resolved.effect.roll,
        rerollScope: resolved.effect.rerollScope ?? "single-result",
        resultModifier,
        conditions: resolved.effect.conditions,
        optional: resolved.effect.optional === true,
        duration: "combat" as const,
        useLimit: { scope: "combat" as const, count: useLimitCount },
      },
    ];
  });
};

const moveEffectsForTriggerInternal = (
  move: MoveDefinition,
  trigger:
    | "action-phase"
    | "after-defense-roll"
    | "before-attack-roll"
    | "before-defense-roll"
    | "passive"
    | "on-stopped"
    | "on-success"
    | "on-combat-result"
    | "on-damage"
    | "on-deactivated"
    | "on-move-use"
    | "on-cost-modified"
    | "on-power-up"
    | "on-resource-gain"
    | "on-resource-drain"
    | "on-resource-threshold"
    | "on-roll-modified"
    | "on-roll-result"
    | "start-combat"
    | "upkeep-phase",
  context: MoveEffectRuntimeContext,
  includeActiveFloatingEffects: boolean,
  allowFloatingOnMoveUse = false,
): {
  readonly resources: readonly ResourceChange[];
  readonly resourceActionModifiers: readonly ResourceActionModifierApplication[];
  readonly resourceCostModifications: readonly ResourceCostModifierApplication[];
  readonly storedRollRequests: readonly StoredRollRequest[];
  readonly storedMoveSelectionRequests: readonly StoredMoveSelectionRequest[];
  readonly statuses: readonly StatusApplication[];
  readonly extraActions: readonly ExtraActionApplication[];
  readonly counterActions: readonly CounterActionApplication[];
  readonly scheduledResources: readonly ScheduledResourceApplication[];
  readonly damageModifications: readonly DamageModification[];
  readonly statModifications: readonly StatModification[];
  readonly suppressions: readonly SuppressionApplication[];
  readonly forcedActions: readonly ForcedActionApplication[];
  readonly actionRestrictions: readonly ActionRestrictionApplication[];
  readonly moveRemovals: readonly MoveRemovalApplication[];
  readonly activations: readonly ActivationApplication[];
  readonly locks: readonly LockApplication[];
  readonly deactivations: readonly DeactivationApplication[];
  readonly floatingEffects: readonly FloatingEffectApplication[];
  readonly moveUsePreventions: readonly MoveUsePreventionApplication[];
  readonly remainingUseModifications: readonly RemainingUseModificationApplication[];
  readonly statusPreventions: readonly StatusPreventionApplication[];
  readonly rollModifications: readonly RollModification[];
  readonly rollModificationTransformers: readonly RollModificationTransformerApplication[];
  readonly rollSelections: readonly RollSelectionApplication[];
  readonly rollDefinitions: readonly RollDefinitionOverride[];
  readonly rollResultOverrides: readonly RollResultOverride[];
  readonly combatResultOverrides: readonly CombatResultOverrideApplication[];
  readonly criticalThresholds: readonly CriticalThresholdApplication[];
  readonly resolutionThresholds: readonly ResolutionThresholdApplication[];
  readonly resolutionPreventions: readonly ResolutionPreventionApplication[];
  readonly combatResultPreventions: readonly CombatResultPreventionApplication[];
  readonly rollModificationPreventions: readonly RollModificationPreventionApplication[];
  readonly moveModificationPreventions: readonly MoveModificationPreventionApplication[];
  readonly currentActionMoveModificationPreventions: readonly CurrentActionMoveModificationPreventionApplication[];
  readonly resourceModificationPreventions: readonly ResourceModificationPreventionApplication[];
  readonly costModifications: readonly CostModification[];
  readonly currentActionCostModifications: readonly CurrentActionCostModification[];
  readonly slotCapacityModifications: readonly SlotCapacityModificationApplication[];
  readonly rerolls: readonly RerollApplication[];
  readonly negations: readonly NegationApplication[];
  readonly pendingEffectChoices: readonly PendingEffectChoice[];
  // eslint-disable-next-line sonarjs/cognitive-complexity
} => {
  if (moveEffectsSuppressed(move, trigger, context))
    return { ...emptyEffectChanges(), pendingEffectChoices: [] };
  const resources: ResourceChange[] = [];
  const resourceActionModifiers: ResourceActionModifierApplication[] = [];
  const resourceCostModifications: ResourceCostModifierApplication[] = [];
  const storedRollRequests: StoredRollRequest[] = [];
  const storedMoveSelectionRequests: StoredMoveSelectionRequest[] = [];
  const statuses: StatusApplication[] = [];
  const extraActions: ExtraActionApplication[] = [];
  const counterActions: CounterActionApplication[] = [];
  const scheduledResources: ScheduledResourceApplication[] = [];
  const damageModifications: DamageModification[] = [];
  const statModifications: StatModification[] = [];
  const suppressions: SuppressionApplication[] = [];
  const forcedActions: ForcedActionApplication[] = [];
  const actionRestrictions: ActionRestrictionApplication[] = [];
  const moveRemovals: MoveRemovalApplication[] = [];
  const activations: ActivationApplication[] = [];
  const locks: LockApplication[] = [];
  const deactivations: DeactivationApplication[] = [];
  const floatingEffects: FloatingEffectApplication[] = [];
  const moveUsePreventions: MoveUsePreventionApplication[] = [];
  const remainingUseModifications: RemainingUseModificationApplication[] = [];
  const statusPreventions: StatusPreventionApplication[] = [];
  const rollModifications: RollModification[] = [];
  const rollModificationTransformers: RollModificationTransformerApplication[] = [];
  const rollSelections: RollSelectionApplication[] = [];
  const rollDefinitions: RollDefinitionOverride[] = [];
  const rollResultOverrides: RollResultOverride[] = [];
  const combatResultOverrides: CombatResultOverrideApplication[] = [];
  const criticalThresholds: CriticalThresholdApplication[] = [];
  const resolutionThresholds: ResolutionThresholdApplication[] = [];
  const resolutionPreventions: ResolutionPreventionApplication[] = [];
  const combatResultPreventions: CombatResultPreventionApplication[] = [];
  const rollModificationPreventions: RollModificationPreventionApplication[] = [];
  const moveModificationPreventions: MoveModificationPreventionApplication[] = [];
  const currentActionMoveModificationPreventions: CurrentActionMoveModificationPreventionApplication[] =
    [];
  const resourceModificationPreventions: ResourceModificationPreventionApplication[] = [];
  const costModifications: CostModification[] = [];
  const currentActionCostModifications: CurrentActionCostModification[] = [];
  const slotCapacityModifications: SlotCapacityModificationApplication[] = [];
  const rerolls: RerollApplication[] = [];
  const negations: NegationApplication[] = [];
  const pendingEffectChoices: PendingEffectChoice[] = [];
  const enabledEffectIndices = new Set(context.enabledOptionalEffectIndices ?? []);
  const resolvedEffectIndices = new Set(context.resolvedOptionalEffectIndices ?? []);
  const choiceGroups = new Map<string, readonly number[]>();
  if (
    context.collectPendingChoices === true &&
    (trigger === "before-attack-roll" ||
      trigger === "before-defense-roll" ||
      trigger === "after-defense-roll" ||
      trigger === "on-success" ||
      trigger === "on-damage" ||
      trigger === "on-move-use" ||
      trigger === "on-cost-modified" ||
      trigger === "on-power-up" ||
      trigger === "on-roll-result")
  ) {
    for (const [effectIndex, effect] of (move.effects ?? []).entries()) {
      if (
        effect.trigger !== trigger ||
        (effect.optional !== true &&
          effect.activationGroup === undefined &&
          effect.exclusiveActivationGroup === undefined)
      )
        continue;
      const key =
        effect.activationGroup ?? effect.exclusiveActivationGroup ?? `effect:${effectIndex}`;
      const indices = [...(choiceGroups.get(key) ?? []), effectIndex];
      choiceGroups.set(key, indices);
    }
    for (const [key, effectIndices] of choiceGroups) {
      const supportedOnSuccessChoice =
        trigger !== "on-success" ||
        (() => {
          const effects = effectIndices.flatMap((effectIndex) => {
            const effect = move.effects?.[effectIndex];
            return effect === undefined ? [] : [effect];
          });
          const damageReplacement = effects.some(
            (effect) =>
              effect.type === "modify-damage" &&
              effect.target === "self" &&
              effect.operation === "set" &&
              effect.scope?.type === "current-action",
          );
          const orangeBurstGroup =
            damageReplacement &&
            effects.every(
              (effect) => effect.type === "modify-damage" || effect.type === "deactivate",
            );
          const extraActionGroup =
            effects.some((effect) => effect.type === "grant-extra-action") &&
            effects.every(
              (effect) =>
                (effect.type === "grant-extra-action" &&
                  effect.target === "self" &&
                  effect.phase === "action-phase" &&
                  (effect.scope === undefined ||
                    effect.scope.type === "current-action" ||
                    effect.scope.type === "next-turn") &&
                  effect.activationCost === undefined) ||
                (effect.type === "modify-cost" &&
                  effect.target === "self" &&
                  effect.operation === "add" &&
                  effect.scope?.type === "next-actions" &&
                  effect.selector === undefined),
            );
          const rerollGroup = effects.every(
            (effect) =>
              effect.type === "reroll" &&
              effect.target !== undefined &&
              (effect.scope?.type === "next-action" ||
                effect.scope?.type === "next-roll" ||
                effect.scope?.type === "next-rolls"),
          );
          const resourceCostGroup =
            effects.length > 0 &&
            effects.every(
              (effect) =>
                effect.type === "modify-resource-cost" &&
                effect.target === "self" &&
                effect.scope?.type === "next-action" &&
                effect.stacking === "prevent" &&
                effect.selector.subject === "source" &&
                effect.selector.effectKinds?.length === 1 &&
                effect.selector.effectKinds[0] === "resource-loss",
            );
          return orangeBurstGroup || extraActionGroup || rerollGroup || resourceCostGroup;
        })();
      if (!supportedOnSuccessChoice) continue;
      const supportedOnDamageChoice =
        trigger !== "on-damage" ||
        effectIndices.every((effectIndex) => {
          const effect = move.effects![effectIndex]!;
          return (
            effect.type === "modify-damage" &&
            effect.target === "opponent" &&
            effect.operation === "add" &&
            (effect.scope === undefined || effect.scope.type === "current-action") &&
            effect.activationCost !== undefined &&
            effect.useLimit?.scope === "combat"
          );
        });
      if (!supportedOnDamageChoice) continue;
      const supportedOnPowerUpChoice =
        trigger !== "on-power-up" ||
        effectIndices.every((effectIndex) => {
          const effect = move.effects![effectIndex]!;
          return (
            effect.type === "modify-damage" &&
            effect.target === "self" &&
            effect.operation === "add" &&
            effect.scope?.type === "next-action" &&
            effect.selector !== undefined &&
            effect.activationCost?.resource === "ki" &&
            effect.activationCost.operation === "lose" &&
            effect.useLimit === undefined
          );
        });
      if (!supportedOnPowerUpChoice) continue;
      const supportedBeforeDefenseChoice =
        trigger !== "before-defense-roll" ||
        effectIndices.every((effectIndex) => {
          const effect = move.effects![effectIndex]!;
          return (
            effect.type === "reroll" &&
            effect.target === "opponent" &&
            effect.roll === "attack" &&
            (effect.rerollScope === undefined || effect.rerollScope === "single-result") &&
            effect.scope?.type === "next-rolls" &&
            effect.scope.roll === "attack" &&
            effect.duration === undefined &&
            effect.activationCost === undefined &&
            effect.conditions === undefined &&
            effect.optional === true
          );
        });
      if (!supportedBeforeDefenseChoice) continue;
      const supportedOnMoveUseCostChoice =
        trigger !== "on-move-use" ||
        effectIndices.every((effectIndex) => {
          const effect = move.effects![effectIndex]!;
          return (
            effect.type === "modify-cost" &&
            effect.target === "self" &&
            effect.selector !== undefined &&
            (effect.scope === undefined || effect.scope.type === "current-action") &&
            effect.duration === undefined &&
            effect.useLimit === undefined &&
            effect.cooldown === undefined &&
            effect.stacking === undefined &&
            effect.activationCost !== undefined
          );
        });
      if (!supportedOnMoveUseCostChoice) continue;
      const supportedOnCostModifiedChoice =
        trigger !== "on-cost-modified" ||
        effectIndices.every((effectIndex) => {
          const effect = move.effects![effectIndex]!;
          return (
            effect.type === "modify-cost" &&
            effect.target === "self" &&
            (effect.scope === undefined || effect.scope.type === "current-action") &&
            effect.duration === undefined &&
            effect.useLimit === undefined &&
            effect.cooldown === undefined &&
            effect.stacking === undefined
          );
        });
      if (!supportedOnCostModifiedChoice) continue;
      const choiceEffects = effectIndices.map((effectIndex) => move.effects![effectIndex]!);
      const exclusiveChoice =
        effectIndices.length > 1 &&
        choiceEffects.every((effect) => effect.exclusiveActivationGroup !== undefined);
      const alternatives =
        exclusiveChoice ||
        (effectIndices.length > 1 &&
          effectIndices.every((effectIndex) => move.effects![effectIndex]!.optional === true))
          ? effectIndices.map((effectIndex) => [effectIndex])
          : [effectIndices];
      for (const alternative of alternatives) {
        if (!alternative.some((effectIndex) => effectMatches(move.effects![effectIndex]!, context)))
          continue;
        if (alternative.some((effectIndex) => resolvedEffectIndices.has(effectIndex))) continue;
        const plans = alternative.map((effectIndex) =>
          compileEffectPlan({
            sourceDefinitionId: move.id,
            effectIndex,
            effect: move.effects![effectIndex]!,
            allowPendingChoice: true,
          }),
        );
        if (!plans.every((plan) => plan.ok)) continue;
        const activationGroup = key.startsWith("effect:") ? undefined : key;
        const numericSelection = alternative
          .map((effectIndex) => {
            const effect = move.effects![effectIndex]!;
            return effect.type === "modify-roll"
              ? numericSelectionForEffect(move, effect)
              : undefined;
          })
          .find((selection) => selection !== undefined);
        pendingEffectChoices.push({
          sourceDefinitionId: move.id,
          effectIndices: alternative,
          ...(activationGroup === undefined ? {} : { activationGroup }),
          ...(numericSelection === undefined ? {} : { numericSelection }),
        });
      }
    }
  }
  for (const [effectIndex, effect] of (move.effects ?? []).entries()) {
    const isChoiceEffect =
      (effect.optional === true ||
        effect.activationGroup !== undefined ||
        effect.exclusiveActivationGroup !== undefined) &&
      !(effect.type === "reroll" && effect.trigger === "after-defense-roll");
    const collectActivationChoice =
      context.collectPendingChoices === true &&
      (trigger === "on-success" || trigger === "start-combat" || trigger === "on-roll-result") &&
      effect.type === "activate";
    if (isChoiceEffect && !enabledEffectIndices.has(effectIndex) && !collectActivationChoice)
      continue;
    const compiled = compileEffectPlan({
      sourceDefinitionId: move.id,
      effectIndex,
      effect,
      allowFloatingOnMoveUse,
      allowPendingChoice:
        (isChoiceEffect && enabledEffectIndices.has(effectIndex)) || collectActivationChoice,
    });
    if (!compiled.ok) continue;
    for (const target of effectTargets(compiled.value.definition)) {
      const resolved = executeCompiledEffect(compiled.value, { move, target });
      if (!effectMatches(effect, context)) continue;
      const changes = triggeredEffectChanges(
        resolved.effect,
        move,
        context,
        trigger,
        target,
        effectIndex,
      );
      resources.push(...changes.resources);
      resourceActionModifiers.push(...(changes.resourceActionModifiers ?? []));
      resourceCostModifications.push(...(changes.resourceCostModifications ?? []));
      storedRollRequests.push(...changes.storedRollRequests);
      storedMoveSelectionRequests.push(...changes.storedMoveSelectionRequests);
      statuses.push(...changes.statuses);
      extraActions.push(...changes.extraActions);
      counterActions.push(...changes.counterActions);
      scheduledResources.push(...changes.scheduledResources);
      damageModifications.push(...changes.damageModifications);
      statModifications.push(...changes.statModifications);
      suppressions.push(...changes.suppressions);
      forcedActions.push(...changes.forcedActions);
      actionRestrictions.push(...changes.actionRestrictions);
      moveRemovals.push(...(changes.moveRemovals ?? []));
      activations.push(...changes.activations);
      locks.push(...changes.locks);
      deactivations.push(...changes.deactivations);
      floatingEffects.push(...changes.floatingEffects);
      moveUsePreventions.push(...changes.moveUsePreventions);
      remainingUseModifications.push(...changes.remainingUseModifications);
      statusPreventions.push(...changes.statusPreventions);
      rollModifications.push(
        ...changes.rollModifications.map((modification) => ({
          ...modification,
          sourceDefinitionId: move.id,
          sourceEffectIndex: effectIndex,
        })),
      );
      rollModificationTransformers.push(...changes.rollModificationTransformers);
      rollSelections.push(...changes.rollSelections);
      rollDefinitions.push(...changes.rollDefinitions);
      rollResultOverrides.push(...changes.rollResultOverrides);
      combatResultOverrides.push(
        ...changes.combatResultOverrides.map((override) => ({
          ...override,
          ...(override.scope === "next-action" ? { effectIndex } : {}),
        })),
      );
      criticalThresholds.push(...changes.criticalThresholds);
      resolutionThresholds.push(...changes.resolutionThresholds);
      resolutionPreventions.push(...changes.resolutionPreventions);
      combatResultPreventions.push(...changes.combatResultPreventions);
      rollModificationPreventions.push(...changes.rollModificationPreventions);
      moveModificationPreventions.push(...changes.moveModificationPreventions);
      currentActionMoveModificationPreventions.push(
        ...changes.currentActionMoveModificationPreventions,
      );
      resourceModificationPreventions.push(...changes.resourceModificationPreventions);
      costModifications.push(...changes.costModifications);
      currentActionCostModifications.push(...changes.currentActionCostModifications);
      slotCapacityModifications.push(...changes.slotCapacityModifications);
      rerolls.push(...changes.rerolls);
      negations.push(...changes.negations);
    }
  }
  if (includeActiveFloatingEffects) {
    for (const floating of context.activeEffects ?? []) {
      if (
        floating.type !== "floating-effect" ||
        floating.sourceCombatantId !== context.self.id ||
        (floating.scope.type === "next-turn" && context.turnNumber <= floating.createdOnTurn)
      )
        continue;
      const floatingMove = {
        ...move,
        id: floating.sourceDefinitionId,
        effects: floating.effects,
      } as MoveDefinition;
      const nested = moveEffectsForTriggerInternal(
        floatingMove,
        trigger,
        {
          ...context,
          includeActiveFloatingEffects: false,
          floatingEffectTargetCombatantId:
            floating.targetRelationCombatantId ?? floating.targetCombatantId,
          ...(floating.blockedAttackDamage === undefined
            ? {}
            : { blockedAttackDamage: floating.blockedAttackDamage }),
        },
        false,
        true,
      );
      resources.push(...nested.resources);
      resourceActionModifiers.push(...(nested.resourceActionModifiers ?? []));
      resourceCostModifications.push(...(nested.resourceCostModifications ?? []));
      storedRollRequests.push(...nested.storedRollRequests);
      storedMoveSelectionRequests.push(...nested.storedMoveSelectionRequests);
      statuses.push(...nested.statuses);
      extraActions.push(...nested.extraActions);
      counterActions.push(...nested.counterActions);
      scheduledResources.push(...nested.scheduledResources);
      damageModifications.push(...nested.damageModifications);
      statModifications.push(...nested.statModifications);
      suppressions.push(...nested.suppressions);
      forcedActions.push(...nested.forcedActions);
      actionRestrictions.push(...nested.actionRestrictions);
      moveRemovals.push(...(nested.moveRemovals ?? []));
      activations.push(...nested.activations);
      locks.push(...nested.locks);
      deactivations.push(...nested.deactivations);
      floatingEffects.push(...nested.floatingEffects);
      moveUsePreventions.push(...nested.moveUsePreventions);
      remainingUseModifications.push(...nested.remainingUseModifications);
      statusPreventions.push(...nested.statusPreventions);
      rollModifications.push(...nested.rollModifications);
      rollModificationTransformers.push(...nested.rollModificationTransformers);
      rollSelections.push(...nested.rollSelections);
      rollDefinitions.push(...nested.rollDefinitions);
      rollResultOverrides.push(...nested.rollResultOverrides);
      combatResultOverrides.push(...nested.combatResultOverrides);
      criticalThresholds.push(...nested.criticalThresholds);
      resolutionThresholds.push(...nested.resolutionThresholds);
      resolutionPreventions.push(...nested.resolutionPreventions);
      combatResultPreventions.push(...nested.combatResultPreventions);
      rollModificationPreventions.push(...nested.rollModificationPreventions);
      moveModificationPreventions.push(...nested.moveModificationPreventions);
      currentActionMoveModificationPreventions.push(
        ...nested.currentActionMoveModificationPreventions,
      );
      resourceModificationPreventions.push(...nested.resourceModificationPreventions);
      costModifications.push(...nested.costModifications);
      currentActionCostModifications.push(...nested.currentActionCostModifications);
      slotCapacityModifications.push(...nested.slotCapacityModifications);
      rerolls.push(...nested.rerolls);
      negations.push(...nested.negations);
      pendingEffectChoices.push(...nested.pendingEffectChoices);
    }
  }
  return {
    resources,
    resourceActionModifiers,
    resourceCostModifications,
    storedRollRequests,
    storedMoveSelectionRequests,
    statuses,
    extraActions,
    counterActions,
    scheduledResources,
    damageModifications,
    statModifications,
    suppressions,
    forcedActions,
    actionRestrictions,
    moveRemovals,
    activations,
    locks,
    deactivations,
    floatingEffects,
    moveUsePreventions,
    remainingUseModifications,
    statusPreventions,
    rollModifications,
    rollModificationTransformers,
    rollSelections,
    rollDefinitions,
    rollResultOverrides,
    combatResultOverrides,
    criticalThresholds,
    resolutionThresholds,
    resolutionPreventions,
    combatResultPreventions,
    rollModificationPreventions,
    moveModificationPreventions,
    currentActionMoveModificationPreventions,
    resourceModificationPreventions,
    costModifications,
    currentActionCostModifications,
    slotCapacityModifications,
    rerolls,
    negations,
    pendingEffectChoices,
  };
};

export const moveEffectsForTrigger = (
  move: MoveDefinition,
  trigger: Parameters<typeof moveEffectsForTriggerInternal>[1],
  context: MoveEffectRuntimeContext,
) =>
  moveEffectsForTriggerInternal(
    move,
    trigger,
    context,
    context.includeActiveFloatingEffects === true,
  );

export const successfulMoveEffects = (move: MoveDefinition, context: MoveEffectRuntimeContext) =>
  moveEffectsForTrigger(move, "on-success", context);

export const stoppedMoveEffects = (move: MoveDefinition, context: MoveEffectRuntimeContext) =>
  moveEffectsForTrigger(move, "on-stopped", context);
