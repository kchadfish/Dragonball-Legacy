import { describe, expect, it } from "vitest";

import {
  advanceFight,
  combatDecisionIdSchema,
  combatantIdSchema,
  combatEventIdSchema,
  activeEffectIdSchema,
  createFight,
  fightIdSchema,
  getCombatDecisionPoint,
  resolutionFrameIdSchema,
  scheduledWorkIdSchema,
  submitCombatDecision,
} from "./index.js";
import { createTestCombatDependencies } from "./testing/index.js";

const actorId = combatantIdSchema.parse("combatant:observation-actor");
const opponentId = combatantIdSchema.parse("combatant:observation-opponent");

const dependencies = (retainMechanicObservations = false) => ({
  ...createTestCombatDependencies([], new Date("2026-08-31T12:00:00.000Z"), {
    fightIds: [fightIdSchema.parse("fight:mechanic-observations")],
    combatantIds: [actorId, opponentId],
    decisionIds: [combatDecisionIdSchema.parse("decision:observation-pass")],
    eventIds: Array.from({ length: 20 }, (_, index) =>
      combatEventIdSchema.parse(`event:mechanic-observation-${index}`),
    ),
    scheduledWorkIds: Array.from({ length: 10 }, (_, index) =>
      scheduledWorkIdSchema.parse(`scheduled-work:mechanic-observation-${index}`),
    ),
    activeEffectIds: Array.from({ length: 10 }, (_, index) =>
      activeEffectIdSchema.parse(`active-effect:mechanic-observation-${index}`),
    ),
    resolutionFrameIds: Array.from({ length: 10 }, (_, index) =>
      resolutionFrameIdSchema.parse(`resolution-frame:mechanic-observation-${index}`),
    ),
  }),
  retainMechanicObservations,
});

const basicInput = {
  mode: "spar" as const,
  combatants: [
    {
      maximumHitPoints: 100,
      stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
      moveIds: [],
    },
    {
      maximumHitPoints: 100,
      stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
      moveIds: [],
    },
  ],
};

describe("combat mechanic observations", () => {
  it("retains authoritative opportunity and activation observations without changing state", () => {
    const retainedDependencies = dependencies(true);
    const baselineDependencies = dependencies(false);
    const retainedCreated = createFight(basicInput, retainedDependencies);
    const baselineCreated = createFight(basicInput, baselineDependencies);
    expect(retainedCreated.ok).toBe(true);
    expect(baselineCreated.ok).toBe(true);
    if (!retainedCreated.ok || !baselineCreated.ok) return;

    expect(retainedCreated.value.state).toEqual(baselineCreated.value.state);
    expect(retainedCreated.value.events).toEqual(baselineCreated.value.events);

    const retainedAction = advanceFight(retainedCreated.value.state, retainedDependencies);
    const baselineAction = advanceFight(baselineCreated.value.state, baselineDependencies);
    expect(retainedAction.ok).toBe(true);
    expect(baselineAction.ok).toBe(true);
    if (!retainedAction.ok || !baselineAction.ok) return;

    const pass = {
      type: "pass" as const,
      id: combatDecisionIdSchema.parse("decision:observation-pass"),
      actorId,
      expectedStateVersion: retainedAction.value.state.version,
    };
    const retainedTransition = submitCombatDecision(
      retainedAction.value.state,
      pass,
      retainedDependencies,
    );
    const baselineTransition = submitCombatDecision(
      baselineAction.value.state,
      pass,
      baselineDependencies,
    );
    expect(retainedTransition.ok).toBe(true);
    expect(baselineTransition.ok).toBe(true);
    if (!retainedTransition.ok || !baselineTransition.ok) return;

    expect(retainedTransition.value.state).toEqual(baselineTransition.value.state);
    expect(retainedTransition.value.events).toEqual(baselineTransition.value.events);
    expect(retainedTransition.value.mechanicObservations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "opportunity",
          definitionId: "combat:pass",
        }),
        expect.objectContaining({
          category: "activation",
          definitionId: "combat:pass",
        }),
      ]),
    );
    expect(baselineTransition.value).not.toHaveProperty("mechanicObservations");
  });

  it("does not expose an empty decision-required point for an unused Technique Mastery allowance", () => {
    const created = createFight(
      {
        mode: "spar",
        combatants: [
          {
            maximumHitPoints: 100,
            stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
            moveIds: ["move-aoyosumu-technique-mastery"],
          },
          {
            maximumHitPoints: 100,
            stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
            moveIds: [],
          },
        ],
      },
      dependencies(),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const action = advanceFight(created.value.state, dependencies());
    expect(action.ok).toBe(true);
    if (!action.ok) return;

    const point = getCombatDecisionPoint(action.value.state);
    expect(point.type).toBe("decision-required");
    if (point.type !== "decision-required") return;
    expect(point.legalDecisions.length).toBeGreaterThan(0);
    expect(point.legalDecisions).toEqual(expect.arrayContaining([{ type: "pass", actorId }]));
  });
});
