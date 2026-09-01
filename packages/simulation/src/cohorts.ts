import type { CombatMechanicsView } from "@dragonball-resurgence/combat-engine";
import { z } from "zod";

import { canonicalHash } from "./canonical.js";

export interface SimulationComparableCohortCriteria {
  readonly category: string;
  readonly timing: string;
  readonly scope: string;
  readonly acquisition: string;
  readonly resourceModel: string;
  readonly role: string;
  readonly effects: readonly string[];
  readonly usageContext: string;
}

export interface SimulationComparableCohort {
  readonly schemaVersion: "simulation-comparable-cohort:v1";
  readonly cohortId: string;
  readonly anchorMoveId: string;
  readonly memberMoveIds: readonly string[];
  readonly criteria: SimulationComparableCohortCriteria;
  readonly source: "generated" | "staff-override";
  readonly rationale?: string;
  readonly cohortHash: string;
}

export const simulationComparableCohortSchema = z
  .object({
    schemaVersion: z.literal("simulation-comparable-cohort:v1"),
    cohortId: z.string().min(1),
    anchorMoveId: z.string().min(1),
    memberMoveIds: z.array(z.string().min(1)),
    criteria: z
      .object({
        category: z.string(),
        timing: z.string(),
        scope: z.string(),
        acquisition: z.string(),
        resourceModel: z.string(),
        role: z.string(),
        effects: z.array(z.string()),
        usageContext: z.string(),
      })
      .strict(),
    source: z.enum(["generated", "staff-override"]),
    rationale: z.string().optional(),
    cohortHash: z.string().min(1),
  })
  .strict();

export const createSimulationComparableCohort = (
  mechanicsView: CombatMechanicsView,
  anchorMoveId: string,
  criteria: SimulationComparableCohortCriteria,
  staffOverride?: { readonly memberMoveIds: readonly string[]; readonly rationale: string },
): SimulationComparableCohort => {
  const anchor = mechanicsView.indexes.moves.get(anchorMoveId);
  if (anchor === undefined) throw new RangeError(`Unknown cohort anchor move: ${anchorMoveId}.`);
  const memberMoveIds =
    staffOverride?.memberMoveIds ??
    [...mechanicsView.moves]
      .filter((move) => move.id !== anchorMoveId && move.category === anchor.category)
      .map((move) => move.id)
      .sort((left, right) => left.localeCompare(right));
  const unknownIds = memberMoveIds.filter((moveId) => !mechanicsView.indexes.moves.has(moveId));
  if (unknownIds.length > 0) throw new RangeError(`Unknown comparable move: ${unknownIds[0]}.`);
  const cohort = {
    schemaVersion: "simulation-comparable-cohort:v1" as const,
    cohortId: `simulation-cohort:${anchorMoveId.replaceAll(":", "-")}`,
    anchorMoveId,
    memberMoveIds: Object.freeze(
      [...new Set(memberMoveIds)].sort((left, right) => left.localeCompare(right)),
    ),
    criteria,
    source: staffOverride ? ("staff-override" as const) : ("generated" as const),
    ...(staffOverride ? { rationale: staffOverride.rationale } : {}),
    cohortHash: canonicalHash({ anchorMoveId, memberMoveIds, criteria, staffOverride }),
  } satisfies SimulationComparableCohort;
  return Object.freeze(cohort);
};
