import { GLOBAL_RULES } from "@dragonball-resurgence/game-config";
import {
  ITEM_DEFINITIONS,
  MOVE_DEFINITIONS,
  TRANSFORMATION_DEFINITIONS,
  type ItemDefinition,
  type MoveDefinition,
  type MoveSelectorCondition,
} from "@dragonball-resurgence/game-data";

import {
  blockedDiceForDeclaredBlock,
  resolveContestedAttackRolls,
  type ContestedAttackNaturalRoll,
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
import { evaluateDurableNumericExpression } from "./declarative-runtime.js";
import {
  adjustedMoveDamage,
  moveEffectsForTrigger,
  stoppedMoveEffects,
  successfulMoveEffects,
  type ResourceChange,
  type StatusApplication,
  type LockApplication,
  type DeactivationApplication,
  type MoveUsePreventionApplication,
  type StatusPreventionApplication,
  type RollModification,
  type RollDefinitionOverride,
  type ResolutionPreventionApplication,
  type CombatResultPreventionApplication,
} from "./move-effects-runtime.js";
import { resolveItemResources } from "./item-effects-runtime.js";
import { applyTransformation } from "./transformation-runtime.js";

import type {
  ActiveCombatEffect,
  ActiveCostModifierEffect,
  ActiveFightState,
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
  PendingDecisionOption,
} from "./contracts.js";
import type { CombatDependencies } from "./dependencies.js";
import type { CombatantId } from "./ids.js";
import { validateFightState } from "./invariants.js";

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

const moveAttackDetails = (move: MoveDefinition): BlockableAttack | undefined => {
  const attack = move.mechanics.attack;
  if (attack === undefined) return undefined;
  return {
    attackType: attack.type,
    tags: move.tags,
    restricted: move.mechanics.restrictedUses !== undefined,
  };
};

const simpleActionMoveUseLimit = (move: MoveDefinition) => {
  const limits = (move.effects ?? []).flatMap((effect) =>
    effect.trigger === "action-phase" && effect.useLimit?.scope === "combat"
      ? [effect.useLimit.count]
      : [],
  );
  return limits.length === 0 ? undefined : Math.min(...limits);
};

type MoveEffect = NonNullable<MoveDefinition["effects"]>[number];

const isResourceActionEffect = (effect: MoveEffect) =>
  effect.type === "modify-resource" && (effect.target === "self" || effect.target === "opponent");

const isDamageActionModifier = (
  effect: MoveEffect,
): effect is Extract<MoveEffect, { readonly type: "modify-damage" }> =>
  effect.type === "modify-damage" &&
  effect.target === "self" &&
  effect.percent !== undefined &&
  effect.scope?.type === "next-action" &&
  effect.selector === undefined;

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
  (effect.scope?.type === "next-action" || effect.scope?.type === "next-roll") &&
  effect.selector === undefined;

const isForcedActionEffect = (effect: MoveEffect) =>
  effect.type === "force-action" &&
  effect.target === "opponent" &&
  effect.scope?.type === "next-action" &&
  effect.selector === undefined;

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
        isForcedActionEffect(effect),
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
      effect.sourceCombatantId === combatantId &&
      effect.sourceDefinitionId === moveId,
  );

const hasPostDefenseReaction = (state: ActiveFightState, combatantId: CombatantId) =>
  availablePostRollDefenseItems(state.combatants[combatantId]).length > 0 ||
  hasActiveConstant(state, combatantId, "move-aoyosumu-close-shave") ||
  (state.combatants[combatantId].moveIds.includes("move-kurokonwaku-second-chance") &&
    (state.combatants[combatantId].moveUses["move-kurokonwaku-second-chance"] ?? 0) === 0);

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

const secondChanceOptions = (state: ActiveFightState, combatantId: CombatantId, dice: number) => {
  const combatant = state.combatants[combatantId];
  return combatant.moveIds.includes("move-kurokonwaku-second-chance") &&
    (combatant.moveUses["move-kurokonwaku-second-chance"] ?? 0) === 0
    ? Array.from({ length: dice }, (_, index) => ({
        id: `activate-move:move-kurokonwaku-second-chance:${index}`,
        type: "activate-effect" as const,
        moveId: "move-kurokonwaku-second-chance",
      }))
    : [];
};

const secondChanceDieForOption = (option: PendingDecisionOption) => {
  if (option.moveId !== "move-kurokonwaku-second-chance") return undefined;
  const index = Number(option.id.split(":").at(-1));
  return Number.isInteger(index) && index >= 0 ? index : undefined;
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
    if (effect.percent === undefined) return [];
    const amount = evaluateDurableNumericExpression(effect.percent, numericContext);
    return amount === undefined
      ? []
      : [{ ...nextActionModifierBase(context), modifier: { type: "damage" as const, amount } }];
  }
  if (!isRollActionModifier(effect)) return [];
  if (effect.amount === undefined) return [];
  const amount = evaluateDurableNumericExpression(effect.amount, numericContext);
  return amount === undefined
    ? []
    : [
        {
          ...nextActionModifierBase(context),
          modifier: {
            type: "roll" as const,
            roll: effect.roll,
            modifier: effect.modifier,
            amount,
          },
        },
      ];
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
    return move !== undefined && !locked && evaluateBlockEligibility(move, attack).canDeclare
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

const isCombatResourceItem = (item: (typeof ITEM_DEFINITIONS)[number]) =>
  item.effects?.some(
    (effect) =>
      effect.trigger === "combat-action" &&
      effect.type === "item-modify-resource" &&
      effect.target === "self",
  ) ?? false;

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

const rollModifierAmount = (
  effect: ActiveCombatEffect,
  combatantId: CombatantId,
  roll: "attack" | "defense",
  modifier: "result" | "sides",
) => {
  if (
    effect.type === "modify-roll" &&
    effect.targetCombatantId === combatantId &&
    effect.roll === roll &&
    effect.modifier === modifier
  ) {
    return effect.amount;
  }
  if (
    effect.type === "modify-next-action" &&
    effect.targetCombatantId === combatantId &&
    effect.modifier.type === "roll" &&
    effect.modifier.roll === roll &&
    effect.modifier.modifier === modifier
  ) {
    return effect.modifier.amount;
  }
  return 0;
};

const activeRollModifier = (
  state: ActiveFightState,
  combatantId: CombatantId,
  roll: "attack" | "defense",
  modifier: "result" | "sides",
) =>
  state.activeEffects.reduce(
    (total, effect) => total + rollModifierAmount(effect, combatantId, roll, modifier),
    0,
  );

const nextActionDamageAmount = (effect: ActiveCombatEffect, combatantId: CombatantId) => {
  if (effect.targetCombatantId !== combatantId) return 0;
  if (effect.type === "modify-item-next-attack-damage") return effect.amount;
  if (effect.type === "modify-next-action" && effect.modifier.type === "damage") {
    return effect.modifier.amount;
  }
  return 0;
};

const activeNextActionDamageModifier = (state: ActiveFightState, combatantId: CombatantId) =>
  state.activeEffects.reduce(
    (total, effect) => total + nextActionDamageAmount(effect, combatantId),
    0,
  );

