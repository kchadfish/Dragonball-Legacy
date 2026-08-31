import {
  createCombatRuntime,
  type CombatDecision,
  type CombatDependencies,
  type CombatResult,
  type CombatTransition,
  type FightState,
  type CombatDecisionPoint,
} from "@dragonball-resurgence/combat-engine";

/** Simulation consumes the combat-owned decision point without reconstructing ownership. */
export const getSimulationDecisionPoint = (
  state: FightState,
  runtime = createCombatRuntime(),
): CombatDecisionPoint => runtime.getDecisionPoint(state);

export const advanceSimulationFight = (
  state: FightState,
  dependencies: CombatDependencies,
  runtime = createCombatRuntime(dependencies.mechanicsView),
): CombatResult<CombatTransition> => runtime.advanceFight(state, dependencies);

export const submitSimulationDecision = (
  state: FightState,
  decision: CombatDecision,
  dependencies: CombatDependencies,
  runtime = createCombatRuntime(dependencies.mechanicsView),
): CombatResult<CombatTransition> => runtime.submitCombatDecision(state, decision, dependencies);

export const decisionPointRequiresActor = (
  point: CombatDecisionPoint,
): point is Extract<CombatDecisionPoint, { readonly type: "decision-required" }> =>
  point.type === "decision-required";
