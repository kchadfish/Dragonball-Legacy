import { canonicalHash } from "./canonical.js";
import type { SimulationFightExecutionResult, SimulationFightRequest } from "./contracts.js";
import { runSimulationFight } from "./runner.js";
import { createScenario } from "./scenarios.js";
import { createSyntheticArchetypes } from "./templates.js";
import { SIMULATION_QUALITY_PROFILE } from "@dragonball-resurgence/ai-engine";
import { CANONICAL_COMBAT_MECHANICS_VIEW } from "@dragonball-resurgence/combat-engine";

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
  fast: manifestFor("fast", "Short deterministic smoke fight.", [1, 200], [1, 2_000], false),
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

export interface SimulationBenchmarkResult {
  readonly schemaVersion: "simulation-benchmark-result:v1";
  readonly benchmarkId: SimulationBenchmarkManifest["benchmarkId"];
  readonly manifestHash: string;
  readonly iterations: number;
  readonly completedCount: number;
  readonly errorCount: number;
  readonly elapsedMilliseconds: number;
  readonly averageMilliseconds: number;
  readonly totalTurns: number;
  readonly totalTransitions: number;
  readonly resultHashes: readonly string[];
  readonly result: "passed" | "failed";
  readonly resultDetails: readonly string[];
  readonly benchmarkHash: string;
}

const familyFor = (
  benchmarkId: SimulationBenchmarkManifest["benchmarkId"],
): "symmetric-control" | "control-versus-resource" | "transformation-timing" => {
  if (benchmarkId === "transformation") return "transformation-timing";
  if (benchmarkId === "control-heavy") return "control-versus-resource";
  return "symmetric-control";
};

export const createSimulationBenchmarkRequest = (
  benchmarkId: SimulationBenchmarkManifest["benchmarkId"],
  rootSeed = 2_026_090_1,
  fixedTime = new Date("2026-01-01T00:00:00.000Z"),
): SimulationFightRequest => {
  const templates = createSyntheticArchetypes();
  let preferredSuffix = "-balanced";
  if (benchmarkId === "transformation") preferredSuffix = "-transformation";
  if (benchmarkId === "control-heavy") preferredSuffix = "-status-control";
  const first = templates.find((template) => template.id.endsWith(preferredSuffix));
  const secondSuffix = benchmarkId === "fast" ? "-glass-cannon" : "-high-dexterity";
  const second = templates.find((template) => template.id.endsWith(secondSuffix));
  if (first === undefined || second === undefined)
    throw new RangeError("Simulation benchmark fixtures are incomplete.");
  const manifest = SIMULATION_BENCHMARK_MANIFESTS[benchmarkId];
  const limits = {
    maximumTurns: manifest.expectedTurns[1],
    maximumTransitions: manifest.expectedTransitions[1],
    semanticNoProgressLimit: 20,
  };
  const scenario = createScenario({
    id: `simulation-scenario:benchmark-${benchmarkId}`,
    family: familyFor(benchmarkId),
    checkpointId: benchmarkId === "transformation" ? "tf1" : "early",
    templateAId: first.id,
    templateBId: second.id,
    variantId: "simulation-variant:baseline",
    retention: manifest.diagnosticRetention ? "diagnostic" : "summary",
    limits,
    stoppingPolicy: "continue",
    deferred: false,
  });
  return {
    schemaVersion: "simulation-contracts:v1",
    runId: `simulation-run:benchmark-${benchmarkId}`,
    scenario,
    templateA: first,
    templateB: second,
    profileA: SIMULATION_QUALITY_PROFILE,
    profileB: SIMULATION_QUALITY_PROFILE,
    rootSeed,
    fixedTime,
    mechanicsView: CANONICAL_COMBAT_MECHANICS_VIEW,
  };
};

const resultHashFor = (result: SimulationFightExecutionResult): string =>
  canonicalHash({
    runId: result.runId,
    terminationReason: result.terminationReason,
    stateHash: result.stateHash,
    eventHash: result.eventHash,
    decisionHash: result.decisionHash,
  });

export const runSimulationBenchmark = (
  options: {
    readonly benchmarkId?: SimulationBenchmarkManifest["benchmarkId"];
    readonly iterations?: number;
    readonly rootSeed?: number;
    readonly fixedTime?: Date;
    /** Wall-clock measurement is supplied by the CLI boundary, not the simulation package. */
    readonly elapsedMilliseconds?: number;
  } = {},
): SimulationBenchmarkResult => {
  const benchmarkId = options.benchmarkId ?? "fast";
  const iterations = options.iterations ?? 1;
  if (!Number.isInteger(iterations) || iterations < 1)
    throw new RangeError("Iterations must be positive.");
  const manifest = SIMULATION_BENCHMARK_MANIFESTS[benchmarkId];
  const base = createSimulationBenchmarkRequest(benchmarkId, options.rootSeed, options.fixedTime);
  const results = Array.from({ length: iterations }, (_, index) =>
    runSimulationFight({
      ...base,
      runId: `${base.runId}-${index + 1}`,
      iteration: index,
      scenario: { ...base.scenario, id: `${base.scenario.id}-${index + 1}` },
    }),
  );
  const elapsedMilliseconds = options.elapsedMilliseconds ?? 0;
  if (!Number.isFinite(elapsedMilliseconds) || elapsedMilliseconds < 0)
    throw new RangeError("Elapsed milliseconds must be a finite non-negative number.");
  const completed = results.filter((result) => result.terminationReason === "engine-completed");
  const details = results
    .filter((result) => result.terminationReason !== "engine-completed")
    .map((result) => `${result.runId}: ${result.terminationReason}`);
  const output = {
    schemaVersion: "simulation-benchmark-result:v1" as const,
    benchmarkId,
    manifestHash: manifest.manifestHash,
    iterations,
    completedCount: completed.length,
    errorCount: iterations - completed.length,
    elapsedMilliseconds,
    averageMilliseconds: Number((elapsedMilliseconds / iterations).toFixed(3)),
    totalTurns: completed.reduce((total, result) => total + result.finalState.turnNumber, 0),
    totalTransitions: completed.reduce(
      (total, result) => total + result.replay.transitionHashes.length,
      0,
    ),
    resultHashes: results.map(resultHashFor).sort((left, right) => left.localeCompare(right)),
    result: details.length === 0 ? ("passed" as const) : ("failed" as const),
    resultDetails: details,
    benchmarkHash: "",
  };
  return {
    ...output,
    benchmarkHash: canonicalHash({ ...output, benchmarkHash: undefined }),
  };
};
