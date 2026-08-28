/** Shared, pure lifecycle transitions for durable combat effects. */
import { consumeRemainingUse } from "./availability.js";

export type EffectLifecycleState = "active" | "deactivated" | "cooldown" | "expired";

export type EffectLifecycleBoundary =
  | "combat"
  | "owner-turn"
  | "matching-action"
  | "matching-roll"
  | "combat-result"
  | "resource-threshold"
  | "roll-threshold"
  | "perfect-roll"
  | "turn-start-roll"
  | "scheduled-resource";

const lifecycleBoundaries: readonly EffectLifecycleBoundary[] = [
  "combat",
  "owner-turn",
  "matching-action",
  "matching-roll",
  "combat-result",
  "resource-threshold",
  "roll-threshold",
  "perfect-roll",
  "turn-start-roll",
  "scheduled-resource",
];

export interface EffectLifecycleBoundaryContext {
  readonly boundary: EffectLifecycleBoundary;
  /** False for the boundary that created/activated the effect. */
  readonly matchingBoundary?: boolean;
  /** Resolved roll/resource/result fact; false means the boundary did not match. */
  readonly boundarySatisfied?: boolean;
  /** Current event sequence, used to identify an activation boundary. */
  readonly eventSequence?: number;
  /** Current turn, used with activation metadata for deterministic replay. */
  readonly turnNumber?: number;
}

export interface EffectLifecycleRecord {
  readonly state: EffectLifecycleState;
  readonly activationBoundary?: EffectLifecycleBoundary;
  readonly activationTurn?: number;
  readonly activationEventSequence?: number;
  readonly duration?: { readonly boundary: EffectLifecycleBoundary; readonly remaining: number };
  readonly remainingUses?: number;
  readonly cooldown?: { readonly boundary: EffectLifecycleBoundary; readonly remaining: number };
}

export interface EffectLifecycleEvent {
  readonly type:
    "effect-use-consumed" | "effect-deactivated" | "effect-expired" | "effect-cooldown-started";
  readonly effectId: string;
}

export interface EffectLifecycleTransition {
  readonly lifecycle: EffectLifecycleRecord;
  readonly events: readonly EffectLifecycleEvent[];
}

const typedDurationLifecycle = (
  value: Record<string, unknown>,
): EffectLifecycleRecord["duration"] | undefined => {
  const typedDuration = value.duration;
  if (typeof typedDuration !== "object" || typedDuration === null) return undefined;
  const candidate = typedDuration as Record<string, unknown>;
  const type = candidate.type;
  const boundaryByType: Record<string, EffectLifecycleBoundary> = {
    combat: "combat",
    turns: "owner-turn",
    "next-actions": "matching-action",
    "following-action": "matching-action",
    "next-roll": "matching-roll",
    uses: "matching-action",
  };
  const boundary = typeof type === "string" ? boundaryByType[type] : undefined;
  const remaining = candidate.remaining;
  if (
    boundary !== undefined &&
    typeof remaining === "number" &&
    Number.isInteger(remaining) &&
    remaining > 0
  )
    return { boundary, remaining };
  return type === "combat" ? { boundary: "combat", remaining: 1 } : undefined;
};

/** Converts legacy specialized counters into the shared lifecycle vocabulary. */
/* eslint-disable sonarjs/cognitive-complexity -- legacy counter and typed-duration migration is intentionally centralized. */
export const normalizeLegacyEffectLifecycle = (
  effect: unknown,
): EffectLifecycleRecord | undefined => {
  if (typeof effect !== "object" || effect === null) return undefined;
  const value = effect as Record<string, unknown>;
  const legacyState = value.lifecycle;
  let state: EffectLifecycleState = "active";
  if (legacyState === "deactivated") state = "deactivated";
  else if (legacyState === "cooldown") state = "cooldown";
  const remainingTurns = value.remainingTurns;
  const remainingActions = value.remainingActions;
  const remainingTriggers = value.remainingTriggers;
  const remainingAttacks = value.remainingAttacks;
  const hasZeroRemaining = [
    remainingTurns,
    remainingActions,
    remainingTriggers,
    remainingAttacks,
  ].some((candidate) => candidate === 0);
  const remaining = [remainingTurns, remainingActions, remainingTriggers, remainingAttacks].find(
    (candidate): candidate is number =>
      typeof candidate === "number" && Number.isInteger(candidate) && candidate > 0,
  );
  let duration: EffectLifecycleRecord["duration"];
  let cooldown: EffectLifecycleRecord["cooldown"];
  if (hasZeroRemaining && state === "active") state = "expired";
  if (remaining !== undefined) {
    let boundary: EffectLifecycleBoundary = "matching-action";
    if (remainingTurns !== undefined) boundary = "owner-turn";
    else if (remainingTriggers !== undefined) boundary = "matching-roll";
    if (state === "cooldown") cooldown = { boundary, remaining };
    else duration = { boundary, remaining };
  }

  if (duration === undefined && cooldown === undefined) {
    const typedDuration = value.duration;
    if (
      typeof typedDuration === "object" &&
      typedDuration !== null &&
      (typedDuration as Record<string, unknown>).remaining === 0 &&
      state === "active"
    )
      state = "expired";
    duration = typedDurationLifecycle(value);
  }
  return {
    state,
    ...(duration === undefined ? {} : { duration }),
    ...(cooldown === undefined ? {} : { cooldown }),
  };
};
/* eslint-enable sonarjs/cognitive-complexity */

