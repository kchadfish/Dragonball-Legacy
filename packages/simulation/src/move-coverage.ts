import {
  CANONICAL_COMBAT_MECHANICS_VIEW,
  scopeDecisionForId,
  type CombatMechanicsView,
} from "@dragonball-resurgence/combat-engine";
import type { MoveDefinition } from "@dragonball-resurgence/game-data";
import { z } from "zod";

import { canonicalHash } from "./canonical.js";

const nonNegativeInteger = z.number().int().nonnegative();

export const SIMULATION_MOVE_COVERAGE_SCHEMA_VERSION = "simulation-move-coverage:v2" as const;
export type SimulationMechanicPath = "decision" | "trigger";
export const simulationMechanicPathSchema = z.enum(["decision", "trigger"]);
type SimulationMoveCoveragePopulation = "natural" | "isolation" | "forced";

export interface SimulationDecisionFunnel {
  readonly equipped: number;
  readonly eligible: number;
  readonly affordable: number;
  readonly selected: number;
  readonly submitted: number;
  readonly resolved: number;
  readonly successful: number;
  readonly valueProducing: number;
}

export interface SimulationTriggerFunnel {
  readonly applicable: number;
  readonly triggered: number;
  readonly activated: number;
  readonly resolved: number;
  readonly successful: number;
  readonly valueProducing: number;
}

export interface SimulationMoveFunnel {
  /** Flattened fields are retained for source compatibility; v2 reports use the typed funnels. */
  readonly equipped: number;
  readonly eligible: number;
  readonly affordable: number;
  readonly selected: number;
  readonly submitted: number;
  readonly resolved: number;
  readonly successful: number;
  readonly valueProducing: number;
  readonly decisionFunnel: SimulationDecisionFunnel;
  readonly triggerFunnel: SimulationTriggerFunnel;
}

const decisionFunnelSchema = z
  .object({
    equipped: nonNegativeInteger,
    eligible: nonNegativeInteger,
    affordable: nonNegativeInteger,
    selected: nonNegativeInteger,
    submitted: nonNegativeInteger,
    resolved: nonNegativeInteger,
    successful: nonNegativeInteger,
    valueProducing: nonNegativeInteger,
  })
  .strict()
  .superRefine((funnel, context) => {
    const values = [
      funnel.equipped,
      funnel.eligible,
      funnel.affordable,
      funnel.selected,
      funnel.submitted,
      funnel.resolved,
      funnel.successful,
      funnel.valueProducing,
    ];
    values.slice(1).forEach((value, index) => {
      if (value > values[index])
        context.addIssue({
          code: "custom",
          message: "Decision funnel counts cannot increase downstream.",
        });
    });
  });

const triggerFunnelSchema = z
  .object({
    applicable: nonNegativeInteger,
    triggered: nonNegativeInteger,
    activated: nonNegativeInteger,
    resolved: nonNegativeInteger,
    successful: nonNegativeInteger,
    valueProducing: nonNegativeInteger,
  })
  .strict()
  .superRefine((funnel, context) => {
    const values = [
      funnel.applicable,
      funnel.triggered,
      funnel.activated,
      funnel.resolved,
      funnel.successful,
      funnel.valueProducing,
    ];
    values.slice(1).forEach((value, index) => {
      if (value > values[index])
        context.addIssue({
          code: "custom",
          message: "Trigger funnel counts cannot increase downstream.",
        });
    });
  });

export const simulationMoveFunnelSchema = z
  .object({
    equipped: nonNegativeInteger,
    eligible: nonNegativeInteger,
    affordable: nonNegativeInteger,
    selected: nonNegativeInteger,
    submitted: nonNegativeInteger,
    resolved: nonNegativeInteger,
    successful: nonNegativeInteger,
    valueProducing: nonNegativeInteger,
    decisionFunnel: decisionFunnelSchema,
    triggerFunnel: triggerFunnelSchema,
  })
  .strict()
  .superRefine((funnel, context) => {
    const values = [
      funnel.equipped,
      funnel.eligible,
      funnel.affordable,
      funnel.selected,
      funnel.submitted,
      funnel.resolved,
      funnel.successful,
      funnel.valueProducing,
    ];
    values.slice(1).forEach((value, index) => {
      if (value > values[index])
        context.addIssue({
          code: "custom",
          message: "Move funnel counts cannot increase downstream.",
        });
    });
  });

