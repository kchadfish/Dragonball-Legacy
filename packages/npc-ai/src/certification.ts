/* eslint-disable sonarjs/cognitive-complexity, complexity, max-lines-per-function, max-statements -- certification orchestration intentionally owns one bounded transition loop. */
import {
  advanceFight,
  createFight,
  describeLegalDecision,
  submitCombatDecision,
  type CombatDecisionInput,
  type CombatDependencies,
  type CombatTransition,
  type CreateFightInput,
  type FightState,
} from "@dragonball-resurgence/combat-engine";
import {
  type AiDependencies,
  type AiMechanicsView,
  type DiagnosticRetention,
} from "@dragonball-resurgence/ai-engine";
import type { NpcId } from "@dragonball-resurgence/game-data";

import {
  AUTOMATED_NPC_POLICY_ASSIGNMENTS,
  defaultNpcAiMechanics,
  materializeNpcCombatant,
  policyForNpc,
  selectNpcDecision,
  type NpcAiFailure,
  type NpcDecisionRequest,
  type NpcDecisionResult,
} from "./index.js";

export interface NpcCertificationLimits {
  readonly maximumTurns: number;
  readonly maximumTransitions: number;
  readonly noProgressLimit: number;
}

export interface NpcCertificationInput {
  readonly mode?: "spar" | "battle";
  readonly combatants: readonly [
    { readonly npcId: NpcId; readonly materialized: CreateFightInput["combatants"][number] },
    { readonly npcId: NpcId; readonly materialized: CreateFightInput["combatants"][number] },
  ];
  readonly dependencies: CombatDependencies;
  readonly aiRandom: AiDependencies["random"];
  readonly mechanics?: Readonly<AiMechanicsView>;
  readonly analysis?: NonNullable<NpcDecisionRequest["analysis"]>;
  readonly limits?: Partial<NpcCertificationLimits>;
  readonly diagnosticRetention?: DiagnosticRetention;
}

export type NpcTelemetryEvent =
  | { readonly type: "policy-selected"; readonly npcId: NpcId; readonly policyId: string }
  | { readonly type: "phase-selected"; readonly npcId: NpcId; readonly phaseId?: string }
  | { readonly type: "ai-work-used"; readonly npcId: NpcId; readonly diagnostics?: unknown }
  | { readonly type: "fallback"; readonly npcId: NpcId }
  | {
      readonly type: "typed-failure";
      readonly owner: "readiness" | "policy" | "ai" | "combat" | "certification";
      readonly detail: string;
    }
  | { readonly type: "transition"; readonly count: number }
  | { readonly type: "completion"; readonly status: FightState["status"] }
  | { readonly type: "safeguard-halt"; readonly reason: NpcSafeguardReason }
  | { readonly type: "replay-captured"; readonly identity: string };

export type NpcSafeguardReason = "maximum-turns" | "maximum-transitions" | "semantic-no-progress";

export interface NpcCertificationInspection {
  readonly npcId?: NpcId;
  readonly policyId?: string;
  readonly phaseId?: string;
  readonly selectedLegalDecision?: unknown;
  readonly rankedSummary?: unknown;
  readonly stateVersion: number;
  readonly rulesVersion: unknown;
  readonly replayIdentity?: unknown;
  readonly combatEvents: readonly unknown[];
}

export type NpcCertificationResult =
  | {
      readonly ok: true;
      readonly state: FightState;
      readonly transitions: number;
      readonly telemetry: readonly NpcTelemetryEvent[];
      readonly inspections: readonly NpcCertificationInspection[];
    }
  | {
      readonly ok: false;
      readonly state: FightState;
      readonly reason: NpcSafeguardReason | "combat-failure" | "npc-failure";
      readonly failure?: NpcAiFailure | unknown;
      readonly transitions: number;
      readonly telemetry: readonly NpcTelemetryEvent[];
      readonly inspections: readonly NpcCertificationInspection[];
    };

export interface NpcCatalogCertificationInput {
  readonly pairs?: readonly (readonly [NpcId, NpcId])[];
  readonly dependenciesForPair: (
    pair: readonly [NpcId, NpcId],
    index: number,
  ) => CombatDependencies;
  readonly aiRandomForPair: (
    pair: readonly [NpcId, NpcId],
    index: number,
  ) => AiDependencies["random"];
  readonly limits?: Partial<NpcCertificationLimits>;
}

export interface NpcCatalogCertificationRow {
  readonly pair: readonly [NpcId, NpcId];
  readonly result:
    | NpcCertificationResult
    | {
        readonly ok: false;
        readonly reason: "materialization-failure";
        readonly failure: unknown;
      };
}

