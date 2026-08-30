import { describe, expect, it } from "vitest";

import { createAiRandomSource } from "./random.js";

const createRandom = () =>
  createAiRandomSource({
    rootSeed: 456,
    profileVersion: "profile-v1",
    evaluatorVersion: "evaluator-v1",
    purpose: "test",
  });

describe("AI keyed randomness", () => {
  it("reproduces keyed probability, noise, mistake, and tie values", () => {
    const first = createRandom();
    const second = createRandom();

    expect(first.probability("decision:a", 50)).toBe(second.probability("decision:a", 50));
    expect(first.boundedScoreNoise("decision:a", -3, 3)).toBe(
      second.boundedScoreNoise("decision:a", -3, 3),
    );
    expect(
      first.selectMistake("mistake", [
        { key: "b", value: "second" },
        { key: "a", value: "first" },
      ]),
    ).toBe(
      second.selectMistake("mistake", [
        { key: "a", value: "first" },
        { key: "b", value: "second" },
      ]),
    );
    expect(first.tieBreak("decision:a")).toBe(second.tieBreak("decision:a"));
  });

  it("isolates keys from call order and validates bounded operations", () => {
    const first = createRandom();
    const second = createRandom();
    const expected = first.boundedScoreNoise("existing", 0, 100);
    second.boundedScoreNoise("unrelated", 0, 100);
    expect(second.boundedScoreNoise("existing", 0, 100)).toBe(expected);
    expect(() => first.probability("invalid", 101)).toThrow(RangeError);
    expect(() => first.boundedScoreNoise("invalid", 2, 1)).toThrow(RangeError);
    expect(() => first.selectMistake("invalid", [])).toThrow(RangeError);
  });
});
