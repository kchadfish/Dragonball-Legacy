import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  createStudyShardPlan,
  readStudyShardPlan,
  readStudyConfirmationPlan,
  createStudyConfirmationPlan,
  createSimulationStudyReport,
  readSimulationStudyReport,
  studyHash,
  type StudyTask,
} from "@dragonball-resurgence/simulation";
import {
  prepare,
  assertIdentity,
  acquireLock,
  runTasks,
  studyStopRequested,
} from "./simulation-study.js";
import { atomicStudyWrite, readJson, StudyStorage, writeStudyJson } from "./study-storage.js";
import {
  exportShardBundle,
  readShardSet,
  shardIdFor,
  type StudyShardBundle,
} from "./study-shard-bundles.js";

const args = process.argv.slice(2),
  command = args[0];
const option = (flag: string, fallback?: string) => {
  const i = args.indexOf(flag);
  if (i >= 0 && args[i + 1]) return args[i + 1]!;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing ${flag}`);
};
const directory = resolve(option("--dir", "artifacts/simulation/study-8000/balance-20260927"));
const commonFiles = [
  "manifest.json",
  "baseline.checkpoint.json",
  "source.tar.gz",
  "provenance.json",
];
const freezeJson = (path: string, value: { hash: string }): void => {
  if (existsSync(path)) {
    if ((readJson(path) as { hash: string }).hash !== value.hash)
      throw new Error(`Frozen allocation mismatch: ${path}`);
    return;
  }
  writeStudyJson(path, value);
};
const prepareShards = (): void => {
  prepare(directory);
  const common = new StudyStorage(directory),
    plan = createStudyShardPlan(common.manifest);
  freezeJson(join(directory, "shard-plan.json"), plan);
  for (const shard of plan.shards) {
    const target = join(directory, shard.id);
    if (existsSync(join(target, "manifest.json"))) {
      const prior = new StudyStorage(target);
      if (prior.manifest.hash !== common.manifest.hash)
        throw new Error("Shard already belongs to another study");
      continue;
    }
    mkdirSync(join(target, "results"), { recursive: true });
    for (const file of commonFiles) cpSync(join(directory, file), join(target, file));
    cpSync(join(directory, "shard-plan.json"), join(target, "shard-plan.json"));
    writeStudyJson(join(target, "shard.json"), { id: shard.id });
    atomicStudyWrite(join(target, "journal.jsonl"), "");
    new StudyStorage(target).snapshot("prepared-pilot");
  }
  console.log(
    JSON.stringify({
      study: common.manifest.id,
      planHash: plan.hash,
      shards: plan.shards.map((s) => ({ id: s.id, budget: s.budget, pilotFights: s.tasks.length })),
    }),
  );
};
const assertBranch = (id: string): void => {
  const actual = execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim(),
    expected = `study/8000-${id.toLowerCase()}`;
  if (actual !== expected)
    throw new Error(`Shard ${id} must execute on branch ${expected}; current branch is ${actual}`);
};
const updateDocument = (storage: StudyStorage, status: string, bundle?: StudyShardBundle): void => {
  const id = shardIdFor(storage.directory),
    path = `docs/architecture/simulation-study-shards/${id}.md`;
  const prior = existsSync(path) ? readFileSync(path, "utf8") : "";
  const notes = prior.split("## Operator notes")[1] ?? "\n\n";
  atomicStudyWrite(
    path,
    [
      `# Simulation study shard ${id}`,
      "",
      `Status: ${status}. Updated ${new Date().toISOString()}.`,
      "",
      `Branch: study/8000-${id.toLowerCase()}. Common manifest: ${storage.manifest.hash}.`,
      `Source identity: ${storage.manifest.sourceHash}.`,
      `Attempts: ${storage.attempts}/${storage.budgetLimit}; durable result attempts: ${storage.resultCount}; failures: ${storage.errorAttempts}; unknown attempts: ${storage.attempts - storage.resultCount}.`,
      `Journal: ${storage.journalSequence} / ${storage.journalHash}.`,
      `Runtime directory on this machine: ${storage.directory}.`,
      `Bundle: ${bundle ? `${bundle.stage} / ${bundle.hash}` : "not exported in this operation"}.`,
      "",
      "Read the common study runbook and the runtime RESUME.md. Do not edit another shard's document.",
      "Transfer the complete exported bundle; this document alone cannot reconstruct statistics.",
      "",
      "## Operator notes",
      notes,
    ].join("\n"),
  );
};
const runShard = async (phase: "pilot" | "confirmation"): Promise<void> => {
  const id = shardIdFor(directory);
  assertBranch(id);
  const release = acquireLock(directory);
  let storage: StudyStorage | undefined;
  try {
    storage = new StudyStorage(directory);
    assertIdentity(storage);
    storage.repairTail();
    const pilot = readStudyShardPlan(readJson(join(directory, "shard-plan.json")));
    let tasks = pilot.shards.find((s) => s.id === id)!.tasks;
    if (phase === "confirmation") {
      const plan = readStudyConfirmationPlan(readJson(join(directory, "confirmation-plan.json")));
      const receipt = plan.pilotReceipts.find((r) => r.id === id)!;
      if (storage.hashAt(receipt.journalSequence) !== receipt.journalHash)
        throw new Error("Local pilot differs from the merged pilot receipt");
      tasks = plan.shards.find((s) => s.id === id)!.tasks;
      for (const stage of ["diagnostic", "confirmation"] as const)
        if (!storage.allocations.has(stage))
          storage.append({
            type: "allocation",
            phase: stage,
            tasks: tasks.filter((t) => t.phase === stage),
          });
    } else if (existsSync(join(directory, "confirmation-plan.json")))
      throw new Error("Pilot is already frozen; run confirmation instead");
    storage.snapshot(`running-${phase}`);
    for (const stage of phase === "pilot"
      ? ["natural", "screening"]
      : ["diagnostic", "confirmation"]) {
      await runTasks(
        storage,
        tasks.filter((t) => t.phase === stage),
        stage,
      );
      if (studyStopRequested()) {
        updateDocument(storage, "interrupted");
        return;
      }
    }
    const status = phase === "pilot" ? "awaiting-pilot-merge" : "ready-for-final-merge";
    storage.snapshot(status);
    updateDocument(storage, status);
  } catch (error) {
    if (storage) {
      storage.snapshot("blocked");
      updateDocument(storage, `blocked: ${error instanceof Error ? error.message : String(error)}`);
    }
    throw error;
  } finally {
    release();
  }
};
const inputs = () => [resolve(option("--a")), resolve(option("--b")), resolve(option("--c"))];
const initializeMerge = (source: string): void => {
  mkdirSync(directory, { recursive: true });
  if (existsSync(join(directory, "manifest.json"))) {
    if (
      studyHash(readJson(join(directory, "manifest.json")) as object) !==
      studyHash(readJson(join(source, "manifest.json")) as object)
    )
      throw new Error("Merge destination belongs to another study");
  } else for (const file of commonFiles) cpSync(join(source, file), join(directory, file));
  const plan = readStudyShardPlan(readJson(join(source, "shard-plan.json")));
  freezeJson(join(directory, "shard-plan.json"), plan);
};
const mergePilots = (): void => {
  const paths = inputs(),
    shards = readShardSet(paths, "pilot");
  initializeMerge(paths[0]!);
  assertIdentity(new StudyStorage(directory));
  const manifest = shards[0]!.storage.manifest,
    pilot = readStudyShardPlan(readJson(join(directory, "shard-plan.json")));
  const candidates = shards
    .flatMap((s) => [...s.storage.results.values()])
    .filter((e) => e.codes.length || e.score.executionError !== null);
  const priority = (e: (typeof candidates)[number]) =>
    e.score.executionError
      ? 0
      : e.codes.some((c) => c === "no-progress" || c === "semantic-loop")
        ? 1
        : e.codes.includes("control-lockout")
          ? 2
          : 3;
  candidates.sort((a, b) => priority(a) - priority(b) || a.taskId.localeCompare(b.taskId));
  const diagnostics: StudyTask[] = candidates.map((e) => ({
    ...e.score.task,
    id: `diagnostic-${e.taskId}`,
    phase: "diagnostic",
  }));
  const receipts = shards.map(({ bundle }) => ({
    id: bundle.id,
    bundleHash: bundle.hash,
    journalSequence: bundle.journalSequence,
    journalHash: bundle.journalHash,
    attempts: bundle.attempts,
  }));
  const confirmation = createStudyConfirmationPlan(
    manifest,
    pilot,
    receipts,
    shards.flatMap((s) => s.storage.scores()),
    diagnostics,
  );
  freezeJson(join(directory, "confirmation-plan.json"), confirmation);
  writeStudyJson(join(directory, "pilot-merge.json"), {
    manifestHash: manifest.hash,
    pilotPlanHash: pilot.hash,
    receipts,
    confirmationHash: confirmation.hash,
    attempts: shards.reduce((sum, s) => sum + s.storage.attempts, 0),
  });
  console.log(
    JSON.stringify({
      confirmationHash: confirmation.hash,
      shards: confirmation.shards.map((s) => ({ id: s.id, fights: s.tasks.length })),
    }),
  );
};
const importConfirmation = (): void => {
  const path = resolve(option("--plan")),
    plan = readStudyConfirmationPlan(readJson(path)),
    storage = new StudyStorage(directory),
    id = shardIdFor(directory);
  if (existsSync(join(directory, "run.lock")))
    throw new Error("Stop the shard before importing its confirmation plan");
  const receipt = plan.pilotReceipts.find((r) => r.id === id)!;
  if (
    plan.manifestHash !== storage.manifest.hash ||
    storage.hashAt(receipt.journalSequence) !== receipt.journalHash ||
    storage.attempts !== receipt.attempts
  )
    throw new Error("Confirmation plan does not match this closed pilot");
  freezeJson(join(directory, "confirmation-plan.json"), plan);
  new StudyStorage(directory).snapshot("prepared-confirmation");
};
const mergeFinal = (): void => {
  const paths = inputs(),
    shards = readShardSet(paths, "final");
  initializeMerge(paths[0]!);
  assertIdentity(new StudyStorage(directory));
  const plan = readStudyConfirmationPlan(readJson(join(paths[0]!, "confirmation-plan.json")));
  freezeJson(join(directory, "confirmation-plan.json"), plan);
  const observations = function* () {
    const owners = shards
      .flatMap((s) => [...s.storage.results.keys()].map((id) => ({ id, storage: s.storage })))
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const { id, storage } of owners) yield storage.observation(id);
  };
  const attempts = shards.reduce((sum, s) => sum + s.storage.attempts, 0);
  const report = readSimulationStudyReport(
    createSimulationStudyReport(
      shards[0]!.storage.manifest,
      observations(),
      attempts,
      plan.shards.flatMap((s) => s.tasks.filter((t) => t.phase === "confirmation")),
    ),
  );
  freezeJson(join(directory, "report.json"), report);
  const receipts = shards.map((s) => ({
    id: s.bundle.id,
    bundleHash: s.bundle.hash,
    attempts: s.storage.attempts,
    errorAttempts: s.storage.errorAttempts,
    unknownAttempts: s.storage.attempts - s.storage.resultCount,
  }));
  writeStudyJson(join(directory, "merge-receipt.json"), {
    manifestHash: report.manifestHash,
    confirmationHash: plan.hash,
    receipts,
    attempts,
    unusedAttempts: report.budget - attempts,
    reportHash: report.hash,
  });
  const rows = [
    "target,recipe,screening_blocks,confirmation_blocks,effect,lower,upper,classification",
    ...report.effects.map((e) =>
      [
        e.target,
        e.recipeId,
        e.screening.blocks,
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
  atomicStudyWrite(join(directory, "effects.csv"), rows.join("\n") + "\n");
  const text = [
    "# Merged three-shard study",
    `Attempts: ${attempts}/${report.budget}. Report hash: ${report.hash}.`,
    "",
    ...receipts.map(
      (r) =>
        `- Shard ${r.id}: ${r.attempts} attempts, ${r.errorAttempts} errors, ${r.unknownAttempts} unknown; bundle ${r.bundleHash}.`,
    ),
    "",
    ...report.effects
      .filter((e) => e.confirmation)
      .map(
        (e) =>
          `- ${e.target}: ${e.confirmation!.classification}; ${e.confirmation!.blocks} complete confirmation blocks; [${e.confirmation!.lower}, ${e.confirmation!.upper}].`,
      ),
    "",
    ...report.limitations.map((s) => `- ${s}`),
  ].join("\n");
  atomicStudyWrite(join(directory, "report.md"), text);
  atomicStudyWrite("docs/architecture/simulation-study-shards/merged.md", text + "\n");
  console.log(JSON.stringify({ reportHash: report.hash, attempts }));
};
const main = async () => {
  if (command === "prepare-shards") prepareShards();
  else if (command === "run-pilot") await runShard("pilot");
  else if (command === "run-confirmation") await runShard("confirmation");
  else if (command === "merge-pilots") mergePilots();
  else if (command === "import-confirmation") importConfirmation();
  else if (command === "merge-final") mergeFinal();
  else if (command === "export-shard") {
    assertBranch(shardIdFor(directory));
    const stage = option("--stage");
    if (stage !== "pilot" && stage !== "final") throw new Error("Expected --stage pilot or final");
    const bundle = exportShardBundle(directory, resolve(option("--out")), stage);
    updateDocument(new StudyStorage(directory), `exported-${stage}`, bundle);
    console.log(JSON.stringify(bundle));
  } else if (command === "status")
    console.log(JSON.stringify(readJson(join(directory, "progress.json")), null, 2));
  else
    throw new Error(
      "Expected prepare-shards, run-pilot, export-shard, merge-pilots, import-confirmation, run-confirmation, merge-final, or status",
    );
};
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
