import {
  CANONICAL_COMBAT_MECHANICS_VIEW,
  type CombatMechanicsView,
} from "@dragonball-resurgence/combat-engine";
import { SIMULATION_QUALITY_PROFILE } from "@dragonball-resurgence/ai-engine";
import type { MoveDefinition } from "@dragonball-resurgence/game-data";

import {
  createSimulationCoverageCell,
  createSimulationCoverageMatrix,
  updateSimulationCoverageCell,
  type SimulationCoverageCell,
  type SimulationCoveragePopulation,
} from "./coverage.js";
import {
  createSimulationMoveCoverageArtifact,
  type SimulationMoveCoverageArtifact,
} from "./coverage-artifacts.js";
import type { SimulationFailure, SimulationFightRequest, SimulationTemplate } from "./contracts.js";
import {
  createSimulationMoveCoverageDataset,
  recordSimulationMoveFunnel,
  type SimulationMoveCoverageDataset,
  updateSimulationMoveCoverage,
  type SimulationMoveCoverageStatus,
} from "./move-coverage.js";
import { runSimulationRequests, runSimulationRequestsWithWorkers } from "./coordinator.js";
import { createScenario } from "./scenarios.js";

const slugFor = (moveId: string): string => moveId.replaceAll(":", "-");

const failureDetailFor = (failure: SimulationFailure): string => {
  if ("detail" in failure) return failure.detail;
  if (failure.type === "exhausted-safeguard") return failure.reason;
  return failure.type;
};

const statusForIsolationCells = (
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

const requestFor = (
  move: MoveDefinition,
  iteration: number,
  rootSeed: number,
  fixedTime: Date,
  view: CombatMechanicsView,
  population: SimulationCoveragePopulation,
): SimulationFightRequest => {
  const slug = slugFor(move.id);
  const styleId = move.styleId ?? "style-freestyle";
  const templateA = templateFor(
    `simulation-template:coverage-${slug}-attacker`,
    [move.id],
    styleId,
    view,
    220,
  );
  const templateB = templateFor(
    `simulation-template:coverage-${slug}-opponent`,
    [],
    "style-freestyle",
    view,
    220,
  );
  const scenario = createScenario({
    id: `simulation-scenario:move-isolation-${slug}-${iteration + 1}`,
    family: "move-isolation",
    checkpointId: "early",
    templateAId: templateA.id,
    templateBId: templateB.id,
    variantId: "simulation-variant:baseline",
    retention: "diagnostic",
    limits: { maximumTurns: 30, maximumTransitions: 500, semanticNoProgressLimit: 20 },
    stoppingPolicy: "continue",
    deferred: false,
  });
  return {
    schemaVersion: "simulation-contracts:v1",
    runId: `simulation-run:move-coverage-${slug}-${iteration + 1}`,
    scenario,
    templateA,
    templateB,
    profileA: SIMULATION_QUALITY_PROFILE,
    profileB: SIMULATION_QUALITY_PROFILE,
    rootSeed,
    iteration,
    mirror: "original",
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
    return;
  }
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
      completedFights,
      eligibleStates: counts.eligible,
      selectedStates: counts.selected,
      triggeredStates: counts.triggered,
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

const runCoverageRequestsForMove = ({
  move,
  options,
  view,
  rootSeed,
  fixedTime,
  maximumAttempts,
  targetFights,
  minimumEligibleStates,
  population,
  executionCells,
  accumulation,
}: {
  readonly move: MoveDefinition;
  readonly options: SimulationMoveCoverageRunOptions;
  readonly view: CombatMechanicsView;
  readonly rootSeed: number;
  readonly fixedTime: Date;
  readonly maximumAttempts: number;
  readonly targetFights: number;
  readonly minimumEligibleStates: number;
  readonly population: SimulationCoveragePopulation;
  readonly executionCells: Map<string, SimulationCoverageCell>;
  readonly accumulation: MoveCoverageAccumulation;
}) => {
  const requests = Array.from({ length: maximumAttempts }, (_, iteration) =>
    requestFor(move, iteration, rootSeed, fixedTime, view, population),
  );
  const coordinated =
    options.workers === undefined
      ? runSimulationRequests({
          requests,
          stoppingPolicy: "continue",
          concurrency: options.concurrency ?? 4,
        })
      : runSimulationRequestsWithWorkers({
          requests,
          stoppingPolicy: "continue",
          workers: options.workers,
        });
  const countsByPath = new Map<CoveragePath, CoveragePathCounts>();
  for (const [resultIndex, result] of coordinated.results.entries())
    accumulateMoveResult(
      accumulation,
      move,
      requests[resultIndex]?.runId ?? "unknown",
      result,
      countsByPath,
      targetFights,
      minimumEligibleStates,
      population,
    );
  executionCellsForMove({
    move,
    cells: executionCells,
    countsByPath,
    completedFights: coordinated.results.filter((result) => result.ok).length,
    failures: accumulation.failuresByMove.get(move.id) ?? [],
    population,
  });
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
      const executionStatus = statusForIsolationCells(failures, decisionCell, triggerCell);
      return updateSimulationMoveCoverage(record, record.funnel, {
        naturalStatus: "not-scheduled",
        ...(population === "forced"
          ? { forcedStatus: executionStatus }
          : { isolationStatus: executionStatus }),
      });
    }),
  );

