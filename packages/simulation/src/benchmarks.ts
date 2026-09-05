import { canonicalHash } from "./canonical.js";
import type {
  SimulationFailure,
  SimulationFightExecutionResult,
  SimulationFightRequest,
} from "./contracts.js";
import type { SimulationCoveragePopulation } from "./coverage.js";
import { runSimulationFight } from "./runner.js";
import { createScenario } from "./scenarios.js";
import { createSyntheticArchetypes } from "./templates.js";
import { NORMAL_PROFILE, SIMULATION_QUALITY_PROFILE } from "@dragonball-resurgence/ai-engine";
import { CANONICAL_COMBAT_MECHANICS_VIEW } from "@dragonball-resurgence/combat-engine";
import { runSimulationRequestsWithWorkers } from "./coordinator.js";
import {
  createSimulationNaturalCoverageRequests,
  estimateSimulationNaturalCoverageSchedule,
  type SimulationNaturalCoverageScheduleEstimate,
} from "./move-coverage-runner.js";

export const SIMULATION_V3_COVERAGE_BENCHMARK_MOVE_IDS = Object.freeze([
  "move-akaikaru-delta-storm",
  "move-akaikaru-stampede-rush",
] as const);

const SIMULATION_V3_COVERAGE_BENCHMARK_BUDGET_BYTES = 64 * 1024;

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

export interface SimulationCoverageBenchmarkResult {
  readonly schemaVersion: "simulation-coverage-benchmark-result:v1";
  readonly benchmarkId: "catalog-v3";
  readonly workerCount: 4;
  readonly moveIds: typeof SIMULATION_V3_COVERAGE_BENCHMARK_MOVE_IDS;
  readonly populations: readonly SimulationCoveragePopulation[];
  readonly requestCount: number;
  readonly failureCount: number;
  readonly outputBytes: number;
  readonly elapsedMilliseconds: number;
  readonly resultHash: string;
  readonly result: "passed" | "failed";
  readonly resultDetails: readonly string[];
}

const coverageBenchmarkTemplateFor = (
  template: ReturnType<typeof createSyntheticArchetypes>[number],
  id: string,
  maximumHitPoints: number,
) => ({
  ...template,
  id,
  label: `${template.label} v3 coverage benchmark`,
  maximumHitPoints,
  moveIds: [...SIMULATION_V3_COVERAGE_BENCHMARK_MOVE_IDS],
});

const coverageBenchmarkPolicyFor = (population: SimulationCoveragePopulation, moveId: string) => {
  if (population === "natural") return undefined;
  if (population === "forced")
    return {
      type: "forced-target-first" as const,
      targetDefinitionId: moveId,
      fallback: "first-legal" as const,
    };
  return {
    type: "controlled-legal-preference" as const,
    preferredDefinitionIds: [moveId],
    baselineDefinitionId: "move-akaikaru-delta-storm",
    fallback: "first-legal" as const,
  };
};

const coverageBenchmarkRequests = (): readonly SimulationFightRequest[] => {
  const base = createSyntheticArchetypes()[0];
  const attacker = coverageBenchmarkTemplateFor(
    base,
    "simulation-template:coverage-benchmark-a",
    10,
  );
  const opponent = coverageBenchmarkTemplateFor(
    base,
    "simulation-template:coverage-benchmark-b",
    10,
  );
  const limits = { maximumTurns: 30, maximumTransitions: 500, semanticNoProgressLimit: 20 };
  const populations = ["natural", "isolation", "forced"] as const;
  return populations.flatMap((population) =>
    SIMULATION_V3_COVERAGE_BENCHMARK_MOVE_IDS.flatMap((moveId) =>
      (["original", "mirrored"] as const).map((mirror) => {
        const mirrored = mirror === "mirrored";
        const templateA = mirrored ? opponent : attacker;
        const templateB = mirrored ? attacker : opponent;
        const scenario = createScenario({
          id: `simulation-scenario:coverage-benchmark-v3-${population}-${moveId}-${mirror}`,
          family: "move-isolation",
          checkpointId: "early",
          templateAId: templateA.id,
          templateBId: templateB.id,
          variantId: "simulation-variant:baseline",
          retention: "coverage",
          limits,
          stoppingPolicy: "continue",
          deferred: false,
        });
        const policy = coverageBenchmarkPolicyFor(population, moveId);
        return {
          schemaVersion: "simulation-contracts:v1" as const,
          runId: `simulation-run:coverage-benchmark-v3-${population}-${moveId}-${mirror}`,
          scenario,
          templateA,
          templateB,
          profileA: NORMAL_PROFILE,
          profileB: NORMAL_PROFILE,
          rootSeed: 2_026_090_4,
          iteration: 0,
          mirror,
          seedFamilyId: `simulation-seed-family:coverage-benchmark-v3-${population}-${moveId}`,
          fixedTime: new Date("2026-01-01T00:00:00.000Z"),
          mechanicsView: CANONICAL_COMBAT_MECHANICS_VIEW,
          ...(policy === undefined ? {} : { decisionPolicy: policy }),
        } satisfies SimulationFightRequest;
      }),
    ),
  );
};

