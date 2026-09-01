import { z } from "zod";

import { canonicalHash } from "./canonical.js";
import {
  simulationCheckpointSchema,
  simulationScenarioSchema,
  type SimulationLimits,
  type SimulationCheckpoint,
  type SimulationScenario,
  type SimulationScenarioExpansion,
} from "./contracts.js";
import { simulationTemplateIdSchema, simulationVariantIdSchema } from "./ids.js";
import { SIMULATION_DEFAULT_LIMITS } from "./policy.js";
import { ALL_SIMULATION_TEMPLATES } from "./templates.js";

export interface SimulationCheckpointCatalog {
  readonly schemaVersion: "simulation-checkpoints:v1";
  readonly checkpoints: readonly SimulationCheckpoint[];
  readonly catalogHash: string;
}

export const simulationCheckpointCatalogSchema = z
  .object({
    schemaVersion: z.literal("simulation-checkpoints:v1"),
    checkpoints: z.array(simulationCheckpointSchema),
    catalogHash: z.string().min(1),
  })
  .strict();

export const createSimulationCheckpointCatalog = (
  checkpoints: readonly SimulationCheckpoint[],
): SimulationCheckpointCatalog => {
  const parsed = checkpoints.map((checkpoint) => simulationCheckpointSchema.parse(checkpoint));
  const ids = new Set(parsed.map((checkpoint) => checkpoint.id));
  if (ids.size !== parsed.length) throw new RangeError("Checkpoint IDs must be unique.");
  const ordered = [...parsed].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id),
  );
  return Object.freeze({
    schemaVersion: "simulation-checkpoints:v1" as const,
    checkpoints: Object.freeze(ordered),
    catalogHash: canonicalHash(ordered),
  });
};

export const DEFAULT_SIMULATION_CHECKPOINT_CATALOG = createSimulationCheckpointCatalog([
  { id: "starter", label: "Starter", order: 0 },
  { id: "early", label: "Early", order: 1 },
  { id: "mid", label: "Mid", order: 2 },
  { id: "late", label: "Late", order: 3 },
  { id: "tf1", label: "Transformation one", order: 4 },
  { id: "endgame", label: "Endgame", order: 5 },
]);

export const SIMULATION_CHECKPOINTS = Object.freeze(
  DEFAULT_SIMULATION_CHECKPOINT_CATALOG.checkpoints.map((checkpoint) => checkpoint.id),
);
const defaultLimits: SimulationLimits = {
  maximumTurns: SIMULATION_DEFAULT_LIMITS.maximumTurns,
  maximumTransitions: SIMULATION_DEFAULT_LIMITS.maximumTransitions,
  semanticNoProgressLimit: SIMULATION_DEFAULT_LIMITS.semanticNoProgressLimit,
};

export const SIMULATION_SCENARIO_FAMILIES = Object.freeze([
  "symmetric-control",
  "archetype-cross-matchup",
  "mastery-style-matrix",
  "power-versus-dexterity",
  "burst-versus-defense",
  "control-versus-resource",
  "transformation-timing",
  "restricted-use-scarcity",
  "move-isolation",
  "combo-partner",
  "custom-move-replacement",
  "custom-move-addition",
] as const);

export const createScenario = (
  input: Omit<SimulationScenario, "schemaVersion">,
): SimulationScenario =>
  simulationScenarioSchema.parse({ ...input, schemaVersion: "simulation-contracts:v1" });

export const INITIAL_SCENARIO_CATALOG = Object.freeze(
  SIMULATION_SCENARIO_FAMILIES.map((family) => ({
    family,
    checkpointId: family.startsWith("custom-") ? "late" : "early",
    deferred: family.startsWith("custom-"),
  })),
);

const scenarioFor = (
  family: SimulationScenario["family"],
  templateAId: string,
  templateBId: string,
  index: number,
  limits: SimulationLimits,
  checkpointCatalog: SimulationCheckpointCatalog,
): SimulationScenario =>
  createScenario({
    id: `simulation-scenario:${family}-${index + 1}`,
    family,
    checkpointId:
      checkpointCatalog.checkpoints.find(
        (checkpoint) => checkpoint.id === (family === "transformation-timing" ? "tf1" : "early"),
      )?.id ??
      checkpointCatalog.checkpoints[0]?.id ??
      "starter",
    templateAId: simulationTemplateIdSchema.parse(templateAId),
    templateBId: simulationTemplateIdSchema.parse(templateBId),
    variantId: simulationVariantIdSchema.parse("simulation-variant:baseline"),
    retention: "summary",
    limits,
    stoppingPolicy: "continue",
    deferred: family.startsWith("custom-"),
    ...(family.startsWith("custom-")
      ? { note: "Catalogued for a later variant phase; unsupported in Phase 3." }
      : {}),
  });

export const expandSimulationScenarios = (
  templates = ALL_SIMULATION_TEMPLATES(),
  families: readonly SimulationScenario["family"][] = SIMULATION_SCENARIO_FAMILIES,
  limits: SimulationLimits = defaultLimits,
  checkpointCatalog: SimulationCheckpointCatalog = DEFAULT_SIMULATION_CHECKPOINT_CATALOG,
): SimulationScenarioExpansion => {
  const ordered = [...templates].sort((left, right) => left.id.localeCompare(right.id));
  const archetypes = ordered.filter((template) => template.kind === "synthetic");
  const pairs = archetypes.length > 0 ? archetypes : ordered;
  const scenarios = families
    .flatMap((family) => {
      if (family === "symmetric-control")
        return pairs.map((template, index) =>
          scenarioFor(family, template.id, template.id, index, limits, checkpointCatalog),
        );
      if (
        family === "archetype-cross-matchup" ||
        family === "power-versus-dexterity" ||
        family === "burst-versus-defense" ||
        family === "control-versus-resource"
      ) {
        return pairs.flatMap((left, leftIndex) =>
          pairs
            .filter((right) => right.id !== left.id)
            .map((right, rightIndex) =>
              scenarioFor(
                family,
                left.id,
                right.id,
                leftIndex * pairs.length + rightIndex,
                limits,
                checkpointCatalog,
              ),
            ),
        );
      }
      if (ordered.length < 2) return [];
      return [scenarioFor(family, ordered[0].id, ordered[1].id, 0, limits, checkpointCatalog)];
    })
    .sort((left, right) => canonicalHash(left).localeCompare(canonicalHash(right)));
  return Object.freeze({
    scenarios: Object.freeze(scenarios),
    expansionHash: canonicalHash({ scenarios, checkpointCatalog: checkpointCatalog.catalogHash }),
    checkpointCatalogHash: checkpointCatalog.catalogHash,
  });
};
