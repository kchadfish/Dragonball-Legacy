/* eslint-disable sonarjs/no-nested-conditional, sonarjs/cognitive-complexity */
import type {
  CombatAnalysisProbe,
  CombatDecisionDescriptor,
} from "@dragonball-resurgence/combat-engine";
import { classifyCombatAnalysisProbe as classifyCombatProbe } from "@dragonball-resurgence/combat-engine";

import type { AiOutcomeCategory, AiOutcomeEstimate, AiUncertainty } from "./contracts.js";

const exact = (category: AiOutcomeCategory): AiOutcomeEstimate => ({
  category,
  probability: 1,
  uncertainty: { minimum: 1, maximum: 1, provenance: "exact" },
  provenance: "exact",
});

export const classifyCombatAnalysisProbe = (probe: CombatAnalysisProbe): AiOutcomeCategory =>
  classifyCombatProbe(probe);

const uncertain = (
  category: AiOutcomeCategory,
  probability: number,
  range: AiUncertainty,
  provenance: AiOutcomeEstimate["provenance"],
): AiOutcomeEstimate => ({ category, probability, uncertainty: range, provenance });

/**
 * Returns combat-owned outcome categories. Without a probe, ranges remain
 * explicitly uncertain; this function never recreates combat dice or damage.
 */
export const estimateOutcomeDistribution = (
  descriptor: CombatDecisionDescriptor,
  probe?: CombatAnalysisProbe,
): readonly AiOutcomeEstimate[] => {
  if (probe !== undefined) return [exact(classifyCombatAnalysisProbe(probe))];
  const attack =
    descriptor.identity.category === "basic-attack" || descriptor.identity.category === "move";
  const damage = descriptor.immediateOutcome.damage.find((entry) => entry.target === "opponent");
  if (damage !== undefined) {
    if (damage.guaranteedLethality) return [exact("lethal")];
    const lethalProbability = damage.possibleLethality ? 0.25 : 0;
    const successProbability = attack ? 0.5 : 1;
    const stoppedProbability = attack ? 0.5 : 0;
    const outcomes: AiOutcomeEstimate[] = [];
    if (lethalProbability > 0)
      outcomes.push(
        uncertain(
          "lethal",
          lethalProbability,
          { minimum: 0, maximum: 1, provenance: "descriptor-range" },
          "descriptor-range",
        ),
      );
    if (successProbability > 0)
      outcomes.push(
        uncertain(
          "normal-success",
          successProbability * (1 - lethalProbability),
          { minimum: 0, maximum: successProbability, provenance: "descriptor-range" },
          "descriptor-range",
        ),
      );
    if (stoppedProbability > 0)
      outcomes.push(
        uncertain(
          "stopped",
          stoppedProbability,
          { minimum: 0, maximum: stoppedProbability, provenance: "descriptor-range" },
          "descriptor-range",
        ),
      );
    return outcomes;
  }
  if (descriptor.effects.some((effect) => effect.category === "status"))
    return [
      uncertain(
        "status-success",
        0.5,
        { minimum: 0, maximum: 1, provenance: "unknown" },
        "unknown",
      ),
    ];
  return [
    uncertain("normal-success", 1, { minimum: 0, maximum: 1, provenance: "unknown" }, "unknown"),
  ];
};

export const expectedOutcomeValue = (outcomes: readonly AiOutcomeEstimate[]): number =>
  outcomes.reduce((total, outcome) => {
    const value =
      outcome.category === "lethal"
        ? 1_000_000
        : outcome.category === "critical-success"
          ? 100_000
          : outcome.category === "normal-success" || outcome.category === "status-success"
            ? 20_000
            : outcome.category === "block-counter"
              ? 10_000
              : -5_000;
    return total + value * outcome.probability;
  }, 0);