/** BREAK and SEVER are combat statuses with source-defined outgoing damage penalties. */
const damageAfterStatusPenalties = (
  combatant: ActiveFightState["combatants"][CombatantId],
  damage: number,
) => {
  const statusPenalty = (
    status: ActiveFightState["combatants"][CombatantId]["activeStatuses"][number],
  ) => {
    if (status.statusId === "break") return status.stacks * 10;
    if (status.statusId === "sever") return status.stacks * 25;
    return 0;
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

const effectsAfterOwnerTurn = (state: ActiveFightState, combatantId: CombatantId) =>
  state.activeEffects.flatMap<ActiveCombatEffect>((effect) => {
    if (
      (effect.type !== "action-lock" &&
        effect.type !== "prevent-move-use" &&
        effect.type !== "prevent-status" &&
        effect.type !== "prevent-combat-result") ||
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
        effect.type !== "prevent-combat-result") ||
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

interface AttackEffectResolutionContext {
  readonly attackerId: CombatantId;
  readonly defenderId: CombatantId;
  readonly outcome?: "successful" | "stopped";
  readonly rolls?: readonly { readonly attackResult: number; readonly defenseResult?: number }[];
  readonly move?: MoveDefinition;
}

const lockExpiresAfterRoll = (
  effect: Extract<
    ActiveCombatEffect,
    {
      readonly type:
        "action-lock" | "prevent-move-use" | "prevent-status" | "prevent-combat-result";
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
        "action-lock" | "prevent-move-use" | "prevent-status" | "prevent-combat-result";
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
  if (effect.targetCombatantId === context.attackerId) return [];
  const consumesDefenseModifier =
    effect.targetCombatantId === context.defenderId &&
    effect.modifier.type === "roll" &&
    effect.modifier.roll === "defense";
  return consumesDefenseModifier ? [] : [effect];
};

const effectAfterAttackResolution = (
  effect: ActiveCombatEffect,
  context: AttackEffectResolutionContext,
): readonly ActiveCombatEffect[] => {
  if (effect.type === "modify-ki-cost")
    return costModifierAppliesToMove(effect, context) ? [] : [effect];
  if (
    effect.type === "modify-item-next-attack-damage" &&
    effect.targetCombatantId === context.attackerId
  ) {
    return effect.remainingAttacks === 1
      ? []
      : [{ ...effect, remainingAttacks: effect.remainingAttacks - 1 }];
  }
  if (
    effect.type === "action-lock" ||
    effect.type === "prevent-move-use" ||
    effect.type === "prevent-status" ||
    effect.type === "prevent-combat-result"
  ) {
    if (lockExpiresAfterRoll(effect, context) || lockExpiresAfterCombatResult(effect, context))
      return [];
    return [effect];
  }
  return effect.type === "modify-next-action"
    ? nextActionEffectAfterAttack(effect, context)
    : [effect];
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
) => ({
  ...roll,
  sides: roll.sides + activeRollModifier(state, combatantId, "attack", "sides"),
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
  readonly baseDamage: number;
  readonly attackResultModifier?: number;
  readonly defenseResultModifier?: number;
  readonly preventCritical?: boolean;
  readonly preventCounter?: boolean;
  readonly naturalRolls?: readonly ContestedAttackNaturalRoll[];
  readonly resultOverrides?: readonly ResultOverride[];
  readonly numericResultOverrides?: readonly NumericResultOverride[];
}

const resolveAttack = ({
  attacker,
  target,
  dependencies,
  attackSides,
  baseDamage,
  attackResultModifier = 0,
  defenseResultModifier = 0,
  preventCritical = false,
  preventCounter = false,
  naturalRolls,
  resultOverrides,
  numericResultOverrides,
}: ResolveAttackInput): AttackResolution => {
  const [die] = resolveContestedAttackRolls(
    {
      attack: { dice: 1, sides: attackSides },
      attackerDexterityBonus: attacker.stats.dexterityBonus + attackResultModifier,
      defenderDexterityBonus: target.stats.dexterityBonus,
      defenderResultModifier: defenseResultModifier,
      naturalRolls,
      resultOverrides,
      numericResultOverrides,
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
        actionHistory: [...state.actionHistory, actionRecordFor(state, decision)],
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
        actionHistory: [...state.actionHistory, actionRecordFor(state, decision)],
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
  const matchingEffects = state.activeEffects.filter(
    (effect): effect is ActiveCostModifierEffect =>
      effect.type === "modify-ki-cost" &&
      effect.targetCombatantId === attacker.id &&
      effect.selector.baseKiCost === baseCost.value,
  );
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
      attack.attackRoll.sides + activeRollModifier(state, attacker.id, "attack", "sides"),
    baseDamage: baseDamage + activeNextActionDamageModifier(state, attacker.id),
    attackResultModifier: activeRollModifier(state, attacker.id, "attack", "result"),
  });
  const matchingEffectIds = new Set(matchingEffects.map((effect) => effect.id));
  const remainingEffects = state.activeEffects.filter(
    (effect) => !matchingEffectIds.has(effect.id),
  );
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
  readonly moveUsePreventions: readonly MoveUsePreventionApplication[];
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

const resourceAfterChanges = (
  combatant: ActiveFightState["combatants"][CombatantId],
  changes: readonly ResourceChange[],
  target: "self" | "opponent",
) => {
  const relevant = changes.filter((change) => change.target === target);
  const nextResourceValue = (value: number, change: (typeof relevant)[number]) => {
    if (change.operation === "set") return change.amount;
    return change.operation === "gain" ? value + change.amount : value - change.amount;
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
  actionRecordFor(state, decision),
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
    ),
    context.statusApplications,
    "self",
  );
  const targetAfterEffects = statusesAfterApplications(
    resourceAfterChanges(targetAfterDamage, context.resourceChanges, "opponent"),
    context.statusApplications,
    "opponent",
  );
  const attackerAfterBlockEffects =
    blockUsage?.effects === undefined
      ? attackerAfterEffects
      : statusesAfterApplications(
          resourceAfterChanges(attackerAfterEffects, blockUsage.effects.resources, "opponent"),
          blockUsage.effects.statuses,
          "opponent",
        );
  const targetAfterBlockEffects =
    blockUsage?.effects === undefined
      ? targetAfterEffects
      : statusesAfterApplications(
          resourceAfterChanges(targetAfterEffects, blockUsage.effects.resources, "self"),
          blockUsage.effects.statuses,
          "self",
        );
  const targetAfterBlock = targetAfterBlockUse(targetAfterBlockEffects, blockUsage);
  const targetAfterDefenseItem = targetAfterDefenseItemUse(targetAfterBlock, defenseItemUse);
  const normalizedTarget =
    targetAfterDefenseItem.hitPoints.current === 0
      ? { ...targetAfterDefenseItem, status: "defeated" as const }
      : targetAfterDefenseItem;
  const normalizedAttacker =
    attackerAfterBlockEffects.hitPoints.current === 0
      ? { ...attackerAfterBlockEffects, status: "defeated" as const }
      : attackerAfterBlockEffects;
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
  return {
    ...state,
    version: state.version + 1,
    phase: context.counterContinues ? "counter" : "end",
    activeCombatantId: nextActiveCombatant,
    combatants,
    activeEffects: [
      ...effectsAfterAttackResolution(state, {
        attackerId: attacker.id,
        defenderId: target.id,
        outcome: context.roll.successfulHitCount > 0 ? "successful" : "stopped",
        rolls: context.roll.rolls,
        move: context.move,
      }),
      ...context.activatedEffects,
    ],
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
): CombatFailure | undefined => {
  const attack = move.mechanics.attack;
  const cost = move.mechanics.kiCost;
  if (target === undefined)
    return { type: "invalid-target", targetCombatantId: decision.targetCombatantId };
  if (attack?.baseDamagePercent === undefined || cost === undefined)
    return { type: "unsupported-mechanic", mechanic: `source expression: ${move.id}` };
  if (move.category === "signature" && !isSignatureTurnAvailable(state.turnNumber))
    return { type: "illegal-decision", decisionType: decision.type };
  const restrictedLimit =
    move.mechanics.restrictedUses?.type === "literal"
      ? move.mechanics.restrictedUses.value
      : undefined;
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
  const effectiveCost = calculateKiCost(
    baseCost,
    activeCostModifiersFor(state, attacker.id, move, baseCost).map((effect) => effect.amount),
  );
  return attacker.ki.current < effectiveCost
    ? { type: "insufficient-ki", required: effectiveCost, available: attacker.ki.current }
    : undefined;
};

const activeCostModifiersFor = (
  state: ActiveFightState,
  combatantId: CombatantId,
  move: MoveDefinition,
  baseKiCost: number,
) =>
  state.activeEffects.filter(
    (effect): effect is ActiveCostModifierEffect =>
      effect.type === "modify-ki-cost" &&
      effect.targetCombatantId === combatantId &&
      effect.selector.baseKiCost === baseKiCost &&
      effect.selector.category === move.category,
  );

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
    attack: { ...attack, baseDamagePercent: { type: "literal" as const, value: baseDamagePercent } } as LiteralMoveAttack,
    cost: { type: "literal" as const, value: baseKiCost },
  };
};

const shouldRequestMoveDefense = (
  state: ActiveFightState,
  target: ActiveFightState["combatants"][CombatantId],
  move: MoveDefinition,
  requestDefense: boolean,
) => {
  const blockableAttack = moveAttackDetails(move);
  return (
    requestDefense &&
    blockableAttack !== undefined &&
    (legalBlockMoves(state, target.id, blockableAttack).length > 0 ||
      availablePreRollDefenseItems(target).length > 0 ||
      hasPostDefenseReaction(state, target.id) ||
      hasEnergyRedirectionPotential(state, state.activeCombatantId, move))
  );
};

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
}

const convertedAttackCost = (
  state: ActiveFightState,
  attacker: ActiveFightState["combatants"][CombatantId],
  move: MoveDefinition,
  baseCost: number,
) =>
  calculateKiCost(
    baseCost,
    activeCostModifiersFor(state, attacker.id, move, baseCost).map((effect) => effect.amount),
  );

const convertedAttackEffectContext = (
  state: ActiveFightState,
  attacker: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
) => ({
  self: attacker,
  opponent: target,
  turnNumber: state.turnNumber,
  completedTurnCount: state.turnNumber - 1,
  moves: new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate])),
  moveActivationCounts: moveActivationCounts(state),
  successfulHitCount: 0,
});

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
  const effectRollModifier = (
    targetScope: "self" | "opponent",
    roll: RollModification["roll"],
    modifier: RollModification["modifier"],
  ) =>
    beforeAttackEffects.rollModifications
      .filter(
        (effect) =>
          effect.target === targetScope && effect.roll === roll && effect.modifier === modifier,
      )
      .reduce((total, effect) => total + effect.amount, 0);
  const rollDefinition = beforeAttackEffects.rollDefinitions.find(
    (effect): effect is RollDefinitionOverride =>
      effect.target === "self" && effect.roll === "attack",
  );
  const adjustedAttack = adjustedAttackRoll(
    state,
    attacker.id,
    attack.attackRoll ?? defaultMoveAttackRoll(),
  );
  const numericOverridesFromEffects: readonly NumericResultOverride[] = Array.from(
    { length: rollDefinition?.dice ?? adjustedAttack.dice },
    () =>
      beforeAttackEffects.rollResultOverrides.reduce<Exclude<NumericResultOverride, undefined>>(
        (current, effect) => ({ ...current, [effect.roll]: effect.value }),
        {},
      ),
  );
  return resolveMoveAttack(
    attacker,
    target,
    {
      attack: {
        ...adjustedAttack,
        ...(rollDefinition?.dice === undefined ? {} : { dice: rollDefinition.dice }),
        sides:
          (rollDefinition?.sides ?? adjustedAttack.sides) +
          effectRollModifier("self", "attack", "sides"),
      },
      attackResultModifier:
        activeRollModifier(state, attacker.id, "attack", "result") +
        effectRollModifier("self", "attack", "result"),
      defenseResultModifier:
        (defenseResultModifier ?? 0) +
        activeRollModifier(state, target.id, "defense", "result") +
        effectRollModifier("opponent", "defense", "result"),
      preventCritical: combatResultPrevented(state, attacker.id, "critical", move),
      preventCounter: combatResultPrevented(state, target.id, "counter", move),
      naturalRolls: input.naturalRolls,
      resultOverrides: input.resultOverrides,
      numericResultOverrides: input.numericResultOverrides ?? numericOverridesFromEffects,
      baseDamage: damageAfterStatusPenalties(
        attacker,
        adjustedMoveDamage(
          move,
          Math.round((attacker.stats.power * attack.baseDamagePercent.value) / 100) +
            activeNextActionDamageModifier(state, attacker.id),
          effectContext,
        ),
      ),
      damagePerHit: attack.damagePerHit,
    },
    dependencies.random,
    blockedDice,
  );
};