export type SimulationMoveCoverageStatus =
  | "observed-sufficient"
  | "observed-low-sample"
  | "eligible-never-selected"
  | "never-eligible"
  | "incompatible-template"
  | "audited-out-of-scope"
  | "invalid-fixture"
  | "runner-failure"
  | "not-scheduled"
  // These values are accepted only by compatibility helpers and never pass v2 closure.
  | "unobserved"
  | "observed"
  | "sufficient"
  | "excluded";

export const simulationMoveCoverageStatusSchema = z.enum([
  "observed-sufficient",
  "observed-low-sample",
  "eligible-never-selected",
  "never-eligible",
  "incompatible-template",
  "audited-out-of-scope",
  "invalid-fixture",
  "runner-failure",
  "not-scheduled",
  "unobserved",
  "observed",
  "sufficient",
  "excluded",
]);

export interface SimulationMoveCoverageRecord {
  readonly schemaVersion: typeof SIMULATION_MOVE_COVERAGE_SCHEMA_VERSION;
  readonly moveId: string;
  readonly moveName: string;
  readonly category: string;
  readonly sourcePath: string;
  readonly capabilityIdentity: string;
  readonly funnel: SimulationMoveFunnel;
  readonly requiredMechanicPaths: readonly SimulationMechanicPath[];
  readonly naturalStatus: SimulationMoveCoverageStatus;
  readonly isolationStatus: SimulationMoveCoverageStatus;
  readonly forcedStatus: SimulationMoveCoverageStatus;
  readonly naturalExclusionReason?: string;
  readonly isolationExclusionReason?: string;
  readonly naturalScopeDecisionId?: string;
  readonly isolationScopeDecisionId?: string;
  readonly exclusionReason?: string;
}

export const simulationMoveCoverageRecordSchema = z
  .object({
    schemaVersion: z.literal(SIMULATION_MOVE_COVERAGE_SCHEMA_VERSION),
    moveId: z.string().min(1),
    moveName: z.string().min(1),
    category: z.string().min(1),
    sourcePath: z.string().min(1),
    capabilityIdentity: z.string().min(1),
    funnel: simulationMoveFunnelSchema,
    requiredMechanicPaths: z.array(simulationMechanicPathSchema).min(1),
    naturalStatus: simulationMoveCoverageStatusSchema,
    isolationStatus: simulationMoveCoverageStatusSchema,
    forcedStatus: simulationMoveCoverageStatusSchema,
    naturalExclusionReason: z.string().min(1).optional(),
    isolationExclusionReason: z.string().min(1).optional(),
    naturalScopeDecisionId: z.string().min(1).optional(),
    isolationScopeDecisionId: z.string().min(1).optional(),
    exclusionReason: z.string().min(1).optional(),
  })
  .strict();

export interface SimulationMoveCoverageDataset {
  readonly schemaVersion: typeof SIMULATION_MOVE_COVERAGE_SCHEMA_VERSION;
  readonly mechanicsIdentity: string;
  readonly records: readonly SimulationMoveCoverageRecord[];
  readonly datasetHash: string;
}

export const simulationMoveCoverageDatasetSchema = z
  .object({
    schemaVersion: z.literal(SIMULATION_MOVE_COVERAGE_SCHEMA_VERSION),
    mechanicsIdentity: z.string().min(1),
    records: z.array(simulationMoveCoverageRecordSchema),
    datasetHash: z.string().min(1),
  })
  .strict();

export interface SimulationMoveFunnelObservation {
  readonly equipped: boolean;
  readonly eligible: boolean;
  readonly affordable: boolean;
  readonly selected: boolean;
  readonly submitted: boolean;
  readonly resolved: boolean;
  readonly successful: boolean;
  readonly valueProducing: boolean;
}

