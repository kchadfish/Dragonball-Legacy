import { describe, expect, it } from "vitest";

import { RULES_VERSION } from "@dragonball-resurgence/game-config";

import type { ActiveFightState, FightState } from "./contracts.js";
import {
  canonicalDecisionKey,
  consumeAnalysisWork,
  createAiRandomSource,
  createAnalysisWorkBudget,
  createBranchCombatDependencies,
  describeLegalDecision,
  describeLegalDecisions,
  enumerateAnalysisDecisions,
  enumerateLegalDecisions,
  probeCombatDecision,
} from "./index.js";
import {
  combatantIdSchema,
  fightIdSchema,
  combatDecisionIdSchema,
  combatEventIdSchema,
  pendingDecisionIdSchema,
} from "./ids.js";
import { createTestCombatDependencies } from "./testing/index.js";

const actorId = combatantIdSchema.parse("combatant:analysis-actor");
const opponentId = combatantIdSchema.parse("combatant:analysis-opponent");

const state = (moveIds: readonly string[] = []): FightState =>
  ({
    id: fightIdSchema.parse("fight:analysis-boundary"),
    version: 0,
    rulesVersion: RULES_VERSION,
    mode: "spar",
    turnNumber: 1,
    combatants: {
      [actorId]: {
        id: actorId,
        hitPoints: { current: 100, maximum: 100 },
        ki: { current: 10, maximum: 10 },
        stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
        moveIds,
        moveUses: {},
        activeStatuses: [],
        status: "active",
      },
      [opponentId]: {
        id: opponentId,
        hitPoints: { current: 100, maximum: 100 },
        ki: { current: 10, maximum: 10 },
        stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
        moveIds: [],
        moveUses: {},
        activeStatuses: [],
        status: "active",
      },
    },
    activeEffects: [],
    actionHistory: [],
    resolutionFrames: [],
    eventSequence: 0,
    status: "active",
    phase: "action",
    activeCombatantId: actorId,
  }) as ActiveFightState;

