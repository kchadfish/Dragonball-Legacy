import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statfsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { CANONICAL_COMBAT_MECHANICS_VIEW } from "@dragonball-resurgence/combat-engine";
import {
  ALL_SIMULATION_TEMPLATES,
  canonicalHash,
  createSimulationStudyManifest,
  createSimulationStudyRequest,
  createSimulationStudyReport,
  readSimulationStudyReport,
  readSimulationStudyCheckpoint,
  runSimulationRequestsWithWorkers,
  selectSimulationCapabilityRecipes,
  studyConfirmationTasks,
  studyObservationFor,
  studyPilotTasks,
  simulationV4CatalogCheckpointSchema,
  validateSimulationV4CatalogCheckpoint,
  type StudyTask,
} from "@dragonball-resurgence/simulation";
import {
  atomicStudyWrite,
  readJson,
  sha256,
  StudyStorage,
  writeStudyJson,
} from "./study-storage.js";

const args = process.argv.slice(2),
  command = args[0];
const option = (name: string, fallback: string) =>
  args.includes(name) ? (args[args.indexOf(name) + 1] ?? fallback) : fallback;
const directory = resolve(option("--dir", "artifacts/simulation/study-8000/balance-20260926"));
const templates = ALL_SIMULATION_TEMPLATES(),
  view = CANONICAL_COMBAT_MECHANICS_VIEW;
const sourcePaths = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (["dist", "node_modules", "coverage"].includes(entry.name)) return [];
    return entry.isDirectory()
      ? sourcePaths(path)
      : /\.(ts|json|sh|mjs)$/u.test(entry.name)
        ? [path]
        : [];
  });
const sourceFiles = () =>
  [
    ...sourcePaths("packages"),
    ...sourcePaths("scripts"),
    "package.json",
    "package-lock.json",
    "tsconfig.base.json",
  ].sort();
const sourceIdentity = () =>
  sha256(
    sourceFiles()
      .map((path) => `${path}:${sha256(readFileSync(path))}`)
      .join("\n"),
  );
