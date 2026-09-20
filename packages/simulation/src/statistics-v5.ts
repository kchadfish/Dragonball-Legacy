import { z } from "zod";

import { canonicalHash, canonicalJson } from "./canonical.js";
import {
  runSimulationStatisticsCatalogV4,
  validateSimulationV4CatalogCheckpoint,
  type SimulationV4CatalogCheckpoint,
  type SimulationV4CatalogRunnerOptions,
} from "./catalog-v4-runner.js";
import {
  detectSimulationAnomalies,
  readSimulationAnomalyFinding,
  simulationAnomalyFindingSchema,
  type SimulationAnomalyFinding,
} from "./anomalies.js";
import {
  analyzeSimulationSequences,
  simulationSequenceForResult,
  type SimulationSequenceEdge,
} from "./sequences.js";
import {
  readSimulationStatisticsArtifactV4,
  mergeSimulationMetricAggregatesV2,
  simulationMetricAggregateV2Schema,
  type SimulationMetricAggregateV2,
  type SimulationStatisticsEvidenceRole,
  type SimulationStatisticsArtifactV4,
} from "./statistics-v4.js";

export const SIMULATION_STATISTICS_BACKFILL_CHECKPOINT_VERSION =
  "simulation-statistics-backfill-checkpoint:v1" as const;
export const SIMULATION_STATISTICS_ARTIFACT_V5_VERSION =
  "simulation-statistics-artifact:v5" as const;
export const SIMULATION_EXPANDED_METRIC_DEFINITION_VERSION =
  "simulation-expanded-metrics:v1" as const;

export const SIMULATION_EXPANDED_METRIC_IDS = Object.freeze([
  "simulation:status-application-rate",
  "simulation:status-removal-rate",
  "simulation:status-uptime",
  "simulation:status-lockout-rate",
  "simulation:restricted-use-availability",
  "simulation:restricted-use-consumption-rate",
  "simulation:restricted-use-denial-rate",
  "simulation:self-damage",
  "simulation:healing",
  "simulation:net-hp-swing",
  "simulation:action-skip-rate",
  "simulation:stalemate-rate",
  "simulation:error-rate",
  "simulation:incomplete-fight-rate",
  "simulation:windowed-setup-conversion",
  "simulation:compatible-follow-up-rate",
] as const);

export type SimulationStatisticsCollectorName = "metrics" | "sequences" | "anomalies";

export interface SimulationStatisticsBackfillManifestV1 {
  readonly mechanicsIdentity: string;
  readonly mechanicsVersion: string;
  readonly rootSeed: number;
  readonly fixedTime: string;
  readonly aiProfile: Readonly<{ readonly id: string; readonly version: string }>;
  readonly templateCatalogIdentity: string;
  readonly scenarioCatalogIdentity: string;
  readonly seedScheduleIdentity: string;
  readonly evidenceRole: SimulationStatisticsEvidenceRole;
  readonly targetPairs: number;
  readonly workers: number;
  readonly maximumInFlight: number;
  readonly checkpointEveryPairs: number;
  readonly metricDefinitionIds: readonly string[];
  readonly collectors: readonly SimulationStatisticsCollectorName[];
}

export interface SimulationStatisticsBackfillCellV1 {
  readonly cellId: string;
  readonly templateAId: string;
  readonly templateBId: string;
  readonly pairIdentities: readonly string[];
  readonly collectorCompletion: Readonly<
    Record<SimulationStatisticsCollectorName, readonly string[]>
  >;
  readonly failures: readonly string[];
  readonly disposition: "selected" | "never-eligible" | "not-applicable";
}

export interface SimulationSequenceAggregateV1 extends SimulationSequenceEdge {
  readonly dimensions: Readonly<{
    readonly evidenceRole: string;
    readonly population: string;
  }>;
  readonly representativeReplaySeeds: readonly number[];
}

export interface SimulationStatisticsBackfillCheckpointV1 {
  readonly schemaVersion: typeof SIMULATION_STATISTICS_BACKFILL_CHECKPOINT_VERSION;
  readonly baseline: Readonly<{
    readonly checkpointHash: string;
    readonly artifactHash: string;
    readonly sha256?: string;
  }>;
  readonly quarantinedEvidence: readonly Readonly<{
    readonly checkpointHash: string;
    readonly sha256?: string;
    readonly role: "noncanonical-seed-compatibility";
  }>[];
  readonly manifest: SimulationStatisticsBackfillManifestV1;
  readonly manifestHash: string;
  readonly cells: readonly SimulationStatisticsBackfillCellV1[];
  readonly partialMetrics: Readonly<Record<string, SimulationMetricAggregateV2>>;
  readonly sequences: readonly SimulationSequenceAggregateV1[];
  readonly anomalyFindings: readonly SimulationAnomalyFinding[];
  readonly executionCheckpoint?: SimulationV4CatalogCheckpoint;
  readonly checkpointHash: string;
}

