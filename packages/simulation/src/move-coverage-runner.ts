import {
  CANONICAL_COMBAT_MECHANICS_VIEW,
  type CombatMechanicsView,
} from "@dragonball-resurgence/combat-engine";
import {
  HARD_PROFILE,
  NORMAL_PROFILE,
  SIMULATION_QUALITY_PROFILE,
  type AiProfile,
} from "@dragonball-resurgence/ai-engine";
import type { MoveDefinition } from "@dragonball-resurgence/game-data";

import { aggregateSimulationCoverageCellStatus } from "./completion.js";
import {
  createSimulationCoverageCell,
  createSimulationCoverageMatrix,
  updateSimulationCoverageCell,
  type SimulationCoverageCell,
  type SimulationCoveragePopulation,
} from "./coverage.js";
import {
  createSimulationMoveCoverageArtifact,
  SIMULATION_NATURAL_POPULATION_BLOCKER,
  type SimulationMoveCoverageArtifact,
} from "./coverage-artifacts.js";
import type {
  SimulationFailure,
  SimulationFightRequest,
  SimulationLimits,
  SimulationTemplate,
} from "./contracts.js";
import {
  createSimulationMoveCoverageDataset,
  addSimulationMoveFunnels,
  aggregateSimulationMoveFunnels,
  createEmptySimulationMoveFunnel,
  recordSimulationMoveFunnel,
  SIMULATION_MOVE_COVERAGE_POPULATIONS,
  type SimulationMoveCoverageRecord,
  type SimulationPopulationFunnels,
  type SimulationMoveCoverageDataset,
  updateSimulationMoveCoverage,
  type SimulationMoveCoverageStatus,
} from "./move-coverage.js";
import { runSimulationRequests, runSimulationRequestsWithWorkers } from "./coordinator.js";
import { SIMULATION_NATURAL_AI_PROFILES, type SimulationNaturalAiProfile } from "./exposure.js";
import { createScenario } from "./scenarios.js";
import { approveAllSimulationTf1Overlays } from "./templates.js";
import {
  addSimulationMoveMetricObservation,
  createSimulationMoveMetrics,
  markSimulationMoveMetricError,
  mergeSimulationMoveMetrics,
  type SimulationMoveMetrics,
} from "./metrics.js";
import {
  addSimulationStratifiedObservation,
  createSimulationStratifiedAccumulator,
  markSimulationStratifiedError,
  mergeSimulationStratifiedAccumulators,
  type SimulationStratifiedAccumulator,
} from "./statistics.js";

const slugFor = (moveId: string): string => moveId.replaceAll(":", "-");

const policyForPopulation = (population: SimulationCoveragePopulation): string => {
  if (population === "forced") return "forced-target-first";
  if (population === "natural") return "natural-ai";
  return "simulation-quality";
};

const failureDetailFor = (failure: SimulationFailure): string => {
  if ("detail" in failure) return failure.detail;
  if (failure.type === "exhausted-safeguard") return failure.reason;
  return failure.type;
};

const statusForCoverageCells = (
  failures: readonly unknown[],
  decisionCell: SimulationCoverageCell,
  triggerCell: SimulationCoverageCell,
): SimulationMoveCoverageStatus => {
  if (failures.length > 0) return "runner-failure";
  if (decisionCell.status === "observed-sufficient" && triggerCell.status === "observed-sufficient")
    return "observed-sufficient";
  if (
    decisionCell.status === "eligible-never-selected" ||
    triggerCell.status === "eligible-never-selected"
  )
    return "eligible-never-selected";
  if (decisionCell.status === "unobserved" && triggerCell.status === "unobserved")
    return "never-eligible";
  return "observed-low-sample";
};

const failureTypeForCell = (
  failure: SimulationFailure,
): "invalid-fixture" | "runner-failure" | "ai-failure" | "combat-failure" | "not-scheduled" => {
  if (failure.type === "ai-failure" || failure.type === "combat-failure") return failure.type;
  if (
    failure.type === "malformed-input" ||
    failure.type === "unknown-reference" ||
    failure.type === "incompatible-loadout" ||
    failure.type === "unsupported-scope"
  )
    return "invalid-fixture";
  return "runner-failure";
};

const templateFor = (
  id: string,
  moveIds: readonly string[],
  styleId: string,
  view: CombatMechanicsView,
  maximumHitPoints: number,
): SimulationTemplate => {
  const template = {
    schemaVersion: "simulation-contracts:v1" as const,
    id,
    label: id,
    kind: "synthetic" as const,
    checkpointId: "early",
    source: {
      path: "simulation/generated-move-coverage",
      text: "Deterministic move coverage fixture",
      sourceKind: "synthetic" as const,
    },
    raceId: "race-humans",
    classId: "race-class-humans-average-in-the-extreme",
    styleId,
    mastery: "move-coverage",
    specializationPoints: 8,
    specializationPointsDistribution: { hp: 3, power: 3, dexterity: 2, total: 8 },
    startingKiPolicy: "rules-default" as const,
    maximumHitPoints,
    stats: { power: 60, dexterity: 30, dexterityBonus: 0 },
    raceTraitIds: [],
    moveIds: [...moveIds],
    itemIds: [],
    transformationProfiles: [],
    gaps: [],
    aiProfileId: SIMULATION_QUALITY_PROFILE.identity.id,
  } satisfies SimulationTemplate;
  for (const moveId of moveIds)
    if (!view.indexes.moves.has(moveId)) throw new RangeError(`Unknown coverage move: ${moveId}.`);
  return template;
};

const naturalProfileFor = (profileId: SimulationNaturalAiProfile): AiProfile => {
  switch (profileId) {
    case "profile:normal":
      return NORMAL_PROFILE;
    case "profile:hard":
      return HARD_PROFILE;
    case "profile:simulation-quality":
      return SIMULATION_QUALITY_PROFILE;
  }
};

const naturalTemplatePairFor = (
  move: MoveDefinition,
  iteration: number,
  templates: readonly SimulationTemplate[],
): readonly [SimulationTemplate, SimulationTemplate] => {
  const candidates = templates
    .filter((template) => template.moveIds.includes(move.id))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (candidates.length === 0)
    throw new RangeError(`No approved TF1 overlay equips ${move.id} for natural exposure.`);
  const attacker = candidates[iteration % candidates.length]!;
  const opponent = templates.find((template) => template.id !== attacker.id) ?? candidates[0]!;
  return [attacker, opponent];
};

const requestFor = (
  move: MoveDefinition,
  iteration: number,
  rootSeed: number,
  fixedTime: Date,
  view: CombatMechanicsView,
  population: SimulationCoveragePopulation,
  naturalTemplates: readonly SimulationTemplate[] | undefined,
  naturalProfile: AiProfile,
  limits: SimulationLimits,
  mirror: "original" | "mirrored",
): SimulationFightRequest => {
  const slug = slugFor(move.id);
  const [attackerTemplate, opponentTemplate] =
    population === "natural"
      ? naturalTemplatePairFor(move, iteration, naturalTemplates ?? [])
      : [
          templateFor(
            `simulation-template:coverage-${slug}-attacker`,
            [move.id],
            move.styleId ?? "style-freestyle",
            view,
            220,
          ),
          templateFor(
            `simulation-template:coverage-${slug}-opponent`,
            [],
            "style-freestyle",
            view,
            220,
          ),
        ];
  const mirrored = mirror === "mirrored";
  const templateA = mirrored ? opponentTemplate : attackerTemplate;
  const templateB = mirrored ? attackerTemplate : opponentTemplate;
  const scenario = createScenario({
    id: `simulation-scenario:move-isolation-${slug}-${iteration + 1}-${mirror}`,
    family: "move-isolation",
    checkpointId: "early",
    templateAId: templateA.id,
    templateBId: templateB.id,
    variantId: "simulation-variant:baseline",
    retention: "diagnostic",
    limits,
    stoppingPolicy: "continue",
    deferred: false,
  });
  return {
    schemaVersion: "simulation-contracts:v1",
    runId: `simulation-run:move-coverage-${slug}-${iteration + 1}-${mirror}`,
    scenario,
    templateA,
    templateB,
    profileA: population === "natural" ? naturalProfile : SIMULATION_QUALITY_PROFILE,
    profileB: population === "natural" ? naturalProfile : SIMULATION_QUALITY_PROFILE,
    rootSeed,
    iteration,
    mirror,
    fixedTime,
    mechanicsView: view,
    ...(population === "forced"
      ? {
          decisionPolicy: {
            type: "forced-target-first" as const,
            targetDefinitionId: move.id,
            fallback: "first-legal" as const,
          },
        }
      : {}),
  };
};

