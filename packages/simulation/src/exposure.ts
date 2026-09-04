import {
  CANONICAL_COMBAT_MECHANICS_VIEW,
  type CombatMechanicsView,
  type LegalDecision,
} from "@dragonball-resurgence/combat-engine";
import { z } from "zod";

import { canonicalHash } from "./canonical.js";
import type { SimulationCoveragePopulation } from "./coverage.js";
import type { SimulationMechanicPath } from "./move-coverage.js";

export const simulationDecisionPolicySchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("natural-ai"),
      profileId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("forced-target-first"),
      targetDefinitionId: z.string().min(1),
      fallback: z.enum(["first-legal", "pass"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("controlled-legal-preference"),
      preferredDefinitionIds: z.array(z.string().min(1)).min(1),
      baselineDefinitionId: z.string().min(1),
      fallback: z.literal("first-legal"),
    })
    .strict(),
]);
export type SimulationDecisionPolicy = z.output<typeof simulationDecisionPolicySchema>;

/** Natural evidence is reported by profile; forced/isolation runs never borrow these labels. */
export const SIMULATION_NATURAL_AI_PROFILES = Object.freeze([
  "profile:normal",
  "profile:hard",
  "profile:simulation-quality",
] as const);
export type SimulationNaturalAiProfile = (typeof SIMULATION_NATURAL_AI_PROFILES)[number];

export const simulationExposureRecipeSchema = z
  .object({
    schemaVersion: z.literal("simulation-exposure-recipe:v1"),
    recipeId: z.string().min(1),
    moveId: z.string().min(1),
    category: z.string().min(1),
    population: z.enum(["natural", "isolation", "forced"]),
    mechanicPath: z.enum(["decision", "trigger"]),
    scenarioFamily: z.string().min(1),
    requiredContexts: z.array(z.string().min(1)).min(1),
    decisionPolicy: simulationDecisionPolicySchema,
    fixtureId: z.string().min(1).optional(),
    rationale: z.string().min(1),
    recipeHash: z.string().min(1),
  })
  .strict();
export type SimulationExposureRecipe = z.output<typeof simulationExposureRecipeSchema>;

const recipeFamilyFor = (category: string): string => {
  switch (category) {
    case "signature":
      return "signature-horizon";
    case "block":
      return "defensive-response";
    case "mastery":
      return "natural-style-mastery";
    case "skill":
      return "resource-control";
    default:
      return "cross-archetype";
  }
};

const contextsFor = (category: string): readonly string[] => {
  switch (category) {
    case "signature":
      return ["target-present", "turn-reaches-signature-horizon", "ki-affordable"];
    case "block":
      return ["incoming-compatible-attack", "pending-response", "defender-eligible"];
    case "mastery":
      return ["start-combat", "passive-or-constant-trigger-path"];
    case "skill":
      return ["target-present", "ki-affordable", "turn-and-prerequisite-compatible"];
    default:
      return ["target-present", "ki-affordable", "turn-and-prerequisite-compatible"];
  }
};

export const createSimulationExposureRecipes = (
  view: CombatMechanicsView = CANONICAL_COMBAT_MECHANICS_VIEW,
  populations: readonly SimulationCoveragePopulation[] = ["natural", "isolation", "forced"],
): readonly SimulationExposureRecipe[] => {
  const recipes = view.moves.flatMap((move) =>
    populations.flatMap((population) => {
      const mechanicPath: SimulationMechanicPath =
        move.category === "mastery" || move.category === "block" ? "trigger" : "decision";
      const decisionPolicy: SimulationDecisionPolicy =
        population === "forced"
          ? { type: "forced-target-first", targetDefinitionId: move.id, fallback: "first-legal" }
          : { type: "natural-ai", profileId: SIMULATION_NATURAL_AI_PROFILES[0] };
      const base = {
        schemaVersion: "simulation-exposure-recipe:v1" as const,
        recipeId: `simulation-recipe:${population}-${move.id}-${mechanicPath}`,
        moveId: move.id,
        category: move.category,
        population,
        mechanicPath,
        scenarioFamily: recipeFamilyFor(move.category),
        requiredContexts: contextsFor(move.category),
        decisionPolicy,
        ...(move.category === "mastery" ? { fixtureId: `fixture:mastery-${move.id}` } : {}),
        rationale:
          population === "forced"
            ? "Forced exposure proves the exact engine-legal path and is excluded from natural balance metrics."
            : "Natural or isolation exposure uses ordinary legal selection and preserves the population denominator.",
      };
      return simulationExposureRecipeSchema.parse({ ...base, recipeHash: canonicalHash(base) });
    }),
  );
  const orderedRecipes = [...recipes];
  orderedRecipes.sort((left, right) => left.recipeId.localeCompare(right.recipeId));
  return Object.freeze(orderedRecipes);
};

const definitionIdFor = (decision: LegalDecision): string | undefined => {
  switch (decision.type) {
    case "use-move":
      return decision.moveId;
    case "use-item":
      return decision.itemId;
    case "activate-transformation":
      return decision.transformationId;
    case "deactivate-transformation":
      return `transformation:${decision.actorId}`;
    case "basic-attack":
      return "basic-attack";
    case "pass":
    case "power-up":
    case "surrender":
    case "respond-to-pending-decision":
      return undefined;
  }
};

const controlledDecisionFor = (
  legalDecisions: readonly LegalDecision[],
  policy: Extract<SimulationDecisionPolicy, { readonly type: "controlled-legal-preference" }>,
): LegalDecision | undefined => {
  for (const definitionId of [...policy.preferredDefinitionIds, policy.baselineDefinitionId]) {
    const decision = legalDecisions.find(
      (candidate) => definitionIdFor(candidate) === definitionId,
    );
    if (decision !== undefined) return decision;
  }
  return legalDecisions[0];
};

/** Selects only from the engine-supplied legal set; it never synthesizes a decision. */
export const selectForcedSimulationDecision = (
  legalDecisions: readonly LegalDecision[],
  policy: Extract<SimulationDecisionPolicy, { readonly type: "forced-target-first" }>,
): LegalDecision | undefined =>
  legalDecisions.find((decision) => definitionIdFor(decision) === policy.targetDefinitionId) ??
  (policy.fallback === "pass"
    ? legalDecisions.find((decision) => decision.type === "pass")
    : legalDecisions[0]);

/** Selects an arm-specific preference without invoking AI scoring or lookahead. */
export const selectControlledSimulationDecision = (
  legalDecisions: readonly LegalDecision[],
  policy: Extract<SimulationDecisionPolicy, { readonly type: "controlled-legal-preference" }>,
): LegalDecision | undefined => controlledDecisionFor(legalDecisions, policy);
