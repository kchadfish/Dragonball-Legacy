import { describe, expect, it } from "vitest";

import type { ActiveFightState, CreateFightInput, FightState } from "./index.js";
import {
  advanceFight,
  createFight,
  enumerateLegalDecisions,
  submitCombatDecision,
} from "./index.js";
import {
  combatDecisionIdSchema,
  combatantIdSchema,
  combatEventIdSchema,
  fightIdSchema,
  pendingDecisionIdSchema,
} from "./ids.js";
import { createTestCombatDependencies } from "./testing/index.js";

const firstCombatantId = combatantIdSchema.parse("combatant:goku");
const secondCombatantId = combatantIdSchema.parse("combatant:vegeta");

const input: CreateFightInput = {
  mode: "spar",
  activeCombatantIndex: 0,
  combatants: [
    {
      maximumHitPoints: 150,
      stats: { power: 20, dexterity: 4, dexterityBonus: 1 },
      moveIds: ["move-freestyle-hidden-power-level"],
    },
    {
      maximumHitPoints: 125,
      stats: { power: 18, dexterity: 5, dexterityBonus: 2 },
      moveIds: ["move-afterlife-give-me-energy"],
    },
  ],
};

const createDependencies = () =>
  createTestCombatDependencies([], new Date("2026-08-04T12:00:00.000Z"), {
    fightIds: [fightIdSchema.parse("fight:opening-spar")],
    combatantIds: [firstCombatantId, secondCombatantId],
    eventIds: [
      combatEventIdSchema.parse("event:fight-started"),
      combatEventIdSchema.parse("event:turn-started"),
      combatEventIdSchema.parse("event:phase-action"),
      combatEventIdSchema.parse("event:ki-gained"),
      combatEventIdSchema.parse("event:phase-end"),
      combatEventIdSchema.parse("event:phase-upkeep"),
      combatEventIdSchema.parse("event:next-turn"),
      combatEventIdSchema.parse("event:next-action"),
    ],
  });

const requireTransition = <T>(result: { readonly ok: boolean; readonly value?: T }): T => {
  if (!result.ok || result.value === undefined)
    throw new Error("Expected a successful combat transition.");
  return result.value;
};

const requireActiveFightState = (state: FightState): ActiveFightState => {
  if (state.status !== "active") throw new Error("Expected an active fight state.");
  return state;
};

const createInitialState = (dependencies = createDependencies()) => {
  const fight = createFight(input, dependencies);
  return { state: requireTransition(fight).state, dependencies };
};

