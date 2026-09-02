import { z } from "zod";

import type {
  CombatDecision,
  CombatEvent,
  CombatTransition,
  CreateFightInput,
  FightState,
  LegalDecision,
  MechanicsViewIdentity,
} from "@dragonball-resurgence/combat-engine";
import type { AiProfile, CandidateEvaluation } from "@dragonball-resurgence/ai-engine";

import {
  simulationScenarioIdSchema,
  simulationSeriesIdSchema,
  simulationTemplateIdSchema,
  simulationVariantIdSchema,
} from "./ids.js";
import { simulationDecisionPolicySchema, type SimulationDecisionPolicy } from "./exposure.js";
import { simulationMoveFunnelSchema, type SimulationMoveFunnel } from "./move-coverage.js";
import type { SimulationPrecisionStatus } from "./statistics.js";

export const SIMULATION_CONTRACT_VERSION = "simulation-contracts:v1" as const;

const finiteNumber = z.number().refine(Number.isFinite, "Number must be finite.");
const nonNegativeInteger = z.number().int().nonnegative();
const positiveInteger = z.number().int().positive();
const uniqueStrings = z.array(z.string().min(1)).superRefine((values, context) => {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value))
      context.addIssue({ code: "custom", path: [index], message: "Duplicate value." });
    seen.add(value);
  });
});

export const sourceProvenanceSchema = z
  .object({
    path: z.string().min(1),
    text: z.string().min(1),
    line: positiveInteger.optional(),
    sourceKind: z.enum(["canonical", "balance-sheet", "synthetic"]),
  })
  .strict();
export type SourceProvenance = z.output<typeof sourceProvenanceSchema>;

export const simulationGapSchema = z
  .object({
    kind: z.enum([
      "loadout",
      "item",
      "move",
      "trait",
      "transformation",
      "style",
      "class",
      "source-ambiguity",
      "capability",
    ]),
    reason: z.string().min(1),
    provenance: sourceProvenanceSchema.optional(),
  })
  .strict();
export type SimulationGap = z.output<typeof simulationGapSchema>;

const transformationProfileSchema = z
  .object({
    transformationId: z.string().min(1),
    rollSides: positiveInteger.max(100),
    mastery: z.enum(["novice", "intermediate", "mastered"]),
  })
  .strict();

export const simulationTf1OverlaySchema = z
  .object({
    schemaVersion: z.literal("simulation-tf1-overlay:v1"),
    status: z.enum(["draft", "approved"]),
    generatedFrom: z.string().min(1),
    slotLimits: z
      .object({
        mastery: z.literal(1),
        skill: z.literal(4),
        advancedAttack: z.literal(5),
        signature: z.literal(2),
        block: z.literal(2),
      })
      .strict(),
    moveIds: uniqueStrings,
    overlayHash: z.string().min(1),
    approvalReference: z.string().min(1).optional(),
  })
  .strict();
export type SimulationTf1Overlay = z.output<typeof simulationTf1OverlaySchema>;

export const simulationTemplateSchema = z
  .object({
    schemaVersion: z.literal(SIMULATION_CONTRACT_VERSION),
    id: simulationTemplateIdSchema,
    label: z.string().min(1),
    kind: z.enum(["tf1-source", "synthetic"]),
    checkpointId: z.string().min(1),
    source: sourceProvenanceSchema,
    raceId: z.string().min(1),
    classId: z.string().min(1),
    styleId: z.string().min(1),
    mastery: z.string().min(1),
    specializationPoints: nonNegativeInteger,
    specializationPointsDistribution: z
      .object({
        hp: nonNegativeInteger,
        power: nonNegativeInteger,
        dexterity: nonNegativeInteger,
        total: nonNegativeInteger,
      })
      .strict(),
    startingKiPolicy: z.literal("rules-default"),
    /** Values transcribed from a source sheet; omitted for generated fixtures. */
    startingKi: positiveInteger.optional(),
    maximumKi: positiveInteger.optional(),
    specialization: z
      .object({
        type: z.enum(["strength", "energy"]),
        level: positiveInteger,
        damageType: z.enum(["physical", "energy"]),
      })
      .strict()
      .optional(),
    transformationName: z.string().min(1).optional(),
    maximumHitPoints: finiteNumber.positive(),
    stats: z
      .object({
        power: finiteNumber.nonnegative(),
        dexterity: finiteNumber.nonnegative(),
        dexterityBonus: finiteNumber,
      })
      .strict(),
    raceTraitIds: uniqueStrings,
    moveIds: uniqueStrings,
    itemIds: uniqueStrings,
    /** Source quantities remain explicit even though the combat boundary uses unique item IDs. */
    itemQuantities: z.record(z.string().min(1), positiveInteger).optional(),
    transformationProfiles: z.array(transformationProfileSchema),
    loadoutOverlay: simulationTf1OverlaySchema.optional(),
    gaps: z.array(simulationGapSchema),
    aiProfileId: z.string().min(1),
  })
  .strict();
