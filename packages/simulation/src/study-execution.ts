import { z } from "zod";
import { SIMULATION_QUALITY_PROFILE } from "@dragonball-resurgence/ai-engine";
import type { CombatMechanicsView } from "@dragonball-resurgence/combat-engine";
import {
  createSimulationCatalogFightRequest,
  simulationV4ItemArmTemplateFor,
  simulationV4MoveRemovalArmTemplateFor,
} from "./catalog-v4-runner.js";
import { simulationMetricAggregateV2Schema } from "./statistics-v4.js";
import type {
  SimulationFightRequest,
  SimulationProgress,
  SimulationTemplate,
} from "./contracts.js";
import { studyTaskSchema, type StudyTask, type SimulationStudyManifest } from "./study-design.js";
import { detectSimulationAnomalies, simulationAnomalyFindingSchema } from "./anomalies.js";
import { simulationSequenceForResult } from "./sequences.js";
import { sequenceOccurrenceSchema, simulationSequenceOccurrences } from "./sequence-counts.js";

export const studyObservationSchema = z
  .object({
    task: studyTaskSchema,
    runId: z.string(),
    executionError: z.string().nullable(),
    termination: z.string(),
    focalScore: z.number().min(0).max(1).nullable(),
    metrics: z.record(z.string(), simulationMetricAggregateV2Schema),
    sequence: z.array(sequenceOccurrenceSchema),
    sequenceAvailable: z.boolean(),
    sequenceWon: z.boolean(),
    anomalies: z.array(simulationAnomalyFindingSchema),
    replay: z.unknown().optional(),
  })
  .strict();
export type StudyObservation = z.infer<typeof studyObservationSchema>;

const removeTarget = (template: SimulationTemplate, target: string): SimulationTemplate => {
  if (template.moveIds.includes(target))
    return simulationV4MoveRemovalArmTemplateFor(template, target);
  if (template.itemIds.includes(target))
    return simulationV4ItemArmTemplateFor(template, target).template;
  if (template.transformationProfiles.some((p) => p.transformationId === target))
    return {
      ...template,
      transformationProfiles: template.transformationProfiles.filter(
        (p) => p.transformationId !== target,
      ),
    };
  throw new Error(`Study target ${target} is absent from focal template ${template.id}`);
};

/** Same focal fighter and intervention in both orientations; phase namespaces cannot overlap. */
export const createSimulationStudyRequest = (
  manifest: SimulationStudyManifest,
  task: StudyTask,
  templates: readonly SimulationTemplate[],
  view: CombatMechanicsView,
): SimulationFightRequest => {
  const recipe = manifest.recipes.find((r) => r.cellId === task.cellId);
  const cell = manifest.cells.find((c) => c.id === task.cellId);
  const a = templates.find((t) => t.id === (recipe?.templateAId ?? cell?.a));
  const b = templates.find((t) => t.id === (recipe?.templateBId ?? cell?.b));
  if (!a || !b) throw new Error(`Unknown study cell ${task.cellId}`);
  const schedule =
    task.phase === "natural" || task.phase === "diagnostic" ? task.phase : "controlled";
  const exposurePopulation = {
    natural: "natural",
    controlled: "isolation",
    diagnostic: "forced",
  } as const;
  const family = `simulation-pair:study-${manifest.id}-${task.phase}-${task.cellId}`;
  const base = createSimulationCatalogFightRequest({
    a,
    b,
    pairId: family,
    iteration: task.seed,
    mirror: task.mirror,
    rootSeed: manifest.rootSeed,
    fixedTime: new Date(manifest.fixedTime),
    profile: SIMULATION_QUALITY_PROFILE,
    view,
    schedule: "natural",
    metricDefinitionIds: manifest.metricDefinitionIds,
    collectors: ["metrics", "sequences", "anomalies"],
  });
  const focal =
    task.branch === "variant" && recipe ? removeTarget(a, recipe.targetDefinitionId) : a;
  return {
    ...base,
    runId: `simulation-run:${task.id}`,
    seedFamilyId: family,
    templateA: task.mirror === "original" ? focal : b,
    templateB: task.mirror === "original" ? b : focal,
    scenario: {
      ...base.scenario,
      retention: task.phase === "diagnostic" ? "diagnostic" : "summary",
    },
    statistics: {
      schemaVersion: "simulation-statistics-request:v3",
      evidenceRole: schedule === "natural" ? "natural-balance" : schedule,
      exposurePopulation: exposurePopulation[schedule],
      arm: {
        schedule,
        armId: `study-${schedule}-${task.branch}`,
        branch: task.branch,
        baselineTemplateId: a.id,
        opponentTemplateId: b.id,
        iteration: task.seed,
        orientation: task.mirror,
        ...(recipe
          ? {
              recipeId: recipe.recipeId,
              capabilityId: recipe.capabilityId,
              sourceDefinitionId: recipe.targetDefinitionId,
            }
          : {}),
      },
      metricDefinitionIds: manifest.metricDefinitionIds,
      collectors: ["metrics", "sequences", "anomalies"],
    },
    ...(recipe ? { decisionPolicy: recipe.decisionPolicy } : {}),
  };
};

/** Compact sufficient result: no full combat states in the hot recovery journal. */
export const studyObservationFor = (
  task: StudyTask,
  progress: SimulationProgress,
): StudyObservation => {
  const result = progress.result;
  if (!result.ok)
    return {
      task,
      runId: progress.runId,
      executionError: JSON.stringify(result.error),
      termination: "execution-error",
      focalScore: null,
      metrics: {},
      sequence: [],
      sequenceAvailable: false,
      sequenceWon: false,
      anomalies: [],
    };
  const fight = result.value;
  const sequence = simulationSequenceForResult(fight);
  const focalId = task.mirror === "original" ? fight.fighterAId : fight.fighterBId;
  const winner =
    fight.finalState.status === "completed"
      ? fight.finalState.completion.winnerCombatantId
      : undefined;
  let score: number | null = null;
  if (fight.terminationReason === "engine-completed") {
    score = Number(winner === focalId);
    if (winner === undefined) score = 0.5;
  }
  return studyObservationSchema.parse({
    task,
    runId: progress.runId,
    executionError: fight.failure ? JSON.stringify(fight.failure) : null,
    termination: fight.terminationReason,
    focalScore: score,
    metrics: { ...fight.statistics?.metrics },
    sequence: sequence ? simulationSequenceOccurrences(sequence) : [],
    sequenceAvailable: sequence !== undefined,
    sequenceWon: score === 1,
    anomalies: [...detectSimulationAnomalies([fight])],
    ...(task.phase === "diagnostic" ? { replay: fight.replay } : {}),
  });
};
