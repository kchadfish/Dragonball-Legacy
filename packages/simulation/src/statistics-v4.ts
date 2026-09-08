/* eslint-disable sonarjs/cognitive-complexity, complexity, sonarjs/no-nested-conditional, @typescript-eslint/no-unnecessary-condition, sonarjs/different-types-comparison -- The v4 contract deliberately centralizes versioned metric vocabulary and bounded merge rules. */
import { z } from "zod";

import type { FightState } from "@dragonball-resurgence/combat-engine";

import { canonicalHash, canonicalJson } from "./canonical.js";
import {
  addSimulationHistogramValue,
  addSimulationQuantileValue,
  createSimulationHistogram,
  createSimulationMeanVariance,
  createSimulationQuantileSketch,
  mergeSimulationHistograms,
  mergeSimulationQuantileSketches,
  seededBootstrapPairedDifference,
  summarizeSimulationRate,
  type SimulationHistogram,
  type SimulationMeanVariance,
  type SimulationQuantileSketch,
} from "./statistics.js";

export const SIMULATION_STATISTICS_ARTIFACT_VERSION = "simulation-statistics-artifact:v4" as const;
export const SIMULATION_FIGHT_STATISTICS_VERSION = "simulation-fight-statistics:v1" as const;
export const SIMULATION_FIGHT_STATISTICS_V2_VERSION = "simulation-fight-statistics:v2" as const;
export const SIMULATION_METRICS_VERSION = "simulation-metrics:v2" as const;
export const SIMULATION_STATISTICS_BUNDLE_VERSION = "simulation-statistics-bundle:v1" as const;

export const SIMULATION_V4_NOMINAL_TARGET_PAIRS = 100 as const;
export const SIMULATION_V4_PRODUCTION_TARGET_PAIRS = 250 as const;
export const SIMULATION_V4_CONTINUATION_CEILING = 400 as const;

export const SIMULATION_V4_TURN_HISTOGRAM_BOUNDARIES = Object.freeze([6, 11, 21, 41, 61, 101]);
export const SIMULATION_V4_RESOURCE_HISTOGRAM_BOUNDARIES = Object.freeze(
  Array.from({ length: 11 }, (_, index) => index / 10),
);

const nonNegativeInteger = z.number().int().nonnegative();
const finiteNumber = z.number().refine(Number.isFinite, "Number must be finite.");
const sideSchema = z.enum(["a", "b"]);
const evidenceRoleSchema = z.enum(["natural-balance", "controlled", "diagnostic"]);
const exposureSchema = z.enum(["natural", "isolation", "forced"]);

export type SimulationStatisticsSide = z.infer<typeof sideSchema>;
export type SimulationStatisticsExposure = z.infer<typeof exposureSchema>;
export type SimulationStatisticsEvidenceRole = z.infer<typeof evidenceRoleSchema>;

export interface SimulationStatisticsDimensions {
  readonly templateId: string;
  readonly buildId: string;
  readonly styleMatchup: string;
  readonly checkpointId: string;
  readonly level: string;
  readonly statAllocation: string;
  readonly hpDifferential: number;
  readonly powerDifferential: number;
  readonly dexterityDifferential: number;
  readonly aiProfile: string;
  readonly side: SimulationStatisticsSide;
  readonly initiativeWinner: SimulationStatisticsSide | "tie";
  readonly firstActor: SimulationStatisticsSide;
  readonly moveId?: string;
  readonly itemId?: string;
  readonly transformationId?: string;
  readonly evidenceRole: SimulationStatisticsEvidenceRole;
  readonly exposurePopulation: SimulationStatisticsExposure;
}

export const simulationStatisticsDimensionsSchema = z
  .object({
    templateId: z.string().min(1),
    buildId: z.string().min(1),
    styleMatchup: z.string().min(1),
    checkpointId: z.string().min(1),
    level: z.string().min(1),
    statAllocation: z.string().min(1),
    hpDifferential: finiteNumber,
    powerDifferential: finiteNumber,
    dexterityDifferential: finiteNumber,
    aiProfile: z.string().min(1),
    side: sideSchema,
    initiativeWinner: z.union([sideSchema, z.literal("tie")]),
    firstActor: sideSchema,
    moveId: z.string().min(1).optional(),
    itemId: z.string().min(1).optional(),
    transformationId: z.string().min(1).optional(),
    evidenceRole: evidenceRoleSchema,
    exposurePopulation: exposureSchema,
  })
  .strict();

export const simulationStatisticsDimensionKey = (
  dimensions: SimulationStatisticsDimensions,
): string => canonicalHash(dimensions);

const welfordSchema = z
  .object({ count: nonNegativeInteger, mean: finiteNumber, m2: finiteNumber })
  .strict();
const histogramSchema = z
  .object({
    boundaries: z.array(finiteNumber),
    counts: z.array(nonNegativeInteger),
    underflow: nonNegativeInteger,
    overflow: nonNegativeInteger,
  })
  .strict();
const quantileSchema = z
  .object({
    capacity: z.number().int().positive(),
    count: nonNegativeInteger,
    centroids: z.array(
      z.object({ value: finiteNumber, count: z.number().int().positive() }).strict(),
    ),
  })
  .strict();

export interface SimulationMetricDenominators {
  readonly attempted: number;
  readonly eligible: number;
  readonly completed: number;
  readonly incomplete: number;
  readonly forced: number;
  readonly errors: number;
}

const denominatorsSchema = z
  .object({
    attempted: nonNegativeInteger,
    eligible: nonNegativeInteger,
    completed: nonNegativeInteger,
    incomplete: nonNegativeInteger,
    forced: nonNegativeInteger,
    errors: nonNegativeInteger,
  })
  .strict();

export interface SimulationPairedMetricObservation {
  readonly pairId: string;
  readonly difference: number;
}

const pairedObservationSchema = z
  .object({ pairId: z.string().min(1), difference: finiteNumber })
  .strict();

export interface SimulationMetricAggregateV2 {
  readonly schemaVersion: typeof SIMULATION_METRICS_VERSION;
  readonly metricId: string;
  readonly unit: "count" | "proportion" | "turns" | "hit-points" | "ki" | "score";
  readonly dimensions: SimulationStatisticsDimensions;
  readonly denominators: SimulationMetricDenominators;
  /** Success mass; draw-aware paired rates may legitimately be fractional. */
  readonly successes: number;
  readonly values: SimulationMeanVariance;
  readonly histogram?: SimulationHistogram;
  readonly quantiles?: SimulationQuantileSketch;
  readonly pairedObservations: readonly SimulationPairedMetricObservation[];
  readonly intervalMethod: "none" | "wilson-95" | "paired-bootstrap-95";
  readonly evidenceLabel: "insufficient" | "observed" | "forced" | "error";
  readonly evidence: Readonly<{
    readonly state:
      | "observed"
      | "insufficient"
      | "not-applicable"
      | "never-eligible"
      | "eligible-never-selected"
      | "error";
    readonly reason: string;
  }>;
  readonly representativeReplaySeeds: readonly number[];
  readonly metricHash: string;
}

export interface SimulationMetricDefinitionV2 {
  readonly metricId: string;
  readonly family:
    | "core"
    | "moves"
    | "styles-builds"
    | "stat-allocation"
    | "dexterity"
    | "ki-economy"
    | "defense"
    | "items"
    | "transformations"
    | "ai"
    | "utility"
    | "sequences";
  readonly numerator: string;
  readonly denominator: string;
  readonly intervalMethod: SimulationMetricAggregateV2["intervalMethod"];
  readonly population: "natural-balance" | "controlled" | "diagnostic";
}

