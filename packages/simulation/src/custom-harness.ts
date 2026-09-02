import {
  CANONICAL_COMBAT_MECHANICS_VIEW,
  type CombatantState,
  type CombatMechanicsView,
} from "@dragonball-resurgence/combat-engine";
import type { MoveDefinition } from "@dragonball-resurgence/game-data";
import { SIMULATION_QUALITY_PROFILE } from "@dragonball-resurgence/ai-engine";
import { z } from "zod";

import { canonicalHash } from "./canonical.js";
import {
  customMoveDraftSchema,
  reviewCustomMove,
  type CustomMovePreflight,
  type CustomMoveReviewConclusion,
} from "./custom-review.js";
import {
  generateSimulationBuilds,
  type SimulationBuildGenerationManifest,
  type SimulationBuildGenerationResult,
} from "./build-generator.js";
import { createScenario } from "./scenarios.js";
import { createSimulationVariant } from "./variants.js";
import {
  seededBootstrapPairedDifference,
  summarizeSimulationRate,
  type SimulationInterval,
  type SimulationPairedObservation,
  type SimulationRateSummary,
} from "./statistics.js";
import {
  simulationTemplateSchema,
  type SimulationFightExecutionResult,
  type SimulationFightRequest,
  type SimulationTemplate,
} from "./contracts.js";
import { runSimulationRequestsWithWorkers } from "./coordinator.js";
import { simulationTemplateIdSchema } from "./ids.js";

export const SIMULATION_CUSTOM_HARNESS_VERSION = "simulation-custom-harness:v1" as const;
export const SIMULATION_CUSTOM_DOSSIER_VERSION = "simulation-custom-dossier:v1" as const;

const uint32Schema = z
  .number()
  .int()
  .nonnegative()
  .max(2 ** 32 - 1);
const positiveInteger = z.number().int().positive();

export const customMoveHarnessOptionsSchema = z
  .object({
    schemaVersion: z.literal(SIMULATION_CUSTOM_HARNESS_VERSION),
    rootSeed: uint32Schema,
    pairCount: positiveInteger.max(10_000),
    maximumBuilds: positiveInteger.max(64),
    workers: positiveInteger.max(32),
    maximumTurns: positiveInteger.max(10_000),
    maximumTransitions: positiveInteger.max(100_000),
    semanticNoProgressLimit: positiveInteger.max(10_000),
    bootstrapResamples: positiveInteger.max(10_000),
    fixedTime: z.iso.datetime({ offset: true }),
  })
  .strict();

export type CustomMoveHarnessOptions = z.output<typeof customMoveHarnessOptionsSchema>;

export const DEFAULT_CUSTOM_MOVE_HARNESS_OPTIONS: CustomMoveHarnessOptions = {
  schemaVersion: SIMULATION_CUSTOM_HARNESS_VERSION,
  rootSeed: 0x43555354,
  pairCount: 250,
  maximumBuilds: 8,
  workers: 4,
  maximumTurns: 64,
  maximumTransitions: 512,
  semanticNoProgressLimit: 16,
  bootstrapResamples: 10_000,
  fixedTime: "2026-01-01T00:00:00.000Z",
};

export const CUSTOM_MOVE_HARNESS_ARMS = [
  "baseline",
  "addition",
  "replacement",
  "renamed-control",
  "stronger-control",
] as const;
export type CustomMoveHarnessArm = (typeof CUSTOM_MOVE_HARNESS_ARMS)[number];

export const CUSTOM_MOVE_HARNESS_POPULATIONS = ["natural", "isolation", "forced"] as const;
export type CustomMoveHarnessPopulation = (typeof CUSTOM_MOVE_HARNESS_POPULATIONS)[number];

export interface CustomMoveComparable {
  readonly moveId: string;
  readonly score: number;
  readonly dimensions: Readonly<{
    readonly category: string;
    readonly timing: readonly string[];
    readonly resource: readonly string[];
    readonly acquisition: string;
    readonly role: readonly string[];
    readonly effect: readonly string[];
    readonly usageContext: string;
  }>;
  readonly rationale: string;
}

export interface CustomMoveRunObservation {
  readonly pairId: string;
  readonly runId: string;
  readonly mirror: "original" | "mirrored";
  readonly ok: boolean;
  readonly terminationReason: SimulationFightExecutionResult["terminationReason"];
  readonly targetWinner: "target" | "control" | "draw" | null;
  readonly targetDamageDealt: number | null;
  readonly targetRemainingHitPoints: number | null;
  readonly replaySeed: number | null;
  readonly failureType?: string;
}

export interface CustomMovePopulationEvidence {
  readonly arm: CustomMoveHarnessArm;
  readonly population: CustomMoveHarnessPopulation;
  readonly pairCount: number;
  readonly completedPairs: number;
  readonly failedRuns: number;
  readonly targetWins: number;
  readonly controlWins: number;
  readonly draws: number;
  readonly targetWinRate: SimulationRateSummary | null;
  readonly meanTargetDamageDealt: number | null;
  readonly meanTargetRemainingHitPoints: number | null;
  readonly observations: readonly CustomMoveRunObservation[];
}

