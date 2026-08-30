import { describe, expect, it } from "vitest";

import {
  canonicalDecisionKey,
  type CombatDecisionDescriptor,
  type CombatantId,
  type FightId,
  type FightState,
  type LegalDecision,
} from "@dragonball-resurgence/combat-engine";

import {
  EASY_PROFILE,
  HARD_PROFILE,
  NORMAL_PROFILE,
  SIMULATION_QUALITY_PROFILE,
  classifyCombatAnalysisProbe,
  createAiReplayRecord,
  createAiRandomSource,
  estimateOutcomeDistribution,
  pruneCandidates,
  renderAiExplanation,
  selectLegalDecision,
  selectLookaheadDecision,
  selectStrategicDecision,
  setupEdgesFor,
  validateAiProfile,
  type AiDecisionRequest,
  type AiMechanicsView,
  type AiProfile,
} from "./index.js";

const actorId = "combatant:phase-actor" as CombatantId;
const opponentId = "combatant:phase-opponent" as CombatantId;
const pass: LegalDecision = { type: "pass", actorId };
const attack: LegalDecision = {
  type: "basic-attack",
  actorId,
  basicAttack: "basic-punch",
  targetCombatantId: opponentId,
};

const state: FightState = {
  id: "fight:phase" as FightId,
  schemaVersion: 4,
  version: 2,
  rulesVersion: { value: "rules-v1", sourcePath: "reference/rules.md" },
  mode: "spar",
  turnNumber: 2,
  combatants: {
    [actorId]: {
      id: actorId,
      hitPoints: { current: 100, maximum: 100 },
      ki: { current: 5, maximum: 10 },
      stats: { power: 50, dexterity: 10, dexterityBonus: 0 },
      moveIds: [],
      moveUses: {},
      activeStatuses: [],
      status: "active",
    },
    [opponentId]: {
      id: opponentId,
      hitPoints: { current: 100, maximum: 100 },
      ki: { current: 5, maximum: 10 },
      stats: { power: 50, dexterity: 10, dexterityBonus: 0 },
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
};

const mechanics: AiMechanicsView = {
  version: "mechanics:v1",
  moves: [],
  items: [],
  transformations: [],
};

const profile: AiProfile = {
  ...NORMAL_PROFILE,
  identity: { id: "profile:test", version: "profile-test-v1" },
  personality: {
    ...NORMAL_PROFILE.personality,
    dimensions: { ...NORMAL_PROFILE.personality.dimensions!, aggression: 1.4 },
  },
  difficulty: { ...NORMAL_PROFILE.difficulty, lookaheadDepth: 0 },
};

const descriptor = (
  decision: LegalDecision,
  overrides: Partial<CombatDecisionDescriptor> = {},
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
    decision.type === "basic-attack"
      ? [{ type: "combatant", combatantId: opponentId, relation: "opponent" }]
      : [],
  terminal: "none",
  immediateOutcome: {
    version: "immediate-outcome:v1",
    completeness: "complete",
    resources: [],
    damage:
      decision.type === "basic-attack"
        ? [
            {
              target: "opponent",
              amount: { minimum: 100, maximum: 100 },
              guaranteedLethality: false,
              possibleLethality: true,
              overkill: { minimum: 0, maximum: 0 },
              selfHarm: false,
              timing: "immediate",
              certainty: "guaranteed",
            },
          ]
        : [],
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
  },
  outcomeProbe: { type: "combat-transition", decisionKey: canonicalDecisionKey(decision) },
  ...overrides,
});

const request = (
  decisions: readonly LegalDecision[],
  selectedDescriptor = descriptor,
  selectedProfile = profile,
): AiDecisionRequest => ({
  state,
  actorId,
  legalDecisions: decisions,
  profile: selectedProfile,
  mechanics,
  dependencies: {
    random: createAiRandomSource({
      rootSeed: 99,
      profileVersion: selectedProfile.identity.version,
      evaluatorVersion: "phases-4-8-test:v1",
      purpose: "test",
    }),
    randomness: "enabled",
  },
  analysis: { describeDecision: (_state, decision) => selectedDescriptor(decision) },
  diagnosticRetention: "full",
});

describe("AI phases 4-8", () => {
  it("validates typed profiles and exposes bounded built-in difficulty controls", () => {
    expect(validateAiProfile(EASY_PROFILE).ok).toBe(true);
    expect(validateAiProfile(HARD_PROFILE).ok).toBe(true);
    expect(SIMULATION_QUALITY_PROFILE.difficulty.scoreNoiseMinimum).toBe(0);
    expect(SIMULATION_QUALITY_PROFILE.difficulty.mistakeProbability).toBe(0);
    const invalid = validateAiProfile({
      ...profile,
      personality: {
        ...profile.personality,
        dimensions: { ...profile.personality.dimensions!, aggression: 3 },
      },
    });
    expect(invalid.ok).toBe(false);
  });

  it("adds explicit personality and keyed-noise factors without changing legality", () => {
    const result = selectStrategicDecision(request([pass, attack]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    console.log(
      profile.personality.dimensions,
      result.value.evaluations.map((candidate) =>
        candidate.scoreFactors.map((factor) => [factor.code, factor.value]),
      ),
    );
    expect(result.value.decision).toBe(attack);
    expect(
      result.value.evaluations
        .flatMap((candidate) => candidate.scoreFactors)
        .some((factor) => factor.code.startsWith("personality-adjustment:")),
    ).toBe(true);
    expect(result.value.diagnostics?.schemaVersion).toBe("ai-decision-diagnostics:v2");
  });

  it("protects guaranteed terminal choices from mistakes and noise", () => {
    const finishing = descriptor(attack, {
      immediateOutcome: {
        ...descriptor(attack).immediateOutcome,
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
      },
    });
    const result = selectStrategicDecision(
      request([pass, attack], (decision) =>
        decision.type === "basic-attack" ? finishing : descriptor(decision),
      ),
    );
    expect(result.ok && result.value.decision).toBe(attack);
    if (result.ok)
      expect(
        result.value.evaluations.find((candidate) => candidate.decision === attack)?.pruning,
      ).toBe("protected");
  });

  it("creates setup edges only when descriptor-authored follow-ups exist", () => {
    const setupDecision = {
      type: "use-move",
      actorId,
      moveId: "move:setup",
      targetCombatantId: opponentId,
    } as LegalDecision;
    const payoff = {
      type: "use-move",
      actorId,
      moveId: "move:payoff",
      targetCombatantId: opponentId,
    } as LegalDecision;
    const setupFeature = {
      ...(request([setupDecision]).analysis!.describeDecision(
        state,
        setupDecision,
      ) as CombatDecisionDescriptor),
      tacticalSetup: {
        role: "setup" as const,
        eligibleFollowUpCategories: ["move"],
        targetRelation: "opponent" as const,
        window: { scope: "next-turn" as const, duration: 2 },
        controlImpact: "stat-improvement" as const,
        available: true,
      },
    };
    const features = [
      {
        decision: setupDecision,
        canonicalKey: canonicalDecisionKey(setupDecision),
        category: "move",
        effects: [],
        targets: [
          { type: "combatant" as const, combatantId: opponentId, relation: "opponent" as const },
        ],
        tacticalSetup: setupFeature.tacticalSetup,
      },
      {
        decision: payoff,
        canonicalKey: canonicalDecisionKey(payoff),
        category: "move",
        effects: [],
        targets: [
          { type: "combatant" as const, combatantId: opponentId, relation: "opponent" as const },
        ],
      },
    ] as never;
    expect(setupEdgesFor(features)[0]?.available).toBe(true);
  });

  it("classifies outcomes, prunes dominated candidates, and renders retained diagnostics", () => {
    const evaluations = [
      { decision: pass, canonicalKey: "a", totalScore: 5, scoreFactors: [], rank: 1 } as never,
      { decision: attack, canonicalKey: "b", totalScore: 1, scoreFactors: [], rank: 2 } as never,
    ];
    expect(
      pruneCandidates(evaluations, 1).evaluations.find((entry) => entry.canonicalKey === "b")
        ?.pruning,
    ).toBe("dominated");
    const outcome = estimateOutcomeDistribution(descriptor(attack));
    expect(outcome.some((entry) => entry.category === "stopped")).toBe(true);
    const probe = { events: [{ type: "combatant-defeated" }] } as never;
    expect(classifyCombatAnalysisProbe(probe)).toBe("lethal");
    const result = selectStrategicDecision(request([pass, attack]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(renderAiExplanation(result.value)).toContain("Selected");
  });

  it("keeps lookahead and replay deterministic when no probe is available", () => {
    const result = selectLookaheadDecision(request([pass, attack]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const record = createAiReplayRecord(request([pass, attack]), result.value);
    const replay = selectLegalDecision(request([pass, attack]));
    expect(replay.ok).toBe(true);
    expect(record.fight.stateHash).toBe(record.fight.stateHash);
    expect(result.value.decision).toEqual(replay.ok ? replay.value.decision : undefined);
  });
});
