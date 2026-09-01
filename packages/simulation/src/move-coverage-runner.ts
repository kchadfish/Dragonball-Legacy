import {
  CANONICAL_COMBAT_MECHANICS_VIEW,
  type CombatMechanicsView,
} from "@dragonball-resurgence/combat-engine";
import { SIMULATION_QUALITY_PROFILE } from "@dragonball-resurgence/ai-engine";
import type { MoveDefinition } from "@dragonball-resurgence/game-data";

import {
  createSimulationCoverageMatrix,
  createSimulationCoverageCell,
  updateSimulationCoverageCell,
  type SimulationCoverageCell,
} from "./coverage.js";
import {
  createSimulationMoveCoverageArtifact,
  type SimulationMoveCoverageArtifact,
} from "./coverage-artifacts.js";
import type { SimulationFailure, SimulationFightRequest, SimulationTemplate } from "./contracts.js";
import {
  createSimulationMoveCoverageDataset,
  excludeSimulationMoveCoverage,
  recordSimulationMoveFunnel,
  updateSimulationMoveCoverage,
} from "./move-coverage.js";
import { runSimulationRequests } from "./coordinator.js";
import { createScenario } from "./scenarios.js";

const naturalExclusionReason =
  "Natural coverage is a reviewed v1 exclusion: no canonical loadout currently pins this move to a natural selection cohort, and the TF1 source sheets retain unresolved loadout gaps.";

const slugFor = (moveId: string): string => moveId.replaceAll(":", "-");

const isolationStatusFor = (
  status: SimulationCoverageCell["status"],
): "sufficient" | "excluded" | "observed" | "unobserved" => {
  if (status === "observed-sufficient") return "sufficient";
  if (status === "excluded") return "excluded";
  if (status === "underexposed") return "observed";
  return "unobserved";
};

const failureReasonFor = (failures: readonly { readonly failure: SimulationFailure }[]): string => {
  const types = [...new Set(failures.map((entry) => entry.failure.type))].sort((left, right) =>
    left.localeCompare(right),
  );
  return `Reviewed v1 isolation exclusion: all deterministic isolation attempts failed at the authoritative simulation boundary (${types.join(", ")}); this is not balance evidence and requires combat/runtime remediation before re-inclusion.`;
};

const noExposureReason =
  "Reviewed v1 isolation exclusion: the move never appeared in an authoritative legal decision set within the bounded deterministic isolation manifest; this is not balance evidence and requires a setup-context or combat-scope review before re-inclusion.";

const isolationExclusionFor = (
  failures: readonly { readonly failure: SimulationFailure }[],
  eligibleStates: number,
  completedFights: number,
  targetFights: number,
  minimumEligibleStates: number,
  maximumAttempts: number,
): string | undefined => {
  if (failures.length >= maximumAttempts) return failureReasonFor(failures);
  if (eligibleStates === 0) return noExposureReason;
  if (completedFights < targetFights || eligibleStates < minimumEligibleStates)
    return `Reviewed v1 isolation exclusion: the bounded deterministic isolation manifest produced ${completedFights} completed runs and ${eligibleStates} eligible states, below the required ${targetFights} runs and ${minimumEligibleStates} eligible states; this is not balance evidence and requires a setup-context or combat-scope review before re-inclusion.`;
  return undefined;
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
    1,
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
  };
};