export type SimulationTemplate = z.output<typeof simulationTemplateSchema>;

export const simulationCheckpointSchema = z
  .object({ id: z.string().min(1), label: z.string().min(1), order: nonNegativeInteger })
  .strict();
export type SimulationCheckpoint = z.output<typeof simulationCheckpointSchema>;

export type SimulationTemplateValidationFailure = {
  readonly type:
    | "invalid-template"
    | "unknown-reference"
    | "duplicate-reference"
    | "incompatible-loadout"
    | "unsupported-template";
  readonly templateId?: string;
  readonly path?: string;
  readonly detail: string;
};

export type SimulationTemplateResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: SimulationTemplateValidationFailure };

export interface MaterializedSimulationTemplate {
  readonly templateId: SimulationTemplate["id"];
  readonly input: CreateFightInput["combatants"][number];
  readonly templateHash: string;
}

export const simulationMaterializationResultSchema = z
  .object({
    templateId: simulationTemplateIdSchema,
    templateHash: z.string().min(1),
    input: z.custom<CreateFightInput["combatants"][number]>(
      (value) => typeof value === "object" && value !== null,
    ),
  })
  .strict();

export const simulationLimitsSchema = z
  .object({
    maximumTurns: positiveInteger,
    maximumTransitions: positiveInteger,
    semanticNoProgressLimit: positiveInteger,
  })
  .strict();
export type SimulationLimits = z.output<typeof simulationLimitsSchema>;

export const simulationRetentionSchema = z.enum(["summary", "diagnostic"]);
export type SimulationRetention = z.output<typeof simulationRetentionSchema>;

export const simulationStoppingPolicySchema = z.enum(["continue", "fail-fast"]);
export type SimulationStoppingPolicy = z.output<typeof simulationStoppingPolicySchema>;

export const simulationScenarioSchema = z
  .object({
    schemaVersion: z.literal(SIMULATION_CONTRACT_VERSION),
    id: simulationScenarioIdSchema,
    family: z.enum([
      "symmetric-control",
      "archetype-cross-matchup",
      "mastery-style-matrix",
      "power-versus-dexterity",
      "burst-versus-defense",
      "control-versus-resource",
      "transformation-timing",
      "restricted-use-scarcity",
      "move-isolation",
      "combo-partner",
      "custom-move-replacement",
      "custom-move-addition",
    ]),
    checkpointId: z.string().min(1),
    templateAId: simulationTemplateIdSchema,
    templateBId: simulationTemplateIdSchema,
    variantId: simulationVariantIdSchema,
    retention: simulationRetentionSchema,
    limits: simulationLimitsSchema,
    stoppingPolicy: simulationStoppingPolicySchema,
    deferred: z.boolean(),
    note: z.string().optional(),
  })
  .strict();
export type SimulationScenario = z.output<typeof simulationScenarioSchema>;

