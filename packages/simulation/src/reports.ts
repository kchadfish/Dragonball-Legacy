import { canonicalHash, canonicalJson } from "./canonical.js";
import type { SimulationCoverageArtifactError } from "./coverage-artifacts.js";
import type { SimulationMoveCoverageArtifact } from "./coverage-artifacts.js";
import type { SimulationCoverageCell } from "./coverage.js";
import type { SimulationMoveMetrics } from "./metrics.js";
import { compareSimulationRates } from "./comparisons.js";
import type {
  SimulationMoveCoverageDataset,
  SimulationMoveCoverageRecord,
  SimulationMoveCoveragePopulation,
  SimulationMoveFunnel,
} from "./move-coverage.js";
import {
  adjustSimulationPValues,
  seededBootstrapPairedDifference,
  summarizeSimulationRate,
  twoSidedSimulationRatePValue,
  type AdjustedSimulationPValue,
  type SimulationInterval,
  type SimulationRateSummary,
  type SimulationStratifiedAccumulator,
} from "./statistics.js";

export interface SimulationReportRow {
  readonly id: string;
  readonly values: Readonly<Record<string, string | number | boolean | null>>;
}

export interface SimulationReport {
  readonly schemaVersion: "simulation-report:v2";
  readonly reportId: string;
  readonly title: string;
  readonly generatedFrom: Readonly<{
    readonly scopeVersion: string;
    readonly mechanicsIdentity: string;
    readonly inputHash: string;
    readonly coverageSchemaVersion: string;
  }>;
  readonly manifest: Readonly<{
    readonly populations: readonly ["natural", "isolation", "forced"];
    readonly strata: readonly string[];
    readonly denominators: readonly string[];
    readonly precisionLooks: readonly number[];
    readonly metricDictionaryVersion: "simulation-metrics:v1";
    readonly intervalVersion: "intervals:v1";
    readonly confidence: 0.95;
  }>;
  readonly columns: readonly string[];
  readonly rows: readonly SimulationReportRow[];
  readonly intervals: readonly SimulationReportInterval[];
  readonly effectSizes: readonly SimulationReportEffectSize[];
  readonly pairedEffects: readonly SimulationReportPairedEffect[];
  readonly multipleComparison: Readonly<{
    readonly schemaVersion: "simulation-multiple-comparison:v1";
    readonly method: "benjamini-hochberg";
    readonly falseDiscoveryRate: 0.05;
    readonly tests: readonly AdjustedSimulationPValue[];
    readonly rationale: string;
  }>;
  readonly comparableRationale: readonly SimulationReportComparableRationale[];
  readonly representativeReplaySeeds: Readonly<Record<string, readonly number[]>>;
  readonly metricsByMove: Readonly<Record<string, SimulationMoveMetrics>>;
  readonly stratifiedAccumulators: Readonly<Record<string, SimulationStratifiedAccumulator>>;
  readonly anomalies: readonly string[];
  readonly followUpTargets: readonly string[];
  readonly errors: readonly SimulationCoverageArtifactError[];
  readonly freshnessHash: string;
  readonly reportHash: string;
}

export interface SimulationReportInterval {
  readonly id: string;
  readonly moveId: string;
  readonly population: SimulationMoveCoveragePopulation;
  readonly scenarioFamily: string;
  readonly checkpointId: string;
  readonly mechanicPath: "decision" | "trigger";
  readonly strata: Readonly<Record<string, string>>;
  readonly metric: string;
  readonly numerator: number;
  readonly denominator: number;
  readonly estimate: number | null;
  readonly interval: SimulationInterval | null;
  readonly intervalMethod: "wilson-95" | "not-estimated";
  readonly sampleCount: number;
  readonly missingCount: number;
  readonly errorCount: number;
  readonly rationale: string;
}

export interface SimulationReportEffectSize {
  readonly id: string;
  readonly moveId: string;
  readonly metric: string;
  readonly baselinePopulation: SimulationMoveCoveragePopulation;
  readonly comparisonPopulation: SimulationMoveCoveragePopulation;
  readonly baseline: SimulationRateSummary | null;
  readonly comparison: SimulationRateSummary | null;
  readonly estimate: number | null;
  readonly interval: SimulationInterval | null;
  readonly intervalMethod: "wilson-difference-envelope" | "not-estimated";
  readonly sampleCount: number;
  readonly pValue: number | null;
  readonly adjustedPValue?: number;
  readonly exploratoryFlag?: boolean;
  readonly paired: false;
  readonly rationale: string;
}

