/* eslint-disable complexity, sonarjs/cognitive-complexity, sonarjs/no-nested-conditional, @typescript-eslint/no-unnecessary-condition, sonarjs/different-types-comparison -- The v4 fold is the single versioned metric vocabulary boundary and intentionally guards bounded record lookups. */
import type {
  CombatActionAvailabilityReport,
  CombatTransition,
  FightState,
  LegalDecision,
} from "@dragonball-resurgence/combat-engine";
import { canonicalDecisionKey } from "@dragonball-resurgence/combat-engine";
import type { CandidateEvaluation } from "@dragonball-resurgence/ai-engine";

import {
  SIMULATION_V4_METRIC_DEFINITIONS,
  addSimulationMetricObservationV2,
  createSimulationMetricAggregateV2,
  setSimulationMetricEvidenceV2,
  simulationStatisticsDimensionKey,
  type SimulationMetricAggregateV2,
  type SimulationStatisticsDimensions,
} from "./statistics-v4.js";
import type {
  SimulationFightExecutionResult,
  SimulationFightRequest,
  SimulationTemplate,
} from "./contracts.js";
import { canonicalHash } from "./canonical.js";

export const SIMULATION_V4_WILDCARD = "*" as const;

type SimulationV4Side = "a" | "b";

export const simulationV4WildcardDimensions = (
  input: Partial<SimulationStatisticsDimensions> = {},
): SimulationStatisticsDimensions => ({
  templateId: input.templateId ?? SIMULATION_V4_WILDCARD,
  buildId: input.buildId ?? SIMULATION_V4_WILDCARD,
  styleMatchup: input.styleMatchup ?? SIMULATION_V4_WILDCARD,
  checkpointId: input.checkpointId ?? SIMULATION_V4_WILDCARD,
  level: input.level ?? SIMULATION_V4_WILDCARD,
  statAllocation: input.statAllocation ?? SIMULATION_V4_WILDCARD,
  hpDifferential: input.hpDifferential ?? 0,
  powerDifferential: input.powerDifferential ?? 0,
  dexterityDifferential: input.dexterityDifferential ?? 0,
  aiProfile: input.aiProfile ?? SIMULATION_V4_WILDCARD,
  side: input.side ?? "a",
  initiativeWinner: input.initiativeWinner ?? "tie",
  firstActor: input.firstActor ?? "a",
  ...(input.moveId === undefined ? {} : { moveId: input.moveId }),
  ...(input.itemId === undefined ? {} : { itemId: input.itemId }),
  ...(input.transformationId === undefined ? {} : { transformationId: input.transformationId }),
  evidenceRole: input.evidenceRole ?? "natural-balance",
  exposurePopulation: input.exposurePopulation ?? "natural",
});

export interface SimulationV4FightAccumulator {
  readonly pairId: string;
  readonly orientation: "original" | "mirrored";
  readonly fighterAId: string;
  readonly fighterBId: string;
  readonly dimensions: SimulationStatisticsDimensions;
  readonly dimensionsBySide: Readonly<{
    readonly a: SimulationStatisticsDimensions;
    readonly b: SimulationStatisticsDimensions;
  }>;
  readonly metrics: Readonly<Record<string, SimulationMetricAggregateV2>>;
  readonly maximumTrailingGap: Readonly<{ readonly a: number; readonly b: number }>;
  readonly actionCount: number;
  readonly moveUseCounts: Readonly<Record<string, number>>;
  readonly firstUseTurns: Readonly<Record<string, number>>;
  readonly actionHistory: readonly string[];
  readonly transformationActivationTurns: Readonly<Record<string, number>>;
  readonly equippedMoveIdsBySide: Readonly<{
    readonly a: readonly string[];
    readonly b: readonly string[];
  }>;
  readonly equippedItemIdsBySide: Readonly<{
    readonly a: readonly string[];
    readonly b: readonly string[];
  }>;
  readonly availableTransformationIdsBySide: Readonly<{
    readonly a: readonly string[];
    readonly b: readonly string[];
  }>;
  readonly startingKiBySide: Readonly<{ readonly a: number; readonly b: number }>;
  readonly blockMoveIdsBySide: Readonly<{
    readonly a: readonly string[];
    readonly b: readonly string[];
  }>;
  readonly itemPricesBySide: Readonly<{
    readonly a: Readonly<Record<string, number | undefined>>;
    readonly b: Readonly<Record<string, number | undefined>>;
  }>;
}

const unitFor = (metricId: string): SimulationMetricAggregateV2["unit"] => {
  if (metricId.includes("rate") || metricId.includes("probability")) return "proportion";
  if (metricId.includes("turn")) return "turns";
  if (metricId.includes("ki")) return "ki";
  if (metricId.includes("damage") || metricId.includes("hp") || metricId.includes("overkill"))
    return "hit-points";
  if (metricId.includes("score") || metricId.includes("effect")) return "score";
  return "count";
};

const initialMetricsFor = (
  dimensions: SimulationStatisticsDimensions,
): Record<string, SimulationMetricAggregateV2> =>
  Object.fromEntries(
    SIMULATION_V4_METRIC_DEFINITIONS.map((definition) => [
      `${definition.metricId}:${simulationStatisticsDimensionKey(dimensions)}`,
      createSimulationMetricAggregateV2({
        metricId: definition.metricId,
        dimensions,
        unit: unitFor(definition.metricId),
        intervalMethod: definition.intervalMethod,
      }),
    ]),
  );

