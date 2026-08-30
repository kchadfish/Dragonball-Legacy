/* eslint-disable sonarjs/cognitive-complexity, complexity -- nested policy and priority validators intentionally accumulate all configuration issues. */
import {
  enumerateLegalDecisions,
  deriveDeterministicSeed,
  type CombatantId,
  type FightState,
  type LegalDecision,
} from "@dragonball-resurgence/combat-engine";
import {
  HARD_PROFILE,
  NORMAL_PROFILE,
  SIMULATION_QUALITY_PROFILE,
  createAiRandomSource,
  selectAiDecision,
  validateAiAdvisoryPriorities,
  validateAiProfile,
  type AiAdvisoryModifier,
  type AiAdvisoryPriorities,
  type AiDecisionRequest,
  type AiDecisionResult,
  type AiMechanicsView,
  type AiProfile,
} from "@dragonball-resurgence/ai-engine";
import {
  ITEM_DEFINITIONS,
  MOVE_DEFINITIONS,
  TRANSFORMATION_DEFINITIONS,
  type NpcId,
} from "@dragonball-resurgence/game-data";

import { npcReadinessMatrix } from "./normalization.js";

export {
  assessNpcReadiness,
  materializeNpcCombatant,
  npcReadinessMatrix,
  normalizationOverlayFor,
} from "./normalization.js";
export * from "./catalog.js";

export const NPC_AI_POLICY_VERSION = "npc-ai-policy:v1";

export interface NpcDecisionRandomIdentity {
  readonly encounterRootSeed: number;
  readonly fightId: string;
  readonly stateVersion: number;
  readonly actorId: CombatantId;
  readonly policyVersion: string;
  readonly evaluatorVersion: string;
  readonly purpose: string;
}

/** Creates isolated AI randomness; combat-engine randomness is never consumed here. */
export const createNpcDecisionRandomSource = (identity: NpcDecisionRandomIdentity) =>
  createAiRandomSource({
    rootSeed: deriveDeterministicSeed([
      identity.encounterRootSeed,
      identity.fightId,
      identity.stateVersion,
      identity.actorId,
      identity.policyVersion,
      identity.evaluatorVersion,
      identity.purpose,
    ]),
    profileVersion: identity.policyVersion,
    evaluatorVersion: identity.evaluatorVersion,
    purpose: identity.purpose,
  });

export interface NpcAiThreshold {
  readonly minimum?: number;
  readonly maximum?: number;
}

export interface NpcAiPhaseConditions {
  readonly turn?: NpcAiThreshold;
  readonly selfHpRatio?: NpcAiThreshold;
  readonly opponentHpRatio?: NpcAiThreshold;
  readonly selfKiRatio?: NpcAiThreshold;
  readonly opponentKiRatio?: NpcAiThreshold;
  readonly selfTransformationActive?: boolean;
  readonly opponentTransformationActive?: boolean;
}

export type NpcTacticalPriority =
  | {
      readonly type: "transformation-timing";
      readonly id: string;
      readonly weight: number;
      readonly selfHpAtOrBelow?: number;
    }
  | {
      readonly type: "signature-conservation";
      readonly id: string;
      readonly weight: number;
      readonly moveIds: readonly string[];
    }
  | { readonly type: "status-pressure"; readonly id: string; readonly weight: number }
  | { readonly type: "aggressive-phase"; readonly id: string; readonly weight: number };

export type NpcAiPolicyProvenance = "source-derived" | "npc-design" | "saga-design";

export interface NpcAiPhase {
  readonly id: string;
  readonly priority: number;
  readonly when: NpcAiPhaseConditions;
  readonly profile: AiProfile;
  readonly tacticalPriorities?: readonly NpcTacticalPriority[];
}

export interface NpcAiPolicy {
  readonly version: typeof NPC_AI_POLICY_VERSION;
  readonly id: string;
  readonly provenance: NpcAiPolicyProvenance;
  readonly defaultProfile: AiProfile;
  readonly tacticalPriorities?: readonly NpcTacticalPriority[];
  readonly phases?: readonly NpcAiPhase[];
}

