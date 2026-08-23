import { GLOBAL_RULES } from "@dragonball-resurgence/game-config";
import { MOVE_DEFINITIONS } from "@dragonball-resurgence/game-data";

import {
  activeEffectIdSchema,
  combatDecisionIdSchema,
  combatantIdSchema,
  pendingDecisionIdSchema,
  resolutionFrameIdSchema,
} from "./ids.js";
import type { CombatantId } from "./ids.js";
import type {
  ActiveFightState,
  ActiveCombatEffect,
  ActiveCostModifierEffect,
  CombatActionRecord,
  CombatResources,
  CombatantState,
  CompletedFightState,
  CounterActionReference,
  FightState,
  FightStateInvariantViolation,
  ResolutionFrame,
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

const validateCombatantStats = (
  combatant: CombatantState,
  recordId: string,
  violations: FightStateInvariantViolation[],
) => {
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
  if (
    combatant.specializationPoints !== undefined &&
    !validNonnegativeNumber(combatant.specializationPoints)
  ) {
    addViolation(
      violations,
      "invalid-stat",
      "specializationPoints must be a finite nonnegative number.",
      recordId,
    );
  }
};

const combatSlots = ["mastery", "skill", "advanced-attack", "signature", "block"] as const;

const validateSlotCapacities = (
  combatant: CombatantState,
  recordId: string,
  violations: FightStateInvariantViolation[],
) => {
  if (combatant.slotCapacities !== undefined) {
    for (const slot of combatSlots) {
      const capacity = combatant.slotCapacities[slot];
      if (!validCounter(capacity, 0)) {
        addViolation(
          violations,
          "invalid-slot-capacity",
          `Slot capacity for ${slot} must be a nonnegative integer.`,
          recordId,
        );
      }
    }
  }
  for (const modification of combatant.slotCapacityModifications ?? []) {
    const sourceMove = MOVE_DEFINITIONS.find(
      (candidate) => candidate.id === modification.sourceDefinitionId,
    );
    const sourceEffect = sourceMove?.effects?.[modification.sourceEffectIndex];
    if (
      modification.sourceCombatantId !== combatant.id ||
      !combatant.moveIds.includes(modification.sourceDefinitionId) ||
      sourceEffect?.type !== "modify-slot-capacity" ||
      sourceEffect.slot !== modification.slot ||
      sourceEffect.amount.type !== "literal" ||
      sourceEffect.amount.value !== modification.amount ||
      !validCounter(modification.sourceEffectIndex, 0) ||
      !Number.isInteger(modification.amount) ||
      modification.amount === 0
    ) {
      addViolation(
        violations,
        "invalid-slot-capacity",
        "Slot capacity applications must reference an owned declarative modifier with matching provenance and amount.",
        recordId,
      );
    }
  }
};

const validateMoveUses = (
  combatant: CombatantState,
  recordId: string,
  violations: FightStateInvariantViolation[],
) => {
  for (const [moveId, useCount] of Object.entries(combatant.moveUses)) {
    if (!combatant.moveIds.includes(moveId) || !validCounter(useCount, 1)) {
      addViolation(
        violations,
        "invalid-use-count",
        "Move use counts must be positive integers for moves owned by the combatant.",
        recordId,
      );
    }
  }
};

const validateMoveUseLimitModifiers = (
  combatant: CombatantState,
  recordId: string,
  violations: FightStateInvariantViolation[],
) => {
  for (const [moveId, modifier] of Object.entries(combatant.moveUseLimitModifiers ?? {})) {
    const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === moveId);
    if (
      !combatant.moveIds.includes(moveId) ||
      move?.mechanics.restrictedUses?.type !== "literal" ||
      !validCounter(modifier, 1)
    ) {
      addViolation(
        violations,
        "invalid-combatant-state",
        "Move-use limit modifiers must be positive integers for owned, canonically restricted moves.",
        recordId,
      );
    }
  }
};

const validateEffectUseCounts = (
  combatant: CombatantState,
  recordId: string,
  violations: FightStateInvariantViolation[],
) => {
  for (const [effectKey, useCount] of Object.entries(combatant.effectUseCounts ?? {})) {
    if (effectKey.length === 0 || !validCounter(useCount, 1)) {
      addViolation(
        violations,
        "invalid-combatant-state",
        "Effect use counts must be positive integers keyed by a declarative effect.",
        recordId,
      );
    }
  }
};

const validateItemUses = (
  combatant: CombatantState,
  recordId: string,
  violations: FightStateInvariantViolation[],
) => {
  for (const [itemId, useCount] of Object.entries(combatant.itemUses ?? {})) {
    if (!combatant.itemIds?.includes(itemId) || !validCounter(useCount, 1)) {
      addViolation(
        violations,
        "invalid-use-count",
        "Item use counts must be positive integers for items owned by the combatant.",
        recordId,
      );
    }
  }
};

const storedRollKeyPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const validateStoredRolls = (
  combatant: CombatantState,
  recordId: string,
  turnNumber: number,
  violations: FightStateInvariantViolation[],
) => {
  for (const [storageKey, storedRoll] of Object.entries(combatant.storedRolls ?? {})) {
    const sourceMove = MOVE_DEFINITIONS.find(
      (candidate) => candidate.id === storedRoll.sourceDefinitionId,
    );
    const sourceEffect = sourceMove?.effects?.find(
      (effect) => effect.type === "roll-and-store" && effect.storageKey === storageKey,
    );
    const validSourceEffect =
      sourceEffect?.type === "roll-and-store" && sourceEffect.target === "self";
    const validResults =
      storedRoll.naturalResults.length > 0 &&
      storedRoll.naturalResults.every(
        (result) => Number.isInteger(result) && result >= 1 && result <= storedRoll.sides,
      );
    if (
      storedRoll.storageKey !== storageKey ||
      !storedRollKeyPattern.test(storageKey) ||
      !combatant.moveIds.includes(storedRoll.sourceDefinitionId) ||
      !validSourceEffect ||
      storedRoll.naturalResults.length !==
        (sourceEffect?.type === "roll-and-store" ? sourceEffect.dice : 0) ||
      !Number.isInteger(storedRoll.sides) ||
      storedRoll.sides < 1 ||
      !validResults ||
      !validCounter(storedRoll.storedOnTurn, 1) ||
      storedRoll.storedOnTurn > turnNumber
    ) {
      addViolation(
        violations,
        "invalid-combatant-state",
        "Stored rolls must match an owned declarative roll, use a stable key, and contain bounded natural results from a completed combat turn.",
        recordId,
      );
    }
  }
};

const validateStoredMoveSelections = (
  combatant: CombatantState,
  recordId: string,
  turnNumber: number,
  violations: FightStateInvariantViolation[],
) => {
  for (const [selectionKey, selection] of Object.entries(combatant.storedMoveSelections ?? {})) {
    const sourceMove = MOVE_DEFINITIONS.find(
      (candidate) => candidate.id === selection.sourceDefinitionId,
    );
    const sourceEffect = sourceMove?.effects?.find(
      (effect) =>
        effect.type === "select-move-by-stored-roll" && effect.selectionKey === selectionKey,
    );
    const selectedMove = MOVE_DEFINITIONS.find((candidate) => candidate.id === selection.moveId);
    const validSourceEffect =
      sourceEffect?.type === "select-move-by-stored-roll" &&
      sourceEffect.target === "self" &&
      combatant.moveIds.includes(selection.sourceDefinitionId) &&
      sourceEffect.storageKey.length > 0;
    if (
      selection.selectionKey !== selectionKey ||
      !storedRollKeyPattern.test(selectionKey) ||
      !validSourceEffect ||
      selectedMove === undefined ||
      !combatant.moveIds.includes(selectedMove.id) ||
      !validCounter(selection.selectedOnTurn, 1) ||
      selection.selectedOnTurn > turnNumber
    ) {
      addViolation(
        violations,
        "invalid-combatant-state",
        "Stored move selections must match an owned declarative selector, use a stable key, and reference an owned move from a completed combat turn.",
        recordId,
      );
    }
  }
};

const hasValidStatusDetails = (combatant: CombatantState, statusIndex: number) => {
  const activeStatus = combatant.activeStatuses[statusIndex];
  const priorStatuses = combatant.activeStatuses.slice(0, statusIndex);
  const validDuration =
    activeStatus.duration.type === "combat" ||
    (activeStatus.duration.type === "turns" && validCounter(activeStatus.duration.remaining, 1)) ||
    (activeStatus.duration.type === "uses" && validCounter(activeStatus.duration.remaining, 1));

  return (
    typeof activeStatus.statusId === "string" &&
    activeStatus.statusId.length > 0 &&
    typeof activeStatus.sourceDefinitionId === "string" &&
    activeStatus.sourceDefinitionId.length > 0 &&
    validCounter(activeStatus.stacks, 1) &&
    validDuration &&
    !priorStatuses.some((priorStatus) => priorStatus.statusId === activeStatus.statusId)
  );
};

const validateActiveStatuses = (
  combatant: CombatantState,
  recordId: string,
  violations: FightStateInvariantViolation[],
) => {
  for (const [statusIndex] of combatant.activeStatuses.entries()) {
    if (!hasValidStatusDetails(combatant, statusIndex)) {
      addViolation(
        violations,
        "invalid-status",
        "Active statuses must have unique IDs, a source definition, positive stacks, and a valid duration.",
        recordId,
      );
    }
  }
};