/** The staff-facing metric vocabulary is explicit and contains no composite utility score. */
export const SIMULATION_V4_METRIC_DEFINITIONS: readonly SimulationMetricDefinitionV2[] =
  Object.freeze(
    [
      ["raw-win-rate", "wins", "completed fights", "wilson-95", "natural-balance"],
      [
        "mirrored-adjusted-win-rate",
        "win score",
        "completed mirrored pairs",
        "wilson-95",
        "natural-balance",
      ],
      ["mean-turns", "turn total", "completed fights", "none", "natural-balance"],
      ["median-turns", "ordered turns", "completed fights", "none", "natural-balance"],
      ["turn-length-distribution", "fight turns", "completed fights", "none", "natural-balance"],
      ["winner-remaining-hp", "winner HP", "completed wins", "none", "natural-balance"],
      ["winner-remaining-ki", "winner Ki", "completed wins", "none", "natural-balance"],
      ["damage-dealt", "attributed damage", "completed fights", "none", "natural-balance"],
      [
        "damage-received",
        "attributed damage received",
        "completed fights",
        "none",
        "natural-balance",
      ],
      ["comeback-rate", "comeback wins", "completed wins", "wilson-95", "natural-balance"],
      ["side-bias", "side wins", "completed fights", "wilson-95", "natural-balance"],
      [
        "initiative-advantage",
        "initiative-wins",
        "initiative-eligible fights",
        "wilson-95",
        "natural-balance",
      ],
      [
        "win-probability-by-stat-differential",
        "wins",
        "completed fights in differential bin",
        "wilson-95",
        "controlled",
      ],
      ["move-opportunity-funnel", "stage count", "eligible states", "none", "natural-balance"],
      [
        "move-selection-rate",
        "selected actions",
        "legal opportunities",
        "wilson-95",
        "natural-balance",
      ],
      [
        "move-execution-rate",
        "resolved actions",
        "legal opportunities",
        "wilson-95",
        "natural-balance",
      ],
      [
        "move-equipped-win-rate",
        "equipped wins",
        "equipped fights",
        "wilson-95",
        "natural-balance",
      ],
      ["move-used-win-rate", "used wins", "used fights", "wilson-95", "natural-balance"],
      [
        "move-paired-marginal-win-effect",
        "paired win-score difference",
        "matched pairs",
        "paired-bootstrap-95",
        "controlled",
      ],
      [
        "source-attributed-damage-efficiency",
        "damage",
        "actual Ki spent",
        "none",
        "natural-balance",
      ],
      [
        "source-attributed-ki-efficiency",
        "Ki gained",
        "actual Ki spent",
        "none",
        "natural-balance",
      ],
      ["hit-rate", "hits", "attack attempts", "wilson-95", "natural-balance"],
      ["critical-rate", "critical attacks", "attack attempts", "wilson-95", "natural-balance"],
      ["block-rate", "successful blocks", "block declarations", "wilson-95", "natural-balance"],
      ["counter-rate", "counters", "counter opportunities", "wilson-95", "natural-balance"],
      ["finisher-rate", "finishing uses", "move uses", "wilson-95", "natural-balance"],
      ["overkill", "overkill HP", "finishing attacks", "none", "natural-balance"],
      ["move-damage-per-use", "attributed damage", "resolved move uses", "none", "natural-balance"],
      ["move-average-ki-cost", "actual Ki spent", "resolved move uses", "none", "natural-balance"],
      ["move-uses-per-fight", "move uses", "equipped fights", "none", "natural-balance"],
      ["move-first-use-turn", "first-use turn", "fights using move", "none", "natural-balance"],
      ["move-countered-rate", "countered uses", "attack uses", "wilson-95", "natural-balance"],
      ["move-blocked-rate", "blocked uses", "attack uses", "wilson-95", "natural-balance"],
      [
        "status-rate",
        "status applications",
        "status opportunities",
        "wilson-95",
        "natural-balance",
      ],
      [
        "setup-conversion",
        "converted setups",
        "setup opportunities",
        "wilson-95",
        "natural-balance",
      ],
      ["follow-up-rate", "follow-ups", "follow-up opportunities", "wilson-95", "natural-balance"],
      [
        "repeated-sequence-count",
        "exact adjacent sequences",
        "completed actions",
        "none",
        "natural-balance",
      ],
      ["style-matchup-win-rate", "wins", "completed fights", "wilson-95", "natural-balance"],
      ["style-fight-duration", "fight turns", "completed fights", "none", "natural-balance"],
      ["style-damage", "damage dealt", "completed fights", "none", "natural-balance"],
      ["style-ki-efficiency", "damage", "Ki spent", "none", "natural-balance"],
      ["style-winning-move-rate", "winning move uses", "winning fights", "none", "natural-balance"],
      [
        "style-eligible-nonuse",
        "unused eligible moves",
        "legal opportunities",
        "none",
        "natural-balance",
      ],
      ["action-mix", "action count", "completed actions", "none", "natural-balance"],
      [
        "fixed-total-sp-effect",
        "paired win-score difference",
        "matched pairs",
        "paired-bootstrap-95",
        "controlled",
      ],
      [
        "dexterity-initiative-rate",
        "initiative wins",
        "initiative contests",
        "wilson-95",
        "controlled",
      ],
      [
        "dexterity-attack-success",
        "successful attacks",
        "attack attempts",
        "wilson-95",
        "controlled",
      ],
      [
        "dexterity-defense-success",
        "successful defenses",
        "defense attempts",
        "wilson-95",
        "controlled",
      ],
      [
        "dexterity-prevented-damage",
        "prevented damage",
        "defense opportunities",
        "none",
        "controlled",
      ],
      ["dexterity-added-damage", "added damage", "attack opportunities", "none", "controlled"],
      ["dexterity-counter-rate", "counters", "counter opportunities", "wilson-95", "controlled"],
      ["dexterity-critical-rate", "critical attacks", "attack attempts", "wilson-95", "controlled"],
      [
        "dexterity-indirect-actions",
        "initiative actions gained",
        "completed fights",
        "none",
        "controlled",
      ],
      ["ki-starting", "starting Ki", "fighters", "none", "natural-balance"],
      ["ki-gained", "gained Ki", "fighters", "none", "natural-balance"],
      ["ki-spent", "spent Ki", "fighters", "none", "natural-balance"],
      ["ki-cap-waste", "wasted Ki gain", "gain opportunities", "none", "natural-balance"],
      ["ki-ending", "ending Ki", "fighters", "none", "natural-balance"],
      ["ki-power-up-turns", "Power Up actions", "completed fights", "none", "natural-balance"],
      ["ki-per-damage", "Ki spent", "damage dealt", "none", "natural-balance"],
      ["ki-high-cost-use", "high-cost uses", "resolved actions", "none", "natural-balance"],
      ["ki-low-cost-use", "low-cost uses", "resolved actions", "none", "natural-balance"],
      [
        "ki-starvation-rate",
        "starved decisions",
        "eligible decisions",
        "wilson-95",
        "natural-balance",
      ],
      [
        "desired-action-denial",
        "denied desired actions",
        "declared target-move contexts",
        "wilson-95",
        "controlled",
      ],
      [
        "block-prevention-efficiency",
        "prevented damage",
        "block declarations",
        "none",
        "natural-balance",
      ],
      [
        "defense-success-rate",
        "successful defenses",
        "defense attempts",
        "wilson-95",
        "natural-balance",
      ],
      [
        "block-declaration-rate",
        "block declarations",
        "block opportunities",
        "wilson-95",
        "natural-balance",
      ],
      ["block-ki-efficiency", "Ki spent", "prevented damage", "none", "natural-balance"],
      ["counter-damage", "counter damage", "counter attacks", "none", "natural-balance"],
      [
        "counter-chain-frequency",
        "counter chains",
        "attack sequences",
        "wilson-95",
        "natural-balance",
      ],
      [
        "stopped-with-block-rate",
        "attacks stopped with blocks",
        "stopped attacks",
        "wilson-95",
        "natural-balance",
      ],
      [
        "stopped-without-block-rate",
        "attacks stopped without blocks",
        "stopped attacks",
        "wilson-95",
        "natural-balance",
      ],
      [
        "multi-die-partial-mitigation",
        "partially mitigated attacks",
        "multi-die attacks",
        "wilson-95",
        "natural-balance",
      ],
      ["wasted-block-rate", "wasted blocks", "block declarations", "wilson-95", "natural-balance"],
      [
        "item-equip-effect",
        "paired win-score difference",
        "matched pairs",
        "paired-bootstrap-95",
        "controlled",
      ],
      [
        "item-attributed-value",
        "effective HP/value",
        "item activations",
        "none",
        "natural-balance",
      ],
      ["item-equip-rate", "equipped fights", "eligible loadouts", "wilson-95", "natural-balance"],
      ["item-usage-rate", "item uses", "equipped fights", "wilson-95", "natural-balance"],
      [
        "item-equipped-win-rate",
        "equipped wins",
        "equipped fights",
        "wilson-95",
        "natural-balance",
      ],
      [
        "item-trigger-rate",
        "item triggers",
        "trigger opportunities",
        "wilson-95",
        "natural-balance",
      ],
      ["item-damage", "attributed damage", "item activations", "none", "natural-balance"],
      ["item-prevention", "prevented damage", "item activations", "none", "natural-balance"],
      ["item-ki", "attributed Ki", "item activations", "none", "natural-balance"],
      ["item-healing", "attributed healing", "item activations", "none", "natural-balance"],
      [
        "item-effective-hp",
        "healing plus prevention",
        "item activations",
        "none",
        "natural-balance",
      ],
      [
        "item-value-per-zenni",
        "attributed component value",
        "positive canonical price",
        "none",
        "natural-balance",
      ],
      [
        "transformation-activation-rate",
        "activations",
        "activation-eligible states",
        "wilson-95",
        "natural-balance",
      ],
      [
        "transformation-swing",
        "paired win-score difference",
        "matched branch pairs",
        "paired-bootstrap-95",
        "controlled",
      ],
      [
        "transformation-activation-turn",
        "activation turn",
        "activations",
        "none",
        "natural-balance",
      ],
      [
        "transformation-win-after-activation",
        "wins",
        "activated fights",
        "wilson-95",
        "natural-balance",
      ],
      [
        "transformation-available-unused-win-rate",
        "wins",
        "available unused fights",
        "wilson-95",
        "natural-balance",
      ],
      [
        "transformation-activation-hp",
        "HP at activation",
        "activations",
        "none",
        "natural-balance",
      ],
      [
        "transformation-activation-ki",
        "Ki at activation",
        "activations",
        "none",
        "natural-balance",
      ],
      ["transformation-damage", "attributed damage", "activations", "none", "natural-balance"],
      [
        "transformation-effective-hp",
        "healing plus prevention",
        "activations",
        "none",
        "natural-balance",
      ],
      [
        "transformation-post-duration",
        "turns after activation",
        "activated fights",
        "none",
        "natural-balance",
      ],
      [
        "transformation-matchup-win-rate",
        "wins",
        "completed transformation matchups",
        "wilson-95",
        "natural-balance",
      ],
      [
        "transformation-base-delta",
        "paired win-score difference",
        "matched pairs",
        "paired-bootstrap-95",
        "controlled",
      ],
      ["ai-action-distribution", "selected actions", "decision points", "none", "diagnostic"],
      ["ai-legal-action-count", "legal candidates", "decision points", "none", "diagnostic"],
      ["ai-selected-rank", "selected rank", "evaluated decisions", "none", "diagnostic"],
      ["ai-score-gap", "score gap", "evaluated decisions", "none", "diagnostic"],
      [
        "ai-missed-lethal",
        "missed lethals",
        "full-candidate decision points",
        "wilson-95",
        "diagnostic",
      ],
      ["ai-pass-rate", "Pass selections", "decision points", "wilson-95", "diagnostic"],
      ["ai-power-up-rate", "Power Up selections", "decision points", "wilson-95", "diagnostic"],
      ["ai-item-usage-rate", "item selections", "decision points", "wilson-95", "diagnostic"],
      [
        "ai-transformation-usage-rate",
        "transformation selections",
        "decision points",
        "wilson-95",
        "diagnostic",
      ],
      ["ai-block-usage-rate", "block selections", "block opportunities", "wilson-95", "diagnostic"],
      ["ai-resource-waste", "discarded resource", "decision points", "none", "diagnostic"],
      [
        "ai-repeated-action-rate",
        "repeated selections",
        "decision points after first",
        "wilson-95",
        "diagnostic",
      ],
      ["utility-damage", "damage utility", "damage opportunities", "none", "natural-balance"],
      [
        "utility-prevention",
        "prevention utility",
        "prevention opportunities",
        "none",
        "natural-balance",
      ],
      ["utility-resource", "resource utility", "resource opportunities", "none", "natural-balance"],
      [
        "utility-status-control",
        "status/control utility",
        "status/control opportunities",
        "none",
        "natural-balance",
      ],
      [
        "utility-action-economy",
        "action-economy utility",
        "action-economy opportunities",
        "none",
        "natural-balance",
      ],
    ].map(([metricId, numerator, denominator, intervalMethod, population]) => ({
      metricId: `simulation:${metricId}`,
      family: metricId.startsWith("style")
        ? "styles-builds"
        : metricId === "fixed-total-sp-effect" ||
            metricId === "win-probability-by-stat-differential"
          ? "stat-allocation"
          : metricId.startsWith("dexterity")
            ? "dexterity"
            : metricId.startsWith("ki-")
              ? "ki-economy"
              : metricId.startsWith("block-") ||
                  metricId.startsWith("defense-") ||
                  metricId.startsWith("counter-chain") ||
                  metricId.startsWith("counter-damage") ||
                  metricId.startsWith("stopped-") ||
                  metricId.startsWith("multi-die-") ||
                  metricId.startsWith("wasted-block")
                ? "defense"
                : metricId.startsWith("item-")
                  ? "items"
                  : metricId.startsWith("transformation")
                    ? "transformations"
                    : metricId.startsWith("ai-")
                      ? "ai"
                      : metricId.startsWith("utility-")
                        ? "utility"
                        : metricId.endsWith("sequence-count") || metricId === "follow-up-rate"
                          ? "sequences"
                          : metricId.startsWith("move-") ||
                              metricId === "hit-rate" ||
                              metricId === "critical-rate" ||
                              metricId === "counter-rate" ||
                              metricId === "finisher-rate" ||
                              metricId === "overkill" ||
                              metricId === "status-rate" ||
                              metricId === "setup-conversion"
                            ? "moves"
                            : "core",
      numerator,
      denominator,
      intervalMethod,
      population,
    })) as SimulationMetricDefinitionV2[],
  );