export interface NpcAiPolicyValidationIssue {
  readonly path: string;
  readonly message: string;
}

export type NpcAiPolicyValidationResult =
  | { readonly ok: true; readonly value: NpcAiPolicy }
  | { readonly ok: false; readonly issues: readonly NpcAiPolicyValidationIssue[] };

export interface NpcAiPhaseResolution {
  readonly policyId: string;
  readonly phaseId?: string;
  readonly profile: AiProfile;
  readonly tacticalPriorities: readonly NpcTacticalPriority[];
}

export interface NpcDecisionRequest extends Omit<
  AiDecisionRequest,
  "legalDecisions" | "profile" | "advisoryPriorities"
> {
  readonly npcId: NpcId;
  readonly policy: NpcAiPolicy;
  readonly npcCombatantId?: CombatantId;
  readonly policyCatalogVersion?: string;
  readonly mechanicsCatalogVersion?: string;
}

export interface NpcReplayIdentity {
  readonly schemaVersion: "npc-replay:v1";
  readonly value: string;
  readonly seed: number;
  readonly purpose: string;
}

export interface NpcDecisionResult {
  readonly decision: LegalDecision;
  readonly selectedDecision: LegalDecision;
  readonly legalDecisions: readonly LegalDecision[];
  readonly policyId: string;
  readonly phaseId?: string;
  readonly advisoryPriorities: AiAdvisoryPriorities;
  readonly ai: AiDecisionResult;
  readonly npcId: NpcId;
  readonly replayIdentity: NpcReplayIdentity;
}

export type NpcAiFailure =
  | { readonly type: "completed-state"; readonly stateVersion: number }
  | { readonly type: "empty-legal-set"; readonly actorId: CombatantId }
  | {
      readonly type: "wrong-actor";
      readonly actorId: CombatantId;
      readonly expectedActorId: CombatantId;
    }
  | { readonly type: "actor-npc-mismatch"; readonly actorId: CombatantId; readonly npcId: NpcId }
  | { readonly type: "missing-npc-assignment"; readonly npcId: NpcId }
  | { readonly type: "manual-only-npc"; readonly npcId: NpcId; readonly reasons: readonly string[] }
  | { readonly type: "descriptor-catalog-drift"; readonly detail: string }
  | { readonly type: "work-budget-exhaustion"; readonly detail: string }
  | { readonly type: "invalid-policy"; readonly issues: readonly NpcAiPolicyValidationIssue[] }
  | { readonly type: "ai-selection-failure"; readonly detail: string };

export type NpcAiResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: NpcAiFailure };

const stableId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

const policyIssue = (path: string, message: string): NpcAiPolicyValidationIssue => ({
  path,
  message,
});

const validateThreshold = (
  threshold: unknown,
  path: string,
  issues: NpcAiPolicyValidationIssue[],
  minimum: number,
  maximum: number,
) => {
  if (threshold === undefined) return;
  if (!isRecord(threshold)) {
    issues.push(policyIssue(path, "Threshold must be an object."));
    return;
  }
  const candidate = threshold as unknown as NpcAiThreshold;
  if (
    candidate.minimum !== undefined &&
    (!Number.isFinite(candidate.minimum) ||
      candidate.minimum < minimum ||
      candidate.minimum > maximum)
  )
    issues.push(policyIssue(`${path}.minimum`, `Value must be between ${minimum} and ${maximum}.`));
  if (
    candidate.maximum !== undefined &&
    (!Number.isFinite(candidate.maximum) ||
      candidate.maximum < minimum ||
      candidate.maximum > maximum)
  )
    issues.push(policyIssue(`${path}.maximum`, `Value must be between ${minimum} and ${maximum}.`));
  if (
    candidate.minimum !== undefined &&
    candidate.maximum !== undefined &&
    candidate.minimum > candidate.maximum
  )
    issues.push(policyIssue(path, "Minimum must not exceed maximum."));
};

