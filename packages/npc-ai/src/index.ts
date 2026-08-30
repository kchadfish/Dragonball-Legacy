/* eslint-disable sonarjs/cognitive-complexity, complexity -- nested policy and priority validators intentionally accumulate all configuration issues. */
import {
  enumerateLegalDecisions,
  type CombatantId,
  type FightState,
  type LegalDecision,
} from "@dragonball-resurgence/combat-engine";
import {
  HARD_PROFILE,
  NORMAL_PROFILE,
  SIMULATION_QUALITY_PROFILE,
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
} from "@dragonball-resurgence/game-data";

export const NPC_AI_POLICY_VERSION = "npc-ai-policy:v1";

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
  readonly policy: NpcAiPolicy;
}

export interface NpcDecisionResult {
  readonly decision: LegalDecision;
  readonly selectedDecision: LegalDecision;
  readonly legalDecisions: readonly LegalDecision[];
  readonly policyId: string;
  readonly phaseId?: string;
  readonly advisoryPriorities: AiAdvisoryPriorities;
  readonly ai: AiDecisionResult;
}

export type NpcAiFailure =
  | { readonly type: "completed-state"; readonly stateVersion: number }
  | { readonly type: "empty-legal-set"; readonly actorId: CombatantId }
  | { readonly type: "invalid-policy"; readonly issues: readonly NpcAiPolicyValidationIssue[] }
  | { readonly type: "ai-selection-failure"; readonly detail: string };

export type NpcAiResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: NpcAiFailure };

const stableId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

const policyIssue = (path: string, message: string): NpcAiPolicyValidationIssue => ({
  path,
  message,
});

const validateThreshold = (
  threshold: NpcAiThreshold | undefined,
  path: string,
  issues: NpcAiPolicyValidationIssue[],
  minimum: number,
  maximum: number,
) => {
  if (threshold === undefined) return;
  if (
    threshold.minimum !== undefined &&
    (!Number.isFinite(threshold.minimum) ||
      threshold.minimum < minimum ||
      threshold.minimum > maximum)
  )
    issues.push(policyIssue(`${path}.minimum`, `Value must be between ${minimum} and ${maximum}.`));
  if (
    threshold.maximum !== undefined &&
    (!Number.isFinite(threshold.maximum) ||
      threshold.maximum < minimum ||
      threshold.maximum > maximum)
  )
    issues.push(policyIssue(`${path}.maximum`, `Value must be between ${minimum} and ${maximum}.`));
  if (
    threshold.minimum !== undefined &&
    threshold.maximum !== undefined &&
    threshold.minimum > threshold.maximum
  )
    issues.push(policyIssue(path, "Minimum must not exceed maximum."));
};

