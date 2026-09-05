import {
  BranchCombatIdSource,
  canonicalDecisionKey,
  FixedClock,
  SeededRandomSource,
  createCombatRuntime,
  type CombatDependencies,
  type CombatEvent,
  type CombatMechanicsView,
  type CombatRuntime,
  type CombatTransition,
  type FightState,
  type LegalDecision,
} from "@dragonball-resurgence/combat-engine";
import {
  createAiRandomSource,
  resolveDifficultySettings,
  resolveEffectiveAiAnalysisCapabilities,
  type AiMechanicsView,
  type CandidateEvaluation,
} from "@dragonball-resurgence/ai-engine";

import { canonicalHash } from "./canonical.js";
import {
  type SimulationControl,
  type SimulationCoverageCounters,
  type SimulationFailure,
  type SimulationFightExecutionResult,
  type SimulationFightRequest,
  type SimulationFightMetrics,
  type SimulationReplayRecord,
  type SimulationSummary,
  type SimulationTerminationReason,
} from "./contracts.js";
import { simulationFightRequestSchema } from "./contracts.js";
import { allocateSimulationSeed, simulationScenarioIdentityHash } from "./seeds.js";
import { materializeSimulationTemplate } from "./templates.js";
import {
  SIMULATION_AI_EVALUATOR_VERSION,
  SIMULATION_AI_PIPELINE_VERSION,
  selectSimulationDecision,
} from "./ai-selection.js";
import type { SimulationDecisionRecord } from "./ai-selection.js";
import { SIMULATION_AI_SEED_DERIVATION_VERSION, SIMULATION_SCOPE_VERSION } from "./scope.js";
import { runSimulationTransitionDriver } from "./transition-driver.js";
import type { SimulationMoveFunnel } from "./move-coverage.js";
import { selectControlledSimulationDecision, selectForcedSimulationDecision } from "./exposure.js";

type MoveFunnelStage = Exclude<keyof SimulationMoveFunnel, "decisionFunnel" | "triggerFunnel">;
type DeepMutable<T> = {
  -readonly [Key in keyof T]: T[Key] extends object ? DeepMutable<T[Key]> : T[Key];
};
type MutableCoverageCounters = DeepMutable<SimulationCoverageCounters>;

const combatRuntimeCache = new Map<string, CombatRuntime>();

const runtimeFor = (view: CombatMechanicsView): CombatRuntime => {
  const cached = combatRuntimeCache.get(view.identity.contentHash);
  if (cached !== undefined) return cached;
  const runtime = createCombatRuntime(view);
  combatRuntimeCache.set(view.identity.contentHash, runtime);
  return runtime;
};

const mechanicsFor = (request: SimulationFightRequest): AiMechanicsView => ({
  version: request.mechanicsView.version,
  identity: request.mechanicsView.identity,
  moves: request.mechanicsView.moves,
  items: request.mechanicsView.items,
  transformations: request.mechanicsView.transformations,
});

const forcedSimulationDecisionRecordFor = (
  request: Parameters<typeof resolveEffectiveAiAnalysisCapabilities>[0],
): SimulationDecisionRecord => {
  const difficulty = resolveDifficultySettings(request.profile.difficulty);
  return {
    schemaVersion: "simulation-decision-record:v1",
    requestedProfile: {
      id: request.profile.identity.id,
      version: request.profile.identity.version,
    },
    pipelineVersion: SIMULATION_AI_PIPELINE_VERSION,
    evaluatorVersion: SIMULATION_AI_EVALUATOR_VERSION,
    requestedCapabilities: request.analysis?.capabilities ?? "not-declared",
    effectiveCapabilities: resolveEffectiveAiAnalysisCapabilities(request),
    seedDerivationVersion: SIMULATION_AI_SEED_DERIVATION_VERSION,
    workLimits: {
      candidateLimit: difficulty.candidateLimit,
      outcomeLimit: difficulty.responseLimit,
      nodeLimit: difficulty.maxNodes,
      probeLimit: difficulty.maxProbes,
    },
  };
};

type SimulationDecisionSelection =
  | {
      readonly ok: true;
      readonly value: {
        readonly decision: LegalDecision;
        readonly evaluations: readonly CandidateEvaluation[];
        readonly simulationRecord: SimulationDecisionRecord;
      };
    }
  | {
      readonly ok: false;
      readonly error: Extract<
        ReturnType<typeof selectSimulationDecision>,
        { readonly ok: false }
      >["error"];
    };

