import type {
  ActiveFightState,
  ActiveCombatEffect,
  CombatSlotCapacities,
  CombatResult,
  CombatTransition,
  CombatantState,
  CombatantTransformationProfile,
  CreateFightInput,
  FightSetupIssue,
  StoredRoll,
  SlotCapacityModification,
} from "./contracts.js";
import { createFightInputSchema } from "./contracts.js";
import type { CombatMechanicsView } from "./mechanics-view.js";
import { resolveActiveEffectConflicts } from "./conflict-policy.js";
import type { CombatDependencies } from "./dependencies.js";
import { mechanicsViewFor } from "./mechanics-view.js";
import type { CombatantId } from "./ids.js";
import { validateFightState } from "./invariants.js";
import { applyCombatItemPassives } from "./item-effects-runtime.js";
import {
  dispatchCombatTrigger as moveEffectsForTrigger,
  dispatchCombatTriggerSources,
  dispatchCombatTriggerSourceResults,
  combatTriggerSourcesFor,
} from "./combat-trigger-dispatch.js";
import {
  activeRollModifierFromApplication,
  startCombatCopySelectionFor,
} from "./progress-fight.js";
import {
  scheduledWorkFromLegacyEffect,
  scheduledWorkFromResolutionFrame,
} from "./fight-flow-scheduler.js";
import { collectCombatMechanicObservations } from "./mechanic-observations.js";

const activeTransformationRaceIds = new Set([
  "race-humans",
  "race-saiyans",
  "race-hybrid-saiyan",
  "race-namek",
  "race-changeling",
  "race-bio-androids",
]);

const toFightSetupIssues = (error: {
  readonly issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[];
}) =>
  error.issues.map((issue): FightSetupIssue => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));

const createCombatantState = (
  combatantId: CombatantId,
  combatant: CreateFightInput["combatants"][number],
  mechanics: CombatMechanicsView,
): CombatantState => ({
  id: combatantId,
  ...(combatant.raceId === undefined ? {} : { raceId: combatant.raceId as never }),
  ...(combatant.raceTraitIds === undefined ? {} : { raceTraitIds: [...combatant.raceTraitIds] }),
  ...(combatant.classId === undefined ? {} : { classId: combatant.classId }),
  ...(combatant.declaredStyleId === undefined
    ? {}
    : { declaredStyleId: combatant.declaredStyleId }),
  hitPoints: { current: combatant.maximumHitPoints, maximum: combatant.maximumHitPoints },
  ki: { current: mechanics.rules.combat.startingKi, maximum: mechanics.rules.combat.maximumKi },
  stats: { ...combatant.stats },
  ...(combatant.specializationPoints === undefined
    ? {}
    : { specializationPoints: combatant.specializationPoints }),
  ...(combatant.level === undefined ? {} : { level: combatant.level }),
  ...(combatant.planetHasDragonBalls === undefined
    ? {}
    : { planetHasDragonBalls: combatant.planetHasDragonBalls }),
  transformationProfiles: transformationProfilesFor(combatant),
  moveIds: [...combatant.moveIds],
  slotCapacities: {
    mastery: mechanics.rules.movesetSlots.mastery,
    skill: mechanics.rules.movesetSlots.skill,
    "advanced-attack": mechanics.rules.movesetSlots.advancedAttack,
    signature: mechanics.rules.movesetSlots.signatureTechnique,
    block: mechanics.rules.movesetSlots.block,
  },
  slotCapacityModifications: [],
  ...(combatant.itemIds === undefined ? {} : { itemIds: [...combatant.itemIds] }),
  moveUses: {},
  storedRolls: {},
  moveUseLimitModifiers: {},
  itemUses: {},
  activeStatuses: [],
  status: "active",
});