const validateCombatant = (
  recordId: string,
  combatant: CombatantState,
  turnNumber: number,
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

  validateCombatantStats(combatant, recordId, violations);
  validateSlotCapacities(combatant, recordId, violations);

  if (new Set(combatant.moveIds).size !== combatant.moveIds.length) {
    addViolation(
      violations,
      "invalid-combatant-identity",
      "Combatant move IDs must not contain duplicates.",
      recordId,
    );
  }
  if (
    combatant.itemIds !== undefined &&
    new Set(combatant.itemIds).size !== combatant.itemIds.length
  ) {
    addViolation(
      violations,
      "invalid-combatant-identity",
      "Combatant item IDs must not contain duplicates.",
      recordId,
    );
  }
  if (combatant.status === "defeated" && combatant.hitPoints.current !== 0) {
    addViolation(
      violations,
      "invalid-combatant-state",
      "A defeated combatant must have zero current hit points.",
      recordId,
    );
  }
  if (combatant.status === "active" && combatant.hitPoints.current === 0) {
    addViolation(
      violations,
      "invalid-combatant-state",
      "An active combatant must have positive current hit points.",
      recordId,
    );
  }

  validateMoveUses(combatant, recordId, violations);
  validateMoveUseLimitModifiers(combatant, recordId, violations);
  validateEffectUseCounts(combatant, recordId, violations);
  validateItemUses(combatant, recordId, violations);
  validateStoredRolls(combatant, recordId, turnNumber, violations);
  validateStoredMoveSelections(combatant, recordId, turnNumber, violations);
  validateActiveStatuses(combatant, recordId, violations);
};

const combatantForId = (state: FightState, combatantId: string) => {
  if (!Object.hasOwn(state.combatants, combatantId)) return undefined;

  return state.combatants[combatantId as CombatantId];
};

const isActiveCombatant = (state: FightState, combatantId: string) =>
  combatantForId(state, combatantId)?.status === "active";

const validateCombatantReferences = (
  state: FightState,
  combatant: CombatantState,
  violations: FightStateInvariantViolation[],
) => {
  for (const activeStatus of combatant.activeStatuses) {
    const validDurationOwner =
      activeStatus.duration.type !== "turns" ||
      combatantForId(state, activeStatus.duration.ownerCombatantId) !== undefined;
    if (
      combatantForId(state, activeStatus.sourceCombatantId) === undefined ||
      !validDurationOwner
    ) {
      addViolation(
        violations,
        "invalid-status",
        "Active statuses must reference existing combatants for their source and turn owner.",
        combatant.id,
      );
    }
  }

  const { transformation } = combatant;
  if (
    transformation !== undefined &&
    (typeof transformation.transformationId !== "string" ||
      transformation.transformationId.length === 0 ||
      !validCounter(transformation.activatedOnTurn, 1) ||
      transformation.activatedOnTurn > state.turnNumber)
  ) {
    addViolation(
      violations,
      "invalid-transformation",
      "An active transformation must have an ID and an activation turn within the fight.",
      combatant.id,
    );
  }
};

interface RuntimeActiveEffect {
  readonly amount?: unknown;
  readonly scope?: unknown;
  readonly selector?: {
    readonly baseKiCost?: unknown;
    readonly category?: unknown;
  };
  readonly sourceDefinitionId?: unknown;
  readonly type?: unknown;
}

const hasValidCostEffectDetails = (effect: ActiveCostModifierEffect) => {
  const runtimeEffect: RuntimeActiveEffect = effect;
  const { selector } = runtimeEffect;

  return (
    runtimeEffect.type === "modify-ki-cost" &&
    runtimeEffect.scope === "next-eligible-action" &&
    selector?.category === "advanced-attack" &&
    typeof selector.baseKiCost === "number" &&
    Number.isFinite(selector.baseKiCost) &&
    selector.baseKiCost >= 0 &&
    Number.isFinite(runtimeEffect.amount) &&
    typeof runtimeEffect.sourceDefinitionId === "string" &&
    runtimeEffect.sourceDefinitionId.length > 0
  );
};

const hasValidRollEffectDetails = (effect: Extract<ActiveCombatEffect, { type: "modify-roll" }>) =>
  (effect.roll === "attack" ||
    effect.roll === "defense" ||
    effect.roll === "escape" ||
    effect.roll === "initiative" ||
    effect.roll === "transformation") &&
  (effect.modifier === "dice" || effect.modifier === "result" || effect.modifier === "sides") &&
  (effect.cap === undefined ||
    (effect.cap.type === "allow-exceed"
      ? effect.cap.scope === "amount" || effect.cap.scope === "total" || effect.cap.scope === "roll"
      : (effect.cap.type === "maximum" || effect.cap.type === "minimum") &&
        (effect.cap.scope === "amount" ||
          effect.cap.scope === "total" ||
          effect.cap.scope === "roll") &&
        Number.isFinite(effect.cap.value))) &&
  Number.isFinite(effect.amount) &&
  (effect.duration === "combat" ||
    ((effect.duration.type === "turns" || effect.duration.type === "turns-or-until-perfect-roll") &&
      typeof effect.duration.ownerCombatantId === "string" &&
      validCounter(effect.duration.remaining, 1))) &&
  typeof effect.sourceDefinitionId === "string" &&
  effect.sourceDefinitionId.length > 0;

const hasValidRerollEffectDetails = (effect: Extract<ActiveCombatEffect, { type: "reroll" }>) =>
  (effect.roll === "attack" || effect.roll === "defense") &&
  (effect.rerollScope === "single-result" || effect.rerollScope === "entire-attack") &&
  typeof effect.optional === "boolean" &&
  Number.isFinite(effect.bonus) &&
  (effect.activationCost === undefined || effect.activationResource === "ki") &&
  (effect.activationCost === undefined || validNonnegativeNumber(effect.activationCost)) &&
  (effect.useLimit === undefined ||
    (validCounter(effect.useLimit.remaining, 0) &&
      (effect.useLimit.scope === "combat" || effect.useLimit.scope === "turn"))) &&
  (effect.duration.type === "combat" ||
    (effect.duration.type === "next-action" && typeof effect.duration.combatantId === "string") ||
    (effect.duration.type === "next-roll" &&
      typeof effect.duration.combatantId === "string" &&
      effect.duration.roll === effect.roll) ||
    (effect.duration.type === "next-rolls" &&
      typeof effect.duration.combatantId === "string" &&
      effect.duration.roll === effect.roll &&
      validCounter(effect.duration.remaining, 1))) &&
  typeof effect.sourceDefinitionId === "string" &&
  effect.sourceDefinitionId.length > 0 &&
  validCounter(effect.sourceEffectIndex, 0);

const hasValidResolutionThresholdDetails = (
  effect: Extract<ActiveCombatEffect, { type: "set-resolution-threshold" }>,
) =>
  (effect.outcome === "successful" || effect.outcome === "stopped") &&
  (effect.roll === "attack" || effect.roll === "defense") &&
  (effect.comparison === "at-least" || effect.comparison === "at-most") &&
  (effect.relativeTo === undefined
    ? effect.relativeOperation === undefined
    : (effect.relativeTo === "attack-roll" || effect.relativeTo === "defense-roll") &&
      (effect.relativeOperation === "add" || effect.relativeOperation === "multiply") &&
      ((effect.relativeTo === "attack-roll" && effect.roll === "defense") ||
        (effect.relativeTo === "defense-roll" && effect.roll === "attack"))) &&
  (effect.resultScope === "current-attack" || effect.resultScope === "matching-die") &&
  (effect.appliesTo === "source" || effect.appliesTo === "target") &&
  (effect.scope === undefined || effect.scope === "next-action") &&
  Number.isFinite(effect.value) &&
  (effect.duration.type === "combat" ||
    (effect.duration.type === "until-roll-threshold" &&
      (effect.duration.roll === "attack" || effect.duration.roll === "defense") &&
      (effect.duration.comparison === "at-least" || effect.duration.comparison === "at-most") &&
      Number.isFinite(effect.duration.value))) &&
  typeof effect.sourceDefinitionId === "string" &&
  effect.sourceDefinitionId.length > 0;

const isValidCombatResultModifier = (
  modifier: Extract<ActiveCombatEffect, { type: "modify-next-action" }>["modifier"],
  scope: string,
) =>
  modifier.type !== "combat-result" ||
  (scope === "next-action" &&
    (modifier.result === "successful" || modifier.result === "stopped") &&
    (modifier.resultScope === "current-attack" || modifier.resultScope === "matching-die"));

