import { canonicalDecisionKey } from "@dragonball-resurgence/combat-engine";

import type { AiDecisionFeature, AiSetupEdge } from "./contracts.js";

const windowMultiplier = (window: AiSetupEdge["window"]): number => {
  if (window === "same-action") return 0.95;
  if (window === "next-action") return 0.8;
  if (window === "next-turn") return 0.6;
  if (window === "several-turns") return 0.4;
  return 0.25;
};

const candidateMatches = (source: AiDecisionFeature, candidate: AiDecisionFeature): boolean => {
  const setup = source.tacticalSetup;
  if (setup === undefined || !setup.available) return false;
  if (!setup.eligibleFollowUpCategories.includes(candidate.category)) return false;
  if (setup.eligibleFollowUpIds !== undefined) {
    const id = candidate.mechanics?.id;
    if (id === undefined || !setup.eligibleFollowUpIds.includes(id)) return false;
  }
  if (setup.targetRelation === "both") return true;
  const target = candidate.targets.some((entry) => entry.relation === setup.targetRelation);
  return target || candidate.targets.length === 0;
};

/** Builds a small, descriptor-driven setup graph. No source prose or definition IDs are parsed. */
export const setupEdgesFor = (features: readonly AiDecisionFeature[]): readonly AiSetupEdge[] =>
  features.flatMap((source) => {
    const setup = source.tacticalSetup;
    if (setup === undefined || !setup.available) return [];
    const targets = features.filter(
      (candidate) => candidate !== source && candidateMatches(source, candidate),
    );
    const available = targets.length > 0;
    const base = setup.role === "control" ? 18_000 : 12_000;
    const impact =
      setup.controlImpact === "action-denial" || setup.controlImpact === "option-removal"
        ? 1.25
        : 1;
    const duration = setup.window.duration;
    const durationMultiplier = duration === undefined ? 1 : Math.min(1, Math.max(0, duration / 3));
    return [
      {
        sourceKey: canonicalDecisionKey(source.decision),
        targetKeys: targets
          .map((candidate) => candidate.canonicalKey)
          .sort((left, right) => left.localeCompare(right)),
        value: available
          ? base * impact * windowMultiplier(setup.window.scope) * durationMultiplier
          : 0,
        window: setup.window.scope,
        available,
        reason: available
          ? `${setup.role} has an engine-legal follow-up`
          : "no eligible follow-up is available",
      },
    ];
  });

export const inferSetupValue = (
  feature: AiDecisionFeature,
  features: readonly AiDecisionFeature[],
): number =>
  setupEdgesFor(features)
    .filter((edge) => edge.sourceKey === feature.canonicalKey)
    .reduce((total, edge) => total + edge.value, 0);
