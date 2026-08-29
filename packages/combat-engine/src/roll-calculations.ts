import {
  calculateValue,
  type CalculationInput,
  type CalculationOperation,
  type CalculationTraceEntry,
} from "./calculation-pipeline.js";
import type { RandomSource } from "./dependencies.js";

export interface RollDefinitionCalculationInput {
  readonly baseValue: number;
  readonly operations?: readonly CalculationOperation[];
  readonly bounds?: NonNullable<CalculationInput["bounds"]>;
  readonly retainTrace?: boolean;
}

export interface RollDefinitionCalculationResult {
  readonly value: number;
  readonly trace?: readonly CalculationTraceEntry[];
}

export interface RollResultCalculationInput {
  /** The injected or persisted natural die value. */
  readonly candidateNaturalValue: number;
  /** Dexterity or another explicit stat contribution, kept separate from natural value. */
  readonly statContribution: number;
  readonly operations?: readonly CalculationOperation[];
  readonly bounds?: NonNullable<CalculationInput["bounds"]>;
  /** Some combat result substitutions intentionally permit zero or negative values before outcome rules. */
  readonly enforceStructuralMinimum?: boolean;
  readonly retainTrace?: boolean;
}

export interface RollCalculationRecord {
  readonly candidateNaturalValue: number;
  readonly selectedNaturalValue: number;
  readonly statContribution: number;
  readonly finalResult: number;
  /** The value used by success/stop classification after all result changes. */
  readonly outcomeFacingValue: number;
  readonly trace?: readonly CalculationTraceEntry[];
}

export type RollLineageSource = "generated" | "persisted" | "rerolled";

export interface RollLineageEntry {
  readonly attempt: number;
  readonly candidateIndex: number;
  readonly naturalValue: number;
  readonly source: RollLineageSource;
}

export interface RollCandidateExecutionInput {
  readonly candidateCount: number;
  readonly dieSides: number;
  readonly statContribution: number;
  readonly selection: "highest" | "lowest";
  readonly operations?: readonly CalculationOperation[];
  readonly bounds?: NonNullable<CalculationInput["bounds"]>;
  readonly candidateNaturalValues?: readonly number[];
  readonly retainTrace?: boolean;
}

export interface RollCandidateExecutionResult {
  readonly candidates: readonly RollCalculationRecord[];
  readonly selected: RollCalculationRecord;
  readonly selectedCandidateIndex: number;
  readonly lineage: readonly RollLineageEntry[];
  readonly randomValuesConsumed: number;
}

export interface RollReplaySnapshot {
  readonly candidateNaturalValues: readonly number[];
  readonly selectedCandidateIndex: number;
  readonly lineage: readonly RollLineageEntry[];
}

const assertNaturalValue = (value: number) => {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError("Natural roll values must be positive integers.");
  }
};

const assertStatContribution = (value: number) => {
  if (!Number.isFinite(value)) throw new RangeError("Roll stat contributions must be finite.");
};

const assertCandidateExecutionInput = (input: RollCandidateExecutionInput) => {
  if (!Number.isInteger(input.candidateCount) || input.candidateCount < 1) {
    throw new RangeError("Candidate rolls require at least one die.");
  }
  if (!Number.isInteger(input.dieSides) || input.dieSides < 1) {
    throw new RangeError("Candidate rolls require positive integer die sides.");
  }
  if (
    input.candidateNaturalValues !== undefined &&
    input.candidateNaturalValues.length !== input.candidateCount
  ) {
    throw new RangeError("Persisted candidate rolls must match the candidate count.");
  }
};

const assertCandidateNaturalValue = (value: number, dieSides: number) => {
  assertNaturalValue(value);
  if (value > dieSides) throw new RangeError("Candidate rolls must be within their die sides.");
};

const structuralMinimum = (bounds: RollDefinitionCalculationInput["bounds"]) => [
  { type: "minimum" as const, value: 1, provenance: "roll:structural-minimum" },
  ...(bounds ?? []),
];

/** Resolve a dice-count definition, which must always contain at least one die. */
export const calculateDiceCount = (
  input: RollDefinitionCalculationInput,
): RollDefinitionCalculationResult => ({
  ...calculateValue({
    ...input,
    bounds: structuralMinimum(input.bounds),
    rounding: { type: "integer", provenance: "roll:dice-count-rounding" },
  }),
});

/** Resolve a die-sides definition, which must always contain at least one side. */
export const calculateDieSides = (
  input: RollDefinitionCalculationInput,
): RollDefinitionCalculationResult => ({
  ...calculateValue({
    ...input,
    bounds: structuralMinimum(input.bounds),
    rounding: { type: "integer", provenance: "roll:die-sides-rounding" },
  }),
});

/**
 * Resolve a final roll result without mutating its natural value. Result
 * substitutions and modifiers are delegated to the shared ND-070 pipeline.
 */
