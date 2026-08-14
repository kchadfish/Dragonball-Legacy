import { ITEM_DEFINITIONS } from "../packages/game-data/src/item-definitions.js";
import { MOVE_DEFINITIONS } from "../packages/game-data/src/move-definitions.js";
import { TRANSFORMATION_DEFINITIONS } from "../packages/game-data/src/transformation-definitions.js";
import type { EffectDefinition } from "../packages/game-data/src/shared/effects.js";

import { compileEffectPlan } from "../packages/combat-engine/src/effect-executors.js";

export type CapabilityStatus =
  "supported-generic" | "supported-named" | "unsupported-in-scope" | "audited-out-of-scope";

interface SourceEffect {
  readonly type?: unknown;
  readonly trigger?: unknown;
  readonly target?: unknown;
  readonly scope?: { readonly type?: unknown };
  readonly duration?: { readonly type?: unknown };
  readonly operation?: unknown;
  readonly percent?: { readonly type?: unknown };
  readonly selector?: unknown;
  readonly activationGroup?: unknown;
  readonly optional?: unknown;
  readonly relativeTo?: unknown;
  readonly relativeOperation?: unknown;
  readonly cap?: { readonly type?: unknown; readonly scope?: unknown };
  readonly conditions?: readonly { readonly type?: unknown }[];
}

interface Occurrence {
  readonly sourceDefinitionId: string;
  readonly origin: "move" | "item" | "transformation";
  readonly effectIndex: number;
  readonly effect: SourceEffect;
}

export interface CombatCapabilityMatrixRow {
  readonly sourceDefinitionId: string;
  readonly origin: Occurrence["origin"];
  readonly effectIndex: number;
  readonly effectType: string;
  readonly variant: string;
  readonly trigger: string | null;
  readonly target: string | null;
  readonly scope: string | null;
  readonly duration: string | null;
  readonly status: CapabilityStatus;
  readonly capabilityId: string | null;
  readonly executor: string | null;
  readonly focusedCoverage: string | null;
  readonly reason: string;
  readonly prerequisite: string | null;
  readonly approvedExclusion: string | null;
}

export interface CombatCapabilityMatrix {
  readonly generatedAt: "2026-08-13";
  readonly activeTransformationFamilies: readonly string[];
  readonly structuredTransformationEffects: number;
  readonly occurrences: readonly CombatCapabilityMatrixRow[];
}

const activeTransformationRaceIds = new Set([
  "race-humans",
  "race-saiyans",
  "race-hybrid-saiyans",
  "race-namekians",
  "race-changeling",
  "race-bio-androids",
]);

const genericExecutors: Readonly<
  Record<string, { executor: string; test: string; capabilityId?: string }>
