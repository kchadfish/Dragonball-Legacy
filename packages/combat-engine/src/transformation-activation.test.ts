import { describe, expect, it } from "vitest";

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

const ghostId = combatantIdSchema.parse("combatant:ghost");
const opponentId = combatantIdSchema.parse("combatant:opponent");

describe("transformation activation", () => {
  it("activates an owned converted transformation as an action with evented stat changes", () => {
    const dependencies = createTestCombatDependencies([], new Date("2026-08-04T12:00:00.000Z"), {
      fightIds: [fightIdSchema.parse("fight:transformation")],
      combatantIds: [ghostId, opponentId],
      eventIds: Array.from({ length: 8 }, (_, index) =>
        combatEventIdSchema.parse(`event:transformation-${index + 1}`),
      ),
    });
    const created = createFight(
      {
        mode: "spar",
        combatants: [
          {
            maximumHitPoints: 100,
            stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
            moveIds: [],
            transformationIds: ["transformation-ghost-2-ghoul"],
          },
          {
            maximumHitPoints: 100,
            stats: { power: 10, dexterity: 1, dexterityBonus: 0 },
            moveIds: [],
          },
        ],
      },
      dependencies,
    );
    if (!created.ok) throw new Error("Expected fight creation to succeed.");
    const action = advanceFight(created.value.state, dependencies);
    if (!action.ok || action.value.state.status !== "active")
      throw new Error("Expected action state.");

    expect(enumerateLegalDecisions(action.value.state, ghostId)).toContainEqual({
      type: "activate-transformation",
      actorId: ghostId,
      transformationId: "transformation-ghost-2-ghoul",
    });
    const activated = submitCombatDecision(
      action.value.state,
      {
        type: "activate-transformation",
        id: combatDecisionIdSchema.parse("decision:activate-ghoul"),
        actorId: ghostId,
        expectedStateVersion: 1,
        transformationId: "transformation-ghost-2-ghoul",
      },
      dependencies,
    );
    if (!activated.ok || activated.value.state.status !== "active") {
      throw new Error("Expected transformation activation to succeed.");
    }

    expect(activated.value.state).toMatchObject({ version: 2, phase: "end" });
    expect(activated.value.state.combatants[ghostId]).toMatchObject({
      hitPoints: { current: 140, maximum: 140 },
      stats: { power: 24, dexterity: 14 },
      transformation: { transformationId: "transformation-ghost-2-ghoul", activatedOnTurn: 1 },
    });
    expect(activated.value.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "transformation-activated", combatantId: ghostId }),
      ]),
    );
  });
});
