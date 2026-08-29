import type { MoveId, NumericExpression } from "@dragonball-resurgence/game-data";

import type {
  ActiveEffectId,
  CombatantId,
  CombatDecisionId,
  ResolutionFrameId,
  ScheduledWorkId,
} from "./ids.js";
import { scheduledWorkIdSchema } from "./ids.js";
import type {
  ActiveCombatEffect,
  ActiveScheduledResourceEffect,
  ResolutionFrame,
} from "./contracts.js";

export type ScheduledWorkTiming =
  | { readonly type: "immediate" }
  | {
      readonly type: "end-of-action";
      readonly combatantId: CombatantId;
      readonly turnNumber: number;
    }
  | { readonly type: "next-upkeep"; readonly combatantId: CombatantId; readonly turnNumber: number }
  | {
      readonly type: "delayed";
      readonly combatantId: CombatantId;
      readonly phase: "upkeep" | "action" | "counter" | "end";
      readonly turnNumber: number;
    };

export type ScheduledCombatOperation =
  | {
      readonly type: "advance-phase";
      readonly phase: "upkeep" | "action" | "counter" | "end";
      readonly activeCombatantId: CombatantId;
    }
  | { readonly type: "skip-action"; readonly reason: "status" | "effect" }
  | {
      readonly type: "extra-action";
      readonly phase: "action" | "upkeep";
      readonly moveCategory?: "advanced-attack" | "item-use" | "skill" | "power-up";
      readonly sourceMoveOnly: boolean;
      readonly constant?: boolean;
      readonly remainingActions: number;
      readonly availableFromTurn: number;
      readonly expiresAfterTurn: number;
      readonly useLimit?: { readonly scope: "combat" | "turn"; readonly count: number };
      readonly activationCost?: {
        readonly resource: "ki";
        readonly amount: number;
        readonly minimum?: number;
      };
    }
  | {
      readonly type: "counter";
      readonly sourceActionId: CombatDecisionId;
      readonly returnFrameId: ResolutionFrameId;
      readonly chainDepth: number;
      readonly activationCost?: { readonly resource: "ki"; readonly amount: number };
    }
  | { readonly type: "resume-frame"; readonly frameId: ResolutionFrameId }
  | {
      readonly type: "resource";
      readonly resource: "hp" | "ki";
      readonly operation: "damage" | "drain" | "gain" | "lose" | "set";
      readonly amount: NumericExpression;
      readonly sourceEffectIndex: number;
      readonly boundary: ActiveScheduledResourceEffect["timing"];
      readonly remainingBoundaries: number;
      readonly repeat: "once" | "each-turn";
      readonly stacking?: "prevent";
      readonly duration?: NonNullable<ActiveScheduledResourceEffect["duration"]>;
      readonly cancellation?: NonNullable<ActiveScheduledResourceEffect["cancellation"]>;
    }
  | {
      readonly type: "deferred-move";
      readonly moveId: MoveId;
      readonly sourceEffectIndex: number;
      readonly declarationDecisionId: CombatDecisionId;
      readonly cancellation: {
        readonly actorCombatantId: CombatantId;
        readonly result: "successful";
      };
      readonly damageOverridePercent?: number;
      readonly onCancellation?: { readonly affectedType: "attack"; readonly duration: "combat" };
    }
  | {
      readonly type: "combat-result";
      readonly result: "successful" | "stopped";
      readonly replacement?: "successful" | "stopped";
      readonly prevented: boolean;
    };

export type ScheduledPhaseOperation = Extract<
  ScheduledCombatOperation,
  { readonly type: "advance-phase" }
>;

export interface PhaseOwnerState {
  readonly phase: "upkeep" | "action" | "counter" | "end";
  readonly activeCombatantId: CombatantId;
}

export interface ScheduledCombatWork {
  readonly id: ScheduledWorkId;
  /** Monotonic insertion position within one fight. */
  readonly insertionOrder: number;
  readonly sourceDefinitionId?: string;
  readonly sourceEffectId?: ActiveEffectId;
  readonly ownerCombatantId?: CombatantId;
  readonly targetCombatantId?: CombatantId;
  readonly timing: ScheduledWorkTiming;
  readonly operation: ScheduledCombatOperation;
}

