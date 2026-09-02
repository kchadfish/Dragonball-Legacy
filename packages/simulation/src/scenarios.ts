import { z } from "zod";

import { canonicalHash } from "./canonical.js";
import {
  simulationCheckpointSchema,
  simulationScenarioSchema,
  type SimulationLimits,
  type SimulationCheckpoint,
  type SimulationScenario,
  type SimulationScenarioExpansion,
  type SimulationTemplate,
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
  options: Readonly<{ checkpointId?: string; note?: string }> = {},
): SimulationScenario =>
  createScenario({
    id: `simulation-scenario:${family}-${index + 1}`,
    family,
    checkpointId:
      checkpointCatalog.checkpoints.find(
        (checkpoint) =>
          checkpoint.id ===
          (options.checkpointId ?? (family === "transformation-timing" ? "tf1" : "early")),
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
    note:
      options.note ??
      (family.startsWith("custom-")
        ? "Catalogued for a later variant phase; unsupported in Phase 3."
        : undefined),
  });

const templateForNeedles = (
  templates: readonly SimulationTemplate[],
  needles: readonly string[],
  fallbackIndex: number,
): SimulationTemplate =>
  templates.find((template) =>
    needles.some((needle) => template.label.toLowerCase().includes(needle)),
  ) ??
  templates[fallbackIndex % Math.max(templates.length, 1)] ??
  templates[0]!;

const scenarioPairsFor = (
  family: SimulationScenario["family"],
  pairs: readonly SimulationTemplate[],
): readonly {
  readonly left: SimulationTemplate;
  readonly right: SimulationTemplate;
  readonly note?: string;
  readonly checkpointId?: string;
}[] => {
  if (family === "symmetric-control")
    return pairs.map((template) => ({
      left: template,
      right: template,
      note: "Symmetric control: identical build, checkpoint, and mechanics variant on both sides.",
    }));
  if (family === "archetype-cross-matchup")
    return pairs.flatMap((left) =>
      pairs
        .filter((right) => right.id !== left.id)
        .map((right) => ({
          left,
          right,
          note: "Archetype cross-matchup: each generated archetype is compared against a different generated archetype.",
        })),
    );
  if (family === "mastery-style-matrix")
    return pairs.flatMap((left) =>
      pairs
        .filter((right) => right.styleId !== left.styleId)
        .slice(0, 4)
        .map((right) => ({
          left,
          right,
          note: "Mastery/style matrix: cross-style pairs expose style-specific move and mastery paths.",
        })),
    );
  if (family === "power-versus-dexterity")
    return [
      {
        left: templateForNeedles(pairs, ["high-power"], 0),
        right: templateForNeedles(pairs, ["high-dexterity"], 1),
        note: "Power versus Dexterity: high-power and high-dexterity archetypes are held as the matchup factors.",
      },
    ];
  if (family === "burst-versus-defense")
    return [
      {
        left: templateForNeedles(pairs, ["burst"], 0),
        right: templateForNeedles(pairs, ["defensive"], 1),
        note: "Burst versus defense: burst damage is paired against the defensive archetype.",
      },
    ];
  if (family === "control-versus-resource")
    return [
      {
        left: templateForNeedles(pairs, ["status-control"], 0),
        right: templateForNeedles(pairs, ["resource-efficient"], 1),
        note: "Control versus resource: status-control is paired against resource-efficient play.",
      },
    ];
  if (family === "transformation-timing")
    return [
      {
        left: templateForNeedles(pairs, ["transformation"], 0),
        right: templateForNeedles(pairs, ["balanced"], 1),
        checkpointId: "tf1",
        note: "Transformation timing: the transformation archetype is evaluated at the TF1 checkpoint against a stable control.",
      },
    ];
  if (family === "restricted-use-scarcity")
    return [
      {
        left: templateForNeedles(pairs, ["restricted-use"], 0),
        right: templateForNeedles(pairs, ["resource-efficient"], 1),
        checkpointId: "mid",
        note: "Restricted-use scarcity: limited-use actions are compared against a resource-preserving build.",
      },
    ];
  if (pairs.length < 2) return [];
  const left = pairs[0]!;
  const right = pairs[1]!;
  const noteByFamily: Readonly<Partial<Record<SimulationScenario["family"], string>>> = {
    "move-isolation":
      "Move isolation: target-present and target-removed execution contexts explain exposure separately from balance.",
    "combo-partner":
      "Combo partner: compatible neighboring builds are retained for interaction escalation.",
    "custom-move-replacement":
      "Custom replacement: the selected comparable slot is replaced in an immutable mechanics variant.",
    "custom-move-addition":
      "Custom addition: the draft is added without mutating the canonical mechanics registry.",
  };
  return [{ left, right, note: noteByFamily[family] }];
};

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
    .flatMap((family) =>
      scenarioPairsFor(family, pairs).map(({ left, right, note, checkpointId }, index) =>
        scenarioFor(family, left.id, right.id, index, limits, checkpointCatalog, {
          ...(checkpointId === undefined ? {} : { checkpointId }),
          ...(note === undefined ? {} : { note }),
        }),
      ),
    )
    .sort((left, right) => canonicalHash(left).localeCompare(canonicalHash(right)));
  return Object.freeze({
    scenarios: Object.freeze(scenarios),
    expansionHash: canonicalHash({ scenarios, checkpointCatalog: checkpointCatalog.catalogHash }),
    checkpointCatalogHash: checkpointCatalog.catalogHash,
  });
};
