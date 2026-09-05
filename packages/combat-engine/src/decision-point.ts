import type { CompletedFightState, FightState, LegalDecision } from "./contracts.js";
import type { CombatantId } from "./ids.js";
import { enumerateLegalDecisions } from "./progress-fight.js";
import type { CombatMechanicsView } from "./mechanics-view.js";

export type NonEmptyLegalDecisions = readonly [LegalDecision, ...LegalDecision[]];

const legalDecisionCache = new WeakMap<FightState, Map<string, readonly LegalDecision[]>>();

const legalDecisionCacheKeyFor = (
  state: FightState,
  actorId: CombatantId,
  mechanicsView: CombatMechanicsView | undefined,
): string =>
  `${mechanicsView?.identity.contentHash ?? state.mechanicsView?.contentHash ?? "state-view"}:${actorId}`;

/** Reuses the immutable legal set for one state without changing its source. */
export const cachedLegalDecisionsFor = (
  state: FightState,
  actorId: CombatantId,
  mechanicsView?: CombatMechanicsView,
): readonly LegalDecision[] => {
  const key = legalDecisionCacheKeyFor(state, actorId, mechanicsView);
  const cachedByActor = legalDecisionCache.get(state);
  const cached = cachedByActor?.get(key);
  if (cached !== undefined) return cached;
  const legalDecisions = enumerateLegalDecisions(state, actorId, mechanicsView);
  const nextCache = cachedByActor ?? new Map<string, readonly LegalDecision[]>();
  nextCache.set(key, legalDecisions);
  if (cachedByActor === undefined) legalDecisionCache.set(state, nextCache);
  return legalDecisions;
};

const requiredLegalDecisions = (
  state: FightState,
  actorId: CombatantId,
  mechanicsView: CombatMechanicsView | undefined,
): NonEmptyLegalDecisions => {
  const legalDecisions = cachedLegalDecisionsFor(state, actorId, mechanicsView);
  if (legalDecisions.length === 0)
    throw new RangeError(
      `Combat decision point has no legal decisions for ${actorId} at state version ${state.version}.`,
    );
  return legalDecisions as NonEmptyLegalDecisions;
};

/** Combat-owned instruction for the next ordinary transition boundary. */
export type CombatDecisionPoint =
  | {
      readonly type: "advance";
      readonly stateVersion: number;
    }
  | {
      readonly type: "decision-required";
      readonly stateVersion: number;
      readonly actorId: CombatantId;
      readonly legalDecisions: NonEmptyLegalDecisions;
    }
  | {
      readonly type: "completed";
      readonly completion: CompletedFightState["completion"];
    };

/**
 * Identifies whether a caller should advance, request a decision, or stop.
 * Phase and pending-decision ownership remain private combat-flow knowledge.
 */
export const getCombatDecisionPoint = (
  state: FightState,
  mechanicsView?: CombatMechanicsView,
): CombatDecisionPoint => {
  if (state.status === "completed") return { type: "completed", completion: state.completion };
  if (state.pendingDecision !== undefined) {
    const actorId = state.pendingDecision.combatantId;
    return {
      type: "decision-required",
      stateVersion: state.version,
      actorId,
      legalDecisions: requiredLegalDecisions(state, actorId, mechanicsView),
    };
  }
  if (state.phase === "action" || state.phase === "counter") {
    const actorId = state.activeCombatantId;
    return {
      type: "decision-required",
      stateVersion: state.version,
      actorId,
      legalDecisions: requiredLegalDecisions(state, actorId, mechanicsView),
    };
  }
  return { type: "advance", stateVersion: state.version };
};
