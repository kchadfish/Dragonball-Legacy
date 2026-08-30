import {
  GENERIC_CLASS_DEFINITIONS,
  MOVE_DEFINITIONS,
  RACE_DEFINITIONS,
  TRANSFORMATION_DEFINITIONS,
  type EffectDefinition,
  type MoveDefinition,
} from "@dragonball-resurgence/game-data";

import {
  moveEffectsForTrigger,
  stoppedMoveEffects,
  successfulMoveEffects,
  type MoveEffectRuntimeContext,
} from "./move-effects-runtime.js";
import { combatTriggers, type CombatTrigger } from "./condition-executors.js";
import type { CombatantState, CombatSourceReference } from "./contracts.js";

export type CombatEffectSourceKind =
  | "action-move"
  | "carried-skill"
  | "carried-mastery"
  | "active-constant"
  | "floating-effect"
  | "race-trait"
  | "race-class"
  | "generic-class"
  | "transformation-ability";

export type { CombatSourceReference } from "./contracts.js";

export interface CombatTriggerSource {
  readonly kind: CombatEffectSourceKind;
  readonly move: MoveDefinition;
  readonly owner: "self" | "opponent";
  readonly source?: CombatSourceReference;
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
  "race-trait",
  "race-class",
  "generic-class",
  "transformation-ability",
] as const satisfies readonly CombatEffectSourceKind[];

const syntheticMoveFor = (
  source: CombatSourceReference,
  name: string,
  effects: readonly EffectDefinition[],
): MoveDefinition => ({
  id: source.definitionId,
  name,
  category: "mastery",
  tags: [],
  description: name,
  effectText: effects.map((effect) => effect.sourceText).join(" "),
  effectClauses: [],
  mechanics: {},
  effects,
  source: { path: "reference/rules.md", text: name },
});

const sourceForDefinition = (
  kind: Extract<CombatSourceReference["kind"], "race-trait" | "race-class" | "generic-class">,
  definitionId: string,
  name: string,
  effects: readonly EffectDefinition[] | undefined,
  owner: "self" | "opponent",
): CombatTriggerSource | undefined =>
  effects === undefined || effects.length === 0
    ? undefined
    : {
        kind,
        move: syntheticMoveFor({ kind, definitionId }, name, effects),
        owner,
        source: { kind, definitionId },
      };

/**
 * Discovers innate sources after carried moves, preserving the selected input
 * order for traits and the selected class before the active transformation.
 */
/* eslint-disable sonarjs/cognitive-complexity -- deterministic source ordering is intentionally centralized here. */
export const combatTriggerSourcesFor = (
  combatant: CombatantState,
  owner: "self" | "opponent",
): readonly CombatTriggerSource[] => {
  const sources: CombatTriggerSource[] = combatant.moveIds.flatMap((moveId) => {
    const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === moveId);
    return move === undefined
      ? []
      : [
          {
            kind: move.category === "mastery" ? "carried-mastery" : "carried-skill",
            move,
            owner,
            source: { kind: "move" as const, definitionId: move.id },
          },
        ];
  });
  for (const traitId of combatant.raceTraitIds ?? []) {
    const trait = RACE_DEFINITIONS.flatMap((race) => race.racialTraits).find(
      (candidate) => candidate.id === traitId,
    );
    const source =
      trait === undefined
        ? undefined
        : sourceForDefinition("race-trait", trait.id, trait.name, trait.effects, owner);
    if (source !== undefined) sources.push(source);
  }
  if (combatant.classId !== undefined) {
    const raceClass = RACE_DEFINITIONS.flatMap((race) => race.classes).find(
      (candidate) => candidate.id === combatant.classId,
    );
    const genericClass = GENERIC_CLASS_DEFINITIONS.find(
      (candidate) => candidate.id === combatant.classId,
    );
    const selected = raceClass ?? genericClass;
    const kind = raceClass === undefined ? "generic-class" : "race-class";
    const source =
      selected === undefined
        ? undefined
        : sourceForDefinition(kind, selected.id, selected.name, selected.effects, owner);
    if (source !== undefined) sources.push(source);
  }
  if (combatant.transformation !== undefined) {
    const transformation = TRANSFORMATION_DEFINITIONS.find(
      (candidate) => candidate.id === combatant.transformation?.transformationId,
    );
    const mastery = combatant.transformationProfiles?.find(
      (profile) => profile.transformationId === combatant.transformation?.transformationId,
    )?.mastery;
    const ability = mastery === undefined ? undefined : transformation?.abilities[mastery];
    if (transformation !== undefined && mastery !== undefined && ability?.effects !== undefined)
      sources.push({
        kind: "transformation-ability",
        move: syntheticMoveFor(
          {
            kind: "transformation-ability",
            definitionId: `${transformation.id}:${mastery}`,
            mastery,
          },
          ability.name ?? `${transformation.name} ${mastery}`,
          ability.effects,
        ),
        owner,
        source: {
          kind: "transformation-ability",
          definitionId: `${transformation.id}:${mastery}`,
          mastery,
        },
      });
  }
  return sources;
};
/* eslint-enable sonarjs/cognitive-complexity */

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
    const reference = source.source ?? { kind: "move", definitionId: source.move.id };
    const identity = `${source.owner}:${reference.kind}:${reference.definitionId}`;
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
    effects: dispatchCombatTrigger(source.move, trigger, {
      ...runtimeForSource(source),
      sourceReference: source.source,
    }),
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
