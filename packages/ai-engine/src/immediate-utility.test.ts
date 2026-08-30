import { describe, expect, it } from "vitest";

import type {
  CombatDecisionDescriptor,
  CombatantId,
  FightId,
  FightState,
  LegalDecision,
  ImmediateOutcomeSummary,
} from "@dragonball-resurgence/combat-engine";

import {
  type AiImmediateUtilityRequest,
  type AiMechanicsView,
  type AiProfile,
  selectImmediateUtilityDecision,
} from "./index.js";
import { canonicalDecisionKey } from "@dragonball-resurgence/combat-engine";
import { createAiRandomSource } from "./random.js";

const actorId = "combatant:actor" as CombatantId;
const opponentId = "combatant:opponent" as CombatantId;
const profile: AiProfile = {
  identity: { id: "profile:test", version: "profile-test-v1" },
  personality: { version: "personality-test-v1", values: {} },
  difficulty: { version: "difficulty-test-v1", level: "normal" },
};
const mechanics: AiMechanicsView = {
  version: "mechanics-test-v1",
  moves: [],
  items: [],
  transformations: [],
};
const state = {
  id: "fight:utility-test" as FightId,
  schemaVersion: 4 as const,
  version: 4,
  rulesVersion: { gameData: "game-data-v1", config: "config-v1", engine: "engine-v1" },
  mode: "spar" as const,
  turnNumber: 2,
  combatants: {
    [actorId]: {
      id: actorId,
      hitPoints: { current: 25, maximum: 100 },
      ki: { current: 2, maximum: 10 },
      stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
      moveIds: [],
      moveUses: {},
      activeStatuses: [],
      status: "active" as const,
    },
    [opponentId]: {
      id: opponentId,
      hitPoints: { current: 100, maximum: 100 },
      ki: { current: 8, maximum: 10 },
      stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
      moveIds: [],
      moveUses: {},
      activeStatuses: [],
      status: "active" as const,
    },
  },
  activeEffects: [],
  actionHistory: [],
  resolutionFrames: [],
  scheduledWork: [],
  eventSequence: 0,
  status: "active" as const,
  phase: "action" as const,
  activeCombatantId: actorId,
} as unknown as AiImmediateUtilityRequest["state"];

const emptySummary = (
  overrides: Partial<ImmediateOutcomeSummary> = {},
): ImmediateOutcomeSummary => ({
  version: "immediate-outcome:v1",
  completeness: "complete",
  resources: [],
  damage: [],
  healing: [],
  defeatPrevention: { guaranteed: false, possible: false, certainty: "unknown" },
  actions: {
    free: false,
    extraOwnActions: 0,
    skippedOwnActions: 0,
    skippedOpponentActions: 0,
    response: false,
    delayed: false,
    certainty: "guaranteed",
  },
  unknownFacts: [],
  ...overrides,
});

const descriptorFor = (
  decision: LegalDecision,
  immediateOutcome = emptySummary(),
): CombatDecisionDescriptor => ({
  key: canonicalDecisionKey(decision),
  identity: {
    type: decision.type,
    category:
      decision.type === "basic-attack"
        ? "basic-attack"
        : decision.type === "use-move"
          ? "move"
          : (decision.type as CombatDecisionDescriptor["identity"]["category"]),
  },
  actionConsumption: "action",
  costs: [],
  effects: [],
  scarcity: [],
  targets:
    decision.type === "basic-attack" || decision.type === "use-move"
      ? [{ type: "combatant", combatantId: decision.targetCombatantId, relation: "opponent" }]
      : [],
  terminal: decision.type === "surrender" ? "surrender-loss" : "none",
  immediateOutcome,
  outcomeProbe: { type: "combat-transition", decisionKey: canonicalDecisionKey(decision) },
});

const requestFor = (
  decisions: readonly LegalDecision[],
  describeDecision: AiImmediateUtilityRequest["analysis"]["describeDecision"],
  retention: AiImmediateUtilityRequest["diagnosticRetention"] = "full",
  suppliedMechanics = mechanics,
): AiImmediateUtilityRequest => ({
  state,
  actorId,
  legalDecisions: decisions,
  profile,
  mechanics: suppliedMechanics,
  dependencies: {
    random: createAiRandomSource({
      rootSeed: 17,
      profileVersion: profile.identity.version,
      evaluatorVersion: "baseline-immediate:v1",
      purpose: "test",
    }),
    randomness: "disabled",
  },
  analysis: { describeDecision },
  diagnosticRetention: retention,
});