/** Runs representative deterministic matchups for every automated NPC. */
export const certifyAutomatedNpcCatalog = (
  input: NpcCatalogCertificationInput,
): readonly NpcCatalogCertificationRow[] => {
  const npcIds = Object.keys(AUTOMATED_NPC_POLICY_ASSIGNMENTS).sort((left, right) =>
    left.localeCompare(right),
  ) as NpcId[];
  const pairs =
    input.pairs ??
    npcIds.map((npcId, index) => [npcId, npcIds[(index + 1) % npcIds.length]!] as const);
  return pairs.map((pair, index) => {
    const first = materializeNpcCombatant(pair[0]);
    const second = materializeNpcCombatant(pair[1]);
    if (!first.ok)
      return {
        pair,
        result: {
          ok: false,
          reason: "materialization-failure" as const,
          failure: first.issues,
        },
      };
    if (!second.ok)
      return {
        pair,
        result: {
          ok: false,
          reason: "materialization-failure" as const,
          failure: second.issues,
        },
      };
    return {
      pair,
      result: runAutonomousNpcFight({
        combatants: [
          { npcId: pair[0], materialized: first.value },
          { npcId: pair[1], materialized: second.value },
        ],
        dependencies: input.dependenciesForPair(pair, index),
        aiRandom: input.aiRandomForPair(pair, index),
        limits: input.limits,
      }),
    };
  });
};

const defaultLimits: NpcCertificationLimits = {
  maximumTurns: 200,
  maximumTransitions: 2_000,
  noProgressLimit: 20,
};

const semanticFingerprint = (state: FightState): string => {
  const withoutKeys = (
    value: object,
    keys: ReadonlySet<string>,
  ): Readonly<Record<string, unknown>> =>
    Object.fromEntries(Object.entries(value).filter(([key]) => !keys.has(key)));
  const transitionKeys = new Set(["id"]);
  const pendingKeys = new Set(["id", "stateVersion"]);
  const combatants = Object.values(state.combatants)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((combatant) => ({
      id: combatant.id,
      hp: combatant.hitPoints,
      ki: combatant.ki,
      status: combatant.status,
      transformation: combatant.transformation,
      activeStatuses: combatant.activeStatuses,
      moveUses: combatant.moveUses,
      itemUses: combatant.itemUses,
    }));
  const activeEffects = state.activeEffects.map((effect) => withoutKeys(effect, transitionKeys));
  const scheduledWork = (state.scheduledWork ?? []).map((work) =>
    withoutKeys(work, transitionKeys),
  );
  const pendingDecision =
    state.status !== "active" || state.pendingDecision === undefined
      ? undefined
      : (() => {
          return withoutKeys(state.pendingDecision, pendingKeys);
        })();
  return JSON.stringify({
    status: state.status,
    phase: state.status === "active" ? state.phase : undefined,
    activeCombatantId: state.status === "active" ? state.activeCombatantId : undefined,
    pendingDecision,
    activeEffects,
    scheduledWork,
    combatants,
  });
};

const decisionInputFor = (
  transition: CombatTransition,
  decision: NpcDecisionResult["decision"],
  dependencies: CombatDependencies,
): CombatDecisionInput => ({
  ...decision,
  id: dependencies.ids.nextDecisionId(),
  expectedStateVersion: transition.state.version,
});

const transitionUntilDecision = (
  state: FightState,
  dependencies: CombatDependencies,
):
  | { readonly ok: true; readonly value: CombatTransition }
  | { readonly ok: false; readonly error: unknown } => {
  let current = state;
  while (
    current.status === "active" &&
    current.pendingDecision === undefined &&
    current.phase !== "action" &&
    current.phase !== "counter"
  ) {
    const advanced = advanceFight(current, dependencies);
    if (!advanced.ok) return advanced;
    current = advanced.value.state;
  }
  return { ok: true, value: { state: current, events: [] } };
};