const hasValidNextActionModifierDetails = (
  effect: Extract<ActiveCombatEffect, { type: "modify-next-action" }>,
) => {
  const scope = effect.scope ?? "next-action";
  const validScope =
    scope === "next-action" ||
    scope === "following-action" ||
    scope === "next-roll" ||
    scope === "next-actions" ||
    scope === "next-rolls" ||
    scope === "next-phase" ||
    scope === "next-turn";
  const validRemaining = effect.remaining === undefined || validCounter(effect.remaining, 1);
  const validFollowingTurn =
    effect.availableFromTurn === undefined || validCounter(effect.availableFromTurn, 1);
  const validDamageOperation =
    effect.modifier.type !== "damage" ||
    effect.modifier.operation === undefined ||
    effect.modifier.operation === "add" ||
    effect.modifier.operation === "multiply" ||
    effect.modifier.operation === "set";
  const validDamageBasis =
    effect.modifier.type !== "damage" ||
    effect.modifier.basis === undefined ||
    effect.modifier.basis === "power-percent" ||
    effect.modifier.basis === "damage-percent";
  const validResourceOperation =
    effect.modifier.type !== "resource" ||
    effect.modifier.operation === "drain" ||
    effect.modifier.operation === "gain" ||
    effect.modifier.operation === "lose" ||
    effect.modifier.operation === "set";
  const validResourceCostOperation =
    effect.modifier.type !== "resource-cost" ||
    (effect.modifier.resource === "hp" && effect.modifier.operation === "add");
  const validCostOperation =
    effect.modifier.type !== "cost" ||
    effect.modifier.operation === "add" ||
    effect.modifier.operation === "set";
  const validCostBounds =
    effect.modifier.type !== "cost" ||
    ((effect.modifier.minimum === undefined || Number.isFinite(effect.modifier.minimum)) &&
      (effect.modifier.maximum === undefined || Number.isFinite(effect.modifier.maximum)));
  const validRollCap = (
    cap: NonNullable<Extract<ActiveCombatEffect, { type: "modify-roll" }>["cap"]>,
  ) =>
    cap.type === "allow-exceed"
      ? cap.scope === "amount" || cap.scope === "total" || cap.scope === "roll"
      : Number.isFinite(cap.value) &&
        (cap.scope === "amount" || cap.scope === "total" || cap.scope === "roll");
  const validCombatResult = isValidCombatResultModifier(effect.modifier, scope);
  return (
    validDamageOperation &&
    validDamageBasis &&
    validResourceOperation &&
    validResourceCostOperation &&
    validCostOperation &&
    validCostBounds &&
    validCombatResult &&
    (effect.modifier.type === "damage" ||
      (effect.modifier.type === "stat" &&
        (effect.modifier.stat === "dexterity" || effect.modifier.stat === "dexterity-bonus") &&
        (effect.modifier.operation === "add" ||
          effect.modifier.operation === "set" ||
          effect.modifier.operation === "multiply") &&
        (effect.modifier.roll === undefined ||
          effect.modifier.roll === "attack" ||
          effect.modifier.roll === "defense")) ||
      (effect.modifier.type === "roll" &&
        (effect.modifier.roll === "attack" ||
          effect.modifier.roll === "defense" ||
          effect.modifier.roll === "escape" ||
          effect.modifier.roll === "initiative" ||
          effect.modifier.roll === "transformation") &&
        (effect.modifier.modifier === "dice" ||
          effect.modifier.modifier === "result" ||
          effect.modifier.modifier === "sides") &&
        (effect.modifier.cap === undefined || validRollCap(effect.modifier.cap))) ||
      (effect.modifier.type === "resource" &&
        (effect.modifier.resource === "hp" || effect.modifier.resource === "ki") &&
        effect.modifier.basis === "damage-percent") ||
      effect.modifier.type === "resource-cost" ||
      effect.modifier.type === "cost" ||
      effect.modifier.type === "combat-result") &&
    (effect.modifier.type === "combat-result" || Number.isFinite(effect.modifier.amount)) &&
    typeof effect.sourceDefinitionId === "string" &&
    effect.sourceDefinitionId.length > 0 &&
    validScope &&
    validRemaining &&
    validFollowingTurn &&
    (scope === "next-actions" || scope === "next-rolls"
      ? effect.remaining !== undefined
      : effect.remaining === undefined) &&
    (scope === "following-action"
      ? effect.availableFromTurn !== undefined
      : effect.availableFromTurn === undefined)
  );
};

const hasValidDamageModifierDetails = (
  effect: Extract<ActiveCombatEffect, { type: "modify-damage" }>,
) => {
  const duration = effect.duration;
  const validDuration =
    duration.type === "combat" ||
    (duration.type === "turns" && validCounter(duration.remaining, 1)) ||
    (duration.type === "until-roll-threshold" &&
      duration.roll === "attack" &&
      (duration.comparison === "at-least" || duration.comparison === "at-most") &&
      Number.isFinite(duration.value));
  return (
    (effect.operation === "add" || effect.operation === "multiply" || effect.operation === "set") &&
    (effect.basis === "power-percent" || effect.basis === "damage-percent") &&
    Number.isFinite(effect.amount) &&
    validDuration &&
    (effect.availableFromTurn === undefined || validCounter(effect.availableFromTurn, 1)) &&
    typeof effect.sourceDefinitionId === "string" &&
    effect.sourceDefinitionId.length > 0
  );
};

const hasValidDamageModifierCombatantReferences = (
  state: FightState,
  effect: Extract<ActiveCombatEffect, { type: "modify-damage" }>,
) => {
  if (effect.duration.type === "turns")
    return isActiveCombatant(state, effect.duration.ownerCombatantId);
  if (effect.duration.type === "until-roll-threshold")
    return isActiveCombatant(state, effect.duration.combatantId);
  return true;
};

const hasValidStatModifierEffectDetails = (
  effect: Extract<ActiveCombatEffect, { type: "modify-stat" }>,
) =>
  effect.duration.type === "turns" &&
  validCounter(effect.duration.remaining, 1) &&
  Number.isFinite(effect.amount) &&
  effect.amount >= 0 &&
  effect.sourceDefinitionId.length > 0;

const hasValidSuppressionEffectDetails = (
  effect: Extract<ActiveCombatEffect, { type: "suppress" }>,
) => {
  const selector: unknown = effect.selector;
  const validSelector =
    selector === undefined ||
    (typeof selector === "object" &&
      selector !== null &&
      "type" in selector &&
      selector.type === "move-selector");
  const validDuration =
    effect.duration.type === "combat" ||
    (effect.duration.type === "turns" && validCounter(effect.duration.remaining, 1)) ||
    (effect.duration.type === "next-actions" && validCounter(effect.duration.remaining, 1)) ||
    (effect.duration.type === "following-action" && validCounter(effect.duration.remaining, 1)) ||
    (effect.duration.type === "until-roll-threshold" &&
      effect.duration.roll === "attack" &&
      (effect.duration.comparison === "at-least" || effect.duration.comparison === "at-most") &&
      Number.isFinite(effect.duration.value));
  return (
    effect.aspects.length > 0 &&
    effect.aspects.every((aspect) => aspect === "all-effects" || aspect === "successful-effects") &&
    validSelector &&
    validDuration &&
    effect.sourceDefinitionId.length > 0
  );
};

const hasValidSuppressionCombatantReferences = (
  state: FightState,
  effect: Extract<ActiveCombatEffect, { type: "suppress" }>,
) => {
  if (
    effect.duration.type === "turns" ||
    effect.duration.type === "next-actions" ||
    effect.duration.type === "following-action"
  )
    return isActiveCombatant(state, effect.duration.ownerCombatantId);
  if (effect.duration.type === "until-roll-threshold")
    return isActiveCombatant(state, effect.duration.combatantId);
  return true;
};

const hasValidRollModificationPreventionDetails = (
  effect: Extract<ActiveCombatEffect, { type: "prevent-roll-modification" }>,
) =>
  (effect.roll === "attack" || effect.roll === "defense") &&
  (effect.modifier === "result" || effect.modifier === "sides" || effect.modifier === "any") &&
  (effect.exemptSourceEffect === undefined || typeof effect.exemptSourceEffect === "boolean");

const validMoveModificationAspects = new Set<string>([
  "cost",
  "damage",
  "dice-sides",
  "effects",
  "roll-results",
]);

const hasValidMoveModificationPreventionDetails = (
  effect: Extract<ActiveCombatEffect, { type: "prevent-move-modification" }>,
) => {
  const selector: unknown = effect.selector;
  return (
    (effect.actor === "self" || effect.actor === "opponent" || effect.actor === "any") &&
    effect.aspects.length > 0 &&
    effect.aspects.every((aspect) => validMoveModificationAspects.has(aspect)) &&
    (effect.operations === undefined ||
      effect.operations.every((operation) => operation === "reduce")) &&
    typeof selector === "object" &&
    selector !== null &&
    "type" in selector &&
    selector.type === "move-selector" &&
    (effect.effectSourceStyleExcludes === undefined ||
      typeof effect.effectSourceStyleExcludes === "string") &&
    (effect.exceptSourceMoveIds === undefined ||
      effect.exceptSourceMoveIds.every((moveId) => typeof moveId === "string")) &&
    (effect.exceptSourceStatusIds === undefined ||
      effect.exceptSourceStatusIds.every((statusId) => typeof statusId === "string")) &&
    (effect.availableFromTurn === undefined ||
      (Number.isInteger(effect.availableFromTurn) && effect.availableFromTurn >= 1))
  );
};

const hasValidResourceModificationPreventionDetails = (
  effect: Extract<ActiveCombatEffect, { type: "prevent-resource-modification" }>,
) =>
  (effect.resource === "hp" || effect.resource === "ki") &&
  (effect.operation === "gain" || effect.operation === "lose" || effect.operation === "set") &&
  (effect.sourceActor === undefined || effect.sourceActor === "opponent") &&
  (effect.exceptAction === undefined || effect.exceptAction === "power-up");

