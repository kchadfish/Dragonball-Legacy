import { GLOBAL_RULES, RULES_VERSION } from "@dragonball-resurgence/game-config";
import {
  ITEM_DEFINITIONS,
  MOVE_DEFINITIONS,
  TRANSFORMATION_DEFINITIONS,
} from "@dragonball-resurgence/game-data";

import type {
  ActiveFightState,
  CombatResult,
  CombatTransition,
  CombatantState,
  CreateFightInput,
  FightSetupIssue,
} from "./contracts.js";
import { createFightInputSchema } from "./contracts.js";
import type { CombatDependencies } from "./dependencies.js";
import type { CombatantId } from "./ids.js";
import { validateFightState } from "./invariants.js";
import { applyCombatItemPassives } from "./item-effects-runtime.js";

const knownMoveIds = new Set(MOVE_DEFINITIONS.map((move) => move.id));
const knownItemIds = new Set(ITEM_DEFINITIONS.map((item) => item.id));
const knownTransformationIds = new Set(
  TRANSFORMATION_DEFINITIONS.map((transformation) => transformation.id),
);

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
  hitPoints: { current: combatant.maximumHitPoints, maximum: combatant.maximumHitPoints },
  ki: { current: GLOBAL_RULES.combat.startingKi, maximum: GLOBAL_RULES.combat.maximumKi },
  stats: { ...combatant.stats },
  moveIds: [...combatant.moveIds],
  ...(combatant.itemIds === undefined ? {} : { itemIds: [...combatant.itemIds] }),
  ...(combatant.transformationIds === undefined
    ? {}
    : { transformationIds: [...combatant.transformationIds] }),
  moveUses: {},
  itemUses: {},
  activeStatuses: [],
  status: "active",
});

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
  }[];
}

const determineInitiative = (
  firstCombatant: CombatantState,
  secondCombatant: CombatantState,
  dependencies: CombatDependencies,
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
      { combatantId: firstCombatant.id, naturalResult: firstRoll },
      { combatantId: secondCombatant.id, naturalResult: secondRoll },
    );
    if (firstRoll !== secondRoll) {
      activeCombatantId = firstRoll > secondRoll ? firstCombatant.id : secondCombatant.id;
    }
  }
  return { activeCombatantId, tieBreakerRolls };
};

/**
 * Creates the supported initial local, untransformed, itemless 1v1 state.
 * Initiative uses the configured Dexterity ordering and injected tie-breaker
 * rolls, so callers cannot choose an advantageous opening combatant.
 */
export const createFight = (
  input: unknown,
  dependencies: CombatDependencies,
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
  const setupIssues = [...unknownMoveIssues, ...unknownItemIssues, ...unknownTransformationIssues];
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
  const firstCombatant = combatantWithItemPassives(firstCombatantId, firstCombatantInput);
  const secondCombatant = combatantWithItemPassives(secondCombatantId, secondCombatantInput);
  const combatants: Readonly<Record<CombatantId, CombatantState>> = {
    [firstCombatantId]: firstCombatant,
    [secondCombatantId]: secondCombatant,
  };
  const initiative = determineInitiative(firstCombatant, secondCombatant, dependencies);
  const activeCombatantId = initiative.activeCombatantId;
  const state: ActiveFightState = {
    id: fightId,
    version: 0,
    rulesVersion: { ...RULES_VERSION },
    mode: parsedInput.data.mode,
    status: "active",
    turnNumber: 1,
    phase: "upkeep",
    activeCombatantId,
    combatants,
    activeEffects: [],
    actionHistory: [],
    resolutionFrames: [],
    eventSequence: 2 + initiative.tieBreakerRolls.length,
  };
  const violations = validateFightState(state);
  if (violations.length > 0) {
    return { ok: false, error: { type: "invalid-fight-state", violations } };
  }

  return {
    ok: true,
    value: {
      state,
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
          result: roll.naturalResult,
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