export interface SimulationNaturalThroughputBenchmarkMeasurement {
  readonly elapsedMilliseconds: number;
  readonly cpuUserMicroseconds: number;
  readonly cpuSystemMicroseconds: number;
  readonly peakMemoryBytes: number;
}

export interface SimulationNaturalThroughputBenchmarkResult {
  readonly schemaVersion: "simulation-natural-throughput-benchmark:v1";
  readonly benchmarkId: "natural-v3-throughput";
  readonly workerCount: 4;
  readonly fightCount: 50;
  readonly schedule: SimulationNaturalCoverageScheduleEstimate;
  readonly elapsedMilliseconds: number;
  readonly cpuUserMicroseconds: number;
  readonly cpuSystemMicroseconds: number;
  readonly peakMemoryBytes: number;
  readonly decisions: number;
  readonly probes: number;
  readonly transitions: number;
  readonly resultHashes: readonly {
    readonly runId: string;
    readonly stateHash: string;
    readonly eventHash: string;
    readonly decisionHash: string;
    readonly randomIdentity: string;
  }[];
  readonly authoritativeResultHash: string;
  readonly projectedFullRunMilliseconds: number;
  readonly projectedFullRunHours: number;
  readonly result: "passed" | "failed";
  readonly resultDetails: readonly string[];
  readonly benchmarkHash: string;
}

/** Production-shaped Normal-AI throughput measurement for one compact batch. */
export const runSimulationNaturalThroughputBenchmark = (
  measurement: Partial<SimulationNaturalThroughputBenchmarkMeasurement> = {},
): SimulationNaturalThroughputBenchmarkResult => {
  for (const [name, value] of Object.entries(measurement))
    if (!Number.isFinite(value) || value < 0)
      throw new RangeError(`Natural benchmark ${name} must be a finite non-negative number.`);
  const started = performance.now();
  const runtimeProcess = (
    globalThis as unknown as {
      readonly process: {
        cpuUsage: (previous?: { user: number; system: number }) => {
          readonly user: number;
          readonly system: number;
        };
        resourceUsage: () => { readonly maxRSS: number };
      };
    }
  ).process;
  const cpuStarted = runtimeProcess.cpuUsage();
  const requests = createSimulationNaturalCoverageRequests({ fightLimit: 50 });
  if (requests.length !== 50) throw new RangeError("Natural benchmark did not produce 50 fights.");
  const schedule = estimateSimulationNaturalCoverageSchedule();
  const totals = { decisions: 0, probes: 0, transitions: 0 };
  const completedByRunId = new Map<
    string,
    | { readonly ok: true; readonly value: SimulationFightExecutionResult }
    | { readonly ok: false; readonly error: SimulationFailure }
  >();
  const coordinated = runSimulationRequestsWithWorkers({
    requests,
    workers: 4,
    stoppingPolicy: "continue",
    retainResults: false,
    onProgress: (progress) => completedByRunId.set(progress.runId, progress.result),
    onMetrics: (metrics) => {
      totals.decisions += metrics.decisions;
      totals.probes += metrics.probes;
      totals.transitions += metrics.transitions;
    },
  });
  const cpuElapsed = runtimeProcess.cpuUsage(cpuStarted);
  const measuredElapsedMilliseconds = performance.now() - started;
  const measuredPeakMemoryBytes = runtimeProcess.resourceUsage().maxRSS * 1024;
  const elapsedMilliseconds = measurement.elapsedMilliseconds ?? measuredElapsedMilliseconds;
  const cpuUserMicroseconds = measurement.cpuUserMicroseconds ?? cpuElapsed.user;
  const cpuSystemMicroseconds = measurement.cpuSystemMicroseconds ?? cpuElapsed.system;
  const peakMemoryBytes = measurement.peakMemoryBytes ?? measuredPeakMemoryBytes;
  const orderedResults = requests.map((request) => completedByRunId.get(request.runId));
  const failures = orderedResults.flatMap((result, index) => {
    if (result === undefined) return [`missing-result:${requests[index]?.runId ?? index}`];
    if (result.ok) return [];
    return [`${result.error.type}:${JSON.stringify(result.error)}`];
  });
  const resultHashes = orderedResults.flatMap((result) =>
    result?.ok === true
      ? [
          {
            runId: result.value.runId,
            stateHash: result.value.stateHash,
            eventHash: result.value.eventHash,
            decisionHash: result.value.decisionHash,
            randomIdentity: result.value.randomIdentity,
          },
        ]
      : [],
  );
  const authoritativeResultHash = canonicalHash(resultHashes);
  const projectedFullRunMilliseconds =
    (schedule.totalRequiredFights / requests.length) * elapsedMilliseconds;
  const details = [
    ...failures,
    ...(completedByRunId.size !== requests.length ? ["result-count-mismatch"] : []),
    ...(coordinated.stoppedEarly ? ["stopped-early"] : []),
    ...(peakMemoryBytes > 1.5 * 1024 ** 3 ? ["peak-memory-over-budget"] : []),
    ...(projectedFullRunMilliseconds >= 12 * 60 * 60 * 1000
      ? ["projected-duration-over-budget"]
      : []),
  ];
  const result = {
    schemaVersion: "simulation-natural-throughput-benchmark:v1" as const,
    benchmarkId: "natural-v3-throughput" as const,
    workerCount: 4 as const,
    fightCount: 50 as const,
    schedule,
    elapsedMilliseconds,
    cpuUserMicroseconds,
    cpuSystemMicroseconds,
    peakMemoryBytes,
    decisions: totals.decisions,
    probes: totals.probes,
    transitions: totals.transitions,
    resultHashes,
    authoritativeResultHash,
    projectedFullRunMilliseconds,
    projectedFullRunHours: projectedFullRunMilliseconds / (60 * 60 * 1000),
    result: details.length === 0 ? ("passed" as const) : ("failed" as const),
    resultDetails: details,
  };
  return { ...result, benchmarkHash: canonicalHash(result) };
};