export const simulationMetricAggregateV2Schema = z
  .object({
    schemaVersion: z.literal(SIMULATION_METRICS_VERSION),
    metricId: z.string().min(1),
    unit: z.enum(["count", "proportion", "turns", "hit-points", "ki", "score"]),
    dimensions: simulationStatisticsDimensionsSchema,
    denominators: denominatorsSchema,
    successes: finiteNumber.nonnegative(),
    values: welfordSchema,
    histogram: histogramSchema.optional(),
    quantiles: quantileSchema.optional(),
    pairedObservations: z.array(pairedObservationSchema).max(SIMULATION_V4_CONTINUATION_CEILING),
    intervalMethod: z.enum(["none", "wilson-95", "paired-bootstrap-95"]),
    evidenceLabel: z.enum(["insufficient", "observed", "forced", "error"]),
    evidence: z
      .object({
        state: z.enum([
          "observed",
          "insufficient",
          "not-applicable",
          "never-eligible",
          "eligible-never-selected",
          "error",
        ]),
        reason: z.string().min(1),
      })
      .strict(),
    representativeReplaySeeds: z.array(z.number().int().nonnegative().max(4_294_967_295)).max(8),
    metricHash: z.string().min(1),
  })
  .strict();

const emptyDenominators = (): SimulationMetricDenominators => ({
  attempted: 0,
  eligible: 0,
  completed: 0,
  incomplete: 0,
  forced: 0,
  errors: 0,
});

const stableNumber = (value: number): number => Number(value.toFixed(12));

const addWelford = (aggregate: SimulationMeanVariance, value: number): SimulationMeanVariance => {
  const count = aggregate.count + 1;
  const delta = value - aggregate.mean;
  const mean = stableNumber(aggregate.mean + delta / count);
  return {
    count,
    mean,
    m2: stableNumber(aggregate.m2 + delta * (value - mean)),
  };
};

const meanVarianceFromQuantiles = (
  quantiles: SimulationQuantileSketch,
): SimulationMeanVariance | undefined => {
  if (quantiles.count > quantiles.capacity) return undefined;
  let aggregate = createSimulationMeanVariance();
  for (const centroid of [...quantiles.centroids].sort((a, b) => a.value - b.value))
    for (let index = 0; index < centroid.count; index++)
      aggregate = addWelford(aggregate, centroid.value);
  return aggregate;
};

const boundedPairs = (
  left: readonly SimulationPairedMetricObservation[],
  right: readonly SimulationPairedMetricObservation[],
): readonly SimulationPairedMetricObservation[] => {
  const byId = new Map<string, SimulationPairedMetricObservation>();
  for (const observation of [...left, ...right]) {
    const prior = byId.get(observation.pairId);
    if (prior !== undefined && prior.difference !== observation.difference)
      throw new RangeError(`Conflicting paired observation: ${observation.pairId}.`);
    byId.set(observation.pairId, observation);
  }
  return [...byId.values()]
    .sort((a, b) => a.pairId.localeCompare(b.pairId))
    .slice(0, SIMULATION_V4_CONTINUATION_CEILING);
};

const metricWithoutHash = (
  metricId: string,
  dimensions: SimulationStatisticsDimensions,
  unit: SimulationMetricAggregateV2["unit"],
  intervalMethod: SimulationMetricAggregateV2["intervalMethod"],
): Omit<SimulationMetricAggregateV2, "metricHash"> => ({
  schemaVersion: SIMULATION_METRICS_VERSION,
  metricId,
  unit,
  dimensions,
  denominators: emptyDenominators(),
  successes: 0,
  values: createSimulationMeanVariance(),
  pairedObservations: [],
  intervalMethod,
  evidenceLabel: "insufficient",
  evidence: {
    state: "insufficient",
    reason: "No eligible or completed observations were retained.",
  },
  representativeReplaySeeds: [],
});

