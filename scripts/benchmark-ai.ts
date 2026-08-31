import {
  canonicalDecisionKey,
  CANONICAL_COMBAT_RUNTIME,
  type CombatantId,
  type FightId,
  type FightState,
  type LegalDecision,
} from "@dragonball-resurgence/combat-engine";
import {
  SIMULATION_QUALITY_PROFILE,
  createAiRandomSource,
  selectAiDecision,
  type AiDecisionRequest,
  type AiMechanicsView,
} from "@dragonball-resurgence/ai-engine";

const actorId = "combatant:benchmark-actor" as CombatantId;
const opponentId = "combatant:benchmark-opponent" as CombatantId;
const state: FightState = {
  id: "fight:benchmark" as FightId,
  schemaVersion: 5,
  mechanicsView: CANONICAL_COMBAT_RUNTIME.view.identity,
  version: 0,
  rulesVersion: { value: "rules-v1" },
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

const mechanics: AiMechanicsView = CANONICAL_COMBAT_RUNTIME.view;
const decisions: readonly LegalDecision[] = [
  { type: "pass", actorId },
  { type: "power-up", actorId },
  { type: "surrender", actorId },
  { type: "basic-attack", actorId, basicAttack: "basic-punch", targetCombatantId: opponentId },
  { type: "basic-attack", actorId, basicAttack: "basic-kick", targetCombatantId: opponentId },
  { type: "basic-attack", actorId, basicAttack: "basic-ki-blast", targetCombatantId: opponentId },
];

const requestFor = (legalDecisions: readonly LegalDecision[]): AiDecisionRequest => ({
  state,
  actorId,
  legalDecisions,
  profile: SIMULATION_QUALITY_PROFILE,
  mechanics,
  dependencies: {
    random: createAiRandomSource({
      rootSeed: 20260830,
      profileVersion: SIMULATION_QUALITY_PROFILE.identity.version,
      evaluatorVersion: "benchmark:v1",
      purpose: "benchmark",
    }),
    randomness: "disabled",
  },
  analysis: {
    capabilities: {
      descriptors: true,
      expectedOutcomes: true,
      pruning: true,
      setupInference: true,
      lookaheadDepth: 2,
      opponentModeling: true,
      pendingExpansion: true,
    },
    describeDecision: (currentState, decision) =>
      CANONICAL_COMBAT_RUNTIME.describeDecision(currentState, decision),
    probeDecision: (probeState, decision, dependencies) => {
      if (dependencies === undefined) throw new Error("Branch dependencies are required.");
      return CANONICAL_COMBAT_RUNTIME.probeDecision(probeState, decision, dependencies);
    },
  },
  diagnosticRetention: "full",
});

const cases = [
  ["micro-basic-immediate", decisions.slice(0, 2)],
  ["representative-probe-lookahead", decisions.slice(0, 4)],
  ["micro-candidate-scaling", decisions],
] as const;

const results = cases.map(([name, legalDecisions]) => {
  const start = performance.now();
  const result = selectAiDecision(requestFor(legalDecisions));
  const elapsedMilliseconds = performance.now() - start;
  return {
    name,
    candidateCount: legalDecisions.length,
    elapsedMilliseconds: Number(elapsedMilliseconds.toFixed(3)),
    selected: result.ok ? canonicalDecisionKey(result.value.decision) : undefined,
    budget: result.ok ? result.value.diagnostics?.budget : undefined,
    work: result.ok
      ? {
          candidatesEvaluated: legalDecisions.length,
          candidatesRetained: result.value.evaluations.filter(
            (evaluation) => evaluation.pruning === "retained" || evaluation.pruning === "protected",
          ).length,
          expectedOutcomeBranches: result.value.evaluations.reduce(
            (total, evaluation) => total + (evaluation.outcomes?.length ?? 0),
            0,
          ),
          probeCount: result.value.diagnostics?.budget?.probes.used ?? 0,
          nodesVisited: result.value.diagnostics?.budget?.nodes.used ?? 0,
          depthReached: Math.max(
            0,
            ...(result.value.diagnostics?.searchPaths ?? []).map((path) => path.depth),
          ),
          pendingExpansions: (result.value.diagnostics?.searchPaths ?? []).reduce(
            (total, path) => total + Math.max(0, path.path.length - 1),
            0,
          ),
        }
      : undefined,
    error: result.ok ? undefined : result.error,
  };
});

console.log(
  JSON.stringify(
    {
      profile: SIMULATION_QUALITY_PROFILE.identity,
      bounds: SIMULATION_QUALITY_PROFILE.difficulty,
      note: "Wall-clock values are informational; work limits are the acceptance boundary.",
      coverage: {
        measured: ["basic-immediate", "probe-backed-lookahead", "candidate-scaling"],
        deferredToSimulationBenchmarkHarness: [
          "resource-heavy",
          "transformation",
          "control-status",
          "combo-setup",
          "pending-response",
          "opponent-response",
          "full-autonomous-fight",
        ],
      },
      cases: results,
    },
    null,
    2,
  ),
);