export const createSimulationV4FightAccumulator = (input: {
  readonly pairId: string;
  readonly orientation: "original" | "mirrored";
  readonly fighterAId: string;
  readonly fighterBId: string;
  readonly dimensions?: Partial<SimulationStatisticsDimensions>;
  readonly dimensionsBySide?: Readonly<{
    readonly a: Partial<SimulationStatisticsDimensions>;
    readonly b: Partial<SimulationStatisticsDimensions>;
  }>;
  readonly equippedMoveIdsBySide?: Readonly<{
    readonly a: readonly string[];
    readonly b: readonly string[];
  }>;
  readonly equippedItemIdsBySide?: Readonly<{
    readonly a: readonly string[];
    readonly b: readonly string[];
  }>;
  readonly availableTransformationIdsBySide?: Readonly<{
    readonly a: readonly string[];
    readonly b: readonly string[];
  }>;
  readonly startingKiBySide?: Readonly<{ readonly a: number; readonly b: number }>;
  readonly blockMoveIdsBySide?: Readonly<{
    readonly a: readonly string[];
    readonly b: readonly string[];
  }>;
  readonly itemPricesBySide?: Readonly<{
    readonly a: Readonly<Record<string, number | undefined>>;
    readonly b: Readonly<Record<string, number | undefined>>;
  }>;
}): SimulationV4FightAccumulator => {
  const dimensionsBySide = {
    a: simulationV4WildcardDimensions({
      ...input.dimensions,
      ...input.dimensionsBySide?.a,
      side: "a",
    }),
    b: simulationV4WildcardDimensions({
      ...input.dimensions,
      ...input.dimensionsBySide?.b,
      side: "b",
    }),
  };
  const dimensions = dimensionsBySide.a;
  return {
    pairId: input.pairId,
    orientation: input.orientation,
    fighterAId: input.fighterAId,
    fighterBId: input.fighterBId,
    dimensions,
    dimensionsBySide,
    metrics: initialMetricsFor(dimensions),
    maximumTrailingGap: { a: 0, b: 0 },
    actionCount: 0,
    moveUseCounts: {},
    firstUseTurns: {},
    actionHistory: [],
    transformationActivationTurns: {},
    equippedMoveIdsBySide: input.equippedMoveIdsBySide ?? { a: [], b: [] },
    equippedItemIdsBySide: input.equippedItemIdsBySide ?? { a: [], b: [] },
    availableTransformationIdsBySide: input.availableTransformationIdsBySide ?? { a: [], b: [] },
    startingKiBySide: input.startingKiBySide ?? { a: 0, b: 0 },
    blockMoveIdsBySide: input.blockMoveIdsBySide ?? { a: [], b: [] },
    itemPricesBySide: input.itemPricesBySide ?? { a: {}, b: {} },
  };
};

export const classifySimulationStatAllocation = (template: SimulationTemplate): string => {
  const ordered = [
    ["hp", template.specializationPointsDistribution.hp],
    ["power", template.specializationPointsDistribution.power],
    ["dexterity", template.specializationPointsDistribution.dexterity],
  ].sort(
    (left, right) =>
      Number(right[1]) - Number(left[1]) || String(left[0]).localeCompare(String(right[0])),
  );
  if (Number(ordered[0]?.[1] ?? 0) - Number(ordered[2]?.[1] ?? 0) <= 1) return "balanced";
  if (Number(ordered[0]?.[1] ?? 0) - Number(ordered[1]?.[1] ?? 0) >= 2)
    return `${String(ordered[0]?.[0])}-heavy`;
  return `${String(ordered[0]?.[0])}-${String(ordered[1]?.[0])}`;
};

export const simulationV4DimensionsForRequest = (
  request: SimulationFightRequest,
  firstActor: "a" | "b",
): NonNullable<Parameters<typeof createSimulationV4FightAccumulator>[0]["dimensionsBySide"]> => {
  const a = request.templateA;
  const b = request.templateB;
  const shared = {
    checkpointId:
      a.checkpointId === b.checkpointId ? a.checkpointId : `${a.checkpointId}-vs-${b.checkpointId}`,
    initiativeWinner: firstActor,
    firstActor,
    evidenceRole: request.statistics?.evidenceRole ?? ("natural-balance" as const),
    exposurePopulation: request.statistics?.exposurePopulation ?? ("natural" as const),
  };
  return {
    a: {
      ...shared,
      templateId: a.id,
      buildId: a.id,
      styleMatchup: `${a.styleId}-vs-${b.styleId}`,
      level: String(a.specialization?.level ?? a.checkpointId),
      statAllocation: classifySimulationStatAllocation(a),
      hpDifferential: a.specializationPointsDistribution.hp - b.specializationPointsDistribution.hp,
      powerDifferential:
        a.specializationPointsDistribution.power - b.specializationPointsDistribution.power,
      dexterityDifferential: a.stats.dexterity - b.stats.dexterity,
      aiProfile: request.profileA.identity.id,
    },
    b: {
      ...shared,
      templateId: b.id,
      buildId: b.id,
      styleMatchup: `${b.styleId}-vs-${a.styleId}`,
      level: String(b.specialization?.level ?? b.checkpointId),
      statAllocation: classifySimulationStatAllocation(b),
      hpDifferential: b.specializationPointsDistribution.hp - a.specializationPointsDistribution.hp,
      powerDifferential:
        b.specializationPointsDistribution.power - a.specializationPointsDistribution.power,
      dexterityDifferential: b.stats.dexterity - a.stats.dexterity,
      aiProfile: request.profileB.identity.id,
    },
  };
};

const metricKeyFor = (metricId: string, dimensions: SimulationStatisticsDimensions): string =>
  `${metricId}:${simulationStatisticsDimensionKey(dimensions)}`;

const add = (
  metrics: Readonly<Record<string, SimulationMetricAggregateV2>>,
  metricId: string,
  dimensions: SimulationStatisticsDimensions,
  observation: Parameters<typeof addSimulationMetricObservationV2>[1],
): Readonly<Record<string, SimulationMetricAggregateV2>> => {
  const key = metricKeyFor(metricId, dimensions);
  const metric = metrics[key];
  if (metric === undefined) return metrics;
  return { ...metrics, [key]: addSimulationMetricObservationV2(metric, observation) };
};

const ensureMetric = (
  metrics: Readonly<Record<string, SimulationMetricAggregateV2>>,
  metricId: string,
  dimensions: SimulationStatisticsDimensions,
): Readonly<Record<string, SimulationMetricAggregateV2>> => {
  const key = metricKeyFor(metricId, dimensions);
  if (metrics[key] !== undefined) return metrics;
  const definition = SIMULATION_V4_METRIC_DEFINITIONS.find(
    (candidate) => candidate.metricId === metricId,
  );
  return definition === undefined
    ? metrics
    : {
        ...metrics,
        [key]: createSimulationMetricAggregateV2({
          metricId,
          dimensions,
          unit: unitFor(metricId),
          intervalMethod: definition.intervalMethod,
        }),
      };
};

const sideFor = (
  id: string | undefined,
  fighterAId: string,
  fighterBId: string,
): SimulationV4Side | undefined => {
  if (id === fighterAId) return "a";
  if (id === fighterBId) return "b";
  return undefined;
};

const dimensionsForSide = (
  accumulator: SimulationV4FightAccumulator,
  side: SimulationV4Side | undefined,
): SimulationStatisticsDimensions => accumulator.dimensionsBySide[side ?? "a"];

