import { z } from "zod";
import { studyConfirmationTasks } from "./study-analysis.js";
import {
  studyHash,
  studyPilotTasks,
  studyTaskSchema,
  type SimulationStudyManifest,
  type StudyTask,
} from "./study-design.js";

export const STUDY_SHARDS = ["A", "B", "C"] as const;
export type StudyShardId = (typeof STUDY_SHARDS)[number];
export const studyShardIdSchema = z.enum(STUDY_SHARDS);
const assignmentSchema = z
  .object({
    id: studyShardIdSchema,
    budget: z.number().int().positive(),
    tasks: z.array(studyTaskSchema),
  })
  .strict();
export const studyShardPlanSchema = z
  .object({
    schemaVersion: z.literal("simulation-shard-plan:v1"),
    manifestHash: z.string(),
    shards: z.array(assignmentSchema).length(3),
    hash: z.string(),
  })
  .strict();
export type StudyShardPlan = z.infer<typeof studyShardPlanSchema>;
const pilotReceiptSchema = z
  .object({
    id: studyShardIdSchema,
    bundleHash: z.string(),
    journalSequence: z.number().int().nonnegative(),
    journalHash: z.string(),
    attempts: z.number().int().nonnegative(),
  })
  .strict();
export const studyConfirmationPlanSchema = z
  .object({
    schemaVersion: z.literal("simulation-shard-confirmation:v1"),
    manifestHash: z.string(),
    pilotPlanHash: z.string(),
    pilotReceipts: z.array(pilotReceiptSchema).length(3),
    shards: z.array(assignmentSchema).length(3),
    hash: z.string(),
  })
  .strict();
export type StudyConfirmationPlan = z.infer<typeof studyConfirmationPlanSchema>;

export const studyTaskBlockKey = (task: StudyTask): string =>
  task.phase === "diagnostic" ? task.id : `${task.phase}/${task.cellId}/${task.seed}`;
const validateAssignments = (assignments: StudyShardPlan["shards"]): void => {
  if (new Set(assignments.map((s) => s.id)).size !== 3)
    throw new Error("Expected exactly shards A, B and C");
  const owners = new Map<string, StudyShardId>(),
    ids = new Set<string>();
  for (const shard of assignments)
    for (const task of shard.tasks) {
      const key = studyTaskBlockKey(task),
        owner = owners.get(key);
      if (owner !== undefined && owner !== shard.id)
        throw new Error("Seed block split across shards");
      if (ids.has(task.id)) throw new Error("Duplicate shard task");
      ids.add(task.id);
      owners.set(key, shard.id);
    }
  if (assignments.some((s) => s.tasks.length > s.budget))
    throw new Error("Shard allocation exceeds cap");
};
export const readStudyShardPlan = (input: unknown): StudyShardPlan => {
  const plan = studyShardPlanSchema.parse(input);
  if (studyHash(plan) !== plan.hash) throw new Error("Shard plan hash mismatch");
  validateAssignments(plan.shards);
  return plan;
};
export const readStudyConfirmationPlan = (input: unknown): StudyConfirmationPlan => {
  const plan = studyConfirmationPlanSchema.parse(input);
  if (studyHash(plan) !== plan.hash) throw new Error("Confirmation plan hash mismatch");
  validateAssignments(plan.shards);
  if (new Set(plan.pilotReceipts.map((r) => r.id)).size !== 3)
    throw new Error("Missing pilot receipt");
  for (const shard of plan.shards) {
    const receipt = plan.pilotReceipts.find((r) => r.id === shard.id)!;
    if (receipt.attempts + shard.tasks.length > shard.budget)
      throw new Error("Confirmation exceeds remaining shard budget");
    const blocks = new Map<string, Set<string>>();
    for (const task of shard.tasks) {
      if (task.phase === "diagnostic") continue;
      if (task.phase !== "confirmation") throw new Error("Invalid confirmation task phase");
      const key = studyTaskBlockKey(task);
      const members = blocks.get(key) ?? new Set<string>();
      members.add(`${task.mirror}/${task.branch}`);
      blocks.set(key, members);
    }
    if ([...blocks.values()].some((members) => members.size !== 4))
      throw new Error("Incomplete confirmation seed block");
  }
  return plan;
};