const simulationDecisionFor = (
  aiRequest: Parameters<typeof selectSimulationDecision>[0],
  legalDecisions: readonly LegalDecision[],
  policy: SimulationFightRequest["decisionPolicy"],
): SimulationDecisionSelection => {
  const forcedDecision =
    policy?.type === "forced-target-first"
      ? selectForcedSimulationDecision(legalDecisions, policy)
      : undefined;
  const controlledDecision =
    policy?.type === "controlled-legal-preference"
      ? selectControlledSimulationDecision(legalDecisions, policy)
      : undefined;
  const directDecision = forcedDecision ?? controlledDecision;
  if (directDecision !== undefined)
    return {
      ok: true,
      value: {
        decision: directDecision,
        evaluations: [],
        simulationRecord: forcedSimulationDecisionRecordFor(aiRequest),
      },
    };
  const selected = selectSimulationDecision(aiRequest);
  if (!selected.ok) return selected;
  return {
    ok: true,
    value: {
      decision: selected.value.decision,
      evaluations: selected.value.evaluations,
      simulationRecord: selected.value.simulationRecord,
    },
  };
};

const initialSummary = (): {
  actorActions: number;
  pendingResponses: number;
  completedActions: number;
  moveUses: Record<string, number>;
  itemUses: Record<string, number>;
  damageByCombatant: Record<string, number>;
  resources: Record<string, { hp: number; ki: number }>;
  statuses: Record<string, number>;
  transformations: number;
  perDieOutcomes: Record<string, number>;
  moveFunnels: Record<string, SimulationMoveFunnel>;
} => ({
  actorActions: 0,
  pendingResponses: 0,
  completedActions: 0,
  moveUses: {},
  itemUses: {},
  damageByCombatant: {},
  resources: {},
  statuses: {},
  transformations: 0,
  perDieOutcomes: {},
  moveFunnels: {},
});

const initialCoverageCounters = (): {
  eventCounts: Record<string, number>;
  statusCounts: Record<string, number>;
  attackOutcomes: MutableCoverageCounters["attackOutcomes"];
  statuses: MutableCoverageCounters["statuses"];
  transformations: MutableCoverageCounters["transformations"];
  restrictedUse: MutableCoverageCounters["restrictedUse"];
  sequences: MutableCoverageCounters["sequences"];
  stalls: MutableCoverageCounters["stalls"];
  kiSpent: number;
  kiGained: number;
} => ({
  eventCounts: {},
  statusCounts: {},
  attackOutcomes: { attempted: 0, successful: 0, stopped: 0, critical: 0, counter: 0 },
  statuses: { applied: 0, removed: 0, rolled: 0, lockoutEvents: 0 },
  transformations: { activated: 0, deactivated: 0, rolled: 0, cooldownsStarted: 0 },
  restrictedUse: { moveUses: 0, limitChanges: 0, movesRemoved: 0 },
  sequences: {
    deferredScheduled: 0,
    deferredCancelled: 0,
    deferredPerformed: 0,
    counterChainLimits: 0,
  },
  stalls: { actionSkips: 0, maximumTurns: 0, maximumTransitions: 0, semanticNoProgress: 0 },
  kiSpent: 0,
  kiGained: 0,
});

const incrementCounter = (record: Record<string, number>, key: string): void => {
  record[key] = (record[key] ?? 0) + 1;
};

/* eslint-disable sonarjs/cognitive-complexity, complexity -- The compact coverage counter folds the finite event vocabulary once at the combat boundary. */
const updateCoverageCounters = (
  counters: ReturnType<typeof initialCoverageCounters>,
  events: readonly CombatEvent[],
): void => {
  for (const event of events) {
    const facts = event as unknown as Record<string, unknown>;
    const type = typeof facts.type === "string" ? facts.type : "unknown";
    incrementCounter(counters.eventCounts, type);
    if (type === "attack-resolved") {
      counters.attackOutcomes.attempted += 1;
      const outcome = facts.outcome;
      if (outcome === "successful" || outcome === "stopped") counters.attackOutcomes[outcome] += 1;
      if (facts.critical === true) counters.attackOutcomes.critical += 1;
      if (facts.counter === true) counters.attackOutcomes.counter += 1;
    }
    if (type === "status-applied") {
      counters.statuses.applied += 1;
      if (typeof facts.statusId === "string")
        incrementCounter(counters.statusCounts, facts.statusId);
    }
    if (type === "status-removed") counters.statuses.removed += 1;
    if (type === "status-rolled") counters.statuses.rolled += 1;
    if (type === "action-skipped") {
      counters.statuses.lockoutEvents += 1;
      counters.stalls.actionSkips += 1;
    }
    if (type === "transformation-activated") counters.transformations.activated += 1;
    if (type === "transformation-deactivated") counters.transformations.deactivated += 1;
    if (type === "transformation-rolled") counters.transformations.rolled += 1;
    if (type === "transformation-cooldown-started") counters.transformations.cooldownsStarted += 1;
    if (type === "move-used") counters.restrictedUse.moveUses += 1;
    if (type === "move-use-limit-changed") counters.restrictedUse.limitChanges += 1;
    if (type === "move-removed-from-combat") {
      counters.restrictedUse.movesRemoved += 1;
      counters.statuses.lockoutEvents += 1;
    }
    if (type === "deferred-move-scheduled") counters.sequences.deferredScheduled += 1;
    if (type === "deferred-move-cancelled") counters.sequences.deferredCancelled += 1;
    if (type === "deferred-move-performed") counters.sequences.deferredPerformed += 1;
    if (type === "counter-chain-limit-reached") counters.sequences.counterChainLimits += 1;
    if (type === "ki-changed" && typeof facts.amount === "number") {
      if (facts.amount < 0) counters.kiSpent += -facts.amount;
      else counters.kiGained += facts.amount;
    }
  }
};
/* eslint-enable sonarjs/cognitive-complexity, complexity */