const transformationProfilesFor = (
  combatant: CreateFightInput["combatants"][number],
): readonly CombatantTransformationProfile[] => {
  if (combatant.transformationProfiles !== undefined)
    return combatant.transformationProfiles.map((profile) => ({ ...profile }));
  const mastered = new Set(combatant.masteredTransformationIds ?? []);
  return (combatant.transformationIds ?? []).map((transformationId) => ({
    transformationId: transformationId as never,
    rollSides: mastered.has(transformationId) ? 100 : 20,
    mastery: mastered.has(transformationId) ? "mastered" : "novice",
  }));
};

const passiveSlotCapacityState = (
  source: CombatantState,
  opponent: CombatantState,
  mechanics: CombatMechanicsView,
): {
  readonly capacities: CombatSlotCapacities;
  readonly modifications: readonly SlotCapacityModification[];
} => {
  const triggerSources = combatTriggerSourcesFor(source, "self", mechanics);
  const modifications = dispatchCombatTriggerSources("passive", triggerSources, () => ({
    self: source,
    opponent,
    turnNumber: 1,
    completedTurnCount: 0,
    moves: new Map(mechanics.moves.map((candidate) => [candidate.id, candidate])),
    moveActivationCounts: new Map(),
    successfulHitCount: 0,
  })).flatMap((effects) => effects.slotCapacityModifications);
  const capacities = modifications.reduce(
    (current, modification) => ({
      ...current,
      [modification.slot]: current[modification.slot] + modification.amount,
    }),
    source.slotCapacities!,
  );
  return { capacities, modifications };
};

const applyPermanentInnateStats = (
  source: CombatantState,
  opponent: CombatantState,
  mechanics: CombatMechanicsView,
) => {
  const results = dispatchCombatTriggerSourceResults(
    "passive",
    combatTriggerSourcesFor(source, "self", mechanics),
    () => ({
      self: source,
      opponent,
      turnNumber: 1,
      completedTurnCount: 0,
      moves: new Map(mechanics.moves.map((candidate) => [candidate.id, candidate])),
      moveActivationCounts: new Map(),
      successfulHitCount: 0,
    }),
  );
  const modifications = results.flatMap(({ source: triggerSource, effects }) =>
    triggerSource.source?.kind === "move"
      ? []
      : effects.statModifications.filter(
          (modification) =>
            modification.target === "self" &&
            modification.scope === undefined &&
            modification.duration === undefined,
        ),
  );
  const stats = modifications.reduce((current, modification) => {
    const statKey = modification.stat === "dexterity-bonus" ? "dexterityBonus" : "dexterity";
    const value = current[statKey];
    let nextValue = modification.amount;
    if (modification.operation === "add") nextValue = value + modification.amount;
    if (modification.operation === "multiply") nextValue = value * modification.amount;
    return { ...current, [statKey]: nextValue };
  }, source.stats);
  return { ...source, stats };
};

const unknownTransformationIssuesFor = (input: CreateFightInput, mechanics: CombatMechanicsView) =>
  input.combatants.flatMap((combatant, combatantIndex) =>
    (combatant.transformationIds ?? []).flatMap((transformationId, transformationIndex) =>
      mechanics.indexes.transformations.has(transformationId)
        ? []
        : [
            {
              path: `combatants.${combatantIndex}.transformationIds.${transformationIndex}`,
              message: `Unknown transformation ID: ${transformationId}.`,
            } satisfies FightSetupIssue,
          ],
    ),
  );

const masteryForRollSides = (
  rollSides: number,
): CombatantTransformationProfile["mastery"] | undefined => {
  if (rollSides >= 20 && rollSides <= 40) return "novice";
  if (rollSides >= 50 && rollSides <= 70) return "intermediate";
  if (rollSides >= 80 && rollSides <= 100) return "mastered";
  return undefined;
};