export interface SimulationMoveCoverageRunOptions {
  readonly mechanicsView?: CombatMechanicsView;
  readonly rootSeed?: number;
  readonly fixedTime?: Date;
  readonly targetFights?: number;
  readonly minimumEligibleStates?: number;
  readonly concurrency?: number;
  readonly moveIds?: readonly string[];
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
  const targetFights = options.targetFights ?? 10;
  const minimumEligibleStates = options.minimumEligibleStates ?? 10;
  const concurrency = options.concurrency ?? 4;
  const maximumAttempts = Math.min(10_000, targetFights * 2);
  let dataset = createSimulationMoveCoverageDataset(view);
  const cells = createSimulationCoverageMatrix(dataset, ["move-isolation"], "early", {
    targetFights,
    minimumEligibleStates,
    populations: ["natural", "isolation"],
  });
  const naturalCells = new Map(
    cells
      .filter((cell) => cell.population === "natural")
      .map((cell) => [
        cell.moveId,
        createSimulationCoverageCell({
          ...cell,
          status: "excluded",
          exclusionReason: naturalExclusionReason,
        }),
      ]),
  );
  const isolationCells = new Map(
    cells.filter((cell) => cell.population === "isolation").map((cell) => [cell.moveId, cell]),
  );
  let runCount = 0;
  let failedRunCount = 0;
  const failureTypes: Partial<Record<SimulationFailure["type"], number>> = {};
  const failures: Array<{
    readonly moveId: string;
    readonly runId: string;
    readonly failure: SimulationFailure;
  }> = [];
  const failuresByMove = new Map<string, typeof failures>();
  const selectedMoves =
    options.moveIds === undefined
      ? [...view.moves]
      : options.moveIds.map((moveId) => {
          const move = view.indexes.moves.get(moveId);
          if (move === undefined) throw new RangeError(`Unknown coverage move: ${moveId}.`);
          return move;
        });
  const orderedMoves = [...selectedMoves].sort((left, right) => left.id.localeCompare(right.id));
  for (const move of orderedMoves) {
    const requests = Array.from({ length: maximumAttempts }, (_, iteration) =>
      requestFor(move, iteration, rootSeed, fixedTime, view),
    );
    const coordinated = runSimulationRequests({
      requests,
      stoppingPolicy: "continue",
      concurrency,
    });
    let completedFights = 0;
    let eligibleStates = 0;
    for (const result of coordinated.results) {
      runCount += 1;
      if (!result.ok) {
        failedRunCount += 1;
        failureTypes[result.error.type] = (failureTypes[result.error.type] ?? 0) + 1;
        const failure = {
          moveId: move.id,
          runId: requests[coordinated.results.indexOf(result)]?.runId ?? "unknown",
          failure: result.error,
        };
        failures.push(failure);
        const moveFailures = failuresByMove.get(move.id) ?? [];
        moveFailures.push(failure);
        failuresByMove.set(move.id, moveFailures);
        continue;
      }
      completedFights += 1;
      const funnel = result.value.diagnostics?.moveFunnels[move.id];
      if (funnel !== undefined) {
        eligibleStates += funnel.eligible;
        dataset = recordSimulationMoveFunnel(dataset, { [move.id]: funnel }, "isolation", {
          targetFights,
          minimumEligibleStates,
        });
      }
    }
    const cell = isolationCells.get(move.id);
    if (cell === undefined) throw new RangeError("Missing isolation cell for selected move.");
    isolationCells.set(
      move.id,
      updateSimulationCoverageCell(cell, { completedFights, eligibleStates }),
    );
  }
  dataset = createSimulationMoveCoverageDataset(
    view,
    dataset.records.map((record) => {
      const isolationCell = isolationCells.get(record.moveId);
      if (isolationCell === undefined)
        throw new RangeError(`Missing isolation cell for ${record.moveId}.`);
      const moveFailures = failuresByMove.get(record.moveId) ?? [];
      const isolationExclusion = isolationExclusionFor(
        moveFailures,
        isolationCell.eligibleStates,
        isolationCell.completedFights,
        targetFights,
        minimumEligibleStates,
        maximumAttempts,
      );
      const finalCell =
        isolationExclusion === undefined
          ? isolationCell
          : createSimulationCoverageCell({
              ...isolationCell,
              status: "excluded",
              exclusionReason: isolationExclusion,
            });
      isolationCells.set(record.moveId, finalCell);
      const naturalRecord = excludeSimulationMoveCoverage(
        record,
        "natural",
        naturalExclusionReason,
      );
      const recordWithExclusion =
        isolationExclusion === undefined
          ? naturalRecord
          : excludeSimulationMoveCoverage(naturalRecord, "isolation", isolationExclusion);
      return updateSimulationMoveCoverage(recordWithExclusion, record.funnel, {
        naturalStatus: "excluded",
        isolationStatus:
          isolationExclusion === undefined ? isolationStatusFor(finalCell.status) : "excluded",
      });
    }),
  );
  const finalCells = Object.freeze(
    [...naturalCells.values(), ...isolationCells.values()].sort((left, right) =>
      left.cellId.localeCompare(right.cellId),
    ),
  );
  const artifact = createSimulationMoveCoverageArtifact({
    generatedFrom: {
      mechanicsIdentity: view.identity.contentHash,
      scenarioFamily: "move-isolation",
      checkpointId: "early",
      targetFights,
      minimumEligibleStates,
      isolationRunCount: runCount,
      naturalPopulation: "reviewed-exclusion",
      source: "simulation-move-coverage-runner:v2",
    },
    dataset,
    coverageCells: finalCells,
  });
  return { artifact, runCount, failedRunCount, failureTypes, failures };
};