export type ScheduledCombatWorkInput = Omit<ScheduledCombatWork, "id" | "insertionOrder">;

const legacyWorkId = (effect: ActiveEffectId, kind: string, namespace: string): ScheduledWorkId =>
  scheduledWorkIdSchema.parse(
    `scheduled-work:${namespace}-${kind}-${effect.slice("active-effect:".length)}`,
  );

const counterWorkId = (frame: ResolutionFrame): ScheduledWorkId =>
  scheduledWorkIdSchema.parse(
    `scheduled-work:mirror-counter-${frame.id.slice("resolution-frame:".length)}`,
  );

const frameWorkId = (frame: ResolutionFrame): ScheduledWorkId =>
  scheduledWorkIdSchema.parse(
    `scheduled-work:mirror-frame-${frame.id.slice("resolution-frame:".length)}`,
  );

const resultWorkId = (sourceId: string): ScheduledWorkId =>
  scheduledWorkIdSchema.parse(`scheduled-work:result-${sourceId.replaceAll(":", "-")}`);

/** Builds the immediate operation used between roll classification and damage/defeat handling. */
export const scheduledCombatResultOperation = (input: {
  readonly sourceId: string;
  readonly result: "successful" | "stopped";
  readonly replacement?: "successful" | "stopped";
  readonly prevented?: boolean;
}): ScheduledCombatWork & {
  readonly operation: Extract<ScheduledCombatOperation, { readonly type: "combat-result" }>;
} => ({
  id: resultWorkId(input.sourceId),
  insertionOrder: 1,
  timing: { type: "immediate" },
  operation: {
    type: "combat-result",
    result: input.result,
    ...(input.replacement === undefined ? {} : { replacement: input.replacement }),
    prevented: input.prevented === true,
  },
});

/** Executes a result operation without consulting move prose or consuming randomness. */
export const executeScheduledCombatResult = (
  operation: Extract<ScheduledCombatOperation, { readonly type: "combat-result" }>,
): "successful" | "stopped" =>
  operation.prevented ? "stopped" : (operation.replacement ?? operation.result);

/** Creates the only scheduler-owned phase/owner mutation operation. */
export const scheduledPhaseOperation = (
  phase: PhaseOwnerState["phase"],
  activeCombatantId: CombatantId,
): ScheduledPhaseOperation => ({ type: "advance-phase", phase, activeCombatantId });

export const scheduledSkipActionOperation = (
  reason: "status" | "effect",
): Extract<ScheduledCombatOperation, { readonly type: "skip-action" }> => ({
  type: "skip-action",
  reason,
});

/** Applies a phase handoff while preserving every other persisted state field. */
export const applyScheduledPhaseOperation = <T extends PhaseOwnerState>(
  state: T,
  operation: ScheduledPhaseOperation,
): T => ({ ...state, phase: operation.phase, activeCombatantId: operation.activeCombatantId });

/** Exposes one unresolved frame without replacing the frame as the resume authority. */
export const scheduledWorkFromResolutionFrame = (
  frame: ResolutionFrame,
  insertionOrder: number,
): ScheduledCombatWork => ({
  id: frameWorkId(frame),
  insertionOrder,
  timing: { type: "immediate" },
  operation: { type: "resume-frame", frameId: frame.id },
});

/** Exposes an awaiting counter frame as one deterministic scheduler request. */
export const scheduledWorkFromCounterFrame = (
  frame: Extract<ResolutionFrame, { readonly stage: "awaiting-counter" }>,
  insertionOrder: number,
  chainDepth = 1,
): ScheduledCombatWork => ({
  id: counterWorkId(frame),
  insertionOrder,
  sourceDefinitionId: frame.counterAction?.sourceDefinitionId,
  ownerCombatantId: frame.targetCombatantId,
  targetCombatantId: frame.attackerId,
  timing: { type: "immediate" },
  operation: {
    type: "counter",
    sourceActionId: frame.counterAction?.sourceAction?.decisionId ?? frame.decisionId,
    returnFrameId: frame.id,
    chainDepth,
    ...(frame.counterAction?.activationCost === undefined
      ? {}
      : {
          activationCost: {
            resource: frame.counterAction.activationCost.resource,
            amount: frame.counterAction.activationCost.amount,
          },
        }),
  },
});

