import { describe, expect, it } from "vitest";

import {
  CANONICAL_COMBAT_MECHANICS_VIEW,
  createCombatMechanicsView,
  createCombatRuntime,
  enumerateLegalDecisions,
  mechanicsViewIdentitySchema,
} from "./index.js";
import { createTestCombatDependencies } from "./testing/index.js";
import { combatantIdSchema, combatEventIdSchema, fightIdSchema } from "./ids.js";

const inputForView = () => ({
  rules: structuredClone(CANONICAL_COMBAT_MECHANICS_VIEW.rules),
  rulesVersion: structuredClone(CANONICAL_COMBAT_MECHANICS_VIEW.rulesVersion),
  moves: structuredClone(CANONICAL_COMBAT_MECHANICS_VIEW.moves),
  items: structuredClone(CANONICAL_COMBAT_MECHANICS_VIEW.items),
  transformations: structuredClone(CANONICAL_COMBAT_MECHANICS_VIEW.transformations),
  races: structuredClone(CANONICAL_COMBAT_MECHANICS_VIEW.races),
  genericClasses: structuredClone(CANONICAL_COMBAT_MECHANICS_VIEW.genericClasses),
});

describe("combat mechanics views", () => {
  it("validates the opaque identity at the snapshot boundary", () => {
    expect(
      mechanicsViewIdentitySchema.safeParse(CANONICAL_COMBAT_MECHANICS_VIEW.identity).success,
    ).toBe(true);
    expect(
      mechanicsViewIdentitySchema.safeParse({
        schemaVersion: "combat-mechanics-view:v1",
        contentHash: "not-a-sha256",
      }).success,
    ).toBe(false);
  });

  it("hashes deterministic content and freezes copied catalogs", () => {
    const input = inputForView();
    const view = createCombatMechanicsView(input);
    const equivalent = createCombatMechanicsView(inputForView());

    expect(view.identity).toEqual(equivalent.identity);
    expect(view.identity.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.moves[0])).toBe(true);

    const sourceMove = input.moves[0];
    (sourceMove as { name: string }).name = "mutated source";
    expect(view.moves[0]?.name).not.toBe("mutated source");
  }, 30_000);

  it("binds creation and resume validation to one alternate environment", () => {
    const input = inputForView();
    input.rules = {
      ...input.rules,
      combat: { ...input.rules.combat, startingKi: 7 },
    };
    const alternate = createCombatMechanicsView(input);
    const runtime = createCombatRuntime(alternate);
    const dependencies = createTestCombatDependencies([], new Date("2026-08-30T00:00:00.000Z"), {
      fightIds: [fightIdSchema.parse("fight:mechanics-view")],
      combatantIds: [
        combatantIdSchema.parse("combatant:mechanics-view-a"),
        combatantIdSchema.parse("combatant:mechanics-view-b"),
      ],
      eventIds: [
        combatEventIdSchema.parse("event:mechanics-view-start"),
        combatEventIdSchema.parse("event:mechanics-view-turn"),
      ],
    });
    const created = runtime.createFight(
      {
        mode: "spar",
        combatants: [
          {
            maximumHitPoints: 100,
            stats: { power: 20, dexterity: 5, dexterityBonus: 0 },
            moveIds: [],
          },
          {
            maximumHitPoints: 100,
            stats: { power: 20, dexterity: 4, dexterityBonus: 0 },
            moveIds: [],
          },
        ],
      },
      dependencies,
    );

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.state.mechanicsView).toEqual(alternate.identity);
    expect(Object.values(created.value.state.combatants)[0]?.ki.current).toBe(7);
    expect(runtime.validateFightState(created.value.state)).toEqual([]);
    const firstCombatantId = combatantIdSchema.parse(
      Object.keys(created.value.state.combatants)[0],
    );
    expect(enumerateLegalDecisions(created.value.state, firstCombatantId)).toEqual([]);

    const canonicalAttempt = createCombatRuntime().advanceFight(created.value.state, dependencies);
    expect(canonicalAttempt).toEqual({
      ok: false,
      error: expect.objectContaining({ type: "mechanics-view-mismatch" }),
    });
  });
});
