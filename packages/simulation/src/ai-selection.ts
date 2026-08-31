import {
  resolveDifficultySettings,
  resolveEffectiveAiAnalysisCapabilities,
  selectAiDecision,
  validateRequestedAiCapabilities,
  type AiDecisionRequest,
  type AiDecisionResult,
  type AiEffectiveAnalysisCapabilities,
  type AiFailure,
  type AiWorkLimits,
} from "@dragonball-resurgence/ai-engine";

import { SIMULATION_AI_SEED_DERIVATION_VERSION } from "./scope.js";

export const SIMULATION_AI_PIPELINE_VERSION = "simulation-ai-pipeline:v1" as const;
export const SIMULATION_AI_EVALUATOR_VERSION = "ai-evaluator:simulation-quality:v1" as const;

export interface SimulationDecisionRecord {
  readonly schemaVersion: "simulation-decision-record:v1";
  readonly requestedProfile: { readonly id: string; readonly version: string };
  readonly pipelineVersion: string;
  readonly evaluatorVersion: string;
  readonly requestedCapabilities: AiEffectiveAnalysisCapabilities | "not-declared";
  readonly effectiveCapabilities: AiEffectiveAnalysisCapabilities;
  readonly seedDerivationVersion: typeof SIMULATION_AI_SEED_DERIVATION_VERSION;
  readonly workLimits: AiWorkLimits;
}

export interface SimulationAiDecisionRequest extends AiDecisionRequest {
  readonly pipelineVersion?: string;
  readonly evaluatorVersion?: string;
  readonly seedDerivationVersion?: typeof SIMULATION_AI_SEED_DERIVATION_VERSION;
}

export interface SimulationAiDecisionResult extends AiDecisionResult {
  readonly simulationRecord: SimulationDecisionRecord;
}

export type SimulationAiResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: AiFailure };

const workLimitsFor = (request: SimulationAiDecisionRequest): AiWorkLimits => {
  const defaults = resolveDifficultySettings(request.profile.difficulty);
  return {
    candidateLimit: request.workLimits?.candidateLimit ?? defaults.candidateLimit,
    outcomeLimit: request.workLimits?.outcomeLimit ?? defaults.responseLimit,
    nodeLimit: request.workLimits?.nodeLimit ?? defaults.maxNodes,
    probeLimit: request.workLimits?.probeLimit ?? defaults.maxProbes,
  };
};

const decisionRecordFor = (
  request: SimulationAiDecisionRequest,
  effectiveCapabilities: AiEffectiveAnalysisCapabilities,
  evaluatorVersion: string,
): SimulationDecisionRecord => ({
  schemaVersion: "simulation-decision-record:v1",
  requestedProfile: {
    id: request.profile.identity.id,
    version: request.profile.identity.version,
  },
  pipelineVersion: request.pipelineVersion ?? SIMULATION_AI_PIPELINE_VERSION,
  evaluatorVersion,
  requestedCapabilities: request.analysis?.capabilities ?? "not-declared",
  effectiveCapabilities,
  seedDerivationVersion: request.seedDerivationVersion ?? SIMULATION_AI_SEED_DERIVATION_VERSION,
  workLimits: workLimitsFor(request),
});

/**
 * The simulation-only selector is a contract adapter. It does not score or
 * submit actions itself; ai-engine remains the sole action-selection owner.
 */
export const selectSimulationDecision = (
  request: SimulationAiDecisionRequest,
): SimulationAiResult<SimulationAiDecisionResult> => {
  const insufficient = validateRequestedAiCapabilities(request);
  if (insufficient !== undefined) return { ok: false, error: insufficient };
  const effectiveCapabilities = resolveEffectiveAiAnalysisCapabilities(request);
  const selected = selectAiDecision(request);
  if (!selected.ok) return selected;
  const evaluatorVersion =
    selected.value.diagnostics?.evaluator.version ??
    request.evaluatorVersion ??
    SIMULATION_AI_EVALUATOR_VERSION;
  return {
    ok: true,
    value: {
      ...selected.value,
      simulationRecord: decisionRecordFor(request, effectiveCapabilities, evaluatorVersion),
    },
  };
};
