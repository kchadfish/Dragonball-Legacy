import type {
  CombatDecisionInput,
  CombatFailure,
  CombatResult,
  CombatTransition,
  FightState,
  LegalDecision,
} from "./contracts.js";
import {
  classifyCombatAnalysisProbe,
  probeCombatDecision,
  type CombatAnalysisProbe,
  type CombatOutcomeCategory,
} from "./analysis.js";
import { getCombatDecisionPoint, type CombatDecisionPoint } from "./decision-point.js";
import {
  describeLegalDecision,
  describeLegalDecisions,
  type CombatDecisionDescriptor,
} from "./decision-descriptors.js";
import { enumerateLegalDecisions } from "./progress-fight.js";
import { strategicContextFor } from "./strategic-context.js";
import { validateFightState } from "./invariants.js";
import type { FightStateInvariantViolation } from "./contracts.js";
import {
  CANONICAL_COMBAT_MECHANICS_VIEW,
  mechanicsViewMatchesState,
  type CombatMechanicsView,
} from "./mechanics-view.js";
import { advanceFight, submitCombatDecision } from "./progress-fight.js";
import { createFight as createFightWithView } from "./create-fight.js";
import type { CombatDependencies } from "./dependencies.js";

export interface CombatRuntime {
  readonly view: CombatMechanicsView;
  readonly createFight: (
    input: unknown,
    dependencies: CombatDependencies,
  ) => CombatResult<CombatTransition>;
  readonly advanceFight: (
    state: FightState,
    dependencies: CombatDependencies,
  ) => CombatResult<CombatTransition>;
  readonly enumerateLegalDecisions: (
    state: FightState,
    actorId: LegalDecision["actorId"],
  ) => readonly LegalDecision[];
  readonly getDecisionPoint: (state: FightState) => CombatDecisionPoint;
  readonly submitCombatDecision: (
    state: FightState,
    decision: CombatDecisionInput,
    dependencies: CombatDependencies,
  ) => CombatResult<CombatTransition>;
  readonly describeDecision: (
    state: FightState,
    decision: LegalDecision,
  ) => CombatDecisionDescriptor;
  readonly describeDecisions: (
    state: FightState,
    actorId: LegalDecision["actorId"],
  ) => readonly CombatDecisionDescriptor[];
  readonly strategicContext: typeof strategicContextFor;
  readonly validateFightState: (state: FightState) => readonly FightStateInvariantViolation[];
  readonly probeDecision: (
    state: FightState,
    decision: LegalDecision,
    dependencies: CombatDependencies,
  ) => CombatResult<CombatAnalysisProbe>;
  readonly classifyProbe: (probe: CombatAnalysisProbe) => CombatOutcomeCategory;
}

const identityMatches = (state: FightState, view: CombatMechanicsView): boolean =>
  mechanicsViewMatchesState(state, view);

export const createCombatRuntime = (
  view: CombatMechanicsView = CANONICAL_COMBAT_MECHANICS_VIEW,
): CombatRuntime => {
  const boundDependencies = (dependencies: CombatDependencies): CombatDependencies => ({
    ...dependencies,
    mechanicsView: view,
  });
  const requireMatchingState = (
    state: FightState,
  ): { readonly ok: false; readonly error: CombatFailure } | undefined =>
    identityMatches(state, view)
      ? undefined
      : {
          ok: false,
          error: {
            type: "mechanics-view-mismatch",
            expected: view.identity,
            actual: state.mechanicsView,
          },
        };
  const assertMatchingState = (state: FightState): void => {
    const mismatch = requireMatchingState(state);
    if (mismatch !== undefined)
      throw new RangeError(
        `Mechanics view mismatch: expected ${view.identity.contentHash}, received ${state.mechanicsView?.contentHash ?? "none"}.`,
      );
  };
  return {
    view,
    createFight: (input, dependencies) =>
      createFightWithView(input, boundDependencies(dependencies)),
    advanceFight: (state, dependencies) => {
      const mismatch = requireMatchingState(state);
      return mismatch === undefined
        ? advanceFight(state, boundDependencies(dependencies))
        : mismatch;
    },
    enumerateLegalDecisions: (state, actorId) =>
      identityMatches(state, view) ? enumerateLegalDecisions(state, actorId, view) : [],
    getDecisionPoint: (state) => {
      assertMatchingState(state);
      return getCombatDecisionPoint(state, view);
    },
    submitCombatDecision: (state, decision, dependencies) => {
      const mismatch = requireMatchingState(state);
      return mismatch === undefined
        ? submitCombatDecision(state, decision, boundDependencies(dependencies))
        : mismatch;
    },
    describeDecision: (state, decision) => {
      assertMatchingState(state);
      return describeLegalDecision(state, decision, view);
    },
    describeDecisions: (state, actorId) => {
      assertMatchingState(state);
      return describeLegalDecisions(state, actorId, view);
    },
    strategicContext: (...args) => {
      assertMatchingState(args[0]);
      return strategicContextFor(...args);
    },
    validateFightState: (state) => validateFightState(state, view),
    probeDecision: (state, decision, dependencies) => {
      const mismatch = requireMatchingState(state);
      return mismatch === undefined
        ? probeCombatDecision(state, decision, boundDependencies(dependencies), view)
        : mismatch;
    },
    classifyProbe: classifyCombatAnalysisProbe,
  };
};

export const CANONICAL_COMBAT_RUNTIME = createCombatRuntime();
