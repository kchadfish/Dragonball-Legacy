import {
  BranchCombatIdSource,
  FixedClock,
  SeededRandomSource,
  createCombatRuntime,
  type CombatMechanicsView,
} from "@dragonball-resurgence/combat-engine";
import { SIMULATION_QUALITY_PROFILE } from "@dragonball-resurgence/ai-engine";
import { z } from "zod";

import { canonicalHash } from "./canonical.js";
import {
  simulationTemplateSchema,
  type SimulationTemplate,
  type SimulationTemplateValidationFailure,
} from "./contracts.js";
import { simulationTemplateIdSchema } from "./ids.js";
import { materializeSimulationTemplate } from "./templates.js";

export const SIMULATION_BUILD_GENERATOR_VERSION = "simulation-build-generator:v1" as const;

const uint32Schema = z
  .number()
  .int()
  .nonnegative()
  .max(2 ** 32 - 1);
const positiveInteger = z.number().int().positive();

export const SIMULATION_BUILD_ARCHETYPES = [
  "balanced",
  "high-power",
  "high-dexterity",
  "defensive",
  "burst",
  "status-control",
  "ki-denial",
  "resource-efficient",
  "glass-cannon",
  "sustained-damage",
  "transformation",
  "restricted-use",
] as const;
export type SimulationBuildArchetype = (typeof SIMULATION_BUILD_ARCHETYPES)[number];

export const SIMULATION_BUILD_SCENARIO_ROLES = [
  "baseline",
  "attacker",
  "defender",
  "resource-preserver",
  "transformation-timing",
] as const;
export type SimulationBuildScenarioRole = (typeof SIMULATION_BUILD_SCENARIO_ROLES)[number];

const buildGeneratorRequestSchema = z
  .object({
    schemaVersion: z.literal(SIMULATION_BUILD_GENERATOR_VERSION),
    seed: uint32Schema,
    maximumBuilds: positiveInteger.max(256),
    checkpointIds: z.array(z.string().min(1)).min(1),
    styleIds: z.array(z.string().min(1)).min(1).optional(),
    archetypes: z.array(z.enum(SIMULATION_BUILD_ARCHETYPES)).min(1),
    scenarioRoles: z.array(z.enum(SIMULATION_BUILD_SCENARIO_ROLES)).min(1),
  })
  .strict();

export type SimulationBuildGeneratorRequest = z.output<typeof buildGeneratorRequestSchema>;

export type SimulationBuildGeneratorInput = Omit<
  Partial<SimulationBuildGeneratorRequest>,
  "checkpointIds" | "styleIds" | "archetypes" | "scenarioRoles"
> & {
  readonly checkpointIds?: readonly string[];
  readonly styleIds?: readonly string[];
  readonly archetypes?: readonly SimulationBuildArchetype[];
  readonly scenarioRoles?: readonly SimulationBuildScenarioRole[];
};

export interface SimulationBuildGenerationRejection {
  readonly candidateId: string;
  readonly dimensions: Readonly<{
    readonly checkpointId: string;
    readonly styleId: string;
    readonly raceId: string;
    readonly classId: string;
    readonly archetype: SimulationBuildArchetype;
    readonly scenarioRole: SimulationBuildScenarioRole;
  }>;
  readonly type: "invalid-template" | "unknown-reference" | "incompatible-loadout" | "runtime";
  readonly reason: string;
}

export interface SimulationBuildGenerationManifest {
  readonly schemaVersion: typeof SIMULATION_BUILD_GENERATOR_VERSION;
  readonly generatorVersion: typeof SIMULATION_BUILD_GENERATOR_VERSION;
  readonly source: Readonly<{
    readonly mechanicsIdentity: string;
    readonly sourceCatalogHash: string;
  }>;
  readonly request: SimulationBuildGeneratorRequest;
  readonly selectedDimensions: Readonly<{
    readonly checkpointIds: readonly string[];
    readonly styleIds: readonly string[];
    readonly raceIds: readonly string[];
    readonly archetypes: readonly SimulationBuildArchetype[];
    readonly scenarioRoles: readonly SimulationBuildScenarioRole[];
  }>;
  readonly candidateBudget: number;
  readonly candidateCount: number;
  readonly acceptedCount: number;
  readonly deduplicatedCount: number;
  readonly generatedBuildIds: readonly string[];
  readonly generatedBuildHashes: readonly string[];
  readonly rejectionReasons: readonly SimulationBuildGenerationRejection[];
  readonly manifestHash: string;
}

