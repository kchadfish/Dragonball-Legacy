import { describe, expect, it } from "vitest";

import { ITEM_DEFINITIONS } from "./item-definitions.js";
import { validateItemDefinitions } from "./validation.js";

describe("item definitions", () => {
  it("converts every item in the three canonical item sources", () => {
    expect(ITEM_DEFINITIONS).toHaveLength(162);
    expect(new Set(ITEM_DEFINITIONS.map((item) => item.id))).toHaveLength(ITEM_DEFINITIONS.length);
    expect(ITEM_DEFINITIONS.every((item) => item.id.startsWith("item-"))).toBe(true);
    expect(new Set(ITEM_DEFINITIONS.map((item) => item.source.path))).toEqual(
      new Set([
        "reference/items/equipment.md",
        "reference/items/ships.md",
        "reference/items/technology.md",
      ]),
    );
    expect(ITEM_DEFINITIONS.every((item) => item.source.text.includes(item.name))).toBe(true);
    expect(ITEM_DEFINITIONS.every((item) => item.source.text.includes(item.effectText))).toBe(true);
    expect(
      ITEM_DEFINITIONS.every(
        (item) =>
          item.effectClauses.length > 0 &&
          item.effectClauses.every((clause) => item.effectText.includes(clause.text)),
      ),
    ).toBe(true);
    expect(
      ITEM_DEFINITIONS.flatMap((item) => item.rules)
        .filter((rule) => !rule.executable)
        .every((rule) => rule.unresolvedReason !== undefined),
    ).toBe(true);
    expect(
      ITEM_DEFINITIONS.every(
        (item) =>
          item.rules.length === item.effectClauses.length &&
          item.rules.every((rule) => item.effectText.includes(rule.sourceText)),
      ),
    ).toBe(true);
    expect(
      ITEM_DEFINITIONS.every((item) =>
        item.rules
          .filter((rule) => rule.executable)
          .every((rule) =>
            (item.effects ?? []).some(
              (effect) => effect.sourceClauseOrder === rule.sourceClauseOrder,
            ),
          ),
      ),
    ).toBe(true);
  });

  it("preserves item economy, availability, equipment, and ship metadata", () => {
    const vitalityX = ITEM_DEFINITIONS.find((item) => item.id === "item-equipment-vitality-x");
    const trainingWeight = ITEM_DEFINITIONS.find(
      (item) => item.id === "item-equipment-training-weight",
    );
    const yemaFruit = ITEM_DEFINITIONS.find((item) => item.id === "item-equipment-yema-fruit");
    const capsuleShip = ITEM_DEFINITIONS.find(
      (item) => item.id === "item-ships-capsule-corp-space-ship",
    );
    const lockOnSystem = ITEM_DEFINITIONS.find((item) => item.id === "item-ships-lock-on-system");
    const generalVest = ITEM_DEFINITIONS.find((item) => item.id === "item-equipment-general-vest");
    const dragonRadar = ITEM_DEFINITIONS.find((item) => item.id === "item-technology-dragon-radar");
    const spareParts = ITEM_DEFINITIONS.find((item) => item.id === "item-technology-spare-parts");
    const enhancedFightingJacket = ITEM_DEFINITIONS.find(
      (item) => item.id === "item-equipment-enhanced-capsule-corp-fighting-jacket",
    );

    expect(vitalityX).toMatchObject({
      category: "consumable",
      price: 300,
      availability: "listed",
      locations: ["New Vegeta"],
      maxUses: 1,
    });
    expect(trainingWeight).toMatchObject({
      category: "equipment",
      inventorySlots: 1,
      inventorySlotCondition: "(0 if you have a Martial Arts Gi)",
    });
    expect(yemaFruit).toMatchObject({ availability: "unavailable", locations: [] });
    expect(yemaFruit?.price).toBeUndefined();
    expect(capsuleShip).toMatchObject({
      category: "ship",
      price: 2500,
      ship: {
        maximumCapacity: 2,
        weaponSlots: 1,
        defenseSlots: 3,
        travelDays: 4,
        supportSystems: ["Gravitron (+5% EXP when Sparring)"],
      },
    });
    expect(lockOnSystem).toMatchObject({
      category: "ship-addon",
      shipSlot: "weapon",
      price: 800,
    });
    expect(lockOnSystem?.maxUses).toBeUndefined();
    expect(
      ITEM_DEFINITIONS.filter((item) =>
        item.effects?.some((effect) => effect.type === "modify-resource"),
      ).map((item) => item.id),
    ).toEqual([
      "item-equipment-first-aid-kit",
      "item-equipment-1-3-senzu-bean",
      "item-equipment-1-2-senzu-bean",
      "item-equipment-senzu-bean",
      "item-equipment-bag-of-senzu-beans",
    ]);
    expect(generalVest?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "item-modify-stat-percent",
          stat: "dexterity",
          percent: 5,
        }),
      ]),
    );
    expect(lockOnSystem?.effects).toEqual([
      expect.objectContaining({
        type: "item-space-combat",
        role: "challenger",
        operation: "roll-defense-twice-use-lower",
      }),
    ]);
    expect(dragonRadar?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "item-reduce-duration",
          activity: "dragon-ball-search",
          amount: 3,
          minimum: 2,
          unit: "days",
        }),
      ]),
    );
    expect(spareParts?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "item-prevent-combat-outcome",
          outcomes: ["break", "sever"],
        }),
      ]),
    );
    expect(enhancedFightingJacket?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "item-modify-damage",
          attackCount: 1,
          duration: { unit: "combat", value: 1 },
        }),
      ]),
    );
    expect(ITEM_DEFINITIONS.every((item) => item.effects !== undefined)).toBe(true);
  });

  it("converts activation KI costs into typed item effects", () => {
    const heroicTunic = ITEM_DEFINITIONS.find((item) => item.id === "item-equipment-heroic-tunic");
    expect(heroicTunic?.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "item-state-rule",
          operation: "pay-activation-ki",
          amount: 1,
        }),
      ]),
    );
  });

  it("rejects broken item data", () => {
    const item = ITEM_DEFINITIONS[0];

    expect(
      validateItemDefinitions([
        {
          ...item,
          id: "bad item",
          availability: "listed",
          locations: [],
          inventorySlots: -1,
        },
      ]),
    ).toEqual(
      expect.arrayContaining([
        "Invalid item ID: bad item",
        "Invalid item inventory slots: bad item",
        "Missing listed item locations: bad item",
      ]),
    );
  });
});
