import { describe, expect, it } from "vitest";

import type {
  CombatEvent,
  CombatTransition,
  FightState,
} from "@dragonball-resurgence/combat-engine";

import { createSimulationV4FightAccumulator, foldSimulationV4Transition } from "./index.js";

const statusId = "status:stun";

const stateFor = (activeStatuses: readonly unknown[] = [], turnNumber = 3): FightState =>
  ({
    status: "active",
    turnNumber,
    combatants: {
      "fighter-a": { id: "fighter-a", activeStatuses },
      "fighter-b": { id: "fighter-b", activeStatuses: [] },
    },
  }) as unknown as FightState;

const metricFor = (
  metrics: Readonly<
    Record<
      string,
      {
        metricId: string;
        dimensions: { statusId?: string };
        denominators: { eligible: number };
        successes: number;
        values: { count: number };
      }
    >
  >,
  metricId: string,
) =>
  Object.values(metrics).find(
    (metric) => metric.metricId === metricId && metric.dimensions.statusId === statusId,
  );

describe("v4 analytics folding", () => {
  it("attributes status applications and retains active exposure without fabricating uptime", () => {
    const accumulator = createSimulationV4FightAccumulator({
      pairId: "pair:test",
      orientation: "original",
      fighterAId: "fighter-a",
      fighterBId: "fighter-b",
      dimensions: { evidenceRole: "natural-balance", exposurePopulation: "natural" },
    });
    const event = {
      type: "status-applied",
      id: "event:status" as never,
      sequence: 1,
      fightId: "fight:test" as never,
      sourceCombatantId: "fighter-a" as never,
      targetCombatantId: "fighter-b" as never,
      statusId: statusId as never,
      stacks: 1,
    } as CombatEvent;
    const folded = foldSimulationV4Transition(accumulator, {
      previousState: stateFor(),
      transition: {
        state: stateFor([{ statusId, stacks: 1 }]),
        events: [event],
      } as CombatTransition,
      selectedDecision: {
        type: "use-move",
        actorId: "fighter-a" as never,
        moveId: "move:status" as never,
        targetCombatantId: "fighter-b" as never,
      },
      selectedEffects: [
        {
          type: "apply-status",
          category: "status",
          timing: "on-success",
          sourceDefinitionId: "move:status",
          sourceEffectIndex: 0,
          statusId,
        },
      ],
    });
    const application = metricFor(folded.metrics, "simulation:status-application-rate");
    const uptime = metricFor(folded.metrics, "simulation:status-uptime");
    expect(application).toMatchObject({
      denominators: { eligible: 1 },
      successes: 1,
    });
    expect(uptime).toMatchObject({ values: { count: 0 } });
  });

  it("retains failed status applications in the attempt denominator", () => {
    const accumulator = createSimulationV4FightAccumulator({
      pairId: "pair:failed-status",
      orientation: "original",
      fighterAId: "fighter-a",
      fighterBId: "fighter-b",
    });
    const folded = foldSimulationV4Transition(accumulator, {
      transition: { state: stateFor(), events: [] } as unknown as CombatTransition,
      selectedDecision: {
        type: "use-move",
        actorId: "fighter-a" as never,
        moveId: "move:status" as never,
        targetCombatantId: "fighter-b" as never,
      },
      selectedEffects: [
        {
          type: "apply-status",
          category: "status",
          timing: "on-success",
          sourceDefinitionId: "move:status",
          sourceEffectIndex: 0,
          statusId,
        },
      ],
    });

    expect(metricFor(folded.metrics, "simulation:status-application-rate")).toMatchObject({
      denominators: { eligible: 1 },
      successes: 0,
    });
  });

  it("counts a setup only when a later move resolves within the turn window", () => {
    const accumulator = createSimulationV4FightAccumulator({
      pairId: "pair:setup",
      orientation: "original",
      fighterAId: "fighter-a",
      fighterBId: "fighter-b",
      dimensions: { evidenceRole: "natural-balance", exposurePopulation: "natural" },
    });
    const setupEvent = {
      type: "status-applied",
      id: "event:setup" as never,
      sequence: 1,
      fightId: "fight:setup" as never,
      sourceCombatantId: "fighter-a" as never,
      targetCombatantId: "fighter-b" as never,
      statusId: statusId as never,
      stacks: 1,
    } as CombatEvent;
    const followUpEvent = {
      type: "attack-resolved",
      id: "event:follow-up" as never,
      sequence: 2,
      fightId: "fight:setup" as never,
      combatantId: "fighter-a" as never,
      targetCombatantId: "fighter-b" as never,
      moveId: "move:follow-up" as never,
      outcome: "successful",
      critical: false,
      counter: false,
    } as CombatEvent;
    const setup = foldSimulationV4Transition(accumulator, {
      transition: {
        state: stateFor([], 1),
        events: [setupEvent],
      } as CombatTransition,
      selectedDecision: {
        type: "use-move",
        actorId: "fighter-a" as never,
        moveId: "move:setup" as never,
        targetCombatantId: "fighter-b" as never,
      },
      tacticalSetup: {
        role: "setup",
        eligibleFollowUpCategories: ["move"],
        eligibleFollowUpIds: ["move:follow-up"],
        targetRelation: "opponent",
        window: { scope: "next-turn" },
        controlImpact: "option-removal",
        available: true,
      },
    });
    const followed = foldSimulationV4Transition(setup, {
      previousState: stateFor([], 1),
      transition: { state: stateFor([], 2), events: [followUpEvent] } as CombatTransition,
      selectedDecision: {
        type: "use-move",
        actorId: "fighter-a" as never,
        moveId: "move:follow-up" as never,
        targetCombatantId: "fighter-b" as never,
      },
    });
    const conversion = Object.values(followed.metrics).find(
      (metric) => metric.metricId === "simulation:windowed-setup-conversion",
    );
    const followUp = Object.values(followed.metrics).find(
      (metric) => metric.metricId === "simulation:compatible-follow-up-rate",
    );
    expect(conversion).toMatchObject({ denominators: { eligible: 1 }, successes: 1 });
    expect(followUp).toMatchObject({ denominators: { eligible: 1 }, successes: 1 });
  });
});