export interface SimulationMetricLineageV1 {
  readonly metricId: string;
  readonly definitionVersion: string;
  readonly evidenceSourceHash: string;
  readonly evidenceRole: "natural-balance" | "controlled" | "diagnostic";
  readonly actualSampleSize: number;
  readonly historicalProvenance: "known" | "unknown";
  readonly observationIdentities: readonly string[];
}

export interface SimulationStatisticsArtifactV5 {
  readonly schemaVersion: typeof SIMULATION_STATISTICS_ARTIFACT_V5_VERSION;
  readonly generatedFrom: SimulationStatisticsBackfillManifestV1;
  readonly evidenceSources: readonly Readonly<{
    readonly role: "baseline" | "expanded-backfill";
    readonly hash: string;
    readonly evidenceRole: "natural-balance" | "controlled" | "diagnostic";
  }>[];
  readonly metrics: Readonly<Record<string, SimulationMetricAggregateV2>>;
  readonly metricLineage: Readonly<Record<string, SimulationMetricLineageV1>>;
  readonly sequences: readonly SimulationSequenceAggregateV1[];
  readonly anomalies: readonly SimulationAnomalyFinding[];
  readonly limitations: readonly string[];
  readonly artifactHash: string;
}

const collectorSchema = z.enum(["metrics", "sequences", "anomalies"]);
const stringArray = z.array(z.string().min(1));
const manifestSchema = z
  .object({
    mechanicsIdentity: z.string().min(1),
    mechanicsVersion: z.string().min(1),
    rootSeed: z.number().int().nonnegative().max(4_294_967_295),
    fixedTime: z.iso.datetime({ offset: true }),
    aiProfile: z.object({ id: z.string().min(1), version: z.string().min(1) }).strict(),
    templateCatalogIdentity: z.string().min(1),
    scenarioCatalogIdentity: z.string().min(1),
    seedScheduleIdentity: z.string().min(1),
    evidenceRole: z.enum(["natural-balance", "controlled", "diagnostic"]),
    targetPairs: z.number().int().positive().max(400),
    workers: z.number().int().positive(),
    maximumInFlight: z.number().int().positive().max(8),
    checkpointEveryPairs: z.number().int().positive(),
    metricDefinitionIds: stringArray,
    collectors: z.array(collectorSchema).min(1),
  })
  .strict();
const cellSchema = z
  .object({
    cellId: z.string().min(1),
    templateAId: z.string().min(1),
    templateBId: z.string().min(1),
    pairIdentities: stringArray,
    collectorCompletion: z
      .object({ metrics: stringArray, sequences: stringArray, anomalies: stringArray })
      .strict(),
    failures: stringArray,
    disposition: z.enum(["selected", "never-eligible", "not-applicable"]),
  })
  .strict();
const sequenceSchema = z.custom<SimulationSequenceAggregateV1>(
  (value) => typeof value === "object" && value !== null,
);
const anomalySchema = simulationAnomalyFindingSchema;

export const simulationStatisticsBackfillCheckpointV1Schema = z
  .object({
    schemaVersion: z.literal(SIMULATION_STATISTICS_BACKFILL_CHECKPOINT_VERSION),
    baseline: z
      .object({
        checkpointHash: z.string().min(1),
        artifactHash: z.string().min(1),
        sha256: z.string().min(1).optional(),
      })
      .strict(),
    quarantinedEvidence: z.array(
      z
        .object({
          checkpointHash: z.string().min(1),
          sha256: z.string().min(1).optional(),
          role: z.literal("noncanonical-seed-compatibility"),
        })
        .strict(),
    ),
    manifest: manifestSchema,
    manifestHash: z.string().min(1),
    cells: z.array(cellSchema),
    partialMetrics: z.record(z.string().min(1), simulationMetricAggregateV2Schema),
    sequences: z.array(sequenceSchema),
    anomalyFindings: z.array(anomalySchema),
    executionCheckpoint: z
      .custom<SimulationV4CatalogCheckpoint>(
        (value) =>
          typeof value === "object" &&
          value !== null &&
          validateSimulationV4CatalogCheckpoint(value as SimulationV4CatalogCheckpoint).length ===
            0,
      )
      .optional(),
    checkpointHash: z.string().min(1),
  })
  .strict();

const lineageSchema = z
  .object({
    metricId: z.string().min(1),
    definitionVersion: z.string().min(1),
    evidenceSourceHash: z.string().min(1),
    evidenceRole: z.enum(["natural-balance", "controlled", "diagnostic"]),
    actualSampleSize: z.number().int().nonnegative(),
    historicalProvenance: z.enum(["known", "unknown"]),
    observationIdentities: stringArray,
  })
  .strict();