export interface CustomMoveEffectSize {
  readonly arm: CustomMoveHarnessArm;
  readonly population: CustomMoveHarnessPopulation;
  readonly metric: "target-win-rate" | "target-damage-dealt";
  readonly estimate: number | null;
  readonly interval: SimulationInterval | null;
  readonly intervalMethod: "wilson-difference-envelope" | "paired-bootstrap-95" | "not-estimated";
  readonly completedPairs: number;
  readonly rationale: string;
}

export interface CustomMoveHarnessVariant {
  readonly arm: CustomMoveHarnessArm;
  readonly moveId: string;
  readonly mechanicsIdentity: string;
  readonly variantHash: string;
}

export interface CustomMoveHarnessDossier {
  readonly schemaVersion: typeof SIMULATION_CUSTOM_DOSSIER_VERSION;
  readonly harnessVersion: typeof SIMULATION_CUSTOM_HARNESS_VERSION;
  readonly draftId: string;
  readonly preflight: CustomMovePreflight;
  readonly staticFlags: readonly string[];
  readonly generatedBuilds: readonly {
    readonly id: string;
    readonly templateHash: string;
  }[];
  readonly buildGenerationManifest?: SimulationBuildGenerationManifest;
  readonly buildGenerationManifestHash?: string;
  readonly comparables: readonly CustomMoveComparable[];
  readonly variants: readonly CustomMoveHarnessVariant[];
  readonly executedArms: readonly CustomMoveHarnessArm[];
  readonly populationEvidence: readonly CustomMovePopulationEvidence[];
  readonly effectSizes: readonly CustomMoveEffectSize[];
  readonly controlValidation: Readonly<{
    readonly renamedControlMechanicallyEquivalent: boolean;
    readonly strongerControlMechanicallyDistinct: boolean;
    readonly strongerControlAvailable: boolean;
  }>;
  readonly replaySeeds: Readonly<Record<string, readonly number[]>>;
  readonly anomalies: readonly string[];
  readonly limitations: readonly string[];
  readonly conclusion: CustomMoveReviewConclusion;
  readonly dossierHash: string;
}

export const customMoveHarnessDossierSchema = z
  .object({
    schemaVersion: z.literal(SIMULATION_CUSTOM_DOSSIER_VERSION),
    harnessVersion: z.literal(SIMULATION_CUSTOM_HARNESS_VERSION),
    draftId: z.string().min(1),
    preflight: z.custom<CustomMovePreflight>(),
    staticFlags: z.array(z.string()),
    generatedBuilds: z.array(
      z.object({ id: z.string().min(1), templateHash: z.string().min(1) }).strict(),
    ),
    buildGenerationManifest: z.custom<SimulationBuildGenerationManifest>().optional(),
    buildGenerationManifestHash: z.string().min(1).optional(),
    comparables: z.array(z.custom<CustomMoveComparable>()),
    variants: z.array(z.custom<CustomMoveHarnessVariant>()),
    executedArms: z.array(z.enum(CUSTOM_MOVE_HARNESS_ARMS)),
    populationEvidence: z.array(z.custom<CustomMovePopulationEvidence>()),
    effectSizes: z.array(z.custom<CustomMoveEffectSize>()),
    controlValidation: z
      .object({
        renamedControlMechanicallyEquivalent: z.boolean(),
        strongerControlMechanicallyDistinct: z.boolean(),
        strongerControlAvailable: z.boolean(),
      })
      .strict(),
    replaySeeds: z.record(z.string(), z.array(z.number().int().nonnegative())),
    anomalies: z.array(z.string()),
    limitations: z.array(z.string()),
    conclusion: z.enum([
      "cannot-evaluate",
      "insufficient-evidence",
      "no-flag-detected",
      "potential-balance-concern",
      "potential-rules-concern",
      "staff-review-required",
    ]),
    dossierHash: z.string().min(1),
  })
  .strict();

const draftIdFor = (draft: unknown): string => {
  if (typeof draft !== "object" || draft === null) return "custom-move-draft:malformed";
  const value = draft as { readonly draftId?: unknown };
  return typeof value.draftId === "string" ? value.draftId : "custom-move-draft:malformed";
};

const slugFor = (value: string): string => value.replaceAll(/[^a-zA-Z0-9]+/gu, "-").toLowerCase();

const moveShapeIsStructured = (value: unknown): value is MoveDefinition => {
  if (typeof value !== "object" || value === null) return false;
  const move = value as Record<string, unknown>;
  return (
    typeof move.id === "string" &&
    typeof move.name === "string" &&
    typeof move.category === "string" &&
    typeof move.description === "string" &&
    typeof move.effectText === "string" &&
    Array.isArray(move.effectClauses) &&
    typeof move.mechanics === "object" &&
    move.mechanics !== null &&
    typeof move.source === "object" &&
    move.source !== null
  );
};

