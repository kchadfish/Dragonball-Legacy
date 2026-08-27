import type { EffectCondition, EffectDefinition } from "@dragonball-resurgence/game-data";

/** Combat points whose move effects are owned by the unified dispatcher. */
export const combatTriggers = [
  "action-phase",
  "after-defense-roll",
  "before-attack-roll",
  "before-defense-roll",
  "passive",
  "on-stopped",
  "on-success",
  "on-combat-result",
  "on-damage",
  "on-deactivated",
  "on-move-use",
  "on-cost-modified",
  "on-power-up",
  "on-resource-gain",
  "on-resource-drain",
  "on-resource-threshold",
  "on-roll-modified",
  "on-roll-result",
  "start-combat",
  "upkeep-phase",
  "turn-end",
] as const satisfies readonly EffectDefinition["trigger"][];

export type CombatTrigger = (typeof combatTriggers)[number];

export type ConditionContextFact =
  | "durable-fight"
  | "current-move"
  | "rolls"
  | "paid-cost"
  | "incoming-damage"
  | "defense-response"
  | "resource-change"
  | "combat-outcome"
  | "roll-modification"
  | "stored-rolls"
  | "stored-selections";

export interface ConditionExecutorCapability {
  readonly context: "durable" | "resolution-local" | "stored";
  readonly requiredFacts: readonly ConditionContextFact[];
  readonly allowedTriggers: readonly CombatTrigger[];
}

const everyTrigger = combatTriggers;
const rollTriggers = [
  "action-phase",
  "before-attack-roll",
  "before-defense-roll",
  "after-defense-roll",
  "on-stopped",
  "on-success",
  "on-damage",
  "on-roll-result",
  "passive",
] as const satisfies readonly CombatTrigger[];
const moveTriggers = [
  "action-phase",
  "after-defense-roll",
  "before-attack-roll",
  "before-defense-roll",
  "passive",
  "on-stopped",
  "on-success",
  "on-damage",
  "on-move-use",
  "on-roll-result",
] as const satisfies readonly CombatTrigger[];

const capability = (
  context: ConditionExecutorCapability["context"],
  requiredFacts: readonly ConditionContextFact[],
  allowedTriggers: readonly CombatTrigger[] = everyTrigger,
): ConditionExecutorCapability => ({ context, requiredFacts, allowedTriggers });

/**
 * Compiler and runtime share this exhaustive registry. Adding a condition to
 * game-data therefore requires an explicit context and trigger decision here.
 */
export const conditionExecutorCapabilities = {
  "combat-result": capability("durable", ["durable-fight"]),
  "combat-outcome": capability("durable", ["durable-fight"], ["passive", "on-combat-result"]),
  "roll-threshold": capability("resolution-local", ["rolls"], rollTriggers),
  "perfect-roll": capability("resolution-local", ["rolls"], rollTriggers),
  "roll-comparison": capability("resolution-local", ["rolls"], rollTriggers),
  "roll-die-result": capability("resolution-local", ["rolls"], rollTriggers),
  "roll-die-threshold": capability("resolution-local", ["rolls"], rollTriggers),
  "roll-modification": capability("resolution-local", ["roll-modification"], ["on-roll-modified"]),
  "stored-roll-match": capability("stored", ["stored-rolls", "rolls"], ["on-roll-result"]),
  "stored-roll-threshold": capability("stored", ["durable-fight"], everyTrigger),
  "stored-move-selection": capability("stored", ["durable-fight"], everyTrigger),
  "move-selector": capability("resolution-local", ["current-move"], moveTriggers),
  moveset: capability("durable", ["durable-fight"]),
  "moveset-move-count": capability("durable", ["durable-fight"]),
  "prior-action": capability("durable", ["durable-fight"]),
  "no-prior-action": capability("durable", ["durable-fight"]),
  "action-sequence": capability("durable", ["durable-fight"]),
  "active-move-count": capability("durable", ["durable-fight"]),
  "prior-turn-restriction": capability("durable", ["durable-fight"]),
  location: capability("durable", ["durable-fight"]),
  "target-relation": capability("stored", ["durable-fight"]),
  status: capability("durable", ["durable-fight"]),
  "move-effect-active": capability("durable", ["durable-fight"]),
  "move-effect-inactive": capability("durable", ["durable-fight"]),
  "activation-unavailable": capability("stored", ["durable-fight"]),
  "incoming-damage": capability(
    "resolution-local",
    ["incoming-damage"],
    ["on-damage", "on-success"],
  ),
  "successful-hit-count": capability("resolution-local", ["durable-fight"], rollTriggers),
  "stopped-hit-fraction": capability("resolution-local", ["rolls"], ["on-stopped"]),
  "attack-roll-resolution": capability(
    "resolution-local",
    ["rolls"],
    ["on-stopped", "on-success", "passive"],
  ),
  "move-use-count": capability("durable", ["durable-fight", "current-move"], moveTriggers),
  "defense-response": capability("resolution-local", ["defense-response"], ["on-stopped"]),
  "combat-state": capability("durable", ["durable-fight"]),
  "combat-context": capability("durable", ["durable-fight"]),
  "combat-turn": capability("durable", ["durable-fight"]),
  "transformation-mastery": capability("durable", ["durable-fight"]),
  "resource-threshold": capability("durable", ["durable-fight"]),
  "resource-comparison": capability("durable", ["durable-fight"]),
  "resource-change": capability(
    "resolution-local",
    ["durable-fight"],
    ["on-resource-gain", "on-resource-drain", "on-stopped", "on-success", "passive"],
  ),
  "move-modification": capability(
    "resolution-local",
    ["current-move"],
    ["passive", "on-cost-modified"],
  ),
  "stat-comparison": capability("durable", ["durable-fight"]),
  "level-comparison": capability("durable", ["durable-fight"]),
  "paid-ki-cost": capability("resolution-local", ["paid-cost"], ["on-success", "passive"]),
} satisfies Record<EffectCondition["type"], ConditionExecutorCapability>;

export const conditionCapabilityFor = (condition: EffectCondition) =>
  conditionExecutorCapabilities[condition.type];

export const conditionIsAvailableAtTrigger = (
  condition: EffectCondition,
  trigger: EffectDefinition["trigger"],
): trigger is CombatTrigger =>
  combatTriggers.includes(trigger as CombatTrigger) &&
  conditionCapabilityFor(condition).allowedTriggers.includes(trigger as CombatTrigger);

export const missingConditionContextFacts = (
  condition: EffectCondition,
  availableFacts: ReadonlySet<ConditionContextFact>,
): readonly ConditionContextFact[] =>
  conditionCapabilityFor(condition).requiredFacts.filter((fact) => !availableFacts.has(fact));