const withMetricHash = (
  metric: Omit<SimulationMetricAggregateV2, "metricHash">,
): SimulationMetricAggregateV2 => {
  const withoutHash = { ...metric } as Record<string, unknown>;
  delete withoutHash.metricHash;
  return {
    ...withoutHash,
    metricHash: canonicalHash(withoutHash),
  } as SimulationMetricAggregateV2;
};

export const createSimulationMetricAggregateV2 = (input: {
  readonly metricId: string;
  readonly dimensions: SimulationStatisticsDimensions;
  readonly unit: SimulationMetricAggregateV2["unit"];
  readonly intervalMethod?: SimulationMetricAggregateV2["intervalMethod"];
}): SimulationMetricAggregateV2 =>
  withMetricHash({
    ...metricWithoutHash(
      input.metricId,
      input.dimensions,
      input.unit,
      input.intervalMethod ?? "none",
    ),
    histogram: createSimulationHistogram(
      input.unit === "turns"
        ? SIMULATION_V4_TURN_HISTOGRAM_BOUNDARIES
        : input.unit === "proportion"
          ? SIMULATION_V4_RESOURCE_HISTOGRAM_BOUNDARIES
          : [],
    ),
    quantiles: createSimulationQuantileSketch(),
  });

export const addSimulationMetricObservationV2 = (
  metric: SimulationMetricAggregateV2,
  input: {
    readonly value?: number;
    readonly success?: boolean;
    /** Fractional success mass for draw-aware and mirror-adjusted rates. */
    readonly successWeight?: number;
    readonly eligible?: boolean;
    readonly completed?: boolean;
    readonly incomplete?: boolean;
    readonly forced?: boolean;
    readonly error?: boolean;
    readonly pairId?: string;
    readonly pairedDifference?: number;
    readonly replaySeed?: number;
  },
): SimulationMetricAggregateV2 => {
  if (
    input.successWeight !== undefined &&
    (!Number.isFinite(input.successWeight) || input.successWeight < 0 || input.successWeight > 1)
  )
    throw new RangeError("Metric successWeight must be between zero and one.");
  const denominators = {
    ...metric.denominators,
    attempted: metric.denominators.attempted + 1,
    eligible: metric.denominators.eligible + (input.eligible === true ? 1 : 0),
    completed: metric.denominators.completed + (input.completed === true ? 1 : 0),
    incomplete: metric.denominators.incomplete + (input.incomplete === true ? 1 : 0),
    forced: metric.denominators.forced + (input.forced === true ? 1 : 0),
    errors: metric.denominators.errors + (input.error === true ? 1 : 0),
  };
  const values = input.value === undefined ? metric.values : addWelford(metric.values, input.value);
  const histogram =
    input.value === undefined || metric.histogram === undefined
      ? metric.histogram
      : addSimulationHistogramValue(metric.histogram, input.value);
  const quantiles =
    input.value === undefined || metric.quantiles === undefined
      ? metric.quantiles
      : addSimulationQuantileValue(metric.quantiles, input.value);
  const pairedObservations =
    input.pairId === undefined || input.pairedDifference === undefined
      ? metric.pairedObservations
      : boundedPairs(metric.pairedObservations, [
          { pairId: input.pairId, difference: input.pairedDifference },
        ]);
  const evidenceLabel =
    input.error === true
      ? "error"
      : input.forced === true
        ? "forced"
        : denominators.completed === 0
          ? "insufficient"
          : "observed";
  const evidence =
    input.error === true
      ? { state: "error" as const, reason: "At least one runner error was observed." }
      : input.forced === true
        ? { state: "observed" as const, reason: "Observed through a forced diagnostic exposure." }
        : denominators.eligible > 0 || denominators.completed > 0
          ? {
              state: "observed" as const,
              reason: "At least one eligible or completed observation was folded.",
            }
          : metric.evidence;
  return withMetricHash({
    ...metric,
    denominators,
    successes: metric.successes + (input.successWeight ?? (input.success === true ? 1 : 0)),
    values: meanVarianceFromQuantiles(quantiles ?? createSimulationQuantileSketch()) ?? values,
    ...(histogram === undefined ? {} : { histogram }),
    ...(quantiles === undefined ? {} : { quantiles }),
    pairedObservations,
    evidenceLabel,
    evidence,
    representativeReplaySeeds:
      input.replaySeed === undefined
        ? metric.representativeReplaySeeds
        : [...new Set([...metric.representativeReplaySeeds, input.replaySeed])]
            .sort((a, b) => a - b)
            .slice(0, 8),
  });
};

export const setSimulationMetricEvidenceV2 = (
  metric: SimulationMetricAggregateV2,
  state: SimulationMetricAggregateV2["evidence"]["state"],
  reason: string,
): SimulationMetricAggregateV2 =>
  withMetricHash({
    ...metric,
    evidenceLabel:
      state === "error"
        ? "error"
        : state === "observed"
          ? metric.evidenceLabel === "forced"
            ? "forced"
            : "observed"
          : metric.evidenceLabel,
    evidence: { state, reason },
  });

const mergeWelford = (
  left: SimulationMeanVariance,
  right: SimulationMeanVariance,
): SimulationMeanVariance => {
  if (left.count === 0) return right;
  if (right.count === 0) return left;
  const count = left.count + right.count;
  const delta = right.mean - left.mean;
  const mean = stableNumber(left.mean + (delta * right.count) / count);
  const m2 = stableNumber(left.m2 + right.m2 + (delta * delta * left.count * right.count) / count);
  return { count, mean, m2 };
};

export const mergeSimulationMetricAggregatesV2 = (
  left: SimulationMetricAggregateV2,
  right: SimulationMetricAggregateV2,
): SimulationMetricAggregateV2 => {
  if (
    left.metricId !== right.metricId ||
    simulationStatisticsDimensionKey(left.dimensions) !==
      simulationStatisticsDimensionKey(right.dimensions)
  )
    throw new RangeError("Metric aggregates must have matching metric and dimension identities.");
  const histogram =
    left.histogram === undefined
      ? right.histogram
      : right.histogram === undefined
        ? left.histogram
        : mergeSimulationHistograms(left.histogram, right.histogram);
  const quantiles =
    left.quantiles === undefined
      ? right.quantiles
      : right.quantiles === undefined
        ? left.quantiles
        : mergeSimulationQuantileSketches(left.quantiles, right.quantiles);
  const merged = {
    ...left,
    denominators: Object.fromEntries(
      Object.keys(left.denominators).map((key) => [
        key,
        left.denominators[key as keyof SimulationMetricDenominators] +
          right.denominators[key as keyof SimulationMetricDenominators],
      ]),
    ) as unknown as SimulationMetricDenominators,
    successes: left.successes + right.successes,
    values:
      meanVarianceFromQuantiles(quantiles ?? createSimulationQuantileSketch()) ??
      mergeWelford(left.values, right.values),
    pairedObservations: boundedPairs(left.pairedObservations, right.pairedObservations),
    representativeReplaySeeds: [
      ...new Set([...left.representativeReplaySeeds, ...right.representativeReplaySeeds]),
    ]
      .sort((a, b) => a - b)
      .slice(0, 8),
    evidenceLabel:
      left.evidenceLabel === "error" || right.evidenceLabel === "error"
        ? "error"
        : left.evidenceLabel === "forced" || right.evidenceLabel === "forced"
          ? "forced"
          : mergedDenominatorCompleted(left, right) === 0
            ? "insufficient"
            : "observed",
    evidence:
      left.evidence.state === "error" || right.evidence.state === "error"
        ? { state: "error" as const, reason: "At least one merged aggregate contains an error." }
        : left.evidence.state === "observed" || right.evidence.state === "observed"
          ? { state: "observed" as const, reason: "Merged aggregate contains observed evidence." }
          : left.evidence.state === right.evidence.state &&
              (left.evidence.state === "not-applicable" ||
                left.evidence.state === "never-eligible" ||
                left.evidence.state === "eligible-never-selected")
            ? { state: left.evidence.state, reason: left.evidence.reason }
            : {
                state: "insufficient" as const,
                reason: "No eligible or completed observations were retained.",
              },
    ...(histogram === undefined ? {} : { histogram }),
    ...(quantiles === undefined ? {} : { quantiles }),
  } satisfies Omit<SimulationMetricAggregateV2, "metricHash"> & { metricHash?: string };
  const withoutHash = Object.fromEntries(
    Object.entries(merged).filter(([key]) => key !== "metricHash"),
  ) as unknown as Omit<SimulationMetricAggregateV2, "metricHash">;
  return withMetricHash(withoutHash);
};