export interface SimulationMoveCoverageRunOptions {
  readonly mechanicsView?: CombatMechanicsView;
  readonly rootSeed?: number;
  readonly fixedTime?: Date;
  readonly targetFights?: number;
  readonly minimumEligibleStates?: number;
  readonly concurrency?: number;
  readonly workers?: number;
  readonly moveIds?: readonly string[];
  readonly population?: SimulationCoveragePopulation;
  readonly naturalOverlayApprovalReference?: string;
  readonly naturalProfileId?: SimulationNaturalAiProfile;
  /** Continue one population artifact at a later precision look. */
  readonly resumeFrom?: SimulationMoveCoverageArtifact;
  /** Retry failed runs at the current precision look and replace their errors. */
  readonly retryFailed?: boolean;
  /** Optional bounded limits for focused probes; production coverage uses defaults. */
  readonly limits?: SimulationLimits;
}

export interface SimulationMoveCoverageRunResult {
  readonly artifact: SimulationMoveCoverageArtifact;
  readonly runCount: number;
  readonly failedRunCount: number;
  readonly failureTypes: Readonly<Partial<Record<SimulationFailure["type"], number>>>;
  readonly failures: readonly {
    readonly moveId: string;
    readonly runId: string;
    readonly failure: SimulationFailure;
  }[];
}

type CoveragePath = "decision" | "trigger";

interface CoveragePathCounts {
  eligible: number;
  selected: number;
  triggered: number;
}

interface MoveCoverageFailure {
  readonly moveId: string;
  readonly runId: string;
  readonly failure: SimulationFailure;
}

interface MoveCoverageAccumulation {
  dataset: SimulationMoveCoverageDataset;
  runCount: number;
  failedRunCount: number;
  failureTypes: Partial<Record<SimulationFailure["type"], number>>;
  failures: MoveCoverageFailure[];
  failuresByMove: Map<string, MoveCoverageFailure[]>;
  attemptedFightsByMove: Map<string, number>;
  representativeReplaySeedsByMove: Map<string, Set<number>>;
  metricsByMove: Map<string, SimulationMoveMetrics>;
  stratifiedAccumulators: Map<string, SimulationStratifiedAccumulator>;
}

type CoordinatedResult = ReturnType<typeof runSimulationRequests>["results"][number];
type SuccessfulCoordinatedResult = Extract<CoordinatedResult, { readonly ok: true }>;
type PairWinner = "a" | "b" | "draw";

interface PlannedCoverageRequest {
  readonly move: MoveDefinition;
  readonly request: SimulationFightRequest;
}

interface CoveragePairResult {
  readonly request: SimulationFightRequest;
  readonly result: CoordinatedResult;
}

const accumulateFunnelCounts = (
  countsByPath: Map<CoveragePath, CoveragePathCounts>,
  funnel: NonNullable<NonNullable<SimulationMoveCoverageDataset["records"][number]["funnel"]>>,
) => {
  const decision = countsByPath.get("decision") ?? { eligible: 0, selected: 0, triggered: 0 };
  countsByPath.set("decision", {
    eligible: decision.eligible + funnel.decisionFunnel.eligible,
    selected: decision.selected + funnel.decisionFunnel.selected,
    triggered: decision.triggered,
  });
  const trigger = countsByPath.get("trigger") ?? { eligible: 0, selected: 0, triggered: 0 };
  countsByPath.set("trigger", {
    eligible: trigger.eligible + funnel.triggerFunnel.applicable,
    selected: trigger.selected,
    triggered: trigger.triggered + funnel.triggerFunnel.triggered,
  });
};

const accumulateMoveResult = (
  accumulation: MoveCoverageAccumulation,
  move: MoveDefinition,
  runId: string,
  result: ReturnType<typeof runSimulationRequests>["results"][number],
  countsByPath: Map<CoveragePath, CoveragePathCounts>,
  targetFights: number,
  minimumEligibleStates: number,
  population: SimulationCoveragePopulation,
) => {
  accumulation.runCount += 1;
  if (!result.ok) {
    accumulation.failedRunCount += 1;
    accumulation.failureTypes[result.error.type] =
      (accumulation.failureTypes[result.error.type] ?? 0) + 1;
    const failure = { moveId: move.id, runId, failure: result.error };
    accumulation.failures.push(failure);
    const moveFailures = accumulation.failuresByMove.get(move.id) ?? [];
    moveFailures.push(failure);
    accumulation.failuresByMove.set(move.id, moveFailures);
    const metric =
      accumulation.metricsByMove.get(move.id) ?? createSimulationMoveMetrics(move.id, population);
    accumulation.metricsByMove.set(move.id, markSimulationMoveMetricError(metric));
    return;
  }
  const metric =
    accumulation.metricsByMove.get(move.id) ?? createSimulationMoveMetrics(move.id, population);
  accumulation.metricsByMove.set(
    move.id,
    addSimulationMoveMetricObservation(metric, {
      result: result.value,
      mirror: result.value.replay.manifest.scenario.id.endsWith("-mirrored")
        ? "mirrored"
        : "original",
      policy: policyForPopulation(population),
    }),
  );
  const representativeSeeds =
    accumulation.representativeReplaySeedsByMove.get(move.id) ?? new Set();
  representativeSeeds.add(result.value.replay.manifest.seeds.combat);
  accumulation.representativeReplaySeedsByMove.set(move.id, representativeSeeds);
  const funnel = result.value.diagnostics?.moveFunnels[move.id];
  if (funnel === undefined) return;
  accumulateFunnelCounts(countsByPath, funnel);
  accumulation.dataset = recordSimulationMoveFunnel(
    accumulation.dataset,
    { [move.id]: funnel },
    population,
    { targetFights, minimumEligibleStates },
  );
};

const executionCellsForMove = ({
  move,
  cells,
  countsByPath,
  completedFights,
  failures,
  population,
}: {
  readonly move: MoveDefinition;
  readonly cells: Map<string, SimulationCoverageCell>;
  readonly countsByPath: Map<CoveragePath, CoveragePathCounts>;
  readonly completedFights: number;
  readonly failures: readonly MoveCoverageFailure[];
  readonly population: SimulationCoveragePopulation;
}) => {
  for (const mechanicPath of ["decision", "trigger"] as const) {
    const key = `${move.id}:${mechanicPath}`;
    const cell = cells.get(key);
    if (cell === undefined) throw new RangeError(`Missing ${population} cell for ${key}.`);
    const counts = countsByPath.get(mechanicPath) ?? { eligible: 0, selected: 0, triggered: 0 };
    const updated = updateSimulationCoverageCell(cell, {
      completedFights: cell.completedFights + completedFights,
      eligibleStates: cell.eligibleStates + counts.eligible,
      selectedStates: cell.selectedStates + counts.selected,
      triggeredStates: cell.triggeredStates + counts.triggered,
    });
    cells.set(
      key,
      failures.length === 0
        ? updated
        : createSimulationCoverageCell({
            ...updated,
            status: "runner-failure",
            failureType: failureTypeForCell(failures[0]!.failure),
          }),
    );
  }
};

const winnerByPositionFor = (result: SuccessfulCoordinatedResult): PairWinner => {
  const ids = Object.values(result.value.finalState.combatants).map((combatant) =>
    String(combatant.id),
  );
  const winner = result.value.completion?.winnerCombatantId;
  if (winner !== undefined && String(winner) === ids[0]) return "a";
  if (winner !== undefined && String(winner) === ids[1]) return "b";
  return "draw";
};

const targetWinnerFor = (
  result: SuccessfulCoordinatedResult,
  mirror: "original" | "mirrored",
): PairWinner => {
  const winner = winnerByPositionFor(result);
  if (mirror === "original" || winner === "draw") return winner;
  return winner === "a" ? "b" : "a";
};

const outgoingDamageFor = (result: SuccessfulCoordinatedResult, position: "a" | "b"): number => {
  const ids = Object.values(result.value.finalState.combatants).map((combatant) =>
    String(combatant.id),
  );
  const targetId = position === "a" ? ids[1] : ids[0];
  return result.value.summary.damageByCombatant[targetId ?? ""] ?? 0;
};