const emptyMoveFunnel = (): SimulationMoveFunnel => ({
  equipped: 0,
  eligible: 0,
  affordable: 0,
  selected: 0,
  submitted: 0,
  resolved: 0,
  successful: 0,
  valueProducing: 0,
  decisionFunnel: {
    equipped: 0,
    eligible: 0,
    affordable: 0,
    selected: 0,
    submitted: 0,
    resolved: 0,
    successful: 0,
    valueProducing: 0,
  },
  triggerFunnel: {
    applicable: 0,
    triggered: 0,
    activated: 0,
    resolved: 0,
    successful: 0,
    valueProducing: 0,
  },
});

const incrementMoveFunnel = (
  funnels: Record<string, SimulationMoveFunnel>,
  moveId: string,
  stages: readonly MoveFunnelStage[],
): void => {
  const current = funnels[moveId] ?? emptyMoveFunnel();
  const next = { ...current };
  const decisionFunnel = { ...current.decisionFunnel };
  for (const stage of stages) {
    next[stage] += 1;
    decisionFunnel[stage] += 1;
  }
  next.decisionFunnel = decisionFunnel;
  funnels[moveId] = next;
};

type TriggerFunnelStage = keyof SimulationMoveFunnel["triggerFunnel"];

const incrementTriggerFunnel = (
  funnels: Record<string, SimulationMoveFunnel>,
  moveId: string,
  stages: readonly TriggerFunnelStage[],
): void => {
  const current = funnels[moveId] ?? emptyMoveFunnel();
  const triggerFunnel = { ...current.triggerFunnel };
  for (const stage of stages) triggerFunnel[stage] += 1;
  funnels[moveId] = { ...current, triggerFunnel };
};

/* eslint-disable sonarjs/cognitive-complexity, complexity -- One observer owns the structured event vocabulary at the combat boundary. */
const updateMoveFunnels = (
  funnels: Record<string, SimulationMoveFunnel>,
  seenResolutionKeys: Set<string>,
  observation: {
    readonly transition: CombatTransition;
    readonly decision?: LegalDecision;
    readonly legalDecisions?: readonly LegalDecision[];
  },
): void => {
  for (const candidate of observation.legalDecisions ?? [])
    if (candidate.type === "use-move")
      incrementMoveFunnel(funnels, candidate.moveId, ["equipped", "eligible", "affordable"]);
  if (observation.decision?.type === "use-move")
    incrementMoveFunnel(funnels, observation.decision.moveId, ["selected", "submitted"]);

  for (const mechanicObservation of observation.transition.mechanicObservations ?? []) {
    if (
      mechanicObservation.subject !== "move" &&
      mechanicObservation.subject !== "block" &&
      mechanicObservation.subject !== "effect"
    )
      continue;
    if (mechanicObservation.category === "trigger")
      incrementTriggerFunnel(funnels, mechanicObservation.definitionId, [
        "applicable",
        "triggered",
      ]);
    if (mechanicObservation.category === "activation")
      incrementTriggerFunnel(funnels, mechanicObservation.definitionId, [
        "applicable",
        "triggered",
        "activated",
      ]);
    if (mechanicObservation.category === "resolution")
      incrementTriggerFunnel(funnels, mechanicObservation.definitionId, [
        "applicable",
        "triggered",
        "activated",
        "resolved",
      ]);
    if (mechanicObservation.category === "value")
      incrementTriggerFunnel(funnels, mechanicObservation.definitionId, [
        "applicable",
        "triggered",
        "activated",
        "resolved",
        "successful",
        "valueProducing",
      ]);
  }

  const facts = observation.transition.events.map(
    (event) => event as unknown as Record<string, unknown>,
  );
  const stringField = (event: Record<string, unknown>, key: string): string | undefined =>
    typeof event[key] === "string" ? event[key] : undefined;
  const typeField = (event: Record<string, unknown>): string | undefined =>
    stringField(event, "type");
  const hasPendingDecision =
    observation.transition.pendingDecision !== undefined ||
    ("pendingDecision" in observation.transition.state &&
      observation.transition.state.pendingDecision !== undefined);
  const submittedMoveId =
    observation.decision?.type === "use-move" ? observation.decision.moveId : undefined;
  const valueProducing = facts.some(
    (event) =>
      (typeField(event) === "damage-applied" &&
        typeof event.amount === "number" &&
        event.amount > 0) ||
      typeField(event) === "status-applied" ||
      typeField(event) === "effect-activated" ||
      (typeField(event) === "ki-changed" && typeof event.amount === "number" && event.amount > 0),
  );
  const resolutions = new Map<string, { moveId: string; successful: boolean }>();
  for (const event of facts) {
    const type = typeField(event);
    const moveId = stringField(event, "moveId");
    if (
      moveId === undefined ||
      !(
        type === "attack-resolved" ||
        type === "deferred-move-performed" ||
        (type === "move-used" && !hasPendingDecision && moveId === submittedMoveId)
      )
    )
      continue;
    const cause = stringField(event, "causedByDecisionId");
    const fallbackCause = cause ?? `state:${observation.transition.state.version}`;
    const key = `${moveId}|${fallbackCause}`;
    if (seenResolutionKeys.has(key)) continue;
    seenResolutionKeys.add(key);
    resolutions.set(key, {
      moveId,
      successful: type !== "attack-resolved" || event.outcome === "successful",
    });
  }
  for (const { moveId, successful } of resolutions.values()) {
    const effectiveSuccess = successful || valueProducing;
    const stages: MoveFunnelStage[] = ["resolved"];
    if (effectiveSuccess) stages.push("successful");
    if (effectiveSuccess && valueProducing) stages.push("valueProducing");
    incrementMoveFunnel(funnels, moveId, stages);
  }
};
/* eslint-enable sonarjs/cognitive-complexity, complexity */

