/* eslint-disable sonarjs/no-nested-conditional -- Availability classifications are a four-state discriminated result. */
import type {
  ActiveFightState,
  CombatMechanicObservation,
  FightState,
  LegalDecision,
} from "./contracts.js";
import type { CombatantId } from "./ids.js";
import type { CombatMechanicsView } from "./mechanics-view.js";
import { canonicalDecisionKey } from "./decision-descriptors.js";
import {
  enumerateLegalDecisions,
  probeLegalDecisionCosts,
  probeLegalDecisionScarcity,
} from "./progress-fight.js";

export type CombatActionAvailabilityClassification =
  "legal" | "timing-eligible-but-unaffordable" | "restricted" | "otherwise-unavailable";

export interface CombatActionAvailabilityEntry {
  readonly decision: LegalDecision;
  readonly classification: CombatActionAvailabilityClassification;
  readonly timingEligible: boolean;
  readonly affordable: boolean;
  readonly restricted: boolean;
  readonly reason?: string;
  readonly costs: ReturnType<typeof probeLegalDecisionCosts>;
  readonly scarcity: ReturnType<typeof probeLegalDecisionScarcity>;
}

export interface CombatActionAvailabilityReport {
  readonly schemaVersion: "combat-action-availability:v1";
  readonly stateVersion: number;
  readonly actorId: CombatantId;
  readonly entries: readonly CombatActionAvailabilityEntry[];
  readonly legal: readonly CombatActionAvailabilityEntry[];
  readonly timingEligibleButUnaffordable: readonly CombatActionAvailabilityEntry[];
  readonly restricted: readonly CombatActionAvailabilityEntry[];
  readonly otherwiseUnavailable: readonly CombatActionAvailabilityEntry[];
  /** Optional non-authoritative observation for simulation folding. */
  readonly mechanicObservations?: readonly CombatMechanicObservation[];
}

const opponentFor = (state: ActiveFightState, actorId: CombatantId): CombatantId | undefined =>
  Object.values(state.combatants).find((combatant) => combatant.id !== actorId)?.id;

const candidatesFor = (
  state: ActiveFightState,
  actorId: CombatantId,
  opponentId: CombatantId,
): readonly LegalDecision[] => {
  const actor = state.combatants[actorId];
  const basicAttacks: readonly LegalDecision[] = [
    { type: "basic-attack", actorId, basicAttack: "basic-punch", targetCombatantId: opponentId },
    { type: "basic-attack", actorId, basicAttack: "basic-kick", targetCombatantId: opponentId },
    {
      type: "basic-attack",
      actorId,
      basicAttack: "basic-ki-blast",
      targetCombatantId: opponentId,
    },
  ];
  const actions: LegalDecision[] = [
    ...basicAttacks,
    ...actor.moveIds.map((moveId) => ({
      type: "use-move" as const,
      actorId,
      moveId,
      targetCombatantId: opponentId,
    })),
    ...(state.phase === "action" || state.phase === "upkeep"
      ? (actor.itemIds ?? []).map((itemId) => ({ type: "use-item" as const, actorId, itemId }))
      : []),
    ...(state.phase === "action"
      ? (actor.transformationProfiles ?? []).map(({ transformationId }) => ({
          type: "activate-transformation" as const,
          actorId,
          transformationId,
        }))
      : []),
    ...(state.phase === "action" && actor.transformation !== undefined
      ? [{ type: "deactivate-transformation" as const, actorId }]
      : []),
    ...(state.phase === "action" || state.phase === "upkeep"
      ? ([
          { type: "pass" as const, actorId },
          { type: "power-up" as const, actorId },
        ] as const)
      : []),
    { type: "surrender", actorId },
  ];
  return actions;
};

const timingEligibleFor = (state: ActiveFightState, decision: LegalDecision): boolean => {
  if (decision.type === "respond-to-pending-decision") return state.pendingDecision !== undefined;
  if (decision.type === "surrender") return true;
  return state.phase === "action" || state.phase === "upkeep" || state.phase === "counter";
};

const entryFor = (
  state: ActiveFightState,
  decision: LegalDecision,
  legalKeys: ReadonlySet<string>,
): CombatActionAvailabilityEntry => {
  const legal = legalKeys.has(canonicalDecisionKey(decision));
  const timingEligible = timingEligibleFor(state, decision);
  const costs = probeLegalDecisionCosts(state, decision);
  const actor = state.combatants[decision.actorId];
  const affordable = costs.every(
    (cost) => cost.resource !== "ki" || cost.effective <= actor.ki.current,
  );
  const scarcity = probeLegalDecisionScarcity(state, decision);
  const restricted = scarcity.some((entry) => entry.remaining === 0);
  const classification: CombatActionAvailabilityClassification = legal
    ? "legal"
    : restricted
      ? "restricted"
      : timingEligible && !affordable
        ? "timing-eligible-but-unaffordable"
        : "otherwise-unavailable";
  return {
    decision,
    classification,
    timingEligible,
    affordable,
    restricted,
    ...(classification === "otherwise-unavailable"
      ? { reason: timingEligible ? "engine-restricted-or-ineligible" : "phase-not-eligible" }
      : {}),
    costs,
    scarcity,
  };
};

/**
 * Reports availability from combat-owned candidate construction and legal
 * enumeration. Consumers must not infer affordability or restriction from
 * simulation events.
 */
export const getCombatActionAvailabilityReport = (
  state: FightState,
  actorId: CombatantId,
  mechanicsView?: CombatMechanicsView,
): CombatActionAvailabilityReport => {
  if (state.status !== "active")
    return {
      schemaVersion: "combat-action-availability:v1",
      stateVersion: state.version,
      actorId,
      entries: [],
      legal: [],
      timingEligibleButUnaffordable: [],
      restricted: [],
      otherwiseUnavailable: [],
    };
  const legalDecisions = enumerateLegalDecisions(state, actorId, mechanicsView);
  const opponentId = opponentFor(state, actorId);
  const candidates =
    state.pendingDecision !== undefined || opponentId === undefined
      ? legalDecisions
      : [...candidatesFor(state, actorId, opponentId), ...legalDecisions];
  const unique = new Map<string, LegalDecision>();
  for (const decision of candidates) unique.set(canonicalDecisionKey(decision), decision);
  const legalKeys = new Set(legalDecisions.map(canonicalDecisionKey));
  const entries = [...unique.values()]
    .map((decision) => entryFor(state, decision, legalKeys))
    .sort((left, right) =>
      canonicalDecisionKey(left.decision).localeCompare(canonicalDecisionKey(right.decision)),
    );
  const by = (classification: CombatActionAvailabilityClassification) =>
    entries.filter((entry) => entry.classification === classification);
  return {
    schemaVersion: "combat-action-availability:v1",
    stateVersion: state.version,
    actorId,
    entries,
    legal: by("legal"),
    timingEligibleButUnaffordable: by("timing-eligible-but-unaffordable"),
    restricted: by("restricted"),
    otherwiseUnavailable: by("otherwise-unavailable"),
  };
};

export const enumerateCombatActionAvailability = getCombatActionAvailabilityReport;