export const simulationStatisticsArtifactV5Schema = z
  .object({
    schemaVersion: z.literal(SIMULATION_STATISTICS_ARTIFACT_V5_VERSION),
    generatedFrom: manifestSchema,
    evidenceSources: z.array(
      z
        .object({
          role: z.enum(["baseline", "expanded-backfill"]),
          hash: z.string().min(1),
          evidenceRole: z.enum(["natural-balance", "controlled", "diagnostic"]),
        })
        .strict(),
    ),
    metrics: z.record(z.string().min(1), simulationMetricAggregateV2Schema),
    metricLineage: z.record(z.string().min(1), lineageSchema),
    sequences: z.array(sequenceSchema),
    anomalies: z.array(anomalySchema),
    limitations: stringArray,
    artifactHash: z.string().min(1),
  })
  .strict();

const withoutHash = <
  T extends { readonly checkpointHash?: string; readonly artifactHash?: string },
>(
  value: T,
): Record<string, unknown> => {
  const result = { ...value } as Record<string, unknown>;
  delete result.checkpointHash;
  delete result.artifactHash;
  return result;
};

const sortedUnique = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));

const pairIdentity = (cellId: string, iteration: number, mirror: "original" | "mirrored"): string =>
  `${cellId}:${iteration}:${mirror}`;

const createBackfillCheckpoint = (
  input: Omit<
    SimulationStatisticsBackfillCheckpointV1,
    "schemaVersion" | "manifestHash" | "checkpointHash"
  >,
): SimulationStatisticsBackfillCheckpointV1 => {
  const value = {
    schemaVersion: SIMULATION_STATISTICS_BACKFILL_CHECKPOINT_VERSION,
    ...input,
    manifestHash: canonicalHash(input.manifest),
  };
  return simulationStatisticsBackfillCheckpointV1Schema.parse({
    ...value,
    checkpointHash: canonicalHash(value),
  });
};

export const readSimulationStatisticsBackfillCheckpointV1 = (
  input: unknown,
): SimulationStatisticsBackfillCheckpointV1 => {
  const checkpoint = simulationStatisticsBackfillCheckpointV1Schema.parse(input);
  if (checkpoint.manifestHash !== canonicalHash(checkpoint.manifest))
    throw new RangeError("Simulation statistics backfill manifest hash mismatch.");
  if (checkpoint.checkpointHash !== canonicalHash(withoutHash(checkpoint)))
    throw new RangeError("Simulation statistics backfill checkpoint hash mismatch.");
  for (const [key, metric] of Object.entries(checkpoint.partialMetrics)) {
    const value = { ...metric } as Record<string, unknown>;
    delete value.metricHash;
    if (metric.metricHash !== canonicalHash(value))
      throw new RangeError(`Simulation backfill metric hash mismatch: ${key}.`);
  }
  for (const finding of checkpoint.anomalyFindings) readSimulationAnomalyFinding(finding);
  return checkpoint;
};

export const planSimulationStatisticsBackfill = (
  baseline: SimulationV4CatalogCheckpoint,
  options: Readonly<{
    readonly targetPairs?: number;
    readonly workers?: number;
    readonly baselineSha256?: string;
    readonly quarantinedCheckpoint?: Readonly<{
      readonly checkpointHash: string;
      readonly sha256?: string;
    }>;
  }> = {},
): SimulationStatisticsBackfillCheckpointV1 => {
  const issues = validateSimulationV4CatalogCheckpoint(baseline);
  if (issues.length > 0) throw new RangeError(`Invalid baseline checkpoint: ${issues.join(", ")}.`);
  const targetPairs = options.targetPairs ?? 100;
  const selected = baseline.cells.filter((cell) => cell.sparseStatus === "sufficient");
  if (selected.length === 0) throw new RangeError("Baseline contains no evidence-bearing cells.");
  const evidenceRole = baseline.manifest.evidenceRoles[0] ?? "natural-balance";
  const manifest: SimulationStatisticsBackfillManifestV1 = {
    mechanicsIdentity: baseline.manifest.mechanics.identity,
    mechanicsVersion: baseline.manifest.mechanics.version,
    rootSeed: baseline.manifest.rootSeed,
    fixedTime: baseline.manifest.fixedTime,
    aiProfile: baseline.manifest.aiProfile,
    templateCatalogIdentity: baseline.manifest.templateCatalogIdentity,
    scenarioCatalogIdentity: baseline.manifest.scenarioCatalogIdentity,
    seedScheduleIdentity: baseline.manifest.seedScheduleIdentity,
    evidenceRole,
    targetPairs,
    workers: options.workers ?? 4,
    maximumInFlight: 8,
    checkpointEveryPairs: 5,
    metricDefinitionIds: [...SIMULATION_EXPANDED_METRIC_IDS],
    collectors: ["metrics", "sequences", "anomalies"],
  };
  return createBackfillCheckpoint({
    baseline: {
      checkpointHash: baseline.checkpointHash,
      artifactHash: baseline.artifact.artifactHash,
      ...(options.baselineSha256 === undefined ? {} : { sha256: options.baselineSha256 }),
    },
    quarantinedEvidence:
      options.quarantinedCheckpoint === undefined
        ? []
        : [{ ...options.quarantinedCheckpoint, role: "noncanonical-seed-compatibility" }],
    manifest,
    cells: selected
      .map((cell) => ({
        cellId: cell.cellId,
        templateAId: cell.templateAId,
        templateBId: cell.templateBId,
        pairIdentities: [],
        collectorCompletion: { metrics: [], sequences: [], anomalies: [] },
        failures: [],
        disposition: "selected" as const,
      }))
      .sort((left, right) => left.cellId.localeCompare(right.cellId)),
    partialMetrics: {},
    sequences: [],
    anomalyFindings: [],
  });
};

