import { describe, expect, it } from "vitest";

import { validateAiEngineBoundaries } from "./validate-ai-engine-boundaries.js";

describe("ai-engine boundary validation", () => {
  it("accepts the approved public workspace boundary", async () => {
    await expect(validateAiEngineBoundaries()).resolves.toEqual([]);
  });
});