const convertedAttackActivatedEffects = (
  state: ActiveFightState,
  dependencies: CombatDependencies,
  attacker: ActiveFightState["combatants"][CombatantId],
  target: ActiveFightState["combatants"][CombatantId],
  move: MoveDefinition,
  effects: ReturnType<typeof successfulMoveEffects>,
  defeated: boolean,
) => {
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
  return [
    ...locks,
    ...moveUsePreventions,
    ...statusPreventions,
    ...combatResultPreventions,
    ...costModifiers,
  ];
};

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
  readonly secondChanceDie: number | undefined;
}

const completeConvertedAttackMove = ({
  state,
  decision,
  move,
  dependencies,
  attacker,
  target,
  blockedDice = 0,
  blockUsage,
  defenseItemUse,
  defenseResultModifier,
  includeRollEvents,
  naturalRolls,
  resultOverrides,
  numericResultOverrides,
}: CompleteConvertedAttackInput) => {
  const { attack, cost: baseCost } = resolvedLiteralAttack(state, attacker, target, move);
  const cost = convertedAttackCost(state, attacker, move, baseCost.value);
  const effectContext = convertedAttackEffectContext(state, attacker, target);
  const roll = convertedAttackRoll(
    {
      state,
      decision,
      move,
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
    },
    attack,
    effectContext,
  );
  const remainingHitPoints = Math.max(0, target.hitPoints.current - roll.damage);
  const resolvedEffectContext = {
    ...effectContext,
    successfulHitCount: roll.successfulHitCount,
    rolls: roll.rolls,
    paidKiCost: cost,
  };
  const effects =
    roll.successfulHitCount > 0
      ? successfulMoveEffects(move, resolvedEffectContext)
      : stoppedMoveEffects(move, resolvedEffectContext);
  const afterDefenseEffects = passiveAfterDefenseEffects(
    state,
    attacker,
    target,
    move,
    resolvedEffectContext,
  );
  const targetHitPointsAfterEffects = resourceAfterChanges(
    { ...target, hitPoints: { ...target.hitPoints, current: remainingHitPoints } },
    [...afterDefenseEffects.resources, ...effects.resources],
    "opponent",
  ).hitPoints.current;
  const defeated = targetHitPointsAfterEffects === 0;
  const counterChainLimitReached =
    roll.counter &&
    state.phase === "counter" &&
    !canContinueCounterChain(consecutiveCounterAttackCount(state) + 1);
  const context: ConvertedAttackMoveContext = {
    activatedEffects: [
      ...convertedAttackActivatedEffects(
        state,
        dependencies,
        attacker,
        target,
        move,
        { ...effects, locks: [...afterDefenseEffects.locks, ...effects.locks] },
        defeated,
      ),
    ],
    attacker,
    target,
    move,
    cost,
    roll,
    remainingHitPoints,
    resourceChanges: [...afterDefenseEffects.resources, ...effects.resources],
    deactivations: effects.deactivations,
    moveUsePreventions: effects.moveUsePreventions,
    statusPreventions: effects.statusPreventions,
    defeated,
    counterChainLimitReached,
    counterContinues: roll.counter && !counterChainLimitReached && !defeated,
    statusApplications: [...afterDefenseEffects.statuses, ...effects.statuses].filter(
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
    ? resolveDeactivations(
        nextState,
        context.deactivations,
        attacker.id,
        decision.id,
        dependencies,
        events,
      )
    : transitionFrom(nextState, events);
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
  }: AttackResolutionOptions = {},
): CombatResult<CombatTransition> => {
  const attacker = state.combatants[decision.actorId];
  const target = activeOpponent(state, attacker.id, decision.targetCombatantId);
  const failure = convertedAttackMoveFailure(state, decision, move, attacker, target);
  if (failure !== undefined) return { ok: false, error: failure };
  if (target === undefined) throw new Error("Validated attack moves require an active target.");
  const passiveEffects = moveEffectsForTrigger(move, "passive", {
    self: attacker,
    opponent: target,
    turnNumber: state.turnNumber,
    completedTurnCount: state.turnNumber - 1,
    moves: new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate])),
    moveActivationCounts: moveActivationCounts(state),
    successfulHitCount: 0,
    mode: state.mode,
  });
  const preventsBlock = passiveEffects.resolutionPreventions.some(
    (effect: ResolutionPreventionApplication) =>
      effect.target === "self" && effect.prevention === "block",
  );
  if (shouldRequestMoveDefense(state, target, move, requestDefense)) {
    const blockableAttack = moveAttackDetails(move);
    if (blockableAttack === undefined)
      throw new Error("A blockable move requires attack mechanics.");
    return requestAttackDefense({
      state,
      decision,
      target,
      attack: { type: "move", moveId: move.id },
      blockableAttack,
      preventBlock: preventsBlock,
      dependencies,
    });
  }
  return completeConvertedAttackMove({
    state,
    decision,
    move,
    dependencies,
    attacker,
    target,
    blockedDice,
    ...(blockUsage === undefined ? {} : { blockUsage }),
    ...(defenseItemUse === undefined ? {} : { defenseItemUse }),
    ...(defenseResultModifier === undefined ? {} : { defenseResultModifier }),
    ...(includeRollEvents === undefined ? {} : { includeRollEvents }),
    ...(naturalRolls === undefined ? {} : { naturalRolls }),
    ...(resultOverrides === undefined ? {} : { resultOverrides }),
    ...(numericResultOverrides === undefined ? {} : { numericResultOverrides }),
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
  attacker: CombatantState,
  target: CombatantState,
  options: BasicAttackResolutionOptions,
  dependencies: CombatDependencies,
) => {
  const basicDamage = damageAfterStatusPenalties(
    attacker,
    Math.round((attacker.stats.power * GLOBAL_RULES.combat.basicAttackPowerDamagePercent) / 100) +
      activeNextActionDamageModifier(state, attacker.id),
  );
  const resolution = resolveAttack({
    attacker,
    target,
    dependencies,
    attackSides:
      GLOBAL_RULES.combat.standardDieSides +
      activeRollModifier(state, attacker.id, "attack", "sides"),
    baseDamage: basicDamage,
    attackResultModifier: activeRollModifier(state, attacker.id, "attack", "result"),
    defenseResultModifier:
      (options.defenseResultModifier ?? 0) +
      activeRollModifier(state, target.id, "defense", "result"),
    preventCritical: combatResultPreventedForBasicAttack(state, attacker.id, "critical"),
    preventCounter: combatResultPreventedForBasicAttack(state, target.id, "counter"),
    naturalRolls: options.naturalRolls,
    resultOverrides: options.resultOverrides,
    numericResultOverrides: options.numericResultOverrides,
  });
  const counterAttackCount = consecutiveCounterAttackCount(state) + 1;
  const counterChainLimitReached =
    resolution.counter && state.phase === "counter" && !canContinueCounterChain(counterAttackCount);
  const counterContinues = resolution.counter && !counterChainLimitReached;
  const targetAfterAttack = basicAttackTargetAfterResolution(
    target,
    resolution,
    options.defenseItemUse,
  );
  const combatants =
    resolution.outcome === "successful" || options.defenseItemUse !== undefined
      ? { ...state.combatants, [target.id]: targetAfterAttack }
      : state.combatants;
  return { combatants, counterChainLimitReached, counterContinues, resolution };
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
      actionRecordFor(state, decision),
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
            outcome: resolution.outcome,
            rolls: [resolution],
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
    return [actionDecisionForMove(combatantId, opponentId, moveId)];
  });
  const actionMoves: LegalDecision[] = activeCombatant.moveIds.flatMap((moveId) => {
    const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === moveId);
    const useLimit = move === undefined ? undefined : simpleActionMoveUseLimit(move);
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
      !hasActiveConstant(state, combatantId, move.id)
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
  return force === undefined
    ? unlockedDecisions
    : unlockedDecisions.filter((decision) => satisfiesForcedAction(force, decision));
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

  if (state.phase === "upkeep") {
    const activeCombatant = state.combatants[state.activeCombatantId];
    const turnStartChecks = effectsAfterTurnStartChecks(state, activeCombatant.id, dependencies);
    const actionBlockingStatus = activeCombatant.activeStatuses.find(
      (status) =>
        (status.statusId === "stun" || status.statusId === "petrified") &&
        status.duration.type === "turns" &&
        status.duration.ownerCombatantId === activeCombatant.id,
    );
    if (actionBlockingStatus !== undefined && actionBlockingStatus.duration.type === "turns") {
      const nextState: ActiveFightState = {
        ...state,
        version: state.version + 1,
        phase: "end",
        combatants: {
          ...state.combatants,
          [activeCombatant.id]: activeCombatant,
        },
        activeEffects: turnStartChecks.effects,
        eventSequence: state.eventSequence + turnStartChecks.events.length + 2,
      };
      return transitionFrom(nextState, [
        ...turnStartChecks.events,
        {
          id: dependencies.ids.nextEventId(),
          sequence: state.eventSequence + turnStartChecks.events.length + 1,
          fightId: state.id,
          type: "action-skipped",
          combatantId: activeCombatant.id,
          reason: "status",
        },
        createPhaseChangedEvent(state, dependencies, "end", nextState.eventSequence),
      ]);
    }
    const nextState: ActiveFightState = {
      ...state,
      version: state.version + 1,
      phase: "action",
      activeEffects: turnStartChecks.effects,
      eventSequence: state.eventSequence + turnStartChecks.events.length + 1,
    };
    return transitionFrom(nextState, [
      ...turnStartChecks.events,
      createPhaseChangedEvent(state, dependencies, "action", nextState.eventSequence),
    ]);
  }
  if (state.phase === "end") {
    const nextCombatantId = nextActiveCombatantId(state);
    if (nextCombatantId === undefined) return { ok: false, error: invalidFightState(state) };

    const nextState: ActiveFightState = {
      ...state,
      version: state.version + 1,
      turnNumber: state.turnNumber + 1,
      phase: "upkeep",
      activeCombatantId: nextCombatantId,
      combatants: {
        ...state.combatants,
        [state.activeCombatantId]: {
          ...state.combatants[state.activeCombatantId],
          activeStatuses: statusesAfterOwnerTurn(state.combatants[state.activeCombatantId]),
        },
      },
      activeEffects: effectsAfterOwnerTurn(state, state.activeCombatantId),
      eventSequence: state.eventSequence + 2,
    };
    return transitionFrom(nextState, [
      createPhaseChangedEvent(state, dependencies, "upkeep", state.eventSequence + 1),
      {
        id: dependencies.ids.nextEventId(),
        sequence: nextState.eventSequence,
        fightId: state.id,
        type: "turn-started",
        combatantId: nextCombatantId,
        turnNumber: nextState.turnNumber,
      },
    ]);
  }

  return {
    ok: false,
    error: { type: "wrong-phase", expected: ["upkeep", "end"], actual: state.phase },
  };
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
  const limit = simpleActionMoveUseLimit(move);
  if (limit !== undefined && (actor.moveUses[move.id] ?? 0) >= limit) {
    return { ok: false, error: { type: "restricted-use-exhausted", moveId: move.id } };
  }
  if (actor.ki.current < cost.value) {
    return {
      ok: false,
      error: { type: "insufficient-ki", required: cost.value, available: actor.ki.current },
    };
  }
  const effects = moveEffectsForTrigger(move, "action-phase", {
    self: actor,
    opponent: target,
    turnNumber: state.turnNumber,
    completedTurnCount: state.turnNumber - 1,
    moves: new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate])),
    moveActivationCounts: moveActivationCounts(state),
    successfulHitCount: 0,
  });
  const actorAfter = statusesAfterApplications(
    resourceAfterChanges(
      {
        ...actor,
        ki: { ...actor.ki, current: actor.ki.current - cost.value },
        moveUses: { ...actor.moveUses, [move.id]: (actor.moveUses[move.id] ?? 0) + 1 },
      },
      effects.resources,
      "self",
    ),
    effects.statuses,
    "self",
  );
  const targetAfter = statusesAfterApplications(
    resourceAfterChanges(target, effects.resources, "opponent"),
    effects.statuses,
    "opponent",
  );
  const modifiers = actionMoveModifiers(move, actor, target, state, dependencies);
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
  const activatedEffects = [
    ...forcedActions,
    ...locks,
    ...moveUsePreventions,
    ...statusPreventions,
    ...combatResultPreventions,
  ];
  const events = simpleActionMoveEvents(state, decision, dependencies, {
    activatedEffects,
    move,
    actor,
    actorAfter,
    statusApplications: effects.statuses,
    target,
    targetAfter,
  });
  const nextState: ActiveFightState = {
    ...state,
    version: state.version + 1,
    phase: "end",
    combatants: { ...state.combatants, [actor.id]: actorAfter, [target.id]: targetAfter },
    activeEffects: [...state.activeEffects, ...modifiers, ...activatedEffects],
    actionHistory: [...state.actionHistory, actionRecordFor(state, decision)],
    eventSequence: state.eventSequence + events.length + 1,
  };
  events.push(
    createPhaseChangedEvent(state, dependencies, "end", nextState.eventSequence, decision.id),
  );
  return resolveDeactivations(
    nextState,
    effects.deactivations,
    actor.id,
    decision.id,
    dependencies,
    events,
  );
};

