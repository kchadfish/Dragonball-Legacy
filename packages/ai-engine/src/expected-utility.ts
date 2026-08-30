/* eslint-disable sonarjs/no-nested-conditional */
import type {
  CombatAnalysisProbe,
  CombatDecisionDescriptor,
  LegalDecision,
} from "@dragonball-resurgence/combat-engine";

import type {
  AiOutcomeEstimate,
  AiUncertainty,
  CandidateEvaluation,
  ScoreFactor,
} from "./contracts.js";
import { estimateOutcomeDistribution, expectedOutcomeValue } from "./outcomes.js";

export interface ExpectedUtilityInput {
  readonly evaluation: CandidateEvaluation;
  readonly descriptor: CombatDecisionDescriptor;
  readonly probe?: CombatAnalysisProbe;
}

export interface ExpectedUtilityResult {
  readonly evaluation: CandidateEvaluation;
  readonly outcomes: readonly AiOutcomeEstimate[];
  readonly expectedValue: number;
  readonly uncertainty: AiUncertainty;
}

const outcomeFactor = (value: number, outcomes: readonly AiOutcomeEstimate[]): ScoreFactor => ({
  code: "expected-outcome-utility",
  value,
  evaluator: { id: "ai-evaluator:expected-outcome", version: "expected-outcome:v1" },
  basis: {
    type: "range",
    minimum: outcomes.reduce((total, outcome) => total + outcome.uncertainty.minimum, 0),
    maximum: outcomes.reduce((total, outcome) => total + outcome.uncertainty.maximum, 0),
    timing: "immediate",
  },
});

export const evaluateExpectedUtility = ({
  evaluation,
  descriptor,
  probe,
}: ExpectedUtilityInput): ExpectedUtilityResult => {
  const outcomes = estimateOutcomeDistribution(descriptor, probe);
  const expectedValue = expectedOutcomeValue(outcomes);
  const minimum = outcomes.reduce((total, outcome) => total + outcome.uncertainty.minimum, 0);
  const maximum = outcomes.reduce((total, outcome) => total + outcome.uncertainty.maximum, 0);
  const provenance = outcomes.every((outcome) => outcome.provenance === "exact")
    ? "exact"
    : outcomes.some((outcome) => outcome.provenance === "deterministic-probe")
      ? "deterministic-probe"
      : outcomes.some((outcome) => outcome.provenance === "descriptor-range")
        ? "descriptor-range"
        : "unknown";
  const factor = outcomeFactor(expectedValue, outcomes);
  return {
    evaluation: {
      ...evaluation,
      scoreFactors: [...evaluation.scoreFactors, factor],
      totalScore: evaluation.totalScore + expectedValue,
      outcomes,
      uncertainty: { minimum, maximum, provenance },
    },
    outcomes,
    expectedValue,
    uncertainty: { minimum, maximum, provenance },
  };
};

export const expectedUtilityForDecision = (
  evaluation: CandidateEvaluation,
  decision: LegalDecision,
  describe: (decision: LegalDecision) => CombatDecisionDescriptor,
  probe?: CombatAnalysisProbe,
): ExpectedUtilityResult =>
  evaluateExpectedUtility({ evaluation, descriptor: describe(decision), probe });
