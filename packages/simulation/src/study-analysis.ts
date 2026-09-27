import { canonicalHash } from "./canonical.js";
import {
  mergeSimulationMetricAggregatesV2,
  type SimulationMetricAggregateV2,
} from "./statistics-v4.js";
import { type StudyTask, type SimulationStudyManifest, studyTasksFor } from "./study-design.js";
import type { StudyObservation } from "./study-execution.js";
import {
  addSimulationSequenceCounts,
  renderSimulationSequenceCounts,
  type SequenceCount,
} from "./sequence-counts.js";

export const studyMean = (values: readonly number[]): number =>
  values.reduce((s, x) => s + x, 0) / Math.max(1, values.length);
const variance = (values: readonly number[]): number =>
  values.length < 2
    ? 0
    : values.reduce((s, x) => s + (x - studyMean(values)) ** 2, 0) / (values.length - 1);
export type StudyScore = Pick<
  StudyObservation,
  "task" | "focalScore" | "executionError" | "termination"
>;
export const studyBlockEffects = (
  observations: readonly StudyScore[],
  phase: "screening" | "confirmation",
  cellId: string,
): number[] => {
  const blocks = new Map<number, Map<string, number>>();
  for (const o of observations)
    if (
      o.task.phase === phase &&
      o.task.cellId === cellId &&
      o.focalScore !== null &&
      o.executionError === null
    ) {
      const entries = blocks.get(o.task.seed) ?? new Map<string, number>();
      entries.set(`${o.task.mirror}/${o.task.branch}`, o.focalScore);
      blocks.set(o.task.seed, entries);
    }
  return [...blocks]
    .sort(([a], [b]) => a - b)
    .filter(([, b]) => b.size === 4)
    .map(
      ([, b]) =>
        (b.get("original/baseline")! -
          b.get("original/variant")! +
          b.get("mirrored/baseline")! -
          b.get("mirrored/variant")!) /
        2,
    );
};
const uniformGenerator = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};
const classifyEffect = (lower: number, upper: number): string => {
  if (lower > 0.1) return "above-practical-threshold";
  if (upper < -0.1) return "below-practical-threshold";
  if (lower >= -0.1 && upper <= 0.1) return "practically-equivalent";
  return "inconclusive";
};
const bootstrapMeans = (values: readonly number[], seed: number): number[] => {
  const random = uniformGenerator(seed),
    samples: number[] = [];
  for (let i = 0; i < 10000; i++) {
    let total = 0;
    for (let j = 0; j < values.length; j++) total += values[Math.floor(random() * values.length)]!;
    samples.push(total / values.length);
  }
  return samples.sort((a, b) => a - b);
};
export const studyEffectInterval = (
  values: readonly number[],
  hypotheses: number,
  seed: number,
) => {
  const n = values.length,
    estimate = studyMean(values),
    alpha = 0.05 / Math.max(1, hypotheses);
  if (n < 30)
    return {
      estimate: n ? estimate : null,
      lower: -1,
      upper: 1,
      method: "insufficient-seed-blocks",
      classification: "insufficient",
    };
  let lower: number, upper: number, method: string;
  if (variance(values) === 0) {
    const radius = Math.sqrt((2 * Math.log(2 / alpha)) / n);
    lower = Math.max(-1, estimate - radius);
    upper = Math.min(1, estimate + radius);
    method = "bounded-hoeffding";
  } else {
    const samples = bootstrapMeans(values, seed);
    lower = samples[Math.floor((alpha / 2) * 10000)]!;
    upper = samples[Math.min(9999, Math.ceil((1 - alpha / 2) * 10000) - 1)]!;
    method = "seed-block-bootstrap-bonferroni-approximate";
  }
  const classification = classifyEffect(lower, upper);
  return { estimate, lower, upper, method, classification };
};

export const studyConfirmationTasks = (
  manifest: SimulationStudyManifest,
  observations: readonly StudyScore[],
  remaining: number,
): StudyTask[] => {
  const ranked = manifest.recipes
    .map((r) => ({ r, values: studyBlockEffects(observations, "screening", r.cellId) }))
    .filter((x) => x.values.length === manifest.pilotSeeds)
    .sort(
      (a, b) =>
        Math.abs(studyMean(b.values)) - Math.abs(studyMean(a.values)) ||
        a.r.recipeId.localeCompare(b.r.recipeId),
    )
    .slice(0, 5);
  const blocks = Math.floor(remaining / 4);
  return ranked.flatMap((x, i) =>
    studyTasksFor(
      "confirmation",
      x.r.cellId,
      Math.floor(blocks / ranked.length) + Number(i < blocks % ranked.length),
    ),
  );
};

