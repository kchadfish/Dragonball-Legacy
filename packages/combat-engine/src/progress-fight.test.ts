import { describe, expect, it } from "vitest";

import type {
  ActiveFightState,
  ActiveRollModifierEffect,
  CreateFightInput,
  FightState,
} from "./index.js";
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

const requireTransition = <T>(result: {
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: unknown;
}): T => {
  if (!result.ok || result.value === undefined)
    throw new Error(`Expected a successful combat transition: ${JSON.stringify(result.error)}`);
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

const createDeferredDependencies = (
  name: string,
  randomValues: readonly number[] = [20, 1, 20, 1],
) =>
  createTestCombatDependencies(randomValues, new Date("2026-08-04T12:00:00.000Z"), {
    fightIds: [fightIdSchema.parse(`fight:${name}`)],
    combatantIds: [firstCombatantId, secondCombatantId],
    eventIds: Array.from({ length: 160 }, (_, index) =>
      combatEventIdSchema.parse(`event:${name}-${index + 1}`),
    ),
    activeEffectIds: Array.from({ length: 30 }, (_, index) =>
      activeEffectIdSchema.parse(`active-effect:${name}-${index + 1}`),
    ),
    pendingDecisionIds: Array.from({ length: 20 }, (_, index) =>
      pendingDecisionIdSchema.parse(`pending-decision:${name}-${index + 1}`),
    ),
    resolutionFrameIds: Array.from({ length: 20 }, (_, index) =>
      resolutionFrameIdSchema.parse(`resolution-frame:${name}-${index + 1}`),
    ),
  });

const deferredMove = (state: ActiveFightState, moveId: string) =>
  state.activeEffects.find(
    (effect) => effect.type === "deferred-move" && effect.sourceDefinitionId === moveId,
  );

describe("deferred move catalog capabilities", () => {
  it("schedules Warp Kamehameha, forces the intervening turn, and resumes its attack", () => {
    const dependencies = createDeferredDependencies("warp-resume", [1, 20, 20, 1]);
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 500,
              stats: { power: 100, dexterity: 10, dexterityBonus: 0 },
              moveIds: ["move-afterlife-warp-kamehameha"],
            },
            {
              maximumHitPoints: 500,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: ["move-afterlife-masenko"],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = {
      ...requireActiveFightState(
        requireTransition(advanceFight(created.state, dependencies)).state,
      ),
      turnNumber: 10,
    } satisfies ActiveFightState;
    const scheduledTransition = requireTransition(
      submitCombatDecision(
        action,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:warp-schedule"),
          actorId: firstCombatantId,
          expectedStateVersion: action.version,
          moveId: "move-afterlife-warp-kamehameha",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );
    const scheduled = requireActiveFightState(scheduledTransition.state);
    expect(deferredMove(scheduled, "move-afterlife-warp-kamehameha")).toMatchObject({
      type: "deferred-move",
      performOnTurn: scheduled.turnNumber + 2,
    });
    expect(scheduled.combatants[firstCombatantId].ki.current).toBe(0);
    expect(scheduled.combatants[firstCombatantId].moveUses["move-afterlife-warp-kamehameha"]).toBe(
      1,
    );
    expect(scheduledTransition.events).toContainEqual(
      expect.objectContaining({
        type: "deferred-move-scheduled",
        moveId: "move-afterlife-warp-kamehameha",
      }),
    );

    const opponentAction = requireTransition(
      advanceFight(requireTransition(advanceFight(scheduled, dependencies)).state, dependencies),
    );
    const opponentAttack = requireTransition(
      submitCombatDecision(
        opponentAction.state,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:warp-opponent-attack"),
          actorId: secondCombatantId,
          expectedStateVersion: opponentAction.state.version,
          moveId: "move-afterlife-masenko",
          targetCombatantId: firstCombatantId,
        },
        dependencies,
      ),
    );
    const firstResume = requireTransition(advanceFight(opponentAttack.state, dependencies));
    const resumedTransition = requireTransition(advanceFight(firstResume.state, dependencies));
    const resumed = requireActiveFightState(resumedTransition.state);
    expect(resumed.pendingDecision).toBeUndefined();
    expect(deferredMove(resumed, "move-afterlife-warp-kamehameha")).toBeUndefined();
    expect(resumed.combatants[secondCombatantId].hitPoints.current).toBeLessThan(500);
    expect(resumed.combatants[firstCombatantId].ki.current).toBe(0);
    expect(resumed.combatants[firstCombatantId].moveUses["move-afterlife-warp-kamehameha"]).toBe(1);
    expect(resumedTransition.events).toContainEqual(
      expect.objectContaining({
        type: "deferred-move-performed",
        moveId: "move-afterlife-warp-kamehameha",
      }),
    );
  });

  it("offers Death Ball's optional defer choice and persists its boosted execution", () => {
    const dependencies = createDeferredDependencies("death-ball-resume", [1, 20, 20, 1]);
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 500,
              stats: { power: 100, dexterity: 10, dexterityBonus: 0 },
              moveIds: ["move-afterlife-death-ball"],
            },
            {
              maximumHitPoints: 500,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: ["move-afterlife-masenko"],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = {
      ...requireActiveFightState(
        requireTransition(advanceFight(created.state, dependencies)).state,
      ),
      turnNumber: 10,
    } satisfies ActiveFightState;
    const prepared = {
      ...action,
      combatants: {
        ...action.combatants,
        [firstCombatantId]: {
          ...action.combatants[firstCombatantId],
          ki: { ...action.combatants[firstCombatantId].ki, current: 10 },
        },
      },
    } satisfies ActiveFightState;
    const pendingTransition = requireTransition(
      submitCombatDecision(
        prepared,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:death-ball-declare"),
          actorId: firstCombatantId,
          expectedStateVersion: prepared.version,
          moveId: "move-afterlife-death-ball",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );
    const pending = requireActiveFightState(pendingTransition.state);
    expect(pending.pendingDecision).toMatchObject({
      type: "optional-effect",
      options: [
        { id: "activate-effect:0", type: "activate-effect", effectIndices: [0] },
        { id: "decline", type: "decline" },
      ],
    });
    expect(pending.combatants[firstCombatantId].ki.current).toBe(10);
    expect(
      pending.combatants[firstCombatantId].moveUses["move-afterlife-death-ball"],
    ).toBeUndefined();

    const scheduledTransition = requireTransition(
      submitCombatDecision(
        pending,
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:death-ball-activate"),
          actorId: firstCombatantId,
          expectedStateVersion: pending.version,
          pendingDecisionId: pending.pendingDecision!.id,
          optionId: "activate-effect:0",
        },
        dependencies,
      ),
    );
    const scheduled = requireActiveFightState(scheduledTransition.state);
    expect(deferredMove(scheduled, "move-afterlife-death-ball")).toMatchObject({
      damageOverridePercent: 170,
      performOnTurn: scheduled.turnNumber + 2,
    });
    expect(scheduled.combatants[firstCombatantId].ki.current).toBe(2);
    expect(scheduled.combatants[firstCombatantId].moveUses["move-afterlife-death-ball"]).toBe(1);

    const opponentAction = requireTransition(
      advanceFight(requireTransition(advanceFight(scheduled, dependencies)).state, dependencies),
    );
    const opponentAttack = requireTransition(
      submitCombatDecision(
        opponentAction.state,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:death-ball-opponent-attack"),
          actorId: secondCombatantId,
          expectedStateVersion: opponentAction.state.version,
          moveId: "move-afterlife-masenko",
          targetCombatantId: firstCombatantId,
        },
        dependencies,
      ),
    );
    const completedTransition = requireTransition(
      advanceFight(
        requireTransition(advanceFight(opponentAttack.state, dependencies)).state,
        dependencies,
      ),
    );
    const completed = requireActiveFightState(completedTransition.state);
    expect(completed.pendingDecision).toBeUndefined();
    expect(deferredMove(completed, "move-afterlife-death-ball")).toBeUndefined();
    expect(completed.combatants[secondCombatantId].hitPoints.current).toBe(330);
    expect(completed.combatants[firstCombatantId].ki.current).toBe(2);
    expect(completedTransition.events).toContainEqual(
      expect.objectContaining({
        type: "deferred-move-performed",
        moveId: "move-afterlife-death-ball",
      }),
    );
  });

  it("cancels a deferred move after the opponent's successful intervening attack", () => {
    const dependencies = createDeferredDependencies("warp-cancel", [20, 1, 20, 1]);
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 500,
              stats: { power: 100, dexterity: 10, dexterityBonus: 0 },
              moveIds: ["move-afterlife-warp-kamehameha"],
            },
            {
              maximumHitPoints: 500,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: ["move-afterlife-masenko"],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = {
      ...requireActiveFightState(
        requireTransition(advanceFight(created.state, dependencies)).state,
      ),
      turnNumber: 10,
    } satisfies ActiveFightState;
    const scheduled = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          action,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:warp-cancel-schedule"),
            actorId: firstCombatantId,
            expectedStateVersion: action.version,
            moveId: "move-afterlife-warp-kamehameha",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );
    const opponentAction = requireTransition(
      advanceFight(requireTransition(advanceFight(scheduled, dependencies)).state, dependencies),
    );
    const opponentAttack = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          opponentAction.state,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:warp-cancel-attack"),
            actorId: secondCombatantId,
            expectedStateVersion: opponentAction.state.version,
            moveId: "move-afterlife-masenko",
            targetCombatantId: firstCombatantId,
          },
          dependencies,
        ),
      ).state,
    );
    const cancellationTransition = requireTransition(
      advanceFight(
        requireTransition(advanceFight(opponentAttack, dependencies)).state,
        dependencies,
      ),
    );
    const cancelled = requireActiveFightState(cancellationTransition.state);
    expect(deferredMove(cancelled, "move-afterlife-warp-kamehameha")).toBeUndefined();
    expect(cancelled.activeEffects).toContainEqual(
      expect.objectContaining({
        type: "action-lock",
        targetCombatantId: firstCombatantId,
        sourceDefinitionId: "move-afterlife-warp-kamehameha",
        affectedType: "attack",
        duration: { type: "combat" },
      }),
    );
    expect(cancellationTransition.events).toContainEqual(
      expect.objectContaining({
        type: "deferred-move-cancelled",
        moveId: "move-afterlife-warp-kamehameha",
      }),
    );
  });
});

describe("deferred cost catalog capabilities", () => {
  it("uses the opponent's next attack cost for BOOMerang on the user's next turn", () => {
    const dependencies = createDeferredDependencies("boomerang-next-cost", [20, 1, 20, 1, 20, 1]);
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 500,
              stats: { power: 100, dexterity: 10, dexterityBonus: 0 },
              moveIds: ["move-kiihakai-boomerang"],
            },
            {
              maximumHitPoints: 500,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: ["move-afterlife-masenko"],
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
            id: combatDecisionIdSchema.parse("decision:boomerang-first"),
            actorId: firstCombatantId,
            expectedStateVersion: firstAction.version,
            moveId: "move-kiihakai-boomerang",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );
    const opponentAction = requireTransition(
      advanceFight(requireTransition(advanceFight(firstAttack, dependencies)).state, dependencies),
    );
    const opponentAttack = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          opponentAction.state,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:boomerang-opponent"),
            actorId: secondCombatantId,
            expectedStateVersion: opponentAction.state.version,
            moveId: "move-afterlife-masenko",
            targetCombatantId: firstCombatantId,
          },
          dependencies,
        ),
      ).state,
    );
    const nextAction = requireActiveFightState(
      requireTransition(
        advanceFight(
          requireTransition(advanceFight(opponentAttack, dependencies)).state,
          dependencies,
        ),
      ).state,
    );

    expect(nextAction.activeCombatantId).toBe(firstCombatantId);
    const resumed = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          nextAction,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:boomerang-second"),
            actorId: firstCombatantId,
            expectedStateVersion: nextAction.version,
            moveId: "move-kiihakai-boomerang",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );

    expect(resumed.actionHistory.at(-1)).toMatchObject({
      type: "use-move",
      moveId: "move-kiihakai-boomerang",
      resolutionSnapshot: { paidKiCost: 1 },
    });
    expect(resumed.activeEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-next-action",
          sourceDefinitionId: "move-kiihakai-boomerang",
          createdAfterActionCount: resumed.actionHistory.length,
        }),
      ]),
    );
  });

  it("uses BOOMerang's approved base-cost fallback when the opponent passes", () => {
    const dependencies = createDeferredDependencies("boomerang-fallback", [20, 1, 20, 1]);
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 500,
              stats: { power: 100, dexterity: 10, dexterityBonus: 0 },
              moveIds: ["move-kiihakai-boomerang"],
            },
            {
              maximumHitPoints: 500,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: ["move-afterlife-masenko"],
            },
          ],
        },
        dependencies,
      ),
    );
    const firstAction = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const preparedFirstAction: ActiveFightState = {
      ...firstAction,
      combatants: {
        ...firstAction.combatants,
        [firstCombatantId]: {
          ...firstAction.combatants[firstCombatantId],
          ki: { ...firstAction.combatants[firstCombatantId].ki, current: 6 },
        },
      },
    };
    const firstAttack = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          preparedFirstAction,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:boomerang-fallback-first"),
            actorId: firstCombatantId,
            expectedStateVersion: firstAction.version,
            moveId: "move-kiihakai-boomerang",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );
    const opponentAction = requireTransition(
      advanceFight(requireTransition(advanceFight(firstAttack, dependencies)).state, dependencies),
    );
    const opponentPass = requireTransition(
      submitCombatDecision(
        opponentAction.state,
        {
          type: "pass",
          id: combatDecisionIdSchema.parse("decision:boomerang-fallback-pass"),
          actorId: secondCombatantId,
          expectedStateVersion: opponentAction.state.version,
        },
        dependencies,
      ),
    );
    const nextAction = requireActiveFightState(
      requireTransition(
        advanceFight(
          requireTransition(advanceFight(opponentPass.state, dependencies)).state,
          dependencies,
        ),
      ).state,
    );
    const resumed = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          nextAction,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:boomerang-fallback-second"),
            actorId: firstCombatantId,
            expectedStateVersion: nextAction.version,
            moveId: "move-kiihakai-boomerang",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );

    expect(resumed.actionHistory.at(-1)).toMatchObject({
      type: "use-move",
      moveId: "move-kiihakai-boomerang",
      resolutionSnapshot: { paidKiCost: 3 },
    });
  });
});

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

const createKineticDependencies = () =>
  createTestCombatDependencies([20, 1], new Date("2026-08-04T12:00:00.000Z"), {
    fightIds: [fightIdSchema.parse("fight:kinetic-outburst")],
    combatantIds: [firstCombatantId, secondCombatantId],
    eventIds: Array.from({ length: 30 }, (_, index) =>
      combatEventIdSchema.parse(`event:kinetic-outburst-${index + 1}`),
    ),
    activeEffectIds: Array.from({ length: 10 }, (_, index) =>
      activeEffectIdSchema.parse(`active-effect:kinetic-outburst-${index + 1}`),
    ),
    pendingDecisionIds: [pendingDecisionIdSchema.parse("pending-decision:kinetic-outburst")],
    resolutionFrameIds: [resolutionFrameIdSchema.parse("resolution-frame:kinetic-outburst")],
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
              maximumHitPoints: 10000,
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

  it("offers Kinetic Outburst's grouped roll penalty as a public pending choice", () => {
    const dependencies = createKineticDependencies();
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
              moveIds: ["move-kiihakai-kinetic-outburst"],
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
    const pending = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          action,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:kinetic-outburst"),
            actorId: firstCombatantId,
            expectedStateVersion: action.version,
            moveId: "move-kiihakai-kinetic-outburst",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );

    expect(pending.pendingDecision?.type).toBe("optional-effect");
    expect(pending.pendingDecision?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "decline" }),
        expect.objectContaining({ id: "activate-effect:0,1" }),
      ]),
    );
    expect(pending.resolutionFrames[0]).toMatchObject({
      stage: "awaiting-effect-choice",
    });
  });
});

describe("generic combat-local move removal", () => {
  it("removes the source move through the public action transition and updates legal decisions", () => {
    const dependencies = createTestCombatDependencies(
      [20, 1],
      new Date("2026-08-04T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:nullifying-sphere")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 80 }, (_, index) =>
          combatEventIdSchema.parse(`event:nullifying-sphere-${index + 1}`),
        ),
        activeEffectIds: Array.from({ length: 20 }, (_, index) =>
          activeEffectIdSchema.parse(`active-effect:nullifying-sphere-${index + 1}`),
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
              moveIds: ["move-aoyosumu-breakout", "move-afterlife-spirit-bomb"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: ["move-afterlife-spirit-bomb"],
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
        id: combatDecisionIdSchema.parse("decision:aoyosumu-breakout"),
        actorId: firstCombatantId,
        expectedStateVersion: action.version,
        moveId: "move-aoyosumu-breakout",
        targetCombatantId: secondCombatantId,
      },
      dependencies,
    );
    if (!submitted.ok) throw new Error(JSON.stringify(submitted.error));
    const transition = submitted.value;

    expect(transition.state.version).toBe(action.version + 1);
    expect(transition.state.combatants[firstCombatantId].moveIds).toEqual([
      "move-afterlife-spirit-bomb",
    ]);
    expect(transition.state.activeEffects).toContainEqual(
      expect.objectContaining({
        type: "remove-move-from-combat",
        targetCombatantId: firstCombatantId,
        moveId: "move-aoyosumu-breakout",
        duration: "combat",
      }),
    );
    expect(transition.events).toContainEqual(
      expect.objectContaining({
        type: "move-removed-from-combat",
        combatantId: firstCombatantId,
        moveId: "move-aoyosumu-breakout",
      }),
    );
    expect(
      enumerateLegalDecisions(transition.state as ActiveFightState, firstCombatantId),
    ).not.toContainEqual(expect.objectContaining({ moveId: "move-aoyosumu-breakout" }));
  });

  it("serializes a selected temporary target removal and restores it after a perfect roll", () => {
    const selectedMove = "move-freestyle-straining-concussion-wave";
    const remainingMove = "move-afterlife-masenko";
    const dependencies = createTestCombatDependencies(
      [30, 1, 30, 1],
      new Date("2026-08-24T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:straining-concussion-wave-removal")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 100 }, (_, index) =>
          combatEventIdSchema.parse(`event:straining-concussion-wave-${index + 1}`),
        ),
        activeEffectIds: Array.from({ length: 10 }, (_, index) =>
          activeEffectIdSchema.parse(`active-effect:straining-concussion-wave-${index + 1}`),
        ),
        pendingDecisionIds: Array.from({ length: 10 }, (_, index) =>
          pendingDecisionIdSchema.parse(`pending-decision:straining-concussion-wave-${index + 1}`),
        ),
        resolutionFrameIds: Array.from({ length: 10 }, (_, index) =>
          resolutionFrameIdSchema.parse(`resolution-frame:straining-concussion-wave-${index + 1}`),
        ),
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 1000,
              stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
              moveIds: ["move-freestyle-straining-concussion-wave"],
            },
            {
              maximumHitPoints: 1000,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: [selectedMove, remainingMove],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const defensePending = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          action,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:straining-concussion-wave"),
            actorId: firstCombatantId,
            expectedStateVersion: action.version,
            moveId: "move-freestyle-straining-concussion-wave",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );
    const successfulAttack = defensePending;

    expect(successfulAttack.pendingDecision).toMatchObject({
      type: "select-move",
      combatantId: firstCombatantId,
      options: [
        { id: `select-move-removal:${selectedMove}`, type: "select-move", moveId: selectedMove },
        { id: `select-move-removal:${remainingMove}`, type: "select-move", moveId: remainingMove },
      ],
    });
    expect(enumerateLegalDecisions(successfulAttack, firstCombatantId)).toEqual([]);
    expect(successfulAttack.resolutionFrames[0]).toMatchObject({
      operation: "select-move-removal",
      eligibleMoveIds: [selectedMove, remainingMove],
      remainingSelections: 1,
    });

    const selected = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          successfulAttack,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:straining-concussion-wave-select"),
            actorId: firstCombatantId,
            expectedStateVersion: successfulAttack.version,
            pendingDecisionId: successfulAttack.pendingDecision!.id,
            optionId: `select-move-removal:${selectedMove}`,
          },
          dependencies,
        ),
      ).state,
    );
    const temporaryRemoval = selected.activeEffects.find(
      (effect) => effect.type === "remove-move-from-combat" && effect.duration !== "combat",
    );
    expect(temporaryRemoval).toMatchObject({
      type: "remove-move-from-combat",
      sourceDefinitionId: "move-freestyle-straining-concussion-wave",
      sourceEffectIndex: 1,
      targetCombatantId: secondCombatantId,
      moveId: selectedMove,
      removedFromIndex: 0,
      duration: { type: "until-perfect-roll", combatantId: secondCombatantId },
    });
    expect(selected.combatants[secondCombatantId].moveIds).toEqual([remainingMove]);
    expect(selected.combatants[secondCombatantId].moveUses[selectedMove]).toBeUndefined();
    const targetAction = {
      ...selected,
      phase: "action" as const,
      activeCombatantId: secondCombatantId,
    };
    const restored = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          targetAction,
          {
            type: "basic-attack",
            id: combatDecisionIdSchema.parse("decision:straining-concussion-wave-perfect"),
            actorId: secondCombatantId,
            expectedStateVersion: selected.version,
            basicAttack: "basic-punch",
            targetCombatantId: firstCombatantId,
          },
          dependencies,
        ),
      ).state,
    );
    expect(restored.combatants[secondCombatantId].moveIds).toEqual([selectedMove, remainingMove]);
    expect(restored.activeEffects).not.toContainEqual(
      expect.objectContaining({ moveId: selectedMove, type: "remove-move-from-combat" }),
    );
  });
});