const transformationProfileIssuesForProfile = (
  combatant: CreateFightInput["combatants"][number],
  combatantIndex: number,
  profileIndex: number,
  profile: CombatantTransformationProfile,
  seen: Set<string>,
  mechanics: CombatMechanicsView,
): readonly FightSetupIssue[] => {
  const transformation = mechanics.indexes.transformations.get(profile.transformationId);
  const path = `combatants.${combatantIndex}.transformationProfiles.${profileIndex}`;
  const issues: FightSetupIssue[] = [];
  if (seen.has(profile.transformationId))
    issues.push({ path, message: "Transformation profiles must not contain duplicates." });
  seen.add(profile.transformationId);
  if (transformation === undefined)
    return [
      ...issues,
      { path, message: `Unknown transformation ID: ${profile.transformationId}.` },
    ];
  if (combatant.raceId !== undefined && transformation.raceId !== combatant.raceId)
    issues.push({ path, message: "Transformation must belong to the combatant's race." });
  if (
    combatant.transformationProfiles !== undefined &&
    !activeTransformationRaceIds.has(transformation.raceId)
  )
    issues.push({ path, message: "Transformation is outside the active six-family scope." });
  const expectedMastery = masteryForRollSides(profile.rollSides);
  if (expectedMastery !== undefined && expectedMastery !== profile.mastery)
    issues.push({ path, message: "Transformation mastery does not match its roll sides." });
  return issues;
};

const transformationProfileIssuesForCombatant = (
  combatant: CreateFightInput["combatants"][number],
  combatantIndex: number,
  mechanics: CombatMechanicsView,
): readonly FightSetupIssue[] => {
  const profiles = transformationProfilesFor(combatant);
  const seen = new Set<string>();
  const raceIssues: readonly FightSetupIssue[] =
    combatant.raceId !== undefined && !mechanics.indexes.races.has(combatant.raceId)
      ? [
          {
            path: `combatants.${combatantIndex}.raceId`,
            message: `Unknown race ID: ${combatant.raceId}.`,
          },
        ]
      : [];
  return [
    ...raceIssues,
    ...profiles.flatMap((profile, profileIndex) =>
      transformationProfileIssuesForProfile(
        combatant,
        combatantIndex,
        profileIndex,
        profile,
        seen,
        mechanics,
      ),
    ),
  ];
};

const transformationProfileIssuesFor = (input: CreateFightInput, mechanics: CombatMechanicsView) =>
  input.combatants.flatMap((combatant, index) =>
    transformationProfileIssuesForCombatant(combatant, index, mechanics),
  );

const missingDeclaredStyleIssuesFor = (input: CreateFightInput, mechanics: CombatMechanicsView) =>
  input.combatants.flatMap((combatant, combatantIndex) =>
    combatant.moveIds.flatMap((moveId) => {
      const move = mechanics.indexes.moves.get(moveId);
      const requiresDeclaredStyle = move?.effects?.some(
        (effect) =>
          effect.type === "modify-move-classification" && effect.replaceStyle === "declared-style",
      );
      return requiresDeclaredStyle && combatant.declaredStyleId === undefined
        ? [
            {
              path: `combatants.${combatantIndex}.declaredStyleId`,
              message: `A declared style ID is required for move ${moveId}.`,
            } satisfies FightSetupIssue,
          ]
        : [];
    }),
  );

const unknownItemIssuesFor = (input: CreateFightInput, mechanics: CombatMechanicsView) =>
  input.combatants.flatMap((combatant, combatantIndex) =>
    (combatant.itemIds ?? []).flatMap((itemId, itemIndex) =>
      mechanics.indexes.items.has(itemId)
        ? []
        : [
            {
              path: `combatants.${combatantIndex}.itemIds.${itemIndex}`,
              message: `Unknown item ID: ${itemId}.`,
            } satisfies FightSetupIssue,
          ],
    ),
  );