/** Stratified two-stage variance: cells first, mirrored seed blocks within cells. */
export const studyNaturalEstimate = (
  manifest: SimulationStudyManifest,
  observations: readonly StudyScore[],
  measure: (o: StudyScore) => number | null,
) => {
  const summaries = manifest.cells.map((cell) => {
    const blocks = new Map<number, number[]>();
    for (const o of observations.filter(
      (x) => x.task.phase === "natural" && x.task.cellId === cell.id,
    )) {
      const value = measure(o);
      if (value !== null) blocks.set(o.task.seed, [...(blocks.get(o.task.seed) ?? []), value]);
    }
    const values = [...blocks.values()].filter((v) => v.length === 2).map(studyMean);
    return {
      cell,
      values,
      mean: studyMean(values),
      within: variance(values) / Math.max(1, values.length),
    };
  });
  if (summaries.some((s) => s.values.length !== manifest.pilotSeeds))
    return {
      estimate: null,
      lower: null,
      upper: null,
      status: "incomplete-blocks",
      sampledCells: manifest.cells.length,
    };
  let total = 0,
    v = 0;
  const strata = new Map<string, typeof summaries>();
  for (const s of summaries) {
    total += s.mean / s.cell.probability;
    if (s.cell.certainty) v += s.within;
    else strata.set(s.cell.stratum, [...(strata.get(s.cell.stratum) ?? []), s]);
  }
  for (const rows of strata.values()) {
    const N = rows[0]!.cell.population,
      n = rows.length;
    v +=
      (N * N * (1 - n / N) * variance(rows.map((s) => s.mean))) / n +
      (N / n) * rows.reduce((sum, s) => sum + s.within, 0);
  }
  const estimate = total / manifest.populationSize;
  if (v === 0)
    return {
      estimate,
      lower: 0,
      upper: 1,
      status: "degenerate-sample-uncertainty-not-resolved",
      sampledCells: manifest.cells.length,
    };
  const radius = (1.96 * Math.sqrt(v)) / manifest.populationSize;
  return {
    estimate,
    lower: Math.max(0, estimate - radius),
    upper: Math.min(1, estimate + radius),
    status: "exploratory-design-weighted-normal-approximation",
    sampledCells: manifest.cells.length,
  };
};