export interface SimulationBuildGenerationResult {
  readonly schemaVersion: typeof SIMULATION_BUILD_GENERATOR_VERSION;
  readonly builds: readonly SimulationTemplate[];
  readonly manifest: SimulationBuildGenerationManifest;
}

export const simulationBuildGeneratorRequestSchema = buildGeneratorRequestSchema;

export const DEFAULT_SIMULATION_BUILD_GENERATOR_REQUEST: SimulationBuildGeneratorRequest = {
  schemaVersion: SIMULATION_BUILD_GENERATOR_VERSION,
  seed: 0x51a7e,
  maximumBuilds: 24,
  checkpointIds: ["starter", "early", "mid", "late", "tf1", "endgame"],
  archetypes: [...SIMULATION_BUILD_ARCHETYPES],
  scenarioRoles: [...SIMULATION_BUILD_SCENARIO_ROLES],
};

interface Candidate {
  readonly id: string;
  readonly dimensions: CandidateDimensions;
  readonly template: unknown;
  readonly rank: string;
}

const sortedUnique = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));

const sourceCatalogHashFor = (view: CombatMechanicsView): string =>
  canonicalHash({
    mechanicsIdentity: view.identity.contentHash,
    moves: view.moves.map((move) => move.id).sort(),
    items: view.items.map((item) => item.id).sort(),
    transformations: view.transformations.map((transformation) => transformation.id).sort(),
    races: view.races.map((race) => race.id).sort(),
    genericClasses: view.genericClasses.map((genericClass) => genericClass.id).sort(),
  });

const numericSeedFor = (seed: number, value: unknown): number => {
  const hash = canonicalHash({ seed, value });
  return Number.parseInt(hash.slice(-8), 16) >>> 0;
};

const choiceFor = <T>(values: readonly T[], seed: number, value: unknown): T | undefined => {
  if (values.length === 0) return undefined;
  return values[numericSeedFor(seed, value) % values.length];
};

const styleIdsFor = (view: CombatMechanicsView): readonly string[] =>
  sortedUnique(view.moves.map((move) => move.styleId ?? "style-freestyle"));

const moveCategories = ["mastery", "skill", "advanced-attack", "signature", "block"] as const;

type CandidateDimensions = SimulationBuildGenerationRejection["dimensions"];

const dimensionsHash = (dimensions: CandidateDimensions): string =>
  canonicalHash(dimensions).slice(-8);

const candidateIdFor = (dimensions: CandidateDimensions): string => {
  const slug = Object.values(dimensions)
    .join("-")
    .replaceAll(/[^a-zA-Z0-9]+/gu, "-")
    .toLowerCase();
  return simulationTemplateIdSchema.parse(
    `simulation-template:generated-${slug}-${dimensionsHash(dimensions)}`,
  );
};

const moveIdsFor = (
  view: CombatMechanicsView,
  styleId: string,
  dimensions: CandidateDimensions,
  seed: number,
): readonly string[] => {
  const moves = view.moves.filter((move) => (move.styleId ?? "style-freestyle") === styleId);
  return moveCategories.flatMap((category) => {
    const candidates = moves
      .filter((move) => move.category === category)
      .sort((left, right) => left.id.localeCompare(right.id));
    const selected = choiceFor(candidates, seed, { dimensions, category });
    return selected === undefined ? [] : [selected.id];
  });
};

