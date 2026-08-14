import type {
  MoveDefinition,
  MoveSelectorCondition,
  NumericExpression,
} from "@dragonball-resurgence/game-data";

import type { ActiveCombatEffect, CombatActionRecord, CombatantState } from "./contracts.js";

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
  /** Durable active effects used by active-move numeric expressions. */
  readonly activeEffects?: readonly ActiveCombatEffect[];
  readonly moves: ReadonlyMap<string, MoveDefinition>;
  readonly moveActivationCounts?: ReadonlyMap<string, number>;
  readonly paidActivationCost?: number;
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
      effect.lifecycle === "deactivated" ||
      seenMoveIds.has(effect.sourceDefinitionId)
    )
      return [];
    const move = context.moves.get(effect.sourceDefinitionId);
    if (move === undefined) return [];
    seenMoveIds.add(effect.sourceDefinitionId);
    return [move];
  });
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
        (move.effectText.includes(expression.effectTextIncludes) ||
          move.name.includes(expression.effectTextIncludes)),
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
    const value = combatantForSubject(context, expression.subject).stats.dexterityBonus;
    return Math.min(expression.maximum, Math.max(expression.minimum, value));
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
  "paid-activation-cost": (expression, context) =>
    isType(expression, "paid-activation-cost") && expression.resource === "ki"
      ? context.paidActivationCost
      : undefined,
  "move-activation-count": (expression, context) =>
    isType(expression, "move-activation-count")
      ? (context.moveActivationCounts?.get(expression.moveId) ?? 0) * expression.perActivation
      : undefined,
  "successful-hit-count": (expression, context) =>
    isType(expression, "successful-hit-count") && context.successfulHitCount !== undefined
      ? context.successfulHitCount * (expression.perHit ?? 1)
      : undefined,
  "consecutive-combat-results": (expression, context) =>
    isType(expression, "consecutive-combat-results")
      ? consecutiveCombatResultCount(expression, context)
      : undefined,
  "combat-result-count": (expression, context) =>
    isType(expression, "combat-result-count") ? combatResultCount(expression, context) : undefined,
  "prior-roll-result": (expression, context) => {
    if (!isType(expression, "prior-roll-result") || context.actionHistory === undefined)
      return undefined;
    const priorAttack = [...context.actionHistory]
      .reverse()
      .find(
        (action) =>
          (action.type === "basic-attack" || action.type === "use-move") &&
          (expression.roll === "attack"
            ? action.actorId === context.self.id && action.attackRollResult !== undefined
            : action.targetCombatantId === context.self.id &&
              action.defenseRollResult !== undefined),
      );
    if (
      priorAttack === undefined ||
      (priorAttack.type !== "basic-attack" && priorAttack.type !== "use-move")
    )
      return undefined;
    const result =
      expression.roll === "attack" ? priorAttack.attackRollResult : priorAttack.defenseRollResult;
    return result === undefined
      ? undefined
      : result * (expression.multiplier ?? 1) + (expression.addition ?? 0);
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
  "completed-combat-turn-count": (expression, context) =>
    isType(expression, "completed-combat-turn-count")
      ? context.completedTurnCount * expression.perTurn
      : undefined,
};

export const evaluateDurableNumericExpression = (
  expression: NumericExpression,
  context: NumericExpressionContext,
) => durableExpressionHandlers[expression.type]?.(expression, context);

const matchesBaseKiCost = (
  move: MoveDefinition,
  selector: NonNullable<MoveSelectorCondition["baseKiCost"]>,
) => {
  const cost = move.mechanics.kiCost;
  if (cost?.type !== "literal" || selector.value.type !== "literal") return false;
  switch (selector.comparison) {
    case "at-least":
      return cost.value >= selector.value.value;
    case "at-most":
      return cost.value <= selector.value.value;
    case "exactly":
      return cost.value === selector.value.value;
  }
};

const matchesMoveIdentity = (move: MoveDefinition, selector: MoveSelectorCondition) => {
  if (selector.ids !== undefined && !selector.ids.includes(move.id)) return false;
  if (selector.styleId !== undefined && move.styleId !== selector.styleId) return false;
  return selector.styleIdExcludes === undefined || move.styleId !== selector.styleIdExcludes;
};

const matchesMoveCategory = (move: MoveDefinition, selector: MoveSelectorCondition) =>
  (selector.category === undefined || move.category === selector.category) &&
  (selector.categories === undefined || selector.categories.includes(move.category)) &&
  !selector.categoryExcludes?.includes(move.category);

const matchesMoveTags = (move: MoveDefinition, selector: MoveSelectorCondition) =>
  selector.tags === undefined ||
  selector.tags.every((tag) => move.tags.includes(tag as (typeof move.tags)[number]));

const matchesMoveClassification = (move: MoveDefinition, selector: MoveSelectorCondition) => {
  if (selector.custom !== undefined && (move.styleId === undefined) !== selector.custom)
    return false;
  if (
    selector.restriction !== undefined &&
    (move.mechanics.restrictedUses !== undefined) !== (selector.restriction === "restricted")
  )
    return false;
  return (
    selector.constant === undefined ||
    move.effectClauses.some((clause) => clause.text === "Constant.") === selector.constant
  );
};

const matchesMoveEffectText = (move: MoveDefinition, selector: MoveSelectorCondition) =>
  (selector.effectTextIncludes === undefined ||
    move.effectText.includes(selector.effectTextIncludes)) &&
  (selector.effectTextIncludesAny === undefined ||
    selector.effectTextIncludesAny.some((text) => move.effectText.includes(text))) &&
  (selector.effectTextExcludes === undefined ||
    !move.effectText.includes(selector.effectTextExcludes));

const matchesMoveRequirements = (move: MoveDefinition, selector: MoveSelectorCondition) => {
  const requirements = move.requirements ?? [];
  if (
    selector.requirementIncludes !== undefined &&
    !selector.requirementIncludes.every((required) =>
      requirements.some(
        (requirement) => requirement.type === "source-text" && requirement.text === required,
      ),
    )
  )
    return false;
  return (
    selector.requirementExcludes === undefined ||
    selector.requirementExcludes.every(
      (excluded) =>
        !requirements.some(
          (requirement) => requirement.type === "source-text" && requirement.text === excluded,
        ),
    )
  );
};

const matchesMoveAttackRoll = (move: MoveDefinition, selector: MoveSelectorCondition) => {
  const requested = selector.attackRoll;
  if (requested === undefined) return true;
  const actual = move.mechanics.attack?.attackRoll;
  return (
    actual?.dice === requested.dice &&
    (requested.minimumDice === undefined || (actual?.dice ?? 0) >= requested.minimumDice) &&
    actual?.sides === requested.sides
  );
};

/** Matches the declarative, move-local portions of a converted selector. */
export const matchesMoveSelector = (move: MoveDefinition, selector: MoveSelectorCondition) => {
  if (!matchesMoveIdentity(move, selector) || !matchesMoveCategory(move, selector)) return false;
  if (!matchesMoveTags(move, selector) || !matchesMoveClassification(move, selector)) return false;
  if (!matchesMoveEffectText(move, selector) || !matchesMoveAttackRoll(move, selector))
    return false;
  if (!matchesMoveRequirements(move, selector)) return false;
  if (selector.baseKiCost !== undefined && !matchesBaseKiCost(move, selector.baseKiCost))
    return false;
  return true;
};
