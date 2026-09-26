import type { CombatMechanicsView } from "@dragonball-resurgence/combat-engine";

import { canonicalHash } from "./canonical.js";
import { simulationDecisionPolicySchema, type SimulationDecisionPolicy } from "./exposure.js";
import type { SimulationAnomalyFinding } from "./anomalies.js";
import type { SimulationTemplate } from "./contracts.js";
import { z } from "zod";

export const SIMULATION_CAPABILITY_SELECTION_VERSION =
  "simulation-capability-selection:v1" as const;
export const SIMULATION_CAPABILITY_RECIPE_LIMIT = 12;

export const simulationCapabilityIdSchema = z.enum([
  "restricted-use",
  "status-control",
  "transformation",
  "anomaly",
]);
export type SimulationCapabilityId = z.output<typeof simulationCapabilityIdSchema>;

export const simulationCapabilityRecipeSchema = z
  .object({
    schemaVersion: z.literal(SIMULATION_CAPABILITY_SELECTION_VERSION),
    cellId: z.string().min(1),
    recipeId: z.string().min(1),
    capabilityId: simulationCapabilityIdSchema,
    templateAId: z.string().min(1),
    templateBId: z.string().min(1),
    targetDefinitionId: z.string().min(1),
    scenarioFamily: z.enum([
      "restricted-use-scarcity",
      "control-versus-resource",
      "transformation-timing",
      "anomaly-diagnostic",
    ]),
    decisionPolicy: simulationDecisionPolicySchema,
    rationale: z.string().min(1),
    recipeHash: z.string().min(1),
  })
  .strict();
export type SimulationCapabilityRecipe = z.output<typeof simulationCapabilityRecipeSchema>;

export interface SimulationCapabilitySelection {
  readonly schemaVersion: typeof SIMULATION_CAPABILITY_SELECTION_VERSION;
  readonly capabilityIds: readonly SimulationCapabilityId[];
  readonly recipes: readonly SimulationCapabilityRecipe[];
  readonly selectionHash: string;
}

const targetIdsFor = (
  capabilityId: SimulationCapabilityId,
  template: SimulationTemplate,
  view: CombatMechanicsView,
  anomalyTargets: ReadonlySet<string>,
  allowAnomalyFallback: boolean,
): readonly string[] => {
  if (capabilityId === "transformation")
    return template.transformationProfiles.map((profile) => profile.transformationId);
  if (capabilityId === "restricted-use") {
    const moveIds = template.moveIds.filter((moveId) => {
      const move = view.indexes.moves.get(moveId);
      return move?.restrictedUses !== undefined || move?.mechanics.restrictedUses !== undefined;
    });
    const itemIds = template.itemIds.filter((itemId) => {
      const item = view.indexes.items.get(itemId);
      return item?.usePolicy?.restrictedUses !== undefined;
    });
    return [...new Set([...moveIds, ...itemIds])].sort((left, right) => left.localeCompare(right));
  }
  if (capabilityId === "status-control") {
    const controlTypes = new Set([
      "apply-status",
      "lock",
      "prevent-status",
      "prevent-move-use",
      "skip-action",
    ]);
    return [
      ...new Set(
        template.moveIds.filter((moveId) =>
          (view.indexes.moves.get(moveId)?.effects ?? []).some((effect) =>
            controlTypes.has(effect.type),
          ),
        ),
      ),
    ].sort((left, right) => left.localeCompare(right));
  }
  const anomalyMoveIds = template.moveIds.filter((moveId) => anomalyTargets.has(moveId));
  if (anomalyMoveIds.length === 0 && !allowAnomalyFallback) return [];
  return [...new Set(anomalyMoveIds.length > 0 ? anomalyMoveIds : template.moveIds)].sort(
    (left, right) => left.localeCompare(right),
  );
};

const scenarioFamilyFor = (
  capabilityId: SimulationCapabilityId,
): SimulationCapabilityRecipe["scenarioFamily"] => {
  if (capabilityId === "restricted-use") return "restricted-use-scarcity";
  if (capabilityId === "transformation") return "transformation-timing";
  if (capabilityId === "anomaly") return "anomaly-diagnostic";
  return "control-versus-resource";
};