export const simulationSeedKeySchema = z
  .object({
    schemaVersion: z.literal(SIMULATION_CONTRACT_VERSION),
    rootSeed: z
      .number()
      .int()
      .nonnegative()
      .max(2 ** 32 - 1),
    scenarioId: simulationScenarioIdSchema,
    scenarioHash: z.string().min(1),
    variantId: simulationVariantIdSchema,
    pairId: z.string().min(1),
    iteration: nonNegativeInteger,
    mirror: z.enum(["original", "mirrored"]),
    templateAHash: z.string().min(1),
    templateBHash: z.string().min(1),
    strategyAId: z.string().min(1),
    strategyBId: z.string().min(1),
    namespace: z.enum(["combat", "ai-a", "ai-b", "diagnostic-rerun"]),
  })
  .strict();
export type SimulationSeedKey = z.output<typeof simulationSeedKeySchema>;

export const simulationSeedManifestSchema = z
  .object({
    schemaVersion: z.literal(SIMULATION_CONTRACT_VERSION).optional(),
    rootSeed: z
      .number()
      .int()
      .nonnegative()
      .max(2 ** 32 - 1),
    derivationVersion: z.string().min(1),
    input: z.record(z.string(), z.unknown()),
    seed: z
      .number()
      .int()
      .nonnegative()
      .max(2 ** 32 - 1),
    key: simulationSeedKeySchema.optional(),
  })
  .strict();

export interface SimulationFightRequest {
  readonly schemaVersion: typeof SIMULATION_CONTRACT_VERSION;
  readonly runId: string;
  readonly scenario: SimulationScenario;
  readonly templateA: SimulationTemplate;
  readonly templateB: SimulationTemplate;
  readonly profileA: AiProfile;
  readonly profileB: AiProfile;
  readonly rootSeed: number;
  readonly iteration?: number;
  readonly mirror?: "original" | "mirrored";
  readonly fixedTime: Date;
  readonly mechanicsView: import("@dragonball-resurgence/combat-engine").CombatMechanicsView;
  readonly decisionPolicy?: SimulationDecisionPolicy;
}

export const simulationFightRequestSchema = z
  .object({
    schemaVersion: z.literal(SIMULATION_CONTRACT_VERSION),
    runId: z.string().min(1),
    scenario: simulationScenarioSchema,
    templateA: simulationTemplateSchema,
    templateB: simulationTemplateSchema,
    profileA: z.custom<AiProfile>((value) => typeof value === "object" && value !== null),
    profileB: z.custom<AiProfile>((value) => typeof value === "object" && value !== null),
    rootSeed: z
      .number()
      .int()
      .nonnegative()
      .max(2 ** 32 - 1),
    iteration: nonNegativeInteger.optional(),
    mirror: z.enum(["original", "mirrored"]).optional(),
    fixedTime: z.date(),
    mechanicsView: z.custom<import("@dragonball-resurgence/combat-engine").CombatMechanicsView>(
      (value) => typeof value === "object" && value !== null,
    ),
    decisionPolicy: simulationDecisionPolicySchema.optional(),
  })
  .strict();

export const simulationDiagnosticsSchema = z
  .object({
    legalSetHashes: z.array(z.string()),
    decisionHashes: z.array(z.string()),
    selectedDecisions: z.array(z.unknown()),
    evaluations: z.array(z.unknown()),
    eventHashes: z.array(z.string()),
    stateHashes: z.array(z.string()),
    semanticFingerprints: z.array(z.string()),
    calculationTraceCount: nonNegativeInteger,
    moveFunnels: z.record(z.string().min(1), simulationMoveFunnelSchema),
  })
  .strict();

export const simulationSeriesPlaceholderSchema = z
  .object({
    schemaVersion: z.literal(SIMULATION_CONTRACT_VERSION),
    seriesId: simulationSeriesIdSchema,
    requestCount: nonNegativeInteger,
    stoppingPolicy: simulationStoppingPolicySchema,
  })
  .strict();

export const simulationMatrixPlaceholderSchema = z
  .object({
    schemaVersion: z.literal(SIMULATION_CONTRACT_VERSION),
    scenarioCount: nonNegativeInteger,
    templateCount: nonNegativeInteger,
    expansionHash: z.string().min(1),
  })
  .strict();

export interface SimulationControl {
  readonly isCancelled?: () => boolean;
}

export interface SimulationProgress {
  readonly completed: number;
  readonly total: number;
  readonly runId: string;
  readonly result:
    | { readonly ok: true; readonly value: SimulationFightExecutionResult }
    | { readonly ok: false; readonly error: SimulationFailure };
}

