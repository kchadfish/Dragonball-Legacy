import type {
  CombatDecision,
  CombatDecisionInput,
  CombatResult,
  CombatTransition,
  CompletedFightState,
  FightState,
  LegalDecision,
} from "./contracts.js";
import type { CombatDependencies } from "./dependencies.js";
import {
  canonicalDecisionKey,
  describeLegalDecision,
  type CombatDecisionDescriptor,
} from "./decision-descriptors.js";
import { enumerateLegalDecisions, submitCombatDecision } from "./progress-fight.js";

export interface CombatAnalysisProbe {
  readonly decision: CombatDecision;
  readonly transition: CombatTransition;
  readonly successorState: FightState;
  readonly events: CombatTransition["events"];
  readonly terminal: CompletedFightState["completion"] | undefined;
  readonly diagnosticTrace: CombatTransition["diagnosticTrace"];
}

export interface AnalysisWorkBudget {
  readonly maxNodes: number;
  readonly maxProbes: number;
  readonly nodesUsed: number;
  readonly probesUsed: number;
}

export type AnalysisBudgetKind = "node" | "probe";

export type AnalysisBudgetResult =
  | { readonly ok: true; readonly value: AnalysisWorkBudget }
  | {
      readonly ok: false;
      readonly error: {
        readonly type: "analysis-budget-exhausted";
        readonly kind: AnalysisBudgetKind;
        readonly limit: number;
      };
    };

export const createAnalysisWorkBudget = (input: {
  readonly maxNodes: number;
  readonly maxProbes: number;
}): AnalysisWorkBudget => {
  if (
    !Number.isInteger(input.maxNodes) ||
    input.maxNodes < 0 ||
    !Number.isInteger(input.maxProbes) ||
    input.maxProbes < 0
  )
    throw new RangeError("Analysis budgets must be non-negative integers.");
  return { ...input, nodesUsed: 0, probesUsed: 0 };
};

/** Pure caller-side budget accounting; wall time never influences the result. */
export const consumeAnalysisWork = (
  budget: AnalysisWorkBudget,
  kind: AnalysisBudgetKind,
): AnalysisBudgetResult => {
  const used = kind === "node" ? budget.nodesUsed : budget.probesUsed;
  const limit = kind === "node" ? budget.maxNodes : budget.maxProbes;
  if (used >= limit)
    return { ok: false, error: { type: "analysis-budget-exhausted", kind, limit } };
  return {
    ok: true,
    value: {
      ...budget,
      ...(kind === "node" ? { nodesUsed: used + 1 } : { probesUsed: used + 1 }),
    },
  };
};

/** The complete public legal surface for an analysis snapshot. */
export const enumerateAnalysisDecisions = (
  state: FightState,
  actorId: Parameters<typeof enumerateLegalDecisions>[1],
): readonly LegalDecision[] => enumerateLegalDecisions(state, actorId);

/** Analysis consumes the same descriptor contract used by future AI callers. */
export const describeAnalysisDecision = (
  state: FightState,
  decision: LegalDecision,
): CombatDecisionDescriptor => describeLegalDecision(state, decision);

const materializeDecision = (
  state: FightState,
  decision: LegalDecision,
  dependencies: CombatDependencies,
): CombatDecisionInput => ({
  ...decision,
  id: dependencies.ids.nextDecisionId(),
  expectedStateVersion: state.version,
});

/**
 * Runs one legal decision through the ordinary transition boundary using the
 * caller-supplied isolated dependencies. Private executors are not exposed.
 */
export const probeCombatDecision = (
  state: FightState,
  decision: LegalDecision,
  dependencies: CombatDependencies,
): CombatResult<CombatAnalysisProbe> => {
  const legal = enumerateLegalDecisions(state, decision.actorId).some(
    (candidate) => canonicalDecisionKey(candidate) === canonicalDecisionKey(decision),
  );
  if (!legal)
    return {
      ok: false,
      error: { type: "illegal-decision", decisionType: decision.type },
    };
  const materialized = materializeDecision(state, decision, dependencies);
  const result = submitCombatDecision(state, materialized, dependencies);
  if (!result.ok) return result;
  const terminal =
    result.value.state.status === "completed" ? result.value.state.completion : undefined;
  return {
    ok: true,
    value: {
      decision: materialized as CombatDecision,
      transition: result.value,
      successorState: result.value.state,
      events: result.value.events,
      terminal,
      diagnosticTrace: result.value.diagnosticTrace,
    },
  };
};
