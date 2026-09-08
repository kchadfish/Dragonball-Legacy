import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  reviewCustomMove,
  runSimulationFight,
  runSimulationMatrix,
  runSimulationSeries,
  createSimulationMoveBalanceReport,
  createSimulationMoveDossiers,
  renderSimulationReportCsv,
  renderSimulationReportJson,
  renderSimulationReportMarkdown,
  renderSimulationMoveDossiersJson,
  renderSimulationMoveDossiersMarkdown,
  createSimulationCompletionAudit,
  DEFAULT_CUSTOM_MOVE_HARNESS_OPTIONS,
  executeCustomMoveHarness,
  simulationMoveCoverageArtifactSchema,
  validateSimulationCoverageCells,
  validateSimulationMoveClosure,
  verifySimulationReplay,
  runSimulationMoveCoverageCatalog,
  nextSimulationCoveragePrecisionLook,
  resumeSimulationMoveCoverage,
  SIMULATION_NATURAL_COVERAGE_DEFAULT_TARGET_PAIRS,
  SIMULATION_MOVE_COVERAGE_POPULATIONS,
  simulationNaturalCoverageMinimumEligibleStatesFor,
  runSimulationBenchmark,
  runSimulationCoverageBenchmark,
  runSimulationNaturalThroughputBenchmark,
  canonicalHash,
  canonicalJson,
  createSimulationDashboard,
  createSimulationDashboardFromBundle,
  createSimulationStatisticsBundleV1,
  readSimulationStatisticsBundleV1,
  readSimulationStatisticsArtifactV4,
  renderSimulationDashboardCsv,
  renderSimulationDashboardJson,
  renderSimulationDashboardMarkdown,
  createSimulationSourceDossiers,
  renderSimulationSourceDossiersJson,
  renderSimulationSourceDossiersMarkdown,
  runSimulationStatisticsCatalogV4,
  resumeSimulationStatisticsCatalogV4,
  simulationV4CatalogCheckpointSchema,
  validateSimulationStatisticsCatalogV4Closure,
  validateSimulationStatisticsBundleV1Closure,
  ALL_SIMULATION_TEMPLATES,
} from "../packages/simulation/src/index.js";
import type {
  SimulationFightRequest,
  SimulationMatrixRequest,
  SimulationSeriesRequest,
  SimulationCoveragePopulation,
  SimulationNaturalAiProfile,
  SimulationMoveCoverageExposureContext,
} from "../packages/simulation/src/index.js";

const usage = `Usage: npm run simulate -- <command> [--format json|csv|markdown]

Commands: fight, series, matrix, catalog, catalog-run, resume, replay, report, dashboard, bundle, dry-run, move-report, dossiers, closure, freshness, custom-review, custom-run, benchmark
v4 catalog: --schedule natural|controlled|diagnostic (catalog defaults to natural)
Coverage selectors: --population, --populations, --natural-profile, --exposure-contexts, --moves, --target-pairs, --output, --retry-failed
Closure purpose: --purpose=screening|production (production is the default)
Deprecated compatibility alias: --target-fights (do not provide both)`;

const optionFor = (args: readonly string[], name: string): string | undefined => {
  const inline = args.find((argument) => argument.startsWith(`${name}=`));
  if (inline !== undefined) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};

const hasOption = (args: readonly string[], name: string): boolean =>
  args.some((argument) => argument === name || argument.startsWith(`${name}=`));

const formatFor = (args: readonly string[]): "json" | "csv" | "markdown" => {
  const value = optionFor(args, "--format");
  if (value === undefined || value === "json" || value === "csv" || value === "markdown")
    return value ?? "json";
  throw new RangeError(`Unsupported report format: ${value}`);
};

const writeBundle = async (name: string, content: string): Promise<void> => {
  const runId = `cli-${Date.now()}`;
  const outputPath = join("artifacts", "simulation", runId, name);
  await writeFile(outputPath, content, "utf8").catch(async (error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join("artifacts", "simulation", runId), { recursive: true });
    await writeFile(outputPath, content, "utf8");
  });
  console.log(outputPath);
};

const atomicWrite = async (path: string, content: string): Promise<void> => {
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, content, "utf8");
  await rename(temporaryPath, path);
};

