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
  runSimulationBenchmark,
  runSimulationCoverageBenchmark,
  canonicalHash,
  canonicalJson,
} from "../packages/simulation/src/index.js";
import type {
  SimulationFightRequest,
  SimulationMatrixRequest,
  SimulationReplayRecord,
  SimulationSeriesRequest,
  SimulationCoveragePopulation,
  SimulationNaturalAiProfile,
  SimulationMoveCoverageExposureContext,
} from "../packages/simulation/src/index.js";

const usage = `Usage: npm run simulate -- <command> [--format json|csv|markdown]

Commands: fight, series, matrix, catalog-run, resume, replay, report, move-report, dossiers, closure, custom-review, custom-run, benchmark
Coverage selectors: --population, --populations, --natural-profile, --exposure-contexts, --moves, --target-pairs, --output, --retry-failed
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
  if (
    contexts.length === 0 ||
    contexts.some(
      (context) =>
        context !== "target-present" &&
        context !== "target-removed" &&
        context !== "comparable-replacement",
    )
  )
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
      "catalog-run",
      "resume",
      "replay",
      "report",
      "move-report",
      "dossiers",
      "closure",
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
  if (command === "closure") {
    const artifact = await coverageArtifactFor(optionFor(args, "--artifact"));
    const allowsNaturalNotScheduled =
      artifact.generatedFrom.naturalPopulation === "draft" &&
      artifact.generatedFrom.naturalPopulationBlocker !== undefined;
    const issues = [
      ...validateSimulationMoveClosure(artifact.dataset, {}, undefined, {
        allowNaturalNotScheduled: allowsNaturalNotScheduled,
      }),
      ...validateSimulationCoverageCells(artifact.coverageCells, {
        allowNaturalNotScheduled: allowsNaturalNotScheduled,
      }),
    ];
    const audit = createSimulationCompletionAudit(artifact.dataset, artifact.coverageCells, {
      allowNaturalNotScheduled: allowsNaturalNotScheduled,
    });
    if (!audit.complete) issues.push(...audit.issues.filter((issue) => !issues.includes(issue)));
    if (issues.length > 0) throw new Error(`Move closure is incomplete:\n${issues.join("\n")}`);
    console.log("Simulation move closure is complete.");
    return;
  }
  if (command === "dossiers") {
    const artifact = await coverageArtifactFor(optionFor(args, "--artifact"));
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
        "Benchmark preset must be fast, long, transformation, control-heavy, or catalog-v3.",
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
  if (command === "catalog-run") {
    const population = catalogPopulationFor(args);
    const moveOption = optionFor(args, "--moves");
    const populationsOption = optionFor(args, "--populations");
    const sourceArtifactPath = optionFor(args, "--artifact");
    const sourceArtifact =
      sourceArtifactPath === undefined ? undefined : await coverageArtifactFor(sourceArtifactPath);
    const outputPath = optionFor(args, "--output");
    if (population !== undefined && populationsOption !== undefined)
      throw new RangeError("Use either --population or --populations, not both.");
    const coverageOptions = {
      targetPairs: targetPairsOption(args, 250),
      minimumEligibleStates: positiveOption(args, "--minimum-eligible", 250),
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
    const result = runSimulationMoveCoverageCatalog({
      ...coverageOptions,
      ...(sourceArtifact === undefined ? {} : { resumeFrom: sourceArtifact }),
      ...(outputPath === undefined
        ? {}
        : {
            onCheckpoint: (artifact) => atomicWriteSync(outputPath, `${canonicalJson(artifact)}\n`),
          }),
      populations:
        populationsOption === undefined
          ? ([
              population ?? "natural",
              ...(population === undefined ? ["isolation", "forced"] : []),
            ] as const)
          : (populationsOption.split(",").filter(Boolean) as readonly (
              "natural" | "isolation" | "forced"
            )[]),
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
      const artifact = await coverageArtifactFor(artifactPath);
      const targetPairs = targetPairsOption(
        args,
        nextSimulationCoveragePrecisionLook(artifact.generatedFrom.targetPairs),
      );
      const minimumEligibleStates = positiveOption(
        args,
        "--minimum-eligible",
        artifact.generatedFrom.minimumEligibleStates,
      );
      const population = catalogPopulationFor(args);
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
      JSON.stringify(
        verifySimulationReplay(
          input.replay as SimulationReplayRecord,
          request as unknown as SimulationFightRequest,
        ),
      ),
    );
    return;
  }
  if (command === "report") {
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
    await writeBundle(`catalog-report.${format === "markdown" ? "md" : format}`, content);
    return;
  }
  await writeBundle("custom-review.json", JSON.stringify(reviewCustomMove(await inputFor(args))));
};

await main();
