import { describe, expect, it } from "vitest";

import type { CreateFightInput, FightState } from "./index.js";
import { createFight } from "./index.js";
import {
  activeEffectIdSchema,
  combatantIdSchema,
  combatDecisionIdSchema,
  combatEventIdSchema,
  fightIdSchema,
  pendingDecisionIdSchema,
  resolutionFrameIdSchema,
} from "./ids.js";
import { validateFightState } from "./invariants.js";
import { createTestCombatDependencies } from "./testing/index.js";

const firstCombatantId = combatantIdSchema.parse("combatant:goku");
const secondCombatantId = combatantIdSchema.parse("combatant:vegeta");

const input: CreateFightInput = {
  mode: "spar",
  combatants: [
    {
      maximumHitPoints: 150,
      stats: { power: 20, dexterity: 4, dexterityBonus: 1 },
      moveIds: ["move-freestyle-hidden-power-level"],
    },
    {
      maximumHitPoints: 125,
      stats: { power: 18, dexterity: 5, dexterityBonus: 2 },
      moveIds: ["move-afterlife-give-me-energy"],
    },
  ],
};

const createDependencies = () =>
  createTestCombatDependencies([], new Date("2026-08-04T12:00:00.000Z"), {
    fightIds: [fightIdSchema.parse("fight:opening-spar")],
    combatantIds: [firstCombatantId, secondCombatantId],
    eventIds: [
      combatEventIdSchema.parse("event:fight-started"),
      combatEventIdSchema.parse("event:turn-started"),
    ],
  });

