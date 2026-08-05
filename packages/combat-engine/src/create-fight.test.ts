import { describe, expect, it } from "vitest";

import type { CreateFightInput, FightState } from "./index.js";
import { createFight } from "./index.js";
import {
  combatantIdSchema,
  combatEventIdSchema,
  fightIdSchema,
  pendingDecisionIdSchema,
} from "./ids.js";
import { validateFightState } from "./invariants.js";
import { createTestCombatDependencies } from "./testing/index.js";

const firstCombatantId = combatantIdSchema.parse("combatant:goku");
const secondCombatantId = combatantIdSchema.parse("combatant:vegeta");

const input: CreateFightInput = {
  mode: "spar",
  activeCombatantIndex: 1,
  combatants: [
    {
      maximumHitPoints: 150,
      stats: { power: 20, dexterity: 4, dexterityBonus: 1 },
      moveIds: ["move-freestyle-hidden-power-level"],
    },
    {
      maximumHitPoints: 125,
      stats: { power: 18, dexterity: 5, dexterityBonus: 2 },
      moveIds: ["move-afterlife-give-me-energy"],
    },
  ],
};

const createDependencies = () =>
  createTestCombatDependencies([], new Date("2026-08-04T12:00:00.000Z"), {
    fightIds: [fightIdSchema.parse("fight:opening-spar")],
    combatantIds: [firstCombatantId, secondCombatantId],
    eventIds: [
      combatEventIdSchema.parse("event:fight-started"),
      combatEventIdSchema.parse("event:turn-started"),
    ],
  });

describe("createFight", () => {
  it("creates a deterministic, valid initial 1v1 state without mutating setup input", () => {
    const originalInput = structuredClone(input);
    const result = createFight(input, createDependencies());

    expect(result).toEqual({
      ok: true,
      value: {
        state: {
          id: fightIdSchema.parse("fight:opening-spar"),
          version: 0,
          rulesVersion: { value: "legacy-reference-2026-08", sourcePath: "reference/rules.md" },
          mode: "spar",
          status: "active",
          turnNumber: 1,
          phase: "upkeep",
          activeCombatantId: secondCombatantId,
          activeEffects: [],
          combatants: {
            [firstCombatantId]: {
              id: firstCombatantId,
              hitPoints: { current: 150, maximum: 150 },
              ki: { current: 5, maximum: 10 },
              stats: { power: 20, dexterity: 4, dexterityBonus: 1 },
              moveIds: ["move-freestyle-hidden-power-level"],
              status: "active",
            },
            [secondCombatantId]: {
              id: secondCombatantId,
              hitPoints: { current: 125, maximum: 125 },
              ki: { current: 5, maximum: 10 },
              stats: { power: 18, dexterity: 5, dexterityBonus: 2 },
              moveIds: ["move-afterlife-give-me-energy"],
              status: "active",
            },
          },
          eventSequence: 2,
        },
        events: [
          {
            id: combatEventIdSchema.parse("event:fight-started"),
            sequence: 1,
            fightId: fightIdSchema.parse("fight:opening-spar"),
            type: "fight-started",
            mode: "spar",
          },
          {
            id: combatEventIdSchema.parse("event:turn-started"),
            sequence: 2,
            fightId: fightIdSchema.parse("fight:opening-spar"),
            type: "turn-started",
            combatantId: secondCombatantId,
            turnNumber: 1,
          },
        ],
      },
    });
    expect(input).toEqual(originalInput);
  });

  it("rejects malformed setup before consuming fight IDs", () => {
    const result = createFight(
      {
        ...input,
        activeCombatantIndex: 2,
        combatants: [input.combatants[0]],
      },
      createDependencies(),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        type: "invalid-fight-setup",
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "activeCombatantIndex" }),
          expect.objectContaining({ path: "combatants" }),
        ]),
      },
    });
  });

  it("rejects duplicate moves in a combatant's initial move list", () => {
    const result = createFight(
      {
        ...input,
        combatants: [
          {
            ...input.combatants[0],
            moveIds: ["move-freestyle-hidden-power-level", "move-freestyle-hidden-power-level"],
          },
          input.combatants[1],
        ],
      },
      createDependencies(),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        type: "invalid-fight-setup",
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "combatants.0.moveIds.1" }),
        ]),
      },
    });
  });

  it("accepts the configured negative Dexterity Bonus range and rejects values above it", () => {
    const negativeBonusResult = createFight(
      {
        ...input,
        combatants: [
          { ...input.combatants[0], stats: { ...input.combatants[0].stats, dexterityBonus: -4 } },
          input.combatants[1],
        ],
      },
      createDependencies(),
    );
    const excessiveBonusResult = createFight(
      {
        ...input,
        combatants: [
          { ...input.combatants[0], stats: { ...input.combatants[0].stats, dexterityBonus: 6 } },
          input.combatants[1],
        ],
      },
      createDependencies(),
    );

    expect(negativeBonusResult.ok).toBe(true);
    expect(excessiveBonusResult).toMatchObject({
      ok: false,
      error: {
        type: "invalid-fight-setup",
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "combatants.0.stats.dexterityBonus" }),
        ]),
      },
    });
  });

  it("rejects a move ID that is not present in converted game data", () => {
    const result = createFight(
      {
        ...input,
        combatants: [
          { ...input.combatants[0], moveIds: ["move-not-converted"] },
          input.combatants[1],
        ],
      },
      createDependencies(),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        type: "invalid-fight-setup",
        issues: expect.arrayContaining([
          expect.objectContaining({
            path: "combatants.0.moveIds.0",
            message: expect.stringContaining("Unknown move ID"),
          }),
        ]),
      },
    });
  });

  it("returns a typed state failure when an ID source produces duplicate combatant IDs", () => {
    const result = createFight(
      input,
      createTestCombatDependencies([], new Date("2026-08-04T12:00:00.000Z"), {
        fightIds: [fightIdSchema.parse("fight:opening-spar")],
        combatantIds: [firstCombatantId, firstCombatantId],
        eventIds: [
          combatEventIdSchema.parse("event:fight-started"),
          combatEventIdSchema.parse("event:turn-started"),
        ],
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        type: "invalid-fight-state",
        violations: expect.arrayContaining([
          expect.objectContaining({ type: "invalid-combatant-count" }),
        ]),
      },
    });
  });
});

