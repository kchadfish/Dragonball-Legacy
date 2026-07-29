import { describe, expect, it } from "vitest";

import { COMBAT_RESULTS, CORE_STATUS_DEFINITIONS, EFFECT_OPERATIONS } from "./combat-vocabulary.js";

describe("combat vocabulary", () => {
  it("keeps results, statuses, and operations as separate vocabularies", () => {
    expect(COMBAT_RESULTS.map(({ id }) => id)).toEqual([
      "successful",
      "stopped",
      "critical",
      "counter",
    ]);
    expect(CORE_STATUS_DEFINITIONS.map(({ id }) => id)).toEqual([
      "stun",
      "break",
      "sever",
      "cooldown",
    ]);
    expect(EFFECT_OPERATIONS.map(({ id }) => id)).toEqual([
      "deactivate",
      "negate",
      "lock",
      "suppress",
    ]);
  });
});