describe("generic copied attack executor", () => {
  it("replays the last unrestricted attack with a durable source snapshot and bonus damage", () => {
    const dependencies = createTestCombatDependencies(
      [20, 1, 20, 1],
      new Date("2026-08-21T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:copied-attack")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 100 }, (_, index) =>
          combatEventIdSchema.parse(`event:copied-attack-${index + 1}`),
        ),
        pendingDecisionIds: [
          pendingDecisionIdSchema.parse("pending-decision:copied-source-defense"),
          pendingDecisionIdSchema.parse("pending-decision:copied-replay-defense"),
        ],
        resolutionFrameIds: [
          resolutionFrameIdSchema.parse("resolution-frame:copied-source-defense"),
          resolutionFrameIdSchema.parse("resolution-frame:copied-replay-defense"),
        ],
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 200,
              stats: { power: 100, dexterity: 10, dexterityBonus: 0 },
              moveIds: ["move-afterlife-kamehameha", "move-kurokonwaku-flashback"],
            },
            {
              maximumHitPoints: 200,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: ["move-kurokonwaku-sand-in-the-eyes"],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireTransition(advanceFight(created.state, dependencies));
    const sourcePending = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          action.state,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:copied-source"),
            actorId: firstCombatantId,
            expectedStateVersion: action.state.version,
            moveId: "move-afterlife-kamehameha",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );
    expect(sourcePending.pendingDecision?.type).toBe("defense-response");
    const sourceAttack = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          sourcePending,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:copied-source-defense"),
            actorId: secondCombatantId,
            expectedStateVersion: sourcePending.version,
            pendingDecisionId: sourcePending.pendingDecision!.id,
            optionId: "roll-defense",
          },
          dependencies,
        ),
      ).state,
    );

    const opponentUpkeep = requireTransition(advanceFight(sourceAttack, dependencies));
    const opponentAction = requireTransition(advanceFight(opponentUpkeep.state, dependencies));
    const opponentPassed = requireTransition(
      submitCombatDecision(
        opponentAction.state,
        {
          type: "pass",
          id: combatDecisionIdSchema.parse("decision:copied-opponent-pass"),
          actorId: secondCombatantId,
          expectedStateVersion: opponentAction.state.version,
        },
        dependencies,
      ),
    );
    const sourceUpkeep = requireTransition(advanceFight(opponentPassed.state, dependencies));
    const sourceAction = requireTransition(advanceFight(sourceUpkeep.state, dependencies));
    const legal = enumerateLegalDecisions(sourceAction.state, firstCombatantId);
    expect(legal).toContainEqual(
      expect.objectContaining({ type: "use-move", moveId: "move-kurokonwaku-flashback" }),
    );

    const replayPending = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          sourceAction.state,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:copied-replay"),
            actorId: firstCombatantId,
            expectedStateVersion: sourceAction.state.version,
            moveId: "move-kurokonwaku-flashback",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );
    expect(replayPending.resolutionFrames[0]).toMatchObject({
      stage: "awaiting-defense",
      attack: {
        type: "move",
        moveId: "move-kurokonwaku-flashback",
        copiedFromMoveId: "move-afterlife-kamehameha",
        copiedDamageBonusPercent: 10,
      },
    });

    const replayed = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          replayPending,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:copied-replay-defense"),
            actorId: secondCombatantId,
            expectedStateVersion: replayPending.version,
            pendingDecisionId: replayPending.pendingDecision!.id,
            optionId: "roll-defense",
          },
          dependencies,
        ),
      ).state,
    );

    const initialKi = action.state.combatants[firstCombatantId].ki.current;
    expect(replayed.combatants[firstCombatantId].ki.current).toBe(initialKi - 4);
    expect(replayed.actionHistory.at(-1)).toMatchObject({
      type: "use-move",
      moveId: "move-kurokonwaku-flashback",
      outcome: "successful",
      damageDealt: 60,
    });
    expect(replayed.version).toBeGreaterThan(sourceAction.state.version);
  });

  it("selects a prior successful Advanced Attack and replays only its successful effect with exact damage", () => {
    const dependencies = createTestCombatDependencies(
      [20, 1, 20, 1],
      new Date("2026-08-23T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:karmic-copy")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 120 }, (_, index) =>
          combatEventIdSchema.parse(`event:karmic-copy-${index + 1}`),
        ),
        activeEffectIds: Array.from({ length: 10 }, (_, index) =>
          activeEffectIdSchema.parse(`active-effect:karmic-copy-${index + 1}`),
        ),
        pendingDecisionIds: [
          pendingDecisionIdSchema.parse("pending-decision:karmic-selection"),
          pendingDecisionIdSchema.parse("pending-decision:karmic-defense"),
        ],
        resolutionFrameIds: [
          resolutionFrameIdSchema.parse("resolution-frame:karmic-selection"),
          resolutionFrameIdSchema.parse("resolution-frame:karmic-defense"),
        ],
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 200,
              stats: { power: 100, dexterity: 10, dexterityBonus: 0 },
              moveIds: ["move-aoyosumu-karmic-possession"],
            },
            {
              maximumHitPoints: 200,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: ["move-aoyosumu-push", "move-kurokonwaku-sand-in-the-eyes"],
            },
          ],
        },
        dependencies,
      ),
    );
    const firstAction = requireTransition(advanceFight(created.state, dependencies));
    const firstPassed = requireTransition(
      submitCombatDecision(
        firstAction.state,
        {
          type: "pass",
          id: combatDecisionIdSchema.parse("decision:karmic-pass"),
          actorId: firstCombatantId,
          expectedStateVersion: firstAction.state.version,
        },
        dependencies,
      ),
    );
    const secondUpkeep = requireTransition(advanceFight(firstPassed.state, dependencies));
    const secondAction = requireTransition(advanceFight(secondUpkeep.state, dependencies));
    const sourceAttack = requireTransition(
      submitCombatDecision(
        secondAction.state,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:karmic-source"),
          actorId: secondCombatantId,
          expectedStateVersion: secondAction.state.version,
          moveId: "move-aoyosumu-push",
          targetCombatantId: firstCombatantId,
        },
        dependencies,
      ),
    );
    expect(sourceAttack.state.actionHistory.at(-1)).toMatchObject({
      type: "use-move",
      decisionId: "decision:karmic-source",
      outcome: "successful",
      damageDealt: 9,
    });

    const firstUpkeep = requireTransition(advanceFight(sourceAttack.state, dependencies));
    const karmicAction = requireTransition(advanceFight(firstUpkeep.state, dependencies));
    expect(enumerateLegalDecisions(karmicAction.state, firstCombatantId)).toContainEqual(
      expect.objectContaining({ moveId: "move-aoyosumu-karmic-possession" }),
    );
    const selectionPending = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          karmicAction.state,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:karmic-use"),
            actorId: firstCombatantId,
            expectedStateVersion: karmicAction.state.version,
            moveId: "move-aoyosumu-karmic-possession",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );
    expect(selectionPending.pendingDecision).toMatchObject({
      type: "select-move",
      options: [
        {
          id: "copy-move:decision:karmic-source",
          moveId: "move-aoyosumu-push",
          sourceActionId: "decision:karmic-source",
          sourceDamageDealt: 9,
        },
      ],
    });
    expect(selectionPending.resolutionFrames[0]).toMatchObject({
      operation: "copy-move",
      eligibleSourceActionIds: ["decision:karmic-source"],
    });

    const defensePending = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          selectionPending,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:karmic-select"),
            actorId: firstCombatantId,
            expectedStateVersion: selectionPending.version,
            pendingDecisionId: selectionPending.pendingDecision!.id,
            optionId: "copy-move:decision:karmic-source",
          },
          dependencies,
        ),
      ).state,
    );
    expect(defensePending.resolutionFrames[0]).toMatchObject({
      stage: "awaiting-defense",
      attack: {
        moveId: "move-aoyosumu-karmic-possession",
        copiedFromMoveId: "move-aoyosumu-push",
        copiedDamageOverride: 9,
        copiedSuccessfulEffectsOnly: true,
        copiedSourceMove: { id: "move-aoyosumu-push" },
      },
    });

    const resolved = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          defensePending,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:karmic-defense"),
            actorId: secondCombatantId,
            expectedStateVersion: defensePending.version,
            pendingDecisionId: defensePending.pendingDecision!.id,
            optionId: "roll-defense",
          },
          dependencies,
        ),
      ).state,
    );
    expect(resolved.actionHistory.at(-1)).toMatchObject({
      type: "use-move",
      moveId: "move-aoyosumu-karmic-possession",
      outcome: "successful",
      damageDealt: 9,
    });
    expect(resolved.combatants[secondCombatantId].hitPoints.current).toBe(191);
    expect(resolved.activeEffects).toContainEqual(
      expect.objectContaining({
        type: "action-lock",
        sourceDefinitionId: "move-aoyosumu-karmic-possession",
        targetCombatantId: secondCombatantId,
      }),
    );
    expect(resolved.resolutionFrames).toHaveLength(0);
    expect(resolved.pendingDecision).toBeUndefined();
  });

  it("replays Mind Reading's prior attack with its immutable cost, dice, and source-resolution snapshot", () => {
    const dependencies = createTestCombatDependencies(
      [20, 1, 1],
      new Date("2026-08-23T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:mind-reading-copy")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 100 }, (_, index) =>
          combatEventIdSchema.parse(`event:mind-reading-copy-${index + 1}`),
        ),
        activeEffectIds: Array.from({ length: 20 }, (_, index) =>
          activeEffectIdSchema.parse(`active-effect:mind-reading-copy-${index + 1}`),
        ),
        pendingDecisionIds: [
          pendingDecisionIdSchema.parse("pending-decision:mind-reading-selection"),
          pendingDecisionIdSchema.parse("pending-decision:mind-reading-defense"),
        ],
        resolutionFrameIds: [
          resolutionFrameIdSchema.parse("resolution-frame:mind-reading-selection"),
          resolutionFrameIdSchema.parse("resolution-frame:mind-reading-defense"),
        ],
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 200,
              stats: { power: 100, dexterity: 10, dexterityBonus: 0 },
              moveIds: ["move-haokiru-mind-reading"],
            },
            {
              maximumHitPoints: 200,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: ["move-afterlife-kamehameha", "move-kurokonwaku-sand-in-the-eyes"],
            },
          ],
        },
        dependencies,
      ),
    );
    const firstAction = requireTransition(advanceFight(created.state, dependencies));
    const firstPassed = requireTransition(
      submitCombatDecision(
        firstAction.state,
        {
          type: "pass",
          id: combatDecisionIdSchema.parse("decision:mind-reading-pass"),
          actorId: firstCombatantId,
          expectedStateVersion: firstAction.state.version,
        },
        dependencies,
      ),
    );
    const secondUpkeep = requireTransition(advanceFight(firstPassed.state, dependencies));
    const secondAction = requireTransition(advanceFight(secondUpkeep.state, dependencies));
    const sourceAction = requireTransition(
      submitCombatDecision(
        secondAction.state,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:mind-reading-source"),
          actorId: secondCombatantId,
          expectedStateVersion: secondAction.state.version,
          moveId: "move-afterlife-kamehameha",
          targetCombatantId: firstCombatantId,
        },
        dependencies,
      ),
    );
    const firstUpkeep = requireTransition(advanceFight(sourceAction.state, dependencies));
    const nextAction = requireTransition(advanceFight(firstUpkeep.state, dependencies));
    expect(enumerateLegalDecisions(nextAction.state, firstCombatantId)).toContainEqual(
      expect.objectContaining({ moveId: "move-haokiru-mind-reading" }),
    );
    const selectionPending = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          nextAction.state,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:mind-reading-use"),
            actorId: firstCombatantId,
            expectedStateVersion: nextAction.state.version,
            moveId: "move-haokiru-mind-reading",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );
    expect(selectionPending.pendingDecision?.options[0]).toMatchObject({
      sourceActionId: "decision:mind-reading-source",
      sourceResolutionSnapshot: {
        paidKiCost: expect.any(Number),
        naturalAttackRolls: [20],
      },
    });
    const defensePending = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          selectionPending,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:mind-reading-select-source"),
            actorId: firstCombatantId,
            expectedStateVersion: selectionPending.version,
            pendingDecisionId: selectionPending.pendingDecision!.id,
            optionId: "copy-move:decision:mind-reading-source",
          },
          dependencies,
        ),
      ).state,
    );
    expect(defensePending.resolutionFrames[0]).toMatchObject({
      stage: "awaiting-defense",
      attack: {
        copiedFromMoveId: "move-afterlife-kamehameha",
        copiedSourceResolution: {
          paidKiCost: expect.any(Number),
          naturalAttackRolls: [20],
        },
      },
    });
    const resolved = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          defensePending,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:mind-reading-defense"),
            actorId: secondCombatantId,
            expectedStateVersion: defensePending.version,
            pendingDecisionId: defensePending.pendingDecision!.id,
            optionId: "roll-defense",
          },
          dependencies,
        ),
      ).state,
    );
    expect(resolved.actionHistory.at(-1)).toMatchObject({
      type: "use-move",
      moveId: "move-haokiru-mind-reading",
      outcome: "successful",
      damageDealt: 10,
    });
    expect(resolved.combatants[secondCombatantId].ki.current).toBe(
      nextAction.state.combatants[firstCombatantId].ki.current -
        selectionPending.pendingDecision!.options[0].sourceResolutionSnapshot!.paidKiCost,
    );
    expect(resolved.resolutionFrames).toHaveLength(0);
  });

  it("serializes Mimicry Master's opponent move selection and resolves the chosen attack once", () => {
    const dependencies = createTestCombatDependencies(
      [20, 1],
      new Date("2026-08-22T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:mimicry-selection")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 60 }, (_, index) =>
          combatEventIdSchema.parse(`event:mimicry-selection-${index + 1}`),
        ),
        pendingDecisionIds: [
          pendingDecisionIdSchema.parse("pending-decision:mimicry-selection"),
          pendingDecisionIdSchema.parse("pending-decision:mimicry-defense"),
        ],
        resolutionFrameIds: [
          resolutionFrameIdSchema.parse("resolution-frame:mimicry-selection"),
          resolutionFrameIdSchema.parse("resolution-frame:mimicry-defense"),
        ],
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 100, dexterity: 10, dexterityBonus: 0 },
              moveIds: ["move-kurokonwaku-mimicry-mastery"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 100, dexterity: 1, dexterityBonus: 0 },
              moveIds: ["move-afterlife-kamehameha", "move-kurokonwaku-sand-in-the-eyes"],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireTransition(advanceFight(created.state, dependencies));
    expect(enumerateLegalDecisions(action.state, firstCombatantId)).toContainEqual(
      expect.objectContaining({ moveId: "move-kurokonwaku-mimicry-mastery" }),
    );

    const pending = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          action.state,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:mimicry-selection"),
            actorId: firstCombatantId,
            expectedStateVersion: action.state.version,
            moveId: "move-kurokonwaku-mimicry-mastery",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );
    expect(pending.pendingDecision).toMatchObject({
      type: "select-move",
      combatantId: firstCombatantId,
      options: [
        {
          id: "copy-move:move-afterlife-kamehameha",
          type: "select-move",
          moveId: "move-afterlife-kamehameha",
        },
      ],
    });
    expect(pending.resolutionFrames[0]).toMatchObject({
      operation: "copy-move",
      decisionId: "decision:mimicry-selection",
      eligibleMoveIds: ["move-afterlife-kamehameha"],
    });

    const defensePending = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          pending,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:mimicry-select-source"),
            actorId: firstCombatantId,
            expectedStateVersion: pending.version,
            pendingDecisionId: pending.pendingDecision!.id,
            optionId: "copy-move:move-afterlife-kamehameha",
          },
          dependencies,
        ),
      ).state,
    );
    expect(defensePending.resolutionFrames[0]).toMatchObject({
      stage: "awaiting-defense",
      attack: {
        type: "move",
        moveId: "move-kurokonwaku-mimicry-mastery",
        copiedFromMoveId: "move-afterlife-kamehameha",
      },
    });

    const resolved = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          defensePending,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:mimicry-defense"),
            actorId: secondCombatantId,
            expectedStateVersion: defensePending.version,
            pendingDecisionId: defensePending.pendingDecision!.id,
            optionId: "roll-defense",
          },
          dependencies,
        ),
      ).state,
    );
    expect(resolved.combatants[firstCombatantId].ki.current).toBe(
      action.state.combatants[firstCombatantId].ki.current - 2,
    );
    expect(resolved.combatants[firstCombatantId].moveUses["move-kurokonwaku-mimicry-mastery"]).toBe(
      1,
    );
    expect(resolved.actionHistory.at(-1)).toMatchObject({
      type: "use-move",
      moveId: "move-kurokonwaku-mimicry-mastery",
      outcome: "successful",
      damageDealt: 50,
    });
    expect(resolved.resolutionFrames).toHaveLength(0);
  });
});

describe("generic on-success pending effect choices", () => {
  it("serializes the completed roll and applies an on-success damage choice exactly once", () => {
    const dependencies = createTestCombatDependencies(
      [20, 1],
      new Date("2026-08-04T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:orange-burst")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 40 }, (_, index) =>
          combatEventIdSchema.parse(`event:orange-burst-${index + 1}`),
        ),
        pendingDecisionIds: [pendingDecisionIdSchema.parse("pending-decision:orange-burst")],
        resolutionFrameIds: [resolutionFrameIdSchema.parse("resolution-frame:orange-burst")],
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 100, dexterity: 10, dexterityBonus: 0 },
              moveIds: ["move-kiihakai-orange-burst"],
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
    const pendingTransition = requireTransition(
      submitCombatDecision(
        action,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:orange-burst"),
          actorId: firstCombatantId,
          expectedStateVersion: action.version,
          moveId: "move-kiihakai-orange-burst",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );
    const pending = requireActiveFightState(pendingTransition.state);

    expect(pending.pendingDecision).toMatchObject({
      type: "optional-effect",
      options: [
        { id: "activate-effect:0,1", type: "activate-effect", effectIndices: [0, 1] },
        { id: "decline", type: "decline" },
      ],
    });
    expect(pending.resolutionFrames[0]).toMatchObject({
      stage: "awaiting-effect-choice",
      effectTrigger: "on-success",
      naturalRolls: [{ attack: 20, defense: 1 }],
    });
    expect(pendingTransition.events.filter((event) => event.type === "attack-rolled")).toHaveLength(
      1,
    );

    const resumed = requireTransition(
      submitCombatDecision(
        pending,
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:orange-burst-activate"),
          actorId: firstCombatantId,
          expectedStateVersion: pending.version,
          pendingDecisionId: pending.pendingDecision!.id,
          optionId: "activate-effect:0,1",
        },
        dependencies,
      ),
    );
    const completed = requireActiveFightState(resumed.state);

    expect(completed.combatants[secondCombatantId].hitPoints.current).toBe(80);
    expect(completed.combatants[firstCombatantId].ki.current).toBe(3);
    expect(resumed.events.filter((event) => event.type === "attack-rolled")).toHaveLength(0);
  });

  it("persists Tornado Uppercut's selected HP-loss modifier and applies it to the next matching attack", () => {
    const dependencies = createTestCombatDependencies(
      [20, 1, 20, 1],
      new Date("2026-08-23T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:tornado-uppercut-resource-cost")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 60 }, (_, index) =>
          combatEventIdSchema.parse(`event:tornado-uppercut-${index + 1}`),
        ),
        activeEffectIds: Array.from({ length: 6 }, (_, index) =>
          activeEffectIdSchema.parse(`active-effect:tornado-uppercut-${index + 1}`),
        ),
        pendingDecisionIds: [
          pendingDecisionIdSchema.parse("pending-decision:tornado-uppercut-choice"),
          pendingDecisionIdSchema.parse("pending-decision:tornado-uppercut-defense"),
        ],
        resolutionFrameIds: [
          resolutionFrameIdSchema.parse("resolution-frame:tornado-uppercut-choice"),
          resolutionFrameIdSchema.parse("resolution-frame:tornado-uppercut-defense"),
        ],
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 100, dexterity: 10, dexterityBonus: 0 },
              moveIds: [
                "move-haokiru-tornado-uppercut",
                "move-freestyle-straining-concussion-wave",
              ],
            },
            {
              maximumHitPoints: 10000,
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
    const pending = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          action,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:tornado-uppercut"),
            actorId: firstCombatantId,
            expectedStateVersion: action.version,
            moveId: "move-haokiru-tornado-uppercut",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );

    expect(pending.pendingDecision?.options).toEqual([
      { id: "activate-effect:2", type: "activate-effect", effectIndices: [2] },
      { id: "activate-effect:3", type: "activate-effect", effectIndices: [3] },
      { id: "decline", type: "decline" },
    ]);

    const completed = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          pending,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:tornado-uppercut-activate"),
            actorId: firstCombatantId,
            expectedStateVersion: pending.version,
            pendingDecisionId: pending.pendingDecision!.id,
            optionId: "activate-effect:2",
          },
          dependencies,
        ),
      ).state,
    );
    expect(completed.combatants[firstCombatantId].ki.current).toBe(
      action.combatants[firstCombatantId].ki.current - 2,
    );
    expect(completed.activeEffects).toContainEqual(
      expect.objectContaining({
        type: "modify-next-action",
        sourceDefinitionId: "move-haokiru-tornado-uppercut",
        sourceEffectIndex: 2,
        modifier: {
          type: "resource-cost",
          resource: "hp",
          operation: "add",
          amount: -100,
        },
      }),
    );

    const nextAction = {
      ...completed,
      phase: "action" as const,
      activeCombatantId: firstCombatantId,
    };
    const nextAttack = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          nextAction,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:tornado-uppercut-follow-up"),
            actorId: firstCombatantId,
            expectedStateVersion: nextAction.version,
            moveId: "move-freestyle-straining-concussion-wave",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );

    expect(nextAttack.combatants[firstCombatantId].hitPoints.current).toBe(
      completed.combatants[firstCombatantId].hitPoints.current,
    );
    expect(nextAttack.pendingDecision).toBeUndefined();
    expect(nextAttack.activeEffects).not.toContainEqual(
      expect.objectContaining({
        type: "modify-next-action",
        sourceDefinitionId: "move-haokiru-tornado-uppercut",
        sourceEffectIndex: 2,
      }),
    );
  });
});

describe("generic on-damage pending effect choices", () => {
  it("lets the defender activate Muscle Infusion after a successful advanced attack", () => {
    const dependencies = createTestCombatDependencies(
      [20, 1],
      new Date("2026-08-04T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:muscle-infusion")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 40 }, (_, index) =>
          combatEventIdSchema.parse(`event:muscle-infusion-${index + 1}`),
        ),
        activeEffectIds: [activeEffectIdSchema.parse("active-effect:muscle-infusion-generated")],
        pendingDecisionIds: [pendingDecisionIdSchema.parse("pending-decision:muscle-infusion")],
        resolutionFrameIds: [resolutionFrameIdSchema.parse("resolution-frame:muscle-infusion")],
      },
    );
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 100, dexterity: 10, dexterityBonus: 0 },
              moveIds: ["move-afterlife-masenko"],
            },
            {
              maximumHitPoints: 10000,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: ["move-haokiru-muscle-infusion"],
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
        [secondCombatantId]: {
          ...action.combatants[secondCombatantId],
          ki: { ...action.combatants[secondCombatantId].ki, current: 5 },
        },
      },
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:muscle-infusion"),
          type: "active-constant",
          sourceCombatantId: secondCombatantId,
          targetCombatantId: secondCombatantId,
          sourceDefinitionId: "move-haokiru-muscle-infusion",
          activatedOnTurn: action.turnNumber,
          duration: "combat",
          paidActivationCost: 1,
          lifecycle: "active",
        },
      ],
    };

    const pendingResult = submitCombatDecision(
      prepared,
      {
        type: "use-move",
        id: combatDecisionIdSchema.parse("decision:muscle-infusion-attack"),
        actorId: firstCombatantId,
        expectedStateVersion: prepared.version,
        moveId: "move-afterlife-masenko",
        targetCombatantId: secondCombatantId,
      },
      dependencies,
    );
    if (!pendingResult.ok) throw new Error(JSON.stringify(pendingResult));
    const pendingTransition = pendingResult.value;
    const pending = requireActiveFightState(pendingTransition.state);

    expect(pending.pendingDecision).toMatchObject({
      type: "optional-effect",
      combatantId: secondCombatantId,
      options: [
        { id: "activate-effect:0", type: "activate-effect", effectIndices: [0] },
        { id: "decline", type: "decline" },
      ],
    });
    expect(pending.resolutionFrames[0]).toMatchObject({
      type: "attack",
      stage: "awaiting-effect-choice",
      effectSourceDefinitionId: "move-haokiru-muscle-infusion",
      effectTrigger: "on-damage",
      naturalRolls: [{ attack: 20, defense: 1 }],
    });

    const resumedResult = submitCombatDecision(
      pending,
      {
        type: "respond-to-pending-decision",
        id: combatDecisionIdSchema.parse("decision:muscle-infusion-activate"),
        actorId: secondCombatantId,
        expectedStateVersion: pending.version,
        pendingDecisionId: pending.pendingDecision!.id,
        optionId: "activate-effect:0",
      },
      dependencies,
    );
    if (!resumedResult.ok) throw new Error(JSON.stringify(resumedResult));
    const resumed = requireActiveFightState(resumedResult.value.state);

    expect(resumed.combatants[secondCombatantId].ki.current).toBe(4);
    expect(
      resumed.combatants[secondCombatantId].effectUseCounts?.["move-haokiru-muscle-infusion:0"],
    ).toBe(1);
    expect(resumed.combatants[secondCombatantId].hitPoints.current).toBeLessThan(10000);
    expect(resumed.resolutionFrames).toHaveLength(0);
    expect(resumed.pendingDecision).toBeUndefined();
  });
});

