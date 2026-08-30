import type { DecisionEffectCategory } from "@dragonball-resurgence/combat-engine";
import { z } from "zod";

import type { AiDecisionFeature, ScoreFactor } from "./contracts.js";

export const AI_ADVISORY_VERSION = "ai-advisory-priorities:v1";
export const MAX_TACTICAL_PRIORITY_ADJUSTMENT = 25_000;

export type AiAdvisoryTarget =
  | { readonly type: "decision-category"; readonly category: string }
  | { readonly type: "mechanics-id"; readonly id: string }
  | { readonly type: "effect-category"; readonly category: DecisionEffectCategory }
  | {
      readonly type: "state-threshold";
      readonly metric:
        | "self-hp-ratio"
        | "opponent-hp-ratio"
        | "self-ki-ratio"
        | "opponent-ki-ratio"
        | "self-transformation-active"
        | "opponent-transformation-active";
      readonly operator: "<=" | ">=" | "=";
      readonly value: number;
    };

export interface AiAdvisoryModifier {
  readonly id: string;
  readonly version: "ai-advisory-modifier:v1";
  readonly target: AiAdvisoryTarget;
  readonly adjustment: number;
}

export interface AiAdvisoryPriorities {
  readonly version: typeof AI_ADVISORY_VERSION;
  readonly modifiers: readonly AiAdvisoryModifier[];
}

export interface AiAdvisoryValidationIssue {
  readonly path: string;
  readonly message: string;
}

export type AiAdvisoryValidationResult =
  | { readonly ok: true; readonly value: AiAdvisoryPriorities }
  | { readonly ok: false; readonly issues: readonly AiAdvisoryValidationIssue[] };

const stableId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const effectCategories = [
  "damage",
  "resource",
  "status",
  "roll",
  "control",
  "selection",
  "transformation",
  "cost",
  "restriction",
  "terminal",
  "other",
] as const satisfies readonly DecisionEffectCategory[];

const advisoryTargetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("decision-category"), category: z.string().min(1) }),
  z.object({ type: z.literal("mechanics-id"), id: z.string().min(1) }),
  z.object({ type: z.literal("effect-category"), category: z.enum(effectCategories) }),
  z.object({
    type: z.literal("state-threshold"),
    metric: z.enum([
      "self-hp-ratio",
      "opponent-hp-ratio",
      "self-ki-ratio",
      "opponent-ki-ratio",
      "self-transformation-active",
      "opponent-transformation-active",
    ]),
    operator: z.enum(["<=", ">=", "="]),
    value: z.number(),
  }),
]);

const advisorySchema = z.object({
  version: z.literal(AI_ADVISORY_VERSION),
  modifiers: z.array(
    z.object({
      id: z.string().regex(stableId),
      version: z.literal("ai-advisory-modifier:v1"),
      target: advisoryTargetSchema,
      adjustment: z
        .number()
        .min(-MAX_TACTICAL_PRIORITY_ADJUSTMENT)
        .max(MAX_TACTICAL_PRIORITY_ADJUSTMENT),
    }),
  ),
});

const issue = (path: string, message: string): AiAdvisoryValidationIssue => ({ path, message });

// eslint-disable-next-line sonarjs/cognitive-complexity, complexity -- schema and semantic validation intentionally reports every issue together.
export const validateAiAdvisoryPriorities = (input: unknown): AiAdvisoryValidationResult => {
  const parsed = advisorySchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      issues: parsed.error.issues.map((entry) => issue(entry.path.join("."), entry.message)),
    };
  const ids = new Set<string>();
  const issues: AiAdvisoryValidationIssue[] = [];
  for (const [index, modifier] of parsed.data.modifiers.entries()) {
    if (ids.has(modifier.id))
      issues.push(issue(`modifiers.${index}.id`, "Modifier IDs must be unique."));
    ids.add(modifier.id);
    if (modifier.target.type === "decision-category" && !stableId.test(modifier.target.category))
      issues.push(
        issue(`modifiers.${index}.target.category`, "Category must be a stable lowercase ID."),
      );
    if (modifier.target.type === "mechanics-id" && !stableId.test(modifier.target.id))
      issues.push(
        issue(`modifiers.${index}.target.id`, "Mechanics ID must be a stable lowercase ID."),
      );
    if (
      modifier.target.type === "state-threshold" &&
      !modifier.target.metric.includes("transformation") &&
      (modifier.target.value < 0 || modifier.target.value > 1)
    )
      issues.push(
        issue(`modifiers.${index}.target.value`, "Resource ratios must be between 0 and 1."),
      );
    if (
      modifier.target.type === "state-threshold" &&
      modifier.target.metric.includes("transformation") &&
      ![0, 1].includes(modifier.target.value)
    )
      issues.push(
        issue(`modifiers.${index}.target.value`, "Transformation thresholds use 0 or 1."),
      );
  }
  return issues.length === 0 ? { ok: true, value: parsed.data } : { ok: false, issues };
};

const stateThresholdValue = (
  feature: AiDecisionFeature,
  target: Extract<AiAdvisoryTarget, { readonly type: "state-threshold" }>,
): number => {
  const context = feature.strategicContext;
  if (context === undefined) return 0;
  switch (target.metric) {
    case "self-hp-ratio":
      return context.actor.hp.ratio;
    case "opponent-hp-ratio":
      return context.opponent.hp.ratio;
    case "self-ki-ratio":
      return context.actor.ki.ratio;
    case "opponent-ki-ratio":
      return context.opponent.ki.ratio;
    case "self-transformation-active":
      return context.actor.activeTransformation ? 1 : 0;
    case "opponent-transformation-active":
      return context.opponent.activeTransformation ? 1 : 0;
  }
};

const matches = (feature: AiDecisionFeature, target: AiAdvisoryTarget): boolean => {
  switch (target.type) {
    case "decision-category":
      return feature.category === target.category;
    case "mechanics-id":
      return feature.mechanics?.id === target.id;
    case "effect-category":
      return feature.effects.some((effect) => effect.category === target.category);
    case "state-threshold": {
      const actual = stateThresholdValue(feature, target);
      if (target.operator === "<=") return actual <= target.value;
      if (target.operator === ">=") return actual >= target.value;
      return actual === target.value;
    }
  }
};

/** Compiles advisory configuration into bounded, named score factors. */
export const advisoryFactorsFor = (
  feature: AiDecisionFeature,
  priorities: AiAdvisoryPriorities | undefined,
): readonly ScoreFactor[] => {
  if (priorities === undefined) return [];
  let applied = 0;
  return [...priorities.modifiers]
    .sort((left, right) => left.id.localeCompare(right.id))
    .flatMap((modifier) => {
      if (!matches(feature, modifier.target)) return [];
      const next = Math.max(
        -MAX_TACTICAL_PRIORITY_ADJUSTMENT,
        Math.min(MAX_TACTICAL_PRIORITY_ADJUSTMENT, applied + modifier.adjustment),
      );
      const value = next - applied;
      applied = next;
      return [
        {
          code: `tactical-priority:${modifier.id}`,
          value,
          evaluator: { id: "ai-evaluator:tactical-priority", version: AI_ADVISORY_VERSION },
          basis: { type: "adjustment", reason: "tactical-clamp" },
        } satisfies ScoreFactor,
      ];
    });
};
