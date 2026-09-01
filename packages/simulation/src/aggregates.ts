import { canonicalHash } from "./canonical.js";
import type { SimulationSeriesResult } from "./contracts.js";
import {
  addSimulationValue,
  createSimulationMeanVariance,
  simulationStandardDeviation,
  simulationVariance,
  type SimulationMeanVariance,
} from "./statistics.js";

export interface SimulationAggregateSummary {
  readonly schemaVersion: "simulation-aggregate-summary:v1";
  readonly sampleCount: number;
  readonly completedCount: number;
  readonly missingCount: number;
  readonly errorCount: number;
  readonly terminationCounts: Readonly<Record<string, number>>;
  readonly actorActions: SimulationMeanVariance;
  readonly pendingResponses: SimulationMeanVariance;
  readonly transformations: SimulationMeanVariance;
  readonly turns: SimulationMeanVariance;
  readonly actorActionsVariance: number;
  readonly turnsStandardDeviation: number;
  readonly summaryHash: string;
}

export const summarizeSimulationResults = (
  results: SimulationSeriesResult["results"],
): SimulationAggregateSummary => {
  let actorActions = createSimulationMeanVariance();
  let pendingResponses = createSimulationMeanVariance();
  let transformations = createSimulationMeanVariance();
  let turns = createSimulationMeanVariance();
  const terminationCounts: Record<string, number> = {};
  let errorCount = 0;
  for (const result of results) {
    if (!result.ok) {
      errorCount += 1;
      continue;
    }
    const value = result.value;
    terminationCounts[value.terminationReason] =
      (terminationCounts[value.terminationReason] ?? 0) + 1;
    actorActions = addSimulationValue(actorActions, value.summary.actorActions);
    pendingResponses = addSimulationValue(pendingResponses, value.summary.pendingResponses);
    transformations = addSimulationValue(transformations, value.summary.transformations);
    turns = addSimulationValue(turns, value.finalState.turnNumber);
  }
  const completedCount = results.filter((result) => result.ok).length;
  const summary = {
    schemaVersion: "simulation-aggregate-summary:v1" as const,
    sampleCount: results.length,
    completedCount,
    missingCount: results.length - completedCount - errorCount,
    errorCount,
    terminationCounts: Object.fromEntries(
      Object.entries(terminationCounts).sort(([left], [right]) => left.localeCompare(right)),
    ),
    actorActions,
    pendingResponses,
    transformations,
    turns,
    actorActionsVariance: simulationVariance(actorActions),
    turnsStandardDeviation: simulationStandardDeviation(turns),
    summaryHash: "",
  } satisfies Omit<SimulationAggregateSummary, "summaryHash"> & { summaryHash: string };
  return {
    ...summary,
    summaryHash: canonicalHash({ ...summary, summaryHash: undefined }),
  };
};