const mergedDenominatorCompleted = (
  left: SimulationMetricAggregateV2,
  right: SimulationMetricAggregateV2,
): number => left.denominators.completed + right.denominators.completed;

export type SimulationFightStatisticsV1 = {
  readonly schemaVersion: typeof SIMULATION_FIGHT_STATISTICS_VERSION;
  readonly pairId: string;
  readonly orientation: "original" | "mirrored";
  readonly fighterAId: string;
  readonly fighterBId: string;
  readonly winner: "a" | "b" | "draw";
  readonly completed: boolean;
  readonly terminationReason: string;
  readonly turns: number;
  readonly winnerRemainingHp?: number;
  readonly winnerRemainingKi?: number;
  readonly damageDealt: Readonly<{ readonly a: number; readonly b: number }>;
  readonly damageReceived: Readonly<{ readonly a: number; readonly b: number }>;
  readonly startingHp: Readonly<{ readonly a: number; readonly b: number }>;
  readonly remainingHp: Readonly<{ readonly a: number; readonly b: number }>;
  readonly remainingKi: Readonly<{ readonly a: number; readonly b: number }>;
  readonly comeback: boolean;
  readonly initiativeWinner: SimulationStatisticsSide | "tie";
  readonly firstActor: SimulationStatisticsSide;
  readonly representativeReplaySeed?: number;
};

export const simulationFightStatisticsV1Schema = z
  .object({
    schemaVersion: z.literal(SIMULATION_FIGHT_STATISTICS_VERSION),
    pairId: z.string().min(1),
    orientation: z.enum(["original", "mirrored"]),
    fighterAId: z.string().min(1),
    fighterBId: z.string().min(1),
    winner: z.enum(["a", "b", "draw"]),
    completed: z.boolean(),
    terminationReason: z.string().min(1),
    turns: nonNegativeInteger,
    winnerRemainingHp: finiteNumber.optional(),
    winnerRemainingKi: finiteNumber.optional(),
    damageDealt: z.object({ a: finiteNumber, b: finiteNumber }).strict(),
    damageReceived: z.object({ a: finiteNumber, b: finiteNumber }).strict(),
    startingHp: z.object({ a: finiteNumber, b: finiteNumber }).strict(),
    remainingHp: z.object({ a: finiteNumber, b: finiteNumber }).strict(),
    remainingKi: z.object({ a: finiteNumber, b: finiteNumber }).strict(),
    comeback: z.boolean(),
    initiativeWinner: z.union([sideSchema, z.literal("tie")]),
    firstActor: sideSchema,
    representativeReplaySeed: z.number().int().nonnegative().max(4_294_967_295).optional(),
  })
  .strict();

export interface SimulationFightStatisticsV2 {
  readonly schemaVersion: typeof SIMULATION_FIGHT_STATISTICS_V2_VERSION;
  readonly pairId: string;
  readonly orientation: "original" | "mirrored";
  readonly fighterAId: string;
  readonly fighterBId: string;
  readonly completed: boolean;
  readonly terminationReason: string;
  readonly winner: "a" | "b" | "draw";
  readonly metrics: Readonly<Record<string, SimulationMetricAggregateV2>>;
  readonly stateHash: string;
  readonly eventHash: string;
  readonly decisionHash: string;
  readonly statisticsHash: string;
}

export const simulationFightStatisticsV2Schema = z
  .object({
    schemaVersion: z.literal(SIMULATION_FIGHT_STATISTICS_V2_VERSION),
    pairId: z.string().min(1),
    orientation: z.enum(["original", "mirrored"]),
    fighterAId: z.string().min(1),
    fighterBId: z.string().min(1),
    completed: z.boolean(),
    terminationReason: z.string().min(1),
    winner: z.enum(["a", "b", "draw"]),
    metrics: z.record(z.string().min(1), simulationMetricAggregateV2Schema),
    stateHash: z.string().min(1),
    eventHash: z.string().min(1),
    decisionHash: z.string().min(1),
    statisticsHash: z.string().min(1),
  })
  .strict();

export const createSimulationFightStatisticsV2 = (
  input: Omit<SimulationFightStatisticsV2, "schemaVersion" | "statisticsHash">,
): SimulationFightStatisticsV2 => {
  const value = {
    schemaVersion: SIMULATION_FIGHT_STATISTICS_V2_VERSION,
    ...input,
  };
  return simulationFightStatisticsV2Schema.parse({
    ...value,
    statisticsHash: canonicalHash(value),
  });
};

export const readSimulationFightStatisticsV2 = (input: unknown): SimulationFightStatisticsV2 => {
  const value = simulationFightStatisticsV2Schema.parse(input);
  const withoutHash = { ...value } as Record<string, unknown>;
  delete withoutHash.statisticsHash;
  if (value.statisticsHash !== canonicalHash(withoutHash))
    throw new RangeError("Simulation fight statistics hash mismatch.");
  return value;
};

export interface SimulationStatisticsArtifactV4 {
  readonly schemaVersion: typeof SIMULATION_STATISTICS_ARTIFACT_VERSION;
  readonly generatedFrom: Readonly<{
    readonly catalogId: string;
    readonly mechanicsIdentity: string;
    readonly rootSeed: number;
    readonly targetPairs: number;
    readonly maximumPairs: typeof SIMULATION_V4_CONTINUATION_CEILING;
    readonly evidenceRole: SimulationStatisticsEvidenceRole;
    readonly exposurePopulation: SimulationStatisticsExposure;
    readonly evidenceLevel: "confirmation" | "production-candidate";
    readonly sourceLimitations: readonly string[];
  }>;
  readonly metrics: Readonly<Record<string, SimulationMetricAggregateV2>>;
  readonly incompleteFights: number;
  readonly errorFights: number;
  readonly forcedExposureFights: number;
  readonly representativeReplaySeeds: readonly number[];
  readonly artifactHash: string;
}

const artifactGeneratedFromSchema = z
  .object({
    catalogId: z.string().min(1),
    mechanicsIdentity: z.string().min(1),
    rootSeed: z.number().int().nonnegative().max(4_294_967_295),
    targetPairs: z.number().int().positive().max(SIMULATION_V4_CONTINUATION_CEILING),
    maximumPairs: z.literal(SIMULATION_V4_CONTINUATION_CEILING),
    evidenceRole: evidenceRoleSchema,
    exposurePopulation: exposureSchema,
    evidenceLevel: z.enum(["confirmation", "production-candidate"]),
    sourceLimitations: z.array(z.string().min(1)),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.targetPairs > value.maximumPairs)
      context.addIssue({
        code: "custom",
        path: ["targetPairs"],
        message: "Target exceeds v4 ceiling.",
      });
  });

export const simulationStatisticsArtifactV4Schema = z
  .object({
    schemaVersion: z.literal(SIMULATION_STATISTICS_ARTIFACT_VERSION),
    generatedFrom: artifactGeneratedFromSchema,
    metrics: z.record(z.string().min(1), simulationMetricAggregateV2Schema),
    incompleteFights: nonNegativeInteger,
    errorFights: nonNegativeInteger,
    forcedExposureFights: nonNegativeInteger,
    representativeReplaySeeds: z.array(z.number().int().nonnegative().max(4_294_967_295)).max(8),
    artifactHash: z.string().min(1),
  })
  .strict();

const evidenceLevelFor = (
  targetPairs: number,
): SimulationStatisticsArtifactV4["generatedFrom"]["evidenceLevel"] =>
  targetPairs >= SIMULATION_V4_PRODUCTION_TARGET_PAIRS ? "production-candidate" : "confirmation";

