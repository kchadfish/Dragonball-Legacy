import { GLOBAL_RULES } from "@dragonball-resurgence/game-config";
import {
  ITEM_DEFINITIONS,
  MOVE_DEFINITIONS,
  TRANSFORMATION_DEFINITIONS,
  type ItemDefinition,
  type EffectDefinition,
  type MoveDefinition,
  type MoveSelectorCondition,
} from "@dragonball-resurgence/game-data";

import {
  blockedDiceForDeclaredBlock,
  resolveContestedAttackRolls,
  type AttackDieRoll,
  type ContestedAttackNaturalRoll,
  type ResolutionThresholdRule,
} from "./attack-rolls.js";
import { calculateConvertedBlockCost, evaluateBlockEligibility } from "./block-mechanics.js";
import {
  calculateAttackDamage,
  calculateKiCost,
  canContinueCounterChain,
  qualifiesForCounter,
  qualifiesForCritical,
  isRestrictedUseAvailable,
  isSignatureTurnAvailable,
} from "./combat-mechanics.js";
import { defaultMoveAttackRoll, resolveMoveAttack } from "./move-attacks.js";
import { evaluateDurableNumericExpression, matchesMoveSelector } from "./declarative-runtime.js";
import { compileEffectPlan } from "./effect-executors.js";
import {
  classifyCurrentActionMove,
  moveEffectsForTrigger,
  rerollEffectsAfterDefense,
  stoppedMoveEffects,
  successfulMoveEffects,
  type ResourceChange,
  type ResourceChangeEvent,
  type StatusApplication,
  type LockApplication,
  type SuppressionApplication,
  type ActionRestrictionApplication,
  type ActivationApplication,
  type DeactivationApplication,
  type FloatingEffectApplication,
  type ExtraActionApplication,
  type ScheduledResourceApplication,
  type MoveUsePreventionApplication,
  type RemainingUseModificationApplication,
  type StatusPreventionApplication,
  type RollModification,
  type PendingEffectChoice,
  type DamageModification,
  type StatModification,
  type RollDefinitionOverride,
  type CombatResultOverrideApplication,
  type CriticalThresholdApplication,
  type ResolutionPreventionApplication,
  type CombatResultPreventionApplication,
  type RollModificationPreventionApplication,
  type MoveModificationPreventionApplication,
  type ResourceModificationPreventionApplication,
  type ResolutionThresholdApplication,
  type CurrentActionCostModification,
  type StoredRollRequest,
  type RerollApplication,
} from "./move-effects-runtime.js";
import { isCombatResourceItem, resolveItemResources } from "./item-effects-runtime.js";
import { applyTransformation } from "./transformation-runtime.js";

import type {
  ActiveCombatEffect,
  ActiveCostModifierEffect,
  ActiveRollModificationCap,
  ActiveRollModifierEffect,
  CombatRollType,
  ActiveFightState,
  ActiveRerollEffect,
  ActiveStatus,
  BasicAttackDecision,
  BasicAttackType,
  CombatActionRecord,
  CombatDecision,
  CombatEvent,
  CombatFailure,
  CombatResult,
  CombatTransition,
  CombatantState,
  CompletedFightState,
  FightState,
  LegalDecision,
  PendingDecision,
  PendingDecisionOption,
  StoredRoll,
} from "./contracts.js";
import type { CombatDependencies } from "./dependencies.js";
import type { CombatantId, PendingDecisionId } from "./ids.js";
import { validateFightState } from "./invariants.js";

type RollModifierKind = "dice" | "result" | "sides";

const invalidFightState = (state: CombatTransition["state"]): CombatFailure => ({
  type: "invalid-fight-state",
  violations: validateFightState(state),
});

const createPhaseChangedEvent = (
  state: ActiveFightState,
  dependencies: CombatDependencies,
  phase: ActiveFightState["phase"],
  sequence: number,
  causedByDecisionId?: CombatDecision["id"],
): CombatEvent => ({
  id: dependencies.ids.nextEventId(),
  sequence,
  fightId: state.id,
  type: "phase-changed",
  phase,
  ...(causedByDecisionId === undefined ? {} : { causedByDecisionId }),
});

const transitionFrom = (
  state: FightState,
  events: readonly CombatEvent[],
): CombatResult<CombatTransition> => {
  const violations = validateFightState(state);
  if (violations.length > 0)
    return { ok: false, error: { type: "invalid-fight-state", violations } };

  return { ok: true, value: { state, events } };
};

const currentStateFailure = (state: CombatTransition["state"]): CombatFailure | undefined => {
  const violations = validateFightState(state);
  return violations.length === 0 ? undefined : { type: "invalid-fight-state", violations };
};

const nextActiveCombatantId = (state: ActiveFightState): CombatantId | undefined =>
  Object.values(state.combatants).find(
    (combatant) => combatant.id !== state.activeCombatantId && combatant.status === "active",
  )?.id;

type ResolvedActionDecision = Exclude<
  CombatDecision,
  Extract<CombatDecision, { readonly type: "respond-to-pending-decision" | "cancel-fight" }>
>;

const actionRecordFor = (
  state: ActiveFightState,
  decision: ResolvedActionDecision,
): CombatActionRecord => {
  const phase = state.phase === "counter" ? "counter" : "action";
  const base = {
    decisionId: decision.id,
    actorId: decision.actorId,
    turnNumber: state.turnNumber,
    phase,
  } as const;

  if (decision.type === "basic-attack") {
    return {
      ...base,
      type: decision.type,
      basicAttack: decision.basicAttack,
      targetCombatantId: decision.targetCombatantId,
    };
  }
  if (decision.type === "use-move") {
    return {
      ...base,
      type: decision.type,
      moveId: decision.moveId,
      targetCombatantId: decision.targetCombatantId,
    };
  }
  if (decision.type === "use-item") {
    return { ...base, type: decision.type, itemId: decision.itemId };
  }
  return { ...base, type: decision.type };
};

type ActionAttackResult = {
  readonly outcome: "successful" | "stopped";
  readonly critical: boolean;
  readonly counter: boolean;
  readonly attackRollResult?: number;
  readonly defenseRollResult?: number;
  readonly damageDealt?: number;
};

const actionRecordWithAttackResult = (
  state: ActiveFightState,
  decision: ResolvedActionDecision,
  result: ActionAttackResult,
): CombatActionRecord => {
  const action = actionRecordFor(state, decision);
  return action.type === "basic-attack" || action.type === "use-move"
    ? { ...action, ...result }
    : action;
};

const deathBeam = MOVE_DEFINITIONS.find((move) => move.id === "move-afterlife-death-beam");

const activeOpponent = (
  state: ActiveFightState,
  attackerId: CombatantId,
  targetId: CombatantId,
) => {
  if (!Object.hasOwn(state.combatants, targetId)) return undefined;

  const target = state.combatants[targetId];
  return target.status === "active" && target.id !== attackerId ? target : undefined;
};

const basicAttackDetails = (basicAttack: BasicAttackDecision["basicAttack"]) =>
  basicAttack === "basic-ki-blast"
    ? { attackType: "energy" as const, tags: ["blast"] as const }
    : {
        attackType: "physical" as const,
        tags: [basicAttack === "basic-punch" ? "punch" : "kick"] as const,
      };

type BlockableAttack = Parameters<typeof evaluateBlockEligibility>[1];

const moveAttackDetails = (
  move: MoveDefinition,
  addedTags: ReadonlyArray<MoveDefinition["tags"][number]> = [],
): BlockableAttack | undefined => {
  const attack = move.mechanics.attack;
  if (attack === undefined) return undefined;
  const additionalAttackTypes = addedTags.filter(
    (tag): tag is "physical" | "energy" =>
      (tag === "physical" || tag === "energy") && tag !== attack.type,
  );
  return {
    attackType: attack.type,
    ...(additionalAttackTypes.length === 0 ? {} : { additionalAttackTypes }),
    tags: move.tags,
    restricted: move.mechanics.restrictedUses !== undefined,
  };
};

const simpleActionMoveUseLimit = (move: MoveDefinition) => {
  const limits = (move.effects ?? []).flatMap((effect) => {
    if (effect.trigger !== "action-phase" || effect.useLimit?.scope !== "combat") return [];
    return typeof effect.useLimit.count === "number" ? [effect.useLimit.count] : [];
  });
  return limits.length === 0 ? undefined : Math.min(...limits);
};

const baseRestrictedMoveUseLimit = (
  state: ActiveFightState,
  combatant: CombatantState,
  move: MoveDefinition,
) => {
  const expression = move.mechanics.restrictedUses;
  if (expression === undefined) return undefined;
  const opponent = Object.values(state.combatants).find(
    (candidate) => candidate.id !== combatant.id,
  );
  if (opponent === undefined) return undefined;
  const resolved = evaluateDurableNumericExpression(expression, {
    self: combatant,
    opponent,
    turnNumber: state.turnNumber,
    participantCount: 2,
    completedTurnCount: state.turnNumber - 1,
    actionHistory: state.actionHistory,
    activeEffects: state.activeEffects,
    moves: new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate])),
    moveActivationCounts: moveActivationCounts(state),
  });
  return resolved === undefined ? undefined : Math.max(0, Math.floor(resolved));
};

const passiveRemainingUseModifier = (
  state: ActiveFightState,
  combatant: CombatantState,
  move: MoveDefinition,
) => {
  const opponent = Object.values(state.combatants).find(
    (candidate) => candidate.id !== combatant.id,
  );
  if (opponent === undefined) return 0;
  const moves = new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate]));
  return combatant.moveIds.reduce((total, sourceMoveId) => {
    const sourceMove = moves.get(sourceMoveId);
    if (sourceMove === undefined) return total;
    const effects = moveEffectsForTrigger(sourceMove, "passive", {
      self: combatant,
      opponent,
      turnNumber: state.turnNumber,
      completedTurnCount: state.turnNumber - 1,
      moves,
      moveActivationCounts: moveActivationCounts(state),
      successfulHitCount: 0,
      actionHistory: state.actionHistory,
      activeEffects: state.activeEffects,
      mode: state.mode,
      triggeringMove: move,
      triggeringMoveOwner: "self",
    });
    return (
      total +
      effects.remainingUseModifications
        .filter(
          (application) =>
            application.target === "self" && matchesMoveSelector(move, application.selector),
        )
        .reduce((subtotal, application) => subtotal + application.amount, 0)
    );
  }, 0);
};

const effectiveRestrictedMoveUseLimit = (
  state: ActiveFightState,
  combatant: CombatantState,
  move: MoveDefinition,
) => {
  const base = baseRestrictedMoveUseLimit(state, combatant, move);
  return base === undefined
    ? undefined
    : base +
        (combatant.moveUseLimitModifiers?.[move.id] ?? 0) +
        passiveRemainingUseModifier(state, combatant, move);
};

const effectiveMoveUseLimit = (
  state: ActiveFightState,
  combatant: CombatantState,
  move: MoveDefinition,
) => effectiveRestrictedMoveUseLimit(state, combatant, move) ?? simpleActionMoveUseLimit(move);

type MoveEffect = NonNullable<MoveDefinition["effects"]>[number];

const isResourceActionEffect = (effect: MoveEffect) =>
  effect.type === "modify-resource" && (effect.target === "self" || effect.target === "opponent");

const isDamageActionModifier = (
  effect: MoveEffect,
): effect is Extract<MoveEffect, { readonly type: "modify-damage" }> =>
  effect.type === "modify-damage" &&
  (effect.target === "self" || effect.target === "opponent") &&
  effect.percent !== undefined &&
  (effect.scope?.type === "next-action" || effect.scope?.type === "next-actions") &&
  (effect.operation === undefined ||
    effect.operation === "add" ||
    effect.operation === "multiply" ||
    effect.operation === "set") &&
  (effect.conditions?.length ?? 0) === 0;

type SupportedRollActionModifier = Extract<MoveEffect, { readonly type: "modify-roll" }> & {
  readonly roll: "attack" | "defense";
  readonly modifier: "result" | "sides";
};

const isRollActionModifier = (effect: MoveEffect): effect is SupportedRollActionModifier =>
  effect.type === "modify-roll" &&
  effect.target === "self" &&
  (effect.roll === "attack" || effect.roll === "defense") &&
  (effect.modifier === "result" || effect.modifier === "sides") &&
  effect.amount !== undefined &&
  (effect.scope?.type === "next-action" ||
    effect.scope?.type === "next-actions" ||
    effect.scope?.type === "next-roll" ||
    effect.scope?.type === "next-rolls");

const isForcedActionEffect = (effect: MoveEffect) =>
  effect.type === "force-action" &&
  effect.target === "opponent" &&
  effect.scope?.type === "next-action" &&
  effect.selector === undefined;

const isStoredRollActionEffect = (effect: MoveEffect) =>
  effect.type === "roll-and-store" && effect.target === "self";

const isActionPhaseFloatingEffect = (effect: MoveEffect) =>
  effect.type === "create-floating-effect" && effect.trigger === "action-phase";

const isActionPhaseExtraActionEffect = (effect: MoveEffect) =>
  effect.type === "grant-extra-action" &&
  effect.trigger === "action-phase" &&
  effect.target === "self" &&
  effect.phase === "action-phase" &&
  effect.optional !== true &&
  effect.activationCost === undefined &&
  effect.duration === undefined &&
  effect.cooldown === undefined &&
  effect.selectionLimit === undefined &&
  effect.stacking === undefined;

const isAttackPreventionNegationEffect = (effect: MoveEffect) =>
  effect.type === "negate" &&
  effect.target === "opponent" &&
  effect.aspects?.length === 1 &&
  effect.aspects[0] === "prevent-attack";

const isSimpleActionMove = (move: MoveDefinition) => {
  const actionEffects = (move.effects ?? []).filter((effect) => effect.trigger === "action-phase");
  return (
    move.mechanics.attack === undefined &&
    move.mechanics.kiCost?.type === "literal" &&
    actionEffects.length > 0 &&
    actionEffects.every(
      (effect) =>
        isResourceActionEffect(effect) ||
        isDamageActionModifier(effect) ||
        isRollActionModifier(effect) ||
        isForcedActionEffect(effect) ||
        isStoredRollActionEffect(effect) ||
        isActionPhaseFloatingEffect(effect) ||
        isActionPhaseExtraActionEffect(effect) ||
        isAttackPreventionNegationEffect(effect),
    )
  );
};

const isConstantSkill = (move: MoveDefinition) =>
  move.category === "skill" && move.effectClauses.some((clause) => clause.text === "Constant.");

const hasActiveConstant = (
  state: ActiveFightState,
  combatantId: CombatantId,
  moveId: MoveDefinition["id"],
) =>
  state.activeEffects.some(
    (effect) =>
      effect.type === "active-constant" &&
      effect.lifecycle !== "deactivated" &&
      !activeEffectSuppressed(state, effect) &&
      effect.sourceCombatantId === combatantId &&
      effect.sourceDefinitionId === moveId,
  );

const hasRerollDefinition = (combatant: CombatantState) =>
  combatant.moveIds.some((moveId) =>
    MOVE_DEFINITIONS.find((move) => move.id === moveId)?.effects?.some(
      (effect) => effect.type === "reroll" && effect.trigger === "after-defense-roll",
    ),
  );

type RerollEffectDefinition = Extract<EffectDefinition, { readonly type: "reroll" }>;

interface CompiledRerollSource {
  readonly move: MoveDefinition;
  readonly effectIndex: number;
  readonly effect: RerollEffectDefinition;
}

const compiledRerollSources = (
  state: ActiveFightState,
  combatantId: CombatantId,
): readonly CompiledRerollSource[] =>
  state.combatants[combatantId].moveIds.flatMap((moveId) => {
    const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === moveId);
    if (move === undefined) return [];
    return (move.effects ?? []).flatMap((effect, effectIndex) => {
      const compiled = compileEffectPlan({ sourceDefinitionId: move.id, effectIndex, effect });
      return compiled.ok &&
        compiled.value.type === "reroll" &&
        compiled.value.definition.type === "reroll"
        ? [{ move, effectIndex, effect: compiled.value.definition }]
        : [];
    });
  });

const hasPriorSourceResult = (
  state: ActiveFightState,
  combatantId: CombatantId,
  source: {
    readonly sourceDefinitionId: string;
    readonly requiresPriorSourceResult?: "successful";
  },
) =>
  source.requiresPriorSourceResult === undefined ||
  state.actionHistory.some(
    (action) =>
      action.type === "use-move" &&
      action.actorId === combatantId &&
      action.moveId === source.sourceDefinitionId &&
      action.outcome === source.requiresPriorSourceResult,
  );

const reactionMoveBaseCost = (
  state: ActiveFightState,
  combatantId: CombatantId,
  move: MoveDefinition,
) => {
  const opponent = Object.values(state.combatants).find(
    (candidate) => candidate.id !== combatantId,
  );
  const expression = move.mechanics.kiCost;
  if (opponent === undefined || expression === undefined) return undefined;
  return evaluateDurableNumericExpression(expression, {
    self: state.combatants[combatantId],
    opponent,
    turnNumber: state.turnNumber,
    participantCount: 2,
    completedTurnCount: state.turnNumber - 1,
    actionHistory: state.actionHistory,
    activeEffects: state.activeEffects,
    moves: new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate])),
    moveActivationCounts: moveActivationCounts(state),
  });
};

const reactionSkillAvailability = (
  state: ActiveFightState,
  combatantId: CombatantId,
  move: MoveDefinition,
  effectUseLimit: RerollEffectDefinition["useLimit"] | RerollApplication["useLimit"],
) => {
  if (move.category !== "skill") return { consumesMoveUse: false, kiCost: 0 } as const;
  const baseCost = reactionMoveBaseCost(state, combatantId, move);
  if (baseCost === undefined) return undefined;
  const combatant = state.combatants[combatantId];
  const kiCost = effectiveMoveCost(state, combatantId, move, baseCost);
  const moveLimit = effectiveMoveUseLimit(state, combatant, move);
  let effectLimit: number | undefined;
  if (effectUseLimit?.scope === "combat")
    effectLimit =
      typeof effectUseLimit.count === "number"
        ? effectUseLimit.count
        : evaluateDurableNumericExpression(effectUseLimit.count, {
            self: combatant,
            opponent:
              Object.values(state.combatants).find((candidate) => candidate.id !== combatantId) ??
              combatant,
            turnNumber: state.turnNumber,
            participantCount: 2,
            completedTurnCount: state.turnNumber - 1,
            actionHistory: state.actionHistory,
            activeEffects: state.activeEffects,
            moves: new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate])),
            moveActivationCounts: moveActivationCounts(state),
          });
  let limit = moveLimit;
  if (limit === undefined) limit = effectLimit;
  else if (effectLimit !== undefined) limit = Math.min(limit, effectLimit);
  if (
    combatant.ki.current < kiCost ||
    (limit !== undefined && (combatant.moveUses[move.id] ?? 0) >= limit)
  )
    return undefined;
  return { consumesMoveUse: true, kiCost } as const;
};

const rerollSelectorMatchesAttack = (
  selector: RerollEffectDefinition["selector"],
  attackMove: MoveDefinition | undefined,
) =>
  selector === undefined ||
  (attackMove !== undefined && effectMatchesMoveSelector(selector, attackMove));

const hasPostDefenseRerollPotential = (
  state: ActiveFightState,
  combatantId: CombatantId,
  roll: "attack" | "defense",
  attackMove?: MoveDefinition,
) =>
  compiledRerollSources(state, combatantId).some(
    (source) =>
      source.effect.roll === roll &&
      rerollSelectorMatchesAttack(source.effect.selector, attackMove) &&
      hasPriorSourceResult(state, combatantId, {
        ...source.effect,
        sourceDefinitionId: source.move.id,
      }) &&
      reactionSkillAvailability(state, combatantId, source.move, source.effect.useLimit) !==
        undefined,
  );

const hasPostDefenseReaction = (
  state: ActiveFightState,
  combatantId: CombatantId,
  attackMove?: MoveDefinition,
) =>
  availablePostRollDefenseItems(state.combatants[combatantId]).length > 0 ||
  hasActiveConstant(state, combatantId, "move-aoyosumu-close-shave") ||
  hasPostDefenseRerollPotential(state, combatantId, "defense", attackMove) ||
  hasRerollDefinition(state.combatants[combatantId]) ||
  state.activeEffects.some(
    (effect) =>
      effect.type === "reroll" &&
      effect.sourceCombatantId === combatantId &&
      (effect.useLimit === undefined || effect.useLimit.remaining > 0),
  );

/** Close Shave is a converted CONSTANT whose after-defense equality changes
 * the matching die's combat result.  The resolved results are persisted on
 * the suspended frame, so resume never depends on a fresh roll. */
const closeShaveResultOverrides = (
  state: ActiveFightState,
  defenderId: CombatantId,
  rolls: readonly {
    readonly attackResult: number;
    readonly defenseResult?: number;
  }[],
) =>
  hasActiveConstant(state, defenderId, "move-aoyosumu-close-shave")
    ? rolls.map((roll) =>
        roll.defenseResult === roll.attackResult ? ("stopped" as const) : undefined,
      )
    : rolls.map(() => undefined);

const closeShaveReactionOptions = (state: ActiveFightState, combatantId: CombatantId) =>
  hasActiveConstant(state, combatantId, "move-aoyosumu-close-shave")
    ? Array.from({ length: Math.min(5, state.combatants[combatantId].ki.current) }, (_, index) => {
        const amount = index + 1;
        return {
          id: `activate-move:move-aoyosumu-close-shave:${amount}`,
          type: "activate-effect" as const,
          moveId: "move-aoyosumu-close-shave",
        };
      })
    : [];

const closeShaveKiLossForOption = (option: PendingDecisionOption) => {
  if (option.moveId !== "move-aoyosumu-close-shave") return undefined;
  const amount = Number(option.id.split(":").at(-1));
  return Number.isInteger(amount) && amount >= 1 && amount <= 5 ? amount : undefined;
};

const energyRedirectionOptions = (
  state: ActiveFightState,
  attackerId: CombatantId,
  attack: Extract<
    ActiveFightState["resolutionFrames"][number],
    { readonly stage: "awaiting-defense" }
  >["attack"],
  rolls: readonly {
    readonly attackResult: number;
    readonly defenseResult?: number;
    readonly outcome: "blocked" | "stopped" | "successful";
  }[],
) => {
  if (attack.type !== "move") return [];
  const sourceMove = MOVE_DEFINITIONS.find((move) => move.id === attack.moveId);
  const redirect = MOVE_DEFINITIONS.find((move) => move.id === "move-freestyle-energy-redirection");
  const attacker = state.combatants[attackerId];
  if (
    sourceMove?.category !== "advanced-attack" ||
    !sourceMove.tags.includes("energy") ||
    redirect === undefined ||
    !attacker.moveIds.includes(redirect.id) ||
    attacker.ki.current < 1 ||
    (attacker.moveUses[redirect.id] ?? 0) >= 2
  ) {
    return [];
  }
  return rolls.flatMap((roll, index) =>
    roll.outcome === "stopped" &&
    roll.defenseResult !== undefined &&
    roll.defenseResult <= roll.attackResult + 2
      ? [
          {
            id: `activate-move:move-freestyle-energy-redirection:${index}`,
            type: "activate-effect" as const,
            moveId: redirect.id,
          },
        ]
      : [],
  );
};

const energyRedirectionDieForOption = (option: PendingDecisionOption) => {
  if (option.moveId !== "move-freestyle-energy-redirection") return undefined;
  const index = Number(option.id.split(":").at(-1));
  return Number.isInteger(index) && index >= 0 ? index : undefined;
};

const hasEnergyRedirectionPotential = (
  state: ActiveFightState,
  attackerId: CombatantId,
  move: MoveDefinition,
) =>
  move.category === "advanced-attack" &&
  move.tags.includes("energy") &&
  state.combatants[attackerId].moveIds.includes("move-freestyle-energy-redirection") &&
  state.combatants[attackerId].ki.current >= 1 &&
  (state.combatants[attackerId].moveUses["move-freestyle-energy-redirection"] ?? 0) < 2;

interface ActionMoveModifierContext {
  readonly move: MoveDefinition;
  readonly actor: ActiveFightState["combatants"][CombatantId];
  readonly target: ActiveFightState["combatants"][CombatantId];
  readonly state: ActiveFightState;
  readonly dependencies: CombatDependencies;
}

const nextActionModifierBase = ({ move, actor, dependencies }: ActionMoveModifierContext) => ({
  id: dependencies.ids.nextActiveEffectId(),
  type: "modify-next-action" as const,
  sourceCombatantId: actor.id,
  targetCombatantId: actor.id,
  sourceDefinitionId: move.id,
});

const actionRollModifier = (
  effect: SupportedRollActionModifier,
  context: ActionMoveModifierContext,
  numericContext: Parameters<typeof evaluateDurableNumericExpression>[1],
): ActiveCombatEffect[] => {
  if (effect.amount === undefined) return [];
  const amount = evaluateDurableNumericExpression(effect.amount, numericContext);
  const countedScope =
    effect.scope?.type === "next-actions" || effect.scope?.type === "next-rolls"
      ? evaluateDurableNumericExpression(effect.scope.count, numericContext)
      : undefined;
  const scope =
    effect.scope?.type === "next-action" ||
    effect.scope?.type === "next-actions" ||
    effect.scope?.type === "next-roll" ||
    effect.scope?.type === "next-rolls"
      ? effect.scope.type
      : undefined;
  if (amount === undefined || (countedScope !== undefined && countedScope < 1)) return [];
  return [
    {
      ...nextActionModifierBase(context),
      ...(effect.selector === undefined ? {} : { selector: effect.selector }),
      ...(effect.stacking === undefined ? {} : { stacking: effect.stacking }),
      ...(scope === undefined ? {} : { scope }),
      ...(countedScope === undefined ? {} : { remaining: countedScope }),
      modifier: {
        type: "roll" as const,
        roll: effect.roll,
        modifier: effect.modifier,
        amount,
      },
    },
  ];
};

const actionDamageModifier = (
  effect: Extract<MoveEffect, { readonly type: "modify-damage" }>,
  context: ActionMoveModifierContext,
  numericContext: Parameters<typeof evaluateDurableNumericExpression>[1],
): ActiveCombatEffect[] => {
  if (effect.percent === undefined) return [];
  const numericAmount = evaluateDurableNumericExpression(effect.percent, numericContext);
  if (numericAmount === undefined) return [];
  const remaining =
    effect.scope?.type === "next-actions"
      ? evaluateDurableNumericExpression(effect.scope.count, numericContext)
      : undefined;
  if (remaining !== undefined && remaining < 1) return [];
  const amount = damageAmountForAction(effect, numericAmount, context.actor.stats.power);
  const scope =
    effect.scope?.type === "next-action" || effect.scope?.type === "next-actions"
      ? effect.scope.type
      : undefined;
  const targetCombatantId = effect.target === "self" ? context.actor.id : context.target.id;
  return [
    {
      ...nextActionModifierBase(context),
      targetCombatantId,
      ...(effect.selector === undefined ? {} : { selector: effect.selector }),
      ...(scope === undefined ? {} : { scope }),
      ...(remaining === undefined ? {} : { remaining }),
      modifier: {
        type: "damage" as const,
        amount,
        ...(effect.operation === undefined || effect.operation === "add"
          ? {}
          : { operation: effect.operation }),
      },
    },
  ];
};

const damageAmountForAction = (
  effect: Extract<MoveEffect, { readonly type: "modify-damage" }>,
  numericAmount: number,
  power: number,
) => {
  if (effect.operation === "multiply" || effect.percent?.type === "stat-percent")
    return numericAmount;
  return Math.round((power * numericAmount) / 100);
};

const actionMoveModifier = (
  effect: MoveEffect,
  context: ActionMoveModifierContext,
): ActiveCombatEffect[] => {
  const numericContext = {
    self: context.actor,
    opponent: context.target,
    turnNumber: context.state.turnNumber,
    participantCount: 2,
    completedTurnCount: context.state.turnNumber - 1,
    moves: new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate])),
  };
  if (isDamageActionModifier(effect)) {
    return actionDamageModifier(effect, context, numericContext);
  }
  if (!isRollActionModifier(effect)) return [];
  return actionRollModifier(effect, context, numericContext);
};

const actionMoveModifiers = (
  move: MoveDefinition,
  actor: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  state: ActiveFightState,
  dependencies: CombatDependencies,
): ActiveCombatEffect[] => {
  const context = { move, actor, target, state, dependencies };
  return (move.effects ?? []).flatMap((effect) => actionMoveModifier(effect, context));
};

const legalBlockMoves = (
  state: ActiveFightState,
  defenderId: CombatantId,
  attack: BlockableAttack,
) => {
  const defender = state.combatants[defenderId];
  if (hasDeclaredBlockThisTurn(state, defenderId)) return [];
  return defender.moveIds.flatMap((moveId) => {
    const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === moveId);
    const locked = state.activeEffects.some(
      (effect) =>
        effect.type === "action-lock" &&
        effect.targetCombatantId === defenderId &&
        (effect.affectedType === "block" || effect.affectedType === "move") &&
        move !== undefined &&
        selectorMatchesMove(effect.selector, move),
    );
    const useLimit =
      move === undefined ? undefined : effectiveRestrictedMoveUseLimit(state, defender, move);
    const exhausted = useLimit !== undefined && (defender.moveUses[moveId] ?? 0) >= useLimit;
    return move !== undefined &&
      !locked &&
      !exhausted &&
      evaluateBlockEligibility(move, attack).canDeclare
      ? [move]
      : [];
  });
};

const hasDeclaredBlockThisTurn = (state: ActiveFightState, combatantId: CombatantId) =>
  state.actionHistory.some(
    (action) =>
      action.turnNumber === state.turnNumber &&
      action.actorId === combatantId &&
      action.type === "use-move" &&
      MOVE_DEFINITIONS.find((move) => move.id === action.moveId)?.category === "block",
  );

const consecutiveCounterAttackCount = (state: ActiveFightState) => {
  let count = 0;
  for (const action of [...state.actionHistory].reverse()) {
    if (action.phase !== "counter") break;
    if (action.type === "basic-attack") count += 1;
    if (
      action.type === "use-move" &&
      MOVE_DEFINITIONS.find((move) => move.id === action.moveId)?.mechanics.attack !== undefined
    ) {
      count += 1;
    }
  }
  return count;
};

const isCombatRollModifierItem = (item: (typeof ITEM_DEFINITIONS)[number]) =>
  item.effects?.some(
    (effect) =>
      effect.trigger === "combat-action" &&
      effect.type === "item-modify-roll" &&
      effect.target === "self" &&
      (effect.roll === "attack" || effect.roll === "defense") &&
      effect.duration?.unit === "combat",
  ) ?? false;

const itemDamageAttackCount = (sourceText: string) => {
  if (/next\s+three\s+attacks?/i.test(sourceText)) return 3;
  if (/next\s+two\s+attacks?/i.test(sourceText)) return 2;
  return /next\s+attack/i.test(sourceText) ? 1 : undefined;
};

const isCombatDamageModifierItem = (item: (typeof ITEM_DEFINITIONS)[number]) =>
  item.effects?.some(
    (effect) =>
      effect.trigger === "combat-action" &&
      effect.type === "item-modify-damage" &&
      effect.target === "self" &&
      itemDamageAttackCount(effect.sourceText) !== undefined,
  ) ?? false;

const isCombatUsableItem = (item: (typeof ITEM_DEFINITIONS)[number]) =>
  isCombatResourceItem(item) || isCombatRollModifierItem(item) || isCombatDamageModifierItem(item);

type RollModificationPreventedInput = {
  readonly state: ActiveFightState;
  readonly combatantId: CombatantId;
  readonly roll: CombatRollType;
  readonly modifier: RollModifierKind;
  readonly move?: MoveDefinition;
  readonly sourceCombatantId?: CombatantId;
  readonly sourceDefinitionId?: string;
};

const activeRollCapForEffect = (effect: ActiveCombatEffect) => {
  if (effect.type === "modify-roll") return effect.cap;
  if (effect.type === "modify-next-action" && effect.modifier.type === "roll")
    return effect.modifier.cap;
  return undefined;
};

const passiveRollModificationPrevented = ({
  state,
  combatantId,
  roll,
  modifier,
  move,
  sourceCombatantId,
}: RollModificationPreventedInput) => {
  if (move === undefined || sourceCombatantId === undefined) return false;
  const self = state.combatants[combatantId];
  const opponent = Object.values(state.combatants).find(
    (candidate) => candidate.id !== combatantId && candidate.status === "active",
  );
  if (opponent === undefined) return false;
  const moves = new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate]));
  return state.activeEffects.some((activeEffect) => {
    if (
      activeEffect.type !== "active-constant" ||
      activeEffect.lifecycle === "deactivated" ||
      activeEffect.sourceCombatantId !== combatantId
    )
      return false;
    const sourceMove = moves.get(activeEffect.sourceDefinitionId);
    if (sourceMove === undefined) return false;
    const passiveEffects = moveEffectsForTrigger(sourceMove, "passive", {
      self,
      opponent,
      turnNumber: state.turnNumber,
      completedTurnCount: state.turnNumber - 1,
      moves,
      moveActivationCounts: moveActivationCounts(state),
      successfulHitCount: 0,
      actionHistory: state.actionHistory,
      activeEffects: state.activeEffects,
      mode: state.mode,
      triggeringMove: move,
    });
    return passiveEffects.rollModificationPreventions.some(
      (prevention) =>
        prevention.target === "self" &&
        prevention.roll === roll &&
        (prevention.modifier === "any" || prevention.modifier === modifier) &&
        effectMatchesMoveSelector(prevention.selector, move) &&
        sourceCombatantId !== combatantId,
    );
  });
};

const rollModificationPrevented = ({
  state,
  combatantId,
  roll,
  modifier,
  move,
  sourceCombatantId,
  sourceDefinitionId,
}: RollModificationPreventedInput) =>
  passiveRollModificationPrevented({
    state,
    combatantId,
    roll,
    modifier,
    move,
    sourceCombatantId,
    sourceDefinitionId,
  }) ||
  state.activeEffects.some(
    (effect) =>
      effect.type === "prevent-roll-modification" &&
      effect.targetCombatantId === combatantId &&
      effect.roll === roll &&
      (effect.modifier === "any" || effect.modifier === modifier) &&
      effectMatchesMoveSelector(effect.selector, move) &&
      !(effect.exemptSourceEffect === true && effect.sourceDefinitionId === sourceDefinitionId),
  ) ||
  (sourceCombatantId !== undefined &&
    sourceDefinitionId !== undefined &&
    activeMoveModificationPrevented({
      state,
      combatantId,
      aspect: modifier === "sides" || modifier === "dice" ? "dice-sides" : "roll-results",
      move,
      sourceCombatantId,
      sourceDefinitionId,
      reduces: false,
    }));

interface ActiveMoveModificationPreventedInput {
  readonly state: ActiveFightState;
  readonly combatantId: CombatantId;
  readonly aspect: "cost" | "damage" | "dice-sides" | "roll-results";
  readonly move: MoveDefinition | undefined;
  readonly sourceCombatantId: CombatantId;
  readonly sourceDefinitionId: string;
  readonly sourceStatusId?: ActiveStatus["statusId"];
  readonly reduces: boolean;
}

const moveModificationActorMatches = (
  actor: MoveModificationPreventionApplication["actor"],
  modifierSourceCombatantId: CombatantId,
  preventionSourceCombatantId: CombatantId,
) =>
  actor === "any" ||
  (actor === "self" && modifierSourceCombatantId === preventionSourceCombatantId) ||
  (actor === "opponent" && modifierSourceCombatantId !== preventionSourceCombatantId);

const activeMoveModificationPrevented = ({
  state,
  combatantId,
  aspect,
  move,
  sourceCombatantId,
  sourceDefinitionId,
  sourceStatusId,
  reduces,
}: ActiveMoveModificationPreventedInput) =>
  state.activeEffects.some((effect) => {
    if (
      effect.type !== "prevent-move-modification" ||
      activeEffectSuppressed(state, effect) ||
      effect.targetCombatantId !== combatantId ||
      !effect.aspects.includes(aspect) ||
      !effectMatchesMoveSelector(effect.selector, move) ||
      !moveModificationActorMatches(effect.actor, sourceCombatantId, effect.sourceCombatantId) ||
      (effect.operations?.includes("reduce") === true && !reduces)
    )
      return false;
    if (effect.exceptSourceMoveIds?.includes(sourceDefinitionId)) return false;
    if (sourceStatusId !== undefined && effect.exceptSourceStatusIds?.includes(sourceStatusId))
      return false;
    if (effect.effectSourceStyleExcludes === undefined) return true;
    const sourceMove = MOVE_DEFINITIONS.find((candidate) => candidate.id === sourceDefinitionId);
    return sourceMove?.styleId !== effect.effectSourceStyleExcludes;
  });

const effectMatchesMoveSelector = (
  selector: MoveSelectorCondition | undefined,
  move?: MoveDefinition,
) =>
  selector === undefined ||
  (move !== undefined && selectorMatchesMove(selector, move)) ||
  (move === undefined && selectorMatchesAnyMove(selector));

const selectorMatchesAnyMove = (selector: MoveSelectorCondition) =>
  ![
    "ids",
    "styleId",
    "styleIdExcludes",
    "category",
    "categoryExcludes",
    "categories",
    "tags",
    "custom",
    "styleProvenance",
    "effectKinds",
    "restriction",
    "constant",
    "effectTextIncludes",
    "effectTextIncludesAny",
    "effectTextExcludes",
    "selectionKey",
    "requirementExcludes",
    "requirementIncludes",
    "baseKiCost",
    "costModification",
    "attackRoll",
  ].some((key) => selector[key as keyof MoveSelectorCondition] !== undefined);

const activeEffectSuppressed = (state: ActiveFightState, effect: ActiveCombatEffect) => {
  if (effect.type === "suppress") return false;
  const sourceMove = MOVE_DEFINITIONS.find((move) => move.id === effect.sourceDefinitionId);
  if (sourceMove === undefined) return false;
  return state.activeEffects.some(
    (suppression) =>
      suppression.type === "suppress" &&
      suppression.targetCombatantId === effect.sourceCombatantId &&
      suppression.aspects.includes("all-effects") &&
      effectMatchesMoveSelector(suppression.selector, sourceMove),
  );
};

const rollModifierAmount = (
  effect: ActiveCombatEffect,
  combatantId: CombatantId,
  roll: CombatRollType,
  modifier: RollModifierKind,
  move?: MoveDefinition,
) => {
  if (
    effect.type === "modify-roll" &&
    effect.targetCombatantId === combatantId &&
    effect.roll === roll &&
    effect.modifier === modifier &&
    effectMatchesMoveSelector(effect.selector, move)
  ) {
    return effect.amount;
  }
  if (
    effect.type === "modify-next-action" &&
    effect.targetCombatantId === combatantId &&
    effect.modifier.type === "roll" &&
    effect.modifier.roll === roll &&
    effect.modifier.modifier === modifier &&
    effectMatchesMoveSelector(effect.selector, move)
  ) {
    return effect.modifier.amount;
  }
  return 0;
};

const activeRollModifierAllowsExceed = (effect: ActiveCombatEffect) => {
  if (effect.type === "modify-roll") return effect.cap?.type === "allow-exceed";
  return (
    effect.type === "modify-next-action" &&
    effect.modifier.type === "roll" &&
    effect.modifier.cap?.type === "allow-exceed"
  );
};

const oneShotRollModifierIsEligible = (
  turnNumber: number,
  effect: Extract<ActiveCombatEffect, { type: "modify-next-action" }>,
) => effect.availableFromTurn === undefined || turnNumber >= effect.availableFromTurn;

const activeRollModifierIsBlocked = (
  state: ActiveFightState,
  effect: ActiveCombatEffect,
  combatantId: CombatantId,
  roll: CombatRollType,
  modifier: RollModifierKind,
  move: MoveDefinition | undefined,
) =>
  activeEffectSuppressed(state, effect) ||
  rollModificationPrevented({
    state,
    combatantId,
    roll,
    modifier,
    move,
    sourceCombatantId: effect.sourceCombatantId,
    sourceDefinitionId: effect.sourceDefinitionId,
  }) ||
  (effect.type === "modify-next-action" &&
    !oneShotRollModifierIsEligible(state.turnNumber, effect));

const activeRollModifier = (
  state: ActiveFightState,
  combatantId: CombatantId,
  roll: CombatRollType,
  modifier: RollModifierKind,
  move?: MoveDefinition,
) => {
  const matchingEffects = state.activeEffects.filter(
    (effect) =>
      !activeRollModifierIsBlocked(state, effect, combatantId, roll, modifier, move) &&
      rollModifierAmount(effect, combatantId, roll, modifier, move) !== 0,
  );
  const amount = matchingEffects.reduce(
    (total, effect) => total + rollModifierAmount(effect, combatantId, roll, modifier, move),
    0,
  );
  return applyStandardRollModificationLimit(
    amount,
    move,
    matchingEffects.some(activeRollModifierAllowsExceed),
  );
};

const activeRollModifierCanExceed = (
  state: ActiveFightState,
  combatantId: CombatantId,
  roll: CombatRollType,
  modifier: RollModifierKind,
  move: MoveDefinition | undefined,
) =>
  state.activeEffects.some(
    (effect) =>
      !activeRollModifierIsBlocked(state, effect, combatantId, roll, modifier, move) &&
      rollModifierAmount(effect, combatantId, roll, modifier, move) !== 0 &&
      activeRollModifierAllowsExceed(effect),
  );

const activeRollNumericCap = (
  state: ActiveFightState,
  combatantId: CombatantId,
  roll: CombatRollType,
  modifier: RollModifierKind,
  scope: "total" | "roll",
  move?: MoveDefinition,
) => {
  const matching = state.activeEffects.filter(
    (effect) =>
      !activeRollModifierIsBlocked(state, effect, combatantId, roll, modifier, move) &&
      activeRollCapForEffect(effect)?.type !== "allow-exceed" &&
      activeRollCapForEffect(effect)?.scope === scope,
  );
  return matching.reduce<
    | {
        readonly type: "maximum" | "minimum";
        readonly scope: "amount" | "total" | "roll";
        readonly value: number;
      }
    | undefined
  >((cap, effect) => {
    const candidate = activeRollCapForEffect(effect);
    if (candidate === undefined || candidate.type === "allow-exceed") return cap;
    return { type: candidate.type, scope: candidate.scope, value: candidate.value };
  }, undefined);
};

const activeStatModifierApplies = (
  state: ActiveFightState,
  effect: ActiveCombatEffect,
  combatantId: CombatantId,
  move: MoveDefinition | undefined,
  roll: "attack" | "defense",
  role: "attacker" | "defender",
) => {
  if (effect.type !== "modify-stat" && effect.type !== "modify-next-action") return false;
  if (activeEffectSuppressed(state, effect)) return false;
  if (effect.targetCombatantId !== combatantId || !effectMatchesMoveSelector(effect.selector, move))
    return false;
  if (effect.type === "modify-stat") return true;
  if (effect.modifier.type !== "stat") return false;
  if (!oneShotRollModifierIsEligible(state.turnNumber, effect)) return false;
  if (effect.scope === "next-roll")
    return effect.modifier.roll === undefined || effect.modifier.roll === roll;
  return role === "attacker";
};

const activeStatValue = (
  state: ActiveFightState,
  combatantId: CombatantId,
  stat: "dexterity" | "dexterity-bonus",
  base: number,
  move: MoveDefinition | undefined,
  roll: "attack" | "defense",
  role: "attacker" | "defender",
) => {
  const modifiers = state.activeEffects.flatMap((effect) => {
    if (!activeStatModifierApplies(state, effect, combatantId, move, roll, role)) return [];
    if (effect.type === "modify-stat")
      return effect.stat === stat ? [{ operation: effect.operation, amount: effect.amount }] : [];
    if (effect.type !== "modify-next-action" || effect.modifier.type !== "stat") return [];
    return effect.modifier.stat === stat
      ? [{ operation: effect.modifier.operation, amount: effect.modifier.amount }]
      : [];
  });
  const set = [...modifiers].reverse().find((modifier) => modifier.operation === "set");
  const additive = modifiers
    .filter((modifier) => modifier.operation === "add")
    .reduce((total, modifier) => total + modifier.amount, 0);
  const multiplicative = modifiers
    .filter((modifier) => modifier.operation === "multiply")
    .reduce((total, modifier) => total * modifier.amount, 1);
  return Math.max(0, ((set?.amount ?? base) + additive) * multiplicative);
};

const combatantWithActiveStatModifiers = (
  state: ActiveFightState,
  combatant: ActiveFightState["combatants"][CombatantId],
  move: MoveDefinition,
  roll: "attack" | "defense",
  role: "attacker" | "defender",
) => ({
  ...combatant,
  stats: {
    ...combatant.stats,
    dexterity: activeStatValue(
      state,
      combatant.id,
      "dexterity",
      combatant.stats.dexterity,
      move,
      roll,
      role,
    ),
    dexterityBonus: activeStatValue(
      state,
      combatant.id,
      "dexterity-bonus",
      combatant.stats.dexterityBonus,
      move,
      roll,
      role,
    ),
  },
});

const activeResolutionThresholds = (
  state: ActiveFightState,
  attackerId: CombatantId,
  defenderId: CombatantId,
  move?: MoveDefinition,
): readonly ResolutionThresholdRule[] =>
  state.activeEffects.flatMap<ResolutionThresholdRule>((effect) => {
    if (effect.type !== "set-resolution-threshold") return [];
    if (activeEffectSuppressed(state, effect)) return [];
    if (!resolutionThresholdAppliesToAttack(effect, attackerId, defenderId, move)) return [];
    return [
      {
        outcome: effect.outcome,
        roll: effect.roll,
        comparison: effect.comparison,
        value: effect.value,
        ...(effect.relativeTo === undefined ? {} : { relativeTo: effect.relativeTo }),
        ...(effect.relativeOperation === undefined
          ? {}
          : { relativeOperation: effect.relativeOperation }),
        resultScope: effect.resultScope,
      },
    ];
  });

const resolutionThresholdAppliesToAttack = (
  effect: Extract<ActiveCombatEffect, { type: "set-resolution-threshold" }>,
  attackerId: CombatantId,
  defenderId: CombatantId,
  move?: MoveDefinition,
) => {
  const expectedAttackerId =
    effect.appliesTo === "source" ? effect.sourceCombatantId : effect.targetCombatantId;
  const expectedDefenderId =
    effect.appliesTo === "source" ? effect.targetCombatantId : effect.sourceCombatantId;
  return (
    attackerId === expectedAttackerId &&
    defenderId === expectedDefenderId &&
    effectMatchesMoveSelector(effect.selector, move)
  );
};

const applyActiveDamageModifiers = (
  state: ActiveFightState,
  combatantId: CombatantId,
  baseDamage: number,
  move?: MoveDefinition,
) =>
  state.activeEffects.reduce((damage, effect) => {
    const modifier = activeDamageModifierForEffect(state, effect, combatantId, move);
    if (modifier === undefined) return damage;
    const modifiedDamage = applyDamageOperation(damage, modifier);
    return activeMoveModificationPrevented({
      state,
      combatantId,
      aspect: "damage",
      move,
      sourceCombatantId: effect.sourceCombatantId,
      sourceDefinitionId: effect.sourceDefinitionId,
      reduces: modifiedDamage < damage,
    })
      ? damage
      : modifiedDamage;
  }, baseDamage);

interface SourcedDamageModification {
  readonly modification: DamageModification;
  readonly sourceCombatantId: CombatantId;
  readonly sourceDefinitionId: string;
}

const activeConstantDamageModifications = (
  state: ActiveFightState,
  attackerId: CombatantId,
  defenderId: CombatantId,
  move: MoveDefinition | undefined,
): readonly SourcedDamageModification[] => {
  const moves = new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate]));
  return state.activeEffects.flatMap((effect) => {
    if (
      effect.type !== "active-constant" ||
      effect.lifecycle === "deactivated" ||
      (effect.sourceCombatantId !== attackerId && effect.sourceCombatantId !== defenderId)
    )
      return [];
    const sourceMove = moves.get(effect.sourceDefinitionId);
    if (sourceMove === undefined) return [];
    const source = state.combatants[effect.sourceCombatantId];
    const opponent = state.combatants[source.id === attackerId ? defenderId : attackerId];
    const passiveEffects = moveEffectsForTrigger(sourceMove, "passive", {
      self: source,
      opponent,
      turnNumber: state.turnNumber,
      completedTurnCount: state.turnNumber - 1,
      moves,
      moveActivationCounts: moveActivationCounts(state),
      successfulHitCount: 0,
      actionHistory: state.actionHistory,
      activeEffects: state.activeEffects,
      mode: state.mode,
      ...(move === undefined ? {} : { triggeringMove: move }),
    });
    return passiveEffects.damageModifications.flatMap((modification) => {
      const targetCombatantId = modification.target === "self" ? source.id : opponent.id;
      if (
        (modification.scope !== undefined && modification.scope !== "current-action") ||
        targetCombatantId !== attackerId
      )
        return [];
      return [
        {
          modification,
          sourceCombatantId: source.id,
          sourceDefinitionId: sourceMove.id,
        },
      ];
    });
  });
};

const activeConstantRollModifications = (
  state: ActiveFightState,
  attackerId: CombatantId,
  defenderId: CombatantId,
  move: MoveDefinition,
): readonly RollModification[] => {
  const moves = new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate]));
  return state.activeEffects.flatMap((effect) => {
    if (
      effect.type !== "active-constant" ||
      effect.lifecycle === "deactivated" ||
      activeEffectSuppressed(state, effect) ||
      (effect.sourceCombatantId !== attackerId && effect.sourceCombatantId !== defenderId)
    )
      return [];
    const sourceMove = moves.get(effect.sourceDefinitionId);
    if (sourceMove === undefined) return [];
    const source = state.combatants[effect.sourceCombatantId];
    const opponent = state.combatants[source.id === attackerId ? defenderId : attackerId];
    const passiveEffects = moveEffectsForTrigger(sourceMove, "passive", {
      self: source,
      opponent,
      turnNumber: state.turnNumber,
      completedTurnCount: state.turnNumber - 1,
      moves,
      moveActivationCounts: moveActivationCounts(state),
      successfulHitCount: 0,
      actionHistory: state.actionHistory,
      activeEffects: state.activeEffects,
      mode: state.mode,
      triggeringMove: move,
    });
    const sourceIsAttacker = source.id === attackerId;
    const targetForAction = (target: "self" | "opponent") => {
      if (sourceIsAttacker) return target;
      return target === "self" ? "opponent" : "self";
    };
    return passiveEffects.rollModifications.map((modification) => ({
      ...modification,
      target: targetForAction(modification.target),
    }));
  });
};

const applyActiveConstantDamageModifiers = (
  state: ActiveFightState,
  attackerId: CombatantId,
  defenderId: CombatantId,
  baseDamage: number,
  move: MoveDefinition | undefined,
) =>
  activeConstantDamageModifications(state, attackerId, defenderId, move).reduce(
    (damage, sourced) => applySourcedDamageModification(state, damage, sourced, attackerId, move),
    baseDamage,
  );

type DamageOperation = {
  readonly operation: "add" | "multiply" | "set";
  readonly amount: number;
  readonly basis?: "power-percent" | "damage-percent";
  readonly cap?: { readonly type: "maximum" | "minimum"; readonly value: number };
  readonly capOnly?: boolean;
};

const activeDamageEffectOperation = (
  state: ActiveFightState,
  effect: Extract<ActiveCombatEffect, { readonly type: "modify-damage" }>,
  move: MoveDefinition | undefined,
): DamageOperation | undefined => {
  if (effect.availableFromTurn !== undefined && state.turnNumber < effect.availableFromTurn)
    return undefined;
  if (effect.duration.type === "turns" && effect.duration.remaining < 1) return undefined;
  if (!effectMatchesMoveSelector(effect.selector, move)) return undefined;
  return {
    operation: effect.operation,
    amount: effect.amount,
    basis: effect.basis,
    ...(effect.cap === undefined ? {} : { cap: effect.cap }),
    ...(effect.capOnly === true ? { capOnly: true } : {}),
  };
};

const activeNextActionDamageOperation = (
  state: ActiveFightState,
  effect: Extract<ActiveCombatEffect, { readonly type: "modify-next-action" }>,
  move: MoveDefinition | undefined,
): DamageOperation | undefined => {
  if (effect.modifier.type !== "damage") return undefined;
  if (!effectMatchesMoveSelector(effect.selector, move)) return undefined;
  if (!oneShotRollModifierIsEligible(state.turnNumber, effect)) return undefined;
  return {
    operation: effect.modifier.operation ?? "add",
    amount: effect.modifier.amount,
    ...(effect.modifier.basis === undefined ? {} : { basis: effect.modifier.basis }),
    ...(effect.modifier.cap === undefined ? {} : { cap: effect.modifier.cap }),
    ...(effect.modifier.capOnly === true ? { capOnly: true } : {}),
  };
};

const activeDamageModifierForEffect = (
  state: ActiveFightState,
  effect: ActiveCombatEffect,
  combatantId: CombatantId,
  move: MoveDefinition | undefined,
): DamageOperation | undefined => {
  if (activeEffectSuppressed(state, effect)) return undefined;
  if (effect.targetCombatantId !== combatantId) return undefined;
  if (effect.type === "modify-item-next-attack-damage")
    return { operation: "add", amount: effect.amount };
  if (effect.type === "modify-damage") return activeDamageEffectOperation(state, effect, move);
  if (effect.type !== "modify-next-action") return undefined;
  return activeNextActionDamageOperation(state, effect, move);
};

const cappedDamageModifierAmount = (operation: DamageOperation) => {
  if (operation.cap === undefined) return operation.amount;
  if (operation.cap.type === "maximum") return Math.min(operation.amount, operation.cap.value);
  return Math.max(operation.amount, operation.cap.value);
};

const applyDamagePercentOperation = (
  damage: number,
  operation: DamageOperation,
  amount: number,
) => {
  if (operation.operation === "add") return Math.round((damage * (100 + amount)) / 100);
  return Math.round((damage * amount) / 100);
};

const applyPowerDamageOperation = (damage: number, operation: DamageOperation, amount: number) => {
  if (operation.operation === "set") return amount;
  if (operation.operation === "multiply") return Math.round((damage * amount) / 100);
  return damage + amount;
};

const applyDamageOperation = (damage: number, operation: DamageOperation) => {
  if (operation.capOnly && operation.cap !== undefined) {
    if (operation.cap.type === "maximum") return Math.min(damage, operation.cap.value);
    return Math.max(damage, operation.cap.value);
  }
  const amount = cappedDamageModifierAmount(operation);
  if (operation.basis === "damage-percent")
    return applyDamagePercentOperation(damage, operation, amount);
  return applyPowerDamageOperation(damage, operation, amount);
};

const applySourcedDamageModification = (
  state: ActiveFightState,
  damage: number,
  sourced: SourcedDamageModification,
  combatantId: CombatantId,
  move: MoveDefinition | undefined,
) => {
  if (!effectMatchesMoveSelector(sourced.modification.selector, move)) return damage;
  const modifiedDamage = applyDamageOperation(damage, sourced.modification);
  return activeMoveModificationPrevented({
    state,
    combatantId,
    aspect: "damage",
    move,
    sourceCombatantId: sourced.sourceCombatantId,
    sourceDefinitionId: sourced.sourceDefinitionId,
    reduces: modifiedDamage < damage,
  })
    ? damage
    : modifiedDamage;
};

const applySourcedDamageModifications = (
  state: ActiveFightState,
  baseDamage: number,
  modifications: readonly DamageModification[],
  combatantId: CombatantId,
  sourceCombatantId: CombatantId,
  sourceDefinitionId: string,
  move: MoveDefinition,
) =>
  modifications.reduce(
    (damage, modification) =>
      applySourcedDamageModification(
        state,
        damage,
        { modification, sourceCombatantId, sourceDefinitionId },
        combatantId,
        move,
      ),
    baseDamage,
  );

const applyDamageModifications = (
  baseDamage: number,
  modifications: readonly DamageModification[],
  move?: MoveDefinition,
) =>
  modifications.reduce((damage, modification) => {
    if (!effectMatchesMoveSelector(modification.selector, move)) return damage;
    return applyDamageOperation(damage, modification);
  }, baseDamage);

/** BREAK and SEVER are combat statuses with source-defined outgoing damage penalties. */
const statusDamagePenaltyPercent = (status: ActiveStatus) => {
  if (status.statusId === "break") return status.stacks * 10;
  if (status.statusId === "sever") return status.stacks * 25;
  return 0;
};

const damageAfterStatusPenalties = (
  state: ActiveFightState,
  combatant: ActiveFightState["combatants"][CombatantId],
  damage: number,
  move?: MoveDefinition,
) => {
  const statusPenalty = (
    status: ActiveFightState["combatants"][CombatantId]["activeStatuses"][number],
  ) => {
    const percent = statusDamagePenaltyPercent(status);
    if (percent === 0) return 0;
    return activeMoveModificationPrevented({
      state,
      combatantId: combatant.id,
      aspect: "damage",
      move,
      sourceCombatantId: status.sourceCombatantId,
      sourceDefinitionId: status.sourceDefinitionId,
      sourceStatusId: status.statusId,
      reduces: true,
    })
      ? 0
      : percent;
  };
  const reductionPercent = combatant.activeStatuses.reduce(
    (total, status) => total + statusPenalty(status),
    0,
  );
  return Math.max(0, Math.round((damage * Math.max(0, 100 - reductionPercent)) / 100));
};

/** A turn-limited status remains active through its owner's full turn, then expires. */
const statusesAfterOwnerTurn = (combatant: ActiveFightState["combatants"][CombatantId]) =>
  combatant.activeStatuses.flatMap((status) => {
    if (status.duration.type !== "turns" || status.duration.ownerCombatantId !== combatant.id)
      return [status];
    if (status.duration.remaining <= 1) return [];
    return [
      { ...status, duration: { ...status.duration, remaining: status.duration.remaining - 1 } },
    ];
  });

const actionRestrictionAfterOwnerTurn = (
  effect: Extract<ActiveCombatEffect, { readonly type: "action-restriction" }>,
  combatantId: CombatantId,
  turnNumber: number,
): readonly ActiveCombatEffect[] => {
  if (effect.targetCombatantId !== combatantId || turnNumber < effect.availableFromTurn)
    return [effect];
  return effect.remainingTurns <= 1
    ? []
    : [{ ...effect, remainingTurns: effect.remainingTurns - 1 }];
};

const simpleEffectAfterOwnerTurn = (
  effect: ActiveCombatEffect,
  combatantId: CombatantId,
  turnNumber: number,
): readonly ActiveCombatEffect[] | undefined => {
  if (effect.type === "action-restriction")
    return actionRestrictionAfterOwnerTurn(effect, combatantId, turnNumber);
  if (effect.type === "extra-action")
    return effect.targetCombatantId === combatantId && effect.expiresAfterTurn <= turnNumber
      ? []
      : [effect];
  if (effect.type === "floating-effect")
    return effect.scope.type === "next-turn" &&
      effect.scope.combatantId === combatantId &&
      turnNumber > effect.createdOnTurn
      ? []
      : [effect];
  return undefined;
};

const effectsAfterOwnerTurn = (state: ActiveFightState, combatantId: CombatantId) =>
  state.activeEffects.flatMap<ActiveCombatEffect>((effect) => {
    const simpleEffect = simpleEffectAfterOwnerTurn(effect, combatantId, state.turnNumber);
    if (simpleEffect !== undefined) return simpleEffect;
    if (effect.type === "modify-next-action") return [effect];
    if (effect.type === "modify-roll") {
      if (effect.duration === "combat" || effect.duration.type !== "turns") return [effect];
      if (effect.duration.ownerCombatantId !== combatantId) return [effect];
      return effect.duration.remaining <= 1
        ? []
        : [
            {
              ...effect,
              duration: { ...effect.duration, remaining: effect.duration.remaining - 1 },
            },
          ];
    }
    if (
      (effect.type !== "action-lock" &&
        effect.type !== "prevent-move-use" &&
        effect.type !== "prevent-status" &&
        effect.type !== "prevent-combat-result" &&
        effect.type !== "prevent-roll-modification" &&
        effect.type !== "prevent-move-modification" &&
        effect.type !== "prevent-resource-modification" &&
        effect.type !== "modify-damage" &&
        effect.type !== "modify-stat" &&
        effect.type !== "suppress") ||
      effect.duration.type !== "turns"
    )
      return [effect];
    if (effect.duration.ownerCombatantId !== combatantId) return [effect];
    return effect.duration.remaining <= 1
      ? []
      : [{ ...effect, duration: { ...effect.duration, remaining: effect.duration.remaining - 1 } }];
  });

const effectsAfterTurnStartChecks = (
  state: ActiveFightState,
  combatantId: CombatantId,
  dependencies: CombatDependencies,
) => {
  const events: CombatEvent[] = [];
  const effects = state.activeEffects.flatMap<ActiveCombatEffect>((effect) => {
    if (
      (effect.type !== "action-lock" &&
        effect.type !== "prevent-move-use" &&
        effect.type !== "prevent-status" &&
        effect.type !== "prevent-combat-result" &&
        effect.type !== "prevent-roll-modification" &&
        effect.type !== "prevent-move-modification" &&
        effect.type !== "prevent-resource-modification") ||
      effect.duration.type !== "until-turn-start-roll-threshold" ||
      effect.duration.combatantId !== combatantId
    )
      return [effect];
    const duration = effect.duration;
    if (duration.remainingIgnoredChecks > 0) {
      return [
        {
          ...effect,
          duration: {
            ...duration,
            remainingIgnoredChecks: duration.remainingIgnoredChecks - 1,
          },
        },
      ];
    }
    const naturalResult = Array.from({ length: duration.dice }, () =>
      dependencies.random.integer(1, duration.sides),
    ).reduce((total, result) => total + result, 0);
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + events.length + 1,
      fightId: state.id,
      type: "effect-rolled",
      activeEffectId: effect.id,
      combatantId,
      naturalResult,
      result: naturalResult,
    });
    if (numericSelectorComparison(naturalResult, duration.comparison, duration.value)) {
      events.push({
        id: dependencies.ids.nextEventId(),
        sequence: state.eventSequence + events.length + 1,
        fightId: state.id,
        type: "effect-expired",
        activeEffectId: effect.id,
        targetCombatantId: effect.targetCombatantId,
      });
      return [];
    }
    return [effect];
  });
  return { effects, events };
};

type ScheduledResourceBoundary =
  | { readonly type: "turn-start"; readonly combatantId: CombatantId }
  | { readonly type: "turn-end"; readonly combatantId: CombatantId }
  | {
      readonly type: "phase-start";
      readonly combatantId: CombatantId;
      readonly phase: "upkeep" | "action" | "end";
    };

const scheduledResourceMatchesBoundary = (
  effect: Extract<ActiveCombatEffect, { readonly type: "scheduled-resource" }>,
  boundary: ScheduledResourceBoundary,
) =>
  effect.timing.combatantId === boundary.combatantId &&
  effect.timing.type === boundary.type &&
  (boundary.type !== "phase-start" || effect.timing.phase === boundary.phase);

const scheduledResourceAmount = (
  state: ActiveFightState,
  effect: Extract<ActiveCombatEffect, { readonly type: "scheduled-resource" }>,
) => {
  const source = state.combatants[effect.sourceCombatantId];
  const target = state.combatants[effect.targetCombatantId];
  return evaluateDurableNumericExpression(effect.amount, {
    self: source,
    opponent: target,
    turnNumber: state.turnNumber,
    participantCount: Object.keys(state.combatants).length,
    completedTurnCount: state.turnNumber - 1,
    actionHistory: state.actionHistory,
    activeEffects: state.activeEffects,
    moves: new Map(MOVE_DEFINITIONS.map((move) => [move.id, move])),
    moveActivationCounts: moveActivationCounts(state),
  });
};

const scheduledResourceChange = (
  effect: Extract<ActiveCombatEffect, { readonly type: "scheduled-resource" }>,
  amount: number,
): ResourceChange => ({
  resource: effect.resource,
  target: "self",
  operation: effect.operation === "damage" ? "lose" : effect.operation,
  amount,
  sourceCombatantId: effect.sourceCombatantId,
  cause:
    effect.sourceCombatantId === effect.targetCombatantId ? "non-damage-effect" : "opponent-effect",
});

const scheduledDamageAfterModifiers = (
  state: ActiveFightState,
  effect: Extract<ActiveCombatEffect, { readonly type: "scheduled-resource" }>,
  baseDamage: number,
) => {
  const source = state.combatants[effect.sourceCombatantId];
  const target = state.combatants[effect.targetCombatantId];
  const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === effect.sourceDefinitionId);
  if (move === undefined)
    throw new Error(`Invalid scheduled damage source ${effect.sourceDefinitionId}.`);
  const constantAdjusted = applyActiveConstantDamageModifiers(
    state,
    source.id,
    target.id,
    baseDamage,
    move,
  );
  const durableAdjusted = state.activeEffects.reduce((damage, candidate) => {
    if (
      candidate.type !== "modify-damage" ||
      candidate.targetCombatantId !== source.id ||
      activeEffectSuppressed(state, candidate)
    )
      return damage;
    const operation = activeDamageEffectOperation(state, candidate, move);
    if (operation === undefined) return damage;
    const modifiedDamage = applyDamageOperation(damage, operation);
    return activeMoveModificationPrevented({
      state,
      combatantId: source.id,
      aspect: "damage",
      move,
      sourceCombatantId: candidate.sourceCombatantId,
      sourceDefinitionId: candidate.sourceDefinitionId,
      reduces: modifiedDamage < damage,
    })
      ? damage
      : modifiedDamage;
  }, constantAdjusted);
  return damageAfterStatusPenalties(state, source, durableAdjusted, move);
};

interface ScheduledResourceBoundaryResult {
  readonly combatants: Readonly<Record<CombatantId, CombatantState>>;
  readonly activeEffects: readonly ActiveCombatEffect[];
  readonly events: readonly CombatEvent[];
  readonly defeatedCombatantId?: CombatantId;
  readonly winnerCombatantId?: CombatantId;
}

const completedStateAfterScheduledBoundary = (
  state: ActiveFightState,
  result: ScheduledResourceBoundaryResult,
  version = state.version + 1,
): CompletedFightState => {
  if (result.defeatedCombatantId === undefined || result.winnerCombatantId === undefined)
    throw new Error("A completed scheduled boundary must identify its loser and winner.");
  return {
    id: state.id,
    version,
    rulesVersion: state.rulesVersion,
    mode: state.mode,
    turnNumber: state.turnNumber,
    combatants: result.combatants,
    activeEffects: [],
    actionHistory: state.actionHistory,
    resolutionFrames: [],
    eventSequence: state.eventSequence + result.events.length,
    status: "completed",
    completion: { type: "defeat", winnerCombatantId: result.winnerCombatantId },
  };
};

type ActiveScheduledResource = Extract<ActiveCombatEffect, { readonly type: "scheduled-resource" }>;

interface ScheduledResourceApplicationResult {
  readonly target: CombatantState;
  readonly events: readonly CombatEvent[];
  readonly winnerCombatantId?: CombatantId;
}

interface ScheduledResourceBoundaryEffectResult {
  readonly combatants: Readonly<Record<CombatantId, CombatantState>>;
  readonly events: readonly CombatEvent[];
  readonly activeEffect?: ActiveCombatEffect;
  readonly defeatedCombatantId?: CombatantId;
  readonly winnerCombatantId?: CombatantId;
}

const scheduledResourceEvents = (
  state: ActiveFightState,
  effect: ActiveScheduledResource,
  previous: CombatantState,
  target: CombatantState,
  amount: number,
  dependencies: CombatDependencies,
): CombatEvent[] => {
  const events: CombatEvent[] = [];
  const nextSequence = () => state.eventSequence + events.length + 1;
  const actualKiChange = target.ki.current - previous.ki.current;
  const actualHpChange = target.hitPoints.current - previous.hitPoints.current;
  if (effect.resource === "ki" && actualKiChange !== 0)
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: nextSequence(),
      fightId: state.id,
      type: "ki-changed",
      combatantId: target.id,
      amount: actualKiChange,
      remainingKi: target.ki.current,
    });
  if (effect.operation === "damage" && amount !== 0)
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: nextSequence(),
      fightId: state.id,
      causedByEffectId: effect.id,
      sourceDefinitionId: effect.sourceDefinitionId,
      type: "damage-applied",
      sourceCombatantId: effect.sourceCombatantId,
      targetCombatantId: target.id,
      amount,
      remainingHitPoints: target.hitPoints.current,
    });
  if (effect.resource === "hp" && effect.operation !== "damage" && actualHpChange !== 0)
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: nextSequence(),
      fightId: state.id,
      causedByEffectId: effect.id,
      sourceDefinitionId: effect.sourceDefinitionId,
      type: "hp-changed",
      sourceCombatantId: effect.sourceCombatantId,
      targetCombatantId: target.id,
      amount: actualHpChange,
      remainingHitPoints: target.hitPoints.current,
      activeEffectId: effect.id,
    });
  return events;
};

const applyScheduledResource = (
  state: ActiveFightState,
  effect: ActiveScheduledResource,
  dependencies: CombatDependencies,
): ScheduledResourceApplicationResult => {
  const resolvedAmount = scheduledResourceAmount(state, effect);
  if (resolvedAmount === undefined || !Number.isFinite(resolvedAmount) || resolvedAmount < 0)
    throw new Error(`Invalid scheduled resource amount for ${effect.id}.`);
  const previous = state.combatants[effect.targetCombatantId];
  const amount =
    effect.operation === "damage"
      ? Math.min(
          previous.hitPoints.current,
          scheduledDamageAfterModifiers(state, effect, resolvedAmount),
        )
      : resolvedAmount;
  const change = scheduledResourceChange(effect, amount);
  const changed =
    effect.operation === "damage"
      ? {
          ...previous,
          hitPoints: { ...previous.hitPoints, current: previous.hitPoints.current - amount },
        }
      : resourceAfterChanges(previous, [change], "self", state.activeEffects);
  const defeated = changed.hitPoints.current === 0 && previous.hitPoints.current > 0;
  const target = defeated ? { ...changed, status: "defeated" as const } : changed;
  const events = scheduledResourceEvents(state, effect, previous, target, amount, dependencies);
  if (!defeated) return { target, events };
  const winnerCombatantId = Object.values(state.combatants).find(
    (combatant) => combatant.id !== target.id && combatant.status === "active",
  )?.id;
  if (winnerCombatantId === undefined)
    throw new Error(`Scheduled resource effect ${effect.id} has no active winner.`);
  return {
    target,
    winnerCombatantId,
    events: [
      ...events,
      {
        id: dependencies.ids.nextEventId(),
        sequence: state.eventSequence + events.length + 1,
        fightId: state.id,
        type: "combatant-defeated",
        combatantId: target.id,
      },
      {
        id: dependencies.ids.nextEventId(),
        sequence: state.eventSequence + events.length + 2,
        fightId: state.id,
        causedByEffectId: effect.id,
        sourceDefinitionId: effect.sourceDefinitionId,
        type: "fight-ended",
        completion: { type: "defeat", winnerCombatantId },
      },
    ],
  };
};

const scheduledResourceBoundaryEffect = (
  state: ActiveFightState,
  effect: ActiveScheduledResource,
  dependencies: CombatDependencies,
): ScheduledResourceBoundaryEffectResult => {
  if (effect.remainingBoundaries > 1)
    return {
      combatants: state.combatants,
      events: [],
      activeEffect: { ...effect, remainingBoundaries: effect.remainingBoundaries - 1 },
    };

  const application = applyScheduledResource(state, effect, dependencies);
  if (application.winnerCombatantId !== undefined)
    return {
      combatants: { ...state.combatants, [application.target.id]: application.target },
      events: application.events,
      defeatedCombatantId: application.target.id,
      winnerCombatantId: application.winnerCombatantId,
    };

  const duration = effect.duration;
  const durationExpired = duration?.type === "turns" && duration.remaining <= 1;
  if (effect.repeat === "once" || durationExpired)
    return {
      combatants: { ...state.combatants, [application.target.id]: application.target },
      events: [
        ...application.events,
        {
          id: dependencies.ids.nextEventId(),
          sequence: state.eventSequence + application.events.length + 1,
          fightId: state.id,
          type: "effect-expired",
          activeEffectId: effect.id,
          targetCombatantId: effect.targetCombatantId,
        },
      ],
    };

  return {
    combatants: { ...state.combatants, [application.target.id]: application.target },
    events: application.events,
    activeEffect: {
      ...effect,
      remainingBoundaries: 1,
      ...(duration?.type === "turns"
        ? { duration: { ...duration, remaining: duration.remaining - 1 } }
        : {}),
    },
  };
};

const scheduledResourceBoundary = (
  state: ActiveFightState,
  boundary: ScheduledResourceBoundary,
  dependencies: CombatDependencies,
): ScheduledResourceBoundaryResult => {
  let combatants = state.combatants;
  const events: CombatEvent[] = [];
  const activeEffects: ActiveCombatEffect[] = [];
  let defeatedCombatantId: CombatantId | undefined;
  let winnerCombatantId: CombatantId | undefined;

  for (const effect of state.activeEffects) {
    if (
      effect.type !== "scheduled-resource" ||
      !scheduledResourceMatchesBoundary(effect, boundary)
    ) {
      activeEffects.push(effect);
      continue;
    }
    const result = scheduledResourceBoundaryEffect(
      { ...state, combatants, eventSequence: state.eventSequence + events.length },
      effect,
      dependencies,
    );
    combatants = result.combatants;
    events.push(...result.events);
    if (result.defeatedCombatantId !== undefined) {
      defeatedCombatantId = result.defeatedCombatantId;
      winnerCombatantId = result.winnerCombatantId;
      break;
    }
    if (result.activeEffect !== undefined) activeEffects.push(result.activeEffect);
  }

  return {
    combatants,
    activeEffects,
    events,
    ...(defeatedCombatantId === undefined ? {} : { defeatedCombatantId, winnerCombatantId }),
  };
};

interface AttackEffectResolutionContext {
  readonly attackerId: CombatantId;
  readonly defenderId: CombatantId;
  readonly turnNumber: number;
  readonly outcome?: "successful" | "stopped";
  readonly rolls?: readonly {
    readonly attackResult: number;
    readonly attackNaturalResult?: number;
    readonly defenseResult?: number;
  }[];
  readonly move?: MoveDefinition;
  readonly basicAttack?: BasicAttackType;
}

const scheduledSelectorMatchesAttack = (
  selector: MoveSelectorCondition,
  context: AttackEffectResolutionContext,
) => {
  if (context.move !== undefined) return selectorMatchesMove(selector, context.move);
  if (context.basicAttack === undefined) return false;
  const details = basicAttackDetails(context.basicAttack);
  const tags = new Set<string>([details.attackType, ...details.tags]);
  const hasMoveOnlyConstraint =
    selector.ids !== undefined ||
    selector.styleId !== undefined ||
    selector.styleIdExcludes !== undefined ||
    selector.category !== undefined ||
    selector.categoryExcludes !== undefined ||
    selector.categories !== undefined ||
    selector.custom !== undefined ||
    selector.styleProvenance !== undefined ||
    selector.effectKinds !== undefined ||
    selector.constant !== undefined ||
    selector.effectTextIncludes !== undefined ||
    selector.effectTextIncludesAny !== undefined ||
    selector.effectTextExcludes !== undefined ||
    selector.selectionKey !== undefined ||
    selector.requirementExcludes !== undefined ||
    selector.requirementIncludes !== undefined ||
    selector.baseKiCost !== undefined ||
    selector.costModification !== undefined;
  return (
    !hasMoveOnlyConstraint &&
    (selector.tags === undefined || selector.tags.every((tag) => tags.has(tag))) &&
    (selector.restriction === undefined || selector.restriction === "unrestricted") &&
    (selector.attackRoll?.dice === undefined || selector.attackRoll.dice === 1) &&
    (selector.attackRoll?.minimumDice === undefined || selector.attackRoll.minimumDice <= 1) &&
    selector.attackRoll?.sides === undefined
  );
};

const lockExpiresAfterRoll = (
  effect: Extract<
    ActiveCombatEffect,
    {
      readonly type:
        | "action-lock"
        | "prevent-move-use"
        | "prevent-status"
        | "prevent-combat-result"
        | "prevent-roll-modification"
        | "prevent-move-modification"
        | "prevent-resource-modification";
    }
  >,
  { attackerId, defenderId, rolls }: AttackEffectResolutionContext,
) => {
  const duration = effect.duration;
  if (duration.type !== "until-roll-threshold" || rolls === undefined) return false;
  if (duration.roll === "attack" && duration.combatantId === attackerId) {
    return rolls.some((roll) =>
      numericSelectorComparison(roll.attackResult, duration.comparison, duration.value),
    );
  }
  if (duration.roll !== "defense" || duration.combatantId !== defenderId) return false;
  return rolls.some(
    (roll) =>
      roll.defenseResult !== undefined &&
      numericSelectorComparison(roll.defenseResult, duration.comparison, duration.value),
  );
};

const lockExpiresAfterCombatResult = (
  effect: Extract<
    ActiveCombatEffect,
    {
      readonly type:
        | "action-lock"
        | "prevent-move-use"
        | "prevent-status"
        | "prevent-combat-result"
        | "prevent-roll-modification"
        | "prevent-move-modification"
        | "prevent-resource-modification";
    }
  >,
  { attackerId, outcome, move }: AttackEffectResolutionContext,
) => {
  const duration = effect.duration;
  return (
    duration.type === "until-combat-result" &&
    duration.combatantId === attackerId &&
    outcome === duration.result &&
    (duration.selector === undefined ||
      (move !== undefined && selectorMatchesMove(duration.selector, move)))
  );
};

const costModifierAppliesToMove = (
  effect: Extract<ActiveCombatEffect, { readonly type: "modify-ki-cost" }>,
  context: AttackEffectResolutionContext,
) => {
  const { move } = context;
  return (
    move !== undefined &&
    effect.targetCombatantId === context.attackerId &&
    effect.selector.category === move.category &&
    move.mechanics.kiCost?.type === "literal" &&
    effect.selector.baseKiCost === move.mechanics.kiCost.value
  );
};

const nextActionEffectAfterAttack = (
  effect: Extract<ActiveCombatEffect, { readonly type: "modify-next-action" }>,
  context: AttackEffectResolutionContext,
) => {
  if (effect.modifier.type === "damage") return damageEffectAfterAttack(effect, context);
  if (effect.modifier.type === "roll") return rollEffectAfterAttack(effect, context);
  return statEffectAfterAttack(effect, context);
};

const statEffectAfterAttack = (
  effect: Extract<ActiveCombatEffect, { readonly type: "modify-next-action" }>,
  context: AttackEffectResolutionContext,
) => {
  if (effect.modifier.type !== "stat" || !effectMatchesMoveSelector(effect.selector, context.move))
    return [effect];
  if (effect.modifier.roll === "defense")
    return effect.targetCombatantId === context.defenderId &&
      (context.rolls?.some((roll) => roll.defenseResult !== undefined) ?? false)
      ? []
      : [effect];
  return effect.targetCombatantId === context.attackerId ? [] : [effect];
};

const damageEffectAfterAttack = (
  effect: Extract<ActiveCombatEffect, { readonly type: "modify-next-action" }>,
  context: AttackEffectResolutionContext,
) => {
  if (
    effect.targetCombatantId !== context.attackerId ||
    !effectMatchesMoveSelector(effect.selector, context.move) ||
    !oneShotRollModifierIsEligible(context.turnNumber, effect)
  )
    return [effect];
  const scope = effect.scope ?? "next-action";
  if (scope !== "next-actions") return [];
  const remaining = (effect.remaining ?? 0) - 1;
  return remaining > 0 ? [{ ...effect, remaining }] : [];
};

const rollEffectAfterAttack = (
  effect: Extract<ActiveCombatEffect, { readonly type: "modify-next-action" }>,
  context: AttackEffectResolutionContext,
) => {
  if (!effectMatchesMoveSelector(effect.selector, context.move)) return [effect];
  const rollCount = matchingRollCount(effect, context);
  if (rollCount === 0 || !oneShotRollModifierIsEligible(context.turnNumber, effect))
    return [effect];
  const scope = effect.scope ?? "next-action";
  if (scope === "next-rolls") {
    const remaining = (effect.remaining ?? 0) - rollCount;
    return remaining > 0 ? [{ ...effect, remaining }] : [];
  }
  if (scope === "next-actions") {
    const remaining = (effect.remaining ?? 0) - 1;
    return remaining > 0 ? [{ ...effect, remaining }] : [];
  }
  return [];
};

const matchingRollCount = (
  effect: Extract<ActiveCombatEffect, { type: "modify-next-action" }>,
  context: AttackEffectResolutionContext,
) => {
  if (effect.modifier.type !== "roll") return 0;
  if (effect.targetCombatantId === context.attackerId && effect.modifier.roll === "attack")
    return context.rolls?.length ?? 0;
  if (effect.targetCombatantId === context.defenderId && effect.modifier.roll === "defense")
    return context.rolls?.filter((roll) => roll.defenseResult !== undefined).length ?? 0;
  return 0;
};

const resolutionThresholdExpiresAfterAttack = (
  effect: Extract<ActiveCombatEffect, { type: "set-resolution-threshold" }>,
  context: AttackEffectResolutionContext,
) => {
  const duration = effect.duration;
  if (duration.type !== "until-roll-threshold" || context.rolls === undefined) return false;
  if (duration.roll === "attack" && duration.combatantId === context.attackerId)
    return context.rolls.some((roll) =>
      numericSelectorComparison(roll.attackResult, duration.comparison, duration.value),
    );
  if (duration.roll === "defense" && duration.combatantId === context.defenderId)
    return context.rolls.some(
      (roll) =>
        roll.defenseResult !== undefined &&
        numericSelectorComparison(roll.defenseResult, duration.comparison, duration.value),
    );
  return false;
};

const resolutionThresholdAfterAttack = (
  effect: Extract<ActiveCombatEffect, { type: "set-resolution-threshold" }>,
  context: AttackEffectResolutionContext,
) => {
  if (
    effect.scope === "next-action" &&
    resolutionThresholdAppliesToAttack(effect, context.attackerId, context.defenderId, context.move)
  )
    return [];
  return resolutionThresholdExpiresAfterAttack(effect, context) ? [] : [effect];
};

type DurationBoundPrevention = Extract<
  ActiveCombatEffect,
  {
    readonly type:
      | "action-lock"
      | "prevent-move-use"
      | "prevent-status"
      | "prevent-combat-result"
      | "prevent-roll-modification"
      | "prevent-move-modification"
      | "prevent-resource-modification";
  }
>;

const preventionAfterAttack = (
  effect: DurationBoundPrevention,
  context: AttackEffectResolutionContext,
): readonly ActiveCombatEffect[] => {
  if (
    effect.type === "prevent-roll-modification" &&
    effect.duration.type === "next-actions" &&
    effect.duration.ownerCombatantId === context.attackerId
  ) {
    return effect.duration.remaining <= 1
      ? []
      : [
          {
            ...effect,
            duration: { ...effect.duration, remaining: effect.duration.remaining - 1 },
          },
        ];
  }
  return lockExpiresAfterRoll(effect, context) || lockExpiresAfterCombatResult(effect, context)
    ? []
    : [effect];
};

const suppressionAfterAttack = (
  effect: Extract<ActiveCombatEffect, { readonly type: "suppress" }>,
  context: AttackEffectResolutionContext,
): readonly ActiveCombatEffect[] => {
  if (
    effect.duration.type === "next-actions" &&
    effect.duration.ownerCombatantId === context.attackerId &&
    effectMatchesMoveSelector(effect.selector, context.move)
  ) {
    return effect.duration.remaining <= 1
      ? []
      : [{ ...effect, duration: { ...effect.duration, remaining: effect.duration.remaining - 1 } }];
  }
  if (effect.duration.type === "until-roll-threshold") {
    const duration = effect.duration;
    if (
      duration.combatantId === context.attackerId &&
      (context.rolls?.some((roll) =>
        numericSelectorComparison(roll.attackResult, duration.comparison, duration.value),
      ) ??
        false)
    )
      return [];
  }
  return [effect];
};

const floatingEffectTerminatesAfterAttack = (
  effect: Extract<ActiveCombatEffect, { readonly type: "floating-effect" }>,
  context: AttackEffectResolutionContext,
) => {
  const duration = effect.duration;
  if (
    duration !== undefined &&
    (duration.combatantId === context.attackerId || duration.combatantId === context.defenderId) &&
    duration.result === context.outcome &&
    (duration.moveSelector === undefined ||
      (context.move !== undefined && selectorMatchesMove(duration.moveSelector, context.move))) &&
    (duration.rollThreshold === undefined ||
      (((duration.rollThreshold.roll === "attack" && duration.combatantId === context.attackerId) ||
        (duration.rollThreshold.roll === "defense" &&
          duration.combatantId === context.defenderId)) &&
        scheduledRollMatches(
          duration.rollThreshold.roll,
          duration.rollThreshold.comparison,
          duration.rollThreshold.value,
          context,
        )))
  )
    return true;
  return effect.termination.some((rule) => {
    const resultMatches =
      (rule.trigger === "on-success" && context.outcome === "successful") ||
      (rule.trigger === "on-stopped" && context.outcome === "stopped");
    const actorMatches =
      (rule.actor === "self" && effect.sourceCombatantId === context.attackerId) ||
      (rule.actor === "opponent" && effect.sourceCombatantId === context.defenderId);
    const selectorMatches =
      rule.selector === undefined ||
      (context.move !== undefined && selectorMatchesMove(rule.selector, context.move));
    return resultMatches && actorMatches && selectorMatches;
  });
};

const scheduledRollMatches = (
  roll: CombatRollType,
  comparison: "at-least" | "at-most",
  value: number,
  context: AttackEffectResolutionContext,
) => {
  if ((roll !== "attack" && roll !== "defense") || context.rolls === undefined) return false;
  return context.rolls.some((result) => {
    const candidate = roll === "attack" ? result.attackResult : result.defenseResult;
    return candidate !== undefined && numericSelectorComparison(candidate, comparison, value);
  });
};

const scheduledResourceExpiresAfterAttack = (
  effect: Extract<ActiveCombatEffect, { readonly type: "scheduled-resource" }>,
  context: AttackEffectResolutionContext,
) => {
  const duration = effect.duration;
  if (
    duration?.type === "until-roll-threshold" &&
    ((duration.roll === "attack" && duration.combatantId === context.attackerId) ||
      (duration.roll === "defense" && duration.combatantId === context.defenderId)) &&
    (duration.moveSelector === undefined ||
      scheduledSelectorMatchesAttack(duration.moveSelector, context)) &&
    scheduledRollMatches(duration.roll, duration.comparison, duration.value, context)
  )
    return true;
  const cancellation = effect.cancellation;
  if (
    cancellation === undefined ||
    cancellation.actorCombatantId !== context.attackerId ||
    cancellation.result !== context.outcome ||
    !scheduledSelectorMatchesAttack(cancellation.moveSelector, context)
  )
    return false;
  const targetMatches =
    cancellation.target === "source"
      ? context.defenderId === effect.sourceCombatantId
      : context.defenderId !== effect.sourceCombatantId;
  return (
    targetMatches &&
    (cancellation.rollThreshold === undefined ||
      scheduledRollMatches(
        cancellation.rollThreshold.roll,
        cancellation.rollThreshold.comparison,
        cancellation.rollThreshold.value,
        context,
      ))
  );
};

const modifyDamageAfterNonFloatingAttackResolution = (
  effect: Extract<ActiveCombatEffect, { readonly type: "modify-damage" }>,
  context: AttackEffectResolutionContext,
): readonly ActiveCombatEffect[] => {
  const duration = effect.duration;
  return duration.type === "until-roll-threshold" &&
    duration.combatantId === context.attackerId &&
    context.rolls?.some((roll) =>
      numericSelectorComparison(roll.attackResult, duration.comparison, duration.value),
    )
    ? []
    : [effect];
};

const effectAfterNonFloatingAttackResolution = (
  effect: Exclude<ActiveCombatEffect, { readonly type: "floating-effect" | "scheduled-resource" }>,
  context: AttackEffectResolutionContext,
): readonly ActiveCombatEffect[] => {
  if (effect.type === "modify-damage")
    return modifyDamageAfterNonFloatingAttackResolution(effect, context);
  if (
    effect.type === "modify-roll" &&
    effect.duration !== "combat" &&
    effect.duration.type === "turns-or-until-perfect-roll" &&
    effect.targetCombatantId === context.attackerId &&
    context.rolls?.some((roll) => roll.attackNaturalResult === 30)
  )
    return [];
  if (effect.type === "modify-stat") return [effect];
  if (effect.type === "suppress") return suppressionAfterAttack(effect, context);
  if (effect.type === "modify-ki-cost")
    return costModifierAppliesToMove(effect, context) ? [] : [effect];
  if (isConsumedItemAttackDamage(effect, context.attackerId)) {
    return effect.remainingAttacks === 1
      ? []
      : [{ ...effect, remainingAttacks: effect.remainingAttacks - 1 }];
  }
  if (isAttackResolutionPreventionEffect(effect)) {
    return preventionAfterAttack(effect, context);
  }
  if (effect.type === "set-resolution-threshold")
    return resolutionThresholdAfterAttack(effect, context);
  return effect.type === "modify-next-action"
    ? nextActionEffectAfterAttack(effect, context)
    : [effect];
};

const isAttackResolutionPreventionEffect = (
  effect: Exclude<ActiveCombatEffect, { readonly type: "floating-effect" }>,
): effect is Extract<
  ActiveCombatEffect,
  {
    readonly type:
      | "action-lock"
      | "prevent-move-use"
      | "prevent-status"
      | "prevent-combat-result"
      | "prevent-roll-modification"
      | "prevent-move-modification";
  }
> =>
  effect.type === "action-lock" ||
  effect.type === "prevent-move-use" ||
  effect.type === "prevent-status" ||
  effect.type === "prevent-combat-result" ||
  effect.type === "prevent-roll-modification" ||
  effect.type === "prevent-move-modification";

const isConsumedItemAttackDamage = (
  effect: Exclude<ActiveCombatEffect, { readonly type: "floating-effect" }>,
  attackerId: CombatantId,
): effect is Extract<ActiveCombatEffect, { readonly type: "modify-item-next-attack-damage" }> =>
  effect.type === "modify-item-next-attack-damage" && effect.targetCombatantId === attackerId;

const effectAfterAttackResolution = (
  effect: ActiveCombatEffect,
  context: AttackEffectResolutionContext,
): readonly ActiveCombatEffect[] => {
  if (effect.type === "floating-effect") {
    const actionConsumed =
      effect.scope.type === "next-action" && effect.targetCombatantId === context.attackerId;
    return actionConsumed || floatingEffectTerminatesAfterAttack(effect, context) ? [] : [effect];
  }
  if (effect.type === "scheduled-resource")
    return scheduledResourceExpiresAfterAttack(effect, context) ? [] : [effect];
  return effectAfterNonFloatingAttackResolution(effect, context);
};

/** Consumes one-shot modifiers and expires declared lock durations after an attack. */
const effectsAfterAttackResolution = (
  state: ActiveFightState,
  context: AttackEffectResolutionContext,
) =>
  state.activeEffects.flatMap<ActiveCombatEffect>((effect) =>
    effectAfterAttackResolution(effect, context),
  );

const adjustedAttackRoll = (
  state: ActiveFightState,
  combatantId: CombatantId,
  roll: ReturnType<typeof defaultMoveAttackRoll>,
  move?: MoveDefinition,
) => ({
  ...roll,
  sides: roll.sides + activeRollModifier(state, combatantId, "attack", "sides", move),
});

const withoutPendingResolution = (state: ActiveFightState): ActiveFightState => {
  const nextState = { ...state, resolutionFrames: [] };
  Reflect.deleteProperty(nextState, "pendingDecision");
  return nextState;
};

interface DefenseRequestContext {
  readonly state: ActiveFightState;
  readonly decision: BasicAttackDecision | Extract<CombatDecision, { readonly type: "use-move" }>;
  readonly target: ActiveFightState["combatants"][CombatantId];
  readonly attack: Extract<
    ActiveFightState["resolutionFrames"][number],
    { readonly stage: "awaiting-defense" }
  >["attack"];
  readonly blockableAttack: BlockableAttack;
  readonly preventBlock?: boolean;
  readonly enabledOptionalEffectIndices?: readonly number[];
  readonly resolvedOptionalEffectIndices?: readonly number[];
  readonly dependencies: CombatDependencies;
}

type ItemEffect = NonNullable<ItemDefinition["effects"]>[number];
type PreRollDefenseModifier = ItemEffect & {
  readonly type: "item-modify-roll";
  readonly roll: "defense";
  readonly target: "self";
  readonly modifier: "result";
};

interface DefenseItemUse {
  readonly item: ItemDefinition;
  readonly modifier: PreRollDefenseModifier;
  readonly response: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>;
  readonly kiCost: number;
}

const preRollDefenseModifier = (item: ItemDefinition): PreRollDefenseModifier | undefined => {
  const modifier = item.effects?.find(
    (effect): effect is PreRollDefenseModifier =>
      effect.trigger === "combat-action" &&
      effect.type === "item-modify-roll" &&
      effect.target === "self" &&
      effect.roll === "defense" &&
      effect.modifier === "result",
  );
  const declaresBeforeRoll = item.effects?.some(
    (effect) => effect.type === "item-state-rule" && effect.operation === "declare-before-roll",
  );
  return declaresBeforeRoll ? modifier : undefined;
};

const availablePreRollDefenseItems = (combatant: ActiveFightState["combatants"][CombatantId]) =>
  (combatant.itemIds ?? []).flatMap((itemId) => {
    const item = ITEM_DEFINITIONS.find((candidate) => candidate.id === itemId);
    if (item === undefined) return [];
    if (item.maxUses !== undefined && (combatant.itemUses?.[itemId] ?? 0) >= item.maxUses)
      return [];
    const modifier = preRollDefenseModifier(item);
    return modifier === undefined ? [] : [{ item, modifier, kiCost: 0 }];
  });

const availablePostRollDefenseItems = (combatant: ActiveFightState["combatants"][CombatantId]) =>
  (combatant.itemIds ?? []).flatMap((itemId) => {
    const item = ITEM_DEFINITIONS.find((candidate) => candidate.id === itemId);
    if (item === undefined || (combatant.itemUses?.[itemId] ?? 0) > 0) return [];
    const modifier = item.effects?.find(
      (effect): effect is PreRollDefenseModifier =>
        effect.trigger === "combat-action" &&
        effect.type === "item-modify-roll" &&
        effect.target === "self" &&
        effect.roll === "defense" &&
        effect.modifier === "result",
    );
    const afterRoll = item.effects?.some(
      (effect) => effect.type === "item-state-rule" && effect.operation === "declare-after-roll",
    );
    const kiCost = /pay 1 Ki Point/i.test(item.effectText) ? 1 : undefined;
    return modifier === undefined ||
      !afterRoll ||
      kiCost === undefined ||
      combatant.ki.current < kiCost
      ? []
      : [{ item, modifier, kiCost }];
  });

const requestAttackDefense = ({
  state,
  decision,
  target,
  attack,
  blockableAttack,
  preventBlock = false,
  enabledOptionalEffectIndices,
  resolvedOptionalEffectIndices,
  dependencies,
}: DefenseRequestContext): CombatResult<CombatTransition> => {
  const pendingDecisionId = dependencies.ids.nextPendingDecisionId();
  const blocks = preventBlock ? [] : legalBlockMoves(state, target.id, blockableAttack);
  const defenseItems = availablePreRollDefenseItems(target);
  const nextState: ActiveFightState = {
    ...state,
    version: state.version + 1,
    pendingDecision: {
      id: pendingDecisionId,
      stateVersion: state.version + 1,
      combatantId: target.id,
      type: "defense-response",
      options: [
        { id: "roll-defense", type: "roll-defense" },
        ...defenseItems.map(({ item }) => ({
          id: `activate-item:${item.id}`,
          type: "activate-effect" as const,
          itemId: item.id,
        })),
        ...blocks.map((block) => ({
          id: `use-block:${block.id}`,
          type: "use-block" as const,
          moveId: block.id,
        })),
      ],
    },
    resolutionFrames: [
      {
        id: dependencies.ids.nextResolutionFrameId(),
        type: "attack",
        decisionId: decision.id,
        attackerId: decision.actorId,
        targetCombatantId: target.id,
        returnPhase: state.phase === "counter" ? "counter" : "action",
        stage: "awaiting-defense",
        pendingDecisionId,
        attack,
        ...(enabledOptionalEffectIndices === undefined ? {} : { enabledOptionalEffectIndices }),
        ...(resolvedOptionalEffectIndices === undefined ? {} : { resolvedOptionalEffectIndices }),
      },
    ],
    eventSequence: state.eventSequence + 1,
  };

  return transitionFrom(nextState, [
    {
      id: dependencies.ids.nextEventId(),
      sequence: nextState.eventSequence,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "defense-requested",
      attackerCombatantId: decision.actorId,
      defenderCombatantId: target.id,
      pendingDecisionId,
    },
  ]);
};

const requestAttackEffectChoice = ({
  state,
  decision,
  target,
  move,
  effectIndices,
  numericSelection,
  dependencies,
}: {
  readonly state: ActiveFightState;
  readonly decision: Extract<CombatDecision, { readonly type: "use-move" }>;
  readonly target: ActiveFightState["combatants"][CombatantId];
  readonly move: MoveDefinition;
  readonly effectIndices: readonly number[];
  readonly numericSelection: PendingEffectChoice["numericSelection"];
  readonly dependencies: CombatDependencies;
}): CombatResult<CombatTransition> => {
  const pendingDecisionId = dependencies.ids.nextPendingDecisionId();
  const nextVersion = state.version + 1;
  const nextState: ActiveFightState = {
    ...state,
    version: nextVersion,
    pendingDecision: {
      id: pendingDecisionId,
      stateVersion: nextVersion,
      combatantId: decision.actorId,
      type: "optional-effect",
      options: [
        ...(numericSelection === undefined
          ? [
              {
                id: `activate-effect:${effectIndices.join(",")}`,
                type: "activate-effect" as const,
                effectIndices,
              },
            ]
          : Array.from(
              { length: numericSelection.maximum - numericSelection.minimum + 1 },
              (_, index) => {
                const selectedNumericValue = numericSelection.minimum + index;
                return {
                  id: `activate-effect:${effectIndices.join(",")}:${numericSelection.key}=${selectedNumericValue}`,
                  type: "activate-effect" as const,
                  effectIndices,
                  selectedNumericValue,
                };
              },
            )),
        { id: "decline", type: "decline" },
      ],
    },
    resolutionFrames: [
      {
        id: dependencies.ids.nextResolutionFrameId(),
        type: "attack",
        decisionId: decision.id,
        attackerId: decision.actorId,
        targetCombatantId: target.id,
        returnPhase: state.phase === "counter" ? "counter" : "action",
        stage: "awaiting-effect-choice",
        pendingDecisionId,
        attack: { type: "move", moveId: move.id },
        effectIndices,
        resolvedEffectIndices: [],
        enabledEffectIndices: [],
        ...(numericSelection === undefined ? {} : { selectedNumericValues: {} }),
      },
    ],
    eventSequence: state.eventSequence + 1,
  };
  return transitionFrom(nextState, []);
};

interface AttackResolution {
  readonly attackNaturalResult: number;
  readonly attackResult: number;
  readonly critical: boolean;
  readonly counter: boolean;
  readonly damage: number;
  readonly defeated: boolean;
  readonly defenseNaturalResult: number;
  readonly defenseResult: number;
  readonly outcome: "stopped" | "successful";
  readonly remainingHitPoints: number;
}

interface BasicAttackEventContext {
  readonly attacker: ActiveFightState["combatants"][CombatantId];
  readonly counterChainLimitReached: boolean;
  readonly counterContinues: boolean;
  readonly resolution: AttackResolution;
  readonly target: ActiveFightState["combatants"][CombatantId];
  readonly defenseItemUse?: DefenseItemUse;
  /** Roll events were already emitted by a post-roll reaction suspension. */
  readonly includeRollEvents?: boolean;
}

interface BasicAttackStateContext {
  readonly actionHistory: readonly CombatActionRecord[];
  readonly attacker: BasicAttackEventContext["attacker"];
  readonly combatants: ActiveFightState["combatants"];
  readonly counterContinues: boolean;
  readonly defeated: boolean;
  readonly eventSequence: number;
  readonly resolution: AttackResolution;
  readonly target: BasicAttackEventContext["target"];
}

type ResultOverride = "stopped" | "successful" | undefined;
type NumericResultOverride = { readonly attack?: number; readonly defense?: number } | undefined;

interface ResolveAttackInput {
  readonly attacker: ActiveFightState["combatants"][CombatantId];
  readonly target: ActiveFightState["combatants"][CombatantId];
  readonly dependencies: CombatDependencies;
  readonly attackSides: number;
  readonly defenseSides?: number;
  readonly baseDamage: number;
  readonly attackResultModifier?: number;
  readonly defenseResultModifier?: number;
  readonly preventCritical?: boolean;
  readonly preventCounter?: boolean;
  readonly naturalRolls?: readonly ContestedAttackNaturalRoll[];
  readonly resultOverrides?: readonly ResultOverride[];
  readonly numericResultOverrides?: readonly NumericResultOverride[];
  readonly resolutionThresholds?: readonly ResolutionThresholdRule[];
}

const resolveAttack = ({
  attacker,
  target,
  dependencies,
  attackSides,
  defenseSides,
  baseDamage,
  attackResultModifier = 0,
  defenseResultModifier = 0,
  preventCritical = false,
  preventCounter = false,
  naturalRolls,
  resultOverrides,
  numericResultOverrides,
  resolutionThresholds,
}: ResolveAttackInput): AttackResolution => {
  const [die] = resolveContestedAttackRolls(
    {
      attack: { dice: 1, sides: attackSides },
      attackerDexterityBonus: attacker.stats.dexterityBonus + attackResultModifier,
      defenderDexterityBonus: target.stats.dexterityBonus,
      defenseSides,
      defenderResultModifier: defenseResultModifier,
      naturalRolls,
      resultOverrides,
      numericResultOverrides,
      resolutionThresholds,
    },
    dependencies.random,
  );
  if (
    die.outcome === "blocked" ||
    die.defenseNaturalResult === undefined ||
    die.defenseResult === undefined
  ) {
    throw new Error("A single unblocked attack must produce one defensive roll.");
  }
  const { attackNaturalResult, attackResult, defenseNaturalResult, defenseResult } = die;
  const outcome = die.outcome === "successful" ? "successful" : "stopped";
  const qualificationInput = {
    attackerDexterity: attacker.stats.dexterity,
    defenderDexterity: target.stats.dexterity,
    diceCount: 1,
    diceSides: attackSides,
    naturalAttackResult: attackNaturalResult,
    naturalDefenseResult: defenseNaturalResult,
    outcome,
  } as const;
  const critical = !preventCritical && qualifiesForCritical(qualificationInput);
  const counter = !preventCounter && qualifiesForCounter(qualificationInput);
  const damage =
    outcome === "successful"
      ? Math.min(calculateAttackDamage(baseDamage, critical), target.hitPoints.current)
      : 0;
  const remainingHitPoints = target.hitPoints.current - damage;

  return {
    attackNaturalResult,
    attackResult,
    critical,
    counter,
    damage,
    defeated: outcome === "successful" && remainingHitPoints === 0,
    defenseNaturalResult,
    defenseResult,
    outcome,
    remainingHitPoints,
  };
};

const createBasicAttackEvents = (
  state: ActiveFightState,
  decision: BasicAttackDecision,
  dependencies: CombatDependencies,
  {
    attacker,
    counterChainLimitReached,
    counterContinues,
    defenseItemUse,
    includeRollEvents = true,
    resolution,
    target,
  }: BasicAttackEventContext,
): CombatEvent[] => {
  const events: CombatEvent[] = [];
  if (includeRollEvents) {
    events.push(
      {
        id: dependencies.ids.nextEventId(),
        sequence: state.eventSequence + 1,
        fightId: state.id,
        causedByDecisionId: decision.id,
        type: "attack-rolled",
        combatantId: attacker.id,
        targetCombatantId: target.id,
        basicAttack: decision.basicAttack,
        naturalResult: resolution.attackNaturalResult,
        result: resolution.attackResult,
      },
      {
        id: dependencies.ids.nextEventId(),
        sequence: state.eventSequence + 2,
        fightId: state.id,
        causedByDecisionId: decision.id,
        type: "defense-rolled",
        combatantId: target.id,
        sourceCombatantId: attacker.id,
        naturalResult: resolution.defenseNaturalResult,
        result: resolution.defenseResult,
      },
    );
  }
  if (defenseItemUse !== undefined) {
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + events.length + 1,
      fightId: state.id,
      causedByDecisionId: defenseItemUse.response.id,
      type: "item-used",
      combatantId: target.id,
      itemId: defenseItemUse.item.id,
    });
    if (defenseItemUse.kiCost !== 0) {
      events.push({
        id: dependencies.ids.nextEventId(),
        sequence: state.eventSequence + events.length + 1,
        fightId: state.id,
        causedByDecisionId: defenseItemUse.response.id,
        type: "ki-changed",
        combatantId: target.id,
        amount: -defenseItemUse.kiCost,
        remainingKi: target.ki.current - defenseItemUse.kiCost,
      });
    }
  }
  events.push({
    id: dependencies.ids.nextEventId(),
    sequence: state.eventSequence + events.length + 1,
    fightId: state.id,
    causedByDecisionId: decision.id,
    type: "attack-resolved",
    combatantId: attacker.id,
    targetCombatantId: target.id,
    basicAttack: decision.basicAttack,
    outcome: resolution.outcome,
    critical: resolution.critical,
    counter: resolution.counter,
  });
  appendBasicAttackOutcomeEvents(state, decision, dependencies, events, {
    attacker,
    target,
    resolution,
    counterContinues,
    counterChainLimitReached,
  });
  return events;
};

const appendBasicAttackOutcomeEvents = (
  state: ActiveFightState,
  decision: BasicAttackDecision,
  dependencies: CombatDependencies,
  events: CombatEvent[],
  {
    attacker,
    counterChainLimitReached,
    counterContinues,
    resolution,
    target,
  }: BasicAttackEventContext,
) => {
  if (resolution.outcome === "successful") {
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + events.length + 1,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "damage-applied",
      sourceCombatantId: attacker.id,
      targetCombatantId: target.id,
      amount: resolution.damage,
      remainingHitPoints: resolution.remainingHitPoints,
    });
  }
  if (resolution.defeated) {
    events.push(
      {
        id: dependencies.ids.nextEventId(),
        sequence: state.eventSequence + events.length + 1,
        fightId: state.id,
        causedByDecisionId: decision.id,
        type: "combatant-defeated",
        combatantId: target.id,
      },
      {
        id: dependencies.ids.nextEventId(),
        sequence: state.eventSequence + events.length + 1,
        fightId: state.id,
        causedByDecisionId: decision.id,
        type: "fight-ended",
        completion: { type: "defeat", winnerCombatantId: attacker.id },
      },
    );
  } else {
    if (counterChainLimitReached) {
      events.push({
        id: dependencies.ids.nextEventId(),
        sequence: state.eventSequence + events.length + 1,
        fightId: state.id,
        causedByDecisionId: decision.id,
        type: "counter-chain-limit-reached",
        counterAttackCount:
          GLOBAL_RULES.combat.engineeringSafeguards.maximumConsecutiveCounterAttacks,
      });
    }
    events.push(
      createPhaseChangedEvent(
        state,
        dependencies,
        counterContinues ? "counter" : "end",
        state.eventSequence + events.length + 1,
        decision.id,
      ),
    );
  }
};

interface DeathBeamResolutionContext extends BasicAttackEventContext {
  readonly activatedEffect?: ActiveCostModifierEffect;
  readonly cost: number;
  readonly matchingEffects: readonly ActiveCostModifierEffect[];
  readonly remainingEffects: readonly ActiveCombatEffect[];
}

const nextEventSequence = (state: ActiveFightState, events: readonly CombatEvent[]) =>
  state.eventSequence + events.length + 1;

const appendDeathBeamActionEvents = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  dependencies: CombatDependencies,
  events: CombatEvent[],
  context: DeathBeamResolutionContext,
) => {
  const { attacker, cost, matchingEffects, resolution, target } = context;
  events.push(
    {
      id: dependencies.ids.nextEventId(),
      sequence: nextEventSequence(state, events),
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "move-used",
      combatantId: attacker.id,
      moveId: deathBeam!.id,
      targetCombatantId: target.id,
    },
    {
      id: dependencies.ids.nextEventId(),
      sequence: nextEventSequence(state, events),
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "ki-changed",
      combatantId: attacker.id,
      amount: -cost,
      remainingKi: attacker.ki.current - cost,
    },
  );
  for (const effect of matchingEffects) {
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: nextEventSequence(state, events),
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "effect-expired",
      activeEffectId: effect.id,
      targetCombatantId: attacker.id,
    });
  }
  events.push(
    {
      id: dependencies.ids.nextEventId(),
      sequence: nextEventSequence(state, events),
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "attack-rolled",
      combatantId: attacker.id,
      targetCombatantId: target.id,
      moveId: deathBeam!.id,
      naturalResult: resolution.attackNaturalResult,
      result: resolution.attackResult,
    },
    {
      id: dependencies.ids.nextEventId(),
      sequence: nextEventSequence(state, events),
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "defense-rolled",
      combatantId: target.id,
      sourceCombatantId: attacker.id,
      naturalResult: resolution.defenseNaturalResult,
      result: resolution.defenseResult,
    },
    {
      id: dependencies.ids.nextEventId(),
      sequence: nextEventSequence(state, events),
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "attack-resolved",
      combatantId: attacker.id,
      targetCombatantId: target.id,
      moveId: deathBeam!.id,
      outcome: resolution.outcome,
      critical: resolution.critical,
      counter: resolution.counter,
    },
  );
};

const appendDeathBeamOutcomeEvents = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  dependencies: CombatDependencies,
  events: CombatEvent[],
  context: DeathBeamResolutionContext,
) => {
  const { activatedEffect, attacker, resolution, target } = context;
  if (resolution.outcome === "successful") {
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: nextEventSequence(state, events),
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "damage-applied",
      sourceCombatantId: attacker.id,
      targetCombatantId: target.id,
      amount: resolution.damage,
      remainingHitPoints: resolution.remainingHitPoints,
    });
  }
  if (activatedEffect !== undefined) {
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: nextEventSequence(state, events),
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "effect-activated",
      activeEffectId: activatedEffect.id,
      sourceCombatantId: attacker.id,
      targetCombatantId: target.id,
      sourceDefinitionId: deathBeam!.id,
    });
  }
  if (resolution.defeated) {
    events.push(
      {
        id: dependencies.ids.nextEventId(),
        sequence: nextEventSequence(state, events),
        fightId: state.id,
        causedByDecisionId: decision.id,
        type: "combatant-defeated",
        combatantId: target.id,
      },
      {
        id: dependencies.ids.nextEventId(),
        sequence: nextEventSequence(state, events),
        fightId: state.id,
        causedByDecisionId: decision.id,
        type: "fight-ended",
        completion: { type: "defeat", winnerCombatantId: attacker.id },
      },
    );
  } else {
    events.push(
      createPhaseChangedEvent(
        state,
        dependencies,
        "end",
        nextEventSequence(state, events),
        decision.id,
      ),
    );
  }
};

const createDeathBeamState = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  events: readonly CombatEvent[],
  context: DeathBeamResolutionContext,
): FightState => {
  const { activatedEffect, attacker, remainingEffects, resolution, target } = context;
  const combatants: ActiveFightState["combatants"] = {
    ...state.combatants,
    [attacker.id]: {
      ...attacker,
      ki: { ...attacker.ki, current: attacker.ki.current - context.cost },
      moveUses: {
        ...attacker.moveUses,
        [deathBeam!.id]: (attacker.moveUses[deathBeam!.id] ?? 0) + 1,
      },
    },
    ...(resolution.outcome === "successful"
      ? {
          [target.id]: {
            ...target,
            hitPoints: { ...target.hitPoints, current: resolution.remainingHitPoints },
            status: resolution.defeated ? ("defeated" as const) : target.status,
          },
        }
      : {}),
  };

  return resolution.defeated
    ? {
        id: state.id,
        version: state.version + 1,
        rulesVersion: state.rulesVersion,
        mode: state.mode,
        turnNumber: state.turnNumber,
        combatants,
        activeEffects: [],
        actionHistory: [
          ...state.actionHistory,
          actionRecordWithAttackResult(state, decision, {
            outcome: resolution.outcome,
            critical: resolution.critical,
            counter: resolution.counter,
            damageDealt: Math.max(0, target.hitPoints.current - resolution.remainingHitPoints),
            attackRollResult: resolution.attackResult,
            defenseRollResult: resolution.defenseResult,
          }),
        ],
        resolutionFrames: [],
        eventSequence: state.eventSequence + events.length,
        status: "completed",
        completion: { type: "defeat", winnerCombatantId: attacker.id },
      }
    : {
        ...state,
        version: state.version + 1,
        phase: "end",
        combatants,
        activeEffects:
          activatedEffect === undefined ? remainingEffects : [...remainingEffects, activatedEffect],
        actionHistory: [
          ...state.actionHistory,
          actionRecordWithAttackResult(state, decision, {
            outcome: resolution.outcome,
            critical: resolution.critical,
            counter: resolution.counter,
            damageDealt: Math.max(0, target.hitPoints.current - resolution.remainingHitPoints),
            attackRollResult: resolution.attackResult,
            defenseRollResult: resolution.defenseResult,
          }),
        ],
        eventSequence: state.eventSequence + events.length,
      };
};

export const resolveDeathBeam = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> => {
  if (deathBeam === undefined) throw new Error("Converted Death Beam data is unavailable.");
  const attacker = state.combatants[decision.actorId];
  const target = activeOpponent(state, attacker.id, decision.targetCombatantId);
  if (target === undefined) {
    return {
      ok: false,
      error: { type: "invalid-target", targetCombatantId: decision.targetCombatantId },
    };
  }
  const baseCost = deathBeam.mechanics.kiCost;
  const attack = deathBeam.mechanics.attack;
  if (
    baseCost?.type !== "literal" ||
    attack?.baseDamagePercent?.type !== "literal" ||
    attack.attackRoll?.dice !== 1
  ) {
    throw new Error("Converted Death Beam data no longer matches the supported effect slice.");
  }
  const matchingEffects = activeCostModifiersFor(state, attacker.id, deathBeam, baseCost.value);
  const cost = calculateKiCost(
    baseCost.value,
    matchingEffects.map((effect) => effect.amount),
  );
  if (attacker.ki.current < cost) {
    return {
      ok: false,
      error: { type: "insufficient-ki", required: cost, available: attacker.ki.current },
    };
  }

  const baseDamage = Math.round((attacker.stats.power * attack.baseDamagePercent.value) / 100);
  const resolution = resolveAttack({
    attacker,
    target,
    dependencies,
    attackSides:
      attack.attackRoll.sides +
      activeRollModifier(state, attacker.id, "attack", "sides", deathBeam),
    defenseSides:
      GLOBAL_RULES.combat.standardDieSides +
      activeRollModifier(state, target.id, "defense", "sides", deathBeam),
    baseDamage: applyActiveDamageModifiers(
      state,
      attacker.id,
      applyActiveConstantDamageModifiers(state, attacker.id, target.id, baseDamage, deathBeam),
      deathBeam,
    ),
    attackResultModifier: activeRollModifier(state, attacker.id, "attack", "result", deathBeam),
    defenseResultModifier: activeRollModifier(state, target.id, "defense", "result", deathBeam),
    resolutionThresholds: activeResolutionThresholds(state, attacker.id, target.id, deathBeam),
  });
  const matchingEffectIds = new Set(matchingEffects.map((effect) => effect.id));
  const remainingEffects = effectsAfterAttackResolution(state, {
    attackerId: attacker.id,
    defenderId: target.id,
    turnNumber: state.turnNumber,
    outcome: resolution.outcome,
    rolls: [resolution],
    move: deathBeam,
  }).filter((effect) => !matchingEffectIds.has(effect.id));
  const activatedEffect =
    resolution.outcome === "successful" && !resolution.defeated
      ? {
          id: dependencies.ids.nextActiveEffectId(),
          type: "modify-ki-cost" as const,
          sourceCombatantId: attacker.id,
          targetCombatantId: target.id,
          sourceDefinitionId: deathBeam.id,
          amount: 1,
          selector: { category: "advanced-attack" as const, baseKiCost: 1 },
          scope: "next-eligible-action" as const,
        }
      : undefined;
  const events: CombatEvent[] = [];
  const context: DeathBeamResolutionContext = {
    attacker,
    target,
    matchingEffects,
    cost,
    resolution,
    remainingEffects,
    counterContinues: false,
    counterChainLimitReached: false,
    ...(activatedEffect === undefined ? {} : { activatedEffect }),
  };
  appendDeathBeamActionEvents(state, decision, dependencies, events, context);
  appendDeathBeamOutcomeEvents(state, decision, dependencies, events, context);
  const nextState = createDeathBeamState(state, decision, events, context);
  return transitionFrom(nextState, events);
};

interface ConvertedAttackMoveContext {
  readonly activatedEffects: readonly ActiveCombatEffect[];
  readonly attacker: ActiveFightState["combatants"][CombatantId];
  readonly blockUsage?: BlockUsage;
  readonly cost: number;
  readonly counterChainLimitReached: boolean;
  readonly counterContinues: boolean;
  readonly defeated: boolean;
  readonly move: MoveDefinition;
  readonly includeRollEvents?: boolean;
  readonly remainingHitPoints: number;
  readonly resourceChanges: ReturnType<typeof successfulMoveEffects>["resources"];
  readonly roll: ReturnType<typeof resolveMoveAttack>;
  readonly statusApplications: ReturnType<typeof successfulMoveEffects>["statuses"];
  readonly target: ActiveFightState["combatants"][CombatantId];
  readonly defenseItemUse?: DefenseItemUse;
  readonly deactivations: readonly DeactivationApplication[];
  readonly activations: readonly ActivationApplication[];
  readonly moveUsePreventions: readonly MoveUsePreventionApplication[];
  readonly remainingUseModifications: readonly RemainingUseModificationApplication[];
  readonly statusPreventions: readonly StatusPreventionApplication[];
}

interface BlockUsage {
  readonly block: MoveDefinition;
  readonly cost: number;
  readonly defender: ActiveFightState["combatants"][CombatantId];
  readonly effects?: ReturnType<typeof resolvedBlockEffects>;
  readonly response: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>;
}

const appendConvertedAttackRollEvents = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  dependencies: CombatDependencies,
  context: ConvertedAttackMoveContext,
  events: CombatEvent[],
) => {
  for (const die of context.roll.rolls) {
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: nextEventSequence(state, events),
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "attack-rolled",
      combatantId: context.attacker.id,
      targetCombatantId: context.target.id,
      moveId: context.move.id,
      naturalResult: die.attackNaturalResult,
      result: die.attackResult,
    });
    if (die.defenseNaturalResult !== undefined && die.defenseResult !== undefined) {
      events.push({
        id: dependencies.ids.nextEventId(),
        sequence: nextEventSequence(state, events),
        fightId: state.id,
        causedByDecisionId: decision.id,
        type: "defense-rolled",
        combatantId: context.target.id,
        sourceCombatantId: context.attacker.id,
        naturalResult: die.defenseNaturalResult,
        result: die.defenseResult,
      });
    }
  }
};

const appendConvertedBlockUseEvents = (
  state: ActiveFightState,
  dependencies: CombatDependencies,
  context: ConvertedAttackMoveContext,
  events: CombatEvent[],
) => {
  if (context.blockUsage === undefined) return;
  const { attacker } = context;
  const { block, cost, defender, response } = context.blockUsage;
  events.push(
    {
      id: dependencies.ids.nextEventId(),
      sequence: nextEventSequence(state, events),
      fightId: state.id,
      causedByDecisionId: response.id,
      type: "move-used",
      combatantId: defender.id,
      moveId: block.id,
      targetCombatantId: attacker.id,
    },
    {
      id: dependencies.ids.nextEventId(),
      sequence: nextEventSequence(state, events),
      fightId: state.id,
      causedByDecisionId: response.id,
      type: "ki-changed",
      combatantId: defender.id,
      amount: -cost,
      remainingKi: defender.ki.current - cost,
    },
  );
};

const appendConvertedAttackOutcomeEvents = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  dependencies: CombatDependencies,
  context: ConvertedAttackMoveContext,
  events: CombatEvent[],
) => {
  const { attacker, move, roll, target } = context;
  events.push({
    id: dependencies.ids.nextEventId(),
    sequence: nextEventSequence(state, events),
    fightId: state.id,
    causedByDecisionId: decision.id,
    type: "attack-resolved",
    combatantId: attacker.id,
    targetCombatantId: target.id,
    moveId: move.id,
    outcome: roll.successfulHitCount > 0 ? "successful" : "stopped",
    critical: roll.critical,
    counter: roll.counter,
  });
  if (roll.damage > 0)
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: nextEventSequence(state, events),
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "damage-applied",
      sourceCombatantId: attacker.id,
      targetCombatantId: target.id,
      amount: roll.damage,
      remainingHitPoints: context.remainingHitPoints,
    });
  if (context.defeated) {
    events.push(
      {
        id: dependencies.ids.nextEventId(),
        sequence: nextEventSequence(state, events),
        fightId: state.id,
        causedByDecisionId: decision.id,
        type: "combatant-defeated",
        combatantId: target.id,
      },
      {
        id: dependencies.ids.nextEventId(),
        sequence: nextEventSequence(state, events),
        fightId: state.id,
        causedByDecisionId: decision.id,
        type: "fight-ended",
        completion: { type: "defeat", winnerCombatantId: attacker.id },
      },
    );
    return;
  }
  if (context.counterChainLimitReached)
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: nextEventSequence(state, events),
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "counter-chain-limit-reached",
      counterAttackCount:
        GLOBAL_RULES.combat.engineeringSafeguards.maximumConsecutiveCounterAttacks,
    });
  events.push(
    createPhaseChangedEvent(
      state,
      dependencies,
      context.counterContinues ? "counter" : "end",
      nextEventSequence(state, events),
      decision.id,
    ),
  );
};

const appendRemainingUseModificationEvents = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  dependencies: CombatDependencies,
  context: ConvertedAttackMoveContext,
  events: CombatEvent[],
) => {
  for (const application of context.remainingUseModifications) {
    const target = application.target === "self" ? context.attacker : context.target;
    for (const moveId of target.moveIds) {
      const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === moveId);
      const limit =
        move === undefined ? undefined : effectiveRestrictedMoveUseLimit(state, target, move);
      if (
        move === undefined ||
        limit === undefined ||
        !matchesMoveSelector(move, application.selector)
      )
        continue;
      events.push({
        id: dependencies.ids.nextEventId(),
        sequence: nextEventSequence(state, events),
        fightId: state.id,
        causedByDecisionId: decision.id,
        type: "move-use-limit-changed",
        sourceCombatantId: application.sourceCombatantId,
        targetCombatantId: target.id,
        sourceDefinitionId: application.sourceDefinitionId,
        moveId: move.id,
        amount: application.amount,
        newUseLimit: limit + application.amount,
      });
    }
  }
};

const createConvertedAttackMoveEvents = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  dependencies: CombatDependencies,
  context: ConvertedAttackMoveContext,
): CombatEvent[] => {
  const { attacker, cost, move, target } = context;
  const events: CombatEvent[] = [
    {
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + 1,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "move-used",
      combatantId: attacker.id,
      moveId: move.id,
      targetCombatantId: target.id,
    },
    {
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + 2,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "ki-changed",
      combatantId: attacker.id,
      amount: -cost,
      remainingKi: attacker.ki.current - cost,
    },
  ];
  const baseKiCost = move.mechanics.kiCost;
  if (baseKiCost?.type === "literal") {
    for (const effect of activeCostModifiersFor(state, attacker.id, move, baseKiCost.value)) {
      events.push({
        id: dependencies.ids.nextEventId(),
        sequence: nextEventSequence(state, events),
        fightId: state.id,
        causedByDecisionId: decision.id,
        type: "effect-expired",
        activeEffectId: effect.id,
        targetCombatantId: attacker.id,
      });
    }
  }
  appendConvertedBlockUseEvents(state, dependencies, context, events);
  if (context.defenseItemUse !== undefined) {
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: nextEventSequence(state, events),
      fightId: state.id,
      causedByDecisionId: context.defenseItemUse.response.id,
      type: "item-used",
      combatantId: target.id,
      itemId: context.defenseItemUse.item.id,
    });
    if (context.defenseItemUse.kiCost !== 0) {
      events.push({
        id: dependencies.ids.nextEventId(),
        sequence: nextEventSequence(state, events),
        fightId: state.id,
        causedByDecisionId: context.defenseItemUse.response.id,
        type: "ki-changed",
        combatantId: target.id,
        amount: -context.defenseItemUse.kiCost,
        remainingKi: target.ki.current - context.defenseItemUse.kiCost,
      });
    }
  }
  if (context.includeRollEvents !== false) {
    appendConvertedAttackRollEvents(state, decision, dependencies, context, events);
  }
  appendConvertedResourceAndStatusEvents(state, decision, dependencies, context, events);
  appendRemainingUseModificationEvents(state, decision, dependencies, context, events);
  appendConvertedAttackOutcomeEvents(state, decision, dependencies, context, events);
  if (!context.defeated) {
    for (const effect of context.activatedEffects) {
      events.push({
        id: dependencies.ids.nextEventId(),
        sequence: nextEventSequence(state, events),
        fightId: state.id,
        causedByDecisionId: decision.id,
        type: "effect-activated",
        activeEffectId: effect.id,
        sourceCombatantId: effect.sourceCombatantId,
        targetCombatantId: effect.targetCombatantId,
        sourceDefinitionId: effect.sourceDefinitionId,
      });
    }
  }
  return events;
};

const appendConvertedResourceAndStatusEvents = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  dependencies: CombatDependencies,
  context: ConvertedAttackMoveContext,
  events: CombatEvent[],
) => {
  const { attacker, cost, target } = context;
  const attackerAfterResources = resourceAfterChanges(
    { ...attacker, ki: { ...attacker.ki, current: attacker.ki.current - cost } },
    context.resourceChanges,
    "self",
    state.activeEffects,
    decision.type === "use-move" ? actionRecordFor(state, decision) : undefined,
  );
  const targetAfterResources = resourceAfterChanges(
    {
      ...target,
      ki: {
        ...target.ki,
        current: target.ki.current - (context.defenseItemUse?.kiCost ?? 0),
      },
    },
    context.resourceChanges,
    "opponent",
    state.activeEffects,
    decision.type === "use-move" ? actionRecordFor(state, decision) : undefined,
  );
  const attackerEffectKiChange = attackerAfterResources.ki.current - (attacker.ki.current - cost);
  const targetEffectKiChange =
    targetAfterResources.ki.current - (target.ki.current - (context.defenseItemUse?.kiCost ?? 0));
  if (attackerEffectKiChange !== 0) {
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: nextEventSequence(state, events),
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "ki-changed",
      combatantId: attacker.id,
      amount: attackerEffectKiChange,
      remainingKi: attackerAfterResources.ki.current,
    });
  }
  if (targetEffectKiChange !== 0) {
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: nextEventSequence(state, events),
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "ki-changed",
      combatantId: target.id,
      amount: targetEffectKiChange,
      remainingKi: targetAfterResources.ki.current,
    });
  }
  for (const application of context.statusApplications) {
    const targetCombatantId = application.target === "self" ? attacker.id : target.id;
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: nextEventSequence(state, events),
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "status-applied",
      sourceCombatantId: attacker.id,
      targetCombatantId,
      statusId: application.status.statusId,
      stacks: application.status.stacks,
    });
  }
};

const resourceChangeIsPrevented = (
  combatant: ActiveFightState["combatants"][CombatantId],
  change: ResourceChange,
  resourcePreventions: readonly ActiveCombatEffect[],
  action: CombatActionRecord | undefined,
) =>
  resourcePreventions.some(
    (
      effect,
    ): effect is Extract<ActiveCombatEffect, { readonly type: "prevent-resource-modification" }> =>
      effect.type === "prevent-resource-modification" &&
      effect.targetCombatantId === combatant.id &&
      effect.resource === change.resource &&
      (effect.operation === "lose"
        ? change.operation === "lose" || change.operation === "drain"
        : effect.operation === change.operation) &&
      (effect.sourceActor !== "opponent" ||
        (change.sourceCombatantId !== undefined && change.sourceCombatantId !== combatant.id)) &&
      (effect.exceptAction !== "power-up" || action?.type !== "power-up"),
  );

const resourceChangesAfterPreventions = (
  actor: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  changes: readonly ResourceChange[],
  resourcePreventions: readonly ActiveCombatEffect[],
  action: CombatActionRecord | undefined,
) =>
  changes.filter((change) => {
    const subject = change.target === "self" ? actor : target;
    return !resourceChangeIsPrevented(subject, change, resourcePreventions, action);
  });

const resourceAfterChanges = (
  combatant: ActiveFightState["combatants"][CombatantId],
  changes: readonly ResourceChange[],
  target: "self" | "opponent",
  resourcePreventions: readonly ActiveCombatEffect[] = [],
  action?: CombatActionRecord,
) => {
  const relevant = changes.filter(
    (change) =>
      change.target === target &&
      !resourceChangeIsPrevented(combatant, change, resourcePreventions, action),
  );
  const nextResourceValue = (value: number, change: (typeof relevant)[number]) => {
    let nextValue = value - change.amount;
    if (change.operation === "set") nextValue = change.amount;
    else if (change.operation === "gain") nextValue = value + change.amount;
    if (change.cap === undefined) return nextValue;
    if (change.cap.type === "maximum") return Math.min(nextValue, change.cap.value);
    return Math.max(nextValue, change.cap.value);
  };
  const apply = (current: number, maximum: number, resource: "hp" | "ki") =>
    relevant
      .filter((change) => change.resource === resource)
      .reduce(
        (value, change) => Math.min(maximum, Math.max(0, nextResourceValue(value, change))),
        current,
      );
  return {
    ...combatant,
    hitPoints: {
      ...combatant.hitPoints,
      current: apply(combatant.hitPoints.current, combatant.hitPoints.maximum, "hp"),
    },
    ki: { ...combatant.ki, current: apply(combatant.ki.current, combatant.ki.maximum, "ki") },
  };
};

const statusesAfterApplications = (
  combatant: ActiveFightState["combatants"][CombatantId],
  applications: readonly StatusApplication[],
  target: "self" | "opponent",
) => {
  const activeStatuses = [...combatant.activeStatuses];
  for (const application of applications.filter((candidate) => candidate.target === target)) {
    const status = application.status;
    const existingIndex = activeStatuses.findIndex(
      (activeStatus) => activeStatus.statusId === status.statusId,
    );
    if (existingIndex === -1) {
      activeStatuses.push(status);
      continue;
    }
    const existing = activeStatuses[existingIndex];
    let duration = existing.duration;
    if (existing.duration.type === "turns" && status.duration.type === "turns") {
      duration = {
        ...existing.duration,
        remaining: Math.max(existing.duration.remaining, status.duration.remaining),
      };
    }
    activeStatuses[existingIndex] = {
      ...existing,
      stacks: existing.stacks + status.stacks,
      duration,
    };
  }
  return { ...combatant, activeStatuses };
};

const combatantAfterRemainingUseModifications = (
  combatant: ActiveFightState["combatants"][CombatantId],
  applications: readonly RemainingUseModificationApplication[],
  target: "self" | "opponent",
) => {
  const modifiers = { ...combatant.moveUseLimitModifiers };
  for (const application of applications) {
    if (application.target !== target) continue;
    for (const moveId of combatant.moveIds) {
      const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === moveId);
      if (
        move?.mechanics.restrictedUses?.type !== "literal" ||
        !matchesMoveSelector(move, application.selector)
      )
        continue;
      modifiers[move.id] = (modifiers[move.id] ?? 0) + application.amount;
    }
  }
  return { ...combatant, moveUseLimitModifiers: modifiers };
};

const targetAfterBlockUse = (
  target: ActiveFightState["combatants"][CombatantId],
  blockUsage: BlockUsage | undefined,
) =>
  blockUsage === undefined
    ? target
    : {
        ...target,
        ki: { ...target.ki, current: target.ki.current - blockUsage.cost },
        moveUses: {
          ...target.moveUses,
          [blockUsage.block.id]: (target.moveUses[blockUsage.block.id] ?? 0) + 1,
        },
      };

const targetAfterDefenseItemUse = (
  target: ActiveFightState["combatants"][CombatantId],
  defenseItemUse: DefenseItemUse | undefined,
) =>
  defenseItemUse === undefined
    ? target
    : {
        ...target,
        ki: { ...target.ki, current: target.ki.current - defenseItemUse.kiCost },
        itemUses: {
          ...target.itemUses,
          [defenseItemUse.item.id]: (target.itemUses?.[defenseItemUse.item.id] ?? 0) + 1,
        },
      };

const convertedAttackActionHistory = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  context: ConvertedAttackMoveContext,
) => [
  ...state.actionHistory,
  actionRecordWithAttackResult(state, decision, {
    outcome: context.roll.successfulHitCount > 0 ? "successful" : "stopped",
    critical: context.roll.critical,
    counter: context.roll.counter,
    damageDealt: Math.max(0, context.target.hitPoints.current - context.remainingHitPoints),
    ...(context.roll.rolls.length === 1
      ? {
          attackRollResult: context.roll.rolls[0].attackResult,
          defenseRollResult: context.roll.rolls[0].defenseResult,
        }
      : {}),
  }),
  ...(context.blockUsage === undefined
    ? []
    : [
        {
          type: "use-move" as const,
          decisionId: context.blockUsage.response.id,
          actorId: context.blockUsage.defender.id,
          targetCombatantId: context.attacker.id,
          moveId: context.blockUsage.block.id,
          turnNumber: state.turnNumber,
          phase: state.phase === "counter" ? ("counter" as const) : ("action" as const),
        },
      ]),
  ...(context.defenseItemUse === undefined
    ? []
    : [
        {
          type: "use-item" as const,
          decisionId: context.defenseItemUse.response.id,
          actorId: context.target.id,
          itemId: context.defenseItemUse.item.id,
          turnNumber: state.turnNumber,
          phase: state.phase === "counter" ? ("counter" as const) : ("action" as const),
        },
      ]),
];

const convertedAttackStateParts = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  context: ConvertedAttackMoveContext,
) => {
  const {
    attacker,
    blockUsage,
    cost,
    defeated,
    defenseItemUse,
    move,
    remainingHitPoints,
    roll,
    target,
  } = context;
  const targetAfterDamage =
    roll.damage > 0
      ? {
          ...target,
          hitPoints: { ...target.hitPoints, current: remainingHitPoints },
          status: defeated ? ("defeated" as const) : target.status,
        }
      : target;
  const attackerAfterEffects = statusesAfterApplications(
    resourceAfterChanges(
      {
        ...attacker,
        ki: { ...attacker.ki, current: attacker.ki.current - cost },
        moveUses: { ...attacker.moveUses, [move.id]: (attacker.moveUses[move.id] ?? 0) + 1 },
      },
      context.resourceChanges,
      "self",
      state.activeEffects,
      actionRecordFor(state, decision),
    ),
    context.statusApplications,
    "self",
  );
  const targetAfterEffects = statusesAfterApplications(
    resourceAfterChanges(
      targetAfterDamage,
      context.resourceChanges,
      "opponent",
      state.activeEffects,
      actionRecordFor(state, decision),
    ),
    context.statusApplications,
    "opponent",
  );
  const attackerAfterBlockEffects =
    blockUsage?.effects === undefined
      ? attackerAfterEffects
      : statusesAfterApplications(
          resourceAfterChanges(
            attackerAfterEffects,
            blockUsage.effects.resources,
            "opponent",
            state.activeEffects,
            actionRecordFor(state, decision),
          ),
          blockUsage.effects.statuses,
          "opponent",
        );
  const targetAfterBlockEffects =
    blockUsage?.effects === undefined
      ? targetAfterEffects
      : statusesAfterApplications(
          resourceAfterChanges(
            targetAfterEffects,
            blockUsage.effects.resources,
            "self",
            state.activeEffects,
            actionRecordFor(state, decision),
          ),
          blockUsage.effects.statuses,
          "self",
        );
  const targetAfterBlock = targetAfterBlockUse(targetAfterBlockEffects, blockUsage);
  const targetAfterDefenseItem = targetAfterDefenseItemUse(targetAfterBlock, defenseItemUse);
  const targetAfterUseLimits = combatantAfterRemainingUseModifications(
    targetAfterDefenseItem,
    context.remainingUseModifications,
    "opponent",
  );
  const attackerAfterUseLimits = combatantAfterRemainingUseModifications(
    attackerAfterBlockEffects,
    context.remainingUseModifications,
    "self",
  );
  const normalizedTarget =
    targetAfterUseLimits.hitPoints.current === 0
      ? { ...targetAfterUseLimits, status: "defeated" as const }
      : targetAfterUseLimits;
  const normalizedAttacker =
    attackerAfterUseLimits.hitPoints.current === 0
      ? { ...attackerAfterUseLimits, status: "defeated" as const }
      : attackerAfterUseLimits;
  const combatants: ActiveFightState["combatants"] = {
    ...state.combatants,
    [attacker.id]: normalizedAttacker,
    [target.id]: normalizedTarget,
  };
  const actionHistory = convertedAttackActionHistory(state, decision, context);
  return { actionHistory, combatants };
};

const createConvertedAttackMoveState = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  dependencies: CombatDependencies,
  context: ConvertedAttackMoveContext,
  eventCount: number,
): FightState => {
  const { attacker, defeated, target } = context;
  const { actionHistory, combatants } = convertedAttackStateParts(state, decision, context);
  const attackerDefeated = combatants[attacker.id].status === "defeated";
  const targetDefeated = combatants[target.id].status === "defeated";
  if (defeated || attackerDefeated || targetDefeated)
    return {
      id: state.id,
      version: state.version + 1,
      rulesVersion: state.rulesVersion,
      mode: state.mode,
      turnNumber: state.turnNumber,
      combatants,
      activeEffects: [],
      actionHistory,
      resolutionFrames: [],
      eventSequence: state.eventSequence + eventCount,
      status: "completed",
      completion: {
        type: "defeat",
        winnerCombatantId: attackerDefeated ? target.id : attacker.id,
      },
    };
  const nextActiveCombatant =
    context.counterContinues || state.phase === "counter" ? target.id : state.activeCombatantId;
  const consumedExtraActionEffects = consumeExtraActionForDecision(state, decision);
  const activeEffectsBeforeConsumption = [
    ...effectsAfterAttackResolution(state, {
      attackerId: attacker.id,
      defenderId: target.id,
      turnNumber: state.turnNumber,
      outcome: context.roll.successfulHitCount > 0 ? "successful" : "stopped",
      rolls: context.roll.rolls,
      move: context.move,
    }),
    ...context.activatedEffects,
  ];
  const activeEffects = activeEffectsBeforeConsumption.flatMap((effect) => {
    if (effect.type !== "extra-action") return [effect];
    if (!state.activeEffects.some((candidate) => candidate.id === effect.id)) return [effect];
    const consumed = consumedExtraActionEffects.find((candidate) => candidate.id === effect.id);
    return consumed === undefined ? [] : [consumed];
  });
  const continueWithExtraAction =
    state.phase === "action" &&
    !context.counterContinues &&
    hasAvailableExtraAction({ ...state, activeEffects }, attacker.id);
  let nextPhase: "counter" | "action" | "end";
  if (context.counterContinues) nextPhase = "counter";
  else if (continueWithExtraAction) nextPhase = "action";
  else nextPhase = "end";
  return {
    ...state,
    version: state.version + 1,
    phase: nextPhase,
    activeCombatantId: continueWithExtraAction ? attacker.id : nextActiveCombatant,
    combatants,
    activeEffects,
    actionHistory,
    resolutionFrames: context.counterContinues
      ? [
          {
            id: dependencies.ids.nextResolutionFrameId(),
            type: "attack",
            decisionId: decision.id,
            attackerId: attacker.id,
            targetCombatantId: target.id,
            returnPhase: state.phase === "counter" ? "counter" : "action",
            stage: "awaiting-counter",
          },
        ]
      : [],
    eventSequence: state.eventSequence + eventCount,
  };
};

const convertedAttackMoveFailure = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  move: MoveDefinition,
  attacker: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId] | undefined,
  additionalCurrentActionCostModifications: readonly CurrentActionCostModification[] = [],
): CombatFailure | undefined => {
  const attack = move.mechanics.attack;
  const cost = move.mechanics.kiCost;
  if (target === undefined)
    return { type: "invalid-target", targetCombatantId: decision.targetCombatantId };
  if (attack?.baseDamagePercent === undefined || cost === undefined)
    return { type: "unsupported-mechanic", mechanic: `source expression: ${move.id}` };
  if (move.category === "signature" && !isSignatureTurnAvailable(state.turnNumber))
    return { type: "illegal-decision", decisionType: decision.type };
  const restrictedLimit = effectiveRestrictedMoveUseLimit(state, attacker, move);
  if (!isRestrictedUseAvailable(attacker.moveUses[move.id] ?? 0, restrictedLimit))
    return { type: "restricted-use-exhausted", moveId: move.id };
  const baseCost = evaluateDurableNumericExpression(cost, {
    self: attacker,
    opponent: target,
    turnNumber: state.turnNumber,
    participantCount: 2,
    completedTurnCount: state.turnNumber - 1,
    moves: new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate])),
    moveActivationCounts: moveActivationCounts(state),
  });
  if (baseCost === undefined)
    return { type: "unsupported-mechanic", mechanic: `phase-local source expression: ${move.id}` };
  const effectiveCost = convertedAttackCost(
    state,
    attacker,
    move,
    baseCost,
    additionalCurrentActionCostModifications,
  );
  return attacker.ki.current < effectiveCost
    ? { type: "insufficient-ki", required: effectiveCost, available: attacker.ki.current }
    : undefined;
};

interface CostModificationPreventionSource {
  readonly application: {
    readonly target: "self" | "opponent";
    readonly actor: MoveModificationPreventionApplication["actor"];
    readonly selector: MoveModificationPreventionApplication["selector"];
    readonly aspects: MoveModificationPreventionApplication["aspects"];
    readonly effectSourceStyleExcludes?: string;
    readonly exceptSourceMoveIds?: readonly string[];
    readonly exceptSourceStatusIds?: readonly ActiveStatus["statusId"][];
    readonly operations?: readonly "reduce"[];
  };
  readonly sourceCombatantId: CombatantId;
  readonly sourceDefinitionId: string;
  readonly targetCombatantId: CombatantId;
}

const costModificationPreventedBy = (
  prevention: CostModificationPreventionSource,
  modifier: ActiveCostModifierEffect,
  move: MoveDefinition,
) => {
  const { application } = prevention;
  if (
    prevention.targetCombatantId !== modifier.targetCombatantId ||
    !application.aspects.includes("cost") ||
    !selectorMatchesMove(application.selector, move) ||
    !moveModificationActorMatches(
      application.actor,
      modifier.sourceCombatantId,
      prevention.sourceCombatantId,
    )
  )
    return false;
  if (application.exceptSourceMoveIds?.includes(modifier.sourceDefinitionId)) return false;
  if (application.effectSourceStyleExcludes !== undefined) {
    const sourceMove = MOVE_DEFINITIONS.find(
      (candidate) => candidate.id === modifier.sourceDefinitionId,
    );
    if (sourceMove?.styleId === application.effectSourceStyleExcludes) return false;
  }
  return application.operations?.includes("reduce") !== true || modifier.amount < 0;
};

const passiveCostPreventionSources = (
  state: ActiveFightState,
  combatantId: CombatantId,
  move: MoveDefinition,
): readonly CostModificationPreventionSource[] => {
  const self = state.combatants[combatantId];
  const opponent = Object.values(state.combatants).find(
    (candidate) => candidate.id !== combatantId && candidate.status === "active",
  );
  if (opponent === undefined) return [];
  const moves = new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate]));
  const context = {
    self,
    opponent,
    turnNumber: state.turnNumber,
    completedTurnCount: state.turnNumber - 1,
    moves,
    moveActivationCounts: moveActivationCounts(state),
    successfulHitCount: 0,
    mode: state.mode,
    triggeringMove: move,
  };
  const sources: CostModificationPreventionSource[] = [];
  const add = (
    sourceCombatantId: CombatantId,
    sourceDefinitionId: string,
    sourceMove: MoveDefinition,
  ) => {
    const effects = moveEffectsForTrigger(sourceMove, "passive", context);
    for (const application of effects.moveModificationPreventions) {
      let targetCombatantId: CombatantId;
      if (application.target === "self") targetCombatantId = sourceCombatantId;
      else targetCombatantId = sourceCombatantId === self.id ? opponent.id : self.id;
      sources.push({ application, sourceCombatantId, sourceDefinitionId, targetCombatantId });
    }
  };
  add(self.id, move.id, move);
  for (const effect of state.activeEffects) {
    if (
      effect.type !== "active-constant" ||
      effect.lifecycle === "deactivated" ||
      effect.sourceCombatantId !== combatantId
    )
      continue;
    const sourceMove = moves.get(effect.sourceDefinitionId);
    if (sourceMove !== undefined)
      add(effect.sourceCombatantId, effect.sourceDefinitionId, sourceMove);
  }
  return sources;
};

const activeCostPreventionSources = (
  state: ActiveFightState,
): readonly CostModificationPreventionSource[] =>
  state.activeEffects.flatMap((effect) =>
    effect.type === "prevent-move-modification" && !activeEffectSuppressed(state, effect)
      ? [
          {
            application: {
              target:
                effect.targetCombatantId === effect.sourceCombatantId
                  ? ("self" as const)
                  : ("opponent" as const),
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
            },
            sourceCombatantId: effect.sourceCombatantId,
            sourceDefinitionId: effect.sourceDefinitionId,
            targetCombatantId: effect.targetCombatantId,
          },
        ]
      : [],
  );

const activeCostModifiersFor = (
  state: ActiveFightState,
  combatantId: CombatantId,
  move: MoveDefinition,
  baseKiCost: number,
) => {
  const preventions = [
    ...passiveCostPreventionSources(state, combatantId, move),
    ...activeCostPreventionSources(state),
  ];
  return state.activeEffects
    .filter(
      (effect): effect is ActiveCostModifierEffect =>
        effect.type === "modify-ki-cost" &&
        !activeEffectSuppressed(state, effect) &&
        effect.targetCombatantId === combatantId &&
        effect.selector.baseKiCost === baseKiCost &&
        effect.selector.category === move.category,
    )
    .filter(
      (modifier) =>
        !preventions.some((prevention) => costModificationPreventedBy(prevention, modifier, move)),
    );
};

const currentActionCostModifiersFor = (
  state: ActiveFightState,
  combatantId: CombatantId,
  move: MoveDefinition,
): readonly CurrentActionCostModification[] => {
  const opponent = Object.values(state.combatants).find(
    (candidate) => candidate.id !== combatantId && candidate.status === "active",
  );
  if (opponent === undefined) return [];
  const moves = new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate]));
  const sources = new Map<
    string,
    { readonly source: CombatantId; readonly move: MoveDefinition }
  >();
  const addSource = (source: CombatantId, sourceMove: MoveDefinition) => {
    sources.set(`${source}:${sourceMove.id}`, { source, move: sourceMove });
  };
  addSource(combatantId, move);
  for (const effect of state.activeEffects) {
    if (
      effect.type !== "active-constant" ||
      effect.lifecycle === "deactivated" ||
      activeEffectSuppressed(state, effect) ||
      !moves.has(effect.sourceDefinitionId)
    )
      continue;
    addSource(effect.sourceCombatantId, moves.get(effect.sourceDefinitionId)!);
  }
  const preventions = [
    ...passiveCostPreventionSources(state, combatantId, move),
    ...activeCostPreventionSources(state),
  ];
  return [...sources.values()].flatMap(({ source, move: sourceMove }) => {
    const sourceState = state.combatants[source];
    const targetState = source === combatantId ? opponent : state.combatants[combatantId];
    const effectContext = {
      self: sourceState,
      opponent: targetState,
      turnNumber: state.turnNumber,
      completedTurnCount: state.turnNumber - 1,
      moves,
      moveActivationCounts: moveActivationCounts(state),
      successfulHitCount: 0,
      actionHistory: state.actionHistory,
      activeEffects: state.activeEffects,
      mode: state.mode,
      triggeringMove: move,
    };
    const effects = mergeMoveEffects(
      moveEffectsForTrigger(sourceMove, "passive", effectContext),
      moveEffectsForTrigger(sourceMove, "on-move-use", effectContext),
    );
    return effects.currentActionCostModifications.flatMap((modification) => {
      const targetCombatantId = modification.target === "self" ? source : combatantId;
      if (
        targetCombatantId !== combatantId ||
        !effectMatchesMoveSelector(modification.selector, move)
      )
        return [];
      const candidate: ActiveCostModifierEffect = {
        id: "active-effect:immediate-cost" as never,
        type: "modify-ki-cost",
        sourceCombatantId: source,
        targetCombatantId,
        sourceDefinitionId: sourceMove.id,
        amount: modification.amount,
        selector: {
          category: "advanced-attack",
          baseKiCost: move.mechanics.kiCost?.type === "literal" ? move.mechanics.kiCost.value : 0,
        },
        scope: "next-eligible-action",
      };
      return preventions.some((prevention) =>
        costModificationPreventedBy(prevention, candidate, move),
      )
        ? []
        : [modification];
    });
  });
};

const applyCurrentActionCostModification = (
  cost: number,
  modification: CurrentActionCostModification,
) => {
  const modified =
    modification.operation === "set" ? modification.amount : cost + modification.amount;
  const minimum =
    modification.minimum === undefined ? modified : Math.max(modified, modification.minimum);
  return modification.maximum === undefined ? minimum : Math.min(minimum, modification.maximum);
};

const effectiveMoveCost = (
  state: ActiveFightState,
  combatantId: CombatantId,
  move: MoveDefinition,
  baseCost: number,
) => {
  const currentCost = currentActionCostModifiersFor(state, combatantId, move).reduce(
    applyCurrentActionCostModification,
    baseCost,
  );
  return calculateKiCost(
    currentCost,
    activeCostModifiersFor(state, combatantId, move, baseCost).map((effect) => effect.amount),
  );
};

type LiteralMoveAttack = NonNullable<MoveDefinition["mechanics"]["attack"]> & {
  readonly baseDamagePercent: { readonly type: "literal"; readonly value: number };
};

const resolvedLiteralAttack = (
  state: ActiveFightState,
  attacker: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  move: MoveDefinition,
) => {
  const attack = move.mechanics.attack;
  const cost = move.mechanics.kiCost;
  if (attack?.baseDamagePercent === undefined || cost === undefined) {
    throw new Error("Validated attack moves require combat damage and KI cost definitions.");
  }
  const context = {
    self: attacker,
    opponent: target,
    turnNumber: state.turnNumber,
    participantCount: 2,
    completedTurnCount: state.turnNumber - 1,
    moves: new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate])),
    moveActivationCounts: moveActivationCounts(state),
  };
  const baseDamagePercent = evaluateDurableNumericExpression(attack.baseDamagePercent, context);
  const baseKiCost = evaluateDurableNumericExpression(cost, context);
  if (baseDamagePercent === undefined || baseKiCost === undefined) {
    throw new Error(`Move ${move.id} has a phase-local numeric expression.`);
  }
  return {
    attack: {
      ...attack,
      baseDamagePercent: { type: "literal" as const, value: baseDamagePercent },
    } as LiteralMoveAttack,
    cost: { type: "literal" as const, value: baseKiCost },
  };
};

const hasAfterDefenseEffectChoicePotential = (move: MoveDefinition) =>
  (move.effects ?? []).some(
    (effect) =>
      effect.trigger === "after-defense-roll" &&
      (effect.optional === true || effect.activationGroup !== undefined),
  );

const shouldRequestMoveDefense = (
  state: ActiveFightState,
  target: ActiveFightState["combatants"][CombatantId],
  move: MoveDefinition,
  blockableAttack: BlockableAttack,
  requestDefense: boolean,
) =>
  requestDefense &&
  (legalBlockMoves(state, target.id, blockableAttack).length > 0 ||
    availablePreRollDefenseItems(target).length > 0 ||
    hasPostDefenseReaction(state, target.id, move) ||
    hasAfterDefenseEffectChoicePotential(move) ||
    hasEnergyRedirectionPotential(state, state.activeCombatantId, move) ||
    hasPostDefenseRerollPotential(state, state.activeCombatantId, "attack", move));

const moveActivationCounts = (state: ActiveFightState) => {
  const counts = new Map<string, number>();
  for (const action of state.actionHistory) {
    if (action.type === "use-move") counts.set(action.moveId, (counts.get(action.moveId) ?? 0) + 1);
  }
  return counts;
};

const passiveAfterDefenseEffects = (
  state: ActiveFightState,
  attacker: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  triggeringMove: MoveDefinition,
  context: Parameters<typeof moveEffectsForTrigger>[2],
) =>
  [
    ...attacker.moveIds.flatMap((moveId) => {
      const move = MOVE_DEFINITIONS.find(
        (candidate) => candidate.id === moveId && candidate.category === "mastery",
      );
      return move === undefined ? [] : [move];
    }),
    ...state.activeEffects.flatMap((effect) => {
      if (
        effect.type !== "active-constant" ||
        effect.lifecycle === "deactivated" ||
        effect.sourceCombatantId !== attacker.id
      ) {
        return [];
      }
      const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === effect.sourceDefinitionId);
      return move === undefined ? [] : [move];
    }),
  ].reduce(
    (changes, moveId) => {
      const passiveMastery = {
        ...moveId,
        effects: moveId.effects?.filter(
          (effect) =>
            effect.trigger === "after-defense-roll" && effect.activationCost === undefined,
        ),
      };
      const resolved = moveEffectsForTrigger(passiveMastery, "after-defense-roll", {
        ...context,
        self: attacker,
        opponent: target,
        triggeringMove,
        triggeringMoveOwner: "self",
      });
      return {
        resources: [...changes.resources, ...resolved.resources],
        statuses: [...changes.statuses, ...resolved.statuses],
        locks: [...changes.locks, ...resolved.locks],
      };
    },
    {
      resources: [] as ResourceChange[],
      statuses: [] as StatusApplication[],
      locks: [] as LockApplication[],
    },
  );

const defensiveOnDamageModifications = (
  state: ActiveFightState,
  attacker: ActiveFightState["combatants"][CombatantId],
  defender: ActiveFightState["combatants"][CombatantId],
  triggeringMove: MoveDefinition | undefined,
  context: Parameters<typeof moveEffectsForTrigger>[2],
  incomingDamage: number,
) => {
  const moves = new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate]));
  const sourceMoveIds = new Set<string>();
  for (const moveId of defender.moveIds) {
    const move = moves.get(moveId);
    if (move?.category === "mastery") sourceMoveIds.add(move.id);
  }
  for (const effect of state.activeEffects) {
    if (
      effect.type === "active-constant" &&
      effect.lifecycle !== "deactivated" &&
      !activeEffectSuppressed(state, effect) &&
      effect.sourceCombatantId === defender.id
    )
      sourceMoveIds.add(effect.sourceDefinitionId);
  }
  return [...sourceMoveIds].flatMap((sourceMoveId) => {
    const sourceMove = moves.get(sourceMoveId);
    if (sourceMove === undefined) return [];
    return moveEffectsForTrigger(sourceMove, "on-damage", {
      ...context,
      self: defender,
      opponent: attacker,
      ...(triggeringMove === undefined ? {} : { triggeringMove }),
      incomingDamage,
    }).damageModifications.filter(
      (modification) =>
        modification.target === "opponent" &&
        (modification.scope === undefined || modification.scope === "current-action"),
    );
  });
};

interface CompleteConvertedAttackInput {
  readonly state: ActiveFightState;
  readonly decision: Extract<CombatDecision, { readonly type: "use-move" }>;
  readonly move: MoveDefinition;
  readonly dependencies: CombatDependencies;
  readonly attacker: ActiveFightState["combatants"][CombatantId];
  readonly target: ActiveFightState["combatants"][CombatantId];
  readonly blockedDice?: number;
  readonly blockUsage?: BlockUsage;
  readonly defenseItemUse?: DefenseItemUse;
  readonly defenseResultModifier?: number;
  readonly includeRollEvents?: boolean;
  readonly naturalRolls?: readonly ContestedAttackNaturalRoll[];
  readonly resultOverrides?: readonly ResultOverride[];
  readonly numericResultOverrides?: readonly NumericResultOverride[];
  readonly enabledOptionalEffectIndices?: readonly number[];
  readonly resolvedOptionalEffectIndices?: readonly number[];
  readonly enabledAfterDefenseEffectIndices?: readonly number[];
  readonly selectedNumericValues?: Readonly<Record<string, number>>;
}

const convertedAttackCost = (
  state: ActiveFightState,
  attacker: ActiveFightState["combatants"][CombatantId],
  move: MoveDefinition,
  baseCost: number,
  additionalCurrentActionCostModifications: readonly CurrentActionCostModification[] = [],
) => {
  const currentCost = [
    ...currentActionCostModifiersFor(state, attacker.id, move),
    ...additionalCurrentActionCostModifications.filter(
      (modification) => modification.target === "self",
    ),
  ].reduce(applyCurrentActionCostModification, baseCost);
  return calculateKiCost(
    currentCost,
    activeCostModifiersFor(state, attacker.id, move, baseCost).map((effect) => effect.amount),
  );
};

const convertedAttackEffectContext = (
  state: ActiveFightState,
  attacker: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  triggeringMove?: MoveDefinition,
) => ({
  self: attacker,
  opponent: target,
  turnNumber: state.turnNumber,
  completedTurnCount: state.turnNumber - 1,
  actionHistory: state.actionHistory,
  activeEffects: state.activeEffects,
  moves: new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate])),
  moveActivationCounts: moveActivationCounts(state),
  successfulHitCount: 0,
  includeActiveFloatingEffects: true,
  ...(triggeringMove === undefined ? {} : { triggeringMove, triggeringMoveOwner: "self" as const }),
});

const floatingScopeForApplication = (
  application: FloatingEffectApplication,
  sourceCombatantId: CombatantId,
  targetCombatantId: CombatantId,
): Extract<ActiveCombatEffect, { readonly type: "floating-effect" }>["scope"] => {
  if (application.scope?.type === "next-action") return { type: "next-action" };
  if (application.scope?.type === "next-turn")
    return {
      type: "next-turn",
      combatantId: application.scope.subject === "self" ? sourceCombatantId : targetCombatantId,
    };
  return { type: "combat" };
};

const activeFloatingEffectFromApplication = (
  application: FloatingEffectApplication,
  sourceCombatantId: CombatantId,
  targetCombatantId: CombatantId,
  sourceDefinitionId: MoveDefinition["id"],
  createdOnTurn: number,
  dependencies: CombatDependencies,
): ActiveCombatEffect => ({
  id: dependencies.ids.nextActiveEffectId(),
  type: "floating-effect",
  sourceCombatantId,
  targetCombatantId: application.target === "self" ? sourceCombatantId : targetCombatantId,
  sourceDefinitionId,
  floatingEffectId: application.floatingEffectId,
  effects: application.effects,
  termination: application.termination,
  ...(application.duration === undefined
    ? {}
    : {
        duration: {
          type: "until-combat-result" as const,
          combatantId:
            application.duration.actor === "self" ? sourceCombatantId : targetCombatantId,
          result: application.duration.result,
          ...(application.duration.moveSelector === undefined
            ? {}
            : { moveSelector: application.duration.moveSelector }),
          ...(application.duration.rollThreshold === undefined
            ? {}
            : { rollThreshold: application.duration.rollThreshold }),
        },
      }),
  ...(application.stacking === undefined ? {} : { stacking: application.stacking }),
  scope: floatingScopeForApplication(application, sourceCombatantId, targetCombatantId),
  createdOnTurn,
});

const activeFloatingEffectsFromApplications = (
  applications: readonly FloatingEffectApplication[],
  sourceCombatantId: CombatantId,
  targetCombatantId: CombatantId,
  sourceDefinitionId: MoveDefinition["id"],
  createdOnTurn: number,
  dependencies: CombatDependencies,
) =>
  applications.map((application) =>
    activeFloatingEffectFromApplication(
      application,
      sourceCombatantId,
      targetCombatantId,
      sourceDefinitionId,
      createdOnTurn,
      dependencies,
    ),
  );

const activeExtraActionFromApplication = (
  application: ExtraActionApplication,
  sourceCombatantId: CombatantId,
  targetCombatantId: CombatantId,
  sourceDefinitionId: MoveDefinition["id"],
  createdOnTurn: number,
  dependencies: CombatDependencies,
): Extract<ActiveCombatEffect, { readonly type: "extra-action" }> => ({
  id: dependencies.ids.nextActiveEffectId(),
  type: "extra-action",
  sourceCombatantId,
  targetCombatantId: application.target === "self" ? sourceCombatantId : targetCombatantId,
  sourceDefinitionId,
  sourceEffectIndex: application.effectIndex,
  phase: application.phase,
  ...(application.moveCategory === undefined ? {} : { moveCategory: application.moveCategory }),
  sourceMoveOnly: application.sourceMoveOnly,
  ...(application.constant === undefined ? {} : { constant: application.constant }),
  remainingActions: application.maximumActions ?? 1,
  availableFromTurn: application.scope === "next-turn" ? createdOnTurn + 1 : createdOnTurn,
  // turnNumber advances once per combatant turn; a next-turn allowance must
  // remain valid through the owner's following action after the opponent's turn.
  expiresAfterTurn: application.scope === "next-turn" ? createdOnTurn + 2 : createdOnTurn,
  ...(application.useLimit === undefined ? {} : { useLimit: application.useLimit }),
});

const activeExtraActionsFromApplications = (
  state: ActiveFightState,
  applications: readonly ExtraActionApplication[],
  sourceCombatantId: CombatantId,
  targetCombatantId: CombatantId,
  sourceDefinitionId: MoveDefinition["id"],
  createdOnTurn: number,
  dependencies: CombatDependencies,
) =>
  applications.flatMap((application) => {
    if (application.useLimit !== undefined) {
      const uses = state.actionHistory.filter(
        (action) =>
          action.actorId === sourceCombatantId &&
          action.type === "use-move" &&
          action.moveId === sourceDefinitionId &&
          (application.useLimit?.scope === "combat" || action.turnNumber === state.turnNumber),
      ).length;
      if (uses >= application.useLimit.count) return [];
    }
    return [
      activeExtraActionFromApplication(
        application,
        sourceCombatantId,
        targetCombatantId,
        sourceDefinitionId,
        createdOnTurn,
        dependencies,
      ),
    ];
  });

const activeActionRestrictionsFromApplications = (
  state: ActiveFightState,
  applications: readonly ActionRestrictionApplication[],
  sourceCombatantId: CombatantId,
  opponentCombatantId: CombatantId,
  sourceDefinitionId: MoveDefinition["id"],
  createdOnTurn: number,
  dependencies: CombatDependencies,
): readonly Extract<ActiveCombatEffect, { readonly type: "action-restriction" }>[] =>
  applications.map((application) => {
    const targetCombatantId =
      application.target === "self" ? sourceCombatantId : opponentCombatantId;
    return {
      id: dependencies.ids.nextActiveEffectId(),
      type: "action-restriction",
      sourceCombatantId,
      targetCombatantId,
      sourceDefinitionId,
      sourceEffectIndex: application.effectIndex,
      ...(application.blockedCategories === undefined
        ? {}
        : { blockedCategories: application.blockedCategories }),
      availableFromTurn: createdOnTurn + (state.activeCombatantId === targetCombatantId ? 2 : 1),
      remainingTurns: application.remainingTurns,
    };
  });

const immediateResolutionThresholdRules = (
  applications: readonly ResolutionThresholdApplication[],
): readonly ResolutionThresholdRule[] =>
  applications
    .filter(
      (application) => application.scope !== "next-action" && application.duration === undefined,
    )
    .map(({ outcome, roll, comparison, value, relativeTo, relativeOperation, resultScope }) => ({
      outcome,
      roll,
      comparison,
      value,
      ...(relativeTo === undefined ? {} : { relativeTo }),
      ...(relativeOperation === undefined ? {} : { relativeOperation }),
      resultScope,
    }));

const resolutionThresholdsForMove = (
  state: ActiveFightState,
  attacker: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  move: MoveDefinition,
): readonly ResolutionThresholdRule[] => {
  const effectContext = convertedAttackEffectContext(state, attacker, target, move);
  const passiveEffects = moveEffectsForTrigger(move, "passive", effectContext);
  const beforeAttackEffects = moveEffectsForTrigger(move, "before-attack-roll", effectContext);
  return [
    ...activeResolutionThresholds(state, attacker.id, target.id, move),
    ...immediateResolutionThresholdRules(passiveEffects.resolutionThresholds),
    ...immediateResolutionThresholdRules(beforeAttackEffects.resolutionThresholds),
  ];
};

const criticalThresholdsForMove = (
  state: ActiveFightState,
  attacker: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  move: MoveDefinition,
  effectContext: ReturnType<typeof convertedAttackEffectContext>,
): readonly CriticalThresholdApplication[] => {
  const sourceMoveIds = new Set(
    attacker.moveIds.filter(
      (moveId) =>
        MOVE_DEFINITIONS.find((candidate) => candidate.id === moveId)?.category === "mastery",
    ),
  );
  for (const effect of state.activeEffects) {
    if (
      effect.type === "active-constant" &&
      effect.lifecycle !== "deactivated" &&
      !activeEffectSuppressed(state, effect) &&
      effect.sourceCombatantId === attacker.id
    )
      sourceMoveIds.add(effect.sourceDefinitionId);
  }
  const passiveSources = [...sourceMoveIds].flatMap((sourceMoveId) => {
    const sourceMove = MOVE_DEFINITIONS.find((candidate) => candidate.id === sourceMoveId);
    return sourceMove === undefined
      ? []
      : moveEffectsForTrigger(sourceMove, "passive", effectContext).criticalThresholds;
  });
  const currentMoveEffects = [
    ...moveEffectsForTrigger(move, "passive", effectContext).criticalThresholds,
    ...moveEffectsForTrigger(move, "before-attack-roll", effectContext).criticalThresholds,
  ];
  return [...passiveSources, ...currentMoveEffects].filter(
    (application) =>
      application.target === "self" && selectorMatchesMove(application.selector, move),
  );
};

interface ConvertedAttackEffectRollModifierInput {
  readonly beforeAttackEffects: ReturnType<typeof moveEffectsForTrigger>;
  readonly state: ActiveFightState;
  readonly attackerId: CombatantId;
  readonly targetId: CombatantId;
  readonly move: MoveDefinition;
  readonly targetScope: "self" | "opponent";
  readonly roll: RollModification["roll"];
  readonly modifier: RollModification["modifier"];
}

type NumericRollCap = Extract<RollModification["cap"], { readonly type: "maximum" | "minimum" }>;

const standardRollModificationLimit = (move: MoveDefinition | undefined) => {
  if (move?.category === "advanced-attack")
    return GLOBAL_RULES.combat.advancedAttackModificationLimit;
  if (move?.category === "signature")
    return GLOBAL_RULES.combat.signatureTechniqueModificationLimit;
  return undefined;
};

const applyStandardRollModificationLimit = (
  amount: number,
  move: MoveDefinition | undefined,
  allowExceed: boolean,
) => {
  const limit = standardRollModificationLimit(move);
  if (limit === undefined || allowExceed) return amount;
  return Math.max(-limit, Math.min(limit, amount));
};

const applyRollCap = (amount: number, cap: NumericRollCap) =>
  cap.type === "maximum" ? Math.min(amount, cap.value) : Math.max(amount, cap.value);

const rollModificationAmount = (effect: RollModification) => {
  const cap = effect.cap;
  if (cap?.scope !== "amount" || cap.type === "allow-exceed") return effect.amount;
  return applyRollCap(effect.amount, cap);
};

const rollModificationsForConvertedAttack = ({
  beforeAttackEffects,
  state,
  attackerId,
  targetId,
  move,
  targetScope,
  roll,
  modifier,
}: ConvertedAttackEffectRollModifierInput) =>
  beforeAttackEffects.rollModifications.filter(
    (effect) =>
      effect.target === targetScope &&
      effect.roll === roll &&
      effect.modifier === modifier &&
      !rollModificationPrevented({
        state,
        combatantId: targetScope === "self" ? attackerId : targetId,
        roll,
        modifier,
        move,
        sourceCombatantId: attackerId,
        sourceDefinitionId: move.id,
      }),
  );

const convertedAttackEffectRollModifier = ({
  beforeAttackEffects,
  state,
  attackerId,
  targetId,
  move,
  targetScope,
  roll,
  modifier,
}: ConvertedAttackEffectRollModifierInput) => {
  const modifications = rollModificationsForConvertedAttack({
    beforeAttackEffects,
    state,
    attackerId,
    targetId,
    move,
    targetScope,
    roll,
    modifier,
  });
  return applyStandardRollModificationLimit(
    modifications.reduce((total, effect) => total + rollModificationAmount(effect), 0),
    move,
    modifications.some((effect) => effect.cap?.type === "allow-exceed"),
  );
};

const convertedAttackEffectRollModifierAllowsExceed = (
  input: ConvertedAttackEffectRollModifierInput,
) =>
  rollModificationsForConvertedAttack(input).some((effect) => effect.cap?.type === "allow-exceed");

const convertedAttackEffectRollTotalCap = (input: ConvertedAttackEffectRollModifierInput) =>
  rollModificationsForConvertedAttack(input).reduce<NumericRollCap | undefined>((cap, effect) => {
    if (effect.cap?.type === "allow-exceed" || effect.cap?.scope !== "total") return cap;
    return effect.cap;
  }, undefined);

const convertedAttackEffectRollValueCap = (input: ConvertedAttackEffectRollModifierInput) =>
  rollModificationsForConvertedAttack(input).reduce<NumericRollCap | undefined>((cap, effect) => {
    if (effect.cap?.type === "allow-exceed" || effect.cap?.scope !== "roll") return cap;
    return effect.cap;
  }, undefined);

const combatResultOverridesForAttack = (
  applications: readonly CombatResultOverrideApplication[],
  diceCount: number,
  fallback: readonly ResultOverride[] | undefined,
): readonly ResultOverride[] =>
  Array.from({ length: diceCount }, (_, index) => {
    const result =
      fallback?.[index] ??
      applications.find(
        (application) =>
          application.target === "self" &&
          application.resultScope === "current-attack" &&
          (application.result === "successful" || application.result === "stopped"),
      )?.result;
    return result === "successful" || result === "stopped" ? result : undefined;
  });

interface CreateNumericOverridesFromEffectsInput {
  readonly beforeAttackEffects: ReturnType<typeof moveEffectsForTrigger>;
  readonly state: ActiveFightState;
  readonly attackerId: CombatantId;
  readonly targetId: CombatantId;
  readonly move: MoveDefinition;
  readonly diceCount: number;
}

const createNumericOverridesFromEffects = ({
  beforeAttackEffects,
  state,
  attackerId,
  targetId,
  move,
  diceCount,
}: CreateNumericOverridesFromEffectsInput): readonly NumericResultOverride[] =>
  Array.from({ length: diceCount }, () =>
    beforeAttackEffects.rollResultOverrides
      .filter(
        (effect) =>
          !rollModificationPrevented({
            state,
            combatantId: effect.target === "self" ? attackerId : targetId,
            roll: effect.roll,
            modifier: "result",
            move,
            sourceCombatantId: attackerId,
            sourceDefinitionId: move.id,
          }),
      )
      .reduce<Exclude<NumericResultOverride, undefined>>(
        (current, effect) => ({ ...current, [effect.roll]: effect.value }),
        {},
      ),
  );

const convertedAttackRoll = (
  input: CompleteConvertedAttackInput,
  attack: LiteralMoveAttack,
  effectContext: ReturnType<typeof convertedAttackEffectContext>,
) => {
  const {
    attacker,
    blockedDice = 0,
    defenseResultModifier,
    dependencies,
    move,
    state,
    target,
  } = input;
  const beforeAttackEffects = moveEffectsForTrigger(move, "before-attack-roll", effectContext);
  const passiveAttackEffects = moveEffectsForTrigger(move, "passive", effectContext);
  const activeConstantAttackEffects = activeConstantRollModifications(
    state,
    attacker.id,
    target.id,
    move,
  );
  const attackRollEffects = {
    ...beforeAttackEffects,
    rollModifications: [
      ...passiveAttackEffects.rollModifications,
      ...activeConstantAttackEffects,
      ...beforeAttackEffects.rollModifications,
    ],
  };
  const effectRollModifier = (
    targetScope: "self" | "opponent",
    roll: RollModification["roll"],
    modifier: RollModification["modifier"],
  ) =>
    convertedAttackEffectRollModifier({
      beforeAttackEffects: attackRollEffects,
      state,
      attackerId: attacker.id,
      targetId: target.id,
      move,
      targetScope,
      roll,
      modifier,
    });
  const totalRollModifier = (
    targetScope: "self" | "opponent",
    roll: RollModification["roll"],
    modifier: RollModification["modifier"],
  ) => {
    const activeCombatantId = targetScope === "self" ? attacker.id : target.id;
    const immediateInput = {
      beforeAttackEffects: attackRollEffects,
      state,
      attackerId: attacker.id,
      targetId: target.id,
      move,
      targetScope,
      roll,
      modifier,
    } satisfies ConvertedAttackEffectRollModifierInput;
    const immediateAmount = effectRollModifier(targetScope, roll, modifier);
    const activeAmount = activeRollModifier(state, activeCombatantId, roll, modifier, move);
    const combinedAmount = applyStandardRollModificationLimit(
      activeAmount + immediateAmount,
      move,
      activeRollModifierCanExceed(state, activeCombatantId, roll, modifier, move) ||
        convertedAttackEffectRollModifierAllowsExceed(immediateInput),
    );
    const totalCap = convertedAttackEffectRollTotalCap({
      beforeAttackEffects: attackRollEffects,
      state,
      attackerId: attacker.id,
      targetId: target.id,
      move,
      targetScope,
      roll,
      modifier,
    });
    const activeTotalCap = activeRollNumericCap(
      state,
      activeCombatantId,
      roll,
      modifier,
      "total",
      move,
    );
    const cappedAmount =
      totalCap === undefined ? combinedAmount : applyRollCap(combinedAmount, totalCap);
    return activeTotalCap === undefined ? cappedAmount : applyRollCap(cappedAmount, activeTotalCap);
  };
  const rollValueWithCap = (
    value: number,
    targetScope: "self" | "opponent",
    roll: RollModification["roll"],
    modifier: RollModification["modifier"],
  ) => {
    const cap = convertedAttackEffectRollValueCap({
      beforeAttackEffects: attackRollEffects,
      state,
      attackerId: attacker.id,
      targetId: target.id,
      move,
      targetScope,
      roll,
      modifier,
    });
    const activeCap = activeRollNumericCap(
      state,
      targetScope === "self" ? attacker.id : target.id,
      roll,
      modifier,
      "roll",
      move,
    );
    const cappedValue = cap === undefined ? value : applyRollCap(value, cap);
    return activeCap === undefined ? cappedValue : applyRollCap(cappedValue, activeCap);
  };
  const rollDefinition = beforeAttackEffects.rollDefinitions.find(
    (effect): effect is RollDefinitionOverride =>
      effect.target === "self" &&
      effect.roll === "attack" &&
      !rollModificationPrevented({
        state,
        combatantId: attacker.id,
        roll: "attack",
        modifier: "sides",
        move,
        sourceCombatantId: attacker.id,
        sourceDefinitionId: move.id,
      }),
  );
  const adjustedAttack = adjustedAttackRoll(
    state,
    attacker.id,
    attack.attackRoll ?? defaultMoveAttackRoll(),
    move,
  );
  const numericOverridesFromEffects = createNumericOverridesFromEffects({
    beforeAttackEffects,
    state,
    attackerId: attacker.id,
    targetId: target.id,
    move,
    diceCount: rollDefinition?.dice ?? adjustedAttack.dice,
  });
  const resultOverridesFromEffects = combatResultOverridesForAttack(
    passiveAttackEffects.combatResultOverrides,
    rollDefinition?.dice ?? adjustedAttack.dice,
    input.resultOverrides,
  );
  const beforeDieResultModifier = (index: number, priorRolls: readonly AttackDieRoll[]) => {
    const onRollResultEffects = moveEffectsForTrigger(move, "on-roll-result", {
      ...effectContext,
      rolls: priorRolls,
      successfulHitCount: priorRolls.filter((roll) => roll.outcome === "successful").length,
    });
    const beforeAttackDieEffects = moveEffectsForTrigger(move, "before-attack-roll", {
      ...effectContext,
      rolls: priorRolls,
      successfulHitCount: priorRolls.filter((roll) => roll.outcome === "successful").length,
    });
    const amount = [
      ...beforeAttackDieEffects.rollModifications,
      ...onRollResultEffects.rollModifications,
    ]
      .filter(
        (effect) =>
          effect.target === "self" &&
          effect.roll === "attack" &&
          effect.modifier === "result" &&
          effect.dieIndex === index + 1 &&
          !rollModificationPrevented({
            state,
            combatantId: attacker.id,
            roll: "attack",
            modifier: "result",
            move,
            sourceCombatantId: attacker.id,
            sourceDefinitionId: move.id,
          }),
      )
      .reduce((total, effect) => total + effect.amount, 0);
    return amount === 0 ? undefined : { attack: amount };
  };
  const statAdjustedAttacker = combatantWithActiveStatModifiers(
    state,
    attacker,
    move,
    "attack",
    "attacker",
  );
  const statAdjustedTarget = combatantWithActiveStatModifiers(
    state,
    target,
    move,
    "defense",
    "defender",
  );
  const rawBaseDamage = Math.round((attacker.stats.power * attack.baseDamagePercent.value) / 100);
  const passiveAdjustedDamage = applySourcedDamageModifications(
    state,
    rawBaseDamage,
    passiveAttackEffects.damageModifications,
    attacker.id,
    attacker.id,
    move.id,
    move,
  );
  const constantAdjustedDamage = applyActiveConstantDamageModifiers(
    state,
    attacker.id,
    target.id,
    passiveAdjustedDamage,
    move,
  );
  const activeAdjustedDamage = applyActiveDamageModifiers(
    state,
    attacker.id,
    constantAdjustedDamage,
    move,
  );
  const beforeAttackAdjustedDamage = applySourcedDamageModifications(
    state,
    activeAdjustedDamage,
    beforeAttackEffects.damageModifications,
    attacker.id,
    attacker.id,
    move.id,
    move,
  );
  return resolveMoveAttack(
    statAdjustedAttacker,
    statAdjustedTarget,
    {
      attack: {
        ...adjustedAttack,
        dice: Math.max(
          1,
          (rollDefinition?.dice ?? adjustedAttack.dice) +
            totalRollModifier("self", "attack", "dice"),
        ),
        sides: rollValueWithCap(
          (rollDefinition?.sides ?? (attack.attackRoll ?? defaultMoveAttackRoll()).sides) +
            totalRollModifier("self", "attack", "sides"),
          "self",
          "attack",
          "sides",
        ),
      },
      defenseSides:
        GLOBAL_RULES.combat.standardDieSides + totalRollModifier("opponent", "defense", "sides"),
      attackResultModifier: totalRollModifier("self", "attack", "result"),
      criticalThresholds: criticalThresholdsForMove(state, attacker, target, move, effectContext),
      defenseResultModifier:
        (defenseResultModifier ?? 0) + totalRollModifier("opponent", "defense", "result"),
      resolutionThresholds: resolutionThresholdsForMove(state, attacker, target, move),
      preventCritical: combatResultPrevented(state, attacker.id, "critical", move),
      preventCounter: combatResultPrevented(state, target.id, "counter", move),
      naturalRolls: input.naturalRolls,
      resultOverrides: resultOverridesFromEffects,
      numericResultOverrides: input.numericResultOverrides ?? numericOverridesFromEffects,
      beforeDieResultModifier,
      baseDamage: damageAfterStatusPenalties(state, attacker, beforeAttackAdjustedDamage, move),
      damagePerHit: attack.damagePerHit,
    },
    dependencies.random,
    blockedDice,
  );
};

interface ConvertedAttackActivatedEffectsInput {
  readonly state: ActiveFightState;
  readonly dependencies: CombatDependencies;
  readonly attacker: ActiveFightState["combatants"][CombatantId];
  readonly target: ActiveFightState["combatants"][CombatantId];
  readonly move: MoveDefinition;
  readonly createdOnTurn: number;
  readonly effects: ReturnType<typeof successfulMoveEffects>;
  readonly defeated: boolean;
}

const convertedAttackActivatedEffects = ({
  state,
  dependencies,
  attacker,
  target,
  move,
  createdOnTurn,
  effects,
  defeated,
}: ConvertedAttackActivatedEffectsInput) => {
  const suppressions = effects.suppressions.map((suppression) =>
    activeSuppressionFromApplication(suppression, attacker.id, target.id, move.id, dependencies),
  );
  const locks = effects.locks.map((lock) =>
    activeLockFromApplication(lock, attacker.id, target.id, move.id, dependencies),
  );
  const moveUsePreventions = effects.moveUsePreventions.map((prevention) =>
    activeMoveUsePreventionFromApplication(
      prevention,
      attacker.id,
      target.id,
      move.id,
      dependencies,
    ),
  );
  const statusPreventions = effects.statusPreventions.map((prevention) =>
    activeStatusPreventionFromApplication(
      prevention,
      attacker.id,
      target.id,
      move.id,
      dependencies,
    ),
  );
  const combatResultPreventions = effects.combatResultPreventions.map((prevention) =>
    activeCombatResultPreventionFromApplication(
      prevention,
      attacker.id,
      target.id,
      move.id,
      dependencies,
    ),
  );
  const rollModificationPreventions = effects.rollModificationPreventions.map((prevention) =>
    activeRollModificationPreventionFromApplication(
      prevention,
      attacker.id,
      target.id,
      move.id,
      dependencies,
    ),
  );
  const moveModificationPreventions = effects.moveModificationPreventions.map((prevention) =>
    activeMoveModificationPreventionFromApplication(
      prevention,
      attacker.id,
      target.id,
      move.id,
      dependencies,
    ),
  );
  const resourceModificationPreventions = effects.resourceModificationPreventions.flatMap(
    (prevention) => {
      const active = activeResourceModificationPreventionFromApplication(
        prevention,
        attacker.id,
        target.id,
        move.id,
        dependencies,
      );
      return active === undefined ? [] : [active];
    },
  );
  const rollModifiers = activeRollModifiersFromApplications(
    effects.rollModifications,
    attacker.id,
    target.id,
    move.id,
    createdOnTurn,
    dependencies,
  );
  const rerolls = activeRerollsFromApplications(
    effects.rerolls,
    attacker.id,
    target.id,
    dependencies,
  );
  const damageModifiers = activeDamageModifiersFromApplications(
    effects.damageModifications,
    attacker.id,
    target.id,
    move.id,
    createdOnTurn,
    dependencies,
  );
  const statModifiers = activeStatModifiersFromApplications(
    effects.statModifications,
    attacker.id,
    target.id,
    move.id,
    dependencies,
  );
  const resolutionThresholds = activeResolutionThresholdsFromApplications(
    effects.resolutionThresholds,
    attacker.id,
    target.id,
    move.id,
    dependencies,
  );
  const scheduledResources = activeScheduledResourcesFromApplications(
    state,
    effects.scheduledResources,
    attacker.id,
    target.id,
    move.id,
    dependencies,
  );
  const costModifiers = defeated
    ? []
    : effects.costModifications.flatMap((modifier) => {
        const baseKiCost = modifier.selector.baseKiCost;
        if (
          modifier.selector.category !== "advanced-attack" ||
          baseKiCost?.comparison !== "exactly" ||
          baseKiCost.value.type !== "literal"
        ) {
          return [];
        }
        return [
          {
            id: dependencies.ids.nextActiveEffectId(),
            type: "modify-ki-cost" as const,
            sourceCombatantId: attacker.id,
            targetCombatantId: modifier.target === "self" ? attacker.id : target.id,
            sourceDefinitionId: move.id,
            amount: modifier.amount,
            selector: { category: "advanced-attack" as const, baseKiCost: baseKiCost.value.value },
            scope: "next-eligible-action" as const,
          },
        ];
      });
  const floatingEffects = activeFloatingEffectsFromApplications(
    effects.floatingEffects.filter(
      (application, index, applications) =>
        application.stacking !== "prevent" ||
        (!state.activeEffects.some(
          (activeEffect) =>
            activeEffect.type === "floating-effect" &&
            activeEffect.sourceCombatantId === attacker.id &&
            activeEffect.targetCombatantId ===
              (application.target === "self" ? attacker.id : target.id) &&
            activeEffect.floatingEffectId === application.floatingEffectId,
        ) &&
          applications
            .slice(0, index)
            .every(
              (priorApplication) =>
                priorApplication.stacking !== "prevent" ||
                priorApplication.floatingEffectId !== application.floatingEffectId ||
                priorApplication.target !== application.target,
            )),
    ),
    attacker.id,
    target.id,
    move.id,
    createdOnTurn,
    dependencies,
  );
  const extraActions = activeExtraActionsFromApplications(
    state,
    effects.extraActions,
    attacker.id,
    target.id,
    move.id,
    createdOnTurn,
    dependencies,
  );
  const actionRestrictions = activeActionRestrictionsFromApplications(
    state,
    effects.actionRestrictions,
    attacker.id,
    target.id,
    move.id,
    createdOnTurn,
    dependencies,
  );
  return [
    ...suppressions,
    ...locks,
    ...moveUsePreventions,
    ...statusPreventions,
    ...combatResultPreventions,
    ...rollModificationPreventions,
    ...moveModificationPreventions,
    ...resourceModificationPreventions,
    ...resolutionThresholds,
    ...scheduledResources,
    ...rollModifiers,
    ...rerolls,
    ...damageModifiers,
    ...statModifiers,
    ...costModifiers,
    ...floatingEffects,
    ...extraActions,
    ...actionRestrictions,
  ];
};

const powerUpTriggeredEffects = (
  state: ActiveFightState,
  actor: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  actionHistory: readonly CombatActionRecord[],
) => {
  const moves = new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate]));
  const sourceDefinitionIds = new Set(actor.moveIds);
  for (const effect of state.activeEffects) {
    if (
      effect.type === "active-constant" &&
      effect.lifecycle !== "deactivated" &&
      effect.sourceCombatantId === actor.id
    ) {
      sourceDefinitionIds.add(effect.sourceDefinitionId);
    }
  }
  const context = {
    self: actor,
    opponent: target,
    turnNumber: state.turnNumber,
    completedTurnCount: state.turnNumber - 1,
    moves,
    moveActivationCounts: moveActivationCounts(state),
    successfulHitCount: 0,
    actionHistory,
    mode: state.mode,
  };
  return [...sourceDefinitionIds].flatMap((sourceDefinitionId) => {
    const sourceMove = moves.get(sourceDefinitionId);
    return sourceMove === undefined
      ? []
      : [{ sourceMove, effects: moveEffectsForTrigger(sourceMove, "on-power-up", context) }];
  });
};

interface StartCombatTriggeredEffects {
  readonly sourceMove: MoveDefinition;
  readonly actor: ActiveFightState["combatants"][CombatantId];
  readonly target: ActiveFightState["combatants"][CombatantId];
  readonly effects: ReturnType<typeof moveEffectsForTrigger>;
}

const startCombatTriggeredEffects = (
  state: ActiveFightState,
): readonly StartCombatTriggeredEffects[] => {
  const moves = new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate]));
  return Object.values(state.combatants).flatMap((actor) => {
    const target = Object.values(state.combatants).find(
      (candidate) => candidate.id !== actor.id && candidate.status === "active",
    );
    if (target === undefined) return [];
    const context = {
      self: actor,
      opponent: target,
      turnNumber: state.turnNumber,
      completedTurnCount: state.turnNumber - 1,
      moves,
      moveActivationCounts: moveActivationCounts(state),
      successfulHitCount: 0,
      actionHistory: state.actionHistory,
      activeEffects: state.activeEffects,
      mode: state.mode,
    };
    return actor.moveIds.flatMap((sourceDefinitionId) => {
      const sourceMove = moves.get(sourceDefinitionId);
      if (sourceMove === undefined) return [];
      const effects = moveEffectsForTrigger(sourceMove, "start-combat", context);
      return effects.resources.length === 0 && effects.locks.length === 0
        ? []
        : [{ sourceMove, actor, target, effects }];
    });
  });
};

const combatantsAfterStartCombatResources = (
  state: ActiveFightState,
  triggered: readonly StartCombatTriggeredEffects[],
) => {
  let combatants = state.combatants;
  for (const { actor, target, effects } of triggered) {
    const currentActor = combatants[actor.id];
    const currentTarget = combatants[target.id];
    const changes = resourceChangesAfterPreventions(
      currentActor,
      currentTarget,
      effects.resources,
      state.activeEffects,
      undefined,
    );
    if (changes.length === 0) continue;
    const actorAfter = resourceAfterChanges(currentActor, changes, "self", state.activeEffects);
    const targetAfter = resourceAfterChanges(
      currentTarget,
      changes,
      "opponent",
      state.activeEffects,
    );
    combatants = {
      ...combatants,
      [actor.id]: actorAfter,
      [target.id]: targetAfter,
    };
  }
  return combatants;
};

const activeEffectsFromTriggered = (
  state: ActiveFightState,
  triggered: readonly {
    readonly sourceMove: MoveDefinition;
    readonly actor: ActiveFightState["combatants"][CombatantId];
    readonly target: ActiveFightState["combatants"][CombatantId];
    readonly effects: ReturnType<typeof moveEffectsForTrigger>;
  }[],
  dependencies: CombatDependencies,
) =>
  triggered.flatMap(({ sourceMove, actor, target, effects }) =>
    convertedAttackActivatedEffects({
      state,
      dependencies,
      attacker: actor,
      target,
      move: sourceMove,
      createdOnTurn: state.turnNumber,
      effects,
      defeated: false,
    }),
  );

interface UpkeepTriggeredEffects {
  readonly sourceMove: MoveDefinition;
  readonly actor: ActiveFightState["combatants"][CombatantId];
  readonly target: ActiveFightState["combatants"][CombatantId];
  readonly effects: ReturnType<typeof moveEffectsForTrigger>;
}

const upkeepTriggeredEffects = (
  state: ActiveFightState,
  activeCombatantId: CombatantId,
): readonly UpkeepTriggeredEffects[] => {
  const moves = new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate]));
  return Object.values(state.combatants).flatMap((actor) => {
    const target = Object.values(state.combatants).find(
      (candidate) => candidate.id !== actor.id && candidate.status === "active",
    );
    if (target === undefined) return [];
    const targetLabel = actor.id === activeCombatantId ? "self" : "opponent";
    const context = {
      self: actor,
      opponent: target,
      turnNumber: state.turnNumber,
      completedTurnCount: state.turnNumber - 1,
      moves,
      moveActivationCounts: moveActivationCounts(state),
      successfulHitCount: 0,
      actionHistory: state.actionHistory,
      activeEffects: state.activeEffects,
      mode: state.mode,
    };
    const sourceDefinitionIds = new Set(actor.moveIds);
    for (const effect of state.activeEffects) {
      if (
        effect.type === "active-constant" &&
        effect.lifecycle !== "deactivated" &&
        !activeEffectSuppressed(state, effect) &&
        effect.sourceCombatantId === actor.id
      )
        sourceDefinitionIds.add(effect.sourceDefinitionId);
    }
    return [...sourceDefinitionIds].flatMap((sourceDefinitionId) => {
      const sourceMove = moves.get(sourceDefinitionId);
      if (sourceMove === undefined) return [];
      const effects = effectsForUpkeepTarget(
        moveEffectsForTrigger(sourceMove, "upkeep-phase", context),
        targetLabel,
      );
      return Object.values(effects).some((entries) => entries.length > 0)
        ? [{ sourceMove, actor, target, effects }]
        : [];
    });
  });
};

const upkeepEffectsAfterStoredRolls = (
  state: ActiveFightState,
  triggered: readonly UpkeepTriggeredEffects[],
  dependencies: CombatDependencies,
) => {
  let combatants = state.combatants;
  const resolvedRolls: { readonly combatantId: CombatantId; readonly roll: ResolvedStoredRoll }[] =
    [];
  const moves = new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate]));
  const resolvedTriggered = triggered.map(({ sourceMove, actor, target, effects }) => {
    const currentActor = combatants[actor.id];
    const currentTarget = combatants[target.id];
    const resolution = combatantAfterStoredRollRequests(
      currentActor,
      effects.storedRollRequests,
      state.turnNumber,
      dependencies,
    );
    combatants = { ...combatants, [actor.id]: resolution.combatant };
    resolvedRolls.push(...resolution.resolved.map((roll) => ({ combatantId: actor.id, roll })));
    const onRollResultEffects =
      resolution.resolved.length === 0
        ? mergeMoveEffects()
        : moveEffectsForTrigger(sourceMove, "on-roll-result", {
            self: resolution.combatant,
            opponent: currentTarget,
            turnNumber: state.turnNumber,
            completedTurnCount: state.turnNumber - 1,
            moves,
            moveActivationCounts: moveActivationCounts(state),
            successfulHitCount: 0,
            actionHistory: state.actionHistory,
            activeEffects: state.activeEffects,
            mode: state.mode,
          });
    return {
      sourceMove,
      actor: resolution.combatant,
      target: currentTarget,
      effects: mergeMoveEffects(effects, onRollResultEffects),
    };
  });
  return { combatants, resolvedRolls, triggered: resolvedTriggered };
};

const combatantsAfterUpkeepEffects = (
  state: ActiveFightState,
  triggered: readonly UpkeepTriggeredEffects[],
) => {
  let combatants = state.combatants;
  for (const { actor, target, effects } of triggered) {
    const currentActor = combatants[actor.id];
    const currentTarget = combatants[target.id];
    const changes = resourceChangesAfterPreventions(
      currentActor,
      currentTarget,
      effects.resources,
      state.activeEffects,
      undefined,
    );
    const actorAfter = statusesAfterApplications(
      resourceAfterChanges(currentActor, changes, "self", state.activeEffects),
      effects.statuses,
      "self",
    );
    const targetAfter = statusesAfterApplications(
      resourceAfterChanges(currentTarget, changes, "opponent", state.activeEffects),
      effects.statuses,
      "opponent",
    );
    combatants = {
      ...combatants,
      [actor.id]: actorAfter,
      [target.id]: targetAfter,
    };
  }
  return combatants;
};

const startCombatEvents = (
  state: ActiveFightState,
  combatants: Readonly<Record<CombatantId, CombatantState>>,
  activatedEffects: readonly ActiveCombatEffect[],
  dependencies: CombatDependencies,
  sequenceOffset = 0,
) => {
  const events: CombatEvent[] = [];
  for (const combatant of Object.values(state.combatants)) {
    const nextCombatant = combatants[combatant.id];
    const amount = nextCombatant.ki.current - combatant.ki.current;
    if (amount !== 0)
      events.push({
        id: dependencies.ids.nextEventId(),
        sequence: state.eventSequence + sequenceOffset + events.length + 1,
        fightId: state.id,
        type: "ki-changed",
        combatantId: combatant.id,
        amount,
        remainingKi: nextCombatant.ki.current,
      });
  }
  for (const effect of activatedEffects)
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + sequenceOffset + events.length + 1,
      fightId: state.id,
      type: "effect-activated",
      activeEffectId: effect.id,
      sourceCombatantId: effect.sourceCombatantId,
      targetCombatantId: effect.targetCombatantId,
      sourceDefinitionId: effect.sourceDefinitionId,
    });
  return events;
};

const moveUseTriggeredEffects = (
  state: ActiveFightState,
  actor: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  move: MoveDefinition,
) => {
  const moves = new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate]));
  return [actor, target].flatMap((listener) => {
    const opponent = listener.id === actor.id ? target : actor;
    const sourceDefinitionIds = new Set(listener.id === actor.id ? [move.id] : []);
    for (const effect of state.activeEffects) {
      if (
        effect.type === "active-constant" &&
        effect.lifecycle !== "deactivated" &&
        !activeEffectSuppressed(state, effect) &&
        effect.sourceCombatantId === listener.id
      )
        sourceDefinitionIds.add(effect.sourceDefinitionId);
    }
    const context = {
      self: listener,
      opponent,
      turnNumber: state.turnNumber,
      completedTurnCount: state.turnNumber - 1,
      moves,
      moveActivationCounts: moveActivationCounts(state),
      successfulHitCount: 0,
      actionHistory: state.actionHistory,
      activeEffects: state.activeEffects,
      mode: state.mode,
      triggeringMove: move,
    };
    return [...sourceDefinitionIds].flatMap((sourceDefinitionId) => {
      const sourceMove = moves.get(sourceDefinitionId);
      return sourceMove === undefined
        ? []
        : [
            {
              sourceMove,
              owner: listener,
              target: opponent,
              effects: moveEffectsForTrigger(sourceMove, "on-move-use", context),
            },
          ];
    });
  });
};

const resourceEventTriggeredEffects = (
  state: ActiveFightState,
  actor: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  resourceChanges: readonly ResourceChange[],
  actionHistory: readonly CombatActionRecord[],
) => {
  const moves = new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate]));
  const moveActivationCountMap = moveActivationCounts(state);
  const listeners = [actor, target];
  return resourceChanges.flatMap((change) => {
    let operation: ResourceChangeEvent["operation"];
    if (change.operation === "gain") operation = "gain";
    else if (change.operation === "lose" || change.operation === "drain") operation = "lose";
    else return [];
    const affectedCombatantId = change.target === "self" ? actor.id : target.id;
    return listeners.flatMap((listener) => {
      const opponent = listener.id === actor.id ? target : actor;
      const sourceDefinitionIds = new Set(listener.moveIds);
      for (const effect of state.activeEffects) {
        if (
          effect.type === "active-constant" &&
          effect.lifecycle !== "deactivated" &&
          !activeEffectSuppressed(state, effect) &&
          effect.sourceCombatantId === listener.id
        ) {
          sourceDefinitionIds.add(effect.sourceDefinitionId);
        }
      }
      const resourceChange: ResourceChangeEvent = {
        resource: change.resource,
        operation,
        amount: change.amount,
        subject: affectedCombatantId === listener.id ? "self" : "opponent",
        ...(change.cause === undefined ? {} : { cause: change.cause }),
        ...(change.sourceStyleId === undefined ? {} : { sourceStyleId: change.sourceStyleId }),
      };
      const context = {
        self: listener,
        opponent,
        turnNumber: state.turnNumber,
        completedTurnCount: state.turnNumber - 1,
        moves,
        moveActivationCounts: moveActivationCountMap,
        successfulHitCount: 0,
        actionHistory,
        mode: state.mode,
        resourceChange,
      };
      return [...sourceDefinitionIds].flatMap((sourceDefinitionId) => {
        const sourceMove = moves.get(sourceDefinitionId);
        if (sourceMove === undefined) return [];
        const trigger = operation === "gain" ? "on-resource-gain" : "on-resource-drain";
        return [
          {
            sourceMove,
            owner: listener,
            target: opponent,
            effects: moveEffectsForTrigger(sourceMove, trigger, context),
          },
        ];
      });
    });
  });
};

const resourceStateAfterChange = (
  combatant: ActiveFightState["combatants"][CombatantId],
  change: ResourceChange,
  target: "self" | "opponent",
) => {
  if (change.target !== target) return combatant;
  const resource = change.resource === "hp" ? combatant.hitPoints : combatant.ki;
  let nextValue = change.amount;
  if (change.operation === "gain") nextValue = resource.current + change.amount;
  if (change.operation === "lose" || change.operation === "drain")
    nextValue = resource.current - change.amount;
  const current = Math.min(resource.maximum, nextValue);
  return change.resource === "hp"
    ? { ...combatant, hitPoints: { ...combatant.hitPoints, current } }
    : { ...combatant, ki: { ...combatant.ki, current } };
};

const effectsRelativeToActionActor = (
  effects: ReturnType<typeof moveEffectsForTrigger>,
  ownerCombatantId: CombatantId,
  actionActorId: CombatantId,
): ReturnType<typeof moveEffectsForTrigger> => {
  const targetForAction = (target: "self" | "opponent") => {
    if (ownerCombatantId === actionActorId) return target;
    return target === "self" ? ("opponent" as const) : ("self" as const);
  };
  const remap = <T extends { readonly target: "self" | "opponent" }>(items: readonly T[]) =>
    items.map((item) => ({ ...item, target: targetForAction(item.target) }));
  return {
    resources: remap(effects.resources),
    storedRollRequests: effects.storedRollRequests,
    statuses: remap(effects.statuses),
    extraActions: effects.extraActions.map((effect) => ({
      ...effect,
      target: targetForAction(effect.target),
    })),
    scheduledResources: remap(effects.scheduledResources),
    damageModifications: remap(effects.damageModifications),
    statModifications: remap(effects.statModifications),
    suppressions: effects.suppressions.map((effect) => ({
      ...effect,
      target: targetForAction(effect.target),
    })),
    forcedActions: remap(effects.forcedActions),
    actionRestrictions: remap(effects.actionRestrictions),
    activations: remap(effects.activations),
    locks: remap(effects.locks),
    deactivations: remap(effects.deactivations),
    negations: remap(effects.negations),
    floatingEffects: effects.floatingEffects.map((effect) => ({
      ...effect,
      target: targetForAction(effect.target),
    })),
    moveUsePreventions: remap(effects.moveUsePreventions),
    remainingUseModifications: remap(effects.remainingUseModifications),
    statusPreventions: remap(effects.statusPreventions),
    rollModifications: remap(effects.rollModifications),
    rollDefinitions: remap(effects.rollDefinitions),
    rollResultOverrides: remap(effects.rollResultOverrides),
    combatResultOverrides: remap(effects.combatResultOverrides),
    criticalThresholds: ownerCombatantId === actionActorId ? effects.criticalThresholds : [],
    resolutionThresholds: remap(effects.resolutionThresholds),
    resolutionPreventions: remap(effects.resolutionPreventions),
    combatResultPreventions: remap(effects.combatResultPreventions),
    rollModificationPreventions: remap(effects.rollModificationPreventions),
    moveModificationPreventions: remap(effects.moveModificationPreventions),
    resourceModificationPreventions: remap(effects.resourceModificationPreventions),
    costModifications: remap(effects.costModifications),
    currentActionCostModifications: remap(effects.currentActionCostModifications),
    rerolls: remap(effects.rerolls),
    pendingEffectChoices: effects.pendingEffectChoices,
  };
};

const thresholdResourceChangeEvent = (change: ResourceChange): ResourceChangeEvent | undefined => {
  if (change.operation === "set") return undefined;
  const operation = change.operation === "gain" ? "gain" : "lose";
  return {
    resource: change.resource,
    operation,
    amount: change.amount,
    subject: change.target === "self" ? "self" : "opponent",
    ...(change.cause === undefined ? {} : { cause: change.cause }),
    ...(change.sourceStyleId === undefined ? {} : { sourceStyleId: change.sourceStyleId }),
  };
};

const activeConstantForSource = (
  state: ActiveFightState,
  combatantId: CombatantId,
  sourceDefinitionId: string,
) =>
  state.activeEffects.find(
    (effect): effect is Extract<ActiveCombatEffect, { readonly type: "active-constant" }> =>
      effect.type === "active-constant" &&
      effect.lifecycle !== "deactivated" &&
      effect.sourceCombatantId === combatantId &&
      effect.sourceDefinitionId === sourceDefinitionId,
  );

const thresholdEffectsForListener = (
  state: ActiveFightState,
  moves: ReadonlyMap<string, MoveDefinition>,
  actor: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  previousActor: ActiveFightState["combatants"][CombatantId],
  previousTarget: ActiveFightState["combatants"][CombatantId],
  nextActor: ActiveFightState["combatants"][CombatantId],
  nextTarget: ActiveFightState["combatants"][CombatantId],
  listener: ActiveFightState["combatants"][CombatantId],
  change: ResourceChange,
  actionHistory: readonly CombatActionRecord[],
) => {
  const listenerIsActor = listener.id === actor.id;
  const listenerState = listenerIsActor ? nextActor : nextTarget;
  const opponentState = listenerIsActor ? nextTarget : nextActor;
  const previousListenerState = listenerIsActor ? previousActor : previousTarget;
  const previousOpponentState = listenerIsActor ? previousTarget : previousActor;
  const sourceDefinitionIds = new Set(listener.moveIds);
  for (const effect of state.activeEffects) {
    if (
      effect.type === "active-constant" &&
      effect.lifecycle !== "deactivated" &&
      effect.sourceCombatantId === listener.id
    )
      sourceDefinitionIds.add(effect.sourceDefinitionId);
  }
  const resourceChange = thresholdResourceChangeEvent(change);
  return [...sourceDefinitionIds].flatMap((sourceDefinitionId) => {
    const sourceMove = moves.get(sourceDefinitionId);
    if (sourceMove === undefined) return [];
    const activeConstant = activeConstantForSource(state, listener.id, sourceDefinitionId);
    const effects = moveEffectsForTrigger(sourceMove, "on-resource-threshold", {
      self: listenerState,
      opponent: opponentState,
      previousResourceState: {
        self: previousListenerState,
        opponent: previousOpponentState,
      },
      turnNumber: state.turnNumber,
      completedTurnCount: state.turnNumber - 1,
      moves,
      moveActivationCounts: moveActivationCounts(state),
      successfulHitCount: 0,
      actionHistory,
      activeEffects: state.activeEffects,
      paidActivationCost: activeConstant?.paidActivationCost,
      mode: state.mode,
      ...(resourceChange === undefined ? {} : { resourceChange }),
    });
    return [
      {
        sourceMove,
        owner: listener,
        target: listenerIsActor ? target : actor,
        effects,
        effectsForAction: effectsRelativeToActionActor(effects, listener.id, actor.id),
      },
    ];
  });
};

const resourceThresholdTriggeredEffects = (
  state: ActiveFightState,
  actor: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  resourceChanges: readonly ResourceChange[],
  directDamage: number,
  actionHistory: readonly CombatActionRecord[],
) => {
  const moves = new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate]));
  const changes: readonly ResourceChange[] = [
    ...(directDamage > 0
      ? [
          {
            resource: "hp" as const,
            target: "opponent" as const,
            operation: "lose" as const,
            amount: directDamage,
            cause: "opponent-effect" as const,
          },
        ]
      : []),
    ...resourceChanges,
  ];
  let previousActor = actor;
  let previousTarget = target;
  const triggered = [] as ReturnType<typeof thresholdEffectsForListener>[number][];
  for (const change of changes) {
    const nextActor = resourceStateAfterChange(previousActor, change, "self");
    const nextTarget = resourceStateAfterChange(previousTarget, change, "opponent");
    triggered.push(
      ...thresholdEffectsForListener(
        state,
        moves,
        actor,
        target,
        previousActor,
        previousTarget,
        nextActor,
        nextTarget,
        actor,
        change,
        actionHistory,
      ),
      ...thresholdEffectsForListener(
        state,
        moves,
        actor,
        target,
        previousActor,
        previousTarget,
        nextActor,
        nextTarget,
        target,
        change,
        actionHistory,
      ),
    );
    previousActor = nextActor;
    previousTarget = nextTarget;
  }
  return triggered;
};

const mergeMoveEffects = (
  ...effectSets: readonly ReturnType<typeof moveEffectsForTrigger>[]
): ReturnType<typeof moveEffectsForTrigger> => ({
  resources: effectSets.flatMap((effects) => effects.resources),
  storedRollRequests: effectSets.flatMap((effects) => effects.storedRollRequests),
  statuses: effectSets.flatMap((effects) => effects.statuses),
  extraActions: effectSets.flatMap((effects) => effects.extraActions),
  scheduledResources: effectSets.flatMap((effects) => effects.scheduledResources),
  damageModifications: effectSets.flatMap((effects) => effects.damageModifications),
  statModifications: effectSets.flatMap((effects) => effects.statModifications),
  suppressions: effectSets.flatMap((effects) => effects.suppressions),
  forcedActions: effectSets.flatMap((effects) => effects.forcedActions),
  actionRestrictions: effectSets.flatMap((effects) => effects.actionRestrictions),
  activations: effectSets.flatMap((effects) => effects.activations),
  locks: effectSets.flatMap((effects) => effects.locks),
  deactivations: effectSets.flatMap((effects) => effects.deactivations),
  moveUsePreventions: effectSets.flatMap((effects) => effects.moveUsePreventions),
  remainingUseModifications: effectSets.flatMap((effects) => effects.remainingUseModifications),
  statusPreventions: effectSets.flatMap((effects) => effects.statusPreventions),
  rollModifications: effectSets.flatMap((effects) => effects.rollModifications),
  rollDefinitions: effectSets.flatMap((effects) => effects.rollDefinitions),
  rollResultOverrides: effectSets.flatMap((effects) => effects.rollResultOverrides),
  combatResultOverrides: effectSets.flatMap((effects) => effects.combatResultOverrides),
  criticalThresholds: effectSets.flatMap((effects) => effects.criticalThresholds),
  resolutionThresholds: effectSets.flatMap((effects) => effects.resolutionThresholds),
  resolutionPreventions: effectSets.flatMap((effects) => effects.resolutionPreventions),
  combatResultPreventions: effectSets.flatMap((effects) => effects.combatResultPreventions),
  rollModificationPreventions: effectSets.flatMap((effects) => effects.rollModificationPreventions),
  moveModificationPreventions: effectSets.flatMap((effects) => effects.moveModificationPreventions),
  resourceModificationPreventions: effectSets.flatMap(
    (effects) => effects.resourceModificationPreventions,
  ),
  negations: effectSets.flatMap((effects) => effects.negations),
  costModifications: effectSets.flatMap((effects) => effects.costModifications),
  currentActionCostModifications: effectSets.flatMap(
    (effects) => effects.currentActionCostModifications,
  ),
  floatingEffects: effectSets.flatMap((effects) => effects.floatingEffects),
  rerolls: effectSets.flatMap((effects) => effects.rerolls),
  pendingEffectChoices: effectSets.flatMap((effects) => effects.pendingEffectChoices),
});

interface ResolvedStoredRoll {
  readonly request: StoredRollRequest;
  readonly storedRoll: StoredRoll;
}

const combatantAfterStoredRollRequests = (
  combatant: CombatantState,
  requests: readonly StoredRollRequest[],
  turnNumber: number,
  dependencies: CombatDependencies,
): { readonly combatant: CombatantState; readonly resolved: readonly ResolvedStoredRoll[] } => {
  let storedRolls = combatant.storedRolls ?? {};
  const resolved = requests.map((request) => {
    const storedRoll: StoredRoll = {
      sourceDefinitionId: request.sourceDefinitionId,
      storageKey: request.storageKey,
      naturalResults: Array.from({ length: request.dice }, () =>
        dependencies.random.integer(1, request.sides),
      ),
      sides: request.sides,
      storedOnTurn: turnNumber,
    };
    storedRolls = { ...storedRolls, [request.storageKey]: storedRoll };
    return { request, storedRoll };
  });
  return {
    combatant: resolved.length === 0 ? combatant : { ...combatant, storedRolls },
    resolved,
  };
};

const storedRollEvents = (
  state: ActiveFightState,
  combatantId: CombatantId,
  resolved: readonly ResolvedStoredRoll[],
  dependencies: CombatDependencies,
  sequenceOffset: number,
  causedByDecisionId?: CombatDecision["id"],
): readonly CombatEvent[] =>
  resolved.map(({ request, storedRoll }, index) => ({
    id: dependencies.ids.nextEventId(),
    sequence: state.eventSequence + sequenceOffset + index + 1,
    fightId: state.id,
    type: "roll-stored",
    combatantId,
    sourceDefinitionId: request.sourceDefinitionId,
    storageKey: request.storageKey,
    naturalResults: storedRoll.naturalResults,
    sides: storedRoll.sides,
    ...(causedByDecisionId === undefined ? {} : { causedByDecisionId }),
  }));

const effectsForUpkeepTarget = (
  effects: ReturnType<typeof moveEffectsForTrigger>,
  target: "self" | "opponent",
): ReturnType<typeof moveEffectsForTrigger> => ({
  resources: effects.resources.filter((effect) => effect.target === target),
  storedRollRequests: effects.storedRollRequests.filter((effect) => effect.target === target),
  statuses: effects.statuses.filter((effect) => effect.target === target),
  extraActions: effects.extraActions.filter((effect) => effect.target === target),
  scheduledResources: effects.scheduledResources.filter((effect) => effect.target === target),
  damageModifications: effects.damageModifications.filter((effect) => effect.target === target),
  statModifications: effects.statModifications.filter((effect) => effect.target === target),
  suppressions: effects.suppressions.filter((effect) => effect.target === target),
  forcedActions: effects.forcedActions.filter((effect) => effect.target === target),
  actionRestrictions: effects.actionRestrictions.filter((effect) => effect.target === target),
  activations: effects.activations.filter((effect) => effect.target === target),
  locks: effects.locks.filter((effect) => effect.target === target),
  deactivations: effects.deactivations.filter((effect) => effect.target === target),
  floatingEffects: effects.floatingEffects.filter((effect) => effect.target === target),
  moveUsePreventions: effects.moveUsePreventions.filter((effect) => effect.target === target),
  remainingUseModifications: effects.remainingUseModifications.filter(
    (effect) => effect.target === target,
  ),
  statusPreventions: effects.statusPreventions.filter((effect) => effect.target === target),
  negations: effects.negations.filter((effect) => effect.target === target),
  rollModifications: effects.rollModifications.filter((effect) => effect.target === target),
  rollDefinitions: effects.rollDefinitions.filter((effect) => effect.target === target),
  rollResultOverrides: effects.rollResultOverrides.filter((effect) => effect.target === target),
  combatResultOverrides: effects.combatResultOverrides.filter((effect) => effect.target === target),
  criticalThresholds: effects.criticalThresholds.filter((effect) => effect.target === target),
  resolutionThresholds: effects.resolutionThresholds.filter((effect) => effect.target === target),
  resolutionPreventions: effects.resolutionPreventions.filter((effect) => effect.target === target),
  combatResultPreventions: effects.combatResultPreventions.filter(
    (effect) => effect.target === target,
  ),
  rollModificationPreventions: effects.rollModificationPreventions.filter(
    (effect) => effect.target === target,
  ),
  moveModificationPreventions: effects.moveModificationPreventions.filter(
    (effect) => effect.target === target,
  ),
  resourceModificationPreventions: effects.resourceModificationPreventions.filter(
    (effect) => effect.target === target,
  ),
  costModifications: effects.costModifications.filter((effect) => effect.target === target),
  currentActionCostModifications: effects.currentActionCostModifications.filter(
    (effect) => effect.target === target,
  ),
  rerolls: effects.rerolls.filter((effect) => effect.target === target),
  pendingEffectChoices: effects.pendingEffectChoices,
});

const powerUpActiveEffects = (
  state: ActiveFightState,
  additions: readonly ActiveCombatEffect[],
) => {
  const nonStackingRolls = additions.filter(
    (effect): effect is Extract<ActiveCombatEffect, { readonly type: "modify-next-action" }> =>
      effect.type === "modify-next-action" && effect.stacking === "prevent",
  );
  return [
    ...state.activeEffects.filter(
      (existing) =>
        !nonStackingRolls.some(
          (addition) =>
            existing.type === "modify-next-action" &&
            existing.sourceDefinitionId === addition.sourceDefinitionId &&
            existing.targetCombatantId === addition.targetCombatantId &&
            existing.modifier.type === "roll" &&
            addition.modifier.type === "roll" &&
            existing.modifier.roll === addition.modifier.roll &&
            existing.modifier.modifier === addition.modifier.modifier &&
            JSON.stringify(existing.selector) === JSON.stringify(addition.selector),
        ),
    ),
    ...additions,
  ];
};

const floatingEffectsAfterPowerUp = (state: ActiveFightState, actorId: CombatantId) =>
  state.activeEffects.filter(
    (effect) =>
      effect.type !== "floating-effect" ||
      !effect.termination.some(
        (rule) =>
          rule.trigger === "on-power-up" &&
          ((rule.actor === "self" && effect.sourceCombatantId === actorId) ||
            (rule.actor === "opponent" && effect.targetCombatantId === actorId)) &&
          rule.selector === undefined,
      ),
  );

interface AttackResolutionOptions {
  readonly requestDefense?: boolean;
  readonly blockedDice?: number;
  readonly blockUsage?: BlockUsage;
  readonly defenseItemUse?: DefenseItemUse;
  readonly defenseResultModifier?: number;
  readonly includeRollEvents?: boolean;
  readonly naturalRolls?: readonly ContestedAttackNaturalRoll[];
  readonly resultOverrides?: readonly ResultOverride[];
  readonly numericResultOverrides?: readonly NumericResultOverride[];
  readonly enabledOptionalEffectIndices?: readonly number[];
  readonly resolvedOptionalEffectIndices?: readonly number[];
  readonly enabledAfterDefenseEffectIndices?: readonly number[];
  readonly selectedNumericValues?: Readonly<Record<string, number>>;
}

interface BasicAttackResolutionOptions {
  readonly defenseItemUse?: DefenseItemUse;
  readonly defenseResultModifier?: number;
  readonly includeRollEvents?: boolean;
  readonly naturalRolls?: readonly ContestedAttackNaturalRoll[];
  readonly resultOverrides?: readonly ResultOverride[];
  readonly numericResultOverrides?: readonly NumericResultOverride[];
}

type PostDefenseReactionFrame = Extract<
  ActiveFightState["resolutionFrames"][number],
  { readonly stage: "awaiting-post-defense-reaction" }
>;

interface PostDefenseReactionSelection {
  readonly itemUse: ReturnType<typeof availablePostRollDefenseItems>[number] | undefined;
  readonly closeShaveKiLoss: number | undefined;
  readonly energyRedirectionDie: number | undefined;
  readonly reroll: PostDefenseRerollChoice | undefined;
  readonly secondChanceDie: number | undefined;
  readonly rerollEffect: ActiveRerollEffect | undefined;
  readonly rerollDieIndex: number | undefined;
  readonly afterDefenseEffectIndices: readonly number[] | undefined;
}

const convertedAttackActionRecord = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  resolution: ReturnType<typeof convertedAttackRoll>,
  critical = resolution.critical,
) =>
  actionRecordWithAttackResult(state, decision, {
    outcome: resolution.successfulHitCount > 0 ? "successful" : "stopped",
    critical,
    counter: resolution.counter,
    ...(resolution.rolls.length === 1
      ? {
          attackRollResult: resolution.rolls[0].attackResult,
          defenseRollResult: resolution.rolls[0].defenseResult,
        }
      : {}),
  });

const hasCriticalCombatResultOverride = (
  applications: readonly CombatResultOverrideApplication[],
) =>
  applications.some(
    (application) =>
      application.target === "self" &&
      application.resultScope === "current-attack" &&
      application.result === "critical",
  );

const completedConvertedAttackEffects = (
  move: MoveDefinition,
  context: Parameters<typeof moveEffectsForTrigger>[2],
  initialRoll: ReturnType<typeof convertedAttackRoll>,
  selectedAfterDefenseEffects: ReturnType<typeof moveEffectsForTrigger> | undefined,
  moveUseTriggered: ReturnType<typeof moveUseTriggeredEffects>,
) =>
  mergeMoveEffects(
    initialRoll.successfulHitCount > 0
      ? successfulMoveEffects(move, context)
      : stoppedMoveEffects(move, context),
    ...(selectedAfterDefenseEffects === undefined ? [] : [selectedAfterDefenseEffects]),
    ...moveUseTriggered.map(({ owner, effects: eventEffects }) =>
      effectsRelativeToActionActor(eventEffects, owner.id, context.self.id),
    ),
  );

const selectedAfterDefenseEffectsForResolution = (
  input: CompleteConvertedAttackInput,
  move: MoveDefinition,
  context: Parameters<typeof moveEffectsForTrigger>[2],
) =>
  input.enabledAfterDefenseEffectIndices === undefined
    ? undefined
    : moveEffectsForTrigger(move, "after-defense-roll", {
        ...context,
        enabledOptionalEffectIndices: input.enabledAfterDefenseEffectIndices,
      });

const currentActionForEffectContext = (action: CombatActionRecord) =>
  action.type === "basic-attack" || action.type === "use-move" ? action : undefined;

const completeConvertedAttackMove = (input: CompleteConvertedAttackInput) => {
  const {
    state,
    decision,
    move,
    dependencies,
    attacker,
    target,
    blockUsage,
    defenseItemUse,
    includeRollEvents,
  } = input;
  const { attack, cost: baseCost } = resolvedLiteralAttack(state, attacker, target, move);
  const effectContext = convertedAttackEffectContext(state, attacker, target, move);
  const attackEffectContext = {
    ...effectContext,
    ...(input.selectedNumericValues === undefined
      ? {}
      : { selectedNumericValues: input.selectedNumericValues }),
    ...(input.enabledOptionalEffectIndices === undefined
      ? {}
      : { enabledOptionalEffectIndices: input.enabledOptionalEffectIndices }),
    ...(input.resolvedOptionalEffectIndices === undefined
      ? {}
      : { resolvedOptionalEffectIndices: input.resolvedOptionalEffectIndices }),
  };
  const beforeAttackEffects = moveEffectsForTrigger(
    move,
    "before-attack-roll",
    attackEffectContext,
  );
  const cost = convertedAttackCost(
    state,
    attacker,
    move,
    baseCost.value,
    beforeAttackEffects.currentActionCostModifications,
  );
  const initialRoll = convertedAttackRoll(input, attack, attackEffectContext);
  const initialCurrentAction = convertedAttackActionRecord(state, decision, initialRoll);
  const resolvedEffectContext = {
    ...attackEffectContext,
    successfulHitCount: initialRoll.successfulHitCount,
    rolls: initialRoll.rolls,
    paidKiCost: cost,
    currentAction: currentActionForEffectContext(initialCurrentAction),
    collectPendingChoices: true,
  };
  const selectedAfterDefenseEffects = selectedAfterDefenseEffectsForResolution(
    input,
    move,
    resolvedEffectContext,
  );
  const moveUseTriggered = moveUseTriggeredEffects(state, attacker, target, move);
  const effects = completedConvertedAttackEffects(
    move,
    resolvedEffectContext,
    initialRoll,
    selectedAfterDefenseEffects,
    moveUseTriggered,
  );
  const criticalOverride =
    hasCriticalCombatResultOverride(effects.combatResultOverrides) ||
    (input.enabledAfterDefenseEffectIndices !== undefined &&
      effects.combatResultOverrides.some(
        (application) =>
          application.result === "critical" && application.resultScope === "current-attack",
      ));
  const critical = initialRoll.critical || criticalOverride;
  const currentAction = convertedAttackActionRecord(state, decision, initialRoll, critical);
  const baseDamage =
    critical && !initialRoll.critical ? initialRoll.damage * 2 : initialRoll.damage;
  const damageBeforeOnDamage = applyDamageModifications(
    baseDamage,
    initialRoll.successfulHitCount > 0
      ? effects.damageModifications.filter(
          (modification) =>
            modification.target === "self" &&
            (modification.scope === undefined || modification.scope === "current-action"),
        )
      : [],
    move,
  );
  const damageBeforeTargetCap = applyDamageModifications(
    damageBeforeOnDamage,
    initialRoll.successfulHitCount > 0
      ? defensiveOnDamageModifications(
          state,
          attacker,
          target,
          move,
          resolvedEffectContext,
          damageBeforeOnDamage,
        )
      : [],
    move,
  );
  const roll = {
    ...initialRoll,
    critical,
    damage: Math.min(target.hitPoints.current, damageBeforeTargetCap),
  };
  const resourceEffects =
    initialRoll.successfulHitCount > 0
      ? mergeMoveEffects(
          successfulMoveEffects(move, { ...resolvedEffectContext, currentDamage: roll.damage }),
          ...moveUseTriggered.map(({ owner, effects: eventEffects }) =>
            effectsRelativeToActionActor(eventEffects, owner.id, attacker.id),
          ),
        )
      : effects;
  const remainingHitPoints = Math.max(0, target.hitPoints.current - roll.damage);
  const afterDefenseEffects = passiveAfterDefenseEffects(
    state,
    attacker,
    target,
    move,
    resolvedEffectContext,
  );
  const baseResourceChanges = resourceChangesAfterPreventions(
    attacker,
    target,
    [
      ...beforeAttackEffects.resources,
      ...afterDefenseEffects.resources,
      ...resourceEffects.resources,
    ],
    state.activeEffects,
    currentAction,
  );
  const thresholdTriggered = resourceThresholdTriggeredEffects(
    state,
    attacker,
    target,
    baseResourceChanges,
    damageBeforeTargetCap,
    state.actionHistory,
  );
  const resourceTriggered = resourceEventTriggeredEffects(
    state,
    attacker,
    target,
    baseResourceChanges,
    state.actionHistory,
  );
  const resourceTriggeredEffects = resourceTriggered.map(
    ({ effects: triggeredEffects }) => triggeredEffects,
  );
  const thresholdTriggeredEffects = thresholdTriggered.map(
    ({ effectsForAction }) => effectsForAction,
  );
  const eventEffects = mergeMoveEffects(...resourceTriggeredEffects, ...thresholdTriggeredEffects);
  const resourceChanges = resourceChangesAfterPreventions(
    attacker,
    target,
    [...baseResourceChanges, ...eventEffects.resources],
    state.activeEffects,
    currentAction,
  );
  const targetHitPointsAfterEffects = resourceAfterChanges(
    { ...target, hitPoints: { ...target.hitPoints, current: remainingHitPoints } },
    resourceChanges,
    "opponent",
    state.activeEffects,
    currentAction,
  ).hitPoints.current;
  const defeated = targetHitPointsAfterEffects === 0;
  const counterChainLimitReached =
    roll.counter &&
    state.phase === "counter" &&
    !canContinueCounterChain(consecutiveCounterAttackCount(state) + 1);
  const context: ConvertedAttackMoveContext = {
    activatedEffects: [
      ...convertedAttackActivatedEffects({
        state,
        dependencies,
        attacker,
        target,
        move,
        createdOnTurn: state.turnNumber,
        effects: {
          ...beforeAttackEffects,
        },
        defeated,
      }),
      ...convertedAttackActivatedEffects({
        state,
        dependencies,
        attacker,
        target,
        move,
        createdOnTurn: state.turnNumber,
        effects: { ...effects, locks: [...afterDefenseEffects.locks, ...effects.locks] },
        defeated,
      }),
      ...moveUseTriggered.flatMap(
        ({ sourceMove, owner, target: eventTarget, effects: eventEffects }) =>
          convertedAttackActivatedEffects({
            state,
            dependencies,
            attacker: owner,
            target: eventTarget,
            move: sourceMove,
            createdOnTurn: state.turnNumber,
            effects: eventEffects,
            defeated,
          }),
      ),
      ...resourceTriggered.flatMap(
        ({ sourceMove, owner, target: eventTarget, effects: eventEffects }) =>
          convertedAttackActivatedEffects({
            state,
            dependencies,
            attacker: owner,
            target: eventTarget,
            move: sourceMove,
            createdOnTurn: state.turnNumber,
            effects: eventEffects,
            defeated,
          }),
      ),
      ...thresholdTriggered.flatMap(
        ({ sourceMove, owner, target: eventTarget, effects: thresholdEffects }) =>
          convertedAttackActivatedEffects({
            state,
            dependencies,
            attacker: owner,
            target: eventTarget,
            move: sourceMove,
            createdOnTurn: state.turnNumber,
            effects: thresholdEffects,
            defeated,
          }),
      ),
    ],
    attacker,
    target,
    move,
    cost,
    roll,
    remainingHitPoints,
    resourceChanges,
    activations: [...effects.activations, ...eventEffects.activations],
    deactivations: [...effects.deactivations, ...eventEffects.deactivations],
    moveUsePreventions: [...effects.moveUsePreventions, ...eventEffects.moveUsePreventions],
    remainingUseModifications: [
      ...effects.remainingUseModifications,
      ...eventEffects.remainingUseModifications,
    ],
    statusPreventions: [...effects.statusPreventions, ...eventEffects.statusPreventions],
    defeated,
    counterChainLimitReached,
    counterContinues: roll.counter && !counterChainLimitReached && !defeated,
    statusApplications: [
      ...afterDefenseEffects.statuses,
      ...effects.statuses,
      ...eventEffects.statuses,
    ].filter(
      (application) =>
        statusPreventionFor(
          state,
          application.target === "self" ? attacker.id : target.id,
          application.status.statusId,
        ) === undefined,
    ),
    ...(blockUsage === undefined ? {} : { blockUsage }),
    ...(defenseItemUse === undefined ? {} : { defenseItemUse }),
    ...(includeRollEvents === undefined ? {} : { includeRollEvents }),
  };
  const events = createConvertedAttackMoveEvents(state, decision, dependencies, context);
  const nextState = createConvertedAttackMoveState(
    state,
    decision,
    dependencies,
    context,
    events.length,
  );
  return nextState.status === "active"
    ? resolveDeactivations({
        state: nextState,
        activations: context.activations,
        applications: context.deactivations,
        sourceCombatantId: attacker.id,
        causedByDecisionId: decision.id,
        dependencies,
        priorEvents: events,
      })
    : transitionFrom(nextState, events);
};

const pendingAttackEffectChoice = ({
  state,
  decision,
  target,
  move,
  resolvedOptionalEffectIndices,
  dependencies,
}: {
  readonly state: ActiveFightState;
  readonly decision: Extract<CombatDecision, { readonly type: "use-move" }>;
  readonly target: ActiveFightState["combatants"][CombatantId];
  readonly move: MoveDefinition;
  readonly resolvedOptionalEffectIndices: readonly number[] | undefined;
  readonly dependencies: CombatDependencies;
}): CombatResult<CombatTransition> | undefined => {
  const pendingEffects = moveEffectsForTrigger(move, "before-attack-roll", {
    ...convertedAttackEffectContext(state, state.combatants[decision.actorId], target, move),
    collectPendingChoices: true,
    ...(resolvedOptionalEffectIndices === undefined ? {} : { resolvedOptionalEffectIndices }),
  }).pendingEffectChoices.find((choice) => choice.effectIndices.length > 0);
  if (pendingEffects === undefined) return undefined;
  return requestAttackEffectChoice({
    state,
    decision,
    target,
    move,
    effectIndices: pendingEffects.effectIndices,
    numericSelection: pendingEffects.numericSelection,
    dependencies,
  });
};

const resolveConvertedAttackMove = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  move: MoveDefinition,
  dependencies: CombatDependencies,
  {
    requestDefense = true,
    blockedDice = 0,
    blockUsage,
    defenseItemUse,
    defenseResultModifier,
    includeRollEvents,
    naturalRolls,
    resultOverrides,
    numericResultOverrides,
    enabledOptionalEffectIndices,
    resolvedOptionalEffectIndices,
    enabledAfterDefenseEffectIndices,
    selectedNumericValues,
  }: AttackResolutionOptions = {},
): CombatResult<CombatTransition> => {
  const attacker = state.combatants[decision.actorId];
  const target = activeOpponent(state, attacker.id, decision.targetCombatantId);
  const selectedBeforeAttackEffects =
    target !== undefined && enabledOptionalEffectIndices !== undefined
      ? moveEffectsForTrigger(move, "before-attack-roll", {
          ...convertedAttackEffectContext(state, attacker, target, move),
          enabledOptionalEffectIndices,
          ...(selectedNumericValues === undefined ? {} : { selectedNumericValues }),
          ...(resolvedOptionalEffectIndices === undefined ? {} : { resolvedOptionalEffectIndices }),
        })
      : undefined;
  const failure = convertedAttackMoveFailure(
    state,
    decision,
    move,
    attacker,
    target,
    selectedBeforeAttackEffects?.currentActionCostModifications,
  );
  if (failure !== undefined) return { ok: false, error: failure };
  if (target === undefined) throw new Error("Validated attack moves require an active target.");
  const passiveContext = {
    self: attacker,
    opponent: target,
    turnNumber: state.turnNumber,
    completedTurnCount: state.turnNumber - 1,
    moves: new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate])),
    moveActivationCounts: moveActivationCounts(state),
    successfulHitCount: 0,
    actionHistory: state.actionHistory,
    activeEffects: state.activeEffects,
    mode: state.mode,
  };
  const classification = classifyCurrentActionMove(move, passiveContext);
  const classifiedMove = classification.move;
  const passiveEffects = moveEffectsForTrigger(classifiedMove, "passive", passiveContext);
  const preventsBlock = passiveEffects.resolutionPreventions.some(
    (effect: ResolutionPreventionApplication) =>
      effect.target === "self" && effect.prevention === "block",
  );
  const blockableAttack = moveAttackDetails(classifiedMove, classification.addedTags);
  if (blockableAttack === undefined) throw new Error("A blockable move requires attack mechanics.");
  if (enabledOptionalEffectIndices === undefined) {
    const pendingChoice = pendingAttackEffectChoice({
      state,
      decision,
      target,
      move: classifiedMove,
      resolvedOptionalEffectIndices,
      dependencies,
    });
    if (pendingChoice !== undefined) return pendingChoice;
  }
  if (shouldRequestMoveDefense(state, target, classifiedMove, blockableAttack, requestDefense)) {
    return requestAttackDefense({
      state,
      decision,
      target,
      attack: { type: "move", moveId: move.id },
      blockableAttack,
      preventBlock: preventsBlock,
      enabledOptionalEffectIndices,
      resolvedOptionalEffectIndices,
      dependencies,
    });
  }
  return completeConvertedAttackMove({
    state,
    decision,
    move: classifiedMove,
    dependencies,
    attacker,
    target,
    blockedDice,
    blockUsage,
    defenseItemUse,
    defenseResultModifier,
    includeRollEvents,
    naturalRolls,
    resultOverrides,
    numericResultOverrides,
    enabledOptionalEffectIndices,
    resolvedOptionalEffectIndices,
    enabledAfterDefenseEffectIndices,
    ...(selectedNumericValues === undefined ? {} : { selectedNumericValues }),
  });
};

const basicAttackTargetAfterResolution = (
  target: ActiveFightState["combatants"][CombatantId],
  resolution: AttackResolution,
  defenseItemUse: DefenseItemUse | undefined,
) => {
  const targetAfterDefenseItem = targetAfterDefenseItemUse(target, defenseItemUse);
  return resolution.outcome === "successful"
    ? {
        ...targetAfterDefenseItem,
        hitPoints: { ...target.hitPoints, current: resolution.remainingHitPoints },
        status: resolution.defeated ? ("defeated" as const) : target.status,
      }
    : targetAfterDefenseItem;
};

const completedBasicAttackResolution = (
  state: ActiveFightState,
  decision: BasicAttackDecision,
  attacker: CombatantState,
  target: CombatantState,
  options: BasicAttackResolutionOptions,
  dependencies: CombatDependencies,
) => {
  const basicDamage = damageAfterStatusPenalties(
    state,
    attacker,
    applyActiveDamageModifiers(
      state,
      attacker.id,
      applyActiveConstantDamageModifiers(
        state,
        attacker.id,
        target.id,
        Math.round(
          (attacker.stats.power * GLOBAL_RULES.combat.basicAttackPowerDamagePercent) / 100,
        ),
        undefined,
      ),
    ),
  );
  const resolution = resolveAttack({
    attacker,
    target,
    dependencies,
    attackSides:
      GLOBAL_RULES.combat.standardDieSides +
      activeRollModifier(state, attacker.id, "attack", "sides"),
    defenseSides:
      GLOBAL_RULES.combat.standardDieSides +
      activeRollModifier(state, target.id, "defense", "sides"),
    baseDamage: basicDamage,
    attackResultModifier: activeRollModifier(state, attacker.id, "attack", "result"),
    defenseResultModifier:
      (options.defenseResultModifier ?? 0) +
      activeRollModifier(state, target.id, "defense", "result"),
    resolutionThresholds: activeResolutionThresholds(state, attacker.id, target.id),
    preventCritical: combatResultPreventedForBasicAttack(state, attacker.id, "critical"),
    preventCounter: combatResultPreventedForBasicAttack(state, target.id, "counter"),
    naturalRolls: options.naturalRolls,
    resultOverrides: options.resultOverrides,
    numericResultOverrides: options.numericResultOverrides,
  });
  const currentAction = actionRecordWithAttackResult(state, decision, {
    outcome: resolution.outcome,
    critical: resolution.critical,
    counter: resolution.counter,
    damageDealt: resolution.damage,
    attackRollResult: resolution.attackResult,
    defenseRollResult: resolution.defenseResult,
  });
  const responseModifications =
    resolution.outcome === "successful"
      ? defensiveOnDamageModifications(
          state,
          attacker,
          target,
          undefined,
          {
            self: attacker,
            opponent: target,
            turnNumber: state.turnNumber,
            completedTurnCount: state.turnNumber - 1,
            moves: new Map(MOVE_DEFINITIONS.map((move) => [move.id, move])),
            moveActivationCounts: moveActivationCounts(state),
            successfulHitCount: 1,
            actionHistory: state.actionHistory,
            activeEffects: state.activeEffects,
            currentAction:
              currentAction.type === "basic-attack" || currentAction.type === "use-move"
                ? currentAction
                : undefined,
            rolls: [
              {
                attackNaturalResult: resolution.attackNaturalResult,
                attackResult: resolution.attackResult,
                defenseNaturalResult: resolution.defenseNaturalResult,
                defenseResult: resolution.defenseResult,
                outcome: resolution.outcome,
              },
            ],
            mode: state.mode,
          },
          resolution.damage,
        )
      : [];
  const adjustedDamage = Math.min(
    target.hitPoints.current,
    applyDamageModifications(resolution.damage, responseModifications),
  );
  const adjustedResolution = {
    ...resolution,
    damage: adjustedDamage,
    remainingHitPoints: target.hitPoints.current - adjustedDamage,
    defeated: resolution.outcome === "successful" && adjustedDamage >= target.hitPoints.current,
  };
  const counterAttackCount = consecutiveCounterAttackCount(state) + 1;
  const counterChainLimitReached =
    adjustedResolution.counter &&
    state.phase === "counter" &&
    !canContinueCounterChain(counterAttackCount);
  const counterContinues = adjustedResolution.counter && !counterChainLimitReached;
  const targetAfterAttack = basicAttackTargetAfterResolution(
    target,
    adjustedResolution,
    options.defenseItemUse,
  );
  const combatants =
    resolution.outcome === "successful" || options.defenseItemUse !== undefined
      ? { ...state.combatants, [target.id]: targetAfterAttack }
      : state.combatants;
  return {
    combatants,
    counterChainLimitReached,
    counterContinues,
    resolution: adjustedResolution,
  };
};

const resolveBasicAttack = (
  state: ActiveFightState,
  decision: BasicAttackDecision,
  dependencies: CombatDependencies,
  requestDefense = true,
  {
    defenseItemUse,
    defenseResultModifier,
    includeRollEvents,
    naturalRolls,
    resultOverrides,
    numericResultOverrides,
  }: BasicAttackResolutionOptions = {},
): CombatResult<CombatTransition> => {
  const attacker = state.combatants[decision.actorId];
  const target = activeOpponent(state, attacker.id, decision.targetCombatantId);
  if (target === undefined) {
    return {
      ok: false,
      error: { type: "invalid-target", targetCombatantId: decision.targetCombatantId },
    };
  }
  const blockableAttack = { ...basicAttackDetails(decision.basicAttack), restricted: false };
  if (
    requestDefense &&
    (legalBlockMoves(state, target.id, blockableAttack).length > 0 ||
      availablePreRollDefenseItems(target).length > 0 ||
      hasPostDefenseReaction(state, target.id))
  ) {
    return requestAttackDefense({
      state,
      decision,
      target,
      attack: { type: "basic-attack", basicAttack: decision.basicAttack },
      blockableAttack,
      dependencies,
    });
  }

  const {
    combatants: nextCombatants,
    counterChainLimitReached,
    counterContinues,
    resolution,
  } = completedBasicAttackResolution(
    state,
    decision,
    attacker,
    target,
    {
      defenseItemUse,
      defenseResultModifier,
      naturalRolls,
      resultOverrides,
      numericResultOverrides,
    },
    dependencies,
  );
  const events = createBasicAttackEvents(state, decision, dependencies, {
    attacker,
    target,
    resolution,
    counterContinues,
    counterChainLimitReached,
    ...(defenseItemUse === undefined ? {} : { defenseItemUse }),
    ...(includeRollEvents === undefined ? {} : { includeRollEvents }),
  });
  const nextEventSequence = state.eventSequence + events.length;
  const nextState = createBasicAttackState(state, decision, dependencies, {
    actionHistory: [
      ...state.actionHistory,
      actionRecordWithAttackResult(state, decision, {
        outcome: resolution.outcome,
        critical: resolution.critical,
        counter: resolution.counter,
        damageDealt: resolution.damage,
        attackRollResult: resolution.attackResult,
        defenseRollResult: resolution.defenseResult,
      }),
      ...(defenseItemUse === undefined
        ? []
        : [
            {
              type: "use-item" as const,
              decisionId: defenseItemUse.response.id,
              actorId: target.id,
              itemId: defenseItemUse.item.id,
              turnNumber: state.turnNumber,
              phase: state.phase === "counter" ? ("counter" as const) : ("action" as const),
            },
          ]),
    ],
    attacker,
    target,
    combatants: nextCombatants,
    defeated: resolution.defeated,
    counterContinues,
    eventSequence: nextEventSequence,
    resolution,
  });
  return transitionFrom(nextState, events);
};

const createBasicAttackState = (
  state: ActiveFightState,
  decision: BasicAttackDecision,
  dependencies: CombatDependencies,
  {
    actionHistory,
    attacker,
    target,
    combatants,
    defeated,
    counterContinues,
    eventSequence,
    resolution,
  }: BasicAttackStateContext,
): ActiveFightState | CompletedFightState =>
  defeated
    ? {
        id: state.id,
        version: state.version + 1,
        rulesVersion: state.rulesVersion,
        mode: state.mode,
        turnNumber: state.turnNumber,
        combatants,
        activeEffects: [],
        actionHistory,
        resolutionFrames: [],
        eventSequence,
        status: "completed",
        completion: { type: "defeat", winnerCombatantId: attacker.id },
      }
    : (() => {
        const nextActiveCombatantId =
          counterContinues || state.phase === "counter" ? target.id : state.activeCombatantId;
        return {
          ...state,
          version: state.version + 1,
          phase: counterContinues ? "counter" : "end",
          // A counter is still part of the original actor's turn. Once the
          // counter chain ends, leave that original actor active at End so the
          // normal phase advance hands the next turn to the countering defender.
          activeCombatantId: nextActiveCombatantId,
          combatants,
          activeEffects: effectsAfterAttackResolution(state, {
            attackerId: attacker.id,
            defenderId: target.id,
            turnNumber: state.turnNumber,
            outcome: resolution.outcome,
            rolls: [resolution],
            basicAttack: decision.basicAttack,
          }),
          actionHistory,
          resolutionFrames: counterContinues
            ? [
                {
                  id: dependencies.ids.nextResolutionFrameId(),
                  type: "attack" as const,
                  decisionId: decision.id,
                  attackerId: attacker.id,
                  targetCombatantId: target.id,
                  returnPhase: state.phase === "counter" ? "counter" : "action",
                  stage: "awaiting-counter" as const,
                },
              ]
            : [],
          eventSequence,
        };
      })();

const actionDecisionForMove = (
  combatantId: CombatantId,
  targetCombatantId: CombatantId,
  moveId: MoveDefinition["id"],
): LegalDecision => ({ type: "use-move", actorId: combatantId, moveId, targetCombatantId });

const availableExtraActionsFor = (state: ActiveFightState, combatantId: CombatantId) =>
  state.activeEffects.filter(
    (effect): effect is Extract<ActiveCombatEffect, { readonly type: "extra-action" }> =>
      effect.type === "extra-action" &&
      effect.targetCombatantId === combatantId &&
      effect.phase === "action" &&
      effect.remainingActions > 0 &&
      state.turnNumber >= effect.availableFromTurn &&
      state.turnNumber <= effect.expiresAfterTurn,
  );

const availableExtraActionFor = (state: ActiveFightState, combatantId: CombatantId) =>
  availableExtraActionsFor(state, combatantId).at(0);

const extraActionMatchesDecision = (
  allowance: Extract<ActiveCombatEffect, { readonly type: "extra-action" }>,
  decision: LegalDecision | ResolvedActionDecision,
) => {
  if (decision.type === "use-item") return allowance.moveCategory === "item-use";
  if (decision.type === "power-up") return allowance.moveCategory === "power-up";
  if (decision.type !== "use-move") return false;
  const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === decision.moveId);
  if (move === undefined) return false;
  if (allowance.sourceMoveOnly) return move.id === allowance.sourceDefinitionId;
  if (allowance.moveCategory !== undefined && move.category !== allowance.moveCategory)
    return false;
  return allowance.constant === undefined || allowance.constant === isConstantSkill(move);
};

const consumeExtraActionForDecision = (
  state: ActiveFightState,
  decision: ResolvedActionDecision,
) => {
  const allowance = availableExtraActionsFor(state, decision.actorId).find((candidate) =>
    extraActionMatchesDecision(candidate, decision),
  );
  if (allowance === undefined) return state.activeEffects;
  return state.activeEffects.flatMap((effect) => {
    if (effect.id !== allowance.id) return [effect];
    if (effect.type !== "extra-action") return [effect];
    return effect.remainingActions <= 1
      ? []
      : [{ ...effect, remainingActions: effect.remainingActions - 1 }];
  });
};

const hasAvailableExtraAction = (state: ActiveFightState, combatantId: CombatantId) =>
  availableExtraActionFor(state, combatantId) !== undefined;

const legalDecisionsForCombatantMoves = (
  state: ActiveFightState,
  combatantId: CombatantId,
  opponentId: CombatantId,
) => {
  const activeCombatant = state.combatants[combatantId];
  const usableItems: LegalDecision[] = (activeCombatant.itemIds ?? []).flatMap((itemId) => {
    const item = ITEM_DEFINITIONS.find((candidate) => candidate.id === itemId);
    const exhausted =
      item?.maxUses !== undefined && (activeCombatant.itemUses?.[itemId] ?? 0) >= item.maxUses;
    return item !== undefined && isCombatUsableItem(item) && !exhausted
      ? [{ type: "use-item" as const, actorId: combatantId, itemId }]
      : [];
  });
  const moveAttacks: LegalDecision[] = activeCombatant.moveIds.flatMap((moveId) => {
    const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === moveId);
    const isLiteralAttack =
      move?.mechanics.attack?.baseDamagePercent?.type === "literal" &&
      move.mechanics.kiCost?.type === "literal";
    const signatureUnavailable =
      move?.category === "signature" && !isSignatureTurnAvailable(state.turnNumber);
    if (!isLiteralAttack || signatureUnavailable) return [];
    const useLimit = effectiveRestrictedMoveUseLimit(state, activeCombatant, move);
    if (useLimit !== undefined && (activeCombatant.moveUses[move.id] ?? 0) >= useLimit) return [];
    return [actionDecisionForMove(combatantId, opponentId, moveId)];
  });
  const actionMoves: LegalDecision[] = activeCombatant.moveIds.flatMap((moveId) => {
    const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === moveId);
    const useLimit =
      move === undefined ? undefined : effectiveMoveUseLimit(state, activeCombatant, move);
    return move !== undefined &&
      isSimpleActionMove(move) &&
      (useLimit === undefined || (activeCombatant.moveUses[move.id] ?? 0) < useLimit)
      ? [actionDecisionForMove(combatantId, opponentId, moveId)]
      : [];
  });
  const constantSkills: LegalDecision[] = activeCombatant.moveIds.flatMap((moveId) => {
    const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === moveId);
    return move !== undefined &&
      isConstantSkill(move) &&
      move.mechanics.kiCost?.type === "literal" &&
      !hasActiveConstant(state, combatantId, move.id) &&
      isRestrictedUseAvailable(
        activeCombatant.moveUses[move.id] ?? 0,
        effectiveRestrictedMoveUseLimit(state, activeCombatant, move),
      )
      ? [actionDecisionForMove(combatantId, opponentId, moveId)]
      : [];
  });

  const attacks: LegalDecision[] = [
    {
      type: "basic-attack",
      actorId: combatantId,
      basicAttack: "basic-punch",
      targetCombatantId: opponentId,
    },
    ...moveAttacks,
    ...(state.phase === "action" ? actionMoves : []),
    ...(state.phase === "action" ? constantSkills : []),
    {
      type: "basic-attack",
      actorId: combatantId,
      basicAttack: "basic-kick",
      targetCombatantId: opponentId,
    },
    {
      type: "basic-attack",
      actorId: combatantId,
      basicAttack: "basic-ki-blast",
      targetCombatantId: opponentId,
    },
  ];
  return { activeCombatant, attacks, usableItems };
};

const baseLegalDecisions = (
  state: ActiveFightState,
  combatantId: CombatantId,
  opponentId: CombatantId,
) => {
  const { activeCombatant, attacks, usableItems } = legalDecisionsForCombatantMoves(
    state,
    combatantId,
    opponentId,
  );
  return [
    ...(state.phase === "action" ? usableItems : []),
    ...attacks,
    ...(state.phase === "action" && activeCombatant.transformation === undefined
      ? (activeCombatant.transformationIds ?? []).map((transformationId) => ({
          type: "activate-transformation" as const,
          actorId: combatantId,
          transformationId,
        }))
      : []),
    ...(state.phase === "action"
      ? ([
          { type: "pass", actorId: combatantId },
          { type: "power-up", actorId: combatantId },
        ] as const)
      : []),
    { type: "surrender", actorId: combatantId },
  ] satisfies readonly LegalDecision[];
};

const unlockedLegalDecisions = (
  state: ActiveFightState,
  combatantId: CombatantId,
  decisions: readonly LegalDecision[],
) =>
  decisions.filter((decision) => {
    const blockedByRestriction = state.activeEffects.some((effect) => {
      if (
        effect.type !== "action-restriction" ||
        effect.targetCombatantId !== combatantId ||
        state.turnNumber < effect.availableFromTurn
      )
        return false;
      if (effect.blockedCategories === undefined) return true;
      if (decision.type === "basic-attack")
        return effect.blockedCategories.includes("basic-attack");
      if (decision.type !== "use-move") return false;
      const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === decision.moveId);
      return (
        move !== undefined &&
        (move.category === "advanced-attack" || move.category === "signature") &&
        effect.blockedCategories.includes(move.category)
      );
    });
    if (blockedByRestriction) return false;
    if (actionLockFor(state, combatantId, decision) !== undefined) return false;
    if (decision.type !== "use-move") return true;
    const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === decision.moveId);
    return (
      move !== undefined &&
      moveUsePreventionFor(state, combatantId, move, isConstantSkill(move) ? "activate" : "use") ===
        undefined
    );
  });

/** Returns every currently supported player decision for the requested combatant. */
export const enumerateLegalDecisions = (
  state: CombatTransition["state"],
  combatantId: CombatantId,
): readonly LegalDecision[] => {
  if (
    state.status !== "active" ||
    (state.phase !== "action" && state.phase !== "counter") ||
    state.pendingDecision !== undefined ||
    state.activeCombatantId !== combatantId
  )
    return [];
  const opponentId = nextActiveCombatantId(state);
  if (opponentId === undefined) return [];
  const unlockedDecisions = unlockedLegalDecisions(
    state,
    combatantId,
    baseLegalDecisions(state, combatantId, opponentId),
  );
  const force = forcedActionFor(state, combatantId);
  const extraAction = availableExtraActionFor(state, combatantId);
  const extraActionDecisions =
    extraAction === undefined
      ? unlockedDecisions
      : unlockedDecisions.filter((decision) =>
          availableExtraActionsFor(state, combatantId).some((candidate) =>
            extraActionMatchesDecision(candidate, decision),
          ),
        );
  return force === undefined
    ? extraActionDecisions
    : extraActionDecisions.filter((decision) => satisfiesForcedAction(force, decision));
};

const advanceUpkeepFight = (
  state: ActiveFightState,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> => {
  const activeCombatant = state.combatants[state.activeCombatantId];
  const turnStartChecks = effectsAfterTurnStartChecks(state, activeCombatant.id, dependencies);
  const upkeepState: ActiveFightState = {
    ...state,
    activeEffects: turnStartChecks.effects,
    eventSequence: state.eventSequence + turnStartChecks.events.length,
  };
  const upkeepTriggered = upkeepTriggeredEffects(upkeepState, activeCombatant.id);
  const storedUpkeep = upkeepEffectsAfterStoredRolls(upkeepState, upkeepTriggered, dependencies);
  const upkeepStateWithStoredRolls: ActiveFightState = {
    ...upkeepState,
    combatants: storedUpkeep.combatants,
  };
  const upkeepCombatants = combatantsAfterUpkeepEffects(
    upkeepStateWithStoredRolls,
    storedUpkeep.triggered,
  );
  const upkeepStateAfterEffects: ActiveFightState = {
    ...upkeepState,
    combatants: upkeepCombatants,
  };
  const upkeepActivatedEffects = activeEffectsFromTriggered(
    upkeepStateAfterEffects,
    storedUpkeep.triggered,
    dependencies,
  );
  const upkeepStateWithEffects: ActiveFightState = {
    ...upkeepStateAfterEffects,
    activeEffects: [...upkeepState.activeEffects, ...upkeepActivatedEffects],
  };
  const startTriggered =
    state.turnNumber === 1 ? startCombatTriggeredEffects(upkeepStateWithEffects) : [];
  const startCombatants = combatantsAfterStartCombatResources(
    upkeepStateWithEffects,
    startTriggered,
  );
  const startActivatedEffects = activeEffectsFromTriggered(
    upkeepStateWithEffects,
    startTriggered,
    dependencies,
  );
  const upkeepRollEvents = storedUpkeep.resolvedRolls.flatMap(({ combatantId, roll }, index) =>
    storedRollEvents(upkeepState, combatantId, [roll], dependencies, index),
  );
  const upkeepEvents = startCombatEvents(
    upkeepStateWithStoredRolls,
    upkeepCombatants,
    upkeepActivatedEffects,
    dependencies,
    upkeepRollEvents.length,
  );
  const startEvents = startCombatEvents(
    { ...upkeepState, combatants: upkeepCombatants },
    startCombatants,
    startActivatedEffects,
    dependencies,
    upkeepRollEvents.length + upkeepEvents.length,
  );
  const events = [...turnStartChecks.events, ...upkeepRollEvents, ...upkeepEvents, ...startEvents];
  const activeEffects = [...upkeepStateWithEffects.activeEffects, ...startActivatedEffects];
  const combatants = { ...upkeepStateWithEffects.combatants, ...startCombatants };
  const actionBlockingStatus = upkeepCombatants[activeCombatant.id].activeStatuses.find(
    (status) =>
      (status.statusId === "stun" || status.statusId === "petrified") &&
      status.duration.type === "turns" &&
      status.duration.ownerCombatantId === activeCombatant.id,
  );
  const actionBlockingEffect = activeEffects.find(
    (effect) =>
      effect.type === "action-restriction" &&
      effect.targetCombatantId === activeCombatant.id &&
      effect.blockedCategories === undefined &&
      state.turnNumber >= effect.availableFromTurn,
  );
  if (actionBlockingStatus !== undefined || actionBlockingEffect !== undefined) {
    const actionSkipped: CombatEvent = {
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + events.length + 1,
      fightId: state.id,
      type: "action-skipped",
      combatantId: activeCombatant.id,
      reason: actionBlockingStatus === undefined ? "effect" : "status",
    };
    const nextState: ActiveFightState = {
      ...state,
      version: state.version + 1,
      phase: "end",
      combatants,
      activeEffects,
      eventSequence: state.eventSequence + events.length + 2,
    };
    return transitionFrom(nextState, [
      ...events,
      actionSkipped,
      createPhaseChangedEvent(state, dependencies, "end", nextState.eventSequence),
    ]);
  }
  const nextState: ActiveFightState = {
    ...state,
    version: state.version + 1,
    phase: "action",
    combatants,
    activeEffects,
    eventSequence: state.eventSequence + events.length + 1,
  };
  return transitionFrom(nextState, [
    ...events,
    createPhaseChangedEvent(state, dependencies, "action", nextState.eventSequence),
  ]);
};

const stateAtNextUpkeep = (
  state: ActiveFightState,
  scheduledEnd: ScheduledResourceBoundaryResult,
  nextCombatantId: CombatantId,
): ActiveFightState => ({
  ...state,
  version: state.version + 1,
  turnNumber: state.turnNumber + 1,
  phase: "upkeep",
  activeCombatantId: nextCombatantId,
  combatants: {
    ...scheduledEnd.combatants,
    [state.activeCombatantId]: {
      ...scheduledEnd.combatants[state.activeCombatantId],
      activeStatuses: statusesAfterOwnerTurn(scheduledEnd.combatants[state.activeCombatantId]),
    },
  },
  activeEffects: effectsAfterOwnerTurn(
    { ...state, combatants: scheduledEnd.combatants, activeEffects: scheduledEnd.activeEffects },
    state.activeCombatantId,
  ),
  eventSequence: state.eventSequence + scheduledEnd.events.length + 2,
});

const advanceEndFight = (
  state: ActiveFightState,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> => {
  const scheduledEnd = scheduledResourceBoundary(
    state,
    { type: "turn-end", combatantId: state.activeCombatantId },
    dependencies,
  );
  if (scheduledEnd.defeatedCombatantId !== undefined)
    return transitionFrom(
      completedStateAfterScheduledBoundary(state, scheduledEnd),
      scheduledEnd.events,
    );
  const nextCombatantId = nextActiveCombatantId(state);
  if (nextCombatantId === undefined) return { ok: false, error: invalidFightState(state) };
  const nextStateBeforeSchedule = stateAtNextUpkeep(state, scheduledEnd, nextCombatantId);
  const phaseChanged = createPhaseChangedEvent(
    { ...state, eventSequence: state.eventSequence + scheduledEnd.events.length },
    dependencies,
    "upkeep",
    state.eventSequence + scheduledEnd.events.length + 1,
  );
  const turnStarted: CombatEvent = {
    id: dependencies.ids.nextEventId(),
    sequence: nextStateBeforeSchedule.eventSequence,
    fightId: state.id,
    type: "turn-started",
    combatantId: nextCombatantId,
    turnNumber: nextStateBeforeSchedule.turnNumber,
  };
  const scheduledStart = scheduledResourceBoundary(
    nextStateBeforeSchedule,
    { type: "turn-start", combatantId: nextCombatantId },
    dependencies,
  );
  const eventsThroughTurnStart = [
    ...scheduledEnd.events,
    phaseChanged,
    turnStarted,
    ...scheduledStart.events,
  ];
  if (scheduledStart.defeatedCombatantId !== undefined)
    return transitionFrom(
      completedStateAfterScheduledBoundary(
        nextStateBeforeSchedule,
        scheduledStart,
        nextStateBeforeSchedule.version,
      ),
      eventsThroughTurnStart,
    );
  const afterTurnStart: ActiveFightState = {
    ...nextStateBeforeSchedule,
    combatants: scheduledStart.combatants,
    activeEffects: scheduledStart.activeEffects,
    eventSequence: nextStateBeforeSchedule.eventSequence + scheduledStart.events.length,
  };
  const scheduledUpkeep = scheduledResourceBoundary(
    afterTurnStart,
    { type: "phase-start", combatantId: nextCombatantId, phase: "upkeep" },
    dependencies,
  );
  const events = [...eventsThroughTurnStart, ...scheduledUpkeep.events];
  if (scheduledUpkeep.defeatedCombatantId !== undefined)
    return transitionFrom(
      completedStateAfterScheduledBoundary(afterTurnStart, scheduledUpkeep, afterTurnStart.version),
      events,
    );
  const nextState: ActiveFightState = {
    ...afterTurnStart,
    combatants: scheduledUpkeep.combatants,
    activeEffects: scheduledUpkeep.activeEffects,
    eventSequence: afterTurnStart.eventSequence + scheduledUpkeep.events.length,
  };
  return transitionFrom(nextState, events);
};

/**
 * Resolves a non-interactive phase boundary. Upkeep has no supported actions in
 * this slice, and an empty end phase hands the turn to the other combatant.
 */
export const advanceFight = (
  state: CombatTransition["state"],
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> => {
  const invalidState = currentStateFailure(state);
  if (invalidState !== undefined) return { ok: false, error: invalidState };
  if (state.status === "completed") {
    return {
      ok: false,
      error: { type: "wrong-phase", expected: ["upkeep", "end"], actual: "completed" },
    };
  }
  if (state.pendingDecision !== undefined) {
    return {
      ok: false,
      error: { type: "unsupported-mechanic", mechanic: "pending decision resolution" },
    };
  }

  if (state.phase === "upkeep") return advanceUpkeepFight(state, dependencies);
  if (state.phase === "end") return advanceEndFight(state, dependencies);

  return {
    ok: false,
    error: { type: "wrong-phase", expected: ["upkeep", "end"], actual: state.phase },
  };
};

const simpleActionActivatedEffects = (
  state: ActiveFightState,
  effects: ReturnType<typeof moveEffectsForTrigger>,
  actor: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  move: MoveDefinition,
  createdOnTurn: number,
  dependencies: CombatDependencies,
) => {
  const suppressions = effects.suppressions.map((suppression) =>
    activeSuppressionFromApplication(suppression, actor.id, target.id, move.id, dependencies),
  );
  const forcedActions = effects.forcedActions.map((force) => ({
    id: dependencies.ids.nextActiveEffectId(),
    type: "force-next-action" as const,
    sourceCombatantId: actor.id,
    targetCombatantId: force.target === "self" ? actor.id : target.id,
    sourceDefinitionId: move.id,
    allowedCategories: force.allowedCategories,
    ...(force.allowedTags === undefined ? {} : { allowedTags: force.allowedTags }),
    allowPass: force.allowPass,
    ...(force.fallback === undefined ? {} : { fallback: force.fallback }),
  }));
  const locks = effects.locks.map((lock) =>
    activeLockFromApplication(lock, actor.id, target.id, move.id, dependencies),
  );
  const moveUsePreventions = effects.moveUsePreventions.map((prevention) =>
    activeMoveUsePreventionFromApplication(prevention, actor.id, target.id, move.id, dependencies),
  );
  const statusPreventions = effects.statusPreventions.map((prevention) =>
    activeStatusPreventionFromApplication(prevention, actor.id, target.id, move.id, dependencies),
  );
  const combatResultPreventions = effects.combatResultPreventions.map((prevention) =>
    activeCombatResultPreventionFromApplication(
      prevention,
      actor.id,
      target.id,
      move.id,
      dependencies,
    ),
  );
  const rollModificationPreventions = effects.rollModificationPreventions.map((prevention) =>
    activeRollModificationPreventionFromApplication(
      prevention,
      actor.id,
      target.id,
      move.id,
      dependencies,
    ),
  );
  const moveModificationPreventions = effects.moveModificationPreventions.map((prevention) =>
    activeMoveModificationPreventionFromApplication(
      prevention,
      actor.id,
      target.id,
      move.id,
      dependencies,
    ),
  );
  const floatingEffects = activeFloatingEffectsFromApplications(
    effects.floatingEffects,
    actor.id,
    target.id,
    move.id,
    createdOnTurn,
    dependencies,
  );
  const extraActions = activeExtraActionsFromApplications(
    state,
    effects.extraActions,
    actor.id,
    target.id,
    move.id,
    createdOnTurn,
    dependencies,
  );
  const actionRestrictions = activeActionRestrictionsFromApplications(
    state,
    effects.actionRestrictions,
    actor.id,
    target.id,
    move.id,
    createdOnTurn,
    dependencies,
  );
  const scheduledResources = activeScheduledResourcesFromApplications(
    state,
    effects.scheduledResources,
    actor.id,
    target.id,
    move.id,
    dependencies,
  );
  const statModifiers = activeStatModifiersFromApplications(
    effects.statModifications,
    actor.id,
    target.id,
    move.id,
    dependencies,
  );
  const rerolls = activeRerollsFromApplications(effects.rerolls, actor.id, target.id, dependencies);
  return [
    ...suppressions,
    ...forcedActions,
    ...locks,
    ...moveUsePreventions,
    ...statusPreventions,
    ...combatResultPreventions,
    ...rollModificationPreventions,
    ...moveModificationPreventions,
    ...statModifiers,
    ...floatingEffects,
    ...extraActions,
    ...actionRestrictions,
    ...scheduledResources,
    ...rerolls,
  ];
};

const resolveSimpleActionMove = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  move: MoveDefinition,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> => {
  const actor = state.combatants[decision.actorId];
  const target = activeOpponent(state, actor.id, decision.targetCombatantId);
  const cost = move.mechanics.kiCost;
  if (target === undefined)
    return {
      ok: false,
      error: { type: "invalid-target", targetCombatantId: decision.targetCombatantId },
    };
  if (!isSimpleActionMove(move) || cost?.type !== "literal") {
    return {
      ok: false,
      error: { type: "unsupported-mechanic", mechanic: `move resolution: ${move.id}` },
    };
  }
  const limit = effectiveMoveUseLimit(state, actor, move);
  if (limit !== undefined && (actor.moveUses[move.id] ?? 0) >= limit) {
    return { ok: false, error: { type: "restricted-use-exhausted", moveId: move.id } };
  }
  if (actor.ki.current < cost.value) {
    return {
      ok: false,
      error: { type: "insufficient-ki", required: cost.value, available: actor.ki.current },
    };
  }
  const moves = new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate]));
  const effectContext = {
    self: actor,
    opponent: target,
    turnNumber: state.turnNumber,
    completedTurnCount: state.turnNumber - 1,
    moves,
    moveActivationCounts: moveActivationCounts(state),
    successfulHitCount: 0,
    actionHistory: state.actionHistory,
    activeEffects: state.activeEffects,
    includeActiveFloatingEffects: true,
  } satisfies Parameters<typeof moveEffectsForTrigger>[2];
  const actionPhaseEffects = moveEffectsForTrigger(move, "action-phase", effectContext);
  const storedRollResolution = combatantAfterStoredRollRequests(
    actor,
    actionPhaseEffects.storedRollRequests,
    state.turnNumber,
    dependencies,
  );
  const actorWithStoredRolls = storedRollResolution.combatant;
  const onRollResultEffects =
    storedRollResolution.resolved.length === 0
      ? mergeMoveEffects()
      : moveEffectsForTrigger(move, "on-roll-result", {
          ...effectContext,
          self: actorWithStoredRolls,
        });
  const effects = mergeMoveEffects(actionPhaseEffects, onRollResultEffects);
  const moveUseTriggered = moveUseTriggeredEffects(state, actorWithStoredRolls, target, move);
  const resourceTriggered = resourceEventTriggeredEffects(
    state,
    actorWithStoredRolls,
    target,
    effects.resources,
    [...state.actionHistory, actionRecordFor(state, decision)],
  );
  const resolvedEffects = mergeMoveEffects(
    effects,
    ...moveUseTriggered.map(({ owner, effects: eventEffects }) =>
      effectsRelativeToActionActor(eventEffects, owner.id, actor.id),
    ),
    ...resourceTriggered.map(({ effects: triggeredEffects }) => triggeredEffects),
  );
  const negatedActiveEffects = state.activeEffects.filter((effect) =>
    resolvedEffects.negations.some((negation) => {
      const targetId = negation.target === "self" ? actor.id : target.id;
      if (effect.targetCombatantId !== targetId) return false;
      const preventsAllAttacks =
        effect.type === "action-restriction" &&
        (effect.blockedCategories === undefined ||
          (effect.blockedCategories.includes("basic-attack") &&
            effect.blockedCategories.includes("advanced-attack") &&
            effect.blockedCategories.includes("signature")));
      return (
        negation.aspects.includes("prevent-attack") &&
        ((effect.type === "action-lock" && effect.affectedType === "attack") || preventsAllAttacks)
      );
    }),
  );
  const negatedActiveEffectIds = new Set(negatedActiveEffects.map((effect) => effect.id));
  const actorAfter = statusesAfterApplications(
    resourceAfterChanges(
      {
        ...actorWithStoredRolls,
        ki: { ...actor.ki, current: actor.ki.current - cost.value },
        moveUses: { ...actor.moveUses, [move.id]: (actor.moveUses[move.id] ?? 0) + 1 },
      },
      resolvedEffects.resources,
      "self",
      state.activeEffects,
      actionRecordFor(state, decision),
    ),
    resolvedEffects.statuses,
    "self",
  );
  const targetAfter = statusesAfterApplications(
    resourceAfterChanges(
      target,
      resolvedEffects.resources,
      "opponent",
      state.activeEffects,
      actionRecordFor(state, decision),
    ),
    resolvedEffects.statuses,
    "opponent",
  );
  const modifiers = actionMoveModifiers(move, actorWithStoredRolls, target, state, dependencies);
  const activatedEffects = [
    ...simpleActionActivatedEffects(
      state,
      effects,
      actor,
      target,
      move,
      state.turnNumber,
      dependencies,
    ),
    ...moveUseTriggered.flatMap(
      ({ sourceMove, owner, target: eventTarget, effects: eventEffects }) =>
        simpleActionActivatedEffects(
          state,
          eventEffects,
          owner,
          eventTarget,
          sourceMove,
          state.turnNumber,
          dependencies,
        ),
    ),
    ...resourceTriggered.flatMap(
      ({ sourceMove, owner, target: eventTarget, effects: eventEffects }) =>
        simpleActionActivatedEffects(
          state,
          eventEffects,
          owner,
          eventTarget,
          sourceMove,
          state.turnNumber,
          dependencies,
        ),
    ),
  ];
  const events = simpleActionMoveEvents(state, decision, dependencies, {
    activatedEffects,
    negatedEffects: negatedActiveEffects,
    move,
    actor,
    actorAfter,
    storedRolls: storedRollResolution.resolved,
    statusApplications: resolvedEffects.statuses,
    target,
    targetAfter,
  });
  const remainingActiveEffects = state.activeEffects.filter(
    (effect) =>
      !negatedActiveEffectIds.has(effect.id) &&
      (effect.type !== "floating-effect" ||
        !(effect.scope.type === "next-action" && effect.targetCombatantId === actor.id)),
  );
  const consumedExtraActionEffects = consumeExtraActionForDecision(state, decision);
  const nextActiveEffects = [...remainingActiveEffects, ...modifiers, ...activatedEffects].flatMap(
    (effect) => {
      if (effect.type !== "extra-action") return [effect];
      if (!state.activeEffects.some((candidate) => candidate.id === effect.id)) return [effect];
      const consumed = consumedExtraActionEffects.find((candidate) => candidate.id === effect.id);
      return consumed === undefined ? [] : [consumed];
    },
  );
  const continueWithExtraAction =
    state.phase === "action" &&
    hasAvailableExtraAction({ ...state, activeEffects: nextActiveEffects }, actor.id);
  const nextState: ActiveFightState = {
    ...state,
    version: state.version + 1,
    phase: continueWithExtraAction ? "action" : "end",
    activeCombatantId: actor.id,
    combatants: { ...state.combatants, [actor.id]: actorAfter, [target.id]: targetAfter },
    activeEffects: nextActiveEffects,
    actionHistory: [...state.actionHistory, actionRecordFor(state, decision)],
    eventSequence: state.eventSequence + events.length + 1,
  };
  events.push(
    createPhaseChangedEvent(state, dependencies, "end", nextState.eventSequence, decision.id),
  );
  return resolveDeactivations({
    state: nextState,
    applications: resolvedEffects.deactivations,
    sourceCombatantId: actor.id,
    causedByDecisionId: decision.id,
    dependencies,
    priorEvents: events,
  });
};

interface SimpleActionMoveEventContext {
  readonly activatedEffects: readonly ActiveCombatEffect[];
  readonly negatedEffects: readonly ActiveCombatEffect[];
  readonly move: MoveDefinition;
  readonly actor: ActiveFightState["combatants"][CombatantId];
  readonly actorAfter: ActiveFightState["combatants"][CombatantId];
  readonly target: ActiveFightState["combatants"][CombatantId];
  readonly targetAfter: ActiveFightState["combatants"][CombatantId];
  readonly statusApplications: readonly StatusApplication[];
  readonly storedRolls: readonly ResolvedStoredRoll[];
}

const simpleActionMoveEvents = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  dependencies: CombatDependencies,
  {
    activatedEffects,
    negatedEffects,
    actor,
    actorAfter,
    move,
    statusApplications,
    storedRolls,
    target,
    targetAfter,
  }: SimpleActionMoveEventContext,
) => {
  const events: CombatEvent[] = [
    {
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + 1,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "move-used",
      combatantId: actor.id,
      moveId: move.id,
      targetCombatantId: target.id,
    },
    {
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + 2,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "ki-changed",
      combatantId: actor.id,
      amount: actorAfter.ki.current - actor.ki.current,
      remainingKi: actorAfter.ki.current,
    },
  ];
  events.push(
    ...storedRollEvents(state, actor.id, storedRolls, dependencies, events.length, decision.id),
  );
  if (targetAfter.ki.current !== target.ki.current) {
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + events.length + 1,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "ki-changed",
      combatantId: target.id,
      amount: targetAfter.ki.current - target.ki.current,
      remainingKi: targetAfter.ki.current,
    });
  }
  for (const effect of activatedEffects) {
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + events.length + 1,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "effect-activated",
      activeEffectId: effect.id,
      sourceCombatantId: effect.sourceCombatantId,
      targetCombatantId: effect.targetCombatantId,
      sourceDefinitionId: effect.sourceDefinitionId,
    });
  }
  for (const effect of negatedEffects) {
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + events.length + 1,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "effect-negated",
      activeEffectId: effect.id,
      sourceCombatantId: effect.sourceCombatantId,
      targetCombatantId: effect.targetCombatantId,
      sourceDefinitionId: effect.sourceDefinitionId,
    });
  }
  for (const application of statusApplications) {
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + events.length + 1,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "status-applied",
      sourceCombatantId: actor.id,
      targetCombatantId: application.target === "self" ? actor.id : target.id,
      statusId: application.status.statusId,
      stacks: application.status.stacks,
    });
  }
  return events;
};

const constantSkillActivationFailure = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  move: MoveDefinition,
  actor: CombatantState,
  target: CombatantState | undefined,
): CombatFailure | undefined => {
  const cost = move.mechanics.kiCost;
  if (target === undefined)
    return { type: "invalid-target", targetCombatantId: decision.targetCombatantId };
  if (!isConstantSkill(move) || cost?.type !== "literal") {
    return { type: "illegal-decision", decisionType: decision.type };
  }
  if (
    moveUsePreventionFor(state, actor.id, move, "activate") !== undefined ||
    hasActiveConstant(state, actor.id, move.id)
  ) {
    return { type: "illegal-decision", decisionType: decision.type };
  }
  const restrictedUses = effectiveRestrictedMoveUseLimit(state, actor, move);
  if (!isRestrictedUseAvailable(actor.moveUses[move.id] ?? 0, restrictedUses)) {
    return { type: "restricted-use-exhausted", moveId: move.id };
  }
  return actor.ki.current < cost.value
    ? { type: "insufficient-ki", required: cost.value, available: actor.ki.current }
    : undefined;
};

const resolveConstantSkillActivation = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  move: MoveDefinition,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> => {
  const actor = state.combatants[decision.actorId];
  const target = activeOpponent(state, actor.id, decision.targetCombatantId);
  const cost = move.mechanics.kiCost;
  const failure = constantSkillActivationFailure(state, decision, move, actor, target);
  if (failure !== undefined) return { ok: false, error: failure };
  if (target === undefined || cost?.type !== "literal")
    return { ok: false, error: invalidFightState(state) };
  const deactivatedConstant = state.activeEffects.find(
    (effect): effect is Extract<ActiveCombatEffect, { readonly type: "active-constant" }> =>
      effect.type === "active-constant" &&
      effect.lifecycle === "deactivated" &&
      effect.sourceCombatantId === actor.id &&
      effect.sourceDefinitionId === move.id,
  );
  const activeEffectId = deactivatedConstant?.id ?? dependencies.ids.nextActiveEffectId();
  const consumedExtraActionEffects = consumeExtraActionForDecision(state, decision);
  const activeEffectsBeforeConsumption =
    deactivatedConstant === undefined
      ? [
          ...state.activeEffects,
          {
            id: activeEffectId,
            type: "active-constant" as const,
            sourceCombatantId: actor.id,
            targetCombatantId: actor.id,
            sourceDefinitionId: move.id,
            activatedOnTurn: state.turnNumber,
            duration: "combat" as const,
            paidActivationCost: cost.value,
            lifecycle: "active" as const,
          },
        ]
      : state.activeEffects.map((effect) =>
          effect.id === deactivatedConstant.id
            ? { ...effect, lifecycle: "active" as const, deactivatedOnTurn: undefined }
            : effect,
        );
  const activeEffects = activeEffectsBeforeConsumption.flatMap((effect) => {
    if (effect.type !== "extra-action") return [effect];
    if (!state.activeEffects.some((candidate) => candidate.id === effect.id)) return [effect];
    const consumed = consumedExtraActionEffects.find((candidate) => candidate.id === effect.id);
    return consumed === undefined ? [] : [consumed];
  });
  const continueWithExtraAction = hasAvailableExtraAction({ ...state, activeEffects }, actor.id);
  const nextState: ActiveFightState = {
    ...state,
    version: state.version + 1,
    phase: continueWithExtraAction ? "action" : "end",
    activeCombatantId: actor.id,
    activeEffects,
    combatants: {
      ...state.combatants,
      [actor.id]: {
        ...actor,
        ki: { ...actor.ki, current: actor.ki.current - cost.value },
        moveUses: { ...actor.moveUses, [move.id]: (actor.moveUses[move.id] ?? 0) + 1 },
      },
    },
    actionHistory: [...state.actionHistory, actionRecordFor(state, decision)],
    eventSequence: state.eventSequence + 4,
  };
  return transitionFrom(nextState, [
    {
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + 1,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "move-used",
      combatantId: actor.id,
      moveId: move.id,
      targetCombatantId: target.id,
    },
    {
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + 2,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "ki-changed",
      combatantId: actor.id,
      amount: -cost.value,
      remainingKi: actor.ki.current - cost.value,
    },
    {
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + 3,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "effect-activated",
      activeEffectId,
      sourceCombatantId: actor.id,
      targetCombatantId: actor.id,
      sourceDefinitionId: move.id,
    },
    createPhaseChangedEvent(state, dependencies, "end", state.eventSequence + 4, decision.id),
  ]);
};

const resolveMoveDecision = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> => {
  const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === decision.moveId);
  if (move === undefined)
    return { ok: false, error: { type: "unknown-move", moveId: decision.moveId } };
  if (!state.combatants[decision.actorId].moveIds.includes(decision.moveId)) {
    return {
      ok: false,
      error: { type: "move-not-owned", moveId: decision.moveId, combatantId: decision.actorId },
    };
  }
  if (
    !isConstantSkill(move) &&
    moveUsePreventionFor(state, decision.actorId, move, "use") !== undefined
  ) {
    return { ok: false, error: { type: "illegal-decision", decisionType: decision.type } };
  }
  if (isConstantSkill(move))
    return resolveConstantSkillActivation(state, decision, move, dependencies);
  if (isSimpleActionMove(move)) return resolveSimpleActionMove(state, decision, move, dependencies);
  if (move.mechanics.attack !== undefined) {
    return resolveConvertedAttackMove(state, decision, move, dependencies);
  }
  return {
    ok: false,
    error: { type: "unsupported-mechanic", mechanic: `move resolution: ${decision.moveId}` },
  };
};

type BasicDefenseFrame = Extract<
  ActiveFightState["resolutionFrames"][number],
  { readonly stage: "awaiting-defense" }
> & { readonly attack: { readonly type: "basic-attack"; readonly basicAttack: BasicAttackType } };

const resolvedBlockEffects = (
  state: ActiveFightState,
  block: MoveDefinition,
  defender: ActiveFightState["combatants"][CombatantId],
  attacker: ActiveFightState["combatants"][CombatantId],
) => {
  const context = {
    self: defender,
    opponent: attacker,
    turnNumber: state.turnNumber,
    completedTurnCount: state.turnNumber - 1,
    moves: new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate])),
    moveActivationCounts: moveActivationCounts(state),
    successfulHitCount: 0,
  };
  const successful = successfulMoveEffects(block, context);
  const stopped = stoppedMoveEffects(block, context);
  return {
    resources: [...successful.resources, ...stopped.resources],
    statuses: [...successful.statuses, ...stopped.statuses],
  };
};

interface BlockedBasicAttackEventContext {
  readonly attacker: ActiveFightState["combatants"][CombatantId];
  readonly block: (typeof MOVE_DEFINITIONS)[number];
  readonly cost: number;
  readonly defender: ActiveFightState["combatants"][CombatantId];
  readonly frame: BasicDefenseFrame;
  readonly response: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>;
  readonly roll: ReturnType<typeof resolveContestedAttackRolls>[number];
}

const createBlockedBasicAttackEvents = (
  state: ActiveFightState,
  dependencies: CombatDependencies,
  { attacker, block, cost, defender, frame, response, roll }: BlockedBasicAttackEventContext,
): CombatEvent[] => [
  {
    id: dependencies.ids.nextEventId(),
    sequence: state.eventSequence + 1,
    fightId: state.id,
    causedByDecisionId: frame.decisionId,
    type: "attack-rolled",
    combatantId: attacker.id,
    targetCombatantId: defender.id,
    basicAttack: frame.attack.basicAttack,
    naturalResult: roll.attackNaturalResult,
    result: roll.attackResult,
  },
  {
    id: dependencies.ids.nextEventId(),
    sequence: state.eventSequence + 2,
    fightId: state.id,
    causedByDecisionId: response.id,
    type: "move-used",
    combatantId: defender.id,
    moveId: block.id,
    targetCombatantId: attacker.id,
  },
  {
    id: dependencies.ids.nextEventId(),
    sequence: state.eventSequence + 3,
    fightId: state.id,
    causedByDecisionId: response.id,
    type: "ki-changed",
    combatantId: defender.id,
    amount: -cost,
    remainingKi: defender.ki.current - cost,
  },
  {
    id: dependencies.ids.nextEventId(),
    sequence: state.eventSequence + 4,
    fightId: state.id,
    causedByDecisionId: frame.decisionId,
    type: "attack-resolved",
    combatantId: attacker.id,
    targetCombatantId: defender.id,
    basicAttack: frame.attack.basicAttack,
    outcome: "stopped",
    critical: false,
    counter: false,
  },
  createPhaseChangedEvent(state, dependencies, "end", state.eventSequence + 5, response.id),
];

const legalBasicBlock = (
  state: ActiveFightState,
  defenderId: CombatantId,
  basicAttack: BasicAttackType,
  blockMoveId: NonNullable<PendingDecisionOption["moveId"]>,
) => {
  const block = MOVE_DEFINITIONS.find((move) => move.id === blockMoveId);
  if (block === undefined) return undefined;
  const attack = { ...basicAttackDetails(basicAttack), restricted: false };
  return legalBlockMoves(state, defenderId, attack).includes(block) ? block : undefined;
};

interface AppendBlockedBasicEffectEventsParams {
  readonly state: ActiveFightState;
  readonly dependencies: CombatDependencies;
  readonly events: CombatEvent[];
  readonly response: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>;
  readonly attacker: CombatantState;
  readonly defender: CombatantState;
  readonly attackerAfter: CombatantState;
  readonly defenderAfter: CombatantState;
  readonly blockCost: number;
  readonly effects: ReturnType<typeof resolvedBlockEffects>;
}

const appendBlockedBasicEffectEvents = ({
  state,
  dependencies,
  events,
  response,
  attacker,
  defender,
  attackerAfter,
  defenderAfter,
  blockCost,
  effects,
}: AppendBlockedBasicEffectEventsParams) => {
  for (const application of effects.statuses) {
    const target = application.target === "self" ? defender : attacker;
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + events.length + 1,
      fightId: state.id,
      causedByDecisionId: response.id,
      type: "status-applied",
      sourceCombatantId: defender.id,
      targetCombatantId: target.id,
      statusId: application.status.statusId,
      stacks: application.status.stacks,
    });
  }
  const defenderEffectKiChange = defenderAfter.ki.current - (defender.ki.current - blockCost);
  if (defenderEffectKiChange !== 0) {
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + events.length + 1,
      fightId: state.id,
      causedByDecisionId: response.id,
      type: "ki-changed",
      combatantId: defender.id,
      amount: defenderEffectKiChange,
      remainingKi: defenderAfter.ki.current,
    });
  }
  const attackerEffectKiChange = attackerAfter.ki.current - attacker.ki.current;
  if (attackerEffectKiChange !== 0) {
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + events.length + 1,
      fightId: state.id,
      causedByDecisionId: response.id,
      type: "ki-changed",
      combatantId: attacker.id,
      amount: attackerEffectKiChange,
      remainingKi: attackerAfter.ki.current,
    });
  }
  const phaseChangeIndex = events.findIndex((event) => event.type === "phase-changed");
  if (phaseChangeIndex !== -1) {
    const [phaseChange] = events.splice(phaseChangeIndex, 1);
    if (phaseChange.type === "phase-changed") {
      events.push({ ...phaseChange, sequence: state.eventSequence + events.length + 1 });
    }
  }
};

const validateBlockedBasicAttack = (
  state: ActiveFightState,
  response: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
  frame: Extract<
    ActiveFightState["resolutionFrames"][number],
    { readonly stage: "awaiting-defense" }
  >,
  blockMoveId: NonNullable<PendingDecisionOption["moveId"]>,
) => {
  if (frame.attack.type !== "basic-attack") {
    return { error: { type: "illegal-decision" as const, decisionType: response.type } };
  }
  const basicFrame: BasicDefenseFrame = { ...frame, attack: frame.attack };
  const defender = state.combatants[frame.targetCombatantId];
  if (hasDeclaredBlockThisTurn(state, defender.id)) {
    return { error: { type: "block-limit-reached" as const, combatantId: defender.id } };
  }
  const block = legalBasicBlock(state, defender.id, basicFrame.attack.basicAttack, blockMoveId);
  if (block === undefined) {
    return { error: { type: "illegal-decision" as const, decisionType: response.type } };
  }
  const restrictedUses = effectiveRestrictedMoveUseLimit(state, defender, block);
  if (!isRestrictedUseAvailable(defender.moveUses[block.id] ?? 0, restrictedUses)) {
    return { error: { type: "restricted-use-exhausted" as const, moveId: block.id } };
  }
  const cost = calculateConvertedBlockCost(block, 0);
  if (cost === undefined)
    return { error: { type: "illegal-decision" as const, decisionType: response.type } };
  if (defender.ki.current < cost) {
    return {
      error: { type: "insufficient-ki" as const, required: cost, available: defender.ki.current },
    };
  }
  return { basicFrame, defender, block, cost };
};

const resolveBlockedBasicAttack = (
  state: ActiveFightState,
  response: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
  frame: Extract<
    ActiveFightState["resolutionFrames"][number],
    { readonly stage: "awaiting-defense" }
  >,
  blockMoveId: NonNullable<PendingDecisionOption["moveId"]>,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> => {
  const validation = validateBlockedBasicAttack(state, response, frame, blockMoveId);
  if ("error" in validation && validation.error !== undefined) {
    return { ok: false, error: validation.error };
  }
  const { basicFrame, defender, block, cost } = validation;
  const attacker = state.combatants[frame.attackerId];

  const [roll] = resolveContestedAttackRolls(
    {
      attack: { dice: 1, sides: GLOBAL_RULES.combat.standardDieSides },
      blockedDice: 1,
      attackerDexterityBonus: attacker.stats.dexterityBonus,
      defenderDexterityBonus: defender.stats.dexterityBonus,
    },
    dependencies.random,
  );
  const baseState = withoutPendingResolution(state);
  const originalDecision: BasicAttackDecision = {
    type: "basic-attack",
    id: frame.decisionId,
    actorId: attacker.id,
    expectedStateVersion: state.version,
    basicAttack: basicFrame.attack.basicAttack,
    targetCombatantId: defender.id,
  };
  const events = createBlockedBasicAttackEvents(state, dependencies, {
    attacker,
    block,
    cost,
    defender,
    frame: basicFrame,
    response,
    roll,
  });
  const effects = resolvedBlockEffects(state, block, defender, attacker);
  const defenderAfter = statusesAfterApplications(
    resourceAfterChanges(
      {
        ...defender,
        ki: { ...defender.ki, current: defender.ki.current - cost },
        moveUses: { ...defender.moveUses, [block.id]: (defender.moveUses[block.id] ?? 0) + 1 },
      },
      effects.resources,
      "self",
      state.activeEffects,
    ),
    effects.statuses,
    "self",
  );
  const attackerAfter = statusesAfterApplications(
    resourceAfterChanges(attacker, effects.resources, "opponent", state.activeEffects),
    effects.statuses,
    "opponent",
  );
  appendBlockedBasicEffectEvents({
    state,
    dependencies,
    events,
    response,
    attacker,
    defender,
    attackerAfter,
    defenderAfter,
    blockCost: cost,
    effects,
  });
  const nextState: ActiveFightState = {
    ...baseState,
    version: state.version + 1,
    phase: "end",
    combatants: {
      ...state.combatants,
      [defender.id]: defenderAfter,
      [attacker.id]: attackerAfter,
    },
    actionHistory: [
      ...state.actionHistory,
      actionRecordFor(baseState, originalDecision),
      {
        type: "use-move",
        decisionId: response.id,
        actorId: defender.id,
        targetCombatantId: attacker.id,
        moveId: block.id,
        turnNumber: state.turnNumber,
        phase: state.phase === "counter" ? "counter" : "action",
      },
    ],
    eventSequence: state.eventSequence + events.length,
  };
  return transitionFrom(nextState, events);
};

const convertedBlockContext = (
  state: ActiveFightState,
  frame: Extract<
    ActiveFightState["resolutionFrames"][number],
    { readonly stage: "awaiting-defense" }
  >,
  blockMoveId: NonNullable<PendingDecisionOption["moveId"]>,
) => {
  const frameAttack = frame.attack;
  if (frameAttack.type !== "move") return undefined;
  const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === frameAttack.moveId);
  const block = MOVE_DEFINITIONS.find((candidate) => candidate.id === blockMoveId);
  if (move === undefined || block === undefined) return undefined;
  const attacker = state.combatants[frame.attackerId];
  const defender = state.combatants[frame.targetCombatantId];
  const classification = classifyCurrentActionMove(
    move,
    convertedAttackEffectContext(state, attacker, defender),
  );
  const attack = moveAttackDetails(classification.move, classification.addedTags);
  if (attack === undefined || move.mechanics.kiCost?.type !== "literal") return undefined;
  if (hasDeclaredBlockThisTurn(state, defender.id)) return undefined;
  const eligibility = evaluateBlockEligibility(block, attack);
  if (!eligibility.canDeclare) return undefined;
  const cost = calculateConvertedBlockCost(block, move.mechanics.kiCost.value);
  return cost === undefined ? undefined : { attack, block, cost, defender, move, eligibility };
};

const resolveBlockedConvertedAttack = (
  state: ActiveFightState,
  response: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
  frame: Extract<
    ActiveFightState["resolutionFrames"][number],
    { readonly stage: "awaiting-defense" }
  >,
  blockMoveId: NonNullable<PendingDecisionOption["moveId"]>,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> => {
  const attacker = state.combatants[frame.attackerId];
  const defender = state.combatants[frame.targetCombatantId];
  if (hasDeclaredBlockThisTurn(state, defender.id)) {
    return { ok: false, error: { type: "block-limit-reached", combatantId: defender.id } };
  }
  const context = convertedBlockContext(state, frame, blockMoveId);
  if (context === undefined) {
    return { ok: false, error: { type: "illegal-decision", decisionType: response.type } };
  }
  const { block, cost, defender: resolvedDefender, eligibility, move } = context;
  if (resolvedDefender.ki.current < cost) {
    return {
      ok: false,
      error: { type: "insufficient-ki", required: cost, available: resolvedDefender.ki.current },
    };
  }
  const dice = move.mechanics.attack?.attackRoll?.dice ?? 1;
  let blockedDice = 0;
  if (eligibility.stopsAttack) {
    blockedDice =
      block.mechanics.block?.stopsAllDice === true ? dice : blockedDiceForDeclaredBlock(dice);
  }
  const effects = resolvedBlockEffects(state, block, resolvedDefender, attacker);
  return resolveConvertedAttackMove(
    withoutPendingResolution(state),
    {
      type: "use-move",
      id: frame.decisionId,
      actorId: attacker.id,
      expectedStateVersion: state.version,
      moveId: move.id,
      targetCombatantId: resolvedDefender.id,
    },
    move,
    dependencies,
    {
      requestDefense: false,
      blockedDice,
      blockUsage: { block, cost, defender: resolvedDefender, effects, response },
    },
  );
};

const defenseItemUseForOption = (
  state: ActiveFightState,
  pending: NonNullable<ActiveFightState["pendingDecision"]>,
  option: PendingDecisionOption,
) =>
  option.type === "activate-effect" && option.itemId !== undefined
    ? availablePreRollDefenseItems(state.combatants[pending.combatantId]).find(
        ({ item }) => item.id === option.itemId,
      )
    : undefined;

const resolveDefenseRoll = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
  frame: Extract<
    ActiveFightState["resolutionFrames"][number],
    { readonly stage: "awaiting-defense" }
  >,
  dependencies: CombatDependencies,
  defenseItemUse: ReturnType<typeof defenseItemUseForOption>,
): CombatResult<CombatTransition> => {
  const modifiers =
    defenseItemUse === undefined
      ? {}
      : {
          defenseItemUse: { ...defenseItemUse, response: decision },
          defenseResultModifier: defenseItemUse.modifier.amount,
        };
  const pendingAttack = frame.attack;
  if (pendingAttack.type === "move") {
    const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === pendingAttack.moveId);
    if (move === undefined) return { ok: false, error: invalidFightState(state) };
    return resolveConvertedAttackMove(
      withoutPendingResolution(state),
      {
        type: "use-move",
        id: frame.decisionId,
        actorId: frame.attackerId,
        expectedStateVersion: state.version,
        moveId: move.id,
        targetCombatantId: frame.targetCombatantId,
      },
      move,
      dependencies,
      {
        requestDefense: false,
        ...modifiers,
        ...(frame.enabledOptionalEffectIndices === undefined
          ? {}
          : { enabledOptionalEffectIndices: frame.enabledOptionalEffectIndices }),
        ...(frame.resolvedOptionalEffectIndices === undefined
          ? {}
          : { resolvedOptionalEffectIndices: frame.resolvedOptionalEffectIndices }),
      },
    );
  }
  return resolveBasicAttack(
    withoutPendingResolution(state),
    {
      type: "basic-attack",
      id: frame.decisionId,
      actorId: frame.attackerId,
      expectedStateVersion: state.version,
      basicAttack: pendingAttack.basicAttack,
      targetCombatantId: frame.targetCombatantId,
    },
    dependencies,
    false,
    modifiers,
  );
};

/**
 * Suspends any unblocked attack after its dice are known when the defender
 * owns an after-roll reaction. The exact natural dice are retained so a
 * reaction never consumes another random value or changes the original roll.
 */
interface PostDefenseReactionRoll {
  readonly attackNaturalResult: number;
  readonly attackResult: number;
  readonly defenseNaturalResult: number;
  readonly defenseResult: number;
}

interface PostDefenseRerollChoice {
  readonly application: RerollApplication;
  readonly move: MoveDefinition;
  readonly actorId: CombatantId;
  readonly dieIndex?: number;
  readonly consumesMoveUse: boolean;
  readonly kiCost: number;
}

const pendingAttackMove = (
  attack: PostDefenseReactionFrame["attack"],
): MoveDefinition | undefined =>
  attack.type === "move"
    ? MOVE_DEFINITIONS.find((candidate) => candidate.id === attack.moveId)
    : undefined;

const rerollRuntimeContext = (
  state: ActiveFightState,
  frame: Pick<PostDefenseReactionFrame, "attackerId" | "targetCombatantId" | "attack">,
  combatantId: CombatantId,
  rolls: readonly AttackDieRoll[],
) => {
  const self = state.combatants[combatantId];
  const opponentId = combatantId === frame.attackerId ? frame.targetCombatantId : frame.attackerId;
  const triggeringMove = pendingAttackMove(frame.attack);
  return {
    self,
    opponent: state.combatants[opponentId],
    turnNumber: state.turnNumber,
    completedTurnCount: state.turnNumber - 1,
    moves: new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate])),
    moveActivationCounts: moveActivationCounts(state),
    successfulHitCount: rolls.filter((roll) => roll.outcome === "successful").length,
    actionHistory: state.actionHistory,
    activeEffects: state.activeEffects,
    rolls,
    mode: state.mode,
    ...(triggeringMove === undefined
      ? {}
      : {
          triggeringMove,
          triggeringMoveOwner:
            combatantId === frame.attackerId ? ("self" as const) : ("opponent" as const),
        }),
  };
};

const availablePostDefenseRerolls = (
  state: ActiveFightState,
  frame: Pick<PostDefenseReactionFrame, "attackerId" | "targetCombatantId" | "attack">,
  combatantId: CombatantId,
  roll: "attack" | "defense",
  rolls: readonly AttackDieRoll[],
): readonly PostDefenseRerollChoice[] => {
  const attackMove = pendingAttackMove(frame.attack);
  const candidateRollSets =
    roll === "defense" ? rolls.map((candidate) => [candidate] as const) : [rolls];
  return state.combatants[combatantId].moveIds.flatMap((moveId) => {
    const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === moveId);
    if (move === undefined) return [];
    if (
      state.activeEffects.some(
        (effect) =>
          effect.type === "reroll" &&
          effect.sourceCombatantId === combatantId &&
          effect.sourceDefinitionId === move.id,
      )
    )
      return [];
    const availability = reactionSkillAvailability(state, combatantId, move, undefined);
    if (availability === undefined) return [];
    return candidateRollSets.flatMap((candidateRolls, dieIndex) =>
      rerollEffectsAfterDefense(
        move,
        rerollRuntimeContext(state, frame, combatantId, candidateRolls),
      ).flatMap((application) => {
        if (
          application.roll !== roll ||
          !rerollSelectorMatchesAttack(application.selector, attackMove) ||
          !hasPriorSourceResult(state, combatantId, application)
        )
          return [];
        const withEffectLimit = reactionSkillAvailability(
          state,
          combatantId,
          move,
          application.useLimit,
        );
        if (withEffectLimit === undefined) return [];
        return [
          {
            application,
            move,
            actorId: combatantId,
            ...(roll === "defense" ? { dieIndex } : {}),
            ...withEffectLimit,
          },
        ];
      }),
    );
  });
};

const rerollOptionId = (choice: PostDefenseRerollChoice) =>
  `activate-reroll:${choice.move.id}:${choice.application.effectIndex}:${choice.dieIndex ?? "all"}`;

const rerollOptions = (choices: readonly PostDefenseRerollChoice[]) =>
  choices.map((choice) => ({
    id: rerollOptionId(choice),
    type: "activate-effect" as const,
    moveId: choice.move.id,
  }));

const postDefenseFrameRolls = (
  state: ActiveFightState,
  frame: PostDefenseReactionFrame,
): readonly AttackDieRoll[] => {
  const move = pendingAttackMove(frame.attack);
  return frame.naturalRolls.map((roll, index) => {
    const attackResult =
      frame.numericResultOverrides[index]?.attack ??
      roll.attack +
        state.combatants[frame.attackerId].stats.dexterityBonus +
        activeRollModifier(state, frame.attackerId, "attack", "result", move);
    const defenseResult =
      frame.numericResultOverrides[index]?.defense ??
      roll.defense +
        state.combatants[frame.targetCombatantId].stats.dexterityBonus +
        activeRollModifier(state, frame.targetCombatantId, "defense", "result", move);
    const override = frame.resultOverrides[index];
    let outcome: "successful" | "stopped";
    if (override === "successful") outcome = "successful";
    else if (override === "stopped") outcome = "stopped";
    else outcome = attackResult >= defenseResult ? "successful" : "stopped";
    return {
      attackNaturalResult: roll.attack,
      attackResult,
      defenseNaturalResult: roll.defense,
      defenseResult,
      outcome,
    };
  });
};

const hasPostDefenseReactionPotential = (
  state: ActiveFightState,
  frame: Extract<
    ActiveFightState["resolutionFrames"][number],
    { readonly stage: "awaiting-defense" }
  >,
) => {
  const attacker = state.combatants[frame.attackerId];
  const defender = state.combatants[frame.targetCombatantId];
  const pendingAttack = frame.attack;
  const move =
    pendingAttack.type === "move"
      ? MOVE_DEFINITIONS.find((candidate) => candidate.id === pendingAttack.moveId)
      : undefined;
  return (
    availablePostRollDefenseItems(defender).length > 0 ||
    hasActiveConstant(state, defender.id, "move-aoyosumu-close-shave") ||
    hasPostDefenseRerollPotential(state, defender.id, "defense", move) ||
    hasRerollDefinition(defender) ||
    eligibleRerollsForPostDefense(state, frame).some(
      (effect) => effect.sourceCombatantId === defender.id,
    ) ||
    (move !== undefined && hasEnergyRedirectionPotential(state, attacker.id, move)) ||
    hasPostDefenseRerollPotential(state, attacker.id, "attack", move) ||
    hasRerollDefinition(attacker) ||
    eligibleRerollsForPostDefense(state, frame).some(
      (effect) => effect.sourceCombatantId === attacker.id,
    ) ||
    (move?.effects ?? []).some(
      (effect) =>
        effect.trigger === "after-defense-roll" &&
        (effect.optional === true || effect.activationGroup !== undefined),
    )
  );
};

const postDefenseReactionRolls = (
  state: ActiveFightState,
  frame: Extract<
    ActiveFightState["resolutionFrames"][number],
    { readonly stage: "awaiting-defense" }
  >,
  dependencies: CombatDependencies,
): readonly PostDefenseReactionRoll[] | undefined => {
  const attacker = state.combatants[frame.attackerId];
  const defender = state.combatants[frame.targetCombatantId];
  const rolls =
    frame.attack.type === "basic-attack"
      ? [
          resolveAttack({
            attacker,
            target: defender,
            dependencies,
            attackSides:
              GLOBAL_RULES.combat.standardDieSides +
              activeRollModifier(state, attacker.id, "attack", "sides"),
            defenseSides:
              GLOBAL_RULES.combat.standardDieSides +
              activeRollModifier(state, defender.id, "defense", "sides"),
            baseDamage: 0,
            attackResultModifier: activeRollModifier(state, attacker.id, "attack", "result"),
            defenseResultModifier: activeRollModifier(state, defender.id, "defense", "result"),
            resolutionThresholds: activeResolutionThresholds(state, attacker.id, defender.id),
          }),
        ]
      : postDefenseMoveRolls(state, frame, dependencies);
  if (
    rolls === undefined ||
    rolls.some(
      (roll) => roll.defenseNaturalResult === undefined || roll.defenseResult === undefined,
    )
  ) {
    return undefined;
  }
  return rolls as readonly PostDefenseReactionRoll[];
};

const postDefenseMoveRolls = (
  state: ActiveFightState,
  frame: Extract<
    ActiveFightState["resolutionFrames"][number],
    { readonly stage: "awaiting-defense" }
  >,
  dependencies: CombatDependencies,
) => {
  const pendingAttack = frame.attack;
  if (pendingAttack.type !== "move") return undefined;
  const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === pendingAttack.moveId);
  if (move === undefined) return undefined;
  const attacker = state.combatants[frame.attackerId];
  const defender = state.combatants[frame.targetCombatantId];
  const { attack } = resolvedLiteralAttack(state, attacker, defender, move);
  return resolveMoveAttack(
    attacker,
    defender,
    {
      attack: adjustedAttackRoll(
        state,
        attacker.id,
        attack.attackRoll ?? defaultMoveAttackRoll(),
        move,
      ),
      attackResultModifier: activeRollModifier(state, attacker.id, "attack", "result", move),
      defenseSides:
        GLOBAL_RULES.combat.standardDieSides +
        activeRollModifier(state, defender.id, "defense", "sides", move),
      defenseResultModifier: activeRollModifier(state, defender.id, "defense", "result", move),
      resolutionThresholds: resolutionThresholdsForMove(state, attacker, defender, move),
      baseDamage: 0,
      damagePerHit: attack.damagePerHit,
    },
    dependencies.random,
  ).rolls;
};

const postDefenseEffectChoices = (
  state: ActiveFightState,
  frame: Extract<
    ActiveFightState["resolutionFrames"][number],
    { readonly stage: "awaiting-defense" | "awaiting-post-defense-reaction" }
  >,
  rolls: readonly (PostDefenseReactionRoll | AttackDieRoll)[],
) => {
  const move = moveForPostDefenseFrame(frame);
  if (move === undefined) return [];
  const attacker = state.combatants[frame.attackerId];
  const defender = state.combatants[frame.targetCombatantId];
  const resolvedRolls = rolls.flatMap((roll) =>
    roll.defenseResult === undefined
      ? []
      : [
          {
            attackNaturalResult: roll.attackNaturalResult,
            attackResult: roll.attackResult,
            defenseNaturalResult: roll.defenseNaturalResult ?? roll.defenseResult,
            defenseResult: roll.defenseResult,
            outcome:
              roll.attackResult >= roll.defenseResult
                ? ("successful" as const)
                : ("stopped" as const),
          },
        ],
  );
  if (resolvedRolls.length !== rolls.length) return [];
  const resolved = moveEffectsForTrigger(move, "after-defense-roll", {
    ...convertedAttackEffectContext(state, attacker, defender, move),
    collectPendingChoices: true,
    rolls: resolvedRolls,
  });
  return resolved.pendingEffectChoices;
};

const afterDefenseActivationCost = (
  state: ActiveFightState,
  frame: PostDefenseReactionFrame,
  effectIndices: readonly number[],
) => {
  const moveId = "moveId" in frame.attack ? frame.attack.moveId : undefined;
  if (moveId === undefined) return undefined;
  const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === moveId);
  const attacker = state.combatants[frame.attackerId];
  const defender = state.combatants[frame.targetCombatantId];
  if (move === undefined) return undefined;
  const context = {
    ...convertedAttackEffectContext(state, attacker, defender, move),
    rolls: postDefenseFrameRolls(state, frame).map((roll) => ({
      attackNaturalResult: roll.attackNaturalResult,
      attackResult: roll.attackResult,
      defenseNaturalResult: roll.defenseNaturalResult,
      defenseResult: roll.defenseResult,
      outcome: roll.outcome,
    })),
  };
  for (const effectIndex of effectIndices) {
    const effect = move.effects?.[effectIndex];
    if (
      effect === undefined ||
      !("activationCost" in effect) ||
      effect.activationCost === undefined
    )
      continue;
    const amount = evaluateDurableNumericExpression(effect.activationCost.amount, {
      ...context,
      participantCount: 2,
    });
    if (amount === undefined || effect.activationCost.resource !== "ki") return undefined;
    return amount;
  }
  return 0;
};

const moveForPostDefenseFrame = (
  frame:
    | Extract<ActiveFightState["resolutionFrames"][number], { readonly stage: "awaiting-defense" }>
    | PostDefenseReactionFrame,
) => {
  const moveId = "moveId" in frame.attack ? frame.attack.moveId : undefined;
  return moveId === undefined ? undefined : MOVE_DEFINITIONS.find((move) => move.id === moveId);
};

const rerollConditionsMatch = (
  state: ActiveFightState,
  frame:
    | Extract<ActiveFightState["resolutionFrames"][number], { readonly stage: "awaiting-defense" }>
    | PostDefenseReactionFrame,
  effect: ActiveRerollEffect,
  rolls: readonly PostDefenseReactionRoll[],
) => {
  if (effect.conditions === undefined || effect.conditions.length === 0) return true;
  const sourceMove = MOVE_DEFINITIONS.find((move) => move.id === effect.sourceDefinitionId);
  const source = state.combatants[effect.sourceCombatantId];
  const opponent = Object.values(state.combatants).find(
    (combatant) => combatant.id !== source.id && combatant.status === "active",
  );
  if (sourceMove === undefined || opponent === undefined) return false;
  const triggeringMove = moveForPostDefenseFrame(frame);
  const resolved = moveEffectsForTrigger(sourceMove, "after-defense-roll", {
    self: source,
    opponent,
    turnNumber: state.turnNumber,
    completedTurnCount: state.turnNumber - 1,
    moves: new Map(MOVE_DEFINITIONS.map((move) => [move.id, move])),
    moveActivationCounts: moveActivationCounts(state),
    successfulHitCount: 0,
    actionHistory: state.actionHistory,
    activeEffects: state.activeEffects,
    ...(triggeringMove === undefined ? {} : { triggeringMove }),
    rolls: rolls.map((roll) => ({
      attackNaturalResult: roll.attackNaturalResult,
      attackResult: roll.attackResult,
      defenseNaturalResult: roll.defenseNaturalResult,
      defenseResult: roll.defenseResult,
      outcome: roll.attackResult >= roll.defenseResult ? "successful" : "stopped",
    })),
  });
  return resolved.rerolls.some((candidate) => candidate.effectIndex === effect.sourceEffectIndex);
};

const eligibleRerollsForPostDefense = (
  state: ActiveFightState,
  frame:
    | Extract<ActiveFightState["resolutionFrames"][number], { readonly stage: "awaiting-defense" }>
    | PostDefenseReactionFrame,
  rolls?: readonly PostDefenseReactionRoll[],
) => {
  const move = moveForPostDefenseFrame(frame);
  return state.activeEffects.filter((effect): effect is ActiveRerollEffect => {
    if (
      effect.type !== "reroll" ||
      effect.useLimit?.remaining === 0 ||
      (effect.selector !== undefined &&
        (move === undefined || !selectorMatchesMove(effect.selector, move)))
    )
      return false;
    const ownerId = effect.roll === "attack" ? frame.attackerId : frame.targetCombatantId;
    return (
      effect.sourceCombatantId === ownerId &&
      effect.targetCombatantId === ownerId &&
      (rolls === undefined || rerollConditionsMatch(state, frame, effect, rolls))
    );
  });
};

const rerollOptionsForEffect = (
  state: ActiveFightState,
  effect: ActiveRerollEffect,
  rolls: readonly PostDefenseReactionRoll[],
) => {
  if (
    effect.activationCost !== undefined &&
    state.combatants[effect.sourceCombatantId].ki.current < effect.activationCost
  )
    return [];
  if (effect.rerollScope === "entire-attack")
    return [{ id: `activate-reroll:${effect.id}:all`, type: "activate-effect" as const }];
  return rolls.map((_, index) => ({
    id: `activate-reroll:${effect.id}:${index}`,
    type: "activate-effect" as const,
  }));
};

const rerollOptionsForPostDefense = (
  state: ActiveFightState,
  frame:
    | Extract<ActiveFightState["resolutionFrames"][number], { readonly stage: "awaiting-defense" }>
    | PostDefenseReactionFrame,
  rolls: readonly PostDefenseReactionRoll[],
) =>
  eligibleRerollsForPostDefense(state, frame, rolls).flatMap((effect) =>
    rerollOptionsForEffect(state, effect, rolls),
  );

const rerollEffectForOption = (state: ActiveFightState, optionId: string) => {
  if (!optionId.startsWith("activate-reroll:")) return undefined;
  const suffixIndex = optionId.lastIndexOf(":");
  if (suffixIndex < 0) return undefined;
  const effectId = optionId.slice("activate-reroll:".length, suffixIndex);
  return state.activeEffects.find(
    (effect): effect is ActiveRerollEffect => effect.type === "reroll" && effect.id === effectId,
  );
};

const rerollOptionsForCombatant = (
  state: ActiveFightState,
  frame:
    | Extract<ActiveFightState["resolutionFrames"][number], { readonly stage: "awaiting-defense" }>
    | PostDefenseReactionFrame,
  rolls: readonly PostDefenseReactionRoll[],
  combatantId: CombatantId,
) =>
  rerollOptionsForPostDefense(state, frame, rolls).filter(
    (option) => rerollEffectForOption(state, option.id)?.sourceCombatantId === combatantId,
  );

const postDefenseReaction = (
  state: ActiveFightState,
  frame: Extract<
    ActiveFightState["resolutionFrames"][number],
    { readonly stage: "awaiting-defense" }
  >,
  rolls: readonly PostDefenseReactionRoll[],
) => {
  const attacker = state.combatants[frame.attackerId];
  const defender = state.combatants[frame.targetCombatantId];
  const resolvedRolls = rolls.map((roll) => ({
    ...roll,
    outcome:
      roll.attackResult >= roll.defenseResult ? ("successful" as const) : ("stopped" as const),
  }));
  const closeShaveActive = hasActiveConstant(state, defender.id, "move-aoyosumu-close-shave");
  const defenderRerolls = availablePostDefenseRerolls(
    state,
    frame,
    defender.id,
    "defense",
    resolvedRolls,
  );
  const defenderOptions = [
    ...closeShaveReactionOptions(state, defender.id),
    ...rerollOptions(defenderRerolls),
    ...rerollOptionsForCombatant(state, frame, rolls, defender.id),
    ...availablePostRollDefenseItems(defender).map(({ item }) => ({
      id: `activate-item:${item.id}`,
      type: "activate-effect" as const,
      itemId: item.id,
    })),
  ];
  const attackerOptions = energyRedirectionOptions(state, attacker.id, frame.attack, resolvedRolls);
  const attackerRerolls = availablePostDefenseRerolls(
    state,
    frame,
    attacker.id,
    "attack",
    resolvedRolls,
  );
  attackerOptions.push(...rerollOptions(attackerRerolls));
  attackerOptions.push(
    ...postDefenseEffectChoices(state, frame, rolls).map((choice) => ({
      id: `activate-effect:${choice.effectIndices.join(",")}`,
      type: "activate-effect" as const,
      moveId: choice.sourceDefinitionId,
      effectIndices: choice.effectIndices,
    })),
  );
  const genericAttackerOptions = rerollOptionsForCombatant(state, frame, rolls, attacker.id);
  const reactionCombatantId = defenderOptions.length > 0 ? defender.id : attacker.id;
  const options =
    reactionCombatantId === defender.id
      ? defenderOptions
      : [...attackerOptions, ...genericAttackerOptions];
  return options.length === 0 && !closeShaveActive
    ? undefined
    : { closeShaveActive, combatantId: reactionCombatantId, options };
};

const postDefenseReactionEvents = (
  state: ActiveFightState,
  frame: Extract<
    ActiveFightState["resolutionFrames"][number],
    { readonly stage: "awaiting-defense" }
  >,
  dependencies: CombatDependencies,
  rolls: readonly PostDefenseReactionRoll[],
) => {
  const attacker = state.combatants[frame.attackerId];
  const defender = state.combatants[frame.targetCombatantId];
  return rolls.flatMap((roll, index) => {
    const sequence = state.eventSequence + index * 2;
    return [
      {
        id: dependencies.ids.nextEventId(),
        sequence: sequence + 1,
        fightId: state.id,
        causedByDecisionId: frame.decisionId,
        type: "attack-rolled" as const,
        combatantId: attacker.id,
        targetCombatantId: defender.id,
        ...(frame.attack.type === "basic-attack"
          ? { basicAttack: frame.attack.basicAttack }
          : { moveId: frame.attack.moveId }),
        naturalResult: roll.attackNaturalResult,
        result: roll.attackResult,
      },
      {
        id: dependencies.ids.nextEventId(),
        sequence: sequence + 2,
        fightId: state.id,
        causedByDecisionId: frame.decisionId,
        type: "defense-rolled" as const,
        combatantId: defender.id,
        sourceCombatantId: attacker.id,
        naturalResult: roll.defenseNaturalResult,
        result: roll.defenseResult,
      },
    ];
  });
};

const materializeInitialRerolls = (
  state: ActiveFightState,
  dependencies: CombatDependencies,
  rolls: readonly PostDefenseReactionRoll[],
): readonly ActiveCombatEffect[] => {
  const moves = new Map(MOVE_DEFINITIONS.map((move) => [move.id, move]));
  const activationCounts = moveActivationCounts(state);
  const additions: ActiveCombatEffect[] = [];
  for (const source of Object.values(state.combatants)) {
    const opponent = Object.values(state.combatants).find(
      (candidate) => candidate.id !== source.id && candidate.status === "active",
    );
    if (opponent === undefined) continue;
    for (const moveId of source.moveIds) {
      const move = moves.get(moveId);
      if (move === undefined) continue;
      const existing = state.activeEffects.some(
        (effect) =>
          effect.type === "reroll" &&
          effect.sourceCombatantId === source.id &&
          effect.sourceDefinitionId === move.id,
      );
      if (existing) continue;
      const effects = moveEffectsForTrigger(move, "after-defense-roll", {
        self: source,
        opponent,
        turnNumber: state.turnNumber,
        completedTurnCount: state.turnNumber - 1,
        moves,
        moveActivationCounts: activationCounts,
        successfulHitCount: 0,
        actionHistory: state.actionHistory,
        activeEffects: [...state.activeEffects, ...additions],
        rolls: rolls.map((roll) => ({
          attackNaturalResult: roll.attackNaturalResult,
          attackResult: roll.attackResult,
          defenseNaturalResult: roll.defenseNaturalResult,
          defenseResult: roll.defenseResult,
          outcome: roll.attackResult >= roll.defenseResult ? "successful" : "stopped",
        })),
      });
      additions.push(
        ...activeRerollsFromApplications(effects.rerolls, source.id, opponent.id, dependencies),
      );
    }
  }
  return additions;
};

const requestPostDefenseReaction = (
  state: ActiveFightState,
  frame: Extract<
    ActiveFightState["resolutionFrames"][number],
    { readonly stage: "awaiting-defense" }
  >,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> | undefined => {
  if (!hasPostDefenseReactionPotential(state, frame)) return undefined;
  const rolls = postDefenseReactionRolls(state, frame, dependencies);
  if (rolls === undefined) return { ok: false, error: invalidFightState(state) };
  const initialRerolls = materializeInitialRerolls(state, dependencies, rolls);
  const preparedState =
    initialRerolls.length === 0
      ? state
      : { ...state, activeEffects: [...state.activeEffects, ...initialRerolls] };
  const attacker = preparedState.combatants[frame.attackerId];
  const defender = preparedState.combatants[frame.targetCombatantId];
  const reaction = postDefenseReaction(preparedState, frame, rolls);
  if (reaction === undefined) return undefined;
  const pendingDecisionId = dependencies.ids.nextPendingDecisionId();
  const baseState = withoutPendingResolution(preparedState);
  const nextState: ActiveFightState = {
    ...baseState,
    version: state.version + 1,
    pendingDecision: {
      id: pendingDecisionId,
      stateVersion: state.version + 1,
      combatantId: reaction.combatantId,
      type: "post-defense-roll",
      options: [{ id: "decline", type: "decline" }, ...reaction.options],
    },
    resolutionFrames: [
      {
        id: dependencies.ids.nextResolutionFrameId(),
        type: "attack",
        decisionId: frame.decisionId,
        attackerId: attacker.id,
        targetCombatantId: defender.id,
        returnPhase: frame.returnPhase,
        stage: "awaiting-post-defense-reaction",
        pendingDecisionId,
        reactionCombatantId: reaction.combatantId,
        attack: frame.attack,
        naturalRolls: rolls.map((roll) => ({
          attack: roll.attackNaturalResult,
          defense: roll.defenseNaturalResult,
        })),
        resultOverrides: closeShaveResultOverrides(state, defender.id, rolls),
        numericResultOverrides: rolls.map((roll) => ({
          ...(roll.attackResult === roll.attackNaturalResult + attacker.stats.dexterityBonus
            ? {}
            : { attack: roll.attackResult }),
          ...(roll.defenseResult === roll.defenseNaturalResult + defender.stats.dexterityBonus
            ? {}
            : { defense: roll.defenseResult }),
        })),
      },
    ],
    eventSequence: state.eventSequence + rolls.length * 2,
  };
  return transitionFrom(
    nextState,
    postDefenseReactionEvents(preparedState, frame, dependencies, rolls),
  );
};

const postDefenseReactionSelection = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
  frame: PostDefenseReactionFrame,
  option: PendingDecisionOption,
): PostDefenseReactionSelection | undefined => {
  if (option.type === "decline")
    return {
      itemUse: undefined,
      closeShaveKiLoss: undefined,
      energyRedirectionDie: undefined,
      reroll: undefined,
      secondChanceDie: undefined,
      rerollEffect: undefined,
      rerollDieIndex: undefined,
      afterDefenseEffectIndices: undefined,
    };
  const availability = postDefenseReactionSelectionAvailability(state, decision, frame, option);
  if (
    availability.itemUse === undefined &&
    !availability.canUseCloseShave &&
    !availability.canUseEnergyRedirection &&
    availability.reroll === undefined &&
    !availability.canUseActiveReroll &&
    !availability.canUseAfterDefenseEffects
  )
    return undefined;
  return {
    itemUse: availability.itemUse,
    closeShaveKiLoss: availability.closeShaveKiLoss,
    energyRedirectionDie: availability.energyRedirectionDie,
    reroll: availability.reroll,
    secondChanceDie: undefined,
    rerollEffect: availability.rerollEffect,
    rerollDieIndex: availability.rerollDieIndex,
    afterDefenseEffectIndices: availability.afterDefenseEffectIndices,
  };
};

const postDefenseReactionEventCount = (
  reactionKiCost: number | undefined,
  energyRedirectionDie: number | undefined,
  reroll: PostDefenseRerollChoice | undefined,
  secondChanceDie: number | undefined,
  rerollEventCount: number,
) => {
  let count = 0;
  if (reactionKiCost !== undefined && reactionKiCost !== 0) count += 1;
  if (energyRedirectionDie !== undefined) count += 1;
  if (reroll !== undefined) {
    if (reroll.consumesMoveUse) count += 1;
    count += 1;
  }
  if (secondChanceDie !== undefined) count += 2;
  count += rerollEventCount;
  return count;
};

const postDefenseReactionState = (
  baseState: ActiveFightState,
  actorId: CombatantId,
  reactionKiCost: number | undefined,
  energyRedirectionDie: number | undefined,
  reroll: PostDefenseRerollChoice | undefined,
  secondChanceDie: number | undefined,
  rerollEffect: ActiveRerollEffect | undefined,
  rerollEventCount: number,
  dependencies: CombatDependencies,
): ActiveFightState => {
  if (
    reactionKiCost === undefined &&
    reroll === undefined &&
    secondChanceDie === undefined &&
    rerollEffect === undefined
  )
    return baseState;
  const actor = baseState.combatants[actorId];
  const moveUses = { ...actor.moveUses };
  if (energyRedirectionDie !== undefined) {
    moveUses["move-freestyle-energy-redirection"] =
      (moveUses["move-freestyle-energy-redirection"] ?? 0) + 1;
  }
  if (reroll?.consumesMoveUse === true)
    moveUses[reroll.move.id] = (moveUses[reroll.move.id] ?? 0) + 1;
  const opponentId = Object.values(baseState.combatants).find(
    (combatant) => combatant.id !== actorId,
  )?.id;
  const activatedReroll =
    reroll === undefined || opponentId === undefined
      ? undefined
      : activeRerollFromApplication(reroll.application, actorId, opponentId, dependencies);
  const activeEffects = [
    ...baseState.activeEffects,
    ...(activatedReroll === undefined ? [] : [activatedReroll]),
  ].map((effect) => {
    if (
      (rerollEffect === undefined && activatedReroll === undefined) ||
      effect.type !== "reroll" ||
      (effect.id !== rerollEffect?.id && effect.id !== activatedReroll?.id) ||
      effect.useLimit === undefined
    )
      return effect;
    return {
      ...effect,
      useLimit: { ...effect.useLimit, remaining: effect.useLimit.remaining - 1 },
    };
  });
  return {
    ...baseState,
    eventSequence:
      baseState.eventSequence +
      postDefenseReactionEventCount(
        reactionKiCost,
        energyRedirectionDie,
        reroll,
        secondChanceDie,
        rerollEventCount,
      ),
    combatants: {
      ...baseState.combatants,
      [actorId]: {
        ...actor,
        ki: { ...actor.ki, current: actor.ki.current - (reactionKiCost ?? 0) },
        moveUses,
      },
    },
    activeEffects,
  };
};

interface PostDefenseReactionModifiersInput {
  readonly defenseItemUse?: DefenseItemUse;
  readonly defenseResultModifier: number;
  readonly naturalRolls: readonly ContestedAttackNaturalRoll[];
  readonly resultOverrides: readonly ResultOverride[];
  readonly numericResultOverrides: readonly NumericResultOverride[];
  readonly afterDefenseEffectIndices?: readonly number[];
}

const postDefenseReactionModifiers = ({
  defenseItemUse,
  defenseResultModifier,
  naturalRolls,
  resultOverrides,
  numericResultOverrides,
  afterDefenseEffectIndices,
}: PostDefenseReactionModifiersInput) => {
  const totalDefenseResultModifier = defenseResultModifier;
  return {
    ...(defenseItemUse === undefined ? {} : { defenseItemUse }),
    ...(totalDefenseResultModifier === 0
      ? {}
      : { defenseResultModifier: totalDefenseResultModifier }),
    includeRollEvents: false,
    naturalRolls,
    resultOverrides,
    numericResultOverrides,
    ...(afterDefenseEffectIndices === undefined
      ? {}
      : { enabledAfterDefenseEffectIndices: afterDefenseEffectIndices }),
  };
};

const requestAttackerPostDefenseReaction = (
  state: ActiveFightState,
  frame: PostDefenseReactionFrame,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> | undefined => {
  const attacker = state.combatants[frame.attackerId];
  const rolls = postDefenseFrameRolls(state, frame);
  const options = energyRedirectionOptions(state, attacker.id, frame.attack, rolls);
  options.push(
    ...rerollOptions(availablePostDefenseRerolls(state, frame, attacker.id, "attack", rolls)),
  );
  options.push(
    ...postDefenseEffectChoices(state, frame, rolls).map((choice) => ({
      id: `activate-effect:${choice.effectIndices.join(",")}`,
      type: "activate-effect" as const,
      moveId: choice.sourceDefinitionId,
      effectIndices: choice.effectIndices,
    })),
  );
  if (options.length === 0) return undefined;
  const pendingDecisionId = dependencies.ids.nextPendingDecisionId();
  const nextState: ActiveFightState = {
    ...withoutPendingResolution(state),
    version: state.version + 1,
    pendingDecision: {
      id: pendingDecisionId,
      stateVersion: state.version + 1,
      combatantId: attacker.id,
      type: "post-defense-roll",
      options: [{ id: "decline", type: "decline" }, ...options],
    },
    resolutionFrames: [{ ...frame, pendingDecisionId, reactionCombatantId: attacker.id }],
  };
  return transitionFrom(nextState, []);
};

const postDefenseReactionSelectionAvailability = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
  frame: PostDefenseReactionFrame,
  option: PendingDecisionOption,
) => {
  const itemUse =
    option.itemId === undefined
      ? undefined
      : availablePostRollDefenseItems(state.combatants[decision.actorId]).find(
          ({ item }) => item.id === option.itemId,
        );
  const closeShaveKiLoss = closeShaveKiLossForOption(option);
  const energyRedirectionDie = energyRedirectionDieForOption(option);
  const frameRolls = postDefenseFrameRolls(state, frame);
  const reroll = availablePostDefenseRerolls(
    state,
    frame,
    decision.actorId,
    decision.actorId === frame.attackerId ? "attack" : "defense",
    frameRolls,
  ).find((candidate) => rerollOptionId(candidate) === option.id);
  const rerollMatch = /^activate-reroll:(.+):(all|\d+)$/.exec(option.id);
  const rerollEffect =
    reroll === undefined && rerollMatch !== null
      ? state.activeEffects.find(
          (effect): effect is ActiveRerollEffect =>
            effect.type === "reroll" && effect.id === rerollMatch[1],
        )
      : undefined;
  const rerollDieIndex =
    rerollEffect === undefined || rerollMatch === null || rerollMatch[2] === "all"
      ? undefined
      : Number(rerollMatch[2]);
  const afterDefenseEffectIndices =
    option.type === "activate-effect" ? option.effectIndices : undefined;
  const actor = state.combatants[decision.actorId];
  const canUseCloseShave =
    closeShaveKiLoss !== undefined &&
    actor.ki.current >= closeShaveKiLoss &&
    hasActiveConstant(state, decision.actorId, "move-aoyosumu-close-shave");
  const canUseEnergyRedirection =
    energyRedirectionDie !== undefined &&
    decision.actorId === frame.attackerId &&
    energyRedirectionDie < frame.naturalRolls.length &&
    energyRedirectionOptions(state, frame.attackerId, frame.attack, frameRolls).some(
      (candidate) => candidate.id === option.id,
    );
  const canUseActiveReroll =
    rerollEffect !== undefined &&
    rerollOptionsForPostDefense(
      state,
      frame,
      frame.naturalRolls.map((roll) => ({
        attackNaturalResult: roll.attack,
        attackResult: roll.attack,
        defenseNaturalResult: roll.defense,
        defenseResult: roll.defense,
      })),
    ).some((candidate) => candidate.id === option.id);
  const afterDefenseCost =
    afterDefenseEffectIndices === undefined
      ? undefined
      : afterDefenseActivationCost(state, frame, afterDefenseEffectIndices);
  const canUseAfterDefenseEffects =
    afterDefenseEffectIndices !== undefined &&
    afterDefenseCost !== undefined &&
    actor.ki.current >= afterDefenseCost;
  return {
    itemUse,
    closeShaveKiLoss,
    energyRedirectionDie,
    reroll,
    rerollEffect: canUseActiveReroll ? rerollEffect : undefined,
    rerollDieIndex: canUseActiveReroll ? rerollDieIndex : undefined,
    afterDefenseEffectIndices: canUseAfterDefenseEffects ? afterDefenseEffectIndices : undefined,
    canUseCloseShave,
    canUseEnergyRedirection,
    canUseActiveReroll,
    canUseAfterDefenseEffects,
  };
};

const postDefenseReactionInput = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
):
  | {
      readonly pending: NonNullable<ActiveFightState["pendingDecision"]>;
      readonly option: PendingDecisionOption;
      readonly frame: PostDefenseReactionFrame;
    }
  | CombatFailure => {
  const pending = state.pendingDecision;
  if (
    pending === undefined ||
    pending.type !== "post-defense-roll" ||
    pending.id !== decision.pendingDecisionId
  ) {
    return { type: "no-pending-decision", pendingDecisionId: decision.pendingDecisionId };
  }
  if (decision.actorId !== pending.combatantId) {
    return {
      type: "not-active-combatant",
      combatantId: decision.actorId,
      activeCombatantId: pending.combatantId,
    };
  }
  const option = pending.options.find((candidate) => candidate.id === decision.optionId);
  if (option === undefined) {
    return {
      type: "invalid-pending-decision-option",
      pendingDecisionId: pending.id,
      optionId: decision.optionId,
    };
  }
  const frame = state.resolutionFrames.find(
    (candidate): candidate is PostDefenseReactionFrame =>
      candidate.type === "attack" &&
      candidate.stage === "awaiting-post-defense-reaction" &&
      candidate.pendingDecisionId === pending.id,
  );
  return frame === undefined ? invalidFightState(state) : { pending, option, frame };
};

const postDefenseResultOverrides = (
  state: ActiveFightState,
  frame: PostDefenseReactionFrame,
  naturalRolls: readonly ContestedAttackNaturalRoll[],
  defenseResultModifier: number,
  selection: PostDefenseReactionSelection,
) =>
  naturalRolls.map((roll, index) => {
    const pendingAttack = frame.attack;
    const move =
      pendingAttack.type === "move"
        ? MOVE_DEFINITIONS.find((candidate) => candidate.id === pendingAttack.moveId)
        : undefined;
    const attackResult =
      roll.attack +
      state.combatants[frame.attackerId].stats.dexterityBonus +
      activeRollModifier(state, frame.attackerId, "attack", "result", move);
    const defenseResult =
      roll.defense! +
      state.combatants[frame.targetCombatantId].stats.dexterityBonus +
      activeRollModifier(state, frame.targetCombatantId, "defense", "result", move) +
      defenseResultModifier;
    if (selection.energyRedirectionDie === index) return "successful" as const;
    if (
      selection.reroll !== undefined &&
      (selection.reroll.application.roll === "attack" || selection.reroll.dieIndex === index)
    )
      return undefined;
    if (
      selection.rerollEffect !== undefined &&
      rerollIndexesForSelection(
        selection.rerollEffect,
        naturalRolls.length,
        selection.rerollDieIndex,
      ).includes(index)
    )
      return undefined;
    if (selection.closeShaveKiLoss !== undefined && defenseResult === attackResult)
      return "stopped";
    return frame.resultOverrides[index];
  });

const attackerReactionAfterDefenderDecline = (
  state: ActiveFightState,
  frame: PostDefenseReactionFrame,
  option: PendingDecisionOption,
  dependencies: CombatDependencies,
) =>
  option.type === "decline" && frame.reactionCombatantId === frame.targetCombatantId
    ? requestAttackerPostDefenseReaction(state, frame, dependencies)
    : undefined;

const rerollIndexesForSelection = (
  effect: ActiveRerollEffect | undefined,
  naturalRollCount: number,
  dieIndex: number | undefined,
) => {
  if (effect === undefined) return [];
  if (effect.rerollScope === "entire-attack")
    return Array.from({ length: naturalRollCount }, (_, index) => index);
  return dieIndex === undefined ? [] : [dieIndex];
};

const rerollEventCount = (
  effect: ActiveRerollEffect | undefined,
  naturalRollCount: number,
  dieIndex: number | undefined,
) => rerollIndexesForSelection(effect, naturalRollCount, dieIndex).length;

const selectedAfterDefenseEffects = (
  state: ActiveFightState,
  frame: PostDefenseReactionFrame,
  effectIndices: readonly number[] | undefined,
) => {
  if (effectIndices === undefined) return undefined;
  const moveId = "moveId" in frame.attack ? frame.attack.moveId : undefined;
  if (moveId === undefined) return undefined;
  const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === moveId);
  if (move === undefined) return undefined;
  const attacker = state.combatants[frame.attackerId];
  const defender = state.combatants[frame.targetCombatantId];
  return moveEffectsForTrigger(move, "after-defense-roll", {
    ...convertedAttackEffectContext(state, attacker, defender, move),
    collectPendingChoices: true,
    enabledOptionalEffectIndices: effectIndices,
    rolls: postDefenseFrameRolls(state, frame).map((roll) => ({
      attackNaturalResult: roll.attackNaturalResult,
      attackResult: roll.attackResult,
      defenseNaturalResult: roll.defenseNaturalResult,
      defenseResult: roll.defenseResult,
      outcome: roll.outcome,
    })),
  });
};

const postDefenseReactionResolution = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
  frame: PostDefenseReactionFrame,
  selection: PostDefenseReactionSelection,
  dependencies: CombatDependencies,
) => {
  const { closeShaveKiLoss, energyRedirectionDie, itemUse, reroll, rerollEffect, rerollDieIndex } =
    selection;
  const afterDefenseEffects = selectedAfterDefenseEffects(
    state,
    frame,
    selection.afterDefenseEffectIndices,
  );
  const defenseItemUse = itemUse === undefined ? undefined : { ...itemUse, response: decision };
  const defenseResultModifier = (defenseItemUse?.modifier.amount ?? 0) + (closeShaveKiLoss ?? 0);
  const attackMove = pendingAttackMove(frame.attack);
  const attackSides =
    attackMove === undefined
      ? GLOBAL_RULES.combat.standardDieSides +
        activeRollModifier(state, frame.attackerId, "attack", "sides")
      : adjustedAttackRoll(
          state,
          frame.attackerId,
          attackMove.mechanics.attack?.attackRoll ?? defaultMoveAttackRoll(),
          attackMove,
        ).sides;
  const defenseSides =
    GLOBAL_RULES.combat.standardDieSides +
    activeRollModifier(state, frame.targetCombatantId, "defense", "sides", attackMove);
  const activeIndexes = rerollIndexesForSelection(
    rerollEffect,
    frame.naturalRolls.length,
    rerollDieIndex,
  );
  const naturalRolls = frame.naturalRolls.map((roll, index) => {
    if (
      reroll?.application.roll === "attack" ||
      (rerollEffect?.roll === "attack" && activeIndexes.includes(index))
    )
      return { ...roll, attack: dependencies.random.integer(1, attackSides) };
    if (
      (reroll?.dieIndex === index && reroll.application.roll === "defense") ||
      (rerollEffect?.roll === "defense" && activeIndexes.includes(index))
    )
      return { ...roll, defense: dependencies.random.integer(1, defenseSides) };
    return roll;
  });
  const numericResultOverrides = frame.numericResultOverrides.map((override, index) => {
    if (reroll?.application.roll === "attack")
      return {
        ...override,
        attack:
          naturalRolls[index].attack +
          state.combatants[frame.attackerId].stats.dexterityBonus +
          activeRollModifier(state, frame.attackerId, "attack", "result", attackMove) +
          reroll.application.resultModifier,
      };
    if (reroll?.application.roll === "defense" && reroll.dieIndex === index)
      return {
        ...override,
        defense:
          naturalRolls[index].defense +
          state.combatants[frame.targetCombatantId].stats.dexterityBonus +
          activeRollModifier(state, frame.targetCombatantId, "defense", "result", attackMove) +
          reroll.application.resultModifier,
      };
    if (rerollEffect !== undefined && activeIndexes.includes(index))
      return {
        ...override,
        ...(rerollEffect.roll === "attack"
          ? {
              attack:
                naturalRolls[index].attack +
                state.combatants[frame.attackerId].stats.dexterityBonus +
                rerollEffect.bonus,
            }
          : {
              defense:
                naturalRolls[index].defense +
                state.combatants[frame.targetCombatantId].stats.dexterityBonus +
                rerollEffect.bonus,
            }),
      };
    const selectedAttackRollModifications =
      afterDefenseEffects?.rollModifications.filter(
        (effect) =>
          effect.target === "self" && effect.roll === "attack" && effect.modifier === "result",
      ) ?? [];
    if (selectedAttackRollModifications.length > 0)
      return {
        ...override,
        attack:
          (override?.attack ??
            naturalRolls[index].attack +
              state.combatants[frame.attackerId].stats.dexterityBonus +
              activeRollModifier(state, frame.attackerId, "attack", "result", attackMove)) +
          applyStandardRollModificationLimit(
            selectedAttackRollModifications.reduce(
              (total, effect) => total + rollModificationAmount(effect),
              0,
            ),
            attackMove,
            selectedAttackRollModifications.some((effect) => effect.cap?.type === "allow-exceed"),
          ),
      };
    return override;
  });
  let reactionKiCost = rerollEffect?.activationCost;
  if (reroll?.consumesMoveUse === true) reactionKiCost = reroll.kiCost;
  if (energyRedirectionDie !== undefined) reactionKiCost = 1;
  if (closeShaveKiLoss !== undefined) reactionKiCost = closeShaveKiLoss;
  const afterDefenseCost =
    selection.afterDefenseEffectIndices === undefined
      ? undefined
      : afterDefenseActivationCost(state, frame, selection.afterDefenseEffectIndices);
  if (afterDefenseCost !== undefined) reactionKiCost = afterDefenseCost;
  return {
    defenseItemUse,
    defenseResultModifier,
    naturalRolls,
    resultOverrides: postDefenseResultOverrides(
      state,
      frame,
      naturalRolls,
      defenseResultModifier,
      selection,
    ),
    numericResultOverrides,
    reactionKiCost,
    afterDefenseEffectIndices: selection.afterDefenseEffectIndices,
  };
};

interface ResolvedPostDefenseReactionEventsInput {
  readonly state: ActiveFightState;
  readonly decision: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>;
  readonly frame: PostDefenseReactionFrame;
  readonly dependencies: CombatDependencies;
  readonly resolution: ReturnType<typeof postDefenseReactionResolution>;
  readonly selection: PostDefenseReactionSelection;
  readonly reactionState: ActiveFightState;
}

const resolvedRerollEvents = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
  frame: PostDefenseReactionFrame,
  dependencies: CombatDependencies,
  resolution: ReturnType<typeof postDefenseReactionResolution>,
  selection: PostDefenseReactionSelection,
  startingSequence: number,
) => {
  if (selection.rerollEffect === undefined) return [];
  const events: CombatEvent[] = [];
  const indexes = rerollIndexesForSelection(
    selection.rerollEffect,
    resolution.naturalRolls.length,
    selection.rerollDieIndex,
  );
  for (const index of indexes) {
    const rerolled = resolution.naturalRolls[index];
    const result =
      selection.rerollEffect.roll === "attack"
        ? rerolled.attack +
          state.combatants[frame.attackerId].stats.dexterityBonus +
          selection.rerollEffect.bonus
        : rerolled.defense +
          state.combatants[frame.targetCombatantId].stats.dexterityBonus +
          selection.rerollEffect.bonus;
    events.push(
      selection.rerollEffect.roll === "attack"
        ? {
            id: dependencies.ids.nextEventId(),
            sequence: startingSequence + events.length + 1,
            fightId: state.id,
            causedByDecisionId: decision.id,
            type: "attack-rolled" as const,
            combatantId: frame.attackerId,
            targetCombatantId: frame.targetCombatantId,
            ...(frame.attack.type === "basic-attack"
              ? { basicAttack: frame.attack.basicAttack }
              : { moveId: frame.attack.moveId }),
            naturalResult: rerolled.attack,
            result,
          }
        : {
            id: dependencies.ids.nextEventId(),
            sequence: startingSequence + events.length + 1,
            fightId: state.id,
            causedByDecisionId: decision.id,
            type: "defense-rolled" as const,
            combatantId: frame.targetCombatantId,
            sourceCombatantId: frame.attackerId,
            naturalResult: rerolled.defense,
            result,
          },
    );
  }
  return events;
};

const resolvedPostDefenseReactionEvents = ({
  state,
  decision,
  frame,
  dependencies,
  resolution,
  selection,
  reactionState,
  // eslint-disable-next-line sonarjs/cognitive-complexity
}: ResolvedPostDefenseReactionEventsInput) => {
  const events: CombatEvent[] = [];
  let reactionMoveId: MoveDefinition["id"] | undefined;
  if (selection.energyRedirectionDie !== undefined) {
    reactionMoveId = "move-freestyle-energy-redirection";
  } else if (selection.reroll !== undefined) {
    reactionMoveId = selection.reroll.move.id;
  } else if (selection.secondChanceDie !== undefined) {
    reactionMoveId = "move-kurokonwaku-second-chance";
  } else if (selection.rerollEffect !== undefined) {
    reactionMoveId = selection.rerollEffect.sourceDefinitionId;
  }
  if (reactionMoveId !== undefined) {
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: reactionState.eventSequence + events.length + 1,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "move-used",
      combatantId: decision.actorId,
      moveId: reactionMoveId,
      targetCombatantId: frame.targetCombatantId,
    });
  }
  if (selection.secondChanceDie !== undefined) {
    const rerolled = resolution.naturalRolls[selection.secondChanceDie];
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: reactionState.eventSequence + events.length + 1,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "defense-rolled",
      combatantId: frame.targetCombatantId,
      sourceCombatantId: frame.attackerId,
      naturalResult: rerolled.defense,
      result: rerolled.defense + state.combatants[frame.targetCombatantId].stats.dexterityBonus + 5,
    });
  }
  if (selection.reroll !== undefined) {
    const indexes: number[] = [];
    if (selection.reroll.application.roll === "attack")
      indexes.push(...resolution.naturalRolls.map((_, index) => index));
    else if (selection.reroll.dieIndex !== undefined) indexes.push(selection.reroll.dieIndex);
    for (const index of indexes) {
      const rerolled = resolution.naturalRolls[index];
      if (selection.reroll.application.roll === "attack") {
        events.push({
          id: dependencies.ids.nextEventId(),
          sequence: reactionState.eventSequence + events.length + 1,
          fightId: state.id,
          causedByDecisionId: decision.id,
          type: "attack-rolled",
          combatantId: frame.attackerId,
          targetCombatantId: frame.targetCombatantId,
          ...(frame.attack.type === "basic-attack"
            ? { basicAttack: frame.attack.basicAttack }
            : { moveId: frame.attack.moveId }),
          naturalResult: rerolled.attack,
          result:
            resolution.numericResultOverrides[index]?.attack ??
            rerolled.attack +
              state.combatants[frame.attackerId].stats.dexterityBonus +
              activeRollModifier(
                state,
                frame.attackerId,
                "attack",
                "result",
                pendingAttackMove(frame.attack),
              ) +
              selection.reroll.application.resultModifier,
        });
      } else {
        events.push({
          id: dependencies.ids.nextEventId(),
          sequence: reactionState.eventSequence + events.length + 1,
          fightId: state.id,
          causedByDecisionId: decision.id,
          type: "defense-rolled",
          combatantId: frame.targetCombatantId,
          sourceCombatantId: frame.attackerId,
          naturalResult: rerolled.defense,
          result:
            resolution.numericResultOverrides[index]?.defense ??
            rerolled.defense +
              state.combatants[frame.targetCombatantId].stats.dexterityBonus +
              activeRollModifier(
                state,
                frame.targetCombatantId,
                "defense",
                "result",
                pendingAttackMove(frame.attack),
              ) +
              selection.reroll.application.resultModifier,
        });
      }
    }
  }
  events.push(
    ...resolvedRerollEvents(
      state,
      decision,
      frame,
      dependencies,
      resolution,
      selection,
      reactionState.eventSequence + events.length,
    ),
  );
  if (resolution.reactionKiCost !== undefined) {
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: reactionState.eventSequence + events.length + 1,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "ki-changed",
      combatantId: decision.actorId,
      amount: -resolution.reactionKiCost,
      remainingKi: reactionState.combatants[decision.actorId].ki.current,
    });
  }
  return events;
};

const prependReactionEvents = (
  transition: CombatResult<CombatTransition>,
  events: readonly CombatEvent[],
): CombatResult<CombatTransition> =>
  events.length === 0 || !transition.ok
    ? transition
    : { ok: true, value: { ...transition.value, events: [...events, ...transition.value.events] } };

const resumePostDefenseAttack = (
  state: ActiveFightState,
  frame: PostDefenseReactionFrame,
  decision: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
  dependencies: CombatDependencies,
  modifiers: ReturnType<typeof postDefenseReactionModifiers>,
): CombatResult<CombatTransition> => {
  const pendingAttack = frame.attack;
  if (pendingAttack.type === "move") {
    const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === pendingAttack.moveId);
    if (move === undefined) return { ok: false, error: invalidFightState(state) };
    return resolveConvertedAttackMove(
      state,
      {
        type: "use-move",
        id: frame.decisionId,
        actorId: frame.attackerId,
        expectedStateVersion: state.version,
        moveId: move.id,
        targetCombatantId: frame.targetCombatantId,
      },
      move,
      dependencies,
      { requestDefense: false, ...modifiers },
    );
  }
  return resolveBasicAttack(
    state,
    {
      type: "basic-attack",
      id: frame.decisionId,
      actorId: frame.attackerId,
      expectedStateVersion: state.version,
      basicAttack: pendingAttack.basicAttack,
      targetCombatantId: frame.targetCombatantId,
    },
    dependencies,
    false,
    modifiers,
  );
};

const resolvePostDefenseReaction = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> => {
  const input = postDefenseReactionInput(state, decision);
  if ("type" in input) return { ok: false, error: input };
  const { option, frame } = input;

  const selection = postDefenseReactionSelection(state, decision, frame, option);
  if (selection === undefined) {
    return { ok: false, error: { type: "illegal-decision", decisionType: decision.type } };
  }
  const attackerReaction = attackerReactionAfterDefenderDecline(state, frame, option, dependencies);
  if (attackerReaction !== undefined) return attackerReaction;
  const resolution = postDefenseReactionResolution(state, decision, frame, selection, dependencies);
  const baseState = withoutPendingResolution(state);
  const reactionState = postDefenseReactionState(
    baseState,
    decision.actorId,
    resolution.reactionKiCost,
    selection.energyRedirectionDie,
    selection.reroll,
    selection.secondChanceDie,
    selection.rerollEffect,
    rerollEventCount(selection.rerollEffect, frame.naturalRolls.length, selection.rerollDieIndex) +
      1,
    dependencies,
  );
  const modifiers = postDefenseReactionModifiers({
    defenseItemUse: resolution.defenseItemUse,
    defenseResultModifier: resolution.defenseResultModifier,
    naturalRolls: resolution.naturalRolls,
    resultOverrides: resolution.resultOverrides,
    numericResultOverrides: resolution.numericResultOverrides,
    afterDefenseEffectIndices: resolution.afterDefenseEffectIndices,
  });
  const reactionEvents = resolvedPostDefenseReactionEvents({
    state,
    decision,
    frame,
    dependencies,
    resolution,
    selection,
    reactionState,
  });
  return prependReactionEvents(
    resumePostDefenseAttack(reactionState, frame, decision, dependencies, modifiers),
    reactionEvents,
  );
};

const resolveDefenseResponse = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> => {
  const pending = state.pendingDecision;
  if (
    pending === undefined ||
    pending.type !== "defense-response" ||
    pending.id !== decision.pendingDecisionId
  ) {
    return {
      ok: false,
      error: { type: "no-pending-decision", pendingDecisionId: decision.pendingDecisionId },
    };
  }
  if (decision.actorId !== pending.combatantId) {
    return {
      ok: false,
      error: {
        type: "not-active-combatant",
        combatantId: decision.actorId,
        activeCombatantId: pending.combatantId,
      },
    };
  }
  const option = pending.options.find((candidate) => candidate.id === decision.optionId);
  if (option === undefined) {
    return {
      ok: false,
      error: {
        type: "invalid-pending-decision-option",
        pendingDecisionId: pending.id,
        optionId: decision.optionId,
      },
    };
  }
  const frame = state.resolutionFrames.find(
    (candidate): candidate is Extract<typeof candidate, { readonly stage: "awaiting-defense" }> =>
      candidate.type === "attack" &&
      candidate.stage === "awaiting-defense" &&
      candidate.pendingDecisionId === pending.id,
  );
  if (frame === undefined) {
    return { ok: false, error: invalidFightState(state) };
  }
  if (option.type === "use-block" && option.moveId !== undefined) {
    if (frame.attack.type === "move") {
      return resolveBlockedConvertedAttack(state, decision, frame, option.moveId, dependencies);
    }
    return resolveBlockedBasicAttack(state, decision, frame, option.moveId, dependencies);
  }
  const defenseItemUse = defenseItemUseForOption(state, pending, option);
  if (option.type !== "roll-defense" && defenseItemUse === undefined) {
    return { ok: false, error: { type: "illegal-decision", decisionType: decision.type } };
  }
  if (option.type === "roll-defense" && defenseItemUse === undefined) {
    const postRollReaction = requestPostDefenseReaction(state, frame, dependencies);
    if (postRollReaction !== undefined) return postRollReaction;
  }
  return resolveDefenseRoll(state, decision, frame, dependencies, defenseItemUse);
};

type EndPhaseDecision = Extract<CombatDecision, { readonly type: "pass" | "power-up" }>;

const appendPowerUpEvents = (
  state: ActiveFightState,
  decision: Extract<EndPhaseDecision, { readonly type: "power-up" }>,
  dependencies: CombatDependencies,
  activeCombatant: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  activeAfter: ActiveFightState["combatants"][CombatantId],
  targetAfter: ActiveFightState["combatants"][CombatantId],
  activatedEffects: readonly ActiveCombatEffect[],
  statuses: readonly StatusApplication[],
) => {
  const events: CombatEvent[] = [];
  const addKiChange = (
    combatant: ActiveFightState["combatants"][CombatantId],
    nextCombatant: ActiveFightState["combatants"][CombatantId],
  ) => {
    const amount = nextCombatant.ki.current - combatant.ki.current;
    if (amount === 0) return;
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: nextEventSequence(state, events),
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "ki-changed",
      combatantId: combatant.id,
      amount,
      remainingKi: nextCombatant.ki.current,
    });
  };
  addKiChange(activeCombatant, activeAfter);
  addKiChange(target, targetAfter);
  for (const effect of activatedEffects) {
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: nextEventSequence(state, events),
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "effect-activated",
      activeEffectId: effect.id,
      sourceCombatantId: effect.sourceCombatantId,
      targetCombatantId: effect.targetCombatantId,
      sourceDefinitionId: effect.sourceDefinitionId,
    });
  }
  for (const application of statuses) {
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: nextEventSequence(state, events),
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "status-applied",
      sourceCombatantId: decision.actorId,
      targetCombatantId: application.target === "self" ? activeCombatant.id : target.id,
      statusId: application.status.statusId,
      stacks: application.status.stacks,
    });
  }
  return events;
};

const resolveSurrenderDecision = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "surrender" }>,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> => {
  const winnerCombatantId = nextActiveCombatantId(state);
  if (winnerCombatantId === undefined) return { ok: false, error: invalidFightState(state) };
  const nextState: CompletedFightState = {
    id: state.id,
    version: state.version + 1,
    rulesVersion: state.rulesVersion,
    mode: state.mode,
    turnNumber: state.turnNumber,
    combatants: state.combatants,
    activeEffects: [],
    actionHistory: [...state.actionHistory, actionRecordFor(state, decision)],
    resolutionFrames: [],
    eventSequence: state.eventSequence + 2,
    status: "completed",
    completion: { type: "surrender", winnerCombatantId },
  };
  return transitionFrom(nextState, [
    {
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + 1,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "combatant-surrendered",
      combatantId: decision.actorId,
    },
    {
      id: dependencies.ids.nextEventId(),
      sequence: nextState.eventSequence,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "fight-ended",
      completion: nextState.completion,
    },
  ]);
};

const resolveCancellationDecision = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "cancel-fight" }>,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> => {
  const nextState: CompletedFightState = {
    id: state.id,
    version: state.version + 1,
    rulesVersion: state.rulesVersion,
    mode: state.mode,
    turnNumber: state.turnNumber,
    combatants: state.combatants,
    activeEffects: [],
    actionHistory: state.actionHistory,
    resolutionFrames: [],
    eventSequence: state.eventSequence + 1,
    status: "completed",
    completion: { type: "cancelled" },
  };
  return transitionFrom(nextState, [
    {
      id: dependencies.ids.nextEventId(),
      sequence: nextState.eventSequence,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "fight-ended",
      completion: nextState.completion,
    },
  ]);
};

const resolveEndPhaseDecision = (
  state: ActiveFightState,
  decision: EndPhaseDecision,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> => {
  const activeCombatant = state.combatants[decision.actorId];
  const target = Object.values(state.combatants).find(
    (combatant) => combatant.id !== activeCombatant.id && combatant.status === "active",
  );
  if (target === undefined) return { ok: false, error: invalidFightState(state) };
  const powerUpAmount =
    decision.type === "power-up"
      ? Math.min(
          GLOBAL_RULES.combat.powerUpKiGain,
          activeCombatant.ki.maximum - activeCombatant.ki.current,
        )
      : 0;
  const actionHistory = [...state.actionHistory, actionRecordFor(state, decision)];
  const triggered =
    decision.type === "power-up"
      ? powerUpTriggeredEffects(state, activeCombatant, target, actionHistory)
      : [];
  const powerUpResourceChanges: readonly ResourceChange[] =
    decision.type === "power-up" && powerUpAmount > 0
      ? [
          {
            resource: "ki",
            target: "self",
            operation: "gain",
            amount: powerUpAmount,
            sourceCombatantId: activeCombatant.id,
            cause: "non-damage-effect",
          },
        ]
      : [];
  const allowedPowerUpResourceChanges = resourceChangesAfterPreventions(
    activeCombatant,
    target,
    powerUpResourceChanges,
    state.activeEffects,
    actionRecordFor(state, decision),
  );
  const resourceTriggered = resourceEventTriggeredEffects(
    state,
    activeCombatant,
    target,
    allowedPowerUpResourceChanges,
    actionHistory,
  );
  const triggeredChanges = triggered.reduce(
    (changes, source) => ({
      resources: [...changes.resources, ...source.effects.resources],
      statuses: [...changes.statuses, ...source.effects.statuses],
    }),
    { resources: [] as ResourceChange[], statuses: [] as StatusApplication[] },
  );
  const resourceTriggeredChanges = resourceTriggered.reduce(
    (changes, source) => ({
      resources: [...changes.resources, ...source.effects.resources],
      statuses: [...changes.statuses, ...source.effects.statuses],
    }),
    { resources: [] as ResourceChange[], statuses: [] as StatusApplication[] },
  );
  const allTriggeredChanges = {
    resources: resourceChangesAfterPreventions(
      activeCombatant,
      target,
      [...triggeredChanges.resources, ...resourceTriggeredChanges.resources],
      state.activeEffects,
      actionRecordFor(state, decision),
    ),
    statuses: [...triggeredChanges.statuses, ...resourceTriggeredChanges.statuses],
  };
  const activeAfterPowerUp = resourceAfterChanges(
    {
      ...activeCombatant,
      ki: {
        ...activeCombatant.ki,
        current:
          activeCombatant.ki.current +
          (allowedPowerUpResourceChanges.length === 0 ? 0 : powerUpAmount),
      },
    },
    allTriggeredChanges.resources,
    "self",
    state.activeEffects,
    actionRecordFor(state, decision),
  );
  const targetAfterPowerUp = resourceAfterChanges(
    target,
    allTriggeredChanges.resources,
    "opponent",
    state.activeEffects,
    actionRecordFor(state, decision),
  );
  const activeAfterStatuses = statusesAfterApplications(
    activeAfterPowerUp,
    allTriggeredChanges.statuses,
    "self",
  );
  const targetAfterStatuses = statusesAfterApplications(
    targetAfterPowerUp,
    allTriggeredChanges.statuses,
    "opponent",
  );
  const activatedEffects = [
    ...triggered.flatMap(({ sourceMove, effects }) =>
      convertedAttackActivatedEffects({
        state,
        dependencies,
        attacker: activeCombatant,
        target,
        move: sourceMove,
        createdOnTurn: state.turnNumber,
        effects,
        defeated: false,
      }),
    ),
    ...resourceTriggered.flatMap(({ sourceMove, owner, target: eventTarget, effects }) =>
      convertedAttackActivatedEffects({
        state,
        dependencies,
        attacker: owner,
        target: eventTarget,
        move: sourceMove,
        createdOnTurn: state.turnNumber,
        effects,
        defeated: false,
      }),
    ),
  ];
  const consumedExtraActionEffects = consumeExtraActionForDecision(state, decision);
  const stateAfterExtraActionConsumption = {
    ...state,
    activeEffects: consumedExtraActionEffects,
  };
  const nextState: ActiveFightState = {
    ...state,
    version: state.version + 1,
    phase: "end",
    eventSequence: state.eventSequence,
    actionHistory,
    combatants:
      decision.type === "power-up"
        ? {
            ...state.combatants,
            [decision.actorId]: activeAfterStatuses,
            [target.id]: targetAfterStatuses,
          }
        : state.combatants,
    activeEffects: powerUpActiveEffects(
      {
        ...stateAfterExtraActionConsumption,
        activeEffects: floatingEffectsAfterPowerUp(
          stateAfterExtraActionConsumption,
          activeCombatant.id,
        ),
      },
      activatedEffects,
    ),
  };
  const events =
    decision.type === "power-up"
      ? appendPowerUpEvents(
          state,
          decision,
          dependencies,
          activeCombatant,
          target,
          activeAfterStatuses,
          targetAfterStatuses,
          activatedEffects,
          allTriggeredChanges.statuses,
        )
      : [];
  const eventSequence = state.eventSequence + events.length + 1;
  const finalState = { ...nextState, eventSequence };
  events.push(createPhaseChangedEvent(state, dependencies, "end", eventSequence, decision.id));
  return transitionFrom(finalState, events);
};

const actionSubmissionFailure = (
  state: ActiveFightState,
  decision: ResolvedActionDecision,
): CombatFailure | undefined => {
  if (decision.actorId !== state.activeCombatantId) {
    return {
      type: "not-active-combatant",
      combatantId: decision.actorId,
      activeCombatantId: state.activeCombatantId,
    };
  }
  if (state.phase !== "action" && state.phase !== "counter") {
    return { type: "wrong-phase", expected: ["action", "counter"], actual: state.phase };
  }
  return state.pendingDecision === undefined
    ? undefined
    : { type: "unsupported-mechanic", mechanic: "pending decision resolution" };
};

const forcedActionFor = (
  state: ActiveFightState,
  combatantId: CombatantId,
): Extract<ActiveCombatEffect, { readonly type: "force-next-action" }> | undefined =>
  state.activeEffects.find(
    (effect): effect is Extract<ActiveCombatEffect, { readonly type: "force-next-action" }> =>
      effect.type === "force-next-action" && effect.targetCombatantId === combatantId,
  );

const activeSuppressionFromApplication = (
  suppression: SuppressionApplication,
  sourceCombatantId: CombatantId,
  opponentCombatantId: CombatantId,
  sourceDefinitionId: MoveDefinition["id"],
  dependencies: CombatDependencies,
): Extract<ActiveCombatEffect, { readonly type: "suppress" }> => {
  const targetCombatantId = suppression.target === "self" ? sourceCombatantId : opponentCombatantId;
  let duration: Extract<ActiveCombatEffect, { readonly type: "suppress" }>["duration"];
  if (suppression.duration.type === "turns")
    duration = {
      type: "turns",
      ownerCombatantId: targetCombatantId,
      remaining: suppression.duration.remaining,
    };
  else if (suppression.duration.type === "next-actions")
    duration = {
      type: "next-actions",
      ownerCombatantId: targetCombatantId,
      remaining: suppression.duration.remaining,
    };
  else if (suppression.duration.type === "until-roll-threshold")
    duration = { ...suppression.duration, combatantId: targetCombatantId };
  else duration = { type: "combat" };
  return {
    id: dependencies.ids.nextActiveEffectId(),
    type: "suppress",
    sourceCombatantId,
    targetCombatantId,
    sourceDefinitionId,
    ...(suppression.selector === undefined ? {} : { selector: suppression.selector }),
    aspects: suppression.aspects,
    duration,
  };
};

const activeLockFromApplication = (
  lock: LockApplication,
  sourceCombatantId: CombatantId,
  opponentCombatantId: CombatantId,
  sourceDefinitionId: MoveDefinition["id"],
  dependencies: CombatDependencies,
): Extract<ActiveCombatEffect, { readonly type: "action-lock" }> => {
  const targetCombatantId = lock.target === "self" ? sourceCombatantId : opponentCombatantId;
  const combatantId = (subject: "self" | "opponent") =>
    subject === "self" ? sourceCombatantId : opponentCombatantId;
  const lockDuration = lock.duration;
  let duration: Extract<ActiveCombatEffect, { readonly type: "action-lock" }>["duration"];
  switch (lockDuration.type) {
    case "turns":
      duration = {
        type: "turns",
        ownerCombatantId: targetCombatantId,
        remaining: lockDuration.remaining,
      };
      break;
    case "next-actions":
      duration = {
        type: "next-actions",
        ownerCombatantId: targetCombatantId,
        remaining: lockDuration.remaining,
      };
      break;
    case "until-resource-threshold":
      duration = { ...lockDuration, combatantId: combatantId(lockDuration.subject) };
      break;
    case "until-combat-result":
      duration = { ...lockDuration, combatantId: combatantId(lockDuration.actor) };
      break;
    case "until-roll-threshold":
      duration = { ...lockDuration, combatantId: targetCombatantId };
      break;
    case "until-turn-start-roll-threshold":
      duration = { ...lockDuration, combatantId: combatantId(lockDuration.subject) };
      break;
    case "combat":
      duration = { type: "combat" };
      break;
  }
  return {
    id: dependencies.ids.nextActiveEffectId(),
    type: "action-lock",
    sourceCombatantId,
    targetCombatantId,
    sourceDefinitionId,
    affectedType: lock.affectedType,
    ...(lock.selector === undefined ? {} : { selector: lock.selector }),
    duration,
  };
};

type PersistedPreventionDuration = Extract<
  ActiveCombatEffect,
  { readonly type: "prevent-move-use" }
>["duration"];

const persistedPreventionDuration = (
  duration: LockApplication["duration"],
  targetCombatantId: CombatantId,
  combatantId: (subject: "self" | "opponent") => CombatantId,
): PersistedPreventionDuration => {
  switch (duration.type) {
    case "turns":
      return { type: "turns", ownerCombatantId: targetCombatantId, remaining: duration.remaining };
    case "next-actions":
      return {
        type: "next-actions",
        ownerCombatantId: targetCombatantId,
        remaining: duration.remaining,
      };
    case "until-resource-threshold":
      return { ...duration, combatantId: combatantId(duration.subject) };
    case "until-combat-result":
      return { ...duration, combatantId: combatantId(duration.actor) };
    case "until-roll-threshold":
      return { ...duration, combatantId: targetCombatantId };
    case "until-turn-start-roll-threshold":
      return { ...duration, combatantId: combatantId(duration.subject) };
    case "combat":
      return { type: "combat" };
  }
};

const activeMoveUsePreventionFromApplication = (
  prevention: MoveUsePreventionApplication,
  sourceCombatantId: CombatantId,
  opponentCombatantId: CombatantId,
  sourceDefinitionId: MoveDefinition["id"],
  dependencies: CombatDependencies,
): Extract<ActiveCombatEffect, { readonly type: "prevent-move-use" }> => {
  const targetCombatantId = prevention.target === "self" ? sourceCombatantId : opponentCombatantId;
  const combatantId = (subject: "self" | "opponent") =>
    subject === "self" ? sourceCombatantId : opponentCombatantId;
  const persistedDuration = persistedPreventionDuration(
    prevention.duration,
    targetCombatantId,
    combatantId,
  );
  return {
    id: dependencies.ids.nextActiveEffectId(),
    type: "prevent-move-use",
    sourceCombatantId,
    targetCombatantId,
    sourceDefinitionId,
    operation: prevention.operation,
    ...(prevention.selector === undefined ? {} : { selector: prevention.selector }),
    duration: persistedDuration,
  };
};

const activeStatusPreventionFromApplication = (
  prevention: StatusPreventionApplication,
  sourceCombatantId: CombatantId,
  opponentCombatantId: CombatantId,
  sourceDefinitionId: MoveDefinition["id"],
  dependencies: CombatDependencies,
): Extract<ActiveCombatEffect, { readonly type: "prevent-status" }> => {
  const targetCombatantId = prevention.target === "self" ? sourceCombatantId : opponentCombatantId;
  const combatantId = (subject: "self" | "opponent") =>
    subject === "self" ? sourceCombatantId : opponentCombatantId;
  const persistedDuration = persistedPreventionDuration(
    prevention.duration,
    targetCombatantId,
    combatantId,
  );
  return {
    id: dependencies.ids.nextActiveEffectId(),
    type: "prevent-status",
    sourceCombatantId,
    targetCombatantId,
    sourceDefinitionId,
    statusId: prevention.statusId,
    duration: persistedDuration,
  };
};

const activeCombatResultPreventionFromApplication = (
  prevention: CombatResultPreventionApplication,
  sourceCombatantId: CombatantId,
  opponentCombatantId: CombatantId,
  sourceDefinitionId: MoveDefinition["id"],
  dependencies: CombatDependencies,
): Extract<ActiveCombatEffect, { readonly type: "prevent-combat-result" }> => {
  const targetCombatantId = prevention.target === "self" ? sourceCombatantId : opponentCombatantId;
  const combatantId = (subject: "self" | "opponent") =>
    subject === "self" ? sourceCombatantId : opponentCombatantId;
  const persistedDuration = persistedPreventionDuration(
    prevention.duration,
    targetCombatantId,
    combatantId,
  );
  return {
    id: dependencies.ids.nextActiveEffectId(),
    type: "prevent-combat-result",
    sourceCombatantId,
    targetCombatantId,
    sourceDefinitionId,
    result: prevention.result,
    ...(prevention.selector === undefined ? {} : { selector: prevention.selector }),
    duration: persistedDuration,
  };
};

const activeRollModificationPreventionFromApplication = (
  prevention: RollModificationPreventionApplication,
  sourceCombatantId: CombatantId,
  opponentCombatantId: CombatantId,
  sourceDefinitionId: MoveDefinition["id"],
  dependencies: CombatDependencies,
): Extract<ActiveCombatEffect, { readonly type: "prevent-roll-modification" }> => {
  const targetCombatantId = prevention.target === "self" ? sourceCombatantId : opponentCombatantId;
  const combatantId = (subject: "self" | "opponent") =>
    subject === "self" ? sourceCombatantId : opponentCombatantId;
  return {
    id: dependencies.ids.nextActiveEffectId(),
    type: "prevent-roll-modification",
    sourceCombatantId,
    targetCombatantId,
    sourceDefinitionId,
    roll: prevention.roll,
    modifier: prevention.modifier,
    ...(prevention.selector === undefined ? {} : { selector: prevention.selector }),
    ...(prevention.exemptSourceEffect === true ? { exemptSourceEffect: true } : {}),
    duration: persistedPreventionDuration(prevention.duration, targetCombatantId, combatantId),
  };
};

const activeMoveModificationPreventionFromApplication = (
  prevention: MoveModificationPreventionApplication,
  sourceCombatantId: CombatantId,
  opponentCombatantId: CombatantId,
  sourceDefinitionId: MoveDefinition["id"],
  dependencies: CombatDependencies,
): Extract<ActiveCombatEffect, { readonly type: "prevent-move-modification" }> => {
  const targetCombatantId = prevention.target === "self" ? sourceCombatantId : opponentCombatantId;
  const combatantId = (subject: "self" | "opponent") =>
    subject === "self" ? sourceCombatantId : opponentCombatantId;
  return {
    id: dependencies.ids.nextActiveEffectId(),
    type: "prevent-move-modification",
    sourceCombatantId,
    targetCombatantId,
    sourceDefinitionId,
    actor: prevention.actor,
    aspects: prevention.aspects,
    selector: prevention.selector,
    ...(prevention.effectSourceStyleExcludes === undefined
      ? {}
      : { effectSourceStyleExcludes: prevention.effectSourceStyleExcludes }),
    ...(prevention.exceptSourceMoveIds === undefined
      ? {}
      : { exceptSourceMoveIds: prevention.exceptSourceMoveIds }),
    ...(prevention.exceptSourceStatusIds === undefined
      ? {}
      : { exceptSourceStatusIds: prevention.exceptSourceStatusIds }),
    ...(prevention.operations === undefined ? {} : { operations: prevention.operations }),
    duration: persistedPreventionDuration(prevention.duration, targetCombatantId, combatantId),
  };
};

const activeResourceModificationPreventionFromApplication = (
  prevention: ResourceModificationPreventionApplication,
  sourceCombatantId: CombatantId,
  opponentCombatantId: CombatantId,
  sourceDefinitionId: MoveDefinition["id"],
  dependencies: CombatDependencies,
): Extract<ActiveCombatEffect, { readonly type: "prevent-resource-modification" }> | undefined => {
  if (prevention.duration === undefined) return undefined;
  const targetCombatantId = prevention.target === "self" ? sourceCombatantId : opponentCombatantId;
  const combatantId = (subject: "self" | "opponent") =>
    subject === "self" ? sourceCombatantId : opponentCombatantId;
  return {
    id: dependencies.ids.nextActiveEffectId(),
    type: "prevent-resource-modification",
    sourceCombatantId,
    targetCombatantId,
    sourceDefinitionId,
    resource: prevention.resource,
    operation: prevention.operation,
    ...(prevention.sourceActor === undefined ? {} : { sourceActor: prevention.sourceActor }),
    ...(prevention.exceptAction === undefined ? {} : { exceptAction: prevention.exceptAction }),
    duration: persistedPreventionDuration(prevention.duration, targetCombatantId, combatantId),
  };
};

/** Persists durable converted roll changes; immediate changes stay inside the roll resolution. */
const activeRollCapFromApplication = (
  application: RollModification,
):
  | ActiveRollModificationCap
  | Extract<ActiveRollModifierEffect["cap"], { readonly type: "maximum" | "minimum" }>
  | undefined => {
  if (application.cap === undefined) return undefined;
  if (application.cap.type === "allow-exceed")
    return {
      type: "allow-exceed",
      scope: application.cap.scope ?? "amount",
    };
  return {
    type: application.cap.type,
    scope: application.cap.scope,
    value: application.cap.value,
  };
};

const isDeferredRollModificationScope = (scope: RollModification["scope"]) =>
  scope === "following-action" ||
  scope === "next-action" ||
  scope === "next-actions" ||
  scope === "next-phase" ||
  scope === "next-roll" ||
  scope === "next-rolls" ||
  scope === "next-turn";

const activeRollModifierDuration = (
  application: RollModification,
  targetCombatantId: CombatantId,
): ActiveRollModifierEffect["duration"] =>
  application.duration === undefined || application.duration.type === "combat"
    ? "combat"
    : {
        type: application.duration.type,
        ownerCombatantId: targetCombatantId,
        remaining: application.duration.remaining,
      };

const activeRollModifierIsImmediate = (application: RollModification) =>
  application.scope === "combat" || (application.scope === undefined && application.duration);

const deferredActiveRollModifierFromApplication = (
  application: RollModification,
  sourceCombatantId: CombatantId,
  opponentCombatantId: CombatantId,
  sourceDefinitionId: MoveDefinition["id"],
  createdOnTurn: number,
  cap: ActiveRollModifierEffect["cap"],
  dependencies: CombatDependencies,
): ActiveCombatEffect | undefined => {
  if (!isDeferredRollModificationScope(application.scope)) return undefined;
  const targetCombatantId = application.target === "self" ? sourceCombatantId : opponentCombatantId;
  return {
    id: dependencies.ids.nextActiveEffectId(),
    type: "modify-next-action",
    sourceCombatantId,
    targetCombatantId,
    sourceDefinitionId,
    modifier: {
      type: "roll",
      roll: application.roll,
      modifier: application.modifier,
      amount: application.amount,
      ...(cap === undefined ? {} : { cap }),
    },
    ...(application.selector === undefined ? {} : { selector: application.selector }),
    ...(application.stacking === undefined ? {} : { stacking: application.stacking }),
    scope: application.scope,
    ...(application.remaining === undefined ? {} : { remaining: application.remaining }),
    ...(application.scope === "following-action" ? { availableFromTurn: createdOnTurn + 1 } : {}),
    ...(application.scope === "next-turn" ? { availableFromTurn: createdOnTurn + 1 } : {}),
  };
};

export const activeRollModifierFromApplication = (
  application: RollModification,
  sourceCombatantId: CombatantId,
  opponentCombatantId: CombatantId,
  sourceDefinitionId: MoveDefinition["id"],
  createdOnTurn: number,
  dependencies: CombatDependencies,
): ActiveCombatEffect | undefined => {
  const targetCombatantId = application.target === "self" ? sourceCombatantId : opponentCombatantId;
  const cap = activeRollCapFromApplication(application);
  const duration = activeRollModifierDuration(application, targetCombatantId);
  if (activeRollModifierIsImmediate(application))
    return {
      id: dependencies.ids.nextActiveEffectId(),
      type: "modify-roll",
      sourceCombatantId,
      targetCombatantId,
      sourceDefinitionId,
      roll: application.roll,
      modifier: application.modifier,
      amount: rollModificationAmount(application),
      ...(cap === undefined ? {} : { cap }),
      ...(application.selector === undefined ? {} : { selector: application.selector }),
      ...(application.stacking === undefined ? {} : { stacking: application.stacking }),
      duration,
    };
  return deferredActiveRollModifierFromApplication(
    application,
    sourceCombatantId,
    opponentCombatantId,
    sourceDefinitionId,
    createdOnTurn,
    cap,
    dependencies,
  );
};

const activeRollModifiersFromApplications = (
  applications: readonly RollModification[],
  sourceCombatantId: CombatantId,
  opponentCombatantId: CombatantId,
  sourceDefinitionId: MoveDefinition["id"],
  createdOnTurn: number,
  dependencies: CombatDependencies,
): readonly ActiveCombatEffect[] =>
  applications.flatMap((application) => {
    const effect = activeRollModifierFromApplication(
      application,
      sourceCombatantId,
      opponentCombatantId,
      sourceDefinitionId,
      createdOnTurn,
      dependencies,
    );
    return effect === undefined ? [] : [effect];
  });

const activeRerollFromApplication = (
  application: RerollApplication,
  sourceCombatantId: CombatantId,
  opponentCombatantId: CombatantId,
  dependencies: CombatDependencies,
): Extract<ActiveCombatEffect, { readonly type: "reroll" }> | undefined => {
  if (application.activationResource === "hp") return undefined;
  return {
    id: dependencies.ids.nextActiveEffectId(),
    type: "reroll",
    sourceCombatantId,
    targetCombatantId: application.target === "self" ? sourceCombatantId : opponentCombatantId,
    sourceDefinitionId: application.sourceDefinitionId,
    sourceEffectIndex: application.effectIndex,
    roll: application.roll,
    rerollScope: application.rerollScope,
    ...(application.selector === undefined ? {} : { selector: application.selector }),
    bonus: application.resultModifier,
    conditions: application.conditions,
    ...(application.activationResource === undefined
      ? {}
      : { activationResource: application.activationResource }),
    ...(application.activationCost === undefined
      ? {}
      : { activationCost: application.activationCost }),
    duration: { type: "combat" },
    ...(application.useLimit === undefined
      ? {}
      : {
          useLimit: {
            scope: application.useLimit.scope,
            remaining: application.useLimit.count,
          },
        }),
  };
};

const activeRerollsFromApplications = (
  applications: readonly RerollApplication[],
  sourceCombatantId: CombatantId,
  opponentCombatantId: CombatantId,
  dependencies: CombatDependencies,
) =>
  applications.flatMap((application) => {
    const active = activeRerollFromApplication(
      application,
      sourceCombatantId,
      opponentCombatantId,
      dependencies,
    );
    return active === undefined ? [] : [active];
  });

const activeResolutionThresholdsFromApplications = (
  applications: readonly ResolutionThresholdApplication[],
  sourceCombatantId: CombatantId,
  opponentCombatantId: CombatantId,
  sourceDefinitionId: MoveDefinition["id"],
  dependencies: CombatDependencies,
): readonly ActiveCombatEffect[] =>
  applications.flatMap<ActiveCombatEffect>((application) => {
    if (application.scope !== "next-action" && application.duration === undefined) return [];
    const targetCombatantId =
      application.target === "self" ? sourceCombatantId : opponentCombatantId;
    const appliesTo = application.roll === "attack" ? "target" : "source";
    const applyingCombatantId = appliesTo === "source" ? sourceCombatantId : targetCombatantId;
    const otherCombatantId = appliesTo === "source" ? targetCombatantId : sourceCombatantId;
    const duration =
      application.duration?.type === "until-roll-threshold"
        ? {
            type: "until-roll-threshold" as const,
            combatantId:
              application.duration.roll === "attack" ? applyingCombatantId : otherCombatantId,
            roll: application.duration.roll,
            comparison: application.duration.comparison,
            value: application.duration.value,
          }
        : { type: "combat" as const };
    return [
      {
        id: dependencies.ids.nextActiveEffectId(),
        type: "set-resolution-threshold" as const,
        sourceCombatantId,
        targetCombatantId,
        sourceDefinitionId,
        outcome: application.outcome,
        roll: application.roll,
        comparison: application.comparison,
        value: application.value,
        ...(application.relativeTo === undefined ? {} : { relativeTo: application.relativeTo }),
        ...(application.relativeOperation === undefined
          ? {}
          : { relativeOperation: application.relativeOperation }),
        resultScope: application.resultScope,
        ...(application.selector === undefined ? {} : { selector: application.selector }),
        appliesTo,
        ...(application.scope === "next-action" ? { scope: application.scope } : {}),
        duration,
      },
    ];
  });

const activeScheduledResourcesFromApplications = (
  state: ActiveFightState,
  applications: readonly ScheduledResourceApplication[],
  sourceCombatantId: CombatantId,
  opponentCombatantId: CombatantId,
  sourceDefinitionId: MoveDefinition["id"],
  dependencies: CombatDependencies,
): readonly ActiveCombatEffect[] =>
  applications.flatMap<ActiveCombatEffect>((application) => {
    const targetCombatantId =
      application.target === "self" ? sourceCombatantId : opponentCombatantId;
    if (
      application.stacking === "prevent" &&
      state.activeEffects.some(
        (effect) =>
          effect.type === "scheduled-resource" &&
          effect.sourceCombatantId === sourceCombatantId &&
          effect.targetCombatantId === targetCombatantId &&
          effect.sourceDefinitionId === sourceDefinitionId &&
          effect.sourceEffectIndex === application.effectIndex,
      )
    )
      return [];
    const relativeCombatantId = (subject: "self" | "opponent") =>
      subject === "self" ? sourceCombatantId : opponentCombatantId;
    return [
      {
        id: dependencies.ids.nextActiveEffectId(),
        type: "scheduled-resource",
        sourceCombatantId,
        targetCombatantId,
        sourceDefinitionId,
        sourceEffectIndex: application.effectIndex,
        timing: {
          type: application.timing.type,
          combatantId: relativeCombatantId(application.timing.subject),
          ...(application.timing.phase === undefined ? {} : { phase: application.timing.phase }),
        },
        remainingBoundaries: Math.max(1, application.timing.turnsAfter),
        repeat: application.repeat,
        resource: application.resource,
        operation: application.operation,
        amount: application.amount,
        ...(application.stacking === undefined ? {} : { stacking: application.stacking }),
        ...(application.duration === undefined
          ? {}
          : {
              duration:
                application.duration.type === "turns"
                  ? application.duration
                  : { ...application.duration, combatantId: targetCombatantId },
            }),
        ...(application.cancellation === undefined
          ? {}
          : {
              cancellation: {
                actorCombatantId: relativeCombatantId(application.cancellation.actor),
                result: application.cancellation.result,
                moveSelector: application.cancellation.moveSelector,
                target: application.cancellation.target,
                ...(application.cancellation.rollThreshold === undefined
                  ? {}
                  : { rollThreshold: application.cancellation.rollThreshold }),
              },
            }),
      },
    ];
  });

const deferredDamageBasis = (basis: DamageModification["basis"]) =>
  basis === "damage-percent" ? { basis } : {};

const activeDamageModifiersFromApplications = (
  applications: readonly DamageModification[],
  sourceCombatantId: CombatantId,
  opponentCombatantId: CombatantId,
  sourceDefinitionId: MoveDefinition["id"],
  createdOnTurn: number,
  dependencies: CombatDependencies,
): readonly ActiveCombatEffect[] =>
  applications.flatMap<ActiveCombatEffect>((application) => {
    const targetCombatantId =
      application.target === "self" ? sourceCombatantId : opponentCombatantId;
    if (application.duration !== undefined) {
      return [
        {
          id: dependencies.ids.nextActiveEffectId(),
          type: "modify-damage" as const,
          sourceCombatantId,
          targetCombatantId,
          sourceDefinitionId,
          ...(application.selector === undefined ? {} : { selector: application.selector }),
          operation: application.operation,
          basis: application.basis,
          amount: application.amount,
          ...(application.cap === undefined ? {} : { cap: application.cap }),
          ...(application.availableFromTurn === undefined
            ? {}
            : { availableFromTurn: application.availableFromTurn }),
          duration: application.duration,
        },
      ];
    }
    if (
      application.scope !== "following-action" &&
      application.scope !== "next-action" &&
      application.scope !== "next-actions"
    )
      return [];
    return [
      {
        id: dependencies.ids.nextActiveEffectId(),
        type: "modify-next-action" as const,
        sourceCombatantId,
        targetCombatantId,
        sourceDefinitionId,
        ...(application.selector === undefined ? {} : { selector: application.selector }),
        scope: application.scope,
        ...(application.remaining === undefined ? {} : { remaining: application.remaining }),
        ...(application.scope === "following-action"
          ? { availableFromTurn: createdOnTurn + 1 }
          : {}),
        modifier: {
          type: "damage" as const,
          amount: application.amount,
          ...deferredDamageBasis(application.basis),
          ...(application.cap === undefined ? {} : { cap: application.cap }),
          ...(application.operation === "add" ? {} : { operation: application.operation }),
        },
      },
    ];
  });

const activeStatModifiersFromApplications = (
  applications: readonly StatModification[],
  sourceCombatantId: CombatantId,
  opponentCombatantId: CombatantId,
  sourceDefinitionId: MoveDefinition["id"],
  dependencies: CombatDependencies,
): readonly ActiveCombatEffect[] =>
  applications.flatMap<ActiveCombatEffect>((application) => {
    const targetCombatantId =
      application.target === "self" ? sourceCombatantId : opponentCombatantId;
    if (application.duration !== undefined) {
      return [
        {
          id: dependencies.ids.nextActiveEffectId(),
          type: "modify-stat" as const,
          sourceCombatantId,
          targetCombatantId,
          sourceDefinitionId,
          stat: application.stat,
          operation: application.operation,
          amount: application.amount,
          ...(application.selector === undefined ? {} : { selector: application.selector }),
          duration: application.duration,
        },
      ];
    }
    if (application.scope === undefined) return [];
    return [
      {
        id: dependencies.ids.nextActiveEffectId(),
        type: "modify-next-action" as const,
        sourceCombatantId,
        targetCombatantId,
        sourceDefinitionId,
        ...(application.selector === undefined ? {} : { selector: application.selector }),
        scope: application.scope,
        modifier: {
          type: "stat" as const,
          stat: application.stat,
          operation: application.operation,
          amount: application.amount,
          ...(application.roll === undefined ? {} : { roll: application.roll }),
        },
      },
    ];
  });

const numericSelectorComparison = (
  left: number,
  comparison: "at-least" | "at-most" | "exactly",
  right: number,
) => {
  if (comparison === "at-least") return left >= right;
  if (comparison === "at-most") return left <= right;
  return left === right;
};

const selectorMatchesIdentity = (selector: MoveSelectorCondition, move: MoveDefinition) =>
  (selector.ids === undefined || selector.ids.includes(move.id)) &&
  (selector.styleId === undefined || selector.styleId === move.styleId) &&
  (selector.styleIdExcludes === undefined || selector.styleIdExcludes !== move.styleId) &&
  (selector.category === undefined || selector.category === move.category) &&
  (selector.categories === undefined || selector.categories.includes(move.category)) &&
  !selector.categoryExcludes?.includes(move.category);

const selectorMatchesText = (selector: MoveSelectorCondition, move: MoveDefinition) =>
  (selector.tags === undefined ||
    selector.tags.every((tag) => move.tags.includes(tag as (typeof move.tags)[number]))) &&
  (selector.constant === undefined || selector.constant === isConstantSkill(move)) &&
  (selector.effectTextIncludes === undefined ||
    move.effectText.includes(selector.effectTextIncludes)) &&
  (selector.effectTextIncludesAny === undefined ||
    selector.effectTextIncludesAny.some((text) => move.effectText.includes(text))) &&
  (selector.effectTextExcludes === undefined ||
    !move.effectText.includes(selector.effectTextExcludes)) &&
  (selector.requirementIncludes === undefined ||
    selector.requirementIncludes.every((required) =>
      move.requirements?.some(
        (requirement) =>
          requirement.type === "source-text" &&
          requirement.text.toLowerCase().includes(required.toLowerCase()),
      ),
    )) &&
  (selector.requirementExcludes === undefined ||
    selector.requirementExcludes.every(
      (excluded) =>
        !move.requirements?.some(
          (requirement) =>
            requirement.type === "source-text" &&
            requirement.text.toLowerCase().includes(excluded.toLowerCase()),
        ),
    ));

const selectorMatchesAttackRoll = (selector: MoveSelectorCondition, move: MoveDefinition) => {
  if (selector.attackRoll === undefined) return true;
  if (move.mechanics.attack === undefined) return false;
  const attackRoll = move.mechanics.attack.attackRoll;
  const dice = attackRoll?.dice ?? 1;
  const sides = attackRoll?.sides ?? GLOBAL_RULES.combat.standardDieSides;
  return (
    (selector.attackRoll.dice === undefined || dice === selector.attackRoll.dice) &&
    (selector.attackRoll.minimumDice === undefined || dice >= selector.attackRoll.minimumDice) &&
    (selector.attackRoll.sides === undefined || sides === selector.attackRoll.sides) &&
    (selector.attackRoll.maximumSides === undefined || sides <= selector.attackRoll.maximumSides)
  );
};

const selectorMatchesCost = (selector: MoveSelectorCondition, move: MoveDefinition) => {
  if (selector.baseKiCost === undefined) return true;
  const cost = move.mechanics.kiCost;
  const value = selector.baseKiCost.value;
  return (
    cost?.type === "literal" &&
    value.type === "literal" &&
    numericSelectorComparison(cost.value, selector.baseKiCost.comparison, value.value)
  );
};

const selectorMatchesMove = (selector: MoveSelectorCondition | undefined, move: MoveDefinition) =>
  selector === undefined ||
  (selectorMatchesIdentity(selector, move) &&
    selectorMatchesText(selector, move) &&
    selectorMatchesAttackRoll(selector, move) &&
    selectorMatchesCost(selector, move));

const combatResultPrevented = (
  state: ActiveFightState,
  combatantId: CombatantId,
  result: "critical" | "counter" | "sever",
  move: MoveDefinition,
) =>
  state.activeEffects.some(
    (effect) =>
      effect.type === "prevent-combat-result" &&
      effect.targetCombatantId === combatantId &&
      effect.result === result &&
      selectorMatchesMove(effect.selector, move),
  );

const combatResultPreventedForBasicAttack = (
  state: ActiveFightState,
  combatantId: CombatantId,
  result: "critical" | "counter" | "sever",
) =>
  state.activeEffects.some(
    (effect) =>
      effect.type === "prevent-combat-result" &&
      effect.targetCombatantId === combatantId &&
      effect.result === result &&
      effect.selector === undefined,
  );

const deactivationEvent = (
  state: ActiveFightState,
  effect: Extract<ActiveCombatEffect, { readonly type: "active-constant" }>,
  causedByDecisionId: CombatDecision["id"],
  dependencies: CombatDependencies,
  sequence: number,
): CombatEvent => ({
  id: dependencies.ids.nextEventId(),
  sequence,
  fightId: state.id,
  causedByDecisionId,
  type: "effect-deactivated",
  activeEffectId: effect.id,
  sourceCombatantId: effect.sourceCombatantId,
  targetCombatantId: effect.targetCombatantId,
  sourceDefinitionId: effect.sourceDefinitionId,
});

const deactivationTarget = (
  state: ActiveFightState,
  application: Pick<DeactivationApplication, "target">,
  sourceCombatantId: CombatantId,
) =>
  application.target === "self"
    ? sourceCombatantId
    : Object.values(state.combatants).find(
        (combatant) => combatant.id !== sourceCombatantId && combatant.status === "active",
      )?.id;

const eligibleConstantEffects = (
  activeEffects: readonly ActiveCombatEffect[],
  targetCombatantId: CombatantId,
  selector: MoveSelectorCondition | undefined,
) =>
  activeEffects.filter(
    (effect): effect is Extract<ActiveCombatEffect, { readonly type: "active-constant" }> => {
      if (
        effect.type !== "active-constant" ||
        effect.lifecycle === "deactivated" ||
        effect.sourceCombatantId !== targetCombatantId
      )
        return false;
      const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === effect.sourceDefinitionId);
      return move !== undefined && selectorMatchesMove(selector, move);
    },
  );

const eligibleConstantActivationMoves = (
  state: ActiveFightState,
  targetCombatantId: CombatantId,
  selector: MoveSelectorCondition,
) => {
  const combatant = state.combatants[targetCombatantId];
  return combatant.moveIds.flatMap((moveId) => {
    const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === moveId);
    if (
      move === undefined ||
      !isConstantSkill(move) ||
      !selectorMatchesMove(selector, move) ||
      hasActiveConstant(state, targetCombatantId, move.id) ||
      moveUsePreventionFor(state, targetCombatantId, move, "activate") !== undefined
    )
      return [];
    const cost = move.mechanics.kiCost;
    if (
      cost?.type !== "literal" ||
      !isRestrictedUseAvailable(
        combatant.moveUses[move.id] ?? 0,
        effectiveRestrictedMoveUseLimit(state, combatant, move),
      ) ||
      combatant.ki.current < cost.value
    )
      return [];
    return [move];
  });
};

interface ActivationSelectionTransitionInput {
  readonly state: ActiveFightState;
  readonly application: ActivationApplication;
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly eligible: readonly MoveDefinition[];
  readonly effectIndex: number;
  readonly dependencies: CombatDependencies;
}

const activationSelectionTransition = ({
  state,
  application,
  sourceCombatantId,
  targetCombatantId,
  eligible,
  effectIndex,
  dependencies,
}: ActivationSelectionTransitionInput): CombatResult<CombatTransition> => {
  const pendingDecisionId = dependencies.ids.nextPendingDecisionId();
  const nextState: ActiveFightState = {
    ...state,
    pendingDecision: {
      id: pendingDecisionId,
      stateVersion: state.version,
      combatantId: sourceCombatantId,
      type: "select-move",
      options: [
        ...eligible.map((move) => ({
          id: `activate:${move.id}`,
          type: "select-move" as const,
          moveId: move.id,
        })),
        ...(application.optional ? [{ id: "decline", type: "decline" as const }] : []),
      ],
    },
    resolutionFrames: [
      ...state.resolutionFrames,
      {
        id: dependencies.ids.nextResolutionFrameId(),
        type: "effect",
        sourceCombatantId,
        targetCombatantId,
        sourceDefinitionId: application.sourceDefinitionId,
        effectIndex,
        operation: "activate" as const,
        returnPhase: state.phase,
        trigger: "on-success" as const,
        pendingDecisionId,
        eligibleMoveIds: eligible.map((move) => move.id),
        remainingSelections: 1,
        optional: application.optional,
      },
    ],
  };
  return transitionFrom(nextState, []);
};

interface DeactivateAllEligibleConstantsInput {
  readonly activeEffects: readonly ActiveCombatEffect[];
  readonly eligible: readonly Extract<ActiveCombatEffect, { readonly type: "active-constant" }>[];
  readonly state: ActiveFightState;
  readonly causedByDecisionId: CombatDecision["id"];
  readonly dependencies: CombatDependencies;
  readonly priorEventCount: number;
}

const deactivateAllEligibleConstants = ({
  activeEffects,
  eligible,
  state,
  causedByDecisionId,
  dependencies,
  priorEventCount,
}: DeactivateAllEligibleConstantsInput) => ({
  activeEffects: activeEffects.map((effect) =>
    eligible.includes(effect as (typeof eligible)[number])
      ? { ...effect, lifecycle: "deactivated" as const, deactivatedOnTurn: state.turnNumber }
      : effect,
  ),
  events: eligible.map((effect, index) =>
    deactivationEvent(
      state,
      effect,
      causedByDecisionId,
      dependencies,
      state.eventSequence + priorEventCount + index + 1,
    ),
  ),
});

interface DeactivationSelectionTransitionInput {
  readonly state: ActiveFightState;
  readonly activeEffects: readonly ActiveCombatEffect[];
  readonly application: DeactivationApplication;
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly eligible: readonly Extract<ActiveCombatEffect, { readonly type: "active-constant" }>[];
  readonly effectIndex: number;
  readonly dependencies: CombatDependencies;
  readonly events: readonly CombatEvent[];
  readonly priorEventCount: number;
}

const deactivationSelectionTransition = ({
  state,
  activeEffects,
  application,
  sourceCombatantId,
  targetCombatantId,
  eligible,
  effectIndex,
  dependencies,
  events,
  priorEventCount,
}: DeactivationSelectionTransitionInput): CombatResult<CombatTransition> => {
  const pendingDecisionId = dependencies.ids.nextPendingDecisionId();
  const nextState: ActiveFightState = {
    ...state,
    eventSequence: state.eventSequence + events.length - priorEventCount,
    activeEffects,
    pendingDecision: {
      id: pendingDecisionId,
      stateVersion: state.version,
      combatantId: sourceCombatantId,
      type: "select-move",
      options: [
        ...eligible.map((effect) => ({
          id: `deactivate:${effect.id}`,
          type: "select-move" as const,
          moveId: effect.sourceDefinitionId,
        })),
        ...(application.optional ? [{ id: "decline", type: "decline" as const }] : []),
      ],
    },
    resolutionFrames: [
      ...state.resolutionFrames,
      {
        id: dependencies.ids.nextResolutionFrameId(),
        type: "effect",
        sourceCombatantId,
        targetCombatantId,
        sourceDefinitionId: application.sourceDefinitionId,
        effectIndex,
        operation: "deactivate",
        returnPhase: state.phase,
        trigger: "on-success",
        pendingDecisionId,
        eligibleMoveIds: eligible.map((effect) => effect.sourceDefinitionId),
        remainingSelections:
          application.selection === "all" ? eligible.length : (application.count ?? 1),
        optional: application.optional,
      },
    ],
  };
  return transitionFrom(nextState, events);
};

interface ResolveDeactivationsInput {
  readonly state: ActiveFightState;
  readonly activations?: readonly ActivationApplication[];
  readonly applications: readonly DeactivationApplication[];
  readonly sourceCombatantId: CombatantId;
  readonly causedByDecisionId: CombatDecision["id"];
  readonly dependencies: CombatDependencies;
  readonly priorEvents: readonly CombatEvent[];
}

const resolveActivationApplications = ({
  state,
  activations,
  sourceCombatantId,
  dependencies,
}: Pick<
  ResolveDeactivationsInput,
  "state" | "activations" | "sourceCombatantId" | "dependencies"
>): CombatResult<CombatTransition> | undefined => {
  for (const [effectIndex, application] of (activations ?? []).entries()) {
    const targetCombatantId = deactivationTarget(state, application, sourceCombatantId);
    if (targetCombatantId === undefined) continue;
    const eligible = eligibleConstantActivationMoves(
      state,
      targetCombatantId,
      application.selector,
    );
    if (eligible.length === 0) continue;
    return activationSelectionTransition({
      state,
      application,
      sourceCombatantId,
      targetCombatantId,
      eligible,
      effectIndex,
      dependencies,
    });
  }
  return undefined;
};

/** Resolves automatic deactivations, or serializes the remaining player choice. */
const resolveDeactivations = ({
  state,
  activations = [],
  applications,
  sourceCombatantId,
  causedByDecisionId,
  dependencies,
  priorEvents,
}: ResolveDeactivationsInput): CombatResult<CombatTransition> => {
  let activeEffects = state.activeEffects;
  const events = [...priorEvents];
  const activation = resolveActivationApplications({
    state,
    activations,
    sourceCombatantId,
    dependencies,
  });
  if (activation !== undefined) return activation;
  for (const [effectIndex, application] of applications.entries()) {
    if (application.affectedType !== "skill") continue;
    const targetCombatantId = deactivationTarget(state, application, sourceCombatantId);
    if (targetCombatantId === undefined) continue;
    const eligible = eligibleConstantEffects(
      activeEffects,
      targetCombatantId,
      application.selector,
    ).filter((effect) => {
      const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === effect.sourceDefinitionId);
      return (
        move !== undefined &&
        moveUsePreventionFor(state, targetCombatantId, move, "deactivate") === undefined
      );
    });
    const selectionCount =
      application.selection === "all" ? eligible.length : (application.count ?? 1);
    if (eligible.length === 0 || selectionCount <= 0) continue;
    if (selectionCount >= eligible.length && !application.optional) {
      const deactivation = deactivateAllEligibleConstants({
        activeEffects,
        eligible,
        state,
        causedByDecisionId,
        dependencies,
        priorEventCount: events.length - priorEvents.length,
      });
      activeEffects = deactivation.activeEffects;
      events.push(...deactivation.events);
      continue;
    }
    return deactivationSelectionTransition({
      state,
      activeEffects,
      application,
      sourceCombatantId,
      targetCombatantId,
      eligible,
      effectIndex,
      dependencies,
      events,
      priorEventCount: priorEvents.length,
    });
  }
  return transitionFrom(
    {
      ...state,
      activeEffects,
      eventSequence: state.eventSequence + events.length - priorEvents.length,
    },
    events,
  );
};

const lockAppliesToDecision = (
  lock: Extract<ActiveCombatEffect, { readonly type: "action-lock" }>,
  decision: ResolvedActionDecision | LegalDecision,
) => {
  if (decision.type === "power-up") return lock.affectedType === "power-up";
  if (decision.type !== "use-move")
    return (
      lock.affectedType === "attack" &&
      decision.type === "basic-attack" &&
      lock.selector === undefined
    );
  const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === decision.moveId);
  if (move === undefined || !selectorMatchesMove(lock.selector, move)) return false;
  if (lock.affectedType === "move") return true;
  if (lock.affectedType === "attack")
    return move.category === "advanced-attack" || move.category === "signature";
  if (lock.affectedType === "skill") return move.category === "skill";
  if (lock.affectedType === "mastery") return move.category === "mastery";
  return false;
};

const actionLockFor = (
  state: ActiveFightState,
  combatantId: CombatantId,
  decision: ResolvedActionDecision | LegalDecision,
) =>
  state.activeEffects.find(
    (effect): effect is Extract<ActiveCombatEffect, { readonly type: "action-lock" }> =>
      effect.type === "action-lock" &&
      effect.targetCombatantId === combatantId &&
      (effect.duration.type !== "until-resource-threshold" ||
        !numericSelectorComparison(
          effect.duration.resource === "hp"
            ? state.combatants[effect.duration.combatantId].hitPoints.current
            : state.combatants[effect.duration.combatantId].ki.current,
          effect.duration.comparison,
          effect.duration.value,
        )) &&
      lockAppliesToDecision(effect, decision),
  );

const moveUsePreventionFor = (
  state: ActiveFightState,
  combatantId: CombatantId,
  move: MoveDefinition,
  operation: "use" | "activate" | "deactivate",
) =>
  state.activeEffects.find(
    (effect): effect is Extract<ActiveCombatEffect, { readonly type: "prevent-move-use" }> =>
      effect.type === "prevent-move-use" &&
      effect.targetCombatantId === combatantId &&
      effect.operation === operation &&
      selectorMatchesMove(effect.selector, move),
  );

const statusPreventionFor = (
  state: ActiveFightState,
  combatantId: CombatantId,
  statusId: ActiveStatus["statusId"],
) =>
  state.activeEffects.find(
    (effect): effect is Extract<ActiveCombatEffect, { readonly type: "prevent-status" }> =>
      effect.type === "prevent-status" &&
      effect.targetCombatantId === combatantId &&
      effect.statusId === statusId,
  );

const satisfiesForcedAction = (
  force: Extract<ActiveCombatEffect, { readonly type: "force-next-action" }>,
  decision: ResolvedActionDecision | LegalDecision,
) => {
  if (decision.type === "surrender") return true;
  if (decision.type === "pass") return force.allowPass;
  if (decision.type === "basic-attack") return force.fallback === "basic-attack";
  if (decision.type !== "use-move") return false;
  const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === decision.moveId);
  if (move === undefined || (move.category !== "advanced-attack" && move.category !== "signature"))
    return false;
  return (
    force.allowedCategories.includes(move.category) &&
    (force.allowedTags === undefined ||
      force.allowedTags.every((tag) => move.tags.includes(tag as (typeof move.tags)[number])))
  );
};

const stateAfterForcedAction = (
  state: ActiveFightState,
  combatantId: CombatantId,
): ActiveFightState => ({
  ...state,
  activeEffects: state.activeEffects.filter(
    (effect) => effect.type !== "force-next-action" || effect.targetCombatantId !== combatantId,
  ),
});

const resolveTransformationActivation = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "activate-transformation" }>,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> => {
  const combatant = state.combatants[decision.actorId];
  const transformation = TRANSFORMATION_DEFINITIONS.find(
    (candidate) => candidate.id === decision.transformationId,
  );
  if (transformation === undefined || !combatant.transformationIds?.includes(transformation.id)) {
    return { ok: false, error: { type: "illegal-decision", decisionType: decision.type } };
  }
  if (combatant.transformation !== undefined) {
    return { ok: false, error: { type: "illegal-decision", decisionType: decision.type } };
  }
  const transformed = applyTransformation(combatant, transformation);
  const nextState: ActiveFightState = {
    ...state,
    version: state.version + 1,
    phase: "end",
    combatants: {
      ...state.combatants,
      [combatant.id]: {
        ...transformed.combatant,
        transformation: {
          transformationId: transformation.id,
          activatedOnTurn: state.turnNumber,
          baseline: transformed.baseline,
        },
      },
    },
    actionHistory: [...state.actionHistory, actionRecordFor(state, decision)],
    eventSequence: state.eventSequence + 2,
  };
  return transitionFrom(nextState, [
    {
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + 1,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "transformation-activated",
      combatantId: combatant.id,
      transformationId: transformation.id,
    },
    createPhaseChangedEvent(state, dependencies, "end", nextState.eventSequence, decision.id),
  ]);
};

/**
 * Resolves the converted consumables whose effect is an immediate combat
 * resource change. Their source text explicitly treats use as an auxiliary
 * combat action, so the active combatant keeps the current action phase.
 */
const itemUseFailure = (
  combatant: ActiveFightState["combatants"][CombatantId],
  item: ItemDefinition,
): CombatFailure | undefined => {
  if (!combatant.itemIds?.includes(item.id)) {
    return { type: "item-not-owned", itemId: item.id, combatantId: combatant.id };
  }
  if (item.maxUses !== undefined && (combatant.itemUses?.[item.id] ?? 0) >= item.maxUses) {
    return { type: "item-use-exhausted", itemId: item.id };
  }
  return isCombatUsableItem(item)
    ? undefined
    : { type: "unsupported-mechanic", mechanic: `combat item resolution: ${item.id}` };
};

const activatedItemEffects = (
  item: ItemDefinition,
  combatant: ActiveFightState["combatants"][CombatantId],
  dependencies: CombatDependencies,
) =>
  (item.effects ?? []).flatMap((effect): ActiveCombatEffect[] => {
    if (
      effect.trigger === "combat-action" &&
      effect.type === "item-modify-roll" &&
      effect.target === "self" &&
      (effect.roll === "attack" || effect.roll === "defense") &&
      effect.duration?.unit === "combat"
    ) {
      return [
        {
          id: dependencies.ids.nextActiveEffectId(),
          type: "modify-roll",
          sourceCombatantId: combatant.id,
          targetCombatantId: combatant.id,
          sourceDefinitionId: item.id,
          roll: effect.roll,
          modifier: effect.modifier,
          amount: effect.amount,
          duration: "combat",
        },
      ];
    }
    if (
      effect.trigger !== "combat-action" ||
      effect.type !== "item-modify-damage" ||
      effect.target !== "self"
    ) {
      return [];
    }
    const remainingAttacks = itemDamageAttackCount(effect.sourceText);
    return remainingAttacks === undefined
      ? []
      : [
          {
            id: dependencies.ids.nextActiveEffectId(),
            type: "modify-item-next-attack-damage",
            sourceCombatantId: combatant.id,
            targetCombatantId: combatant.id,
            sourceDefinitionId: item.id,
            amount: Math.round((combatant.stats.power * effect.percent) / 100),
            remainingAttacks,
          },
        ];
  });

interface ItemUseEventsInput {
  readonly state: ActiveFightState;
  readonly decision: Extract<CombatDecision, { readonly type: "use-item" }>;
  readonly dependencies: CombatDependencies;
  readonly combatant: ActiveFightState["combatants"][CombatantId];
  readonly item: ItemDefinition;
  readonly resources: { readonly hitPoints: number; readonly ki: number };
  readonly activatedEffects: readonly ActiveCombatEffect[];
}

const itemUseEvents = ({
  state,
  decision,
  dependencies,
  combatant,
  item,
  resources,
  activatedEffects,
}: ItemUseEventsInput) => {
  const events: CombatEvent[] = [
    {
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + 1,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "item-used",
      combatantId: combatant.id,
      itemId: item.id,
    },
  ];
  const kiChange = resources.ki - combatant.ki.current;
  if (kiChange !== 0) {
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + events.length + 1,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "ki-changed",
      combatantId: combatant.id,
      amount: kiChange,
      remainingKi: resources.ki,
    });
  }
  return [
    ...events,
    ...activatedEffects.map((effect, index) => ({
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + events.length + index + 1,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "effect-activated" as const,
      activeEffectId: effect.id,
      sourceCombatantId: effect.sourceCombatantId,
      targetCombatantId: effect.targetCombatantId,
      sourceDefinitionId: effect.sourceDefinitionId,
    })),
  ];
};

const resolveItemUse = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-item" }>,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> => {
  const combatant = state.combatants[decision.actorId];
  const item = ITEM_DEFINITIONS.find((candidate) => candidate.id === decision.itemId);
  if (item === undefined)
    return { ok: false, error: { type: "unknown-item", itemId: decision.itemId } };
  const failure = itemUseFailure(combatant, item);
  if (failure !== undefined) return { ok: false, error: failure };

  const commonResourceEffect = item.effects?.some(
    (effect) => effect.type === "modify-resource" && effect.trigger === "on-move-use",
  );
  const resourceTrigger = commonResourceEffect ? "on-move-use" : "combat-action";
  const resources = isCombatResourceItem(item)
    ? resolveItemResources(item, resourceTrigger, combatant)
    : { hitPoints: combatant.hitPoints.current, ki: combatant.ki.current };
  const activatedEffects = activatedItemEffects(item, combatant, dependencies);
  const events = itemUseEvents({
    state,
    decision,
    dependencies,
    combatant,
    item,
    resources,
    activatedEffects,
  });
  const nextState: ActiveFightState = {
    ...state,
    version: state.version + 1,
    eventSequence: state.eventSequence + events.length,
    activeEffects: [...state.activeEffects, ...activatedEffects],
    combatants: {
      ...state.combatants,
      [combatant.id]: {
        ...combatant,
        hitPoints: { ...combatant.hitPoints, current: resources.hitPoints },
        ki: { ...combatant.ki, current: resources.ki },
        itemUses: { ...combatant.itemUses, [item.id]: (combatant.itemUses?.[item.id] ?? 0) + 1 },
      },
    },
    actionHistory: [...state.actionHistory, actionRecordFor(state, decision)],
  };
  return transitionFrom(nextState, events);
};

const resolvePlayerAction = (
  state: ActiveFightState,
  decision: ResolvedActionDecision,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> => {
  if (decision.type === "basic-attack") return resolveBasicAttack(state, decision, dependencies);
  if (decision.type === "use-move") {
    const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === decision.moveId);
    if (
      state.phase === "counter" &&
      (move === undefined || (move.category !== "advanced-attack" && move.category !== "signature"))
    ) {
      return { ok: false, error: { type: "illegal-decision", decisionType: decision.type } };
    }
    return resolveMoveDecision(state, decision, dependencies);
  }
  if (decision.type === "activate-transformation") {
    return state.phase === "counter"
      ? { ok: false, error: { type: "illegal-decision", decisionType: decision.type } }
      : resolveTransformationActivation(state, decision, dependencies);
  }
  if (decision.type === "use-item") {
    return state.phase === "counter"
      ? { ok: false, error: { type: "illegal-decision", decisionType: decision.type } }
      : resolveItemUse(state, decision, dependencies);
  }
  if (decision.type === "surrender") return resolveSurrenderDecision(state, decision, dependencies);
  return state.phase === "counter"
    ? { ok: false, error: { type: "illegal-decision", decisionType: decision.type } }
    : resolveEndPhaseDecision(state, decision, dependencies);
};

const resolveDeactivateDecline = (
  state: ActiveFightState,
  frame: Extract<ActiveFightState["resolutionFrames"][number], { readonly type: "effect" }>,
  decision: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
  pendingId: PendingDecision["id"],
) => {
  if (frame.optional !== true) {
    return {
      ok: false as const,
      error: {
        type: "invalid-pending-decision-option" as const,
        pendingDecisionId: pendingId,
        optionId: decision.optionId,
      },
    };
  }
  const stateWithoutPending = { ...state };
  Reflect.deleteProperty(stateWithoutPending, "pendingDecision");
  return transitionFrom(
    {
      ...stateWithoutPending,
      version: state.version + 1,
      resolutionFrames: state.resolutionFrames.filter((candidate) => candidate.id !== frame.id),
    },
    [],
  );
};

interface CreateNextDeactivationStateInput {
  readonly stateWithoutPending: ActiveFightState;
  readonly activeEffects: readonly ActiveCombatEffect[];
  readonly shouldContinue: boolean;
  readonly nextPendingDecisionId?: PendingDecisionId;
  readonly frame: Extract<
    ActiveFightState["resolutionFrames"][number],
    { readonly type: "effect" }
  >;
  readonly eligibleMoveIds: readonly MoveDefinition["id"][];
  readonly remainingSelections: number;
}

const createNextDeactivationState = ({
  stateWithoutPending,
  activeEffects,
  shouldContinue,
  nextPendingDecisionId,
  frame,
  eligibleMoveIds,
  remainingSelections,
}: CreateNextDeactivationStateInput): ActiveFightState => {
  const pendingDecision = shouldContinue
    ? {
        id: nextPendingDecisionId!,
        stateVersion: stateWithoutPending.version + 1,
        combatantId: frame.sourceCombatantId,
        type: "select-move" as const,
        options: eligibleMoveIds.map((moveId) => ({
          id: `deactivate:${moveId}`,
          type: "select-move" as const,
          moveId,
        })),
      }
    : undefined;

  const resolutionFrames = shouldContinue
    ? stateWithoutPending.resolutionFrames.map((candidate) =>
        candidate.id === frame.id
          ? {
              ...frame,
              pendingDecisionId: nextPendingDecisionId!,
              eligibleMoveIds,
              remainingSelections,
            }
          : candidate,
      )
    : stateWithoutPending.resolutionFrames.filter((candidate) => candidate.id !== frame.id);

  return {
    ...stateWithoutPending,
    version: stateWithoutPending.version + 1,
    activeEffects,
    ...(pendingDecision !== undefined ? { pendingDecision } : {}),
    resolutionFrames,
    eventSequence: stateWithoutPending.eventSequence + 1,
  };
};

const remainingEligibleDeactivationMoveIds = (
  eligibleMoveIds: readonly string[] | undefined,
  deactivatedMoveId: string,
  targetCombatantId: CombatantId,
  activeEffects: readonly ActiveCombatEffect[],
) =>
  (eligibleMoveIds ?? []).filter(
    (moveId) =>
      moveId !== deactivatedMoveId &&
      activeEffects.some(
        (candidate) =>
          candidate.type === "active-constant" &&
          candidate.lifecycle !== "deactivated" &&
          candidate.sourceCombatantId === targetCombatantId &&
          candidate.sourceDefinitionId === moveId,
      ),
  );

const resolveActivationSelection = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> => {
  const pending = state.pendingDecision;
  if (
    pending === undefined ||
    pending.type !== "select-move" ||
    pending.id !== decision.pendingDecisionId
  )
    return {
      ok: false,
      error: { type: "no-pending-decision", pendingDecisionId: decision.pendingDecisionId },
    };
  if (decision.actorId !== pending.combatantId)
    return {
      ok: false,
      error: {
        type: "not-active-combatant",
        combatantId: decision.actorId,
        activeCombatantId: pending.combatantId,
      },
    };
  const frame = state.resolutionFrames.find(
    (candidate): candidate is Extract<typeof candidate, { readonly type: "effect" }> =>
      candidate.type === "effect" &&
      candidate.operation === "activate" &&
      candidate.pendingDecisionId === pending.id,
  );
  if (frame === undefined) return { ok: false, error: invalidFightState(state) };
  const option = pending.options.find((candidate) => candidate.id === decision.optionId);
  if (option?.type === "decline")
    return resolveDeactivateDecline(state, frame, decision, pending.id);
  if (option?.type !== "select-move" || option.moveId === undefined)
    return {
      ok: false,
      error: {
        type: "invalid-pending-decision-option",
        pendingDecisionId: pending.id,
        optionId: decision.optionId,
      },
    };
  const move = MOVE_DEFINITIONS.find(
    (candidate) => candidate.id === option.moveId && frame.eligibleMoveIds?.includes(candidate.id),
  );
  const actor = state.combatants[frame.targetCombatantId];
  if (
    move === undefined ||
    !isConstantSkill(move) ||
    actor.moveIds.includes(move.id) === false ||
    moveUsePreventionFor(state, actor.id, move, "activate") !== undefined ||
    hasActiveConstant(state, actor.id, move.id) ||
    move.mechanics.kiCost?.type !== "literal" ||
    actor.ki.current < move.mechanics.kiCost.value ||
    !isRestrictedUseAvailable(
      actor.moveUses[move.id] ?? 0,
      effectiveRestrictedMoveUseLimit(state, actor, move),
    )
  )
    return { ok: false, error: invalidFightState(state) };
  const cost = move.mechanics.kiCost.value;
  const deactivated = state.activeEffects.find(
    (effect): effect is Extract<ActiveCombatEffect, { readonly type: "active-constant" }> =>
      effect.type === "active-constant" &&
      effect.lifecycle === "deactivated" &&
      effect.sourceCombatantId === actor.id &&
      effect.sourceDefinitionId === move.id,
  );
  const activeEffectId = deactivated?.id ?? dependencies.ids.nextActiveEffectId();
  const activeEffects =
    deactivated === undefined
      ? [
          ...state.activeEffects,
          {
            id: activeEffectId,
            type: "active-constant" as const,
            sourceCombatantId: actor.id,
            targetCombatantId: actor.id,
            sourceDefinitionId: move.id,
            activatedOnTurn: state.turnNumber,
            duration: "combat" as const,
            paidActivationCost: cost,
            lifecycle: "active" as const,
          },
        ]
      : state.activeEffects.map((effect) =>
          effect.id === deactivated.id
            ? { ...effect, lifecycle: "active" as const, deactivatedOnTurn: undefined }
            : effect,
        );
  const stateWithoutPending = { ...state };
  Reflect.deleteProperty(stateWithoutPending, "pendingDecision");
  const nextState: ActiveFightState = {
    ...stateWithoutPending,
    version: state.version + 1,
    activeEffects,
    combatants: {
      ...state.combatants,
      [actor.id]: {
        ...actor,
        ki: { ...actor.ki, current: actor.ki.current - cost },
        moveUses: { ...actor.moveUses, [move.id]: (actor.moveUses[move.id] ?? 0) + 1 },
      },
    },
    resolutionFrames: state.resolutionFrames.filter((candidate) => candidate.id !== frame.id),
    eventSequence: state.eventSequence + 2,
  };
  return transitionFrom(nextState, [
    {
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + 1,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "ki-changed",
      combatantId: actor.id,
      amount: -cost,
      remainingKi: actor.ki.current - cost,
    },
    {
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + 2,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "effect-activated",
      activeEffectId,
      sourceCombatantId: actor.id,
      targetCombatantId: actor.id,
      sourceDefinitionId: move.id,
    },
  ]);
};

const resolveDeactivationSelection = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> => {
  const pending = state.pendingDecision;
  if (
    pending === undefined ||
    pending.type !== "select-move" ||
    pending.id !== decision.pendingDecisionId
  ) {
    return {
      ok: false,
      error: { type: "no-pending-decision", pendingDecisionId: decision.pendingDecisionId },
    };
  }
  if (decision.actorId !== pending.combatantId) {
    return {
      ok: false,
      error: {
        type: "not-active-combatant",
        combatantId: decision.actorId,
        activeCombatantId: pending.combatantId,
      },
    };
  }
  const frame = state.resolutionFrames.find(
    (candidate): candidate is Extract<typeof candidate, { readonly type: "effect" }> =>
      candidate.type === "effect" && candidate.pendingDecisionId === pending.id,
  );
  if (frame === undefined) {
    return { ok: false, error: invalidFightState(state) };
  }
  if (frame.operation === "activate")
    return resolveActivationSelection(state, decision, dependencies);
  const option = pending.options.find((candidate) => candidate.id === decision.optionId);
  if (option?.type === "decline") {
    return resolveDeactivateDecline(state, frame, decision, pending.id);
  }
  if (option?.type !== "select-move" || option.moveId === undefined) {
    return {
      ok: false,
      error: {
        type: "invalid-pending-decision-option",
        pendingDecisionId: pending.id,
        optionId: decision.optionId,
      },
    };
  }
  const effect = state.activeEffects.find(
    (candidate): candidate is Extract<ActiveCombatEffect, { readonly type: "active-constant" }> =>
      candidate.type === "active-constant" &&
      candidate.sourceCombatantId === frame.targetCombatantId &&
      candidate.sourceDefinitionId === option.moveId &&
      frame.eligibleMoveIds?.includes(candidate.sourceDefinitionId) === true,
  );
  if (effect === undefined) return { ok: false, error: invalidFightState(state) };

  const activeEffects = state.activeEffects.map((candidate) =>
    candidate.id === effect.id
      ? { ...candidate, lifecycle: "deactivated" as const, deactivatedOnTurn: state.turnNumber }
      : candidate,
  );
  const eligibleMoveIds = remainingEligibleDeactivationMoveIds(
    frame.eligibleMoveIds,
    effect.sourceDefinitionId,
    frame.targetCombatantId,
    activeEffects,
  );
  const remainingSelections = Math.max(0, (frame.remainingSelections ?? 1) - 1);
  const shouldContinue = remainingSelections > 0 && eligibleMoveIds.length > 0;
  const nextPendingDecisionId = shouldContinue
    ? dependencies.ids.nextPendingDecisionId()
    : undefined;
  const stateWithoutPending = { ...state };
  Reflect.deleteProperty(stateWithoutPending, "pendingDecision");
  const nextState = createNextDeactivationState({
    stateWithoutPending,
    activeEffects,
    shouldContinue,
    nextPendingDecisionId,
    frame,
    eligibleMoveIds,
    remainingSelections,
  });
  return transitionFrom(nextState, [
    deactivationEvent(state, effect, decision.id, dependencies, nextState.eventSequence),
  ]);
};

const resolveOptionalEffectChoice = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> => {
  const pending = state.pendingDecision;
  if (
    pending === undefined ||
    pending.type !== "optional-effect" ||
    pending.id !== decision.pendingDecisionId
  )
    return {
      ok: false,
      error: { type: "no-pending-decision", pendingDecisionId: decision.pendingDecisionId },
    };
  if (decision.actorId !== pending.combatantId)
    return {
      ok: false,
      error: {
        type: "not-active-combatant",
        combatantId: decision.actorId,
        activeCombatantId: pending.combatantId,
      },
    };
  const frame = state.resolutionFrames.find(
    (candidate): candidate is Extract<typeof candidate, { stage: "awaiting-effect-choice" }> =>
      candidate.type === "attack" &&
      candidate.stage === "awaiting-effect-choice" &&
      candidate.pendingDecisionId === pending.id,
  );
  if (frame === undefined)
    return {
      ok: false,
      error: { type: "unsupported-mechanic", mechanic: "pending decision resolution" },
    };
  const option = pending.options.find((candidate) => candidate.id === decision.optionId);
  const enabledEffectIndices =
    option?.type === "activate-effect" && option.effectIndices !== undefined
      ? option.effectIndices
      : [];
  const selectedNumericValues =
    option?.selectedNumericValue === undefined
      ? undefined
      : (() => {
          const match = /:([^:=]+)=(-?\d+)$/.exec(option.id);
          return match === null ? undefined : { [match[1]]: Number(match[2]) };
        })();
  if (
    option === undefined ||
    (option.type !== "decline" && option.type !== "activate-effect") ||
    (option.type === "activate-effect" &&
      (enabledEffectIndices.length !== frame.effectIndices.length ||
        enabledEffectIndices.some((index, position) => index !== frame.effectIndices[position]))) ||
    (option.selectedNumericValue !== undefined && selectedNumericValues === undefined)
  )
    return {
      ok: false,
      error: {
        type: "invalid-pending-decision-option",
        pendingDecisionId: pending.id,
        optionId: decision.optionId,
      },
    };
  const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === frame.attack.moveId);
  if (move === undefined) return { ok: false, error: invalidFightState(state) };
  return resolveConvertedAttackMove(
    withoutPendingResolution(state),
    {
      type: "use-move",
      id: frame.decisionId,
      actorId: frame.attackerId,
      expectedStateVersion: state.version,
      moveId: move.id,
      targetCombatantId: frame.targetCombatantId,
    },
    move,
    dependencies,
    {
      enabledOptionalEffectIndices: enabledEffectIndices,
      resolvedOptionalEffectIndices: frame.effectIndices,
      ...(selectedNumericValues === undefined ? {} : { selectedNumericValues }),
    },
  );
};

const resolvePendingCombatDecision = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> => {
  if (state.pendingDecision?.type === "defense-response") {
    return resolveDefenseResponse(state, decision, dependencies);
  }
  if (state.pendingDecision?.type === "post-defense-roll") {
    return resolvePostDefenseReaction(state, decision, dependencies);
  }
  if (state.pendingDecision?.type === "select-move") {
    return resolveDeactivationSelection(state, decision, dependencies);
  }
  if (state.pendingDecision?.type === "optional-effect") {
    return resolveOptionalEffectChoice(state, decision, dependencies);
  }
  if (state.pendingDecision === undefined) {
    return {
      ok: false,
      error: { type: "no-pending-decision", pendingDecisionId: decision.pendingDecisionId },
    };
  }
  return {
    ok: false,
    error: { type: "unsupported-mechanic", mechanic: "pending decision resolution" },
  };
};

/** Applies an Action- or Counter-phase decision. */
export const submitCombatDecision = (
  state: CombatTransition["state"],
  decision: CombatDecision,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> => {
  const invalidState = currentStateFailure(state);
  if (invalidState !== undefined) return { ok: false, error: invalidState };
  if (decision.expectedStateVersion !== state.version) {
    return {
      ok: false,
      error: {
        type: "stale-decision",
        expectedVersion: decision.expectedStateVersion,
        actualVersion: state.version,
      },
    };
  }
  if (state.status === "completed") {
    return { ok: false, error: { type: "wrong-phase", expected: ["action"], actual: "completed" } };
  }
  if (decision.type === "cancel-fight") {
    return resolveCancellationDecision(state, decision, dependencies);
  }
  if (decision.type === "respond-to-pending-decision") {
    return resolvePendingCombatDecision(state, decision, dependencies);
  }
  const actionFailure = actionSubmissionFailure(state, decision);
  if (actionFailure !== undefined) return { ok: false, error: actionFailure };
  const force = forcedActionFor(state, decision.actorId);
  if (actionLockFor(state, decision.actorId, decision) !== undefined) {
    return { ok: false, error: { type: "illegal-decision", decisionType: decision.type } };
  }
  if (force !== undefined && !satisfiesForcedAction(force, decision)) {
    return { ok: false, error: { type: "illegal-decision", decisionType: decision.type } };
  }
  return resolvePlayerAction(
    force === undefined ? state : stateAfterForcedAction(state, decision.actorId),
    decision,
    dependencies,
  );
};
