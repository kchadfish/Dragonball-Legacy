import { describe, expect, it } from "vitest";

import {
  createAiRandomSource,
  normalProfile,
  type AiMechanicsView,
} from "@dragonball-resurgence/ai-engine";
import { RULES_VERSION } from "@dragonball-resurgence/game-config";
import {
  describeLegalDecision,
  activeEffectIdSchema,
  type ActiveFightState,
  type CombatantId,
  type FightState,
  type LegalDecision,
  type CombatantState,
  combatantIdSchema,
  fightIdSchema,
  pendingDecisionIdSchema,
} from "@dragonball-resurgence/combat-engine";

import {
  ARTIFACT_SCHEMA_VERSIONS,
  SIMULATION_SCOPE_V1,
  canonicalHash,
  canonicalJson,
  createSimulationSemanticProgressIdentity,
  getSimulationDecisionPoint,
  hasSameSimulationSemanticProgress,
  readVersionedArtifact,
  createSimulationSeedManifest,
  deriveSimulationSeed,
  SIMULATION_DEFAULT_LIMITS,
  selectSimulationDecision,
} from "./index.js";

const actorId = combatantIdSchema.parse("combatant:simulation-actor");
const opponentId = combatantIdSchema.parse("combatant:simulation-opponent");

const combatant = (id: CombatantId): CombatantState => ({
  id,
  hitPoints: { current: 100, maximum: 100 },
  ki: { current: 5, maximum: 10 },
  stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
  moveIds: [],
  moveUses: {},
  activeStatuses: [],
  status: "active",
});

const activeState = (): ActiveFightState => ({
  id: fightIdSchema.parse("fight:simulation-phase-0"),
  schemaVersion: 4,
  version: 3,
  rulesVersion: RULES_VERSION,
  mode: "spar",
  turnNumber: 1,
  combatants: { [actorId]: combatant(actorId), [opponentId]: combatant(opponentId) },
  activeEffects: [],
  actionHistory: [],
  resolutionFrames: [],
  scheduledWork: [],
  eventSequence: 0,
  status: "active",
  phase: "action",
  activeCombatantId: actorId,
});

const aiRequest = (profile = normalProfile) => {
  const state = activeState();
  const decision: LegalDecision = { type: "pass", actorId };
  const mechanics: AiMechanicsView = {
    version: "mechanics:test",
    moves: [],
    items: [],
    transformations: [],
  };
  return {
    state,
    actorId,
    legalDecisions: [decision],
    profile,
    mechanics,
    dependencies: {
      random: createAiRandomSource({
        rootSeed: 7,
        profileVersion: profile.identity.version,
        evaluatorVersion: "test-evaluator:v1",
        purpose: "phase-0-test",
      }),
    },
    analysis: { describeDecision: describeLegalDecision },
  };
};

