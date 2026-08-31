import type {
  AiAnalysisCapabilities,
  AiDecisionRequest,
  AiEffectiveAnalysisCapabilities,
  AiFailure,
} from "./contracts.js";
import { resolveDifficultySettings } from "./profiles.js";

export const resolveEffectiveAiAnalysisCapabilities = (
  request: AiDecisionRequest,
): AiEffectiveAnalysisCapabilities => {
  const requestedDepth = resolveDifficultySettings(request.profile.difficulty).lookaheadDepth;
  const hasDescriptors = request.analysis?.describeDecision !== undefined;
  const hasProbe = request.analysis?.probeDecision !== undefined;
  const inferred: AiAnalysisCapabilities = {
    descriptors: hasDescriptors,
    expectedOutcomes: hasDescriptors,
    pruning: hasDescriptors,
    setupInference: hasDescriptors,
    lookaheadDepth: hasProbe ? requestedDepth : 0,
    opponentModeling: hasProbe,
    pendingExpansion: hasProbe,
  };
  const declared = request.analysis?.capabilities ?? inferred;
  return {
    descriptors: hasDescriptors && declared.descriptors,
    expectedOutcomes: hasDescriptors && declared.expectedOutcomes,
    pruning: hasDescriptors && declared.pruning,
    setupInference: hasDescriptors && declared.setupInference,
    lookaheadDepth: hasProbe ? Math.min(requestedDepth, declared.lookaheadDepth) : 0,
    opponentModeling: hasProbe && declared.opponentModeling,
    pendingExpansion: hasProbe && declared.pendingExpansion,
  };
};

export const validateRequestedAiCapabilities = (
  request: AiDecisionRequest,
): Extract<AiFailure, { readonly type: "insufficient-analysis-capabilities" }> | undefined => {
  if (request.profile.difficulty.level !== "simulation-quality") return undefined;
  const effective = resolveEffectiveAiAnalysisCapabilities(request);
  const requestedDepth = resolveDifficultySettings(request.profile.difficulty).lookaheadDepth;
  const missing = [
    ...(!effective.descriptors ? ["descriptors"] : []),
    ...(!effective.expectedOutcomes ? ["expected-outcomes"] : []),
    ...(!effective.pruning ? ["pruning"] : []),
    ...(!effective.setupInference ? ["setup-inference"] : []),
    ...(effective.lookaheadDepth < requestedDepth ? ["lookahead-depth"] : []),
    ...(!effective.opponentModeling ? ["opponent-modeling"] : []),
    ...(!effective.pendingExpansion ? ["pending-expansion"] : []),
    ...(request.analysis?.capabilities === undefined ? ["declared-capability-contract"] : []),
  ];
  return missing.length === 0
    ? undefined
    : {
        type: "insufficient-analysis-capabilities",
        profileId: request.profile.identity.id,
        requiredLookaheadDepth: requestedDepth,
        effective,
        missing,
      };
};
