import {
  CANONICAL_COMBAT_MECHANICS_VIEW,
  type CombatMechanicsView,
} from "@dragonball-resurgence/combat-engine";
import {
  HARD_PROFILE,
  NORMAL_PROFILE,
  SIMULATION_QUALITY_PROFILE,
  type AiProfile,
} from "@dragonball-resurgence/ai-engine";
import type { MoveDefinition } from "@dragonball-resurgence/game-data";

import { canonicalHash } from "./canonical.js";
import { aggregateSimulationCoverageCellStatus } from "./completion.js";
import {
  createSimulationCoverageCell,
  createSimulationCoverageMatrix,
  simulationCoverageStratumIdFor,
  updateSimulationCoverageCell,
  type SimulationCoverageCell,
  type SimulationCoveragePopulation,
} from "./coverage.js";
import {
  createSimulationMoveCoverageArtifact,
  SIMULATION_MOVE_COVERAGE_CHECKPOINT_VERSION,
  SIMULATION_NATURAL_POPULATION_BLOCKER,
  type SimulationMoveCoverageArtifact,
} from "./coverage-artifacts.js";
import type {
  SimulationFailure,
  SimulationFightRequest,
  SimulationLimits,
  SimulationTemplate,
} from "./contracts.js";
import {
  createSimulationMoveCoverageDataset,
  addSimulationMoveFunnels,
  aggregateSimulationMoveFunnels,
  createEmptySimulationMoveFunnel,
  recordSimulationMoveFunnel,
  SIMULATION_MOVE_COVERAGE_POPULATIONS,
  type SimulationMoveCoverageRecord,
  type SimulationPopulationFunnels,
  type SimulationMoveCoverageDataset,
  updateSimulationMoveCoverage,
  type SimulationMoveCoverageStatus,
} from "./move-coverage.js";
import { runSimulationRequests, runSimulationRequestsWithWorkers } from "./coordinator.js";
import { SIMULATION_NATURAL_AI_PROFILES, type SimulationNaturalAiProfile } from "./exposure.js";
import { createScenario } from "./scenarios.js";
import { allocateSimulationSeed } from "./seeds.js";
import { generateSimulationBuilds } from "./build-generator.js";
import {
  approveAllSimulationTf1Overlays,
  createSyntheticArchetypes,
  SIMULATION_TF1_SOURCE_AUTHORITY,
} from "./templates.js";
import {
  addSimulationMoveMetricObservation,
  createSimulationMoveMetrics,
  markSimulationMoveMetricError,
  mergeSimulationMoveMetrics,
  type SimulationMoveMetrics,
} from "./metrics.js";
import {
  addSimulationStratifiedObservation,
  createSimulationStratifiedAccumulator,
  markSimulationStratifiedError,
  mergeSimulationStratifiedAccumulators,
  type SimulationStratifiedAccumulator,
} from "./statistics.js";

const slugFor = (moveId: string): string => moveId.replaceAll(":", "-");

/** Versioned catalog-closure precision looks, expressed as mirrored pairs per cell. */
export const SIMULATION_COVERAGE_PRECISION_LOOKS = [250, 500, 1_000, 2_000, 5_000, 10_000] as const;
/** Coverage is checkpointed in deterministic mirrored-pair batches. */
export const SIMULATION_COVERAGE_BATCH_SIZE = 25;

export const SIMULATION_MOVE_COVERAGE_EXPOSURE_CONTEXTS = [
  "target-present",
  "target-removed",
  "comparable-replacement",
] as const;
export type SimulationMoveCoverageExposureContext =
  (typeof SIMULATION_MOVE_COVERAGE_EXPOSURE_CONTEXTS)[number];

const isSimulationMoveCoverageExposureContext = (
  value: string,
): value is SimulationMoveCoverageExposureContext =>
  (SIMULATION_MOVE_COVERAGE_EXPOSURE_CONTEXTS as readonly string[]).includes(value);

export const nextSimulationCoveragePrecisionLook = (current: number): number => {
  const next = SIMULATION_COVERAGE_PRECISION_LOOKS.find((look) => look > current);
  if (next === undefined)
    throw new RangeError(`No declared coverage precision look follows ${current} pairs.`);
  return next;
};

const policyForPopulation = (population: SimulationCoveragePopulation): string => {
  if (population === "forced") return "forced-target-first";
  if (population === "natural") return "natural-ai";
  return "simulation-quality";
};

const evidenceRoleFor = (
  population: SimulationCoveragePopulation,
  exposureContext: SimulationMoveCoverageExposureContext,
): "natural-observation" | "mechanic-exposure" | "balance-control" => {
  if (population === "natural") return "natural-observation";
  if (exposureContext === "target-present") return "mechanic-exposure";
  return "balance-control";
};

const exposureContextsFor = (
  population: SimulationCoveragePopulation,
  requested: readonly SimulationMoveCoverageExposureContext[] | undefined,
): readonly SimulationMoveCoverageExposureContext[] => {
  let contexts = requested;
  if (contexts === undefined)
    contexts =
      population === "isolation"
        ? SIMULATION_MOVE_COVERAGE_EXPOSURE_CONTEXTS
        : (["target-present"] as const);
  if (contexts.length === 0 || new Set(contexts).size !== contexts.length)
    throw new RangeError("Coverage exposure contexts must be non-empty and unique.");
  if (population !== "isolation" && contexts.some((context) => context !== "target-present"))
    throw new RangeError("Natural and forced coverage support only the target-present context.");
  return contexts;
};

const failureDetailFor = (failure: SimulationFailure): string => {
  if ("detail" in failure) return failure.detail;
  if (failure.type === "exhausted-safeguard") return failure.reason;
  return failure.type;
};

const statusForCoverageCells = (
  failures: readonly unknown[],
  decisionCell: SimulationCoverageCell,
  triggerCell: SimulationCoverageCell,
): SimulationMoveCoverageStatus => {
  if (failures.length > 0) return "runner-failure";
  if (decisionCell.samplingStatus === "sufficient" && triggerCell.samplingStatus === "sufficient") {
    if (
      decisionCell.observationStatus === "never-eligible" &&
      triggerCell.observationStatus === "never-eligible"
    )
      return "never-eligible";
    if (decisionCell.population === "natural") return "observed-sufficient";
  }
  if (
    decisionCell.observationStatus === "never-eligible" &&
    triggerCell.observationStatus === "never-eligible"
  )
    return "never-eligible";
  if (
    decisionCell.observationStatus === "eligible-never-selected" ||
    triggerCell.observationStatus === "eligible-never-selected"
  )
    return "eligible-never-selected";
  if (
    decisionCell.samplingStatus === "not-applicable" &&
    triggerCell.samplingStatus === "not-applicable"
  )
    return "not-scheduled";
  if (decisionCell.samplingStatus === "sufficient" && triggerCell.samplingStatus === "sufficient")
    return "observed-sufficient";
  return "observed-low-sample";
};

const failureTypeForCell = (
  failure: SimulationFailure,
): "invalid-fixture" | "runner-failure" | "ai-failure" | "combat-failure" | "not-scheduled" => {
  if (failure.type === "ai-failure" || failure.type === "combat-failure") return failure.type;
  if (
    failure.type === "malformed-input" ||
    failure.type === "unknown-reference" ||
    failure.type === "incompatible-loadout" ||
    failure.type === "unsupported-scope"
  )
    return "invalid-fixture";
  return "runner-failure";
};

const templateFor = (
  id: string,
  moveIds: readonly string[],
  styleId: string,
  view: CombatMechanicsView,
  maximumHitPoints: number,
): SimulationTemplate => {
  const template = {
    schemaVersion: "simulation-contracts:v1" as const,
    id,
    label: id,
    kind: "synthetic" as const,
    checkpointId: "early",
    source: {
      path: "simulation/generated-move-coverage",
      text: "Deterministic move coverage fixture",
      sourceKind: "synthetic" as const,
    },
    raceId: "race-humans",
    classId: "race-class-humans-average-in-the-extreme",
    styleId,
    mastery: "move-coverage",
    specializationPoints: 8,
    specializationPointsDistribution: { hp: 3, power: 3, dexterity: 2, total: 8 },
    startingKiPolicy: "rules-default" as const,
    maximumHitPoints,
    stats: { power: 60, dexterity: 30, dexterityBonus: 0 },
    raceTraitIds: [],
    moveIds: [...moveIds],
    itemIds: [],
    transformationProfiles: [],
    gaps: [],
    aiProfileId: SIMULATION_QUALITY_PROFILE.identity.id,
  } satisfies SimulationTemplate;
  for (const moveId of moveIds)
    if (!view.indexes.moves.has(moveId)) throw new RangeError(`Unknown coverage move: ${moveId}.`);
  return template;
};

const naturalProfileFor = (profileId: SimulationNaturalAiProfile): AiProfile => {
  switch (profileId) {
    case "profile:normal":
      return NORMAL_PROFILE;
    case "profile:hard":
      return HARD_PROFILE;
    case "profile:simulation-quality":
      return SIMULATION_QUALITY_PROFILE;
  }
};

const naturalTemplatePairFor = (
  move: MoveDefinition,
  iteration: number,
  templates: readonly SimulationTemplate[],
): readonly [SimulationTemplate, SimulationTemplate] => {
  const candidates = templates
    .filter((template) => template.moveIds.includes(move.id))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (candidates.length === 0)
    throw new RangeError(`No approved TF1 overlay equips ${move.id} for natural exposure.`);
  const attacker = candidates[iteration % candidates.length]!;
  const opponent = templates.find((template) => template.id !== attacker.id) ?? candidates[0]!;
  return [attacker, opponent];
};

const naturalTemplatePoolCache = new WeakMap<
  CombatMechanicsView,
  Map<string, readonly SimulationTemplate[]>
>();

const naturalTemplatePoolFor = (
  view: CombatMechanicsView,
  approvalReference: string = SIMULATION_TF1_SOURCE_AUTHORITY,
): readonly SimulationTemplate[] => {
  const cachedByAuthority = naturalTemplatePoolCache.get(view);
  const cached = cachedByAuthority?.get(approvalReference);
  if (cached !== undefined) return cached;
  const tf1 = approveAllSimulationTf1Overlays(approvalReference);
  const generated = generateSimulationBuilds({}, view).builds;
  const synthetic = createSyntheticArchetypes(view);
  const representedMoves = new Set(
    [...tf1, ...generated, ...synthetic].flatMap((template) => template.moveIds),
  );
  const fallbackMoveIdsByStyle = new Map<string, string[]>();
  for (const move of view.moves) {
    const moveId = move.id;
    if (representedMoves.has(moveId)) continue;
    const styleId = move.styleId ?? "style-freestyle";
    const moveIds = fallbackMoveIdsByStyle.get(styleId) ?? [];
    moveIds.push(moveId);
    fallbackMoveIdsByStyle.set(styleId, moveIds);
  }
  const fallbackTemplates = [...fallbackMoveIdsByStyle.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([styleId, moveIds]) =>
      Array.from({ length: Math.ceil(moveIds.length / 5) }, (_, index) =>
        templateFor(
          `simulation-template:natural-coverage-${slugFor(styleId)}-${index + 1}`,
          moveIds.slice(index * 5, index * 5 + 5),
          styleId,
          view,
          // Style-group fallbacks are synthetic evidence fixtures, not source
          // balance sheets. Keep their survivability bounded so a Normal
          // observation cannot spend an entire precision look stalled.
          40,
        ),
      ),
    );
  const pool = Object.freeze([...tf1, ...generated, ...synthetic, ...fallbackTemplates]);
  (cachedByAuthority ?? new Map<string, readonly SimulationTemplate[]>()).set(
    approvalReference,
    pool,
  );
  if (cachedByAuthority === undefined)
    naturalTemplatePoolCache.set(view, new Map([[approvalReference, pool]]));
  return pool;
};

/** Returns the deterministic natural-population universe used for catalog coverage. */
export const createSimulationNaturalCoverageTemplates = (
  view: CombatMechanicsView = CANONICAL_COMBAT_MECHANICS_VIEW,
  approvalReference = SIMULATION_TF1_SOURCE_AUTHORITY,
): readonly SimulationTemplate[] => naturalTemplatePoolFor(view, approvalReference);

const comparableMoveFor = (
  move: MoveDefinition,
  view: CombatMechanicsView,
): MoveDefinition | undefined =>
  [...view.moves]
    .filter(
      (candidate) =>
        candidate.id !== move.id &&
        candidate.category === move.category &&
        (candidate.styleId === undefined ||
          move.styleId === undefined ||
          candidate.styleId === move.styleId ||
          candidate.styleId === "style-freestyle"),
    )
    .sort((left, right) => left.id.localeCompare(right.id))[0];

const baselineDamagingMoveFor = (
  move: MoveDefinition,
  view: CombatMechanicsView,
): MoveDefinition | undefined =>
  [...view.moves]
    .filter(
      (candidate) =>
        candidate.id !== move.id &&
        candidate.mechanics.attack !== undefined &&
        (candidate.styleId === undefined ||
          move.styleId === undefined ||
          candidate.styleId === move.styleId ||
          candidate.styleId === "style-freestyle"),
    )
    .sort((left, right) => left.id.localeCompare(right.id))[0];

const attackerMoveIdsFor = (
  move: MoveDefinition,
  baselineMoveIds: readonly string[],
  comparableMove: MoveDefinition | undefined,
  exposureContext: SimulationMoveCoverageExposureContext,
): readonly string[] => {
  if (exposureContext === "target-removed") return baselineMoveIds;
  if (exposureContext === "comparable-replacement")
    return [
      ...new Set(
        [comparableMove?.id, ...baselineMoveIds].filter((id): id is string => id !== undefined),
      ),
    ];
  return [...new Set([move.id, ...baselineMoveIds])];
};

const decisionPolicyFor = (
  move: MoveDefinition,
  population: SimulationCoveragePopulation,
  exposureContext: SimulationMoveCoverageExposureContext,
  comparableMove: MoveDefinition | undefined,
  baselineMove: MoveDefinition | undefined,
): SimulationFightRequest["decisionPolicy"] => {
  if (population === "forced")
    return {
      type: "forced-target-first",
      targetDefinitionId: move.id,
      fallback: "first-legal",
    };
  if (population !== "isolation") return undefined;
  let preferredDefinitionIds = [move.id];
  if (exposureContext === "comparable-replacement" && comparableMove !== undefined)
    preferredDefinitionIds = [comparableMove.id];
  return {
    type: "controlled-legal-preference",
    preferredDefinitionIds,
    baselineDefinitionId: baselineMove?.id ?? "basic-attack",
    fallback: "first-legal",
  };
};

const sourceLimitationsFor = (
  templates: readonly SimulationTemplate[] | undefined,
): readonly string[] =>
  Object.freeze(
    [
      ...new Set(
        (templates ?? [])
          .filter((template) => template.kind === "tf1-source")
          .flatMap((template) => template.gaps.map((gap) => `${template.id}: ${gap.reason}`)),
      ),
    ].sort((left, right) => left.localeCompare(right)),
  );