const accumulateStratifiedPair = (
  accumulation: MoveCoverageAccumulation,
  move: MoveDefinition,
  results: readonly CoordinatedResult[],
  requests: readonly SimulationFightRequest[],
  population: SimulationCoveragePopulation,
): void => {
  let accumulator =
    accumulation.stratifiedAccumulators.get(move.id) ??
    createSimulationStratifiedAccumulator(`${population}:${move.id}`);
  const original = results[0];
  const mirrored = results[1];
  if (original?.ok !== true || mirrored?.ok !== true) {
    accumulation.stratifiedAccumulators.set(move.id, markSimulationStratifiedError(accumulator));
    return;
  }
  if (original.value.pairId !== mirrored.value.pairId) {
    accumulation.stratifiedAccumulators.set(move.id, markSimulationStratifiedError(accumulator));
    return;
  }
  const originalMirror = requests[0]?.mirror ?? "original";
  const mirroredMirror = requests[1]?.mirror ?? "mirrored";
  const winners = [
    targetWinnerFor(original, originalMirror),
    targetWinnerFor(mirrored, mirroredMirror),
  ];
  const targetWins = winners.filter((winner) => winner === "a").length;
  const controlWins = winners.filter((winner) => winner === "b").length;
  let winner: "a" | "b" | "draw" = "draw";
  if (targetWins > controlWins) winner = "a";
  if (controlWins > targetWins) winner = "b";
  const damageA = (outgoingDamageFor(original, "a") + outgoingDamageFor(mirrored, "b")) / 2;
  const damageB = (outgoingDamageFor(original, "b") + outgoingDamageFor(mirrored, "a")) / 2;
  accumulator = addSimulationStratifiedObservation(accumulator, {
    pairId: original.value.pairId,
    winner,
    turns: Math.round(
      (original.value.finalState.turnNumber + mirrored.value.finalState.turnNumber) / 2,
    ),
    damageA,
    damageB,
    primaryDifference: damageA - damageB,
    representativeSeed: original.value.replay.manifest.seeds.combat,
  });
  accumulation.stratifiedAccumulators.set(move.id, accumulator);
};

const coverageRequestsForMove = ({
  move,
  view,
  rootSeed,
  fixedTime,
  targetFights,
  population,
  naturalTemplates,
  naturalProfile,
  limits,
  priorAttempts,
  accumulation,
}: {
  readonly move: MoveDefinition;
  readonly view: CombatMechanicsView;
  readonly rootSeed: number;
  readonly fixedTime: Date;
  readonly targetFights: number;
  readonly population: SimulationCoveragePopulation;
  readonly naturalTemplates: readonly SimulationTemplate[] | undefined;
  readonly naturalProfile: AiProfile;
  readonly limits: SimulationLimits;
  readonly priorAttempts: number;
  readonly accumulation: MoveCoverageAccumulation;
}): readonly PlannedCoverageRequest[] => {
  const iterationOffset = Math.floor(priorAttempts / 2);
  const remainingAttempts = Math.max(0, targetFights * 2 - priorAttempts);
  const requests = Array.from({ length: remainingAttempts }, (_, index) => {
    const iteration = iterationOffset + Math.floor(index / 2);
    const mirror = index % 2 === 0 ? "original" : "mirrored";
    return requestFor(
      move,
      iteration,
      rootSeed,
      fixedTime,
      view,
      population,
      naturalTemplates,
      naturalProfile,
      limits,
      mirror,
    );
  });
  accumulation.attemptedFightsByMove.set(move.id, priorAttempts + requests.length);
  return requests.map((request) => ({ move, request }));
};

const processCoverageResult = ({
  plan,
  result,
  accumulation,
  countsByMove,
  completedFightsByMove,
  pairsByMove,
  targetFights,
  minimumEligibleStates,
  population,
}: {
  readonly plan: PlannedCoverageRequest;
  readonly result: CoordinatedResult;
  readonly accumulation: MoveCoverageAccumulation;
  readonly countsByMove: Map<string, Map<CoveragePath, CoveragePathCounts>>;
  readonly completedFightsByMove: Map<string, number>;
  readonly pairsByMove: Map<string, CoveragePairResult[]>;
  readonly targetFights: number;
  readonly minimumEligibleStates: number;
  readonly population: SimulationCoveragePopulation;
}): void => {
  const countsByPath =
    countsByMove.get(plan.move.id) ?? new Map<CoveragePath, CoveragePathCounts>();
  countsByMove.set(plan.move.id, countsByPath);
  accumulateMoveResult(
    accumulation,
    plan.move,
    plan.request.runId,
    result,
    countsByPath,
    targetFights,
    minimumEligibleStates,
    population,
  );
  if (result.ok)
    completedFightsByMove.set(plan.move.id, (completedFightsByMove.get(plan.move.id) ?? 0) + 1);
  const pair = pairsByMove.get(plan.move.id) ?? [];
  pair.push({ request: plan.request, result });
  if (pair.length === 2) {
    accumulateStratifiedPair(
      accumulation,
      plan.move,
      pair.map((entry) => entry.result),
      pair.map((entry) => entry.request),
      population,
    );
    pairsByMove.delete(plan.move.id);
  } else pairsByMove.set(plan.move.id, pair);
};

interface CoverageRequestBatchResult {
  readonly countsByMove: Map<string, Map<CoveragePath, CoveragePathCounts>>;
  readonly completedFightsByMove: Map<string, number>;
  readonly pairsByMove: Map<string, CoveragePairResult[]>;
}

const runCoverageRequestBatch = ({
  plannedRequests,
  options,
  accumulation,
  targetFights,
  minimumEligibleStates,
  population,
}: {
  readonly plannedRequests: readonly PlannedCoverageRequest[];
  readonly options: SimulationMoveCoverageRunOptions;
  readonly accumulation: MoveCoverageAccumulation;
  readonly targetFights: number;
  readonly minimumEligibleStates: number;
  readonly population: SimulationCoveragePopulation;
}): CoverageRequestBatchResult => {
  const countsByMove = new Map<string, Map<CoveragePath, CoveragePathCounts>>();
  const completedFightsByMove = new Map<string, number>();
  const pairsByMove = new Map<string, CoveragePairResult[]>();
  const requestIndexByRunId = new Map(
    plannedRequests.map((plan, index) => [plan.request.runId, index]),
  );
  if (requestIndexByRunId.size !== plannedRequests.length)
    throw new RangeError("Coverage requests must have unique run IDs.");
  const pendingResults = new Map<number, CoordinatedResult>();
  let nextResultIndex = 0;
  const consumeProgress = (progress: {
    readonly runId: string;
    readonly result: CoordinatedResult;
  }) => {
    const index = requestIndexByRunId.get(progress.runId);
    if (index === undefined) throw new RangeError(`Unknown coverage result ${progress.runId}.`);
    pendingResults.set(index, progress.result);
    while (pendingResults.has(nextResultIndex)) {
      const result = pendingResults.get(nextResultIndex)!;
      pendingResults.delete(nextResultIndex);
      processCoverageResult({
        plan: plannedRequests[nextResultIndex]!,
        result,
        accumulation,
        countsByMove,
        completedFightsByMove,
        pairsByMove,
        targetFights,
        minimumEligibleStates,
        population,
      });
      nextResultIndex += 1;
    }
  };
  if (plannedRequests.length > 0) {
    const requests = plannedRequests.map((plan) => plan.request);
    const coordinated =
      options.workers === undefined
        ? runSimulationRequests({
            requests,
            stoppingPolicy: "continue",
            concurrency: options.concurrency ?? 4,
            retainResults: false,
            onProgress: consumeProgress,
          })
        : runSimulationRequestsWithWorkers({
            requests,
            stoppingPolicy: "continue",
            workers: options.workers,
            retainResults: false,
            onProgress: consumeProgress,
          });
    if (coordinated.stoppedEarly) throw new Error("Coverage coordinator stopped unexpectedly.");
  }
  if (pendingResults.size !== 0 || nextResultIndex !== plannedRequests.length)
    throw new Error("Coverage coordinator did not stream every planned result.");
  return { countsByMove, completedFightsByMove, pairsByMove };
};

const finalizedDataset = (
  view: CombatMechanicsView,
  dataset: SimulationMoveCoverageDataset,
  executionCells: Map<string, SimulationCoverageCell>,
  population: SimulationCoveragePopulation,
  failuresByMove: ReadonlyMap<string, readonly MoveCoverageFailure[]>,
) =>
  createSimulationMoveCoverageDataset(
    view,
    dataset.records.map((record) => {
      const decisionCell = executionCells.get(`${record.moveId}:decision`);
      const triggerCell = executionCells.get(`${record.moveId}:trigger`);
      if (decisionCell === undefined || triggerCell === undefined)
        throw new RangeError(`Missing ${population} cells for ${record.moveId}.`);
      const failures = failuresByMove.get(record.moveId) ?? [];
      const executionStatus = statusForCoverageCells(failures, decisionCell, triggerCell);
      return updateSimulationMoveCoverage(record, record.funnel, {
        ...(population === "natural"
          ? { naturalStatus: executionStatus }
          : {
              naturalStatus: "not-scheduled" as const,
              ...(population === "forced"
                ? { forcedStatus: executionStatus }
                : { isolationStatus: executionStatus }),
            }),
      });
    }),
  );