const validatePriorities = (
  priorities: readonly NpcTacticalPriority[] | undefined,
  path: string,
  issues: NpcAiPolicyValidationIssue[],
) => {
  const ids = new Set<string>();
  for (const [index, priority] of (priorities ?? []).entries()) {
    if (!stableId.test(priority.id))
      issues.push(
        policyIssue(`${path}.${index}.id`, "Priority IDs must be lowercase and hyphenated."),
      );
    if (ids.has(priority.id))
      issues.push(policyIssue(`${path}.${index}.id`, "Priority IDs must be unique."));
    ids.add(priority.id);
    if (!Number.isFinite(priority.weight) || priority.weight < -2 || priority.weight > 2)
      issues.push(policyIssue(`${path}.${index}.weight`, "Weight must be between -2 and 2."));
    if (priority.type === "signature-conservation") {
      if (priority.moveIds.length === 0)
        issues.push(
          policyIssue(`${path}.${index}.moveIds`, "At least one signature move ID is required."),
        );
      for (const [moveIndex, moveId] of priority.moveIds.entries())
        if (!stableId.test(moveId))
          issues.push(
            policyIssue(
              `${path}.${index}.moveIds.${moveIndex}`,
              "Move ID must be lowercase and hyphenated.",
            ),
          );
    }
    if (
      priority.type === "transformation-timing" &&
      priority.selfHpAtOrBelow !== undefined &&
      (priority.selfHpAtOrBelow < 0 || priority.selfHpAtOrBelow > 1)
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
    readonly defaultProfile?: AiProfile;
    readonly tacticalPriorities?: readonly NpcTacticalPriority[];
    readonly phases?: readonly NpcAiPhase[];
  };
  const issues: NpcAiPolicyValidationIssue[] = [];
  if (policy === null || typeof policy !== "object")
    return { ok: false, issues: [policyIssue("policy", "A policy is required.")] };
  if (value.version !== NPC_AI_POLICY_VERSION)
    issues.push(policyIssue("version", "Unsupported policy version."));
  if (typeof value.id !== "string" || !stableId.test(value.id))
    issues.push(policyIssue("id", "Policy ID must be lowercase and hyphenated."));
  const profile = validateAiProfile(value.defaultProfile as AiProfile);
  if (!profile.ok)
    for (const entry of profile.issues)
      issues.push(policyIssue(`defaultProfile.${entry.path}`, entry.message));
  validatePriorities(value.tacticalPriorities, "tacticalPriorities", issues);
  const phaseIds = new Set<string>();
  const phasePriorities = new Set<number>();
  for (const [index, phase] of (value.phases ?? []).entries()) {
    if (!stableId.test(phase.id))
      issues.push(policyIssue(`phases.${index}.id`, "Phase ID must be lowercase and hyphenated."));
    if (phaseIds.has(phase.id))
      issues.push(policyIssue(`phases.${index}.id`, "Phase IDs must be unique."));
    phaseIds.add(phase.id);
    if (!Number.isInteger(phase.priority))
      issues.push(policyIssue(`phases.${index}.priority`, "Phase priority must be an integer."));
    if (phasePriorities.has(phase.priority))
      issues.push(policyIssue(`phases.${index}.priority`, "Phase priorities must be unique."));
    phasePriorities.add(phase.priority);
    const conditions = phase.when;
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
    validatePriorities(phase.tacticalPriorities, `phases.${index}.tacticalPriorities`, issues);
    const phaseProfile = validateAiProfile(phase.profile);
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
): boolean => {
  const self = state.combatants[state.activeCombatantId];
  const opponent = Object.values(state.combatants).find(
    (candidate) => candidate.id !== state.activeCombatantId,
  );
  if (opponent === undefined) return false;
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

export const resolveNpcAiPhase = (policy: NpcAiPolicy, state: FightState): NpcAiPhaseResolution => {
  const activePhase =
    state.status === "active"
      ? [...(policy.phases ?? [])]
          .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
          .find((phase) => phaseMatches(state, phase))
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
  const validation = validateNpcAiPolicy(request.policy);
  if (!validation.ok)
    return { ok: false, error: { type: "invalid-policy", issues: validation.issues } };
  const phase = resolveNpcAiPhase(request.policy, request.state);
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
  if (!result.ok)
    return { ok: false, error: { type: "ai-selection-failure", detail: result.error.type } };
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
    },
  };
};

export const normalNpcPolicy: NpcAiPolicy = {
  version: NPC_AI_POLICY_VERSION,
  id: "normal-npc",
  defaultProfile: NORMAL_PROFILE,
  tacticalPriorities: [{ type: "status-pressure", id: "prefer-status", weight: 0.25 }],
};

export const multiPhaseBossPolicy: NpcAiPolicy = {
  version: NPC_AI_POLICY_VERSION,
  id: "multi-phase-boss",
  defaultProfile: HARD_PROFILE,
  phases: [
    {
      id: "desperate",
      priority: 20,
      when: { selfHpRatio: { maximum: 0.35 } },
      profile: SIMULATION_QUALITY_PROFILE,
      tacticalPriorities: [{ type: "aggressive-phase", id: "desperate-aggression", weight: 0.4 }],
    },
    {
      id: "opening",
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
