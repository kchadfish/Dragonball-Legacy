import type { AiWorkLimits } from "@dragonball-resurgence/ai-engine";

export const SIMULATION_CANONICAL_JSON_VERSION = "canonical-json:v1" as const;
export const SIMULATION_INTERVAL_VERSION = "intervals:v1" as const;
export const SIMULATION_CONFIDENCE_LEVEL = 0.95 as const;
export const SIMULATION_MINIMUM_EXPOSURE_POLICY = Object.freeze({
  minimumFights: 10,
  minimumEligibleStates: 10,
  statusWhenUnmet: "observed-low-sample",
});
export const SIMULATION_TEMPLATE_SOURCE_POLICY = "typed-fixtures-only-until-sim-100" as const;
export const SIMULATION_VARIANT_PATCH_SURFACE = "deferred-until-sim-080" as const;
export const SIMULATION_COMPARABLE_ALGORITHM_VERSION = "comparables:multi-stage-filter-v1" as const;

/** Provisional safeguards are simulation controls, never combat rules. */
export const SIMULATION_DEFAULT_LIMITS = Object.freeze({
  maximumTurns: 100,
  maximumTransitions: 1_000,
  semanticNoProgressLimit: 3,
  maximumRetainedDiagnostics: 100,
  concurrency: 1,
});

export type { SimulationSeedInput, SimulationSeedManifest } from "./seeds.js";

export const simulationWorkLimits = (input?: Partial<AiWorkLimits>): AiWorkLimits => ({
  candidateLimit: input?.candidateLimit ?? 64,
  outcomeLimit: input?.outcomeLimit ?? 16,
  nodeLimit: input?.nodeLimit ?? 2_048,
  probeLimit: input?.probeLimit ?? 1_024,
});
