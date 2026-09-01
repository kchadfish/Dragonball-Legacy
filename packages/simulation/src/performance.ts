import { canonicalHash } from "./canonical.js";
import {
  addSimulationValue,
  createSimulationMeanVariance,
  type SimulationMeanVariance,
} from "./statistics.js";

export type SimulationPerformanceStage =
  "combat" | "ai" | "observation" | "aggregation" | "serialization" | "reporting";

export interface SimulationPerformanceSample {
  readonly stage: SimulationPerformanceStage;
  readonly units: number;
}

export interface SimulationPerformanceProfile {
  readonly schemaVersion: "simulation-performance:v1";
  readonly samples: Readonly<Record<SimulationPerformanceStage, SimulationMeanVariance>>;
  readonly profileHash: string;
}

const stages: readonly SimulationPerformanceStage[] = [
  "combat",
  "ai",
  "observation",
  "aggregation",
  "serialization",
  "reporting",
];

export const createSimulationPerformanceProfile = (
  samples: readonly SimulationPerformanceSample[],
): SimulationPerformanceProfile => {
  const aggregates = Object.fromEntries(
    stages.map((stage) => [stage, createSimulationMeanVariance()]),
  ) as Record<SimulationPerformanceStage, SimulationMeanVariance>;
  for (const sample of samples) {
    if (!Number.isFinite(sample.units) || sample.units < 0)
      throw new RangeError("Performance sample units must be finite and non-negative.");
    aggregates[sample.stage] = addSimulationValue(aggregates[sample.stage], sample.units);
  }
  return {
    schemaVersion: "simulation-performance:v1",
    samples: aggregates,
    profileHash: canonicalHash(aggregates),
  };
};

export interface SimulationBenchmarkDrift {
  readonly stage: SimulationPerformanceStage;
  readonly baselineMean: number;
  readonly candidateMean: number;
  readonly relativeChange: number;
  readonly finding: "within-envelope" | "drift";
}

export const compareSimulationPerformanceProfiles = (
  baseline: SimulationPerformanceProfile,
  candidate: SimulationPerformanceProfile,
  relativeTolerance = 0.2,
): readonly SimulationBenchmarkDrift[] => {
  if (relativeTolerance < 0) throw new RangeError("Performance tolerance must be non-negative.");
  return stages.map((stage) => {
    const baselineMean = baseline.samples[stage].mean;
    const candidateMean = candidate.samples[stage].mean;
    const baselineIsNearZero = Math.abs(baselineMean) < Number.EPSILON;
    const relativeChange = baselineIsNearZero
      ? Math.min(1, Math.abs(candidateMean))
      : (candidateMean - baselineMean) / baselineMean;
    return {
      stage,
      baselineMean,
      candidateMean,
      relativeChange,
      finding: Math.abs(relativeChange) <= relativeTolerance ? "within-envelope" : "drift",
    };
  });
};
