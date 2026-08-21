import { describe, expect, it } from "vitest";

import type { ActiveFightState, FightState } from "./contracts.js";
import { advanceFight, createFight, submitCombatDecision } from "./index.js";
import {
  combatDecisionIdSchema,
  combatantIdSchema,
  combatEventIdSchema,
  fightIdSchema,
  pendingDecisionIdSchema,
  resolutionFrameIdSchema,
} from "./ids.js";
import { createTestCombatDependencies } from "./testing/index.js";
import { validateFightState } from "./invariants.js";

const attackerId = combatantIdSchema.parse("combatant:deactivation-attacker");
const defenderId = combatantIdSchema.parse("combatant:deactivation-defender");

const dependencies = () =>
  createTestCombatDependencies(
    Array.from({ length: 12 }, (_, index) => (index % 2 === 0 ? 30 : 1)),
    new Date("2026-08-07T12:00:00.000Z"),
    {
      fightIds: [fightIdSchema.parse("fight:deactivation")],
      combatantIds: [attackerId, defenderId],
      eventIds: Array.from({ length: 24 }, (_, index) =>
        combatEventIdSchema.parse(`event:deactivation-${index}`),
      ),
      pendingDecisionIds: [
        pendingDecisionIdSchema.parse("pending-decision:deactivation-1"),
        pendingDecisionIdSchema.parse("pending-decision:deactivation-2"),
      ],
      resolutionFrameIds: [resolutionFrameIdSchema.parse("resolution-frame:deactivation-1")],
      activeEffectIds: [
        "active-effect:redirected-energy-1" as never,
        "active-effect:redirected-energy-2" as never,
      ],
    },
  );

const value = <T>(result: { readonly ok: boolean; readonly value?: T }) => {
  if (!result.ok || result.value === undefined)
    throw new Error("Expected a successful transition.");
  return result.value;
};

const active = (state: FightState): ActiveFightState => {
  if (state.status !== "active") throw new Error("Expected active state.");
  return state;
};

const actionStateWithConstants = () => {
  const deps = dependencies();
  const created = value(
    createFight(
      {
        mode: "spar",
        combatants: [
          {
            maximumHitPoints: 200,
            stats: { power: 20, dexterity: 5, dexterityBonus: 0 },
            moveIds: ["move-akaikaru-back-brain-kick"],
          },
          {
            maximumHitPoints: 500,
            stats: { power: 20, dexterity: 5, dexterityBonus: 0 },
            moveIds: ["move-aoyosumu-inner-peace", "move-aoyosumu-state-of-zen"],
          },
        ],
      },
      deps,
    ),
  );
  const action = active(value(advanceFight(created.state, deps)).state);
  return {
    deps,
    state: {
      ...action,
      activeEffects: [
        {
          id: "active-effect:inner-peace" as never,
          type: "active-constant" as const,
          sourceCombatantId: defenderId,
          targetCombatantId: defenderId,
          sourceDefinitionId: "move-aoyosumu-inner-peace",
          activatedOnTurn: 1,
          duration: "combat" as const,
        },
        {
          id: "active-effect:state-of-zen" as never,
          type: "active-constant" as const,
          sourceCombatantId: defenderId,
          targetCombatantId: defenderId,
          sourceDefinitionId: "move-aoyosumu-state-of-zen",
          activatedOnTurn: 1,
          duration: "combat" as const,
        },
      ],
    } satisfies ActiveFightState,
  };
};

const actionStateWithRedirectedEnergy = () => {
  const result = actionStateWithConstants();
  return {
    ...result,
    state: {
      ...result.state,
      combatants: {
        ...result.state.combatants,
        [defenderId]: {
          ...result.state.combatants[defenderId],
          moveIds: [
            ...result.state.combatants[defenderId].moveIds,
            "move-kiihakai-redirected-energy",
          ],
        },
      },
    } satisfies ActiveFightState,
  };
};