/** Keep whole mirrored/control seed blocks together, balancing actual scheduled fights. */
export const partitionStudyTasks = (
  tasks: readonly StudyTask[],
  budgets: readonly number[],
  initialLoads: readonly number[] = [0, 0, 0],
): StudyShardPlan["shards"] => {
  if (budgets.length !== 3 || initialLoads.length !== 3)
    throw new Error("Expected three shard budgets");
  const assignments = STUDY_SHARDS.map((id, i) => ({
    id,
    budget: budgets[i]!,
    tasks: [] as StudyTask[],
    load: initialLoads[i]!,
  }));
  const groups = new Map<string, StudyTask[]>();
  for (const task of tasks) {
    const key = studyTaskBlockKey(task);
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  for (const [, block] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const shard = assignments
      .filter((s) => s.load + block.length <= s.budget)
      .sort((a, b) => a.load - b.load || a.id.localeCompare(b.id))[0];
    if (!shard) throw new Error("Whole seed block does not fit shard budgets");
    shard.tasks.push(...block);
    shard.load += block.length;
  }
  const result = assignments.map(({ id, budget, tasks }) => ({ id, budget, tasks }));
  validateAssignments(result);
  return result;
};
export const createStudyShardPlan = (manifest: SimulationStudyManifest): StudyShardPlan => {
  const budgets = STUDY_SHARDS.map(
    (_, i) => Math.floor(manifest.budget / 3) + Number(i < manifest.budget % 3),
  );
  const value = {
    schemaVersion: "simulation-shard-plan:v1" as const,
    manifestHash: manifest.hash,
    shards: partitionStudyTasks(studyPilotTasks(manifest), budgets),
  };
  return readStudyShardPlan({ ...value, hash: studyHash(value) });
};

export const validateStudyShardOwnership = (
  manifest: SimulationStudyManifest,
  plan: StudyShardPlan,
): void => {
  if (
    plan.manifestHash !== manifest.hash ||
    plan.shards.reduce((s, x) => s + x.budget, 0) !== manifest.budget
  )
    throw new Error("Shard/common manifest mismatch");
  const expected = createStudyShardPlan(manifest);
  if (expected.hash !== plan.hash) throw new Error("Noncanonical pilot ownership or budgets");
};

export const createStudyConfirmationPlan = (
  manifest: SimulationStudyManifest,
  pilot: StudyShardPlan,
  receipts: StudyConfirmationPlan["pilotReceipts"],
  scores: readonly import("./study-analysis.js").StudyScore[],
  diagnosticCandidates: readonly StudyTask[],
): StudyConfirmationPlan => {
  validateStudyShardOwnership(manifest, pilot);
  const diagnostics = STUDY_SHARDS.map(() => [] as StudyTask[]);
  const loads = STUDY_SHARDS.map((id) => receipts.find((r) => r.id === id)?.attempts ?? -1);
  const budgets = STUDY_SHARDS.map((id) => pilot.shards.find((s) => s.id === id)!.budget);
  if (loads.some((load, i) => load < 0 || load > budgets[i]!))
    throw new Error("Invalid pilot attempt receipts");
  const owners = new Map(pilot.shards.flatMap((s) => s.tasks.map((t) => [t.id, s.id] as const)));
  let diagnosticCount = 0;
  for (const task of diagnosticCandidates) {
    if (diagnosticCount >= manifest.diagnosticBudget) break;
    const owner = owners.get(task.id.replace(/^diagnostic-/u, ""));
    if (!owner) throw new Error("Diagnostic source is not a pilot task");
    const index = STUDY_SHARDS.indexOf(owner);
    if (loads[index]! >= budgets[index]!) continue;
    diagnostics[index]!.push(task);
    loads[index]++;
    diagnosticCount++;
  }
  const capacity = loads.reduce(
    (sum, load, i) => sum + Math.floor((budgets[i]! - load) / 4) * 4,
    0,
  );
  const confirmation = studyConfirmationTasks(manifest, scores, capacity);
  const partition = partitionStudyTasks(confirmation, budgets, loads);
  const value = {
    schemaVersion: "simulation-shard-confirmation:v1" as const,
    manifestHash: manifest.hash,
    pilotPlanHash: pilot.hash,
    pilotReceipts: receipts,
    shards: partition.map((s, i) => ({ ...s, tasks: [...diagnostics[i]!, ...s.tasks] })),
  };
  return readStudyConfirmationPlan({ ...value, hash: studyHash(value) });
};
