import type { AiDecisionRequest, AiDecisionResult, AiResult } from "./contracts.js";
import { selectLegalDecision } from "./immediate-utility.js";

/** Canonical public selector for contextual, strategic, pruned, and lookahead AI. */
export const selectAiDecision = (request: AiDecisionRequest): AiResult<AiDecisionResult> =>
  selectLegalDecision(request);
