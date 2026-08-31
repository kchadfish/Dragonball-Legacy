import {
  createCombatSemanticProgressIdentity,
  hasSameCombatSemanticProgress,
  type CombatSemanticProgressIdentity,
  type FightState,
} from "@dragonball-resurgence/combat-engine";

export type SimulationSemanticProgressIdentity = CombatSemanticProgressIdentity;

/** No-progress comparison is delegated to combat-engine's public identity. */
export const createSimulationSemanticProgressIdentity = (
  state: FightState,
): SimulationSemanticProgressIdentity => createCombatSemanticProgressIdentity(state);

export const hasSameSimulationSemanticProgress = (left: FightState, right: FightState): boolean =>
  hasSameCombatSemanticProgress(left, right);