const finalCoverageCells = (
  naturalCells: ReadonlyMap<string, SimulationCoverageCell>,
  executionCells: ReadonlyMap<string, SimulationCoverageCell>,
) =>
  Object.freeze(
    [...naturalCells.values(), ...executionCells.values()]
      .map((cell) =>
        cell.population === "natural"
          ? createSimulationCoverageCell({ ...cell, status: "not-scheduled" })
          : cell,
      )
      .sort((left, right) => left.cellId.localeCompare(right.cellId)),
  );

/**
 * Executes deterministic isolation runs for every public move. The only
 * outcome source is the normal simulation runner; this operation merely
 * reduces its diagnostic funnel into a canonical artifact.
 */
export const runSimulationMoveCoverage = (
  options: SimulationMoveCoverageRunOptions = {},
): SimulationMoveCoverageRunResult => {
  const view = options.mechanicsView ?? CANONICAL_COMBAT_MECHANICS_VIEW;
  const rootSeed = options.rootSeed ?? 1_427_251_991;
  const fixedTime = options.fixedTime ?? new Date("2026-01-01T00:00:00.000Z");
  const targetFights = options.targetFights ?? 250;
  const minimumEligibleStates = options.minimumEligibleStates ?? 250;
  const population = options.population ?? "isolation";
  const maximumAttempts = Math.min(10_000, targetFights * 2);
  let dataset = createSimulationMoveCoverageDataset(view);
  const cells = createSimulationCoverageMatrix(dataset, ["move-isolation"], "early", {
    targetFights,
    minimumEligibleStates,
    populations: Array.from(new Set<SimulationCoveragePopulation>(["natural", population])),
    mechanicPaths: ["decision", "trigger"],
  });
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
  };
  const selectedMoves =
    options.moveIds === undefined
      ? [...view.moves]
      : options.moveIds.map((moveId) => {
          const move = view.indexes.moves.get(moveId);
          if (move === undefined) throw new RangeError(`Unknown coverage move: ${moveId}.`);
          return move;
        });
  const orderedMoves = [...selectedMoves].sort((left, right) => left.id.localeCompare(right.id));
  for (const move of orderedMoves)
    runCoverageRequestsForMove({
      move,
      options,
      view,
      rootSeed,
      fixedTime,
      maximumAttempts,
      targetFights,
      minimumEligibleStates,
      population,
      executionCells,
      accumulation,
    });
  dataset = finalizedDataset(
    view,
    accumulation.dataset,
    executionCells,
    population,
    accumulation.failuresByMove,
  );
  const finalCells = finalCoverageCells(naturalCells, executionCells);
  const artifact = createSimulationMoveCoverageArtifact({
    generatedFrom: {
      mechanicsIdentity: view.identity.contentHash,
      scenarioFamily: "move-isolation",
      checkpointId: "early",
      targetFights,
      minimumEligibleStates,
      isolationRunCount: Math.max(accumulation.runCount, 1),
      naturalPopulation: "draft",
      mechanicPaths: ["decision", "trigger"],
      source: "simulation-move-coverage-runner:v2",
    },
    dataset,
    coverageCells: finalCells,
    errors: accumulation.failures.map(({ moveId, runId, failure }) => ({
      moveId,
      runId,
      type: failure.type,
      detail: failureDetailFor(failure),
    })),
  });
  return {
    artifact,
    runCount: accumulation.runCount,
    failedRunCount: accumulation.failedRunCount,
    failureTypes: accumulation.failureTypes,
    failures: accumulation.failures,
  };
};
