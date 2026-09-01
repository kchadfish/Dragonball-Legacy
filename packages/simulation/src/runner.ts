import {
  BranchCombatIdSource,
  FixedClock,
  SeededRandomSource,
  createCombatRuntime,
  type CombatDependencies,
  type CombatEvent,
  type CombatTransition,
  type FightState,
  type LegalDecision,
} from "@dragonball-resurgence/combat-engine";
import {
  createAiRandomSource,
  type AiMechanicsView,
  type CandidateEvaluation,
} from "@dragonball-resurgence/ai-engine";

import { canonicalHash } from "./canonical.js";
import {
  type SimulationControl,
  type SimulationFailure,
  type SimulationFightExecutionResult,
  type SimulationFightRequest,
  type SimulationReplayRecord,
  type SimulationSummary,
} from "./contracts.js";
import { simulationFightRequestSchema } from "./contracts.js";
import { allocateSimulationSeed, simulationScenarioIdentityHash } from "./seeds.js";
import { materializeSimulationTemplate } from "./templates.js";
import { SIMULATION_AI_EVALUATOR_VERSION, selectSimulationDecision } from "./ai-selection.js";
import type { SimulationDecisionRecord } from "./ai-selection.js";
import { SIMULATION_SCOPE_VERSION } from "./scope.js";
import { runSimulationTransitionDriver } from "./transition-driver.js";
import type { SimulationMoveFunnel } from "./move-coverage.js";
import { selectForcedSimulationDecision } from "./exposure.js";

type MoveFunnelStage = Exclude<keyof SimulationMoveFunnel, "decisionFunnel" | "triggerFunnel">;

const mechanicsFor = (request: SimulationFightRequest): AiMechanicsView => ({
  version: request.mechanicsView.version,
  identity: request.mechanicsView.identity,
  moves: request.mechanicsView.moves,
  items: request.mechanicsView.items,
  transformations: request.mechanicsView.transformations,
});

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
    case "malformed-input":
    case "unknown-reference":
    case "incompatible-loadout":
    case "exhausted-safeguard":
    case "unexpected-runner-failure":
      return "invalid-fixture";
  }
};

const emptyReplayFor = (
  request: SimulationFightRequest,
  finalState: FightState,
): SimulationReplayRecord => {
  const manifest = {
    scopeVersion: SIMULATION_SCOPE_VERSION,
    runId: request.runId,
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
      terminationReason: "invalid-fixture",
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
    replay: emptyReplayFor(request, finalState),
  };
};

