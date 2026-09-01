import type { SimulationLimits, SimulationSeriesRequest } from "./contracts.js";

export interface SimulationBudget {
  readonly maximumFights: number;
  readonly maximumTransitions: number;
  readonly maximumDiagnosticTransitions: number;
  readonly maximumOutputBytes: number;
}

export interface SimulationBudgetEstimate {
  readonly fights: number;
  readonly transitions: number;
  readonly diagnosticTransitions: number;
  readonly outputBytes: number;
  readonly withinBudget: boolean;
}

const fightsFor = (request: SimulationSeriesRequest): number =>
  request.iterations * (request.mirrored ? 2 : 1);

export const estimateSimulationBudget = (
  request: SimulationSeriesRequest,
  budget: SimulationBudget,
): SimulationBudgetEstimate => {
  const fights = fightsFor(request);
  const limits: SimulationLimits = request.baseRequest.scenario.limits;
  const transitions = fights * limits.maximumTransitions;
  const diagnosticTransitions =
    request.baseRequest.scenario.retention === "diagnostic" ? transitions : 0;
  const outputBytes = diagnosticTransitions * 160;
  return {
    fights,
    transitions,
    diagnosticTransitions,
    outputBytes,
    withinBudget:
      fights <= budget.maximumFights &&
      transitions <= budget.maximumTransitions &&
      diagnosticTransitions <= budget.maximumDiagnosticTransitions &&
      outputBytes <= budget.maximumOutputBytes,
  };
};

export const assertSimulationBudget = (
  request: SimulationSeriesRequest,
  budget: SimulationBudget,
): SimulationBudgetEstimate => {
  const estimate = estimateSimulationBudget(request, budget);
  if (!estimate.withinBudget)
    throw new RangeError("Simulation budget estimate exceeds a configured limit.");
  return estimate;
};
