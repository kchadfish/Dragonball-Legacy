import { describe, expect, it } from "vitest";

import type { ActiveFightState, CreateFightInput, FightState } from "./index.js";
import {
  advanceFight,
  createFight,
  enumerateLegalDecisions,
  submitCombatDecision,
} from "./index.js";
import {
  activeEffectIdSchema,
  combatDecisionIdSchema,
  combatantIdSchema,
  combatEventIdSchema,
  fightIdSchema,
  pendingDecisionIdSchema,
  resolutionFrameIdSchema,
} from "./ids.js";
import { createTestCombatDependencies } from "./testing/index.js";

const attackerId = combatantIdSchema.parse("combatant:death-beam-user");
const defenderId = combatantIdSchema.parse("combatant:target");
const deathBeamId = "move-afterlife-death-beam";

const input: CreateFightInput = {
  mode: "spar",
  combatants: [
    {
      maximumHitPoints: 100,
      stats: { power: 20, dexterity: 5, dexterityBonus: 0 },
      moveIds: [deathBeamId],
    },
    {
      maximumHitPoints: 100,
      stats: { power: 20, dexterity: 4, dexterityBonus: 0 },
      moveIds: [deathBeamId],
    },
  ],
};

const dependencies = (randomValues: readonly number[]) =>
  createTestCombatDependencies(randomValues, new Date("2026-08-04T12:00:00.000Z"), {
    fightIds: [fightIdSchema.parse("fight:death-beam")],
    combatantIds: [attackerId, defenderId],
    activeEffectIds: [activeEffectIdSchema.parse("active-effect:death-beam-cost")],
    eventIds: Array.from({ length: 48 }, (_, index) =>
      combatEventIdSchema.parse(`event:death-${index + 1}`),
    ),
    pendingDecisionIds: [pendingDecisionIdSchema.parse("pending-decision:move-defense")],
    resolutionFrameIds: [resolutionFrameIdSchema.parse("resolution-frame:move-defense")],
  });

const success = <T>(result: { readonly ok: boolean; readonly value?: T }): T => {
  if (!result.ok || result.value === undefined)
    throw new Error("Expected a successful transition.");
  return result.value;
};

const active = (state: FightState): ActiveFightState => {
  if (state.status !== "active") throw new Error("Expected an active fight.");
  return state;
};

const actionState = (randomValues: readonly number[]) => {
  const deps = dependencies(randomValues);
  const fight = success(createFight(input, deps));
  return { deps, state: active(success(advanceFight(fight.state, deps)).state) };
};

const deathBeamDecision = (actorId: typeof attackerId | typeof defenderId, version: number) => ({
  type: "use-move" as const,
  id: combatDecisionIdSchema.parse(`decision:death-beam-${version}`),
  actorId,
  expectedStateVersion: version,
  moveId: deathBeamId,
  targetCombatantId: actorId === attackerId ? defenderId : attackerId,
});

