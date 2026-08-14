import type {
  EffectDefinition,
  MoveDefinition,
  MoveSelectorCondition,
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
  /** The attack currently being resolved, available to action-sequence conditions. */
  readonly currentAction?: Extract<
    CombatActionRecord,
    { readonly type: "basic-attack" | "use-move" }
  >;
  readonly rolls?: readonly AttackDieRoll[];
  readonly paidKiCost?: number;
  /** The activation cost recorded for the CONSTANT Skill currently resolving. */
  readonly paidActivationCost?: number;
  /** Damage entering the current on-damage response point, if any. */
  readonly incomingDamage?: number;
  /** Final damage dealt by the current attack when a resource effect consumes it. */
  readonly currentDamage?: number;
  readonly mode?: "spar" | "battle";
  /** The attack that caused a passive effect owned by another move to trigger. */
  readonly triggeringMove?: MoveDefinition;
  /** Which combatant owns triggeringMove; required for base-cost/base-damage expressions. */
  readonly triggeringMoveOwner?: "self" | "opponent";
  /** The resource event currently being observed by an on-resource trigger. */
  readonly resourceChange?: ResourceChangeEvent;
  /** The resource state immediately before the current threshold transition. */
  readonly previousResourceState?: {
    readonly self: CombatantState;
    readonly opponent: CombatantState;
  };
  /** Direct source resolution opts into bundles owned by the acting combatant. */
  readonly includeActiveFloatingEffects?: boolean;
}

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
  readonly cause?: "non-damage-effect" | "opponent-effect";
  readonly sourceStyleId?: string;
}

export interface StoredRollRequest {
  readonly target: "self";
  readonly sourceDefinitionId: MoveDefinition["id"];
  readonly effectIndex: number;
  readonly storageKey: string;
  readonly dice: number;
  readonly sides: number;
}

export interface StatusApplication {
  readonly status: ActiveStatus;
  readonly target: "self" | "opponent";
}

export interface RerollApplication {
  readonly target: "self";
  readonly sourceDefinitionId: MoveDefinition["id"];
  readonly effectIndex: number;
  readonly roll: "attack" | "defense";
  readonly rerollScope: "single-result" | "entire-attack";
  readonly resultModifier: number;
  readonly bonus?: number;
  readonly selector?: MoveSelectorCondition;
  readonly conditions: EffectDefinition["conditions"];
  readonly duration?: "combat";
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
}

export interface ActionRestrictionApplication {
  readonly target: "self" | "opponent";
  /** Omitted means the target's entire action is skipped. */
  readonly blockedCategories?: readonly ("basic-attack" | "advanced-attack" | "signature")[];
  readonly remainingTurns: number;
  readonly effectIndex: number;
}

