import { describe, expect, it } from "vitest";

import {
  canonicalDecisionKey,
  type CombatDecisionDescriptor,
  type FightId,
  type LegalDecision,
  type PendingDecision,
  type CombatantId,
  pendingDecisionIdSchema,
} from "@dragonball-resurgence/combat-engine";

import {
  extractDecisionFeatures,
  type AiFeatureExtractionInput,
  type AiMechanicsView,
} from "./index.js";

const attackerId = "combatant:attacker" as CombatantId;
const defenderId = "combatant:defender" as CombatantId;

const mechanics: AiMechanicsView = {
  version: "mechanics-v1",
  moves: [{ id: "move:test", category: "advanced-attack", tags: ["physical"], mechanics: {} }],
  items: [
    {
      id: "item:test",
      category: "consumable",
      usePolicy: { timing: "action" },
      inventorySlots: 1,
      effects: [],
      rules: [],
    },
  ],
  transformations: [
    {
      id: "transformation:test",
      raceId: "race:human",
      tier: 1,
      statModifiers: { powerPercent: 10, hpPercent: 10, dexterityPercent: 10 },
      abilities: { novice: {}, intermediate: {}, mastered: {} },
    },
  ],
};

const stateFor = (pendingDecision?: PendingDecision) =>
  ({
    id: "fight:fixture" as FightId,
    schemaVersion: 4 as const,
    version: 7,
    rulesVersion: { gameData: "game-data-v1", config: "config-v1", engine: "engine-v1" },
    mode: "spar" as const,
    turnNumber: 3,
    combatants: {
      [attackerId]: { id: attackerId },
      [defenderId]: { id: defenderId },
    },
    activeEffects: [],
    actionHistory: [],
    resolutionFrames: [],
    scheduledWork: [],
    eventSequence: 0,
    status: "active" as const,
    phase: "action" as const,
    activeCombatantId: attackerId,
    ...(pendingDecision === undefined ? {} : { pendingDecision }),
  }) as unknown as AiFeatureExtractionInput["state"];

const descriptorFor = (
  decision: LegalDecision,
  overrides: Partial<CombatDecisionDescriptor> = {},
): CombatDecisionDescriptor => ({
  key: canonicalDecisionKey(decision),
  identity: {
    type: decision.type,
    category:
      decision.type === "use-move"
        ? "move"
        : decision.type === "use-item"
          ? "item"
          : decision.type === "activate-transformation" ||
              decision.type === "deactivate-transformation"
            ? "transformation"
            : decision.type === "respond-to-pending-decision"
              ? "pending-response"
              : decision.type,
  },
  actionConsumption: decision.type === "respond-to-pending-decision" ? "response" : "action",
  costs: [],
  effects: [],
  scarcity: [],
  targets: [],
  terminal: decision.type === "surrender" ? "surrender-loss" : "none",
  immediateOutcome: {
    version: "immediate-outcome:v1",
    completeness: "complete",
    resources: [],
    damage: [],
    healing: [],
    defeatPrevention: { guaranteed: false, possible: false, certainty: "unknown" },
    actions: {
      free: decision.type === "respond-to-pending-decision",
      extraOwnActions: 0,
      skippedOwnActions: 0,
      skippedOpponentActions: 0,
      response: decision.type === "respond-to-pending-decision",
      delayed: false,
      certainty: "guaranteed",
    },
    unknownFacts: [],
  },
  outcomeProbe: { type: "combat-transition", decisionKey: canonicalDecisionKey(decision) },
  ...overrides,
});

const inputFor = (
  decision: LegalDecision,
  state = stateFor(),
  overrides: Partial<CombatDecisionDescriptor> = {},
): AiFeatureExtractionInput => ({
  state,
  decision,
  descriptor: descriptorFor(decision, overrides),
  mechanics,
});

