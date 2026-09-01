import { deriveDeterministicSeed } from "@dragonball-resurgence/combat-engine";
import { z } from "zod";

import { canonicalHash } from "./canonical.js";

const finiteNumber = z.number().refine(Number.isFinite, "Number must be finite.");
const positiveInteger = z.number().int().positive();

export interface SimulationCounter {
  readonly count: number;
}

export const simulationCounterSchema = z.object({ count: z.number().int().nonnegative() }).strict();

export const createSimulationCounter = (): SimulationCounter => ({ count: 0 });

export const addSimulationCount = (counter: SimulationCounter, count = 1): SimulationCounter => {
  if (!Number.isInteger(count) || count < 0) throw new RangeError("Count must be non-negative.");
  return { count: counter.count + count };
};

export const mergeSimulationCounters = (
  left: SimulationCounter,
  right: SimulationCounter,
): SimulationCounter => ({ count: left.count + right.count });

export interface SimulationMeanVariance {
  readonly count: number;
  readonly mean: number;
  readonly m2: number;
}

export const simulationMeanVarianceSchema = z
  .object({
    count: z.number().int().nonnegative(),
    mean: finiteNumber,
    m2: finiteNumber.nonnegative(),
  })
  .strict();

export const createSimulationMeanVariance = (): SimulationMeanVariance => ({
  count: 0,
  mean: 0,
  m2: 0,
});