const moveDimensionsFor = (move: MoveDefinition) => {
  const timing = [...new Set((move.effects ?? []).map((effect) => effect.trigger))].sort();
  const resource = [
    move.kiCost === undefined ? "no-ki-cost" : `ki:${move.kiCost}`,
    move.restrictedUses === undefined ? "unrestricted" : `restricted:${move.restrictedUses}`,
  ];
  const role = [...new Set([move.attack?.type ?? "non-attack", ...move.tags])].sort();
  const effect = [...new Set(move.mechanics.effectRuleTokens ?? [])].sort();
  return {
    category: move.category,
    timing,
    resource,
    acquisition: move.trainingDays === undefined ? "unspecified" : `training:${move.trainingDays}`,
    role,
    effect,
    usageContext: move.styleId ?? "style-freestyle",
  };
};

const comparableMovesFor = (
  move: MoveDefinition,
  view: CombatMechanicsView,
): readonly CustomMoveComparable[] => {
  const target = moveDimensionsFor(move);
  return view.moves
    .filter((candidate) => candidate.id !== move.id)
    .map((candidate) => {
      const dimensions = moveDimensionsFor(candidate);
      const sharedEffects = dimensions.effect.filter((token) =>
        target.effect.includes(token),
      ).length;
      const sharedRoles = dimensions.role.filter((role) => target.role.includes(role)).length;
      const score =
        (dimensions.category === target.category ? 8 : 0) +
        (dimensions.usageContext === target.usageContext ? 4 : 0) +
        (dimensions.timing.join(",") === target.timing.join(",") ? 3 : 0) +
        (dimensions.resource[0] === target.resource[0] ? 2 : 0) +
        (dimensions.resource[1] === target.resource[1] ? 1 : 0) +
        sharedEffects +
        sharedRoles;
      return {
        moveId: candidate.id,
        score,
        dimensions,
        rationale: `Matched category=${dimensions.category}, timing=${dimensions.timing.join("|") || "none"}, resource=${dimensions.resource.join("|")}, role=${dimensions.role.join("|") || "none"}, effect=${dimensions.effect.join("|") || "none"}, and usage-context=${dimensions.usageContext}.`,
      };
    })
    .sort((left, right) => right.score - left.score || left.moveId.localeCompare(right.moveId))
    .slice(0, 8);
};

const mechanicalSignatureFor = (move: MoveDefinition): string => {
  const { id: _id, name: _name, source: _source, ...mechanics } = move;
  return canonicalHash(mechanics);
};

const uniqueMoveId = (view: CombatMechanicsView, base: string, suffix: string): string => {
  const candidate = `move-custom-${slugFor(base)}-${suffix}`;
  return view.indexes.moves.has(candidate)
    ? `${candidate}-${canonicalHash(base).slice(-8)}`
    : candidate;
};

const moveWithId = (move: MoveDefinition, id: string): MoveDefinition => ({ ...move, id });

const templateWithMove = (
  template: SimulationTemplate,
  move: MoveDefinition,
  view: CombatMechanicsView,
  operation: "add" | "replace",
  suffix: string,
): SimulationTemplate => {
  const moveIds = [...template.moveIds];
  const category = move.category;
  const sameCategoryIndex = moveIds.findIndex(
    (moveId) => view.indexes.moves.get(moveId)?.category === category,
  );
  if (operation === "replace" && sameCategoryIndex >= 0) moveIds[sameCategoryIndex] = move.id;
  else if (!moveIds.includes(move.id)) {
    if (category === "mastery" && sameCategoryIndex >= 0) moveIds[sameCategoryIndex] = move.id;
    else moveIds.push(move.id);
  }
  return simulationTemplateSchema.parse({
    ...template,
    id: `${template.id}-${slugFor(suffix)}`,
    label: `${template.label} ${suffix}`,
    moveIds,
  });
};

const emptyOpponentTemplate = (template: SimulationTemplate, suffix: string): SimulationTemplate =>
  simulationTemplateSchema.parse({
    ...template,
    id: `${template.id}-${slugFor(suffix)}`,
    label: `${template.label} ${suffix}`,
    moveIds: [],
    transformationProfiles: [],
  });

type CustomHarnessExecutionResult =
  | SimulationFightExecutionResult
  | ReturnType<typeof runSimulationRequestsWithWorkers>["results"][number];

const limitsFor = (options: CustomMoveHarnessOptions) => ({
  maximumTurns: options.maximumTurns,
  maximumTransitions: options.maximumTransitions,
  semanticNoProgressLimit: options.semanticNoProgressLimit,
});

