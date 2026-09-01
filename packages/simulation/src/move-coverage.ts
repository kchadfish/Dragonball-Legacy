import {
  CANONICAL_COMBAT_MECHANICS_VIEW,
  type CombatMechanicsView,
} from "@dragonball-resurgence/combat-engine";
import type { MoveDefinition } from "@dragonball-resurgence/game-data";
import { z } from "zod";

import { canonicalHash } from "./canonical.js";

const nonNegativeInteger = z.number().int().nonnegative();

export interface SimulationMoveFunnel {
  readonly equipped: number;
  readonly eligible: number;
  readonly affordable: number;
  readonly selected: number;
  readonly submitted: number;
  readonly resolved: number;
  readonly successful: number;
  readonly valueProducing: number;
}

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

export type SimulationMoveCoverageStatus = "unobserved" | "observed" | "sufficient" | "excluded";

export interface SimulationMoveCoverageRecord {
  readonly schemaVersion: "simulation-move-coverage:v1";
  readonly moveId: string;
  readonly moveName: string;
  readonly category: string;
  readonly sourcePath: string;
  readonly capabilityIdentity: string;
  readonly funnel: SimulationMoveFunnel;
  readonly naturalStatus: SimulationMoveCoverageStatus;
  readonly isolationStatus: SimulationMoveCoverageStatus;
  readonly naturalExclusionReason?: string;
  readonly isolationExclusionReason?: string;
  readonly exclusionReason?: string;
}

export const simulationMoveCoverageRecordSchema = z
  .object({
    schemaVersion: z.literal("simulation-move-coverage:v1"),
    moveId: z.string().min(1),
    moveName: z.string().min(1),
    category: z.string().min(1),
    sourcePath: z.string().min(1),
    capabilityIdentity: z.string().min(1),
    funnel: simulationMoveFunnelSchema,
    naturalStatus: z.enum(["unobserved", "observed", "sufficient", "excluded"]),
    isolationStatus: z.enum(["unobserved", "observed", "sufficient", "excluded"]),
    naturalExclusionReason: z.string().min(1).optional(),
    isolationExclusionReason: z.string().min(1).optional(),
    exclusionReason: z.string().min(1).optional(),
  })
  .strict();

export interface SimulationMoveCoverageDataset {
  readonly schemaVersion: "simulation-move-coverage:v1";
  readonly mechanicsIdentity: string;
  readonly records: readonly SimulationMoveCoverageRecord[];
  readonly datasetHash: string;
}

export const simulationMoveCoverageDatasetSchema = z
  .object({
    schemaVersion: z.literal("simulation-move-coverage:v1"),
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
    schemaVersion: "simulation-move-coverage:v1" as const,
    moveId: move.id,
    moveName: move.name,
    category: move.category,
    sourcePath: move.source.path,
    capabilityIdentity: capabilityIdentityFor(move),
    funnel: funnelFor(),
    naturalStatus: "unobserved" as const,
    isolationStatus: "unobserved" as const,
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
  return {
    schemaVersion: "simulation-move-coverage:v1",
    mechanicsIdentity: mechanicsView.identity.contentHash,
    records: Object.freeze(records),
    datasetHash: canonicalHash({ mechanicsIdentity: mechanicsView.identity.contentHash, records }),
  };
};

export const updateSimulationMoveCoverage = (
  record: SimulationMoveCoverageRecord,
  funnel: SimulationMoveFunnel,
  statuses: Pick<SimulationMoveCoverageRecord, "naturalStatus" | "isolationStatus">,
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
): SimulationMoveFunnel =>
  Object.fromEntries(
    Object.keys(left).map((stage) => [
      stage,
      left[stage as keyof SimulationMoveFunnel] + right[stage as keyof SimulationMoveFunnel],
    ]),
  ) as unknown as SimulationMoveFunnel;

const statusFor = (funnel: SimulationMoveFunnel): SimulationMoveCoverageStatus => {
  if (funnel.equipped === 0 && funnel.eligible === 0) return "unobserved";
  return "observed";
};

/**
 * Merges authoritative diagnostic funnel counts from one or more completed
 * runs. The runner supplies these counts from legal decisions and structured
 * combat events; simulation does not infer legality or outcomes itself.
 */
export const recordSimulationMoveFunnel = (
  dataset: SimulationMoveCoverageDataset,
  moveFunnels: Readonly<Partial<Record<string, SimulationMoveFunnel>>>,
  population: "natural" | "isolation",
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
    const status = statusFor(funnel);
    return updateSimulationMoveCoverage(record, funnel, {
      naturalStatus: population === "natural" ? status : record.naturalStatus,
      isolationStatus: population === "isolation" ? status : record.isolationStatus,
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
  population: "natural" | "isolation",
  reason: string,
): SimulationMoveCoverageRecord => {
  if (reason.trim().length === 0) throw new RangeError("Coverage exclusions require a reason.");
  return simulationMoveCoverageRecordSchema.parse({
    ...record,
    ...(population === "natural"
      ? { naturalStatus: "excluded", naturalExclusionReason: reason }
      : { isolationStatus: "excluded", isolationExclusionReason: reason }),
  });
};

export const recordSimulationMoveObservation = (
  record: SimulationMoveCoverageRecord,
  observation: SimulationMoveFunnelObservation,
  population: "natural" | "isolation",
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
  const funnel = Object.fromEntries(
    Object.keys(record.funnel).map((stage) => [
      stage,
      record.funnel[stage as keyof SimulationMoveFunnel] +
        (observation[stage as keyof SimulationMoveFunnelObservation] ? 1 : 0),
    ]),
  ) as unknown as SimulationMoveFunnel;
  return updateSimulationMoveCoverage(record, funnel, {
    naturalStatus: population === "natural" ? "observed" : record.naturalStatus,
    isolationStatus: population === "isolation" ? "observed" : record.isolationStatus,
  });
};

/* eslint-disable sonarjs/cognitive-complexity, complexity -- Closure validation checks two populations and catalog identity in one report. */
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
  for (const record of dataset.records) {
    if (ids.has(record.moveId)) issues.push(`Duplicate move coverage record: ${record.moveId}`);
    ids.add(record.moveId);
    if (!expectedIds.has(record.moveId))
      issues.push(`Unknown move coverage record: ${record.moveId}`);
    const naturalExclusion =
      record.naturalExclusionReason ??
      reviewedExclusions[`${record.moveId}:natural`] ??
      reviewedExclusions[record.moveId];
    const isolationExclusion =
      record.isolationExclusionReason ??
      reviewedExclusions[`${record.moveId}:isolation`] ??
      reviewedExclusions[record.moveId];
    if (record.naturalStatus !== "sufficient" && naturalExclusion === undefined)
      issues.push(`Move lacks sufficient natural coverage or reviewed exclusion: ${record.moveId}`);
    if (record.isolationStatus !== "sufficient" && isolationExclusion === undefined)
      issues.push(
        `Move lacks sufficient isolation coverage or reviewed exclusion: ${record.moveId}`,
      );
    if (record.naturalStatus === "excluded" && naturalExclusion === undefined)
      issues.push(`Excluded natural coverage lacks a reviewed reason: ${record.moveId}`);
    if (record.isolationStatus === "excluded" && isolationExclusion === undefined)
      issues.push(`Excluded isolation coverage lacks a reviewed reason: ${record.moveId}`);
  }
  for (const moveId of expectedIds)
    if (!ids.has(moveId)) issues.push(`Missing move coverage record: ${moveId}`);
  return issues;
};
/* eslint-enable sonarjs/cognitive-complexity, complexity */