export interface SimulationReportPairedEffect {
  readonly id: string;
  readonly moveId: string;
  readonly population: SimulationMoveCoveragePopulation;
  readonly metric: "target-control-damage";
  readonly completedPairs: number;
  readonly targetWins: number;
  readonly controlWins: number;
  readonly draws: number;
  readonly estimate: number | null;
  readonly interval: SimulationInterval | null;
  readonly intervalMethod: "paired-bootstrap-95" | "not-estimated";
  readonly bootstrapSeed?: number;
  readonly paired: true;
  readonly rationale: string;
}

export interface SimulationReportComparableRationale {
  readonly population: SimulationMoveCoveragePopulation;
  readonly algorithmVersion: "comparables:multi-stage-filter-v1";
  readonly strata: readonly string[];
  readonly rationale: string;
  readonly balanceUse: "natural-evidence" | "exposure-only";
}

export interface SimulationMoveBalanceReportOptions {
  readonly errors?: readonly SimulationCoverageArtifactError[];
  readonly coverageCells?: readonly SimulationCoverageCell[];
  readonly metricsByMove?: NonNullable<SimulationMoveCoverageArtifact["metricsByMove"]>;
  readonly stratifiedAccumulators?: NonNullable<
    SimulationMoveCoverageArtifact["stratifiedAccumulators"]
  >;
  readonly generatedFrom?: SimulationMoveCoverageArtifact["generatedFrom"];
}

const rowForMove = (
  record: SimulationMoveCoverageRecord,
  errors: readonly SimulationCoverageArtifactError[],
): SimulationReportRow => {
  const moveErrors = errors.filter((error) => error.moveId === record.moveId);
  const funnelForPopulation = (
    population: SimulationMoveCoveragePopulation,
  ): SimulationMoveFunnel => record.populationFunnels?.[population] ?? record.funnel;
  const populationFunnels = {
    natural: funnelForPopulation("natural"),
    isolation: funnelForPopulation("isolation"),
    forced: funnelForPopulation("forced"),
  } as const;
  const populationValues = Object.fromEntries(
    Object.entries(populationFunnels).flatMap(([population, funnel]) => [
      [`${population}Equipped`, funnel.equipped],
      [`${population}Eligible`, funnel.eligible],
      [`${population}Selected`, funnel.selected],
      [`${population}Resolved`, funnel.resolved],
      [`${population}Successful`, funnel.successful],
      [`${population}TriggerApplicable`, funnel.triggerFunnel.applicable],
      [`${population}TriggerTriggered`, funnel.triggerFunnel.triggered],
      [`${population}TriggerResolved`, funnel.triggerFunnel.resolved],
    ]),
  ) as Record<string, number>;
  return {
    id: record.moveId,
    values: {
      moveId: record.moveId,
      name: record.moveName,
      category: record.category,
      naturalStatus: record.naturalStatus,
      isolationStatus: record.isolationStatus,
      forcedStatus: record.forcedStatus,
      equipped: record.funnel.equipped,
      eligible: record.funnel.eligible,
      affordable: record.funnel.affordable,
      selected: record.funnel.selected,
      submitted: record.funnel.submitted,
      resolved: record.funnel.resolved,
      successful: record.funnel.successful,
      valueProducing: record.funnel.valueProducing,
      decisionEligible: record.funnel.decisionFunnel.eligible,
      decisionSelected: record.funnel.decisionFunnel.selected,
      triggerApplicable: record.funnel.triggerFunnel.applicable,
      triggerActivated: record.funnel.triggerFunnel.activated,
      triggerResolved: record.funnel.triggerFunnel.resolved,
      triggerValueProducing: record.funnel.triggerFunnel.valueProducing,
      ...populationValues,
      errorCount: moveErrors.length,
      errors: moveErrors.length === 0 ? null : JSON.stringify(moveErrors),
      followUp: [record.naturalStatus, record.isolationStatus, record.forcedStatus].some(
        (status) => status !== "observed-sufficient" && status !== "sufficient",
      ),
    },
  };
};

const populations = ["natural", "isolation", "forced"] as const;

const funnelForPopulation = (
  record: SimulationMoveCoverageRecord,
  population: SimulationMoveCoveragePopulation,
): SimulationMoveFunnel => record.populationFunnels?.[population] ?? record.funnel;