const variantIdFor = (arm: CustomMoveHarnessArm): string =>
  `simulation-variant:custom-${slugFor(arm)}`;

const targetWinnerFor = (
  result: SimulationFightExecutionResult,
  mirror: "original" | "mirrored",
): "target" | "control" | "draw" | null => {
  if (result.failure !== undefined || result.completion === undefined) return null;
  const combatants = Object.values(result.finalState.combatants) as readonly CombatantState[];
  const target = combatants[mirror === "original" ? 0 : 1];
  if (target === undefined) return null;
  if (result.completion.winnerCombatantId === undefined) return "draw";
  return result.completion.winnerCombatantId === target.id ? "target" : "control";
};

const observationFor = (
  source: CustomHarnessExecutionResult,
  mirror: "original" | "mirrored",
  pairId: string,
  requestRunId: string,
): CustomMoveRunObservation => {
  if ("ok" in source && source.ok === false) {
    const terminationReason =
      source.error.type === "combat-failure"
        ? "combat-failure"
        : source.error.type === "ai-failure"
          ? "ai-failure"
          : source.error.type === "unsupported-scope"
            ? "unsupported-scope"
            : source.error.type === "malformed-input" ||
                source.error.type === "unknown-reference" ||
                source.error.type === "incompatible-loadout"
              ? "invalid-fixture"
              : "ai-failure";
    return {
      pairId,
      runId: requestRunId,
      mirror,
      ok: false,
      terminationReason,
      targetWinner: null,
      targetDamageDealt: null,
      targetRemainingHitPoints: null,
      replaySeed: null,
      failureType: source.error.type,
    };
  }
  const result = "ok" in source ? source.value : source;
  if (result.failure !== undefined)
    return {
      pairId,
      runId: result.runId,
      mirror,
      ok: false,
      terminationReason: result.terminationReason,
      targetWinner: null,
      targetDamageDealt: null,
      targetRemainingHitPoints: null,
      replaySeed: null,
      failureType: result.failure.type,
    };
  const combatants = Object.values(result.finalState.combatants) as readonly CombatantState[];
  const target = combatants[mirror === "original" ? 0 : 1];
  const control = combatants[mirror === "original" ? 1 : 0];
  return {
    pairId,
    runId: result.runId,
    mirror,
    ok: result.failure === undefined,
    terminationReason: result.terminationReason,
    targetWinner: targetWinnerFor(result, mirror),
    targetDamageDealt:
      target === undefined || control === undefined
        ? null
        : (result.summary.damageByCombatant[control.id] ?? 0),
    targetRemainingHitPoints: target?.hitPoints.current ?? null,
    replaySeed: result.replay.manifest.seeds.combat,
  };
};

const representativeObservationsFor = (
  observations: readonly CustomMoveRunObservation[],
): readonly CustomMoveRunObservation[] =>
  [
    ...observations.filter((observation) => !observation.ok).slice(0, 4),
    ...observations.filter((observation) => observation.ok).slice(0, 4),
  ].sort((left, right) => left.runId.localeCompare(right.runId));

const buildEvidence = (
  arm: CustomMoveHarnessArm,
  population: CustomMoveHarnessPopulation,
  observations: readonly CustomMoveRunObservation[],
): CustomMovePopulationEvidence => {
  const completed = observations.filter((observation) => observation.ok);
  const targetWins = completed.filter(
    (observation) => observation.targetWinner === "target",
  ).length;
  const controlWins = completed.filter(
    (observation) => observation.targetWinner === "control",
  ).length;
  const draws = completed.filter((observation) => observation.targetWinner === "draw").length;
  const orientationsByPair = new Map<string, Set<CustomMoveRunObservation["mirror"]>>();
  for (const observation of completed) {
    const orientations = orientationsByPair.get(observation.pairId) ?? new Set();
    orientations.add(observation.mirror);
    orientationsByPair.set(observation.pairId, orientations);
  }
  const damages = completed.flatMap((observation) =>
    observation.targetDamageDealt === null ? [] : [observation.targetDamageDealt],
  );
  const remaining = completed.flatMap((observation) =>
    observation.targetRemainingHitPoints === null ? [] : [observation.targetRemainingHitPoints],
  );
  return {
    arm,
    population,
    pairCount: Math.floor(observations.length / 2),
    completedPairs: [...orientationsByPair.values()].filter(
      (orientations) => orientations.has("original") && orientations.has("mirrored"),
    ).length,
    failedRuns: observations.length - completed.length,
    targetWins,
    controlWins,
    draws,
    targetWinRate:
      completed.length === 0
        ? null
        : summarizeSimulationRate(
            targetWins,
            completed.length,
            0,
            observations.length - completed.length,
          ),
    meanTargetDamageDealt:
      damages.length === 0
        ? null
        : damages.reduce((total, value) => total + value, 0) / damages.length,
    meanTargetRemainingHitPoints:
      remaining.length === 0
        ? null
        : remaining.reduce((total, value) => total + value, 0) / remaining.length,
    // Successful fight observations are streamed into aggregate statistics;
    // only a bounded representative sample is retained in the dossier.
    observations: representativeObservationsFor(observations),
  };
};