const hasValidConstantEffectDetails = (
  effect: Extract<ActiveCombatEffect, { type: "active-constant" }>,
) =>
  effect.duration === "combat" &&
  typeof effect.sourceDefinitionId === "string" &&
  effect.sourceDefinitionId.length > 0 &&
  validCounter(effect.activatedOnTurn, 1) &&
  (effect.paidActivationCost === undefined || validNonnegativeNumber(effect.paidActivationCost)) &&
  (effect.lifecycle === undefined ||
    effect.lifecycle === "active" ||
    (effect.lifecycle === "deactivated" && validCounter(effect.deactivatedOnTurn ?? 0, 1)));

const hasValidForcedActionEffectDetails = (
  effect: Extract<ActiveCombatEffect, { type: "force-next-action" }>,
) =>
  effect.allowedCategories.length > 0 &&
  effect.allowedCategories.every(
    (category) => category === "advanced-attack" || category === "signature",
  ) &&
  typeof effect.sourceDefinitionId === "string" &&
  effect.sourceDefinitionId.length > 0 &&
  (effect.selectedMoveStorageKey === undefined ||
    storedRollKeyPattern.test(effect.selectedMoveStorageKey));

const hasValidItemDamageModifierEffectDetails = (
  effect: Extract<ActiveCombatEffect, { type: "modify-item-next-attack-damage" }>,
) =>
  Number.isFinite(effect.amount) &&
  validCounter(effect.remainingAttacks, 1) &&
  typeof effect.sourceDefinitionId === "string" &&
  effect.sourceDefinitionId.length > 0;

const hasValidMoveRemovalEffectDetails = (
  effect: Extract<ActiveCombatEffect, { type: "remove-move-from-combat" }>,
) =>
  effect.duration === "combat" &&
  effect.sourceDefinitionId.length > 0 &&
  effect.moveId.length > 0 &&
  validCounter(effect.sourceEffectIndex, 0) &&
  validCounter(effect.removedFromIndex, 0) &&
  MOVE_DEFINITIONS.some((move) => move.id === effect.moveId);

const hasValidFloatingEffectDetails = (
  effect: Extract<ActiveCombatEffect, { type: "floating-effect" }>,
) => {
  const duration = effect.duration;
  return (
    effect.floatingEffectId.length > 0 &&
    effect.sourceDefinitionId.length > 0 &&
    (effect.sourceEffectIndex === undefined || validCounter(effect.sourceEffectIndex, 0)) &&
    (effect.blockedAttackDamage === undefined ||
      validNonnegativeNumber(effect.blockedAttackDamage)) &&
    validCounter(effect.createdOnTurn, 1) &&
    (effect.scope.type === "combat" ||
      effect.scope.type === "next-action" ||
      (effect.scope.type === "next-turn" && typeof effect.scope.combatantId === "string")) &&
    (effect.stacking === undefined ||
      effect.stacking === "allow" ||
      effect.stacking === "prevent") &&
    (duration === undefined ||
      (duration.type === "until-combat-result" &&
        typeof duration.combatantId === "string" &&
        (duration.result === "successful" ||
          duration.result === "stopped" ||
          duration.result === "critical" ||
          duration.result === "counter") &&
        (duration.rollThreshold === undefined ||
          ((duration.rollThreshold.roll === "attack" ||
            duration.rollThreshold.roll === "defense" ||
            duration.rollThreshold.roll === "transformation") &&
            (duration.rollThreshold.comparison === "at-least" ||
              duration.rollThreshold.comparison === "at-most") &&
            Number.isFinite(duration.rollThreshold.value)))) ||
      (duration.type === "until-roll-threshold" &&
        typeof duration.combatantId === "string" &&
        (duration.roll === "attack" || duration.roll === "defense") &&
        (duration.comparison === "at-least" || duration.comparison === "at-most") &&
        Number.isFinite(duration.value))) &&
    effect.effects.every((nestedEffect) => nestedEffect.type !== "create-floating-effect") &&
    effect.termination.every(
      (termination) =>
        (termination.trigger === "on-power-up" ||
          termination.trigger === "on-stopped" ||
          termination.trigger === "on-success") &&
        (termination.actor === "self" || termination.actor === "opponent"),
    )
  );
};

const hasValidExtraActionEffectDetails = (
  effect: Extract<ActiveCombatEffect, { type: "extra-action" }>,
) =>
  effect.sourceDefinitionId.length > 0 &&
  Number.isInteger(effect.sourceEffectIndex) &&
  effect.sourceEffectIndex >= 0 &&
  (effect.phase === "action" || effect.phase === "upkeep") &&
  validCounter(effect.remainingActions, 1) &&
  validCounter(effect.availableFromTurn, 1) &&
  validCounter(effect.expiresAfterTurn, effect.availableFromTurn) &&
  (effect.useLimit === undefined ||
    (validCounter(effect.useLimit.count, 1) &&
      (effect.useLimit.scope === "combat" || effect.useLimit.scope === "turn")));

const hasValidActionRestrictionEffectDetails = (
  effect: Extract<ActiveCombatEffect, { readonly type: "action-restriction" }>,
) => {
  const categories = effect.blockedCategories;
  const allowedCategories = new Set(["basic-attack", "advanced-attack", "signature"]);
  return (
    effect.sourceDefinitionId.length > 0 &&
    validCounter(effect.sourceEffectIndex, 0) &&
    validCounter(effect.availableFromTurn, 1) &&
    validCounter(effect.remainingTurns, 1) &&
    (categories === undefined ||
      (categories.length > 0 &&
        new Set(categories).size === categories.length &&
        categories.every((category) => allowedCategories.has(category))))
  );
};

const hasValidScheduledAmount = (
  amount: Extract<ActiveCombatEffect, { readonly type: "scheduled-resource" }>["amount"],
) => {
  if (amount.type === "literal") return Number.isFinite(amount.value) && amount.value >= 0;
  if (amount.type === "stat-percent")
    return amount.stat === "power" && Number.isFinite(amount.percent) && amount.percent >= 0;
  return (
    amount.type === "resource-percent" &&
    (amount.resource === "hp" || amount.resource === "ki") &&
    (amount.basis === "current" || amount.basis === "total") &&
    Number.isFinite(amount.percent) &&
    amount.percent >= 0
  );
};

const hasValidScheduledResourceEffectDetails = (
  effect: Extract<ActiveCombatEffect, { readonly type: "scheduled-resource" }>,
) => {
  const duration = effect.duration;
  const validDuration =
    duration === undefined ||
    (duration.type === "turns" && validCounter(duration.remaining, 1)) ||
    (duration.type === "until-roll-threshold" &&
      Number.isFinite(duration.value) &&
      (duration.moveSelector === undefined || duration.moveSelector.type === "move-selector"));
  const threshold = effect.cancellation?.rollThreshold;
  return (
    effect.sourceDefinitionId.length > 0 &&
    validCounter(effect.sourceEffectIndex, 0) &&
    validCounter(effect.remainingBoundaries, 1) &&
    (effect.repeat === "once" || effect.repeat === "each-turn") &&
    (effect.timing.type === "phase-start"
      ? effect.timing.phase === "upkeep"
      : effect.timing.phase === undefined) &&
    (effect.operation !== "damage" || effect.resource === "hp") &&
    hasValidScheduledAmount(effect.amount) &&
    validDuration &&
    (threshold === undefined || Number.isFinite(threshold.value))
  );
};

const hasValidActionLockEffectDetails = (
  effect: Extract<
    ActiveCombatEffect,
    {
      type:
        | "action-lock"
        | "prevent-move-use"
        | "prevent-status"
        | "prevent-combat-result"
        | "prevent-roll-modification"
        | "prevent-move-modification"
        | "prevent-resource-modification"
        | "set-resolution-threshold";
    }
  >,
) => {
  const duration = effect.duration;
  const validDuration =
    duration.type === "combat" ||
    (duration.type === "turns" && validCounter(duration.remaining, 1)) ||
    (duration.type === "next-actions" && validCounter(duration.remaining, 1)) ||
    (duration.type === "until-roll-threshold" && Number.isFinite(duration.value)) ||
    (duration.type === "until-resource-threshold" && Number.isFinite(duration.value)) ||
    duration.type === "until-combat-result" ||
    (duration.type === "until-turn-start-roll-threshold" &&
      validCounter(duration.dice, 1) &&
      validCounter(duration.sides, 1) &&
      validCounter(duration.remainingIgnoredChecks, 0));
  return (
    validDuration &&
    typeof effect.sourceDefinitionId === "string" &&
    effect.sourceDefinitionId.length > 0
  );
};

const hasValidActionLockCombatantReferences = (
  state: FightState,
  effect: Extract<
    ActiveCombatEffect,
    {
      type:
        | "action-lock"
        | "prevent-move-use"
        | "prevent-status"
        | "prevent-combat-result"
        | "prevent-roll-modification"
        | "prevent-move-modification"
        | "prevent-resource-modification"
        | "set-resolution-threshold";
    }
  >,
) => {
  const duration = effect.duration;
  if (duration.type === "turns" || duration.type === "next-actions")
    return isActiveCombatant(state, duration.ownerCombatantId);
  if (
    duration.type === "until-roll-threshold" ||
    duration.type === "until-resource-threshold" ||
    duration.type === "until-combat-result" ||
    duration.type === "until-turn-start-roll-threshold"
  )
    return isActiveCombatant(state, duration.combatantId);
  return true;
};