/* eslint-disable sonarjs/cognitive-complexity, complexity -- The observer folds the structured combat event vocabulary at one bounded boundary. */
const updateSummary = (
  summary: ReturnType<typeof initialSummary>,
  events: readonly CombatEvent[],
  state: FightState,
): void => {
  for (const event of events) {
    const facts = event as unknown as Record<string, unknown>;
    const type = String(facts.type);
    if (type === "move-used" && typeof facts.moveId === "string")
      summary.moveUses[facts.moveId] = (summary.moveUses[facts.moveId] ?? 0) + 1;
    if (type === "item-used" && typeof facts.itemId === "string")
      summary.itemUses[facts.itemId] = (summary.itemUses[facts.itemId] ?? 0) + 1;
    if (
      type === "damage-applied" &&
      typeof facts.targetCombatantId === "string" &&
      typeof facts.amount === "number"
    )
      summary.damageByCombatant[facts.targetCombatantId] =
        (summary.damageByCombatant[facts.targetCombatantId] ?? 0) + facts.amount;
    if (type === "transformation-activated") summary.transformations += 1;
    if (type === "attack-rolled" || type === "defense-rolled") {
      const result = typeof facts.result === "number" ? String(facts.result) : "unknown";
      summary.perDieOutcomes[result] = (summary.perDieOutcomes[result] ?? 0) + 1;
    }
    if (type === "status-applied" && typeof facts.statusId === "string")
      summary.statuses[facts.statusId] = (summary.statuses[facts.statusId] ?? 0) + 1;
  }
  if ("combatants" in state)
    for (const combatant of Object.values(state.combatants))
      summary.resources[combatant.id] = {
        hp: combatant.hitPoints.current,
        ki: combatant.ki.current,
      };
};
/* eslint-enable sonarjs/cognitive-complexity, complexity */

const terminationForFailure = (
  failure: SimulationFailure,
): SimulationFightExecutionResult["terminationReason"] => {
  switch (failure.type) {
    case "cancelled":
      return "cancelled";
    case "combat-failure":
      return "combat-failure";
    case "ai-failure":
      return "ai-failure";
    case "unsupported-scope":
      return "unsupported-scope";
    case "exhausted-safeguard":
      return failure.reason;
    case "malformed-input":
    case "unknown-reference":
    case "incompatible-loadout":
    case "unexpected-runner-failure":
      return "invalid-fixture";
  }
};