const funnelFor = (): SimulationMoveFunnel => ({
  equipped: 0,
  eligible: 0,
  affordable: 0,
  selected: 0,
  submitted: 0,
  resolved: 0,
  successful: 0,
  valueProducing: 0,
  decisionFunnel: {
    equipped: 0,
    eligible: 0,
    affordable: 0,
    selected: 0,
    submitted: 0,
    resolved: 0,
    successful: 0,
    valueProducing: 0,
  },
  triggerFunnel: {
    applicable: 0,
    triggered: 0,
    activated: 0,
    resolved: 0,
    successful: 0,
    valueProducing: 0,
  },
});

const capabilityIdentityFor = (move: MoveDefinition): string =>
  canonicalHash({
    id: move.id,
    category: move.category,
    mechanics: move.mechanics,
    effectClauses: move.effectClauses,
    effects: move.effects,
    attack: move.attack,
  });

const recordFor = (move: MoveDefinition): SimulationMoveCoverageRecord =>
  Object.freeze({
    schemaVersion: SIMULATION_MOVE_COVERAGE_SCHEMA_VERSION,
    moveId: move.id,
    moveName: move.name,
    category: move.category,
    sourcePath: move.source.path,
    capabilityIdentity: capabilityIdentityFor(move),
    funnel: funnelFor(),
    requiredMechanicPaths: ["decision", "trigger"] as const,
    naturalStatus: "unobserved" as const,
    isolationStatus: "unobserved" as const,
    forcedStatus: "unobserved" as const,
  });

export const createSimulationMoveCoverageDataset = (
  mechanicsView: CombatMechanicsView = CANONICAL_COMBAT_MECHANICS_VIEW,
  suppliedRecords?: readonly SimulationMoveCoverageRecord[],
): SimulationMoveCoverageDataset => {
  const records =
    suppliedRecords === undefined
      ? [...mechanicsView.moves]
          .sort((left, right) => left.id.localeCompare(right.id))
          .map(recordFor)
      : [...suppliedRecords].sort((left, right) => left.moveId.localeCompare(right.moveId));
  const dataset = {
    schemaVersion: SIMULATION_MOVE_COVERAGE_SCHEMA_VERSION,
    mechanicsIdentity: mechanicsView.identity.contentHash,
    records: Object.freeze(records),
    datasetHash: canonicalHash({ mechanicsIdentity: mechanicsView.identity.contentHash, records }),
  } satisfies SimulationMoveCoverageDataset;
  return simulationMoveCoverageDatasetSchema.parse(dataset);
};

export const updateSimulationMoveCoverage = (
  record: SimulationMoveCoverageRecord,
  funnel: SimulationMoveFunnel,
  statuses: Partial<
    Pick<SimulationMoveCoverageRecord, "naturalStatus" | "isolationStatus" | "forcedStatus">
  >,
): SimulationMoveCoverageRecord =>
  (() => {
    const parsed = simulationMoveCoverageRecordSchema.safeParse({ ...record, funnel, ...statuses });
    if (!parsed.success)
      throw new RangeError(`Invalid move funnel for ${record.moveId}: ${JSON.stringify(funnel)}.`);
    return parsed.data;
  })();

const addFunnels = (
  left: SimulationMoveFunnel,
  right: SimulationMoveFunnel,
): SimulationMoveFunnel => ({
  equipped: left.equipped + right.equipped,
  eligible: left.eligible + right.eligible,
  affordable: left.affordable + right.affordable,
  selected: left.selected + right.selected,
  submitted: left.submitted + right.submitted,
  resolved: left.resolved + right.resolved,
  successful: left.successful + right.successful,
  valueProducing: left.valueProducing + right.valueProducing,
  decisionFunnel: {
    equipped: left.decisionFunnel.equipped + right.decisionFunnel.equipped,
    eligible: left.decisionFunnel.eligible + right.decisionFunnel.eligible,
    affordable: left.decisionFunnel.affordable + right.decisionFunnel.affordable,
    selected: left.decisionFunnel.selected + right.decisionFunnel.selected,
    submitted: left.decisionFunnel.submitted + right.decisionFunnel.submitted,
    resolved: left.decisionFunnel.resolved + right.decisionFunnel.resolved,
    successful: left.decisionFunnel.successful + right.decisionFunnel.successful,
    valueProducing: left.decisionFunnel.valueProducing + right.decisionFunnel.valueProducing,
  },
  triggerFunnel: {
    applicable: left.triggerFunnel.applicable + right.triggerFunnel.applicable,
    triggered: left.triggerFunnel.triggered + right.triggerFunnel.triggered,
    activated: left.triggerFunnel.activated + right.triggerFunnel.activated,
    resolved: left.triggerFunnel.resolved + right.triggerFunnel.resolved,
    successful: left.triggerFunnel.successful + right.triggerFunnel.successful,
    valueProducing: left.triggerFunnel.valueProducing + right.triggerFunnel.valueProducing,
  },
});

