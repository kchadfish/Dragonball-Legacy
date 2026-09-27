import { describe, expect, it } from "vitest";
import { CANONICAL_COMBAT_MECHANICS_VIEW as view } from "@dragonball-resurgence/combat-engine";
import { ALL_SIMULATION_TEMPLATES } from "./templates.js";
import { selectSimulationCapabilityRecipes } from "./capabilities.js";
import { createSimulationStudyManifest, studyPilotTasks, studyHash } from "./study-design.js";
import {
  createStudyShardPlan,
  createStudyConfirmationPlan,
  readStudyShardPlan,
  readStudyConfirmationPlan,
  partitionStudyTasks,
  studyTaskBlockKey,
} from "./study-shards.js";
const templates = ALL_SIMULATION_TEMPLATES(),
  recipes = selectSimulationCapabilityRecipes({
    view,
    templates,
    capabilityIds: ["restricted-use", "status-control", "transformation"],
    maxRecipesPerCapability: "all",
  }).recipes;
const manifest = createSimulationStudyManifest({
  id: "sharded-study",
  sourceHash: "source",
  baselineHash: "baseline",
  mechanicsHash: view.identity.contentHash,
  templates,
  recipes,
});
describe("three-shard study allocation", () => {
  it("covers the pilot exactly once, balances fights and preserves complete seed blocks", () => {
    const plan = createStudyShardPlan(manifest),
      tasks = plan.shards.flatMap((s) => s.tasks);
    expect(plan.shards.map((s) => s.budget)).toEqual([2667, 2667, 2666]);
    expect(tasks.map((t) => t.id).sort()).toEqual(
      studyPilotTasks(manifest)
        .map((t) => t.id)
        .sort(),
    );
    const counts = plan.shards.map((s) => s.tasks.length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(4);
    const owners = new Map<string, string>();
    for (const shard of plan.shards)
      for (const task of shard.tasks) {
        const key = studyTaskBlockKey(task);
        expect(owners.get(key) ?? shard.id).toBe(shard.id);
        owners.set(key, shard.id);
      }
    expect(createStudyShardPlan(manifest)).toEqual(plan);
  });
  it("rejects overlapping task allocations and insufficient whole-block capacity", () => {
    const plan = createStudyShardPlan(manifest),
      bad = structuredClone(plan);
    bad.shards[1]!.tasks.push(bad.shards[0]!.tasks[0]!);
    expect(() => readStudyShardPlan({ ...bad, hash: studyHash(bad) })).toThrow(/split|Duplicate/u);
    expect(() => partitionStudyTasks(studyPilotTasks(manifest), [1, 1, 1])).toThrow(/fit/u);
  });
  it("selects confirmation from pooled pilots and charges all three attempt ledgers", () => {
    const pilot = createStudyShardPlan(manifest);
    const receipts = pilot.shards.map((s) => ({
      id: s.id,
      bundleHash: s.id,
      journalSequence: s.tasks.length * 2,
      journalHash: `journal-${s.id}`,
      attempts: s.tasks.length + 2,
    }));
    const scores = studyPilotTasks(manifest).map((task) => ({
      task,
      focalScore: task.branch === "baseline" ? 1 : 0,
      executionError: null,
      termination: "engine-completed",
    }));
    const diagnostics = pilot.shards
      .flatMap((s) => s.tasks)
      .slice(0, 100)
      .map((t) => ({ ...t, id: `diagnostic-${t.id}`, phase: "diagnostic" as const }));
    const confirmation = createStudyConfirmationPlan(
      manifest,
      pilot,
      receipts,
      scores,
      diagnostics,
    );
    expect(
      new Set(
        confirmation.shards
          .flatMap((s) => s.tasks)
          .filter((t) => t.phase === "confirmation")
          .map((t) => t.cellId),
      ).size,
    ).toBe(5);
    for (const shard of confirmation.shards) {
      const consumed = receipts.find((r) => r.id === shard.id)!.attempts;
      expect(consumed + shard.tasks.length).toBeLessThanOrEqual(shard.budget);
    }
    expect(
      confirmation.shards.reduce((sum, s) => sum + s.tasks.length, 0) +
        receipts.reduce((sum, r) => sum + r.attempts, 0),
    ).toBeLessThanOrEqual(8000);
    const incomplete = structuredClone(confirmation);
    const index = incomplete.shards[0]!.tasks.findIndex((t) => t.phase === "confirmation");
    incomplete.shards[0]!.tasks.splice(index, 1);
    expect(() => readStudyConfirmationPlan({ ...incomplete, hash: studyHash(incomplete) })).toThrow(
      /Incomplete/u,
    );
    const overspent = structuredClone(confirmation);
    overspent.pilotReceipts[0]!.attempts = overspent.shards[0]!.budget;
    expect(() => readStudyConfirmationPlan({ ...overspent, hash: studyHash(overspent) })).toThrow(
      /remaining/u,
    );
  });
});
