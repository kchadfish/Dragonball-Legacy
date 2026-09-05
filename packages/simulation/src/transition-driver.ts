import type {
  CombatDependencies,
  CombatFailure,
  CombatResult,
  CombatRuntime,
  CombatTransition,
  CombatDecisionInput,
  FightState,
  LegalDecision,
} from "@dragonball-resurgence/combat-engine";

import { canonicalHash } from "./canonical.js";
import { hasSameSimulationSemanticProgress } from "./semantic-progress.js";
import type { SimulationControl, SimulationFailure, SimulationLimits } from "./contracts.js";

export interface SimulationDriverDecision {
  readonly decision: LegalDecision;
  readonly input: CombatDecisionInput;
}

export interface SimulationTransitionObservation {
  readonly priorState: FightState;
  readonly transition: CombatTransition;
  readonly decision?: LegalDecision;
  readonly legalSetHash?: string;
  readonly legalDecisions?: readonly LegalDecision[];
}

export interface SimulationTransitionDriverOptions {
  readonly runtime: CombatRuntime;
  readonly initial: CombatTransition;
  readonly dependencies: CombatDependencies;
  readonly limits: SimulationLimits;
  /** Keep full transition/decision payloads only for diagnostic retention. */
  readonly retainDiagnosticPayload?: boolean;
  readonly control?: SimulationControl;
  readonly chooseDecision: (
    state: FightState,
    legalDecisions: readonly LegalDecision[],
  ) => SimulationDriverDecision | { readonly error: SimulationFailure };
  readonly observe?: (observation: SimulationTransitionObservation) => void;
  readonly stopWhen?: (observation: SimulationTransitionObservation) => boolean;
}

export interface SimulationTransitionDriverSuccess {
  readonly ok: true;
  readonly state: FightState;
  readonly transitions: readonly CombatTransition[];
  readonly transitionHashes: readonly string[];
  readonly stateHashes: readonly string[];
  readonly eventHashes: readonly string[];
  readonly decisionHashes: readonly string[];
  readonly legalSetHashes: readonly string[];
  readonly decisions: readonly LegalDecision[];
  readonly terminationReason:
    | "engine-completed"
    | "coverage-satisfied"
    | "maximum-turns"
    | "maximum-transitions"
    | "semantic-no-progress"
    | "cancelled";
}

export interface SimulationTransitionDriverFailure {
  readonly ok: false;
  readonly state: FightState;
  readonly failure: SimulationFailure;
}

export type SimulationTransitionDriverResult =
  SimulationTransitionDriverSuccess | SimulationTransitionDriverFailure;

const combatFailure = (failure: CombatFailure): SimulationFailure => ({
  type: "combat-failure",
  failure,
});

const transitionHash = (transition: CombatTransition): string =>
  canonicalHash({ state: transition.state, events: transition.events });

type DriverStep =
  | { readonly type: "stop" }
  | {
      readonly type: "transition";
      readonly result: CombatResult<CombatTransition>;
      readonly decision?: LegalDecision;
      readonly legalSetHash?: string;
      readonly legalDecisions?: readonly LegalDecision[];
    }
  | { readonly type: "failure"; readonly failure: SimulationFailure };

const terminationFor = (
  options: SimulationTransitionDriverOptions,
  state: FightState,
  transitionCount: number,
): SimulationTransitionDriverSuccess["terminationReason"] | undefined => {
  if (options.control?.isCancelled?.() === true) return "cancelled";
  if (state.status === "completed") return "engine-completed";
  if (state.turnNumber > options.limits.maximumTurns) return "maximum-turns";
  if (transitionCount >= options.limits.maximumTransitions) return "maximum-transitions";
  return undefined;
};

const stepFor = (options: SimulationTransitionDriverOptions, state: FightState): DriverStep => {
  const point = options.runtime.getDecisionPoint(state);
  if (point.type === "completed") return { type: "stop" };
  if (point.type === "advance")
    return {
      type: "transition",
      result: options.runtime.advanceFight(state, options.dependencies),
    };
  const legalSetHash = canonicalHash(point.legalDecisions);
  const selected = options.chooseDecision(state, point.legalDecisions);
  if ("error" in selected) return { type: "failure", failure: selected.error };
  const selectedHash = canonicalHash(selected.decision);
  if (!point.legalDecisions.some((candidate) => canonicalHash(candidate) === selectedHash))
    return {
      type: "failure",
      failure: { type: "ai-failure", failure: { type: "selected-decision-not-legal" } },
    };
  return {
    type: "transition",
    result: options.runtime.submitCombatDecision(state, selected.input, options.dependencies),
    decision: selected.decision,
    legalSetHash,
    legalDecisions: point.legalDecisions,
  };
};