const atomicWriteSync = (path: string, content: string): void => {
  const temporaryPath = `${path}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, content, "utf8");
  renameSync(temporaryPath, path);
};

const dashboardPathsFor = (
  artifactPath: string,
): {
  readonly json: string;
  readonly csv: string;
  readonly markdown: string;
} => {
  const base = artifactPath.endsWith(".json") ? artifactPath.slice(0, -5) : artifactPath;
  return {
    json: `${base}-dashboard.json`,
    csv: `${base}-dashboard.csv`,
    markdown: `${base}-dashboard.md`,
  };
};

const writeStatisticsDashboards = async (
  artifactPath: string,
  artifact: ReturnType<typeof readSimulationStatisticsArtifactV4>,
): Promise<void> => {
  const dashboard = createSimulationDashboard(artifact);
  const paths = dashboardPathsFor(artifactPath);
  await Promise.all([
    atomicWrite(paths.json, `${renderSimulationDashboardJson(dashboard)}\n`),
    atomicWrite(paths.csv, renderSimulationDashboardCsv(dashboard)),
    atomicWrite(paths.markdown, renderSimulationDashboardMarkdown(dashboard)),
  ]);
};

const inputFor = async (args: readonly string[]): Promise<Record<string, unknown>> => {
  const path = optionFor(args, "--input");
  if (path === undefined)
    throw new RangeError("Simulation command requires --input <manifest.json>.");
  const value = JSON.parse(
    await (await import("node:fs/promises")).readFile(path, "utf8"),
  ) as unknown;
  if (value === null || typeof value !== "object")
    throw new TypeError("Simulation input must be an object.");
  return value as Record<string, unknown>;
};

const coverageArtifactFor = async (path = "docs/architecture/simulation-move-coverage.json") =>
  simulationMoveCoverageArtifactSchema.parse(JSON.parse(await readFile(path, "utf8")) as unknown);

const statisticsArtifactFor = async (path: string | undefined) =>
  readSimulationStatisticsArtifactV4(
    JSON.parse(
      await readFile(path ?? "artifacts/simulation/catalog-v4-natural-100.json", "utf8"),
    ) as unknown,
  );

const dashboardContentFor = (
  artifact: ReturnType<typeof readSimulationStatisticsArtifactV4>,
  format: "json" | "csv" | "markdown",
): string => {
  const dashboard = createSimulationDashboard(artifact);
  return format === "csv"
    ? renderSimulationDashboardCsv(dashboard)
    : format === "markdown"
      ? renderSimulationDashboardMarkdown(dashboard)
      : `${renderSimulationDashboardJson(dashboard)}\n`;
};

const positiveOption = (args: readonly string[], name: string, fallback: number): number => {
  const value = optionFor(args, name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new RangeError(`${name} requires a positive integer.`);
  return parsed;
};

const targetPairsOption = (args: readonly string[], fallback: number): number => {
  if (hasOption(args, "--target-pairs") && hasOption(args, "--target-fights"))
    throw new RangeError("Use either --target-pairs or deprecated --target-fights, not both.");
  return hasOption(args, "--target-pairs")
    ? positiveOption(args, "--target-pairs", fallback)
    : positiveOption(args, "--target-fights", fallback);
};

const unsignedOption = (args: readonly string[], name: string, fallback: number): number => {
  const value = optionFor(args, name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 2 ** 32 - 1)
    throw new RangeError(`${name} requires an unsigned 32-bit integer.`);
  return parsed;
};

const customHarnessOptionsFor = (args: readonly string[]) => ({
  schemaVersion: DEFAULT_CUSTOM_MOVE_HARNESS_OPTIONS.schemaVersion,
  rootSeed: unsignedOption(args, "--root-seed", DEFAULT_CUSTOM_MOVE_HARNESS_OPTIONS.rootSeed),
  pairCount: positiveOption(args, "--pair-count", DEFAULT_CUSTOM_MOVE_HARNESS_OPTIONS.pairCount),
  maximumBuilds: positiveOption(
    args,
    "--maximum-builds",
    DEFAULT_CUSTOM_MOVE_HARNESS_OPTIONS.maximumBuilds,
  ),
  workers: positiveOption(args, "--workers", DEFAULT_CUSTOM_MOVE_HARNESS_OPTIONS.workers),
  maximumTurns: positiveOption(
    args,
    "--maximum-turns",
    DEFAULT_CUSTOM_MOVE_HARNESS_OPTIONS.maximumTurns,
  ),
  maximumTransitions: positiveOption(
    args,
    "--maximum-transitions",
    DEFAULT_CUSTOM_MOVE_HARNESS_OPTIONS.maximumTransitions,
  ),
  semanticNoProgressLimit: positiveOption(
    args,
    "--semantic-no-progress-limit",
    DEFAULT_CUSTOM_MOVE_HARNESS_OPTIONS.semanticNoProgressLimit,
  ),
  bootstrapResamples: positiveOption(
    args,
    "--bootstrap-resamples",
    DEFAULT_CUSTOM_MOVE_HARNESS_OPTIONS.bootstrapResamples,
  ),
  fixedTime: optionFor(args, "--fixed-time") ?? DEFAULT_CUSTOM_MOVE_HARNESS_OPTIONS.fixedTime,
});

const catalogPopulationFor = (
  args: readonly string[],
): SimulationCoveragePopulation | undefined => {
  const value = optionFor(args, "--population");
  if (value === undefined) return undefined;
  if (value !== "natural" && value !== "isolation" && value !== "forced")
    throw new RangeError("Catalog population must be natural, isolation, or forced.");
  return value;
};

const naturalProfileFor = (args: readonly string[]): SimulationNaturalAiProfile | undefined => {
  const value = optionFor(args, "--natural-profile");
  if (value === undefined) return undefined;
  if (
    value !== "profile:normal" &&
    value !== "profile:hard" &&
    value !== "profile:simulation-quality"
  )
    throw new RangeError(
      "--natural-profile must be profile:normal, profile:hard, or profile:simulation-quality.",
    );
  return value;
};

const exposureContextsFor = (
  args: readonly string[],
): readonly SimulationMoveCoverageExposureContext[] | undefined => {
  const value = optionFor(args, "--exposure-contexts") ?? optionFor(args, "--exposure-context");
  if (value === undefined) return undefined;
  const contexts = value
    .split(",")
    .map((context) => context.trim())
    .filter(Boolean) as SimulationMoveCoverageExposureContext[];
  const allowedContexts = new Set<string>([
    "target-present",
    "target-removed",
    "comparable-replacement",
  ]);
  if (contexts.length === 0 || contexts.some((context) => !allowedContexts.has(context)))
    throw new RangeError(
      "--exposure-contexts must contain target-present, target-removed, or comparable-replacement.",
    );
  if (new Set(contexts).size !== contexts.length)
    throw new RangeError("--exposure-contexts values must be unique.");
  return contexts;
};

const dateForRequest = (value: Record<string, unknown>): Record<string, unknown> => ({
  ...value,
  fixedTime: new Date(value.fixedTime as string),
});

const dateForSeries = (value: Record<string, unknown>): Record<string, unknown> => ({
  ...value,
  baseRequest: dateForRequest(value.baseRequest as Record<string, unknown>),
});

const main = async (): Promise<void> => {
  const [command = "help", ...args] = process.argv.slice(2);
  if (command === "help" || command === "--help") {
    console.log(usage);
    return;
  }
  if (
    ![
      "fight",
      "series",
      "matrix",
      "catalog",
      "catalog-run",
      "resume",
      "replay",
      "report",
      "dashboard",
      "bundle",
      "dry-run",
      "move-report",
      "dossiers",
      "closure",
      "freshness",
      "custom-review",
      "custom-run",
      "benchmark",
    ].includes(command)
  )
    throw new RangeError(`Unknown simulation command: ${command}`);
  if (command === "move-report") {
    const artifact = await coverageArtifactFor(optionFor(args, "--artifact"));
    const report = createSimulationMoveBalanceReport(artifact.dataset, undefined, {
      errors: artifact.errors,
      coverageCells: artifact.coverageCells,
      metricsByMove: artifact.metricsByMove,
      metricsByStratum: artifact.metricsByStratum,
      stratifiedAccumulators: artifact.stratifiedAccumulators,
      stratifiedAccumulatorsByStratum: artifact.stratifiedAccumulatorsByStratum,
      generatedFrom: artifact.generatedFrom,
    });
    const format = formatFor(args);
    const content =
      format === "csv"
        ? renderSimulationReportCsv(report)
        : format === "markdown"
          ? renderSimulationReportMarkdown(report)
          : renderSimulationReportJson(report);
    await writeBundle(`move-balance.${format === "markdown" ? "md" : format}`, content);
    return;
  }
  if (command === "dashboard") {
    const artifactPath =
      optionFor(args, "--artifact") ?? "artifacts/simulation/catalog-v4-natural-100.json";
    const raw = JSON.parse(await readFile(artifactPath, "utf8")) as unknown;
    const format = formatFor(args);
    const dashboard =
      (raw as { schemaVersion?: unknown }).schemaVersion === "simulation-statistics-bundle:v1"
        ? createSimulationDashboardFromBundle(readSimulationStatisticsBundleV1(raw))
        : createSimulationDashboard(readSimulationStatisticsArtifactV4(raw));
    const content =
      format === "csv"
        ? renderSimulationDashboardCsv(dashboard)
        : format === "markdown"
          ? renderSimulationDashboardMarkdown(dashboard)
          : `${renderSimulationDashboardJson(dashboard)}\n`;
    const paths = dashboardPathsFor(artifactPath);
    const outputPath =
      optionFor(args, "--output") ??
      (format === "markdown" ? paths.markdown : format === "csv" ? paths.csv : paths.json);
    await mkdir(dirname(outputPath), { recursive: true });
    await atomicWrite(outputPath, content);
    console.log(outputPath);
    return;
  }
  if (command === "bundle") {
    const artifactForOption = async (name: string, fallback: string) => {
      const path = optionFor(args, name) ?? fallback;
      return readSimulationStatisticsArtifactV4(JSON.parse(await readFile(path, "utf8")));
    };
    const checkpointHashFor = async (name: string, fallback: string): Promise<string> => {
      const path = optionFor(args, name) ?? fallback;
      return simulationV4CatalogCheckpointSchema.parse(
        JSON.parse(await readFile(path, "utf8")) as unknown,
      ).checkpointHash;
    };
    const [natural, controlled, diagnostic, naturalHash, controlledHash, diagnosticHash] =
      await Promise.all([
        artifactForOption("--natural", "artifacts/simulation/catalog-v4-natural-100.json"),
        artifactForOption("--controlled", "artifacts/simulation/catalog-v4-controlled-100.json"),
        artifactForOption("--diagnostic", "artifacts/simulation/catalog-v4-diagnostic-100.json"),
        checkpointHashFor(
          "--natural-checkpoint",
          "artifacts/simulation/catalog-v4-natural-100.json.checkpoint.json",
        ),
        checkpointHashFor(
          "--controlled-checkpoint",
          "artifacts/simulation/catalog-v4-controlled-100.json.checkpoint.json",
        ),
        checkpointHashFor(
          "--diagnostic-checkpoint",
          "artifacts/simulation/catalog-v4-diagnostic-100.json.checkpoint.json",
        ),
      ]);
    const bundle = createSimulationStatisticsBundleV1({
      natural,
      controlled,
      diagnostic,
      checkpointHashes: {
        natural: naturalHash,
        controlled: controlledHash,
        diagnostic: diagnosticHash,
      },
    });
    const outputPath =
      optionFor(args, "--output") ?? "artifacts/simulation/catalog-v4-bundle-100.json";
    await mkdir(dirname(outputPath), { recursive: true });
    await atomicWrite(outputPath, `${canonicalJson(bundle)}\n`);
    const dashboard = createSimulationDashboardFromBundle(bundle);
    const dashboardPaths = dashboardPathsFor(outputPath);
    await Promise.all([
      atomicWrite(dashboardPaths.json, `${renderSimulationDashboardJson(dashboard)}\n`),
      atomicWrite(dashboardPaths.csv, renderSimulationDashboardCsv(dashboard)),
      atomicWrite(dashboardPaths.markdown, renderSimulationDashboardMarkdown(dashboard)),
    ]);
    console.log(outputPath);
    return;
  }
  if (command === "dry-run") {
    const targetPairs = targetPairsOption(args, 100);
    const schedule = optionFor(args, "--schedule");
    if (schedule !== undefined && !["natural", "controlled", "diagnostic"].includes(schedule))
      throw new RangeError("--schedule must be natural, controlled, or diagnostic.");
    const scheduleCount = schedule === undefined ? 3 : 1;
    const controlledBranchCount = schedule === undefined || schedule === "controlled" ? 2 : 1;
    const armScheduleCount = schedule === undefined ? 4 : controlledBranchCount;
    const templateCount = ALL_SIMULATION_TEMPLATES().length;
    const cellCount = (templateCount * (templateCount - 1)) / 2;
    const fightCount = cellCount * targetPairs * 2 * armScheduleCount;
    const assumedMillisecondsPerFight = positiveOption(args, "--milliseconds-per-fight", 3_500);
    console.log(
      JSON.stringify({
        schemaVersion: "simulation-statistics-dry-run:v1",
        templateCount,
        cellCount,
        scheduleCount,
        controlledBranchCount,
        armScheduleCount,
        targetPairs,
        mirroredFightCount: fightCount,
        assumedMillisecondsPerFight,
        estimatedRuntimeSeconds: Math.ceil((fightCount * assumedMillisecondsPerFight) / 1_000),
        maximumSparsePairsPerCell: 400,
      }),
    );
    return;
  }
  if (command === "freshness") {
    const artifact = await statisticsArtifactFor(optionFor(args, "--artifact"));
    const { artifactHash, ...withoutHash } = artifact;
    const expectedHash = canonicalHash(withoutHash);
    if (expectedHash !== artifactHash)
      throw new Error(`v4 statistics artifact hash mismatch: expected ${expectedHash}.`);
    const dashboard = createSimulationDashboard(artifact);
    console.log(
      JSON.stringify({
        schemaVersion: artifact.schemaVersion,
        artifactHash,
        dashboardHash: dashboard.dashboardHash,
        targetPairs: artifact.generatedFrom.targetPairs,
      }),
    );
    return;
  }
  if (command === "closure") {
    const v4ArtifactPath = optionFor(args, "--artifact");
    if (v4ArtifactPath !== undefined) {
      const raw = JSON.parse(await readFile(v4ArtifactPath, "utf8")) as { schemaVersion?: unknown };
      if (raw.schemaVersion === "simulation-statistics-bundle:v1") {
        const issues = validateSimulationStatisticsBundleV1Closure(raw);
        if (issues.length > 0) throw new Error(`v4 bundle closure failed:\n${issues.join("\n")}`);
        console.log(JSON.stringify({ schemaVersion: raw.schemaVersion, closure: "complete" }));
        return;
      }
      if (raw.schemaVersion === "simulation-statistics-artifact:v4") {
        const artifact = readSimulationStatisticsArtifactV4(raw);
        const checkpointPath = optionFor(args, "--checkpoint");
        const checkpoint =
          checkpointPath === undefined
            ? undefined
            : simulationV4CatalogCheckpointSchema.parse(
                JSON.parse(await readFile(checkpointPath, "utf8")) as unknown,
              );
        const issues = validateSimulationStatisticsCatalogV4Closure(artifact, checkpoint);
        if (issues.length > 0) throw new Error(`v4 closure failed:\n${issues.join("\n")}`);
        console.log(JSON.stringify({ schemaVersion: artifact.schemaVersion, closure: "complete" }));
        return;
      }
    }
    const artifact = await coverageArtifactFor(optionFor(args, "--artifact"));
    const purpose = optionFor(args, "--purpose") ?? "production";
    if (purpose !== "screening" && purpose !== "production")
      throw new RangeError("Closure purpose must be screening or production.");
    const allowsNaturalNotScheduled =
      artifact.generatedFrom.naturalPopulation === "draft" &&
      artifact.generatedFrom.naturalPopulationBlocker !== undefined;
    const artifactPopulations =
      artifact.generatedFrom.population !== undefined
        ? [artifact.generatedFrom.population]
        : artifact.generatedFrom.populationRunCounts === undefined
          ? undefined
          : SIMULATION_MOVE_COVERAGE_POPULATIONS.filter(
              (population) => artifact.generatedFrom.populationRunCounts?.[population] !== 0,
            );
    const populations =
      purpose === "screening" && artifactPopulations?.length === 1
        ? artifactPopulations
        : undefined;
    const validationOptions = {
      allowNaturalNotScheduled: allowsNaturalNotScheduled,
      ...(populations === undefined ? {} : { populations }),
    } as const;
    const issues = [
      ...validateSimulationMoveClosure(artifact.dataset, {}, undefined, {
        ...validationOptions,
      }),
      ...validateSimulationCoverageCells(artifact.coverageCells, validationOptions),
    ];
    const audit = createSimulationCompletionAudit(artifact.dataset, artifact.coverageCells, {
      ...validationOptions,
      purpose,
      errors: artifact.errors,
    });
    if (!audit.complete) issues.push(...audit.issues.filter((issue) => !issues.includes(issue)));
    if (issues.length > 0) throw new Error(`Move closure is incomplete:\n${issues.join("\n")}`);
    console.log(
      purpose === "screening"
        ? "Simulation screening closure is complete; this is not production certification."
        : "Simulation production closure is complete.",
    );
    return;
  }
  if (command === "dossiers") {
    const artifactPath = optionFor(args, "--artifact");
    if (artifactPath !== undefined) {
      const value = JSON.parse(await readFile(artifactPath, "utf8")) as { schemaVersion?: unknown };
      if (value.schemaVersion === "simulation-statistics-artifact:v4") {
        const artifact = readSimulationStatisticsArtifactV4(value);
        const format = formatFor(args);
        if (format === "csv")
          throw new RangeError("v4 dossiers support json or markdown format only.");
        const dossiers = createSimulationSourceDossiers(artifact);
        await writeBundle(
          `catalog-dossiers.${format === "markdown" ? "md" : "json"}`,
          format === "markdown"
            ? `${renderSimulationSourceDossiersMarkdown(dossiers)}\n`
            : `${renderSimulationSourceDossiersJson(dossiers)}\n`,
        );
        return;
      }
    }
    const artifact = await coverageArtifactFor(artifactPath);
    const dossiers = createSimulationMoveDossiers(artifact.dataset, {
      errors: artifact.errors,
      coverageCells: artifact.coverageCells,
      metricsByMove: artifact.metricsByMove,
      metricsByStratum: artifact.metricsByStratum,
      stratifiedAccumulators: artifact.stratifiedAccumulators,
      stratifiedAccumulatorsByStratum: artifact.stratifiedAccumulatorsByStratum,
      generatedFrom: artifact.generatedFrom,
    });
    const format = formatFor(args);
    if (format === "csv") throw new RangeError("Dossiers support json or markdown format only.");
    const content =
      format === "markdown"
        ? renderSimulationMoveDossiersMarkdown(dossiers)
        : `${renderSimulationMoveDossiersJson(dossiers)}\n`;
    await writeBundle(`catalog-dossiers.${format === "markdown" ? "md" : "json"}`, content);
    return;
  }
  if (command === "benchmark") {
    const preset = optionFor(args, "--preset") ?? "fast";
    if (preset === "natural-v3-throughput") {
      const benchmark = runSimulationNaturalThroughputBenchmark();
      await writeBundle("natural-v3-throughput.json", `${canonicalJson(benchmark)}\n`);
      return;
    }
    if (preset === "catalog-v3") {
      const benchmarkStarted = Date.now();
      const benchmarkResult = runSimulationCoverageBenchmark();
      const benchmark = {
        ...benchmarkResult,
        elapsedMilliseconds: Date.now() - benchmarkStarted,
        resultHash: canonicalHash({
          ...benchmarkResult,
          elapsedMilliseconds: undefined,
          resultHash: undefined,
        }),
      };
      await writeBundle("coverage-benchmark.json", `${canonicalJson(benchmark)}\n`);
      return;
    }
    if (
      preset !== "fast" &&
      preset !== "long" &&
      preset !== "transformation" &&
      preset !== "control-heavy"
    )
      throw new RangeError(
        "Benchmark preset must be fast, long, transformation, control-heavy, catalog-v3, or natural-v3-throughput.",
      );
    const benchmarkStarted = Date.now();
    const benchmarkResult = runSimulationBenchmark({
      benchmarkId: preset,
      iterations: positiveOption(args, "--iterations", 1),
    });
    const elapsedMilliseconds = Date.now() - benchmarkStarted;
    const measuredBenchmark = {
      ...benchmarkResult,
      elapsedMilliseconds,
      averageMilliseconds: Number((elapsedMilliseconds / benchmarkResult.iterations).toFixed(3)),
      benchmarkHash: "",
    };
    const benchmark = {
      ...measuredBenchmark,
      benchmarkHash: canonicalHash({ ...measuredBenchmark, benchmarkHash: undefined }),
    };
    await writeBundle("benchmark.json", `${canonicalJson(benchmark)}\n`);
    return;
  }
  if (command === "custom-run") {
    if (formatFor(args) !== "json")
      throw new RangeError("Custom harness output supports json only.");
    const dossier = executeCustomMoveHarness(await inputFor(args), customHarnessOptionsFor(args));
    await writeBundle("custom-move-dossier.json", `${canonicalJson(dossier)}\n`);
    return;
  }
  if (command === "catalog" || command === "catalog-run") {
    if (command === "catalog") {
      const targetPairs = targetPairsOption(args, 100);
      const workers = hasOption(args, "--workers") ? positiveOption(args, "--workers", 1) : 1;
      const schedule = optionFor(args, "--schedule") ?? "natural";
      if (schedule !== "natural" && schedule !== "controlled" && schedule !== "diagnostic")
        throw new RangeError("--schedule must be natural, controlled, or diagnostic.");
      const outputPath =
        optionFor(args, "--output") ??
        join("artifacts", "simulation", `catalog-v4-${schedule}-${targetPairs}.json`);
      const checkpointPath = `${outputPath}.checkpoint.json`;
      const result = runSimulationStatisticsCatalogV4({
        targetPairs,
        workers,
        schedule,
        onCheckpoint: (checkpoint) =>
          atomicWriteSync(checkpointPath, `${canonicalJson(checkpoint)}\n`),
      });
      if (outputPath.trim().length === 0) throw new RangeError("--output requires a path.");
      await mkdir(dirname(outputPath), { recursive: true });
      await atomicWrite(outputPath, `${canonicalJson(result.artifact)}\n`);
      await writeStatisticsDashboards(outputPath, result.artifact);
      console.log(outputPath);
      return;
    }
    const population = catalogPopulationFor(args);
    const moveOption = optionFor(args, "--moves");
    const populationsOption = optionFor(args, "--populations");
    const sourceArtifactPath = optionFor(args, "--artifact");
    const sourceArtifact =
      sourceArtifactPath === undefined ? undefined : await coverageArtifactFor(sourceArtifactPath);
    const outputPath = optionFor(args, "--output");
    if (population !== undefined && populationsOption !== undefined)
      throw new RangeError("Use either --population or --populations, not both.");
    const naturalOnly =
      population === "natural" ||
      (populationsOption !== undefined &&
        populationsOption.split(",").filter(Boolean).length === 1 &&
        populationsOption.split(",").filter(Boolean)[0] === "natural");
    const targetPairs = targetPairsOption(
      args,
      naturalOnly ? SIMULATION_NATURAL_COVERAGE_DEFAULT_TARGET_PAIRS : 250,
    );
    const coverageOptions = {
      targetPairs,
      minimumEligibleStates: positiveOption(
        args,
        "--minimum-eligible",
        naturalOnly ? simulationNaturalCoverageMinimumEligibleStatesFor(targetPairs) : 250,
      ),
      concurrency: hasOption(args, "--workers") ? positiveOption(args, "--workers", 1) : 1,
      ...(hasOption(args, "--workers") ? { workers: positiveOption(args, "--workers", 1) } : {}),
      population,
      ...(hasOption(args, "--natural-approval")
        ? {
            naturalOverlayApprovalReference: optionFor(args, "--natural-approval") ?? "",
          }
        : {}),
      ...(hasOption(args, "--natural-profile")
        ? {
            naturalProfileId: naturalProfileFor(args),
          }
        : {}),
      ...(hasOption(args, "--exposure-contexts") || hasOption(args, "--exposure-context")
        ? { exposureContexts: exposureContextsFor(args) }
        : {}),
      retryFailed: hasOption(args, "--retry-failed"),
      moveIds: moveOption === undefined ? undefined : moveOption.split(",").filter(Boolean),
    };
    const selectedPopulations: readonly SimulationCoveragePopulation[] =
      populationsOption === undefined
        ? [
            population ?? "natural",
            ...(population === undefined ? (["isolation", "forced"] as const) : []),
          ]
        : (populationsOption.split(",").filter(Boolean) as SimulationCoveragePopulation[]);
    const result = runSimulationMoveCoverageCatalog({
      ...coverageOptions,
      ...(sourceArtifact === undefined ? {} : { resumeFrom: sourceArtifact }),
      ...(outputPath === undefined
        ? {}
        : {
            onCheckpoint: (artifact) => atomicWriteSync(outputPath, `${canonicalJson(artifact)}\n`),
          }),
      populations: selectedPopulations,
    });
    if (outputPath === undefined) {
      await writeBundle("catalog-coverage.json", `${canonicalJson(result.artifact)}\n`);
    } else {
      if (outputPath.trim().length === 0) throw new RangeError("--output requires a path.");
      await mkdir(dirname(outputPath), { recursive: true });
      await atomicWrite(outputPath, `${canonicalJson(result.artifact)}\n`);
      console.log(outputPath);
    }
    return;
  }
  if (command === "fight") {
    await writeBundle(
      "fight.json",
      JSON.stringify(
        runSimulationFight(
          dateForRequest(await inputFor(args)) as unknown as SimulationFightRequest,
        ),
      ),
    );
    return;
  }
  if (command === "series") {
    await writeBundle(
      "series.json",
      JSON.stringify(
        runSimulationSeries(
          dateForSeries(await inputFor(args)) as unknown as SimulationSeriesRequest,
        ),
      ),
    );
    return;
  }
  if (command === "resume") {
    const artifactPath = optionFor(args, "--artifact");
    if (artifactPath !== undefined) {
      const rawArtifact = JSON.parse(await readFile(artifactPath, "utf8")) as {
        schemaVersion?: unknown;
      };
      if (rawArtifact.schemaVersion === "simulation-statistics-checkpoint:v2") {
        const checkpoint = simulationV4CatalogCheckpointSchema.parse(rawArtifact);
        const targetPairs = targetPairsOption(
          args,
          checkpoint.manifest.requestedTargetPairs < 250 ? 250 : 400,
        );
        const evidenceRole = checkpoint.manifest.evidenceRoles[0] ?? "natural-balance";
        const schedule =
          evidenceRole === "controlled"
            ? "controlled"
            : evidenceRole === "diagnostic"
              ? "diagnostic"
              : "natural";
        const outputPath =
          optionFor(args, "--output") ??
          join("artifacts", "simulation", `catalog-v4-${schedule}-${targetPairs}.json`);
        const result = resumeSimulationStatisticsCatalogV4(checkpoint, {
          targetPairs,
          workers: hasOption(args, "--workers") ? positiveOption(args, "--workers", 1) : 1,
          onCheckpoint: (nextCheckpoint) =>
            atomicWriteSync(`${outputPath}.checkpoint.json`, `${canonicalJson(nextCheckpoint)}\n`),
        });
        await mkdir(dirname(outputPath), { recursive: true });
        await atomicWrite(outputPath, `${canonicalJson(result.artifact)}\n`);
        await writeStatisticsDashboards(outputPath, result.artifact);
        console.log(outputPath);
        return;
      }
      if (rawArtifact.schemaVersion === "simulation-statistics-artifact:v4") {
        throw new Error(
          "v4 resume requires the companion simulation-statistics-checkpoint:v2 file; pass that checkpoint with --artifact.",
        );
      }
      const artifact = await coverageArtifactFor(artifactPath);
      const population = catalogPopulationFor(args);
      const targetPairs = targetPairsOption(
        args,
        nextSimulationCoveragePrecisionLook(artifact.generatedFrom.targetPairs),
      );
      const naturalResume =
        population === "natural" || artifact.generatedFrom.population === "natural";
      const minimumEligibleStates = positiveOption(
        args,
        "--minimum-eligible",
        naturalResume
          ? simulationNaturalCoverageMinimumEligibleStatesFor(targetPairs)
          : artifact.generatedFrom.minimumEligibleStates,
      );
      const resumeOptions = {
        targetPairs,
        minimumEligibleStates,
        concurrency: hasOption(args, "--workers") ? positiveOption(args, "--workers", 1) : 4,
        ...(hasOption(args, "--workers") ? { workers: positiveOption(args, "--workers", 1) } : {}),
        ...(hasOption(args, "--natural-approval")
          ? {
              naturalOverlayApprovalReference: optionFor(args, "--natural-approval") ?? "",
            }
          : {}),
        retryFailed: hasOption(args, "--retry-failed"),
        naturalProfileId: naturalProfileFor(args),
        exposureContexts: exposureContextsFor(args),
        moveIds: optionFor(args, "--moves")?.split(",").filter(Boolean),
      };
      const result =
        artifact.generatedFrom.population === undefined
          ? runSimulationMoveCoverageCatalog({
              ...resumeOptions,
              resumeFrom: artifact,
              ...(optionFor(args, "--output") === undefined
                ? {}
                : {
                    onCheckpoint: (checkpoint) =>
                      atomicWriteSync(
                        optionFor(args, "--output")!,
                        `${canonicalJson(checkpoint)}\n`,
                      ),
                  }),
              ...(population === undefined ? {} : { populations: [population] }),
            })
          : resumeSimulationMoveCoverage(artifact, {
              ...resumeOptions,
              population,
              ...(optionFor(args, "--output") === undefined
                ? {}
                : {
                    onCheckpoint: (checkpoint) =>
                      atomicWriteSync(
                        optionFor(args, "--output")!,
                        `${canonicalJson(checkpoint)}\n`,
                      ),
                  }),
            });
      const outputPath = optionFor(args, "--output");
      if (outputPath === undefined)
        await writeBundle("catalog-resume.json", `${canonicalJson(result.artifact)}\n`);
      else {
        if (outputPath.trim().length === 0) throw new RangeError("--output requires a path.");
        await mkdir(dirname(outputPath), { recursive: true });
        await atomicWrite(outputPath, `${canonicalJson(result.artifact)}\n`);
        console.log(outputPath);
      }
      return;
    }
    await writeBundle(
      "series-resume.json",
      JSON.stringify(
        runSimulationSeries(
          dateForSeries(await inputFor(args)) as unknown as SimulationSeriesRequest,
        ),
      ),
    );
    return;
  }
  if (command === "matrix") {
    const input = await inputFor(args);
    const series = (input.series as Record<string, unknown>[]).map(dateForSeries);
    await writeBundle(
      "matrix.json",
      JSON.stringify(
        runSimulationMatrix({ ...input, series } as unknown as SimulationMatrixRequest),
      ),
    );
    return;
  }
  if (command === "replay") {
    const input = await inputFor(args);
    const request = dateForRequest(input.request as Record<string, unknown>);
    await writeBundle(
      "replay-verification.json",
      JSON.stringify(verifySimulationReplay(input.replay, request)),
    );
    return;
  }
  if (command === "report") {
    const artifactPath = optionFor(args, "--artifact");
    const rawArtifact = JSON.parse(
      await readFile(artifactPath ?? "docs/architecture/simulation-move-coverage.json", "utf8"),
    ) as { schemaVersion?: unknown };
    if (rawArtifact.schemaVersion === "simulation-statistics-artifact:v4") {
      const artifact = readSimulationStatisticsArtifactV4(rawArtifact);
      const format = formatFor(args);
      await writeBundle(
        `catalog-report.${format === "markdown" ? "md" : format}`,
        dashboardContentFor(artifact, format),
      );
      return;
    }
    const artifact = await coverageArtifactFor(artifactPath);
    const report = createSimulationMoveBalanceReport(artifact.dataset, undefined, {
      errors: artifact.errors,
      coverageCells: artifact.coverageCells,
      metricsByMove: artifact.metricsByMove,
      metricsByStratum: artifact.metricsByStratum,
      stratifiedAccumulators: artifact.stratifiedAccumulators,
      stratifiedAccumulatorsByStratum: artifact.stratifiedAccumulatorsByStratum,
      generatedFrom: artifact.generatedFrom,
    });
    const format = formatFor(args);
    const content =
      format === "csv"
        ? renderSimulationReportCsv(report)
        : format === "markdown"
          ? renderSimulationReportMarkdown(report)
          : renderSimulationReportJson(report);
    await writeBundle(`catalog-report.${format === "markdown" ? "md" : format}`, content);
    return;
  }
  await writeBundle("custom-review.json", JSON.stringify(reviewCustomMove(await inputFor(args))));
};

await main();
