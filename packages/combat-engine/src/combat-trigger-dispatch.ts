import type { EffectDefinition, MoveDefinition } from "@dragonball-resurgence/game-data";

import {
  moveEffectsForTrigger,
  stoppedMoveEffects,
  successfulMoveEffects,
  type MoveEffectRuntimeContext,
} from "./move-effects-runtime.js";
import { combatTriggers, type CombatTrigger } from "./condition-executors.js";

export type CombatEffectSourceKind =
  "action-move" | "carried-skill" | "carried-mastery" | "active-constant" | "floating-effect";

export interface CombatTriggerSource {
  readonly kind: CombatEffectSourceKind;
  readonly move: MoveDefinition;
  readonly owner: "self" | "opponent";
}

export interface CombatTriggerDescriptor {
  readonly eligibleSources: readonly CombatEffectSourceKind[];
  readonly perspective: "source-owner" | "acting-combatant";
  readonly requiredLocalPayload: readonly string[];
  readonly supportsPendingChoice: boolean;
  readonly recursion: "allow" | "non-recursive-resource-listener";
}

const allMoveSources = [
  "action-move",
  "carried-skill",
  "carried-mastery",
  "active-constant",
  "floating-effect",
] as const satisfies readonly CombatEffectSourceKind[];

const descriptor = (
  requiredLocalPayload: readonly string[] = [],
  supportsPendingChoice = false,
  recursion: CombatTriggerDescriptor["recursion"] = "allow",
): CombatTriggerDescriptor => ({
  eligibleSources: allMoveSources,
  perspective: "source-owner",
  requiredLocalPayload,
  supportsPendingChoice,
  recursion,
});

export const combatTriggerDescriptors = {
  "action-phase": descriptor([], true),
  "after-defense-roll": descriptor(["rolls", "defenseResponse"], true),
  "before-attack-roll": descriptor([], true),
  "before-defense-roll": descriptor(["rolls"], true),
  passive: descriptor(),
  "on-stopped": descriptor(["rolls"], true),
  "on-success": descriptor(["rolls"], true),
  "on-combat-result": descriptor(["combatOutcome"]),
  "on-damage": descriptor(["incomingDamage"]),
  "on-deactivated": descriptor(["triggeringMove"], true),
  "on-move-use": descriptor(["triggeringMove"], true),
  "on-cost-modified": descriptor(["triggeringMove"]),
  "on-power-up": descriptor(),
  "on-resource-gain": descriptor(["resourceChange"], false, "non-recursive-resource-listener"),
  "on-resource-drain": descriptor(["resourceChange"], false, "non-recursive-resource-listener"),
  "on-resource-threshold": descriptor(["previousResourceState"]),
  "on-roll-modified": descriptor(["rollModification"]),
  "on-roll-result": descriptor(["rolls"], true),
  "start-combat": descriptor([], true),
  "upkeep-phase": descriptor([], true),
  "turn-end": descriptor([], true),
} satisfies Record<CombatTrigger, CombatTriggerDescriptor>;

export type CombatTriggerContext = {
  readonly [T in CombatTrigger]: {
    readonly trigger: T;
    readonly source: MoveDefinition;
    readonly runtime: MoveEffectRuntimeContext;
  };
}[CombatTrigger];

/** Stable source ordering with duplicate owner/definition occurrences removed. */
export const discoverCombatTriggerSources = (
  trigger: CombatTrigger,
  sources: readonly CombatTriggerSource[],
): readonly CombatTriggerSource[] => {
  const descriptorForTrigger = combatTriggerDescriptors[trigger];
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (!descriptorForTrigger.eligibleSources.includes(source.kind)) return false;
    const identity = `${source.owner}:${source.move.id}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
};

/** Unified execution boundary used by production combat transitions. */
export const dispatchCombatTrigger = (
  source: MoveDefinition,
  trigger: CombatTrigger,
  runtime: MoveEffectRuntimeContext,
) => {
  const context: CombatTriggerContext = { trigger, source, runtime } as CombatTriggerContext;
  return moveEffectsForTrigger(context.source, context.trigger, {
    ...context.runtime,
    requireConditionContext: true,
  });
};

/**
 * Dispatches one trigger across an already ordered source list. Discovery,
 * de-duplication, condition-context validation, and execution ordering all
 * live behind this boundary; callers only provide the resolved runtime context.
 */
export const dispatchCombatTriggerSources = (
  trigger: CombatTrigger,
  sources: readonly CombatTriggerSource[],
  runtimeForSource: (source: CombatTriggerSource) => MoveEffectRuntimeContext,
) =>
  dispatchCombatTriggerSourceResults(trigger, sources, runtimeForSource).flatMap(
    ({ effects }) => effects,
  );

/** Same dispatch boundary, retaining source identity for lifecycle accounting. */
export const dispatchCombatTriggerSourceResults = (
  trigger: CombatTrigger,
  sources: readonly CombatTriggerSource[],
  runtimeForSource: (source: CombatTriggerSource) => MoveEffectRuntimeContext,
) =>
  discoverCombatTriggerSources(trigger, sources).map((source) => ({
    source,
    effects: dispatchCombatTrigger(source.move, trigger, runtimeForSource(source)),
  }));

export const dispatchSuccessfulCombatTrigger = (
  source: MoveDefinition,
  runtime: MoveEffectRuntimeContext,
) => successfulMoveEffects(source, { ...runtime, requireConditionContext: true });

export const dispatchStoppedCombatTrigger = (
  source: MoveDefinition,
  runtime: MoveEffectRuntimeContext,
) => stoppedMoveEffects(source, { ...runtime, requireConditionContext: true });

export const isCombatTrigger = (trigger: EffectDefinition["trigger"]): trigger is CombatTrigger =>
  combatTriggers.includes(trigger as CombatTrigger);
