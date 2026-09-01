import type { SimulationFightExecutionResult } from "./contracts.js";
import type { SimulationFightRequest, SimulationReplayRecord } from "./contracts.js";
import { z } from "zod";
import { canonicalHash } from "./canonical.js";
import { verifySimulationReplay, type ReplayVerificationResult } from "./replay.js";

const finiteNumber = z.number().refine(Number.isFinite, "Number must be finite.");

export interface SimulationAnomalyRule {
  readonly id: string;
  readonly version: "simulation-anomaly-rules:v1";
  readonly code: "semantic-loop" | "control-lockout" | "resource-cycle" | "no-progress";
  readonly threshold: number;
  readonly population: string;
  readonly recommendation: string;
}

export interface SimulationAnomalyFinding {
  readonly schemaVersion: "simulation-anomaly-finding:v1";
  readonly ruleId: string;
  readonly code: SimulationAnomalyRule["code"];
  readonly metric: string;
  readonly threshold: number;
  readonly observedValue: number;
  readonly sampleCount: number;
  readonly uncertainty: "not-estimated" | "wilson-95" | "paired-bootstrap-95";
  readonly confounders: readonly string[];
  readonly representativeRunIds: readonly string[];
  readonly recommendation: string;
  readonly findingHash: string;
}

export const simulationAnomalyRuleSchema = z
  .object({
    id: z.string().min(1),
    version: z.literal("simulation-anomaly-rules:v1"),
    code: z.enum(["semantic-loop", "control-lockout", "resource-cycle", "no-progress"]),
    threshold: finiteNumber,
    population: z.string().min(1),
    recommendation: z.string().min(1),
  })
  .strict();

export const simulationAnomalyFindingSchema = z
  .object({
    schemaVersion: z.literal("simulation-anomaly-finding:v1"),
    ruleId: z.string().min(1),
    code: z.enum(["semantic-loop", "control-lockout", "resource-cycle", "no-progress"]),
    metric: z.string().min(1),
    threshold: finiteNumber,
    observedValue: finiteNumber,
    sampleCount: z.number().int().nonnegative(),
    uncertainty: z.enum(["not-estimated", "wilson-95", "paired-bootstrap-95"]),
    confounders: z.array(z.string()),
    representativeRunIds: z.array(z.string().min(1)),
    recommendation: z.string().min(1),
    findingHash: z.string().min(1),
  })
  .strict();

export const DEFAULT_SIMULATION_ANOMALY_RULES: readonly SimulationAnomalyRule[] = Object.freeze([
  {
    id: "simulation-anomaly-rule:semantic-loop",
    version: "simulation-anomaly-rules:v1",
    code: "semantic-loop",
    threshold: 1,
    population: "all-completed-fights",
    recommendation: "Inspect the repeated state/action cycle and rerun diagnostically.",
  },
  {
    id: "simulation-anomaly-rule:control-lockout",
    version: "simulation-anomaly-rules:v1",
    code: "control-lockout",
    threshold: 2,
    population: "fights-with-pending-responses",
    recommendation: "Compare control duration, response availability, and escape policies.",
  },
  {
    id: "simulation-anomaly-rule:resource-cycle",
    version: "simulation-anomaly-rules:v1",
    code: "resource-cycle",
    threshold: 2,
    population: "fights-with-repeated-states",
    recommendation: "Inspect resource gain/loss events for a sustaining cycle.",
  },
  {
    id: "simulation-anomaly-rule:no-progress",
    version: "simulation-anomaly-rules:v1",
    code: "no-progress",
    threshold: 1,
    population: "safeguard-terminated-fights",
    recommendation: "Rerun with diagnostic retention and inspect semantic progress identity.",
  },
]);

const repeatedCount = (values: readonly string[]): number => values.length - new Set(values).size;

const observedValueFor = (
  rule: SimulationAnomalyRule,
  result: SimulationFightExecutionResult,
): number => {
  if (rule.code === "semantic-loop" || rule.code === "no-progress")
    return result.terminationReason === "semantic-no-progress" ? 1 : 0;
  if (rule.code === "control-lockout")
    return result.summary.actorActions === 0
      ? result.summary.pendingResponses
      : result.summary.pendingResponses / result.summary.actorActions;
  return repeatedCount(result.replay.stateHashes);
};

export const detectSimulationAnomalies = (
  results: readonly SimulationFightExecutionResult[],
  rules: readonly SimulationAnomalyRule[] = DEFAULT_SIMULATION_ANOMALY_RULES,
): readonly SimulationAnomalyFinding[] => {
  const findings: SimulationAnomalyFinding[] = [];
  for (const rule of rules) {
    for (const result of results) {
      const observedValue = observedValueFor(rule, result);
      if (observedValue < rule.threshold) continue;
      const finding = {
        schemaVersion: "simulation-anomaly-finding:v1" as const,
        ruleId: rule.id,
        code: rule.code,
        metric: rule.code,
        threshold: rule.threshold,
        observedValue,
        sampleCount: 1,
        uncertainty: "not-estimated" as const,
        confounders: [
          result.terminationReason === "semantic-no-progress"
            ? "safeguard-termination"
            : "none-recorded",
        ],
        representativeRunIds: [result.runId],
        recommendation: rule.recommendation,
        findingHash: canonicalHash({ rule, result: result.runId, observedValue }),
      } satisfies SimulationAnomalyFinding;
      findings.push(finding);
    }
  }
  return findings.sort((left, right) => left.findingHash.localeCompare(right.findingHash));
};

export const selectSimulationAnomalyCandidates = (
  results: readonly SimulationFightExecutionResult[],
  rules: readonly SimulationAnomalyRule[] = DEFAULT_SIMULATION_ANOMALY_RULES,
): readonly SimulationAnomalyFinding[] => detectSimulationAnomalies(results, rules).slice(0, 20);

export const verifySimulationAnomalyRerun = (
  replay: SimulationReplayRecord,
  request: SimulationFightRequest,
): ReplayVerificationResult => verifySimulationReplay(replay, request);