const actualSampleSize = (metric: SimulationMetricAggregateV2): number =>
  metric.unit === "proportion" ? metric.denominators.eligible : metric.values.count;

export const composeSimulationStatisticsArtifactV5 = (input: {
  readonly baseline: SimulationStatisticsArtifactV4;
  readonly backfill: SimulationStatisticsBackfillCheckpointV1;
}): SimulationStatisticsArtifactV5 => {
  const baseline = readSimulationStatisticsArtifactV4(input.baseline);
  const backfill = readSimulationStatisticsBackfillCheckpointV1(input.backfill);
  if (backfill.baseline.artifactHash !== baseline.artifactHash)
    throw new RangeError("Backfill baseline artifact hash mismatch.");
  if (
    baseline.generatedFrom.mechanicsIdentity !== backfill.manifest.mechanicsIdentity ||
    baseline.generatedFrom.rootSeed !== backfill.manifest.rootSeed ||
    baseline.generatedFrom.evidenceRole !== backfill.manifest.evidenceRole
  )
    throw new RangeError("Baseline and backfill evidence identities are incompatible.");
  const metrics: Record<string, SimulationMetricAggregateV2> = { ...baseline.metrics };
  const expandedKeys = new Set<string>();
  const optionalMetrics = metrics as Partial<Record<string, SimulationMetricAggregateV2>>;
  for (const [key, metric] of Object.entries(backfill.partialMetrics)) {
    const prior = optionalMetrics[key];
    const targetKey =
      prior === undefined ? key : `${key}@${SIMULATION_EXPANDED_METRIC_DEFINITION_VERSION}`;
    const existing = optionalMetrics[targetKey];
    if (existing !== undefined && existing.metricHash !== metric.metricHash)
      throw new RangeError(`Overlapping non-identical metric observations: ${targetKey}.`);
    metrics[targetKey] = metric;
    expandedKeys.add(targetKey);
  }
  const completedIdentities = sortedUnique(
    backfill.cells.flatMap((cell) => cell.collectorCompletion.metrics),
  );
  const metricLineage = Object.fromEntries(
    Object.entries(metrics)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, metric]) => {
        const expanded = expandedKeys.has(key);
        return [
          key,
          {
            metricId: metric.metricId,
            definitionVersion: expanded
              ? SIMULATION_EXPANDED_METRIC_DEFINITION_VERSION
              : "simulation-metrics:legacy-v4",
            evidenceSourceHash: expanded ? backfill.checkpointHash : baseline.artifactHash,
            evidenceRole: backfill.manifest.evidenceRole,
            actualSampleSize: actualSampleSize(metric),
            historicalProvenance: expanded ? "known" : "unknown",
            observationIdentities: expanded ? completedIdentities : [],
          } satisfies SimulationMetricLineageV1,
        ];
      }),
  );
  const value = {
    schemaVersion: SIMULATION_STATISTICS_ARTIFACT_V5_VERSION,
    generatedFrom: backfill.manifest,
    evidenceSources: [
      {
        role: "baseline" as const,
        hash: baseline.artifactHash,
        evidenceRole: baseline.generatedFrom.evidenceRole,
      },
      {
        role: "expanded-backfill" as const,
        hash: backfill.checkpointHash,
        evidenceRole: backfill.manifest.evidenceRole,
      },
    ],
    metrics: Object.fromEntries(
      Object.entries(metrics).sort(([left], [right]) => left.localeCompare(right)),
    ),
    metricLineage,
    sequences: backfill.sequences,
    anomalies: backfill.anomalyFindings,
    limitations: sortedUnique([
      ...baseline.generatedFrom.sourceLimitations,
      "Historical v4 metric provenance unavailable from the compact checkpoint is marked unknown.",
      "This confirmation artifact covers only baseline evidence-bearing cells.",
    ]),
  };
  return simulationStatisticsArtifactV5Schema.parse({
    ...value,
    artifactHash: canonicalHash(value),
  });
};