const specializationFor = (
  archetype: SimulationBuildArchetype,
  role: SimulationBuildScenarioRole,
): Readonly<{ hp: number; power: number; dexterity: number; total: number }> => {
  if (archetype === "high-power" || archetype === "burst")
    return { hp: 2, power: 5, dexterity: 1, total: 8 };
  if (archetype === "high-dexterity") return { hp: 2, power: 2, dexterity: 4, total: 8 };
  if (archetype === "defensive" || role === "defender")
    return { hp: 5, power: 1, dexterity: 2, total: 8 };
  if (archetype === "resource-efficient" || role === "resource-preserver")
    return { hp: 3, power: 2, dexterity: 3, total: 8 };
  return { hp: 3, power: 3, dexterity: 2, total: 8 };
};

const statsFor = (
  archetype: SimulationBuildArchetype,
  role: SimulationBuildScenarioRole,
): Readonly<{ power: number; dexterity: number; dexterityBonus: number }> => ({
  power:
    archetype === "high-power" || archetype === "burst"
      ? 45
      : archetype === "resource-efficient"
        ? 25
        : 30,
  dexterity:
    archetype === "high-dexterity" || role === "attacker"
      ? 25
      : archetype === "defensive" || role === "defender"
        ? 10
        : 18,
  dexterityBonus: role === "attacker" ? 1 : 0,
});

const maximumHitPointsFor = (
  archetype: SimulationBuildArchetype,
  role: SimulationBuildScenarioRole,
): number => {
  if (archetype === "glass-cannon") return 80;
  if (archetype === "defensive" || role === "defender") return 150;
  if (archetype === "sustained-damage") return 125;
  return 110;
};

const transformationProfileFor = (
  view: CombatMechanicsView,
  raceId: string,
  checkpointId: string,
  archetype: SimulationBuildArchetype,
  role: SimulationBuildScenarioRole,
): readonly SimulationTemplate["transformationProfiles"][number][] => {
  const checkpointAllowsTransformation = ["late", "tf1", "endgame"].includes(checkpointId);
  if (!checkpointAllowsTransformation && role !== "transformation-timing") return [];
  if (archetype !== "transformation" && role !== "transformation-timing") return [];
  const race = view.indexes.races.get(raceId);
  const transformationId = [...(race?.transformationIds ?? [])].sort((left, right) =>
    left.localeCompare(right),
  )[0];
  if (transformationId === undefined) return [];
  return [{ transformationId, rollSides: 100, mastery: "intermediate" }];
};

const templateFor = (
  view: CombatMechanicsView,
  seed: number,
  dimensions: CandidateDimensions,
): unknown => {
  const race = view.indexes.races.get(dimensions.raceId);
  const classDefinition = race?.classes.find((entry) => entry.id === dimensions.classId);
  const moves = moveIdsFor(view, dimensions.styleId, dimensions, seed);
  const specializationPointsDistribution = specializationFor(
    dimensions.archetype,
    dimensions.scenarioRole,
  );
  const stats = statsFor(dimensions.archetype, dimensions.scenarioRole);
  const transformationProfiles = transformationProfileFor(
    view,
    dimensions.raceId,
    dimensions.checkpointId,
    dimensions.archetype,
    dimensions.scenarioRole,
  );
  const id = candidateIdFor(dimensions);
  return {
    schemaVersion: "simulation-contracts:v1",
    id,
    label: `Generated ${dimensions.archetype} ${dimensions.scenarioRole}`,
    kind: "synthetic",
    checkpointId: dimensions.checkpointId,
    source: {
      path: "simulation/generated-builds",
      text: `Deterministic generated build for ${dimensions.archetype} / ${dimensions.scenarioRole}`,
      sourceKind: "synthetic",
    },
    raceId: dimensions.raceId,
    classId: classDefinition?.id,
    styleId: dimensions.styleId,
    mastery:
      view.moves.find((move) => moves.includes(move.id) && move.category === "mastery")?.name ??
      `${dimensions.styleId} generated mastery`,
    specializationPoints: specializationPointsDistribution.total,
    specializationPointsDistribution,
    startingKiPolicy: "rules-default",
    maximumHitPoints: maximumHitPointsFor(dimensions.archetype, dimensions.scenarioRole),
    stats,
    raceTraitIds: [],
    moveIds: moves,
    itemIds: [],
    transformationProfiles,
    gaps: [],
    aiProfileId: SIMULATION_QUALITY_PROFILE.identity.id,
  };
};