const emptyReplayFor = (
  request: SimulationFightRequest,
  finalState: FightState,
  terminationReason: SimulationTerminationReason = "invalid-fixture",
): SimulationReplayRecord => {
  const manifest = {
    scopeVersion: SIMULATION_SCOPE_VERSION,
    runId: request.runId,
    ...(request.seedFamilyId === undefined ? {} : { seedFamilyId: request.seedFamilyId }),
    rootSeed: request.rootSeed,
    scenario: request.scenario,
    scenarioHash: simulationScenarioIdentityHash(request.scenario),
    variantId: request.scenario.variantId,
    templates: {
      a: { id: request.templateA.id, hash: canonicalHash(request.templateA) },
      b: { id: request.templateB.id, hash: canonicalHash(request.templateB) },
    },
    mechanics: {
      version: request.mechanicsView.version,
      contentHash: request.mechanicsView.identity.contentHash,
      catalogHash: request.mechanicsView.identity.contentHash,
    },
    fixedTime: request.fixedTime.toISOString(),
    policies: {
      retention: request.scenario.retention,
      limits: request.scenario.limits,
      stoppingPolicy: request.scenario.stoppingPolicy,
    },
    ai: {
      a: {
        profileId: request.profileA.identity.id,
        profileVersion: request.profileA.identity.version,
      },
      b: {
        profileId: request.profileB.identity.id,
        profileVersion: request.profileB.identity.version,
      },
    },
    seeds: { combat: 0, aiA: 0, aiB: 0, derivationVersion: "simulation-seed:v1" },
  };
  return {
    schemaVersion: "simulation-contracts:v1",
    replayVersion: "simulation-replay:v1",
    manifestHash: canonicalHash(manifest),
    manifest,
    legalSetHashes: [],
    decisions: [],
    transitionHashes: [],
    stateHashes: [],
    eventHashes: [],
    terminal: {
      terminationReason,
      stateHash: canonicalHash(finalState),
      summary: initialSummary(),
    },
  };
};

const replayFor = (input: {
  readonly request: SimulationFightRequest;
  readonly templateAHash: string;
  readonly templateBHash: string;
  readonly seeds: Readonly<{ combat: number; aiA: number; aiB: number }>;
  readonly aiA?: SimulationDecisionRecord;
  readonly aiB?: SimulationDecisionRecord;
  readonly legalSetHashes: readonly string[];
  readonly decisions: readonly LegalDecision[];
  readonly transitionHashes: readonly string[];
  readonly stateHashes: readonly string[];
  readonly eventHashes: readonly string[];
  readonly result: Pick<
    SimulationFightExecutionResult,
    "terminationReason" | "stateHash" | "summary"
  >;
}): SimulationReplayRecord => {
  const { request } = input;
  const manifest = {
    scopeVersion: SIMULATION_SCOPE_VERSION,
    runId: request.runId,
    ...(request.seedFamilyId === undefined ? {} : { seedFamilyId: request.seedFamilyId }),
    rootSeed: request.rootSeed,
    scenario: request.scenario,
    scenarioHash: simulationScenarioIdentityHash(request.scenario),
    variantId: request.scenario.variantId,
    templates: {
      a: { id: request.templateA.id, hash: input.templateAHash },
      b: { id: request.templateB.id, hash: input.templateBHash },
    },
    mechanics: {
      version: request.mechanicsView.version,
      contentHash: request.mechanicsView.identity.contentHash,
      catalogHash: request.mechanicsView.identity.contentHash,
    },
    fixedTime: request.fixedTime.toISOString(),
    policies: {
      retention: request.scenario.retention,
      limits: request.scenario.limits,
      stoppingPolicy: request.scenario.stoppingPolicy,
    },
    ai: {
      a: input.aiA ?? {
        profileId: request.profileA.identity.id,
        profileVersion: request.profileA.identity.version,
      },
      b: input.aiB ?? {
        profileId: request.profileB.identity.id,
        profileVersion: request.profileB.identity.version,
      },
    },
    seeds: { ...input.seeds, derivationVersion: "simulation-seed:v1" },
  };
  return {
    schemaVersion: "simulation-contracts:v1",
    replayVersion: "simulation-replay:v1",
    manifestHash: canonicalHash(manifest),
    manifest,
    legalSetHashes: input.legalSetHashes,
    decisions: input.decisions,
    transitionHashes: input.transitionHashes,
    stateHashes: input.stateHashes,
    eventHashes: input.eventHashes,
    terminal: {
      terminationReason: input.result.terminationReason,
      stateHash: input.result.stateHash,
      summary: input.result.summary,
    },
  };
};

const failureResult = (
  request: SimulationFightRequest,
  failure: SimulationFailure,
  finalState: FightState = { status: "completed" } as FightState,
): SimulationFightExecutionResult => {
  const terminationReason = terminationForFailure(failure);
  const summary = initialSummary();
  updateSummary(summary, [], finalState);
  return {
    schemaVersion: "simulation-contracts:v1",
    runId: request.runId,
    scenarioId: request.scenario.id,
    pairId: canonicalHash([request.templateA.id, request.templateB.id]),
    finalState,
    completion: finalState.status === "completed" ? finalState.completion : undefined,
    terminationReason,
    failure,
    transitions: [],
    summary,
    stateHash: canonicalHash(finalState),
    eventHash: canonicalHash([]),
    decisionHash: canonicalHash([]),
    randomIdentity: canonicalHash({
      runId: request.runId,
      fixedTime: request.fixedTime.toISOString(),
    }),
    mechanicsView: request.mechanicsView.identity,
    replay: emptyReplayFor(request, finalState, terminationReason),
  };
};