const scheduledResourcePhase = (
  effect: ActiveScheduledResourceEffect,
): "upkeep" | "action" | "end" | undefined => {
  if (effect.timing.type === "turn-start") return "upkeep";
  if (effect.timing.type === "turn-end") return "end";
  return effect.timing.phase;
};

const scheduledExtraActionWork = (
  effect: Extract<ActiveCombatEffect, { readonly type: "extra-action" }>,
  currentTurn: number,
  insertionOrder: number,
  namespace: string,
): ScheduledCombatWork => ({
  id: legacyWorkId(effect.id, "extra-action", namespace),
  insertionOrder,
  sourceEffectId: effect.id,
  sourceDefinitionId: effect.sourceDefinitionId,
  ownerCombatantId: effect.sourceCombatantId,
  targetCombatantId: effect.targetCombatantId,
  timing: extraActionTiming(effect, currentTurn),
  operation: {
    type: "extra-action",
    phase: effect.phase,
    ...(effect.moveCategory === undefined ? {} : { moveCategory: effect.moveCategory }),
    sourceMoveOnly: effect.sourceMoveOnly,
    remainingActions: effect.remainingActions,
    availableFromTurn: effect.availableFromTurn,
    expiresAfterTurn: effect.expiresAfterTurn,
    ...(effect.activationCost === undefined
      ? {}
      : {
          activationCost: {
            resource: effect.activationCost.resource,
            amount: effect.activationCost.amount,
            ...(effect.activationCost.minimum === undefined
              ? {}
              : { minimum: effect.activationCost.minimum }),
          },
        }),
    ...(effect.constant === undefined ? {} : { constant: effect.constant }),
    ...(effect.useLimit === undefined ? {} : { useLimit: effect.useLimit }),
  },
});

const extraActionTiming = (
  effect: Extract<ActiveCombatEffect, { readonly type: "extra-action" }>,
  currentTurn: number,
): ScheduledWorkTiming => {
  if (effect.availableFromTurn <= currentTurn) return { type: "immediate" };
  return {
    type: "delayed",
    combatantId: effect.targetCombatantId,
    phase: effect.phase,
    turnNumber: effect.availableFromTurn,
  };
};

const scheduledResourceWork = (
  effect: ActiveScheduledResourceEffect,
  currentTurn: number,
  insertionOrder: number,
  namespace: string,
): ScheduledCombatWork | undefined => {
  const phase = scheduledResourcePhase(effect);
  if (phase === undefined) return undefined;
  return {
    id: legacyWorkId(effect.id, "scheduled-resource", namespace),
    insertionOrder,
    sourceEffectId: effect.id,
    sourceDefinitionId: effect.sourceDefinitionId,
    ownerCombatantId: effect.sourceCombatantId,
    targetCombatantId: effect.targetCombatantId,
    timing: {
      type: "delayed",
      combatantId: effect.timing.combatantId,
      phase,
      turnNumber: currentTurn + Math.max(effect.remainingBoundaries - 1, 0),
    },
    operation: {
      type: "resource",
      resource: effect.resource,
      operation: effect.operation,
      amount: effect.amount,
      sourceEffectIndex: effect.sourceEffectIndex,
      boundary: effect.timing,
      remainingBoundaries: effect.remainingBoundaries,
      repeat: effect.repeat,
      ...(effect.stacking === undefined ? {} : { stacking: effect.stacking }),
      ...(effect.duration === undefined ? {} : { duration: effect.duration }),
      ...(effect.cancellation === undefined ? {} : { cancellation: effect.cancellation }),
    },
  };
};

