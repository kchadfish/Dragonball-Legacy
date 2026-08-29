import { GLOBAL_RULES, RULES_VERSION } from "@dragonball-resurgence/game-config";
import {
  ITEM_DEFINITIONS,
  MOVE_DEFINITIONS,
  RACE_DEFINITIONS,
  TRANSFORMATION_DEFINITIONS,
} from "@dragonball-resurgence/game-data";

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
  SlotCapacityModification,
} from "./contracts.js";
import { createFightInputSchema } from "./contracts.js";
import { resolveActiveEffectConflicts } from "./conflict-policy.js";
import type { CombatDependencies } from "./dependencies.js";
import type { CombatantId } from "./ids.js";
import { validateFightState } from "./invariants.js";
import { applyCombatItemPassives } from "./item-effects-runtime.js";
import {
  dispatchCombatTrigger as moveEffectsForTrigger,
  dispatchCombatTriggerSources,
  type CombatTriggerSource,
} from "./combat-trigger-dispatch.js";
import {
  activeRollModifierFromApplication,
  startCombatCopySelectionFor,
} from "./progress-fight.js";
import {
  scheduledWorkFromLegacyEffect,
  scheduledWorkFromResolutionFrame,
} from "./fight-flow-scheduler.js";

const knownMoveIds = new Set(MOVE_DEFINITIONS.map((move) => move.id));
const knownItemIds = new Set(ITEM_DEFINITIONS.map((item) => item.id));
const knownTransformationIds = new Set(
  TRANSFORMATION_DEFINITIONS.map((transformation) => transformation.id),
);
const knownRaceIds = new Set(RACE_DEFINITIONS.map((race) => race.id));
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
): CombatantState => ({
  id: combatantId,
  ...(combatant.raceId === undefined ? {} : { raceId: combatant.raceId as never }),
  ...(combatant.declaredStyleId === undefined
    ? {}
    : { declaredStyleId: combatant.declaredStyleId }),
  hitPoints: { current: combatant.maximumHitPoints, maximum: combatant.maximumHitPoints },
  ki: { current: GLOBAL_RULES.combat.startingKi, maximum: GLOBAL_RULES.combat.maximumKi },
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
    mastery: GLOBAL_RULES.movesetSlots.mastery,
    skill: GLOBAL_RULES.movesetSlots.skill,
    "advanced-attack": GLOBAL_RULES.movesetSlots.advancedAttack,
    signature: GLOBAL_RULES.movesetSlots.signatureTechnique,
    block: GLOBAL_RULES.movesetSlots.block,
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
): {
  readonly capacities: CombatSlotCapacities;
  readonly modifications: readonly SlotCapacityModification[];
} => {
  const triggerSources: CombatTriggerSource[] = source.moveIds.flatMap((moveId) => {
    const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === moveId);
    return move === undefined ? [] : [{ kind: "carried-skill", move, owner: "self" }];
  });
  const modifications = dispatchCombatTriggerSources("passive", triggerSources, () => ({
    self: source,
    opponent,
    turnNumber: 1,
    completedTurnCount: 0,
    moves: new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate])),
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

const unknownTransformationIssuesFor = (input: CreateFightInput) =>
  input.combatants.flatMap((combatant, combatantIndex) =>
    (combatant.transformationIds ?? []).flatMap((transformationId, transformationIndex) =>
      knownTransformationIds.has(transformationId)
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
): readonly FightSetupIssue[] => {
  const transformation = TRANSFORMATION_DEFINITIONS.find(
    (candidate) => candidate.id === profile.transformationId,
  );
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
): readonly FightSetupIssue[] => {
  const profiles = transformationProfilesFor(combatant);
  const seen = new Set<string>();
  const raceIssues: readonly FightSetupIssue[] =
    combatant.raceId !== undefined && !knownRaceIds.has(combatant.raceId)
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
      transformationProfileIssuesForProfile(combatant, combatantIndex, profileIndex, profile, seen),
    ),
  ];
};

const transformationProfileIssuesFor = (input: CreateFightInput) =>
  input.combatants.flatMap(transformationProfileIssuesForCombatant);