export type SimulationFailure =
  | { readonly type: "malformed-input"; readonly detail: string }
  | { readonly type: "unknown-reference"; readonly detail: string }
  | { readonly type: "incompatible-loadout"; readonly detail: string }
  | { readonly type: "unsupported-scope"; readonly detail: string }
  | { readonly type: "combat-failure"; readonly failure: unknown }
  | { readonly type: "ai-failure"; readonly failure: unknown }
  | {
      readonly type: "exhausted-safeguard";
      readonly reason: "maximum-turns" | "maximum-transitions" | "semantic-no-progress";
    }
  | { readonly type: "cancelled" }
  | { readonly type: "unexpected-runner-failure"; readonly detail: string };

export type SimulationTerminationReason =
  | "engine-completed"
  | "maximum-turns"
  | "maximum-transitions"
  | "semantic-no-progress"
  | "cancelled"
  | "combat-failure"
  | "ai-failure"
  | "invalid-fixture"
  | "unsupported-scope";

export interface SimulationSummary {
  readonly actorActions: number;
  readonly pendingResponses: number;
  readonly completedActions: number;
  readonly moveUses: Readonly<Record<string, number>>;
  readonly itemUses: Readonly<Record<string, number>>;
  readonly damageByCombatant: Readonly<Record<string, number>>;
  readonly resources: Readonly<Record<string, { readonly hp: number; readonly ki: number }>>;
  readonly statuses: Readonly<Record<string, number>>;
  readonly transformations: number;
  readonly perDieOutcomes: Readonly<Record<string, number>>;
}

export interface SimulationDiagnostics {
  readonly legalSetHashes: readonly string[];
  readonly decisionHashes: readonly string[];
  readonly selectedDecisions: readonly LegalDecision[];
  readonly evaluations: readonly CandidateEvaluation[];
  readonly eventHashes: readonly string[];
  readonly stateHashes: readonly string[];
  readonly semanticFingerprints: readonly string[];
  readonly calculationTraceCount: number;
  readonly moveFunnels: Readonly<Record<string, SimulationMoveFunnel>>;
}

export interface SimulationReplayRecord {
  readonly schemaVersion: typeof SIMULATION_CONTRACT_VERSION;
  readonly replayVersion: "simulation-replay:v1";
  readonly manifestHash: string;
  readonly manifest: {
    readonly scopeVersion: string;
    readonly runId: string;
    readonly rootSeed: number;
    readonly scenario: SimulationScenario;
    readonly scenarioHash: string;
    readonly variantId: string;
    readonly templates: Readonly<{
      readonly a: Readonly<{ readonly id: string; readonly hash: string }>;
      readonly b: Readonly<{ readonly id: string; readonly hash: string }>;
    }>;
    readonly mechanics: Readonly<{
      readonly version: string;
      readonly contentHash: string;
      readonly catalogHash: string;
    }>;
    readonly fixedTime: string;
    readonly policies: Readonly<{
      readonly retention: SimulationRetention;
      readonly limits: SimulationLimits;
      readonly stoppingPolicy: SimulationStoppingPolicy;
    }>;
    readonly ai: Readonly<{
      readonly a: unknown;
      readonly b: unknown;
    }>;
    readonly seeds: Readonly<{
      readonly combat: number;
      readonly aiA: number;
      readonly aiB: number;
      readonly derivationVersion: string;
    }>;
  };
  readonly legalSetHashes: readonly string[];
  readonly decisions: readonly LegalDecision[];
  readonly transitionHashes: readonly string[];
  readonly stateHashes: readonly string[];
  readonly eventHashes: readonly string[];
  readonly terminal: Readonly<{
    readonly terminationReason: SimulationTerminationReason;
    readonly stateHash: string;
    readonly summary: SimulationSummary;
  }>;
}