export const calculateFinalRollResult = (
  input: RollResultCalculationInput,
): RollCalculationRecord => {
  assertNaturalValue(input.candidateNaturalValue);
  assertStatContribution(input.statContribution);
  const calculation = calculateValue({
    baseValue: input.candidateNaturalValue,
    operations: [
      ...(input.operations ?? []),
      {
        operation: "add" as const,
        amount: input.statContribution,
        provenance: "roll:stat-contribution",
        order: Number.MAX_SAFE_INTEGER,
      },
    ],
    bounds:
      input.enforceStructuralMinimum === false ? input.bounds : structuralMinimum(input.bounds),
    rounding: { type: "integer", provenance: "roll:result-rounding" },
    retainTrace: input.retainTrace,
  });
  return {
    candidateNaturalValue: input.candidateNaturalValue,
    selectedNaturalValue: input.candidateNaturalValue,
    statContribution: input.statContribution,
    finalResult: calculation.value,
    outcomeFacingValue: calculation.value,
    ...(calculation.trace === undefined ? {} : { trace: calculation.trace }),
  };
};

/** Select a highest/lowest final result while preserving deterministic ties. */
export const selectRollCandidate = (
  candidates: readonly RollCalculationRecord[],
  selection: "highest" | "lowest",
): RollCalculationRecord => {
  if (candidates.length === 0) throw new RangeError("Roll selection requires a candidate.");
  return candidates.reduce((selected, candidate) => {
    const candidateWins =
      selection === "highest"
        ? candidate.finalResult > selected.finalResult
        : candidate.finalResult < selected.finalResult;
    return candidateWins ? candidate : selected;
  });
};

/** Execute an advantage/disadvantage candidate set with deterministic replay facts. */
export const executeRollCandidates = (
  input: RollCandidateExecutionInput,
  random: RandomSource,
): RollCandidateExecutionResult => {
  assertCandidateExecutionInput(input);
  const persisted = input.candidateNaturalValues;
  const naturalValues =
    persisted ??
    Array.from({ length: input.candidateCount }, () => random.integer(1, input.dieSides));
  naturalValues.forEach((value) => assertCandidateNaturalValue(value, input.dieSides));
  const candidates = naturalValues.map((naturalValue) =>
    calculateFinalRollResult({
      candidateNaturalValue: naturalValue,
      statContribution: input.statContribution,
      operations: input.operations,
      bounds: input.bounds,
      retainTrace: input.retainTrace,
    }),
  );
  const selected = selectRollCandidate(candidates, input.selection);
  const selectedCandidateIndex = candidates.indexOf(selected);
  const source: RollLineageSource = persisted === undefined ? "generated" : "persisted";
  return {
    candidates,
    selected,
    selectedCandidateIndex,
    lineage: naturalValues.map((naturalValue, candidateIndex) => ({
      attempt: 0,
      candidateIndex,
      naturalValue,
      source,
    })),
    randomValuesConsumed: persisted === undefined ? naturalValues.length : 0,
  };
};

/** Capture the authoritative natural candidate facts needed for a later replay. */
export const snapshotRollCandidates = (
  result: RollCandidateExecutionResult,
): RollReplaySnapshot => ({
  candidateNaturalValues: result.candidates.map(
    ({ candidateNaturalValue }) => candidateNaturalValue,
  ),
  selectedCandidateIndex: result.selectedCandidateIndex,
  lineage: result.lineage,
});

/** Replay candidate rolls from persisted natural values without consuming randomness. */
export const replayRollCandidates = (
  input: Omit<RollCandidateExecutionInput, "candidateNaturalValues">,
  snapshot: RollReplaySnapshot,
): RollCandidateExecutionResult => {
  const result = executeRollCandidates(
    { ...input, candidateNaturalValues: snapshot.candidateNaturalValues },
    {
      integer: () => {
        throw new Error("Roll replay must not consume replacement randomness.");
      },
    },
  );
  if (result.selectedCandidateIndex !== snapshot.selectedCandidateIndex) {
    throw new RangeError("Roll replay selected a different candidate than the persisted snapshot.");
  }
  return { ...result, lineage: snapshot.lineage };
};

/** Reroll selected candidates while retaining untouched natural values and lineage. */
export const rerollRollCandidates = (
  input: Omit<RollCandidateExecutionInput, "candidateNaturalValues">,
  prior: RollCandidateExecutionResult,
  rerollCandidateIndexes: readonly number[],
  random: RandomSource,
): RollCandidateExecutionResult => {
  assertCandidateExecutionInput(input);
  if (prior.candidates.length !== input.candidateCount) {
    throw new RangeError("Reroll candidates must match the candidate count.");
  }
  const rerollIndexes = new Set(rerollCandidateIndexes);
  for (const index of rerollIndexes) {
    if (!Number.isInteger(index) || index < 0 || index >= prior.candidates.length) {
      throw new RangeError("Reroll candidate indexes must identify existing candidates.");
    }
  }
  const naturalValues = prior.candidates.map(({ candidateNaturalValue }, index) =>
    rerollIndexes.has(index) ? random.integer(1, input.dieSides) : candidateNaturalValue,
  );
  const result = executeRollCandidates(
    { ...input, candidateNaturalValues: naturalValues },
    {
      integer: () => {
        throw new Error("Reroll replay must not consume replacement randomness.");
      },
    },
  );
  const attempt = Math.max(-1, ...prior.lineage.map(({ attempt: value }) => value)) + 1;
  return {
    ...result,
    randomValuesConsumed: rerollIndexes.size,
    lineage: [
      ...prior.lineage,
      ...naturalValues.flatMap((naturalValue, candidateIndex) =>
        rerollIndexes.has(candidateIndex)
          ? [{ attempt, candidateIndex, naturalValue, source: "rerolled" as const }]
          : [],
      ),
    ],
  };
};