const intervalForRate = (
  numerator: number,
  denominator: number,
): { readonly estimate: number | null; readonly interval: SimulationInterval | null } =>
  denominator === 0
    ? { estimate: null, interval: null }
    : (() => {
        const summary = summarizeSimulationRate(numerator, denominator);
        return {
          estimate: summary.rate,
          interval: {
            lower: summary.lower,
            upper: summary.upper,
            confidence: summary.confidence,
          },
        };
      })();

const intervalEvidenceFor = (
  record: SimulationMoveCoverageRecord,
  population: SimulationMoveCoveragePopulation,
  cell: SimulationCoverageCell,
  metric: string,
  numerator: number,
  denominator: number,
  errorCount: number,
): SimulationReportInterval => {
  const estimate = intervalForRate(numerator, denominator);
  return {
    id: `${cell.cellId}:${metric}`,
    moveId: record.moveId,
    population,
    scenarioFamily: cell.scenarioFamily,
    checkpointId: cell.checkpointId,
    mechanicPath: cell.mechanicPath,
    strata: cell.strata,
    metric,
    numerator,
    denominator,
    ...estimate,
    intervalMethod: estimate.interval === null ? "not-estimated" : "wilson-95",
    sampleCount: denominator,
    missingCount: cell.completedFights - Math.min(cell.completedFights, denominator),
    errorCount,
    rationale:
      estimate.interval === null
        ? "No denominator observations were retained; this rate is not estimated."
        : "Wilson 95% interval; errored and incomplete fights are excluded from the rate.",
  };
};

const fallbackCellFor = (
  record: SimulationMoveCoverageRecord,
  population: SimulationMoveCoveragePopulation,
  mechanicPath: "decision" | "trigger",
): SimulationCoverageCell => ({
  schemaVersion: "simulation-coverage-cell:v2",
  cellId: `simulation-cell:report-${record.moveId}-${population}-${mechanicPath}`,
  moveId: record.moveId,
  scenarioFamily: "move-isolation",
  mechanicPath,
  checkpointId: "unknown",
  population,
  strata: { category: record.category },
  targetFights: 1,
  minimumEligibleStates: 1,
  completedFights: 0,
  eligibleStates: 0,
  selectedStates: 0,
  triggeredStates: 0,
  status: "not-scheduled",
  cellHash: "report-only",
});

type ReportIntervalMetric = readonly [string, number, number];

const intervalMetricsFor = (
  mechanicPath: "decision" | "trigger",
  funnel: SimulationMoveFunnel,
  cell: SimulationCoverageCell,
): readonly ReportIntervalMetric[] => {
  if (mechanicPath === "decision")
    return [
      ["selection-rate", cell.selectedStates, cell.eligibleStates],
      ["affordability-rate", funnel.decisionFunnel.affordable, funnel.decisionFunnel.eligible],
      ["submission-rate", funnel.decisionFunnel.submitted, funnel.decisionFunnel.selected],
      ["resolution-rate", funnel.decisionFunnel.resolved, funnel.decisionFunnel.submitted],
      ["success-rate", funnel.decisionFunnel.successful, funnel.decisionFunnel.resolved],
      [
        "value-production-rate",
        funnel.decisionFunnel.valueProducing,
        funnel.decisionFunnel.resolved,
      ],
    ];
  return [
    ["trigger-rate", funnel.triggerFunnel.triggered, funnel.triggerFunnel.applicable],
    ["activation-rate", funnel.triggerFunnel.activated, funnel.triggerFunnel.triggered],
    ["resolution-rate", funnel.triggerFunnel.resolved, funnel.triggerFunnel.activated],
    ["success-rate", funnel.triggerFunnel.successful, funnel.triggerFunnel.resolved],
    ["value-production-rate", funnel.triggerFunnel.valueProducing, funnel.triggerFunnel.resolved],
  ];
};

