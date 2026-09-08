/* eslint-disable complexity, sonarjs/cognitive-complexity, sonarjs/no-nested-conditional -- The catalog runner is a deliberately explicit resumable boundary. */
import {
  CANONICAL_COMBAT_MECHANICS_VIEW,
  type CombatMechanicsView,
} from "@dragonball-resurgence/combat-engine";
import {
  HARD_PROFILE,
  NORMAL_PROFILE,
  SIMULATION_QUALITY_PROFILE,
  type AiProfile,
} from "@dragonball-resurgence/ai-engine";
import { z } from "zod";

import { runSimulationRequests, runSimulationRequestsWithWorkers } from "./coordinator.js";
import { canonicalHash } from "./canonical.js";
import {
  type SimulationFightExecutionResult,
  type SimulationFightRequest,
  type SimulationScenario,
  type SimulationProgress,
  type SimulationTemplate,
  SIMULATION_STATISTICS_REQUEST_VERSION,
  type SimulationStatisticsArmIdentity,
} from "./contracts.js";
import { SIMULATION_DEFAULT_LIMITS } from "./policy.js";
import { SIMULATION_SCOPE_VERSION } from "./scope.js";
import {
  SIMULATION_V4_CONTINUATION_CEILING,
  SIMULATION_V4_METRIC_DEFINITIONS,
  SIMULATION_V4_NOMINAL_TARGET_PAIRS,
  createSimulationStatisticsArtifactV4,
  createSimulationMetricAggregateV2,
  addSimulationMetricObservationV2,
  mergeSimulationMetricAggregatesV2,
  readSimulationStatisticsArtifactV4,
  setSimulationMetricEvidenceV2,
  type SimulationMetricAggregateV2,
  type SimulationStatisticsArtifactV4,
  simulationStatisticsDimensionKey,
} from "./statistics-v4.js";
import {
  createSimulationV4FightAccumulator,
  finalizeSimulationV4FightAccumulator,
  foldSimulationV4Transition,
} from "./v4-folding.js";
import { ALL_SIMULATION_TEMPLATES, TF1_SIMULATION_TEMPLATES } from "./templates.js";
import { simulationScenarioIdSchema, simulationVariantIdSchema } from "./ids.js";

export const SIMULATION_V4_SEED_SCHEDULE_VERSION = "simulation-v4-seed-schedule:v1" as const;

export type SimulationV4Schedule = "natural" | "controlled" | "diagnostic";
export const SIMULATION_V4_CHECKPOINT_VERSION = "simulation-statistics-checkpoint:v2" as const;
export const SIMULATION_V4_CATALOG_MANIFEST_VERSION = "simulation-statistics-manifest:v1" as const;

const evidenceRoleSchema = z.enum(["natural-balance", "controlled", "diagnostic"]);
const catalogCellSchema = z
  .object({
    cellId: z.string().min(1),
    templateAId: z.string().min(1),
    templateBId: z.string().min(1),
    completedBasePairs: z.number().int().nonnegative().max(SIMULATION_V4_CONTINUATION_CEILING),
    completedIterations: z.array(
      z
        .number()
        .int()
        .nonnegative()
        .max(SIMULATION_V4_CONTINUATION_CEILING - 1),
    ),
    completedMirrors: z.array(
      z
        .object({
          iteration: z
            .number()
            .int()
            .nonnegative()
            .max(SIMULATION_V4_CONTINUATION_CEILING - 1),
          mirrors: z.array(z.enum(["original", "mirrored"])),
        })
        .strict(),
    ),
    acceptedMirrorResults: z.record(z.string().min(1), z.unknown()),
    seedOffsets: z.record(z.string().min(1), z.string().min(1)),
    armIdentities: z.record(z.string().min(1), z.string().min(1)),
    pairedAggregates: z.record(z.string().min(1), z.string().min(1)),
    canonicalMergePosition: z.number().int().nonnegative(),
    nextIteration: z.number().int().nonnegative().max(SIMULATION_V4_CONTINUATION_CEILING),
    eligibilityDenominator: z.number().int().nonnegative(),
    executionDenominator: z.number().int().nonnegative(),
    continuationOffset: z.number().int().nonnegative().max(SIMULATION_V4_CONTINUATION_CEILING),
    sparseStatus: z.enum([
      "pending",
      "sufficient",
      "never-eligible",
      "eligible-never-selected",
      "insufficient",
    ]),
    failures: z.array(z.string().min(1)),
    replacementAttempts: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    const mirrorByIteration = new Map(
      value.completedMirrors.map((entry) => [entry.iteration, entry.mirrors]),
    );
    const duplicateIterations = new Set<number>();
    for (const entry of value.completedMirrors) {
      if (duplicateIterations.has(entry.iteration))
        context.addIssue({
          code: "custom",
          path: ["completedMirrors"],
          message: "Duplicate mirror iteration.",
        });
      duplicateIterations.add(entry.iteration);
      if (new Set(entry.mirrors).size !== entry.mirrors.length)
        context.addIssue({
          code: "custom",
          path: ["completedMirrors"],
          message: "Duplicate mirror identity.",
        });
    }
    for (const iteration of value.completedIterations) {
      if (
        !mirrorByIteration.get(iteration)?.includes("original") ||
        !mirrorByIteration.get(iteration)?.includes("mirrored")
      )
        context.addIssue({
          code: "custom",
          path: ["completedIterations"],
          message: "An iteration cannot be complete until both mirrors are retained.",
        });
    }
  });

export interface SimulationV4CatalogManifest {
  readonly schemaVersion: typeof SIMULATION_V4_CATALOG_MANIFEST_VERSION;
  readonly mechanics: Readonly<{ readonly version: string; readonly identity: string }>;
  readonly templateCatalogIdentity: string;
  readonly scenarioCatalogIdentity: string;
  readonly metricDictionaryIdentity: string;
  readonly seedScheduleIdentity: string;
  readonly scopeVersion: typeof SIMULATION_SCOPE_VERSION;
  readonly rootSeed: number;
  readonly fixedTime: string;
  readonly aiProfile: Readonly<{ readonly id: string; readonly version: string }>;
  readonly evidenceRoles: readonly z.infer<typeof evidenceRoleSchema>[];
  readonly requestedTargetPairs: number;
  readonly maximumPairs: typeof SIMULATION_V4_CONTINUATION_CEILING;
}

const manifestSchema = z
  .object({
    schemaVersion: z.literal(SIMULATION_V4_CATALOG_MANIFEST_VERSION),
    mechanics: z.object({ version: z.string().min(1), identity: z.string().min(1) }).strict(),
    templateCatalogIdentity: z.string().min(1),
    scenarioCatalogIdentity: z.string().min(1),
    metricDictionaryIdentity: z.string().min(1),
    seedScheduleIdentity: z.string().min(1),
    scopeVersion: z.literal(SIMULATION_SCOPE_VERSION),
    rootSeed: z.number().int().nonnegative().max(4_294_967_295),
    fixedTime: z.iso.datetime({ offset: true }),
    aiProfile: z.object({ id: z.string().min(1), version: z.string().min(1) }).strict(),
    evidenceRoles: z.array(evidenceRoleSchema).min(1),
    requestedTargetPairs: z.number().int().positive().max(SIMULATION_V4_CONTINUATION_CEILING),
    maximumPairs: z.literal(SIMULATION_V4_CONTINUATION_CEILING),
  })
  .strict();

export interface SimulationV4CatalogCheckpoint {
  readonly schemaVersion: typeof SIMULATION_V4_CHECKPOINT_VERSION;
  readonly manifest: SimulationV4CatalogManifest;
  readonly manifestHash: string;
  readonly cells: readonly z.infer<typeof catalogCellSchema>[];
  readonly batchCount: number;
  readonly canonicalResultOrderHash: string;
  readonly artifact: SimulationStatisticsArtifactV4;
  readonly checkpointHash: string;
}

export const simulationV4CatalogCheckpointSchema = z
  .object({
    schemaVersion: z.literal(SIMULATION_V4_CHECKPOINT_VERSION),
    manifest: manifestSchema,
    manifestHash: z.string().min(1),
    cells: z.array(catalogCellSchema),
    batchCount: z.number().int().nonnegative(),
    canonicalResultOrderHash: z.string().min(1),
    artifact: z.custom<SimulationStatisticsArtifactV4>((value) =>
      readSimulationStatisticsArtifactV4(value),
    ),
    checkpointHash: z.string().min(1),
  })
  .strict();

