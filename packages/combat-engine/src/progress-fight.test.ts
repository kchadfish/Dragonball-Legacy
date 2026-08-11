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
});
