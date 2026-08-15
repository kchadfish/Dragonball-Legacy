import { describe, expect, it } from "vitest";

import type { ActiveFightState, CreateFightInput, FightState } from "./index.js";
import {
  activeEffectIdSchema,
  advanceFight,
  createFight,
  enumerateLegalDecisions,
  submitCombatDecision,
} from "./index.js";
import {
  combatDecisionIdSchema,
  combatantIdSchema,
  combatEventIdSchema,
  fightIdSchema,
  pendingDecisionIdSchema,
  resolutionFrameIdSchema,
} from "./ids.js";
import { createTestCombatDependencies } from "./testing/index.js";

const firstCombatantId = combatantIdSchema.parse("combatant:goku");
const secondCombatantId = combatantIdSchema.parse("combatant:vegeta");

const input: CreateFightInput = {
  mode: "spar",
  combatants: [
    {
      maximumHitPoints: 150,
      stats: { power: 20, dexterity: 6, dexterityBonus: 1 },
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
      combatEventIdSchema.parse("event:phase-action"),
      combatEventIdSchema.parse("event:ki-gained"),
      combatEventIdSchema.parse("event:phase-end"),
      combatEventIdSchema.parse("event:phase-upkeep"),
      combatEventIdSchema.parse("event:next-turn"),
      combatEventIdSchema.parse("event:next-action"),
    ],
  });

const requireTransition = <T>(result: { readonly ok: boolean; readonly value?: T }): T => {
  if (!result.ok || result.value === undefined)
    throw new Error("Expected a successful combat transition.");
  return result.value;
};

const requireActiveFightState = (state: FightState): ActiveFightState => {
  if (state.status !== "active") throw new Error("Expected an active fight state.");
  return state;
};

const createInitialState = (dependencies = createDependencies()) => {
  const fight = createFight(input, dependencies);
  return { state: requireTransition(fight).state, dependencies };
};

const createStrainingDependencies = (randomValues: readonly number[] = [20, 1]) =>
  createTestCombatDependencies(randomValues, new Date("2026-08-04T12:00:00.000Z"), {
    fightIds: [fightIdSchema.parse("fight:straining-bodyslam")],
    combatantIds: [firstCombatantId, secondCombatantId],
    eventIds: [
      ...Array.from({ length: 60 }, (_, index) =>
        combatEventIdSchema.parse(`event:straining-bodyslam-${index + 1}`),
      ),
    ],
    activeEffectIds: Array.from({ length: 10 }, (_, index) =>
      activeEffectIdSchema.parse(`active-effect:straining-bodyslam-${index + 1}`),
    ),
    pendingDecisionIds: [
      pendingDecisionIdSchema.parse("pending-decision:straining-effect"),
      pendingDecisionIdSchema.parse("pending-decision:straining-defense"),
    ],
    resolutionFrameIds: [
      resolutionFrameIdSchema.parse("resolution-frame:straining-effect"),
      resolutionFrameIdSchema.parse("resolution-frame:straining-defense"),
    ],
  });

describe("generic before-attack pending effect choices", () => {
  it("offers a deterministic activation or decline before defense and applies activation costs on resume", () => {
    const dependencies = createStrainingDependencies();
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
              moveIds: ["move-freestyle-straining-bodyslam"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: ["move-akaikaru-backflip"],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const signatureAction = { ...action, turnNumber: 10 };
    const submitted = submitCombatDecision(
      signatureAction,
      {
        type: "use-move",
        id: combatDecisionIdSchema.parse("decision:straining-bodyslam"),
        actorId: firstCombatantId,
        expectedStateVersion: signatureAction.version,
        moveId: "move-freestyle-straining-bodyslam",
        targetCombatantId: secondCombatantId,
      },
      dependencies,
    );
    const pending = requireActiveFightState(requireTransition(submitted).state);

    expect(pending.version).toBe(action.version + 1);
    expect(pending.pendingDecision).toMatchObject({
      type: "optional-effect",
      combatantId: firstCombatantId,
      options: [
        {
          id: "activate-effect:0,1",
          type: "activate-effect",
          effectIndices: [0, 1],
        },
        { id: "decline", type: "decline" },
      ],
    });

    expect(pending.combatants[firstCombatantId].hitPoints.current).toBe(100);
    expect(enumerateLegalDecisions(pending, firstCombatantId)).toEqual([]);

    const resumed = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          pending,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:straining-activate"),
            actorId: firstCombatantId,
            expectedStateVersion: pending.version,
            pendingDecisionId: pending.pendingDecision!.id,
            optionId: "activate-effect:0,1",
          },
          dependencies,
        ),
      ).state,
    );

    expect(resumed.version).toBe(pending.version + 1);
    expect(resumed.combatants[firstCombatantId].hitPoints.current).toBe(100);
    expect(resumed.pendingDecision?.type).toBe("defense-response");
    expect(resumed.resolutionFrames[0]).toMatchObject({
      stage: "awaiting-defense",
      attack: { type: "move", moveId: "move-freestyle-straining-bodyslam" },
      enabledOptionalEffectIndices: [0, 1],
      resolvedOptionalEffectIndices: [0, 1],
    });

    const completed = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          resumed,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:straining-defense"),
            actorId: secondCombatantId,
            expectedStateVersion: resumed.version,
            pendingDecisionId: resumed.pendingDecision!.id,
            optionId: "roll-defense",
          },
          dependencies,
        ),
      ).state,
    );
    expect(completed.combatants[firstCombatantId].hitPoints.current).toBe(90);
  });

  it("declines the grouped effect without spending HP while preserving the attack decision", () => {
    const dependencies = createStrainingDependencies();
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
              moveIds: ["move-freestyle-straining-bodyslam"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: ["move-akaikaru-backflip"],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const signatureAction = { ...action, turnNumber: 10 };
    const pending = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          signatureAction,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:straining-decline"),
            actorId: firstCombatantId,
            expectedStateVersion: signatureAction.version,
            moveId: "move-freestyle-straining-bodyslam",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );
    const defense = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          pending,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:straining-decline-choice"),
            actorId: firstCombatantId,
            expectedStateVersion: pending.version,
            pendingDecisionId: pending.pendingDecision!.id,
            optionId: "decline",
          },
          dependencies,
        ),
      ).state,
    );
    expect(defense.combatants[firstCombatantId].hitPoints.current).toBe(100);
    expect(defense.pendingDecision?.type).toBe("defense-response");
  });
});

describe("generic successful CONSTANT Skill activation", () => {
  it("serializes the move choice and charges the selected skill on resume", () => {
    const dependencies = createTestCombatDependencies(
      [30, 30, 30, 30],
      new Date("2026-08-04T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:activation")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 40 }, (_, index) =>
          combatEventIdSchema.parse(`event:activation-${index + 1}`),
        ),
        pendingDecisionIds: [pendingDecisionIdSchema.parse("pending-decision:activation")],
        resolutionFrameIds: [resolutionFrameIdSchema.parse("resolution-frame:activation")],
        activeEffectIds: [activeEffectIdSchema.parse("active-effect:activation")],
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
              moveIds: ["move-freestyle-monkey-sweep", "move-freestyle-monkey-maneuvers"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: ["move-afterlife-give-me-energy"],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const submitted = submitCombatDecision(
      action,
      {
        type: "use-move",
        id: combatDecisionIdSchema.parse("decision:activation-attack"),
        actorId: firstCombatantId,
        expectedStateVersion: action.version,
        moveId: "move-freestyle-monkey-sweep",
        targetCombatantId: secondCombatantId,
      },
      dependencies,
    );
    const pending = requireActiveFightState(requireTransition(submitted).state);
    expect(pending.pendingDecision).toMatchObject({
      type: "select-move",
      combatantId: firstCombatantId,
      options: [
        {
          id: "activate:move-freestyle-monkey-maneuvers",
          type: "select-move",
          moveId: "move-freestyle-monkey-maneuvers",
        },
        { id: "decline", type: "decline" },
      ],
    });
    expect(pending.resolutionFrames[0]).toMatchObject({
      type: "effect",
      operation: "activate",
      eligibleMoveIds: ["move-freestyle-monkey-maneuvers"],
    });
    expect(pending.combatants[firstCombatantId].ki.current).toBe(4);

    const resumed = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          pending,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:activation-select"),
            actorId: firstCombatantId,
            expectedStateVersion: pending.version,
            pendingDecisionId: pending.pendingDecision!.id,
            optionId: "activate:move-freestyle-monkey-maneuvers",
          },
          dependencies,
        ),
      ).state,
    );

    expect(resumed.combatants[firstCombatantId].ki.current).toBe(2);
    expect(resumed.combatants[firstCombatantId].moveUses["move-freestyle-monkey-maneuvers"]).toBe(
      1,
    );
    expect(resumed.activeEffects).toContainEqual(
      expect.objectContaining({
        id: "active-effect:activation",
        type: "active-constant",
        sourceDefinitionId: "move-freestyle-monkey-maneuvers",
        paidActivationCost: 2,
        lifecycle: "active",
      }),
    );
    expect(resumed.version).toBe(pending.version + 1);
    expect(resumed.pendingDecision).toBeUndefined();
    expect(resumed.resolutionFrames).toEqual([]);
  });

  it("resumes a generic grouped roll-definition choice with its optional Ki cost", () => {
    const dependencies = createStrainingDependencies([34, 1]);
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
              moveIds: ["move-afterlife-supernova"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const prepared: ActiveFightState = {
      ...action,
      turnNumber: 10,
      combatants: {
        ...action.combatants,
        [firstCombatantId]: {
          ...action.combatants[firstCombatantId]!,
          ki: { ...action.combatants[firstCombatantId]!.ki, current: 10 },
        },
      },
    };

    const pending = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          prepared,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:supernova"),
            actorId: firstCombatantId,
            expectedStateVersion: prepared.version,
            moveId: "move-afterlife-supernova",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );

    expect(pending.pendingDecision).toMatchObject({
      type: "optional-effect",
      options: [
        {
          id: "activate-effect:0,1",
          type: "activate-effect",
          effectIndices: [0, 1],
        },
        { id: "decline", type: "decline" },
      ],
    });
    expect(pending.combatants[firstCombatantId]!.ki.current).toBe(10);

    const resumedTransition = requireTransition(
      submitCombatDecision(
        pending,
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:supernova-optional"),
          actorId: firstCombatantId,
          expectedStateVersion: pending.version,
          pendingDecisionId: pending.pendingDecision!.id,
          optionId: "activate-effect:0,1",
        },
        dependencies,
      ),
    );
    const resumed = requireActiveFightState(resumedTransition.state);

    expect(resumed.combatants[firstCombatantId]!.ki.current).toBe(1);
    expect(resumed.pendingDecision).toBeUndefined();
    expect(resumedTransition.events).toContainEqual(
      expect.objectContaining({ type: "attack-rolled", naturalResult: 34, result: 34 }),
    );

    expect(resumed.actionHistory.at(-1)).toMatchObject({
      moveId: "move-afterlife-supernova",
    });
  });

  it("offers and resumes a grouped after-defense choice without rerolling persisted dice", () => {
    const dependencies = createStrainingDependencies([20, 24, 20, 24, 20, 24]);
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
              moveIds: ["move-afterlife-super-galick-gun"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const pendingDefense = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          {
            ...action,
            turnNumber: 10,
            combatants: {
              ...action.combatants,
              [firstCombatantId]: {
                ...action.combatants[firstCombatantId]!,
                ki: { ...action.combatants[firstCombatantId]!.ki, current: 10 },
              },
            },
          },
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:galick-gun"),
            actorId: firstCombatantId,
            expectedStateVersion: action.version,
            moveId: "move-afterlife-super-galick-gun",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );

    expect(pendingDefense.pendingDecision?.type).toBe("defense-response");
    const pendingReaction = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          pendingDefense,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:galick-defense"),
            actorId: secondCombatantId,
            expectedStateVersion: pendingDefense.version,
            pendingDecisionId: pendingDefense.pendingDecision!.id,
            optionId: "roll-defense",
          },
          dependencies,
        ),
      ).state,
    );

    expect(pendingReaction.pendingDecision).toMatchObject({
      type: "post-defense-roll",
      combatantId: firstCombatantId,
      options: [
        {
          id: "decline",
          type: "decline",
        },
        {
          id: "activate-effect:0,1",
          type: "activate-effect",
          effectIndices: [0, 1],
        },
      ],
    });
    expect(pendingReaction.combatants[firstCombatantId]!.ki.current).toBe(10);
    expect(pendingReaction.resolutionFrames[0]).toMatchObject({
      stage: "awaiting-post-defense-reaction",
      naturalRolls: [{ attack: 20, defense: 24 }],
    });

    const resumedTransition = requireTransition(
      submitCombatDecision(
        pendingReaction,
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:galick-activate"),
          actorId: firstCombatantId,
          expectedStateVersion: pendingReaction.version,
          pendingDecisionId: pendingReaction.pendingDecision!.id,
          optionId: "activate-effect:0,1",
        },
        dependencies,
      ),
    );
    const resumed = requireActiveFightState(resumedTransition.state);

    expect(resumed.combatants[firstCombatantId]!.ki.current).toBe(1);
    expect(resumed.actionHistory.at(-1)).toMatchObject({
      moveId: "move-afterlife-super-galick-gun",
      critical: true,
    });
    expect(resumedTransition.events).toContainEqual(
      expect.objectContaining({
        type: "attack-resolved",
        moveId: "move-afterlife-super-galick-gun",
        critical: true,
      }),
    );
    expect(resumed.pendingDecision).toBeUndefined();
  });
});

