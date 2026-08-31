import type { AiWorkLimits } from "@dragonball-resurgence/ai-engine";
import { deriveDeterministicSeed } from "@dragonball-resurgence/combat-engine";

import { SIMULATION_SEED_DERIVATION_VERSION } from "./scope.js";
import type { SimulationScenarioId, SimulationVariantId } from "./ids.js";

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

export interface SimulationSeedInput {
  readonly rootSeed: number;
  readonly scenarioId: SimulationScenarioId | string;
  readonly variantId: SimulationVariantId | string;
  readonly templateAHash: string;
  readonly templateBHash: string;
  readonly strategyAId: string;
  readonly strategyBId: string;
  readonly iteration: number;
  readonly mirror: "original" | "mirrored";
  readonly purpose: "combat" | "ai-a" | "ai-b" | "diagnostic-rerun";
}

export interface SimulationSeedManifest {
  readonly rootSeed: number;
  readonly derivationVersion: typeof SIMULATION_SEED_DERIVATION_VERSION;
  readonly input: Readonly<Omit<SimulationSeedInput, "rootSeed">>;
  readonly seed: number;
}

const validateSeedInput = (input: SimulationSeedInput): void => {
  if (!Number.isInteger(input.rootSeed) || input.rootSeed < 0 || input.rootSeed >= 2 ** 32)
    throw new RangeError("Simulation root seed must be an unsigned 32-bit integer.");
  if (!Number.isInteger(input.iteration) || input.iteration < 0)
    throw new RangeError("Simulation iteration must be a non-negative integer.");
};

export const deriveSimulationSeed = (input: SimulationSeedInput): number => {
  validateSeedInput(input);
  return deriveDeterministicSeed([
    "simulation",
    SIMULATION_SEED_DERIVATION_VERSION,
    input.rootSeed,
    input.scenarioId,
    input.variantId,
    input.templateAHash,
    input.templateBHash,
    input.strategyAId,
    input.strategyBId,
    input.iteration,
    input.mirror,
    input.purpose,
  ]);
};

export const createSimulationSeedManifest = (
  input: SimulationSeedInput,
): SimulationSeedManifest => ({
  rootSeed: input.rootSeed,
  derivationVersion: SIMULATION_SEED_DERIVATION_VERSION,
  input: {
    scenarioId: input.scenarioId,
    variantId: input.variantId,
    templateAHash: input.templateAHash,
    templateBHash: input.templateBHash,
    strategyAId: input.strategyAId,
    strategyBId: input.strategyBId,
    iteration: input.iteration,
    mirror: input.mirror,
    purpose: input.purpose,
  },
  seed: deriveSimulationSeed(input),
});

export const simulationWorkLimits = (input?: Partial<AiWorkLimits>): AiWorkLimits => ({
  candidateLimit: input?.candidateLimit ?? 64,
  outcomeLimit: input?.outcomeLimit ?? 16,
  nodeLimit: input?.nodeLimit ?? 2_048,
  probeLimit: input?.probeLimit ?? 1_024,
});