export const readSimulationStatisticsArtifactV5 = (
  input: unknown,
): SimulationStatisticsArtifactV5 => {
  const artifact = simulationStatisticsArtifactV5Schema.parse(input);
  if (artifact.artifactHash !== canonicalHash(withoutHash(artifact)))
    throw new RangeError("Simulation statistics v5 artifact hash mismatch.");
  for (const [key, metric] of Object.entries(artifact.metrics)) {
    const metricValue = { ...metric } as Record<string, unknown>;
    delete metricValue.metricHash;
    if (metric.metricHash !== canonicalHash(metricValue))
      throw new RangeError(`Simulation metric hash mismatch: ${key}.`);
  }
  for (const finding of artifact.anomalies) readSimulationAnomalyFinding(finding);
  return artifact;
};

export const mergeSimulationStatisticsArtifactsV5 = (
  leftInput: SimulationStatisticsArtifactV5,
  rightInput: SimulationStatisticsArtifactV5,
  // eslint-disable-next-line sonarjs/cognitive-complexity, complexity
): SimulationStatisticsArtifactV5 => {
  const left = readSimulationStatisticsArtifactV5(leftInput);
  const right = readSimulationStatisticsArtifactV5(rightInput);
  for (const key of [
    "mechanicsIdentity",
    "mechanicsVersion",
    "rootSeed",
    "fixedTime",
    "aiProfile",
    "templateCatalogIdentity",
    "scenarioCatalogIdentity",
    "seedScheduleIdentity",
    "evidenceRole",
  ] as const)
    if (canonicalHash(left.generatedFrom[key]) !== canonicalHash(right.generatedFrom[key]))
      throw new RangeError(`Statistics v5 manifest mismatch: ${key}.`);
  const metrics: Partial<Record<string, SimulationMetricAggregateV2>> = { ...left.metrics };
  const lineage: Partial<Record<string, SimulationMetricLineageV1>> = { ...left.metricLineage };
  const rightLineage = right.metricLineage as Partial<Record<string, SimulationMetricLineageV1>>;
  for (const [key, metric] of Object.entries(right.metrics)) {
    const prior = metrics[key];
    const priorLineage = lineage[key];
    const nextLineage = rightLineage[key];
    if (prior === undefined || priorLineage === undefined || nextLineage === undefined) {
      metrics[key] = metric;
      if (nextLineage !== undefined) lineage[key] = nextLineage;
      continue;
    }
    if (priorLineage.definitionVersion !== nextLineage.definitionVersion)
      throw new RangeError(`Metric definition version conflict: ${key}.`);
    const priorIds = new Set(priorLineage.observationIdentities);
    const nextIds = new Set(nextLineage.observationIdentities);
    const overlap = [...priorIds].filter((identity) => nextIds.has(identity));
    const exactDuplicate =
      overlap.length > 0 &&
      priorIds.size === nextIds.size &&
      overlap.length === priorIds.size &&
      prior.metricHash === metric.metricHash;
    if (overlap.length > 0 && !exactDuplicate)
      throw new RangeError(`Overlapping metric observations: ${key}.`);
    if (exactDuplicate) continue;
    if (priorIds.size === 0 || nextIds.size === 0)
      throw new RangeError(`Cannot prove non-overlap for metric observations: ${key}.`);
    metrics[key] = mergeSimulationMetricAggregatesV2(prior, metric);
    lineage[key] = {
      ...priorLineage,
      evidenceSourceHash: canonicalHash([
        priorLineage.evidenceSourceHash,
        nextLineage.evidenceSourceHash,
      ]),
      actualSampleSize: priorLineage.actualSampleSize + nextLineage.actualSampleSize,
      observationIdentities: sortedUnique([
        ...priorLineage.observationIdentities,
        ...nextLineage.observationIdentities,
      ]),
      historicalProvenance:
        priorLineage.historicalProvenance === "known" &&
        nextLineage.historicalProvenance === "known"
          ? "known"
          : "unknown",
    };
  }
  const value = {
    schemaVersion: SIMULATION_STATISTICS_ARTIFACT_V5_VERSION,
    generatedFrom: {
      ...left.generatedFrom,
      targetPairs: Math.max(left.generatedFrom.targetPairs, right.generatedFrom.targetPairs),
    },
    evidenceSources: [
      ...new Map(
        [...left.evidenceSources, ...right.evidenceSources].map((source) => [
          `${source.role}:${source.hash}`,
          source,
        ]),
      ).values(),
    ].sort((a, b) => `${a.role}:${a.hash}`.localeCompare(`${b.role}:${b.hash}`)),
    metrics: Object.fromEntries(Object.entries(metrics).sort(([a], [b]) => a.localeCompare(b))),
    metricLineage: Object.fromEntries(
      Object.entries(lineage).sort(([a], [b]) => a.localeCompare(b)),
    ),
    sequences: [...left.sequences, ...right.sequences]
      .sort((a, b) => canonicalHash(a).localeCompare(canonicalHash(b)))
      .filter(
        (sequence, index, values) =>
          index === 0 || canonicalHash(sequence) !== canonicalHash(values[index - 1]),
      ),
    anomalies: [
      ...new Map(
        [...left.anomalies, ...right.anomalies].map((finding) => [finding.findingHash, finding]),
      ).values(),
    ].sort((a, b) => a.findingHash.localeCompare(b.findingHash)),
    limitations: sortedUnique([...left.limitations, ...right.limitations]),
  };
  return simulationStatisticsArtifactV5Schema.parse({
    ...value,
    artifactHash: canonicalHash(value),
  });
};

