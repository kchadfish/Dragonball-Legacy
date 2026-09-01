import { canonicalHash } from "./canonical.js";

export interface SimulationBenchmarkManifest {
  readonly schemaVersion: "simulation-benchmark:v1";
  readonly benchmarkId: "fast" | "long" | "transformation" | "control-heavy";
  readonly description: string;
  readonly expectedTurns: readonly [number, number];
  readonly expectedTransitions: readonly [number, number];
  readonly diagnosticRetention: boolean;
  readonly manifestHash: string;
}

const manifestFor = (
  benchmarkId: SimulationBenchmarkManifest["benchmarkId"],
  description: string,
  expectedTurns: readonly [number, number],
  expectedTransitions: readonly [number, number],
  diagnosticRetention: boolean,
): SimulationBenchmarkManifest => ({
  schemaVersion: "simulation-benchmark:v1",
  benchmarkId,
  description,
  expectedTurns,
  expectedTransitions,
  diagnosticRetention,
  manifestHash: canonicalHash({
    schemaVersion: "simulation-benchmark:v1",
    benchmarkId,
    description,
    expectedTurns,
    expectedTransitions,
    diagnosticRetention,
  }),
});

export const SIMULATION_BENCHMARK_MANIFESTS: Readonly<
  Record<SimulationBenchmarkManifest["benchmarkId"], SimulationBenchmarkManifest>
> = Object.freeze({
  fast: manifestFor("fast", "Short deterministic smoke fight.", [1, 4], [1, 32], false),
  long: manifestFor(
    "long",
    "Long bounded fight for transition and memory profiling.",
    [50, 200],
    [100, 2_000],
    false,
  ),
  transformation: manifestFor(
    "transformation",
    "Transformation-timing and cooldown coverage.",
    [10, 100],
    [50, 1_000],
    true,
  ),
  "control-heavy": manifestFor(
    "control-heavy",
    "Pending-response and lockout-heavy fight.",
    [10, 150],
    [50, 1_500],
    true,
  ),
});