describe("createFight", () => {
  it("creates a deterministic, valid initial 1v1 state without mutating setup input", () => {
    const originalInput = structuredClone(input);
    const result = createFight(input, createDependencies());

    expect(result).toEqual({
      ok: true,
      value: {
        state: {
          id: fightIdSchema.parse("fight:opening-spar"),
          version: 0,
          rulesVersion: { value: "legacy-reference-2026-08", sourcePath: "reference/rules.md" },
          mode: "spar",
          status: "active",
          turnNumber: 1,
          phase: "upkeep",
          activeCombatantId: secondCombatantId,
          activeEffects: [],
          actionHistory: [],
          resolutionFrames: [],
          combatants: {
            [firstCombatantId]: {
              id: firstCombatantId,
              hitPoints: { current: 150, maximum: 150 },
              ki: { current: 5, maximum: 10 },
              stats: { power: 20, dexterity: 4, dexterityBonus: 1 },
              moveIds: ["move-freestyle-hidden-power-level"],
              slotCapacities: {
                mastery: 1,
                skill: 4,
                "advanced-attack": 5,
                signature: 2,
                block: 2,
              },
              slotCapacityModifications: [],
              moveUses: {},
              moveUseLimitModifiers: {},
              storedRolls: {},
              itemUses: {},
              activeStatuses: [],
              status: "active",
            },
            [secondCombatantId]: {
              id: secondCombatantId,
              hitPoints: { current: 125, maximum: 125 },
              ki: { current: 5, maximum: 10 },
              stats: { power: 18, dexterity: 5, dexterityBonus: 2 },
              moveIds: ["move-afterlife-give-me-energy"],
              slotCapacities: {
                mastery: 1,
                skill: 4,
                "advanced-attack": 5,
                signature: 2,
                block: 2,
              },
              slotCapacityModifications: [],
              moveUses: {},
              moveUseLimitModifiers: {},
              storedRolls: {},
              itemUses: {},
              activeStatuses: [],
              status: "active",
            },
          },
          eventSequence: 2,
        },
        events: expect.arrayContaining([
          {
            id: combatEventIdSchema.parse("event:fight-started"),
            sequence: 1,
            fightId: fightIdSchema.parse("fight:opening-spar"),
            type: "fight-started",
            mode: "spar",
          },
          {
            id: combatEventIdSchema.parse("event:turn-started"),
            sequence: 2,
            fightId: fightIdSchema.parse("fight:opening-spar"),
            type: "turn-started",
            combatantId: secondCombatantId,
            turnNumber: 1,
          },
        ]),
      },
    });
    expect(input).toEqual(originalInput);
  });

  it("rejects malformed setup before consuming fight IDs", () => {
    const result = createFight(
      {
        ...input,
        unexpected: true,
        combatants: [input.combatants[0]],
      },
      createDependencies(),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        type: "invalid-fight-setup",
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "" }),
          expect.objectContaining({ path: "combatants" }),
        ]),
      },
    });
  });

  it("materializes passive move-slot capacity modifiers in the initial state", () => {
    const result = createFight(
      {
        ...input,
        combatants: [
          { ...input.combatants[0], moveIds: ["move-aoyosumu-technique-mastery"] },
          input.combatants[1],
        ],
      },
      createDependencies(),
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        state: {
          combatants: {
            [firstCombatantId]: {
              slotCapacities: { skill: 5 },
              slotCapacityModifications: [
                {
                  sourceDefinitionId: "move-aoyosumu-technique-mastery",
                  sourceEffectIndex: 0,
                  slot: "skill",
                  amount: 1,
                },
              ],
            },
          },
        },
      },
    });
    if (!result.ok) throw new Error("Expected the capacity-modifier fight to be valid.");
    expect(validateFightState(result.value.state)).toEqual([]);
    expect(result.value.state.version).toBe(0);
  });

  it("uses injected 1d100 rolls to resolve equal-Dexterity initiative", () => {
    const result = createFight(
      {
        ...input,
        combatants: [
          { ...input.combatants[0], stats: { ...input.combatants[0].stats, dexterity: 4 } },
          { ...input.combatants[1], stats: { ...input.combatants[1].stats, dexterity: 4 } },
        ],
      },
      createTestCombatDependencies([12, 82], new Date("2026-08-04T12:00:00.000Z"), {
        fightIds: [fightIdSchema.parse("fight:tied-initiative")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: [
          combatEventIdSchema.parse("event:fight-started"),
          combatEventIdSchema.parse("event:initiative-first"),
          combatEventIdSchema.parse("event:initiative-second"),
          combatEventIdSchema.parse("event:turn-started"),
        ],
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        state: { activeCombatantId: secondCombatantId, eventSequence: 4 },
        events: expect.arrayContaining([
          expect.objectContaining({ type: "fight-started", sequence: 1 }),
          expect.objectContaining({
            type: "initiative-rolled",
            combatantId: firstCombatantId,
            naturalResult: 12,
            sequence: 2,
          }),
          expect.objectContaining({
            type: "initiative-rolled",
            combatantId: secondCombatantId,
            naturalResult: 82,
            sequence: 3,
          }),
          expect.objectContaining({ type: "turn-started", sequence: 4 }),
        ]),
      },
    });
  });

  it("rerolls an equal initiative tie until one combatant wins", () => {
    const result = createFight(
      {
        ...input,
        combatants: [
          { ...input.combatants[0], stats: { ...input.combatants[0].stats, dexterity: 4 } },
          { ...input.combatants[1], stats: { ...input.combatants[1].stats, dexterity: 4 } },
        ],
      },
      createTestCombatDependencies([40, 40, 3, 4], new Date("2026-08-04T12:00:00.000Z"), {
        fightIds: [fightIdSchema.parse("fight:rerolled-initiative")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 6 }, (_, index) =>
          combatEventIdSchema.parse(`event:initiative-reroll-${index + 1}`),
        ),
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        state: { activeCombatantId: secondCombatantId, eventSequence: 6 },
        events: expect.arrayContaining([
          expect.objectContaining({ type: "initiative-rolled", naturalResult: 40 }),
          expect.objectContaining({ type: "initiative-rolled", naturalResult: 40 }),
          expect.objectContaining({ type: "initiative-rolled", naturalResult: 3 }),
          expect.objectContaining({ type: "initiative-rolled", naturalResult: 4 }),
        ]),
      },
    });
  });

  it("rejects duplicate moves in a combatant's initial move list", () => {
    const result = createFight(
      {
        ...input,
        combatants: [
          {
            ...input.combatants[0],
            moveIds: ["move-freestyle-hidden-power-level", "move-freestyle-hidden-power-level"],
          },
          input.combatants[1],
        ],
      },
      createDependencies(),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        type: "invalid-fight-setup",
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "combatants.0.moveIds.1" }),
        ]),
      },
    });
  });

  it("accepts the configured negative Dexterity Bonus range and rejects values above it", () => {
    const negativeBonusResult = createFight(
      {
        ...input,
        combatants: [
          { ...input.combatants[0], stats: { ...input.combatants[0].stats, dexterityBonus: -4 } },
          input.combatants[1],
        ],
      },
      createDependencies(),
    );
    const excessiveBonusResult = createFight(
      {
        ...input,
        combatants: [
          { ...input.combatants[0], stats: { ...input.combatants[0].stats, dexterityBonus: 6 } },
          input.combatants[1],
        ],
      },
      createDependencies(),
    );

    expect(negativeBonusResult.ok).toBe(true);
    expect(excessiveBonusResult).toMatchObject({
      ok: false,
      error: {
        type: "invalid-fight-setup",
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "combatants.0.stats.dexterityBonus" }),
        ]),
      },
    });
  });

  it("rejects a move ID that is not present in converted game data", () => {
    const result = createFight(
      {
        ...input,
        combatants: [
          { ...input.combatants[0], moveIds: ["move-not-converted"] },
          input.combatants[1],
        ],
      },
      createDependencies(),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        type: "invalid-fight-setup",
        issues: expect.arrayContaining([
          expect.objectContaining({
            path: "combatants.0.moveIds.0",
            message: expect.stringContaining("Unknown move ID"),
          }),
        ]),
      },
    });
  });

  it("returns a typed state failure when an ID source produces duplicate combatant IDs", () => {
    const result = createFight(
      input,
      createTestCombatDependencies([], new Date("2026-08-04T12:00:00.000Z"), {
        fightIds: [fightIdSchema.parse("fight:opening-spar")],
        combatantIds: [firstCombatantId, firstCombatantId],
        eventIds: [
          combatEventIdSchema.parse("event:fight-started"),
          combatEventIdSchema.parse("event:turn-started"),
        ],
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        type: "invalid-fight-state",
        violations: expect.arrayContaining([
          expect.objectContaining({ type: "invalid-combatant-count" }),
        ]),
      },
    });
  });
});