const hasValidRollModifierTransformerDetails = (
  effect: Extract<ActiveCombatEffect, { type: "modify-roll-modifier" }>,
) =>
  effect.sourceDefinitionId.length > 0 &&
  validCounter(effect.sourceEffectIndex, 0) &&
  (effect.modifier === "result" || effect.modifier === "sides" || effect.modifier === "any") &&
  (effect.multiplier === undefined || Number.isFinite(effect.multiplier)) &&
  (effect.increment === undefined || Number.isFinite(effect.increment)) &&
  !(effect.multiplier === undefined && effect.increment === undefined) &&
  (effect.excludeSourceCategories === undefined ||
    new Set(effect.excludeSourceCategories).size === effect.excludeSourceCategories.length) &&
  (effect.cap === undefined ||
    (effect.cap.type === "allow-exceed" &&
      (effect.cap.scope === "amount" ||
        effect.cap.scope === "total" ||
        effect.cap.scope === "roll"))) &&
  (effect.duration === "combat" ||
    (effect.duration.type === "next-roll" &&
      typeof effect.duration.combatantId === "string" &&
      (effect.duration.roll === "attack" || effect.duration.roll === "defense")));

const hasValidRollSelectionDetails = (
  effect: Extract<ActiveCombatEffect, { type: "set-roll-selection" }>,
) =>
  (effect.roll === "attack" || effect.roll === "defense") &&
  validCounter(effect.diceCount, 2) &&
  (effect.selection === "highest" || effect.selection === "lowest") &&
  effect.sourceDefinitionId.length > 0 &&
  validCounter(effect.sourceEffectIndex, 0) &&
  effect.duration.type === "next-roll" &&
  effect.duration.roll === effect.roll &&
  typeof effect.duration.combatantId === "string";

const hasValidNonFloatingEffectDetails = (
  effect: Exclude<
    ActiveCombatEffect,
    { type: "floating-effect" | "extra-action" | "scheduled-resource" }
  >,
) => {
  switch (effect.type) {
    case "modify-ki-cost":
      return hasValidCostEffectDetails(effect);
    case "modify-roll-modifier":
      return hasValidRollModifierTransformerDetails(effect);
    case "set-roll-selection":
      return hasValidRollSelectionDetails(effect);
    case "modify-roll":
      return hasValidRollEffectDetails(effect);
    case "reroll":
      return hasValidRerollEffectDetails(effect);
    case "set-resolution-threshold":
      return hasValidResolutionThresholdDetails(effect);
    case "modify-damage":
      return hasValidDamageModifierDetails(effect);
    case "modify-stat":
      return hasValidStatModifierEffectDetails(effect);
    case "suppress":
      return hasValidSuppressionEffectDetails(effect);
    case "active-constant":
      return hasValidConstantEffectDetails(effect);
    case "remove-move-from-combat":
      return hasValidMoveRemovalEffectDetails(effect);
    case "force-next-action":
      return hasValidForcedActionEffectDetails(effect);
    case "action-restriction":
      return hasValidActionRestrictionEffectDetails(effect);
    case "modify-item-next-attack-damage":
      return hasValidItemDamageModifierEffectDetails(effect);
    case "action-lock":
    case "prevent-move-use":
    case "prevent-status":
    case "prevent-combat-result":
      return hasValidActionLockEffectDetails(effect);
    case "prevent-roll-modification":
      return (
        hasValidActionLockEffectDetails(effect) && hasValidRollModificationPreventionDetails(effect)
      );
    case "prevent-move-modification":
      return (
        hasValidActionLockEffectDetails(effect) && hasValidMoveModificationPreventionDetails(effect)
      );
    case "prevent-resource-modification":
      return (
        hasValidActionLockEffectDetails(effect) &&
        hasValidResourceModificationPreventionDetails(effect)
      );
    case "modify-next-action":
      return hasValidNextActionModifierDetails(effect);
  }
};

const hasValidEffectDetails = (effect: ActiveCombatEffect) => {
  if (effect.type === "floating-effect") return hasValidFloatingEffectDetails(effect);
  if (effect.type === "extra-action") return hasValidExtraActionEffectDetails(effect);
  if (effect.type === "scheduled-resource") return hasValidScheduledResourceEffectDetails(effect);
  return hasValidNonFloatingEffectDetails(effect);
};

const hasValidActiveEffectReferences = (state: FightState, effect: ActiveCombatEffect) => {
  if (
    effect.type === "floating-effect" &&
    effect.duration !== undefined &&
    !isActiveCombatant(state, effect.duration.combatantId)
  )
    return false;
  if (
    effect.type === "floating-effect" &&
    effect.targetRelationCombatantId !== undefined &&
    !isActiveCombatant(state, effect.targetRelationCombatantId)
  )
    return false;
  if (effect.type === "scheduled-resource")
    return (
      isActiveCombatant(state, effect.timing.combatantId) &&
      (effect.duration?.type !== "until-roll-threshold" ||
        isActiveCombatant(state, effect.duration.combatantId)) &&
      (effect.cancellation === undefined ||
        isActiveCombatant(state, effect.cancellation.actorCombatantId))
    );
  if (effect.type === "modify-damage")
    return hasValidDamageModifierCombatantReferences(state, effect);
  if (effect.type === "modify-stat")
    return isActiveCombatant(state, effect.duration.ownerCombatantId);
  if (effect.type === "modify-roll-modifier" && effect.duration !== "combat")
    return isActiveCombatant(state, effect.duration.combatantId);
  if (effect.type === "set-roll-selection")
    return isActiveCombatant(state, effect.duration.combatantId);
  if (effect.type === "suppress") return hasValidSuppressionCombatantReferences(state, effect);
  if (effect.type === "remove-move-from-combat")
    return !state.combatants[effect.targetCombatantId].moveIds.includes(effect.moveId);
  if (
    effect.type === "action-lock" ||
    effect.type === "prevent-move-use" ||
    effect.type === "prevent-status" ||
    effect.type === "prevent-combat-result" ||
    effect.type === "prevent-roll-modification" ||
    effect.type === "prevent-move-modification" ||
    effect.type === "prevent-resource-modification" ||
    effect.type === "set-resolution-threshold"
  )
    return hasValidActionLockCombatantReferences(state, effect);
  return true;
};

const validateActiveEffects = (state: FightState, violations: FightStateInvariantViolation[]) => {
  const activeEffectIds = new Set<string>();

  for (const effect of state.activeEffects) {
    const validEffect =
      activeEffectIdSchema.safeParse(effect.id).success &&
      !activeEffectIds.has(effect.id) &&
      isActiveCombatant(state, effect.sourceCombatantId) &&
      isActiveCombatant(state, effect.targetCombatantId) &&
      (effect.type !== "floating-effect" ||
        effect.scope.type !== "next-turn" ||
        isActiveCombatant(state, effect.scope.combatantId)) &&
      hasValidActiveEffectReferences(state, effect) &&
      hasValidEffectDetails(effect);
    if (!validEffect) {
      addViolation(
        violations,
        "invalid-active-effect",
        "Active effects must have unique valid IDs, active combatant references, and valid selectors.",
        effect.id,
      );
    }
    activeEffectIds.add(effect.id);
  }
};

const validDamageDealt = (damage: number | undefined) =>
  damage === undefined || (Number.isFinite(damage) && damage >= 0);

type AttackActionHistoryRecord = Extract<
  CombatActionRecord,
  { readonly type: "basic-attack" | "use-move" }
>;

const validAttackActionResults = (action: AttackActionHistoryRecord) =>
  (action.outcome === undefined ||
    action.outcome === "successful" ||
    action.outcome === "stopped") &&
  (action.critical === undefined || typeof action.critical === "boolean") &&
  (action.counter === undefined || typeof action.counter === "boolean") &&
  (action.attackRollResult === undefined || Number.isFinite(action.attackRollResult)) &&
  (action.defenseRollResult === undefined || Number.isFinite(action.defenseRollResult)) &&
  validDamageDealt(action.damageDealt);

const validateActionHistory = (state: FightState, violations: FightStateInvariantViolation[]) => {
  const decisionIds = new Set<string>();
  let previousTurnNumber = 0;

  for (const action of state.actionHistory) {
    const validAction = (action: CombatActionRecord) => {
      const baseValid =
        (action.type === "turn-skipped" ||
          combatDecisionIdSchema.safeParse(action.decisionId).success) &&
        combatantForId(state, action.actorId) !== undefined &&
        validCounter(action.turnNumber, 1) &&
        action.turnNumber <= state.turnNumber &&
        (action.type === "turn-skipped" || !decisionIds.has(action.decisionId)) &&
        action.turnNumber >= previousTurnNumber;
      if (!baseValid) return false;
      if (action.type === "turn-skipped")
        return (
          action.phase === "action" && (action.reason === "status" || action.reason === "effect")
        );
      if (action.type === "basic-attack") {
        return (
          combatantForId(state, action.targetCombatantId) !== undefined &&
          validAttackActionResults(action)
        );
      }
      if (action.type === "use-move") {
        return (
          combatantForId(state, action.targetCombatantId) !== undefined &&
          typeof action.moveId === "string" &&
          action.moveId.length > 0 &&
          validAttackActionResults(action)
        );
      }
      if (action.type === "use-item") {
        return combatantForId(state, action.actorId)?.itemIds?.includes(action.itemId) ?? false;
      }
      return true;
    };

    if (!validAction(action)) {
      addViolation(
        violations,
        "invalid-action-history",
        "Action history must contain ordered, unique decision records with valid combatant references.",
        action.type === "turn-skipped" ? action.actorId : action.decisionId,
      );
    }
    if (action.type !== "turn-skipped") decisionIds.add(action.decisionId);
    previousTurnNumber = action.turnNumber;
  }
};

