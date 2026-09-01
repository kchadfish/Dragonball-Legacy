import { canonicalHash } from "./canonical.js";
import {
  simulationSeriesCheckpointSchema,
  type SimulationFightRequest,
  type SimulationFightSpec,
  type SimulationSeriesCheckpoint,
  type SimulationSeriesResult,
} from "./contracts.js";

export type SimulationCheckpointValidation =
  | { readonly ok: true; readonly value: SimulationSeriesCheckpoint }
  | {
      readonly ok: false;
      readonly error: {
        readonly type: "malformed-checkpoint" | "checkpoint-manifest-mismatch";
        readonly expectedManifestHash: string;
        readonly actualManifestHash?: string;
      };
    };

const requestIdentityFor = (request: SimulationFightRequest) => ({
  schemaVersion: request.schemaVersion,
  runId: request.runId,
  scenario: request.scenario,
  templateA: { id: request.templateA.id, hash: canonicalHash(request.templateA) },
  templateB: { id: request.templateB.id, hash: canonicalHash(request.templateB) },
  profileA: request.profileA.identity,
  profileB: request.profileB.identity,
  rootSeed: request.rootSeed,
  iteration: request.iteration ?? 0,
  mirror: request.mirror ?? "original",
  fixedTime: request.fixedTime.toISOString(),
  mechanics: request.mechanicsView.identity,
});

export const simulationSeriesManifestHash = (request: {
  readonly seriesId: string;
  readonly baseRequest: SimulationFightRequest;
  readonly iterations: number;
  readonly mirrored: boolean;
  readonly stoppingPolicy: string;
}): string =>
  canonicalHash({
    seriesId: request.seriesId,
    baseRequest: requestIdentityFor(request.baseRequest),
    iterations: request.iterations,
    mirrored: request.mirrored,
    stoppingPolicy: request.stoppingPolicy,
  });

export const simulationFightIdentity = (spec: SimulationFightSpec): string =>
  canonicalHash({
    iteration: spec.iteration,
    mirror: spec.mirror,
    request: requestIdentityFor(spec.request),
  });

const resultHashFor = (result: SimulationSeriesResult["results"][number]): string =>
  result.ok
    ? canonicalHash({
        stateHash: result.value.stateHash,
        eventHash: result.value.eventHash,
        decisionHash: result.value.decisionHash,
        terminationReason: result.value.terminationReason,
      })
    : canonicalHash(result.error);

export const validateSimulationCheckpoint = (
  request: Parameters<typeof simulationSeriesManifestHash>[0],
  checkpoint: unknown,
): SimulationCheckpointValidation => {
  const expectedManifestHash = simulationSeriesManifestHash(request);
  const parsed = simulationSeriesCheckpointSchema.safeParse(checkpoint);
  if (!parsed.success)
    return {
      ok: false,
      error: { type: "malformed-checkpoint", expectedManifestHash },
    };
  if (
    parsed.data.seriesId !== request.seriesId ||
    parsed.data.manifestHash !== expectedManifestHash
  )
    return {
      ok: false,
      error: {
        type: "checkpoint-manifest-mismatch",
        expectedManifestHash,
        actualManifestHash: parsed.data.manifestHash,
      },
    };
  return { ok: true, value: parsed.data };
};

export const createSimulationCheckpoint = (
  request: Parameters<typeof simulationSeriesManifestHash>[0],
  series: Pick<SimulationSeriesResult, "specs" | "results">,
): SimulationSeriesCheckpoint => {
  const entries = series.specs.slice(0, series.results.length).map((spec, index) => {
    const result = series.results[index];
    return result.ok
      ? {
          fightIdentity: simulationFightIdentity(spec),
          resultHash: resultHashFor(result),
          status:
            result.value.terminationReason === "cancelled"
              ? ("error" as const)
              : ("completed" as const),
          terminationReason: result.value.terminationReason,
        }
      : {
          fightIdentity: simulationFightIdentity(spec),
          resultHash: resultHashFor(result),
          status: "error" as const,
        };
  });
  return {
    schemaVersion: "simulation-checkpoint:v1",
    seriesId: request.seriesId,
    manifestHash: simulationSeriesManifestHash(request),
    entries: mergeEntries([], entries),
  };
};

export const mergeSimulationCheckpoints = (
  left: SimulationSeriesCheckpoint,
  right: SimulationSeriesCheckpoint,
): SimulationSeriesCheckpoint => {
  if (left.seriesId !== right.seriesId || left.manifestHash !== right.manifestHash)
    throw new RangeError("Simulation checkpoints must have matching series manifests.");
  return {
    schemaVersion: "simulation-checkpoint:v1",
    seriesId: left.seriesId,
    manifestHash: left.manifestHash,
    entries: mergeEntries(left.entries, right.entries),
  };
};

const mergeEntries = (
  left: readonly SimulationSeriesCheckpoint["entries"][number][],
  right: readonly SimulationSeriesCheckpoint["entries"][number][],
): readonly SimulationSeriesCheckpoint["entries"][number][] => {
  const byIdentity = new Map<string, SimulationSeriesCheckpoint["entries"][number]>();
  for (const entry of [...left, ...right]) {
    const previous = byIdentity.get(entry.fightIdentity);
    if (previous !== undefined && previous.resultHash !== entry.resultHash) {
      if (previous.status !== "error" || entry.status !== "completed")
        throw new RangeError(`Conflicting checkpoint result for ${entry.fightIdentity}.`);
    }
    byIdentity.set(entry.fightIdentity, entry);
  }
  return [...byIdentity.values()].sort((a, b) => a.fightIdentity.localeCompare(b.fightIdentity));
};