export const createSimulationStudyReport = (
  manifest: SimulationStudyManifest,
  source: Iterable<StudyObservation>,
  attempts: number,
  confirmation: readonly StudyTask[],
) => {
  const observations: StudyScore[] = [],
    metrics = new Map<string, SimulationMetricAggregateV2>(),
    lineage = new Map<string, string[]>();
  const sequenceGroups = new Map<string, { count: number; patterns: Map<string, SequenceCount> }>();
  const anomalyRows: { task: StudyTask; codes: string[] }[] = [];
  for (const o of source) {
    observations.push({
      task: o.task,
      focalScore: o.focalScore,
      executionError: o.executionError,
      termination: o.termination,
    });
    for (const [key, metric] of Object.entries(o.metrics)) {
      const identity = `${o.task.phase}/${o.task.branch}/${key}`;
      const prior = metrics.get(identity);
      metrics.set(identity, prior ? mergeSimulationMetricAggregatesV2(prior, metric) : metric);
      lineage.set(identity, [...(lineage.get(identity) ?? []), o.task.id]);
    }
    const groupKey = `${o.task.phase}/${o.task.branch}`;
    if (o.sequenceAvailable) {
      const group = sequenceGroups.get(groupKey) ?? {
        count: 0,
        patterns: new Map<string, SequenceCount>(),
      };
      group.count++;
      addSimulationSequenceCounts(group.patterns, o.sequence, o.sequenceWon);
      sequenceGroups.set(groupKey, group);
    }
    anomalyRows.push({ task: o.task, codes: [...new Set(o.anomalies.map((a) => a.code))] });
  }
  const selected = [...new Set(confirmation.map((t) => t.cellId))];
  const effects = manifest.recipes.map((recipe) => {
    const screen = studyBlockEffects(observations, "screening", recipe.cellId),
      confirm = studyBlockEffects(observations, "confirmation", recipe.cellId);
    const scheduledBlocks = new Set(
      confirmation.filter((t) => t.cellId === recipe.cellId).map((t) => t.seed),
    ).size;
    const interval = studyEffectInterval(confirm, selected.length, manifest.rootSeed);
    if (confirm.length < scheduledBlocks && interval.classification !== "insufficient")
      interval.classification = "inconclusive";
    return {
      recipeId: recipe.recipeId,
      target: recipe.targetDefinitionId,
      cellId: recipe.cellId,
      screening: {
        blocks: screen.length,
        estimate: screen.length ? studyMean(screen) : null,
        label: "exploratory",
      },
      confirmation: selected.includes(recipe.cellId)
        ? {
            blocks: confirm.length,
            scheduledBlocks,
            incompleteBlocks: scheduledBlocks - confirm.length,
            ...interval,
          }
        : null,
    };
  });
  const anomalies = [...new Set(anomalyRows.flatMap((r) => r.codes))]
    .sort((a, b) => a.localeCompare(b))
    .map((code) => ({
      code,
      natural: studyNaturalEstimate(manifest, observations, (o) =>
        Number(anomalyRows.find((r) => r.task.id === o.task.id)?.codes.includes(code)),
      ),
      observedExamples: anomalyRows
        .filter((r) => r.codes.includes(code))
        .map((r) => r.task.id)
        .slice(0, 100),
      totalTriggered: anomalyRows.filter((r) => r.codes.includes(code)).length,
    }));
  const blocksById = new Map(
    observations.map((o) => [o.task.id, `${o.task.phase}/${o.task.cellId}/${o.task.seed}`]),
  );
  const value = {
    schemaVersion: "simulation-study-report:v1",
    manifestHash: manifest.hash,
    attempts,
    budget: manifest.budget,
    acceptedResults: observations.length,
    executionErrors: observations.filter((o) => o.executionError !== null).length,
    incomplete: observations.filter((o) => o.executionError === null && o.focalScore === null)
      .length,
    effects,
    natural: {
      winScore: studyNaturalEstimate(manifest, observations, (o) => o.focalScore),
      executionErrorRate: studyNaturalEstimate(manifest, observations, (o) =>
        Number(o.executionError !== null),
      ),
      incompleteRate: studyNaturalEstimate(manifest, observations, (o) =>
        Number(o.focalScore === null),
      ),
    },
    metrics: Object.fromEntries(metrics),
    metricLineage: Object.fromEntries(
      [...lineage].map(([key, ids]) => [
        key,
        {
          definitionVersion: "simulation-study-metrics:v1",
          observationIdentities: ids,
          fights: ids.length,
          seedBlocks: new Set(ids.map((id) => blocksById.get(id))).size,
          eligibleOpportunities: metrics.get(key)!.denominators.eligible,
          uncertainty: "not-estimated-for-event-aggregates",
        },
      ]),
    ),
    sequences: Object.fromEntries(
      [...sequenceGroups].map(([key, g]) => [
        key,
        {
          fights: g.count,
          definitionVersion: "sequence-prefix-occurrence:v2",
          patterns: [
            ...renderSimulationSequenceCounts(g.patterns, g.count, 2),
            ...renderSimulationSequenceCounts(g.patterns, g.count, 3),
          ],
          inference: "descriptive-selected-sample-only",
        },
      ]),
    ),
    anomalies,
    limitations: [
      "Uniform current matchup catalog, not player usage.",
      "Event opportunities are correlated; raw metric aggregates do not imply independent sample sizes.",
      "Screening and sequence patterns are exploratory; only fresh-seed confirmation has adjusted effect intervals.",
      "Conditional complete-block effects exclude failures; inspect missingness before interpretation.",
      "Historical v4 evidence is not pooled with new results.",
      "Net HP change is own ending minus starting HP.",
      "Sequence outcome association is descriptive focal-fighter win frequency, not a causal effect.",
      "Natural execution-error estimates use final logical outcomes; retry failures remain in the separate attempt ledger.",
    ],
  };
  return { ...value, hash: canonicalHash(value) };
};
