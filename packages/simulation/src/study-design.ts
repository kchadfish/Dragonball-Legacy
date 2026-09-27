import { z } from "zod";
import { canonicalHash } from "./canonical.js";
import { SIMULATION_EXPANDED_METRIC_IDS } from "./statistics-v5.js";
export const STUDY_METRIC_IDS = Object.freeze([
  ...SIMULATION_EXPANDED_METRIC_IDS,
  "simulation:raw-win-rate",
  "simulation:mean-turns",
  "simulation:damage-dealt",
  "simulation:damage-received",
  "simulation:side-bias",
  "simulation:initiative-advantage",
  "simulation:move-opportunity-funnel",
  "simulation:move-selection-rate",
  "simulation:move-execution-rate",
  "simulation:move-equipped-win-rate",
  "simulation:move-used-win-rate",
  "simulation:move-damage-per-use",
  "simulation:move-average-ki-cost",
  "simulation:move-uses-per-fight",
  "simulation:hit-rate",
]);
import {
  simulationCapabilityRecipeSchema,
  type SimulationCapabilityRecipe,
} from "./capabilities.js";
import type { SimulationTemplate } from "./contracts.js";

export const studyCellSchema = z
  .object({
    id: z.string().min(1),
    a: z.string().min(1),
    b: z.string().min(1),
    stratum: z.string().min(1),
    probability: z.number().positive().max(1),
    population: z.number().int().positive(),
    selected: z.number().int().positive(),
    certainty: z.boolean(),
  })
  .strict();
export const studyManifestSchema = z
  .object({
    schemaVersion: z.literal("simulation-study:v1"),
    id: z.string().regex(/^[a-z0-9-]+$/u),
    sourceHash: z.string().min(1),
    baselineHash: z.string().min(1),
    mechanicsHash: z.string().min(1),
    templatesHash: z.string().min(1),
    rootSeed: z.number().int().nonnegative().max(4294967295),
    fixedTime: z.iso.datetime(),
    budget: z.number().int().positive().max(8000),
    workers: z.number().int().min(1).max(8),
    pilotSeeds: z.number().int().positive(),
    diagnosticBudget: z.number().int().nonnegative(),
    populationSize: z.number().int().positive(),
    practicalThreshold: z.literal(0.1),
    metricDefinitionIds: z.array(z.string()).min(1),
    cells: z.array(studyCellSchema),
    recipes: z.array(simulationCapabilityRecipeSchema),
    hash: z.string(),
  })
  .strict();
export type SimulationStudyManifest = z.infer<typeof studyManifestSchema>;
export type StudyCell = z.infer<typeof studyCellSchema>;
export const studyPhaseSchema = z.enum(["natural", "screening", "diagnostic", "confirmation"]);
export type StudyPhase = z.infer<typeof studyPhaseSchema>;
export const studyTaskSchema = z
  .object({
    id: z.string(),
    phase: studyPhaseSchema,
    cellId: z.string(),
    seed: z.number().int().nonnegative(),
    mirror: z.enum(["original", "mirrored"]),
    branch: z.enum(["baseline", "variant"]),
  })
  .strict();
export type StudyTask = z.infer<typeof studyTaskSchema>;
export const studyHash = (value: object): string =>
  canonicalHash(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "hash")));
export const readSimulationStudyManifest = (input: unknown): SimulationStudyManifest => {
  const value = studyManifestSchema.parse(input);
  if (studyHash(value) !== value.hash) throw new Error("Study manifest hash mismatch");
  if (
    new Set(value.cells.map((c) => c.id)).size !== value.cells.length ||
    new Set(value.recipes.map((r) => r.recipeId)).size !== value.recipes.length
  )
    throw new Error("Duplicate study selection");
  return value;
};

