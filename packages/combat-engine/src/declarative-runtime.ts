import type {
  MoveDefinition,
  MoveSelectorCondition,
  NumericExpression,
} from "@dragonball-resurgence/game-data";

import type { CombatantState } from "./contracts.js";

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
  readonly moves: ReadonlyMap<string, MoveDefinition>;
  readonly moveActivationCounts?: ReadonlyMap<string, number>;
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
  "bounded-stat": (expression, context) => {
    if (!isType(expression, "bounded-stat")) return undefined;
    const value = combatantForSubject(context, expression.subject).stats.dexterityBonus;
    return Math.min(expression.maximum, Math.max(expression.minimum, value));
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
  "move-activation-count": (expression, context) =>
    isType(expression, "move-activation-count")
      ? (context.moveActivationCounts?.get(expression.moveId) ?? 0) * expression.perActivation
      : undefined,
  "successful-hit-count": (expression, context) =>
    isType(expression, "successful-hit-count") && context.successfulHitCount !== undefined
      ? context.successfulHitCount * (expression.perHit ?? 1)
      : undefined,
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
  if (selector.baseKiCost !== undefined && !matchesBaseKiCost(move, selector.baseKiCost))
    return false;
  return true;
};