type AttackFrameReference = Extract<
  ResolutionFrame,
  { readonly type: "attack"; readonly stage: "awaiting-defense" }
>["attack"];

type AwaitingEffectChoiceAttackFrame = Extract<
  ResolutionFrame,
  { readonly type: "attack"; readonly stage: "awaiting-effect-choice" }
>;

const validEffectAlternatives = (frame: AwaitingEffectChoiceAttackFrame) => {
  if (frame.effectAlternatives === undefined) return true;
  if (frame.effectAlternatives.length === 0) return false;
  if (!frame.effectAlternatives.every(validRequiredIndexList)) return false;
  const firstAlternative = frame.effectAlternatives[0]!;
  return (
    firstAlternative.length === frame.effectIndices.length &&
    firstAlternative.every((index, position) => index === frame.effectIndices[position])
  );
};

const validRequiredIndexList = (indices: readonly number[]) =>
  indices.length > 0 &&
  indices.every((index) => Number.isInteger(index) && index >= 0) &&
  new Set(indices).size === indices.length;

const validCopiedMoveAttackReference = (attack: AttackFrameReference) => {
  if (attack.type !== "move") return true;
  const {
    copiedFromMoveId,
    copiedSourceMove,
    copiedDamageBonusPercent,
    copiedDamageOverride,
    copiedSuccessfulEffectsOnly,
  } = attack;
  if (
    copiedFromMoveId === undefined &&
    copiedSourceMove === undefined &&
    copiedDamageBonusPercent === undefined &&
    copiedDamageOverride === undefined &&
    copiedSuccessfulEffectsOnly === undefined
  )
    return true;
  if (copiedFromMoveId === undefined) return false;
  if (
    copiedSourceMove !== undefined &&
    (copiedSourceMove.id !== copiedFromMoveId || copiedSourceMove.mechanics.attack === undefined)
  )
    return false;
  if (copiedSuccessfulEffectsOnly !== undefined && typeof copiedSuccessfulEffectsOnly !== "boolean")
    return false;
  return (
    copiedFromMoveId !== attack.moveId &&
    (copiedSourceMove !== undefined ||
      MOVE_DEFINITIONS.some((move) => move.id === copiedFromMoveId)) &&
    (copiedDamageBonusPercent === undefined ||
      (Number.isFinite(copiedDamageBonusPercent) && copiedDamageBonusPercent >= 0)) &&
    (copiedDamageOverride === undefined ||
      (Number.isFinite(copiedDamageOverride) && copiedDamageOverride >= 0))
  );
};

const validCounterActionReference = (reference: CounterActionReference) => {
  const activationCost = reference.activationCost;
  const costModifier = reference.costModifier;
  const sourceAction = reference.sourceAction;
  return (
    MOVE_DEFINITIONS.some((move) => move.id === reference.sourceDefinitionId) &&
    validCounter(reference.sourceEffectIndex, 0) &&
    typeof reference.stopsTriggeringAttack === "boolean" &&
    typeof reference.ignoreRequirements === "boolean" &&
    (activationCost === undefined ||
      (activationCost.resource === "ki" &&
        validNonnegativeNumber(activationCost.amount) &&
        (activationCost.minimum === undefined ||
          validNonnegativeNumber(activationCost.minimum)))) &&
    (costModifier === undefined ||
      ((costModifier.operation === "add" || costModifier.operation === "set") &&
        Number.isFinite(costModifier.amount) &&
        (costModifier.minimum === undefined || validNonnegativeNumber(costModifier.minimum)))) &&
    (sourceAction === undefined ||
      ((sourceAction.type === "basic-attack" || sourceAction.type === "use-move") &&
        combatantIdSchema.safeParse(sourceAction.actorId).success &&
        combatantIdSchema.safeParse(sourceAction.targetCombatantId).success &&
        (sourceAction.type !== "use-move" ||
          (reference.sourceMoveSnapshot !== undefined &&
            reference.sourceMoveSnapshot.id === sourceAction.moveId))))
  );
};

const validAttackCostFrameMetadata = (
  frame: Extract<ResolutionFrame, { readonly type: "attack" }>,
) =>
  !("costEffectTrigger" in frame) ||
  (frame.costEffectTrigger !== undefined &&
    frame.costEffectSourceDefinitionId !== undefined &&
    frame.costEffectIndices !== undefined &&
    validRequiredIndexList(frame.costEffectIndices) &&
    MOVE_DEFINITIONS.some((move) => move.id === frame.costEffectSourceDefinitionId));

const validBeforeDefenseEffectFrameMetadata = (
  frame: Extract<ResolutionFrame, { readonly type: "attack" }>,
) =>
  !("beforeDefenseEffectChoices" in frame) ||
  frame.beforeDefenseEffectChoices === undefined ||
  (frame.beforeDefenseEffectChoices.length > 0 &&
    frame.beforeDefenseEffectChoices.every(
      (choice) =>
        MOVE_DEFINITIONS.some((move) => move.id === choice.sourceDefinitionId) &&
        validRequiredIndexList(choice.effectIndices),
    ));

const validAwaitingEffectChoiceSource = (frame: AwaitingEffectChoiceAttackFrame) =>
  frame.effectSourceDefinitionId === undefined
    ? frame.effectTrigger !== "on-move-use" &&
      frame.effectTrigger !== "on-cost-modified" &&
      frame.effectTrigger !== "on-damage"
    : (frame.effectTrigger === "on-move-use" ||
        frame.effectTrigger === "on-cost-modified" ||
        frame.effectTrigger === "on-damage") &&
      MOVE_DEFINITIONS.some((move) => move.id === frame.effectSourceDefinitionId);

const validAttackResolutionFrame = (
  state: FightState,
  frame: Extract<ResolutionFrame, { readonly type: "attack" }>,
) => {
  const validCopiedMoveReference =
    !("attack" in frame) || validCopiedMoveAttackReference(frame.attack);
  const validCounterAction =
    !("counterAction" in frame) ||
    frame.counterAction === undefined ||
    validCounterActionReference(frame.counterAction);
  const common =
    combatDecisionIdSchema.safeParse(frame.decisionId).success &&
    isActiveCombatant(state, frame.attackerId) &&
    isActiveCombatant(state, frame.targetCombatantId) &&
    frame.attackerId !== frame.targetCombatantId &&
    validCopiedMoveReference &&
    validCounterAction;
  const costFrameMetadataValid = validAttackCostFrameMetadata(frame);
  const beforeDefenseFrameMetadataValid = validBeforeDefenseEffectFrameMetadata(frame);
  if (
    !common ||
    !costFrameMetadataValid ||
    !beforeDefenseFrameMetadataValid ||
    frame.stage !== "awaiting-effect-choice"
  )
    return common && costFrameMetadataValid && beforeDefenseFrameMetadataValid;
  if (state.status !== "active") return false;
  const postRollChoice = frame.effectTrigger === "on-success";
  const naturalRollsValid =
    !postRollChoice ||
    (frame.naturalRolls !== undefined &&
      frame.naturalRolls.length > 0 &&
      frame.naturalRolls.every(
        (roll) =>
          Number.isInteger(roll.attack) &&
          roll.attack >= 1 &&
          (roll.defense === undefined || (Number.isInteger(roll.defense) && roll.defense >= 1)),
      ));
  const rollArraysValid =
    (frame.resultOverrides === undefined ||
      (frame.naturalRolls !== undefined &&
        frame.resultOverrides.length === frame.naturalRolls.length)) &&
    (frame.numericResultOverrides === undefined ||
      (frame.naturalRolls !== undefined &&
        frame.numericResultOverrides.length === frame.naturalRolls.length));
  const blockValid =
    frame.block === undefined ||
    (Number.isInteger(frame.block.cost) &&
      frame.block.cost >= 0 &&
      MOVE_DEFINITIONS.some((move) => move.id === frame.block!.blockId));
  const blockedDiceValid =
    frame.blockedDice === undefined ||
    (Number.isInteger(frame.blockedDice) &&
      frame.blockedDice >= 0 &&
      (frame.naturalRolls === undefined || frame.blockedDice <= frame.naturalRolls.length));
  const validIndexList = (indices: readonly number[] | undefined) =>
    indices === undefined ||
    (indices.every((index) => Number.isInteger(index) && index >= 0) &&
      new Set(indices).size === indices.length);
  const overrideValuesValid =
    (frame.numericResultOverrides === undefined ||
      frame.numericResultOverrides.every(
        (override) =>
          override === undefined ||
          (Number.isFinite(override.attack ?? 0) && Number.isFinite(override.defense ?? 0)),
      )) &&
    (frame.resultOverrides === undefined ||
      frame.resultOverrides.every(
        (result) => result === undefined || result === "stopped" || result === "successful",
      ));
  const serializedReactionReferencesValid =
    (frame.block === undefined ||
      combatDecisionIdSchema.safeParse(frame.block.responseDecisionId).success) &&
    (frame.defenseItem === undefined ||
      (frame.defenseItem.itemId.length > 0 &&
        combatDecisionIdSchema.safeParse(frame.defenseItem.responseDecisionId).success));
  const choiceCombatantId =
    frame.effectTrigger === "on-damage" ? frame.targetCombatantId : frame.attackerId;
  return (
    pendingDecisionIdSchema.safeParse(frame.pendingDecisionId).success &&
    state.pendingDecision?.id === frame.pendingDecisionId &&
    state.pendingDecision.type === "optional-effect" &&
    state.pendingDecision.combatantId === choiceCombatantId &&
    frame.attack.type === "move" &&
    validAwaitingEffectChoiceSource(frame) &&
    frame.resolvedEffectIndices.length === 0 &&
    frame.enabledEffectIndices.length === 0 &&
    validRequiredIndexList(frame.effectIndices) &&
    naturalRollsValid &&
    rollArraysValid &&
    blockValid &&
    blockedDiceValid &&
    validIndexList(frame.priorEnabledOptionalEffectIndices) &&
    validIndexList(frame.priorResolvedOptionalEffectIndices) &&
    validIndexList(frame.enabledAfterDefenseEffectIndices) &&
    overrideValuesValid &&
    serializedReactionReferencesValid
  );
};

