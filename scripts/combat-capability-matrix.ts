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
  readonly scope?: { readonly type?: unknown; readonly offset?: unknown };
  readonly duration?: { readonly type?: unknown };
  readonly operation?: unknown;
  readonly amount?: unknown;
  readonly multiplier?: unknown;
  readonly increment?: unknown;
  readonly timing?: unknown;
  readonly effect?: unknown;
  readonly cancellation?: unknown;
  readonly repeat?: unknown;
  readonly repeatUntil?: {
    readonly type?: unknown;
    readonly selector?: unknown;
    readonly fallback?: unknown;
  };
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
  readonly generatedAt: "2026-08-23";
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
  activate: {
    executor: "constant-activation-selection",
    test: "progress-fight.test.ts, move-effects-runtime.test.ts",
    capabilityId: "activate.v1",
  },
  "apply-status": { executor: "status-lifecycle", test: "move-effects-runtime.test.ts" },
  "copy-move-effect": {
    executor: "copied-attack-action",
    test: "progress-fight.test.ts, effect-executors.test.ts",
    capabilityId: "copy-move-effect.v1",
  },
  "create-floating-effect": {
    executor: "floating-effect-lifecycle",
    test: "basic-attack.test.ts, progress-fight.test.ts, move-effects-runtime.test.ts",
  },
  deactivate: { executor: "constant-lifecycle", test: "deactivation-flow.test.ts" },
  "force-action": { executor: "forced-action", test: "progress-fight.test.ts" },
  "grant-extra-action": {
    executor: "extra-action-scheduler",
    test: "progress-fight.test.ts",
    capabilityId: "grant-extra-action.v2",
  },
  "grant-combat-outcome": {
    executor: "combat-outcome-status",
    test: "progress-fight.test.ts, move-effects-runtime.test.ts",
    capabilityId: "grant-combat-outcome.v1",
  },
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
  "modify-resource": {
    executor: "resource-change",
    test: "progress-fight.test.ts, move-effects-runtime.test.ts",
  },
  "modify-roll": {
    executor: "roll-modifier",
    test: "attack-rolls.test.ts, progress-fight.test.ts, move-effects-runtime.test.ts",
  },
  "modify-roll-modifier": {
    executor: "roll-modifier-transformer",
    test: "progress-fight.test.ts, move-effects-runtime.test.ts, effect-executors.test.ts",
    capabilityId: "modify-roll-modifier.v1",
  },
  "modify-stat": { executor: "stat-modifier", test: "progress-fight.test.ts" },
  negate: {
    executor: "negation",
    test: "progress-fight.test.ts",
    capabilityId: "negate.v1",
  },
  "remove-move-from-combat": {
    executor: "combat-local-moveset-removal",
    test: "progress-fight.test.ts, move-effects-runtime.test.ts, effect-executors.test.ts",
    capabilityId: "remove-move-from-combat.v1",
  },
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
  "select-move-by-stored-roll": {
    executor: "stored-move-selection",
    test: "progress-fight.test.ts, move-effects-runtime.test.ts",
    capabilityId: "select-move-by-stored-roll.v1",
  },
  "set-combat-result": { executor: "combat-result-override", test: "progress-fight.test.ts" },
  "set-resolution-threshold": {
    executor: "resolution-threshold",
    test: "progress-fight.test.ts",
  },
  "set-roll-definition": { executor: "roll-definition", test: "attack-rolls.test.ts" },
  "set-roll-result": { executor: "roll-result-override", test: "attack-rolls.test.ts" },
  "set-roll-selection": {
    executor: "roll-selection",
    test: "attack-rolls.test.ts, progress-fight.test.ts, move-effects-runtime.test.ts",
    capabilityId: "set-roll-selection.v1",
  },
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
    test: "basic-attack.test.ts, progress-fight.test.ts, move-effects-runtime.test.ts",
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
  "prior-attack-damage-percent",
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
  "level-comparison",
  "stored-move-selection",
  "prior-turn-restriction",
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
    (effect.scope?.type === "next-action" || effect.scope?.type === "next-actions") &&
    effect.trigger === "upkeep-phase" &&
    effect.target === "self" &&
    effect.activationCost === undefined &&
    (effect.useLimit === undefined ||
      (effect.useLimit.scope === "combat" &&
        (typeof effect.useLimit.count === "number"
          ? Number.isInteger(effect.useLimit.count) && effect.useLimit.count >= 1
          : effect.useLimit.count.type === "literal" &&
            Number.isInteger(effect.useLimit.count.value) &&
            effect.useLimit.count.value >= 1)))
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
    effect.scope?.type === "following-action" &&
    effect.trigger === "passive" &&
    effect.target === "self" &&
    effect.scope.offset === 1 &&
    effect.conditions?.length === 1 &&
    effect.conditions[0]?.type === "prior-turn-restriction"
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
  const onRollResultSupported =
    effect.trigger !== "on-roll-result" ||
    ((effect.conditions ?? []).some((condition) => {
      const candidate = condition as Record<string, unknown>;
      return (
        condition.type === "roll-threshold" &&
        candidate.roll === "attack" &&
        candidate.comparison === "at-least"
      );
    }) &&
      (effect.conditions ?? []).some((condition) => {
        const candidate = condition as Record<string, unknown>;
        const attackRoll = candidate.attackRoll as Record<string, unknown> | undefined;
        return (
          condition.type === "move-selector" &&
          candidate.subject === "source" &&
          attackRoll?.dice === 1
        );
      }));
  const phaseSupported =
    effect.phase === "action-phase" ||
    (effect.phase === "upkeep-phase" && effect.scope?.type === "next-turn");
  return (
    effect.type === "grant-extra-action" &&
    effect.target === "self" &&
    (effect.trigger === "passive" ||
      effect.trigger === "on-success" ||
      effect.trigger === "on-stopped" ||
      (effect.trigger === "action-phase" && occurrence.origin === "move") ||
      effect.trigger === "on-roll-result") &&
    onRollResultSupported &&
    phaseSupported &&
    (effect.scope === undefined ||
      effect.scope.type === "current-action" ||
      effect.scope.type === "next-turn") &&
    effect.duration === undefined &&
    (effect.trigger !== "passive" ||
      (effect.moveCategory === "skill" &&
        effect.constant === false &&
        effect.maximumActions?.type === "literal" &&
        Number.isInteger(effect.maximumActions.value) &&
        effect.maximumActions.value >= 1 &&
        effect.scope === undefined)) &&
    effect.activationGroup === undefined &&
    effect.optional !== true &&
    effect.activationCost === undefined &&
    effect.cooldown === undefined &&
    effect.selectionLimit === undefined &&
    effect.stacking === undefined
  );
};