const styleStratum = (a: string, b: string): string => {
  const styles = [a, b];
  styles.sort((left, right) => left.localeCompare(right));
  return styles.join("/");
};
const shuffled = <T>(input: readonly T[], seed: number): T[] => {
  const values = [...input];
  let state = seed >>> 0;
  for (let i = values.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = Math.floor((state / 4294967296) * (i + 1));
    [values[i], values[j]] = [values[j]!, values[i]!];
  }
  return values;
};
/** Sampling order is determined solely by the seed and stable cell identity. */
export const selectStudyCells = (
  templates: readonly SimulationTemplate[],
  count: number,
  seed: number,
): StudyCell[] => {
  const sorted = [...templates].sort((a, b) => a.id.localeCompare(b.id));
  const pairs = sorted.flatMap((a, i) =>
    sorted.slice(i + 1).map((b) => ({
      id: `study-cell-${canonicalHash([a.id, b.id]).slice(-8)}`,
      a: a.id,
      b: b.id,
      stratum: styleStratum(a.styleId, b.styleId),
    })),
  );
  if (count > pairs.length || count < Math.ceil(templates.length / 2))
    throw new Error("Invalid study sample size");
  const order = (a: { id: string }, b: { id: string }) =>
    canonicalHash([seed, a.id]).localeCompare(canonicalHash([seed, b.id])) ||
    a.id.localeCompare(b.id);
  const uncovered = new Set(sorted.map((t) => String(t.id)));
  const certainty: typeof pairs = [];
  while (uncovered.size) {
    const ranked = pairs
      .filter((p) => uncovered.has(p.a) || uncovered.has(p.b))
      .sort(
        (a, b) =>
          Number(uncovered.has(b.a)) +
            Number(uncovered.has(b.b)) -
            Number(uncovered.has(a.a)) -
            Number(uncovered.has(a.b)) || order(a, b),
      );
    const cell = ranked[0]!;
    certainty.push(cell);
    uncovered.delete(cell.a);
    uncovered.delete(cell.b);
  }
  const certainIds = new Set(certainty.map((c) => c.id));
  const groups = new Map<string, typeof pairs>();
  for (const cell of pairs.filter((p) => !certainIds.has(p.id)))
    groups.set(cell.stratum, [...(groups.get(cell.stratum) ?? []), cell]);
  const strata = [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, cells]) => ({
      id,
      cells: shuffled(cells, Number.parseInt(canonicalHash([seed, id]).slice(-8), 16)),
      n: Math.min(2, cells.length),
    }));
  const remaining = count - certainty.length;
  if (strata.reduce((s, h) => s + h.n, 0) > remaining)
    throw new Error("Sample cannot support stratum minimums");
  const residualPopulation = pairs.length - certainty.length;
  while (strata.reduce((s, h) => s + h.n, 0) < remaining) {
    const candidate = strata
      .filter((h) => h.n < h.cells.length)
      .sort(
        (a, b) =>
          (remaining * b.cells.length) / residualPopulation -
            b.n -
            ((remaining * a.cells.length) / residualPopulation - a.n) || a.id.localeCompare(b.id),
      )[0]!;
    candidate.n++;
  }
  return [
    ...certainty.map((c) => ({
      ...c,
      probability: 1,
      population: 1,
      selected: 1,
      certainty: true,
    })),
    ...strata.flatMap((h) =>
      h.cells.slice(0, h.n).map((c) => ({
        ...c,
        probability: h.n / h.cells.length,
        population: h.cells.length,
        selected: h.n,
        certainty: false,
      })),
    ),
  ].sort((a, b) => a.id.localeCompare(b.id));
};

export const createSimulationStudyManifest = (input: {
  id: string;
  sourceHash: string;
  baselineHash: string;
  mechanicsHash: string;
  templates: readonly SimulationTemplate[];
  recipes: readonly SimulationCapabilityRecipe[];
  rootSeed?: number;
  fixedTime?: string;
  budget?: number;
  workers?: number;
  sampleCells?: number;
  pilotSeeds?: number;
  diagnosticBudget?: number;
}): SimulationStudyManifest => {
  const rootSeed = input.rootSeed ?? 1427251991;
  const value: SimulationStudyManifest = {
    schemaVersion: "simulation-study:v1",
    id: input.id,
    sourceHash: input.sourceHash,
    baselineHash: input.baselineHash,
    mechanicsHash: input.mechanicsHash,
    templatesHash: canonicalHash(input.templates),
    rootSeed,
    fixedTime: input.fixedTime ?? "2026-01-01T00:00:00.000Z",
    budget: input.budget ?? 8000,
    workers: input.workers ?? 8,
    pilotSeeds: input.pilotSeeds ?? 5,
    diagnosticBudget: input.diagnosticBudget ?? 100,
    practicalThreshold: 0.1,
    metricDefinitionIds: [...STUDY_METRIC_IDS],
    populationSize: (input.templates.length * (input.templates.length - 1)) / 2,
    cells: selectStudyCells(input.templates, input.sampleCells ?? 256, rootSeed),
    recipes: [...input.recipes].sort((a, b) => a.recipeId.localeCompare(b.recipeId)),
    hash: "",
  };
  const pilotCost = value.pilotSeeds * (value.cells.length * 2 + value.recipes.length * 4);
  if (pilotCost + value.diagnosticBudget > value.budget)
    throw new Error("Pilot exceeds study budget");
  return readSimulationStudyManifest({ ...value, hash: studyHash(value) });
};

export const studyTasksFor = (phase: StudyPhase, cellId: string, seeds: number): StudyTask[] =>
  Array.from({ length: seeds }, (_, seed) =>
    (["original", "mirrored"] as const).flatMap((mirror) =>
      (phase === "screening" || phase === "confirmation"
        ? (["baseline", "variant"] as const)
        : (["baseline"] as const)
      ).map((branch) => ({
        id: `study-fight-${phase}-${cellId}-${seed}-${mirror}-${branch}`,
        phase,
        cellId,
        seed,
        mirror,
        branch,
      })),
    ),
  ).flat();
export const studyPilotTasks = (manifest: SimulationStudyManifest): StudyTask[] => [
  ...manifest.cells.flatMap((c) => studyTasksFor("natural", c.id, manifest.pilotSeeds)),
  ...manifest.recipes.flatMap((r) => studyTasksFor("screening", r.cellId, manifest.pilotSeeds)),
];

export const simulationStudyCheckpointSchema = z
  .object({
    schemaVersion: z.literal("simulation-study-checkpoint:v1"),
    manifestHash: z.string(),
    journalSequence: z.number().int().nonnegative(),
    journalHash: z.string(),
    attempts: z.number().int().nonnegative().max(8000),
    results: z.number().int().nonnegative(),
    allocations: z.record(z.string(), z.array(studyTaskSchema)),
    status: z.string(),
    updatedAt: z.iso.datetime(),
    hash: z.string(),
  })
  .strict();
export const readSimulationStudyCheckpoint = (input: unknown) => {
  const checkpoint = simulationStudyCheckpointSchema.parse(input);
  if (studyHash(checkpoint) !== checkpoint.hash || checkpoint.results > checkpoint.attempts)
    throw new Error("Study checkpoint integrity failure");
  return checkpoint;
};