const unknownInnateAbilityIssuesFor = (input: CreateFightInput, mechanics: CombatMechanicsView) =>
  input.combatants.flatMap((combatant, combatantIndex) => [
    ...(combatant.raceTraitIds ?? []).flatMap((traitId, traitIndex) =>
      mechanics.indexes.raceTraits.has(traitId)
        ? []
        : [
            {
              path: `combatants.${combatantIndex}.raceTraitIds.${traitIndex}`,
              message: `Unknown race trait ID: ${traitId}.`,
            } satisfies FightSetupIssue,
          ],
    ),
    ...(combatant.classId !== undefined &&
    !(
      mechanics.indexes.genericClasses.has(combatant.classId) ||
      mechanics.indexes.raceClasses.has(combatant.classId)
    )
      ? [
          {
            path: `combatants.${combatantIndex}.classId`,
            message: `Unknown class ID: ${combatant.classId}.`,
          } satisfies FightSetupIssue,
        ]
      : []),
  ]);

interface InitiativeResult {
  readonly activeCombatantId: CombatantId;
  readonly tieBreakerRolls: readonly {
    readonly combatantId: CombatantId;
    readonly naturalResult: number;
    readonly result: number;
  }[];
}

const determineInitiative = (
  firstCombatant: CombatantState,
  secondCombatant: CombatantState,
  dependencies: CombatDependencies,
  modifiers: ReadonlyMap<CombatantId, number>,
  mechanics: CombatMechanicsView,
): InitiativeResult => {
  if (firstCombatant.stats.dexterity !== secondCombatant.stats.dexterity) {
    return {
      activeCombatantId:
        firstCombatant.stats.dexterity > secondCombatant.stats.dexterity
          ? firstCombatant.id
          : secondCombatant.id,
      tieBreakerRolls: [],
    };
  }

  const tieBreakerRolls: InitiativeResult["tieBreakerRolls"][number][] = [];
  let activeCombatantId: CombatantId | undefined;
  while (activeCombatantId === undefined) {
    const firstRoll = dependencies.random.integer(
      1,
      mechanics.rules.combat.initiative.tiedDexterityTieBreakerDieSides,
    );
    const secondRoll = dependencies.random.integer(
      1,
      mechanics.rules.combat.initiative.tiedDexterityTieBreakerDieSides,
    );
    tieBreakerRolls.push(
      {
        combatantId: firstCombatant.id,
        naturalResult: firstRoll,
        result: firstRoll + (modifiers.get(firstCombatant.id) ?? 0),
      },
      {
        combatantId: secondCombatant.id,
        naturalResult: secondRoll,
        result: secondRoll + (modifiers.get(secondCombatant.id) ?? 0),
      },
    );
    const firstResult = firstRoll + (modifiers.get(firstCombatant.id) ?? 0);
    const secondResult = secondRoll + (modifiers.get(secondCombatant.id) ?? 0);
    if (firstResult !== secondResult) {
      activeCombatantId = firstResult > secondResult ? firstCombatant.id : secondCombatant.id;
    }
  }
  return { activeCombatantId, tieBreakerRolls };
};

type StartCombatRollModification = ReturnType<
  typeof moveEffectsForTrigger
>["rollModifications"][number];

const appendStartCombatRollModification = (
  ...[application, source, opponent, moveId, activeEffects, initiativeModifiers, dependencies]: [
    application: StartCombatRollModification,
    source: CombatantState,
    opponent: CombatantState,
    moveId: CombatantState["moveIds"][number],
    activeEffects: ActiveCombatEffect[],
    initiativeModifiers: Map<CombatantId, number>,
    dependencies: CombatDependencies,
  ]
) => {
  const combatantId = application.target === "self" ? source.id : opponent.id;
  if (application.roll === "initiative" && application.modifier === "result") {
    initiativeModifiers.set(
      combatantId,
      (initiativeModifiers.get(combatantId) ?? 0) + application.amount,
    );
    return;
  }
  const active = activeRollModifierFromApplication(
    application.roll === "escape" && application.scope === undefined
      ? { ...application, scope: "combat" }
      : application,
    source.id,
    opponent.id,
    moveId,
    1,
    dependencies,
  );
  if (active !== undefined) activeEffects.push(active);
};