export const runSimulationFight = (
  request: SimulationFightRequest,
  control: SimulationControl = {},
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
    const pairId = canonicalHash({
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
      templateAHash: first.value.templateHash,
      templateBHash: second.value.templateHash,
      strategyAId: request.profileA.identity.id,
      strategyBId: request.profileB.identity.id,
    };
    const combatSeed = allocateSimulationSeed({ ...common, namespace: "combat" }).seed;
    const aiSeedA = allocateSimulationSeed({ ...common, namespace: "ai-a" }).seed;
    const aiSeedB = allocateSimulationSeed({ ...common, namespace: "ai-b" }).seed;
    const diagnosticsEnabled = request.scenario.retention === "diagnostic";
    const dependencies: CombatDependencies = {
      random: new SeededRandomSource(combatSeed),
      clock: new FixedClock(request.fixedTime),
      ids: new BranchCombatIdSource([request.runId, pairId]),
      retainDiagnosticTrace: diagnosticsEnabled,
      retainMechanicObservations: diagnosticsEnabled,
      mechanicsView: request.mechanicsView,
    };
    const runtime = createCombatRuntime(request.mechanicsView);
    const created = runtime.createFight(
      { mode: "spar", combatants: [first.value.input, second.value.input] },
      dependencies,
    );
    if (!created.ok)
      return failureResult(request, { type: "combat-failure", failure: created.error });
    const summaries = initialSummary();
    const seenResolutionKeys = new Set<string>();
    updateSummary(summaries, created.value.events, created.value.state);
    const evaluations: CandidateEvaluation[] = [];
    const aiRecords: { a?: SimulationDecisionRecord; b?: SimulationDecisionRecord } = {};
    const driver = runSimulationTransitionDriver({
      runtime,
      initial: created.value,
      dependencies,
      limits: request.scenario.limits,
      control,
      chooseDecision: (state, legalDecisions) => {
        if (state.status !== "active")
          return {
            error: {
              type: "unexpected-runner-failure",
              detail: "Completed state requested a decision.",
            },
          };
        const actorId = state.pendingDecision?.combatantId ?? state.activeCombatantId;
        const actorIsA = actorId === Object.keys(state.combatants)[0];
        summaries.pendingResponses += state.pendingDecision === undefined ? 0 : 1;
        const aiRequest = {
          state,
          actorId,
          legalDecisions,
          profile: actorIsA ? request.profileA : request.profileB,
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
            capabilities: {
              descriptors: true,
              expectedOutcomes: true,
              pruning: true,
              setupInference: true,
              lookaheadDepth: 2,
              opponentModeling: true,
              pendingExpansion: true,
            },
            describeDecision: runtime.describeDecision,
            probeDecision: (
              probeState: FightState,
              probeDecision: LegalDecision,
              probeDependencies?: CombatDependencies,
            ) =>
              runtime.probeDecision(probeState, probeDecision, probeDependencies ?? dependencies),
          },
          diagnosticRetention: diagnosticsEnabled ? ("full" as const) : ("none" as const),
        };
        const selected = selectSimulationDecision(aiRequest);
        if (!selected.ok) return { error: { type: "ai-failure", failure: selected.error } };
        const chosen: LegalDecision =
          request.decisionPolicy?.type === "forced-target-first"
            ? (selectForcedSimulationDecision(legalDecisions, request.decisionPolicy) ??
              selected.value.decision)
            : selected.value.decision;
        aiRecords[actorIsA ? "a" : "b"] = selected.value.simulationRecord;
        evaluations.push(...selected.value.evaluations);
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
        updateMoveFunnels(summaries.moveFunnels, seenResolutionKeys, {
          transition,
          decision,
          legalDecisions,
        });
      },
    });
    if (!driver.ok) return failureResult(request, driver.failure, driver.state);
    const state = driver.state;
    const decisionHashes = driver.decisions.map(canonicalHash);
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
    const summary: SimulationSummary = {
      ...summaries,
      moveUses: summaries.moveUses,
      itemUses: summaries.itemUses,
      damageByCombatant: summaries.damageByCombatant,
      resources: summaries.resources,
      statuses: summaries.statuses,
      perDieOutcomes: summaries.perDieOutcomes,
    };
    return {
      schemaVersion: "simulation-contracts:v1",
      runId: request.runId,
      scenarioId: request.scenario.id,
      pairId,
      finalState: state,
      completion: state.status === "completed" ? state.completion : undefined,
      terminationReason: driver.terminationReason,
      transitions: diagnosticsEnabled ? driver.transitions : [],
      summary,
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
      replay: replayFor({
        request,
        templateAHash: first.value.templateHash,
        templateBHash: second.value.templateHash,
        seeds: { combat: combatSeed, aiA: aiSeedA, aiB: aiSeedB },
        aiA: aiRecords.a,
        aiB: aiRecords.b,
        legalSetHashes: driver.legalSetHashes,
        decisions: driver.decisions,
        transitionHashes: driver.transitionHashes,
        stateHashes: driver.stateHashes,
        eventHashes: driver.eventHashes,
        result: {
          terminationReason: driver.terminationReason,
          stateHash: canonicalHash(state),
          summary,
        },
      }),
    };
  } catch (error) {
    return failureResult(request, {
      type: "unexpected-runner-failure",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};
