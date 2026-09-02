import {
  activeEffectIdSchema,
  combatDecisionIdSchema,
  combatantIdSchema,
  pendingDecisionIdSchema,
  resolutionFrameIdSchema,
  scheduledWorkIdSchema,
} from "./ids.js";
import type { CombatantId, PendingDecisionId } from "./ids.js";
import type {
  ActiveFightState,
  ActiveCombatEffect,
  ActiveCostModifierEffect,
  AttackDieCandidateSnapshot,
  CombatActionRecord,
  CombatResources,
  CombatSourceReference,
  CombatantState,
  CombatantTransformationProfile,
  CompletedFightState,
  CounterActionReference,
  FightState,
  FightStateInvariantViolation,
  PendingDecisionOption,
  PendingDecision,
  ResourceChangeHistoryRecord,
  ResolutionFrame,
} from "./contracts.js";
import {
  CANONICAL_COMBAT_MECHANICS_VIEW,
  mechanicsViewForState,
  type CombatMechanicsView,
} from "./mechanics-view.js";
import type { ScheduledCombatOperation, ScheduledCombatWork } from "./fight-flow-scheduler.js";
import { matchesMoveSelector } from "./declarative-runtime.js";
import { conflictKeyFor, conflictMatchKeyFor, conflictPolicyFor } from "./conflict-policy.js";
import { candidateReferenceId } from "./candidate-resolution.js";
import {
  hasKnownLifecycleEncoding,
  isEffectActive,
  isValidEffectLifecycle,
  lifecycleRecordForEffect,
} from "./effect-lifecycle.js";

// Invariants validate serializable runtime data even when the in-memory union
// type has already narrowed a discriminant to one literal value.
const runtimeValue = (value: unknown): unknown => value;
const mechanicsFor = (state: FightState | undefined) =>
  state === undefined ? CANONICAL_COMBAT_MECHANICS_VIEW : mechanicsViewForState(state);

const validCounter = (value: number, minimum: number) =>
  Number.isFinite(value) && Number.isInteger(value) && value >= minimum;

const validNonnegativeNumber = (value: number) => Number.isFinite(value) && value >= 0;

const knownRaceTraitIdsFor = (state: FightState) =>
  new Set(mechanicsFor(state).races.flatMap((race) => race.racialTraits.map((trait) => trait.id)));