describe("generic successful CONSTANT Skill activation", () => {
  it("applies Overdrive Blast's exact power-up activation context", () => {
    const dependencies = createTestCombatDependencies(
      [30, 1],
      new Date("2026-08-23T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:overdrive-as-if")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 40 }, (_, index) =>
          combatEventIdSchema.parse(`event:overdrive-as-if-${index + 1}`),
        ),
        pendingDecisionIds: [pendingDecisionIdSchema.parse("pending-decision:overdrive-as-if")],
        resolutionFrameIds: [resolutionFrameIdSchema.parse("resolution-frame:overdrive-as-if")],
        activeEffectIds: Array.from({ length: 4 }, (_, index) =>
          activeEffectIdSchema.parse(`active-effect:overdrive-as-if-${index + 1}`),
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
              moveIds: ["move-kiihakai-overdrive-blast", "move-kiihakai-overdrive-mastery"],
            },
            {
              maximumHitPoints: 10000,
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
          ki: { current: 10, maximum: 10 },
        },
      },
    };
    const pending = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          prepared,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:overdrive-as-if-attack"),
            actorId: firstCombatantId,
            expectedStateVersion: prepared.version,
            moveId: "move-kiihakai-overdrive-blast",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );
    expect(pending).toMatchObject({
      pendingDecision: {
        type: "select-move",
        options: [
          {
            id: "activate:move-kiihakai-overdrive-mastery",
            moveId: "move-kiihakai-overdrive-mastery",
          },
        ],
      },
    });

    const resumed = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          pending,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:overdrive-as-if-select"),
            actorId: firstCombatantId,
            expectedStateVersion: pending.version,
            pendingDecisionId: pending.pendingDecision!.id,
            optionId: "activate:move-kiihakai-overdrive-mastery",
          },
          dependencies,
        ),
      ).state,
    );

    expect(resumed.activeEffects).toContainEqual(
      expect.objectContaining({
        type: "active-constant",
        sourceDefinitionId: "move-kiihakai-overdrive-mastery",
        lifecycle: "active",
      }),
    );
    expect(resumed.activeEffects).toContainEqual(
      expect.objectContaining({
        type: "modify-damage",
        sourceDefinitionId: "move-kiihakai-overdrive-mastery",
        sourceEffectIndex: 0,
        amount: 3,
        duration: { type: "turns", ownerCombatantId: firstCombatantId, remaining: 1 },
      }),
    );
  });

  it("serializes Big Shot's keyed all-CONSTANT activation group", () => {
    const dependencies = createTestCombatDependencies(
      [30, 1],
      new Date("2026-08-23T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:big-shot-keyed")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 50 }, (_, index) =>
          combatEventIdSchema.parse(`event:big-shot-keyed-${index + 1}`),
        ),
        pendingDecisionIds: [
          pendingDecisionIdSchema.parse("pending-decision:big-shot-keyed-1"),
          pendingDecisionIdSchema.parse("pending-decision:big-shot-keyed-2"),
        ],
        resolutionFrameIds: [resolutionFrameIdSchema.parse("resolution-frame:big-shot-keyed")],
        activeEffectIds: Array.from({ length: 8 }, (_, index) =>
          activeEffectIdSchema.parse(`active-effect:big-shot-keyed-${index + 1}`),
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
              moveIds: [
                "move-kiihakai-big-shot",
                "move-freestyle-monkey-maneuvers",
                "move-kiihakai-energy-gathering",
              ],
            },
            {
              maximumHitPoints: 10000,
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
          ki: { current: 20, maximum: 20 },
        },
      },
    };
    const pending = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          prepared,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:big-shot-keyed-attack"),
            actorId: firstCombatantId,
            expectedStateVersion: prepared.version,
            moveId: "move-kiihakai-big-shot",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );
    expect(pending.pendingDecision?.options).toEqual([
      expect.objectContaining({ moveId: "move-freestyle-monkey-maneuvers" }),
      expect.objectContaining({ moveId: "move-kiihakai-energy-gathering" }),
    ]);
    expect(pending.resolutionFrames[0]).toMatchObject({
      operation: "activate",
      activationSelection: "all",
      selectionKey: "big-shot-activated-constants",
      remainingSelections: 2,
    });

    const firstSelection = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          pending,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:big-shot-keyed-select-1"),
            actorId: firstCombatantId,
            expectedStateVersion: pending.version,
            pendingDecisionId: pending.pendingDecision!.id,
            optionId: "activate:move-freestyle-monkey-maneuvers",
          },
          dependencies,
        ),
      ).state,
    );
    expect(firstSelection.resolutionFrames[0]).toMatchObject({ remainingSelections: 1 });

    const completed = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          firstSelection,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:big-shot-keyed-select-2"),
            actorId: firstCombatantId,
            expectedStateVersion: firstSelection.version,
            pendingDecisionId: firstSelection.pendingDecision!.id,
            optionId: "activate:move-kiihakai-energy-gathering",
          },
          dependencies,
        ),
      ).state,
    );
    expect(completed.activeEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "active-constant",
          sourceDefinitionId: "move-freestyle-monkey-maneuvers",
          selectionKey: "big-shot-activated-constants",
        }),
        expect.objectContaining({
          type: "active-constant",
          sourceDefinitionId: "move-kiihakai-energy-gathering",
          selectionKey: "big-shot-activated-constants",
        }),
      ]),
    );
  });

  it("creates Monkey Sweep's fallback floating effect when activation is unavailable", () => {
    const dependencies = createTestCombatDependencies(
      [20, 1],
      new Date("2026-08-23T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:monkey-sweep-unavailable")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: [activeEffectIdSchema.parse("active-effect:monkey-sweep-unavailable")],
        pendingDecisionIds: [
          pendingDecisionIdSchema.parse("pending-decision:monkey-sweep-unavailable"),
        ],
        resolutionFrameIds: [
          resolutionFrameIdSchema.parse("resolution-frame:monkey-sweep-unavailable"),
        ],
        eventIds: Array.from({ length: 30 }, (_, index) =>
          combatEventIdSchema.parse(`event:monkey-sweep-unavailable-${index + 1}`),
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
      ).state,
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created, dependencies)).state,
    );
    const prepared: ActiveFightState = {
      ...action,
      combatants: {
        ...action.combatants,
        [firstCombatantId]: {
          ...action.combatants[firstCombatantId],
          ki: { ...action.combatants[firstCombatantId].ki, current: 1 },
        },
      },
    };
    const attack = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          prepared,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:monkey-sweep-unavailable-attack"),
            actorId: firstCombatantId,
            expectedStateVersion: prepared.version,
            moveId: "move-freestyle-monkey-sweep",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );
    expect(attack.pendingDecision).toBeUndefined();
    expect(attack.combatants[firstCombatantId].ki.current).toBe(0);
    expect(attack.activeEffects).toContainEqual(
      expect.objectContaining({
        type: "floating-effect",
        sourceDefinitionId: "move-freestyle-monkey-sweep",
        sourceEffectIndex: 4,
        floatingEffectId: "monkey-sweep-unavailable-next-stun-or-break-bonus",
        scope: { type: "next-action" },
      }),
    );
  });

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
        activeEffectIds: [
          activeEffectIdSchema.parse("active-effect:activation"),
          activeEffectIdSchema.parse("active-effect:activation-cost-frame"),
        ],
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

    const serializedCostPending = {
      ...pending,
      resolutionFrames: pending.resolutionFrames.map((frame) =>
        frame.type === "effect" ? { ...frame, activationCost: { amount: 3, minimum: 2 } } : frame,
      ),
    };
    const costResumed = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          serializedCostPending,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:activation-select-cost-frame"),
            actorId: firstCombatantId,
            expectedStateVersion: serializedCostPending.version,
            pendingDecisionId: serializedCostPending.pendingDecision!.id,
            optionId: "activate:move-freestyle-monkey-maneuvers",
          },
          dependencies,
        ),
      ).state,
    );

    expect(costResumed.combatants[firstCombatantId].ki.current).toBe(1);
    expect(costResumed.activeEffects).toContainEqual(
      expect.objectContaining({
        sourceDefinitionId: "move-freestyle-monkey-maneuvers",
        paidActivationCost: 3,
      }),
    );
    expect(costResumed.version).toBe(serializedCostPending.version + 1);
  });

  it("serializes Rollback Barrage's bounded reactivation sequence", () => {
    const dependencies = createTestCombatDependencies(
      [30, 1, 30, 1, 30, 1, 30, 1, 1, 2, 1, 2, 1, 2, 1, 2],
      new Date("2026-08-22T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:rollback-reactivation")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 40 }, (_, index) =>
          combatEventIdSchema.parse(`event:rollback-reactivation-${index + 1}`),
        ),
        pendingDecisionIds: [
          pendingDecisionIdSchema.parse("pending-decision:rollback-effect"),
          pendingDecisionIdSchema.parse("pending-decision:rollback-select"),
          pendingDecisionIdSchema.parse("pending-decision:rollback-defense"),
        ],
        resolutionFrameIds: [resolutionFrameIdSchema.parse("resolution-frame:rollback")],
        activeEffectIds: [
          activeEffectIdSchema.parse("active-effect:rollback-evening"),
          activeEffectIdSchema.parse("active-effect:rollback-redirected"),
        ],
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
              moveIds: [
                "move-kiihakai-rollback-barrage",
                "move-kiihakai-evening-the-field",
                "move-kiihakai-redirected-energy",
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
          ki: { ...action.combatants[firstCombatantId].ki, current: 10 },
        },
      },
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:rollback-evening"),
          type: "active-constant",
          sourceCombatantId: firstCombatantId,
          targetCombatantId: firstCombatantId,
          sourceDefinitionId: "move-kiihakai-evening-the-field",
          activatedOnTurn: action.turnNumber,
          duration: "combat",
          paidActivationCost: 2,
          lifecycle: "deactivated",
          deactivatedOnTurn: action.turnNumber,
        },
        {
          id: activeEffectIdSchema.parse("active-effect:rollback-redirected"),
          type: "active-constant",
          sourceCombatantId: firstCombatantId,
          targetCombatantId: firstCombatantId,
          sourceDefinitionId: "move-kiihakai-redirected-energy",
          activatedOnTurn: action.turnNumber,
          duration: "combat",
          paidActivationCost: 1,
          lifecycle: "deactivated",
          deactivatedOnTurn: action.turnNumber,
        },
      ],
    };

    const effectPending = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          prepared,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:rollback-attack"),
            actorId: firstCombatantId,
            expectedStateVersion: prepared.version,
            moveId: "move-kiihakai-rollback-barrage",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );
    expect(effectPending.pendingDecision).toMatchObject({
      type: "select-move",
      options: [
        {
          id: "activate:move-kiihakai-evening-the-field",
          type: "select-move",
          moveId: "move-kiihakai-evening-the-field",
        },
        {
          id: "activate:move-kiihakai-redirected-energy",
          type: "select-move",
          moveId: "move-kiihakai-redirected-energy",
        },
        { id: "decline", type: "decline" },
      ],
    });
    expect(effectPending.resolutionFrames[0]).toMatchObject({
      operation: "activate",
      reactivationOnly: true,
      remainingSelections: 2,
    });

    const selectionPending = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          effectPending,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:rollback-effect"),
            actorId: firstCombatantId,
            expectedStateVersion: effectPending.version,
            pendingDecisionId: effectPending.pendingDecision!.id,
            optionId: "activate:move-kiihakai-evening-the-field",
          },
          dependencies,
        ),
      ).state,
    );
    expect(selectionPending.pendingDecision).toMatchObject({
      type: "select-move",
      options: [
        {
          id: "activate:move-kiihakai-redirected-energy",
          type: "select-move",
          moveId: "move-kiihakai-redirected-energy",
        },
        { id: "decline", type: "decline" },
      ],
    });
    expect(selectionPending.resolutionFrames[0]).toMatchObject({ remainingSelections: 1 });

    const completed = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          selectionPending,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:rollback-select"),
            actorId: firstCombatantId,
            expectedStateVersion: selectionPending.version,
            pendingDecisionId: selectionPending.pendingDecision!.id,
            optionId: "activate:move-kiihakai-redirected-energy",
          },
          dependencies,
        ),
      ).state,
    );

    expect(completed.combatants[firstCombatantId].ki.current).toBe(0);
    expect(completed.combatants[firstCombatantId].moveUses).toMatchObject({
      "move-kiihakai-evening-the-field": 1,
      "move-kiihakai-redirected-energy": 1,
    });
    expect(completed.activeEffects).toContainEqual(
      expect.objectContaining({
        id: "active-effect:rollback-evening",
        lifecycle: "active",
        sourceDefinitionId: "move-kiihakai-evening-the-field",
      }),
    );
    expect(completed.activeEffects).toContainEqual(
      expect.objectContaining({
        id: "active-effect:rollback-redirected",
        lifecycle: "active",
        sourceDefinitionId: "move-kiihakai-redirected-energy",
      }),
    );
    expect(completed.pendingDecision).toBeUndefined();
    expect(completed.resolutionFrames).toEqual([]);
    expect(completed.version).toBe(selectionPending.version + 1);
  });

  it("matches the opponent's active constant count with Vile Energy", () => {
    const dependencies = createTestCombatDependencies(
      [20, 1],
      new Date("2026-08-23T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:vile-energy")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 30 }, (_, index) =>
          combatEventIdSchema.parse(`event:vile-energy-${index + 1}`),
        ),
        pendingDecisionIds: Array.from({ length: 3 }, (_, index) =>
          pendingDecisionIdSchema.parse(`pending-decision:vile-energy-${index + 1}`),
        ),
        resolutionFrameIds: [resolutionFrameIdSchema.parse("resolution-frame:vile-energy")],
        activeEffectIds: [
          activeEffectIdSchema.parse("active-effect:vile-energy-generated-1"),
          activeEffectIdSchema.parse("active-effect:vile-energy-generated-2"),
        ],
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
              moveIds: [
                "move-freestyle-vile-energy",
                "move-freestyle-monkey-maneuvers",
                "move-freestyle-expert-swordplay",
              ],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: ["move-freestyle-monkey-maneuvers", "move-freestyle-expert-swordplay"],
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
          ki: { ...action.combatants[firstCombatantId].ki, current: 6 },
        },
      },
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:vile-energy-defender-monkey"),
          type: "active-constant",
          sourceCombatantId: secondCombatantId,
          targetCombatantId: secondCombatantId,
          sourceDefinitionId: "move-freestyle-monkey-maneuvers",
          activatedOnTurn: action.turnNumber,
          duration: "combat",
          paidActivationCost: 2,
          lifecycle: "active",
        },
        {
          id: activeEffectIdSchema.parse("active-effect:vile-energy-defender-expert"),
          type: "active-constant",
          sourceCombatantId: secondCombatantId,
          targetCombatantId: secondCombatantId,
          sourceDefinitionId: "move-freestyle-expert-swordplay",
          activatedOnTurn: action.turnNumber,
          duration: "combat",
          paidActivationCost: 2,
          lifecycle: "active",
        },
      ],
    };

    const pending = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          prepared,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:vile-energy-attack"),
            actorId: firstCombatantId,
            expectedStateVersion: prepared.version,
            moveId: "move-freestyle-vile-energy",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );

    expect(pending.pendingDecision).toMatchObject({
      type: "select-move",
      combatantId: firstCombatantId,
      options: [
        {
          id: "activate:move-freestyle-monkey-maneuvers",
          type: "select-move",
          moveId: "move-freestyle-monkey-maneuvers",
        },
        {
          id: "activate:move-freestyle-expert-swordplay",
          type: "select-move",
          moveId: "move-freestyle-expert-swordplay",
        },
      ],
    });
    expect(pending.resolutionFrames[0]).toMatchObject({
      operation: "activate",
      eligibleMoveIds: ["move-freestyle-monkey-maneuvers", "move-freestyle-expert-swordplay"],
      remainingSelections: 2,
    });
    expect(pending.combatants[firstCombatantId].ki.current).toBe(4);

    const firstSelection = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          pending,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:vile-energy-select-first"),
            actorId: firstCombatantId,
            expectedStateVersion: pending.version,
            pendingDecisionId: pending.pendingDecision!.id,
            optionId: "activate:move-freestyle-monkey-maneuvers",
          },
          dependencies,
        ),
      ).state,
    );

    expect(firstSelection.pendingDecision).toMatchObject({
      type: "select-move",
      options: [
        {
          id: "activate:move-freestyle-expert-swordplay",
          type: "select-move",
          moveId: "move-freestyle-expert-swordplay",
        },
      ],
    });
    expect(firstSelection.resolutionFrames[0]).toMatchObject({ remainingSelections: 1 });
    expect(firstSelection.combatants[firstCombatantId].ki.current).toBe(2);

    const completed = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          firstSelection,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:vile-energy-select-second"),
            actorId: firstCombatantId,
            expectedStateVersion: firstSelection.version,
            pendingDecisionId: firstSelection.pendingDecision!.id,
            optionId: "activate:move-freestyle-expert-swordplay",
          },
          dependencies,
        ),
      ).state,
    );

    expect(completed.combatants[firstCombatantId].ki.current).toBe(0);
    expect(completed.combatants[firstCombatantId].moveUses).toMatchObject({
      "move-freestyle-vile-energy": 1,
      "move-freestyle-expert-swordplay": 1,
      "move-freestyle-monkey-maneuvers": 1,
    });
    expect(completed.activeEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceDefinitionId: "move-freestyle-expert-swordplay",
          sourceCombatantId: firstCombatantId,
          lifecycle: "active",
        }),
        expect.objectContaining({
          sourceDefinitionId: "move-freestyle-monkey-maneuvers",
          sourceCombatantId: firstCombatantId,
          lifecycle: "active",
        }),
      ]),
    );
    expect(completed.pendingDecision).toBeUndefined();
    expect(completed.resolutionFrames).toEqual([]);
    expect(completed.version).toBe(firstSelection.version + 1);
  });

  it("charges a constant skill from its source-aware prior activation cost", () => {
    const dependencies = createTestCombatDependencies(
      [30, 1, 30, 1, 30, 1],
      new Date("2026-08-22T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:prior-activation-cost")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: [activeEffectIdSchema.parse("active-effect:shadow-stalker")],
        pendingDecisionIds: [pendingDecisionIdSchema.parse("pending-decision:shadow-stalker")],
        resolutionFrameIds: [resolutionFrameIdSchema.parse("resolution-frame:shadow-stalker")],
        eventIds: Array.from({ length: 16 }, (_, index) =>
          combatEventIdSchema.parse(`event:prior-activation-cost-${index + 1}`),
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
              moveIds: ["move-akaikaru-impulsive"],
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
          ki: { ...action.combatants[firstCombatantId].ki, current: 10 },
          moveUses: {
            ...action.combatants[firstCombatantId].moveUses,
            "move-akaikaru-impulsive": 1,
          },
        },
      },
    };

    const resumed = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          prepared,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:prior-activation-attack"),
            actorId: firstCombatantId,
            expectedStateVersion: prepared.version,
            moveId: "move-akaikaru-impulsive",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );

    expect(resumed.combatants[firstCombatantId].ki.current).toBe(6);
    expect(resumed.combatants[firstCombatantId].moveUses).toMatchObject({
      "move-akaikaru-impulsive": 2,
    });
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
              stats: { power: 100, dexterity: 1, dexterityBonus: 0 },
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
          ki: { ...action.combatants[firstCombatantId].ki, current: 10 },
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
    expect(pending.combatants[firstCombatantId].ki.current).toBe(10);

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

    expect(resumed.combatants[firstCombatantId].ki.current).toBe(1);
    expect(resumed.pendingDecision).toBeUndefined();
    expect(resumedTransition.events).toContainEqual(
      expect.objectContaining({ type: "attack-rolled", naturalResult: 34, result: 34 }),
    );

    expect(resumed.actionHistory.at(-1)).toMatchObject({
      moveId: "move-afterlife-supernova",
      damageDealt: expect.any(Number),
    });
  });

  it("resumes Sixty Second Meltdown's grouped extra actions and bounded next-action cost", () => {
    const dependencies = createStrainingDependencies([20, 1, 20, 1]);
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
              moveIds: ["move-kurokonwaku-sixty-second-meltdown", "move-akaikaru-chained-strikes"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 100, dexterity: 1, dexterityBonus: 0 },
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
          ki: { ...action.combatants[firstCombatantId].ki, current: 10 },
        },
      },
    };

    const pending = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          prepared,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:sixty-second-meltdown"),
            actorId: firstCombatantId,
            expectedStateVersion: prepared.version,
            moveId: "move-kurokonwaku-sixty-second-meltdown",
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
    expect(pending.combatants[firstCombatantId].ki.current).toBe(10);

    const selected = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          pending,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:sixty-second-meltdown-select"),
            actorId: firstCombatantId,
            expectedStateVersion: pending.version,
            pendingDecisionId: pending.pendingDecision!.id,
            optionId: "activate-effect:0,1",
          },
          dependencies,
        ),
      ).state,
    );

    expect(selected.activeEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "extra-action",
          sourceDefinitionId: "move-kurokonwaku-sixty-second-meltdown",
          remainingActions: 2,
          moveCategory: "advanced-attack",
        }),
        expect.objectContaining({
          type: "modify-next-action",
          sourceDefinitionId: "move-kurokonwaku-sixty-second-meltdown",
          scope: "next-actions",
          remaining: 2,
          modifier: {
            type: "cost",
            operation: "add",
            amount: -1,
            minimum: 1,
          },
        }),
      ]),
    );
    expect(selected.combatants[firstCombatantId].ki.current).toBe(7);
    expect(enumerateLegalDecisions(selected, firstCombatantId)).toContainEqual({
      type: "use-move",
      actorId: firstCombatantId,
      moveId: "move-akaikaru-chained-strikes",
      targetCombatantId: secondCombatantId,
    });

    const secondAttack = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          selected,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:sixty-second-meltdown-second-attack"),
            actorId: firstCombatantId,
            expectedStateVersion: selected.version,
            moveId: "move-akaikaru-chained-strikes",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );

    expect(secondAttack.combatants[firstCombatantId].ki.current).toBe(6);
    expect(secondAttack.activeEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-next-action",
          sourceDefinitionId: "move-kurokonwaku-sixty-second-meltdown",
          scope: "next-actions",
          remaining: 1,
        }),
      ]),
    );
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
                ...action.combatants[firstCombatantId],
                ki: { ...action.combatants[firstCombatantId].ki, current: 10 },
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
    expect(pendingReaction.combatants[firstCombatantId].ki.current).toBe(10);
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

    expect(resumed.combatants[firstCombatantId].ki.current).toBe(1);
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

