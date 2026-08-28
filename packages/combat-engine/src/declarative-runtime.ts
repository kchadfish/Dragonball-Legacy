import type {
  MoveDefinition,
  MoveSelectorCondition,
  NumericExpression,
} from "@dragonball-resurgence/game-data";
import type { ActiveCombatEffect, CombatActionRecord, CombatantState } from "./contracts.js";
import { matchesMoveSelector as sharedMatchesMoveSelector } from "./selector-matching.js";
import { isEffectActive } from "./effect-lifecycle.js";

/**
 * The state available to source-transcribed numeric expressions. Values that
 * require an in-flight roll, stored selection, or prior action are supplied by
 * the resolver that owns that phase rather than guessed here.
 */
export interface NumericExpressionContext {
  readonly self: CombatantState;
  readonly opponent: CombatantState;
  readonly turnNumber: number;
  readonly participantCount: number;
  readonly completedTurnCount: number;
  /** Present only after the owning attack has persisted its roll results. */
  readonly successfulHitCount?: number;
  /** Ordered actions are used for expressions that explicitly reference a prior roll. */
  readonly actionHistory?: readonly CombatActionRecord[];
  /** The completed single-die action currently being resolved, when available. */
  readonly currentAction?: Extract<
    CombatActionRecord,
    { readonly type: "basic-attack" | "use-move" }
  >;
  /** Durable active effects used by active-move numeric expressions. */
  readonly activeEffects?: readonly ActiveCombatEffect[];
  readonly moves: ReadonlyMap<string, MoveDefinition>;
  readonly moveActivationCounts?: ReadonlyMap<string, number>;
  /** The declarative move whose numeric effect is being resolved. */
  readonly sourceMoveId?: string;
  readonly paidActivationCost?: number;
  /** Dice and move context for expressions owned by the current resolution phase. */
  readonly rolls?: readonly {
    readonly attackResult: number;
    readonly outcome: "blocked" | "stopped" | "successful";
  }[];
  readonly triggeringMove?: MoveDefinition;
  readonly triggeringMoveOwner?: "self" | "opponent";
  /** Final damage dealt by the current attack when a resource effect consumes it. */
  readonly currentDamage?: number;
  /** Damage dealt by the attack stopped by the current block resolution. */
  readonly blockedAttackDamage?: number;
  /** Values selected through a pending declarative numeric choice. */
  readonly selectedNumericValues?: Readonly<Record<string, number>>;
}

const combatantForSubject = (context: NumericExpressionContext, subject: "self" | "opponent") =>
  subject === "self" ? context.self : context.opponent;

const resourceValue = (
  combatant: CombatantState,
  resource: "hp" | "ki",
  basis: "current" | "total",
) => {
  const value = resource === "hp" ? combatant.hitPoints : combatant.ki;
  return basis === "current" ? value.current : value.maximum;
};

const movesForCombatant = (context: NumericExpressionContext, combatant: CombatantState) =>
  combatant.moveIds.flatMap((moveId) => {
    const move = context.moves.get(moveId);
    return move === undefined ? [] : [move];
  });

const activeConstantMovesForCombatant = (
  context: NumericExpressionContext,
  combatant: CombatantState,
) => {
  const seenMoveIds = new Set<string>();
  return (context.activeEffects ?? []).flatMap((effect) => {
    if (
      effect.type !== "active-constant" ||
      effect.sourceCombatantId !== combatant.id ||
      !isEffectActive(effect) ||
      seenMoveIds.has(effect.sourceDefinitionId)
    )
      return [];
    const move = context.moves.get(effect.sourceDefinitionId);
    if (move === undefined) return [];
    seenMoveIds.add(effect.sourceDefinitionId);
    return [move];
  });
};

const triggeringMoveContext = (context: NumericExpressionContext) => {
  if (context.triggeringMove === undefined || context.triggeringMoveOwner === undefined)
    return undefined;
  const self = context.triggeringMoveOwner === "self" ? context.self : context.opponent;
  const opponent = context.triggeringMoveOwner === "self" ? context.opponent : context.self;
  return { ...context, self, opponent };
};