const intervalsForMove = (
  record: SimulationMoveCoverageRecord,
  cells: readonly SimulationCoverageCell[],
  errors: readonly SimulationCoverageArtifactError[],
): readonly SimulationReportInterval[] => {
  const moveErrors = errors.filter((error) => error.moveId === record.moveId);
  const evidence: SimulationReportInterval[] = [];
  for (const population of populations) {
    const funnel = funnelForPopulation(record, population);
    for (const mechanicPath of ["decision", "trigger"] as const) {
      const matchingCells = cells.filter(
        (cell) =>
          cell.moveId === record.moveId &&
          cell.population === population &&
          cell.mechanicPath === mechanicPath,
      );
      const contexts =
        matchingCells.length === 0
          ? [fallbackCellFor(record, population, mechanicPath)]
          : matchingCells;
      for (const cell of contexts) {
        for (const [metric, numerator, denominator] of intervalMetricsFor(
          mechanicPath,
          funnel,
          cell,
        ))
          evidence.push(
            intervalEvidenceFor(
              record,
              population,
              cell,
              metric,
              numerator,
              denominator,
              moveErrors.length,
            ),
          );
      }
    }
  }
  return evidence.sort((left, right) => left.id.localeCompare(right.id));
};

const populationSelectionRate = (
  record: SimulationMoveCoverageRecord,
  population: SimulationMoveCoveragePopulation,
): SimulationRateSummary | null => {
  const funnel = funnelForPopulation(record, population).decisionFunnel;
  return funnel.eligible === 0 ? null : summarizeSimulationRate(funnel.selected, funnel.eligible);
};

const effectSizesForMove = (
  record: SimulationMoveCoverageRecord,
): readonly SimulationReportEffectSize[] => {
  const pairs = [
    ["natural", "isolation"],
    ["isolation", "forced"],
    ["natural", "forced"],
  ] as const satisfies readonly (readonly [
    SimulationMoveCoveragePopulation,
    SimulationMoveCoveragePopulation,
  ])[];
  return pairs.map(([baselinePopulation, comparisonPopulation]) => {
    const baseline = populationSelectionRate(record, baselinePopulation);
    const comparison = populationSelectionRate(record, comparisonPopulation);
    const difference =
      baseline === null || comparison === null
        ? null
        : compareSimulationRates(baseline, comparison);
    return {
      id: `${record.moveId}:decision-selection-rate:${baselinePopulation}-vs-${comparisonPopulation}`,
      moveId: record.moveId,
      metric: "decision-selection-rate",
      baselinePopulation,
      comparisonPopulation,
      baseline,
      comparison,
      estimate: difference?.difference ?? null,
      interval:
        difference === null
          ? null
          : {
              lower: difference.lower,
              upper: difference.upper,
              confidence: difference.confidence,
            },
      intervalMethod: difference === null ? "not-estimated" : "wilson-difference-envelope",
      sampleCount: (baseline?.denominator ?? 0) + (comparison?.denominator ?? 0),
      pValue:
        baseline === null || comparison === null
          ? null
          : twoSidedSimulationRatePValue(baseline, comparison),
      paired: false,
      rationale:
        difference === null
          ? "At least one population has no eligible states; the descriptive contrast is not estimated."
          : "Unpaired descriptive population contrast; it is not a causal balance conclusion. Forced exposure remains execution-only evidence.",
    };
  });
};

const pairedEffectsFor = (
  record: SimulationMoveCoverageRecord,
  accumulators: Readonly<Record<string, SimulationStratifiedAccumulator>>,
  rootSeed: number,
): readonly SimulationReportPairedEffect[] =>
  populations.flatMap((population) => {
    const accumulatorKey = `${population}:${record.moveId}`;
    if (!Object.hasOwn(accumulators, accumulatorKey)) return [];
    const accumulator = accumulators[accumulatorKey]!;
    const observations = accumulator.pairedDifferences.observations;
    const bootstrap =
      observations.length === 0
        ? undefined
        : seededBootstrapPairedDifference(observations, rootSeed, {
            resamples: 10_000,
            confidence: 0.95,
          });
    let rationale =
      "Mirrored isolation target-versus-control contrast is exposure evidence only; it is not a causal balance conclusion.";
    if (population === "natural")
      rationale =
        "Mirrored target-versus-control damage contrast for natural evidence; it is descriptive and does not approve balance.";
    if (population === "forced")
      rationale =
        "Mirrored forced-exposure contrast is execution evidence only and is never pooled into natural balance evidence.";
    const intervalMethod: SimulationReportPairedEffect["intervalMethod"] =
      bootstrap === undefined ? "not-estimated" : "paired-bootstrap-95";
    return [
      {
        id: `${population}:${record.moveId}:target-control-damage`,
        moveId: record.moveId,
        population,
        metric: "target-control-damage" as const,
        completedPairs: accumulator.completedPairs,
        targetWins: accumulator.winsA,
        controlWins: accumulator.winsB,
        draws: accumulator.draws,
        estimate: bootstrap?.estimate ?? null,
        interval:
          bootstrap === undefined
            ? null
            : {
                lower: bootstrap.lower,
                upper: bootstrap.upper,
                confidence: bootstrap.confidence,
              },
        intervalMethod,
        ...(bootstrap === undefined ? {} : { bootstrapSeed: bootstrap.seed }),
        paired: true as const,
        rationale,
      },
    ];
  });