const statusFor = (
  funnel: SimulationMoveFunnel,
  targetFights: number,
  minimumEligibleStates: number,
): SimulationMoveCoverageStatus => {
  if (funnel.equipped === 0 && funnel.eligible === 0) return "unobserved";
  if (funnel.selected === 0) return "eligible-never-selected";
  if (funnel.resolved >= targetFights && funnel.eligible >= minimumEligibleStates)
    return "observed-sufficient";
  return "observed-low-sample";
};

/** Merge authoritative diagnostic funnel counts from completed runs. */
export const recordSimulationMoveFunnel = (
  dataset: SimulationMoveCoverageDataset,
  moveFunnels: Readonly<Partial<Record<string, SimulationMoveFunnel>>>,
  population: SimulationMoveCoveragePopulation,
  options: { readonly targetFights?: number; readonly minimumEligibleStates?: number } = {},
): SimulationMoveCoverageDataset => {
  const targetFights = options.targetFights ?? 10;
  const minimumEligibleStates = options.minimumEligibleStates ?? 10;
  if (!Number.isInteger(targetFights) || targetFights < 1 || targetFights > 10_000)
    throw new RangeError("Coverage target fights must be from 1 through 10,000.");
  if (!Number.isInteger(minimumEligibleStates) || minimumEligibleStates < 1)
    throw new RangeError("Coverage minimum eligible states must be positive.");
  const records = dataset.records.map((record) => {
    const observed = moveFunnels[record.moveId];
    if (observed === undefined) return record;
    const funnel = addFunnels(record.funnel, observed);
    const status = statusFor(funnel, targetFights, minimumEligibleStates);
    return updateSimulationMoveCoverage(record, funnel, {
      naturalStatus: population === "natural" ? status : record.naturalStatus,
      isolationStatus: population === "isolation" ? status : record.isolationStatus,
      forcedStatus: population === "forced" ? status : record.forcedStatus,
    });
  });
  return {
    ...dataset,
    records: Object.freeze(records),
    datasetHash: canonicalHash({ mechanicsIdentity: dataset.mechanicsIdentity, records }),
  };
};

export const excludeSimulationMoveCoverage = (
  record: SimulationMoveCoverageRecord,
  population: SimulationMoveCoveragePopulation,
  reason: string,
): SimulationMoveCoverageRecord => {
  if (reason.trim().length === 0) throw new RangeError("Coverage exclusions require a reason.");
  let fields:
    | { readonly naturalStatus: "excluded"; readonly naturalExclusionReason: string }
    | { readonly isolationStatus: "excluded"; readonly isolationExclusionReason: string }
    | { readonly forcedStatus: "excluded"; readonly exclusionReason: string };
  if (population === "natural")
    fields = { naturalStatus: "excluded", naturalExclusionReason: reason };
  else if (population === "isolation")
    fields = { isolationStatus: "excluded", isolationExclusionReason: reason };
  else fields = { forcedStatus: "excluded", exclusionReason: reason };
  return simulationMoveCoverageRecordSchema.parse({ ...record, ...fields });
};