> = {
  "apply-status": { executor: "status-lifecycle", test: "move-effects-runtime.test.ts" },
  "create-floating-effect": {
    executor: "floating-effect-lifecycle",
    test: "progress-fight.test.ts, move-effects-runtime.test.ts",
  },
  deactivate: { executor: "constant-lifecycle", test: "deactivation-flow.test.ts" },
  "force-action": { executor: "forced-action", test: "progress-fight.test.ts" },
  "grant-extra-action": { executor: "extra-action-scheduler", test: "progress-fight.test.ts" },
  lock: { executor: "action-lock", test: "progress-fight.test.ts" },
  "modify-cost": { executor: "cost-modifier", test: "move-effects-runtime.test.ts" },
  "modify-critical-threshold": {
    executor: "critical-threshold",
    test: "move-attacks.test.ts, progress-fight.test.ts",
    capabilityId: "modify-critical-threshold.v1",
  },
  "modify-move-classification": {
    executor: "current-action-move-classification",
    test: "death-beam.test.ts, progress-fight.test.ts",
    capabilityId: "modify-move-classification.v1",
  },
  "modify-remaining-uses": {
    executor: "restricted-use-limit",
    test: "basic-attack.test.ts, progress-fight.test.ts",
    capabilityId: "modify-remaining-uses.v1",
  },
  "modify-resource": { executor: "resource-change", test: "move-effects-runtime.test.ts" },
  "modify-roll": { executor: "roll-modifier", test: "attack-rolls.test.ts" },
  "modify-stat": { executor: "stat-modifier", test: "progress-fight.test.ts" },
  reroll: {
    executor: "reroll-reaction",
    test: "basic-attack.test.ts, move-effects-runtime.test.ts",
  },
  "prevent-combat-result": {
    executor: "combat-result-prevention",
    test: "basic-attack.test.ts",
  },
  "prevent-move-modification": {
    executor: "move-modification-prevention",
    test: "move-effects-runtime.test.ts, progress-fight.test.ts",
    capabilityId: "prevent-move-modification.v2",
  },
  "prevent-move-use": { executor: "move-use-prevention", test: "move-effects-runtime.test.ts" },
  "prevent-resource-modification": {
    executor: "resource-modification-prevention",
    test: "progress-fight.test.ts, move-effects-runtime.test.ts",
  },
  "prevent-resolution": { executor: "resolution-prevention", test: "basic-attack.test.ts" },
  "prevent-roll-modification": {
    executor: "roll-modification-prevention",
    test: "basic-attack.test.ts",
  },
  "prevent-status": { executor: "status-prevention", test: "move-effects-runtime.test.ts" },
  "roll-and-store": {
    executor: "stored-roll-state",
    test: "progress-fight.test.ts, move-effects-runtime.test.ts",
    capabilityId: "roll-and-store.v1",
  },
  "set-combat-result": { executor: "combat-result-override", test: "progress-fight.test.ts" },
  "set-resolution-threshold": {
    executor: "resolution-threshold",
    test: "progress-fight.test.ts",
  },
  "set-roll-definition": { executor: "roll-definition", test: "attack-rolls.test.ts" },
  "set-roll-result": { executor: "roll-result-override", test: "attack-rolls.test.ts" },
  "schedule-effect": {
    executor: "scheduled-resource",
    test: "progress-fight.test.ts, move-effects-runtime.test.ts",
  },
  "skip-action": {
    executor: "action-restriction",
    test: "progress-fight.test.ts, move-effects-runtime.test.ts",
    capabilityId: "skip-action.v1",
  },
  suppress: {
    executor: "suppression-lifecycle",
    test: "progress-fight.test.ts, move-effects-runtime.test.ts",
  },
};

const itemExecutors: Readonly<Record<string, { executor: string; test: string }>> = {
  "item-modify-damage": { executor: "item-damage", test: "basic-attack.test.ts" },
  "item-modify-resource": { executor: "item-resource", test: "item-effects-runtime.test.ts" },
  "modify-resource": { executor: "item-resource", test: "item-effects-runtime.test.ts" },
  "item-modify-roll": { executor: "item-roll", test: "item-effects-runtime.test.ts" },
  "item-modify-stat-percent": {
    executor: "item-stat-passive",
    test: "item-effects-runtime.test.ts",
  },
};

const approvedItemExclusions: Readonly<Record<string, string>> = {
  "item-grant-travel-permission": "travel and permission rules are outside combat scope",
  "item-modify-experience-percent": "progression economy is outside combat scope",
  "item-modify-inventory-capacity": "inventory capacity is outside combat scope",
  "item-modify-marketplace-price": "marketplace economy is outside combat scope",
  "item-modify-ship-capacity": "spaceship mechanics are outside combat scope",
  "item-reduce-duration": "quest and travel duration is outside combat scope",
  "item-space-combat": "spaceship combat is outside the active scope",
  "item-state-rule": "narrative or administrator-mediated item rule",
};

const stringValue = (value: unknown): string | null => (typeof value === "string" ? value : null);

const variantFor = (effect: SourceEffect) =>
  [
    `trigger=${stringValue(effect.trigger) ?? "none"}`,
    `target=${stringValue(effect.target) ?? "none"}`,
    `scope=${stringValue(effect.scope?.type) ?? "none"}`,
    `duration=${stringValue(effect.duration?.type) ?? "none"}`,
    `operation=${stringValue(effect.operation) ?? "none"}`,
    `numeric=${stringValue(effect.percent?.type) ?? "none"}`,
    `cap=${effect.cap === undefined ? "none" : `${stringValue(effect.cap.type) ?? "unknown"}:${stringValue(effect.cap.scope) ?? "none"}`}`,
    `selector=${effect.selector === undefined ? "none" : "present"}`,
    `conditions=${(effect.conditions ?? []).map((condition) => stringValue(condition.type) ?? "unknown").join(",") || "none"}`,
    ...(effect.relativeTo === undefined
      ? []
      : [
          `relative=${stringValue(effect.relativeTo) ?? "unknown"}:${stringValue(effect.relativeOperation) ?? "unknown"}`,
        ]),
  ].join(";");