const comparableRationaleFor = (
  population: SimulationMoveCoveragePopulation,
  record: SimulationMoveCoverageRecord,
  cells: readonly SimulationCoverageCell[],
  generatedFrom: SimulationMoveBalanceReportOptions["generatedFrom"],
): SimulationReportComparableRationale => {
  const strata = [
    ...new Set(
      cells
        .filter((cell) => cell.moveId === record.moveId && cell.population === population)
        .flatMap((cell) => Object.entries(cell.strata).map(([key, value]) => `${key}=${value}`)),
    ),
  ].sort((left, right) => left.localeCompare(right));
  const profile = generatedFrom?.naturalProfileId;
  const naturalProfileSuffix = profile === undefined ? "" : ` (${profile})`;
  const naturalRationale =
    "Natural balance evidence is separated by approved TF1 loadout and AI profile" +
    naturalProfileSuffix +
    ". Comparable choices must pass the typed category, timing, scope, acquisition, resource, role, effect, and usage-context filters.";
  let rationale: string;
  let balanceUse: "natural-evidence" | "exposure-only";
  if (population === "natural") {
    rationale = naturalRationale;
    balanceUse = "natural-evidence";
  } else if (population === "isolation") {
    rationale =
      "Isolation evidence uses target-present, target-removed, and nearest-comparable replacement contexts to explain exposure without pooling it into natural balance evidence.";
    balanceUse = "exposure-only";
  } else {
    rationale =
      "Forced evidence selects from the exact engine-legal set to prove mechanic execution and prerequisite reachability; it is never natural balance evidence.";
    balanceUse = "exposure-only";
  }
  return {
    population,
    algorithmVersion: "comparables:multi-stage-filter-v1",
    strata,
    rationale,
    balanceUse,
  };
};

