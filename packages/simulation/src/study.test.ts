import { describe, expect, it } from "vitest";
import { CANONICAL_COMBAT_MECHANICS_VIEW } from "@dragonball-resurgence/combat-engine";
import { ALL_SIMULATION_TEMPLATES, materializeSimulationTemplate } from "./templates.js";
import { simulationScenarioIdentityHash } from "./seeds.js";
import { selectSimulationCapabilityRecipes } from "./capabilities.js";
import {
  createSimulationStudyManifest,
  readSimulationStudyManifest,
  selectStudyCells,
  studyTasksFor,
} from "./study-design.js";
import { createSimulationStudyRequest } from "./study-execution.js";
import {
  studyBlockEffects,
  studyConfirmationTasks,
  studyEffectInterval,
  studyNaturalEstimate,
} from "./study-analysis.js";
import { analyzeSimulationSequences, type SimulationSequence } from "./sequences.js";
import {
  addSimulationSequenceCounts,
  renderSimulationSequenceCounts,
  simulationSequenceOccurrences,
  type SequenceCount,
} from "./sequence-counts.js";

const templates = ALL_SIMULATION_TEMPLATES();
const recipes = selectSimulationCapabilityRecipes({
  view: CANONICAL_COMBAT_MECHANICS_VIEW,
  templates,
  capabilityIds: ["restricted-use", "status-control", "transformation"],
  maxRecipesPerCapability: "all",
}).recipes;
const manifest = createSimulationStudyManifest({
  id: "test-study",
  sourceHash: "source",
  baselineHash: "baseline",
  mechanicsHash: CANONICAL_COMBAT_MECHANICS_VIEW.identity.contentHash,
  templates,
  recipes,
});
const score = (task: ReturnType<typeof studyTasksFor>[number], value: number | null) => ({
  task,
  focalScore: value,
  executionError: null,
  termination: "engine-completed",
});
const sequence = (id: string, words: string[]): SimulationSequence => ({
  sequenceId: id,
  outcome: "win",
  tokens: words.map((token, index) => ({ token, index, kind: "action", turnNumber: index })),
});

