import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statfsSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { z } from "zod";
import {
  readSimulationStudyManifest,
  readSimulationStudyCheckpoint,
  studyHash,
  readStudyShardPlan,
  readStudyConfirmationPlan,
  studyShardIdSchema,
  validateStudyShardOwnership,
  studyObservationSchema,
  studyTaskSchema,
  type SimulationStudyManifest,
  type StudyObservation,
  type StudyTask,
  type StudyScore,
  type StudyShardId,
} from "@dragonball-resurgence/simulation";

export const sha256 = (input: string | Buffer): string =>
  createHash("sha256").update(input).digest("hex");
export const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
export const atomicStudyWrite = (path: string, content: string | Buffer): void => {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`,
    fd = openSync(temporary, "w");
  try {
    writeFileSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, path);
  const parent = openSync(dirname(path), "r");
  try {
    fsyncSync(parent);
  } finally {
    closeSync(parent);
  }
};
export const writeStudyJson = (path: string, value: unknown): void =>
  atomicStudyWrite(path, `${JSON.stringify(value, null, 2)}\n`);
const scoreSchema = z
  .object({
    task: studyTaskSchema,
    focalScore: z.number().min(0).max(1).nullable(),
    executionError: z.string().nullable(),
    termination: z.string(),
  })
  .strict();
const eventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("reserve"),
      task: studyTaskSchema,
      attempt: z.number().int().min(1).max(2),
    })
    .strict(),
  z
    .object({
      type: z.literal("result"),
      taskId: z.string(),
      attempt: z.number().int().min(1).max(2),
      file: z.string().regex(/^[a-f0-9]{64}\.json\.gz$/u),
      digest: z.string(),
      score: scoreSchema,
      codes: z.array(z.string()),
    })
    .strict(),
  z
    .object({
      type: z.literal("allocation"),
      phase: z.enum(["diagnostic", "confirmation"]),
      tasks: z.array(studyTaskSchema),
    })
    .strict(),
  z
    .object({
      type: z.literal("finish"),
      status: z.enum(["completed", "budget-exhausted", "blocked"]),
      reason: z.string(),
    })
    .strict(),
]);
type StudyEvent = z.infer<typeof eventSchema>;
const lineSchema = z
  .object({
    sequence: z.number().int().positive(),
    previous: z.string(),
    timestamp: z.iso.datetime(),
    event: eventSchema,
    hash: z.string(),
  })
  .strict();
type JournalLine = z.infer<typeof lineSchema>;
type ResultEvent = Extract<StudyEvent, { type: "result" }>;
const attemptLimit = (task: StudyTask): number => (task.phase === "diagnostic" ? 1 : 2);

export class StudyStorage {
  readonly manifest: SimulationStudyManifest;
  readonly budgetLimit: number;
  readonly shardId: StudyShardId | undefined;
  private allowedTasks: Map<string, StudyTask> | undefined;
  private readonly history = new Map<number, string>([[0, "genesis"]]);
  get journalSequence(): number {
    return this.sequence;
  }
  get journalHash(): string {
    return this.previous;
  }
  hashAt(sequence: number): string | undefined {
    return this.history.get(sequence);
  }
  readonly reservations = new Map<string, { task: StudyTask; attempt: number }>();
  readonly results = new Map<string, ResultEvent>();
  readonly allocations = new Map<string, StudyTask[]>();
  readonly recordedAttempts = new Set<string>();
  attempts = 0;
  resultCount = 0;
  errorAttempts = 0;
  lastTimestamp: string | null = null;
  lastResultAt: string | null = null;
  finish: Extract<StudyEvent, { type: "finish" }> | undefined;
  private readonly startedAt = Date.now();
  private initialResults = 0;
  private sequence = 0;
  private previous = "genesis";
  private readonly journal: string;
  private tornTail = false;
  constructor(readonly directory: string) {
    this.manifest = readSimulationStudyManifest(readJson(join(directory, "manifest.json")));
    this.budgetLimit = this.manifest.budget;
    if (existsSync(join(directory, "shard.json"))) {
      const shard = z
        .object({ id: studyShardIdSchema })
        .strict()
        .parse(readJson(join(directory, "shard.json")));
      this.shardId = shard.id;
      const plan = readStudyShardPlan(readJson(join(directory, "shard-plan.json")));
      validateStudyShardOwnership(this.manifest, plan);
      const assigned = plan.shards.find((s) => s.id === shard.id)!;
      this.budgetLimit = assigned.budget;
      this.allowedTasks = new Map(assigned.tasks.map((t) => [t.id, t]));
      if (existsSync(join(directory, "confirmation-plan.json"))) {
        const confirmation = readStudyConfirmationPlan(
          readJson(join(directory, "confirmation-plan.json")),
        );
        if (
          confirmation.manifestHash !== this.manifest.hash ||
          confirmation.pilotPlanHash !== plan.hash
        )
          throw new Error("Confirmation/common identity mismatch");
        for (const assignment of confirmation.shards) {
          const cap = plan.shards.find((s) => s.id === assignment.id)!.budget;
          const receipt = confirmation.pilotReceipts.find((r) => r.id === assignment.id)!;
          if (assignment.budget !== cap || assignment.tasks.length + receipt.attempts > cap)
            throw new Error("Confirmation exceeds frozen shard cap");
        }
        for (const task of confirmation.shards.find((s) => s.id === shard.id)!.tasks)
          this.allowedTasks.set(task.id, task);
      }
    }
    this.journal = join(directory, "journal.jsonl");
    if (!existsSync(this.journal)) return;
    const text = readFileSync(this.journal, "utf8"),
      lines = text.split("\n");
    this.tornTail = lines.pop() !== "";
    for (const line of lines) {
      const parsed = lineSchema.parse(JSON.parse(line) as unknown);
      const { hash, ...body } = parsed;
      if (
        parsed.sequence !== this.sequence + 1 ||
        parsed.previous !== this.previous ||
        sha256(JSON.stringify(body)) !== hash
      )
        throw new Error("Journal integrity failure");
      this.apply(parsed);
    }
    this.initialResults = this.resultCount;
  }
  repairTail(): void {
    if (!this.tornTail) return;
    const text = readFileSync(this.journal, "utf8"),
      end = text.lastIndexOf("\n") + 1;
    atomicStudyWrite(`${this.journal}.torn-${Date.now()}`, text.slice(end));
    atomicStudyWrite(this.journal, text.slice(0, end));
    this.tornTail = false;
  }
  private apply(line: JournalLine): void {
    const e = line.event;
    if (e.type === "reserve") {
      this.assertTask(e.task);
      const previous = this.reservations.get(e.task.id);
      if (
        e.attempt !== (previous?.attempt ?? 0) + 1 ||
        e.attempt > attemptLimit(e.task) ||
        this.attempts >= this.budgetLimit
      )
        throw new Error("Invalid budget reservation");
      this.reservations.set(e.task.id, { task: e.task, attempt: e.attempt });
      this.attempts++;
    } else if (e.type === "result") {
      const key = `${e.taskId}/${e.attempt}`;
      if (
        this.reservations.get(e.taskId)?.attempt !== e.attempt ||
        this.recordedAttempts.has(key) ||
        e.score.task.id !== e.taskId
      )
        throw new Error("Invalid or duplicate journal result");
      this.recordedAttempts.add(key);
      this.results.set(e.taskId, e);
      this.resultCount++;
      this.errorAttempts += Number(e.score.executionError !== null);
      this.lastResultAt = line.timestamp;
    } else if (e.type === "allocation") {
      if (this.allocations.has(e.phase)) throw new Error("Study allocation already frozen");
      this.allocations.set(e.phase, e.tasks);
    } else this.finish = e;
    this.history.set(line.sequence, line.hash);
    this.sequence = line.sequence;
    this.previous = line.hash;
    this.lastTimestamp = line.timestamp;
  }
  append(event: StudyEvent): void {
    if (event.type === "allocation" && this.allocations.has(event.phase))
      throw new Error("Study allocation already frozen");
    if (
      event.type === "result" &&
      (this.recordedAttempts.has(`${event.taskId}/${event.attempt}`) ||
        this.reservations.get(event.taskId)?.attempt !== event.attempt)
    )
      throw new Error("Invalid or duplicate result");
    if (this.tornTail) throw new Error("Repair journal tail under the run lock before appending");
    const body = {
      sequence: this.sequence + 1,
      previous: this.previous,
      timestamp: new Date().toISOString(),
      event: eventSchema.parse(event),
    };
    const line = { ...body, hash: sha256(JSON.stringify(body)) };
    const fd = openSync(this.journal, "a");
    try {
      writeSync(fd, `${JSON.stringify(line)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    this.apply(line);
  }
  private assertTask(task: StudyTask): void {
    if (this.allowedTasks && studyHash(this.allowedTasks.get(task.id) ?? {}) !== studyHash(task))
      throw new Error("Task is not owned by this shard");
  }
  reserve(task: StudyTask): number {
    this.assertTask(task);
    if (this.results.get(task.id)?.score.executionError === null)
      throw new Error("Successful logical fight is already durable");
    if (this.attempts >= this.budgetLimit) throw new Error("Study budget exhausted");
    const attempt = (this.reservations.get(task.id)?.attempt ?? 0) + 1;
    if (attempt > attemptLimit(task)) throw new Error("Retry allowance exhausted");
    this.append({ type: "reserve", task, attempt });
    return attempt;
  }
  accept(observation: StudyObservation, attempt: number): void {
    const parsed = studyObservationSchema.parse(observation),
      content = gzipSync(JSON.stringify(parsed)),
      digest = sha256(content),
      file = `${digest}.json.gz`;
    atomicStudyWrite(join(this.directory, "results", file), content);
    this.append({
      type: "result",
      taskId: parsed.task.id,
      attempt,
      file,
      digest,
      score: {
        task: parsed.task,
        focalScore: parsed.focalScore,
        executionError: parsed.executionError,
        termination: parsed.termination,
      },
      codes: [...new Set(parsed.anomalies.map((a) => a.code))],
    });
  }
  observation(taskId: string): StudyObservation {
    const entry = this.results.get(taskId);
    if (!entry) throw new Error("Unknown accepted task");
    const content = readFileSync(join(this.directory, "results", entry.file));
    if (sha256(content) !== entry.digest)
      throw new Error(`Result integrity failure: ${entry.file}`);
    const observation = studyObservationSchema.parse(
      JSON.parse(gunzipSync(content).toString("utf8")) as unknown,
    );
    if (studyHash(observation.task) !== studyHash(entry.score.task))
      throw new Error("Result task differs from journal task");
    return observation;
  }
  *observations(): Generator<StudyObservation> {
    for (const id of [...this.results.keys()].sort((a, b) => a.localeCompare(b)))
      yield this.observation(id);
  }
  scores(): StudyScore[] {
    return [...this.results.values()].map((e) => e.score);
  }
  pending(tasks: readonly StudyTask[]): StudyTask[] {
    return tasks.filter((task) => {
      const saved = this.results.get(task.id),
        reserved = this.reservations.get(task.id);
      if (saved?.score.executionError === null) return false;
      return (reserved?.attempt ?? 0) < attemptLimit(task);
    });
  }
  snapshot(status: string): void {
    const path = join(this.directory, "checkpoint.json");
    if (existsSync(path)) atomicStudyWrite(`${path}.previous`, readFileSync(path));
    const checkpoint = {
      schemaVersion: "simulation-study-checkpoint:v1",
      manifestHash: this.manifest.hash,
      journalSequence: this.sequence,
      journalHash: this.previous,
      attempts: this.attempts,
      results: this.resultCount,
      allocations: Object.fromEntries(this.allocations),
      status,
      updatedAt: new Date().toISOString(),
    };
    writeStudyJson(
      path,
      readSimulationStudyCheckpoint({ ...checkpoint, hash: studyHash(checkpoint) }),
    );
    this.progress(status);
  }
  progress(status: string): void {
    const stats = statfsSync(this.directory);
    const elapsedSeconds = (Date.now() - this.startedAt) / 1000;
    const rate = (this.resultCount - this.initialResults) / Math.max(0.001, elapsedSeconds);
    const blocks = new Map<string, { phase: string; count: number }>();
    for (const result of this.results.values()) {
      if (result.score.focalScore === null || result.score.executionError !== null) continue;
      const task = result.score.task,
        key = `${task.phase}/${task.cellId}/${task.seed}`;
      const prior = blocks.get(key) ?? { phase: task.phase, count: 0 };
      prior.count++;
      blocks.set(key, prior);
    }
    const completeSeedBlocks = Object.fromEntries(
      ["natural", "screening", "confirmation"].map((phase) => [
        phase,
        [...blocks.values()].filter(
          (b) => b.phase === phase && b.count === (phase === "natural" ? 2 : 4),
        ).length,
      ]),
    );
    const value = {
      status,
      shard: this.shardId,
      elapsedSeconds,
      invocationResults: this.resultCount - this.initialResults,
      resultsPerSecond: rate,
      estimatedRemainingSeconds: rate > 0 ? (this.budgetLimit - this.attempts) / rate : null,
      completeSeedBlocks,
      manifestHash: this.manifest.hash,
      attempts: this.attempts,
      budget: this.budgetLimit,
      globalBudget: this.manifest.budget,
      remaining: this.budgetLimit - this.attempts,
      resultCount: this.resultCount,
      acceptedLogicalFights: this.results.size,
      errorAttempts: this.errorAttempts,
      unknownAttempts: this.attempts - this.resultCount,
      lastDurableJournalAt: this.lastTimestamp,
      lastResultAt: this.lastResultAt,
      lastSnapshotAt: existsSync(join(this.directory, "checkpoint.json"))
        ? (readJson(join(this.directory, "checkpoint.json")) as { updatedAt: string }).updatedAt
        : null,
      rssBytes: process.memoryUsage().rss,
      freeBytes: stats.bavail * stats.bsize,
      updatedAt: new Date().toISOString(),
    };
    writeStudyJson(join(this.directory, "progress.json"), value);
    const phase = existsSync(join(this.directory, "confirmation-plan.json"))
      ? "confirmation"
      : "pilot";
    const quotedDirectory = "'" + this.directory.replaceAll("'", "'\\''") + "'";
    const command = this.shardId
      ? `scripts/simulation-study-supervisor.ts ${quotedDirectory} ${phase}`
      : `scripts/simulation-study.ts resume --dir ${quotedDirectory}`;
    const statusCommand = this.shardId
      ? "scripts/simulation-study-shards.ts status"
      : "scripts/simulation-study.ts status";
    atomicStudyWrite(
      join(this.directory, "RESUME.md"),
      `# Simulation study recovery\n\nStatus: ${status}. Attempts: ${this.attempts}/${this.budgetLimit}; durable results: ${this.resultCount}.\n\nRead docs/architecture/simulation-budgeted-study.md and simulation-progress.md.\nVerify source identity before resuming. Console counts are not checkpoints.\n\n\`\`\`sh\nnode --import tsx ${statusCommand} --dir ${quotedDirectory}\nnode --import tsx ${command}\n\`\`\`\n\nCopy this entire directory to resume on another machine. Source identity: ${this.manifest.sourceHash}.\n`,
    );
  }
}