const finalCoverageCells = (
  naturalCells: ReadonlyMap<string, SimulationCoverageCell>,
  executionCells: ReadonlyMap<string, SimulationCoverageCell>,
  population: SimulationCoveragePopulation,
) =>
  Object.freeze(
    [...new Map([...naturalCells, ...executionCells]).values()]
      .map((cell) =>
        cell.population === "natural" && population !== "natural"
          ? createSimulationCoverageCell({ ...cell, status: "not-scheduled" })
          : cell,
      )
      .sort((left, right) => left.cellId.localeCompare(right.cellId)),
  );

const coverageCellKey = (
  cell: Pick<
    SimulationCoverageCell,
    "moveId" | "scenarioFamily" | "checkpointId" | "population" | "mechanicPath"
  >,
): string =>
  [cell.moveId, cell.scenarioFamily, cell.checkpointId, cell.population, cell.mechanicPath].join(
    ":",
  );

const seededCoverageCells = (
  cells: readonly SimulationCoverageCell[],
  resumeFrom: SimulationMoveCoverageArtifact | undefined,
): readonly SimulationCoverageCell[] => {
  if (resumeFrom === undefined) return cells;
  const priorCells = new Map(resumeFrom.coverageCells.map((cell) => [coverageCellKey(cell), cell]));
  return cells.map((cell) => {
    const prior = priorCells.get(coverageCellKey(cell));
    return prior === undefined
      ? cell
      : updateSimulationCoverageCell(cell, {
          completedFights: prior.completedFights,
          eligibleStates: prior.eligibleStates,
          selectedStates: prior.selectedStates,
          triggeredStates: prior.triggeredStates,
        });
  });
};

const previousPopulationRunCountFor = (
  resumeFrom: SimulationMoveCoverageArtifact | undefined,
  population: SimulationCoveragePopulation,
): number => {
  if (resumeFrom === undefined) return 0;
  return (
    resumeFrom.generatedFrom.populationRunCounts?.[population] ??
    (resumeFrom.generatedFrom.population === population
      ? resumeFrom.generatedFrom.isolationRunCount
      : 0)
  );
};

const previousAttemptsForMove = (
  resumeFrom: SimulationMoveCoverageArtifact | undefined,
  population: SimulationCoveragePopulation,
  moveId: string,
): number => {
  if (resumeFrom === undefined) return 0;
  const persisted =
    resumeFrom.generatedFrom.populationAttemptedFightsByMove?.[population]?.[moveId];
  if (persisted !== undefined) return persisted;
  const decisionCell = resumeFrom.coverageCells.find(
    (cell) =>
      cell.moveId === moveId && cell.population === population && cell.mechanicPath === "decision",
  );
  return (
    (decisionCell?.completedFights ?? 0) +
    resumeFrom.errors.filter(
      (error) =>
        error.moveId === moveId && legacyErrorPopulationFor(resumeFrom, error) === population,
    ).length
  );
};

const hasRetryableFailureForMove = (
  resumeFrom: SimulationMoveCoverageArtifact | undefined,
  population: SimulationCoveragePopulation,
  moveId: string,
): boolean =>
  resumeFrom?.errors.some(
    (error) =>
      error.moveId === moveId && legacyErrorPopulationFor(resumeFrom, error) === population,
  ) === true ||
  resumeFrom?.coverageCells.some(
    (cell) =>
      cell.moveId === moveId &&
      cell.population === population &&
      (cell.status === "invalid-fixture" || cell.status === "runner-failure"),
  ) === true;

const attemptedFightsByPopulationFor = (
  view: CombatMechanicsView,
  population: SimulationCoveragePopulation,
  resumeFrom: SimulationMoveCoverageArtifact | undefined,
  accumulation: MoveCoverageAccumulation,
): Readonly<Record<SimulationCoveragePopulation, Readonly<Record<string, number>>>> => {
  const mapFor = (candidate: SimulationCoveragePopulation) =>
    Object.fromEntries(
      view.moves.map((move) => [
        move.id,
        candidate === population
          ? (accumulation.attemptedFightsByMove.get(move.id) ??
            previousAttemptsForMove(resumeFrom, candidate, move.id))
          : previousAttemptsForMove(resumeFrom, candidate, move.id),
      ]),
    );
  return {
    natural: mapFor("natural"),
    isolation: mapFor("isolation"),
    forced: mapFor("forced"),
  };
};

const representativeReplaySeedsByPopulationFor = (
  view: CombatMechanicsView,
  population: SimulationCoveragePopulation,
  resumeFrom: SimulationMoveCoverageArtifact | undefined,
  accumulation: MoveCoverageAccumulation,
): Readonly<Record<SimulationCoveragePopulation, Readonly<Record<string, readonly number[]>>>> => {
  const mapFor = (candidate: SimulationCoveragePopulation) =>
    Object.fromEntries(
      view.moves.map((move) => {
        const prior =
          resumeFrom?.generatedFrom.representativeReplaySeedsByMove?.[candidate]?.[move.id] ?? [];
        const current =
          candidate === population
            ? [...(accumulation.representativeReplaySeedsByMove.get(move.id) ?? [])]
            : [];
        return [
          move.id,
          [...new Set([...prior, ...current])].sort((left, right) => left - right).slice(0, 8),
        ];
      }),
    );
  return {
    natural: mapFor("natural"),
    isolation: mapFor("isolation"),
    forced: mapFor("forced"),
  };
};

const validateCoverageResume = (
  resumeFrom: SimulationMoveCoverageArtifact | undefined,
  population: SimulationCoveragePopulation,
  targetFights: number,
  minimumEligibleStates: number,
  mechanicsView: CombatMechanicsView,
  rootSeed: number,
  fixedTime: Date,
  retryFailed: boolean,
): void => {
  if (resumeFrom === undefined) return;
  if (resumeFrom.generatedFrom.population !== population)
    throw new RangeError("Coverage resume requires an artifact for the selected population.");
  if (resumeFrom.dataset.mechanicsIdentity !== mechanicsView.identity.contentHash)
    throw new RangeError("Coverage resume requires the same mechanics identity.");
  if (resumeFrom.generatedFrom.scenarioFamily !== "move-isolation")
    throw new RangeError("Coverage resume requires the move-isolation scenario family.");
  if (
    targetFights <= resumeFrom.generatedFrom.targetFights &&
    !(retryFailed && targetFights === resumeFrom.generatedFrom.targetFights)
  )
    throw new RangeError("Coverage resume target must advance to a later precision look.");
  if (minimumEligibleStates < resumeFrom.generatedFrom.minimumEligibleStates)
    throw new RangeError("Coverage resume cannot lower the eligible-state threshold.");
  if (
    resumeFrom.generatedFrom.rootSeed !== undefined &&
    resumeFrom.generatedFrom.rootSeed !== rootSeed
  )
    throw new RangeError("Coverage resume requires the original root seed.");
  if (
    resumeFrom.generatedFrom.fixedTime !== undefined &&
    resumeFrom.generatedFrom.fixedTime !== fixedTime.toISOString()
  )
    throw new RangeError("Coverage resume requires the original fixed time.");
};

const selectedMovesFor = (
  options: SimulationMoveCoverageRunOptions,
  view: CombatMechanicsView,
  resumeFrom: SimulationMoveCoverageArtifact | undefined,
  population: SimulationCoveragePopulation,
): readonly MoveDefinition[] => {
  if (options.moveIds === undefined) {
    return resumeFrom === undefined
      ? [...view.moves]
      : view.moves.filter((move) => previousAttemptsForMove(resumeFrom, population, move.id) > 0);
  }
  return options.moveIds.map((moveId) => {
    const move = view.indexes.moves.get(moveId);
    if (move === undefined) throw new RangeError(`Unknown coverage move: ${moveId}.`);
    return move;
  });
};

/**
 * Executes deterministic isolation runs for every public move. The only
 * outcome source is the normal simulation runner; this operation merely
 * reduces its diagnostic funnel into a canonical artifact.
 */