/* eslint-disable sonarjs/cognitive-complexity -- Start-combat effects must be resolved in source order as one deterministic transaction. */
const startCombatRollState = (
  firstCombatant: CombatantState,
  secondCombatant: CombatantState,
  dependencies: CombatDependencies,
  mechanics: CombatMechanicsView,
) => {
  const moves = new Map(mechanics.moves.map((move) => [move.id, move]));
  const activeEffects: ActiveCombatEffect[] = [];
  const initiativeModifiers = new Map<CombatantId, number>();
  const combatants: [CombatantState, CombatantState] = [firstCombatant, secondCombatant];
  const applyStartResource = (
    combatant: CombatantState,
    change: ReturnType<typeof moveEffectsForTrigger>["resources"][number],
  ): CombatantState => {
    const resource = change.resource === "hp" ? combatant.hitPoints : combatant.ki;
    let nextCurrent: number;
    if (change.operation === "set") nextCurrent = change.amount;
    else if (change.operation === "gain") nextCurrent = resource.current + change.amount;
    else nextCurrent = resource.current - change.amount;
    return {
      ...combatant,
      ...(change.resource === "hp"
        ? {
            hitPoints: {
              ...resource,
              current: Math.max(0, Math.min(resource.maximum, nextCurrent)),
            },
          }
        : {
            ki: {
              ...resource,
              current: Math.max(0, Math.min(resource.maximum, nextCurrent)),
            },
          }),
    };
  };
  for (const [source, opponent] of [
    [0, 1],
    [1, 0],
  ] as const) {
    const sourceIndex = source;
    const opponentIndex = opponent;
    const triggerSources = combatTriggerSourcesFor(combatants[sourceIndex], "self", mechanics);
    const dispatch = () =>
      dispatchCombatTriggerSourceResults("start-combat", triggerSources, () => ({
        self: combatants[sourceIndex],
        opponent: combatants[opponentIndex],
        turnNumber: 1,
        completedTurnCount: 0,
        moves,
        moveActivationCounts: new Map(),
        successfulHitCount: 0,
        activeEffects,
      }));
    let results = dispatch();
    const storedRollRequests = results.flatMap(({ effects }) => effects.storedRollRequests);
    if (storedRollRequests.length > 0) {
      let storedRolls = { ...(combatants[sourceIndex].storedRolls ?? {}) };
      for (const request of storedRollRequests) {
        const storedRoll: StoredRoll = {
          sourceDefinitionId: request.sourceDefinitionId,
          storageKey: request.storageKey,
          naturalResults: Array.from({ length: request.dice }, () =>
            dependencies.random.integer(1, request.sides),
          ),
          sides: request.sides,
          storedOnTurn: 1,
        };
        storedRolls = { ...storedRolls, [request.storageKey]: storedRoll };
      }
      combatants[sourceIndex] = { ...combatants[sourceIndex], storedRolls };
      results = dispatch();
    }
    for (const { source: triggerSource, effects } of results) {
      for (const change of effects.resources) {
        const targetIndex = change.target === "self" ? sourceIndex : opponentIndex;
        combatants[targetIndex] = applyStartResource(combatants[targetIndex], change);
      }
      for (const application of effects.rollModifications)
        appendStartCombatRollModification(
          application,
          combatants[sourceIndex],
          combatants[opponentIndex],
          triggerSource.move.id,
          activeEffects,
          initiativeModifiers,
          dependencies,
        );
    }
  }
  return {
    combatants,
    activeEffects: resolveActiveEffectConflicts([], activeEffects).effects,
    initiativeModifiers,
  };
};

/* eslint-enable sonarjs/cognitive-complexity */

/**
 * Creates the supported initial local, untransformed, itemless 1v1 state.
 * Initiative uses the configured Dexterity ordering and injected tie-breaker
 * rolls, so callers cannot choose an advantageous opening combatant.
 */