describe("validateFightState", () => {
  it("rejects a floating relation target that is not an active combatant", () => {
    const createdFight = createFight(input, createDependencies());
    if (!createdFight.ok) throw new Error("Expected initial fight creation to succeed.");

    const invalidState = {
      ...createdFight.value.state,
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:invalid-floating-relation"),
          type: "floating-effect",
          sourceCombatantId: firstCombatantId,
          targetCombatantId: firstCombatantId,
          targetRelationCombatantId: combatantIdSchema.parse("combatant:unknown"),
          sourceDefinitionId: "move-afterlife-solar-flare",
          floatingEffectId: "solar-flare-same-turn-single-die-follow-up",
          effects: [],
          termination: [],
          scope: { type: "combat" },
          createdOnTurn: 1,
        },
      ],
    } as FightState;

    expect(validateFightState(invalidState)).toContainEqual(
      expect.objectContaining({ type: "invalid-active-effect" }),
    );
  });

  it("identifies broken state counters, resources, and active combatant ownership", () => {
    const createdFight = createFight(input, createDependencies());
    if (!createdFight.ok) throw new Error("Expected initial fight creation to succeed.");

    const invalidState = {
      ...createdFight.value.state,
      version: -1,
      activeCombatantId: firstCombatantId,
      combatants: {
        ...createdFight.value.state.combatants,
        [firstCombatantId]: {
          ...createdFight.value.state.combatants[firstCombatantId],
          ki: { current: 11, maximum: 10 },
          status: "defeated",
        },
      },
    } as FightState;

    expect(validateFightState(invalidState)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "invalid-state-counter" }),
        expect.objectContaining({ type: "invalid-resource", subject: firstCombatantId }),
        expect.objectContaining({ type: "invalid-active-combatant", subject: firstCombatantId }),
      ]),
    );
  });

  it("identifies malformed pending decisions and completed-fight winners", () => {
    const createdFight = createFight(input, createDependencies());
    if (!createdFight.ok) throw new Error("Expected initial fight creation to succeed.");

    const invalidPendingDecisionState = {
      ...createdFight.value.state,
      pendingDecision: {
        id: pendingDecisionIdSchema.parse("pending-decision:choose-effect"),
        stateVersion: 1,
        combatantId: firstCombatantId,
        type: "optional-effect",
        options: [],
      },
    } as FightState;
    const invalidCompletedState = {
      ...createdFight.value.state,
      status: "completed",
      completion: { type: "defeat" },
    } as FightState;

    expect(validateFightState(invalidPendingDecisionState)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "invalid-pending-decision" })]),
    );
    expect(validateFightState(invalidCompletedState)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "invalid-completion" })]),
    );
  });

  it("rejects malformed combat-local restricted-use modifiers", () => {
    const createdFight = createFight(input, createDependencies());
    if (!createdFight.ok) throw new Error("Expected initial fight creation to succeed.");
    const combatant = createdFight.value.state.combatants[firstCombatantId];
    const stateWith = (moveIds: readonly string[], moveUseLimitModifiers: Record<string, number>) =>
      ({
        ...createdFight.value.state,
        combatants: {
          ...createdFight.value.state.combatants,
          [firstCombatantId]: { ...combatant, moveIds, moveUseLimitModifiers },
        },
      }) as FightState;

    for (const state of [
      stateWith(combatant.moveIds, { "move-not-owned": 1 }),
      stateWith(combatant.moveIds, { "move-freestyle-hidden-power-level": 1 }),
      stateWith(["move-kurokonwaku-breaking-the-cycle"], {
        "move-kurokonwaku-breaking-the-cycle": 0,
      }),
    ]) {
      expect(validateFightState(state)).toContainEqual(
        expect.objectContaining({ type: "invalid-combatant-state" }),
      );
    }
  });

  it("accepts canonical stored rolls and rejects malformed or unowned records", () => {
    const createdFight = createFight(
      {
        ...input,
        combatants: [
          { ...input.combatants[0], moveIds: ["move-haokiru-healing-ray"] },
          input.combatants[1],
        ],
      },
      createDependencies(),
    );
    if (!createdFight.ok) throw new Error("Expected initial fight creation to succeed.");
    const combatant = createdFight.value.state.combatants[firstCombatantId];
    const withStoredRoll = (storedRolls: NonNullable<typeof combatant.storedRolls>) =>
      ({
        ...createdFight.value.state,
        combatants: {
          ...createdFight.value.state.combatants,
          [firstCombatantId]: { ...combatant, storedRolls },
        },
      }) as FightState;
    const valid = withStoredRoll({
      "healing-ray-result": {
        sourceDefinitionId: "move-haokiru-healing-ray",
        storageKey: "healing-ray-result",
        naturalResults: [9],
        sides: 30,
        storedOnTurn: 1,
      },
    });
    const invalid = withStoredRoll({
      "healing-ray-result": {
        sourceDefinitionId: "move-haokiru-healing-ray",
        storageKey: "different-key",
        naturalResults: [31],
        sides: 30,
        storedOnTurn: 2,
      },
    });

    expect(validateFightState(valid)).toEqual([]);
    expect(validateFightState(invalid)).toContainEqual(
      expect.objectContaining({ type: "invalid-combatant-state", subject: firstCombatantId }),
    );
  });

  it("accepts canonical stored move selections and rejects unowned selections", () => {
    const createdFight = createFight(
      {
        ...input,
        combatants: [
          {
            ...input.combatants[0],
            moveIds: [
              "move-akaikaru-impulsive",
              "move-akaikaru-back-brain-kick",
              "move-akaikaru-backflip-kick",
            ],
          },
          input.combatants[1],
        ],
      },
      createDependencies(),
    );
    if (!createdFight.ok) throw new Error("Expected initial fight creation to succeed.");
    const combatant = createdFight.value.state.combatants[firstCombatantId];
    const withSelection = (
      storedMoveSelections: NonNullable<typeof combatant.storedMoveSelections>,
    ) =>
      ({
        ...createdFight.value.state,
        combatants: {
          ...createdFight.value.state.combatants,
          [firstCombatantId]: { ...combatant, storedMoveSelections },
        },
      }) as FightState;
    const valid = withSelection({
      "impulsive-selected-advanced-attack": {
        sourceDefinitionId: "move-akaikaru-impulsive",
        selectionKey: "impulsive-selected-advanced-attack",
        moveId: "move-akaikaru-backflip-kick",
        selectedOnTurn: 1,
      },
    });
    const invalid = withSelection({
      "impulsive-selected-advanced-attack": {
        sourceDefinitionId: "move-akaikaru-impulsive",
        selectionKey: "impulsive-selected-advanced-attack",
        moveId: "move-not-owned",
        selectedOnTurn: 1,
      },
    });

    expect(validateFightState(valid)).toEqual([]);
    expect(validateFightState(invalid)).toContainEqual(
      expect.objectContaining({ type: "invalid-combatant-state", subject: firstCombatantId }),
    );
  });

  it("identifies invalid temporary state for uses, statuses, transformations, history, and frames", () => {
    const createdFight = createFight(input, createDependencies());
    if (!createdFight.ok) throw new Error("Expected initial fight creation to succeed.");

    const invalidState = {
      ...createdFight.value.state,
      combatants: {
        ...createdFight.value.state.combatants,
        [firstCombatantId]: {
          ...createdFight.value.state.combatants[firstCombatantId],
          moveUses: { "move-not-owned": 0 },
          activeStatuses: [
            {
              statusId: "",
              sourceCombatantId: firstCombatantId,
              sourceDefinitionId: "",
              stacks: 0,
              duration: { type: "turns", ownerCombatantId: firstCombatantId, remaining: 0 },
            },
          ],
          transformation: { transformationId: "", activatedOnTurn: 2 },
        },
      },
      actionHistory: [
        {
          type: "use-move",
          decisionId: combatDecisionIdSchema.parse("decision:invalid-history"),
          actorId: firstCombatantId,
          targetCombatantId: firstCombatantId,
          moveId: "",
          turnNumber: 0,
          phase: "action",
        },
      ],
      resolutionFrames: [
        {
          id: resolutionFrameIdSchema.parse("resolution-frame:invalid"),
          type: "attack",
          decisionId: combatDecisionIdSchema.parse("decision:invalid-frame"),
          attackerId: firstCombatantId,
          targetCombatantId: firstCombatantId,
          returnPhase: "action",
          stage: "awaiting-counter",
        },
      ],
    } as FightState;

    expect(validateFightState(invalidState)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "invalid-use-count" }),
        expect.objectContaining({ type: "invalid-status" }),
        expect.objectContaining({ type: "invalid-transformation" }),
        expect.objectContaining({ type: "invalid-action-history" }),
        expect.objectContaining({ type: "invalid-resolution-frame" }),
      ]),
    );
  });

  it("accepts serializable temporary state that future effect slices can resume", () => {
    const createdFight = createFight(input, createDependencies());
    if (!createdFight.ok) throw new Error("Expected initial fight creation to succeed.");

    const stateWithTemporaryState = {
      ...createdFight.value.state,
      combatants: {
        ...createdFight.value.state.combatants,
        [firstCombatantId]: {
          ...createdFight.value.state.combatants[firstCombatantId],
          moveUses: { "move-freestyle-hidden-power-level": 1 },
          activeStatuses: [
            {
              statusId: "cooldown",
              sourceCombatantId: firstCombatantId,
              sourceDefinitionId: "move-freestyle-hidden-power-level",
              stacks: 1,
              duration: { type: "uses", remaining: 1 },
            },
          ],
          transformation: {
            transformationId: "transformation-ghost-2-ghoul",
            activatedOnTurn: 1,
          },
        },
      },
      actionHistory: [
        {
          type: "pass",
          decisionId: combatDecisionIdSchema.parse("decision:recorded-pass"),
          actorId: firstCombatantId,
          turnNumber: 1,
          phase: "action",
        },
      ],
      resolutionFrames: [
        {
          id: resolutionFrameIdSchema.parse("resolution-frame:pending-effect"),
          type: "effect",
          sourceCombatantId: firstCombatantId,
          targetCombatantId: secondCombatantId,
          sourceDefinitionId: "move-freestyle-hidden-power-level",
          effectIndex: 0,
          returnPhase: "action",
          trigger: "action",
        },
      ],
    } as FightState;

    expect(validateFightState(stateWithTemporaryState)).toEqual([]);
  });

  it("rejects action locks whose duration refers to a nonparticipant", () => {
    const createdFight = createFight(input, createDependencies());
    if (!createdFight.ok || createdFight.value.state.status !== "active") {
      throw new Error("Expected an active initial fight state.");
    }
    const invalidState: FightState = {
      ...createdFight.value.state,
      activeEffects: [
        {
          id: "active-effect:invalid-lock" as never,
          type: "action-lock",
          sourceCombatantId: firstCombatantId,
          targetCombatantId: secondCombatantId,
          sourceDefinitionId: "move-afterlife-dodon-ray",
          affectedType: "skill",
          duration: {
            type: "until-roll-threshold",
            combatantId: "combatant:missing" as never,
            roll: "attack",
            comparison: "at-least",
            value: 20,
          },
        },
      ],
    };

    expect(validateFightState(invalidState)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "invalid-active-effect" })]),
    );
  });

  it("rejects counted roll modifiers without a positive remaining count", () => {
    const createdFight = createFight(input, createDependencies());
    if (!createdFight.ok || createdFight.value.state.status !== "active") {
      throw new Error("Expected an active initial fight state.");
    }
    const invalidState: FightState = {
      ...createdFight.value.state,
      activeEffects: [
        {
          id: "active-effect:invalid-counted-roll" as never,
          type: "modify-next-action",
          sourceCombatantId: firstCombatantId,
          targetCombatantId: secondCombatantId,
          sourceDefinitionId: "move-aoyosumu-bullwhip",
          scope: "next-rolls",
          remaining: 0,
          modifier: { type: "roll", roll: "defense", modifier: "result", amount: 2 },
        },
      ],
    };

    expect(validateFightState(invalidState)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "invalid-active-effect" })]),
    );
  });

  it("rejects malformed scheduled resource state", () => {
    const createdFight = createFight(input, createDependencies());
    if (!createdFight.ok || createdFight.value.state.status !== "active") {
      throw new Error("Expected an active initial fight state.");
    }
    const invalidState: FightState = {
      ...createdFight.value.state,
      activeEffects: [
        {
          id: "active-effect:invalid-schedule" as never,
          type: "scheduled-resource",
          sourceCombatantId: firstCombatantId,
          targetCombatantId: secondCombatantId,
          sourceDefinitionId: "move-afterlife-burning-shoot",
          sourceEffectIndex: 0,
          timing: { type: "turn-start", combatantId: secondCombatantId },
          remainingBoundaries: 0,
          repeat: "each-turn",
          resource: "hp",
          operation: "lose",
          amount: { type: "literal", value: -1 },
        },
      ],
    };

    expect(validateFightState(invalidState)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "invalid-active-effect" })]),
    );
  });

  it("rejects malformed durable action restrictions", () => {
    const createdFight = createFight(input, createDependencies());
    if (!createdFight.ok || createdFight.value.state.status !== "active") {
      throw new Error("Expected an active initial fight state.");
    }
    const invalidState: FightState = {
      ...createdFight.value.state,
      activeEffects: [
        {
          id: "active-effect:invalid-action-restriction" as never,
          type: "action-restriction",
          sourceCombatantId: firstCombatantId,
          targetCombatantId: secondCombatantId,
          sourceDefinitionId: "move-aoyosumu-serenity-wave",
          sourceEffectIndex: 0,
          blockedCategories: ["basic-attack", "basic-attack"],
          availableFromTurn: 0,
          remainingTurns: 0,
        },
      ],
    };

    expect(validateFightState(invalidState)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "invalid-active-effect" })]),
    );
  });

  it("keeps pending choices, counter phase, and fight completion structurally consistent", () => {
    const createdFight = createFight(input, createDependencies());
    if (!createdFight.ok) throw new Error("Expected initial fight creation to succeed.");
    if (createdFight.value.state.status !== "active") {
      throw new Error("Expected an active initial fight state.");
    }
    const initialState = createdFight.value.state;

    const counterFrame = {
      id: resolutionFrameIdSchema.parse("resolution-frame:counter"),
      type: "attack" as const,
      decisionId: combatDecisionIdSchema.parse("decision:counter"),
      attackerId: firstCombatantId,
      targetCombatantId: secondCombatantId,
      returnPhase: "action" as const,
      stage: "awaiting-counter" as const,
    };
    const invalidPendingDecisionState: FightState = {
      ...initialState,
      pendingDecision: {
        id: pendingDecisionIdSchema.parse("pending-decision:invalid-option"),
        stateVersion: 0,
        combatantId: firstCombatantId,
        type: "select-move",
        options: [
          {
            id: "unowned-move",
            type: "select-move",
            moveId: "move-afterlife-give-me-energy",
          },
        ],
      },
    };
    const counterWithoutFrame: FightState = {
      ...initialState,
      phase: "counter",
    };
    const counterFrameOutsideCounterPhase: FightState = {
      ...initialState,
      resolutionFrames: [counterFrame],
    };
    const defenseWithoutFrame: FightState = {
      ...initialState,
      pendingDecision: {
        id: pendingDecisionIdSchema.parse("pending-decision:defense-without-frame"),
        stateVersion: 0,
        combatantId: secondCombatantId,
        type: "defense-response",
        options: [{ id: "roll", type: "roll-defense" }],
      },
    };
    const completedWithFrame = {
      ...createdFight.value.state,
      status: "completed",
      completion: { type: "cancelled" as const },
      resolutionFrames: [counterFrame],
    } as FightState;

    expect(validateFightState(invalidPendingDecisionState)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "invalid-pending-decision" })]),
    );
    expect(validateFightState(counterWithoutFrame)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "invalid-resolution-frame" })]),
    );
    expect(validateFightState(counterFrameOutsideCounterPhase)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "invalid-resolution-frame" })]),
    );
    expect(validateFightState(defenseWithoutFrame)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "invalid-resolution-frame" })]),
    );
    expect(validateFightState(completedWithFrame)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "invalid-completion" })]),
    );
  });
});