const supportedNumericTypes = new Set([
  "literal",
  "stat-percent",
  "move-activation-count",
  "consecutive-combat-results",
  "combat-result-count",
  "turns-after-turn",
  "resource-percent",
  "resource-from-threshold",
  "successful-hit-count",
  "prior-roll-result",
  "completed-combat-turn-count",
  "damage-percent",
  "active-move-count",
  "active-move-effect-text-count",
  "stat-offset",
]);

const supportedDamageConditions = new Set([
  "combat-result",
  "combat-context",
  "combat-state",
  "move-selector",
  "prior-action",
  "no-prior-action",
  "action-sequence",
  "paid-ki-cost",
  "perfect-roll",
  "resource-threshold",
  "resource-comparison",
  "roll-comparison",
  "roll-die-result",
  "roll-die-threshold",
  "roll-threshold",
  "stat-comparison",
  "status",
  "successful-hit-count",
  "resource-change",
  "move-effect-active",
  "move-effect-inactive",
  "active-move-count",
  "moveset-move-count",
  "move-use-count",
]);

const isSupportedDamageOccurrence = (occurrence: Occurrence) => {
  const effect = occurrence.effect;
  if (effect.type !== "modify-damage") return false;
  if (effect.percent?.type !== undefined && !supportedNumericTypes.has(effect.percent.type))
    return false;
  if (
    (effect.conditions ?? []).some(
      (condition) => !supportedDamageConditions.has(condition.type as string),
    )
  )
    return false;
  if (
    effect.operation !== undefined &&
    effect.operation !== "add" &&
    effect.operation !== "multiply" &&
    effect.operation !== "set"
  )
    return false;
  if (effect.scope?.type === "current-action" && effect.trigger === "passive") return true;
  if (effect.scope === undefined && effect.trigger === "passive") return true;
  if (
    (effect.scope?.type === "current-action" || effect.scope?.type === undefined) &&
    effect.trigger === "on-success" &&
    effect.target === "self" &&
    effect.activationGroup === undefined &&
    effect.optional !== true
  )
    return true;
  if (
    (effect.scope?.type === "next-action" || effect.scope?.type === "next-actions") &&
    (effect.trigger === "action-phase" ||
      effect.trigger === "on-success" ||
      effect.trigger === "on-stopped" ||
      effect.trigger === "before-attack-roll")
  )
    return true;
  if (
    effect.scope?.type === "next-action" &&
    (effect.trigger === "on-resource-gain" || effect.trigger === "on-resource-drain") &&
    (effect.target === "self" || effect.target === "opponent")
  )
    return true;
  if (
    effect.scope?.type === "following-action" &&
    effect.trigger === "on-success" &&
    effect.target === "opponent"
  )
    return true;
  if (
    effect.scope?.type === "next-turn" &&
    effect.trigger === "on-success" &&
    effect.target === "opponent"
  )
    return true;
  if (
    effect.scope?.type === "next-turn" &&
    effect.trigger === "on-power-up" &&
    effect.target === "self"
  )
    return true;
  if (
    effect.scope === undefined &&
    effect.trigger === "before-attack-roll" &&
    effect.target === "self"
  )
    return true;
  if (
    effect.scope === undefined &&
    effect.trigger === "on-success" &&
    effect.target === "opponent" &&
    (effect.duration?.type === "combat" || effect.duration?.type === "turns")
  )
    return true;
  if (effect.scope === undefined && effect.trigger === "on-damage" && effect.target === "opponent")
    return true;
  return effect.trigger === "before-attack-roll" && effect.scope?.type === "current-action";
};

const isSupportedExtraActionOccurrence = (occurrence: Occurrence) => {
  const effect = occurrence.effect;
  return (
    effect.type === "grant-extra-action" &&
    effect.target === "self" &&
    (effect.trigger === "on-success" || effect.trigger === "on-stopped") &&
    effect.phase === "action-phase" &&
    (effect.scope === undefined ||
      effect.scope.type === "current-action" ||
      effect.scope.type === "next-turn") &&
    effect.duration === undefined &&
    effect.activationGroup === undefined &&
    effect.optional !== true &&
    effect.activationCost === undefined &&
    effect.cooldown === undefined &&
    effect.selectionLimit === undefined &&
    effect.stacking === undefined
  );
};