const recipeFor = (
  capabilityId: SimulationCapabilityId,
  a: SimulationTemplate,
  b: SimulationTemplate,
  targetDefinitionId: string,
): SimulationCapabilityRecipe => {
  const recipeId = `simulation-recipe:${capabilityId}-${targetDefinitionId}-${a.id}-${b.id}`;
  const base = {
    schemaVersion: SIMULATION_CAPABILITY_SELECTION_VERSION,
    cellId: `simulation-capability-cell:v1-${canonicalHash({ capabilityId, recipeId }).slice(-12)}`,
    recipeId,
    capabilityId,
    templateAId: a.id,
    templateBId: b.id,
    targetDefinitionId,
    scenarioFamily: scenarioFamilyFor(capabilityId),
    decisionPolicy:
      capabilityId === "anomaly"
        ? ({
            type: "forced-target-first" as const,
            targetDefinitionId,
            fallback: "first-legal" as const,
          } satisfies SimulationDecisionPolicy)
        : ({
            type: "controlled-legal-preference" as const,
            preferredDefinitionIds: [targetDefinitionId],
            baselineDefinitionId: "basic-attack",
            fallback: "first-legal" as const,
          } satisfies SimulationDecisionPolicy),
    rationale:
      capabilityId === "anomaly"
        ? "Rerun an anomaly-contributing legal target with bounded diagnostic retention."
        : `Exercise the declared ${capabilityId} capability through an engine-enumerated legal decision.`,
  };
  return simulationCapabilityRecipeSchema.parse({
    ...base,
    recipeHash: canonicalHash(base),
  });
};

export const selectSimulationCapabilityRecipes = (input: {
  readonly view: CombatMechanicsView;
  readonly templates: readonly SimulationTemplate[];
  readonly capabilityIds: readonly SimulationCapabilityId[];
  readonly anomalyFindings?: readonly SimulationAnomalyFinding[];
  readonly maxRecipesPerCapability?: number;
}): SimulationCapabilitySelection => {
  const anomalyTargets = new Set(
    (input.anomalyFindings ?? []).flatMap((finding) => finding.contributingActions),
  );
  const allowAnomalyFallback = (input.anomalyFindings?.length ?? 0) > 0;
  const recipes: SimulationCapabilityRecipe[] = [];
  const orderedTemplates = [...input.templates].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const orderedCapabilities = [...new Set(input.capabilityIds)].sort((left, right) =>
    left.localeCompare(right),
  );
  for (const capabilityId of orderedCapabilities)
    for (let index = 0; index < orderedTemplates.length; index += 1) {
      const a = orderedTemplates[index];
      const targets = targetIdsFor(
        capabilityId,
        a,
        input.view,
        anomalyTargets,
        allowAnomalyFallback,
      );
      for (const b of orderedTemplates.slice(index + 1))
        for (const targetDefinitionId of targets)
          recipes.push(recipeFor(capabilityId, a, b, targetDefinitionId));
    }
  const maxRecipesPerCapability =
    input.maxRecipesPerCapability ?? SIMULATION_CAPABILITY_RECIPE_LIMIT;
  if (!Number.isInteger(maxRecipesPerCapability) || maxRecipesPerCapability < 1)
    throw new RangeError("maxRecipesPerCapability must be a positive integer.");
  const sortedRecipes = [...recipes].sort((left, right) =>
    left.recipeId.localeCompare(right.recipeId),
  );
  const orderedRecipes = sortedRecipes.filter((recipe, index, values) => {
    const priorTargets = new Set(
      values
        .slice(0, index)
        .filter((candidate) => candidate.capabilityId === recipe.capabilityId)
        .map((candidate) => candidate.targetDefinitionId),
    );
    if (priorTargets.has(recipe.targetDefinitionId)) return false;
    return priorTargets.size < maxRecipesPerCapability;
  });
  const value = {
    schemaVersion: SIMULATION_CAPABILITY_SELECTION_VERSION,
    capabilityIds: orderedCapabilities,
    recipes: orderedRecipes,
  };
  return {
    ...value,
    selectionHash: canonicalHash(value),
  };
};

export const readSimulationCapabilitySelection = (
  input: unknown,
): SimulationCapabilitySelection => {
  const selection = {
    schemaVersion: SIMULATION_CAPABILITY_SELECTION_VERSION,
    capabilityIds: (input as { readonly capabilityIds?: unknown }).capabilityIds,
    recipes: (input as { readonly recipes?: unknown }).recipes,
  } as const;
  const parsed = z
    .object({
      schemaVersion: z.literal(SIMULATION_CAPABILITY_SELECTION_VERSION),
      capabilityIds: z.array(simulationCapabilityIdSchema),
      recipes: z.array(simulationCapabilityRecipeSchema),
      selectionHash: z.string().min(1),
    })
    .strict()
    .parse(input);
  if (parsed.selectionHash !== canonicalHash(selection))
    throw new RangeError("Simulation capability selection hash mismatch.");
  for (const recipe of parsed.recipes) {
    const recipeValue = { ...recipe } as Record<string, unknown>;
    delete recipeValue.recipeHash;
    if (recipe.recipeHash !== canonicalHash(recipeValue))
      throw new RangeError(`Simulation capability recipe hash mismatch: ${recipe.recipeId}.`);
  }
  return parsed;
};