const baselinePath = "artifacts/simulation/catalog-v4-natural-100.json.checkpoint.json";
const prepare = (runDirectory = directory): void => {
  const directory = runDirectory;
  const recipes = selectSimulationCapabilityRecipes({
    view,
    templates,
    capabilityIds: ["restricted-use", "status-control", "transformation"],
    maxRecipesPerCapability: "all",
  }).recipes;
  if (templates.length !== 48 || recipes.length !== 143)
    throw new Error("Inventory differs from approved 48-template/143-recipe allocation");
  const parsedBaseline = simulationV4CatalogCheckpointSchema.parse(readJson(baselinePath));
  const baselineIssues = validateSimulationV4CatalogCheckpoint(parsedBaseline);
  if (baselineIssues.length)
    throw new Error(`Invalid historical baseline: ${baselineIssues.join(", ")}`);
  const baseline = readFileSync(baselinePath),
    manifest = createSimulationStudyManifest({
      id: directory.split("/").at(-1)!,
      sourceHash: sourceIdentity(),
      baselineHash: sha256(baseline),
      mechanicsHash: view.identity.contentHash,
      templates,
      recipes,
    });
  if (existsSync(join(directory, "manifest.json"))) {
    const saved = new StudyStorage(directory);
    if (saved.manifest.hash !== manifest.hash)
      throw new Error("Existing study manifest differs; preserve it and use a new study directory");
    return;
  }
  mkdirSync(directory, { recursive: true });
  atomicStudyWrite(join(directory, "baseline.checkpoint.json"), baseline);
  const sourceArchive = execFileSync("tar", ["-czf", "-", "--", ...sourceFiles()], {
    maxBuffer: 64 * 1024 * 1024,
  });
  atomicStudyWrite(join(directory, "source.tar.gz"), sourceArchive);
  writeStudyJson(join(directory, "provenance.json"), {
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    sourceHash: manifest.sourceHash,
    sourceArchiveSha256: sha256(sourceArchive),
    baselinePath,
    templateCount: templates.length,
    recipeCount: recipes.length,
    intervention: "focal full loadout minus named-definition removal; same legal preference policy",
  });
  writeStudyJson(join(directory, "manifest.json"), manifest);
  new StudyStorage(directory).snapshot("prepared");
};
const assertIdentity = (storage: StudyStorage): void => {
  const directory = storage.directory;
  if (
    storage.manifest.sourceHash !== sourceIdentity() ||
    storage.manifest.mechanicsHash !== view.identity.contentHash ||
    storage.manifest.templatesHash !== canonicalHash(templates) ||
    storage.manifest.baselineHash !==
      sha256(readFileSync(join(directory, "baseline.checkpoint.json")))
  )
    throw new Error(
      "Study source/configuration/baseline identity mismatch; do not resume with changed code",
    );
};
const acquireLock = (runDirectory = directory): (() => void) => {
  const directory = runDirectory;
  const lock = join(directory, "run.lock");
  try {
    mkdirSync(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const owner = readJson(join(lock, "owner.json")) as { pid: number };
    let alive = true;
    try {
      process.kill(owner.pid, 0);
    } catch {
      alive = false;
    }
    if (alive) throw new Error(`Study already running as PID ${owner.pid}`, { cause: error });
    rmSync(lock, { recursive: true });
    mkdirSync(lock);
  }
  writeStudyJson(join(lock, "owner.json"), { pid: process.pid });
  return () => rmSync(lock, { recursive: true });
};
const diagnosticTasks = (storage: StudyStorage): StudyTask[] => {
  const priority = (codes: string[], error: string | null) =>
    error
      ? 0
      : codes.includes("no-progress") || codes.includes("semantic-loop")
        ? 1
        : codes.includes("control-lockout")
          ? 2
          : 3;
  return [...storage.results.values()]
    .filter((e) => e.codes.length > 0 || e.score.executionError !== null)
    .sort(
      (a, b) =>
        priority(a.codes, a.score.executionError) - priority(b.codes, b.score.executionError) ||
        a.taskId.localeCompare(b.taskId),
    )
    .slice(0, Math.min(storage.manifest.diagnosticBudget, storage.budgetLimit - storage.attempts))
    .map((e) => ({ ...e.score.task, id: `diagnostic-${e.taskId}`, phase: "diagnostic" as const }));
};
let stop = false;
process.on("SIGTERM", () => {
  stop = true;
});
process.on("SIGINT", () => {
  stop = true;
});
const runTasks = async (
  storage: StudyStorage,
  tasks: readonly StudyTask[],
  phase: string,
): Promise<void> => {
  const directory = storage.directory;
  let lastSnapshot = Date.now(),
    lastCount = storage.resultCount;
  while (!stop && storage.attempts < storage.budgetLimit) {
    const pending = storage
      .pending(tasks)
      .slice(0, Math.min(storage.manifest.workers, storage.budgetLimit - storage.attempts));
    if (!pending.length) break;
    const fs = statfsSync(directory);
    if (fs.bavail * fs.bsize < 2 * 1024 ** 3)
      throw new Error("Storage guard: fewer than 2 GiB available");
    if (process.memoryUsage().rss > 12 * 1024 ** 3)
      throw new Error("Memory guard: RSS exceeds 12 GiB");
    const attempts = new Map(pending.map((task) => [task.id, storage.reserve(task)]));
    const requests = pending.map((task) => {
      const original =
        task.phase === "diagnostic"
          ? storage.results.get(task.id.replace(/^diagnostic-/u, ""))?.score.task
          : undefined;
      const request = createSimulationStudyRequest(
        storage.manifest,
        original ?? task,
        templates,
        view,
      );
      return original
        ? {
            ...request,
            runId: `simulation-run:${task.id}`,
            scenario: { ...request.scenario, retention: "diagnostic" as const },
          }
        : request;
    });
    const byId = new Map(requests.map((request, i) => [request.runId, pending[i]!]));
    runSimulationRequestsWithWorkers({
      requests,
      workers: storage.manifest.workers,
      retainResults: false,
      acceptIncomplete: true,
      stoppingPolicy: "continue",
      onProgress: (progress) => {
        const task = byId.get(progress.runId)!;
        storage.accept(studyObservationFor(task, progress), attempts.get(task.id)!);
        if (storage.resultCount - lastCount >= 32 || Date.now() - lastSnapshot >= 900000) {
          storage.snapshot(phase);
          lastCount = storage.resultCount;
          lastSnapshot = Date.now();
        }
        console.log(
          JSON.stringify({
            phase,
            attempts: storage.attempts,
            results: storage.resultCount,
            budget: storage.budgetLimit,
            task: task.id,
          }),
        );
      },
    });
    storage.progress(phase);
    await setImmediate();
  }
  storage.snapshot(stop ? "interrupted" : phase);
};
const report = (storage: StudyStorage): void => {
  const value = readSimulationStudyReport(
    createSimulationStudyReport(
      storage.manifest,
      storage.observations(),
      storage.attempts,
      storage.allocations.get("confirmation") ?? [],
    ),
  );
  const status = storage.finish?.status ?? "in-progress";
  writeStudyJson(join(directory, "completion.json"), {
    status,
    reason: storage.finish?.reason ?? "Study is still running",
    resultAttempts: storage.resultCount,
    errorAttempts: storage.errorAttempts,
    unknownAttempts: storage.attempts - storage.resultCount,
    reportHash: value.hash,
  });
  writeStudyJson(join(directory, "report.json"), value);
  const rows = [
    "recipe,target,screening_blocks,screening_effect,confirmation_blocks,confirmation_effect,lower,upper,classification",
    ...value.effects.map((e) =>
      [
        e.recipeId,
        e.target,
        e.screening.blocks,
        e.screening.estimate,
        e.confirmation?.blocks,
        e.confirmation?.estimate,
        e.confirmation?.lower,
        e.confirmation?.upper,
        e.confirmation?.classification ?? "not-selected",
      ]
        .map((x) => JSON.stringify(x ?? ""))
        .join(","),
    ),
  ];
  atomicStudyWrite(join(directory, "effects.csv"), `${rows.join("\n")}\n`);
  atomicStudyWrite(
    join(directory, "report.md"),
    [
      "# Budgeted balance study",
      `Status: ${status}. Attempts: ${storage.attempts}/${storage.manifest.budget}.`,
      "",
      "Historical baseline is preserved separately; it is not pooled with this study.",
      "Effects mean full loadout minus target-removed win score under the same legal preference policy.",
      "",
      ...value.effects
        .filter((e) => e.confirmation)
        .map(
          (e) =>
            `- ${e.target}: ${e.confirmation!.classification}; ${e.confirmation!.blocks} confirmation seed blocks; effect ${e.confirmation!.estimate}; interval [${e.confirmation!.lower}, ${e.confirmation!.upper}].`,
        ),
      "",
      ...value.limitations.map((s) => `- ${s}`),
      "",
      "See report.json for all metrics, exact lineage, natural estimates, sequence counts and anomaly prevalence.",
    ].join("\n"),
  );
};
const run = async (): Promise<void> => {
  if (existsSync(join(directory, "shard.json")))
    throw new Error("Use simulation-study-shards.ts run-pilot/run-confirmation for a shard");
  const release = acquireLock();
  let storage: StudyStorage | undefined;
  try {
    storage = new StudyStorage(directory);
    assertIdentity(storage);
    storage.repairTail();
    if (storage.finish) {
      report(storage);
      storage.snapshot(storage.finish.status);
      console.log(JSON.stringify(storage.finish));
      return;
    }
    storage.snapshot("running");
    const pilots = studyPilotTasks(storage.manifest);
    await runTasks(
      storage,
      pilots.filter((t) => t.phase === "natural"),
      "natural",
    );
    if (stop) return;
    await runTasks(
      storage,
      pilots.filter((t) => t.phase === "screening"),
      "screening",
    );
    if (stop) return;
    if (!storage.allocations.has("diagnostic"))
      storage.append({ type: "allocation", phase: "diagnostic", tasks: diagnosticTasks(storage) });
    await runTasks(storage, storage.allocations.get("diagnostic")!, "diagnostic");
    if (stop) return;
    if (!storage.allocations.has("confirmation"))
      storage.append({
        type: "allocation",
        phase: "confirmation",
        tasks: studyConfirmationTasks(
          storage.manifest,
          storage.scores(),
          storage.budgetLimit - storage.attempts,
        ),
      });
    await runTasks(storage, storage.allocations.get("confirmation")!, "confirmation");
    if (stop) return;
    const status =
      storage.attempts >= storage.manifest.budget
        ? "budget-exhausted"
        : storage.allocations.get("confirmation")!.length === 0
          ? "blocked"
          : "completed";
    storage.append({
      type: "finish",
      status,
      reason:
        status === "blocked"
          ? "No recipe has complete screening seed blocks"
          : "Frozen allocations exhausted or attempt cap reached; evidence may remain inconclusive",
    });
    storage.snapshot(status);
    report(storage);
  } catch (error) {
    if (storage) {
      storage.snapshot("blocked");
      writeStudyJson(join(directory, "failure.json"), {
        at: new Date().toISOString(),
        message: error instanceof Error ? error.message : String(error),
        resume: "Correct the operational issue, then resume with identical source.",
      });
    }
    throw error;
  } finally {
    release();
  }
};
const main = async (): Promise<void> => {
  if (command === "prepare") prepare();
  else if (command === "run" || command === "resume") await run();
  else if (command === "status")
    console.log(JSON.stringify(readJson(join(directory, "progress.json")), null, 2));
  else if (command === "verify") {
    const storage = new StudyStorage(directory);
    assertIdentity(storage);
    readSimulationStudyCheckpoint(readJson(join(directory, "checkpoint.json")));
    let count = 0;
    for (const observation of storage.observations()) {
      if (!observation.task.id) throw new Error("Missing task identity");
      count++;
    }
    console.log(
      JSON.stringify({
        verifiedResults: count,
        attempts: storage.attempts,
        manifestHash: storage.manifest.hash,
      }),
    );
  } else if (command === "report") report(new StudyStorage(directory));
  else throw new Error("Expected prepare, run, resume, status, verify, or report");
};
export { prepare, assertIdentity, acquireLock, runTasks, sourceIdentity };
export const studyStopRequested = () => stop;
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