describe("immediate utility chooser", () => {
  it("prefers a guaranteed KO and preserves the exact supplied legal object", () => {
    const pass: LegalDecision = { type: "pass", actorId };
    const finishingAttack: LegalDecision = {
      type: "basic-attack",
      actorId,
      basicAttack: "basic-punch",
      targetCombatantId: opponentId,
    };
    const result = selectImmediateUtilityDecision(
      requestFor([pass, finishingAttack], (_suppliedState: FightState, decision) =>
        descriptorFor(
          decision,
          decision.type === "basic-attack"
            ? emptySummary({
                damage: [
                  {
                    target: "opponent",
                    amount: { minimum: 100, maximum: 100 },
                    guaranteedLethality: true,
                    possibleLethality: true,
                    overkill: { minimum: 0, maximum: 0 },
                    selfHarm: false,
                    timing: "immediate",
                    certainty: "guaranteed",
                  },
                ],
              })
            : emptySummary(),
        ),
      ),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision).toBe(finishingAttack);
    expect(result.value.evaluations[0]?.scoreFactors.map((factor) => factor.code)).toContain(
      "guaranteed-win",
    );
    expect(result.value.evaluations[0]?.totalScore).toBe(
      result.value.evaluations[0]?.scoreFactors.reduce((total, factor) => total + factor.value, 0),
    );
  });

  it("lets guaranteed defeat prevention outrank greedy immediate damage", () => {
    const damage: LegalDecision = {
      type: "basic-attack",
      actorId,
      basicAttack: "basic-punch",
      targetCombatantId: opponentId,
    };
    const defense: LegalDecision = { type: "pass", actorId };
    const result = selectImmediateUtilityDecision(
      requestFor([damage, defense], (_suppliedState: FightState, decision) =>
        descriptorFor(
          decision,
          decision.type === "basic-attack"
            ? emptySummary({
                damage: [
                  {
                    target: "opponent",
                    amount: { minimum: 0, maximum: 100 },
                    guaranteedLethality: false,
                    possibleLethality: true,
                    selfHarm: false,
                    timing: "immediate",
                    certainty: "possible",
                  },
                ],
              })
            : emptySummary({
                defeatPrevention: { guaranteed: true, possible: true, certainty: "guaranteed" },
              }),
        ),
      ),
    );

    expect(result.ok && result.value.decision).toBe(defense);
  });

  it("penalizes low-resource spending, rejects descriptor drift, and keeps retention observational", () => {
    const cheap: LegalDecision = {
      type: "use-move",
      actorId,
      moveId: "move:cheap",
      targetCombatantId: opponentId,
    };
    const expensive: LegalDecision = {
      type: "use-move",
      actorId,
      moveId: "move:expensive",
      targetCombatantId: opponentId,
    };
    const suppliedMechanics: AiMechanicsView = {
      ...mechanics,
      moves: [
        {
          id: "move:cheap",
          category: "advanced-attack",
          tags: [],
          mechanics: {},
          kiCost: 1,
          restrictedUses: undefined,
          attack: undefined,
        },
        {
          id: "move:expensive",
          category: "advanced-attack",
          tags: [],
          mechanics: {},
          kiCost: 5,
          restrictedUses: undefined,
          attack: undefined,
        },
      ],
    };
    const describe = (_suppliedState: FightState, decision: LegalDecision) =>
      descriptorFor(
        decision,
        emptySummary({
          resources: [
            {
              target: "self",
              resource: "ki",
              operation: "cost",
              declared: decision.type === "use-move" && decision.moveId === "cheap" ? 1 : 5,
              effective: decision.type === "use-move" && decision.moveId === "cheap" ? 1 : 5,
              amount: {
                minimum: decision.type === "use-move" && decision.moveId === "cheap" ? 1 : 5,
                maximum: decision.type === "use-move" && decision.moveId === "cheap" ? 1 : 5,
              },
              overflow: { minimum: 0, maximum: 0 },
              timing: "immediate",
              certainty: "guaranteed",
            },
          ],
        }),
      );
    const none = selectImmediateUtilityDecision(
      requestFor([cheap, expensive], describe, "none", suppliedMechanics),
    );
    const full = selectImmediateUtilityDecision(
      requestFor([expensive, cheap], describe, "full", suppliedMechanics),
    );
    expect(none.ok && none.value.decision).toBe(cheap);
    expect(full.ok && full.value.decision).toBe(cheap);
    if (full.ok) expect(full.value.diagnostics?.schemaVersion).toBe("ai-decision-diagnostics:v1");

    const stale = selectImmediateUtilityDecision(
      requestFor(
        [cheap],
        (_suppliedState, decision) =>
          ({
            ...descriptorFor(decision),
            immediateOutcome: undefined,
          }) as unknown as CombatDecisionDescriptor,
      ),
    );
    expect(stale).toMatchObject({
      ok: false,
      error: { type: "candidate-analysis-failure", reason: "incomplete-required-facts" },
    });
  });

  it("rejects duplicate candidates and candidates owned by another actor", () => {
    const pass: LegalDecision = { type: "pass", actorId };
    const duplicate = selectImmediateUtilityDecision(
      requestFor([pass, pass], (_suppliedState, decision) => descriptorFor(decision)),
    );
    expect(duplicate).toMatchObject({
      ok: false,
      error: { type: "duplicate-candidate", duplicateIndex: 1 },
    });

    const foreign: LegalDecision = { type: "pass", actorId: opponentId };
    const mismatch = selectImmediateUtilityDecision(
      requestFor([foreign], (_suppliedState, decision) => descriptorFor(decision)),
    );
    expect(mismatch).toMatchObject({
      ok: false,
      error: { type: "candidate-actor-mismatch", candidateIndex: 0 },
    });
  });
});
