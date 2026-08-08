import { describe, expect, it } from "vitest";

import type {
  ActiveFightState,
  CombatDecision,
  CombatEvent,
  CombatFailure,
  CombatResult,
} from "./index.js";
import {
  combatDecisionIdSchema,
  combatEventIdSchema,
  combatantIdSchema,
  fightIdSchema,
  pendingDecisionIdSchema,
  resolutionFrameIdSchema,
} from "./index.js";

const fightId = fightIdSchema.parse("fight:opening-spar");
const firstCombatantId = combatantIdSchema.parse("combatant:goku");
const secondCombatantId = combatantIdSchema.parse("combatant:vegeta");
const decisionId = combatDecisionIdSchema.parse("decision:opening-pass");
const eventId = combatEventIdSchema.parse("event:fight-started");
const pendingDecisionId = pendingDecisionIdSchema.parse("pending-decision:reaction-1");
const resolutionFrameId = resolutionFrameIdSchema.parse("resolution-frame:opening-attack");

describe("combat contracts", () => {
  it("models an immutable active fight with a pending decision", () => {
    const state = {
      id: fightId,
      version: 3,
      rulesVersion: { value: "legacy-reference-2026-08", sourcePath: "reference/rules.md" },
      mode: "spar",
      status: "active",
      turnNumber: 2,
      phase: "action",
      activeCombatantId: firstCombatantId,
      activeEffects: [],
      actionHistory: [
        {
          type: "use-move",
          decisionId,
          actorId: firstCombatantId,
          targetCombatantId: secondCombatantId,
          moveId: "move-akaikaru-blown-fuse",
          turnNumber: 2,
          phase: "action",
        },
      ],
      resolutionFrames: [
        {
          id: resolutionFrameId,
          type: "attack",
          decisionId,
          attackerId: firstCombatantId,
          targetCombatantId: secondCombatantId,
          returnPhase: "action",
          stage: "awaiting-defense",
          pendingDecisionId,
          attack: { type: "basic-attack", basicAttack: "basic-punch" },
        },
      ],
      combatants: {
        [firstCombatantId]: {
          id: firstCombatantId,
          hitPoints: { current: 100, maximum: 100 },
          ki: { current: 5, maximum: 10 },
          stats: { power: 20, dexterity: 4, dexterityBonus: 1 },
          moveIds: ["move-akaikaru-blown-fuse"],
          moveUses: { "move-akaikaru-blown-fuse": 1 },
          activeStatuses: [
            {
              statusId: "stun",
              sourceCombatantId: secondCombatantId,
              sourceDefinitionId: "move-akaikaru-blown-fuse",
              stacks: 1,
              duration: { type: "turns", ownerCombatantId: firstCombatantId, remaining: 1 },
            },
          ],
          transformation: {
            transformationId: "transformation-ghost-2-ghoul",
            activatedOnTurn: 1,
          },
          status: "active",
        },
        [secondCombatantId]: {
          id: secondCombatantId,
          hitPoints: { current: 80, maximum: 100 },
          ki: { current: 4, maximum: 10 },
          stats: { power: 20, dexterity: 3, dexterityBonus: 0 },
          moveIds: [],
          moveUses: {},
          activeStatuses: [],
          status: "active",
        },
      },
      pendingDecision: {
        id: pendingDecisionId,
        stateVersion: 3,
        combatantId: firstCombatantId,
        type: "optional-effect",
        options: [{ id: "decline", type: "decline" }],
      },
      eventSequence: 6,
    } satisfies ActiveFightState;

    expect(state.pendingDecision.stateVersion).toBe(state.version);
    expect(state.combatants[firstCombatantId].ki.current).toBe(5);
    expect(state.resolutionFrames[0].id).toBe(resolutionFrameId);
  });

  it("uses discriminated decisions, events, and results", () => {
    const decision: CombatDecision = {
      type: "respond-to-pending-decision",
      id: decisionId,
      actorId: firstCombatantId,
      expectedStateVersion: 3,
      pendingDecisionId,
      optionId: "decline",
    };
    const event: CombatEvent = {
      type: "fight-started",
      id: eventId,
      sequence: 1,
      fightId,
      mode: "spar",
    };
    const result: CombatResult<typeof event> = { ok: true, value: event };
    const statusEvent: CombatEvent = {
      type: "status-applied",
      id: eventId,
      sequence: 2,
      fightId,
      sourceCombatantId: firstCombatantId,
      targetCombatantId: secondCombatantId,
      statusId: "stun",
      stacks: 1,
    };
    const failure: CombatFailure = {
      type: "signature-turn-requirement",
      moveId: "move-akaikaru-blown-fuse",
      minimumTurn: 10,
      currentTurn: 2,
    };

    expect(decision.type).toBe("respond-to-pending-decision");
    expect(result.value.type).toBe("fight-started");
    expect(statusEvent.type).toBe("status-applied");
    expect(failure.type).toBe("signature-turn-requirement");
  });

  it("accepts only lowercase namespaced engine IDs", () => {
    expect(fightIdSchema.safeParse("fight:opening-spar").success).toBe(true);
    expect(fightIdSchema.safeParse("fight:Opening-Spar").success).toBe(false);
    expect(combatantIdSchema.safeParse("fight:opening-spar").success).toBe(false);
    expect(pendingDecisionIdSchema.safeParse("pending-decision:reaction-1").success).toBe(true);
    expect(resolutionFrameIdSchema.safeParse("resolution-frame:attack-1").success).toBe(true);
  });
});
