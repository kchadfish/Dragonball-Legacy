import { canonicalHash } from "./canonical.js";
import {
  createSimulationCheckpoint,
  mergeSimulationCheckpoints,
  simulationFightIdentity,
  validateSimulationCheckpoint,
} from "./checkpoints.js";
import {
  simulationSeriesRequestSchema,
  type SimulationFightRequest,
  type SimulationFightSpec,
  type SimulationSeriesRequest,
  type SimulationSeriesResult,
} from "./contracts.js";
import { simulationScenarioIdSchema, simulationRunIdSchema } from "./ids.js";
import { runSimulationRequests } from "./coordinator.js";

const suffixFor = (value: string): string => value.slice(value.indexOf(":") + 1);

const requestFor = (
  base: SimulationFightRequest,
  iteration: number,
  mirror: "original" | "mirrored",
): SimulationFightRequest => {
  const mirrored = mirror === "mirrored";
  const templateA = mirrored ? base.templateB : base.templateA;
  const templateB = mirrored ? base.templateA : base.templateB;
  const profileA = mirrored ? base.profileB : base.profileA;
  const profileB = mirrored ? base.profileA : base.profileB;
  const scenarioId = simulationScenarioIdSchema.parse(
    `simulation-scenario:${suffixFor(base.scenario.id)}-iteration-${iteration + 1}-${mirror}`,
  );
  const runId = simulationRunIdSchema.parse(
    `simulation-run:${suffixFor(base.runId)}-iteration-${iteration + 1}-${mirror}`,
  );
  return {
    ...base,
    runId,
    scenario: {
      ...base.scenario,
      id: scenarioId,
      templateAId: templateA.id,
      templateBId: templateB.id,
    },
    templateA,
    templateB,
    profileA,
    profileB,
    iteration,
    mirror,
  };
};

export const createSimulationFightSpecs = (
  request: SimulationSeriesRequest,
): readonly SimulationFightSpec[] => {
  const parsed = simulationSeriesRequestSchema.parse(request);
  const specs = Array.from({ length: parsed.iterations }, (_, iteration) => {
    const mirrors = parsed.mirrored ? (["original", "mirrored"] as const) : (["original"] as const);
    return mirrors.map((mirror) => {
      const fightRequest = requestFor(parsed.baseRequest, iteration, mirror);
      return {
        schemaVersion: "simulation-contracts:v1" as const,
        iteration,
        mirror,
        pairId: canonicalHash([
          fightRequest.templateA.id,
          fightRequest.templateB.id,
          fightRequest.profileA.identity.id,
          fightRequest.profileB.identity.id,
          iteration,
        ]),
        request: fightRequest,
      };
    });
  }).flat();
  return Object.freeze(specs);
};

export const runSimulationSeries = (request: SimulationSeriesRequest): SimulationSeriesResult => {
  const parsed = simulationSeriesRequestSchema.parse(request);
  const specs = createSimulationFightSpecs(parsed);
  const manifestRequest = {
    seriesId: parsed.seriesId,
    baseRequest: parsed.baseRequest,
    iterations: parsed.iterations,
    mirrored: parsed.mirrored,
    stoppingPolicy: parsed.stoppingPolicy,
  };
  const suppliedCheckpoint = parsed.checkpoint;
  const validatedCheckpoint = suppliedCheckpoint
    ? validateSimulationCheckpoint(manifestRequest, suppliedCheckpoint)
    : undefined;
  if (validatedCheckpoint && !validatedCheckpoint.ok)
    throw new RangeError(
      `${validatedCheckpoint.error.type}: checkpoint does not match the requested series manifest.`,
    );
  const checkpoint = validatedCheckpoint?.value;
  const resumedIdentities = new Set(
    checkpoint?.entries
      .filter((entry) => entry.status === "completed")
      .map((entry) => entry.fightIdentity),
  );
  const pendingSpecs = specs.filter(
    (spec) => !resumedIdentities.has(simulationFightIdentity(spec)),
  );
  const progressOffset = specs.length - pendingSpecs.length;
  const coordinated = runSimulationRequests({
    requests: pendingSpecs.map((spec) => spec.request),
    stoppingPolicy: parsed.stoppingPolicy,
    concurrency: parsed.concurrency,
    control: parsed.control,
    onProgress: parsed.onProgress
      ? (progress) =>
          parsed.onProgress?.({
            ...progress,
            completed: progress.completed + progressOffset,
            total: specs.length,
          })
      : undefined,
  });
  const currentCheckpoint = createSimulationCheckpoint(manifestRequest, {
    specs: pendingSpecs,
    results: coordinated.results,
  });
  const mergedCheckpoint = checkpoint
    ? mergeSimulationCheckpoints(checkpoint, currentCheckpoint)
    : currentCheckpoint;
  const completedEntries = mergedCheckpoint.entries.filter((entry) => entry.status === "completed");
  const completedCount = completedEntries.filter(
    (entry) => entry.terminationReason === "engine-completed",
  ).length;
  const completedIdentities = new Set(completedEntries.map((entry) => entry.fightIdentity));
  const incompletePairCount = parsed.mirrored
    ? Array.from({ length: parsed.iterations }, (_, iteration) => {
        const pair = specs.filter((spec) => spec.iteration === iteration);
        return !pair.every((spec) => completedIdentities.has(simulationFightIdentity(spec)));
      }).filter(Boolean).length
    : 0;
  return {
    schemaVersion: "simulation-contracts:v1",
    seriesId: parsed.seriesId,
    specs: pendingSpecs,
    results: coordinated.results,
    stoppedEarly: coordinated.stoppedEarly,
    completedCount,
    incompletePairCount,
    resumedFightCount: progressOffset,
    checkpoint: mergedCheckpoint,
    seriesHash: canonicalHash({
      seriesId: parsed.seriesId,
      manifestHash: mergedCheckpoint.manifestHash,
      entries: mergedCheckpoint.entries,
    }),
  };
};

export const resumeSimulationSeries = (
  request: Omit<SimulationSeriesRequest, "checkpoint">,
  checkpoint: SimulationSeriesResult["checkpoint"],
): SimulationSeriesResult => runSimulationSeries({ ...request, checkpoint });
