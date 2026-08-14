import type {
  MoveDefinition,
  MoveSelectorCondition,
  NumericExpression,
} from "@dragonball-resurgence/game-data";
import { GLOBAL_RULES } from "@dragonball-resurgence/game-config";

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
  /** The completed single-die action currently being resolved, when available. */
  readonly currentAction?: Extract<
    CombatActionRecord,
    { readonly type: "basic-attack" | "use-move" }
  >;
  /** Durable active effects used by active-move numeric expressions. */
  readonly activeEffects?: readonly ActiveCombatEffect[];
  readonly moves: ReadonlyMap<string, MoveDefinition>;
  readonly moveActivationCounts?: ReadonlyMap<string, number>;
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
  "triggering-move-base-ki-cost": (expression, context) => {
    if (!isType(expression, "triggering-move-base-ki-cost")) return undefined;
    const moveContext = triggeringMoveContext(context);
    const cost = moveContext?.triggeringMove?.mechanics.kiCost;
    return moveContext === undefined || cost === undefined
      ? undefined
      : evaluateDurableNumericExpression(cost, moveContext);
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
  if (move.mechanics.attack === undefined) return false;
  const actual = move.mechanics.attack.attackRoll;
  const dice = actual?.dice ?? 1;
  const sides = actual?.sides ?? GLOBAL_RULES.combat.standardDieSides;
  return (
    (requested.dice === undefined || dice === requested.dice) &&
    (requested.minimumDice === undefined || dice >= requested.minimumDice) &&
    (requested.sides === undefined || sides === requested.sides) &&
    (requested.maximumSides === undefined || sides <= requested.maximumSides)
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
