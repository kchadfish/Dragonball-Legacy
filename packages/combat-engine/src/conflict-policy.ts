import type { EffectConflictPolicy } from "@dragonball-resurgence/game-data";

import type { ActiveCombatEffect, ConflictPolicy } from "./contracts.js";

type RuntimeEffect = ActiveCombatEffect & {
  readonly conflictPolicy?: ConflictPolicy;
  readonly lifecycle?: string;
  readonly selector?: unknown;
  readonly scope?: unknown;
  readonly stacking?: "allow" | "prevent";
  readonly sourceEffectIndex?: number;
};

export type ConflictResolutionAction =
  "append" | "discard" | "replace" | "refresh" | "retain-existing" | "unsupported";

export interface ConflictResolutionDecision {
  readonly action: ConflictResolutionAction;
  readonly incomingEffectId: string;
  readonly matchingEffectIds: readonly string[];
  readonly conflictKey?: string;
}

export interface ConflictResolutionResult {
  readonly effects: readonly ActiveCombatEffect[];
  readonly decisions: readonly ConflictResolutionDecision[];
}

export const normalizeConflictPolicy = (
  policy: EffectConflictPolicy | undefined,
): ConflictPolicy | undefined => {
  if (policy === undefined) return undefined;
  return Object.fromEntries(
    Object.entries(policy).filter(([key]) => key !== "sourceText"),
  ) as ConflictPolicy;
};

/** Returns the normalized policy family, including legacy snapshot shorthand. */
export const conflictPolicyType = (effect: {
  readonly conflictPolicy?: { readonly type?: string };
  readonly stacking?: "allow" | "prevent";
}): string | undefined => {
  if (effect.conflictPolicy?.type !== undefined) return effect.conflictPolicy.type;
  if (effect.stacking === "prevent") return "prevent-duplicate";
  if (effect.stacking === "allow") return "allow";
  return undefined;
};

/** Compatibility projection for legacy in-memory application shapes. */
export const legacyStackingFor = (effect: {
  readonly conflictPolicy?: { readonly type?: string };
  readonly stacking?: "allow" | "prevent";
}): "allow" | "prevent" | undefined => {
  const type = conflictPolicyType(effect);
  if (type === "prevent-duplicate") return "prevent";
  if (type === "allow") return "allow";
  return undefined;
};

const ordinaryModifierTypes = new Set([
  "modify-damage",
  "modify-next-action",
  "modify-roll",
  "modify-roll-modifier",
  "modify-stat",
]);

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
};

const stableKey = (value: unknown) => JSON.stringify(stableValue(value));

const runtimeEffect = (effect: ActiveCombatEffect) => effect as RuntimeEffect;

/**
 * Returns the normalized policy for an active effect. Legacy `stacking` is
 * deliberately translated here so persisted pre-CE-230 states remain valid.
 * Effects that are not ordinary modifiers do not acquire an implicit policy.
 */
export const conflictPolicyFor = (effect: ActiveCombatEffect): ConflictPolicy | undefined => {
  const runtime = runtimeEffect(effect);
  if (runtime.conflictPolicy !== undefined) return runtime.conflictPolicy;
  if (runtime.stacking === "prevent") return { type: "prevent-duplicate" };
  if (runtime.stacking === "allow") return { type: "allow" };
  return ordinaryModifierTypes.has(effect.type) ? { type: "allow" } : undefined;
};

const conflictIdentity = (effect: ActiveCombatEffect) => {
  const runtime = runtimeEffect(effect);
  return {
    type: effect.type,
    sourceCombatantId: effect.sourceCombatantId,
    targetCombatantId: effect.targetCombatantId,
    sourceDefinitionId: effect.sourceDefinitionId,
    ...(runtime.sourceEffectIndex === undefined
      ? {}
      : { sourceEffectIndex: runtime.sourceEffectIndex }),
    ...(runtime.selector === undefined ? {} : { selector: runtime.selector }),
    ...(runtime.scope === undefined ? {} : { scope: runtime.scope }),
    ...(runtime.lifecycle === undefined ? {} : { lifecycle: runtime.lifecycle }),
  };
};

/** The canonical serialized identity used for diagnostics and persistence. */
export const conflictKeyFor = (effect: ActiveCombatEffect): string => {
  const policy = conflictPolicyFor(effect);
  return stableKey({
    identity: conflictIdentity(effect),
    ...(policy?.type === "unique-group" || policy?.type === "mutually-exclusive-group"
      ? { group: policy.group }
      : {}),
  });
};

export const conflictMatchKeyFor = (effect: ActiveCombatEffect, policy: ConflictPolicy) => {
  if (policy.type === "unique-group" || policy.type === "mutually-exclusive-group") {
    const identity = conflictIdentity(effect);
    return stableKey({
      sourceCombatantId: identity.sourceCombatantId,
      targetCombatantId: identity.targetCombatantId,
      selector: identity.selector,
      scope: identity.scope,
      lifecycle: identity.lifecycle,
      group: policy.group,
    });
  }
  return stableKey(conflictIdentity(effect));
};

const matchingEffects = (
  effects: readonly ActiveCombatEffect[],
  incoming: ActiveCombatEffect,
  policy: ConflictPolicy,
) =>
  effects.filter((existing) => {
    const existingPolicy = conflictPolicyFor(existing);
    if (existingPolicy === undefined) return false;
    if (
      (policy.type === "unique-group" || policy.type === "mutually-exclusive-group") &&
      (existingPolicy.type !== policy.type || existingPolicy.group !== policy.group)
    )
      return false;
    return conflictMatchKeyFor(existing, policy) === conflictMatchKeyFor(incoming, policy);
  });