export const runSimulationMoveCoverage = (
  options: SimulationMoveCoverageRunOptions = {},
): SimulationMoveCoverageRunResult => {
  const view = options.mechanicsView ?? CANONICAL_COMBAT_MECHANICS_VIEW;
  const resumeFrom = options.resumeFrom;
  const persistedFixedTime =
    resumeFrom?.generatedFrom.fixedTime === undefined
      ? undefined
      : new Date(resumeFrom.generatedFrom.fixedTime);
  const rootSeed = options.rootSeed ?? resumeFrom?.generatedFrom.rootSeed ?? 1_427_251_991;
  const fixedTime = options.fixedTime ?? persistedFixedTime ?? new Date("2026-01-01T00:00:00.000Z");
  const targetFights = options.targetFights ?? 250;
  const minimumEligibleStates = options.minimumEligibleStates ?? 250;
  const population = options.population ?? "isolation";
  validateCoverageResume(
    resumeFrom,
    population,
    targetFights,
    minimumEligibleStates,
    view,
    rootSeed,
    fixedTime,
    options.retryFailed === true,
  );
  if (persistedFixedTime !== undefined && Number.isNaN(persistedFixedTime.valueOf()))
    throw new RangeError("Coverage resume manifest contains an invalid fixed time.");
  const naturalApprovalReference =
    options.naturalOverlayApprovalReference ??
    resumeFrom?.generatedFrom.naturalOverlayApprovalReference;
  const naturalProfileId =
    options.naturalProfileId ??
    (resumeFrom?.generatedFrom.naturalProfileId as SimulationNaturalAiProfile | undefined) ??
    SIMULATION_NATURAL_AI_PROFILES[2];
  const naturalTemplates =
    population === "natural"
      ? approveAllSimulationTf1Overlays(naturalApprovalReference ?? "")
      : undefined;
  const naturalProfile = naturalProfileFor(naturalProfileId);
  const limits =
    options.limits ??
    ({
      maximumTurns: 30,
      maximumTransitions: 500,
      semanticNoProgressLimit: 20,
    } satisfies SimulationLimits);
  let dataset = resumeFrom?.dataset ?? createSimulationMoveCoverageDataset(view);
  const cells = seededCoverageCells(
    createSimulationCoverageMatrix(dataset, ["move-isolation"], "early", {
      targetFights,
      minimumEligibleStates,
      populations: Array.from(new Set<SimulationCoveragePopulation>(["natural", population])),
      mechanicPaths: ["decision", "trigger"],
    }),
    resumeFrom,
  );
  const naturalCells = new Map(
    cells
      .filter((cell) => cell.population === "natural")
      .map((cell) => [`${cell.moveId}:${cell.mechanicPath}`, cell]),
  );
  const executionCells = new Map(
    cells
      .filter((cell) => cell.population === population)
      .map((cell) => [`${cell.moveId}:${cell.mechanicPath}`, cell]),
  );
  const accumulation: MoveCoverageAccumulation = {
    dataset,
    runCount: 0,
    failedRunCount: 0,
    failureTypes: {},
    failures: [],
    failuresByMove: new Map(),
    attemptedFightsByMove: new Map(),
    representativeReplaySeedsByMove: new Map(),
    metricsByMove: new Map(
      view.moves.map((move) => [
        move.id,
        resumeFrom?.metricsByMove?.[population]?.[move.id] ??
          createSimulationMoveMetrics(move.id, population),
      ]),
    ),
    stratifiedAccumulators: new Map(
      view.moves.map((move) => [
        move.id,
        resumeFrom?.stratifiedAccumulators?.[population]?.[move.id] ??
          createSimulationStratifiedAccumulator(`${population}:${move.id}`),
      ]),
    ),
  };
  const selectedMoves = selectedMovesFor(options, view, resumeFrom, population);
  const orderedMoves = [...selectedMoves].sort((left, right) => left.id.localeCompare(right.id));
  const plannedRequests = orderedMoves.flatMap((move) =>
    coverageRequestsForMove({
      move,
      view,
      rootSeed,
      fixedTime,
      targetFights,
      population,
      naturalTemplates,
      naturalProfile,
      limits,
      priorAttempts:
        options.retryFailed === true && hasRetryableFailureForMove(resumeFrom, population, move.id)
          ? 0
          : previousAttemptsForMove(resumeFrom, population, move.id),
      accumulation,
    }),
  );
  const { countsByMove, completedFightsByMove, pairsByMove } = runCoverageRequestBatch({
    plannedRequests,
    options,
    accumulation,
    targetFights,
    minimumEligibleStates,
    population,
  });
  for (const move of orderedMoves) {
    const pair = pairsByMove.get(move.id);
    if (pair !== undefined)
      accumulateStratifiedPair(
        accumulation,
        move,
        pair.map((entry) => entry.result),
        pair.map((entry) => entry.request),
        population,
      );
    executionCellsForMove({
      move,
      cells: executionCells,
      countsByPath: countsByMove.get(move.id) ?? new Map<CoveragePath, CoveragePathCounts>(),
      completedFights: completedFightsByMove.get(move.id) ?? 0,
      failures: accumulation.failuresByMove.get(move.id) ?? [],
      population,
    });
  }
  dataset = finalizedDataset(
    view,
    accumulation.dataset,
    executionCells,
    population,
    accumulation.failuresByMove,
  );
  const finalCells = finalCoverageCells(naturalCells, executionCells, population);
  const populationRunCounts = {
    natural: previousPopulationRunCountFor(resumeFrom, "natural"),
    isolation: previousPopulationRunCountFor(resumeFrom, "isolation"),
    forced: previousPopulationRunCountFor(resumeFrom, "forced"),
  };
  populationRunCounts[population] += accumulation.runCount;
  const populationAttemptedFightsByMove = attemptedFightsByPopulationFor(
    view,
    population,
    resumeFrom,
    accumulation,
  );
  const representativeReplaySeedsByMove = representativeReplaySeedsByPopulationFor(
    view,
    population,
    resumeFrom,
    accumulation,
  );
  const metricsByMove = Object.fromEntries(
    SIMULATION_MOVE_COVERAGE_POPULATIONS.map((candidate) => [
      candidate,
      Object.fromEntries(
        view.moves.map((move) => [
          move.id,
          candidate === population
            ? (accumulation.metricsByMove.get(move.id) ??
              createSimulationMoveMetrics(move.id, candidate))
            : (resumeFrom?.metricsByMove?.[candidate]?.[move.id] ??
              createSimulationMoveMetrics(move.id, candidate)),
        ]),
      ),
    ]),
  ) as SimulationMoveCoverageArtifact["metricsByMove"];
  const stratifiedAccumulators = Object.fromEntries(
    SIMULATION_MOVE_COVERAGE_POPULATIONS.map((candidate) => [
      candidate,
      Object.fromEntries(
        view.moves.map((move) => [
          move.id,
          candidate === population
            ? (accumulation.stratifiedAccumulators.get(move.id) ??
              createSimulationStratifiedAccumulator(`${candidate}:${move.id}`))
            : (resumeFrom?.stratifiedAccumulators?.[candidate]?.[move.id] ??
              createSimulationStratifiedAccumulator(`${candidate}:${move.id}`)),
        ]),
      ),
    ]),
  ) as SimulationMoveCoverageArtifact["stratifiedAccumulators"];
  const selectedMoveIds = new Set(selectedMoves.map((move) => move.id));
  const priorErrors = (resumeFrom?.errors ?? []).filter(
    (error) => options.retryFailed !== true || !selectedMoveIds.has(error.moveId),
  );
  const errors = [
    ...priorErrors,
    ...accumulation.failures.map(({ moveId, runId, failure }) => ({
      moveId,
      runId,
      population,
      type: failure.type,
      detail: failureDetailFor(failure),
    })),
  ];
  const artifact = createSimulationMoveCoverageArtifact({
    generatedFrom: {
      mechanicsIdentity: view.identity.contentHash,
      scenarioFamily: "move-isolation",
      checkpointId: "early",
      targetFights,
      minimumEligibleStates,
      isolationRunCount: Math.max(populationRunCounts.isolation, 1),
      population,
      populationRunCounts,
      populationAttemptedFightsByMove,
      representativeReplaySeedsByMove,
      rootSeed,
      fixedTime: fixedTime.toISOString(),
      naturalPopulation: population === "natural" ? "approved" : "draft",
      ...(population === "natural"
        ? {}
        : { naturalPopulationBlocker: SIMULATION_NATURAL_POPULATION_BLOCKER }),
      mechanicPaths: ["decision", "trigger"],
      source: "simulation-move-coverage-runner:v2",
      ...(population === "natural"
        ? {
            naturalProfileId,
            naturalOverlayApprovalReference: naturalApprovalReference,
          }
        : {}),
    },
    dataset,
    coverageCells: finalCells,
    metricsByMove,
    stratifiedAccumulators,
    errors,
  });
  return {
    artifact,
    runCount: accumulation.runCount,
    failedRunCount: accumulation.failedRunCount,
    failureTypes: accumulation.failureTypes,
    failures: accumulation.failures,
  };
};

