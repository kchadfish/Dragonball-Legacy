import { deriveDeterministicSeed } from "@dragonball-resurgence/combat-engine";

import { canonicalHash } from "./canonical.js";
import type { SimulationScenarioId, SimulationVariantId } from "./ids.js";
import { SIMULATION_SEED_DERIVATION_VERSION } from "./scope.js";
import { simulationSeedKeySchema, type SimulationSeedKey } from "./contracts.js";

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
  readonly schemaVersion?: "simulation-contracts:v1";
  readonly rootSeed: number;
  readonly derivationVersion: typeof SIMULATION_SEED_DERIVATION_VERSION;
  readonly input: Readonly<Omit<SimulationSeedInput, "rootSeed">>;
  readonly seed: number;
  readonly key?: SimulationSeedKey;
}

/** Observation, stopping, and safeguard policies must not perturb fight seeds. */
export const simulationScenarioIdentityHash = (scenario: {
  readonly schemaVersion: string;
  readonly id: string;
  readonly family: string;
  readonly checkpointId: string;
  readonly templateAId: string;
  readonly templateBId: string;
  readonly variantId: string;
  readonly deferred: boolean;
  readonly note?: string;
}): string =>
  canonicalHash({
    schemaVersion: scenario.schemaVersion,
    id: scenario.id,
    family: scenario.family,
    checkpointId: scenario.checkpointId,
    templateAId: scenario.templateAId,
    templateBId: scenario.templateBId,
    variantId: scenario.variantId,
    deferred: scenario.deferred,
    note: scenario.note,
  });

export interface SimulationSeedRequest extends Omit<
  SimulationSeedKey,
  "schemaVersion" | "scenarioHash"
> {
  readonly scenarioHash?: string;
}

const semanticPartsFor = (key: SimulationSeedKey): readonly (string | number)[] => [
  "simulation",
  SIMULATION_SEED_DERIVATION_VERSION,
  key.rootSeed,
  key.scenarioId,
  key.scenarioHash,
  key.variantId,
  key.pairId,
  key.iteration,
  key.mirror,
  key.templateAHash,
  key.templateBHash,
  key.strategyAId,
  key.strategyBId,
  key.namespace,
];

const validateSeedInput = (input: SimulationSeedInput): void => {
  if (!Number.isInteger(input.rootSeed) || input.rootSeed < 0 || input.rootSeed >= 2 ** 32)
    throw new RangeError("Simulation root seed must be an unsigned 32-bit integer.");
  if (!Number.isInteger(input.iteration) || input.iteration < 0)
    throw new RangeError("Simulation iteration must be a non-negative integer.");
};

/** The sole seed derivation implementation; legacy callers use the same primitive. */
const deriveSeed = (parts: readonly (string | number)[]): number =>
  deriveDeterministicSeed(["simulation", SIMULATION_SEED_DERIVATION_VERSION, ...parts]);

export const deriveSimulationSeed = (input: SimulationSeedInput): number => {
  validateSeedInput(input);
  return deriveSeed([
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

export const createSimulationSeedKey = (request: SimulationSeedRequest): SimulationSeedKey => {
  const parsed = simulationSeedKeySchema.parse({
    ...request,
    schemaVersion: "simulation-contracts:v1",
    scenarioHash: request.scenarioHash ?? canonicalHash(request.scenarioId),
  });
  return Object.freeze(parsed);
};

export const allocateSimulationSeed = (request: SimulationSeedRequest): SimulationSeedManifest => {
  const key = createSimulationSeedKey(request);
  return Object.freeze({
    rootSeed: key.rootSeed,
    schemaVersion: "simulation-contracts:v1",
    derivationVersion: SIMULATION_SEED_DERIVATION_VERSION,
    input: {
      scenarioId: key.scenarioId,
      variantId: key.variantId,
      templateAHash: key.templateAHash,
      templateBHash: key.templateBHash,
      strategyAId: key.strategyAId,
      strategyBId: key.strategyBId,
      iteration: key.iteration,
      mirror: key.mirror,
      purpose: key.namespace,
    },
    key,
    seed: deriveSeed(semanticPartsFor(key).slice(2)),
  });
};

export const allocateSimulationSeeds = (
  requests: readonly SimulationSeedRequest[],
): readonly SimulationSeedManifest[] =>
  [...requests]
    .map(allocateSimulationSeed)
    .sort((left, right) => canonicalHash(left.key).localeCompare(canonicalHash(right.key)));

export const simulationSeedIdentity = (manifest: SimulationSeedManifest): string =>
  canonicalHash({
    derivationVersion: manifest.derivationVersion,
    key: manifest.key,
    seed: manifest.seed,
  });
