import { describe, expect, it } from "vitest";

import {
  canonicalDecisionKey,
  type CombatDecisionDescriptor,
  type CombatantId,
  type FightId,
  type FightState,
  type LegalDecision,
  type StrategicContextSummary,
} from "@dragonball-resurgence/combat-engine";

import {
  CONTEXTUAL_EVALUATOR,
  type AiMechanicsView,
  type AiProfile,
  selectLegalDecision,
  selectContextualDecision,
} from "./index.js";
import { createAiRandomSource } from "./random.js";

const actorId = "combatant:context-actor" as CombatantId;
const opponentId = "combatant:context-opponent" as CombatantId;
const profile: AiProfile = {
  identity: { id: "profile:context", version: "profile-context-v1" },
  personality: { version: "personality-context-v1", values: {} },
  difficulty: { version: "difficulty-context-v1", level: "normal" },
};
const mechanics: AiMechanicsView = {
  version: "mechanics-context-v1",
  moves: [],
  items: [],
  transformations: [],
};
const state = (overrides: Partial<FightState> = {}): FightState =>
  ({
    id: "fight:context" as FightId,
    schemaVersion: 4,
    version: 1,
    rulesVersion: { gameData: "game-data-v1", config: "config-v1", engine: "engine-v1" },
    mode: "spar",
    turnNumber: 2,
    combatants: {
      [actorId]: {
        id: actorId,
        hitPoints: { current: 100, maximum: 100 },
        ki: { current: 10, maximum: 10 },
        stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
        moveIds: [],
        moveUses: {},
        activeStatuses: [],
        status: "active",
      },
      [opponentId]: {
        id: opponentId,
        hitPoints: { current: 100, maximum: 100 },
        ki: { current: 10, maximum: 10 },
        stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
        moveIds: [],
        moveUses: {},
        activeStatuses: [],
        status: "active",
      },
    },
    activeEffects: [],
    actionHistory: [],
    resolutionFrames: [],
    scheduledWork: [],
    eventSequence: 0,
    status: "active",
    phase: "action",
    activeCombatantId: actorId,
    ...overrides,
  }) as FightState;

const context = (overrides: Partial<StrategicContextSummary> = {}): StrategicContextSummary =>
  ({
    version: "strategic-context:v1",
    completeness: "complete",
    unknownFacts: [],
    actor: {
      id: actorId,
      hp: { current: 100, maximum: 100, ratio: 1, pressure: 0 },
      ki: { current: 10, maximum: 10, ratio: 1, pressure: 0 },
      status: "active",
      activeStatusCount: 0,
      activeEffectCount: 0,
      activeTransformation: false,
      transformationTurns: 0,
    },
    opponent: {
      id: opponentId,
      hp: { current: 100, maximum: 100, ratio: 1, pressure: 0 },
      ki: { current: 10, maximum: 10, ratio: 1, pressure: 0 },
      status: "active",
      activeStatusCount: 0,
      activeEffectCount: 0,
      activeTransformation: false,
      transformationTurns: 0,
    },
    turn: { number: 2, phase: "action", activeCombatantId: actorId, actorHasInitiative: true },
    pendingWork: { active: false, optionCount: 0, candidateCount: 0, optional: false },
    horizon: { short: 1, medium: 3, long: 6, basis: "bounded-local-1v1-estimate" },
    controlImpacts: [],
    scarcity: [],
    pendingOptions: [],
    ...overrides,
  }) as StrategicContextSummary;

const outcome = (damage = false) => ({
  version: "immediate-outcome:v1" as const,
  completeness: "complete" as const,
  resources: [],
  damage: damage
    ? [
        {
          target: "opponent" as const,
          amount: { minimum: 1, maximum: 1 },
          guaranteedLethality: false,
          possibleLethality: false,
          selfHarm: false,
          timing: "immediate" as const,
          certainty: "guaranteed" as const,
        },
      ]
    : [],
  healing: [],
  defeatPrevention: { guaranteed: false, possible: false, certainty: "unknown" as const },
  actions: {
    free: false,
    extraOwnActions: 0,
    skippedOwnActions: 0,
    skippedOpponentActions: 0,
    response: false,
    delayed: false,
    certainty: "guaranteed" as const,
  },
  unknownFacts: [],
});