export type SimulationMoveCoverageResumeOptions = Omit<
  SimulationMoveCoverageRunOptions,
  "resumeFrom" | "population" | "targetFights"
> & {
  readonly targetFights: number;
  readonly population?: SimulationCoveragePopulation;
};

/** Continue a single-population artifact at a later precision look. */
export const resumeSimulationMoveCoverage = (
  artifact: SimulationMoveCoverageArtifact,
  options: SimulationMoveCoverageResumeOptions,
): SimulationMoveCoverageRunResult => {
  const population = options.population ?? artifact.generatedFrom.population;
  if (population === undefined)
    throw new RangeError("Coverage resume requires a single-population source artifact.");
  return runSimulationMoveCoverage({
    ...options,
    population,
    targetFights: options.targetFights,
    minimumEligibleStates:
      options.minimumEligibleStates ?? artifact.generatedFrom.minimumEligibleStates,
    resumeFrom: artifact,
  });
};

const failureStatus = (
  status: SimulationCoverageCell["status"],
): status is "invalid-fixture" | "runner-failure" =>
  status === "invalid-fixture" || status === "runner-failure";

const mergeCoverageCells = (
  left: SimulationCoverageCell,
  right: SimulationCoverageCell,
): SimulationCoverageCell => {
  const identity = [
    "cellId",
    "moveId",
    "scenarioFamily",
    "mechanicPath",
    "checkpointId",
    "population",
    "targetFights",
    "minimumEligibleStates",
  ] as const;
  for (const key of identity)
    if (left[key] !== right[key])
      throw new RangeError(`Cannot merge incompatible coverage cells for ${left.cellId}.`);
  if (JSON.stringify(left.strata) !== JSON.stringify(right.strata))
    throw new RangeError(`Cannot merge coverage cells with different strata for ${left.cellId}.`);
  const merged = updateSimulationCoverageCell(left, {
    completedFights: left.completedFights + right.completedFights,
    eligibleStates: left.eligibleStates + right.eligibleStates,
    selectedStates: left.selectedStates + right.selectedStates,
    triggeredStates: left.triggeredStates + right.triggeredStates,
  });
  if (left.status === "not-scheduled") return right;
  if (right.status === "not-scheduled") return left;
  if (failureStatus(left.status) || failureStatus(right.status))
    return createSimulationCoverageCell({
      ...merged,
      status:
        left.status === "runner-failure" || right.status === "runner-failure"
          ? "runner-failure"
          : "invalid-fixture",
      failureType: left.failureType ?? right.failureType,
    });
  return merged;
};

const zeroPopulationFunnels = (): SimulationPopulationFunnels => ({
  natural: createEmptySimulationMoveFunnel(),
  isolation: createEmptySimulationMoveFunnel(),
  forced: createEmptySimulationMoveFunnel(),
});

const populationFunnelsForArtifactRecord = (
  record: SimulationMoveCoverageRecord,
  population: SimulationCoveragePopulation,
): SimulationPopulationFunnels => {
  if (record.populationFunnels !== undefined) return record.populationFunnels;
  const populationFunnels = zeroPopulationFunnels();
  return { ...populationFunnels, [population]: record.funnel } as SimulationPopulationFunnels;
};

const rebaseCoverageCell = (
  cell: SimulationCoverageCell,
  targetFights: number,
  minimumEligibleStates: number,
): SimulationCoverageCell => {
  const rebased = createSimulationCoverageCell({
    ...cell,
    targetFights,
    minimumEligibleStates,
    status: "unobserved",
  });
  if (cell.status === "audited-out-of-scope")
    return createSimulationCoverageCell({ ...rebased, status: cell.status });
  return updateSimulationCoverageCell(rebased, {
    completedFights: cell.completedFights,
    eligibleStates: cell.eligibleStates,
    selectedStates: cell.selectedStates,
    triggeredStates: cell.triggeredStates,
  });
};

const failureCellStatus = (status: SimulationCoverageCell["status"]): boolean =>
  status === "invalid-fixture" || status === "runner-failure";

const legacyErrorPopulationFor = (
  source: SimulationMoveCoverageArtifact,
  error: SimulationMoveCoverageArtifact["errors"][number],
): SimulationCoveragePopulation | undefined => {
  if (error.population !== undefined) return error.population;
  if (source.generatedFrom.population !== undefined) return source.generatedFrom.population;
  const matchingPopulations = SIMULATION_MOVE_COVERAGE_POPULATIONS.filter((population) =>
    source.coverageCells.some(
      (cell) =>
        cell.population === population &&
        cell.moveId === error.moveId &&
        failureCellStatus(cell.status) &&
        (cell.failureType === error.type ||
          (cell.failureType === "runner-failure" && error.type === "unexpected-runner-failure")),
    ),
  );
  return matchingPopulations.length === 1 ? matchingPopulations[0] : undefined;
};

const errorsForPopulationResume = (
  source: SimulationMoveCoverageArtifact,
  population: SimulationCoveragePopulation,
): readonly SimulationMoveCoverageArtifact["errors"][number][] =>
  source.errors.filter((error) => legacyErrorPopulationFor(source, error) === population);

const populationArtifactForResume = (
  source: SimulationMoveCoverageArtifact,
  population: SimulationCoveragePopulation,
  mechanicsView: CombatMechanicsView,
  targetFights: number,
  minimumEligibleStates: number,
  manifestTargetFights = targetFights,
  manifestMinimumEligibleStates = minimumEligibleStates,
): SimulationMoveCoverageArtifact => {
  const records = source.dataset.records.map((record) => {
    const populationFunnels = populationFunnelsForArtifactRecord(record, population);
    return updateSimulationMoveCoverage(record, populationFunnels[population], {
      populationFunnels: {
        natural: populationFunnels.natural,
        isolation: populationFunnels.isolation,
        forced: populationFunnels.forced,
      },
      naturalStatus: population === "natural" ? record.naturalStatus : "unobserved",
      isolationStatus: population === "isolation" ? record.isolationStatus : "unobserved",
      forcedStatus: population === "forced" ? record.forcedStatus : "unobserved",
    });
  });
  const dataset = createSimulationMoveCoverageDataset(mechanicsView, records);
  const coverageCells = source.coverageCells
    .filter((cell) => cell.population === "natural" || cell.population === population)
    .map((cell) => {
      const populationCell =
        cell.population === "natural" && population !== "natural"
          ? createSimulationCoverageCell({ ...cell, status: "not-scheduled" })
          : cell;
      return rebaseCoverageCell(populationCell, targetFights, minimumEligibleStates);
    });
  return createSimulationMoveCoverageArtifact({
    generatedFrom: {
      ...source.generatedFrom,
      mechanicsIdentity: mechanicsView.identity.contentHash,
      targetFights: manifestTargetFights,
      minimumEligibleStates: manifestMinimumEligibleStates,
      population,
      isolationRunCount: Math.max(source.generatedFrom.isolationRunCount, 1),
      source: "simulation-move-coverage-resume:v2",
    },
    dataset,
    coverageCells,
    metricsByMove: source.metricsByMove,
    stratifiedAccumulators: source.stratifiedAccumulators,
    errors: errorsForPopulationResume(source, population),
  });
};

const mergePopulationFunnels = (
  left: SimulationPopulationFunnels,
  right: SimulationPopulationFunnels,
): SimulationPopulationFunnels =>
  Object.fromEntries(
    SIMULATION_MOVE_COVERAGE_POPULATIONS.map((population) => [
      population,
      addSimulationMoveFunnels(left[population], right[population]),
    ]),
  ) as SimulationPopulationFunnels;

const mergeRecordsFromArtifact = (
  recordsByMove: Map<string, SimulationMoveCoverageRecord>,
  artifact: SimulationMoveCoverageArtifact,
  expectedRecordCount: number,
) => {
  if (artifact.dataset.records.length !== expectedRecordCount)
    throw new RangeError("Catalog artifacts must cover the same move catalog.");
  const population = artifact.generatedFrom.population;
  if (population === undefined)
    throw new RangeError("Catalog merge requires population-labeled artifacts.");
  for (const record of artifact.dataset.records) {
    const existing = recordsByMove.get(record.moveId);
    if (existing === undefined) throw new RangeError(`Catalog artifact lacks ${record.moveId}.`);
    if (existing.capabilityIdentity !== record.capabilityIdentity)
      throw new RangeError(`Catalog artifacts disagree on move capability ${record.moveId}.`);
    const populationFunnels = mergePopulationFunnels(
      existing.populationFunnels ?? zeroPopulationFunnels(),
      populationFunnelsForArtifactRecord(record, population),
    );
    recordsByMove.set(
      record.moveId,
      updateSimulationMoveCoverage(existing, aggregateSimulationMoveFunnels(populationFunnels), {
        populationFunnels,
      }),
    );
  }
};