export const runSimulationFight = (
  request: SimulationFightRequest,
  control: SimulationControl = {},
  // This is the intentional simulation boundary that maps all runner outcomes to the public contract.
  // eslint-disable-next-line sonarjs/cognitive-complexity -- runner outcome mapping is centralized here
): SimulationFightExecutionResult => {
  try {
    const parsedRequest = simulationFightRequestSchema.safeParse(request);
    if (!parsedRequest.success)
      return failureResult(request, {
        type: "malformed-input",
        detail: parsedRequest.error.message,
      });
    if (request.scenario.deferred)
      return failureResult(request, {
        type: "unsupported-scope",
        detail: "Deferred scenario families are catalogued but not executable in Phase 3.",
      });
    if (control.isCancelled?.() === true) return failureResult(request, { type: "cancelled" });
    const first = materializeSimulationTemplate(request.templateA, request.mechanicsView);
    const second = materializeSimulationTemplate(request.templateB, request.mechanicsView);
    if (!first.ok)
      return failureResult(request, { type: "malformed-input", detail: first.error.detail });
    if (!second.ok)
      return failureResult(request, { type: "malformed-input", detail: second.error.detail });
    const pairId =
      request.seedFamilyId ??
      canonicalHash({
        iteration: request.iteration ?? 0,
        members: [
          { template: first.value.templateHash, profile: request.profileA.identity },
          { template: second.value.templateHash, profile: request.profileB.identity },
        ].sort((left, right) =>
          `${left.template}:${left.profile.id}`.localeCompare(
            `${right.template}:${right.profile.id}`,
          ),
        ),
      });
    const common = {
      rootSeed: request.rootSeed,
      scenarioId: request.scenario.id,
      scenarioHash: simulationScenarioIdentityHash(request.scenario),
      variantId: request.scenario.variantId,
      pairId,
      iteration: request.iteration ?? 0,
      mirror: request.mirror ?? "original",
      templateAHash: request.seedFamilyId ?? first.value.templateHash,
      templateBHash: request.seedFamilyId ?? second.value.templateHash,
      strategyAId: request.profileA.identity.id,
      strategyBId: request.profileB.identity.id,
    };
    const combatSeed = allocateSimulationSeed({
      ...common,
      namespace: "combat",
    }).seed;
    const aiSeedA = allocateSimulationSeed({ ...common, namespace: "ai-a" }).seed;
    const aiSeedB = allocateSimulationSeed({ ...common, namespace: "ai-b" }).seed;
    const diagnosticsEnabled = request.scenario.retention === "diagnostic";
    const coverageEnabled = request.scenario.retention === "coverage";
    const dependencies: CombatDependencies = {
      random: new SeededRandomSource(combatSeed),
      clock: new FixedClock(request.fixedTime),
      ids: new BranchCombatIdSource([request.runId, pairId]),
      retainDiagnosticTrace: diagnosticsEnabled,
      retainMechanicObservations: diagnosticsEnabled || coverageEnabled,
      mechanicsView: request.mechanicsView,
    };
    const runtime = runtimeFor(request.mechanicsView);
    const created = runtime.createFight(
      { mode: "spar", combatants: [first.value.input, second.value.input] },
      dependencies,
    );
    if (!created.ok)
      return failureResult(request, { type: "combat-failure", failure: created.error });
    const summaries = initialSummary();
    const coverageCounters = initialCoverageCounters();
    const combatantIds = Object.keys(created.value.state.combatants);
    const hitPoints: Record<string, number> = Object.fromEntries(
      Object.values(created.value.state.combatants).map((combatant) => [
        String(combatant.id),
        combatant.hitPoints.current,
      ]),
    );
    const overkill = { a: 0, b: 0 };
    const updateCoverageOverkill = (events: readonly CombatEvent[]): void => {
      for (const event of events) {
        const facts = event as unknown as Record<string, unknown>;
        if (facts.type !== "damage-applied") continue;
        const target = typeof facts.targetCombatantId === "string" ? facts.targetCombatantId : "";
        const amount = typeof facts.amount === "number" ? facts.amount : 0;
        const before = hitPoints[target] ?? 0;
        const value = Math.max(0, amount - before);
        if (target === combatantIds[1]) overkill.a += value;
        if (target === combatantIds[0]) overkill.b += value;
        if (typeof facts.remainingHitPoints === "number")
          hitPoints[target] = facts.remainingHitPoints;
      }
    };
    const seenResolutionKeys = new Set<string>();
    let forcedTargetSelected = false;
    let forcedTargetObserved = false;
    const controlledExposureUsedByActor = new Set<string>();
    updateSummary(summaries, created.value.events, created.value.state);
    const evaluations: CandidateEvaluation[] = [];
    const aiRecords: { a?: SimulationDecisionRecord; b?: SimulationDecisionRecord } = {};
    let probeCount = 0;
    const driver = runSimulationTransitionDriver({
      runtime,
      initial: created.value,
      dependencies,
      limits: request.scenario.limits,
      retainDiagnosticPayload: diagnosticsEnabled,
      control,
      // This callback intentionally combines controlled exposure, AI selection, and coverage observation.
      // eslint-disable-next-line sonarjs/cognitive-complexity -- decision policy composition is centralized at the runner boundary
      chooseDecision: (state, legalDecisions) => {
        if (state.status !== "active")
          return {
            error: {
              type: "unexpected-runner-failure",
              detail: "Completed state requested a decision.",
            },
          };
        const actorId = state.pendingDecision?.combatantId ?? state.activeCombatantId;
        const descriptorByDecisionKey = new Map(
          runtime
            .describeDecisions(state, actorId)
            .map((descriptor) => [descriptor.key, descriptor] as const),
        );
        const actorIsA = actorId === Object.keys(state.combatants)[0];
        const aiProfile = actorIsA ? request.profileA : request.profileB;
        summaries.pendingResponses += state.pendingDecision === undefined ? 0 : 1;
        const aiRequest = {
          state,
          actorId,
          legalDecisions,
          profile: aiProfile,
          opponentProfile: actorIsA ? request.profileB : request.profileA,
          mechanics: mechanicsFor(request),
          dependencies: {
            random: createAiRandomSource({
              rootSeed: actorIsA ? aiSeedA : aiSeedB,
              profileVersion: actorIsA
                ? request.profileA.identity.version
                : request.profileB.identity.version,
              evaluatorVersion: SIMULATION_AI_EVALUATOR_VERSION,
              purpose: actorIsA ? "simulation-ai-a" : "simulation-ai-b",
            }),
          },
          analysis: {
            // Retention is the optimization boundary. Keep the authoritative
            // decision path identical across diagnostic and coverage runs;
            // coverage simply drops the resulting diagnostic payloads.
            capabilities: {
              descriptors: true,
              expectedOutcomes: true,
              pruning: true,
              setupInference: true,
              lookaheadDepth: 2,
              opponentModeling: true,
              pendingExpansion: true,
            },
            describeDecision: (descriptorState: FightState, decision: LegalDecision) => {
              if (descriptorState !== state)
                return runtime.describeDecision(descriptorState, decision);
              const descriptor = descriptorByDecisionKey.get(canonicalDecisionKey(decision));
              return descriptor ?? runtime.describeDecision(descriptorState, decision);
            },
            probeDecision: (
              probeState: FightState,
              probeDecision: LegalDecision,
              probeDependencies?: CombatDependencies,
            ) => {
              probeCount += 1;
              return runtime.probeDecision(
                probeState,
                probeDecision,
                probeDependencies ?? dependencies,
              );
            },
          },
          ...(aiProfile.identity.id === "profile:normal"
            ? {
                workLimits: {
                  candidateLimit: 2,
                  outcomeLimit: 1,
                  nodeLimit: 4,
                  probeLimit: 4,
                },
              }
            : {}),
          diagnosticRetention: diagnosticsEnabled ? ("full" as const) : ("none" as const),
        };
        const controlledPolicy =
          request.decisionPolicy?.type === "controlled-legal-preference" &&
          controlledExposureUsedByActor.has(String(actorId))
            ? { ...request.decisionPolicy, preferredDefinitionIds: [] }
            : request.decisionPolicy;
        const selected = simulationDecisionFor(aiRequest, legalDecisions, controlledPolicy);
        if (!selected.ok) return { error: { type: "ai-failure", failure: selected.error } };
        const chosen = selected.value.decision;
        if (
          request.decisionPolicy?.type === "controlled-legal-preference" &&
          chosen.type === "use-move" &&
          request.decisionPolicy.preferredDefinitionIds.includes(chosen.moveId)
        )
          controlledExposureUsedByActor.add(String(actorId));
        if (
          request.decisionPolicy?.type === "forced-target-first" &&
          chosen.type === "use-move" &&
          chosen.moveId === request.decisionPolicy.targetDefinitionId
        )
          forcedTargetSelected = true;
        aiRecords[actorIsA ? "a" : "b"] = selected.value.simulationRecord;
        if (diagnosticsEnabled) evaluations.push(...selected.value.evaluations);
        summaries.actorActions += 1;
        return {
          decision: chosen,
          input: {
            ...chosen,
            id: dependencies.ids.nextDecisionId(),
            expectedStateVersion: state.version,
          },
        };
      },
      observe: ({ transition, decision, legalDecisions }) => {
        summaries.completedActions += transition.events.some(
          (event) => event.type === "attack-resolved" || event.type === "action-skipped",
        )
          ? 1
          : 0;
        updateSummary(summaries, transition.events, transition.state);
        updateCoverageCounters(coverageCounters, transition.events);
        updateCoverageOverkill(transition.events);
        if (request.decisionPolicy?.type === "forced-target-first") {
          const targetId = request.decisionPolicy.targetDefinitionId;
          forcedTargetObserved ||= transition.events.some(
            (event) =>
              ("moveId" in event && event.moveId === targetId) ||
              ("definitionId" in event && event.definitionId === targetId),
          );
        }
        updateMoveFunnels(summaries.moveFunnels, seenResolutionKeys, {
          transition,
          decision,
          legalDecisions,
        });
      },
      stopWhen: () =>
        coverageEnabled &&
        request.decisionPolicy?.type === "forced-target-first" &&
        forcedTargetSelected &&
        forcedTargetObserved,
    });
    if (!driver.ok) return failureResult(request, driver.failure, driver.state);
    const state = driver.state;
    const decisionHashes = driver.decisionHashes;
    const diagnostics = diagnosticsEnabled
      ? {
          legalSetHashes: driver.legalSetHashes,
          decisionHashes,
          selectedDecisions: driver.decisions,
          evaluations,
          eventHashes: driver.eventHashes,
          stateHashes: driver.stateHashes,
          semanticFingerprints: driver.stateHashes.slice(1),
          calculationTraceCount: driver.transitions.reduce(
            (count, transition) => count + (transition.diagnosticTrace?.length ?? 0),
            0,
          ),
          moveFunnels: summaries.moveFunnels,
        }
      : undefined;
    let failure: SimulationFailure | undefined;
    if (driver.terminationReason === "cancelled") failure = { type: "cancelled" };
    else if (
      driver.terminationReason !== "engine-completed" &&
      driver.terminationReason !== "coverage-satisfied"
    )
      failure = {
        type: "exhausted-safeguard",
        reason: driver.terminationReason,
      };
    const summary: SimulationSummary = {
      ...summaries,
      moveUses: summaries.moveUses,
      itemUses: summaries.itemUses,
      damageByCombatant: summaries.damageByCombatant,
      resources: summaries.resources,
      statuses: summaries.statuses,
      perDieOutcomes: summaries.perDieOutcomes,
    };
    const replay = replayFor({
      request,
      templateAHash: first.value.templateHash,
      templateBHash: second.value.templateHash,
      seeds: { combat: combatSeed, aiA: aiSeedA, aiB: aiSeedB },
      aiA: aiRecords.a,
      aiB: aiRecords.b,
      legalSetHashes: diagnosticsEnabled ? driver.legalSetHashes : [],
      decisions: diagnosticsEnabled ? driver.decisions : [],
      transitionHashes: diagnosticsEnabled ? driver.transitionHashes : [],
      stateHashes: diagnosticsEnabled ? driver.stateHashes : [],
      eventHashes: diagnosticsEnabled ? driver.eventHashes : [],
      result: {
        terminationReason: driver.terminationReason,
        stateHash: canonicalHash(state),
        summary,
      },
    });
    const metrics: SimulationFightMetrics = {
      runId: request.runId,
      decisions: decisionHashes.length,
      probes: probeCount,
      transitions: driver.eventHashes.length,
    };
    control.onMetrics?.(metrics);
    return {
      schemaVersion: "simulation-contracts:v1",
      runId: request.runId,
      scenarioId: request.scenario.id,
      pairId,
      finalState: state,
      completion: state.status === "completed" ? state.completion : undefined,
      terminationReason: driver.terminationReason,
      failure,
      transitions: diagnosticsEnabled ? driver.transitions : [],
      summary,
      ...(coverageEnabled
        ? {
            coverage: {
              moveFunnels: summaries.moveFunnels,
              counters: coverageCounters,
              overkill,
              terminalHashes: {
                state: canonicalHash(state),
                events: canonicalHash(driver.eventHashes),
                decisions: canonicalHash(decisionHashes),
              },
              replayManifestHash: replay.manifestHash,
            },
          }
        : {}),
      diagnostics,
      stateHash: canonicalHash(state),
      eventHash: canonicalHash(driver.eventHashes),
      decisionHash: canonicalHash(decisionHashes),
      randomIdentity: canonicalHash({
        combatSeed,
        aiSeedA,
        aiSeedB,
        fixedTime: request.fixedTime.toISOString(),
        dependencyPolicy: "simulation-dependencies:v1",
      }),
      mechanicsView: request.mechanicsView.identity,
      replay,
    };
  } catch (error) {
    return failureResult(request, {
      type: "unexpected-runner-failure",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};