const validatePriorities = (
  priorities: unknown,
  path: string,
  issues: NpcAiPolicyValidationIssue[],
) => {
  if (priorities === undefined) return;
  if (!Array.isArray(priorities)) {
    issues.push(policyIssue(path, "Priorities must be an array."));
    return;
  }
  const ids = new Set<string>();
  const knownTypes = new Set<NpcTacticalPriority["type"]>([
    "transformation-timing",
    "signature-conservation",
    "status-pressure",
    "aggressive-phase",
  ]);
  for (const [index, priority] of priorities.entries()) {
    if (!isRecord(priority)) {
      issues.push(policyIssue(`${path}.${index}`, "Priority must be an object."));
      continue;
    }
    const candidate = priority as unknown as NpcTacticalPriority;
    if (!knownTypes.has(candidate.type))
      issues.push(policyIssue(`${path}.${index}.type`, "Unsupported tactical priority type."));
    if (!stableId.test(candidate.id))
      issues.push(
        policyIssue(`${path}.${index}.id`, "Priority IDs must be lowercase and hyphenated."),
      );
    if (ids.has(candidate.id))
      issues.push(policyIssue(`${path}.${index}.id`, "Priority IDs must be unique."));
    ids.add(candidate.id);
    if (!Number.isFinite(candidate.weight) || candidate.weight < -2 || candidate.weight > 2)
      issues.push(policyIssue(`${path}.${index}.weight`, "Weight must be between -2 and 2."));
    if (candidate.type === "signature-conservation") {
      if (!Array.isArray(candidate.moveIds)) {
        issues.push(policyIssue(`${path}.${index}.moveIds`, "Move IDs must be an array."));
        continue;
      }
      if (candidate.moveIds.length === 0)
        issues.push(
          policyIssue(`${path}.${index}.moveIds`, "At least one signature move ID is required."),
        );
      for (const [moveIndex, moveId] of candidate.moveIds.entries())
        if (!stableId.test(moveId))
          issues.push(
            policyIssue(
              `${path}.${index}.moveIds.${moveIndex}`,
              "Move ID must be lowercase and hyphenated.",
            ),
          );
    }
    if (
      candidate.type === "transformation-timing" &&
      candidate.selfHpAtOrBelow !== undefined &&
      (candidate.selfHpAtOrBelow < 0 || candidate.selfHpAtOrBelow > 1)
    )
      issues.push(
        policyIssue(`${path}.${index}.selfHpAtOrBelow`, "HP ratio must be between 0 and 1."),
      );
  }
};