const mergeCoverageCellsFromArtifacts = (artifacts: readonly SimulationMoveCoverageArtifact[]) => {
  const cellsById = new Map<string, SimulationCoverageCell>();
  for (const artifact of artifacts)
    for (const cell of artifact.coverageCells) {
      const existing = cellsById.get(cell.cellId);
      cellsById.set(
        cell.cellId,
        existing === undefined ? cell : mergeCoverageCells(existing, cell),
      );
    }
  return cellsById;
};

const statusesForMergedCells = (
  moveId: string,
  record: SimulationMoveCoverageRecord,
  cellsById: ReadonlyMap<string, SimulationCoverageCell>,
) => {
  const statuses: Partial<
    Record<"naturalStatus" | "isolationStatus" | "forcedStatus", SimulationMoveCoverageStatus>
  > = {};
  for (const population of SIMULATION_MOVE_COVERAGE_POPULATIONS) {
    const populationCells = [...cellsById.values()].filter(
      (cell) => cell.moveId === moveId && cell.population === population,
    );
    const requiredCells = record.requiredMechanicPaths
      .map((mechanicPath) => populationCells.find((cell) => cell.mechanicPath === mechanicPath))
      .filter((cell): cell is SimulationCoverageCell => cell !== undefined);
    if (requiredCells.length !== record.requiredMechanicPaths.length) continue;
    const statusKey = `${population}Status` as "naturalStatus" | "isolationStatus" | "forcedStatus";
    statuses[statusKey] = aggregateSimulationCoverageCellStatus(
      requiredCells,
    ) as SimulationMoveCoverageStatus;
  }
  return statuses;
};

const mergeArtifactRecords = (
  artifacts: readonly SimulationMoveCoverageArtifact[],
  mechanicsView: CombatMechanicsView,
): SimulationMoveCoverageDataset => {
  const first = artifacts[0]!;
  const recordsByMove = new Map<string, SimulationMoveCoverageRecord>();
  for (const record of first.dataset.records) recordsByMove.set(record.moveId, record);
  for (const artifact of artifacts.slice(1))
    mergeRecordsFromArtifact(recordsByMove, artifact, first.dataset.records.length);
  const cellsById = mergeCoverageCellsFromArtifacts(artifacts);
  for (const [moveId, record] of recordsByMove) {
    recordsByMove.set(
      moveId,
      updateSimulationMoveCoverage(
        record,
        aggregateSimulationMoveFunnels(record.populationFunnels ?? zeroPopulationFunnels()),
        statusesForMergedCells(moveId, record, cellsById),
      ),
    );
  }
  return createSimulationMoveCoverageDataset(mechanicsView, [...recordsByMove.values()]);
};

const validateCatalogArtifactCompatibility = (
  artifact: SimulationMoveCoverageArtifact,
  first: SimulationMoveCoverageArtifact,
): void => {
  const manifest = artifact.generatedFrom;
  const firstManifest = first.generatedFrom;
  if (manifest.scenarioFamily !== firstManifest.scenarioFamily)
    throw new RangeError("Catalog artifacts must share one scenario family.");
  if (manifest.checkpointId !== firstManifest.checkpointId)
    throw new RangeError("Catalog artifacts must share one checkpoint.");
  if (manifest.targetFights !== firstManifest.targetFights)
    throw new RangeError("Catalog artifacts must share one target-fights threshold.");
  if (manifest.minimumEligibleStates !== firstManifest.minimumEligibleStates)
    throw new RangeError("Catalog artifacts must share one eligible-state threshold.");
  if (artifact.dataset.mechanicsIdentity !== first.dataset.mechanicsIdentity)
    throw new RangeError("Catalog artifacts must share one mechanics identity.");
  if (
    manifest.rootSeed !== undefined &&
    firstManifest.rootSeed !== undefined &&
    manifest.rootSeed !== firstManifest.rootSeed
  )
    throw new RangeError("Catalog artifacts must share one root seed.");
  if (
    manifest.fixedTime !== undefined &&
    firstManifest.fixedTime !== undefined &&
    manifest.fixedTime !== firstManifest.fixedTime
  )
    throw new RangeError("Catalog artifacts must share one fixed time.");
};

const validateCatalogCompatibility = (
  artifacts: readonly SimulationMoveCoverageArtifact[],
  first: SimulationMoveCoverageArtifact,
) => {
  if (artifacts.some((artifact) => artifact.generatedFrom.population === undefined))
    throw new RangeError("Catalog merge requires population-labeled artifacts.");
  for (const artifact of artifacts) validateCatalogArtifactCompatibility(artifact, first);
};

const sourceContainsPopulation = (
  artifact: SimulationMoveCoverageArtifact,
  population: SimulationCoveragePopulation,
): boolean => {
  if (artifact.generatedFrom.population === population) return true;
  if (artifact.generatedFrom.population !== undefined) return false;
  if ((artifact.generatedFrom.populationRunCounts?.[population] ?? 0) > 0) return true;
  return artifact.coverageCells.some((cell) => cell.population === population);
};

const populationRunCountsFor = (
  artifacts: readonly SimulationMoveCoverageArtifact[],
): Record<SimulationCoveragePopulation, number> =>
  SIMULATION_MOVE_COVERAGE_POPULATIONS.reduce(
    (counts, population) => {
      counts[population] = artifacts
        .filter((artifact) => artifact.generatedFrom.population === population)
        .reduce(
          (total, artifact) =>
            total +
            (artifact.generatedFrom.populationRunCounts?.[population] ??
              artifact.generatedFrom.isolationRunCount),
          0,
        );
      return counts;
    },
    { natural: 0, isolation: 0, forced: 0 } as Record<SimulationCoveragePopulation, number>,
  );

const populationAttemptedFightsByMoveFor = (
  artifacts: readonly SimulationMoveCoverageArtifact[],
): Readonly<Record<SimulationCoveragePopulation, Readonly<Record<string, number>>>> => {
  const first = artifacts[0]!;
  const mapFor = (population: SimulationCoveragePopulation) =>
    Object.fromEntries(
      first.dataset.records.map((record) => [
        record.moveId,
        artifacts.reduce(
          (maximum, artifact) =>
            Math.max(maximum, previousAttemptsForMove(artifact, population, record.moveId)),
          0,
        ),
      ]),
    );
  return {
    natural: mapFor("natural"),
    isolation: mapFor("isolation"),
    forced: mapFor("forced"),
  };
};

const representativeReplaySeedsByMoveFor = (
  artifacts: readonly SimulationMoveCoverageArtifact[],
): Readonly<Record<SimulationCoveragePopulation, Readonly<Record<string, readonly number[]>>>> => {
  const first = artifacts[0]!;
  const mapFor = (population: SimulationCoveragePopulation) =>
    Object.fromEntries(
      first.dataset.records.map((record) => [
        record.moveId,
        [
          ...new Set(
            artifacts.flatMap(
              (artifact) =>
                artifact.generatedFrom.representativeReplaySeedsByMove?.[population]?.[
                  record.moveId
                ] ?? [],
            ),
          ),
        ]
          .sort((left, right) => left - right)
          .slice(0, 8),
      ]),
    );
  return {
    natural: mapFor("natural"),
    isolation: mapFor("isolation"),
    forced: mapFor("forced"),
  };
};

const metricsByMoveFor = (
  artifacts: readonly SimulationMoveCoverageArtifact[],
): SimulationMoveCoverageArtifact["metricsByMove"] => {
  const first = artifacts[0]!;
  const mapFor = (population: SimulationCoveragePopulation) =>
    Object.fromEntries(
      first.dataset.records.map((record) => {
        const metrics = artifacts
          .map((artifact) => artifact.metricsByMove?.[population]?.[record.moveId])
          .filter((value): value is SimulationMoveMetrics => value !== undefined);
        return [
          record.moveId,
          metrics.reduce(
            (merged, current) => mergeSimulationMoveMetrics(merged, current),
            createSimulationMoveMetrics(record.moveId, population),
          ),
        ];
      }),
    );
  return {
    natural: mapFor("natural"),
    isolation: mapFor("isolation"),
    forced: mapFor("forced"),
  };
};