export const createSimulationStatisticsArtifactV4 = (input: {
  readonly catalogId: string;
  readonly mechanicsIdentity: string;
  readonly rootSeed: number;
  readonly targetPairs: number;
  readonly evidenceRole?: SimulationStatisticsEvidenceRole;
  readonly exposurePopulation?: SimulationStatisticsExposure;
  readonly sourceLimitations?: readonly string[];
  readonly metrics?: Readonly<Record<string, SimulationMetricAggregateV2>>;
  readonly incompleteFights?: number;
  readonly errorFights?: number;
  readonly forcedExposureFights?: number;
  readonly representativeReplaySeeds?: readonly number[];
}): SimulationStatisticsArtifactV4 => {
  if (input.targetPairs < 1 || input.targetPairs > SIMULATION_V4_CONTINUATION_CEILING)
    throw new RangeError(
      `v4 target pairs must be between 1 and ${SIMULATION_V4_CONTINUATION_CEILING}.`,
    );
  const generatedFrom = {
    catalogId: input.catalogId,
    mechanicsIdentity: input.mechanicsIdentity,
    rootSeed: input.rootSeed,
    targetPairs: input.targetPairs,
    maximumPairs: SIMULATION_V4_CONTINUATION_CEILING,
    evidenceRole: input.evidenceRole ?? "natural-balance",
    exposurePopulation: input.exposurePopulation ?? "natural",
    evidenceLevel: evidenceLevelFor(input.targetPairs),
    sourceLimitations: [...(input.sourceLimitations ?? [])].sort((a, b) => a.localeCompare(b)),
  } as const;
  const metrics = Object.fromEntries(
    Object.entries(input.metrics ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  );
  const withoutHash = {
    schemaVersion: SIMULATION_STATISTICS_ARTIFACT_VERSION,
    generatedFrom,
    metrics,
    incompleteFights: input.incompleteFights ?? 0,
    errorFights: input.errorFights ?? 0,
    forcedExposureFights: input.forcedExposureFights ?? 0,
    representativeReplaySeeds: [...new Set(input.representativeReplaySeeds ?? [])]
      .sort((a, b) => a - b)
      .slice(0, 8),
  };
  return simulationStatisticsArtifactV4Schema.parse({
    ...withoutHash,
    artifactHash: canonicalHash(withoutHash),
  });
};

export const readSimulationStatisticsArtifactV4 = (
  value: unknown,
): SimulationStatisticsArtifactV4 => {
  const artifact = simulationStatisticsArtifactV4Schema.parse(value);
  const artifactWithoutHash = { ...artifact } as Record<string, unknown>;
  delete artifactWithoutHash.artifactHash;
  if (artifact.artifactHash !== canonicalHash(artifactWithoutHash))
    throw new RangeError("Simulation statistics artifact hash mismatch.");
  for (const metric of Object.values(artifact.metrics)) {
    const metricWithoutHash = { ...metric } as Record<string, unknown>;
    delete metricWithoutHash.metricHash;
    if (metric.metricHash !== canonicalHash(metricWithoutHash))
      throw new RangeError(`Simulation metric hash mismatch: ${metric.metricId}.`);
  }
  return artifact;
};

export const mergeSimulationStatisticsArtifactsV4 = (
  left: SimulationStatisticsArtifactV4,
  right: SimulationStatisticsArtifactV4,
): SimulationStatisticsArtifactV4 => {
  if (
    left.schemaVersion !== SIMULATION_STATISTICS_ARTIFACT_VERSION ||
    right.schemaVersion !== SIMULATION_STATISTICS_ARTIFACT_VERSION
  )
    throw new RangeError("Only v4 statistics artifacts can be merged.");
  if (
    left.generatedFrom.catalogId !== right.generatedFrom.catalogId ||
    left.generatedFrom.mechanicsIdentity !== right.generatedFrom.mechanicsIdentity ||
    left.generatedFrom.rootSeed !== right.generatedFrom.rootSeed ||
    left.generatedFrom.evidenceRole !== right.generatedFrom.evidenceRole ||
    left.generatedFrom.exposurePopulation !== right.generatedFrom.exposurePopulation
  )
    throw new RangeError("Statistics artifacts have incompatible manifests.");
  const metrics: Record<string, SimulationMetricAggregateV2> = { ...left.metrics };
  for (const [key, value] of Object.entries(right.metrics))
    metrics[key] =
      metrics[key] === undefined ? value : mergeSimulationMetricAggregatesV2(metrics[key], value);
  return createSimulationStatisticsArtifactV4({
    catalogId: left.generatedFrom.catalogId,
    mechanicsIdentity: left.generatedFrom.mechanicsIdentity,
    rootSeed: left.generatedFrom.rootSeed,
    targetPairs: Math.min(
      SIMULATION_V4_CONTINUATION_CEILING,
      Math.max(left.generatedFrom.targetPairs, right.generatedFrom.targetPairs),
    ),
    evidenceRole: left.generatedFrom.evidenceRole,
    exposurePopulation: left.generatedFrom.exposurePopulation,
    sourceLimitations: [
      ...new Set([
        ...left.generatedFrom.sourceLimitations,
        ...right.generatedFrom.sourceLimitations,
      ]),
    ],
    metrics,
    incompleteFights: left.incompleteFights + right.incompleteFights,
    errorFights: left.errorFights + right.errorFights,
    forcedExposureFights: left.forcedExposureFights + right.forcedExposureFights,
    representativeReplaySeeds: [
      ...left.representativeReplaySeeds,
      ...right.representativeReplaySeeds,
    ],
  });
};

export interface SimulationStatisticsBundleV1 {
  readonly schemaVersion: typeof SIMULATION_STATISTICS_BUNDLE_VERSION;
  readonly artifacts: Readonly<{
    readonly natural: SimulationStatisticsArtifactV4;
    readonly controlled: SimulationStatisticsArtifactV4;
    readonly diagnostic: SimulationStatisticsArtifactV4;
  }>;
  readonly checkpointHashes: Readonly<{
    readonly natural: string;
    readonly controlled: string;
    readonly diagnostic: string;
  }>;
  readonly bundleHash: string;
}

const bundleArtifactsSchema = z
  .object({
    natural: simulationStatisticsArtifactV4Schema,
    controlled: simulationStatisticsArtifactV4Schema,
    diagnostic: simulationStatisticsArtifactV4Schema,
  })
  .strict();

export const simulationStatisticsBundleV1Schema = z
  .object({
    schemaVersion: z.literal(SIMULATION_STATISTICS_BUNDLE_VERSION),
    artifacts: bundleArtifactsSchema,
    checkpointHashes: z
      .object({
        natural: z.string().min(1),
        controlled: z.string().min(1),
        diagnostic: z.string().min(1),
      })
      .strict(),
    bundleHash: z.string().min(1),
  })
  .strict()
  .superRefine((value, context) => {
    const roles = [
      value.artifacts.natural.generatedFrom.evidenceRole,
      value.artifacts.controlled.generatedFrom.evidenceRole,
      value.artifacts.diagnostic.generatedFrom.evidenceRole,
    ];
    if (roles.join("|") !== "natural-balance|controlled|diagnostic")
      context.addIssue({
        code: "custom",
        path: ["artifacts"],
        message: "Bundle artifacts must retain natural, controlled, and diagnostic evidence roles.",
      });
    const mechanics = new Set(
      Object.values(value.artifacts).map((artifact) => artifact.generatedFrom.mechanicsIdentity),
    );
    if (mechanics.size !== 1)
      context.addIssue({
        code: "custom",
        path: ["artifacts"],
        message: "Bundle artifacts must share one mechanics identity.",
      });
  });

export const createSimulationStatisticsBundleV1 = (input: {
  readonly natural: SimulationStatisticsArtifactV4;
  readonly controlled: SimulationStatisticsArtifactV4;
  readonly diagnostic: SimulationStatisticsArtifactV4;
  readonly checkpointHashes: SimulationStatisticsBundleV1["checkpointHashes"];
}): SimulationStatisticsBundleV1 => {
  const withoutHash = {
    schemaVersion: SIMULATION_STATISTICS_BUNDLE_VERSION,
    artifacts: {
      natural: input.natural,
      controlled: input.controlled,
      diagnostic: input.diagnostic,
    },
    checkpointHashes: input.checkpointHashes,
  } as const;
  return simulationStatisticsBundleV1Schema.parse({
    ...withoutHash,
    bundleHash: canonicalHash(withoutHash),
  });
};

export const readSimulationStatisticsBundleV1 = (value: unknown): SimulationStatisticsBundleV1 => {
  const bundle = simulationStatisticsBundleV1Schema.parse(value);
  for (const artifact of Object.values(bundle.artifacts))
    readSimulationStatisticsArtifactV4(artifact);
  const { bundleHash, ...withoutHash } = bundle;
  if (bundleHash !== canonicalHash(withoutHash))
    throw new RangeError("Simulation statistics bundle hash mismatch.");
  return bundle;
};

export const validateSimulationStatisticsBundleV1Closure = (input: unknown): readonly string[] => {
  let bundle: SimulationStatisticsBundleV1;
  try {
    bundle = readSimulationStatisticsBundleV1(input);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  const issues: string[] = [];
  for (const [role, artifact] of Object.entries(bundle.artifacts) as Array<
    [keyof SimulationStatisticsBundleV1["artifacts"], SimulationStatisticsArtifactV4]
  >) {
    if (artifact.generatedFrom.targetPairs < SIMULATION_V4_NOMINAL_TARGET_PAIRS)
      issues.push(`${role} artifact has fewer than 100 requested mirrored pairs`);
    if (artifact.errorFights > 0 || artifact.incompleteFights > 0)
      issues.push(`${role} artifact contains unresolved fights`);
    const expectedRole = role === "natural" ? "natural-balance" : role;
    for (const metric of Object.values(artifact.metrics)) {
      if (metric.dimensions.evidenceRole !== expectedRole)
        issues.push(`${role} artifact contains pooled ${metric.dimensions.evidenceRole} evidence`);
      if (metric.evidence.state === "error")
        issues.push(`${role} metric ${metric.metricId} contains error evidence`);
      if (metric.evidence.reason.trim().length === 0)
        issues.push(`${role} metric ${metric.metricId} has no applicability reason`);
    }
    for (const definition of SIMULATION_V4_METRIC_DEFINITIONS.filter(
      (candidate) => candidate.population === expectedRole,
    )) {
      const matching = Object.values(artifact.metrics).filter(
        (metric) => metric.metricId === definition.metricId,
      );
      if (matching.length === 0) {
        issues.push(`${role} artifact is missing ${definition.metricId}`);
        continue;
      }
      if (
        matching.every(
          (metric) =>
            metric.evidence.state !== "observed" &&
            metric.evidence.state !== "not-applicable" &&
            metric.evidence.state !== "never-eligible" &&
            metric.evidence.state !== "eligible-never-selected",
        )
      )
        issues.push(`${role} metric ${definition.metricId} has no accepted evidence`);
    }
  }
  return [...new Set(issues)].sort((left, right) => left.localeCompare(right));
};

export interface SimulationDashboardRow {
  readonly metricId: string;
  readonly dimensions: SimulationStatisticsDimensions;
  readonly numerator: number;
  readonly denominator: number;
  readonly sampleSize: number;
  readonly actualPairCount: number;
  readonly missingness: number;
  readonly evidenceRole: SimulationStatisticsEvidenceRole;
  readonly exposurePopulation: SimulationStatisticsExposure;
  readonly intervalMethod: SimulationMetricAggregateV2["intervalMethod"];
  readonly lower?: number;
  readonly upper?: number;
  readonly estimate?: number;
  readonly evidenceLabel: SimulationMetricAggregateV2["evidenceLabel"];
  readonly evidenceState: SimulationMetricAggregateV2["evidence"]["state"];
  readonly evidenceReason: string;
  readonly representativeReplaySeeds: readonly number[];
}

export interface SimulationDashboard {
  readonly schemaVersion: "simulation-dashboard:v1";
  readonly sourceArtifactSchema: typeof SIMULATION_STATISTICS_ARTIFACT_VERSION;
  readonly generatedFrom: SimulationStatisticsArtifactV4["generatedFrom"];
  readonly metricDefinitions: readonly SimulationMetricDefinitionV2[];
  readonly rows: readonly SimulationDashboardRow[];
  readonly sections: readonly SimulationDashboardSection[];
  readonly limitations: readonly string[];
  readonly dashboardHash: string;
}

export interface SimulationDashboardSection {
  readonly id: SimulationMetricDefinitionV2["family"];
  readonly rows: readonly SimulationDashboardRow[];
}

const dashboardSectionsFor = (
  rows: readonly SimulationDashboardRow[],
  definitions: readonly SimulationMetricDefinitionV2[],
): readonly SimulationDashboardSection[] => {
  const familyByMetric = new Map(
    definitions.map((definition) => [definition.metricId, definition.family]),
  );
  const grouped = new Map<SimulationDashboardSection["id"], SimulationDashboardRow[]>();
  for (const row of rows) {
    const family = familyByMetric.get(row.metricId) ?? "core";
    const section = grouped.get(family) ?? [];
    section.push(row);
    grouped.set(family, section);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, sectionRows]) => ({ id, rows: sectionRows }));
};

