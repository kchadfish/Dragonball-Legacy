import { describe, expect, it } from "vitest";

import {
  calculateDiceCount,
  calculateDieSides,
  calculateFinalRollResult,
  executeRollCandidates,
  replayRollCandidates,
  rerollRollCandidates,
  selectRollCandidate,
  snapshotRollCandidates,
} from "./index.js";

describe("roll calculation pipelines", () => {
  it("keeps dice count and sides structurally valid", () => {
    expect(calculateDiceCount({ baseValue: 0 }).value).toBe(1);
    expect(
      calculateDieSides({
        baseValue: 2,
        operations: [{ operation: "add", amount: -5, provenance: "penalty" }],
      }).value,
    ).toBe(1);
  });

  it("preserves natural values while applying result changes once", () => {
    const result = calculateFinalRollResult({
      candidateNaturalValue: 19,
      statContribution: 3,
      operations: [
        { operation: "set", amount: 30, provenance: "replacement" },
        { operation: "add", amount: 2, provenance: "stat" },
        { operation: "multiply", amount: 1.5, provenance: "modifier" },
      ],
    });

    expect(result).toMatchObject({
      candidateNaturalValue: 19,
      selectedNaturalValue: 19,
      statContribution: 3,
      finalResult: 53,
      outcomeFacingValue: 53,
    });
  });

  it("selects highest or lowest final results with stable ties", () => {
    const candidates = [
      calculateFinalRollResult({ candidateNaturalValue: 8, statContribution: 0 }),
      calculateFinalRollResult({ candidateNaturalValue: 8, statContribution: 0 }),
      calculateFinalRollResult({ candidateNaturalValue: 4, statContribution: 0 }),
    ];
    expect(selectRollCandidate(candidates, "highest")).toBe(candidates[0]);
    expect(selectRollCandidate(candidates, "lowest")).toBe(candidates[2]);
  });

  it("replays selected candidates without consuming replacement randomness", () => {
    let generatedCalls = 0;
    const generated = executeRollCandidates(
      {
        candidateCount: 2,
        dieSides: 30,
        statContribution: 2,
        selection: "highest",
      },
      {
        integer: () => {
          generatedCalls += 1;
          return generatedCalls === 1 ? 4 : 20;
        },
      },
    );
    const snapshot = snapshotRollCandidates(generated);
    const replayed = replayRollCandidates(
      {
        candidateCount: 2,
        dieSides: 30,
        statContribution: 2,
        selection: "highest",
      },
      snapshot,
    );

    expect(generated.randomValuesConsumed).toBe(2);
    expect(replayed.randomValuesConsumed).toBe(0);
    expect(replayed.selectedCandidateIndex).toBe(generated.selectedCandidateIndex);
    expect(replayed.selected.finalResult).toBe(generated.selected.finalResult);
    expect(replayed.lineage).toEqual(snapshot.lineage);
  });

  it("retains reroll lineage while rerolling only selected candidates", () => {
    const initial = executeRollCandidates(
      {
        candidateCount: 2,
        dieSides: 6,
        statContribution: 0,
        selection: "highest",
        candidateNaturalValues: [2, 3],
      },
      { integer: () => 1 },
    );
    const rerolled = rerollRollCandidates(
      {
        candidateCount: 2,
        dieSides: 6,
        statContribution: 0,
        selection: "highest",
      },
      initial,
      [0],
      { integer: () => 6 },
    );

    expect(rerolled.candidates.map(({ candidateNaturalValue }) => candidateNaturalValue)).toEqual([
      6, 3,
    ]);
    expect(rerolled.selectedCandidateIndex).toBe(0);
    expect(rerolled.randomValuesConsumed).toBe(1);
    expect(rerolled.lineage.at(-1)).toMatchObject({
      attempt: 1,
      candidateIndex: 0,
      naturalValue: 6,
      source: "rerolled",
    });
  });
});