describe("stored-roll transitions", () => {
  it("stores an action roll, emits it, and resolves an exact immediate low-roll branch", () => {
    const dependencies = createTestCombatDependencies([9], new Date("2026-08-13T12:00:00.000Z"), {
      fightIds: [fightIdSchema.parse("fight:healing-ray-stored-roll")],
      combatantIds: [firstCombatantId, secondCombatantId],
      eventIds: Array.from({ length: 20 }, (_, index) =>
        combatEventIdSchema.parse(`event:healing-ray-stored-roll-${index + 1}`),
      ),
    });
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
              moveIds: ["move-haokiru-healing-ray"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const beforeKi = action.combatants[firstCombatantId].ki.current;
    const transition = requireTransition(
      submitCombatDecision(
        action,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:healing-ray-stored-roll"),
          actorId: firstCombatantId,
          expectedStateVersion: action.version,
          moveId: "move-haokiru-healing-ray",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );

    expect(transition.state.version).toBe(action.version + 1);
    expect(transition.state.combatants[firstCombatantId].ki.current).toBe(beforeKi - 1);
    expect(
      transition.state.combatants[firstCombatantId].storedRolls?.["healing-ray-result"],
    ).toEqual({
      sourceDefinitionId: "move-haokiru-healing-ray",
      storageKey: "healing-ray-result",
      naturalResults: [9],
      sides: 30,
      storedOnTurn: action.turnNumber,
    });
    expect(transition.events).toContainEqual(
      expect.objectContaining({
        type: "roll-stored",
        combatantId: firstCombatantId,
        storageKey: "healing-ray-result",
        naturalResults: [9],
      }),
    );
  });

  it("resolves a dynamic upkeep die and retains its natural result", () => {
    const dependencies = createTestCombatDependencies([2], new Date("2026-08-13T12:00:00.000Z"), {
      fightIds: [fightIdSchema.parse("fight:impulsive-stored-roll")],
      combatantIds: [firstCombatantId, secondCombatantId],
      eventIds: Array.from({ length: 30 }, (_, index) =>
        combatEventIdSchema.parse(`event:impulsive-stored-roll-${index + 1}`),
      ),
    });
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
              moveIds: [
                "move-akaikaru-impulsive",
                "move-akaikaru-back-brain-kick",
                "move-akaikaru-backflip-kick",
              ],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );

    const transition = requireTransition(advanceFight(created.state, dependencies));

    expect(transition.state.version).toBe(created.state.version + 1);
    expect(
      transition.state.combatants[firstCombatantId].storedRolls?.[
        "impulsive-advanced-attack-index"
      ],
    ).toEqual(expect.objectContaining({ naturalResults: [2], sides: 2, storedOnTurn: 1 }));
    expect(transition.events).toContainEqual(
      expect.objectContaining({
        type: "roll-stored",
        storageKey: "impulsive-advanced-attack-index",
        sides: 2,
      }),
    );
  });

  it("uses an upkeep stored roll for Solar Flare's exact immediate stun threshold", () => {
    const dependencies = createTestCombatDependencies([15], new Date("2026-08-13T12:00:00.000Z"), {
      fightIds: [fightIdSchema.parse("fight:solar-flare-stored-roll")],
      combatantIds: [firstCombatantId, secondCombatantId],
      activeEffectIds: Array.from({ length: 3 }, (_, index) =>
        activeEffectIdSchema.parse(`active-effect:solar-flare-${index + 1}`),
      ),
      eventIds: Array.from({ length: 30 }, (_, index) =>
        combatEventIdSchema.parse(`event:solar-flare-stored-roll-${index + 1}`),
      ),
    });
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
              moveIds: ["move-afterlife-solar-flare"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );

    const transition = requireTransition(advanceFight(created.state, dependencies));

    expect(transition.state.combatants[firstCombatantId].storedRolls?.["solar-flare-roll"]).toEqual(
      expect.objectContaining({ naturalResults: [15], sides: 30 }),
    );
    expect(transition.state.combatants[secondCombatantId].activeStatuses).toContainEqual(
      expect.objectContaining({ statusId: "stun" }),
    );
    expect(transition.events).toContainEqual(
      expect.objectContaining({
        type: "roll-stored",
        sourceDefinitionId: "move-afterlife-solar-flare",
        naturalResults: [15],
      }),
    );
  });
});

describe("start-combat effect dispatch", () => {
  it("applies representable resource changes and selector locks at the first action boundary", () => {
    const dependencies = createTestCombatDependencies([], new Date("2026-08-12T12:00:00.000Z"), {
      fightIds: [fightIdSchema.parse("fight:start-combat-effects")],
      combatantIds: [firstCombatantId, secondCombatantId],
      activeEffectIds: [
        activeEffectIdSchema.parse("active-effect:start-lock-1"),
        activeEffectIdSchema.parse("active-effect:start-lock-2"),
      ],
      eventIds: Array.from({ length: 8 }, (_, index) =>
        combatEventIdSchema.parse(`event:start-combat-effects-${index + 1}`),
      ),
    });
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 5, dexterityBonus: 0 },
              moveIds: [
                "move-haokiru-conservation-mastery",
                "move-haokiru-focused-mastery",
                "move-freestyle-heart-stab",
              ],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );

    const transition = requireTransition(advanceFight(created.state, dependencies));

    expect(transition.state.version).toBe(created.state.version + 1);
    expect(transition.state.combatants[firstCombatantId].ki.current).toBe(6);
    expect(transition.state.activeEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "action-lock",
          sourceDefinitionId: "move-haokiru-focused-mastery",
          targetCombatantId: firstCombatantId,
        }),
      ]),
    );
    expect(enumerateLegalDecisions(transition.state, firstCombatantId)).not.toContainEqual(
      expect.objectContaining({ type: "use-move", moveId: "move-freestyle-heart-stab" }),
    );
    expect(transition.events).toContainEqual(
      expect.objectContaining({ type: "ki-changed", combatantId: firstCombatantId, amount: 1 }),
    );
  });
});

describe("restricted-use limit modification", () => {
  it("keeps legality and submission consistent for a conditional passive increase", () => {
    const dependencies = createTestCombatDependencies(
      [20, 1],
      new Date("2026-08-13T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:restricted-use-modifier")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 24 }, (_, index) =>
          combatEventIdSchema.parse(`event:restricted-use-modifier-${index + 1}`),
        ),
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
              moveIds: ["move-kurokonwaku-breaking-the-cycle"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const usedOnce: ActiveFightState = {
      ...action,
      combatants: {
        ...action.combatants,
        [firstCombatantId]: {
          ...action.combatants[firstCombatantId],
          moveUses: { "move-kurokonwaku-breaking-the-cycle": 1 },
        },
      },
    };
    const decision = {
      type: "use-move" as const,
      actorId: firstCombatantId,
      moveId: "move-kurokonwaku-breaking-the-cycle" as const,
      targetCombatantId: secondCombatantId,
    };

    expect(enumerateLegalDecisions(usedOnce, firstCombatantId)).toContainEqual(decision);

    const excluded: ActiveFightState = {
      ...usedOnce,
      combatants: {
        ...usedOnce.combatants,
        [firstCombatantId]: {
          ...usedOnce.combatants[firstCombatantId],
          moveIds: ["move-kurokonwaku-breaking-the-cycle", "move-kurokonwaku-concussion-shot"],
        },
      },
    };
    expect(enumerateLegalDecisions(excluded, firstCombatantId)).not.toContainEqual(decision);
    expect(
      submitCombatDecision(
        excluded,
        {
          ...decision,
          id: combatDecisionIdSchema.parse("decision:restricted-use-excluded"),
          expectedStateVersion: excluded.version,
        },
        dependencies,
      ),
    ).toMatchObject({ ok: false, error: { type: "restricted-use-exhausted" } });

    const transition = requireTransition(
      submitCombatDecision(
        usedOnce,
        {
          ...decision,
          id: combatDecisionIdSchema.parse("decision:restricted-use-available"),
          expectedStateVersion: usedOnce.version,
        },
        dependencies,
      ),
    );
    expect(transition.state.version).toBe(usedOnce.version + 1);
    expect(transition.state.combatants[firstCombatantId].moveUses).toMatchObject({
      "move-kurokonwaku-breaking-the-cycle": 2,
    });
  });
});

describe("scheduled resource effect dispatch", () => {
  it("applies a scheduled HP change at the declared public phase boundary", () => {
    const dependencies = createTestCombatDependencies(
      [20, 1],
      new Date("2026-08-13T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:scheduled-phase")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: [
          activeEffectIdSchema.parse("active-effect:scheduled-phase-lock"),
          activeEffectIdSchema.parse("active-effect:scheduled-phase"),
        ],
        eventIds: Array.from({ length: 32 }, (_, index) =>
          combatEventIdSchema.parse(`event:scheduled-phase-${index + 1}`),
        ),
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 100, dexterity: 5, dexterityBonus: 0 },
              moveIds: ["move-akaikaru-continuous-knee-smash"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireTransition(advanceFight(created.state, dependencies));
    const attack = requireTransition(
      submitCombatDecision(
        action.state,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:scheduled-phase-attack"),
          actorId: firstCombatantId,
          expectedStateVersion: action.state.version,
          moveId: "move-akaikaru-continuous-knee-smash",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );

    expect(attack.state.activeEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "scheduled-resource",
          sourceDefinitionId: "move-akaikaru-continuous-knee-smash",
          remainingBoundaries: 1,
          timing: {
            type: "phase-start",
            combatantId: secondCombatantId,
            phase: "upkeep",
          },
        }),
      ]),
    );

    const nextUpkeep = requireTransition(advanceFight(attack.state, dependencies));
    expect(nextUpkeep.state.version).toBe(attack.state.version + 1);
    expect(nextUpkeep.state.combatants[secondCombatantId].hitPoints.current).toBe(65);
    expect(nextUpkeep.state.activeEffects).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "scheduled-resource" })]),
    );
    expect(nextUpkeep.events).toContainEqual(
      expect.objectContaining({
        type: "hp-changed",
        sourceCombatantId: firstCombatantId,
        targetCombatantId: secondCombatantId,
        amount: -5,
        remainingHitPoints: 65,
      }),
    );
  });

  it("repeats scheduled resource work across matching target turns", () => {
    const dependencies = createTestCombatDependencies(
      [30, 1],
      new Date("2026-08-13T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:scheduled-repeat")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: [activeEffectIdSchema.parse("active-effect:scheduled-repeat")],
        eventIds: Array.from({ length: 64 }, (_, index) =>
          combatEventIdSchema.parse(`event:scheduled-repeat-${index + 1}`),
        ),
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 100, dexterity: 5, dexterityBonus: 0 },
              moveIds: ["move-kurokonwaku-poison-mist"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireTransition(advanceFight(created.state, dependencies));
    const attack = requireTransition(
      submitCombatDecision(
        action.state,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:scheduled-repeat-attack"),
          actorId: firstCombatantId,
          expectedStateVersion: action.state.version,
          moveId: "move-kurokonwaku-poison-mist",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );
    expect(attack.state.activeEffects).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "scheduled-resource" })]),
    );
    const activeAttack = requireActiveFightState(attack.state);
    expect(activeAttack.phase).toBe("end");
    expect(activeAttack.activeCombatantId).toBe(firstCombatantId);
    expect(attack.state.activeEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "scheduled-resource",
          timing: {
            type: "phase-start",
            combatantId: secondCombatantId,
            phase: "upkeep",
          },
          duration: expect.objectContaining({
            type: "until-roll-threshold",
            combatantId: secondCombatantId,
            roll: "attack",
            comparison: "at-least",
            value: 23,
            moveSelector: {
              type: "move-selector",
              subject: "source",
              attackRoll: { dice: 1 },
              sourceText: "a single dice attack",
            },
          }),
          remainingBoundaries: 1,
        }),
      ]),
    );
    const opponentUpkeep = requireTransition(advanceFight(attack.state, dependencies));
    expect(opponentUpkeep.state.combatants[secondCombatantId].ki.current).toBe(4);

    const opponentActionBoundary = requireTransition(
      advanceFight(opponentUpkeep.state, dependencies),
    );
    const opponentActionResult = submitCombatDecision(
      opponentActionBoundary.state,
      {
        type: "pass",
        id: combatDecisionIdSchema.parse("decision:scheduled-repeat-pass-opponent"),
        actorId: secondCombatantId,
        expectedStateVersion: opponentActionBoundary.state.version,
      },
      dependencies,
    );
    const opponentAction = requireTransition(opponentActionResult);
    const sourceUpkeep = requireTransition(advanceFight(opponentAction.state, dependencies));
    const sourceActionBoundary = requireTransition(advanceFight(sourceUpkeep.state, dependencies));
    const sourceAction = requireTransition(
      submitCombatDecision(
        sourceActionBoundary.state,
        {
          type: "pass",
          id: combatDecisionIdSchema.parse("decision:scheduled-repeat-pass-source"),
          actorId: firstCombatantId,
          expectedStateVersion: sourceActionBoundary.state.version,
        },
        dependencies,
      ),
    );
    const secondOpponentUpkeep = requireTransition(advanceFight(sourceAction.state, dependencies));

    expect(secondOpponentUpkeep.state.combatants[secondCombatantId].ki.current).toBe(3);
    expect(
      secondOpponentUpkeep.state.activeEffects.some(
        (effect) => effect.type === "scheduled-resource",
      ),
    ).toBe(true);
  });

  it("waits for the declared target turn and resolves delayed damage through damage events", () => {
    const dependencies = createTestCombatDependencies(
      [30, 1],
      new Date("2026-08-13T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:scheduled-damage")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: [activeEffectIdSchema.parse("active-effect:scheduled-damage")],
        eventIds: Array.from({ length: 80 }, (_, index) =>
          combatEventIdSchema.parse(`event:scheduled-damage-${index + 1}`),
        ),
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 100, dexterity: 5, dexterityBonus: 0 },
              moveIds: ["move-aoyosumu-bomb-tag"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireTransition(advanceFight(created.state, dependencies));
    const attack = requireTransition(
      submitCombatDecision(
        action.state,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:scheduled-damage-attack"),
          actorId: firstCombatantId,
          expectedStateVersion: action.state.version,
          moveId: "move-aoyosumu-bomb-tag",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );
    const hitPointsAfterAttack = attack.state.combatants[secondCombatantId].hitPoints.current;
    const firstTargetUpkeep = requireTransition(advanceFight(attack.state, dependencies));
    expect(firstTargetUpkeep.state.combatants[secondCombatantId].hitPoints.current).toBe(
      hitPointsAfterAttack,
    );
    expect(firstTargetUpkeep.events).not.toContainEqual(
      expect.objectContaining({ type: "damage-applied", causedByEffectId: expect.any(String) }),
    );

    const targetAction = requireTransition(advanceFight(firstTargetUpkeep.state, dependencies));
    const targetPass = requireTransition(
      submitCombatDecision(
        targetAction.state,
        {
          type: "pass",
          id: combatDecisionIdSchema.parse("decision:scheduled-damage-target-pass"),
          actorId: secondCombatantId,
          expectedStateVersion: targetAction.state.version,
        },
        dependencies,
      ),
    );
    const sourceUpkeep = requireTransition(advanceFight(targetPass.state, dependencies));
    const sourceAction = requireTransition(advanceFight(sourceUpkeep.state, dependencies));
    const sourcePass = requireTransition(
      submitCombatDecision(
        sourceAction.state,
        {
          type: "pass",
          id: combatDecisionIdSchema.parse("decision:scheduled-damage-source-pass"),
          actorId: firstCombatantId,
          expectedStateVersion: sourceAction.state.version,
        },
        dependencies,
      ),
    );
    const secondTargetUpkeep = requireTransition(advanceFight(sourcePass.state, dependencies));

    expect(secondTargetUpkeep.state.combatants[secondCombatantId].hitPoints.current).toBe(
      hitPointsAfterAttack - 35,
    );
    expect(secondTargetUpkeep.events).toContainEqual(
      expect.objectContaining({
        type: "damage-applied",
        sourceCombatantId: firstCombatantId,
        targetCombatantId: secondCombatantId,
        amount: 35,
      }),
    );
    expect(secondTargetUpkeep.events).not.toContainEqual(
      expect.objectContaining({ type: "hp-changed" }),
    );
    expect(
      secondTargetUpkeep.state.activeEffects.some((effect) => effect.type === "scheduled-resource"),
    ).toBe(false);
  });

  it("cancels matching scheduled work after a successful basic attack", () => {
    const dependencies = createTestCombatDependencies(
      [30, 1],
      new Date("2026-08-13T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:scheduled-basic-cancellation")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 20 }, (_, index) =>
          combatEventIdSchema.parse(`event:scheduled-basic-cancellation-${index + 1}`),
        ),
      },
    );
    const created = requireTransition(createFight(input, dependencies));
    const action = requireTransition(advanceFight(created.state, dependencies));
    const activeEffectId = activeEffectIdSchema.parse("active-effect:scheduled-basic-cancellation");
    const stateWithSchedule: ActiveFightState = {
      ...requireActiveFightState(action.state),
      activeEffects: [
        {
          id: activeEffectId,
          type: "scheduled-resource",
          sourceCombatantId: secondCombatantId,
          targetCombatantId: firstCombatantId,
          sourceDefinitionId: "move-afterlife-burning-shoot",
          sourceEffectIndex: 0,
          timing: { type: "turn-start", combatantId: firstCombatantId },
          remainingBoundaries: 1,
          repeat: "each-turn",
          resource: "hp",
          operation: "lose",
          amount: { type: "literal", value: 1 },
          cancellation: {
            actorCombatantId: firstCombatantId,
            result: "successful",
            moveSelector: {
              type: "move-selector",
              subject: "source",
              attackRoll: { dice: 1 },
              sourceText: "a single dice attack",
            },
            target: "source",
            rollThreshold: { roll: "attack", comparison: "at-least", value: 20 },
          },
        },
      ],
    };

    const transition = requireTransition(
      submitCombatDecision(
        stateWithSchedule,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:scheduled-basic-cancellation"),
          actorId: firstCombatantId,
          expectedStateVersion: stateWithSchedule.version,
          basicAttack: "basic-punch",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );

    expect(transition.events).toContainEqual(
      expect.objectContaining({ type: "attack-resolved", outcome: "successful" }),
    );
    expect(transition.state.activeEffects).not.toContainEqual(
      expect.objectContaining({ id: activeEffectId }),
    );
    expect(transition.state.version).toBe(stateWithSchedule.version + 1);
  });
});

