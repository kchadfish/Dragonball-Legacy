import type { CompletedFightState, FightState, LegalDecision } from "./contracts.js";
import type { CombatantId } from "./ids.js";
import { enumerateLegalDecisions } from "./progress-fight.js";
import type { CombatMechanicsView } from "./mechanics-view.js";

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
      readonly legalDecisions: readonly LegalDecision[];
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
      legalDecisions: enumerateLegalDecisions(state, actorId, mechanicsView),
    };
  }
  if (state.phase === "action" || state.phase === "counter") {
    const actorId = state.activeCombatantId;
    return {
      type: "decision-required",
      stateVersion: state.version,
      actorId,
      legalDecisions: enumerateLegalDecisions(state, actorId, mechanicsView),
    };
  }
  return { type: "advance", stateVersion: state.version };
};
