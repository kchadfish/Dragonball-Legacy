import type {
  EffectDefinition,
  MoveDefinition,
  MoveSelectorCondition,
} from "@dragonball-resurgence/game-data";

import { evaluateDurableNumericExpression, matchesMoveSelector } from "./declarative-runtime.js";
import { compileEffectPlan, executeCompiledEffect } from "./effect-executors.js";

import type { ActiveStatus, CombatantState } from "./contracts.js";
import type { AttackDieRoll, ResolutionThresholdRule } from "./attack-rolls.js";

export interface MoveEffectRuntimeContext {
  readonly self: CombatantState;
  readonly opponent: CombatantState;
  readonly turnNumber: number;
  readonly completedTurnCount: number;
  readonly moves: ReadonlyMap<string, MoveDefinition>;
  readonly moveActivationCounts: ReadonlyMap<string, number>;
  readonly successfulHitCount: number;
  readonly rolls?: readonly AttackDieRoll[];
  readonly paidKiCost?: number;
  readonly mode?: "spar" | "battle";
  /** The attack that caused a passive effect owned by another move to trigger. */
  readonly triggeringMove?: MoveDefinition;
}

export interface ResourceChange {
  readonly resource: "hp" | "ki";
  readonly target: "self" | "opponent";
  readonly operation: "drain" | "gain" | "lose" | "set";
  readonly amount: number;
}

export interface StatusApplication {
  readonly status: ActiveStatus;
  readonly target: "self" | "opponent";
}

export interface ForcedActionApplication {
  readonly target: "self" | "opponent";
  readonly allowedCategories: readonly ("advanced-attack" | "signature")[];
  readonly allowedTags?: readonly string[];
  readonly allowPass: boolean;
  readonly fallback?: "basic-attack";
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

export interface MoveUsePreventionApplication {
  readonly target: "self" | "opponent";
  readonly operation: "use" | "activate" | "deactivate";
  readonly selector?: MoveSelectorCondition;
  readonly duration: LockApplication["duration"];
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
  readonly selector?: MoveSelectorCondition;
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
  readonly selector?: MoveSelectorCondition;
  readonly scope?: "current-action" | "following-action" | "next-action" | "next-actions";
  readonly remaining?: number;
}

export interface CostModification {
  readonly target: "self" | "opponent";
  readonly amount: number;
  readonly selector: MoveSelectorCondition;
  readonly scope: "next-action";
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
  readonly operations?: readonly "reduce"[];
  readonly duration: LockApplication["duration"];
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
  return condition.comparison === "at-least" ? actual >= value : actual <= value;
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

const combatResultFor = (context: MoveEffectRuntimeContext) =>
  context.successfulHitCount > 0 ? "successful" : "stopped";

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

type RuntimeConditionHandler = (
  condition: RuntimeCondition,
  context: MoveEffectRuntimeContext,
) => boolean;

const runtimeConditionHandlers: Partial<Record<RuntimeCondition["type"], RuntimeConditionHandler>> =
  {
    "combat-result": (condition, context) => {
      const typed = condition as Extract<RuntimeCondition, { readonly type: "combat-result" }>;
      return typed.actor === "self" && typed.result === combatResultFor(context);
    },
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
  };

const conditionMatches = (condition: RuntimeCondition, context: MoveEffectRuntimeContext) =>
  runtimeConditionHandlers[condition.type]?.(condition, context) ?? false;

const effectMatches = (effect: EffectDefinition, context: MoveEffectRuntimeContext) =>
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
    moves: context.moves,
    moveActivationCounts: context.moveActivationCounts,
  });

const damageAmount = (
  expression: NonNullable<Extract<EffectDefinition, { readonly type: "modify-damage" }>["percent"]>,
  value: number,
  context: MoveEffectRuntimeContext,
) =>
  expression.type === "stat-percent" ? value : Math.round((context.self.stats.power * value) / 100);

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

const damageModificationEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "modify-damage" }>,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
): EffectChanges => {
  if (
    effect.percent === undefined ||
    effect.optional === true ||
    effect.activationGroup !== undefined
  )
    return emptyEffectChanges();
  const amount = numeric(effect.percent, context);
  if (amount === undefined) return emptyEffectChanges();
  const scope = effect.scope?.type;
  if (
    scope !== undefined &&
    scope !== "current-action" &&
    scope !== "following-action" &&
    scope !== "next-action" &&
    scope !== "next-actions"
  )
    return emptyEffectChanges();
  const remaining =
    scope === "next-actions" && effect.scope?.type === "next-actions"
      ? numeric(effect.scope.count, context)
      : undefined;
  if (remaining !== undefined && remaining < 1) return emptyEffectChanges();
  return {
    ...emptyEffectChanges(),
    damageModifications: [
      {
        target,
        operation: effect.operation ?? "add",
        amount:
          effect.operation === "multiply" ? amount : damageAmount(effect.percent, amount, context),
        ...(effect.selector === undefined ? {} : { selector: effect.selector }),
        ...(scope === undefined ? {} : { scope }),
        ...(remaining === undefined ? {} : { remaining }),
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
  statuses: [] as StatusApplication[],
  damageModifications: [] as DamageModification[],
  forcedActions: [] as ForcedActionApplication[],
  locks: [] as LockApplication[],
  deactivations: [] as DeactivationApplication[],
  moveUsePreventions: [] as MoveUsePreventionApplication[],
  statusPreventions: [] as StatusPreventionApplication[],
  rollModifications: [] as RollModification[],
  rollDefinitions: [] as RollDefinitionOverride[],
  rollResultOverrides: [] as RollResultOverride[],
  resolutionThresholds: [] as ResolutionThresholdApplication[],
  resolutionPreventions: [] as ResolutionPreventionApplication[],
  combatResultPreventions: [] as CombatResultPreventionApplication[],
  rollModificationPreventions: [] as RollModificationPreventionApplication[],
  moveModificationPreventions: [] as MoveModificationPreventionApplication[],
  costModifications: [] as CostModification[],
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
    damageModifications: [],
    forcedActions: [],
    locks: [],
    deactivations: [],
    moveUsePreventions: [],
    statusPreventions: [],
    rollModifications: [],
    rollDefinitions: [],
    rollResultOverrides: [],
    resolutionThresholds: [],
    resolutionPreventions: [],
    combatResultPreventions: [],
    rollModificationPreventions: [],
    moveModificationPreventions: [],
    costModifications: [],
  };
};

type EffectChanges = ReturnType<typeof emptyEffectChanges>;
type TriggeredEffectHandler = (
  effect: EffectDefinition,
  move: MoveDefinition,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
) => EffectChanges;

const resourceEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "modify-resource" }>,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
): EffectChanges => {
  const amount = effect.amount === undefined ? undefined : numeric(effect.amount, context);
  return {
    ...emptyEffectChanges(),
    resources:
      amount === undefined
        ? []
        : [{ resource: effect.resource, target, operation: effect.operation, amount }],
  };
};

