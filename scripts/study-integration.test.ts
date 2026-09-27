import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { CANONICAL_COMBAT_MECHANICS_VIEW as view } from "@dragonball-resurgence/combat-engine";
import {
  createSyntheticArchetypes,
  selectSimulationCapabilityRecipes,
  createSimulationStudyManifest,
  createSimulationStudyRequest,
  createSimulationStudyReport,
  readSimulationStudyReport,
  runSimulationRequestsWithWorkers,
  studyTasksFor,
  studyObservationFor,
  type StudyTask,
} from "@dragonball-resurgence/simulation";
import { StudyStorage, writeStudyJson } from "./study-storage.js";
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
it("executes an isolated real-worker study and recovers partial blocks without replaying saved fights", () => {
  const templates = createSyntheticArchetypes(view).slice(0, 2);
  const recipes = selectSimulationCapabilityRecipes({
    view,
    templates,
    capabilityIds: ["restricted-use", "status-control", "transformation"],
    maxRecipesPerCapability: "all",
  }).recipes;
  const manifest = createSimulationStudyManifest({
    id: "integration-fixture",
    sourceHash: "fixture",
    baselineHash: "fixture",
    mechanicsHash: view.identity.contentHash,
    templates,
    recipes,
    sampleCells: 1,
    pilotSeeds: 1,
    diagnosticBudget: 2,
    budget: 16,
    workers: 2,
  });
  const directory = mkdtempSync(join(tmpdir(), "study-integration-"));
  directories.push(directory);
  writeStudyJson(join(directory, "manifest.json"), manifest);
  let storage = new StudyStorage(directory);
  const execute = (tasks: StudyTask[]) => {
    const pending = storage.pending(tasks),
      attempts = new Map(pending.map((t) => [t.id, storage.reserve(t)]));
    const requests = pending.map((t) => createSimulationStudyRequest(manifest, t, templates, view));
    const lookup = new Map(requests.map((r, i) => [r.runId, pending[i]!]));
    runSimulationRequestsWithWorkers({
      requests,
      workers: 2,
      retainResults: false,
      acceptIncomplete: true,
      stoppingPolicy: "continue",
      onProgress: (progress) => {
        const task = lookup.get(progress.runId)!;
        storage.accept(studyObservationFor(task, progress), attempts.get(task.id)!);
      },
    });
  };
  const natural = studyTasksFor("natural", manifest.cells[0]!.id, 1);
  execute(natural.slice(0, 1));
  storage.snapshot("interrupted");
  storage = new StudyStorage(directory);
  execute(natural);
  expect(storage.attempts).toBe(2);
  execute(studyTasksFor("screening", recipes[0]!.cellId, 1));
  const diagnostic = studyTasksFor("diagnostic", recipes[0]!.cellId, 1).slice(0, 1);
  storage.append({ type: "allocation", phase: "diagnostic", tasks: diagnostic });
  execute(diagnostic);
  const confirmation = studyTasksFor("confirmation", recipes[0]!.cellId, 1);
  storage.append({ type: "allocation", phase: "confirmation", tasks: confirmation });
  execute(confirmation);
  const first = createSimulationStudyReport(
    manifest,
    storage.observations(),
    storage.attempts,
    confirmation,
  );
  expect(readSimulationStudyReport(first).hash).toBe(first.hash);
  const resumed = new StudyStorage(directory);
  expect(
    createSimulationStudyReport(manifest, resumed.observations(), resumed.attempts, confirmation),
  ).toEqual(first);
  expect(storage.errorAttempts).toBe(0);
  expect(storage.attempts).toBe(11);
  expect(Object.values(first.metrics).some((m) => m.metricId === "simulation:raw-win-rate")).toBe(
    true,
  );
  expect(first.effects[0]!.confirmation?.classification).toBe("insufficient");
  expect(
    [...storage.observations()].find((o) => o.task.phase === "diagnostic")?.replay,
  ).toBeDefined();
}, 60000);
