import { describe, expect, it } from "vitest";

import { RULES_VERSION } from "@dragonball-resurgence/game-config";

import type { ActiveFightState, CompletedFightState } from "./contracts.js";
import { getCombatDecisionPoint } from "./decision-point.js";
import { combatantIdSchema, fightIdSchema, pendingDecisionIdSchema } from "./ids.js";

const actorId = combatantIdSchema.parse("combatant:decision-point-actor");
const opponentId = combatantIdSchema.parse("combatant:decision-point-opponent");

const activeState = (phase: ActiveFightState["phase"]): ActiveFightState => ({
  id: fightIdSchema.parse("fight:decision-point"),
  schemaVersion: 4,
  version: 3,
  rulesVersion: RULES_VERSION,
  mode: "spar",
  turnNumber: 1,
  combatants: {
    [actorId]: {
      id: actorId,
      hitPoints: { current: 100, maximum: 100 },
      ki: { current: 5, maximum: 10 },
      stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
      moveIds: [],
      moveUses: {},
      activeStatuses: [],
      status: "active",
    },
    [opponentId]: {
      id: opponentId,
      hitPoints: { current: 100, maximum: 100 },
      ki: { current: 5, maximum: 10 },
      stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
      moveIds: [],
      moveUses: {},
      activeStatuses: [],
      status: "active",
    },
  },
  activeEffects: [],
  actionHistory: [],
  resolutionFrames: [],
  scheduledWork: [],
  eventSequence: 0,
  status: "active",
  phase,
  activeCombatantId: actorId,
});

describe("combat decision point", () => {
  it("owns normal action decisions and automatically advanceable phases", () => {
    const action = getCombatDecisionPoint(activeState("action"));
    expect(action).toMatchObject({
      type: "decision-required",
      stateVersion: 3,
      actorId,
    });
    if (action.type === "decision-required")
      expect(action.legalDecisions.some((decision) => decision.type === "pass")).toBe(true);

    expect(getCombatDecisionPoint(activeState("upkeep"))).toEqual({
      type: "advance",
      stateVersion: 3,
    });
    expect(getCombatDecisionPoint(activeState("end"))).toEqual({
      type: "advance",
      stateVersion: 3,
    });
  });

  it("uses pending-decision ownership for defense responses", () => {
    const pendingId = pendingDecisionIdSchema.parse("pending-decision:defense-response");
    const state: ActiveFightState = {
      ...activeState("action"),
      pendingDecision: {
        id: pendingId,
        stateVersion: 3,
        combatantId: opponentId,
        type: "defense-response",
        options: [{ id: "roll-defense", type: "roll-defense" }],
      },
    };

    const point = getCombatDecisionPoint(state);
    expect(point).toMatchObject({
      type: "decision-required",
      stateVersion: 3,
      actorId: opponentId,
    });
    if (point.type === "decision-required")
      expect(point.legalDecisions).toEqual([
        {
          type: "respond-to-pending-decision",
          actorId: opponentId,
          pendingDecisionId: pendingId,
          optionId: "roll-defense",
          selectedOptionIds: ["roll-defense"],
        },
      ]);
  });

  it("keeps completion explicit", () => {
    const state: CompletedFightState = {
      ...activeState("action"),
      status: "completed",
      completion: { type: "defeat", winnerCombatantId: actorId },
    };
    Reflect.deleteProperty(state, "phase");
    Reflect.deleteProperty(state, "activeCombatantId");

    expect(getCombatDecisionPoint(state)).toEqual({
      type: "completed",
      completion: { type: "defeat", winnerCombatantId: actorId },
    });
  });
});