export type SimulationV4CatalogRunnerOptions = {
  readonly mechanicsView?: CombatMechanicsView;
  readonly templates?: readonly SimulationTemplate[];
  readonly catalogId?: string;
  readonly rootSeed?: number;
  readonly fixedTime?: Date;
  readonly aiProfile?: AiProfile;
  readonly targetPairs?: number;
  readonly batchSize?: number;
  readonly workers?: number;
  readonly resumeFrom?: SimulationV4CatalogCheckpoint;
  readonly onCheckpoint?: (checkpoint: SimulationV4CatalogCheckpoint) => void;
  readonly onProgress?: (progress: SimulationProgress) => void;
  readonly schedule?: "natural" | "controlled" | "diagnostic";
};

export interface SimulationV4CatalogRunnerResult {
  readonly artifact: SimulationStatisticsArtifactV4;
  readonly checkpoint: SimulationV4CatalogCheckpoint;
  readonly cells: readonly SimulationV4CatalogCheckpoint["cells"][number][];
  readonly batchCount: number;
  readonly completedBasePairs: number;
  readonly failedFights: number;
}

export type SimulationV4StatTarget = "hp" | "power" | "dexterity";

const SIMULATION_V4_STAT_TARGET_ORDER: readonly SimulationV4StatTarget[] = [
  "hp",
  "power",
  "dexterity",
];

/**
 * Returns the source allocation for a fixed-total arm. Ties intentionally use
 * the canonical HP, Power, Dexterity order rather than locale ordering.
 */
export const simulationV4TransferSourceFor = (
  template: SimulationTemplate,
  target: SimulationV4StatTarget,
): SimulationV4StatTarget | undefined =>
  SIMULATION_V4_STAT_TARGET_ORDER.filter((candidate) => candidate !== target)
    .filter((candidate) => template.specializationPointsDistribution[candidate] > 0)
    .sort(
      (left, right) =>
        template.specializationPointsDistribution[right] -
          template.specializationPointsDistribution[left] ||
        SIMULATION_V4_STAT_TARGET_ORDER.indexOf(left) -
          SIMULATION_V4_STAT_TARGET_ORDER.indexOf(right),
    )[0];

/** Creates a stable fixed-total allocation variant without inventing combat values. */
export const simulationV4StatArmTemplateFor = (
  template: SimulationTemplate,
  target: SimulationV4StatTarget,
): SimulationTemplate => {
  const source = simulationV4TransferSourceFor(template, target);
  if (source === undefined) return template;
  const distribution = {
    ...template.specializationPointsDistribution,
    [source]: template.specializationPointsDistribution[source] - 1,
    [target]: template.specializationPointsDistribution[target] + 1,
  };
  const statValueFor = (stat: SimulationV4StatTarget): number =>
    stat === "hp"
      ? template.maximumHitPoints
      : stat === "power"
        ? template.stats.power
        : template.stats.dexterity;
  const transferredValues = {
    [source]: statValueFor(source) - 1,
    [target]: statValueFor(target) + 1,
  } as const;
  const maximumHitPoints =
    target === "hp"
      ? transferredValues.hp
      : source === "hp"
        ? transferredValues.hp
        : template.maximumHitPoints;
  const stats = {
    ...template.stats,
    power:
      target === "power"
        ? transferredValues.power
        : source === "power"
          ? transferredValues.power
          : template.stats.power,
    dexterity:
      target === "dexterity"
        ? transferredValues.dexterity
        : source === "dexterity"
          ? transferredValues.dexterity
          : template.stats.dexterity,
  };
  if (maximumHitPoints <= 0 || stats.power < 0 || stats.dexterity < 0)
    throw new RangeError(`Cannot materialize a fixed-total arm for ${template.id}.`);
  return {
    ...template,
    id: `${template.id}-arm-${target}` as SimulationTemplate["id"],
    label: `${template.label} (${target}+1 fixed-total arm)`,
    specializationPointsDistribution: distribution,
    maximumHitPoints,
    stats,
  };
};

export const simulationV4ItemArmTemplateFor = (
  template: SimulationTemplate,
  itemId: string,
  replacementId?: string,
): { readonly template: SimulationTemplate; readonly replacementId?: string } => {
  if (!template.itemIds.includes(itemId)) return { template };
  const itemIds =
    replacementId === undefined
      ? template.itemIds.filter((candidate) => candidate !== itemId)
      : [
          ...template.itemIds.filter((candidate) => candidate !== itemId),
          ...(template.itemIds.includes(replacementId) ? [] : [replacementId]),
        ];
  return {
    template: {
      ...template,
      id: `${template.id}-arm-item-${itemId}` as SimulationTemplate["id"],
      label:
        replacementId === undefined
          ? `${template.label} (remove ${itemId})`
          : `${template.label} (replace ${itemId} with ${replacementId})`,
      itemIds,
      itemQuantities:
        template.itemQuantities === undefined
          ? undefined
          : Object.fromEntries(
              Object.entries(template.itemQuantities)
                .filter(([candidate]) => candidate !== itemId)
                .map(([candidate, quantity]) => [candidate, quantity]),
            ),
    },
    ...(replacementId === undefined ? {} : { replacementId }),
  };
};

export const simulationV4MoveRemovalArmTemplateFor = (
  template: SimulationTemplate,
  moveId: string,
): SimulationTemplate => ({
  ...template,
  id: `${template.id}-arm-remove-${moveId}` as SimulationTemplate["id"],
  label: `${template.label} (remove ${moveId})`,
  moveIds: template.moveIds.filter((candidate) => candidate !== moveId),
});

type SimulationV4ControlDefinitionInput = {
  readonly schedule: "natural" | "controlled" | "diagnostic";
  readonly branch: "baseline" | "variant";
  readonly itemTarget?: string;
  readonly replacementItemId?: string;
  readonly moveTarget?: string;
  readonly transformationTarget?: string;
};

export const simulationV4ControlDefinitionIdsFor = (
  input: SimulationV4ControlDefinitionInput,
): readonly string[] => {
  if (input.schedule !== "controlled") return [];
  if (input.branch === "baseline") {
    if (input.itemTarget !== undefined) return [input.itemTarget];
    if (input.moveTarget !== undefined) return [input.moveTarget];
    return ["basic-attack"];
  }
  if (input.itemTarget !== undefined) return [input.replacementItemId ?? "basic-attack"];
  if (input.transformationTarget !== undefined) return [input.transformationTarget];
  return ["basic-attack"];
};

export const simulationV4SparseStatusFor = (input: {
  readonly eligibilityDenominator: number;
  readonly executionDenominator: number;
  readonly achievedPairs: number;
}): z.infer<typeof catalogCellSchema>["sparseStatus"] => {
  if (input.eligibilityDenominator >= 30 && input.executionDenominator >= 10) return "sufficient";
  if (input.achievedPairs < SIMULATION_V4_CONTINUATION_CEILING) return "pending";
  if (input.eligibilityDenominator === 0) return "never-eligible";
  if (input.executionDenominator === 0) return "eligible-never-selected";
  return "insufficient";
};

const profileFor = (profile: AiProfile | undefined): AiProfile => profile ?? NORMAL_PROFILE;

const templatesFor = (
  view: CombatMechanicsView,
  supplied: readonly SimulationTemplate[] | undefined,
): readonly SimulationTemplate[] =>
  [
    ...(supplied ??
      (view === CANONICAL_COMBAT_MECHANICS_VIEW
        ? ALL_SIMULATION_TEMPLATES(view)
        : TF1_SIMULATION_TEMPLATES)),
  ].sort((a, b) => a.id.localeCompare(b.id));

const pairIdentityFor = (a: SimulationTemplate, b: SimulationTemplate): string =>
  canonicalHash({ templates: [a.id, b.id].sort((left, right) => left.localeCompare(right)) });

