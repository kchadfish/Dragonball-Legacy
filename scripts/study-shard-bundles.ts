import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  canonicalJson,
  readStudyShardPlan,
  readStudyConfirmationPlan,
  studyShardIdSchema,
  type StudyShardId,
} from "@dragonball-resurgence/simulation";
import { readJson, sha256, StudyStorage, writeStudyJson } from "./study-storage.js";

const filePattern =
  /^(manifest\.json|baseline\.checkpoint\.json|source\.tar\.gz|provenance\.json|shard\.json|shard-plan\.json|confirmation-plan\.json|journal\.jsonl|checkpoint\.json|results\/[a-f0-9]{64}\.json\.gz)$/u;
const bundleSchema = z
  .object({
    schemaVersion: z.literal("simulation-shard-bundle:v1"),
    id: studyShardIdSchema,
    stage: z.enum(["pilot", "final"]),
    manifestHash: z.string(),
    pilotPlanHash: z.string(),
    confirmationPlanHash: z.string().nullable(),
    journalSequence: z.number().int().nonnegative(),
    journalHash: z.string(),
    attempts: z.number().int().nonnegative(),
    files: z.record(z.string().regex(filePattern), z.string().regex(/^[a-f0-9]{64}$/u)),
    hash: z.string(),
  })
  .strict();
export type StudyShardBundle = z.infer<typeof bundleSchema>;
export const shardIdFor = (directory: string): StudyShardId =>
  z
    .object({ id: studyShardIdSchema })
    .strict()
    .parse(readJson(join(directory, "shard.json"))).id;
const requiredFiles = [
  "manifest.json",
  "baseline.checkpoint.json",
  "source.tar.gz",
  "provenance.json",
  "shard.json",
  "shard-plan.json",
  "journal.jsonl",
  "checkpoint.json",
];
const hashBundle = (value: object): string =>
  sha256(
    canonicalJson(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "hash"))),
  );