describe("AI decision feature extraction", () => {
  it("extracts every ordinary decision category without deriving mechanics", () => {
    const decisions: readonly LegalDecision[] = [
      { type: "pass", actorId: attackerId },
      { type: "power-up", actorId: attackerId },
      { type: "surrender", actorId: attackerId },
      {
        type: "basic-attack",
        actorId: attackerId,
        basicAttack: "basic-punch",
        targetCombatantId: defenderId,
      },
      { type: "use-move", actorId: attackerId, moveId: "move:test", targetCombatantId: defenderId },
      {
        type: "activate-transformation",
        actorId: attackerId,
        transformationId: "transformation:test",
      },
      { type: "deactivate-transformation", actorId: attackerId },
      { type: "use-item", actorId: attackerId, itemId: "item:test" },
    ];

    for (const decision of decisions) {
      const result = extractDecisionFeatures(inputFor(decision));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.decision).toBe(decision);
        expect(result.value.canonicalKey).toBe(canonicalDecisionKey(decision));
        expect(result.value.authoritative.costs).toEqual([]);
      }
    }

    const surrenderResult = extractDecisionFeatures(inputFor(decisions[2]));
    expect(surrenderResult).toMatchObject({
      value: { category: "surrender", authoritative: { terminal: "surrender-loss" } },
    });
    const moveResult = extractDecisionFeatures(inputFor(decisions[4]));
    expect(moveResult).toMatchObject({
      value: {
        mechanics: {
          type: "move",
          id: "move:test",
          category: "advanced-attack",
          tags: ["physical"],
        },
      },
    });
    const transformationResult = extractDecisionFeatures(inputFor(decisions[5]));
    expect(transformationResult).toMatchObject({
      value: {
        mechanics: {
          type: "transformation",
          id: "transformation:test",
          raceId: "race:human",
          tier: 1,
        },
      },
    });
    const itemResult = extractDecisionFeatures(inputFor(decisions[7]));
    expect(itemResult).toMatchObject({
      value: { mechanics: { type: "item", id: "item:test", category: "consumable" } },
    });
  });

  it.each([
    ["one", false],
    ["up-to", true],
    ["all", true],
  ] as const)("preserves %s pending selection facts", (selectionType, optional) => {
    const pending = {
      id: pendingDecisionIdSchema.parse("pending-decision:select-move"),
      stateVersion: 7,
      combatantId: attackerId,
      type: "select-move",
      optional,
      selection:
        selectionType === "one"
          ? { type: "one" }
          : selectionType === "up-to"
            ? { type: "up-to", limit: { type: "literal", value: 2 } }
            : { type: "all" },
      options: [
        { id: "candidate:first", type: "select-move", moveId: "move:test" },
        { id: "candidate:second", type: "select-move", moveId: "move:test" },
      ],
    } satisfies PendingDecision;
    const decision: LegalDecision = {
      type: "respond-to-pending-decision",
      actorId: attackerId,
      pendingDecisionId: pending.id,
      optionId: "candidate:first",
      selectedOptionIds: optional ? ["candidate:first", "candidate:second"] : ["candidate:first"],
    };
    const result = extractDecisionFeatures(
      inputFor(decision, stateFor(pending), {
        selection: {
          pendingDecisionId: pending.id,
          type: selectionType,
          candidateIds: ["move:move:test", "move:move:test"],
          optional,
          selectedOptionIds: decision.selectedOptionIds,
        },
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        category: "pending-response",
        pending: {
          pendingType: "select-move",
          optionIds: ["candidate:first", "candidate:second"],
          selectedOptionIds: decision.selectedOptionIds,
          optional,
          selection: {
            pendingDecisionId: pending.id,
            type: selectionType,
            candidateIds: ["move:move:test", "move:move:test"],
            optional,
            selectedOptionIds: decision.selectedOptionIds,
          },
        },
      },
    });
  });

  it("rejects stale descriptors and missing referenced mechanics", () => {
    const pass: LegalDecision = { type: "pass", actorId: attackerId };
    expect(extractDecisionFeatures(inputFor(pass, stateFor(), { key: "stale-key" }))).toMatchObject(
      { ok: false, error: { type: "descriptor-decision-mismatch", field: "key" } },
    );

    const move: LegalDecision = {
      type: "use-move",
      actorId: attackerId,
      moveId: "move:missing",
      targetCombatantId: defenderId,
    };
    expect(extractDecisionFeatures(inputFor(move))).toMatchObject({
      ok: false,
      error: { type: "missing-mechanics", mechanicsType: "move", mechanicsId: "move:missing" },
    });
  });

  it("does not call outcome probes or mutate supplied inputs", () => {
    const decision: LegalDecision = { type: "pass", actorId: attackerId };
    const state = stateFor();
    const descriptor = descriptorFor(decision);
    const input = { state, decision, descriptor, mechanics };
    const snapshot = JSON.stringify(input);

    const result = extractDecisionFeatures(input);

    expect(result.ok).toBe(true);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
