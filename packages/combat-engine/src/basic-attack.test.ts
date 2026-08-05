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
} from "./ids.js";
import { createTestCombatDependencies } from "./testing/index.js";

const attackerId = combatantIdSchema.parse("combatant:attacker");
const defenderId = combatantIdSchema.parse("combatant:defender");

const input: CreateFightInput = {
  mode: "spar",
  activeCombatantIndex: 0,
  combatants: [
    {
      maximumHitPoints: 100,
      stats: { power: 25, dexterity: 4, dexterityBonus: 1 },
      moveIds: ["move-freestyle-hidden-power-level"],
    },
    {
      maximumHitPoints: 100,
      stats: { power: 20, dexterity: 3, dexterityBonus: -1 },
      moveIds: ["move-afterlife-give-me-energy"],
    },
  ],
};

const createDependencies = (randomValues: readonly number[]) =>
  createTestCombatDependencies(randomValues, new Date("2026-08-04T12:00:00.000Z"), {
    fightIds: [fightIdSchema.parse("fight:basic-attack")],
    combatantIds: [attackerId, defenderId],
    eventIds: Array.from({ length: 12 }, (_, index) =>
      combatEventIdSchema.parse(`event:basic-${index + 1}`),
    ),
  });

const requireTransition = <T>(result: { readonly ok: boolean; readonly value?: T }): T => {
  if (!result.ok || result.value === undefined)
    throw new Error("Expected a successful combat transition.");
  return result.value;
};

const requireActiveState = (state: FightState): ActiveFightState => {
  if (state.status !== "active") throw new Error("Expected an active fight state.");
  return state;
};

const createActionState = (randomValues: readonly number[]) => {
  const dependencies = createDependencies(randomValues);
  const fight = requireTransition(createFight(input, dependencies));
  return {
    dependencies,
    state: requireActiveState(requireTransition(advanceFight(fight.state, dependencies)).state),
  };
};

describe("basic attacks", () => {
  it("enumerates the three zero-Ki basic attacks for the active combatant", () => {
    const { state } = createActionState([]);

    expect(enumerateLegalDecisions(state, attackerId)).toEqual([
      {
        type: "basic-attack",
        actorId: attackerId,
        basicAttack: "basic-punch",
        targetCombatantId: defenderId,
      },
      {
        type: "basic-attack",
        actorId: attackerId,
        basicAttack: "basic-kick",
        targetCombatantId: defenderId,
      },
      {
        type: "basic-attack",
        actorId: attackerId,
        basicAttack: "basic-ki-blast",
        targetCombatantId: defenderId,
      },
      { type: "pass", actorId: attackerId },
      { type: "power-up", actorId: attackerId },
    ]);
  });

  it("uses injected rolls and Dexterity Bonus, with a tie resolving as a successful attack", () => {
    const { state, dependencies } = createActionState([10, 12]);
    const decisionId = combatDecisionIdSchema.parse("decision:basic-punch");
    const transition = requireTransition(
      submitCombatDecision(
        state,
        {
          type: "basic-attack",
          id: decisionId,
          actorId: attackerId,
          expectedStateVersion: 1,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );

    expect(transition).toEqual({
      state: expect.objectContaining({ version: 2, phase: "end", eventSequence: 8 }),
      events: [
        expect.objectContaining({
          type: "attack-rolled",
          sequence: 4,
          naturalResult: 10,
          result: 11,
          basicAttack: "basic-punch",
          causedByDecisionId: decisionId,
        }),
        expect.objectContaining({
          type: "defense-rolled",
          sequence: 5,
          naturalResult: 12,
          result: 11,
          causedByDecisionId: decisionId,
        }),
        expect.objectContaining({ type: "attack-resolved", sequence: 6, outcome: "successful" }),
        expect.objectContaining({
          type: "damage-applied",
          sequence: 7,
          amount: 3,
          remainingHitPoints: 97,
        }),
        expect.objectContaining({ type: "phase-changed", sequence: 8, phase: "end" }),
      ],
    });
  });

  it("records a stopped attack without applying damage", () => {
    const { state, dependencies } = createActionState([5, 10]);
    const transition = requireTransition(
      submitCombatDecision(
        state,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:stopped-kick"),
          actorId: attackerId,
          expectedStateVersion: 1,
          basicAttack: "basic-kick",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );

    expect(transition.state).toMatchObject({ version: 2, phase: "end", eventSequence: 7 });
    expect(transition.state.combatants[defenderId]?.hitPoints.current).toBe(100);
    expect(transition.events).toEqual([
      expect.objectContaining({ type: "attack-rolled" }),
      expect.objectContaining({ type: "defense-rolled" }),
      expect.objectContaining({ type: "attack-resolved", outcome: "stopped" }),
      expect.objectContaining({ type: "phase-changed", phase: "end" }),
    ]);
  });

  it("ends the fight when successful damage reduces the opponent to zero HP", () => {
    const { state, dependencies } = createActionState([20, 1]);
    const nearDefeatState: ActiveFightState = {
      ...state,
      combatants: {
        ...state.combatants,
        [defenderId]: {
          ...state.combatants[defenderId],
          hitPoints: { current: 2, maximum: 100 },
        },
      },
    };

    const transition = requireTransition(
      submitCombatDecision(
        nearDefeatState,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:finishing-blast"),
          actorId: attackerId,
          expectedStateVersion: 1,
          basicAttack: "basic-ki-blast",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );

    expect(transition.state).toEqual(
      expect.objectContaining({
        status: "completed",
        version: 2,
        eventSequence: 9,
        completion: { type: "defeat", winnerCombatantId: attackerId },
      }),
    );
    expect(transition.state.combatants[defenderId]).toMatchObject({
      status: "defeated",
      hitPoints: { current: 0, maximum: 100 },
    });
    expect(transition.events.map((event) => event.type)).toEqual([
      "attack-rolled",
      "defense-rolled",
      "attack-resolved",
      "damage-applied",
      "combatant-defeated",
      "fight-ended",
    ]);
  });

  it("rejects a self-targeted basic attack before rolling", () => {
    const { state, dependencies } = createActionState([]);

    expect(
      submitCombatDecision(
        state,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:self-target"),
          actorId: attackerId,
          expectedStateVersion: 1,
          basicAttack: "basic-punch",
          targetCombatantId: attackerId,
        },
        dependencies,
      ),
    ).toEqual({ ok: false, error: { type: "invalid-target", targetCombatantId: attackerId } });
  });
});
