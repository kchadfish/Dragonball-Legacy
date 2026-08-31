import { SIMULATION_QUALITY_PROFILE } from "@dragonball-resurgence/ai-engine";
import { CANONICAL_COMBAT_MECHANICS_VIEW } from "@dragonball-resurgence/combat-engine";

import { canonicalHash } from "./canonical.js";

export const SIMULATION_SCOPE_VERSION = "simulation-scope:v1" as const;
export const SIMULATION_SCHEMA_VERSION = "simulation-schema:v1" as const;
export const SIMULATION_AI_SEED_DERIVATION_VERSION = "simulation-ai-seed:v1" as const;
export const SIMULATION_SEED_DERIVATION_VERSION = "simulation-seed:v1" as const;

const supportedRaceFamilies = [
  "race-humans",
  "race-saiyans",
  "race-hybrid-saiyan",
  "race-namek",
  "race-changeling",
  "race-bio-androids",
] as const;

const canonicalMechanics = CANONICAL_COMBAT_MECHANICS_VIEW;

const moveCategoryCounts = Object.fromEntries(
  [...new Set(canonicalMechanics.moves.map((move) => move.category))]
    .sort((left, right) => left.localeCompare(right))
    .map((category) => [
      category,
      canonicalMechanics.moves.filter((move) => move.category === category).length,
    ]),
);

const catalogIdentity = {
  version: "game-data-catalog:v1",
  moveCount: canonicalMechanics.moves.length,
  moveCategoryCounts,
  raceCount: canonicalMechanics.races.length,
  transformationCount: canonicalMechanics.transformations.length,
  contentHash: canonicalHash({
    moves: canonicalMechanics.moves.map((move) => move.id),
    races: canonicalMechanics.races.map((race) => race.id),
    transformations: canonicalMechanics.transformations.map((transformation) => transformation.id),
  }),
} as const;

export interface SimulationScopeRecord {
  readonly schemaVersion: typeof SIMULATION_SCOPE_VERSION;
  readonly scopeId: typeof SIMULATION_SCOPE_VERSION;
  readonly combatCapabilityScope: "ai-combat-scope:v1";
  readonly rulesVersion: typeof canonicalMechanics.rulesVersion;
  readonly publicPackageVersions: Readonly<Record<string, string>>;
  readonly legalDecisionSurface: readonly ["advance", "decision-required", "completed"];
  readonly catalog: typeof catalogIdentity;
  readonly ai: {
    readonly profileId: string;
    readonly profileVersion: string;
    readonly evaluatorCapability: "declared-effective-capabilities";
  };
  readonly transformationFamilies: readonly string[];
  readonly exclusions: readonly string[];
}

/** Frozen scope authority for the first simulation release. */
export const SIMULATION_SCOPE_V1: SimulationScopeRecord = Object.freeze({
  schemaVersion: SIMULATION_SCOPE_VERSION,
  scopeId: SIMULATION_SCOPE_VERSION,
  combatCapabilityScope: "ai-combat-scope:v1",
  rulesVersion: canonicalMechanics.rulesVersion,
  publicPackageVersions: {
    "@dragonball-resurgence/ai-engine": "0.1.0",
    "@dragonball-resurgence/combat-engine": "0.1.0",
    "@dragonball-resurgence/game-config": "0.1.0",
    "@dragonball-resurgence/game-data": "0.1.0",
  },
  legalDecisionSurface: ["advance", "decision-required", "completed"] as const,
  catalog: catalogIdentity,
  ai: {
    profileId: SIMULATION_QUALITY_PROFILE.identity.id,
    profileVersion: SIMULATION_QUALITY_PROFILE.identity.version,
    evaluatorCapability: "declared-effective-capabilities" as const,
  },
  transformationFamilies: [...supportedRaceFamilies],
  exclusions: [
    "teams-and-joint-attacks",
    "interferers-and-spectators",
    "remote-or-relationship-targets",
    "escape-actions",
    "body-and-identity-mutation",
    "permanent-moveset-or-ownership-mutation",
    "permanent-progression",
    "administrator-and-narrative-effects",
    "planetary-destruction",
    "spaceship-mechanics",
  ],
});

export const getSimulationScope = (): SimulationScopeRecord => SIMULATION_SCOPE_V1;