export const validateNpcAiPolicy = (policy: unknown): NpcAiPolicyValidationResult => {
  const value = policy as {
    readonly version?: unknown;
    readonly id?: unknown;
    readonly provenance?: unknown;
    readonly defaultProfile?: unknown;
    readonly tacticalPriorities?: unknown;
    readonly phases?: unknown;
  };
  const issues: NpcAiPolicyValidationIssue[] = [];
  if (policy === null || typeof policy !== "object")
    return { ok: false, issues: [policyIssue("policy", "A policy is required.")] };
  if (value.version !== NPC_AI_POLICY_VERSION)
    issues.push(policyIssue("version", "Unsupported policy version."));
  if (typeof value.id !== "string" || !stableId.test(value.id))
    issues.push(policyIssue("id", "Policy ID must be lowercase and hyphenated."));
  if (
    typeof value.provenance !== "string" ||
    !new Set(["source-derived", "npc-design", "saga-design"]).has(value.provenance)
  )
    issues.push(policyIssue("provenance", "Policy provenance is unsupported."));
  const profile = validateAiProfile(value.defaultProfile as AiProfile);
  if (!profile.ok)
    for (const entry of profile.issues)
      issues.push(policyIssue(`defaultProfile.${entry.path}`, entry.message));
  validatePriorities(value.tacticalPriorities, "tacticalPriorities", issues);
  const phaseIds = new Set<string>();
  const phasePriorities = new Set<number>();
  if (value.phases !== undefined && !Array.isArray(value.phases))
    issues.push(policyIssue("phases", "Phases must be an array."));
  for (const [index, phase] of (Array.isArray(value.phases) ? value.phases : []).entries()) {
    if (!isRecord(phase)) {
      issues.push(policyIssue(`phases.${index}`, "Phase must be an object."));
      continue;
    }
    const candidatePhase = phase as unknown as NpcAiPhase;
    if (!stableId.test(candidatePhase.id))
      issues.push(policyIssue(`phases.${index}.id`, "Phase ID must be lowercase and hyphenated."));
    if (!isRecord(candidatePhase.when))
      issues.push(policyIssue(`phases.${index}.when`, "Phase conditions are required."));
    if (phaseIds.has(candidatePhase.id))
      issues.push(policyIssue(`phases.${index}.id`, "Phase IDs must be unique."));
    phaseIds.add(candidatePhase.id);
    if (!Number.isInteger(candidatePhase.priority))
      issues.push(policyIssue(`phases.${index}.priority`, "Phase priority must be an integer."));
    if (phasePriorities.has(candidatePhase.priority))
      issues.push(policyIssue(`phases.${index}.priority`, "Phase priorities must be unique."));
    phasePriorities.add(candidatePhase.priority);
    const conditions = isRecord(candidatePhase.when)
      ? (candidatePhase.when as Record<string, unknown>)
      : {};
    validateThreshold(
      conditions.turn,
      `phases.${index}.when.turn`,
      issues,
      1,
      Number.MAX_SAFE_INTEGER,
    );
    for (const [name, threshold] of [
      ["selfHpRatio", conditions.selfHpRatio],
      ["opponentHpRatio", conditions.opponentHpRatio],
      ["selfKiRatio", conditions.selfKiRatio],
      ["opponentKiRatio", conditions.opponentKiRatio],
    ] as const)
      validateThreshold(threshold, `phases.${index}.when.${name}`, issues, 0, 1);
    validatePriorities(
      candidatePhase.tacticalPriorities,
      `phases.${index}.tacticalPriorities`,
      issues,
    );
    const phaseProfile = validateAiProfile(candidatePhase.profile);
    if (!phaseProfile.ok)
      for (const entry of phaseProfile.issues)
        issues.push(policyIssue(`phases.${index}.profile.${entry.path}`, entry.message));
  }
  return issues.length === 0 ? { ok: true, value: value as NpcAiPolicy } : { ok: false, issues };
};

const inThreshold = (value: number, threshold: NpcAiThreshold | undefined): boolean =>
  threshold === undefined ||
  ((threshold.minimum === undefined || value >= threshold.minimum) &&
    (threshold.maximum === undefined || value <= threshold.maximum));

const phaseMatches = (
  state: Extract<FightState, { readonly status: "active" }>,
  phase: NpcAiPhase,
  actorId: CombatantId,
): boolean => {
  const self = Object.values(state.combatants).find((candidate) => candidate.id === actorId);
  const opponent = Object.values(state.combatants).find((candidate) => candidate.id !== actorId);
  if (self === undefined || opponent === undefined) return false;
  const conditions = phase.when;
  return (
    inThreshold(state.turnNumber, conditions.turn) &&
    inThreshold(self.hitPoints.current / self.hitPoints.maximum, conditions.selfHpRatio) &&
    inThreshold(
      opponent.hitPoints.current / opponent.hitPoints.maximum,
      conditions.opponentHpRatio,
    ) &&
    inThreshold(self.ki.current / self.ki.maximum, conditions.selfKiRatio) &&
    inThreshold(opponent.ki.current / opponent.ki.maximum, conditions.opponentKiRatio) &&
    (conditions.selfTransformationActive === undefined ||
      conditions.selfTransformationActive === (self.transformation !== undefined)) &&
    (conditions.opponentTransformationActive === undefined ||
      conditions.opponentTransformationActive === (opponent.transformation !== undefined))
  );
};

