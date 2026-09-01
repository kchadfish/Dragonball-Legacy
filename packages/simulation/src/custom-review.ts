import {
  CANONICAL_COMBAT_MECHANICS_VIEW,
  type CombatMechanicsView,
} from "@dragonball-resurgence/combat-engine";
import type { MoveDefinition } from "@dragonball-resurgence/game-data";
import { z } from "zod";

import { canonicalHash } from "./canonical.js";
import { customMoveDraftIdSchema } from "./ids.js";

export interface CustomMoveDraft {
  readonly schemaVersion: "simulation-custom-draft:v1";
  readonly draftId: string;
  readonly version: number;
  readonly move: MoveDefinition;
  readonly rationale: string;
  readonly intendedContext: string;
  readonly proposedSourceText: string;
  readonly notes?: string;
}

export const customMoveDraftSchema = z
  .object({
    schemaVersion: z.literal("simulation-custom-draft:v1"),
    draftId: customMoveDraftIdSchema,
    version: z.number().int().positive(),
    move: z.custom<MoveDefinition>((value) => typeof value === "object" && value !== null),
    rationale: z.string().min(1),
    intendedContext: z.string().min(1),
    proposedSourceText: z.string().min(1),
    notes: z.string().optional(),
  })
  .strict();

export type CustomMovePreflightClassification =
  | "malformed"
  | "ambiguous"
  | "declarative-capability-gap"
  | "supported-but-out-of-scope"
  | "executable";

export interface CustomMovePreflight {
  readonly classification: CustomMovePreflightClassification;
  readonly issues: readonly string[];
  readonly moveHash?: string;
}

export interface CustomMoveExperimentPlan {
  readonly arms: readonly ("baseline" | "addition" | "replacement" | "renamed-control")[];
  readonly mirrored: boolean;
  readonly isolation: boolean;
  readonly policies: readonly string[];
  readonly escalation: "none" | "interaction";
}

export type CustomMoveReviewConclusion =
  | "cannot-evaluate"
  | "insufficient-evidence"
  | "no-flag-detected"
  | "potential-balance-concern"
  | "potential-rules-concern"
  | "staff-review-required";

export interface CustomMoveReviewDossier {
  readonly schemaVersion: "simulation-custom-review:v1";
  readonly draftId: string;
  readonly preflight: CustomMovePreflight;
  readonly staticFlags: readonly string[];
  readonly comparableMoveIds: readonly string[];
  readonly experimentPlan?: CustomMoveExperimentPlan;
  readonly conclusion: CustomMoveReviewConclusion;
  readonly dossierHash: string;
}

export const customMoveReviewDossierSchema = z
  .object({
    schemaVersion: z.literal("simulation-custom-review:v1"),
    draftId: customMoveDraftIdSchema,
    preflight: z
      .object({
        classification: z.enum([
          "malformed",
          "ambiguous",
          "declarative-capability-gap",
          "supported-but-out-of-scope",
          "executable",
        ]),
        issues: z.array(z.string()),
        moveHash: z.string().optional(),
      })
      .strict(),
    staticFlags: z.array(z.string()),
    comparableMoveIds: z.array(z.string()),
    experimentPlan: z
      .object({
        arms: z.array(z.enum(["baseline", "addition", "replacement", "renamed-control"])),
        mirrored: z.boolean(),
        isolation: z.boolean(),
        policies: z.array(z.string()),
        escalation: z.enum(["none", "interaction"]),
      })
      .strict()
      .optional(),
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

const staticFlagsFor = (move: MoveDefinition): readonly string[] => {
  const flags: string[] = [];
  if (move.kiCost === 0 && (move.attack?.powerPercent ?? 0) >= 100)
    flags.push("zero-cost-high-damage");
  if (
    move.restrictedUses === undefined &&
    move.mechanics.effectRuleTokens?.some((token) => token === "stun" || token === "lock")
  )
    flags.push("unbounded-control");
  return flags;
};

const comparableMovesFor = (
  move: MoveDefinition,
  mechanicsView: CombatMechanicsView,
): readonly string[] =>
  mechanicsView.moves
    .filter(
      (candidate) =>
        candidate.id !== move.id &&
        candidate.category === move.category &&
        (candidate.attack?.type ?? "none") === (move.attack?.type ?? "none"),
    )
    .map((candidate) => candidate.id)
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 8);

const preflightFor = (
  draft: CustomMoveDraft,
  mechanicsView: CombatMechanicsView,
): CustomMovePreflight => {
  const issues: string[] = [];
  const moveId = draft.move.id;
  if (mechanicsView.indexes.moves.has(moveId))
    issues.push("Move ID already exists in the canonical catalog.");
  if (draft.move.effectClauses.length === 0 && draft.move.effects === undefined)
    issues.push("Move has no structured declarative effect representation.");
  if (draft.move.mechanics.effectRuleTokens?.some((token) => token === "planetary-destruction"))
    issues.push("Move is outside the simulation scope.");
  let classification: CustomMovePreflightClassification = "executable";
  if (issues.some((issue) => issue.includes("already exists"))) classification = "ambiguous";
  else if (issues.some((issue) => issue.includes("structured")))
    classification = "declarative-capability-gap";
  else if (issues.some((issue) => issue.includes("outside")))
    classification = "supported-but-out-of-scope";
  return { classification, issues, moveHash: canonicalHash(draft.move) };
};

const draftIdFor = (draft: unknown): string => {
  if (typeof draft !== "object" || draft === null) return "custom-move-draft:malformed";
  const draftId = (draft as { readonly draftId?: unknown }).draftId;
  return typeof draftId === "string" ? draftId : "custom-move-draft:malformed";
};

export const reviewCustomMove = (
  draft: unknown,
  mechanicsView: CombatMechanicsView = CANONICAL_COMBAT_MECHANICS_VIEW,
): CustomMoveReviewDossier => {
  const parsed = customMoveDraftSchema.safeParse(draft);
  if (!parsed.success) {
    const preflight: CustomMovePreflight = {
      classification: "malformed",
      issues: [parsed.error.message],
    };
    return {
      schemaVersion: "simulation-custom-review:v1",
      draftId: draftIdFor(draft),
      preflight,
      staticFlags: [],
      comparableMoveIds: [],
      conclusion: "cannot-evaluate",
      dossierHash: canonicalHash(preflight),
    };
  }
  const preflight = preflightFor(parsed.data, mechanicsView);
  const staticFlags = staticFlagsFor(parsed.data.move);
  const experimentPlan =
    preflight.classification === "executable"
      ? {
          arms: ["baseline", "addition", "replacement", "renamed-control"] as const,
          mirrored: true,
          isolation: true,
          policies: ["quality", "conservative"],
          escalation: "interaction" as const,
        }
      : undefined;
  let conclusion: CustomMoveReviewConclusion = "cannot-evaluate";
  if (preflight.classification === "executable")
    conclusion = staticFlags.length > 0 ? "staff-review-required" : "insufficient-evidence";
  return {
    schemaVersion: "simulation-custom-review:v1",
    draftId: parsed.data.draftId,
    preflight,
    staticFlags,
    comparableMoveIds: comparableMovesFor(parsed.data.move, mechanicsView),
    ...(experimentPlan ? { experimentPlan } : {}),
    conclusion,
    dossierHash: canonicalHash({
      draft: parsed.data,
      preflight,
      staticFlags,
      experimentPlan,
      conclusion,
    }),
  };
};