const knownClassIdsFor = (state: FightState) =>
  new Set([
    ...mechanicsFor(state).races.flatMap((race) =>
      race.classes.map((classDefinition) => classDefinition.id),
    ),
    ...mechanicsFor(state).genericClasses.map((classDefinition) => classDefinition.id),
  ]);

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
  state: FightState,
  combatant: CombatantState,
  recordId: string,
  violations: FightStateInvariantViolation[],
) => {
  for (const [statName, statValue] of Object.entries(combatant.stats)) {
    const validStat =
      statName === "dexterityBonus"
        ? Number.isFinite(statValue) &&
          statValue >= mechanicsFor(state).rules.combat.minimumDexterityBonus &&
          statValue <= mechanicsFor(state).rules.combat.maximumDexterityBonus
        : validNonnegativeNumber(statValue);
    if (!validStat) {
      addViolation(
        violations,
        "invalid-stat",
        statName === "dexterityBonus"
          ? `dexterityBonus must be a finite number from ${mechanicsFor(state).rules.combat.minimumDexterityBonus} through ${mechanicsFor(state).rules.combat.maximumDexterityBonus}.`
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

const validateInnateSelections = (
  state: FightState,
  combatant: CombatantState,
  recordId: string,
  violations: FightStateInvariantViolation[],
) => {
  if (combatant.raceTraitIds !== undefined) {
    if (new Set(combatant.raceTraitIds).size !== combatant.raceTraitIds.length)
      addViolation(
        violations,
        "invalid-combatant-identity",
        "Combatant race trait IDs must not contain duplicates.",
        recordId,
      );
    for (const traitId of combatant.raceTraitIds)
      if (!knownRaceTraitIdsFor(state).has(traitId))
        addViolation(
          violations,
          "invalid-combatant-identity",
          `Combatant references an unknown race trait ID: ${traitId}.`,
          recordId,
        );
  }
  if (combatant.classId !== undefined && !knownClassIdsFor(state).has(combatant.classId))
    addViolation(
      violations,
      "invalid-combatant-identity",
      `Combatant references an unknown class ID: ${combatant.classId}.`,
      recordId,
    );
};

const combatSlots = ["mastery", "skill", "advanced-attack", "signature", "block"] as const;

const validateSlotCapacities = (
  state: FightState,
  combatant: CombatantState,
  recordId: string,
  violations: FightStateInvariantViolation[],
  // eslint-disable-next-line complexity -- Invariant validation intentionally centralizes serialized-state checks.
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
    const sourceReference = modification.sourceReference;
    const sourceMove =
      sourceReference?.kind === "move" || sourceReference === undefined
        ? mechanicsFor(state).moves.find(
            (candidate) => candidate.id === modification.sourceDefinitionId,
          )
        : undefined;
    const sourceEffect =
      sourceMove?.effects?.[modification.sourceEffectIndex] ??
      sourceEffectForReference(state, sourceReference, modification.sourceEffectIndex);
    const validInnateReference =
      sourceReference !== undefined &&
      sourceReference.kind !== "move" &&
      sourceReference.definitionId === modification.sourceDefinitionId &&
      sourceEffect?.type === "modify-slot-capacity";
    if (
      modification.sourceCombatantId !== combatant.id ||
      (sourceReference === undefined &&
        !combatant.moveIds.includes(modification.sourceDefinitionId)) ||
      (sourceReference !== undefined &&
        !validInnateReference &&
        !(
          sourceReference.kind === "move" &&
          combatant.moveIds.includes(modification.sourceDefinitionId)
        )) ||
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

const sourceEffectForReference = (
  state: FightState,
  reference: CombatSourceReference | undefined,
  index: number,
) => {
  if (reference?.kind === "race-trait")
    return mechanicsFor(state)
      .races.flatMap((race) => race.racialTraits)
      .find((trait) => trait.id === reference.definitionId)?.effects?.[index];
  if (reference?.kind === "race-class")
    return mechanicsFor(state)
      .races.flatMap((race) => race.classes)
      .find((classDefinition) => classDefinition.id === reference.definitionId)?.effects?.[index];
  if (reference?.kind === "generic-class")
    return mechanicsFor(state).genericClasses.find(
      (classDefinition) => classDefinition.id === reference.definitionId,
    )?.effects?.[index];
  if (reference?.kind === "transformation-ability") {
    const [transformationId] = reference.definitionId.split(/:(?=[^:]+$)/u);
    return mechanicsFor(state).transformations.find(
      (transformation) => transformation.id === transformationId,
    )?.abilities[reference.mastery].effects?.[index];
  }
  return undefined;
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
  state: FightState,
  combatant: CombatantState,
  recordId: string,
  violations: FightStateInvariantViolation[],
) => {
  for (const [moveId, modifier] of Object.entries(combatant.moveUseLimitModifiers ?? {})) {
    const move = mechanicsFor(state).moves.find((candidate) => candidate.id === moveId);
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
  state: FightState,
  combatant: CombatantState,
  recordId: string,
  turnNumber: number,
  violations: FightStateInvariantViolation[],
  // eslint-disable-next-line complexity -- Invariant validation intentionally centralizes serialized-state checks.
) => {
  for (const [storageKey, storedRoll] of Object.entries(combatant.storedRolls ?? {})) {
    const sourceMove = mechanicsFor(state).moves.find(
      (candidate) => candidate.id === storedRoll.sourceDefinitionId,
    );
    const sourceInnate = [
      ...mechanicsFor(state).races.flatMap((race) => [...race.racialTraits, ...race.classes]),
      ...mechanicsFor(state).genericClasses,
    ].find((candidate) => candidate.id === storedRoll.sourceDefinitionId);
    const sourceEffect = (sourceMove?.effects ?? sourceInnate?.effects)?.find(
      (effect) => effect.type === "roll-and-store" && effect.storageKey === storageKey,
    );
    const validSourceEffect =
      sourceEffect?.type === "roll-and-store" && sourceEffect.target === "self";
    const sourceIsOwned =
      combatant.moveIds.includes(storedRoll.sourceDefinitionId as never) ||
      combatant.raceTraitIds?.includes(storedRoll.sourceDefinitionId) === true ||
      combatant.classId === storedRoll.sourceDefinitionId;
    const validResults =
      storedRoll.naturalResults.length > 0 &&
      storedRoll.naturalResults.every(
        (result) => Number.isInteger(result) && result >= 1 && result <= storedRoll.sides,
      );
    if (
      storedRoll.storageKey !== storageKey ||
      !storedRollKeyPattern.test(storageKey) ||
      !sourceIsOwned ||
      !validSourceEffect ||
      storedRoll.naturalResults.length !==
        (runtimeValue(sourceEffect.type) === "roll-and-store" ? sourceEffect.dice : 0) ||
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
  state: FightState,
  combatant: CombatantState,
  recordId: string,
  turnNumber: number,
  violations: FightStateInvariantViolation[],
  // eslint-disable-next-line complexity -- Invariant validation intentionally centralizes serialized-state checks.
) => {
  for (const [selectionKey, selection] of Object.entries(combatant.storedMoveSelections ?? {})) {
    const sourceMove = mechanicsFor(state).moves.find(
      (candidate) => candidate.id === selection.sourceDefinitionId,
    );
    const sourceEffect = sourceMove?.effects?.find(
      (effect) =>
        effect.type === "select-move-by-stored-roll" && effect.selectionKey === selectionKey,
    );
    const persistentSourceEffect = sourceMove?.effects?.find(
      (effect, effectIndex) =>
        effect.type === "copy-move-effect" &&
        `copy-move-${selection.sourceDefinitionId}-${effectIndex}` === selectionKey,
    );
    const selectedMove = mechanicsFor(state).moves.find(
      (candidate) => candidate.id === selection.moveId,
    );
    const validStoredRollSource =
      sourceEffect?.type === "select-move-by-stored-roll" &&
      sourceEffect.target === "self" &&
      sourceEffect.storageKey.length > 0;
    const validPersistentCopySource =
      persistentSourceEffect?.type === "copy-move-effect" &&
      persistentSourceEffect.trigger === "on-success" &&
      persistentSourceEffect.target === "self" &&
      persistentSourceEffect.sourceMove.type === "selected-move" &&
      persistentSourceEffect.sourceMove.actor === "self" &&
      persistentSourceEffect.sourceMove.category === "advanced-attack" &&
      persistentSourceEffect.sourceMove.restriction === "unrestricted" &&
      persistentSourceEffect.sourceMove.styleId !== undefined;
    const validSourceEffect =
      combatant.moveIds.includes(selection.sourceDefinitionId) &&
      (validStoredRollSource || validPersistentCopySource);
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

// eslint-disable-next-line complexity -- Invariant validation intentionally centralizes serialized-state checks.
const hasValidStatusDetails = (combatant: CombatantState, statusIndex: number) => {
  const activeStatus = combatant.activeStatuses[statusIndex];
  const priorStatuses = combatant.activeStatuses.slice(0, statusIndex);
  const selector: unknown = activeStatus.selector;
  const validSelector =
    selector === undefined ||
    (typeof selector === "object" &&
      selector !== null &&
      "type" in selector &&
      selector.type === "move-selector");
  const validDuration =
    activeStatus.duration.type === "combat" ||
    (activeStatus.duration.type === "turns" && validCounter(activeStatus.duration.remaining, 1)) ||
    (activeStatus.duration.type === "until-turn-start-roll-threshold" &&
      validCounter(activeStatus.duration.dice, 1) &&
      validCounter(activeStatus.duration.sides, 1) &&
      validCounter(activeStatus.duration.remainingIgnoredChecks, 0) &&
      Number.isFinite(activeStatus.duration.value)) ||
    (activeStatus.duration.type === "uses" && validCounter(activeStatus.duration.remaining, 1));

  return (
    typeof activeStatus.statusId === "string" &&
    activeStatus.statusId.length > 0 &&
    typeof activeStatus.sourceDefinitionId === "string" &&
    activeStatus.sourceDefinitionId.length > 0 &&
    validSelector &&
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
  state: FightState,
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

  validateCombatantStats(state, combatant, recordId, violations);
  validateInnateSelections(state, combatant, recordId, violations);
  validateSlotCapacities(state, combatant, recordId, violations);

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
  validateMoveUseLimitModifiers(state, combatant, recordId, violations);
  validateEffectUseCounts(combatant, recordId, violations);
  validateItemUses(combatant, recordId, violations);
  validateStoredRolls(state, combatant, recordId, turnNumber, violations);
  validateStoredMoveSelections(state, combatant, recordId, turnNumber, violations);
  validateActiveStatuses(combatant, recordId, violations);
};

const combatantForId = (state: FightState, combatantId: string) => {
  if (!Object.hasOwn(state.combatants, combatantId)) return undefined;

  return state.combatants[combatantId as CombatantId];
};

const isActiveCombatant = (state: FightState, combatantId: string) =>
  combatantForId(state, combatantId)?.status === "active";

const masteryForRollSides = (
  rollSides: number,
): CombatantTransformationProfile["mastery"] | undefined => {
  if (rollSides >= 20 && rollSides <= 40) return "novice";
  if (rollSides >= 50 && rollSides <= 70) return "intermediate";
  if (rollSides >= 80 && rollSides <= 100) return "mastered";
  return undefined;
};

const validateTransformationProfiles = (
  state: FightState,
  combatant: CombatantState,
  violations: FightStateInvariantViolation[],
) => {
  const profileIds = new Set<string>();
  for (const profile of combatant.transformationProfiles ?? []) {
    const transformationDefinition = mechanicsFor(state).transformations.find(
      (candidate) => candidate.id === profile.transformationId,
    );
    const expectedMastery = masteryForRollSides(profile.rollSides);
    const invalid =
      profileIds.has(profile.transformationId) ||
      transformationDefinition === undefined ||
      (combatant.raceId !== undefined && transformationDefinition.raceId !== combatant.raceId) ||
      !Number.isInteger(profile.rollSides) ||
      profile.rollSides < 1 ||
      profile.rollSides > 100 ||
      (expectedMastery !== undefined && expectedMastery !== profile.mastery);
    if (invalid)
      addViolation(
        violations,
        "invalid-transformation",
        "Transformation profiles must be unique, known, owned by the race, and have valid mastery.",
        combatant.id,
      );
    profileIds.add(profile.transformationId);
  }
};

const validateTransformationCooldown = (
  combatant: CombatantState,
  violations: FightStateInvariantViolation[],
) => {
  const cooldown = combatant.transformationCooldown;
  if (
    cooldown !== undefined &&
    (!Number.isInteger(cooldown.remainingOwnerTurns) || cooldown.remainingOwnerTurns < 1)
  )
    addViolation(
      violations,
      "invalid-transformation",
      "Transformation cooldown must contain a positive remaining owner-turn count.",
      combatant.id,
    );
};

const validateActiveStatusReferences = (
  state: FightState,
  combatant: CombatantState,
  violations: FightStateInvariantViolation[],
) => {
  for (const activeStatus of combatant.activeStatuses) {
    const validDurationOwner =
      (activeStatus.duration.type !== "turns" ||
        combatantForId(state, activeStatus.duration.ownerCombatantId) !== undefined) &&
      (activeStatus.duration.type !== "until-turn-start-roll-threshold" ||
        isActiveCombatant(state, activeStatus.duration.combatantId));
    if (combatantForId(state, activeStatus.sourceCombatantId) === undefined || !validDurationOwner)
      addViolation(
        violations,
        "invalid-status",
        "Active statuses must reference existing combatants for their source and turn owner.",
        combatant.id,
      );
  }
};

const validateCombatantReferences = (
  state: FightState,
  combatant: CombatantState,
  violations: FightStateInvariantViolation[],
) => {
  if (
    combatant.raceId !== undefined &&
    !mechanicsFor(state).races.some((race) => race.id === combatant.raceId)
  )
    addViolation(
      violations,
      "invalid-transformation",
      `Combatant references unknown race ${combatant.raceId}.`,
      combatant.id,
    );
  validateTransformationProfiles(state, combatant, violations);
  validateTransformationCooldown(combatant, violations);
  validateActiveStatusReferences(state, combatant, violations);

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
  if (
    transformation?.baseline !== undefined &&
    (!Number.isFinite(transformation.baseline.maximumHitPoints) ||
      transformation.baseline.maximumHitPoints <= 0 ||
      (transformation.baseline.hpBonus !== undefined &&
        (!Number.isFinite(transformation.baseline.hpBonus) || transformation.baseline.hpBonus < 0)))
  )
    addViolation(
      violations,
      "invalid-transformation",
      "Transformation baseline HP values must be finite and positive.",
      combatant.id,
    );
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

// eslint-disable-next-line complexity -- Invariant validation intentionally centralizes serialized-state checks.
const hasValidRollEffectDetails = (effect: Extract<ActiveCombatEffect, { type: "modify-roll" }>) =>
  (effect.roll === "attack" ||
    effect.roll === "defense" ||
    effect.roll === "escape" ||
    effect.roll === "initiative" ||
    runtimeValue(effect.roll) === "transformation") &&
  (effect.modifier === "dice" ||
    effect.modifier === "result" ||
    runtimeValue(effect.modifier) === "sides") &&
  (effect.cap === undefined ||
    (effect.cap.type === "allow-exceed"
      ? effect.cap.scope === "amount" ||
        effect.cap.scope === "total" ||
        runtimeValue(effect.cap.scope) === "roll"
      : (effect.cap.type === "maximum" || runtimeValue(effect.cap.type) === "minimum") &&
        (effect.cap.scope === "amount" ||
          effect.cap.scope === "total" ||
          runtimeValue(effect.cap.scope) === "roll") &&
        Number.isFinite(effect.cap.value))) &&
  Number.isFinite(effect.amount) &&
  (effect.duration === "combat" ||
    ((effect.duration.type === "turns" ||
      runtimeValue(effect.duration.type) === "turns-or-until-perfect-roll") &&
      typeof effect.duration.ownerCombatantId === "string" &&
      validCounter(effect.duration.remaining, 1))) &&
  typeof effect.sourceDefinitionId === "string" &&
  effect.sourceDefinitionId.length > 0;

// eslint-disable-next-line complexity -- Invariant validation intentionally centralizes serialized-state checks.
const hasValidRerollEffectDetails = (effect: Extract<ActiveCombatEffect, { type: "reroll" }>) =>
  (effect.roll === "attack" || runtimeValue(effect.roll) === "defense") &&
  (effect.rerollScope === "single-result" ||
    runtimeValue(effect.rerollScope) === "entire-attack") &&
  typeof effect.optional === "boolean" &&
  Number.isFinite(effect.bonus) &&
  (effect.activationCost === undefined || effect.activationResource === "ki") &&
  (effect.activationCost === undefined || validNonnegativeNumber(effect.activationCost)) &&
  (effect.useLimit === undefined ||
    (validCounter(effect.useLimit.remaining, 0) &&
      (effect.useLimit.scope === "combat" || runtimeValue(effect.useLimit.scope) === "turn"))) &&
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
  // eslint-disable-next-line complexity -- Invariant validation intentionally centralizes serialized-state checks.
) =>
  (effect.outcome === "successful" || runtimeValue(effect.outcome) === "stopped") &&
  (effect.roll === "attack" || runtimeValue(effect.roll) === "defense") &&
  (effect.comparison === "at-least" || runtimeValue(effect.comparison) === "at-most") &&
  (effect.relativeTo === undefined
    ? effect.relativeOperation === undefined
    : (effect.relativeTo === "attack-roll" || runtimeValue(effect.relativeTo) === "defense-roll") &&
      (effect.relativeOperation === "add" || effect.relativeOperation === "multiply") &&
      ((effect.relativeTo === "attack-roll" && effect.roll === "defense") ||
        (effect.relativeTo === "defense-roll" && effect.roll === "attack"))) &&
  (effect.resultScope === "current-attack" ||
    runtimeValue(effect.resultScope) === "matching-die") &&
  (effect.appliesTo === "source" || runtimeValue(effect.appliesTo) === "target") &&
  (effect.scope === undefined || runtimeValue(effect.scope) === "next-action") &&
  Number.isFinite(effect.value) &&
  (effect.duration.type === "combat" ||
    (runtimeValue(effect.duration.type) === "until-roll-threshold" &&
      (effect.duration.roll === "attack" || runtimeValue(effect.duration.roll) === "defense") &&
      (effect.duration.comparison === "at-least" ||
        runtimeValue(effect.duration.comparison) === "at-most") &&
      Number.isFinite(effect.duration.value))) &&
  typeof effect.sourceDefinitionId === "string" &&
  effect.sourceDefinitionId.length > 0;

const isValidCombatResultModifier = (
  modifier: Extract<ActiveCombatEffect, { type: "modify-next-action" }>["modifier"],
  scope: string,
) =>
  modifier.type !== "combat-result" ||
  (scope === "next-action" &&
    (modifier.result === "successful" || runtimeValue(modifier.result) === "stopped") &&
    (modifier.resultScope === "current-attack" ||
      runtimeValue(modifier.resultScope) === "matching-die"));

const hasValidCostModifierDetails = (
  modifier: Extract<ActiveCombatEffect, { type: "modify-next-action" }>["modifier"],
) => {
  if (modifier.type !== "cost") return true;
  const validOperation = modifier.operation === "add" || runtimeValue(modifier.operation) === "set";
  const validBounds =
    (modifier.minimum === undefined || Number.isFinite(modifier.minimum)) &&
    (modifier.maximum === undefined || Number.isFinite(modifier.maximum));
  const validExpression =
    modifier.amountExpression === undefined ||
    (runtimeValue(modifier.amountExpression.type) === "next-move-ki-cost" &&
      (modifier.amountExpression.actor === "self" ||
        runtimeValue(modifier.amountExpression.actor) === "opponent"));
  return validOperation && validBounds && validExpression;
};

const hasValidNextActionModifierDetails = (
  effect: Extract<ActiveCombatEffect, { type: "modify-next-action" }>,
  // eslint-disable-next-line complexity, max-lines-per-function, sonarjs/cognitive-complexity -- Invariant validation intentionally centralizes serialized-state checks.
) => {
  const scope = effect.scope ?? "next-action";
  const validScope =
    scope === "next-action" ||
    scope === "following-action" ||
    scope === "next-roll" ||
    scope === "next-actions" ||
    scope === "next-rolls" ||
    scope === "next-phase" ||
    runtimeValue(scope) === "next-turn";
  const validRemaining = effect.remaining === undefined || validCounter(effect.remaining, 1);
  const validFollowingTurn =
    effect.availableFromTurn === undefined || validCounter(effect.availableFromTurn, 1);
  const validDamageOperation =
    effect.modifier.type !== "damage" ||
    effect.modifier.operation === undefined ||
    effect.modifier.operation === "add" ||
    effect.modifier.operation === "multiply" ||
    runtimeValue(effect.modifier.operation) === "set";
  const validDamageBasis =
    effect.modifier.type !== "damage" ||
    effect.modifier.basis === undefined ||
    effect.modifier.basis === "power-percent" ||
    runtimeValue(effect.modifier.basis) === "damage-percent";
  const validResourceOperation =
    effect.modifier.type !== "resource" ||
    effect.modifier.operation === "drain" ||
    effect.modifier.operation === "gain" ||
    effect.modifier.operation === "lose" ||
    runtimeValue(effect.modifier.operation) === "set";
  const validResourceCostOperation =
    effect.modifier.type !== "resource-cost" ||
    (runtimeValue(effect.modifier.resource) === "hp" &&
      runtimeValue(effect.modifier.operation) === "add");
  const validCostModifierDetails =
    effect.modifier.type !== "cost-modifier" || Number.isFinite(effect.modifier.multiplier);
  const validResourceModifierDetails =
    effect.modifier.type !== "resource-modifier" ||
    ((effect.modifier.resource === "hp" || runtimeValue(effect.modifier.resource) === "ki") &&
      (effect.modifier.operation === "gain" ||
        runtimeValue(effect.modifier.operation) === "lose") &&
      Number.isFinite(effect.modifier.multiplier) &&
      (effect.modifier.cap === undefined ||
        (runtimeValue(effect.modifier.cap.type) === "maximum" &&
          Number.isFinite(effect.modifier.cap.value))));
  const validCreatedAfterActionCount =
    effect.createdAfterActionCount === undefined || validCounter(effect.createdAfterActionCount, 0);
  const validRollCap = (
    cap: NonNullable<Extract<ActiveCombatEffect, { type: "modify-roll" }>["cap"]>,
  ) =>
    cap.type === "allow-exceed"
      ? cap.scope === "amount" || cap.scope === "total" || runtimeValue(cap.scope) === "roll"
      : Number.isFinite(cap.value) &&
        (cap.scope === "amount" || cap.scope === "total" || runtimeValue(cap.scope) === "roll");
  const validCombatResult = isValidCombatResultModifier(effect.modifier, scope);
  const validRollDefinition =
    effect.modifier.type !== "roll-definition" ||
    ((effect.modifier.roll === "attack" || runtimeValue(effect.modifier.roll) === "defense") &&
      (effect.modifier.dice === undefined || validCounter(effect.modifier.dice, 1)) &&
      validCounter(effect.modifier.sides, 1));
  const validModifierDetails =
    effect.modifier.type === "damage" ||
    (effect.modifier.type === "stat" &&
      (effect.modifier.stat === "dexterity" ||
        runtimeValue(effect.modifier.stat) === "dexterity-bonus") &&
      (effect.modifier.operation === "add" ||
        effect.modifier.operation === "set" ||
        runtimeValue(effect.modifier.operation) === "multiply") &&
      (effect.modifier.roll === undefined ||
        effect.modifier.roll === "attack" ||
        runtimeValue(effect.modifier.roll) === "defense")) ||
    (effect.modifier.type === "roll" &&
      (effect.modifier.roll === "attack" ||
        effect.modifier.roll === "defense" ||
        effect.modifier.roll === "escape" ||
        effect.modifier.roll === "initiative" ||
        runtimeValue(effect.modifier.roll) === "transformation") &&
      (effect.modifier.modifier === "dice" ||
        effect.modifier.modifier === "result" ||
        runtimeValue(effect.modifier.modifier) === "sides") &&
      (effect.modifier.cap === undefined || validRollCap(effect.modifier.cap))) ||
    (effect.modifier.type === "roll-result" &&
      (effect.modifier.roll === "attack" || effect.modifier.roll === "defense") &&
      effect.modifier.resultScope === "matching-die" &&
      Number.isFinite(effect.modifier.value)) ||
    (effect.modifier.type === "resource" &&
      (effect.modifier.resource === "hp" || runtimeValue(effect.modifier.resource) === "ki") &&
      runtimeValue(effect.modifier.basis) === "damage-percent") ||
    effect.modifier.type === "resource-cost" ||
    effect.modifier.type === "cost-modifier" ||
    effect.modifier.type === "resource-modifier" ||
    effect.modifier.type === "cost" ||
    effect.modifier.type === "combat-result" ||
    effect.modifier.type === "roll-definition" ||
    (effect.modifier.type === "combat-outcome" &&
      (effect.modifier.outcome === "break" ||
        effect.modifier.outcome === "sever" ||
        runtimeValue(effect.modifier.outcome) === "stun") &&
      Number.isFinite(effect.modifier.multiplier));
  return (
    validDamageOperation &&
    validDamageBasis &&
    validResourceOperation &&
    validResourceCostOperation &&
    validCostModifierDetails &&
    validResourceModifierDetails &&
    hasValidCostModifierDetails(effect.modifier) &&
    validCombatResult &&
    validRollDefinition &&
    validModifierDetails &&
    typeof effect.sourceDefinitionId === "string" &&
    effect.sourceDefinitionId.length > 0 &&
    validScope &&
    validRemaining &&
    validFollowingTurn &&
    validCreatedAfterActionCount &&
    (scope === "next-actions" || scope === "next-rolls"
      ? effect.remaining !== undefined
      : effect.remaining === undefined) &&
    (scope === "following-action" || scope === "next-turn"
      ? effect.availableFromTurn !== undefined
      : effect.availableFromTurn === undefined)
  );
};

const hasValidDamageModifierDetails = (
  effect: Extract<ActiveCombatEffect, { type: "modify-damage" }>,
  // eslint-disable-next-line complexity -- Invariant validation intentionally centralizes serialized-state checks.
) => {
  const duration = effect.duration;
  const validDuration =
    duration.type === "combat" ||
    (duration.type === "turns" && validCounter(duration.remaining, 1)) ||
    (duration.type === "until-roll-threshold" &&
      runtimeValue(duration.roll) === "attack" &&
      (duration.comparison === "at-least" || runtimeValue(duration.comparison) === "at-most") &&
      Number.isFinite(duration.value));
  return (
    (effect.operation === "add" ||
      effect.operation === "multiply" ||
      runtimeValue(effect.operation) === "set") &&
    (effect.basis === "power-percent" || runtimeValue(effect.basis) === "damage-percent") &&
    Number.isFinite(effect.amount) &&
    (effect.selectedMoveId === undefined || effect.selectedMoveId.length > 0) &&
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
  runtimeValue(effect.duration.type) === "turns" &&
  validCounter(effect.duration.remaining, 1) &&
  Number.isFinite(effect.amount) &&
  effect.amount >= 0 &&
  effect.sourceDefinitionId.length > 0;

const hasValidMoveClassificationEffectDetails = (
  effect: Extract<ActiveCombatEffect, { type: "modify-move-classification" }>,
) =>
  effect.sourceDefinitionId.length > 0 &&
  validCounter(effect.sourceEffectIndex, 0) &&
  runtimeValue(effect.selector.type) === "move-selector" &&
  runtimeValue(effect.classification.type) === "replace-style" &&
  effect.classification.style === "declared-style" &&
  effect.duration.type === "turns" &&
  validCounter(effect.duration.remaining, 1) &&
  effect.duration.ownerCombatantId.length > 0;

const hasValidSuppressionEffectDetails = (
  effect: Extract<ActiveCombatEffect, { type: "suppress" }>,
  // eslint-disable-next-line complexity -- Invariant validation intentionally centralizes serialized-state checks.
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
      runtimeValue(effect.duration.roll) === "attack" &&
      (effect.duration.comparison === "at-least" ||
        runtimeValue(effect.duration.comparison) === "at-most") &&
      Number.isFinite(effect.duration.value));
  return (
    (effect.requirement !== undefined
      ? effect.requirement.length > 0 && effect.aspects.length === 0
      : effect.aspects.length > 0) &&
    effect.aspects.every(
      (aspect) => aspect === "all-effects" || runtimeValue(aspect) === "successful-effects",
    ) &&
    validSelector &&
    validDuration &&
    (effect.selectedMoveId === undefined || effect.selectedMoveId.length > 0) &&
    (effect.requirement === undefined || effect.requirement.length > 0) &&
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
  // eslint-disable-next-line complexity -- Invariant validation intentionally centralizes serialized-state checks.
) => {
  const selector: unknown = effect.selector;
  return (
    (effect.actor === "self" ||
      effect.actor === "opponent" ||
      runtimeValue(effect.actor) === "any") &&
    effect.aspects.length > 0 &&
    effect.aspects.every((aspect) => validMoveModificationAspects.has(aspect)) &&
    (effect.operations === undefined ||
      effect.operations.every((operation) => runtimeValue(operation) === "reduce")) &&
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
  (effect.resource === "hp" || runtimeValue(effect.resource) === "ki") &&
  (effect.operation === "gain" ||
    effect.operation === "lose" ||
    runtimeValue(effect.operation) === "set") &&
  (effect.sourceActor === undefined || runtimeValue(effect.sourceActor) === "opponent") &&
  (effect.exceptAction === undefined || runtimeValue(effect.exceptAction) === "power-up") &&
  (effect.availableFromTurn === undefined || validCounter(effect.availableFromTurn, 1));

const hasValidConstantEffectDetails = (
  effect: Extract<ActiveCombatEffect, { type: "active-constant" }>,
  // eslint-disable-next-line complexity -- Invariant validation intentionally centralizes serialized-state checks.
) =>
  runtimeValue(effect.duration) === "combat" &&
  typeof effect.sourceDefinitionId === "string" &&
  effect.sourceDefinitionId.length > 0 &&
  validCounter(effect.activatedOnTurn, 1) &&
  (effect.paidActivationCost === undefined || validNonnegativeNumber(effect.paidActivationCost)) &&
  (effect.selectionKey === undefined ||
    (typeof effect.selectionKey === "string" && effect.selectionKey.length > 0)) &&
  (effect.lifecycle === undefined ||
    effect.lifecycle === "active" ||
    (runtimeValue(effect.lifecycle) === "deactivated" &&
      validCounter(effect.deactivatedOnTurn ?? 0, 1)) ||
    (typeof runtimeValue(effect.lifecycle) === "object" &&
      isValidEffectLifecycle(effect.lifecycle))) &&
  (effect.replacement === undefined ||
    (effect.replacement.sourceDefinitionId === effect.replacement.sourceMoveSnapshot.id &&
      effect.replacement.sourceMoveSnapshot.category === "skill" &&
      effect.replacement.sourceMoveSnapshot.mechanics.activationClassification === "constant" &&
      runtimeValue(effect.replacement.duration.type) === "turns" &&
      effect.replacement.duration.ownerCombatantId === effect.targetCombatantId &&
      validCounter(effect.replacement.duration.remaining, 1)));

const hasValidForcedActionEffectDetails = (
  effect: Extract<ActiveCombatEffect, { type: "force-next-action" }>,
) =>
  effect.allowedCategories.length > 0 &&
  effect.allowedCategories.every(
    (category) => category === "advanced-attack" || runtimeValue(category) === "signature",
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
  mechanics: CombatMechanicsView,
) =>
  (effect.duration === "combat" ||
    (runtimeValue(effect.duration.type) === "until-perfect-roll" &&
      typeof effect.duration.combatantId === "string")) &&
  effect.sourceDefinitionId.length > 0 &&
  effect.moveId.length > 0 &&
  validCounter(effect.sourceEffectIndex, 0) &&
  validCounter(effect.removedFromIndex, 0) &&
  mechanics.moves.some((move) => move.id === effect.moveId);

const hasValidMoveEffectReplacementDetails = (
  effect: Extract<ActiveCombatEffect, { type: "move-effect-replacement" }>,
  mechanics: CombatMechanicsView,
) =>
  effect.sourceDefinitionId.length > 0 &&
  effect.targetMoveId.length > 0 &&
  validCounter(effect.sourceEffectIndex, 0) &&
  validCounter(effect.remainingTriggers, 1) &&
  mechanics.moves.some((move) => move.id === effect.targetMoveId) &&
  effect.replacement.trigger === "on-resource-drain" &&
  effect.replacement.target === "self" &&
  effect.replacement.type === "modify-resource" &&
  effect.replacement.resource === "ki" &&
  effect.replacement.operation === "gain" &&
  effect.replacement.amount !== undefined &&
  effect.replacement.amount.type === "triggering-resource-change" &&
  runtimeValue(effect.replacement.amount.resource) === "ki" &&
  runtimeValue(effect.replacement.amount.operation) === "drain";

const hasValidFloatingEffectDetails = (
  effect: Extract<ActiveCombatEffect, { type: "floating-effect" }>,
  // eslint-disable-next-line complexity -- Invariant validation intentionally centralizes serialized-state checks.
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
      (runtimeValue(effect.scope.type) === "next-turn" &&
        typeof effect.scope.combatantId === "string")) &&
    (effect.stacking === undefined ||
      effect.stacking === "allow" ||
      runtimeValue(effect.stacking) === "prevent") &&
    (duration === undefined ||
      (duration.type === "until-combat-result" &&
        typeof duration.combatantId === "string" &&
        (duration.result === "successful" ||
          duration.result === "stopped" ||
          duration.result === "critical" ||
          runtimeValue(duration.result) === "counter") &&
        (duration.rollThreshold === undefined ||
          ((duration.rollThreshold.roll === "attack" ||
            duration.rollThreshold.roll === "defense" ||
            runtimeValue(duration.rollThreshold.roll) === "transformation") &&
            (duration.rollThreshold.comparison === "at-least" ||
              runtimeValue(duration.rollThreshold.comparison) === "at-most") &&
            Number.isFinite(duration.rollThreshold.value)))) ||
      (duration.type === "until-roll-threshold" &&
        typeof duration.combatantId === "string" &&
        (duration.roll === "attack" || runtimeValue(duration.roll) === "defense") &&
        (duration.comparison === "at-least" || runtimeValue(duration.comparison) === "at-most") &&
        Number.isFinite(duration.value))) &&
    effect.effects.every((nestedEffect) => nestedEffect.type !== "create-floating-effect") &&
    effect.termination.every(
      (termination) =>
        (termination.trigger === "on-power-up" ||
          termination.trigger === "on-stopped" ||
          runtimeValue(termination.trigger) === "on-success") &&
        (termination.actor === "self" || runtimeValue(termination.actor) === "opponent"),
    )
  );
};

const hasValidExtraActionEffectDetails = (
  effect: Extract<ActiveCombatEffect, { type: "extra-action" }>,
  // eslint-disable-next-line complexity -- Invariant validation intentionally centralizes serialized-state checks.
) =>
  effect.sourceDefinitionId.length > 0 &&
  Number.isInteger(effect.sourceEffectIndex) &&
  effect.sourceEffectIndex >= 0 &&
  (effect.phase === "action" || runtimeValue(effect.phase) === "upkeep") &&
  validCounter(effect.remainingActions, 1) &&
  validCounter(effect.availableFromTurn, 1) &&
  validCounter(effect.expiresAfterTurn, effect.availableFromTurn) &&
  (effect.activationCost === undefined ||
    (runtimeValue(effect.activationCost.resource) === "ki" &&
      Number.isInteger(effect.activationCost.amount) &&
      effect.activationCost.amount >= 1 &&
      (effect.activationCost.minimum === undefined ||
        (Number.isInteger(effect.activationCost.minimum) &&
          effect.activationCost.minimum >= 0)))) &&
  (effect.useLimit === undefined ||
    (validCounter(effect.useLimit.count, 1) &&
      (effect.useLimit.scope === "combat" || runtimeValue(effect.useLimit.scope) === "turn")));

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
        categories.every((category) => allowedCategories.has(category)))) &&
    (effect.duration === undefined ||
      (runtimeValue(effect.duration.type) === "until-turn-start-roll-threshold" &&
        validCounter(effect.duration.dice, 1) &&
        validCounter(effect.duration.sides, 1) &&
        Number.isFinite(effect.duration.value) &&
        validCounter(effect.duration.remainingIgnoredChecks, 0)))
  );
};

const hasValidScheduledAmount = (
  amount: Extract<ActiveCombatEffect, { readonly type: "scheduled-resource" }>["amount"],
) => {
  if (amount.type === "literal") return Number.isFinite(amount.value) && amount.value >= 0;
  if (amount.type === "stat-percent")
    return (
      runtimeValue(amount.stat) === "power" &&
      Number.isFinite(amount.percent) &&
      amount.percent >= 0
    );
  return (
    amount.type === "resource-percent" &&
    (amount.resource === "hp" || runtimeValue(amount.resource) === "ki") &&
    (amount.basis === "current" || runtimeValue(amount.basis) === "total") &&
    Number.isFinite(amount.percent) &&
    amount.percent >= 0
  );
};

const hasValidScheduledResourceEffectDetails = (
  effect: Extract<ActiveCombatEffect, { readonly type: "scheduled-resource" }>,
  // eslint-disable-next-line complexity -- Invariant validation intentionally centralizes serialized-state checks.
) => {
  const duration = effect.duration;
  const validDuration =
    duration === undefined ||
    (duration.type === "turns" && validCounter(duration.remaining, 1)) ||
    (duration.type === "until-roll-threshold" &&
      Number.isFinite(duration.value) &&
      (duration.moveSelector === undefined ||
        runtimeValue(duration.moveSelector.type) === "move-selector"));
  const threshold = effect.cancellation?.rollThreshold;
  return (
    effect.sourceDefinitionId.length > 0 &&
    validCounter(effect.sourceEffectIndex, 0) &&
    validCounter(effect.remainingBoundaries, 1) &&
    (effect.repeat === "once" || runtimeValue(effect.repeat) === "each-turn") &&
    (effect.timing.type === "phase-start"
      ? effect.timing.phase === "upkeep"
      : effect.timing.phase === undefined) &&
    (effect.operation !== "damage" || effect.resource === "hp") &&
    hasValidScheduledAmount(effect.amount) &&
    validDuration &&
    (threshold === undefined || Number.isFinite(threshold.value))
  );
};

const hasValidDeferredMoveEffectDetails = (
  effect: Extract<ActiveCombatEffect, { type: "deferred-move" }>,
) =>
  effect.sourceDefinitionId.length > 0 &&
  validCounter(effect.sourceEffectIndex, 0) &&
  validCounter(effect.performOnTurn, 1) &&
  (effect.damageOverridePercent === undefined ||
    (Number.isFinite(effect.damageOverridePercent) && effect.damageOverridePercent >= 0)) &&
  runtimeValue(effect.cancellation.result) === "successful" &&
  (effect.onCancellation === undefined ||
    (runtimeValue(effect.onCancellation.affectedType) === "attack" &&
      runtimeValue(effect.onCancellation.duration) === "combat"));

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
  // eslint-disable-next-line complexity -- Invariant validation intentionally centralizes serialized-state checks.
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
    effect.sourceDefinitionId.length > 0 &&
    (effect.type !== "prevent-move-use" ||
      effect.sourceEffectIndex === undefined ||
      validCounter(effect.sourceEffectIndex, 0)) &&
    (effect.type !== "prevent-move-use" ||
      effect.selectionSpec === undefined ||
      effect.selectionSpec.type === "one" ||
      effect.selectionSpec.type === "all" ||
      (effect.selectionSpec.type === "up-to" &&
        effect.selectionSpec.limit.type === "literal" &&
        validCounter(effect.selectionSpec.limit.value, 1)))
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
  // eslint-disable-next-line complexity -- Invariant validation intentionally centralizes serialized-state checks.
) =>
  effect.sourceDefinitionId.length > 0 &&
  validCounter(effect.sourceEffectIndex, 0) &&
  (effect.modifier === "result" ||
    effect.modifier === "sides" ||
    runtimeValue(effect.modifier) === "any") &&
  (effect.multiplier === undefined || Number.isFinite(effect.multiplier)) &&
  (effect.increment === undefined || Number.isFinite(effect.increment)) &&
  !(effect.multiplier === undefined && effect.increment === undefined) &&
  (effect.excludeSourceCategories === undefined ||
    new Set(effect.excludeSourceCategories).size === effect.excludeSourceCategories.length) &&
  (effect.cap === undefined ||
    (runtimeValue(effect.cap.type) === "allow-exceed" &&
      (effect.cap.scope === "amount" ||
        effect.cap.scope === "total" ||
        runtimeValue(effect.cap.scope) === "roll"))) &&
  (effect.duration === "combat" ||
    (runtimeValue(effect.duration.type) === "next-roll" &&
      typeof effect.duration.combatantId === "string" &&
      (effect.duration.roll === "attack" || runtimeValue(effect.duration.roll) === "defense")));

const hasValidRollSelectionDetails = (
  effect: Extract<ActiveCombatEffect, { type: "set-roll-selection" }>,
) =>
  (effect.roll === "attack" || runtimeValue(effect.roll) === "defense") &&
  validCounter(effect.diceCount, 2) &&
  (effect.selection === "highest" || runtimeValue(effect.selection) === "lowest") &&
  effect.sourceDefinitionId.length > 0 &&
  validCounter(effect.sourceEffectIndex, 0) &&
  runtimeValue(effect.duration.type) === "next-roll" &&
  effect.duration.roll === effect.roll &&
  typeof effect.duration.combatantId === "string";

const hasValidNonFloatingEffectDetails = (
  effect: Exclude<
    ActiveCombatEffect,
    { type: "floating-effect" | "extra-action" | "scheduled-resource" }
  >,
  mechanics: CombatMechanicsView,
  // eslint-disable-next-line complexity -- Invariant validation intentionally centralizes serialized-state checks.
) => {
  switch (effect.type) {
    case "set-stat-comparison":
      return (
        runtimeValue(effect.stat) === "dexterity" &&
        runtimeValue(effect.comparison) === "higher-than" &&
        runtimeValue(effect.duration.type) === "turns" &&
        validCounter(effect.duration.remaining, 1)
      );
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
    case "modify-move-classification":
      return hasValidMoveClassificationEffectDetails(effect);
    case "suppress":
      return hasValidSuppressionEffectDetails(effect);
    case "active-constant":
      return hasValidConstantEffectDetails(effect);
    case "remove-move-from-combat":
      return hasValidMoveRemovalEffectDetails(effect, mechanics);
    case "move-effect-replacement":
      return hasValidMoveEffectReplacementDetails(effect, mechanics);
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
    case "deferred-move":
      return hasValidDeferredMoveEffectDetails(effect);
    case "require-transformation-roll":
      return (
        effect.sourceDefinitionId.length > 0 &&
        validCounter(effect.sourceEffectIndex, 0) &&
        runtimeValue(effect.ignoreTransformationDice) === true
      );
    case "exchange-skill-reactivation":
      return (
        effect.sourceDefinitionId.length > 0 &&
        activeEffectIdSchema.safeParse(effect.deactivatedEffectId).success &&
        typeof effect.attackSelector === "object"
      );
    case "exchange-skill-cooldown":
      return effect.sourceDefinitionId.length > 0 && validCounter(effect.remainingTurns, 1);
  }
};

const hasValidEffectDetails = (effect: ActiveCombatEffect, mechanics: CombatMechanicsView) => {
  if (effect.type === "floating-effect") return hasValidFloatingEffectDetails(effect);
  if (effect.type === "extra-action") return hasValidExtraActionEffectDetails(effect);
  if (effect.type === "scheduled-resource") return hasValidScheduledResourceEffectDetails(effect);
  return hasValidNonFloatingEffectDetails(effect, mechanics);
};

const hasValidTypedSelectorTokens = (effect: ActiveCombatEffect) => {
  const selector = (effect as unknown as { readonly selector?: unknown }).selector;
  if (selector === undefined || typeof selector !== "object" || selector === null) return true;
  const value = selector as {
    readonly effectRuleTokens?: readonly unknown[];
    readonly effectRuleTokensAny?: readonly unknown[];
  };
  return [value.effectRuleTokens, value.effectRuleTokensAny].every(
    (tokens) =>
      tokens === undefined ||
      (tokens.length > 0 &&
        tokens.every((token) => typeof token === "string") &&
        new Set(tokens).size === tokens.length),
  );
};

const hasValidFloatingEffectReferences = (
  state: FightState,
  effect: Extract<ActiveCombatEffect, { readonly type: "floating-effect" }>,
) =>
  (effect.duration === undefined || isActiveCombatant(state, effect.duration.combatantId)) &&
  (effect.targetRelationCombatantId === undefined ||
    isActiveCombatant(state, effect.targetRelationCombatantId));

/* eslint-disable sonarjs/cognitive-complexity -- active-effect reference validation mirrors the persisted effect union. */
// eslint-disable-next-line complexity -- Invariant validation intentionally centralizes serialized-state checks.
const hasValidActiveEffectReferences = (state: FightState, effect: ActiveCombatEffect) => {
  if (effect.type === "floating-effect" && !hasValidFloatingEffectReferences(state, effect))
    return false;
  if (effect.type === "scheduled-resource")
    return (
      isActiveCombatant(state, effect.timing.combatantId) &&
      (effect.duration?.type !== "until-roll-threshold" ||
        isActiveCombatant(state, effect.duration.combatantId)) &&
      (effect.cancellation === undefined ||
        isActiveCombatant(state, effect.cancellation.actorCombatantId))
    );
  if (effect.type === "deferred-move")
    return (
      isActiveCombatant(state, effect.cancellation.actorCombatantId) &&
      effect.performOnTurn >= state.turnNumber
    );
  if (effect.type === "modify-damage")
    return hasValidDamageModifierCombatantReferences(state, effect);
  if (
    effect.type === "modify-stat" ||
    effect.type === "modify-move-classification" ||
    effect.type === "set-stat-comparison"
  )
    return (
      effect.duration.type === "combat" ||
      isActiveCombatant(state, effect.duration.ownerCombatantId)
    );
  if (effect.type === "modify-roll-modifier" && effect.duration !== "combat")
    return isActiveCombatant(state, effect.duration.combatantId);
  if (effect.type === "set-roll-selection")
    return isActiveCombatant(state, effect.duration.combatantId);
  if (effect.type === "suppress") return hasValidSuppressionCombatantReferences(state, effect);
  if (effect.type === "remove-move-from-combat")
    return !state.combatants[effect.targetCombatantId].moveIds.includes(effect.moveId);
  if (
    effect.type === "action-lock" ||
    effect.type === "action-restriction" ||
    effect.type === "prevent-move-use" ||
    effect.type === "prevent-status" ||
    effect.type === "prevent-combat-result" ||
    effect.type === "prevent-roll-modification" ||
    effect.type === "prevent-move-modification" ||
    effect.type === "prevent-resource-modification" ||
    effect.type === "set-resolution-threshold"
  )
    return effect.type === "action-restriction"
      ? effect.duration === undefined || isActiveCombatant(state, effect.duration.combatantId)
      : hasValidActionLockCombatantReferences(state, effect);
  return true;
};
/* eslint-enable sonarjs/cognitive-complexity */

const hasValidConflictPolicy = (effect: ActiveCombatEffect) => {
  const policy = effect.conflictPolicy;
  if (policy === undefined) return true;
  if (policy.type === "allow" || policy.type === "prevent-duplicate") return true;
  if (policy.type === "unique-group" || policy.type === "mutually-exclusive-group")
    return /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(policy.group);
  if (policy.type === "replace")
    return policy.provenance === "existing" || policy.provenance === "incoming";
  if (policy.type === "refresh")
    return (
      (policy.duration === "existing" || policy.duration === "incoming") &&
      (policy.uses === "existing" || policy.uses === "incoming") &&
      (policy.provenance === "existing" || policy.provenance === "incoming")
    );
  return (
    policy.type === "retain" &&
    policy.value === "amount" &&
    (policy.selection === "highest" || policy.selection === "lowest") &&
    (policy.tie === "existing" || policy.tie === "incoming")
  );
};

const hasValidConflictMetadata = (effect: ActiveCombatEffect) =>
  hasValidConflictPolicy(effect) &&
  (effect.conflictKey === undefined || effect.conflictKey === conflictKeyFor(effect));

/** Shared ActiveEffectBase identity checks applied before specialized rules. */
const hasValidActiveEffectBaseIdentity = (effect: ActiveCombatEffect) =>
  typeof effect.sourceDefinitionId === "string" &&
  effect.sourceDefinitionId.length > 0 &&
  (!("sourceEffectIndex" in effect) ||
    effect.sourceEffectIndex === undefined ||
    validCounter(effect.sourceEffectIndex, 0));

const validateActiveEffects = (state: FightState, violations: FightStateInvariantViolation[]) => {
  const activeEffectIds = new Set<string>();
  const mechanics = mechanicsFor(state);

  for (const [effectIndex, effect] of state.activeEffects.entries()) {
    const validEffect =
      activeEffectIdSchema.safeParse(effect.id).success &&
      !activeEffectIds.has(effect.id) &&
      hasValidActiveEffectBaseIdentity(effect) &&
      isActiveCombatant(state, effect.sourceCombatantId) &&
      isActiveCombatant(state, effect.targetCombatantId) &&
      (effect.type !== "floating-effect" ||
        effect.scope.type !== "next-turn" ||
        isActiveCombatant(state, effect.scope.combatantId)) &&
      hasValidActiveEffectReferences(state, effect) &&
      hasValidTypedSelectorTokens(effect) &&
      hasKnownLifecycleEncoding(effect) &&
      (() => {
        const lifecycle = lifecycleRecordForEffect(effect);
        return lifecycle === undefined || isValidEffectLifecycle(lifecycle);
      })() &&
      hasValidEffectDetails(effect, mechanics) &&
      hasValidConflictMetadata(effect) &&
      !state.activeEffects.some((candidate, candidateIndex) => {
        if (candidateIndex <= effectIndex) return false;
        const policy = conflictPolicyFor(effect);
        const candidatePolicy = conflictPolicyFor(candidate);
        if (
          policy === undefined ||
          candidatePolicy === undefined ||
          policy.type === "allow" ||
          candidatePolicy.type === "allow" ||
          policy.type !== candidatePolicy.type
        )
          return false;
        if (policy.type === "unique-group" || policy.type === "mutually-exclusive-group") {
          if (candidatePolicy.type !== policy.type || candidatePolicy.group !== policy.group)
            return false;
        }
        return conflictMatchKeyFor(effect, policy) === conflictMatchKeyFor(candidate, policy);
      });
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

const validCandidateFact = (
  facts: AttackDieCandidateSnapshot | undefined,
  attackSides: number,
  defenseSides: number,
) => {
  if (facts === undefined) return true;
  const validCandidates = (
    candidates:
      | readonly {
          readonly candidateIndex: number;
          readonly naturalValue: number;
          readonly finalResult: number;
        }[]
      | undefined,
    sides: number,
  ) =>
    candidates === undefined ||
    (candidates.length > 0 &&
      candidates.every(
        (candidate, index) =>
          candidate.candidateIndex === index &&
          validCounter(candidate.naturalValue, 1) &&
          candidate.naturalValue <= sides &&
          Number.isFinite(candidate.finalResult),
      ));
  const validSelectedIndex = (
    candidates: readonly unknown[] | undefined,
    selectedIndex: number | undefined,
  ) => {
    if (candidates === undefined) return selectedIndex === undefined;
    return (
      selectedIndex !== undefined &&
      Number.isInteger(selectedIndex) &&
      selectedIndex >= 0 &&
      selectedIndex < candidates.length
    );
  };
  return (
    validCandidates(facts.attackCandidates, attackSides) &&
    validCandidates(facts.defenseCandidates, defenseSides) &&
    validSelectedIndex(facts.attackCandidates, facts.selectedAttackCandidateIndex) &&
    validSelectedIndex(facts.defenseCandidates, facts.selectedDefenseCandidateIndex)
  );
};

const validCandidateFactArray = (
  facts: readonly (AttackDieCandidateSnapshot | undefined)[] | undefined,
  expectedLength: number,
  attackSides: number,
  defenseSides: number,
) =>
  facts === undefined ||
  (facts.length === expectedLength &&
    facts.every((candidateFacts) => validCandidateFact(candidateFacts, attackSides, defenseSides)));

const validAttackResolutionSnapshot = (
  snapshot: NonNullable<AttackActionHistoryRecord["resolutionSnapshot"]>,
  // eslint-disable-next-line complexity -- Invariant validation intentionally centralizes serialized-state checks.
) =>
  Number.isFinite(snapshot.paidKiCost) &&
  snapshot.paidKiCost >= 0 &&
  Number.isInteger(snapshot.attack.dice) &&
  snapshot.attack.dice > 0 &&
  Number.isInteger(snapshot.attack.sides) &&
  snapshot.attack.sides > 0 &&
  Number.isInteger(snapshot.blockedDice) &&
  snapshot.blockedDice >= 0 &&
  snapshot.blockedDice <= snapshot.attack.dice &&
  Number.isFinite(snapshot.attackResultModifier) &&
  Number.isFinite(snapshot.baseDamage) &&
  typeof snapshot.damagePerHit === "boolean" &&
  snapshot.naturalAttackRolls.length === snapshot.attack.dice &&
  snapshot.naturalDefenseRolls.length === snapshot.attack.dice &&
  snapshot.naturalAttackRolls.every(
    (roll) => Number.isInteger(roll) && roll >= 1 && roll <= snapshot.attack.sides,
  ) &&
  snapshot.naturalDefenseRolls.every((roll, index) =>
    index < snapshot.blockedDice
      ? roll === undefined
      : roll !== undefined && Number.isInteger(roll) && roll >= 1 && roll <= snapshot.defenseSides,
  ) &&
  snapshot.resultOverrides.length === snapshot.attack.dice &&
  snapshot.numericResultOverrides.length === snapshot.attack.dice &&
  snapshot.numericResultOverrides.every(
    (override) =>
      override === undefined ||
      ((override.attack === undefined || Number.isFinite(override.attack)) &&
        (override.defense === undefined || Number.isFinite(override.defense))),
  ) &&
  validCandidateFactArray(
    snapshot.candidateFacts,
    snapshot.attack.dice,
    snapshot.attack.sides,
    snapshot.defenseSides,
  ) &&
  snapshot.criticalThresholds.every(
    (threshold) =>
      Number.isFinite(threshold.threshold) &&
      (threshold.basis === "natural-result" || runtimeValue(threshold.basis) === "final-result"),
  ) &&
  snapshot.resolutionThresholds.every(
    (threshold) =>
      Number.isFinite(threshold.value) &&
      (threshold.roll === "attack" || runtimeValue(threshold.roll) === "defense") &&
      (threshold.comparison === "at-least" || runtimeValue(threshold.comparison) === "at-most") &&
      (threshold.resultScope === "current-attack" ||
        runtimeValue(threshold.resultScope) === "matching-die"),
  ) &&
  typeof snapshot.preventCritical === "boolean" &&
  typeof snapshot.preventCounter === "boolean";

const validResourceChangeHistory = (
  record: ResourceChangeHistoryRecord,
  actionTurnNumber: number,
  state: FightState,
  // eslint-disable-next-line complexity -- Invariant validation intentionally centralizes serialized-state checks.
) =>
  combatantForId(state, record.affectedCombatantId) !== undefined &&
  (record.sourceCombatantId === undefined ||
    combatantForId(state, record.sourceCombatantId) !== undefined) &&
  (record.sourceDefinitionId === undefined || record.sourceDefinitionId.length > 0) &&
  (record.sourceEffectIndex === undefined ||
    (Number.isInteger(record.sourceEffectIndex) && record.sourceEffectIndex >= 0)) &&
  (record.resource === "hp" || runtimeValue(record.resource) === "ki") &&
  (record.operation === "gain" || runtimeValue(record.operation) === "lose") &&
  Number.isFinite(record.amount) &&
  record.amount >= 0 &&
  record.turnNumber === actionTurnNumber &&
  (record.cause === undefined ||
    record.cause === "non-damage-effect" ||
    runtimeValue(record.cause) === "opponent-effect") &&
  (record.sourceStyleId === undefined || record.sourceStyleId.length > 0);

// eslint-disable-next-line complexity -- Invariant validation intentionally centralizes serialized-state checks.
const validAttackActionResults = (action: AttackActionHistoryRecord, state: FightState) =>
  (action.outcome === undefined ||
    action.outcome === "successful" ||
    runtimeValue(action.outcome) === "stopped") &&
  (action.critical === undefined || typeof action.critical === "boolean") &&
  (action.counter === undefined || typeof action.counter === "boolean") &&
  (action.attackRollResult === undefined || Number.isFinite(action.attackRollResult)) &&
  (action.defenseRollResult === undefined || Number.isFinite(action.defenseRollResult)) &&
  validDamageDealt(action.damageDealt) &&
  (action.resourceChanges ?? []).every((record) =>
    validResourceChangeHistory(record, action.turnNumber, state),
  ) &&
  (action.resolutionSnapshot === undefined ||
    validAttackResolutionSnapshot(action.resolutionSnapshot));

const validateActionHistory = (state: FightState, violations: FightStateInvariantViolation[]) => {
  const decisionIds = new Set<string>();
  let previousTurnNumber = 0;

  for (const action of state.actionHistory) {
    // eslint-disable-next-line complexity -- Invariant validation intentionally centralizes serialized-state checks.
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
          runtimeValue(action.phase) === "action" &&
          (action.reason === "status" || runtimeValue(action.reason) === "effect")
        );
      if (action.type === "basic-attack") {
        return (
          combatantForId(state, action.targetCombatantId) !== undefined &&
          validAttackActionResults(action, state)
        );
      }
      if (action.type === "use-move") {
        return (
          combatantForId(state, action.targetCombatantId) !== undefined &&
          typeof action.moveId === "string" &&
          action.moveId.length > 0 &&
          validAttackActionResults(action, state)
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
  const firstAlternative = frame.effectAlternatives[0];
  return (
    firstAlternative.length === frame.effectIndices.length &&
    firstAlternative.every((index, position) => index === frame.effectIndices[position])
  );
};

const validRequiredIndexList = (indices: readonly number[]) =>
  indices.length > 0 &&
  indices.every((index) => Number.isInteger(index) && index >= 0) &&
  new Set(indices).size === indices.length;

const validFiniteNumericRecord = (values: Readonly<Record<string, number>> | undefined) =>
  values === undefined ||
  Object.entries(values).every(
    ([key, value]) => storedRollKeyPattern.test(key) && Number.isFinite(value),
  );

/* eslint-disable sonarjs/cognitive-complexity -- Invariant validation intentionally centralizes serialized-state checks. */
const validCopiedMoveAttackReference = (
  attack: AttackFrameReference,
  mechanics: CombatMechanicsView,
) => {
  if (attack.type !== "move") return true;
  const {
    copiedFromMoveId,
    copiedSourceMove,
    copiedDamageBonusPercent,
    copiedDamageOverride,
    copiedSuccessfulEffectsOnly,
    copiedEffectsOnly,
    copiedSourceResolution,
  } = attack;
  if (
    copiedFromMoveId === undefined &&
    copiedSourceMove === undefined &&
    copiedDamageBonusPercent === undefined &&
    copiedDamageOverride === undefined &&
    copiedSuccessfulEffectsOnly === undefined &&
    copiedSourceResolution === undefined
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
  if (copiedEffectsOnly !== undefined && typeof copiedEffectsOnly !== "boolean") return false;
  if (
    copiedSourceResolution !== undefined &&
    !validAttackResolutionSnapshot(copiedSourceResolution)
  )
    return false;
  return (
    copiedFromMoveId !== attack.moveId &&
    (copiedSourceMove !== undefined ||
      mechanics.moves.some((move) => move.id === copiedFromMoveId)) &&
    (copiedDamageBonusPercent === undefined ||
      (Number.isFinite(copiedDamageBonusPercent) && copiedDamageBonusPercent >= 0)) &&
    (copiedDamageOverride === undefined ||
      (Number.isFinite(copiedDamageOverride) && copiedDamageOverride >= 0))
  );
};

/* eslint-enable sonarjs/cognitive-complexity */

// eslint-disable-next-line complexity -- Invariant validation intentionally centralizes serialized-state checks.
const validCounterActionReference = (
  reference: CounterActionReference,
  mechanics: CombatMechanicsView,
) => {
  const activationCost = reference.activationCost;
  const costModifier = reference.costModifier;
  const sourceAction = reference.sourceAction;
  return (
    mechanics.moves.some((move) => move.id === reference.sourceDefinitionId) &&
    validCounter(reference.sourceEffectIndex, 0) &&
    typeof reference.stopsTriggeringAttack === "boolean" &&
    typeof reference.ignoreRequirements === "boolean" &&
    (activationCost === undefined ||
      (validCostTiming(activationCost.timing) &&
        runtimeValue(activationCost.resource) === "ki" &&
        validNonnegativeNumber(activationCost.amount) &&
        (activationCost.minimum === undefined ||
          validNonnegativeNumber(activationCost.minimum)))) &&
    (costModifier === undefined ||
      ((costModifier.operation === "add" || runtimeValue(costModifier.operation) === "set") &&
        Number.isFinite(costModifier.amount) &&
        (costModifier.minimum === undefined || validNonnegativeNumber(costModifier.minimum)))) &&
    (sourceAction === undefined ||
      ((sourceAction.type === "basic-attack" || runtimeValue(sourceAction.type) === "use-move") &&
        combatantIdSchema.safeParse(sourceAction.actorId).success &&
        combatantIdSchema.safeParse(sourceAction.targetCombatantId).success &&
        (sourceAction.type !== "use-move" ||
          (reference.sourceMoveSnapshot !== undefined &&
            reference.sourceMoveSnapshot.id === sourceAction.moveId))))
  );
};

const validAttackCostFrameMetadata = (
  frame: Extract<ResolutionFrame, { readonly type: "attack" }>,
  mechanics: CombatMechanicsView,
) =>
  !("costEffectTrigger" in frame) ||
  (frame.costEffectTrigger !== undefined &&
    frame.costEffectSourceDefinitionId !== undefined &&
    frame.costEffectIndices !== undefined &&
    validRequiredIndexList(frame.costEffectIndices) &&
    mechanics.moves.some((move) => move.id === frame.costEffectSourceDefinitionId));

const validBeforeDefenseEffectFrameMetadata = (
  frame: Extract<ResolutionFrame, { readonly type: "attack" }>,
  mechanics: CombatMechanicsView,
) =>
  !("beforeDefenseEffectChoices" in frame) ||
  frame.beforeDefenseEffectChoices === undefined ||
  (frame.beforeDefenseEffectChoices.length > 0 &&
    frame.beforeDefenseEffectChoices.every(
      (choice) =>
        mechanics.moves.some((move) => move.id === choice.sourceDefinitionId) &&
        validRequiredIndexList(choice.effectIndices) &&
        (choice.sacrificedMoveId === undefined ||
          mechanics.moves.some((move) => move.id === choice.sacrificedMoveId)) &&
        ((choice.sourceActionId === undefined && choice.sourceMoveSnapshot === undefined) ||
          (choice.sourceActionId !== undefined &&
            combatDecisionIdSchema.safeParse(choice.sourceActionId).success &&
            choice.sourceMoveSnapshot !== undefined &&
            choice.sourceMoveSnapshot.id !== choice.sourceDefinitionId &&
            choice.sourceMoveSnapshot.mechanics.attack !== undefined)),
    ));

const validAwaitingEffectChoiceSource = (
  frame: AwaitingEffectChoiceAttackFrame,
  mechanics: CombatMechanicsView,
) =>
  frame.effectSourceDefinitionId === undefined
    ? frame.effectTrigger !== "on-move-use" &&
      frame.effectTrigger !== "on-cost-modified" &&
      frame.effectTrigger !== "on-damage"
    : (frame.effectTrigger === undefined ||
        frame.effectTrigger === "on-move-use" ||
        frame.effectTrigger === "on-cost-modified" ||
        frame.effectTrigger === "on-damage") &&
      mechanics.moves.some((move) => move.id === frame.effectSourceDefinitionId);

const suppressionSelectionPhaseFor = (
  state: Extract<FightState, { readonly status: "active" }>,
  frame: Extract<
    ResolutionFrame,
    { readonly type: "attack"; readonly stage: "awaiting-effect-choice" }
  >,
) =>
  frame.effectTrigger === "on-success" &&
  frame.enabledEffectIndices.length > 0 &&
  state.pendingDecision?.type === "select-move" &&
  state.resolutionFrames.some(
    (candidate) =>
      candidate.type === "effect" &&
      candidate.operation === "select-suppression-target" &&
      candidate.decisionId === frame.decisionId,
  );

const moveTargetSelectionPhaseFor = (
  state: Extract<FightState, { readonly status: "active" }>,
  frame: Extract<
    ResolutionFrame,
    { readonly type: "attack"; readonly stage: "awaiting-effect-choice" }
  >,
) =>
  frame.effectTrigger === "on-success" &&
  frame.enabledEffectIndices.length > 0 &&
  state.pendingDecision?.type === "select-move" &&
  state.resolutionFrames.some(
    (candidate) =>
      candidate.type === "effect" &&
      candidate.operation === "select-move-target" &&
      candidate.decisionId === frame.decisionId,
  );

const validSelectedSuppressionMoves = (
  frame: Extract<
    ResolutionFrame,
    { readonly type: "attack"; readonly stage: "awaiting-effect-choice" }
  >,
  suppressionSelectionPhase: boolean,
  mechanics: CombatMechanicsView,
) =>
  frame.selectedSuppressionMoves === undefined ||
  (suppressionSelectionPhase &&
    new Set(frame.selectedSuppressionMoves.map((selection) => selection.effectIndex)).size ===
      frame.selectedSuppressionMoves.length &&
    frame.selectedSuppressionMoves.every(
      (selection) =>
        Number.isInteger(selection.effectIndex) &&
        selection.effectIndex >= 0 &&
        frame.enabledEffectIndices.includes(selection.effectIndex) &&
        typeof selection.moveId === "string" &&
        mechanics.moves.some((move) => move.id === selection.moveId),
    ));

const validSelectedMoveTargets = (
  frame: Extract<
    ResolutionFrame,
    { readonly type: "attack"; readonly stage: "awaiting-effect-choice" }
  >,
  selectionPhase: boolean,
  mechanics: CombatMechanicsView,
) =>
  frame.selectedMoveTargets === undefined ||
  (selectionPhase &&
    new Set(frame.selectedMoveTargets.map((selection) => selection.effectIndex)).size ===
      frame.selectedMoveTargets.length &&
    frame.selectedMoveTargets.every(
      (selection) =>
        Number.isInteger(selection.effectIndex) &&
        selection.effectIndex >= 0 &&
        frame.enabledEffectIndices.includes(selection.effectIndex) &&
        typeof selection.moveId === "string" &&
        mechanics.moves.some((move) => move.id === selection.moveId),
    ));

const validAttackPendingBoundary = (
  state: Extract<FightState, { readonly status: "active" }>,
  frame: Extract<
    ResolutionFrame,
    { readonly type: "attack"; readonly stage: "awaiting-effect-choice" }
  >,
  choiceCombatantId: CombatantId,
  suppressionSelectionPhase: boolean,
) =>
  pendingDecisionIdSchema.safeParse(frame.pendingDecisionId).success &&
  state.pendingDecision?.id === frame.pendingDecisionId &&
  (suppressionSelectionPhase
    ? state.pendingDecision.type === "select-move"
    : state.pendingDecision.type === "optional-effect") &&
  state.pendingDecision.combatantId === choiceCombatantId &&
  (suppressionSelectionPhase
    ? frame.resolvedEffectIndices.length > 0 && frame.enabledEffectIndices.length > 0
    : frame.resolvedEffectIndices.length === 0 && frame.enabledEffectIndices.length === 0);

const validAttackResolutionFrame = (
  state: FightState,
  frame: Extract<ResolutionFrame, { readonly type: "attack" }>,
  // eslint-disable-next-line complexity, max-lines-per-function, sonarjs/cognitive-complexity -- Invariant validation intentionally centralizes serialized-state checks.
) => {
  const mechanics = mechanicsFor(state);
  const validCopiedMoveReference =
    !("attack" in frame) || validCopiedMoveAttackReference(frame.attack, mechanics);
  const validCounterAction =
    !("counterAction" in frame) ||
    frame.counterAction === undefined ||
    validCounterActionReference(frame.counterAction, mechanics);
  const common =
    combatDecisionIdSchema.safeParse(frame.decisionId).success &&
    isActiveCombatant(state, frame.attackerId) &&
    isActiveCombatant(state, frame.targetCombatantId) &&
    frame.attackerId !== frame.targetCombatantId &&
    validCopiedMoveReference &&
    validCounterAction;
  const costFrameMetadataValid = validAttackCostFrameMetadata(frame, mechanics);
  const beforeDefenseFrameMetadataValid = validBeforeDefenseEffectFrameMetadata(frame, mechanics);
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
      mechanicsFor(state).moves.some((move) => move.id === frame.block!.blockId));
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
        (result) =>
          result === undefined || result === "stopped" || runtimeValue(result) === "successful",
      ));
  const preventedDefenseStatusesValid =
    frame.defenseItem?.preventedStatuses === undefined ||
    (frame.defenseItem.preventedStatuses.length > 0 &&
      new Set(frame.defenseItem.preventedStatuses).size ===
        frame.defenseItem.preventedStatuses.length &&
      frame.defenseItem.preventedStatuses.every(
        (statusId) => statusId === "break" || runtimeValue(statusId) === "sever",
      ));
  const serializedReactionReferencesValid =
    (frame.block === undefined ||
      combatDecisionIdSchema.safeParse(frame.block.responseDecisionId).success) &&
    (frame.defenseItem === undefined ||
      (frame.defenseItem.itemId.length > 0 &&
        combatDecisionIdSchema.safeParse(frame.defenseItem.responseDecisionId).success &&
        preventedDefenseStatusesValid));
  const choiceCombatantId =
    frame.effectTrigger === "on-damage" ? frame.targetCombatantId : frame.attackerId;
  const suppressionSelectionPhase = suppressionSelectionPhaseFor(state, frame);
  const moveTargetSelectionPhase = moveTargetSelectionPhaseFor(state, frame);
  const replacementSelectionPhase =
    frame.effectTrigger === "on-success" &&
    frame.resolvedEffectIndices.length > 0 &&
    frame.enabledEffectIndices.length > 0 &&
    state.resolutionFrames.some(
      (candidate) =>
        candidate.type === "effect" &&
        candidate.operation === "replace-constant" &&
        candidate.decisionId === frame.decisionId &&
        candidate.pendingDecisionId === frame.pendingDecisionId,
    );
  const selectedSuppressionMovesValid = validSelectedSuppressionMoves(
    frame,
    suppressionSelectionPhase,
    mechanics,
  );
  const effectSourceMove = mechanicsFor(state).moves.find(
    (move) => move.id === (frame.effectSourceDefinitionId ?? frame.attack.moveId),
  );
  const effectIndicesValid =
    effectSourceMove !== undefined &&
    frame.effectIndices.every(
      (effectIndex) => effectIndex < (effectSourceMove.effects?.length ?? 0),
    );
  return (
    validChoiceMetadata(frame.selection, frame.optional, frame.costTiming) &&
    validAttackPendingBoundary(
      state,
      frame,
      choiceCombatantId,
      suppressionSelectionPhase || moveTargetSelectionPhase || replacementSelectionPhase,
    ) &&
    runtimeValue(frame.attack.type) === "move" &&
    validAwaitingEffectChoiceSource(frame, mechanics) &&
    validRequiredIndexList(frame.effectIndices) &&
    effectIndicesValid &&
    naturalRollsValid &&
    rollArraysValid &&
    blockValid &&
    blockedDiceValid &&
    validIndexList(frame.priorEnabledOptionalEffectIndices) &&
    validIndexList(frame.priorResolvedOptionalEffectIndices) &&
    validIndexList(frame.enabledAfterDefenseEffectIndices) &&
    validFiniteNumericRecord(frame.selectedNumericValues) &&
    overrideValuesValid &&
    serializedReactionReferencesValid &&
    selectedSuppressionMovesValid &&
    validSelectedMoveTargets(frame, moveTargetSelectionPhase, mechanics)
  );
};

const validActivationCostFrame = (
  activationCost: Extract<ResolutionFrame, { readonly type: "effect" }>["activationCost"],
) =>
  activationCost === undefined ||
  (validCostTiming(activationCost.timing) &&
    (activationCost.resource === undefined ||
      activationCost.resource === "hp" ||
      runtimeValue(activationCost.resource) === "ki") &&
    validNonnegativeNumber(activationCost.amount) &&
    (activationCost.minimum === undefined || validNonnegativeNumber(activationCost.minimum)));

const validCostTiming = (timing: unknown) =>
  timing === undefined ||
  timing === "declaration" ||
  timing === "activation" ||
  timing === "pre-roll" ||
  timing === "post-resolution" ||
  timing === "per-selected-target";

const validSelectionMetadata = (selection: unknown) => {
  if (selection === undefined) return true;
  if (selection === null || typeof selection !== "object") return false;
  const record = selection as Record<string, unknown>;
  if (record.type === "one" || record.type === "all") return !("limit" in record);
  if (record.type !== "up-to" || record.limit === null || typeof record.limit !== "object")
    return false;
  const limit = record.limit as Record<string, unknown>;
  if (typeof limit.type !== "string") return false;
  return limit.type !== "literal" || (Number.isInteger(limit.value) && Number(limit.value) >= 1);
};

const validChoiceMetadata = (
  selection: PendingDecisionOption["selection"] | undefined,
  optional: PendingDecisionOption["optional"] | undefined,
  costTiming: PendingDecisionOption["costTiming"] | undefined,
) =>
  validSelectionMetadata(selection) &&
  (optional === undefined || typeof optional === "boolean") &&
  validCostTiming(costTiming);

const validPersistedSelectionShape = (pendingDecision: PendingDecision): boolean => {
  if (pendingDecision.candidates === undefined || pendingDecision.selection === undefined)
    return true;
  const candidateOptions = pendingDecision.options.filter(
    (option) => option.candidate !== undefined,
  );
  if (candidateOptions.length === 0) return false;
  if (pendingDecision.selection.type === "one")
    return candidateOptions.length <= pendingDecision.candidates.length;
  if (pendingDecision.selection.type === "all")
    return candidateOptions.length === pendingDecision.candidates.length;
  if (candidateOptions.length !== pendingDecision.candidates.length) return false;
  const limit =
    pendingDecision.selection.limit.type === "literal"
      ? pendingDecision.selection.limit.value
      : pendingDecision.candidates.length;
  return Number.isInteger(limit) && limit >= 1 && limit <= pendingDecision.candidates.length;
};

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
  operation === "negate-deactivation" ||
  operation === "copy-move" ||
  operation === "replace-constant" ||
  operation === "select-move-target" ||
  operation === "select-damage-target" ||
  operation === "select-suppression-target" ||
  operation === "select-move-removal";

const validActivationFrameMetadata = (
  state: FightState,
  frame: Extract<ResolutionFrame, { readonly type: "effect" }>,
) =>
  (frame.selectionKey === undefined ||
    (typeof frame.selectionKey === "string" && frame.selectionKey.length > 0)) &&
  (frame.activationAsIf === undefined || runtimeValue(frame.activationAsIf) === "power-up") &&
  (frame.activationSelection === undefined || runtimeValue(frame.activationSelection) === "all") &&
  (frame.deactivationProtectionTurns === undefined ||
    validCounter(frame.deactivationProtectionTurns, 1)) &&
  (frame.activationContinuation === undefined ||
    (combatDecisionIdSchema.safeParse(frame.activationContinuation.decisionId).success &&
      isActiveCombatant(state, frame.activationContinuation.targetCombatantId)));

const validCopyMoveSelectionFrame = (
  state: FightState,
  frame: Extract<ResolutionFrame, { readonly type: "effect" }>,
  // eslint-disable-next-line complexity -- Invariant validation intentionally centralizes serialized-state checks.
) => {
  const sourceMove = mechanicsFor(state).moves.find(
    (candidate) => candidate.id === frame.sourceDefinitionId,
  );
  const target = state.combatants[frame.targetCombatantId];
  const priorSourceIds = frame.eligibleSourceActionIds;
  const frameEffect = sourceMove?.effects?.[frame.effectIndex];
  const persistentSelfCopy =
    frameEffect?.type === "copy-move-effect" &&
    frameEffect.trigger === "on-success" &&
    frameEffect.target === "self" &&
    frameEffect.sourceMove.type === "selected-move" &&
    frameEffect.sourceMove.actor === "self" &&
    frameEffect.sourceMove.category === "advanced-attack" &&
    frameEffect.sourceMove.restriction === "unrestricted" &&
    frameEffect.sourceMove.styleId !== undefined;
  if (persistentSelfCopy) {
    const effect = frameEffect;
    if (runtimeValue(effect.type) !== "copy-move-effect") return false;
    if (effect.sourceMove.type !== "selected-move") return false;
    const sourceStyleId = effect.sourceMove.styleId;
    if (sourceStyleId === undefined) return false;
    const owner = state.combatants[frame.sourceCombatantId];
    return (
      frame.trigger === "start-combat" &&
      frame.selectionKey !== undefined &&
      frame.eligibleMoveIds !== undefined &&
      frame.eligibleMoveIds.length > 0 &&
      frame.eligibleMoveIds.every((moveId) => {
        const move = mechanicsFor(state).moves.find((candidate) => candidate.id === moveId);
        return (
          owner.moveIds.includes(moveId) &&
          move?.category === "advanced-attack" &&
          move.styleId === sourceStyleId &&
          move.restrictedUses === undefined &&
          move.mechanics.attack !== undefined
        );
      })
    );
  }
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
              : mechanicsFor(state).moves.find((candidate) => candidate.id === action.moveId);
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
          const move = mechanicsFor(state).moves.find((candidate) => candidate.id === moveId);
          return (
            target.moveIds.includes(moveId) &&
            move?.category === "advanced-attack" &&
            move.mechanics.attack !== undefined
          );
        }) === true)
  );
};

const validSelectedDamageTargetFrame = (
  state: FightState,
  frame: Extract<ResolutionFrame, { readonly type: "effect" }>,
) => {
  const sourceMove = mechanicsFor(state).moves.find((move) => move.id === frame.sourceDefinitionId);
  const effect = sourceMove?.effects?.[frame.effectIndex];
  const target = state.combatants[frame.targetCombatantId];
  const eligibleMoveIds = frame.eligibleMoveIds;
  const selector = effect?.type === "modify-damage" ? effect.selector : undefined;
  if (
    effect?.type !== "modify-damage" ||
    effect.trigger !== "on-success" ||
    effect.target !== "opponent" ||
    effect.operation !== "set" ||
    effect.percent?.type !== "literal" ||
    effect.percent.value !== 0 ||
    selector === undefined ||
    eligibleMoveIds === undefined
  )
    return false;
  return eligibleMoveIds.every((moveId) => {
    const move = mechanicsFor(state).moves.find((candidate) => candidate.id === moveId);
    return (
      target.moveIds.includes(moveId) && move !== undefined && matchesMoveSelector(move, selector)
    );
  });
};

const validSelectedTemporaryMoveRemovalFrame = (
  state: FightState,
  frame: Extract<ResolutionFrame, { readonly type: "effect" }>,
) => {
  const sourceMove = mechanicsFor(state).moves.find((move) => move.id === frame.sourceDefinitionId);
  const effect = sourceMove?.effects?.[frame.effectIndex];
  const target = state.combatants[frame.targetCombatantId];
  const eligibleMoveIds = frame.eligibleMoveIds;
  if (
    effect?.type !== "remove-move-from-combat" ||
    effect.trigger !== "on-success" ||
    effect.target !== "opponent" ||
    effect.move !== "target" ||
    effect.selector === undefined ||
    effect.duration?.type !== "until-perfect-roll" ||
    eligibleMoveIds === undefined
  )
    return false;
  const selector = effect.selector;
  return eligibleMoveIds.every((moveId) => {
    const move = mechanicsFor(state).moves.find((candidate) => candidate.id === moveId);
    return (
      target.moveIds.includes(moveId) && move !== undefined && matchesMoveSelector(move, selector)
    );
  });
};

const validSelectedSuppressionTargetFrame = (
  state: FightState,
  frame: Extract<ResolutionFrame, { readonly type: "effect" }>,
  // eslint-disable-next-line complexity -- Invariant validation intentionally centralizes serialized-state checks.
) => {
  const sourceMove = mechanicsFor(state).moves.find((move) => move.id === frame.sourceDefinitionId);
  const effect = sourceMove?.effects?.[frame.effectIndex];
  const target = state.combatants[frame.targetCombatantId];
  const eligibleMoveIds = frame.eligibleMoveIds;
  if (
    effect?.type !== "suppress" ||
    effect.trigger !== "on-success" ||
    (effect.target !== "self" && effect.target !== "opponent") ||
    effect.selector === undefined ||
    effect.aspects?.length !== 1 ||
    effect.aspects[0] !== "successful-effects" ||
    effect.duration?.type !== "combat" ||
    effect.selectionSpec?.type !== "up-to" ||
    effect.selectionSpec.limit.type !== "literal" ||
    effect.selectionSpec.limit.value !== 1 ||
    effect.scope !== undefined ||
    effect.conditions !== undefined ||
    effect.activationCost !== undefined ||
    effect.useLimit !== undefined ||
    effect.cooldown !== undefined ||
    effect.stacking !== undefined ||
    eligibleMoveIds === undefined
  )
    return false;
  const selector = effect.selector;
  return eligibleMoveIds.every((moveId) => {
    const move = mechanicsFor(state).moves.find((candidate) => candidate.id === moveId);
    return (
      target.moveIds.includes(moveId) && move !== undefined && matchesMoveSelector(move, selector)
    );
  });
};

const validSelectedMoveTargetFrame = (
  state: FightState,
  frame: Extract<ResolutionFrame, { readonly type: "effect" }>,
) => {
  const sourceMove = mechanicsFor(state).moves.find(
    (candidate) => candidate.id === frame.sourceDefinitionId,
  );
  const effect = sourceMove?.effects?.[frame.effectIndex];
  const target = state.combatants[frame.targetCombatantId];
  return (
    effect?.type === "modify-remaining-uses" &&
    effect.trigger === "on-success" &&
    effect.target === "self" &&
    effect.selector.subject === "source" &&
    effect.selector.restriction === "restricted" &&
    frame.eligibleMoveIds !== undefined &&
    frame.eligibleMoveIds.every(
      (moveId) =>
        target.moveIds.includes(moveId) &&
        mechanicsFor(state).moves.some(
          (candidate) => candidate.id === moveId && matchesMoveSelector(candidate, effect.selector),
        ),
    )
  );
};

const validEffectSelectionFrame = (
  state: FightState,
  frame: Extract<ResolutionFrame, { readonly type: "effect" }>,
  // eslint-disable-next-line complexity -- Invariant validation intentionally centralizes serialized-state checks.
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
  if (!validActivationFrameMetadata(state, frame)) return false;
  if (!validEffectOperation(frame.operation)) return false;
  if (frame.eligibleMoveIds === undefined || frame.eligibleMoveIds.length === 0) return false;
  if (new Set(frame.eligibleMoveIds).size !== frame.eligibleMoveIds.length) return false;
  return validEffectSelectionOperation(state, frame);
};

const validEffectSelectionOperation = (
  state: FightState,
  frame: Extract<ResolutionFrame, { readonly type: "effect" }>,
  // eslint-disable-next-line complexity -- Invariant validation intentionally centralizes serialized-state checks.
) => {
  const eligibleMoveIds = frame.eligibleMoveIds;
  if (eligibleMoveIds === undefined) return false;
  if (frame.operation === "activate") {
    const target = state.combatants[frame.targetCombatantId];
    return eligibleMoveIds.every((moveId) => {
      const move = mechanicsFor(state).moves.find((candidate) => candidate.id === moveId);
      return (
        target.moveIds.includes(moveId) &&
        ((move?.category === "skill" && move.mechanics.activationClassification === "constant") ||
          (frame.activationAsIf === "power-up" &&
            move?.category === "mastery" &&
            move.effects?.some((effect) => effect.trigger === "on-power-up") === true))
      );
    });
  }
  if (frame.operation === "copy-move") {
    return validCopyMoveSelectionFrame(state, frame);
  }
  if (frame.operation === "replace-constant") {
    const sourceMove = mechanicsFor(state).moves.find(
      (candidate) => candidate.id === frame.sourceDefinitionId,
    );
    const effect = sourceMove?.effects?.[frame.effectIndex];
    const actor = state.combatants[frame.sourceCombatantId];
    const opponent = Object.values(state.combatants).find(
      (candidate) => candidate.id !== actor.id && candidate.status === "active",
    );
    const replacementSelectionValid =
      frame.replacementSourceMoveSnapshot === undefined
        ? eligibleMoveIds.every((moveId) => {
            const move = mechanicsFor(state).moves.find((candidate) => candidate.id === moveId);
            return (
              opponent?.moveIds.includes(moveId) === true &&
              move?.category === "skill" &&
              move.mechanics.activationClassification === "constant"
            );
          })
        : eligibleMoveIds.every((moveId) =>
            state.activeEffects.some(
              (candidate) =>
                candidate.type === "active-constant" &&
                isEffectActive(candidate) &&
                candidate.sourceCombatantId === actor.id &&
                candidate.sourceDefinitionId === moveId,
            ),
          );
    return (
      effect?.type === "replace-active-constant-effects" &&
      sourceMove !== undefined &&
      opponent !== undefined &&
      frame.targetCombatantId === actor.id &&
      replacementSelectionValid
    );
  }
  if (frame.operation === "select-damage-target")
    return validSelectedDamageTargetFrame(state, frame);
  if (frame.operation === "select-suppression-target")
    return validSelectedSuppressionTargetFrame(state, frame);
  if (frame.operation === "select-move-target") return validSelectedMoveTargetFrame(state, frame);
  if (frame.operation === "select-move-removal")
    return validSelectedTemporaryMoveRemovalFrame(state, frame);
  return eligibleMoveIds.every((moveId) =>
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
  // eslint-disable-next-line complexity -- Invariant validation intentionally centralizes serialized-state checks.
) => {
  if (frame.operation === "defer-move")
    return (
      state.status === "active" &&
      isActiveCombatant(state, frame.sourceCombatantId) &&
      isActiveCombatant(state, frame.targetCombatantId) &&
      frame.trigger === "action" &&
      frame.pendingDecisionId !== undefined &&
      state.pendingDecision?.id === frame.pendingDecisionId &&
      state.pendingDecision.type === "optional-effect" &&
      frame.sourceDefinitionId.length > 0 &&
      frame.effectIndex >= 0 &&
      frame.optional === true
    );
  if (frame.operation === "activate-extra-action") {
    const allowance = state.activeEffects.find(
      (effect) => effect.type === "extra-action" && effect.id === frame.activeEffectId,
    );
    return (
      state.status === "active" &&
      (frame.trigger === "upkeep" || frame.trigger === "on-success") &&
      isActiveCombatant(state, frame.sourceCombatantId) &&
      isActiveCombatant(state, frame.targetCombatantId) &&
      frame.pendingDecisionId !== undefined &&
      state.pendingDecision?.id === frame.pendingDecisionId &&
      state.pendingDecision.type === "optional-effect" &&
      frame.optional === true &&
      allowance?.type === "extra-action" &&
      allowance.sourceDefinitionId === frame.sourceDefinitionId &&
      allowance.sourceEffectIndex === frame.effectIndex &&
      allowance.activationCost !== undefined
    );
  }
  return (
    isActiveCombatant(state, frame.sourceCombatantId) &&
    isActiveCombatant(state, frame.targetCombatantId) &&
    typeof frame.sourceDefinitionId === "string" &&
    frame.sourceDefinitionId.length > 0 &&
    validCounter(frame.effectIndex, 0) &&
    (frame.resolved === undefined ||
      (frame.resolved === true &&
        frame.pendingDecisionId === undefined &&
        (frame.trigger === "upkeep" || frame.trigger === "end"))) &&
    validEffectSelectionFrame(state, frame)
  );
};

const validEffectChoiceFrame = (
  state: FightState,
  frame: Extract<ResolutionFrame, { readonly type: "effect-choice" }>,
  // eslint-disable-next-line complexity -- Invariant validation intentionally centralizes serialized-state checks.
) => {
  const upkeepChoice =
    frame.effectTrigger === "upkeep-phase" || frame.effectTrigger === "start-combat";
  const actionPhaseChoice = frame.effectTrigger === "action-phase";
  let storedRollsValid: boolean;
  if (
    actionPhaseChoice ||
    frame.effectTrigger === "on-power-up" ||
    frame.effectTrigger === "on-move-use" ||
    upkeepChoice
  ) {
    storedRollsValid = frame.storedRolls === undefined;
  } else {
    storedRollsValid =
      frame.storedRolls !== undefined &&
      frame.storedRolls.length > 0 &&
      frame.storedRolls.every((storedRoll) => {
        const sourceMove = mechanicsFor(state).moves.find(
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
  }
  const pendingCombatantId =
    frame.effectTrigger === "on-move-use" ? frame.sourceCombatantId : frame.actorId;
  let returnPhaseValid = frame.returnPhase === "end";
  if (upkeepChoice) returnPhaseValid = frame.returnPhase === "upkeep";
  else if (actionPhaseChoice) returnPhaseValid = frame.returnPhase === "action";
  return (
    state.status === "active" &&
    combatDecisionIdSchema.safeParse(frame.decisionId).success &&
    isActiveCombatant(state, frame.actorId) &&
    isActiveCombatant(state, frame.targetCombatantId) &&
    frame.actorId !== frame.targetCombatantId &&
    returnPhaseValid &&
    (upkeepChoice ||
      actionPhaseChoice ||
      frame.effectTrigger === "on-power-up" ||
      frame.effectTrigger === "on-roll-result" ||
      (runtimeValue(frame.effectTrigger) === "on-move-use" &&
        frame.sourceCombatantId !== undefined &&
        isActiveCombatant(state, frame.sourceCombatantId) &&
        state.activeEffects.some(
          (effect) =>
            effect.type === "active-constant" &&
            effect.sourceCombatantId === frame.sourceCombatantId &&
            effect.sourceDefinitionId === frame.sourceDefinitionId,
        ) &&
        frame.actionMoveId !== undefined &&
        state.combatants[frame.actorId].moveIds.includes(frame.actionMoveId))) &&
    (!actionPhaseChoice ||
      state.combatants[frame.actorId].moveIds.includes(frame.sourceDefinitionId)) &&
    storedRollsValid &&
    frame.sourceDefinitionId.length > 0 &&
    frame.effectIndices.length > 0 &&
    frame.effectIndices.every((index) => Number.isInteger(index) && index >= 0) &&
    new Set(frame.effectIndices).size === frame.effectIndices.length &&
    (frame.resolved === true
      ? frame.pendingDecisionId === undefined &&
        (frame.selectedEffectIndices === undefined ||
          frame.selectedEffectIndices.every((index) => frame.effectIndices.includes(index)))
      : pendingDecisionIdSchema.safeParse(frame.pendingDecisionId).success &&
        state.pendingDecision !== undefined &&
        state.pendingDecision.id === frame.pendingDecisionId &&
        state.pendingDecision.type === "optional-effect" &&
        state.pendingDecision.combatantId === pendingCombatantId) &&
    (!upkeepChoice || actionPhaseChoice || frame.sourceCombatantId === frame.actorId)
  );
};

/* eslint-disable sonarjs/cognitive-complexity -- Resolution-frame validation intentionally centralizes serialized-state checks. */
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
          validFrame =
            (frame.stage !== "awaiting-effect-choice" ||
              validChoiceMetadata(frame.selection, frame.optional, frame.costTiming)) &&
            validAttackResolutionFrame(state, frame);
          if (validFrame && frame.stage === "awaiting-effect-choice")
            validFrame = validEffectAlternatives(frame);
          break;
        case "effect":
          validFrame =
            validChoiceMetadata(frame.selection, frame.optional, frame.costTiming) &&
            validEffectResolutionFrame(state, frame);
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
/* eslint-enable sonarjs/cognitive-complexity */

const validateFightMetadata = (
  state: FightState,
  combatantEntries: readonly [string, CombatantState][],
  violations: FightStateInvariantViolation[],
  mechanics: CombatMechanicsView,
) => {
  if (
    state.schemaVersion !== undefined &&
    state.schemaVersion !== 1 &&
    state.schemaVersion !== 2 &&
    state.schemaVersion !== 3 &&
    state.schemaVersion !== 4 &&
    state.schemaVersion !== 5
  ) {
    addViolation(
      violations,
      "invalid-schema-version",
      "Fight state schema version must be 1, 2, 3, 4, or 5 when present.",
    );
  }
  if (state.schemaVersion === 5 && state.mechanicsView === undefined) {
    addViolation(
      violations,
      "invalid-mechanics-view",
      "Schema version 5 fight state must retain a mechanics-view identity.",
    );
  }
  if (
    state.mechanicsView !== undefined &&
    (state.mechanicsView.schemaVersion !== mechanics.identity.schemaVersion ||
      state.mechanicsView.contentHash !== mechanics.identity.contentHash)
  ) {
    addViolation(
      violations,
      "invalid-mechanics-view",
      "Fight state mechanics-view identity does not match the supplied mechanics view.",
    );
  }
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

const finiteNumbersOnly = (value: unknown): boolean => {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finiteNumbersOnly);
  if (typeof value !== "object" || value === null) return true;
  return Object.values(value).every(finiteNumbersOnly);
};

const validScheduledWork = (
  state: FightState,
  work: ScheduledCombatWork,
  ids: ReadonlySet<string>,
  insertionOrders: ReadonlySet<number>,
): boolean => {
  if (!scheduledWorkIdSchema.safeParse(work.id).success || ids.has(work.id)) return false;
  if (
    !Number.isInteger(work.insertionOrder) ||
    work.insertionOrder < 1 ||
    insertionOrders.has(work.insertionOrder)
  )
    return false;
  if (
    (work.ownerCombatantId !== undefined &&
      state.combatants[work.ownerCombatantId] === undefined) ||
    (work.targetCombatantId !== undefined && state.combatants[work.targetCombatantId] === undefined)
  )
    return false;
  if (
    work.sourceEffectId !== undefined &&
    !activeEffectIdSchema.safeParse(work.sourceEffectId).success
  )
    return false;
  const timing = work.timing;
  if (timing.type === "immediate")
    return validScheduledOperation(state, work) && finiteNumbersOnly(work);
  if (timing.type !== "end-of-action" && timing.type !== "next-upkeep" && timing.type !== "delayed")
    return false;
  if (state.combatants[timing.combatantId] === undefined) return false;
  if (!Number.isInteger(timing.turnNumber) || timing.turnNumber < 1) return false;
  if (timing.turnNumber < state.turnNumber) return false;
  return validScheduledOperation(state, work) && finiteNumbersOnly(work);
};

const validMoveDefinition = (state: FightState, sourceDefinitionId: string | undefined): boolean =>
  sourceDefinitionId !== undefined &&
  mechanicsFor(state).moves.some((move) => move.id === sourceDefinitionId);

const validScheduledResourceOperation = (
  state: FightState,
  work: ScheduledCombatWork,
  operation: Extract<ScheduledCombatOperation, { readonly type: "resource" }>,
): boolean =>
  validMoveDefinition(state, work.sourceDefinitionId) &&
  (operation.resource === "hp" || operation.resource === "ki") &&
  (operation.operation === "damage" ||
    operation.operation === "drain" ||
    operation.operation === "gain" ||
    operation.operation === "lose" ||
    operation.operation === "set") &&
  Number.isInteger(operation.sourceEffectIndex) &&
  operation.sourceEffectIndex >= 0 &&
  (operation.boundary.type === "turn-start" ||
    operation.boundary.type === "turn-end" ||
    operation.boundary.type === "phase-start") &&
  state.combatants[operation.boundary.combatantId] !== undefined &&
  Number.isInteger(operation.remainingBoundaries) &&
  operation.remainingBoundaries >= 1 &&
  (operation.repeat === "once" || operation.repeat === "each-turn");

const validScheduledResultOperation = (
  operation: Extract<ScheduledCombatOperation, { readonly type: "combat-result" }>,
): boolean =>
  (operation.result === "successful" || operation.result === "stopped") &&
  (operation.replacement === undefined ||
    operation.replacement === "successful" ||
    operation.replacement === "stopped") &&
  typeof operation.prevented === "boolean";

const validScheduledPhaseOperation = (
  state: FightState,
  operation: Extract<ScheduledCombatOperation, { readonly type: "advance-phase" }>,
): boolean =>
  (operation.phase === "upkeep" ||
    operation.phase === "action" ||
    operation.phase === "counter" ||
    operation.phase === "end") &&
  state.combatants[operation.activeCombatantId] !== undefined;

const validScheduledExtraActionOperation = (
  state: FightState,
  work: ScheduledCombatWork,
  operation: Extract<ScheduledCombatOperation, { readonly type: "extra-action" }>,
): boolean =>
  validMoveDefinition(state, work.sourceDefinitionId) &&
  (operation.phase === "action" || operation.phase === "upkeep") &&
  typeof operation.sourceMoveOnly === "boolean" &&
  Number.isInteger(operation.remainingActions) &&
  operation.remainingActions >= 0 &&
  Number.isInteger(operation.availableFromTurn) &&
  operation.availableFromTurn >= 1 &&
  Number.isInteger(operation.expiresAfterTurn) &&
  operation.expiresAfterTurn >= operation.availableFromTurn;

const validScheduledCounterOperation = (
  state: FightState,
  operation: Extract<ScheduledCombatOperation, { readonly type: "counter" }>,
): boolean =>
  Number.isInteger(operation.chainDepth) &&
  operation.chainDepth >= 1 &&
  operation.chainDepth <=
    mechanicsFor(state).rules.combat.engineeringSafeguards.maximumConsecutiveCounterAttacks &&
  resolutionFrameIdSchema.safeParse(operation.returnFrameId).success &&
  state.resolutionFrames.some((frame) => frame.id === operation.returnFrameId) &&
  combatDecisionIdSchema.safeParse(operation.sourceActionId).success;

const validScheduledResumeOperation = (
  state: FightState,
  operation: Extract<ScheduledCombatOperation, { readonly type: "resume-frame" }>,
): boolean =>
  resolutionFrameIdSchema.safeParse(operation.frameId).success &&
  state.resolutionFrames.some((frame) => frame.id === operation.frameId);

const validScheduledDeferredMoveOperation = (
  state: FightState,
  work: ScheduledCombatWork,
  operation: Extract<ScheduledCombatOperation, { readonly type: "deferred-move" }>,
): boolean =>
  validMoveDefinition(state, work.sourceDefinitionId) &&
  mechanicsFor(state).moves.some((move) => move.id === operation.moveId) &&
  Number.isInteger(operation.sourceEffectIndex) &&
  operation.sourceEffectIndex >= 0 &&
  combatDecisionIdSchema.safeParse(operation.declarationDecisionId).success &&
  state.combatants[operation.cancellation.actorCombatantId] !== undefined &&
  operation.cancellation.result === "successful" &&
  (operation.onCancellation === undefined ||
    (operation.onCancellation.affectedType === "attack" &&
      operation.onCancellation.duration === "combat"));

const validScheduledOperation = (state: FightState, work: ScheduledCombatWork): boolean => {
  const operation = runtimeValue(work.operation) as ScheduledCombatOperation;
  switch (operation.type) {
    case "resource":
      return validScheduledResourceOperation(state, work, operation);
    case "combat-result":
      return validScheduledResultOperation(operation);
    case "advance-phase":
      return validScheduledPhaseOperation(state, operation);
    case "skip-action":
      return operation.reason === "status" || operation.reason === "effect";
    case "extra-action":
      return validScheduledExtraActionOperation(state, work, operation);
    case "counter":
      return validScheduledCounterOperation(state, operation);
    case "resume-frame":
      return validScheduledResumeOperation(state, operation);
    case "deferred-move":
      return validScheduledDeferredMoveOperation(state, work, operation);
    default:
      return false;
  }
};

const validateScheduledWork = (state: FightState, violations: FightStateInvariantViolation[]) => {
  const work = state.scheduledWork ?? [];
  const ids = new Set<string>();
  const insertionOrders = new Set<number>();
  for (const candidate of work) {
    if (!validScheduledWork(state, candidate, ids, insertionOrders)) {
      addViolation(
        violations,
        "invalid-scheduled-work",
        "Scheduled work must have unique IDs, valid references, legal timing, and finite values.",
        candidate.id,
      );
    }
    ids.add(candidate.id);
    insertionOrders.add(candidate.insertionOrder);
  }
  if (state.status === "completed" && work.length > 0) {
    addViolation(
      violations,
      "invalid-completion",
      "A completed fight must not retain unresolved scheduled work.",
    );
  }
};

const selectableMoveFrameAllows = (
  state: ActiveFightState,
  frame: Extract<ResolutionFrame, { readonly type: "effect" }>,
  moveId: string,
) => {
  if (frame.operation === "activate" || frame.operation === "copy-move")
    return state.combatants[frame.targetCombatantId].moveIds.includes(moveId);
  if (
    frame.operation === "select-damage-target" ||
    frame.operation === "select-suppression-target" ||
    frame.operation === "select-move-target" ||
    frame.operation === "select-move-removal"
  )
    return state.combatants[frame.targetCombatantId].moveIds.includes(moveId);
  if (frame.operation === "replace-constant") {
    if (frame.replacementSourceMoveSnapshot === undefined) {
      return Object.values(state.combatants).some(
        (combatant) =>
          combatant.id !== frame.sourceCombatantId && combatant.moveIds.includes(moveId),
      );
    }
    return state.activeEffects.some(
      (effect) =>
        effect.type === "active-constant" &&
        effect.sourceCombatantId === frame.targetCombatantId &&
        effect.sourceDefinitionId === moveId,
    );
  }
  return state.activeEffects.some(
    (effect) =>
      effect.type === "active-constant" &&
      effect.sourceCombatantId === frame.targetCombatantId &&
      effect.sourceDefinitionId === moveId,
  );
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
        selectableMoveFrameAllows(state, frame, moveId),
    );
  const validOptions = pendingDecision.options.every(
    (option) =>
      option.id.length > 0 &&
      validChoiceMetadata(option.selection, option.optional, option.costTiming) &&
      (option.selectedNumericValue === undefined || Number.isFinite(option.selectedNumericValue)) &&
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
  const validCandidates =
    pendingDecision.candidates === undefined ||
    (pendingDecision.candidates.length > 0 &&
      new Set(pendingDecision.candidates.map(candidateReferenceId)).size ===
        pendingDecision.candidates.length &&
      pendingDecision.candidates.every((candidate) => {
        if (candidate.type === "combatant") return isActiveCombatant(state, candidate.id);
        if (candidate.type === "active-effect")
          return state.activeEffects.some((effect) => effect.id === candidate.id);
        if (candidate.type === "source-action")
          return state.actionHistory.some(
            (action) => action.type !== "turn-skipped" && action.decisionId === candidate.id,
          );
        if (candidate.type === "move") {
          const owner = state.combatants[candidate.ownerCombatantId];
          return (
            owner?.moveIds.includes(candidate.id) === true ||
            state.activeEffects.some(
              (effect) =>
                effect.type === "remove-move-from-combat" &&
                effect.targetCombatantId === candidate.ownerCombatantId &&
                effect.moveId === candidate.id,
            )
          );
        }
        const separator = candidate.id.lastIndexOf(":");
        if (separator <= 0) return false;
        const sourceMove = mechanicsFor(state).moves.find(
          (move) => move.id === candidate.id.slice(0, separator),
        );
        const effectIndex = Number(candidate.id.slice(separator + 1));
        return sourceMove?.effects?.[effectIndex] !== undefined;
      }) &&
      pendingDecision.options
        .filter((option) => option.candidate !== undefined)
        .every((option) =>
          pendingDecision.candidates!.some(
            (candidate) =>
              candidateReferenceId(candidate) === candidateReferenceId(option.candidate!),
          ),
        ));
  return (
    pendingDecisionIdSchema.safeParse(pendingDecision.id).success &&
    pendingDecision.stateVersion === state.version &&
    isActiveCombatant(state, pendingDecision.combatantId) &&
    pendingDecision.options.length > 0 &&
    new Set(pendingDecision.options.map((option) => option.id)).size ===
      pendingDecision.options.length &&
    validOptions &&
    validCandidates &&
    validPersistedSelectionShape(pendingDecision) &&
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
    (outcome) =>
      outcome === undefined || outcome === "stopped" || runtimeValue(outcome) === "successful",
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
  const validCandidateFacts = validCandidateFactArray(
    frame.candidateFacts,
    frame.naturalRolls.length,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  );
  return (
    validResultOverrides && validNumericOverrides && validNaturalResults && validCandidateFacts
  );
};

const validPostDefenseReactionMatch = (
  frames: readonly PostDefenseReactionFrame[],
  pending: { readonly id: PendingDecisionId; readonly combatantId: CombatantId } | undefined,
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
  const counterOpportunityFrames = state.resolutionFrames.filter(
    (frame) =>
      frame.type === "attack" &&
      (frame.stage === "awaiting-counter" || frame.returnPhase === "counter"),
  );
  if (
    (state.phase === "counter" && counterOpportunityFrames.length === 0) ||
    (state.phase !== "counter" && counterOpportunityFrames.length > 0)
  ) {
    addViolation(
      violations,
      "invalid-resolution-frame",
      "Counter phase must have an awaiting-counter or counter-returning attack frame, and those frames require counter phase.",
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
export const validateFightState = (
  state: FightState,
  mechanics: CombatMechanicsView = CANONICAL_COMBAT_MECHANICS_VIEW,
): readonly FightStateInvariantViolation[] => {
  const violations: FightStateInvariantViolation[] = [];
  const combatantEntries = Object.entries(state.combatants);

  validateFightMetadata(state, combatantEntries, violations, mechanics);
  validateScheduledWork(state, violations);

  for (const [recordId, combatant] of combatantEntries) {
    validateCombatant(state, recordId, combatant, state.turnNumber, violations);
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