describe("constant-skill deactivation decisions", () => {
  it("continues normally when the declared selector has no active constant target", () => {
    const { deps, state } = actionStateWithConstants();
    const inactive = { ...state, activeEffects: [] } satisfies ActiveFightState;
    const transition = value(
      submitCombatDecision(
        inactive,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:deactivation-no-target"),
          actorId: attackerId,
          expectedStateVersion: inactive.version,
          moveId: "move-akaikaru-back-brain-kick",
          targetCombatantId: defenderId,
        },
        deps,
      ),
    );
    expect(active(transition.state).pendingDecision).toBeUndefined();
    expect(transition.events).not.toContainEqual(
      expect.objectContaining({ type: "effect-deactivated" }),
    );
  });

  it("suspends a successful deactivation with multiple eligible constants and resolves exactly one", () => {
    const { deps, state } = actionStateWithConstants();
    const attack = value(
      submitCombatDecision(
        state,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:deactivation-attack"),
          actorId: attackerId,
          expectedStateVersion: state.version,
          moveId: "move-akaikaru-back-brain-kick",
          targetCombatantId: defenderId,
        },
        deps,
      ),
    );
    const pending = active(attack.state).pendingDecision;
    expect(pending).toMatchObject({ type: "select-move", combatantId: attackerId });
    expect(pending?.options).toHaveLength(2);

    const resolved = value(
      submitCombatDecision(
        active(attack.state),
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:deactivation-choice"),
          actorId: attackerId,
          expectedStateVersion: active(attack.state).version,
          pendingDecisionId: pending!.id,
          optionId: pending!.options[0].id,
        },
        deps,
      ),
    );
    expect(active(resolved.state).pendingDecision).toBeUndefined();
    expect(active(resolved.state).activeEffects).toHaveLength(2);
    expect(active(resolved.state).activeEffects).toEqual(
      expect.arrayContaining([expect.objectContaining({ lifecycle: "deactivated" })]),
    );
    expect(resolved.events).toEqual([expect.objectContaining({ type: "effect-deactivated" })]);
    expect(
      submitCombatDecision(
        active(resolved.state),
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:deactivation-replay"),
          actorId: attackerId,
          expectedStateVersion: active(attack.state).version,
          pendingDecisionId: pending!.id,
          optionId: pending!.options[0].id,
        },
        deps,
      ),
    ).toMatchObject({ ok: false, error: { type: "stale-decision" } });
  });

  it("dispatches Redirected Energy after a constant skill deactivation", () => {
    const { deps, state } = actionStateWithRedirectedEnergy();
    const attack = value(
      submitCombatDecision(
        state,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:redirected-energy-attack"),
          actorId: attackerId,
          expectedStateVersion: state.version,
          moveId: "move-akaikaru-back-brain-kick",
          targetCombatantId: defenderId,
        },
        deps,
      ),
    );
    const pending = active(attack.state).pendingDecision;
    if (pending === undefined) throw new Error("Expected a deactivation selection.");
    const transition = value(
      submitCombatDecision(
        active(attack.state),
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:redirected-energy-choice"),
          actorId: attackerId,
          expectedStateVersion: active(attack.state).version,
          pendingDecisionId: pending.id,
          optionId: pending.options[0].id,
        },
        deps,
      ),
    );
    const resolved = active(transition.state);

    expect(resolved.activeEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "modify-next-action",
          sourceDefinitionId: "move-kiihakai-redirected-energy",
          targetCombatantId: defenderId,
          scope: "next-action",
          selector: expect.objectContaining({ styleId: "style-kiihakai" }),
          modifier: { type: "cost", operation: "add", amount: 0 },
        }),
      ]),
    );
    expect(transition.events).toEqual([expect.objectContaining({ type: "effect-deactivated" })]);
    expect(validateFightState(resolved)).toEqual([]);
  });

  it("rejects illegal and stale selection responses without changing the suspended state", () => {
    const { deps, state } = actionStateWithConstants();
    const attack = value(
      submitCombatDecision(
        state,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:deactivation-attack-illegal"),
          actorId: attackerId,
          expectedStateVersion: state.version,
          moveId: "move-akaikaru-back-brain-kick",
          targetCombatantId: defenderId,
        },
        deps,
      ),
    );
    const suspended = active(attack.state);
    const pending = suspended.pendingDecision!;
    expect(
      submitCombatDecision(
        suspended,
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:deactivation-illegal"),
          actorId: attackerId,
          expectedStateVersion: suspended.version,
          pendingDecisionId: pending.id,
          optionId: "not-an-option",
        },
        deps,
      ),
    ).toMatchObject({ ok: false, error: { type: "invalid-pending-decision-option" } });
    expect(
      submitCombatDecision(
        suspended,
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:deactivation-stale"),
          actorId: attackerId,
          expectedStateVersion: suspended.version - 1,
          pendingDecisionId: pending.id,
          optionId: pending.options[0].id,
        },
        deps,
      ),
    ).toMatchObject({ ok: false, error: { type: "stale-decision" } });
  });

  it("allows an explicitly optional deactivation to be declined without changing constants", () => {
    const { deps, state } = actionStateWithConstants();
    const attack = value(
      submitCombatDecision(
        state,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:deactivation-optional-attack"),
          actorId: attackerId,
          expectedStateVersion: state.version,
          moveId: "move-akaikaru-back-brain-kick",
          targetCombatantId: defenderId,
        },
        deps,
      ),
    );
    const suspended = active(attack.state);
    const pending = suspended.pendingDecision!;
    const optionalState = {
      ...suspended,
      pendingDecision: {
        ...pending,
        options: [...pending.options, { id: "decline", type: "decline" as const }],
      },
      resolutionFrames: suspended.resolutionFrames.map((frame) =>
        frame.type === "effect" && frame.pendingDecisionId === pending.id
          ? { ...frame, optional: true }
          : frame,
      ),
    } satisfies ActiveFightState;

    const declined = value(
      submitCombatDecision(
        optionalState,
        {
          type: "respond-to-pending-decision",
          id: combatDecisionIdSchema.parse("decision:deactivation-decline"),
          actorId: attackerId,
          expectedStateVersion: optionalState.version,
          pendingDecisionId: pending.id,
          optionId: "decline",
        },
        deps,
      ),
    );
    expect(active(declined.state).pendingDecision).toBeUndefined();
    expect(active(declined.state).activeEffects).toHaveLength(2);
    expect(declined.events).toEqual([]);
  });

  it("reactivates a durably deactivated constant through the normal action boundary", () => {
    const { deps, state } = actionStateWithConstants();
    const attack = value(
      submitCombatDecision(
        state,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:deactivation-reactivation-attack"),
          actorId: attackerId,
          expectedStateVersion: state.version,
          moveId: "move-akaikaru-back-brain-kick",
          targetCombatantId: defenderId,
        },
        deps,
      ),
    );
    const pending = active(attack.state).pendingDecision!;
    const deactivated = active(
      value(
        submitCombatDecision(
          active(attack.state),
          {
            type: "respond-to-pending-decision",
            id: combatDecisionIdSchema.parse("decision:deactivation-reactivation-choice"),
            actorId: attackerId,
            expectedStateVersion: active(attack.state).version,
            pendingDecisionId: pending.id,
            optionId: pending.options[0].id,
          },
          deps,
        ),
      ).state,
    );
    const readyToReactivate = {
      ...deactivated,
      phase: "action" as const,
      activeCombatantId: defenderId,
    } satisfies ActiveFightState;
    const reactivated = active(
      value(
        submitCombatDecision(
          readyToReactivate,
          {
            type: "use-move",
            id: combatDecisionIdSchema.parse("decision:deactivation-reactivate"),
            actorId: defenderId,
            expectedStateVersion: readyToReactivate.version,
            moveId: "move-aoyosumu-inner-peace",
            targetCombatantId: attackerId,
          },
          deps,
        ),
      ).state,
    );
    expect(
      reactivated.activeEffects.filter((effect) => effect.type === "active-constant"),
    ).toHaveLength(2);
    expect(
      reactivated.activeEffects.find(
        (effect) =>
          effect.type === "active-constant" &&
          effect.sourceDefinitionId === "move-aoyosumu-inner-peace",
      ),
    ).toMatchObject({ lifecycle: "active" });
  });

  it("rejects an optional selection frame that omits its required decline response", () => {
    const { deps, state } = actionStateWithConstants();
    const attack = value(
      submitCombatDecision(
        state,
        {
          type: "use-move",
          id: combatDecisionIdSchema.parse("decision:deactivation-malformed-attack"),
          actorId: attackerId,
          expectedStateVersion: state.version,
          moveId: "move-akaikaru-back-brain-kick",
          targetCombatantId: defenderId,
        },
        deps,
      ),
    );
    const suspended = active(attack.state);
    const malformed = {
      ...suspended,
      resolutionFrames: suspended.resolutionFrames.map((frame) =>
        frame.type === "effect" ? { ...frame, optional: true } : frame,
      ),
    } satisfies ActiveFightState;

    expect(validateFightState(malformed)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "invalid-pending-decision" })]),
    );
  });
});