const scenarioFor = (
  a: SimulationTemplate,
  b: SimulationTemplate,
  pairId: string,
  schedule: SimulationV4Schedule,
  armId: string,
  retention: "summary" | "diagnostic" | "coverage" = "summary",
): SimulationScenario =>
  ({
    schemaVersion: "simulation-contracts:v1",
    id: simulationScenarioIdSchema.parse(`simulation-scenario:v4-${pairId.slice(-8)}`),
    family: "symmetric-control",
    checkpointId: a.checkpointId,
    templateAId: a.id,
    templateBId: b.id,
    variantId: simulationVariantIdSchema.parse(`simulation-variant:v4-${schedule}-${armId}`),
    retention,
    limits: {
      maximumTurns: SIMULATION_DEFAULT_LIMITS.maximumTurns,
      maximumTransitions: SIMULATION_DEFAULT_LIMITS.maximumTransitions,
      semanticNoProgressLimit: SIMULATION_DEFAULT_LIMITS.semanticNoProgressLimit,
    },
    stoppingPolicy: "continue",
    deferred: false,
    note: `Authoritative v4 ${schedule} arm ${armId}.`,
  }) satisfies SimulationScenario;

const requestFor = (input: {
  readonly a: SimulationTemplate;
  readonly b: SimulationTemplate;
  readonly pairId: string;
  readonly iteration: number;
  readonly mirror: "original" | "mirrored";
  readonly rootSeed: number;
  readonly fixedTime: Date;
  readonly profile: AiProfile;
  readonly view: CombatMechanicsView;
  readonly schedule: "natural" | "controlled" | "diagnostic";
  readonly branch?: "baseline" | "variant";
}): SimulationFightRequest => {
  const mirrored = input.mirror === "mirrored";
  const baselineA = mirrored ? input.b : input.a;
  const baselineB = mirrored ? input.a : input.b;
  const branch = input.branch ?? (input.schedule === "controlled" ? "variant" : "baseline");
  const statTarget =
    input.schedule === "controlled" && input.iteration % 6 < 3
      ? SIMULATION_V4_STAT_TARGET_ORDER[input.iteration % SIMULATION_V4_STAT_TARGET_ORDER.length]
      : undefined;
  const itemTarget =
    input.schedule === "controlled" && input.iteration % 6 === 3 ? baselineA.itemIds[0] : undefined;
  const replacementItemId =
    itemTarget === undefined
      ? undefined
      : [...input.view.indexes.items.values()]
          .filter((item) => !baselineA.itemIds.includes(item.id) && item.id !== itemTarget)
          .sort(
            (left, right) =>
              Number(left.category !== input.view.indexes.items.get(itemTarget)?.category) -
                Number(right.category !== input.view.indexes.items.get(itemTarget)?.category) ||
              Math.abs((left.price ?? 0) - (input.view.indexes.items.get(itemTarget)?.price ?? 0)) -
                Math.abs(
                  (right.price ?? 0) - (input.view.indexes.items.get(itemTarget)?.price ?? 0),
                ) ||
              left.id.localeCompare(right.id),
          )[0]?.id;
  const moveTarget =
    input.schedule === "controlled" && input.iteration % 6 === 4 ? baselineA.moveIds[0] : undefined;
  const transformationTarget =
    input.schedule === "controlled" && input.iteration % 6 === 5
      ? baselineA.transformationProfiles[0]?.transformationId
      : undefined;
  const sourceDefinitionId =
    branch === "baseline"
      ? undefined
      : (itemTarget ??
        moveTarget ??
        transformationTarget ??
        (statTarget === undefined ? undefined : `stat:${statTarget}`));
  const armId =
    branch === "baseline" ||
    (itemTarget === undefined &&
      moveTarget === undefined &&
      transformationTarget === undefined &&
      statTarget === undefined)
      ? `${input.schedule}-baseline`
      : itemTarget !== undefined
        ? `${input.schedule}-item-${itemTarget}`
        : moveTarget !== undefined
          ? `${input.schedule}-move-removal-${moveTarget}`
          : transformationTarget !== undefined
            ? `${input.schedule}-transformation-${transformationTarget}`
            : `${input.schedule}-fixed-total-${statTarget}`;
  const itemArm =
    branch === "baseline" || itemTarget === undefined
      ? undefined
      : simulationV4ItemArmTemplateFor(baselineA, itemTarget, replacementItemId);
  const templateA =
    branch === "baseline"
      ? baselineA
      : statTarget !== undefined
        ? simulationV4StatArmTemplateFor(baselineA, statTarget)
        : moveTarget !== undefined
          ? simulationV4MoveRemovalArmTemplateFor(baselineA, moveTarget)
          : (itemArm?.template ?? baselineA);
  const templateB = baselineB;
  const retention =
    input.schedule === "diagnostic" ? ("diagnostic" as const) : ("summary" as const);
  const scenario = scenarioFor(input.a, input.b, input.pairId, input.schedule, armId, retention);
  const evidenceRole = input.schedule === "natural" ? ("natural-balance" as const) : input.schedule;
  const exposurePopulation =
    input.schedule === "natural"
      ? ("natural" as const)
      : input.schedule === "controlled"
        ? ("isolation" as const)
        : ("forced" as const);
  const arm: SimulationStatisticsArmIdentity = {
    schedule: input.schedule,
    armId,
    branch,
    ...(sourceDefinitionId === undefined ? {} : { sourceDefinitionId }),
    baselineTemplateId: input.a.id,
    opponentTemplateId: input.b.id,
    iteration: input.iteration,
    orientation: input.mirror,
  };
  const controlledDefinitionIds = simulationV4ControlDefinitionIdsFor({
    schedule: input.schedule,
    branch,
    ...(itemTarget === undefined ? {} : { itemTarget }),
    ...(itemArm?.replacementId === undefined ? {} : { replacementItemId: itemArm.replacementId }),
    ...(moveTarget === undefined ? {} : { moveTarget }),
    ...(transformationTarget === undefined ? {} : { transformationTarget }),
  });
  return {
    schemaVersion: "simulation-contracts:v1",
    runId: `simulation-run:v4-${canonicalHash({ pairId: input.pairId, iteration: input.iteration, mirror: input.mirror, arm }).slice(-8)}`,
    scenario,
    templateA,
    templateB,
    profileA: input.profile,
    profileB: input.profile,
    rootSeed: input.rootSeed,
    iteration: input.iteration,
    mirror: input.mirror,
    seedFamilyId: `simulation-pair:v4-${input.pairId.slice(-8)}`,
    fixedTime: input.fixedTime,
    mechanicsView: input.view,
    statistics: {
      schemaVersion: SIMULATION_STATISTICS_REQUEST_VERSION,
      evidenceRole,
      exposurePopulation,
      arm,
    },
    ...(input.schedule === "controlled" && controlledDefinitionIds.length > 0
      ? {
          decisionPolicy: {
            type: "controlled-legal-preference" as const,
            preferredDefinitionIds: [...controlledDefinitionIds],
            baselineDefinitionId: "basic-attack",
            fallback: "first-legal" as const,
          },
        }
      : input.schedule === "diagnostic" && controlledDefinitionIds.length > 0
        ? {
            decisionPolicy: {
              type: "forced-target-first" as const,
              targetDefinitionId: controlledDefinitionIds[0]!,
              fallback: "first-legal" as const,
            },
          }
        : {}),
  };
};

const manifestFor = (input: {
  readonly view: CombatMechanicsView;
  readonly templates: readonly SimulationTemplate[];
  readonly profile: AiProfile;
  readonly rootSeed: number;
  readonly fixedTime: Date;
  readonly targetPairs: number;
  readonly schedule: "natural" | "controlled" | "diagnostic";
}): SimulationV4CatalogManifest => ({
  schemaVersion: SIMULATION_V4_CATALOG_MANIFEST_VERSION,
  mechanics: { version: input.view.version, identity: input.view.identity.contentHash },
  templateCatalogIdentity: canonicalHash(input.templates),
  scenarioCatalogIdentity: canonicalHash({
    family: "symmetric-control",
    checkpointIds: ["all"],
    schedule: input.schedule,
  }),
  metricDictionaryIdentity: canonicalHash(SIMULATION_V4_METRIC_DEFINITIONS),
  seedScheduleIdentity: SIMULATION_V4_SEED_SCHEDULE_VERSION,
  scopeVersion: SIMULATION_SCOPE_VERSION,
  rootSeed: input.rootSeed,
  fixedTime: input.fixedTime.toISOString(),
  aiProfile: {
    id: input.profile.identity.id,
    version: input.profile.identity.version,
  },
  evidenceRoles: [input.schedule === "natural" ? "natural-balance" : input.schedule],
  requestedTargetPairs: input.targetPairs,
  maximumPairs: SIMULATION_V4_CONTINUATION_CEILING,
});

