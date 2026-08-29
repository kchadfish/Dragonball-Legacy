import { TRANSFORMATION_DEFINITIONS } from "@dragonball-resurgence/game-data";
import { describe, expect, it } from "vitest";

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
} from "./ids.js";
import { createTestCombatDependencies } from "./testing/index.js";

const ghostId = combatantIdSchema.parse("combatant:ghost");
const opponentId = combatantIdSchema.parse("combatant:opponent");

describe("transformation activation", () => {
  it("activates an owned converted transformation as an action with evented stat changes", () => {
    const dependencies = createTestCombatDependencies([], new Date("2026-08-04T12:00:00.000Z"), {
      fightIds: [fightIdSchema.parse("fight:transformation")],
      combatantIds: [ghostId, opponentId],
      eventIds: Array.from({ length: 8 }, (_, index) =>
        combatEventIdSchema.parse(`event:transformation-${index + 1}`),
      ),
    });
    const created = createFight(
      {
        mode: "spar",
        combatants: [
          {
            maximumHitPoints: 100,
            stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
            moveIds: [],
            transformationIds: ["transformation-humans-1-high-tension"],
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
    if (!created.ok) throw new Error("Expected fight creation to succeed.");
    const action = advanceFight(created.value.state, dependencies);
    if (!action.ok || action.value.state.status !== "active")
      throw new Error("Expected action state.");

    expect(enumerateLegalDecisions(action.value.state, ghostId)).toContainEqual({
      type: "activate-transformation",
      actorId: ghostId,
      transformationId: "transformation-humans-1-high-tension",
    });
    const activated = submitCombatDecision(
      action.value.state,
      {
        type: "activate-transformation",
        id: combatDecisionIdSchema.parse("decision:activate-ghoul"),
        actorId: ghostId,
        expectedStateVersion: 1,
        transformationId: "transformation-humans-1-high-tension",
      },
      dependencies,
    );
    if (!activated.ok || activated.value.state.status !== "active") {
      throw new Error("Expected transformation activation to succeed.");
    }

    expect(activated.value.state).toMatchObject({ version: 2, phase: "end" });
    expect(activated.value.state.combatants[ghostId]).toMatchObject({
      hitPoints: { current: 117, maximum: 117 },
      stats: { power: 23, dexterity: 12 },
      transformation: {
        transformationId: "transformation-humans-1-high-tension",
        activatedOnTurn: 1,
      },
    });
    expect(activated.value.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "transformation-activated", combatantId: ghostId }),
      ]),
    );
  });

  it("reverts a transformed defender through the public successful-attack boundary", () => {
    const dependencies = createTestCombatDependencies(
      [20, 1],
      new Date("2026-08-04T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:transformation-reversion")],
        combatantIds: [ghostId, opponentId],
        eventIds: Array.from({ length: 40 }, (_, index) =>
          combatEventIdSchema.parse(`event:transformation-reversion-${index + 1}`),
        ),
      },
    );
    const created = createFight(
      {
        mode: "spar",
        combatants: [
          {
            maximumHitPoints: 500,
            stats: { power: 50, dexterity: 10, dexterityBonus: 5 },
            moveIds: ["move-freestyle-all-out-triumphant-beam"],
          },
          {
            maximumHitPoints: 500,
            stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
            moveIds: [],
          },
        ],
      },
      dependencies,
    );
    if (!created.ok) throw new Error("Expected fight creation to succeed.");
    const action = advanceFight(created.value.state, dependencies);
    if (!action.ok || action.value.state.status !== "active")
      throw new Error("Expected action state.");
    const transformed = {
      ...action.value.state.combatants[opponentId],
      hitPoints: { current: 700, maximum: 700 },
      stats: { power: 24, dexterity: 1, dexterityBonus: 0 },
      transformation: {
        transformationId: "transformation-ghost-2-ghoul" as const,
        activatedOnTurn: 1,
        baseline: {
          currentHitPoints: 500,
          maximumHitPoints: 500,
          stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
        },
      },
    };
    const armed = {
      ...action.value.state,
      turnNumber: 10,
      combatants: { ...action.value.state.combatants, [opponentId]: transformed },
    };
    const reverted = submitCombatDecision(
      armed,
      {
        type: "use-move",
        id: combatDecisionIdSchema.parse("decision:revert-transformation"),
        actorId: ghostId,
        expectedStateVersion: armed.version,
        moveId: "move-freestyle-all-out-triumphant-beam",
        targetCombatantId: opponentId,
      },
      dependencies,
    );
    if (!reverted.ok || reverted.value.state.status !== "active")
      throw new Error("Expected successful attack state.");

    expect(reverted.value.state.combatants[opponentId]).toMatchObject({
      hitPoints: { maximum: 500 },
      stats: { power: 20, dexterity: 1 },
      transformation: undefined,
    });
    expect(reverted.value.events).toContainEqual(
      expect.objectContaining({
        type: "transformation-deactivated",
        combatantId: opponentId,
        transformationId: "transformation-ghost-2-ghoul",
      }),
    );
  });

  it("forces the transformed defender's next upkeep roll after X-Attack", () => {
    const dependencies = createTestCombatDependencies(
      [20, 1, 20, 1, 20, 1, 20, 1, 20, 1, 20, 1, 1],
      new Date("2026-08-04T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:x-attack-transformation-roll")],
        combatantIds: [ghostId, opponentId],
        eventIds: Array.from({ length: 80 }, (_, index) =>
          combatEventIdSchema.parse(`event:x-attack-transformation-roll-${index + 1}`),
        ),
        activeEffectIds: Array.from({ length: 10 }, (_, index) =>
          activeEffectIdSchema.parse(`active-effect:x-attack-transformation-roll-${index + 1}`),
        ),
      },
    );
    const created = createFight(
      {
        mode: "spar",
        combatants: [
          {
            maximumHitPoints: 200,
            stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
            moveIds: ["move-midorikatai-x-attack"],
          },
          {
            maximumHitPoints: 200,
            stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
            moveIds: [],
          },
        ],
      },
      dependencies,
    );
    if (!created.ok) throw new Error("Expected fight creation to succeed.");
    const action = advanceFight(created.value.state, dependencies);
    if (!action.ok || action.value.state.status !== "active")
      throw new Error("Expected action state.");
    const ghoul = TRANSFORMATION_DEFINITIONS.find(
      (transformation) => transformation.id === "transformation-ghost-2-ghoul",
    );
    if (ghoul === undefined) throw new Error("Expected Ghoul transformation data.");
    const armed = {
      ...action.value.state,
      combatants: {
        ...action.value.state.combatants,
        [opponentId]: {
          ...action.value.state.combatants[opponentId],
          hitPoints: { current: 100, maximum: 280 },
          stats: { power: 24, dexterity: 14, dexterityBonus: 0 },
          transformation: {
            transformationId: ghoul.id,
            activatedOnTurn: 1,
            baseline: {
              currentHitPoints: 200,
              maximumHitPoints: 200,
              stats: { power: 20, dexterity: 1, dexterityBonus: 0 },
            },
          },
        },
      },
    };
    const attack = submitCombatDecision(
      armed,
      {
        type: "use-move",
        id: combatDecisionIdSchema.parse("decision:x-attack-transformation-roll"),
        actorId: ghostId,
        expectedStateVersion: armed.version,
        moveId: "move-midorikatai-x-attack",
        targetCombatantId: opponentId,
      },
      dependencies,
    );
    if (!attack.ok || attack.value.state.status !== "active")
      throw new Error("Expected X-Attack to resolve.");
    expect(attack.value.state.combatants[opponentId].transformation).toBeDefined();
    expect(attack.value.state.activeEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "require-transformation-roll",
          targetCombatantId: opponentId,
        }),
      ]),
    );

    const nextUpkeep = advanceFight(attack.value.state, dependencies);
    if (!nextUpkeep.ok || nextUpkeep.value.state.status !== "active")
      throw new Error("Expected the next upkeep state.");
    expect(nextUpkeep.value.state.combatants[opponentId].transformation).toBeDefined();
    const afterRoll = advanceFight(nextUpkeep.value.state, dependencies);
    if (!afterRoll.ok || afterRoll.value.state.status !== "active")
      throw new Error("Expected forced transformation roll resolution.");
    expect(afterRoll.value.state.combatants[opponentId].transformation).toBeUndefined();
    expect([...attack.value.events, ...nextUpkeep.value.events, ...afterRoll.value.events]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "transformation-rolled", combatantId: opponentId }),
        expect.objectContaining({ type: "transformation-deactivated", combatantId: opponentId }),
      ]),
    );
  });

  it("consumes a granted transformation action without ending the action phase", () => {
    const dependencies = createTestCombatDependencies([], new Date("2026-08-04T12:00:00.000Z"), {
      fightIds: [fightIdSchema.parse("fight:free-transformation")],
      combatantIds: [ghostId, opponentId],
      eventIds: Array.from({ length: 8 }, (_, index) =>
        combatEventIdSchema.parse(`event:free-transformation-${index + 1}`),
      ),
    });
    const created = createFight(
      {
        mode: "spar",
        combatants: [
          {
            maximumHitPoints: 100,
            stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
            moveIds: [],
            transformationIds: ["transformation-humans-1-high-tension"],
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
    if (!created.ok) throw new Error("Expected fight creation to succeed.");
    const action = advanceFight(created.value.state, dependencies);
    if (!action.ok || action.value.state.status !== "active")
      throw new Error("Expected action state.");
    const armed = {
      ...action.value.state,
      combatants: {
        ...action.value.state.combatants,
        [ghostId]: { ...action.value.state.combatants[ghostId], freeTransformationActions: 1 },
      },
    };

    const activated = submitCombatDecision(
      armed,
      {
        type: "activate-transformation",
        id: combatDecisionIdSchema.parse("decision:free-transform"),
        actorId: ghostId,
        expectedStateVersion: armed.version,
        transformationId: "transformation-humans-1-high-tension",
      },
      dependencies,
    );
    if (!activated.ok || activated.value.state.status !== "active")
      throw new Error("Expected transformation activation to succeed.");

    expect(activated.value.state).toMatchObject({ version: 2, phase: "action" });
    expect(activated.value.state.combatants[ghostId]).toMatchObject({
      freeTransformationActions: undefined,
      transformation: { transformationId: "transformation-humans-1-high-tension" },
    });
    expect(activated.value.events).not.toContainEqual(
      expect.objectContaining({ type: "phase-changed" }),
    );

    expect(enumerateLegalDecisions(activated.value.state, ghostId)).toContainEqual({
      type: "deactivate-transformation",
      actorId: ghostId,
    });
    const deactivated = submitCombatDecision(
      activated.value.state,
      {
        type: "deactivate-transformation",
        id: combatDecisionIdSchema.parse("decision:manual-untransform"),
        actorId: ghostId,
        expectedStateVersion: activated.value.state.version,
      },
      dependencies,
    );
    if (!deactivated.ok || deactivated.value.state.status !== "active")
      throw new Error("Expected manual deactivation to succeed.");
    expect(deactivated.value.state.combatants[ghostId]).toMatchObject({
      hitPoints: { current: 100, maximum: 100 },
      transformation: undefined,
    });
    expect(deactivated.value.state.combatants[ghostId]).not.toHaveProperty(
      "transformationCooldown",
    );
    expect(deactivated.value.state.phase).toBe("end");
  });

  it("serializes an optional highest-transformation opportunity at the next END boundary", () => {
    const dependencies = createTestCombatDependencies([], new Date("2026-08-04T12:00:00.000Z"), {
      fightIds: [fightIdSchema.parse("fight:forced-transformation")],
      combatantIds: [ghostId, opponentId],
      pendingDecisionIds: ["pending-decision:forced-transformation" as never],
      eventIds: Array.from({ length: 8 }, (_, index) =>
        combatEventIdSchema.parse(`event:forced-transformation-${index + 1}`),
      ),
    });
    const created = createFight(
      {
        mode: "spar",
        combatants: [
          {
            maximumHitPoints: 100,
            stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
            moveIds: [],
            transformationIds: ["transformation-ghost-2-ghoul"],
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
    if (!created.ok) throw new Error("Expected fight creation to succeed.");
    const action = advanceFight(created.value.state, dependencies);
    if (!action.ok || action.value.state.status !== "active")
      throw new Error("Expected action state.");
    const endState = {
      ...action.value.state,
      phase: "end" as const,
      combatants: {
        ...action.value.state.combatants,
        [ghostId]: {
          ...action.value.state.combatants[ghostId],
          forcedTransformationOpportunities: [
            {
              sourceDefinitionId: "move-kiihakai-aura-clash",
              sourceEffectIndex: 0,
              targetTransformation: "highest" as const,
              optional: true,
            },
          ],
        },
      },
    };
    const pending = advanceFight(endState, dependencies);
    if (!pending.ok || pending.value.state.status !== "active")
      throw new Error("Expected a forced-transformation choice.");
    expect(pending.value.state.pendingDecision).toMatchObject({
      type: "optional-effect",
      combatantId: ghostId,
      options: [
        expect.objectContaining({
          transformationId: "transformation-ghost-2-ghoul",
          forcedTransformation: {
            sourceDefinitionId: "move-kiihakai-aura-clash",
            sourceEffectIndex: 0,
          },
        }),
        expect.objectContaining({ type: "decline" }),
      ],
    });
    const option = pending.value.state.pendingDecision!.options[0];
    const resolved = submitCombatDecision(
      pending.value.state,
      {
        type: "respond-to-pending-decision",
        id: combatDecisionIdSchema.parse("decision:forced-transformation"),
        actorId: ghostId,
        expectedStateVersion: pending.value.state.version,
        pendingDecisionId: pending.value.state.pendingDecision!.id,
        optionId: option.id,
      },
      dependencies,
    );
    if (!resolved.ok || resolved.value.state.status !== "active")
      throw new Error("Expected forced transformation to resolve.");
    expect(resolved.value.state.combatants[ghostId]).toMatchObject({
      transformation: { transformationId: "transformation-ghost-2-ghoul" },
      forcedTransformationOpportunities: undefined,
    });
    expect(resolved.value.events).toContainEqual(
      expect.objectContaining({
        type: "transformation-activated",
        combatantId: ghostId,
      }),
    );
  });

  it("does not roll an exhausted d100 transformation at the upkeep threshold", () => {
    const dependencies = createTestCombatDependencies([], new Date("2026-08-04T12:00:00.000Z"), {
      fightIds: [fightIdSchema.parse("fight:d100-exemption")],
      combatantIds: [ghostId, opponentId],
      eventIds: Array.from({ length: 12 }, (_, index) =>
        combatEventIdSchema.parse(`event:d100-exemption-${index + 1}`),
      ),
    });
    const created = createFight(
      {
        mode: "spar",
        combatants: [
          {
            maximumHitPoints: 100,
            stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
            moveIds: [],
            raceId: "race-humans",
            transformationProfiles: [
              {
                transformationId: "transformation-humans-1-high-tension",
                rollSides: 100,
                mastery: "mastered",
              },
            ],
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
    if (!created.ok) throw new Error("Expected fight creation to succeed.");
    const state = {
      ...created.value.state,
      phase: "upkeep" as const,
      combatants: {
        ...created.value.state.combatants,
        [ghostId]: {
          ...created.value.state.combatants[ghostId],
          hitPoints: { current: 50, maximum: 117 },
          transformation: {
            transformationId: "transformation-humans-1-high-tension" as const,
            activatedOnTurn: 1,
            baseline: {
              maximumHitPoints: 100,
              hpBonus: 17,
              stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
            },
          },
        },
      },
    };
    const advanced = advanceFight(state, dependencies);
    if (!advanced.ok || advanced.value.state.status !== "active")
      throw new Error("Expected upkeep to advance.");
    expect(advanced.value.state.combatants[ghostId].transformation).toBeDefined();
    expect(advanced.value.events).not.toContainEqual(
      expect.objectContaining({ type: "transformation-rolled", combatantId: ghostId }),
    );
  });
});