const validActivationCostFrame = (
  activationCost: Extract<ResolutionFrame, { readonly type: "effect" }>["activationCost"],
) =>
  activationCost === undefined ||
  (validNonnegativeNumber(activationCost.amount) &&
    (activationCost.minimum === undefined || validNonnegativeNumber(activationCost.minimum)));

const validActivationCostOverrideFrame = (
  activationCostOverride: Extract<
    ResolutionFrame,
    { readonly type: "effect" }
  >["activationCostOverride"],
) => activationCostOverride === undefined || validNonnegativeNumber(activationCostOverride);

const validEffectOperation = (
  operation: Extract<ResolutionFrame, { readonly type: "effect" }>["operation"],
) =>
  operation === undefined ||
  operation === "activate" ||
  operation === "deactivate" ||
  operation === "copy-move";

const validCopyMoveSelectionFrame = (
  state: FightState,
  frame: Extract<ResolutionFrame, { readonly type: "effect" }>,
) => {
  const sourceMove = MOVE_DEFINITIONS.find(
    (candidate) => candidate.id === frame.sourceDefinitionId,
  );
  const target = state.combatants[frame.targetCombatantId];
  const priorSourceIds = frame.eligibleSourceActionIds;
  const priorSourceValid =
    priorSourceIds === undefined
      ? true
      : priorSourceIds.length > 0 &&
        new Set(priorSourceIds).size === priorSourceIds.length &&
        priorSourceIds.every((sourceActionId) => {
          const action = state.actionHistory.find(
            (candidate): candidate is Extract<CombatActionRecord, { readonly type: "use-move" }> =>
              candidate.type === "use-move" && candidate.decisionId === sourceActionId,
          );
          const move =
            action === undefined
              ? undefined
              : MOVE_DEFINITIONS.find((candidate) => candidate.id === action.moveId);
          return (
            action !== undefined &&
            action.actorId !== frame.sourceCombatantId &&
            action.targetCombatantId === frame.sourceCombatantId &&
            action.outcome === "successful" &&
            Number.isFinite(action.damageDealt) &&
            (move?.category === "advanced-attack" || move?.category === "signature") &&
            move.mechanics.attack !== undefined &&
            frame.eligibleMoveIds?.includes(move.id) === true
          );
        });
  return (
    combatDecisionIdSchema.safeParse(frame.decisionId).success &&
    sourceMove?.effects?.[frame.effectIndex]?.type === "copy-move-effect" &&
    priorSourceValid &&
    (priorSourceIds !== undefined
      ? frame.eligibleMoveIds?.every((moveId) => typeof moveId === "string") === true
      : frame.eligibleMoveIds?.every((moveId) => {
          const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === moveId);
          return (
            target.moveIds.includes(moveId) &&
            move?.category === "advanced-attack" &&
            move.mechanics.attack !== undefined
          );
        }) === true)
  );
};

const validEffectSelectionFrame = (
  state: FightState,
  frame: Extract<ResolutionFrame, { readonly type: "effect" }>,
) => {
  if (
    !validActivationCostFrame(frame.activationCost) ||
    !validActivationCostOverrideFrame(frame.activationCostOverride)
  )
    return false;
  if (frame.pendingDecisionId === undefined) return true;
  if (state.status !== "active" || state.pendingDecision?.type !== "select-move") return false;
  if (state.pendingDecision.id !== frame.pendingDecisionId) return false;
  if (state.pendingDecision.combatantId !== frame.sourceCombatantId) return false;
  if (!validCounter(frame.remainingSelections ?? 0, 1)) return false;
  if (frame.optional !== undefined && typeof frame.optional !== "boolean") return false;
  if (frame.reactivationOnly !== undefined && typeof frame.reactivationOnly !== "boolean")
    return false;
  if (!validEffectOperation(frame.operation)) return false;
  if (frame.eligibleMoveIds === undefined || frame.eligibleMoveIds.length === 0) return false;
  if (new Set(frame.eligibleMoveIds).size !== frame.eligibleMoveIds.length) return false;
  if (frame.operation === "activate") {
    const target = state.combatants[frame.targetCombatantId];
    return frame.eligibleMoveIds.every((moveId) => {
      const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === moveId);
      return (
        target.moveIds.includes(moveId) &&
        move?.category === "skill" &&
        move.effectClauses.some((clause) => clause.text === "Constant.")
      );
    });
  }
  if (frame.operation === "copy-move") {
    return validCopyMoveSelectionFrame(state, frame);
  }
  return frame.eligibleMoveIds.every((moveId) =>
    state.activeEffects.some(
      (effect) =>
        effect.type === "active-constant" &&
        effect.sourceCombatantId === frame.targetCombatantId &&
        effect.sourceDefinitionId === moveId,
    ),
  );
};

const validEffectResolutionFrame = (
  state: FightState,
  frame: Extract<ResolutionFrame, { readonly type: "effect" }>,
) =>
  isActiveCombatant(state, frame.sourceCombatantId) &&
  isActiveCombatant(state, frame.targetCombatantId) &&
  typeof frame.sourceDefinitionId === "string" &&
  frame.sourceDefinitionId.length > 0 &&
  validCounter(frame.effectIndex, 0) &&
  validEffectSelectionFrame(state, frame);

const validEffectChoiceFrame = (
  state: FightState,
  frame: Extract<ResolutionFrame, { readonly type: "effect-choice" }>,
) => {
  const storedRollsValid =
    frame.effectTrigger === "on-power-up"
      ? frame.storedRolls === undefined
      : frame.storedRolls !== undefined &&
        frame.storedRolls.length > 0 &&
        frame.storedRolls.every((storedRoll) => {
          const sourceMove = MOVE_DEFINITIONS.find(
            (candidate) => candidate.id === storedRoll.sourceDefinitionId,
          );
          const sourceEffect = sourceMove?.effects?.find(
            (effect) =>
              effect.type === "roll-and-store" && effect.storageKey === storedRoll.storageKey,
          );
          return (
            state.combatants[frame.actorId].moveIds.includes(storedRoll.sourceDefinitionId) &&
            sourceEffect?.type === "roll-and-store" &&
            sourceEffect.target === "self" &&
            sourceEffect.dice === storedRoll.naturalResults.length &&
            storedRoll.sides === sourceEffect.sides &&
            storedRoll.naturalResults.every(
              (result) => Number.isInteger(result) && result >= 1 && result <= storedRoll.sides,
            ) &&
            Number.isInteger(storedRoll.storedOnTurn) &&
            storedRoll.storedOnTurn >= 1 &&
            storedRoll.storedOnTurn <= state.turnNumber
          );
        });
  return (
    state.status === "active" &&
    combatDecisionIdSchema.safeParse(frame.decisionId).success &&
    isActiveCombatant(state, frame.actorId) &&
    isActiveCombatant(state, frame.targetCombatantId) &&
    frame.actorId !== frame.targetCombatantId &&
    frame.returnPhase === "end" &&
    (frame.effectTrigger === "on-power-up" || frame.effectTrigger === "on-roll-result") &&
    storedRollsValid &&
    frame.sourceDefinitionId.length > 0 &&
    frame.effectIndices.length > 0 &&
    frame.effectIndices.every((index) => Number.isInteger(index) && index >= 0) &&
    new Set(frame.effectIndices).size === frame.effectIndices.length &&
    pendingDecisionIdSchema.safeParse(frame.pendingDecisionId).success &&
    state.pendingDecision?.id === frame.pendingDecisionId &&
    state.pendingDecision.type === "optional-effect" &&
    state.pendingDecision.combatantId === frame.actorId
  );
};

const validateResolutionFrames = (
  state: FightState,
  violations: FightStateInvariantViolation[],
) => {
  const frameIds = new Set<string>();

  for (const frame of state.resolutionFrames) {
    const validCommon =
      resolutionFrameIdSchema.safeParse(frame.id).success && !frameIds.has(frame.id);
    let validFrame = false;
    if (validCommon) {
      switch (frame.type) {
        case "attack":
          validFrame = validAttackResolutionFrame(state, frame);
          if (validFrame && frame.stage === "awaiting-effect-choice")
            validFrame = validEffectAlternatives(frame);
          break;
        case "effect":
          validFrame = validEffectResolutionFrame(state, frame);
          break;
        case "effect-choice":
          validFrame = validEffectChoiceFrame(state, frame);
          break;
      }
    }

    if (!validFrame) {
      addViolation(
        violations,
        "invalid-resolution-frame",
        "Resolution frames must have unique valid IDs and reference active combatants and resumable work.",
        frame.id,
      );
    }
    frameIds.add(frame.id);
  }
};

