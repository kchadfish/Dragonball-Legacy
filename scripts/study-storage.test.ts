import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ALL_SIMULATION_TEMPLATES,
  createSimulationStudyManifest,
  studyHash,
  studyTasksFor,
  type StudyObservation,
} from "@dragonball-resurgence/simulation";
import { StudyStorage, writeStudyJson } from "./study-storage.js";
const directories: string[] = [];
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});
const fixture = () => {
  const directory = mkdtempSync(join(tmpdir(), "study-storage-"));
  directories.push(directory);
  const manifest = createSimulationStudyManifest({
    id: "fixture",
    sourceHash: "source",
    baselineHash: "baseline",
    mechanicsHash: "mechanics",
    templates: ALL_SIMULATION_TEMPLATES(),
    recipes: [],
  });
  const small = { ...manifest, budget: 2 };
  writeStudyJson(join(directory, "manifest.json"), { ...small, hash: studyHash(small) });
  return new StudyStorage(directory);
};
const observation = (task: ReturnType<typeof studyTasksFor>[number]): StudyObservation => ({
  task,
  runId: task.id,
  executionError: null,
  termination: "engine-completed",
  focalScore: 0.5,
  metrics: {},
  sequence: [],
  sequenceAvailable: false,
  sequenceWon: false,
  anomalies: [],
});
describe("study recovery journal", () => {
  it("reserves eight concurrent attempts without overshooting the hard cap", () => {
    const storage = fixture();
    const manifest = { ...storage.manifest, budget: 8 };
    writeStudyJson(join(storage.directory, "manifest.json"), {
      ...manifest,
      hash: studyHash(manifest),
    });
    const run = new StudyStorage(storage.directory),
      tasks = studyTasksFor("natural", "cell", 5);
    for (const task of tasks.slice(0, 8)) run.reserve(task);
    expect(() => run.reserve(tasks[8]!)).toThrow(/budget/u);
    expect(new StudyStorage(storage.directory).attempts).toBe(8);
  });

  it("charges interrupted attempts and resumes only missing orientations", () => {
    const storage = fixture(),
      tasks = studyTasksFor("natural", "cell", 1);
    storage.reserve(tasks[0]!);
    storage.accept(observation(tasks[0]!), 1);
    storage.reserve(tasks[1]!);
    const restored = new StudyStorage(storage.directory);
    expect(restored.attempts).toBe(2);
    expect(restored.pending(tasks)).toEqual([tasks[1]]);
    expect(() => restored.reserve(tasks[1]!)).toThrow(/budget/u);
    expect([...restored.observations()]).toEqual([observation(tasks[0]!)]);
  });
  it("does not retry failed or interrupted diagnostics after recovery", () => {
    for (const failed of [false, true]) {
      const storage = fixture(),
        task = studyTasksFor("diagnostic", "cell", 1)[0]!;
      storage.reserve(task);
      if (failed)
        storage.accept(
          { ...observation(task), executionError: "fixture failure", focalScore: null },
          1,
        );
      const restored = new StudyStorage(storage.directory);
      expect(restored.attempts).toBe(1);
      expect(restored.pending([task])).toEqual([]);
      expect(() => restored.reserve(task)).toThrow(/Retry allowance/u);
      expect(new StudyStorage(storage.directory).attempts).toBe(1);
    }
  });
  it("repairs only a truncated tail and rejects corruption in committed history", () => {
    const storage = fixture(),
      task = studyTasksFor("natural", "cell", 1)[0]!;
    storage.reserve(task);
    appendFileSync(join(storage.directory, "journal.jsonl"), '{"torn":');
    const restored = new StudyStorage(storage.directory);
    expect(restored.attempts).toBe(1);
    restored.repairTail();
    restored.accept(observation(task), 1);
    expect(new StudyStorage(storage.directory).results.size).toBe(1);
    const path = join(storage.directory, "journal.jsonl");
    writeFileSync(path, readFileSync(path, "utf8").replace('"attempt":1', '"attempt":2'));
    expect(() => new StudyStorage(storage.directory)).toThrow(/integrity/u);
  });
  it("freezes allocations once and detects changed durable result content", () => {
    const storage = fixture(),
      task = studyTasksFor("natural", "cell", 1)[0]!;
    storage.append({ type: "allocation", phase: "confirmation", tasks: [] });
    storage.reserve(task);
    storage.accept(observation(task), 1);
    expect(() => storage.accept(observation(task), 1)).toThrow(/duplicate/u);
    expect(() => storage.append({ type: "allocation", phase: "confirmation", tasks: [] })).toThrow(
      /frozen/u,
    );
    storage.snapshot("test");
    const restored = new StudyStorage(storage.directory);
    expect(restored.allocations.get("confirmation")).toEqual([]);
    const entry = restored.results.get(task.id)!;
    writeFileSync(join(storage.directory, "results", entry.file), "corrupt");
    expect(() => [...restored.observations()]).toThrow(/integrity/u);
    expect(readFileSync(join(storage.directory, "RESUME.md"), "utf8")).toContain("resume --dir");
  });
});