const costModificationEffectChanges = (
  effect: Extract<EffectDefinition, { readonly type: "modify-cost" }>,
  context: MoveEffectRuntimeContext,
  target: "self" | "opponent",
): EffectChanges => {
  const amount = numeric(effect.amount, context);
  return amount === undefined ||
    effect.selector === undefined ||
    effect.scope?.type !== "next-action"
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
            ...(effect.operations === undefined ? {} : { operations: effect.operations }),
            duration,
          },
        ],
      };
};

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
  const countedScope =
    effect.scope?.type === "next-actions" || effect.scope?.type === "next-rolls"
      ? numeric(effect.scope.count, context)
      : undefined;
  return amount === undefined || (countedScope !== undefined && countedScope < 1)
    ? emptyEffectChanges()
    : {
        ...emptyEffectChanges(),
        rollModifications: [
          {
            target,
            roll: effect.roll,
            modifier: effect.modifier,
            amount,
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

const triggeredEffectHandlers: Partial<Record<EffectDefinition["type"], TriggeredEffectHandler>> = {
  "modify-damage": (effect, _move, context, target) =>
    damageModificationEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "modify-damage" }>,
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
      context,
      target,
    ),
  "force-action": (effect, _move, _context, target) =>
    forcedActionEffectChanges(
      effect as Extract<EffectDefinition, { readonly type: "force-action" }>,
      target,
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
    | "on-success",
  target: "self" | "opponent",
) => {
  if (
    effect.trigger !== trigger ||
    effect.optional === true ||
    effect.activationGroup !== undefined ||
    !effectMatches(effect, context)
  ) {
    return emptyEffectChanges();
  }
  const handler = triggeredEffectHandlers[effect.type];
  return handler === undefined ? emptyEffectChanges() : handler(effect, move, context, target);
};

export const moveEffectsForTrigger = (
  move: MoveDefinition,
  trigger:
    | "action-phase"
    | "after-defense-roll"
    | "before-attack-roll"
    | "before-defense-roll"
    | "passive"
    | "on-stopped"
    | "on-success",
  context: MoveEffectRuntimeContext,
): {
  readonly resources: readonly ResourceChange[];
  readonly statuses: readonly StatusApplication[];
  readonly damageModifications: readonly DamageModification[];
  readonly forcedActions: readonly ForcedActionApplication[];
  readonly locks: readonly LockApplication[];
  readonly deactivations: readonly DeactivationApplication[];
  readonly moveUsePreventions: readonly MoveUsePreventionApplication[];
  readonly statusPreventions: readonly StatusPreventionApplication[];
  readonly rollModifications: readonly RollModification[];
  readonly rollDefinitions: readonly RollDefinitionOverride[];
  readonly rollResultOverrides: readonly RollResultOverride[];
  readonly resolutionThresholds: readonly ResolutionThresholdApplication[];
  readonly resolutionPreventions: readonly ResolutionPreventionApplication[];
  readonly combatResultPreventions: readonly CombatResultPreventionApplication[];
  readonly rollModificationPreventions: readonly RollModificationPreventionApplication[];
  readonly moveModificationPreventions: readonly MoveModificationPreventionApplication[];
  readonly costModifications: readonly CostModification[];
} => {
  const resources: ResourceChange[] = [];
  const statuses: StatusApplication[] = [];
  const damageModifications: DamageModification[] = [];
  const forcedActions: ForcedActionApplication[] = [];
  const locks: LockApplication[] = [];
  const deactivations: DeactivationApplication[] = [];
  const moveUsePreventions: MoveUsePreventionApplication[] = [];
  const statusPreventions: StatusPreventionApplication[] = [];
  const rollModifications: RollModification[] = [];
  const rollDefinitions: RollDefinitionOverride[] = [];
  const rollResultOverrides: RollResultOverride[] = [];
  const resolutionThresholds: ResolutionThresholdApplication[] = [];
  const resolutionPreventions: ResolutionPreventionApplication[] = [];
  const combatResultPreventions: CombatResultPreventionApplication[] = [];
  const rollModificationPreventions: RollModificationPreventionApplication[] = [];
  const moveModificationPreventions: MoveModificationPreventionApplication[] = [];
  const costModifications: CostModification[] = [];
  for (const [effectIndex, effect] of (move.effects ?? []).entries()) {
    const compiled = compileEffectPlan({
      sourceDefinitionId: move.id,
      effectIndex,
      effect,
    });
    if (!compiled.ok) continue;
    for (const target of effectTargets(compiled.value.definition)) {
      const resolved = executeCompiledEffect(compiled.value, { move, target });
      const changes = triggeredEffectChanges(resolved.effect, move, context, trigger, target);
      resources.push(...changes.resources);
      statuses.push(...changes.statuses);
      damageModifications.push(...changes.damageModifications);
      forcedActions.push(...changes.forcedActions);
      locks.push(...changes.locks);
      deactivations.push(...changes.deactivations);
      moveUsePreventions.push(...changes.moveUsePreventions);
      statusPreventions.push(...changes.statusPreventions);
      rollModifications.push(...changes.rollModifications);
      rollDefinitions.push(...changes.rollDefinitions);
      rollResultOverrides.push(...changes.rollResultOverrides);
      resolutionThresholds.push(...changes.resolutionThresholds);
      resolutionPreventions.push(...changes.resolutionPreventions);
      combatResultPreventions.push(...changes.combatResultPreventions);
      rollModificationPreventions.push(...changes.rollModificationPreventions);
      moveModificationPreventions.push(...changes.moveModificationPreventions);
      costModifications.push(...changes.costModifications);
    }
  }
  return {
    resources,
    statuses,
    damageModifications,
    forcedActions,
    locks,
    deactivations,
    moveUsePreventions,
    statusPreventions,
    rollModifications,
    rollDefinitions,
    rollResultOverrides,
    resolutionThresholds,
    resolutionPreventions,
    combatResultPreventions,
    rollModificationPreventions,
    moveModificationPreventions,
    costModifications,
  };
};

export const successfulMoveEffects = (move: MoveDefinition, context: MoveEffectRuntimeContext) =>
  moveEffectsForTrigger(move, "on-success", context);

export const stoppedMoveEffects = (move: MoveDefinition, context: MoveEffectRuntimeContext) =>
  moveEffectsForTrigger(move, "on-stopped", context);