interface SimpleActionMoveEventContext {
  readonly activatedEffects: readonly ActiveCombatEffect[];
  readonly move: MoveDefinition;
  readonly actor: ActiveFightState["combatants"][CombatantId];
  readonly actorAfter: ActiveFightState["combatants"][CombatantId];
  readonly target: ActiveFightState["combatants"][CombatantId];
  readonly targetAfter: ActiveFightState["combatants"][CombatantId];
  readonly statusApplications: readonly StatusApplication[];
}

const simpleActionMoveEvents = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  dependencies: CombatDependencies,
  {
    activatedEffects,
    actor,
    actorAfter,
    move,
    statusApplications,
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
  const restrictedUses = move.mechanics.restrictedUses;
  if (
    restrictedUses?.type === "literal" &&
    (actor.moveUses[move.id] ?? 0) >= restrictedUses.value
  ) {
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
  const nextState: ActiveFightState = {
    ...state,
    version: state.version + 1,
    phase: "end",
    activeEffects:
      deactivatedConstant === undefined
        ? [
            ...state.activeEffects,
            {
              id: activeEffectId,
              type: "active-constant",
              sourceCombatantId: actor.id,
              targetCombatantId: actor.id,
              sourceDefinitionId: move.id,
              activatedOnTurn: state.turnNumber,
              duration: "combat",
              lifecycle: "active",
            },
          ]
        : state.activeEffects.map((effect) =>
            effect.id === deactivatedConstant.id
              ? { ...effect, lifecycle: "active" as const, deactivatedOnTurn: undefined }
              : effect,
          ),
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

const appendBlockedBasicEffectEvents = (
  state: ActiveFightState,
  dependencies: CombatDependencies,
  events: CombatEvent[],
  response: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
  attacker: CombatantState,
  defender: CombatantState,
  attackerAfter: CombatantState,
  defenderAfter: CombatantState,
  blockCost: number,
  effects: ReturnType<typeof resolvedBlockEffects>,
) => {
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
  const frameAttack = frame.attack;
  if (frameAttack.type !== "basic-attack") {
    return { ok: false, error: { type: "illegal-decision", decisionType: response.type } };
  }
  const basicFrame: BasicDefenseFrame = { ...frame, attack: frameAttack };
  const attacker = state.combatants[frame.attackerId];
  const defender = state.combatants[frame.targetCombatantId];
  if (hasDeclaredBlockThisTurn(state, defender.id)) {
    return { ok: false, error: { type: "block-limit-reached", combatantId: defender.id } };
  }
  const block = legalBasicBlock(state, defender.id, basicFrame.attack.basicAttack, blockMoveId);
  if (block === undefined) {
    return { ok: false, error: { type: "illegal-decision", decisionType: response.type } };
  }
  const restrictedUses = block.mechanics.restrictedUses;
  if (
    restrictedUses?.type === "literal" &&
    (defender.moveUses[block.id] ?? 0) >= restrictedUses.value
  ) {
    return { ok: false, error: { type: "restricted-use-exhausted", moveId: block.id } };
  }
  const cost = calculateConvertedBlockCost(block, 0);
  if (cost === undefined)
    return { ok: false, error: { type: "illegal-decision", decisionType: response.type } };
  if (defender.ki.current < cost) {
    return {
      ok: false,
      error: { type: "insufficient-ki", required: cost, available: defender.ki.current },
    };
  }
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
    ),
    effects.statuses,
    "self",
  );
  const attackerAfter = statusesAfterApplications(
    resourceAfterChanges(attacker, effects.resources, "opponent"),
    effects.statuses,
    "opponent",
  );
  appendBlockedBasicEffectEvents(
    state,
    dependencies,
    events,
    response,
    attacker,
    defender,
    attackerAfter,
    defenderAfter,
    cost,
    effects,
  );
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
  const attack = moveAttackDetails(move);
  if (attack === undefined || move.mechanics.kiCost?.type !== "literal") return undefined;
  const defender = state.combatants[frame.targetCombatantId];
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
      { requestDefense: false, ...modifiers },
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
    secondChanceOptions(state, defender.id, 1).length > 0 ||
    (move !== undefined && hasEnergyRedirectionPotential(state, attacker.id, move))
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
            baseDamage: 0,
            attackResultModifier: activeRollModifier(state, attacker.id, "attack", "result"),
            defenseResultModifier: activeRollModifier(state, defender.id, "defense", "result"),
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
      attack: adjustedAttackRoll(state, attacker.id, attack.attackRoll ?? defaultMoveAttackRoll()),
      attackResultModifier: activeRollModifier(state, attacker.id, "attack", "result"),
      defenseResultModifier: activeRollModifier(state, defender.id, "defense", "result"),
      baseDamage: 0,
      damagePerHit: attack.damagePerHit,
    },
    dependencies.random,
  ).rolls;
};

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
  const closeShaveActive = hasActiveConstant(state, defender.id, "move-aoyosumu-close-shave");
  const defenderOptions = [
    ...closeShaveReactionOptions(state, defender.id),
    ...secondChanceOptions(state, defender.id, rolls.length),
    ...availablePostRollDefenseItems(defender).map(({ item }) => ({
      id: `activate-item:${item.id}`,
      type: "activate-effect" as const,
      itemId: item.id,
    })),
  ];
  const attackerOptions = energyRedirectionOptions(
    state,
    attacker.id,
    frame.attack,
    rolls.map((roll) => ({
      ...roll,
      outcome:
        roll.attackResult >= roll.defenseResult ? ("successful" as const) : ("stopped" as const),
    })),
  );
  const reactionCombatantId = defenderOptions.length > 0 ? defender.id : attacker.id;
  const options = reactionCombatantId === defender.id ? defenderOptions : attackerOptions;
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