describe("upkeep-phase effect dispatch", () => {
  it("activates durable modifiers for the active combatant at the upkeep boundary", () => {
    const dependencies = createTestCombatDependencies([], new Date("2026-08-12T12:00:00.000Z"), {
      fightIds: [fightIdSchema.parse("fight:upkeep-effects")],
      combatantIds: [firstCombatantId, secondCombatantId],
      activeEffectIds: [
        activeEffectIdSchema.parse("active-effect:upkeep-damage"),
        activeEffectIdSchema.parse("active-effect:upkeep-stat"),
        activeEffectIdSchema.parse("active-effect:upkeep-prevention"),
      ],
      eventIds: Array.from({ length: 8 }, (_, index) =>
        combatEventIdSchema.parse(`event:upkeep-effects-${index + 1}`),
      ),
    });
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 5, dexterityBonus: 0 },
              moveIds: ["move-afterlife-kaio-ken"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );

    const transition = requireTransition(advanceFight(created.state, dependencies));
    const activeState = requireActiveFightState(transition.state);

    expect(activeState.phase).toBe("action");
    expect(activeState.activeEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "active-effect:upkeep-stat",
          type: "modify-next-action",
          sourceDefinitionId: "move-afterlife-kaio-ken",
          remaining: 3,
        }),
        expect.objectContaining({
          id: "active-effect:upkeep-prevention",
          type: "modify-stat",
          sourceDefinitionId: "move-afterlife-kaio-ken",
          stat: "dexterity-bonus",
        }),
        expect.objectContaining({
          id: "active-effect:upkeep-damage",
          type: "prevent-move-modification",
          sourceDefinitionId: "move-afterlife-kaio-ken",
        }),
      ]),
    );
    expect(transition.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "effect-activated",
          sourceDefinitionId: "move-afterlife-kaio-ken",
        }),
      ]),
    );
  });
});

describe("numeric resource-derived roll effects", () => {
  it("resolves Energy Lob's opponent-KI result bonus at the public attack boundary", () => {
    const dependencies = createTestCombatDependencies(
      [20, 1],
      new Date("2026-08-12T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:energy-lob-resource-threshold")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 12 }, (_, index) =>
          combatEventIdSchema.parse(`event:energy-lob-resource-threshold-${index}`),
        ),
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
              moveIds: ["move-kurokonwaku-energy-lob"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const lowOpponentKi: ActiveFightState = {
      ...action,
      turnNumber: 10,
      combatants: {
        ...action.combatants,
        [secondCombatantId]: {
          ...action.combatants[secondCombatantId],
          ki: { ...action.combatants[secondCombatantId].ki, current: 2 },
        },
      },
    };
    const transition = requireTransition(
      submitCombatDecision(
        lowOpponentKi,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:energy-lob-resource-threshold"),
          actorId: firstCombatantId,
          expectedStateVersion: lowOpponentKi.version,
          moveId: "move-kurokonwaku-energy-lob",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );

    expect(transition.events).toContainEqual(
      expect.objectContaining({ type: "attack-rolled", naturalResult: 20, result: 23 }),
    );
    expect(transition.state.version).toBe(lowOpponentKi.version + 1);
  });

  it("resolves a multi-hit resource expression through a versioned public transition", () => {
    const dependencies = createTestCombatDependencies(
      [20, 1, 20, 1],
      new Date("2026-08-12T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:double-arm-cannon-resource")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 20 }, (_, index) =>
          combatEventIdSchema.parse(`event:double-arm-cannon-resource-${index}`),
        ),
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 5, dexterityBonus: 0 },
              moveIds: ["move-haokiru-double-arm-cannon"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const prepared: ActiveFightState = {
      ...action,
      combatants: {
        ...action.combatants,
        [firstCombatantId]: {
          ...action.combatants[firstCombatantId],
          hitPoints: { current: 80, maximum: 100 },
        },
      },
    };
    const transition = requireTransition(
      submitCombatDecision(
        prepared,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:double-arm-cannon-resource"),
          actorId: firstCombatantId,
          expectedStateVersion: prepared.version,
          moveId: "move-haokiru-double-arm-cannon",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );

    expect(transition.state.combatants[firstCombatantId].hitPoints.current).toBe(90);
    expect(transition.state.version).toBe(prepared.version + 1);
  });

  it("uses final dealt damage for a damage-percent healing resource effect", () => {
    const dependencies = createTestCombatDependencies(
      [20, 1],
      new Date("2026-08-12T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:rapture-final-damage")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: Array.from({ length: 4 }, (_, index) =>
          activeEffectIdSchema.parse(`active-effect:rapture-final-damage-${index}`),
        ),
        eventIds: Array.from({ length: 20 }, (_, index) =>
          combatEventIdSchema.parse(`event:rapture-final-damage-${index}`),
        ),
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 5, dexterityBonus: 0 },
              moveIds: ["move-haokiru-rapture"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const prepared: ActiveFightState = {
      ...action,
      turnNumber: 10,
      combatants: {
        ...action.combatants,
        [firstCombatantId]: {
          ...action.combatants[firstCombatantId],
          hitPoints: { current: 80, maximum: 100 },
          ki: { current: 8, maximum: 8 },
        },
        [secondCombatantId]: {
          ...action.combatants[secondCombatantId],
          hitPoints: { current: 15, maximum: 100 },
        },
      },
    };
    const transition = requireTransition(
      submitCombatDecision(
        prepared,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:rapture-final-damage"),
          actorId: firstCombatantId,
          expectedStateVersion: prepared.version,
          moveId: "move-haokiru-rapture",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );

    expect(transition.state.combatants[firstCombatantId].hitPoints.current).toBe(84);
    expect(transition.events).toContainEqual(
      expect.objectContaining({ type: "damage-applied", amount: 15 }),
    );
    expect(transition.state.version).toBe(prepared.version + 1);
  });
});

describe("move-modification prevention", () => {
  const createPreventionFight = (
    fightId: string,
    eventPrefix: string,
    random: readonly number[],
  ) => {
    const dependencies = createTestCombatDependencies(
      random,
      new Date("2026-08-13T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse(fightId)],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 20 }, (_, index) =>
          combatEventIdSchema.parse(`${eventPrefix}-${index + 1}`),
        ),
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 500,
              stats: { power: 100, dexterity: 5, dexterityBonus: 0 },
              moveIds: ["move-akaikaru-firewall"],
            },
            {
              maximumHitPoints: 500,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    return { action, dependencies };
  };

  it("blocks protected damage and result modifiers by their declared actor", () => {
    const { action, dependencies } = createPreventionFight(
      "fight:move-modification-prevention",
      "event:move-modification-prevention",
      [20, 1],
    );
    const prepared: ActiveFightState = {
      ...action,
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:five-finger-prevention"),
          type: "prevent-move-modification",
          sourceCombatantId: secondCombatantId,
          targetCombatantId: firstCombatantId,
          sourceDefinitionId: "move-haokiru-five-finger-shot",
          actor: "opponent",
          aspects: ["damage", "roll-results"],
          selector: {
            type: "move-selector",
            subject: "target",
            category: "advanced-attack",
            sourceText: "their attacks",
          },
          duration: { type: "combat" },
        },
        {
          id: activeEffectIdSchema.parse("active-effect:self-damage-modifier"),
          type: "modify-damage",
          sourceCombatantId: firstCombatantId,
          targetCombatantId: firstCombatantId,
          sourceDefinitionId: "move-akaikaru-firewall",
          operation: "add",
          basis: "power-percent",
          amount: 20,
          duration: { type: "combat" },
        },
        {
          id: activeEffectIdSchema.parse("active-effect:self-result-modifier"),
          type: "modify-roll",
          sourceCombatantId: firstCombatantId,
          targetCombatantId: firstCombatantId,
          sourceDefinitionId: "move-akaikaru-firewall",
          roll: "attack",
          modifier: "result",
          amount: 3,
          duration: "combat",
        },
      ],
    };

    const transition = requireTransition(
      submitCombatDecision(
        prepared,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:move-modification-prevention"),
          actorId: firstCombatantId,
          expectedStateVersion: prepared.version,
          moveId: "move-akaikaru-firewall",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );
    const resolved = requireActiveFightState(transition.state);

    expect(transition.events).toContainEqual(
      expect.objectContaining({ type: "attack-rolled", naturalResult: 20, result: 20 }),
    );
    expect(resolved.combatants[secondCombatantId]?.hitPoints.current).toBe(455);
    expect(resolved.version).toBe(prepared.version + 1);
  });

  it("blocks opponent damage reductions while preserving declared status exceptions", () => {
    const { action, dependencies } = createPreventionFight(
      "fight:damage-reduction-prevention",
      "event:damage-reduction-prevention",
      [20, 1],
    );
    const prepared: ActiveFightState = {
      ...action,
      combatants: {
        ...action.combatants,
        [firstCombatantId]: {
          ...action.combatants[firstCombatantId]!,
          activeStatuses: [
            {
              statusId: "break",
              sourceCombatantId: secondCombatantId,
              sourceDefinitionId: "move-afterlife-meteor-smash",
              stacks: 1,
              duration: { type: "combat" },
            },
          ],
        },
      },
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:heat-dome-prevention"),
          type: "prevent-move-modification",
          sourceCombatantId: firstCombatantId,
          targetCombatantId: firstCombatantId,
          sourceDefinitionId: "move-afterlife-heat-dome-attack",
          actor: "opponent",
          aspects: ["damage"],
          operations: ["reduce"],
          exceptSourceStatusIds: ["break", "sever"],
          selector: {
            type: "move-selector",
            subject: "source",
            categories: ["advanced-attack", "signature"],
            sourceText: "your attacks",
          },
          duration: { type: "combat" },
        },
        {
          id: activeEffectIdSchema.parse("active-effect:opponent-damage-reduction"),
          type: "modify-damage",
          sourceCombatantId: secondCombatantId,
          targetCombatantId: firstCombatantId,
          sourceDefinitionId: "move-haokiru-neutralization",
          operation: "add",
          basis: "power-percent",
          amount: -20,
          duration: { type: "combat" },
        },
      ],
    };

    const transition = requireTransition(
      submitCombatDecision(
        prepared,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:damage-reduction-prevention"),
          actorId: firstCombatantId,
          expectedStateVersion: prepared.version,
          moveId: "move-akaikaru-firewall",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );
    const resolved = requireActiveFightState(transition.state);

    expect(resolved.combatants[secondCombatantId]?.hitPoints.current).toBe(459);
    expect(resolved.version).toBe(prepared.version + 1);
  });
});

describe("on-move-use effect dispatch", () => {
  it("uses an additive current-action tag for Chained Mastery's generic move listener", () => {
    const dependencies = createTestCombatDependencies(
      [30, 1, 30, 1, 30, 1, 30, 1],
      new Date("2026-08-12T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:on-move-use-floating")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: Array.from({ length: 8 }, (_, index) =>
          activeEffectIdSchema.parse(`active-effect:chained-floating-${index}`),
        ),
        eventIds: Array.from({ length: 24 }, (_, index) =>
          combatEventIdSchema.parse(`event:on-move-use-floating-${index}`),
        ),
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 200,
              stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
              moveIds: ["move-akaikaru-chained-mastery", "move-akaikaru-no-shadow-kick"],
            },
            {
              maximumHitPoints: 200,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const prepared = {
      ...action,
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:chained-mastery"),
          type: "active-constant" as const,
          sourceCombatantId: firstCombatantId,
          targetCombatantId: firstCombatantId,
          sourceDefinitionId: "move-akaikaru-chained-mastery" as const,
          activatedOnTurn: action.turnNumber,
          duration: "combat" as const,
        },
      ],
    } satisfies ActiveFightState;
    const transition = requireTransition(
      submitCombatDecision(
        prepared,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:on-move-use-floating"),
          actorId: firstCombatantId,
          expectedStateVersion: prepared.version,
          moveId: "move-akaikaru-no-shadow-kick",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );

    expect(transition.state.version).toBe(prepared.version + 1);
    expect(transition.state.activeEffects).toContainEqual(
      expect.objectContaining({
        type: "floating-effect",
        sourceDefinitionId: "move-akaikaru-chained-mastery",
        floatingEffectId: "chained-mastery-next-turn-kick-follow-up",
        targetCombatantId: firstCombatantId,
        scope: { type: "next-turn", combatantId: firstCombatantId },
      }),
    );
  });

  it("persists an explicitly combat-duration floating bundle through the public attack transition", () => {
    const dependencies = createTestCombatDependencies(
      [30, 1],
      new Date("2026-08-14T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:rising-sun-floating")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: [activeEffectIdSchema.parse("active-effect:rising-sun")],
        eventIds: Array.from({ length: 24 }, (_, index) =>
          combatEventIdSchema.parse(`event:rising-sun-floating-${index}`),
        ),
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 200,
              stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
              moveIds: ["move-kiihakai-the-rising-sun"],
            },
            {
              maximumHitPoints: 200,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const prepared = {
      ...action,
      turnNumber: 10,
      combatants: {
        ...action.combatants,
        [firstCombatantId]: {
          ...action.combatants[firstCombatantId],
          ki: { ...action.combatants[firstCombatantId].ki, current: 9 },
        },
      },
    } satisfies ActiveFightState;
    const transition = requireTransition(
      submitCombatDecision(
        prepared,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:rising-sun-floating"),
          actorId: firstCombatantId,
          expectedStateVersion: prepared.version,
          moveId: "move-kiihakai-the-rising-sun",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );

    expect(transition.state.version).toBe(prepared.version + 1);
    expect(transition.state.activeEffects).toContainEqual(
      expect.objectContaining({
        type: "floating-effect",
        floatingEffectId: "the-rising-sun-physical-attack-retaliation",
        sourceDefinitionId: "move-kiihakai-the-rising-sun",
        targetCombatantId: secondCombatantId,
        scope: { type: "combat" },
      }),
    );
  });
});

describe("generic combat-result overrides", () => {
  it("applies a passive current-attack SUCCESSFUL result in a versioned transition", () => {
    const dependencies = createTestCombatDependencies(
      [1, 30],
      new Date("2026-08-12T13:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:back-suplex-result")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 16 }, (_, index) =>
          combatEventIdSchema.parse(`event:back-suplex-result-${index}`),
        ),
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 2, dexterityBonus: 0 },
              moveIds: ["move-midorikatai-back-suplex"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const transition = requireTransition(
      submitCombatDecision(
        action,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:back-suplex-result"),
          actorId: firstCombatantId,
          expectedStateVersion: action.version,
          moveId: "move-midorikatai-back-suplex",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );

    expect(transition.state.version).toBe(action.version + 1);
    expect(transition.events).toContainEqual(
      expect.objectContaining({ type: "attack-resolved", outcome: "successful" }),
    );
    expect(transition.events).toContainEqual(
      expect.objectContaining({ type: "damage-applied", amount: 11, remainingHitPoints: 89 }),
    );
  });
});

describe("generic critical thresholds", () => {
  it("applies Volcanic Smash's final-result threshold in a versioned transition", () => {
    const dependencies = createTestCombatDependencies(
      [28, 1],
      new Date("2026-08-13T14:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:volcanic-critical-threshold")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 16 }, (_, index) =>
          combatEventIdSchema.parse(`event:volcanic-critical-threshold-${index}`),
        ),
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 5, dexterityBonus: 2 },
              moveIds: ["move-akaikaru-volcanic-smash"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 4, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const transition = requireTransition(
      submitCombatDecision(
        action,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:volcanic-critical-threshold"),
          actorId: firstCombatantId,
          expectedStateVersion: action.version,
          moveId: "move-akaikaru-volcanic-smash",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );

    expect(transition.state.version).toBe(action.version + 1);
    expect(transition.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "attack-rolled", naturalResult: 28, result: 30 }),
        expect.objectContaining({
          type: "attack-resolved",
          moveId: "move-akaikaru-volcanic-smash",
          critical: true,
        }),
        expect.objectContaining({ type: "damage-applied", amount: 18 }),
      ]),
    );
    expect(transition.state.actionHistory).toContainEqual(
      expect.objectContaining({
        moveId: "move-akaikaru-volcanic-smash",
        attackRollResult: 30,
        critical: true,
      }),
    );
  });

  it("requires Crescent Kick's typed prior-action condition", () => {
    const dependencies = createTestCombatDependencies(
      [28, 1],
      new Date("2026-08-13T14:05:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:crescent-critical-threshold")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 16 }, (_, index) =>
          combatEventIdSchema.parse(`event:crescent-critical-threshold-${index}`),
        ),
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 5, dexterityBonus: 2 },
              moveIds: ["move-aoyosumu-crescent-kick"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 4, dexterityBonus: 0 },
              moveIds: ["move-midorikatai-rocket-fire"],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const prepared = {
      ...action,
      actionHistory: [
        {
          type: "use-move" as const,
          decisionId: combatDecisionIdSchema.parse("decision:prior-stopped-rocket-fire"),
          actorId: secondCombatantId,
          targetCombatantId: firstCombatantId,
          moveId: "move-midorikatai-rocket-fire" as const,
          turnNumber: action.turnNumber,
          phase: "action" as const,
          outcome: "stopped" as const,
          critical: false,
          counter: false,
        },
      ],
    } satisfies ActiveFightState;
    const transition = requireTransition(
      submitCombatDecision(
        prepared,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:crescent-critical-threshold"),
          actorId: firstCombatantId,
          expectedStateVersion: prepared.version,
          moveId: "move-aoyosumu-crescent-kick",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );

    expect(transition.state.version).toBe(prepared.version + 1);
    expect(transition.events).toContainEqual(
      expect.objectContaining({
        type: "attack-resolved",
        moveId: "move-aoyosumu-crescent-kick",
        critical: true,
      }),
    );
  });

  it("applies Critical Mass only to a matching typed base-roll selector", () => {
    const dependencies = createTestCombatDependencies(
      [28, 1],
      new Date("2026-08-13T14:10:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:critical-mass-threshold")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: [activeEffectIdSchema.parse("active-effect:critical-mass-rocket-fire")],
        eventIds: Array.from({ length: 20 }, (_, index) =>
          combatEventIdSchema.parse(`event:critical-mass-threshold-${index}`),
        ),
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 5, dexterityBonus: 1 },
              moveIds: ["move-midorikatai-critical-mass-mastery", "move-midorikatai-rocket-fire"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 4, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const transition = requireTransition(
      submitCombatDecision(
        action,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:critical-mass-threshold"),
          actorId: firstCombatantId,
          expectedStateVersion: action.version,
          moveId: "move-midorikatai-rocket-fire",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );

    expect(transition.state.version).toBe(action.version + 1);
    expect(transition.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "attack-resolved",
          moveId: "move-midorikatai-rocket-fire",
          critical: true,
        }),
        expect.objectContaining({ type: "damage-applied", amount: 22 }),
      ]),
    );
  });
});

