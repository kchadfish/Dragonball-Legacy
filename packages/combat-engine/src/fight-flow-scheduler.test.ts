import { describe, expect, it } from "vitest";

import {
  consumeScheduledCombatWork,
  dueScheduledCombatWork,
  applyScheduledPhaseOperation,
  executeScheduledCombatResult,
  orderScheduledCombatWork,
  scheduleCombatWork,
  scheduledCombatResultOperation,
  scheduledPhaseOperation,
  scheduledSkipActionOperation,
  scheduledWorkFromCounterFrame,
  scheduledWorkFromLegacyEffect,
  scheduledWorkFromResolutionFrame,
  type ScheduledCombatWork,
} from "./fight-flow-scheduler.js";
import {
  activeEffectIdSchema,
  combatantIdSchema,
  combatDecisionIdSchema,
  resolutionFrameIdSchema,
  scheduledWorkIdSchema,
} from "./ids.js";
import type { ActiveDeferredMoveEffect, ActiveExtraActionEffect } from "./contracts.js";

const owner = combatantIdSchema.parse("combatant:owner");
const opponent = combatantIdSchema.parse("combatant:opponent");

const work = (
  id: string,
  insertionOrder: number,
  timing: ScheduledCombatWork["timing"],
): ScheduledCombatWork => ({
  id: scheduledWorkIdSchema.parse(id),
  insertionOrder,
  ownerCombatantId: owner,
  targetCombatantId: opponent,
  timing,
  operation: {
    type: "resource",
    resource: "ki",
    operation: "gain",
    amount: { type: "literal", value: 1 },
    sourceEffectIndex: 0,
    boundary: { type: "turn-start", combatantId: owner },
    remainingBoundaries: 1,
    repeat: "once",
  },
});