const conflictValue = (effect: ActiveCombatEffect): number | undefined => {
  if (effect.type === "modify-damage" || effect.type === "modify-stat") return effect.amount;
  if (effect.type === "modify-roll" || effect.type === "modify-ki-cost") return effect.amount;
  if (effect.type !== "modify-next-action") return undefined;
  const modifier = effect.modifier;
  if (
    modifier.type === "damage" ||
    modifier.type === "roll" ||
    modifier.type === "stat" ||
    modifier.type === "resource" ||
    modifier.type === "resource-cost" ||
    modifier.type === "cost"
  )
    return modifier.amount;
  return undefined;
};

const withConflictKey = (effect: ActiveCombatEffect): ActiveCombatEffect => {
  const policy = conflictPolicyFor(effect);
  return policy === undefined
    ? effect
    : { ...effect, conflictKey: conflictKeyFor(effect), conflictPolicy: policy };
};

const replaceAtMatching = (
  effects: readonly ActiveCombatEffect[],
  matching: readonly ActiveCombatEffect[],
  replacement: ActiveCombatEffect,
) => {
  const matchingIds = new Set(matching.map((effect) => effect.id));
  const firstIndex = effects.findIndex((effect) => matchingIds.has(effect.id));
  return effects.flatMap((effect, index) => {
    if (index === firstIndex) return [replacement];
    return matchingIds.has(effect.id) ? [] : [effect];
  });
};

const refreshEffect = (
  existing: ActiveCombatEffect,
  incoming: ActiveCombatEffect,
  policy: Extract<ConflictPolicy, { readonly type: "refresh" }>,
) => {
  const existingRuntime = runtimeEffect(existing);
  const incomingRuntime = runtimeEffect(incoming);
  const durationSource = policy.duration === "incoming" ? incomingRuntime : existingRuntime;
  const usesSource = policy.uses === "incoming" ? incomingRuntime : existingRuntime;
  const durationFields = "duration" in durationSource ? { duration: durationSource.duration } : {};
  const usageFields = Object.fromEntries(
    [
      "useLimit",
      "remaining",
      "remainingActions",
      "remainingAttacks",
      "remainingTriggers",
      "remainingBoundaries",
    ]
      .filter((key) => key in usesSource)
      .map((key) => [key, usesSource[key as keyof RuntimeEffect]]),
  );
  const refreshed = {
    ...(policy.provenance === "incoming" ? incoming : existing),
    id: existing.id,
    ...durationFields,
    ...usageFields,
  } as ActiveCombatEffect;
  return withConflictKey(refreshed);
};

const unsupportedPolicy = (policy: ConflictPolicy, effect: ActiveCombatEffect) =>
  policy.type === "retain" && (policy.value !== "amount" || conflictValue(effect) === undefined);

/**
 * Applies one deterministic conflict policy to a sequence of new effects.
 * The resolver is intentionally independent of phase scheduling and resource
 * mutation, so active and scheduled effects use exactly the same semantics.
 */
/* eslint-disable complexity, max-statements, sonarjs/cognitive-complexity -- The resolver is the single deterministic policy state machine for all durable effects. */
export const resolveActiveEffectConflicts = (
  existing: readonly ActiveCombatEffect[],
  additions: readonly ActiveCombatEffect[],
): ConflictResolutionResult => {
  let effects = [...existing];
  const decisions: ConflictResolutionDecision[] = [];
  for (const rawIncoming of additions) {
    const incoming = withConflictKey(rawIncoming);
    const policy = conflictPolicyFor(incoming);
    if (policy === undefined) {
      effects.push(incoming);
      decisions.push({ action: "append", incomingEffectId: incoming.id, matchingEffectIds: [] });
      continue;
    }
    const matching = matchingEffects(effects, incoming, policy);
    const baseDecision = {
      incomingEffectId: incoming.id,
      matchingEffectIds: matching.map((effect) => effect.id),
      conflictKey: incoming.conflictKey,
    };
    if (unsupportedPolicy(policy, incoming)) {
      decisions.push({ ...baseDecision, action: "unsupported" });
      continue;
    }
    if (matching.length === 0 || policy.type === "allow") {
      effects.push(incoming);
      decisions.push({ ...baseDecision, action: "append" });
      continue;
    }
    if (
      policy.type === "prevent-duplicate" ||
      policy.type === "unique-group" ||
      policy.type === "mutually-exclusive-group"
    ) {
      decisions.push({ ...baseDecision, action: "discard" });
      continue;
    }
    if (policy.type === "replace") {
      const replacement =
        policy.provenance === "existing" ? { ...incoming, id: matching[0]!.id } : incoming;
      effects = replaceAtMatching(effects, matching, withConflictKey(replacement));
      decisions.push({ ...baseDecision, action: "replace" });
      continue;
    }
    if (policy.type === "refresh") {
      effects = replaceAtMatching(effects, matching, refreshEffect(matching[0]!, incoming, policy));
      decisions.push({ ...baseDecision, action: "refresh" });
      continue;
    }
    const incomingValue = conflictValue(incoming)!;
    const existingValue = conflictValue(matching[0]!);
    if (existingValue === undefined) {
      decisions.push({ ...baseDecision, action: "unsupported" });
      continue;
    }
    const incomingWins =
      policy.selection === "highest"
        ? incomingValue > existingValue
        : incomingValue < existingValue;
    if (incomingWins || (incomingValue === existingValue && policy.tie === "incoming")) {
      effects = replaceAtMatching(effects, matching, incoming);
      decisions.push({ ...baseDecision, action: "replace" });
    } else {
      decisions.push({ ...baseDecision, action: "retain-existing" });
    }
  }
  return { effects, decisions };
};
/* eslint-enable complexity, max-statements, sonarjs/cognitive-complexity */
