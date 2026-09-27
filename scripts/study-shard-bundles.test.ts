import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CANONICAL_COMBAT_MECHANICS_VIEW as view } from "@dragonball-resurgence/combat-engine";
import {
  createSyntheticArchetypes,
  selectSimulationCapabilityRecipes,
  createSimulationStudyManifest,
  createStudyShardPlan,
  createStudyConfirmationPlan,
  createSimulationStudyReport,
  type StudyTask,
  type StudyObservation,
} from "@dragonball-resurgence/simulation";
import { StudyStorage, writeStudyJson, sha256 } from "./study-storage.js";
import { exportShardBundle, readShardSet, readShardBundle } from "./study-shard-bundles.js";
const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const observation = (task: StudyTask): StudyObservation => ({
  task,
  runId: task.id,
  executionError: null,
  termination: "engine-completed",
  focalScore: task.branch === "baseline" ? 1 : 0,
  metrics: {},
  sequence: [],
  sequenceAvailable: false,
  sequenceWon: false,
  anomalies: [],
});
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "study-shards-"));
  directories.push(root);
  const templates = createSyntheticArchetypes(view).slice(0, 2),
    recipes = selectSimulationCapabilityRecipes({
      view,
      templates,
      capabilityIds: ["restricted-use", "status-control", "transformation"],
      maxRecipesPerCapability: "all",
    }).recipes;
  const manifest = createSimulationStudyManifest({
    id: "fixture-shards",
    sourceHash: "source",
    baselineHash: sha256("baseline"),
    mechanicsHash: view.identity.contentHash,
    templates,
    recipes,
    sampleCells: 1,
    pilotSeeds: 1,
    diagnosticBudget: 0,
    budget: 24,
    workers: 1,
  });
  const plan = createStudyShardPlan(manifest);
  for (const shard of plan.shards) {
    const dir = join(root, shard.id);
    mkdirSync(join(dir, "results"), { recursive: true });
    writeStudyJson(join(dir, "manifest.json"), manifest);
    writeStudyJson(join(dir, "shard-plan.json"), plan);
    writeStudyJson(join(dir, "shard.json"), { id: shard.id });
    writeStudyJson(join(dir, "provenance.json"), {});
    writeFileSync(join(dir, "baseline.checkpoint.json"), "baseline");
    writeFileSync(join(dir, "source.tar.gz"), "fixture");
    writeFileSync(join(dir, "journal.jsonl"), "");
    const store = new StudyStorage(dir);
    for (const task of shard.tasks) {
      store.reserve(task);
      store.accept(observation(task), 1);
    }
    store.snapshot("awaiting-pilot-merge");
  }
  const exports = plan.shards.map((s) => {
    const out = join(root, `pilot-${s.id}`);
    exportShardBundle(join(root, s.id), out, "pilot");
    return out;
  });
  return { root, manifest, plan, exports };
};
describe("independent shard exports and pooled analysis", () => {
  it("merges closed pilots, distributes confirmation and reproduces canonical combined statistics", () => {
    const f = fixture(),
      pilots = readShardSet([...f.exports].reverse(), "pilot");
    expect(readFileSync(join(f.root, "A", "RESUME.md"), "utf8")).toContain(
      `scripts/simulation-study-supervisor.ts '${join(f.root, "A")}' pilot`,
    );
    const receipts = pilots.map(({ bundle: b }) => ({
      id: b.id,
      bundleHash: b.hash,
      journalSequence: b.journalSequence,
      journalHash: b.journalHash,
      attempts: b.attempts,
    }));
    const confirmation = createStudyConfirmationPlan(
      f.manifest,
      f.plan,
      receipts,
      pilots.flatMap((s) => s.storage.scores()),
      [],
    );
    const finalPaths = confirmation.shards.map((shard) => {
      const dir = join(f.root, shard.id);
      writeStudyJson(join(dir, "confirmation-plan.json"), confirmation);
      const store = new StudyStorage(dir);
      expect(store.hashAt(receipts.find((r) => r.id === shard.id)!.journalSequence)).toBe(
        receipts.find((r) => r.id === shard.id)!.journalHash,
      );
      for (const task of shard.tasks) {
        store.reserve(task);
        store.accept(observation(task), 1);
      }
      store.snapshot("ready-for-final-merge");
      expect(readFileSync(join(dir, "RESUME.md"), "utf8")).toContain(
        `scripts/simulation-study-supervisor.ts '${dir}' confirmation`,
      );
      const out = join(f.root, `final-${shard.id}`);
      exportShardBundle(dir, out, "final");
      return out;
    });
    const final = readShardSet(finalPaths, "final"),
      attempts = final.reduce((s, x) => s + x.storage.attempts, 0);
    const combined = final
      .flatMap((s) => [...s.storage.observations()])
      .sort((a, b) => a.task.id.localeCompare(b.task.id));
    const planned = [
      ...f.plan.shards.flatMap((s) => s.tasks),
      ...confirmation.shards.flatMap((s) => s.tasks),
    ]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(observation);
    const confirmationTasks = confirmation.shards.flatMap((s) => s.tasks);
    expect(createSimulationStudyReport(f.manifest, combined, attempts, confirmationTasks)).toEqual(
      createSimulationStudyReport(f.manifest, planned, attempts, confirmationTasks),
    );
    expect(attempts).toBeLessThanOrEqual(24);
  });
  it("rejects duplicate shards, cross-shard reservations and corrupted evidence", () => {
    const f = fixture();
    expect(() => readShardSet([f.exports[0]!, f.exports[0]!, f.exports[2]!], "pilot")).toThrow(
      /one bundle/u,
    );
    const a = new StudyStorage(join(f.root, "A")),
      foreign = f.plan.shards.find((s) => s.id !== "A" && s.tasks.length)!.tasks[0]!;
    expect(() => a.reserve(foreign)).toThrow(/not owned/u);
    writeFileSync(join(f.exports[0]!, "journal.jsonl"), "corrupt");
    expect(() => readShardBundle(f.exports[0]!)).toThrow(/Corrupt/u);
  });
  it("does not accept a bundle whose declared shard identity changes", () => {
    const f = fixture(),
      out = join(f.root, "tampered");
    cpSync(f.exports[0]!, out, { recursive: true });
    writeStudyJson(join(out, "shard.json"), { id: "B" });
    expect(() => readShardBundle(out)).toThrow(/Corrupt/u);
  });
});