describe("phase-aware CONSTANT Skill activation", () => {
  it("serializes Fierce Focus at start combat and applies its zero-cost override", () => {
    const dependencies = createTestCombatDependencies(
      [30, 1],
      new Date("2026-08-04T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:fierce-focus")],
        combatantIds: [firstCombatantId, secondCombatantId],
        decisionIds: [combatDecisionIdSchema.parse("decision:fierce-focus-frame")],
        eventIds: Array.from({ length: 20 }, (_, index) =>
          combatEventIdSchema.parse(`event:fierce-focus-${index + 1}`),
        ),
        pendingDecisionIds: [
          pendingDecisionIdSchema.parse("pending-decision:fierce-focus-choice"),
          pendingDecisionIdSchema.parse("pending-decision:fierce-focus-select"),
        ],
        resolutionFrameIds: [
          resolutionFrameIdSchema.parse("resolution-frame:fierce-focus-choice"),
          resolutionFrameIdSchema.parse("resolution-frame:fierce-focus-select"),
        ],
        activeEffectIds: [activeEffectIdSchema.parse("active-effect:fierce-focus")],
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
              moveIds: ["move-kiihakai-fierce-focus-mastery", "move-kiihakai-evening-the-field"],
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
    const pending = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );

    expect(pending.pendingDecision).toMatchObject({
      type: "optional-effect",
      combatantId: firstCombatantId,
      options: [
        {
          id: "activate-effect:1",
          moveId: "move-kiihakai-fierce-focus-mastery",
          effectIndices: [1],
        },
        { id: "decline", type: "decline" },
      ],
    });
    expect(pending.resolutionFrames[0]).toMatchObject({
      type: "effect-choice",
      effectTrigger: "start-combat",
      effectIndices: [1],
    });

    const selecting = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          pending,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:fierce-focus-enable"),
            actorId: firstCombatantId,
            expectedStateVersion: pending.version,
            pendingDecisionId: pending.pendingDecision!.id,
            optionId: "activate-effect:1",
          },
          dependencies,
        ),
      ).state,
    );
    expect(selecting.pendingDecision).toMatchObject({
      type: "select-move",
      combatantId: firstCombatantId,
      options: [
        {
          id: "activate:move-kiihakai-evening-the-field",
          moveId: "move-kiihakai-evening-the-field",
        },
        { id: "decline", type: "decline" },
      ],
    });

    const resumed = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          selecting,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:fierce-focus-select"),
            actorId: firstCombatantId,
            expectedStateVersion: selecting.version,
            pendingDecisionId: selecting.pendingDecision!.id,
            optionId: "activate:move-kiihakai-evening-the-field",
          },
          dependencies,
        ),
      ).state,
    );

    expect(resumed.combatants[firstCombatantId].ki.current).toBe(
      pending.combatants[firstCombatantId].ki.current,
    );
    expect(resumed.activeEffects).toContainEqual(
      expect.objectContaining({
        id: "active-effect:fierce-focus",
        sourceDefinitionId: "move-kiihakai-evening-the-field",
        paidActivationCost: 0,
        lifecycle: "active",
      }),
    );
    expect(resumed.pendingDecision).toBeUndefined();
    expect(resumed.resolutionFrames).toContainEqual(
      expect.objectContaining({
        type: "effect-choice",
        effectTrigger: "start-combat",
        resolved: true,
        selectedEffectIndices: [1],
      }),
    );
    expect(resumed.version).toBe(pending.version + 3);
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

  it("serializes Healing Ray's self-heal choice and resumes it without rerolling", () => {
    const dependencies = createTestCombatDependencies([12], new Date("2026-08-23T12:00:00.000Z"), {
      fightIds: [fightIdSchema.parse("fight:healing-ray-choice")],
      combatantIds: [firstCombatantId, secondCombatantId],
      eventIds: Array.from({ length: 40 }, (_, index) =>
        combatEventIdSchema.parse(`event:healing-ray-choice-${index + 1}`),
      ),
      pendingDecisionIds: [pendingDecisionIdSchema.parse("pending-decision:healing-ray-choice")],
      resolutionFrameIds: [resolutionFrameIdSchema.parse("resolution-frame:healing-ray-choice")],
    });
    const created = requireActiveFightState(
      requireTransition(
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
      ).state,
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created, dependencies)).state,
    );
    const prepared: ActiveFightState = {
      ...action,
      combatants: {
        ...action.combatants,
        [firstCombatantId]: {
          ...action.combatants[firstCombatantId],
          hitPoints: { ...action.combatants[firstCombatantId].hitPoints, current: 50 },
        },
      },
    };
    const pending = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          prepared,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:healing-ray-choice"),
            actorId: firstCombatantId,
            expectedStateVersion: prepared.version,
            moveId: "move-haokiru-healing-ray",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );

    expect(pending.pendingDecision).toMatchObject({
      type: "optional-effect",
      combatantId: firstCombatantId,
      options: [
        {
          id: "activate-effect:1",
          type: "activate-effect",
          moveId: "move-haokiru-healing-ray",
          effectIndices: [1],
        },
        { id: "decline", type: "decline" },
      ],
    });
    expect(pending.resolutionFrames[0]).toMatchObject({
      type: "effect-choice",
      effectTrigger: "on-roll-result",
      effectIndices: [1],
      storedRolls: [expect.objectContaining({ naturalResults: [12], sides: 30 })],
    });
    expect(pending.combatants[firstCombatantId].hitPoints.current).toBe(50);
    expect(pending.combatants[firstCombatantId].ki.current).toBe(
      prepared.combatants[firstCombatantId].ki.current,
    );

    const resumed = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          pending,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:healing-ray-activate"),
            actorId: firstCombatantId,
            expectedStateVersion: pending.version,
            pendingDecisionId: pending.pendingDecision!.id,
            optionId: "activate-effect:1",
          },
          dependencies,
        ),
      ).state,
    );

    expect(resumed.combatants[firstCombatantId].hitPoints.current).toBe(75);
    expect(resumed.combatants[firstCombatantId].ki.current).toBe(
      prepared.combatants[firstCombatantId].ki.current - 2,
    );
    expect(
      resumed.combatants[firstCombatantId].storedRolls?.["healing-ray-result"]?.naturalResults,
    ).toEqual([12]);
    expect(resumed.actionHistory.at(-1)).toMatchObject({
      type: "use-move",
      moveId: "move-haokiru-healing-ray",
    });
    expect(resumed.pendingDecision).toBeUndefined();
    expect(resumed.resolutionFrames).toHaveLength(0);
  });

  it("applies Ki Trap's prohibited HP loss to the opponent's matching natural attack roll", () => {
    const dependencies = createTestCombatDependencies(
      [7, 7, 7],
      new Date("2026-08-23T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:ki-trap-stored-match")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 40 }, (_, index) =>
          combatEventIdSchema.parse(`event:ki-trap-stored-match-${index + 1}`),
        ),
        pendingDecisionIds: [
          pendingDecisionIdSchema.parse("pending-decision:ki-trap-defense"),
          pendingDecisionIdSchema.parse("pending-decision:ki-trap-post-defense"),
        ],
        resolutionFrameIds: [
          resolutionFrameIdSchema.parse("resolution-frame:ki-trap-defense"),
          resolutionFrameIdSchema.parse("resolution-frame:ki-trap-post-defense"),
        ],
      },
    );
    const created = requireActiveFightState(
      requireTransition(
        createFight(
          {
            mode: "spar",
            combatants: [
              {
                maximumHitPoints: 200,
                stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
                moveIds: ["move-kurokonwaku-ki-trap"],
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
      ).state,
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created, dependencies)).state,
    );
    const trapped = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          action,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:ki-trap-store"),
            actorId: firstCombatantId,
            expectedStateVersion: action.version,
            moveId: "move-kurokonwaku-ki-trap",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );
    const opponentUpkeep = requireTransition(advanceFight(trapped, dependencies));
    const opponentAction = requireActiveFightState(
      requireTransition(advanceFight(opponentUpkeep.state, dependencies)).state,
    );
    const attackerBefore = opponentAction.combatants[secondCombatantId].hitPoints.current;
    const attack = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          opponentAction,
          {
            type: "basic-attack",
            id: combatDecisionIdSchema.parse("decision:ki-trap-matching-attack"),
            actorId: secondCombatantId,
            expectedStateVersion: opponentAction.version,
            basicAttack: "basic-punch",
            targetCombatantId: firstCombatantId,
          },
          dependencies,
        ),
      ).state,
    );
    const defensePending = attack.pendingDecision;
    if (defensePending === undefined) throw new Error("Expected a defense response.");
    const rolled = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          attack,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:ki-trap-defense"),
            actorId: firstCombatantId,
            expectedStateVersion: attack.version,
            pendingDecisionId: defensePending.id,
            optionId: "roll-defense",
          },
          dependencies,
        ),
      ).state,
    );
    const reactionPending = rolled.pendingDecision;
    if (reactionPending === undefined) throw new Error("Expected a Ki Trap reroll choice.");
    const resolved = requireTransition(
      submitCombatDecision(
        rolled,
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:ki-trap-decline-reroll"),
          actorId: firstCombatantId,
          expectedStateVersion: rolled.version,
          pendingDecisionId: reactionPending.id,
          optionId: "decline",
        },
        dependencies,
      ),
    );
    const attackRecord = resolved.state.actionHistory.at(-1);
    expect(attackRecord).toMatchObject({ type: "basic-attack", actorId: secondCombatantId });
    expect(resolved.state.combatants[firstCombatantId].storedRolls?.["ki-trap-roll"]).toEqual(
      expect.objectContaining({ naturalResults: [7] }),
    );
    expect(resolved.state.combatants[firstCombatantId].effectUseCounts).toMatchObject({
      "move-kurokonwaku-ki-trap:1": 1,
    });
    expect(resolved.state.combatants[firstCombatantId].hitPoints.current).toBe(198);
    expect(resolved.state.combatants[secondCombatantId].hitPoints.current).toBe(
      attackerBefore - 60,
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
    expect(
      transition.state.combatants[firstCombatantId].storedMoveSelections?.[
        "impulsive-selected-advanced-attack"
      ],
    ).toEqual({
      sourceDefinitionId: "move-akaikaru-impulsive",
      selectionKey: "impulsive-selected-advanced-attack",
      moveId: "move-akaikaru-backflip-kick",
      selectedOnTurn: 1,
    });
    expect(transition.events).toContainEqual(
      expect.objectContaining({
        type: "roll-stored",
        storageKey: "impulsive-advanced-attack-index",
        sides: 2,
      }),
    );
    expect(transition.events).toContainEqual(
      expect.objectContaining({
        type: "move-selection-updated",
        selectionKey: "impulsive-selected-advanced-attack",
        moveId: "move-akaikaru-backflip-kick",
      }),
    );
    const activated = {
      ...transition.state,
      activeEffects: [
        ...transition.state.activeEffects,
        {
          id: activeEffectIdSchema.parse("active-effect:impulsive-selection"),
          type: "active-constant" as const,
          sourceCombatantId: firstCombatantId,
          targetCombatantId: firstCombatantId,
          sourceDefinitionId: "move-akaikaru-impulsive" as const,
          activatedOnTurn: 1,
          duration: "combat" as const,
          paidActivationCost: 1,
          lifecycle: "active" as const,
        },
      ],
    };
    expect(enumerateLegalDecisions(activated, firstCombatantId)).toContainEqual(
      expect.objectContaining({ type: "use-move", moveId: "move-akaikaru-backflip-kick" }),
    );
    expect(enumerateLegalDecisions(activated, firstCombatantId)).not.toContainEqual(
      expect.objectContaining({ type: "use-move", moveId: "move-akaikaru-back-brain-kick" }),
    );
  });

  it("uses an upkeep stored roll for Solar Flare's exact immediate stun threshold", () => {
    const dependencies = createTestCombatDependencies(
      [15, 34, 24],
      new Date("2026-08-13T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:solar-flare-stored-roll")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: Array.from({ length: 3 }, (_, index) =>
          activeEffectIdSchema.parse(`active-effect:solar-flare-${index + 1}`),
        ),
        eventIds: Array.from({ length: 30 }, (_, index) =>
          combatEventIdSchema.parse(`event:solar-flare-stored-roll-${index + 1}`),
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
              moveIds: ["move-afterlife-solar-flare", "move-afterlife-kamehameha"],
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

    expect(transition.state.activeEffects).toContainEqual(
      expect.objectContaining({
        type: "floating-effect",
        sourceDefinitionId: "move-afterlife-solar-flare",
        floatingEffectId: "solar-flare-same-turn-single-die-follow-up",
        targetCombatantId: firstCombatantId,
        targetRelationCombatantId: secondCombatantId,
      }),
    );

    const attack = requireTransition(
      submitCombatDecision(
        requireActiveFightState(transition.state),
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:solar-flare-same-target"),
          actorId: firstCombatantId,
          expectedStateVersion: transition.state.version,
          moveId: "move-afterlife-kamehameha",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );

    expect(attack.events).toContainEqual(
      expect.objectContaining({
        type: "attack-rolled",
        moveId: "move-afterlife-kamehameha",
        naturalResult: 34,
      }),
    );
    expect(attack.events).toContainEqual(
      expect.objectContaining({
        type: "defense-rolled",
        naturalResult: 24,
      }),
    );
    expect(attack.state.activeEffects).not.toContainEqual(
      expect.objectContaining({
        floatingEffectId: "solar-flare-same-turn-single-die-follow-up",
      }),
    );
  });
});

describe("start-combat effect dispatch", () => {
  it("applies Control Mastery's selected cooldown status at the first action boundary", () => {
    const dependencies = createTestCombatDependencies([], new Date("2026-08-23T12:00:00.000Z"), {
      fightIds: [fightIdSchema.parse("fight:control-mastery-status")],
      combatantIds: [firstCombatantId, secondCombatantId],
      eventIds: Array.from({ length: 16 }, (_, index) =>
        combatEventIdSchema.parse(`event:control-mastery-status-${index + 1}`),
      ),
      activeEffectIds: Array.from({ length: 8 }, (_, index) =>
        activeEffectIdSchema.parse(`active-effect:control-mastery-status-${index + 1}`),
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
              moveIds: ["move-kurokonwaku-control-mastery"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: ["move-afterlife-kamehameha"],
            },
          ],
        },
        dependencies,
      ),
    );

    const transition = requireTransition(advanceFight(created.state, dependencies));
    expect(transition.state.combatants[secondCombatantId].activeStatuses).toContainEqual(
      expect.objectContaining({
        statusId: "cooldown",
        sourceCombatantId: firstCombatantId,
        sourceDefinitionId: "move-kurokonwaku-control-mastery",
        selector: expect.objectContaining({
          type: "move-selector",
          categories: ["advanced-attack", "signature"],
        }),
        duration: {
          type: "turns",
          ownerCombatantId: secondCombatantId,
          remaining: 1,
        },
      }),
    );
    expect(transition.events).toContainEqual(
      expect.objectContaining({
        type: "status-applied",
        sourceCombatantId: firstCombatantId,
        targetCombatantId: secondCombatantId,
        statusId: "cooldown",
      }),
    );
  });

  it("keeps Petrifying Spit active through the ignored check and expires it on a passing target-turn roll", () => {
    const dependencies = createTestCombatDependencies(
      [15, 15],
      new Date("2026-08-23T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:petrifying-spit-status")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 40 }, (_, index) =>
          combatEventIdSchema.parse(`event:petrifying-spit-status-${index + 1}`),
        ),
        activeEffectIds: Array.from({ length: 16 }, (_, index) =>
          activeEffectIdSchema.parse(`active-effect:petrifying-spit-status-${index + 1}`),
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
              moveIds: ["move-afterlife-petrifying-spit"],
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
    const spit = requireTransition(
      submitCombatDecision(
        action,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:petrifying-spit"),
          actorId: firstCombatantId,
          expectedStateVersion: action.version,
          moveId: "move-afterlife-petrifying-spit",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );
    expect(spit.state.combatants[secondCombatantId].activeStatuses).toContainEqual(
      expect.objectContaining({
        statusId: "petrified",
        duration: expect.objectContaining({
          type: "until-turn-start-roll-threshold",
          combatantId: secondCombatantId,
          remainingIgnoredChecks: 1,
        }),
      }),
    );

    const initialActorEnd = requireTransition(
      submitCombatDecision(
        spit.state,
        {
          type: "pass",
          id: combatDecisionIdSchema.parse("decision:petrifying-spit-initial-pass"),
          actorId: firstCombatantId,
          expectedStateVersion: spit.state.version,
        },
        dependencies,
      ),
    );
    const firstTargetBoundary = requireTransition(
      advanceFight(initialActorEnd.state, dependencies),
    );
    const firstTargetUpkeep = requireActiveFightState(
      requireTransition(advanceFight(firstTargetBoundary.state, dependencies)).state,
    );
    expect(firstTargetUpkeep.phase).toBe("end");
    expect(firstTargetUpkeep.combatants[secondCombatantId].activeStatuses).toContainEqual(
      expect.objectContaining({
        statusId: "petrified",
        duration: expect.objectContaining({ remainingIgnoredChecks: 0 }),
      }),
    );
    const actorUpkeep = requireTransition(advanceFight(firstTargetUpkeep, dependencies));
    const actorAction = requireActiveFightState(
      requireTransition(advanceFight(actorUpkeep.state, dependencies)).state,
    );
    const actorPass = requireTransition(
      submitCombatDecision(
        actorAction,
        {
          type: "pass",
          id: combatDecisionIdSchema.parse("decision:petrifying-spit-actor-pass"),
          actorId: firstCombatantId,
          expectedStateVersion: actorAction.version,
        },
        dependencies,
      ),
    );
    const secondTargetBoundary = requireTransition(advanceFight(actorPass.state, dependencies));
    const secondTargetUpkeep = requireTransition(
      advanceFight(secondTargetBoundary.state, dependencies),
    );
    expect(secondTargetUpkeep.state.combatants[secondCombatantId].activeStatuses).toEqual([]);
    expect(secondTargetUpkeep.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "status-rolled",
          statusId: "petrified",
          naturalResult: 15,
        }),
        expect.objectContaining({ type: "status-removed", statusId: "petrified" }),
      ]),
    );
  });

  it("applies representable resource changes and selector locks at the first action boundary", () => {
    const dependencies = createTestCombatDependencies([], new Date("2026-08-12T12:00:00.000Z"), {
      fightIds: [fightIdSchema.parse("fight:start-combat-effects")],
      combatantIds: [firstCombatantId, secondCombatantId],
      activeEffectIds: [
        activeEffectIdSchema.parse("active-effect:start-lock-1"),
        activeEffectIdSchema.parse("active-effect:start-lock-2"),
        activeEffectIdSchema.parse("active-effect:start-style-classification"),
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
                "move-afterlife-kamehameha",
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
    const classifiedState = {
      ...transition.state,
      activeEffects: [
        ...transition.state.activeEffects,
        {
          id: activeEffectIdSchema.parse("active-effect:start-style-classification"),
          type: "modify-move-classification" as const,
          sourceCombatantId: firstCombatantId,
          targetCombatantId: firstCombatantId,
          sourceDefinitionId: "move-freestyle-ki-color-cascade" as const,
          sourceEffectIndex: 0,
          selector: {
            type: "move-selector" as const,
            subject: "source" as const,
            ids: ["move-afterlife-kamehameha" as const],
            sourceText: "Kamehameha",
          },
          classification: { type: "replace-style" as const, style: "declared-style" as const },
          duration: { type: "combat" as const },
        },
      ],
    };
    expect(enumerateLegalDecisions(classifiedState, firstCombatantId)).not.toContainEqual(
      expect.objectContaining({ type: "use-move", moveId: "move-afterlife-kamehameha" }),
    );
    expect(transition.events).toContainEqual(
      expect.objectContaining({ type: "ki-changed", combatantId: firstCombatantId, amount: 1 }),
    );
  });

  it("persists specialization points for Dragon's Pride's conditional start resource", () => {
    const dependencies = createTestCombatDependencies([], new Date("2026-08-23T12:00:00.000Z"), {
      fightIds: [fightIdSchema.parse("fight:dragons-pride-sp")],
      combatantIds: [firstCombatantId, secondCombatantId],
      eventIds: Array.from({ length: 12 }, (_, index) =>
        combatEventIdSchema.parse(`event:dragons-pride-sp-${index + 1}`),
      ),
    });
    const created = requireActiveFightState(
      requireTransition(
        createFight(
          {
            mode: "spar",
            combatants: [
              {
                maximumHitPoints: 200,
                stats: { power: 20, dexterity: 5, dexterityBonus: 0 },
                specializationPoints: 4,
                moveIds: ["move-haokiru-dragon-s-pride"],
              },
              {
                maximumHitPoints: 200,
                stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
                specializationPoints: 4,
                moveIds: [],
              },
            ],
          },
          dependencies,
        ),
      ).state,
    );
    const prepared: ActiveFightState = {
      ...created,
      combatants: {
        ...created.combatants,
        [firstCombatantId]: {
          ...created.combatants[firstCombatantId],
          hitPoints: { ...created.combatants[firstCombatantId].hitPoints, current: 100 },
        },
      },
    };

    const started = requireTransition(advanceFight(prepared, dependencies));

    expect(started.state.combatants[firstCombatantId]).toMatchObject({
      specializationPoints: 4,
      hitPoints: { current: 120, maximum: 200 },
      ki: { current: 4 },
    });
    expect(started.events).toContainEqual(
      expect.objectContaining({ type: "ki-changed", combatantId: firstCombatantId, amount: -1 }),
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

describe("selected suppression pending choices", () => {
  it("pauses Breaking the Cycle for both exact move selections and resumes durably", () => {
    const selectedMoveId = "move-kurokonwaku-darkness-buster" as const;
    const dependencies = createTestCombatDependencies(
      [20, 1, 20, 1],
      new Date("2026-08-24T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:breaking-cycle-selection")],
        combatantIds: [firstCombatantId, secondCombatantId],
        pendingDecisionIds: Array.from({ length: 8 }, (_, index) =>
          pendingDecisionIdSchema.parse(`pending-decision:breaking-cycle-${index + 1}`),
        ),
        resolutionFrameIds: Array.from({ length: 8 }, (_, index) =>
          resolutionFrameIdSchema.parse(`resolution-frame:breaking-cycle-${index + 1}`),
        ),
        activeEffectIds: Array.from({ length: 8 }, (_, index) =>
          activeEffectIdSchema.parse(`active-effect:breaking-cycle-${index + 1}`),
        ),
        eventIds: Array.from({ length: 40 }, (_, index) =>
          combatEventIdSchema.parse(`event:breaking-cycle-${index + 1}`),
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
              stats: { power: 100, dexterity: 10, dexterityBonus: 0 },
              moveIds: ["move-kurokonwaku-breaking-the-cycle", selectedMoveId],
            },
            {
              maximumHitPoints: 500,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: [selectedMoveId],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const defensePending = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          action,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:breaking-cycle-use"),
            actorId: firstCombatantId,
            expectedStateVersion: action.version,
            moveId: "move-kurokonwaku-breaking-the-cycle",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );
    const pending = defensePending;
    expect(pending.pendingDecision).toMatchObject({ type: "optional-effect" });
    const activateOption = pending.pendingDecision!.options.find(
      (option) => option.type === "activate-effect",
    );
    expect(activateOption).toMatchObject({ effectIndices: [1, 2] });

    const selfSelection = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          pending,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:breaking-cycle-activate"),
            actorId: firstCombatantId,
            expectedStateVersion: pending.version,
            pendingDecisionId: pending.pendingDecision!.id,
            optionId: activateOption!.id,
          },
          dependencies,
        ),
      ).state,
    );
    expect(selfSelection.pendingDecision?.type).toBe("select-move");
    const selfOption = selfSelection.pendingDecision!.options.find(
      (option) => option.type === "select-move" && option.moveId === selectedMoveId,
    );
    expect(selfOption).toBeDefined();

    const opponentSelection = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          selfSelection,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:breaking-cycle-self"),
            actorId: firstCombatantId,
            expectedStateVersion: selfSelection.version,
            pendingDecisionId: selfSelection.pendingDecision!.id,
            optionId: selfOption!.id,
          },
          dependencies,
        ),
      ).state,
    );
    expect(opponentSelection.pendingDecision?.type).toBe("select-move");
    const opponentOption = opponentSelection.pendingDecision!.options.find(
      (option) => option.type === "select-move" && option.moveId === selectedMoveId,
    );
    expect(opponentOption).toBeDefined();

    const completed = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          opponentSelection,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:breaking-cycle-opponent"),
            actorId: firstCombatantId,
            expectedStateVersion: opponentSelection.version,
            pendingDecisionId: opponentSelection.pendingDecision!.id,
            optionId: opponentOption!.id,
          },
          dependencies,
        ),
      ).state,
    );
    expect(completed.pendingDecision).toBeUndefined();
    expect(completed.resolutionFrames).toEqual([]);
    expect(
      completed.activeEffects.filter(
        (effect) =>
          effect.type === "suppress" &&
          effect.sourceDefinitionId === "move-kurokonwaku-breaking-the-cycle",
      ),
    ).toEqual([
      expect.objectContaining({ targetCombatantId: firstCombatantId, selectedMoveId }),
      expect.objectContaining({ targetCombatantId: secondCombatantId, selectedMoveId }),
    ]);
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
        eventIds: Array.from({ length: 24 }, (_, index) =>
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
        activeEffectIdSchema.parse("active-effect:upkeep-comparison"),
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
          modifier: {
            type: "damage",
            amount: 2,
          },
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

  it("activates Fall 7 Times, Get Up 8 with its explicit multiplicative defense threshold", () => {
    const dependencies = createTestCombatDependencies(
      [10, 19],
      new Date("2026-08-22T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:fall-7-threshold")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: [activeEffectIdSchema.parse("active-effect:fall-7-threshold")],
        eventIds: Array.from({ length: 30 }, (_, index) =>
          combatEventIdSchema.parse(`event:fall-7-threshold-${index + 1}`),
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
              moveIds: ["move-midorikatai-fall-7-times-get-up-8", "move-midorikatai-rocket-fire"],
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
    const prepared = {
      ...action,
      phase: "upkeep" as const,
      turnNumber: action.turnNumber + 1,
      activeEffects: [],
      combatants: {
        ...action.combatants,
        [firstCombatantId]: {
          ...action.combatants[firstCombatantId],
          ki: { ...action.combatants[firstCombatantId].ki, current: 3 },
        },
      },
      actionHistory: [
        {
          type: "use-move" as const,
          decisionId: combatDecisionIdSchema.parse("decision:fall-7-prior-one"),
          actorId: firstCombatantId,
          targetCombatantId: secondCombatantId,
          moveId: "move-midorikatai-rocket-fire" as const,
          turnNumber: action.turnNumber,
          phase: "action" as const,
          outcome: "stopped" as const,
          critical: false,
          counter: false,
        },
        {
          type: "use-move" as const,
          decisionId: combatDecisionIdSchema.parse("decision:fall-7-prior-two"),
          actorId: firstCombatantId,
          targetCombatantId: secondCombatantId,
          moveId: "move-midorikatai-rocket-fire" as const,
          turnNumber: action.turnNumber,
          phase: "action" as const,
          outcome: "stopped" as const,
          critical: false,
          counter: false,
        },
      ],
    } satisfies ActiveFightState;
    const upkeep = requireActiveFightState(
      requireTransition(advanceFight(prepared, dependencies)).state,
    );
    expect(upkeep.activeEffects).toContainEqual(
      expect.objectContaining({
        type: "floating-effect",
        floatingEffectId: "fall-7-times-next-low-cost-attack",
        scope: { type: "next-action" },
        effects: expect.arrayContaining([
          expect.objectContaining({
            type: "set-resolution-threshold",
            relativeTo: "attack-roll",
            relativeOperation: "multiply",
            value: { type: "literal", value: 2 },
          }),
        ]),
      }),
    );

    const attack = requireTransition(
      submitCombatDecision(
        upkeep,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:fall-7-attack"),
          actorId: firstCombatantId,
          expectedStateVersion: upkeep.version,
          moveId: "move-midorikatai-rocket-fire",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );

    expect(attack.events).toContainEqual(
      expect.objectContaining({
        type: "attack-resolved",
        moveId: "move-midorikatai-rocket-fire",
        outcome: "stopped",
      }),
    );
    expect(attack.state.activeEffects).not.toContainEqual(
      expect.objectContaining({ floatingEffectId: "fall-7-times-next-low-cost-attack" }),
    );
  });

  it("gains the triggering attack's KI cost from Anger Manipulation at a stopped boundary", () => {
    const dependencies = createTestCombatDependencies(
      [1, 30, 1, 30, 1, 30],
      new Date("2026-08-23T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:anger-triggering-cost")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 30 }, (_, index) =>
          combatEventIdSchema.parse(`event:anger-triggering-cost-${index + 1}`),
        ),
        resolutionFrameIds: [
          resolutionFrameIdSchema.parse("resolution-frame:anger-triggering-cost-attack"),
          resolutionFrameIdSchema.parse("resolution-frame:anger-triggering-cost-defense"),
        ],
        activeEffectIds: [activeEffectIdSchema.parse("active-effect:anger-triggering-cost-lock")],
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
              moveIds: ["move-freestyle-anger-manipulation", "move-akaikaru-firestorm"],
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
          ki: { ...action.combatants[firstCombatantId].ki, current: 2 },
        },
      },
    };
    const resolved = requireTransition(
      submitCombatDecision(
        prepared,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:anger-triggering-cost-attack"),
          actorId: firstCombatantId,
          expectedStateVersion: prepared.version,
          moveId: "move-akaikaru-firestorm",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );
    const completed = requireActiveFightState(resolved.state);

    expect(completed.version).toBe(prepared.version + 1);
    expect(completed.combatants[firstCombatantId].ki.current).toBe(2);
    expect(completed.combatants[firstCombatantId].moveUses).toMatchObject({
      "move-freestyle-anger-manipulation": 1,
    });
    expect(completed.activeEffects).toContainEqual(
      expect.objectContaining({
        type: "action-lock",
        sourceDefinitionId: "move-freestyle-anger-manipulation",
        affectedType: "attack",
      }),
    );
    expect(completed.actionHistory.at(-1)).toMatchObject({
      moveId: "move-akaikaru-firestorm",
      outcome: "stopped",
    });
    expect(resolved.events).toContainEqual(
      expect.objectContaining({
        type: "ki-changed",
        combatantId: firstCombatantId,
        amount: 1,
        remainingKi: 2,
      }),
    );
  });

  it("negates a selected successful attack effect from a carried listener", () => {
    const dependencies = createTestCombatDependencies(
      [30, 1, 30, 1, 30, 1],
      new Date("2026-08-23T13:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:successful-effect-negation")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 30 }, (_, index) =>
          combatEventIdSchema.parse(`event:successful-effect-negation-${index + 1}`),
        ),
        activeEffectIds: [activeEffectIdSchema.parse("active-effect:successful-effect-negation")],
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
              moveIds: ["move-akaikaru-firestorm"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: ["move-aoyosumu-the-untroubled-mind"],
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
          id: combatDecisionIdSchema.parse("decision:successful-effect-negation-attack"),
          actorId: firstCombatantId,
          expectedStateVersion: action.version,
          moveId: "move-akaikaru-firestorm",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );
    const completed = requireActiveFightState(resolved.state);

    expect(completed.version).toBe(action.version + 1);
    expect(completed.actionHistory.at(-1)).toMatchObject({
      moveId: "move-akaikaru-firestorm",
      outcome: "successful",
    });
    expect(completed.activeEffects).not.toContainEqual(
      expect.objectContaining({ sourceDefinitionId: "move-akaikaru-firestorm" }),
    );
    expect(resolved.events).toContainEqual(
      expect.objectContaining({ type: "attack-resolved", outcome: "successful" }),
    );
  });

  it("suppresses a selected successful attack effect from a carried listener", () => {
    const dependencies = createTestCombatDependencies(
      [30, 1, 30, 1, 30, 1],
      new Date("2026-08-23T13:30:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:successful-effect-suppression")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 30 }, (_, index) =>
          combatEventIdSchema.parse(`event:successful-effect-suppression-${index + 1}`),
        ),
        activeEffectIds: [
          activeEffectIdSchema.parse("active-effect:successful-effect-suppression"),
        ],
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
              moveIds: ["move-akaikaru-firestorm"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: ["move-aoyosumu-breakout"],
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
          id: combatDecisionIdSchema.parse("decision:successful-effect-suppression-attack"),
          actorId: firstCombatantId,
          expectedStateVersion: action.version,
          moveId: "move-akaikaru-firestorm",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );
    const completed = requireActiveFightState(resolved.state);

    expect(completed.version).toBe(action.version + 1);
    expect(completed.actionHistory.at(-1)).toMatchObject({
      moveId: "move-akaikaru-firestorm",
      outcome: "successful",
    });
    expect(completed.activeEffects).not.toContainEqual(
      expect.objectContaining({ sourceDefinitionId: "move-akaikaru-firestorm" }),
    );
    expect(resolved.events).toContainEqual(
      expect.objectContaining({ type: "attack-resolved", outcome: "successful" }),
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
    firstMoveId = "move-akaikaru-firewall",
  ) => {
    const dependencies = createTestCombatDependencies(
      random,
      new Date("2026-08-13T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse(fightId)],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: Array.from({ length: 8 }, (_, index) =>
          activeEffectIdSchema.parse(`active-effect:prevention-${index + 1}`),
        ),
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
              moveIds: [firstMoveId],
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
          ...action.combatants[firstCombatantId],
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

  it("activates next-turn move protection with a persisted turn boundary", () => {
    const { action, dependencies } = createPreventionFight(
      "fight:static-shot-prevention",
      "event:static-shot-prevention",
      [20, 1],
      "move-kiihakai-static-shot",
    );
    const prepared: ActiveFightState = {
      ...action,
      combatants: {
        ...action.combatants,
        [firstCombatantId]: {
          ...action.combatants[firstCombatantId],
          ki: { ...action.combatants[firstCombatantId].ki, current: 10 },
        },
      },
    };

    const transition = requireTransition(
      submitCombatDecision(
        prepared,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:static-shot-prevention"),
          actorId: firstCombatantId,
          expectedStateVersion: prepared.version,
          moveId: "move-kiihakai-static-shot",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );

    expect(transition.state.activeEffects).toContainEqual(
      expect.objectContaining({
        type: "prevent-move-modification",
        sourceDefinitionId: "move-kiihakai-static-shot",
        targetCombatantId: secondCombatantId,
        availableFromTurn: prepared.turnNumber + 1,
        duration: { type: "turns", ownerCombatantId: secondCombatantId, remaining: 3 },
      }),
    );
    expect(transition.state.version).toBe(prepared.version + 1);
  });
});

describe("on-move-use effect dispatch", () => {
  it("offers and resolves Cancellation Master's generic non-CONSTANT Skill negation for a simple action", () => {
    const dependencies = createDeferredDependencies("cancellation-negation", [20]);
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 200,
              stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
              moveIds: ["move-kurokonwaku-ki-trap"],
            },
            {
              maximumHitPoints: 200,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: ["move-kurokonwaku-cancellation-mastery"],
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
      combatants: {
        ...action.combatants,
        [firstCombatantId]: {
          ...action.combatants[firstCombatantId],
          ki: { ...action.combatants[firstCombatantId].ki, current: 10 },
        },
        [secondCombatantId]: {
          ...action.combatants[secondCombatantId],
          ki: { ...action.combatants[secondCombatantId].ki, current: 10 },
        },
      },
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:cancellation-negation-0"),
          type: "active-constant" as const,
          sourceCombatantId: secondCombatantId,
          targetCombatantId: secondCombatantId,
          sourceDefinitionId: "move-kurokonwaku-cancellation-mastery" as const,
          activatedOnTurn: action.turnNumber,
          duration: "combat" as const,
          lifecycle: "active" as const,
        },
      ],
    } satisfies ActiveFightState;
    const pendingResult = submitCombatDecision(
      prepared,
      {
        type: "use-move",
        id: combatDecisionIdSchema.parse("decision:cancellation-negation"),
        actorId: firstCombatantId,
        expectedStateVersion: prepared.version,
        moveId: "move-kurokonwaku-ki-trap",
        targetCombatantId: secondCombatantId,
      },
      dependencies,
    );
    const pending = requireActiveFightState(requireTransition(pendingResult).state);

    expect(pending.pendingDecision).toMatchObject({
      combatantId: secondCombatantId,
      type: "optional-effect",
      options: [{ id: "activate-effect:1", effectIndices: [1] }, { id: "decline" }],
    });
    expect(pending.resolutionFrames[0]).toMatchObject({
      type: "effect-choice",
      effectTrigger: "on-move-use",
      sourceDefinitionId: "move-kurokonwaku-cancellation-mastery",
      actionMoveId: "move-kurokonwaku-ki-trap",
      sourceCombatantId: secondCombatantId,
    });

    const resolved = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          pending,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:cancellation-negation-accept"),
            actorId: secondCombatantId,
            expectedStateVersion: pending.version,
            pendingDecisionId: pending.pendingDecision!.id,
            optionId: "activate-effect:1",
          },
          dependencies,
        ),
      ).state,
    );

    expect(resolved.combatants[firstCombatantId].ki.current).toBe(8);
    expect(resolved.combatants[secondCombatantId].ki.current).toBe(9);
    expect(resolved.combatants[firstCombatantId].storedRolls).toEqual({});
    expect(resolved.combatants[secondCombatantId].hitPoints.current).toBe(200);
    expect(resolved.pendingDecision).toBeUndefined();
    expect(resolved.resolutionFrames).toEqual([]);
  });

  it("serializes Channeling Master's grouped attack choice and pays its current-HP activation cost", () => {
    const dependencies = createTestCombatDependencies(
      [20, 1],
      new Date("2026-08-22T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:on-move-use-cost-choice")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: [
          activeEffectIdSchema.parse("active-effect:channeling-generated"),
          activeEffectIdSchema.parse("active-effect:channeling-mastery"),
        ],
        pendingDecisionIds: Array.from({ length: 4 }, (_, index) =>
          pendingDecisionIdSchema.parse(`pending-decision:channeling-cost-${index}`),
        ),
        resolutionFrameIds: Array.from({ length: 8 }, (_, index) =>
          resolutionFrameIdSchema.parse(`resolution-frame:channeling-cost-${index}`),
        ),
        eventIds: Array.from({ length: 32 }, (_, index) =>
          combatEventIdSchema.parse(`event:channeling-cost-${index}`),
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
              moveIds: ["move-haokiru-channeling-mastery", "move-afterlife-spirit-bomb"],
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
          hitPoints: { ...action.combatants[firstCombatantId].hitPoints, current: 200 },
          ki: { ...action.combatants[firstCombatantId].ki, current: 10 },
        },
      },
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:channeling-mastery"),
          type: "active-constant" as const,
          sourceCombatantId: firstCombatantId,
          targetCombatantId: firstCombatantId,
          sourceDefinitionId: "move-haokiru-channeling-mastery" as const,
          activatedOnTurn: action.turnNumber,
          duration: "combat" as const,
          lifecycle: "active" as const,
        },
      ],
    } satisfies ActiveFightState;
    const pending = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          prepared,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:channeling-cost"),
            actorId: firstCombatantId,
            expectedStateVersion: prepared.version,
            moveId: "move-afterlife-spirit-bomb",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );

    expect(pending.pendingDecision).toMatchObject({
      type: "optional-effect",
      options: [{ id: "activate-effect:0,1", effectIndices: [0, 1] }, { id: "decline" }],
    });
    expect(pending.resolutionFrames[0]).toMatchObject({
      type: "attack",
      stage: "awaiting-effect-choice",
      effectTrigger: "on-move-use",
      effectSourceDefinitionId: "move-haokiru-channeling-mastery",
      effectIndices: [0, 1],
    });

    const afterChoice = requireActiveFightState(
      requireTransition(
        (() => {
          const result = submitCombatDecision(
            pending,
            {
              type: "respond-to-pending-decision",
              id: combatDecisionIdSchema.parse("decision:channeling-cost-accept"),
              actorId: firstCombatantId,
              expectedStateVersion: pending.version,
              pendingDecisionId: pending.pendingDecision!.id,
              optionId: "activate-effect:0,1",
            },
            dependencies,
          );
          if (!result.ok) throw new Error(JSON.stringify(result.error));
          return result;
        })(),
      ).state,
    );
    expect(afterChoice.combatants[firstCombatantId].hitPoints.current).toBe(190);
    expect(afterChoice.combatants[firstCombatantId].ki.current).toBe(3);
    expect(afterChoice.actionHistory.at(-1)).toMatchObject({
      type: "use-move",
      moveId: "move-afterlife-spirit-bomb",
    });
    expect(afterChoice.version).toBe(pending.version + 1);
    expect(afterChoice.pendingDecision).toBeUndefined();
    expect(afterChoice.resolutionFrames).toEqual([]);
  });

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

  it("persists Agile Medley's transformer and applies it to the next public roll modifier", () => {
    const dependencies = createTestCombatDependencies(
      [30, 1, 30, 30, 1, 30],
      new Date("2026-08-23T14:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:agile-medley-transformer")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: [
          activeEffectIdSchema.parse("active-effect:agile-medley-generated"),
          activeEffectIdSchema.parse("active-effect:agile-medley-direct-modifier"),
        ],
        eventIds: Array.from({ length: 32 }, (_, index) =>
          combatEventIdSchema.parse(`event:agile-medley-transformer-${index}`),
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
              moveIds: ["move-akaikaru-agile-medley", "move-akaikaru-dexterous-glaive"],
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
    const agile = requireTransition(
      submitCombatDecision(
        action,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:agile-medley-transformer"),
          actorId: firstCombatantId,
          expectedStateVersion: action.version,
          moveId: "move-akaikaru-agile-medley",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );
    const agileState = requireActiveFightState(agile.state);

    expect(agileState.version).toBe(action.version + 1);
    expect(agileState.activeEffects).toContainEqual(
      expect.objectContaining({
        type: "modify-roll-modifier",
        sourceDefinitionId: "move-akaikaru-agile-medley",
        sourceEffectIndex: 0,
        targetCombatantId: firstCombatantId,
        increment: 1,
        duration: "combat",
      }),
    );

    const directModifier: ActiveRollModifierEffect = {
      id: activeEffectIdSchema.parse("active-effect:agile-medley-direct-modifier"),
      type: "modify-roll",
      sourceCombatantId: firstCombatantId,
      targetCombatantId: firstCombatantId,
      sourceDefinitionId: "move-akaikaru-dexterous-glaive",
      roll: "attack",
      modifier: "result",
      amount: 2,
      duration: "combat",
    };
    const prepared = {
      ...agileState,
      phase: "action" as const,
      activeCombatantId: firstCombatantId,
      activeEffects: [...agileState.activeEffects, directModifier],
    } satisfies ActiveFightState;
    const attack = requireTransition(
      submitCombatDecision(
        prepared,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:agile-medley-follow-up"),
          actorId: firstCombatantId,
          expectedStateVersion: prepared.version,
          moveId: "move-akaikaru-dexterous-glaive",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );

    expect(attack.state.version).toBe(prepared.version + 1);
    expect(attack.events).toContainEqual(
      expect.objectContaining({ type: "attack-rolled", naturalResult: 30, result: 33 }),
    );
    expect(attack.events).toContainEqual(
      expect.objectContaining({ type: "attack-rolled", naturalResult: 1, result: 4 }),
    );
    expect(attack.state.activeEffects).toContainEqual(
      expect.objectContaining({
        type: "modify-roll-modifier",
        sourceDefinitionId: "move-akaikaru-agile-medley",
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

  it("persists Ki Jammer's generic combat-result duration and non-stacking policy", () => {
    const dependencies = createTestCombatDependencies(
      [30, 1],
      new Date("2026-08-15T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:ki-jammer-floating")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: [activeEffectIdSchema.parse("active-effect:ki-jammer")],
        eventIds: Array.from({ length: 24 }, (_, index) =>
          combatEventIdSchema.parse(`event:ki-jammer-floating-${index}`),
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
              moveIds: ["move-kiihakai-ki-jammer"],
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
    const transition = requireTransition(
      submitCombatDecision(
        action,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:ki-jammer-floating"),
          actorId: firstCombatantId,
          expectedStateVersion: action.version,
          moveId: "move-kiihakai-ki-jammer",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );

    expect(transition.state.version).toBe(action.version + 1);
    expect(transition.state.activeEffects).toContainEqual(
      expect.objectContaining({
        type: "floating-effect",
        floatingEffectId: "ki-jammer-power-up-damage-penalty",
        sourceDefinitionId: "move-kiihakai-ki-jammer",
        targetCombatantId: secondCombatantId,
        stacking: "prevent",
        duration: {
          type: "until-combat-result",
          combatantId: secondCombatantId,
          result: "successful",
          moveSelector: {
            type: "move-selector",
            subject: "target",
            attackRoll: { dice: 1 },
            sourceText: "a SUCCESSFUL single dice attack roll",
          },
          rollThreshold: {
            roll: "attack",
            comparison: "at-least",
            value: 25,
          },
        },
      }),
    );
  });

  it("expires Dragon Dust's floating bundle after the target reaches its attack-roll threshold", () => {
    const dependencies = createTestCombatDependencies(
      [30, 1, 23, 1],
      new Date("2026-08-20T13:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:dragon-dust-floating")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: [activeEffectIdSchema.parse("active-effect:dragon-dust")],
        eventIds: Array.from({ length: 30 }, (_, index) =>
          combatEventIdSchema.parse(`event:dragon-dust-floating-${index}`),
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
              moveIds: ["move-haokiru-dragon-dust"],
            },
            {
              maximumHitPoints: 200,
              stats: { power: 100, dexterity: 1, dexterityBonus: 0 },
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
    const signatureAction = { ...action, turnNumber: 10 };
    const dustTransition = submitCombatDecision(
      signatureAction,
      {
        type: "use-move",
        id: combatDecisionIdSchema.parse("decision:dragon-dust"),
        actorId: firstCombatantId,
        expectedStateVersion: signatureAction.version,
        moveId: "move-haokiru-dragon-dust",
        targetCombatantId: secondCombatantId,
      },
      dependencies,
    );
    if (!dustTransition.ok)
      throw new Error(`Dragon Dust transition failed: ${JSON.stringify(dustTransition.error)}`);
    const dust = requireActiveFightState(dustTransition.value.state);
    expect(dust.activeEffects).toContainEqual(
      expect.objectContaining({
        type: "floating-effect",
        floatingEffectId: "dragon-dust-hp-gain-retaliation",
        targetCombatantId: secondCombatantId,
        duration: {
          type: "until-roll-threshold",
          combatantId: secondCombatantId,
          roll: "attack",
          comparison: "at-least",
          value: 23,
        },
      }),
    );

    const followUp = requireTransition(
      submitCombatDecision(
        { ...dust, phase: "action", activeCombatantId: secondCombatantId },
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:dragon-dust-threshold"),
          actorId: secondCombatantId,
          expectedStateVersion: dust.version,
          basicAttack: "basic-punch",
          targetCombatantId: firstCombatantId,
        },
        dependencies,
      ),
    );
    expect(followUp.state.version).toBe(dust.version + 1);
    expect(followUp.state.activeEffects).not.toContainEqual(
      expect.objectContaining({ floatingEffectId: "dragon-dust-hp-gain-retaliation" }),
    );
  });
});

describe("generic combat-result overrides", () => {
  it("schedules a stopped next attack from a declarative on-stopped effect", () => {
    const dependencies = createTestCombatDependencies(
      [1, 30, 30, 1],
      new Date("2026-08-21T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:tranquil-strike-deferred-result")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: Array.from({ length: 4 }, (_, index) =>
          activeEffectIdSchema.parse(`active-effect:tranquil-strike-${index + 1}`),
        ),
        eventIds: Array.from({ length: 30 }, (_, index) =>
          combatEventIdSchema.parse(`event:tranquil-strike-${index + 1}`),
        ),
        resolutionFrameIds: Array.from({ length: 4 }, (_, index) =>
          resolutionFrameIdSchema.parse(`resolution-frame:tranquil-strike-${index + 1}`),
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
              moveIds: ["move-aoyosumu-tranquil-strike"],
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
          id: combatDecisionIdSchema.parse("decision:tranquil-strike"),
          actorId: firstCombatantId,
          expectedStateVersion: action.version,
          moveId: "move-aoyosumu-tranquil-strike",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );

    expect(firstAttack.events).toContainEqual(
      expect.objectContaining({ type: "attack-resolved", outcome: "stopped" }),
    );
    expect(firstAttack.state.activeEffects).toContainEqual(
      expect.objectContaining({
        type: "modify-next-action",
        sourceDefinitionId: "move-aoyosumu-tranquil-strike",
        targetCombatantId: secondCombatantId,
        scope: "next-action",
        modifier: {
          type: "combat-result",
          result: "stopped",
          resultScope: "current-attack",
        },
      }),
    );

    const secondAttackResult = submitCombatDecision(
      firstAttack.state,
      {
        type: "basic-attack",
        id: combatDecisionIdSchema.parse("decision:tranquil-strike-follow-up"),
        actorId: secondCombatantId,
        expectedStateVersion: firstAttack.state.version,
        basicAttack: "basic-punch",
        targetCombatantId: firstCombatantId,
      },
      dependencies,
    );
    if (!secondAttackResult.ok)
      throw new Error(`Second attack rejected: ${JSON.stringify(secondAttackResult.error)}`);
    const secondAttack = secondAttackResult.value;

    expect(secondAttack.events).toContainEqual(
      expect.objectContaining({ type: "attack-resolved", outcome: "stopped" }),
    );
    expect(secondAttack.events).not.toContainEqual(
      expect.objectContaining({ type: "damage-applied" }),
    );
    expect(secondAttack.state.activeEffects).toEqual([]);
    expect(secondAttack.state.version).toBe(firstAttack.state.version + 1);
  });

  it("applies a passive current-attack SUCCESSFUL result in a versioned transition", () => {
    const dependencies = createTestCombatDependencies(
      [1, 30],
      new Date("2026-08-12T13:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:back-suplex-result")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 32 }, (_, index) =>
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

  it("carries Living Voodoo's matching-die stopped result into the owner's next attack", () => {
    const dependencies = createTestCombatDependencies(
      [2, 30, 30, 1, 30, 1],
      new Date("2026-08-23T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:living-voodoo-deferred-result")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: Array.from({ length: 3 }, (_, index) =>
          activeEffectIdSchema.parse(`active-effect:living-voodoo-${index + 1}`),
        ),
        eventIds: Array.from({ length: 40 }, (_, index) =>
          combatEventIdSchema.parse(`event:living-voodoo-${index + 1}`),
        ),
        resolutionFrameIds: Array.from({ length: 4 }, (_, index) =>
          resolutionFrameIdSchema.parse(`resolution-frame:living-voodoo-${index + 1}`),
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
              moveIds: ["move-kurokonwaku-living-voodoo", "move-aoyosumu-tranquil-strike"],
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
    const stoppedAttack = requireTransition(
      submitCombatDecision(
        firstAction,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:living-voodoo-stopped"),
          actorId: firstCombatantId,
          expectedStateVersion: firstAction.version,
          moveId: "move-aoyosumu-tranquil-strike",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );

    expect(stoppedAttack.events).toContainEqual(
      expect.objectContaining({ type: "attack-resolved", outcome: "stopped" }),
    );
    expect(stoppedAttack.state.activeEffects).toContainEqual(
      expect.objectContaining({
        type: "modify-next-action",
        sourceDefinitionId: "move-kurokonwaku-living-voodoo",
        targetCombatantId: firstCombatantId,
        scope: "next-action",
        modifier: {
          type: "combat-result",
          result: "stopped",
          resultScope: "matching-die",
        },
        selector: expect.objectContaining({ restriction: "unrestricted" }),
      }),
    );
    const opponentCounter = requireTransition(
      submitCombatDecision(
        stoppedAttack.state,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:living-voodoo-opponent-counter"),
          actorId: secondCombatantId,
          expectedStateVersion: stoppedAttack.state.version,
          basicAttack: "basic-punch",
          targetCombatantId: firstCombatantId,
        },
        dependencies,
      ),
    );
    const opponentUpkeep = requireTransition(advanceFight(opponentCounter.state, dependencies));
    const opponentAction = requireTransition(advanceFight(opponentUpkeep.state, dependencies));
    const opponentPass = requireTransition(
      submitCombatDecision(
        opponentAction.state,
        {
          type: "pass",
          id: combatDecisionIdSchema.parse("decision:living-voodoo-opponent-pass"),
          actorId: secondCombatantId,
          expectedStateVersion: opponentAction.state.version,
        },
        dependencies,
      ),
    );
    const sourceUpkeep = requireTransition(advanceFight(opponentPass.state, dependencies));
    const sourceAction = requireActiveFightState(
      requireTransition(advanceFight(sourceUpkeep.state, dependencies)).state,
    );
    const followUp = requireTransition(
      submitCombatDecision(
        sourceAction,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:living-voodoo-follow-up"),
          actorId: firstCombatantId,
          expectedStateVersion: sourceAction.version,
          basicAttack: "basic-punch",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );

    expect(followUp.events).toContainEqual(
      expect.objectContaining({ type: "attack-resolved", outcome: "stopped" }),
    );
    expect(followUp.events).not.toContainEqual(expect.objectContaining({ type: "damage-applied" }));
    expect(followUp.state.activeEffects).toEqual([]);
    expect(followUp.state.version).toBe(sourceAction.version + 1);
  });
});

describe("generic critical thresholds", () => {
  it("offers and applies Cancellation Mastery's typed critical negation at the post-defense boundary", () => {
    const dependencies = createTestCombatDependencies(
      [30, 1, 30, 1],
      new Date("2026-08-20T12:30:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:cancellation-critical-negation")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 30 }, (_, index) =>
          combatEventIdSchema.parse(`event:cancellation-critical-negation-${index}`),
        ),
        pendingDecisionIds: [
          pendingDecisionIdSchema.parse("pending-decision:cancellation-defense"),
          pendingDecisionIdSchema.parse("pending-decision:cancellation-reaction"),
        ],
        resolutionFrameIds: [
          resolutionFrameIdSchema.parse("resolution-frame:cancellation-defense"),
          resolutionFrameIdSchema.parse("resolution-frame:cancellation-reaction"),
        ],
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
              moveIds: ["move-kurokonwaku-cannonball"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 4, dexterityBonus: 0 },
              moveIds: ["move-kurokonwaku-cancellation-mastery"],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const preparedAction: ActiveFightState = {
      ...action,
      combatants: {
        ...action.combatants,
        [secondCombatantId]: {
          ...action.combatants[secondCombatantId],
          ki: { current: 20, maximum: 20 },
        },
      },
    };
    const pendingDefense = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          preparedAction,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:cancellation-critical"),
            actorId: firstCombatantId,
            expectedStateVersion: preparedAction.version,
            moveId: "move-kurokonwaku-cannonball",
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
            id: combatDecisionIdSchema.parse("decision:cancellation-defense"),
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
      combatantId: secondCombatantId,
      options: [
        expect.objectContaining({ id: "decline", type: "decline" }),
        expect.objectContaining({
          id: "activate-combat-result-negation:move-kurokonwaku-cancellation-mastery:3:critical",
          type: "activate-effect",
          moveId: "move-kurokonwaku-cancellation-mastery",
          effectIndices: [3],
          combatResultNegation: {
            sourceDefinitionId: "move-kurokonwaku-cancellation-mastery",
            sourceEffectIndex: 3,
            outcome: "critical",
          },
        }),
      ],
    });
    expect(pendingReaction.combatants[secondCombatantId].ki.current).toBe(20);
    expect(pendingReaction.resolutionFrames[0]).toMatchObject({
      stage: "awaiting-post-defense-reaction",
      naturalRolls: [{ attack: 30, defense: 1 }],
    });

    const resumed = requireTransition(
      submitCombatDecision(
        pendingReaction,
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:cancellation-negate"),
          actorId: secondCombatantId,
          expectedStateVersion: pendingReaction.version,
          pendingDecisionId: pendingReaction.pendingDecision!.id,
          optionId:
            "activate-combat-result-negation:move-kurokonwaku-cancellation-mastery:3:critical",
        },
        dependencies,
      ),
    );
    const resumedState = requireActiveFightState(resumed.state);

    expect(resumedState.version).toBe(pendingReaction.version + 1);
    expect(resumedState.combatants[secondCombatantId].ki.current).toBe(17);
    expect(resumedState.actionHistory.at(-1)).toMatchObject({
      moveId: "move-kurokonwaku-cannonball",
      attackRollResult: 32,
      critical: false,
    });
    expect(resumed.events).toContainEqual(
      expect.objectContaining({
        type: "attack-resolved",
        moveId: "move-kurokonwaku-cannonball",
        critical: false,
      }),
    );
    expect(resumedState.pendingDecision).toBeUndefined();
    expect(resumedState.resolutionFrames).toEqual([]);
  });

  it("offers and applies Cancellation Mastery's typed stun negation at the post-defense boundary", () => {
    const dependencies = createTestCombatDependencies(
      [22, 1, 22, 1],
      new Date("2026-08-22T12:30:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:cancellation-stun-negation")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 30 }, (_, index) =>
          combatEventIdSchema.parse(`event:cancellation-stun-negation-${index}`),
        ),
        pendingDecisionIds: [
          pendingDecisionIdSchema.parse("pending-decision:cancellation-stun-defense"),
          pendingDecisionIdSchema.parse("pending-decision:cancellation-stun-reaction"),
        ],
        resolutionFrameIds: [
          resolutionFrameIdSchema.parse("resolution-frame:cancellation-stun-defense"),
          resolutionFrameIdSchema.parse("resolution-frame:cancellation-stun-reaction"),
        ],
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
              moveIds: ["move-akaikaru-hypersonic-knockout"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 4, dexterityBonus: 0 },
              moveIds: ["move-kurokonwaku-cancellation-mastery"],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const preparedAction: ActiveFightState = {
      ...action,
      combatants: {
        ...action.combatants,
        [firstCombatantId]: {
          ...action.combatants[firstCombatantId],
          ki: { current: 20, maximum: 20 },
        },
        [secondCombatantId]: {
          ...action.combatants[secondCombatantId],
          ki: { current: 20, maximum: 20 },
        },
      },
    };
    const pendingDefenseTransition = submitCombatDecision(
      preparedAction,
      {
        type: "use-move",
        id: combatDecisionIdSchema.parse("decision:cancellation-stun-attack"),
        actorId: firstCombatantId,
        expectedStateVersion: preparedAction.version,
        moveId: "move-akaikaru-hypersonic-knockout",
        targetCombatantId: secondCombatantId,
      },
      dependencies,
    );
    const pendingDefense = requireActiveFightState(
      requireTransition(pendingDefenseTransition).state,
    );
    const pendingReaction = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          pendingDefense,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:cancellation-stun-defense"),
            actorId: secondCombatantId,
            expectedStateVersion: pendingDefense.version,
            pendingDecisionId: pendingDefense.pendingDecision!.id,
            optionId: "roll-defense",
          },
          dependencies,
        ),
      ).state,
    );
    expect(pendingReaction.pendingDecision?.options).toContainEqual(
      expect.objectContaining({
        id: "activate-combat-result-negation:move-kurokonwaku-cancellation-mastery:2:stun",
        type: "activate-effect",
        effectIndices: [2],
        combatResultNegation: {
          sourceDefinitionId: "move-kurokonwaku-cancellation-mastery",
          sourceEffectIndex: 2,
          outcome: "stun",
        },
      }),
    );

    const resumed = requireTransition(
      submitCombatDecision(
        pendingReaction,
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:cancellation-stun-negate"),
          actorId: secondCombatantId,
          expectedStateVersion: pendingReaction.version,
          pendingDecisionId: pendingReaction.pendingDecision!.id,
          optionId: "activate-combat-result-negation:move-kurokonwaku-cancellation-mastery:2:stun",
        },
        dependencies,
      ),
    );
    const resumedState = requireActiveFightState(resumed.state);

    expect(resumedState.version).toBe(pendingReaction.version + 1);
    expect(resumedState.combatants[secondCombatantId].ki.current).toBe(15);
    expect(resumedState.combatants[secondCombatantId].activeStatuses).not.toContainEqual(
      expect.objectContaining({ statusId: "stun" }),
    );
    expect(resumedState.actionHistory.at(-1)).toMatchObject({
      moveId: "move-akaikaru-hypersonic-knockout",
      attackRollResult: 24,
      critical: false,
    });
    expect(resumed.events).toContainEqual(
      expect.objectContaining({
        type: "ki-changed",
        combatantId: secondCombatantId,
        amount: -5,
      }),
    );
    expect(resumedState.pendingDecision).toBeUndefined();
    expect(resumedState.resolutionFrames).toEqual([]);
  });

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

describe("generic counter-action transitions", () => {
  it("offers Counterstrike Mastery's exact choose-attack variant through post-defense state", () => {
    const dependencies = createTestCombatDependencies(
      [30, 1, 30, 1],
      new Date("2026-08-23T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:counterstrike")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 80 }, (_, index) =>
          combatEventIdSchema.parse(`event:counterstrike-${index + 1}`),
        ),
        pendingDecisionIds: Array.from({ length: 8 }, (_, index) =>
          pendingDecisionIdSchema.parse(`pending-decision:counterstrike-${index + 1}`),
        ),
        resolutionFrameIds: Array.from({ length: 8 }, (_, index) =>
          resolutionFrameIdSchema.parse(`resolution-frame:counterstrike-${index + 1}`),
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
              moveIds: ["move-aoyosumu-bullwhip"],
            },
            {
              maximumHitPoints: 200,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: ["move-aoyosumu-counterstrike-mastery"],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const defensePending = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          action,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:counterstrike-attack"),
            actorId: firstCombatantId,
            expectedStateVersion: action.version,
            moveId: "move-aoyosumu-bullwhip",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );
    const reactionPending = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          defensePending,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:counterstrike-defense"),
            actorId: secondCombatantId,
            expectedStateVersion: defensePending.version,
            pendingDecisionId: defensePending.pendingDecision!.id,
            optionId: "roll-defense",
          },
          dependencies,
        ),
      ).state,
    );
    expect(reactionPending.pendingDecision?.type).toBe("post-defense-roll");
    const counterOption = reactionPending.pendingDecision?.options.find((option) =>
      option.id.startsWith("activate-counter-action:"),
    );
    expect(counterOption).toMatchObject({
      moveId: "move-aoyosumu-counterstrike-mastery",
      counterAction: {
        action: "choose-attack",
        sourceDefinitionId: "move-aoyosumu-counterstrike-mastery",
        sourceEffectIndex: 0,
      },
    });

    const counterReady = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          reactionPending,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:counterstrike-select"),
            actorId: secondCombatantId,
            expectedStateVersion: reactionPending.version,
            pendingDecisionId: reactionPending.pendingDecision!.id,
            optionId: counterOption!.id,
          },
          dependencies,
        ),
      ).state,
    );
    expect(counterReady.phase).toBe("counter");
    expect(counterReady.activeCombatantId).toBe(secondCombatantId);
    expect(counterReady.combatants[secondCombatantId].ki.current).toBe(
      defensePending.combatants[secondCombatantId].ki.current - 1,
    );
    expect(counterReady.combatants[secondCombatantId].effectUseCounts).toMatchObject({
      "move-aoyosumu-counterstrike-mastery:0": 1,
    });
    expect(counterReady.resolutionFrames[0]).toMatchObject({
      stage: "awaiting-counter",
      counterAction: { action: "choose-attack" },
    });
    expect(enumerateLegalDecisions(counterReady, secondCombatantId)).toContainEqual(
      expect.objectContaining({
        type: "basic-attack",
        actorId: secondCombatantId,
        targetCombatantId: firstCombatantId,
      }),
    );
  });

  it("resumes Reversal of Fortune from a serialized prior attack snapshot", () => {
    const dependencies = createTestCombatDependencies(
      [30, 1, 30, 1, 30, 1],
      new Date("2026-08-23T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:reversal")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 120 }, (_, index) =>
          combatEventIdSchema.parse(`event:reversal-${index + 1}`),
        ),
        activeEffectIds: Array.from({ length: 30 }, (_, index) =>
          activeEffectIdSchema.parse(`active-effect:reversal-${index + 1}`),
        ),
        resolutionFrameIds: Array.from({ length: 8 }, (_, index) =>
          resolutionFrameIdSchema.parse(`resolution-frame:reversal-${index + 1}`),
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
              stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
              moveIds: ["move-aoyosumu-bullwhip"],
            },
            {
              maximumHitPoints: 500,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
              moveIds: ["move-aoyosumu-reversal-of-fortune"],
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
            id: combatDecisionIdSchema.parse("decision:reversal-first-attack"),
            actorId: firstCombatantId,
            expectedStateVersion: firstAction.version,
            moveId: "move-aoyosumu-bullwhip",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );
    const secondUpkeep = requireTransition(advanceFight(firstAttack, dependencies));
    const secondAction = requireActiveFightState(
      requireTransition(advanceFight(secondUpkeep.state, dependencies)).state,
    );
    const secondPassed = requireTransition(
      submitCombatDecision(
        secondAction,
        {
          type: "pass",
          id: combatDecisionIdSchema.parse("decision:reversal-pass"),
          actorId: secondCombatantId,
          expectedStateVersion: secondAction.version,
        },
        dependencies,
      ),
    );
    const firstUpkeep = requireTransition(advanceFight(secondPassed.state, dependencies));
    const repeatedAction = requireActiveFightState(
      requireTransition(advanceFight(firstUpkeep.state, dependencies)).state,
    );
    const counterReady = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          repeatedAction,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:reversal-second-attack"),
            actorId: firstCombatantId,
            expectedStateVersion: repeatedAction.version,
            moveId: "move-aoyosumu-bullwhip",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );
    expect(counterReady.phase).toBe("counter");
    expect(counterReady.activeCombatantId).toBe(secondCombatantId);
    expect(counterReady.resolutionFrames[0]).toMatchObject({
      stage: "awaiting-counter",
      counterAction: {
        action: "repeat-triggering-attack",
        sourceDefinitionId: "move-aoyosumu-reversal-of-fortune",
        sourceAction: { moveId: "move-aoyosumu-bullwhip" },
        sourceMoveSnapshot: { id: "move-aoyosumu-bullwhip" },
      },
    });
    expect(counterReady.combatants[secondCombatantId].effectUseCounts).toMatchObject({
      "move-aoyosumu-reversal-of-fortune:0": 1,
    });
    const counterDecision = enumerateLegalDecisions(counterReady, secondCombatantId).find(
      (decision) => decision.type === "use-move" && decision.moveId === "move-aoyosumu-bullwhip",
    );
    expect(counterDecision).toBeDefined();
    const resumed = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          counterReady,
          {
            ...counterDecision!,
            id: combatDecisionIdSchema.parse("decision:reversal-counter"),
            expectedStateVersion: counterReady.version,
          },
          dependencies,
        ),
      ).state,
    );
    expect(resumed.actionHistory.at(-1)).toMatchObject({
      type: "use-move",
      moveId: "move-aoyosumu-reversal-of-fortune",
    });
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

  it("negates serialized attack-prevention effects through the public action transition", () => {
    const dependencies = createTestCombatDependencies([], new Date("2026-08-04T12:00:00.000Z"), {
      fightIds: [fightIdSchema.parse("fight:give-me-energy-negation")],
      combatantIds: [firstCombatantId, secondCombatantId],
      eventIds: Array.from({ length: 30 }, (_, index) =>
        combatEventIdSchema.parse(`event:give-me-energy-negation-${index}`),
      ),
      activeEffectIds: [
        activeEffectIdSchema.parse("active-effect:attack-lock-to-negate"),
        activeEffectIdSchema.parse("active-effect:attack-restriction-to-negate"),
      ],
    });
    const created = requireTransition(createFight(input, dependencies));
    const actionState: ActiveFightState = {
      ...requireActiveFightState(created.state),
      phase: "action",
      activeCombatantId: secondCombatantId,
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:attack-lock-to-negate"),
          type: "action-lock",
          sourceCombatantId: firstCombatantId,
          targetCombatantId: firstCombatantId,
          sourceDefinitionId: "move-afterlife-dodon-ray",
          affectedType: "attack",
          duration: { type: "combat" },
        },
        {
          id: activeEffectIdSchema.parse("active-effect:attack-restriction-to-negate"),
          type: "action-restriction",
          sourceCombatantId: firstCombatantId,
          targetCombatantId: firstCombatantId,
          sourceDefinitionId: "move-afterlife-dodon-ray",
          sourceEffectIndex: 0,
          availableFromTurn: 1,
          remainingTurns: 1,
        },
      ],
    };
    expect(enumerateLegalDecisions(actionState, secondCombatantId)).toContainEqual(
      expect.objectContaining({
        type: "use-move",
        moveId: "move-afterlife-give-me-energy",
      }),
    );

    const transition = requireTransition(
      submitCombatDecision(
        actionState,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:give-me-energy-negation"),
          actorId: secondCombatantId,
          expectedStateVersion: actionState.version,
          moveId: "move-afterlife-give-me-energy",
          targetCombatantId: firstCombatantId,
        },
        dependencies,
      ),
    );

    expect(transition.state.version).toBe(actionState.version + 1);
    expect(transition.state.activeEffects).not.toContainEqual(
      expect.objectContaining({ id: "active-effect:attack-lock-to-negate" }),
    );
    expect(transition.state.activeEffects).not.toContainEqual(
      expect.objectContaining({ id: "active-effect:attack-restriction-to-negate" }),
    );
    expect(transition.events).toContainEqual(
      expect.objectContaining({
        type: "effect-negated",
        activeEffectId: "active-effect:attack-lock-to-negate",
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

  it("activates War Cry from upkeep, prevents stacking, and enforces its combat limit", () => {
    const dependencies = createTestCombatDependencies([], new Date("2026-08-21T12:00:00.000Z"), {
      fightIds: [fightIdSchema.parse("fight:war-cry")],
      combatantIds: [firstCombatantId, secondCombatantId],
      activeEffectIds: [
        activeEffectIdSchema.parse("active-effect:war-cry-1"),
        activeEffectIdSchema.parse("active-effect:war-cry-2"),
      ],
      eventIds: Array.from({ length: 24 }, (_, index) =>
        combatEventIdSchema.parse(`event:war-cry-${index + 1}`),
      ),
    });
    const created = requireTransition(
      createFight(
        {
          mode: "spar",
          combatants: [
            {
              maximumHitPoints: 100,
              stats: { power: 20, dexterity: 2, dexterityBonus: 0 },
              moveIds: ["move-midorikatai-war-cry"],
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

    const first = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    expect(first.activeEffects).toEqual([
      expect.objectContaining({
        type: "modify-next-action",
        sourceDefinitionId: "move-midorikatai-war-cry",
        sourceEffectIndex: 0,
        stacking: "prevent",
        modifier: { type: "damage", amount: 3 },
      }),
    ]);
    expect(first.combatants[firstCombatantId].moveUses["move-midorikatai-war-cry"]).toBe(1);

    const stacked = requireActiveFightState(
      requireTransition(
        advanceFight(
          {
            ...first,
            phase: "upkeep",
            turnNumber: first.turnNumber + 1,
            activeEffects: [],
          },
          dependencies,
        ),
      ).state,
    );
    expect(stacked.activeEffects).toEqual([
      expect.objectContaining({ sourceDefinitionId: "move-midorikatai-war-cry" }),
    ]);
    expect(stacked.combatants[firstCombatantId].moveUses["move-midorikatai-war-cry"]).toBe(2);

    const exhausted = requireActiveFightState(
      requireTransition(
        advanceFight(
          {
            ...stacked,
            phase: "upkeep",
            turnNumber: stacked.turnNumber + 1,
            activeEffects: [],
          },
          dependencies,
        ),
      ).state,
    );
    expect(exhausted.activeEffects).toEqual([]);
    expect(exhausted.combatants[firstCombatantId].moveUses["move-midorikatai-war-cry"]).toBe(2);
  });

  it("applies and consumes Psycho Driver's deferred damage-based HP loss", () => {
    const dependencies = createTestCombatDependencies(
      [28, 1, 28, 1],
      new Date("2026-08-20T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:psycho-driver")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: ["active-effect:psycho-driver" as never],
        eventIds: Array.from({ length: 20 }, (_, index) =>
          combatEventIdSchema.parse(`event:psycho-driver-${index}`),
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
              moveIds: ["move-kurokonwaku-psycho-driver"],
            },
            {
              maximumHitPoints: 100,
              stats: { power: 100, dexterity: 1, dexterityBonus: 0 },
              moveIds: [],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = requireTransition(advanceFight(created.state, dependencies));
    const psycho = requireTransition(
      submitCombatDecision(
        action.state,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:psycho-driver"),
          actorId: firstCombatantId,
          expectedStateVersion: 1,
          moveId: "move-kurokonwaku-psycho-driver",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );
    const psychoState = requireActiveFightState(psycho.state);
    expect(psychoState.activeEffects).toEqual([
      expect.objectContaining({
        type: "modify-next-action",
        targetCombatantId: secondCombatantId,
        scope: "next-action",
        modifier: {
          type: "resource",
          resource: "hp",
          operation: "lose",
          amount: 20,
          basis: "damage-percent",
        },
      }),
    ]);

    const attack = requireTransition(
      submitCombatDecision(
        {
          ...psychoState,
          phase: "action",
          activeCombatantId: secondCombatantId,
        },
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:psycho-follow-up"),
          actorId: secondCombatantId,
          expectedStateVersion: psychoState.version,
          basicAttack: "basic-punch",
          targetCombatantId: firstCombatantId,
        },
        dependencies,
      ),
    );
    expect(attack.events).toContainEqual(
      expect.objectContaining({
        type: "hp-changed",
        sourceCombatantId: firstCombatantId,
        targetCombatantId: secondCombatantId,
        amount: -2,
        remainingHitPoints: 93,
      }),
    );
    expect(attack.state.combatants[secondCombatantId].hitPoints.current).toBe(93);
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

  it("preserves damage-percent semantics for a deferred opponent damage modifier", () => {
    const dependencies = createTestCombatDependencies(
      [28, 1, 28, 1],
      new Date("2026-08-14T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:deferred-damage-percent")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: [activeEffectIdSchema.parse("active-effect:deferred-damage-percent")],
        eventIds: Array.from({ length: 24 }, (_, index) =>
          combatEventIdSchema.parse(`event:deferred-damage-percent-${index}`),
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
              level: 1,
              stats: { power: 20, dexterity: 2, dexterityBonus: 0 },
              moveIds: ["move-freestyle-underdog-dropkick"],
            },
            {
              maximumHitPoints: 100,
              level: 3,
              stats: { power: 100, dexterity: 1, dexterityBonus: 0 },
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
          id: combatDecisionIdSchema.parse("decision:deferred-damage-percent"),
          actorId: firstCombatantId,
          expectedStateVersion: action.version,
          moveId: "move-freestyle-underdog-dropkick",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );

    expect(firstAttack.state.activeEffects).toEqual([
      expect.objectContaining({
        type: "modify-next-action",
        targetCombatantId: secondCombatantId,
        modifier: { type: "damage", amount: -10, basis: "damage-percent" },
      }),
    ]);

    const opponentUpkeep = requireActiveFightState(
      requireTransition(advanceFight(firstAttack.state, dependencies)).state,
    );
    const opponentAction = requireActiveFightState(
      requireTransition(advanceFight(opponentUpkeep, dependencies)).state,
    );
    const secondAttackResult = submitCombatDecision(
      opponentAction,
      {
        type: "basic-attack",
        id: combatDecisionIdSchema.parse("decision:deferred-damage-percent-follow-up"),
        actorId: secondCombatantId,
        expectedStateVersion: opponentAction.version,
        basicAttack: "basic-punch",
        targetCombatantId: firstCombatantId,
      },
      dependencies,
    );
    if (!secondAttackResult.ok)
      throw new Error(`Second attack rejected: ${JSON.stringify(secondAttackResult.error)}`);
    const secondAttack = secondAttackResult.value;

    expect(secondAttack.events).toContainEqual(
      expect.objectContaining({ type: "damage-applied", amount: 9, remainingHitPoints: 91 }),
    );
    expect(secondAttack.state.version).toBe(opponentAction.version + 1);
    expect(secondAttack.state.activeEffects).toEqual([]);
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
        modifier: { type: "damage", amount: -50, basis: "damage-percent" },
      }),
    );
  });

  it("serializes Creationist's cost-modified choice before defense and applies it once", () => {
    const dependencies = createTestCombatDependencies(
      [28, 1],
      new Date("2026-08-22T13:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:creationist-cost-choice")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: [activeEffectIdSchema.parse("active-effect:creationist-damage")],
        pendingDecisionIds: [
          pendingDecisionIdSchema.parse("pending-decision:creationist-cost"),
          pendingDecisionIdSchema.parse("pending-decision:creationist-defense"),
        ],
        resolutionFrameIds: [
          resolutionFrameIdSchema.parse("resolution-frame:creationist-cost"),
          resolutionFrameIdSchema.parse("resolution-frame:creationist-defense"),
        ],
        eventIds: Array.from({ length: 16 }, (_, index) =>
          combatEventIdSchema.parse(`event:creationist-cost-${index}`),
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
              moveIds: ["move-haokiru-creationist", "move-haokiru-focused-spirit-cutter"],
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
    const actionState: ActiveFightState = {
      ...action,
      turnNumber: 10,
      combatants: {
        ...action.combatants,
        [firstCombatantId]: {
          ...action.combatants[firstCombatantId],
          hitPoints: { current: 50, maximum: 100 },
          moveIds: ["move-haokiru-creationist", "move-haokiru-focused-spirit-cutter"],
        },
        [secondCombatantId]: {
          ...action.combatants[secondCombatantId],
          moveIds: ["move-akaikaru-backflip"],
        },
      },
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:creationist"),
          type: "active-constant",
          sourceCombatantId: firstCombatantId,
          targetCombatantId: firstCombatantId,
          sourceDefinitionId: "move-haokiru-creationist",
          activatedOnTurn: action.turnNumber,
          duration: "combat",
          lifecycle: "active",
        },
      ],
    } satisfies ActiveFightState;
    const pending = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          actionState,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:creationist-cost"),
            actorId: firstCombatantId,
            expectedStateVersion: actionState.version,
            moveId: "move-haokiru-focused-spirit-cutter",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );

    expect(pending.pendingDecision).toMatchObject({
      type: "optional-effect",
      options: [
        { id: "activate-effect:0", effectIndices: [0] },
        { id: "activate-effect:1", effectIndices: [1] },
        { id: "decline" },
      ],
    });
    expect(pending.resolutionFrames[0]).toMatchObject({
      stage: "awaiting-effect-choice",
      effectTrigger: "on-cost-modified",
      effectSourceDefinitionId: "move-haokiru-creationist",
      effectIndices: [0],
    });

    const afterChoice = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          pending,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:creationist-cost-accept"),
            actorId: firstCombatantId,
            expectedStateVersion: pending.version,
            pendingDecisionId: pending.pendingDecision!.id,
            optionId: "activate-effect:1",
          },
          dependencies,
        ),
      ).state,
    );

    expect(afterChoice.pendingDecision?.type).toBe("defense-response");
    expect(afterChoice.resolutionFrames[0]).toMatchObject({
      stage: "awaiting-defense",
      costEffectTrigger: "on-cost-modified",
      costEffectSourceDefinitionId: "move-haokiru-creationist",
      costEffectIndices: [1],
    });
    const completed = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          afterChoice,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:creationist-cost-defense"),
            actorId: secondCombatantId,
            expectedStateVersion: afterChoice.version,
            pendingDecisionId: afterChoice.pendingDecision!.id,
            optionId: "roll-defense",
          },
          dependencies,
        ),
      ).state,
    );

    expect(completed.combatants[firstCombatantId].ki.current).toBe(4);
    expect(completed.version).toBe(afterChoice.version + 1);
    expect(completed.resolutionFrames).toEqual([]);
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

  it("charges an on-power-up resource effect through the public transition", () => {
    const dependencies = createTestCombatDependencies(
      [20, 19],
      new Date("2026-08-10T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:reserves")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 10 }, (_, index) =>
          combatEventIdSchema.parse(`event:reserves-${index}`),
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
              moveIds: ["move-haokiru-reserves"],
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
    const damagedAction: ActiveFightState = {
      ...action,
      combatants: {
        ...action.combatants,
        [firstCombatantId]: {
          ...action.combatants[firstCombatantId],
          hitPoints: { ...action.combatants[firstCombatantId].hitPoints, current: 50 },
        },
      },
    };

    expect(enumerateLegalDecisions(damagedAction, firstCombatantId)).toContainEqual({
      type: "power-up",
      actorId: firstCombatantId,
    });
    const transition = requireTransition(
      submitCombatDecision(
        damagedAction,
        {
          type: "power-up",
          id: combatDecisionIdSchema.parse("decision:reserves"),
          actorId: firstCombatantId,
          expectedStateVersion: damagedAction.version,
        },
        dependencies,
      ),
    );

    expect(transition.state.version).toBe(damagedAction.version + 1);
    expect(transition.state.combatants[firstCombatantId].hitPoints.current).toBe(55);
    expect(transition.state.combatants[firstCombatantId].ki.current).toBe(7);
    expect(transition.events).toContainEqual(
      expect.objectContaining({ type: "ki-changed", amount: 2, remainingKi: 7 }),
    );
  });

  it("charges a typed floating-effect activation cost through the public upkeep transition", () => {
    const dependencies = createTestCombatDependencies(
      [20, 19],
      new Date("2026-08-10T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:hidden-power-level")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: [activeEffectIdSchema.parse("active-effect:hidden-power-level")],
        eventIds: Array.from({ length: 10 }, (_, index) =>
          combatEventIdSchema.parse(`event:hidden-power-level-${index}`),
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
                moveIds: ["move-freestyle-hidden-power-level"],
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
    const ready = {
      ...created,
      combatants: {
        ...created.combatants,
        [firstCombatantId]: {
          ...created.combatants[firstCombatantId],
          ki: { ...created.combatants[firstCombatantId].ki, current: 8 },
        },
      },
    } satisfies ActiveFightState;

    const transition = requireTransition(advanceFight(ready, dependencies));
    const action = requireActiveFightState(transition.state);
    expect(action.version).toBe(ready.version + 1);
    expect(action.combatants[firstCombatantId].ki.current).toBe(6);
    expect(action.activeEffects).toContainEqual(
      expect.objectContaining({
        type: "floating-effect",
        sourceEffectIndex: 0,
        sourceDefinitionId: "move-freestyle-hidden-power-level",
        floatingEffectId: "hidden-power-level-zero-ki-recovery",
      }),
    );
    expect(transition.events).toContainEqual(
      expect.objectContaining({ type: "ki-changed", amount: -2, remainingKi: 6 }),
    );
  });

  it("omits a costed floating effect when the public upkeep transition cannot afford it", () => {
    const dependencies = createTestCombatDependencies(
      [20, 19],
      new Date("2026-08-10T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:hidden-power-level-unaffordable")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: [
          activeEffectIdSchema.parse("active-effect:hidden-power-level-unaffordable"),
        ],
        eventIds: Array.from({ length: 10 }, (_, index) =>
          combatEventIdSchema.parse(`event:hidden-power-level-unaffordable-${index}`),
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
                moveIds: ["move-freestyle-hidden-power-level"],
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
    const ready = {
      ...created,
      combatants: {
        ...created.combatants,
        [firstCombatantId]: {
          ...created.combatants[firstCombatantId],
          ki: { ...created.combatants[firstCombatantId].ki, current: 1 },
        },
      },
    } satisfies ActiveFightState;

    const transition = requireTransition(advanceFight(ready, dependencies));
    const action = requireActiveFightState(transition.state);
    expect(action.version).toBe(ready.version + 1);
    expect(action.combatants[firstCombatantId].ki.current).toBe(1);
    expect(action.activeEffects).not.toContainEqual(
      expect.objectContaining({
        type: "floating-effect",
        sourceDefinitionId: "move-freestyle-hidden-power-level",
        floatingEffectId: "hidden-power-level-zero-ki-recovery",
      }),
    );
    expect(transition.events).not.toContainEqual(expect.objectContaining({ type: "ki-changed" }));
  });

  it("serializes Not Over Till It's Over before applying its upkeep floating effect", () => {
    const dependencies = createTestCombatDependencies(
      [20, 19],
      new Date("2026-08-24T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:not-over-upkeep-choice")],
        combatantIds: [firstCombatantId, secondCombatantId],
        decisionIds: [
          combatDecisionIdSchema.parse("decision:not-over-frame"),
          combatDecisionIdSchema.parse("decision:not-over-activate"),
        ],
        pendingDecisionIds: [pendingDecisionIdSchema.parse("pending-decision:not-over")],
        resolutionFrameIds: [resolutionFrameIdSchema.parse("resolution-frame:not-over")],
        eventIds: Array.from({ length: 8 }, (_, index) =>
          combatEventIdSchema.parse(`event:not-over-${index}`),
        ),
        activeEffectIds: [activeEffectIdSchema.parse("active-effect:not-over")],
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
                moveIds: ["move-midorikatai-not-over-till-it-s-over"],
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

    const upkeep = requireActiveFightState(
      requireTransition(advanceFight(created, dependencies)).state,
    );
    expect(upkeep.phase).toBe("upkeep");
    expect(upkeep.pendingDecision).toMatchObject({
      type: "optional-effect",
      combatantId: firstCombatantId,
      options: expect.arrayContaining([{ id: "decline", type: "decline" }]),
    });
    const pending = upkeep.pendingDecision;
    if (pending === undefined) throw new Error("Expected Not Over upkeep choice.");
    const activate = pending.options.find((option) => option.type === "activate-effect");
    if (activate === undefined) throw new Error("Expected Not Over activation option.");
    const activated = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          upkeep,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:not-over-activate"),
            actorId: firstCombatantId,
            expectedStateVersion: upkeep.version,
            pendingDecisionId: pending.id,
            optionId: activate.id,
          },
          dependencies,
        ),
      ).state,
    );
    expect(activated.pendingDecision).toBeUndefined();
    expect(activated.combatants[firstCombatantId].ki.current).toBe(
      upkeep.combatants[firstCombatantId].ki.current - 1,
    );
    expect(activated.activeEffects).toContainEqual(
      expect.objectContaining({
        type: "floating-effect",
        sourceDefinitionId: "move-midorikatai-not-over-till-it-s-over",
        floatingEffectId: "not-over-next-unrestricted-advanced-attack",
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

  it("schedules Energy Slasher's next-turn KI gain after a stopped physical attack", () => {
    const dependencies = createTestCombatDependencies(
      [20, 19],
      new Date("2026-08-10T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:energy-slasher")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: [activeEffectIdSchema.parse("active-effect:energy-slasher")],
        eventIds: Array.from({ length: 16 }, (_, index) =>
          combatEventIdSchema.parse(`event:energy-slasher-${index}`),
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
              moveIds: ["move-kiihakai-energy-slasher"],
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
    const ready: ActiveFightState = {
      ...action,
      actionHistory: [
        ...action.actionHistory,
        {
          type: "use-move",
          decisionId: combatDecisionIdSchema.parse("decision:energy-slasher-source"),
          actorId: secondCombatantId,
          targetCombatantId: firstCombatantId,
          moveId: "move-aoyosumu-one-arm-shoulder-throw",
          outcome: "stopped",
          turnNumber: action.turnNumber,
          phase: "action",
        },
      ],
    };
    const powered = requireTransition(
      submitCombatDecision(
        ready,
        {
          type: "power-up",
          id: combatDecisionIdSchema.parse("decision:energy-slasher-power-up"),
          actorId: firstCombatantId,
          expectedStateVersion: ready.version,
        },
        dependencies,
      ),
    );

    expect(powered.state.combatants[firstCombatantId].ki.current).toBe(8);
    expect(powered.state.activeEffects).toContainEqual(
      expect.objectContaining({
        type: "scheduled-resource",
        sourceDefinitionId: "move-kiihakai-energy-slasher",
        targetCombatantId: firstCombatantId,
        timing: { type: "turn-start", combatantId: firstCombatantId },
        remainingBoundaries: 1,
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: 2 },
      }),
    );

    expect(powered.state.combatants[firstCombatantId].ki.current).toBe(8);
  });

  it("offers Ki Barbs damage alternatives during power-up and persists only the selected branch", () => {
    const dependencies = createTestCombatDependencies(
      [20, 19],
      new Date("2026-08-22T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:ki-barbs-choice")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: [activeEffectIdSchema.parse("active-effect:ki-barbs")],
        pendingDecisionIds: [pendingDecisionIdSchema.parse("pending-decision:ki-barbs")],
        resolutionFrameIds: [resolutionFrameIdSchema.parse("resolution-frame:ki-barbs")],
        eventIds: Array.from({ length: 12 }, (_, index) =>
          combatEventIdSchema.parse(`event:ki-barbs-${index}`),
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
              moveIds: ["move-kiihakai-ki-barbs"],
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
    const pending = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          action,
          {
            type: "power-up",
            id: combatDecisionIdSchema.parse("decision:ki-barbs-power-up"),
            actorId: firstCombatantId,
            expectedStateVersion: action.version,
          },
          dependencies,
        ),
      ).state,
    );

    expect(pending.pendingDecision).toMatchObject({
      type: "optional-effect",
      combatantId: firstCombatantId,
      options: [
        {
          id: "activate-effect:0",
          type: "activate-effect",
          moveId: "move-kiihakai-ki-barbs",
          effectIndices: [0],
        },
        { id: "decline", type: "decline" },
      ],
    });
    expect(pending.resolutionFrames[0]).toMatchObject({
      type: "effect-choice",
      effectTrigger: "on-power-up",
      sourceDefinitionId: "move-kiihakai-ki-barbs",
      effectIndices: [0],
    });

    const resumed = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          pending,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:ki-barbs-activate"),
            actorId: firstCombatantId,
            expectedStateVersion: pending.version,
            pendingDecisionId: pending.pendingDecision!.id,
            optionId: "activate-effect:0",
          },
          dependencies,
        ),
      ).state,
    );

    expect(resumed.version).toBe(pending.version + 1);
    expect(resumed.combatants[firstCombatantId].ki.current).toBe(6);
    expect(resumed.activeEffects).toContainEqual(
      expect.objectContaining({
        type: "modify-next-action",
        sourceDefinitionId: "move-kiihakai-ki-barbs",
        sourceEffectIndex: 0,
        targetCombatantId: firstCombatantId,
        scope: "next-action",
        modifier: expect.objectContaining({ type: "damage", amount: 3 }),
      }),
    );
    expect(resumed.activeEffects).not.toContainEqual(
      expect.objectContaining({
        sourceDefinitionId: "move-kiihakai-ki-barbs",
        sourceEffectIndex: 1,
      }),
    );
    expect(resumed.pendingDecision).toBeUndefined();
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
        activeEffectIds: [activeEffectIdSchema.parse("active-effect:combat-result-history-escape")],
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

  it("executes condition-aware action-phase extra actions through the public scheduler", () => {
    const dependencies = createTestCombatDependencies([], new Date("2026-08-14T12:00:00.000Z"), {
      fightIds: [fightIdSchema.parse("fight:action-phase-extra-action")],
      combatantIds: [firstCombatantId, secondCombatantId],
      activeEffectIds: Array.from({ length: 8 }, (_, index) =>
        activeEffectIdSchema.parse(`active-effect:action-phase-extra-action-${index}`),
      ),
      eventIds: Array.from({ length: 30 }, (_, index) =>
        combatEventIdSchema.parse(`event:action-phase-extra-action-${index}`),
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
              moveIds: ["move-afterlife-special-fighting-pose-3", "move-afterlife-give-me-energy"],
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
    const submitted = requireTransition(
      submitCombatDecision(
        action,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:action-phase-extra-action"),
          actorId: firstCombatantId,
          expectedStateVersion: action.version,
          moveId: "move-afterlife-special-fighting-pose-3",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );
    const next = requireActiveFightState(submitted.state);

    expect(next.version).toBe(action.version + 1);
    expect(next).toMatchObject({
      phase: "action",
      activeCombatantId: firstCombatantId,
    });
    expect(next.activeEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "extra-action",
          sourceDefinitionId: "move-afterlife-special-fighting-pose-3",
          sourceEffectIndex: 2,
          phase: "action",
          remainingActions: 1,
        }),
        expect.objectContaining({
          type: "floating-effect",
          floatingEffectId: "special-fighting-pose-3-constant-skill-activation",
        }),
      ]),
    );
    expect(enumerateLegalDecisions(next, firstCombatantId)).toContainEqual(
      expect.objectContaining({
        type: "use-move",
        moveId: "move-afterlife-give-me-energy",
      }),
    );
  });

  it("enforces a passive non-CONSTANT Skill policy through the public action scheduler", () => {
    const dependencies = createTestCombatDependencies([], new Date("2026-08-21T12:00:00.000Z"), {
      fightIds: [fightIdSchema.parse("fight:passive-skill-policy")],
      combatantIds: [firstCombatantId, secondCombatantId],
      activeEffectIds: [activeEffectIdSchema.parse("active-effect:passive-skill-policy")],
      eventIds: Array.from({ length: 20 }, (_, index) =>
        combatEventIdSchema.parse(`event:passive-skill-policy-${index}`),
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
              moveIds: ["move-aoyosumu-technique-mastery", "move-afterlife-give-me-energy"],
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
    const allowance = action.activeEffects.find(
      (effect) =>
        effect.type === "extra-action" &&
        effect.sourceDefinitionId === "move-aoyosumu-technique-mastery",
    );
    expect(allowance).toMatchObject({
      phase: "action",
      moveCategory: "skill",
      constant: false,
      remainingActions: 2,
      availableFromTurn: action.turnNumber,
      expiresAfterTurn: action.turnNumber,
    });
    expect(enumerateLegalDecisions(action, firstCombatantId)).toEqual([
      {
        type: "use-move",
        actorId: firstCombatantId,
        moveId: "move-afterlife-give-me-energy",
        targetCombatantId: secondCombatantId,
      },
    ]);

    const firstSkill = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          action,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:passive-skill-policy-first"),
            actorId: firstCombatantId,
            expectedStateVersion: action.version,
            moveId: "move-afterlife-give-me-energy",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );
    expect(firstSkill.phase).toBe("action");
    expect(firstSkill.activeEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "extra-action",
          sourceDefinitionId: "move-aoyosumu-technique-mastery",
          remainingActions: 1,
        }),
      ]),
    );

    const secondSkill = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          firstSkill,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:passive-skill-policy-second"),
            actorId: firstCombatantId,
            expectedStateVersion: firstSkill.version,
            moveId: "move-afterlife-give-me-energy",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );
    expect(secondSkill.phase).toBe("end");
    expect(secondSkill.activeEffects).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "extra-action",
          sourceDefinitionId: "move-aoyosumu-technique-mastery",
        }),
      ]),
    );
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

  it("resolves a next-turn upkeep extra action through the public decision boundary", () => {
    const dependencies = createTestCombatDependencies(
      [20, 1, 20, 1, 20, 1, 20, 1, 20, 1, 20, 1, 20, 1, 20, 1],
      new Date("2026-08-22T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:next-turn-upkeep-extra-action")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: Array.from({ length: 4 }, (_, index) =>
          activeEffectIdSchema.parse(`active-effect:next-turn-upkeep-extra-action-${index}`),
        ),
        eventIds: Array.from({ length: 100 }, (_, index) =>
          combatEventIdSchema.parse(`event:next-turn-upkeep-extra-action-${index}`),
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
              moveIds: ["move-aoyosumu-sky-dance-technique", "move-aoyosumu-close-shave"],
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
    let sourceAction = action;
    for (let turn = 1; turn <= 2; turn += 1) {
      const sourceEnd = requireTransition(
        submitCombatDecision(
          sourceAction,
          {
            type: "pass",
            id: combatDecisionIdSchema.parse(`decision:next-turn-upkeep-source-pass-${turn}`),
            actorId: firstCombatantId,
            expectedStateVersion: sourceAction.version,
          },
          dependencies,
        ),
      );
      const opponentAction = requireActiveFightState(
        requireTransition(
          advanceFight(
            requireActiveFightState(
              requireTransition(advanceFight(sourceEnd.state, dependencies)).state,
            ),
            dependencies,
          ),
        ).state,
      );
      const opponentEnd = requireTransition(
        submitCombatDecision(
          opponentAction,
          {
            type: "pass",
            id: combatDecisionIdSchema.parse(`decision:next-turn-upkeep-opponent-pass-${turn}`),
            actorId: secondCombatantId,
            expectedStateVersion: opponentAction.version,
          },
          dependencies,
        ),
      );
      sourceAction = requireActiveFightState(
        requireTransition(
          advanceFight(
            requireActiveFightState(
              requireTransition(advanceFight(opponentEnd.state, dependencies)).state,
            ),
            dependencies,
          ),
        ).state,
      );
    }
    const attackResult = submitCombatDecision(
      sourceAction,
      {
        type: "use-move",
        id: combatDecisionIdSchema.parse("decision:next-turn-upkeep-extra-action-attack"),
        actorId: firstCombatantId,
        expectedStateVersion: sourceAction.version,
        moveId: "move-aoyosumu-sky-dance-technique",
        targetCombatantId: secondCombatantId,
      },
      dependencies,
    );
    if (!attackResult.ok) throw new Error(JSON.stringify(attackResult.error));
    const attack = requireActiveFightState(attackResult.value.state);
    expect(attack.activeEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "extra-action",
          sourceDefinitionId: "move-aoyosumu-sky-dance-technique",
          phase: "upkeep",
          availableFromTurn: attack.turnNumber + 1,
        }),
      ]),
    );

    const opponentAction = requireActiveFightState(
      requireTransition(
        advanceFight(
          requireActiveFightState(requireTransition(advanceFight(attack, dependencies)).state),
          dependencies,
        ),
      ).state,
    );
    const opponentEnd = requireTransition(
      submitCombatDecision(
        opponentAction,
        {
          type: "pass",
          id: combatDecisionIdSchema.parse("decision:next-turn-upkeep-extra-action-pass"),
          actorId: secondCombatantId,
          expectedStateVersion: opponentAction.version,
        },
        dependencies,
      ),
    );
    const upkeep = requireActiveFightState(
      requireTransition(
        advanceFight(
          requireActiveFightState(
            requireTransition(advanceFight(opponentEnd.state, dependencies)).state,
          ),
          dependencies,
        ),
      ).state,
    );
    expect(upkeep.phase).toBe("upkeep");
    expect(enumerateLegalDecisions(upkeep, firstCombatantId)).toEqual([
      {
        type: "use-move",
        actorId: firstCombatantId,
        moveId: "move-aoyosumu-close-shave",
        targetCombatantId: secondCombatantId,
      },
    ]);

    const consumed = requireTransition(
      submitCombatDecision(
        upkeep,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:next-turn-upkeep-extra-action-consume"),
          actorId: firstCombatantId,
          expectedStateVersion: upkeep.version,
          moveId: "move-aoyosumu-close-shave",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );
    const consumedState = requireActiveFightState(consumed.state);
    expect(consumedState.version).toBe(upkeep.version + 1);
    expect(consumedState.phase).toBe("end");
    expect(consumedState.activeEffects).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "extra-action",
          sourceDefinitionId: "move-aoyosumu-sky-dance-technique",
        }),
      ]),
    );
  });

  it("offers Launching Kick's next-turn paid activation at the upkeep boundary", () => {
    const dependencies = createTestCombatDependencies(
      [20, 1],
      new Date("2026-08-23T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:launching-kick-paid-extra-action")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: Array.from({ length: 6 }, (_, index) =>
          activeEffectIdSchema.parse(`active-effect:launching-kick-${index}`),
        ),
        resolutionFrameIds: Array.from({ length: 4 }, (_, index) =>
          resolutionFrameIdSchema.parse(`resolution-frame:launching-kick-${index}`),
        ),
        pendingDecisionIds: Array.from({ length: 4 }, (_, index) =>
          pendingDecisionIdSchema.parse(`pending-decision:launching-kick-${index}`),
        ),
        eventIds: Array.from({ length: 40 }, (_, index) =>
          combatEventIdSchema.parse(`event:launching-kick-${index}`),
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
              moveIds: ["move-kurokonwaku-launching-kick", "move-kurokonwaku-shadow-stalker"],
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
    const attack = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          action,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:launching-kick-attack"),
            actorId: firstCombatantId,
            expectedStateVersion: action.version,
            moveId: "move-kurokonwaku-launching-kick",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );
    expect(attack.activeEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "extra-action",
          sourceDefinitionId: "move-kurokonwaku-launching-kick",
          phase: "upkeep",
          activationCost: { resource: "ki", amount: 1 },
        }),
      ]),
    );
    const opponentAction = requireActiveFightState(
      requireTransition(
        advanceFight(
          requireActiveFightState(requireTransition(advanceFight(attack, dependencies)).state),
          dependencies,
        ),
      ).state,
    );
    const opponentEnd = requireTransition(
      submitCombatDecision(
        opponentAction,
        {
          type: "pass",
          id: combatDecisionIdSchema.parse("decision:launching-kick-opponent-pass"),
          actorId: secondCombatantId,
          expectedStateVersion: opponentAction.version,
        },
        dependencies,
      ),
    );
    const upkeep = requireActiveFightState(
      requireTransition(
        advanceFight(
          requireActiveFightState(
            requireTransition(advanceFight(opponentEnd.state, dependencies)).state,
          ),
          dependencies,
        ),
      ).state,
    );
    expect(upkeep.phase).toBe("upkeep");
    expect(upkeep.pendingDecision).toMatchObject({
      type: "optional-effect",
      combatantId: firstCombatantId,
      options: expect.arrayContaining([{ id: "decline", type: "decline" }]),
    });
    const pending = upkeep.pendingDecision;
    if (pending === undefined) throw new Error("Expected Launching Kick activation choice.");
    const activate = pending.options.find((option) => option.type === "activate-effect");
    if (activate === undefined) throw new Error("Expected Launching Kick activation option.");
    const activated = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          upkeep,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:launching-kick-activate"),
            actorId: firstCombatantId,
            expectedStateVersion: upkeep.version,
            pendingDecisionId: pending.id,
            optionId: activate.id,
          },
          dependencies,
        ),
      ).state,
    );
    expect(activated.phase).toBe("upkeep");
    expect(activated.pendingDecision).toBeUndefined();
    expect(activated.combatants[firstCombatantId].ki.current).toBe(
      upkeep.combatants[firstCombatantId].ki.current - 1,
    );
    const activatedExtraAction = activated.activeEffects.find(
      (effect) =>
        effect.type === "extra-action" &&
        effect.sourceDefinitionId === "move-kurokonwaku-launching-kick",
    );
    expect(activatedExtraAction).toBeDefined();
    expect(activatedExtraAction).not.toHaveProperty("activationCost");
    expect(enumerateLegalDecisions(activated, firstCombatantId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "use-move",
          moveId: "move-kurokonwaku-shadow-stalker",
        }),
      ]),
    );
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
    expect(skipped.state.actionHistory).toContainEqual({
      type: "turn-skipped",
      actorId: secondCombatantId,
      turnNumber: targetUpkeep.turnNumber,
      phase: "action",
      reason: "effect",
    });

    const nextTurn = requireTransition(advanceFight(skipped.state, dependencies));
    expect(nextTurn.state.activeEffects).toEqual([]);
  });

  it("applies a following-action damage modifier after the owner's prior turn was skipped", () => {
    const dependencies = createTestCombatDependencies(
      [20, 1],
      new Date("2026-08-23T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:following-action-damage")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 50 }, (_, index) =>
          combatEventIdSchema.parse(`event:following-action-damage-${index + 1}`),
        ),
        activeEffectIds: [
          activeEffectIdSchema.parse("active-effect:following-action-power-boost"),
          activeEffectIdSchema.parse("active-effect:following-action-skip"),
        ],
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
                stats: { power: 100, dexterity: 10, dexterityBonus: 0 },
                moveIds: ["move-kiihakai-power-boost", "move-afterlife-kamehameha"],
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
      ).state,
    );
    const restricted: ActiveFightState = {
      ...created,
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:following-action-power-boost"),
          type: "active-constant",
          sourceCombatantId: firstCombatantId,
          targetCombatantId: firstCombatantId,
          sourceDefinitionId: "move-kiihakai-power-boost",
          activatedOnTurn: created.turnNumber,
          duration: "combat",
          paidActivationCost: 2,
          lifecycle: "active",
        },
        {
          id: activeEffectIdSchema.parse("active-effect:following-action-skip"),
          type: "action-restriction",
          sourceCombatantId: firstCombatantId,
          targetCombatantId: firstCombatantId,
          sourceDefinitionId: "move-kiihakai-power-boost",
          sourceEffectIndex: 0,
          availableFromTurn: created.turnNumber,
          remainingTurns: 1,
        },
      ],
    };

    const skipped = requireTransition(advanceFight(restricted, dependencies));
    expect(skipped.state.actionHistory).toContainEqual(
      expect.objectContaining({
        type: "turn-skipped",
        actorId: firstCombatantId,
        turnNumber: created.turnNumber,
      }),
    );
    const secondUpkeep = requireActiveFightState(
      requireTransition(advanceFight(skipped.state, dependencies)).state,
    );
    const secondAction = requireActiveFightState(
      requireTransition(advanceFight(secondUpkeep, dependencies)).state,
    );
    const secondPass = requireTransition(
      submitCombatDecision(
        secondAction,
        {
          type: "pass",
          id: combatDecisionIdSchema.parse("decision:following-action-second-pass"),
          actorId: secondCombatantId,
          expectedStateVersion: secondAction.version,
        },
        dependencies,
      ),
    );
    const firstUpkeep = requireActiveFightState(
      requireTransition(advanceFight(secondPass.state, dependencies)).state,
    );
    const firstAction = requireActiveFightState(
      requireTransition(advanceFight(firstUpkeep, dependencies)).state,
    );
    const attack = requireTransition(
      submitCombatDecision(
        firstAction,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:following-action-attack"),
          actorId: firstCombatantId,
          expectedStateVersion: firstAction.version,
          moveId: "move-afterlife-kamehameha",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );

    expect(attack.state.version).toBe(firstAction.version + 1);
    expect(attack.events).toContainEqual(
      expect.objectContaining({
        type: "damage-applied",
        sourceCombatantId: firstCombatantId,
        targetCombatantId: secondCombatantId,
        amount: 70,
      }),
    );
    expect(attack.state.combatants[secondCombatantId].hitPoints.current).toBe(30);
  });

  it("applies Bloodletter's turn-limited KI drain through public transitions", () => {
    const dependencies = createTestCombatDependencies(
      [20, 1, 20, 1],
      new Date("2026-08-20T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:bloodletter-resource-event")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 50 }, (_, index) =>
          combatEventIdSchema.parse(`event:bloodletter-resource-event-${index + 1}`),
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
              moveIds: ["move-kurokonwaku-bloodletter", "move-kurokonwaku-cannonball"],
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
    const firstAction = requireActiveFightState(
      requireTransition(advanceFight(created.state, dependencies)).state,
    );
    const bloodletter = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          firstAction,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:bloodletter"),
            actorId: firstCombatantId,
            expectedStateVersion: firstAction.version,
            moveId: "move-kurokonwaku-bloodletter",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );
    expect(bloodletter.actionHistory.at(-1)).toMatchObject({
      moveId: "move-kurokonwaku-bloodletter",
      outcome: "successful",
    });

    const opponentAction = requireActiveFightState(
      requireTransition(
        advanceFight(
          requireActiveFightState(requireTransition(advanceFight(bloodletter, dependencies)).state),
          dependencies,
        ),
      ).state,
    );
    const opponentPass = requireTransition(
      submitCombatDecision(
        opponentAction,
        {
          type: "pass",
          id: combatDecisionIdSchema.parse("decision:bloodletter-opponent-pass"),
          actorId: secondCombatantId,
          expectedStateVersion: opponentAction.version,
        },
        dependencies,
      ),
    );
    const nextTurnAction = requireActiveFightState(
      requireTransition(
        advanceFight(
          requireActiveFightState(
            requireTransition(advanceFight(opponentPass.state, dependencies)).state,
          ),
          dependencies,
        ),
      ).state,
    );
    const cannonball = requireTransition(
      submitCombatDecision(
        nextTurnAction,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:bloodletter-cannonball"),
          actorId: firstCombatantId,
          expectedStateVersion: nextTurnAction.version,
          moveId: "move-kurokonwaku-cannonball",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );

    expect(cannonball.state.version).toBe(nextTurnAction.version + 1);
    expect(cannonball.state.combatants[secondCombatantId].ki.current).toBe(2);
    expect(cannonball.events).toContainEqual(
      expect.objectContaining({ type: "ki-changed", combatantId: secondCombatantId, amount: -3 }),
    );
  });

  it("creates a typed skill-only extra action after an active Synergy single-die threshold", () => {
    const dependencies = createTestCombatDependencies(
      [25, 1],
      new Date("2026-08-21T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:synergy-extra-action")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: Array.from({ length: 4 }, (_, index) =>
          activeEffectIdSchema.parse(`active-effect:synergy-${index + 1}`),
        ),
        resolutionFrameIds: Array.from({ length: 4 }, (_, index) =>
          resolutionFrameIdSchema.parse(`resolution-frame:synergy-${index + 1}`),
        ),
        eventIds: Array.from({ length: 60 }, (_, index) =>
          combatEventIdSchema.parse(`event:synergy-${index + 1}`),
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
                moveIds: [
                  "move-kiihakai-synergy",
                  "move-kiihakai-evening-the-field",
                  "move-kiihakai-focus-buster",
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
      ).state,
    );
    let state = requireActiveFightState(
      requireTransition(advanceFight(created, dependencies)).state,
    );
    state = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          state,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:synergy-activate"),
            actorId: firstCombatantId,
            expectedStateVersion: state.version,
            moveId: "move-kiihakai-synergy",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );
    for (let index = 0; index < 8; index += 1) {
      if (state.phase === "action" && state.activeCombatantId === firstCombatantId) break;
      if (state.phase === "action" && state.activeCombatantId === secondCombatantId) {
        state = requireActiveFightState(
          requireTransition(
            submitCombatDecision(
              state,
              {
                type: "pass",
                id: combatDecisionIdSchema.parse(`decision:synergy-pass-${index}`),
                actorId: secondCombatantId,
                expectedStateVersion: state.version,
              },
              dependencies,
            ),
          ).state,
        );
      } else {
        state = requireActiveFightState(requireTransition(advanceFight(state, dependencies)).state);
      }
    }
    expect(state.phase).toBe("action");
    expect(state.activeCombatantId).toBe(firstCombatantId);

    const attack = requireTransition(
      submitCombatDecision(
        state,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:synergy-threshold-attack"),
          actorId: firstCombatantId,
          expectedStateVersion: state.version,
          moveId: "move-kiihakai-focus-buster",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );

    const attackState = requireActiveFightState(attack.state);
    expect(attackState.phase).toBe("action");
    expect(attackState.activeCombatantId).toBe(firstCombatantId);
    expect(attackState.activeEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "extra-action",
          sourceDefinitionId: "move-kiihakai-synergy",
          moveCategory: "skill",
          constant: true,
          remainingActions: 1,
        }),
      ]),
    );
    expect(attackState.resolutionFrames).toContainEqual(
      expect.objectContaining({
        type: "effect",
        operation: "activate",
        trigger: "on-roll-result",
        returnPhase: "end",
        eligibleMoveIds: expect.arrayContaining(["move-kiihakai-evening-the-field"]),
      }),
    );
    expect(enumerateLegalDecisions(attackState, firstCombatantId)).toContainEqual({
      type: "use-move",
      actorId: firstCombatantId,
      moveId: "move-kiihakai-evening-the-field",
      targetCombatantId: secondCombatantId,
    });
  });

  it("applies a typed current-attack combat outcome through the public transition", () => {
    const dependencies = createTestCombatDependencies(
      [20, 1],
      new Date("2026-08-21T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:breaker-breaker")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 40 }, (_, index) =>
          combatEventIdSchema.parse(`event:breaker-breaker-${index + 1}`),
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
                stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
                moveIds: ["move-midorikatai-breaker-breaker"],
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
      ).state,
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created, dependencies)).state,
    );
    const result = requireTransition(
      submitCombatDecision(
        action,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:breaker-breaker"),
          actorId: firstCombatantId,
          expectedStateVersion: action.version,
          moveId: "move-midorikatai-breaker-breaker",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );
    const state = requireActiveFightState(result.state);

    expect(state.version).toBe(action.version + 1);
    expect(state.combatants[secondCombatantId].activeStatuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          statusId: "break",
          sourceDefinitionId: "move-midorikatai-breaker-breaker",
        }),
      ]),
    );
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "status-applied",
          targetCombatantId: secondCombatantId,
          statusId: "break",
        }),
      ]),
    );
  });

  it.each(["item-technology-spare-parts", "item-technology-cybernetic-replacements"])(
    "uses %s to prevent the incoming BREAK outcome",
    (itemId) => {
      const dependencies = createTestCombatDependencies(
        [20, 1],
        new Date("2026-08-23T12:00:00.000Z"),
        {
          fightIds: [fightIdSchema.parse(`fight:${itemId}`)],
          combatantIds: [firstCombatantId, secondCombatantId],
          pendingDecisionIds: [pendingDecisionIdSchema.parse(`pending-decision:${itemId}`)],
          resolutionFrameIds: [resolutionFrameIdSchema.parse(`resolution-frame:${itemId}`)],
          eventIds: Array.from({ length: 40 }, (_, index) =>
            combatEventIdSchema.parse(`event:${itemId}-${index + 1}`),
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
                  stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
                  moveIds: ["move-midorikatai-breaker-breaker"],
                },
                {
                  maximumHitPoints: 100,
                  stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
                  moveIds: [],
                  itemIds: [itemId],
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
      const declared = requireTransition(
        submitCombatDecision(
          action,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse(`decision:${itemId}-attack`),
            actorId: firstCombatantId,
            expectedStateVersion: action.version,
            moveId: "move-midorikatai-breaker-breaker",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      );
      const pending = requireActiveFightState(declared.state).pendingDecision;
      if (pending === undefined) throw new Error("Expected a defense response decision.");
      expect(pending).toMatchObject({
        type: "defense-response",
        options: expect.arrayContaining([
          {
            id: `activate-item:${itemId}`,
            type: "activate-effect",
            itemId,
          },
        ]),
      });

      const resolved = requireTransition(
        submitCombatDecision(
          declared.state,
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse(`decision:${itemId}-defense`),
            actorId: secondCombatantId,
            expectedStateVersion: declared.state.version,
            pendingDecisionId: pending.id,
            optionId: `activate-item:${itemId}`,
          },
          dependencies,
        ),
      );
      const state = requireActiveFightState(resolved.state);

      expect(state.combatants[secondCombatantId].activeStatuses).not.toContainEqual(
        expect.objectContaining({ statusId: "break" }),
      );
      expect(resolved.events).toContainEqual(
        expect.objectContaining({ type: "item-used", itemId }),
      );
      expect(resolved.events).not.toContainEqual(
        expect.objectContaining({ type: "status-applied", statusId: "break" }),
      );
      expect(resolved.events).toContainEqual(
        expect.objectContaining({ type: "attack-resolved", outcome: "successful" }),
      );
      expect(state.combatants[secondCombatantId].itemUses).toEqual({ [itemId]: 1 });
    },
  );

  it("uses a durable BREAK status to prevent Monkey Sweep's block response", () => {
    const dependencies = createTestCombatDependencies(
      [20, 1],
      new Date("2026-08-23T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:monkey-sweep-break")],
        combatantIds: [firstCombatantId, secondCombatantId],
        pendingDecisionIds: [pendingDecisionIdSchema.parse("pending-decision:monkey-sweep-break")],
        resolutionFrameIds: [resolutionFrameIdSchema.parse("resolution-frame:monkey-sweep-break")],
        eventIds: Array.from({ length: 30 }, (_, index) =>
          combatEventIdSchema.parse(`event:monkey-sweep-break-${index + 1}`),
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
                stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
                moveIds: ["move-freestyle-monkey-sweep"],
              },
              {
                maximumHitPoints: 100,
                stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
                moveIds: ["move-kiihakai-ki-fist-block"],
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
    const prepared: ActiveFightState = {
      ...action,
      combatants: {
        ...action.combatants,
        [secondCombatantId]: {
          ...action.combatants[secondCombatantId],
          activeStatuses: [
            {
              statusId: "break",
              sourceCombatantId: firstCombatantId,
              sourceDefinitionId: "move-afterlife-meteor-smash",
              stacks: 1,
              duration: { type: "combat" },
            },
          ],
        },
      },
    };

    const transition = requireTransition(
      submitCombatDecision(
        prepared,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:monkey-sweep-break"),
          actorId: firstCombatantId,
          expectedStateVersion: prepared.version,
          moveId: "move-freestyle-monkey-sweep",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );
    const pendingState = requireActiveFightState(transition.state);

    expect(pendingState.version).toBe(prepared.version + 1);
    expect(pendingState.pendingDecision).toMatchObject({
      type: "defense-response",
      options: [{ id: "roll-defense", type: "roll-defense" }],
    });
    expect(pendingState.pendingDecision?.options).not.toContainEqual(
      expect.objectContaining({ type: "use-block" }),
    );
  });

  it("creates Backflip Kick's next-action floating effect after the resolved die", () => {
    const dependencies = createTestCombatDependencies(
      [30, 1],
      new Date("2026-08-23T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:backflip-floating")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: [activeEffectIdSchema.parse("active-effect:backflip-floating")],
        pendingDecisionIds: [pendingDecisionIdSchema.parse("pending-decision:backflip-defense")],
        resolutionFrameIds: [resolutionFrameIdSchema.parse("resolution-frame:backflip-defense")],
        eventIds: Array.from({ length: 20 }, (_, index) =>
          combatEventIdSchema.parse(`event:backflip-floating-${index + 1}`),
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
                stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
                moveIds: ["move-akaikaru-backflip-kick"],
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
      ).state,
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created, dependencies)).state,
    );
    const attackTransition = requireTransition(
      submitCombatDecision(
        action,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:backflip-attack"),
          actorId: firstCombatantId,
          expectedStateVersion: action.version,
          moveId: "move-akaikaru-backflip-kick",
          targetCombatantId: secondCombatantId,
        },
        dependencies,
      ),
    );
    const defense = requireActiveFightState(attackTransition.state);
    expect(defense.pendingDecision).toBeUndefined();
    expect(defense.version).toBe(action.version + 1);
    expect(defense.activeEffects).toContainEqual(
      expect.objectContaining({
        type: "floating-effect",
        sourceCombatantId: firstCombatantId,
        targetCombatantId: firstCombatantId,
        sourceDefinitionId: "move-akaikaru-backflip-kick",
        sourceEffectIndex: 0,
        floatingEffectId: "backflip-kick-next-dexterity-stun",
        scope: { type: "next-action" },
        effects: expect.arrayContaining([
          expect.objectContaining({ type: "prevent-resolution", prevention: "block" }),
        ]),
      }),
    );
  });

  it("activates Ki Color Cascade's durable declared-style classification through public transitions", () => {
    const dependencies = createTestCombatDependencies(
      [30, 1],
      new Date("2026-08-23T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:ki-color-cascade")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: [activeEffectIdSchema.parse("active-effect:ki-color-cascade")],
        eventIds: Array.from({ length: 20 }, (_, index) =>
          combatEventIdSchema.parse(`event:ki-color-cascade-${index + 1}`),
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
                declaredStyleId: "style-akaikaru",
                stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
                moveIds: ["move-freestyle-ki-color-cascade"],
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
      ).state,
    );
    const action = requireActiveFightState(
      requireTransition(advanceFight(created, dependencies)).state,
    );

    const resolved = requireActiveFightState(
      requireTransition(
        submitCombatDecision(
          action,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:ki-color-cascade"),
            actorId: firstCombatantId,
            expectedStateVersion: action.version,
            moveId: "move-freestyle-ki-color-cascade",
            targetCombatantId: secondCombatantId,
          },
          dependencies,
        ),
      ).state,
    );

    expect(resolved.combatants[firstCombatantId].declaredStyleId).toBe("style-akaikaru");
    expect(resolved.activeEffects).toContainEqual(
      expect.objectContaining({
        id: "active-effect:ki-color-cascade",
        type: "modify-move-classification",
        sourceDefinitionId: "move-freestyle-ki-color-cascade",
        targetCombatantId: firstCombatantId,
        selector: expect.objectContaining({ styleId: "style-freestyle" }),
        classification: { type: "replace-style", style: "declared-style" },
        duration: {
          type: "turns",
          ownerCombatantId: firstCombatantId,
          remaining: 4,
        },
      }),
    );
  });
});
