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
import type { ActiveEffectId } from "./ids.js";
import { createTestCombatDependencies } from "./testing/index.js";

const attackerId = combatantIdSchema.parse("combatant:attacker");
const defenderId = combatantIdSchema.parse("combatant:defender");

const input: CreateFightInput = {
  mode: "spar",
  combatants: [
    {
      maximumHitPoints: 100,
      stats: { power: 25, dexterity: 4, dexterityBonus: 1 },
      moveIds: ["move-freestyle-hidden-power-level"],
    },
    {
      maximumHitPoints: 100,
      stats: { power: 20, dexterity: 3, dexterityBonus: -1 },
      moveIds: ["move-afterlife-give-me-energy"],
    },
  ],
};

const createDependencies = (
  randomValues: readonly number[],
  activeEffectIds: readonly ActiveEffectId[] = [],
) =>
  createTestCombatDependencies(randomValues, new Date("2026-08-04T12:00:00.000Z"), {
    fightIds: [fightIdSchema.parse("fight:basic-attack")],
    combatantIds: [attackerId, defenderId],
    eventIds: Array.from({ length: 24 }, (_, index) =>
      combatEventIdSchema.parse(`event:basic-${index + 1}`),
    ),
    resolutionFrameIds: Array.from({ length: 4 }, (_, index) =>
      resolutionFrameIdSchema.parse(`resolution-frame:basic-counter-${index + 1}`),
    ),
    pendingDecisionIds: [pendingDecisionIdSchema.parse("pending-decision:basic-defense")],
    activeEffectIds,
  });

const requireTransition = <T>(result: { readonly ok: boolean; readonly value?: T }): T => {
  if (!result.ok || result.value === undefined)
    throw new Error("Expected a successful combat transition.");
  return result.value;
};

const requireActiveState = (state: FightState): ActiveFightState => {
  if (state.status !== "active") throw new Error("Expected an active fight state.");
  return state;
};

const createActionState = (
  randomValues: readonly number[],
  activeEffectIds: readonly ActiveEffectId[] = [],
) => {
  const dependencies = createDependencies(randomValues, activeEffectIds);
  const fight = requireTransition(createFight(input, dependencies));
  return {
    dependencies,
    state: requireActiveState(requireTransition(advanceFight(fight.state, dependencies)).state),
  };
};