export const readShardBundle = (
  directory: string,
): { bundle: StudyShardBundle; storage: StudyStorage } => {
  const bundle = bundleSchema.parse(readJson(join(directory, "bundle.json")));
  if (hashBundle(bundle) !== bundle.hash) throw new Error("Shard bundle hash mismatch");
  for (const path of requiredFiles)
    if (!bundle.files[path]) throw new Error(`Missing required bundle file ${path}`);
  if (bundle.stage === "final" && !bundle.files["confirmation-plan.json"])
    throw new Error("Final bundle has no frozen confirmation plan");
  for (const [path, digest] of Object.entries(bundle.files))
    if (sha256(readFileSync(join(directory, path))) !== digest)
      throw new Error(`Corrupt shard bundle file: ${path}`);
  const storage = new StudyStorage(directory),
    plan = readStudyShardPlan(readJson(join(directory, "shard-plan.json")));
  if (
    shardIdFor(directory) !== bundle.id ||
    storage.manifest.hash !== bundle.manifestHash ||
    plan.hash !== bundle.pilotPlanHash ||
    storage.attempts !== bundle.attempts ||
    storage.journalSequence !== bundle.journalSequence ||
    storage.journalHash !== bundle.journalHash
  )
    throw new Error("Shard receipt does not match its journal");
  if (
    sha256(readFileSync(join(directory, "baseline.checkpoint.json"))) !==
    storage.manifest.baselineHash
  )
    throw new Error("Baseline archive mismatch");
  for (const entry of storage.results.values())
    if (!bundle.files[`results/${entry.file}`]) throw new Error("Missing result digest in bundle");
  for (const observation of storage.observations())
    if (!observation.task.id) throw new Error("Invalid observation");
  const ownPilot = plan.shards.find((s) => s.id === bundle.id)!;
  if (storage.pending(ownPilot.tasks).length && storage.attempts < storage.budgetLimit)
    throw new Error("Pilot is not closed");
  if (bundle.stage === "final") {
    const confirmation = readStudyConfirmationPlan(
      readJson(join(directory, "confirmation-plan.json")),
    );
    if (confirmation.hash !== bundle.confirmationPlanHash)
      throw new Error("Confirmation hash mismatch");
    const receipt = confirmation.pilotReceipts.find((r) => r.id === bundle.id)!;
    if (storage.hashAt(receipt.journalSequence) !== receipt.journalHash)
      throw new Error("Confirmation refers to a different pilot journal");
    if (
      storage.pending(confirmation.shards.find((s) => s.id === bundle.id)!.tasks).length &&
      storage.attempts < storage.budgetLimit
    )
      throw new Error("Confirmation is not closed");
  }
  return { bundle, storage };
};
export const exportShardBundle = (
  directory: string,
  output: string,
  stage: "pilot" | "final",
): StudyShardBundle => {
  if (existsSync(join(directory, "run.lock")))
    throw new Error("Do not export a running shard; wait for its phase boundary");
  if (existsSync(output))
    throw new Error("Export destination must be new; preserve existing bundles");
  const storage = new StudyStorage(directory),
    id = shardIdFor(directory),
    plan = readStudyShardPlan(readJson(join(directory, "shard-plan.json")));
  const paths = [
    ...requiredFiles,
    ...(stage === "final" ? ["confirmation-plan.json"] : []),
    ...readdirSync(join(directory, "results")).map((file) => `results/${file}`),
  ].sort((a, b) => a.localeCompare(b));
  const files: Record<string, string> = {};
  mkdirSync(output, { recursive: true });
  for (const path of paths) {
    if (!filePattern.test(path)) throw new Error("Unexpected bundle path");
    mkdirSync(join(output, path, ".."), { recursive: true });
    cpSync(join(directory, path), join(output, path));
    files[path] = sha256(readFileSync(join(output, path)));
  }
  const confirmation =
    stage === "final"
      ? readStudyConfirmationPlan(readJson(join(directory, "confirmation-plan.json")))
      : undefined;
  const value = {
    schemaVersion: "simulation-shard-bundle:v1" as const,
    id,
    stage,
    manifestHash: storage.manifest.hash,
    pilotPlanHash: plan.hash,
    confirmationPlanHash: confirmation?.hash ?? null,
    journalSequence: storage.journalSequence,
    journalHash: storage.journalHash,
    attempts: storage.attempts,
    files,
  };
  const bundle = { ...value, hash: hashBundle(value) };
  writeStudyJson(join(output, "bundle.json"), bundle);
  readShardBundle(output);
  return bundle;
};
export const readShardSet = (paths: readonly string[], stage: "pilot" | "final") => {
  if (paths.length !== 3) throw new Error("Exactly three shard bundles are required");
  const shards = paths.map(readShardBundle).sort((a, b) => a.bundle.id.localeCompare(b.bundle.id));
  if (new Set(shards.map((s) => s.bundle.id)).size !== 3)
    throw new Error("Expected one bundle each from A, B and C");
  if (
    new Set(shards.map((s) => s.bundle.manifestHash)).size !== 1 ||
    new Set(shards.map((s) => s.bundle.pilotPlanHash)).size !== 1 ||
    shards.some((s) => s.bundle.stage !== stage)
  )
    throw new Error("Incompatible shard study/stage identities");
  if (stage === "final" && new Set(shards.map((s) => s.bundle.confirmationPlanHash)).size !== 1)
    throw new Error("Shards used different confirmation plans");
  const seen = new Set<string>();
  for (const { storage } of shards)
    for (const id of storage.reservations.keys()) {
      if (seen.has(id)) throw new Error("Duplicate fight ownership across shards");
      seen.add(id);
    }
  if (shards.reduce((sum, s) => sum + s.storage.attempts, 0) > shards[0]!.storage.manifest.budget)
    throw new Error("Merged study exceeds global budget");
  return shards;
};