export interface ExtraActionApplication {
  readonly target: "self" | "opponent";
  readonly phase: "action" | "upkeep";
  readonly moveCategory?: "advanced-attack" | "item-use" | "skill" | "power-up";
  readonly sourceMoveOnly: boolean;
  readonly constant?: boolean;
  readonly maximumActions?: number;
  readonly scope: "current-turn" | "next-turn";
  readonly useLimit?: { readonly scope: "combat" | "turn"; readonly count: number };
  readonly effectIndex: number;
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

export interface LockApplication {
  readonly target: "self" | "opponent";
  readonly affectedType: Extract<EffectDefinition, { readonly type: "lock" }>["affectedType"];
  readonly selector?: MoveSelectorCondition;
  readonly duration:
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

export interface FloatingEffectApplication {
  readonly target: "self" | "opponent";
  readonly floatingEffectId: string;
  readonly effects: readonly EffectDefinition[];
  readonly termination: readonly {
    readonly trigger: "on-power-up" | "on-stopped" | "on-success";
    readonly actor: "self" | "opponent";
    readonly selector?: MoveSelectorCondition;
  }[];
  readonly scope: Extract<EffectDefinition, { readonly type: "create-floating-effect" }>["scope"];
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

export interface RollModification {
  readonly target: "self" | "opponent";
  readonly roll: "attack" | "defense";
  readonly modifier: "result" | "sides";
  readonly amount: number;
  readonly cap?:
    | {
        readonly type: "maximum" | "minimum";
        readonly scope: "amount" | "total" | "roll";
        readonly value: number;
      }
    | { readonly type: "allow-exceed"; readonly scope: "amount" | "total" | "roll" };
  /** One-based die index for an immediate per-die result modifier. */
  readonly dieIndex?: number;
  readonly selector?: MoveSelectorCondition;
  readonly stacking?: "allow" | "prevent";
  /** Retained so state mutation can distinguish immediate from durable roll changes. */
  readonly scope?:
    "combat" | "following-action" | "next-action" | "next-actions" | "next-roll" | "next-rolls";
  /** Resolved count for next-actions/next-rolls scopes. */
  readonly remaining?: number;
}

export interface DamageModification {
  readonly target: "self" | "opponent";
  readonly operation: "add" | "multiply" | "set";
  /** Resolved damage amount, or the percentage for a multiplicative change. */
  readonly amount: number;
  readonly basis: "power-percent" | "damage-percent";
  readonly cap?: { readonly type: "maximum" | "minimum"; readonly value: number };
  readonly selector?: MoveSelectorCondition;
  readonly scope?: "current-action" | "following-action" | "next-action" | "next-actions";
  readonly remaining?: number;
  readonly availableFromTurn?: number;
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
    | { readonly type: "combat" }
    | { readonly type: "turns"; readonly remaining: number }
    | { readonly type: "next-actions"; readonly remaining: number }
    | {
        readonly type: "until-roll-threshold";
        readonly roll: "attack";
        readonly comparison: "at-least" | "at-most";
        readonly value: number;
      };
}

export interface CostModification {
  readonly target: "self" | "opponent";
  readonly amount: number;
  readonly selector: MoveSelectorCondition;
  readonly scope: "next-action";
}

export interface CurrentActionCostModification {
  readonly target: "self" | "opponent";
  readonly operation: "add" | "set";
  readonly amount: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly selector?: MoveSelectorCondition;
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
  readonly roll: "attack" | "defense";
  readonly modifier: "result" | "sides" | "any";
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
  readonly duration: LockApplication["duration"];
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

const statComparisonMatches = (
  condition: Extract<RuntimeCondition, { readonly type: "stat-comparison" }>,
  context: MoveEffectRuntimeContext,
) => {
  const left = condition.left === "self" ? context.self.stats : context.opponent.stats;
  const right = condition.right === "self" ? context.self.stats : context.opponent.stats;
  let key: keyof typeof left;
  if (condition.stat === "power") key = "power";
  else if (condition.stat === "dexterity-bonus") key = "dexterityBonus";
  else key = "dexterity";
  if (condition.comparison === "higher-than") return left[key] > right[key];
  if (condition.comparison === "lower-than") return left[key] < right[key];
  return left[key] === right[key];
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
    (condition.attackRoll.sides === undefined || attackRoll.sides === condition.attackRoll.sides)
  );
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
  const actorId = actionActorId(condition.actor, context);
  const action = currentAttackAction(context);
  if (action !== undefined && action.actorId === actorId)
    return actionResultMatches(action, condition.result);
  return condition.actor === "self" && condition.result === combatResultFor(context);
};

const combatResultFor = (context: MoveEffectRuntimeContext) =>
  context.successfulHitCount > 0 ? "successful" : "stopped";

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

const activeMoveCount = (
  condition: Extract<RuntimeCondition, { readonly type: "active-move-count" }>,
  context: MoveEffectRuntimeContext,
) => {
  const subjects =
    condition.subject === "either"
      ? [context.self, context.opponent]
      : [condition.subject === "self" ? context.self : context.opponent];
  const seen = new Set<string>();
  for (const subject of subjects) {
    for (const effect of context.activeEffects ?? []) {
      if (
        effect.type !== "active-constant" ||
        effect.sourceCombatantId !== subject.id ||
        effect.lifecycle === "deactivated"
      )
        continue;
      const sourceMove = context.moves.get(effect.sourceDefinitionId);
      if (sourceMove === undefined || !matchesMoveSelector(sourceMove, condition.selector))
        continue;
      seen.add(`${subject.id}:${effect.sourceDefinitionId}`);
    }
  }
  return seen.size;
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

type RuntimeConditionHandler = (
  condition: RuntimeCondition,
  context: MoveEffectRuntimeContext,
) => boolean;

const runtimeConditionHandlers: Partial<Record<RuntimeCondition["type"], RuntimeConditionHandler>> =
  {
    "combat-result": (condition, context) =>
      combatResultMatches(
        condition as Extract<RuntimeCondition, { readonly type: "combat-result" }>,
        context,
      ),
    "successful-hit-count": (condition, context) => {
      const typed = condition as Extract<
        RuntimeCondition,
        { readonly type: "successful-hit-count" }
      >;
      return numericComparison(typed.value, context.successfulHitCount, typed.comparison, context);
    },
    "roll-threshold": (condition, context) =>
      rollThresholdMatches(
        condition as Extract<RuntimeCondition, { readonly type: "roll-threshold" }>,
        context,
      ),
    "roll-comparison": (condition, context) =>
      rollComparisonMatches(
        condition as Extract<RuntimeCondition, { readonly type: "roll-comparison" }>,
        context,
      ),
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
    "stored-roll-threshold": (condition, context) =>
      storedRollThresholdMatches(
        condition as Extract<RuntimeCondition, { readonly type: "stored-roll-threshold" }>,
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

const effectMatches = (effect: EffectDefinition, context: MoveEffectRuntimeContext) =>
  requirementsMatch(effect, context) &&
  (effect.conditions ?? [])
    .filter((condition) => effect.type !== "deactivate" || condition.type !== "move-selector")
    .every((condition) => conditionMatches(condition, context));

const numeric = (
  expression: Parameters<typeof evaluateDurableNumericExpression>[0],
  context: MoveEffectRuntimeContext,
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
  });

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
    const value = effect.percent === undefined ? undefined : numeric(effect.percent, context);
    if (value === undefined) return damage;
    if (
      effect.selector !== undefined &&
      (context.triggeringMove === undefined ||
        !matchesMoveSelector(context.triggeringMove, effect.selector))
    )
      return damage;
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
  if (value === undefined || effect.percent === undefined) return undefined;
  const resolvedValue =
    effect.percent.type === "damage-percent" ? value : damageAmount(effect.percent, value, context);
  return { type: effect.cap.type, value: resolvedValue };
};

const damageModificationAmount = (
  effect: Extract<EffectDefinition, { readonly type: "modify-damage" }>,
  resolvedAmount: number,
  context: MoveEffectRuntimeContext,
) =>
  effect.operation === "multiply"
    ? resolvedAmount
    : damageAmount(effect.percent!, resolvedAmount, context);

const damageModificationValue = (
  effect: Extract<EffectDefinition, { readonly type: "modify-damage" }>,
  context: MoveEffectRuntimeContext,
) => {
  if (effect.percent === undefined) return undefined;
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
  return { scope, remaining, duration, cap, nextTurn };
};

const resolvedDamageModification = (
  effect: Extract<EffectDefinition, { readonly type: "modify-damage" }>,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
): DamageModification | undefined => {
  if (
    effect.percent === undefined ||
    effect.optional === true ||
    effect.activationGroup !== undefined
  )
    return undefined;
  const value = damageModificationValue(effect, context);
  if (value === undefined) return undefined;
  const lifecycle = damageModificationLifecycle(effect, context, target);
  if (lifecycle === undefined) return undefined;
  return {
    target,
    operation: effect.operation ?? "add",
    amount: damageModificationAmount(effect, value.resolvedAmount, context),
    basis: damageBasis(effect.percent),
    ...(lifecycle.cap === undefined ? {} : { cap: lifecycle.cap }),
    ...(effect.selector === undefined ? {} : { selector: effect.selector }),
    ...(lifecycle.scope === undefined || lifecycle.scope === "next-turn"
      ? {}
      : { scope: lifecycle.scope }),
    ...(lifecycle.remaining === undefined ? {} : { remaining: lifecycle.remaining }),
    ...(effect.scope?.type === "next-turn" ? { availableFromTurn: context.turnNumber + 1 } : {}),
    ...(lifecycle.duration === undefined && lifecycle.nextTurn === undefined
      ? {}
      : { duration: lifecycle.duration ?? lifecycle.nextTurn }),
  };
};

const damageModificationEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "modify-damage" }>,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
): EffectChanges => {
  const modification = resolvedDamageModification(effect, context, target);
  return modification === undefined
    ? emptyEffectChanges()
    : { ...emptyEffectChanges(), damageModifications: [modification] };
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

const suppressionEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "suppress" }>,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
): EffectChanges => {
  const duration = effect.duration;
  let resolvedDuration: SuppressionApplication["duration"] | undefined;
  if (effect.scope?.type === "next-action") {
    resolvedDuration = { type: "next-actions", remaining: 1 };
  } else if (duration === undefined) {
    return emptyEffectChanges();
  } else if (duration.type === "combat") {
    resolvedDuration = { type: "combat" };
  } else if (duration.type === "turns") {
    const turns = numeric(duration.turns, context);
    if (turns === undefined) return emptyEffectChanges();
    resolvedDuration = { type: "turns", remaining: Math.max(1, turns) };
  } else if (duration.type === "until-roll-threshold" && duration.roll === "attack") {
    const value = numeric(duration.value, context);
    if (value === undefined) return emptyEffectChanges();
    resolvedDuration = {
      type: "until-roll-threshold",
      roll: "attack",
      comparison: duration.comparison,
      value,
    };
  } else {
    return emptyEffectChanges();
  }
  if (effect.aspects === undefined || effect.aspects.length === 0) return emptyEffectChanges();
  return {
    ...emptyEffectChanges(),
    suppressions: [
      {
        target,
        ...(effect.selector === undefined ? {} : { selector: effect.selector }),
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
  storedRollRequests: [] as StoredRollRequest[],
  statuses: [] as StatusApplication[],
  extraActions: [] as ExtraActionApplication[],
  scheduledResources: [] as ScheduledResourceApplication[],
  damageModifications: [] as DamageModification[],
  statModifications: [] as StatModification[],
  suppressions: [] as SuppressionApplication[],
  forcedActions: [] as ForcedActionApplication[],
  actionRestrictions: [] as ActionRestrictionApplication[],
  locks: [] as LockApplication[],
  deactivations: [] as DeactivationApplication[],
  floatingEffects: [] as FloatingEffectApplication[],
  moveUsePreventions: [] as MoveUsePreventionApplication[],
  remainingUseModifications: [] as RemainingUseModificationApplication[],
  statusPreventions: [] as StatusPreventionApplication[],
  rollModifications: [] as RollModification[],
  rollDefinitions: [] as RollDefinitionOverride[],
  rollResultOverrides: [] as RollResultOverride[],
  combatResultOverrides: [] as CombatResultOverrideApplication[],
  criticalThresholds: [] as CriticalThresholdApplication[],
  resolutionThresholds: [] as ResolutionThresholdApplication[],
  resolutionPreventions: [] as ResolutionPreventionApplication[],
  combatResultPreventions: [] as CombatResultPreventionApplication[],
  rollModificationPreventions: [] as RollModificationPreventionApplication[],
  moveModificationPreventions: [] as MoveModificationPreventionApplication[],
  resourceModificationPreventions: [] as ResourceModificationPreventionApplication[],
  costModifications: [] as CostModification[],
  currentActionCostModifications: [] as CurrentActionCostModification[],
  rerolls: [] as RerollApplication[],
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

const statusEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "apply-status" }>,
  move: MoveDefinition,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
) => {
  const turns =
    effect.duration?.type === "turns" ? numeric(effect.duration.turns, context) : undefined;
  const ownerCombatantId = target === "self" ? context.self.id : context.opponent.id;
  let duration: ActiveStatus["duration"];
  if (effect.duration?.type === "combat") {
    duration = { type: "combat" };
  } else if (turns === undefined) {
    duration = { type: "turns", ownerCombatantId, remaining: 1 };
  } else {
    duration = { type: "turns", ownerCombatantId, remaining: Math.max(1, turns) };
  }
  return {
    resources: [],
    storedRollRequests: [],
    statuses: [
      {
        target,
        status: {
          statusId: effect.statusId,
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
    damageModifications: [],
    statModifications: [],
    suppressions: [],
    forcedActions: [],
    actionRestrictions: [],
    locks: [],
    deactivations: [],
    floatingEffects: [],
    moveUsePreventions: [],
    remainingUseModifications: [],
    statusPreventions: [],
    rollModifications: [],
    rollDefinitions: [],
    rollResultOverrides: [],
    resolutionThresholds: [],
    resolutionPreventions: [],
    combatResultPreventions: [],
    rollModificationPreventions: [],
    moveModificationPreventions: [],
    resourceModificationPreventions: [],
    costModifications: [],
    currentActionCostModifications: [],
    rerolls: [],
  };
};

const floatingEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "create-floating-effect" }>,
  target: "self" | "opponent",
): EffectChanges => ({
  ...emptyEffectChanges(),
  floatingEffects: [
    {
      target,
      floatingEffectId: effect.floatingEffectId,
      effects: effect.effects ?? [],
      termination: (effect.termination ?? []).map(({ trigger, actor, selector }) => ({
        trigger,
        actor,
        ...(selector === undefined ? {} : { selector }),
      })),
      scope: effect.scope,
    },
  ],
});

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

const extraActionEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "grant-extra-action" }>,
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

type EffectChanges = ReturnType<typeof emptyEffectChanges>;
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

const resourceEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "modify-resource" }>,
  move: MoveDefinition,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
): EffectChanges => {
  const amount = resourceEffectAmount(effect, context);
  const capValue = effect.cap === undefined ? undefined : numeric(effect.cap.value, context);
  if (effect.amount !== undefined && amount === undefined) return emptyEffectChanges();
  if (effect.cap !== undefined && capValue === undefined) return emptyEffectChanges();
  const cap =
    effect.cap === undefined || capValue === undefined
      ? undefined
      : { type: effect.cap.type, value: capValue };
  return {
    ...emptyEffectChanges(),
    resources:
      amount === undefined
        ? []
        : [
            {
              resource: effect.resource,
              target,
              operation: effect.operation,
              amount,
              ...(cap === undefined ? {} : { cap }),
              sourceCombatantId: context.self.id,
              cause: "non-damage-effect" as const,
              ...(move.styleId === undefined ? {} : { sourceStyleId: move.styleId }),
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

const costModificationEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "modify-cost" }>,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
): EffectChanges => {
  const amount = numeric(effect.amount, context);
  const minimum = effect.minimum === undefined ? undefined : numeric(effect.minimum, context);
  const maximum = effect.maximum === undefined ? undefined : numeric(effect.maximum, context);
  if (
    amount === undefined ||
    (effect.minimum !== undefined && minimum === undefined) ||
    (effect.maximum !== undefined && maximum === undefined)
  )
    return emptyEffectChanges();
  if (effect.scope?.type === "current-action")
    return {
      ...emptyEffectChanges(),
      currentActionCostModifications: [
        {
          target,
          operation: effect.operation,
          amount,
          ...(minimum === undefined ? {} : { minimum }),
          ...(maximum === undefined ? {} : { maximum }),
          ...(effect.selector === undefined ? {} : { selector: effect.selector }),
        },
      ],
    };
  return effect.selector === undefined || effect.scope?.type !== "next-action"
    ? emptyEffectChanges()
    : {
        ...emptyEffectChanges(),
        costModifications: [{ target, amount, selector: effect.selector, scope: "next-action" }],
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
  const selector =
    effect.selector ??
    effect.conditions?.find(
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
  const duration = lockDuration(effect.duration, context);
  return duration === undefined
    ? emptyEffectChanges()
    : {
        ...emptyEffectChanges(),
        moveModificationPreventions: [
          {
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
            duration,
          },
        ],
      };
};

const resolvedRollModificationCap = (
  definition: Extract<EffectDefinition, { readonly type: "modify-roll" }>["cap"],
  context: MoveEffectRuntimeContext,
): RollModification["cap"] => {
  if (definition === undefined) return undefined;
  const scope = definition.scope ?? "amount";
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

const rollModificationEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "modify-roll" }>,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
): EffectChanges => {
  if (
    (effect.roll !== "attack" && effect.roll !== "defense") ||
    (effect.modifier !== "result" && effect.modifier !== "sides") ||
    effect.amount === undefined
  ) {
    return emptyEffectChanges();
  }
  const amount = numeric(effect.amount, context);
  const cap = resolvedRollModificationCap(effect.cap, context);
  const countedScope =
    effect.scope?.type === "next-actions" || effect.scope?.type === "next-rolls"
      ? numeric(effect.scope.count, context)
      : undefined;
  if (!isResolvedRollModification(amount, effect.cap, cap, countedScope))
    return emptyEffectChanges();
  return {
    ...emptyEffectChanges(),
    rollModifications: [
      {
        target,
        roll: effect.roll,
        modifier: effect.modifier,
        amount,
        ...(cap === undefined ? {} : { cap }),
        ...(effect.dieIndex === undefined ? {} : { dieIndex: effect.dieIndex }),
        ...(effect.selector === undefined ? {} : { selector: effect.selector }),
        ...(effect.scope?.type === "combat" ||
        effect.scope?.type === "following-action" ||
        effect.scope?.type === "next-action" ||
        effect.scope?.type === "next-actions" ||
        effect.scope?.type === "next-roll" ||
        effect.scope?.type === "next-rolls"
          ? { scope: effect.scope.type }
          : {}),
        ...(countedScope === undefined ? {} : { remaining: countedScope }),
      },
    ],
  };
};

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
): EffectChanges => ({
  ...emptyEffectChanges(),
  combatResultOverrides: [{ target, result: effect.result, resultScope: effect.resultScope }],
});

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

const rerollEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "reroll" }>,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
  move: MoveDefinition,
  effectIndex: number,
): EffectChanges => {
  if (target !== "self") return emptyEffectChanges();
  const bonusExpression = effect.bonus ?? effect.resultModifier;
  const bonus = bonusExpression === undefined ? 0 : numeric(bonusExpression, context);
  let useLimitCount: number | undefined;
  if (effect.useLimit !== undefined)
    useLimitCount =
      typeof effect.useLimit.count === "number"
        ? effect.useLimit.count
        : numeric(effect.useLimit.count, context);
  const activationCost =
    effect.activationCost === undefined
      ? undefined
      : numeric(effect.activationCost.amount, context);
  const resolvedUseLimit =
    effect.useLimit === undefined || useLimitCount === undefined
      ? undefined
      : { scope: effect.useLimit.scope, count: useLimitCount };
  if (
    bonus === undefined ||
    (effect.useLimit !== undefined && useLimitCount === undefined) ||
    (resolvedUseLimit !== undefined && resolvedUseLimit.count < 1) ||
    (activationCost === undefined && effect.activationCost !== undefined)
  )
    return emptyEffectChanges();
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
        ...(effect.activationCost === undefined
          ? {}
          : { activationResource: effect.activationCost.resource }),
        duration: "combat",
        ...(resolvedUseLimit === undefined ? {} : { useLimit: resolvedUseLimit }),
        ...(activationCost === undefined ? {} : { activationCost }),
      },
    ],
  };
};