export const simulationFailureSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("malformed-input"), detail: z.string() }),
  z.object({ type: z.literal("unknown-reference"), detail: z.string() }),
  z.object({ type: z.literal("incompatible-loadout"), detail: z.string() }),
  z.object({ type: z.literal("unsupported-scope"), detail: z.string() }),
  z.object({ type: z.literal("combat-failure"), failure: z.unknown() }),
  z.object({ type: z.literal("ai-failure"), failure: z.unknown() }),
  z.object({
    type: z.literal("exhausted-safeguard"),
    reason: z.enum(["maximum-turns", "maximum-transitions", "semantic-no-progress"]),
  }),
  z.object({ type: z.literal("cancelled") }),
  z.object({ type: z.literal("unexpected-runner-failure"), detail: z.string() }),
]);

export interface SimulationFightExecutionResult {
  readonly schemaVersion: typeof SIMULATION_CONTRACT_VERSION;
  readonly runId: string;
  readonly scenarioId: string;
  readonly pairId: string;
  readonly finalState: FightState;
  readonly completion?: import("@dragonball-resurgence/combat-engine").CompletedFightState["completion"];
  readonly terminationReason: SimulationTerminationReason;
  readonly failure?: SimulationFailure;
  readonly transitions: readonly CombatTransition[];
  readonly summary: SimulationSummary;
  readonly diagnostics?: SimulationDiagnostics;
  readonly stateHash: string;
  readonly eventHash: string;
  readonly decisionHash: string;
  readonly randomIdentity: string;
  readonly mechanicsView: MechanicsViewIdentity;
  readonly replay: SimulationReplayRecord;
}

export interface SimulationScenarioExpansion {
  readonly scenarios: readonly SimulationScenario[];
  readonly expansionHash: string;
  readonly checkpointCatalogHash?: string;
}

export interface SimulationClosureRow {
  readonly templateId: string;
  readonly sourcePath: string;
  readonly kind: SimulationTemplate["kind"];
  readonly materializable: boolean;
  readonly referenceValid: boolean;
  readonly profileAssigned: boolean;
  readonly scenarioCount: number;
  readonly gaps: readonly string[];
}

export interface SimulationClosureReport {
  readonly schemaVersion: typeof SIMULATION_CONTRACT_VERSION;
  readonly rows: readonly SimulationClosureRow[];
  readonly sourceSheetCount: number;
  readonly syntheticArchetypeCount: number;
  readonly reportHash: string;
}

export interface SimulationCoordinatorRequest {
  readonly requests: readonly SimulationFightRequest[];
  readonly stoppingPolicy: SimulationStoppingPolicy;
  /** Bounded deterministic scheduling for local or worker-backed execution. */
  readonly concurrency?: number;
  readonly control?: SimulationControl;
  readonly onProgress?: (progress: SimulationProgress) => void;
}

export interface SimulationCoordinatorResult {
  readonly results: readonly (
    | { readonly ok: true; readonly value: SimulationFightExecutionResult }
    | { readonly ok: false; readonly error: SimulationFailure }
  )[];
  readonly stoppedEarly: boolean;
}

export interface SimulationFightSpec {
  readonly schemaVersion: typeof SIMULATION_CONTRACT_VERSION;
  readonly iteration: number;
  readonly mirror: "original" | "mirrored";
  readonly pairId: string;
  readonly request: SimulationFightRequest;
}

export const simulationFightSpecSchema = z
  .object({
    schemaVersion: z.literal(SIMULATION_CONTRACT_VERSION),
    iteration: nonNegativeInteger,
    mirror: z.enum(["original", "mirrored"]),
    pairId: z.string().min(1),
    request: simulationFightRequestSchema,
  })
  .strict();

export interface SimulationSeriesRequest {
  readonly schemaVersion: typeof SIMULATION_CONTRACT_VERSION;
  readonly seriesId: string;
  readonly baseRequest: SimulationFightRequest;
  readonly iterations: number;
  readonly mirrored: boolean;
  readonly stoppingPolicy: SimulationStoppingPolicy;
  readonly concurrency?: number;
  readonly control?: SimulationControl;
  readonly onProgress?: (progress: SimulationProgress) => void;
  readonly checkpoint?: SimulationSeriesCheckpoint;
}