const validateResume = (
  checkpoint: SimulationV4CatalogCheckpoint,
  manifest: SimulationV4CatalogManifest,
  targetPairs: number,
): void => {
  if (checkpoint.schemaVersion !== SIMULATION_V4_CHECKPOINT_VERSION)
    throw new RangeError("v4 resume requires simulation-statistics-checkpoint:v2.");
  if (targetPairs < checkpoint.manifest.requestedTargetPairs)
    throw new RangeError("v4 resume cannot reduce the requested target pairs.");
  if (checkpoint.manifestHash !== canonicalHash(checkpoint.manifest))
    throw new RangeError("v4 checkpoint manifest hash is stale or invalid.");
  for (const key of [
    "mechanics",
    "templateCatalogIdentity",
    "scenarioCatalogIdentity",
    "metricDictionaryIdentity",
    "seedScheduleIdentity",
    "scopeVersion",
    "rootSeed",
    "fixedTime",
    "aiProfile",
    "evidenceRoles",
  ] as const)
    if (canonicalHash(checkpoint.manifest[key]) !== canonicalHash(manifest[key]))
      throw new RangeError(`v4 resume manifest mismatch: ${key}.`);
};

const cellFor = (
  a: SimulationTemplate,
  b: SimulationTemplate,
  prior: SimulationV4CatalogCheckpoint["cells"][number] | undefined,
): SimulationV4CatalogCheckpoint["cells"][number] => ({
  cellId: `simulation-cell:v4-${pairIdentityFor(a, b).slice(-8)}`,
  templateAId: a.id,
  templateBId: b.id,
  completedBasePairs: prior?.completedBasePairs ?? 0,
  completedIterations: prior?.completedIterations ?? [],
  completedMirrors: prior?.completedMirrors ?? [],
  acceptedMirrorResults: prior?.acceptedMirrorResults ?? {},
  seedOffsets: prior?.seedOffsets ?? {},
  armIdentities: prior?.armIdentities ?? {},
  pairedAggregates: prior?.pairedAggregates ?? {},
  canonicalMergePosition: prior?.canonicalMergePosition ?? 0,
  nextIteration: prior?.nextIteration ?? 0,
  eligibilityDenominator: prior?.eligibilityDenominator ?? 0,
  executionDenominator: prior?.executionDenominator ?? 0,
  continuationOffset: prior?.continuationOffset ?? 0,
  sparseStatus: prior?.sparseStatus ?? "pending",
  failures: [...(prior?.failures ?? [])],
  replacementAttempts: prior?.replacementAttempts ?? 0,
});

const artifactWithMetrics = (
  input: Omit<Parameters<typeof createSimulationStatisticsArtifactV4>[0], "metrics"> & {
    readonly metrics: Readonly<Record<string, SimulationMetricAggregateV2>>;
  },
): SimulationStatisticsArtifactV4 => createSimulationStatisticsArtifactV4(input);

const checkpointFor = (input: {
  readonly manifest: SimulationV4CatalogManifest;
  readonly cells: readonly SimulationV4CatalogCheckpoint["cells"][number][];
  readonly batchCount: number;
  readonly artifact: SimulationStatisticsArtifactV4;
}): SimulationV4CatalogCheckpoint => {
  const withoutHash = {
    schemaVersion: SIMULATION_V4_CHECKPOINT_VERSION,
    manifest: input.manifest,
    manifestHash: canonicalHash(input.manifest),
    cells: [...input.cells].sort((a, b) => a.cellId.localeCompare(b.cellId)),
    batchCount: input.batchCount,
    canonicalResultOrderHash: canonicalHash(
      [...input.cells].sort((a, b) => a.cellId.localeCompare(b.cellId)),
    ),
    artifact: input.artifact,
  };
  return {
    ...withoutHash,
    checkpointHash: canonicalHash(withoutHash),
  };
};

const statAllocationFor = (template: SimulationTemplate): string => {
  const entries = [
    ["hp", template.specializationPointsDistribution.hp],
    ["power", template.specializationPointsDistribution.power],
    ["dexterity", template.specializationPointsDistribution.dexterity],
  ] as const;
  const ordered = [...entries].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
  if ((ordered[0]?.[1] ?? 0) - (ordered[2]?.[1] ?? 0) <= 1) return "balanced";
  if ((ordered[0]?.[1] ?? 0) - (ordered[1]?.[1] ?? 0) >= 2) return `${ordered[0]?.[0]}-heavy`;
  return `${ordered[0]?.[0]}-${ordered[1]?.[0]}`;
};

const dimensionsForTemplates = (
  request: SimulationFightRequest,
  firstActor: "a" | "b",
): Parameters<typeof createSimulationV4FightAccumulator>[0]["dimensionsBySide"] => {
  const a = request.templateA;
  const b = request.templateB;
  const shared = {
    checkpointId:
      a.checkpointId === b.checkpointId ? a.checkpointId : `${a.checkpointId}-vs-${b.checkpointId}`,
    aiProfile: request.profileA.identity.id,
    initiativeWinner: firstActor,
    firstActor,
    evidenceRole: "natural-balance" as const,
    exposurePopulation: "natural" as const,
  };
  return {
    a: {
      ...shared,
      templateId: a.id,
      buildId: a.id,
      styleMatchup: `${a.styleId}-vs-${b.styleId}`,
      level: String(a.specialization?.level ?? a.checkpointId),
      statAllocation: statAllocationFor(a),
      hpDifferential: a.specializationPointsDistribution.hp - b.specializationPointsDistribution.hp,
      powerDifferential:
        a.specializationPointsDistribution.power - b.specializationPointsDistribution.power,
      dexterityDifferential: a.stats.dexterity - b.stats.dexterity,
    },
    b: {
      ...shared,
      templateId: b.id,
      buildId: b.id,
      styleMatchup: `${b.styleId}-vs-${a.styleId}`,
      level: String(b.specialization?.level ?? b.checkpointId),
      statAllocation: statAllocationFor(b),
      hpDifferential: b.specializationPointsDistribution.hp - a.specializationPointsDistribution.hp,
      powerDifferential:
        b.specializationPointsDistribution.power - a.specializationPointsDistribution.power,
      dexterityDifferential: b.stats.dexterity - a.stats.dexterity,
    },
  };
};