const triggeringMoveBaseDamage = (context: NumericExpressionContext) => {
  const moveContext = triggeringMoveContext(context);
  const attack = moveContext?.triggeringMove?.mechanics.attack;
  if (moveContext === undefined || attack?.baseDamagePercent === undefined) return undefined;
  const baseDamagePercent = evaluateDurableNumericExpression(attack.baseDamagePercent, moveContext);
  if (baseDamagePercent === undefined) return undefined;
  const baseDamage = Math.round((moveContext.self.stats.power * baseDamagePercent) / 100);
  return attack.damagePerHit === true
    ? baseDamage * Math.max(1, context.successfulHitCount ?? 0)
    : baseDamage;
};

type AttackActionRecord = Extract<
  CombatActionRecord,
  { readonly type: "basic-attack" | "use-move" }
>;

const attackActionsForActor = (context: NumericExpressionContext, actorId: string) =>
  (context.actionHistory ?? []).filter(
    (action): action is AttackActionRecord =>
      (action.type === "basic-attack" || action.type === "use-move") &&
      action.actorId === actorId &&
      action.outcome !== undefined,
  );

const actionMatchesCombatResult = (
  action: AttackActionRecord,
  result: "successful" | "stopped" | "critical" | "counter",
) => {
  if (result === "critical") return action.critical === true;
  if (result === "counter") return action.counter === true;
  return action.outcome === result;
};

const combatResultCount = (
  expression: Extract<NumericExpression, { readonly type: "combat-result-count" }>,
  context: NumericExpressionContext,
) => {
  const actorId = expression.actor === "self" ? context.self.id : context.opponent.id;
  const count = attackActionsForActor(context, actorId).filter((action) =>
    actionMatchesCombatResult(action, expression.result),
  ).length;
  const multiplied = count * expression.perResult;
  const minimum =
    expression.minimum === undefined ? multiplied : Math.max(multiplied, expression.minimum);
  return expression.maximum === undefined ? minimum : Math.min(minimum, expression.maximum);
};

const consecutiveCombatResultCount = (
  expression: Extract<NumericExpression, { readonly type: "consecutive-combat-results" }>,
  context: NumericExpressionContext,
) => {
  const actorId = expression.actor === "self" ? context.self.id : context.opponent.id;
  let count = 0;
  for (const action of [...attackActionsForActor(context, actorId)].reverse()) {
    if (actionMatchesCombatResult(action, expression.resetBy)) break;
    if (!actionMatchesCombatResult(action, expression.result)) break;
    count += 1;
  }
  const multiplied = count * expression.perResult;
  return expression.maximum === undefined ? multiplied : Math.min(multiplied, expression.maximum);
};

/**
 * Evaluates expressions whose inputs exist in durable combat state. Undefined
 * deliberately means the caller must provide the missing phase-local context;
 * it is never treated as zero.
 */
type NumericExpressionHandler = (
  expression: NumericExpression,
  context: NumericExpressionContext,
) => number | undefined;

const isType = <TType extends NumericExpression["type"]>(
  expression: NumericExpression,
  type: TType,
): expression is Extract<NumericExpression, { readonly type: TType }> => expression.type === type;

const durableExpressionHandlers: Partial<
  Record<NumericExpression["type"], NumericExpressionHandler>
