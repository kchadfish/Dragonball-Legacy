import { canonicalHash } from "./canonical.js";
import {
  createSimulationCheckpoint,
  simulationFightIdentity,
  simulationSeriesManifestHash,
} from "./checkpoints.js";
import {
  type SimulationControl,
  type SimulationFightSpec,
  type SimulationProgress,
  type SimulationSeriesRequest,
  type SimulationSeriesResult,
} from "./contracts.js";
import { runSimulationRequests } from "./coordinator.js";
import { assertSimulationBudget, type SimulationBudget } from "./budgets.js";
import { createSimulationFightSpecs } from "./series.js";

export interface SimulationSeriesAccumulator {
  readonly completedFightIdentities: readonly string[];
  readonly errorCount: number;
  readonly completedCount: number;
  readonly terminationCounts: Readonly<Record<string, number>>;
  readonly resultHash: string;
}

export const createSimulationSeriesAccumulator = (): SimulationSeriesAccumulator => ({
  completedFightIdentities: [],
  errorCount: 0,
  completedCount: 0,
  terminationCounts: {},
  resultHash: canonicalHash([]),
});

const accumulatorFor = (
  specs: readonly SimulationFightSpec[],
  results: SimulationSeriesResult["results"],
): SimulationSeriesAccumulator => {
  const completedFightIdentities: string[] = [];
  const terminationCounts: Record<string, number> = {};
  let errorCount = 0;
  for (const [index, result] of results.entries()) {
    const spec = specs[index];
    if (!result.ok) {
      errorCount += 1;
      continue;
    }
    completedFightIdentities.push(simulationFightIdentity(spec));
    const reason = result.value.terminationReason;
    terminationCounts[reason] = (terminationCounts[reason] ?? 0) + 1;
  }
  completedFightIdentities.sort((left, right) => left.localeCompare(right));
  return {
    completedFightIdentities,
    errorCount,
    completedCount: completedFightIdentities.length,
    terminationCounts,
    resultHash: canonicalHash({ completedFightIdentities, errorCount, terminationCounts }),
  };
};

export const mergeSimulationSeriesAccumulators = (
  left: SimulationSeriesAccumulator,
  right: SimulationSeriesAccumulator,
): SimulationSeriesAccumulator => {
  const identities = [...left.completedFightIdentities, ...right.completedFightIdentities].sort(
    (a, b) => a.localeCompare(b),
  );
  const unique = [...new Set(identities)];
  const terminationCounts: Record<string, number> = { ...left.terminationCounts };
  for (const [reason, count] of Object.entries(right.terminationCounts))
    terminationCounts[reason] = (terminationCounts[reason] ?? 0) + count;
  return {
    completedFightIdentities: unique,
    errorCount: left.errorCount + right.errorCount,
    completedCount: unique.length,
    terminationCounts: Object.fromEntries(
      Object.entries(terminationCounts).sort(([a], [b]) => a.localeCompare(b)),
    ),
    resultHash: canonicalHash({
      unique,
      errorCount: left.errorCount + right.errorCount,
      terminationCounts,
    }),
  };
};

export interface SimulationSeriesBatchResult {
  readonly seriesId: string;
  readonly batchCount: number;
  readonly accumulator: SimulationSeriesAccumulator;
  readonly results?: SimulationSeriesResult["results"];
  readonly checkpoint: ReturnType<typeof createSimulationCheckpoint>;
  readonly stoppedEarly: boolean;
  readonly manifestHash: string;
}

export const runSimulationSeriesBatches = (
  request: SimulationSeriesRequest,
  options: {
    readonly batchSize: number;
    readonly retainResults?: boolean;
    readonly budget?: SimulationBudget;
    readonly control?: SimulationControl;
    readonly onProgress?: (progress: SimulationProgress) => void;
  },
): SimulationSeriesBatchResult => {
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1)
    throw new RangeError("Simulation batch size must be a positive integer.");
  if (options.budget !== undefined) assertSimulationBudget(request, options.budget);
  const specs = createSimulationFightSpecs(request);
  const manifestRequest = {
    seriesId: request.seriesId,
    baseRequest: request.baseRequest,
    iterations: request.iterations,
    mirrored: request.mirrored,
    stoppingPolicy: request.stoppingPolicy,
  };
  let accumulator = createSimulationSeriesAccumulator();
  let checkpoint = createSimulationCheckpoint(manifestRequest, { specs: [], results: [] });
  const retained: SimulationSeriesResult["results"][number][] = [];
  let stoppedEarly = false;
  let completed = 0;
  let batchCount = 0;
  for (let start = 0; start < specs.length && !stoppedEarly; start += options.batchSize) {
    const batchSpecs = specs.slice(start, start + options.batchSize);
    const coordinated = runSimulationRequests({
      requests: batchSpecs.map((spec) => spec.request),
      stoppingPolicy: request.stoppingPolicy,
      concurrency: request.concurrency,
      control: options.control ?? request.control,
      onProgress: options.onProgress
        ? (progress) =>
            options.onProgress?.({
              ...progress,
              completed: completed + progress.completed,
              total: specs.length,
            })
        : undefined,
    });
    const batchAccumulator = accumulatorFor(batchSpecs, coordinated.results);
    accumulator = mergeSimulationSeriesAccumulators(accumulator, batchAccumulator);
    const batchCheckpoint = createSimulationCheckpoint(manifestRequest, {
      specs: batchSpecs,
      results: coordinated.results,
    });
    checkpoint = {
      ...checkpoint,
      entries: [...checkpoint.entries, ...batchCheckpoint.entries].sort((a, b) =>
        a.fightIdentity.localeCompare(b.fightIdentity),
      ),
    };
    if (options.retainResults) retained.push(...coordinated.results);
    completed += coordinated.results.length;
    batchCount += 1;
    stoppedEarly = coordinated.stoppedEarly;
  }
  return {
    seriesId: request.seriesId,
    batchCount,
    accumulator,
    ...(options.retainResults ? { results: retained } : {}),
    checkpoint,
    stoppedEarly,
    manifestHash: simulationSeriesManifestHash(manifestRequest),
  };
};