describe("basic attacks", () => {
  it("applies and consumes each remaining item attack-damage bonus", () => {
    const { state, dependencies } = createActionState([10, 1]);
    const armed: ActiveFightState = {
      ...state,
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:item-damage"),
          type: "modify-item-next-attack-damage",
          sourceCombatantId: attackerId,
          targetCombatantId: attackerId,
          sourceDefinitionId: "item-equipment-enhanced-capsule-corp-fighting-jacket",
          amount: 3,
          remainingAttacks: 1,
        },
      ],
    };
    const transition = requireTransition(
      submitCombatDecision(
        armed,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:item-damage"),
          actorId: attackerId,
          expectedStateVersion: armed.version,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    expect(transition.events).toContainEqual(
      expect.objectContaining({ type: "damage-applied", amount: 6 }),
    );
    expect(requireActiveState(transition.state).activeEffects).toEqual([]);
  });

  it("prevents a matching KI cost reduction when the move declares a generic cost lock", () => {
    const dependencies = createDependencies(
      [10, 1],
      [activeEffectIdSchema.parse("active-effect:cost-reduction")],
    );
    const fight = requireTransition(
      createFight(
        {
          ...input,
          combatants: [
            {
              ...input.combatants[0],
              moveIds: [...input.combatants[0].moveIds, "move-kurokonwaku-spiked-ball"],
            },
            input.combatants[1],
          ],
        },
        dependencies,
      ),
    );
    const state = requireActiveState(
      requireTransition(advanceFight(fight.state, dependencies)).state,
    );
    const armed: ActiveFightState = {
      ...state,
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:cost-reduction"),
          type: "modify-ki-cost",
          sourceCombatantId: defenderId,
          targetCombatantId: attackerId,
          sourceDefinitionId: "move-afterlife-give-me-energy",
          amount: -1,
          selector: { category: "advanced-attack", baseKiCost: 2 },
          scope: "next-eligible-action",
        },
      ],
    };
    const transition = requireTransition(
      submitCombatDecision(
        armed,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:cost-prevention"),
          actorId: attackerId,
          expectedStateVersion: armed.version,
          moveId: "move-kurokonwaku-spiked-ball",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );

    expect(transition.events).toContainEqual(
      expect.objectContaining({ type: "ki-changed", combatantId: attackerId, amount: -2 }),
    );
  });

  it("applies serialized damage operations and preserves a nonmatching selector", () => {
    const { state, dependencies } = createActionState([10, 1, 10, 1]);
    const modified: ActiveFightState = {
      ...state,
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:damage-operation"),
          type: "modify-next-action",
          sourceCombatantId: attackerId,
          targetCombatantId: attackerId,
          sourceDefinitionId: "move-afterlife-give-me-energy",
          modifier: { type: "damage", operation: "multiply", amount: 50 },
        },
      ],
    };
    const multiplied = requireTransition(
      submitCombatDecision(
        modified,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:damage-operation"),
          actorId: attackerId,
          expectedStateVersion: modified.version,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    expect(multiplied.events).toContainEqual(
      expect.objectContaining({ type: "damage-applied", amount: 2 }),
    );

    const nonmatching: ActiveFightState = {
      ...state,
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:damage-selector"),
          type: "modify-next-action",
          sourceCombatantId: attackerId,
          targetCombatantId: attackerId,
          sourceDefinitionId: "move-afterlife-give-me-energy",
          selector: {
            type: "move-selector",
            subject: "source",
            category: "advanced-attack",
            sourceText: "advanced attacks only",
          },
          modifier: { type: "damage", amount: 20 },
        },
      ],
    };
    const unchanged = requireTransition(
      submitCombatDecision(
        nonmatching,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:damage-selector"),
          actorId: attackerId,
          expectedStateVersion: nonmatching.version,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    expect(unchanged.events).toContainEqual(
      expect.objectContaining({ type: "damage-applied", amount: 3 }),
    );
    expect(unchanged.state.activeEffects).toHaveLength(1);
  });

  it("enforces and consumes a serialized forced next-action constraint", () => {
    const { state, dependencies } = createActionState([]);
    const constrained: ActiveFightState = {
      ...state,
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:forced-action"),
          type: "force-next-action",
          sourceCombatantId: defenderId,
          targetCombatantId: attackerId,
          sourceDefinitionId: "move-aoyosumu-opportunist",
          allowedCategories: ["advanced-attack"],
          allowPass: true,
        },
      ],
    };
    expect(enumerateLegalDecisions(constrained, attackerId)).toEqual([
      { type: "pass", actorId: attackerId },
      { type: "surrender", actorId: attackerId },
    ]);

    const forbidden = submitCombatDecision(
      constrained,
      {
        type: "basic-attack",
        id: combatDecisionIdSchema.parse("decision:forced-basic"),
        actorId: attackerId,
        expectedStateVersion: constrained.version,
        basicAttack: "basic-punch",
        targetCombatantId: defenderId,
      },
      dependencies,
    );
    expect(forbidden).toMatchObject({ ok: false, error: { type: "illegal-decision" } });

    const passed = requireTransition(
      submitCombatDecision(
        constrained,
        {
          type: "pass",
          id: combatDecisionIdSchema.parse("decision:forced-pass"),
          actorId: attackerId,
          expectedStateVersion: constrained.version,
        },
        dependencies,
      ),
    );
    expect(requireActiveState(passed.state).activeEffects).toEqual([]);
  });

  it("applies and consumes a queued next-defense-roll modifier on the defender", () => {
    const { state, dependencies } = createActionState([10, 8]);
    const armed: ActiveFightState = {
      ...state,
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:defense-bonus"),
          type: "modify-next-action",
          sourceCombatantId: defenderId,
          targetCombatantId: defenderId,
          sourceDefinitionId: "move-freestyle-hidden-power-level",
          modifier: { type: "roll", roll: "defense", modifier: "result", amount: 5 },
        },
      ],
    };

    const result = submitCombatDecision(
      armed,
      {
        type: "basic-attack",
        id: combatDecisionIdSchema.parse("decision:basic-defense-bonus"),
        actorId: attackerId,
        expectedStateVersion: armed.version,
        basicAttack: "basic-punch",
        targetCombatantId: defenderId,
      },
      dependencies,
    );
    const transition = requireTransition(result);

    expect(transition.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "defense-rolled", naturalResult: 8, result: 12 }),
      ]),
    );
    expect(requireActiveState(transition.state).activeEffects).toEqual([]);
  });

  it("enumerates the three zero-Ki basic attacks for the active combatant", () => {
    const { state } = createActionState([]);

    expect(enumerateLegalDecisions(state, attackerId)).toEqual([
      {
        type: "basic-attack",
        actorId: attackerId,
        basicAttack: "basic-punch",
        targetCombatantId: defenderId,
      },
      {
        type: "basic-attack",
        actorId: attackerId,
        basicAttack: "basic-kick",
        targetCombatantId: defenderId,
      },
      {
        type: "basic-attack",
        actorId: attackerId,
        basicAttack: "basic-ki-blast",
        targetCombatantId: defenderId,
      },
      { type: "pass", actorId: attackerId },
      { type: "power-up", actorId: attackerId },
      { type: "surrender", actorId: attackerId },
    ]);
  });

  it("uses injected rolls and Dexterity Bonus, with a tie resolving as a successful attack", () => {
    const { state, dependencies } = createActionState([10, 12]);
    const decisionId = combatDecisionIdSchema.parse("decision:basic-punch");
    const transition = requireTransition(
      submitCombatDecision(
        state,
        {
          type: "basic-attack",
          id: decisionId,
          actorId: attackerId,
          expectedStateVersion: 1,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );

    expect(transition).toEqual({
      state: expect.objectContaining({ version: 2, phase: "end", eventSequence: 8 }),
      events: [
        expect.objectContaining({
          type: "attack-rolled",
          sequence: 4,
          naturalResult: 10,
          result: 11,
          basicAttack: "basic-punch",
          causedByDecisionId: decisionId,
        }),
        expect.objectContaining({
          type: "defense-rolled",
          sequence: 5,
          naturalResult: 12,
          result: 11,
          causedByDecisionId: decisionId,
        }),
        expect.objectContaining({ type: "attack-resolved", sequence: 6, outcome: "successful" }),
        expect.objectContaining({
          type: "damage-applied",
          sequence: 7,
          amount: 3,
          remainingHitPoints: 97,
        }),
        expect.objectContaining({ type: "phase-changed", sequence: 8, phase: "end" }),
      ],
    });
    expect(transition.state.actionHistory).toEqual([
      {
        type: "basic-attack",
        decisionId,
        actorId: attackerId,
        targetCombatantId: defenderId,
        basicAttack: "basic-punch",
        turnNumber: 1,
        phase: "action",
      },
    ]);
  });

  it("records a stopped attack without applying damage", () => {
    const { state, dependencies } = createActionState([5, 10]);
    const transition = requireTransition(
      submitCombatDecision(
        state,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:stopped-kick"),
          actorId: attackerId,
          expectedStateVersion: 1,
          basicAttack: "basic-kick",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );

    expect(transition.state).toMatchObject({ version: 2, phase: "end", eventSequence: 7 });
    expect(transition.state.combatants[defenderId].hitPoints.current).toBe(100);
    expect(transition.events).toEqual([
      expect.objectContaining({ type: "attack-rolled" }),
      expect.objectContaining({ type: "defense-rolled" }),
      expect.objectContaining({ type: "attack-resolved", outcome: "stopped" }),
      expect.objectContaining({ type: "phase-changed", phase: "end" }),
    ]);
  });

  it("applies stacked BREAK and SEVER outgoing-damage penalties", () => {
    const { state, dependencies } = createActionState([20, 1]);
    const impairedState: ActiveFightState = {
      ...state,
      combatants: {
        ...state.combatants,
        [attackerId]: {
          ...state.combatants[attackerId],
          stats: { ...state.combatants[attackerId].stats, power: 100 },
          activeStatuses: [
            {
              statusId: "break",
              sourceCombatantId: defenderId,
              sourceDefinitionId: "move-test-break",
              stacks: 1,
              duration: { type: "combat" },
            },
            {
              statusId: "sever",
              sourceCombatantId: defenderId,
              sourceDefinitionId: "move-test-sever",
              stacks: 1,
              duration: { type: "combat" },
            },
          ],
        },
      },
    };
    const transition = requireTransition(
      submitCombatDecision(
        impairedState,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:impaired-punch"),
          actorId: attackerId,
          expectedStateVersion: 1,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    expect(transition.events).toContainEqual(
      expect.objectContaining({ type: "damage-applied", amount: 7, remainingHitPoints: 93 }),
    );
  });

  it("applies and emits converted combat statuses from a successful move", () => {
    const dependencies = createDependencies([29, 1]);
    const fight = requireTransition(
      createFight(
        {
          ...input,
          combatants: [
            { ...input.combatants[0], moveIds: ["move-afterlife-ki-blade-rush"] },
            input.combatants[1],
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveState(
      requireTransition(advanceFight(fight.state, dependencies)).state,
    );
    const transition = requireTransition(
      submitCombatDecision(
        action,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:ki-blade-rush"),
          actorId: attackerId,
          expectedStateVersion: action.version,
          moveId: "move-afterlife-ki-blade-rush",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    expect(transition.state.combatants[defenderId].activeStatuses).toEqual([
      expect.objectContaining({ statusId: "sever", stacks: 1 }),
    ]);
    expect(transition.events).toContainEqual(
      expect.objectContaining({ type: "status-applied", statusId: "sever" }),
    );
  });

  it("activates a CONSTANT Skill through the combat decision boundary", () => {
    const dependencies = createTestCombatDependencies([], new Date("2026-08-06T12:00:00.000Z"), {
      fightIds: [fightIdSchema.parse("fight:constant-skill")],
      combatantIds: [attackerId, defenderId],
      activeEffectIds: ["active-effect:close-shave" as never],
      eventIds: Array.from({ length: 8 }, (_, index) =>
        combatEventIdSchema.parse(`event:constant-${index + 1}`),
      ),
    });
    const fight = requireTransition(
      createFight(
        {
          ...input,
          combatants: [
            { ...input.combatants[0], moveIds: ["move-aoyosumu-close-shave"] },
            input.combatants[1],
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveState(
      requireTransition(advanceFight(fight.state, dependencies)).state,
    );
    expect(enumerateLegalDecisions(action, attackerId)).toContainEqual({
      type: "use-move",
      actorId: attackerId,
      moveId: "move-aoyosumu-close-shave",
      targetCombatantId: defenderId,
    });
    const activated = requireTransition(
      submitCombatDecision(
        action,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:activate-close-shave"),
          actorId: attackerId,
          expectedStateVersion: action.version,
          moveId: "move-aoyosumu-close-shave",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    expect(activated.state).toMatchObject({
      phase: "end",
      activeEffects: [
        {
          type: "active-constant",
          sourceDefinitionId: "move-aoyosumu-close-shave",
          activatedOnTurn: 1,
        },
      ],
      combatants: {
        [attackerId]: {
          ki: { current: 4 },
          moveUses: { "move-aoyosumu-close-shave": 1 },
        },
      },
    });
    expect(activated.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "effect-activated",
          sourceDefinitionId: "move-aoyosumu-close-shave",
        }),
        expect.objectContaining({ type: "phase-changed", phase: "end" }),
      ]),
    );
  });

  it("applies an active Close Shave equal-roll stop after persisted defense dice", () => {
    const dependencies = createTestCombatDependencies(
      [10, 12],
      new Date("2026-08-06T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:close-shave-stop")],
        combatantIds: [attackerId, defenderId],
        eventIds: Array.from({ length: 16 }, (_, index) =>
          combatEventIdSchema.parse(`event:close-shave-${index + 1}`),
        ),
        pendingDecisionIds: [
          pendingDecisionIdSchema.parse("pending-decision:close-shave-defense"),
          pendingDecisionIdSchema.parse("pending-decision:close-shave-post-roll"),
        ],
        resolutionFrameIds: [
          resolutionFrameIdSchema.parse("resolution-frame:close-shave-defense"),
          resolutionFrameIdSchema.parse("resolution-frame:close-shave-post-roll"),
        ],
      },
    );
    const fight = requireTransition(
      createFight(
        {
          ...input,
          combatants: [
            input.combatants[0],
            { ...input.combatants[1], moveIds: ["move-aoyosumu-close-shave"] },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveState(
      requireTransition(advanceFight(fight.state, dependencies)).state,
    );
    const armed: ActiveFightState = {
      ...action,
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:close-shave"),
          type: "active-constant",
          sourceCombatantId: defenderId,
          targetCombatantId: defenderId,
          sourceDefinitionId: "move-aoyosumu-close-shave",
          activatedOnTurn: 1,
          duration: "combat",
        },
      ],
    };
    const declared = requireTransition(
      submitCombatDecision(
        armed,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:close-shave-attack"),
          actorId: attackerId,
          expectedStateVersion: armed.version,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    const defense = requireActiveState(declared.state).pendingDecision;
    if (defense === undefined) throw new Error("Expected a defense decision.");
    const rolled = requireTransition(
      submitCombatDecision(
        declared.state,
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:close-shave-roll"),
          actorId: defenderId,
          expectedStateVersion: declared.state.version,
          pendingDecisionId: defense.id,
          optionId: "roll-defense",
        },
        dependencies,
      ),
    );
    const post = requireActiveState(rolled.state).pendingDecision;
    if (post === undefined) throw new Error("Expected post-defense resolution.");
    expect(post.options).toContainEqual({
      id: "activate-move:move-aoyosumu-close-shave:1",
      type: "activate-effect",
      moveId: "move-aoyosumu-close-shave",
    });
    expect(requireActiveState(rolled.state).resolutionFrames).toEqual([
      expect.objectContaining({ resultOverrides: ["stopped"] }),
    ]);
    const resolved = requireTransition(
      submitCombatDecision(
        rolled.state,
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:close-shave-boost"),
          actorId: defenderId,
          expectedStateVersion: rolled.state.version,
          pendingDecisionId: post.id,
          optionId: "activate-move:move-aoyosumu-close-shave:1",
        },
        dependencies,
      ),
    );
    expect(resolved.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "ki-changed", amount: -1, remainingKi: 4 }),
        expect.objectContaining({ type: "attack-resolved", outcome: "stopped" }),
      ]),
    );
    expect(resolved.state.combatants[defenderId].hitPoints.current).toBe(100);
    expect(resolved.state.combatants[defenderId].ki.current).toBe(4);
  });

  it("applies the higher-Dexterity critical threshold to a single-die basic attack", () => {
    const { state, dependencies } = createActionState([29, 1]);
    const transition = requireTransition(
      submitCombatDecision(
        state,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:critical-punch"),
          actorId: attackerId,
          expectedStateVersion: 1,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );

    expect(transition.state.combatants[defenderId].hitPoints.current).toBe(94);
  });

  it("suppresses a prevented critical result before applying basic-attack damage", () => {
    const { state, dependencies } = createActionState([29, 1]);
    const prevented: ActiveFightState = {
      ...state,
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:prevent-critical"),
          type: "prevent-combat-result",
          sourceCombatantId: defenderId,
          targetCombatantId: attackerId,
          sourceDefinitionId: "move-aoyosumu-return-fire",
          result: "critical",
          duration: { type: "combat" },
        },
      ],
    };
    const transition = requireTransition(
      submitCombatDecision(
        prevented,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:prevented-critical-punch"),
          actorId: attackerId,
          expectedStateVersion: prevented.version,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );

    expect(transition.state.combatants[defenderId].hitPoints.current).toBe(97);
  });

  it("prevents matching active roll modifiers and expires after its target's declared turn", () => {
    const { state, dependencies } = createActionState([10, 1]);
    const prevented: ActiveFightState = {
      ...state,
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:next-attack-bonus"),
          type: "modify-next-action",
          sourceCombatantId: attackerId,
          targetCombatantId: attackerId,
          sourceDefinitionId: "move-afterlife-final-spirit-cannon",
          modifier: { type: "roll", roll: "attack", modifier: "result", amount: 5 },
        },
        {
          id: activeEffectIdSchema.parse("active-effect:prevent-attack-results"),
          type: "prevent-roll-modification",
          sourceCombatantId: defenderId,
          targetCombatantId: attackerId,
          sourceDefinitionId: "move-aoyosumu-elevated-kick",
          roll: "attack",
          modifier: "result",
          duration: { type: "turns", ownerCombatantId: attackerId, remaining: 1 },
        },
      ],
    };
    const attack = requireTransition(
      submitCombatDecision(
        prevented,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:prevent-attack-roll-modifier"),
          actorId: attackerId,
          expectedStateVersion: prevented.version,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );

    expect(attack.events).toContainEqual(
      expect.objectContaining({ type: "attack-rolled", naturalResult: 10, result: 11 }),
    );
    const afterOwnerTurn = requireTransition(advanceFight(attack.state, dependencies));
    expect(requireActiveState(afterOwnerTurn.state).activeEffects).toEqual([]);
  });

  it("allows the declared source-effect exemption while preventing other roll modifiers", () => {
    const { state, dependencies } = createActionState([10, 1]);
    const exempted: ActiveFightState = {
      ...state,
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:exempt-attack-bonus"),
          type: "modify-next-action",
          sourceCombatantId: attackerId,
          targetCombatantId: attackerId,
          sourceDefinitionId: "move-afterlife-four-arms",
          modifier: { type: "roll", roll: "attack", modifier: "result", amount: 5 },
        },
        {
          id: activeEffectIdSchema.parse("active-effect:exempt-prevention"),
          type: "prevent-roll-modification",
          sourceCombatantId: attackerId,
          targetCombatantId: attackerId,
          sourceDefinitionId: "move-afterlife-four-arms",
          roll: "attack",
          modifier: "result",
          exemptSourceEffect: true,
          duration: { type: "combat" },
        },
      ],
    };

    const attack = requireTransition(
      submitCombatDecision(
        exempted,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:exempt-roll-modifier"),
          actorId: attackerId,
          expectedStateVersion: exempted.version,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );

    expect(attack.events).toContainEqual(
      expect.objectContaining({ type: "attack-rolled", naturalResult: 10, result: 16 }),
    );
  });

  it("consumes counted next-roll modifiers per matching defense roll", () => {
    const { state, dependencies } = createActionState([10, 1, 10, 1]);
    const armed: ActiveFightState = {
      ...state,
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:counted-defense-rolls"),
          type: "modify-next-action",
          sourceCombatantId: attackerId,
          targetCombatantId: defenderId,
          sourceDefinitionId: "move-aoyosumu-bullwhip",
          scope: "next-rolls",
          remaining: 2,
          modifier: { type: "roll", roll: "defense", modifier: "result", amount: 3 },
        },
      ],
    };
    const first = requireTransition(
      submitCombatDecision(
        armed,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:counted-defense-roll-1"),
          actorId: attackerId,
          expectedStateVersion: armed.version,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    expect(first.events).toContainEqual(
      expect.objectContaining({ type: "defense-rolled", naturalResult: 1, result: 3 }),
    );
    expect(first.state.activeEffects).toEqual([
      expect.objectContaining({ scope: "next-rolls", remaining: 1 }),
    ]);

    const second = requireTransition(
      submitCombatDecision(
        { ...requireActiveState(first.state), phase: "action" },
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:counted-defense-roll-2"),
          actorId: attackerId,
          expectedStateVersion: first.state.version,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    expect(second.events).toContainEqual(
      expect.objectContaining({ type: "defense-rolled", naturalResult: 1, result: 3 }),
    );
    expect(second.state.activeEffects).toEqual([]);
  });

  it("consumes counted next-action roll modifiers once per matching action", () => {
    const { state, dependencies } = createActionState([10, 1, 10, 1]);
    const armed: ActiveFightState = {
      ...state,
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:counted-attack-actions"),
          type: "modify-next-action",
          sourceCombatantId: attackerId,
          targetCombatantId: attackerId,
          sourceDefinitionId: "move-afterlife-big-bang-attack",
          scope: "next-actions",
          remaining: 2,
          modifier: { type: "roll", roll: "attack", modifier: "result", amount: 4 },
        },
      ],
    };
    const first = requireTransition(
      submitCombatDecision(
        armed,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:counted-attack-action-1"),
          actorId: attackerId,
          expectedStateVersion: armed.version,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    expect(first.events).toContainEqual(
      expect.objectContaining({ type: "attack-rolled", naturalResult: 10, result: 15 }),
    );
    expect(first.state.activeEffects).toEqual([
      expect.objectContaining({ scope: "next-actions", remaining: 1 }),
    ]);

    const second = requireTransition(
      submitCombatDecision(
        { ...requireActiveState(first.state), phase: "action" },
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:counted-attack-action-2"),
          actorId: attackerId,
          expectedStateVersion: first.state.version,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    expect(second.events).toContainEqual(
      expect.objectContaining({ type: "attack-rolled", naturalResult: 10, result: 15 }),
    );
    expect(second.state.activeEffects).toEqual([]);
  });

  it("holds a following-action roll modifier until its recorded turn", () => {
    const { state, dependencies } = createActionState([10, 1, 10, 1]);
    const armed: ActiveFightState = {
      ...state,
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:delayed-attack-roll"),
          type: "modify-next-action",
          sourceCombatantId: attackerId,
          targetCombatantId: attackerId,
          sourceDefinitionId: "move-afterlife-big-bang-attack",
          scope: "following-action",
          availableFromTurn: state.turnNumber + 1,
          modifier: { type: "roll", roll: "attack", modifier: "result", amount: 4 },
        },
      ],
    };
    const first = requireTransition(
      submitCombatDecision(
        armed,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:delayed-attack-roll-1"),
          actorId: attackerId,
          expectedStateVersion: armed.version,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    expect(first.events).toContainEqual(
      expect.objectContaining({ type: "attack-rolled", naturalResult: 10, result: 11 }),
    );
    expect(first.state.activeEffects).toEqual([
      expect.objectContaining({
        scope: "following-action",
        availableFromTurn: state.turnNumber + 1,
      }),
    ]);

    const second = requireTransition(
      submitCombatDecision(
        {
          ...requireActiveState(first.state),
          phase: "action",
          turnNumber: state.turnNumber + 1,
        },
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:delayed-attack-roll-2"),
          actorId: attackerId,
          expectedStateVersion: first.state.version,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    expect(second.events).toContainEqual(
      expect.objectContaining({ type: "attack-rolled", naturalResult: 10, result: 15 }),
    );
    expect(second.state.activeEffects).toEqual([]);
  });

  it("retains a selector-scoped roll modifier when the next attack does not match", () => {
    const { state, dependencies } = createActionState([10, 1]);
    const armed: ActiveFightState = {
      ...state,
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:selector-scoped-roll"),
          type: "modify-next-action",
          sourceCombatantId: attackerId,
          targetCombatantId: attackerId,
          sourceDefinitionId: "move-afterlife-sword-blast",
          scope: "next-roll",
          selector: {
            type: "move-selector",
            subject: "target",
            category: "advanced-attack",
            sourceText: "next advanced attack",
          },
          modifier: { type: "roll", roll: "attack", modifier: "result", amount: 5 },
        },
      ],
    };
    const attack = requireTransition(
      submitCombatDecision(
        armed,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:selector-scoped-basic"),
          actorId: attackerId,
          expectedStateVersion: armed.version,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    expect(attack.events).toContainEqual(
      expect.objectContaining({ type: "attack-rolled", naturalResult: 10, result: 11 }),
    );
    expect(attack.state.activeEffects).toEqual([
      expect.objectContaining({
        scope: "next-roll",
        modifier: expect.objectContaining({ amount: 5 }),
      }),
    ]);
  });

  it("prevents a same-action converted roll modifier before the roll is resolved", () => {
    const { state, dependencies } = createActionState([10, 1]);
    const prevented: ActiveFightState = {
      ...state,
      turnNumber: 10,
      combatants: {
        ...state.combatants,
        [attackerId]: {
          ...state.combatants[attackerId],
          moveIds: ["move-afterlife-final-spirit-cannon"],
          ki: {
            ...state.combatants[attackerId].ki,
            current: state.combatants[attackerId].ki.maximum,
          },
        },
      },
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:current-roll-prevention"),
          type: "prevent-roll-modification",
          sourceCombatantId: defenderId,
          targetCombatantId: attackerId,
          sourceDefinitionId: "move-aoyosumu-elevated-kick",
          roll: "attack",
          modifier: "result",
          duration: { type: "combat" },
        },
      ],
    };
    const rawAttack = submitCombatDecision(
      prevented,
      {
        type: "use-move",
        id: combatDecisionIdSchema.parse("decision:current-roll-prevention"),
        actorId: attackerId,
        expectedStateVersion: prevented.version,
        moveId: "move-afterlife-final-spirit-cannon",
        targetCombatantId: defenderId,
      },
      dependencies,
    );
    if (!rawAttack.ok) throw new Error(JSON.stringify(rawAttack.error));
    const attack = rawAttack.value;
    expect(attack.events).toContainEqual(
      expect.objectContaining({ type: "attack-rolled", naturalResult: 10, result: 11 }),
    );
  });

  it("activates and persists a counted converted roll-modification prevention", () => {
    const { state, dependencies } = createActionState(
      [20, 1],
      [
        activeEffectIdSchema.parse("active-effect:big-bang-critical"),
        activeEffectIdSchema.parse("active-effect:big-bang-prevention"),
      ],
    );
    const ready: ActiveFightState = {
      ...state,
      turnNumber: 10,
      combatants: {
        ...state.combatants,
        [attackerId]: {
          ...state.combatants[attackerId],
          moveIds: ["move-afterlife-big-bang-attack"],
          ki: {
            ...state.combatants[attackerId].ki,
            current: state.combatants[attackerId].ki.maximum,
          },
        },
      },
    };
    const attack = requireTransition(
      submitCombatDecision(
        ready,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:activate-roll-prevention"),
          actorId: attackerId,
          expectedStateVersion: ready.version,
          moveId: "move-afterlife-big-bang-attack",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    expect(attack.state.activeEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "prevent-roll-modification",
          targetCombatantId: defenderId,
          roll: "attack",
          modifier: "sides",
          duration: expect.objectContaining({ type: "next-actions", remaining: 2 }),
        }),
      ]),
    );
  });

  it("enforces passive constant-skill prevention against an opponent modifier", () => {
    const { state, dependencies } = createActionState([10, 1, 1]);
    const passive: ActiveFightState = {
      ...state,
      combatants: {
        ...state.combatants,
        [attackerId]: {
          ...state.combatants[attackerId],
          moveIds: ["move-freestyle-monkey-maneuvers", "move-freestyle-monkey-sweep"],
        },
      },
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:monkey-maneuvers"),
          type: "active-constant",
          sourceCombatantId: attackerId,
          targetCombatantId: attackerId,
          sourceDefinitionId: "move-freestyle-monkey-maneuvers",
          activatedOnTurn: state.turnNumber,
          duration: "combat",
          lifecycle: "active",
        },
        {
          id: activeEffectIdSchema.parse("active-effect:opponent-roll-reduction"),
          type: "modify-next-action",
          sourceCombatantId: defenderId,
          targetCombatantId: attackerId,
          sourceDefinitionId: "move-afterlife-final-spirit-cannon",
          modifier: { type: "roll", roll: "attack", modifier: "result", amount: -5 },
        },
      ],
    };
    const attack = requireTransition(
      submitCombatDecision(
        passive,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:passive-roll-prevention"),
          actorId: attackerId,
          expectedStateVersion: passive.version,
          moveId: "move-freestyle-monkey-sweep",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );

    expect(attack.events).toContainEqual(
      expect.objectContaining({ type: "attack-rolled", naturalResult: 10, result: 11 }),
    );
  });

  it("applies an active constant skill's generic passive damage modifier to a basic attack", () => {
    const { state, dependencies } = createActionState([10, 1]);
    const armed: ActiveFightState = {
      ...state,
      combatants: {
        ...state.combatants,
        [attackerId]: {
          ...state.combatants[attackerId],
          moveIds: ["move-midorikatai-energy-gorged"],
        },
      },
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:energy-gorged-damage"),
          type: "active-constant",
          sourceCombatantId: attackerId,
          targetCombatantId: attackerId,
          sourceDefinitionId: "move-midorikatai-energy-gorged",
          activatedOnTurn: state.turnNumber,
          duration: "combat",
          lifecycle: "active",
        },
      ],
    };

    const attack = requireTransition(
      submitCombatDecision(
        armed,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:energy-gorged-damage"),
          actorId: attackerId,
          expectedStateVersion: armed.version,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );

    expect(attack.events).toContainEqual(
      expect.objectContaining({ type: "damage-applied", amount: 6 }),
    );
  });

  it("enters Counter phase after a qualifying stopped defense and then resumes End phase", () => {
    const { state, dependencies } = createActionState([5, 30, 5, 10]);
    const counterTransition = requireTransition(
      submitCombatDecision(
        state,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:countered-punch"),
          actorId: attackerId,
          expectedStateVersion: 1,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );

    expect(counterTransition.state).toMatchObject({
      phase: "counter",
      activeCombatantId: defenderId,
      resolutionFrames: [
        expect.objectContaining({
          type: "attack",
          stage: "awaiting-counter",
          targetCombatantId: defenderId,
        }),
      ],
    });
    const counterAttack = requireTransition(
      submitCombatDecision(
        counterTransition.state,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:counter-kick"),
          actorId: defenderId,
          expectedStateVersion: 2,
          basicAttack: "basic-kick",
          targetCombatantId: attackerId,
        },
        dependencies,
      ),
    );
    expect(counterAttack.state).toMatchObject({ phase: "end", resolutionFrames: [] });
  });

  it("pauses for a defender-owned Block and resolves the selected converted Block", () => {
    const { state, dependencies } = createActionState([12]);
    const blockState: ActiveFightState = {
      ...state,
      combatants: {
        ...state.combatants,
        [defenderId]: {
          ...state.combatants[defenderId],
          moveIds: ["move-aoyosumu-defiant-stance"],
        },
      },
    };
    const declared = requireTransition(
      submitCombatDecision(
        blockState,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:blocked-punch"),
          actorId: attackerId,
          expectedStateVersion: 1,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );

    const pending = requireActiveState(declared.state);
    expect(pending).toMatchObject({
      version: 2,
      pendingDecision: {
        id: pendingDecisionIdSchema.parse("pending-decision:basic-defense"),
        combatantId: defenderId,
        type: "defense-response",
        options: expect.arrayContaining([
          { id: "roll-defense", type: "roll-defense" },
          {
            id: "use-block:move-aoyosumu-defiant-stance",
            type: "use-block",
            moveId: "move-aoyosumu-defiant-stance",
          },
        ]),
      },
      resolutionFrames: [expect.objectContaining({ stage: "awaiting-defense" })],
    });
    expect(declared.events).toEqual([
      expect.objectContaining({ type: "defense-requested", defenderCombatantId: defenderId }),
    ]);

    const resolved = requireTransition(
      submitCombatDecision(
        declared.state,
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:defiant-stance"),
          actorId: defenderId,
          expectedStateVersion: 2,
          pendingDecisionId: pendingDecisionIdSchema.parse("pending-decision:basic-defense"),
          optionId: "use-block:move-aoyosumu-defiant-stance",
        },
        dependencies,
      ),
    );

    expect(resolved.state).toMatchObject({
      version: 3,
      phase: "end",
      resolutionFrames: [],
    });
    expect(resolved.state.status === "active" && resolved.state.pendingDecision).toBeUndefined();
    expect(resolved.state.combatants[defenderId]).toMatchObject({
      ki: { current: 4, maximum: 10 },
      moveUses: { "move-aoyosumu-defiant-stance": 1 },
    });
    expect(resolved.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "attack-rolled", naturalResult: 12 }),
        expect.objectContaining({ type: "move-used", moveId: "move-aoyosumu-defiant-stance" }),
        expect.objectContaining({ type: "attack-resolved", outcome: "stopped" }),
      ]),
    );
  });

  it("keeps defensive rolling available while suppressing Blocks for a move's passive prevention", () => {
    const { state, dependencies } = createActionState([12]);
    const blockState: ActiveFightState = {
      ...state,
      combatants: {
        ...state.combatants,
        [attackerId]: {
          ...state.combatants[attackerId],
          moveIds: ["move-haokiru-indestructible-wave"],
        },
        [defenderId]: {
          ...state.combatants[defenderId],
          moveIds: ["move-aoyosumu-defiant-stance"],
        },
      },
    };

    const declared = requireTransition(
      submitCombatDecision(
        blockState,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:indestructible-wave"),
          actorId: attackerId,
          expectedStateVersion: blockState.version,
          moveId: "move-haokiru-indestructible-wave",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );

    const pending = requireActiveState(declared.state);
    expect(pending).toMatchObject({
      pendingDecision: {
        combatantId: defenderId,
        type: "defense-response",
        options: [{ id: "roll-defense", type: "roll-defense" }],
      },
    });
    expect(pending.pendingDecision?.options).not.toContainEqual(
      expect.objectContaining({ type: "use-block" }),
    );
  });

  it("applies immediate structured Block effects before ending the suspended attack", () => {
    const { state, dependencies } = createActionState([12]);
    const blockState: ActiveFightState = {
      ...state,
      combatants: {
        ...state.combatants,
        [defenderId]: {
          ...state.combatants[defenderId],
          moveIds: ["move-aoyosumu-screening"],
        },
      },
    };
    const declared = requireTransition(
      submitCombatDecision(
        blockState,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:screened-punch"),
          actorId: attackerId,
          expectedStateVersion: 1,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    const pending = requireActiveState(declared.state).pendingDecision;
    if (pending === undefined) throw new Error("Expected a Block decision.");
    const resolved = requireTransition(
      submitCombatDecision(
        declared.state,
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:screening"),
          actorId: defenderId,
          expectedStateVersion: declared.state.version,
          pendingDecisionId: pending.id,
          optionId: "use-block:move-aoyosumu-screening",
        },
        dependencies,
      ),
    );
    expect(resolved.state.combatants[defenderId]).toMatchObject({
      ki: { current: 6, maximum: 10 },
      moveUses: { "move-aoyosumu-screening": 1 },
    });
    expect(resolved.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "ki-changed", amount: -1 }),
        expect.objectContaining({ type: "ki-changed", amount: 2, remainingKi: 6 }),
      ]),
    );
  });

  it("offers, accepts, and deterministically resumes an after-roll defense reaction", () => {
    const dependencies = createTestCombatDependencies(
      [10, 11],
      new Date("2026-08-06T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:post-roll-defense")],
        combatantIds: [attackerId, defenderId],
        eventIds: Array.from({ length: 16 }, (_, index) =>
          combatEventIdSchema.parse(`event:post-roll-${index + 1}`),
        ),
        pendingDecisionIds: [
          pendingDecisionIdSchema.parse("pending-decision:initial-defense"),
          pendingDecisionIdSchema.parse("pending-decision:post-roll-defense"),
        ],
        resolutionFrameIds: [
          resolutionFrameIdSchema.parse("resolution-frame:initial-defense"),
          resolutionFrameIdSchema.parse("resolution-frame:post-roll-defense"),
        ],
      },
    );
    const fight = requireTransition(
      createFight(
        {
          ...input,
          combatants: [
            input.combatants[0],
            { ...input.combatants[1], itemIds: ["item-equipment-heroic-tunic"] },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveState(
      requireTransition(advanceFight(fight.state, dependencies)).state,
    );
    const declared = requireTransition(
      submitCombatDecision(
        action,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:post-roll-attack"),
          actorId: attackerId,
          expectedStateVersion: action.version,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    const defensePending = requireActiveState(declared.state).pendingDecision;
    if (defensePending === undefined) throw new Error("Expected a defense decision.");
    const rolled = requireTransition(
      submitCombatDecision(
        declared.state,
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:roll-defense"),
          actorId: defenderId,
          expectedStateVersion: declared.state.version,
          pendingDecisionId: defensePending.id,
          optionId: "roll-defense",
        },
        dependencies,
      ),
    );
    const reaction = requireActiveState(rolled.state).pendingDecision;
    expect(rolled).toMatchObject({
      state: {
        phase: "action",
        pendingDecision: {
          type: "post-defense-roll",
          options: expect.arrayContaining([
            { id: "decline", type: "decline" },
            {
              id: "activate-item:item-equipment-heroic-tunic",
              type: "activate-effect",
              itemId: "item-equipment-heroic-tunic",
            },
          ]),
        },
        resolutionFrames: [
          expect.objectContaining({
            stage: "awaiting-post-defense-reaction",
            naturalRolls: [{ attack: 10, defense: 11 }],
          }),
        ],
      },
      events: [
        expect.objectContaining({ type: "attack-rolled", naturalResult: 10, result: 11 }),
        expect.objectContaining({ type: "defense-rolled", naturalResult: 11, result: 10 }),
      ],
    });
    if (reaction === undefined) throw new Error("Expected an after-roll reaction.");

    const resumed = requireTransition(
      submitCombatDecision(
        rolled.state,
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:activate-heroic-tunic"),
          actorId: defenderId,
          expectedStateVersion: rolled.state.version,
          pendingDecisionId: reaction.id,
          optionId: "activate-item:item-equipment-heroic-tunic",
        },
        dependencies,
      ),
    );
    expect(resumed.events).toEqual([
      expect.objectContaining({ type: "item-used", itemId: "item-equipment-heroic-tunic" }),
      expect.objectContaining({ type: "ki-changed", amount: -1, remainingKi: 4 }),
      expect.objectContaining({ type: "attack-resolved", outcome: "stopped" }),
      expect.objectContaining({ type: "phase-changed", phase: "end" }),
    ]);
    expect(resumed.state).toMatchObject({
      phase: "end",
      resolutionFrames: [],
      combatants: {
        [defenderId]: {
          ki: { current: 4 },
          itemUses: { "item-equipment-heroic-tunic": 1 },
          hitPoints: { current: 112 },
        },
      },
    });
  });

  it("replays every die of a multi-die move after an after-roll defense reaction", () => {
    const dependencies = createTestCombatDependencies(
      [10, 11, 10, 11, 10, 11],
      new Date("2026-08-06T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:post-roll-move")],
        combatantIds: [attackerId, defenderId],
        eventIds: Array.from({ length: 24 }, (_, index) =>
          combatEventIdSchema.parse(`event:post-roll-move-${index + 1}`),
        ),
        pendingDecisionIds: [
          pendingDecisionIdSchema.parse("pending-decision:move-initial-defense"),
          pendingDecisionIdSchema.parse("pending-decision:move-post-roll-defense"),
        ],
        resolutionFrameIds: [
          resolutionFrameIdSchema.parse("resolution-frame:move-initial-defense"),
          resolutionFrameIdSchema.parse("resolution-frame:move-post-roll-defense"),
        ],
      },
    );
    const fight = requireTransition(
      createFight(
        {
          ...input,
          combatants: [
            { ...input.combatants[0], moveIds: ["move-akaikaru-firestorm"] },
            { ...input.combatants[1], itemIds: ["item-equipment-heroic-tunic"] },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveState(
      requireTransition(advanceFight(fight.state, dependencies)).state,
    );
    const declared = requireTransition(
      submitCombatDecision(
        action,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:post-roll-firestorm"),
          actorId: attackerId,
          expectedStateVersion: action.version,
          moveId: "move-akaikaru-firestorm",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    const initial = requireActiveState(declared.state).pendingDecision;
    if (initial === undefined) throw new Error("Expected a defense decision.");
    const rolled = requireTransition(
      submitCombatDecision(
        declared.state,
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:roll-firestorm-defense"),
          actorId: defenderId,
          expectedStateVersion: declared.state.version,
          pendingDecisionId: initial.id,
          optionId: "roll-defense",
        },
        dependencies,
      ),
    );
    expect(rolled.events.filter((event) => event.type === "attack-rolled")).toHaveLength(3);
    expect(requireActiveState(rolled.state).resolutionFrames).toEqual([
      expect.objectContaining({
        stage: "awaiting-post-defense-reaction",
        naturalRolls: [
          { attack: 10, defense: 11 },
          { attack: 10, defense: 11 },
          { attack: 10, defense: 11 },
        ],
      }),
    ]);
    const reaction = requireActiveState(rolled.state).pendingDecision;
    if (reaction === undefined) throw new Error("Expected an after-roll reaction.");
    const resumed = requireTransition(
      submitCombatDecision(
        rolled.state,
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:activate-tunic-for-firestorm"),
          actorId: defenderId,
          expectedStateVersion: rolled.state.version,
          pendingDecisionId: reaction.id,
          optionId: "activate-item:item-equipment-heroic-tunic",
        },
        dependencies,
      ),
    );
    expect(resumed.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "item-used", itemId: "item-equipment-heroic-tunic" }),
        expect.objectContaining({ type: "ki-changed", amount: -1, remainingKi: 4 }),
        expect.objectContaining({
          type: "attack-resolved",
          moveId: "move-akaikaru-firestorm",
          outcome: "stopped",
        }),
      ]),
    );
    expect(resumed.events.some((event) => event.type === "attack-rolled")).toBe(false);
  });

  it("lets Energy Redirection make one eligible stopped energy die successful", () => {
    const dependencies = createTestCombatDependencies(
      [10, 13, 10, 1, 10, 1],
      new Date("2026-08-06T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:energy-redirection")],
        combatantIds: [attackerId, defenderId],
        eventIds: Array.from({ length: 24 }, (_, index) =>
          combatEventIdSchema.parse(`event:energy-redirection-${index + 1}`),
        ),
        pendingDecisionIds: [
          pendingDecisionIdSchema.parse("pending-decision:energy-redirection-defense"),
          pendingDecisionIdSchema.parse("pending-decision:energy-redirection-post-roll"),
        ],
        resolutionFrameIds: [
          resolutionFrameIdSchema.parse("resolution-frame:energy-redirection-defense"),
          resolutionFrameIdSchema.parse("resolution-frame:energy-redirection-post-roll"),
        ],
      },
    );
    const fight = requireTransition(
      createFight(
        {
          ...input,
          combatants: [
            {
              ...input.combatants[0],
              moveIds: ["move-akaikaru-firestorm", "move-freestyle-energy-redirection"],
            },
            input.combatants[1],
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveState(
      requireTransition(advanceFight(fight.state, dependencies)).state,
    );
    const declared = requireTransition(
      submitCombatDecision(
        action,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:energy-redirection-firestorm"),
          actorId: attackerId,
          expectedStateVersion: action.version,
          moveId: "move-akaikaru-firestorm",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    const defense = requireActiveState(declared.state).pendingDecision;
    if (defense === undefined) throw new Error("Expected a defense decision.");
    const rolled = requireTransition(
      submitCombatDecision(
        declared.state,
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:energy-redirection-roll-defense"),
          actorId: defenderId,
          expectedStateVersion: declared.state.version,
          pendingDecisionId: defense.id,
          optionId: "roll-defense",
        },
        dependencies,
      ),
    );
    const post = requireActiveState(rolled.state).pendingDecision;
    if (post === undefined) throw new Error("Expected attacker after-roll reaction.");
    expect(post).toMatchObject({ combatantId: attackerId });
    expect(post.options).toContainEqual({
      id: "activate-move:move-freestyle-energy-redirection:0",
      type: "activate-effect",
      moveId: "move-freestyle-energy-redirection",
    });
    const resolved = requireTransition(
      submitCombatDecision(
        rolled.state,
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:activate-energy-redirection"),
          actorId: attackerId,
          expectedStateVersion: rolled.state.version,
          pendingDecisionId: post.id,
          optionId: "activate-move:move-freestyle-energy-redirection:0",
        },
        dependencies,
      ),
    );
    expect(resolved.state.combatants[attackerId]).toMatchObject({
      ki: { current: 3 },
      moveUses: {
        "move-akaikaru-firestorm": 1,
        "move-freestyle-energy-redirection": 1,
      },
    });
    expect(resolved.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "move-used", moveId: "move-freestyle-energy-redirection" }),
        expect.objectContaining({ type: "attack-resolved", outcome: "successful" }),
      ]),
    );
  });

  it("replaces one persisted defense die for Second Chance and applies its +5 result", () => {
    const dependencies = createTestCombatDependencies(
      [10, 1, 30],
      new Date("2026-08-06T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:second-chance")],
        combatantIds: [attackerId, defenderId],
        eventIds: Array.from({ length: 20 }, (_, index) =>
          combatEventIdSchema.parse(`event:second-chance-${index + 1}`),
        ),
        pendingDecisionIds: [
          pendingDecisionIdSchema.parse("pending-decision:second-chance-defense"),
          pendingDecisionIdSchema.parse("pending-decision:second-chance-post-roll"),
        ],
        resolutionFrameIds: [
          resolutionFrameIdSchema.parse("resolution-frame:second-chance-defense"),
          resolutionFrameIdSchema.parse("resolution-frame:second-chance-post-roll"),
          resolutionFrameIdSchema.parse("resolution-frame:second-chance-counter"),
        ],
      },
    );
    const fight = requireTransition(
      createFight(
        {
          ...input,
          combatants: [
            input.combatants[0],
            { ...input.combatants[1], moveIds: ["move-kurokonwaku-second-chance"] },
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveState(
      requireTransition(advanceFight(fight.state, dependencies)).state,
    );
    const declared = requireTransition(
      submitCombatDecision(
        action,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:second-chance-attack"),
          actorId: attackerId,
          expectedStateVersion: action.version,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    const defense = requireActiveState(declared.state).pendingDecision;
    if (defense === undefined) throw new Error("Expected defense response.");
    const rolled = requireTransition(
      submitCombatDecision(
        declared.state,
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:second-chance-roll"),
          actorId: defenderId,
          expectedStateVersion: declared.state.version,
          pendingDecisionId: defense.id,
          optionId: "roll-defense",
        },
        dependencies,
      ),
    );
    const post = requireActiveState(rolled.state).pendingDecision;
    if (post === undefined) throw new Error("Expected post-defense decision.");
    expect(post.options).toContainEqual({
      id: "activate-move:move-kurokonwaku-second-chance:0",
      type: "activate-effect",
      moveId: "move-kurokonwaku-second-chance",
    });
    const resolved = requireTransition(
      submitCombatDecision(
        rolled.state,
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:use-second-chance"),
          actorId: defenderId,
          expectedStateVersion: rolled.state.version,
          pendingDecisionId: post.id,
          optionId: "activate-move:move-kurokonwaku-second-chance:0",
        },
        dependencies,
      ),
    );
    expect(resolved.state.combatants[defenderId]).toMatchObject({
      hitPoints: { current: 100 },
      moveUses: { "move-kurokonwaku-second-chance": 1 },
    });
    expect(resolved.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "move-used", moveId: "move-kurokonwaku-second-chance" }),
        expect.objectContaining({ type: "defense-rolled", naturalResult: 30, result: 34 }),
        expect.objectContaining({ type: "attack-resolved", outcome: "stopped" }),
      ]),
    );
  });

  it("applies an owned passive mastery after the triggering attack's defense roll", () => {
    const dependencies = createTestCombatDependencies(
      [20, 10],
      new Date("2026-08-06T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:after-image-mastery")],
        combatantIds: [attackerId, defenderId],
        eventIds: Array.from({ length: 16 }, (_, index) =>
          combatEventIdSchema.parse(`event:after-image-${index + 1}`),
        ),
      },
    );
    const fight = requireTransition(
      createFight(
        {
          ...input,
          combatants: [
            {
              ...input.combatants[0],
              moveIds: ["move-kurokonwaku-after-image-mastery", "move-kurokonwaku-eggsplosives"],
            },
            input.combatants[1],
          ],
        },
        dependencies,
      ),
    );
    const action = requireActiveState(
      requireTransition(advanceFight(fight.state, dependencies)).state,
    );
    const resolved = requireTransition(
      submitCombatDecision(
        action,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:after-image-eggsplosives"),
          actorId: attackerId,
          expectedStateVersion: action.version,
          moveId: "move-kurokonwaku-eggsplosives",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    expect(resolved.state.combatants[defenderId].ki.current).toBe(3);
    expect(resolved.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "ki-changed", combatantId: defenderId, amount: -2 }),
      ]),
    );
  });

  it("limits an uninterrupted counter chain to three counter attacks", () => {
    const { state, dependencies } = createActionState([5, 30, 5, 30, 5, 30, 5, 30]);
    const submit = (
      currentState: FightState,
      actorId: typeof attackerId | typeof defenderId,
      id: string,
    ) =>
      requireTransition(
        submitCombatDecision(
          currentState,
          {
            type: "basic-attack",
            id: combatDecisionIdSchema.parse(id),
            actorId,
            expectedStateVersion: currentState.version,
            basicAttack: "basic-punch",
            targetCombatantId: actorId === attackerId ? defenderId : attackerId,
          },
          dependencies,
        ),
      );

    const first = submit(state, attackerId, "decision:chain-original");
    const second = submit(first.state, defenderId, "decision:chain-1");
    const third = submit(second.state, attackerId, "decision:chain-2");
    const final = submit(third.state, defenderId, "decision:chain-3");

    expect(first.state).toMatchObject({ phase: "counter" });
    expect(second.state).toMatchObject({ phase: "counter" });
    expect(third.state).toMatchObject({ phase: "counter" });
    expect(final.state).toMatchObject({ phase: "end", resolutionFrames: [] });
    expect(final.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "counter-chain-limit-reached", counterAttackCount: 3 }),
      ]),
    );
  });

  it("ends the fight when successful damage reduces the opponent to zero HP", () => {
    const { state, dependencies } = createActionState([20, 1]);
    const nearDefeatState: ActiveFightState = {
      ...state,
      combatants: {
        ...state.combatants,
        [defenderId]: {
          ...state.combatants[defenderId],
          hitPoints: { current: 2, maximum: 100 },
        },
      },
    };

    const transition = requireTransition(
      submitCombatDecision(
        nearDefeatState,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:finishing-blast"),
          actorId: attackerId,
          expectedStateVersion: 1,
          basicAttack: "basic-ki-blast",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );

    expect(transition.state).toEqual(
      expect.objectContaining({
        status: "completed",
        version: 2,
        eventSequence: 9,
        completion: { type: "defeat", winnerCombatantId: attackerId },
      }),
    );
    expect(transition.state.combatants[defenderId]).toMatchObject({
      status: "defeated",
      hitPoints: { current: 0, maximum: 100 },
    });
    expect(transition.events.map((event) => event.type)).toEqual([
      "attack-rolled",
      "defense-rolled",
      "attack-resolved",
      "damage-applied",
      "combatant-defeated",
      "fight-ended",
    ]);
  });

  it("rejects a self-targeted basic attack before rolling", () => {
    const { state, dependencies } = createActionState([]);

    expect(
      submitCombatDecision(
        state,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:self-target"),
          actorId: attackerId,
          expectedStateVersion: 1,
          basicAttack: "basic-punch",
          targetCombatantId: attackerId,
        },
        dependencies,
      ),
    ).toEqual({ ok: false, error: { type: "invalid-target", targetCombatantId: attackerId } });
  });
});
