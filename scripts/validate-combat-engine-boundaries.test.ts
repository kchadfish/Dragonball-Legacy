import { describe, expect, it } from "vitest";

import { validateCombatEngineBoundaries } from "./validate-combat-engine-boundaries.js";

describe("combat-engine boundary validation", () => {
  it("accepts the declared public workspace dependencies", async () => {
    await expect(validateCombatEngineBoundaries()).resolves.toEqual([]);
  });
});