describe("budgeted simulation design and inference", () => {
  it("materializes every approved intervention and matches seeds within each orientation", () => {
    for (const recipe of recipes) {
      const requests = studyTasksFor("screening", recipe.cellId, 1).map((task) =>
        createSimulationStudyRequest(manifest, task, templates, CANONICAL_COMBAT_MECHANICS_VIEW),
      );
      for (const request of requests) {
        expect(
          materializeSimulationTemplate(request.templateA, CANONICAL_COMBAT_MECHANICS_VIEW).ok,
        ).toBe(true);
        expect(
          materializeSimulationTemplate(request.templateB, CANONICAL_COMBAT_MECHANICS_VIEW).ok,
        ).toBe(true);
      }
      for (const offset of [0, 2]) {
        expect(requests[offset]!.seedFamilyId).toBe(requests[offset + 1]!.seedFamilyId);
        expect(simulationScenarioIdentityHash(requests[offset]!.scenario)).toBe(
          simulationScenarioIdentityHash(requests[offset + 1]!.scenario),
        );
      }
    }
  });

  it("samples reproducibly, covers templates, and records probability sampling", () => {
    expect(manifest.cells).toHaveLength(256);
    expect(manifest.recipes).toHaveLength(143);
    expect(new Set(manifest.cells.flatMap((c) => [c.a, c.b])).size).toBe(48);
    expect(selectStudyCells([...templates].reverse(), 256, manifest.rootSeed)).toEqual(
      manifest.cells,
    );
    for (const c of manifest.cells) expect(c.probability).toBe(c.selected / c.population);
    expect(() => readSimulationStudyManifest({ ...manifest, budget: 7999 })).toThrow(
      /hash mismatch/u,
    );
  });
  it("removes only the target from the focal fighter in both orientations", () => {
    const recipe = recipes.find((r) => r.targetDefinitionId.startsWith("move-"))!;
    for (const task of studyTasksFor("screening", recipe.cellId, 1)) {
      const request = createSimulationStudyRequest(
        manifest,
        task,
        templates,
        CANONICAL_COMBAT_MECHANICS_VIEW,
      );
      const focal = task.mirror === "original" ? request.templateA : request.templateB;
      const original = templates.find((t) => t.id === recipe.templateAId)!;
      expect(focal.stats).toEqual(original.stats);
      expect(focal.moveIds.includes(recipe.targetDefinitionId)).toBe(task.branch === "baseline");
    }
    const [screen] = studyTasksFor("screening", recipe.cellId, 1),
      [confirm] = studyTasksFor("confirmation", recipe.cellId, 1);
    expect(
      createSimulationStudyRequest(manifest, screen!, templates, CANONICAL_COMBAT_MECHANICS_VIEW)
        .seedFamilyId,
    ).not.toBe(
      createSimulationStudyRequest(manifest, confirm!, templates, CANONICAL_COMBAT_MECHANICS_VIEW)
        .seedFamilyId,
    );
  });
  it("uses complete four-fight seed blocks and never scores missing outcomes as draws", () => {
    const tasks = studyTasksFor("screening", recipes[0]!.cellId, 2);
    const observations = tasks.map((t) => score(t, t.branch === "baseline" ? 1 : 0.5));
    expect(studyBlockEffects(observations, "screening", recipes[0]!.cellId)).toEqual([0.5, 0.5]);
    observations[0]!.focalScore = null;
    expect(studyBlockEffects(observations, "screening", recipes[0]!.cellId)).toEqual([0.5]);
  });
  it("freezes at most five independent confirmation hypotheses within the reserve", () => {
    const observations = recipes
      .slice(0, 8)
      .flatMap((r) =>
        studyTasksFor("screening", r.cellId, 5).map((t) =>
          score(t, t.branch === "baseline" ? 1 : 0),
        ),
      );
    const tasks = studyConfirmationTasks(manifest, observations, 2483);
    expect(tasks).toHaveLength(2480);
    expect(new Set(tasks.map((t) => t.cellId)).size).toBe(5);
    expect(tasks.every((t) => t.phase === "confirmation")).toBe(true);
  });
  it("reports insufficient evidence and conservative uncertainty for identical samples", () => {
    expect(studyEffectInterval([1, 1], 5, 1).classification).toBe("insufficient");
    const zeros = studyEffectInterval(
      Array.from({ length: 124 }, () => 0),
      5,
      1,
    );
    expect(zeros.lower).toBeLessThan(-0.1);
    expect(zeros.upper).toBeGreaterThan(0.1);
    expect(zeros.classification).toBe("inconclusive");
    const values = Array.from({ length: 124 }, (_, i) => (i % 2 ? 0.5 : 1));
    expect(studyEffectInterval(values, 5, 1)).toEqual(studyEffectInterval(values, 5, 1));
    expect(studyEffectInterval(values, 5, 1).classification).toBe("above-practical-threshold");
  });
  it("weights natural cells to their catalog population and refuses missing blocks", () => {
    const observations = manifest.cells.flatMap((c) =>
      studyTasksFor("natural", c.id, 5).map((t) => score(t, 0.5)),
    );
    expect(studyNaturalEstimate(manifest, observations, (o) => o.focalScore).estimate).toBeCloseTo(
      0.5,
    );
    expect(
      studyNaturalEstimate(manifest, observations.slice(1), (o) => o.focalScore).estimate,
    ).toBeNull();
  });
});

describe("sequence prefix occurrence statistics", () => {
  it("uses prefix-exposed fights and actual occurrence distances", () => {
    const a = sequence("a", ["setup", "hit"]),
      b = sequence("b", ["setup", "pass"]);
    expect(
      analyzeSimulationSequences([a, b]).find((e) => e.pattern.join(",") === "setup,hit")
        ?.conversionRate,
    ).toBe(0.5);
    const repeated = sequence("c", ["setup", "pass", "setup", "hit"]);
    expect(
      analyzeSimulationSequences([repeated]).find((e) => e.pattern.join(",") === "setup,hit")
        ?.minTurnDistance,
    ).toBe(1);
  });
  it("counts all fights beyond the old 512-example cap", () => {
    const counts = new Map<string, SequenceCount>();
    for (let i = 0; i < 600; i++)
      addSimulationSequenceCounts(
        counts,
        simulationSequenceOccurrences(sequence(String(i), ["setup", i < 300 ? "hit" : "pass"])),
        true,
      );
    const edge = renderSimulationSequenceCounts(counts, 600, 2).find(
      (e) => e.pattern[1] === "hit",
    )!;
    expect(edge.sequenceCount).toBe(300);
    expect(edge.conversionRate).toBe(0.5);
  });
});
