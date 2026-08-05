import { GLOBAL_RULES, RULES_VERSION } from "@dragonball-resurgence/game-config";
import { MOVE_DEFINITIONS } from "@dragonball-resurgence/game-data";

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

const knownMoveIds = new Set(MOVE_DEFINITIONS.map((move) => move.id));

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
  status: "active",
});

/**
 * Creates the supported initial local, untransformed, itemless 1v1 state.
 * Initiative belongs to the caller until a canonical initiative rule exists in
 * game configuration, so this factory never rolls random values on creation.
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
  if (unknownMoveIssues.length > 0) {
    return { ok: false, error: { type: "invalid-fight-setup", issues: unknownMoveIssues } };
  }

  const [firstCombatantInput, secondCombatantInput] = parsedInput.data.combatants;
  const fightId = dependencies.ids.nextFightId();
  const firstCombatantId = dependencies.ids.nextCombatantId();
  const secondCombatantId = dependencies.ids.nextCombatantId();
  const firstCombatant = createCombatantState(firstCombatantId, firstCombatantInput);
  const secondCombatant = createCombatantState(secondCombatantId, secondCombatantInput);
  const combatants: Readonly<Record<CombatantId, CombatantState>> = {
    [firstCombatantId]: firstCombatant,
    [secondCombatantId]: secondCombatant,
  };
  const activeCombatantId =
    parsedInput.data.activeCombatantIndex === 0 ? firstCombatantId : secondCombatantId;
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
    eventSequence: 2,
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
        {
          id: dependencies.ids.nextEventId(),
          sequence: 2,
          fightId,
          type: "turn-started",
          combatantId: activeCombatantId,
          turnNumber: state.turnNumber,
        },
      ],
    },
  };
};