const isSupportedCombatOutcomeOccurrence = (occurrence: Occurrence) => {
  const effect = occurrence.effect;
  return (
    effect.type === "grant-combat-outcome" &&
    effect.trigger === "on-success" &&
    effect.target === "opponent" &&
    effect.selector === undefined &&
    effect.scope === undefined &&
    effect.duration === undefined &&
    effect.optional !== true &&
    effect.activationGroup === undefined &&
    effect.requireAllDiceSuccess === undefined &&
    effect.useLimit === undefined &&
    effect.activationCost === undefined &&
    effect.stacking === undefined &&
    effect.selectionLimit === undefined &&
    effect.cooldown === undefined &&
    effect.exclusiveActivationGroup === undefined
  );
};

const isSupportedRerollOccurrence = (occurrence: Occurrence) => {
  const effect = occurrence.effect;
  return (
    effect.type === "reroll" &&
    (effect.trigger === "after-defense-roll" || effect.trigger === "on-success") &&
    (effect.target === undefined || effect.target === "self" || effect.target === "opponent") &&
    (effect.trigger === "after-defense-roll"
      ? effect.scope === undefined
      : (effect.scope?.type === "next-action" ||
          effect.scope?.type === "next-roll" ||
          effect.scope?.type === "next-rolls") &&
        effect.duration === undefined) &&
    (effect.duration === undefined || effect.duration.type === "combat") &&
    effect.activationGroup === undefined &&
    effect.exclusiveActivationGroup === undefined &&
    effect.optional !== true
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isSupportedPendingChoiceOccurrence = (
  occurrence: Occurrence,
  occurrences: readonly Occurrence[],
) => {
  const effect = occurrence.effect;
  if (
    (effect.trigger !== "before-attack-roll" &&
      effect.trigger !== "after-defense-roll" &&
      effect.trigger !== "on-success" &&
      effect.trigger !== "on-power-up" &&
      effect.trigger !== "on-move-use" &&
      effect.trigger !== "on-cost-modified" &&
      effect.trigger !== "on-damage") ||
    (effect.target !== "self" && effect.target !== "opponent")
  )
    return false;
  const groupOccurrences = occurrences.filter(
    (candidate) =>
      candidate.origin === occurrence.origin &&
      candidate.sourceDefinitionId === occurrence.sourceDefinitionId &&
      candidate.effect.trigger === effect.trigger &&
      (effect.activationGroup === undefined && effect.exclusiveActivationGroup === undefined
        ? candidate.effect === effect && candidate.effect.target === effect.target
        : (candidate.effect.activationGroup ?? candidate.effect.exclusiveActivationGroup) ===
          (effect.activationGroup ?? effect.exclusiveActivationGroup)),
  );
  if (groupOccurrences.length === 0) return false;
  if (effect.trigger === "on-success") {
    const damageReplacement = groupOccurrences.some(
      (candidate) =>
        candidate.effect.type === "modify-damage" &&
        candidate.effect.target === "self" &&
        candidate.effect.operation === "set" &&
        candidate.effect.scope?.type === "current-action",
    );
    const orangeBurstGroup =
      damageReplacement &&
      groupOccurrences.every(
        (candidate) =>
          candidate.effect.type === "modify-damage" || candidate.effect.type === "deactivate",
      );
    const extraActionGroup =
      groupOccurrences.some((candidate) => candidate.effect.type === "grant-extra-action") &&
      groupOccurrences.every((candidate) => {
        const candidateEffect = candidate.effect;
        return (
          (candidateEffect.type === "grant-extra-action" &&
            candidateEffect.target === "self" &&
            candidateEffect.phase === "action-phase" &&
            (candidateEffect.scope === undefined ||
              candidateEffect.scope.type === "current-action" ||
              candidateEffect.scope.type === "next-turn") &&
            candidateEffect.activationCost === undefined) ||
          (candidateEffect.type === "modify-cost" &&
            candidateEffect.target === "self" &&
            candidateEffect.operation === "add" &&
            candidateEffect.scope?.type === "next-actions" &&
            candidateEffect.selector === undefined)
        );
      });
    const rerollGroup = groupOccurrences.every(
      (candidate) =>
        candidate.effect.type === "reroll" &&
        (candidate.effect.scope?.type === "next-action" ||
          candidate.effect.scope?.type === "next-roll" ||
          candidate.effect.scope?.type === "next-rolls"),
    );
    if (!orangeBurstGroup && !extraActionGroup && !rerollGroup) return false;
  }
  if (effect.trigger === "on-power-up") {
    const powerUpDamageGroup = groupOccurrences.every((candidate) => {
      const candidateEffect = candidate.effect;
      return (
        candidateEffect.type === "modify-damage" &&
        candidateEffect.target === "self" &&
        candidateEffect.operation === "add" &&
        candidateEffect.scope?.type === "next-action" &&
        candidateEffect.selector !== undefined &&
        candidateEffect.activationCost?.resource === "ki" &&
        candidateEffect.activationCost.operation === "lose" &&
        candidateEffect.useLimit === undefined
      );
    });
    if (!powerUpDamageGroup) return false;
  }
  if (effect.trigger === "on-move-use") {
    const costChoiceGroup = groupOccurrences.every((candidate) => {
      const candidateEffect = candidate.effect;
      return (
        candidateEffect.type === "modify-cost" &&
        candidateEffect.target === "self" &&
        candidateEffect.selector !== undefined &&
        (candidateEffect.scope === undefined || candidateEffect.scope.type === "current-action") &&
        candidateEffect.duration === undefined &&
        candidateEffect.useLimit === undefined &&
        candidateEffect.cooldown === undefined &&
        candidateEffect.stacking === undefined &&
        candidateEffect.activationCost !== undefined
      );
    });
    if (!costChoiceGroup) return false;
  }
  if (effect.trigger === "on-damage") {
    const damageChoiceGroup = groupOccurrences.every((candidate) => {
      const candidateEffect = candidate.effect;
      return (
        candidateEffect.type === "modify-damage" &&
        candidateEffect.target === "opponent" &&
        candidateEffect.operation === "add" &&
        (candidateEffect.scope === undefined || candidateEffect.scope.type === "current-action") &&
        candidateEffect.activationCost !== undefined &&
        candidateEffect.useLimit?.scope === "combat"
      );
    });
    if (!damageChoiceGroup) return false;
  }
  if (effect.trigger === "on-cost-modified") {
    const costChoiceGroup = groupOccurrences.every((candidate) => {
      const candidateEffect = candidate.effect;
      return (
        candidateEffect.type === "modify-cost" &&
        candidateEffect.target === "self" &&
        (candidateEffect.scope === undefined || candidateEffect.scope.type === "current-action") &&
        candidateEffect.duration === undefined &&
        candidateEffect.useLimit === undefined &&
        candidateEffect.cooldown === undefined &&
        candidateEffect.stacking === undefined
      );
    });
    if (!costChoiceGroup) return false;
  }
  return groupOccurrences.every(
    (candidate) =>
      candidate.origin !== "item" &&
      compileEffectPlan({
        sourceDefinitionId: candidate.sourceDefinitionId,
        effectIndex: candidate.effectIndex,
        effect: candidate.effect as EffectDefinition,
        allowPendingChoice: true,
      }).ok,
  );
};

const isSupportedActivationOccurrence = (occurrence: Occurrence) => {
  const effect = occurrence.effect;
  const groupedReactivation =
    effect.repeatCount?.type === "successful-hit-count-groups" &&
    Number.isInteger(effect.repeatCount.groupSize) &&
    effect.repeatCount.groupSize >= 1 &&
    effect.ignoreRequirements === true;
  const repeatUntilSupported =
    effect.repeatCount === undefined &&
    effect.ignoreRequirements === undefined &&
    isRecord(effect.repeatUntil) &&
    effect.repeatUntil.type === "active-move-count-matches-opponent" &&
    effect.repeatUntil.fallback === "no-eligible-moves" &&
    isRecord(effect.repeatUntil.selector) &&
    effect.repeatUntil.selector.subject === "source";
  if (
    effect.type !== "activate" ||
    (effect.trigger !== "before-attack-roll" &&
      effect.trigger !== "on-success" &&
      effect.trigger !== "start-combat" &&
      effect.trigger !== "on-roll-result") ||
    effect.target !== "self" ||
    !isRecord(effect.selector) ||
    effect.selector.subject !== "source" ||
    !(
      (effect.selector.category === "skill" && effect.selector.constant === true) ||
      (Array.isArray(effect.selector.ids) && effect.selector.ids.length > 0)
    ) ||
    effect.asIf !== undefined ||
    (effect.repeatCount !== undefined && !groupedReactivation) ||
    (effect.ignoreRequirements === true && !groupedReactivation) ||
    effect.selectionKey !== undefined ||
    (effect.repeatUntil !== undefined && !repeatUntilSupported) ||
    effect.activationCost !== undefined
  )
    return false;
  if (
    (effect.trigger === "start-combat" && effect.scope !== undefined) ||
    (effect.trigger === "on-roll-result" &&
      (effect.scope?.type !== "next-phase" ||
        effect.scope.subject !== "self" ||
        effect.scope.phase !== "end")) ||
    (effect.trigger === "on-success" && effect.scope !== undefined)
  )
    return false;
  if (
    effect.conditions?.some(
      (condition) => condition.type === "resource-change" && condition.timing !== "current-event",
    )
  )
    return false;
  return groupedReactivation ? effect.selector.constant === true : true;
};

const isSupportedStartCombatActivationCost = (
  occurrence: Occurrence,
  occurrences: readonly Occurrence[],
) => {
  const effect = occurrence.effect;
  if (
    effect.type !== "modify-cost" ||
    effect.trigger !== "start-combat" ||
    effect.target !== "self" ||
    effect.operation !== "set" ||
    effect.amount.type !== "literal" ||
    effect.amount.value !== 0 ||
    effect.selector?.selectionKey === undefined
  )
    return false;
  return occurrences.some(
    (candidate) =>
      candidate.sourceDefinitionId === occurrence.sourceDefinitionId &&
      candidate.effect.type === "activate" &&
      candidate.effect.trigger === "start-combat" &&
      candidate.effect.target === "self" &&
      candidate.effect.selector.selectionKey === effect.selector?.selectionKey &&
      compileEffectPlan({
        sourceDefinitionId: candidate.sourceDefinitionId,
        effectIndex: candidate.effectIndex,
        effect: candidate.effect as EffectDefinition,
        allowPendingChoice: true,
      }).ok,
  );
};

const classify = (occurrence: Occurrence, occurrences: readonly Occurrence[]) => {
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
  const pendingChoiceSupported = isSupportedPendingChoiceOccurrence(occurrence, occurrences);
  const activationSupported = isSupportedActivationOccurrence(occurrence);
  const activationCostSupported = isSupportedStartCombatActivationCost(occurrence, occurrences);
  if (
    (occurrence.effect.optional === true ||
      occurrence.effect.activationGroup !== undefined ||
      occurrence.effect.exclusiveActivationGroup !== undefined) &&
    !pendingChoiceSupported &&
    !activationSupported
  ) {
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
          allowPendingChoice: pendingChoiceSupported || activationSupported,
        });
  if (
    effectType === "modify-cost" &&
    pendingChoiceSupported &&
    (occurrence.effect.trigger === "on-move-use" ||
      occurrence.effect.trigger === "on-cost-modified") &&
    occurrence.effect.target === "self" &&
    compilation?.ok === true
  ) {
    return {
      status: "supported-generic" as const,
      capabilityId: "modify-cost.v1",
      executor: "cost-modifier",
      focusedCoverage: "progress-fight.test.ts, move-effects-runtime.test.ts",
      reason:
        "The serialized cost-modified activation choice applies a typed current-action cost modifier and its typed activation resource change.",
      prerequisite: null,
      approvedExclusion: null,
    };
  }
  if (effectType === "activate" && activationSupported && compilation?.ok === true) {
    const repeated =
      occurrence.effect.repeatCount !== undefined || occurrence.effect.repeatUntil !== undefined;
    return {
      status: "supported-generic" as const,
      capabilityId: repeated ? "activate.v2" : "activate.v1",
      executor: "constant-activation-selection",
      focusedCoverage: "progress-fight.test.ts, move-effects-runtime.test.ts",
      reason:
        occurrence.effect.repeatUntil !== undefined
          ? "The typed activation executor resolves the opponent-count repeat-until condition into a bounded, serialized CONSTANT Skill selection sequence."
          : repeated
            ? "The typed activation executor resolves successful-hit-count groups into a bounded, serialized reactivation sequence."
            : "The typed activation executor serializes one ordinary CONSTANT Skill choice and charges it on resolution.",
      prerequisite: null,
      approvedExclusion: null,
    };
  }
  if (effectType === "modify-cost" && activationCostSupported && compilation?.ok === true) {
    return {
      status: "supported-generic" as const,
      capabilityId: "activate.v1",
      executor: "constant-activation-selection",
      focusedCoverage: "progress-fight.test.ts, move-effects-runtime.test.ts",
      reason:
        "The typed activation-selection executor pairs the start-combat absolute cost override with the serialized CONSTANT Skill choice.",
      prerequisite: null,
      approvedExclusion: null,
    };
  }
  if (effectType === "modify-damage") {
    const supportedOnSuccessChoice =
      pendingChoiceSupported &&
      occurrence.effect.trigger === "on-success" &&
      occurrence.effect.target === "self" &&
      occurrence.effect.scope?.type === "current-action" &&
      occurrence.effect.operation === "set";
    const supportedOnPowerUpChoice =
      pendingChoiceSupported &&
      occurrence.effect.trigger === "on-power-up" &&
      occurrence.effect.target === "self" &&
      occurrence.effect.scope?.type === "next-action" &&
      occurrence.effect.operation === "add";
    const supportedOnDamageChoice =
      pendingChoiceSupported &&
      occurrence.effect.trigger === "on-damage" &&
      occurrence.effect.target === "opponent" &&
      occurrence.effect.operation === "add" &&
      (occurrence.effect.scope === undefined ||
        occurrence.effect.scope.type === "current-action") &&
      occurrence.effect.activationCost !== undefined &&
      occurrence.effect.useLimit?.scope === "combat";
    if (
      (isSupportedDamageOccurrence(occurrence) ||
        supportedOnSuccessChoice ||
        supportedOnPowerUpChoice ||
        supportedOnDamageChoice) &&
      compilation?.ok === true
    ) {
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
  if (
    effectType === "grant-extra-action" &&
    !isSupportedExtraActionOccurrence(occurrence) &&
    !pendingChoiceSupported
  ) {
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
  if (effectType === "grant-combat-outcome" && !isSupportedCombatOutcomeOccurrence(occurrence)) {
    return {
      status: "unsupported-in-scope" as const,
      capabilityId: null,
      executor: null,
      focusedCoverage: null,
      reason:
        "This combat-outcome variant requires a future-action selector, deferred scope, optionality, or another unsupported lifecycle.",
      prerequisite: "typed executor accounting and compiled effect-plan validation",
      approvedExclusion: null,
    };
  }
  if (
    effectType === "reroll" &&
    !isSupportedRerollOccurrence(occurrence) &&
    !pendingChoiceSupported
  ) {
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
  const sourceOccurrences = collectOccurrences();
  const occurrences = sourceOccurrences.map((occurrence) => {
    const classification = classify(occurrence, sourceOccurrences);
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
    generatedAt: "2026-08-23",
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

const prioritySummary = (rows: readonly CombatCapabilityMatrixRow[]) => {
  const counts = new Map<
    string,
    { prerequisite: string; effectType: string; occurrences: number; definitions: Set<string> }
  >();
  for (const row of rows) {
    if (row.status !== "unsupported-in-scope") continue;
    const prerequisite = row.prerequisite ?? "unclassified";
    const key = `${prerequisite}\u0000${row.effectType}`;
    const current = counts.get(key) ?? {
      prerequisite,
      effectType: row.effectType,
      occurrences: 0,
      definitions: new Set<string>(),
    };
    current.occurrences += 1;
    current.definitions.add(row.sourceDefinitionId);
    counts.set(key, current);
  }
  return [...counts.values()]
    .sort(
      (left, right) =>
        right.occurrences - left.occurrences ||
        right.definitions.size - left.definitions.size ||
        left.prerequisite.localeCompare(right.prerequisite) ||
        left.effectType.localeCompare(right.effectType),
    )
    .map((value, index) => ({
      rank: index + 1,
      ...value,
    }));
};

export const renderCombatCapabilityMatrix = (matrix = createCombatCapabilityMatrix()): string => {
  const priorities = prioritySummary(matrix.occurrences);
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
    "## Unsupported in-scope priorities",
    "",
    "Ranked by occurrence count, then distinct definitions, to select the next generic capability slice.",
    "",
    "| Rank | Prerequisite | Effect type | Occurrences | Definitions |",
    "| ---: | --- | --- | ---: | ---: |",
    ...priorities.map(
      (priority) =>
        `| ${priority.rank} | ${priority.prerequisite} | ${priority.effectType} | ${priority.occurrences} | ${priority.definitions.size} |`,
    ),
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