const validateFightMetadata = (
  state: FightState,
  combatantEntries: readonly [string, CombatantState][],
  violations: FightStateInvariantViolation[],
) => {
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
};

const validPendingDecision = (state: ActiveFightState) => {
  const { pendingDecision } = state;
  if (pendingDecision === undefined) return true;
  const selectableMoveIsEligible = (moveId: string) =>
    state.resolutionFrames.some(
      (frame) =>
        frame.type === "effect" &&
        frame.pendingDecisionId === pendingDecision.id &&
        frame.eligibleMoveIds?.includes(moveId) === true &&
        (frame.operation === "activate" || frame.operation === "copy-move"
          ? state.combatants[frame.targetCombatantId].moveIds.includes(moveId)
          : state.activeEffects.some(
              (effect) =>
                effect.type === "active-constant" &&
                effect.sourceCombatantId === frame.targetCombatantId &&
                effect.sourceDefinitionId === moveId,
            )),
    );
  const validOptions = pendingDecision.options.every(
    (option) =>
      option.id.length > 0 &&
      (option.combatantId === undefined || isActiveCombatant(state, option.combatantId)) &&
      (option.itemId === undefined ||
        state.combatants[pendingDecision.combatantId].itemIds?.includes(option.itemId)) &&
      (option.effectIndices === undefined ||
        (option.effectIndices.length > 0 &&
          option.effectIndices.every((index) => Number.isInteger(index) && index >= 0))) &&
      (option.moveId === undefined ||
        (pendingDecision.type === "select-move"
          ? selectableMoveIsEligible(option.moveId)
          : state.combatants[pendingDecision.combatantId].moveIds.includes(option.moveId))),
  );
  return (
    pendingDecisionIdSchema.safeParse(pendingDecision.id).success &&
    pendingDecision.stateVersion === state.version &&
    isActiveCombatant(state, pendingDecision.combatantId) &&
    pendingDecision.options.length > 0 &&
    new Set(pendingDecision.options.map((option) => option.id)).size ===
      pendingDecision.options.length &&
    validOptions &&
    (pendingDecision.type !== "select-move" ||
      (() => {
        const frame = state.resolutionFrames.find(
          (candidate): candidate is Extract<ResolutionFrame, { readonly type: "effect" }> =>
            candidate.type === "effect" && candidate.pendingDecisionId === pendingDecision.id,
        );
        const declineOptions = pendingDecision.options.filter(
          (option) => option.type === "decline",
        );
        return (
          frame !== undefined &&
          declineOptions.length <= 1 &&
          (frame.optional === true ? declineOptions.length === 1 : declineOptions.length === 0)
        );
      })())
  );
};

const validatePendingDecision = (
  state: ActiveFightState,
  violations: FightStateInvariantViolation[],
) => {
  const { pendingDecision } = state;
  if (pendingDecision !== undefined && !validPendingDecision(state)) {
    addViolation(
      violations,
      "invalid-pending-decision",
      "A pending decision must target an active combatant, match the state version, and have unique options.",
      pendingDecision.id,
    );
  }
};

type PostDefenseReactionFrame = Extract<
  ResolutionFrame,
  { readonly stage: "awaiting-post-defense-reaction" }
>;

const validPostDefenseNaturalRolls = (frame: PostDefenseReactionFrame | undefined) => {
  if (frame === undefined || frame.naturalRolls.length === 0) return false;
  if (frame.resultOverrides.length !== frame.naturalRolls.length) return false;
  if (frame.numericResultOverrides.length !== frame.naturalRolls.length) return false;
  const validResultOverrides = frame.resultOverrides.every(
    (outcome) => outcome === undefined || outcome === "stopped" || outcome === "successful",
  );
  const validNumericOverrides = frame.numericResultOverrides.every(
    (override) =>
      override === undefined ||
      ((override.attack === undefined || Number.isFinite(override.attack)) &&
        (override.defense === undefined || Number.isFinite(override.defense))),
  );
  const validNaturalResults = frame.naturalRolls.every(
    (roll) => validCounter(roll.attack, 1) && validCounter(roll.defense, 1),
  );
  return validResultOverrides && validNumericOverrides && validNaturalResults;
};

const validPostDefenseReactionMatch = (
  frames: readonly PostDefenseReactionFrame[],
  pending: { readonly id: string; readonly combatantId: CombatantId } | undefined,
) => {
  const frame = frames.at(0);
  return (
    frames.length === 1 &&
    frame !== undefined &&
    pending !== undefined &&
    frame.pendingDecisionId === pending.id &&
    frame.reactionCombatantId === pending.combatantId &&
    validPostDefenseNaturalRolls(frame)
  );
};

const validatePostDefenseRollFrames = (
  state: ActiveFightState,
  violations: FightStateInvariantViolation[],
) => {
  const postRollFrames = state.resolutionFrames.filter(
    (frame) => frame.type === "attack" && frame.stage === "awaiting-post-defense-reaction",
  );
  const postRollPending =
    state.pendingDecision?.type === "post-defense-roll" ? state.pendingDecision : undefined;
  if (postRollPending === undefined && postRollFrames.length === 0) return;
  if (!validPostDefenseReactionMatch(postRollFrames, postRollPending)) {
    addViolation(
      violations,
      "invalid-resolution-frame",
      "A post-defense reaction must have exactly one matching frame with persisted natural dice.",
    );
  }
};

const validateAttackFrames = (
  state: ActiveFightState,
  violations: FightStateInvariantViolation[],
) => {
  const counterFrames = state.resolutionFrames.filter(
    (frame) => frame.type === "attack" && frame.stage === "awaiting-counter",
  );
  if (
    (state.phase === "counter" && counterFrames.length === 0) ||
    (state.phase !== "counter" && counterFrames.length > 0)
  ) {
    addViolation(
      violations,
      "invalid-resolution-frame",
      "Counter phase must have an awaiting-counter attack frame, and those frames require counter phase.",
    );
  }

  const defenseFrames = state.resolutionFrames.filter(
    (frame) => frame.type === "attack" && frame.stage === "awaiting-defense",
  );
  const defensePending =
    state.pendingDecision?.type === "defense-response" ? state.pendingDecision : undefined;
  const defenseFrame = defenseFrames.at(0);
  if (
    (defensePending === undefined && defenseFrames.length > 0) ||
    (defensePending !== undefined &&
      (defenseFrames.length !== 1 ||
        defenseFrame === undefined ||
        defenseFrame.pendingDecisionId !== defensePending.id ||
        defenseFrame.targetCombatantId !== defensePending.combatantId))
  ) {
    addViolation(
      violations,
      "invalid-resolution-frame",
      "A defense response must have exactly one matching awaiting-defense attack frame.",
    );
  }

  validatePostDefenseRollFrames(state, violations);
};

const validatePendingDecisionAndFrames = (
  state: ActiveFightState,
  violations: FightStateInvariantViolation[],
) => {
  validatePendingDecision(state, violations);
  validateAttackFrames(state, violations);
};

const validateActiveFight = (
  state: ActiveFightState,
  violations: FightStateInvariantViolation[],
) => {
  if (!isActiveCombatant(state, state.activeCombatantId)) {
    addViolation(
      violations,
      "invalid-active-combatant",
      "An active fight must identify an active combatant.",
      state.activeCombatantId,
    );
  }
  if (
    Object.values(state.combatants).filter((combatant) => combatant.status === "active").length !==
    2
  ) {
    addViolation(
      violations,
      "invalid-active-combatant",
      "An active fight in the initial 1v1 scope must have two active combatants.",
    );
  }
  validatePendingDecisionAndFrames(state, violations);
};

const validateCompletedFight = (
  state: CompletedFightState,
  violations: FightStateInvariantViolation[],
) => {
  const { completion } = state;
  const { winnerCombatantId: winner } = completion;
  const requiresWinner = completion.type === "defeat" || completion.type === "surrender";

  if (
    (requiresWinner && winner === undefined) ||
    (winner !== undefined && combatantForId(state, winner) === undefined)
  ) {
    addViolation(
      violations,
      "invalid-completion",
      "Completed defeat and surrender fights require an existing winner.",
    );
  }
  if (state.activeEffects.length > 0 || state.resolutionFrames.length > 0) {
    addViolation(
      violations,
      "invalid-completion",
      "A completed fight must not retain unresolved active effects or resolution frames.",
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

  validateFightMetadata(state, combatantEntries, violations);

  for (const [recordId, combatant] of combatantEntries) {
    validateCombatant(recordId, combatant, state.turnNumber, violations);
    validateCombatantReferences(state, combatant, violations);
  }
  validateActiveEffects(state, violations);
  validateActionHistory(state, violations);
  validateResolutionFrames(state, violations);

  if (state.status === "active") {
    validateActiveFight(state, violations);
  } else {
    validateCompletedFight(state, violations);
  }

  return violations;
};