const sourceDimensionsFor = (
  accumulator: SimulationV4FightAccumulator,
  side: SimulationV4Side | undefined,
  sourceDefinitionId: string,
): SimulationStatisticsDimensions => {
  const base = dimensionsForSide(accumulator, side);
  const resolvedSide = side ?? "a";
  const isItem = accumulator.equippedItemIdsBySide[resolvedSide].includes(sourceDefinitionId);
  const isTransformation =
    accumulator.availableTransformationIdsBySide[resolvedSide].includes(sourceDefinitionId);
  return simulationV4WildcardDimensions({
    ...base,
    ...(isItem || sourceDefinitionId.startsWith("item:") || sourceDefinitionId.startsWith("item-")
      ? { itemId: sourceDefinitionId }
      : isTransformation ||
          sourceDefinitionId.startsWith("transformation:") ||
          sourceDefinitionId.startsWith("transformation-")
        ? { transformationId: sourceDefinitionId }
        : { moveId: sourceDefinitionId }),
  });
};

const addEnsured = (
  metrics: Readonly<Record<string, SimulationMetricAggregateV2>>,
  metricId: string,
  dimensions: SimulationStatisticsDimensions,
  observation: Parameters<typeof addSimulationMetricObservationV2>[1],
): Readonly<Record<string, SimulationMetricAggregateV2>> =>
  add(ensureMetric(metrics, metricId, dimensions), metricId, dimensions, observation);

const definitionIdForDecision = (decision: LegalDecision): string | undefined => {
  switch (decision.type) {
    case "use-move":
      return decision.moveId;
    case "use-item":
      return decision.itemId;
    case "activate-transformation":
      return decision.transformationId;
    case "basic-attack":
      return `basic-attack:${decision.basicAttack}`;
    case "pass":
    case "power-up":
    case "surrender":
    case "respond-to-pending-decision":
    case "deactivate-transformation":
      return undefined;
  }
};

const evaluationIsGuaranteedLethal = (evaluation: CandidateEvaluation): boolean =>
  evaluation.outcomes?.some(
    (outcome) => outcome.category === "lethal" && outcome.probability >= 1,
  ) === true;

const stateHealthGapFor = (
  state: FightState,
  winnerSide: "a" | "b" | undefined,
  fighterAId: string,
  fighterBId: string,
): number => {
  if (state.status !== "active" && state.status !== "completed") return 0;
  const a = Object.values(state.combatants).find((combatant) => combatant.id === fighterAId);
  const b = Object.values(state.combatants).find((combatant) => combatant.id === fighterBId);
  if (a === undefined || b === undefined || winnerSide === undefined) return 0;
  const winner = winnerSide === "a" ? a : b;
  const opponent = winnerSide === "a" ? b : a;
  const winnerRatio =
    winner.hitPoints.maximum === 0 ? 0 : winner.hitPoints.current / winner.hitPoints.maximum;
  const opponentRatio =
    opponent.hitPoints.maximum === 0 ? 0 : opponent.hitPoints.current / opponent.hitPoints.maximum;
  return Math.max(0, opponentRatio - winnerRatio);
};