const foldResult = (
  artifact: SimulationStatisticsArtifactV4,
  request: SimulationFightRequest,
  result: SimulationFightExecutionResult,
): SimulationStatisticsArtifactV4 => {
  if (result.statistics !== undefined) {
    const metrics: Record<string, SimulationMetricAggregateV2> = { ...artifact.metrics };
    for (const [key, metric] of Object.entries(result.statistics.metrics))
      metrics[key] =
        metrics[key] === undefined
          ? metric
          : mergeSimulationMetricAggregatesV2(metrics[key], metric);
    return artifactWithMetrics({
      catalogId: artifact.generatedFrom.catalogId,
      mechanicsIdentity: artifact.generatedFrom.mechanicsIdentity,
      rootSeed: artifact.generatedFrom.rootSeed,
      targetPairs: artifact.generatedFrom.targetPairs,
      evidenceRole: artifact.generatedFrom.evidenceRole,
      exposurePopulation: artifact.generatedFrom.exposurePopulation,
      sourceLimitations: artifact.generatedFrom.sourceLimitations,
      metrics,
      incompleteFights: artifact.incompleteFights + (result.failure === undefined ? 0 : 1),
      errorFights: artifact.errorFights + (result.failure === undefined ? 0 : 1),
      forcedExposureFights: artifact.forcedExposureFights,
      representativeReplaySeeds: artifact.representativeReplaySeeds,
    });
  }
  const fighterIds = Object.values(result.finalState.combatants).map((combatant) => combatant.id);
  const firstTransitionState = result.transitions[0]?.state;
  const firstActorId =
    firstTransitionState?.status === "active" ? firstTransitionState.activeCombatantId : undefined;
  const fighterAId = result.fighterAId ?? fighterIds[0] ?? "fighter-a";
  const fighterBId = result.fighterBId ?? fighterIds[1] ?? "fighter-b";
  const firstActor = String(firstActorId) === String(fighterBId) ? "b" : "a";
  const accumulator = createSimulationV4FightAccumulator({
    pairId: request.seedFamilyId ?? result.pairId,
    orientation: request.mirror ?? "original",
    fighterAId,
    fighterBId,
    dimensionsBySide: dimensionsForTemplates(request, firstActor),
    equippedMoveIdsBySide: { a: request.templateA.moveIds, b: request.templateB.moveIds },
    equippedItemIdsBySide: { a: request.templateA.itemIds, b: request.templateB.itemIds },
    availableTransformationIdsBySide: {
      a: request.templateA.transformationProfiles.map((profile) => profile.transformationId),
      b: request.templateB.transformationProfiles.map((profile) => profile.transformationId),
    },
  });
  let folded = accumulator;
  let previousState = undefined as SimulationFightExecutionResult["finalState"] | undefined;
  let decisionIndex = 0;
  for (const transition of result.transitions) {
    const decisionTransition = transition.events.some(
      (event) => "causedByDecisionId" in event && event.causedByDecisionId !== undefined,
    );
    const selectedDecision = decisionTransition
      ? result.diagnostics?.selectedDecisions[decisionIndex++]
      : undefined;
    folded = foldSimulationV4Transition(folded, {
      previousState,
      transition,
      selectedDecision,
      eventualWinner:
        result.finalState.status === "completed" &&
        result.finalState.completion.winnerCombatantId !== undefined
          ? result.finalState.completion.winnerCombatantId === folded.fighterAId
            ? "a"
            : "b"
          : undefined,
    });
    previousState = transition.state;
  }
  folded = finalizeSimulationV4FightAccumulator(folded, result);
  const metrics: Record<string, SimulationMetricAggregateV2> = { ...artifact.metrics };
  for (const [key, metric] of Object.entries(folded.metrics))
    metrics[key] =
      metrics[key] === undefined ? metric : mergeSimulationMetricAggregatesV2(metrics[key], metric);
  return artifactWithMetrics({
    catalogId: artifact.generatedFrom.catalogId,
    mechanicsIdentity: artifact.generatedFrom.mechanicsIdentity,
    rootSeed: artifact.generatedFrom.rootSeed,
    targetPairs: artifact.generatedFrom.targetPairs,
    evidenceRole: artifact.generatedFrom.evidenceRole,
    exposurePopulation: artifact.generatedFrom.exposurePopulation,
    sourceLimitations: artifact.generatedFrom.sourceLimitations,
    metrics,
    incompleteFights: artifact.incompleteFights + (result.failure === undefined ? 0 : 1),
    errorFights: artifact.errorFights + (result.failure === undefined ? 0 : 1),
    forcedExposureFights: artifact.forcedExposureFights,
    representativeReplaySeeds: artifact.representativeReplaySeeds,
  });
};

const foldMirroredPair = (
  artifact: SimulationStatisticsArtifactV4,
  original: Readonly<{ request: SimulationFightRequest; result: SimulationFightExecutionResult }>,
  mirrored: Readonly<{ request: SimulationFightRequest; result: SimulationFightExecutionResult }>,
): SimulationStatisticsArtifactV4 => {
  const scoreFor = (result: SimulationFightExecutionResult, side: "a" | "b"): number => {
    if (result.finalState.status !== "completed") return 0.5;
    const fighterId = side === "a" ? result.fighterAId : result.fighterBId;
    return result.finalState.completion.winnerCombatantId === undefined
      ? 0.5
      : result.finalState.completion.winnerCombatantId === fighterId
        ? 1
        : 0;
  };
  const entries = [
    {
      templateId: original.request.templateA.id,
      originalScore: scoreFor(original.result, "a"),
      mirroredScore: scoreFor(mirrored.result, "b"),
    },
    {
      templateId: original.request.templateB.id,
      originalScore: scoreFor(original.result, "b"),
      mirroredScore: scoreFor(mirrored.result, "a"),
    },
  ];
  const metrics = { ...artifact.metrics };
  for (const entry of entries) {
    const dimensions = Object.values(original.result.statistics?.metrics ?? {}).find(
      (metric) =>
        metric.metricId === "simulation:raw-win-rate" &&
        metric.dimensions.templateId === entry.templateId,
    )?.dimensions;
    if (dimensions === undefined) continue;
    const metricId = "simulation:mirrored-adjusted-win-rate";
    const key = `${metricId}:${simulationStatisticsDimensionKey(dimensions)}`;
    const prior =
      metrics[key] ??
      createSimulationMetricAggregateV2({
        metricId,
        dimensions,
        unit: "proportion",
        intervalMethod: "wilson-95",
      });
    const adjusted = (entry.originalScore + entry.mirroredScore) / 2;
    metrics[key] = addSimulationMetricObservationV2(prior, {
      value: adjusted,
      successWeight: adjusted,
      eligible: true,
      completed: true,
      pairId: `${original.request.seedFamilyId ?? original.result.pairId}:${original.request.iteration ?? 0}:${entry.templateId}`,
      pairedDifference: entry.originalScore - entry.mirroredScore,
    });
  }
  return artifactWithMetrics({
    catalogId: artifact.generatedFrom.catalogId,
    mechanicsIdentity: artifact.generatedFrom.mechanicsIdentity,
    rootSeed: artifact.generatedFrom.rootSeed,
    targetPairs: artifact.generatedFrom.targetPairs,
    evidenceRole: artifact.generatedFrom.evidenceRole,
    exposurePopulation: artifact.generatedFrom.exposurePopulation,
    sourceLimitations: artifact.generatedFrom.sourceLimitations,
    metrics,
    incompleteFights: artifact.incompleteFights,
    errorFights: artifact.errorFights,
    forcedExposureFights: artifact.forcedExposureFights,
    representativeReplaySeeds: artifact.representativeReplaySeeds,
  });
};

const foldControlledArmPair = (
  artifact: SimulationStatisticsArtifactV4,
  baseline: Readonly<{ request: SimulationFightRequest; result: SimulationFightExecutionResult }>,
  variant: Readonly<{ request: SimulationFightRequest; result: SimulationFightExecutionResult }>,
): SimulationStatisticsArtifactV4 => {
  const arm =
    variant.request.statistics !== undefined && "arm" in variant.request.statistics
      ? variant.request.statistics.arm
      : undefined;
  if (arm?.branch !== "variant" || arm.sourceDefinitionId === undefined) return artifact;
  const scoreFor = (result: SimulationFightExecutionResult, side: "a" | "b"): number => {
    if (result.finalState.status !== "completed") return 0.5;
    const fighterId = side === "a" ? result.fighterAId : result.fighterBId;
    return result.finalState.completion.winnerCombatantId === fighterId ? 1 : 0;
  };
  const side = variant.request.mirror === "mirrored" ? "b" : "a";
  const difference = scoreFor(variant.result, side) - scoreFor(baseline.result, side);
  const raw = Object.values(variant.result.statistics?.metrics ?? {}).find(
    (metric) =>
      metric.metricId === "simulation:raw-win-rate" &&
      metric.dimensions.templateId === variant.request.templateA.id,
  );
  if (raw === undefined) return artifact;
  const dimensions = {
    ...raw.dimensions,
    ...(arm.sourceDefinitionId.startsWith("stat:")
      ? {}
      : arm.armId.includes("item-")
        ? { itemId: arm.sourceDefinitionId }
        : arm.armId.includes("transformation-")
          ? { transformationId: arm.sourceDefinitionId }
          : { moveId: arm.sourceDefinitionId }),
  };
  const metricIds = arm.armId.includes("fixed-total")
    ? ["simulation:fixed-total-sp-effect"]
    : arm.armId.includes("item-")
      ? ["simulation:item-equip-effect"]
      : arm.armId.includes("move-removal")
        ? ["simulation:move-paired-marginal-win-effect"]
        : ["simulation:transformation-swing", "simulation:transformation-base-delta"];
  const metrics = { ...artifact.metrics };
  for (const metricId of metricIds) {
    const key = `${metricId}:${simulationStatisticsDimensionKey(dimensions)}`;
    const prior =
      metrics[key] ??
      createSimulationMetricAggregateV2({
        metricId,
        dimensions,
        unit: "score",
        intervalMethod: "paired-bootstrap-95",
      });
    metrics[key] = addSimulationMetricObservationV2(prior, {
      value: difference,
      eligible: true,
      completed: true,
      pairId: `${variant.request.seedFamilyId ?? variant.result.pairId}:${variant.request.iteration ?? 0}:${variant.request.mirror ?? "original"}:${arm.armId}`,
      pairedDifference: difference,
    });
  }
  return artifactWithMetrics({
    catalogId: artifact.generatedFrom.catalogId,
    mechanicsIdentity: artifact.generatedFrom.mechanicsIdentity,
    rootSeed: artifact.generatedFrom.rootSeed,
    targetPairs: artifact.generatedFrom.targetPairs,
    evidenceRole: artifact.generatedFrom.evidenceRole,
    exposurePopulation: artifact.generatedFrom.exposurePopulation,
    sourceLimitations: artifact.generatedFrom.sourceLimitations,
    metrics,
    incompleteFights: artifact.incompleteFights,
    errorFights: artifact.errorFights,
    forcedExposureFights: artifact.forcedExposureFights,
    representativeReplaySeeds: artifact.representativeReplaySeeds,
  });
};