describe("combat analysis boundary", () => {
  it("keeps batch descriptors identical to individual descriptors and state-pure", () => {
    const fight = state(["move-akaikaru-firestorm"]);
    const before = JSON.stringify(fight);
    const legal = enumerateLegalDecisions(fight, actorId);
    const batch = describeLegalDecisions(fight, actorId);
    expect(batch).toEqual(legal.map((decision) => describeLegalDecision(fight, decision)));
    expect(JSON.stringify(fight)).toBe(before);
  });

  it("keeps pending-response descriptor batches isolated from ordinary states", () => {
    const pendingFight = {
      ...state(["move-akaikaru-firestorm"]),
      pendingDecision: {
        id: pendingDecisionIdSchema.parse("pending-decision:analysis"),
        stateVersion: 0,
        combatantId: actorId,
        type: "select-move" as const,
        options: [
          { id: "decline", type: "decline" as const },
          { id: "firestorm", type: "select-move" as const, moveId: "move-akaikaru-firestorm" },
        ],
        optional: true,
      },
    } as ActiveFightState;
    const ordinary = describeLegalDecisions(state(["move-akaikaru-firestorm"]), actorId);
    const pending = describeLegalDecisions(pendingFight, actorId);
    expect(pending).toEqual(
      enumerateLegalDecisions(pendingFight, actorId).map((decision) =>
        describeLegalDecision(pendingFight, decision),
      ),
    );
    expect(pending).not.toEqual(ordinary);
  });

  it("describes supplied legal decisions from compiled combat facts", () => {
    const legal = enumerateAnalysisDecisions(state(["move-akaikaru-firestorm"]), actorId);
    const move = legal.find((decision) => decision.type === "use-move");
    if (move === undefined) throw new Error("Expected a legal converted move.");
    const descriptor = describeLegalDecision(state(["move-akaikaru-firestorm"]), move);

    expect(descriptor.identity).toEqual({ type: "use-move", category: "move" });
    expect(descriptor.actionConsumption).toBe("action");
    expect(descriptor.costs[0]?.resource).toBe("ki");
    expect(descriptor.effects.length).toBeGreaterThan(0);
    const firstEffect = descriptor.effects[0]!;
    expect(descriptor.definitionProvenance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "move", definitionId: "move-akaikaru-firestorm" }),
        expect.objectContaining({
          kind: "effect",
          definitionId: "move-akaikaru-firestorm",
          effectIndex: firstEffect.sourceEffectIndex,
        }),
      ]),
    );
    expect(descriptor.immediateOutcome.version).toBe("immediate-outcome:v1");
    expect(descriptor.immediateOutcome.damage[0]?.possibleLethality).toBe(false);
    expect(descriptor.immediateOutcome.damage[0]?.amount?.maximum).toBeGreaterThan(0);
    expect(descriptor.outcomeProbe).toEqual({
      type: "combat-transition",
      decisionKey: canonicalDecisionKey(move),
    });
  });

  it("describes capped power-up gains and overflow without consuming randomness", () => {
    const fight = state();
    const before = JSON.stringify(fight);
    const powerUp = { type: "power-up" as const, actorId };
    const descriptor = describeLegalDecision(fight, powerUp);
    const gain = descriptor.immediateOutcome.resources.find(
      (resource) => resource.resource === "ki" && resource.operation === "gain",
    );

    expect(gain?.declared).toBeGreaterThan(0);
    expect(gain?.effective).toBeLessThanOrEqual(gain?.declared ?? 0);
    expect(gain?.overflow?.maximum).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(fight)).toBe(before);
  });

  it("includes a deterministic strategic context without changing the fight", () => {
    const fight = state(["move-akaikaru-firestorm"]);
    const before = JSON.stringify(fight);
    const pass = { type: "pass" as const, actorId };
    const first = describeLegalDecision(fight, pass);
    const second = describeLegalDecision(fight, pass);

    expect(first.strategicContext).toEqual(second.strategicContext);
    expect(first.strategicContext).toMatchObject({
      version: "strategic-context:v1",
      completeness: "complete",
      actor: { hp: { ratio: 1 }, ki: { ratio: 1 }, activeTransformation: false },
      opponent: { hp: { ratio: 1 }, ki: { ratio: 1 } },
      turn: { number: 1, phase: "action", actorHasInitiative: true },
      pendingWork: { active: false, optionCount: 0 },
      horizon: { short: 1, basis: "bounded-local-1v1-estimate" },
    });
    expect(JSON.stringify(fight)).toBe(before);
  });

  it("probes a legal decision through the normal immutable transition boundary", () => {
    const fight = state();
    const pass = enumerateLegalDecisions(fight, actorId).find(
      (decision) => decision.type === "pass",
    );
    if (pass === undefined) throw new Error("Expected a legal pass.");
    const dependencies = createTestCombatDependencies([], new Date("2026-08-30T12:00:00.000Z"), {
      decisionIds: [combatDecisionIdSchema.parse("decision:analysis-pass")],
      eventIds: [combatEventIdSchema.parse("event:analysis-pass")],
    });
    const result = probeCombatDecision(fight, pass, dependencies);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.successorState).not.toBe(fight);
    expect(fight.version).toBe(0);
    expect(result.value.decision.expectedStateVersion).toBe(fight.version);
    expect(result.value.events).toHaveLength(1);
  });

  it("keeps keyed AI randomness and branch dependencies independent of input order", () => {
    const random = createAiRandomSource({
      rootSeed: 42,
      profileVersion: "profile:v1",
      evaluatorVersion: "evaluator:v1",
      purpose: "score-noise",
    });
    expect(random.integer("decision-a", 0, 1_000)).toBe(random.integer("decision-a", 0, 1_000));
    expect(random.integer("decision-a", 0, 1_000)).toBe(
      createAiRandomSource({
        rootSeed: 42,
        profileVersion: "profile:v1",
        evaluatorVersion: "evaluator:v1",
        purpose: "score-noise",
      }).integer("decision-a", 0, 1_000),
    );

    const input = {
      rootSeed: 42,
      branchPath: ["root", "decision-a"],
      fixedTime: new Date("2026-08-30T12:00:00.000Z"),
      workBudget: { maxNodes: 4, maxProbes: 2 },
    } as const;
    const first = createBranchCombatDependencies(input);
    const second = createBranchCombatDependencies(input);
    expect(first.branchSeed).toBe(second.branchSeed);
    expect(first.random.integer(1, 100)).toBe(second.random.integer(1, 100));
    expect(first.ids.nextEventId()).toBe(second.ids.nextEventId());
    expect(first.clock.now()).toEqual(second.clock.now());
  });

  it("provides deterministic caller-enforced node and probe budgets", () => {
    const budget = createAnalysisWorkBudget({ maxNodes: 1, maxProbes: 1 });
    const node = consumeAnalysisWork(budget, "node");
    expect(node.ok).toBe(true);
    if (!node.ok) return;
    expect(consumeAnalysisWork(node.value, "node")).toMatchObject({
      ok: false,
      error: { type: "analysis-budget-exhausted", kind: "node", limit: 1 },
    });
  });
});