export const resolveNpcAiPhase = (
  policy: NpcAiPolicy,
  state: FightState,
  actorId: CombatantId,
): NpcAiPhaseResolution => {
  const activePhase =
    state.status === "active"
      ? [...(policy.phases ?? [])]
          .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
          .find((phase) => phaseMatches(state, phase, actorId))
      : undefined;
  return {
    policyId: policy.id,
    ...(activePhase === undefined ? {} : { phaseId: activePhase.id }),
    profile: activePhase?.profile ?? policy.defaultProfile,
    tacticalPriorities: [
      ...(policy.tacticalPriorities ?? []),
      ...(activePhase?.tacticalPriorities ?? []),
    ],
  };
};

const modifier = (
  id: string,
  target: AiAdvisoryModifier["target"],
  adjustment: number,
): AiAdvisoryModifier => ({
  id,
  version: "ai-advisory-modifier:v1",
  target,
  adjustment,
});

export const compileNpcTacticalPriorities = (
  priorities: readonly NpcTacticalPriority[],
): AiAdvisoryPriorities => ({
  version: "ai-advisory-priorities:v1",
  modifiers: priorities.flatMap((priority) => {
    const amount = priority.weight * 10_000;
    switch (priority.type) {
      case "transformation-timing":
        return [
          modifier(
            `${priority.id}-transformation`,
            { type: "decision-category", category: "transformation" },
            amount,
          ),
          ...(priority.selfHpAtOrBelow === undefined
            ? []
            : [
                modifier(
                  `${priority.id}-threshold`,
                  {
                    type: "state-threshold",
                    metric: "self-hp-ratio",
                    operator: "<=",
                    value: priority.selfHpAtOrBelow,
                  },
                  amount,
                ),
              ]),
        ];
      case "signature-conservation":
        return priority.moveIds.map((moveId) =>
          modifier(`${priority.id}-${moveId}`, { type: "mechanics-id", id: moveId }, -amount),
        );
      case "status-pressure":
        return [modifier(priority.id, { type: "effect-category", category: "status" }, amount)];
      case "aggressive-phase":
        return [
          modifier(`${priority.id}-move`, { type: "decision-category", category: "move" }, amount),
          modifier(
            `${priority.id}-basic`,
            { type: "decision-category", category: "basic-attack" },
            amount,
          ),
        ];
    }
  }),
});

export const defaultNpcAiMechanics: AiMechanicsView = {
  version: "game-data:catalog-v1",
  moves: MOVE_DEFINITIONS,
  items: ITEM_DEFINITIONS,
  transformations: TRANSFORMATION_DEFINITIONS,
};