/** Reads normalized lifecycle state from either new or legacy effect shapes. */
export const lifecycleRecordForEffect = (effect: unknown): EffectLifecycleRecord | undefined => {
  if (typeof effect !== "object" || effect === null) return undefined;
  const lifecycle = (effect as Record<string, unknown>).lifecycle;
  if (typeof lifecycle === "object" && lifecycle !== null)
    return isValidEffectLifecycle(lifecycle) ? lifecycle : undefined;
  return normalizeLegacyEffectLifecycle(effect);
};

/** Returns false for an unrecognized legacy string lifecycle encoding. */
export const hasKnownLifecycleEncoding = (effect: unknown): boolean => {
  if (typeof effect !== "object" || effect === null) return true;
  const lifecycle = (effect as Record<string, unknown>).lifecycle;
  return (
    lifecycle === undefined ||
    (typeof lifecycle === "string" &&
      (lifecycle === "active" || lifecycle === "deactivated" || lifecycle === "cooldown")) ||
    (typeof lifecycle === "object" && lifecycle !== null)
  );
};

/** Returns whether a persisted effect is durably deactivated in either shape. */
export const isEffectDeactivated = (effect: unknown): boolean =>
  lifecycleRecordForEffect(effect)?.state === "deactivated";

/** Returns whether an effect may participate in runtime resolution. Legacy
 * effects without a lifecycle record remain active for backward compatibility. */
export const isEffectActive = (effect: unknown): boolean => {
  if (!hasKnownLifecycleEncoding(effect)) return false;
  if (
    typeof effect === "object" &&
    effect !== null &&
    typeof (effect as Record<string, unknown>).lifecycle === "object" &&
    !isValidEffectLifecycle((effect as Record<string, unknown>).lifecycle)
  )
    return false;
  const state = lifecycleRecordForEffect(effect)?.state;
  return state === undefined || state === "active";
};

/**
 * Normalizes one persisted effect at a public snapshot boundary. Existing
 * normalized effects are returned unchanged; legacy specialized counters are
 * retained as readable fields while receiving the canonical lifecycle record.
 */
export const normalizeEffectLifecycle = <T extends object>(
  effect: T,
): T & {
  readonly lifecycle?: EffectLifecycleRecord;
} => {
  const value = effect as Record<string, unknown>;
  if (typeof value.lifecycle === "object" && value.lifecycle !== null)
    return effect as T & {
      readonly lifecycle: EffectLifecycleRecord;
    };
  const lifecycle = normalizeLegacyEffectLifecycle(effect);
  return lifecycle === undefined
    ? effect
    : ({ ...effect, lifecycle } as T & {
        readonly lifecycle: EffectLifecycleRecord;
      });
};

/** Normalizes a persisted effect collection without changing its ordering. */
export const normalizeEffectsLifecycle = <T extends object>(effects: readonly T[]) =>
  effects.map((effect) => normalizeEffectLifecycle(effect));

/** Reactivates a durably retained effect without consuming the activation boundary. */
export const reactivateEffectLifecycle = (
  lifecycle: EffectLifecycleRecord,
): EffectLifecycleTransition => {
  if (lifecycle.state !== "deactivated" && lifecycle.state !== "cooldown")
    return { lifecycle, events: [] };
  return {
    lifecycle: { ...lifecycle, state: "active" },
    events: [],
  };
};

/** Creates lifecycle state for a newly activated effect at a boundary. */
export const activateEffectLifecycle = (
  lifecycle: EffectLifecycleRecord,
  activation: Pick<
    EffectLifecycleRecord,
    "activationBoundary" | "activationTurn" | "activationEventSequence"
  >,
): EffectLifecycleRecord => ({
  ...lifecycle,
  ...activation,
  state: "active",
});

/** Transitions an active effect into durable deactivation or cooldown. */
export const deactivateEffectLifecycle = (
  effectId: string,
  lifecycle: EffectLifecycleRecord,
  mode: "deactivated" | "cooldown",
): EffectLifecycleTransition => {
  if (lifecycle.state !== "active") return { lifecycle, events: [] };
  return {
    lifecycle: { ...lifecycle, state: mode },
    events: [
      {
        type: mode === "cooldown" ? "effect-cooldown-started" : "effect-deactivated",
        effectId,
      },
    ],
  };
};

const hasValidCooldownState = (lifecycle: Partial<EffectLifecycleRecord>) =>
  lifecycle.state !== "cooldown" ||
  (lifecycle.cooldown !== undefined && lifecycle.cooldown.remaining > 0);

const isValidBoundaryCounter = (
  value: unknown,
): value is {
  readonly boundary: EffectLifecycleBoundary;
  readonly remaining: number;
} => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { readonly boundary?: unknown; readonly remaining?: unknown };
  return (
    typeof candidate.remaining === "number" &&
    Number.isInteger(candidate.remaining) &&
    candidate.remaining > 0 &&
    typeof candidate.boundary === "string" &&
    lifecycleBoundaries.includes(candidate.boundary as EffectLifecycleBoundary)
  );
};