describe("initial turn progression", () => {
  it("progresses upkeep through a power-up, end, and the next combatant's action", () => {
    const { state: initialState, dependencies } = createInitialState();
    const initialSnapshot = structuredClone(initialState);

    const actionTransition = requireTransition(advanceFight(initialState, dependencies));
    expect(actionTransition).toEqual({
      state: expect.objectContaining({ version: 1, phase: "action", eventSequence: 3 }),
      events: [
        expect.objectContaining({
          type: "phase-changed",
          id: combatEventIdSchema.parse("event:phase-action"),
          sequence: 3,
          phase: "action",
        }),
      ],
    });
    expect(initialState).toEqual(initialSnapshot);
    expect(enumerateLegalDecisions(actionTransition.state, firstCombatantId)).toEqual(
      expect.arrayContaining([
        {
          type: "basic-attack",
          actorId: firstCombatantId,
          basicAttack: "basic-punch",
          targetCombatantId: secondCombatantId,
        },
        { type: "pass", actorId: firstCombatantId },
        { type: "power-up", actorId: firstCombatantId },
      ]),
    );
    expect(enumerateLegalDecisions(actionTransition.state, secondCombatantId)).toEqual([]);

    const powerUpDecisionId = combatDecisionIdSchema.parse("decision:first-power-up");
    const endTransition = requireTransition(
      submitCombatDecision(
        actionTransition.state,
        {
          type: "power-up",
          id: powerUpDecisionId,
          actorId: firstCombatantId,
          expectedStateVersion: 1,
        },
        dependencies,
      ),
    );
    expect(endTransition).toEqual({
      state: expect.objectContaining({ version: 2, phase: "end", eventSequence: 5 }),
      events: [
        expect.objectContaining({
          type: "ki-changed",
          id: combatEventIdSchema.parse("event:ki-gained"),
          sequence: 4,
          causedByDecisionId: powerUpDecisionId,
          amount: 3,
          remainingKi: 8,
        }),
        expect.objectContaining({
          type: "phase-changed",
          id: combatEventIdSchema.parse("event:phase-end"),
          sequence: 5,
          phase: "end",
          causedByDecisionId: powerUpDecisionId,
        }),
      ],
    });

    const nextUpkeepTransition = requireTransition(advanceFight(endTransition.state, dependencies));
    expect(nextUpkeepTransition).toEqual({
      state: expect.objectContaining({
        version: 3,
        turnNumber: 2,
        phase: "upkeep",
        activeCombatantId: secondCombatantId,
        eventSequence: 7,
      }),
      events: [
        expect.objectContaining({ type: "phase-changed", sequence: 6, phase: "upkeep" }),
        expect.objectContaining({
          type: "turn-started",
          sequence: 7,
          combatantId: secondCombatantId,
          turnNumber: 2,
        }),
      ],
    });

    const nextActionTransition = requireTransition(
      advanceFight(nextUpkeepTransition.state, dependencies),
    );
    expect(nextActionTransition.state).toMatchObject({
      version: 4,
      phase: "action",
      activeCombatantId: secondCombatantId,
      eventSequence: 8,
    });
  });

  it("caps a power-up at maximum Ki and records the actual gain", () => {
    const { state: initialState, dependencies } = createInitialState();
    const actionState = requireActiveFightState(
      requireTransition(advanceFight(initialState, dependencies)).state,
    );
    const nearMaximumKiState: ActiveFightState = {
      ...actionState,
      combatants: {
        ...actionState.combatants,
        [firstCombatantId]: {
          ...actionState.combatants[firstCombatantId],
          ki: { current: 9, maximum: 10 },
        },
      },
    };

    const transition = requireTransition(
      submitCombatDecision(
        nearMaximumKiState,
        {
          type: "power-up",
          id: combatDecisionIdSchema.parse("decision:capped-power-up"),
          actorId: firstCombatantId,
          expectedStateVersion: 1,
        },
        dependencies,
      ),
    );

    expect(transition.state.combatants[firstCombatantId]?.ki.current).toBe(10);
    expect(transition.events[0]).toMatchObject({ type: "ki-changed", amount: 1, remainingKi: 10 });
  });

  it("allows the active combatant to pass and moves directly to end phase", () => {
    const { state: initialState, dependencies } = createInitialState();
    const actionState = requireTransition(advanceFight(initialState, dependencies)).state;

    const transition = requireTransition(
      submitCombatDecision(
        actionState,
        {
          type: "pass",
          id: combatDecisionIdSchema.parse("decision:pass"),
          actorId: firstCombatantId,
          expectedStateVersion: 1,
        },
        dependencies,
      ),
    );

    expect(transition).toEqual({
      state: expect.objectContaining({ version: 2, phase: "end", eventSequence: 4 }),
      events: [
        expect.objectContaining({
          type: "phase-changed",
          sequence: 4,
          phase: "end",
          causedByDecisionId: combatDecisionIdSchema.parse("decision:pass"),
        }),
      ],
    });
    expect(transition.state.combatants[firstCombatantId]?.ki.current).toBe(5);
  });

  it("rejects stale, wrong-actor, wrong-phase, and unsupported decisions", () => {
    const { state: initialState, dependencies } = createInitialState();
    const decisionId = combatDecisionIdSchema.parse("decision:rejected");

    expect(
      submitCombatDecision(
        initialState,
        { type: "pass", id: decisionId, actorId: firstCombatantId, expectedStateVersion: 0 },
        dependencies,
      ),
    ).toMatchObject({ ok: false, error: { type: "wrong-phase", actual: "upkeep" } });

    const actionState = requireTransition(advanceFight(initialState, dependencies)).state;
    expect(
      submitCombatDecision(
        actionState,
        { type: "pass", id: decisionId, actorId: firstCombatantId, expectedStateVersion: 0 },
        dependencies,
      ),
    ).toMatchObject({
      ok: false,
      error: { type: "stale-decision", expectedVersion: 0, actualVersion: 1 },
    });
    expect(
      submitCombatDecision(
        actionState,
        { type: "pass", id: decisionId, actorId: secondCombatantId, expectedStateVersion: 1 },
        dependencies,
      ),
    ).toMatchObject({ ok: false, error: { type: "not-active-combatant" } });
    expect(
      submitCombatDecision(
        actionState,
        {
          type: "use-move",
          id: decisionId,
          actorId: firstCombatantId,
          expectedStateVersion: 1,
          moveId: "move-freestyle-hidden-power-level",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    ).toMatchObject({
      ok: false,
      error: {
        type: "unsupported-mechanic",
        mechanic: "move resolution: move-freestyle-hidden-power-level",
      },
    });
    expect(
      submitCombatDecision(
        actionState,
        {
          type: "respond-to-pending-decision",
          id: decisionId,
          actorId: firstCombatantId,
          expectedStateVersion: 1,
          pendingDecisionId: pendingDecisionIdSchema.parse("pending-decision:missing"),
          optionId: "decline",
        },
        dependencies,
      ),
    ).toMatchObject({ ok: false, error: { type: "no-pending-decision" } });
    expect(advanceFight(actionState, dependencies)).toMatchObject({
      ok: false,
      error: { type: "wrong-phase", actual: "action" },
    });
  });

  it("does not advance completed fights or resolve pending decisions before their supported slice", () => {
    const { state: initialState, dependencies } = createInitialState();
    const actionState = requireActiveFightState(
      requireTransition(advanceFight(initialState, dependencies)).state,
    );
    const passDecision = {
      type: "pass" as const,
      id: combatDecisionIdSchema.parse("decision:pending-pass"),
      actorId: firstCombatantId,
      expectedStateVersion: 1,
    };
    const pendingState: ActiveFightState = {
      ...actionState,
      pendingDecision: {
        id: pendingDecisionIdSchema.parse("pending-decision:unimplemented"),
        stateVersion: 1,
        combatantId: firstCombatantId,
        type: "optional-effect",
        options: [{ id: "decline", type: "decline" }],
      },
    };
    const completedState = {
      ...actionState,
      status: "completed",
      completion: { type: "cancelled" },
    } as FightState;

    expect(enumerateLegalDecisions(pendingState, firstCombatantId)).toEqual([]);
    expect(advanceFight(pendingState, dependencies)).toMatchObject({
      ok: false,
      error: { type: "unsupported-mechanic", mechanic: "pending decision resolution" },
    });
    expect(submitCombatDecision(pendingState, passDecision, dependencies)).toMatchObject({
      ok: false,
      error: { type: "unsupported-mechanic", mechanic: "pending decision resolution" },
    });
    expect(advanceFight(completedState, dependencies)).toMatchObject({
      ok: false,
      error: { type: "wrong-phase", actual: "completed" },
    });
    expect(submitCombatDecision(completedState, passDecision, dependencies)).toMatchObject({
      ok: false,
      error: { type: "wrong-phase", actual: "completed" },
    });
  });
});