const stratifiedAccumulatorsFor = (
  artifacts: readonly SimulationMoveCoverageArtifact[],
): SimulationMoveCoverageArtifact["stratifiedAccumulators"] => {
  const first = artifacts[0]!;
  const mapFor = (population: SimulationCoveragePopulation) =>
    Object.fromEntries(
      first.dataset.records.map((record) => {
        const accumulators = artifacts
          .map((artifact) => artifact.stratifiedAccumulators?.[population]?.[record.moveId])
          .filter((value): value is SimulationStratifiedAccumulator => value !== undefined);
        return [
          record.moveId,
          accumulators.reduce(
            (merged, current) => {
              if (merged.completedPairs === 0 && merged.errorCount === 0) return current;
              if (current.completedPairs === 0 && current.errorCount === 0) return merged;
              return mergeSimulationStratifiedAccumulators(merged, current);
            },
            createSimulationStratifiedAccumulator(`${population}:${record.moveId}`),
          ),
        ];
      }),
    );
  return {
    natural: mapFor("natural"),
    isolation: mapFor("isolation"),
    forced: mapFor("forced"),
  };
};

const errorsForArtifacts = (
  artifacts: readonly SimulationMoveCoverageArtifact[],
): readonly SimulationMoveCoverageArtifact["errors"][number][] =>
  [
    ...new Map(
      artifacts
        .flatMap((artifact) => artifact.errors)
        .map(
          (error) =>
            [
              `${error.population ?? "unknown"}:${error.moveId}:${error.runId}:${error.type}:${error.detail}`,
              error,
            ] as const,
        ),
    ).values(),
  ].sort((left, right) =>
    `${left.moveId}:${left.runId}:${left.type}`.localeCompare(
      `${right.moveId}:${right.runId}:${right.type}`,
    ),
  );

export const mergeSimulationMoveCoverageArtifacts = (
  artifacts: readonly SimulationMoveCoverageArtifact[],
  mechanicsView: CombatMechanicsView = CANONICAL_COMBAT_MECHANICS_VIEW,
): SimulationMoveCoverageArtifact => {
  if (artifacts.length === 0) throw new RangeError("Catalog merge requires at least one artifact.");
  const first = artifacts[0]!;
  validateCatalogCompatibility(artifacts, first);
  const dataset = mergeArtifactRecords(artifacts, mechanicsView);
  const cellsById = mergeCoverageCellsFromArtifacts(artifacts);
  const populationRunCounts = populationRunCountsFor(artifacts);
  const errors = errorsForArtifacts(artifacts);
  const naturalArtifact = artifacts.find(
    (artifact) => artifact.generatedFrom.population === "natural",
  );
  return createSimulationMoveCoverageArtifact({
    generatedFrom: {
      mechanicsIdentity: dataset.mechanicsIdentity,
      scenarioFamily: first.generatedFrom.scenarioFamily,
      checkpointId: first.generatedFrom.checkpointId,
      targetFights: first.generatedFrom.targetFights,
      minimumEligibleStates: first.generatedFrom.minimumEligibleStates,
      isolationRunCount: Math.max(populationRunCounts.isolation, 1),
      populationRunCounts,
      populationAttemptedFightsByMove: populationAttemptedFightsByMoveFor(artifacts),
      representativeReplaySeedsByMove: representativeReplaySeedsByMoveFor(artifacts),
      naturalPopulation: naturalArtifact === undefined ? "draft" : "approved",
      ...(naturalArtifact === undefined
        ? { naturalPopulationBlocker: SIMULATION_NATURAL_POPULATION_BLOCKER }
        : {}),
      mechanicPaths: ["decision", "trigger"],
      source: "simulation-move-coverage-catalog:v2",
      ...(naturalArtifact === undefined
        ? {}
        : {
            naturalProfileId:
              naturalArtifact.generatedFrom.naturalProfileId ?? SIMULATION_NATURAL_AI_PROFILES[2],
            naturalOverlayApprovalReference:
              naturalArtifact.generatedFrom.naturalOverlayApprovalReference,
          }),
    },
    dataset,
    coverageCells: [...cellsById.values()].sort((left, right) =>
      left.cellId.localeCompare(right.cellId),
    ),
    metricsByMove: metricsByMoveFor(artifacts),
    stratifiedAccumulators: stratifiedAccumulatorsFor(artifacts),
    errors,
  });
};

export type SimulationMoveCoverageCatalogRunOptions = Omit<
  SimulationMoveCoverageRunOptions,
  "population"
> & {
  readonly populations?: readonly SimulationCoveragePopulation[];
};

export interface SimulationMoveCoverageCatalogRunResult {
  readonly artifact: SimulationMoveCoverageArtifact;
  readonly populationResults: Readonly<
    Record<SimulationCoveragePopulation, SimulationMoveCoverageRunResult | undefined>
  >;
  readonly runCount: number;
  readonly failedRunCount: number;
  readonly failureTypes: Readonly<Partial<Record<SimulationFailure["type"], number>>>;
}

/** Executes and merges population runs without pooling their denominators. */
export const runSimulationMoveCoverageCatalog = (
  options: SimulationMoveCoverageCatalogRunOptions = {},
): SimulationMoveCoverageCatalogRunResult => {
  const sourceArtifact = options.resumeFrom;
  const defaultPopulations =
    sourceArtifact?.generatedFrom.population === undefined &&
    sourceArtifact?.generatedFrom.populationRunCounts !== undefined
      ? SIMULATION_MOVE_COVERAGE_POPULATIONS.filter(
          (population) => sourceArtifact.generatedFrom.populationRunCounts?.[population] !== 0,
        )
      : SIMULATION_MOVE_COVERAGE_POPULATIONS;
  const requested = options.populations ?? defaultPopulations;
  const populations = SIMULATION_MOVE_COVERAGE_POPULATIONS.filter((population) =>
    requested.includes(population),
  );
  if (populations.length === 0) throw new RangeError("Catalog run requires a population.");
  if (new Set(requested).size !== requested.length)
    throw new RangeError("Catalog run populations must be unique.");
  if (populations.includes("natural"))
    approveAllSimulationTf1Overlays(options.naturalOverlayApprovalReference ?? "");
  const runOptions = { ...options };
  Reflect.deleteProperty(runOptions, "populations");
  Reflect.deleteProperty(runOptions, "resumeFrom");
  const mechanicsView = options.mechanicsView ?? CANONICAL_COMBAT_MECHANICS_VIEW;
  const targetFights = options.targetFights ?? 250;
  const minimumEligibleStates = options.minimumEligibleStates ?? 250;
  const results = populations.map((population) =>
    runSimulationMoveCoverage({
      ...runOptions,
      population,
      targetFights,
      minimumEligibleStates,
      ...(sourceArtifact === undefined || !sourceContainsPopulation(sourceArtifact, population)
        ? {}
        : {
            resumeFrom: populationArtifactForResume(
              sourceArtifact,
              population,
              mechanicsView,
              targetFights,
              minimumEligibleStates,
              sourceArtifact.generatedFrom.targetFights,
              sourceArtifact.generatedFrom.minimumEligibleStates,
            ),
          }),
    }),
  );
  const untouchedArtifacts =
    sourceArtifact === undefined
      ? []
      : SIMULATION_MOVE_COVERAGE_POPULATIONS.filter(
          (population) => !populations.includes(population),
        ).map((population) =>
          populationArtifactForResume(
            sourceArtifact,
            population,
            mechanicsView,
            targetFights,
            minimumEligibleStates,
          ),
        );
  const artifacts = [...results.map((result) => result.artifact), ...untouchedArtifacts];
  const artifact = mergeSimulationMoveCoverageArtifacts(artifacts, mechanicsView);
  const failureTypes: Partial<Record<SimulationFailure["type"], number>> = {};
  for (const result of results)
    for (const [type, count] of Object.entries(result.failureTypes))
      failureTypes[type as SimulationFailure["type"]] =
        (failureTypes[type as SimulationFailure["type"]] ?? 0) + count;
  return {
    artifact,
    populationResults: {
      natural: results.find((result) => result.artifact.generatedFrom.population === "natural"),
      isolation: results.find((result) => result.artifact.generatedFrom.population === "isolation"),
      forced: results.find((result) => result.artifact.generatedFrom.population === "forced"),
    },
    runCount: results.reduce((total, result) => total + result.runCount, 0),
    failedRunCount: results.reduce((total, result) => total + result.failedRunCount, 0),
    failureTypes,
  };
};
