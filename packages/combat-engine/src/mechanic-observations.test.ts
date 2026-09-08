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
  getCombatActionAvailabilityReport,
  collectCombatMechanicObservations,
  collectCombatCalculationObservations,
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
  it("emits typed calculation observations with stable action and provenance identities", () => {
    const created = createFight(basicInput, dependencies());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const eventBase = {
      id: combatEventIdSchema.parse("event:calculation-observation"),
      sequence: 1,
      fightId: created.value.state.id,
      causedByDecisionId: combatDecisionIdSchema.parse("decision:calculation-observation"),
    };
    const observations = collectCombatCalculationObservations({
      previousState: created.value.state,
      transition: {
        state: created.value.state,
        events: [
          {
            ...eventBase,
            type: "attack-resolved",
            combatantId: actorId,
            targetCombatantId: opponentId,
            outcome: "successful",
            critical: false,
            counter: false,
          },
          {
            ...eventBase,
            sequence: 2,
            type: "damage-applied",
            sourceCombatantId: actorId,
            targetCombatantId: opponentId,
            amount: 20,
            remainingHitPoints: 80,
          },
        ] as never,
      },
    });
    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "action",
          actionInstanceId: "decision:calculation-observation",
          actorId,
        }),
        expect.objectContaining({ kind: "damage", applied: 20, attempted: 20 }),
      ]),
    );
  });

  it("separates applied damage from overkill using the authoritative pre-transition HP", () => {
    const created = createFight(basicInput, dependencies());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const observations = collectCombatCalculationObservations({
      previousState: created.value.state,
      transition: {
        state: created.value.state,
        events: [
          {
            id: combatEventIdSchema.parse("event:calculation-overkill"),
            sequence: 1,
            fightId: created.value.state.id,
            type: "damage-applied",
            sourceCombatantId: actorId,
            targetCombatantId: opponentId,
            amount: 120,
            remainingHitPoints: 0,
          },
        ] as never,
      },
    });
    expect(observations).toEqual([
      expect.objectContaining({ kind: "damage", attempted: 120, applied: 100, overkill: 20 }),
    ]);
  });

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

  it("reports legal decisions from the combat-owned availability boundary", () => {
    const created = createFight(basicInput, dependencies());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const action = advanceFight(created.value.state, dependencies());
    expect(action.ok).toBe(true);
    if (!action.ok || action.value.state.status !== "active") return;

    const report = getCombatActionAvailabilityReport(action.value.state, actorId);
    expect(report).toMatchObject({
      schemaVersion: "combat-action-availability:v1",
      actorId,
      stateVersion: action.value.state.version,
    });
    expect(report.legal.length).toBeGreaterThan(0);
    expect(report.legal.every((entry) => entry.classification === "legal")).toBe(true);
    expect(report.entries.length).toBe(
      report.legal.length +
        report.timingEligibleButUnaffordable.length +
        report.restricted.length +
        report.otherwiseUnavailable.length,
    );
  });

  it("attributes value events without requiring presentation-only move fields", () => {
    const created = createFight(basicInput, dependencies());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const eventBase = {
      id: combatEventIdSchema.parse("event:observation-value"),
      sequence: 1,
      fightId: created.value.state.id,
    };
    const observations = collectCombatMechanicObservations({
      previousState: created.value.state,
      transition: {
        state: created.value.state,
        events: [
          {
            ...eventBase,
            type: "damage-applied",
            sourceCombatantId: actorId,
            targetCombatantId: opponentId,
            amount: 20,
            remainingHitPoints: 80,
          },
          {
            ...eventBase,
            type: "ki-changed",
            combatantId: actorId,
            amount: 5,
            remainingKi: 10,
          },
        ] as never,
      },
    });
    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "value",
          definitionId: "combat:damage-applied",
          combatantId: actorId,
          targetCombatantId: opponentId,
          value: 20,
        }),
        expect.objectContaining({
          category: "value",
          definitionId: "combat:ki-changed",
          combatantId: actorId,
          value: 5,
        }),
      ]),
    );
  });
});
