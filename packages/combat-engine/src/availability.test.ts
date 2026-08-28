import { describe, expect, it } from "vitest";

import {
  consumeRemainingUse,
  consumeUse,
  hasRemainingUses,
  isUseAvailable,
} from "./availability.js";

describe("use availability", () => {
  it("treats unrestricted and remaining counters consistently", () => {
    expect(isUseAvailable(0, undefined)).toBe(true);
    expect(isUseAvailable(1, 1)).toBe(false);
    expect(isUseAvailable(0, 1)).toBe(true);
  });

  it("increments valid counters and rejects malformed counters", () => {
    expect(consumeUse(2)).toBe(3);
    expect(() => consumeUse(-1)).toThrow(RangeError);
  });

  it("validates and consumes finite remaining allowances", () => {
    expect(hasRemainingUses(1)).toBe(true);
    expect(hasRemainingUses(0)).toBe(false);
    expect(hasRemainingUses(Number.NaN)).toBe(false);
    expect(consumeRemainingUse(2)).toBe(1);
    expect(consumeRemainingUse(1)).toBe(0);
    expect(() => consumeRemainingUse(0)).toThrow(RangeError);
  });
});
