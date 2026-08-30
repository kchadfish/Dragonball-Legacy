/* eslint-disable sonarjs/no-nested-conditional */
import type {
  AiBudgetUsage,
  AiUncertainty,
  CandidateEvaluation,
  CandidatePruningDisposition,
} from "./contracts.js";

const protectedBySemantics = (evaluation: CandidateEvaluation): boolean =>
  evaluation.scoreFactors.some(
    (factor) =>
      (factor.code === "guaranteed-win" && factor.value > 0) ||
      (factor.code === "defeat-prevention" && factor.value > 0) ||
      (factor.code === "guaranteed-self-loss" && factor.value < 0) ||
      (factor.code.startsWith("personality-adjustment:") && factor.value !== 0) ||
      (factor.code.startsWith("tactical-priority:") && factor.value !== 0) ||
      (factor.code === "setup-combo-value" && factor.value !== 0),
  );

const uncertain = (value: AiUncertainty | undefined): boolean =>
  value !== undefined && (value.provenance === "unknown" || value.minimum !== value.maximum);

export interface CandidatePruningResult {
  readonly evaluations: readonly CandidateEvaluation[];
  readonly retained: readonly CandidateEvaluation[];
  readonly usage: Pick<AiBudgetUsage, "candidates" | "outcomes">;
}

/**
 * Removes only candidates that are dominated by a retained, more valuable
 * candidate. Terminal, personality-relevant, setup, and uncertain choices are
 * deliberately protected from dominance and budget pruning.
 */
export const pruneCandidates = (
  evaluations: readonly CandidateEvaluation[],
  candidateLimit: number,
): CandidatePruningResult => {
  const limit = Math.max(1, Math.floor(candidateLimit));
  const ranked = [...evaluations].sort(
    (left, right) =>
      right.totalScore - left.totalScore || left.canonicalKey.localeCompare(right.canonicalKey),
  );
  const retainedKeys = new Set(ranked.slice(0, limit).map((evaluation) => evaluation.canonicalKey));
  for (const evaluation of ranked)
    if (protectedBySemantics(evaluation) || uncertain(evaluation.uncertainty))
      retainedKeys.add(evaluation.canonicalKey);
  const best = ranked[0]?.totalScore ?? 0;
  const annotated = evaluations.map((evaluation) => {
    const protectedCandidate =
      protectedBySemantics(evaluation) || uncertain(evaluation.uncertainty);
    const dominated = !protectedCandidate && evaluation.totalScore < best;
    const disposition: CandidatePruningDisposition = protectedCandidate
      ? "protected"
      : retainedKeys.has(evaluation.canonicalKey)
        ? "retained"
        : dominated
          ? "dominated"
          : "budget-pruned";
    return { ...evaluation, pruning: disposition };
  });
  return {
    evaluations: annotated,
    retained: annotated.filter((evaluation) => retainedKeys.has(evaluation.canonicalKey)),
    usage: {
      candidates: { used: evaluations.length, limit },
      outcomes: {
        used: evaluations.reduce(
          (total, evaluation) => total + (evaluation.outcomes?.length ?? 0),
          0,
        ),
        limit: Number.MAX_SAFE_INTEGER,
      },
    },
  };
};