> = {
  literal: (expression) => (isType(expression, "literal") ? expression.value : undefined),
  "turns-after-turn": (expression, context) =>
    isType(expression, "turns-after-turn")
      ? Math.min(
          Math.max(0, context.turnNumber - expression.turn) * expression.perTurn,
          expression.maximum,
        )
      : undefined,
  "participant-count": (expression, context) => {
    if (!isType(expression, "participant-count")) return undefined;
    const includedParticipants = context.participantCount - (expression.excludeSelf ? 1 : 0);
    return Math.min(
      Math.max(0, includedParticipants) * expression.perParticipant,
      expression.maximum,
    );
  },
  "moveset-move-count": (expression, context) =>
    isType(expression, "moveset-move-count")
      ? movesForCombatant(context, combatantForSubject(context, expression.subject)).filter(
          (move) => move.category === expression.category,
        ).length
      : undefined,
  "active-move-effect-text-count": (expression, context) => {
    if (!isType(expression, "active-move-effect-text-count")) return undefined;
    const count = activeConstantMovesForCombatant(
      context,
      combatantForSubject(context, expression.subject),
    ).filter(
      (move) =>
        move.category === expression.category &&
        expression.titleTag !== undefined &&
        (move.mechanics.titleTags ?? []).includes(expression.titleTag),
    ).length;
    return count * expression.perMove;
  },
  "active-move-count": (expression, context) => {
    if (!isType(expression, "active-move-count")) return undefined;
    const count = activeConstantMovesForCombatant(
      context,
      combatantForSubject(context, expression.subject),
    ).filter((move) => move.category === expression.category).length;
    return count * expression.perMove;
  },
  "bounded-stat": (expression, context) => {
    if (!isType(expression, "bounded-stat")) return undefined;
    const value =
      combatantForSubject(context, expression.subject).stats.dexterityBonus +
      (expression.offset ?? 0);
    const minimum = Math.max(expression.minimum, value);
    return expression.maximum === undefined ? minimum : Math.min(expression.maximum, minimum);
  },
  "stat-offset": (expression, context) => {
    if (!isType(expression, "stat-offset")) return undefined;
    const value =
      combatantForSubject(context, expression.subject).stats.dexterityBonus + expression.offset;
    const minimum = expression.minimum === undefined ? value : Math.max(expression.minimum, value);
    return expression.maximum === undefined ? minimum : Math.min(expression.maximum, minimum);
  },
  "resource-percent": (expression, context) =>
    isType(expression, "resource-percent")
      ? Math.round(
          (resourceValue(
            combatantForSubject(context, expression.subject),
            expression.resource,
            expression.basis,
          ) *
            expression.percent) /
            100,
        )
      : undefined,
  "stat-percent": (expression, context) =>
    isType(expression, "stat-percent")
      ? Math.round(
          (combatantForSubject(context, expression.subject).stats.power * expression.percent) / 100,
        )
      : undefined,
  "stat-quotient": (expression, context) =>
    isType(expression, "stat-quotient")
      ? Math.floor(
          combatantForSubject(context, expression.subject).stats.power / expression.divisor,
        )
      : undefined,
  "moveset-tag-count": (expression, context) => {
    if (!isType(expression, "moveset-tag-count")) return undefined;
    const count = movesForCombatant(
      context,
      combatantForSubject(context, expression.subject),
    ).filter((move) => move.tags.includes(expression.tag as (typeof move.tags)[number])).length;
    const value = count * expression.perMove;
    return expression.maximum === undefined ? value : Math.min(value, expression.maximum);
  },
  "current-resource": (expression, context) =>
    isType(expression, "current-resource")
      ? combatantForSubject(context, expression.subject).ki.current
      : undefined,
  "resource-from-threshold": (expression, context) =>
    isType(expression, "resource-from-threshold")
      ? expression.sign *
        (expression.threshold - combatantForSubject(context, expression.subject).ki.current)
      : undefined,
  "paid-activation-cost": (expression, context) =>
    isType(expression, "paid-activation-cost") && expression.resource === "ki"
      ? context.paidActivationCost
      : undefined,
  "move-activation-count": (expression, context) =>
    isType(expression, "move-activation-count")
      ? (context.moveActivationCounts?.get(expression.moveId) ?? 0) * expression.perActivation
      : undefined,
  "prior-move-activation-count": (expression, context) => {
    if (!isType(expression, "prior-move-activation-count")) return undefined;
    if (expression.move !== "source" || context.sourceMoveId === undefined) return undefined;
    return (context.self.moveUses[context.sourceMoveId] ?? 0) * expression.perActivation;
  },
  "source-move-ki-cost": (expression, context) => {
    if (!isType(expression, "source-move-ki-cost")) return undefined;
    if (context.sourceMoveId === undefined) return undefined;
    const sourceMove = context.moves.get(context.sourceMoveId);
    const kiCost = sourceMove?.mechanics.kiCost;
    return kiCost === undefined ? undefined : evaluateDurableNumericExpression(kiCost, context);
  },
  "source-move-calculated-ki-cost": (expression, context) => {
    if (!isType(expression, "source-move-calculated-ki-cost")) return undefined;
    if (context.sourceMoveId === undefined) return undefined;
    const sourceMove = context.moves.get(context.sourceMoveId);
    const kiCost = sourceMove?.mechanics.kiCost;
    return kiCost === undefined ? undefined : evaluateDurableNumericExpression(kiCost, context);
  },
  "successful-hit-count": (expression, context) =>
    isType(expression, "successful-hit-count") && context.successfulHitCount !== undefined
      ? context.successfulHitCount * (expression.perHit ?? 1)
      : undefined,
  "successful-hit-count-groups": (expression, context) =>
    isType(expression, "successful-hit-count-groups") &&
    context.successfulHitCount !== undefined &&
    Number.isInteger(expression.groupSize) &&
    expression.groupSize >= 1
      ? Math.floor(context.successfulHitCount / expression.groupSize)
      : undefined,
  "consecutive-combat-results": (expression, context) =>
    isType(expression, "consecutive-combat-results")
      ? consecutiveCombatResultCount(expression, context)
      : undefined,
  "combat-result-count": (expression, context) =>
    isType(expression, "combat-result-count") ? combatResultCount(expression, context) : undefined,
  "prior-roll-result": (expression, context) => {
    if (!isType(expression, "prior-roll-result")) return undefined;
    const currentAction = context.currentAction;
    const currentActionMatches =
      currentAction !== undefined &&
      (expression.roll === "attack"
        ? currentAction.actorId === context.self.id && currentAction.attackRollResult !== undefined
        : currentAction.targetCombatantId === context.self.id &&
          currentAction.defenseRollResult !== undefined);
    let priorAttack:
      Extract<CombatActionRecord, { readonly type: "basic-attack" | "use-move" }> | undefined =
      currentActionMatches ? currentAction : undefined;
    if (priorAttack === undefined && context.actionHistory !== undefined)
      priorAttack = [...context.actionHistory]
        .reverse()
        .find(
          (
            action,
          ): action is Extract<
            CombatActionRecord,
            { readonly type: "basic-attack" | "use-move" }
          > =>
            (action.type === "basic-attack" || action.type === "use-move") &&
            (expression.roll === "attack"
              ? action.actorId === context.self.id && action.attackRollResult !== undefined
              : action.targetCombatantId === context.self.id &&
                action.defenseRollResult !== undefined),
        );
    if (priorAttack === undefined) return undefined;
    const result =
      expression.roll === "attack" ? priorAttack.attackRollResult : priorAttack.defenseRollResult;
    return result === undefined
      ? undefined
      : result * (expression.multiplier ?? 1) + (expression.addition ?? 0);
  },
  "prior-attack-damage-percent": (expression, context) => {
    if (!isType(expression, "prior-attack-damage-percent")) return undefined;
    const actorId = context.opponent.id;
    const priorAttacks = (context.actionHistory ?? [])
      .filter(
        (action): action is Extract<CombatActionRecord, { readonly type: "use-move" }> =>
          action.type === "use-move" &&
          action.actorId === actorId &&
          action.targetCombatantId === context.self.id &&
          action.outcome === "successful" &&
          action.damageDealt !== undefined &&
          context.moves.get(action.moveId)?.category === "advanced-attack",
      )
      .slice(-expression.count);
    if (priorAttacks.length < expression.count) return undefined;
    return priorAttacks.reduce((total, action) => {
      const power = context.opponent.stats.power;
      return total + (action.damageDealt! * 100) / power;
    }, 0);
  },
  minimum: (expression, context) => {
    if (!isType(expression, "minimum")) return undefined;
    const values = expression.values.map((value) =>
      evaluateDurableNumericExpression(value, context),
    );
    return values.every((value): value is number => value !== undefined)
      ? Math.min(...values)
      : undefined;
  },
  "selected-dice-count": (expression, context) => {
    if (!isType(expression, "selected-dice-count")) return undefined;
    const selected = context.selectedNumericValues?.[expression.selectionKey];
    if (selected === undefined) return undefined;
    if (expression.operation === "negate") return -selected;
    const groupSize = expression.groupSize;
    const perGroup = expression.perGroup;
    return groupSize === undefined || perGroup === undefined
      ? undefined
      : Math.floor(selected / groupSize) * perGroup;
  },
  "completed-combat-turn-count": (expression, context) =>
    isType(expression, "completed-combat-turn-count")
      ? context.completedTurnCount * expression.perTurn
      : undefined,
  "triggering-move-base-ki-cost": (expression, context) => {
    if (!isType(expression, "triggering-move-base-ki-cost")) return undefined;
    const moveContext = triggeringMoveContext(context);
    const cost = moveContext?.triggeringMove?.mechanics.kiCost;
    return moveContext === undefined || cost === undefined
      ? undefined
      : evaluateDurableNumericExpression(cost, moveContext);
  },
  "triggering-move-ki-cost": (expression, context) => {
    if (!isType(expression, "triggering-move-ki-cost")) return undefined;
    const moveContext = triggeringMoveContext(context);
    const cost = moveContext?.triggeringMove?.mechanics.kiCost;
    const baseCost =
      moveContext === undefined || cost === undefined
        ? undefined
        : evaluateDurableNumericExpression(cost, moveContext);
    return baseCost === undefined ? undefined : baseCost + (expression.addition ?? 0);
  },
  "resource-percent-per-successful-hit": (expression, context) => {
    if (!isType(expression, "resource-percent-per-successful-hit")) return undefined;
    if (context.successfulHitCount === undefined) return undefined;
    return Math.round(
      (resourceValue(
        combatantForSubject(context, expression.subject),
        expression.resource,
        expression.basis,
      ) *
        expression.percentPerHit *
        context.successfulHitCount) /
        100,
    );
  },
  "resource-percent-per-successful-roll-threshold": (expression, context) => {
    if (!isType(expression, "resource-percent-per-successful-roll-threshold")) return undefined;
    if (
      expression.roll !== "attack" ||
      expression.comparison !== "above" ||
      context.rolls === undefined
    )
      return undefined;
    const qualifyingRolls = context.rolls.filter(
      (roll) => roll.outcome === "successful" && roll.attackResult > expression.value,
    ).length;
    return Math.round(
      (resourceValue(
        combatantForSubject(context, expression.subject),
        expression.resource,
        expression.basis,
      ) *
        expression.percentPerRoll *
        qualifyingRolls) /
        100,
    );
  },
  "damage-percent": (expression) =>
    isType(expression, "damage-percent") ? expression.percent : undefined,
  "blocked-attack-damage": (expression, context) =>
    isType(expression, "blocked-attack-damage") && context.blockedAttackDamage !== undefined
      ? Math.round(context.blockedAttackDamage * expression.multiplier)
      : undefined,
  "stat-difference-percent": (expression, context) => {
    if (!isType(expression, "stat-difference-percent")) return undefined;
    if (expression.stat !== "dexterity-bonus") return undefined;
    const difference =
      combatantForSubject(context, expression.left).stats.dexterityBonus -
      combatantForSubject(context, expression.right).stats.dexterityBonus;
    const value = Math.max(0, difference) * expression.percentPerPoint;
    return expression.maximum === undefined ? value : Math.min(value, expression.maximum);
  },
  "triggering-move-base-damage": (expression, context) =>
    isType(expression, "triggering-move-base-damage")
      ? (() => {
          const baseDamage = triggeringMoveBaseDamage(context);
          return baseDamage === undefined
            ? undefined
            : Math.round(baseDamage * expression.multiplier);
        })()
      : undefined,
  "triggering-move-base-damage-percent": (expression, context) => {
    if (!isType(expression, "triggering-move-base-damage-percent")) return undefined;
    const moveContext = triggeringMoveContext(context);
    const baseDamagePercent =
      moveContext?.triggeringMove?.mechanics.attack?.baseDamagePercent === undefined
        ? undefined
        : evaluateDurableNumericExpression(
            moveContext.triggeringMove.mechanics.attack.baseDamagePercent,
            moveContext,
          );
    return baseDamagePercent === undefined ? undefined : baseDamagePercent / expression.divisor;
  },
};

export const evaluateDurableNumericExpression = (
  expression: NumericExpression,
  context: NumericExpressionContext,
) => durableExpressionHandlers[expression.type]?.(expression, context);

/** Matches the declarative, move-local portions of a converted selector. */
export const matchesMoveSelector = (move: MoveDefinition, selector: MoveSelectorCondition) => {
  return sharedMatchesMoveSelector(move, selector);
};
