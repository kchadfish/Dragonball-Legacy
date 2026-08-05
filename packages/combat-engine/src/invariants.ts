import { GLOBAL_RULES } from "@dragonball-resurgence/game-config";

import { activeEffectIdSchema, combatantIdSchema } from "./ids.js";
import type {
  CombatResources,
  CombatantState,
  FightState,
  FightStateInvariantViolation,
} from "./contracts.js";

const validCounter = (value: number, minimum: number) =>
  Number.isFinite(value) && Number.isInteger(value) && value >= minimum;

const validNonnegativeNumber = (value: number) => Number.isFinite(value) && value >= 0;

const addViolation = (
  violations: FightStateInvariantViolation[],
  type: FightStateInvariantViolation["type"],
  message: string,
  subject?: string,
) => {
  violations.push({ type, message, ...(subject === undefined ? {} : { subject }) });
};

const validateResource = (
  resourceName: "hitPoints" | "ki",
  resource: CombatResources,
  combatantId: string,
  violations: FightStateInvariantViolation[],
) => {
  if (!Number.isFinite(resource.maximum) || resource.maximum <= 0) {
    addViolation(
      violations,
      "invalid-resource",
      `${resourceName} maximum must be a finite positive number.`,
      combatantId,
    );
  }

  if (
    !Number.isFinite(resource.current) ||
    resource.current < 0 ||
    resource.current > resource.maximum
  ) {
    addViolation(
      violations,
      "invalid-resource",
      `${resourceName} current value must be finite and within its maximum.`,
      combatantId,
    );
  }
};

const validateCombatant = (
  recordId: string,
  combatant: CombatantState,
  violations: FightStateInvariantViolation[],
) => {
  if (!combatantIdSchema.safeParse(recordId).success || combatant.id !== recordId) {
    addViolation(
      violations,
      "invalid-combatant-identity",
      "Each combatant record key must be a valid combatant ID matching its state ID.",
      recordId,
    );
  }

  validateResource("hitPoints", combatant.hitPoints, recordId, violations);
  validateResource("ki", combatant.ki, recordId, violations);

  for (const [statName, statValue] of Object.entries(combatant.stats)) {
    const validStat =
      statName === "dexterityBonus"
        ? Number.isFinite(statValue) &&
          statValue >= GLOBAL_RULES.combat.minimumDexterityBonus &&
          statValue <= GLOBAL_RULES.combat.maximumDexterityBonus
        : validNonnegativeNumber(statValue);
    if (!validStat) {
      addViolation(
        violations,
        "invalid-stat",
        statName === "dexterityBonus"
          ? `dexterityBonus must be a finite number from ${GLOBAL_RULES.combat.minimumDexterityBonus} through ${GLOBAL_RULES.combat.maximumDexterityBonus}.`
          : `${statName} must be a finite nonnegative number.`,
        recordId,
      );
    }
  }

  if (new Set(combatant.moveIds).size !== combatant.moveIds.length) {
    addViolation(
      violations,
      "invalid-combatant-identity",
      "Combatant move IDs must not contain duplicates.",
      recordId,
    );
  }
};

/**
 * Checks the invariants shared by all current initial 1v1 fight states. This
 * remains internal so future transition functions cannot emit a corrupt state.
 */
export const validateFightState = (state: FightState): readonly FightStateInvariantViolation[] => {
  const violations: FightStateInvariantViolation[] = [];
  const combatantEntries = Object.entries(state.combatants);

  if (!validCounter(state.version, 0)) {
    addViolation(
      violations,
      "invalid-state-counter",
      "State version must be a nonnegative integer.",
    );
  }
  if (!validCounter(state.eventSequence, 0)) {
    addViolation(
      violations,
      "invalid-state-counter",
      "Event sequence must be a nonnegative integer.",
    );
  }
  if (!validCounter(state.turnNumber, 1)) {
    addViolation(violations, "invalid-state-counter", "Turn number must be a positive integer.");
  }
  if (!state.rulesVersion.value || !state.rulesVersion.sourcePath) {
    addViolation(
      violations,
      "invalid-rules-version",
      "Fight state must retain a rules version and source path.",
    );
  }
  if (combatantEntries.length !== 2) {
    addViolation(
      violations,
      "invalid-combatant-count",
      "The initial combat engine scope supports exactly two combatants.",
    );
  }

  for (const [recordId, combatant] of combatantEntries) {
    validateCombatant(recordId, combatant, violations);
  }
  const activeEffectIds = new Set<string>();
  for (const effect of state.activeEffects) {
    const source = state.combatants[effect.sourceCombatantId];
    const target = state.combatants[effect.targetCombatantId];
    const validEffect =
      activeEffectIdSchema.safeParse(effect.id).success &&
      !activeEffectIds.has(effect.id) &&
      source?.status === "active" &&
      target?.status === "active" &&
      effect.type === "modify-ki-cost" &&
      effect.scope === "next-eligible-action" &&
      effect.selector.category === "advanced-attack" &&
      Number.isFinite(effect.selector.baseKiCost) &&
      effect.selector.baseKiCost >= 0 &&
      Number.isFinite(effect.amount) &&
      effect.sourceDefinitionId.length > 0;
    if (!validEffect) {
      addViolation(
        violations,
        "invalid-combatant-identity",
        "Active effects must have unique valid IDs, active combatant references, and valid selectors.",
        effect.id,
      );
    }
    activeEffectIds.add(effect.id);
  }

  if (state.status === "active") {
    const activeCombatant = state.combatants[state.activeCombatantId];
    if (activeCombatant?.status !== "active") {
      addViolation(
        violations,
        "invalid-active-combatant",
        "An active fight must identify an active combatant.",
        state.activeCombatantId,
      );
    }
    if (
      Object.values(state.combatants).filter((combatant) => combatant.status === "active")
        .length !== 2
    ) {
      addViolation(
        violations,
        "invalid-active-combatant",
        "An active fight in the initial 1v1 scope must have two active combatants.",
      );
    }

    if (state.pendingDecision !== undefined) {
      const pendingCombatant = state.combatants[state.pendingDecision.combatantId];
      if (
        state.pendingDecision.stateVersion !== state.version ||
        pendingCombatant?.status !== "active" ||
        state.pendingDecision.options.length === 0 ||
        new Set(state.pendingDecision.options.map((option) => option.id)).size !==
          state.pendingDecision.options.length
      ) {
        addViolation(
          violations,
          "invalid-pending-decision",
          "A pending decision must target an active combatant, match the state version, and have unique options.",
          state.pendingDecision.id,
        );
      }
    }
  } else {
    const { completion } = state;
    const winner = completion.winnerCombatantId;
    if (
      ((completion.type === "defeat" || completion.type === "surrender") && winner === undefined) ||
      (winner !== undefined && state.combatants[winner] === undefined)
    ) {
      addViolation(
        violations,
        "invalid-completion",
        "Completed defeat and surrender fights require an existing winner.",
      );
    }
  }

  return violations;
};