export const createFight = (
  input: unknown,
  dependencies: CombatDependencies,
  // eslint-disable-next-line max-lines-per-function -- Fight construction intentionally assembles the validated state boundary in one transaction.
): CombatResult<CombatTransition> => {
  const mechanics = mechanicsViewFor(dependencies.mechanicsView);
  const parsedInput = createFightInputSchema.safeParse(input);
  if (!parsedInput.success) {
    return {
      ok: false,
      error: { type: "invalid-fight-setup", issues: toFightSetupIssues(parsedInput.error) },
    };
  }

  const unknownMoveIssues = parsedInput.data.combatants.flatMap((combatant, combatantIndex) =>
    combatant.moveIds.flatMap((moveId, moveIndex) =>
      mechanics.indexes.moves.has(moveId)
        ? []
        : [
            {
              path: `combatants.${combatantIndex}.moveIds.${moveIndex}`,
              message: `Unknown move ID: ${moveId}.`,
            } satisfies FightSetupIssue,
          ],
    ),
  );
  const dexterityBonusIssues = parsedInput.data.combatants.flatMap((combatant, combatantIndex) => {
    const { minimumDexterityBonus, maximumDexterityBonus } = mechanics.rules.combat;
    const value = combatant.stats.dexterityBonus;
    return value >= minimumDexterityBonus && value <= maximumDexterityBonus
      ? []
      : [
          {
            path: `combatants.${combatantIndex}.stats.dexterityBonus`,
            message: `Dexterity bonus must be from ${minimumDexterityBonus} through ${maximumDexterityBonus}.`,
          } satisfies FightSetupIssue,
        ];
  });
  const unknownItemIssues = unknownItemIssuesFor(parsedInput.data, mechanics);
  const unknownTransformationIssues = unknownTransformationIssuesFor(parsedInput.data, mechanics);
  const unknownInnateAbilityIssues = unknownInnateAbilityIssuesFor(parsedInput.data, mechanics);
  const transformationProfileIssues = transformationProfileIssuesFor(parsedInput.data, mechanics);
  const missingDeclaredStyleIssues = missingDeclaredStyleIssuesFor(parsedInput.data, mechanics);
  const setupIssues = [
    ...dexterityBonusIssues,
    ...unknownMoveIssues,
    ...unknownItemIssues,
    ...unknownTransformationIssues,
    ...unknownInnateAbilityIssues,
    ...transformationProfileIssues,
    ...missingDeclaredStyleIssues,
  ];
  if (setupIssues.length > 0) {
    return { ok: false, error: { type: "invalid-fight-setup", issues: setupIssues } };
  }

  const [firstCombatantInput, secondCombatantInput] = parsedInput.data.combatants;
  const fightId = dependencies.ids.nextFightId();
  const firstCombatantId = dependencies.ids.nextCombatantId();
  const secondCombatantId = dependencies.ids.nextCombatantId();
  const combatantWithItemPassives = (
    combatantId: CombatantId,
    inputCombatant: CreateFightInput["combatants"][number],
  ) =>
    applyCombatItemPassives(
      createCombatantState(combatantId, inputCombatant, mechanics),
      (inputCombatant.itemIds ?? []).flatMap((itemId) => {
        const item = mechanics.indexes.items.get(itemId);
        return item === undefined ? [] : [item];
      }),
    );
  const firstCombatantBase = combatantWithItemPassives(firstCombatantId, firstCombatantInput);
  const secondCombatantBase = combatantWithItemPassives(secondCombatantId, secondCombatantInput);
  const firstCombatantWithInnateStats = applyPermanentInnateStats(
    firstCombatantBase,
    secondCombatantBase,
    mechanics,
  );
  const secondCombatantWithInnateStats = applyPermanentInnateStats(
    secondCombatantBase,
    firstCombatantBase,
    mechanics,
  );
  const firstSlotCapacityState = passiveSlotCapacityState(
    firstCombatantWithInnateStats,
    secondCombatantWithInnateStats,
    mechanics,
  );
  const secondSlotCapacityState = passiveSlotCapacityState(
    secondCombatantWithInnateStats,
    firstCombatantWithInnateStats,
    mechanics,
  );
  const firstCombatant: CombatantState = {
    ...firstCombatantWithInnateStats,
    slotCapacities: firstSlotCapacityState.capacities,
    slotCapacityModifications: firstSlotCapacityState.modifications,
  };
  const secondCombatant: CombatantState = {
    ...secondCombatantWithInnateStats,
    slotCapacities: secondSlotCapacityState.capacities,
    slotCapacityModifications: secondSlotCapacityState.modifications,
  };
  const startCombat = startCombatRollState(
    firstCombatant,
    secondCombatant,
    dependencies,
    mechanics,
  );
  const [firstCombatantAfterStart, secondCombatantAfterStart] = startCombat.combatants;
  const combatants: Readonly<Record<CombatantId, CombatantState>> = {
    [firstCombatantId]: firstCombatantAfterStart,
    [secondCombatantId]: secondCombatantAfterStart,
  };
  const initiative = determineInitiative(
    firstCombatantAfterStart,
    secondCombatantAfterStart,
    dependencies,
    startCombat.initiativeModifiers,
    mechanics,
  );
  const activeCombatantId = initiative.activeCombatantId;
  const state: ActiveFightState = {
    id: fightId,
    schemaVersion: 5,
    version: 0,
    rulesVersion: { ...mechanics.rulesVersion },
    mechanicsView: mechanics.identity,
    mode: parsedInput.data.mode,
    status: "active",
    turnNumber: 1,
    phase: "upkeep",
    activeCombatantId,
    combatants,
    activeEffects: startCombat.activeEffects,
    actionHistory: [],
    resolutionFrames: [],
    scheduledWork: [],
    eventSequence: 2 + initiative.tieBreakerRolls.length,
  };
  const initialCopySelection = startCombatCopySelectionFor(state, dependencies);
  const stateWithInitialCopySelection =
    initialCopySelection === undefined
      ? state
      : {
          ...state,
          pendingDecision: initialCopySelection.pendingDecision,
          resolutionFrames: [...state.resolutionFrames, initialCopySelection.frame],
        };
  const scheduledWork = [
    ...stateWithInitialCopySelection.activeEffects.flatMap((effect, index) => {
      const work = scheduledWorkFromLegacyEffect(effect, state.turnNumber, index + 1, "mirror");
      return work === undefined ? [] : [work];
    }),
    ...stateWithInitialCopySelection.resolutionFrames.map((frame, index) =>
      scheduledWorkFromResolutionFrame(
        frame,
        stateWithInitialCopySelection.activeEffects.length + index + 1,
      ),
    ),
  ];
  const stateWithScheduledWork = { ...stateWithInitialCopySelection, scheduledWork };
  const violations = validateFightState(stateWithScheduledWork, mechanics);
  if (violations.length > 0) {
    return { ok: false, error: { type: "invalid-fight-state", violations } };
  }

  const transition: CombatTransition = {
    state: stateWithScheduledWork,
    events: [
      {
        id: dependencies.ids.nextEventId(),
        sequence: 1,
        fightId,
        type: "fight-started",
        mode: state.mode,
      },
      ...initiative.tieBreakerRolls.map((roll, index) => ({
        id: dependencies.ids.nextEventId(),
        sequence: index + 2,
        fightId,
        type: "initiative-rolled" as const,
        combatantId: roll.combatantId,
        naturalResult: roll.naturalResult,
        result: roll.result,
      })),
      {
        id: dependencies.ids.nextEventId(),
        sequence: state.eventSequence,
        fightId,
        type: "turn-started",
        combatantId: activeCombatantId,
        turnNumber: state.turnNumber,
      },
    ],
  };
  return {
    ok: true,
    value: {
      ...transition,
      ...(dependencies.retainMechanicObservations === true
        ? {
            mechanicObservations: collectCombatMechanicObservations({
              transition,
              mechanicsView: mechanics,
            }),
          }
        : {}),
    },
  };
};