export const runAutonomousNpcFight = (input: NpcCertificationInput): NpcCertificationResult => {
  const limits = { ...defaultLimits, ...input.limits };
  const mechanics = input.mechanics ?? defaultNpcAiMechanics;
  const telemetry: NpcTelemetryEvent[] = [];
  const inspections: NpcCertificationInspection[] = [];
  const npcByCombatant = new Map<string, NpcId>();
  const setup = createFight(
    {
      mode: input.mode ?? "spar",
      combatants: input.combatants.map((entry) => entry.materialized),
    },
    input.dependencies,
  );
  if (!setup.ok)
    return {
      ok: false,
      state: {
        status: "completed",
        id: "fight:certification-failed",
        schemaVersion: 4,
        version: 0,
        rulesVersion: { value: "unknown" },
        mode: input.mode ?? "spar",
        turnNumber: 0,
        combatants: {},
        activeEffects: [],
        actionHistory: [],
        resolutionFrames: [],
        scheduledWork: [],
        eventSequence: 0,
        completion: { type: "cancelled" },
      } as unknown as FightState,
      reason: "combat-failure",
      failure: setup.error,
      transitions: 0,
      telemetry: [{ type: "typed-failure", owner: "combat", detail: setup.error.type }],
      inspections: [],
    };
  const firstId = Object.keys(setup.value.state.combatants)[0]!;
  const secondId = Object.keys(setup.value.state.combatants)[1]!;
  npcByCombatant.set(firstId, input.combatants[0].npcId);
  npcByCombatant.set(secondId, input.combatants[1].npcId);
  let transition = setup.value;
  let noProgress = 0;
  let previousFingerprint = semanticFingerprint(transition.state);
  let transitions = 0;
  telemetry.push({ type: "transition", count: transitions });

  while (transition.state.status === "active") {
    if (transition.state.turnNumber > limits.maximumTurns) {
      telemetry.push({ type: "safeguard-halt", reason: "maximum-turns" });
      return {
        ok: false,
        state: transition.state,
        reason: "maximum-turns",
        transitions,
        telemetry,
        inspections,
      };
    }
    if (transitions >= limits.maximumTransitions) {
      telemetry.push({ type: "safeguard-halt", reason: "maximum-transitions" });
      return {
        ok: false,
        state: transition.state,
        reason: "maximum-transitions",
        transitions,
        telemetry,
        inspections,
      };
    }
    const prepared = transitionUntilDecision(transition.state, input.dependencies);
    if (!prepared.ok) {
      telemetry.push({ type: "typed-failure", owner: "combat", detail: String(prepared.error) });
      return {
        ok: false,
        state: transition.state,
        reason: "combat-failure",
        failure: prepared.error,
        transitions,
        telemetry,
        inspections,
      };
    }
    transition = prepared.value;
    if (transition.state.status !== "active") break;
    const actorId =
      transition.state.pendingDecision?.combatantId ?? transition.state.activeCombatantId;
    const npcId = npcByCombatant.get(actorId);
    if (npcId === undefined) {
      telemetry.push({
        type: "typed-failure",
        owner: "certification",
        detail: "Missing combatant NPC assignment.",
      });
      return {
        ok: false,
        state: transition.state,
        reason: "npc-failure",
        transitions,
        telemetry,
        inspections,
      };
    }
    const policy = policyForNpc(npcId);
    if (policy === undefined) {
      telemetry.push({
        type: "typed-failure",
        owner: "policy",
        detail: `Missing policy for ${npcId}.`,
      });
      return {
        ok: false,
        state: transition.state,
        reason: "npc-failure",
        transitions,
        telemetry,
        inspections,
      };
    }
    telemetry.push({ type: "policy-selected", npcId, policyId: policy.id });
    const decision = selectNpcDecision({
      state: transition.state,
      actorId,
      npcId,
      policy,
      mechanics,
      dependencies: {
        random: input.aiRandom,
        randomness: "enabled",
      },
      analysis: input.analysis ?? { describeDecision: describeLegalDecision },
      diagnosticRetention: input.diagnosticRetention,
    });
    if (!decision.ok) {
      telemetry.push({ type: "typed-failure", owner: "ai", detail: decision.error.type });
      return {
        ok: false,
        state: transition.state,
        reason: "npc-failure",
        failure: decision.error,
        transitions,
        telemetry,
        inspections,
      };
    }
    telemetry.push({
      type: "phase-selected",
      npcId,
      ...(decision.value.phaseId === undefined ? {} : { phaseId: decision.value.phaseId }),
    });
    telemetry.push({ type: "ai-work-used", npcId, diagnostics: decision.value.ai.diagnostics });
    telemetry.push({ type: "replay-captured", identity: decision.value.replayIdentity.value });
    inspections.push({
      npcId,
      policyId: decision.value.policyId,
      ...(decision.value.phaseId === undefined ? {} : { phaseId: decision.value.phaseId }),
      selectedLegalDecision: decision.value.decision,
      rankedSummary: decision.value.ai.diagnostics?.evaluations,
      stateVersion: transition.state.version,
      rulesVersion: transition.state.rulesVersion,
      replayIdentity: decision.value.replayIdentity,
      combatEvents: transition.events,
    });
    const submitted = awaitDecision(transition, decision.value, input.dependencies);
    if (!submitted.ok) {
      telemetry.push({ type: "typed-failure", owner: "combat", detail: submitted.error.type });
      return {
        ok: false,
        state: transition.state,
        reason: "combat-failure",
        failure: submitted.error,
        transitions,
        telemetry,
        inspections,
      };
    }
    transition = submitted.value;
    transitions += 1;
    telemetry.push({ type: "transition", count: transitions });
    const fingerprint = semanticFingerprint(transition.state);
    noProgress = fingerprint === previousFingerprint ? noProgress + 1 : 0;
    previousFingerprint = fingerprint;
    if (noProgress >= limits.noProgressLimit) {
      telemetry.push({ type: "safeguard-halt", reason: "semantic-no-progress" });
      return {
        ok: false,
        state: transition.state,
        reason: "semantic-no-progress",
        transitions,
        telemetry,
        inspections,
      };
    }
  }
  telemetry.push({ type: "completion", status: transition.state.status });
  return { ok: true, state: transition.state, transitions, telemetry, inspections };
};

/* eslint-enable sonarjs/cognitive-complexity, complexity, max-lines-per-function, max-statements */

const awaitDecision = (
  transition: CombatTransition,
  result: NpcDecisionResult,
  dependencies: CombatDependencies,
): ReturnType<typeof import("@dragonball-resurgence/combat-engine").submitCombatDecision> => {
  return submitCombatDecision(
    transition.state,
    decisionInputFor(transition, result.decision, dependencies),
    dependencies,
  );
};