const missingDeclaredStyleIssuesFor = (input: CreateFightInput) =>
  input.combatants.flatMap((combatant, combatantIndex) =>
    combatant.moveIds.flatMap((moveId) => {
      const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === moveId);
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

const unknownItemIssuesFor = (input: CreateFightInput) =>
  input.combatants.flatMap((combatant, combatantIndex) =>
    (combatant.itemIds ?? []).flatMap((itemId, itemIndex) =>
      knownItemIds.has(itemId)
        ? []
        : [
            {
              path: `combatants.${combatantIndex}.itemIds.${itemIndex}`,
              message: `Unknown item ID: ${itemId}.`,
            } satisfies FightSetupIssue,
          ],
    ),
  );

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
      GLOBAL_RULES.combat.initiative.tiedDexterityTieBreakerDieSides,
    );
    const secondRoll = dependencies.random.integer(
      1,
      GLOBAL_RULES.combat.initiative.tiedDexterityTieBreakerDieSides,
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

const startCombatRollState = (
  firstCombatant: CombatantState,
  secondCombatant: CombatantState,
  dependencies: CombatDependencies,
) => {
  const moves = new Map(MOVE_DEFINITIONS.map((move) => [move.id, move]));
  const activeEffects: ActiveCombatEffect[] = [];
  const initiativeModifiers = new Map<CombatantId, number>();
  for (const [source, opponent] of [
    [firstCombatant, secondCombatant],
    [secondCombatant, firstCombatant],
  ] as const) {
    const triggerSources: CombatTriggerSource[] = source.moveIds.flatMap((moveId) => {
      const move = moves.get(moveId);
      return move === undefined ? [] : [{ kind: "carried-skill", move, owner: "self" }];
    });
    const effects = dispatchCombatTriggerSources("start-combat", triggerSources, () => ({
      self: source,
      opponent,
      turnNumber: 1,
      completedTurnCount: 0,
      moves,
      moveActivationCounts: new Map(),
      successfulHitCount: 0,
      activeEffects,
    }));
    for (const [index, effectResult] of effects.entries()) {
      const move = triggerSources[index]!.move;
      for (const application of effectResult.rollModifications)
        appendStartCombatRollModification(
          application,
          source,
          opponent,
          move.id,
          activeEffects,
          initiativeModifiers,
          dependencies,
        );
    }
  }
  return {
    activeEffects: resolveActiveEffectConflicts([], activeEffects).effects,
    initiativeModifiers,
  };
};

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
  const parsedInput = createFightInputSchema.safeParse(input);
  if (!parsedInput.success) {
    return {
      ok: false,
      error: { type: "invalid-fight-setup", issues: toFightSetupIssues(parsedInput.error) },
    };
  }

  const unknownMoveIssues = parsedInput.data.combatants.flatMap((combatant, combatantIndex) =>
    combatant.moveIds.flatMap((moveId, moveIndex) =>
      knownMoveIds.has(moveId)
        ? []
        : [
            {
              path: `combatants.${combatantIndex}.moveIds.${moveIndex}`,
              message: `Unknown move ID: ${moveId}.`,
            } satisfies FightSetupIssue,
          ],
    ),
  );
  const unknownItemIssues = unknownItemIssuesFor(parsedInput.data);
  const unknownTransformationIssues = unknownTransformationIssuesFor(parsedInput.data);
  const transformationProfileIssues = transformationProfileIssuesFor(parsedInput.data);
  const missingDeclaredStyleIssues = missingDeclaredStyleIssuesFor(parsedInput.data);
  const setupIssues = [
    ...unknownMoveIssues,
    ...unknownItemIssues,
    ...unknownTransformationIssues,
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
      createCombatantState(combatantId, inputCombatant),
      (inputCombatant.itemIds ?? []).flatMap((itemId) => {
        const item = ITEM_DEFINITIONS.find((candidate) => candidate.id === itemId);
        return item === undefined ? [] : [item];
      }),
    );
  const firstCombatantBase = combatantWithItemPassives(firstCombatantId, firstCombatantInput);
  const secondCombatantBase = combatantWithItemPassives(secondCombatantId, secondCombatantInput);
  const firstSlotCapacityState = passiveSlotCapacityState(firstCombatantBase, secondCombatantBase);
  const secondSlotCapacityState = passiveSlotCapacityState(secondCombatantBase, firstCombatantBase);
  const firstCombatant: CombatantState = {
    ...firstCombatantBase,
    slotCapacities: firstSlotCapacityState.capacities,
    slotCapacityModifications: firstSlotCapacityState.modifications,
  };
  const secondCombatant: CombatantState = {
    ...secondCombatantBase,
    slotCapacities: secondSlotCapacityState.capacities,
    slotCapacityModifications: secondSlotCapacityState.modifications,
  };
  const combatants: Readonly<Record<CombatantId, CombatantState>> = {
    [firstCombatantId]: firstCombatant,
    [secondCombatantId]: secondCombatant,
  };
  const startCombat = startCombatRollState(firstCombatant, secondCombatant, dependencies);
  const initiative = determineInitiative(
    firstCombatant,
    secondCombatant,
    dependencies,
    startCombat.initiativeModifiers,
  );
  const activeCombatantId = initiative.activeCombatantId;
  const state: ActiveFightState = {
    id: fightId,
    schemaVersion: 3,
    version: 0,
    rulesVersion: { ...RULES_VERSION },
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
  const violations = validateFightState(stateWithScheduledWork);
  if (violations.length > 0) {
    return { ok: false, error: { type: "invalid-fight-state", violations } };
  }

  return {
    ok: true,
    value: {
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
    },
  };
};