describe("simulation Phase 0 contracts", () => {
  it("freezes the certified v1 scope against public catalog facts", () => {
    expect(SIMULATION_SCOPE_V1.scopeId).toBe("simulation-scope:v1");
    expect(SIMULATION_SCOPE_V1.combatCapabilityScope).toBe("ai-combat-scope:v1");
    expect(SIMULATION_SCOPE_V1.catalog.moveCount).toBe(499);
    expect(SIMULATION_SCOPE_V1.transformationFamilies).toHaveLength(6);
    expect(Object.isFrozen(SIMULATION_SCOPE_V1)).toBe(true);
  });

  it("provides stable canonical JSON and content hashes", () => {
    expect(canonicalJson({ z: 1, a: [2, undefined] })).toBe('{"a":[2,null],"z":1}');
    expect(canonicalHash({ a: 1, b: 2 })).toBe(canonicalHash({ b: 2, a: 1 }));
    expect(() => canonicalJson({ value: Number.NaN })).toThrow(TypeError);
  });

  it("rejects mismatched artifact schemas with a typed result", () => {
    const artifact = {
      artifactKind: "aggregateReport",
      schemaVersion: ARTIFACT_SCHEMA_VERSIONS.aggregateReport,
    };
    expect(readVersionedArtifact(artifact, "aggregateReport")).toEqual({
      ok: true,
      value: artifact,
    });
    expect(
      readVersionedArtifact(
        { ...artifact, schemaVersion: "simulation-aggregate-report:v0" },
        "aggregateReport",
      ),
    ).toMatchObject({
      ok: false,
      error: { type: "schema-mismatch", expectedSchemaVersion: "simulation-aggregate-report:v1" },
    });
  });

  it("derives independent versioned seeds from semantic identity", () => {
    const input = {
      rootSeed: 42,
      scenarioId: "simulation-scenario:smoke",
      variantId: "simulation-variant:baseline",
      templateAHash: "template-a",
      templateBHash: "template-b",
      strategyAId: "profile:simulation-quality",
      strategyBId: "profile:simulation-quality",
      iteration: 0,
      mirror: "original" as const,
      purpose: "combat" as const,
    };
    const manifest = createSimulationSeedManifest(input);
    expect(manifest.seed).toBe(deriveSimulationSeed(input));
    expect(manifest.derivationVersion).toBe("simulation-seed:v1");
    expect(deriveSimulationSeed({ ...input, iteration: 1 })).not.toBe(manifest.seed);
    expect(SIMULATION_DEFAULT_LIMITS.concurrency).toBe(1);
  });

  it("uses only the combat-owned decision point for advance, ownership, and completion", () => {
    const state = activeState();
    expect(getSimulationDecisionPoint(state)).toMatchObject({ type: "decision-required", actorId });
    expect(getSimulationDecisionPoint({ ...state, phase: "upkeep" })).toEqual({
      type: "advance",
      stateVersion: state.version,
    });
    const pendingState: ActiveFightState = {
      ...state,
      pendingDecision: {
        id: pendingDecisionIdSchema.parse("pending-decision:simulation-defense"),
        stateVersion: state.version,
        combatantId: opponentId,
        type: "defense-response",
        options: [{ id: "roll-defense", type: "roll-defense" }],
      },
    };
    expect(getSimulationDecisionPoint(pendingState)).toMatchObject({
      type: "decision-required",
      actorId: opponentId,
    });
    const completed: FightState = {
      ...state,
      status: "completed",
      completion: { type: "cancelled" },
    };
    Reflect.deleteProperty(completed, "phase");
    Reflect.deleteProperty(completed, "activeCombatantId");
    expect(getSimulationDecisionPoint(completed)).toEqual({
      type: "completed",
      completion: { type: "cancelled" },
    });
  });

  it("preserves AI metadata and selects the exact supplied legal object", () => {
    const request = aiRequest();
    const selected = selectSimulationDecision(request);
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    expect(selected.value.decision).toBe(request.legalDecisions[0]);
    expect(selected.value.simulationRecord).toMatchObject({
      schemaVersion: "simulation-decision-record:v1",
      requestedProfile: { id: normalProfile.identity.id },
      pipelineVersion: "simulation-ai-pipeline:v1",
      seedDerivationVersion: "simulation-ai-seed:v1",
      effectiveCapabilities: { descriptors: true },
    });
  });

  it("rejects simulation-quality selection without declared probe-backed capabilities", () => {
    const request = aiRequest({
      ...normalProfile,
      identity: { ...normalProfile.identity, id: "profile:simulation-quality" },
      difficulty: { ...normalProfile.difficulty, level: "simulation-quality" },
    });
    const selected = selectSimulationDecision({ ...request, analysis: undefined });
    expect(selected).toMatchObject({
      ok: false,
      error: { type: "insufficient-analysis-capabilities" },
    });
  });

  it("delegates semantic progress and ignores bookkeeping IDs", () => {
    const first = activeState();
    const second: ActiveFightState = {
      ...first,
      id: fightIdSchema.parse("fight:simulation-phase-0-other"),
      version: 99,
      eventSequence: 100,
    };
    expect(hasSameSimulationSemanticProgress(first, second)).toBe(true);
    expect(createSimulationSemanticProgressIdentity(first).schemaVersion).toBe(
      "combat-semantic-progress:v1",
    );
    expect(hasSameSimulationSemanticProgress(first, { ...first, turnNumber: 2 })).toBe(false);

    const restriction = {
      id: activeEffectIdSchema.parse("active-effect:simulation-restriction"),
      type: "action-restriction" as const,
      sourceCombatantId: actorId,
      targetCombatantId: opponentId,
      sourceDefinitionId: "move:simulation-restriction",
      sourceEffectIndex: 0,
      availableFromTurn: 1,
      remainingTurns: 2,
    };
    const withRestriction: ActiveFightState = {
      ...first,
      activeEffects: [restriction],
    };
    expect(
      hasSameSimulationSemanticProgress(withRestriction, {
        ...withRestriction,
        activeEffects: [{ ...restriction, remainingTurns: 1 }],
      }),
    ).toBe(false);
  });
});
