import { GLOBAL_RULES } from "@dragonball-resurgence/game-config";
import {
  ITEM_DEFINITIONS,
  MOVE_DEFINITIONS,
  TRANSFORMATION_DEFINITIONS,
  type ItemDefinition,
  type EffectDefinition,
  type EffectCondition,
  type MoveDefinition,
  type MoveId,
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
  isCombatResultCountNextActionsDamageModifier,
  isSelectedMoveUntilAttackThresholdDamageModifier,
} from "./damage-modifier-capabilities.js";
import {
  classifyCurrentActionMove,
  effectConditionsMatch,
  moveEffectsForTrigger,
  rerollEffectsAfterDefense,
  rerollEffectsOnRollResult,
  stoppedMoveEffects,
  successfulMoveEffects,
  type ResourceChange,
  type ResourceActionModifierApplication,
  type ResourceCostModifierApplication,
  type CostModifierTransformerApplication,
  type ResourceModifierTransformerApplication,
  type ResourceChangeEvent,
  type StatusApplication,
  type LockApplication,
  type SuppressionApplication,
  type ActionRestrictionApplication,
  type MoveRemovalApplication,
  type ActivationApplication,
  type DeactivationApplication,
  type FloatingEffectApplication,
  type ExtraActionApplication,
  type DeferredMoveApplication,
  type ScheduledResourceApplication,
  type MoveUsePreventionApplication,
  type RemainingUseModificationApplication,
  type StatusPreventionApplication,
  type RollModification,
  type RollSelectionApplication,
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
  type MoveClassificationApplication,
  type StoredRollRequest,
  type StoredMoveSelectionRequest,
  type RerollApplication,
  type NegationApplication,
  type CounterActionApplication,
  type TransformationReversionApplication,
  type StatComparisonApplication,
  type TransformationActionApplication,
  type MoveEffectRuntimeContext,
} from "./move-effects-runtime.js";
import {
  combatItemPreventedOutcomes,
  isCombatResourceItem,
  resolveItemResources,
  type CombatItemPreventedOutcome,
} from "./item-effects-runtime.js";
import { applyTransformation, revertTransformation } from "./transformation-runtime.js";

import type {
  ActiveCombatEffect,
  ActiveCostModifierEffect,
  ActiveRollModificationCap,
  ActiveRollModifierEffect,
  ActiveRollModifierTransformerEffect,
  CombatRollType,
  ActiveFightState,
  ActiveRerollEffect,
  ActiveStatus,
  AttackResolutionSnapshot,
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
  CopiedMoveAttackReference,
  FightState,
  LegalDecision,
  PendingDecision,
  PendingDecisionOption,
  ResourceChangeHistoryRecord,
  ResolutionFrame,
  CounterActionReference,
  StoredRoll,
  StoredMoveSelection,
} from "./contracts.js";
import type { CombatDependencies } from "./dependencies.js";
import type { ActiveEffectId, CombatantId, CombatDecisionId, PendingDecisionId } from "./ids.js";
import { validateFightState } from "./invariants.js";

type RollModifierKind = "dice" | "result" | "sides";

const invalidFightState = (state: CombatTransition["state"]): CombatFailure => ({
  type: "invalid-fight-state",
  violations: validateFightState(state),
});

const moveRemovalTargetId = (
  application: MoveRemovalApplication,
  sourceCombatantId: CombatantId,
  targetCombatantId: CombatantId,
) => (application.move === "source" ? sourceCombatantId : targetCombatantId);

const removeMoveState = (combatant: CombatantState, moveId: MoveId): CombatantState => {
  const moveIds = combatant.moveIds.filter((candidate) => candidate !== moveId);
  const moveUses = Object.fromEntries(
    Object.entries(combatant.moveUses).filter(([candidate]) => candidate !== moveId),
  );
  const moveUseLimitModifiers = Object.fromEntries(
    Object.entries(combatant.moveUseLimitModifiers ?? {}).filter(
      ([candidate]) => candidate !== moveId,
    ),
  );
  const storedRolls = Object.fromEntries(
    Object.entries(combatant.storedRolls ?? {}).filter(
      ([, storedRoll]) => storedRoll.sourceDefinitionId !== moveId,
    ),
  );
  const storedMoveSelections = Object.fromEntries(
    Object.entries(combatant.storedMoveSelections ?? {}).filter(
      ([, selection]) => selection.sourceDefinitionId !== moveId && selection.moveId !== moveId,
    ),
  );
  const nextCombatant = {
    ...combatant,
    moveIds,
    moveUses,
    moveUseLimitModifiers,
    storedRolls,
    storedMoveSelections,
  };
  if (Object.keys(moveUseLimitModifiers).length === 0)
    Reflect.deleteProperty(nextCombatant, "moveUseLimitModifiers");
  if (Object.keys(storedRolls).length === 0) Reflect.deleteProperty(nextCombatant, "storedRolls");
  if (Object.keys(storedMoveSelections).length === 0)
    Reflect.deleteProperty(nextCombatant, "storedMoveSelections");
  return nextCombatant;
};

const removeTemporaryMoveFromState = (combatant: CombatantState, moveId: MoveId) => ({
  ...combatant,
  moveIds: combatant.moveIds.filter((candidate) => candidate !== moveId),
});

const restoreTemporaryMove = (
  combatant: CombatantState,
  effect: Extract<ActiveCombatEffect, { readonly type: "remove-move-from-combat" }>,
) => {
  if (combatant.moveIds.includes(effect.moveId)) return combatant;
  const moveIds = [...combatant.moveIds];
  moveIds.splice(Math.min(effect.removedFromIndex, moveIds.length), 0, effect.moveId);
  return { ...combatant, moveIds };
};

const expiredTemporaryMoveRemovals = (
  state: ActiveFightState,
  combatantId: CombatantId,
  rolls: readonly { readonly attackNaturalResult: number }[],
) =>
  state.activeEffects.filter(
    (effect): effect is Extract<ActiveCombatEffect, { readonly type: "remove-move-from-combat" }> =>
      effect.type === "remove-move-from-combat" &&
      effect.duration !== "combat" &&
      effect.duration.combatantId === combatantId &&
      rolls.some((roll) => roll.attackNaturalResult === 30),
  );

const combatantsAfterTemporaryMoveRestoration = (
  combatants: Readonly<Record<CombatantId, CombatantState>>,
  effects: readonly ActiveCombatEffect[],
) =>
  effects.reduce(
    (nextCombatants, effect) =>
      effect.type !== "remove-move-from-combat"
        ? nextCombatants
        : {
            ...nextCombatants,
            [effect.targetCombatantId]: restoreTemporaryMove(
              nextCombatants[effect.targetCombatantId],
              effect,
            ),
          },
    combatants,
  );

const combatantsAfterMoveRemovals = (
  combatants: Readonly<Record<CombatantId, CombatantState>>,
  effects: readonly ActiveCombatEffect[],
) =>
  effects.reduce(
    (nextCombatants, effect) =>
      effect.type !== "remove-move-from-combat"
        ? nextCombatants
        : {
            ...nextCombatants,
            [effect.targetCombatantId]: removeMoveState(
              nextCombatants[effect.targetCombatantId],
              effect.moveId,
            ),
          },
    combatants,
  );

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
  readonly resolutionSnapshot?: AttackResolutionSnapshot;
  readonly resourceChanges?: readonly ResourceChangeHistoryRecord[];
};

const resourceChangeHistoryFor = (
  changes: readonly ResourceChange[],
  actorId: CombatantId,
  targetId: CombatantId,
  turnNumber: number,
): readonly ResourceChangeHistoryRecord[] =>
  changes.flatMap((change) => {
    let operation: ResourceChangeHistoryRecord["operation"] | undefined;
    if (change.operation === "gain") operation = "gain";
    else if (change.operation === "lose" || change.operation === "drain") operation = "lose";
    if (operation === undefined) return [];
    return [
      {
        affectedCombatantId: change.target === "self" ? actorId : targetId,
        resource: change.resource,
        operation,
        amount: change.amount,
        turnNumber,
        ...(change.sourceCombatantId === undefined
          ? {}
          : { sourceCombatantId: change.sourceCombatantId }),
        ...(change.sourceDefinitionId === undefined
          ? {}
          : { sourceDefinitionId: change.sourceDefinitionId }),
        ...(change.sourceEffectIndex === undefined
          ? {}
          : { sourceEffectIndex: change.sourceEffectIndex }),
        ...(change.cause === undefined ? {} : { cause: change.cause }),
        ...(change.sourceStyleId === undefined ? {} : { sourceStyleId: change.sourceStyleId }),
      },
    ];
  });

const optionalResourceChangeHistoryFor = (
  changes: readonly ResourceChange[],
  actorId: CombatantId,
  targetId: CombatantId,
  turnNumber: number,
) => {
  const resourceChanges = resourceChangeHistoryFor(changes, actorId, targetId, turnNumber);
  return resourceChanges.length === 0 ? {} : { resourceChanges };
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
  (effect.activationCost === undefined || isCombatResultCountNextActionsDamageModifier(effect)) &&
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

type CopyMoveEffectDefinition = Extract<EffectDefinition, { readonly type: "copy-move-effect" }>;

const copyMoveEffectsFor = (move: MoveDefinition) =>
  (move.effects ?? []).flatMap((effect, effectIndex) =>
    effect.type === "copy-move-effect" ? [{ effect, effectIndex }] : [],
  );

const supportedCopyMoveEffect = (move: MoveDefinition): CopyMoveEffectDefinition | undefined => {
  const effects = move.effects ?? [];
  const effect =
    effects.length === 1 && effects[0]?.type === "copy-move-effect" ? effects[0] : undefined;
  if (effect === undefined) return undefined;
  const compilation = compileEffectPlan({
    sourceDefinitionId: move.id,
    effectIndex: 0,
    effect,
  });
  return compilation.ok ? effect : undefined;
};

const selectedPriorCopyMoveEffect = (move: MoveDefinition) => {
  const effect = supportedCopyMoveEffect(move);
  const sourceMove = effect?.sourceMove;
  return sourceMove?.type === "selected-prior-move" &&
    sourceMove.actor === "opponent" &&
    (("category" in sourceMove && sourceMove.category === "advanced-attack") ||
      ("categories" in sourceMove &&
        sourceMove.categories.length === 2 &&
        sourceMove.categories.includes("advanced-attack") &&
        sourceMove.categories.includes("signature"))) &&
    sourceMove.result === "successful"
    ? effect
    : undefined;
};

const isFullPriorAttackCopy = (effect: CopyMoveEffectDefinition) =>
  effect.sourceMove.type === "selected-prior-move" &&
  "categories" in effect.sourceMove &&
  effect.sourceMove.categories.length === 2 &&
  effect.sourceMove.categories.includes("advanced-attack") &&
  effect.sourceMove.categories.includes("signature") &&
  effect.copies?.length === 3 &&
  effect.copies[0] === "cost" &&
  effect.copies[1] === "dice-rolls" &&
  effect.copies[2] === "source-modifiers";

const supportedSelectedMoveCopyEffect = (
  move: MoveDefinition,
): { readonly effect: CopyMoveEffectDefinition; readonly effectIndex: number } | undefined => {
  const candidate = copyMoveEffectsFor(move).find(
    ({ effect }) =>
      effect.trigger === "action-phase" &&
      effect.target === "self" &&
      effect.sourceMove.type === "selected-move" &&
      effect.sourceMove.actor === "opponent",
  );
  if (candidate === undefined) return undefined;
  const compilation = compileEffectPlan({
    sourceDefinitionId: move.id,
    effectIndex: candidate.effectIndex,
    effect: candidate.effect,
  });
  return compilation.ok ? candidate : undefined;
};

const copyableAttackMove = (move: MoveDefinition | undefined) =>
  move !== undefined &&
  (move.category === "advanced-attack" || move.category === "signature") &&
  move.mechanics.attack?.baseDamagePercent?.type === "literal" &&
  move.mechanics.kiCost?.type === "literal" &&
  move.mechanics.restrictedUses === undefined;

const copiedSuccessfulEffectsAreExecutable = (move: MoveDefinition) =>
  (move.effects ?? [])
    .map((effect, effectIndex) => ({ effect, effectIndex }))
    .filter(({ effect }) => effect.trigger === "on-success")
    .every(
      ({ effect, effectIndex }) =>
        compileEffectPlan({
          sourceDefinitionId: move.id,
          effectIndex,
          effect,
        }).ok,
    );

const lastPriorCopyableAttack = (state: ActiveFightState, actorId: CombatantId) => {
  for (const action of [...state.actionHistory].reverse()) {
    if (action.type !== "use-move" || action.actorId !== actorId) continue;
    const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === action.moveId);
    if (copyableAttackMove(move)) return move;
  }
  return undefined;
};

const copiedMoveForAction = (
  copyingMove: MoveDefinition,
  sourceMove: MoveDefinition,
  damageBonusPercent?: number,
  successfulEffectsOnly = false,
): MoveDefinition => ({
  ...sourceMove,
  id: copyingMove.id,
  name: copyingMove.name,
  description: copyingMove.description,
  effectText: copyingMove.effectText,
  effectClauses: copyingMove.effectClauses,
  mechanics: {
    ...sourceMove.mechanics,
    restrictedUses: copyingMove.mechanics.restrictedUses,
  },
  effects: [
    ...((successfulEffectsOnly
      ? sourceMove.effects?.filter((effect) => effect.trigger === "on-success")
      : sourceMove.effects) ?? []),
    ...(damageBonusPercent === undefined
      ? []
      : [
          {
            trigger: "before-attack-roll" as const,
            target: "self" as const,
            type: "modify-damage" as const,
            percent: { type: "literal" as const, value: damageBonusPercent },
            operation: "add" as const,
            sourceText: "Copied source attack bonus",
          },
        ]),
  ],
});

const copiedMoveForFixedDamage = (
  copyingMove: MoveDefinition,
  sourceMove: MoveDefinition,
): MoveDefinition => ({
  ...copyingMove,
  mechanics: {
    ...copyingMove.mechanics,
    attack: {
      ...copyingMove.mechanics.attack!,
      baseDamagePercent: { type: "literal", value: 0 },
    },
  },
  effects: sourceMove.effects?.filter((effect) => effect.trigger === "on-success"),
});

const copiedMoveActionSource = (
  state: ActiveFightState,
  move: MoveDefinition,
  actorId = state.activeCombatantId,
) => {
  const effect = supportedCopyMoveEffect(move);
  if (effect === undefined) return undefined;
  const sourceMove = lastPriorCopyableAttack(state, actorId);
  if (sourceMove === undefined || effect.damage?.type !== "add-percent") return undefined;
  if (effect.damage.value.type !== "literal") return undefined;
  return { effect, sourceMove, damageBonusPercent: effect.damage.value.value };
};

const selectedMoveCopyCandidates = (state: ActiveFightState, actorId: CombatantId) => {
  const opponent = Object.values(state.combatants).find(
    (combatant) => combatant.id !== actorId && combatant.status === "active",
  );
  if (opponent === undefined) return [];
  return opponent.moveIds.flatMap((moveId) => {
    const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === moveId);
    return move?.category === "advanced-attack" && move.mechanics.attack !== undefined
      ? [move]
      : [];
  });
};

const selectedPriorMoveCopyCandidates = (
  state: ActiveFightState,
  actorId: CombatantId,
  allowSignature = false,
) => {
  const opponentId = Object.values(state.combatants).find(
    (combatant) => combatant.id !== actorId && combatant.status === "active",
  )?.id;
  if (opponentId === undefined) return [];
  return state.actionHistory.flatMap((action) => {
    if (
      action.type !== "use-move" ||
      action.actorId !== opponentId ||
      action.targetCombatantId !== actorId ||
      action.outcome !== "successful" ||
      !Number.isFinite(action.damageDealt)
    )
      return [];
    const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === action.moveId);
    return (move?.category === "advanced-attack" ||
      (allowSignature && move?.category === "signature")) &&
      move.mechanics.attack !== undefined &&
      copiedSuccessfulEffectsAreExecutable(move)
      ? [
          {
            move,
            sourceActionId: action.decisionId,
            sourceDamageDealt: action.damageDealt,
            sourceResolutionSnapshot: action.resolutionSnapshot,
          },
        ]
      : [];
  });
};

const selectedMoveCopyActionSource = (
  state: ActiveFightState,
  move: MoveDefinition,
  actorId: CombatantId,
) => {
  const compiled = supportedSelectedMoveCopyEffect(move);
  if (compiled === undefined) return undefined;
  const candidates = selectedMoveCopyCandidates(state, actorId);
  return candidates.length === 0
    ? undefined
    : { ...compiled, candidates: candidates.map((candidate) => ({ move: candidate })) };
};

const selectedPriorMoveCopyActionSource = (
  state: ActiveFightState,
  move: MoveDefinition,
  actorId: CombatantId,
) => {
  const effect = selectedPriorCopyMoveEffect(move);
  if (effect === undefined) return undefined;
  const candidates = selectedPriorMoveCopyCandidates(state, actorId, isFullPriorAttackCopy(effect));
  const eligibleCandidates = isFullPriorAttackCopy(effect)
    ? candidates.filter((candidate) => candidate.sourceResolutionSnapshot !== undefined)
    : candidates;
  return eligibleCandidates.length === 0
    ? undefined
    : { effect, effectIndex: (move.effects ?? []).indexOf(effect), candidates: eligibleCandidates };
};

const copyMoveSelectionActionSource = (
  state: ActiveFightState,
  move: MoveDefinition,
  actorId: CombatantId,
) => {
  const selected = selectedMoveCopyActionSource(state, move, actorId);
  if (selected !== undefined) return selected;
  return selectedPriorMoveCopyActionSource(state, move, actorId);
};

const copyMoveUseAvailable = (
  state: ActiveFightState,
  actorId: CombatantId,
  moveId: MoveId,
  effect: CopyMoveEffectDefinition,
) =>
  effect.useLimit?.scope !== "combat" ||
  effect.useLimit.count !== 1 ||
  (state.combatants[actorId].moveUses[moveId] ?? 0) < effect.useLimit.count;

const copyMoveSelectionTransition = ({
  state,
  decision,
  move,
  effectIndex,
  candidates,
  dependencies,
}: {
  readonly state: ActiveFightState;
  readonly decision: Extract<CombatDecision, { readonly type: "use-move" }>;
  readonly move: MoveDefinition;
  readonly effectIndex: number;
  readonly candidates: readonly {
    readonly move: MoveDefinition;
    readonly sourceActionId?: CombatDecisionId;
    readonly sourceDamageDealt?: number;
    readonly sourceResolutionSnapshot?: AttackResolutionSnapshot;
  }[];
  readonly dependencies: CombatDependencies;
}): CombatResult<CombatTransition> => {
  const pendingDecisionId = dependencies.ids.nextPendingDecisionId();
  return transitionFrom(
    {
      ...state,
      pendingDecision: {
        id: pendingDecisionId,
        stateVersion: state.version,
        combatantId: decision.actorId,
        type: "select-move",
        options: candidates.map((candidate) => ({
          id: `copy-move:${candidate.sourceActionId ?? candidate.move.id}`,
          type: "select-move" as const,
          moveId: candidate.move.id,
          sourceMoveSnapshot: candidate.move,
          ...(candidate.sourceActionId === undefined
            ? {}
            : {
                sourceActionId: candidate.sourceActionId,
                sourceDamageDealt: candidate.sourceDamageDealt,
                ...(candidate.sourceResolutionSnapshot === undefined
                  ? {}
                  : { sourceResolutionSnapshot: candidate.sourceResolutionSnapshot }),
              }),
        })),
      },
      resolutionFrames: [
        ...state.resolutionFrames,
        {
          id: dependencies.ids.nextResolutionFrameId(),
          type: "effect" as const,
          decisionId: decision.id,
          sourceCombatantId: decision.actorId,
          targetCombatantId: decision.targetCombatantId,
          sourceDefinitionId: move.id,
          effectIndex,
          operation: "copy-move" as const,
          returnPhase: state.phase,
          trigger: "action" as const,
          pendingDecisionId,
          eligibleMoveIds: candidates.map((candidate) => candidate.move.id),
          ...(candidates.some((candidate) => candidate.sourceActionId !== undefined)
            ? {
                eligibleSourceActionIds: candidates.flatMap((candidate) =>
                  candidate.sourceActionId === undefined ? [] : [candidate.sourceActionId],
                ),
              }
            : {}),
          remainingSelections: 1,
        },
      ],
    },
    [],
  );
};

const isCopyMoveAction = (state: ActiveFightState, move: MoveDefinition) => {
  if (selectedPriorMoveCopyActionSource(state, move, state.activeCombatantId) !== undefined)
    return true;
  if (move.mechanics.attack !== undefined) return false;
  if (copiedMoveActionSource(state, move) !== undefined) return true;
  const selected = selectedMoveCopyActionSource(state, move, state.activeCombatantId);
  if (
    selected !== undefined &&
    copyMoveUseAvailable(state, state.activeCombatantId, move.id, selected.effect)
  )
    return true;
  return false;
};

const copiedMoveAttackReference = (
  moveId: MoveId,
  copiedFromMoveId: MoveId | undefined,
  copiedDamageBonusPercent: number | undefined,
  copiedSourceMove: MoveDefinition | undefined,
  copiedDamageOverride: number | undefined,
  copiedSuccessfulEffectsOnly: boolean | undefined,
  copiedSourceResolution: AttackResolutionSnapshot | undefined,
): CopiedMoveAttackReference => ({
  type: "move",
  moveId,
  ...(copiedFromMoveId === undefined ? {} : { copiedFromMoveId }),
  ...(copiedSourceMove === undefined ? {} : { copiedSourceMove }),
  ...(copiedDamageBonusPercent === undefined ? {} : { copiedDamageBonusPercent }),
  ...(copiedDamageOverride === undefined ? {} : { copiedDamageOverride }),
  ...(copiedSuccessfulEffectsOnly === undefined ? {} : { copiedSuccessfulEffectsOnly }),
  ...(copiedSourceResolution === undefined ? {} : { copiedSourceResolution }),
});

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
      const compiled = compileEffectPlan({
        sourceDefinitionId: move.id,
        effectIndex,
        effect,
        allowPendingChoice: true,
      });
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
  effectIndex?: number,
  freeReaction = false,
) => {
  if (move.category !== "skill" || freeReaction) {
    if (
      freeReaction &&
      effectUseLimit?.scope === "combat" &&
      effectIndex !== undefined &&
      (state.combatants[combatantId].effectUseCounts?.[`${move.id}:${effectIndex}`] ?? 0) >=
        (typeof effectUseLimit.count === "number" ? effectUseLimit.count : Number.POSITIVE_INFINITY)
    )
      return undefined;
    return { consumesMoveUse: false, kiCost: 0 } as const;
  }
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
  const limit = moveLimit;
  if (
    combatant.ki.current < kiCost ||
    (limit !== undefined && (combatant.moveUses[move.id] ?? 0) >= limit)
  )
    return undefined;
  if (
    effectLimit !== undefined &&
    effectIndex !== undefined &&
    (combatant.effectUseCounts?.[`${move.id}:${effectIndex}`] ?? 0) >= effectLimit
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
      reactionSkillAvailability(
        state,
        combatantId,
        source.move,
        source.effect.useLimit,
        source.effectIndex,
        source.effect.trigger === "on-roll-result",
      ) !== undefined,
  );

const hasPostDefenseReaction = (
  state: ActiveFightState,
  combatantId: CombatantId,
  attackMove?: MoveDefinition,
) =>
  availablePostRollDefenseItems(state.combatants[combatantId]).length > 0 ||
  hasActiveConstant(state, combatantId, "move-aoyosumu-close-shave") ||
  hasPostDefenseRerollPotential(state, combatantId, "defense", attackMove) ||
  hasBeforeDefenseChoicePotential(state, combatantId) ||
  hasRerollDefinition(state.combatants[combatantId]) ||
  hasCounterActionPotential(state, combatantId) ||
  state.activeEffects.some(
    (effect) =>
      effect.type === "reroll" &&
      effect.sourceCombatantId === combatantId &&
      (effect.useLimit === undefined || effect.useLimit.remaining > 0),
  );

const hasBeforeDefenseChoicePotential = (state: ActiveFightState, combatantId: CombatantId) =>
  state.combatants[combatantId].moveIds.some((moveId) => {
    const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === moveId);
    return (move?.effects ?? []).some(
      (effect) =>
        effect.trigger === "before-defense-roll" &&
        (effect.target === "self" || effect.target === "opponent") &&
        (effect.optional === true ||
          effect.activationGroup !== undefined ||
          effect.exclusiveActivationGroup !== undefined),
    );
  });

type SetCombatResultEffect = Extract<EffectDefinition, { readonly type: "set-combat-result" }>;

interface CombatResultSource {
  readonly ownerId: CombatantId;
  readonly move: MoveDefinition;
  readonly effectIndex: number;
  readonly effect: SetCombatResultEffect;
  readonly activeConstant: boolean;
}

type NegateEffect = Extract<EffectDefinition, { readonly type: "negate" }>;
type DefenseResponse = NonNullable<MoveEffectRuntimeContext["defenseResponse"]>;

interface CombatResultNegationSource {
  readonly ownerId: CombatantId;
  readonly move: MoveDefinition;
  readonly effectIndex: number;
  readonly effect: NegateEffect;
  readonly activeConstant: boolean;
}

type CombatResultOutcome = "blocked" | "stopped" | "successful";

interface CombatResultRoll {
  readonly attackNaturalResult: number;
  readonly attackResult: number;
  readonly defenseNaturalResult: number;
  readonly defenseResult: number;
  readonly outcome: CombatResultOutcome;
}

type NegatableCombatOutcome = "stun" | "critical" | "counter";

const combatResultSources = (state: ActiveFightState, ownerId: CombatantId) => {
  const owner = state.combatants[ownerId];
  const activeConstantIds = new Set(
    state.activeEffects.flatMap((activeEffect) =>
      activeEffect.type === "active-constant" &&
      activeEffect.lifecycle !== "deactivated" &&
      activeEffect.sourceCombatantId === ownerId &&
      !activeEffectSuppressed(state, activeEffect)
        ? [activeEffect.sourceDefinitionId]
        : [],
    ),
  );
  const sourceIds = new Set([...owner.moveIds, ...activeConstantIds]);
  return [...sourceIds].flatMap((sourceId) => {
    const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === sourceId);
    if (move === undefined) return [];
    return (move.effects ?? []).flatMap((effect, effectIndex) => {
      if (effect.trigger !== "after-defense-roll" || effect.type !== "set-combat-result") return [];
      const hasReactionAccounting =
        effect.activationCost !== undefined || effect.useLimit !== undefined;
      if (!activeConstantIds.has(sourceId) && move.category !== "mastery" && !hasReactionAccounting)
        return [];
      return [
        { ownerId, move, effectIndex, effect, activeConstant: activeConstantIds.has(sourceId) },
      ];
    });
  });
};

const combatResultNegationSources = (state: ActiveFightState, ownerId: CombatantId) => {
  const owner = state.combatants[ownerId];
  const activeConstantIds = new Set(
    state.activeEffects.flatMap((activeEffect) =>
      activeEffect.type === "active-constant" &&
      activeEffect.lifecycle !== "deactivated" &&
      activeEffect.sourceCombatantId === ownerId &&
      !activeEffectSuppressed(state, activeEffect)
        ? [activeEffect.sourceDefinitionId]
        : [],
    ),
  );
  const sourceIds = new Set([...owner.moveIds, ...activeConstantIds]);
  return [...sourceIds].flatMap<CombatResultNegationSource>((sourceId) => {
    const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === sourceId);
    if (move === undefined) return [];
    return (move.effects ?? []).flatMap((effect, effectIndex) => {
      if (effect.trigger !== "on-combat-result" || effect.type !== "negate") return [];
      if (!activeConstantIds.has(sourceId) && move.category !== "mastery") return [];
      return [
        { ownerId, move, effectIndex, effect, activeConstant: activeConstantIds.has(sourceId) },
      ];
    });
  });
};

const combatResultSourceContext = (
  state: ActiveFightState,
  source: CombatResultSource,
  frame: Extract<
    ActiveFightState["resolutionFrames"][number],
    { readonly stage: "awaiting-defense" | "awaiting-post-defense-reaction" }
  >,
  roll: CombatResultRoll,
) => {
  const opponentId = Object.values(state.combatants).find(
    (combatant) => combatant.id !== source.ownerId && combatant.status === "active",
  )?.id;
  if (opponentId === undefined) return undefined;
  return {
    ...convertedAttackEffectContext(
      state,
      state.combatants[source.ownerId],
      state.combatants[opponentId],
      moveForPostDefenseFrame(frame),
    ),
    triggeringMoveOwner:
      source.ownerId === frame.attackerId ? ("self" as const) : ("opponent" as const),
    rolls: [roll],
  };
};

const combatResultNegationContext = (
  state: ActiveFightState,
  source: CombatResultNegationSource,
  frame: Extract<
    ActiveFightState["resolutionFrames"][number],
    { readonly stage: "awaiting-defense" | "awaiting-post-defense-reaction" }
  >,
  roll: CombatResultRoll,
  outcome: NegatableCombatOutcome,
) => {
  const opponentId = Object.values(state.combatants).find(
    (combatant) => combatant.id !== source.ownerId && combatant.status === "active",
  )?.id;
  const triggeringMove = moveForPostDefenseFrame(frame);
  if (opponentId === undefined || triggeringMove === undefined) return undefined;
  return {
    ...convertedAttackEffectContext(
      state,
      state.combatants[source.ownerId],
      state.combatants[opponentId],
      triggeringMove,
    ),
    triggeringMoveOwner:
      source.ownerId === frame.attackerId ? ("self" as const) : ("opponent" as const),
    combatOutcome: outcome,
    combatOutcomeActor:
      source.ownerId === frame.attackerId ? ("self" as const) : ("opponent" as const),
    rolls: [roll],
  };
};

const combatOutcomesForPostDefenseRolls = (
  state: ActiveFightState,
  frame: Extract<
    ActiveFightState["resolutionFrames"][number],
    { readonly stage: "awaiting-defense" | "awaiting-post-defense-reaction" }
  >,
  rolls: readonly CombatResultRoll[],
): readonly NegatableCombatOutcome[] => {
  const move = moveForPostDefenseFrame(frame);
  if (move === undefined || move.mechanics.attack === undefined || rolls.length === 0) return [];
  const attacker = state.combatants[frame.attackerId];
  const defender = state.combatants[frame.targetCombatantId];
  const attackRoll = move.mechanics.attack.attackRoll ?? defaultMoveAttackRoll();
  const critical =
    rolls.length === 1 &&
    qualifiesForCritical({
      attackerDexterity: attacker.stats.dexterity,
      defenderDexterity: defender.stats.dexterity,
      diceCount: attackRoll.dice,
      diceSides: attackRoll.sides,
      naturalAttackResult: rolls[0].attackNaturalResult,
      naturalDefenseResult: rolls[0].defenseNaturalResult,
      outcome: rolls[0].outcome === "successful" ? "successful" : "stopped",
    });
  const counter =
    rolls.every((roll) => roll.outcome === "stopped") &&
    rolls.some((roll) =>
      qualifiesForCounter({
        attackerDexterity: attacker.stats.dexterity,
        defenderDexterity: defender.stats.dexterity,
        diceCount: attackRoll.dice,
        diceSides: attackRoll.sides,
        naturalAttackResult: roll.attackNaturalResult,
        naturalDefenseResult: roll.defenseNaturalResult,
        outcome: "stopped",
      }),
    );
  const successfulHitCount = rolls.filter((roll) => roll.outcome === "successful").length;
  const successfulEffects =
    successfulHitCount === 0
      ? undefined
      : successfulMoveEffects(move, {
          ...convertedAttackEffectContext(state, attacker, defender, move),
          successfulHitCount,
          rolls,
        });
  const stun = successfulEffects?.statuses.some(
    (application) => application.target === "opponent" && application.status.statusId === "stun",
  );
  return [
    ...(stun ? (["stun"] as const) : []),
    ...(critical ? (["critical"] as const) : []),
    ...(counter ? (["counter"] as const) : []),
  ];
};

const combatResultOverrideForSourceRoll = (
  state: ActiveFightState,
  source: CombatResultSource,
  frame: Extract<
    ActiveFightState["resolutionFrames"][number],
    { readonly stage: "awaiting-defense" | "awaiting-post-defense-reaction" }
  >,
  roll: CombatResultRoll,
) => {
  const context = combatResultSourceContext(state, source, frame, roll);
  if (context === undefined) return undefined;
  const resolved = moveEffectsForTrigger(source.move, "after-defense-roll", context);
  const result = resolved.combatResultOverrides.find(
    (application) =>
      application.resultScope === "matching-die" &&
      (application.result === "successful" || application.result === "stopped") &&
      (application.target === "self"
        ? source.ownerId === frame.attackerId
        : source.ownerId === frame.targetCombatantId),
  )?.result;
  return result === "successful" || result === "stopped" ? result : undefined;
};

const automaticCombatResultOverrides = (
  state: ActiveFightState,
  frame: Extract<
    ActiveFightState["resolutionFrames"][number],
    { readonly stage: "awaiting-defense" }
  >,
  rolls: readonly {
    readonly attackNaturalResult: number;
    readonly attackResult: number;
    readonly defenseNaturalResult: number;
    readonly defenseResult: number;
  }[],
) =>
  rolls.map((roll) => {
    for (const owner of [frame.attackerId, frame.targetCombatantId]) {
      for (const source of combatResultSources(state, owner)) {
        if (source.effect.activationCost !== undefined || source.effect.useLimit !== undefined)
          continue;
        const result = combatResultOverrideForSourceRoll(state, source, frame, {
          ...roll,
          outcome: roll.attackResult >= roll.defenseResult ? "successful" : "stopped",
        });
        if (result !== undefined) return result;
      }
    }
    return undefined;
  });

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

const combatResultReactionOptions = (
  state: ActiveFightState,
  frame: Extract<
    ActiveFightState["resolutionFrames"][number],
    { readonly stage: "awaiting-defense" | "awaiting-post-defense-reaction" }
  >,
  ownerId: CombatantId,
  rolls: readonly {
    readonly attackNaturalResult: number;
    readonly attackResult: number;
    readonly defenseNaturalResult?: number;
    readonly defenseResult?: number;
    readonly outcome: "blocked" | "stopped" | "successful";
  }[],
): PendingDecisionOption[] => {
  return combatResultSources(state, ownerId).flatMap((source) => {
    if (source.effect.activationCost?.resource !== "ki") return [];
    const owner = state.combatants[ownerId];
    const firstRoll = rolls[0];
    if (firstRoll?.defenseNaturalResult === undefined || firstRoll.defenseResult === undefined)
      return [];
    const context = combatResultSourceContext(state, source, frame, {
      ...firstRoll,
      defenseNaturalResult: firstRoll.defenseNaturalResult,
      defenseResult: firstRoll.defenseResult,
    });
    if (context === undefined) return [];
    const amount = evaluateDurableNumericExpression(source.effect.activationCost.amount, {
      ...context,
      participantCount: 2,
    });
    let limit: number | undefined;
    if (source.effect.useLimit?.scope === "combat") {
      limit =
        typeof source.effect.useLimit.count === "number"
          ? source.effect.useLimit.count
          : evaluateDurableNumericExpression(source.effect.useLimit.count, {
              ...context,
              participantCount: 2,
            });
    }
    if (amount === undefined || owner.ki.current < amount) return [];
    if (limit !== undefined && (owner.moveUses[source.move.id] ?? 0) >= limit) return [];
    return rolls.flatMap((roll, dieIndex) => {
      if (
        roll.defenseNaturalResult === undefined ||
        roll.defenseResult === undefined ||
        roll.outcome !== "stopped"
      )
        return [];
      const result = combatResultOverrideForSourceRoll(state, source, frame, {
        ...roll,
        defenseNaturalResult: roll.defenseNaturalResult,
        defenseResult: roll.defenseResult,
      });
      return result === undefined
        ? []
        : [
            {
              id: `activate-combat-result:${source.move.id}:${source.effectIndex}:${dieIndex}`,
              type: "activate-effect" as const,
              moveId: source.move.id,
              effectIndices: [source.effectIndex],
              combatResultOverride: {
                sourceDefinitionId: source.move.id,
                sourceEffectIndex: source.effectIndex,
                dieIndex,
              },
            },
          ];
    });
  });
};

const combatResultNegationOptions = (
  state: ActiveFightState,
  frame: Extract<
    ActiveFightState["resolutionFrames"][number],
    { readonly stage: "awaiting-defense" | "awaiting-post-defense-reaction" }
  >,
  ownerId: CombatantId,
  rolls: readonly {
    readonly attackNaturalResult: number;
    readonly attackResult: number;
    readonly defenseNaturalResult?: number;
    readonly defenseResult?: number;
    readonly outcome: "blocked" | "stopped" | "successful";
  }[],
): PendingDecisionOption[] => {
  const outcomes = combatOutcomesForPostDefenseRolls(
    state,
    frame,
    rolls.flatMap((roll) =>
      roll.defenseNaturalResult === undefined || roll.defenseResult === undefined
        ? []
        : [
            {
              attackNaturalResult: roll.attackNaturalResult,
              attackResult: roll.attackResult,
              defenseNaturalResult: roll.defenseNaturalResult,
              defenseResult: roll.defenseResult,
              outcome: roll.outcome,
            },
          ],
    ),
  );
  if (outcomes.length === 0) return [];
  return combatResultNegationSources(state, ownerId).flatMap((source) =>
    outcomes.flatMap((outcome) => {
      const roll = rolls[0];
      if (roll?.defenseNaturalResult === undefined || roll.defenseResult === undefined) return [];
      const context = combatResultNegationContext(
        state,
        source,
        frame,
        {
          attackNaturalResult: roll.attackNaturalResult,
          attackResult: roll.attackResult,
          defenseNaturalResult: roll.defenseNaturalResult,
          defenseResult: roll.defenseResult,
          outcome: roll.outcome,
        },
        outcome,
      );
      if (context === undefined) return [];
      if (
        !(source.effect.conditions ?? []).every(
          (condition) =>
            condition.type !== "combat-outcome" ||
            (condition.actor === context.combatOutcomeActor &&
              condition.outcome === context.combatOutcome),
        )
      )
        return [];
      const resolved = moveEffectsForTrigger(source.move, "on-combat-result", context);
      if (
        !resolved.negations.some(
          (negation) =>
            negation.target === "opponent" && negation.combatOutcomes?.includes(outcome) === true,
        )
      )
        return [];
      const activationCost = source.effect.activationCost;
      if (activationCost?.resource !== "ki") return [];
      const amount = evaluateDurableNumericExpression(activationCost.amount, {
        ...context,
        participantCount: 2,
      });
      const minimum =
        activationCost.minimum === undefined
          ? undefined
          : evaluateDurableNumericExpression(activationCost.minimum, {
              ...context,
              participantCount: 2,
            });
      const cost =
        amount === undefined || (activationCost.minimum !== undefined && minimum === undefined)
          ? undefined
          : Math.max(amount, minimum ?? amount);
      return cost === undefined || state.combatants[ownerId].ki.current < cost
        ? []
        : [
            {
              id: `activate-combat-result-negation:${source.move.id}:${source.effectIndex}:${outcome}`,
              type: "activate-effect" as const,
              moveId: source.move.id,
              effectIndices: [source.effectIndex],
              combatResultNegation: {
                sourceDefinitionId: source.move.id,
                sourceEffectIndex: source.effectIndex,
                outcome,
              },
            },
          ];
    }),
  );
};

const hasCombatResultReactionPotential = (
  state: ActiveFightState,
  frame: Extract<
    ActiveFightState["resolutionFrames"][number],
    { readonly stage: "awaiting-defense" | "awaiting-post-defense-reaction" }
  >,
) =>
  [frame.attackerId, frame.targetCombatantId].some(
    (ownerId) =>
      combatResultSources(state, ownerId).some(
        (source) => source.effect.activationCost?.resource === "ki",
      ) ||
      combatResultNegationSources(state, ownerId).some(
        (source) => source.effect.activationCost?.resource === "ki",
      ),
  );

const combatResultReactionCost = (
  state: ActiveFightState,
  frame: PostDefenseReactionFrame,
  selection: NonNullable<PendingDecisionOption["combatResultOverride"]>,
) => {
  const source = [frame.attackerId, frame.targetCombatantId]
    .flatMap((ownerId) => combatResultSources(state, ownerId))
    .find(
      (candidate) =>
        candidate.move.id === selection.sourceDefinitionId &&
        candidate.effectIndex === selection.sourceEffectIndex,
    );
  const roll = postDefenseFrameRolls(state, frame).at(selection.dieIndex);
  if (source === undefined) return undefined;
  const activationCost = source.effect.activationCost;
  if (
    roll === undefined ||
    roll.defenseNaturalResult === undefined ||
    roll.defenseResult === undefined ||
    activationCost === undefined
  )
    return undefined;
  const context = combatResultSourceContext(state, source, frame, {
    attackNaturalResult: roll.attackNaturalResult,
    attackResult: roll.attackResult,
    defenseNaturalResult: roll.defenseNaturalResult,
    defenseResult: roll.defenseResult,
    outcome:
      roll.attackResult >= roll.defenseResult ? ("successful" as const) : ("stopped" as const),
  });
  if (context === undefined || activationCost.resource !== "ki") return undefined;
  return evaluateDurableNumericExpression(activationCost.amount, {
    ...context,
    participantCount: 2,
  });
};

const combatResultNegationCost = (
  state: ActiveFightState,
  frame: PostDefenseReactionFrame,
  selection: NonNullable<PendingDecisionOption["combatResultNegation"]>,
) => {
  const source = [frame.attackerId, frame.targetCombatantId]
    .flatMap((ownerId) => combatResultNegationSources(state, ownerId))
    .find(
      (candidate) =>
        candidate.move.id === selection.sourceDefinitionId &&
        candidate.effectIndex === selection.sourceEffectIndex,
    );
  const roll = postDefenseFrameRolls(state, frame)[0];
  if (
    source === undefined ||
    roll.defenseNaturalResult === undefined ||
    roll.defenseResult === undefined ||
    source.effect.activationCost === undefined
  )
    return undefined;
  const context = combatResultNegationContext(
    state,
    source,
    frame,
    {
      attackNaturalResult: roll.attackNaturalResult,
      attackResult: roll.attackResult,
      defenseNaturalResult: roll.defenseNaturalResult,
      defenseResult: roll.defenseResult,
      outcome: roll.outcome,
    },
    selection.outcome,
  );
  if (context === undefined || source.effect.activationCost.resource !== "ki") return undefined;
  const amount = evaluateDurableNumericExpression(source.effect.activationCost.amount, {
    ...context,
    participantCount: 2,
  });
  const minimum =
    source.effect.activationCost.minimum === undefined
      ? undefined
      : evaluateDurableNumericExpression(source.effect.activationCost.minimum, {
          ...context,
          participantCount: 2,
        });
  return amount === undefined ||
    (source.effect.activationCost.minimum !== undefined && minimum === undefined)
    ? undefined
    : Math.max(amount, minimum ?? amount);
};

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
  effectIndex: number,
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
      sourceEffectIndex: effectIndex,
      targetCombatantId,
      ...(effect.selector === undefined ? {} : { selector: effect.selector }),
      ...(scope === undefined ? {} : { scope }),
      ...(remaining === undefined ? {} : { remaining }),
      modifier: {
        type: "damage" as const,
        amount,
        ...(effect.stacking === undefined ? {} : { stacking: effect.stacking }),
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
  effectIndex: number,
): ActiveCombatEffect[] => {
  const numericContext = {
    self: context.actor,
    opponent: context.target,
    turnNumber: context.state.turnNumber,
    participantCount: 2,
    completedTurnCount: context.state.turnNumber - 1,
    actionHistory: context.state.actionHistory,
    activeEffects: context.state.activeEffects,
    moves: new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate])),
    moveActivationCounts: moveActivationCounts(context.state),
    mode: context.state.mode,
  };
  if (isDamageActionModifier(effect)) {
    return actionDamageModifier(effect, context, numericContext, effectIndex);
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
  return (move.effects ?? []).flatMap((effect, effectIndex) =>
    actionMoveModifier(effect, context, effectIndex),
  );
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
        selectorMatchesMoveForCombatant(state, defenderId, effect.selector, move),
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
  readonly aspect: "cost" | "damage" | "dice-sides" | "effects" | "roll-results";
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
}: ActiveMoveModificationPreventedInput) => {
  const matchesPrevention = (
    prevention: Pick<
      MoveModificationPreventionApplication,
      | "actor"
      | "selector"
      | "aspects"
      | "operations"
      | "exceptSourceMoveIds"
      | "exceptSourceStatusIds"
      | "effectSourceStyleExcludes"
    >,
    preventionSourceCombatantId: CombatantId,
  ) => {
    if (
      !prevention.aspects.includes(aspect) ||
      !effectMatchesMoveSelector(prevention.selector, move) ||
      !moveModificationActorMatches(
        prevention.actor,
        sourceCombatantId,
        preventionSourceCombatantId,
      ) ||
      (prevention.operations?.includes("reduce") === true && !reduces)
    )
      return false;
    if (prevention.exceptSourceMoveIds?.includes(sourceDefinitionId)) return false;
    if (sourceStatusId !== undefined && prevention.exceptSourceStatusIds?.includes(sourceStatusId))
      return false;
    if (prevention.effectSourceStyleExcludes === undefined) return true;
    const sourceMove = MOVE_DEFINITIONS.find((candidate) => candidate.id === sourceDefinitionId);
    return sourceMove?.styleId !== prevention.effectSourceStyleExcludes;
  };
  if (
    state.activeEffects.some((effect) => {
      return (
        effect.type === "prevent-move-modification" &&
        !activeEffectSuppressed(state, effect) &&
        effect.targetCombatantId === combatantId &&
        (effect.availableFromTurn === undefined || state.turnNumber >= effect.availableFromTurn) &&
        matchesPrevention(effect, effect.sourceCombatantId)
      );
    })
  )
    return true;
  if (move === undefined) return false;
  const moves = new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate]));
  return state.activeEffects.some(
    (constant) =>
      constant.type === "active-constant" &&
      constant.lifecycle !== "deactivated" &&
      !activeEffectSuppressed(state, constant) &&
      (() => {
        const sourceMove = moves.get(constant.sourceDefinitionId);
        const source = state.combatants[constant.sourceCombatantId];
        const opponent = Object.values(state.combatants).find(
          (candidate) => candidate.id !== source.id && candidate.status === "active",
        );
        if (sourceMove === undefined || opponent === undefined) return false;
        const passive = moveEffectsForTrigger(sourceMove, "passive", {
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
        return passive.moveModificationPreventions.some((prevention) => {
          const targetCombatantId = prevention.target === "self" ? source.id : opponent.id;
          return targetCombatantId === combatantId && matchesPrevention(prevention, source.id);
        });
      })(),
  );
};

const effectMatchesMoveSelector = (
  selector: MoveSelectorCondition | undefined,
  move?: MoveDefinition,
) =>
  selector === undefined ||
  (move !== undefined && selectorMatchesMove(selector, move)) ||
  (move === undefined && selectorMatchesAnyMove(selector));

const suppressionMatchesMove = (
  suppression: { readonly selector?: MoveSelectorCondition; readonly selectedMoveId?: MoveId },
  move?: MoveDefinition,
) =>
  (suppression.selectedMoveId === undefined || suppression.selectedMoveId === move?.id) &&
  effectMatchesMoveSelector(suppression.selector, move);

const selectorMatchesAnyMove = (selector: MoveSelectorCondition) => {
  const moveSpecificKeys = [
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
  ];
  if (selector.restriction === "unrestricted")
    return !moveSpecificKeys.some(
      (key) => selector[key as keyof MoveSelectorCondition] !== undefined,
    );
  return (
    selector.restriction === undefined &&
    ![...moveSpecificKeys, "restriction"].some(
      (key) => selector[key as keyof MoveSelectorCondition] !== undefined,
    )
  );
};

const activeEffectSuppressed = (state: ActiveFightState, effect: ActiveCombatEffect) => {
  if (effect.type === "suppress") return false;
  const sourceMove = MOVE_DEFINITIONS.find((move) => move.id === effect.sourceDefinitionId);
  if (sourceMove === undefined) return false;
  return state.activeEffects.some(
    (suppression) =>
      suppression.type === "suppress" &&
      suppression.targetCombatantId === effect.sourceCombatantId &&
      (suppression.duration.type !== "following-action" || suppression.duration.remaining <= 1) &&
      suppression.aspects.includes("all-effects") &&
      suppressionMatchesMove(suppression, sourceMove),
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

const transformerMatchesRollModification = (
  state: ActiveFightState,
  transformer: ActiveRollModifierTransformerEffect,
  combatantId: CombatantId,
  roll: CombatRollType,
  modifier: RollModifierKind,
  sourceDefinitionId: string | undefined,
) => {
  if (
    activeEffectSuppressed(state, transformer) ||
    transformer.targetCombatantId !== combatantId ||
    (transformer.duration !== "combat" && transformer.duration.roll !== roll) ||
    (transformer.modifier !== "any" && transformer.modifier !== modifier)
  )
    return false;
  if (sourceDefinitionId === undefined || transformer.excludeSourceCategories === undefined)
    return true;
  const sourceMove = MOVE_DEFINITIONS.find((move) => move.id === sourceDefinitionId);
  if (
    sourceMove === undefined ||
    (sourceMove.category !== "mastery" && sourceMove.category !== "skill")
  )
    return true;
  return !transformer.excludeSourceCategories.includes(sourceMove.category);
};

const transformedRollModifierAmount = (
  state: ActiveFightState,
  combatantId: CombatantId,
  roll: CombatRollType,
  modifier: RollModifierKind,
  sourceDefinitionId: string | undefined,
  amount: number,
) => {
  if (amount <= 0) return amount;
  return state.activeEffects
    .filter(
      (effect): effect is ActiveRollModifierTransformerEffect =>
        effect.type === "modify-roll-modifier" &&
        transformerMatchesRollModification(
          state,
          effect,
          combatantId,
          roll,
          modifier,
          sourceDefinitionId,
        ),
    )
    .reduce(
      (value, transformer) =>
        transformer.multiplier === undefined
          ? value + (transformer.increment ?? 0)
          : value * transformer.multiplier,
      amount,
    );
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
  const amount = matchingEffects.reduce((total, effect) => {
    const rawAmount = rollModifierAmount(effect, combatantId, roll, modifier, move);
    return (
      total +
      transformedRollModifierAmount(
        state,
        combatantId,
        roll,
        modifier,
        effect.type === "modify-roll" || effect.type === "modify-next-action"
          ? effect.sourceDefinitionId
          : undefined,
        rawAmount,
      )
    );
  }, 0);
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
      (effect.type === "modify-roll-modifier" &&
        effect.cap?.type === "allow-exceed" &&
        transformerMatchesRollModification(
          state,
          effect,
          combatantId,
          roll,
          modifier,
          undefined,
        )) ||
      (!activeRollModifierIsBlocked(state, effect, combatantId, roll, modifier, move) &&
        rollModifierAmount(effect, combatantId, roll, modifier, move) !== 0 &&
        activeRollModifierAllowsExceed(effect)),
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
  damageModifierMultiplier = 1,
) =>
  state.activeEffects.reduce((damage, effect) => {
    const modifier = activeDamageModifierForEffect(state, effect, combatantId, move);
    if (modifier === undefined) return damage;
    const modifiedDamage = applyDamageOperation(damage, {
      ...modifier,
      amount: modifier.amount * damageModifierMultiplier,
    });
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
        (modification.scope !== undefined &&
          modification.scope !== "current-action" &&
          modification.scope !== "following-action") ||
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

const damageModifierMultiplierForAttack = (
  state: ActiveFightState,
  attacker: CombatantState,
  defender: CombatantState,
  move: MoveDefinition,
  context: Parameters<typeof moveEffectsForTrigger>[2],
) => {
  const sources = [
    { move, self: attacker, opponent: defender },
    ...state.activeEffects.flatMap((effect) => {
      if (
        effect.type !== "active-constant" ||
        effect.lifecycle === "deactivated" ||
        effect.sourceCombatantId !== attacker.id ||
        activeEffectSuppressed(state, effect)
      )
        return [];
      const sourceMove = MOVE_DEFINITIONS.find(
        (candidate) => candidate.id === effect.sourceDefinitionId,
      );
      if (sourceMove === undefined) return [];
      const self = state.combatants[effect.sourceCombatantId];
      const opponent = self.id === attacker.id ? defender : attacker;
      return [{ move: sourceMove, self, opponent }];
    }),
  ];
  return sources.reduce((multiplier, source) => {
    const sourceContext = {
      ...context,
      self: source.self,
      opponent: source.opponent,
      triggeringMove: move,
      triggeringMoveOwner: "self" as const,
    };
    return (
      multiplier *
      (source.move.effects ?? []).reduce((current, effect) => {
        if (
          effect.trigger !== "passive" ||
          effect.target !== "self" ||
          effect.type !== "modify-damage-modifier" ||
          effect.scope?.type !== "current-action" ||
          effect.multiplier.type !== "literal" ||
          !effectConditionsMatch(effect.conditions, sourceContext)
        )
          return current;
        return current * effect.multiplier.value;
      }, 1)
    );
  }, 1);
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
  damageModifierMultiplier = 1,
) =>
  activeConstantDamageModifications(state, attackerId, defenderId, move).reduce(
    (damage, sourced) =>
      applySourcedDamageModification(
        state,
        damage,
        sourced,
        attackerId,
        move,
        damageModifierMultiplier,
      ),
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
  if (effect.selectedMoveId !== undefined && effect.selectedMoveId !== move?.id) return undefined;
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

const activeNextActionResourceChanges = (
  state: ActiveFightState,
  attacker: CombatantState,
  move: MoveDefinition | undefined,
  damage: number,
): readonly ResourceChange[] =>
  state.activeEffects.flatMap((effect) => {
    if (
      effect.type !== "modify-next-action" ||
      effect.modifier.type !== "resource" ||
      effect.targetCombatantId !== attacker.id ||
      activeEffectSuppressed(state, effect) ||
      !oneShotRollModifierIsEligible(state.turnNumber, effect) ||
      !effectMatchesMoveSelector(effect.selector, move)
    )
      return [];
    const amount = Math.max(0, Math.round((damage * effect.modifier.amount) / 100));
    return [
      {
        resource: effect.modifier.resource,
        target: "self" as const,
        operation: effect.modifier.operation,
        amount,
        sourceCombatantId: effect.sourceCombatantId,
        cause:
          effect.sourceCombatantId === attacker.id
            ? ("non-damage-effect" as const)
            : ("opponent-effect" as const),
      },
    ];
  });

const resourceChangesAfterActiveResourceModifierTransformers = (
  state: ActiveFightState,
  attacker: CombatantState,
  move: MoveDefinition | undefined,
  changes: readonly ResourceChange[],
) => {
  const modifiers = state.activeEffects.filter(
    (effect): effect is Extract<ActiveCombatEffect, { readonly type: "modify-next-action" }> =>
      effect.type === "modify-next-action" &&
      effect.modifier.type === "resource-modifier" &&
      effect.targetCombatantId === attacker.id &&
      !activeEffectSuppressed(state, effect) &&
      oneShotRollModifierIsEligible(state.turnNumber, effect) &&
      effectMatchesMoveSelector(effect.selector, move),
  );
  if (modifiers.length === 0) return changes;
  const remainingCaps = new Map(
    modifiers.flatMap((effect) =>
      effect.modifier.type === "resource-modifier" && effect.modifier.cap !== undefined
        ? [[effect.id, effect.modifier.cap.value] as const]
        : [],
    ),
  );
  return changes.map((change) => {
    let amount = change.amount;
    for (const effect of modifiers) {
      if (
        effect.modifier.type !== "resource-modifier" ||
        change.target !== "self" ||
        change.resource !== effect.modifier.resource ||
        change.operation !== effect.modifier.operation
      )
        continue;
      amount = Math.round(amount * effect.modifier.multiplier);
      if (effect.modifier.cap?.type === "maximum") {
        const remaining = remainingCaps.get(effect.id) ?? effect.modifier.cap.value;
        amount = Math.min(amount, remaining);
        remainingCaps.set(effect.id, Math.max(0, remaining - amount));
      }
    }
    return amount === change.amount ? change : { ...change, amount };
  });
};

const activeResourceCostModifiersForAction = (
  state: ActiveFightState,
  attacker: CombatantState,
  move: MoveDefinition | undefined,
) =>
  state.activeEffects.flatMap((effect) => {
    if (
      effect.type !== "modify-next-action" ||
      effect.modifier.type !== "resource-cost" ||
      effect.targetCombatantId !== attacker.id ||
      activeEffectSuppressed(state, effect) ||
      !oneShotRollModifierIsEligible(state.turnNumber, effect) ||
      !effectMatchesMoveSelector(effect.selector, move)
    )
      return [];
    return [effect];
  });

const resourceChangesAfterActiveResourceCostModifiers = (
  state: ActiveFightState,
  attacker: CombatantState,
  move: MoveDefinition | undefined,
  changes: readonly ResourceChange[],
  immediateModifiers: readonly ResourceCostModifierApplication[] = [],
) => {
  const modifiers = [
    ...activeResourceCostModifiersForAction(state, attacker, move),
    ...immediateModifiers.filter(
      (modifier) =>
        modifier.scope === "current-action" && effectMatchesMoveSelector(modifier.selector, move),
    ),
  ];
  if (modifiers.length === 0) return changes;
  return changes.map((change) => {
    if (
      change.target !== "self" ||
      change.resource !== "hp" ||
      (change.operation !== "lose" && change.operation !== "drain")
    )
      return change;
    const amount = modifiers.reduce((current, effect) => {
      let percent = 0;
      if ("modifier" in effect && effect.modifier.type === "resource-cost")
        percent = effect.modifier.amount;
      else if ("percent" in effect) percent = effect.percent;
      return Math.max(0, Math.round((current * (100 + percent)) / 100));
    }, change.amount);
    return { ...change, amount };
  });
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
  damageModifierMultiplier = 1,
) => {
  if (!effectMatchesMoveSelector(sourced.modification.selector, move)) return damage;
  const modifiedDamage = applyDamageOperation(damage, {
    ...sourced.modification,
    amount: sourced.modification.amount * damageModifierMultiplier,
  });
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
  damageModifierMultiplier = 1,
) =>
  modifications.reduce(
    (damage, modification) =>
      applySourcedDamageModification(
        state,
        damage,
        { modification, sourceCombatantId, sourceDefinitionId },
        combatantId,
        move,
        damageModifierMultiplier,
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
  if (effect.duration !== undefined) return [effect];
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
        effect.type !== "set-stat-comparison" &&
        effect.type !== "modify-move-classification" &&
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
      effect.type === "action-restriction" &&
      effect.duration?.type === "until-turn-start-roll-threshold" &&
      effect.duration.combatantId === combatantId
    ) {
      if (statusBackedActionRestriction(effect) !== undefined) return [effect];
      const duration = effect.duration;
      if (duration.remainingIgnoredChecks > 0)
        return [
          {
            ...effect,
            duration: {
              ...duration,
              remainingIgnoredChecks: duration.remainingIgnoredChecks - 1,
            },
          },
        ];
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
    }
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

const statusesAfterTurnStartChecks = (
  state: ActiveFightState,
  combatantId: CombatantId,
  dependencies: CombatDependencies,
) => {
  const combatant = state.combatants[combatantId];
  const events: CombatEvent[] = [];
  const activeStatuses = combatant.activeStatuses.flatMap((status) => {
    if (
      status.duration.type !== "until-turn-start-roll-threshold" ||
      status.duration.combatantId !== combatantId
    )
      return [status];
    const duration = status.duration;
    if (duration.remainingIgnoredChecks > 0)
      return [
        {
          ...status,
          duration: {
            ...duration,
            remainingIgnoredChecks: duration.remainingIgnoredChecks - 1,
          },
        },
      ];
    const naturalResult = Array.from({ length: duration.dice }, () =>
      dependencies.random.integer(1, duration.sides),
    ).reduce((total, result) => total + result, 0);
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + events.length + 1,
      fightId: state.id,
      type: "status-rolled",
      combatantId,
      statusId: status.statusId,
      naturalResult,
      result: naturalResult,
    });
    if (numericSelectorComparison(naturalResult, duration.comparison, duration.value)) {
      events.push({
        id: dependencies.ids.nextEventId(),
        sequence: state.eventSequence + events.length + 1,
        fightId: state.id,
        type: "status-removed",
        targetCombatantId: combatantId,
        statusId: status.statusId,
      });
      return [];
    }
    return [status];
  });
  return {
    combatants: { ...state.combatants, [combatantId]: { ...combatant, activeStatuses } },
    events,
  };
};

const statusBackedActionRestriction = (
  effect: Extract<ActiveCombatEffect, { readonly type: "action-restriction" }>,
) => {
  const sourceMove = MOVE_DEFINITIONS.find((move) => move.id === effect.sourceDefinitionId);
  const sourceEffect = sourceMove?.effects?.[effect.sourceEffectIndex];
  return sourceEffect?.conditions?.find(
    (condition): condition is Extract<EffectCondition, { readonly type: "status" }> =>
      condition.type === "status" && condition.state === "active",
  );
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

const nextActionCostModifierAfterAttack = (
  effect: Extract<ActiveCombatEffect, { readonly type: "modify-next-action" }>,
  context: AttackEffectResolutionContext,
) =>
  effect.targetCombatantId === context.attackerId &&
  oneShotRollModifierIsEligible(context.turnNumber, effect)
    ? []
    : [effect];

const nextActionResourceEffectAfterAttack = (
  effect: Extract<ActiveCombatEffect, { readonly type: "modify-next-action" }>,
  context: AttackEffectResolutionContext,
) => {
  if (
    effect.modifier.type !== "resource" &&
    effect.modifier.type !== "resource-cost" &&
    effect.modifier.type !== "resource-modifier"
  )
    return [effect];
  return effect.targetCombatantId === context.attackerId &&
    effectMatchesMoveSelector(effect.selector, context.move) &&
    oneShotRollModifierIsEligible(context.turnNumber, effect)
    ? []
    : [effect];
};

const nextActionEffectAfterAttack = (
  effect: Extract<ActiveCombatEffect, { readonly type: "modify-next-action" }>,
  context: AttackEffectResolutionContext,
) => {
  if (effect.modifier.type === "cost-modifier")
    return nextActionCostModifierAfterAttack(effect, context);
  if (effect.modifier.type === "damage") return damageEffectAfterAttack(effect, context);
  if (effect.modifier.type === "roll") return rollEffectAfterAttack(effect, context);
  if (effect.modifier.type === "cost") return costEffectAfterAttack(effect, context);
  if (effect.modifier.type === "combat-result") {
    if (
      effect.targetCombatantId !== context.attackerId ||
      !effectMatchesMoveSelector(effect.selector, context.move) ||
      !oneShotRollModifierIsEligible(context.turnNumber, effect)
    )
      return [effect];
    return [];
  }
  if (
    effect.modifier.type === "resource" ||
    effect.modifier.type === "resource-cost" ||
    effect.modifier.type === "resource-modifier"
  )
    return nextActionResourceEffectAfterAttack(effect, context);
  return statEffectAfterAttack(effect, context);
};

const costEffectAfterAttack = (
  effect: Extract<ActiveCombatEffect, { readonly type: "modify-next-action" }>,
  context: AttackEffectResolutionContext,
) => {
  if (effect.modifier.type !== "cost") return [effect];
  if (
    effect.targetCombatantId !== context.attackerId ||
    !effectMatchesMoveSelector(effect.selector, context.move) ||
    (effect.scope !== undefined &&
      effect.scope !== "next-action" &&
      effect.scope !== "next-actions" &&
      effect.scope !== "next-turn") ||
    (effect.availableFromTurn !== undefined && effect.availableFromTurn > context.turnNumber)
  )
    return [effect];
  if (effect.scope === "next-actions") {
    const remaining = (effect.remaining ?? 0) - 1;
    return remaining > 0 ? [{ ...effect, remaining }] : [];
  }
  if (effect.scope === undefined || effect.scope === "next-action" || effect.scope === "next-turn")
    return [];
  return [effect];
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
    (effect.duration.type === "next-actions" || effect.duration.type === "following-action") &&
    effect.duration.ownerCombatantId === context.attackerId &&
    suppressionMatchesMove(effect, context.move)
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
    duration?.type === "until-roll-threshold" &&
    ((duration.roll === "attack" && duration.combatantId === context.attackerId) ||
      (duration.roll === "defense" && duration.combatantId === context.defenderId)) &&
    (duration.moveSelector === undefined ||
      (context.move !== undefined && selectorMatchesMove(duration.moveSelector, context.move))) &&
    scheduledRollMatches(duration.roll, duration.comparison, duration.value, context)
  )
    return true;
  if (
    duration?.type === "until-combat-result" &&
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

const rerollAfterNonFloatingAttackResolution = (
  effect: Extract<ActiveCombatEffect, { readonly type: "reroll" }>,
  context: AttackEffectResolutionContext,
): readonly ActiveCombatEffect[] => {
  if (effect.duration.type === "combat") return [effect];
  let matchingRolls = 0;
  if (effect.roll === "attack" && effect.targetCombatantId === context.attackerId)
    matchingRolls = context.rolls?.length ?? 0;
  else if (effect.roll === "defense" && effect.targetCombatantId === context.defenderId)
    matchingRolls = context.rolls?.filter((roll) => roll.defenseResult !== undefined).length ?? 0;
  if (matchingRolls === 0) return [effect];
  if (effect.duration.type === "next-rolls") {
    const remaining = effect.duration.remaining - matchingRolls;
    return remaining > 0 ? [{ ...effect, duration: { ...effect.duration, remaining } }] : [];
  }
  return [];
};

const rollModifierTransformerAfterAttack = (
  effect: Extract<ActiveCombatEffect, { readonly type: "modify-roll-modifier" }>,
  context: AttackEffectResolutionContext,
): readonly ActiveCombatEffect[] => {
  if (effect.duration === "combat") return [effect];
  return rollWasMadeForTransformer(effect, context) ? [] : [effect];
};

const rollWasMadeForTransformer = (
  effect: Extract<ActiveCombatEffect, { readonly type: "modify-roll-modifier" }>,
  context: AttackEffectResolutionContext,
) =>
  effect.duration !== "combat" &&
  (effect.duration.roll === "attack"
    ? effect.targetCombatantId === context.attackerId && (context.rolls?.length ?? 0) > 0
    : effect.targetCombatantId === context.defenderId &&
      (context.rolls?.some((roll) => roll.defenseResult !== undefined) ?? false));

const immediateEffectAfterAttackResolution = (
  effect: Exclude<ActiveCombatEffect, { readonly type: "floating-effect" | "scheduled-resource" }>,
  context: AttackEffectResolutionContext,
): readonly ActiveCombatEffect[] | undefined => {
  if (effect.type === "modify-damage")
    return modifyDamageAfterNonFloatingAttackResolution(effect, context);
  if (effect.type === "modify-roll-modifier")
    return rollModifierTransformerAfterAttack(effect, context);
  if (effect.type === "set-roll-selection") return rollSelectionAfterAttack(effect, context);
  return undefined;
};

const rollSelectionAfterAttack = (
  effect: Extract<ActiveCombatEffect, { readonly type: "set-roll-selection" }>,
  context: AttackEffectResolutionContext,
): readonly ActiveCombatEffect[] => {
  const rollMade =
    (effect.roll === "attack" &&
      effect.targetCombatantId === context.attackerId &&
      (context.rolls?.length ?? 0) > 0) ||
    (effect.roll === "defense" &&
      effect.targetCombatantId === context.defenderId &&
      (context.rolls?.some((roll) => roll.defenseResult !== undefined) ?? false));
  return rollMade && effectMatchesMoveSelector(effect.selector, context.move) ? [] : [effect];
};

const temporaryMoveRemovalExpiredAfterAttack = (
  effect: Exclude<ActiveCombatEffect, { readonly type: "floating-effect" | "scheduled-resource" }>,
  context: AttackEffectResolutionContext,
) =>
  effect.type === "remove-move-from-combat" &&
  effect.duration !== "combat" &&
  effect.duration.combatantId === context.attackerId &&
  context.rolls?.some((roll) => roll.attackNaturalResult === 30) === true;

const rollModifierExpiredAfterAttack = (
  effect: Exclude<ActiveCombatEffect, { readonly type: "floating-effect" | "scheduled-resource" }>,
  context: AttackEffectResolutionContext,
) =>
  effect.type === "modify-roll" &&
  effect.duration !== "combat" &&
  effect.duration.type === "turns-or-until-perfect-roll" &&
  effect.targetCombatantId === context.attackerId &&
  context.rolls?.some((roll) => roll.attackNaturalResult === 30) === true;

const effectAfterNonFloatingAttackResolution = (
  effect: Exclude<ActiveCombatEffect, { readonly type: "floating-effect" | "scheduled-resource" }>,
  context: AttackEffectResolutionContext,
): readonly ActiveCombatEffect[] => {
  const immediate = immediateEffectAfterAttackResolution(effect, context);
  if (immediate !== undefined) return immediate;
  if (rollModifierExpiredAfterAttack(effect, context)) return [];
  if (temporaryMoveRemovalExpiredAfterAttack(effect, context)) return [];
  if (effect.type === "modify-stat") return [effect];
  if (effect.type === "reroll") return rerollAfterNonFloatingAttackResolution(effect, context);
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
  readonly costEffectSourceDefinitionId?: MoveId;
  readonly costEffectIndices?: readonly number[];
  readonly costEffectTrigger?: CostEffectTrigger;
  readonly costEffectOwnerId?: CombatantId;
  readonly damageEffectSourceDefinitionId?: MoveId;
  readonly damageEffectIndices?: readonly number[];
  readonly deferredExecution?: NonNullable<AttackResolutionOptions["deferredExecution"]>;
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
  readonly modifier?: PreRollDefenseModifier;
  readonly preventedStatuses?: readonly CombatItemPreventedOutcome[];
  readonly response: Pick<
    Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
    "id"
  >;
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
    const preventedStatuses = combatItemPreventedOutcomes(item);
    if (modifier === undefined && preventedStatuses.length === 0) return [];
    return [
      {
        item,
        ...(modifier === undefined ? {} : { modifier }),
        ...(preventedStatuses.length === 0 ? {} : { preventedStatuses }),
        kiCost: 0,
      },
    ];
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
  costEffectSourceDefinitionId,
  costEffectIndices,
  costEffectTrigger,
  costEffectOwnerId,
  deferredExecution,
  dependencies,
}: DefenseRequestContext): CombatResult<CombatTransition> => {
  const pendingDecisionId = dependencies.ids.nextPendingDecisionId();
  const blocks = preventBlock ? [] : legalBlockMoves(state, target.id, blockableAttack);
  const defenseItems = availablePreRollDefenseItems(target);
  const beforeDefenseEffectChoices = beforeDefenseRerollChoices(
    state,
    decision.actorId,
    target.id,
    attack,
  );
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
        ...beforeDefenseEffectChoices.map((choice) => ({
          id: beforeDefenseEffectOptionId(choice),
          type: "activate-effect" as const,
          moveId: choice.sourceDefinitionId,
          effectIndices: choice.effectIndices,
        })),
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
        ...(costEffectSourceDefinitionId === undefined ? {} : { costEffectSourceDefinitionId }),
        ...(costEffectIndices === undefined ? {} : { costEffectIndices }),
        ...(costEffectTrigger === undefined ? {} : { costEffectTrigger }),
        ...(costEffectOwnerId === undefined ? {} : { costEffectOwnerId }),
        ...(deferredExecution === undefined ? {} : { deferredExecution }),
        ...(beforeDefenseEffectChoices.length === 0 ? {} : { beforeDefenseEffectChoices }),
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

interface BeforeDefenseEffectChoice {
  readonly sourceDefinitionId: MoveId;
  readonly effectIndices: readonly number[];
}

const beforeDefenseEffectOptionId = (choice: BeforeDefenseEffectChoice) =>
  `activate-before-defense:${choice.sourceDefinitionId}:${choice.effectIndices.join(",")}`;

const beforeDefenseRerollChoices = (
  state: ActiveFightState,
  attackerId: CombatantId,
  defenderId: CombatantId,
  attack: DefenseRequestContext["attack"],
): readonly BeforeDefenseEffectChoice[] => {
  const attacker = state.combatants[attackerId];
  const defender = state.combatants[defenderId];
  const triggeringMove = attack.type === "move" ? moveForAttackReference(attack) : undefined;
  const moves = new Map(MOVE_DEFINITIONS.map((move) => [move.id, move]));
  return defender.moveIds.flatMap((moveId) => {
    const sourceMove = moves.get(moveId);
    if (sourceMove === undefined) return [];
    const choices = moveEffectsForTrigger(sourceMove, "before-defense-roll", {
      self: defender,
      opponent: attacker,
      turnNumber: state.turnNumber,
      completedTurnCount: state.turnNumber - 1,
      moves,
      moveActivationCounts: moveActivationCounts(state),
      successfulHitCount: 0,
      actionHistory: state.actionHistory,
      activeEffects: state.activeEffects,
      mode: state.mode,
      collectPendingChoices: true,
      ...(triggeringMove === undefined
        ? {}
        : { triggeringMove, triggeringMoveOwner: "opponent" as const }),
    }).pendingEffectChoices;
    return choices.map(({ effectIndices }) => ({
      sourceDefinitionId: sourceMove.id,
      effectIndices,
    }));
  });
};

interface AttackEffectChoiceInput {
  readonly state: ActiveFightState;
  readonly decision: Extract<CombatDecision, { readonly type: "use-move" }>;
  readonly target: ActiveFightState["combatants"][CombatantId];
  readonly move: MoveDefinition;
  readonly effectIndices: readonly number[];
  readonly effectAlternatives?: readonly PendingEffectChoice[];
  readonly effectSourceDefinitionId?: MoveId;
  readonly effectSourceCombatantId?: CombatantId;
  readonly numericSelection: PendingEffectChoice["numericSelection"];
  readonly effectTrigger?:
    | "before-attack-roll"
    | "on-success"
    | "on-move-use"
    | "on-cost-modified"
    | "on-roll-modified"
    | "on-damage";
  readonly choiceCombatantId?: CombatantId;
  readonly naturalRolls?: readonly ContestedAttackNaturalRoll[];
  readonly blockedDice?: number;
  readonly blockUsage?: BlockUsage;
  readonly defenseItemUse?: DefenseItemUse;
  readonly defenseResultModifier?: number;
  readonly preventCritical?: boolean;
  readonly preventCounter?: boolean;
  readonly resultOverrides?: readonly ResultOverride[];
  readonly numericResultOverrides?: readonly NumericResultOverride[];
  readonly priorEnabledOptionalEffectIndices?: readonly number[];
  readonly priorResolvedOptionalEffectIndices?: readonly number[];
  readonly enabledAfterDefenseEffectIndices?: readonly number[];
  readonly selectedSuppressionMoves?: readonly {
    readonly effectIndex: number;
    readonly moveId: MoveId;
  }[];
  readonly includeRollEvents?: boolean;
  readonly rollEvents?: readonly CombatEvent[];
  readonly dependencies: CombatDependencies;
}

type AwaitingEffectChoiceAttackFrame = Extract<
  ActiveFightState["resolutionFrames"][number],
  { readonly type: "attack"; readonly stage: "awaiting-effect-choice" }
>;

const returnPhaseFor = (state: ActiveFightState): "action" | "counter" =>
  state.phase === "counter" ? "counter" : "action";

const pendingEffectChoiceOptions = (
  effectIndices: readonly number[],
  numericSelection: PendingEffectChoice["numericSelection"],
): readonly PendingDecisionOption[] => [
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
];

const awaitingEffectChoiceSourceFields = (input: AttackEffectChoiceInput) => ({
  ...(input.effectSourceDefinitionId === undefined
    ? {}
    : { effectSourceDefinitionId: input.effectSourceDefinitionId }),
  ...(input.effectSourceCombatantId === undefined
    ? {}
    : { effectSourceCombatantId: input.effectSourceCombatantId }),
  ...(input.effectTrigger === undefined || input.effectTrigger === "before-attack-roll"
    ? {}
    : { effectTrigger: input.effectTrigger }),
});

const awaitingEffectChoiceRollFields = (input: AttackEffectChoiceInput) => ({
  ...(input.naturalRolls === undefined ? {} : { naturalRolls: input.naturalRolls }),
  ...(input.blockedDice === undefined ? {} : { blockedDice: input.blockedDice }),
  ...(input.blockUsage === undefined
    ? {}
    : {
        block: {
          blockId: input.blockUsage.block.id,
          cost: input.blockUsage.cost,
          responseDecisionId: input.blockUsage.response.id,
        },
      }),
  ...(input.defenseItemUse === undefined
    ? {}
    : {
        defenseItem: {
          itemId: input.defenseItemUse.item.id,
          responseDecisionId: input.defenseItemUse.response.id,
          ...(input.defenseItemUse.preventedStatuses === undefined
            ? {}
            : { preventedStatuses: input.defenseItemUse.preventedStatuses }),
        },
      }),
  ...(input.defenseResultModifier === undefined
    ? {}
    : { defenseResultModifier: input.defenseResultModifier }),
  ...(input.preventCritical === undefined ? {} : { preventCritical: input.preventCritical }),
  ...(input.preventCounter === undefined ? {} : { preventCounter: input.preventCounter }),
  ...(input.resultOverrides === undefined ? {} : { resultOverrides: input.resultOverrides }),
  ...(input.numericResultOverrides === undefined
    ? {}
    : { numericResultOverrides: input.numericResultOverrides }),
});

const awaitingEffectChoiceContinuationFields = (input: AttackEffectChoiceInput) => ({
  ...(input.priorEnabledOptionalEffectIndices === undefined
    ? {}
    : { priorEnabledOptionalEffectIndices: input.priorEnabledOptionalEffectIndices }),
  ...(input.priorResolvedOptionalEffectIndices === undefined
    ? {}
    : { priorResolvedOptionalEffectIndices: input.priorResolvedOptionalEffectIndices }),
  ...(input.enabledAfterDefenseEffectIndices === undefined
    ? {}
    : { enabledAfterDefenseEffectIndices: input.enabledAfterDefenseEffectIndices }),
  ...(input.includeRollEvents === undefined ? {} : { includeRollEvents: input.includeRollEvents }),
  ...(input.numericSelection === undefined ? {} : { selectedNumericValues: {} }),
});

const awaitingEffectChoiceAttackFrame = (
  input: AttackEffectChoiceInput,
  pendingDecisionId: PendingDecisionId,
): AwaitingEffectChoiceAttackFrame => ({
  id: input.dependencies.ids.nextResolutionFrameId(),
  type: "attack",
  decisionId: input.decision.id,
  attackerId: input.decision.actorId,
  targetCombatantId: input.target.id,
  returnPhase: returnPhaseFor(input.state),
  stage: "awaiting-effect-choice",
  pendingDecisionId,
  attack: { type: "move", moveId: input.move.id },
  effectIndices: input.effectIndices,
  ...(input.effectAlternatives === undefined
    ? {}
    : {
        effectAlternatives: input.effectAlternatives.map(
          (alternative) => alternative.effectIndices,
        ),
      }),
  resolvedEffectIndices: [],
  enabledEffectIndices: [],
  ...(input.selectedSuppressionMoves === undefined
    ? {}
    : { selectedSuppressionMoves: input.selectedSuppressionMoves }),
  ...awaitingEffectChoiceSourceFields(input),
  ...awaitingEffectChoiceRollFields(input),
  ...awaitingEffectChoiceContinuationFields(input),
});

const requestAttackEffectChoice = (
  input: AttackEffectChoiceInput,
): CombatResult<CombatTransition> => {
  const {
    state,
    decision,
    effectIndices,
    effectAlternatives,
    numericSelection,
    rollEvents = [],
    dependencies,
  } = input;
  const pendingDecisionId = dependencies.ids.nextPendingDecisionId();
  const nextVersion = state.version + 1;
  const nextState: ActiveFightState = {
    ...state,
    version: nextVersion,
    pendingDecision: {
      id: pendingDecisionId,
      stateVersion: nextVersion,
      combatantId: input.choiceCombatantId ?? decision.actorId,
      type: "optional-effect",
      options:
        effectAlternatives === undefined
          ? pendingEffectChoiceOptions(effectIndices, numericSelection)
          : [
              ...effectAlternatives.flatMap((alternative) =>
                pendingEffectChoiceOptions(
                  alternative.effectIndices,
                  alternative.numericSelection,
                ).filter((option) => option.type !== "decline"),
              ),
              { id: "decline", type: "decline" },
            ],
    },
    resolutionFrames: [awaitingEffectChoiceAttackFrame(input, pendingDecisionId)],
    eventSequence: state.eventSequence + 1 + rollEvents.length,
  };
  return transitionFrom(nextState, rollEvents);
};

const pendingConvertedAttackRollEvents = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  target: ActiveFightState["combatants"][CombatantId],
  move: MoveDefinition,
  rolls: readonly AttackDieRoll[],
  dependencies: CombatDependencies,
): readonly CombatEvent[] =>
  rolls.flatMap((roll, index) => {
    const sequence = state.eventSequence + index * 2;
    return [
      {
        id: dependencies.ids.nextEventId(),
        sequence: sequence + 1,
        fightId: state.id,
        causedByDecisionId: decision.id,
        type: "attack-rolled" as const,
        combatantId: decision.actorId,
        targetCombatantId: target.id,
        moveId: move.id,
        naturalResult: roll.attackNaturalResult,
        result: roll.attackResult,
      },
      ...(roll.defenseNaturalResult === undefined || roll.defenseResult === undefined
        ? []
        : [
            {
              id: dependencies.ids.nextEventId(),
              sequence: sequence + 2,
              fightId: state.id,
              causedByDecisionId: decision.id,
              type: "defense-rolled" as const,
              combatantId: target.id,
              sourceCombatantId: decision.actorId,
              naturalResult: roll.defenseNaturalResult,
              result: roll.defenseResult,
            },
          ]),
    ];
  });

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
  readonly attackerDefeated?: boolean;
  readonly counterChainLimitReached: boolean;
  readonly counterContinues: boolean;
  readonly counterAction?: CounterActionReference;
  readonly resolution: AttackResolution;
  readonly resourceChanges?: readonly ResourceChange[];
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
  readonly counterAction?: CounterActionReference;
  readonly defeated: boolean;
  readonly attackerDefeated: boolean;
  readonly eventSequence: number;
  readonly resolution: AttackResolution;
  readonly resourceChanges: readonly ResourceChange[];
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
    attackerDefeated = false,
    counterChainLimitReached,
    counterContinues,
    defenseItemUse,
    includeRollEvents = true,
    resolution,
    resourceChanges,
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
    attackerDefeated,
    target,
    resolution,
    resourceChanges,
    counterContinues,
    counterChainLimitReached,
  });
  return events;
};

const appendBasicAttackResourceEvents = (
  state: ActiveFightState,
  decision: BasicAttackDecision,
  dependencies: CombatDependencies,
  events: CombatEvent[],
  attacker: BasicAttackEventContext["attacker"],
  resourceChanges: readonly ResourceChange[],
) => {
  const resourceAfterAttack = resourceAfterChanges(attacker, resourceChanges, "self");
  for (const resource of ["hp", "ki"] as const) {
    const changes = resourceChanges.filter(
      (change) => change.target === "self" && change.resource === resource,
    );
    if (changes.length === 0) continue;
    const before = resource === "hp" ? attacker.hitPoints.current : attacker.ki.current;
    const after =
      resource === "hp" ? resourceAfterAttack.hitPoints.current : resourceAfterAttack.ki.current;
    const amount = after - before;
    if (amount === 0) continue;
    const sourceCombatantId = changes[0]?.sourceCombatantId ?? attacker.id;
    if (resource === "hp") {
      events.push({
        id: dependencies.ids.nextEventId(),
        sequence: state.eventSequence + events.length + 1,
        fightId: state.id,
        causedByDecisionId: decision.id,
        type: "hp-changed",
        sourceCombatantId,
        targetCombatantId: attacker.id,
        amount,
        remainingHitPoints: after,
      });
    } else {
      events.push({
        id: dependencies.ids.nextEventId(),
        sequence: state.eventSequence + events.length + 1,
        fightId: state.id,
        causedByDecisionId: decision.id,
        type: "ki-changed",
        combatantId: attacker.id,
        amount,
        remainingKi: after,
      });
    }
  }
};

const appendBasicAttackOutcomeEvents = (
  state: ActiveFightState,
  decision: BasicAttackDecision,
  dependencies: CombatDependencies,
  events: CombatEvent[],
  {
    attacker,
    attackerDefeated = false,
    counterChainLimitReached,
    counterContinues,
    resolution,
    resourceChanges,
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
  appendBasicAttackResourceEvents(
    state,
    decision,
    dependencies,
    events,
    attacker,
    resourceChanges ?? [],
  );
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
  } else if (attackerDefeated) {
    events.push(
      {
        id: dependencies.ids.nextEventId(),
        sequence: state.eventSequence + events.length + 1,
        fightId: state.id,
        causedByDecisionId: decision.id,
        type: "combatant-defeated",
        combatantId: attacker.id,
      },
      {
        id: dependencies.ids.nextEventId(),
        sequence: state.eventSequence + events.length + 1,
        fightId: state.id,
        causedByDecisionId: decision.id,
        type: "fight-ended",
        completion: { type: "defeat", winnerCombatantId: target.id },
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
  readonly counterAction?: CounterActionReference;
  readonly defeated: boolean;
  readonly move: MoveDefinition;
  readonly includeRollEvents?: boolean;
  readonly remainingHitPoints: number;
  readonly resourceChanges: ReturnType<typeof successfulMoveEffects>["resources"];
  readonly damageModifications: readonly DamageModification[];
  readonly roll: ReturnType<typeof resolveMoveAttack> & {
    readonly resolutionSnapshot: AttackResolutionSnapshot;
  };
  readonly statusApplications: ReturnType<typeof successfulMoveEffects>["statuses"];
  readonly transformationReversions: readonly TransformationReversionApplication[];
  readonly transformationActions: readonly TransformationActionApplication[];
  readonly target: ActiveFightState["combatants"][CombatantId];
  readonly defenseItemUse?: DefenseItemUse;
  readonly deactivations: readonly DeactivationApplication[];
  readonly activations: readonly ActivationApplication[];
  readonly moveUsePreventions: readonly MoveUsePreventionApplication[];
  readonly remainingUseModifications: readonly RemainingUseModificationApplication[];
  readonly statusPreventions: readonly StatusPreventionApplication[];
  readonly triggeredSkillMoveIds: readonly MoveId[];
  readonly triggeredEffectUses: readonly {
    readonly combatantId: CombatantId;
    readonly key: string;
  }[];
  readonly deferredEffectId?: ActiveEffectId;
  readonly deferredDecisionId?: CombatDecisionId;
}

interface BlockUsage {
  readonly block: MoveDefinition;
  readonly cost: number;
  readonly defender: ActiveFightState["combatants"][CombatantId];
  readonly effects?: ReturnType<typeof resolvedBlockEffects>;
  readonly response: Pick<
    Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
    "id"
  >;
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
  appendConvertedHitPointEvents(state, decision, dependencies, context, events);
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

const appendConvertedHitPointEvents = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  dependencies: CombatDependencies,
  context: ConvertedAttackMoveContext,
  events: CombatEvent[],
) => {
  const { attacker, cost, target } = context;
  const action = actionRecordFor(state, decision);
  const attackerAfterResources = resourceAfterChanges(
    { ...attacker, ki: { ...attacker.ki, current: attacker.ki.current - cost } },
    context.resourceChanges,
    "self",
    state.activeEffects,
    action,
  );
  const targetAfterDamage = {
    ...target,
    hitPoints: { ...target.hitPoints, current: context.remainingHitPoints },
  };
  const targetAfterResources = resourceAfterChanges(
    targetAfterDamage,
    context.resourceChanges,
    "opponent",
    state.activeEffects,
    action,
  );
  const appendChange = (
    combatant: typeof attacker,
    after: typeof attacker,
    changes: readonly ResourceChange[],
  ) => {
    const hpChanges = changes.filter((change) => change.resource === "hp");
    if (hpChanges.length === 0) return;
    const amount = after.hitPoints.current - combatant.hitPoints.current;
    if (amount === 0) return;
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: nextEventSequence(state, events),
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "hp-changed",
      sourceCombatantId: hpChanges[0]?.sourceCombatantId ?? combatant.id,
      targetCombatantId: combatant.id,
      amount,
      remainingHitPoints: after.hitPoints.current,
    });
  };
  appendChange(
    attacker,
    attackerAfterResources,
    context.resourceChanges.filter((change) => change.target === "self"),
  );
  appendChange(
    targetAfterDamage,
    targetAfterResources,
    context.resourceChanges.filter((change) => change.target === "opponent"),
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

const prependDeferredMovePerformedEvent = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  dependencies: CombatDependencies,
  context: ConvertedAttackMoveContext,
  events: CombatEvent[],
) => {
  if (context.deferredEffectId === undefined) return;
  events.unshift({
    id: dependencies.ids.nextEventId(),
    sequence: state.eventSequence + 1,
    fightId: state.id,
    causedByDecisionId: decision.id,
    type: "deferred-move-performed",
    activeEffectId: context.deferredEffectId,
    combatantId: context.attacker.id,
    moveId: context.move.id,
    targetCombatantId: context.target.id,
  });
  events.splice(
    0,
    events.length,
    ...events.map((event, index) => ({
      ...event,
      sequence: state.eventSequence + index + 1,
    })),
  );
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
  prependDeferredMovePerformedEvent(state, decision, dependencies, context, events);
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
    for (const effect of context.activatedEffects) {
      if (effect.type !== "remove-move-from-combat") continue;
      events.push({
        id: dependencies.ids.nextEventId(),
        sequence: nextEventSequence(state, events),
        fightId: state.id,
        causedByDecisionId: decision.id,
        type: "move-removed-from-combat",
        combatantId: effect.targetCombatantId,
        moveId: effect.moveId,
        activeEffectId: effect.id,
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
  for (const application of context.transformationReversions) {
    const combatant = application.target === "self" ? attacker : target;
    if (combatant.transformation?.baseline === undefined) continue;
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: nextEventSequence(state, events),
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "transformation-deactivated",
      combatantId: combatant.id,
      transformationId: combatant.transformation.transformationId,
    });
  }
};

const resourceChangeIsPrevented = (
  combatant: ActiveFightState["combatants"][CombatantId],
  change: ResourceChange,
  resourcePreventions: readonly ActiveCombatEffect[],
  action: CombatActionRecord | undefined,
) =>
  change.preventable !== false &&
  resourcePreventions.some(
    (
      effect,
    ): effect is Extract<ActiveCombatEffect, { readonly type: "prevent-resource-modification" }> =>
      effect.type === "prevent-resource-modification" &&
      effect.targetCombatantId === combatant.id &&
      (effect.availableFromTurn === undefined ||
        effect.availableFromTurn <= (action?.turnNumber ?? Number.POSITIVE_INFINITY)) &&
      effect.resource === change.resource &&
      (effect.operation === "lose"
        ? change.operation === "lose" || change.operation === "drain"
        : effect.operation === change.operation) &&
      (effect.sourceActor !== "opponent" ||
        (change.sourceCombatantId !== undefined && change.sourceCombatantId !== combatant.id)) &&
      (effect.exceptAction !== "power-up" || action?.type !== "power-up"),
  );

const resourceChangeSource = (
  actor: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  sourceCombatantId: CombatantId | undefined,
) => {
  if (sourceCombatantId === actor.id) return actor;
  if (sourceCombatantId === target.id) return target;
  return undefined;
};

const resourceChangesAfterPreventions = (
  actor: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  changes: readonly ResourceChange[],
  resourcePreventions: readonly ActiveCombatEffect[],
  action: CombatActionRecord | undefined,
) =>
  changes.filter((change) => {
    const subject = change.target === "self" ? actor : target;
    const source = resourceChangeSource(actor, target, change.sourceCombatantId);
    const useKey =
      change.sourceEffectIndex === undefined ||
      (change.sourceDefinitionId === undefined && change.sourceCombatantId === undefined)
        ? undefined
        : `${change.sourceDefinitionId ?? change.sourceCombatantId}:${change.sourceEffectIndex}`;
    const useLimitReached =
      source !== undefined &&
      useKey !== undefined &&
      change.useLimit !== undefined &&
      (source.effectUseCounts?.[useKey] ?? 0) >= change.useLimit.count;
    return (
      !useLimitReached && !resourceChangeIsPrevented(subject, change, resourcePreventions, action)
    );
  });

const combatantsAfterResourceEffectUseLimits = (
  combatants: ActiveFightState["combatants"],
  changes: readonly ResourceChange[],
) => {
  const countsByCombatant = changes.reduce<Record<CombatantId, Record<string, number>>>(
    (counts, change) => {
      if (
        change.useLimit?.scope !== "combat" ||
        change.sourceCombatantId === undefined ||
        change.sourceDefinitionId === undefined ||
        change.sourceEffectIndex === undefined
      )
        return counts;
      const key = `${change.sourceDefinitionId}:${change.sourceEffectIndex}`;
      return {
        ...counts,
        [change.sourceCombatantId]: {
          ...(counts[change.sourceCombatantId] ?? {}),
          [key]: (counts[change.sourceCombatantId]?.[key] ?? 0) + 1,
        },
      };
    },
    {},
  );
  return (Object.entries(countsByCombatant) as [CombatantId, Record<string, number>][]).reduce(
    (nextCombatants, [combatantId, counts]) => ({
      ...nextCombatants,
      [combatantId]: {
        ...nextCombatants[combatantId],
        effectUseCounts: Object.entries(counts).reduce(
          (effectUseCounts, [key, count]) => ({
            ...effectUseCounts,
            [key]: (effectUseCounts?.[key] ?? 0) + count,
          }),
          nextCombatants[combatantId]?.effectUseCounts,
        ),
      },
    }),
    combatants,
  );
};

const resourceCostActivationChanges = (
  applications: readonly ResourceCostModifierApplication[],
  selfCombatantId: CombatantId,
  opponentCombatantId: CombatantId,
): readonly ResourceChange[] => {
  const targetForSource = (sourceCombatantId: CombatantId) => {
    if (sourceCombatantId === selfCombatantId) return "self" as const;
    if (sourceCombatantId === opponentCombatantId) return "opponent" as const;
    return "self" as const;
  };
  return applications.flatMap((application) => {
    if (application.activationCost === undefined) return [];
    return [
      {
        resource: application.activationCost.resource,
        target: targetForSource(application.sourceCombatantId),
        operation: "lose" as const,
        amount: application.activationCost.amount,
        sourceCombatantId: application.sourceCombatantId,
        cause: "non-damage-effect" as const,
      },
    ];
  });
};

const extraActionActivationChanges = (
  applications: readonly ExtraActionApplication[],
  sourceCombatantId: CombatantId,
): readonly ResourceChange[] =>
  applications.flatMap((application) => {
    if (application.activationCost === undefined || application.phase !== "action") return [];
    return [
      {
        resource: application.activationCost.resource,
        target: "self" as const,
        operation: "lose" as const,
        amount: application.activationCost.amount,
        sourceCombatantId,
        cause: "non-damage-effect" as const,
      },
    ];
  });

const resourceChangesWithActivationCosts = (
  state: ActiveFightState,
  changes: readonly ResourceChange[],
): readonly ResourceChange[] => {
  const activationKeys = new Set<string>();
  const blockedKeys = new Set<string>();
  const available = new Map<string, number>();
  const costs: ResourceChange[] = [];

  for (const change of changes) {
    if (
      change.activationCost === undefined ||
      change.sourceCombatantId === undefined ||
      change.sourceEffectIndex === undefined
    )
      continue;
    const key = `${change.sourceDefinitionId ?? change.sourceCombatantId}:${change.sourceEffectIndex}`;
    if (activationKeys.has(key)) continue;
    activationKeys.add(key);
    const source = state.combatants[change.sourceCombatantId];
    const resource = change.activationCost.resource;
    const availableKey = `${source.id}:${resource}`;
    const current =
      available.get(availableKey) ??
      (resource === "hp" ? source.hitPoints.current : source.ki.current);
    const remaining = current - change.activationCost.amount;
    if (
      remaining < 0 ||
      (change.activationCost.minimum !== undefined && remaining < change.activationCost.minimum)
    ) {
      blockedKeys.add(key);
      continue;
    }
    available.set(availableKey, remaining);
    costs.push({
      resource,
      target: "self",
      operation: "lose",
      amount: change.activationCost.amount,
      sourceCombatantId: source.id,
      cause: "non-damage-effect",
    });
  }

  return [
    ...changes.filter(
      (change) =>
        change.sourceCombatantId === undefined ||
        change.sourceEffectIndex === undefined ||
        !blockedKeys.has(`${change.sourceCombatantId}:${change.sourceEffectIndex}`),
    ),
    ...costs,
  ];
};

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
    } else if (existing.duration.type !== status.duration.type) duration = status.duration;
    activeStatuses[existingIndex] = {
      ...existing,
      ...(status.selector === undefined ? {} : { selector: status.selector }),
      stacks: existing.stacks + status.stacks,
      duration,
    };
  }
  return { ...combatant, activeStatuses };
};

const defenseItemPreventsStatus = (
  defenseItemUse: DefenseItemUse | undefined,
  target: "self" | "opponent",
  statusId: ActiveStatus["statusId"],
) => {
  const preventedStatuses = defenseItemUse?.preventedStatuses;
  return (
    target === "opponent" &&
    preventedStatuses !== undefined &&
    (statusId === "break" || statusId === "sever") &&
    preventedStatuses.includes(statusId)
  );
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

const combatantAfterTransformationReversions = (
  combatant: ActiveFightState["combatants"][CombatantId],
  applications: readonly TransformationReversionApplication[],
  target: "self" | "opponent",
) =>
  applications.reduce((current, application) => {
    if (application.target !== target || current.transformation?.baseline === undefined)
      return current;
    return {
      ...revertTransformation(current, current.transformation.baseline),
      transformation: undefined,
    };
  }, combatant);

const combatantAfterTransformationActions = (
  combatant: ActiveFightState["combatants"][CombatantId],
  applications: readonly TransformationActionApplication[],
  target: "self" | "opponent",
) => {
  const count = applications.filter((application) => application.target === target).length;
  return count === 0
    ? combatant
    : {
        ...combatant,
        freeTransformationActions: (combatant.freeTransformationActions ?? 0) + count,
      };
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
    resolutionSnapshot: {
      ...context.roll.resolutionSnapshot,
      paidKiCost: context.cost,
    },
    ...optionalResourceChangeHistoryFor(
      context.resourceChanges,
      context.attacker.id,
      context.target.id,
      state.turnNumber,
    ),
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

const convertedAttackActionHistoryForState = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  context: ConvertedAttackMoveContext,
) => {
  const resolvedAction = actionRecordWithAttackResult(state, decision, {
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
    resolutionSnapshot: {
      ...context.roll.resolutionSnapshot,
      paidKiCost: context.cost,
    },
    ...optionalResourceChangeHistoryFor(
      context.resourceChanges,
      context.attacker.id,
      context.target.id,
      state.turnNumber,
    ),
  });
  if (context.deferredEffectId === undefined)
    return convertedAttackActionHistory(state, decision, context);
  const resolvedMoveAction = resolvedAction as Extract<
    CombatActionRecord,
    { readonly type: "use-move" }
  >;
  return state.actionHistory.map((action) =>
    action.type === "use-move" && action.decisionId === decision.id
      ? { ...resolvedMoveAction, turnNumber: action.turnNumber, phase: action.phase }
      : action,
  );
};

const convertedAttackResourceAccounting = (context: ConvertedAttackMoveContext) =>
  context.deferredEffectId === undefined
    ? { paidCost: context.cost, moveUseIncrement: 1 }
    : { paidCost: 0, moveUseIncrement: 0 };

const convertedAttackStateParts = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  context: ConvertedAttackMoveContext,
) => {
  const { attacker, blockUsage, defeated, defenseItemUse, move, remainingHitPoints, roll, target } =
    context;
  const targetAfterDamage =
    roll.damage > 0
      ? {
          ...target,
          hitPoints: { ...target.hitPoints, current: remainingHitPoints },
          status: defeated ? ("defeated" as const) : target.status,
        }
      : target;
  const { paidCost, moveUseIncrement } = convertedAttackResourceAccounting(context);
  const attackerAfterEffects = statusesAfterApplications(
    resourceAfterChanges(
      {
        ...attacker,
        ki: { ...attacker.ki, current: attacker.ki.current - paidCost },
        moveUses: {
          ...attacker.moveUses,
          [move.id]: (attacker.moveUses[move.id] ?? 0) + moveUseIncrement,
          ...Object.fromEntries(
            context.triggeredSkillMoveIds.map((moveId) => [
              moveId,
              (attacker.moveUses[moveId] ?? 0) + 1,
            ]),
          ),
        },
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
  const attackerAfterTransformationReversions = combatantAfterTransformationReversions(
    attackerAfterEffects,
    context.transformationReversions,
    "self",
  );
  const targetAfterTransformationReversions = combatantAfterTransformationReversions(
    targetAfterEffects,
    context.transformationReversions,
    "opponent",
  );
  const attackerAfterTransformationActions = combatantAfterTransformationActions(
    attackerAfterTransformationReversions,
    context.transformationActions,
    "self",
  );
  const targetAfterTransformationActions = combatantAfterTransformationActions(
    targetAfterTransformationReversions,
    context.transformationActions,
    "opponent",
  );
  const attackerAfterBlockEffects =
    blockUsage?.effects === undefined
      ? attackerAfterTransformationActions
      : statusesAfterApplications(
          resourceAfterChanges(
            attackerAfterTransformationActions,
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
      ? targetAfterTransformationActions
      : statusesAfterApplications(
          resourceAfterChanges(
            targetAfterTransformationActions,
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
  const targetAfterBlockUseLimits =
    blockUsage?.effects === undefined
      ? targetAfterDefenseItem
      : combatantAfterRemainingUseModifications(
          targetAfterDefenseItem,
          blockUsage.effects.remainingUseModifications,
          "self",
        );
  const targetAfterUseLimits = combatantAfterRemainingUseModifications(
    targetAfterBlockUseLimits,
    context.remainingUseModifications,
    "opponent",
  );
  const attackerAfterUseLimits = combatantAfterRemainingUseModifications(
    blockUsage?.effects === undefined
      ? attackerAfterBlockEffects
      : combatantAfterRemainingUseModifications(
          attackerAfterBlockEffects,
          blockUsage.effects.remainingUseModifications,
          "opponent",
        ),
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
  const targetEffectUseCounts = context.damageModifications.reduce((counts, modification) => {
    if (modification.useLimit === undefined || modification.sourceDefinitionId === undefined)
      return counts;
    const key = `${modification.sourceDefinitionId}:${modification.effectIndex}`;
    return { ...counts, [key]: (counts[key] ?? 0) + 1 };
  }, target.effectUseCounts ?? {});
  const effectUseCountsAfterTriggeredEffects = (
    combatant: typeof normalizedAttacker,
    additionalCounts: Readonly<Record<string, number>>,
  ) => {
    const effectUseCounts = Object.entries(additionalCounts).reduce(
      (counts, [key, count]) => ({ ...counts, [key]: (counts[key] ?? 0) + count }),
      combatant.effectUseCounts ?? {},
    );
    return Object.keys(additionalCounts).length === 0
      ? combatant
      : { ...combatant, effectUseCounts };
  };
  const triggeredEffectUsesByCombatant = context.triggeredEffectUses.reduce<
    Record<CombatantId, Record<string, number>>
  >(
    (uses, { combatantId, key }) => ({
      ...uses,
      [combatantId]: {
        ...(uses[combatantId] ?? {}),
        [key]: (uses[combatantId]?.[key] ?? 0) + 1,
      },
    }),
    {},
  );
  for (const change of context.resourceChanges) {
    if (
      change.useLimit === undefined ||
      change.sourceCombatantId === undefined ||
      change.sourceEffectIndex === undefined
    )
      continue;
    const key = `${change.sourceDefinitionId ?? change.sourceCombatantId}:${change.sourceEffectIndex}`;
    const uses = triggeredEffectUsesByCombatant[change.sourceCombatantId] ?? {};
    if (uses[key] !== undefined) continue;
    triggeredEffectUsesByCombatant[change.sourceCombatantId] = { ...uses, [key]: 1 };
  }
  const normalizedAttackerWithEffectUses = effectUseCountsAfterTriggeredEffects(
    normalizedAttacker,
    triggeredEffectUsesByCombatant[attacker.id] ?? {},
  );
  const normalizedTargetWithEffectUses = effectUseCountsAfterTriggeredEffects(normalizedTarget, {
    ...Object.fromEntries(
      Object.entries(targetEffectUseCounts).map(([key, count]) => [
        key,
        count - (target.effectUseCounts?.[key] ?? 0),
      ]),
    ),
    ...(triggeredEffectUsesByCombatant[target.id] ?? {}),
  });
  const combatants: ActiveFightState["combatants"] = {
    ...state.combatants,
    [attacker.id]: normalizedAttackerWithEffectUses,
    [target.id]: normalizedTargetWithEffectUses,
  };
  const actionHistory = convertedAttackActionHistoryForState(state, decision, context);
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
  const { actionHistory, combatants: combatantsBeforeMoveRemovals } = convertedAttackStateParts(
    state,
    decision,
    context,
  );
  const combatantsWithMoveRemovals = combatantsAfterMoveRemovals(
    combatantsBeforeMoveRemovals,
    context.activatedEffects,
  );
  const combatants = combatantsAfterTemporaryMoveRestoration(
    combatantsWithMoveRemovals,
    expiredTemporaryMoveRemovals(state, attacker.id, context.roll.rolls),
  );
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
    }).filter((effect) => effect.id !== context.deferredEffectId),
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
            ...(context.counterAction === undefined
              ? {}
              : { counterAction: context.counterAction }),
          },
        ]
      : [],
    eventSequence: state.eventSequence + eventCount,
  };
};

const selectedDamageTargetFor = (move: MoveDefinition, target: CombatantState) => {
  const effectIndex = (move.effects ?? []).findIndex(
    (effect) =>
      effect.type === "modify-damage" && isSelectedMoveUntilAttackThresholdDamageModifier(effect),
  );
  if (effectIndex < 0) return undefined;
  const effect = move.effects?.[effectIndex];
  if (effect === undefined || effect.type !== "modify-damage" || effect.selector === undefined)
    return undefined;
  const eligibleMoveIds = target.moveIds.filter((moveId) => {
    const candidate = MOVE_DEFINITIONS.find((definition) => definition.id === moveId);
    return candidate !== undefined && matchesMoveSelector(candidate, effect.selector!);
  });
  return eligibleMoveIds.length === 0 ? undefined : { effectIndex, eligibleMoveIds };
};

const requestSelectedDamageTarget = (
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  move: MoveDefinition,
  attacker: CombatantState,
  target: CombatantState,
  dependencies: CombatDependencies,
  nextState: ActiveFightState,
  events: readonly CombatEvent[],
): CombatResult<CombatTransition> | undefined => {
  if (nextState.status !== "active" || target.status !== "active") return undefined;
  const selection = selectedDamageTargetFor(move, target);
  if (selection === undefined) return undefined;
  const pendingDecisionId = dependencies.ids.nextPendingDecisionId();
  const frame = {
    id: dependencies.ids.nextResolutionFrameId(),
    type: "effect" as const,
    decisionId: decision.id,
    sourceCombatantId: attacker.id,
    targetCombatantId: target.id,
    sourceDefinitionId: move.id,
    effectIndex: selection.effectIndex,
    operation: "select-damage-target" as const,
    returnPhase: nextState.phase,
    trigger: "on-success" as const,
    pendingDecisionId,
    eligibleMoveIds: selection.eligibleMoveIds,
    remainingSelections: 1,
  };
  const pendingDecision = {
    id: pendingDecisionId,
    stateVersion: nextState.version + 1,
    combatantId: attacker.id,
    type: "select-move" as const,
    options: selection.eligibleMoveIds.map((moveId) => ({
      id: `select-damage-target:${moveId}`,
      type: "select-move" as const,
      moveId,
    })),
  };
  return transitionFrom(
    {
      ...nextState,
      version: nextState.version + 1,
      pendingDecision,
      resolutionFrames: [...nextState.resolutionFrames, frame],
    },
    events,
  );
};

const selectedTemporaryMoveRemovalFor = (move: MoveDefinition, target: CombatantState) => {
  const candidate = [...(move.effects ?? []).entries()].find(
    ([, effect]) =>
      effect.type === "remove-move-from-combat" &&
      effect.trigger === "on-success" &&
      effect.target === "opponent" &&
      effect.move === "target" &&
      effect.selector !== undefined &&
      effect.duration?.type === "until-perfect-roll" &&
      effect.conditions === undefined &&
      effect.scope === undefined &&
      effect.activationCost === undefined &&
      effect.useLimit === undefined &&
      effect.cooldown === undefined &&
      effect.selectionLimit === undefined,
  );
  if (candidate === undefined) return undefined;
  const [effectIndex, effect] = candidate;
  if (effect.type !== "remove-move-from-combat" || effect.selector === undefined) return undefined;
  const selector = effect.selector;
  const eligibleMoveIds = target.moveIds.filter((moveId) => {
    const selectedMove = MOVE_DEFINITIONS.find((definition) => definition.id === moveId);
    return selectedMove !== undefined && matchesMoveSelector(selectedMove, selector);
  });
  return eligibleMoveIds.length === 0 ? undefined : { effectIndex, eligibleMoveIds };
};

const requestSelectedTemporaryMoveRemoval = (
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  move: MoveDefinition,
  attacker: CombatantState,
  target: CombatantState,
  dependencies: CombatDependencies,
  nextState: ActiveFightState,
  events: readonly CombatEvent[],
): CombatResult<CombatTransition> | undefined => {
  const selection = selectedTemporaryMoveRemovalFor(move, target);
  if (nextState.status !== "active" || selection === undefined) return undefined;
  const pendingDecisionId = dependencies.ids.nextPendingDecisionId();
  const frame = {
    id: dependencies.ids.nextResolutionFrameId(),
    type: "effect" as const,
    decisionId: decision.id,
    sourceCombatantId: attacker.id,
    targetCombatantId: target.id,
    sourceDefinitionId: move.id,
    effectIndex: selection.effectIndex,
    operation: "select-move-removal" as const,
    returnPhase: nextState.phase,
    trigger: "on-success" as const,
    pendingDecisionId,
    eligibleMoveIds: selection.eligibleMoveIds,
    remainingSelections: 1,
  };
  const pendingDecision = {
    id: pendingDecisionId,
    stateVersion: nextState.version + 1,
    combatantId: attacker.id,
    type: "select-move" as const,
    options: selection.eligibleMoveIds.map((moveId) => ({
      id: `select-move-removal:${moveId}`,
      type: "select-move" as const,
      moveId,
    })),
  };
  return transitionFrom(
    {
      ...nextState,
      version: nextState.version + 1,
      pendingDecision,
      resolutionFrames: [...nextState.resolutionFrames, frame],
    },
    events,
  );
};

const finishConvertedAttackMove = ({
  decision,
  move,
  dependencies,
  attacker,
  target,
  context,
  initialRoll,
  nextState,
  events,
}: {
  readonly decision: CompleteConvertedAttackInput["decision"];
  readonly move: CompleteConvertedAttackInput["move"];
  readonly dependencies: CompleteConvertedAttackInput["dependencies"];
  readonly attacker: CompleteConvertedAttackInput["attacker"];
  readonly target: CompleteConvertedAttackInput["target"];
  readonly context: ConvertedAttackMoveContext;
  readonly initialRoll: ReturnType<typeof convertedAttackRoll>;
  readonly nextState: FightState;
  readonly events: readonly CombatEvent[];
}): CombatResult<CombatTransition> => {
  if (nextState.status !== "active") return transitionFrom(nextState, events);
  if (initialRoll.successfulHitCount > 0) {
    const selectedMoveRemovalTransition = requestSelectedTemporaryMoveRemoval(
      decision,
      move,
      attacker,
      target,
      dependencies,
      nextState,
      events,
    );
    if (selectedMoveRemovalTransition !== undefined) return selectedMoveRemovalTransition;
    const selectedTargetTransition = requestSelectedDamageTarget(
      decision,
      move,
      attacker,
      target,
      dependencies,
      nextState,
      events,
    );
    if (selectedTargetTransition !== undefined) return selectedTargetTransition;
  }
  return resolveDeactivations({
    state: nextState,
    activations: context.activations,
    applications: context.deactivations,
    sourceCombatantId: attacker.id,
    causedByDecisionId: decision.id,
    dependencies,
    priorEvents: events,
  });
};

const convertedAttackMoveFailure = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  move: MoveDefinition,
  attacker: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId] | undefined,
  additionalCurrentActionCostModifications: readonly CurrentActionCostModification[] = [],
  costOverride: number | undefined = undefined,
  ignoreRestrictedUse = false,
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
  if (
    !ignoreRestrictedUse &&
    !isRestrictedUseAvailable(attacker.moveUses[move.id] ?? 0, restrictedLimit)
  )
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
  if (!costActivationCostsAvailable(attacker, additionalCurrentActionCostModifications))
    return { type: "unsupported-mechanic", mechanic: `cost activation resource: ${move.id}` };
  const effectiveCost =
    costOverride ??
    convertedAttackCost(state, attacker, move, baseCost, additionalCurrentActionCostModifications);
  return attacker.ki.current < effectiveCost
    ? { type: "insufficient-ki", required: effectiveCost, available: attacker.ki.current }
    : undefined;
};

const deferredMoveDefinitionFor = (move: MoveDefinition) => {
  const entry = (move.effects ?? []).entries();
  for (const [effectIndex, effect] of entry) {
    if (effect.type === "defer-move" && effect.trigger === "action-phase")
      return { effectIndex, effect };
  }
  return undefined;
};

const requestDeferredMoveChoice = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  move: MoveDefinition,
  effectIndex: number,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> => {
  const pendingDecisionId = dependencies.ids.nextPendingDecisionId();
  const nextVersion = state.version + 1;
  return transitionFrom(
    {
      ...state,
      version: nextVersion,
      pendingDecision: {
        id: pendingDecisionId,
        stateVersion: nextVersion,
        combatantId: decision.actorId,
        type: "optional-effect",
        options: [
          {
            id: `activate-effect:${effectIndex}`,
            type: "activate-effect",
            moveId: move.id,
            effectIndices: [effectIndex],
          },
          { id: "decline", type: "decline" },
        ],
      },
      resolutionFrames: [
        {
          id: dependencies.ids.nextResolutionFrameId(),
          type: "effect",
          decisionId: decision.id,
          sourceCombatantId: decision.actorId,
          targetCombatantId: decision.targetCombatantId,
          sourceDefinitionId: move.id,
          effectIndex,
          operation: "defer-move",
          returnPhase: state.phase,
          trigger: "action",
          pendingDecisionId,
          optional: true,
        },
      ],
    },
    [],
  );
};

const resolveDeferredMoveDeclaration = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  move: MoveDefinition,
  effectIndex: number,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> => {
  const actor = state.combatants[decision.actorId];
  const target = activeOpponent(state, actor.id, decision.targetCombatantId);
  if (target === undefined)
    return {
      ok: false,
      error: { type: "invalid-target", targetCombatantId: decision.targetCombatantId },
    };
  const beforeAttackEffects = moveEffectsForTrigger(move, "before-attack-roll", {
    ...convertedAttackEffectContext(state, actor, target, move),
  });
  const baseCost = move.mechanics.kiCost;
  if (baseCost?.type !== "literal")
    return {
      ok: false,
      error: { type: "unsupported-mechanic", mechanic: `move resolution: ${move.id}` },
    };
  const cost = convertedAttackCost(
    state,
    actor,
    move,
    baseCost.value,
    beforeAttackEffects.currentActionCostModifications,
  );
  const failure = convertedAttackMoveFailure(
    state,
    decision,
    move,
    actor,
    target,
    beforeAttackEffects.currentActionCostModifications,
    cost,
  );
  if (failure !== undefined) return { ok: false, error: failure };
  const actionPhaseEffects = moveEffectsForTrigger(move, "action-phase", {
    ...convertedAttackEffectContext(state, actor, target, move),
    enabledOptionalEffectIndices: [effectIndex],
    resolvedOptionalEffectIndices: [effectIndex],
  });
  const deferredApplication = actionPhaseEffects.deferredMoves.find(
    (application) => application.effectIndex === effectIndex,
  );
  if (deferredApplication === undefined) return { ok: false, error: invalidFightState(state) };
  const deferredEffect = activeDeferredMovesFromApplications(
    [deferredApplication],
    actor.id,
    target.id,
    move.id,
    decision.id,
    state.turnNumber,
    dependencies,
  ).at(0);
  if (deferredEffect === undefined) return { ok: false, error: invalidFightState(state) };
  const activatedEffects = [
    ...simpleActionActivatedEffects(
      state,
      actionPhaseEffects,
      actor,
      target,
      move,
      state.turnNumber,
      dependencies,
    ),
    deferredEffect,
  ];
  const consumedExtraActionEffects = consumeExtraActionForDecision(state, decision);
  const activeEffects = [...state.activeEffects, ...activatedEffects].flatMap((effect) => {
    if (effect.type !== "extra-action") return [effect];
    if (!state.activeEffects.some((candidate) => candidate.id === effect.id)) return [effect];
    const consumed = consumedExtraActionEffects.find((candidate) => candidate.id === effect.id);
    return consumed === undefined ? [] : [consumed];
  });
  const nextState: ActiveFightState = {
    ...state,
    version: state.version + 1,
    phase: "end",
    activeCombatantId: actor.id,
    combatants: {
      ...state.combatants,
      [actor.id]: {
        ...actor,
        ki: { ...actor.ki, current: actor.ki.current - cost },
        moveUses: { ...actor.moveUses, [move.id]: (actor.moveUses[move.id] ?? 0) + 1 },
      },
    },
    activeEffects,
    actionHistory: [...state.actionHistory, actionRecordFor(state, decision)],
    eventSequence: state.eventSequence + activatedEffects.length + 3,
  };
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
      amount: -cost,
      remainingKi: actor.ki.current - cost,
    },
    {
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + 3,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "deferred-move-scheduled",
      activeEffectId: deferredEffect.id,
      combatantId: actor.id,
      moveId: move.id,
      targetCombatantId: target.id,
      performOnTurn: deferredEffect.performOnTurn,
    },
  ];
  for (const effect of activatedEffects) {
    if (effect.id === deferredEffect.id) continue;
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
  events.push(
    createPhaseChangedEvent(state, dependencies, "end", nextState.eventSequence, decision.id),
  );
  return transitionFrom(nextState, events);
};

const deferredMoveDeclarationTransition = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  move: MoveDefinition,
  deferredDefinition: ReturnType<typeof deferredMoveDefinitionFor>,
  deferMoveChoice: AttackResolutionOptions["deferMoveChoice"],
  deferredExecution: AttackResolutionOptions["deferredExecution"],
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> | undefined => {
  if (deferredExecution !== undefined || deferredDefinition === undefined) return undefined;
  if (deferredDefinition.effect.optional === true && deferMoveChoice === undefined)
    return requestDeferredMoveChoice(
      state,
      decision,
      move,
      deferredDefinition.effectIndex,
      dependencies,
    );
  if (deferMoveChoice !== "decline")
    return resolveDeferredMoveDeclaration(
      state,
      decision,
      move,
      deferredDefinition.effectIndex,
      dependencies,
    );
  return undefined;
};

const deferredExecutionOptionFor = (
  deferredExecution: AttackResolutionOptions["deferredExecution"],
) => (deferredExecution === undefined ? {} : { deferredExecution });

const deferredMoveCostOverrideFor = (
  deferredExecution: AttackResolutionOptions["deferredExecution"],
  copiedSourceResolution: AttackResolutionOptions["copiedSourceResolution"],
) => (deferredExecution === undefined ? copiedSourceResolution?.paidKiCost : 0);

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
    successfulHitCount: 1,
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

const deferredCostAmount = (
  state: ActiveFightState,
  effect: Extract<ActiveCombatEffect, { readonly type: "modify-next-action" }>,
) => {
  if (effect.modifier.type !== "cost") return undefined;
  if (effect.modifier.amountExpression === undefined) return effect.modifier.amount;
  const expression = effect.modifier.amountExpression;
  const opponent = Object.values(state.combatants).find(
    (candidate) => candidate.id !== effect.sourceCombatantId && candidate.status === "active",
  );
  const actorId = expression.actor === "self" ? effect.sourceCombatantId : opponent?.id;
  if (actorId === undefined) return effect.modifier.amount;
  const moves = new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate]));
  const action = state.actionHistory.slice(effect.createdAfterActionCount ?? 0).find(
    (
      candidate,
    ): candidate is Extract<
      CombatActionRecord,
      {
        readonly type: "basic-attack" | "use-move";
      }
    > => {
      if (
        (candidate.type !== "basic-attack" && candidate.type !== "use-move") ||
        candidate.actorId !== actorId
      )
        return false;
      const move = candidate.type === "use-move" ? moves.get(candidate.moveId) : undefined;
      return candidate.type === "basic-attack" || move?.mechanics.attack !== undefined;
    },
  );
  if (action === undefined) return effect.modifier.amount;
  if (action.type === "basic-attack") return 0;
  const move = moves.get(action.moveId);
  return (
    action.resolutionSnapshot?.paidKiCost ??
    (move?.mechanics.kiCost?.type === "literal" ? move.mechanics.kiCost.value : undefined)
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
  const immediate = [...sources.values()].flatMap(({ source, move: sourceMove }) => {
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
  const durable = state.activeEffects.flatMap((effect) => {
    if (
      effect.type !== "modify-next-action" ||
      effect.modifier.type !== "cost" ||
      effect.targetCombatantId !== combatantId ||
      (effect.scope !== undefined &&
        effect.scope !== "next-action" &&
        effect.scope !== "next-actions" &&
        effect.scope !== "next-turn") ||
      (effect.availableFromTurn !== undefined && effect.availableFromTurn > state.turnNumber) ||
      !effectMatchesMoveSelector(effect.selector, move)
    )
      return [];
    const amount = deferredCostAmount(state, effect);
    if (amount === undefined) return [];
    return [
      {
        target: "self" as const,
        operation: effect.modifier.operation,
        amount,
        ...(effect.modifier.minimum === undefined ? {} : { minimum: effect.modifier.minimum }),
        ...(effect.modifier.maximum === undefined ? {} : { maximum: effect.modifier.maximum }),
      },
    ];
  });
  return [...immediate, ...durable];
};

const activeCostModifierTransformersFor = (state: ActiveFightState, combatantId: CombatantId) =>
  state.activeEffects.filter(
    (effect): effect is Extract<ActiveCombatEffect, { readonly type: "modify-next-action" }> =>
      effect.type === "modify-next-action" &&
      effect.modifier.type === "cost-modifier" &&
      effect.targetCombatantId === combatantId &&
      !activeEffectSuppressed(state, effect) &&
      oneShotRollModifierIsEligible(state.turnNumber, effect),
  );

const costModifierMultiplierFor = (state: ActiveFightState, combatantId: CombatantId) =>
  activeCostModifierTransformersFor(state, combatantId).reduce(
    (multiplier, effect) =>
      effect.modifier.type === "cost-modifier"
        ? multiplier * effect.modifier.multiplier
        : multiplier,
    1,
  );

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
  const costModifierMultiplier = costModifierMultiplierFor(state, combatantId);
  const currentCost = currentActionCostModifiersFor(state, combatantId, move)
    .map((modification) => ({
      ...modification,
      amount: Math.round(modification.amount * costModifierMultiplier),
    }))
    .reduce(applyCurrentActionCostModification, baseCost);
  const activeCostAmounts = activeCostModifiersFor(state, combatantId, move, baseCost).map(
    (effect) => Math.round(effect.amount * costModifierMultiplier),
  );
  return calculateKiCost(currentCost, activeCostAmounts);
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
    [state.activeCombatantId, target.id].some(
      (ownerId) =>
        combatResultSources(state, ownerId).some(
          (source) => source.effect.activationCost?.resource === "ki",
        ) ||
        combatResultNegationSources(state, ownerId).some(
          (source) => source.effect.activationCost?.resource === "ki",
        ),
    ) ||
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
        transformationReversions: [
          ...changes.transformationReversions,
          ...resolved.transformationReversions,
        ],
      };
    },
    {
      resources: [] as ResourceChange[],
      statuses: [] as StatusApplication[],
      locks: [] as LockApplication[],
      transformationReversions: [] as TransformationReversionApplication[],
    },
  );

interface StoppedSkillTriggeredEffects {
  readonly sourceMove: MoveDefinition;
  readonly owner: ActiveFightState["combatants"][CombatantId];
  readonly target: ActiveFightState["combatants"][CombatantId];
  readonly effects: ReturnType<typeof moveEffectsForTrigger>;
}

const stoppedSkillTriggeredEffects = (
  state: ActiveFightState,
  attacker: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  triggeringMove: MoveDefinition,
  context: Parameters<typeof moveEffectsForTrigger>[2],
): readonly StoppedSkillTriggeredEffects[] => {
  const moves = new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate]));
  return attacker.moveIds.flatMap((moveId) => {
    const sourceMove = moves.get(moveId);
    if (
      sourceMove === undefined ||
      sourceMove.id === triggeringMove.id ||
      sourceMove.category !== "skill"
    )
      return [];
    const useLimit = effectiveRestrictedMoveUseLimit(state, attacker, sourceMove);
    if (useLimit !== undefined && (attacker.moveUses[sourceMove.id] ?? 0) >= useLimit) return [];
    const effects = moveEffectsForTrigger(sourceMove, "on-stopped", {
      ...context,
      self: attacker,
      opponent: target,
      triggeringMove,
      triggeringMoveOwner: "self",
    });
    return effects.resources.length === 0 &&
      effects.locks.length === 0 &&
      effects.statuses.length === 0 &&
      effects.combatResultOverrides.length === 0 &&
      effects.floatingEffects.length === 0 &&
      effects.forcedActions.length === 0 &&
      effects.rollModifications.length === 0
      ? []
      : [{ sourceMove, owner: attacker, target, effects }];
  });
};

const stoppedSkillEffectsForResolution = (
  initialRoll: ReturnType<typeof convertedAttackRoll>,
  state: ActiveFightState,
  attacker: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  triggeringMove: MoveDefinition,
  context: Parameters<typeof moveEffectsForTrigger>[2],
) =>
  initialRoll.successfulHitCount === 0
    ? stoppedSkillTriggeredEffects(state, attacker, target, triggeringMove, context)
    : [];

const defensiveOnDamageEffectSets = (
  state: ActiveFightState,
  attacker: ActiveFightState["combatants"][CombatantId],
  defender: ActiveFightState["combatants"][CombatantId],
  triggeringMove: MoveDefinition | undefined,
  context: Parameters<typeof moveEffectsForTrigger>[2],
  incomingDamage: number,
  selectedSourceDefinitionId?: MoveId,
  selectedEffectIndices?: readonly number[],
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
  if (selectedSourceDefinitionId !== undefined) sourceMoveIds.add(selectedSourceDefinitionId);
  return [...sourceMoveIds].flatMap((sourceMoveId) => {
    const sourceMove = moves.get(sourceMoveId);
    if (sourceMove === undefined) return [];
    return [
      {
        sourceMove,
        effects: moveEffectsForTrigger(sourceMove, "on-damage", {
          ...context,
          self: defender,
          opponent: attacker,
          ...(triggeringMove === undefined ? {} : { triggeringMove }),
          incomingDamage,
          ...(selectedSourceDefinitionId === sourceMoveId && selectedEffectIndices !== undefined
            ? { enabledOptionalEffectIndices: selectedEffectIndices }
            : {}),
        }),
      },
    ];
  });
};

const defensiveOnDamageModifications = (
  state: ActiveFightState,
  attacker: ActiveFightState["combatants"][CombatantId],
  defender: ActiveFightState["combatants"][CombatantId],
  triggeringMove: MoveDefinition | undefined,
  context: Parameters<typeof moveEffectsForTrigger>[2],
  incomingDamage: number,
  selectedSourceDefinitionId?: MoveId,
  selectedEffectIndices?: readonly number[],
) =>
  defensiveOnDamageEffectSets(
    state,
    attacker,
    defender,
    triggeringMove,
    context,
    incomingDamage,
    selectedSourceDefinitionId,
    selectedEffectIndices,
  ).flatMap(({ effects }) =>
    effects.damageModifications.filter(
      (modification) =>
        modification.target === "opponent" &&
        (modification.scope === undefined || modification.scope === "current-action") &&
        (modification.useLimit === undefined ||
          (modification.sourceDefinitionId !== undefined &&
            (defender.effectUseCounts?.[
              `${modification.sourceDefinitionId}:${modification.effectIndex}`
            ] ?? 0) < modification.useLimit.count)),
    ),
  );

const selectedDefensiveOnDamageEffects = (
  state: ActiveFightState,
  attacker: ActiveFightState["combatants"][CombatantId],
  defender: ActiveFightState["combatants"][CombatantId],
  triggeringMove: MoveDefinition,
  context: Parameters<typeof moveEffectsForTrigger>[2],
  incomingDamage: number,
  sourceDefinitionId: MoveId | undefined,
  effectIndices: readonly number[] | undefined,
) =>
  sourceDefinitionId === undefined || effectIndices === undefined
    ? mergeMoveEffects()
    : (() => {
        const selected = defensiveOnDamageEffectSets(
          state,
          attacker,
          defender,
          triggeringMove,
          context,
          incomingDamage,
          sourceDefinitionId,
          effectIndices,
        ).find(({ sourceMove }) => sourceMove.id === sourceDefinitionId);
        return selected === undefined
          ? mergeMoveEffects()
          : effectsForActionWithMoveModificationPrevention(
              state,
              selected.effects,
              defender.id,
              selected.sourceMove,
              attacker,
              defender,
              triggeringMove,
            );
      })();

const pendingDefensiveOnDamageChoice = (
  state: ActiveFightState,
  attacker: ActiveFightState["combatants"][CombatantId],
  defender: ActiveFightState["combatants"][CombatantId],
  triggeringMove: MoveDefinition,
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
  return [...sourceMoveIds]
    .flatMap((sourceMoveId) => {
      const sourceMove = moves.get(sourceMoveId);
      if (sourceMove === undefined) return [];
      const effects = moveEffectsForTrigger(sourceMove, "on-damage", {
        ...context,
        self: defender,
        opponent: attacker,
        triggeringMove,
        incomingDamage,
        collectPendingChoices: true,
      });
      return effects.pendingEffectChoices
        .filter((choice) => choice.effectIndices.length > 0)
        .map((choice) => ({ sourceMove, choice }));
    })
    .find(({ sourceMove, choice }) => {
      const effects = moveEffectsForTrigger(sourceMove, "on-damage", {
        ...context,
        self: defender,
        opponent: attacker,
        triggeringMove,
        incomingDamage,
        enabledOptionalEffectIndices: choice.effectIndices,
      });
      const costs = effects.damageModifications
        .filter(
          (modification) =>
            modification.target === "opponent" && modification.activationCost !== undefined,
        )
        .map((modification) => modification.activationCost!);
      const useLimitsAvailable = effects.damageModifications
        .filter((modification) => modification.useLimit !== undefined)
        .every(
          (modification) =>
            (defender.effectUseCounts?.[`${sourceMove.id}:${modification.effectIndex}`] ?? 0) <
            modification.useLimit!.count,
        );
      return (
        useLimitsAvailable &&
        costs.every((cost) => {
          const resource = cost.resource === "hp" ? defender.hitPoints : defender.ki;
          return (
            resource.current - cost.amount >= 0 &&
            (cost.minimum === undefined || resource.current - cost.amount >= cost.minimum)
          );
        })
      );
    });
};

const pendingDefensiveOnDamageTransition = (
  input: CompleteConvertedAttackInput,
  attacker: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  move: MoveDefinition,
  damageEffectContext: Parameters<typeof moveEffectsForTrigger>[2],
  damageBeforeOnDamage: number,
  initialRoll: ReturnType<typeof convertedAttackRoll>,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> | undefined => {
  if (input.damageEffectSourceDefinitionId !== undefined) return undefined;
  const pendingDamageChoice = pendingDefensiveOnDamageChoice(
    input.state,
    attacker,
    target,
    move,
    damageEffectContext,
    damageBeforeOnDamage,
  );
  if (pendingDamageChoice === undefined) return undefined;
  return requestAttackEffectChoice({
    state: input.state,
    decision: input.decision,
    target,
    move,
    effectIndices: pendingDamageChoice.choice.effectIndices,
    effectSourceDefinitionId: pendingDamageChoice.sourceMove.id,
    numericSelection: undefined,
    effectTrigger: "on-damage",
    choiceCombatantId: target.id,
    naturalRolls: initialRoll.rolls.map((roll) => ({
      attack: roll.attackNaturalResult,
      ...(roll.defenseNaturalResult === undefined ? {} : { defense: roll.defenseNaturalResult }),
    })),
    blockedDice: input.blockedDice,
    blockUsage: input.blockUsage,
    defenseItemUse: input.defenseItemUse,
    defenseResultModifier: input.defenseResultModifier,
    preventCritical: input.preventCritical,
    preventCounter: input.preventCounter,
    resultOverrides: input.resultOverrides,
    numericResultOverrides: input.numericResultOverrides,
    includeRollEvents: input.includeRollEvents,
    dependencies,
  });
};

const defensiveOnDamageModificationsForAttack = (
  input: CompleteConvertedAttackInput,
  attacker: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  move: MoveDefinition,
  damageEffectContext: Parameters<typeof moveEffectsForTrigger>[2],
  damageBeforeOnDamage: number,
  initialRoll: ReturnType<typeof convertedAttackRoll>,
) =>
  initialRoll.successfulHitCount > 0
    ? defensiveOnDamageModifications(
        input.state,
        attacker,
        target,
        move,
        damageEffectContext,
        damageBeforeOnDamage,
        input.damageEffectSourceDefinitionId,
        input.damageEffectIndices,
      )
    : [];

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
  readonly preventCritical?: boolean;
  readonly preventCounter?: boolean;
  readonly preventStun?: boolean;
  readonly includeRollEvents?: boolean;
  readonly naturalRolls?: readonly ContestedAttackNaturalRoll[];
  readonly resultOverrides?: readonly ResultOverride[];
  readonly numericResultOverrides?: readonly NumericResultOverride[];
  readonly enabledOptionalEffectIndices?: readonly number[];
  readonly resolvedOptionalEffectIndices?: readonly number[];
  readonly enabledAfterDefenseEffectIndices?: readonly number[];
  readonly selectedNumericValues?: Readonly<Record<string, number>>;
  readonly selectedSuppressionMoves?: readonly {
    readonly effectIndex: number;
    readonly moveId: MoveId;
  }[];
  readonly selectedMoveUseEffectOwnerId?: CombatantId;
  readonly selectedCostModifications?: readonly CurrentActionCostModification[];
  readonly selectedMoveUseEffects?: ReturnType<typeof moveEffectsForTrigger>;
  readonly selectedBeforeDefenseDamageModifications?: ReturnType<
    typeof moveEffectsForTrigger
  >["damageModifications"];
  readonly selectedBeforeDefenseEffects?: ReturnType<typeof moveEffectsForTrigger>;
  readonly selectedBeforeDefenseSourceDefinitionId?: MoveId;
  readonly preventDamage?: boolean;
  /** Fixed damage captured by an exact prior-action copy. */
  readonly baseDamageOverride?: number;
  readonly copiedSourceResolution?: AttackResolutionSnapshot;
  readonly damageEffectSourceDefinitionId?: MoveId;
  readonly damageEffectIndices?: readonly number[];
  readonly defenseResponse?: DefenseResponse;
  readonly counterAction?: CounterActionReference;
  readonly counterActionActivationCostPaid?: boolean;
  readonly deferredExecution?: {
    readonly activeEffectId: ActiveEffectId;
    readonly declarationDecisionId: CombatDecisionId;
    readonly damageOverridePercent?: number;
  };
}

const currentActionCostModificationsForAttack = (
  beforeAttackEffects: ReturnType<typeof moveEffectsForTrigger>,
  selectedCostModifications: readonly CurrentActionCostModification[] | undefined,
) => [...beforeAttackEffects.currentActionCostModifications, ...(selectedCostModifications ?? [])];

const selectedCostActivationResourceChanges = (input: CompleteConvertedAttackInput) =>
  input.selectedCostModifications === undefined
    ? []
    : costActivationResourceChanges(input.selectedCostModifications);

const convertedAttackCost = (
  state: ActiveFightState,
  attacker: ActiveFightState["combatants"][CombatantId],
  move: MoveDefinition,
  baseCost: number,
  additionalCurrentActionCostModifications: readonly CurrentActionCostModification[] = [],
) => {
  const currentModifications = [
    ...currentActionCostModifiersFor(state, attacker.id, move),
    ...additionalCurrentActionCostModifications.filter(
      (modification) => modification.target === "self",
    ),
  ];
  const costModifierMultiplier = costModifierMultiplierFor(state, attacker.id);
  const currentCost = currentModifications
    .map((modification) => ({
      ...modification,
      amount: Math.round(modification.amount * costModifierMultiplier),
    }))
    .reduce(applyCurrentActionCostModification, baseCost);
  return calculateKiCost(
    currentCost,
    activeCostModifiersFor(state, attacker.id, move, baseCost).map((effect) =>
      Math.round(effect.amount * costModifierMultiplier),
    ),
  );
};

const convertedAttackEffectContext = (
  state: ActiveFightState,
  attacker: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  triggeringMove?: MoveDefinition,
  activationUnavailableSelectors?: readonly MoveSelectorCondition[],
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
  ...(activationUnavailableSelectors === undefined || activationUnavailableSelectors.length === 0
    ? {}
    : { activationUnavailableSelectors }),
});

const activeConstantOnRollResultExtraActions = (
  state: ActiveFightState,
  attacker: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  triggeringMove: MoveDefinition,
  context: Parameters<typeof moveEffectsForTrigger>[2],
) =>
  state.activeEffects.flatMap((activeEffect) => {
    if (
      activeEffect.type !== "active-constant" ||
      activeEffect.lifecycle === "deactivated" ||
      activeEffect.sourceCombatantId !== attacker.id ||
      activeEffectSuppressed(state, activeEffect)
    )
      return [];
    const sourceMove = context.moves.get(activeEffect.sourceDefinitionId);
    if (sourceMove === undefined) return [];
    return moveEffectsForTrigger(sourceMove, "on-roll-result", {
      ...context,
      self: attacker,
      opponent: target,
      triggeringMove,
      triggeringMoveOwner: "self",
      paidActivationCost: activeEffect.paidActivationCost,
    }).extraActions;
  });

const activeConstantOnRollResultActivations = (
  state: ActiveFightState,
  attacker: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  triggeringMove: MoveDefinition,
  context: Parameters<typeof moveEffectsForTrigger>[2],
) =>
  state.activeEffects.flatMap((activeEffect) => {
    if (
      activeEffect.type !== "active-constant" ||
      activeEffect.lifecycle === "deactivated" ||
      activeEffect.sourceCombatantId !== attacker.id ||
      activeEffectSuppressed(state, activeEffect)
    )
      return [];
    const sourceMove = context.moves.get(activeEffect.sourceDefinitionId);
    if (sourceMove === undefined) return [];
    return moveEffectsForTrigger(sourceMove, "on-roll-result", {
      ...context,
      self: attacker,
      opponent: target,
      triggeringMove,
      triggeringMoveOwner: "self",
      paidActivationCost: activeEffect.paidActivationCost,
      collectPendingChoices: true,
    }).activations;
  });

const moveHasRollResultResourceListener = (move: MoveDefinition) =>
  (move.effects ?? []).some(
    (effect) => effect.trigger === "on-roll-result" && effect.type === "modify-resource",
  );

const rollResultTriggeredEffects = (
  actor: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  triggeringMove: MoveDefinition | undefined,
  context: Parameters<typeof moveEffectsForTrigger>[2],
) => {
  const moves = new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate]));
  return [actor, target].flatMap((listener) => {
    const opponent = listener.id === actor.id ? target : actor;
    return listener.moveIds.flatMap((sourceDefinitionId) => {
      const sourceMove = moves.get(sourceDefinitionId);
      if (
        sourceMove === undefined ||
        sourceMove.id === triggeringMove?.id ||
        !moveHasRollResultResourceListener(sourceMove)
      )
        return [];
      const effects = moveEffectsForTrigger(sourceMove, "on-roll-result", {
        ...context,
        self: listener,
        opponent,
        sourceDefinitionId,
        triggeringMove,
        triggeringMoveOwner: listener.id === actor.id ? "self" : "opponent",
      });
      return effects.resources.length === 0 ? [] : [{ sourceMove, owner: listener, effects }];
    });
  });
};

const moveHasRollModifiedResourceListener = (move: MoveDefinition) =>
  (move.effects ?? []).some(
    (effect) =>
      effect.trigger === "on-roll-modified" &&
      (effect.type === "modify-resource" || effect.type === "modify-roll-modifier"),
  );

const rollModificationTriggeredEffects = (
  actor: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  triggeringMove: MoveDefinition | undefined,
  context: Parameters<typeof moveEffectsForTrigger>[2],
) => {
  const moves = new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate]));
  return [actor, target].flatMap((listener) => {
    const opponent = listener.id === actor.id ? target : actor;
    return listener.moveIds.flatMap((sourceDefinitionId) => {
      const sourceMove = moves.get(sourceDefinitionId);
      if (
        sourceMove === undefined ||
        sourceMove.id === triggeringMove?.id ||
        !moveHasRollModifiedResourceListener(sourceMove)
      )
        return [];
      const effects = moveEffectsForTrigger(sourceMove, "on-roll-modified", {
        ...context,
        self: listener,
        opponent,
        sourceDefinitionId,
        triggeringMove,
        triggeringMoveOwner: listener.id === actor.id ? "self" : "opponent",
        collectPendingChoices: true,
      });
      return effects.resources.length === 0 &&
        effects.rollModificationTransformers.length === 0 &&
        effects.pendingEffectChoices.length === 0
        ? []
        : [{ sourceMove, owner: listener, effects }];
    });
  });
};

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
  ...(application.targetRelationCombatantId === undefined
    ? {}
    : { targetRelationCombatantId: application.targetRelationCombatantId }),
  sourceDefinitionId,
  ...(application.blockedAttackDamage === undefined
    ? {}
    : { blockedAttackDamage: application.blockedAttackDamage }),
  sourceEffectIndex: application.sourceEffectIndex,
  floatingEffectId: application.floatingEffectId,
  effects: application.effects,
  termination: application.termination,
  ...(floatingDurationFromApplication(application, sourceCombatantId, targetCombatantId) ===
  undefined
    ? {}
    : {
        duration: floatingDurationFromApplication(
          application,
          sourceCombatantId,
          targetCombatantId,
        ),
      }),
  ...(application.stacking === undefined ? {} : { stacking: application.stacking }),
  scope: floatingScopeForApplication(application, sourceCombatantId, targetCombatantId),
  createdOnTurn,
});

const floatingDurationFromApplication = (
  application: FloatingEffectApplication,
  sourceCombatantId: CombatantId,
  targetCombatantId: CombatantId,
): Extract<ActiveCombatEffect, { readonly type: "floating-effect" }>["duration"] => {
  const duration = application.duration;
  if (duration === undefined) return undefined;
  if (duration.type === "until-roll-threshold")
    return {
      type: "until-roll-threshold",
      combatantId: targetCombatantId,
      roll: duration.roll,
      comparison: duration.comparison,
      value: duration.value,
      ...(duration.moveSelector === undefined ? {} : { moveSelector: duration.moveSelector }),
    };
  return {
    type: "until-combat-result",
    combatantId: duration.actor === "self" ? sourceCombatantId : targetCombatantId,
    result: duration.result,
    ...(duration.moveSelector === undefined ? {} : { moveSelector: duration.moveSelector }),
    ...(duration.rollThreshold === undefined ? {} : { rollThreshold: duration.rollThreshold }),
  };
};

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

const floatingEffectUseLimitKey = (
  sourceDefinitionId: MoveDefinition["id"],
  sourceCombatantId: CombatantId,
  targetCombatantId: CombatantId,
  application: FloatingEffectApplication,
) =>
  `${sourceDefinitionId}:${application.sourceEffectIndex}:${sourceCombatantId}:${targetCombatantId}:${application.floatingEffectId}`;

const upkeepTriggeredEffectsWithActivationCosts = (
  state: ActiveFightState,
  triggered: readonly UpkeepTriggeredEffects[],
) => {
  const usedCombatScopedLimits = new Set(
    state.activeEffects.flatMap((effect) =>
      effect.type === "floating-effect" && effect.sourceEffectIndex !== undefined
        ? [
            `${effect.sourceDefinitionId}:${effect.sourceEffectIndex}:${effect.sourceCombatantId}:${effect.targetCombatantId}:${effect.floatingEffectId}`,
          ]
        : [],
    ),
  );
  let simulatedCombatants = state.combatants;
  return triggered.map((entry) => {
    const currentActor = simulatedCombatants[entry.actor.id];
    const currentTarget = simulatedCombatants[entry.target.id];
    const baselineChanges = resourceChangesAfterPreventions(
      currentActor,
      currentTarget,
      entry.effects.resources,
      state.activeEffects,
      undefined,
    );
    let simulatedActor = resourceAfterChanges(
      currentActor,
      baselineChanges,
      "self",
      state.activeEffects,
    );
    const costs: ResourceChange[] = [];
    const suppressions = entry.effects.suppressions.filter((application) => {
      if (
        application.useLimit?.scope === "combat" &&
        state.activeEffects.filter(
          (effect) =>
            effect.type === "suppress" &&
            effect.sourceCombatantId === entry.actor.id &&
            effect.sourceDefinitionId === entry.sourceMove.id &&
            effect.sourceEffectIndex === application.sourceEffectIndex,
        ).length >= application.useLimit.count
      )
        return false;
      const cost = application.activationCost;
      if (cost === undefined) return true;
      const resource = cost.resource === "hp" ? simulatedActor.hitPoints : simulatedActor.ki;
      const remaining = resource.current - cost.amount;
      if (remaining < 0 || (cost.minimum !== undefined && remaining < cost.minimum)) return false;
      costs.push({
        resource: cost.resource,
        target: "self",
        operation: "lose",
        amount: cost.amount,
        sourceCombatantId: entry.actor.id,
        cause: "non-damage-effect",
      });
      simulatedActor = resourceAfterChanges(
        simulatedActor,
        [costs.at(-1)!],
        "self",
        state.activeEffects,
      );
      return true;
    });
    const floatingEffects = entry.effects.floatingEffects.filter((application) => {
      const targetCombatantId = application.target === "self" ? entry.actor.id : entry.target.id;
      const useLimitKey = floatingEffectUseLimitKey(
        entry.sourceMove.id,
        entry.actor.id,
        targetCombatantId,
        application,
      );
      if (application.useLimit?.scope === "combat" && usedCombatScopedLimits.has(useLimitKey))
        return false;
      if (application.activationCost === undefined) {
        if (application.useLimit?.scope === "combat") usedCombatScopedLimits.add(useLimitKey);
        return true;
      }
      const resource =
        application.activationCost.resource === "hp" ? simulatedActor.hitPoints : simulatedActor.ki;
      const remaining = resource.current - application.activationCost.amount;
      if (
        remaining < 0 ||
        (application.activationCost.minimum !== undefined &&
          remaining < application.activationCost.minimum)
      )
        return false;
      const cost: ResourceChange = {
        resource: application.activationCost.resource,
        target: "self",
        operation: "lose",
        amount: application.activationCost.amount,
        sourceCombatantId: entry.actor.id,
        cause: "non-damage-effect",
      };
      costs.push(cost);
      simulatedActor = resourceAfterChanges(simulatedActor, [cost], "self", state.activeEffects);
      if (application.useLimit?.scope === "combat") usedCombatScopedLimits.add(useLimitKey);
      return true;
    });
    const damageModifications = entry.effects.damageModifications.filter((application) => {
      if (application.useLimit?.scope !== "combat") return true;
      const uses = currentActor.moveUses[entry.sourceMove.id] ?? 0;
      if (uses >= application.useLimit.count) return false;
      const targetCombatantId = application.target === "self" ? entry.actor.id : entry.target.id;
      return !state.activeEffects.some(
        (effect) =>
          effect.sourceCombatantId === entry.actor.id &&
          effect.targetCombatantId === targetCombatantId &&
          effect.sourceDefinitionId === entry.sourceMove.id &&
          (effect.type === "modify-damage" || effect.type === "modify-next-action") &&
          effect.sourceEffectIndex === application.effectIndex &&
          application.stacking === "prevent",
      );
    });
    simulatedCombatants = { ...simulatedCombatants, [entry.actor.id]: simulatedActor };
    return {
      ...entry,
      effects: {
        ...entry.effects,
        resources: [...entry.effects.resources, ...costs],
        suppressions,
        floatingEffects,
        damageModifications,
      },
    };
  });
};

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
  ...(application.activationCost === undefined ||
  !(application.phase === "upkeep" && application.scope === "next-turn")
    ? {}
    : { activationCost: application.activationCost }),
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
    const applicationSourceDefinitionId = application.sourceDefinitionId ?? sourceDefinitionId;
    if (application.useLimit !== undefined) {
      const uses = state.actionHistory.filter(
        (action) =>
          action.actorId === sourceCombatantId &&
          action.type === "use-move" &&
          action.moveId === applicationSourceDefinitionId &&
          (application.useLimit?.scope === "combat" || action.turnNumber === state.turnNumber),
      ).length;
      if (uses >= application.useLimit.count) return [];
    }
    return [
      activeExtraActionFromApplication(
        application,
        sourceCombatantId,
        targetCombatantId,
        applicationSourceDefinitionId,
        createdOnTurn,
        dependencies,
      ),
    ];
  });

const activeDeferredMovesFromApplications = (
  applications: readonly DeferredMoveApplication[],
  sourceCombatantId: CombatantId,
  targetCombatantId: CombatantId,
  sourceDefinitionId: MoveDefinition["id"],
  declarationDecisionId: CombatDecisionId,
  createdOnTurn: number,
  dependencies: CombatDependencies,
) =>
  applications.map(
    (application): Extract<ActiveCombatEffect, { readonly type: "deferred-move" }> => ({
      id: dependencies.ids.nextActiveEffectId(),
      type: "deferred-move",
      sourceCombatantId,
      targetCombatantId,
      sourceDefinitionId,
      sourceEffectIndex: application.effectIndex,
      declarationDecisionId,
      // turnNumber advances once per combatant turn; one owner's next turn is
      // therefore two global turn boundaries away.
      performOnTurn: createdOnTurn + application.performAfterTurns * 2,
      ...(application.damageOverridePercent === undefined
        ? {}
        : { damageOverridePercent: application.damageOverridePercent }),
      cancellation: {
        actorCombatantId: targetCombatantId,
        result: application.cancellation.result,
      },
      ...(application.onCancellation === undefined
        ? {}
        : { onCancellation: application.onCancellation }),
    }),
  );

const passiveExtraActionsAtTurnStart = (
  state: ActiveFightState,
  actor: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  dependencies: CombatDependencies,
) => {
  const moves = new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate]));
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
  } satisfies Parameters<typeof moveEffectsForTrigger>[2];
  return actor.moveIds.flatMap((moveId) => {
    const move = moves.get(moveId);
    if (move === undefined) return [];
    const applications = moveEffectsForTrigger(move, "passive", context).extraActions.filter(
      (application) =>
        application.phase === "action" &&
        application.moveCategory === "skill" &&
        application.constant === false &&
        application.maximumActions !== undefined &&
        application.scope === "current-turn",
    );
    return activeExtraActionsFromApplications(
      state,
      applications,
      actor.id,
      target.id,
      move.id,
      state.turnNumber,
      dependencies,
    );
  });
};

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
    const duration =
      application.duration === undefined
        ? undefined
        : {
            type: "until-turn-start-roll-threshold" as const,
            combatantId:
              application.duration.subject === "self" ? sourceCombatantId : opponentCombatantId,
            dice: application.duration.dice,
            sides: application.duration.sides,
            comparison: application.duration.comparison,
            value: application.duration.value,
            remainingIgnoredChecks: application.duration.remainingIgnoredChecks,
          };
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
      ...(duration === undefined ? {} : { duration }),
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
    modifications.reduce(
      (total, effect) =>
        total +
        transformedRollModifierAmount(
          state,
          targetScope === "self" ? attackerId : targetId,
          roll,
          modifier,
          effect.sourceDefinitionId,
          rollModificationAmount(effect),
        ),
      0,
    ),
    move,
    modifications.some((effect) => effect.cap?.type === "allow-exceed") ||
      state.activeEffects.some(
        (effect): effect is ActiveRollModifierTransformerEffect =>
          effect.type === "modify-roll-modifier" &&
          effect.cap?.type === "allow-exceed" &&
          transformerMatchesRollModification(
            state,
            effect,
            targetScope === "self" ? attackerId : targetId,
            roll,
            modifier,
            undefined,
          ),
      ),
  );
};

const convertedAttackEffectRollModifierAllowsExceed = (
  input: ConvertedAttackEffectRollModifierInput,
) =>
  rollModificationsForConvertedAttack(input).some(
    (effect) => effect.cap?.type === "allow-exceed",
  ) ||
  input.state.activeEffects.some(
    (effect): effect is ActiveRollModifierTransformerEffect =>
      effect.type === "modify-roll-modifier" &&
      effect.cap?.type === "allow-exceed" &&
      transformerMatchesRollModification(
        input.state,
        effect,
        input.targetScope === "self" ? input.attackerId : input.targetId,
        input.roll,
        input.modifier,
        undefined,
      ),
  );

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

const activeCombatResultOverridesForAttack = (
  state: ActiveFightState,
  combatantId: CombatantId,
  move: MoveDefinition | undefined,
  diceCount: number,
): readonly ResultOverride[] =>
  Array.from({ length: diceCount }, () => {
    const effect = state.activeEffects.find(
      (
        candidate,
      ): candidate is Extract<ActiveCombatEffect, { readonly type: "modify-next-action" }> =>
        candidate.type === "modify-next-action" &&
        candidate.targetCombatantId === combatantId &&
        candidate.modifier.type === "combat-result" &&
        (candidate.modifier.resultScope === "current-attack" ||
          candidate.modifier.resultScope === "matching-die") &&
        (candidate.scope === undefined || candidate.scope === "next-action") &&
        (candidate.availableFromTurn === undefined ||
          candidate.availableFromTurn <= state.turnNumber) &&
        !activeEffectSuppressed(state, candidate) &&
        effectMatchesMoveSelector(candidate.selector, move),
    );
    return effect?.modifier.type === "combat-result" ? effect.modifier.result : undefined;
  });

const rollSelectionForAttack = (
  state: ActiveFightState,
  attackerId: CombatantId,
  targetId: CombatantId,
  move: MoveDefinition,
  immediate: readonly RollSelectionApplication[],
):
  | {
      readonly roll: "attack" | "defense";
      readonly diceCount: number;
      readonly selection: "highest" | "lowest";
    }
  | undefined => {
  const immediateSelection = immediate.find(
    (application) =>
      (application.target === "self" && application.roll === "attack") ||
      (application.target === "opponent" && application.roll === "defense"),
  );
  if (immediateSelection !== undefined)
    return {
      roll: immediateSelection.roll,
      diceCount: immediateSelection.diceCount,
      selection: immediateSelection.selection,
    };
  const activeSelection = state.activeEffects.find(
    (effect): effect is Extract<ActiveCombatEffect, { readonly type: "set-roll-selection" }> =>
      effect.type === "set-roll-selection" &&
      !activeEffectSuppressed(state, effect) &&
      ((effect.targetCombatantId === attackerId && effect.roll === "attack") ||
        (effect.targetCombatantId === targetId && effect.roll === "defense")) &&
      effectMatchesMoveSelector(effect.selector, move),
  );
  return activeSelection === undefined
    ? undefined
    : {
        roll: activeSelection.roll,
        diceCount: activeSelection.diceCount,
        selection: activeSelection.selection,
      };
};

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
  const damageModifierMultiplier = damageModifierMultiplierForAttack(
    state,
    attacker,
    target,
    move,
    effectContext,
  );
  const rollSelection = rollSelectionForAttack(
    state,
    attacker.id,
    target.id,
    move,
    passiveAttackEffects.rollSelections,
  );
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
  const diceCount = rollDefinition?.dice ?? adjustedAttack.dice;
  const deferredResultOverrides = activeCombatResultOverridesForAttack(
    state,
    attacker.id,
    move,
    diceCount,
  );
  const resultOverridesFromEffects = combatResultOverridesForAttack(
    passiveAttackEffects.combatResultOverrides,
    diceCount,
    Array.from(
      { length: diceCount },
      (_, index) => input.resultOverrides?.[index] ?? deferredResultOverrides[index],
    ),
  );
  const onRollResultFloatingEffects: FloatingEffectApplication[] = [];
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
  const rawBaseDamage =
    input.baseDamageOverride ??
    Math.round((attacker.stats.power * attack.baseDamagePercent.value) / 100);
  const passiveAdjustedDamage = applySourcedDamageModifications(
    state,
    rawBaseDamage,
    passiveAttackEffects.damageModifications,
    attacker.id,
    attacker.id,
    move.id,
    move,
    damageModifierMultiplier,
  );
  const constantAdjustedDamage = applyActiveConstantDamageModifiers(
    state,
    attacker.id,
    target.id,
    passiveAdjustedDamage,
    move,
    damageModifierMultiplier,
  );
  const activeAdjustedDamage = applyActiveDamageModifiers(
    state,
    attacker.id,
    constantAdjustedDamage,
    move,
    damageModifierMultiplier,
  );
  const beforeAttackAdjustedDamage = applySourcedDamageModifications(
    state,
    activeAdjustedDamage,
    beforeAttackEffects.damageModifications,
    attacker.id,
    attacker.id,
    move.id,
    move,
    damageModifierMultiplier,
  );
  const modifiedAttackRollModifiers = (["sides", "result"] as const).filter(
    (modifier) => totalRollModifier("self", "attack", modifier) !== 0,
  );
  const effectiveAttack = {
    ...adjustedAttack,
    dice: Math.max(
      1,
      (rollDefinition?.dice ?? adjustedAttack.dice) + totalRollModifier("self", "attack", "dice"),
    ),
    sides: rollValueWithCap(
      (rollDefinition?.sides ?? (attack.attackRoll ?? defaultMoveAttackRoll()).sides) +
        totalRollModifier("self", "attack", "sides"),
      "self",
      "attack",
      "sides",
    ),
  };
  const criticalThresholds = criticalThresholdsForMove(
    state,
    attacker,
    target,
    move,
    effectContext,
  );
  const resolutionThresholds = resolutionThresholdsForMove(state, attacker, target, move);
  const attackResultModifier = totalRollModifier("self", "attack", "result");
  const defenseSides =
    GLOBAL_RULES.combat.standardDieSides + totalRollModifier("opponent", "defense", "sides");
  const defenseResultModifierValue =
    (defenseResultModifier ?? 0) + totalRollModifier("opponent", "defense", "result");
  const preventCritical =
    input.preventCritical === true || combatResultPrevented(state, attacker.id, "critical", move);
  const preventCounter =
    input.preventCounter === true || combatResultPrevented(state, target.id, "counter", move);
  const baseDamage = damageAfterStatusPenalties(state, attacker, beforeAttackAdjustedDamage, move);
  const resultOverrides = resultOverridesFromEffects;
  const numericResultOverrides = input.numericResultOverrides ?? numericOverridesFromEffects;
  const resolution = resolveMoveAttack(
    statAdjustedAttacker,
    statAdjustedTarget,
    {
      attack: input.copiedSourceResolution?.attack ?? effectiveAttack,
      attackResultModifier:
        input.copiedSourceResolution?.attackResultModifier ?? attackResultModifier,
      defenseSides: input.copiedSourceResolution?.defenseSides ?? defenseSides,
      criticalThresholds: input.copiedSourceResolution?.criticalThresholds ?? criticalThresholds,
      defenseResultModifier:
        input.copiedSourceResolution?.defenseResultModifier ?? defenseResultModifierValue,
      resolutionThresholds:
        input.copiedSourceResolution?.resolutionThresholds ?? resolutionThresholds,
      preventCritical: input.copiedSourceResolution?.preventCritical ?? preventCritical,
      preventCounter: input.copiedSourceResolution?.preventCounter ?? preventCounter,
      naturalRolls:
        input.copiedSourceResolution === undefined
          ? input.naturalRolls
          : input.copiedSourceResolution.naturalAttackRolls.map((attack, index) => ({
              attack,
              defense: input.copiedSourceResolution!.naturalDefenseRolls[index],
            })),
      resultOverrides: input.copiedSourceResolution?.resultOverrides ?? resultOverrides,
      numericResultOverrides:
        input.copiedSourceResolution?.numericResultOverrides ?? numericResultOverrides,
      rollSelection,
      beforeDieResultModifier,
      afterDieResolved: (_index, rolls) => {
        const onRollResultEffects = moveEffectsForTrigger(move, "on-roll-result", {
          ...effectContext,
          includeActiveFloatingEffects: false,
          rolls,
          successfulHitCount: rolls.filter((roll) => roll.outcome === "successful").length,
        });
        onRollResultFloatingEffects.push(...onRollResultEffects.floatingEffects);
      },
      baseDamage: input.copiedSourceResolution?.baseDamage ?? baseDamage,
      damagePerHit: input.copiedSourceResolution?.damagePerHit ?? attack.damagePerHit,
    },
    dependencies.random,
    input.copiedSourceResolution?.blockedDice ?? blockedDice,
  );
  return {
    ...resolution,
    resolutionSnapshot: {
      paidKiCost: 0,
      attack: input.copiedSourceResolution?.attack ?? effectiveAttack,
      blockedDice: input.copiedSourceResolution?.blockedDice ?? blockedDice,
      attackResultModifier:
        input.copiedSourceResolution?.attackResultModifier ?? attackResultModifier,
      defenseSides: input.copiedSourceResolution?.defenseSides ?? defenseSides,
      defenseResultModifier:
        input.copiedSourceResolution?.defenseResultModifier ?? defenseResultModifierValue,
      baseDamage: input.copiedSourceResolution?.baseDamage ?? baseDamage,
      damagePerHit: input.copiedSourceResolution?.damagePerHit ?? attack.damagePerHit === true,
      naturalAttackRolls: resolution.rolls.map((roll) => roll.attackNaturalResult),
      naturalDefenseRolls: resolution.rolls.map((roll) => roll.defenseNaturalResult),
      criticalThresholds: input.copiedSourceResolution?.criticalThresholds ?? criticalThresholds,
      resolutionThresholds:
        input.copiedSourceResolution?.resolutionThresholds ?? resolutionThresholds,
      resultOverrides: input.copiedSourceResolution?.resultOverrides ?? resultOverrides,
      numericResultOverrides:
        input.copiedSourceResolution?.numericResultOverrides ?? numericResultOverrides,
      preventCritical: input.copiedSourceResolution?.preventCritical ?? preventCritical,
      preventCounter: input.copiedSourceResolution?.preventCounter ?? preventCounter,
    },
    ...(modifiedAttackRollModifiers.length === 0
      ? {}
      : {
          rollModification: {
            actor: "self" as const,
            roll: "attack" as const,
            modifiers: modifiedAttackRollModifiers,
            excludeSource: "dexterity" as const,
          },
        }),
    onRollResultFloatingEffects,
  };
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

const activeCombatResultEffectsFromApplications = (
  applications: readonly CombatResultOverrideApplication[],
  sourceCombatantId: CombatantId,
  targetCombatantId: CombatantId,
  sourceDefinitionId: MoveDefinition["id"],
  dependencies: CombatDependencies,
): readonly ActiveCombatEffect[] =>
  applications.flatMap((application) => {
    if (
      application.scope !== "next-action" ||
      (application.resultScope !== "current-attack" &&
        application.resultScope !== "matching-die") ||
      (application.result !== "successful" && application.result !== "stopped") ||
      application.effectIndex === undefined
    )
      return [];
    return [
      {
        id: dependencies.ids.nextActiveEffectId(),
        type: "modify-next-action" as const,
        sourceCombatantId,
        targetCombatantId: application.target === "self" ? sourceCombatantId : targetCombatantId,
        sourceDefinitionId,
        sourceEffectIndex: application.effectIndex,
        scope: "next-action" as const,
        modifier: {
          type: "combat-result" as const,
          result: application.result,
          resultScope: application.resultScope,
        },
        ...(application.selector === undefined ? {} : { selector: application.selector }),
      },
    ];
  });

const activeMoveRemovalsFromApplications = (
  applications: readonly MoveRemovalApplication[],
  sourceCombatantId: CombatantId,
  targetCombatantId: CombatantId,
  sourceDefinitionId: MoveDefinition["id"],
  combatants: Readonly<Record<CombatantId, CombatantState>>,
  dependencies: CombatDependencies,
): readonly ActiveCombatEffect[] =>
  (() => {
    const seen = new Set<string>();
    return applications.flatMap<ActiveCombatEffect>((application) => {
      const removedCombatantId = moveRemovalTargetId(
        application,
        sourceCombatantId,
        targetCombatantId,
      );
      const combatant = combatants[removedCombatantId];
      const removedFromIndex = combatant.moveIds.indexOf(sourceDefinitionId);
      if (removedFromIndex < 0) return [];
      const dedupeKey = `${removedCombatantId}:${sourceDefinitionId}`;
      if (seen.has(dedupeKey)) return [];
      seen.add(dedupeKey);
      return [
        {
          id: dependencies.ids.nextActiveEffectId(),
          type: "remove-move-from-combat" as const,
          sourceCombatantId,
          targetCombatantId: removedCombatantId,
          sourceDefinitionId,
          sourceEffectIndex: application.effectIndex,
          moveId: sourceDefinitionId,
          removedFromIndex,
          duration: "combat" as const,
        },
      ];
    });
  })();

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
  const suppressions = effects.suppressions
    .filter((suppression) => suppression.duration.type !== "current-resolution")
    .map((suppression) =>
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
      createdOnTurn,
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
        createdOnTurn,
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
  const rollModifierTransformers = effects.rollModificationTransformers.map((application) => {
    const targetCombatantId = application.target === "self" ? attacker.id : target.id;
    return {
      id: dependencies.ids.nextActiveEffectId(),
      type: "modify-roll-modifier" as const,
      sourceCombatantId: attacker.id,
      targetCombatantId,
      sourceDefinitionId: application.sourceDefinitionId,
      sourceEffectIndex: application.effectIndex,
      modifier: application.modifier,
      ...(application.multiplier === undefined ? {} : { multiplier: application.multiplier }),
      ...(application.increment === undefined ? {} : { increment: application.increment }),
      ...(application.excludeSourceCategories === undefined
        ? {}
        : { excludeSourceCategories: application.excludeSourceCategories }),
      ...(application.cap === undefined
        ? {}
        : {
            cap: {
              type: "allow-exceed" as const,
              scope: application.cap.scope ?? "amount",
            },
          }),
      duration:
        application.duration === "combat"
          ? ("combat" as const)
          : {
              type: "next-roll" as const,
              combatantId: targetCombatantId,
              roll: application.duration.roll,
            },
    } satisfies ActiveRollModifierTransformerEffect;
  });
  const rollSelections = effects.rollSelections.flatMap((application) => {
    if (application.scope !== "next-roll") return [];
    const targetCombatantId = application.target === "self" ? attacker.id : target.id;
    return [
      {
        id: dependencies.ids.nextActiveEffectId(),
        type: "set-roll-selection" as const,
        sourceCombatantId: attacker.id,
        targetCombatantId,
        sourceDefinitionId: application.sourceDefinitionId,
        sourceEffectIndex: application.effectIndex,
        roll: application.roll,
        diceCount: application.diceCount,
        selection: application.selection,
        ...(application.selector === undefined ? {} : { selector: application.selector }),
        duration: {
          type: "next-roll" as const,
          combatantId: targetCombatantId,
          roll: application.roll,
        },
      } satisfies Extract<ActiveCombatEffect, { readonly type: "set-roll-selection" }>,
    ];
  });
  const rerolls = activeRerollsFromApplications(
    effects.rerolls,
    attacker.id,
    target.id,
    dependencies,
  );
  const damageModifiers = activeDamageModifiersFromApplications(
    state,
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
  const statComparisons = activeStatComparisonsFromApplications(
    effects.statComparisons,
    attacker.id,
    target.id,
    move.id,
    dependencies,
  );
  const moveClassifications = activeMoveClassificationsFromApplications(
    effects.moveClassifications,
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
  const resourceActionModifiers = activeResourceActionModifiersFromApplications(
    effects.resourceActionModifiers ?? [],
    attacker.id,
    target.id,
    move.id,
    dependencies,
  );
  const resourceCostModifiers = defeated
    ? []
    : activeResourceCostModifiersFromApplications(
        state,
        effects.resourceCostModifications ?? [],
        attacker.id,
        target.id,
        dependencies,
      );
  const costModifierTransformers = defeated
    ? []
    : activeCostModifierTransformersFromApplications(
        effects.costModifierTransformers ?? [],
        attacker.id,
        target.id,
        move.id,
        dependencies,
      );
  const resourceModifierTransformers = defeated
    ? []
    : activeResourceModifierTransformersFromApplications(
        state,
        effects.resourceModifierTransformers ?? [],
        attacker.id,
        target.id,
        move.id,
        dependencies,
      );
  const costModifiers = defeated
    ? []
    : effects.costModifications.flatMap((modifier) => {
        if (modifier.selector === undefined) return [];
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
  const nextActionCostModifiers = defeated
    ? []
    : effects.costModifications.flatMap((modifier) => {
        if (modifier.scope === "next-action" && modifier.selector === undefined) return [];
        if (modifier.scope === "next-actions" && modifier.remaining === undefined) return [];
        const baseKiCost = modifier.selector?.baseKiCost;
        if (
          modifier.selector?.category === "advanced-attack" &&
          baseKiCost?.comparison === "exactly" &&
          baseKiCost.value.type === "literal"
        )
          return [];
        return [
          {
            id: dependencies.ids.nextActiveEffectId(),
            type: "modify-next-action" as const,
            sourceCombatantId: attacker.id,
            targetCombatantId: modifier.target === "self" ? attacker.id : target.id,
            sourceDefinitionId: move.id,
            ...(modifier.selector === undefined ? {} : { selector: modifier.selector }),
            scope: modifier.scope,
            ...(modifier.remaining === undefined ? {} : { remaining: modifier.remaining }),
            ...(modifier.scope === "next-turn"
              ? {
                  availableFromTurn: state.turnNumber + 1,
                  createdAfterActionCount: state.actionHistory.length + 1,
                }
              : {}),
            modifier: {
              type: "cost" as const,
              operation: modifier.operation,
              amount: modifier.amount,
              ...(modifier.amountExpression === undefined
                ? {}
                : { amountExpression: modifier.amountExpression }),
              ...(modifier.minimum === undefined ? {} : { minimum: modifier.minimum }),
              ...(modifier.maximum === undefined ? {} : { maximum: modifier.maximum }),
            },
          },
        ];
      });
  const combatResultModifiers = defeated
    ? []
    : activeCombatResultEffectsFromApplications(
        effects.combatResultOverrides,
        attacker.id,
        target.id,
        move.id,
        dependencies,
      );
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
  const moveRemovals = activeMoveRemovalsFromApplications(
    effects.moveRemovals,
    attacker.id,
    target.id,
    move.id,
    state.combatants,
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
    ...resourceActionModifiers,
    ...resourceCostModifiers,
    ...costModifierTransformers,
    ...resourceModifierTransformers,
    ...rollModifiers,
    ...rollModifierTransformers,
    ...rollSelections,
    ...rerolls,
    ...damageModifiers,
    ...statModifiers,
    ...statComparisons,
    ...moveClassifications,
    ...costModifiers,
    ...nextActionCostModifiers,
    ...combatResultModifiers,
    ...floatingEffects,
    ...extraActions,
    ...actionRestrictions,
    ...moveRemovals,
  ];
};

const powerUpTriggeredEffects = (
  state: ActiveFightState,
  actor: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  actionHistory: readonly CombatActionRecord[],
  options: {
    readonly collectPendingChoices?: boolean;
    readonly selectedSourceDefinitionId?: MoveDefinition["id"];
    readonly enabledOptionalEffectIndices?: readonly number[];
  } = {},
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
    activeEffects: state.activeEffects,
    mode: state.mode,
    ...(options.collectPendingChoices === true ? { collectPendingChoices: true } : {}),
  };
  return [...sourceDefinitionIds].flatMap((sourceDefinitionId) => {
    const sourceMove = moves.get(sourceDefinitionId);
    return sourceMove === undefined
      ? []
      : [
          {
            sourceMove,
            effects: moveEffectsForTrigger(sourceMove, "on-power-up", {
              ...context,
              ...(options.selectedSourceDefinitionId === sourceDefinitionId &&
              options.enabledOptionalEffectIndices !== undefined
                ? { enabledOptionalEffectIndices: options.enabledOptionalEffectIndices }
                : {}),
            }),
          },
        ];
  });
};

interface StartCombatTriggeredEffects {
  readonly sourceMove: MoveDefinition;
  readonly actor: ActiveFightState["combatants"][CombatantId];
  readonly target: ActiveFightState["combatants"][CombatantId];
  readonly effects: ReturnType<typeof moveEffectsForTrigger>;
  readonly pendingChoice?: PendingEffectChoice;
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
      collectPendingChoices: true,
    };
    return actor.moveIds.flatMap((sourceDefinitionId) => {
      const sourceMove = moves.get(sourceDefinitionId);
      if (sourceMove === undefined) return [];
      const choiceFrame = upkeepEffectChoiceFrameFor(state, actor.id, sourceMove.id);
      const effects = moveEffectsForTrigger(sourceMove, "start-combat", {
        ...context,
        ...(choiceFrame?.effectTrigger === "start-combat"
          ? {
              enabledOptionalEffectIndices: choiceFrame.selectedEffectIndices ?? [],
              resolvedOptionalEffectIndices: choiceFrame.effectIndices,
            }
          : {}),
      });
      const pendingChoice =
        choiceFrame?.effectTrigger === "start-combat" ? undefined : effects.pendingEffectChoices[0];
      return effects.resources.length === 0 &&
        effects.locks.length === 0 &&
        effects.activations.length === 0 &&
        effects.statuses.length === 0 &&
        effects.costModifications.length === 0 &&
        effects.currentActionCostModifications.length === 0 &&
        effects.remainingUseModifications.length === 0 &&
        effects.moveClassifications.length === 0 &&
        pendingChoice === undefined
        ? []
        : [{ sourceMove, actor, target, effects, pendingChoice }];
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
    const changes = resourceChangesWithActivationCosts(
      { ...state, combatants },
      resourceChangesAfterPreventions(
        currentActor,
        currentTarget,
        effects.resources,
        state.activeEffects,
        undefined,
      ),
    );
    const actorAfter = statusesAfterApplications(
      resourceAfterChanges(currentActor, changes, "self", state.activeEffects),
      effects.statuses,
      "self",
    );
    const targetAfter = resourceAfterChanges(
      currentTarget,
      changes,
      "opponent",
      state.activeEffects,
    );
    const targetAfterStatuses = statusesAfterApplications(
      targetAfter,
      effects.statuses,
      "opponent",
    );
    const actorAfterUses = combatantAfterRemainingUseModifications(
      actorAfter,
      effects.remainingUseModifications,
      "self",
    );
    const targetAfterUses = combatantAfterRemainingUseModifications(
      targetAfterStatuses,
      effects.remainingUseModifications,
      "opponent",
    );
    combatants = {
      ...combatants,
      [actor.id]: actorAfterUses,
      [target.id]: targetAfterUses,
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

const turnEndTriggeredEffects = (
  state: ActiveFightState,
): readonly StartCombatTriggeredEffects[] => {
  const moves = new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate]));
  return Object.values(state.combatants).flatMap((actor) => {
    const target = Object.values(state.combatants).find(
      (candidate) => candidate.id !== actor.id && candidate.status === "active",
    );
    if (target === undefined) return [];
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
      const effects = moveEffectsForTrigger(sourceMove, "turn-end", {
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
      });
      return effects.resources.length === 0 &&
        effects.statuses.length === 0 &&
        effects.actionRestrictions.length === 0 &&
        effects.locks.length === 0
        ? []
        : [{ sourceMove, actor, target, effects }];
    });
  });
};

const combatantsAfterTurnEndEffects = (
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
    combatants = {
      ...combatants,
      [actor.id]: statusesAfterApplications(
        resourceAfterChanges(currentActor, changes, "self", state.activeEffects),
        effects.statuses,
        "self",
      ),
      [target.id]: statusesAfterApplications(
        resourceAfterChanges(currentTarget, changes, "opponent", state.activeEffects),
        effects.statuses,
        "opponent",
      ),
    };
  }
  return combatants;
};

interface UpkeepTriggeredEffects {
  readonly sourceMove: MoveDefinition;
  readonly actor: ActiveFightState["combatants"][CombatantId];
  readonly target: ActiveFightState["combatants"][CombatantId];
  readonly effects: ReturnType<typeof moveEffectsForTrigger>;
  readonly resolvedSelections: readonly ResolvedStoredMoveSelection[];
  readonly pendingChoice?: PendingEffectChoice;
}

type UpkeepEffectChoiceFrame = Extract<
  ActiveFightState["resolutionFrames"][number],
  { readonly type: "effect-choice" }
>;

const upkeepEffectChoiceFrameFor = (
  state: ActiveFightState,
  sourceCombatantId: CombatantId,
  sourceDefinitionId: MoveId,
) =>
  state.resolutionFrames.find(
    (frame): frame is UpkeepEffectChoiceFrame =>
      frame.type === "effect-choice" &&
      frame.returnPhase === "upkeep" &&
      frame.sourceCombatantId === sourceCombatantId &&
      frame.sourceDefinitionId === sourceDefinitionId,
  );

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
      const choiceFrame = upkeepEffectChoiceFrameFor(state, actor.id, sourceMove.id);
      const triggeredEffects = moveEffectsForTrigger(sourceMove, "upkeep-phase", {
        ...context,
        collectPendingChoices: true,
        ...(choiceFrame === undefined
          ? {}
          : {
              enabledOptionalEffectIndices: choiceFrame.selectedEffectIndices ?? [],
              resolvedOptionalEffectIndices: choiceFrame.effectIndices,
            }),
      });
      const effects = effectsForUpkeepTarget(triggeredEffects, targetLabel);
      const pendingChoice =
        choiceFrame === undefined ? triggeredEffects.pendingEffectChoices[0] : undefined;
      return Object.values(effects).some((entries) => entries.length > 0) ||
        pendingChoice !== undefined
        ? [{ sourceMove, actor, target, effects, resolvedSelections: [], pendingChoice }]
        : [];
    });
  });
};

const requestUpkeepEffectChoice = (
  state: ActiveFightState,
  entry: Pick<StartCombatTriggeredEffects, "sourceMove" | "actor" | "target" | "pendingChoice">,
  dependencies: CombatDependencies,
  priorEvents: readonly CombatEvent[],
  effectTrigger: "upkeep-phase" | "start-combat" = "upkeep-phase",
): CombatResult<CombatTransition> => {
  const choice = entry.pendingChoice;
  if (choice === undefined) return { ok: false, error: invalidFightState(state) };
  const pendingDecisionId = dependencies.ids.nextPendingDecisionId();
  const nextVersion = state.version + 1;
  const frame: UpkeepEffectChoiceFrame = {
    id: dependencies.ids.nextResolutionFrameId(),
    type: "effect-choice",
    decisionId: dependencies.ids.nextDecisionId(),
    actorId: entry.actor.id,
    targetCombatantId: entry.target.id,
    returnPhase: "upkeep",
    pendingDecisionId,
    sourceDefinitionId: entry.sourceMove.id,
    sourceCombatantId: entry.actor.id,
    effectIndices: choice.effectIndices,
    effectTrigger,
    resolved: false,
  };
  return transitionFrom(
    {
      ...state,
      version: nextVersion,
      pendingDecision: {
        id: pendingDecisionId,
        stateVersion: nextVersion,
        combatantId: entry.actor.id,
        type: "optional-effect",
        options: [
          {
            id: `activate-effect:${choice.effectIndices.join(",")}`,
            type: "activate-effect",
            moveId: entry.sourceMove.id,
            effectIndices: choice.effectIndices,
          },
          { id: "decline", type: "decline" },
        ],
      },
      resolutionFrames: [...state.resolutionFrames, frame],
      eventSequence: state.eventSequence + 1,
    },
    priorEvents,
  );
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
    const selectionResolution = combatantAfterStoredMoveSelectionRequests(
      resolution.combatant,
      effects.storedMoveSelectionRequests,
      state.turnNumber,
    );
    combatants = { ...combatants, [actor.id]: selectionResolution.combatant };
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
      actor: selectionResolution.combatant,
      target: currentTarget,
      effects: mergeMoveEffects(effects, onRollResultEffects),
      resolvedSelections: selectionResolution.resolved,
    };
  });
  return { combatants, resolvedRolls, triggered: resolvedTriggered };
};

const combatantsAfterUpkeepEffects = (
  state: ActiveFightState,
  triggered: readonly UpkeepTriggeredEffects[],
) => {
  let combatants = state.combatants;
  for (const { sourceMove, actor, target, effects } of triggered) {
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
    const damageEffectActivations = new Set(
      effects.damageModifications
        .filter((effect) => effect.useLimit?.scope === "combat")
        .map((effect) => effect.effectIndex),
    ).size;
    combatants = {
      ...combatants,
      [actor.id]:
        damageEffectActivations === 0
          ? actorAfter
          : {
              ...actorAfter,
              moveUses: {
                ...actorAfter.moveUses,
                [sourceMove.id]:
                  (actorAfter.moveUses[sourceMove.id] ?? 0) + damageEffectActivations,
              },
            },
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
  statusTriggered: readonly StartCombatTriggeredEffects[] = [],
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
  for (const { actor, target, effects } of statusTriggered)
    for (const application of effects.statuses)
      events.push({
        id: dependencies.ids.nextEventId(),
        sequence: state.eventSequence + sequenceOffset + events.length + 1,
        fightId: state.id,
        type: "status-applied",
        sourceCombatantId: actor.id,
        targetCombatantId: application.target === "self" ? actor.id : target.id,
        statusId: application.status.statusId,
        stacks: application.status.stacks,
      });
  return events;
};

const moveUseTriggeredEffects = (
  state: ActiveFightState,
  actor: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  move: MoveDefinition,
  options: {
    readonly collectPendingChoices?: boolean;
    readonly enabledOptionalEffectIndices?: readonly number[];
    readonly resolvedOptionalEffectIndices?: readonly number[];
  } = {},
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
      triggeringMoveOwner: listener.id === actor.id ? ("self" as const) : ("opponent" as const),
      ...(options.collectPendingChoices === true ? { collectPendingChoices: true } : {}),
      ...(options.enabledOptionalEffectIndices === undefined
        ? {}
        : { enabledOptionalEffectIndices: options.enabledOptionalEffectIndices }),
      ...(options.resolvedOptionalEffectIndices === undefined
        ? {}
        : { resolvedOptionalEffectIndices: options.resolvedOptionalEffectIndices }),
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

const successfulEffectTriggeredEffects = (
  state: ActiveFightState,
  actor: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  move: MoveDefinition,
  context: Parameters<typeof moveEffectsForTrigger>[2],
) => {
  const moves = new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate]));
  return [actor, target].flatMap((listener) => {
    const opponent = listener.id === actor.id ? target : actor;
    const sourceDefinitionIds = new Set(listener.moveIds);
    for (const effect of state.activeEffects) {
      if (
        effect.type === "active-constant" &&
        effect.lifecycle !== "deactivated" &&
        !activeEffectSuppressed(state, effect) &&
        effect.sourceCombatantId === listener.id
      )
        sourceDefinitionIds.add(effect.sourceDefinitionId);
    }
    return [...sourceDefinitionIds].flatMap((sourceDefinitionId) => {
      const sourceMove = moves.get(sourceDefinitionId);
      if (
        sourceMove === undefined ||
        sourceMove.id === move.id ||
        !moveHasSuccessfulListenerEffect(sourceMove)
      )
        return [];
      return [
        {
          sourceMove,
          owner: listener,
          target: opponent,
          effects: moveEffectsForTrigger(sourceMove, "on-success", {
            ...context,
            self: listener,
            opponent,
            triggeringMove: move,
            triggeringMoveOwner: listener.id === actor.id ? "self" : "opponent",
          }),
        },
      ];
    });
  });
};

const moveHasSuccessfulListenerEffect = (move: MoveDefinition) =>
  (move.effects ?? []).some((effect) => {
    if (effect.trigger !== "on-success") return false;
    if (effect.type === "grant-counter-action") return true;
    if (effect.type !== "negate") return false;
    return (effect.conditions ?? []).some((condition) => condition.type === "move-selector");
  });

const negationTargetForListener = (
  ownerId: CombatantId,
  actorId: CombatantId,
  targetId: CombatantId,
  negationTarget: "self" | "opponent",
) => {
  if (ownerId === actorId) return negationTarget === "self" ? actorId : targetId;
  return negationTarget === "self" ? targetId : actorId;
};

const negationUseLimitAvailable = (
  owner: ActiveFightState["combatants"][CombatantId],
  negation: NegationApplication,
) => {
  if (negation.useLimit === undefined) return true;
  if (
    negation.useLimit.scope !== "combat" ||
    negation.sourceDefinitionId === undefined ||
    negation.sourceEffectIndex === undefined
  )
    return false;
  const key = `${negation.sourceDefinitionId}:${negation.sourceEffectIndex}`;
  return (owner.effectUseCounts?.[key] ?? 0) < negation.useLimit.count;
};

const negationMatchesTriggeringMove = (
  owner: ActiveFightState["combatants"][CombatantId],
  negation: NegationApplication,
  actorId: CombatantId,
  targetId: CombatantId,
  move: MoveDefinition,
) => {
  const negatedTargetId = negationTargetForListener(owner.id, actorId, targetId, negation.target);
  return (
    negatedTargetId === actorId &&
    negation.aspects.length === 0 &&
    negationUseLimitAvailable(owner, negation) &&
    (negation.selector === undefined || matchesMoveSelector(move, negation.selector))
  );
};

const negatesTriggeringMoveEffects = (
  triggered: ReturnType<typeof successfulEffectTriggeredEffects>,
  actorId: CombatantId,
  targetId: CombatantId,
  move: MoveDefinition,
) =>
  triggered.some(({ owner, effects }) =>
    effects.negations.some((negation) =>
      negationMatchesTriggeringMove(owner, negation, actorId, targetId, move),
    ),
  );

const negatesSelectedMoveUseEffects = (
  effects: ReturnType<typeof moveEffectsForTrigger> | undefined,
  move: MoveDefinition,
) =>
  effects?.negations.some(
    (negation) =>
      negation.target === "self" &&
      negation.aspects.length === 0 &&
      (negation.selector === undefined || matchesMoveSelector(move, negation.selector)),
  ) ?? false;

const triggeredNegationEffectUses = (
  triggered: ReturnType<typeof successfulEffectTriggeredEffects>,
  actorId: CombatantId,
  targetId: CombatantId,
  move: MoveDefinition,
) =>
  triggered.flatMap(({ owner, effects }) =>
    effects.negations.flatMap((negation) =>
      negationMatchesTriggeringMove(owner, negation, actorId, targetId, move) &&
      negation.useLimit !== undefined &&
      negation.sourceDefinitionId !== undefined &&
      negation.sourceEffectIndex !== undefined
        ? [
            {
              combatantId: owner.id,
              key: `${negation.sourceDefinitionId}:${negation.sourceEffectIndex}`,
            },
          ]
        : [],
    ),
  );

const suppressesTriggeringMoveEffects = (
  triggered: ReturnType<typeof successfulEffectTriggeredEffects>,
  actorId: CombatantId,
  targetId: CombatantId,
  move: MoveDefinition,
) =>
  triggered.some(({ owner, effects }) =>
    effects.suppressions.some((suppression) => {
      const suppressedTargetId = negationTargetForListener(
        owner.id,
        actorId,
        targetId,
        suppression.target,
      );
      return (
        suppression.duration.type === "current-resolution" &&
        suppressedTargetId === actorId &&
        suppression.aspects.includes("all-effects") &&
        suppressionMatchesMove(suppression, move)
      );
    }),
  );

const triggeringMoveEffectsSuppressed = (
  triggered: ReturnType<typeof successfulEffectTriggeredEffects>,
  actorId: CombatantId,
  targetId: CombatantId,
  move: MoveDefinition,
) =>
  negatesTriggeringMoveEffects(triggered, actorId, targetId, move) ||
  suppressesTriggeringMoveEffects(triggered, actorId, targetId, move);

const moveUseListenerMoves = (
  state: ActiveFightState,
  actor: ActiveFightState["combatants"][CombatantId],
  move: MoveDefinition,
) => {
  const moves = new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate]));
  const sourceDefinitionIds = new Set<MoveId>([move.id]);
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
    return sourceMove === undefined ? [] : [{ sourceMove, moves }];
  });
};

const moveUseListenerMovesForCombatant = (
  state: ActiveFightState,
  owner: ActiveFightState["combatants"][CombatantId],
) => {
  const moves = new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate]));
  const sourceDefinitionIds = new Set<MoveId>();
  for (const effect of state.activeEffects) {
    if (
      effect.type === "active-constant" &&
      effect.lifecycle !== "deactivated" &&
      !activeEffectSuppressed(state, effect) &&
      effect.sourceCombatantId === owner.id
    )
      sourceDefinitionIds.add(effect.sourceDefinitionId);
  }
  return [...sourceDefinitionIds].flatMap((sourceDefinitionId) => {
    const sourceMove = moves.get(sourceDefinitionId);
    return sourceMove === undefined ? [] : [{ sourceMove, moves }];
  });
};

type CostEffectTrigger = "on-move-use" | "on-cost-modified";

const costEffectContext = (
  state: ActiveFightState,
  actor: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  move: MoveDefinition,
  moves: ReadonlyMap<string, MoveDefinition>,
  collectPendingChoices: boolean,
  enabledOptionalEffectIndices?: readonly number[],
  resolvedOptionalEffectIndices?: readonly number[],
) => ({
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
  triggeringMove: move,
  triggeringMoveOwner: "self" as const,
  ...(collectPendingChoices ? { collectPendingChoices: true } : {}),
  ...(enabledOptionalEffectIndices === undefined ? {} : { enabledOptionalEffectIndices }),
  ...(resolvedOptionalEffectIndices === undefined ? {} : { resolvedOptionalEffectIndices }),
});

const resolvedCostChoiceIndicesFor = (
  sourceMove: MoveDefinition,
  trigger: CostEffectTrigger,
  resolvedSourceDefinitionId: MoveId | undefined,
  resolvedEffectIndices: readonly number[] | undefined,
) => {
  if (sourceMove.id !== resolvedSourceDefinitionId || resolvedEffectIndices === undefined)
    return undefined;
  const resolvedGroups = new Set(
    resolvedEffectIndices.flatMap((effectIndex) => {
      const effect = sourceMove.effects?.[effectIndex];
      const group = effect?.activationGroup ?? effect?.exclusiveActivationGroup;
      return effect?.trigger === trigger && group !== undefined ? [group] : [];
    }),
  );
  return (sourceMove.effects ?? []).flatMap((effect, effectIndex) => {
    const group = effect.activationGroup ?? effect.exclusiveActivationGroup;
    return effect.trigger === trigger &&
      (resolvedEffectIndices.includes(effectIndex) ||
        (group !== undefined && resolvedGroups.has(group)))
      ? [effectIndex]
      : [];
  });
};

const pendingCostChoicesFor = (
  state: ActiveFightState,
  actor: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  move: MoveDefinition,
  trigger: CostEffectTrigger,
  sourceMove: MoveDefinition,
  moves: ReadonlyMap<string, MoveDefinition>,
  resolvedSourceDefinitionId: MoveId | undefined,
  resolvedEffectIndices: readonly number[] | undefined,
) => {
  const pendingChoices = moveEffectsForTrigger(
    sourceMove,
    trigger,
    costEffectContext(
      state,
      actor,
      target,
      move,
      moves,
      true,
      undefined,
      resolvedCostChoiceIndicesFor(
        sourceMove,
        trigger,
        resolvedSourceDefinitionId,
        resolvedEffectIndices,
      ),
    ),
  ).pendingEffectChoices;
  return pendingChoices.map((choice) => ({
    sourceMove,
    choice,
    alternatives:
      choice.activationGroup === undefined
        ? [choice]
        : pendingChoices.filter(
            (candidate) => candidate.activationGroup === choice.activationGroup,
          ),
  }));
};

const pendingCostEffectChoice = (
  state: ActiveFightState,
  actor: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  move: MoveDefinition,
  trigger: CostEffectTrigger,
  resolvedSourceDefinitionId?: MoveId,
  resolvedEffectIndices?: readonly number[],
) =>
  moveUseListenerMoves(state, actor, move)
    .flatMap(({ sourceMove, moves }) =>
      pendingCostChoicesFor(
        state,
        actor,
        target,
        move,
        trigger,
        sourceMove,
        moves,
        resolvedSourceDefinitionId,
        resolvedEffectIndices,
      ),
    )
    .find(({ sourceMove, choice }) => {
      const selected = costEffectModificationsFor(
        state,
        actor,
        target,
        move,
        sourceMove.id,
        choice.effectIndices,
        trigger,
      );
      if (selected.length > 0 && costActivationCostsAvailable(actor, selected)) return true;
      if (trigger !== "on-move-use") return false;
      const selectedEffects = moveEffectsForTrigger(
        sourceMove,
        trigger,
        costEffectContext(
          state,
          actor,
          target,
          move,
          new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate])),
          false,
          choice.effectIndices,
        ),
      );
      const activationCost = selectedEffects.damageModifications.find(
        (effect) => effect.activationCost !== undefined,
      )?.activationCost;
      if (activationCost === undefined) return false;
      const resource = activationCost.resource === "hp" ? actor.hitPoints : actor.ki;
      return resource.current - activationCost.amount >= 0;
    });

const costEffectModificationsFor = (
  state: ActiveFightState,
  actor: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  move: MoveDefinition,
  sourceDefinitionId: MoveId,
  effectIndices: readonly number[],
  trigger: CostEffectTrigger,
) => {
  const source = moveUseListenerMoves(state, actor, move).find(
    ({ sourceMove }) => sourceMove.id === sourceDefinitionId,
  );
  if (source === undefined) return [] as readonly CurrentActionCostModification[];
  return moveEffectsForTrigger(
    source.sourceMove,
    trigger,
    costEffectContext(state, actor, target, move, source.moves, false, effectIndices),
  ).currentActionCostModifications;
};

const costActivationCostsAvailable = (
  actor: ActiveFightState["combatants"][CombatantId],
  modifications: readonly CurrentActionCostModification[],
) => {
  let hp = actor.hitPoints.current;
  let ki = actor.ki.current;
  for (const modification of modifications) {
    const cost = modification.activationCost;
    if (cost === undefined) continue;
    const current = cost.resource === "hp" ? hp : ki;
    const remaining = current - cost.amount;
    if (remaining < 0 || (cost.minimum !== undefined && remaining < cost.minimum)) return false;
    if (cost.resource === "hp") hp = remaining;
    else ki = remaining;
  }
  return true;
};

const costActivationResourceChanges = (
  modifications: readonly CurrentActionCostModification[],
): readonly ResourceChange[] =>
  modifications.flatMap((modification) => {
    const cost = modification.activationCost;
    return cost === undefined
      ? []
      : [
          {
            resource: cost.resource,
            target: "self" as const,
            operation: "lose" as const,
            amount: cost.amount,
            sourceCombatantId: modification.sourceCombatantId,
            sourceEffectIndex: modification.sourceEffectIndex,
            cause: "non-damage-effect" as const,
          },
        ];
  });

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
      return [...sourceDefinitionIds].flatMap((sourceDefinitionId) => {
        const sourceMove = moves.get(sourceDefinitionId);
        if (sourceMove === undefined) return [];
        const trigger = operation === "gain" ? "on-resource-gain" : "on-resource-drain";
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
          sourceDefinitionId,
        };
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
    resourceActionModifiers: remap(effects.resourceActionModifiers ?? []),
    resourceCostModifications: (effects.resourceCostModifications ?? []).map((effect) => ({
      ...effect,
      target: targetForAction(effect.target),
    })),
    damageModifierTransformers: (effects.damageModifierTransformers ?? []).map((effect) => ({
      ...effect,
      target: targetForAction(effect.target),
    })),
    resourceModifierTransformers: (effects.resourceModifierTransformers ?? []).map((effect) => ({
      ...effect,
      target: targetForAction(effect.target),
    })),
    costModifierTransformers: (effects.costModifierTransformers ?? []).map((effect) => ({
      ...effect,
      target: targetForAction(effect.target),
    })),
    storedRollRequests: effects.storedRollRequests,
    storedMoveSelectionRequests: effects.storedMoveSelectionRequests,
    statuses: remap(effects.statuses),
    extraActions: effects.extraActions.map((effect) => ({
      ...effect,
      target: targetForAction(effect.target),
    })),
    deferredMoves: effects.deferredMoves,
    counterActions: effects.counterActions.map((effect) => ({
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
    moveRemovals: remap(effects.moveRemovals),
    activations: remap(effects.activations),
    locks: remap(effects.locks),
    deactivations: remap(effects.deactivations),
    negations: remap(effects.negations),
    transformationReversions: remap(effects.transformationReversions),
    statComparisons: effects.statComparisons.map((effect) => ({
      ...effect,
      target: targetForAction(effect.target),
      left: targetForAction(effect.left),
      right: targetForAction(effect.right),
    })),
    transformationActions: effects.transformationActions.map((effect) => ({
      ...effect,
      target: targetForAction(effect.target),
    })),
    floatingEffects: effects.floatingEffects.map((effect) => ({
      ...effect,
      target: targetForAction(effect.target),
    })),
    moveUsePreventions: remap(effects.moveUsePreventions),
    remainingUseModifications: remap(effects.remainingUseModifications),
    statusPreventions: remap(effects.statusPreventions),
    rollModifications: remap(effects.rollModifications),
    rollModificationTransformers: remap(effects.rollModificationTransformers),
    rollSelections: remap(effects.rollSelections),
    rollDefinitions: remap(effects.rollDefinitions),
    rollResultOverrides: remap(effects.rollResultOverrides),
    combatResultOverrides: remap(effects.combatResultOverrides),
    criticalThresholds: ownerCombatantId === actionActorId ? effects.criticalThresholds : [],
    resolutionThresholds: remap(effects.resolutionThresholds),
    resolutionPreventions: remap(effects.resolutionPreventions),
    combatResultPreventions: remap(effects.combatResultPreventions),
    rollModificationPreventions: remap(effects.rollModificationPreventions),
    moveModificationPreventions: remap(effects.moveModificationPreventions),
    currentActionMoveModificationPreventions: remap(
      effects.currentActionMoveModificationPreventions,
    ),
    resourceModificationPreventions: remap(effects.resourceModificationPreventions),
    costModifications: remap(effects.costModifications),
    currentActionCostModifications: remap(effects.currentActionCostModifications),
    rerolls: remap(effects.rerolls),
    slotCapacityModifications: effects.slotCapacityModifications,
    moveClassifications: effects.moveClassifications,
    pendingEffectChoices: effects.pendingEffectChoices,
  };
};

const effectsForActionWithMoveModificationPrevention = (
  state: ActiveFightState,
  effects: ReturnType<typeof moveEffectsForTrigger>,
  sourceCombatantId: CombatantId,
  sourceMove: MoveDefinition,
  actionActor: ActiveFightState["combatants"][CombatantId],
  actionTarget: ActiveFightState["combatants"][CombatantId],
  triggeringMove: MoveDefinition | undefined,
) => {
  const relative = effectsRelativeToActionActor(effects, sourceCombatantId, actionActor.id);
  if (triggeringMove === undefined || sourceMove.id === triggeringMove.id) return relative;
  const targetIsBlocked = (target: "self" | "opponent") =>
    activeMoveModificationPrevented({
      state,
      combatantId: target === "self" ? actionActor.id : actionTarget.id,
      aspect: "effects",
      move: triggeringMove,
      sourceCombatantId,
      sourceDefinitionId: sourceMove.id,
      reduces: false,
    });
  const filter = <T extends { readonly target: "self" | "opponent" }>(items: readonly T[]) =>
    items.filter((item) => !targetIsBlocked(item.target));
  return {
    ...relative,
    resources: filter(relative.resources),
    resourceActionModifiers: filter(relative.resourceActionModifiers),
    resourceCostModifications: filter(relative.resourceCostModifications),
    damageModifierTransformers: filter(relative.damageModifierTransformers),
    resourceModifierTransformers: filter(relative.resourceModifierTransformers),
    costModifierTransformers: filter(relative.costModifierTransformers),
    statuses: filter(relative.statuses),
    extraActions: filter(relative.extraActions),
    counterActions: filter(relative.counterActions),
    scheduledResources: filter(relative.scheduledResources),
    damageModifications: filter(relative.damageModifications),
    statModifications: filter(relative.statModifications),
    suppressions: filter(relative.suppressions),
    forcedActions: filter(relative.forcedActions),
    actionRestrictions: filter(relative.actionRestrictions),
    moveRemovals: filter(relative.moveRemovals),
    activations: filter(relative.activations),
    locks: filter(relative.locks),
    deactivations: filter(relative.deactivations),
    transformationReversions: filter(relative.transformationReversions),
    floatingEffects: filter(relative.floatingEffects),
    moveUsePreventions: filter(relative.moveUsePreventions),
    remainingUseModifications: filter(relative.remainingUseModifications),
    statusPreventions: filter(relative.statusPreventions),
    rollModifications: filter(relative.rollModifications),
    rollModificationTransformers: filter(relative.rollModificationTransformers),
    rollSelections: filter(relative.rollSelections),
    rollDefinitions: filter(relative.rollDefinitions),
    rollResultOverrides: filter(relative.rollResultOverrides),
    combatResultOverrides: filter(relative.combatResultOverrides),
    resolutionThresholds: filter(relative.resolutionThresholds),
    resolutionPreventions: filter(relative.resolutionPreventions),
    combatResultPreventions: filter(relative.combatResultPreventions),
    rollModificationPreventions: filter(relative.rollModificationPreventions),
    moveModificationPreventions: filter(relative.moveModificationPreventions),
    currentActionMoveModificationPreventions: filter(
      relative.currentActionMoveModificationPreventions,
    ),
    resourceModificationPreventions: filter(relative.resourceModificationPreventions),
    costModifications: filter(relative.costModifications),
    currentActionCostModifications: filter(relative.currentActionCostModifications),
    rerolls: filter(relative.rerolls),
    negations: filter(relative.negations),
    statComparisons: filter(relative.statComparisons),
    transformationActions: filter(relative.transformationActions),
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
  resourceActionModifiers: effectSets.flatMap((effects) => effects.resourceActionModifiers ?? []),
  resourceCostModifications: effectSets.flatMap(
    (effects) => effects.resourceCostModifications ?? [],
  ),
  damageModifierTransformers: effectSets.flatMap(
    (effects) => effects.damageModifierTransformers ?? [],
  ),
  resourceModifierTransformers: effectSets.flatMap(
    (effects) => effects.resourceModifierTransformers ?? [],
  ),
  costModifierTransformers: effectSets.flatMap((effects) => effects.costModifierTransformers ?? []),
  storedRollRequests: effectSets.flatMap((effects) => effects.storedRollRequests),
  storedMoveSelectionRequests: effectSets.flatMap((effects) => effects.storedMoveSelectionRequests),
  statuses: effectSets.flatMap((effects) => effects.statuses),
  extraActions: effectSets.flatMap((effects) => effects.extraActions),
  deferredMoves: effectSets.flatMap((effects) => effects.deferredMoves),
  counterActions: effectSets.flatMap((effects) => effects.counterActions),
  scheduledResources: effectSets.flatMap((effects) => effects.scheduledResources),
  damageModifications: effectSets.flatMap((effects) => effects.damageModifications),
  statModifications: effectSets.flatMap((effects) => effects.statModifications),
  suppressions: effectSets.flatMap((effects) => effects.suppressions),
  forcedActions: effectSets.flatMap((effects) => effects.forcedActions),
  actionRestrictions: effectSets.flatMap((effects) => effects.actionRestrictions),
  moveRemovals: effectSets.flatMap((effects) => effects.moveRemovals),
  activations: effectSets.flatMap((effects) => effects.activations),
  locks: effectSets.flatMap((effects) => effects.locks),
  deactivations: effectSets.flatMap((effects) => effects.deactivations),
  transformationReversions: effectSets.flatMap((effects) => effects.transformationReversions),
  statComparisons: effectSets.flatMap((effects) => effects.statComparisons),
  transformationActions: effectSets.flatMap((effects) => effects.transformationActions),
  moveUsePreventions: effectSets.flatMap((effects) => effects.moveUsePreventions),
  remainingUseModifications: effectSets.flatMap((effects) => effects.remainingUseModifications),
  statusPreventions: effectSets.flatMap((effects) => effects.statusPreventions),
  rollModifications: effectSets.flatMap((effects) => effects.rollModifications),
  rollModificationTransformers: effectSets.flatMap(
    (effects) => effects.rollModificationTransformers,
  ),
  rollSelections: effectSets.flatMap((effects) => effects.rollSelections),
  rollDefinitions: effectSets.flatMap((effects) => effects.rollDefinitions),
  rollResultOverrides: effectSets.flatMap((effects) => effects.rollResultOverrides),
  combatResultOverrides: effectSets.flatMap((effects) => effects.combatResultOverrides),
  criticalThresholds: effectSets.flatMap((effects) => effects.criticalThresholds),
  resolutionThresholds: effectSets.flatMap((effects) => effects.resolutionThresholds),
  resolutionPreventions: effectSets.flatMap((effects) => effects.resolutionPreventions),
  combatResultPreventions: effectSets.flatMap((effects) => effects.combatResultPreventions),
  rollModificationPreventions: effectSets.flatMap((effects) => effects.rollModificationPreventions),
  moveModificationPreventions: effectSets.flatMap((effects) => effects.moveModificationPreventions),
  currentActionMoveModificationPreventions: effectSets.flatMap(
    (effects) => effects.currentActionMoveModificationPreventions,
  ),
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
  slotCapacityModifications: effectSets.flatMap((effects) => effects.slotCapacityModifications),
  moveClassifications: effectSets.flatMap((effects) => effects.moveClassifications),
  pendingEffectChoices: effectSets.flatMap((effects) => effects.pendingEffectChoices),
});

interface ResolvedStoredRoll {
  readonly request: StoredRollRequest;
  readonly storedRoll: StoredRoll;
}

interface ResolvedStoredMoveSelection {
  readonly request: StoredMoveSelectionRequest;
  readonly selection?: StoredMoveSelection;
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

const combatantAfterStoredMoveSelectionRequests = (
  combatant: CombatantState,
  requests: readonly StoredMoveSelectionRequest[],
  turnNumber: number,
): {
  readonly combatant: CombatantState;
  readonly resolved: readonly ResolvedStoredMoveSelection[];
} => {
  let storedMoveSelections = combatant.storedMoveSelections ?? {};
  const resolved = requests.map((request) => {
    const storedRoll = combatant.storedRolls?.[request.storageKey];
    const selectedIndex =
      storedRoll?.naturalResults.length === 1 ? storedRoll.naturalResults[0] - 1 : -1;
    const candidates = combatant.moveIds
      .map((moveId) => MOVE_DEFINITIONS.find((move) => move.id === moveId))
      .filter((move): move is MoveDefinition => move !== undefined)
      .filter((move) => matchesMoveSelector(move, request.selector));
    const selection =
      selectedIndex < 0 || selectedIndex >= candidates.length
        ? undefined
        : {
            sourceDefinitionId: request.sourceDefinitionId,
            selectionKey: request.selectionKey,
            moveId: candidates[selectedIndex].id,
            selectedOnTurn: turnNumber,
          };
    if (selection === undefined) {
      storedMoveSelections = Object.fromEntries(
        Object.entries(storedMoveSelections).filter(([key]) => key !== request.selectionKey),
      );
    } else {
      storedMoveSelections = { ...storedMoveSelections, [request.selectionKey]: selection };
    }
    return { request, ...(selection === undefined ? {} : { selection }) };
  });
  return {
    combatant: resolved.length === 0 ? combatant : { ...combatant, storedMoveSelections },
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

const storedMoveSelectionEvents = (
  state: ActiveFightState,
  combatantId: CombatantId,
  resolved: readonly ResolvedStoredMoveSelection[],
  dependencies: CombatDependencies,
  sequenceOffset: number,
): readonly CombatEvent[] =>
  resolved.map(({ request, selection }, index) => ({
    id: dependencies.ids.nextEventId(),
    sequence: state.eventSequence + sequenceOffset + index + 1,
    fightId: state.id,
    type: "move-selection-updated" as const,
    combatantId,
    sourceDefinitionId: request.sourceDefinitionId,
    storageKey: request.storageKey,
    selectionKey: request.selectionKey,
    ...(selection === undefined ? {} : { moveId: selection.moveId }),
  }));

const effectsForUpkeepTarget = (
  effects: ReturnType<typeof moveEffectsForTrigger>,
  target: "self" | "opponent",
): ReturnType<typeof moveEffectsForTrigger> => ({
  resources: effects.resources.filter((effect) => effect.target === target),
  resourceActionModifiers: (effects.resourceActionModifiers ?? []).filter(
    (effect) => effect.target === target,
  ),
  resourceCostModifications: (effects.resourceCostModifications ?? []).filter(
    (effect) => effect.target === target,
  ),
  damageModifierTransformers: (effects.damageModifierTransformers ?? []).filter(
    (effect) => effect.target === target,
  ),
  resourceModifierTransformers: (effects.resourceModifierTransformers ?? []).filter(
    (effect) => effect.target === target,
  ),
  costModifierTransformers: (effects.costModifierTransformers ?? []).filter(
    (effect) => effect.target === target,
  ),
  storedRollRequests: effects.storedRollRequests.filter((effect) => effect.target === target),
  storedMoveSelectionRequests: effects.storedMoveSelectionRequests.filter(
    (effect) => effect.target === target,
  ),
  statuses: effects.statuses.filter((effect) => effect.target === target),
  extraActions: effects.extraActions.filter((effect) => effect.target === target),
  deferredMoves: effects.deferredMoves.filter((effect) => effect.target === target),
  counterActions: effects.counterActions.filter((effect) => effect.target === target),
  scheduledResources: effects.scheduledResources.filter((effect) => effect.target === target),
  damageModifications: effects.damageModifications.filter((effect) => effect.target === target),
  statModifications: effects.statModifications.filter((effect) => effect.target === target),
  suppressions: effects.suppressions.filter((effect) => effect.target === target),
  forcedActions: effects.forcedActions.filter((effect) => effect.target === target),
  actionRestrictions: effects.actionRestrictions.filter((effect) => effect.target === target),
  moveRemovals: effects.moveRemovals.filter((effect) => effect.target === target),
  activations: effects.activations.filter((effect) => effect.target === target),
  locks: effects.locks.filter((effect) => effect.target === target),
  deactivations: effects.deactivations.filter((effect) => effect.target === target),
  transformationReversions: effects.transformationReversions.filter(
    (effect) => effect.target === target,
  ),
  floatingEffects: effects.floatingEffects.filter((effect) => effect.target === target),
  moveUsePreventions: effects.moveUsePreventions.filter((effect) => effect.target === target),
  remainingUseModifications: effects.remainingUseModifications.filter(
    (effect) => effect.target === target,
  ),
  statusPreventions: effects.statusPreventions.filter((effect) => effect.target === target),
  negations: effects.negations.filter((effect) => effect.target === target),
  rollModifications: effects.rollModifications.filter((effect) => effect.target === target),
  rollModificationTransformers: effects.rollModificationTransformers.filter(
    (effect) => effect.target === target,
  ),
  rollSelections: effects.rollSelections.filter((effect) => effect.target === target),
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
  currentActionMoveModificationPreventions: effects.currentActionMoveModificationPreventions.filter(
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
  statComparisons: effects.statComparisons.filter((effect) => effect.target === target),
  transformationActions: effects.transformationActions.filter((effect) => effect.target === target),
  slotCapacityModifications: effects.slotCapacityModifications,
  moveClassifications: effects.moveClassifications.filter((effect) => effect.target === target),
  pendingEffectChoices: effects.pendingEffectChoices,
});

const lifecycleDeactivationTargetIsEligible = (
  state: ActiveFightState,
  combatantId: CombatantId,
  moves: ReadonlyMap<string, MoveDefinition>,
  selector: MoveSelectorCondition | undefined,
) =>
  state.activeEffects.some((effect) => {
    if (
      effect.type !== "active-constant" ||
      effect.lifecycle === "deactivated" ||
      effect.sourceCombatantId !== combatantId
    )
      return false;
    const move = moves.get(effect.sourceDefinitionId);
    return move !== undefined && (selector === undefined || matchesMoveSelector(move, selector));
  });

const lifecycleDeactivationAlreadyResolved = (
  state: ActiveFightState,
  sourceDefinitionId: MoveId,
  effectIndex: number,
  trigger: "upkeep-phase" | "turn-end",
) =>
  state.resolutionFrames.some(
    (frame) =>
      frame.type === "effect" &&
      frame.sourceDefinitionId === sourceDefinitionId &&
      frame.effectIndex === effectIndex &&
      frame.trigger === (trigger === "upkeep-phase" ? "upkeep" : "end") &&
      frame.resolved === true,
  );

const lifecycleDeactivationForMove = ({
  state,
  actor,
  target,
  moves,
  sourceMove,
  trigger,
}: {
  readonly state: ActiveFightState;
  readonly actor: ActiveFightState["combatants"][CombatantId];
  readonly target: ActiveFightState["combatants"][CombatantId];
  readonly moves: ReadonlyMap<string, MoveDefinition>;
  readonly sourceMove: MoveDefinition;
  readonly trigger: "upkeep-phase" | "turn-end";
}) => {
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
    collectPendingChoices: true,
  } satisfies MoveEffectRuntimeContext;
  const effectIndices = (sourceMove.effects ?? []).flatMap((effect, effectIndex) =>
    effect.trigger === trigger && effect.type === "deactivate" && effect.optional === true
      ? [effectIndex]
      : [],
  );
  for (const effectIndex of effectIndices) {
    const resolved = effectsForUpkeepTarget(
      moveEffectsForTrigger(sourceMove, trigger, {
        ...context,
        collectPendingChoices: false,
        enabledOptionalEffectIndices: [effectIndex],
      }),
      "self",
    );
    if (resolved.deactivations.length === 0) continue;
    const application = resolved.deactivations[0]!;
    if (
      !lifecycleDeactivationTargetIsEligible(state, actor.id, moves, application.selector) ||
      !deactivationCostAvailable(actor, application.activationCost)
    )
      continue;
    if (lifecycleDeactivationAlreadyResolved(state, sourceMove.id, effectIndex, trigger)) continue;
    return { application, effectIndex };
  }
  return undefined;
};

const lifecycleDeactivationApplication = (
  state: ActiveFightState,
  combatantId: CombatantId,
  trigger: "upkeep-phase" | "turn-end",
) => {
  const actor = state.combatants[combatantId];
  const target = Object.values(state.combatants).find(
    (combatant) => combatant.id !== actor.id && combatant.status === "active",
  );
  if (target === undefined) return undefined;
  const moves = new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate]));
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
  for (const sourceDefinitionId of sourceDefinitionIds) {
    const sourceMove = moves.get(sourceDefinitionId);
    if (sourceMove === undefined) continue;
    const candidate = lifecycleDeactivationForMove({
      state,
      actor,
      target,
      moves,
      sourceMove,
      trigger,
    });
    if (candidate !== undefined) return candidate;
  }
  return undefined;
};

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
  readonly preventCritical?: boolean;
  readonly preventCounter?: boolean;
  readonly preventStun?: boolean;
  readonly includeRollEvents?: boolean;
  readonly naturalRolls?: readonly ContestedAttackNaturalRoll[];
  readonly resultOverrides?: readonly ResultOverride[];
  readonly numericResultOverrides?: readonly NumericResultOverride[];
  readonly enabledOptionalEffectIndices?: readonly number[];
  readonly resolvedOptionalEffectIndices?: readonly number[];
  readonly costEffectSourceDefinitionId?: MoveId;
  readonly costEffectIndices?: readonly number[];
  readonly costEffectTrigger?: CostEffectTrigger;
  readonly costEffectOwnerId?: CombatantId;
  readonly damageEffectSourceDefinitionId?: MoveId;
  readonly damageEffectIndices?: readonly number[];
  readonly enabledAfterDefenseEffectIndices?: readonly number[];
  readonly selectedNumericValues?: Readonly<Record<string, number>>;
  readonly selectedSuppressionMoves?: readonly {
    readonly effectIndex: number;
    readonly moveId: MoveId;
  }[];
  readonly defenseResponse?: DefenseResponse;
  /** Fixed damage captured by an exact prior-action copy. */
  readonly baseDamageOverride?: number;
  readonly copiedSourceResolution?: AttackResolutionSnapshot;
  readonly copiedFromMoveId?: MoveId;
  readonly copiedSourceMove?: MoveDefinition;
  readonly copiedDamageBonusPercent?: number;
  readonly copiedDamageOverride?: number;
  readonly copiedSuccessfulEffectsOnly?: boolean;
  readonly counterAction?: CounterActionReference;
  /** Post-defense reaction state already paid the counter activation cost. */
  readonly counterActionActivationCostPaid?: boolean;
  readonly deferMoveChoice?: "defer" | "decline";
  readonly deferredExecution?: {
    readonly activeEffectId: ActiveEffectId;
    readonly declarationDecisionId: CombatDecisionId;
    readonly damageOverridePercent?: number;
  };
}

const selectedSuppressionMovesOption = (
  selectedSuppressionMoves: AttackResolutionOptions["selectedSuppressionMoves"],
) => (selectedSuppressionMoves === undefined ? {} : { selectedSuppressionMoves });

interface BasicAttackResolutionOptions {
  readonly defenseItemUse?: DefenseItemUse;
  readonly defenseResultModifier?: number;
  readonly preventCritical?: boolean;
  readonly preventCounter?: boolean;
  readonly includeRollEvents?: boolean;
  readonly naturalRolls?: readonly ContestedAttackNaturalRoll[];
  readonly resultOverrides?: readonly ResultOverride[];
  readonly numericResultOverrides?: readonly NumericResultOverride[];
  readonly defenseResponse?: DefenseResponse;
  readonly counterAction?: CounterActionReference;
  readonly counterActionActivationCostPaid?: boolean;
}

type PostDefenseReactionFrame = Extract<
  ActiveFightState["resolutionFrames"][number],
  { readonly stage: "awaiting-post-defense-reaction" }
>;

interface PostDefenseReactionSelection {
  readonly itemUse: ReturnType<typeof availablePostRollDefenseItems>[number] | undefined;
  readonly closeShaveKiLoss: number | undefined;
  readonly combatResultOverride: PendingDecisionOption["combatResultOverride"];
  readonly combatResultNegation: PendingDecisionOption["combatResultNegation"];
  readonly reroll: PostDefenseRerollChoice | undefined;
  readonly secondChanceDie: number | undefined;
  readonly rerollEffect: ActiveRerollEffect | undefined;
  readonly rerollDieIndex: number | undefined;
  readonly afterDefenseEffectIndices: readonly number[] | undefined;
  readonly counterAction: CounterActionReference | undefined;
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
  state: ActiveFightState,
  move: MoveDefinition,
  context: Parameters<typeof moveEffectsForTrigger>[2],
  initialRoll: ReturnType<typeof convertedAttackRoll>,
  selectedAfterDefenseEffects: ReturnType<typeof moveEffectsForTrigger> | undefined,
  moveUseTriggered: ReturnType<typeof moveUseTriggeredEffects>,
  selectedMoveUseEffects: ReturnType<typeof moveEffectsForTrigger> | undefined,
  successfulEffectTriggered: ReturnType<typeof successfulEffectTriggeredEffects>,
) => {
  const ownEffects = completedConvertedAttackOwnEffects(
    move,
    context,
    initialRoll,
    selectedMoveUseEffects,
    successfulEffectTriggered,
  );
  return mergeMoveEffects(
    ownEffects,
    ...(selectedAfterDefenseEffects === undefined ? [] : [selectedAfterDefenseEffects]),
    ...moveUseTriggered.map(({ sourceMove, owner, effects: eventEffects }) =>
      effectsForActionWithMoveModificationPrevention(
        state,
        eventEffects,
        owner.id,
        sourceMove,
        context.self,
        context.opponent,
        move,
      ),
    ),
    ...successfulEffectTriggered.map(({ sourceMove, owner, effects: eventEffects }) =>
      effectsForActionWithMoveModificationPrevention(
        state,
        eventEffects,
        owner.id,
        sourceMove,
        context.self,
        context.opponent,
        move,
      ),
    ),
  );
};

const completedConvertedAttackOwnEffects = (
  move: MoveDefinition,
  context: Parameters<typeof moveEffectsForTrigger>[2],
  initialRoll: ReturnType<typeof convertedAttackRoll>,
  selectedMoveUseEffects: ReturnType<typeof moveEffectsForTrigger> | undefined,
  successfulEffectTriggered: ReturnType<typeof successfulEffectTriggeredEffects>,
) => {
  if (initialRoll.successfulHitCount === 0) return stoppedMoveEffects(move, context);
  if (
    negatesSelectedMoveUseEffects(selectedMoveUseEffects, move) ||
    triggeringMoveEffectsSuppressed(
      successfulEffectTriggered,
      context.self.id,
      context.opponent.id,
      move,
    )
  )
    return mergeMoveEffects();
  return successfulMoveEffects(move, context);
};

const successfulResourceEffectsForAttack = (
  move: MoveDefinition,
  context: ResolvedConvertedAttackEffectContext,
  damage: number,
  successfulEffectTriggered: ReturnType<typeof successfulEffectTriggeredEffects>,
  selectedMoveUseEffects: ReturnType<typeof moveEffectsForTrigger> | undefined,
  attackerId: CombatantId,
  targetId: CombatantId,
) =>
  negatesSelectedMoveUseEffects(selectedMoveUseEffects, move) ||
  triggeringMoveEffectsSuppressed(successfulEffectTriggered, attackerId, targetId, move)
    ? mergeMoveEffects()
    : successfulMoveEffects(move, { ...context, currentDamage: damage });

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

type ConvertedAttackEffectContext = ReturnType<typeof convertedAttackEffectContext>;
type ResolvedConvertedAttackEffectContext = ConvertedAttackEffectContext &
  Pick<
    MoveEffectRuntimeContext,
    "currentAction" | "rolls" | "paidKiCost" | "collectPendingChoices"
  >;

const criticalCompletedAttack = (
  input: CompleteConvertedAttackInput,
  initialRoll: ReturnType<typeof convertedAttackRoll>,
  effects: ReturnType<typeof completedConvertedAttackEffects>,
) =>
  initialRoll.critical ||
  hasCriticalCombatResultOverride(effects.combatResultOverrides) ||
  (input.enabledAfterDefenseEffectIndices !== undefined &&
    effects.combatResultOverrides.some(
      (application) =>
        application.result === "critical" && application.resultScope === "current-attack",
    ));

const selectedSuppressionEffect = (effect: EffectDefinition | undefined) =>
  effect?.type === "suppress" &&
  (effect.target === "self" || effect.target === "opponent") &&
  effect.selector !== undefined &&
  effect.aspects?.length === 1 &&
  effect.aspects[0] === "successful-effects" &&
  effect.duration?.type === "combat" &&
  effect.selectionLimit === 1 &&
  effect.scope === undefined &&
  effect.conditions === undefined &&
  effect.activationCost === undefined &&
  effect.useLimit === undefined &&
  effect.cooldown === undefined &&
  effect.stacking === undefined;

const selectedSuppressionEffectIndices = (move: MoveDefinition, effectIndices: readonly number[]) =>
  effectIndices.filter((effectIndex) => selectedSuppressionEffect(move.effects?.[effectIndex]));

const selectedSuppressionMoveCandidates = (
  state: ActiveFightState,
  frame: Pick<AwaitingEffectChoiceAttackFrame, "attackerId" | "targetCombatantId">,
  move: MoveDefinition,
  effectIndex: number,
) => {
  const effect = move.effects?.[effectIndex];
  if (
    !selectedSuppressionEffect(effect) ||
    effect?.type !== "suppress" ||
    effect.selector === undefined
  )
    return [];
  const selector = effect.selector;
  const target =
    effect.target === "self"
      ? state.combatants[frame.attackerId]
      : state.combatants[frame.targetCombatantId];
  return target.moveIds.filter((moveId) => {
    const candidate = MOVE_DEFINITIONS.find((definition) => definition.id === moveId);
    return candidate !== undefined && matchesMoveSelector(candidate, selector);
  });
};

const selectedSuppressionChoiceAvailable = (
  state: ActiveFightState,
  frame: Pick<AwaitingEffectChoiceAttackFrame, "attackerId" | "targetCombatantId">,
  move: MoveDefinition,
  effectIndices: readonly number[],
) =>
  selectedSuppressionEffectIndices(move, effectIndices).every(
    (effectIndex) => selectedSuppressionMoveCandidates(state, frame, move, effectIndex).length > 0,
  );

const pendingSuccessEffectChoiceTransition = (
  input: CompleteConvertedAttackInput,
  target: ActiveFightState["combatants"][CombatantId],
  move: MoveDefinition,
  initialRoll: ReturnType<typeof convertedAttackRoll>,
  resolvedEffectContext: ResolvedConvertedAttackEffectContext,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> | undefined => {
  if (initialRoll.successfulHitCount === 0) return undefined;
  const pendingSuccessChoices = successfulMoveEffects(move, {
    ...resolvedEffectContext,
    currentDamage: initialRoll.damage,
  }).pendingEffectChoices.filter(
    (choice) =>
      choice.effectIndices.length > 0 &&
      (selectedSuppressionEffectIndices(move, choice.effectIndices).length === 0 ||
        selectedSuppressionChoiceAvailable(
          input.state,
          { attackerId: input.decision.actorId, targetCombatantId: target.id },
          move,
          choice.effectIndices,
        )),
  );
  const pendingSuccessChoice = pendingSuccessChoices.find(() => true);
  if (pendingSuccessChoice === undefined) return undefined;
  const effectAlternatives =
    pendingSuccessChoice.activationGroup === undefined
      ? undefined
      : pendingSuccessChoices.filter(
          (choice) => choice.activationGroup === pendingSuccessChoice.activationGroup,
        );
  return requestAttackEffectChoice({
    state: input.state,
    decision: input.decision,
    target,
    move,
    effectIndices: pendingSuccessChoice.effectIndices,
    ...(effectAlternatives === undefined ? {} : { effectAlternatives }),
    numericSelection: pendingSuccessChoice.numericSelection,
    effectTrigger: "on-success",
    naturalRolls: initialRoll.rolls.map((roll) => ({
      attack: roll.attackNaturalResult,
      ...(roll.defenseNaturalResult === undefined ? {} : { defense: roll.defenseNaturalResult }),
    })),
    blockedDice: input.blockedDice,
    blockUsage: input.blockUsage,
    defenseItemUse: input.defenseItemUse,
    defenseResultModifier: input.defenseResultModifier,
    preventCritical: input.preventCritical,
    preventCounter: input.preventCounter,
    resultOverrides: input.resultOverrides,
    numericResultOverrides: input.numericResultOverrides,
    priorEnabledOptionalEffectIndices: input.enabledOptionalEffectIndices,
    priorResolvedOptionalEffectIndices: input.resolvedOptionalEffectIndices,
    enabledAfterDefenseEffectIndices: input.enabledAfterDefenseEffectIndices,
    includeRollEvents: false,
    rollEvents:
      input.includeRollEvents === false
        ? []
        : pendingConvertedAttackRollEvents(
            input.state,
            input.decision,
            target,
            move,
            initialRoll.rolls,
            dependencies,
          ),
    dependencies,
  });
};

const convertedAttackEffectContextForAction = (
  effectContext: ConvertedAttackEffectContext,
  input: CompleteConvertedAttackInput,
  move: MoveDefinition,
): ConvertedAttackEffectContext & Pick<MoveEffectRuntimeContext, "currentAction"> => ({
  ...effectContext,
  currentAction: {
    type: "use-move",
    decisionId: input.decision.id,
    actorId: input.decision.actorId,
    targetCombatantId: input.decision.targetCombatantId,
    moveId: move.id,
    turnNumber: input.state.turnNumber,
    phase: input.state.phase === "counter" ? "counter" : "action",
  },
  ...(input.selectedNumericValues === undefined
    ? {}
    : { selectedNumericValues: input.selectedNumericValues }),
  ...(input.enabledOptionalEffectIndices === undefined
    ? {}
    : { enabledOptionalEffectIndices: input.enabledOptionalEffectIndices }),
  ...(input.resolvedOptionalEffectIndices === undefined
    ? {}
    : { resolvedOptionalEffectIndices: input.resolvedOptionalEffectIndices }),
  ...(input.selectedSuppressionMoves === undefined
    ? {}
    : {
        selectedSuppressionMoveIds: Object.fromEntries(
          input.selectedSuppressionMoves.map(({ effectIndex, moveId }) => [effectIndex, moveId]),
        ),
      }),
  ...(input.defenseResponse === undefined ? {} : { defenseResponse: input.defenseResponse }),
});

const convertedAttackCostForInput = (
  input: CompleteConvertedAttackInput,
  state: ActiveFightState,
  attacker: ActiveFightState["combatants"][CombatantId],
  move: MoveDefinition,
  baseCost: number,
  beforeAttackEffects: ReturnType<typeof moveEffectsForTrigger>,
) =>
  input.deferredExecution === undefined
    ? convertedAttackCost(
        state,
        attacker,
        move,
        baseCost,
        currentActionCostModificationsForAttack(
          beforeAttackEffects,
          input.selectedCostModifications,
        ),
      )
    : 0;

const initialRollInputFor = (
  input: CompleteConvertedAttackInput,
  attacker: ActiveFightState["combatants"][CombatantId],
) =>
  input.deferredExecution?.damageOverridePercent === undefined
    ? input
    : {
        ...input,
        baseDamageOverride: Math.round(
          (attacker.stats.power * input.deferredExecution.damageOverridePercent) / 100,
        ),
      };

const deferredContextFieldsFor = (input: CompleteConvertedAttackInput) =>
  input.deferredExecution === undefined
    ? {}
    : {
        deferredEffectId: input.deferredExecution.activeEffectId,
        deferredDecisionId: input.deferredExecution.declarationDecisionId,
      };

/* eslint-disable sonarjs/cognitive-complexity -- attack completion preserves deterministic effect and resource ordering. */
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
  const effectContext = convertedAttackEffectContext(
    state,
    attacker,
    target,
    move,
    activationUnavailableSelectorsFor(state, attacker, target, move),
  );
  const attackEffectContext = convertedAttackEffectContextForAction(effectContext, input, move);
  const beforeAttackEffects = moveEffectsForTrigger(
    move,
    "before-attack-roll",
    attackEffectContext,
  );
  const passiveAttackEffects = moveEffectsForTrigger(move, "passive", attackEffectContext);
  const cost = convertedAttackCostForInput(
    input,
    state,
    attacker,
    move,
    baseCost.value,
    beforeAttackEffects,
  );
  const initialRoll = convertedAttackRoll(
    initialRollInputFor(input, attacker),
    attack,
    attackEffectContext,
  );
  const initialCurrentAction = convertedAttackActionRecord(state, decision, initialRoll);
  const resolvedEffectContext = {
    ...attackEffectContext,
    successfulHitCount: initialRoll.successfulHitCount,
    rolls: initialRoll.rolls,
    paidKiCost: cost,
    currentAction: currentActionForEffectContext(initialCurrentAction),
    collectPendingChoices: true,
  };
  const rollResultTriggered = rollResultTriggeredEffects(
    attacker,
    target,
    move,
    resolvedEffectContext,
  );
  const rollModificationTriggered =
    initialRoll.rollModification === undefined
      ? []
      : rollModificationTriggeredEffects(attacker, target, move, {
          ...resolvedEffectContext,
          rollModification: initialRoll.rollModification,
        });
  const pendingRollModificationChoice = rollModificationTriggered
    .flatMap(({ sourceMove, owner, effects: eventEffects }) =>
      eventEffects.pendingEffectChoices.map((choice) => ({ sourceMove, owner, choice })),
    )
    .find(({ sourceMove, owner, choice }) => {
      const opponent = owner.id === attacker.id ? target : attacker;
      const selected = moveEffectsForTrigger(sourceMove, "on-roll-modified", {
        ...resolvedEffectContext,
        self: owner,
        opponent,
        sourceDefinitionId: sourceMove.id,
        rollModification: initialRoll.rollModification,
        enabledOptionalEffectIndices: choice.effectIndices,
      });
      let ki = owner.ki.current;
      for (const resource of selected.resources) {
        if (resource.resource !== "ki" || resource.operation !== "lose") continue;
        ki -= resource.amount;
      }
      return ki >= 0;
    });
  if (pendingRollModificationChoice !== undefined) {
    const { sourceMove, owner, choice } = pendingRollModificationChoice;
    return requestAttackEffectChoice({
      state: input.state,
      decision: input.decision,
      target,
      move,
      effectIndices: choice.effectIndices,
      numericSelection: choice.numericSelection,
      effectSourceDefinitionId: sourceMove.id,
      effectSourceCombatantId: owner.id,
      effectTrigger: "on-roll-modified",
      choiceCombatantId: owner.id,
      naturalRolls: initialRoll.rolls.map((roll) => ({
        attack: roll.attackNaturalResult,
        ...(roll.defenseNaturalResult === undefined ? {} : { defense: roll.defenseNaturalResult }),
      })),
      blockedDice: input.blockedDice,
      blockUsage: input.blockUsage,
      defenseItemUse: input.defenseItemUse,
      defenseResultModifier: input.defenseResultModifier,
      preventCritical: input.preventCritical,
      preventCounter: input.preventCounter,
      resultOverrides: input.resultOverrides,
      numericResultOverrides: input.numericResultOverrides,
      priorEnabledOptionalEffectIndices: input.enabledOptionalEffectIndices,
      priorResolvedOptionalEffectIndices: input.resolvedOptionalEffectIndices,
      enabledAfterDefenseEffectIndices: input.enabledAfterDefenseEffectIndices,
      includeRollEvents: false,
      rollEvents:
        input.includeRollEvents === false
          ? []
          : pendingConvertedAttackRollEvents(
              input.state,
              input.decision,
              target,
              move,
              initialRoll.rolls,
              dependencies,
            ),
      dependencies,
    });
  }
  const beforeDefenseEffects = moveEffectsForTrigger(
    move,
    "before-defense-roll",
    resolvedEffectContext,
  );
  const resolvedOwnEffectContext = {
    ...resolvedEffectContext,
    resolutionSuppressions: beforeDefenseEffects.suppressions,
  };
  const pendingSuccessTransition = pendingSuccessEffectChoiceTransition(
    input,
    target,
    move,
    initialRoll,
    resolvedOwnEffectContext,
    dependencies,
  );
  if (pendingSuccessTransition !== undefined) return pendingSuccessTransition;
  const selectedAfterDefenseEffects = selectedAfterDefenseEffectsForResolution(
    input,
    move,
    resolvedEffectContext,
  );
  const moveUseTriggered = moveUseTriggeredEffects(state, attacker, target, move);
  const successfulEffectTriggered = successfulEffectTriggeredEffects(
    state,
    attacker,
    target,
    move,
    resolvedEffectContext,
  );
  const stoppedSkillTriggered = stoppedSkillEffectsForResolution(
    initialRoll,
    state,
    attacker,
    target,
    move,
    resolvedEffectContext,
  );
  const completedEffects = completedConvertedAttackEffects(
    state,
    move,
    resolvedOwnEffectContext,
    initialRoll,
    selectedAfterDefenseEffects,
    moveUseTriggered,
    input.selectedMoveUseEffects,
    successfulEffectTriggered,
  );
  const selectedDamageTarget = selectedDamageTargetFor(move, target);
  const completedEffectsWithoutSelectedDamageTarget =
    selectedDamageTarget === undefined
      ? completedEffects
      : {
          ...completedEffects,
          damageModifications: completedEffects.damageModifications.filter(
            (modification) =>
              !(
                modification.sourceDefinitionId === move.id &&
                modification.effectIndex === selectedDamageTarget.effectIndex
              ),
          ),
        };
  const completedEffectsWithRollResultFloatingEffects = {
    ...completedEffectsWithoutSelectedDamageTarget,
    floatingEffects: [
      ...completedEffectsWithoutSelectedDamageTarget.floatingEffects,
      ...initialRoll.onRollResultFloatingEffects,
    ],
  };
  const onRollResultExtraActions = [
    ...moveEffectsForTrigger(move, "on-roll-result", resolvedEffectContext).extraActions,
    ...activeConstantOnRollResultExtraActions(state, attacker, target, move, resolvedEffectContext),
  ];
  const onRollResultActivations = activeConstantOnRollResultActivations(
    state,
    attacker,
    target,
    move,
    resolvedEffectContext,
  );
  const effectsWithStoppedSkills = mergeMoveEffects(
    completedEffectsWithRollResultFloatingEffects,
    ...stoppedSkillTriggered.map(({ sourceMove, owner, effects: eventEffects }) =>
      effectsForActionWithMoveModificationPrevention(
        state,
        eventEffects,
        owner.id,
        sourceMove,
        attacker,
        target,
        move,
      ),
    ),
  );
  const effectsWithSelectedMoveUse = mergeMoveEffects(
    effectsWithStoppedSkills,
    input.selectedMoveUseEffects ?? mergeMoveEffects(),
  );
  const effects = {
    ...effectsWithSelectedMoveUse,
    extraActions: [...effectsWithSelectedMoveUse.extraActions, ...onRollResultExtraActions],
  };
  const automaticCounter = automaticCounterActionResolution(
    input,
    target,
    successfulEffectTriggered,
  );
  const { application: automaticCounterAction, counterAction: resolvedCounterAction } =
    automaticCounter;
  const critical = criticalCompletedAttack(input, initialRoll, effects);
  const currentAction = convertedAttackActionRecord(state, decision, initialRoll, critical);
  const damageEffectContext = {
    ...resolvedEffectContext,
    currentAction: currentActionForEffectContext(currentAction),
  };
  const baseDamage =
    critical && !initialRoll.critical ? initialRoll.damage * 2 : initialRoll.damage;
  const damageBeforeOnDamage = applyDamageModifications(
    input.preventDamage === true ? 0 : baseDamage,
    initialRoll.successfulHitCount > 0
      ? effects.damageModifications.filter(
          (modification) =>
            modification.target === "self" &&
            (modification.scope === undefined || modification.scope === "current-action"),
        )
      : [],
    move,
  );
  const pendingDamageTransition = pendingDefensiveOnDamageTransition(
    input,
    attacker,
    target,
    move,
    damageEffectContext,
    damageBeforeOnDamage,
    initialRoll,
    dependencies,
  );
  if (pendingDamageTransition !== undefined) return pendingDamageTransition;
  const defensiveDamageModifications = [
    ...(input.selectedBeforeDefenseDamageModifications ?? []),
    ...defensiveOnDamageModificationsForAttack(
      input,
      attacker,
      target,
      move,
      damageEffectContext,
      damageBeforeOnDamage,
      initialRoll,
    ),
  ];
  const defensiveActivationCosts: ResourceChange[] = defensiveDamageModifications.flatMap(
    (modification) =>
      modification.activationCost === undefined
        ? []
        : [
            {
              resource: modification.activationCost.resource,
              target: "opponent" as const,
              operation: "lose" as const,
              amount: modification.activationCost.amount,
              sourceCombatantId: target.id,
              sourceEffectIndex: modification.effectIndex,
              cause: "non-damage-effect" as const,
            },
          ],
  );
  const damageBeforeTargetCap = applyDamageModifications(
    damageBeforeOnDamage,
    defensiveDamageModifications,
    move,
  );
  const selectedOnDamageEffects = selectedDefensiveOnDamageEffects(
    state,
    attacker,
    target,
    move,
    damageEffectContext,
    Math.max(0, damageBeforeTargetCap),
    input.damageEffectSourceDefinitionId,
    input.damageEffectIndices,
  );
  const roll = {
    ...initialRoll,
    critical,
    damage: Math.min(target.hitPoints.current, damageBeforeTargetCap),
  };
  const resolvedBlockUsage =
    blockUsage === undefined
      ? undefined
      : {
          ...blockUsage,
          effects: resolvedBlockEffects(
            state,
            blockUsage.block,
            blockUsage.defender,
            attacker,
            roll.damage,
            move,
            undefined,
            currentBlockActionFor(
              state,
              blockUsage.block,
              blockUsage.response.id,
              blockUsage.defender.id,
              attacker.id,
            ),
          ),
        };
  const resourceEffects = mergeMoveEffects(
    ...(initialRoll.successfulHitCount > 0
      ? [
          successfulResourceEffectsForAttack(
            move,
            resolvedOwnEffectContext,
            roll.damage,
            successfulEffectTriggered,
            input.selectedMoveUseEffects,
            attacker.id,
            target.id,
          ),
          ...moveUseTriggered.map(({ sourceMove, owner, effects: eventEffects }) =>
            effectsForActionWithMoveModificationPrevention(
              state,
              eventEffects,
              owner.id,
              sourceMove,
              attacker,
              target,
              move,
            ),
          ),
          ...successfulEffectTriggered.map(({ sourceMove, owner, effects: eventEffects }) =>
            effectsForActionWithMoveModificationPrevention(
              state,
              eventEffects,
              owner.id,
              sourceMove,
              attacker,
              target,
              move,
            ),
          ),
          selectedOnDamageEffects,
        ]
      : [effects, selectedOnDamageEffects]),
    ...rollResultTriggered.map(({ sourceMove, owner, effects: eventEffects }) =>
      effectsForActionWithMoveModificationPrevention(
        state,
        eventEffects,
        owner.id,
        sourceMove,
        attacker,
        target,
        move,
      ),
    ),
    ...rollModificationTriggered.map(({ sourceMove, owner, effects: eventEffects }) =>
      effectsForActionWithMoveModificationPrevention(
        state,
        eventEffects,
        owner.id,
        sourceMove,
        attacker,
        target,
        move,
      ),
    ),
  );
  const remainingHitPoints = Math.max(0, target.hitPoints.current - roll.damage);
  const afterDefenseEffects = passiveAfterDefenseEffects(
    state,
    attacker,
    target,
    move,
    resolvedEffectContext,
  );
  const unpreventedResourceChanges = resourceChangesAfterActiveResourceModifierTransformers(
    state,
    attacker,
    move,
    [
      ...resourceChangesAfterActiveResourceCostModifiers(
        state,
        attacker,
        move,
        beforeAttackEffects.resources,
        passiveAttackEffects.resourceCostModifications,
      ),
      ...afterDefenseEffects.resources,
      ...resourceEffects.resources,
      ...resourceCostActivationChanges(
        resourceEffects.resourceCostModifications ?? [],
        attacker.id,
        target.id,
      ),
      ...(input.selectedBeforeDefenseEffects === undefined ||
      input.selectedBeforeDefenseSourceDefinitionId === undefined
        ? []
        : effectsRelativeToActionActor(input.selectedBeforeDefenseEffects, target.id, attacker.id)
            .resources),
      ...extraActionActivationChanges(resourceEffects.extraActions, attacker.id),
      ...activeNextActionResourceChanges(state, attacker, move, roll.damage),
      ...selectedCostActivationResourceChanges(input),
      ...selectedMoveUseActivationChanges(
        input.selectedMoveUseEffects,
        attacker,
        input.selectedMoveUseEffectOwnerId,
      ),
      ...defensiveActivationCosts,
      ...automaticCounter.activationChanges,
    ],
  );
  const baseResourceChanges = resourceChangesAfterPreventions(
    attacker,
    target,
    unpreventedResourceChanges,
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
    [...state.actionHistory, currentAction],
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
  const { counterChainLimitReached, counterContinues } = counterContinuationState(
    state,
    roll.counter,
    resolvedCounterAction,
    defeated,
  );
  const context: ConvertedAttackMoveContext = {
    activatedEffects: [
      ...(input.selectedBeforeDefenseEffects === undefined ||
      input.selectedBeforeDefenseSourceDefinitionId === undefined
        ? []
        : (() => {
            const sourceMove = MOVE_DEFINITIONS.find(
              (candidate) => candidate.id === input.selectedBeforeDefenseSourceDefinitionId,
            );
            return sourceMove === undefined
              ? []
              : convertedAttackActivatedEffects({
                  state,
                  dependencies,
                  attacker: target,
                  target: attacker,
                  move: sourceMove,
                  createdOnTurn: state.turnNumber,
                  effects: input.selectedBeforeDefenseEffects,
                  defeated,
                });
          })()),
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
        effects: {
          ...completedEffectsWithRollResultFloatingEffects,
          extraActions: [
            ...completedEffectsWithRollResultFloatingEffects.extraActions,
            ...onRollResultExtraActions,
          ],
          locks: [
            ...afterDefenseEffects.locks,
            ...completedEffectsWithRollResultFloatingEffects.locks,
          ],
        },
        defeated,
      }),
      ...(resolvedBlockUsage?.effects === undefined
        ? []
        : activeCombatResultEffectsFromApplications(
            resolvedBlockUsage.effects.combatResultOverrides,
            resolvedBlockUsage.defender.id,
            attacker.id,
            resolvedBlockUsage.block.id,
            dependencies,
          )),
      ...(resolvedBlockUsage?.effects === undefined
        ? []
        : activeFloatingEffectsFromApplications(
            resolvedBlockUsage.effects.floatingEffects,
            resolvedBlockUsage.defender.id,
            attacker.id,
            resolvedBlockUsage.block.id,
            state.turnNumber,
            dependencies,
          )),
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
      ...stoppedSkillTriggered.flatMap(
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
    damageModifications: defensiveDamageModifications,
    activations: [...effects.activations, ...eventEffects.activations, ...onRollResultActivations],
    deactivations: [...effects.deactivations, ...eventEffects.deactivations],
    moveUsePreventions: [...effects.moveUsePreventions, ...eventEffects.moveUsePreventions],
    remainingUseModifications: [
      ...effects.remainingUseModifications,
      ...eventEffects.remainingUseModifications,
    ],
    statusPreventions: [...effects.statusPreventions, ...eventEffects.statusPreventions],
    defeated,
    counterChainLimitReached,
    counterContinues,
    ...(resolvedCounterAction === undefined ? {} : { counterAction: resolvedCounterAction }),
    statusApplications: [
      ...afterDefenseEffects.statuses,
      ...effects.statuses,
      ...eventEffects.statuses,
    ].filter(
      (application) =>
        !(
          input.preventStun === true &&
          application.target === "opponent" &&
          application.status.statusId === "stun"
        ) &&
        !defenseItemPreventsStatus(
          defenseItemUse,
          application.target,
          application.status.statusId,
        ) &&
        statusPreventionFor(
          state,
          application.target === "self" ? attacker.id : target.id,
          application.status.statusId,
        ) === undefined,
    ),
    transformationReversions: [
      ...afterDefenseEffects.transformationReversions,
      ...effects.transformationReversions,
      ...eventEffects.transformationReversions,
    ],
    transformationActions: [
      ...effects.transformationActions,
      ...eventEffects.transformationActions,
    ],
    triggeredSkillMoveIds: stoppedSkillTriggered.map(({ sourceMove }) => sourceMove.id),
    triggeredEffectUses: triggeredNegationEffectUses(
      successfulEffectTriggered,
      attacker.id,
      target.id,
      move,
    ).concat(automaticCounterEffectUses(automaticCounterAction, target.id)),
    ...(resolvedBlockUsage === undefined ? {} : { blockUsage: resolvedBlockUsage }),
    ...(defenseItemUse === undefined ? {} : { defenseItemUse }),
    ...(includeRollEvents === undefined ? {} : { includeRollEvents }),
    ...deferredContextFieldsFor(input),
  };
  const events = createConvertedAttackMoveEvents(state, decision, dependencies, context);
  const nextState = createConvertedAttackMoveState(
    state,
    decision,
    dependencies,
    context,
    events.length,
  );
  return finishConvertedAttackMove({
    decision,
    move,
    dependencies,
    attacker,
    target,
    context,
    initialRoll,
    nextState,
    events,
  });
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

const selectedCostModificationsFor = (
  state: ActiveFightState,
  attacker: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId] | undefined,
  move: MoveDefinition,
  sourceDefinitionId: MoveId | undefined,
  effectIndices: readonly number[] | undefined,
  trigger: CostEffectTrigger,
) =>
  target === undefined || sourceDefinitionId === undefined || effectIndices === undefined
    ? undefined
    : costEffectModificationsFor(
        state,
        attacker,
        target,
        move,
        sourceDefinitionId,
        effectIndices,
        trigger,
      );

const selectedMoveUseEffectsForAttack = (
  state: ActiveFightState,
  actor: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId] | undefined,
  move: MoveDefinition,
  sourceDefinitionId: MoveId | undefined,
  effectIndices: readonly number[] | undefined,
  sourceCombatantId: CombatantId = actor.id,
) => {
  if (target === undefined || sourceDefinitionId === undefined || effectIndices === undefined)
    return undefined;
  const sourceOwner = state.combatants[sourceCombatantId];
  const source =
    sourceCombatantId === actor.id
      ? moveUseListenerMoves(state, actor, move).find(
          ({ sourceMove }) => sourceMove.id === sourceDefinitionId,
        )
      : moveUseListenerMovesForCombatant(state, sourceOwner).find(
          ({ sourceMove }) => sourceMove.id === sourceDefinitionId,
        );
  if (source === undefined) return undefined;
  const sourceTarget = sourceCombatantId === actor.id ? target : actor;
  const effects = moveEffectsForTrigger(
    source.sourceMove,
    "on-move-use",
    costEffectContext(state, sourceOwner, sourceTarget, move, source.moves, false, effectIndices),
  );
  return sourceCombatantId === actor.id
    ? effects
    : effectsRelativeToActionActor(effects, sourceCombatantId, actor.id);
};

const selectedMoveUseActivationCostAvailable = (
  owner: ActiveFightState["combatants"][CombatantId],
  effects: ReturnType<typeof moveEffectsForTrigger> | undefined,
) =>
  effects?.negations.every((negation) => {
    const cost = negation.activationCost;
    if (cost === undefined) return true;
    const current = cost.resource === "hp" ? owner.hitPoints.current : owner.ki.current;
    return current - cost.amount >= (cost.minimum ?? 0);
  }) ?? false;

const selectedMoveUseActivationChanges = (
  effects: ReturnType<typeof moveEffectsForTrigger> | undefined,
  actor: ActiveFightState["combatants"][CombatantId],
  sourceCombatantId: CombatantId = actor.id,
) => {
  const costs = [
    ...(effects?.damageModifications ?? []).flatMap((candidate) =>
      candidate.activationCost === undefined
        ? []
        : [{ cost: candidate.activationCost, sourceEffectIndex: candidate.effectIndex }],
    ),
    ...(effects?.negations ?? []).flatMap((candidate) =>
      candidate.activationCost === undefined
        ? []
        : [{ cost: candidate.activationCost, sourceEffectIndex: candidate.sourceEffectIndex }],
    ),
  ];
  return costs.map(({ cost, sourceEffectIndex }) => ({
    resource: cost.resource,
    target: sourceCombatantId === actor.id ? ("self" as const) : ("opponent" as const),
    operation: "lose" as const,
    amount: cost.amount,
    sourceCombatantId,
    ...(sourceEffectIndex === undefined ? {} : { sourceEffectIndex }),
    cause: "non-damage-effect" as const,
  }));
};

const pendingCostModifiedEffectChoice = (
  state: ActiveFightState,
  actor: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  move: MoveDefinition,
  existingModifications: readonly CurrentActionCostModification[],
  resolvedSourceDefinitionId: MoveId | undefined,
  resolvedEffectIndices: readonly number[] | undefined,
) => {
  if (!existingModifications.some((modification) => modification.target === "self"))
    return undefined;
  return pendingCostEffectChoice(
    state,
    actor,
    target,
    move,
    "on-cost-modified",
    resolvedSourceDefinitionId,
    resolvedEffectIndices,
  );
};

const pendingMoveUseCostChoiceTransition = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  attacker: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId] | undefined,
  move: MoveDefinition,
  dependencies: CombatDependencies,
) => {
  if (target === undefined) return undefined;
  const pendingCostChoice = pendingCostEffectChoice(state, attacker, target, move, "on-move-use");
  return pendingCostChoice === undefined
    ? undefined
    : requestAttackEffectChoice({
        state,
        decision,
        target,
        move,
        effectIndices: pendingCostChoice.choice.effectIndices,
        effectAlternatives: pendingCostChoice.alternatives,
        effectSourceDefinitionId: pendingCostChoice.sourceMove.id,
        effectTrigger: "on-move-use",
        numericSelection: pendingCostChoice.choice.numericSelection,
        dependencies,
      });
};

const pendingUnselectedMoveUseCostChoiceTransition = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  attacker: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId] | undefined,
  move: MoveDefinition,
  sourceDefinitionId: MoveId | undefined,
  effectIndices: readonly number[] | undefined,
  dependencies: CombatDependencies,
) =>
  sourceDefinitionId === undefined && effectIndices === undefined
    ? pendingMoveUseCostChoiceTransition(state, decision, attacker, target, move, dependencies)
    : undefined;

const pendingMoveUseNegationForAttack = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  attacker: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId] | undefined,
  move: MoveDefinition,
  dependencies: CombatDependencies,
  enabledOptionalEffectIndices: readonly number[] | undefined,
  costEffectOwnerId: CombatantId | undefined,
) =>
  enabledOptionalEffectIndices === undefined && costEffectOwnerId === undefined
    ? pendingMoveUseNegationChoiceTransition(state, decision, attacker, target, move, dependencies)
    : undefined;

const pendingMoveUseNegationChoiceTransition = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  attacker: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId] | undefined,
  move: MoveDefinition,
  dependencies: CombatDependencies,
) => {
  if (target === undefined) return undefined;
  const pending = moveUseTriggeredEffects(state, attacker, target, move, {
    collectPendingChoices: true,
  })
    .flatMap(({ sourceMove, owner, effects }) =>
      effects.pendingEffectChoices
        .filter((choice) =>
          choice.effectIndices.some(
            (effectIndex) => sourceMove.effects?.[effectIndex]?.type === "negate",
          ),
        )
        .map((choice) => ({ sourceMove, owner, choice })),
    )
    .find(({ sourceMove, owner, choice }) => {
      const selected = selectedMoveUseEffectsForAttack(
        state,
        attacker,
        target,
        move,
        sourceMove.id,
        choice.effectIndices,
        owner.id,
      );
      return (
        selected?.negations.some((negation) => negation.activationCost !== undefined) === true &&
        selectedMoveUseActivationCostAvailable(owner, selected)
      );
    });
  return pending === undefined
    ? undefined
    : requestAttackEffectChoice({
        state,
        decision,
        target,
        move,
        effectIndices: pending.choice.effectIndices,
        effectSourceDefinitionId: pending.sourceMove.id,
        effectSourceCombatantId: pending.owner.id,
        effectTrigger: "on-move-use",
        choiceCombatantId: pending.owner.id,
        numericSelection: pending.choice.numericSelection,
        dependencies,
      });
};

const pendingCostModifiedChoiceTransition = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  attacker: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId] | undefined,
  move: MoveDefinition,
  existingModifications: readonly CurrentActionCostModification[],
  resolvedSourceDefinitionId: MoveId | undefined,
  resolvedEffectIndices: readonly number[] | undefined,
  dependencies: CombatDependencies,
) => {
  if (target === undefined) return undefined;
  const pendingChoice = pendingCostModifiedEffectChoice(
    state,
    attacker,
    target,
    move,
    existingModifications,
    resolvedSourceDefinitionId,
    resolvedEffectIndices,
  );
  return pendingChoice === undefined
    ? undefined
    : requestAttackEffectChoice({
        state,
        decision,
        target,
        move,
        effectIndices: pendingChoice.choice.effectIndices,
        effectAlternatives: pendingChoice.alternatives,
        effectSourceDefinitionId: pendingChoice.sourceMove.id,
        effectTrigger: "on-cost-modified",
        numericSelection: pendingChoice.choice.numericSelection,
        dependencies,
      });
};

const selectedBeforeAttackEffectsForResolution = (
  state: ActiveFightState,
  attacker: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId] | undefined,
  move: MoveDefinition,
  enabledOptionalEffectIndices: readonly number[] | undefined,
  resolvedOptionalEffectIndices: readonly number[] | undefined,
  selectedNumericValues: Readonly<Record<string, number>> | undefined,
) =>
  target === undefined || enabledOptionalEffectIndices === undefined
    ? undefined
    : moveEffectsForTrigger(move, "before-attack-roll", {
        ...convertedAttackEffectContext(state, attacker, target, move),
        enabledOptionalEffectIndices,
        ...(selectedNumericValues === undefined ? {} : { selectedNumericValues }),
        ...(resolvedOptionalEffectIndices === undefined ? {} : { resolvedOptionalEffectIndices }),
      });

const pendingMoveUseCostChoiceForAttack = ({
  state,
  decision,
  attacker,
  target,
  move,
  costEffectTrigger,
  costEffectSourceDefinitionId,
  costEffectIndices,
  dependencies,
}: {
  readonly state: ActiveFightState;
  readonly decision: Extract<CombatDecision, { readonly type: "use-move" }>;
  readonly attacker: CombatantState;
  readonly target: CombatantState | undefined;
  readonly move: MoveDefinition;
  readonly costEffectTrigger: CostEffectTrigger | undefined;
  readonly costEffectSourceDefinitionId: MoveId | undefined;
  readonly costEffectIndices: readonly number[] | undefined;
  readonly dependencies: CombatDependencies;
}) =>
  costEffectTrigger === "on-move-use"
    ? pendingUnselectedMoveUseCostChoiceTransition(
        state,
        decision,
        attacker,
        target,
        move,
        costEffectSourceDefinitionId,
        costEffectIndices,
        dependencies,
      )
    : undefined;

const selectedMoveUseEffectsForResolution = ({
  state,
  attacker,
  target,
  move,
  costEffectTrigger,
  costEffectSourceDefinitionId,
  costEffectIndices,
  costEffectOwnerId,
}: {
  readonly state: ActiveFightState;
  readonly attacker: CombatantState;
  readonly target: CombatantState;
  readonly move: MoveDefinition;
  readonly costEffectTrigger: CostEffectTrigger | undefined;
  readonly costEffectSourceDefinitionId: MoveId | undefined;
  readonly costEffectIndices: readonly number[] | undefined;
  readonly costEffectOwnerId: CombatantId | undefined;
}) =>
  costEffectTrigger === "on-move-use"
    ? selectedMoveUseEffectsForAttack(
        state,
        attacker,
        target,
        move,
        costEffectSourceDefinitionId,
        costEffectIndices,
        costEffectOwnerId,
      )
    : undefined;

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
    preventCritical,
    preventCounter,
    preventStun,
    includeRollEvents,
    naturalRolls,
    resultOverrides,
    numericResultOverrides,
    enabledOptionalEffectIndices,
    resolvedOptionalEffectIndices,
    costEffectSourceDefinitionId,
    costEffectIndices,
    costEffectTrigger,
    costEffectOwnerId,
    damageEffectSourceDefinitionId,
    damageEffectIndices,
    enabledAfterDefenseEffectIndices,
    selectedNumericValues,
    selectedSuppressionMoves,
    defenseResponse,
    baseDamageOverride,
    copiedFromMoveId,
    copiedSourceMove,
    copiedDamageBonusPercent,
    copiedDamageOverride,
    copiedSuccessfulEffectsOnly,
    copiedSourceResolution,
    counterAction,
    counterActionActivationCostPaid,
    deferMoveChoice,
    deferredExecution,
  }: AttackResolutionOptions = {},
): CombatResult<CombatTransition> => {
  const attacker = state.combatants[decision.actorId];
  const target = activeOpponent(state, attacker.id, decision.targetCombatantId);
  const pendingMoveUseNegation = pendingMoveUseNegationForAttack(
    state,
    decision,
    attacker,
    target,
    move,
    dependencies,
    enabledOptionalEffectIndices,
    costEffectOwnerId,
  );
  if (pendingMoveUseNegation !== undefined) return pendingMoveUseNegation;
  const resolvedCostEffectTrigger = costEffectTrigger ?? "on-move-use";
  const selectedCostModifications = selectedCostModificationsFor(
    state,
    attacker,
    target,
    move,
    costEffectSourceDefinitionId,
    costEffectIndices,
    resolvedCostEffectTrigger,
  );
  const pendingCostChoice = pendingMoveUseCostChoiceForAttack({
    state,
    decision,
    attacker,
    target,
    move,
    costEffectTrigger: resolvedCostEffectTrigger,
    costEffectSourceDefinitionId,
    costEffectIndices,
    dependencies,
  });
  if (pendingCostChoice !== undefined) return pendingCostChoice;
  if (target === undefined) throw new Error("Validated attack moves require an active target.");
  const deferredDefinition = deferredMoveDefinitionFor(move);
  const deferredDeclaration = deferredMoveDeclarationTransition(
    state,
    decision,
    move,
    deferredDefinition,
    deferMoveChoice,
    deferredExecution,
    dependencies,
  );
  if (deferredDeclaration !== undefined) return deferredDeclaration;
  const selectedMoveUseEffects = selectedMoveUseEffectsForResolution({
    state,
    attacker,
    target,
    move,
    costEffectTrigger,
    costEffectSourceDefinitionId,
    costEffectIndices,
    costEffectOwnerId,
  });
  const selectedBeforeAttackEffects = selectedBeforeAttackEffectsForResolution(
    state,
    attacker,
    target,
    move,
    enabledOptionalEffectIndices,
    resolvedOptionalEffectIndices,
    selectedNumericValues,
  );
  const passiveContext = {
    self: attacker,
    opponent: target,
    turnNumber: state.turnNumber,
    completedTurnCount: state.turnNumber - 1,
    moves: new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate])),
    moveActivationCounts: moveActivationCounts(state),
    successfulHitCount: 1,
    actionHistory: state.actionHistory,
    activeEffects: state.activeEffects,
    mode: state.mode,
  };
  const classification = classifyCurrentActionMove(move, passiveContext);
  const classifiedMove = classification.move;
  const passiveEffects = moveEffectsForTrigger(classifiedMove, "passive", passiveContext);
  const preventsBlock =
    passiveEffects.resolutionPreventions.some(
      (effect: ResolutionPreventionApplication) =>
        effect.target === "self" && effect.prevention === "block",
    ) ||
    (selectedMoveUseEffects?.resolutionPreventions.some(
      (effect) => effect.target === "self" && effect.prevention === "block",
    ) ??
      false);
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
  const beforeAttackEffectsForCost =
    selectedBeforeAttackEffects ??
    moveEffectsForTrigger(move, "before-attack-roll", {
      ...convertedAttackEffectContext(state, attacker, target, move),
      collectPendingChoices: true,
    });
  const pendingCostModifiedChoice = pendingCostModifiedChoiceTransition(
    state,
    decision,
    attacker,
    target,
    move,
    [
      ...currentActionCostModifiersFor(state, attacker.id, move),
      ...(beforeAttackEffectsForCost?.currentActionCostModifications ?? []),
      ...(selectedCostModifications ?? []),
    ],
    costEffectSourceDefinitionId,
    costEffectIndices,
    dependencies,
  );
  if (pendingCostModifiedChoice !== undefined) return pendingCostModifiedChoice;
  const failure = convertedAttackMoveFailure(
    state,
    decision,
    move,
    attacker,
    target,
    [
      ...(beforeAttackEffectsForCost?.currentActionCostModifications ?? []),
      ...(selectedCostModifications ?? []),
    ],
    deferredMoveCostOverrideFor(deferredExecution, copiedSourceResolution),
    deferredExecution !== undefined,
  );
  if (failure !== undefined) return { ok: false, error: failure };
  if (shouldRequestMoveDefense(state, target, classifiedMove, blockableAttack, requestDefense)) {
    return requestAttackDefense({
      state,
      decision,
      target,
      attack: copiedMoveAttackReference(
        move.id,
        copiedFromMoveId,
        copiedDamageBonusPercent,
        copiedSourceMove,
        copiedDamageOverride,
        copiedSuccessfulEffectsOnly,
        copiedSourceResolution,
      ),
      blockableAttack,
      preventBlock: preventsBlock,
      enabledOptionalEffectIndices,
      resolvedOptionalEffectIndices,
      costEffectSourceDefinitionId,
      costEffectIndices,
      costEffectTrigger,
      costEffectOwnerId,
      deferredExecution,
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
    preventCritical,
    preventCounter,
    preventStun,
    includeRollEvents,
    naturalRolls,
    resultOverrides,
    numericResultOverrides,
    enabledOptionalEffectIndices,
    resolvedOptionalEffectIndices,
    selectedCostModifications,
    selectedMoveUseEffects,
    ...(costEffectOwnerId === undefined ? {} : { selectedMoveUseEffectOwnerId: costEffectOwnerId }),
    baseDamageOverride,
    copiedSourceResolution,
    damageEffectSourceDefinitionId,
    damageEffectIndices,
    enabledAfterDefenseEffectIndices,
    ...(selectedNumericValues === undefined ? {} : { selectedNumericValues }),
    ...selectedSuppressionMovesOption(selectedSuppressionMoves),
    ...(counterAction === undefined ? {} : { counterAction }),
    ...(counterActionActivationCostPaid === undefined ? {} : { counterActionActivationCostPaid }),
    ...deferredExecutionOptionFor(deferredExecution),
    defenseResponse: defenseResponse ?? {
      blockUsed: false,
      resultModified: false,
      rerolled: false,
    },
  });
};

/* eslint-enable sonarjs/cognitive-complexity */
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

const basicAttackDamage = (
  state: ActiveFightState,
  attacker: CombatantState,
  target: CombatantState,
) =>
  damageAfterStatusPenalties(
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

const completedBasicAttackResolution = (
  state: ActiveFightState,
  decision: BasicAttackDecision,
  attacker: CombatantState,
  target: CombatantState,
  options: BasicAttackResolutionOptions,
  dependencies: CombatDependencies,
) => {
  const basicDamage = basicAttackDamage(state, attacker, target);
  const activeResultOverrides = activeCombatResultOverridesForAttack(
    state,
    attacker.id,
    undefined,
    1,
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
    preventCritical:
      options.preventCritical === true ||
      combatResultPreventedForBasicAttack(state, attacker.id, "critical"),
    preventCounter:
      options.preventCounter === true ||
      combatResultPreventedForBasicAttack(state, target.id, "counter"),
    naturalRolls: options.naturalRolls,
    resultOverrides: options.resultOverrides ?? activeResultOverrides,
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
  const rollResultTriggered = rollResultTriggeredEffects(attacker, target, undefined, {
    self: attacker,
    opponent: target,
    turnNumber: state.turnNumber,
    completedTurnCount: state.turnNumber - 1,
    moves: new Map(MOVE_DEFINITIONS.map((move) => [move.id, move])),
    moveActivationCounts: moveActivationCounts(state),
    successfulHitCount: adjustedResolution.outcome === "successful" ? 1 : 0,
    actionHistory: state.actionHistory,
    activeEffects: state.activeEffects,
    currentAction: currentActionForEffectContext(currentAction),
    rolls: [adjustedResolution],
    mode: state.mode,
  });
  const rollResultEffects = mergeMoveEffects(
    ...rollResultTriggered.map(({ sourceMove, owner, effects }) =>
      effectsForActionWithMoveModificationPrevention(
        state,
        effects,
        owner.id,
        sourceMove,
        attacker,
        target,
        undefined,
      ),
    ),
  );
  const counterAttackCount = consecutiveCounterAttackCount(state) + 1;
  const counterChainLimitReached =
    (adjustedResolution.counter || options.counterAction !== undefined) &&
    state.phase === "counter" &&
    !canContinueCounterChain(counterAttackCount);
  const counterContinues =
    (adjustedResolution.counter || options.counterAction !== undefined) &&
    !counterChainLimitReached;
  const targetAfterAttack = basicAttackTargetAfterResolution(
    target,
    adjustedResolution,
    options.defenseItemUse,
  );
  const resourceChanges = resourceChangesAfterPreventions(
    attacker,
    target,
    [
      ...activeNextActionResourceChanges(state, attacker, undefined, adjustedResolution.damage),
      ...rollResultEffects.resources,
    ],
    state.activeEffects,
    currentAction,
  );
  const attackerAfterResource = resourceAfterChanges(
    attacker,
    resourceChanges,
    "self",
    state.activeEffects,
    currentAction,
  );
  const attackerDefeated = attackerAfterResource.hitPoints.current === 0;
  const attackerWithStatus = attackerDefeated
    ? { ...attackerAfterResource, status: "defeated" as const }
    : attackerAfterResource;
  let combatants = state.combatants;
  if (resolution.outcome === "successful" || options.defenseItemUse !== undefined) {
    combatants = {
      ...state.combatants,
      [attacker.id]: attackerWithStatus,
      [target.id]: targetAfterAttack,
    };
  } else if (resourceChanges.length > 0) {
    combatants = { ...state.combatants, [attacker.id]: attackerWithStatus };
  }
  combatants = combatantsAfterResourceEffectUseLimits(combatants, resourceChanges);
  return {
    attackerDefeated,
    combatants,
    counterChainLimitReached,
    counterContinues,
    ...(options.counterAction === undefined ? {} : { counterAction: options.counterAction }),
    resolution: adjustedResolution,
    resourceChanges,
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
    preventCritical,
    preventCounter,
    includeRollEvents,
    naturalRolls,
    resultOverrides,
    numericResultOverrides,
    counterAction,
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
    attackerDefeated,
    resourceChanges,
  } = completedBasicAttackResolution(
    state,
    decision,
    attacker,
    target,
    {
      defenseItemUse,
      defenseResultModifier,
      preventCritical,
      preventCounter,
      naturalRolls,
      resultOverrides,
      numericResultOverrides,
      counterAction,
    },
    dependencies,
  );
  const events = createBasicAttackEvents(state, decision, dependencies, {
    attacker,
    target,
    resolution,
    counterContinues,
    counterAction,
    counterChainLimitReached,
    resourceChanges,
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
        ...optionalResourceChangeHistoryFor(
          resourceChanges,
          attacker.id,
          target.id,
          state.turnNumber,
        ),
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
    attackerDefeated,
    counterContinues,
    counterAction,
    eventSequence: nextEventSequence,
    resolution,
    resourceChanges,
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
    attackerDefeated,
    counterContinues,
    counterAction,
    eventSequence,
    resolution,
  }: BasicAttackStateContext,
): ActiveFightState | CompletedFightState =>
  defeated || attackerDefeated
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
        completion: {
          type: "defeat",
          winnerCombatantId: attackerDefeated ? target.id : attacker.id,
        },
      }
    : (() => {
        const nextActiveCombatantId =
          counterContinues || state.phase === "counter" ? target.id : state.activeCombatantId;
        const restoredCombatants = combatantsAfterTemporaryMoveRestoration(
          combatants,
          expiredTemporaryMoveRemovals(state, attacker.id, [resolution]),
        );
        return {
          ...state,
          version: state.version + 1,
          phase: counterContinues ? "counter" : "end",
          // A counter is still part of the original actor's turn. Once the
          // counter chain ends, leave that original actor active at End so the
          // normal phase advance hands the next turn to the countering defender.
          activeCombatantId: nextActiveCombatantId,
          combatants: restoredCombatants,
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
                  ...(counterAction === undefined ? {} : { counterAction }),
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

const awaitingCounterFrameFor = (state: ActiveFightState, combatantId: CombatantId) =>
  state.resolutionFrames.find(
    (frame): frame is Extract<typeof frame, { readonly stage: "awaiting-counter" }> =>
      frame.type === "attack" &&
      frame.stage === "awaiting-counter" &&
      frame.counterAction !== undefined &&
      frame.targetCombatantId === combatantId,
  );

const counterActionDecisionFor = (
  state: ActiveFightState,
  combatantId: CombatantId,
): LegalDecision | undefined => {
  const frame = awaitingCounterFrameFor(state, combatantId);
  const counterAction = frame?.counterAction;
  if (frame === undefined || counterAction === undefined) return undefined;
  const sourceAction = counterAction?.sourceAction;
  if (counterAction?.action === "use-source-attack")
    return {
      type: "use-move",
      actorId: combatantId,
      moveId: counterAction.sourceDefinitionId,
      targetCombatantId: frame.attackerId,
    };
  if (counterAction?.action !== "repeat-triggering-attack" || sourceAction === undefined)
    return undefined;
  if (sourceAction.type === "basic-attack")
    return {
      type: "basic-attack",
      actorId: combatantId,
      basicAttack: sourceAction.basicAttack,
      targetCombatantId: sourceAction.actorId,
    };
  return {
    type: "use-move",
    actorId: combatantId,
    moveId: sourceAction.moveId,
    targetCombatantId: sourceAction.actorId,
  };
};

const availableExtraActionsFor = (state: ActiveFightState, combatantId: CombatantId) =>
  state.activeEffects.filter(
    (effect): effect is Extract<ActiveCombatEffect, { readonly type: "extra-action" }> =>
      effect.type === "extra-action" &&
      effect.targetCombatantId === combatantId &&
      effect.phase === (state.phase === "upkeep" ? "upkeep" : "action") &&
      effect.remainingActions > 0 &&
      effect.activationCost === undefined &&
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
      (isSimpleActionMove(move) || isCopyMoveAction(state, move)) &&
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
    ...(state.phase === "action" || state.phase === "upkeep" ? constantSkills : []),
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
    ...(state.phase === "counter"
      ? (() => {
          const counterDecision = counterActionDecisionFor(state, combatantId);
          return counterDecision === undefined ? [] : [counterDecision];
        })()
      : []),
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
    ...(state.phase === "action" || state.phase === "upkeep"
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
    const counterDecision = counterActionDecisionFor(state, combatantId);
    if (
      counterDecision?.type === "use-move" &&
      counterDecision.moveId === decision.moveId &&
      counterDecision.targetCombatantId === decision.targetCombatantId
    )
      return true;
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
    (state.phase !== "action" && state.phase !== "counter" && state.phase !== "upkeep") ||
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
    : extraActionDecisions.filter((decision) => satisfiesForcedAction(state, force, decision));
};

const deferredMoveAtUpkeep = (
  state: ActiveFightState,
  activeCombatant: ActiveFightState["combatants"][CombatantId],
  upkeepExtraActionState: ActiveFightState,
  events: readonly CombatEvent[],
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> | undefined => {
  const deferredMove = upkeepExtraActionState.activeEffects.find(
    (effect): effect is Extract<ActiveCombatEffect, { readonly type: "deferred-move" }> =>
      effect.type === "deferred-move" &&
      effect.sourceCombatantId === activeCombatant.id &&
      effect.performOnTurn === state.turnNumber,
  );
  if (deferredMove === undefined) return undefined;
  const cancelled = state.actionHistory.some(
    (action) =>
      (action.type === "basic-attack" || action.type === "use-move") &&
      action.actorId === deferredMove.cancellation.actorCombatantId &&
      action.targetCombatantId === deferredMove.sourceCombatantId &&
      action.outcome === deferredMove.cancellation.result,
  );
  const stateReadyForAction: ActiveFightState = {
    ...upkeepExtraActionState,
    version: state.version + 1,
    phase: "action",
    eventSequence: state.eventSequence + events.length,
    activeEffects: upkeepExtraActionState.activeEffects.filter(
      (effect) => effect.id !== deferredMove.id,
    ),
  };
  if (cancelled) {
    const cancellationLock =
      deferredMove.onCancellation === undefined
        ? undefined
        : ({
            id: dependencies.ids.nextActiveEffectId(),
            type: "action-lock" as const,
            sourceCombatantId: deferredMove.sourceCombatantId,
            targetCombatantId: deferredMove.sourceCombatantId,
            sourceDefinitionId: deferredMove.sourceDefinitionId,
            affectedType: "attack" as const,
            duration: { type: "combat" } as const,
          } satisfies Extract<ActiveCombatEffect, { readonly type: "action-lock" }>);
    const nextState = {
      ...stateReadyForAction,
      activeEffects:
        cancellationLock === undefined
          ? stateReadyForAction.activeEffects
          : [...stateReadyForAction.activeEffects, cancellationLock],
      eventSequence: stateReadyForAction.eventSequence + (cancellationLock === undefined ? 2 : 3),
    };
    const cancellationEvents: CombatEvent[] = [
      {
        id: dependencies.ids.nextEventId(),
        sequence: stateReadyForAction.eventSequence + 1,
        fightId: state.id,
        causedByEffectId: deferredMove.id,
        sourceDefinitionId: deferredMove.sourceDefinitionId,
        type: "deferred-move-cancelled",
        activeEffectId: deferredMove.id,
        combatantId: deferredMove.sourceCombatantId,
        moveId: deferredMove.sourceDefinitionId,
        reason: "successful-opponent-attack",
      },
    ];
    if (cancellationLock !== undefined)
      cancellationEvents.push({
        id: dependencies.ids.nextEventId(),
        sequence: stateReadyForAction.eventSequence + 2,
        fightId: state.id,
        causedByEffectId: deferredMove.id,
        sourceDefinitionId: deferredMove.sourceDefinitionId,
        type: "effect-activated",
        activeEffectId: cancellationLock.id,
        sourceCombatantId: cancellationLock.sourceCombatantId,
        targetCombatantId: cancellationLock.targetCombatantId,
      });
    cancellationEvents.push(
      createPhaseChangedEvent(stateReadyForAction, dependencies, "action", nextState.eventSequence),
    );
    return transitionFrom(nextState, [...events, ...cancellationEvents]);
  }
  const deferredMoveDefinition = MOVE_DEFINITIONS.find(
    (move) => move.id === deferredMove.sourceDefinitionId,
  );
  if (deferredMoveDefinition === undefined) return { ok: false, error: invalidFightState(state) };
  const execution = resolveConvertedAttackMove(
    stateReadyForAction,
    {
      type: "use-move",
      id: deferredMove.declarationDecisionId,
      actorId: deferredMove.sourceCombatantId,
      expectedStateVersion: stateReadyForAction.version,
      moveId: deferredMove.sourceDefinitionId,
      targetCombatantId: deferredMove.targetCombatantId,
    },
    deferredMoveDefinition,
    dependencies,
    {
      deferredExecution: {
        activeEffectId: deferredMove.id,
        declarationDecisionId: deferredMove.declarationDecisionId,
        ...(deferredMove.damageOverridePercent === undefined
          ? {}
          : { damageOverridePercent: deferredMove.damageOverridePercent }),
      },
    },
  );
  return execution.ok
    ? { ok: true, value: { ...execution.value, events: [...events, ...execution.value.events] } }
    : execution;
};

const extraActionActivationAtUpkeep = (
  state: ActiveFightState,
  combatantId: CombatantId,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> | undefined => {
  const allowance = state.activeEffects.find(
    (effect): effect is Extract<ActiveCombatEffect, { readonly type: "extra-action" }> =>
      effect.type === "extra-action" &&
      effect.targetCombatantId === combatantId &&
      effect.phase === "upkeep" &&
      effect.activationCost !== undefined &&
      effect.remainingActions > 0 &&
      state.turnNumber >= effect.availableFromTurn &&
      state.turnNumber <= effect.expiresAfterTurn,
  );
  if (allowance === undefined) return undefined;
  const pendingDecisionId = dependencies.ids.nextPendingDecisionId();
  const nextVersion = state.version + 1;
  return transitionFrom(
    {
      ...state,
      version: nextVersion,
      pendingDecision: {
        id: pendingDecisionId,
        stateVersion: nextVersion,
        combatantId,
        type: "optional-effect",
        options: [
          {
            id: `activate-effect:${allowance.sourceDefinitionId}:${allowance.sourceEffectIndex}`,
            type: "activate-effect",
            moveId: allowance.sourceDefinitionId,
            effectIndices: [allowance.sourceEffectIndex],
          },
          { id: "decline", type: "decline" },
        ],
      },
      resolutionFrames: [
        ...state.resolutionFrames,
        {
          id: dependencies.ids.nextResolutionFrameId(),
          type: "effect",
          sourceCombatantId: allowance.sourceCombatantId,
          targetCombatantId: allowance.targetCombatantId,
          sourceDefinitionId: allowance.sourceDefinitionId,
          effectIndex: allowance.sourceEffectIndex,
          operation: "activate-extra-action",
          returnPhase: "upkeep",
          trigger: "upkeep",
          pendingDecisionId,
          activeEffectId: allowance.id,
          activationCost: allowance.activationCost,
          optional: true,
        },
      ],
    },
    [],
  );
};

const actionBlockedUpkeepTransition = ({
  state,
  upkeepState,
  activeCombatant,
  upkeepCombatants,
  combatants,
  activeEffects,
  events,
  dependencies,
}: {
  readonly state: ActiveFightState;
  readonly upkeepState: ActiveFightState;
  readonly activeCombatant: ActiveFightState["combatants"][CombatantId];
  readonly upkeepCombatants: ActiveFightState["combatants"];
  readonly combatants: ActiveFightState["combatants"];
  readonly activeEffects: readonly ActiveCombatEffect[];
  readonly events: readonly CombatEvent[];
  readonly dependencies: CombatDependencies;
}): CombatResult<CombatTransition> | undefined => {
  const actionBlockingStatus = upkeepCombatants[activeCombatant.id].activeStatuses.find(
    (status) =>
      (status.statusId === "stun" || status.statusId === "petrified") &&
      ((status.duration.type === "turns" &&
        status.duration.ownerCombatantId === activeCombatant.id) ||
        (status.duration.type === "until-turn-start-roll-threshold" &&
          status.duration.combatantId === activeCombatant.id)),
  );
  const actionBlockingEffect = activeEffects.find(
    (effect) =>
      effect.type === "action-restriction" &&
      effect.targetCombatantId === activeCombatant.id &&
      effect.blockedCategories === undefined &&
      state.turnNumber >= effect.availableFromTurn,
  );
  if (actionBlockingStatus === undefined && actionBlockingEffect === undefined) return undefined;
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
    resolutionFrames: upkeepState.resolutionFrames.filter(
      (frame) =>
        (frame.type !== "effect" || frame.resolved !== true) &&
        !(
          frame.type === "effect-choice" &&
          frame.returnPhase === "upkeep" &&
          frame.resolved === true
        ),
    ),
    actionHistory: [
      ...state.actionHistory,
      {
        type: "turn-skipped" as const,
        actorId: activeCombatant.id,
        turnNumber: state.turnNumber,
        phase: "action" as const,
        reason: actionBlockingStatus === undefined ? ("effect" as const) : ("status" as const),
      },
    ],
    eventSequence: state.eventSequence + events.length + 2,
  };
  return transitionFrom(nextState, [
    ...events,
    actionSkipped,
    createPhaseChangedEvent(state, dependencies, "end", nextState.eventSequence),
  ]);
};

const upkeepDeactivationTransition = (
  state: ActiveFightState,
  preparedUpkeep: boolean,
  activeCombatantId: CombatantId,
  dependencies: CombatDependencies,
  priorEvents: readonly CombatEvent[],
): CombatResult<CombatTransition> | undefined => {
  if (preparedUpkeep) return undefined;
  const lifecycleDeactivation = lifecycleDeactivationApplication(
    state,
    activeCombatantId,
    "upkeep-phase",
  );
  if (lifecycleDeactivation === undefined) return undefined;
  return resolveDeactivations({
    state: { ...state, version: state.version + 1 },
    applications: [lifecycleDeactivation.application],
    sourceCombatantId: activeCombatantId,
    dependencies,
    priorEvents,
    trigger: "upkeep",
  });
};

const pendingUpkeepChoiceTransition = (
  state: ActiveFightState,
  upkeepTriggered: readonly UpkeepTriggeredEffects[],
  dependencies: CombatDependencies,
  priorEvents: readonly CombatEvent[],
): CombatResult<CombatTransition> | undefined => {
  const pendingUpkeepChoice = upkeepTriggered.find((entry) => entry.pendingChoice !== undefined);
  return pendingUpkeepChoice === undefined
    ? undefined
    : requestUpkeepEffectChoice(state, pendingUpkeepChoice, dependencies, priorEvents);
};

const upkeepTurnStartChecks = (
  state: ActiveFightState,
  activeCombatantId: CombatantId,
  preparedUpkeep: boolean,
  dependencies: CombatDependencies,
) =>
  preparedUpkeep
    ? { effects: state.activeEffects, events: [] as readonly CombatEvent[] }
    : effectsAfterTurnStartChecks(state, activeCombatantId, dependencies);

/* eslint-disable sonarjs/cognitive-complexity -- upkeep advances persisted status, choice, and turn boundaries in order. */
const advanceUpkeepFight = (
  state: ActiveFightState,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> => {
  const activeCombatant = state.combatants[state.activeCombatantId];
  const preparedUpkeep = state.resolutionFrames.some(
    (frame) =>
      frame.type === "effect-choice" && frame.returnPhase === "upkeep" && frame.resolved === true,
  );
  const turnStartChecks = upkeepTurnStartChecks(
    state,
    activeCombatant.id,
    preparedUpkeep,
    dependencies,
  );
  const stateAfterEffectTurnStartChecks: ActiveFightState = {
    ...state,
    activeEffects: turnStartChecks.effects,
    eventSequence: state.eventSequence + turnStartChecks.events.length,
  };
  const statusTurnStartChecks = preparedUpkeep
    ? { combatants: state.combatants, events: [] as readonly CombatEvent[] }
    : statusesAfterTurnStartChecks(
        stateAfterEffectTurnStartChecks,
        activeCombatant.id,
        dependencies,
      );
  const releasedStatusBackedRestrictions: CombatEvent[] = [];
  const activeEffectsAfterStatusChecks = stateAfterEffectTurnStartChecks.activeEffects.filter(
    (effect) => {
      if (effect.type !== "action-restriction") return true;
      const condition = statusBackedActionRestriction(effect);
      if (condition === undefined) return true;
      const target = (
        statusTurnStartChecks.combatants as Readonly<Record<CombatantId, CombatantState>>
      )[effect.targetCombatantId];
      if (target.activeStatuses.some((status) => status.statusId === condition.statusId))
        return true;
      releasedStatusBackedRestrictions.push({
        id: dependencies.ids.nextEventId(),
        sequence:
          state.eventSequence +
          turnStartChecks.events.length +
          statusTurnStartChecks.events.length +
          releasedStatusBackedRestrictions.length +
          1,
        fightId: state.id,
        type: "effect-expired",
        activeEffectId: effect.id,
        targetCombatantId: effect.targetCombatantId,
      });
      return false;
    },
  );
  const target = Object.values(state.combatants).find(
    (combatant) => combatant.id !== activeCombatant.id && combatant.status === "active",
  );
  if (target === undefined) return { ok: false, error: invalidFightState(state) };
  const stateAfterTurnStartChecks: ActiveFightState = {
    ...stateAfterEffectTurnStartChecks,
    activeEffects: activeEffectsAfterStatusChecks,
    combatants: statusTurnStartChecks.combatants,
    eventSequence:
      stateAfterEffectTurnStartChecks.eventSequence +
      statusTurnStartChecks.events.length +
      releasedStatusBackedRestrictions.length,
  };
  const passiveExtraActions = preparedUpkeep
    ? []
    : passiveExtraActionsAtTurnStart(
        stateAfterTurnStartChecks,
        activeCombatant,
        target,
        dependencies,
      );
  const upkeepState: ActiveFightState = preparedUpkeep
    ? state
    : {
        ...stateAfterTurnStartChecks,
        activeEffects: [...stateAfterTurnStartChecks.activeEffects, ...passiveExtraActions],
      };
  const priorUpkeepEvents = [
    ...turnStartChecks.events,
    ...statusTurnStartChecks.events,
    ...releasedStatusBackedRestrictions,
  ];
  const deactivationTransition = upkeepDeactivationTransition(
    upkeepState,
    preparedUpkeep,
    activeCombatant.id,
    dependencies,
    priorUpkeepEvents,
  );
  if (deactivationTransition !== undefined) return deactivationTransition;
  const upkeepTriggered = upkeepTriggeredEffects(upkeepState, activeCombatant.id);
  const pendingChoiceTransition = pendingUpkeepChoiceTransition(
    upkeepState,
    upkeepTriggered,
    dependencies,
    priorUpkeepEvents,
  );
  if (pendingChoiceTransition !== undefined) return pendingChoiceTransition;
  const storedUpkeep = upkeepEffectsAfterStoredRolls(upkeepState, upkeepTriggered, dependencies);
  const costedUpkeep = upkeepTriggeredEffectsWithActivationCosts(
    upkeepState,
    storedUpkeep.triggered,
  );
  const upkeepStateWithStoredRolls: ActiveFightState = {
    ...upkeepState,
    combatants: storedUpkeep.combatants,
  };
  const upkeepCombatants = combatantsAfterUpkeepEffects(upkeepStateWithStoredRolls, costedUpkeep);
  const upkeepStateAfterEffects: ActiveFightState = {
    ...upkeepState,
    combatants: upkeepCombatants,
  };
  const upkeepActivatedEffects = activeEffectsFromTriggered(
    upkeepStateAfterEffects,
    costedUpkeep,
    dependencies,
  );
  const upkeepEffectActivations = [...passiveExtraActions, ...upkeepActivatedEffects];
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
  let selectionEventOffset = upkeepRollEvents.length;
  const upkeepSelectionEvents: CombatEvent[] = [];
  for (const { actor, resolvedSelections } of storedUpkeep.triggered) {
    upkeepSelectionEvents.push(
      ...storedMoveSelectionEvents(
        upkeepState,
        actor.id,
        resolvedSelections,
        dependencies,
        selectionEventOffset,
      ),
    );
    selectionEventOffset += resolvedSelections.length;
  }
  const upkeepEvents = startCombatEvents(
    upkeepStateWithStoredRolls,
    upkeepCombatants,
    upkeepEffectActivations,
    dependencies,
    upkeepRollEvents.length + upkeepSelectionEvents.length,
  );
  const startEvents = startCombatEvents(
    { ...upkeepState, combatants: upkeepCombatants },
    startCombatants,
    startActivatedEffects,
    dependencies,
    upkeepRollEvents.length + upkeepSelectionEvents.length + upkeepEvents.length,
    startTriggered,
  );
  const events = [
    ...turnStartChecks.events,
    ...statusTurnStartChecks.events,
    ...upkeepRollEvents,
    ...upkeepSelectionEvents,
    ...upkeepEvents,
    ...startEvents,
  ];
  const activeEffects = [...upkeepStateWithEffects.activeEffects, ...startActivatedEffects];
  const combatants = { ...upkeepStateWithEffects.combatants, ...startCombatants };
  const pendingStartChoice = startTriggered.find((entry) => entry.pendingChoice !== undefined);
  if (pendingStartChoice !== undefined)
    return requestUpkeepEffectChoice(
      {
        ...state,
        combatants,
        activeEffects,
      },
      pendingStartChoice,
      dependencies,
      events,
      "start-combat",
    );
  const startActivations = startTriggered.flatMap(({ effects }) => effects.activations);
  if (startActivations.length > 0) {
    const startResolutionState: ActiveFightState = {
      ...state,
      version: state.version + 1,
      phase: "upkeep",
      combatants,
      activeEffects,
      eventSequence: state.eventSequence + events.length,
    };
    const activation = resolveActivationApplications({
      state: startResolutionState,
      activations: startActivations,
      sourceCombatantId: activeCombatant.id,
      dependencies,
    });
    if (activation !== undefined) return activation;
  }
  const blockedTransition = actionBlockedUpkeepTransition({
    state,
    upkeepState,
    activeCombatant,
    upkeepCombatants,
    combatants,
    activeEffects,
    events,
    dependencies,
  });
  if (blockedTransition !== undefined) return blockedTransition;
  const upkeepExtraActionState: ActiveFightState = {
    ...state,
    combatants,
    activeEffects,
    phase: "upkeep",
  };
  const extraActionActivation = extraActionActivationAtUpkeep(
    upkeepExtraActionState,
    activeCombatant.id,
    dependencies,
  );
  if (extraActionActivation !== undefined) return extraActionActivation;
  const deferredExecution = deferredMoveAtUpkeep(
    state,
    activeCombatant,
    upkeepExtraActionState,
    events,
    dependencies,
  );
  if (deferredExecution !== undefined) return deferredExecution;
  if (availableExtraActionFor(upkeepExtraActionState, activeCombatant.id) !== undefined) {
    const nextState: ActiveFightState = {
      ...upkeepExtraActionState,
      version: state.version + 1,
      eventSequence: state.eventSequence + events.length,
    };
    return transitionFrom(nextState, events);
  }
  const nextState: ActiveFightState = {
    ...state,
    version: state.version + 1,
    phase: "action",
    combatants,
    activeEffects,
    resolutionFrames: upkeepState.resolutionFrames.filter(
      (frame) =>
        (frame.type !== "effect" || frame.resolved !== true) &&
        !(
          frame.type === "effect-choice" &&
          frame.returnPhase === "upkeep" &&
          frame.resolved === true
        ),
    ),
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
  resolutionFrames: state.resolutionFrames.filter(
    (frame) =>
      (frame.type !== "effect" || frame.resolved !== true) &&
      !(
        frame.type === "effect-choice" &&
        frame.returnPhase === "upkeep" &&
        frame.resolved === true
      ),
  ),
  activeEffects: effectsAfterOwnerTurn(
    { ...state, combatants: scheduledEnd.combatants, activeEffects: scheduledEnd.activeEffects },
    state.activeCombatantId,
  ),
  eventSequence: state.eventSequence + scheduledEnd.events.length + 2,
});

/* eslint-enable sonarjs/cognitive-complexity */
const advanceEndFight = (
  state: ActiveFightState,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> => {
  const scheduledActivation = state.resolutionFrames.find(
    (frame): frame is Extract<typeof frame, { readonly type: "effect" }> =>
      frame.type === "effect" &&
      frame.operation === "activate" &&
      frame.trigger === "on-roll-result" &&
      frame.pendingDecisionId === undefined,
  );
  if (scheduledActivation !== undefined) {
    const pendingDecisionId = dependencies.ids.nextPendingDecisionId();
    const nextState: ActiveFightState = {
      ...state,
      version: state.version + 1,
      pendingDecision: {
        id: pendingDecisionId,
        stateVersion: state.version + 1,
        combatantId: scheduledActivation.sourceCombatantId,
        type: "select-move",
        options: [
          ...(scheduledActivation.eligibleMoveIds ?? []).map((moveId) => ({
            id: `activate:${moveId}`,
            type: "select-move" as const,
            moveId,
          })),
          ...(scheduledActivation.optional === true
            ? [{ id: "decline", type: "decline" as const }]
            : []),
        ],
      },
      resolutionFrames: state.resolutionFrames.map((frame) =>
        frame.id === scheduledActivation.id ? { ...frame, pendingDecisionId } : frame,
      ),
    };
    return transitionFrom(nextState, []);
  }
  const lifecycleDeactivation = lifecycleDeactivationApplication(
    state,
    state.activeCombatantId,
    "turn-end",
  );
  if (lifecycleDeactivation !== undefined) {
    return resolveDeactivations({
      state: { ...state, version: state.version + 1 },
      applications: [lifecycleDeactivation.application],
      sourceCombatantId: state.activeCombatantId,
      dependencies,
      priorEvents: [],
      trigger: "end",
    });
  }
  const turnEndTriggered = turnEndTriggeredEffects(state);
  const turnEndCombatants = combatantsAfterTurnEndEffects(state, turnEndTriggered);
  const turnEndState = {
    ...state,
    combatants: turnEndCombatants,
    activeEffects: [
      ...state.activeEffects,
      ...activeEffectsFromTriggered(state, turnEndTriggered, dependencies),
    ],
    eventSequence: state.eventSequence,
  };
  const turnEndActivatedEffects = turnEndState.activeEffects.slice(state.activeEffects.length);
  const turnEndEvents = startCombatEvents(
    state,
    turnEndCombatants,
    turnEndActivatedEffects,
    dependencies,
  );
  const stateAfterTurnEnd = {
    ...turnEndState,
    eventSequence: state.eventSequence + turnEndEvents.length,
  };
  const scheduledEnd = scheduledResourceBoundary(
    stateAfterTurnEnd,
    { type: "turn-end", combatantId: stateAfterTurnEnd.activeCombatantId },
    dependencies,
  );
  if (scheduledEnd.defeatedCombatantId !== undefined)
    return transitionFrom(completedStateAfterScheduledBoundary(stateAfterTurnEnd, scheduledEnd), [
      ...turnEndEvents,
      ...scheduledEnd.events,
    ]);
  const nextCombatantId = nextActiveCombatantId(stateAfterTurnEnd);
  if (nextCombatantId === undefined)
    return { ok: false, error: invalidFightState(stateAfterTurnEnd) };
  const nextStateBeforeSchedule = stateAtNextUpkeep(
    stateAfterTurnEnd,
    scheduledEnd,
    nextCombatantId,
  );
  const phaseChanged = createPhaseChangedEvent(
    {
      ...stateAfterTurnEnd,
      eventSequence: stateAfterTurnEnd.eventSequence + scheduledEnd.events.length,
    },
    dependencies,
    "upkeep",
    stateAfterTurnEnd.eventSequence + scheduledEnd.events.length + 1,
  );
  const turnStarted: CombatEvent = {
    id: dependencies.ids.nextEventId(),
    sequence: nextStateBeforeSchedule.eventSequence,
    fightId: stateAfterTurnEnd.id,
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
    ...turnEndEvents,
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
    ...(force.selectedMoveStorageKey === undefined
      ? {}
      : { selectedMoveStorageKey: force.selectedMoveStorageKey }),
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
      createdOnTurn,
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
  const moveRemovals = activeMoveRemovalsFromApplications(
    effects.moveRemovals,
    actor.id,
    target.id,
    move.id,
    state.combatants,
    dependencies,
  );
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
    ...moveRemovals,
  ];
};

interface SimpleActionMoveResolutionOptions {
  readonly persistedStoredRolls?: readonly StoredRoll[];
  readonly enabledOptionalEffectIndices?: readonly number[];
  readonly resolvedOptionalEffectIndices?: readonly number[];
  readonly moveUseSourceDefinitionId?: MoveId;
  readonly moveUseEffectIndices?: readonly number[];
  readonly moveUseEffectOwnerId?: CombatantId;
}

type StoredRollResolution = {
  readonly combatant: CombatantState;
  readonly resolved: readonly ResolvedStoredRoll[];
};

const persistedStoredRollResolution = (
  actor: CombatantState,
  requests: readonly StoredRollRequest[],
  persisted: readonly StoredRoll[],
): StoredRollResolution | undefined => {
  const storedRolls = { ...(actor.storedRolls ?? {}) };
  const resolved = requests.map((request) => {
    const storedRoll = persisted.find(
      (candidate) =>
        candidate.sourceDefinitionId === request.sourceDefinitionId &&
        candidate.storageKey === request.storageKey,
    );
    if (
      storedRoll === undefined ||
      storedRoll.naturalResults.length !== request.dice ||
      storedRoll.sides !== request.sides ||
      storedRoll.naturalResults.some(
        (result) => !Number.isInteger(result) || result < 1 || result > request.sides,
      )
    )
      return undefined;
    storedRolls[request.storageKey] = storedRoll;
    return { request, storedRoll };
  });
  return resolved.some((candidate) => candidate === undefined)
    ? undefined
    : {
        combatant: { ...actor, storedRolls },
        resolved: resolved as readonly ResolvedStoredRoll[],
      };
};

const simpleActionOnRollResultEffects = (
  move: MoveDefinition,
  effectContext: MoveEffectRuntimeContext,
  actorWithStoredRolls: CombatantState,
  storedRollResolution: StoredRollResolution,
  options: SimpleActionMoveResolutionOptions,
) =>
  storedRollResolution.resolved.length === 0
    ? mergeMoveEffects()
    : moveEffectsForTrigger(move, "on-roll-result", {
        ...effectContext,
        self: actorWithStoredRolls,
        ...(options.enabledOptionalEffectIndices === undefined
          ? {}
          : { enabledOptionalEffectIndices: options.enabledOptionalEffectIndices }),
        ...(options.resolvedOptionalEffectIndices === undefined
          ? {}
          : { resolvedOptionalEffectIndices: options.resolvedOptionalEffectIndices }),
        ...(options.persistedStoredRolls === undefined ? { collectPendingChoices: true } : {}),
      });

const simpleActionPendingChoiceTransition = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  target: CombatantState,
  move: MoveDefinition,
  effects: ReturnType<typeof moveEffectsForTrigger>,
  storedRollResolution: StoredRollResolution,
  options: SimpleActionMoveResolutionOptions,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> | undefined => {
  if (options.persistedStoredRolls !== undefined) return undefined;
  const pendingChoice = effects.pendingEffectChoices.find(() => true);
  if (pendingChoice === undefined) return undefined;
  if (effects.pendingEffectChoices.length !== 1)
    return {
      ok: false,
      error: { type: "unsupported-mechanic", mechanic: "pending decision resolution" },
    };
  return requestSimpleActionEffectChoice(
    state,
    decision,
    target,
    move,
    pendingChoice,
    storedRollResolution.resolved.map(({ storedRoll }) => storedRoll),
    dependencies,
  );
};

const simpleActionMoveUseNegationChoiceTransition = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  actor: CombatantState,
  target: CombatantState,
  move: MoveDefinition,
  dependencies: CombatDependencies,
) => {
  const pending = moveUseTriggeredEffects(state, actor, target, move, {
    collectPendingChoices: true,
  })
    .flatMap(({ sourceMove, owner, effects }) =>
      effects.pendingEffectChoices
        .filter((choice) =>
          choice.effectIndices.some(
            (effectIndex) => sourceMove.effects?.[effectIndex]?.type === "negate",
          ),
        )
        .map((choice) => ({ sourceMove, owner, choice })),
    )
    .find(({ sourceMove, owner, choice }) => {
      const selected = selectedMoveUseEffectsForAttack(
        state,
        actor,
        target,
        move,
        sourceMove.id,
        choice.effectIndices,
        owner.id,
      );
      return (
        selected?.negations.some((negation) => negation.activationCost !== undefined) === true &&
        selectedMoveUseActivationCostAvailable(owner, selected)
      );
    });
  return pending === undefined
    ? undefined
    : requestSimpleActionEffectChoice(
        state,
        decision,
        target,
        move,
        pending.choice,
        [],
        dependencies,
        pending.sourceMove,
        pending.owner.id,
        "on-move-use",
      );
};

const pendingSimpleActionMoveUseNegation = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  actor: CombatantState,
  target: CombatantState,
  move: MoveDefinition,
  dependencies: CombatDependencies,
  sourceDefinitionId: MoveId | undefined,
) =>
  sourceDefinitionId === undefined
    ? simpleActionMoveUseNegationChoiceTransition(
        state,
        decision,
        actor,
        target,
        move,
        dependencies,
      )
    : undefined;

const requestSimpleActionEffectChoice = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  target: CombatantState,
  move: MoveDefinition,
  choice: PendingEffectChoice,
  storedRolls: readonly StoredRoll[],
  dependencies: CombatDependencies,
  sourceMove = move,
  sourceCombatantId = decision.actorId,
  effectTrigger: "on-power-up" | "on-roll-result" | "on-move-use" = "on-roll-result",
): CombatResult<CombatTransition> => {
  const pendingDecisionId = dependencies.ids.nextPendingDecisionId();
  const nextVersion = state.version + 1;
  const nextState: ActiveFightState = {
    ...state,
    version: nextVersion,
    combatants: {
      ...state.combatants,
      [decision.actorId]: {
        ...state.combatants[decision.actorId],
        storedRolls: {
          ...(state.combatants[decision.actorId].storedRolls ?? {}),
          ...Object.fromEntries(
            storedRolls.map((storedRoll) => [storedRoll.storageKey, storedRoll]),
          ),
        },
      },
    },
    pendingDecision: {
      id: pendingDecisionId,
      stateVersion: nextVersion,
      combatantId: sourceCombatantId,
      type: "optional-effect",
      options: [
        {
          id: `activate-effect:${choice.effectIndices.join(",")}`,
          type: "activate-effect",
          moveId: sourceMove.id,
          effectIndices: choice.effectIndices,
        },
        { id: "decline", type: "decline" },
      ],
    },
    resolutionFrames: [
      {
        id: dependencies.ids.nextResolutionFrameId(),
        type: "effect-choice",
        decisionId: decision.id,
        actorId: decision.actorId,
        targetCombatantId: target.id,
        returnPhase: "end",
        pendingDecisionId,
        sourceDefinitionId: sourceMove.id,
        ...(sourceMove.id === move.id ? {} : { actionMoveId: move.id }),
        ...(sourceCombatantId === decision.actorId ? {} : { sourceCombatantId }),
        effectIndices: choice.effectIndices,
        effectTrigger,
        ...(effectTrigger === "on-roll-result" ? { storedRolls } : {}),
      },
    ],
    eventSequence: state.eventSequence + 1,
  };
  return transitionFrom(nextState, []);
};

const resolveSimpleActionMove = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  move: MoveDefinition,
  dependencies: CombatDependencies,
  options: SimpleActionMoveResolutionOptions = {},
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
  const pendingMoveUse = pendingSimpleActionMoveUseNegation(
    state,
    decision,
    actor,
    target,
    move,
    dependencies,
    options.moveUseSourceDefinitionId,
  );
  if (pendingMoveUse !== undefined) return pendingMoveUse;
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
  const selectedMoveUseEffects =
    options.moveUseSourceDefinitionId === undefined
      ? undefined
      : selectedMoveUseEffectsForAttack(
          state,
          actor,
          target,
          move,
          options.moveUseSourceDefinitionId,
          options.moveUseEffectIndices,
          options.moveUseEffectOwnerId,
        );
  const actionPhaseEffects = negatesSelectedMoveUseEffects(selectedMoveUseEffects, move)
    ? mergeMoveEffects()
    : moveEffectsForTrigger(move, "action-phase", effectContext);
  const storedRollResolution =
    options.persistedStoredRolls === undefined
      ? combatantAfterStoredRollRequests(
          actor,
          actionPhaseEffects.storedRollRequests,
          state.turnNumber,
          dependencies,
        )
      : persistedStoredRollResolution(
          actor,
          actionPhaseEffects.storedRollRequests,
          options.persistedStoredRolls,
        );
  if (storedRollResolution === undefined) return { ok: false, error: invalidFightState(state) };
  const actorWithStoredRolls = storedRollResolution.combatant;
  const onRollResultEffects = simpleActionOnRollResultEffects(
    move,
    effectContext,
    actorWithStoredRolls,
    storedRollResolution,
    options,
  );
  const pendingChoiceTransition = simpleActionPendingChoiceTransition(
    state,
    decision,
    target,
    move,
    onRollResultEffects,
    storedRollResolution,
    options,
    dependencies,
  );
  if (pendingChoiceTransition !== undefined) return pendingChoiceTransition;
  const effects = mergeMoveEffects(actionPhaseEffects, onRollResultEffects);
  const moveUseTriggered = moveUseTriggeredEffects(state, actorWithStoredRolls, target, move);
  const moveUseNegated = negatesSelectedMoveUseEffects(selectedMoveUseEffects, move);
  const actionEffects = moveUseNegated ? mergeMoveEffects() : effects;
  const resourceTriggered = resourceEventTriggeredEffects(
    state,
    actorWithStoredRolls,
    target,
    actionEffects.resources,
    [...state.actionHistory, actionRecordFor(state, decision)],
  );
  const resolvedEffects = mergeMoveEffects(
    actionEffects,
    ...(selectedMoveUseEffects === undefined ? [] : [selectedMoveUseEffects]),
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
  const selectedMoveUseResourceChanges = selectedMoveUseActivationChanges(
    selectedMoveUseEffects,
    actor,
    options.moveUseEffectOwnerId,
  );
  const actorAfter = statusesAfterApplications(
    resourceAfterChanges(
      {
        ...actorWithStoredRolls,
        ki: { ...actor.ki, current: actor.ki.current - cost.value },
        moveUses: { ...actor.moveUses, [move.id]: (actor.moveUses[move.id] ?? 0) + 1 },
      },
      [...resolvedEffects.resources, ...selectedMoveUseResourceChanges],
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
      [...resolvedEffects.resources, ...selectedMoveUseResourceChanges],
      "opponent",
      state.activeEffects,
      actionRecordFor(state, decision),
    ),
    resolvedEffects.statuses,
    "opponent",
  );
  const actorAfterTransformationReversions = combatantAfterTransformationReversions(
    actorAfter,
    resolvedEffects.transformationReversions,
    "self",
  );
  const targetAfterTransformationReversions = combatantAfterTransformationReversions(
    targetAfter,
    resolvedEffects.transformationReversions,
    "opponent",
  );
  const actorAfterTransformationActions = combatantAfterTransformationActions(
    actorAfterTransformationReversions,
    resolvedEffects.transformationActions,
    "self",
  );
  const targetAfterTransformationActions = combatantAfterTransformationActions(
    targetAfterTransformationReversions,
    resolvedEffects.transformationActions,
    "opponent",
  );
  const modifiers = actionMoveModifiers(move, actorWithStoredRolls, target, state, dependencies);
  const activatedEffects = [
    ...simpleActionActivatedEffects(
      state,
      actionEffects,
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
  const combatantsAfterEffects = combatantsAfterMoveRemovals(
    {
      [actor.id]: actorAfterTransformationActions,
      [target.id]: targetAfterTransformationActions,
    },
    activatedEffects,
  );
  const actorAfterMoveRemovals = combatantsAfterEffects[actor.id];
  const targetAfterMoveRemovals = combatantsAfterEffects[target.id];
  const events = simpleActionMoveEvents(state, decision, dependencies, {
    activatedEffects,
    negatedEffects: negatedActiveEffects,
    move,
    actor,
    actorAfter: actorAfterMoveRemovals,
    storedRolls: storedRollResolution.resolved,
    statusApplications: resolvedEffects.statuses,
    transformationReversions: resolvedEffects.transformationReversions,
    transformationActions: resolvedEffects.transformationActions,
    target,
    targetAfter: targetAfterMoveRemovals,
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
    combatants: {
      ...state.combatants,
      [actor.id]: actorAfterMoveRemovals,
      [target.id]: targetAfterMoveRemovals,
    },
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
  readonly transformationReversions: readonly TransformationReversionApplication[];
  readonly transformationActions: readonly TransformationActionApplication[];
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
    transformationReversions,
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
  for (const effect of activatedEffects) {
    if (effect.type !== "remove-move-from-combat") continue;
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + events.length + 1,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "move-removed-from-combat",
      combatantId: effect.targetCombatantId,
      moveId: effect.moveId,
      activeEffectId: effect.id,
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
  for (const application of transformationReversions) {
    const combatant = application.target === "self" ? actor : target;
    if (combatant.transformation?.baseline === undefined) continue;
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + events.length + 1,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "transformation-deactivated",
      combatantId: combatant.id,
      transformationId: combatant.transformation.transformationId,
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
  const effectiveCost = convertedAttackCost(state, actor, move, cost.value);
  return actor.ki.current < effectiveCost
    ? { type: "insufficient-ki", required: effectiveCost, available: actor.ki.current }
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
  const effectiveCost = convertedAttackCost(state, actor, move, cost.value);
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
            paidActivationCost: effectiveCost,
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
        ki: { ...actor.ki, current: actor.ki.current - effectiveCost },
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
      amount: -effectiveCost,
      remainingKi: actor.ki.current - effectiveCost,
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
  const copySelection = copyMoveSelectionActionSource(state, move, decision.actorId);
  if (copySelection !== undefined) {
    if (activeOpponent(state, decision.actorId, decision.targetCombatantId) === undefined)
      return {
        ok: false,
        error: { type: "invalid-target", targetCombatantId: decision.targetCombatantId },
      };
    if (!copyMoveUseAvailable(state, decision.actorId, move.id, copySelection.effect))
      return { ok: false, error: { type: "restricted-use-exhausted", moveId: move.id } };
    return copyMoveSelectionTransition({
      state,
      decision,
      move,
      effectIndex: copySelection.effectIndex,
      candidates: copySelection.candidates,
      dependencies,
    });
  }
  const copiedSource = copiedMoveActionSource(state, move, decision.actorId);
  if (copiedSource !== undefined) {
    return resolveConvertedAttackMove(
      state,
      decision,
      copiedMoveForAction(move, copiedSource.sourceMove, copiedSource.damageBonusPercent),
      dependencies,
      {
        copiedFromMoveId: copiedSource.sourceMove.id,
        copiedSourceMove: copiedSource.sourceMove,
        copiedDamageBonusPercent: copiedSource.damageBonusPercent,
      },
    );
  }
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

const currentBlockActionFor = (
  state: ActiveFightState,
  block: MoveDefinition,
  decisionId: CombatDecisionId,
  actorId: CombatantId,
  targetCombatantId: CombatantId,
): Extract<CombatActionRecord, { readonly type: "use-move" }> => ({
  type: "use-move",
  decisionId,
  actorId,
  targetCombatantId,
  moveId: block.id,
  turnNumber: state.turnNumber,
  phase: state.phase === "counter" ? "counter" : "action",
});

const resolvedBlockEffects = (
  state: ActiveFightState,
  block: MoveDefinition,
  defender: ActiveFightState["combatants"][CombatantId],
  attacker: ActiveFightState["combatants"][CombatantId],
  blockedAttackDamage?: number,
  triggeringMove?: MoveDefinition,
  enabledOptionalEffectIndices?: readonly number[],
  currentAction?: Extract<CombatActionRecord, { readonly type: "basic-attack" | "use-move" }>,
) => {
  const context = {
    self: defender,
    opponent: attacker,
    turnNumber: state.turnNumber,
    completedTurnCount: state.turnNumber - 1,
    moves: new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate])),
    moveActivationCounts: moveActivationCounts(state),
    successfulHitCount: 1,
    actionHistory: state.actionHistory,
    ...(currentAction === undefined ? {} : { currentAction }),
    ...(blockedAttackDamage === undefined ? {} : { blockedAttackDamage }),
    ...(triggeringMove === undefined
      ? {}
      : { triggeringMove, triggeringMoveOwner: "opponent" as const }),
    ...(enabledOptionalEffectIndices === undefined ? {} : { enabledOptionalEffectIndices }),
  };
  const successful = successfulMoveEffects(block, context);
  const pendingSuccessful = successfulMoveEffects(block, {
    ...context,
    successfulHitCount: 1,
    collectPendingChoices: true,
  });
  const stopped = stoppedMoveEffects(block, context);
  const combatResultOverrides = [
    ...successful.combatResultOverrides,
    ...stopped.combatResultOverrides,
  ];
  return {
    resources: [...successful.resources, ...stopped.resources],
    statuses: [...successful.statuses, ...stopped.statuses],
    remainingUseModifications: [
      ...successful.remainingUseModifications,
      ...stopped.remainingUseModifications,
    ],
    extraActions: successful.extraActions,
    pendingEffectChoices: pendingSuccessful.pendingEffectChoices,
    combatResultOverrides,
    floatingEffects: [...successful.floatingEffects, ...stopped.floatingEffects],
    stopsAllMatchingAttackDice: combatResultOverrides.some(
      (application) =>
        application.target === "opponent" &&
        application.result === "stopped" &&
        application.resultScope === "matching-die" &&
        triggeringMove !== undefined &&
        (application.selector === undefined ||
          matchesMoveSelector(triggeringMove, application.selector)),
    ),
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

const appendBlockRemainingUseModificationEvents = (
  state: ActiveFightState,
  dependencies: CombatDependencies,
  response: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
  attacker: CombatantState,
  defender: CombatantState,
  effects: ReturnType<typeof resolvedBlockEffects>,
  events: CombatEvent[],
) => {
  for (const application of effects.remainingUseModifications) {
    const target = application.target === "self" ? defender : attacker;
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
        sequence: state.eventSequence + events.length + 1,
        fightId: state.id,
        causedByDecisionId: response.id,
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
  appendBlockRemainingUseModificationEvents(
    state,
    dependencies,
    response,
    attacker,
    defender,
    effects,
    events,
  );
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
  const effects = resolvedBlockEffects(
    state,
    block,
    defender,
    attacker,
    basicAttackDamage(state, attacker, defender),
    undefined,
    undefined,
    currentBlockActionFor(state, block, response.id, defender.id, attacker.id),
  );
  const defenderAfterUseLimits = combatantAfterRemainingUseModifications(
    defender,
    effects.remainingUseModifications,
    "self",
  );
  const defenderAfter = statusesAfterApplications(
    resourceAfterChanges(
      {
        ...defenderAfterUseLimits,
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
    activeEffects: [
      ...baseState.activeEffects,
      ...activeFloatingEffectsFromApplications(
        effects.floatingEffects,
        defender.id,
        attacker.id,
        block.id,
        state.turnNumber,
        dependencies,
      ),
      ...activeCombatResultEffectsFromApplications(
        effects.combatResultOverrides,
        defender.id,
        attacker.id,
        block.id,
        dependencies,
      ),
    ],
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
  const pendingBlockChoice = effects.pendingEffectChoices.find((choice) =>
    choice.effectIndices.some((effectIndex) => {
      const effect = block.effects?.[effectIndex];
      return effect?.type === "grant-extra-action";
    }),
  );
  if (pendingBlockChoice !== undefined) {
    const selectedEffects = resolvedBlockEffects(
      state,
      block,
      defender,
      attacker,
      basicAttackDamage(state, attacker, defender),
      undefined,
      pendingBlockChoice.effectIndices,
    );
    const pendingAllowances = activeExtraActionsFromApplications(
      state,
      selectedEffects.extraActions,
      defender.id,
      attacker.id,
      block.id,
      state.turnNumber,
      dependencies,
    ).map((effect) => {
      const application = selectedEffects.extraActions.find(
        (candidate) => candidate.effectIndex === effect.sourceEffectIndex,
      );
      return application?.activationCost === undefined
        ? effect
        : { ...effect, activationCost: application.activationCost };
    });
    const pendingDecisionId = dependencies.ids.nextPendingDecisionId();
    const pendingVersion = nextState.version + 1;
    const allowance = pendingAllowances.find(() => true);
    if (allowance !== undefined) {
      return transitionFrom(
        {
          ...nextState,
          version: pendingVersion,
          activeEffects: [...nextState.activeEffects, ...pendingAllowances],
          pendingDecision: {
            id: pendingDecisionId,
            stateVersion: pendingVersion,
            combatantId: defender.id,
            type: "optional-effect",
            options: [
              {
                id: `activate-effect:${pendingBlockChoice.effectIndices.join(",")}`,
                type: "activate-effect",
                moveId: block.id,
                effectIndices: pendingBlockChoice.effectIndices,
              },
              { id: "decline", type: "decline" },
            ],
          },
          resolutionFrames: [
            {
              id: dependencies.ids.nextResolutionFrameId(),
              type: "effect",
              sourceCombatantId: defender.id,
              targetCombatantId: defender.id,
              sourceDefinitionId: block.id,
              effectIndex: pendingBlockChoice.effectIndices[0],
              operation: "activate-extra-action",
              returnPhase: "end",
              trigger: "on-success",
              pendingDecisionId,
              activeEffectId: allowance.id,
              activationCost: allowance.activationCost,
              optional: true,
            },
          ],
        },
        events,
      );
    }
  }
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
  const blockEffects = resolvedBlockEffects(
    state,
    block,
    resolvedDefender,
    attacker,
    undefined,
    move,
  );
  if (eligibility.stopsAttack) {
    blockedDice =
      block.mechanics.block?.stopsAllDice === true || blockEffects.stopsAllMatchingAttackDice
        ? dice
        : blockedDiceForDeclaredBlock(dice);
  }
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
      ...(frame.attack.type === "move" ? copiedAttackResolutionOptions(frame.attack) : {}),
      blockedDice,
      blockUsage: { block, cost, defender: resolvedDefender, response },
      defenseResponse: { blockUsed: true, resultModified: false, rerolled: false },
      ...(frame.costEffectSourceDefinitionId === undefined
        ? {}
        : { costEffectSourceDefinitionId: frame.costEffectSourceDefinitionId }),
      ...(frame.costEffectIndices === undefined
        ? {}
        : { costEffectIndices: frame.costEffectIndices }),
      ...(frame.costEffectTrigger === undefined
        ? {}
        : { costEffectTrigger: frame.costEffectTrigger }),
      ...(frame.costEffectOwnerId === undefined
        ? {}
        : { costEffectOwnerId: frame.costEffectOwnerId }),
      ...(frame.deferredExecution === undefined
        ? {}
        : { deferredExecution: frame.deferredExecution }),
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

const selectedBeforeDefenseRerolls = (
  state: ActiveFightState,
  frame: Extract<
    ActiveFightState["resolutionFrames"][number],
    { readonly stage: "awaiting-defense" }
  >,
  choice: BeforeDefenseEffectChoice,
  dependencies: CombatDependencies,
) => {
  const attacker = state.combatants[frame.attackerId];
  const defender = state.combatants[frame.targetCombatantId];
  const effects = selectedBeforeDefenseEffects(state, frame, choice);
  return activeRerollsFromApplications(
    effects?.rerolls ?? [],
    defender.id,
    attacker.id,
    dependencies,
  );
};

const selectedBeforeDefenseEffects = (
  state: ActiveFightState,
  frame: Extract<
    ActiveFightState["resolutionFrames"][number],
    { readonly stage: "awaiting-defense" }
  >,
  choice: BeforeDefenseEffectChoice,
) => {
  const sourceMove = MOVE_DEFINITIONS.find((move) => move.id === choice.sourceDefinitionId);
  if (sourceMove === undefined) return undefined;
  const attacker = state.combatants[frame.attackerId];
  const defender = state.combatants[frame.targetCombatantId];
  const triggeringMove =
    frame.attack.type === "move" ? moveForAttackReference(frame.attack) : undefined;
  const moves = new Map(MOVE_DEFINITIONS.map((move) => [move.id, move]));
  return moveEffectsForTrigger(sourceMove, "before-defense-roll", {
    self: defender,
    opponent: attacker,
    turnNumber: state.turnNumber,
    completedTurnCount: state.turnNumber - 1,
    moves,
    moveActivationCounts: moveActivationCounts(state),
    successfulHitCount: 0,
    actionHistory: state.actionHistory,
    activeEffects: state.activeEffects,
    mode: state.mode,
    collectPendingChoices: true,
    enabledOptionalEffectIndices: choice.effectIndices,
    ...(triggeringMove === undefined
      ? {}
      : { triggeringMove, triggeringMoveOwner: "opponent" as const }),
  });
};

const preparedDefenseState = (
  state: ActiveFightState,
  frame: Extract<
    ActiveFightState["resolutionFrames"][number],
    { readonly stage: "awaiting-defense" }
  >,
  beforeDefenseChoice: BeforeDefenseEffectChoice | undefined,
  dependencies: CombatDependencies,
) => {
  const baseState = withoutPendingResolution(state);
  if (beforeDefenseChoice === undefined) return baseState;
  const selectedEffects = selectedBeforeDefenseRerolls(
    state,
    frame,
    beforeDefenseChoice,
    dependencies,
  );
  return selectedEffects.length === 0
    ? baseState
    : { ...baseState, activeEffects: [...baseState.activeEffects, ...selectedEffects] };
};

const selectedBeforeDefenseResolutionOptions = (
  effects: ReturnType<typeof moveEffectsForTrigger> | undefined,
  onDamageSelection:
    { readonly sourceDefinitionId: MoveId; readonly effectIndices: readonly number[] } | undefined,
  diceCount: number,
  sourceDefinitionId: MoveId | undefined,
) => ({
  ...(effects?.rollResultOverrides.find(
    (effect) => effect.target === "self" && effect.roll === "defense",
  )?.value === undefined
    ? {}
    : {
        numericResultOverrides: [
          {
            defense: effects.rollResultOverrides.find(
              (effect) => effect.target === "self" && effect.roll === "defense",
            )!.value,
          },
        ],
      }),
  ...(effects?.counterActions.find(
    (effect) => effect.target === "self" && effect.action === "use-source-attack",
  ) === undefined
    ? {}
    : {
        counterAction: counterActionReferenceFor(
          effects.counterActions.find(
            (effect) => effect.target === "self" && effect.action === "use-source-attack",
          )!,
        ),
      }),
  ...(effects === undefined
    ? {}
    : { selectedBeforeDefenseDamageModifications: effects.damageModifications }),
  ...(effects === undefined || sourceDefinitionId === undefined
    ? {}
    : {
        selectedBeforeDefenseEffects: effects,
        selectedBeforeDefenseSourceDefinitionId: sourceDefinitionId,
        preventDamage: effects.negations.some(
          (effect) => effect.target === "opponent" && effect.aspects.includes("prevent-damage"),
        ),
      }),
  ...(effects?.combatResultOverrides.some(
    (effect) => effect.target === "self" && effect.resultScope === "matching-die",
  )
    ? {
        resultOverrides: Array.from({ length: diceCount }, () => {
          const result = effects.combatResultOverrides.find(
            (effect) => effect.target === "self" && effect.resultScope === "matching-die",
          )?.result;
          return result === "successful" || result === "stopped" ? result : undefined;
        }),
      }
    : {}),
  ...(onDamageSelection === undefined
    ? {}
    : {
        damageEffectSourceDefinitionId: onDamageSelection.sourceDefinitionId,
        damageEffectIndices: onDamageSelection.effectIndices,
      }),
});
const selectedBeforeDefenseOnDamageSelection = (
  choice: BeforeDefenseEffectChoice,
):
  | { readonly sourceDefinitionId: MoveId; readonly effectIndices: readonly number[] }
  | undefined => {
  const sourceMove = MOVE_DEFINITIONS.find((move) => move.id === choice.sourceDefinitionId);
  if (sourceMove === undefined) return undefined;
  const groupKey =
    sourceMove.effects?.[choice.effectIndices[0] ?? -1]?.activationGroup ??
    sourceMove.effects?.[choice.effectIndices[0] ?? -1]?.exclusiveActivationGroup;
  if (groupKey === undefined) return undefined;
  const effectIndices = sourceMove.effects
    ?.map((effect, effectIndex) =>
      effect.trigger === "on-damage" &&
      (effect.activationGroup ?? effect.exclusiveActivationGroup) === groupKey
        ? effectIndex
        : undefined,
    )
    .filter((effectIndex): effectIndex is number => effectIndex !== undefined);
  return effectIndices === undefined || effectIndices.length === 0
    ? undefined
    : { sourceDefinitionId: sourceMove.id, effectIndices };
};

const selectedBeforeDefenseSelections = (
  state: ActiveFightState,
  frame: Extract<
    ActiveFightState["resolutionFrames"][number],
    { readonly stage: "awaiting-defense" }
  >,
  choice: BeforeDefenseEffectChoice | undefined,
) =>
  choice === undefined
    ? { effects: undefined, onDamage: undefined }
    : {
        effects: selectedBeforeDefenseEffects(state, frame, choice),
        onDamage: selectedBeforeDefenseOnDamageSelection(choice),
      };

const defenseRollModifiers = (
  defenseItemUse: ReturnType<typeof defenseItemUseForOption>,
  decision: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
) =>
  defenseItemUse === undefined
    ? {}
    : {
        defenseItemUse: { ...defenseItemUse, response: decision },
        ...(defenseItemUse.modifier === undefined
          ? {}
          : { defenseResultModifier: defenseItemUse.modifier.amount }),
      };

/* eslint-disable sonarjs/cognitive-complexity -- defense response assembly preserves deterministic persisted resolution order. */
const resolveDefenseRoll = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
  frame: Extract<
    ActiveFightState["resolutionFrames"][number],
    { readonly stage: "awaiting-defense" }
  >,
  dependencies: CombatDependencies,
  defenseItemUse: ReturnType<typeof defenseItemUseForOption>,
  beforeDefenseChoice?: BeforeDefenseEffectChoice,
): CombatResult<CombatTransition> => {
  const modifiers = defenseRollModifiers(defenseItemUse, decision);
  const pendingAttack = frame.attack;
  const selectedBeforeDefense = selectedBeforeDefenseSelections(state, frame, beforeDefenseChoice);
  const preparedState = preparedDefenseState(state, frame, beforeDefenseChoice, dependencies);
  if (pendingAttack.type === "move") {
    const move = moveForAttackReference(pendingAttack);
    if (move === undefined) return { ok: false, error: invalidFightState(state) };
    return resolveConvertedAttackMove(
      preparedState,
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
        ...copiedAttackResolutionOptions(pendingAttack),
        ...modifiers,
        ...selectedBeforeDefenseResolutionOptions(
          selectedBeforeDefense.effects,
          selectedBeforeDefense.onDamage,
          pendingAttack.type === "move"
            ? (moveForAttackReference(pendingAttack)?.mechanics.attack?.attackRoll?.dice ?? 1)
            : 1,
          beforeDefenseChoice?.sourceDefinitionId,
        ),
        ...deferredExecutionOptionFor(frame.deferredExecution),
        defenseResponse: { blockUsed: false, resultModified: false, rerolled: false },
        ...(frame.enabledOptionalEffectIndices === undefined
          ? {}
          : { enabledOptionalEffectIndices: frame.enabledOptionalEffectIndices }),
        ...(frame.resolvedOptionalEffectIndices === undefined
          ? {}
          : { resolvedOptionalEffectIndices: frame.resolvedOptionalEffectIndices }),
        ...(frame.costEffectSourceDefinitionId === undefined
          ? {}
          : { costEffectSourceDefinitionId: frame.costEffectSourceDefinitionId }),
        ...(frame.costEffectIndices === undefined
          ? {}
          : { costEffectIndices: frame.costEffectIndices }),
        ...(frame.costEffectTrigger === undefined
          ? {}
          : { costEffectTrigger: frame.costEffectTrigger }),
        ...(frame.costEffectOwnerId === undefined
          ? {}
          : { costEffectOwnerId: frame.costEffectOwnerId }),
      },
    );
  }
  return resolveBasicAttack(
    preparedState,
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
/* eslint-enable sonarjs/cognitive-complexity */

type DefenseResponseInput = {
  readonly pending: PendingDecision & { readonly type: "defense-response" };
  readonly option: PendingDecisionOption;
  readonly frame: Extract<
    ActiveFightState["resolutionFrames"][number],
    { readonly stage: "awaiting-defense" }
  >;
};

const defenseResponseInput = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
): DefenseResponseInput | CombatFailure => {
  const pending = state.pendingDecision;
  if (
    pending === undefined ||
    pending.type !== "defense-response" ||
    pending.id !== decision.pendingDecisionId
  )
    return {
      type: "no-pending-decision",
      pendingDecisionId: decision.pendingDecisionId,
    };
  if (decision.actorId !== pending.combatantId)
    return {
      type: "not-active-combatant",
      combatantId: decision.actorId,
      activeCombatantId: pending.combatantId,
    };
  const defensePending = pending as PendingDecision & { readonly type: "defense-response" };
  const option = defensePending.options.find((candidate) => candidate.id === decision.optionId);
  if (option === undefined)
    return {
      type: "invalid-pending-decision-option",
      pendingDecisionId: defensePending.id,
      optionId: decision.optionId,
    };
  const frame = state.resolutionFrames.find(
    (candidate): candidate is DefenseResponseInput["frame"] =>
      candidate.type === "attack" &&
      candidate.stage === "awaiting-defense" &&
      candidate.pendingDecisionId === defensePending.id,
  );
  return frame === undefined
    ? invalidFightState(state)
    : { pending: defensePending, option, frame };
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

const moveForAttackReference = (attack: CopiedMoveAttackReference): MoveDefinition | undefined => {
  const copyingMove = MOVE_DEFINITIONS.find((candidate) => candidate.id === attack.moveId);
  if (copyingMove === undefined) return undefined;
  if (
    attack.copiedFromMoveId === undefined &&
    attack.copiedSourceMove === undefined &&
    attack.copiedDamageBonusPercent === undefined &&
    attack.copiedDamageOverride === undefined &&
    attack.copiedSuccessfulEffectsOnly === undefined &&
    attack.copiedSourceResolution === undefined
  )
    return copyingMove;
  if (attack.copiedFromMoveId === undefined) return undefined;
  const sourceMove =
    attack.copiedSourceMove ??
    MOVE_DEFINITIONS.find((candidate) => candidate.id === attack.copiedFromMoveId);
  if (
    sourceMove === undefined ||
    (attack.copiedDamageBonusPercent !== undefined &&
      !Number.isFinite(attack.copiedDamageBonusPercent)) ||
    (attack.copiedDamageOverride !== undefined &&
      (!Number.isFinite(attack.copiedDamageOverride) || attack.copiedDamageOverride < 0))
  )
    return undefined;
  if (attack.copiedDamageOverride !== undefined)
    return copiedMoveForFixedDamage(copyingMove, sourceMove);
  return copiedMoveForAction(
    copyingMove,
    sourceMove,
    attack.copiedDamageBonusPercent,
    attack.copiedSuccessfulEffectsOnly,
  );
};

const pendingAttackMove = (
  attack: PostDefenseReactionFrame["attack"],
): MoveDefinition | undefined =>
  attack.type === "move" ? moveForAttackReference(attack) : undefined;

const copiedAttackResolutionOptions = (attack: CopiedMoveAttackReference) => ({
  ...(attack.copiedFromMoveId === undefined ? {} : { copiedFromMoveId: attack.copiedFromMoveId }),
  ...(attack.copiedSourceMove === undefined ? {} : { copiedSourceMove: attack.copiedSourceMove }),
  ...(attack.copiedDamageBonusPercent === undefined
    ? {}
    : { copiedDamageBonusPercent: attack.copiedDamageBonusPercent }),
  ...(attack.copiedDamageOverride === undefined
    ? {}
    : {
        baseDamageOverride: attack.copiedDamageOverride,
        copiedDamageOverride: attack.copiedDamageOverride,
      }),
  ...(attack.copiedSuccessfulEffectsOnly === undefined
    ? {}
    : { copiedSuccessfulEffectsOnly: attack.copiedSuccessfulEffectsOnly }),
  ...(attack.copiedSourceResolution === undefined
    ? {}
    : { copiedSourceResolution: attack.copiedSourceResolution }),
});

type RerollRuntimeFrame = Pick<
  PostDefenseReactionFrame,
  "attackerId" | "targetCombatantId" | "attack"
>;

const rerollRuntimeContext = (
  state: ActiveFightState,
  frame: RerollRuntimeFrame,
  combatantId: CombatantId,
  rolls: readonly (AttackDieRoll | PostDefenseReactionRoll)[],
) => {
  const self = state.combatants[combatantId];
  const opponentId = combatantId === frame.attackerId ? frame.targetCombatantId : frame.attackerId;
  const triggeringMove = pendingAttackMove(frame.attack);
  const runtimeRolls: AttackDieRoll[] = rolls.map((roll) =>
    "outcome" in roll
      ? roll
      : {
          ...roll,
          outcome:
            roll.attackResult >= roll.defenseResult
              ? ("successful" as const)
              : ("stopped" as const),
        },
  );
  return {
    self,
    opponent: state.combatants[opponentId],
    turnNumber: state.turnNumber,
    completedTurnCount: state.turnNumber - 1,
    moves: new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate])),
    moveActivationCounts: moveActivationCounts(state),
    successfulHitCount: runtimeRolls.filter((roll) => roll.outcome === "successful").length,
    actionHistory: state.actionHistory,
    activeEffects: state.activeEffects,
    rolls: runtimeRolls,
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
    const candidates = [
      ...(roll === "defense"
        ? rolls.map((candidate, dieIndex) => ({
            rolls: [candidate] as readonly PostDefenseReactionRoll[],
            dieIndex,
            trigger: "after-defense-roll" as const,
          }))
        : [
            {
              rolls,
              dieIndex: undefined,
              trigger: "after-defense-roll" as const,
            },
          ]),
      ...rolls.map((candidate, dieIndex) => ({
        rolls: [candidate] as readonly PostDefenseReactionRoll[],
        dieIndex,
        trigger: "on-roll-result" as const,
      })),
    ];
    return candidates.flatMap(({ rolls: candidateRolls, dieIndex, trigger }) => {
      const context = rerollRuntimeContext(state, frame, combatantId, candidateRolls);
      const applications =
        trigger === "after-defense-roll"
          ? rerollEffectsAfterDefense(move, context)
          : rerollEffectsOnRollResult(move, { ...context, collectPendingChoices: true });
      return applications.flatMap((application) => {
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
          application.effectIndex,
          application.trigger === "on-roll-result",
        );
        if (withEffectLimit === undefined) return [];
        return [
          {
            application,
            move,
            actorId: combatantId,
            ...(application.rerollScope === "single-result" && dieIndex !== undefined
              ? { dieIndex }
              : {}),
            ...withEffectLimit,
          },
        ];
      });
    });
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
  const move = pendingAttack.type === "move" ? moveForAttackReference(pendingAttack) : undefined;
  return (
    availablePostRollDefenseItems(defender).length > 0 ||
    hasActiveConstant(state, defender.id, "move-aoyosumu-close-shave") ||
    hasPostDefenseRerollPotential(state, defender.id, "defense", move) ||
    hasRerollDefinition(defender) ||
    eligibleRerollsForPostDefense(state, frame).some(
      (effect) => effect.targetCombatantId === defender.id,
    ) ||
    hasCounterActionPotential(state, defender.id) ||
    hasCombatResultReactionPotential(state, frame) ||
    hasPostDefenseRerollPotential(state, attacker.id, "attack", move) ||
    hasRerollDefinition(attacker) ||
    eligibleRerollsForPostDefense(state, frame).some(
      (effect) => effect.targetCombatantId === attacker.id,
    ) ||
    hasCounterActionPotential(state, attacker.id) ||
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
  const move = moveForAttackReference(pendingAttack);
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
  if (frame.attack.type !== "move") return undefined;
  const move = moveForAttackReference(frame.attack);
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
  return frame.attack.type === "move" ? moveForAttackReference(frame.attack) : undefined;
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
  const source = state.combatants[effect.sourceCombatantId];
  const opponent = Object.values(state.combatants).find(
    (combatant) => combatant.id !== source.id && combatant.status === "active",
  );
  if (opponent === undefined) return false;
  const triggeringMove = moveForPostDefenseFrame(frame);
  return effectConditionsMatch(effect.conditions, {
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
    const durationMatches =
      effect.duration.type === "combat" ||
      (effect.duration.combatantId === ownerId &&
        (effect.duration.type === "next-action" || effect.duration.roll === effect.roll));
    return (
      effect.targetCombatantId === ownerId &&
      durationMatches &&
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

const mandatoryRerollPresent = (effects: readonly ActiveRerollEffect[]) =>
  effects.some((effect) => !effect.optional);

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
    (option) => rerollEffectForOption(state, option.id)?.targetCombatantId === combatantId,
  );

const counterActionReferenceFor = (
  application: CounterActionApplication,
): CounterActionReference => ({
  action: application.action,
  sourceDefinitionId: application.sourceDefinitionId,
  sourceEffectIndex: application.effectIndex,
  stopsTriggeringAttack: application.stopsTriggeringAttack,
  ignoreRequirements: application.ignoreRequirements,
  ...(application.activationCost === undefined
    ? {}
    : { activationCost: application.activationCost }),
  ...(application.costModifier === undefined ? {} : { costModifier: application.costModifier }),
  ...(application.sourceAction === undefined ? {} : { sourceAction: application.sourceAction }),
  ...(application.sourceMove === undefined ? {} : { sourceMoveSnapshot: application.sourceMove }),
});

const counterActionSourceMoves = (state: ActiveFightState, combatantId: CombatantId) => {
  const sourceIds = new Set(state.combatants[combatantId].moveIds);
  for (const effect of state.activeEffects) {
    if (
      effect.type === "active-constant" &&
      effect.lifecycle !== "deactivated" &&
      !activeEffectSuppressed(state, effect) &&
      effect.sourceCombatantId === combatantId
    )
      sourceIds.add(effect.sourceDefinitionId);
  }
  return [...sourceIds].flatMap((sourceId) => {
    const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === sourceId);
    return move === undefined ? [] : [move];
  });
};

const counterActionOptionId = (application: CounterActionApplication) =>
  `activate-counter-action:${application.sourceDefinitionId}:${application.effectIndex}`;

const counterActionCanBePaid = (
  combatant: CombatantState,
  application: CounterActionApplication,
) => {
  const activationCost = application.activationCost;
  return (
    activationCost === undefined ||
    (combatant.ki.current - activationCost.amount >= 0 &&
      (activationCost.minimum === undefined ||
        combatant.ki.current - activationCost.amount >= activationCost.minimum))
  );
};

const counterActionOptionsForCombatant = (
  state: ActiveFightState,
  frame: Pick<PostDefenseReactionFrame, "attackerId" | "targetCombatantId" | "attack">,
  rolls: readonly PostDefenseReactionRoll[],
  combatantId: CombatantId,
): PendingDecisionOption[] => {
  const opponentId = combatantId === frame.attackerId ? frame.targetCombatantId : frame.attackerId;
  const triggeringMove = pendingAttackMove(frame.attack);
  if (triggeringMove === undefined) return [];
  const owner = state.combatants[combatantId];
  const opponent = state.combatants[opponentId];
  const moves = new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate]));
  const runtimeRolls = rolls.map((roll) => ({
    attackNaturalResult: roll.attackNaturalResult,
    attackResult: roll.attackResult,
    defenseNaturalResult: roll.defenseNaturalResult,
    defenseResult: roll.defenseResult,
    outcome:
      roll.attackResult >= roll.defenseResult ? ("successful" as const) : ("stopped" as const),
  }));
  return counterActionSourceMoves(state, combatantId).flatMap((sourceMove) => {
    const effects = moveEffectsForTrigger(sourceMove, "after-defense-roll", {
      self: owner,
      opponent,
      turnNumber: state.turnNumber,
      completedTurnCount: state.turnNumber - 1,
      moves,
      moveActivationCounts: moveActivationCounts(state),
      successfulHitCount: runtimeRolls.filter((roll) => roll.outcome === "successful").length,
      actionHistory: state.actionHistory,
      activeEffects: state.activeEffects,
      rolls: runtimeRolls,
      mode: state.mode,
      triggeringMove,
      triggeringMoveOwner: combatantId === frame.attackerId ? "self" : "opponent",
    });
    return effects.counterActions.flatMap((application) => {
      if (application.target !== "self" || application.action !== "choose-attack") return [];
      const useLimit = application.useLimit;
      if (
        useLimit !== undefined &&
        (owner.effectUseCounts?.[`${application.sourceDefinitionId}:${application.effectIndex}`] ??
          0) >= useLimit.count
      )
        return [];
      if (!counterActionCanBePaid(owner, application)) return [];
      return [
        {
          id: counterActionOptionId(application),
          type: "activate-effect" as const,
          moveId: sourceMove.id,
          effectIndices: [application.effectIndex],
          counterAction: counterActionReferenceFor(application),
        },
      ];
    });
  });
};

const hasCounterActionPotential = (state: ActiveFightState, combatantId: CombatantId) =>
  counterActionSourceMoves(state, combatantId).some((move) =>
    (move.effects ?? []).some(
      (effect) => effect.type === "grant-counter-action" && effect.trigger === "after-defense-roll",
    ),
  );

const automaticCounterActionFor = (
  state: ActiveFightState,
  counteringCombatant: CombatantState,
  triggered: readonly {
    readonly owner: CombatantState;
    readonly effects: ReturnType<typeof moveEffectsForTrigger>;
  }[],
) =>
  triggered
    .filter(({ owner }) => owner.id === counteringCombatant.id)
    .flatMap(({ effects }) =>
      effects.counterActions.filter(
        (application) =>
          application.target === "self" &&
          application.action === "repeat-triggering-attack" &&
          application.sourceAction !== undefined &&
          counterActionCanBePaid(counteringCombatant, application) &&
          (application.useLimit === undefined ||
            (counteringCombatant.effectUseCounts?.[
              `${application.sourceDefinitionId}:${application.effectIndex}`
            ] ?? 0) < application.useLimit.count),
      ),
    )
    .at(0);

const automaticCounterActionResolution = (
  input: CompleteConvertedAttackInput,
  target: CombatantState,
  triggered: readonly {
    readonly owner: CombatantState;
    readonly effects: ReturnType<typeof moveEffectsForTrigger>;
  }[],
) => {
  const application = automaticCounterActionFor(input.state, target, triggered);
  const counterAction =
    input.counterAction ??
    (application === undefined ? undefined : counterActionReferenceFor(application));
  const activationChanges =
    application?.activationCost === undefined || input.counterActionActivationCostPaid === true
      ? []
      : [
          {
            resource: "ki" as const,
            target: "opponent" as const,
            operation: "lose" as const,
            amount: application.activationCost.amount,
            sourceCombatantId: target.id,
            sourceEffectIndex: application.effectIndex,
            cause: "non-damage-effect" as const,
          },
        ];
  return { application, counterAction, activationChanges };
};

const counterAttackRequested = (
  rolledCounter: boolean,
  counterAction: CounterActionReference | undefined,
) => rolledCounter || counterAction !== undefined;

const counterContinuationState = (
  state: ActiveFightState,
  rolledCounter: boolean,
  counterAction: CounterActionReference | undefined,
  defeated: boolean,
) => {
  const requested = counterAttackRequested(rolledCounter, counterAction);
  const counterChainLimitReached =
    requested &&
    state.phase === "counter" &&
    !canContinueCounterChain(consecutiveCounterAttackCount(state) + 1);
  return {
    counterChainLimitReached,
    counterContinues: requested && !counterChainLimitReached && !defeated,
  };
};

const automaticCounterEffectUses = (
  application: CounterActionApplication | undefined,
  counteringCombatantId: CombatantId,
) =>
  application === undefined
    ? []
    : [
        {
          combatantId: counteringCombatantId,
          key: `${application.sourceDefinitionId}:${application.effectIndex}`,
        },
      ];

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
  const defenderRerolls = availablePostDefenseRerolls(
    state,
    frame,
    defender.id,
    "defense",
    resolvedRolls,
  );
  const defenderOptions = [
    ...combatResultReactionOptions(state, frame, defender.id, resolvedRolls),
    ...combatResultNegationOptions(state, frame, defender.id, resolvedRolls),
    ...closeShaveReactionOptions(state, defender.id),
    ...rerollOptions(defenderRerolls),
    ...rerollOptionsForCombatant(state, frame, rolls, defender.id),
    ...counterActionOptionsForCombatant(state, frame, rolls, defender.id),
    ...availablePostRollDefenseItems(defender).map(({ item }) => ({
      id: `activate-item:${item.id}`,
      type: "activate-effect" as const,
      itemId: item.id,
    })),
  ];
  const attackerOptions = [
    ...combatResultReactionOptions(state, frame, attacker.id, resolvedRolls),
    ...combatResultNegationOptions(state, frame, attacker.id, resolvedRolls),
  ];
  const attackerRerolls = availablePostDefenseRerolls(
    state,
    frame,
    attacker.id,
    "attack",
    resolvedRolls,
  );
  attackerOptions.push(...rerollOptions(attackerRerolls));
  attackerOptions.push(...counterActionOptionsForCombatant(state, frame, rolls, attacker.id));
  attackerOptions.push(
    ...postDefenseEffectChoices(state, frame, rolls).map((choice) => ({
      id: `activate-effect:${choice.effectIndices.join(",")}`,
      type: "activate-effect" as const,
      moveId: choice.sourceDefinitionId,
      effectIndices: choice.effectIndices,
    })),
  );
  const genericAttackerOptions = rerollOptionsForCombatant(state, frame, rolls, attacker.id);
  const mandatoryDefenderReroll = mandatoryRerollPresent(
    eligibleRerollsForPostDefense(state, frame, rolls).filter(
      (effect) => effect.targetCombatantId === defender.id,
    ),
  );
  const mandatoryAttackerReroll = mandatoryRerollPresent(
    eligibleRerollsForPostDefense(state, frame, rolls).filter(
      (effect) => effect.targetCombatantId === attacker.id,
    ),
  );
  const reactionCombatantId = defenderOptions.length > 0 ? defender.id : attacker.id;
  const options =
    reactionCombatantId === defender.id
      ? defenderOptions
      : [...attackerOptions, ...genericAttackerOptions];
  return options.length === 0
    ? undefined
    : {
        combatantId: reactionCombatantId,
        options,
        allowDecline:
          reactionCombatantId === defender.id ? !mandatoryDefenderReroll : !mandatoryAttackerReroll,
      };
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
      options: [
        ...(reaction.allowDecline ? [{ id: "decline", type: "decline" as const }] : []),
        ...reaction.options,
      ],
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
        resultOverrides: automaticCombatResultOverrides(state, frame, rolls),
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
      combatResultOverride: undefined,
      combatResultNegation: undefined,
      reroll: undefined,
      secondChanceDie: undefined,
      rerollEffect: undefined,
      rerollDieIndex: undefined,
      afterDefenseEffectIndices: undefined,
      counterAction: undefined,
    };
  const availability = postDefenseReactionSelectionAvailability(state, decision, frame, option);
  if (
    availability.itemUse === undefined &&
    !availability.canUseCloseShave &&
    !availability.canUseCombatResultOverride &&
    !availability.canUseCombatResultNegation &&
    availability.reroll === undefined &&
    !availability.canUseActiveReroll &&
    !availability.canUseAfterDefenseEffects &&
    availability.counterAction === undefined
  )
    return undefined;
  return {
    itemUse: availability.itemUse,
    closeShaveKiLoss: availability.closeShaveKiLoss,
    combatResultOverride: availability.combatResultOverride,
    combatResultNegation: availability.canUseCombatResultNegation
      ? availability.combatResultNegation
      : undefined,
    reroll: availability.reroll,
    secondChanceDie: undefined,
    rerollEffect: availability.rerollEffect,
    rerollDieIndex: availability.rerollDieIndex,
    afterDefenseEffectIndices: availability.afterDefenseEffectIndices,
    counterAction: availability.counterAction,
  };
};

const postDefenseReactionEventCount = (
  reactionKiCost: number | undefined,
  combatResultOverride: PendingDecisionOption["combatResultOverride"],
  combatResultNegation: PendingDecisionOption["combatResultNegation"],
  reroll: PostDefenseRerollChoice | undefined,
  secondChanceDie: number | undefined,
  rerollEventCount: number,
) => {
  let count = 0;
  if (reactionKiCost !== undefined && reactionKiCost !== 0) count += 1;
  if (combatResultOverride !== undefined) count += 1;
  if (combatResultNegation !== undefined) count += 1;
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
  combatResultOverride: PendingDecisionOption["combatResultOverride"],
  combatResultNegation: PendingDecisionOption["combatResultNegation"],
  reroll: PostDefenseRerollChoice | undefined,
  secondChanceDie: number | undefined,
  rerollEffect: ActiveRerollEffect | undefined,
  counterAction: CounterActionReference | undefined,
  rerollEventCount: number,
  dependencies: CombatDependencies,
): ActiveFightState => {
  if (
    reactionKiCost === undefined &&
    reroll === undefined &&
    secondChanceDie === undefined &&
    rerollEffect === undefined &&
    counterAction === undefined
  )
    return baseState;
  const actor = baseState.combatants[actorId];
  const moveUses = { ...actor.moveUses };
  if (combatResultOverride !== undefined)
    moveUses[combatResultOverride.sourceDefinitionId] =
      (moveUses[combatResultOverride.sourceDefinitionId] ?? 0) + 1;
  if (reroll?.consumesMoveUse === true)
    moveUses[reroll.move.id] = (moveUses[reroll.move.id] ?? 0) + 1;
  const effectUseCounts = {
    ...(actor.effectUseCounts ?? {}),
    ...(counterAction === undefined
      ? {}
      : {
          [`${counterAction.sourceDefinitionId}:${counterAction.sourceEffectIndex}`]:
            (actor.effectUseCounts?.[
              `${counterAction.sourceDefinitionId}:${counterAction.sourceEffectIndex}`
            ] ?? 0) + 1,
        }),
    ...(reroll?.application.useLimit === undefined
      ? {}
      : {
          [`${reroll.application.sourceDefinitionId}:${reroll.application.effectIndex}`]:
            (actor.effectUseCounts?.[
              `${reroll.application.sourceDefinitionId}:${reroll.application.effectIndex}`
            ] ?? 0) + 1,
        }),
  };
  const opponentId = Object.values(baseState.combatants).find(
    (combatant) => combatant.id !== actorId,
  )?.id;
  const activatedReroll =
    reroll !== undefined &&
    reroll.application.trigger !== "on-roll-result" &&
    opponentId !== undefined
      ? activeRerollFromApplication(reroll.application, actorId, opponentId, dependencies)
      : undefined;
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
        combatResultOverride,
        combatResultNegation,
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
        ...(Object.keys(effectUseCounts).length === 0 ? {} : { effectUseCounts }),
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
  readonly combatResultNegation: PendingDecisionOption["combatResultNegation"];
  readonly combatResultOverride: PendingDecisionOption["combatResultOverride"];
  readonly counterAction: CounterActionReference | undefined;
  readonly rerolled: boolean;
}

const postDefenseReactionModifiers = ({
  defenseItemUse,
  defenseResultModifier,
  naturalRolls,
  resultOverrides,
  numericResultOverrides,
  afterDefenseEffectIndices,
  combatResultNegation,
  combatResultOverride,
  counterAction,
  rerolled,
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
    ...(combatResultNegation?.outcome === "critical" ? { preventCritical: true } : {}),
    ...(combatResultNegation?.outcome === "counter" ? { preventCounter: true } : {}),
    ...(combatResultNegation?.outcome === "stun" ? { preventStun: true } : {}),
    ...(afterDefenseEffectIndices === undefined
      ? {}
      : { enabledAfterDefenseEffectIndices: afterDefenseEffectIndices }),
    defenseResponse: {
      blockUsed: false,
      resultModified:
        totalDefenseResultModifier !== 0 ||
        combatResultOverride !== undefined ||
        combatResultNegation !== undefined,
      rerolled,
    },
    ...(counterAction === undefined ? {} : { counterAction }),
    ...(counterAction === undefined ? {} : { counterActionActivationCostPaid: true }),
  };
};

const requestAttackerPostDefenseReaction = (
  state: ActiveFightState,
  frame: PostDefenseReactionFrame,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> | undefined => {
  const attacker = state.combatants[frame.attackerId];
  const rolls = postDefenseFrameRolls(state, frame);
  const options = combatResultReactionOptions(state, frame, attacker.id, rolls);
  options.push(...combatResultNegationOptions(state, frame, attacker.id, rolls));
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

const combatResultNegationOptionIsAvailable = (
  state: ActiveFightState,
  frame: PostDefenseReactionFrame,
  combatantId: CombatantId,
  rolls: readonly AttackDieRoll[],
  optionId: string,
  selection: PendingDecisionOption["combatResultNegation"],
) =>
  selection !== undefined &&
  combatResultNegationOptions(state, frame, combatantId, rolls).some(
    (candidate) => candidate.id === optionId,
  );

const activeRerollOptionIsAvailable = (
  state: ActiveFightState,
  frame: PostDefenseReactionFrame,
  rolls: readonly PostDefenseReactionRoll[],
  optionId: string,
  rerollEffect: ActiveRerollEffect | undefined,
) =>
  rerollEffect !== undefined &&
  rerollOptionsForPostDefense(state, frame, rolls).some((candidate) => candidate.id === optionId);

const counterActionForPostDefenseOption = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
  frame: PostDefenseReactionFrame,
  option: PendingDecisionOption,
) =>
  option.counterAction === undefined
    ? undefined
    : counterActionOptionsForCombatant(
        state,
        frame,
        postDefenseFrameRolls(state, frame).map((roll) => ({
          attackNaturalResult: roll.attackNaturalResult,
          attackResult: roll.attackResult,
          defenseNaturalResult: roll.defenseNaturalResult!,
          defenseResult: roll.defenseResult!,
        })),
        decision.actorId,
      ).find((candidate) => candidate.id === option.id)?.counterAction;

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
  const combatResultOverride = option.combatResultOverride;
  const combatResultNegation = option.combatResultNegation;
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
    option.type === "activate-effect" &&
    option.combatResultOverride === undefined &&
    option.combatResultNegation === undefined
      ? option.effectIndices
      : undefined;
  const actor = state.combatants[decision.actorId];
  const canUseCloseShave =
    closeShaveKiLoss !== undefined &&
    actor.ki.current >= closeShaveKiLoss &&
    hasActiveConstant(state, decision.actorId, "move-aoyosumu-close-shave");
  const canUseCombatResultOverride =
    combatResultOverride !== undefined &&
    combatResultReactionOptions(state, frame, decision.actorId, frameRolls).some(
      (candidate) => candidate.id === option.id,
    );
  const canUseCombatResultNegation = combatResultNegationOptionIsAvailable(
    state,
    frame,
    decision.actorId,
    frameRolls,
    option.id,
    combatResultNegation,
  );
  const frameRerollRolls = frameRolls.flatMap((roll): PostDefenseReactionRoll[] =>
    roll.defenseNaturalResult === undefined || roll.defenseResult === undefined
      ? []
      : [
          {
            attackNaturalResult: roll.attackNaturalResult,
            attackResult: roll.attackResult,
            defenseNaturalResult: roll.defenseNaturalResult,
            defenseResult: roll.defenseResult,
          },
        ],
  );
  const canUseActiveReroll = activeRerollOptionIsAvailable(
    state,
    frame,
    frameRerollRolls,
    option.id,
    rerollEffect,
  );
  const afterDefenseCost =
    afterDefenseEffectIndices === undefined
      ? undefined
      : afterDefenseActivationCost(state, frame, afterDefenseEffectIndices);
  const canUseAfterDefenseEffects =
    afterDefenseEffectIndices !== undefined &&
    afterDefenseCost !== undefined &&
    actor.ki.current >= afterDefenseCost;
  const counterAction = counterActionForPostDefenseOption(state, decision, frame, option);
  return {
    itemUse,
    closeShaveKiLoss,
    combatResultOverride,
    combatResultNegation: canUseCombatResultNegation ? combatResultNegation : undefined,
    reroll,
    rerollEffect: canUseActiveReroll ? rerollEffect : undefined,
    rerollDieIndex: canUseActiveReroll ? rerollDieIndex : undefined,
    afterDefenseEffectIndices: canUseAfterDefenseEffects ? afterDefenseEffectIndices : undefined,
    canUseCloseShave,
    canUseCombatResultOverride,
    canUseCombatResultNegation,
    canUseActiveReroll,
    canUseAfterDefenseEffects,
    counterAction,
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
    const move = pendingAttack.type === "move" ? moveForAttackReference(pendingAttack) : undefined;
    const attackResult =
      roll.attack +
      state.combatants[frame.attackerId].stats.dexterityBonus +
      activeRollModifier(state, frame.attackerId, "attack", "result", move);
    const defenseResult =
      roll.defense! +
      state.combatants[frame.targetCombatantId].stats.dexterityBonus +
      activeRollModifier(state, frame.targetCombatantId, "defense", "result", move) +
      defenseResultModifier;
    if (selection.counterAction?.stopsTriggeringAttack === true) return "stopped";
    if (selection.combatResultOverride?.dieIndex === index) {
      const source = [frame.attackerId, frame.targetCombatantId]
        .flatMap((ownerId) => combatResultSources(state, ownerId))
        .find(
          (candidate) =>
            candidate.move.id === selection.combatResultOverride?.sourceDefinitionId &&
            candidate.effectIndex === selection.combatResultOverride?.sourceEffectIndex,
        );
      if (source?.effect.result === "successful" || source?.effect.result === "stopped")
        return source.effect.result;
    }
    if (
      selection.reroll !== undefined &&
      directRerollIndexes(selection.reroll, naturalRolls.length).includes(index)
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

const directRerollIndexes = (choice: PostDefenseRerollChoice, naturalRollCount: number) => {
  if (choice.application.rerollScope === "entire-attack")
    return Array.from({ length: naturalRollCount }, (_, index) => index);
  if (choice.dieIndex === undefined) return [];
  return [choice.dieIndex];
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
  if (frame.attack.type !== "move") return undefined;
  const move = moveForAttackReference(frame.attack);
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
  const {
    closeShaveKiLoss,
    combatResultOverride,
    combatResultNegation,
    itemUse,
    reroll,
    rerollEffect,
    rerollDieIndex,
    counterAction,
  } = selection;
  const afterDefenseEffects = selectedAfterDefenseEffects(
    state,
    frame,
    selection.afterDefenseEffectIndices,
  );
  const defenseItemUse = itemUse === undefined ? undefined : { ...itemUse, response: decision };
  const defenseResultModifier = (defenseItemUse?.modifier?.amount ?? 0) + (closeShaveKiLoss ?? 0);
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
      reroll !== undefined &&
      directRerollIndexes(reroll, frame.naturalRolls.length).includes(index) &&
      reroll.application.roll === "attack"
    )
      return { ...roll, attack: dependencies.random.integer(1, attackSides) };
    if (
      (reroll?.dieIndex === index && reroll.application.roll === "defense") ||
      (rerollEffect?.roll === "defense" && activeIndexes.includes(index))
    )
      return { ...roll, defense: dependencies.random.integer(1, defenseSides) };
    if (rerollEffect?.roll === "attack" && activeIndexes.includes(index))
      return { ...roll, attack: dependencies.random.integer(1, attackSides) };
    return roll;
  });
  const numericResultOverrides = frame.numericResultOverrides.map((override, index) => {
    if (
      reroll !== undefined &&
      directRerollIndexes(reroll, frame.naturalRolls.length).includes(index) &&
      reroll.application.roll === "attack"
    )
      return {
        ...override,
        attack:
          naturalRolls[index].attack +
          state.combatants[frame.attackerId].stats.dexterityBonus +
          activeRollModifier(state, frame.attackerId, "attack", "result", attackMove) +
          reroll.application.resultModifier,
      };
    if (
      reroll !== undefined &&
      directRerollIndexes(reroll, frame.naturalRolls.length).includes(index) &&
      reroll.application.roll === "defense"
    )
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
  let combatResultCost: number | undefined;
  if (combatResultOverride !== undefined)
    combatResultCost = combatResultReactionCost(state, frame, combatResultOverride);
  else if (combatResultNegation !== undefined)
    combatResultCost = combatResultNegationCost(state, frame, combatResultNegation);
  if (combatResultCost !== undefined) reactionKiCost = combatResultCost;
  if (closeShaveKiLoss !== undefined) reactionKiCost = closeShaveKiLoss;
  const afterDefenseCost =
    selection.afterDefenseEffectIndices === undefined
      ? undefined
      : afterDefenseActivationCost(state, frame, selection.afterDefenseEffectIndices);
  if (afterDefenseCost !== undefined) reactionKiCost = afterDefenseCost;
  if (counterAction?.activationCost !== undefined)
    reactionKiCost = counterAction.activationCost.amount;
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
    counterAction,
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
  if (selection.combatResultOverride !== undefined) {
    reactionMoveId = selection.combatResultOverride.sourceDefinitionId;
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
    const indexes = directRerollIndexes(selection.reroll, resolution.naturalRolls.length);
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
    const move = moveForAttackReference(pendingAttack);
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
      { requestDefense: false, ...copiedAttackResolutionOptions(pendingAttack), ...modifiers },
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
    selection.combatResultOverride,
    selection.combatResultNegation,
    selection.reroll,
    selection.secondChanceDie,
    selection.rerollEffect,
    selection.counterAction,
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
    combatResultNegation: selection.combatResultNegation,
    combatResultOverride: selection.combatResultOverride,
    counterAction: selection.counterAction,
    rerolled:
      selection.reroll !== undefined ||
      selection.rerollEffect !== undefined ||
      selection.secondChanceDie !== undefined,
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
  const input = defenseResponseInput(state, decision);
  if ("type" in input) return { ok: false, error: input };
  const { frame, option, pending } = input;
  if (option.type === "use-block" && option.moveId !== undefined && frame.attack.type === "move")
    return resolveBlockedConvertedAttack(state, decision, frame, option.moveId, dependencies);
  if (option.type === "use-block" && option.moveId !== undefined)
    return resolveBlockedBasicAttack(state, decision, frame, option.moveId, dependencies);
  const defenseItemUse = defenseItemUseForOption(state, pending, option);
  const beforeDefenseChoice =
    option.type === "activate-effect" && option.itemId === undefined
      ? frame.beforeDefenseEffectChoices?.find(
          (choice) =>
            choice.sourceDefinitionId === option.moveId &&
            choice.effectIndices.length === option.effectIndices?.length &&
            choice.effectIndices.every(
              (index, position) => index === option.effectIndices?.[position],
            ),
        )
      : undefined;
  if (
    option.type !== "roll-defense" &&
    defenseItemUse === undefined &&
    beforeDefenseChoice === undefined
  ) {
    return { ok: false, error: { type: "illegal-decision", decisionType: decision.type } };
  }
  if (
    option.type === "roll-defense" &&
    defenseItemUse === undefined &&
    beforeDefenseChoice === undefined
  ) {
    const postRollReaction = requestPostDefenseReaction(state, frame, dependencies);
    if (postRollReaction !== undefined) return postRollReaction;
  }
  const postRollReaction = requestBeforeDefenseRerollReaction(
    state,
    frame,
    beforeDefenseChoice,
    dependencies,
  );
  if (postRollReaction !== undefined) return postRollReaction;
  return resolveDefenseRoll(
    state,
    decision,
    frame,
    dependencies,
    defenseItemUse,
    beforeDefenseChoice,
  );
};

type EndPhaseDecision = Extract<CombatDecision, { readonly type: "pass" | "power-up" }>;

const requestBeforeDefenseRerollReaction = (
  state: ActiveFightState,
  frame: Extract<
    ActiveFightState["resolutionFrames"][number],
    { readonly stage: "awaiting-defense" }
  >,
  choice: BeforeDefenseEffectChoice | undefined,
  dependencies: CombatDependencies,
) => {
  if (choice === undefined) return undefined;
  const selectedEffects = selectedBeforeDefenseRerolls(state, frame, choice, dependencies);
  const armedState =
    selectedEffects.length === 0
      ? state
      : { ...state, activeEffects: [...state.activeEffects, ...selectedEffects] };
  return requestPostDefenseReaction(armedState, frame, dependencies);
};

type PowerUpTriggeredEffect = ReturnType<typeof powerUpTriggeredEffects>[number];

interface PowerUpEffectChoiceResolution {
  readonly sourceDefinitionId: MoveDefinition["id"];
  readonly effectIndices: readonly number[];
}

const powerUpChoiceActivationCost = (
  triggered: readonly PowerUpTriggeredEffect[],
  choice: PowerUpEffectChoiceResolution,
) => {
  const source = triggered.find(
    (candidate) => candidate.sourceMove.id === choice.sourceDefinitionId,
  );
  if (source === undefined) return undefined;
  const selected = source.effects.damageModifications.filter((effect) =>
    choice.effectIndices.includes(effect.effectIndex),
  );
  const costs = selected
    .map((effect) => effect.activationCost)
    .filter((cost) => cost !== undefined);
  if (costs.some((cost) => cost.resource !== "ki" || cost.minimum !== undefined)) return undefined;
  return costs.reduce((total, cost) => total + cost.amount, 0);
};

const requestPowerUpEffectChoice = (
  state: ActiveFightState,
  decision: EndPhaseDecision,
  target: ActiveFightState["combatants"][CombatantId],
  choice: PowerUpEffectChoiceResolution,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> => {
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
        {
          id: `activate-effect:${choice.effectIndices.join(",")}`,
          type: "activate-effect",
          moveId: choice.sourceDefinitionId,
          effectIndices: choice.effectIndices,
        },
        { id: "decline", type: "decline" },
      ],
    },
    resolutionFrames: [
      {
        id: dependencies.ids.nextResolutionFrameId(),
        type: "effect-choice",
        decisionId: decision.id,
        actorId: decision.actorId,
        targetCombatantId: target.id,
        returnPhase: "end",
        pendingDecisionId,
        sourceDefinitionId: choice.sourceDefinitionId,
        effectIndices: choice.effectIndices,
        effectTrigger: "on-power-up",
      },
    ],
    eventSequence: state.eventSequence + 1,
  };
  return transitionFrom(nextState, []);
};

const powerUpEffectsForResolution = (
  state: ActiveFightState,
  decision: EndPhaseDecision,
  activeCombatant: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  actionHistory: readonly CombatActionRecord[],
  selectedPowerUpChoice: PowerUpEffectChoiceResolution | undefined,
) => {
  if (decision.type !== "power-up") return [];
  if (selectedPowerUpChoice === undefined)
    return powerUpTriggeredEffects(state, activeCombatant, target, actionHistory, {
      collectPendingChoices: true,
    });
  return powerUpTriggeredEffects(state, activeCombatant, target, actionHistory, {
    selectedSourceDefinitionId: selectedPowerUpChoice.sourceDefinitionId,
    enabledOptionalEffectIndices: selectedPowerUpChoice.effectIndices,
  });
};

const pendingPowerUpChoiceTransition = (
  state: ActiveFightState,
  decision: EndPhaseDecision,
  activeCombatant: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  actionHistory: readonly CombatActionRecord[],
  triggered: readonly PowerUpTriggeredEffect[],
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> | undefined => {
  if (decision.type !== "power-up") return undefined;
  const pendingChoice = triggered
    .flatMap((source) => source.effects.pendingEffectChoices)
    .find((choice) => choice.effectIndices.length > 0);
  if (pendingChoice === undefined) return undefined;
  const selectedTriggered = powerUpTriggeredEffects(state, activeCombatant, target, actionHistory, {
    selectedSourceDefinitionId: pendingChoice.sourceDefinitionId,
    enabledOptionalEffectIndices: pendingChoice.effectIndices,
  });
  const cost = powerUpChoiceActivationCost(selectedTriggered, pendingChoice);
  if (cost === undefined || activeCombatant.ki.current < cost) return undefined;
  return requestPowerUpEffectChoice(
    state,
    decision,
    target,
    {
      sourceDefinitionId: pendingChoice.sourceDefinitionId,
      effectIndices: pendingChoice.effectIndices,
    },
    dependencies,
  );
};

const powerUpChoiceCostResult = (
  activeCombatant: ActiveFightState["combatants"][CombatantId],
  triggered: readonly PowerUpTriggeredEffect[],
  selectedPowerUpChoice: PowerUpEffectChoiceResolution | undefined,
): CombatResult<number> => {
  if (selectedPowerUpChoice === undefined) return { ok: true, value: 0 };
  const cost = powerUpChoiceActivationCost(triggered, selectedPowerUpChoice);
  if (cost === undefined)
    return {
      ok: false,
      error: { type: "unsupported-mechanic", mechanic: "power-up effect cost" },
    };
  if (activeCombatant.ki.current < cost)
    return {
      ok: false,
      error: {
        type: "insufficient-ki",
        required: cost,
        available: activeCombatant.ki.current,
      },
    };
  return { ok: true, value: cost };
};

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
  selectedPowerUpChoice?: PowerUpEffectChoiceResolution,
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
  const triggered = powerUpEffectsForResolution(
    state,
    decision,
    activeCombatant,
    target,
    actionHistory,
    selectedPowerUpChoice,
  );
  if (selectedPowerUpChoice === undefined) {
    const pendingChoiceTransition = pendingPowerUpChoiceTransition(
      state,
      decision,
      activeCombatant,
      target,
      actionHistory,
      triggered,
      dependencies,
    );
    if (pendingChoiceTransition !== undefined) return pendingChoiceTransition;
  }
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
  const powerUpChoiceCostResultValue = powerUpChoiceCostResult(
    activeCombatant,
    triggered,
    selectedPowerUpChoice,
  );
  if (!powerUpChoiceCostResultValue.ok) return powerUpChoiceCostResultValue;
  if (powerUpChoiceCostResultValue.value > 0)
    triggeredChanges.resources.push({
      resource: "ki",
      target: "self",
      operation: "lose",
      amount: powerUpChoiceCostResultValue.value,
      sourceCombatantId: activeCombatant.id,
      cause: "non-damage-effect",
    });
  const resourceTriggeredChanges = resourceTriggered.reduce(
    (changes, source) => ({
      resources: [...changes.resources, ...source.effects.resources],
      statuses: [...changes.statuses, ...source.effects.statuses],
    }),
    { resources: [] as ResourceChange[], statuses: [] as StatusApplication[] },
  );
  const activeAfterBasePowerUp = {
    ...activeCombatant,
    ki: {
      ...activeCombatant.ki,
      current:
        activeCombatant.ki.current +
        (allowedPowerUpResourceChanges.length === 0 ? 0 : powerUpAmount),
    },
  };
  const allowedTriggeredResourceChanges = resourceChangesAfterPreventions(
    activeCombatant,
    target,
    [...triggeredChanges.resources, ...resourceTriggeredChanges.resources],
    state.activeEffects,
    actionRecordFor(state, decision),
  );
  const allTriggeredChanges = {
    resources: resourceChangesWithActivationCosts(
      {
        ...state,
        combatants: { ...state.combatants, [activeCombatant.id]: activeAfterBasePowerUp },
      },
      allowedTriggeredResourceChanges,
    ),
    statuses: [...triggeredChanges.statuses, ...resourceTriggeredChanges.statuses],
  };
  const activeAfterPowerUp = resourceAfterChanges(
    activeAfterBasePowerUp,
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
  if (state.phase === "upkeep") {
    const extraActions = availableExtraActionsFor(state, decision.actorId);
    if (extraActions.length === 0)
      return { type: "wrong-phase", expected: ["action", "counter"], actual: state.phase };
    const available = extraActions.some((effect) => extraActionMatchesDecision(effect, decision));
    return available ? undefined : { type: "illegal-decision", decisionType: decision.type };
  }
  if (state.phase !== "action" && state.phase !== "counter") {
    return { type: "wrong-phase", expected: ["action", "counter"], actual: state.phase };
  }
  return state.pendingDecision === undefined
    ? undefined
    : { type: "unsupported-mechanic", mechanic: "pending decision resolution" };
};

type ForcedActionEffect = Extract<ActiveCombatEffect, { readonly type: "force-next-action" }>;

const activeConstantForcedActionFor = (
  state: ActiveFightState,
  combatantId: CombatantId,
  opponent: CombatantState,
  constant: Extract<ActiveCombatEffect, { readonly type: "active-constant" }>,
): ForcedActionEffect | undefined => {
  if (constant.lifecycle === "deactivated" || activeEffectSuppressed(state, constant))
    return undefined;
  const source = state.combatants[constant.sourceCombatantId];
  const sourceMove = MOVE_DEFINITIONS.find((move) => move.id === constant.sourceDefinitionId);
  if (sourceMove === undefined) return undefined;
  const sourceOpponent = source.id === combatantId ? opponent : state.combatants[combatantId];
  const moves = new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate]));
  const effects = moveEffectsForTrigger(sourceMove, "action-phase", {
    self: source,
    opponent: sourceOpponent,
    turnNumber: state.turnNumber,
    completedTurnCount: state.turnNumber - 1,
    moves,
    moveActivationCounts: moveActivationCounts(state),
    successfulHitCount: 0,
    actionHistory: state.actionHistory,
    activeEffects: state.activeEffects,
    mode: state.mode,
  });
  const force = effects.forcedActions.find(
    (candidate) => (candidate.target === "self" ? source.id : sourceOpponent.id) === combatantId,
  );
  if (force === undefined) return undefined;
  return {
    id: "active-effect:constant-force" as never,
    type: "force-next-action",
    sourceCombatantId: source.id,
    targetCombatantId: combatantId,
    sourceDefinitionId: sourceMove.id,
    allowedCategories: force.allowedCategories,
    ...(force.allowedTags === undefined ? {} : { allowedTags: force.allowedTags }),
    allowPass: force.allowPass,
    ...(force.selectedMoveStorageKey === undefined
      ? {}
      : { selectedMoveStorageKey: force.selectedMoveStorageKey }),
    ...(force.fallback === undefined ? {} : { fallback: force.fallback }),
  };
};

const forcedActionFor = (
  state: ActiveFightState,
  combatantId: CombatantId,
): ForcedActionEffect | undefined => {
  const active = state.activeEffects.find(
    (effect): effect is Extract<ActiveCombatEffect, { readonly type: "force-next-action" }> =>
      effect.type === "force-next-action" && effect.targetCombatantId === combatantId,
  );
  if (active !== undefined) return active;
  const opponent = Object.values(state.combatants).find(
    (candidate) => candidate.id !== combatantId && candidate.status === "active",
  );
  if (opponent === undefined) return undefined;
  for (const constant of state.activeEffects) {
    if (constant.type !== "active-constant") continue;
    const force = activeConstantForcedActionFor(state, combatantId, opponent, constant);
    if (force !== undefined) return force;
  }
  return undefined;
};

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
  else if (suppression.duration.type === "following-action")
    duration = {
      type: "following-action",
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
    ...(suppression.sourceEffectIndex === undefined
      ? {}
      : { sourceEffectIndex: suppression.sourceEffectIndex }),
    ...(suppression.selector === undefined ? {} : { selector: suppression.selector }),
    ...(suppression.selectedMoveId === undefined
      ? {}
      : { selectedMoveId: suppression.selectedMoveId }),
    aspects: suppression.aspects,
    duration,
    ...(suppression.useLimit === undefined ? {} : { useLimit: suppression.useLimit }),
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
  createdOnTurn: number,
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
    ...(prevention.availableFromTurn === undefined
      ? {}
      : { availableFromTurn: Math.max(createdOnTurn + 1, prevention.availableFromTurn) }),
    duration: persistedPreventionDuration(prevention.duration, targetCombatantId, combatantId),
  };
};

const activeResourceModificationPreventionFromApplication = (
  prevention: ResourceModificationPreventionApplication,
  sourceCombatantId: CombatantId,
  opponentCombatantId: CombatantId,
  sourceDefinitionId: MoveDefinition["id"],
  createdOnTurn: number,
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
    ...(prevention.availableFromTurn === undefined
      ? {}
      : { availableFromTurn: Math.max(createdOnTurn + 1, prevention.availableFromTurn) }),
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
  const targetCombatantId = application.target === "self" ? sourceCombatantId : opponentCombatantId;
  const duration = activeRerollDuration(application.duration, targetCombatantId);
  return {
    id: dependencies.ids.nextActiveEffectId(),
    type: "reroll",
    sourceCombatantId,
    targetCombatantId,
    sourceDefinitionId: application.sourceDefinitionId,
    sourceEffectIndex: application.effectIndex,
    roll: application.roll,
    rerollScope: application.rerollScope,
    ...(application.selector === undefined ? {} : { selector: application.selector }),
    bonus: application.resultModifier,
    conditions: application.conditions,
    optional: application.optional,
    ...(application.activationResource === undefined
      ? {}
      : { activationResource: application.activationResource }),
    ...(application.activationCost === undefined
      ? {}
      : { activationCost: application.activationCost }),
    duration,
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

const activeRerollDuration = (
  duration: RerollApplication["duration"],
  targetCombatantId: CombatantId,
): ActiveRerollEffect["duration"] => {
  if (duration === "combat") return { type: "combat" };
  if (duration.type === "next-action")
    return { type: "next-action", combatantId: targetCombatantId };
  if (duration.type === "next-roll")
    return { type: "next-roll", combatantId: targetCombatantId, roll: duration.roll };
  return {
    type: "next-rolls",
    combatantId: targetCombatantId,
    roll: duration.roll,
    remaining: duration.remaining,
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

const activeResourceActionModifiersFromApplications = (
  applications: readonly ResourceActionModifierApplication[],
  sourceCombatantId: CombatantId,
  opponentCombatantId: CombatantId,
  sourceDefinitionId: MoveDefinition["id"],
  dependencies: CombatDependencies,
): readonly ActiveCombatEffect[] =>
  applications.map((application) => ({
    id: dependencies.ids.nextActiveEffectId(),
    type: "modify-next-action" as const,
    sourceCombatantId,
    targetCombatantId: application.target === "self" ? sourceCombatantId : opponentCombatantId,
    sourceDefinitionId,
    scope: application.scope,
    modifier: {
      type: "resource" as const,
      resource: application.resource,
      operation: application.operation,
      amount: application.amount,
      basis: application.basis,
    },
  }));

const activeResourceCostModifiersFromApplications = (
  state: ActiveFightState,
  applications: readonly ResourceCostModifierApplication[],
  sourceCombatantId: CombatantId,
  opponentCombatantId: CombatantId,
  dependencies: CombatDependencies,
): readonly ActiveCombatEffect[] =>
  applications.flatMap((application) => {
    if (application.scope === "current-action") return [];
    const targetCombatantId =
      application.target === "self" ? sourceCombatantId : opponentCombatantId;
    if (
      application.stacking === "prevent" &&
      state.activeEffects.some(
        (effect) =>
          effect.type === "modify-next-action" &&
          effect.sourceCombatantId === sourceCombatantId &&
          effect.targetCombatantId === targetCombatantId &&
          effect.sourceDefinitionId === application.sourceDefinitionId &&
          effect.sourceEffectIndex === application.effectIndex &&
          effect.modifier.type === "resource-cost",
      )
    )
      return [];
    return [
      {
        id: dependencies.ids.nextActiveEffectId(),
        type: "modify-next-action" as const,
        sourceCombatantId,
        targetCombatantId,
        sourceDefinitionId: application.sourceDefinitionId,
        sourceEffectIndex: application.effectIndex,
        selector: application.selector,
        scope: application.scope,
        stacking: application.stacking,
        modifier: {
          type: "resource-cost" as const,
          resource: application.resource,
          operation: application.operation,
          amount: application.percent,
        },
      } satisfies Extract<ActiveCombatEffect, { readonly type: "modify-next-action" }>,
    ];
  });

const activeCostModifierTransformersFromApplications = (
  applications: readonly CostModifierTransformerApplication[],
  sourceCombatantId: CombatantId,
  opponentCombatantId: CombatantId,
  sourceDefinitionId: MoveDefinition["id"],
  dependencies: CombatDependencies,
): readonly ActiveCombatEffect[] =>
  applications.map((application) => ({
    id: dependencies.ids.nextActiveEffectId(),
    type: "modify-next-action" as const,
    sourceCombatantId,
    targetCombatantId: application.target === "self" ? sourceCombatantId : opponentCombatantId,
    sourceDefinitionId,
    sourceEffectIndex: application.effectIndex,
    scope: "next-action" as const,
    modifier: { type: "cost-modifier" as const, multiplier: application.multiplier },
  }));

const activeResourceModifierTransformersFromApplications = (
  state: ActiveFightState,
  applications: readonly ResourceModifierTransformerApplication[],
  sourceCombatantId: CombatantId,
  opponentCombatantId: CombatantId,
  sourceDefinitionId: MoveDefinition["id"],
  dependencies: CombatDependencies,
): readonly ActiveCombatEffect[] =>
  applications.map((application) => ({
    id: dependencies.ids.nextActiveEffectId(),
    type: "modify-next-action" as const,
    sourceCombatantId,
    targetCombatantId: application.target === "self" ? sourceCombatantId : opponentCombatantId,
    sourceDefinitionId,
    sourceEffectIndex: application.effectIndex,
    selector: application.selector,
    scope: "next-turn" as const,
    availableFromTurn: state.turnNumber + 1,
    modifier: {
      type: "resource-modifier" as const,
      resource: application.resource,
      operation: application.operation,
      multiplier: application.multiplier,
      ...(application.cap === undefined ? {} : { cap: application.cap }),
    },
  }));

const deferredDamageBasis = (basis: DamageModification["basis"]) =>
  basis === "damage-percent" ? { basis } : {};

const damageModifierStackingPrevented = (
  state: ActiveFightState,
  application: DamageModification,
  sourceCombatantId: CombatantId,
  targetCombatantId: CombatantId,
  sourceDefinitionId: MoveDefinition["id"],
) =>
  application.stacking === "prevent" &&
  state.activeEffects.some(
    (effect) =>
      effect.sourceCombatantId === sourceCombatantId &&
      effect.targetCombatantId === targetCombatantId &&
      effect.sourceDefinitionId === sourceDefinitionId &&
      (effect.type === "modify-damage" || effect.type === "modify-next-action") &&
      effect.sourceEffectIndex === application.effectIndex,
  );

const activeDamageEffectsFromApplication = (
  application: DamageModification,
  sourceCombatantId: CombatantId,
  targetCombatantId: CombatantId,
  sourceDefinitionId: MoveDefinition["id"],
  createdOnTurn: number,
  dependencies: CombatDependencies,
): readonly ActiveCombatEffect[] => {
  if (application.duration !== undefined)
    return [
      {
        id: dependencies.ids.nextActiveEffectId(),
        type: "modify-damage" as const,
        sourceCombatantId,
        targetCombatantId,
        sourceDefinitionId,
        sourceEffectIndex: application.effectIndex,
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
      sourceEffectIndex: application.effectIndex,
      ...(application.selector === undefined ? {} : { selector: application.selector }),
      ...(application.stacking === undefined ? {} : { stacking: application.stacking }),
      scope: application.scope,
      ...(application.remaining === undefined ? {} : { remaining: application.remaining }),
      ...(application.scope === "following-action" ? { availableFromTurn: createdOnTurn + 1 } : {}),
      modifier: {
        type: "damage" as const,
        amount: application.amount,
        ...deferredDamageBasis(application.basis),
        ...(application.cap === undefined ? {} : { cap: application.cap }),
        ...(application.operation === "add" ? {} : { operation: application.operation }),
      },
    },
  ];
};

const activeDamageModifiersFromApplications = (
  state: ActiveFightState,
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
    if (
      damageModifierStackingPrevented(
        state,
        application,
        sourceCombatantId,
        targetCombatantId,
        sourceDefinitionId,
      )
    )
      return [];
    return activeDamageEffectsFromApplication(
      application,
      sourceCombatantId,
      targetCombatantId,
      sourceDefinitionId,
      createdOnTurn,
      dependencies,
    );
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

const activeStatComparisonsFromApplications = (
  applications: readonly StatComparisonApplication[],
  sourceCombatantId: CombatantId,
  opponentCombatantId: CombatantId,
  sourceDefinitionId: MoveDefinition["id"],
  dependencies: CombatDependencies,
): readonly ActiveCombatEffect[] =>
  applications.map((application) => ({
    id: dependencies.ids.nextActiveEffectId(),
    type: "set-stat-comparison" as const,
    sourceCombatantId,
    targetCombatantId: application.target === "self" ? sourceCombatantId : opponentCombatantId,
    sourceDefinitionId,
    leftCombatantId: application.left === "self" ? sourceCombatantId : opponentCombatantId,
    rightCombatantId: application.right === "self" ? sourceCombatantId : opponentCombatantId,
    stat: application.stat,
    comparison: application.comparison,
    duration: {
      type: "turns" as const,
      ownerCombatantId: application.target === "self" ? sourceCombatantId : opponentCombatantId,
      remaining: application.duration.remaining,
    },
  }));

const activeMoveClassificationsFromApplications = (
  applications: readonly MoveClassificationApplication[],
  sourceCombatantId: CombatantId,
  opponentCombatantId: CombatantId,
  sourceDefinitionId: MoveDefinition["id"],
  dependencies: CombatDependencies,
): readonly ActiveCombatEffect[] =>
  applications.map((application) => {
    const targetCombatantId =
      application.target === "self" ? sourceCombatantId : opponentCombatantId;
    return {
      id: dependencies.ids.nextActiveEffectId(),
      type: "modify-move-classification" as const,
      sourceCombatantId,
      targetCombatantId,
      sourceDefinitionId,
      sourceEffectIndex: application.effectIndex,
      selector: application.selector,
      classification:
        application.classification === "replace-declared-style"
          ? { type: "replace-style" as const, style: "declared-style" as const }
          : {
              type: "replace-style" as const,
              style: "style-id" as const,
              styleId: application.classification.styleId,
            },
      duration:
        application.duration.type === "combat"
          ? { type: "combat" as const }
          : {
              type: "turns" as const,
              ownerCombatantId: targetCombatantId,
              remaining: application.duration.turns,
            },
    } satisfies Extract<ActiveCombatEffect, { readonly type: "modify-move-classification" }>;
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

const selectorMatchesMoveForCombatant = (
  state: ActiveFightState,
  combatantId: CombatantId,
  selector: MoveSelectorCondition | undefined,
  move: MoveDefinition,
) => {
  if (selector?.styleProvenance !== "effect") return selectorMatchesMove(selector, move);
  const baseSelector = { ...selector, styleProvenance: undefined };
  return (
    selectorMatchesMove(baseSelector, move) &&
    state.activeEffects.some(
      (effect) =>
        effect.type === "modify-move-classification" &&
        effect.targetCombatantId === combatantId &&
        effect.classification.type === "replace-style" &&
        selectorMatchesMove(effect.selector, move),
    )
  );
};

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
  causedByDecisionId: CombatDecision["id"] | undefined,
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

const deactivationCostAvailable = (
  combatant: ActiveFightState["combatants"][CombatantId],
  cost: DeactivationApplication["activationCost"],
) => {
  if (cost === undefined) return true;
  const current = cost.resource === "ki" ? combatant.ki.current : combatant.hitPoints.current;
  const remaining = current - cost.amount;
  return remaining >= 0 && (cost.minimum === undefined || remaining >= cost.minimum);
};

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

const deactivatedListenerActiveEffects = (
  state: ActiveFightState,
  activeEffects: readonly ActiveCombatEffect[],
  deactivated: Extract<ActiveCombatEffect, { readonly type: "active-constant" }>,
  dependencies: CombatDependencies,
): readonly ActiveCombatEffect[] => {
  const actor = state.combatants[deactivated.sourceCombatantId];
  const target = Object.values(state.combatants).find(
    (combatant) => combatant.id !== actor.id && combatant.status === "active",
  );
  const triggeringMove = MOVE_DEFINITIONS.find(
    (move) => move.id === deactivated.sourceDefinitionId,
  );
  if (target === undefined || triggeringMove === undefined) return [];
  const moves = new Map(MOVE_DEFINITIONS.map((move) => [move.id, move]));
  const sourceDefinitionIds = new Set(actor.moveIds);
  for (const effect of activeEffects) {
    if (effect.type === "active-constant" && effect.sourceCombatantId === actor.id)
      sourceDefinitionIds.add(effect.sourceDefinitionId);
  }
  const stateWithEffects = { ...state, activeEffects };
  return [...sourceDefinitionIds].flatMap((sourceDefinitionId) => {
    const sourceMove = moves.get(sourceDefinitionId);
    if (sourceMove === undefined) return [];
    const effects = moveEffectsForTrigger(sourceMove, "on-deactivated", {
      self: actor,
      opponent: target,
      turnNumber: state.turnNumber,
      completedTurnCount: state.turnNumber - 1,
      moves,
      moveActivationCounts: moveActivationCounts(state),
      successfulHitCount: 0,
      actionHistory: state.actionHistory,
      activeEffects,
      mode: state.mode,
      triggeringMove,
      triggeringMoveOwner: "self",
    });
    if (effects.locks.length === 0 && effects.costModifications.length === 0) return [];
    return activeEffectsFromTriggered(
      stateWithEffects,
      [{ sourceMove, actor, target, effects }],
      dependencies,
    );
  });
};

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
  reactivationOnly = false,
  activationCost?: { readonly amount: number; readonly minimum?: number },
  activationCostOverride?: number,
  activationAsIf?: "power-up",
) => {
  const combatant = state.combatants[targetCombatantId];
  return combatant.moveIds.flatMap((moveId) => {
    const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === moveId);
    const deactivated = state.activeEffects.some(
      (effect) =>
        effect.type === "active-constant" &&
        effect.lifecycle === "deactivated" &&
        effect.sourceCombatantId === targetCombatantId &&
        effect.sourceDefinitionId === moveId,
    );
    const powerUpMastery =
      activationAsIf === "power-up" &&
      move?.category === "mastery" &&
      move.effects?.some((effect) => effect.trigger === "on-power-up") === true;
    if (
      move === undefined ||
      (!isConstantSkill(move) && !powerUpMastery) ||
      !selectorMatchesMove(selector, move) ||
      (reactivationOnly && !deactivated) ||
      hasActiveConstant(state, targetCombatantId, move.id) ||
      moveUsePreventionFor(state, targetCombatantId, move, "activate") !== undefined
    )
      return [];
    const cost = move.mechanics.kiCost;
    const effectiveCost =
      cost?.type === "literal"
        ? convertedAttackCost(state, combatant, move, cost.value)
        : undefined;
    const minimumActivationCost = activationCost?.minimum ?? 0;
    const requiredActivationCost =
      activationCostOverride ?? effectiveCost ?? (powerUpMastery ? 0 : Number.NaN);
    const requiredCost = Number.isNaN(requiredActivationCost)
      ? undefined
      : Math.max(requiredActivationCost, activationCost?.amount ?? 0, minimumActivationCost);
    if (
      (!powerUpMastery && cost?.type !== "literal") ||
      !isRestrictedUseAvailable(
        combatant.moveUses[move.id] ?? 0,
        effectiveRestrictedMoveUseLimit(state, combatant, move),
      ) ||
      requiredCost === undefined ||
      combatant.ki.current < requiredCost
    )
      return [];
    return [move];
  });
};

const activationUnavailableSelectorsFor = (
  state: ActiveFightState,
  attacker: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  move: MoveDefinition,
) => {
  const applications = moveEffectsForTrigger(move, "on-success", {
    ...convertedAttackEffectContext(state, attacker, target, move),
    collectPendingChoices: true,
  }).activations;
  return applications.flatMap((application) => {
    const targetCombatantId = application.target === "self" ? attacker.id : target.id;
    const eligible = eligibleConstantActivationMoves(
      state,
      targetCombatantId,
      application.selector,
      application.reactivationOnly,
      application.activationCost,
      application.activationCostOverride,
      application.asIf,
    );
    const alreadyActive = state.combatants[targetCombatantId].moveIds.some((moveId) => {
      const candidate = MOVE_DEFINITIONS.find((definition) => definition.id === moveId);
      return (
        candidate !== undefined &&
        isConstantSkill(candidate) &&
        selectorMatchesMove(application.selector, candidate) &&
        hasActiveConstant(state, targetCombatantId, candidate.id)
      );
    });
    return eligible.length === 0 && !alreadyActive ? [application.selector] : [];
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

const activationSelectionCount = (application: ActivationApplication, eligibleCount: number) =>
  application.selectionMode === "all"
    ? eligibleCount
    : Math.min(application.selectionLimit ?? 1, eligibleCount);

type ActivationFrame = Extract<ResolutionFrame, { readonly type: "effect" }>;

const activationFrameFields = (
  application: ActivationApplication,
): Pick<
  ActivationFrame,
  | "activationAsIf"
  | "activationSelection"
  | "selectionKey"
  | "activationCost"
  | "activationCostOverride"
  | "reactivationOnly"
> => ({
  ...(application.asIf === undefined ? {} : { activationAsIf: application.asIf }),
  ...(application.selectionKey === undefined ? {} : { selectionKey: application.selectionKey }),
  ...(application.selectionMode === undefined
    ? {}
    : { activationSelection: application.selectionMode }),
  ...(application.activationCost === undefined
    ? {}
    : { activationCost: application.activationCost }),
  ...(application.activationCostOverride === undefined
    ? {}
    : { activationCostOverride: application.activationCostOverride }),
  ...(application.reactivationOnly === undefined
    ? {}
    : { reactivationOnly: application.reactivationOnly }),
});

const activationSelectionTransition = ({
  state,
  application,
  sourceCombatantId,
  targetCombatantId,
  eligible,
  effectIndex,
  dependencies,
}: ActivationSelectionTransitionInput): CombatResult<CombatTransition> => {
  if (application.trigger === "on-roll-result") {
    const nextState: ActiveFightState = {
      ...state,
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
          returnPhase: "end" as const,
          trigger: application.trigger,
          eligibleMoveIds: eligible.map((move) => move.id),
          remainingSelections: activationSelectionCount(application, eligible.length),
          optional: application.optional,
          ...activationFrameFields(application),
        },
      ],
    };
    return transitionFrom(nextState, []);
  }
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
        trigger: application.trigger,
        pendingDecisionId,
        eligibleMoveIds: eligible.map((move) => move.id),
        remainingSelections: activationSelectionCount(application, eligible.length),
        optional: application.optional,
        ...activationFrameFields(application),
      },
    ],
  };
  return transitionFrom(nextState, []);
};

interface DeactivateAllEligibleConstantsInput {
  readonly activeEffects: readonly ActiveCombatEffect[];
  readonly eligible: readonly Extract<ActiveCombatEffect, { readonly type: "active-constant" }>[];
  readonly state: ActiveFightState;
  readonly causedByDecisionId?: CombatDecision["id"];
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
  deactivated: eligible,
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
  readonly trigger?: "upkeep" | "action" | "end" | "on-success" | "on-stopped";
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
  trigger,
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
        trigger: trigger ?? "on-success",
        pendingDecisionId,
        eligibleMoveIds: eligible.map((effect) => effect.sourceDefinitionId),
        remainingSelections:
          application.selection === "all" ? eligible.length : (application.count ?? 1),
        optional: application.optional,
        ...(application.activationCost === undefined
          ? {}
          : {
              activationCost: {
                amount: application.activationCost.amount,
                resource: application.activationCost.resource,
                ...(application.activationCost.minimum === undefined
                  ? {}
                  : { minimum: application.activationCost.minimum }),
              },
            }),
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
  readonly causedByDecisionId?: CombatDecision["id"];
  readonly dependencies: CombatDependencies;
  readonly priorEvents: readonly CombatEvent[];
  readonly trigger?: "upkeep" | "action" | "end" | "on-success" | "on-stopped";
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
  for (const application of activations ?? []) {
    const applicationSourceCombatantId = application.sourceCombatantId ?? sourceCombatantId;
    const targetCombatantId = deactivationTarget(state, application, applicationSourceCombatantId);
    if (targetCombatantId === undefined) continue;
    const eligible = eligibleConstantActivationMoves(
      state,
      targetCombatantId,
      application.selector,
      application.reactivationOnly,
      application.activationCost,
      application.activationCostOverride,
      application.asIf,
    );
    if (eligible.length === 0) continue;
    return activationSelectionTransition({
      state,
      application,
      sourceCombatantId: applicationSourceCombatantId,
      targetCombatantId,
      eligible,
      effectIndex: application.effectIndex,
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
  trigger,
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
        deactivationCostAvailable(
          state.combatants[sourceCombatantId],
          application.activationCost,
        ) &&
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
      activeEffects = [
        ...deactivation.activeEffects,
        ...deactivation.deactivated.flatMap((effect) =>
          deactivatedListenerActiveEffects(state, deactivation.activeEffects, effect, dependencies),
        ),
      ];
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
      trigger,
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
  state: ActiveFightState,
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
  if (
    move === undefined ||
    !selectorMatchesMoveForCombatant(state, lock.targetCombatantId, lock.selector, move)
  )
    return false;
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
      lockAppliesToDecision(state, effect, decision),
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
  state: ActiveFightState,
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
  const categoryAndTagsMatch =
    force.allowedCategories.includes(move.category) &&
    (force.allowedTags === undefined ||
      force.allowedTags.every((tag) => move.tags.includes(tag as (typeof move.tags)[number])));
  if (!categoryAndTagsMatch) return false;
  if (force.selectedMoveStorageKey === undefined) return true;
  return (
    state.combatants[force.targetCombatantId].storedMoveSelections?.[force.selectedMoveStorageKey]
      ?.moveId === move.id
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
  const freeTransformationAction = (combatant.freeTransformationActions ?? 0) > 0;
  const transformed = applyTransformation(combatant, transformation);
  const remainingFreeTransformationActions = Math.max(
    0,
    (combatant.freeTransformationActions ?? 0) - (freeTransformationAction ? 1 : 0),
  );
  const nextState: ActiveFightState = {
    ...state,
    version: state.version + 1,
    phase: freeTransformationAction ? "action" : "end",
    combatants: {
      ...state.combatants,
      [combatant.id]: {
        ...transformed.combatant,
        ...(remainingFreeTransformationActions === 0
          ? { freeTransformationActions: undefined }
          : { freeTransformationActions: remainingFreeTransformationActions }),
        transformation: {
          transformationId: transformation.id,
          activatedOnTurn: state.turnNumber,
          baseline: transformed.baseline,
        },
      },
    },
    actionHistory: [...state.actionHistory, actionRecordFor(state, decision)],
    eventSequence: state.eventSequence + (freeTransformationAction ? 1 : 2),
  };
  const events: CombatEvent[] = [
    {
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + 1,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "transformation-activated",
      combatantId: combatant.id,
      transformationId: transformation.id,
    },
  ];
  if (!freeTransformationAction)
    events.push(
      createPhaseChangedEvent(state, dependencies, "end", nextState.eventSequence, decision.id),
    );
  return transitionFrom(nextState, events);
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

type AwaitingCounterFrame = Extract<
  ResolutionFrame,
  { readonly type: "attack"; readonly stage: "awaiting-counter" }
>;
type UseSourceCounterAction = CounterActionReference & {
  readonly action: "use-source-attack";
};
type RepeatCounterAction = CounterActionReference & {
  readonly action: "repeat-triggering-attack";
};

const resolveUseSourceCounterAction = (
  state: ActiveFightState,
  decision: Extract<ResolvedActionDecision, { readonly type: "use-move" }>,
  frame: AwaitingCounterFrame,
  counterAction: UseSourceCounterAction,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> => {
  if (
    decision.moveId !== counterAction.sourceDefinitionId ||
    decision.targetCombatantId !== frame.attackerId
  )
    return { ok: false, error: { type: "illegal-decision", decisionType: decision.type } };
  const sourceMove =
    counterAction.sourceMoveSnapshot ??
    MOVE_DEFINITIONS.find((candidate) => candidate.id === counterAction.sourceDefinitionId);
  if (sourceMove === undefined) return { ok: false, error: invalidFightState(state) };
  return resolveConvertedAttackMove(state, decision, sourceMove, dependencies);
};

const resolveRepeatCounterAction = (
  state: ActiveFightState,
  decision: Extract<ResolvedActionDecision, { readonly type: "basic-attack" | "use-move" }>,
  counterAction: RepeatCounterAction,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> => {
  const sourceAction = counterAction.sourceAction;
  if (sourceAction === undefined || decision.targetCombatantId !== sourceAction.actorId)
    return { ok: false, error: { type: "illegal-decision", decisionType: decision.type } };
  if (sourceAction.type === "basic-attack") {
    return decision.type !== "basic-attack" || decision.basicAttack !== sourceAction.basicAttack
      ? { ok: false, error: { type: "illegal-decision", decisionType: decision.type } }
      : resolveBasicAttack(
          state,
          {
            ...decision,
            actorId: decision.actorId,
            targetCombatantId: sourceAction.actorId,
          },
          dependencies,
        );
  }
  if (decision.type !== "use-move" || decision.moveId !== sourceAction.moveId)
    return { ok: false, error: { type: "illegal-decision", decisionType: decision.type } };
  const sourceMove =
    counterAction.sourceMoveSnapshot ??
    MOVE_DEFINITIONS.find((candidate) => candidate.id === sourceAction.moveId);
  const copyingMove = MOVE_DEFINITIONS.find(
    (candidate) => candidate.id === counterAction.sourceDefinitionId,
  );
  if (sourceMove === undefined || copyingMove === undefined)
    return { ok: false, error: invalidFightState(state) };
  let counterMove = copiedMoveForAction(copyingMove, sourceMove);
  const costModifier = counterAction.costModifier;
  if (costModifier !== undefined) {
    const sourceCost = sourceMove.mechanics.kiCost;
    if (sourceCost?.type !== "literal")
      return { ok: false, error: { type: "unsupported-mechanic", mechanic: "counter cost" } };
    const nextCost =
      costModifier.operation === "add"
        ? sourceCost.value + costModifier.amount
        : costModifier.amount;
    counterMove = {
      ...counterMove,
      mechanics: {
        ...counterMove.mechanics,
        kiCost: {
          ...sourceCost,
          value: Math.max(costModifier.minimum ?? 0, nextCost),
        },
      },
    };
  }
  return resolveConvertedAttackMove(
    state,
    {
      ...decision,
      moveId: copyingMove.id,
      targetCombatantId: sourceAction.actorId,
    },
    counterMove,
    dependencies,
  );
};

const resolveCounterActionDecision = (
  state: ActiveFightState,
  decision: ResolvedActionDecision,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> | undefined => {
  if (decision.type !== "basic-attack" && decision.type !== "use-move") return undefined;
  const frame = awaitingCounterFrameFor(state, decision.actorId);
  if (frame === undefined) return undefined;
  const counterAction = frame.counterAction;
  if (counterAction?.action === "use-source-attack") {
    if (decision.type !== "use-move")
      return { ok: false, error: { type: "illegal-decision", decisionType: decision.type } };
    return resolveUseSourceCounterAction(
      state,
      decision,
      frame,
      counterAction as UseSourceCounterAction,
      dependencies,
    );
  }
  if (counterAction?.action !== "repeat-triggering-attack") return undefined;
  return resolveRepeatCounterAction(
    state,
    decision,
    counterAction as RepeatCounterAction,
    dependencies,
  );
};

const resolvePlayerAction = (
  state: ActiveFightState,
  decision: ResolvedActionDecision,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> => {
  const counterResolution = resolveCounterActionDecision(state, decision, dependencies);
  if (counterResolution !== undefined) return counterResolution;
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
  const lifecycleChoice = frame.trigger === "upkeep" || frame.trigger === "end";
  return transitionFrom(
    {
      ...stateWithoutPending,
      version: state.version + 1,
      resolutionFrames: lifecycleChoice
        ? state.resolutionFrames.map((candidate) =>
            candidate.type === "effect" && candidate.id === frame.id
              ? { ...candidate, pendingDecisionId: undefined, resolved: true }
              : candidate,
          )
        : state.resolutionFrames.filter((candidate) => candidate.id !== frame.id),
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

const copiedSourceMoveForSelection = (
  option: PendingDecisionOption | undefined,
  frame: Extract<ActiveFightState["resolutionFrames"][number], { readonly type: "effect" }>,
) => {
  if (option?.type !== "select-move" || option.moveId === undefined) return undefined;
  if (
    option.sourceMoveSnapshot?.id === option.moveId &&
    frame.eligibleMoveIds?.includes(option.moveId) === true
  )
    return option.sourceMoveSnapshot;
  return MOVE_DEFINITIONS.find(
    (candidate) =>
      candidate.id === option.moveId && frame.eligibleMoveIds?.includes(candidate.id) === true,
  );
};

const requestSelectedSuppressionTarget = (
  state: ActiveFightState,
  attackFrame: AwaitingEffectChoiceAttackFrame,
  move: MoveDefinition,
  effectIndex: number,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> => {
  const effect = move.effects?.[effectIndex];
  if (!selectedSuppressionEffect(effect) || effect?.type !== "suppress")
    return { ok: false, error: invalidFightState(state) };
  const targetCombatantId =
    effect.target === "self" ? attackFrame.attackerId : attackFrame.targetCombatantId;
  const eligibleMoveIds = selectedSuppressionMoveCandidates(state, attackFrame, move, effectIndex);
  if (eligibleMoveIds.length === 0) return { ok: false, error: invalidFightState(state) };
  const pendingDecisionId = dependencies.ids.nextPendingDecisionId();
  const pendingDecision = {
    id: pendingDecisionId,
    stateVersion: state.version + 1,
    combatantId: attackFrame.attackerId,
    type: "select-move" as const,
    options: eligibleMoveIds.map((moveId) => ({
      id: `select-suppression-target:${effectIndex}:${moveId}`,
      type: "select-move" as const,
      moveId,
    })),
  };
  const selectionFrame = {
    id: dependencies.ids.nextResolutionFrameId(),
    type: "effect" as const,
    decisionId: attackFrame.decisionId,
    sourceCombatantId: attackFrame.attackerId,
    targetCombatantId,
    sourceDefinitionId: move.id,
    effectIndex,
    operation: "select-suppression-target" as const,
    returnPhase: attackFrame.returnPhase,
    trigger: "on-success" as const,
    pendingDecisionId,
    eligibleMoveIds,
    remainingSelections: 1,
  };
  const attackFrameWithSelection = {
    ...attackFrame,
    pendingDecisionId,
  };
  return transitionFrom(
    {
      ...state,
      version: state.version + 1,
      pendingDecision,
      resolutionFrames: [
        ...state.resolutionFrames.map((candidate) =>
          candidate.id === attackFrame.id ? attackFrameWithSelection : candidate,
        ),
        selectionFrame,
      ],
    },
    [],
  );
};

const resolveSelectedDamageTargetSelection = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
  dependencies: CombatDependencies,
  frame: Extract<ActiveFightState["resolutionFrames"][number], { readonly type: "effect" }>,
): CombatResult<CombatTransition> => {
  const pending = state.pendingDecision;
  const option = pending?.options.find((candidate) => candidate.id === decision.optionId);
  const sourceMove = MOVE_DEFINITIONS.find(
    (candidate) => candidate.id === frame.sourceDefinitionId,
  );
  const effect = sourceMove?.effects?.[frame.effectIndex];
  const target = state.combatants[frame.targetCombatantId];
  if (
    pending?.type !== "select-move" ||
    option?.type !== "select-move" ||
    option.moveId === undefined ||
    frame.operation !== "select-damage-target" ||
    sourceMove === undefined ||
    effect?.type !== "modify-damage" ||
    !isSelectedMoveUntilAttackThresholdDamageModifier(effect) ||
    !frame.eligibleMoveIds?.includes(option.moveId) ||
    !target.moveIds.includes(option.moveId)
  )
    return { ok: false, error: invalidFightState(state) };
  const selectedMove = MOVE_DEFINITIONS.find((candidate) => candidate.id === option.moveId);
  if (
    selectedMove === undefined ||
    effect.selector === undefined ||
    !matchesMoveSelector(selectedMove, effect.selector)
  )
    return { ok: false, error: invalidFightState(state) };
  const existing = state.activeEffects.some(
    (candidate) =>
      candidate.type === "modify-damage" &&
      candidate.sourceCombatantId === frame.sourceCombatantId &&
      candidate.targetCombatantId === frame.targetCombatantId &&
      candidate.sourceDefinitionId === frame.sourceDefinitionId &&
      candidate.sourceEffectIndex === frame.effectIndex,
  );
  const newEffect = existing
    ? undefined
    : ({
        id: dependencies.ids.nextActiveEffectId(),
        type: "modify-damage" as const,
        sourceCombatantId: frame.sourceCombatantId,
        targetCombatantId: frame.targetCombatantId,
        sourceDefinitionId: frame.sourceDefinitionId,
        sourceEffectIndex: frame.effectIndex,
        selector: effect.selector,
        selectedMoveId: selectedMove.id,
        operation: "set" as const,
        basis: "power-percent" as const,
        amount: 0,
        duration: {
          type: "until-roll-threshold" as const,
          combatantId: frame.targetCombatantId,
          roll: "attack" as const,
          comparison: "at-least" as const,
          value: 25,
        },
      } satisfies ActiveCombatEffect);
  const activeEffects =
    newEffect === undefined ? state.activeEffects : [...state.activeEffects, newEffect];
  const stateWithoutPending: ActiveFightState = {
    ...state,
    version: state.version + 1,
    activeEffects,
    resolutionFrames: state.resolutionFrames.filter((candidate) => candidate.id !== frame.id),
  };
  Reflect.deleteProperty(stateWithoutPending, "pendingDecision");
  const event: CombatEvent | undefined =
    newEffect === undefined
      ? undefined
      : {
          id: dependencies.ids.nextEventId(),
          sequence: state.eventSequence + 1,
          fightId: state.id,
          causedByDecisionId: decision.id,
          sourceDefinitionId: frame.sourceDefinitionId,
          type: "effect-activated",
          activeEffectId: newEffect.id,
          sourceCombatantId: frame.sourceCombatantId,
          targetCombatantId: frame.targetCombatantId,
        };
  return transitionFrom(
    {
      ...stateWithoutPending,
      eventSequence: state.eventSequence + (event === undefined ? 0 : 1),
    },
    event === undefined ? [] : [event],
  );
};

const resolveSelectedSuppressionTargetSelection = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
  dependencies: CombatDependencies,
  frame: Extract<ActiveFightState["resolutionFrames"][number], { readonly type: "effect" }>,
): CombatResult<CombatTransition> => {
  const pending = state.pendingDecision;
  const option = pending?.options.find((candidate) => candidate.id === decision.optionId);
  const attackFrame = state.resolutionFrames.find(
    (candidate): candidate is AwaitingEffectChoiceAttackFrame =>
      candidate.type === "attack" &&
      candidate.stage === "awaiting-effect-choice" &&
      candidate.decisionId === frame.decisionId,
  );
  const sourceMove = MOVE_DEFINITIONS.find(
    (candidate) => candidate.id === frame.sourceDefinitionId,
  );
  const effect = sourceMove?.effects?.[frame.effectIndex];
  const target = state.combatants[frame.targetCombatantId];
  if (
    pending?.type !== "select-move" ||
    option?.type !== "select-move" ||
    option.moveId === undefined ||
    frame.operation !== "select-suppression-target" ||
    attackFrame === undefined ||
    sourceMove === undefined ||
    !selectedSuppressionEffect(effect) ||
    effect?.type !== "suppress" ||
    effect.selector === undefined ||
    frame.eligibleMoveIds?.includes(option.moveId) !== true ||
    !target.moveIds.includes(option.moveId)
  )
    return { ok: false, error: invalidFightState(state) };
  const selectedMove = MOVE_DEFINITIONS.find((candidate) => candidate.id === option.moveId);
  if (selectedMove === undefined || !matchesMoveSelector(selectedMove, effect.selector))
    return { ok: false, error: invalidFightState(state) };
  const selectedSuppressionMoves = [
    ...(attackFrame.selectedSuppressionMoves ?? []),
    { effectIndex: frame.effectIndex, moveId: selectedMove.id },
  ];
  const updatedAttackFrame: AwaitingEffectChoiceAttackFrame = {
    ...attackFrame,
    selectedSuppressionMoves,
  };
  const nextSelection = selectedSuppressionEffectIndices(
    sourceMove,
    attackFrame.enabledEffectIndices,
  ).find(
    (effectIndex) =>
      !selectedSuppressionMoves.some((selection) => selection.effectIndex === effectIndex),
  );
  const framesWithoutSelection = state.resolutionFrames
    .filter((candidate) => candidate.id !== frame.id && candidate.id !== attackFrame.id)
    .concat(updatedAttackFrame);
  const stateWithoutSelection: ActiveFightState = {
    ...state,
    version: state.version + 1,
    resolutionFrames: framesWithoutSelection,
  };
  Reflect.deleteProperty(stateWithoutSelection, "pendingDecision");
  if (nextSelection !== undefined)
    return requestSelectedSuppressionTarget(
      stateWithoutSelection,
      updatedAttackFrame,
      sourceMove,
      nextSelection,
      dependencies,
    );
  const resumeOption = {
    id: `activate-effect:${updatedAttackFrame.effectIndices.join(",")}`,
    type: "activate-effect" as const,
    effectIndices: updatedAttackFrame.effectIndices,
  };
  const resumePending = {
    id: updatedAttackFrame.pendingDecisionId,
    stateVersion: stateWithoutSelection.version,
    combatantId: updatedAttackFrame.attackerId,
    type: "optional-effect" as const,
    options: [resumeOption, { id: "decline", type: "decline" as const }],
  };
  const resumeDecision = {
    ...decision,
    pendingDecisionId: resumePending.id,
    optionId: resumeOption.id,
  };
  return resolveAttackOptionalEffectChoice(
    { ...stateWithoutSelection, pendingDecision: resumePending },
    resumeDecision,
    dependencies,
    resumePending,
    updatedAttackFrame,
  );
};

const resolveSelectedTemporaryMoveRemovalSelection = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
  dependencies: CombatDependencies,
  frame: Extract<ActiveFightState["resolutionFrames"][number], { readonly type: "effect" }>,
): CombatResult<CombatTransition> => {
  const pending = state.pendingDecision;
  const option = pending?.options.find((candidate) => candidate.id === decision.optionId);
  const sourceMove = MOVE_DEFINITIONS.find(
    (candidate) => candidate.id === frame.sourceDefinitionId,
  );
  const effect = sourceMove?.effects?.[frame.effectIndex];
  const target = state.combatants[frame.targetCombatantId];
  if (
    pending?.type !== "select-move" ||
    option?.type !== "select-move" ||
    option.moveId === undefined ||
    frame.operation !== "select-move-removal" ||
    sourceMove === undefined ||
    effect?.type !== "remove-move-from-combat" ||
    effect.move !== "target" ||
    effect.target !== "opponent" ||
    effect.selector === undefined ||
    effect.duration?.type !== "until-perfect-roll" ||
    effect.conditions !== undefined ||
    !frame.eligibleMoveIds?.includes(option.moveId) ||
    !target.moveIds.includes(option.moveId)
  )
    return { ok: false, error: invalidFightState(state) };
  const selectedMove = MOVE_DEFINITIONS.find((candidate) => candidate.id === option.moveId);
  if (selectedMove === undefined || !matchesMoveSelector(selectedMove, effect.selector))
    return { ok: false, error: invalidFightState(state) };
  const activeEffect = {
    id: dependencies.ids.nextActiveEffectId(),
    type: "remove-move-from-combat" as const,
    sourceCombatantId: frame.sourceCombatantId,
    targetCombatantId: frame.targetCombatantId,
    sourceDefinitionId: frame.sourceDefinitionId,
    sourceEffectIndex: frame.effectIndex,
    moveId: selectedMove.id,
    removedFromIndex: target.moveIds.indexOf(selectedMove.id),
    duration: {
      type: "until-perfect-roll" as const,
      combatantId: frame.targetCombatantId,
    },
  } satisfies Extract<ActiveCombatEffect, { readonly type: "remove-move-from-combat" }>;
  const nextState: ActiveFightState = {
    ...state,
    version: state.version + 1,
    combatants: {
      ...state.combatants,
      [target.id]: removeTemporaryMoveFromState(target, selectedMove.id),
    },
    activeEffects: [...state.activeEffects, activeEffect],
    resolutionFrames: state.resolutionFrames.filter((candidate) => candidate.id !== frame.id),
    eventSequence: state.eventSequence + 2,
  };
  Reflect.deleteProperty(nextState, "pendingDecision");
  return transitionFrom(nextState, [
    {
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + 1,
      fightId: state.id,
      causedByDecisionId: decision.id,
      sourceDefinitionId: frame.sourceDefinitionId,
      type: "effect-activated",
      activeEffectId: activeEffect.id,
      sourceCombatantId: activeEffect.sourceCombatantId,
      targetCombatantId: activeEffect.targetCombatantId,
    },
    {
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + 2,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "move-removed-from-combat",
      combatantId: activeEffect.targetCombatantId,
      moveId: activeEffect.moveId,
      activeEffectId: activeEffect.id,
    },
  ]);
};

const resolveCopiedMoveSelection = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
  dependencies: CombatDependencies,
  frame: Extract<ActiveFightState["resolutionFrames"][number], { readonly type: "effect" }>,
): CombatResult<CombatTransition> => {
  const pending = state.pendingDecision;
  const option = pending?.options.find((candidate) => candidate.id === decision.optionId);
  const copyingMove = MOVE_DEFINITIONS.find(
    (candidate) => candidate.id === frame.sourceDefinitionId,
  );
  const sourceAction =
    option?.sourceActionId === undefined
      ? undefined
      : state.actionHistory.find(
          (candidate) =>
            candidate.type === "use-move" && candidate.decisionId === option.sourceActionId,
        );
  const sourceMove = copiedSourceMoveForSelection(option, frame);
  const actor = state.combatants[frame.sourceCombatantId];
  const target = activeOpponent(state, actor.id, frame.targetCombatantId);
  const copyEffect = copyingMove?.effects?.[frame.effectIndex];
  if (
    pending?.type !== "select-move" ||
    option?.type !== "select-move" ||
    sourceMove === undefined ||
    copyingMove === undefined ||
    copyEffect?.type !== "copy-move-effect" ||
    target === undefined ||
    (option.sourceActionId !== undefined &&
      (frame.eligibleSourceActionIds?.includes(option.sourceActionId) !== true ||
        sourceAction?.type !== "use-move" ||
        sourceAction.moveId !== sourceMove.id ||
        sourceAction.actorId === actor.id ||
        sourceAction.targetCombatantId !== actor.id ||
        sourceAction.outcome !== "successful" ||
        sourceAction.damageDealt !== option.sourceDamageDealt ||
        !Number.isFinite(option.sourceDamageDealt) ||
        (!isFullPriorAttackCopy(copyEffect) && sourceMove.category !== "advanced-attack") ||
        (isFullPriorAttackCopy(copyEffect) &&
          sourceMove.category !== "advanced-attack" &&
          sourceMove.category !== "signature") ||
        sourceMove.mechanics.attack === undefined ||
        (isFullPriorAttackCopy(copyEffect) &&
          (option.sourceResolutionSnapshot === undefined ||
            sourceAction.resolutionSnapshot === undefined)))) ||
    !copyMoveUseAvailable(state, actor.id, copyingMove.id, copyEffect)
  )
    return { ok: false, error: invalidFightState(state) };
  const stateWithoutPending = { ...state };
  Reflect.deleteProperty(stateWithoutPending, "pendingDecision");
  const stateWithoutFrame: ActiveFightState = {
    ...stateWithoutPending,
    resolutionFrames: stateWithoutPending.resolutionFrames.filter(
      (candidate) => candidate.id !== frame.id,
    ),
  };
  const copiedDecision = {
    type: "use-move" as const,
    id: frame.decisionId ?? decision.id,
    actorId: actor.id,
    expectedStateVersion: state.version,
    moveId: copyingMove.id,
    targetCombatantId: target.id,
  };
  const priorDamage = option.sourceDamageDealt;
  const priorCopy = option.sourceActionId !== undefined;
  const fullPriorAttackCopy = isFullPriorAttackCopy(copyEffect);
  const copiedMove =
    priorCopy && priorDamage !== undefined && !fullPriorAttackCopy
      ? copiedMoveForFixedDamage(copyingMove, sourceMove)
      : copiedMoveForAction(copyingMove, sourceMove);
  return resolveConvertedAttackMove(stateWithoutFrame, copiedDecision, copiedMove, dependencies, {
    ...(priorCopy && priorDamage !== undefined && !fullPriorAttackCopy
      ? {
          baseDamageOverride: priorDamage,
          copiedDamageOverride: priorDamage,
          copiedSuccessfulEffectsOnly: true,
        }
      : {}),
    ...(fullPriorAttackCopy && option.sourceResolutionSnapshot !== undefined
      ? { copiedSourceResolution: option.sourceResolutionSnapshot }
      : {}),
    copiedFromMoveId: sourceMove.id,
    copiedSourceMove: sourceMove,
  });
};

const powerUpEffectsForActivatedConstant = (
  state: ActiveFightState,
  actor: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId] | undefined,
  move: MoveDefinition,
  dependencies: CombatDependencies,
) => {
  if (target === undefined) return [];
  const effects = moveEffectsForTrigger(move, "on-power-up", {
    self: actor,
    opponent: target,
    turnNumber: state.turnNumber,
    completedTurnCount: state.turnNumber - 1,
    moves: new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate])),
    moveActivationCounts: moveActivationCounts(state),
    successfulHitCount: 0,
    actionHistory: state.actionHistory,
    activeEffects: state.activeEffects,
    mode: state.mode,
  });
  return convertedAttackActivatedEffects({
    state,
    dependencies,
    attacker: actor,
    target,
    move,
    createdOnTurn: state.turnNumber,
    effects,
    defeated: false,
  });
};

const powerUpMasteryActivation = (frame: ActivationFrame, move: MoveDefinition) =>
  frame.activationAsIf === "power-up" &&
  move.category === "mastery" &&
  move.effects?.some((effect) => effect.trigger === "on-power-up") === true;

const activationCostForFrame = (
  state: ActiveFightState,
  actor: ActiveFightState["combatants"][CombatantId],
  move: MoveDefinition,
  frame: ActivationFrame,
  powerUpMastery: boolean,
) => {
  let baseCost = 0;
  if (!powerUpMastery) {
    if (move.mechanics.kiCost?.type === "literal")
      baseCost = convertedAttackCost(state, actor, move, move.mechanics.kiCost.value);
    else baseCost = Number.NaN;
  }
  return (
    frame.activationCostOverride ??
    Math.max(baseCost, frame.activationCost?.amount ?? 0, frame.activationCost?.minimum ?? 0)
  );
};

const activationSelectionInvalid = ({
  state,
  actor,
  move,
  frame,
  deactivated,
  powerUpMastery,
  cost,
}: {
  readonly state: ActiveFightState;
  readonly actor: ActiveFightState["combatants"][CombatantId];
  readonly move: MoveDefinition;
  readonly frame: ActivationFrame;
  readonly deactivated: ActiveCombatEffect | undefined;
  readonly powerUpMastery: boolean;
  readonly cost: number;
}) => {
  if (!isConstantSkill(move) && !powerUpMastery) return true;
  if (!actor.moveIds.includes(move.id)) return true;
  if (moveUsePreventionFor(state, actor.id, move, "activate") !== undefined) return true;
  if (hasActiveConstant(state, actor.id, move.id)) return true;
  if (frame.reactivationOnly === true && deactivated === undefined) return true;
  if (!powerUpMastery && move.mechanics.kiCost?.type !== "literal") return true;
  if (actor.ki.current < cost) return true;
  return !isRestrictedUseAvailable(
    actor.moveUses[move.id] ?? 0,
    effectiveRestrictedMoveUseLimit(state, actor, move),
  );
};

const deactivatedConstantForSelection = (
  state: ActiveFightState,
  actor: ActiveFightState["combatants"][CombatantId],
  move: MoveDefinition,
) =>
  state.activeEffects.find(
    (effect): effect is Extract<ActiveCombatEffect, { readonly type: "active-constant" }> =>
      effect.type === "active-constant" &&
      effect.lifecycle === "deactivated" &&
      effect.sourceCombatantId === actor.id &&
      effect.sourceDefinitionId === move.id,
  );

const activeEffectsAfterActivation = (
  state: ActiveFightState,
  actor: ActiveFightState["combatants"][CombatantId],
  move: MoveDefinition,
  frame: ActivationFrame,
  deactivated: Extract<ActiveCombatEffect, { readonly type: "active-constant" }> | undefined,
  activeEffectId: Extract<ActiveCombatEffect, { readonly type: "active-constant" }>["id"],
  cost: number,
) =>
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
          ...(frame.selectionKey === undefined ? {} : { selectionKey: frame.selectionKey }),
        },
      ]
    : state.activeEffects.map((effect) =>
        effect.id === deactivated.id
          ? { ...effect, lifecycle: "active" as const, deactivatedOnTurn: undefined }
          : effect,
      );

const remainingActivationMoveIds = (
  frame: ActivationFrame,
  selectedMoveId: MoveId,
  actorId: CombatantId,
  activeEffects: readonly ActiveCombatEffect[],
) =>
  (frame.eligibleMoveIds ?? []).filter(
    (moveId) =>
      moveId !== selectedMoveId &&
      (frame.reactivationOnly !== true ||
        activeEffects.some(
          (effect) =>
            effect.type === "active-constant" &&
            effect.lifecycle === "deactivated" &&
            effect.sourceCombatantId === actorId &&
            effect.sourceDefinitionId === moveId,
        )),
  );

const activationAsIfEffects = (
  state: ActiveFightState,
  frame: ActivationFrame,
  deactivated: Extract<ActiveCombatEffect, { readonly type: "active-constant" }> | undefined,
  actor: ActiveFightState["combatants"][CombatantId],
  move: MoveDefinition,
  dependencies: CombatDependencies,
) => {
  if (frame.activationAsIf !== "power-up" || deactivated !== undefined) return [];
  return powerUpEffectsForActivatedConstant(
    state,
    actor,
    Object.values(state.combatants).find(
      (candidate) => candidate.id !== actor.id && candidate.status === "active",
    ),
    move,
    dependencies,
  );
};

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
  if (move === undefined) return { ok: false, error: invalidFightState(state) };
  const actor = state.combatants[frame.targetCombatantId];
  const powerUpMastery = powerUpMasteryActivation(frame, move);
  const deactivated = deactivatedConstantForSelection(state, actor, move);
  const cost = activationCostForFrame(state, actor, move, frame, powerUpMastery);
  if (activationSelectionInvalid({ state, actor, move, frame, deactivated, powerUpMastery, cost }))
    return { ok: false, error: invalidFightState(state) };
  const activeEffectId = deactivated?.id ?? dependencies.ids.nextActiveEffectId();
  const activeEffects = activeEffectsAfterActivation(
    state,
    actor,
    move,
    frame,
    deactivated,
    activeEffectId,
    cost,
  );
  const stateWithActivatedConstant: ActiveFightState = { ...state, activeEffects };
  const asIfEffects = activationAsIfEffects(
    stateWithActivatedConstant,
    frame,
    deactivated,
    actor,
    move,
    dependencies,
  );
  const effectsAfterActivation = [...activeEffects, ...asIfEffects];
  const stateWithoutPending = { ...state };
  Reflect.deleteProperty(stateWithoutPending, "pendingDecision");
  const remainingSelections = Math.max(0, (frame.remainingSelections ?? 1) - 1);
  const eligibleMoveIds = remainingActivationMoveIds(frame, move.id, actor.id, activeEffects);
  const shouldContinue = remainingSelections > 0 && eligibleMoveIds.length > 0;
  const nextPendingDecisionId = shouldContinue
    ? dependencies.ids.nextPendingDecisionId()
    : undefined;
  const nextPendingDecision = shouldContinue
    ? {
        id: nextPendingDecisionId!,
        stateVersion: state.version + 1,
        combatantId: frame.sourceCombatantId,
        type: "select-move" as const,
        options: [
          ...eligibleMoveIds.map((moveId) => ({
            id: `activate:${moveId}`,
            type: "select-move" as const,
            moveId,
          })),
          ...(frame.optional === true ? [{ id: "decline", type: "decline" as const }] : []),
        ],
      }
    : undefined;
  const nextState: ActiveFightState = {
    ...stateWithoutPending,
    version: state.version + 1,
    activeEffects: effectsAfterActivation,
    combatants: {
      ...state.combatants,
      [actor.id]: {
        ...actor,
        ki: { ...actor.ki, current: actor.ki.current - cost },
        moveUses: { ...actor.moveUses, [move.id]: (actor.moveUses[move.id] ?? 0) + 1 },
      },
    },
    resolutionFrames: shouldContinue
      ? state.resolutionFrames.map((candidate) =>
          candidate.id === frame.id
            ? {
                ...frame,
                pendingDecisionId: nextPendingDecisionId!,
                eligibleMoveIds,
                remainingSelections,
              }
            : candidate,
        )
      : state.resolutionFrames.filter((candidate) => candidate.id !== frame.id),
    ...(nextPendingDecision === undefined ? {} : { pendingDecision: nextPendingDecision }),
    eventSequence: state.eventSequence + 2 + asIfEffects.length,
  };
  const events: CombatEvent[] = [
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
    ...asIfEffects.map((effect, index) => ({
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + 3 + index,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "effect-activated" as const,
      activeEffectId: effect.id,
      sourceCombatantId: effect.sourceCombatantId,
      targetCombatantId: effect.targetCombatantId,
      sourceDefinitionId: effect.sourceDefinitionId,
    })),
  ];
  return transitionFrom(nextState, events);
};

interface DeactivationCostResolution {
  readonly resource: "hp" | "ki";
  readonly amount: number;
  readonly remaining: number;
}

const resolveDeactivationCost = (
  actor: ActiveFightState["combatants"][CombatantId],
  cost: Extract<ResolutionFrame, { readonly type: "effect" }>["activationCost"],
): DeactivationCostResolution | undefined => {
  if (cost === undefined) return { resource: "ki", amount: 0, remaining: actor.ki.current };
  const resource = cost.resource ?? "ki";
  const current = resource === "ki" ? actor.ki.current : actor.hitPoints.current;
  const remaining = current - cost.amount;
  if (remaining < 0 || (cost.minimum !== undefined && remaining < cost.minimum)) return undefined;
  return { resource, amount: cost.amount, remaining };
};

const combatantsAfterDeactivationCost = (
  state: ActiveFightState,
  actor: ActiveFightState["combatants"][CombatantId],
  cost: DeactivationCostResolution,
  hasCost: boolean,
) =>
  !hasCost
    ? state.combatants
    : {
        ...state.combatants,
        [actor.id]: {
          ...actor,
          ...(cost.resource === "ki"
            ? { ki: { ...actor.ki, current: cost.remaining } }
            : { hitPoints: { ...actor.hitPoints, current: cost.remaining } }),
        },
      };

const deactivationCostEvent = (
  state: ActiveFightState,
  actor: ActiveFightState["combatants"][CombatantId],
  cost: DeactivationCostResolution,
  decision: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
  dependencies: CombatDependencies,
): CombatEvent | undefined => {
  if (cost.amount === 0) return undefined;
  const base = {
    id: dependencies.ids.nextEventId(),
    sequence: state.eventSequence + 1,
    fightId: state.id,
    causedByDecisionId: decision.id,
  };
  if (cost.resource === "ki")
    return {
      ...base,
      type: "ki-changed",
      combatantId: actor.id,
      amount: -cost.amount,
      remainingKi: cost.remaining,
    };
  return {
    ...base,
    type: "hp-changed",
    sourceCombatantId: actor.id,
    targetCombatantId: actor.id,
    amount: -cost.amount,
    remainingHitPoints: cost.remaining,
  };
};

const resolveEffectSelectionOperation = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
  dependencies: CombatDependencies,
  frame: Extract<ActiveFightState["resolutionFrames"][number], { readonly type: "effect" }>,
): CombatResult<CombatTransition> | undefined => {
  if (frame.operation === "activate")
    return resolveActivationSelection(state, decision, dependencies);
  if (frame.operation === "copy-move")
    return resolveCopiedMoveSelection(state, decision, dependencies, frame);
  if (frame.operation === "select-damage-target")
    return resolveSelectedDamageTargetSelection(state, decision, dependencies, frame);
  if (frame.operation === "select-suppression-target")
    return resolveSelectedSuppressionTargetSelection(state, decision, dependencies, frame);
  if (frame.operation === "select-move-removal")
    return resolveSelectedTemporaryMoveRemovalSelection(state, decision, dependencies, frame);
  return undefined;
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
  const operationTransition = resolveEffectSelectionOperation(state, decision, dependencies, frame);
  if (operationTransition !== undefined) return operationTransition;
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
  const actor = state.combatants[frame.sourceCombatantId];
  const cost = frame.activationCost;
  const resolvedCost = resolveDeactivationCost(actor, cost);
  if (resolvedCost === undefined) return { ok: false, error: invalidFightState(state) };
  const effect = state.activeEffects.find(
    (candidate): candidate is Extract<ActiveCombatEffect, { readonly type: "active-constant" }> =>
      candidate.type === "active-constant" &&
      candidate.sourceCombatantId === frame.targetCombatantId &&
      candidate.sourceDefinitionId === option.moveId &&
      frame.eligibleMoveIds?.includes(candidate.sourceDefinitionId) === true,
  );
  if (effect === undefined) return { ok: false, error: invalidFightState(state) };

  const deactivatedActiveEffects = state.activeEffects.map((candidate) =>
    candidate.id === effect.id
      ? { ...candidate, lifecycle: "deactivated" as const, deactivatedOnTurn: state.turnNumber }
      : candidate,
  );
  const activeEffects = [
    ...deactivatedActiveEffects,
    ...deactivatedListenerActiveEffects(state, deactivatedActiveEffects, effect, dependencies),
  ];
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
  const stateWithoutPending = {
    ...state,
    combatants: combatantsAfterDeactivationCost(state, actor, resolvedCost, cost !== undefined),
  };
  Reflect.deleteProperty(stateWithoutPending, "pendingDecision");
  const stateForDeactivation = {
    ...stateWithoutPending,
    eventSequence: state.eventSequence + (cost === undefined ? 0 : 1),
  };
  const nextState = createNextDeactivationState({
    stateWithoutPending: stateForDeactivation,
    activeEffects,
    shouldContinue,
    nextPendingDecisionId,
    frame,
    eligibleMoveIds,
    remainingSelections,
  });
  const costEvent =
    cost === undefined
      ? undefined
      : deactivationCostEvent(state, actor, resolvedCost, decision, dependencies);
  return transitionFrom(nextState, [
    ...(costEvent === undefined ? [] : [costEvent]),
    deactivationEvent(state, effect, decision.id, dependencies, nextState.eventSequence),
  ]);
};

type OptionalEffectResolutionFrame = Extract<
  ActiveFightState["resolutionFrames"][number],
  { readonly stage: "awaiting-effect-choice" }
>;

type OptionalPowerUpEffectResolutionFrame = Extract<
  ActiveFightState["resolutionFrames"][number],
  { readonly type: "effect-choice" }
>;

const optionalEffectFrameFor = (
  state: ActiveFightState,
  pendingDecisionId: PendingDecision["id"],
): OptionalEffectResolutionFrame | undefined =>
  state.resolutionFrames.find(
    (candidate): candidate is OptionalEffectResolutionFrame =>
      candidate.type === "attack" &&
      candidate.stage === "awaiting-effect-choice" &&
      candidate.pendingDecisionId === pendingDecisionId,
  );

const optionalPowerUpEffectFrameFor = (
  state: ActiveFightState,
  pendingDecisionId: PendingDecision["id"],
): OptionalPowerUpEffectResolutionFrame | undefined =>
  state.resolutionFrames.find(
    (candidate): candidate is OptionalPowerUpEffectResolutionFrame =>
      candidate.type === "effect-choice" && candidate.pendingDecisionId === pendingDecisionId,
  );

const deferredMoveFrameFor = (state: ActiveFightState, pendingDecisionId: PendingDecisionId) =>
  state.resolutionFrames.find(
    (candidate): candidate is Extract<ResolutionFrame, { readonly type: "effect" }> =>
      candidate.type === "effect" &&
      candidate.operation === "defer-move" &&
      candidate.pendingDecisionId === pendingDecisionId,
  );

const selectedNumericValuesForOption = (option: PendingDecisionOption | undefined) => {
  if (option?.selectedNumericValue === undefined) return undefined;
  const match = /:([^:=]+)=(-?\d+)$/.exec(option.id);
  return match === null ? undefined : { [match[1]]: Number(match[2]) };
};

const optionalEffectOptionIsValid = (
  option: PendingDecisionOption | undefined,
  frame: OptionalEffectResolutionFrame,
  selectedNumericValues: Readonly<Record<string, number>> | undefined,
) =>
  option !== undefined &&
  (option.type === "decline" || option.type === "activate-effect") &&
  (option.type !== "activate-effect" ||
    (frame.effectAlternatives === undefined
      ? option.effectIndices?.length === frame.effectIndices.length &&
        option.effectIndices.every((index, position) => index === frame.effectIndices[position])
      : frame.effectAlternatives.some(
          (alternative) =>
            option.effectIndices?.length === alternative.length &&
            option.effectIndices.every((index, position) => index === alternative[position]),
        ))) &&
  (option.selectedNumericValue === undefined || selectedNumericValues !== undefined);

const blockUsageForOptionalFrame = (
  state: ActiveFightState,
  frame: OptionalEffectResolutionFrame,
): BlockUsage | undefined => {
  if (frame.block === undefined) return undefined;
  const block = MOVE_DEFINITIONS.find((candidate) => candidate.id === frame.block!.blockId);
  return block === undefined
    ? undefined
    : {
        block,
        cost: frame.block.cost,
        defender: state.combatants[frame.targetCombatantId],
        response: { id: frame.block.responseDecisionId },
      };
};

const defenseItemUseForOptionalFrame = (
  state: ActiveFightState,
  frame: OptionalEffectResolutionFrame,
): DefenseItemUse | undefined => {
  if (frame.defenseItem === undefined) return undefined;
  const available = availablePreRollDefenseItems(state.combatants[frame.targetCombatantId]).find(
    ({ item }) => item.id === frame.defenseItem!.itemId,
  );
  return available === undefined
    ? undefined
    : {
        ...available,
        ...(frame.defenseItem.preventedStatuses === undefined
          ? {}
          : { preventedStatuses: frame.defenseItem.preventedStatuses }),
        response: { id: frame.defenseItem.responseDecisionId },
      };
};

const optionalFrameSupportingInputs = (
  state: ActiveFightState,
  frame: OptionalEffectResolutionFrame,
): Pick<AttackResolutionOptions, "blockUsage" | "defenseItemUse"> | undefined => {
  const blockUsage = blockUsageForOptionalFrame(state, frame);
  const defenseItemUse = defenseItemUseForOptionalFrame(state, frame);
  if (frame.block !== undefined && blockUsage === undefined) return undefined;
  if (frame.defenseItem !== undefined && defenseItemUse === undefined) return undefined;
  return { blockUsage, defenseItemUse };
};

const optionalEffectIndicesResolutionOptions = (
  frame: OptionalEffectResolutionFrame,
  enabledOptionalEffectIndices: readonly number[],
  resolvedOptionalEffectIndices: readonly number[],
) => {
  if (frame.effectTrigger === "on-move-use" || frame.effectTrigger === "on-cost-modified")
    return {
      costEffectSourceDefinitionId: frame.effectSourceDefinitionId,
      costEffectIndices: enabledOptionalEffectIndices,
      costEffectTrigger: frame.effectTrigger,
      ...(frame.effectSourceCombatantId === undefined
        ? {}
        : { costEffectOwnerId: frame.effectSourceCombatantId }),
    };
  if (frame.effectTrigger === "on-damage")
    return {
      damageEffectSourceDefinitionId: frame.effectSourceDefinitionId,
      damageEffectIndices: enabledOptionalEffectIndices,
    };
  return {
    ...(enabledOptionalEffectIndices.length === 0 ? {} : { enabledOptionalEffectIndices }),
    ...(resolvedOptionalEffectIndices.length === 0 ? {} : { resolvedOptionalEffectIndices }),
  };
};

const optionalEffectResolutionOptions = (
  frame: OptionalEffectResolutionFrame,
  supportingInputs: Pick<AttackResolutionOptions, "blockUsage" | "defenseItemUse">,
  enabledOptionalEffectIndices: readonly number[],
  resolvedOptionalEffectIndices: readonly number[],
  selectedNumericValues: Readonly<Record<string, number>> | undefined,
  selectedSuppressionMoves: AwaitingEffectChoiceAttackFrame["selectedSuppressionMoves"],
): AttackResolutionOptions => ({
  requestDefense: frame.effectTrigger !== "on-success" && frame.effectTrigger !== "on-damage",
  ...(frame.naturalRolls === undefined ? {} : { naturalRolls: frame.naturalRolls }),
  ...(frame.blockedDice === undefined ? {} : { blockedDice: frame.blockedDice }),
  ...(supportingInputs.blockUsage === undefined ? {} : { blockUsage: supportingInputs.blockUsage }),
  ...(supportingInputs.defenseItemUse === undefined
    ? {}
    : { defenseItemUse: supportingInputs.defenseItemUse }),
  ...(frame.defenseResultModifier === undefined
    ? {}
    : { defenseResultModifier: frame.defenseResultModifier }),
  ...(frame.preventCritical === undefined ? {} : { preventCritical: frame.preventCritical }),
  ...(frame.preventCounter === undefined ? {} : { preventCounter: frame.preventCounter }),
  ...(frame.resultOverrides === undefined ? {} : { resultOverrides: frame.resultOverrides }),
  ...(frame.numericResultOverrides === undefined
    ? {}
    : { numericResultOverrides: frame.numericResultOverrides }),
  ...optionalEffectIndicesResolutionOptions(
    frame,
    enabledOptionalEffectIndices,
    resolvedOptionalEffectIndices,
  ),
  ...(frame.enabledAfterDefenseEffectIndices === undefined
    ? {}
    : { enabledAfterDefenseEffectIndices: frame.enabledAfterDefenseEffectIndices }),
  ...(frame.includeRollEvents === undefined ? {} : { includeRollEvents: frame.includeRollEvents }),
  ...(selectedNumericValues === undefined ? {} : { selectedNumericValues }),
  ...(selectedSuppressionMoves === undefined ? {} : { selectedSuppressionMoves }),
  ...copiedAttackResolutionOptions(frame.attack),
});

type OptionalEffectPendingDecision = PendingDecision;

type PowerUpEffectChoiceFrame = Extract<
  ActiveFightState["resolutionFrames"][number],
  { readonly type: "effect-choice" }
>;

const resolveSimpleActionOptionalEffectChoice = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
  dependencies: CombatDependencies,
  pending: OptionalEffectPendingDecision,
  frame: PowerUpEffectChoiceFrame,
): CombatResult<CombatTransition> => {
  if (frame.effectTrigger === "on-move-use") {
    const option = pending.options.find((candidate) => candidate.id === decision.optionId);
    const enabledEffectIndices =
      option?.type === "activate-effect" ? (option.effectIndices ?? []) : [];
    const validActivation =
      option?.type === "decline" ||
      (option?.type === "activate-effect" &&
        option.moveId === frame.sourceDefinitionId &&
        enabledEffectIndices.length === frame.effectIndices.length &&
        enabledEffectIndices.every((index, position) => index === frame.effectIndices[position]));
    const move = MOVE_DEFINITIONS.find(
      (candidate) => candidate.id === (frame.actionMoveId ?? frame.sourceDefinitionId),
    );
    if (!validActivation || move === undefined || frame.sourceCombatantId === undefined)
      return {
        ok: false,
        error: {
          type: "invalid-pending-decision-option",
          pendingDecisionId: pending.id,
          optionId: decision.optionId,
        },
      };
    return resolveSimpleActionMove(
      withoutPendingResolution(state),
      {
        type: "use-move",
        id: frame.decisionId,
        actorId: frame.actorId,
        expectedStateVersion: state.version,
        moveId: move.id,
        targetCombatantId: frame.targetCombatantId,
      },
      move,
      dependencies,
      {
        moveUseSourceDefinitionId: frame.sourceDefinitionId,
        moveUseEffectIndices: enabledEffectIndices,
        moveUseEffectOwnerId: frame.sourceCombatantId,
      },
    );
  }
  if (frame.effectTrigger !== "on-roll-result" || frame.storedRolls === undefined)
    return { ok: false, error: invalidFightState(state) };
  const option = pending.options.find((candidate) => candidate.id === decision.optionId);
  const enabledEffectIndices =
    option?.type === "activate-effect" ? (option.effectIndices ?? []) : [];
  const validActivation =
    option?.type === "decline" ||
    (option?.type === "activate-effect" &&
      option.moveId === frame.sourceDefinitionId &&
      enabledEffectIndices.length === frame.effectIndices.length &&
      enabledEffectIndices.every((index, position) => index === frame.effectIndices[position]));
  if (!validActivation)
    return {
      ok: false,
      error: {
        type: "invalid-pending-decision-option",
        pendingDecisionId: pending.id,
        optionId: decision.optionId,
      },
    };
  const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === frame.sourceDefinitionId);
  if (move === undefined) return { ok: false, error: invalidFightState(state) };
  const stateWithoutFrame = withoutPendingResolution(state);
  return resolveSimpleActionMove(
    stateWithoutFrame,
    {
      type: "use-move",
      id: frame.decisionId,
      actorId: frame.actorId,
      expectedStateVersion: state.version,
      moveId: move.id,
      targetCombatantId: frame.targetCombatantId,
    },
    move,
    dependencies,
    {
      persistedStoredRolls: frame.storedRolls,
      enabledOptionalEffectIndices: enabledEffectIndices,
      resolvedOptionalEffectIndices: frame.effectIndices,
    },
  );
};

const resolvePendingPowerUpOptionalEffectChoice = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
  dependencies: CombatDependencies,
  pending: OptionalEffectPendingDecision,
  frame: PowerUpEffectChoiceFrame,
): CombatResult<CombatTransition> => {
  const option = pending.options.find((candidate) => candidate.id === decision.optionId);
  const isActivation = option?.type === "activate-effect";
  const indices = isActivation ? (option.effectIndices ?? []) : [];
  const validActivation =
    !isActivation ||
    (option.moveId === frame.sourceDefinitionId &&
      indices.length === frame.effectIndices.length &&
      indices.every((index, position) => index === frame.effectIndices[position]));
  if (
    option === undefined ||
    (option.type !== "decline" && option.type !== "activate-effect") ||
    !validActivation
  )
    return {
      ok: false,
      error: {
        type: "invalid-pending-decision-option",
        pendingDecisionId: pending.id,
        optionId: decision.optionId,
      },
    };
  return resolveEndPhaseDecision(
    withoutPendingResolution(state),
    {
      type: "power-up",
      id: frame.decisionId,
      actorId: frame.actorId,
      expectedStateVersion: state.version,
    },
    dependencies,
    {
      sourceDefinitionId: frame.sourceDefinitionId,
      effectIndices: indices,
    },
  );
};

const resolvedOptionalEffectIndicesFor = (
  frame: OptionalEffectResolutionFrame,
  option: PendingDecisionOption | undefined,
) => {
  const resolvedIndices =
    frame.effectAlternatives !== undefined && option?.type === "activate-effect"
      ? frame.effectAlternatives.flat()
      : frame.effectIndices;
  return [...(frame.priorResolvedOptionalEffectIndices ?? []), ...resolvedIndices];
};

/* eslint-disable sonarjs/cognitive-complexity -- ordered cost validation preserves the catalog choice's deterministic payment order. */
const resourceCostChoiceFailure = (
  state: ActiveFightState,
  move: MoveDefinition,
  effectIndices: readonly number[],
  frame: OptionalEffectResolutionFrame,
): CombatFailure | undefined => {
  if (frame.effectTrigger !== "on-success" || effectIndices.length === 0) return undefined;
  let available = state.combatants[frame.attackerId].ki.current;
  for (const effectIndex of effectIndices) {
    const effect = move.effects?.[effectIndex];
    if (effect?.type !== "modify-resource-cost" || effect.activationCost === undefined) continue;
    if (effect.activationCost.amount.type !== "literal") return invalidFightState(state);
    const amount = effect.activationCost.amount.value;
    available -= amount;
    const minimum =
      effect.activationCost.minimum?.type === "literal"
        ? effect.activationCost.minimum.value
        : undefined;
    if (available < 0 || (minimum !== undefined && available < minimum))
      return { type: "insufficient-ki", required: amount, available: available + amount };
  }
  for (const effectIndex of effectIndices) {
    const effect = move.effects?.[effectIndex];
    if (
      effect?.type !== "grant-extra-action" ||
      effect.activationCost === undefined ||
      effect.activationCost.resource !== "ki" ||
      effect.activationCost.operation !== "lose" ||
      effect.activationCost.amount.type !== "literal"
    )
      continue;
    const amount = effect.activationCost.amount.value;
    const minimum =
      effect.activationCost.minimum?.type === "literal"
        ? effect.activationCost.minimum.value
        : undefined;
    available -= amount;
    if (available < 0 || (minimum !== undefined && available < minimum))
      return { type: "insufficient-ki", required: amount, available: available + amount };
  }
  return undefined;
};
/* eslint-enable sonarjs/cognitive-complexity */

const resolveAttackOptionalEffectChoice = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
  dependencies: CombatDependencies,
  pending: OptionalEffectPendingDecision,
  frame: OptionalEffectResolutionFrame,
): CombatResult<CombatTransition> => {
  const option = pending.options.find((candidate) => candidate.id === decision.optionId);
  const enabledEffectIndices =
    option?.type === "activate-effect" ? (option.effectIndices ?? []) : [];
  const selectedNumericValues = selectedNumericValuesForOption(option);
  if (!optionalEffectOptionIsValid(option, frame, selectedNumericValues))
    return {
      ok: false,
      error: {
        type: "invalid-pending-decision-option",
        pendingDecisionId: pending.id,
        optionId: decision.optionId,
      },
    };
  const move = moveForAttackReference(frame.attack);
  if (move === undefined) return { ok: false, error: invalidFightState(state) };
  const resourceCostFailure = resourceCostChoiceFailure(state, move, enabledEffectIndices, frame);
  if (resourceCostFailure !== undefined) return { ok: false, error: resourceCostFailure };
  const enabledOptionalEffectIndices = [
    ...(frame.priorEnabledOptionalEffectIndices ?? []),
    ...enabledEffectIndices,
  ];
  const resolvedOptionalEffectIndices = resolvedOptionalEffectIndicesFor(frame, option);
  const supportingInputs = optionalFrameSupportingInputs(state, frame);
  if (supportingInputs === undefined) return { ok: false, error: invalidFightState(state) };
  if (option?.type === "activate-effect") {
    const selectedEffectIndices = selectedSuppressionEffectIndices(move, enabledEffectIndices);
    const selectedSuppressionMoves = [...(frame.selectedSuppressionMoves ?? [])];
    const nextSelection = selectedEffectIndices.find(
      (effectIndex) =>
        !selectedSuppressionMoves.some((selection) => selection.effectIndex === effectIndex),
    );
    if (nextSelection !== undefined) {
      const updatedFrame = {
        ...frame,
        enabledEffectIndices,
        resolvedEffectIndices: resolvedOptionalEffectIndices,
        ...(selectedNumericValues === undefined ? {} : { selectedNumericValues }),
        ...(selectedSuppressionMoves.length === 0 ? {} : { selectedSuppressionMoves }),
      };
      const stateWithUpdatedFrame: ActiveFightState = {
        ...state,
        resolutionFrames: state.resolutionFrames.map((candidate) =>
          candidate.id === frame.id ? updatedFrame : candidate,
        ),
      };
      return requestSelectedSuppressionTarget(
        stateWithUpdatedFrame,
        updatedFrame,
        move,
        nextSelection,
        dependencies,
      );
    }
  }
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
    optionalEffectResolutionOptions(
      frame,
      supportingInputs,
      enabledOptionalEffectIndices,
      resolvedOptionalEffectIndices,
      selectedNumericValues,
      frame.selectedSuppressionMoves,
    ),
  );
};

/* eslint-disable sonarjs/cognitive-complexity -- this transition validates, charges, and resumes two persisted timing boundaries. */
const resolveExtraActionActivationChoice = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
  dependencies: CombatDependencies,
  frame: Extract<ActiveFightState["resolutionFrames"][number], { readonly type: "effect" }>,
): CombatResult<CombatTransition> => {
  const pending = state.pendingDecision;
  const option = pending?.options.find((candidate) => candidate.id === decision.optionId);
  const allowance = state.activeEffects.find(
    (effect): effect is Extract<ActiveCombatEffect, { readonly type: "extra-action" }> =>
      effect.type === "extra-action" &&
      effect.id === frame.activeEffectId &&
      effect.sourceDefinitionId === frame.sourceDefinitionId &&
      effect.sourceEffectIndex === frame.effectIndex &&
      effect.targetCombatantId === frame.targetCombatantId &&
      effect.activationCost !== undefined,
  );
  const isActivation = option?.type === "activate-effect";
  const validActivation =
    isActivation &&
    option?.moveId === frame.sourceDefinitionId &&
    option?.effectIndices?.length === 1 &&
    option.effectIndices?.[0] === frame.effectIndex;
  if (
    pending?.type !== "optional-effect" ||
    allowance === undefined ||
    (option?.type !== "decline" && !validActivation)
  )
    return {
      ok: false,
      error: {
        type: "invalid-pending-decision-option",
        pendingDecisionId: pending?.id ?? decision.pendingDecisionId,
        optionId: decision.optionId,
      },
    };

  const activeEffects = isActivation
    ? state.activeEffects.map((effect) => {
        if (effect.id !== allowance.id || effect.type !== "extra-action") return effect;
        const activated = { ...effect, activationCost: undefined };
        Reflect.deleteProperty(activated, "activationCost");
        return activated;
      })
    : state.activeEffects.filter((effect) => effect.id !== allowance.id);
  const stateWithoutChoice: ActiveFightState = {
    ...state,
    version: state.version + 1,
    activeEffects,
    resolutionFrames: state.resolutionFrames.filter((candidate) => candidate.id !== frame.id),
  };
  Reflect.deleteProperty(stateWithoutChoice, "pendingDecision");
  const cost = isActivation ? allowance.activationCost : undefined;
  const actor = state.combatants[decision.actorId];
  if (cost === undefined || cost.resource !== "ki") {
    return { ok: false, error: invalidFightState(state) };
  }
  const remainingKi = actor.ki.current - cost.amount;
  if (
    isActivation &&
    (remainingKi < 0 || (cost.minimum !== undefined && remainingKi < cost.minimum))
  )
    return {
      ok: false,
      error: { type: "insufficient-ki", required: cost.amount, available: actor.ki.current },
    };
  const combatants = isActivation
    ? {
        ...state.combatants,
        [actor.id]: { ...actor, ki: { ...actor.ki, current: remainingKi } },
      }
    : state.combatants;
  const costEvent: CombatEvent | undefined =
    !isActivation || cost.amount === 0
      ? undefined
      : {
          id: dependencies.ids.nextEventId(),
          sequence: state.eventSequence + 1,
          fightId: state.id,
          causedByDecisionId: decision.id,
          type: "ki-changed",
          combatantId: actor.id,
          amount: -cost.amount,
          remainingKi,
        };
  if (frame.returnPhase === "end") {
    const nextState: ActiveFightState = {
      ...stateWithoutChoice,
      combatants,
      phase: isActivation ? "action" : "end",
      activeCombatantId: isActivation ? frame.sourceCombatantId : state.activeCombatantId,
      eventSequence:
        state.eventSequence + (costEvent === undefined ? 0 : 1) + (isActivation ? 1 : 0),
    };
    let choiceEvents: readonly CombatEvent[] = [];
    if (isActivation)
      choiceEvents = [
        ...(costEvent === undefined ? [] : [costEvent]),
        createPhaseChangedEvent(
          state,
          dependencies,
          "action",
          nextState.eventSequence,
          decision.id,
        ),
      ];
    else if (costEvent !== undefined) choiceEvents = [costEvent];
    return transitionFrom(nextState, choiceEvents);
  }
  const activeExtraActionState: ActiveFightState = {
    ...stateWithoutChoice,
    combatants,
    eventSequence: state.eventSequence + (costEvent === undefined ? 0 : 1),
    phase: "upkeep",
  };
  const keepUpkeep = hasAvailableExtraAction(activeExtraActionState, actor.id);
  if (keepUpkeep)
    return transitionFrom(activeExtraActionState, costEvent === undefined ? [] : [costEvent]);
  const nextState: ActiveFightState = {
    ...activeExtraActionState,
    phase: "action",
    eventSequence: activeExtraActionState.eventSequence + 1,
  };
  return transitionFrom(nextState, [
    ...(costEvent === undefined ? [] : [costEvent]),
    createPhaseChangedEvent(state, dependencies, "action", nextState.eventSequence, decision.id),
  ]);
};
/* eslint-enable sonarjs/cognitive-complexity */

const resolveUpkeepEffectChoice = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
  dependencies: CombatDependencies,
  pending: OptionalEffectPendingDecision,
  frame: UpkeepEffectChoiceFrame,
): CombatResult<CombatTransition> => {
  const option = pending.options.find((candidate) => candidate.id === decision.optionId);
  const enabledEffectIndices =
    option?.type === "activate-effect" ? (option.effectIndices ?? []) : [];
  const validActivation =
    option?.type === "activate-effect" &&
    option.moveId === frame.sourceDefinitionId &&
    enabledEffectIndices.length === frame.effectIndices.length &&
    enabledEffectIndices.every((index, position) => index === frame.effectIndices[position]);
  if (
    (option?.type !== "decline" && !validActivation) ||
    (option?.type !== "decline" && option?.type !== "activate-effect")
  )
    return {
      ok: false,
      error: {
        type: "invalid-pending-decision-option",
        pendingDecisionId: pending.id,
        optionId: decision.optionId,
      },
    };
  const nextState: ActiveFightState = {
    ...state,
    version: state.version + 1,
    resolutionFrames: state.resolutionFrames.map((candidate) => {
      if (candidate.id !== frame.id) return candidate;
      const resolvedFrame = {
        ...candidate,
        selectedEffectIndices: enabledEffectIndices,
        resolved: true,
      };
      Reflect.deleteProperty(resolvedFrame, "pendingDecisionId");
      return resolvedFrame;
    }),
  };
  Reflect.deleteProperty(nextState, "pendingDecision");
  return advanceUpkeepFight(nextState, dependencies);
};

const resolveOptionalPowerUpTransition = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
  dependencies: CombatDependencies,
  pending: PendingDecision,
): CombatResult<CombatTransition> | undefined => {
  const powerUpFrame = optionalPowerUpEffectFrameFor(state, pending.id);
  if (powerUpFrame === undefined) return undefined;
  return powerUpFrame.effectTrigger === "on-roll-result" ||
    powerUpFrame.effectTrigger === "on-move-use"
    ? resolveSimpleActionOptionalEffectChoice(state, decision, dependencies, pending, powerUpFrame)
    : resolvePendingPowerUpOptionalEffectChoice(
        state,
        decision,
        dependencies,
        pending,
        powerUpFrame,
      );
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
  const upkeepFrame = state.resolutionFrames.find(
    (candidate): candidate is UpkeepEffectChoiceFrame =>
      candidate.type === "effect-choice" &&
      candidate.returnPhase === "upkeep" &&
      candidate.pendingDecisionId === pending.id,
  );
  if (upkeepFrame !== undefined)
    return resolveUpkeepEffectChoice(state, decision, dependencies, pending, upkeepFrame);
  const powerUpTransition = resolveOptionalPowerUpTransition(
    state,
    decision,
    dependencies,
    pending,
  );
  if (powerUpTransition !== undefined) return powerUpTransition;
  const deferredFrame = deferredMoveFrameFor(state, pending.id);
  if (deferredFrame !== undefined) {
    const option = pending.options.find((candidate) => candidate.id === decision.optionId);
    const move = MOVE_DEFINITIONS.find(
      (candidate) => candidate.id === deferredFrame.sourceDefinitionId,
    );
    const validActivation =
      option?.type === "activate-effect" &&
      option.moveId === deferredFrame.sourceDefinitionId &&
      option.effectIndices?.length === 1 &&
      option.effectIndices[0] === deferredFrame.effectIndex;
    if (move === undefined || (option?.type !== "decline" && !validActivation))
      return {
        ok: false,
        error: {
          type: "invalid-pending-decision-option",
          pendingDecisionId: pending.id,
          optionId: decision.optionId,
        },
      };
    const stateWithoutFrame = withoutPendingResolution(state);
    const actionDecision = {
      type: "use-move" as const,
      id: deferredFrame.decisionId!,
      actorId: deferredFrame.sourceCombatantId,
      expectedStateVersion: state.version,
      moveId: move.id,
      targetCombatantId: deferredFrame.targetCombatantId,
    };
    return option.type === "decline"
      ? resolveConvertedAttackMove(stateWithoutFrame, actionDecision, move, dependencies, {
          deferMoveChoice: "decline",
        })
      : resolveDeferredMoveDeclaration(
          stateWithoutFrame,
          actionDecision,
          move,
          deferredFrame.effectIndex,
          dependencies,
        );
  }
  const extraActionFrame = state.resolutionFrames.find(
    (candidate): candidate is Extract<typeof candidate, { readonly type: "effect" }> =>
      candidate.type === "effect" &&
      candidate.operation === "activate-extra-action" &&
      candidate.pendingDecisionId === pending.id,
  );
  if (extraActionFrame !== undefined)
    return resolveExtraActionActivationChoice(state, decision, dependencies, extraActionFrame);
  const frame = optionalEffectFrameFor(state, pending.id);
  if (frame === undefined)
    return {
      ok: false,
      error: { type: "unsupported-mechanic", mechanic: "pending decision resolution" },
    };
  return resolveAttackOptionalEffectChoice(state, decision, dependencies, pending, frame);
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
  if (force !== undefined && !satisfiesForcedAction(state, force, decision)) {
    return { ok: false, error: { type: "illegal-decision", decisionType: decision.type } };
  }
  return resolvePlayerAction(
    force === undefined ? state : stateAfterForcedAction(state, decision.actorId),
    decision,
    dependencies,
  );
};