export const createSimulationMoveBalanceReport = (
  dataset: SimulationMoveCoverageDataset,
  reportId = "simulation-report:move-balance",
  options: SimulationMoveBalanceReportOptions = {},
): SimulationReport => {
  const errors = Object.freeze([...(options.errors ?? [])]);
  const coverageCells = Object.freeze([...(options.coverageCells ?? [])]);
  const columns = [
    "moveId",
    "name",
    "category",
    "naturalStatus",
    "isolationStatus",
    "forcedStatus",
    "equipped",
    "eligible",
    "affordable",
    "selected",
    "submitted",
    "resolved",
    "successful",
    "valueProducing",
    "decisionEligible",
    "decisionSelected",
    "triggerApplicable",
    "triggerActivated",
    "triggerResolved",
    "triggerValueProducing",
    "naturalEquipped",
    "naturalEligible",
    "naturalSelected",
    "naturalResolved",
    "naturalSuccessful",
    "naturalTriggerApplicable",
    "naturalTriggerTriggered",
    "naturalTriggerResolved",
    "isolationEquipped",
    "isolationEligible",
    "isolationSelected",
    "isolationResolved",
    "isolationSuccessful",
    "isolationTriggerApplicable",
    "isolationTriggerTriggered",
    "isolationTriggerResolved",
    "forcedEquipped",
    "forcedEligible",
    "forcedSelected",
    "forcedResolved",
    "forcedSuccessful",
    "forcedTriggerApplicable",
    "forcedTriggerTriggered",
    "forcedTriggerResolved",
    "errorCount",
    "errors",
    "followUp",
  ] as const;
  const rows = [...dataset.records]
    .sort((left, right) => left.moveId.localeCompare(right.moveId))
    .map((record) => rowForMove(record, errors));
  const generatedFrom = {
    scopeVersion: "simulation-scope:v2",
    mechanicsIdentity: dataset.mechanicsIdentity,
    inputHash: dataset.datasetHash,
    coverageSchemaVersion: "simulation-move-coverage:v2",
  } as const;
  const manifest = {
    populations: ["natural", "isolation", "forced"] as const,
    strata: ["population", "category"] as const,
    denominators: [
      "completed-fights",
      "eligible-states",
      "selected-states",
      "triggered-states",
      "completed-pairs",
    ],
    precisionLooks: [250, 500, 1_000, 2_000, 5_000, 10_000],
    metricDictionaryVersion: "simulation-metrics:v1" as const,
    intervalVersion: "intervals:v1" as const,
    confidence: 0.95 as const,
  } as const;
  const intervals = Object.freeze(
    rows.flatMap((row) => {
      const record = dataset.records.find((candidate) => candidate.moveId === row.id);
      return record === undefined ? [] : intervalsForMove(record, coverageCells, errors);
    }),
  );
  const unadjustedEffectSizes = Object.freeze(
    rows.flatMap((row) => {
      const record = dataset.records.find((candidate) => candidate.moveId === row.id);
      return record === undefined ? [] : effectSizesForMove(record);
    }),
  );
  const multipleComparisonTests = adjustSimulationPValues(
    unadjustedEffectSizes.flatMap((effect) =>
      effect.pValue === null ? [] : [{ identity: effect.id, pValue: effect.pValue }],
    ),
  );
  const multipleComparisonById = new Map(
    multipleComparisonTests.map((test) => [test.identity, test]),
  );
  const effectSizes = Object.freeze(
    unadjustedEffectSizes.map((effect) => {
      const adjustment = multipleComparisonById.get(effect.id);
      return adjustment === undefined
        ? effect
        : {
            ...effect,
            adjustedPValue: adjustment.adjustedPValue,
            exploratoryFlag: adjustment.exploratoryFlag,
          };
    }),
  );
  const multipleComparison = Object.freeze({
    schemaVersion: "simulation-multiple-comparison:v1" as const,
    method: "benjamini-hochberg" as const,
    falseDiscoveryRate: 0.05 as const,
    tests: multipleComparisonTests,
    rationale:
      "Benjamini-Hochberg controls exploratory rate-contrast triage only; it never converts isolation or forced evidence into a balance conclusion.",
  });
  const comparableRationale = Object.freeze(
    rows.flatMap((row) => {
      const record = dataset.records.find((candidate) => candidate.moveId === row.id);
      return record === undefined
        ? []
        : populations.map((population) =>
            comparableRationaleFor(population, record, coverageCells, options.generatedFrom),
          );
    }),
  );
  const representativeReplaySeeds = Object.fromEntries(
    rows.flatMap((row) =>
      populations.map((population) => [
        `${population}:${row.id}`,
        options.generatedFrom?.representativeReplaySeedsByMove?.[population]?.[row.id] ?? [],
      ]),
    ),
  ) as Readonly<Record<string, readonly number[]>>;
  const stratifiedAccumulators = Object.fromEntries(
    Object.entries(options.stratifiedAccumulators ?? {}).flatMap(([population, accumulators]) =>
      Object.entries(accumulators).map(([moveId, accumulator]) => [
        `${population}:${moveId}`,
        accumulator,
      ]),
    ),
  ) as Readonly<Record<string, SimulationStratifiedAccumulator>>;
  const metricsByMove = Object.fromEntries(
    Object.entries(options.metricsByMove ?? {}).flatMap(([population, metrics]) =>
      Object.entries(metrics).map(([moveId, metric]) => [`${population}:${moveId}`, metric]),
    ),
  ) as Readonly<Record<string, SimulationMoveMetrics>>;
  const pairedEffects = Object.freeze(
    rows.flatMap((row) => {
      const record = dataset.records.find((candidate) => candidate.moveId === row.id);
      return record === undefined
        ? []
        : pairedEffectsFor(record, stratifiedAccumulators, options.generatedFrom?.rootSeed ?? 0);
    }),
  );
  const followUpTargets = rows
    .filter((row) => row.values.followUp === true)
    .map((row) => row.id)
    .sort((left, right) => left.localeCompare(right));
  const anomalies = Object.freeze(
    [
      errors.map((error) => `${error.moveId} (${error.runId}): ${error.type} — ${error.detail}`),
      ...rows
        .filter((row) => row.values.isolationStatus === "runner-failure")
        .map((row) => `${row.id}: runner-failure status requires rerun evidence.`),
    ].flat(),
  );
  const freshnessHash = canonicalHash({
    generatedFrom,
    manifest,
    columns,
    rows,
    intervals,
    effectSizes,
    pairedEffects,
    multipleComparison,
    comparableRationale,
    representativeReplaySeeds,
    metricsByMove,
    stratifiedAccumulators,
    anomalies,
    followUpTargets,
    errors,
  });
  return {
    schemaVersion: "simulation-report:v2",
    reportId,
    title: "Simulation move balance matrix",
    generatedFrom,
    manifest,
    columns,
    rows,
    intervals,
    effectSizes,
    pairedEffects,
    multipleComparison,
    comparableRationale,
    representativeReplaySeeds,
    metricsByMove,
    stratifiedAccumulators,
    anomalies,
    followUpTargets,
    errors,
    freshnessHash,
    reportHash: canonicalHash({
      reportId,
      title: "Simulation move balance matrix",
      generatedFrom,
      manifest,
      columns,
      rows,
      intervals,
      effectSizes,
      pairedEffects,
      comparableRationale,
      representativeReplaySeeds,
      metricsByMove,
      stratifiedAccumulators,
      anomalies,
      followUpTargets,
      errors,
    }),
  };
};