describe("Death Beam advanced-attack slice", () => {
  it("enumerates and resolves another converted literal attack through the shared resolver", () => {
    const deps = dependencies([20, 1]);
    const genericFight = success(
      createFight(
        {
          ...input,
          combatants: [
            { ...input.combatants[0], moveIds: ["move-afterlife-light-grenade"] },
            input.combatants[1],
          ],
        },
        deps,
      ),
    );
    const state = active(success(advanceFight(genericFight.state, deps)).state);

    expect(enumerateLegalDecisions(state, attackerId)).toContainEqual({
      type: "use-move",
      actorId: attackerId,
      moveId: "move-afterlife-light-grenade",
      targetCombatantId: defenderId,
    });
    const transition = success(
      submitCombatDecision(
        state,
        {
          ...deathBeamDecision(attackerId, 1),
          id: combatDecisionIdSchema.parse("decision:light-grenade"),
          moveId: "move-afterlife-light-grenade",
        },
        deps,
      ),
    );

    expect(transition.state).toMatchObject({ version: 2, phase: "end" });
    expect(transition.state.combatants[attackerId].ki.current).toBe(3);
    expect(transition.state.combatants[defenderId].hitPoints.current).toBe(91);
    expect(transition.events.map((event) => event.type)).toEqual([
      "move-used",
      "ki-changed",
      "attack-rolled",
      "defense-rolled",
      "attack-resolved",
      "damage-applied",
      "phase-changed",
    ]);
  });

  it("pauses a converted attack for the defender to choose a defense response", () => {
    const deps = dependencies([20, 1]);
    const fight = success(
      createFight(
        {
          ...input,
          combatants: [
            { ...input.combatants[0], moveIds: ["move-afterlife-light-grenade"] },
            { ...input.combatants[1], moveIds: ["move-aoyosumu-defiant-stance"] },
          ],
        },
        deps,
      ),
    );
    const actionState = active(success(advanceFight(fight.state, deps)).state);
    const pending = success(
      submitCombatDecision(
        actionState,
        {
          ...deathBeamDecision(attackerId, 1),
          id: combatDecisionIdSchema.parse("decision:light-grenade-defense"),
          moveId: "move-afterlife-light-grenade",
        },
        deps,
      ),
    );
    if (pending.state.status !== "active")
      throw new Error("Expected active pending-defense state.");

    expect(pending.state.pendingDecision).toMatchObject({
      type: "defense-response",
      combatantId: defenderId,
      options: expect.arrayContaining([
        { id: "roll-defense", type: "roll-defense" },
        expect.objectContaining({
          id: "use-block:move-aoyosumu-defiant-stance",
          type: "use-block",
        }),
      ]),
    });
    const resolved = success(
      submitCombatDecision(
        pending.state,
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:roll-move-defense"),
          actorId: defenderId,
          expectedStateVersion: 2,
          pendingDecisionId: pendingDecisionIdSchema.parse("pending-decision:move-defense"),
          optionId: "roll-defense",
        },
        deps,
      ),
    );

    expect(resolved.state).toMatchObject({ version: 3, phase: "end" });
    expect(resolved.state.combatants[defenderId].hitPoints.current).toBe(91);
  });

  it("offers an energy-only Block against a physical attack with additive Energy classification", () => {
    const deps = dependencies([]);
    const fight = success(
      createFight(
        {
          ...input,
          combatants: [
            { ...input.combatants[0], moveIds: ["move-akaikaru-shock-fist"] },
            { ...input.combatants[1], moveIds: ["move-aoyosumu-blast-shield"] },
          ],
        },
        deps,
      ),
    );
    const actionState = active(success(advanceFight(fight.state, deps)).state);
    const transition = success(
      submitCombatDecision(
        actionState,
        {
          ...deathBeamDecision(attackerId, actionState.version),
          id: combatDecisionIdSchema.parse("decision:shock-fist-defense"),
          moveId: "move-akaikaru-shock-fist",
        },
        deps,
      ),
    );

    expect(transition.state).toMatchObject({
      version: actionState.version + 1,
      pendingDecision: {
        type: "defense-response",
        combatantId: defenderId,
        options: expect.arrayContaining([
          {
            id: "use-block:move-aoyosumu-blast-shield",
            type: "use-block",
            moveId: "move-aoyosumu-blast-shield",
          },
        ]),
      },
      resolutionFrames: [expect.objectContaining({ stage: "awaiting-defense" })],
    });
  });

  it("applies a selected converted Block to a converted attack and charges its derived cost", () => {
    const deps = dependencies([20]);
    const fight = success(
      createFight(
        {
          ...input,
          combatants: [
            { ...input.combatants[0], moveIds: ["move-afterlife-light-grenade"] },
            { ...input.combatants[1], moveIds: ["move-aoyosumu-defiant-stance"] },
          ],
        },
        deps,
      ),
    );
    const actionState = active(success(advanceFight(fight.state, deps)).state);
    const pending = success(
      submitCombatDecision(
        actionState,
        {
          ...deathBeamDecision(attackerId, 1),
          id: combatDecisionIdSchema.parse("decision:light-grenade-block"),
          moveId: "move-afterlife-light-grenade",
        },
        deps,
      ),
    );
    if (pending.state.status !== "active")
      throw new Error("Expected active pending-defense state.");
    const resolved = success(
      submitCombatDecision(
        pending.state,
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:block-move-defense"),
          actorId: defenderId,
          expectedStateVersion: 2,
          pendingDecisionId: pendingDecisionIdSchema.parse("pending-decision:move-defense"),
          optionId: "use-block:move-aoyosumu-defiant-stance",
        },
        deps,
      ),
    );

    expect(resolved.state).toMatchObject({ version: 3, phase: "end" });
    expect(resolved.state.combatants[attackerId].ki.current).toBe(3);
    expect(resolved.state.combatants[defenderId]).toMatchObject({
      hitPoints: { current: 100 },
      ki: { current: 4 },
      moveUses: { "move-aoyosumu-defiant-stance": 1 },
    });
    expect(resolved.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "move-used", moveId: "move-aoyosumu-defiant-stance" }),
        expect.objectContaining({ type: "attack-resolved", outcome: "stopped" }),
      ]),
    );
  });

  it("applies a converted successful status effect and enforces it at the affected turn's upkeep", () => {
    const deps = dependencies([20, 1, 20, 1, 20, 1, 20, 1, 20, 1, 20, 1]);
    const fight = success(
      createFight(
        {
          ...input,
          combatants: [
            { ...input.combatants[0], moveIds: ["move-afterlife-meteor-smash"] },
            input.combatants[1],
          ],
        },
        deps,
      ),
    );
    const actionState = active(success(advanceFight(fight.state, deps)).state);
    const attack = success(
      submitCombatDecision(
        actionState,
        {
          ...deathBeamDecision(attackerId, 1),
          id: combatDecisionIdSchema.parse("decision:meteor-smash"),
          moveId: "move-afterlife-meteor-smash",
        },
        deps,
      ),
    );
    if (attack.state.status !== "active") throw new Error("Expected active post-attack state.");

    expect(attack.state.combatants[defenderId]).toMatchObject({
      hitPoints: { current: 94 },
      activeStatuses: [expect.objectContaining({ statusId: "stun" })],
    });
    const defenderUpkeep = success(advanceFight(attack.state, deps));
    const skipped = success(advanceFight(defenderUpkeep.state, deps));
    expect(skipped.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "action-skipped", combatantId: defenderId }),
      ]),
    );
  });

  it("treats a turn-limited petrified status as an action blocker", () => {
    const { state, deps } = actionState([]);
    const petrified: ActiveFightState = {
      ...state,
      activeCombatantId: defenderId,
      phase: "upkeep",
      combatants: {
        ...state.combatants,
        [defenderId]: {
          ...state.combatants[defenderId],
          activeStatuses: [
            {
              statusId: "petrified",
              sourceCombatantId: attackerId,
              sourceDefinitionId: "move-afterlife-petrifying-spit",
              stacks: 1,
              duration: { type: "turns", ownerCombatantId: defenderId, remaining: 1 },
            },
          ],
        },
      },
    };
    const skipped = success(advanceFight(petrified, deps));
    expect(skipped.state).toMatchObject({ phase: "end" });
    expect(skipped.state.combatants[defenderId].activeStatuses).toHaveLength(1);
    const afterTurn = success(advanceFight(skipped.state, deps));
    expect(afterTurn.state.combatants[defenderId].activeStatuses).toEqual([]);
    expect(skipped.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "action-skipped",
          combatantId: defenderId,
          reason: "status",
        }),
      ]),
    );
  });

  it("enumerates Death Beam only when its owner is the active combatant", () => {
    const { state } = actionState([]);

    expect(enumerateLegalDecisions(state, attackerId)).toContainEqual({
      type: "use-move",
      actorId: attackerId,
      moveId: deathBeamId,
      targetCombatantId: defenderId,
    });
  });

  it("spends its literal cost, resolves 1d35 damage, and creates its successful-hit modifier", () => {
    const { state, deps } = actionState([15, 1]);
    const transition = success(submitCombatDecision(state, deathBeamDecision(attackerId, 1), deps));

    expect(transition.state).toMatchObject({ version: 2, phase: "end", eventSequence: 11 });
    expect(transition.state.combatants[attackerId].ki.current).toBe(4);
    expect(transition.state.combatants[attackerId].moveUses).toEqual({ [deathBeamId]: 1 });
    expect(transition.state.combatants[defenderId].hitPoints.current).toBe(93);
    expect(transition.state.activeEffects).toEqual([
      {
        id: activeEffectIdSchema.parse("active-effect:death-beam-cost"),
        type: "modify-ki-cost",
        sourceCombatantId: attackerId,
        targetCombatantId: defenderId,
        sourceDefinitionId: deathBeamId,
        amount: 1,
        selector: { category: "advanced-attack", baseKiCost: 1 },
        scope: "next-eligible-action",
      },
    ]);
    expect(transition.state.actionHistory).toEqual([
      expect.objectContaining({
        type: "use-move",
        actorId: attackerId,
        targetCombatantId: defenderId,
        moveId: deathBeamId,
      }),
    ]);
    expect(transition.events.map((event) => event.type)).toEqual([
      "move-used",
      "ki-changed",
      "attack-rolled",
      "defense-rolled",
      "attack-resolved",
      "damage-applied",
      "phase-changed",
      "effect-activated",
    ]);
  });

  it("applies and expires the modifier when the affected combatant uses its next eligible attack", () => {
    const { state, deps } = actionState([15, 1, 1, 15]);
    const firstAttack = success(
      submitCombatDecision(state, deathBeamDecision(attackerId, 1), deps),
    );
    const nextUpkeep = success(advanceFight(firstAttack.state, deps));
    const defenderAction = success(advanceFight(nextUpkeep.state, deps));
    const transition = success(
      submitCombatDecision(defenderAction.state, deathBeamDecision(defenderId, 4), deps),
    );

    expect(transition.state.combatants[defenderId].ki.current).toBe(3);
    expect(transition.state.activeEffects).toEqual([]);
    expect(transition.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "ki-changed", amount: -2, remainingKi: 3 }),
        expect.objectContaining({
          type: "effect-expired",
          activeEffectId: activeEffectIdSchema.parse("active-effect:death-beam-cost"),
        }),
      ]),
    );
  });

  it("rejects an unaffordable modified attack without consuming the effect", () => {
    const { state, deps } = actionState([15, 1]);
    const firstAttack = success(
      submitCombatDecision(state, deathBeamDecision(attackerId, 1), deps),
    );
    const nextUpkeep = success(advanceFight(firstAttack.state, deps));
    const defenderAction = active(success(advanceFight(nextUpkeep.state, deps)).state);
    const lowKiState: ActiveFightState = {
      ...defenderAction,
      combatants: {
        ...defenderAction.combatants,
        [defenderId]: { ...defenderAction.combatants[defenderId], ki: { current: 1, maximum: 10 } },
      },
    };

    expect(submitCombatDecision(lowKiState, deathBeamDecision(defenderId, 4), deps)).toEqual({
      ok: false,
      error: { type: "insufficient-ki", required: 2, available: 1 },
    });
    expect(lowKiState.activeEffects).toHaveLength(1);
  });

  it("ends the fight instead of retaining an unusable successful-hit modifier after a defeating hit", () => {
    const { state, deps } = actionState([20, 1]);
    const nearDefeatState: ActiveFightState = {
      ...state,
      combatants: {
        ...state.combatants,
        [defenderId]: {
          ...state.combatants[defenderId],
          hitPoints: { current: 7, maximum: 100 },
        },
      },
    };

    const transition = success(
      submitCombatDecision(nearDefeatState, deathBeamDecision(attackerId, 1), deps),
    );

    expect(transition.state).toMatchObject({
      status: "completed",
      completion: { type: "defeat", winnerCombatantId: attackerId },
      activeEffects: [],
    });
    expect(transition.events.map((event) => event.type)).toEqual([
      "move-used",
      "ki-changed",
      "attack-rolled",
      "defense-rolled",
      "attack-resolved",
      "damage-applied",
      "combatant-defeated",
      "fight-ended",
    ]);
  });

  it("returns typed failures for unknown and unowned move submissions", () => {
    const { state, deps } = actionState([]);

    expect(
      submitCombatDecision(
        state,
        { ...deathBeamDecision(attackerId, 1), moveId: "move-not-converted" },
        deps,
      ),
    ).toMatchObject({ ok: false, error: { type: "unknown-move", moveId: "move-not-converted" } });
    expect(
      submitCombatDecision(
        state,
        { ...deathBeamDecision(attackerId, 1), moveId: "move-freestyle-hidden-power-level" },
        deps,
      ),
    ).toMatchObject({
      ok: false,
      error: {
        type: "move-not-owned",
        moveId: "move-freestyle-hidden-power-level",
        combatantId: attackerId,
      },
    });
  });
});