describe("fight-flow scheduler", () => {
  it("executes result prevention and replacement before downstream handling", () => {
    const replacement = scheduledCombatResultOperation({
      sourceId: "decision:result-replacement",
      result: "stopped",
      replacement: "successful",
    });
    const prevented = scheduledCombatResultOperation({
      sourceId: "decision:result-prevented",
      result: "successful",
      prevented: true,
    });

    expect(executeScheduledCombatResult(replacement.operation)).toBe("successful");
    expect(executeScheduledCombatResult(prevented.operation)).toBe("stopped");
    expect(replacement.timing).toEqual({ type: "immediate" });
  });

  it("centralizes phase and active-owner mutation in a scheduler operation", () => {
    const operation = scheduledPhaseOperation("counter", opponent);
    const state = { phase: "action" as const, activeCombatantId: owner, marker: "preserved" };

    expect(applyScheduledPhaseOperation(state, operation)).toEqual({
      phase: "counter",
      activeCombatantId: opponent,
      marker: "preserved",
    });
    expect(state).toEqual({ phase: "action", activeCombatantId: owner, marker: "preserved" });
  });

  it("represents full-action restrictions as explicit scheduler work", () => {
    expect(scheduledSkipActionOperation("status")).toEqual({
      type: "skip-action",
      reason: "status",
    });
  });

  it("assigns stable insertion order without mutating existing work", () => {
    const existing = [work("scheduled-work:second", 2, { type: "immediate" })];
    const created = scheduleCombatWork(
      {
        timing: { type: "immediate" },
        operation: {
          type: "resource",
          resource: "hp",
          operation: "gain",
          amount: { type: "literal", value: 2 },
          sourceEffectIndex: 0,
          boundary: { type: "turn-start", combatantId: owner },
          remainingBoundaries: 1,
          repeat: "once",
        },
      },
      () => scheduledWorkIdSchema.parse("scheduled-work:third"),
      existing,
    );

    expect(created.insertionOrder).toBe(3);
    expect(existing).toEqual([work("scheduled-work:second", 2, { type: "immediate" })]);
  });

  it("orders due work by insertion order and supports every timing boundary", () => {
    const workItems = [
      work("scheduled-work:delayed", 3, {
        type: "delayed",
        combatantId: owner,
        phase: "action",
        turnNumber: 3,
      }),
      work("scheduled-work:immediate", 2, { type: "immediate" }),
      work("scheduled-work:upkeep", 1, { type: "next-upkeep", combatantId: owner, turnNumber: 3 }),
      work("scheduled-work:end", 4, { type: "end-of-action", combatantId: owner, turnNumber: 3 }),
    ];

    expect(orderScheduledCombatWork(workItems).map(({ id }) => id)).toEqual([
      "scheduled-work:upkeep",
      "scheduled-work:immediate",
      "scheduled-work:delayed",
      "scheduled-work:end",
    ]);
    expect(
      dueScheduledCombatWork(workItems, { phase: "upkeep", combatantId: owner, turnNumber: 3 }).map(
        ({ id }) => id,
      ),
    ).toEqual(["scheduled-work:upkeep", "scheduled-work:immediate"]);
    expect(
      dueScheduledCombatWork(workItems, {
        phase: "action",
        combatantId: owner,
        turnNumber: 3,
        actionCompleted: true,
      }).map(({ id }) => id),
    ).toEqual(["scheduled-work:immediate", "scheduled-work:delayed", "scheduled-work:end"]);
  });

  it("consumes only identified work and preserves the original queue", () => {
    const workItems = [
      work("scheduled-work:first", 1, { type: "immediate" }),
      work("scheduled-work:last", 2, { type: "immediate" }),
    ];
    const remaining = consumeScheduledCombatWork(
      workItems,
      new Set([scheduledWorkIdSchema.parse("scheduled-work:first")]),
    );

    expect(remaining.map(({ id }) => id)).toEqual(["scheduled-work:last"]);
    expect(workItems).toHaveLength(2);
  });

  it("migrates a v1 extra-action effect using deterministic provenance and timing", () => {
    const legacyEffect: ActiveExtraActionEffect = {
      id: activeEffectIdSchema.parse("active-effect:legacy-extra"),
      type: "extra-action",
      sourceCombatantId: owner,
      targetCombatantId: opponent,
      sourceDefinitionId: "move:legacy-source",
      sourceEffectIndex: 2,
      phase: "action",
      sourceMoveOnly: false,
      constant: false,
      remainingActions: 2,
      availableFromTurn: 4,
      expiresAfterTurn: 5,
    };

    expect(scheduledWorkFromLegacyEffect(legacyEffect, 3, 7)).toEqual({
      id: "scheduled-work:legacy-extra-action-legacy-extra",
      insertionOrder: 7,
      sourceEffectId: legacyEffect.id,
      sourceDefinitionId: legacyEffect.sourceDefinitionId,
      ownerCombatantId: owner,
      targetCombatantId: opponent,
      timing: { type: "delayed", combatantId: opponent, phase: "action", turnNumber: 4 },
      operation: {
        type: "extra-action",
        phase: "action",
        sourceMoveOnly: false,
        constant: false,
        remainingActions: 2,
        availableFromTurn: 4,
        expiresAfterTurn: 5,
      },
    });
  });

  it("serializes an awaiting counter frame as a single immediate counter operation", () => {
    const frame = {
      id: resolutionFrameIdSchema.parse("resolution-frame:counter-opportunity"),
      type: "attack" as const,
      decisionId: combatDecisionIdSchema.parse("decision:original-attack"),
      attackerId: owner,
      targetCombatantId: opponent,
      returnPhase: "action" as const,
      stage: "awaiting-counter" as const,
    };

    expect(scheduledWorkFromCounterFrame(frame, 4)).toEqual({
      id: "scheduled-work:mirror-counter-counter-opportunity",
      insertionOrder: 4,
      ownerCombatantId: opponent,
      targetCombatantId: owner,
      timing: { type: "immediate" },
      operation: {
        type: "counter",
        sourceActionId: frame.decisionId,
        returnFrameId: frame.id,
        chainDepth: 1,
      },
    });
    expect(scheduledWorkFromResolutionFrame(frame, 5)).toEqual({
      id: "scheduled-work:mirror-frame-counter-opportunity",
      insertionOrder: 5,
      timing: { type: "immediate" },
      operation: { type: "resume-frame", frameId: frame.id },
    });
  });

  it("migrates deferred moves with enough provenance for deterministic execution", () => {
    const legacyEffect: ActiveDeferredMoveEffect = {
      id: activeEffectIdSchema.parse("active-effect:legacy-deferred"),
      type: "deferred-move",
      sourceCombatantId: owner,
      targetCombatantId: opponent,
      sourceDefinitionId: "move:legacy-source",
      sourceEffectIndex: 1,
      declarationDecisionId: combatDecisionIdSchema.parse("decision:legacy-deferred"),
      performOnTurn: 4,
      damageOverridePercent: 75,
      cancellation: { actorCombatantId: opponent, result: "successful" },
      onCancellation: { affectedType: "attack", duration: "combat" },
    };

    expect(scheduledWorkFromLegacyEffect(legacyEffect, 3, 8)).toEqual({
      id: "scheduled-work:legacy-deferred-move-legacy-deferred",
      insertionOrder: 8,
      sourceEffectId: legacyEffect.id,
      sourceDefinitionId: legacyEffect.sourceDefinitionId,
      ownerCombatantId: owner,
      targetCombatantId: opponent,
      timing: {
        type: "delayed",
        combatantId: owner,
        phase: "action",
        turnNumber: 4,
      },
      operation: {
        type: "deferred-move",
        moveId: legacyEffect.sourceDefinitionId,
        sourceEffectIndex: 1,
        declarationDecisionId: legacyEffect.declarationDecisionId,
        cancellation: legacyEffect.cancellation,
        damageOverridePercent: 75,
        onCancellation: { affectedType: "attack", duration: "combat" },
      },
    });
  });

  it("migrates recurring resource work with its boundary and lifecycle facts", () => {
    const legacyEffect = {
      id: activeEffectIdSchema.parse("active-effect:legacy-resource"),
      type: "scheduled-resource" as const,
      sourceCombatantId: owner,
      targetCombatantId: opponent,
      sourceDefinitionId: "move-afterlife-burning-shoot" as const,
      sourceEffectIndex: 0,
      timing: { type: "phase-start" as const, combatantId: opponent, phase: "upkeep" as const },
      remainingBoundaries: 1,
      repeat: "each-turn" as const,
      resource: "hp" as const,
      operation: "damage" as const,
      amount: { type: "literal" as const, value: 4 },
      duration: { type: "turns" as const, remaining: 2 },
    };

    expect(scheduledWorkFromLegacyEffect(legacyEffect, 3, 9)).toMatchObject({
      id: "scheduled-work:legacy-scheduled-resource-legacy-resource",
      timing: {
        type: "delayed",
        combatantId: opponent,
        phase: "upkeep",
        turnNumber: 3,
      },
      operation: {
        type: "resource",
        resource: "hp",
        operation: "damage",
        amount: { type: "literal", value: 4 },
        sourceEffectIndex: 0,
        boundary: legacyEffect.timing,
        remainingBoundaries: 1,
        repeat: "each-turn",
        duration: { type: "turns", remaining: 2 },
      },
    });
  });
});