const requestPostDefenseReaction = (
  state: ActiveFightState,
  frame: Extract<
    ActiveFightState["resolutionFrames"][number],
    { readonly stage: "awaiting-defense" }
  >,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> | undefined => {
  const attacker = state.combatants[frame.attackerId];
  const defender = state.combatants[frame.targetCombatantId];
  if (!hasPostDefenseReactionPotential(state, frame)) return undefined;
  const rolls = postDefenseReactionRolls(state, frame, dependencies);
  if (rolls === undefined) return { ok: false, error: invalidFightState(state) };
  const reaction = postDefenseReaction(state, frame, rolls);
  if (reaction === undefined) return undefined;
  const pendingDecisionId = dependencies.ids.nextPendingDecisionId();
  const baseState = withoutPendingResolution(state);
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
          defense: roll.defenseNaturalResult!,
        })),
        resultOverrides: closeShaveResultOverrides(state, defender.id, rolls),
        numericResultOverrides: rolls.map((roll) => ({
          ...(roll.attackResult === roll.attackNaturalResult + attacker.stats.dexterityBonus
            ? {}
            : { attack: roll.attackResult }),
          ...(roll.defenseResult === roll.defenseNaturalResult! + defender.stats.dexterityBonus
            ? {}
            : { defense: roll.defenseResult }),
        })),
      },
    ],
    eventSequence: state.eventSequence + rolls.length * 2,
  };
  return transitionFrom(nextState, postDefenseReactionEvents(state, frame, dependencies, rolls));
};