const requestFor = ({
  arm,
  population,
  iteration,
  mirror,
  targetTemplate,
  opponentTemplate,
  view,
  targetMoveId,
  rootSeed,
  fixedTime,
  limits,
}: {
  readonly arm: CustomMoveHarnessArm;
  readonly population: CustomMoveHarnessPopulation;
  readonly iteration: number;
  readonly mirror: "original" | "mirrored";
  readonly targetTemplate: SimulationTemplate;
  readonly opponentTemplate: SimulationTemplate;
  readonly view: CombatMechanicsView;
  readonly targetMoveId: string;
  readonly rootSeed: number;
  readonly fixedTime: Date;
  readonly limits: ReturnType<typeof limitsFor>;
}): SimulationFightRequest => {
  const templateA = mirror === "original" ? targetTemplate : opponentTemplate;
  const templateB = mirror === "original" ? opponentTemplate : targetTemplate;
  const scenario = createScenario({
    id: `simulation-scenario:custom-${slugFor(arm)}-${population}-${iteration + 1}-${mirror}`,
    family: population === "natural" ? "symmetric-control" : "move-isolation",
    checkpointId: targetTemplate.checkpointId,
    templateAId: templateA.id,
    templateBId: templateB.id,
    variantId: variantIdFor(arm),
    retention: "summary",
    limits,
    stoppingPolicy: "continue",
    deferred: false,
  });
  return {
    schemaVersion: "simulation-contracts:v1",
    runId: `simulation-run:custom-${slugFor(arm)}-${population}-${iteration + 1}-${mirror}`,
    scenario,
    templateA,
    templateB,
    profileA: {
      ...SIMULATION_QUALITY_PROFILE,
    },
    profileB: {
      ...SIMULATION_QUALITY_PROFILE,
    },
    rootSeed,
    iteration,
    mirror,
    fixedTime,
    mechanicsView: view,
    ...(population === "forced"
      ? {
          decisionPolicy: {
            type: "forced-target-first" as const,
            targetDefinitionId: targetMoveId,
            fallback: "first-legal" as const,
          },
        }
      : {}),
  };
};

interface CustomMoveArmResult {
  readonly evidence: CustomMovePopulationEvidence;
  readonly observations: readonly CustomMoveRunObservation[];
}

const resultForArm = (
  arm: CustomMoveHarnessArm,
  population: CustomMoveHarnessPopulation,
  pairCount: number,
  targetTemplate: SimulationTemplate,
  opponentTemplate: SimulationTemplate,
  view: CombatMechanicsView,
  targetMoveId: string,
  rootSeed: number,
  fixedTime: Date,
  limits: ReturnType<typeof limitsFor>,
  workers: number,
): CustomMoveArmResult => {
  const requests: SimulationFightRequest[] = [];
  const pairIds: { readonly pairId: string; readonly mirror: "original" | "mirrored" }[] = [];
  for (let iteration = 0; iteration < pairCount; iteration += 1) {
    const pairId = canonicalHash({ population, iteration });
    for (const mirror of ["original", "mirrored"] as const) {
      requests.push(
        requestFor({
          arm,
          population,
          iteration,
          mirror,
          targetTemplate,
          opponentTemplate,
          view,
          targetMoveId,
          rootSeed,
          fixedTime,
          limits,
        }),
      );
      pairIds.push({ pairId, mirror });
    }
  }
  const coordinated = runSimulationRequestsWithWorkers({
    requests,
    stoppingPolicy: "continue",
    workers,
    retainResults: true,
  });
  const observations = coordinated.results.map((execution, index) =>
    observationFor(
      execution,
      pairIds[index]!.mirror,
      pairIds[index]!.pairId,
      requests[index]!.runId,
    ),
  );
  return { evidence: buildEvidence(arm, population, observations), observations };
};

const evidenceKeyFor = (
  arm: CustomMoveHarnessArm,
  population: CustomMoveHarnessPopulation,
): string => `${arm}:${population}`;