const appendTransition = (
  options: SimulationTransitionDriverOptions,
  transition: CombatTransition,
  decision: LegalDecision | undefined,
  legalSetHash: string | undefined,
  legalDecisions: readonly LegalDecision[] | undefined,
  priorState: FightState,
  noProgress: number,
  allTransitions: CombatTransition[],
  transitionHashes: string[],
  stateHashes: string[],
  eventHashes: string[],
  legalSetHashes: string[],
  decisions: LegalDecision[],
  decisionHashes: string[],
  retainDiagnosticPayload: boolean,
): { readonly state: FightState; readonly noProgress: number } => {
  const state = transition.state;
  if (retainDiagnosticPayload) allTransitions.push(transition);
  if (retainDiagnosticPayload) {
    transitionHashes.push(transitionHash(transition));
    stateHashes.push(canonicalHash(state));
  }
  eventHashes.push(canonicalHash(transition.events));
  if (retainDiagnosticPayload && legalSetHash !== undefined) legalSetHashes.push(legalSetHash);
  if (retainDiagnosticPayload && decision !== undefined) decisions.push(decision);
  if (decision !== undefined) decisionHashes.push(canonicalHash(decision));
  options.observe?.({
    priorState,
    transition,
    decision,
    legalSetHash,
    legalDecisions,
  });
  return {
    state,
    noProgress: hasSameSimulationSemanticProgress(priorState, state) ? noProgress + 1 : 0,
  };
};

const guardedStepFor = (
  options: SimulationTransitionDriverOptions,
  state: FightState,
): DriverStep => {
  try {
    return stepFor(options, state);
  } catch (error) {
    return {
      type: "failure",
      failure: {
        type: "unexpected-runner-failure",
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }
};

/**
 * Shared simulation transition protocol. Observation and decision policy are
 * injected so summary, diagnostic, and future anomaly runs cannot drift into
 * separate combat-driving implementations.
 */
/* eslint-disable sonarjs/cognitive-complexity -- the driver keeps all termination and observation guards at one boundary. */
export const runSimulationTransitionDriver = (
  options: SimulationTransitionDriverOptions,
): SimulationTransitionDriverResult => {
  let state = options.initial.state;
  const allTransitions: CombatTransition[] = [options.initial];
  const retainDiagnosticPayload = options.retainDiagnosticPayload ?? true;
  const transitionHashes = retainDiagnosticPayload ? [transitionHash(options.initial)] : [];
  const stateHashes = retainDiagnosticPayload ? [canonicalHash(state)] : [];
  const eventHashes = [canonicalHash(options.initial.events)];
  const legalSetHashes: string[] = [];
  const decisions: LegalDecision[] = [];
  const decisionHashes: string[] = [];
  let noProgress = 0;
  let terminationReason: SimulationTransitionDriverSuccess["terminationReason"] =
    "engine-completed";

  for (;;) {
    const guardedTermination = terminationFor(options, state, allTransitions.length - 1);
    if (guardedTermination !== undefined) {
      terminationReason = guardedTermination;
      break;
    }
    const step = guardedStepFor(options, state);
    if (step.type === "stop") break;
    if (step.type === "failure") return { ok: false, state, failure: step.failure };
    if (!step.result.ok) {
      return { ok: false, state, failure: combatFailure(step.result.error) };
    }
    const priorState = state;
    const appended = appendTransition(
      options,
      step.result.value,
      step.decision,
      step.legalSetHash,
      step.legalDecisions,
      priorState,
      noProgress,
      allTransitions,
      transitionHashes,
      stateHashes,
      eventHashes,
      legalSetHashes,
      decisions,
      decisionHashes,
      retainDiagnosticPayload,
    );
    state = appended.state;
    noProgress = appended.noProgress;
    if (
      options.stopWhen?.({
        priorState,
        transition: step.result.value,
        decision: step.decision,
        legalSetHash: step.legalSetHash,
        legalDecisions: step.legalDecisions,
      }) === true
    ) {
      terminationReason = "coverage-satisfied";
      break;
    }
    if (noProgress >= options.limits.semanticNoProgressLimit) {
      terminationReason = "semantic-no-progress";
      break;
    }
  }

  return {
    ok: true,
    state,
    transitions: retainDiagnosticPayload ? allTransitions : [],
    transitionHashes,
    stateHashes,
    eventHashes,
    decisionHashes,
    legalSetHashes,
    decisions,
    terminationReason,
  };
};
/* eslint-enable sonarjs/cognitive-complexity */