export const recordSimulationMoveObservation = (
  record: SimulationMoveCoverageRecord,
  observation: SimulationMoveFunnelObservation,
  population: SimulationMoveCoveragePopulation,
): SimulationMoveCoverageRecord => {
  const stages = [
    observation.equipped,
    observation.eligible,
    observation.affordable,
    observation.selected,
    observation.submitted,
    observation.resolved,
    observation.successful,
    observation.valueProducing,
  ];
  if (stages.some((stage, index) => index > 0 && stage && !stages[index - 1]))
    throw new RangeError("Move funnel observations must be monotonic.");
  const increment = (value: boolean): number => (value ? 1 : 0);
  const funnel = addFunnels(record.funnel, {
    equipped: increment(observation.equipped),
    eligible: increment(observation.eligible),
    affordable: increment(observation.affordable),
    selected: increment(observation.selected),
    submitted: increment(observation.submitted),
    resolved: increment(observation.resolved),
    successful: increment(observation.successful),
    valueProducing: increment(observation.valueProducing),
    decisionFunnel: {
      equipped: increment(observation.equipped),
      eligible: increment(observation.eligible),
      affordable: increment(observation.affordable),
      selected: increment(observation.selected),
      submitted: increment(observation.submitted),
      resolved: increment(observation.resolved),
      successful: increment(observation.successful),
      valueProducing: increment(observation.valueProducing),
    },
    triggerFunnel: {
      applicable: 0,
      triggered: 0,
      activated: 0,
      resolved: 0,
      successful: 0,
      valueProducing: 0,
    },
  });
  return updateSimulationMoveCoverage(record, funnel, {
    naturalStatus: population === "natural" ? "observed" : record.naturalStatus,
    isolationStatus: population === "isolation" ? "observed" : record.isolationStatus,
    forcedStatus: population === "forced" ? "observed" : record.forcedStatus,
  });
};

export const validateSimulationMoveClosure = (
  dataset: SimulationMoveCoverageDataset,
  reviewedExclusions: Readonly<Partial<Record<string, string>>> = {},
  mechanicsView: CombatMechanicsView = CANONICAL_COMBAT_MECHANICS_VIEW,
): readonly string[] => {
  const issues: string[] = [];
  if (dataset.mechanicsIdentity !== mechanicsView.identity.contentHash)
    issues.push("Move coverage mechanics identity does not match the canonical mechanics view.");
  const ids = new Set<string>();
  const expectedIds = new Set(mechanicsView.moves.map((move) => move.id));
  const sufficient = (status: SimulationMoveCoverageStatus): boolean =>
    status === "observed-sufficient" || status === "sufficient";
  const validateStatus = (
    record: SimulationMoveCoverageRecord,
    population: "natural" | "isolation",
    status: SimulationMoveCoverageStatus,
    decisionId: string | undefined,
  ): void => {
    if (sufficient(status)) return;
    if (status === "audited-out-of-scope" && decisionId !== undefined) {
      if (scopeDecisionForId(decisionId) === undefined)
        issues.push(
          `Unregistered ${population} scope decision for ${record.moveId}: ${decisionId}`,
        );
      return;
    }
    // A free-text reason is intentionally not evidence of scope exclusion.
    issues.push(
      status === "observed"
        ? `Move lacks sufficient ${population} coverage or reviewed exclusion: ${record.moveId}`
        : `Move lacks sufficient ${population} coverage or reviewed exclusion: ${record.moveId} (a registered scope decision is required).`,
    );
  };
  for (const record of dataset.records) {
    if (ids.has(record.moveId)) issues.push(`Duplicate move coverage record: ${record.moveId}`);
    ids.add(record.moveId);
    if (!expectedIds.has(record.moveId))
      issues.push(`Unknown move coverage record: ${record.moveId}`);
    validateStatus(
      record,
      "natural",
      record.naturalStatus,
      record.naturalScopeDecisionId ?? reviewedExclusions[`${record.moveId}:natural`],
    );
    validateStatus(
      record,
      "isolation",
      record.isolationStatus,
      record.isolationScopeDecisionId ?? reviewedExclusions[`${record.moveId}:isolation`],
    );
    if (record.requiredMechanicPaths.length === 0)
      issues.push(`Move has no required mechanic paths: ${record.moveId}`);
  }
  for (const moveId of expectedIds)
    if (!ids.has(moveId)) issues.push(`Missing move coverage record: ${moveId}`);
  return issues;
};
