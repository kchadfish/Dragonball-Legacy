import { describe, expect, it } from "vitest";

import type { ActiveFightState, CombatDecision, CombatEvent, CombatResult } from "./index.js";
import {
  combatDecisionIdSchema,
  combatEventIdSchema,
  combatantIdSchema,
  fightIdSchema,
  pendingDecisionIdSchema,
} from "./index.js";

const fightId = fightIdSchema.parse("fight:opening-spar");
const firstCombatantId = combatantIdSchema.parse("combatant:goku");
const secondCombatantId = combatantIdSchema.parse("combatant:vegeta");
const decisionId = combatDecisionIdSchema.parse("decision:opening-pass");
const eventId = combatEventIdSchema.parse("event:fight-started");
const pendingDecisionId = pendingDecisionIdSchema.parse("pending-decision:reaction-1");

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
      combatants: {
        [firstCombatantId]: {
          id: firstCombatantId,
          hitPoints: { current: 100, maximum: 100 },
          ki: { current: 5, maximum: 10 },
          stats: { power: 20, dexterity: 4, dexterityBonus: 1 },
          moveIds: ["move-akaikaru-blown-fuse"],
          status: "active",
        },
        [secondCombatantId]: {
          id: secondCombatantId,
          hitPoints: { current: 80, maximum: 100 },
          ki: { current: 4, maximum: 10 },
          stats: { power: 20, dexterity: 3, dexterityBonus: 0 },
          moveIds: [],
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

    expect(state.pendingDecision?.stateVersion).toBe(state.version);
    expect(state.combatants[firstCombatantId]?.ki.current).toBe(5);
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

    expect(decision.type).toBe("respond-to-pending-decision");
    expect(result.ok && result.value.type).toBe("fight-started");
  });

  it("accepts only lowercase namespaced engine IDs", () => {
    expect(fightIdSchema.safeParse("fight:opening-spar").success).toBe(true);
    expect(fightIdSchema.safeParse("fight:Opening-Spar").success).toBe(false);
    expect(combatantIdSchema.safeParse("fight:opening-spar").success).toBe(false);
    expect(pendingDecisionIdSchema.safeParse("pending-decision:reaction-1").success).toBe(true);
  });
});