const scheduledDeferredMoveWork = (
  effect: Extract<ActiveCombatEffect, { readonly type: "deferred-move" }>,
  insertionOrder: number,
  namespace: string,
): ScheduledCombatWork => ({
  id: legacyWorkId(effect.id, "deferred-move", namespace),
  insertionOrder,
  sourceEffectId: effect.id,
  sourceDefinitionId: effect.sourceDefinitionId,
  ownerCombatantId: effect.sourceCombatantId,
  targetCombatantId: effect.targetCombatantId,
  timing: {
    type: "delayed",
    combatantId: effect.sourceCombatantId,
    phase: "action",
    turnNumber: effect.performOnTurn,
  },
  operation: {
    type: "deferred-move",
    moveId: effect.sourceDefinitionId,
    sourceEffectIndex: effect.sourceEffectIndex,
    declarationDecisionId: effect.declarationDecisionId,
    cancellation: effect.cancellation,
    ...(effect.damageOverridePercent === undefined
      ? {}
      : { damageOverridePercent: effect.damageOverridePercent }),
    ...(effect.onCancellation === undefined ? {} : { onCancellation: effect.onCancellation }),
  },
});

/** Converts scheduling-only v1 effects without consulting presentation events. */
export const scheduledWorkFromLegacyEffect = (
  effect: ActiveCombatEffect,
  currentTurn: number,
  insertionOrder: number,
  namespace = "legacy",
): ScheduledCombatWork | undefined => {
  if (effect.type === "extra-action")
    return scheduledExtraActionWork(effect, currentTurn, insertionOrder, namespace);
  if (effect.type === "scheduled-resource")
    return scheduledResourceWork(effect, currentTurn, insertionOrder, namespace);
  if (effect.type === "deferred-move")
    return scheduledDeferredMoveWork(effect, insertionOrder, namespace);
  return undefined;
};

export interface ScheduledWorkBoundary {
  readonly phase: "upkeep" | "action" | "counter" | "end";
  readonly combatantId: CombatantId;
  readonly turnNumber: number;
  readonly actionCompleted?: boolean;
}

export const scheduleCombatWork = (
  work: ScheduledCombatWorkInput,
  nextId: () => ScheduledWorkId,
  existing: readonly ScheduledCombatWork[] = [],
): ScheduledCombatWork => ({
  ...work,
  id: nextId(),
  insertionOrder:
    existing.reduce((highest, candidate) => Math.max(highest, candidate.insertionOrder), 0) + 1,
});

export const orderScheduledCombatWork = (
  work: readonly ScheduledCombatWork[],
): readonly ScheduledCombatWork[] =>
  [...work].sort(
    (left, right) => left.insertionOrder - right.insertionOrder || left.id.localeCompare(right.id),
  );

export const scheduledWorkIsDue = (
  work: ScheduledCombatWork,
  boundary: ScheduledWorkBoundary,
): boolean => {
  if (work.timing.type === "immediate") return true;
  if (work.timing.type === "end-of-action")
    return (
      boundary.actionCompleted === true &&
      boundary.combatantId === work.timing.combatantId &&
      boundary.turnNumber === work.timing.turnNumber
    );
  if (boundary.combatantId !== work.timing.combatantId) return false;
  if (work.timing.type === "next-upkeep")
    return boundary.phase === "upkeep" && boundary.turnNumber === work.timing.turnNumber;
  return boundary.phase === work.timing.phase && boundary.turnNumber === work.timing.turnNumber;
};

export const dueScheduledCombatWork = (
  work: readonly ScheduledCombatWork[],
  boundary: ScheduledWorkBoundary,
): readonly ScheduledCombatWork[] =>
  orderScheduledCombatWork(work).filter((candidate) => scheduledWorkIsDue(candidate, boundary));

export const consumeScheduledCombatWork = (
  work: readonly ScheduledCombatWork[],
  consumedIds: ReadonlySet<ScheduledWorkId>,
): readonly ScheduledCombatWork[] => work.filter((candidate) => !consumedIds.has(candidate.id));