/** Folds one retained combat transition; it never mutates FightState. */
export const foldSimulationV4Transition = (
  accumulator: SimulationV4FightAccumulator,
  input: {
    readonly previousState?: FightState;
    readonly transition: CombatTransition;
    readonly eventualWinner?: "a" | "b";
    readonly selectedDecision?: LegalDecision;
    readonly availability?: CombatActionAvailabilityReport;
    readonly evaluations?: readonly CandidateEvaluation[];
  },
): SimulationV4FightAccumulator => {
  const observations = input.transition.calculationObservations ?? [];
  let metrics = accumulator.metrics;
  let actionCount = accumulator.actionCount;
  const moveUseCounts = { ...accumulator.moveUseCounts };
  const firstUseTurns = { ...accumulator.firstUseTurns };
  const actionHistory = [...accumulator.actionHistory];
  const transformationActivationTurns = { ...accumulator.transformationActivationTurns };
  const trailing = { ...accumulator.maximumTrailingGap };
  const gap = stateHealthGapFor(
    input.transition.state,
    input.eventualWinner,
    accumulator.fighterAId,
    accumulator.fighterBId,
  );
  if (input.eventualWinner !== undefined)
    trailing[input.eventualWinner] = Math.max(trailing[input.eventualWinner], gap);
  const selectedSide = sideFor(
    input.selectedDecision?.actorId,
    accumulator.fighterAId,
    accumulator.fighterBId,
  );
  const selectedDimensions = dimensionsForSide(accumulator, selectedSide);
  const diagnosticEvidence = selectedDimensions.evidenceRole === "diagnostic";
  if (input.availability !== undefined) {
    for (const entry of input.availability.entries) {
      if (entry.decision.type === "use-move") {
        const dimensions = sourceDimensionsFor(accumulator, selectedSide, entry.decision.moveId);
        metrics = addEnsured(metrics, "simulation:move-opportunity-funnel", dimensions, {
          value: entry.classification === "legal" ? 1 : entry.timingEligible ? 0 : -1,
          eligible: entry.timingEligible,
          completed: true,
        });
        metrics = addEnsured(metrics, "simulation:move-selection-rate", dimensions, {
          eligible: entry.classification === "legal",
          completed: true,
          success:
            input.selectedDecision?.type === "use-move" &&
            input.selectedDecision.moveId === entry.decision.moveId,
        });
        metrics = addEnsured(metrics, "simulation:style-eligible-nonuse", selectedDimensions, {
          eligible: entry.timingEligible,
          completed: true,
          success:
            entry.timingEligible &&
            !(
              input.selectedDecision?.type === "use-move" &&
              input.selectedDecision.moveId === entry.decision.moveId
            ),
        });
      }
      if (entry.decision.type === "activate-transformation") {
        const dimensions = sourceDimensionsFor(
          accumulator,
          selectedSide,
          entry.decision.transformationId,
        );
        metrics = addEnsured(metrics, "simulation:transformation-activation-rate", dimensions, {
          eligible: entry.classification === "legal",
          completed: true,
          success:
            input.selectedDecision?.type === "activate-transformation" &&
            input.selectedDecision.transformationId === entry.decision.transformationId,
        });
      }
    }
    const starved = input.availability.timingEligibleButUnaffordable.some(
      (entry) => entry.decision.type === "use-move" || entry.decision.type === "use-item",
    );
    metrics = addEnsured(metrics, "simulation:ki-starvation-rate", selectedDimensions, {
      eligible: true,
      completed: true,
      success: starved,
    });
    const fallback =
      input.selectedDecision?.type === "pass" || input.selectedDecision?.type === "power-up";
    metrics = addEnsured(metrics, "simulation:desired-action-denial", selectedDimensions, {
      eligible: starved,
      completed: true,
      success: starved && fallback,
    });
  }
  if (input.selectedDecision !== undefined) {
    const selectedKey =
      definitionIdForDecision(input.selectedDecision) ?? input.selectedDecision.type;
    const repeated = actionHistory.at(-1) === selectedKey;
    actionHistory.push(selectedKey);
    metrics = addEnsured(metrics, "simulation:action-mix", selectedDimensions, {
      value: 1,
      eligible: true,
      completed: true,
    });
    metrics = addEnsured(metrics, "simulation:utility-action-economy", selectedDimensions, {
      value: 1,
      eligible: true,
      completed: true,
    });
    if (input.selectedDecision.type === "use-move" && actionHistory.length > 1) {
      metrics = addEnsured(metrics, "simulation:setup-conversion", selectedDimensions, {
        eligible: true,
        completed: true,
        success: actionHistory.at(-2) !== selectedKey,
      });
    }
    if (diagnosticEvidence) {
      metrics = addEnsured(metrics, "simulation:ai-action-distribution", selectedDimensions, {
        value: 1,
        eligible: true,
        completed: true,
      });
      metrics = addEnsured(metrics, "simulation:ai-pass-rate", selectedDimensions, {
        eligible: true,
        completed: true,
        success: input.selectedDecision.type === "pass",
      });
      metrics = addEnsured(metrics, "simulation:ai-power-up-rate", selectedDimensions, {
        eligible: true,
        completed: true,
        success: input.selectedDecision.type === "power-up",
      });
      metrics = addEnsured(metrics, "simulation:ai-item-usage-rate", selectedDimensions, {
        eligible: true,
        completed: true,
        success: input.selectedDecision.type === "use-item",
      });
      metrics = addEnsured(metrics, "simulation:ai-transformation-usage-rate", selectedDimensions, {
        eligible: true,
        completed: true,
        success: input.selectedDecision.type === "activate-transformation",
      });
      metrics = addEnsured(metrics, "simulation:ai-repeated-action-rate", selectedDimensions, {
        eligible: actionHistory.length > 1,
        completed: true,
        success: repeated,
      });
      metrics = addEnsured(metrics, "simulation:ai-block-usage-rate", selectedDimensions, {
        eligible: input.availability?.legal.some(
          (entry) =>
            entry.decision.type === "use-move" &&
            accumulator.blockMoveIdsBySide[selectedSide ?? "a"].includes(entry.decision.moveId),
        ),
        completed: true,
        success:
          input.selectedDecision.type === "use-move" &&
          accumulator.blockMoveIdsBySide[selectedSide ?? "a"].includes(
            input.selectedDecision.moveId,
          ),
      });
    }
    metrics = addEnsured(metrics, "simulation:repeated-sequence-count", selectedDimensions, {
      value: repeated ? 1 : 0,
      eligible: actionHistory.length > 1,
      completed: true,
    });
    metrics = addEnsured(metrics, "simulation:follow-up-rate", selectedDimensions, {
      eligible: actionHistory.length > 1,
      completed: true,
      success: actionHistory.length > 1,
    });
    if (input.selectedDecision.type === "power-up")
      metrics = addEnsured(metrics, "simulation:ki-power-up-turns", selectedDimensions, {
        value: 1,
        eligible: true,
        completed: true,
      });
    if (input.selectedDecision.type === "use-move") {
      const sideMoveKey = `${selectedSide ?? "a"}:${input.selectedDecision.moveId}`;
      moveUseCounts[sideMoveKey] = (moveUseCounts[sideMoveKey] ?? 0) + 1;
      firstUseTurns[sideMoveKey] ??= input.previousState?.turnNumber ?? 0;
      const selectedEntry = input.availability?.entries.find(
        (entry) =>
          canonicalDecisionKey(entry.decision) === canonicalDecisionKey(input.selectedDecision!),
      );
      const kiCost =
        selectedEntry?.costs
          .filter((cost) => cost.resource === "ki")
          .reduce((sum, cost) => sum + cost.effective, 0) ?? 0;
      const actor =
        input.previousState?.combatants[
          input.selectedDecision.actorId as keyof typeof input.previousState.combatants
        ];
      if (kiCost > 0 && actor !== undefined) {
        const highCost = kiCost >= actor.ki.maximum / 2;
        metrics = addEnsured(metrics, "simulation:ki-high-cost-use", selectedDimensions, {
          value: highCost ? 1 : 0,
          eligible: true,
          completed: true,
        });
        metrics = addEnsured(metrics, "simulation:ki-low-cost-use", selectedDimensions, {
          value: highCost ? 0 : 1,
          eligible: true,
          completed: true,
        });
      }
    }
    if (input.selectedDecision.type === "use-item") {
      const dimensions = sourceDimensionsFor(
        accumulator,
        selectedSide,
        input.selectedDecision.itemId,
      );
      metrics = addEnsured(metrics, "simulation:item-usage-rate", dimensions, {
        eligible: true,
        completed: true,
        success: true,
      });
    }
    if (input.selectedDecision.type === "activate-transformation")
      transformationActivationTurns[
        `${selectedSide ?? "a"}:${input.selectedDecision.transformationId}`
      ] ??= input.previousState?.turnNumber ?? 0;
  }
  if (diagnosticEvidence && input.evaluations !== undefined && input.evaluations.length > 0) {
    const selectedKey =
      input.selectedDecision === undefined
        ? undefined
        : canonicalDecisionKey(input.selectedDecision);
    const selected =
      input.evaluations.find((evaluation) => evaluation.canonicalKey === selectedKey) ??
      input.evaluations.find((evaluation) => evaluation.rank === 1);
    const best = input.evaluations.reduce(
      (maximum, evaluation) => Math.max(maximum, evaluation.totalScore),
      -Infinity,
    );
    metrics = addEnsured(metrics, "simulation:ai-legal-action-count", selectedDimensions, {
      value: input.evaluations.length,
      eligible: true,
      completed: true,
    });
    if (selected !== undefined) {
      metrics = addEnsured(metrics, "simulation:ai-selected-rank", selectedDimensions, {
        value: selected.rank,
        eligible: true,
        completed: true,
      });
      metrics = addEnsured(metrics, "simulation:ai-score-gap", selectedDimensions, {
        value: best - selected.totalScore,
        eligible: true,
        completed: true,
      });
      const lethalAvailable = input.evaluations.some(evaluationIsGuaranteedLethal);
      metrics = addEnsured(metrics, "simulation:ai-missed-lethal", selectedDimensions, {
        eligible: lethalAvailable,
        completed: true,
        success: lethalAvailable && !evaluationIsGuaranteedLethal(selected),
      });
    }
  }
  for (const observation of observations) {
    const source = observation.sourceDefinitionId;
    const actorSide = sideFor(observation.actorId, accumulator.fighterAId, accumulator.fighterBId);
    const targetSide = sideFor(
      observation.targetCombatantId,
      accumulator.fighterAId,
      accumulator.fighterBId,
    );
    const actorDimensions = dimensionsForSide(accumulator, actorSide);
    const targetDimensions = dimensionsForSide(accumulator, targetSide);
    const sourceDimensions =
      source === undefined ? undefined : sourceDimensionsFor(accumulator, actorSide, source);
    if (observation.kind === "action") {
      actionCount += 1;
      metrics = addEnsured(metrics, "simulation:hit-rate", actorDimensions, {
        eligible: true,
        completed: true,
        success: observation.successful,
      });
      if (sourceDimensions !== undefined) {
        metrics = addEnsured(metrics, "simulation:move-execution-rate", sourceDimensions, {
          eligible: true,
          completed: true,
          success: observation.resolved,
        });
      }
      if (actorDimensions.evidenceRole === "controlled")
        metrics = addEnsured(metrics, "simulation:dexterity-attack-success", actorDimensions, {
          eligible: true,
          completed: true,
          success: observation.successful,
        });
    }
    if (observation.kind === "damage" && observation.stage === "applied") {
      metrics = addEnsured(metrics, "simulation:damage-dealt", actorDimensions, {
        value: observation.applied,
        eligible: true,
        completed: true,
      });
      metrics = addEnsured(metrics, "simulation:damage-received", targetDimensions, {
        value: observation.applied,
        eligible: true,
        completed: true,
      });
      metrics = addEnsured(metrics, "simulation:utility-damage", actorDimensions, {
        value: observation.applied,
        eligible: true,
        completed: true,
      });
      if (sourceDimensions !== undefined) {
        metrics = addEnsured(
          metrics,
          "simulation:source-attributed-damage-efficiency",
          sourceDimensions,
          {
            value: observation.applied,
            eligible: true,
            completed: true,
          },
        );
        metrics = addEnsured(metrics, "simulation:move-damage-per-use", sourceDimensions, {
          value: observation.applied,
          eligible: true,
          completed: true,
        });
        metrics = addEnsured(metrics, "simulation:overkill", sourceDimensions, {
          value: observation.overkill,
          eligible: observation.applied > 0,
          completed: true,
        });
        metrics = addEnsured(metrics, "simulation:finisher-rate", sourceDimensions, {
          eligible: true,
          completed: true,
          success: observation.overkill > 0,
        });
        if (sourceDimensions.itemId !== undefined)
          metrics = addEnsured(metrics, "simulation:item-damage", sourceDimensions, {
            value: observation.applied,
            eligible: true,
            completed: true,
          });
        if (sourceDimensions.itemId !== undefined) {
          metrics = addEnsured(metrics, "simulation:item-attributed-value", sourceDimensions, {
            value: observation.applied,
            eligible: true,
            completed: true,
          });
          const price = accumulator.itemPricesBySide[actorSide ?? "a"][sourceDimensions.itemId];
          if (price !== undefined && price > 0)
            metrics = addEnsured(metrics, "simulation:item-value-per-zenni", sourceDimensions, {
              value: observation.applied / price,
              eligible: true,
              completed: true,
            });
        }
        if (sourceDimensions.transformationId !== undefined)
          metrics = addEnsured(metrics, "simulation:transformation-damage", sourceDimensions, {
            value: observation.applied,
            eligible: true,
            completed: true,
          });
      }
      if (actorDimensions.evidenceRole === "controlled")
        metrics = addEnsured(metrics, "simulation:dexterity-added-damage", actorDimensions, {
          value: Math.max(0, observation.applied - observation.preMitigation),
          eligible: true,
          completed: true,
        });
    }
    if (observation.kind === "resource") {
      // HP damage is already represented by the authoritative damage
      // observation. Folding the matching hp-changed event here would count
      // the same damage a second time.
      if (observation.resource === "hp" && observation.operation === "damage") continue;
      const metricId =
        observation.resource === "ki"
          ? observation.operation === "gain"
            ? "simulation:ki-gained"
            : "simulation:ki-spent"
          : observation.operation === "healing"
            ? "simulation:item-healing"
            : "simulation:damage-received";
      metrics = addEnsured(metrics, metricId, actorDimensions, {
        value: observation.applied,
        eligible: true,
        completed: true,
      });
      if (diagnosticEvidence && observation.resource === "ki" && observation.capDiscarded > 0)
        metrics = addEnsured(metrics, "simulation:ki-cap-waste", actorDimensions, {
          value: observation.capDiscarded,
          eligible: true,
          completed: true,
        });
      if (observation.resource === "ki" && observation.capDiscarded > 0)
        metrics = addEnsured(metrics, "simulation:ai-resource-waste", actorDimensions, {
          value: observation.capDiscarded,
          eligible: true,
          completed: true,
        });
      if (sourceDimensions?.moveId !== undefined && observation.operation === "loss")
        metrics = addEnsured(metrics, "simulation:move-average-ki-cost", sourceDimensions, {
          value: observation.applied,
          eligible: true,
          completed: true,
        });
      if (sourceDimensions?.moveId !== undefined && observation.resource === "ki")
        metrics = addEnsured(
          metrics,
          "simulation:source-attributed-ki-efficiency",
          sourceDimensions,
          {
            value: observation.operation === "gain" ? observation.applied : -observation.applied,
            eligible: true,
            completed: true,
          },
        );
      if (sourceDimensions?.itemId !== undefined && observation.resource === "ki")
        metrics = addEnsured(metrics, "simulation:item-ki", sourceDimensions, {
          value: observation.operation === "loss" ? -observation.applied : observation.applied,
          eligible: true,
          completed: true,
        });
      if (sourceDimensions?.itemId !== undefined && observation.operation === "healing") {
        metrics = addEnsured(metrics, "simulation:item-healing", sourceDimensions, {
          value: observation.applied,
          eligible: true,
          completed: true,
        });
        metrics = addEnsured(metrics, "simulation:item-effective-hp", sourceDimensions, {
          value: observation.applied,
          eligible: true,
          completed: true,
        });
        metrics = addEnsured(metrics, "simulation:item-attributed-value", sourceDimensions, {
          value: observation.applied,
          eligible: true,
          completed: true,
        });
        const price = accumulator.itemPricesBySide[actorSide ?? "a"][sourceDimensions.itemId];
        if (price !== undefined && price > 0)
          metrics = addEnsured(metrics, "simulation:item-value-per-zenni", sourceDimensions, {
            value: observation.applied / price,
            eligible: true,
            completed: true,
          });
      }
      if (sourceDimensions?.transformationId !== undefined && observation.operation === "healing")
        metrics = addEnsured(metrics, "simulation:transformation-effective-hp", sourceDimensions, {
          value: observation.applied,
          eligible: true,
          completed: true,
        });
      metrics = addEnsured(metrics, "simulation:utility-resource", actorDimensions, {
        value:
          observation.operation === "gain" || observation.operation === "healing"
            ? observation.applied
            : -observation.applied,
        eligible: true,
        completed: true,
      });
    }
    if (observation.kind === "die") {
      metrics = addEnsured(metrics, "simulation:critical-rate", actorDimensions, {
        eligible: true,
        completed: true,
        success: observation.naturalResult === observation.sides,
      });
      if (observation.scope === "defense")
        metrics = addEnsured(metrics, "simulation:defense-success-rate", actorDimensions, {
          eligible: true,
          completed: true,
          success: observation.outcome === "stopped",
        });
      if (observation.scope === "defense" && actorDimensions.evidenceRole === "controlled")
        metrics = addEnsured(metrics, "simulation:dexterity-defense-success", actorDimensions, {
          eligible: true,
          completed: true,
          success: observation.outcome === "stopped",
        });
      if (observation.scope === "attack" && actorDimensions.evidenceRole === "controlled")
        metrics = addEnsured(metrics, "simulation:dexterity-critical-rate", actorDimensions, {
          eligible: true,
          completed: true,
          success: observation.naturalResult === observation.sides,
        });
    }
    if (observation.kind === "block") {
      metrics = addEnsured(metrics, "simulation:block-declaration-rate", actorDimensions, {
        eligible: true,
        completed: true,
        success: observation.declared,
      });
      metrics = addEnsured(metrics, "simulation:block-rate", actorDimensions, {
        eligible: observation.declared,
        completed: true,
        success: observation.success,
      });
      metrics = addEnsured(metrics, "simulation:block-prevention-efficiency", actorDimensions, {
        value: observation.prevention,
        eligible: observation.declared,
        completed: true,
      });
      metrics = addEnsured(metrics, "simulation:utility-prevention", actorDimensions, {
        value: observation.prevention,
        eligible: observation.eligibleToStop,
        completed: true,
      });
      if (sourceDimensions?.itemId !== undefined) {
        metrics = addEnsured(metrics, "simulation:item-prevention", sourceDimensions, {
          value: observation.prevention,
          eligible: observation.eligibleToStop,
          completed: true,
        });
        metrics = addEnsured(metrics, "simulation:item-effective-hp", sourceDimensions, {
          value: observation.prevention,
          eligible: observation.eligibleToStop,
          completed: true,
        });
      }
      metrics = addEnsured(metrics, "simulation:block-ki-efficiency", actorDimensions, {
        value:
          observation.prevention === 0
            ? observation.kiCost
            : observation.kiCost / observation.prevention,
        eligible: observation.declared,
        completed: true,
      });
      metrics = addEnsured(metrics, "simulation:wasted-block-rate", actorDimensions, {
        eligible: observation.declared,
        completed: true,
        success:
          observation.declared && (!observation.eligibleToStop || observation.prevention === 0),
      });
      metrics = addEnsured(metrics, "simulation:counter-rate", actorDimensions, {
        eligible: observation.eligibleToStop,
        completed: true,
        success: observation.counterQualified,
      });
      if (actorDimensions.evidenceRole === "controlled") {
        metrics = addEnsured(metrics, "simulation:dexterity-prevented-damage", actorDimensions, {
          value: observation.prevention,
          eligible: observation.eligibleToStop,
          completed: true,
        });
        metrics = addEnsured(metrics, "simulation:dexterity-counter-rate", actorDimensions, {
          eligible: observation.eligibleToStop,
          completed: true,
          success: observation.counterQualified,
        });
      }
      metrics = addEnsured(metrics, "simulation:stopped-with-block-rate", actorDimensions, {
        eligible: observation.success,
        completed: true,
        success: observation.success && observation.declared,
      });
      metrics = addEnsured(metrics, "simulation:stopped-without-block-rate", actorDimensions, {
        eligible: observation.success,
        completed: true,
        success: observation.success && !observation.declared,
      });
    }
  }
  const attackDiceByAction = new Map<
    string,
    { readonly actorId?: string; readonly rolls: readonly (typeof observations)[number][] }
  >();
  for (const observation of observations) {
    if (observation.kind !== "die" || observation.scope !== "attack") continue;
    const prior = attackDiceByAction.get(observation.actionInstanceId);
    attackDiceByAction.set(observation.actionInstanceId, {
      actorId: prior?.actorId ?? observation.actorId,
      rolls: [...(prior?.rolls ?? []), observation],
    });
  }
  for (const { actorId, rolls } of attackDiceByAction.values()) {
    if (rolls.length < 2) continue;
    const successful = rolls.filter(
      (roll) => roll.kind === "die" && roll.outcome === "successful",
    ).length;
    const dimensions = dimensionsForSide(
      accumulator,
      sideFor(actorId, accumulator.fighterAId, accumulator.fighterBId),
    );
    metrics = addEnsured(metrics, "simulation:multi-die-partial-mitigation", dimensions, {
      eligible: true,
      completed: true,
      success: successful > 0 && successful < rolls.length,
    });
  }
  for (const event of input.transition.events) {
    if (event.type === "attack-resolved") {
      const side = sideFor(event.combatantId, accumulator.fighterAId, accumulator.fighterBId);
      const dimensions = dimensionsForSide(accumulator, side);
      metrics = addEnsured(metrics, "simulation:critical-rate", dimensions, {
        eligible: true,
        completed: true,
        success: event.critical,
      });
      metrics = addEnsured(metrics, "simulation:counter-rate", dimensions, {
        eligible: event.outcome === "stopped",
        completed: true,
        success: event.counter,
      });
      metrics = addEnsured(metrics, "simulation:counter-chain-frequency", dimensions, {
        eligible: true,
        completed: true,
        success: event.counter,
      });
      if (event.moveId !== undefined) {
        const sourceDimensions = sourceDimensionsFor(accumulator, side, event.moveId);
        metrics = addEnsured(metrics, "simulation:move-countered-rate", sourceDimensions, {
          eligible: true,
          completed: true,
          success: event.counter,
        });
        metrics = addEnsured(metrics, "simulation:move-blocked-rate", sourceDimensions, {
          eligible: true,
          completed: true,
          success: event.outcome === "stopped",
        });
        if (event.counter) {
          const counterDamage = observations
            .filter((observation) => observation.actionInstanceId === event.causedByDecisionId)
            .reduce(
              (sum, observation) => sum + (observation.kind === "damage" ? observation.applied : 0),
              0,
            );
          metrics = addEnsured(metrics, "simulation:counter-damage", sourceDimensions, {
            value: counterDamage,
            eligible: true,
            completed: true,
          });
        }
      }
    }
    if (event.type === "status-applied") {
      const side = sideFor(event.sourceCombatantId, accumulator.fighterAId, accumulator.fighterBId);
      metrics = addEnsured(
        metrics,
        "simulation:status-rate",
        dimensionsForSide(accumulator, side),
        {
          eligible: true,
          completed: true,
          success: true,
        },
      );
      metrics = addEnsured(
        metrics,
        "simulation:utility-status-control",
        dimensionsForSide(accumulator, side),
        {
          value: event.stacks,
          eligible: true,
          completed: true,
        },
      );
    }
    if (event.type === "item-used") {
      const side = sideFor(event.combatantId, accumulator.fighterAId, accumulator.fighterBId);
      const dimensions = sourceDimensionsFor(accumulator, side, event.itemId);
      metrics = addEnsured(metrics, "simulation:item-trigger-rate", dimensions, {
        eligible: true,
        completed: true,
        success: true,
      });
    }
    if (event.type === "transformation-activated") {
      const side = sideFor(event.combatantId, accumulator.fighterAId, accumulator.fighterBId);
      const dimensions = sourceDimensionsFor(accumulator, side, event.transformationId);
      transformationActivationTurns[`${side ?? "a"}:${event.transformationId}`] ??=
        input.transition.state.turnNumber;
      metrics = addEnsured(metrics, "simulation:transformation-activation-rate", dimensions, {
        eligible: true,
        completed: true,
        success: true,
      });
      metrics = addEnsured(metrics, "simulation:transformation-activation-turn", dimensions, {
        value: input.transition.state.turnNumber,
        eligible: true,
        completed: true,
      });
      const combatant = input.transition.state.combatants[event.combatantId];
      if (combatant !== undefined) {
        metrics = addEnsured(metrics, "simulation:transformation-activation-hp", dimensions, {
          value: combatant.hitPoints.current,
          eligible: true,
          completed: true,
        });
        metrics = addEnsured(metrics, "simulation:transformation-activation-ki", dimensions, {
          value: combatant.ki.current,
          eligible: true,
          completed: true,
        });
      }
    }
  }
  return {
    ...accumulator,
    metrics,
    maximumTrailingGap: trailing,
    actionCount,
    moveUseCounts,
    firstUseTurns,
    actionHistory,
    transformationActivationTurns,
  };
};