export const createSimulationMoveDossiers = (
  dataset: SimulationMoveCoverageDataset,
  options: SimulationMoveBalanceReportOptions = {},
): readonly SimulationReport[] =>
  [...dataset.records]
    .sort((left, right) => left.moveId.localeCompare(right.moveId))
    .map((record) => {
      const moveOptions: SimulationMoveBalanceReportOptions = {
        ...options,
        errors: options.errors?.filter((error) => error.moveId === record.moveId),
        coverageCells: options.coverageCells?.filter((cell) => cell.moveId === record.moveId),
        metricsByMove:
          options.metricsByMove === undefined
            ? undefined
            : (Object.fromEntries(
                populations.map((population) => [
                  population,
                  Object.fromEntries(
                    Object.entries(options.metricsByMove?.[population] ?? {}).filter(
                      ([moveId]) => moveId === record.moveId,
                    ),
                  ),
                ]),
              ) as NonNullable<SimulationMoveBalanceReportOptions["metricsByMove"]>),
        stratifiedAccumulators:
          options.stratifiedAccumulators === undefined
            ? undefined
            : (Object.fromEntries(
                populations.map((population) => [
                  population,
                  Object.fromEntries(
                    Object.entries(options.stratifiedAccumulators?.[population] ?? {}).filter(
                      ([moveId]) => moveId === record.moveId,
                    ),
                  ),
                ]),
              ) as NonNullable<SimulationMoveBalanceReportOptions["stratifiedAccumulators"]>),
      };
      return createSimulationMoveBalanceReport(
        { ...dataset, records: [record] },
        `simulation-report:move-${record.moveId.replaceAll(":", "-")}`,
        moveOptions,
      );
    });

export const renderSimulationMoveDossiersJson = (dossiers: readonly SimulationReport[]): string =>
  canonicalJson(dossiers);

export const renderSimulationMoveDossiersMarkdown = (
  dossiers: readonly SimulationReport[],
): string => dossiers.map(renderSimulationReportMarkdown).join("\n");

export const renderSimulationReportJson = (report: SimulationReport): string =>
  canonicalJson(report);

