import { describe, expect, it } from "vitest";

import {
  advanceFight,
  canonicalDecisionKey,
  createFight,
  describeAnalysisDecision,
  enumerateLegalDecisions,
  SeededRandomSource,
  submitCombatDecision,
  type CombatDependencies,
  type CombatantId,
  type FightId,
  type FightState,
  type LegalDecision,
} from "@dragonball-resurgence/combat-engine";

import {
  NORMAL_PROFILE,
  SIMULATION_QUALITY_PROFILE,
  advisoryFactorsFor,
  createAiRandomSource,
  createAiReplayRecord,
  selectAiDecision,
  validateAiAdvisoryPriorities,
  verifyAiReplayRecord,
  type AiDecisionRequest,
  type AiMechanicsView,
} from "./index.js";

const actorId = "combatant:quality-actor" as CombatantId;
const opponentId = "combatant:quality-opponent" as CombatantId;

const state: FightState = {
  id: "fight:quality" as FightId,
  schemaVersion: 4,
  version: 2,
  rulesVersion: { value: "rules-v1", sourcePath: "test" },
  mode: "spar",
  turnNumber: 2,
  combatants: {
    [actorId]: {
      id: actorId,
      hitPoints: { current: 40, maximum: 100 },
      ki: { current: 5, maximum: 10 },
      stats: { power: 50, dexterity: 10, dexterityBonus: 0 },
      moveIds: [],
      moveUses: {},
      activeStatuses: [],
      status: "active",
    },
    [opponentId]: {
      id: opponentId,
      hitPoints: { current: 100, maximum: 100 },
      ki: { current: 5, maximum: 10 },
      stats: { power: 50, dexterity: 10, dexterityBonus: 0 },
      moveIds: [],
      moveUses: {},
      activeStatuses: [],
      status: "active",
    },
  },
  activeEffects: [],
  actionHistory: [],
  resolutionFrames: [],
  scheduledWork: [],
  eventSequence: 0,
  status: "active",
  phase: "action",
  activeCombatantId: actorId,
};

const mechanics: AiMechanicsView = { version: "test", moves: [], items: [], transformations: [] };

const request = (
  legalDecisions: readonly LegalDecision[],
  retention: AiDecisionRequest["diagnosticRetention"] = "full",
  priorities: AiDecisionRequest["advisoryPriorities"] = undefined,
): AiDecisionRequest => ({
  state,
  actorId,
  legalDecisions,
  profile: SIMULATION_QUALITY_PROFILE,
  mechanics,
  dependencies: {
    random: createAiRandomSource({
      rootSeed: 123,
      profileVersion: SIMULATION_QUALITY_PROFILE.identity.version,
      evaluatorVersion: "quality-test:v1",
      purpose: "quality",
    }),
    randomness: "disabled",
  },
  analysis: { describeDecision: describeAnalysisDecision },
  diagnosticRetention: retention,
  advisoryPriorities: priorities,
});

const legal: readonly LegalDecision[] = [
  { type: "pass", actorId },
  { type: "basic-attack", actorId, basicAttack: "basic-punch", targetCombatantId: opponentId },
  { type: "surrender", actorId },
];

