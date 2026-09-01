import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  reviewCustomMove,
  runSimulationFight,
  runSimulationMatrix,
  runSimulationSeries,
  createSimulationMoveBalanceReport,
  renderSimulationReportCsv,
  renderSimulationReportJson,
  renderSimulationReportMarkdown,
  createSimulationCompletionAudit,
  simulationMoveCoverageArtifactSchema,
  validateSimulationCoverageCells,
  validateSimulationMoveClosure,
  verifySimulationReplay,
  runSimulationMoveCoverage,
  canonicalJson,
} from "../packages/simulation/src/index.js";
import type {
  SimulationFightRequest,
  SimulationMatrixRequest,
  SimulationReplayRecord,
  SimulationSeriesRequest,
} from "../packages/simulation/src/index.js";

const usage = `Usage: npm run simulate -- <command> [--format json|csv|markdown]

Commands: fight, series, matrix, catalog-run, resume, replay, report, move-report, closure, custom-review, benchmark`;

const formatFor = (args: readonly string[]): "json" | "csv" | "markdown" => {
  const value = args[args.indexOf("--format") + 1];
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

const inputFor = async (args: readonly string[]): Promise<Record<string, unknown>> => {
  const path = args[args.indexOf("--input") + 1];
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
  const value = args[args.indexOf(name) + 1];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new RangeError(`${name} requires a positive integer.`);
  return parsed;
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
      "closure",
      "custom-review",
      "benchmark",
    ].includes(command)
  )
    throw new RangeError(`Unknown simulation command: ${command}`);
  if (command === "move-report") {
    const artifact = await coverageArtifactFor(args[args.indexOf("--artifact") + 1]);
    const report = createSimulationMoveBalanceReport(artifact.dataset, undefined, {
      errors: artifact.errors,
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
    const artifact = await coverageArtifactFor(args[args.indexOf("--artifact") + 1]);
    const issues = [
      ...validateSimulationMoveClosure(artifact.dataset),
      ...validateSimulationCoverageCells(artifact.coverageCells),
    ];
    const audit = createSimulationCompletionAudit(artifact.dataset, artifact.coverageCells);
    if (!audit.complete) issues.push(...audit.issues.filter((issue) => !issues.includes(issue)));
    if (issues.length > 0) throw new Error(`Move closure is incomplete:\n${issues.join("\n")}`);
    console.log("Simulation move closure is complete.");
    return;
  }
  if (command === "benchmark") {
    const artifact = await coverageArtifactFor(args[args.indexOf("--artifact") + 1]);
    console.log(
      JSON.stringify({
        command,
        mechanicsIdentity: artifact.dataset.mechanicsIdentity,
        moveCount: artifact.dataset.records.length,
        coverageCellCount: artifact.coverageCells.length,
      }),
    );
    return;
  }
  if (command === "catalog-run") {
    const population = args[args.indexOf("--population") + 1] as "isolation" | "forced" | undefined;
    if (population !== undefined && population !== "isolation" && population !== "forced")
      throw new RangeError("Catalog population must be isolation or forced.");
    const moveOption = args[args.indexOf("--moves") + 1];
    const result = runSimulationMoveCoverage({
      targetFights: positiveOption(args, "--target-fights", 250),
      minimumEligibleStates: positiveOption(args, "--minimum-eligible", 250),
      concurrency: args.includes("--workers") ? positiveOption(args, "--workers", 1) : 1,
      ...(args.includes("--workers") ? { workers: positiveOption(args, "--workers", 1) } : {}),
      population,
      moveIds: moveOption === undefined ? undefined : moveOption.split(",").filter(Boolean),
    });
    await writeBundle("catalog-coverage.json", `${canonicalJson(result.artifact)}\n`);
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
    const artifact = await coverageArtifactFor(args[args.indexOf("--artifact") + 1]);
    const report = createSimulationMoveBalanceReport(artifact.dataset, undefined, {
      errors: artifact.errors,
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