const isSupportedRerollOccurrence = (occurrence: Occurrence) => {
  const effect = occurrence.effect;
  return (
    effect.type === "reroll" &&
    (effect.trigger === "after-defense-roll" || effect.trigger === "on-success") &&
    (effect.target === undefined || effect.target === "self") &&
    effect.scope === undefined &&
    (effect.duration === undefined || effect.duration.type === "combat") &&
    effect.activationGroup === undefined &&
    effect.optional !== true
  );
};

const classify = (occurrence: Occurrence) => {
  const effectType = stringValue(occurrence.effect.type) ?? "unknown";
  if (occurrence.origin === "item" && approvedItemExclusions[effectType] !== undefined) {
    return {
      status: "audited-out-of-scope" as const,
      capabilityId: null,
      executor: null,
      focusedCoverage: null,
      reason: approvedItemExclusions[effectType],
      prerequisite: null,
      approvedExclusion: approvedItemExclusions[effectType],
    };
  }
  if (occurrence.effect.optional === true || occurrence.effect.activationGroup !== undefined) {
    return {
      status: "unsupported-in-scope" as const,
      capabilityId: null,
      executor: null,
      focusedCoverage: null,
      reason: "This occurrence requires a serialized optional-effect choice.",
      prerequisite: "generic pending-choice compilation and resolution",
      approvedExclusion: null,
    };
  }
  const compilation =
    occurrence.origin === "item"
      ? undefined
      : compileEffectPlan({
          sourceDefinitionId: occurrence.sourceDefinitionId,
          effectIndex: occurrence.effectIndex,
          effect: occurrence.effect as EffectDefinition,
        });
  if (effectType === "modify-damage") {
    if (isSupportedDamageOccurrence(occurrence) && compilation?.ok === true) {
      return {
        status: "supported-generic" as const,
        capabilityId: "damage-modifier.v1",
        executor: "damage-modifier",
        focusedCoverage: "basic-attack.test.ts, progress-fight.test.ts",
        reason:
          "The typed damage modifier variant is resolved from durable state and covered at the public decision boundary.",
        prerequisite: null,
        approvedExclusion: null,
      };
    }
    return {
      status: "unsupported-in-scope" as const,
      capabilityId: null,
      executor: null,
      focusedCoverage: null,
      reason:
        compilation !== undefined && !compilation.ok
          ? (compilation.issues[0]?.message ??
            "The compiled damage executor rejected this occurrence.")
          : "This occurrence requires unresolved numeric, condition, trigger, target, or damage-pipeline context.",
      prerequisite: "typed compiled damage context and resolution-local state",
      approvedExclusion: null,
    };
  }
  if (effectType === "grant-extra-action" && !isSupportedExtraActionOccurrence(occurrence)) {
    return {
      status: "unsupported-in-scope" as const,
      capabilityId: null,
      executor: null,
      focusedCoverage: null,
      reason:
        "This extra-action variant requires an unsupported phase, deferred scope, optional choice, activation cost, or scheduling policy.",
      prerequisite: "typed executor accounting and compiled effect-plan validation",
      approvedExclusion: null,
    };
  }
  if (effectType === "reroll" && !isSupportedRerollOccurrence(occurrence)) {
    return {
      status: "unsupported-in-scope" as const,
      capabilityId: null,
      executor: null,
      focusedCoverage: null,
      reason:
        "This reroll variant requires unsupported scope, lifecycle, target, optionality, or activation semantics.",
      prerequisite: "typed reroll reaction lifecycle and serialized choice context",
      approvedExclusion: null,
    };
  }
  const executor =
    occurrence.origin === "item" ? itemExecutors[effectType] : genericExecutors[effectType];
  return executor === undefined || (compilation !== undefined && !compilation.ok)
    ? {
        status: "unsupported-in-scope" as const,
        capabilityId: null,
        executor: null,
        focusedCoverage: null,
        reason:
          compilation !== undefined && !compilation.ok
            ? (compilation.issues[0]?.message ??
              "The registered executor rejected this converted occurrence.")
            : "No exact generic or named executor variant is registered for this converted occurrence.",
        prerequisite: "typed executor accounting and compiled effect-plan validation",
        approvedExclusion: null,
      }
    : {
        status: "supported-generic" as const,
        capabilityId: executor.capabilityId ?? `${effectType}.v1`,
        executor: executor.executor,
        focusedCoverage:
          occurrence.effect.trigger === "on-power-up" ||
          occurrence.effect.trigger === "on-resource-gain" ||
          occurrence.effect.trigger === "on-resource-drain"
            ? "progress-fight.test.ts"
            : executor.test,
        reason:
          "A registered generic executor covers this converted effect family; variant limits remain visible in the occurrence record.",
        prerequisite: null,
        approvedExclusion: null,
      };
};