const dashboardRowFor = (metric: SimulationMetricAggregateV2): SimulationDashboardRow => {
  const denominator =
    metric.unit === "proportion" ? metric.denominators.eligible : metric.denominators.completed;
  const numerator = metric.unit === "proportion" ? metric.successes : metric.values.count;
  let interval: { lower: number; upper: number; estimate: number } | undefined;
  if (metric.unit === "proportion" && denominator > 0) {
    const result = summarizeSimulationRate(numerator, denominator);
    interval = { lower: result.lower, upper: result.upper, estimate: result.rate };
  } else if (metric.unit !== "proportion" && metric.values.count > 0) {
    interval = {
      lower: metric.values.mean,
      upper: metric.values.mean,
      estimate: metric.values.mean,
    };
  }
  return {
    metricId: metric.metricId,
    dimensions: metric.dimensions,
    numerator,
    denominator,
    sampleSize: denominator,
    actualPairCount:
      metric.pairedObservations.length > 0
        ? metric.pairedObservations.length
        : metric.denominators.completed,
    missingness:
      metric.denominators.incomplete + metric.denominators.errors + metric.denominators.forced,
    evidenceRole: metric.dimensions.evidenceRole,
    exposurePopulation: metric.dimensions.exposurePopulation,
    intervalMethod: metric.intervalMethod,
    ...(interval === undefined
      ? {}
      : { lower: interval.lower, upper: interval.upper, estimate: interval.estimate }),
    evidenceLabel: metric.evidenceLabel,
    evidenceState: metric.evidence.state,
    evidenceReason: metric.evidence.reason,
    representativeReplaySeeds: metric.representativeReplaySeeds,
  };
};

export const createSimulationDashboard = (
  artifact: SimulationStatisticsArtifactV4,
): SimulationDashboard => {
  const rows = Object.values(artifact.metrics)
    .sort(
      (a, b) =>
        a.metricId.localeCompare(b.metricId) ||
        simulationStatisticsDimensionKey(a.dimensions).localeCompare(
          simulationStatisticsDimensionKey(b.dimensions),
        ),
    )
    .map(dashboardRowFor);
  const definitions = new Map(
    SIMULATION_V4_METRIC_DEFINITIONS.map((definition) => [definition.metricId, definition]),
  );
  const metricDefinitions = [...new Set(rows.map((row) => row.metricId))]
    .sort((a, b) => a.localeCompare(b))
    .map(
      (metricId) =>
        definitions.get(metricId) ?? {
          metricId,
          family: "core" as const,
          numerator: "observed values",
          denominator: "completed fights",
          intervalMethod: rows.find((row) => row.metricId === metricId)?.intervalMethod ?? "none",
          population: "natural-balance" as const,
        },
    );
  const withoutHash = {
    schemaVersion: "simulation-dashboard:v1" as const,
    sourceArtifactSchema: SIMULATION_STATISTICS_ARTIFACT_VERSION,
    generatedFrom: artifact.generatedFrom,
    metricDefinitions,
    rows,
    sections: dashboardSectionsFor(rows, metricDefinitions),
    limitations: artifact.generatedFrom.sourceLimitations,
  };
  return { ...withoutHash, dashboardHash: canonicalHash(withoutHash) };
};

export const createSimulationDashboardFromBundle = (
  bundle: SimulationStatisticsBundleV1,
): SimulationDashboard => {
  const dashboards = [
    createSimulationDashboard(bundle.artifacts.natural),
    createSimulationDashboard(bundle.artifacts.controlled),
    createSimulationDashboard(bundle.artifacts.diagnostic),
  ];
  const rows = dashboards
    .flatMap((dashboard) => dashboard.rows)
    .sort(
      (left, right) =>
        left.metricId.localeCompare(right.metricId) ||
        simulationStatisticsDimensionKey(left.dimensions).localeCompare(
          simulationStatisticsDimensionKey(right.dimensions),
        ),
    );
  const withoutHash = {
    schemaVersion: "simulation-dashboard:v1" as const,
    sourceArtifactSchema: SIMULATION_STATISTICS_ARTIFACT_VERSION,
    generatedFrom: bundle.artifacts.natural.generatedFrom,
    metricDefinitions: SIMULATION_V4_METRIC_DEFINITIONS,
    rows,
    sections: dashboardSectionsFor(rows, SIMULATION_V4_METRIC_DEFINITIONS),
    limitations: [...new Set(dashboards.flatMap((dashboard) => dashboard.limitations))].sort(
      (left, right) => left.localeCompare(right),
    ),
  };
  return {
    ...withoutHash,
    dashboardHash: canonicalHash({ ...withoutHash, bundleHash: bundle.bundleHash }),
  };
};

export const renderSimulationDashboardJson = (dashboard: SimulationDashboard): string =>
  canonicalJson(dashboard);