const effectSizesFor = (
  evidence: readonly CustomMovePopulationEvidence[],
  rootSeed: number,
  bootstrapResamples: number,
  observationsByEvidenceKey: ReadonlyMap<string, readonly CustomMoveRunObservation[]>,
): readonly CustomMoveEffectSize[] => {
  const effects: CustomMoveEffectSize[] = [];
  for (const population of CUSTOM_MOVE_HARNESS_POPULATIONS) {
    const baseline = evidence.find(
      (entry) => entry.arm === "baseline" && entry.population === population,
    );
    if (baseline === undefined) continue;
    const baselineObservations =
      observationsByEvidenceKey.get(evidenceKeyFor("baseline", population)) ??
      baseline.observations;
    const baselineByPair = new Map(
      baselineObservations
        .filter((observation) => observation.ok && observation.mirror === "original")
        .map((observation) => [observation.pairId, observation]),
    );
    for (const arm of CUSTOM_MOVE_HARNESS_ARMS.filter((candidate) => candidate !== "baseline")) {
      const comparison = evidence.find(
        (entry) => entry.arm === arm && entry.population === population,
      );
      if (comparison === undefined) continue;
      const comparisonObservations =
        observationsByEvidenceKey.get(evidenceKeyFor(arm, population)) ?? comparison.observations;
      const targetWinEstimate =
        baseline.targetWinRate === null || comparison.targetWinRate === null
          ? null
          : comparison.targetWinRate.rate - baseline.targetWinRate.rate;
      effects.push({
        arm,
        population,
        metric: "target-win-rate",
        estimate: targetWinEstimate,
        interval:
          baseline.targetWinRate === null || comparison.targetWinRate === null
            ? null
            : {
                lower: comparison.targetWinRate.lower - baseline.targetWinRate.upper,
                upper: comparison.targetWinRate.upper - baseline.targetWinRate.lower,
                confidence: 0.95,
              },
        intervalMethod: targetWinEstimate === null ? "not-estimated" : "wilson-difference-envelope",
        completedPairs: comparison.completedPairs,
        rationale:
          "Difference uses population-local completed-pair win rates; no denominators are pooled across populations.",
      });
      const pairedDamage: SimulationPairedObservation[] = comparisonObservations
        .filter((observation) => observation.ok && observation.mirror === "original")
        .flatMap((observation) => {
          const base = baselineByPair.get(observation.pairId);
          if (
            base === undefined ||
            base.targetDamageDealt === null ||
            observation.targetDamageDealt === null
          )
            return [];
          return [
            {
              identity: observation.pairId,
              difference: observation.targetDamageDealt - base.targetDamageDealt,
            },
          ];
        });
      if (pairedDamage.length === 0)
        effects.push({
          arm,
          population,
          metric: "target-damage-dealt",
          estimate: null,
          interval: null,
          intervalMethod: "not-estimated",
          completedPairs: 0,
          rationale: "No complete paired observations were available for the target damage metric.",
        });
      else {
        const bootstrap = seededBootstrapPairedDifference(pairedDamage, rootSeed, {
          resamples: bootstrapResamples,
        });
        effects.push({
          arm,
          population,
          metric: "target-damage-dealt",
          estimate: bootstrap.estimate,
          interval: bootstrap,
          intervalMethod: "paired-bootstrap-95",
          completedPairs: pairedDamage.length,
          rationale: "Seeded paired bootstrap compares the same population-local pair identities.",
        });
      }
    }
  }
  return effects;
};

const emptyDossier = (
  draftId: string,
  preflight: CustomMovePreflight,
  staticFlags: readonly string[] = [],
): CustomMoveHarnessDossier => {
  const withoutHash = {
    schemaVersion: SIMULATION_CUSTOM_DOSSIER_VERSION,
    harnessVersion: SIMULATION_CUSTOM_HARNESS_VERSION,
    draftId,
    preflight,
    staticFlags,
    generatedBuilds: [],
    comparables: [],
    variants: [],
    executedArms: [],
    populationEvidence: [],
    effectSizes: [],
    controlValidation: {
      renamedControlMechanicallyEquivalent: false,
      strongerControlMechanicallyDistinct: false,
      strongerControlAvailable: false,
    },
    replaySeeds: {},
    anomalies: [...preflight.issues],
    limitations: ["No execution occurred because preflight did not produce an executable draft."],
    conclusion: "cannot-evaluate" as const,
  };
  return customMoveHarnessDossierSchema.parse({
    ...withoutHash,
    dossierHash: canonicalHash(withoutHash),
  });
};

const variantForArm = (
  arm: CustomMoveHarnessArm,
  draftMove: MoveDefinition,
  comparableId: string,
  renamedMove: MoveDefinition,
  strongerMove: MoveDefinition | undefined,
  base: CombatMechanicsView,
) => {
  if (arm === "baseline") return undefined;
  if (arm === "addition")
    return createSimulationVariant(base, {
      variantId: variantIdFor(arm),
      label: "Custom move addition",
      patches: [{ type: "add-move", move: draftMove }],
    });
  if (arm === "replacement")
    return createSimulationVariant(base, {
      variantId: variantIdFor(arm),
      label: "Custom move replacement",
      patches: [
        {
          type: "replace-move",
          moveId: comparableId,
          replacement: moveWithId(draftMove, comparableId),
        },
      ],
    });
  if (arm === "renamed-control")
    return createSimulationVariant(base, {
      variantId: variantIdFor(arm),
      label: "Renamed mechanically identical control",
      patches: [{ type: "add-move", move: renamedMove }],
    });
  if (strongerMove === undefined) return undefined;
  return createSimulationVariant(base, {
    variantId: variantIdFor(arm),
    label: "Deliberately stronger synthetic control",
    patches: [{ type: "add-move", move: strongerMove }],
  });
};