const collectOccurrences = (): readonly Occurrence[] => {
  const occurrences: Occurrence[] = [];
  const add = (
    origin: Occurrence["origin"],
    sourceDefinitionId: string,
    effects: readonly unknown[] | undefined,
  ) => {
    for (const [effectIndex, rawEffect] of (effects ?? []).entries()) {
      const effect = rawEffect as SourceEffect;
      occurrences.push({ origin, sourceDefinitionId, effectIndex, effect });
    }
  };
  for (const move of MOVE_DEFINITIONS) add("move", move.id, move.effects);
  for (const item of ITEM_DEFINITIONS) add("item", item.id, item.effects);
  for (const transformation of TRANSFORMATION_DEFINITIONS) {
    if (!activeTransformationRaceIds.has(transformation.raceId)) continue;
    for (const [abilityName, ability] of Object.entries(transformation.abilities))
      add("transformation", `${transformation.id}:${abilityName}`, ability.effects);
  }
  return occurrences;
};

export const createCombatCapabilityMatrix = (): CombatCapabilityMatrix => {
  const occurrences = collectOccurrences().map((occurrence) => {
    const classification = classify(occurrence);
    return {
      sourceDefinitionId: occurrence.sourceDefinitionId,
      origin: occurrence.origin,
      effectIndex: occurrence.effectIndex,
      effectType: stringValue(occurrence.effect.type) ?? "unknown",
      variant: variantFor(occurrence.effect),
      trigger: stringValue(occurrence.effect.trigger),
      target: stringValue(occurrence.effect.target),
      scope: stringValue(occurrence.effect.scope?.type),
      duration: stringValue(occurrence.effect.duration?.type),
      ...classification,
    } satisfies CombatCapabilityMatrixRow;
  });
  return {
    generatedAt: "2026-08-13",
    activeTransformationFamilies: [...activeTransformationRaceIds].map((raceId) =>
      raceId.slice(5, -1),
    ),
    structuredTransformationEffects: occurrences.filter(
      (occurrence) => occurrence.origin === "transformation",
    ).length,
    occurrences,
  };
};

const summary = (rows: readonly CombatCapabilityMatrixRow[]) => {
  const counts = new Map<string, { occurrences: number; definitions: Set<string> }>();
  for (const row of rows) {
    if (row.status !== "unsupported-in-scope") continue;
    const current = counts.get(row.prerequisite ?? "unclassified") ?? {
      occurrences: 0,
      definitions: new Set<string>(),
    };
    current.occurrences += 1;
    current.definitions.add(row.sourceDefinitionId);
    counts.set(row.prerequisite ?? "unclassified", current);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([prerequisite, value]) =>
        `- ${prerequisite}: ${value.occurrences} occurrences across ${value.definitions.size} definitions`,
    );
};

export const renderCombatCapabilityMatrix = (matrix = createCombatCapabilityMatrix()): string => {
  const lines = [
    "# Combat capability matrix",
    "",
    `Generated: ${matrix.generatedAt}`,
    "",
    `Transformation structured effects in active six-family scope: ${matrix.structuredTransformationEffects} (source-text-only abilities are not executable).`,
    "",
    "Statuses: `supported-generic`, `supported-named`, `unsupported-in-scope`, `audited-out-of-scope`.",
    "",
    "## Unsupported in-scope summary",
    "",
    ...summary(matrix.occurrences),
    "",
    "## Occurrences",
    "",
    "| Source definition | Origin | Effect index | Effect type | Variant | Status | Capability | Executor | Coverage | Reason | Prerequisite | Approved exclusion |",
    "| --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const row of matrix.occurrences) {
    lines.push(
      `| ${row.sourceDefinitionId} | ${row.origin} | ${row.effectIndex} | ${row.effectType} | ${row.variant} | ${row.status} | ${row.capabilityId ?? "-"} | ${row.executor ?? "-"} | ${row.focusedCoverage ?? "-"} | ${row.reason} | ${row.prerequisite ?? "-"} | ${row.approvedExclusion ?? "-"} |`,
    );
  }
  return `${lines.join("\n")}\n`;
};

if (process.argv[1]?.endsWith("combat-capability-matrix.ts"))
  process.stdout.write(renderCombatCapabilityMatrix());