// eslint-disable-next-line sonarjs/cognitive-complexity -- lifecycle schema validation intentionally checks every persisted dimension.
export const isValidEffectLifecycle = (lifecycle: unknown): lifecycle is EffectLifecycleRecord => {
  if (typeof lifecycle !== "object" || lifecycle === null) return false;
  const value = lifecycle as Partial<EffectLifecycleRecord>;
  if (
    (value.activationTurn !== undefined &&
      (!Number.isInteger(value.activationTurn) || value.activationTurn < 0)) ||
    (value.activationEventSequence !== undefined &&
      (!Number.isInteger(value.activationEventSequence) || value.activationEventSequence < 0))
  )
    return false;
  if (
    (value.activationBoundary !== undefined &&
      !lifecycleBoundaries.includes(value.activationBoundary)) ||
    (value.duration !== undefined && !isValidBoundaryCounter(value.duration)) ||
    (value.cooldown !== undefined && !isValidBoundaryCounter(value.cooldown))
  )
    return false;
  if (!(["active", "deactivated", "cooldown", "expired"] as const).includes(value.state as never))
    return false;
  if (
    value.remainingUses !== undefined &&
    (!Number.isInteger(value.remainingUses) || value.remainingUses < 0)
  )
    return false;
  if (!hasValidCooldownState(value)) return false;
  return true;
};

/**
 * Advances one effect after its matching boundary. Newly-created effects must
 * pass `matchingBoundary: false` so their activation boundary is not consumed.
 */
/* eslint-disable sonarjs/cognitive-complexity -- boundary context combines activation, fact, use, duration, and cooldown ordering. */
export const transitionEffectLifecycle = (
  effectId: string,
  lifecycle: EffectLifecycleRecord,
  boundaryOrContext: EffectLifecycleBoundary | EffectLifecycleBoundaryContext,
  matchingBoundary = true,
): EffectLifecycleTransition => {
  const boundary =
    typeof boundaryOrContext === "string" ? boundaryOrContext : boundaryOrContext.boundary;
  const context = typeof boundaryOrContext === "string" ? undefined : boundaryOrContext;
  const activationBoundary =
    context !== undefined &&
    lifecycle.activationBoundary === boundary &&
    lifecycle.activationEventSequence !== undefined &&
    context.eventSequence === lifecycle.activationEventSequence &&
    (lifecycle.activationTurn === undefined || context.turnNumber === lifecycle.activationTurn);
  const applies =
    (context === undefined ? matchingBoundary : (context.matchingBoundary ?? true)) &&
    (context?.boundarySatisfied ?? true) &&
    !activationBoundary;
  if (!applies || lifecycle.state === "expired" || lifecycle.state === "deactivated")
    return { lifecycle, events: [] };

  const events: EffectLifecycleEvent[] = [];
  let next = lifecycle;
  if (lifecycle.remainingUses !== undefined && lifecycle.remainingUses > 0) {
    const remainingUses = consumeRemainingUse(lifecycle.remainingUses);
    next = { ...next, remainingUses };
    events.push({ type: "effect-use-consumed", effectId });
    if (remainingUses === 0) next = { ...next, state: "expired" };
  }
  if (next.state === "expired") {
    events.push({ type: "effect-expired", effectId });
    return { lifecycle: next, events };
  }
  if (next.duration?.boundary === boundary) {
    const remaining = next.duration.remaining - 1;
    next = { ...next, duration: { ...next.duration, remaining } };
    if (remaining <= 0) {
      next = { ...next, state: "expired" };
      events.push({ type: "effect-expired", effectId });
    }
  }
  if (next.cooldown?.boundary === boundary && next.cooldown.remaining > 0) {
    const remaining = next.cooldown.remaining - 1;
    next = { ...next, cooldown: { ...next.cooldown, remaining } };
    if (remaining === 0) {
      next = { ...next, state: "active" };
    }
  }
  return { lifecycle: next, events };
};
/* eslint-enable sonarjs/cognitive-complexity */

/** Applies a boundary to effects in persisted order, preserving event order. */
export const transitionEffectsLifecycle = <
  T extends { readonly id: string; readonly lifecycle: EffectLifecycleRecord },
>(
  effects: readonly T[],
  boundary: EffectLifecycleBoundary | EffectLifecycleBoundaryContext,
  matchingBoundary = true,
): { readonly effects: readonly T[]; readonly events: readonly EffectLifecycleEvent[] } => {
  const events: EffectLifecycleEvent[] = [];
  const nextEffects = effects.flatMap((effect) => {
    const transition = transitionEffectLifecycle(
      effect.id,
      effect.lifecycle,
      boundary,
      matchingBoundary,
    );
    events.push(...transition.events);
    return transition.lifecycle.state === "expired"
      ? []
      : [{ ...effect, lifecycle: transition.lifecycle }];
  });
  return { effects: nextEffects, events };
};