const escapeCsv = (value: string | number | boolean | null): string => {
  const text = value === null ? "" : String(value);
  return /[",\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export const renderSimulationReportCsv = (report: SimulationReport): string => {
  const lines = [report.columns.join(",")];
  for (const row of report.rows)
    lines.push(report.columns.map((column) => escapeCsv(row.values[column] ?? null)).join(","));
  const section = (
    name: string,
    header: readonly string[],
    rows: readonly (string | number | boolean)[][],
  ) => {
    lines.push("", `# ${name}`, header.map(escapeCsv).join(","));
    for (const row of rows) lines.push(row.map(escapeCsv).join(","));
  };
  section(
    "manifest",
    ["key", "value"],
    [
      ["schemaVersion", report.schemaVersion],
      ["reportId", report.reportId],
      ["freshnessHash", report.freshnessHash],
      ["generatedFrom", canonicalJson(report.generatedFrom)],
      ["manifest", canonicalJson(report.manifest)],
    ],
  );
  section(
    "metrics",
    ["id", "metric"],
    Object.entries(report.metricsByMove).map(([id, metric]) => [id, canonicalJson(metric)]),
  );
  section(
    "intervals",
    ["id", "moveId", "population", "metric", "numerator", "denominator", "estimate", "interval"],
    report.intervals.map((interval) => [
      interval.id,
      interval.moveId,
      interval.population,
      interval.metric,
      interval.numerator,
      interval.denominator,
      interval.estimate ?? "",
      canonicalJson(interval.interval),
    ]),
  );
  section(
    "effect-sizes",
    [
      "id",
      "moveId",
      "metric",
      "baselinePopulation",
      "comparisonPopulation",
      "estimate",
      "interval",
      "pValue",
      "adjustedPValue",
      "exploratoryFlag",
      "rationale",
    ],
    report.effectSizes.map((effect) => [
      effect.id,
      effect.moveId,
      effect.metric,
      effect.baselinePopulation,
      effect.comparisonPopulation,
      effect.estimate ?? "",
      canonicalJson(effect.interval),
      effect.pValue ?? "",
      effect.adjustedPValue ?? "",
      effect.exploratoryFlag ?? "",
      effect.rationale,
    ]),
  );
  section(
    "paired-effects",
    ["id", "moveId", "population", "metric", "completedPairs", "estimate", "interval", "rationale"],
    report.pairedEffects.map((effect) => [
      effect.id,
      effect.moveId,
      effect.population,
      effect.metric,
      effect.completedPairs,
      effect.estimate ?? "",
      canonicalJson(effect.interval),
      effect.rationale,
    ]),
  );
  section(
    "multiple-comparison",
    ["identity", "pValue", "adjustedPValue", "exploratoryFlag"],
    report.multipleComparison.tests.map((test) => [
      test.identity,
      test.pValue,
      test.adjustedPValue,
      test.exploratoryFlag,
    ]),
  );
  section(
    "comparable-rationale",
    ["population", "algorithmVersion", "strata", "balanceUse", "rationale"],
    report.comparableRationale.map((value) => [
      value.population,
      value.algorithmVersion,
      value.strata.join(";"),
      value.balanceUse,
      value.rationale,
    ]),
  );
  section(
    "representative-replay-seeds",
    ["id", "seeds"],
    Object.entries(report.representativeReplaySeeds).map(([id, seeds]) => [
      id,
      canonicalJson(seeds),
    ]),
  );
  section(
    "follow-up-targets",
    ["moveId"],
    report.followUpTargets.map((moveId) => [moveId]),
  );
  section(
    "errors",
    ["moveId", "runId", "type", "detail"],
    report.errors.map((error) => [error.moveId, error.runId, error.type, error.detail]),
  );
  return `${lines.join("\n")}\n`;
};

export const renderSimulationReportMarkdown = (report: SimulationReport): string => {
  const header = `# ${report.title}\n\nFreshness hash: \`${report.freshnessHash}\`\n\nErrors: ${report.errors.length}\n\n`;
  const rows = report.rows.map((row) =>
    report.columns.map((column) => String(row.values[column] ?? "")),
  );
  const widths = report.columns.map((column, index) =>
    Math.max(3, column.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const lineFor = (values: readonly string[]): string =>
    `| ${values.map((value, index) => value.padEnd(widths[index]!)).join(" | ")} |`;
  const table = [
    lineFor(report.columns),
    lineFor(widths.map((width) => "-".repeat(width))),
    ...rows.map(lineFor),
  ];
  const errorSection =
    report.errors.length === 0
      ? ""
      : `\n\n## Errors\n\n${report.errors
          .map((error) => `- ${error.moveId} — ${error.runId} — ${error.type}: ${error.detail}`)
          .join("\n")}\n`;
  const jsonSection = (title: string, value: unknown): string =>
    `\n\n## ${title}\n\n\`\`\`json\n${canonicalJson(value)}\n\`\`\``;
  return `${header}${table.join("\n")}${jsonSection("Manifest", {
    schemaVersion: report.schemaVersion,
    reportId: report.reportId,
    generatedFrom: report.generatedFrom,
    manifest: report.manifest,
    freshnessHash: report.freshnessHash,
  })}${jsonSection("Combat metrics", report.metricsByMove)}${jsonSection("Stratified accumulators", report.stratifiedAccumulators)}${jsonSection("Intervals", report.intervals)}${jsonSection("Effect sizes", report.effectSizes)}${jsonSection("Paired effects", report.pairedEffects)}${jsonSection("Multiple-comparison adjustment", report.multipleComparison)}${jsonSection("Comparable rationale", report.comparableRationale)}${jsonSection("Representative replay seeds", report.representativeReplaySeeds)}${jsonSection("Follow-up targets", report.followUpTargets)}${errorSection}`;
};
