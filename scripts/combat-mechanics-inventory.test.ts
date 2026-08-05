import { describe, expect, it } from "vitest";

import { createCombatMechanicsInventory } from "./combat-mechanics-inventory.js";

describe("combat mechanics inventory", () => {
  it("accounts for every converted move and identifies non-executable source content", () => {
    const inventory = createCombatMechanicsInventory();

    expect(inventory.moveDefinitions.total).toBeGreaterThan(0);
    expect(
      inventory.moveDefinitions.withEffects + inventory.moveDefinitions.withoutEffects.length,
    ).toBe(inventory.moveDefinitions.total);
    expect(inventory.effects.byOrigin.move).toBeGreaterThan(0);
    expect(inventory.itemDefinitions.nonExecutableRules).toBeGreaterThan(0);
  });
});