const triggeredEffectHandlers: Partial<Record<EffectDefinition["type"], TriggeredEffectHandler>> = {
  "roll-and-store": (effect, move, context, target, _trigger, effectIndex) =>
    rollAndStoreEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "roll-and-store" }>,
      move,
      context,
      target,
      effectIndex,
    ),
  "create-floating-effect": (effect, _move, _context, target) =>
    floatingEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "create-floating-effect" }>,
      target,
    ),
  "grant-extra-action": (effect, _move, context, target, trigger, effectIndex) =>
    extraActionEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "grant-extra-action" }>,
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
  "modify-damage": (effect, _move, context, target) =>
    damageModificationEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "modify-damage" }>,
      context,
      target,
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
  suppress: (effect, _move, context, target) =>
    suppressionEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "suppress" }>,
      context,
      target,
    ),
  "modify-cost": (effect, _move, context, target) =>
    costModificationEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "modify-cost" }>,
      context,
      target,
    ),
  "modify-resource": (effect, _move, context, target) =>
    resourceEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "modify-resource" }>,
      _move,
      context,
      target,
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
  "skip-action": (effect, _move, context, target, _trigger, effectIndex) =>
    actionRestrictionEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "skip-action" }>,
      context,
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
    | "on-damage"
    | "on-move-use"
    | "on-power-up"
    | "on-resource-gain"
    | "on-resource-drain"
    | "on-resource-threshold"
    | "on-roll-result"
    | "start-combat"
    | "upkeep-phase",
  target: "self" | "opponent",
  effectIndex: number,
) => {
  if (
    effect.trigger !== trigger ||
    (effect.optional === true && effect.type !== "reroll") ||
    effect.activationGroup !== undefined ||
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
  (context.activeEffects ?? []).some(
    (effect) =>
      effect.type === "suppress" &&
      effect.targetCombatantId === context.self.id &&
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
        roll: resolved.effect.roll,
        rerollScope: resolved.effect.rerollScope ?? "single-result",
        resultModifier,
        conditions: resolved.effect.conditions,
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
    | "on-damage"
    | "on-move-use"
    | "on-power-up"
    | "on-resource-gain"
    | "on-resource-drain"
    | "on-resource-threshold"
    | "on-roll-result"
    | "start-combat"
    | "upkeep-phase",
  context: MoveEffectRuntimeContext,
  includeActiveFloatingEffects: boolean,
): {
  readonly resources: readonly ResourceChange[];
  readonly storedRollRequests: readonly StoredRollRequest[];
  readonly statuses: readonly StatusApplication[];
  readonly extraActions: readonly ExtraActionApplication[];
  readonly scheduledResources: readonly ScheduledResourceApplication[];
  readonly damageModifications: readonly DamageModification[];
  readonly statModifications: readonly StatModification[];
  readonly suppressions: readonly SuppressionApplication[];
  readonly forcedActions: readonly ForcedActionApplication[];
  readonly actionRestrictions: readonly ActionRestrictionApplication[];
  readonly locks: readonly LockApplication[];
  readonly deactivations: readonly DeactivationApplication[];
  readonly floatingEffects: readonly FloatingEffectApplication[];
  readonly moveUsePreventions: readonly MoveUsePreventionApplication[];
  readonly remainingUseModifications: readonly RemainingUseModificationApplication[];
  readonly statusPreventions: readonly StatusPreventionApplication[];
  readonly rollModifications: readonly RollModification[];
  readonly rollDefinitions: readonly RollDefinitionOverride[];
  readonly rollResultOverrides: readonly RollResultOverride[];
  readonly combatResultOverrides: readonly CombatResultOverrideApplication[];
  readonly criticalThresholds: readonly CriticalThresholdApplication[];
  readonly resolutionThresholds: readonly ResolutionThresholdApplication[];
  readonly resolutionPreventions: readonly ResolutionPreventionApplication[];
  readonly combatResultPreventions: readonly CombatResultPreventionApplication[];
  readonly rollModificationPreventions: readonly RollModificationPreventionApplication[];
  readonly moveModificationPreventions: readonly MoveModificationPreventionApplication[];
  readonly resourceModificationPreventions: readonly ResourceModificationPreventionApplication[];
  readonly costModifications: readonly CostModification[];
  readonly currentActionCostModifications: readonly CurrentActionCostModification[];
  readonly rerolls: readonly RerollApplication[];
  // eslint-disable-next-line sonarjs/cognitive-complexity
} => {
  if (moveEffectsSuppressed(move, trigger, context)) return emptyEffectChanges();
  const resources: ResourceChange[] = [];
  const storedRollRequests: StoredRollRequest[] = [];
  const statuses: StatusApplication[] = [];
  const extraActions: ExtraActionApplication[] = [];
  const scheduledResources: ScheduledResourceApplication[] = [];
  const damageModifications: DamageModification[] = [];
  const statModifications: StatModification[] = [];
  const suppressions: SuppressionApplication[] = [];
  const forcedActions: ForcedActionApplication[] = [];
  const actionRestrictions: ActionRestrictionApplication[] = [];
  const locks: LockApplication[] = [];
  const deactivations: DeactivationApplication[] = [];
  const floatingEffects: FloatingEffectApplication[] = [];
  const moveUsePreventions: MoveUsePreventionApplication[] = [];
  const remainingUseModifications: RemainingUseModificationApplication[] = [];
  const statusPreventions: StatusPreventionApplication[] = [];
  const rollModifications: RollModification[] = [];
  const rollDefinitions: RollDefinitionOverride[] = [];
  const rollResultOverrides: RollResultOverride[] = [];
  const combatResultOverrides: CombatResultOverrideApplication[] = [];
  const criticalThresholds: CriticalThresholdApplication[] = [];
  const resolutionThresholds: ResolutionThresholdApplication[] = [];
  const resolutionPreventions: ResolutionPreventionApplication[] = [];
  const combatResultPreventions: CombatResultPreventionApplication[] = [];
  const rollModificationPreventions: RollModificationPreventionApplication[] = [];
  const moveModificationPreventions: MoveModificationPreventionApplication[] = [];
  const resourceModificationPreventions: ResourceModificationPreventionApplication[] = [];
  const costModifications: CostModification[] = [];
  const currentActionCostModifications: CurrentActionCostModification[] = [];
  const rerolls: RerollApplication[] = [];
  for (const [effectIndex, effect] of (move.effects ?? []).entries()) {
    const compiled = compileEffectPlan({
      sourceDefinitionId: move.id,
      effectIndex,
      effect,
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
      storedRollRequests.push(...changes.storedRollRequests);
      statuses.push(...changes.statuses);
      extraActions.push(...changes.extraActions);
      scheduledResources.push(...changes.scheduledResources);
      damageModifications.push(...changes.damageModifications);
      statModifications.push(...changes.statModifications);
      suppressions.push(...changes.suppressions);
      forcedActions.push(...changes.forcedActions);
      actionRestrictions.push(...changes.actionRestrictions);
      locks.push(...changes.locks);
      deactivations.push(...changes.deactivations);
      floatingEffects.push(...changes.floatingEffects);
      moveUsePreventions.push(...changes.moveUsePreventions);
      remainingUseModifications.push(...changes.remainingUseModifications);
      statusPreventions.push(...changes.statusPreventions);
      rollModifications.push(...changes.rollModifications);
      rollDefinitions.push(...changes.rollDefinitions);
      rollResultOverrides.push(...changes.rollResultOverrides);
      combatResultOverrides.push(...changes.combatResultOverrides);
      criticalThresholds.push(...changes.criticalThresholds);
      resolutionThresholds.push(...changes.resolutionThresholds);
      resolutionPreventions.push(...changes.resolutionPreventions);
      combatResultPreventions.push(...changes.combatResultPreventions);
      rollModificationPreventions.push(...changes.rollModificationPreventions);
      moveModificationPreventions.push(...changes.moveModificationPreventions);
      resourceModificationPreventions.push(...changes.resourceModificationPreventions);
      costModifications.push(...changes.costModifications);
      currentActionCostModifications.push(...changes.currentActionCostModifications);
      rerolls.push(...changes.rerolls);
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
        { ...context, includeActiveFloatingEffects: false },
        false,
      );
      resources.push(...nested.resources);
      storedRollRequests.push(...nested.storedRollRequests);
      statuses.push(...nested.statuses);
      extraActions.push(...nested.extraActions);
      scheduledResources.push(...nested.scheduledResources);
      damageModifications.push(...nested.damageModifications);
      statModifications.push(...nested.statModifications);
      suppressions.push(...nested.suppressions);
      forcedActions.push(...nested.forcedActions);
      actionRestrictions.push(...nested.actionRestrictions);
      locks.push(...nested.locks);
      deactivations.push(...nested.deactivations);
      floatingEffects.push(...nested.floatingEffects);
      moveUsePreventions.push(...nested.moveUsePreventions);
      remainingUseModifications.push(...nested.remainingUseModifications);
      statusPreventions.push(...nested.statusPreventions);
      rollModifications.push(...nested.rollModifications);
      rollDefinitions.push(...nested.rollDefinitions);
      rollResultOverrides.push(...nested.rollResultOverrides);
      combatResultOverrides.push(...nested.combatResultOverrides);
      criticalThresholds.push(...nested.criticalThresholds);
      resolutionThresholds.push(...nested.resolutionThresholds);
      resolutionPreventions.push(...nested.resolutionPreventions);
      combatResultPreventions.push(...nested.combatResultPreventions);
      rollModificationPreventions.push(...nested.rollModificationPreventions);
      moveModificationPreventions.push(...nested.moveModificationPreventions);
      resourceModificationPreventions.push(...nested.resourceModificationPreventions);
      costModifications.push(...nested.costModifications);
      currentActionCostModifications.push(...nested.currentActionCostModifications);
      rerolls.push(...nested.rerolls);
    }
  }
  return {
    resources,
    storedRollRequests,
    statuses,
    extraActions,
    scheduledResources,
    damageModifications,
    statModifications,
    suppressions,
    forcedActions,
    actionRestrictions,
    locks,
    deactivations,
    floatingEffects,
    moveUsePreventions,
    remainingUseModifications,
    statusPreventions,
    rollModifications,
    rollDefinitions,
    rollResultOverrides,
    combatResultOverrides,
    criticalThresholds,
    resolutionThresholds,
    resolutionPreventions,
    combatResultPreventions,
    rollModificationPreventions,
    moveModificationPreventions,
    resourceModificationPreventions,
    costModifications,
    currentActionCostModifications,
    rerolls,
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