export const finalizeSimulationV4FightAccumulator = (
  accumulator: SimulationV4FightAccumulator,
  result: SimulationFightExecutionResult,
): SimulationV4FightAccumulator => {
  const winnerId =
    result.finalState.status === "completed"
      ? result.finalState.completion.winnerCombatantId
      : undefined;
  const winner = sideFor(winnerId, accumulator.fighterAId, accumulator.fighterBId);
  const completed = result.terminationReason === "engine-completed";
  let metrics = accumulator.metrics;
  const addFinal = (metricId: string, side: "a" | "b", value: number, success?: boolean): void => {
    metrics = addEnsured(metrics, metricId, dimensionsForSide(accumulator, side), {
      value,
      success,
      eligible: true,
      completed,
      incomplete: !completed,
      error: result.failure !== undefined,
      replaySeed: undefined,
    });
  };
  for (const side of ["a", "b"] as const) {
    const fighterId = side === "a" ? accumulator.fighterAId : accumulator.fighterBId;
    const won = winner === side;
    const fighter =
      result.finalState.combatants[fighterId as keyof typeof result.finalState.combatants];
    addFinal("simulation:raw-win-rate", side, won ? 1 : 0, won);
    addFinal("simulation:mean-turns", side, result.finalState.turnNumber ?? 0);
    addFinal("simulation:median-turns", side, result.finalState.turnNumber ?? 0);
    addFinal("simulation:turn-length-distribution", side, result.finalState.turnNumber ?? 0);
    addFinal(
      "simulation:comeback-rate",
      side,
      won && accumulator.maximumTrailingGap[side] >= 0.25 ? 1 : 0,
      won && accumulator.maximumTrailingGap[side] >= 0.25,
    );
    addFinal("simulation:side-bias", side, side === "a" && won ? 1 : 0, side === "a" && won);
    const initiativeWon = accumulator.dimensionsBySide[side].initiativeWinner === side;
    addFinal(
      "simulation:initiative-advantage",
      side,
      initiativeWon && won ? 1 : 0,
      initiativeWon && won,
    );
    addFinal("simulation:style-matchup-win-rate", side, won ? 1 : 0, won);
    addFinal("simulation:style-fight-duration", side, result.finalState.turnNumber ?? 0);
    addFinal("simulation:style-damage", side, result.summary.damageByCombatant[fighterId] ?? 0);
    if (accumulator.dimensionsBySide[side].evidenceRole === "controlled") {
      addFinal("simulation:dexterity-initiative-rate", side, initiativeWon ? 1 : 0, initiativeWon);
      addFinal(
        "simulation:win-probability-by-stat-differential",
        side,
        won ? 1 : winner === undefined ? 0.5 : 0,
        won,
      );
      addFinal(
        "simulation:dexterity-indirect-actions",
        side,
        accumulator.dimensionsBySide[side].firstActor === side ? 1 : 0,
      );
    }
    const sideDimensions = dimensionsForSide(accumulator, side);
    const totalFor = (metricId: string): number => {
      const metric = metrics[metricKeyFor(metricId, sideDimensions)];
      return metric === undefined ? 0 : metric.values.mean * metric.values.count;
    };
    const spentKi = totalFor("simulation:ki-spent");
    const dealtDamage = result.summary.damageByCombatant[fighterId] ?? 0;
    if (spentKi > 0) {
      addFinal("simulation:style-ki-efficiency", side, dealtDamage / spentKi);
      addFinal("simulation:ki-per-damage", side, spentKi / Math.max(1, dealtDamage));
    }
    if (fighter !== undefined) {
      addFinal("simulation:ki-starting", side, accumulator.startingKiBySide[side]);
      addFinal("simulation:ki-ending", side, fighter.ki.current);
      if (won) {
        addFinal("simulation:winner-remaining-hp", side, fighter.hitPoints.current);
        addFinal("simulation:winner-remaining-ki", side, fighter.ki.current);
      }
    }
    for (const moveId of accumulator.equippedMoveIdsBySide[side]) {
      const dimensions = sourceDimensionsFor(accumulator, side, moveId);
      metrics = addEnsured(metrics, "simulation:move-equipped-win-rate", dimensions, {
        value: won ? 1 : 0,
        success: won,
        eligible: true,
        completed,
        incomplete: !completed,
      });
      const sideMoveKey = `${side}:${moveId}`;
      const uses = accumulator.moveUseCounts[sideMoveKey] ?? 0;
      metrics = addEnsured(metrics, "simulation:move-uses-per-fight", dimensions, {
        value: uses,
        eligible: true,
        completed,
      });
      if (uses > 0) {
        metrics = addEnsured(metrics, "simulation:move-used-win-rate", dimensions, {
          value: won ? 1 : 0,
          success: won,
          eligible: true,
          completed,
        });
        metrics = addEnsured(metrics, "simulation:move-first-use-turn", dimensions, {
          value: accumulator.firstUseTurns[sideMoveKey] ?? 0,
          eligible: true,
          completed,
        });
      }
      metrics = addEnsured(metrics, "simulation:style-winning-move-rate", dimensions, {
        value: won && uses > 0 ? 1 : 0,
        success: won && uses > 0,
        eligible: won,
        completed,
      });
    }
    for (const itemId of accumulator.equippedItemIdsBySide[side]) {
      const dimensions = sourceDimensionsFor(accumulator, side, itemId);
      metrics = addEnsured(metrics, "simulation:item-equip-rate", dimensions, {
        eligible: true,
        completed,
        success: true,
      });
      metrics = addEnsured(metrics, "simulation:item-equipped-win-rate", dimensions, {
        value: won ? 1 : 0,
        eligible: true,
        completed,
        success: won,
      });
      const price = accumulator.itemPricesBySide[side][itemId];
      if (price === undefined || price <= 0) {
        const valueMetric = ensureMetric(metrics, "simulation:item-value-per-zenni", dimensions);
        const key = metricKeyFor("simulation:item-value-per-zenni", dimensions);
        metrics = {
          ...valueMetric,
          [key]: setSimulationMetricEvidenceV2(
            valueMetric[key]!,
            "not-applicable",
            "The canonical item has no positive Zenni price.",
          ),
        };
      }
    }
    for (const transformationId of accumulator.availableTransformationIdsBySide[side]) {
      const dimensions = sourceDimensionsFor(accumulator, side, transformationId);
      const transformationKey = `${side}:${transformationId}`;
      const activated = accumulator.transformationActivationTurns[transformationKey] !== undefined;
      metrics = addEnsured(metrics, "simulation:transformation-activation-rate", dimensions, {
        eligible: true,
        completed,
        success: activated,
      });
      const metricId = activated
        ? "simulation:transformation-win-after-activation"
        : "simulation:transformation-available-unused-win-rate";
      metrics = addEnsured(metrics, metricId, dimensions, {
        value: won ? 1 : 0,
        eligible: true,
        completed,
        success: won,
      });
      metrics = addEnsured(metrics, "simulation:transformation-matchup-win-rate", dimensions, {
        value: won ? 1 : winner === undefined ? 0.5 : 0,
        success: won,
        successWeight: won ? 1 : winner === undefined ? 0.5 : 0,
        eligible: true,
        completed,
      });
      if (activated)
        metrics = addEnsured(metrics, "simulation:transformation-post-duration", dimensions, {
          value:
            (result.finalState.turnNumber ?? 0) -
            (accumulator.transformationActivationTurns[transformationKey] ?? 0),
          eligible: true,
          completed,
        });
    }
  }
  // Every declared metric receives an explicit applicability outcome. An
  // untouched metric is not evidence for a zero; it means the fight did not
  // expose that metric's opportunity (or the arm could not price it).
  for (const [key, metric] of Object.entries(metrics)) {
    if (metric.evidence.state !== "insufficient") continue;
    const nextState =
      metric.denominators.attempted === 0
        ? "not-applicable"
        : metric.denominators.eligible === 0
          ? "never-eligible"
          : metric.denominators.completed === 0
            ? "eligible-never-selected"
            : "insufficient";
    if (nextState !== "insufficient")
      metrics = {
        ...metrics,
        [key]: setSimulationMetricEvidenceV2(
          metric,
          nextState,
          nextState === "not-applicable"
            ? "No opportunity for this metric was present in the retained fight."
            : nextState === "never-eligible"
              ? "The metric was evaluated but never eligible in this fight."
              : "The metric was eligible but no completed observation was selected.",
        ),
      };
  }
  return { ...accumulator, metrics };
};

export const markSimulationV4MetricNotApplicable = (
  accumulator: SimulationV4FightAccumulator,
  metricId: string,
  reason: string,
): SimulationV4FightAccumulator => {
  const key = metricKeyFor(metricId, accumulator.dimensions);
  const metric = accumulator.metrics[key];
  return metric === undefined
    ? accumulator
    : {
        ...accumulator,
        metrics: {
          ...accumulator.metrics,
          [key]: setSimulationMetricEvidenceV2(metric, "not-applicable", reason),
        },
      };
};

export const simulationV4AccumulatorHash = (accumulator: SimulationV4FightAccumulator): string =>
  canonicalHash({
    pairId: accumulator.pairId,
    orientation: accumulator.orientation,
    metrics: accumulator.metrics,
    maximumTrailingGap: accumulator.maximumTrailingGap,
    actionCount: accumulator.actionCount,
  });