export const validateSimulationV4CatalogCheckpoint = (
  checkpoint: SimulationV4CatalogCheckpoint,
): readonly string[] => {
  const issues: string[] = [];
  if (checkpoint.manifestHash !== canonicalHash(checkpoint.manifest))
    issues.push("manifest hash mismatch");
  const withoutHash = { ...checkpoint } as Record<string, unknown>;
  delete withoutHash.checkpointHash;
  if (checkpoint.checkpointHash !== canonicalHash(withoutHash))
    issues.push("checkpoint hash mismatch");
  if (
    checkpoint.canonicalResultOrderHash !==
    canonicalHash([...checkpoint.cells].sort((a, b) => a.cellId.localeCompare(b.cellId)))
  )
    issues.push("canonical result-order hash mismatch");
  const artifact = checkpoint.artifact;
  const artifactWithoutHash = { ...artifact } as Record<string, unknown>;
  delete artifactWithoutHash.artifactHash;
  if (artifact.artifactHash !== canonicalHash(artifactWithoutHash))
    issues.push("artifact hash mismatch");
  return issues;
};

export const runSimulationStatisticsCatalogV4 = (
  options: SimulationV4CatalogRunnerOptions = {},
): SimulationV4CatalogRunnerResult => {
  const view = options.mechanicsView ?? CANONICAL_COMBAT_MECHANICS_VIEW;
  const templates = templatesFor(view, options.templates);
  if (templates.length < 2) throw new RangeError("v4 catalog requires at least two templates.");
  const targetPairs = options.targetPairs ?? SIMULATION_V4_NOMINAL_TARGET_PAIRS;
  if (
    !Number.isInteger(targetPairs) ||
    targetPairs < 1 ||
    targetPairs > SIMULATION_V4_CONTINUATION_CEILING
  )
    throw new RangeError(
      `v4 target pairs must be between 1 and ${SIMULATION_V4_CONTINUATION_CEILING}.`,
    );
  const rootSeed = options.rootSeed ?? options.resumeFrom?.manifest.rootSeed ?? 1_427_251_991;
  const fixedTime =
    options.fixedTime ??
    new Date(options.resumeFrom?.manifest.fixedTime ?? "2026-01-01T00:00:00.000Z");
  const profile = profileFor(options.aiProfile);
  const resumedRole = options.resumeFrom?.manifest.evidenceRoles[0];
  const schedule =
    options.schedule ??
    (resumedRole === "controlled"
      ? "controlled"
      : resumedRole === "diagnostic"
        ? "diagnostic"
        : "natural");
  const evidenceRole = schedule === "natural" ? "natural-balance" : schedule;
  const exposurePopulation =
    schedule === "natural" ? "natural" : schedule === "controlled" ? "isolation" : "forced";
  const manifest = manifestFor({
    view,
    templates,
    profile,
    rootSeed,
    fixedTime,
    targetPairs,
    schedule,
  });
  if (options.resumeFrom !== undefined) {
    validateResume(options.resumeFrom, manifest, targetPairs);
    const issues = validateSimulationV4CatalogCheckpoint(options.resumeFrom);
    if (issues.length > 0) throw new RangeError(`Invalid v4 checkpoint: ${issues.join(", ")}.`);
  }
  const pairs = templates.flatMap((a, i) => templates.slice(i + 1).map((b) => ({ a, b })));
  let cells = pairs.map(({ a, b }) =>
    cellFor(
      a,
      b,
      options.resumeFrom?.cells.find(
        (cell) => cell.templateAId === a.id && cell.templateBId === b.id,
      ),
    ),
  );
  const initialArtifact =
    options.resumeFrom?.artifact ??
    createSimulationStatisticsArtifactV4({
      catalogId: options.catalogId ?? `catalog:${schedule}-normal-v4`,
      mechanicsIdentity: view.identity.contentHash,
      rootSeed,
      targetPairs,
      evidenceRole,
      exposurePopulation,
      sourceLimitations: [
        `${evidenceRole} evidence is retained separately and is never pooled across evidence roles.`,
        "Sparse continuation through 400 pairs does not promote the overall evidence level.",
      ],
      metrics: Object.fromEntries(
        Object.entries(
          createSimulationV4FightAccumulator({
            pairId: "catalog",
            orientation: "original",
            fighterAId: "fighter-a",
            fighterBId: "fighter-b",
            dimensions: { evidenceRole, exposurePopulation },
          }).metrics,
        ).map(([key, metric]) => [
          key,
          SIMULATION_V4_METRIC_DEFINITIONS.find(
            (definition) => definition.metricId === metric.metricId,
          )?.population === evidenceRole
            ? metric
            : setSimulationMetricEvidenceV2(
                metric,
                "not-applicable",
                `Requires ${SIMULATION_V4_METRIC_DEFINITIONS.find((definition) => definition.metricId === metric.metricId)?.population ?? "another"} evidence, not ${evidenceRole} evidence.`,
              ),
        ]),
      ),
    });
  let artifact = artifactWithMetrics({
    catalogId: options.catalogId ?? initialArtifact.generatedFrom.catalogId,
    mechanicsIdentity: view.identity.contentHash,
    rootSeed,
    targetPairs,
    evidenceRole,
    exposurePopulation,
    sourceLimitations: initialArtifact.generatedFrom.sourceLimitations,
    metrics: initialArtifact.metrics,
    incompleteFights: initialArtifact.incompleteFights,
    errorFights: initialArtifact.errorFights,
    forcedExposureFights: initialArtifact.forcedExposureFights,
    representativeReplaySeeds: initialArtifact.representativeReplaySeeds,
  });
  const batchSize = options.batchSize ?? 25;
  if (!Number.isInteger(batchSize) || batchSize < 1)
    throw new RangeError("v4 batch size must be positive.");
  const requests: SimulationFightRequest[] = [];
  const branches =
    schedule === "controlled" ? (["baseline", "variant"] as const) : (["baseline"] as const);
  for (const cell of cells)
    for (const pair of pairs.filter(
      ({ a, b }) => `simulation-cell:v4-${pairIdentityFor(a, b).slice(-8)}` === cell.cellId,
    ))
      for (let iteration = 0; iteration < targetPairs; iteration++)
        if (!cell.completedIterations.includes(iteration))
          for (const mirror of ["original", "mirrored"] as const)
            for (const branch of branches) {
              const resultKey = `${iteration}:${mirror}:${branch}`;
              if (
                cell.completedMirrors.some(
                  (entry) => entry.iteration === iteration && entry.mirrors.includes(mirror),
                ) ||
                Object.hasOwn(cell.acceptedMirrorResults, resultKey)
              )
                continue;
              requests.push(
                requestFor({
                  a: pair.a,
                  b: pair.b,
                  pairId: pairIdentityFor(pair.a, pair.b),
                  iteration,
                  mirror,
                  rootSeed,
                  fixedTime,
                  profile,
                  view,
                  schedule,
                  branch,
                }),
              );
            }
  const orderedRequests = requests.slice();
  orderedRequests.sort(
    (a, b) =>
      a.scenario.templateAId.localeCompare(b.scenario.templateAId) ||
      a.scenario.templateBId.localeCompare(b.scenario.templateBId) ||
      (a.iteration ?? 0) - (b.iteration ?? 0) ||
      (a.mirror === "original" ? -1 : 1),
  );
  let batchCount = options.resumeFrom?.batchCount ?? 0;
  let failedFights = 0;
  const scheduledThrough = new Map(
    cells.map((cell) => [cell.cellId, targetPairs + cell.continuationOffset] as const),
  );
  const pendingPairs = new Map<
    string,
    Partial<
      Record<
        "original" | "mirrored",
        Readonly<{ request: SimulationFightRequest; result: SimulationFightExecutionResult }>
      >
    >
  >();
  // A successful half-mirror is durable checkpoint data. Reconstruct its
  // deterministic request from the manifest rather than replaying the fight;
  // only the JSON-safe execution result is persisted.
  for (const cell of cells) {
    const pair = pairs.find(({ a, b }) => a.id === cell.templateAId && b.id === cell.templateBId);
    if (pair === undefined) continue;
    for (const [key, rawResult] of Object.entries(cell.acceptedMirrorResults)) {
      const [iterationText, mirror, branch = "baseline"] = key.split(":");
      if (typeof rawResult !== "object" || rawResult === null) continue;
      const iteration = Number(iterationText);
      if (!Number.isInteger(iteration) || (mirror !== "original" && mirror !== "mirrored"))
        continue;
      const request = requestFor({
        a: pair.a,
        b: pair.b,
        pairId: pairIdentityFor(pair.a, pair.b),
        iteration,
        mirror,
        rootSeed,
        fixedTime,
        profile,
        view,
        schedule,
        branch: branch === "variant" ? "variant" : "baseline",
      });
      const iterationKey = `${cell.cellId}:${iteration}:${branch}`;
      const pending = pendingPairs.get(iterationKey) ?? {};
      pending[mirror] = {
        request,
        result: rawResult as SimulationFightExecutionResult,
      };
      pendingPairs.set(iterationKey, pending);
    }
  }
  for (let start = 0; start < orderedRequests.length; start += batchSize * 2) {
    const batch = orderedRequests.slice(start, start + batchSize * 2);
    const coordinated =
      options.workers !== undefined && options.workers > 1
        ? runSimulationRequestsWithWorkers({
            requests: batch,
            stoppingPolicy: "continue",
            workers: options.workers,
          })
        : runSimulationRequests({ requests: batch, stoppingPolicy: "continue", concurrency: 1 });
    for (const [entryIndex, entry] of coordinated.results.entries()) {
      const request = batch.at(entryIndex);
      if (request === undefined) {
        failedFights += 1;
        continue;
      }
      let cell = cells.find(
        (candidate) =>
          candidate.templateAId === request.scenario.templateAId &&
          candidate.templateBId === request.scenario.templateBId,
      );
      if (cell === undefined) continue;
      const cellId = cell.cellId;
      if (!entry.ok) {
        failedFights += 1;
        const next = {
          ...cell,
          failures: [...new Set([...cell.failures, request.runId])].sort((a, b) =>
            a.localeCompare(b),
          ),
        };
        cells = cells.map((candidate) => (candidate.cellId === cellId ? next : candidate));
        continue;
      }
      const runFailed =
        entry.value.failure !== undefined || entry.value.terminationReason !== "engine-completed";
      if (runFailed) {
        failedFights += 1;
        const next = {
          ...cell,
          failures: [...new Set([...cell.failures, request.runId])].sort((a, b) =>
            a.localeCompare(b),
          ),
        };
        cells = cells.map((candidate) => (candidate.cellId === cellId ? next : candidate));
        continue;
      }
      const iteration = request.iteration ?? 0;
      const mirror = request.mirror ?? "original";
      const branch =
        request.statistics !== undefined && "arm" in request.statistics
          ? (request.statistics.arm.branch ?? "baseline")
          : "baseline";
      const resultKey = `${iteration}:${mirror}:${branch}`;
      const branchKey = `${cell.cellId}:${iteration}:${branch}`;
      cell = {
        ...cell,
        acceptedMirrorResults: {
          ...cell.acceptedMirrorResults,
          [resultKey]: entry.value,
        },
      };
      cells = cells.map((candidate) => (candidate.cellId === cellId ? cell : candidate));
      const pending = pendingPairs.get(branchKey) ?? {};
      pending[mirror] = { request, result: entry.value };
      pendingPairs.set(branchKey, pending);
      const baseline = pendingPairs.get(`${cell.cellId}:${iteration}:baseline`);
      const variant = pendingPairs.get(`${cell.cellId}:${iteration}:variant`);
      const baselineReady = baseline?.original !== undefined && baseline?.mirrored !== undefined;
      const variantReady =
        schedule !== "controlled" ||
        (variant?.original !== undefined && variant?.mirrored !== undefined);
      if (baselineReady && variantReady) {
        const baselineOriginal = baseline.original!;
        const baselineMirrored = baseline.mirrored!;
        const variantOriginal = variant?.original;
        const variantMirrored = variant?.mirrored;
        const completedResults = [
          baselineOriginal,
          baselineMirrored,
          ...(variantOriginal === undefined ? [] : [variantOriginal]),
          ...(variantMirrored === undefined ? [] : [variantMirrored]),
        ];
        for (const pairResult of completedResults)
          artifact = foldResult(artifact, pairResult.request, pairResult.result);
        artifact = foldMirroredPair(artifact, baselineOriginal, baselineMirrored);
        if (variantOriginal !== undefined && variantMirrored !== undefined) {
          artifact = foldMirroredPair(artifact, variantOriginal, variantMirrored);
          artifact = foldControlledArmPair(artifact, baselineOriginal, variantOriginal);
          artifact = foldControlledArmPair(artifact, baselineMirrored, variantMirrored);
        }
        const completedIterations = [...new Set([...cell.completedIterations, iteration])].sort(
          (left, right) => left - right || String(left).localeCompare(String(right)),
        );
        const pairMetrics = completedResults.flatMap(
          ({ result }) =>
            Object.values(result.statistics?.metrics ?? {}) as SimulationMetricAggregateV2[],
        );
        const eligibleObservations = pairMetrics
          .filter((metric) => metric.metricId === "simulation:move-selection-rate")
          .reduce((sum, metric) => sum + metric.denominators.eligible, 0);
        const executions = pairMetrics
          .filter((metric) => metric.metricId === "simulation:move-execution-rate")
          .reduce((sum, metric) => sum + metric.successes, 0);
        const eligibilityDenominator = cell.eligibilityDenominator + eligibleObservations;
        const executionDenominator = cell.executionDenominator + executions;
        const continuationOffset = Math.max(
          0,
          (completedIterations.at(-1) ?? targetPairs - 1) + 1 - targetPairs,
        );
        const sparseStatus = simulationV4SparseStatusFor({
          eligibilityDenominator,
          executionDenominator,
          achievedPairs: targetPairs + continuationOffset,
        });
        const nextIteration = Array.from({ length: targetPairs }, (_, index) => index).find(
          (candidate) => !completedIterations.includes(candidate),
        );
        const completedMirrors = [
          ...cell.completedMirrors.filter((entry) => entry.iteration !== iteration),
          {
            iteration,
            mirrors: ["original", "mirrored"] as ("original" | "mirrored")[],
          },
        ].sort((left, right) => left.iteration - right.iteration);
        const seedOffsets = {
          ...cell.seedOffsets,
          [String(iteration)]: canonicalHash({
            baselineOriginal: baselineOriginal.request.rootSeed,
            baselineMirrored: baselineMirrored.request.rootSeed,
            variantOriginal: variantOriginal?.request.rootSeed,
            variantMirrored: variantMirrored?.request.rootSeed,
          }),
        };
        const armIdentities = {
          ...cell.armIdentities,
          [String(iteration)]: canonicalHash({
            original:
              baselineOriginal.request.statistics !== undefined &&
              "arm" in baselineOriginal.request.statistics
                ? baselineOriginal.request.statistics.arm
                : undefined,
            mirrored:
              baselineMirrored.request.statistics !== undefined &&
              "arm" in baselineMirrored.request.statistics
                ? baselineMirrored.request.statistics.arm
                : undefined,
            variant:
              variantOriginal?.request.statistics !== undefined &&
              "arm" in variantOriginal.request.statistics
                ? variantOriginal.request.statistics.arm
                : undefined,
          }),
        };
        const pairedAggregates = {
          ...cell.pairedAggregates,
          [String(iteration)]: canonicalHash({
            baselineOriginal: baselineOriginal.result.statistics?.statisticsHash,
            baselineMirrored: baselineMirrored.result.statistics?.statisticsHash,
            variantOriginal: variantOriginal?.result.statistics?.statisticsHash,
            variantMirrored: variantMirrored?.result.statistics?.statisticsHash,
          }),
        };
        const next = {
          ...cell,
          completedBasePairs: completedIterations.filter((candidate) => candidate < targetPairs)
            .length,
          completedIterations,
          completedMirrors,
          seedOffsets,
          armIdentities,
          pairedAggregates,
          canonicalMergePosition: Math.max(cell.canonicalMergePosition, iteration + 1),
          acceptedMirrorResults: Object.fromEntries(
            Object.entries(cell.acceptedMirrorResults).filter(
              ([key]) => !key.startsWith(`${iteration}:`),
            ),
          ),
          nextIteration: nextIteration ?? targetPairs,
          eligibilityDenominator,
          executionDenominator,
          continuationOffset,
          sparseStatus,
          failures: cell.failures.filter(
            (failure) => !completedResults.some(({ request }) => request.runId === failure),
          ),
        };
        cells = cells.map((candidate) => (candidate.cellId === cellId ? next : candidate));
        pendingPairs.delete(`${cell.cellId}:${iteration}:baseline`);
        pendingPairs.delete(`${cell.cellId}:${iteration}:variant`);
      }
    }
    if (targetPairs >= SIMULATION_V4_NOMINAL_TARGET_PAIRS) {
      const continuationRequests: SimulationFightRequest[] = [];
      for (const cell of cells) {
        const through = scheduledThrough.get(cell.cellId) ?? targetPairs;
        if (
          cell.completedBasePairs < targetPairs ||
          cell.sparseStatus === "sufficient" ||
          through >= SIMULATION_V4_CONTINUATION_CEILING ||
          cell.completedIterations.some((iteration) => iteration >= through)
        )
          continue;
        const pair = pairs.find(
          ({ a, b }) => a.id === cell.templateAId && b.id === cell.templateBId,
        );
        if (pair === undefined) continue;
        const nextThrough = Math.min(through + 25, SIMULATION_V4_CONTINUATION_CEILING);
        for (let iteration = through; iteration < nextThrough; iteration++)
          if (!cell.completedIterations.includes(iteration))
            for (const mirror of ["original", "mirrored"] as const)
              for (const branch of branches)
                continuationRequests.push(
                  requestFor({
                    a: pair.a,
                    b: pair.b,
                    pairId: pairIdentityFor(pair.a, pair.b),
                    iteration,
                    mirror,
                    rootSeed,
                    fixedTime,
                    profile,
                    view,
                    schedule,
                    branch,
                  }),
                );
        scheduledThrough.set(cell.cellId, nextThrough);
      }
      continuationRequests.sort(
        (a, b) =>
          a.scenario.templateAId.localeCompare(b.scenario.templateAId) ||
          a.scenario.templateBId.localeCompare(b.scenario.templateBId) ||
          (a.iteration ?? 0) - (b.iteration ?? 0) ||
          (a.mirror === "original" ? -1 : 1),
      );
      orderedRequests.push(...continuationRequests);
    }
    batchCount = Math.max(
      batchCount,
      Math.max(0, ...cells.map((cell) => Math.ceil(cell.nextIteration / batchSize))),
    );
    const unresolvedFailures = cells.reduce((sum, cell) => sum + cell.failures.length, 0);
    artifact = artifactWithMetrics({
      catalogId: artifact.generatedFrom.catalogId,
      mechanicsIdentity: artifact.generatedFrom.mechanicsIdentity,
      rootSeed: artifact.generatedFrom.rootSeed,
      targetPairs,
      evidenceRole: artifact.generatedFrom.evidenceRole,
      exposurePopulation: artifact.generatedFrom.exposurePopulation,
      sourceLimitations: artifact.generatedFrom.sourceLimitations,
      metrics: artifact.metrics,
      incompleteFights: unresolvedFailures,
      errorFights: unresolvedFailures,
      forcedExposureFights: artifact.forcedExposureFights,
      representativeReplaySeeds: artifact.representativeReplaySeeds,
    });
    const checkpoint = checkpointFor({
      manifest: { ...manifest, requestedTargetPairs: targetPairs },
      cells,
      batchCount,
      artifact,
    });
    options.onCheckpoint?.(checkpoint);
    for (const entry of coordinated.results)
      options.onProgress?.({
        completed: start + 1,
        total: orderedRequests.length,
        runId: entry.ok ? entry.value.runId : (batch[0]?.runId ?? "simulation-run:v4-batch"),
        result: entry,
      });
  }
  const checkpoint = checkpointFor({
    manifest: { ...manifest, requestedTargetPairs: targetPairs },
    cells,
    batchCount,
    artifact,
  });
  return {
    artifact,
    checkpoint,
    cells,
    batchCount,
    completedBasePairs: cells.reduce((sum, cell) => sum + cell.completedBasePairs, 0),
    failedFights,
  };
};

