import { describe, expect, it } from "vitest";

import type { ActiveFightState, CreateFightInput, FightState } from "./index.js";
import {
  advanceFight,
  createFight,
  enumerateLegalDecisions,
  submitCombatDecision,
} from "./index.js";
import {
  activeEffectIdSchema,
  combatDecisionIdSchema,
  combatantIdSchema,
  combatEventIdSchema,
  fightIdSchema,
} from "./ids.js";
import { createTestCombatDependencies } from "./testing/index.js";

const attackerId = combatantIdSchema.parse("combatant:death-beam-user");
const defenderId = combatantIdSchema.parse("combatant:target");
const deathBeamId = "move-afterlife-death-beam";

const input: CreateFightInput = {
  mode: "spar",
  activeCombatantIndex: 0,
  combatants: [
    {
      maximumHitPoints: 100,
      stats: { power: 20, dexterity: 4, dexterityBonus: 0 },
      moveIds: [deathBeamId],
    },
    {
      maximumHitPoints: 100,
      stats: { power: 20, dexterity: 4, dexterityBonus: 0 },
      moveIds: [deathBeamId],
    },
  ],
};

const dependencies = (randomValues: readonly number[]) =>
  createTestCombatDependencies(randomValues, new Date("2026-08-04T12:00:00.000Z"), {
    fightIds: [fightIdSchema.parse("fight:death-beam")],
    combatantIds: [attackerId, defenderId],
    activeEffectIds: [activeEffectIdSchema.parse("active-effect:death-beam-cost")],
    eventIds: Array.from({ length: 24 }, (_, index) =>
      combatEventIdSchema.parse(`event:death-${index + 1}`),
    ),
  });

const success = <T>(result: { readonly ok: boolean; readonly value?: T }): T => {
  if (!result.ok || result.value === undefined)
    throw new Error("Expected a successful transition.");
  return result.value;
};

const active = (state: FightState): ActiveFightState => {
  if (state.status !== "active") throw new Error("Expected an active fight.");
  return state;
};

const actionState = (randomValues: readonly number[]) => {
  const deps = dependencies(randomValues);
  const fight = success(createFight(input, deps));
  return { deps, state: active(success(advanceFight(fight.state, deps)).state) };
};

const deathBeamDecision = (actorId: typeof attackerId | typeof defenderId, version: number) => ({
  type: "use-move" as const,
  id: combatDecisionIdSchema.parse(`decision:death-beam-${version}`),
  actorId,
  expectedStateVersion: version,
  moveId: deathBeamId,
  targetCombatantId: actorId === attackerId ? defenderId : attackerId,
});