export const simulationSeriesRequestSchema = z
  .object({
    schemaVersion: z.literal(SIMULATION_CONTRACT_VERSION),
    seriesId: simulationSeriesIdSchema,
    baseRequest: simulationFightRequestSchema,
    iterations: positiveInteger,
    mirrored: z.boolean(),
    stoppingPolicy: simulationStoppingPolicySchema,
    concurrency: positiveInteger.optional(),
    control: z.custom<SimulationControl>().optional(),
    onProgress: z.custom<SimulationSeriesRequest["onProgress"]>().optional(),
    checkpoint: z.custom<SimulationSeriesCheckpoint>().optional(),
  })
  .strict();

export interface SimulationSeriesResult {
  readonly schemaVersion: typeof SIMULATION_CONTRACT_VERSION;
  readonly seriesId: string;
  readonly specs: readonly SimulationFightSpec[];
  readonly results: SimulationCoordinatorResult["results"];
  readonly stoppedEarly: boolean;
  readonly completedCount: number;
  readonly incompletePairCount: number;
  readonly resumedFightCount: number;
  readonly checkpoint: SimulationSeriesCheckpoint;
  readonly manifestHash: string;
  readonly pairedAggregate: Readonly<{
    readonly pairCount: number;
    readonly completePairs: number;
    readonly orientationCount: number;
  }>;
  readonly precisionStatus: SimulationPrecisionStatus;
  readonly resumability: Readonly<{
    readonly checkpointSchemaVersion: "simulation-checkpoint:v1";
    readonly resumedFightCount: number;
    readonly complete: boolean;
  }>;
  readonly seriesHash: string;
}

export interface SimulationMatrixRequest {
  readonly schemaVersion: typeof SIMULATION_CONTRACT_VERSION;
  readonly matrixId: string;
  readonly series: readonly SimulationSeriesRequest[];
  readonly maximumFights?: number;
  readonly control?: SimulationControl;
  readonly onProgress?: (progress: SimulationProgress) => void;
}

export const simulationMatrixRequestSchema = z
  .object({
    schemaVersion: z.literal(SIMULATION_CONTRACT_VERSION),
    matrixId: z.string().min(1),
    series: z.array(z.custom<SimulationSeriesRequest>()),
    maximumFights: positiveInteger.optional(),
    control: z.custom<SimulationControl>().optional(),
    onProgress: z.custom<SimulationMatrixRequest["onProgress"]>().optional(),
  })
  .strict();

export interface SimulationMatrixResult {
  readonly schemaVersion: typeof SIMULATION_CONTRACT_VERSION;
  readonly matrixId: string;
  readonly series: readonly SimulationSeriesResult[];
  readonly estimatedFightCount: number;
  readonly stoppedEarly: boolean;
  readonly manifestHash: string;
  readonly precisionStatus: SimulationPrecisionStatus;
  readonly matrixHash: string;
}

export interface SimulationSeriesCheckpointEntry {
  readonly fightIdentity: string;
  readonly resultHash: string;
  readonly status: "completed" | "error";
  readonly terminationReason?: SimulationTerminationReason;
}

export interface SimulationSeriesCheckpoint {
  readonly schemaVersion: "simulation-checkpoint:v1";
  readonly seriesId: string;
  readonly manifestHash: string;
  readonly entries: readonly SimulationSeriesCheckpointEntry[];
}

export const simulationSeriesCheckpointSchema = z
  .object({
    schemaVersion: z.literal("simulation-checkpoint:v1"),
    seriesId: simulationSeriesIdSchema,
    manifestHash: z.string().min(1),
    entries: z.array(
      z
        .object({
          fightIdentity: z.string().min(1),
          resultHash: z.string().min(1),
          status: z.enum(["completed", "error"]),
          terminationReason: z
            .enum([
              "engine-completed",
              "maximum-turns",
              "maximum-transitions",
              "semantic-no-progress",
              "cancelled",
              "combat-failure",
              "ai-failure",
              "invalid-fixture",
              "unsupported-scope",
            ])
            .optional(),
        })
        .strict(),
    ),
  })
  .strict();

export type SimulationDecision = CombatDecision;
export type SimulationEvent = CombatEvent;