const postDefenseReactionSelection = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
  frame: PostDefenseReactionFrame,
  option: PendingDecisionOption,
): PostDefenseReactionSelection | undefined => {
  if (option.type === "decline") {
    return {
      itemUse: undefined,
      closeShaveKiLoss: undefined,
      energyRedirectionDie: undefined,
      secondChanceDie: undefined,
    };
  }
  const itemUse =
    option.itemId === undefined
      ? undefined
      : availablePostRollDefenseItems(state.combatants[decision.actorId]).find(
          ({ item }) => item.id === option.itemId,
        );
  const closeShaveKiLoss = closeShaveKiLossForOption(option);
  const energyRedirectionDie = energyRedirectionDieForOption(option);
  const secondChanceDie = secondChanceDieForOption(option);
  const actor = state.combatants[decision.actorId];
  const canUseCloseShave =
    closeShaveKiLoss !== undefined &&
    actor.ki.current >= closeShaveKiLoss &&
    hasActiveConstant(state, decision.actorId, "move-aoyosumu-close-shave");
  const canUseEnergyRedirection =
    energyRedirectionDie !== undefined &&
    decision.actorId === frame.attackerId &&
    energyRedirectionDie < frame.naturalRolls.length &&
    energyRedirectionOptions(
      state,
      frame.attackerId,
      frame.attack,
      frame.naturalRolls.map((roll) => {
        const attackResult =
          roll.attack +
          state.combatants[frame.attackerId].stats.dexterityBonus +
          activeRollModifier(state, frame.attackerId, "attack", "result");
        const defenseResult =
          roll.defense +
          state.combatants[frame.targetCombatantId].stats.dexterityBonus +
          activeRollModifier(state, frame.targetCombatantId, "defense", "result");
        return {
          attackResult,
          defenseResult,
          outcome: attackResult >= defenseResult ? ("successful" as const) : ("stopped" as const),
        };
      }),
    ).some((candidate) => candidate.id === option.id);
  const canUseSecondChance =
    secondChanceDie !== undefined &&
    decision.actorId === frame.targetCombatantId &&
    secondChanceDie < frame.naturalRolls.length &&
    secondChanceOptions(state, decision.actorId, frame.naturalRolls.length).some(
      (candidate) => candidate.id === option.id,
    );
  if (itemUse === undefined && !canUseCloseShave && !canUseEnergyRedirection && !canUseSecondChance)
    return undefined;
  return { itemUse, closeShaveKiLoss, energyRedirectionDie, secondChanceDie };
};