const descriptorFor = (
  decision: LegalDecision,
  strategicContext: StrategicContextSummary,
  damage = false,
): CombatDecisionDescriptor => ({
  key: canonicalDecisionKey(decision),
  identity: {
    type: decision.type,
    category:
      decision.type === "basic-attack"
        ? "basic-attack"
        : decision.type === "power-up"
          ? "power-up"
          : (decision.type as CombatDecisionDescriptor["identity"]["category"]),
  },
  actionConsumption: "action",
  costs: [],
  effects: [],
  scarcity: [],
  targets:
    decision.type === "basic-attack"
      ? [{ type: "combatant", combatantId: opponentId, relation: "opponent" }]
      : [],
  terminal: "none",
  immediateOutcome: outcome(damage),
  strategicContext,
  outcomeProbe: { type: "combat-transition", decisionKey: canonicalDecisionKey(decision) },
});

const request = (
  decisions: readonly LegalDecision[],
  contexts: ReadonlyMap<string, StrategicContextSummary>,
  stateOverride: FightState = state(),
) => ({
  state: stateOverride,
  actorId,
  legalDecisions: decisions,
  profile,
  mechanics,
  dependencies: {
    random: createAiRandomSource({
      rootSeed: 12,
      profileVersion: profile.identity.version,
      evaluatorVersion: "combat-context:v1",
      purpose: "test",
    }),
    randomness: "disabled" as const,
  },
  analysis: {
    describeDecision: (_state: FightState, decision: LegalDecision) =>
      descriptorFor(decision, contexts.get(canonicalDecisionKey(decision)) ?? context()),
  },
  diagnosticRetention: "full" as const,
});

describe("contextual utility chooser", () => {
  it("changes ranking for resource pressure while preserving legal identity", () => {
    const powerUp: LegalDecision = { type: "power-up", actorId };
    const attack: LegalDecision = {
      type: "basic-attack",
      actorId,
      basicAttack: "basic-punch",
      targetCombatantId: opponentId,
    };
    const normal = new Map([
      [canonicalDecisionKey(powerUp), context()],
      [canonicalDecisionKey(attack), context()],
    ]);
    const pressured = context({
      actor: {
        ...context().actor,
        ki: { current: 0, maximum: 10, ratio: 0, pressure: 1 },
      },
    });
    const pressuredContexts = new Map(normal).set(canonicalDecisionKey(powerUp), pressured);
    const first = selectContextualDecision(request([powerUp, attack], normal));
    const second = selectContextualDecision(
      request(
        [powerUp, attack],
        pressuredContexts,
        state({
          combatants: {
            ...(state().combatants as object),
            [actorId]: { ...state().combatants[actorId], ki: { current: 0, maximum: 10 } },
          },
        }),
      ),
    );
    expect(first.ok && first.value.decision).toBe(attack);
    expect(second.ok && second.value.decision).toBe(powerUp);
    if (second.ok) expect(second.value.decision).toBe(powerUp);
  });

  it("routes every candidate through the contextual factor and diagnostic identity", () => {
    const pass: LegalDecision = { type: "pass", actorId };
    const result = selectContextualDecision(
      request([pass], new Map([[canonicalDecisionKey(pass), context()]])),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.diagnostics?.evaluator).toEqual(CONTEXTUAL_EVALUATOR);
    expect(
      result.value.evaluations[0]?.scoreFactors.some((factor) => factor.code === "state-horizon"),
    ).toBe(true);
  });

  it("uses contextual selection through the public chooser when descriptors are available", () => {
    const pass: LegalDecision = { type: "pass", actorId };
    const result = selectLegalDecision(
      request([pass], new Map([[canonicalDecisionKey(pass), context()]])),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.diagnostics?.evaluator).toEqual(CONTEXTUAL_EVALUATOR);
  });
});
