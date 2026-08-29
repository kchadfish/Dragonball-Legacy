import { ITEM_DEFINITIONS } from "@dragonball-resurgence/game-data";
import { describe, expect, it } from "vitest";

import type { CreateFightInput } from "./contracts.js";
import { createFight } from "./create-fight.js";
import {
  combatDecisionIdSchema,
  combatantIdSchema,
  combatEventIdSchema,
  fightIdSchema,
} from "./ids.js";
import {
  applyCombatItemPassives,
  combatItemPreventedOutcomes,
  itemResourceGainForRace,
  itemUseLimitForCombatant,
  resolveItemResources,
} from "./item-effects-runtime.js";
import { advanceFight, enumerateLegalDecisions, submitCombatDecision } from "./progress-fight.js";
import { createTestCombatDependencies } from "./testing/index.js";

const self = {
  id: "combatant:self" as never,
  hitPoints: { current: 50, maximum: 100 },
  ki: { current: 5, maximum: 10 },
  stats: { power: 10, dexterity: 5, dexterityBonus: 0 },
  moveIds: [],
  moveUses: {},
  activeStatuses: [],
  status: "active" as const,
};

describe("item effect runtime", () => {
  it.each(["item-technology-spare-parts", "item-technology-cybernetic-replacements"])(
    "extracts the exact BREAK/SEVER prevention outcomes for %s",
    (itemId) => {
      const item = ITEM_DEFINITIONS.find((candidate) => candidate.id === itemId);
      if (item === undefined) throw new Error(`Expected ${itemId} data.`);

      expect(combatItemPreventedOutcomes(item)).toEqual(["break", "sever"]);
    },
  );

  it("applies passive, combat-relevant equipment statistics at fight creation", () => {
    const heroicTunic = ITEM_DEFINITIONS.find(
      (candidate) => candidate.id === "item-equipment-heroic-tunic",
    );
    if (heroicTunic === undefined) throw new Error("Expected Heroic Tunic data.");

    expect(applyCombatItemPassives(self, [heroicTunic])).toMatchObject({
      hitPoints: { current: 56, maximum: 112 },
      stats: self.stats,
    });
  });

  it("resolves converted non-spaceship item resource effects with resource caps", () => {
    const item = ITEM_DEFINITIONS.find((candidate) =>
      candidate.effects?.some((effect) => effect.type === "item-modify-resource"),
    );
    if (item === undefined) throw new Error("Expected converted item resource data.");

    const result = resolveItemResources(item, "on-item-use", self);
    expect(result.hitPoints).toBeGreaterThanOrEqual(0);
    expect(result.hitPoints).toBeLessThanOrEqual(self.hitPoints.maximum);
    expect(result.ki).toBeGreaterThanOrEqual(0);
    expect(result.ki).toBeLessThanOrEqual(self.ki.maximum);
  });

  it("offers, consumes, records, and caps a combat resource item without ending the turn", () => {
    const firstCombatantId = combatantIdSchema.parse("combatant:item-user");
    const secondCombatantId = combatantIdSchema.parse("combatant:item-opponent");
    const dependencies = createTestCombatDependencies([], new Date("2026-08-06T12:00:00.000Z"), {
      fightIds: [fightIdSchema.parse("fight:item-use")],
      combatantIds: [firstCombatantId, secondCombatantId],
      eventIds: [
        combatEventIdSchema.parse("event:item-fight-started"),
        combatEventIdSchema.parse("event:item-turn-started"),
        combatEventIdSchema.parse("event:item-action"),
        combatEventIdSchema.parse("event:item-used"),
        combatEventIdSchema.parse("event:item-ki"),
      ],
    });
    const input: CreateFightInput = {
      mode: "spar",
      combatants: [
        {
          maximumHitPoints: 100,
          stats: { power: 10, dexterity: 2, dexterityBonus: 0 },
          moveIds: [],
          itemIds: ["item-equipment-senzu-root"],
        },
        {
          maximumHitPoints: 100,
          stats: { power: 10, dexterity: 1, dexterityBonus: 0 },
          moveIds: [],
        },
      ],
    };
    const created = createFight(input, dependencies);
    if (!created.ok) throw new Error("Expected valid fight setup.");
    const action = advanceFight(created.value.state, dependencies);
    if (!action.ok || action.value.state.status !== "active")
      throw new Error("Expected action state.");

    expect(enumerateLegalDecisions(action.value.state, firstCombatantId)).toContainEqual({
      type: "use-item",
      actorId: firstCombatantId,
      itemId: "item-equipment-senzu-root",
    });

    const used = submitCombatDecision(
      action.value.state,
      {
        type: "use-item",
        id: combatDecisionIdSchema.parse("decision:use-senzu-root"),
        actorId: firstCombatantId,
        expectedStateVersion: 1,
        itemId: "item-equipment-senzu-root",
      },
      dependencies,
    );
    if (!used.ok || used.value.state.status !== "active")
      throw new Error("Expected used item state.");

    expect(used.value.state).toMatchObject({ version: 2, phase: "action" });
    expect(used.value.state.combatants[firstCombatantId]).toMatchObject({
      ki: { current: 8 },
      itemUses: { "item-equipment-senzu-root": 1 },
    });
    expect(used.value.events).toEqual([
      expect.objectContaining({ type: "item-used", itemId: "item-equipment-senzu-root" }),
      expect.objectContaining({ type: "ki-changed", amount: 3, remainingKi: 8 }),
    ]);
    expect(enumerateLegalDecisions(used.value.state, firstCombatantId)).not.toContainEqual({
      type: "use-item",
      actorId: firstCombatantId,
      itemId: "item-equipment-senzu-root",
    });
  });

  it("executes the common on-move-use resource primitive for a converted healing item", () => {
    const firstCombatantId = combatantIdSchema.parse("combatant:common-item-user");
    const secondCombatantId = combatantIdSchema.parse("combatant:common-item-opponent");
    const dependencies = createTestCombatDependencies([], new Date("2026-08-12T12:00:00.000Z"), {
      fightIds: [fightIdSchema.parse("fight:common-item-use")],
      combatantIds: [firstCombatantId, secondCombatantId],
      eventIds: [
        combatEventIdSchema.parse("event:common-item-fight-started"),
        combatEventIdSchema.parse("event:common-item-turn-started"),
        combatEventIdSchema.parse("event:common-item-action"),
        combatEventIdSchema.parse("event:common-item-used"),
        combatEventIdSchema.parse("event:common-item-phase"),
      ],
    });
    const created = createFight(
      {
        mode: "spar",
        combatants: [
          {
            maximumHitPoints: 100,
            stats: { power: 10, dexterity: 2, dexterityBonus: 0 },
            moveIds: [],
            itemIds: ["item-equipment-first-aid-kit"],
          },
          {
            maximumHitPoints: 100,
            stats: { power: 10, dexterity: 1, dexterityBonus: 0 },
            moveIds: [],
          },
        ],
      },
      dependencies,
    );
    if (!created.ok) throw new Error("Expected valid fight setup.");
    const action = advanceFight(created.value.state, dependencies);
    if (!action.ok || action.value.state.status !== "active")
      throw new Error("Expected action state.");

    expect(enumerateLegalDecisions(action.value.state, firstCombatantId)).toContainEqual({
      type: "use-item",
      actorId: firstCombatantId,
      itemId: "item-equipment-first-aid-kit",
    });
    const used = submitCombatDecision(
      action.value.state,
      {
        type: "use-item",
        id: combatDecisionIdSchema.parse("decision:use-first-aid-kit"),
        actorId: firstCombatantId,
        expectedStateVersion: 1,
        itemId: "item-equipment-first-aid-kit",
      },
      dependencies,
    );
    if (!used.ok || used.value.state.status !== "active")
      throw new Error("Expected used item state.");

    expect(used.value.state).toMatchObject({ version: 2, phase: "end" });
    expect(used.value.state.combatants[firstCombatantId]).toMatchObject({
      hitPoints: { current: 100 },
      itemUses: { "item-equipment-first-aid-kit": 1 },
    });
    expect(used.value.events).toContainEqual(
      expect.objectContaining({ type: "item-used", itemId: "item-equipment-first-aid-kit" }),
    );
    expect(enumerateLegalDecisions(used.value.state, firstCombatantId)).not.toContainEqual(
      expect.objectContaining({
        type: "use-item",
        itemId: "item-equipment-first-aid-kit",
      }),
    );
  });

  it("allows a Majin to use Majin Cookies twice while ordinary races retain the one-use limit", () => {
    const item = ITEM_DEFINITIONS.find(
      (candidate) => candidate.id === "item-equipment-majin-cookies",
    );
    if (item === undefined) throw new Error("Expected Majin Cookies data.");
    expect(itemUseLimitForCombatant(item, { ...self, raceId: "race-majins" })).toBe(2);
    expect(itemUseLimitForCombatant(item, { ...self, raceId: "race-humans" })).toBe(1);
    expect(item.effects).toContainEqual(
      expect.objectContaining({
        operation: "limit-race-item-uses",
        raceId: "race-majins",
        amount: 2,
      }),
    );
  });

  it("grants Black Water Mist's conditional Ki only to a Makyan", () => {
    const item = ITEM_DEFINITIONS.find(
      (candidate) => candidate.id === "item-equipment-black-water-mist",
    );
    if (item === undefined) throw new Error("Expected Black Water Mist data.");
    expect(itemResourceGainForRace(item, { ...self, raceId: "race-makyans" }).ki).toBe(3);
    expect(itemResourceGainForRace(item, { ...self, raceId: "race-humans" }).ki).toBe(0);
    expect(item.effects).toContainEqual(
      expect.objectContaining({
        operation: "grant-resource-when-race",
        raceId: "race-makyans",
        resource: "ki",
        amount: 3,
      }),
    );
  });

  it("keeps a combat-duration item roll modifier in deterministic fight state", () => {
    const firstCombatantId = combatantIdSchema.parse("combatant:drink-user");
    const secondCombatantId = combatantIdSchema.parse("combatant:drink-opponent");
    const dependencies = createTestCombatDependencies(
      [32, 1],
      new Date("2026-08-06T12:00:00.000Z"),
      {
        fightIds: [fightIdSchema.parse("fight:hercule-drink")],
        combatantIds: [firstCombatantId, secondCombatantId],
        activeEffectIds: ["active-effect:hercule-drink" as never],
        eventIds: [
          "event:drink-fight-started",
          "event:drink-turn-started",
          "event:drink-action",
          "event:drink-used",
          "event:drink-effect",
          "event:drink-phase",
        ].map((id) => combatEventIdSchema.parse(id)),
      },
    );
    const created = createFight(
      {
        mode: "spar",
        combatants: [
          {
            maximumHitPoints: 100,
            stats: { power: 10, dexterity: 2, dexterityBonus: 0 },
            moveIds: [],
            itemIds: ["item-equipment-hercule-drink"],
          },
          {
            maximumHitPoints: 100,
            stats: { power: 10, dexterity: 1, dexterityBonus: 0 },
            moveIds: [],
          },
        ],
      },
      dependencies,
    );
    if (!created.ok) throw new Error("Expected valid fight setup.");
    const action = advanceFight(created.value.state, dependencies);
    if (!action.ok || action.value.state.status !== "active")
      throw new Error("Expected action state.");
    const used = submitCombatDecision(
      action.value.state,
      {
        type: "use-item",
        id: combatDecisionIdSchema.parse("decision:drink"),
        actorId: firstCombatantId,
        expectedStateVersion: 1,
        itemId: "item-equipment-hercule-drink",
      },
      dependencies,
    );
    if (!used.ok || used.value.state.status !== "active")
      throw new Error("Expected used item state.");
    expect(used.value.state.activeEffects).toEqual([
      expect.objectContaining({
        type: "modify-roll",
        roll: "attack",
        modifier: "sides",
        amount: 2,
        duration: "combat",
      }),
    ]);
    expect(used.value.events).toContainEqual(
      expect.objectContaining({
        type: "effect-activated",
        sourceDefinitionId: "item-equipment-hercule-drink",
      }),
    );

    expect(used.value.state.phase).toBe("end");
  });

  it("retains Yema's attack count and temporary Dexterity effects through item activation", () => {
    const firstCombatantId = combatantIdSchema.parse("combatant:yema-user");
    const secondCombatantId = combatantIdSchema.parse("combatant:yema-opponent");
    const dependencies = createTestCombatDependencies([], new Date("2026-08-06T12:00:00.000Z"), {
      fightIds: [fightIdSchema.parse("fight:yema")],
      combatantIds: [firstCombatantId, secondCombatantId],
      activeEffectIds: [
        "active-effect:yema-damage" as never,
        "active-effect:yema-dex" as never,
        "active-effect:yema-comparison" as never,
      ],
      eventIds: [
        "event:yema-fight-started",
        "event:yema-turn-started",
        "event:yema-action",
        "event:yema-used",
        "event:yema-ki",
        "event:yema-damage",
        "event:yema-dex",
        "event:yema-comparison",
      ].map((id) => combatEventIdSchema.parse(id)),
    });
    const created = createFight(
      {
        mode: "spar",
        combatants: [
          {
            maximumHitPoints: 100,
            stats: { power: 10, dexterity: 2, dexterityBonus: 0 },
            moveIds: [],
            itemIds: ["item-equipment-yema-fruit"],
          },
          {
            maximumHitPoints: 100,
            stats: { power: 10, dexterity: 1, dexterityBonus: 0 },
            moveIds: [],
          },
        ],
      },
      dependencies,
    );
    if (!created.ok) throw new Error("Expected valid fight setup.");
    const action = advanceFight(created.value.state, dependencies);
    if (!action.ok || action.value.state.status !== "active")
      throw new Error("Expected action state.");
    const used = submitCombatDecision(
      action.value.state,
      {
        type: "use-item",
        id: combatDecisionIdSchema.parse("decision:yema"),
        actorId: firstCombatantId,
        expectedStateVersion: 1,
        itemId: "item-equipment-yema-fruit",
      },
      dependencies,
    );
    if (!used.ok || used.value.state.status !== "active")
      throw new Error("Expected used item state.");

    expect(used.value.state.phase).toBe("action");
    expect(used.value.state.combatants[firstCombatantId].ki.current).toBe(3);
    expect(used.value.state.activeEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "modify-item-next-attack-damage", remainingAttacks: 3 }),
        expect.objectContaining({ type: "modify-stat", stat: "dexterity-bonus", amount: 3 }),
        expect.objectContaining({ type: "set-stat-comparison", comparison: "higher-than" }),
      ]),
    );
  });
});
