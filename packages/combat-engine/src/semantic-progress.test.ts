import { describe, expect, it } from "vitest";

import { RULES_VERSION } from "@dragonball-resurgence/game-config";

import type { ActiveFightState } from "./contracts.js";
import { activeEffectIdSchema, combatantIdSchema, fightIdSchema } from "./ids.js";
import {
  createCombatSemanticProgressIdentity,
  hasSameCombatSemanticProgress,
} from "./semantic-progress.js";

const actorId = combatantIdSchema.parse("combatant:semantic-actor");
const opponentId = combatantIdSchema.parse("combatant:semantic-opponent");

const state = (): ActiveFightState => ({
  id: fightIdSchema.parse("fight:semantic-a"),
  schemaVersion: 4,
  version: 1,
  rulesVersion: RULES_VERSION,
  mode: "spar",
  turnNumber: 4,
  combatants: {
    [actorId]: {
      id: actorId,
      hitPoints: { current: 80, maximum: 100 },
      ki: { current: 5, maximum: 10 },
      stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
      moveIds: [],
      moveUses: {},
      activeStatuses: [],
      status: "active",
    },
    [opponentId]: {
      id: opponentId,
      hitPoints: { current: 70, maximum: 100 },
      ki: { current: 4, maximum: 10 },
      stats: { power: 20, dexterity: 10, dexterityBonus: 0 },
      moveIds: [],
      moveUses: {},
      activeStatuses: [],
      status: "active",
    },
  },
  activeEffects: [
    {
      id: activeEffectIdSchema.parse("active-effect:semantic-a"),
      type: "action-restriction",
      sourceCombatantId: actorId,
      targetCombatantId: opponentId,
      sourceDefinitionId: "move-test",
      sourceEffectIndex: 0,
      availableFromTurn: 4,
      remainingTurns: 2,
    },
  ],
  actionHistory: [],
  resolutionFrames: [],
  scheduledWork: [],
  eventSequence: 8,
  status: "active",
  phase: "action",
  activeCombatantId: actorId,
});

describe("combat semantic progress identity", () => {
  it("ignores transition bookkeeping and opaque generated-ID values", () => {
    const first = state();
    const second: ActiveFightState = {
      ...first,
      id: fightIdSchema.parse("fight:semantic-b"),
      version: 99,
      eventSequence: 500,
      activeEffects: [
        {
          ...first.activeEffects[0]!,
          id: activeEffectIdSchema.parse("active-effect:semantic-b"),
        },
      ],
    };

    expect(hasSameCombatSemanticProgress(first, second)).toBe(true);
    expect(createCombatSemanticProgressIdentity(first)).toEqual(
      createCombatSemanticProgressIdentity(second),
    );
  });

  it("counts duration and scheduled-work changes as combat progress", () => {
    const first = state();
    const restriction = first.activeEffects.find((effect) => effect.type === "action-restriction");
    if (restriction === undefined) throw new Error("Expected an action restriction fixture.");
    const durationChanged: ActiveFightState = {
      ...first,
      activeEffects: [{ ...restriction, remainingTurns: 1 }],
    };
    const scheduledChanged: ActiveFightState = {
      ...first,
      scheduledWork: [
        {
          id: "scheduled-work:semantic" as never,
          insertionOrder: 0,
          ownerCombatantId: actorId,
          timing: { type: "next-upkeep", combatantId: actorId, turnNumber: 5 },
          targetCombatantId: opponentId,
          operation: { type: "skip-action", reason: "effect" },
        },
      ],
    };

    expect(hasSameCombatSemanticProgress(first, durationChanged)).toBe(false);
    expect(hasSameCombatSemanticProgress(first, scheduledChanged)).toBe(false);
  });
});