const requestFor = (
  move: MoveDefinition,
  iteration: number,
  rootSeed: number,
  fixedTime: Date,
  view: CombatMechanicsView,
  population: SimulationCoveragePopulation,
  naturalTemplates: readonly SimulationTemplate[] | undefined,
  naturalProfile: AiProfile,
  limits: SimulationLimits,
  mirror: "original" | "mirrored",
  exposureContext: SimulationMoveCoverageExposureContext,
  retention: "coverage" | "diagnostic",
): SimulationFightRequest => {
  const slug = slugFor(move.id);
  const comparableMove = comparableMoveFor(move, view);
  const baselineMove = baselineDamagingMoveFor(move, view);
  const baselineMoveIds = baselineMove === undefined ? [] : [baselineMove.id];
  let attackerTemplate: SimulationTemplate;
  let opponentTemplate: SimulationTemplate;
  if (population === "natural")
    [attackerTemplate, opponentTemplate] = naturalTemplatePairFor(
      move,
      iteration,
      naturalTemplates ?? [],
    );
  else {
    attackerTemplate = templateFor(
      `simulation-template:coverage-${slug}-attacker`,
      attackerMoveIdsFor(move, baselineMoveIds, comparableMove, exposureContext),
      move.styleId ?? "style-freestyle",
      view,
      40,
    );
    opponentTemplate = templateFor(
      `simulation-template:coverage-${slug}-opponent`,
      baselineMoveIds,
      baselineMove?.styleId ?? "style-freestyle",
      view,
      40,
    );
  }
  const mirrored = mirror === "mirrored";
  const templateA = mirrored ? opponentTemplate : attackerTemplate;
  const templateB = mirrored ? attackerTemplate : opponentTemplate;
  const seedFamilyId = `simulation-seed-family:move-coverage-${canonicalHash(
    population === "natural"
      ? {
          population,
          iteration,
          // Preserve attacker/opponent orientation in the stable identity. A
          // sorted pair would make two distinct natural fights share a run ID
          // when different moves select reciprocal template assignments.
          templatePair: [attackerTemplate.id, opponentTemplate.id],
          profile: naturalProfile.identity,
        }
      : { population, moveId: move.id, iteration, profile: SIMULATION_QUALITY_PROFILE.identity },
  )}`;
  const stableScenarioId = `simulation-scenario:move-coverage-${canonicalHash({
    population,
    seedFamilyId,
  }).slice("fnv1a-32:".length)}`;
  const scenario = createScenario({
    id:
      population === "natural"
        ? stableScenarioId
        : `simulation-scenario:move-isolation-${slug}-${iteration + 1}`,
    family: "move-isolation",
    checkpointId: "early",
    templateAId: templateA.id,
    templateBId: templateB.id,
    variantId: "simulation-variant:baseline",
    retention,
    limits,
    stoppingPolicy: "continue",
    deferred: false,
    note: `Move coverage exposure context: ${exposureContext}.`,
  });
  const decisionPolicy = decisionPolicyFor(
    move,
    population,
    exposureContext,
    comparableMove,
    baselineMove,
  );
  return {
    schemaVersion: "simulation-contracts:v1",
    runId:
      population === "natural"
        ? `simulation-run:move-coverage-${seedFamilyId}-${mirror}`
        : `simulation-run:move-coverage-${slug}-${exposureContext}-${iteration + 1}-${mirror}`,
    scenario,
    templateA,
    templateB,
    profileA: population === "natural" ? naturalProfile : SIMULATION_QUALITY_PROFILE,
    profileB: population === "natural" ? naturalProfile : SIMULATION_QUALITY_PROFILE,
    rootSeed,
    iteration,
    mirror,
    seedFamilyId,
    fixedTime,
    mechanicsView: view,
    ...(decisionPolicy === undefined ? {} : { decisionPolicy }),
  };
};

export interface SimulationMoveCoverageRunOptions {
  readonly mechanicsView?: CombatMechanicsView;
  readonly rootSeed?: number;
  readonly fixedTime?: Date;
  readonly targetPairs?: number;
  /** Compatibility alias; use targetPairs. */
  readonly targetFights?: number;
  readonly minimumEligibleStates?: number;
  readonly concurrency?: number;
  readonly workers?: number;
  readonly moveIds?: readonly string[];
  readonly population?: SimulationCoveragePopulation;
  readonly naturalOverlayApprovalReference?: string;
  readonly naturalProfileId?: SimulationNaturalAiProfile;
  readonly exposureContexts?: readonly SimulationMoveCoverageExposureContext[];
  /** Continue one population artifact at a later precision look. */
  readonly resumeFrom?: SimulationMoveCoverageArtifact;
  /** Retry failed runs at the current precision look and replace their errors. */
  readonly retryFailed?: boolean;
  /** Emit a compact, resumable artifact after each completed 25-pair batch. */
  readonly onCheckpoint?: (artifact: SimulationMoveCoverageArtifact) => void;
  /** Optional bounded limits for focused probes; production coverage uses defaults. */
  readonly limits?: SimulationLimits;
}

export interface SimulationMoveCoverageRunResult {
  readonly artifact: SimulationMoveCoverageArtifact;
  readonly runCount: number;
  readonly failedRunCount: number;
  readonly failureTypes: Readonly<Partial<Record<SimulationFailure["type"], number>>>;
  readonly failures: readonly {
    readonly moveId: string;
    readonly runId: string;
    readonly failure: SimulationFailure;
  }[];
}

type CoveragePath = "decision" | "trigger";

interface CoveragePathCounts {
  eligible: number;
  selected: number;
  triggered: number;
}

interface MoveCoverageFailure {
  readonly moveId: string;
  readonly runId: string;
  readonly failure: SimulationFailure;
}

interface MoveCoverageAccumulation {
  dataset: SimulationMoveCoverageDataset;
  runCount: number;
  failedRunCount: number;
  failureTypes: Partial<Record<SimulationFailure["type"], number>>;
  failures: MoveCoverageFailure[];
  failuresByMove: Map<string, MoveCoverageFailure[]>;
  failuresByMoveAndContext: Map<string, MoveCoverageFailure[]>;
  attemptedFightsByMove: Map<string, number>;
  attemptedFightsByMoveAndContext: Map<string, number>;
  representativeReplaySeedsByMove: Map<string, Set<number>>;
  metricsByMove: Map<string, SimulationMoveMetrics>;
  metricsByStratum: Map<string, SimulationMoveMetrics>;
  stratifiedAccumulators: Map<string, SimulationStratifiedAccumulator>;
  stratifiedAccumulatorsByStratum: Map<string, SimulationStratifiedAccumulator>;
}

type CoordinatedResult = ReturnType<typeof runSimulationRequests>["results"][number];
type SuccessfulCoordinatedResult = Extract<CoordinatedResult, { readonly ok: true }>;
type PairWinner = "a" | "b" | "draw";

interface PlannedCoverageRequest {
  readonly move: MoveDefinition;
  readonly creditedMoves: readonly MoveDefinition[];
  readonly stratumId: string;
  readonly request: SimulationFightRequest;
  readonly exposureContext: SimulationMoveCoverageExposureContext;
}

const plannedCoverageRequestFor = ({
  move,
  request,
  view,
  population,
  exposureContext,
}: {
  readonly move: MoveDefinition;
  readonly request: SimulationFightRequest;
  readonly view: CombatMechanicsView;
  readonly population: SimulationCoveragePopulation;
  readonly exposureContext: SimulationMoveCoverageExposureContext;
}): PlannedCoverageRequest => {
  const naturalFocalTemplate =
    request.mirror === "mirrored" ? request.templateB : request.templateA;
  const creditedMoves =
    population === "natural"
      ? [...new Set(naturalFocalTemplate.moveIds)]
          .map((moveId) => view.indexes.moves.get(moveId))
          .filter((candidate): candidate is MoveDefinition => candidate !== undefined)
      : [move];
  return {
    move,
    creditedMoves,
    stratumId: simulationCoverageStratumIdFor({
      moveId: move.id,
      population,
      profileId:
        population === "natural" ? request.profileA.identity.id : policyForPopulation(population),
      exposureContext,
      evidenceRole: evidenceRoleFor(population, exposureContext),
    }),
    request,
    exposureContext,
  };
};

interface CoveragePairResult {
  readonly request: SimulationFightRequest;
  readonly result: CoordinatedResult;
}

const accumulateFunnelCounts = (
  countsByPath: Map<CoveragePath, CoveragePathCounts>,
  funnel: NonNullable<NonNullable<SimulationMoveCoverageDataset["records"][number]["funnel"]>>,
) => {
  const decision = countsByPath.get("decision") ?? { eligible: 0, selected: 0, triggered: 0 };
  countsByPath.set("decision", {
    eligible: decision.eligible + funnel.decisionFunnel.eligible,
    selected: decision.selected + funnel.decisionFunnel.selected,
    triggered: decision.triggered,
  });
  const trigger = countsByPath.get("trigger") ?? { eligible: 0, selected: 0, triggered: 0 };
  countsByPath.set("trigger", {
    eligible: trigger.eligible + funnel.triggerFunnel.applicable,
    selected: trigger.selected,
    triggered: trigger.triggered + funnel.triggerFunnel.triggered,
  });
};

const accumulateMoveResult = (
  accumulation: MoveCoverageAccumulation,
  move: MoveDefinition,
  runId: string,
  result: ReturnType<typeof runSimulationRequests>["results"][number],
  countsByPath: Map<CoveragePath, CoveragePathCounts>,
  targetFights: number,
  minimumEligibleStates: number,
  population: SimulationCoveragePopulation,
  stratumId: string,
  request: SimulationFightRequest,
) => {
  const representativeSeeds =
    accumulation.representativeReplaySeedsByMove.get(move.id) ?? new Set();
  representativeSeeds.add(
    allocateSimulationSeed({
      rootSeed: request.rootSeed,
      scenarioId: request.scenario.id,
      variantId: request.scenario.variantId,
      pairId: request.seedFamilyId ?? canonicalHash([request.templateA.id, request.templateB.id]),
      templateAHash: request.seedFamilyId ?? canonicalHash(request.templateA),
      templateBHash: request.seedFamilyId ?? canonicalHash(request.templateB),
      strategyAId: request.profileA.identity.id,
      strategyBId: request.profileB.identity.id,
      iteration: request.iteration ?? 0,
      mirror: request.mirror ?? "original",
      namespace: "combat",
    }).seed,
  );
  accumulation.representativeReplaySeedsByMove.set(move.id, representativeSeeds);
  if (!result.ok) {
    const failure = { moveId: move.id, runId, failure: result.error };
    accumulation.failures.push(failure);
    const moveFailures = accumulation.failuresByMove.get(move.id) ?? [];
    moveFailures.push(failure);
    accumulation.failuresByMove.set(move.id, moveFailures);
    const metric =
      accumulation.metricsByMove.get(move.id) ?? createSimulationMoveMetrics(move.id, population);
    accumulation.metricsByMove.set(move.id, markSimulationMoveMetricError(metric));
    const stratumMetric =
      accumulation.metricsByStratum.get(stratumId) ??
      createSimulationMoveMetrics(move.id, population, stratumId);
    accumulation.metricsByStratum.set(stratumId, markSimulationMoveMetricError(stratumMetric));
    return;
  }
  const coverageSatisfied = result.value.terminationReason === "coverage-satisfied";
  if (!coverageSatisfied) {
    const metric =
      accumulation.metricsByMove.get(move.id) ?? createSimulationMoveMetrics(move.id, population);
    accumulation.metricsByMove.set(
      move.id,
      addSimulationMoveMetricObservation(metric, {
        result: result.value,
        mirror: result.value.replay.manifest.runId.endsWith("-mirrored") ? "mirrored" : "original",
        policy: policyForPopulation(population),
      }),
    );
    const stratumMetric =
      accumulation.metricsByStratum.get(stratumId) ??
      createSimulationMoveMetrics(move.id, population, stratumId);
    accumulation.metricsByStratum.set(
      stratumId,
      addSimulationMoveMetricObservation(stratumMetric, {
        result: result.value,
        mirror: result.value.replay.manifest.runId.endsWith("-mirrored") ? "mirrored" : "original",
        policy: policyForPopulation(population),
      }),
    );
  }
  representativeSeeds.add(result.value.replay.manifest.seeds.combat);
  const funnel =
    result.value.coverage?.moveFunnels[move.id] ?? result.value.diagnostics?.moveFunnels[move.id];
  if (funnel === undefined) return;
  accumulateFunnelCounts(countsByPath, funnel);
  accumulation.dataset = recordSimulationMoveFunnel(
    accumulation.dataset,
    { [move.id]: funnel },
    population,
    { targetFights, minimumEligibleStates },
  );
};

const executionCellsForMove = ({
  move,
  cells,
  countsByPath,
  completedFights,
  coverageSatisfiedRuns,
  failuresByContext,
  population,
  exposureContexts,
  view,
}: {
  readonly move: MoveDefinition;
  readonly cells: Map<string, SimulationCoverageCell>;
  readonly countsByPath: Map<string, Map<CoveragePath, CoveragePathCounts>>;
  readonly completedFights: Map<string, number>;
  readonly coverageSatisfiedRuns: Map<string, number>;
  readonly failuresByContext: ReadonlyMap<string, readonly MoveCoverageFailure[]>;
  readonly population: SimulationCoveragePopulation;
  readonly exposureContexts: readonly SimulationMoveCoverageExposureContext[];
  readonly view: CombatMechanicsView;
  // This helper intentionally centralizes the per-context cell state machine.
  // eslint-disable-next-line sonarjs/cognitive-complexity -- coverage context transitions are kept atomic
}) => {
  const comparableMove = comparableMoveFor(move, view);
  for (const exposureContext of exposureContexts)
    for (const mechanicPath of ["decision", "trigger"] as const) {
      const key = `${move.id}:${exposureContext}:${mechanicPath}`;
      const cell = cells.get(key);
      if (cell === undefined) throw new RangeError(`Missing ${population} cell for ${key}.`);
      if (exposureContext === "comparable-replacement" && comparableMove === undefined) {
        cells.set(
          key,
          createSimulationCoverageCell({
            ...cell,
            completedFights: 0,
            coverageSatisfiedRuns: 0,
            eligibleStates: 0,
            selectedStates: 0,
            triggeredStates: 0,
            samplingStatus: "not-applicable",
            observationStatus: "not-applicable",
            exclusionReason: "No same-category comparable damaging move exists.",
          }),
        );
        continue;
      }
      const counts =
        countsByPath.get(`${move.id}:${exposureContext}`)?.get(mechanicPath) ??
        ({ eligible: 0, selected: 0, triggered: 0 } satisfies CoveragePathCounts);
      const failures = failuresByContext.get(`${move.id}:${exposureContext}`) ?? [];
      const updated = updateSimulationCoverageCell(cell, {
        completedFights:
          cell.completedFights + (completedFights.get(`${move.id}:${exposureContext}`) ?? 0),
        coverageSatisfiedRuns:
          cell.coverageSatisfiedRuns +
          (coverageSatisfiedRuns.get(`${move.id}:${exposureContext}`) ?? 0),
        eligibleStates: cell.eligibleStates + counts.eligible,
        selectedStates: cell.selectedStates + counts.selected,
        triggeredStates: cell.triggeredStates + counts.triggered,
      });
      cells.set(
        key,
        failures.length === 0
          ? updated
          : createSimulationCoverageCell({
              ...updated,
              samplingStatus: "failed",
              observationStatus:
                updated.evidenceRole === "balance-control" ? "not-applicable" : "observed",
              failureType: failureTypeForCell(failures[0]!.failure),
            }),
      );
    }
};

const winnerByPositionFor = (result: SuccessfulCoordinatedResult): PairWinner => {
  const ids = Object.values(result.value.finalState.combatants).map((combatant) =>
    String(combatant.id),
  );
  const winner = result.value.completion?.winnerCombatantId;
  if (winner !== undefined && String(winner) === ids[0]) return "a";
  if (winner !== undefined && String(winner) === ids[1]) return "b";
  return "draw";
};

