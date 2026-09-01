import { canonicalHash } from "./canonical.js";
import {
  simulationMatrixRequestSchema,
  simulationSeriesRequestSchema,
  type SimulationMatrixRequest,
  type SimulationMatrixResult,
  type SimulationProgress,
  type SimulationSeriesRequest,
  type SimulationSeriesResult,
} from "./contracts.js";
import { runSimulationSeries } from "./series.js";

const fightCountFor = (request: SimulationSeriesRequest): number =>
  request.iterations * (request.mirrored ? 2 : 1);

const seriesRequestHash = (request: SimulationSeriesRequest): string =>
  canonicalHash({
    schemaVersion: request.schemaVersion,
    seriesId: request.seriesId,
    baseRequest: {
      runId: request.baseRequest.runId,
      scenario: request.baseRequest.scenario,
      templateA: request.baseRequest.templateA.id,
      templateB: request.baseRequest.templateB.id,
      profileA: request.baseRequest.profileA.identity,
      profileB: request.baseRequest.profileB.identity,
      rootSeed: request.baseRequest.rootSeed,
      fixedTime: request.baseRequest.fixedTime.toISOString(),
      mechanics: request.baseRequest.mechanicsView.identity,
    },
    iterations: request.iterations,
    mirrored: request.mirrored,
    stoppingPolicy: request.stoppingPolicy,
  });

export const runSimulationMatrix = (request: SimulationMatrixRequest): SimulationMatrixResult => {
  const parsed = simulationMatrixRequestSchema.parse(request);
  const seriesRequests = parsed.series
    .map((seriesRequest) => simulationSeriesRequestSchema.parse(seriesRequest))
    .sort((left, right) => seriesRequestHash(left).localeCompare(seriesRequestHash(right)));
  const estimatedFightCount = seriesRequests.reduce(
    (total, seriesRequest) => total + fightCountFor(seriesRequest),
    0,
  );
  if (parsed.maximumFights !== undefined && estimatedFightCount > parsed.maximumFights)
    throw new RangeError(
      `Simulation matrix budget exceeded: ${estimatedFightCount} fights estimated, ${parsed.maximumFights} allowed.`,
    );
  let completed = 0;
  let stoppedEarly = false;
  const series: SimulationSeriesResult[] = [];
  for (const seriesRequest of seriesRequests) {
    if (parsed.control?.isCancelled?.()) {
      stoppedEarly = true;
      break;
    }
    const result = runSimulationSeries({
      ...seriesRequest,
      control: parsed.control,
      onProgress: parsed.onProgress
        ? (progress: SimulationProgress) =>
            parsed.onProgress?.({
              ...progress,
              completed: completed + progress.completed,
              total: estimatedFightCount,
            })
        : undefined,
    });
    series.push(result);
    completed += result.results.length;
    stoppedEarly ||= result.stoppedEarly;
    if (result.stoppedEarly) break;
  }
  return {
    schemaVersion: "simulation-contracts:v1",
    matrixId: parsed.matrixId,
    series,
    estimatedFightCount,
    stoppedEarly,
    matrixHash: canonicalHash({
      matrixId: parsed.matrixId,
      series: series.map((entry) => entry.seriesHash),
      estimatedFightCount,
    }),
  };
};
