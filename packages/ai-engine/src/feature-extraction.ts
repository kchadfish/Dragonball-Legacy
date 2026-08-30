import { canonicalDecisionKey, type LegalDecision } from "@dragonball-resurgence/combat-engine";

import {
  type AiDecisionFeature,
  type AiFeatureExtractionInput,
  type AiFeatureExtractionResult,
  type AiMechanicsReference,
  type AiPendingSelectionFacts,
} from "./contracts.js";

const mechanicsReferenceFor = (
  input: AiFeatureExtractionInput,
): AiMechanicsReference | undefined => {
  const { decision, mechanics } = input;
  switch (decision.type) {
    case "use-move": {
      const entry = mechanics.moves.find((candidate) => candidate.id === decision.moveId);
      return entry === undefined
        ? undefined
        : { type: "move", id: entry.id, category: entry.category, tags: entry.tags };
    }
    case "use-item": {
      const entry = mechanics.items.find((candidate) => candidate.id === decision.itemId);
      return entry === undefined
        ? undefined
        : { type: "item", id: entry.id, category: entry.category };
    }
    case "activate-transformation": {
      const entry = mechanics.transformations.find(
        (candidate) => candidate.id === decision.transformationId,
      );
      return entry === undefined
        ? undefined
        : { type: "transformation", id: entry.id, raceId: entry.raceId, tier: entry.tier };
    }
    case "pass":
    case "power-up":
    case "surrender":
    case "basic-attack":
    case "deactivate-transformation":
    case "respond-to-pending-decision":
      return undefined;
  }
};

const mechanicsReferenceIdFor = (
  decision: LegalDecision,
): { readonly type: AiMechanicsReference["type"]; readonly id: string } | undefined => {
  switch (decision.type) {
    case "use-move":
      return { type: "move", id: decision.moveId };
    case "use-item":
      return { type: "item", id: decision.itemId };
    case "activate-transformation":
      return { type: "transformation", id: decision.transformationId };
    case "pass":
    case "power-up":
    case "surrender":
    case "basic-attack":
    case "deactivate-transformation":
    case "respond-to-pending-decision":
      return undefined;
  }
};

const pendingFactsFor = (input: AiFeatureExtractionInput): AiPendingSelectionFacts | undefined => {
  if (input.decision.type !== "respond-to-pending-decision") return undefined;
  const pending = input.state.status === "active" ? input.state.pendingDecision : undefined;
  if (pending === undefined) return undefined;
  return {
    pendingDecisionId: pending.id,
    pendingType: pending.type,
    optionIds: pending.options.map((option) => option.id),
    selectedOptionIds: [...input.decision.selectedOptionIds],
    optional: pending.optional === true,
    selection: input.descriptor.selection,
  };
};

const descriptorCategoryFor = (decision: LegalDecision): string => {
  switch (decision.type) {
    case "pass":
    case "power-up":
    case "surrender":
    case "basic-attack":
      return decision.type;
    case "use-move":
      return "move";
    case "activate-transformation":
    case "deactivate-transformation":
      return "transformation";
    case "use-item":
      return "item";
    case "respond-to-pending-decision":
      return "pending-response";
  }
};

const invalidState = (message: string): AiFeatureExtractionResult => ({
  ok: false,
  error: { type: "invalid-state", message },
});

/**
 * Converts an engine-authored descriptor into non-authoritative AI features.
 * This function deliberately does not describe, probe, submit, or mutate a decision.
 */
export const extractDecisionFeatures = (
  input: AiFeatureExtractionInput,
): AiFeatureExtractionResult => {
  if (input.state.status !== "active")
    return invalidState("Feature extraction requires an active state.");
  if (!Object.hasOwn(input.state.combatants, input.decision.actorId))
    return invalidState("Decision actor is not present in the supplied state.");

  const key = canonicalDecisionKey(input.decision);
  if (input.descriptor.key !== key)
    return {
      ok: false,
      error: {
        type: "descriptor-decision-mismatch",
        field: "key",
        expected: key,
        actual: input.descriptor.key,
      },
    };
  if (input.descriptor.identity.type !== input.decision.type)
    return {
      ok: false,
      error: {
        type: "descriptor-decision-mismatch",
        field: "type",
        expected: input.decision.type,
        actual: input.descriptor.identity.type,
      },
    };
  const expectedCategory = descriptorCategoryFor(input.decision);
  if (input.descriptor.identity.category !== expectedCategory)
    return {
      ok: false,
      error: {
        type: "descriptor-decision-mismatch",
        field: "category",
        expected: expectedCategory,
        actual: input.descriptor.identity.category,
      },
    };

  if (input.decision.type === "respond-to-pending-decision") {
    const pending = input.state.pendingDecision;
    if (pending === undefined || pending.id !== input.decision.pendingDecisionId)
      return {
        ok: false,
        error: {
          type: "descriptor-decision-mismatch",
          field: "pending-decision",
          expected: input.decision.pendingDecisionId,
          actual: pending?.id ?? "none",
        },
      };
  }

  const mechanicsReferenceId = mechanicsReferenceIdFor(input.decision);
  const mechanics = mechanicsReferenceFor(input);
  if (mechanicsReferenceId !== undefined && mechanics === undefined)
    return {
      ok: false,
      error: {
        type: "missing-mechanics",
        mechanicsType: mechanicsReferenceId.type,
        mechanicsId: mechanicsReferenceId.id,
      },
    };

  const pending = pendingFactsFor(input);
  const value: AiDecisionFeature = {
    decision: input.decision,
    decisionType: input.decision.type,
    canonicalKey: input.descriptor.key,
    category: input.descriptor.identity.category,
    actionConsumption: input.descriptor.actionConsumption,
    costs: input.descriptor.costs,
    effects: input.descriptor.effects,
    scarcity: input.descriptor.scarcity,
    targets: input.descriptor.targets,
    terminal: input.descriptor.terminal,
    immediateOutcome: input.descriptor.immediateOutcome,
    authoritative: {
      costs: input.descriptor.costs,
      effects: input.descriptor.effects,
      scarcity: input.descriptor.scarcity,
      targets: input.descriptor.targets,
      terminal: input.descriptor.terminal,
      immediateOutcome: input.descriptor.immediateOutcome,
    },
    state: {
      status: "active",
      stateVersion: input.state.version,
      turnNumber: input.state.turnNumber,
      phase: input.state.phase,
      activeCombatantId: input.state.activeCombatantId,
    },
    ...(mechanics === undefined ? {} : { mechanics }),
    ...(pending === undefined ? {} : { pending }),
    ...(pending === undefined ? {} : { pendingSelection: pending }),
  };
  return { ok: true, value };
};

export const extractAiDecisionFeatures = extractDecisionFeatures;
export const extractFeatures = extractDecisionFeatures;