const targetWinnerFor = (
  result: SuccessfulCoordinatedResult,
  mirror: "original" | "mirrored",
): PairWinner => {
  const winner = winnerByPositionFor(result);
  if (mirror === "original" || winner === "draw") return winner;
  return winner === "a" ? "b" : "a";
};

const outgoingDamageFor = (result: SuccessfulCoordinatedResult, position: "a" | "b"): number => {
  const ids = Object.values(result.value.finalState.combatants).map((combatant) =>
    String(combatant.id),
  );
  const targetId = position === "a" ? ids[1] : ids[0];
  return result.value.summary.damageByCombatant[targetId ?? ""] ?? 0;
};

const accumulateStratifiedPair = (
  accumulation: MoveCoverageAccumulation,
  move: MoveDefinition,
  results: readonly CoordinatedResult[],
  requests: readonly SimulationFightRequest[],
  population: SimulationCoveragePopulation,
  stratumId: string,
): void => {
  let accumulator =
    accumulation.stratifiedAccumulators.get(move.id) ??
    createSimulationStratifiedAccumulator(`${population}:${move.id}`);
  let stratumAccumulator =
    accumulation.stratifiedAccumulatorsByStratum.get(stratumId) ??
    createSimulationStratifiedAccumulator(stratumId);
  const original = results[0];
  const mirrored = results[1];
  if (original?.ok !== true || mirrored?.ok !== true) {
    accumulation.stratifiedAccumulators.set(move.id, markSimulationStratifiedError(accumulator));
    accumulation.stratifiedAccumulatorsByStratum.set(
      stratumId,
      markSimulationStratifiedError(stratumAccumulator),
    );
    return;
  }
  if (original.value.pairId !== mirrored.value.pairId) {
    accumulation.stratifiedAccumulators.set(move.id, markSimulationStratifiedError(accumulator));
    accumulation.stratifiedAccumulatorsByStratum.set(
      stratumId,
      markSimulationStratifiedError(stratumAccumulator),
    );
    return;
  }
  const originalMirror = requests[0]?.mirror ?? "original";
  const mirroredMirror = requests[1]?.mirror ?? "mirrored";
  const winners = [
    targetWinnerFor(original, originalMirror),
    targetWinnerFor(mirrored, mirroredMirror),
  ];
  const targetWins = winners.filter((winner) => winner === "a").length;
  const controlWins = winners.filter((winner) => winner === "b").length;
  let winner: "a" | "b" | "draw" = "draw";
  if (targetWins > controlWins) winner = "a";
  if (controlWins > targetWins) winner = "b";
  const damageA = (outgoingDamageFor(original, "a") + outgoingDamageFor(mirrored, "b")) / 2;
  const damageB = (outgoingDamageFor(original, "b") + outgoingDamageFor(mirrored, "a")) / 2;
  // The legacy move-level projection pools multiple exposure strata. Its pair
  // identity therefore needs a compatibility-only namespace; the canonical
  // by-stratum accumulator below keeps the stable seed-family pair identity.
  const pooledPairId = `${stratumId}:${original.value.pairId}`;
  accumulator = addSimulationStratifiedObservation(accumulator, {
    pairId: pooledPairId,
    winner,
    turns: Math.round(
      (original.value.finalState.turnNumber + mirrored.value.finalState.turnNumber) / 2,
    ),
    damageA,
    damageB,
    primaryDifference: damageA - damageB,
    representativeSeed: original.value.replay.manifest.seeds.combat,
  });
  accumulation.stratifiedAccumulators.set(move.id, accumulator);
  stratumAccumulator = addSimulationStratifiedObservation(stratumAccumulator, {
    pairId: original.value.pairId,
    winner,
    turns: Math.round(
      (original.value.finalState.turnNumber + mirrored.value.finalState.turnNumber) / 2,
    ),
    damageA,
    damageB,
    primaryDifference: damageA - damageB,
    representativeSeed: original.value.replay.manifest.seeds.combat,
  });
  accumulation.stratifiedAccumulatorsByStratum.set(stratumId, stratumAccumulator);
};

const coverageRequestsForMove = ({
  move,
  view,
  rootSeed,
  fixedTime,
  targetFights,
  population,
  naturalTemplates,
  naturalProfile,
  limits,
  priorAttemptsByContext,
  retryExposureContexts,
  accumulation,
  scheduledExposureContexts,
  retention,
}: {
  readonly move: MoveDefinition;
  readonly view: CombatMechanicsView;
  readonly rootSeed: number;
  readonly fixedTime: Date;
  readonly targetFights: number;
  readonly population: SimulationCoveragePopulation;
  readonly naturalTemplates: readonly SimulationTemplate[] | undefined;
  readonly naturalProfile: AiProfile;
  readonly limits: SimulationLimits;
  readonly priorAttemptsByContext: ReadonlyMap<string, number>;
  readonly retryExposureContexts?: ReadonlySet<string>;
  readonly accumulation: MoveCoverageAccumulation;
  readonly scheduledExposureContexts: readonly SimulationMoveCoverageExposureContext[];
  readonly retention: "coverage" | "diagnostic";
}): readonly PlannedCoverageRequest[] => {
  const pairBudgetFor = (persistedAttempts: number): number => {
    if (population !== "forced") return targetFights;
    if (retention === "coverage") return Math.floor(persistedAttempts / 2) + 1;
    return targetFights * 10;
  };
  const requests = scheduledExposureContexts.flatMap((exposureContext) => {
    const priorAttemptsForContext =
      priorAttemptsByContext.get(`${move.id}:${exposureContext}`) ?? 0;
    const persistedAttempts =
      accumulation.attemptedFightsByMoveAndContext.get(`${move.id}:${exposureContext}`) ??
      priorAttemptsForContext;
    const iterationOffset =
      retryExposureContexts?.has(`${move.id}:${exposureContext}`) === true
        ? Math.max(1, Math.floor(persistedAttempts / 2))
        : Math.floor(persistedAttempts / 2);
    // Forced coverage advances one mirrored pair at a time. The caller may
    // issue another deterministic retry round only for moves whose required
    // target decision/trigger was not observed.
    const pairBudget = pairBudgetFor(persistedAttempts);
    const remainingAttempts = Math.max(0, pairBudget * 2 - persistedAttempts);
    const contextRequests = Array.from({ length: remainingAttempts }, (_, index) => {
      const iteration = iterationOffset + Math.floor(index / 2);
      const mirror = index % 2 === 0 ? "original" : "mirrored";
      return {
        exposureContext,
        request: requestFor(
          move,
          iteration,
          rootSeed,
          fixedTime,
          view,
          population,
          naturalTemplates,
          naturalProfile,
          limits,
          mirror,
          exposureContext,
          retention,
        ),
      };
    });
    return contextRequests;
  });
  return requests.map(({ request, exposureContext }) =>
    plannedCoverageRequestFor({ move, request, view, population, exposureContext }),
  );
};

const naturalCoveragePairKeyFor = (request: SimulationFightRequest): string =>
  canonicalHash({
    rootSeed: request.rootSeed,
    seedFamilyId: request.seedFamilyId,
    iteration: request.iteration ?? 0,
    profileA: request.profileA.identity,
    profileB: request.profileB.identity,
    fixedTime: request.fixedTime.toISOString(),
  });