const strongerMoveFor = (
  move: MoveDefinition,
  view: CombatMechanicsView,
): MoveDefinition | undefined => {
  const id = uniqueMoveId(view, move.id, "stronger-control");
  const attack = move.mechanics.attack;
  const baseDamagePercent = attack?.baseDamagePercent;
  if (attack !== undefined && baseDamagePercent?.type === "literal")
    return {
      ...move,
      id,
      mechanics: {
        ...move.mechanics,
        attack: {
          ...attack,
          baseDamagePercent: { type: "literal", value: baseDamagePercent.value + 20 },
        },
      },
    };
  const kiCost = move.mechanics.kiCost;
  if (kiCost?.type === "literal" && kiCost.value > 0)
    return {
      ...move,
      id,
      mechanics: { ...move.mechanics, kiCost: { type: "literal", value: kiCost.value - 1 } },
    };
  return undefined;
};

const generatedBuildsFor = (
  move: MoveDefinition,
  maximumBuilds: number,
  rootSeed: number,
  view: CombatMechanicsView,
): SimulationBuildGenerationResult =>
  generateSimulationBuilds(
    {
      seed: rootSeed,
      maximumBuilds,
      styleIds: [move.styleId ?? "style-freestyle"],
      checkpointIds: ["early", "tf1"],
      archetypes: ["balanced", "transformation"],
      scenarioRoles: ["baseline", "transformation-timing"],
    },
    view,
  );

