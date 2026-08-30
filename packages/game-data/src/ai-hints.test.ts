import { describe, expect, it } from "vitest";

import { validateAiHintsMetadata } from "./validation.js";

describe("AI hint metadata", () => {
  it("accepts bounded advisory roles and follow-up weights", () => {
    expect(
      validateAiHintsMetadata({
        version: "ai-hints:v1",
        roles: ["setup", "control"],
        followUpPreferences: [{ category: "move", tags: ["beam"], weight: 0.5 }],
      }),
    ).toEqual([]);
  });

  it("rejects unknown roles, versions, and unbounded weights", () => {
    expect(
      validateAiHintsMetadata({
        version: "ai-hints:v9",
        roles: ["invented"],
        followUpPreferences: [{ category: "move", weight: 2 }],
      }),
    ).toHaveLength(3);
  });
});