/** Stable four-worker acceptance benchmark for compact all-population coverage. */
export const runSimulationCoverageBenchmark = (
  options: {
    /** Wall-clock measurement is supplied by the CLI or test boundary. */
    readonly elapsedMilliseconds?: number;
  } = {},
): SimulationCoverageBenchmarkResult => {
  const requests = coverageBenchmarkRequests();
  const coordinated = runSimulationRequestsWithWorkers({
    requests,
    workers: 4,
    stoppingPolicy: "continue",
    retainResults: true,
  });
  const failures = coordinated.results.flatMap((result) =>
    result.ok ? [] : [`${result.error.type}:${JSON.stringify(result.error)}`],
  );
  const compactResults = coordinated.results.map((result) =>
    result.ok
      ? {
          runId: result.value.runId,
          terminationReason: result.value.terminationReason,
          stateHash: result.value.stateHash,
          eventHash: result.value.eventHash,
          decisionHash: result.value.decisionHash,
          coverage: result.value.coverage,
        }
      : { error: result.error },
  );
  const outputBytes = new TextEncoder().encode(JSON.stringify(compactResults)).byteLength;
  const details = [
    ...failures,
    ...(outputBytes > SIMULATION_V3_COVERAGE_BENCHMARK_BUDGET_BYTES
      ? [`output-budget-exceeded:${outputBytes}`]
      : []),
    ...(coordinated.stoppedEarly ? ["stopped-early"] : []),
  ];
  const elapsedMilliseconds = options.elapsedMilliseconds ?? 0;
  if (!Number.isFinite(elapsedMilliseconds) || elapsedMilliseconds < 0)
    throw new RangeError("Elapsed milliseconds must be a finite non-negative number.");
  return {
    schemaVersion: "simulation-coverage-benchmark-result:v1",
    benchmarkId: "catalog-v3",
    workerCount: 4,
    moveIds: SIMULATION_V3_COVERAGE_BENCHMARK_MOVE_IDS,
    populations: ["natural", "isolation", "forced"],
    requestCount: requests.length,
    failureCount: failures.length,
    outputBytes,
    elapsedMilliseconds,
    resultHash: canonicalHash(compactResults),
    result: details.length === 0 ? "passed" : "failed",
    resultDetails: details,
  };
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