export const executeCustomMoveHarness = (
  draft: unknown,
  input: Partial<CustomMoveHarnessOptions> = {},
  view: CombatMechanicsView = CANONICAL_COMBAT_MECHANICS_VIEW,
): CustomMoveHarnessDossier => {
  const parsedDraft = customMoveDraftSchema.safeParse(draft);
  if (!parsedDraft.success || !moveShapeIsStructured(parsedDraft.data?.move)) {
    const preflight: CustomMovePreflight = {
      classification: "malformed",
      issues: [
        parsedDraft.success
          ? "Custom move does not contain a complete structured definition."
          : parsedDraft.error.message,
      ],
    };
    return emptyDossier(draftIdFor(draft), preflight);
  }
  const review = reviewCustomMove(parsedDraft.data, view);
  if (review.preflight.classification !== "executable")
    return emptyDossier(review.draftId, review.preflight, review.staticFlags);
  const options = customMoveHarnessOptionsSchema.parse({
    ...DEFAULT_CUSTOM_MOVE_HARNESS_OPTIONS,
    ...input,
    schemaVersion: SIMULATION_CUSTOM_HARNESS_VERSION,
  });
  const draftMove = parsedDraft.data.move;
  const comparables = comparableMovesFor(draftMove, view);
  if (comparables.length === 0) {
    const preflight = {
      ...review.preflight,
      classification: "ambiguous" as const,
      issues: [...review.preflight.issues, "No typed canonical comparable could be selected."],
    };
    return emptyDossier(review.draftId, preflight, review.staticFlags);
  }
  const comparable = view.indexes.moves.get(comparables[0]!.moveId);
  if (comparable === undefined)
    return emptyDossier(review.draftId, review.preflight, review.staticFlags);
  let generated: SimulationBuildGenerationResult;
  try {
    generated = generatedBuildsFor(draftMove, options.maximumBuilds, options.rootSeed, view);
  } catch (error) {
    const preflight: CustomMovePreflight = {
      ...review.preflight,
      classification: "declarative-capability-gap",
      issues: [...review.preflight.issues, error instanceof Error ? error.message : String(error)],
    };
    return emptyDossier(review.draftId, preflight, review.staticFlags);
  }
  const [baseTemplate, opponentTemplate] = generated.builds;
  if (baseTemplate === undefined || opponentTemplate === undefined) {
    const preflight: CustomMovePreflight = {
      ...review.preflight,
      classification: "supported-but-out-of-scope",
      issues: [
        ...review.preflight.issues,
        "Automatic generation did not produce two executable builds.",
      ],
    };
    return emptyDossier(review.draftId, preflight, review.staticFlags);
  }
  const renamedMove = moveWithId(draftMove, uniqueMoveId(view, draftMove.id, "renamed-control"));
  const strongerMove = strongerMoveFor(draftMove, view);
  const variants: CustomMoveHarnessVariant[] = [];
  const armViews = new Map<CustomMoveHarnessArm, { view: CombatMechanicsView; moveId: string }>();
  for (const arm of CUSTOM_MOVE_HARNESS_ARMS) {
    try {
      const variant = variantForArm(arm, draftMove, comparable.id, renamedMove, strongerMove, view);
      if (arm === "stronger-control" && variant === undefined) continue;
      const armView = variant?.mechanicsView ?? view;
      const moveId =
        arm === "baseline" || arm === "replacement"
          ? comparable.id
          : arm === "renamed-control"
            ? renamedMove.id
            : arm === "stronger-control"
              ? strongerMove!.id
              : draftMove.id;
      armViews.set(arm, { view: armView, moveId });
      variants.push({
        arm,
        moveId,
        mechanicsIdentity: armView.identity.contentHash,
        variantHash: variant?.variantHash ?? canonicalHash(view.identity),
      });
    } catch (error) {
      variants.push({
        arm,
        moveId: draftMove.id,
        mechanicsIdentity: view.identity.contentHash,
        variantHash: canonicalHash({
          arm,
          error: error instanceof Error ? error.message : String(error),
        }),
      });
    }
  }
  const evidence: CustomMovePopulationEvidence[] = [];
  const observationsByEvidenceKey = new Map<string, readonly CustomMoveRunObservation[]>();
  const anomalies: string[] = [];
  const replaySeeds: Record<string, number[]> = {};
  for (const arm of CUSTOM_MOVE_HARNESS_ARMS) {
    const armView = armViews.get(arm);
    if (armView === undefined) {
      anomalies.push(`${arm}:variant-not-executable`);
      continue;
    }
    const targetMove = armView.view.indexes.moves.get(armView.moveId) ?? draftMove;
    const targetTemplate = templateWithMove(
      baseTemplate,
      targetMove,
      armView.view,
      arm === "replacement" || arm === "baseline" ? "replace" : "add",
      `${arm}-target`,
    );
    for (const population of CUSTOM_MOVE_HARNESS_POPULATIONS) {
      const opponent =
        population === "natural"
          ? opponentTemplate
          : emptyOpponentTemplate(opponentTemplate, `${arm}-${population}-opponent`);
      const armResult = resultForArm(
        arm,
        population,
        options.pairCount,
        targetTemplate,
        opponent,
        armView.view,
        armView.moveId,
        options.rootSeed,
        new Date(options.fixedTime),
        limitsFor(options),
        options.workers,
      );
      evidence.push(armResult.evidence);
      observationsByEvidenceKey.set(evidenceKeyFor(arm, population), armResult.observations);
      replaySeeds[`${arm}:${population}`] = [
        ...new Set(
          armResult.observations.flatMap((observation) =>
            observation.replaySeed === null ? [] : [observation.replaySeed],
          ),
        ),
      ].slice(0, 8);
      for (const observation of armResult.observations)
        if (!observation.ok)
          anomalies.push(
            `${arm}:${population}:${observation.runId}:${observation.failureType ?? "unknown-failure"}`,
          );
    }
  }
  const effectSizes = effectSizesFor(
    evidence,
    options.rootSeed,
    options.bootstrapResamples,
    observationsByEvidenceKey,
  );
  const controlValidation = {
    renamedControlMechanicallyEquivalent:
      mechanicalSignatureFor(draftMove) === mechanicalSignatureFor(renamedMove),
    strongerControlMechanicallyDistinct:
      strongerMove !== undefined &&
      mechanicalSignatureFor(draftMove) !== mechanicalSignatureFor(strongerMove),
    strongerControlAvailable: strongerMove !== undefined,
  };
  const limitations = [
    "This dossier is staff decision support and never grants approval or rejection.",
    "Natural evidence here uses deterministic generated rule-valid builds; TF1 staff approval is neither inferred nor mutated.",
    "Isolation and forced populations diagnose exposure and reachability and are not balance denominators.",
    `Execution precision is ${options.pairCount} mirrored pairs per arm and population; adaptive continuation is available through a later harness invocation.`,
  ];
  const conclusion: CustomMoveReviewConclusion =
    anomalies.length > 0 ? "staff-review-required" : "insufficient-evidence";
  const withoutHash = {
    schemaVersion: SIMULATION_CUSTOM_DOSSIER_VERSION,
    harnessVersion: SIMULATION_CUSTOM_HARNESS_VERSION,
    draftId: review.draftId,
    preflight: review.preflight,
    staticFlags: review.staticFlags,
    generatedBuilds: generated.builds.map((build) => ({
      id: build.id,
      templateHash: canonicalHash(build),
    })),
    buildGenerationManifest: generated.manifest,
    buildGenerationManifestHash: generated.manifest.manifestHash,
    comparables,
    variants,
    executedArms: [...armViews.keys()],
    populationEvidence: evidence,
    effectSizes,
    controlValidation,
    replaySeeds,
    anomalies,
    limitations,
    conclusion,
  };
  return customMoveHarnessDossierSchema.parse({
    ...withoutHash,
    dossierHash: canonicalHash(withoutHash),
  });
};