const requireFinite = (value: number, label: string): void => {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite.`);
};

const rounded = (value: number): number => {
  requireFinite(value, "Statistic");
  return Number(value.toFixed(12));
};

export const addSimulationValue = (
  aggregate: SimulationMeanVariance,
  value: number,
): SimulationMeanVariance => {
  requireFinite(value, "Observation");
  const count = aggregate.count + 1;
  const delta = value - aggregate.mean;
  const mean = aggregate.mean + delta / count;
  return {
    count,
    mean: rounded(mean),
    m2: rounded(aggregate.m2 + delta * (value - mean)),
  };
};

export const mergeSimulationMeanVariances = (
  left: SimulationMeanVariance,
  right: SimulationMeanVariance,
): SimulationMeanVariance => {
  if (left.count === 0) return right;
  if (right.count === 0) return left;
  const count = left.count + right.count;
  const delta = right.mean - left.mean;
  return {
    count,
    mean: rounded(left.mean + (delta * right.count) / count),
    m2: rounded(left.m2 + right.m2 + (delta * delta * left.count * right.count) / count),
  };
};

export const simulationVariance = (aggregate: SimulationMeanVariance): number =>
  aggregate.count > 1 ? rounded(aggregate.m2 / (aggregate.count - 1)) : 0;

export const simulationStandardDeviation = (aggregate: SimulationMeanVariance): number =>
  rounded(Math.sqrt(simulationVariance(aggregate)));

export interface SimulationHistogram {
  readonly boundaries: readonly number[];
  readonly counts: readonly number[];
  readonly underflow: number;
  readonly overflow: number;
}

export const simulationHistogramSchema = z
  .object({
    boundaries: z.array(finiteNumber),
    counts: z.array(z.number().int().nonnegative()),
    underflow: z.number().int().nonnegative(),
    overflow: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.counts.length !== value.boundaries.length + 1)
      context.addIssue({
        code: "custom",
        message: "Histogram requires one more bin than boundaries.",
      });
    if (
      value.boundaries.some(
        (boundary, index) => index > 0 && boundary <= value.boundaries[index - 1],
      )
    )
      context.addIssue({
        code: "custom",
        message: "Histogram boundaries must be strictly increasing.",
      });
  });

export const createSimulationHistogram = (boundaries: readonly number[]): SimulationHistogram => {
  const parsed = simulationHistogramSchema.safeParse({
    boundaries: [...boundaries],
    counts: Array.from({ length: boundaries.length + 1 }, () => 0),
    underflow: 0,
    overflow: 0,
  });
  if (!parsed.success) throw new RangeError(parsed.error.message);
  return parsed.data;
};

export const addSimulationHistogramValue = (
  histogram: SimulationHistogram,
  value: number,
): SimulationHistogram => {
  requireFinite(value, "Observation");
  if (histogram.boundaries.length === 0) return { ...histogram, counts: [histogram.counts[0] + 1] };
  if (value < histogram.boundaries[0]) return { ...histogram, underflow: histogram.underflow + 1 };
  if (value >= histogram.boundaries.at(-1)!)
    return { ...histogram, overflow: histogram.overflow + 1 };
  const index = histogram.boundaries.findIndex((boundary) => value < boundary);
  const bin = index === -1 ? histogram.counts.length - 1 : index;
  return {
    ...histogram,
    counts: histogram.counts.map((count, countIndex) => (countIndex === bin ? count + 1 : count)),
  };
};

export const mergeSimulationHistograms = (
  left: SimulationHistogram,
  right: SimulationHistogram,
): SimulationHistogram => {
  if (canonicalHash(left.boundaries) !== canonicalHash(right.boundaries))
    throw new RangeError("Histograms must use identical boundaries.");
  return {
    boundaries: left.boundaries,
    counts: left.counts.map((count, index) => count + right.counts[index]),
    underflow: left.underflow + right.underflow,
    overflow: left.overflow + right.overflow,
  };
};

export interface SimulationQuantileCentroid {
  readonly value: number;
  readonly count: number;
}

export interface SimulationQuantileSketch {
  readonly capacity: number;
  readonly count: number;
  readonly centroids: readonly SimulationQuantileCentroid[];
}

export const simulationQuantileSketchSchema = z
  .object({
    capacity: positiveInteger,
    count: z.number().int().nonnegative(),
    centroids: z.array(z.object({ value: finiteNumber, count: positiveInteger }).strict()),
  })
  .strict();

export const createSimulationQuantileSketch = (capacity = 128): SimulationQuantileSketch => {
  if (!Number.isInteger(capacity) || capacity < 1)
    throw new RangeError("Sketch capacity must be positive.");
  return { capacity, count: 0, centroids: [] };
};

const compressCentroids = (
  centroids: readonly SimulationQuantileCentroid[],
  capacity: number,
): readonly SimulationQuantileCentroid[] => {
  const sorted = [...centroids].sort((left, right) => left.value - right.value);
  while (sorted.length > capacity) {
    let mergeIndex = 0;
    let smallestGap = Math.abs(sorted[1].value - sorted[0].value);
    for (let index = 1; index < sorted.length - 1; index += 1) {
      const gap = Math.abs(sorted[index + 1].value - sorted[index].value);
      if (gap < smallestGap) {
        mergeIndex = index;
        smallestGap = gap;
      }
    }
    const left = sorted[mergeIndex];
    const right = sorted[mergeIndex + 1];
    const count = left.count + right.count;
    sorted.splice(mergeIndex, 2, {
      value: rounded((left.value * left.count + right.value * right.count) / count),
      count,
    });
  }
  return sorted;
};

export const addSimulationQuantileValue = (
  sketch: SimulationQuantileSketch,
  value: number,
): SimulationQuantileSketch => {
  requireFinite(value, "Observation");
  return {
    capacity: sketch.capacity,
    count: sketch.count + 1,
    centroids: compressCentroids([...sketch.centroids, { value, count: 1 }], sketch.capacity),
  };
};

export const mergeSimulationQuantileSketches = (
  left: SimulationQuantileSketch,
  right: SimulationQuantileSketch,
): SimulationQuantileSketch => {
  if (left.capacity !== right.capacity) throw new RangeError("Sketch capacities must match.");
  return {
    capacity: left.capacity,
    count: left.count + right.count,
    centroids: compressCentroids([...left.centroids, ...right.centroids], left.capacity),
  };
};

export const simulationQuantile = (
  sketch: SimulationQuantileSketch,
  quantile: number,
): number | undefined => {
  if (sketch.count === 0) return undefined;
  if (!Number.isFinite(quantile) || quantile < 0 || quantile > 1)
    throw new RangeError("Quantile must be between zero and one.");
  const rank = quantile * (sketch.count - 1);
  let cumulative = 0;
  for (const centroid of sketch.centroids) {
    cumulative += centroid.count;
    if (rank < cumulative) return centroid.value;
  }
  return sketch.centroids.at(-1)?.value;
};

export interface SimulationPairedObservation {
  readonly identity: string;
  readonly difference: number;
}

export interface SimulationPairedDifferenceAggregate {
  readonly count: number;
  readonly meanVariance: SimulationMeanVariance;
  readonly positiveCount: number;
  readonly negativeCount: number;
  readonly equalCount: number;
  readonly observations: readonly SimulationPairedObservation[];
}

export const createSimulationPairedDifferenceAggregate =
  (): SimulationPairedDifferenceAggregate => ({
    count: 0,
    meanVariance: createSimulationMeanVariance(),
    positiveCount: 0,
    negativeCount: 0,
    equalCount: 0,
    observations: [],
  });

export const addSimulationPairedDifference = (
  aggregate: SimulationPairedDifferenceAggregate,
  identity: string,
  difference: number,
): SimulationPairedDifferenceAggregate => {
  if (identity.length === 0) throw new RangeError("Paired observation identity is required.");
  requireFinite(difference, "Paired difference");
  if (aggregate.observations.some((observation) => observation.identity === identity))
    throw new RangeError(`Duplicate paired observation identity: ${identity}.`);
  return {
    count: aggregate.count + 1,
    meanVariance: addSimulationValue(aggregate.meanVariance, difference),
    positiveCount: aggregate.positiveCount + (difference > 0 ? 1 : 0),
    negativeCount: aggregate.negativeCount + (difference < 0 ? 1 : 0),
    equalCount: aggregate.equalCount + (difference > 0 || difference < 0 ? 0 : 1),
    observations: [...aggregate.observations, { identity, difference }].sort((left, right) =>
      left.identity.localeCompare(right.identity),
    ),
  };
};

export const mergeSimulationPairedDifferences = (
  left: SimulationPairedDifferenceAggregate,
  right: SimulationPairedDifferenceAggregate,
): SimulationPairedDifferenceAggregate => {
  const observations = [...left.observations, ...right.observations].sort((a, b) =>
    a.identity.localeCompare(b.identity),
  );
  for (let index = 1; index < observations.length; index += 1) {
    if (observations[index].identity === observations[index - 1].identity) {
      if (observations[index].difference !== observations[index - 1].difference)
        throw new RangeError(
          `Conflicting paired observation identity: ${observations[index].identity}.`,
        );
      observations.splice(index, 1);
      index -= 1;
    }
  }
  return observations.reduce(
    (aggregate, observation) =>
      addSimulationPairedDifference(aggregate, observation.identity, observation.difference),
    createSimulationPairedDifferenceAggregate(),
  );
};

export interface SimulationMetricDefinition {
  readonly id: string;
  readonly label: string;
  readonly unit: string;
  readonly aggregation: "count" | "mean" | "rate" | "histogram" | "quantile" | "paired-difference";
  readonly denominator?: string;
  readonly intervalMethod?: "none" | "wilson-95" | "paired-bootstrap-95";
  readonly missingness: "exclude" | "zero" | "error";
  readonly warning?: string;
}

export const simulationMetricDefinitionSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    unit: z.string().min(1),
    aggregation: z.enum(["count", "mean", "rate", "histogram", "quantile", "paired-difference"]),
    denominator: z.string().min(1).optional(),
    intervalMethod: z.enum(["none", "wilson-95", "paired-bootstrap-95"]).optional(),
    missingness: z.enum(["exclude", "zero", "error"]),
    warning: z.string().min(1).optional(),
  })
  .strict();

export const SIMULATION_METRIC_DICTIONARY: readonly SimulationMetricDefinition[] = Object.freeze([
  {
    id: "fight-win-rate",
    label: "Fight win rate",
    unit: "proportion",
    aggregation: "rate",
    denominator: "completed-fights",
    intervalMethod: "wilson-95",
    missingness: "exclude",
    warning: "Incomplete and errored fights are not evidence for this rate.",
  },
  {
    id: "damage-per-action",
    label: "Damage per action",
    unit: "hit-points",
    aggregation: "mean",
    denominator: "resolved-actions",
    intervalMethod: "paired-bootstrap-95",
    missingness: "exclude",
  },
  {
    id: "move-selection-rate",
    label: "Move selection rate",
    unit: "proportion",
    aggregation: "rate",
    denominator: "eligible-states",
    intervalMethod: "wilson-95",
    missingness: "exclude",
  },
  {
    id: "turns-to-completion",
    label: "Turns to completion",
    unit: "turns",
    aggregation: "quantile",
    missingness: "exclude",
  },
]);

export const SIMULATION_METRIC_DICTIONARY_VERSION = "simulation-metrics:v1" as const;

export interface SimulationMetricDictionary {
  readonly schemaVersion: typeof SIMULATION_METRIC_DICTIONARY_VERSION;
  readonly metrics: readonly SimulationMetricDefinition[];
  readonly dictionaryHash: string;
}

export const simulationMetricDictionary: SimulationMetricDictionary = Object.freeze({
  schemaVersion: SIMULATION_METRIC_DICTIONARY_VERSION,
  metrics: SIMULATION_METRIC_DICTIONARY,
  dictionaryHash: canonicalHash({
    schemaVersion: SIMULATION_METRIC_DICTIONARY_VERSION,
    metrics: SIMULATION_METRIC_DICTIONARY,
  }),
});

export interface SimulationInterval {
  readonly lower: number;
  readonly upper: number;
  readonly confidence: number;
}

export interface SimulationRateSummary extends SimulationInterval {
  readonly numerator: number;
  readonly denominator: number;
  readonly missingCount: number;
  readonly errorCount: number;
  readonly rate: number;
}

export const summarizeSimulationRate = (
  numerator: number,
  denominator: number,
  missingCount = 0,
  errorCount = 0,
): SimulationRateSummary => {
  if (
    !Number.isInteger(numerator) ||
    numerator < 0 ||
    !Number.isInteger(denominator) ||
    denominator < 1 ||
    numerator > denominator ||
    !Number.isInteger(missingCount) ||
    missingCount < 0 ||
    !Number.isInteger(errorCount) ||
    errorCount < 0
  )
    throw new RangeError("Rate counts are outside their valid ranges.");
  const interval = wilsonInterval(numerator, denominator);
  return {
    ...interval,
    numerator,
    denominator,
    missingCount,
    errorCount,
    rate: rounded(numerator / denominator),
  };
};

export interface SimulationRateSamplingPolicy {
  readonly targetHalfWidth: number;
  readonly maximumCompletedPairs: number;
}

export const SIMULATION_PRIMARY_RATE_SAMPLING_POLICY: SimulationRateSamplingPolicy = Object.freeze({
  targetHalfWidth: 0.05,
  maximumCompletedPairs: 10_000,
});

export const wilsonHalfWidth = (summary: SimulationRateSummary): number =>
  rounded((summary.upper - summary.lower) / 2);

export const shouldContinueSimulationRateSampling = (
  summary: SimulationRateSummary,
  policy: SimulationRateSamplingPolicy = SIMULATION_PRIMARY_RATE_SAMPLING_POLICY,
): boolean =>
  summary.denominator < policy.maximumCompletedPairs &&
  wilsonHalfWidth(summary) > policy.targetHalfWidth;

export const wilsonInterval = (
  successes: number,
  trials: number,
  confidence = 0.95,
): SimulationInterval => {
  if (!Number.isInteger(successes) || successes < 0 || !Number.isInteger(trials) || trials < 1)
    throw new RangeError("Wilson counts must be non-negative successes and positive trials.");
  if (successes > trials || confidence <= 0 || confidence >= 1)
    throw new RangeError("Wilson inputs are outside their valid ranges.");
  const zScore = inverseNormal((1 + confidence) / 2);
  const proportion = successes / trials;
  const denominator = 1 + (zScore * zScore) / trials;
  const center = (proportion + (zScore * zScore) / (2 * trials)) / denominator;
  const margin =
    (zScore / denominator) *
    Math.sqrt((proportion * (1 - proportion)) / trials + (zScore * zScore) / (4 * trials * trials));
  return {
    lower: rounded(Math.max(0, center - margin)),
    upper: rounded(Math.min(1, center + margin)),
    confidence,
  };
};

const inverseNormal = (probability: number): number => {
  if (probability <= 0 || probability >= 1)
    throw new RangeError("Probability must be between zero and one.");
  const a = [
    -39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472,
    2.50662827745924,
  ];
  const b = [
    -54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857,
  ];
  const c = [
    -0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373,
    4.37466414146497, 2.93816398269878,
  ];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const polynomial = (coefficients: readonly number[], value: number): number =>
    coefficients.reduce((result, coefficient) => result * value + coefficient, 0);
  if (probability < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return polynomial(c, q) / (polynomial(d, q) * q + 1);
  }
  if (probability > 1 - 0.02425) return -inverseNormal(1 - probability);
  const q = probability - 0.5;
  const r = q * q;
  return (polynomial(a, r) * q) / (polynomial(b, r) * r + 1);
};

export interface SimulationBootstrapOptions {
  readonly resamples?: number;
  readonly confidence?: number;
}

export interface SimulationBootstrapResult extends SimulationInterval {
  readonly estimate: number;
  readonly resamples: number;
  readonly seed: number;
}

const nextRandom = (state: { value: number }): number => {
  state.value = (Math.imul(state.value ^ (state.value >>> 16), 2_246_822_519) + 1) >>> 0;
  return state.value / 4_294_967_296;
};

export const seededBootstrapPairedDifference = (
  observations: readonly SimulationPairedObservation[],
  rootSeed: number,
  options: SimulationBootstrapOptions = {},
): SimulationBootstrapResult => {
  if (!Number.isInteger(rootSeed) || rootSeed < 0 || rootSeed >= 2 ** 32)
    throw new RangeError("Bootstrap root seed must be an unsigned 32-bit integer.");
  if (observations.length === 0) throw new RangeError("Bootstrap requires paired observations.");
  const resamples = options.resamples ?? 10_000;
  const confidence = options.confidence ?? 0.95;
  if (!Number.isInteger(resamples) || resamples < 1)
    throw new RangeError("Bootstrap resamples must be positive.");
  if (confidence <= 0 || confidence >= 1)
    throw new RangeError("Bootstrap confidence must be between zero and one.");
  const ordered = [...observations].sort((left, right) =>
    left.identity.localeCompare(right.identity),
  );
  const seed = deriveDeterministicSeed([
    "simulation-statistics",
    rootSeed,
    canonicalHash(ordered.map((observation) => observation.identity)),
    resamples,
  ]);
  const state = { value: seed };
  const means = Array.from({ length: resamples }, () => {
    let total = 0;
    for (let index = 0; index < ordered.length; index += 1)
      total += ordered[Math.floor(nextRandom(state) * ordered.length)].difference;
    return total / ordered.length;
  }).sort((left, right) => left - right);
  const lowerIndex = ((1 - confidence) / 2) * (resamples - 1);
  const upperIndex = ((1 + confidence) / 2) * (resamples - 1);
  const at = (index: number): number => {
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    return rounded(means[lower] + (means[upper] - means[lower]) * (index - lower));
  };
  return {
    lower: at(lowerIndex),
    upper: at(upperIndex),
    confidence,
    estimate: rounded(
      ordered.reduce((total, observation) => total + observation.difference, 0) / ordered.length,
    ),
    resamples,
    seed,
  };
};

export interface SimulationPValue {
  readonly identity: string;
  readonly pValue: number;
}

export interface AdjustedSimulationPValue extends SimulationPValue {
  readonly adjustedPValue: number;
  readonly exploratoryFlag: boolean;
}

/** Versioned Benjamini-Hochberg adjustment for exploratory triage only. */
export const adjustSimulationPValues = (
  values: readonly SimulationPValue[],
  falseDiscoveryRate = 0.05,
): readonly AdjustedSimulationPValue[] => {
  if (falseDiscoveryRate <= 0 || falseDiscoveryRate >= 1)
    throw new RangeError("False discovery rate must be between zero and one.");
  const ordered = [...values]
    .map((value) => {
      if (!Number.isFinite(value.pValue) || value.pValue < 0 || value.pValue > 1)
        throw new RangeError(`Invalid p-value for ${value.identity}.`);
      return value;
    })
    .sort(
      (left, right) => left.pValue - right.pValue || left.identity.localeCompare(right.identity),
    );
  const adjusted = new Array<number>(ordered.length);
  let runningMinimum = 1;
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    runningMinimum = Math.min(
      runningMinimum,
      (ordered[index].pValue * ordered.length) / (index + 1),
    );
    adjusted[index] = rounded(runningMinimum);
  }
  return ordered
    .map((value, index) => ({
      ...value,
      adjustedPValue: adjusted[index],
      exploratoryFlag: adjusted[index] <= falseDiscoveryRate,
    }))
    .sort((left, right) => left.identity.localeCompare(right.identity));
};

export const SIMULATION_PRECISION_LOOKS = Object.freeze([250, 500, 1_000, 2_000, 5_000, 10_000]);

export type SimulationPrecisionStatus = "not-started" | "pilot" | "precise" | "low-precision";

export const simulationPrecisionTargetFor = (completedPairs: number): number => {
  if (!Number.isInteger(completedPairs) || completedPairs < 0)
    throw new RangeError("Completed pair count must be a non-negative integer.");
  return SIMULATION_PRECISION_LOOKS.find((look) => completedPairs < look) ?? 10_000;
};

export const simulationPrecisionStatus = (
  completedPairs: number,
  primaryMetricHalfWidth?: number,
): SimulationPrecisionStatus => {
  if (completedPairs === 0) return "not-started";
  if (completedPairs < 250) return "pilot";
  if (primaryMetricHalfWidth === undefined)
    return completedPairs >= 10_000 ? "low-precision" : "pilot";
  if (completedPairs >= 10_000 && primaryMetricHalfWidth > 0.05) return "low-precision";
  return primaryMetricHalfWidth <= 0.05 ? "precise" : "pilot";
};

export interface SimulationStratifiedObservation {
  readonly pairId: string;
  readonly winner: "a" | "b" | "draw";
  readonly turns: number;
  readonly damageA: number;
  readonly damageB: number;
  readonly primaryDifference?: number;
  readonly representativeSeed?: number;
}

export interface SimulationStratifiedAccumulator {
  readonly schemaVersion: "simulation-stratified-accumulator:v2";
  readonly stratumId: string;
  readonly completedPairs: number;
  readonly winsA: number;
  readonly winsB: number;
  readonly draws: number;
  readonly turns: SimulationMeanVariance;
  readonly damageA: SimulationMeanVariance;
  readonly damageB: SimulationMeanVariance;
  readonly pairedDifferences: SimulationPairedDifferenceAggregate;
  readonly representativeSeeds: readonly number[];
  readonly errorCount: number;
  readonly precision: SimulationPrecisionStatus;
  readonly primaryMetricHalfWidth?: number;
  readonly accumulatorHash: string;
}

const requireObservationNumber = (value: number, label: string): void => {
  if (!Number.isFinite(value) || value < 0)
    throw new RangeError(`${label} must be finite and non-negative.`);
};

const accumulatorWithHash = (
  accumulator: Omit<SimulationStratifiedAccumulator, "accumulatorHash">,
): SimulationStratifiedAccumulator => ({
  ...accumulator,
  accumulatorHash: canonicalHash(accumulator),
});

export const createSimulationStratifiedAccumulator = (
  stratumId: string,
): SimulationStratifiedAccumulator => {
  if (stratumId.trim().length === 0) throw new RangeError("Stratum identity is required.");
  return accumulatorWithHash({
    schemaVersion: "simulation-stratified-accumulator:v2",
    stratumId,
    completedPairs: 0,
    winsA: 0,
    winsB: 0,
    draws: 0,
    turns: createSimulationMeanVariance(),
    damageA: createSimulationMeanVariance(),
    damageB: createSimulationMeanVariance(),
    pairedDifferences: createSimulationPairedDifferenceAggregate(),
    representativeSeeds: [],
    errorCount: 0,
    precision: "not-started",
  });
};

export const addSimulationStratifiedObservation = (
  accumulator: SimulationStratifiedAccumulator,
  observation: SimulationStratifiedObservation,
): SimulationStratifiedAccumulator => {
  if (observation.pairId.trim().length === 0) throw new RangeError("Pair identity is required.");
  if (
    accumulator.pairedDifferences.observations.some(
      (entry) => entry.identity === observation.pairId,
    )
  )
    throw new RangeError(`Duplicate stratified pair identity: ${observation.pairId}.`);
  if (!Number.isInteger(observation.turns) || observation.turns < 0)
    throw new RangeError("Fight turns must be a non-negative integer.");
  requireObservationNumber(observation.damageA, "Damage A");
  requireObservationNumber(observation.damageB, "Damage B");
  const completedPairs = accumulator.completedPairs + 1;
  const primaryDifference =
    observation.primaryDifference ?? observation.damageA - observation.damageB;
  const pairedDifferences = addSimulationPairedDifference(
    accumulator.pairedDifferences,
    observation.pairId,
    primaryDifference,
  );
  const winsA = accumulator.winsA + (observation.winner === "a" ? 1 : 0);
  const halfWidth = wilsonHalfWidth(summarizeSimulationRate(winsA, completedPairs));
  return accumulatorWithHash({
    ...accumulator,
    completedPairs,
    winsA,
    winsB: accumulator.winsB + (observation.winner === "b" ? 1 : 0),
    draws: accumulator.draws + (observation.winner === "draw" ? 1 : 0),
    turns: addSimulationValue(accumulator.turns, observation.turns),
    damageA: addSimulationValue(accumulator.damageA, observation.damageA),
    damageB: addSimulationValue(accumulator.damageB, observation.damageB),
    pairedDifferences,
    representativeSeeds:
      observation.representativeSeed === undefined
        ? accumulator.representativeSeeds
        : [...new Set([...accumulator.representativeSeeds, observation.representativeSeed])]
            .sort((left, right) => left - right)
            .slice(0, 8),
    precision: simulationPrecisionStatus(completedPairs, halfWidth),
    primaryMetricHalfWidth: halfWidth,
  });
};

export const mergeSimulationStratifiedAccumulators = (
  left: SimulationStratifiedAccumulator,
  right: SimulationStratifiedAccumulator,
): SimulationStratifiedAccumulator => {
  if (left.stratumId !== right.stratumId)
    throw new RangeError("Stratified accumulators must have matching stratum identities.");
  const pairedDifferences = mergeSimulationPairedDifferences(
    left.pairedDifferences,
    right.pairedDifferences,
  );
  const merged = {
    ...left,
    completedPairs: left.completedPairs + right.completedPairs,
    winsA: left.winsA + right.winsA,
    winsB: left.winsB + right.winsB,
    draws: left.draws + right.draws,
    turns: mergeSimulationMeanVariances(left.turns, right.turns),
    damageA: mergeSimulationMeanVariances(left.damageA, right.damageA),
    damageB: mergeSimulationMeanVariances(left.damageB, right.damageB),
    pairedDifferences,
    representativeSeeds: [...new Set([...left.representativeSeeds, ...right.representativeSeeds])]
      .sort((a, b) => a - b)
      .slice(0, 8),
    errorCount: left.errorCount + right.errorCount,
  };
  const halfWidth =
    merged.completedPairs > 0
      ? wilsonHalfWidth(summarizeSimulationRate(merged.winsA, merged.completedPairs))
      : undefined;
  return accumulatorWithHash({
    ...merged,
    precision: simulationPrecisionStatus(merged.completedPairs, halfWidth),
    ...(halfWidth === undefined ? {} : { primaryMetricHalfWidth: halfWidth }),
  });
};

export const markSimulationStratifiedError = (
  accumulator: SimulationStratifiedAccumulator,
): SimulationStratifiedAccumulator =>
  accumulatorWithHash({ ...accumulator, errorCount: accumulator.errorCount + 1 });