const candidateFor = (
  view: CombatMechanicsView,
  request: SimulationBuildGeneratorRequest,
  dimensions: CandidateDimensions,
): Candidate => {
  const id = candidateIdFor(dimensions);
  return {
    id,
    dimensions,
    template: templateFor(view, request.seed, dimensions),
    rank: canonicalHash({ seed: request.seed, dimensions }),
  };
};

const candidatesFor = (
  view: CombatMechanicsView,
  request: SimulationBuildGeneratorRequest,
  styleIds: readonly string[],
): readonly Candidate[] => {
  const races = [...view.races].sort((left, right) => left.id.localeCompare(right.id));
  const candidates = races.flatMap((race) =>
    [...race.classes]
      .sort((left, right) => left.id.localeCompare(right.id))
      .flatMap((classDefinition) =>
        request.checkpointIds.flatMap((checkpointId) =>
          styleIds.flatMap((styleId) =>
            request.archetypes.flatMap((archetype) =>
              request.scenarioRoles.map((scenarioRole) =>
                candidateFor(view, request, {
                  checkpointId,
                  styleId,
                  raceId: race.id,
                  classId: classDefinition.id,
                  archetype,
                  scenarioRole,
                }),
              ),
            ),
          ),
        ),
      ),
  );
  return candidates.sort((left, right) => left.rank.localeCompare(right.rank));
};

const mechanicalBuildHash = (template: SimulationTemplate): string =>
  canonicalHash({
    maximumHitPoints: template.maximumHitPoints,
    stats: template.stats,
    raceId: template.raceId,
    raceTraitIds: template.raceTraitIds,
    classId: template.classId,
    styleId: template.styleId,
    specializationPoints: template.specializationPoints,
    moveIds: template.moveIds,
    itemIds: template.itemIds,
    transformationProfiles: template.transformationProfiles,
  });

const rejectionTypeFor = (
  failure: SimulationTemplateValidationFailure,
): SimulationBuildGenerationRejection["type"] => {
  if (failure.type === "unknown-reference") return "unknown-reference";
  if (failure.type === "incompatible-loadout") return "incompatible-loadout";
  return "invalid-template";
};

const validateCandidate = (
  candidate: Candidate,
  view: CombatMechanicsView,
  seed: number,
):
  | { readonly ok: true; readonly template: SimulationTemplate }
  | {
      readonly ok: false;
      readonly rejection: SimulationBuildGenerationRejection;
    } => {
  const parsed = simulationTemplateSchema.safeParse(candidate.template);
  if (!parsed.success)
    return {
      ok: false,
      rejection: {
        candidateId: candidate.id,
        dimensions: candidate.dimensions,
        type: "invalid-template",
        reason: parsed.error.message,
      },
    };
  const materialized = materializeSimulationTemplate(parsed.data, view);
  if (!materialized.ok)
    return {
      ok: false,
      rejection: {
        candidateId: candidate.id,
        dimensions: candidate.dimensions,
        type: rejectionTypeFor(materialized.error),
        reason: materialized.error.detail,
      },
    };
  const runtime = createCombatRuntime(view);
  const created = runtime.createFight(
    { mode: "spar", combatants: [materialized.value.input, materialized.value.input] },
    {
      random: new SeededRandomSource(numericSeedFor(seed, candidate.dimensions)),
      clock: new FixedClock(new Date("2026-01-01T00:00:00.000Z")),
      ids: new BranchCombatIdSource([candidate.id, materialized.value.templateHash]),
      mechanicsView: view,
    },
  );
  if (!created.ok)
    return {
      ok: false,
      rejection: {
        candidateId: candidate.id,
        dimensions: candidate.dimensions,
        type: "runtime",
        reason: created.error.type,
      },
    };
  return { ok: true, template: parsed.data };
};