export const migrateSimulationStatisticsArtifactV4ToV5 = (
  baseline: SimulationStatisticsArtifactV4,
): SimulationStatisticsArtifactV5 => {
  const artifact = readSimulationStatisticsArtifactV4(baseline);
  const manifest: SimulationStatisticsBackfillManifestV1 = {
    mechanicsIdentity: artifact.generatedFrom.mechanicsIdentity,
    mechanicsVersion: artifact.generatedFrom.provenance?.combatEngineVersion ?? "unknown",
    rootSeed: artifact.generatedFrom.rootSeed,
    fixedTime: artifact.generatedFrom.provenance?.fixedTime ?? "1970-01-01T00:00:00.000Z",
    aiProfile: artifact.generatedFrom.provenance?.aiProfile ?? {
      id: "unknown",
      version: "unknown",
    },
    templateCatalogIdentity:
      artifact.generatedFrom.provenance?.templateCatalogIdentity ?? "unknown",
    scenarioCatalogIdentity:
      artifact.generatedFrom.provenance?.scenarioCatalogIdentity ?? "unknown",
    seedScheduleIdentity: artifact.generatedFrom.provenance?.seedScheduleIdentity ?? "unknown",
    evidenceRole: artifact.generatedFrom.evidenceRole,
    targetPairs: artifact.generatedFrom.targetPairs,
    workers: 1,
    maximumInFlight: 1,
    checkpointEveryPairs: 1,
    metricDefinitionIds: [],
    collectors: ["metrics"],
  };
  const metricLineage = Object.fromEntries(
    Object.entries(artifact.metrics).map(([key, metric]) => [
      key,
      {
        metricId: metric.metricId,
        definitionVersion: "simulation-metrics:legacy-v4",
        evidenceSourceHash: artifact.artifactHash,
        evidenceRole: artifact.generatedFrom.evidenceRole,
        actualSampleSize: actualSampleSize(metric),
        historicalProvenance: "unknown" as const,
        observationIdentities: [],
      },
    ]),
  );
  const value = {
    schemaVersion: SIMULATION_STATISTICS_ARTIFACT_V5_VERSION,
    generatedFrom: manifest,
    evidenceSources: [
      {
        role: "baseline" as const,
        hash: artifact.artifactHash,
        evidenceRole: artifact.generatedFrom.evidenceRole,
      },
    ],
    metrics: artifact.metrics,
    metricLineage,
    sequences: [],
    anomalies: [],
    limitations: sortedUnique([
      ...artifact.generatedFrom.sourceLimitations,
      "Expanded metrics, sequences, and anomalies were unavailable in the v4 source.",
      "Unavailable historical provenance is unknown.",
    ]),
  };
  return simulationStatisticsArtifactV5Schema.parse({
    ...value,
    artifactHash: canonicalHash(value),
  });
};