describe("AI decision-quality closure", () => {
  it("selects only a supplied legal object and fails explicitly for an empty set", () => {
    const result = selectAiDecision(request(legal));
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value.decision).toBe(
        legal.find((candidate) => candidate === result.value.decision),
      );
    const empty = selectAiDecision(request([]));
    expect(empty).toEqual({ ok: false, error: { type: "empty-legal-set", actorId } });
  });

  it("keeps deterministic selection independent of input order and diagnostic retention", () => {
    const first = selectAiDecision(request(legal, "none"));
    const reversed = selectAiDecision(request([...legal].reverse(), "full"));
    expect(first.ok && reversed.ok).toBe(true);
    if (first.ok && reversed.ok) {
      expect(canonicalDecisionKey(first.value.decision)).toBe(
        canonicalDecisionKey(reversed.value.decision),
      );
      expect(first.value.evaluations).toEqual([]);
    }
  });

  it("clamps combined advisory priorities and records named tactical factors", () => {
    const priorities = {
      version: "ai-advisory-priorities:v1" as const,
      modifiers: [
        {
          id: "first",
          version: "ai-advisory-modifier:v1" as const,
          target: { type: "decision-category" as const, category: "basic-attack" },
          adjustment: 25_000,
        },
        {
          id: "second",
          version: "ai-advisory-modifier:v1" as const,
          target: { type: "decision-category" as const, category: "basic-attack" },
          adjustment: 25_000,
        },
      ],
    };
    expect(validateAiAdvisoryPriorities(priorities).ok).toBe(true);
    const descriptor = describeAnalysisDecision(state, legal[1]!);
    const feature = {
      decision: legal[1]!,
      canonicalKey: descriptor.key,
      decisionType: legal[1]!.type,
      category: descriptor.identity.category,
      actionConsumption: descriptor.actionConsumption,
      costs: descriptor.costs,
      effects: descriptor.effects,
      scarcity: descriptor.scarcity,
      targets: descriptor.targets,
      terminal: descriptor.terminal,
      immediateOutcome: descriptor.immediateOutcome,
      authoritative: {
        costs: descriptor.costs,
        effects: descriptor.effects,
        scarcity: descriptor.scarcity,
        targets: descriptor.targets,
        terminal: descriptor.terminal,
        immediateOutcome: descriptor.immediateOutcome,
      },
      state: {
        status: "active" as const,
        stateVersion: state.version,
        turnNumber: state.turnNumber,
        phase: state.phase,
        activeCombatantId: state.activeCombatantId,
      },
    } as never;
    const factors = advisoryFactorsFor(feature, priorities);
    expect(factors.map((factor) => factor.value).reduce((sum, value) => sum + value, 0)).toBe(
      25_000,
    );
    expect(factors.map((factor) => factor.code)).toEqual([
      "tactical-priority:first",
      "tactical-priority:second",
    ]);
  });

  it("records and verifies replay v2 through the canonical selector", () => {
    const result = selectAiDecision(request(legal));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const replay = createAiReplayRecord(request(legal), result.value);
    expect(replay.schemaVersion).toBe("ai-replay:v2");
    expect(replay.pipeline.version).toBe("ai-engine:v2");
    expect(verifyAiReplayRecord(replay, request(legal))).toEqual({
      ok: true,
      decisionKey: replay.selectedDecisionKey,
    });
  });

  it("drives representative AI consumers through public combat transitions to an external safeguard", () => {
    const ids = (() => {
      let counter = 0;
      const next = (prefix: string) => `${prefix}:quality-${counter++}` as never;
      return {
        nextFightId: () => next("fight"),
        nextCombatantId: () => next("combatant"),
        nextDecisionId: () => next("decision"),
        nextEventId: () => next("event"),
        nextPendingDecisionId: () => next("pending-decision"),
        nextActiveEffectId: () => next("active-effect"),
        nextResolutionFrameId: () => next("resolution-frame"),
        nextScheduledWorkId: () => next("scheduled-work"),
        next,
      };
    })();
    const dependencies: CombatDependencies = {
      random: new SeededRandomSource(9),
      clock: { now: () => new Date("2026-08-30T00:00:00.000Z") },
      ids,
    };
    const created = createFight(
      {
        mode: "spar",
        combatants: [
          {
            maximumHitPoints: 100,
            stats: { power: 25, dexterity: 20, dexterityBonus: 0 },
            moveIds: [],
          },
          {
            maximumHitPoints: 100,
            stats: { power: 25, dexterity: 10, dexterityBonus: 0 },
            moveIds: [],
          },
        ],
      },
      dependencies,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    let current = created.value.state;
    let steps = 0;
    while (current.status === "active" && steps < 8) {
      if (current.status !== "active") break;
      if (current.phase === "upkeep" || current.phase === "end") {
        const advanced = advanceFight(current, dependencies);
        expect(advanced.ok).toBe(true);
        if (!advanced.ok) break;
        current = advanced.value.state;
        steps += 1;
        continue;
      }
      const decisions = enumerateLegalDecisions(current, current.activeCombatantId);
      const selected = selectAiDecision({
        state: current,
        actorId: current.activeCombatantId,
        legalDecisions: decisions,
        profile: NORMAL_PROFILE,
        mechanics,
        dependencies: {
          random: createAiRandomSource({
            rootSeed: 4,
            profileVersion: NORMAL_PROFILE.identity.version,
            evaluatorVersion: "autonomous:v1",
            purpose: "fight",
          }),
          randomness: "disabled",
        },
        analysis: { describeDecision: describeAnalysisDecision },
      });
      expect(selected.ok).toBe(true);
      if (!selected.ok) break;
      const submitted = submitCombatDecision(
        current,
        {
          ...selected.value.decision,
          id: ids.next("decision"),
          expectedStateVersion: current.version,
        } as never,
        dependencies,
      );
      expect(submitted.ok).toBe(true);
      if (!submitted.ok) break;
      current = submitted.value.state;
      steps += 1;
    }
    expect(current.status === "completed" || steps === 8).toBe(true);
  });
});
