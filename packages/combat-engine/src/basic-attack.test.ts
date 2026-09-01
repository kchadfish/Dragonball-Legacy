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
    eventIds: Array.from({ length: 64 }, (_, index) =>
      combatEventIdSchema.parse(`event:basic-${index + 1}`),
    ),
    resolutionFrameIds: Array.from({ length: 4 }, (_, index) =>
      resolutionFrameIdSchema.parse(`resolution-frame:basic-counter-${index + 1}`),
    ),
    pendingDecisionIds: Array.from({ length: 6 }, (_, index) =>
      pendingDecisionIdSchema.parse(
        index === 0 ? "pending-decision:basic-defense" : `pending-decision:basic-${index}`,
      ),
    ),
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
  it("applies the converted active-CONSTANT count bonus at the public move boundary", () => {
    const randomValues = Array.from({ length: 20 }, (_, index) => (index % 2 === 0 ? 20 : 1));
    const { state, dependencies } = createActionState(randomValues);
    const tracedDependencies = { ...dependencies, retainDiagnosticTrace: true };
    const armed: ActiveFightState = {
      ...state,
      turnNumber: 10,
      combatants: {
        ...state.combatants,
        [attackerId]: {
          ...state.combatants[attackerId],
          moveIds: ["move-afterlife-wolf-fang-fist"],
          ki: { ...state.combatants[attackerId].ki, current: 10 },
        },
      },
    };

    const transition = requireTransition(
      submitCombatDecision(
        armed,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:wolf-fang-active-count"),
          actorId: attackerId,
          expectedStateVersion: armed.version,
          moveId: "move-afterlife-wolf-fang-fist",
          targetCombatantId: defenderId,
        },
        tracedDependencies,
      ),
    );

    expect(transition.events).toContainEqual(
      expect.objectContaining({ type: "attack-rolled", naturalResult: 20, result: 26 }),
    );
    expect(transition.diagnosticTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: "additive", provenance: "roll:stat-contribution" }),
      ]),
    );
  });

  it("enforces a converted current-action roll-result cap at the public move boundary", () => {
    const { state, dependencies } = createActionState([20, 1]);
    const armed: ActiveFightState = {
      ...state,
      turnNumber: 10,
      combatants: {
        ...state.combatants,
        [attackerId]: {
          ...state.combatants[attackerId],
          moveIds: ["move-aoyosumu-slow-charge"],
          ki: { ...state.combatants[attackerId].ki, current: 10 },
        },
      },
    };

    const transition = requireTransition(
      submitCombatDecision(
        armed,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:slow-charge-cap"),
          actorId: attackerId,
          expectedStateVersion: armed.version,
          moveId: "move-aoyosumu-slow-charge",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );

    expect(transition.events).toContainEqual(
      expect.objectContaining({ type: "attack-rolled", naturalResult: 20, result: 26 }),
    );
  });

  it("offers Human Average's once-per-turn reroll through the public attack flow", () => {
    const { state, dependencies } = createActionState([14, 1, 20]);
    const armed: ActiveFightState = {
      ...state,
      combatants: {
        ...state.combatants,
        [attackerId]: {
          ...state.combatants[attackerId],
          classId: "race-class-humans-average-in-the-extreme",
        },
      },
    };
    const declared = requireTransition(
      submitCombatDecision(
        armed,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:human-average-attack"),
          actorId: attackerId,
          expectedStateVersion: armed.version,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    const defense = requireActiveState(declared.state).pendingDecision;
    if (defense === undefined) throw new Error("Expected a defense response.");
    const rolledResult = submitCombatDecision(
      declared.state,
      {
        type: "respond-to-pending-decision",
        id: combatDecisionIdSchema.parse("decision:human-average-defense"),
        actorId: defenderId,
        expectedStateVersion: declared.state.version,
        pendingDecisionId: defense.id,
        optionId: "roll-defense",
      },
      dependencies,
    );
    if (!rolledResult.ok) throw new Error(JSON.stringify(rolledResult.error));
    const rolled = rolledResult.value;
    const reaction = requireActiveState(rolled.state).pendingDecision;
    if (reaction === undefined) throw new Error("Expected the Human Average reroll choice.");
    expect(reaction.combatantId).toBe(attackerId);
    const rerollOption = reaction.options.find((option) =>
      option.id.startsWith("activate-reroll:"),
    );
    expect(rerollOption).toBeDefined();
    expect(reaction.options).toContainEqual({ id: "decline", type: "decline" });
  });

  it("applies a converted total-result cap after active and immediate modifiers", () => {
    const activeModifierId = activeEffectIdSchema.parse("active-effect:vanishing-result-cap");
    const { state, dependencies } = createActionState([20, 1], [activeModifierId]);
    const armed: ActiveFightState = {
      ...state,
      turnNumber: 10,
      combatants: {
        ...state.combatants,
        [attackerId]: {
          ...state.combatants[attackerId],
          moveIds: ["move-afterlife-vanishing-ball"],
          ki: { ...state.combatants[attackerId].ki, current: 10 },
        },
      },
      activeEffects: [
        {
          id: activeModifierId,
          type: "modify-roll",
          sourceCombatantId: attackerId,
          targetCombatantId: attackerId,
          sourceDefinitionId: "move-afterlife-final-spirit-cannon",
          roll: "attack",
          modifier: "result",
          amount: 10,
          duration: "combat",
        },
      ],
    };

    const transition = requireTransition(
      submitCombatDecision(
        armed,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:vanishing-result-cap"),
          actorId: attackerId,
          expectedStateVersion: armed.version,
          moveId: "move-afterlife-vanishing-ball",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );

    expect(transition.events).toContainEqual(
      expect.objectContaining({ type: "attack-rolled", naturalResult: 20, result: 24 }),
    );
  });

  it("passes a converted final dice-sides cap to the deterministic random boundary", () => {
    const activeModifierId = activeEffectIdSchema.parse("active-effect:vanishing-sides-cap");
    const { state, dependencies } = createActionState([20, 1], [activeModifierId]);
    const requestedMaximums: number[] = [];
    const tracedDependencies: typeof dependencies = {
      ...dependencies,
      random: {
        integer: (minimum: number, maximum: number) => {
          requestedMaximums.push(maximum);
          return maximum === 35 ? 35 : minimum;
        },
      },
    };
    const armed: ActiveFightState = {
      ...state,
      turnNumber: 10,
      combatants: {
        ...state.combatants,
        [attackerId]: {
          ...state.combatants[attackerId],
          moveIds: ["move-afterlife-vanishing-ball"],
          ki: { ...state.combatants[attackerId].ki, current: 10 },
        },
      },
      activeEffects: [
        {
          id: activeModifierId,
          type: "modify-roll",
          sourceCombatantId: attackerId,
          targetCombatantId: attackerId,
          sourceDefinitionId: "move-afterlife-final-spirit-cannon",
          roll: "attack",
          modifier: "sides",
          amount: 10,
          duration: "combat",
        },
      ],
    };

    requireTransition(
      submitCombatDecision(
        armed,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:vanishing-sides-cap"),
          actorId: attackerId,
          expectedStateVersion: armed.version,
          moveId: "move-afterlife-vanishing-ball",
          targetCombatantId: defenderId,
        },
        tracedDependencies,
      ),
    );

    expect(requestedMaximums).toEqual([35, 30]);
  });

  it("applies Mass Genocide's escalating result modifiers during the public move transition", () => {
    const dependencies = createDependencies([20, 1, 20, 1, 20, 1, 20, 1, 20, 1]);
    const fight = requireTransition(
      createFight(
        {
          ...input,
          combatants: [
            {
              ...input.combatants[0],
              moveIds: ["move-afterlife-mass-genocide-attack"],
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
    const armed: ActiveFightState = {
      ...action,
      turnNumber: 10,
      combatants: {
        ...action.combatants,
        [attackerId]: {
          ...action.combatants[attackerId],
          ki: { ...action.combatants[attackerId].ki, current: 10, maximum: 10 },
        },
      },
    };

    const transition = requireTransition(
      submitCombatDecision(
        armed,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:mass-genocide"),
          actorId: attackerId,
          expectedStateVersion: armed.version,
          moveId: "move-afterlife-mass-genocide-attack",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    const attackRolls = transition.events.filter((event) => event.type === "attack-rolled");

    expect(attackRolls.map((event) => event.result)).toEqual([21, 23, 24, 25, 26]);
    expect(attackRolls.every((event) => event.naturalResult === 20)).toBe(true);
    expect(transition.state.actionHistory).toContainEqual(
      expect.objectContaining({
        moveId: "move-afterlife-mass-genocide-attack",
        outcome: "successful",
      }),
    );
    expect(transition.state.version).toBe(armed.version + 1);
  });

  it("applies a prior-action selector through the public converted move transition", () => {
    const { state, dependencies } = createActionState(
      [10, 1],
      [activeEffectIdSchema.parse("active-effect:smackdown-suppression")],
    );
    const armed: ActiveFightState = {
      ...state,
      combatants: {
        ...state.combatants,
        [attackerId]: {
          ...state.combatants[attackerId],
          moveIds: ["move-midorikatai-smackdown"],
        },
        [defenderId]: {
          ...state.combatants[defenderId],
          moveIds: ["move-midorikatai-rocket-fire"],
        },
      },
      actionHistory: [
        {
          type: "use-move",
          decisionId: combatDecisionIdSchema.parse("decision:prior-rocket-fire"),
          actorId: defenderId,
          targetCombatantId: attackerId,
          moveId: "move-midorikatai-rocket-fire",
          turnNumber: state.turnNumber,
          phase: "action",
          outcome: "successful",
          critical: false,
          counter: false,
        },
      ],
    };

    const declared = requireTransition(
      submitCombatDecision(
        armed,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:smackdown"),
          actorId: attackerId,
          expectedStateVersion: armed.version,
          moveId: "move-midorikatai-smackdown",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    const resolved = declared;

    expect(resolved.events).toContainEqual(
      expect.objectContaining({ type: "damage-applied", amount: 17 }),
    );
    expect(resolved.state.actionHistory).toContainEqual(
      expect.objectContaining({
        type: "use-move",
        moveId: "move-midorikatai-smackdown",
        outcome: "successful",
        critical: false,
        counter: false,
      }),
    );
  });

  it("counts the current stopped converted attack in a persisted action sequence", () => {
    const { state, dependencies } = createActionState([5, 10, 5, 10, 5, 10, 5, 10]);
    const stoppedHistory = (turnNumber: number) => ({
      type: "use-move" as const,
      decisionId: combatDecisionIdSchema.parse(`decision:prior-stopped-${turnNumber}`),
      actorId: attackerId,
      targetCombatantId: defenderId,
      moveId: "move-aoyosumu-sky-dance-technique" as const,
      turnNumber,
      phase: "action" as const,
      outcome: "stopped" as const,
      critical: false,
      counter: false,
    });
    const armed: ActiveFightState = {
      ...state,
      turnNumber: 4,
      combatants: {
        ...state.combatants,
        [attackerId]: {
          ...state.combatants[attackerId],
          moveIds: ["move-aoyosumu-sky-dance-technique"],
        },
      },
      actionHistory: [stoppedHistory(2), stoppedHistory(3)],
    };

    const transition = requireTransition(
      submitCombatDecision(
        armed,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:sky-dance-sequence"),
          actorId: attackerId,
          expectedStateVersion: armed.version,
          moveId: "move-aoyosumu-sky-dance-technique",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    expect(transition.state.combatants[attackerId].ki.current).toBe(1);
    expect(transition.state.actionHistory).toContainEqual(
      expect.objectContaining({
        moveId: "move-aoyosumu-sky-dance-technique",
        outcome: "stopped",
      }),
    );
  });

  it("applies a durable damage-percent modifier through the public attack transition", () => {
    const effectId = activeEffectIdSchema.parse("active-effect:damage-percent");
    const { state, dependencies } = createActionState([10, 1], [effectId]);
    const armed: ActiveFightState = {
      ...state,
      activeEffects: [
        {
          id: effectId,
          type: "modify-damage",
          sourceCombatantId: defenderId,
          targetCombatantId: attackerId,
          sourceDefinitionId: "move-midorikatai-monster-mash",
          operation: "add",
          basis: "damage-percent",
          amount: -50,
          duration: { type: "combat" },
        },
      ],
    };

    const transition = requireTransition(
      submitCombatDecision(
        armed,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:damage-percent"),
          actorId: attackerId,
          expectedStateVersion: armed.version,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );

    expect(transition.state.version).toBe(armed.version + 1);
    expect(transition.events).toContainEqual(
      expect.objectContaining({ type: "damage-applied", amount: 2 }),
    );
    expect(transition.state.activeEffects).toContainEqual(
      expect.objectContaining({ id: effectId, type: "modify-damage", basis: "damage-percent" }),
    );
  });

  it("applies a deterministic on-damage response from the defender's mastery", () => {
    const effectId = activeEffectIdSchema.parse("active-effect:advanced-behavior");
    const { state, dependencies } = createActionState([10, 1], [effectId]);
    const armed: ActiveFightState = {
      ...state,
      combatants: {
        ...state.combatants,
        [attackerId]: {
          ...state.combatants[attackerId],
          stats: { ...state.combatants[attackerId].stats, power: 100 },
        },
        [defenderId]: {
          ...state.combatants[defenderId],
        },
      },
      activeEffects: [
        {
          id: effectId,
          type: "active-constant",
          sourceCombatantId: defenderId,
          targetCombatantId: defenderId,
          sourceDefinitionId: "move-haokiru-advanced-behavior",
          activatedOnTurn: state.turnNumber,
          duration: "combat",
        },
      ],
    };

    const transition = requireTransition(
      submitCombatDecision(
        armed,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:on-damage-basic"),
          actorId: attackerId,
          expectedStateVersion: armed.version,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );

    expect(transition.state.version).toBe(armed.version + 1);
    expect(transition.events).toContainEqual(
      expect.objectContaining({ type: "damage-applied", amount: 9 }),
    );
    expect(transition.state.combatants[defenderId].hitPoints.current).toBe(91);
  });

  it("applies a generic critical on-damage multiplier from the public attack transition", () => {
    const { state, dependencies } = createActionState([30, 1]);
    const armed: ActiveFightState = {
      ...state,
      combatants: {
        ...state.combatants,
        [attackerId]: {
          ...state.combatants[attackerId],
          stats: { ...state.combatants[attackerId].stats, power: 100 },
        },
        [defenderId]: {
          ...state.combatants[defenderId],
          moveIds: ["move-midorikatai-critical-mass-mastery"],
        },
      },
    };

    const transition = requireTransition(
      submitCombatDecision(
        armed,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:on-damage-critical"),
          actorId: attackerId,
          expectedStateVersion: armed.version,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );

    expect(transition.events).toContainEqual(
      expect.objectContaining({ type: "attack-resolved", critical: true }),
    );
    expect(transition.events).toContainEqual(
      expect.objectContaining({ type: "damage-applied", amount: 30 }),
    );
  });

  it("expires a damage modifier after its declared attack threshold", () => {
    const effectId = activeEffectIdSchema.parse("active-effect:damage-threshold");
    const { state, dependencies } = createActionState([30, 1], [effectId]);
    const armed: ActiveFightState = {
      ...state,
      activeEffects: [
        {
          id: effectId,
          type: "modify-damage",
          sourceCombatantId: defenderId,
          targetCombatantId: attackerId,
          sourceDefinitionId: "move-aoyosumu-lights-out-strike",
          operation: "set",
          basis: "power-percent",
          amount: 0,
          duration: {
            type: "until-roll-threshold",
            combatantId: attackerId,
            roll: "attack",
            comparison: "at-least",
            value: 30,
          },
        },
      ],
    };

    const transition = requireTransition(
      submitCombatDecision(
        armed,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:damage-threshold"),
          actorId: attackerId,
          expectedStateVersion: armed.version,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );

    expect(transition.state.activeEffects).toEqual([]);
  });

  it("resolves Quiet Preparation from durable counter history at the public action boundary", () => {
    const { state, dependencies } = createActionState(
      [20, 1, 20, 1],
      [
        activeEffectIdSchema.parse("active-effect:quiet-1"),
        activeEffectIdSchema.parse("active-effect:quiet-2"),
        activeEffectIdSchema.parse("active-effect:quiet-3"),
      ],
    );
    const prepared: ActiveFightState = {
      ...state,
      actionHistory: [
        {
          type: "use-move",
          decisionId: combatDecisionIdSchema.parse("decision:quiet-prior-counter"),
          actorId: attackerId,
          targetCombatantId: defenderId,
          moveId: "move-aoyosumu-floating-drop",
          outcome: "stopped",
          counter: true,
          turnNumber: 1,
          phase: "counter",
        },
        {
          type: "use-move",
          decisionId: combatDecisionIdSchema.parse("decision:quiet-prior-counter-2"),
          actorId: attackerId,
          targetCombatantId: defenderId,
          moveId: "move-aoyosumu-floating-drop",
          outcome: "stopped",
          counter: true,
          turnNumber: 1,
          phase: "counter",
        },
      ],
      combatants: {
        ...state.combatants,
        [attackerId]: {
          ...state.combatants[attackerId],
          moveIds: ["move-aoyosumu-quiet-preparation", "move-aoyosumu-floating-drop"],
          ki: { ...state.combatants[attackerId].ki, current: 10 },
          stats: { ...state.combatants[attackerId].stats, power: 100 },
        },
      },
    };

    const preparation = requireTransition(
      submitCombatDecision(
        prepared,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:quiet-preparation"),
          actorId: attackerId,
          expectedStateVersion: prepared.version,
          moveId: "move-aoyosumu-quiet-preparation",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    const queued = preparation.state.activeEffects.find(
      (effect) => effect.type === "modify-next-action",
    );

    expect(preparation.state.combatants[attackerId].ki.current).toBe(8);
    expect(queued).toMatchObject({
      scope: "next-actions",
      remaining: 2,
      modifier: { type: "damage", amount: 10 },
    });

    const followUp = requireTransition(
      submitCombatDecision(
        {
          ...requireActiveState(preparation.state),
          phase: "action",
          activeCombatantId: attackerId,
        },
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:quiet-follow-up"),
          actorId: attackerId,
          expectedStateVersion: preparation.state.version,
          moveId: "move-aoyosumu-floating-drop",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );

    expect(followUp.events).toContainEqual(expect.objectContaining({ type: "damage-applied" }));
    expect(followUp.state.activeEffects).toMatchObject([{ remaining: 1 }]);

    const secondFollowUp = requireTransition(
      submitCombatDecision(
        {
          ...requireActiveState(followUp.state),
          phase: "action",
          activeCombatantId: attackerId,
        },
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:quiet-follow-up-2"),
          actorId: attackerId,
          expectedStateVersion: followUp.state.version,
          moveId: "move-aoyosumu-floating-drop",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    expect(secondFollowUp.state.activeEffects).toEqual([]);
  });

  it("persists Lights Out Strike's selected advanced attack through public pending resolution", () => {
    const { state, dependencies } = createActionState(
      [20, 1, 10, 1],
      [activeEffectIdSchema.parse("active-effect:lights-out")],
    );
    const armed: ActiveFightState = {
      ...state,
      combatants: {
        ...state.combatants,
        [attackerId]: {
          ...state.combatants[attackerId],
          moveIds: ["move-aoyosumu-lights-out-strike"],
          stats: { ...state.combatants[attackerId].stats, power: 100 },
        },
        [defenderId]: {
          ...state.combatants[defenderId],
          moveIds: ["move-aoyosumu-floating-drop", "move-aoyosumu-crescent-kick"],
          stats: { ...state.combatants[defenderId].stats, power: 100 },
        },
      },
    };
    const declared = requireTransition(
      submitCombatDecision(
        armed,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:lights-out"),
          actorId: attackerId,
          expectedStateVersion: armed.version,
          moveId: "move-aoyosumu-lights-out-strike",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    const pending = requireActiveState(declared.state).pendingDecision;

    expect(pending?.type).toBe("select-move");
    expect(pending?.options.map((option) => option.moveId)).toEqual([
      "move-aoyosumu-floating-drop",
      "move-aoyosumu-crescent-kick",
    ]);

    const selected = requireTransition(
      submitCombatDecision(
        requireActiveState(declared.state),
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:lights-out-select"),
          actorId: attackerId,
          expectedStateVersion: declared.state.version,
          pendingDecisionId: pending!.id,
          optionId: "select-damage-target:move-aoyosumu-floating-drop",
        },
        dependencies,
      ),
    );
    const active = selected.state.activeEffects.find((effect) => effect.type === "modify-damage");

    expect(active).toMatchObject({
      sourceDefinitionId: "move-aoyosumu-lights-out-strike",
      targetCombatantId: defenderId,
      selectedMoveId: "move-aoyosumu-floating-drop",
      amount: 0,
      duration: {
        type: "until-roll-threshold",
        combatantId: defenderId,
        value: 25,
      },
    });
    expect(selected.events).toContainEqual(
      expect.objectContaining({
        type: "effect-activated",
        sourceDefinitionId: "move-aoyosumu-lights-out-strike",
      }),
    );

    const targetAttack = requireTransition(
      submitCombatDecision(
        {
          ...requireActiveState(selected.state),
          phase: "action",
          activeCombatantId: defenderId,
        },
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:lights-out-target-attack"),
          actorId: defenderId,
          expectedStateVersion: selected.state.version,
          moveId: "move-aoyosumu-floating-drop",
          targetCombatantId: attackerId,
        },
        dependencies,
      ),
    );

    expect(targetAttack.events.some((event) => event.type === "damage-applied")).toBe(false);
    expect(targetAttack.state.combatants[attackerId].hitPoints.current).toBe(
      selected.state.combatants[attackerId].hitPoints.current,
    );
    expect(
      targetAttack.state.activeEffects.some(
        (effect) =>
          effect.type === "modify-damage" &&
          effect.selectedMoveId === "move-aoyosumu-floating-drop",
      ),
    ).toBe(true);
  });

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

  it("allows an explicitly unmodifiable cost reduction through a generic cost lock", () => {
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
          allowUnmodifiable: true,
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
          id: combatDecisionIdSchema.parse("decision:cost-unmodifiable"),
          actorId: attackerId,
          expectedStateVersion: armed.version,
          moveId: "move-kurokonwaku-spiked-ball",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );

    expect(transition.events).toContainEqual(
      expect.objectContaining({ type: "ki-changed", combatantId: attackerId, amount: -1 }),
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

  it("resolves move-effect-active conditions from durable active effects", () => {
    const kaioKenEffectId = activeEffectIdSchema.parse("active-effect:kaio-ken");
    const dependencies = createDependencies(
      [10, 1],
      [
        activeEffectIdSchema.parse("active-effect:kaio-ken-upkeep-damage"),
        activeEffectIdSchema.parse("active-effect:kaio-ken-upkeep-stat"),
        activeEffectIdSchema.parse("active-effect:kaio-ken-upkeep-prevention"),
        kaioKenEffectId,
        activeEffectIdSchema.parse("active-effect:kaio-ken-move-prevention"),
      ],
    );
    const fight = requireTransition(
      createFight(
        {
          ...input,
          combatants: [
            {
              ...input.combatants[0],
              moveIds: ["move-afterlife-x20-kaioken-kamehameha", "move-afterlife-kaio-ken"],
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
    const armed: ActiveFightState = {
      ...action,
      turnNumber: 10,
      combatants: {
        ...action.combatants,
        [attackerId]: {
          ...action.combatants[attackerId],
          ki: { ...action.combatants[attackerId].ki, current: 10 },
        },
      },
      activeEffects: [
        {
          id: kaioKenEffectId,
          type: "modify-next-action",
          sourceCombatantId: attackerId,
          targetCombatantId: attackerId,
          sourceDefinitionId: "move-afterlife-kaio-ken",
          modifier: { type: "damage", amount: 0 },
        },
      ],
    };

    const result = submitCombatDecision(
      armed,
      {
        type: "use-move",
        id: combatDecisionIdSchema.parse("decision:x20-kaio-ken-kamehameha"),
        actorId: attackerId,
        expectedStateVersion: armed.version,
        moveId: "move-afterlife-x20-kaioken-kamehameha",
        targetCombatantId: defenderId,
      },
      dependencies,
    );
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const transition = result.value;

    expect(transition.events).toContainEqual(
      expect.objectContaining({ type: "ki-changed", combatantId: attackerId, amount: -4 }),
    );
    expect(transition.events).toContainEqual(
      expect.objectContaining({ type: "damage-applied", amount: 29 }),
    );
    expect(transition.events).toContainEqual(
      expect.objectContaining({
        type: "move-use-limit-changed",
        sourceCombatantId: attackerId,
        targetCombatantId: attackerId,
        sourceDefinitionId: "move-afterlife-x20-kaioken-kamehameha",
        moveId: "move-afterlife-kaio-ken",
        amount: 2,
        newUseLimit: 3,
      }),
    );
    expect(transition.state.combatants[attackerId].moveUseLimitModifiers).toEqual({
      "move-afterlife-kaio-ken": 2,
    });
    expect(transition.state.version).toBe(armed.version + 1);
  });

  it("dispatches threshold-crossing effects before clamping HP", () => {
    const dependencies = createDependencies([20, 1]);
    const fight = requireTransition(
      createFight(
        {
          ...input,
          combatants: [
            {
              ...input.combatants[0],
              stats: { ...input.combatants[0].stats, power: 100 },
              moveIds: ["move-afterlife-kamehameha"],
            },
            {
              ...input.combatants[1],
              maximumHitPoints: 10,
              moveIds: ["move-haokiru-eternal-mastery"],
            },
          ],
        },
        dependencies,
      ),
    );
    const action = {
      ...requireTransition(advanceFight(fight.state, dependencies)).state,
      turnNumber: 10,
    };
    const result = submitCombatDecision(
      action,
      {
        type: "use-move",
        id: combatDecisionIdSchema.parse("decision:threshold-crossing"),
        actorId: attackerId,
        expectedStateVersion: action.version,
        moveId: "move-afterlife-kamehameha",
        targetCombatantId: defenderId,
      },
      dependencies,
    );
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const transition = result.value;

    expect(transition.state.status).toBe("active");
    expect(transition.state.combatants[defenderId].hitPoints.current).toBe(1);
    expect(transition.events).toContainEqual(
      expect.objectContaining({ type: "damage-applied", amount: 10 }),
    );
    expect(transition.state.version).toBe(action.version + 1);
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
        outcome: "successful",
        critical: false,
        counter: false,
        attackRollResult: 11,
        defenseRollResult: 11,
        damageDealt: 3,
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
          selectedOptionIds: ["roll-defense"],
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

  it("applies and consumes a durable next-defense result substitution", () => {
    const { state, dependencies } = createActionState(
      [10, 1, 10, 1],
      [activeEffectIdSchema.parse("active-effect:next-defense-result")],
    );
    const armed: ActiveFightState = {
      ...state,
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:next-defense-result"),
          type: "modify-next-action",
          sourceCombatantId: defenderId,
          targetCombatantId: defenderId,
          sourceDefinitionId: "move-afterlife-four-arms",
          scope: "next-roll",
          stacking: "prevent",
          modifier: {
            type: "roll-result",
            roll: "defense",
            value: 20,
            resultScope: "matching-die",
          },
        },
      ],
    };

    const first = requireTransition(
      submitCombatDecision(
        armed,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:next-defense-result-1"),
          actorId: attackerId,
          expectedStateVersion: armed.version,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    expect(first.events).toContainEqual(
      expect.objectContaining({ type: "defense-rolled", naturalResult: 1, result: 19 }),
    );
    expect(first.state.activeEffects).toEqual([]);
  });

  it("arms Four Arms from a low defensive roll against a basic attack", () => {
    const { state, dependencies } = createActionState(
      [20, 1, 20, 1],
      [activeEffectIdSchema.parse("active-effect:four-arms-result")],
    );
    const armed: ActiveFightState = {
      ...state,
      combatants: {
        ...state.combatants,
        [defenderId]: {
          ...state.combatants[defenderId],
          moveIds: ["move-afterlife-four-arms"],
          stats: { ...state.combatants[defenderId].stats, dexterityBonus: 0 },
        },
      },
    };

    const transition = requireTransition(
      submitCombatDecision(
        armed,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:four-arms-arm"),
          actorId: attackerId,
          expectedStateVersion: armed.version,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );

    expect(transition.state.activeEffects).toEqual([
      expect.objectContaining({
        sourceDefinitionId: "move-afterlife-four-arms",
        targetCombatantId: defenderId,
        scope: "next-roll",
        modifier: expect.objectContaining({ type: "roll-result", value: 2 }),
      }),
    ]);

    const consumed = requireTransition(
      submitCombatDecision(
        {
          ...requireActiveState(transition.state),
          phase: "action",
          activeCombatantId: attackerId,
        },
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:four-arms-consume"),
          actorId: attackerId,
          expectedStateVersion: transition.state.version,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    expect(consumed.events).toContainEqual(
      expect.objectContaining({ type: "defense-rolled", naturalResult: 1, result: 2 }),
    );
    expect(consumed.state.activeEffects).toEqual([]);
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

  it("delays following-action suppression and consumes it after the matching attack", () => {
    const suppressionId = activeEffectIdSchema.parse("active-effect:following-suppression");
    const { state, dependencies } = createActionState(
      [20, 1, 20, 1, 20, 1, 20, 1],
      ["active-effect:sword-modifier-1" as ActiveEffectId],
    );
    const armed: ActiveFightState = {
      ...state,
      activeCombatantId: defenderId,
      phase: "action",
      combatants: {
        ...state.combatants,
        [defenderId]: {
          ...state.combatants[defenderId],
          moveIds: ["move-afterlife-sword-blast"],
          ki: { ...state.combatants[defenderId].ki, current: 10 },
        },
      },
      activeEffects: [
        {
          id: suppressionId,
          type: "suppress",
          sourceCombatantId: attackerId,
          targetCombatantId: defenderId,
          sourceDefinitionId: "move-haokiru-soul-breaker",
          aspects: ["all-effects"],
          duration: { type: "following-action", ownerCombatantId: defenderId, remaining: 2 },
        },
      ],
    };
    const first = requireTransition(
      submitCombatDecision(
        armed,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:following-suppression-1"),
          actorId: defenderId,
          expectedStateVersion: armed.version,
          moveId: "move-afterlife-sword-blast",
          targetCombatantId: attackerId,
        },
        dependencies,
      ),
    );
    expect(first.state.activeEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "suppress",
          duration: { type: "following-action", ownerCombatantId: defenderId, remaining: 1 },
        }),
        expect.objectContaining({ type: "modify-next-action" }),
      ]),
    );

    const second = requireTransition(
      submitCombatDecision(
        {
          ...requireActiveState(first.state),
          phase: "action",
          activeCombatantId: defenderId,
          turnNumber: armed.turnNumber + 1,
        },
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:following-suppression-2"),
          actorId: defenderId,
          expectedStateVersion: first.state.version,
          moveId: "move-afterlife-sword-blast",
          targetCombatantId: attackerId,
        },
        dependencies,
      ),
    );
    expect(second.state.activeEffects).toEqual([
      expect.objectContaining({ type: "modify-next-action" }),
    ]);
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
    const { state, dependencies } = createActionState(
      [10, 1],
      Array.from({ length: 8 }, (_, index) =>
        activeEffectIdSchema.parse(`active-effect:converted-roll-prevention-${index}`),
      ),
    );
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
    const { state, dependencies } = createActionState(
      [10, 1, 1],
      [activeEffectIdSchema.parse("active-effect:monkey-sweep-floating")],
    );
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
      expect.objectContaining({ type: "attack-rolled", naturalResult: 10, result: 12 }),
    );
  });

  it("allows a constant passive signature modifier to exceed the standard result cap", () => {
    const activeMasteryId = activeEffectIdSchema.parse("active-effect:flawless-execution");
    const activeModifierId = activeEffectIdSchema.parse("active-effect:signature-roll-boost");
    const { state, dependencies } = createActionState(
      [20, 1],
      Array.from({ length: 8 }, (_, index) =>
        activeEffectIdSchema.parse(`active-effect:flawless-execution-roll-${index}`),
      ),
    );
    const armed: ActiveFightState = {
      ...state,
      turnNumber: 10,
      combatants: {
        ...state.combatants,
        [attackerId]: {
          ...state.combatants[attackerId],
          moveIds: [
            "move-midorikatai-flawless-execution-mastery",
            "move-afterlife-final-spirit-cannon",
          ],
          ki: { ...state.combatants[attackerId].ki, current: 10 },
        },
      },
      activeEffects: [
        {
          id: activeMasteryId,
          type: "active-constant",
          sourceCombatantId: attackerId,
          targetCombatantId: attackerId,
          sourceDefinitionId: "move-midorikatai-flawless-execution-mastery",
          activatedOnTurn: state.turnNumber,
          duration: "combat",
          lifecycle: "active",
        },
        {
          id: activeModifierId,
          type: "modify-roll",
          sourceCombatantId: attackerId,
          targetCombatantId: attackerId,
          sourceDefinitionId: "move-afterlife-final-spirit-cannon",
          roll: "attack",
          modifier: "result",
          amount: 5,
          duration: "combat",
        },
      ],
    };

    const attack = requireTransition(
      submitCombatDecision(
        armed,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:allow-roll-exceed"),
          actorId: attackerId,
          expectedStateVersion: armed.version,
          moveId: "move-afterlife-final-spirit-cannon",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );

    expect(attack.events).toContainEqual(
      expect.objectContaining({ type: "attack-rolled", naturalResult: 20, result: 30 }),
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

  it("permits a counter attack to request the target's defense response", () => {
    const { state, dependencies } = createActionState([5, 30, 5, 10]);
    const counterTransition = requireTransition(
      submitCombatDecision(
        state,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:counter-defense-source"),
          actorId: attackerId,
          expectedStateVersion: 1,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    const counterState = requireActiveState(counterTransition.state);
    const targetArmed = {
      ...counterState,
      combatants: {
        ...counterState.combatants,
        [attackerId]: {
          ...counterState.combatants[attackerId],
          moveIds: ["move-aoyosumu-defiant-stance"],
        },
      },
    } satisfies ActiveFightState;

    const defenseRequest = requireTransition(
      submitCombatDecision(
        targetArmed,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:counter-defense-attack"),
          actorId: defenderId,
          expectedStateVersion: targetArmed.version,
          basicAttack: "basic-kick",
          targetCombatantId: attackerId,
        },
        dependencies,
      ),
    );

    expect(defenseRequest.state).toMatchObject({
      phase: "counter",
      pendingDecision: { type: "defense-response", combatantId: attackerId },
      resolutionFrames: [
        expect.objectContaining({
          stage: "awaiting-defense",
          returnPhase: "counter",
        }),
      ],
    });
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

  it("offers Limb Twist's paid extra attack through the public Block transition", () => {
    const { state, dependencies } = createActionState(
      [12],
      Array.from({ length: 4 }, (_, index) =>
        activeEffectIdSchema.parse(`active-effect:limb-twist-${index}`),
      ),
    );
    const blockState: ActiveFightState = {
      ...state,
      combatants: {
        ...state.combatants,
        [defenderId]: {
          ...state.combatants[defenderId],
          moveIds: ["move-akaikaru-limb-twist"],
        },
      },
    };
    const declared = requireTransition(
      submitCombatDecision(
        blockState,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:limb-twist-attack"),
          actorId: attackerId,
          expectedStateVersion: blockState.version,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    const defense = requireActiveState(declared.state);
    const pendingDefense = defense.pendingDecision;
    if (pendingDefense === undefined) throw new Error("Expected Limb Twist defense choice.");
    const blocked = requireTransition(
      submitCombatDecision(
        defense,
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:limb-twist-block"),
          actorId: defenderId,
          expectedStateVersion: defense.version,
          pendingDecisionId: pendingDefense.id,
          optionId: "use-block:move-akaikaru-limb-twist",
        },
        dependencies,
      ),
    );
    const pendingActivation = requireActiveState(blocked.state).pendingDecision;
    expect(pendingActivation).toMatchObject({
      type: "optional-effect",
      combatantId: defenderId,
      options: expect.arrayContaining([
        expect.objectContaining({ type: "activate-effect", moveId: "move-akaikaru-limb-twist" }),
        { id: "decline", type: "decline" },
      ]),
    });
    if (pendingActivation === undefined) throw new Error("Expected Limb Twist activation choice.");
    const activationResult = submitCombatDecision(
      requireActiveState(blocked.state),
      {
        type: "respond-to-pending-decision",
        id: combatDecisionIdSchema.parse("decision:limb-twist-activate"),
        actorId: defenderId,
        expectedStateVersion: blocked.state.version,
        pendingDecisionId: pendingActivation.id,
        optionId: pendingActivation.options.find((option) => option.type === "activate-effect")!.id,
      },
      dependencies,
    );
    if (!activationResult.ok) throw new Error(JSON.stringify(activationResult.error));
    const activated = activationResult.value;
    expect(activated.state).toMatchObject({ phase: "action", activeCombatantId: defenderId });
    expect(activated.state.combatants[defenderId].ki.current).toBeLessThan(
      defense.combatants[defenderId].ki.current,
    );
    const activatedExtraAction = activated.state.activeEffects.find(
      (effect) => effect.type === "extra-action" && effect.targetCombatantId === defenderId,
    );
    expect(activatedExtraAction).toMatchObject({
      type: "extra-action",
      moveCategory: "advanced-attack",
    });
    expect(activatedExtraAction).not.toHaveProperty("activationCost");
  });

  it("resolves Display of Endurance from the finalized blocked attack damage", () => {
    const { state, dependencies } = createActionState(
      [20, 20, 1, 30, 1, 30, 1, ...Array.from({ length: 20 }, () => 20)],
      [activeEffectIdSchema.parse("active-effect:display-endurance-heal")],
    );
    const blockState: ActiveFightState = {
      ...state,
      combatants: {
        ...state.combatants,
        [attackerId]: {
          ...state.combatants[attackerId],
          moveIds: ["move-haokiru-double-arm-cannon"],
        },
        [defenderId]: {
          ...state.combatants[defenderId],
          ki: { ...state.combatants[defenderId].ki, current: 10 },
          moveIds: ["move-haokiru-display-of-endurance", "move-haokiru-double-arm-cannon"],
        },
      },
    };
    const declared = requireTransition(
      submitCombatDecision(
        blockState,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:display-of-endurance-attack"),
          actorId: attackerId,
          expectedStateVersion: blockState.version,
          moveId: "move-haokiru-double-arm-cannon",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    const pending = requireActiveState(declared.state).pendingDecision;
    if (pending === undefined) throw new Error("Expected a Display of Endurance decision.");
    expect(pending.options).toContainEqual({
      id: "use-block:move-haokiru-display-of-endurance",
      type: "use-block",
      moveId: "move-haokiru-display-of-endurance",
    });

    const resolved = requireTransition(
      submitCombatDecision(
        declared.state,
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:display-of-endurance-block"),
          actorId: defenderId,
          expectedStateVersion: declared.state.version,
          pendingDecisionId: pending.id,
          optionId: "use-block:move-haokiru-display-of-endurance",
        },
        dependencies,
      ),
    );

    expect(resolved.state.combatants[defenderId]).toMatchObject({
      hitPoints: { current: 91, maximum: 100 },
      ki: { current: 8, maximum: 10 },
      moveUses: { "move-haokiru-display-of-endurance": 1 },
    });
    expect(resolved.state.activeEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "floating-effect",
          sourceDefinitionId: "move-haokiru-display-of-endurance",
          blockedAttackDamage: 6,
        }),
      ]),
    );
    expect(resolved.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "attack-resolved", outcome: "successful" }),
      ]),
    );

    const upkeep = requireActiveState(
      requireTransition(advanceFight(resolved.state, dependencies)).state,
    );
    const defenderAction = requireActiveState(
      requireTransition(advanceFight(upkeep, dependencies)).state,
    );
    expect(defenderAction).toMatchObject({ phase: "action", activeCombatantId: defenderId });
    expect(defenderAction.activeEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          floatingEffectId: "display-of-endurance-blocked-damage-heal",
          blockedAttackDamage: 6,
        }),
      ]),
    );
    const nextAttack = requireTransition(
      submitCombatDecision(
        defenderAction,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:display-of-endurance-next-attack"),
          actorId: defenderId,
          expectedStateVersion: defenderAction.version,
          moveId: "move-haokiru-double-arm-cannon",
          targetCombatantId: attackerId,
        },
        dependencies,
      ),
    );
    expect(nextAttack.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "attack-resolved", outcome: "successful" }),
      ]),
    );
    expect(nextAttack.state.combatants[defenderId].hitPoints.current).toBe(100);
    expect(nextAttack.state.activeEffects).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ floatingEffectId: "display-of-endurance-blocked-damage-heal" }),
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

  it("applies Halting Stance's historical opponent-effect KI condition at the public Block boundary", () => {
    const { state, dependencies } = createActionState([12]);
    const priorOpponentAction = {
      type: "use-move" as const,
      decisionId: combatDecisionIdSchema.parse("decision:prior-life-drain"),
      actorId: attackerId,
      targetCombatantId: defenderId,
      moveId: "move-afterlife-life-drain" as never,
      turnNumber: 2,
      phase: "action" as const,
      resourceChanges: [
        {
          affectedCombatantId: defenderId,
          resource: "ki" as const,
          operation: "lose" as const,
          amount: 2,
          turnNumber: 2,
          cause: "opponent-effect" as const,
        },
      ],
    };
    const armed: ActiveFightState = {
      ...state,
      turnNumber: 10,
      actionHistory: [priorOpponentAction],
      combatants: {
        ...state.combatants,
        [defenderId]: {
          ...state.combatants[defenderId],
          moveIds: ["move-haokiru-halting-stance"],
        },
      },
    };
    const declared = requireTransition(
      submitCombatDecision(
        armed,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:halting-stance-attack"),
          actorId: attackerId,
          expectedStateVersion: armed.version,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    const defense = requireActiveState(declared.state);
    if (defense.pendingDecision === undefined) throw new Error("Expected a Block decision.");
    const resolved = requireTransition(
      submitCombatDecision(
        defense,
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:halting-stance-block"),
          actorId: defenderId,
          expectedStateVersion: defense.version,
          pendingDecisionId: defense.pendingDecision.id,
          optionId: "use-block:move-haokiru-halting-stance",
        },
        dependencies,
      ),
    );

    expect(resolved.state.combatants[defenderId].moveUseLimitModifiers).toEqual({
      "move-haokiru-halting-stance": 1,
    });
    expect(resolved.events).toContainEqual(
      expect.objectContaining({
        type: "move-use-limit-changed",
        moveId: "move-haokiru-halting-stance",
        amount: 1,
        newUseLimit: 2,
      }),
    );
  });

  it("stops every die of a multi-dice attack with Dazzling Gymnastics", () => {
    const { state, dependencies } = createActionState([12, 13]);
    const armed: ActiveFightState = {
      ...state,
      combatants: {
        ...state.combatants,
        [attackerId]: {
          ...state.combatants[attackerId],
          moveIds: ["move-akaikaru-stampede-rush"],
          ki: { ...state.combatants[attackerId].ki, current: 10 },
        },
        [defenderId]: {
          ...state.combatants[defenderId],
          moveIds: ["move-akaikaru-dazzling-gymnastics"],
          ki: { ...state.combatants[defenderId].ki, current: 10 },
        },
      },
    };
    const declared = requireTransition(
      submitCombatDecision(
        armed,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:dazzling-multi-die"),
          actorId: attackerId,
          expectedStateVersion: armed.version,
          moveId: "move-akaikaru-stampede-rush",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    const pending = requireActiveState(declared.state).pendingDecision;
    if (pending === undefined) throw new Error("Expected a Dazzling Gymnastics decision.");
    expect(pending.options).toContainEqual({
      id: "use-block:move-akaikaru-dazzling-gymnastics",
      type: "use-block",
      moveId: "move-akaikaru-dazzling-gymnastics",
    });

    const resolved = requireTransition(
      submitCombatDecision(
        declared.state,
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:dazzling-block"),
          actorId: defenderId,
          expectedStateVersion: declared.state.version,
          pendingDecisionId: pending.id,
          optionId: "use-block:move-akaikaru-dazzling-gymnastics",
        },
        dependencies,
      ),
    );

    expect(resolved.events.filter((event) => event.type === "attack-rolled")).toHaveLength(2);
    expect(resolved.events).not.toContainEqual(expect.objectContaining({ type: "defense-rolled" }));
    expect(resolved.events).toContainEqual(
      expect.objectContaining({ type: "attack-resolved", outcome: "stopped" }),
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
      id: "activate-combat-result:move-freestyle-energy-redirection:0:0",
      type: "activate-effect",
      moveId: "move-freestyle-energy-redirection",
      effectIndices: [0],
      combatResultOverride: {
        sourceDefinitionId: "move-freestyle-energy-redirection",
        sourceEffectIndex: 0,
        dieIndex: 0,
      },
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
          optionId: "activate-combat-result:move-freestyle-energy-redirection:0:0",
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
        activeEffectIds: [activeEffectIdSchema.parse("active-effect:second-chance")],
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
    const rerollOption = post.options.find((option) => option.id.startsWith("activate-reroll:"));
    if (rerollOption === undefined) throw new Error("Expected generic reroll option.");
    expect(rerollOption).toMatchObject({
      type: "activate-effect",
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
          optionId: rerollOption.id,
        },
        dependencies,
      ),
    );
    expect(resolved.state.combatants[defenderId]).toMatchObject({
      hitPoints: { current: 100 },
      moveUses: {},
    });
    expect(
      requireActiveState(resolved.state).activeEffects.find((effect) => effect.type === "reroll"),
    ).toMatchObject({ useLimit: { remaining: 0 } });
    expect(resolved.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "move-used", moveId: "move-kurokonwaku-second-chance" }),
        expect.objectContaining({ type: "defense-rolled", naturalResult: 30, result: 34 }),
        expect.objectContaining({ type: "attack-resolved", outcome: "stopped" }),
      ]),
    );
  });

  it("offers Willing Sacrifice before the opponent's defense roll", () => {
    const activeEffectId = activeEffectIdSchema.parse("active-effect:willing-sacrifice");
    const dependencies = createDependencies([20, 1, 5, 5], [activeEffectId]);
    const fight = requireTransition(
      createFight(
        {
          ...input,
          combatants: [
            input.combatants[0],
            { ...input.combatants[1], moveIds: ["move-haokiru-willing-sacrifice"] },
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
          id: combatDecisionIdSchema.parse("decision:willing-sacrifice-attack"),
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
    const choice = defense.options.find((option) =>
      option.id.startsWith("activate-before-defense:move-haokiru-willing-sacrifice:"),
    );

    expect(choice).toMatchObject({
      type: "activate-effect",
      moveId: "move-haokiru-willing-sacrifice",
      effectIndices: [1],
    });
  });

  it("resolves the grouped x20 Kaioken beam response through the defense decision", () => {
    const dependencies = createDependencies([20, 1, 1, 1]);
    const fight = requireTransition(
      createFight(
        {
          ...input,
          combatants: [
            { ...input.combatants[0], moveIds: ["move-afterlife-kamehameha"] },
            { ...input.combatants[1], moveIds: ["move-afterlife-x20-kaioken-kamehameha"] },
          ],
        },
        dependencies,
      ),
    );
    const initialAction = requireActiveState(
      requireTransition(advanceFight(fight.state, dependencies)).state,
    );
    const action = {
      ...initialAction,
      turnNumber: 10,
      combatants: {
        ...initialAction.combatants,
        [attackerId]: {
          ...initialAction.combatants[attackerId],
          stats: { ...initialAction.combatants[attackerId].stats, power: 0 },
        },
        [defenderId]: {
          ...initialAction.combatants[defenderId],
          stats: { ...initialAction.combatants[defenderId].stats, power: 100 },
          ki: { current: 10, maximum: 10 },
        },
      },
    } satisfies ActiveFightState;
    const declared = requireTransition(
      submitCombatDecision(
        action,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:x20-beam-response-attack"),
          actorId: attackerId,
          expectedStateVersion: action.version,
          moveId: "move-afterlife-kamehameha",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    const defense = requireActiveState(declared.state).pendingDecision;
    if (defense === undefined) throw new Error("Expected beam defense response.");
    const choice = defense.options.find(
      (option) => option.moveId === "move-afterlife-x20-kaioken-kamehameha",
    );
    expect(choice).toMatchObject({
      type: "activate-effect",
      moveId: "move-afterlife-x20-kaioken-kamehameha",
      effectIndices: [2, 3, 4],
    });
    if (choice === undefined) throw new Error("Expected x20 beam response choice.");

    const counterReady = requireTransition(
      submitCombatDecision(
        declared.state,
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:x20-beam-response-accept"),
          actorId: defenderId,
          expectedStateVersion: declared.state.version,
          pendingDecisionId: defense.id,
          optionId: choice.id,
        },
        dependencies,
      ),
    );
    const counterDecision = enumerateLegalDecisions(counterReady.state, defenderId).find(
      (candidate) =>
        candidate.type === "use-move" &&
        candidate.moveId === "move-afterlife-x20-kaioken-kamehameha",
    );
    expect(counterDecision).toMatchObject({
      type: "use-move",
      actorId: defenderId,
      moveId: "move-afterlife-x20-kaioken-kamehameha",
      targetCombatantId: attackerId,
    });
    if (counterDecision === undefined) throw new Error("Expected x20 counter decision.");
    const resolvedResult = submitCombatDecision(
      counterReady.state,
      {
        ...counterDecision,
        id: combatDecisionIdSchema.parse("decision:x20-counter-attack"),
        expectedStateVersion: counterReady.state.version,
      },
      dependencies,
    );
    if (!resolvedResult.ok) throw new Error(JSON.stringify(resolvedResult.error));
    const resolved = requireTransition(resolvedResult);

    expect(resolved.state).toMatchObject({ phase: "end", resolutionFrames: [] });
    expect(resolved.state.actionHistory.at(-1)).toMatchObject({
      type: "use-move",
      moveId: "move-afterlife-x20-kaioken-kamehameha",
    });
    expect(counterReady.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "defense-rolled", result: 0 }),
        expect.objectContaining({ type: "attack-resolved", outcome: "successful" }),
        expect.objectContaining({
          type: "hp-changed",
          sourceCombatantId: defenderId,
          targetCombatantId: attackerId,
          amount: -30,
          remainingHitPoints: 70,
        }),
      ]),
    );
    expect(counterReady.state.combatants[attackerId].hitPoints.current).toBe(70);
  });

  it("forces a targeted opponent reroll and expires it after the next attack action", () => {
    const bracedEffectId = activeEffectIdSchema.parse("active-effect:braced-energy-beam");
    const dependencies = createTestCombatDependencies(
      [20, 1, 5],
      new Date("2026-08-06T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:braced-energy-beam")],
        combatantIds: [attackerId, defenderId],
        eventIds: Array.from({ length: 20 }, (_, index) =>
          combatEventIdSchema.parse(`event:braced-energy-beam-${index + 1}`),
        ),
        pendingDecisionIds: [
          pendingDecisionIdSchema.parse("pending-decision:braced-energy-beam-defense"),
          pendingDecisionIdSchema.parse("pending-decision:braced-energy-beam-post-roll"),
        ],
        resolutionFrameIds: [
          resolutionFrameIdSchema.parse("resolution-frame:braced-energy-beam-defense"),
          resolutionFrameIdSchema.parse("resolution-frame:braced-energy-beam-post-roll"),
        ],
        activeEffectIds: [bracedEffectId],
      },
    );
    const fight = requireTransition(createFight(input, dependencies));
    const action = requireActiveState(
      requireTransition(advanceFight(fight.state, dependencies)).state,
    );
    const armed: ActiveFightState = {
      ...action,
      activeEffects: [
        {
          id: bracedEffectId,
          type: "reroll",
          sourceCombatantId: defenderId,
          targetCombatantId: attackerId,
          sourceDefinitionId: "move-aoyosumu-braced-energy-beam",
          sourceEffectIndex: 0,
          roll: "attack",
          rerollScope: "entire-attack",
          bonus: 0,
          conditions: [
            {
              type: "roll-threshold",
              roll: "attack",
              comparison: "at-least",
              value: { type: "literal", value: 20 },
              sourceText: "attack roll result is 20 or higher",
            },
          ],
          optional: false,
          useLimit: { scope: "turn", remaining: 1 },
          duration: { type: "next-action", combatantId: attackerId },
        },
      ],
    };
    const declared = requireTransition(
      submitCombatDecision(
        armed,
        {
          type: "basic-attack",
          id: combatDecisionIdSchema.parse("decision:braced-energy-beam-attack"),
          actorId: attackerId,
          expectedStateVersion: armed.version,
          basicAttack: "basic-punch",
          targetCombatantId: defenderId,
        },
        dependencies,
      ),
    );
    const defense = requireActiveState(declared.state).pendingDecision;
    if (defense === undefined) throw new Error("Expected Braced Energy Beam defense response.");
    const rolled = requireTransition(
      submitCombatDecision(
        declared.state,
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:braced-energy-beam-roll"),
          actorId: defenderId,
          expectedStateVersion: declared.state.version,
          pendingDecisionId: defense.id,
          optionId: "roll-defense",
        },
        dependencies,
      ),
    );
    const post = requireActiveState(rolled.state).pendingDecision;
    if (post === undefined) throw new Error("Expected mandatory Braced Energy Beam reroll.");
    expect(post).toMatchObject({ combatantId: attackerId });
    expect(post.options).not.toContainEqual({ id: "decline", type: "decline" });
    const rerollOption = post.options.find((option) => option.id.startsWith("activate-reroll:"));
    if (rerollOption === undefined) throw new Error("Expected Braced Energy Beam reroll option.");

    const resolved = requireTransition(
      submitCombatDecision(
        rolled.state,
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:braced-energy-beam-reroll"),
          actorId: attackerId,
          expectedStateVersion: rolled.state.version,
          pendingDecisionId: post.id,
          optionId: rerollOption.id,
        },
        dependencies,
      ),
    );
    expect(resolved.state.version).toBe(rolled.state.version + 1);
    expect(resolved.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "attack-rolled", naturalResult: 5 }),
        expect.objectContaining({ type: "attack-resolved" }),
      ]),
    );
    expect(resolved.state.activeEffects).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: bracedEffectId })]),
    );
  });

  it("offers Zen Explosion only when the current defense result is at most 7", () => {
    const resolveDefense = (defenseRoll: number, suffix: string) => {
      const dependencies = createTestCombatDependencies(
        [10, defenseRoll, 10, defenseRoll],
        new Date("2026-08-06T12:00:00.000Z"),
        {
          fightIds: [fightIdSchema.parse(`fight:zen-${suffix}`)],
          combatantIds: [attackerId, defenderId],
          eventIds: Array.from({ length: 20 }, (_, index) =>
            combatEventIdSchema.parse(`event:zen-${suffix}-${index + 1}`),
          ),
          pendingDecisionIds: [
            pendingDecisionIdSchema.parse(`pending-decision:zen-${suffix}-defense`),
            pendingDecisionIdSchema.parse(`pending-decision:zen-${suffix}-post-roll`),
          ],
          resolutionFrameIds: [
            resolutionFrameIdSchema.parse(`resolution-frame:zen-${suffix}-defense`),
            resolutionFrameIdSchema.parse(`resolution-frame:zen-${suffix}-post-roll`),
          ],
          activeEffectIds: [activeEffectIdSchema.parse(`active-effect:zen-${suffix}`)],
        },
      );
      const fight = requireTransition(
        createFight(
          {
            ...input,
            combatants: [
              input.combatants[0],
              { ...input.combatants[1], moveIds: ["move-aoyosumu-zen-explosion"] },
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
            id: combatDecisionIdSchema.parse(`decision:zen-${suffix}-attack`),
            actorId: attackerId,
            expectedStateVersion: action.version,
            basicAttack: "basic-punch",
            targetCombatantId: defenderId,
          },
          dependencies,
        ),
      );
      const defense = requireActiveState(declared.state).pendingDecision;
      if (defense === undefined) throw new Error("Expected Zen Explosion defense response.");
      return {
        ...requireTransition(
          submitCombatDecision(
            declared.state,
            {
              type: "respond-to-pending-decision",
              id: combatDecisionIdSchema.parse(`decision:zen-${suffix}-roll`),
              actorId: defenderId,
              expectedStateVersion: declared.state.version,
              pendingDecisionId: defense.id,
              optionId: "roll-defense",
            },
            dependencies,
          ),
        ),
        dependencies,
      };
    };

    const eligible = resolveDefense(1, "eligible");
    expect(requireActiveState(eligible.state).activeEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceDefinitionId: "move-aoyosumu-zen-explosion" }),
      ]),
    );
    const eligiblePending = requireActiveState(eligible.state).pendingDecision;
    if (eligiblePending === undefined)
      throw new Error("Expected Zen Explosion post-defense choice.");
    const zenOption = eligiblePending.options.find((option) =>
      option.id.startsWith("activate-reroll:"),
    );
    expect(zenOption).toBeDefined();
    expect(requireActiveState(eligible.state).activeEffects).toContainEqual(
      expect.objectContaining({
        type: "reroll",
        sourceDefinitionId: "move-aoyosumu-zen-explosion",
        conditions: [
          expect.objectContaining({
            type: "roll-threshold",
            comparison: "at-most",
            value: { type: "literal", value: 7 },
          }),
        ],
      }),
    );
    const rerolled = requireTransition(
      submitCombatDecision(
        eligible.state,
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:zen-eligible-reroll"),
          actorId: defenderId,
          expectedStateVersion: eligible.state.version,
          pendingDecisionId: eligiblePending.id,
          optionId: zenOption!.id,
        },
        eligible.dependencies,
      ),
    );
    expect(rerolled.events).toContainEqual(
      expect.objectContaining({ type: "defense-rolled", naturalResult: 10, result: 9 }),
    );

    const ineligible = resolveDefense(10, "ineligible");
    expect(requireActiveState(ineligible.state).pendingDecision).toBeUndefined();
    expect(requireActiveState(ineligible.state).activeEffects).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceDefinitionId: "move-aoyosumu-zen-explosion" }),
      ]),
    );
  });

  it("offers Swift Reaction to the attacker and enforces its KI activation cost", () => {
    const resolve = (ki: number, suffix: string) => {
      const dependencies = createTestCombatDependencies(
        [10, 10, 20, 1],
        new Date("2026-08-06T12:00:00.000Z"),
        {
          fightIds: [fightIdSchema.parse(`fight:swift-${suffix}`)],
          combatantIds: [attackerId, defenderId],
          eventIds: Array.from({ length: 20 }, (_, index) =>
            combatEventIdSchema.parse(`event:swift-${suffix}-${index + 1}`),
          ),
          pendingDecisionIds: [
            pendingDecisionIdSchema.parse(`pending-decision:swift-${suffix}-defense`),
            pendingDecisionIdSchema.parse(`pending-decision:swift-${suffix}-post-roll`),
          ],
          resolutionFrameIds: [
            resolutionFrameIdSchema.parse(`resolution-frame:swift-${suffix}-defense`),
            resolutionFrameIdSchema.parse(`resolution-frame:swift-${suffix}-post-roll`),
          ],
          activeEffectIds: [
            activeEffectIdSchema.parse(`active-effect:swift-${suffix}`),
            activeEffectIdSchema.parse(`active-effect:swift-${suffix}-floating`),
          ],
        },
      );
      const created = createFight(
        {
          ...input,
          combatants: [
            {
              ...input.combatants[0],
              moveIds: ["move-akaikaru-swift-reaction", "move-akaikaru-backflip-kick"],
            },
            {
              ...input.combatants[1],
              moveIds: ["move-aoyosumu-zen-explosion"],
            },
          ],
        },
        dependencies,
      );
      const fight = requireTransition(created);
      const setup = requireActiveState(fight.state);
      const action = requireActiveState(
        requireTransition(
          advanceFight(
            {
              ...setup,
              combatants: {
                ...setup.combatants,
                [attackerId]: {
                  ...setup.combatants[attackerId],
                  ki: { current: ki, maximum: 10 },
                },
              },
            },
            dependencies,
          ),
        ).state,
      );
      const declared = requireTransition(
        submitCombatDecision(
          action,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse(`decision:swift-${suffix}-attack`),
            actorId: attackerId,
            expectedStateVersion: action.version,
            moveId: "move-akaikaru-backflip-kick",
            targetCombatantId: defenderId,
          },
          dependencies,
        ),
      );
      const defense = requireActiveState(declared.state).pendingDecision;
      if (defense === undefined) throw new Error("Expected Swift Reaction defense response.");
      return {
        ...requireTransition(
          submitCombatDecision(
            declared.state,
            {
              type: "respond-to-pending-decision",
              id: combatDecisionIdSchema.parse(`decision:swift-${suffix}-roll`),
              actorId: defenderId,
              expectedStateVersion: declared.state.version,
              pendingDecisionId: defense.id,
              optionId: "roll-defense",
            },
            dependencies,
          ),
        ),
        dependencies,
      };
    };

    const affordable = resolve(3, "affordable");
    const affordablePending = requireActiveState(affordable.state).pendingDecision;
    if (affordablePending === undefined)
      throw new Error(
        JSON.stringify({
          effects: affordable.state.activeEffects,
          events: affordable.events,
        }),
      );
    const swiftOption = affordablePending.options.find((option) =>
      option.id.startsWith("activate-reroll:"),
    );
    expect(swiftOption).toBeDefined();
    const resolved = requireTransition(
      submitCombatDecision(
        affordable.state,
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:swift-affordable-reroll"),
          actorId: attackerId,
          expectedStateVersion: affordable.state.version,
          pendingDecisionId: affordablePending.id,
          optionId: swiftOption!.id,
        },
        affordable.dependencies,
      ),
    );
    expect(resolved.state.combatants[attackerId].ki.current).toBe(0);
    expect(resolved.events).toContainEqual(
      expect.objectContaining({ type: "attack-rolled", naturalResult: 20 }),
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
    expect(resolved.state.actionHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "use-move",
          resourceChanges: expect.arrayContaining([
            expect.objectContaining({
              affectedCombatantId: defenderId,
              resource: "ki",
              operation: "lose",
            }),
          ]),
        }),
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