export const validateSimulationStatisticsArtifactV5Closure = (
  artifact: SimulationStatisticsArtifactV5,
  checkpoint: SimulationStatisticsBackfillCheckpointV1,
  // eslint-disable-next-line sonarjs/cognitive-complexity
): readonly string[] => {
  const issues: string[] = [];
  try {
    readSimulationStatisticsArtifactV5(artifact);
    readSimulationStatisticsBackfillCheckpointV1(checkpoint);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  for (const cell of checkpoint.cells) {
    if (cell.disposition !== "selected") continue;
    if (cell.failures.length > 0) issues.push(`${cell.cellId} has unresolved failures`);
    const expected = checkpoint.manifest.targetPairs * 2;
    for (const collector of checkpoint.manifest.collectors)
      if (cell.collectorCompletion[collector].length !== expected)
        issues.push(`${cell.cellId} has incomplete ${collector} collection`);
  }
  for (const definitionId of checkpoint.manifest.metricDefinitionIds) {
    const matching = Object.entries(artifact.metricLineage).filter(
      ([, lineage]) => lineage.metricId === definitionId,
    );
    if (matching.length === 0) issues.push(`missing active metric lineage: ${definitionId}`);
  }
  return issues;
};

export const runSimulationStatisticsBackfill = (input: {
  readonly baseline: SimulationV4CatalogCheckpoint;
  readonly checkpoint?: SimulationStatisticsBackfillCheckpointV1;
  readonly workers?: number;
  readonly onCheckpoint?: (checkpoint: SimulationStatisticsBackfillCheckpointV1) => void;
  readonly onProgress?: NonNullable<SimulationV4CatalogRunnerOptions["onProgress"]>;
}): Readonly<{
  readonly checkpoint: SimulationStatisticsBackfillCheckpointV1;
  readonly artifact: SimulationStatisticsArtifactV5;
}> => {
  let checkpoint = input.checkpoint ?? planSimulationStatisticsBackfill(input.baseline, input);
  checkpoint = readSimulationStatisticsBackfillCheckpointV1(checkpoint);
  if (
    checkpoint.baseline.checkpointHash !== input.baseline.checkpointHash ||
    checkpoint.baseline.artifactHash !== input.baseline.artifact.artifactHash
  )
    throw new RangeError("Backfill resume baseline identity mismatch.");
  const sequences = [] as NonNullable<ReturnType<typeof simulationSequenceForResult>>[];
  const findings: SimulationAnomalyFinding[] = [];
  const observationsByCell = new Map<string, Set<string>>();
  for (const cell of checkpoint.cells)
    observationsByCell.set(cell.cellId, new Set(cell.pairIdentities));
  const checkpointFromExecution = (
    executionCheckpoint: SimulationV4CatalogCheckpoint,
  ): SimulationStatisticsBackfillCheckpointV1 => {
    const sequenceEdges = [
      ...analyzeSimulationSequences(sequences, 2),
      ...analyzeSimulationSequences(sequences, 3),
    ].map((edge) => ({
      ...edge,
      dimensions: {
        evidenceRole: checkpoint.manifest.evidenceRole,
        population: "selected-cells",
      },
      representativeReplaySeeds: sortedUnique(sequences.map((sequence) => sequence.sequenceId))
        .map((id) => Number.parseInt(canonicalHash(id).slice(-8), 16) >>> 0)
        .slice(0, 8),
    }));
    return createBackfillCheckpoint({
      baseline: checkpoint.baseline,
      quarantinedEvidence: checkpoint.quarantinedEvidence,
      manifest: checkpoint.manifest,
      cells: checkpoint.cells.map((cell) => {
        const identities = sortedUnique([...(observationsByCell.get(cell.cellId) ?? [])]);
        const failures =
          executionCheckpoint.cells.find((candidate) => candidate.cellId === cell.cellId)
            ?.failures ?? cell.failures;
        return {
          ...cell,
          pairIdentities: identities,
          collectorCompletion: {
            metrics: identities,
            sequences: identities,
            anomalies: identities,
          },
          failures,
        };
      }),
      partialMetrics: Object.fromEntries(
        Object.entries(executionCheckpoint.artifact.metrics).filter(([, metric]) =>
          checkpoint.manifest.metricDefinitionIds.includes(metric.metricId),
        ),
      ),
      sequences: sequenceEdges.length === 0 ? checkpoint.sequences : sequenceEdges,
      anomalyFindings: [
        ...new Map(
          [...checkpoint.anomalyFindings, ...findings].map((finding) => [
            finding.findingHash,
            finding,
          ]),
        ).values(),
      ]
        .sort((left, right) => left.findingHash.localeCompare(right.findingHash))
        .slice(0, 100),
      executionCheckpoint,
    });
  };
  const result = runSimulationStatisticsCatalogV4({
    rootSeed: checkpoint.manifest.rootSeed,
    fixedTime: new Date(checkpoint.manifest.fixedTime),
    targetPairs: checkpoint.manifest.targetPairs,
    workers: input.workers ?? checkpoint.manifest.workers,
    batchSize: 4,
    schedule:
      checkpoint.manifest.evidenceRole === "natural-balance"
        ? "natural"
        : checkpoint.manifest.evidenceRole,
    selectedCellIds: checkpoint.cells.map((cell) => cell.cellId),
    metricDefinitionIds: checkpoint.manifest.metricDefinitionIds,
    collectors: checkpoint.manifest.collectors,
    resumeFrom: checkpoint.executionCheckpoint,
    onProgress: input.onProgress,
    onCheckpoint: (executionCheckpoint) => {
      checkpoint = checkpointFromExecution(executionCheckpoint);
      input.onCheckpoint?.(checkpoint);
    },
    onFightResult: (request, fightResult) => {
      const cell = checkpoint.cells.find(
        (candidate) =>
          candidate.templateAId === request.scenario.templateAId &&
          candidate.templateBId === request.scenario.templateBId,
      );
      if (cell === undefined) return;
      const identity = pairIdentity(
        cell.cellId,
        request.iteration ?? 0,
        request.mirror ?? "original",
      );
      const seen = observationsByCell.get(cell.cellId) ?? new Set<string>();
      if (seen.has(identity)) return;
      seen.add(identity);
      observationsByCell.set(cell.cellId, seen);
      const sequence = simulationSequenceForResult(fightResult);
      if (sequence !== undefined) sequences.push(sequence);
      findings.push(...detectSimulationAnomalies([fightResult]));
    },
  });
  checkpoint = checkpointFromExecution(result.checkpoint);
  input.onCheckpoint?.(checkpoint);
  return {
    checkpoint,
    artifact: composeSimulationStatisticsArtifactV5({
      baseline: input.baseline.artifact,
      backfill: checkpoint,
    }),
  };
};

const csvCell = (value: unknown): string => {
  const text = typeof value === "string" ? value : canonicalJson(value);
  return /[",\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const proportionValue = (metric: SimulationMetricAggregateV2): number | string =>
  metric.denominators.eligible === 0 ? "" : metric.successes / metric.denominators.eligible;

/** Normalized metric, sequence, and anomaly tables in one deterministic CSV stream. */
export const renderSimulationStatisticsArtifactV5Csv = (
  artifact: SimulationStatisticsArtifactV5,
): string => {
  const rows: unknown[][] = [
    [
      "recordType",
      "identity",
      "metricOrPattern",
      "sampleSize",
      "value",
      "evidenceRole",
      "definitionVersion",
    ],
  ];
  for (const [key, metric] of Object.entries(artifact.metrics).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const lineage = artifact.metricLineage[key];
    rows.push([
      "metric",
      key,
      metric.metricId,
      lineage?.actualSampleSize ?? 0,
      metric.unit === "proportion" ? proportionValue(metric) : metric.values.mean,
      lineage?.evidenceRole ?? artifact.generatedFrom.evidenceRole,
      lineage?.definitionVersion ?? "unknown",
    ]);
  }
  for (const sequence of artifact.sequences)
    rows.push([
      "sequence",
      canonicalHash(sequence.pattern),
      sequence.pattern.join(" > "),
      sequence.sequenceCount,
      sequence.conversionRate,
      sequence.dimensions.evidenceRole,
      "simulation-sequences:v1",
    ]);
  for (const anomaly of artifact.anomalies)
    rows.push([
      "anomaly",
      anomaly.findingHash,
      anomaly.code,
      anomaly.sampleCount,
      anomaly.observedValue,
      artifact.generatedFrom.evidenceRole,
      "simulation-anomaly-rules:v1",
    ]);
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
};

export const renderSimulationStatisticsArtifactV5Markdown = (
  artifact: SimulationStatisticsArtifactV5,
): string => {
  const expanded = Object.values(artifact.metricLineage).filter(
    (lineage) => lineage.definitionVersion === SIMULATION_EXPANDED_METRIC_DEFINITION_VERSION,
  );
  return [
    "# Simulation statistics confirmation",
    "",
    `Artifact hash: \`${artifact.artifactHash}\``,
    "",
    `Evidence role: **${artifact.generatedFrom.evidenceRole}**`,
    "",
    `Legacy metric rows: ${Object.keys(artifact.metricLineage).length - expanded.length}`,
    `Expanded metric rows: ${expanded.length}`,
    "",
    "## Sequences",
    "",
    ...(artifact.sequences.length === 0
      ? ["No retained sequence met the reporting boundary."]
      : artifact.sequences.map(
          (sequence) =>
            `- ${sequence.pattern.join(" → ")}: support ${sequence.support}, conversion ${sequence.conversionRate}, turns ${sequence.minTurnDistance}–${sequence.maxTurnDistance}`,
        )),
    "",
    "## Anomalies",
    "",
    ...(artifact.anomalies.length === 0
      ? ["No aggregate anomaly crossed its configured evidence threshold."]
      : artifact.anomalies.map(
          (finding) =>
            `- ${finding.code}: ${finding.observedValue} in ${finding.population}; investigate ${finding.investigationTarget}. This is not an automatic balance verdict.`,
        )),
    "",
    "## Limitations",
    "",
    ...artifact.limitations.map((limitation) => `- ${limitation}`),
    "",
  ].join("\n");
};

export const createSimulationStatisticsV5SourceDossiers = (
  artifact: SimulationStatisticsArtifactV5,
): Readonly<Record<string, readonly string[]>> => {
  const groups = new Map<string, string[]>();
  for (const [key, metric] of Object.entries(artifact.metrics)) {
    const source =
      metric.dimensions.moveId ??
      metric.dimensions.itemId ??
      metric.dimensions.transformationId ??
      metric.dimensions.statusId ??
      metric.dimensions.restrictedUseId ??
      "global";
    groups.set(source, [...(groups.get(source) ?? []), key]);
  }
  return Object.fromEntries(
    [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([source, keys]) => [source, sortedUnique(keys)]),
  );
};