describe("generic stat modifiers", () => {
  it("persists a resolved dexterity replacement in a versioned transition", () => {
    const dependencies = createTestCombatDependencies(
      [20, 1],
      new Date("2026-08-12T13:15:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:rocket-fire-stat")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: [activeEffectIdSchema.parse("active-effect:rocket-fire-stat")],
        eventIds: Array.from({ length: 16 }, (_, index) =>
          combatEventIdSchema.parse(`event:rocket-fire-stat-${index}`),
        ),
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 2, dexterityBonus: 0 },
              moveIds: ["move-midorikatai-rocket-fire"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const transition = requireTransition(
      submitCombatDecision(
        action,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:rocket-fire-stat"),
          actorId: firstCombatantId,
          expectedStateVersion: action.version,
          moveId: "move-midorikatai-rocket-fire",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );

    expect(transition.state.version).toBe(action.version + 1);
    expect(transition.state.activeEffects).toEqual([
      expect.objectContaining({
        id: "active-effect:rocket-fire-stat",
        type: "modify-stat",
        stat: "dexterity",
        operation: "set",
        amount: 1,
        duration: { type: "turns", ownerCombatantId: firstCombatantId, remaining: 2 },
      }),
    ]);
  });
});

describe("initial turn progression", () => {
  it("persists a successful move's generic next-roll modifier with its selector", () => {
    const dependencies = createTestCombatDependencies(
      [20, 1, 10, 1],
      new Date("2026-08-08T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:sword-blast-next-roll")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: [activeEffectIdSchema.parse("active-effect:sword-blast-next-roll")],
        eventIds: Array.from({ length: 20 }, (_, index) =>
          combatEventIdSchema.parse(`event:sword-blast-next-roll-${index}`),
        ),
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 5, dexterityBonus: 0 },
              moveIds: ["move-afterlife-sword-blast"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 5, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );
    const firstAction = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const swordBlast = requireTransition(
      submitCombatDecision(
        firstAction,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:sword-blast-next-roll"),
          actorId: firstCombatantId,
          expectedStateVersion: firstAction.version,
          moveId: "move-afterlife-sword-blast",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );
    expect(swordBlast.state.activeEffects).toContainEqual(
      expect.objectContaining({
        type: "modify-next-action",
        targetCombatantId: firstCombatantId,
        modifier: { type: "roll", roll: "attack", modifier: "sides", amount: 3 },
        selector: expect.objectContaining({ category: "advanced-attack" }),
      }),
    );
  });

  it("enforces persisted prevent-move-use selectors in legal actions and direct submissions", () => {
    const { state, dependencies } = createInitialState();
    const action = requireActiveFightState(
      requireTransition(advanceFight(state, dependencies)).state,
    );
    const prevented: ActiveFightState = {
      ...action,
      activeEffects: [
        {
          id: "active-effect:prevent-hidden-power-level" as never,
          type: "prevent-move-use",
          sourceCombatantId: secondCombatantId,
          targetCombatantId: firstCombatantId,
          sourceDefinitionId: "move-kurokonwaku-shadow-stalker",
          operation: "use",
          selector: {
            type: "move-selector",
            subject: "target",
            ids: ["move-freestyle-hidden-power-level"],
            sourceText: "Hidden Power Level",
          },
          duration: { type: "combat" },
        },
      ],
    };
    expect(enumerateLegalDecisions(prevented, firstCombatantId)).not.toContainEqual(
      expect.objectContaining({ type: "use-move", moveId: "move-freestyle-hidden-power-level" }),
    );
    expect(
      submitCombatDecision(
        prevented,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:prevent-move-use"),
          actorId: firstCombatantId,
          expectedStateVersion: prevented.version,
          moveId: "move-freestyle-hidden-power-level",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    ).toMatchObject({ ok: false, error: { type: "illegal-decision" } });
  });

  it("blocks a persisted generic resource gain before the public power-up transition", () => {
    const { state, dependencies } = createInitialState();
    const action = requireActiveFightState(
      requireTransition(advanceFight(state, dependencies)).state,
    );
    const prevented: ActiveFightState = {
      ...action,
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:prevent-ki-gain"),
          type: "prevent-resource-modification",
          sourceCombatantId: secondCombatantId,
          targetCombatantId: firstCombatantId,
          sourceDefinitionId: "move-afterlife-vanishing-ball",
          resource: "ki",
          operation: "gain",
          duration: { type: "combat" },
        },
      ],
    };
    const kiBefore = prevented.combatants[firstCombatantId].ki.current;
    const transition = requireTransition(
      submitCombatDecision(
        prevented,
        {
          type: "power-up",
          id: combatDecisionIdSchema.parse("decision:prevent-ki-gain"),
          actorId: firstCombatantId,
          expectedStateVersion: prevented.version,
        },
        dependencies,
      ),
    );

    expect(transition.state.combatants[firstCombatantId].ki.current).toBe(kiBefore);
    expect(transition.events).not.toContainEqual(
      expect.objectContaining({ type: "ki-gained", combatantId: firstCombatantId }),
    );
    expect(transition.state.version).toBe(prevented.version + 1);
  });

  it("does not block a combatant's own resource gain when prevention is opponent-only", () => {
    const { state, dependencies } = createInitialState();
    const action = requireActiveFightState(
      requireTransition(advanceFight(state, dependencies)).state,
    );
    const prevented: ActiveFightState = {
      ...action,
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:prevent-opponent-ki-gain"),
          type: "prevent-resource-modification",
          sourceCombatantId: secondCombatantId,
          targetCombatantId: firstCombatantId,
          sourceDefinitionId: "move-afterlife-vanishing-ball",
          resource: "ki",
          operation: "gain",
          sourceActor: "opponent",
          duration: { type: "combat" },
        },
      ],
    };
    const kiBefore = prevented.combatants[firstCombatantId].ki.current;
    const transition = requireTransition(
      submitCombatDecision(
        prevented,
        {
          type: "power-up",
          id: combatDecisionIdSchema.parse("decision:opponent-only-ki-gain"),
          actorId: firstCombatantId,
          expectedStateVersion: prevented.version,
        },
        dependencies,
      ),
    );

    expect(transition.state.combatants[firstCombatantId].ki.current).toBeGreaterThan(kiBefore);
  });

  it("enforces a serialized selector lock in legal actions and direct submissions", () => {
    const dependencies = createTestCombatDependencies(
      [30, 1],
      new Date("2026-08-04T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:selector-lock")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 8 }, (_, index) =>
          combatEventIdSchema.parse(`event:selector-lock-${index}`),
        ),
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 5, dexterityBonus: 0 },
              moveIds: ["move-aoyosumu-heart-punch"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 5, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const locked: ActiveFightState = {
      ...action,
      activeEffects: [
        {
          id: "active-effect:heart-punch-lock" as never,
          type: "action-lock",
          sourceCombatantId: secondCombatantId,
          targetCombatantId: firstCombatantId,
          sourceDefinitionId: "move-afterlife-time-freeze",
          affectedType: "attack",
          selector: {
            type: "move-selector",
            subject: "target",
            ids: ["move-aoyosumu-heart-punch"],
            sourceText: "Heart Punch",
          },
          duration: { type: "combat" },
        },
      ],
    };
    expect(enumerateLegalDecisions(locked, firstCombatantId)).not.toContainEqual(
      expect.objectContaining({ type: "use-move", moveId: "move-aoyosumu-heart-punch" }),
    );
    expect(
      submitCombatDecision(
        locked,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:locked-heart-punch"),
          actorId: firstCombatantId,
          expectedStateVersion: locked.version,
          moveId: "move-aoyosumu-heart-punch",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    ).toEqual({ ok: false, error: { type: "illegal-decision", decisionType: "use-move" } });
  });

  it("activates an on-success converted lock as a versioned combat effect", () => {
    const dependencies = createTestCombatDependencies(
      [30, 1, 20, 1],
      new Date("2026-08-04T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:dodon-lock")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 20 }, (_, index) =>
          combatEventIdSchema.parse(`event:dodon-lock-${index}`),
        ),
        activeEffectIds: ["active-effect:dodon-lock" as never],
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 5, dexterityBonus: 0 },
              moveIds: ["move-afterlife-dodon-ray"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 5, dexterityBonus: 0 },
              moveIds: ["move-afterlife-give-me-energy"],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const resolved = requireTransition(
      submitCombatDecision(
        action,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:dodon-ray"),
          actorId: firstCombatantId,
          expectedStateVersion: action.version,
          moveId: "move-afterlife-dodon-ray",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );
    const state = requireActiveFightState(resolved.state);
    expect(state.activeEffects).toContainEqual(
      expect.objectContaining({
        id: "active-effect:dodon-lock",
        type: "action-lock",
        affectedType: "skill",
        targetCombatantId: secondCombatantId,
        duration: { type: "combat" },
      }),
    );
    expect(resolved.events).toContainEqual(
      expect.objectContaining({
        type: "effect-activated",
        activeEffectId: "active-effect:dodon-lock",
      }),
    );
  });

  it("persists and consumes a next-action successful-effect suppression", () => {
    const dependencies = createTestCombatDependencies(
      [30, 1, 30, 1],
      new Date("2026-08-12T14:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:power-drill-suppression")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: [activeEffectIdSchema.parse("active-effect:power-drill-suppression")],
        eventIds: Array.from({ length: 32 }, (_, index) =>
          combatEventIdSchema.parse(`event:power-drill-suppression-${index}`),
        ),
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 5, dexterityBonus: 0 },
              moveIds: ["move-midorikatai-power-drill"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: ["move-midorikatai-rocket-fire"],
            },
          ],
        },
        dependencies,
      ),
    );
    const firstAction = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const firstAttack = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          firstAction,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:power-drill-suppression-source"),
            actorId: firstCombatantId,
            expectedStateVersion: firstAction.version,
            moveId: "move-midorikatai-power-drill",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );
    expect(firstAttack.activeEffects).toContainEqual(
      expect.objectContaining({
        id: "active-effect:power-drill-suppression",
        type: "suppress",
        targetCombatantId: secondCombatantId,
        aspects: ["successful-effects"],
        duration: {
          type: "next-actions",
          ownerCombatantId: secondCombatantId,
          remaining: 1,
        },
      }),
    );
    expect(firstAttack.version).toBe(firstAction.version + 1);

    const opponentUpkeep = requireTransition(advanceFight(firstAttack, dependencies));
    const opponentAction = requireTransition(advanceFight(opponentUpkeep.state, dependencies));
    const secondAttackTransition = requireTransition(
      submitCombatDecision(
        opponentAction.state,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:power-drill-suppression-consumer"),
          actorId: secondCombatantId,
          expectedStateVersion: opponentAction.state.version,
          moveId: "move-midorikatai-rocket-fire",
          targetCombatantId: firstCombatantId,
        },
        dependencies,
      ),
    );
    const secondAttack = requireActiveFightState(secondAttackTransition.state);
    expect(secondAttackTransition.events).toContainEqual(
      expect.objectContaining({ type: "attack-resolved", outcome: "successful" }),
    );
    expect(secondAttack.activeEffects).not.toContainEqual(
      expect.objectContaining({
        type: "modify-stat",
        sourceDefinitionId: "move-midorikatai-rocket-fire",
      }),
    );
    expect(secondAttack.activeEffects).not.toContainEqual(
      expect.objectContaining({ id: "active-effect:power-drill-suppression" }),
    );
  });

  it("persists a converted floating bundle through a successful attack transition", () => {
    const dependencies = createTestCombatDependencies(
      [30, 1, 30, 1],
      new Date("2026-08-04T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:anger-floating")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 32 }, (_, index) =>
          combatEventIdSchema.parse(`event:anger-floating-${index}`),
        ),
        activeEffectIds: [activeEffectIdSchema.parse("active-effect:anger-floating")],
      },
    );
    const created = requireActiveFightState(
      requireTransition(
        createFight(
          {
            mode: "spar",
            combatants: [
              {
                maximumHitPoints: 100,
                stats: { power: 20, dexterity: 5, dexterityBonus: 0 },
                moveIds: ["move-akaikaru-anger-management"],
              },
              {
                maximumHitPoints: 100,
                stats: { power: 20, dexterity: 5, dexterityBonus: 0 },
                moveIds: [],
              },
            ],
          },
          dependencies,
        ),
      ).state,
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created, dependencies)).state,
    );
    const resolved = requireTransition(
      submitCombatDecision(
        action,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:anger-floating"),
          actorId: firstCombatantId,
          expectedStateVersion: action.version,
          moveId: "move-akaikaru-anger-management",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );

    expect(requireActiveFightState(resolved.state).activeEffects).toContainEqual(
      expect.objectContaining({
        id: "active-effect:anger-floating",
        type: "floating-effect",
        floatingEffectId: "anger-management-next-single-die-stun",
        scope: { type: "combat" },
      }),
    );
  });

  it("rolls and expires a turn-start threshold lock deterministically", () => {
    const dependencies = createTestCombatDependencies(
      [30, 1, 20],
      new Date("2026-08-04T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:turn-start-lock")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 8 }, (_, index) =>
          combatEventIdSchema.parse(`event:turn-start-lock-${index}`),
        ),
      },
    );
    const created = requireActiveFightState(
      requireTransition(
        createFight(
          {
            mode: "spar",
            combatants: [
              {
                maximumHitPoints: 100,
                stats: { power: 20, dexterity: 5, dexterityBonus: 0 },
                moveIds: [],
              },
              {
                maximumHitPoints: 100,
                stats: { power: 20, dexterity: 5, dexterityBonus: 0 },
                moveIds: [],
              },
            ],
          },
          dependencies,
        ),
      ).state,
    );
    const locked: ActiveFightState = {
      ...created,
      activeEffects: [
        {
          id: "active-effect:turn-start-lock" as never,
          type: "action-lock",
          sourceCombatantId: secondCombatantId,
          targetCombatantId: firstCombatantId,
          sourceDefinitionId: "move-kurokonwaku-sweet-dreams",
          affectedType: "attack",
          duration: {
            type: "until-turn-start-roll-threshold",
            combatantId: firstCombatantId,
            dice: 1,
            sides: 30,
            comparison: "at-least",
            value: 20,
            remainingIgnoredChecks: 0,
          },
        },
      ],
    };
    const transition = requireTransition(advanceFight(locked, dependencies));

    expect(transition.state.activeEffects).toEqual([]);
    expect(transition.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "effect-rolled",
          activeEffectId: "active-effect:turn-start-lock",
          naturalResult: 20,
        }),
        expect.objectContaining({
          type: "effect-expired",
          activeEffectId: "active-effect:turn-start-lock",
        }),
      ]),
    );
  });

  it("offers and resolves a declared pre-roll defense item reaction exactly once", () => {
    const dependencies = createTestCombatDependencies(
      [11, 10],
      new Date("2026-08-06T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:outfit-defense")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 12 }, (_, index) =>
          combatEventIdSchema.parse(`event:outfit-defense-${index}`),
        ),
        pendingDecisionIds: [pendingDecisionIdSchema.parse("pending-decision:outfit-defense")],
        resolutionFrameIds: ["resolution-frame:outfit-defense" as never],
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 10, dexterity: 2, dexterityBonus: 0 },
              moveIds: [],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 10, dexterity: 1, dexterityBonus: 0 },
              moveIds: [],
              itemIds: ["item-equipment-supreme-kai-outfit"],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireTransition(advanceFight(created.state, dependencies));
    const requested = requireTransition(
      submitCombatDecision(
        action.state,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:outfit-attack"),
          actorId: firstCombatantId,
          expectedStateVersion: 1,
          basicAttack: "basic-punch",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );
    const pending = requireActiveFightState(requested.state).pendingDecision;
    expect(pending).toMatchObject({
      id: pendingDecisionIdSchema.parse("pending-decision:outfit-defense"),
      combatantId: secondCombatantId,
      options: expect.arrayContaining([
        {
          id: "activate-item:item-equipment-supreme-kai-outfit",
          type: "activate-effect",
          itemId: "item-equipment-supreme-kai-outfit",
        },
      ]),
    });
    if (pending === undefined) throw new Error("Expected an outfit defense decision.");

    const resolved = requireTransition(
      submitCombatDecision(
        requested.state,
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:activate-outfit"),
          actorId: secondCombatantId,
          expectedStateVersion: 2,
          pendingDecisionId: pending.id,
          optionId: "activate-item:item-equipment-supreme-kai-outfit",
        },
        dependencies,
      ),
    );
    expect(resolved.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "item-used", itemId: "item-equipment-supreme-kai-outfit" }),
        expect.objectContaining({ type: "defense-rolled", naturalResult: 10, result: 13 }),
        expect.objectContaining({ type: "attack-resolved", outcome: "stopped" }),
      ]),
    );
    expect(resolved.state.combatants[secondCombatantId].itemUses).toEqual({
      "item-equipment-supreme-kai-outfit": 1,
    });
    expect(resolved.state.actionHistory).toContainEqual(
      expect.objectContaining({
        type: "use-item",
        actorId: secondCombatantId,
        itemId: "item-equipment-supreme-kai-outfit",
      }),
    );
  });

  it("resolves a structured non-attack action move with cost, resource effects, and its combat use limit", () => {
    const dependencies = createTestCombatDependencies([], new Date("2026-08-06T12:00:00.000Z"), {
      fightIds: [fightIdSchema.parse("fight:action-skill")],
      combatantIds: [firstCombatantId, secondCombatantId],
      eventIds: [
        "event:skill-started",
        "event:skill-turn",
        "event:skill-action",
        "event:skill-used",
        "event:skill-user-ki",
        "event:skill-target-ki",
        "event:skill-end",
      ].map((id) => combatEventIdSchema.parse(id)),
    });
    const fight = createFight(
      {
        mode: "spar",
        combatants: [
          {
            maximumHitPoints: 100,
            stats: { power: 10, dexterity: 2, dexterityBonus: 0 },
            moveIds: ["move-afterlife-special-fighting-pose-4"],
          },
          {
            maximumHitPoints: 100,
            stats: { power: 10, dexterity: 1, dexterityBonus: 0 },
            moveIds: [],
          },
        ],
      },
      dependencies,
    );
    const created = requireTransition(fight);
    const action = requireTransition(advanceFight(created.state, dependencies));
    expect(enumerateLegalDecisions(action.state, firstCombatantId)).toContainEqual({
      type: "use-move",
      actorId: firstCombatantId,
      moveId: "move-afterlife-special-fighting-pose-4",
      targetCombatantId: secondCombatantId,
    });

    const resolved = requireTransition(
      submitCombatDecision(
        action.state,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:special-fighting-pose-4"),
          actorId: firstCombatantId,
          expectedStateVersion: 1,
          moveId: "move-afterlife-special-fighting-pose-4",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );
    expect(resolved.state).toMatchObject({ version: 2, phase: "end" });
    expect(resolved.state.combatants[firstCombatantId]).toMatchObject({
      ki: { current: 6 },
      moveUses: { "move-afterlife-special-fighting-pose-4": 1 },
    });
    expect(resolved.state.combatants[secondCombatantId].ki.current).toBe(4);
    expect(enumerateLegalDecisions(resolved.state, firstCombatantId)).not.toContainEqual(
      expect.objectContaining({
        type: "use-move",
        moveId: "move-afterlife-special-fighting-pose-4",
      }),
    );
  });

  it("applies and consumes a structured next-action roll modifier", () => {
    const dependencies = createTestCombatDependencies(
      [33, 1],
      new Date("2026-08-06T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:action-modifier")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: ["active-effect:fighting-pose-2" as never],
        eventIds: Array.from({ length: 11 }, (_, index) =>
          combatEventIdSchema.parse(`event:action-modifier-${index}`),
        ),
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 10, dexterity: 2, dexterityBonus: 0 },
              moveIds: ["move-afterlife-special-fighting-pose-2"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 10, dexterity: 1, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireTransition(advanceFight(created.state, dependencies));
    const pose = requireTransition(
      submitCombatDecision(
        action.state,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:special-fighting-pose-2"),
          actorId: firstCombatantId,
          expectedStateVersion: 1,
          moveId: "move-afterlife-special-fighting-pose-2",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );
    if (pose.state.status !== "active") throw new Error("Expected active fight.");
    expect(pose.state.activeEffects).toEqual([
      expect.objectContaining({
        type: "modify-next-action",
        modifier: { type: "roll", roll: "attack", modifier: "sides", amount: 3 },
      }),
    ]);

    const attackState: ActiveFightState = { ...pose.state, phase: "action" };
    const attack = requireTransition(
      submitCombatDecision(
        attackState,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:pose-boosted-attack"),
          actorId: firstCombatantId,
          expectedStateVersion: 2,
          basicAttack: "basic-punch",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );
    expect(attack.events).toContainEqual(
      expect.objectContaining({ type: "attack-rolled", naturalResult: 33, result: 33 }),
    );
    expect(attack.state.activeEffects).toEqual([]);
  });

  it("applies and consumes a structured next-action damage modifier", () => {
    const dependencies = createTestCombatDependencies(
      [28, 1],
      new Date("2026-08-06T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:damage-modifier")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: ["active-effect:fighting-pose-1" as never],
        eventIds: Array.from({ length: 11 }, (_, index) =>
          combatEventIdSchema.parse(`event:damage-modifier-${index}`),
        ),
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 10, dexterity: 2, dexterityBonus: 0 },
              moveIds: ["move-afterlife-special-fighting-pose-1"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 10, dexterity: 1, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireTransition(advanceFight(created.state, dependencies));
    const pose = requireTransition(
      submitCombatDecision(
        action.state,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:special-fighting-pose-1"),
          actorId: firstCombatantId,
          expectedStateVersion: 1,
          moveId: "move-afterlife-special-fighting-pose-1",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );
    if (pose.state.status !== "active") throw new Error("Expected active fight.");
    expect(pose.state.activeEffects).toEqual([
      expect.objectContaining({
        type: "modify-next-action",
        modifier: { type: "damage", amount: 1 },
      }),
    ]);

    const attack = requireTransition(
      submitCombatDecision(
        { ...pose.state, phase: "action" },
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:pose-damage-attack"),
          actorId: firstCombatantId,
          expectedStateVersion: 2,
          basicAttack: "basic-punch",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );
    expect(attack.events).toContainEqual(
      expect.objectContaining({ type: "damage-applied", amount: 2 }),
    );
    expect(attack.state.activeEffects).toEqual([]);
  });

  it("applies a successful current-action damage modifier through the public transition", () => {
    const dependencies = createTestCombatDependencies(
      [28, 1],
      new Date("2026-08-09T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:current-action-damage")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 12 }, (_, index) =>
          combatEventIdSchema.parse(`event:current-action-damage-${index}`),
        ),
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 2, dexterityBonus: 0 },
              moveIds: ["move-afterlife-kamehameha"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const attack = requireTransition(
      submitCombatDecision(
        action,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:current-action-damage"),
          actorId: firstCombatantId,
          expectedStateVersion: action.version,
          moveId: "move-afterlife-kamehameha",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );

    expect(attack.state.version).toBe(action.version + 1);
    expect(attack.events).toContainEqual(
      expect.objectContaining({ type: "damage-applied", amount: 13, remainingHitPoints: 87 }),
    );
    expect(attack.state.status).toBe("active");
    expect(attack.state.combatants[secondCombatantId].hitPoints.current).toBe(87);
  });

  it("uses resource comparisons for legal cost reduction and successful damage scheduling", () => {
    const dependencies = createTestCombatDependencies(
      [28, 1],
      new Date("2026-08-11T13:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:resource-comparison")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: [activeEffectIdSchema.parse("active-effect:resource-comparison")],
        eventIds: Array.from({ length: 20 }, (_, index) =>
          combatEventIdSchema.parse(`event:resource-comparison-${index}`),
        ),
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 2, dexterityBonus: 0 },
              moveIds: [],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const attackerId = action.activeCombatantId;
    const targetId = attackerId === firstCombatantId ? secondCombatantId : firstCombatantId;
    const actionState: ActiveFightState = {
      ...action,
      turnNumber: 10,
      combatants: {
        ...action.combatants,
        [attackerId]: {
          ...action.combatants[attackerId],
          hitPoints: { current: 50, maximum: 100 },
          moveIds: ["move-haokiru-focused-spirit-cutter"],
        },
        [targetId]: {
          ...action.combatants[targetId],
          hitPoints: { current: 100, maximum: 100 },
          moveIds: [],
        },
      },
    };

    expect(enumerateLegalDecisions(actionState, attackerId)).toContainEqual({
      type: "use-move",
      actorId: attackerId,
      moveId: "move-haokiru-focused-spirit-cutter",
      targetCombatantId: targetId,
    });
    const attack = requireTransition(
      submitCombatDecision(
        actionState,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:resource-comparison"),
          actorId: attackerId,
          expectedStateVersion: actionState.version,
          moveId: "move-haokiru-focused-spirit-cutter",
          targetCombatantId: targetId,
        },
        dependencies,
      ),
    );

    expect(attack.state.version).toBe(actionState.version + 1);
    expect(attack.state.combatants[attackerId].ki.current).toBe(3);
    expect(attack.events).toContainEqual(
      expect.objectContaining({ type: "damage-applied", amount: 8 }),
    );
    expect(attack.state.activeEffects).toContainEqual(
      expect.objectContaining({
        type: "modify-next-action",
        targetCombatantId: targetId,
        modifier: { type: "damage", amount: -50 },
      }),
    );
  });

  it("clamps a converted current-action damage modifier at its declarative cap", () => {
    const dependencies = createTestCombatDependencies(
      Array.from({ length: 20 }, () => 1),
      new Date("2026-08-11T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:damage-cap")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 12 }, (_, index) =>
          combatEventIdSchema.parse(`event:damage-cap-${index}`),
        ),
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 6, dexterityBonus: 0 },
              moveIds: ["move-aoyosumu-slow-charge"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 5, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );
    const initial = requireActiveFightState(created.state);
    const activeId = initial.activeCombatantId;
    const targetId = activeId === firstCombatantId ? secondCombatantId : firstCombatantId;
    const actionState: ActiveFightState = {
      ...initial,
      turnNumber: 20,
      phase: "action",
      combatants: {
        ...initial.combatants,
        [activeId]: {
          ...initial.combatants[activeId],
          moveIds: ["move-aoyosumu-slow-charge"],
          ki: { ...initial.combatants[activeId].ki, current: 5 },
        },
      },
    };
    const attack = requireTransition(
      submitCombatDecision(
        actionState,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:damage-cap"),
          actorId: activeId,
          expectedStateVersion: actionState.version,
          moveId: "move-aoyosumu-slow-charge",
          targetCombatantId: targetId,
        },
        dependencies,
      ),
    );

    expect(attack.events).toContainEqual(
      expect.objectContaining({ type: "damage-applied", amount: 15 }),
    );
    expect(attack.state.combatants[targetId].hitPoints.current).toBe(85);
    expect(attack.state.version).toBe(actionState.version + 1);
  });

  it("enforces a passive resolution threshold through the public move transition", () => {
    const dependencies = createTestCombatDependencies(
      [1, 10],
      new Date("2026-08-10T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:scatter-shot-threshold")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 12 }, (_, index) =>
          combatEventIdSchema.parse(`event:scatter-shot-threshold-${index}`),
        ),
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 30, dexterity: 2, dexterityBonus: 0 },
              moveIds: ["move-afterlife-scatter-shot"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const attack = requireTransition(
      submitCombatDecision(
        action,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:scatter-shot-threshold"),
          actorId: firstCombatantId,
          expectedStateVersion: action.version,
          moveId: "move-afterlife-scatter-shot",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );

    expect(attack.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "defense-rolled", naturalResult: 10, result: 10 }),
        expect.objectContaining({ type: "attack-resolved", outcome: "successful" }),
        expect.objectContaining({ type: "damage-applied", amount: 15 }),
      ]),
    );
  });

  it("enforces a relative resolution threshold through the public move transition", () => {
    const dependencies = createTestCombatDependencies(
      [10, 14],
      new Date("2026-08-12T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:relative-threshold")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 12 }, (_, index) =>
          combatEventIdSchema.parse(`event:relative-threshold-${index}`),
        ),
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 30, dexterity: 2, dexterityBonus: 0 },
              moveIds: ["move-aoyosumu-crushing-kick"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const attackResult = submitCombatDecision(
      action,
      {
        type: "use-move",
        id: combatDecisionIdSchema.parse("decision:relative-threshold"),
        actorId: firstCombatantId,
        expectedStateVersion: action.version,
        moveId: "move-aoyosumu-crushing-kick",
        targetCombatantId: secondCombatantId,
      },
      dependencies,
    );
    const attack = requireTransition(attackResult);

    expect(attack.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "defense-rolled", naturalResult: 14, result: 14 }),
        expect.objectContaining({ type: "attack-resolved", outcome: "successful" }),
        expect.objectContaining({ type: "damage-applied", amount: 12 }),
      ]),
    );
    expect(attack.state.version).toBe(action.version + 1);
  });

  it("persists a successful-hit-count roll modifier through the public transition", () => {
    const dependencies = createTestCombatDependencies(
      [28, 1, 28, 1, 28, 1, 28, 1, 28, 1, 28, 1, 28, 1, 10, 1],
      new Date("2026-08-09T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:successful-hit-count")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: [activeEffectIdSchema.parse("active-effect:successful-hit-count")],
        eventIds: Array.from({ length: 80 }, (_, index) =>
          combatEventIdSchema.parse(`event:successful-hit-count-${index}`),
        ),
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 2, dexterityBonus: 0 },
              moveIds: ["move-afterlife-bakuretsu-ranma"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );
    const firstAction = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const firstAttack = requireTransition(
      submitCombatDecision(
        firstAction,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:successful-hit-count-source"),
          actorId: firstCombatantId,
          expectedStateVersion: firstAction.version,
          moveId: "move-afterlife-bakuretsu-ranma",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );
    expect(firstAttack.state.activeEffects).toEqual([
      expect.objectContaining({
        type: "modify-next-action",
        targetCombatantId: secondCombatantId,
        modifier: { type: "roll", roll: "attack", modifier: "result", amount: -7 },
        scope: "next-roll",
      }),
    ]);

    const opponentUpkeep = requireTransition(advanceFight(firstAttack.state, dependencies));
    const opponentAction = requireTransition(advanceFight(opponentUpkeep.state, dependencies));
    const secondAttack = requireTransition(
      submitCombatDecision(
        opponentAction.state,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:successful-hit-count-consumer"),
          actorId: secondCombatantId,
          expectedStateVersion: opponentAction.state.version,
          basicAttack: "basic-punch",
          targetCombatantId: firstCombatantId,
        },
        dependencies,
      ),
    );

    expect(secondAttack.events).toContainEqual(
      expect.objectContaining({ type: "attack-rolled", naturalResult: 10, result: 3 }),
    );
    expect(secondAttack.state.activeEffects).toEqual([]);
  });

  it("progresses upkeep through a power-up, end, and the next combatant's action", () => {
    const { state: initialState, dependencies } = createInitialState();
    const initialSnapshot = structuredClone(initialState);

    const actionTransition = requireTransition(advanceFight(initialState, dependencies));
    expect(actionTransition).toEqual({
      state: expect.objectContaining({ version: 1, phase: "action", eventSequence: 3 }),
      events: [
        expect.objectContaining({
          type: "phase-changed",
          id: combatEventIdSchema.parse("event:phase-action"),
          sequence: 3,
          phase: "action",
        }),
      ],
    });
    expect(initialState).toEqual(initialSnapshot);
    expect(enumerateLegalDecisions(actionTransition.state, firstCombatantId)).toEqual(
      expect.arrayContaining([
        {
          type: "basic-attack",
          actorId: firstCombatantId,
          basicAttack: "basic-punch",
          targetCombatantId: secondCombatantId,
        },
        { type: "pass", actorId: firstCombatantId },
        { type: "power-up", actorId: firstCombatantId },
      ]),
    );
    expect(enumerateLegalDecisions(actionTransition.state, secondCombatantId)).toEqual([]);

    const powerUpDecisionId = combatDecisionIdSchema.parse("decision:first-power-up");
    const endTransition = requireTransition(
      submitCombatDecision(
        actionTransition.state,
        {
          type: "power-up",
          id: powerUpDecisionId,
          actorId: firstCombatantId,
          expectedStateVersion: 1,
        },
        dependencies,
      ),
    );
    expect(endTransition).toEqual({
      state: expect.objectContaining({ version: 2, phase: "end", eventSequence: 5 }),
      events: [
        expect.objectContaining({
          type: "ki-changed",
          id: combatEventIdSchema.parse("event:ki-gained"),
          sequence: 4,
          causedByDecisionId: powerUpDecisionId,
          amount: 3,
          remainingKi: 8,
        }),
        expect.objectContaining({
          type: "phase-changed",
          id: combatEventIdSchema.parse("event:phase-end"),
          sequence: 5,
          phase: "end",
          causedByDecisionId: powerUpDecisionId,
        }),
      ],
    });
    expect(endTransition.state.actionHistory).toEqual([
      {
        type: "power-up",
        decisionId: powerUpDecisionId,
        actorId: firstCombatantId,
        turnNumber: 1,
        phase: "action",
      },
    ]);

    const nextUpkeepTransition = requireTransition(advanceFight(endTransition.state, dependencies));
    expect(nextUpkeepTransition).toEqual({
      state: expect.objectContaining({
        version: 3,
        turnNumber: 2,
        phase: "upkeep",
        activeCombatantId: secondCombatantId,
        eventSequence: 7,
      }),
      events: [
        expect.objectContaining({ type: "phase-changed", sequence: 6, phase: "upkeep" }),
        expect.objectContaining({
          type: "turn-started",
          sequence: 7,
          combatantId: secondCombatantId,
          turnNumber: 2,
        }),
      ],
    });

    const nextActionTransition = requireTransition(
      advanceFight(nextUpkeepTransition.state, dependencies),
    );
    expect(nextActionTransition.state).toMatchObject({
      version: 4,
      phase: "action",
      activeCombatantId: secondCombatantId,
      eventSequence: 8,
    });
  });

  it("caps a power-up at maximum Ki and records the actual gain", () => {
    const { state: initialState, dependencies } = createInitialState();
    const actionState = requireActiveFightState(
      requireTransition(advanceFight(initialState, dependencies)).state,
    );
    const nearMaximumKiState: ActiveFightState = {
      ...actionState,
      combatants: {
        ...actionState.combatants,
        [firstCombatantId]: {
          ...actionState.combatants[firstCombatantId],
          ki: { current: 9, maximum: 10 },
        },
      },
    };

    const transition = requireTransition(
      submitCombatDecision(
        nearMaximumKiState,
        {
          type: "power-up",
          id: combatDecisionIdSchema.parse("decision:capped-power-up"),
          actorId: firstCombatantId,
          expectedStateVersion: 1,
        },
        dependencies,
      ),
    );

    expect(transition.state.combatants[firstCombatantId].ki.current).toBe(10);
    expect(transition.events[0]).toMatchObject({ type: "ki-changed", amount: 1, remainingKi: 10 });
  });

  it("applies a declarative resource cap from a power-up effect at the public transition boundary", () => {
    const dependencies = createTestCombatDependencies(
      [20, 19],
      new Date("2026-08-12T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:power-surge-cap")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 12 }, (_, index) =>
          combatEventIdSchema.parse(`event:power-surge-cap-${index}`),
        ),
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 5, dexterityBonus: 0 },
              moveIds: ["move-kiihakai-power-surge-mastery"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 5, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const stateWithKnownKi: ActiveFightState = {
      ...action,
      combatants: {
        ...action.combatants,
        [firstCombatantId]: {
          ...action.combatants[firstCombatantId],
          ki: { current: 0, maximum: 10 },
        },
      },
    };

    const transition = requireTransition(
      submitCombatDecision(
        stateWithKnownKi,
        {
          type: "power-up",
          id: combatDecisionIdSchema.parse("decision:power-surge-cap"),
          actorId: firstCombatantId,
          expectedStateVersion: stateWithKnownKi.version,
        },
        dependencies,
      ),
    );

    expect(transition.state.combatants[firstCombatantId].ki.current).toBe(4);
    expect(transition.events).toContainEqual(
      expect.objectContaining({ type: "ki-changed", amount: 4, remainingKi: 4 }),
    );
    expect(transition.state.version).toBe(stateWithKnownKi.version + 1);
  });

  it("prevents a declared resource gain at the public decision boundary", () => {
    const dependencies = createTestCombatDependencies(
      [20, 19],
      new Date("2026-08-12T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:resource-prevention")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: [activeEffectIdSchema.parse("active-effect:resource-prevention")],
        eventIds: Array.from({ length: 8 }, (_, index) =>
          combatEventIdSchema.parse(`event:resource-prevention-${index}`),
        ),
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 5, dexterityBonus: 0 },
              moveIds: ["move-freestyle-unquenchable-bloodthirst"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 5, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const stateWithPrevention: ActiveFightState = {
      ...action,
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:resource-prevention"),
          type: "prevent-resource-modification",
          sourceCombatantId: firstCombatantId,
          targetCombatantId: firstCombatantId,
          sourceDefinitionId: "move-freestyle-unquenchable-bloodthirst",
          resource: "ki",
          operation: "gain",
          duration: { type: "combat" },
        },
      ],
    };

    const transition = requireTransition(
      submitCombatDecision(
        stateWithPrevention,
        {
          type: "power-up",
          id: combatDecisionIdSchema.parse("decision:resource-prevention"),
          actorId: firstCombatantId,
          expectedStateVersion: stateWithPrevention.version,
        },
        dependencies,
      ),
    );

    expect(transition.state.combatants[firstCombatantId].ki.current).toBe(5);
    expect(transition.events).toEqual([
      expect.objectContaining({ type: "phase-changed", phase: "end" }),
    ]);
    expect(transition.state.version).toBe(stateWithPrevention.version + 1);
  });

  it("dispatches current resource gains to generic listeners without recursive retriggering", () => {
    const dependencies = createTestCombatDependencies(
      [20, 19],
      new Date("2026-08-10T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:resource-event-power-up")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: [activeEffectIdSchema.parse("active-effect:resource-event-killer-gaze")],
        eventIds: Array.from({ length: 8 }, (_, index) =>
          combatEventIdSchema.parse(`event:resource-event-power-up-${index}`),
        ),
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 5, dexterityBonus: 0 },
              moveIds: ["move-kiihakai-energy-gathering"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 5, dexterityBonus: 0 },
              moveIds: ["move-kurokonwaku-killer-gaze"],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const transition = requireTransition(
      submitCombatDecision(
        action,
        {
          type: "power-up",
          id: combatDecisionIdSchema.parse("decision:resource-event-power-up"),
          actorId: firstCombatantId,
          expectedStateVersion: action.version,
        },
        dependencies,
      ),
    );

    expect(transition.state.combatants[firstCombatantId].ki.current).toBe(9);
    expect(transition.events).toContainEqual(
      expect.objectContaining({ type: "ki-changed", amount: 4, remainingKi: 9 }),
    );
    expect(transition.state.activeEffects).toContainEqual(
      expect.objectContaining({
        type: "modify-next-action",
        sourceDefinitionId: "move-kurokonwaku-killer-gaze",
        targetCombatantId: firstCombatantId,
        modifier: { type: "roll", roll: "attack", modifier: "result", amount: -3 },
        scope: "next-action",
      }),
    );
  });

  it("dispatches structured power-up effects into durable next-turn state", () => {
    const dependencies = createTestCombatDependencies(
      [20, 19],
      new Date("2026-08-10T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:power-up-effects")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: Array.from({ length: 4 }, (_, index) =>
          activeEffectIdSchema.parse(`active-effect:power-up-${index}`),
        ),
        eventIds: Array.from({ length: 16 }, (_, index) =>
          combatEventIdSchema.parse(`event:power-up-effects-${index}`),
        ),
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 5, dexterityBonus: 0 },
              moveIds: [
                "move-aoyosumu-calming-mastery",
                "move-kiihakai-overdrive-mastery",
                "move-kiihakai-overload",
              ],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 5, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const transition = requireTransition(
      submitCombatDecision(
        action,
        {
          type: "power-up",
          id: combatDecisionIdSchema.parse("decision:power-up-effects"),
          actorId: firstCombatantId,
          expectedStateVersion: action.version,
        },
        dependencies,
      ),
    );

    expect(transition.state.version).toBe(action.version + 1);
    expect(transition.state.activeEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-next-action",
          sourceDefinitionId: "move-aoyosumu-calming-mastery",
          targetCombatantId: firstCombatantId,
          modifier: { type: "roll", roll: "defense", modifier: "result", amount: 4 },
          scope: "next-roll",
        }),
        expect.objectContaining({
          type: "modify-damage",
          sourceDefinitionId: "move-kiihakai-overdrive-mastery",
          targetCombatantId: firstCombatantId,
          amount: 3,
          availableFromTurn: 2,
          duration: { type: "turns", ownerCombatantId: firstCombatantId, remaining: 1 },
        }),
        expect.objectContaining({
          type: "set-resolution-threshold",
          sourceDefinitionId: "move-kiihakai-overload",
          targetCombatantId: secondCombatantId,
          scope: "next-action",
          outcome: "stopped",
          value: 15,
        }),
      ]),
    );
    expect(transition.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "ki-changed", amount: 3 }),
        expect.objectContaining({
          type: "effect-activated",
          sourceDefinitionId: "move-kiihakai-overdrive-mastery",
        }),
        expect.objectContaining({
          type: "effect-activated",
          sourceDefinitionId: "move-kiihakai-overload",
        }),
      ]),
    );
  });

  it("skips a stunned combatant's action during Upkeep and expires it after that turn", () => {
    const { state: initialState, dependencies } = createInitialState();
    const activeInitialState = requireActiveFightState(initialState);
    const stunnedState: ActiveFightState = {
      ...activeInitialState,
      combatants: {
        ...activeInitialState.combatants,
        [firstCombatantId]: {
          ...activeInitialState.combatants[firstCombatantId],
          activeStatuses: [
            {
              statusId: "stun",
              sourceCombatantId: secondCombatantId,
              sourceDefinitionId: "move:test-stun",
              stacks: 1,
              duration: { type: "turns", ownerCombatantId: firstCombatantId, remaining: 1 },
            },
          ],
        },
      },
    };

    const transition = requireTransition(advanceFight(stunnedState, dependencies));

    expect(transition.state).toMatchObject({ phase: "end", eventSequence: 4 });
    expect(transition.state.combatants[firstCombatantId].activeStatuses).toHaveLength(1);
    const afterTurn = requireTransition(advanceFight(transition.state, dependencies));
    expect(afterTurn.state.combatants[firstCombatantId].activeStatuses).toEqual([]);
    expect(transition.events).toEqual([
      expect.objectContaining({ type: "action-skipped", combatantId: firstCombatantId }),
      expect.objectContaining({ type: "phase-changed", phase: "end" }),
    ]);
  });

  it("does not treat stun stacks as a substitute for its turn duration", () => {
    const { state: initialState, dependencies } = createInitialState();
    const activeInitialState = requireActiveFightState(initialState);
    const stackedStunState: ActiveFightState = {
      ...activeInitialState,
      combatants: {
        ...activeInitialState.combatants,
        [firstCombatantId]: {
          ...activeInitialState.combatants[firstCombatantId],
          activeStatuses: [
            {
              statusId: "stun",
              sourceCombatantId: secondCombatantId,
              sourceDefinitionId: "move:test-stun",
              stacks: 2,
              duration: { type: "turns", ownerCombatantId: firstCombatantId, remaining: 1 },
            },
          ],
        },
      },
    };

    const transition = requireTransition(advanceFight(stackedStunState, dependencies));

    expect(transition.state.combatants[firstCombatantId].activeStatuses).toEqual([
      expect.objectContaining({
        statusId: "stun",
        stacks: 2,
        duration: expect.objectContaining({ remaining: 1 }),
      }),
    ]);
    expect(transition.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "action-skipped", combatantId: firstCombatantId }),
      ]),
    );
  });

  it("allows the active combatant to pass and moves directly to end phase", () => {
    const { state: initialState, dependencies } = createInitialState();
    const actionState = requireTransition(advanceFight(initialState, dependencies)).state;

    const transition = requireTransition(
      submitCombatDecision(
        actionState,
        {
          type: "pass",
          id: combatDecisionIdSchema.parse("decision:pass"),
          actorId: firstCombatantId,
          expectedStateVersion: 1,
        },
        dependencies,
      ),
    );

    expect(transition).toEqual({
      state: expect.objectContaining({ version: 2, phase: "end", eventSequence: 4 }),
      events: [
        expect.objectContaining({
          type: "phase-changed",
          sequence: 4,
          phase: "end",
          causedByDecisionId: combatDecisionIdSchema.parse("decision:pass"),
        }),
      ],
    });
    expect(transition.state.combatants[firstCombatantId].ki.current).toBe(5);
    expect(transition.state.actionHistory).toEqual([
      {
        type: "pass",
        decisionId: combatDecisionIdSchema.parse("decision:pass"),
        actorId: firstCombatantId,
        turnNumber: 1,
        phase: "action",
      },
    ]);
  });

  it("allows the active combatant to surrender and completes the fight", () => {
    const { state: initialState, dependencies } = createInitialState();
    const actionState = requireTransition(advanceFight(initialState, dependencies)).state;
    const decisionId = combatDecisionIdSchema.parse("decision:surrender");

    const transition = requireTransition(
      submitCombatDecision(
        actionState,
        {
          type: "surrender",
          id: decisionId,
          actorId: firstCombatantId,
          expectedStateVersion: 1,
        },
        dependencies,
      ),
    );

    expect(transition.state).toMatchObject({
      status: "completed",
      completion: { type: "surrender", winnerCombatantId: secondCombatantId },
      actionHistory: [expect.objectContaining({ type: "surrender", decisionId })],
    });
    expect(transition.events).toEqual([
      expect.objectContaining({ type: "combatant-surrendered", causedByDecisionId: decisionId }),
      expect.objectContaining({ type: "fight-ended", causedByDecisionId: decisionId }),
    ]);
  });

  it("allows an authorized caller to cancel an active fight through the decision boundary", () => {
    const { state: initialState, dependencies } = createInitialState();
    const decisionId = combatDecisionIdSchema.parse("decision:cancel");

    const transition = requireTransition(
      submitCombatDecision(
        initialState,
        { type: "cancel-fight", id: decisionId, expectedStateVersion: 0 },
        dependencies,
      ),
    );

    expect(transition.state).toMatchObject({
      status: "completed",
      completion: { type: "cancelled" },
      version: 1,
    });
    expect(transition.events).toEqual([
      expect.objectContaining({ type: "fight-ended", causedByDecisionId: decisionId }),
    ]);
  });

  it("rejects stale, wrong-actor, wrong-phase, and unsupported decisions", () => {
    const { state: initialState, dependencies } = createInitialState();
    const decisionId = combatDecisionIdSchema.parse("decision:rejected");

    expect(
      submitCombatDecision(
        initialState,
        { type: "pass", id: decisionId, actorId: firstCombatantId, expectedStateVersion: 0 },
        dependencies,
      ),
    ).toMatchObject({ ok: false, error: { type: "wrong-phase", actual: "upkeep" } });

    const actionState = requireTransition(advanceFight(initialState, dependencies)).state;
    expect(
      submitCombatDecision(
        actionState,
        { type: "pass", id: decisionId, actorId: firstCombatantId, expectedStateVersion: 0 },
        dependencies,
      ),
    ).toMatchObject({
      ok: false,
      error: { type: "stale-decision", expectedVersion: 0, actualVersion: 1 },
    });
    expect(
      submitCombatDecision(
        actionState,
        { type: "pass", id: decisionId, actorId: secondCombatantId, expectedStateVersion: 1 },
        dependencies,
      ),
    ).toMatchObject({ ok: false, error: { type: "not-active-combatant" } });
    expect(
      submitCombatDecision(
        actionState,
        {
          type: "use-move",
          id: decisionId,
          actorId: firstCombatantId,
          expectedStateVersion: 1,
          moveId: "move-freestyle-hidden-power-level",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    ).toMatchObject({
      ok: false,
      error: {
        type: "unsupported-mechanic",
        mechanic: "move resolution: move-freestyle-hidden-power-level",
      },
    });
    expect(
      submitCombatDecision(
        actionState,
        {
          type: "respond-to-pending-decision",
          id: decisionId,
          actorId: firstCombatantId,
          expectedStateVersion: 1,
          pendingDecisionId: pendingDecisionIdSchema.parse("pending-decision:missing"),
          optionId: "decline",
        },
        dependencies,
      ),
    ).toMatchObject({ ok: false, error: { type: "no-pending-decision" } });
    expect(advanceFight(actionState, dependencies)).toMatchObject({
      ok: false,
      error: { type: "wrong-phase", actual: "action" },
    });
  });

  it("does not advance completed fights or resolve pending decisions before their supported slice", () => {
    const { state: initialState, dependencies } = createInitialState();
    const actionState = requireActiveFightState(
      requireTransition(advanceFight(initialState, dependencies)).state,
    );
    const passDecision = {
      type: "pass" as const,
      id: combatDecisionIdSchema.parse("decision:pending-pass"),
      actorId: firstCombatantId,
      expectedStateVersion: 1,
    };
    const pendingState: ActiveFightState = {
      ...actionState,
      pendingDecision: {
        id: pendingDecisionIdSchema.parse("pending-decision:unimplemented"),
        stateVersion: 1,
        combatantId: firstCombatantId,
        type: "optional-effect",
        options: [{ id: "decline", type: "decline" }],
      },
    };
    const completedState = {
      ...actionState,
      status: "completed",
      completion: { type: "cancelled" },
    } as FightState;

    expect(enumerateLegalDecisions(pendingState, firstCombatantId)).toEqual([]);
    expect(advanceFight(pendingState, dependencies)).toMatchObject({
      ok: false,
      error: { type: "unsupported-mechanic", mechanic: "pending decision resolution" },
    });
    expect(submitCombatDecision(pendingState, passDecision, dependencies)).toMatchObject({
      ok: false,
      error: { type: "unsupported-mechanic", mechanic: "pending decision resolution" },
    });
    expect(advanceFight(completedState, dependencies)).toMatchObject({
      ok: false,
      error: { type: "wrong-phase", actual: "completed" },
    });
    expect(submitCombatDecision(completedState, passDecision, dependencies)).toMatchObject({
      ok: false,
      error: { type: "wrong-phase", actual: "completed" },
    });
  });

  it("uses persisted combat-result history for a later move's damage and roll", () => {
    const dependencies = createTestCombatDependencies(
      [1, 20, 20, 1],
      new Date("2026-08-11T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:combat-result-history")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 40 }, (_, index) =>
          combatEventIdSchema.parse(`event:combat-result-history-${index}`),
        ),
        resolutionFrameIds: Array.from({ length: 10 }, (_, index) =>
          resolutionFrameIdSchema.parse(`resolution-frame:combat-result-history-${index}`),
        ),
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
              moveIds: ["move-akaikaru-letting-off-steam"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );
    const firstAction = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const firstAttack = requireTransition(
      submitCombatDecision(
        firstAction,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:history-first-attack"),
          actorId: firstCombatantId,
          expectedStateVersion: firstAction.version,
          moveId: "move-akaikaru-letting-off-steam",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );
    expect(firstAttack.events).toContainEqual(
      expect.objectContaining({ type: "attack-resolved", outcome: "stopped" }),
    );

    const opponentAction = requireActiveFightState(
      requireTransition(advanceFight(firstAttack.state, dependencies)).state,
    );
    const opponentTurn = requireActiveFightState(
      requireTransition(advanceFight(opponentAction, dependencies)).state,
    );
    const opponentPass = requireTransition(
      submitCombatDecision(
        opponentTurn,
        {
          type: "pass",
          id: combatDecisionIdSchema.parse("decision:history-opponent-pass"),
          actorId: secondCombatantId,
          expectedStateVersion: opponentTurn.version,
        },
        dependencies,
      ),
    );
    const firstUpkeep = requireActiveFightState(
      requireTransition(advanceFight(opponentPass.state, dependencies)).state,
    );
    const secondAction = requireActiveFightState(
      requireTransition(advanceFight(firstUpkeep, dependencies)).state,
    );

    expect(enumerateLegalDecisions(secondAction, firstCombatantId)).toContainEqual(
      expect.objectContaining({ type: "use-move", moveId: "move-akaikaru-letting-off-steam" }),
    );
    const secondAttack = requireTransition(
      submitCombatDecision(
        secondAction,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:history-second-attack"),
          actorId: firstCombatantId,
          expectedStateVersion: secondAction.version,
          moveId: "move-akaikaru-letting-off-steam",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );

    expect(secondAttack.state.version).toBe(secondAction.version + 1);
    expect(secondAttack.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "attack-resolved", outcome: "successful" }),
        expect.objectContaining({ type: "damage-applied", amount: 7 }),
      ]),
    );
  });

  it("continues a successful source move through a bounded same-turn extra action", () => {
    const dependencies = createTestCombatDependencies(
      [30, 1, 30, 1],
      new Date("2026-08-12T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:chained-strikes")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: Array.from({ length: 8 }, (_, index) =>
          activeEffectIdSchema.parse(`active-effect:chained-strikes-${index}`),
        ),
        eventIds: Array.from({ length: 40 }, (_, index) =>
          combatEventIdSchema.parse(`event:chained-strikes-${index}`),
        ),
        resolutionFrameIds: Array.from({ length: 8 }, (_, index) =>
          resolutionFrameIdSchema.parse(`resolution-frame:chained-strikes-${index}`),
        ),
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
              moveIds: ["move-akaikaru-chained-strikes"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const firstAttack = requireTransition(
      submitCombatDecision(
        action,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:chained-strikes-first"),
          actorId: firstCombatantId,
          expectedStateVersion: action.version,
          moveId: "move-akaikaru-chained-strikes",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );
    const firstAttackState = requireActiveFightState(firstAttack.state);

    expect(firstAttackState).toMatchObject({
      phase: "action",
      activeCombatantId: firstCombatantId,
      activeEffects: [
        expect.objectContaining({
          type: "extra-action",
          targetCombatantId: firstCombatantId,
          sourceDefinitionId: "move-akaikaru-chained-strikes",
          sourceEffectIndex: 0,
          remainingActions: 1,
          expiresAfterTurn: firstAttackState.turnNumber,
          useLimit: expect.objectContaining({ scope: "turn", count: 1 }),
        }),
      ],
    });
    expect(enumerateLegalDecisions(firstAttackState, firstCombatantId)).toEqual([
      {
        type: "use-move",
        actorId: firstCombatantId,
        moveId: "move-akaikaru-chained-strikes",
        targetCombatantId: secondCombatantId,
      },
    ]);

    const secondAttack = requireTransition(
      submitCombatDecision(
        firstAttackState,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:chained-strikes-second"),
          actorId: firstCombatantId,
          expectedStateVersion: firstAttackState.version,
          moveId: "move-akaikaru-chained-strikes",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );

    const secondAttackState = requireActiveFightState(secondAttack.state);
    expect(secondAttackState.phase).toBe("end");
    expect(secondAttackState.activeEffects).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "extra-action" })]),
    );
    expect(secondAttackState.combatants[firstCombatantId].moveUses).toMatchObject({
      "move-akaikaru-chained-strikes": 2,
    });
  });

  it("makes a next-turn action allowance available only in its declared action phase", () => {
    const dependencies = createTestCombatDependencies(
      [20, 1],
      new Date("2026-08-13T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:next-turn-extra-action")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: Array.from({ length: 4 }, (_, index) =>
          activeEffectIdSchema.parse(`active-effect:next-turn-extra-action-${index}`),
        ),
        eventIds: Array.from({ length: 120 }, (_, index) =>
          combatEventIdSchema.parse(`event:next-turn-extra-action-${index}`),
        ),
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
              moveIds: ["move-afterlife-kienzan"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );
    const firstAction = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    let sourceAttackAction = firstAction;
    for (let turn = 1; turn <= 9; turn += 1) {
      const poweredUp = requireTransition(
        submitCombatDecision(
          sourceAttackAction,
          {
            type: "power-up",
            id: combatDecisionIdSchema.parse(`decision:next-turn-extra-action-power-up-${turn}`),
            actorId: firstCombatantId,
            expectedStateVersion: sourceAttackAction.version,
          },
          dependencies,
        ),
      );
      const opponentUpkeep = requireActiveFightState(
        requireTransition(advanceFight(poweredUp.state, dependencies)).state,
      );
      const opponentAction = requireActiveFightState(
        requireTransition(advanceFight(opponentUpkeep, dependencies)).state,
      );
      const opponentPass = requireTransition(
        submitCombatDecision(
          opponentAction,
          {
            type: "pass",
            id: combatDecisionIdSchema.parse(
              `decision:next-turn-extra-action-opponent-pass-${turn}`,
            ),
            actorId: secondCombatantId,
            expectedStateVersion: opponentAction.version,
          },
          dependencies,
        ),
      );
      const sourceUpkeep = requireActiveFightState(
        requireTransition(advanceFight(opponentPass.state, dependencies)).state,
      );
      sourceAttackAction = requireActiveFightState(
        requireTransition(advanceFight(sourceUpkeep, dependencies)).state,
      );
    }
    const attack = requireTransition(
      submitCombatDecision(
        sourceAttackAction,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:next-turn-extra-action-attack"),
          actorId: firstCombatantId,
          expectedStateVersion: sourceAttackAction.version,
          moveId: "move-afterlife-kienzan",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );
    const attackState = requireActiveFightState(attack.state);
    const extraAction = attackState.activeEffects.find(
      (effect) =>
        effect.type === "extra-action" && effect.sourceDefinitionId === "move-afterlife-kienzan",
    );
    expect(extraAction).toMatchObject({
      phase: "action",
      availableFromTurn: attackState.turnNumber + 1,
      expiresAfterTurn: attackState.turnNumber + 2,
      moveCategory: "power-up",
      remainingActions: 1,
    });
    expect(enumerateLegalDecisions(attackState, firstCombatantId)).toEqual([]);

    const nextOpponentAction = requireActiveFightState(
      requireTransition(
        advanceFight(
          requireActiveFightState(requireTransition(advanceFight(attackState, dependencies)).state),
          dependencies,
        ),
      ).state,
    );
    const nextOpponentPass = requireTransition(
      submitCombatDecision(
        nextOpponentAction,
        {
          type: "pass",
          id: combatDecisionIdSchema.parse("decision:next-turn-extra-action-next-opponent-pass"),
          actorId: secondCombatantId,
          expectedStateVersion: nextOpponentAction.version,
        },
        dependencies,
      ),
    );
    const nextSourceAction = requireActiveFightState(
      requireTransition(
        advanceFight(
          requireActiveFightState(
            requireTransition(advanceFight(nextOpponentPass.state, dependencies)).state,
          ),
          dependencies,
        ),
      ).state,
    );

    expect(nextSourceAction.activeEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "extra-action",
          sourceDefinitionId: "move-afterlife-kienzan",
        }),
      ]),
    );
    expect(enumerateLegalDecisions(nextSourceAction, firstCombatantId)).toEqual([
      { type: "power-up", actorId: firstCombatantId },
    ]);
    const consumed = requireTransition(
      submitCombatDecision(
        nextSourceAction,
        {
          type: "power-up",
          id: combatDecisionIdSchema.parse("decision:next-turn-extra-action-consume"),
          actorId: firstCombatantId,
          expectedStateVersion: nextSourceAction.version,
        },
        dependencies,
      ),
    );
    expect(consumed.state.version).toBe(nextSourceAction.version + 1);
    expect(consumed.state.activeEffects).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceDefinitionId: "move-afterlife-kienzan",
          type: "extra-action",
        }),
      ]),
    );
    expect(consumed.state.version).toBe(nextSourceAction.version + 1);
  });

  it("persists source-faithful attack restrictions for each target's next turn", () => {
    const dependencies = createTestCombatDependencies(
      [30, 1],
      new Date("2026-08-13T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:serenity-action-restrictions")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: [
          activeEffectIdSchema.parse("active-effect:serenity-opponent"),
          activeEffectIdSchema.parse("active-effect:serenity-self"),
        ],
        eventIds: Array.from({ length: 40 }, (_, index) =>
          combatEventIdSchema.parse(`event:serenity-action-restrictions-${index + 1}`),
        ),
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
              moveIds: ["move-aoyosumu-serenity-wave", "move-aoyosumu-heart-punch"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: ["move-aoyosumu-heart-punch", "move-haokiru-healing-ray"],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const attack = requireTransition(
      submitCombatDecision(
        action,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:serenity-action-restrictions"),
          actorId: firstCombatantId,
          expectedStateVersion: action.version,
          moveId: "move-aoyosumu-serenity-wave",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );
    expect(attack.state.activeEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "action-restriction",
          targetCombatantId: secondCombatantId,
          availableFromTurn: 2,
          remainingTurns: 1,
        }),
        expect.objectContaining({
          type: "action-restriction",
          targetCombatantId: firstCombatantId,
          availableFromTurn: 3,
          remainingTurns: 1,
        }),
      ]),
    );

    const opponentAction = requireActiveFightState(
      requireTransition(
        advanceFight(
          requireActiveFightState(
            requireTransition(advanceFight(attack.state, dependencies)).state,
          ),
          dependencies,
        ),
      ).state,
    );
    const opponentDecisions = enumerateLegalDecisions(opponentAction, secondCombatantId);
    expect(opponentDecisions.some((decision) => decision.type === "basic-attack")).toBe(false);
    expect(opponentDecisions).not.toContainEqual(
      expect.objectContaining({ type: "use-move", moveId: "move-aoyosumu-heart-punch" }),
    );
    expect(opponentDecisions).toContainEqual(
      expect.objectContaining({ type: "use-move", moveId: "move-haokiru-healing-ray" }),
    );
    expect(opponentDecisions).toContainEqual({ type: "power-up", actorId: secondCombatantId });

    const opponentPass = requireTransition(
      submitCombatDecision(
        opponentAction,
        {
          type: "pass",
          id: combatDecisionIdSchema.parse("decision:serenity-opponent-pass"),
          actorId: secondCombatantId,
          expectedStateVersion: opponentAction.version,
        },
        dependencies,
      ),
    );
    const sourceAction = requireActiveFightState(
      requireTransition(
        advanceFight(
          requireActiveFightState(
            requireTransition(advanceFight(opponentPass.state, dependencies)).state,
          ),
          dependencies,
        ),
      ).state,
    );
    const sourceDecisions = enumerateLegalDecisions(sourceAction, firstCombatantId);
    expect(sourceDecisions.some((decision) => decision.type === "basic-attack")).toBe(false);
    expect(sourceDecisions).toContainEqual({ type: "power-up", actorId: firstCombatantId });
    expect(sourceAction.activeEffects).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ targetCombatantId: secondCombatantId })]),
    );
  });

  it("turns a category-free restriction into one deterministic skipped action", () => {
    const dependencies = createTestCombatDependencies([], new Date("2026-08-13T12:00:00.000Z"), {
      fightIds: [fightIdSchema.parse("fight:whole-action-skip")],
      combatantIds: [firstCombatantId, secondCombatantId],
      eventIds: Array.from({ length: 20 }, (_, index) =>
        combatEventIdSchema.parse(`event:whole-action-skip-${index + 1}`),
      ),
    });
    const created = requireTransition(createFight(input, dependencies)).state;
    const firstAction = requireActiveFightState(
      requireTransition(advanceFight(created, dependencies)).state,
    );
    const firstPass = requireTransition(
      submitCombatDecision(
        firstAction,
        {
          type: "pass",
          id: combatDecisionIdSchema.parse("decision:whole-action-first-pass"),
          actorId: firstCombatantId,
          expectedStateVersion: firstAction.version,
        },
        dependencies,
      ),
    );
    const targetUpkeep = requireActiveFightState(
      requireTransition(advanceFight(firstPass.state, dependencies)).state,
    );
    const restricted: ActiveFightState = {
      ...targetUpkeep,
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:whole-action-skip"),
          type: "action-restriction",
          sourceCombatantId: firstCombatantId,
          targetCombatantId: secondCombatantId,
          sourceDefinitionId: "move-afterlife-petrifying-spit",
          sourceEffectIndex: 2,
          availableFromTurn: targetUpkeep.turnNumber,
          remainingTurns: 1,
        },
      ],
    };

    const skipped = requireTransition(advanceFight(restricted, dependencies));
    expect(skipped.state.version).toBe(restricted.version + 1);
    expect(skipped.state).toMatchObject({ phase: "end" });
    expect(skipped.events).toContainEqual(
      expect.objectContaining({
        type: "action-skipped",
        combatantId: secondCombatantId,
        reason: "effect",
      }),
    );

    const nextTurn = requireTransition(advanceFight(skipped.state, dependencies));
    expect(nextTurn.state.activeEffects).toEqual([]);
  });
});
