import type { LegalDecision, PendingDecision } from "@dragonball-resurgence/combat-engine";

import { CONTEXTUAL_EVALUATOR, contextualEvaluatorRegistry } from "./contextual-utility.js";

export const legalDecisionTypes = [
  "pass",
  "power-up",
  "surrender",
  "basic-attack",
  "use-move",
  "activate-transformation",
  "deactivate-transformation",
  "use-item",
  "respond-to-pending-decision",
] as const satisfies readonly LegalDecision["type"][];

export const pendingDecisionTypes = [
  "defense-response",
  "post-defense-roll",
  "optional-effect",
  "select-combatant",
  "select-move",
  "select-source-action",
  "select-source-effect",
] as const satisfies readonly PendingDecision["type"][];

export const responseShapeTypes = ["one", "up-to", "all", "engine-authored-options"] as const;
export type ResponseShapeType = (typeof responseShapeTypes)[number];
export type AiSurfaceClassification =
  "supported" | "baseline" | "unsupported" | "audited-out-of-scope";

export interface AiEvaluatorRegistryEntry {
  readonly id: string;
  readonly surface: string;
  readonly classification: AiSurfaceClassification;
  readonly roadmapOwner: string;
  readonly featureExtractor: string;
  readonly prerequisites: readonly string[];
  readonly representativeScenario: string;
  readonly focusedProof: string;
  readonly proofTarget?: string;
}

const legalEntry = (
  type: LegalDecision["type"],
  scenario: string,
  proof: string,
): AiEvaluatorRegistryEntry => ({
  id: `ai-evaluator:legal-${type}`,
  surface: type,
  classification: "baseline",
  roadmapOwner: "AI-120",
  featureExtractor: "ai-feature-extractor:v1",
  prerequisites: ["AI-030 safe legal fallback"],
  representativeScenario: scenario,
  focusedProof: proof,
});

export const legalDecisionEvaluatorRegistry = {
  pass: legalEntry("pass", "ordinary action phase", "packages/ai-engine/src/safe-fallback.test.ts"),
  "power-up": legalEntry(
    "power-up",
    "ordinary action phase",
    "packages/ai-engine/src/safe-fallback.test.ts",
  ),
  surrender: legalEntry(
    "surrender",
    "terminal surrender choice",
    "packages/ai-engine/src/safe-fallback.test.ts",
  ),
  "basic-attack": legalEntry(
    "basic-attack",
    "basic attack against local opponent",
    "packages/ai-engine/src/safe-fallback.test.ts",
  ),
  "use-move": legalEntry(
    "use-move",
    "ordinary or counter move",
    "packages/ai-engine/src/safe-fallback.test.ts",
  ),
  "activate-transformation": legalEntry(
    "activate-transformation",
    "available transformation activation",
    "packages/ai-engine/src/safe-fallback.test.ts",
  ),
  "deactivate-transformation": legalEntry(
    "deactivate-transformation",
    "manual transformation reversion",
    "packages/ai-engine/src/safe-fallback.test.ts",
  ),
  "use-item": legalEntry(
    "use-item",
    "combat item use",
    "packages/ai-engine/src/safe-fallback.test.ts",
  ),
  "respond-to-pending-decision": legalEntry(
    "respond-to-pending-decision",
    "complete pending response selection",
    "packages/ai-engine/src/safe-fallback.test.ts",
  ),
} as const satisfies Record<LegalDecision["type"], AiEvaluatorRegistryEntry>;

const pendingEntry = (
  type: PendingDecision["type"],
  scenario: string,
): AiEvaluatorRegistryEntry => ({
  id: `ai-evaluator:pending-${type}`,
  surface: type,
  classification: "baseline",
  roadmapOwner: "AI-120",
  featureExtractor: "ai-feature-extractor:v1",
  prerequisites: ["AI-030 safe legal fallback", "complete supplied LegalDecision response"],
  representativeScenario: scenario,
  focusedProof: "packages/ai-engine/src/feature-extraction.test.ts",
});

export const pendingDecisionEvaluatorRegistry = {
  "defense-response": pendingEntry("defense-response", "engine-authored roll or block response"),
  "post-defense-roll": pendingEntry("post-defense-roll", "engine-authored post-defense reaction"),
  "optional-effect": pendingEntry("optional-effect", "optional activation or decline"),
  "select-combatant": pendingEntry("select-combatant", "one local combatant candidate"),
  "select-move": pendingEntry("select-move", "one or more move candidates"),
  "select-source-action": pendingEntry(
    "select-source-action",
    "declared source-action candidate surface",
  ),
  "select-source-effect": pendingEntry(
    "select-source-effect",
    "declared source-effect candidate surface",
  ),
} as const satisfies Record<PendingDecision["type"], AiEvaluatorRegistryEntry>;

const responseEntry = (
  type: ResponseShapeType,
  scenario: string,
  classification: AiSurfaceClassification = "baseline",
): AiEvaluatorRegistryEntry => ({
  id: `ai-evaluator:response-${type}`,
  surface: type,
  classification,
  roadmapOwner: "AI-120",
  featureExtractor: "ai-feature-extractor:v1",
  prerequisites: ["complete supplied LegalDecision response"],
  representativeScenario: scenario,
  focusedProof: "packages/ai-engine/src/feature-extraction.test.ts",
  ...(classification === "unsupported"
    ? { proofTarget: "public transition fixture for complete source selection" }
    : {}),
});

export const responseShapeEvaluatorRegistry = {
  one: responseEntry("one", "exactly one persisted candidate"),
  "up-to": responseEntry("up-to", "bounded multi-selection"),
  all: responseEntry("all", "all persisted candidates"),
  "engine-authored-options": responseEntry(
    "engine-authored-options",
    "response options without declarative selection metadata",
  ),
} as const satisfies Record<ResponseShapeType, AiEvaluatorRegistryEntry>;

export const allAiEvaluatorRegistryEntries = [
  ...Object.values(legalDecisionEvaluatorRegistry),
  ...Object.values(pendingDecisionEvaluatorRegistry),
  ...Object.values(responseShapeEvaluatorRegistry),
] as const;

export const contextualEvaluatorRegistryEntries = contextualEvaluatorRegistry.map((code) => ({
  id: `ai-evaluator:${code}`,
  code,
  evaluator: CONTEXTUAL_EVALUATOR,
  status: "complete" as const,
  proof: "packages/ai-engine/src/contextual-utility.test.ts",
}));

export const legalDecisionEvaluatorFor = (type: LegalDecision["type"]): AiEvaluatorRegistryEntry =>
  legalDecisionEvaluatorRegistry[type];

export const pendingDecisionEvaluatorFor = (
  type: PendingDecision["type"],
): AiEvaluatorRegistryEntry => pendingDecisionEvaluatorRegistry[type];

export const responseShapeEvaluatorFor = (type: ResponseShapeType): AiEvaluatorRegistryEntry =>
  responseShapeEvaluatorRegistry[type];
