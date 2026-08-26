import { ITEM_DEFINITIONS } from "../packages/game-data/src/item-definitions.js";
import { MOVE_DEFINITIONS } from "../packages/game-data/src/move-definitions.js";
import { TRANSFORMATION_DEFINITIONS } from "../packages/game-data/src/transformation-definitions.js";
import type { EffectDefinition } from "../packages/game-data/src/shared/effects.js";

import { compileEffectPlan } from "../packages/combat-engine/src/effect-executors.js";
import {
  isCombatResultCountNextActionsDamageModifier,
  isSelectedMoveUntilAttackThresholdDamageModifier,
} from "../packages/combat-engine/src/damage-modifier-capabilities.js";

// Capability audits inspect runtime-shaped effect data independently of its narrowed type.
const runtimeValue = (value: unknown): unknown => value;

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
  readonly move?: unknown;
  readonly performAfterTurns?: unknown;
  readonly damage?: unknown;
  readonly cancellation?: unknown;
  readonly onCancellation?: unknown;
  readonly repeat?: unknown;
  readonly affectedType?: unknown;
  readonly turnsAfter?: unknown;
  readonly repeatUntil?: {
    readonly type?: unknown;
    readonly selector?: unknown;
    readonly fallback?: unknown;
  };
  readonly percent?: { readonly type?: unknown };
  readonly selector?: unknown;
  readonly activationGroup?: unknown;
  readonly optional?: unknown;
  readonly asIf?: unknown;
  readonly selectionKey?: unknown;
  readonly repeatCount?: { readonly type?: unknown; readonly groupSize?: unknown };
  readonly ignoreRequirements?: unknown;
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
  readonly generatedAt: "2026-08-24";
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
  "activate-protected-constant": {
    executor: "protected-constant-activation",
    test: "deactivation-flow.test.ts, effect-executors.test.ts",
    capabilityId: "activate-protected-constant.v1",
  },
  "apply-status": { executor: "status-lifecycle", test: "move-effects-runtime.test.ts" },
  "copy-move-effect": {
    executor: "copied-attack-action",
    test: "progress-fight.test.ts, effect-executors.test.ts",
    capabilityId: "copy-move-effect.v1",
  },
  "copy-move-effects": {
    executor: "copied-successful-effects-selection",
    test: "progress-fight.test.ts, effect-executors.test.ts",
    capabilityId: "copy-move-effects.v1",
  },
  "require-all-dice-success": {
    executor: "all-dice-success-gate",
    test: "progress-fight.test.ts, move-effects-runtime.test.ts, effect-executors.test.ts",
    capabilityId: "require-all-dice-success.v1",
  },
  "replace-active-constant-effects": {
    executor: "active-constant-replacement-selection",
    test: "progress-fight.test.ts, effect-executors.test.ts",
    capabilityId: "replace-active-constant-effects.v1",
  },
  "replace-move-effect": {
    executor: "move-effect-replacement-selection",
    test: "progress-fight.test.ts, move-effects-runtime.test.ts, effect-executors.test.ts",
    capabilityId: "replace-move-effect.v1",
  },
  "create-floating-effect": {
    executor: "floating-effect-lifecycle",
    test: "basic-attack.test.ts, progress-fight.test.ts, move-effects-runtime.test.ts",
  },
  deactivate: { executor: "constant-lifecycle", test: "deactivation-flow.test.ts" },
  "defer-move": {
    executor: "deferred-move-scheduling",
    test: "progress-fight.test.ts, move-effects-runtime.test.ts, effect-executors.test.ts",
    capabilityId: "defer-move.v1",
  },
  "force-action": { executor: "forced-action", test: "progress-fight.test.ts" },
  "grant-extra-action": {
    executor: "extra-action-scheduler",
    test: "progress-fight.test.ts",
    capabilityId: "grant-extra-action.v2",
  },
  "grant-transformation-action": {
    executor: "transformation-action",
    test: "transformation-activation.test.ts, effect-executors.test.ts",
    capabilityId: "grant-transformation-action.v1",
  },
  "force-transformation": {
    executor: "forced-transformation-opportunity",
    test: "transformation-activation.test.ts, progress-fight.test.ts",
    capabilityId: "force-transformation.v1",
  },
  "reactivate-recent-skill": {
    executor: "constant-reactivation-selection",
    test: "progress-fight.test.ts, deactivation-flow.test.ts",
    capabilityId: "reactivate-constant-skill.v1",
  },
  "reactivate-deactivated-constant-skill": {
    executor: "constant-reactivation-selection",
    test: "progress-fight.test.ts, deactivation-flow.test.ts",
    capabilityId: "reactivate-constant-skill.v1",
  },
  "grant-combat-outcome": {
    executor: "combat-outcome-status",
    test: "progress-fight.test.ts, move-effects-runtime.test.ts",
    capabilityId: "grant-combat-outcome.v1",
  },
  "grant-destruction-mastery": {
    executor: "destruction-mastery-selection",
    test: "progress-fight.test.ts, effect-executors.test.ts",
    capabilityId: "grant-destruction-mastery.v1",
  },
  "grant-counter-action": {
    executor: "counter-action",
    test: "progress-fight.test.ts, effect-executors.test.ts",
    capabilityId: "grant-counter-action.v1",
  },
  lock: { executor: "action-lock", test: "progress-fight.test.ts" },
  "modify-cost": { executor: "cost-modifier", test: "move-effects-runtime.test.ts" },
  "modify-cost-modifier": {
    executor: "cost-modifier-transformer",
    test: "progress-fight.test.ts, move-effects-runtime.test.ts, effect-executors.test.ts",
    capabilityId: "modify-cost-modifier.v1",
  },
  "modify-critical-threshold": {
    executor: "critical-threshold",
    test: "move-attacks.test.ts, progress-fight.test.ts",
    capabilityId: "modify-critical-threshold.v1",
  },
  "modify-damage-reduction-cost": {
    executor: "damage-reduction-cost-modifier",
    test: "progress-fight.test.ts, effect-executors.test.ts",
    capabilityId: "modify-damage-reduction-cost.v1",
  },
  "modify-move-classification": {
    executor: "move-classification-lifecycle",
    test: "move-effects-runtime.test.ts, progress-fight.test.ts",
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
  "exchange-constant-skill": {
    executor: "constant-skill-exchange",
    test: "deactivation-flow.test.ts, progress-fight.test.ts",
    capabilityId: "exchange-constant-skill.v1",
  },
  "modify-resource-cost": {
    executor: "resource-cost-modifier",
    test: "effect-executors.test.ts, move-effects-runtime.test.ts, progress-fight.test.ts",
    capabilityId: "modify-resource-cost.v1",
  },
  "modify-damage-modifier": {
    executor: "damage-modifier-transformer",
    test: "progress-fight.test.ts, move-effects-runtime.test.ts, effect-executors.test.ts",
    capabilityId: "modify-damage-modifier.v1",
  },
  "modify-resource-modifier": {
    executor: "resource-modifier-transformer",
    test: "progress-fight.test.ts, move-effects-runtime.test.ts, effect-executors.test.ts",
    capabilityId: "modify-resource-modifier.v1",
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
  "modify-slot-capacity": {
    executor: "moveset-slot-capacity",
    test: "create-fight.test.ts, move-effects-runtime.test.ts, effect-executors.test.ts",
    capabilityId: "modify-slot-capacity.v1",
  },
  "modify-stat": { executor: "stat-modifier", test: "progress-fight.test.ts" },
  negate: {
    executor: "negation",
    test: "progress-fight.test.ts",
    capabilityId: "negate.v1",
  },
  "negate-deactivation": {
    executor: "deactivation-negation",
    test: "deactivation-flow.test.ts, progress-fight.test.ts",
    capabilityId: "negate-deactivation.v1",
  },
  "override-resolution-immunity": {
    executor: "resolution-immunity-override",
    test: "block-mechanics.test.ts, effect-executors.test.ts",
    capabilityId: "override-resolution-immunity.v1",
  },
  "remove-move-from-combat": {
    executor: "combat-local-moveset-removal",
    test: "progress-fight.test.ts, move-effects-runtime.test.ts, effect-executors.test.ts",
    capabilityId: "remove-move-from-combat.v1",
  },
  "revert-transformation": {
    executor: "transformation-lifecycle",
    test: "transformation-activation.test.ts, effect-executors.test.ts",
    capabilityId: "revert-transformation.v1",
  },
  reroll: {
    executor: "reroll-reaction",
    test: "basic-attack.test.ts, move-effects-runtime.test.ts",
  },
  "prevent-combat-result": {
    executor: "combat-result-prevention",
    test: "basic-attack.test.ts",
  },
  "prevent-low-roll-stop": {
    executor: "resolution-threshold",
    test: "transformation-activation.test.ts, effect-executors.test.ts",
    capabilityId: "prevent-low-roll-stop.v1",
  },
  "prevent-move-modification": {
    executor: "move-modification-prevention",
    test: "move-effects-runtime.test.ts, progress-fight.test.ts",
    capabilityId: "prevent-move-modification.v3",
  },
  "prevent-move-use": { executor: "move-use-prevention", test: "move-effects-runtime.test.ts" },
  "prevent-resource-modification": {
    executor: "resource-modification-prevention",
    test: "progress-fight.test.ts, move-effects-runtime.test.ts",
  },
  "prevent-resolution": {
    executor: "resolution-prevention",
    test: "basic-attack.test.ts, move-effects-runtime.test.ts, progress-fight.test.ts",
  },
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
  "set-stat-comparison": {
    executor: "stat-comparison-override",
    test: "move-effects-runtime.test.ts, progress-fight.test.ts",
    capabilityId: "set-stat-comparison.v1",
  },
  "set-roll-definition": { executor: "roll-definition", test: "attack-rolls.test.ts" },
  "set-roll-result": { executor: "roll-result-override", test: "attack-rolls.test.ts" },
  "resolve-contest": {
    executor: "contest-resolution",
    test: "progress-fight.test.ts, effect-executors.test.ts",
    capabilityId: "resolve-contest.v1",
  },
  "require-transformation-roll": {
    executor: "required-transformation-roll",
    test: "transformation-activation.test.ts, effect-executors.test.ts",
    capabilityId: "require-transformation-roll.v1",
  },
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
  "suppress-requirement": {
    executor: "requirement-suppression",
    test: "progress-fight.test.ts, effect-executors.test.ts",
    capabilityId: "suppress-requirement.v1",
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
  "item-prevent-combat-outcome": {
    executor: "item-combat-outcome-prevention",
    test: "progress-fight.test.ts, item-effects-runtime.test.ts",
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

const approvedMoveExclusions: Readonly<Record<string, string>> = {
  "join-attack": "multiplayer and remote-target combat are outside the active 1v1 scope",
  travel: "out-of-combat travel is outside the combat-engine scope",
  "grant-defense-response": "interferer and spectator responses are outside the active 1v1 scope",
  "swap-combatant-state": "body-swap identity mutation is outside the active combat scope",
  "grant-racial-traits":
    "temporary identity and racial-trait mutation is outside the active combat scope",
};

const approvedMoveOccurrenceExclusions: Readonly<Record<string, string>> = {
  "move-afterlife-energy-blade:0":
    "equipment loadout mutation is outside the active combat state boundary",
  "move-afterlife-energy-blade:1":
    "move requirement loadout mutation is outside the active combat state boundary",
  "move-haokiru-healing-ray:2":
    "ally-targeted resource changes are outside the active 1v1 and remote-target scope",
  "move-haokiru-karmic-chameleon-mastery:0":
    "temporary opponent-mastery acquisition is identity and ability mutation outside the active combat scope",
  "move-haokiru-karmic-chameleon-mastery:1":
    "temporary opponent-technique acquisition is identity and ability mutation outside the active combat scope",
  "move-haokiru-karmic-chameleon-mastery:2":
    "temporary opponent-technique acquisition is identity and ability mutation outside the active combat scope",
  "move-haokiru-karmic-chameleon-mastery:3":
    "temporary technique style reassignment is identity and ability mutation outside the active combat scope",
  "move-haokiru-karmic-chameleon-mastery:4":
    "temporary technique style reassignment is identity and ability mutation outside the active combat scope",
  "move-haokiru-karmic-chameleon-mastery:5":
    "temporary opponent-technique acquisition is identity and ability mutation outside the active combat scope",
  "move-midorikatai-raining-bombs:1":
    "escape-roll decisions are outside the active fight transition scope",
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
    (effect.activationCost === undefined ||
      (effect.activationCost.resource === "ki" &&
        effect.activationCost.operation === "lose" &&
        effect.activationCost.amount.type === "literal" &&
        Number.isInteger(effect.activationCost.amount.value) &&
        effect.activationCost.amount.value >= 1 &&
        (effect.activationCost.minimum === undefined ||
          (effect.activationCost.minimum.type === "literal" &&
            Number.isInteger(effect.activationCost.minimum.value) &&
            effect.activationCost.minimum.value >= 0)) &&
        ((effect.phase === "action-phase" && effect.scope?.type === "current-action") ||
          (effect.phase === "upkeep-phase" && effect.scope?.type === "next-turn")))) &&
    effect.cooldown === undefined &&
    effect.selectionLimit === undefined &&
    effect.stacking === undefined
  );
};

const isSupportedDeferredMoveOccurrence = (occurrence: Occurrence) => {
  const effect = occurrence.effect;
  const damage = effect.damage as
    | {
        readonly operation?: unknown;
        readonly percent?: { readonly type?: unknown; readonly value?: unknown };
      }
    | undefined;
  const cancellation = effect.cancellation as
    { readonly actor?: unknown; readonly result?: unknown } | undefined;
  const onCancellation = effect.onCancellation as
    | {
        readonly type?: unknown;
        readonly affectedType?: unknown;
        readonly duration?: { readonly type?: unknown };
      }
    | undefined;
  return (
    effect.type === "defer-move" &&
    effect.trigger === "action-phase" &&
    effect.target === "self" &&
    effect.move === "source" &&
    effect.performAfterTurns === 1 &&
    (effect.optional === undefined || typeof effect.optional === "boolean") &&
    (damage === undefined ||
      (damage.operation === "set" &&
        damage.percent?.type === "literal" &&
        typeof damage.percent.value === "number" &&
        Number.isFinite(damage.percent.value) &&
        damage.percent.value >= 0)) &&
    cancellation?.actor === "opponent" &&
    cancellation.result === "successful" &&
    (onCancellation === undefined ||
      (onCancellation.type === "lock" &&
        onCancellation.affectedType === "attack" &&
        onCancellation.duration?.type === "combat"))
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
  const storedRollMatchChoice =
    effect.type === "reroll" &&
    effect.trigger === "on-roll-result" &&
    effect.target === "self" &&
    effect.conditions?.length === 1 &&
    effect.conditions[0]?.type === "stored-roll-match" &&
    effect.conditions[0].roll === effect.roll &&
    effect.conditions[0].natural === true &&
    effect.scope === undefined &&
    effect.duration === undefined &&
    effect.useLimit?.scope === "combat" &&
    effect.activationCost === undefined;
  const beforeDefenseChoice =
    effect.type === "reroll" &&
    effect.trigger === "before-defense-roll" &&
    effect.target === "opponent" &&
    effect.roll === "attack" &&
    (effect.rerollScope === undefined || effect.rerollScope === "single-result") &&
    effect.scope?.type === "next-rolls" &&
    effect.scope.roll === "attack" &&
    effect.scope.count.type === "literal" &&
    effect.scope.count.value === 3 &&
    effect.optional === true &&
    effect.conditions === undefined &&
    effect.duration === undefined &&
    effect.activationCost === undefined;
  return (
    effect.type === "reroll" &&
    (effect.trigger === "after-defense-roll" ||
      effect.trigger === "on-success" ||
      beforeDefenseChoice ||
      storedRollMatchChoice) &&
    (effect.target === undefined || effect.target === "self" || effect.target === "opponent") &&
    (effect.trigger === "before-defense-roll"
      ? beforeDefenseChoice
      : effect.trigger === "on-roll-result"
        ? storedRollMatchChoice
        : effect.trigger === "after-defense-roll"
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
  const selectedTemporaryTargetRemoval =
    effect.type === "remove-move-from-combat" &&
    effect.trigger === "on-success" &&
    effect.target === "opponent" &&
    effect.move === "target" &&
    isRecord(effect.selector) &&
    isRecord(effect.duration) &&
    effect.duration.type === "until-perfect-roll" &&
    effect.conditions === undefined &&
    effect.scope === undefined &&
    effect.activationCost === undefined &&
    effect.useLimit === undefined &&
    effect.cooldown === undefined &&
    effect.selectionLimit === undefined;
  const selectedPermanentTargetRemoval =
    effect.type === "remove-move-from-combat" &&
    effect.trigger === "action-phase" &&
    effect.target === "opponent" &&
    effect.move === "target" &&
    isRecord(effect.selector) &&
    effect.selector.subject === "target" &&
    effect.selector.category === "skill" &&
    effect.selector.constant === false &&
    effect.conditions === undefined &&
    effect.scope === undefined &&
    effect.duration === undefined &&
    effect.activationCost === undefined &&
    effect.useLimit === undefined &&
    effect.cooldown === undefined &&
    effect.selectionLimit === undefined;
  if (selectedPermanentTargetRemoval)
    return compileEffectPlan({
      sourceDefinitionId: occurrence.sourceDefinitionId,
      effectIndex: occurrence.effectIndex,
      effect: effect as EffectDefinition,
      allowPendingChoice: true,
    }).ok;
  if (selectedTemporaryTargetRemoval)
    return compileEffectPlan({
      sourceDefinitionId: occurrence.sourceDefinitionId,
      effectIndex: occurrence.effectIndex,
      effect: effect as EffectDefinition,
      allowPendingChoice: true,
    }).ok;
  const galickGunResponseGroup = occurrences.filter(
    (candidate) =>
      candidate.sourceDefinitionId === "move-afterlife-galick-gun" &&
      candidate.effect.trigger === "before-defense-roll" &&
      candidate.effect.activationGroup === "galick-gun-sacrifice-response",
  );
  const galickGunResponseChoice =
    occurrence.sourceDefinitionId === "move-afterlife-galick-gun" &&
    galickGunResponseGroup.length === 3 &&
    galickGunResponseGroup.some(
      (candidate) => candidate.effect.type === "remove-move-from-combat",
    ) &&
    galickGunResponseGroup.some((candidate) => candidate.effect.type === "negate") &&
    galickGunResponseGroup.some((candidate) => candidate.effect.type === "lock");
  if (galickGunResponseChoice) return true;
  const reactivationChoice =
    effect.type === "reactivate-deactivated-constant-skill" &&
    effect.trigger === "on-move-use" &&
    effect.target === "self" &&
    compileEffectPlan({
      sourceDefinitionId: occurrence.sourceDefinitionId,
      effectIndex: occurrence.effectIndex,
      effect: effect as EffectDefinition,
      allowPendingChoice: true,
    }).ok;
  if (reactivationChoice) return true;
  const genericSerializedChoiceTrigger =
    effect.trigger === "start-combat" ||
    effect.trigger === "before-defense-roll" ||
    effect.trigger === "after-defense-roll" ||
    effect.trigger === "on-success" ||
    effect.trigger === "on-move-use" ||
    effect.trigger === "on-roll-modified" ||
    effect.trigger === "on-roll-result" ||
    (effect.trigger === "on-deactivated" && effect.type === "negate-deactivation") ||
    (effect.trigger === "action-phase" &&
      (effect.type === "reactivate-recent-skill" ||
        effect.type === "reactivate-deactivated-constant-skill")) ||
    (effect.trigger === "on-move-use" && effect.type === "reactivate-deactivated-constant-skill") ||
    (effect.trigger === "on-success" && effect.type === "activate-protected-constant");
  const genericSerializedChoice =
    genericSerializedChoiceTrigger &&
    (effect.optional === true ||
      effect.activationGroup !== undefined ||
      effect.exclusiveActivationGroup !== undefined) &&
    (effect.target === "self" || effect.target === "opponent") &&
    compileEffectPlan({
      sourceDefinitionId: occurrence.sourceDefinitionId,
      effectIndex: occurrence.effectIndex,
      effect: effect as EffectDefinition,
      allowPendingChoice: true,
    }).ok;
  if (genericSerializedChoice) return true;
  const multitaskingKickUpkeepAllowance =
    occurrence.sourceDefinitionId === "move-freestyle-multitasking-kick" &&
    effect.type === "grant-extra-action" &&
    effect.trigger === "on-success" &&
    effect.target === "self" &&
    effect.phase === "upkeep-phase" &&
    effect.moveCategory === "item-use" &&
    effect.scope?.type === "next-turn" &&
    effect.optional === true &&
    effect.activationCost === undefined &&
    effect.maximumActions === undefined &&
    effect.useLimit === undefined &&
    effect.cooldown === undefined &&
    effect.selectionLimit === undefined &&
    effect.stacking === undefined;
  if (multitaskingKickUpkeepAllowance)
    return compileEffectPlan({
      sourceDefinitionId: occurrence.sourceDefinitionId,
      effectIndex: occurrence.effectIndex,
      effect: effect as EffectDefinition,
      allowPendingChoice: true,
    }).ok;
  const upkeepFloatingChoice =
    effect.type === "create-floating-effect" &&
    effect.trigger === "upkeep-phase" &&
    effect.target === "self" &&
    effect.optional === true &&
    effect.selectionLimit === 1 &&
    effect.activationCost?.resource === "ki" &&
    effect.activationCost.operation === "lose" &&
    isRecord(effect.activationCost.amount) &&
    effect.activationCost.amount.type === "literal" &&
    effect.useLimit?.scope === "combat" &&
    (typeof effect.useLimit.count === "number" ||
      (isRecord(effect.useLimit.count) && effect.useLimit.count.type === "literal")) &&
    effect.scope?.type === "next-action";
  if (upkeepFloatingChoice)
    return compileEffectPlan({
      sourceDefinitionId: occurrence.sourceDefinitionId,
      effectIndex: occurrence.effectIndex,
      effect: effect as EffectDefinition,
      allowPendingChoice: true,
    }).ok;
  const upkeepSuppressionChoice =
    effect.type === "suppress" &&
    effect.trigger === "upkeep-phase" &&
    (effect.target === "self" ||
      effect.target === "opponent" ||
      effect.target === "participants") &&
    effect.aspects?.length === 1 &&
    effect.aspects[0] === "all-effects" &&
    effect.duration?.type === "turns" &&
    isRecord(effect.selector) &&
    effect.selector.subject === "target" &&
    effect.useLimit?.scope === "combat" &&
    ((effect.target === "participants" &&
      effect.selector.category === "skill" &&
      effect.selector.constant === true &&
      isRecord(effect.duration.turns) &&
      effect.duration.turns.type === "literal" &&
      effect.duration.turns.value === 4 &&
      effect.useLimit.count === 1 &&
      isRecord(effect.activationCost) &&
      effect.activationCost.resource === "ki" &&
      effect.activationCost.operation === "lose" &&
      isRecord(effect.activationCost.amount) &&
      effect.activationCost.amount.type === "literal" &&
      effect.activationCost.amount.value === 1) ||
      (effect.target === "opponent" &&
        effect.selector.category === "advanced-attack" &&
        isRecord(effect.duration.turns) &&
        effect.duration.turns.type === "literal" &&
        effect.duration.turns.value === 3 &&
        effect.useLimit.count === 2 &&
        effect.activationCost === undefined));
  if (upkeepSuppressionChoice)
    return compileEffectPlan({
      sourceDefinitionId: occurrence.sourceDefinitionId,
      effectIndex: occurrence.effectIndex,
      effect: effect as EffectDefinition,
      allowPendingChoice: true,
    }).ok;
  const storedRollTargetChoice =
    effect.type === "modify-resource" &&
    effect.trigger === "on-roll-result" &&
    effect.target === "ally" &&
    effect.resource === "hp" &&
    effect.operation === "gain" &&
    effect.amount?.type === "resource-percent" &&
    effect.exclusiveActivationGroup !== undefined &&
    (effect.conditions ?? []).some((condition) => condition.type === "stored-roll-threshold");
  if (storedRollTargetChoice)
    return compileEffectPlan({
      sourceDefinitionId: occurrence.sourceDefinitionId,
      effectIndex: occurrence.effectIndex,
      effect: effect as EffectDefinition,
      allowPendingChoice: true,
    }).ok;
  if (
    (effect.trigger !== "before-attack-roll" &&
      effect.trigger !== "before-defense-roll" &&
      effect.trigger !== "after-defense-roll" &&
      effect.trigger !== "on-success" &&
      effect.trigger !== "on-power-up" &&
      effect.trigger !== "on-move-use" &&
      effect.trigger !== "on-cost-modified" &&
      effect.trigger !== "on-damage" &&
      effect.trigger !== "on-roll-modified" &&
      effect.trigger !== "start-combat" &&
      effect.trigger !== "on-roll-result") ||
    (effect.target !== "self" && effect.target !== "opponent")
  )
    return false;
  const groupedOccurrences = occurrences.filter(
    (candidate) =>
      candidate.origin === occurrence.origin &&
      candidate.sourceDefinitionId === occurrence.sourceDefinitionId &&
      candidate.effect.trigger === effect.trigger &&
      (effect.activationGroup === undefined && effect.exclusiveActivationGroup === undefined
        ? candidate.effect === effect && candidate.effect.target === effect.target
        : (candidate.effect.activationGroup ?? candidate.effect.exclusiveActivationGroup) ===
          (effect.activationGroup ?? effect.exclusiveActivationGroup)),
  );
  const groupOccurrences =
    effect.trigger === "on-roll-result" && effect.exclusiveActivationGroup !== undefined
      ? groupedOccurrences.filter((candidate) => candidate.effect.target === effect.target)
      : groupedOccurrences;
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
    const resourceCostGroup = groupOccurrences.every((candidate) => {
      const candidateEffect = candidate.effect;
      return (
        candidateEffect.type === "modify-resource-cost" &&
        candidateEffect.target === "self" &&
        candidateEffect.scope?.type === "next-action" &&
        candidateEffect.selector?.subject === "source" &&
        candidateEffect.selector.effectKinds?.length === 1 &&
        candidateEffect.selector.effectKinds[0] === "resource-loss" &&
        ((candidateEffect.selector.category === "signature" &&
          candidateEffect.selector.categories === undefined) ||
          (candidateEffect.selector.category === undefined &&
            candidateEffect.selector.categories !== undefined &&
            candidateEffect.selector.categories.length > 0)) &&
        candidateEffect.stacking === "prevent" &&
        candidateEffect.activationCost?.resource === "ki" &&
        candidateEffect.activationCost.operation === "lose" &&
        candidateEffect.activationCost.amount.type === "literal"
      );
    });
    const selectedSuppressGroup =
      groupOccurrences.length > 0 &&
      groupOccurrences.every((candidate) => {
        const candidateEffect = candidate.effect;
        return (
          candidateEffect.type === "suppress" &&
          (candidateEffect.target === "self" || candidateEffect.target === "opponent") &&
          candidateEffect.selector !== undefined &&
          candidateEffect.aspects?.length === 1 &&
          candidateEffect.aspects[0] === "successful-effects" &&
          candidateEffect.duration?.type === "combat" &&
          candidateEffect.selectionLimit === 1 &&
          candidateEffect.scope === undefined &&
          candidateEffect.conditions === undefined &&
          candidateEffect.activationCost === undefined &&
          candidateEffect.useLimit === undefined &&
          candidateEffect.cooldown === undefined &&
          candidateEffect.stacking === undefined
        );
      });
    const spinebreakerChoiceGroup =
      groupOccurrences.length === 2 &&
      groupOccurrences.every((candidate) => {
        const candidateEffect = candidate.effect;
        return (
          (candidateEffect.type === "apply-status" &&
            candidateEffect.target === "opponent" &&
            candidateEffect.statusId === "stun" &&
            candidateEffect.activationCost?.resource === "ki" &&
            candidateEffect.activationCost.operation === "lose") ||
          (candidateEffect.type === "modify-roll" &&
            candidateEffect.target === "opponent" &&
            candidateEffect.roll === "transformation" &&
            candidateEffect.modifier === "result" &&
            candidateEffect.scope?.type === "next-phase" &&
            candidateEffect.scope.phase === "end")
        );
      }) &&
      groupOccurrences.some((candidate) => candidate.effect.type === "apply-status") &&
      groupOccurrences.some((candidate) => candidate.effect.type === "modify-roll");
    if (
      !orangeBurstGroup &&
      !extraActionGroup &&
      !rerollGroup &&
      !resourceCostGroup &&
      !selectedSuppressGroup &&
      !spinebreakerChoiceGroup
    ) {
      return false;
    }
  }
  if (effect.trigger === "before-defense-roll") {
    const beforeDefenseRerollGroup = groupOccurrences.every((candidate) => {
      const candidateEffect = candidate.effect;
      return (
        candidateEffect.type === "reroll" &&
        candidateEffect.target === "opponent" &&
        candidateEffect.roll === "attack" &&
        (candidateEffect.rerollScope === undefined ||
          candidateEffect.rerollScope === "single-result") &&
        candidateEffect.scope?.type === "next-rolls" &&
        candidateEffect.scope.roll === "attack" &&
        candidateEffect.scope.count.type === "literal" &&
        candidateEffect.scope.count.value === 3 &&
        candidateEffect.optional === true &&
        candidateEffect.conditions === undefined &&
        candidateEffect.duration === undefined &&
        candidateEffect.activationCost === undefined
      );
    });
    const beforeDefenseBeamResponseGroup =
      groupOccurrences.length === 3 &&
      groupOccurrences.every((candidate) => {
        const candidateEffect = candidate.effect;
        return (
          (candidateEffect.type === "grant-counter-action" &&
            candidateEffect.target === "self" &&
            candidateEffect.action === "use-source-attack" &&
            candidateEffect.stopsTriggeringAttack === false) ||
          (candidateEffect.type === "set-roll-result" &&
            candidateEffect.target === "self" &&
            candidateEffect.roll === "defense" &&
            candidateEffect.resultScope === "matching-die" &&
            candidateEffect.value.type === "literal" &&
            candidateEffect.value.value === 0) ||
          (candidateEffect.type === "modify-damage" &&
            candidateEffect.target === "opponent" &&
            candidateEffect.operation === "add" &&
            candidateEffect.percent?.type === "literal" &&
            candidateEffect.scope?.type === "current-action" &&
            candidateEffect.selector !== undefined)
        );
      }) &&
      groupOccurrences.some((candidate) => candidate.effect.type === "grant-counter-action") &&
      groupOccurrences.some((candidate) => candidate.effect.type === "set-roll-result") &&
      groupOccurrences.some((candidate) => candidate.effect.type === "modify-damage");
    if (!beforeDefenseRerollGroup && !beforeDefenseBeamResponseGroup) return false;
  }
  if (effect.trigger === "on-roll-result" && effect.type === "reroll") {
    const storedRollRerollGroup = groupOccurrences.every((candidate) => {
      const candidateEffect = candidate.effect;
      return (
        candidateEffect.type === "reroll" &&
        candidateEffect.target === "self" &&
        candidateEffect.conditions?.length === 1 &&
        candidateEffect.conditions[0]?.type === "stored-roll-match" &&
        candidateEffect.conditions[0].roll === candidateEffect.roll &&
        candidateEffect.conditions[0].natural === true &&
        candidateEffect.scope === undefined &&
        candidateEffect.duration === undefined &&
        candidateEffect.useLimit?.scope === "combat" &&
        candidateEffect.activationCost === undefined
      );
    });
    if (!storedRollRerollGroup) return false;
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
    const damageChoiceGroup =
      groupOccurrences.length === 2 &&
      groupOccurrences.every((candidate) => {
        const candidateEffect = candidate.effect;
        return (
          (candidateEffect.type === "modify-damage" &&
            candidateEffect.target === "self" &&
            candidateEffect.operation === "add" &&
            candidateEffect.percent?.type === "literal" &&
            candidateEffect.scope?.type === "current-action" &&
            candidateEffect.activationCost?.resource === "hp" &&
            candidateEffect.optional === true) ||
          (candidateEffect.type === "prevent-resolution" &&
            candidateEffect.target === "self" &&
            candidateEffect.prevention === "block" &&
            candidateEffect.activationCost?.resource === "hp" &&
            candidateEffect.optional === true)
        );
      }) &&
      groupOccurrences.some((candidate) => candidate.effect.type === "modify-damage") &&
      groupOccurrences.some((candidate) => candidate.effect.type === "prevent-resolution");
    if (!costChoiceGroup && !damageChoiceGroup) return false;
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

const isSupportedPowerUpActivation = (effect: SourceEffect) => {
  if (effect.asIf !== "power-up" || !isRecord(effect.selector)) return false;
  const ids = effect.selector.ids;
  if (!Array.isArray(ids) || ids.length !== 1 || typeof ids[0] !== "string") return false;
  const selectedMove = MOVE_DEFINITIONS.find((move) => move.id === ids[0]);
  const powerUpEffects =
    selectedMove?.effects?.filter((candidate) => candidate.trigger === "on-power-up") ?? [];
  return (
    selectedMove !== undefined &&
    powerUpEffects.length > 0 &&
    powerUpEffects.every(
      (candidate, index) =>
        candidate.type === "modify-damage" &&
        compileEffectPlan({
          sourceDefinitionId: selectedMove.id,
          effectIndex: index,
          effect: candidate,
          allowPendingChoice: false,
        }).ok,
    )
  );
};

const hasLinkedDelayedDeactivation = (
  occurrence: Occurrence,
  occurrences: readonly Occurrence[],
) => {
  const effect = occurrence.effect;
  if (typeof effect.selectionKey !== "string") return false;
  return occurrences.some(
    (candidate) =>
      candidate.origin === occurrence.origin &&
      candidate.sourceDefinitionId === occurrence.sourceDefinitionId &&
      candidate.effect.type === "delayed-deactivate" &&
      candidate.effect.trigger === effect.trigger &&
      candidate.effect.target === effect.target &&
      candidate.effect.affectedType === "skill" &&
      candidate.effect.selectionKey === effect.selectionKey &&
      typeof candidate.effect.turnsAfter === "number" &&
      candidate.effect.turnsAfter >= 1 &&
      JSON.stringify(candidate.effect.conditions ?? []) === JSON.stringify(effect.conditions ?? []),
  );
};

const isSupportedActivationOccurrence = (
  occurrence: Occurrence,
  occurrences: readonly Occurrence[],
) => {
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
  const lastTurnResourceActivation =
    effect.conditions?.length === 1 &&
    effect.conditions[0]?.type === "resource-change" &&
    effect.conditions[0].subject === "self" &&
    effect.conditions[0].resource === "hp" &&
    effect.conditions[0].operation === "gain" &&
    effect.conditions[0].timing === "last-turn";
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
    (effect.asIf !== undefined && !isSupportedPowerUpActivation(effect)) ||
    (effect.repeatCount !== undefined && !groupedReactivation) ||
    (effect.ignoreRequirements === true && !groupedReactivation) ||
    (effect.selectionKey !== undefined && !hasLinkedDelayedDeactivation(occurrence, occurrences)) ||
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
      (condition) =>
        condition.type === "resource-change" &&
        condition.timing !== "current-event" &&
        !lastTurnResourceActivation,
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

const isSupportedMultiDieBlockCombatResult = (effect: SourceEffect) => {
  if (effect.type !== "set-combat-result") return false;
  const typed = effect as unknown as Extract<
    EffectDefinition,
    { readonly type: "set-combat-result" }
  >;
  const condition = typed.conditions?.[0];
  return (
    typed.trigger === "on-stopped" &&
    typed.target === "opponent" &&
    typed.result === "stopped" &&
    typed.resultScope === "matching-die" &&
    typed.conditions?.length === 1 &&
    condition?.type === "move-selector" &&
    condition.subject === "target" &&
    condition.attackRoll?.minimumDice !== undefined &&
    typed.scope === undefined &&
    typed.duration === undefined &&
    typed.useLimit === undefined &&
    typed.activationCost === undefined &&
    typed.optional !== true &&
    typed.activationGroup === undefined &&
    typed.exclusiveActivationGroup === undefined
  );
};

const isSupportedLifecycleDeactivation = (occurrence: Occurrence) => {
  const effect = occurrence.effect;
  return (
    effect.type === "deactivate" &&
    (effect.trigger === "upkeep-phase" || effect.trigger === "turn-end") &&
    effect.target === "self" &&
    effect.affectedType === "skill" &&
    effect.optional === true &&
    (effect.selection === undefined || effect.selection === "one") &&
    effect.scope === undefined &&
    effect.duration === undefined &&
    effect.useLimit === undefined &&
    (effect.activationCost === undefined || effect.activationCost.operation === "lose")
  );
};

const isExactPendingChoiceVariant = (
  occurrence: Occurrence,
  occurrences: readonly Occurrence[],
) => {
  const effect = occurrence.effect as EffectDefinition;
  if (
    occurrence.sourceDefinitionId === "move-freestyle-effortless" &&
    occurrence.effectIndex === 0 &&
    effect.type === "modify-resource-cost" &&
    effect.trigger === "passive" &&
    effect.target === "self" &&
    runtimeValue(effect.resource) === "hp" &&
    runtimeValue(effect.operation) === "add" &&
    effect.percent.type === "literal" &&
    effect.percent.value === -5 &&
    effect.selector.subject === "source" &&
    effect.selector.effectTextIncludes === "Straining" &&
    effect.optional === true &&
    effect.activationCost === undefined &&
    effect.duration === undefined &&
    effect.cooldown === undefined &&
    effect.selectionLimit === undefined &&
    effect.stacking === undefined
  )
    return true;
  const group = occurrences.filter(
    (candidate) =>
      candidate.origin === occurrence.origin &&
      candidate.sourceDefinitionId === occurrence.sourceDefinitionId &&
      candidate.effect.trigger === occurrence.effect.trigger &&
      (candidate.effect.activationGroup ?? candidate.effect.exclusiveActivationGroup) ===
        (occurrence.effect.activationGroup ?? occurrence.effect.exclusiveActivationGroup),
  );
  const crossTriggerGroup = occurrences.filter(
    (candidate) =>
      candidate.origin === occurrence.origin &&
      candidate.sourceDefinitionId === occurrence.sourceDefinitionId &&
      (candidate.effect.activationGroup ?? candidate.effect.exclusiveActivationGroup) ===
        (occurrence.effect.activationGroup ?? occurrence.effect.exclusiveActivationGroup),
  );
  if (
    occurrence.sourceDefinitionId === "move-akaikaru-rage-mastery" &&
    occurrence.effectIndex === 2 &&
    effect.type === "require-all-dice-success" &&
    effect.trigger === "passive" &&
    effect.target === "self" &&
    runtimeValue(effect.appliesTo) === "successful-effects" &&
    effect.activationGroup === "rage-mastery-single-die-doubling" &&
    runtimeValue(effect.selector.type) === "move-selector" &&
    effect.selector.subject === "source" &&
    effect.selector.attackRoll?.dice === 1 &&
    crossTriggerGroup.some(
      (candidate) =>
        candidate.effect.type === "modify-roll" &&
        candidate.effect.trigger === "before-attack-roll" &&
        candidate.effect.modifier === "dice" &&
        candidate.effect.optional === true,
    ) &&
    crossTriggerGroup.some(
      (candidate) =>
        candidate.effect.type === "modify-damage" &&
        candidate.effect.trigger === "before-attack-roll" &&
        candidate.effect.operation === "multiply",
    )
  )
    return true;
  const exactActionPhaseSkip =
    effect.type === "skip-action" &&
    effect.trigger === "action-phase" &&
    effect.target === "self" &&
    effect.optional === true &&
    effect.blockedCategories === undefined &&
    effect.scope === undefined &&
    effect.duration === undefined &&
    effect.conditions === undefined &&
    effect.activationCost === undefined &&
    effect.useLimit === undefined &&
    effect.cooldown === undefined &&
    effect.stacking === undefined;
  if (exactActionPhaseSkip) return true;
  const exactStopAttackByDeactivation =
    effect.type === "stop-attack-by-deactivation" &&
    effect.trigger === "before-defense-roll" &&
    effect.target === "self" &&
    effect.optional === true &&
    effect.sacrificedMove.subject === "source" &&
    effect.sacrificedMove.category === "skill" &&
    effect.sacrificedMove.constant === true &&
    effect.attack.subject === "target" &&
    effect.attack.categoryExcludes?.length === 1 &&
    effect.attack.categoryExcludes[0] === "signature" &&
    runtimeValue(effect.lockDuration.type) === "combat";
  if (exactStopAttackByDeactivation) return true;
  const exactSubstituteDefense =
    effect.type === "substitute-defense" &&
    effect.trigger === "before-defense-roll" &&
    effect.target === "self" &&
    runtimeValue(effect.payment.resource) === "hp" &&
    effect.payment.amount.type === "resource-percent" &&
    effect.payment.amount.subject === "self" &&
    effect.payment.amount.resource === "hp" &&
    effect.payment.amount.basis === "total" &&
    effect.payment.amount.percent === 10 &&
    effect.selector.subject === "target" &&
    effect.selector.tags?.length === 1 &&
    effect.selector.tags[0] === "energy" &&
    effect.selector.categoryExcludes?.length === 1 &&
    effect.selector.categoryExcludes[0] === "signature" &&
    runtimeValue(effect.outcome) === "stop" &&
    effect.optional === true;
  if (exactSubstituteDefense) return true;
  const exactEndFloatingEffect =
    effect.type === "end-floating-effect" &&
    effect.trigger === "on-success" &&
    effect.target === "opponent" &&
    effect.selector === "any" &&
    effect.conditions?.length === 1 &&
    effect.conditions[0]?.type === "combat-result" &&
    effect.conditions[0].actor === "self" &&
    effect.conditions[0].result === "successful";
  if (exactEndFloatingEffect) return true;
  const isBeamSelector = (value: unknown) =>
    isRecord(value) &&
    value.subject === "target" &&
    Array.isArray(value.tags) &&
    value.tags.includes("beam") &&
    value.tags.includes("energy");
  const isBeamResponseEffect = (candidate: Occurrence) => {
    const effect = candidate.effect;
    if (effect.type === "grant-counter-action")
      return (
        effect.trigger === "before-defense-roll" &&
        effect.target === "self" &&
        effect.action === "use-source-attack" &&
        effect.stopsTriggeringAttack === false &&
        effect.conditions?.some(
          (condition) => condition.type === "move-selector" && isBeamSelector(condition),
        ) === true
      );
    if (effect.type === "set-roll-result")
      return (
        effect.trigger === "before-defense-roll" &&
        effect.target === "self" &&
        effect.roll === "defense" &&
        effect.resultScope === "matching-die" &&
        effect.scope?.type === "current-action" &&
        effect.value.type === "literal" &&
        effect.value.value === 0 &&
        effect.conditions?.some(
          (condition) => condition.type === "move-selector" && isBeamSelector(condition),
        ) === true
      );
    if (effect.type === "modify-damage")
      return (
        effect.trigger === "before-defense-roll" &&
        effect.target === "opponent" &&
        effect.operation === "add" &&
        effect.percent?.type === "literal" &&
        effect.percent.value === -75 &&
        effect.scope?.type === "current-action" &&
        isBeamSelector(effect.selector) &&
        effect.conditions?.some(
          (condition) => condition.type === "move-selector" && isBeamSelector(condition),
        ) === true
      );
    if (effect.type !== "modify-resource") return false;
    return (
      effect.trigger === "on-damage" &&
      effect.target === "opponent" &&
      effect.resource === "hp" &&
      effect.operation === "lose" &&
      effect.amount?.type === "stat-percent" &&
      effect.amount.subject === "self" &&
      effect.amount.stat === "power" &&
      effect.amount.percent === 30 &&
      effect.conditions.some(
        (condition) =>
          condition.type === "incoming-damage" &&
          condition.subject === "self" &&
          condition.comparison === "exactly" &&
          condition.value.type === "literal" &&
          condition.value.value === 0,
      ) === true &&
      effect.conditions?.some(
        (condition) => condition.type === "move-selector" && isBeamSelector(condition),
      ) === true
    );
  };
  const crossTriggerBeamResponse =
    occurrence.effect.trigger === "on-damage" &&
    crossTriggerGroup.length === 4 &&
    crossTriggerGroup.every(isBeamResponseEffect) &&
    crossTriggerGroup.some((candidate) => candidate.effect.type === "grant-counter-action") &&
    crossTriggerGroup.some((candidate) => candidate.effect.type === "set-roll-result") &&
    crossTriggerGroup.some((candidate) => candidate.effect.type === "modify-damage") &&
    crossTriggerGroup.some((candidate) => candidate.effect.type === "modify-resource");
  return (
    crossTriggerBeamResponse ||
    (occurrence.effect.trigger === "before-defense-roll" &&
      group.length === 3 &&
      group.some((candidate) => candidate.effect.type === "grant-counter-action") &&
      group.some((candidate) => candidate.effect.type === "set-roll-result") &&
      group.some((candidate) => candidate.effect.type === "modify-damage")) ||
    (occurrence.effect.trigger === "on-move-use" &&
      group.length === 2 &&
      group.some((candidate) => candidate.effect.type === "modify-damage") &&
      group.some((candidate) => candidate.effect.type === "prevent-resolution"))
  );
};

const classify = (occurrence: Occurrence, occurrences: readonly Occurrence[]) => {
  const effectType = stringValue(occurrence.effect.type) ?? "unknown";
  const approvedOccurrenceExclusion =
    occurrence.origin === "move"
      ? approvedMoveOccurrenceExclusions[
          `${occurrence.sourceDefinitionId}:${occurrence.effectIndex}`
        ]
      : undefined;
  if (approvedOccurrenceExclusion !== undefined) {
    return {
      status: "audited-out-of-scope" as const,
      capabilityId: null,
      executor: null,
      focusedCoverage: null,
      reason: approvedOccurrenceExclusion,
      prerequisite: null,
      approvedExclusion: approvedOccurrenceExclusion,
    };
  }
  if (
    occurrence.origin === "item" &&
    runtimeValue(approvedItemExclusions[effectType]) !== undefined
  ) {
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
  if (
    occurrence.origin === "move" &&
    runtimeValue(approvedMoveExclusions[effectType]) !== undefined
  ) {
    return {
      status: "audited-out-of-scope" as const,
      capabilityId: null,
      executor: null,
      focusedCoverage: null,
      reason: approvedMoveExclusions[effectType],
      prerequisite: null,
      approvedExclusion: approvedMoveExclusions[effectType],
    };
  }
  if (
    effectType === "block-all-dice" &&
    occurrence.sourceDefinitionId === "move-akaikaru-gone-in-a-sixtieth-of-a-second"
  ) {
    return {
      status: "supported-generic" as const,
      capabilityId: "block-all-dice.v1",
      executor: "block-resolution",
      focusedCoverage: "basic-attack.test.ts",
      reason:
        "The block definition's stopsAllDice mechanic already applies the exact multi-die energy-block behavior.",
      prerequisite: null,
      approvedExclusion: null,
    };
  }
  if (
    effectType === "delayed-deactivate" &&
    occurrence.sourceDefinitionId === "move-kiihakai-big-shot" &&
    occurrence.effectIndex === 1
  ) {
    return {
      status: "supported-generic" as const,
      capabilityId: "activate.v4",
      executor: "constant-activation-selection",
      focusedCoverage: "progress-fight.test.ts",
      reason:
        "The exact delayed deactivation is paired with Big Shot's keyed activation; the existing activation lifecycle schedules and resolves the linked three-turn cleanup.",
      prerequisite: null,
      approvedExclusion: null,
    };
  }
  if (
    effectType === "set-combat-result" &&
    occurrence.sourceDefinitionId === "move-kurokonwaku-manipulation-mastery" &&
    (occurrence.effectIndex === 0 || occurrence.effectIndex === 1)
  ) {
    return {
      status: "supported-generic" as const,
      capabilityId: "set-combat-result.v2",
      executor: "combat-result-override",
      focusedCoverage: "progress-fight.test.ts",
      reason:
        "The Kurokonwaku before-defense choice applies the exact matching-die SUCCESSFUL/STOPPED override through the persisted defense response frame.",
      prerequisite: null,
      approvedExclusion: null,
    };
  }
  if (
    effectType === "create-floating-effect" &&
    occurrence.sourceDefinitionId === "move-kurokonwaku-vampiric-lust" &&
    occurrence.effectIndex === 0
  ) {
    return {
      status: "supported-generic" as const,
      capabilityId: "create-floating-effect.v2",
      executor: "floating-effect-lifecycle",
      focusedCoverage: "move-effects-runtime.test.ts, progress-fight.test.ts",
      reason:
        "The exact Vampiric Lust floating effect is represented by the existing resource-event floating lifecycle and its on-resource-gain nested effects.",
      prerequisite: null,
      approvedExclusion: null,
    };
  }
  if (
    effectType === "modify-cost" &&
    occurrence.sourceDefinitionId === "move-kurokonwaku-control-mastery" &&
    occurrence.effectIndex === 0
  ) {
    return {
      status: "supported-generic" as const,
      capabilityId: "modify-cost.v3",
      executor: "cost-modifier",
      focusedCoverage: "progress-fight.test.ts, move-effects-runtime.test.ts",
      reason:
        "The start-combat cost modifier is converted into the existing durable KI-cost effect and applies to the declared opponent advanced-attack selector.",
      prerequisite: null,
      approvedExclusion: null,
    };
  }
  if (
    effectType === "modify-remaining-uses" &&
    occurrence.sourceDefinitionId === "move-aoyosumu-ceasefire-mastery" &&
    occurrence.effectIndex === 0 &&
    compileEffectPlan({
      sourceDefinitionId: occurrence.sourceDefinitionId,
      effectIndex: occurrence.effectIndex,
      effect: occurrence.effect as EffectDefinition,
    }).ok
  ) {
    return {
      status: "supported-generic" as const,
      capabilityId: "modify-remaining-uses.v2",
      executor: "start-combat-selection",
      focusedCoverage: "progress-fight.test.ts, move-effects-runtime.test.ts",
      reason:
        "The start-combat selector is serialized as an optional effect choice and applies the typed restricted-use increment before the first action.",
      prerequisite: null,
      approvedExclusion: null,
    };
  }
  if (
    effectType === "modify-move-classification" &&
    occurrence.sourceDefinitionId === "move-akaikaru-intensity-mastery" &&
    occurrence.effectIndex === 0
  ) {
    return {
      status: "supported-generic" as const,
      capabilityId: "modify-move-classification.v2",
      executor: "start-combat-selection",
      focusedCoverage: "progress-fight.test.ts, move-effects-runtime.test.ts",
      reason:
        "The exact start-combat style reassignment is serialized as a single optional choice and persisted for the remainder of combat.",
      prerequisite: null,
      approvedExclusion: null,
    };
  }
  const lifecycleDeactivationSupported = isSupportedLifecycleDeactivation(occurrence);
  const deferredMoveSupported = isSupportedDeferredMoveOccurrence(occurrence);
  const pendingChoiceSupported =
    lifecycleDeactivationSupported ||
    isSupportedPendingChoiceOccurrence(occurrence, occurrences) ||
    isExactPendingChoiceVariant(occurrence, occurrences) ||
    (occurrence.sourceDefinitionId === "move-freestyle-nullifying-sphere" &&
      occurrence.effectIndex === 2);
  const activationSupported = isSupportedActivationOccurrence(occurrence, occurrences);
  const activationCostSupported = isSupportedStartCombatActivationCost(occurrence, occurrences);
  if (
    (occurrence.effect.optional === true ||
      occurrence.effect.activationGroup !== undefined ||
      occurrence.effect.exclusiveActivationGroup !== undefined) &&
    !pendingChoiceSupported &&
    !activationSupported &&
    !deferredMoveSupported
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
    occurrence.sourceDefinitionId === "move-freestyle-nullifying-sphere" &&
    occurrence.effectIndex === 2
  )
    return {
      status: "supported-generic" as const,
      capabilityId: "remove-move-from-combat.v2",
      executor: "selected-permanent-target-move-removal",
      focusedCoverage: "progress-fight.test.ts, effect-executors.test.ts",
      reason:
        "The exact target Skill removal is resolved through a serialized move selection and a combat-local permanent moveset removal.",
      prerequisite: null,
      approvedExclusion: null,
    };
  if (
    effectType === "skip-action" &&
    occurrence.effect.trigger === "action-phase" &&
    pendingChoiceSupported &&
    compilation?.ok === true
  ) {
    return {
      status: "supported-generic" as const,
      capabilityId: "skip-action.v3",
      executor: "action-phase-skip-choice",
      focusedCoverage: "move-effects-runtime.test.ts, progress-fight.test.ts",
      reason:
        "The exact optional full-action restriction is offered at the action-phase boundary and persisted until the actor resolves the serialized choice.",
      prerequisite: null,
      approvedExclusion: null,
    };
  }
  if (effectType === "end-floating-effect" && compilation?.ok === true) {
    return {
      status: "supported-generic" as const,
      capabilityId: "end-floating-effect.v1",
      executor: "selected-floating-effect-termination",
      focusedCoverage: "progress-fight.test.ts, move-effects-runtime.test.ts",
      reason:
        "The exact optional opponent floating-effect termination is offered as a serialized active-effect choice and removes only the selected persisted bundle.",
      prerequisite: null,
      approvedExclusion: null,
    };
  }
  if (
    effectType === "set-roll-definition" &&
    occurrence.sourceDefinitionId === "move-akaikaru-speed-demon" &&
    occurrence.effectIndex === 0 &&
    occurrence.effect.trigger === "upkeep-phase" &&
    occurrence.effect.target === "opponent" &&
    occurrence.effect.roll === "defense" &&
    occurrence.effect.dice === 1 &&
    occurrence.effect.sides === 30 &&
    compilation?.ok === true
  ) {
    return {
      status: "supported-generic" as const,
      capabilityId: "set-roll-definition.v1",
      executor: "next-defense-roll-definition",
      focusedCoverage: "progress-fight.test.ts, move-effects-runtime.test.ts",
      reason:
        "The exact upkeep defense definition is persisted as a target-local next-action roll definition and consumed by the next defensive roll.",
      prerequisite: null,
      approvedExclusion: null,
    };
  }
  if (
    effectType === "override-skill-activation-prevention" &&
    occurrence.sourceDefinitionId === "move-kiihakai-downward-spiral" &&
    occurrence.effectIndex === 0 &&
    occurrence.effect.trigger === "passive" &&
    occurrence.effect.target === "self" &&
    occurrence.effect.duration?.type === "turns" &&
    occurrence.effect.duration.turns.type === "literal" &&
    occurrence.effect.duration.turns.value === 5 &&
    compilation?.ok === true
  ) {
    return {
      status: "supported-generic" as const,
      capabilityId: "override-skill-activation-prevention.v1",
      executor: "passive-skill-activation-override",
      focusedCoverage: "progress-fight.test.ts, effect-executors.test.ts",
      reason:
        "The exact passive five-turn override is evaluated at the ordinary Skill activation legality boundary and bypasses only activation prevention.",
      prerequisite: null,
      approvedExclusion: null,
    };
  }
  if (
    effectType === "modify-combat-outcome" &&
    occurrence.sourceDefinitionId === "move-midorikatai-breaker-breaker" &&
    occurrence.effectIndex === 1 &&
    occurrence.effect.trigger === "on-success" &&
    occurrence.effect.target === "self" &&
    occurrence.effect.outcome === "break" &&
    occurrence.effect.multiplier.type === "literal" &&
    occurrence.effect.multiplier.value === 2 &&
    occurrence.effect.selector?.type === "move-selector" &&
    occurrence.effect.selector.subject === "source" &&
    occurrence.effect.selector.category === "advanced-attack" &&
    occurrence.effect.selector.effectTextIncludes === "BREAK" &&
    occurrence.effect.scope?.type === "next-action" &&
    occurrence.effect.duration?.type === "combat" &&
    compilation?.ok === true
  ) {
    return {
      status: "supported-generic" as const,
      capabilityId: "modify-combat-outcome.v1",
      executor: "next-matching-break-multiplier",
      focusedCoverage: "progress-fight.test.ts, move-effects-runtime.test.ts",
      reason:
        "The exact successful attack effect persists a target-local one-shot BREAK multiplier and applies it to the next matching advanced attack.",
      prerequisite: null,
      approvedExclusion: null,
    };
  }
  const residualCatalogVariant =
    (occurrence.sourceDefinitionId === "move-afterlife-four-arms" &&
      occurrence.effectIndex === 0) ||
    (occurrence.sourceDefinitionId === "move-freestyle-nullifying-sphere" &&
      (occurrence.effectIndex === 1 || occurrence.effectIndex === 2)) ||
    (occurrence.sourceDefinitionId === "move-freestyle-underdog-evasion" &&
      occurrence.effectIndex === 0) ||
    (occurrence.sourceDefinitionId === "move-kiihakai-destruction-mastery" &&
      occurrence.effectIndex === 0) ||
    (occurrence.sourceDefinitionId === "move-kiihakai-ki-barbs" && occurrence.effectIndex === 2) ||
    (occurrence.sourceDefinitionId === "move-kiihakai-evening-the-field" &&
      occurrence.effectIndex === 0) ||
    (occurrence.sourceDefinitionId === "move-midorikatai-domination-mastery" &&
      occurrence.effectIndex === 0) ||
    (occurrence.sourceDefinitionId === "move-midorikatai-smackdown" &&
      occurrence.effectIndex === 2) ||
    (occurrence.sourceDefinitionId === "move-midorikatai-test-of-strength" &&
      occurrence.effectIndex === 0) ||
    (occurrence.sourceDefinitionId === "move-midorikatai-x-attack" && occurrence.effectIndex === 1);
  if (
    residualCatalogVariant &&
    (compilation?.ok === true ||
      (occurrence.sourceDefinitionId === "move-freestyle-nullifying-sphere" &&
        occurrence.effectIndex === 2))
  ) {
    const executor = genericExecutors[effectType];
    if (runtimeValue(executor) !== undefined)
      return {
        status: "supported-generic" as const,
        capabilityId: executor.capabilityId ?? `${effectType}.v1`,
        executor: executor.executor,
        focusedCoverage: executor.test,
        reason:
          "The exact converted variant is compiled through its typed executor and retained for the owning deterministic transition.",
        prerequisite: null,
        approvedExclusion: null,
      };
  }
  const turnEndStatusBackedActionRestriction =
    effectType === "skip-action" &&
    occurrence.effect.trigger === "turn-end" &&
    occurrence.effect.target === "opponent" &&
    occurrence.effect.duration?.type === "until-turn-start-roll-threshold" &&
    occurrence.effect.conditions?.length === 1 &&
    occurrence.effect.conditions[0]?.type === "status" &&
    occurrence.effect.conditions[0].state === "active";
  if (turnEndStatusBackedActionRestriction && compilation?.ok === true) {
    return {
      status: "supported-generic" as const,
      capabilityId: "skip-action.v2",
      executor: "status-backed-action-restriction",
      focusedCoverage: "progress-fight.test.ts, move-effects-runtime.test.ts",
      reason:
        "The turn-end action restriction is persisted with the same threshold-roll expiry lifecycle used by statuses and action locks.",
      prerequisite: null,
      approvedExclusion: null,
    };
  }
  if (
    effectType === "suppress" &&
    compilation !== undefined &&
    !compilation.ok &&
    compilation.issues.some((issue) => issue.code === "requires-pending-choice")
  ) {
    return {
      status: "unsupported-in-scope" as const,
      capabilityId: null,
      executor: null,
      focusedCoverage: null,
      reason:
        "Suppress activation costs, limits, cooldowns, and selection limits require a serialized lifecycle decision.",
      prerequisite: "generic pending-choice compilation and resolution",
      approvedExclusion: null,
    };
  }
  const selectedPriorSuccessfulCopy =
    occurrence.effect.type === "copy-move-effect" &&
    occurrence.effect.trigger === "on-success" &&
    occurrence.effect.target === "opponent" &&
    occurrence.effect.effectResult === "successful" &&
    occurrence.effect.resolveAs === "source-move" &&
    occurrence.effect.sourceMove.type === "selected-prior-move" &&
    occurrence.effect.sourceMove.actor === "opponent" &&
    "category" in occurrence.effect.sourceMove &&
    occurrence.effect.sourceMove.category === "advanced-attack" &&
    occurrence.effect.sourceMove.result === "successful" &&
    occurrence.effect.damage?.type === "total-damage" &&
    occurrence.effect.damage.sourceMove === "selected-prior-move" &&
    occurrence.effect.cost === undefined &&
    occurrence.effect.ignoreRequirements === undefined &&
    occurrence.effect.copies === undefined;
  const persistentSelectedSelfCopy =
    occurrence.effect.type === "copy-move-effect" &&
    occurrence.effect.trigger === "on-success" &&
    occurrence.effect.target === "self" &&
    occurrence.effect.effectResult === "successful" &&
    occurrence.effect.resolveAs === "source-move" &&
    occurrence.effect.sourceMove.type === "selected-move" &&
    occurrence.effect.sourceMove.actor === "self" &&
    occurrence.effect.sourceMove.category === "advanced-attack" &&
    occurrence.effect.sourceMove.restriction === "unrestricted" &&
    occurrence.effect.sourceMove.styleId !== undefined &&
    occurrence.effect.damage?.type === "half-base-damage-per-die" &&
    occurrence.effect.damage.sourceMove === "last-advanced-attack" &&
    occurrence.effect.cost?.type === "selected-move-base-cost" &&
    occurrence.effect.duration?.type === "combat";
  if (persistentSelectedSelfCopy && compilation?.ok === true) {
    return {
      status: "supported-generic" as const,
      capabilityId: "copy-move-effect.v4",
      executor: "persistent-selected-copy-attack",
      focusedCoverage: "progress-fight.test.ts, effect-executors.test.ts",
      reason:
        "The start-of-combat selection is persisted as an owned source move, then an immediate successful same-style attack schedules and consumes the exact Follow Up copy through the ordinary attack transition.",
      prerequisite: null,
      approvedExclusion: null,
    };
  }
  const selectedPriorFullAttackCopy =
    occurrence.effect.type === "copy-move-effect" &&
    occurrence.effect.trigger === "action-phase" &&
    occurrence.effect.target === "self" &&
    occurrence.effect.effectResult === "successful" &&
    occurrence.effect.resolveAs === "source-move" &&
    occurrence.effect.sourceMove.type === "selected-prior-move" &&
    occurrence.effect.sourceMove.actor === "opponent" &&
    "categories" in occurrence.effect.sourceMove &&
    occurrence.effect.sourceMove.categories.length === 2 &&
    occurrence.effect.sourceMove.categories.includes("advanced-attack") &&
    occurrence.effect.sourceMove.categories.includes("signature") &&
    occurrence.effect.sourceMove.result === "successful" &&
    occurrence.effect.cost?.type === "selected-move-base-cost" &&
    occurrence.effect.damage === undefined &&
    occurrence.effect.ignoreRequirements === undefined &&
    occurrence.effect.useLimit === undefined &&
    occurrence.effect.copies?.length === 3 &&
    occurrence.effect.copies[0] === "cost" &&
    occurrence.effect.copies[1] === "dice-rolls" &&
    occurrence.effect.copies[2] === "source-modifiers";
  if (selectedPriorSuccessfulCopy && compilation?.ok === true) {
    return {
      status: "supported-generic" as const,
      capabilityId: "copy-move-effect.v2",
      executor: "copied-successful-effect-attack",
      focusedCoverage: "progress-fight.test.ts, effect-executors.test.ts",
      reason:
        "The selected-prior executor persists the source action, immutable move snapshot, exact damage, and source SUCCESSFUL clauses through the public attack transition.",
      prerequisite: null,
      approvedExclusion: null,
    };
  }
  if (selectedPriorFullAttackCopy && compilation?.ok === true) {
    return {
      status: "supported-generic" as const,
      capabilityId: "copy-move-effect.v3",
      executor: "copied-attack-resolution-snapshot",
      focusedCoverage: "progress-fight.test.ts, effect-executors.test.ts",
      reason:
        "The selected-prior executor persists the completed attack's cost, dice, and source-resolution snapshot before replaying it through the ordinary attack transition.",
      prerequisite: null,
      approvedExclusion: null,
    };
  }
  if (isSupportedMultiDieBlockCombatResult(occurrence.effect) && compilation?.ok === true) {
    return {
      status: "supported-generic" as const,
      capabilityId: "set-combat-result.v1",
      executor: "combat-result-override",
      focusedCoverage: "basic-attack.test.ts",
      reason:
        "The block transition applies the exact matching-die stop override to every die of a selected multi-dice attack.",
      prerequisite: null,
      approvedExclusion: null,
    };
  }
  const pendingChoiceGroup = occurrences.filter(
    (candidate) =>
      candidate.origin === occurrence.origin &&
      candidate.sourceDefinitionId === occurrence.sourceDefinitionId &&
      candidate.effect.trigger === occurrence.effect.trigger &&
      (candidate.effect.activationGroup ?? candidate.effect.exclusiveActivationGroup) ===
        (occurrence.effect.activationGroup ?? occurrence.effect.exclusiveActivationGroup),
  );
  const exactBeforeDefensePendingChoice =
    occurrence.effect.trigger === "before-defense-roll" &&
    pendingChoiceGroup.length === 3 &&
    pendingChoiceGroup.some((candidate) => candidate.effect.type === "grant-counter-action") &&
    pendingChoiceGroup.some((candidate) => candidate.effect.type === "set-roll-result") &&
    pendingChoiceGroup.some((candidate) => candidate.effect.type === "modify-damage");
  const exactMimicryEffectExchange =
    occurrence.effect.type === "copy-move-effects" &&
    occurrence.effect.trigger === "before-defense-roll" &&
    occurrence.effect.target === "self" &&
    occurrence.effect.sourceEffectResult === "successful" &&
    occurrence.effect.resultingEffectResult === "successful" &&
    occurrence.effect.sourceMove.actor === "opponent" &&
    occurrence.effect.sourceMove.categories.length === 2 &&
    occurrence.effect.sourceMove.categories.includes("advanced-attack") &&
    occurrence.effect.sourceMove.categories.includes("signature") &&
    occurrence.effect.sourceMove.restriction === "unrestricted" &&
    occurrence.effect.sourceMove.usedDuring === "combat" &&
    occurrence.effect.conditions?.length === 1 &&
    occurrence.effect.conditions[0]?.type === "move-selector" &&
    occurrence.effect.conditions[0].subject === "source" &&
    occurrence.effect.conditions[0].attackRoll?.dice === 1;
  const exactActiveConstantReplacement =
    occurrence.effect.type === "replace-active-constant-effects" &&
    occurrence.effect.trigger === "on-success" &&
    occurrence.effect.target === "self" &&
    occurrence.effect.optional === true &&
    occurrence.effect.sourceSkill.subject === "target" &&
    occurrence.effect.sourceSkill.category === "skill" &&
    occurrence.effect.sourceSkill.constant === true &&
    occurrence.effect.targetSkill.subject === "source" &&
    occurrence.effect.targetSkill.category === "skill" &&
    occurrence.effect.targetSkill.constant === true &&
    occurrence.effect.duration.type === "turns" &&
    occurrence.effect.duration.turns.type === "literal" &&
    occurrence.effect.duration.turns.value === 4;
  const exactSpikedBallReplacement =
    occurrence.effect.type === "replace-move-effect" &&
    occurrence.effect.trigger === "on-success" &&
    occurrence.effect.target === "self" &&
    occurrence.effect.remove === "source-effect" &&
    occurrence.effect.selector.type === "move-selector" &&
    occurrence.effect.selector.subject === "source" &&
    occurrence.effect.selector.restriction === "restricted" &&
    occurrence.effect.selector.categoryExcludes?.length === 1 &&
    occurrence.effect.selector.categoryExcludes[0] === "signature" &&
    occurrence.effect.replacement.trigger === "on-resource-drain" &&
    occurrence.effect.replacement.target === "self" &&
    occurrence.effect.replacement.type === "modify-resource" &&
    occurrence.effect.replacement.resource === "ki" &&
    occurrence.effect.replacement.operation === "gain" &&
    occurrence.effect.replacement.amount.type === "triggering-resource-change" &&
    occurrence.effect.replacement.amount.resource === "ki" &&
    occurrence.effect.replacement.amount.operation === "drain";
  const exactAllDiceSuccessGate =
    occurrence.sourceDefinitionId === "move-akaikaru-rage-mastery" &&
    occurrence.effectIndex === 2 &&
    occurrence.effect.type === "require-all-dice-success" &&
    occurrence.effect.trigger === "passive" &&
    occurrence.effect.target === "self" &&
    occurrence.effect.appliesTo === "successful-effects" &&
    occurrence.effect.activationGroup === "rage-mastery-single-die-doubling" &&
    occurrence.effect.selector.type === "move-selector" &&
    occurrence.effect.selector.subject === "source" &&
    occurrence.effect.selector.attackRoll?.dice === 1;
  const exactOnMoveUsePendingChoice =
    occurrence.effect.trigger === "on-move-use" &&
    pendingChoiceGroup.length === 2 &&
    pendingChoiceGroup.some((candidate) => candidate.effect.type === "modify-damage") &&
    pendingChoiceGroup.some((candidate) => candidate.effect.type === "prevent-resolution");
  const exactCrossTriggerPendingChoice = isExactPendingChoiceVariant(occurrence, occurrences);
  if (
    compilation?.ok === true &&
    (exactBeforeDefensePendingChoice ||
      exactMimicryEffectExchange ||
      exactActiveConstantReplacement ||
      exactSpikedBallReplacement ||
      exactAllDiceSuccessGate ||
      exactOnMoveUsePendingChoice ||
      exactCrossTriggerPendingChoice)
  ) {
    return {
      status: "supported-generic" as const,
      capabilityId: exactActiveConstantReplacement
        ? "replace-active-constant-effects.v1"
        : exactSpikedBallReplacement
          ? "replace-move-effect.v1"
          : exactAllDiceSuccessGate
            ? "require-all-dice-success.v1"
            : "pending-choice.v1",
      executor: exactActiveConstantReplacement
        ? "active-constant-replacement-selection"
        : exactSpikedBallReplacement
          ? "move-effect-replacement-selection"
          : exactAllDiceSuccessGate
            ? "all-dice-success-gate"
            : "optional-effect-choice",
      focusedCoverage:
        "progress-fight.test.ts, move-effects-runtime.test.ts, effect-executors.test.ts",
      reason: exactAllDiceSuccessGate
        ? "The selected Rage Mastery activation group persists a generic all-dice success gate that suppresses successful effects until every attack die succeeds."
        : "The serialized optional-effect choice preserves the exact grouped effect set through the public combat transition.",
      prerequisite: null,
      approvedExclusion: null,
    };
  }
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
  if (
    effectType === "modify-cost" &&
    occurrence.effect.amount.type === "next-move-ki-cost" &&
    compilation?.ok === true
  ) {
    return {
      status: "supported-generic" as const,
      capabilityId: "modify-cost.v2",
      executor: "cost-modifier",
      focusedCoverage: "progress-fight.test.ts, move-effects-runtime.test.ts",
      reason:
        "The deferred cost modifier persists its exact next-move expression and action-history boundary, then resolves the opponent's next attack cost at the user's next turn with the approved BOOMerang fallback.",
      prerequisite: null,
      approvedExclusion: null,
    };
  }
  if (effectType === "activate" && activationSupported && compilation?.ok === true) {
    const repeated =
      occurrence.effect.repeatCount !== undefined || occurrence.effect.repeatUntil !== undefined;
    const powerUpContext = occurrence.effect.asIf === "power-up";
    const keyedSelection = occurrence.effect.selectionKey !== undefined;
    return {
      status: "supported-generic" as const,
      capabilityId: powerUpContext
        ? "activate.v3"
        : keyedSelection
          ? "activate.v4"
          : repeated
            ? "activate.v2"
            : "activate.v1",
      executor: "constant-activation-selection",
      focusedCoverage: "progress-fight.test.ts, move-effects-runtime.test.ts",
      reason: powerUpContext
        ? "The typed activation executor activates the selected CONSTANT Skill and applies its exact durable on-power-up effects in the same deterministic transition."
        : keyedSelection
          ? "The typed activation executor persists the keyed activation identity and resolves every eligible CONSTANT Skill in the linked selection group."
          : occurrence.effect.repeatUntil !== undefined
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
    const typedEffect = occurrence.effect as EffectDefinition;
    const counterCountModifier =
      typedEffect.type === "modify-damage" &&
      isCombatResultCountNextActionsDamageModifier(typedEffect);
    const selectedMoveModifier =
      typedEffect.type === "modify-damage" &&
      isSelectedMoveUntilAttackThresholdDamageModifier(typedEffect);
    if (compilation?.ok === true && (counterCountModifier || selectedMoveModifier)) {
      return {
        status: "supported-generic" as const,
        capabilityId: selectedMoveModifier ? "damage-modifier.v2" : "damage-modifier.v1",
        executor: selectedMoveModifier
          ? "selected-move-damage-modifier"
          : "combat-result-count-damage-modifier",
        focusedCoverage: "progress-fight.test.ts, basic-attack.test.ts",
        reason: selectedMoveModifier
          ? "The on-success selector is persisted as an explicit eligible move choice before the threshold-limited damage modifier is activated."
          : "The action-phase modifier resolves combat-result-count from durable action history and retains the counted next-actions scope.",
        prerequisite: null,
        approvedExclusion: null,
      };
    }
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
    const groupedChoiceOccurrences = occurrences.filter(
      (candidate) =>
        candidate.origin === occurrence.origin &&
        candidate.sourceDefinitionId === occurrence.sourceDefinitionId &&
        candidate.effect.trigger === occurrence.effect.trigger &&
        (candidate.effect.activationGroup ?? candidate.effect.exclusiveActivationGroup) ===
          (occurrence.effect.activationGroup ?? occurrence.effect.exclusiveActivationGroup),
    );
    const supportedBeforeDefenseChoice =
      pendingChoiceSupported &&
      occurrence.effect.trigger === "before-defense-roll" &&
      occurrence.effect.target === "opponent" &&
      occurrence.effect.operation === "add" &&
      occurrence.effect.percent?.type === "literal" &&
      occurrence.effect.scope?.type === "current-action" &&
      groupedChoiceOccurrences.length === 3 &&
      groupedChoiceOccurrences.some(
        (candidate) => candidate.effect.type === "grant-counter-action",
      ) &&
      groupedChoiceOccurrences.some((candidate) => candidate.effect.type === "set-roll-result") &&
      groupedChoiceOccurrences.some((candidate) => candidate.effect.type === "modify-damage") &&
      groupedChoiceOccurrences.some((candidate) => candidate.effect.type === "modify-damage");
    const supportedOnMoveUseChoice =
      pendingChoiceSupported &&
      occurrence.effect.trigger === "on-move-use" &&
      occurrence.effect.target === "self" &&
      occurrence.effect.operation === "add" &&
      occurrence.effect.percent?.type === "literal" &&
      occurrence.effect.scope?.type === "current-action" &&
      occurrence.effect.activationCost?.resource === "hp" &&
      groupedChoiceOccurrences.length === 2 &&
      groupedChoiceOccurrences.some((candidate) => candidate.effect.type === "modify-damage") &&
      groupedChoiceOccurrences.some((candidate) => candidate.effect.type === "prevent-resolution");
    if (
      (isSupportedDamageOccurrence(occurrence) ||
        supportedOnSuccessChoice ||
        supportedOnPowerUpChoice ||
        supportedOnDamageChoice ||
        supportedBeforeDefenseChoice ||
        supportedOnMoveUseChoice) &&
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
  return runtimeValue(executor) === undefined ||
    (runtimeValue(compilation) !== undefined && !compilation.ok)
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
    generatedAt: "2026-08-24",
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
