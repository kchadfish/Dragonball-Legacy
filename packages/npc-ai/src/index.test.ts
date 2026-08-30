import { describe, expect, it } from "vitest";

import {
  canonicalDecisionKey,
  type CombatantId,
  type CombatDecisionDescriptor,
  type FightId,
  type FightState,
  type LegalDecision,
} from "@dragonball-resurgence/combat-engine";
import { createAiRandomSource } from "@dragonball-resurgence/ai-engine";

import {
  NPC_AI_POLICY_VERSION,
  compileNpcTacticalPriorities,
  multiPhaseBossPolicy,
  normalNpcPolicy,
  resolveNpcAiPhase,
  selectNpcDecision,
  validateNpcAiPolicy,
  type NpcDecisionRequest,
} from "./index.js";

const actorId = "combatant:npc-actor" as CombatantId;
const opponentId = "combatant:npc-opponent" as CombatantId;

const state: FightState = {
  id: "fight:npc" as FightId,
  schemaVersion: 4,
  version: 0,
  rulesVersion: { value: "rules-v1", sourcePath: "test" },
  mode: "spar",
  turnNumber: 1,
  combatants: {
    [actorId]: {
      id: actorId,
      hitPoints: { current: 100, maximum: 100 },
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

const descriptorFor = (decision: LegalDecision): CombatDecisionDescriptor => ({
  key: canonicalDecisionKey(decision),
  identity: {
    type: decision.type,
    category:
      decision.type === "use-move"
        ? "move"
        : decision.type === "activate-transformation" ||
            decision.type === "deactivate-transformation"
          ? "transformation"
          : decision.type === "use-item"
            ? "item"
            : decision.type === "respond-to-pending-decision"
              ? "pending-response"
              : decision.type,
  },
  actionConsumption: "action" as const,
  costs: [],
  effects: [],
  scarcity: [],
  targets: [],
  terminal: "none" as const,
  immediateOutcome: {
    version: "immediate-outcome:v1" as const,
    completeness: "complete" as const,
    resources: [],
    damage: [],
    healing: [],
    defeatPrevention: { guaranteed: false, possible: false, certainty: "unknown" as const },
    actions: {
      free: false,
      extraOwnActions: 0,
      skippedOwnActions: 0,
      skippedOpponentActions: 0,
      response: false,
      delayed: false,
      certainty: "guaranteed" as const,
    },
    unknownFacts: [],
  },
  outcomeProbe: { type: "combat-transition", decisionKey: canonicalDecisionKey(decision) },
});

const request = (policy = normalNpcPolicy): NpcDecisionRequest => ({
  state,
  actorId,
  policy,
  mechanics: { version: "test", moves: [], items: [], transformations: [] },
  dependencies: {
    random: createAiRandomSource({
      rootSeed: 7,
      profileVersion: policy.defaultProfile.identity.version,
      evaluatorVersion: "npc-test:v1",
      purpose: "npc",
    }),
    randomness: "disabled",
  },
  analysis: { describeDecision: (_state, decision) => descriptorFor(decision) },
});

describe("npc-ai public adapter", () => {
  it("validates stable policies and resolves the highest-priority matching phase", () => {
    expect(validateNpcAiPolicy(multiPhaseBossPolicy).ok).toBe(true);
    expect(resolveNpcAiPhase(multiPhaseBossPolicy, state).phaseId).toBe("opening");
    expect(validateNpcAiPolicy({ ...normalNpcPolicy, id: "Bad ID" }).ok).toBe(false);
  });

  it("compiles typed priorities into bounded generic advisory modifiers", () => {
    const compiled = compileNpcTacticalPriorities([
      { type: "status-pressure", id: "status-pressure", weight: 0.5 },
    ]);
    expect(compiled.version).toBe("ai-advisory-priorities:v1");
    expect(compiled.modifiers[0]?.id).toBe("status-pressure");
  });

  it("returns one exact engine-enumerated legal object without submitting it", () => {
    const result = selectNpcDecision(request());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.legalDecisions).toContainEqual(result.value.decision);
    expect(result.value.policyId).toBe("normal-npc");
    expect(result.value.advisoryPriorities.version).toBe("ai-advisory-priorities:v1");
    expect(NPC_AI_POLICY_VERSION).toBe("npc-ai-policy:v1");
  });
});