describe("validateFightState", () => {
  it("identifies broken state counters, resources, and active combatant ownership", () => {
    const createdFight = createFight(input, createDependencies());
    if (!createdFight.ok) throw new Error("Expected initial fight creation to succeed.");

    const invalidState = {
      ...createdFight.value.state,
      version: -1,
      activeCombatantId: firstCombatantId,
      combatants: {
        ...createdFight.value.state.combatants,
        [firstCombatantId]: {
          ...createdFight.value.state.combatants[firstCombatantId],
          ki: { current: 11, maximum: 10 },
          status: "defeated",
        },
      },
    } as FightState;

    expect(validateFightState(invalidState)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "invalid-state-counter" }),
        expect.objectContaining({ type: "invalid-resource", subject: firstCombatantId }),
        expect.objectContaining({ type: "invalid-active-combatant", subject: firstCombatantId }),
      ]),
    );
  });

  it("identifies malformed pending decisions and completed-fight winners", () => {
    const createdFight = createFight(input, createDependencies());
    if (!createdFight.ok) throw new Error("Expected initial fight creation to succeed.");

    const invalidPendingDecisionState = {
      ...createdFight.value.state,
      pendingDecision: {
        id: pendingDecisionIdSchema.parse("pending-decision:choose-effect"),
        stateVersion: 1,
        combatantId: firstCombatantId,
        type: "optional-effect",
        options: [],
      },
    } as FightState;
    const invalidCompletedState = {
      ...createdFight.value.state,
      status: "completed",
      completion: { type: "defeat" },
    } as FightState;

    expect(validateFightState(invalidPendingDecisionState)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "invalid-pending-decision" })]),
    );
    expect(validateFightState(invalidCompletedState)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "invalid-completion" })]),
    );
  });
});