const csvEscape = (value: unknown): string => {
  const text = typeof value === "string" ? value : canonicalJson(value);
  return /[,\n"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export const renderSimulationDashboardCsv = (dashboard: SimulationDashboard): string => {
  const columns = [
    "metricId",
    "dimensionKey",
    "numerator",
    "denominator",
    "sampleSize",
    "actualPairCount",
    "missingness",
    "evidenceRole",
    "exposurePopulation",
    "intervalMethod",
    "lower",
    "upper",
    "estimate",
    "evidenceLabel",
    "evidenceState",
    "evidenceReason",
    "representativeReplaySeeds",
  ];
  const lines = [columns.join(",")];
  for (const row of dashboard.rows)
    lines.push(
      [
        row.metricId,
        simulationStatisticsDimensionKey(row.dimensions),
        row.numerator,
        row.denominator,
        row.sampleSize,
        row.actualPairCount,
        row.missingness,
        row.evidenceRole,
        row.exposurePopulation,
        row.intervalMethod,
        row.lower ?? "",
        row.upper ?? "",
        row.estimate ?? "",
        row.evidenceLabel,
        row.evidenceState,
        row.evidenceReason,
        row.representativeReplaySeeds.join(" "),
      ]
        .map(csvEscape)
        .join(","),
    );
  return `${lines.join("\n")}\n`;
};

export const renderSimulationDashboardMarkdown = (dashboard: SimulationDashboard): string => {
  const lines = [
    "# Simulation balance dashboard",
    "",
    `Artifact: ${dashboard.sourceArtifactSchema}`,
    `Evidence: ${dashboard.generatedFrom.evidenceLevel}`,
    `Target pairs: ${dashboard.generatedFrom.targetPairs}`,
    "",
    "## Sections",
    "",
    ...dashboard.sections.map((section) => `- ${section.id}: ${section.rows.length} rows`),
    "",
    "| Metric | Sample | Estimate | Interval | Evidence |",
    "| --- | ---: | ---: | --- | --- |",
    ...dashboard.rows.map(
      (row) =>
        `| ${row.metricId} | ${row.sampleSize} | ${row.estimate ?? "insufficient"} | ${row.lower ?? "—"}–${row.upper ?? "—"} | ${row.evidenceLabel} |`,
    ),
  ];
  if (dashboard.limitations.length > 0)
    lines.push(
      "",
      "## Source limitations",
      "",
      ...dashboard.limitations.map((value) => `- ${value}`),
    );
  return `${lines.join("\n")}\n`;
};

export interface SimulationSourceDossier {
  readonly sourceDefinitionId: string;
  readonly artifactSchema: typeof SIMULATION_STATISTICS_ARTIFACT_VERSION;
  readonly rows: readonly SimulationDashboardRow[];
  readonly limitations: readonly string[];
  readonly dossierHash: string;
}

export const createSimulationSourceDossiers = (
  artifact: SimulationStatisticsArtifactV4,
): readonly SimulationSourceDossier[] => {
  const rows = createSimulationDashboard(artifact).rows;
  const grouped = new Map<string, SimulationDashboardRow[]>();
  for (const row of rows) {
    const source =
      row.dimensions.moveId ?? row.dimensions.itemId ?? row.dimensions.transformationId ?? "global";
    const group = grouped.get(source) ?? [];
    group.push(row);
    grouped.set(source, group);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([sourceDefinitionId, sourceRows]) => {
      const withoutHash = {
        sourceDefinitionId,
        artifactSchema: SIMULATION_STATISTICS_ARTIFACT_VERSION,
        rows: sourceRows,
        limitations: artifact.generatedFrom.sourceLimitations,
      };
      return { ...withoutHash, dossierHash: canonicalHash(withoutHash) };
    });
};

export const renderSimulationSourceDossiersJson = (
  dossiers: readonly SimulationSourceDossier[],
): string => canonicalJson(dossiers);

export const renderSimulationSourceDossiersMarkdown = (
  dossiers: readonly SimulationSourceDossier[],
): string =>
  dossiers
    .map(
      (dossier) =>
        `# ${dossier.sourceDefinitionId}\n\nDossier hash: \`${dossier.dossierHash}\`\n\n` +
        renderSimulationDashboardMarkdown({
          schemaVersion: "simulation-dashboard:v1",
          sourceArtifactSchema: dossier.artifactSchema,
          generatedFrom: {
            catalogId: "dossier",
            mechanicsIdentity: "dossier",
            rootSeed: 0,
            targetPairs: 0,
            maximumPairs: SIMULATION_V4_CONTINUATION_CEILING,
            evidenceRole: "natural-balance",
            exposurePopulation: "natural",
            evidenceLevel: "confirmation",
            sourceLimitations: dossier.limitations,
          },
          metricDefinitions: [],
          rows: dossier.rows,
          sections: [{ id: "core", rows: dossier.rows }],
          limitations: dossier.limitations,
          dashboardHash: dossier.dossierHash,
        }),
    )
    .join("\n");

export const v4StatisticsArtifactSchemaVersions = Object.freeze([
  SIMULATION_STATISTICS_ARTIFACT_VERSION,
  SIMULATION_FIGHT_STATISTICS_VERSION,
  SIMULATION_FIGHT_STATISTICS_V2_VERSION,
  SIMULATION_METRICS_VERSION,
  SIMULATION_STATISTICS_BUNDLE_VERSION,
] as const);

export const isSimulationStatisticsArtifactV4 = (
  value: unknown,
): value is SimulationStatisticsArtifactV4 =>
  simulationStatisticsArtifactV4Schema.safeParse(value).success;

export const createSimulationFightStatisticsFromState = (input: {
  readonly pairId: string;
  readonly orientation: "original" | "mirrored";
  readonly fighterAId: string;
  readonly fighterBId: string;
  readonly finalState: FightState;
  readonly winner: "a" | "b" | "draw";
  readonly terminationReason: string;
  readonly damageDealt: Readonly<{ readonly a: number; readonly b: number }>;
  readonly initiativeWinner: SimulationStatisticsSide | "tie";
  readonly firstActor: SimulationStatisticsSide;
  /** Computed by the transition observer at action boundaries, never from final HP alone. */
  readonly comeback?: boolean;
  readonly representativeReplaySeed?: number;
}): SimulationFightStatisticsV1 => {
  if (input.finalState.status !== "completed")
    throw new RangeError("Fight statistics require a completed or explicitly summarized state.");
  const a = Object.values(input.finalState.combatants).find(
    (combatant) => combatant.id === input.fighterAId,
  );
  const b = Object.values(input.finalState.combatants).find(
    (combatant) => combatant.id === input.fighterBId,
  );
  if (a === undefined || b === undefined)
    throw new RangeError("Fight state must contain two fighters.");
  const winnerCombatant = input.winner === "a" ? a : input.winner === "b" ? b : undefined;
  return {
    schemaVersion: SIMULATION_FIGHT_STATISTICS_VERSION,
    pairId: input.pairId,
    orientation: input.orientation,
    fighterAId: input.fighterAId,
    fighterBId: input.fighterBId,
    winner: input.winner,
    completed: true,
    terminationReason: input.terminationReason,
    turns: input.finalState.turnNumber,
    ...(winnerCombatant === undefined
      ? {}
      : {
          winnerRemainingHp: winnerCombatant.hitPoints.current,
          winnerRemainingKi: winnerCombatant.ki.current,
        }),
    damageDealt: input.damageDealt,
    damageReceived: { a: input.damageDealt.b, b: input.damageDealt.a },
    startingHp: { a: a.hitPoints.maximum, b: b.hitPoints.maximum },
    remainingHp: { a: a.hitPoints.current, b: b.hitPoints.current },
    remainingKi: { a: a.ki.current, b: b.ki.current },
    comeback: input.comeback ?? false,
    initiativeWinner: input.initiativeWinner,
    firstActor: input.firstActor,
    ...(input.representativeReplaySeed === undefined
      ? {}
      : { representativeReplaySeed: input.representativeReplaySeed }),
  };
};

export const pairedBootstrapForMetric = (metric: SimulationMetricAggregateV2, rootSeed: number) =>
  metric.pairedObservations.length === 0
    ? undefined
    : seededBootstrapPairedDifference(
        metric.pairedObservations.map((observation) => ({
          identity: observation.pairId,
          difference: observation.difference,
        })),
        rootSeed,
      );

// Keep these imports observable to the type checker in generated declaration output.
export type SimulationV4BoundedAggregateParts = {
  readonly mean: SimulationMeanVariance;
  readonly histogram: SimulationHistogram;
  readonly quantiles: SimulationQuantileSketch;
};

export const createSimulationV4BoundedAggregateParts = (): SimulationV4BoundedAggregateParts => ({
  mean: createSimulationMeanVariance(),
  histogram: createSimulationHistogram([0, 0.1, 0.25, 0.5, 0.75, 1]),
  quantiles: createSimulationQuantileSketch(),
});