const postDefenseReactionEventCount = (
  reactionKiCost: number | undefined,
  energyRedirectionDie: number | undefined,
  secondChanceDie: number | undefined,
) => {
  let count = 0;
  if (reactionKiCost !== undefined) count += 1;
  if (energyRedirectionDie !== undefined) count += 1;
  if (secondChanceDie !== undefined) count += 2;
  return count;
};

const postDefenseReactionState = (
  baseState: ActiveFightState,
  actorId: CombatantId,
  reactionKiCost: number | undefined,
  energyRedirectionDie: number | undefined,
  secondChanceDie: number | undefined,
): ActiveFightState => {
  if (reactionKiCost === undefined && secondChanceDie === undefined) return baseState;
  const actor = baseState.combatants[actorId];
  const moveUses = { ...actor.moveUses };
  if (energyRedirectionDie !== undefined) {
    moveUses["move-freestyle-energy-redirection"] =
      (moveUses["move-freestyle-energy-redirection"] ?? 0) + 1;
  }
  if (secondChanceDie !== undefined) {
    moveUses["move-kurokonwaku-second-chance"] =
      (moveUses["move-kurokonwaku-second-chance"] ?? 0) + 1;
  }
  return {
    ...baseState,
    eventSequence:
      baseState.eventSequence +
      postDefenseReactionEventCount(reactionKiCost, energyRedirectionDie, secondChanceDie),
    combatants: {
      ...baseState.combatants,
      [actorId]: {
        ...actor,
        ki: { ...actor.ki, current: actor.ki.current - (reactionKiCost ?? 0) },
        moveUses,
      },
    },
  };
};

const postDefenseReactionModifiers = (
  defenseItemUse: DefenseItemUse | undefined,
  defenseResultModifier: number,
  _secondChanceDie: number | undefined,
  naturalRolls: readonly ContestedAttackNaturalRoll[],
  resultOverrides: readonly ResultOverride[],
  numericResultOverrides: readonly NumericResultOverride[],
) => {
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
  };
};

const requestAttackerEnergyRedirection = (
  state: ActiveFightState,
  frame: PostDefenseReactionFrame,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> | undefined => {
  const attacker = state.combatants[frame.attackerId];
  const options = energyRedirectionOptions(
    state,
    attacker.id,
    frame.attack,
    frame.naturalRolls.map((roll) => ({
      attackNaturalResult: roll.attack,
      attackResult: roll.attack + attacker.stats.dexterityBonus,
      defenseNaturalResult: roll.defense,
      defenseResult: roll.defense + state.combatants[frame.targetCombatantId].stats.dexterityBonus,
      outcome:
        roll.attack + attacker.stats.dexterityBonus >=
        roll.defense + state.combatants[frame.targetCombatantId].stats.dexterityBonus
          ? ("successful" as const)
          : ("stopped" as const),
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
    const attackResult =
      roll.attack +
      state.combatants[frame.attackerId].stats.dexterityBonus +
      activeRollModifier(state, frame.attackerId, "attack", "result");
    const defenseResult =
      roll.defense! +
      state.combatants[frame.targetCombatantId].stats.dexterityBonus +
      activeRollModifier(state, frame.targetCombatantId, "defense", "result") +
      defenseResultModifier;
    if (selection.energyRedirectionDie === index) return "successful" as const;
    if (selection.secondChanceDie === index) return undefined;
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
    ? requestAttackerEnergyRedirection(state, frame, dependencies)
    : undefined;

const postDefenseReactionResolution = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
  frame: PostDefenseReactionFrame,
  selection: PostDefenseReactionSelection,
  dependencies: CombatDependencies,
) => {
  const { closeShaveKiLoss, energyRedirectionDie, itemUse, secondChanceDie } = selection;
  const defenseItemUse = itemUse === undefined ? undefined : { ...itemUse, response: decision };
  const defenseResultModifier = (defenseItemUse?.modifier.amount ?? 0) + (closeShaveKiLoss ?? 0);
  const naturalRolls = frame.naturalRolls.map((roll, index) =>
    secondChanceDie === index
      ? { ...roll, defense: dependencies.random.integer(1, GLOBAL_RULES.combat.standardDieSides) }
      : roll,
  );
  const numericResultOverrides = frame.numericResultOverrides.map((override, index) =>
    secondChanceDie !== index
      ? override
      : {
          ...override,
          defense:
            naturalRolls[index].defense +
            state.combatants[frame.targetCombatantId].stats.dexterityBonus +
            5,
        },
  );
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
    reactionKiCost: closeShaveKiLoss ?? (energyRedirectionDie === undefined ? undefined : 1),
  };
};

const resolvedPostDefenseReactionEvents = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "respond-to-pending-decision" }>,
  frame: PostDefenseReactionFrame,
  dependencies: CombatDependencies,
  resolution: ReturnType<typeof postDefenseReactionResolution>,
  selection: PostDefenseReactionSelection,
  reactionState: ActiveFightState,
) => {
  const events: CombatEvent[] = [];
  let reactionMoveId: MoveDefinition["id"] | undefined;
  if (selection.energyRedirectionDie !== undefined) {
    reactionMoveId = "move-freestyle-energy-redirection";
  } else if (selection.secondChanceDie !== undefined) {
    reactionMoveId = "move-kurokonwaku-second-chance";
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
    selection.secondChanceDie,
  );
  const modifiers = postDefenseReactionModifiers(
    resolution.defenseItemUse,
    resolution.defenseResultModifier,
    selection.secondChanceDie,
    resolution.naturalRolls,
    resolution.resultOverrides,
    resolution.numericResultOverrides,
  );
  const reactionEvents = resolvedPostDefenseReactionEvents(
    state,
    decision,
    frame,
    dependencies,
    resolution,
    selection,
    reactionState,
  );
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
  const powerUpAmount =
    decision.type === "power-up"
      ? Math.min(
          GLOBAL_RULES.combat.powerUpKiGain,
          activeCombatant.ki.maximum - activeCombatant.ki.current,
        )
      : 0;
  const nextState: ActiveFightState = {
    ...state,
    version: state.version + 1,
    phase: "end",
    eventSequence: state.eventSequence + (decision.type === "power-up" ? 2 : 1),
    actionHistory: [...state.actionHistory, actionRecordFor(state, decision)],
    combatants:
      decision.type === "power-up"
        ? {
            ...state.combatants,
            [decision.actorId]: {
              ...activeCombatant,
              ki: { ...activeCombatant.ki, current: activeCombatant.ki.current + powerUpAmount },
            },
          }
        : state.combatants,
  };
  const events: CombatEvent[] = [];
  if (decision.type === "power-up") {
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + 1,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "ki-changed",
      combatantId: decision.actorId,
      amount: powerUpAmount,
      remainingKi: activeCombatant.ki.current + powerUpAmount,
    });
  }
  events.push(
    createPhaseChangedEvent(state, dependencies, "end", nextState.eventSequence, decision.id),
  );
  return transitionFrom(nextState, events);
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
    !move.effectText.includes(selector.effectTextExcludes));