describe("Death Beam advanced-attack slice", () => {
  it("enumerates Death Beam only when its owner is the active combatant", () => {
    const { state } = actionState([]);

    expect(enumerateLegalDecisions(state, attackerId)).toContainEqual({
      type: "use-move",
      actorId: attackerId,
      moveId: deathBeamId,
      targetCombatantId: defenderId,
    });
  });

  it("spends its literal cost, resolves 1d35 damage, and creates its successful-hit modifier", () => {
    const { state, deps } = actionState([15, 1]);
    const transition = success(submitCombatDecision(state, deathBeamDecision(attackerId, 1), deps));

    expect(transition.state).toMatchObject({ version: 2, phase: "end", eventSequence: 11 });
    expect(transition.state.combatants[attackerId]?.ki.current).toBe(4);
    expect(transition.state.combatants[defenderId]?.hitPoints.current).toBe(93);
    expect(transition.state.activeEffects).toEqual([
      {
        id: activeEffectIdSchema.parse("active-effect:death-beam-cost"),
        type: "modify-ki-cost",
        sourceCombatantId: attackerId,
        targetCombatantId: defenderId,
        sourceDefinitionId: deathBeamId,
        amount: 1,
        selector: { category: "advanced-attack", baseKiCost: 1 },
        scope: "next-eligible-action",
      },
    ]);
    expect(transition.events.map((event) => event.type)).toEqual([
      "move-used",
      "ki-changed",
      "attack-rolled",
      "defense-rolled",
      "attack-resolved",
      "damage-applied",
      "effect-activated",
      "phase-changed",
    ]);
  });

  it("applies and expires the modifier when the affected combatant uses its next eligible attack", () => {
    const { state, deps } = actionState([15, 1, 1, 15]);
    const firstAttack = success(
      submitCombatDecision(state, deathBeamDecision(attackerId, 1), deps),
    );
    const nextUpkeep = success(advanceFight(firstAttack.state, deps));
    const defenderAction = success(advanceFight(nextUpkeep.state, deps));
    const transition = success(
      submitCombatDecision(defenderAction.state, deathBeamDecision(defenderId, 4), deps),
    );

    expect(transition.state.combatants[defenderId]?.ki.current).toBe(3);
    expect(transition.state.activeEffects).toEqual([]);
    expect(transition.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "ki-changed", amount: -2, remainingKi: 3 }),
        expect.objectContaining({
          type: "effect-expired",
          activeEffectId: activeEffectIdSchema.parse("active-effect:death-beam-cost"),
        }),
      ]),
    );
  });

  it("rejects an unaffordable modified attack without consuming the effect", () => {
    const { state, deps } = actionState([15, 1]);
    const firstAttack = success(
      submitCombatDecision(state, deathBeamDecision(attackerId, 1), deps),
    );
    const nextUpkeep = success(advanceFight(firstAttack.state, deps));
    const defenderAction = active(success(advanceFight(nextUpkeep.state, deps)).state);
    const lowKiState: ActiveFightState = {
      ...defenderAction,
      combatants: {
        ...defenderAction.combatants,
        [defenderId]: { ...defenderAction.combatants[defenderId], ki: { current: 1, maximum: 10 } },
      },
    };

    expect(submitCombatDecision(lowKiState, deathBeamDecision(defenderId, 4), deps)).toEqual({
      ok: false,
      error: { type: "insufficient-ki", required: 2, available: 1 },
    });
    expect(lowKiState.activeEffects).toHaveLength(1);
  });

  it("ends the fight instead of retaining an unusable successful-hit modifier after a defeating hit", () => {
    const { state, deps } = actionState([20, 1]);
    const nearDefeatState: ActiveFightState = {
      ...state,
      combatants: {
        ...state.combatants,
        [defenderId]: {
          ...state.combatants[defenderId],
          hitPoints: { current: 7, maximum: 100 },
        },
      },
    };

    const transition = success(
      submitCombatDecision(nearDefeatState, deathBeamDecision(attackerId, 1), deps),
    );

    expect(transition.state).toMatchObject({
      status: "completed",
      completion: { type: "defeat", winnerCombatantId: attackerId },
      activeEffects: [],
    });
    expect(transition.events.map((event) => event.type)).toEqual([
      "move-used",
      "ki-changed",
      "attack-rolled",
      "defense-rolled",
      "attack-resolved",
      "damage-applied",
      "combatant-defeated",
      "fight-ended",
    ]);
  });

  it("returns typed failures for unknown and unowned move submissions", () => {
    const { state, deps } = actionState([]);

    expect(
      submitCombatDecision(
        state,
        { ...deathBeamDecision(attackerId, 1), moveId: "move-not-converted" },
        deps,
      ),
    ).toMatchObject({ ok: false, error: { type: "unknown-move", moveId: "move-not-converted" } });
    expect(
      submitCombatDecision(
        state,
        { ...deathBeamDecision(attackerId, 1), moveId: "move-freestyle-hidden-power-level" },
        deps,
      ),
    ).toMatchObject({
      ok: false,
      error: {
        type: "move-not-owned",
        moveId: "move-freestyle-hidden-power-level",
        combatantId: attackerId,
      },
    });
  });
});