export const generateSimulationBuilds = (
  input: SimulationBuildGeneratorInput = {},
  view: CombatMechanicsView,
): SimulationBuildGenerationResult => {
  const request = buildGeneratorRequestSchema.parse({
    ...DEFAULT_SIMULATION_BUILD_GENERATOR_REQUEST,
    ...input,
    schemaVersion: SIMULATION_BUILD_GENERATOR_VERSION,
    checkpointIds: input.checkpointIds ?? DEFAULT_SIMULATION_BUILD_GENERATOR_REQUEST.checkpointIds,
    archetypes: input.archetypes ?? DEFAULT_SIMULATION_BUILD_GENERATOR_REQUEST.archetypes,
    scenarioRoles: input.scenarioRoles ?? DEFAULT_SIMULATION_BUILD_GENERATOR_REQUEST.scenarioRoles,
  });
  const styleIds = sortedUnique(input.styleIds ?? styleIdsFor(view));
  const knownStyleIds = new Set(styleIdsFor(view));
  const unknownStyleIds = styleIds.filter((styleId) => !knownStyleIds.has(styleId));
  if (unknownStyleIds.length > 0)
    throw new RangeError(`Unknown generated-build style IDs: ${unknownStyleIds.join(", ")}.`);
  const sourceCatalogHash = sourceCatalogHashFor(view);
  const candidates = candidatesFor(view, request, styleIds);
  const candidateBudget = Math.min(candidates.length, Math.max(request.maximumBuilds * 12, 64));
  const selectedCandidates = candidates.slice(0, candidateBudget);
  const builds: SimulationTemplate[] = [];
  const rejections: SimulationBuildGenerationRejection[] = [];
  const seenMechanicalHashes = new Set<string>();
  let deduplicatedCount = 0;
  for (const candidate of selectedCandidates) {
    if (builds.length >= request.maximumBuilds) break;
    const result = validateCandidate(candidate, view, request.seed);
    if (!result.ok) {
      rejections.push(result.rejection);
      continue;
    }
    const mechanicalHash = mechanicalBuildHash(result.template);
    if (seenMechanicalHashes.has(mechanicalHash)) {
      deduplicatedCount += 1;
      continue;
    }
    seenMechanicalHashes.add(mechanicalHash);
    builds.push(result.template);
  }
  const generatedBuildHashes = builds.map(mechanicalBuildHash);
  const selectedDimensions = {
    checkpointIds: [...request.checkpointIds].sort(),
    styleIds,
    raceIds: sortedUnique(view.races.map((race) => race.id)),
    archetypes: [...request.archetypes].sort(),
    scenarioRoles: [...request.scenarioRoles].sort(),
  } satisfies SimulationBuildGenerationManifest["selectedDimensions"];
  const manifestWithoutHash = {
    schemaVersion: SIMULATION_BUILD_GENERATOR_VERSION,
    generatorVersion: SIMULATION_BUILD_GENERATOR_VERSION,
    source: { mechanicsIdentity: view.identity.contentHash, sourceCatalogHash },
    request,
    selectedDimensions,
    candidateBudget,
    candidateCount: selectedCandidates.length,
    acceptedCount: builds.length,
    deduplicatedCount,
    generatedBuildIds: builds.map((build) => build.id),
    generatedBuildHashes,
    rejectionReasons: rejections,
  } satisfies Omit<SimulationBuildGenerationManifest, "manifestHash">;
  const manifest = { ...manifestWithoutHash, manifestHash: canonicalHash(manifestWithoutHash) };
  return {
    schemaVersion: SIMULATION_BUILD_GENERATOR_VERSION,
    builds: Object.freeze(builds),
    manifest,
  };
};