const selectorMatchesAttackRoll = (selector: MoveSelectorCondition, move: MoveDefinition) => {
  const attackRoll = move.mechanics.attack?.attackRoll;
  return (
    (selector.attackRoll?.dice === undefined || attackRoll?.dice === selector.attackRoll.dice) &&
    (selector.attackRoll?.minimumDice === undefined ||
      (attackRoll?.dice ?? 1) >= selector.attackRoll.minimumDice) &&
    (selector.attackRoll?.sides === undefined || attackRoll?.sides === selector.attackRoll.sides)
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
  application: DeactivationApplication,
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

const deactivateAllEligibleConstants = (
  activeEffects: readonly ActiveCombatEffect[],
  eligible: readonly Extract<ActiveCombatEffect, { readonly type: "active-constant" }>[],
  state: ActiveFightState,
  causedByDecisionId: CombatDecision["id"],
  dependencies: CombatDependencies,
  priorEventCount: number,
) => ({
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

const deactivationSelectionTransition = (
  state: ActiveFightState,
  activeEffects: readonly ActiveCombatEffect[],
  application: DeactivationApplication,
  sourceCombatantId: CombatantId,
  targetCombatantId: CombatantId,
  eligible: readonly Extract<ActiveCombatEffect, { readonly type: "active-constant" }>[],
  effectIndex: number,
  dependencies: CombatDependencies,
  events: readonly CombatEvent[],
  priorEventCount: number,
): CombatResult<CombatTransition> => {
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

/** Resolves automatic deactivations, or serializes the remaining player choice. */
const resolveDeactivations = (
  state: ActiveFightState,
  applications: readonly DeactivationApplication[],
  sourceCombatantId: CombatantId,
  causedByDecisionId: CombatDecision["id"],
  dependencies: CombatDependencies,
  priorEvents: readonly CombatEvent[],
): CombatResult<CombatTransition> => {
  let activeEffects = state.activeEffects;
  const events = [...priorEvents];
  for (const [effectIndex, application] of applications.entries()) {
    // This slice deliberately owns only converted CONSTANT Skill deactivation.
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
      const deactivation = deactivateAllEligibleConstants(
        activeEffects,
        eligible,
        state,
        causedByDecisionId,
        dependencies,
        events.length - priorEvents.length,
      );
      activeEffects = deactivation.activeEffects;
      events.push(...deactivation.events);
      continue;
    }
    return deactivationSelectionTransition(
      state,
      activeEffects,
      application,
      sourceCombatantId,
      targetCombatantId,
      eligible,
      effectIndex,
      dependencies,
      events,
      priorEvents.length,
    );
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

const itemUseEvents = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-item" }>,
  dependencies: CombatDependencies,
  combatant: ActiveFightState["combatants"][CombatantId],
  item: ItemDefinition,
  resources: { readonly hitPoints: number; readonly ki: number },
  activatedEffects: readonly ActiveCombatEffect[],
) => {
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

  const resources = isCombatResourceItem(item)
    ? resolveItemResources(item, "combat-action", combatant)
    : { hitPoints: combatant.hitPoints.current, ki: combatant.ki.current };
  const activatedEffects = activatedItemEffects(item, combatant, dependencies);
  const events = itemUseEvents(
    state,
    decision,
    dependencies,
    combatant,
    item,
    resources,
    activatedEffects,
  );
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
  const option = pending.options.find((candidate) => candidate.id === decision.optionId);
  const frame = state.resolutionFrames.find(
    (candidate): candidate is Extract<typeof candidate, { readonly type: "effect" }> =>
      candidate.type === "effect" && candidate.pendingDecisionId === pending.id,
  );
  if (option?.type === "decline") {
    if (frame?.optional !== true) {
      return {
        ok: false,
        error: {
          type: "invalid-pending-decision-option",
          pendingDecisionId: pending.id,
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
      candidate.sourceCombatantId === frame?.targetCombatantId &&
      candidate.sourceDefinitionId === option.moveId &&
      frame?.eligibleMoveIds?.includes(candidate.sourceDefinitionId) === true,
  );
  if (frame === undefined || effect === undefined)
    return { ok: false, error: invalidFightState(state) };

  const activeEffects = state.activeEffects.map((candidate) =>
    candidate.id === effect.id
      ? { ...candidate, lifecycle: "deactivated" as const, deactivatedOnTurn: state.turnNumber }
      : candidate,
  );
  const eligibleMoveIds = (frame.eligibleMoveIds ?? []).filter(
    (moveId) =>
      moveId !== effect.sourceDefinitionId &&
      activeEffects.some(
        (candidate) =>
          candidate.type === "active-constant" &&
          candidate.lifecycle !== "deactivated" &&
          candidate.sourceCombatantId === frame.targetCombatantId &&
          candidate.sourceDefinitionId === moveId,
      ),
  );
  const remainingSelections = Math.max(0, (frame.remainingSelections ?? 1) - 1);
  const shouldContinue = remainingSelections > 0 && eligibleMoveIds.length > 0;
  const nextPendingDecisionId = shouldContinue
    ? dependencies.ids.nextPendingDecisionId()
    : undefined;
  const stateWithoutPending = { ...state };
  Reflect.deleteProperty(stateWithoutPending, "pendingDecision");
  const nextState: ActiveFightState = {
    ...stateWithoutPending,
    version: state.version + 1,
    activeEffects,
    ...(shouldContinue
      ? {
          pendingDecision: {
            id: nextPendingDecisionId!,
            stateVersion: state.version + 1,
            combatantId: frame.sourceCombatantId,
            type: "select-move" as const,
            options: eligibleMoveIds.map((moveId) => ({
              id: `deactivate:${moveId}`,
              type: "select-move" as const,
              moveId,
            })),
          },
        }
      : {}),
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
    eventSequence: state.eventSequence + 1,
  };
  return transitionFrom(nextState, [
    deactivationEvent(state, effect, decision.id, dependencies, nextState.eventSequence),
  ]);
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