const mergeNaturalCoveragePlans = (
  left: PlannedCoverageRequest,
  right: PlannedCoverageRequest,
): PlannedCoverageRequest => {
  const creditedMoves = new Map(left.creditedMoves.map((move) => [move.id, move]));
  for (const move of right.creditedMoves) creditedMoves.set(move.id, move);
  return {
    ...left,
    creditedMoves: [...creditedMoves.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
};

/**
 * Streams natural requests by deterministic iteration and oriented template
 * pair. Only one iteration and one 25-pair batch are resident at a time.
 */
/* eslint-disable sonarjs/cognitive-complexity -- planner ordering and coverage checks stay atomic. */
function* naturalCoverageRequestBatches({
  moves,
  view,
  rootSeed,
  fixedTime,
  targetPairs,
  naturalTemplates,
  naturalProfile,
  limits,
  attemptedFightsByMoveAndContext,
  executionCells,
}: {
  readonly moves: readonly MoveDefinition[];
  readonly view: CombatMechanicsView;
  readonly rootSeed: number;
  readonly fixedTime: Date;
  readonly targetPairs: number;
  readonly naturalTemplates: readonly SimulationTemplate[];
  readonly naturalProfile: AiProfile;
  readonly limits: SimulationLimits;
  readonly attemptedFightsByMoveAndContext: ReadonlyMap<string, number>;
  readonly executionCells: ReadonlyMap<string, Pick<SimulationCoverageCell, "samplingStatus">>;
}): Generator<readonly PlannedCoverageRequest[], void, void> {
  for (let iteration = 0; iteration < targetPairs; iteration += 1) {
    const pairGroups = new Map<
      string,
      { readonly original?: PlannedCoverageRequest; readonly mirrored?: PlannedCoverageRequest }
    >();
    for (const move of moves) {
      const attempts = attemptedFightsByMoveAndContext.get(`${move.id}:target-present`) ?? 0;
      if (iteration < Math.floor(attempts / 2)) continue;
      const plans = (["original", "mirrored"] as const).map((mirror) =>
        plannedCoverageRequestFor({
          move,
          view,
          population: "natural",
          exposureContext: "target-present",
          request: requestFor(
            move,
            iteration,
            rootSeed,
            fixedTime,
            view,
            "natural",
            naturalTemplates,
            naturalProfile,
            limits,
            mirror,
            "target-present",
            "coverage",
          ),
        }),
      );
      for (const plan of plans) {
        const pairKey = naturalCoveragePairKeyFor(plan.request);
        const current = pairGroups.get(pairKey) ?? {};
        const side = plan.request.mirror === "mirrored" ? "mirrored" : "original";
        const existing = current[side];
        pairGroups.set(pairKey, {
          ...current,
          [side]: existing === undefined ? plan : mergeNaturalCoveragePlans(existing, plan),
        });
      }
    }
    const pairs = [...pairGroups.values()].flatMap((group) => {
      const original = group.original;
      const mirrored = group.mirrored;
      if (original === undefined || mirrored === undefined)
        throw new RangeError("Natural planner produced an incomplete mirrored pair.");
      const creditedMoves = new Map(original.creditedMoves.map((move) => [move.id, move]));
      for (const move of mirrored.creditedMoves) creditedMoves.set(move.id, move);
      const allCellsSufficient = [...creditedMoves.keys()].every((moveId) =>
        ["decision", "trigger"].every(
          (mechanicPath) =>
            executionCells.get(`${moveId}:target-present:${mechanicPath}`)?.samplingStatus ===
            "sufficient",
        ),
      );
      if (allCellsSufficient) return [];
      const sortedCreditedMoves = [...creditedMoves.values()].sort((a, b) =>
        a.id.localeCompare(b.id),
      );
      return [
        { ...original, creditedMoves: sortedCreditedMoves },
        { ...mirrored, creditedMoves: sortedCreditedMoves },
      ];
    });
    for (let offset = 0; offset < pairs.length; offset += SIMULATION_COVERAGE_BATCH_SIZE * 2)
      yield pairs.slice(offset, offset + SIMULATION_COVERAGE_BATCH_SIZE * 2);
  }
}
/* eslint-enable sonarjs/cognitive-complexity */

export interface SimulationNaturalCoverageScheduleOptions {
  readonly mechanicsView?: CombatMechanicsView;
  readonly rootSeed?: number;
  readonly fixedTime?: Date;
  readonly targetPairs?: number;
  readonly moveIds?: readonly string[];
  readonly naturalOverlayApprovalReference?: string;
  readonly naturalProfileId?: SimulationNaturalAiProfile;
  readonly limits?: SimulationLimits;
}

export interface SimulationNaturalCoverageScheduleEstimate {
  readonly schemaVersion: "simulation-natural-schedule:v1";
  readonly mechanicsIdentity: string;
  readonly naturalProfileId: SimulationNaturalAiProfile;
  readonly targetPairs: number;
  readonly selectedMoveCount: number;
  readonly uniqueNaturalMatchups: number;
  readonly totalRequiredFights: number;
  readonly scheduleHash: string;
}

type NaturalScheduleCell = Pick<SimulationCoverageCell, "samplingStatus">;

const naturalScheduleInputsFor = (options: SimulationNaturalCoverageScheduleOptions) => {
  const view = options.mechanicsView ?? CANONICAL_COMBAT_MECHANICS_VIEW;
  const targetPairs = options.targetPairs ?? 250;
  if (!Number.isInteger(targetPairs) || targetPairs < 1)
    throw new RangeError("Natural schedule targetPairs must be a positive integer.");
  const selectedMoveIds = options.moveIds === undefined ? undefined : new Set(options.moveIds);
  const moves = [...view.moves]
    .filter((move) => selectedMoveIds === undefined || selectedMoveIds.has(move.id))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (moves.length === 0) throw new RangeError("Natural schedule requires at least one move.");
  if (selectedMoveIds !== undefined && selectedMoveIds.size !== moves.length)
    throw new RangeError("Natural schedule contains an unknown move ID.");
  const naturalProfileId = options.naturalProfileId ?? SIMULATION_NATURAL_AI_PROFILES[0];
  const naturalApprovalReference =
    options.naturalOverlayApprovalReference ?? SIMULATION_TF1_SOURCE_AUTHORITY;
  const limits =
    options.limits ??
    ({
      maximumTurns: 250,
      maximumTransitions: 2_500,
      semanticNoProgressLimit: 100,
    } satisfies SimulationLimits);
  return {
    view,
    moves,
    rootSeed: options.rootSeed ?? 1_427_251_991,
    fixedTime: options.fixedTime ?? new Date("2026-01-01T00:00:00.000Z"),
    targetPairs,
    naturalProfileId,
    naturalTemplates: naturalTemplatePoolFor(view, naturalApprovalReference),
    naturalProfile: naturalProfileFor(naturalProfileId),
    limits,
  };
};

const advanceNaturalScheduleState = (
  batch: readonly PlannedCoverageRequest[],
  attemptedFightsByMoveAndContext: Map<string, number>,
  executionCells: Map<string, NaturalScheduleCell>,
  targetPairs: number,
): void => {
  advanceNaturalPlanningAttempts(batch, attemptedFightsByMoveAndContext);
  for (const plan of batch) {
    for (const move of plan.creditedMoves) {
      const attempts = attemptedFightsByMoveAndContext.get(`${move.id}:target-present`) ?? 0;
      if (Math.floor(attempts / 2) < targetPairs) continue;
      for (const mechanicPath of ["decision", "trigger"] as const)
        executionCells.set(`${move.id}:target-present:${mechanicPath}`, {
          samplingStatus: "sufficient",
        });
    }
  }
};

const advanceNaturalPlanningAttempts = (
  batch: readonly PlannedCoverageRequest[],
  attemptedFightsByMoveAndContext: Map<string, number>,
): void => {
  for (const plan of batch) {
    for (const move of plan.creditedMoves) {
      const contextKey = `${move.id}:target-present`;
      const attempts = (attemptedFightsByMoveAndContext.get(contextKey) ?? 0) + 1;
      attemptedFightsByMoveAndContext.set(contextKey, attempts);
    }
  }
};

const forEachNaturalScheduleBatch = (
  inputs: ReturnType<typeof naturalScheduleInputsFor>,
  visit: (batch: readonly PlannedCoverageRequest[]) => boolean,
): void => {
  const attemptedFightsByMoveAndContext = new Map<string, number>();
  const executionCells = new Map<string, NaturalScheduleCell>();
  const planner = naturalCoverageRequestBatches({
    ...inputs,
    attemptedFightsByMoveAndContext,
    executionCells,
  });
  for (const batch of planner) {
    const stop = visit(batch);
    advanceNaturalScheduleState(
      batch,
      attemptedFightsByMoveAndContext,
      executionCells,
      inputs.targetPairs,
    );
    if (stop) break;
  }
};

/** Estimates the deterministic natural schedule without running a fight. */
export const estimateSimulationNaturalCoverageSchedule = (
  options: SimulationNaturalCoverageScheduleOptions = {},
): SimulationNaturalCoverageScheduleEstimate => {
  const inputs = naturalScheduleInputsFor(options);
  const entries: {
    readonly runId: string;
    readonly pairKey: string;
    readonly creditedMoveIds: readonly string[];
  }[] = [];
  forEachNaturalScheduleBatch(inputs, (batch) => {
    entries.push(
      ...batch.map((plan) => ({
        runId: plan.request.runId,
        pairKey: naturalCoveragePairKeyFor(plan.request),
        creditedMoveIds: plan.creditedMoves.map((move) => move.id),
      })),
    );
    return false;
  });
  const pairKeys = new Set(entries.map((entry) => entry.pairKey));
  return {
    schemaVersion: "simulation-natural-schedule:v1",
    mechanicsIdentity: inputs.view.identity.contentHash,
    naturalProfileId: inputs.naturalProfileId,
    targetPairs: inputs.targetPairs,
    selectedMoveCount: inputs.moves.length,
    uniqueNaturalMatchups: pairKeys.size,
    totalRequiredFights: entries.length,
    scheduleHash: canonicalHash(entries),
  };
};

/** Returns the first deterministic fights from the production-shaped natural schedule. */
export const createSimulationNaturalCoverageRequests = (
  options: SimulationNaturalCoverageScheduleOptions & {
    readonly fightLimit: number;
  },
): readonly SimulationFightRequest[] => {
  if (!Number.isInteger(options.fightLimit) || options.fightLimit < 1)
    throw new RangeError("Natural schedule fightLimit must be a positive integer.");
  const inputs = naturalScheduleInputsFor(options);
  const requests: SimulationFightRequest[] = [];
  forEachNaturalScheduleBatch(inputs, (batch) => {
    for (const plan of batch) {
      requests.push(plan.request);
      if (requests.length >= options.fightLimit) return true;
    }
    return false;
  });
  return requests;
};

const processCoverageResult = ({
  plan,
  result,
  accumulation,
  countsByMove,
  completedFightsByMove,
  coverageSatisfiedRunsByMove,
  pairsByMove,
  targetFights,
  minimumEligibleStates,
  population,
}: {
  readonly plan: PlannedCoverageRequest;
  readonly result: CoordinatedResult;
  readonly accumulation: MoveCoverageAccumulation;
  readonly countsByMove: Map<string, Map<CoveragePath, CoveragePathCounts>>;
  readonly completedFightsByMove: Map<string, number>;
  readonly coverageSatisfiedRunsByMove: Map<string, number>;
  readonly pairsByMove: Map<string, CoveragePairResult[]>;
  readonly targetFights: number;
  readonly minimumEligibleStates: number;
  readonly population: SimulationCoveragePopulation;
  // This helper intentionally credits one execution to every equipped move and stratum.
  // eslint-disable-next-line sonarjs/cognitive-complexity -- multi-credit coverage accounting is centralized here
}): void => {
  accumulation.runCount += 1;
  if (!result.ok) {
    accumulation.failedRunCount += 1;
    accumulation.failureTypes[result.error.type] =
      (accumulation.failureTypes[result.error.type] ?? 0) + 1;
  }
  for (const move of plan.creditedMoves) {
    const contextKey = `${move.id}:${plan.exposureContext}`;
    accumulation.attemptedFightsByMove.set(
      move.id,
      (accumulation.attemptedFightsByMove.get(move.id) ?? 0) + 1,
    );
    accumulation.attemptedFightsByMoveAndContext.set(
      contextKey,
      (accumulation.attemptedFightsByMoveAndContext.get(contextKey) ?? 0) + 1,
    );
    const stratumId =
      move.id === plan.move.id
        ? plan.stratumId
        : simulationCoverageStratumIdFor({
            moveId: move.id,
            population,
            profileId:
              population === "natural"
                ? plan.request.profileA.identity.id
                : policyForPopulation(population),
            exposureContext: plan.exposureContext,
            evidenceRole: evidenceRoleFor(population, plan.exposureContext),
          });
    const countsByPath =
      countsByMove.get(contextKey) ?? new Map<CoveragePath, CoveragePathCounts>();
    countsByMove.set(contextKey, countsByPath);
    if (!result.ok) {
      const contextFailures =
        accumulation.failuresByMoveAndContext.get(contextKey) ?? ([] as MoveCoverageFailure[]);
      contextFailures.push({ moveId: move.id, runId: plan.request.runId, failure: result.error });
      accumulation.failuresByMoveAndContext.set(contextKey, contextFailures);
    }
    accumulateMoveResult(
      accumulation,
      move,
      plan.request.runId,
      result,
      countsByPath,
      targetFights,
      minimumEligibleStates,
      population,
      stratumId,
      plan.request,
    );
    if (result.ok && result.value.terminationReason === "engine-completed")
      completedFightsByMove.set(contextKey, (completedFightsByMove.get(contextKey) ?? 0) + 1);
    if (result.ok && result.value.terminationReason === "coverage-satisfied")
      coverageSatisfiedRunsByMove.set(
        contextKey,
        (coverageSatisfiedRunsByMove.get(contextKey) ?? 0) + 1,
      );
    if (result.ok && result.value.terminationReason === "engine-completed") {
      const pair = pairsByMove.get(contextKey) ?? [];
      pair.push({ request: plan.request, result });
      if (pair.length === 2) {
        accumulateStratifiedPair(
          accumulation,
          move,
          pair.map((entry) => entry.result),
          pair.map((entry) => entry.request),
          population,
          stratumId,
        );
        pairsByMove.delete(contextKey);
      } else pairsByMove.set(contextKey, pair);
    }
  }
};

interface CoverageRequestBatchResult {
  readonly countsByMove: Map<string, Map<CoveragePath, CoveragePathCounts>>;
  readonly completedFightsByMove: Map<string, number>;
  readonly coverageSatisfiedRunsByMove: Map<string, number>;
}

const runCoverageRequestBatches = ({
  plannedRequests,
  options,
  accumulation,
  targetFights,
  minimumEligibleStates,
  population,
  onBatch,
}: {
  readonly plannedRequests: readonly PlannedCoverageRequest[];
  readonly options: SimulationMoveCoverageRunOptions;
  readonly accumulation: MoveCoverageAccumulation;
  readonly targetFights: number;
  readonly minimumEligibleStates: number;
  readonly population: SimulationCoveragePopulation;
  readonly onBatch?: (batch: CoverageRequestBatchResult) => void;
}): void => {
  for (
    let offset = 0;
    offset < plannedRequests.length;
    offset += SIMULATION_COVERAGE_BATCH_SIZE * 2
  ) {
    const batchPlans = plannedRequests.slice(offset, offset + SIMULATION_COVERAGE_BATCH_SIZE * 2);
    const countsByMove = new Map<string, Map<CoveragePath, CoveragePathCounts>>();
    const completedFightsByMove = new Map<string, number>();
    const coverageSatisfiedRunsByMove = new Map<string, number>();
    const pairsByMove = new Map<string, CoveragePairResult[]>();
    const requestIndexByRunId = new Map(
      batchPlans.map((plan, index) => [plan.request.runId, index]),
    );
    if (requestIndexByRunId.size !== batchPlans.length)
      throw new RangeError("Coverage requests must have unique run IDs.");
    const pendingResults = new Map<number, CoordinatedResult>();
    let nextResultIndex = 0;
    const consumeProgress = (progress: {
      readonly runId: string;
      readonly result: CoordinatedResult;
    }) => {
      const index = requestIndexByRunId.get(progress.runId);
      if (index === undefined) throw new RangeError(`Unknown coverage result ${progress.runId}.`);
      pendingResults.set(index, progress.result);
      while (pendingResults.has(nextResultIndex)) {
        const result = pendingResults.get(nextResultIndex)!;
        pendingResults.delete(nextResultIndex);
        processCoverageResult({
          plan: batchPlans[nextResultIndex]!,
          result,
          accumulation,
          countsByMove,
          completedFightsByMove,
          coverageSatisfiedRunsByMove,
          pairsByMove,
          targetFights,
          minimumEligibleStates,
          population,
        });
        nextResultIndex += 1;
      }
    };
    const requests = batchPlans.map((plan) => plan.request);
    const coordinated =
      options.workers === undefined
        ? runSimulationRequests({
            requests,
            stoppingPolicy: "continue",
            concurrency: options.concurrency ?? 4,
            retainResults: false,
            onProgress: consumeProgress,
          })
        : runSimulationRequestsWithWorkers({
            requests,
            stoppingPolicy: "continue",
            workers: options.workers,
            retainResults: false,
            onProgress: consumeProgress,
          });
    if (coordinated.stoppedEarly) throw new Error("Coverage coordinator stopped unexpectedly.");
    if (pendingResults.size !== 0 || nextResultIndex !== batchPlans.length)
      throw new Error("Coverage coordinator did not stream every planned result.");
    onBatch?.({ countsByMove, completedFightsByMove, coverageSatisfiedRunsByMove });
  }
};

const finalizedDataset = (
  view: CombatMechanicsView,
  dataset: SimulationMoveCoverageDataset,
  executionCells: Map<string, SimulationCoverageCell>,
  population: SimulationCoveragePopulation,
  exposureContexts: readonly SimulationMoveCoverageExposureContext[],
  failuresByMove: ReadonlyMap<string, readonly MoveCoverageFailure[]>,
): SimulationMoveCoverageDataset => {
  const aggregateCellForPath = (
    moveId: string,
    mechanicPath: CoveragePath,
  ): SimulationCoverageCell => {
    const matching = exposureContexts.map((exposureContext) => {
      const cell = executionCells.get(`${moveId}:${exposureContext}:${mechanicPath}`);
      if (cell === undefined)
        throw new RangeError(
          `Missing ${population} ${exposureContext} cell for ${moveId}:${mechanicPath}.`,
        );
      return cell;
    });
    const targetPresent = matching.filter(
      (cell) => cell.strata.exposureContext === "target-present",
    );
    // The legacy dataset has one status per population. For v3 that status is
    // mechanic-exposure closure and therefore comes only from target-present;
    // the removed and replacement arms remain balance-control cells.
    const selected = targetPresent.length > 0 ? targetPresent : matching;
    const first = selected[0]!;
    return selected.length === 1
      ? first
      : updateSimulationCoverageCell(first, {
          completedFights: selected.reduce((total, cell) => total + cell.completedFights, 0),
          eligibleStates: selected.reduce((total, cell) => total + cell.eligibleStates, 0),
          selectedStates: selected.reduce((total, cell) => total + cell.selectedStates, 0),
          triggeredStates: selected.reduce((total, cell) => total + cell.triggeredStates, 0),
        });
  };
  return createSimulationMoveCoverageDataset(
    view,
    dataset.records.map((record) => {
      const decisionCell = aggregateCellForPath(record.moveId, "decision");
      const triggerCell = aggregateCellForPath(record.moveId, "trigger");
      const failures = failuresByMove.get(record.moveId) ?? [];
      const executionStatus = statusForCoverageCells(failures, decisionCell, triggerCell);
      return updateSimulationMoveCoverage(record, record.funnel, {
        ...(population === "natural"
          ? { naturalStatus: executionStatus }
          : {
              naturalStatus: "not-scheduled" as const,
              ...(population === "forced"
                ? { forcedStatus: executionStatus }
                : { isolationStatus: executionStatus }),
            }),
      });
    }),
  );
};

const finalCoverageCells = (
  naturalCells: ReadonlyMap<string, SimulationCoverageCell>,
  executionCells: ReadonlyMap<string, SimulationCoverageCell>,
  population: SimulationCoveragePopulation,
) =>
  Object.freeze(
    [
      ...(population === "natural"
        ? []
        : [...naturalCells].map(([key, cell]) => [`natural:${key}`, cell] as const)),
      ...executionCells,
    ]
      .map(([, cell]) => cell)
      .map((cell) =>
        cell.population === "natural" && population !== "natural"
          ? createSimulationCoverageCell({
              ...cell,
              samplingStatus: "not-applicable",
              observationStatus: "not-applicable",
            })
          : cell,
      )
      .sort((left, right) => left.cellId.localeCompare(right.cellId)),
  );

const coverageCellKey = (
  cell: Pick<
    SimulationCoverageCell,
    "moveId" | "scenarioFamily" | "checkpointId" | "population" | "mechanicPath" | "strata"
  >,
): string =>
  [
    cell.moveId,
    cell.scenarioFamily,
    cell.checkpointId,
    cell.population,
    cell.mechanicPath,
    JSON.stringify(cell.strata),
  ].join(":");

const seededCoverageCells = (
  cells: readonly SimulationCoverageCell[],
  resumeFrom: SimulationMoveCoverageArtifact | undefined,
): readonly SimulationCoverageCell[] => {
  if (resumeFrom === undefined) return cells;
  const priorCells = new Map(resumeFrom.coverageCells.map((cell) => [coverageCellKey(cell), cell]));
  return cells.map((cell) => {
    const prior = priorCells.get(coverageCellKey(cell));
    return prior === undefined
      ? cell
      : updateSimulationCoverageCell(cell, {
          completedFights: prior.completedFights,
          coverageSatisfiedRuns: prior.coverageSatisfiedRuns,
          eligibleStates: prior.eligibleStates,
          selectedStates: prior.selectedStates,
          triggeredStates: prior.triggeredStates,
        });
  });
};

const previousPopulationRunCountFor = (
  resumeFrom: SimulationMoveCoverageArtifact | undefined,
  population: SimulationCoveragePopulation,
): number => {
  if (resumeFrom === undefined) return 0;
  return (
    resumeFrom.generatedFrom.populationRunCounts?.[population] ??
    (resumeFrom.generatedFrom.population === population
      ? resumeFrom.generatedFrom.isolationRunCount
      : 0)
  );
};

const previousAttemptsForMove = (
  resumeFrom: SimulationMoveCoverageArtifact | undefined,
  population: SimulationCoveragePopulation,
  moveId: string,
): number => {
  if (resumeFrom === undefined) return 0;
  const persisted =
    resumeFrom.generatedFrom.populationAttemptedFightsByMove?.[population]?.[moveId];
  if (persisted !== undefined) return persisted;
  const decisionCell = resumeFrom.coverageCells.find(
    (cell) =>
      cell.moveId === moveId && cell.population === population && cell.mechanicPath === "decision",
  );
  return (
    (decisionCell?.completedFights ?? 0) +
    resumeFrom.errors.filter(
      (error) =>
        error.moveId === moveId && legacyErrorPopulationFor(resumeFrom, error) === population,
    ).length
  );
};

const previousAttemptsForMoveAndContext = (
  resumeFrom: SimulationMoveCoverageArtifact | undefined,
  population: SimulationCoveragePopulation,
  moveId: string,
  exposureContext: SimulationMoveCoverageExposureContext,
): number => {
  const persisted =
    resumeFrom?.generatedFrom.populationAttemptedFightsByMoveAndContext?.[population]?.[moveId]?.[
      exposureContext
    ];
  if (persisted !== undefined) return persisted;
  const cell = resumeFrom?.coverageCells.find(
    (candidate) =>
      candidate.population === population &&
      candidate.moveId === moveId &&
      candidate.mechanicPath === "decision" &&
      candidate.strata.exposureContext === exposureContext,
  );
  return cell?.completedFights ?? 0;
};

const hasRetryableFailureForMove = (
  resumeFrom: SimulationMoveCoverageArtifact | undefined,
  population: SimulationCoveragePopulation,
  moveId: string,
): boolean =>
  resumeFrom?.errors.some(
    (error) =>
      error.moveId === moveId && legacyErrorPopulationFor(resumeFrom, error) === population,
  ) === true ||
  resumeFrom?.coverageCells.some(
    (cell) =>
      cell.moveId === moveId && cell.population === population && cell.samplingStatus === "failed",
  ) === true;

const hasRetryableFailureForMoveAndContext = (
  resumeFrom: SimulationMoveCoverageArtifact | undefined,
  population: SimulationCoveragePopulation,
  moveId: string,
  exposureContext: SimulationMoveCoverageExposureContext,
): boolean =>
  resumeFrom?.errors.some(
    (error) =>
      error.moveId === moveId &&
      legacyErrorPopulationFor(resumeFrom, error) === population &&
      error.runId.includes(`-${exposureContext}-`),
  ) === true ||
  resumeFrom?.coverageCells.some(
    (cell) =>
      cell.moveId === moveId &&
      cell.population === population &&
      cell.strata.exposureContext === exposureContext &&
      cell.samplingStatus === "failed",
  ) === true;

const attemptedFightsByPopulationFor = (
  view: CombatMechanicsView,
  population: SimulationCoveragePopulation,
  resumeFrom: SimulationMoveCoverageArtifact | undefined,
  accumulation: MoveCoverageAccumulation,
): Readonly<Record<SimulationCoveragePopulation, Readonly<Record<string, number>>>> => {
  const mapFor = (candidate: SimulationCoveragePopulation) =>
    Object.fromEntries(
      view.moves.map((move) => [
        move.id,
        candidate === population
          ? (accumulation.attemptedFightsByMove.get(move.id) ??
            previousAttemptsForMove(resumeFrom, candidate, move.id))
          : previousAttemptsForMove(resumeFrom, candidate, move.id),
      ]),
    );
  return {
    natural: mapFor("natural"),
    isolation: mapFor("isolation"),
    forced: mapFor("forced"),
  };
};

const attemptedFightsByContextFor = (
  view: CombatMechanicsView,
  population: SimulationCoveragePopulation,
  exposureContexts: readonly SimulationMoveCoverageExposureContext[],
  resumeFrom: SimulationMoveCoverageArtifact | undefined,
  accumulation: MoveCoverageAccumulation,
): Readonly<
  Record<SimulationCoveragePopulation, Readonly<Record<string, Readonly<Record<string, number>>>>>
> => {
  const mapFor = (candidate: SimulationCoveragePopulation) => {
    const candidateContexts =
      candidate === population
        ? exposureContexts
        : (resumeFrom?.generatedFrom.exposureContexts ?? (["target-present"] as const));
    return Object.fromEntries(
      view.moves.map((move) => [
        move.id,
        Object.fromEntries(
          candidateContexts.map((context) => [
            context,
            candidate === population
              ? (accumulation.attemptedFightsByMoveAndContext.get(`${move.id}:${context}`) ??
                previousAttemptsForMoveAndContext(resumeFrom, candidate, move.id, context))
              : previousAttemptsForMoveAndContext(resumeFrom, candidate, move.id, context),
          ]),
        ),
      ]),
    );
  };
  return {
    natural: mapFor("natural"),
    isolation: mapFor("isolation"),
    forced: mapFor("forced"),
  };
};

const representativeReplaySeedsByPopulationFor = (
  view: CombatMechanicsView,
  population: SimulationCoveragePopulation,
  resumeFrom: SimulationMoveCoverageArtifact | undefined,
  accumulation: MoveCoverageAccumulation,
): Readonly<Record<SimulationCoveragePopulation, Readonly<Record<string, readonly number[]>>>> => {
  const mapFor = (candidate: SimulationCoveragePopulation) =>
    Object.fromEntries(
      view.moves.map((move) => {
        const prior =
          resumeFrom?.generatedFrom.representativeReplaySeedsByMove?.[candidate]?.[move.id] ?? [];
        const current =
          candidate === population
            ? [...(accumulation.representativeReplaySeedsByMove.get(move.id) ?? [])]
            : [];
        return [
          move.id,
          [...new Set([...prior, ...current])].sort((left, right) => left - right).slice(0, 8),
        ];
      }),
    );
  return {
    natural: mapFor("natural"),
    isolation: mapFor("isolation"),
    forced: mapFor("forced"),
  };
};

const validateCoverageResume = (
  resumeFrom: SimulationMoveCoverageArtifact | undefined,
  population: SimulationCoveragePopulation,
  targetFights: number,
  minimumEligibleStates: number,
  mechanicsView: CombatMechanicsView,
  rootSeed: number,
  fixedTime: Date,
  retryFailed: boolean,
  exposureContexts: readonly SimulationMoveCoverageExposureContext[],
): void => {
  if (resumeFrom === undefined) return;
  if (resumeFrom.schemaVersion !== "simulation-move-coverage-artifact:v3")
    throw new RangeError("Coverage resume accepts only simulation-move-coverage-artifact:v3.");
  if (resumeFrom.generatedFrom.population !== population)
    throw new RangeError("Coverage resume requires an artifact for the selected population.");
  if (resumeFrom.dataset.mechanicsIdentity !== mechanicsView.identity.contentHash)
    throw new RangeError("Coverage resume requires the same mechanics identity.");
  if (resumeFrom.generatedFrom.scenarioFamily !== "move-isolation")
    throw new RangeError("Coverage resume requires the move-isolation scenario family.");
  if (resumeFrom.generatedFrom.exposureContexts === undefined)
    throw new RangeError("Coverage resume requires context-stratified artifact metadata.");
  if (
    JSON.stringify(resumeFrom.generatedFrom.exposureContexts) !== JSON.stringify(exposureContexts)
  )
    throw new RangeError("Coverage resume requires the original exposure contexts.");
  const previousTargetPairs = resumeFrom.generatedFrom.targetPairs;
  if (targetFights <= previousTargetPairs && !(retryFailed && targetFights === previousTargetPairs))
    throw new RangeError("Coverage resume target must advance to a later precision look.");
  if (minimumEligibleStates < resumeFrom.generatedFrom.minimumEligibleStates)
    throw new RangeError("Coverage resume cannot lower the eligible-state threshold.");
  if (
    resumeFrom.generatedFrom.rootSeed !== undefined &&
    resumeFrom.generatedFrom.rootSeed !== rootSeed
  )
    throw new RangeError("Coverage resume requires the original root seed.");
  if (
    resumeFrom.generatedFrom.fixedTime !== undefined &&
    resumeFrom.generatedFrom.fixedTime !== fixedTime.toISOString()
  )
    throw new RangeError("Coverage resume requires the original fixed time.");
};

const selectedMovesFor = (
  options: SimulationMoveCoverageRunOptions,
  view: CombatMechanicsView,
  resumeFrom: SimulationMoveCoverageArtifact | undefined,
  population: SimulationCoveragePopulation,
): readonly MoveDefinition[] => {
  if (options.moveIds === undefined) {
    return resumeFrom === undefined
      ? [...view.moves]
      : view.moves.filter((move) => {
          const cells = resumeFrom.coverageCells.filter(
            (cell) => cell.moveId === move.id && cell.population === population,
          );
          return (
            cells.length === 0 ||
            cells.some(
              (cell) =>
                cell.samplingStatus !== "sufficient" &&
                cell.samplingStatus !== "excluded" &&
                (cell.samplingStatus !== "not-applicable" || population === "natural"),
            )
          );
        });
  }
  return options.moveIds.map((moveId) => {
    const move = view.indexes.moves.get(moveId);
    if (move === undefined) throw new RangeError(`Unknown coverage move: ${moveId}.`);
    return move;
  });
};

const incompleteExposureContextsForMove = (
  cells: ReadonlyMap<string, SimulationCoverageCell>,
  moveId: string,
  population: SimulationCoveragePopulation,
  exposureContexts: readonly SimulationMoveCoverageExposureContext[],
  targetFights: number,
  priorAttemptsByContext: ReadonlyMap<string, number>,
  view: CombatMechanicsView,
  requireForcedObservation = false,
): readonly SimulationMoveCoverageExposureContext[] =>
  exposureContexts.filter((exposureContext) =>
    exposureContext === "comparable-replacement" &&
    comparableMoveFor(view.indexes.moves.get(moveId)!, view) === undefined
      ? false
      : (priorAttemptsByContext.get(`${moveId}:${exposureContext}`) ?? 0) < targetFights * 2 ||
        (["decision", "trigger"] as const).some((mechanicPath) => {
          const cell = cells.get(`${moveId}:${exposureContext}:${mechanicPath}`);
          return (
            cell === undefined ||
            (cell.population === population &&
              cell.samplingStatus !== "sufficient" &&
              cell.samplingStatus !== "excluded" &&
              (cell.samplingStatus !== "not-applicable" || population === "natural")) ||
            (requireForcedObservation &&
              exposureContext === "target-present" &&
              cell.observationStatus !== "observed")
          );
        }),
  );

/**
 * Executes deterministic isolation runs for every public move. The only
 * outcome source is the normal simulation runner; this operation merely
 * reduces its diagnostic funnel into a canonical artifact.
 */
export const runSimulationMoveCoverage = (
  options: SimulationMoveCoverageRunOptions = {},
  // This is the intentional top-level coverage orchestration boundary.
  // eslint-disable-next-line sonarjs/cognitive-complexity -- validation, resume, scheduling, and reduction stay atomic
): SimulationMoveCoverageRunResult => {
  if (options.targetPairs !== undefined && options.targetFights !== undefined)
    throw new RangeError(
      "Coverage accepts either targetPairs or deprecated targetFights, not both.",
    );
  const view = options.mechanicsView ?? CANONICAL_COMBAT_MECHANICS_VIEW;
  const resumeFrom = options.resumeFrom;
  const persistedFixedTime =
    resumeFrom?.generatedFrom.fixedTime === undefined
      ? undefined
      : new Date(resumeFrom.generatedFrom.fixedTime);
  const rootSeed = options.rootSeed ?? resumeFrom?.generatedFrom.rootSeed ?? 1_427_251_991;
  const fixedTime = options.fixedTime ?? persistedFixedTime ?? new Date("2026-01-01T00:00:00.000Z");
  const minimumEligibleStates = options.minimumEligibleStates ?? 250;
  const population = options.population ?? "isolation";
  const targetFights =
    options.targetPairs ?? options.targetFights ?? (population === "forced" ? 1 : 250);
  const retention = options.targetPairs === undefined ? "diagnostic" : "coverage";
  const exposureContexts = exposureContextsFor(
    population,
    options.exposureContexts ?? resumeFrom?.generatedFrom.exposureContexts,
  );
  validateCoverageResume(
    resumeFrom,
    population,
    targetFights,
    minimumEligibleStates,
    view,
    rootSeed,
    fixedTime,
    options.retryFailed === true,
    exposureContexts,
  );
  if (persistedFixedTime !== undefined && Number.isNaN(persistedFixedTime.valueOf()))
    throw new RangeError("Coverage resume manifest contains an invalid fixed time.");
  const naturalApprovalReference =
    options.naturalOverlayApprovalReference ??
    resumeFrom?.generatedFrom.naturalOverlayApprovalReference ??
    SIMULATION_TF1_SOURCE_AUTHORITY;
  const naturalProfileId =
    options.naturalProfileId ??
    (resumeFrom?.generatedFrom.naturalProfileId as SimulationNaturalAiProfile | undefined) ??
    SIMULATION_NATURAL_AI_PROFILES[0];
  const naturalTemplates =
    population === "natural" ? naturalTemplatePoolFor(view, naturalApprovalReference) : undefined;
  const naturalProfile = naturalProfileFor(naturalProfileId);
  const limits =
    options.limits ??
    ({
      maximumTurns: 250,
      maximumTransitions: 2_500,
      semanticNoProgressLimit: 100,
    } satisfies SimulationLimits);
  const dataset = resumeFrom?.dataset ?? createSimulationMoveCoverageDataset(view);
  const matrixCells = exposureContexts.flatMap((exposureContext) => {
    const populations = Array.from(
      new Set<SimulationCoveragePopulation>([
        population,
        ...(exposureContext === "target-present" ? ["natural" as const] : []),
      ]),
    );
    return populations.flatMap((candidatePopulation) =>
      createSimulationCoverageMatrix(dataset, ["move-isolation"], "early", {
        targetFights,
        minimumEligibleStates,
        populations: [candidatePopulation],
        mechanicPaths: ["decision", "trigger"],
        strata: {
          exposureContext,
          profile:
            candidatePopulation === "natural"
              ? naturalProfileId
              : policyForPopulation(candidatePopulation),
        },
      }),
    );
  });
  const cells = seededCoverageCells(matrixCells, resumeFrom);
  const naturalCells = new Map(
    cells
      .filter((cell) => cell.population === "natural")
      .map((cell) => [`${cell.moveId}:${cell.strata.exposureContext}:${cell.mechanicPath}`, cell]),
  );
  const executionCells = new Map(
    cells
      .filter((cell) => cell.population === population)
      .map((cell) => [`${cell.moveId}:${cell.strata.exposureContext}:${cell.mechanicPath}`, cell]),
  );
  const accumulation: MoveCoverageAccumulation = {
    dataset,
    runCount: 0,
    failedRunCount: 0,
    failureTypes: {},
    failures: [],
    failuresByMove: new Map(),
    failuresByMoveAndContext: new Map(),
    attemptedFightsByMove: new Map(
      view.moves.map((move) => [move.id, previousAttemptsForMove(resumeFrom, population, move.id)]),
    ),
    attemptedFightsByMoveAndContext: new Map(
      view.moves.flatMap((move) =>
        exposureContexts.map(
          (exposureContext) =>
            [
              `${move.id}:${exposureContext}`,
              previousAttemptsForMoveAndContext(resumeFrom, population, move.id, exposureContext),
            ] as const,
        ),
      ),
    ),
    representativeReplaySeedsByMove: new Map(),
    metricsByMove: new Map(
      view.moves.map((move) => [
        move.id,
        resumeFrom?.metricsByMove?.[population]?.[move.id] ??
          createSimulationMoveMetrics(move.id, population),
      ]),
    ),
    metricsByStratum: new Map(Object.entries(resumeFrom?.metricsByStratum?.[population] ?? {})),
    stratifiedAccumulators: new Map(
      view.moves.map((move) => [
        move.id,
        resumeFrom?.stratifiedAccumulators?.[population]?.[move.id] ??
          createSimulationStratifiedAccumulator(`${population}:${move.id}`),
      ]),
    ),
    stratifiedAccumulatorsByStratum: new Map(
      Object.entries(resumeFrom?.stratifiedAccumulatorsByStratum?.[population] ?? {}),
    ),
  };
  const selectedMoves = selectedMovesFor(options, view, resumeFrom, population);
  const orderedMoves = [...selectedMoves].sort((left, right) => left.id.localeCompare(right.id));
  const selectedMoveIds = new Set(selectedMoves.map((move) => move.id));
  const artifactForCurrentState = (): SimulationMoveCoverageArtifact => {
    const currentDataset = finalizedDataset(
      view,
      accumulation.dataset,
      executionCells,
      population,
      exposureContexts,
      accumulation.failuresByMove,
    );
    const finalCells = finalCoverageCells(naturalCells, executionCells, population);
    const naturalPopulationApproved =
      population === "natural" &&
      (accumulation.runCount > 0 || resumeFrom?.generatedFrom.naturalPopulation === "approved");
    const populationRunCounts = {
      natural: previousPopulationRunCountFor(resumeFrom, "natural"),
      isolation: previousPopulationRunCountFor(resumeFrom, "isolation"),
      forced: previousPopulationRunCountFor(resumeFrom, "forced"),
    };
    populationRunCounts[population] += accumulation.runCount;
    const populationAttemptedFightsByMove = attemptedFightsByPopulationFor(
      view,
      population,
      resumeFrom,
      accumulation,
    );
    const representativeReplaySeedsByMove = representativeReplaySeedsByPopulationFor(
      view,
      population,
      resumeFrom,
      accumulation,
    );
    const metricsByMove = Object.fromEntries(
      SIMULATION_MOVE_COVERAGE_POPULATIONS.map((candidate) => [
        candidate,
        Object.fromEntries(
          view.moves.map((move) => [
            move.id,
            candidate === population
              ? (accumulation.metricsByMove.get(move.id) ??
                createSimulationMoveMetrics(move.id, candidate))
              : (resumeFrom?.metricsByMove?.[candidate]?.[move.id] ??
                createSimulationMoveMetrics(move.id, candidate)),
          ]),
        ),
      ]),
    ) as SimulationMoveCoverageArtifact["metricsByMove"];
    const metricsByStratum = Object.fromEntries(
      SIMULATION_MOVE_COVERAGE_POPULATIONS.map((candidate) => [
        candidate,
        candidate === population
          ? Object.fromEntries(accumulation.metricsByStratum)
          : (resumeFrom?.metricsByStratum?.[candidate] ?? {}),
      ]),
    ) as NonNullable<SimulationMoveCoverageArtifact["metricsByStratum"]>;
    const stratifiedAccumulators = Object.fromEntries(
      SIMULATION_MOVE_COVERAGE_POPULATIONS.map((candidate) => [
        candidate,
        Object.fromEntries(
          view.moves.map((move) => [
            move.id,
            candidate === population
              ? (accumulation.stratifiedAccumulators.get(move.id) ??
                createSimulationStratifiedAccumulator(`${candidate}:${move.id}`))
              : (resumeFrom?.stratifiedAccumulators?.[candidate]?.[move.id] ??
                createSimulationStratifiedAccumulator(`${candidate}:${move.id}`)),
          ]),
        ),
      ]),
    ) as SimulationMoveCoverageArtifact["stratifiedAccumulators"];
    const stratifiedAccumulatorsByStratum = Object.fromEntries(
      SIMULATION_MOVE_COVERAGE_POPULATIONS.map((candidate) => [
        candidate,
        candidate === population
          ? Object.fromEntries(accumulation.stratifiedAccumulatorsByStratum)
          : (resumeFrom?.stratifiedAccumulatorsByStratum?.[candidate] ?? {}),
      ]),
    ) as NonNullable<SimulationMoveCoverageArtifact["stratifiedAccumulatorsByStratum"]>;
    const priorErrors = (resumeFrom?.errors ?? []).filter(
      (error) => options.retryFailed !== true || !selectedMoveIds.has(error.moveId),
    );
    const errors = [
      ...priorErrors,
      ...accumulation.failures.map(({ moveId, runId, failure }) => ({
        moveId,
        runId,
        population,
        type: failure.type,
        detail: failureDetailFor(failure),
      })),
    ];
    const completedBatchCount = Math.max(
      0,
      ...finalCells.map((cell) =>
        Math.floor(
          (cell.completedFights + (cell.population === "forced" ? cell.coverageSatisfiedRuns : 0)) /
            2 /
            SIMULATION_COVERAGE_BATCH_SIZE,
        ),
      ),
    );
    return createSimulationMoveCoverageArtifact({
      generatedFrom: {
        mechanicsIdentity: view.identity.contentHash,
        scenarioFamily: "move-isolation",
        checkpointId: "early",
        targetPairs: targetFights,
        minimumEligibleStates,
        isolationRunCount: Math.max(populationRunCounts.isolation, 1),
        population,
        populationRunCounts,
        populationAttemptedFightsByMove,
        populationAttemptedFightsByMoveAndContext: attemptedFightsByContextFor(
          view,
          population,
          exposureContexts,
          resumeFrom,
          accumulation,
        ),
        representativeReplaySeedsByMove,
        rootSeed,
        fixedTime: fixedTime.toISOString(),
        naturalPopulation: naturalPopulationApproved ? "approved" : "draft",
        ...(naturalPopulationApproved
          ? {}
          : { naturalPopulationBlocker: SIMULATION_NATURAL_POPULATION_BLOCKER }),
        mechanicPaths: ["decision", "trigger"],
        exposureContexts,
        source: "simulation-move-coverage-runner:v3",
        checkpoint: {
          schemaVersion: SIMULATION_MOVE_COVERAGE_CHECKPOINT_VERSION,
          batchSize: 25,
          completedBatchCount,
          checkpointHash: canonicalHash({ batchSize: 25, completedBatchCount }),
        },
        ...(population === "natural"
          ? {
              naturalProfileId,
              naturalOverlayApprovalReference: naturalApprovalReference,
              naturalOverlayAuthority:
                naturalApprovalReference === SIMULATION_TF1_SOURCE_AUTHORITY
                  ? ("repository" as const)
                  : ("external-approval" as const),
              sourceLimitations: sourceLimitationsFor(naturalTemplates),
            }
          : {}),
      },
      dataset: currentDataset,
      coverageCells: finalCells,
      metricsByMove,
      metricsByStratum,
      stratifiedAccumulators,
      stratifiedAccumulatorsByStratum,
      errors,
    });
  };
  const processBatch = (plannedRequests: readonly PlannedCoverageRequest[]): void => {
    if (plannedRequests.length === 0) return;
    runCoverageRequestBatches({
      plannedRequests,
      options,
      accumulation,
      targetFights,
      minimumEligibleStates,
      population,
      onBatch: ({ countsByMove, completedFightsByMove, coverageSatisfiedRunsByMove }) => {
        for (const move of orderedMoves) {
          executionCellsForMove({
            move,
            cells: executionCells,
            countsByPath: countsByMove,
            completedFights: completedFightsByMove,
            coverageSatisfiedRuns: coverageSatisfiedRunsByMove,
            failuresByContext: accumulation.failuresByMoveAndContext,
            population,
            exposureContexts,
            view,
          });
        }
        options.onCheckpoint?.(artifactForCurrentState());
      },
    });
  };
  if (population === "natural") {
    if (naturalTemplates === undefined)
      throw new RangeError("Natural coverage requires templates.");
    const naturalPlanningAttempts = new Map(
      orderedMoves.map((move) => {
        const contextKey = `${move.id}:target-present`;
        const retryingFailure =
          options.retryFailed === true &&
          hasRetryableFailureForMoveAndContext(resumeFrom, population, move.id, "target-present");
        return [
          contextKey,
          retryingFailure ? 0 : (accumulation.attemptedFightsByMoveAndContext.get(contextKey) ?? 0),
        ] as const;
      }),
    );
    for (const batch of naturalCoverageRequestBatches({
      moves: orderedMoves,
      view,
      rootSeed,
      fixedTime,
      targetPairs: targetFights,
      naturalTemplates,
      naturalProfile,
      limits,
      attemptedFightsByMoveAndContext: naturalPlanningAttempts,
      executionCells,
    })) {
      processBatch(batch);
      advanceNaturalPlanningAttempts(batch, naturalPlanningAttempts);
    }
  } else {
    const maximumRounds = population === "forced" ? 10 : 1;
    for (let round = 0; round < maximumRounds; round += 1) {
      const plannedRequests = [orderedMoves].flatMap((moveGroup) =>
        moveGroup.flatMap((move) => {
          const retryingFailure =
            options.retryFailed === true &&
            hasRetryableFailureForMove(resumeFrom, population, move.id);
          const priorAttemptsByContext = new Map(
            exposureContexts.map((context) => [
              `${move.id}:${context}`,
              retryingFailure &&
              hasRetryableFailureForMoveAndContext(resumeFrom, population, move.id, context)
                ? 0
                : previousAttemptsForMoveAndContext(resumeFrom, population, move.id, context),
            ]),
          );
          const retryExposureContexts = new Set(
            exposureContexts
              .filter(
                (context) =>
                  retryingFailure &&
                  hasRetryableFailureForMoveAndContext(resumeFrom, population, move.id, context),
              )
              .map((context) => `${move.id}:${context}`),
          );
          return coverageRequestsForMove({
            move,
            view,
            rootSeed,
            fixedTime,
            targetFights,
            population,
            naturalTemplates,
            naturalProfile,
            limits,
            priorAttemptsByContext,
            retryExposureContexts,
            accumulation,
            scheduledExposureContexts: incompleteExposureContextsForMove(
              executionCells,
              move.id,
              population,
              exposureContexts,
              targetFights,
              priorAttemptsByContext,
              view,
              retention === "coverage" && population === "forced",
            ),
            retention,
          });
        }),
      );
      processBatch(plannedRequests);
      if (population !== "forced") break;
      const needsForcedRetry = orderedMoves.some((move) =>
        incompleteExposureContextsForMove(
          executionCells,
          move.id,
          population,
          exposureContexts,
          targetFights,
          new Map(
            exposureContexts.map((context) => [
              `${move.id}:${context}`,
              accumulation.attemptedFightsByMoveAndContext.get(`${move.id}:${context}`) ?? 0,
            ]),
          ),
          view,
          retention === "coverage" && population === "forced",
        ).includes("target-present"),
      );
      if (!needsForcedRetry) break;
    }
  }
  const artifact = artifactForCurrentState();
  return {
    artifact,
    runCount: accumulation.runCount,
    failedRunCount: accumulation.failedRunCount,
    failureTypes: accumulation.failureTypes,
    failures: accumulation.failures,
  };
};

export type SimulationMoveCoverageResumeOptions = Omit<
  SimulationMoveCoverageRunOptions,
  "resumeFrom" | "population" | "targetPairs" | "targetFights"
> & {
  readonly targetPairs?: number;
  /** Compatibility alias; use targetPairs. */
  readonly targetFights?: number;
  readonly population?: SimulationCoveragePopulation;
};

/** Continue a single-population artifact at a later precision look. */
export const resumeSimulationMoveCoverage = (
  artifact: SimulationMoveCoverageArtifact,
  options: SimulationMoveCoverageResumeOptions,
): SimulationMoveCoverageRunResult => {
  if (options.targetPairs !== undefined && options.targetFights !== undefined)
    throw new RangeError(
      "Coverage resume accepts either targetPairs or deprecated targetFights, not both.",
    );
  const population = options.population ?? artifact.generatedFrom.population;
  if (population === undefined)
    throw new RangeError("Coverage resume requires a single-population source artifact.");
  if (artifact.schemaVersion !== "simulation-move-coverage-artifact:v3")
    throw new RangeError("Coverage resume accepts only simulation-move-coverage-artifact:v3.");
  const targetPairs = options.targetPairs ?? options.targetFights;
  if (targetPairs === undefined) throw new RangeError("Coverage resume requires targetPairs.");
  const resumeOptions = { ...options };
  Reflect.deleteProperty(resumeOptions, "targetPairs");
  Reflect.deleteProperty(resumeOptions, "targetFights");
  return runSimulationMoveCoverage({
    ...resumeOptions,
    population,
    ...(options.targetPairs === undefined ? { targetFights: targetPairs } : { targetPairs }),
    minimumEligibleStates:
      options.minimumEligibleStates ?? artifact.generatedFrom.minimumEligibleStates,
    resumeFrom: artifact,
  });
};

const failureStatus = (cell: SimulationCoverageCell): boolean =>
  cell.samplingStatus === "failed" ||
  cell.status === "invalid-fixture" ||
  cell.status === "runner-failure";

const mergeCoverageCells = (
  left: SimulationCoverageCell,
  right: SimulationCoverageCell,
): SimulationCoverageCell => {
  const identity = [
    "cellId",
    "moveId",
    "scenarioFamily",
    "mechanicPath",
    "checkpointId",
    "population",
    "targetPairs",
    "minimumEligibleStates",
  ] as const;
  for (const key of identity)
    if (left[key] !== right[key])
      throw new RangeError(`Cannot merge incompatible coverage cells for ${left.cellId}.`);
  if (JSON.stringify(left.strata) !== JSON.stringify(right.strata))
    throw new RangeError(`Cannot merge coverage cells with different strata for ${left.cellId}.`);
  const merged = updateSimulationCoverageCell(left, {
    completedFights: left.completedFights + right.completedFights,
    coverageSatisfiedRuns: left.coverageSatisfiedRuns + right.coverageSatisfiedRuns,
    eligibleStates: left.eligibleStates + right.eligibleStates,
    selectedStates: left.selectedStates + right.selectedStates,
    triggeredStates: left.triggeredStates + right.triggeredStates,
  });
  if (left.samplingStatus === "not-applicable") return right;
  if (right.samplingStatus === "not-applicable") return left;
  if (failureStatus(left) || failureStatus(right))
    return createSimulationCoverageCell({
      ...merged,
      samplingStatus: "failed",
      observationStatus: merged.evidenceRole === "balance-control" ? "not-applicable" : "observed",
      failureType: left.failureType ?? right.failureType,
    });
  return merged;
};

const zeroPopulationFunnels = (): SimulationPopulationFunnels => ({
  natural: createEmptySimulationMoveFunnel(),
  isolation: createEmptySimulationMoveFunnel(),
  forced: createEmptySimulationMoveFunnel(),
});

const populationFunnelsForArtifactRecord = (
  record: SimulationMoveCoverageRecord,
  population: SimulationCoveragePopulation,
): SimulationPopulationFunnels => {
  if (record.populationFunnels !== undefined) return record.populationFunnels;
  const populationFunnels = zeroPopulationFunnels();
  return { ...populationFunnels, [population]: record.funnel } as SimulationPopulationFunnels;
};

const rebaseCoverageCell = (
  cell: SimulationCoverageCell,
  targetPairs: number,
  minimumEligibleStates: number,
): SimulationCoverageCell => {
  const rebased = createSimulationCoverageCell({
    ...cell,
    targetPairs,
    minimumEligibleStates,
    completedFights: 0,
    coverageSatisfiedRuns: 0,
    eligibleStates: 0,
    selectedStates: 0,
    triggeredStates: 0,
    samplingStatus: "not-started",
    observationStatus:
      cell.evidenceRole === "balance-control" ? "not-applicable" : "never-eligible",
  });
  if (cell.samplingStatus === "excluded")
    return createSimulationCoverageCell({
      ...rebased,
      samplingStatus: "excluded",
      observationStatus: cell.observationStatus,
    });
  if (cell.samplingStatus === "not-applicable")
    return createSimulationCoverageCell({
      ...rebased,
      samplingStatus: "not-applicable",
      observationStatus: "not-applicable",
      exclusionReason: cell.exclusionReason,
    });
  return updateSimulationCoverageCell(rebased, {
    completedFights: cell.completedFights,
    coverageSatisfiedRuns: cell.coverageSatisfiedRuns,
    eligibleStates: cell.eligibleStates,
    selectedStates: cell.selectedStates,
    triggeredStates: cell.triggeredStates,
  });
};

const failureCellStatus = (cell: SimulationCoverageCell): boolean => failureStatus(cell);

const legacyErrorPopulationFor = (
  source: SimulationMoveCoverageArtifact,
  error: SimulationMoveCoverageArtifact["errors"][number],
): SimulationCoveragePopulation | undefined => {
  if (error.population !== undefined) return error.population;
  if (source.generatedFrom.population !== undefined) return source.generatedFrom.population;
  const matchingPopulations = SIMULATION_MOVE_COVERAGE_POPULATIONS.filter((population) =>
    source.coverageCells.some(
      (cell) =>
        cell.population === population &&
        cell.moveId === error.moveId &&
        failureCellStatus(cell) &&
        (cell.failureType === error.type ||
          (cell.failureType === "runner-failure" && error.type === "unexpected-runner-failure")),
    ),
  );
  return matchingPopulations.length === 1 ? matchingPopulations[0] : undefined;
};

const errorsForPopulationResume = (
  source: SimulationMoveCoverageArtifact,
  population: SimulationCoveragePopulation,
): readonly SimulationMoveCoverageArtifact["errors"][number][] =>
  source.errors.filter((error) => legacyErrorPopulationFor(source, error) === population);

const populationArtifactForResume = (
  source: SimulationMoveCoverageArtifact,
  population: SimulationCoveragePopulation,
  mechanicsView: CombatMechanicsView,
  targetFights: number,
  minimumEligibleStates: number,
  manifestTargetFights = targetFights,
  manifestMinimumEligibleStates = minimumEligibleStates,
): SimulationMoveCoverageArtifact => {
  const exposureContexts = [
    ...new Set(
      source.coverageCells
        .filter((cell) => cell.population === population)
        .map((cell) => cell.strata.exposureContext)
        .filter(isSimulationMoveCoverageExposureContext),
    ),
  ];
  const records = source.dataset.records.map((record) => {
    const populationFunnels = populationFunnelsForArtifactRecord(record, population);
    return updateSimulationMoveCoverage(record, populationFunnels[population], {
      populationFunnels: {
        natural: populationFunnels.natural,
        isolation: populationFunnels.isolation,
        forced: populationFunnels.forced,
      },
      naturalStatus: population === "natural" ? record.naturalStatus : "unobserved",
      isolationStatus: population === "isolation" ? record.isolationStatus : "unobserved",
      forcedStatus: population === "forced" ? record.forcedStatus : "unobserved",
    });
  });
  const dataset = createSimulationMoveCoverageDataset(mechanicsView, records);
  const coverageCells = source.coverageCells
    .filter((cell) => cell.population === "natural" || cell.population === population)
    .map((cell) => {
      const populationCell =
        cell.population === "natural" && population !== "natural"
          ? createSimulationCoverageCell({
              ...cell,
              samplingStatus: "not-applicable",
              observationStatus: "not-applicable",
            })
          : cell;
      return rebaseCoverageCell(populationCell, targetFights, minimumEligibleStates);
    });
  const metricsByMove = {
    natural: population === "natural" ? (source.metricsByMove?.natural ?? {}) : {},
    isolation: population === "isolation" ? (source.metricsByMove?.isolation ?? {}) : {},
    forced: population === "forced" ? (source.metricsByMove?.forced ?? {}) : {},
  } as SimulationMoveCoverageArtifact["metricsByMove"];
  const metricsByStratum = {
    natural: population === "natural" ? (source.metricsByStratum?.natural ?? {}) : {},
    isolation: population === "isolation" ? (source.metricsByStratum?.isolation ?? {}) : {},
    forced: population === "forced" ? (source.metricsByStratum?.forced ?? {}) : {},
  } as NonNullable<SimulationMoveCoverageArtifact["metricsByStratum"]>;
  const stratifiedAccumulators = {
    natural: population === "natural" ? (source.stratifiedAccumulators?.natural ?? {}) : {},
    isolation: population === "isolation" ? (source.stratifiedAccumulators?.isolation ?? {}) : {},
    forced: population === "forced" ? (source.stratifiedAccumulators?.forced ?? {}) : {},
  } as SimulationMoveCoverageArtifact["stratifiedAccumulators"];
  const stratifiedAccumulatorsByStratum = {
    natural:
      population === "natural" ? (source.stratifiedAccumulatorsByStratum?.natural ?? {}) : {},
    isolation:
      population === "isolation" ? (source.stratifiedAccumulatorsByStratum?.isolation ?? {}) : {},
    forced: population === "forced" ? (source.stratifiedAccumulatorsByStratum?.forced ?? {}) : {},
  } as NonNullable<SimulationMoveCoverageArtifact["stratifiedAccumulatorsByStratum"]>;
  return createSimulationMoveCoverageArtifact({
    generatedFrom: {
      ...source.generatedFrom,
      mechanicsIdentity: mechanicsView.identity.contentHash,
      targetPairs: manifestTargetFights,
      minimumEligibleStates: manifestMinimumEligibleStates,
      population,
      isolationRunCount: Math.max(source.generatedFrom.isolationRunCount, 1),
      exposureContexts:
        exposureContexts.length > 0
          ? exposureContexts
          : (source.generatedFrom.exposureContexts ?? ["target-present"]),
      source: "simulation-move-coverage-resume:v3",
    },
    dataset,
    coverageCells,
    metricsByMove,
    metricsByStratum,
    stratifiedAccumulators,
    stratifiedAccumulatorsByStratum,
    errors: errorsForPopulationResume(source, population),
  });
};

const mergePopulationFunnels = (
  left: SimulationPopulationFunnels,
  right: SimulationPopulationFunnels,
): SimulationPopulationFunnels =>
  Object.fromEntries(
    SIMULATION_MOVE_COVERAGE_POPULATIONS.map((population) => [
      population,
      addSimulationMoveFunnels(left[population], right[population]),
    ]),
  ) as SimulationPopulationFunnels;

const mergeRecordsFromArtifact = (
  recordsByMove: Map<string, SimulationMoveCoverageRecord>,
  artifact: SimulationMoveCoverageArtifact,
  expectedRecordCount: number,
) => {
  if (artifact.dataset.records.length !== expectedRecordCount)
    throw new RangeError("Catalog artifacts must cover the same move catalog.");
  const population = artifact.generatedFrom.population;
  if (population === undefined)
    throw new RangeError("Catalog merge requires population-labeled artifacts.");
  for (const record of artifact.dataset.records) {
    const existing = recordsByMove.get(record.moveId);
    if (existing === undefined) throw new RangeError(`Catalog artifact lacks ${record.moveId}.`);
    if (existing.capabilityIdentity !== record.capabilityIdentity)
      throw new RangeError(`Catalog artifacts disagree on move capability ${record.moveId}.`);
    const populationFunnels = mergePopulationFunnels(
      existing.populationFunnels ?? zeroPopulationFunnels(),
      populationFunnelsForArtifactRecord(record, population),
    );
    recordsByMove.set(
      record.moveId,
      updateSimulationMoveCoverage(existing, aggregateSimulationMoveFunnels(populationFunnels), {
        populationFunnels,
      }),
    );
  }
};

const mergeCoverageCellsFromArtifacts = (artifacts: readonly SimulationMoveCoverageArtifact[]) => {
  const cellsById = new Map<string, SimulationCoverageCell>();
  for (const artifact of artifacts)
    for (const cell of artifact.coverageCells) {
      const existing = cellsById.get(cell.cellId);
      cellsById.set(
        cell.cellId,
        existing === undefined ? cell : mergeCoverageCells(existing, cell),
      );
    }
  return cellsById;
};

const statusesForMergedCells = (
  moveId: string,
  record: SimulationMoveCoverageRecord,
  cellsById: ReadonlyMap<string, SimulationCoverageCell>,
) => {
  const statuses: Partial<
    Record<"naturalStatus" | "isolationStatus" | "forcedStatus", SimulationMoveCoverageStatus>
  > = {};
  for (const population of SIMULATION_MOVE_COVERAGE_POPULATIONS) {
    const populationCells = [...cellsById.values()].filter(
      (cell) => cell.moveId === moveId && cell.population === population,
    );
    const requiredCells = populationCells.filter((cell) =>
      record.requiredMechanicPaths.includes(cell.mechanicPath),
    );
    const contextCount = new Set(
      requiredCells.map((cell) => cell.strata.exposureContext ?? "target-present"),
    ).size;
    if (requiredCells.length !== record.requiredMechanicPaths.length * contextCount) continue;
    const statusKey = `${population}Status` as "naturalStatus" | "isolationStatus" | "forcedStatus";
    const targetPresentCells = requiredCells.filter(
      (cell) => cell.strata.exposureContext === "target-present",
    );
    statuses[statusKey] = aggregateSimulationCoverageCellStatus(
      targetPresentCells.length > 0 ? targetPresentCells : requiredCells,
    ) as SimulationMoveCoverageStatus;
  }
  return statuses;
};

const mergeArtifactRecords = (
  artifacts: readonly SimulationMoveCoverageArtifact[],
  mechanicsView: CombatMechanicsView,
): SimulationMoveCoverageDataset => {
  const first = artifacts[0]!;
  const recordsByMove = new Map<string, SimulationMoveCoverageRecord>();
  for (const record of first.dataset.records) recordsByMove.set(record.moveId, record);
  for (const artifact of artifacts.slice(1))
    mergeRecordsFromArtifact(recordsByMove, artifact, first.dataset.records.length);
  const cellsById = mergeCoverageCellsFromArtifacts(artifacts);
  for (const [moveId, record] of recordsByMove) {
    recordsByMove.set(
      moveId,
      updateSimulationMoveCoverage(
        record,
        aggregateSimulationMoveFunnels(record.populationFunnels ?? zeroPopulationFunnels()),
        statusesForMergedCells(moveId, record, cellsById),
      ),
    );
  }
  return createSimulationMoveCoverageDataset(mechanicsView, [...recordsByMove.values()]);
};

const validateCatalogArtifactCompatibility = (
  artifact: SimulationMoveCoverageArtifact,
  first: SimulationMoveCoverageArtifact,
): void => {
  const manifest = artifact.generatedFrom;
  const firstManifest = first.generatedFrom;
  if (manifest.scenarioFamily !== firstManifest.scenarioFamily)
    throw new RangeError("Catalog artifacts must share one scenario family.");
  if (manifest.checkpointId !== firstManifest.checkpointId)
    throw new RangeError("Catalog artifacts must share one checkpoint.");
  if (manifest.targetPairs !== firstManifest.targetPairs)
    throw new RangeError("Catalog artifacts must share one target-pairs threshold.");
  if (manifest.minimumEligibleStates !== firstManifest.minimumEligibleStates)
    throw new RangeError("Catalog artifacts must share one eligible-state threshold.");
  if (artifact.dataset.mechanicsIdentity !== first.dataset.mechanicsIdentity)
    throw new RangeError("Catalog artifacts must share one mechanics identity.");
  if (
    manifest.rootSeed !== undefined &&
    firstManifest.rootSeed !== undefined &&
    manifest.rootSeed !== firstManifest.rootSeed
  )
    throw new RangeError("Catalog artifacts must share one root seed.");
  if (
    manifest.fixedTime !== undefined &&
    firstManifest.fixedTime !== undefined &&
    manifest.fixedTime !== firstManifest.fixedTime
  )
    throw new RangeError("Catalog artifacts must share one fixed time.");
};

const validateCatalogCompatibility = (
  artifacts: readonly SimulationMoveCoverageArtifact[],
  first: SimulationMoveCoverageArtifact,
) => {
  if (
    artifacts.some((artifact) => artifact.schemaVersion !== "simulation-move-coverage-artifact:v3")
  )
    throw new RangeError(
      "Catalog merge accepts only simulation-move-coverage-artifact:v3 artifacts.",
    );
  if (artifacts.some((artifact) => artifact.generatedFrom.population === undefined))
    throw new RangeError("Catalog merge requires population-labeled artifacts.");
  for (const artifact of artifacts) validateCatalogArtifactCompatibility(artifact, first);
};

const sourceContainsPopulation = (
  artifact: SimulationMoveCoverageArtifact,
  population: SimulationCoveragePopulation,
): boolean => {
  if (artifact.generatedFrom.population === population) return true;
  if (artifact.generatedFrom.population !== undefined) return false;
  if ((artifact.generatedFrom.populationRunCounts?.[population] ?? 0) > 0) return true;
  return artifact.coverageCells.some((cell) => cell.population === population);
};

const populationRunCountsFor = (
  artifacts: readonly SimulationMoveCoverageArtifact[],
): Record<SimulationCoveragePopulation, number> =>
  SIMULATION_MOVE_COVERAGE_POPULATIONS.reduce(
    (counts, population) => {
      counts[population] = artifacts
        .filter((artifact) => artifact.generatedFrom.population === population)
        .reduce(
          (total, artifact) =>
            total +
            (artifact.generatedFrom.populationRunCounts?.[population] ??
              artifact.generatedFrom.isolationRunCount),
          0,
        );
      return counts;
    },
    { natural: 0, isolation: 0, forced: 0 } as Record<SimulationCoveragePopulation, number>,
  );

const populationAttemptedFightsByMoveFor = (
  artifacts: readonly SimulationMoveCoverageArtifact[],
): Readonly<Record<SimulationCoveragePopulation, Readonly<Record<string, number>>>> => {
  const first = artifacts[0]!;
  const mapFor = (population: SimulationCoveragePopulation) =>
    Object.fromEntries(
      first.dataset.records.map((record) => [
        record.moveId,
        artifacts.reduce(
          (maximum, artifact) =>
            Math.max(maximum, previousAttemptsForMove(artifact, population, record.moveId)),
          0,
        ),
      ]),
    );
  return {
    natural: mapFor("natural"),
    isolation: mapFor("isolation"),
    forced: mapFor("forced"),
  };
};

const populationAttemptedFightsByMoveAndContextFor = (
  artifacts: readonly SimulationMoveCoverageArtifact[],
): NonNullable<
  SimulationMoveCoverageArtifact["generatedFrom"]["populationAttemptedFightsByMoveAndContext"]
> => {
  const first = artifacts[0]!;
  const contextsFor = (population: SimulationCoveragePopulation) => [
    ...new Set<SimulationMoveCoverageExposureContext>(
      artifacts
        .filter((artifact) => artifact.generatedFrom.population === population)
        .flatMap(
          (artifact) => artifact.generatedFrom.exposureContexts ?? (["target-present"] as const),
        ),
    ),
  ];
  const attemptedFightsFor = (
    population: SimulationCoveragePopulation,
    moveId: string,
    context: SimulationMoveCoverageExposureContext,
  ): number =>
    artifacts
      .filter((artifact) => artifact.generatedFrom.population === population)
      .reduce(
        (maximum, artifact) =>
          Math.max(
            maximum,
            artifact.generatedFrom.populationAttemptedFightsByMoveAndContext?.[population]?.[
              moveId
            ]?.[context] ?? 0,
          ),
        0,
      );
  const mapFor = (population: SimulationCoveragePopulation) =>
    Object.fromEntries(
      first.dataset.records.map((record) => [
        record.moveId,
        Object.fromEntries(
          contextsFor(population).map((context) => [
            context,
            attemptedFightsFor(population, record.moveId, context),
          ]),
        ),
      ]),
    );
  return {
    natural: mapFor("natural"),
    isolation: mapFor("isolation"),
    forced: mapFor("forced"),
  };
};

const representativeReplaySeedsByMoveFor = (
  artifacts: readonly SimulationMoveCoverageArtifact[],
): Readonly<Record<SimulationCoveragePopulation, Readonly<Record<string, readonly number[]>>>> => {
  const first = artifacts[0]!;
  const mapFor = (population: SimulationCoveragePopulation) =>
    Object.fromEntries(
      first.dataset.records.map((record) => [
        record.moveId,
        [
          ...new Set(
            artifacts.flatMap(
              (artifact) =>
                artifact.generatedFrom.representativeReplaySeedsByMove?.[population]?.[
                  record.moveId
                ] ?? [],
            ),
          ),
        ]
          .sort((left, right) => left - right)
          .slice(0, 8),
      ]),
    );
  return {
    natural: mapFor("natural"),
    isolation: mapFor("isolation"),
    forced: mapFor("forced"),
  };
};

const metricsByMoveFor = (
  artifacts: readonly SimulationMoveCoverageArtifact[],
): SimulationMoveCoverageArtifact["metricsByMove"] => {
  const first = artifacts[0]!;
  const mapFor = (population: SimulationCoveragePopulation) =>
    Object.fromEntries(
      first.dataset.records.map((record) => {
        const metrics = artifacts
          .map((artifact) => artifact.metricsByMove?.[population]?.[record.moveId])
          .filter((value): value is SimulationMoveMetrics => value !== undefined);
        return [
          record.moveId,
          metrics.reduce(
            (merged, current) => mergeSimulationMoveMetrics(merged, current),
            createSimulationMoveMetrics(record.moveId, population),
          ),
        ];
      }),
    );
  return {
    natural: mapFor("natural"),
    isolation: mapFor("isolation"),
    forced: mapFor("forced"),
  };
};

const metricsByStratumFor = (
  artifacts: readonly SimulationMoveCoverageArtifact[],
): NonNullable<SimulationMoveCoverageArtifact["metricsByStratum"]> => {
  const mapFor = (population: SimulationCoveragePopulation) => {
    const byId = new Map<string, SimulationMoveMetrics>();
    for (const artifact of artifacts)
      for (const [stratumId, metric] of Object.entries(
        artifact.metricsByStratum?.[population] ?? {},
      )) {
        const existing = byId.get(stratumId);
        byId.set(
          stratumId,
          existing === undefined ? metric : mergeSimulationMoveMetrics(existing, metric),
        );
      }
    return Object.fromEntries(byId);
  };
  return {
    natural: mapFor("natural"),
    isolation: mapFor("isolation"),
    forced: mapFor("forced"),
  };
};

const stratifiedAccumulatorsFor = (
  artifacts: readonly SimulationMoveCoverageArtifact[],
): SimulationMoveCoverageArtifact["stratifiedAccumulators"] => {
  const first = artifacts[0]!;
  const mapFor = (population: SimulationCoveragePopulation) =>
    Object.fromEntries(
      first.dataset.records.map((record) => {
        const accumulators = artifacts
          .map((artifact) => artifact.stratifiedAccumulators?.[population]?.[record.moveId])
          .filter((value): value is SimulationStratifiedAccumulator => value !== undefined);
        return [
          record.moveId,
          accumulators.reduce(
            (merged, current) => {
              if (merged.completedPairs === 0 && merged.errorCount === 0) return current;
              if (current.completedPairs === 0 && current.errorCount === 0) return merged;
              return mergeSimulationStratifiedAccumulators(merged, current);
            },
            createSimulationStratifiedAccumulator(`${population}:${record.moveId}`),
          ),
        ];
      }),
    );
  return {
    natural: mapFor("natural"),
    isolation: mapFor("isolation"),
    forced: mapFor("forced"),
  };
};

const stratifiedAccumulatorsByStratumFor = (
  artifacts: readonly SimulationMoveCoverageArtifact[],
): NonNullable<SimulationMoveCoverageArtifact["stratifiedAccumulatorsByStratum"]> => {
  const mapFor = (population: SimulationCoveragePopulation) => {
    const byId = new Map<string, SimulationStratifiedAccumulator>();
    for (const artifact of artifacts)
      for (const [stratumId, accumulator] of Object.entries(
        artifact.stratifiedAccumulatorsByStratum?.[population] ?? {},
      )) {
        const existing = byId.get(stratumId);
        if (existing === undefined) byId.set(stratumId, accumulator);
        else if (existing.completedPairs === 0 && existing.errorCount === 0)
          byId.set(stratumId, accumulator);
        else if (accumulator.completedPairs !== 0 || accumulator.errorCount !== 0)
          byId.set(stratumId, mergeSimulationStratifiedAccumulators(existing, accumulator));
      }
    return Object.fromEntries(byId);
  };
  return {
    natural: mapFor("natural"),
    isolation: mapFor("isolation"),
    forced: mapFor("forced"),
  };
};

const errorsForArtifacts = (
  artifacts: readonly SimulationMoveCoverageArtifact[],
): readonly SimulationMoveCoverageArtifact["errors"][number][] =>
  [
    ...new Map(
      artifacts
        .flatMap((artifact) => artifact.errors)
        .map(
          (error) =>
            [
              `${error.population ?? "unknown"}:${error.moveId}:${error.runId}:${error.type}:${error.detail}`,
              error,
            ] as const,
        ),
    ).values(),
  ].sort((left, right) =>
    `${left.moveId}:${left.runId}:${left.type}`.localeCompare(
      `${right.moveId}:${right.runId}:${right.type}`,
    ),
  );

export const mergeSimulationMoveCoverageArtifacts = (
  artifacts: readonly SimulationMoveCoverageArtifact[],
  mechanicsView: CombatMechanicsView = CANONICAL_COMBAT_MECHANICS_VIEW,
): SimulationMoveCoverageArtifact => {
  if (artifacts.length === 0) throw new RangeError("Catalog merge requires at least one artifact.");
  const first = artifacts[0]!;
  validateCatalogCompatibility(artifacts, first);
  const dataset = mergeArtifactRecords(artifacts, mechanicsView);
  const cellsById = mergeCoverageCellsFromArtifacts(artifacts);
  const populationRunCounts = populationRunCountsFor(artifacts);
  const errors = errorsForArtifacts(artifacts);
  const naturalArtifact = artifacts.find(
    (artifact) =>
      artifact.generatedFrom.population === "natural" &&
      artifact.generatedFrom.naturalPopulation === "approved",
  );
  return createSimulationMoveCoverageArtifact({
    generatedFrom: {
      mechanicsIdentity: dataset.mechanicsIdentity,
      scenarioFamily: first.generatedFrom.scenarioFamily,
      checkpointId: first.generatedFrom.checkpointId,
      targetPairs: first.generatedFrom.targetPairs,
      minimumEligibleStates: first.generatedFrom.minimumEligibleStates,
      isolationRunCount: Math.max(populationRunCounts.isolation, 1),
      populationRunCounts,
      populationAttemptedFightsByMove: populationAttemptedFightsByMoveFor(artifacts),
      populationAttemptedFightsByMoveAndContext:
        populationAttemptedFightsByMoveAndContextFor(artifacts),
      representativeReplaySeedsByMove: representativeReplaySeedsByMoveFor(artifacts),
      naturalPopulation: naturalArtifact === undefined ? "draft" : "approved",
      ...(naturalArtifact === undefined
        ? { naturalPopulationBlocker: SIMULATION_NATURAL_POPULATION_BLOCKER }
        : {}),
      mechanicPaths: ["decision", "trigger"],
      exposureContexts: [
        ...new Set<SimulationMoveCoverageExposureContext>(
          artifacts.flatMap(
            (artifact) => artifact.generatedFrom.exposureContexts ?? (["target-present"] as const),
          ),
        ),
      ],
      source: "simulation-move-coverage-catalog:v3",
      checkpoint: {
        schemaVersion: SIMULATION_MOVE_COVERAGE_CHECKPOINT_VERSION,
        batchSize: 25,
        completedBatchCount: Math.max(
          0,
          ...artifacts.map(
            (artifact) => artifact.generatedFrom.checkpoint?.completedBatchCount ?? 0,
          ),
        ),
        checkpointHash: canonicalHash({
          batchSize: 25,
          completedBatchCount: Math.max(
            0,
            ...artifacts.map(
              (artifact) => artifact.generatedFrom.checkpoint?.completedBatchCount ?? 0,
            ),
          ),
        }),
      },
      ...(naturalArtifact === undefined
        ? {}
        : {
            naturalProfileId:
              naturalArtifact.generatedFrom.naturalProfileId ?? SIMULATION_NATURAL_AI_PROFILES[0],
            naturalOverlayApprovalReference:
              naturalArtifact.generatedFrom.naturalOverlayApprovalReference,
            naturalOverlayAuthority: naturalArtifact.generatedFrom.naturalOverlayAuthority,
            sourceLimitations: naturalArtifact.generatedFrom.sourceLimitations,
          }),
    },
    dataset,
    coverageCells: [...cellsById.values()].sort((left, right) =>
      left.cellId.localeCompare(right.cellId),
    ),
    metricsByMove: metricsByMoveFor(artifacts),
    metricsByStratum: metricsByStratumFor(artifacts),
    stratifiedAccumulators: stratifiedAccumulatorsFor(artifacts),
    stratifiedAccumulatorsByStratum: stratifiedAccumulatorsByStratumFor(artifacts),
    errors,
  });
};

export type SimulationMoveCoverageCatalogRunOptions = Omit<
  SimulationMoveCoverageRunOptions,
  "population"
> & {
  readonly populations?: readonly SimulationCoveragePopulation[];
};

export interface SimulationMoveCoverageCatalogRunResult {
  readonly artifact: SimulationMoveCoverageArtifact;
  readonly populationResults: Readonly<
    Record<SimulationCoveragePopulation, SimulationMoveCoverageRunResult | undefined>
  >;
  readonly runCount: number;
  readonly failedRunCount: number;
  readonly failureTypes: Readonly<Partial<Record<SimulationFailure["type"], number>>>;
}

/** Executes and merges population runs without pooling their denominators. */
export const runSimulationMoveCoverageCatalog = (
  options: SimulationMoveCoverageCatalogRunOptions = {},
): SimulationMoveCoverageCatalogRunResult => {
  if (options.targetPairs !== undefined && options.targetFights !== undefined)
    throw new RangeError(
      "Coverage catalog accepts either targetPairs or deprecated targetFights, not both.",
    );
  const sourceArtifact = options.resumeFrom;
  const defaultPopulations =
    sourceArtifact?.generatedFrom.population === undefined &&
    sourceArtifact?.generatedFrom.populationRunCounts !== undefined
      ? SIMULATION_MOVE_COVERAGE_POPULATIONS.filter(
          (population) => sourceArtifact.generatedFrom.populationRunCounts?.[population] !== 0,
        )
      : SIMULATION_MOVE_COVERAGE_POPULATIONS;
  const requested = options.populations ?? defaultPopulations;
  const populations = SIMULATION_MOVE_COVERAGE_POPULATIONS.filter((population) =>
    requested.includes(population),
  );
  if (populations.length === 0) throw new RangeError("Catalog run requires a population.");
  if (new Set(requested).size !== requested.length)
    throw new RangeError("Catalog run populations must be unique.");
  if (populations.includes("natural"))
    approveAllSimulationTf1Overlays(
      options.naturalOverlayApprovalReference ?? SIMULATION_TF1_SOURCE_AUTHORITY,
    );
  const runOptions = { ...options };
  Reflect.deleteProperty(runOptions, "populations");
  Reflect.deleteProperty(runOptions, "resumeFrom");
  Reflect.deleteProperty(runOptions, "targetPairs");
  Reflect.deleteProperty(runOptions, "targetFights");
  const mechanicsView = options.mechanicsView ?? CANONICAL_COMBAT_MECHANICS_VIEW;
  const targetFights = options.targetPairs ?? options.targetFights ?? 250;
  const targetOption =
    options.targetPairs === undefined ? { targetFights } : { targetPairs: targetFights };
  const minimumEligibleStates = options.minimumEligibleStates ?? 250;
  const checkpointArtifacts = new Map<
    SimulationCoveragePopulation,
    SimulationMoveCoverageArtifact
  >();
  const emitCheckpoint = (
    population: SimulationCoveragePopulation,
    artifact: SimulationMoveCoverageArtifact,
  ): void => {
    if (options.onCheckpoint === undefined) return;
    checkpointArtifacts.set(population, artifact);
    const untouchedArtifacts =
      sourceArtifact === undefined
        ? []
        : SIMULATION_MOVE_COVERAGE_POPULATIONS.filter(
            (candidate) => !populations.includes(candidate),
          ).map((candidate) =>
            populationArtifactForResume(
              sourceArtifact,
              candidate,
              mechanicsView,
              targetFights,
              minimumEligibleStates,
            ),
          );
    options.onCheckpoint(
      mergeSimulationMoveCoverageArtifacts(
        [...checkpointArtifacts.values(), ...untouchedArtifacts],
        mechanicsView,
      ),
    );
  };
  const results = populations.map((population) =>
    runSimulationMoveCoverage({
      ...runOptions,
      population,
      ...targetOption,
      minimumEligibleStates,
      ...(options.onCheckpoint === undefined
        ? {}
        : {
            onCheckpoint: (artifact: SimulationMoveCoverageArtifact) =>
              emitCheckpoint(population, artifact),
          }),
      ...(population === "isolation" ? {} : { exposureContexts: ["target-present"] as const }),
      ...(sourceArtifact === undefined || !sourceContainsPopulation(sourceArtifact, population)
        ? {}
        : {
            resumeFrom: populationArtifactForResume(
              sourceArtifact,
              population,
              mechanicsView,
              targetFights,
              minimumEligibleStates,
              sourceArtifact.generatedFrom.targetPairs,
              sourceArtifact.generatedFrom.minimumEligibleStates,
            ),
          }),
    }),
  );
  const untouchedArtifacts =
    sourceArtifact === undefined
      ? []
      : SIMULATION_MOVE_COVERAGE_POPULATIONS.filter(
          (population) => !populations.includes(population),
        ).map((population) =>
          populationArtifactForResume(
            sourceArtifact,
            population,
            mechanicsView,
            targetFights,
            minimumEligibleStates,
          ),
        );
  const artifacts = [...results.map((result) => result.artifact), ...untouchedArtifacts];
  const artifact = mergeSimulationMoveCoverageArtifacts(artifacts, mechanicsView);
  const failureTypes: Partial<Record<SimulationFailure["type"], number>> = {};
  for (const result of results)
    for (const [type, count] of Object.entries(result.failureTypes))
      failureTypes[type as SimulationFailure["type"]] =
        (failureTypes[type as SimulationFailure["type"]] ?? 0) + count;
  return {
    artifact,
    populationResults: {
      natural: results.find((result) => result.artifact.generatedFrom.population === "natural"),
      isolation: results.find((result) => result.artifact.generatedFrom.population === "isolation"),
      forced: results.find((result) => result.artifact.generatedFrom.population === "forced"),
    },
    runCount: results.reduce((total, result) => total + result.runCount, 0),
    failedRunCount: results.reduce((total, result) => total + result.failedRunCount, 0),
    failureTypes,
  };
};