export const selectNpcDecision = (request: NpcDecisionRequest): NpcAiResult<NpcDecisionResult> => {
  if (request.state.status !== "active")
    return { ok: false, error: { type: "completed-state", stateVersion: request.state.version } };
  const expectedActorId =
    request.state.pendingDecision?.combatantId ?? request.state.activeCombatantId;
  if (!Object.hasOwn(request.state.combatants, request.actorId))
    return { ok: false, error: { type: "wrong-actor", actorId: request.actorId, expectedActorId } };
  if (request.actorId !== expectedActorId)
    return { ok: false, error: { type: "wrong-actor", actorId: request.actorId, expectedActorId } };
  if (request.npcCombatantId !== undefined && request.npcCombatantId !== request.actorId)
    return {
      ok: false,
      error: { type: "actor-npc-mismatch", actorId: request.actorId, npcId: request.npcId },
    };
  if (
    request.policyCatalogVersion !== undefined &&
    request.policyCatalogVersion !== "npc-policy-catalog:v1"
  )
    return {
      ok: false,
      error: {
        type: "descriptor-catalog-drift",
        detail: "Unsupported NPC policy catalog version.",
      },
    };
  if (
    request.mechanicsCatalogVersion !== undefined &&
    request.mechanicsCatalogVersion !== request.mechanics.version
  )
    return {
      ok: false,
      error: { type: "descriptor-catalog-drift", detail: "Mechanics catalog version mismatch." },
    };
  const npcReadiness = npcReadinessMatrix().find((row) => row.npcId === request.npcId);
  if (npcReadiness === undefined)
    return { ok: false, error: { type: "missing-npc-assignment", npcId: request.npcId } };
  if (npcReadiness.runtimeClassification === "manual-only")
    return {
      ok: false,
      error: {
        type: "manual-only-npc",
        npcId: request.npcId,
        reasons: npcReadiness.issues.map((issue) => issue.reason),
      },
    };
  const validation = validateNpcAiPolicy(request.policy);
  if (!validation.ok)
    return { ok: false, error: { type: "invalid-policy", issues: validation.issues } };
  const phase = resolveNpcAiPhase(request.policy, request.state, request.actorId);
  const priorities = compileNpcTacticalPriorities(phase.tacticalPriorities);
  const advisory = validateAiAdvisoryPriorities(priorities);
  if (!advisory.ok)
    return { ok: false, error: { type: "invalid-policy", issues: advisory.issues } };
  const legalDecisions = enumerateLegalDecisions(request.state, request.actorId);
  if (legalDecisions.length === 0)
    return { ok: false, error: { type: "empty-legal-set", actorId: request.actorId } };
  const result = selectAiDecision({
    ...request,
    legalDecisions,
    profile: phase.profile,
    advisoryPriorities: priorities,
  });
  if (!result.ok) {
    if (
      result.error.type === "candidate-analysis-failure" &&
      result.error.reason === "descriptor-mismatch"
    )
      return {
        ok: false,
        error: { type: "descriptor-catalog-drift", detail: result.error.detail },
      };
    if (result.error.type === "actor-mismatch")
      return {
        ok: false,
        error: {
          type: "wrong-actor",
          actorId: result.error.actorId,
          expectedActorId: result.error.expectedActorId,
        },
      };
    return { ok: false, error: { type: "ai-selection-failure", detail: result.error.type } };
  }
  const replaySeed = deriveDeterministicSeed([
    request.dependencies.random.rootSeed,
    request.state.id,
    request.state.version,
    request.actorId,
    request.npcId,
    request.policy.version,
    request.policy.id,
    request.dependencies.random.evaluatorVersion,
    request.dependencies.random.purpose,
  ]);
  return {
    ok: true,
    value: {
      decision: result.value.decision,
      selectedDecision: result.value.selectedDecision,
      legalDecisions,
      policyId: phase.policyId,
      ...(phase.phaseId === undefined ? {} : { phaseId: phase.phaseId }),
      advisoryPriorities: priorities,
      ai: result.value,
      npcId: request.npcId,
      replayIdentity: {
        schemaVersion: "npc-replay:v1",
        value: `npc-replay:${replaySeed.toString(16)}`,
        seed: replaySeed,
        purpose: request.dependencies.random.purpose,
      },
    },
  };
};

export const normalNpcPolicy: NpcAiPolicy = {
  version: NPC_AI_POLICY_VERSION,
  id: "npc-policy-balanced",
  provenance: "npc-design",
  defaultProfile: NORMAL_PROFILE,
  tacticalPriorities: [{ type: "status-pressure", id: "prefer-status", weight: 0.25 }],
};

export const multiPhaseBossPolicy: NpcAiPolicy = {
  version: NPC_AI_POLICY_VERSION,
  id: "npc-policy-boss-quality",
  provenance: "saga-design",
  defaultProfile: HARD_PROFILE,
  phases: [
    {
      id: "phase-desperate",
      priority: 20,
      when: { selfHpRatio: { maximum: 0.35 } },
      profile: SIMULATION_QUALITY_PROFILE,
      tacticalPriorities: [{ type: "aggressive-phase", id: "desperate-aggression", weight: 0.4 }],
    },
    {
      id: "phase-opening",
      priority: 10,
      when: { turn: { maximum: 2 } },
      profile: HARD_PROFILE,
      tacticalPriorities: [
        { type: "transformation-timing", id: "opening-transformation", weight: 0.2 },
      ],
    },
  ],
};

/* eslint-enable sonarjs/cognitive-complexity, complexity */

export * from "./certification.js";