export const resumeSimulationStatisticsCatalogV4 = (
  checkpoint: SimulationV4CatalogCheckpoint,
  options: Omit<SimulationV4CatalogRunnerOptions, "resumeFrom"> = {},
): SimulationV4CatalogRunnerResult =>
  runSimulationStatisticsCatalogV4({ ...options, resumeFrom: checkpoint });

export const validateSimulationStatisticsCatalogV4Closure = (
  artifact: SimulationStatisticsArtifactV4,
  checkpoint?: SimulationV4CatalogCheckpoint,
): readonly string[] => {
  const issues: string[] = [];
  const artifactWithoutHash = { ...artifact } as Record<string, unknown>;
  delete artifactWithoutHash.artifactHash;
  if (artifact.artifactHash !== canonicalHash(artifactWithoutHash))
    issues.push("artifact hash mismatch");
  if (artifact.errorFights > 0 || artifact.incompleteFights > 0)
    issues.push("unresolved runner, combat, or AI failures remain");
  if (checkpoint !== undefined) {
    issues.push(
      ...validateSimulationV4CatalogCheckpoint(checkpoint).map((issue) => `checkpoint: ${issue}`),
    );
    for (const cell of checkpoint.cells)
      if (cell.completedBasePairs < SIMULATION_V4_NOMINAL_TARGET_PAIRS)
        issues.push(`${cell.cellId} has fewer than 100 completed mirrored base pairs`);
  } else {
    issues.push("v4 closure requires a checkpoint with per-cell completion state");
  }
  for (const definition of SIMULATION_V4_METRIC_DEFINITIONS) {
    const metrics = Object.values(artifact.metrics).filter(
      (metric) => metric.metricId === definition.metricId,
    );
    if (metrics.length === 0) {
      issues.push(`missing declared metric: ${definition.metricId}`);
      continue;
    }
    for (const metric of metrics)
      if (metric.evidence.state === "insufficient" && definition.population === "natural-balance")
        issues.push(
          `metric ${definition.metricId} has insufficient evidence: ${metric.evidence.reason}`,
        );
  }
  return issues;
};

export const simulationV4CatalogProfileFor = (id: string): AiProfile => {
  if (id === NORMAL_PROFILE.identity.id) return NORMAL_PROFILE;
  if (id === HARD_PROFILE.identity.id) return HARD_PROFILE;
  if (id === SIMULATION_QUALITY_PROFILE.identity.id) return SIMULATION_QUALITY_PROFILE;
  throw new RangeError(`Unknown v4 AI profile: ${id}.`);
};
