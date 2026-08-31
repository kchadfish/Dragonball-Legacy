import type { TransformationDefinition } from "@dragonball-resurgence/game-data";

import type {
  ActiveCombatEffect,
  ActiveFightState,
  ActiveStatus,
  CombatActionRecord,
  CombatantState,
  LegalDecision,
  PendingDecision,
  PendingDecisionOption,
} from "./contracts.js";
import type { CombatantId } from "./ids.js";
import type { AuthoritativeDecisionCost, AuthoritativeDecisionScarcity } from "./progress-fight.js";
import type {
  DecisionActionConsumption,
  DecisionEffectFact,
  DecisionSelectionFact,
} from "./decision-descriptors.js";
import { enumerateLegalDecisions } from "./progress-fight.js";
import { mechanicsViewForState, type CombatMechanicsView } from "./mechanics-view.js";

export type StrategicContextCompleteness = "complete" | "partial";
export type StrategicRelation = "self" | "opponent";

export interface StrategicResourceFact {
  readonly current: number;
  readonly maximum: number;
  readonly ratio: number;
  readonly pressure: number;
}

export interface StrategicCombatantFact {
  readonly id: CombatantId;
  readonly hp: StrategicResourceFact;
  readonly ki: StrategicResourceFact;
  readonly status: CombatantState["status"];
  readonly activeStatusCount: number;
  readonly activeEffectCount: number;
  readonly activeTransformation: boolean;
  readonly transformationTurns: number;
}

export interface StrategicHorizonFact {
  readonly short: number;
  readonly medium: number;
  readonly long: number;
  readonly basis: "bounded-local-1v1-estimate";
}

export interface StrategicPendingWorkFact {
  readonly active: boolean;
  readonly pendingDecisionId?: PendingDecision["id"];
  readonly type?: PendingDecision["type"];
  readonly optionCount: number;
  readonly candidateCount: number;
  readonly optional: boolean;
  readonly selection?: DecisionSelectionFact;
}

export type StrategicControlKind =
  | "status"
  | "action-denial"
  | "lock"
  | "forced-action"
  | "defensive-impairment"
  | "buff"
  | "debuff"
  | "prevention"
  | "immunity"
  | "other";

export interface StrategicDurationFact {
  readonly scope: string;
  readonly remaining?: number;
  readonly expiresSoon: boolean;
  readonly expiryKnown: boolean;
}

export interface StrategicControlImpact {
  readonly relation: StrategicRelation;
  readonly executorType: string;
  readonly kind: StrategicControlKind;
  readonly duration: StrategicDurationFact;
  readonly stacks: number;
  readonly redundant: boolean;
  readonly affectedOptionCount: number;
  readonly affectedOptionCountKnown: boolean;
}

export interface StrategicTransformationDelta {
  readonly operation: "activate" | "deactivate";
  readonly hpMaximumDelta: number;
  readonly hpCurrentDelta: number;
  readonly powerDelta: number;
  readonly dexterityDelta: number;
  readonly actionConsumption: DecisionActionConsumption;
  readonly stability: "stable" | "unstable" | "unknown";
  readonly cooldownRemaining: number;
  readonly currentDurationTurns: number;
  readonly netCombatValue: number;
  readonly gainedCapabilities: readonly string[];
  readonly lostCapabilities: readonly string[];
}

export interface StrategicScarcityFact {
  readonly kind:
    "move" | "item" | "reaction" | "effect" | "transformation-opportunity" | "cooldown-renewal";
  readonly executorType?: string;
  readonly used: number;
  readonly limit?: number;
  readonly remaining?: number;
  readonly finalUse: boolean;
  readonly renewable: "never" | "slow" | "normal" | "unknown";
  readonly consumedByDecision: boolean;
}

export interface StrategicPendingOptionFact {
  readonly optionId: string;
  readonly role: PendingDecisionOption["type"];
  readonly selected: boolean;
  readonly decline: boolean;
  readonly targetIds: readonly CombatantId[];
  readonly associatedCosts: readonly AuthoritativeDecisionCost[];
  readonly associatedEffects: readonly DecisionEffectFact[];
  readonly associatedScarcity: readonly StrategicScarcityFact[];
}

export interface StrategicContextSummary {
  readonly version: "strategic-context:v1";
  readonly completeness: StrategicContextCompleteness;
  readonly unknownFacts: readonly string[];
  readonly actor: StrategicCombatantFact;
  readonly opponent: StrategicCombatantFact;
  readonly turn: {
    readonly number: number;
    readonly phase: ActiveFightState["phase"];
    readonly activeCombatantId: CombatantId;
    readonly actorHasInitiative: boolean;
  };
  readonly recentAction?: {
    readonly type: CombatActionRecord["type"];
    readonly relation: StrategicRelation;
    readonly turnNumber: number;
    readonly outcome?: "successful" | "stopped";
  };
  readonly pendingWork: StrategicPendingWorkFact;
  readonly horizon: StrategicHorizonFact;
  readonly controlImpacts: readonly StrategicControlImpact[];
  readonly transformation?: StrategicTransformationDelta;
  readonly scarcity: readonly StrategicScarcityFact[];
  readonly pendingOptions: readonly StrategicPendingOptionFact[];
}

const clamp = (value: number, minimum = 0, maximum = 1) =>
  Math.max(minimum, Math.min(maximum, value));

const resourceFact = (resource: CombatantState["hitPoints"]): StrategicResourceFact => ({
  current: resource.current,
  maximum: resource.maximum,
  ratio: resource.maximum <= 0 ? 0 : clamp(resource.current / resource.maximum),
  pressure: resource.maximum <= 0 ? 1 : clamp(1 - resource.current / resource.maximum),
});

const durationFor = (value: unknown): StrategicDurationFact => {
  if (value === "combat") return { scope: "combat", expiresSoon: false, expiryKnown: false };
  if (value === undefined || value === null || typeof value !== "object")
    return { scope: "unknown", expiresSoon: false, expiryKnown: false };
  const record = value as { readonly type?: unknown; readonly remaining?: unknown };
  const remaining =
    typeof record.remaining === "number" ? Math.max(0, record.remaining) : undefined;
  return {
    scope: typeof record.type === "string" ? record.type : "unknown",
    ...(remaining === undefined ? {} : { remaining }),
    expiresSoon: remaining !== undefined && remaining <= 1,
    expiryKnown: remaining !== undefined,
  };
};

const relationFor = (targetId: CombatantId, actorId: CombatantId): StrategicRelation =>
  targetId === actorId ? "self" : "opponent";

const effectKindFor = (type: string, effect?: ActiveCombatEffect): StrategicControlKind => {
  if (type === "force-next-action") return "forced-action";
  if (type === "action-restriction") return "action-denial";
  if (["action-lock", "prevent-move-use"].includes(type)) return "lock";
  if (["prevent-status", "prevent-resource-modification", "prevent-combat-result"].includes(type))
    return "immunity";
  if (
    [
      "prevent-roll-modification",
      "prevent-move-modification",
      "suppress",
      "modify-roll",
      "set-roll-selection",
    ].includes(type)
  )
    return type.startsWith("prevent") || type === "suppress"
      ? "prevention"
      : "defensive-impairment";
  if (["modify-stat", "modify-damage", "modify-next-action", "extra-action"].includes(type)) {
    const amount = (effect as unknown as { readonly amount?: unknown } | undefined)?.amount;
    return typeof amount === "number" && amount < 0 ? "debuff" : "buff";
  }
  if (["modify-resource", "scheduled-resource", "defer-move"].includes(type)) return "debuff";
  return "other";
};

const activeEffectTarget = (effect: ActiveCombatEffect): CombatantId | undefined => {
  const value = effect as unknown as { readonly targetCombatantId?: unknown };
  return typeof value.targetCombatantId === "string"
    ? (value.targetCombatantId as CombatantId)
    : undefined;
};

const effectDuration = (effect: ActiveCombatEffect): unknown => {
  const value = effect as unknown as {
    readonly duration?: unknown;
    readonly lifecycle?: { readonly duration?: unknown; readonly cooldown?: unknown };
  };
  return value.duration ?? value.lifecycle?.duration ?? value.lifecycle?.cooldown;
};

const stacksFor = (value: ActiveCombatEffect | ActiveStatus): number => {
  const stacks = (value as { readonly stacks?: unknown }).stacks;
  return typeof stacks === "number" ? Math.max(1, stacks) : 1;
};

const activeCombatantFact = (
  state: ActiveFightState,
  combatant: CombatantState,
): StrategicCombatantFact => ({
  id: combatant.id,
  hp: resourceFact(combatant.hitPoints),
  ki: resourceFact(combatant.ki),
  status: combatant.status,
  activeStatusCount: combatant.activeStatuses.length,
  activeEffectCount: state.activeEffects.filter(
    (effect) => activeEffectTarget(effect) === combatant.id,
  ).length,
  activeTransformation: combatant.transformation !== undefined,
  transformationTurns:
    combatant.transformation === undefined
      ? 0
      : Math.max(0, state.turnNumber - combatant.transformation.activatedOnTurn),
});

const horizonFor = (actor: CombatantState, opponent: CombatantState): StrategicHorizonFact => {
  const ratioFor = (resource: CombatantState["hitPoints"]) =>
    resource.maximum <= 0 ? 0 : clamp(resource.current / resource.maximum);
  const combined = ratioFor(actor.hitPoints) + ratioFor(opponent.hitPoints);
  const medium = Math.max(1, Math.min(6, Math.ceil(combined * 3)));
  return {
    short: 1,
    medium,
    long: Math.max(medium + 1, Math.min(12, medium * 2)),
    basis: "bounded-local-1v1-estimate",
  };
};

const capabilityTypesFor = (
  transformation: TransformationDefinition,
  mastery: "novice" | "intermediate" | "mastered",
): readonly string[] =>
  (transformation.abilities[mastery].effects ?? []).map((effect) => effect.type);

const adjusted = (value: number, percent: number) => Math.round(value * (1 + percent / 100));

const transformationFor = (
  state: ActiveFightState,
  decision: LegalDecision,
  actor: CombatantState,
  actionConsumption: DecisionActionConsumption,
  mechanicsView?: CombatMechanicsView,
): StrategicTransformationDelta | undefined => {
  if (decision.type !== "activate-transformation" && decision.type !== "deactivate-transformation")
    return undefined;
  const active = actor.transformation;
  const transformationId =
    decision.type === "activate-transformation"
      ? decision.transformationId
      : active?.transformationId;
  if (transformationId === undefined) return undefined;
  const definition = (mechanicsView ?? mechanicsViewForState(state)).indexes.transformations.get(
    transformationId,
  );
  if (definition === undefined) return undefined;
  const mastery =
    actor.transformationProfiles?.find((profile) => profile.transformationId === definition.id)
      ?.mastery ?? "mastered";
  if (decision.type === "activate-transformation") {
    const hpMaximumDelta =
      adjusted(actor.hitPoints.maximum, definition.statModifiers.hpPercent) -
      actor.hitPoints.maximum;
    const hpCurrentDelta =
      Math.min(actor.hitPoints.maximum + hpMaximumDelta, actor.hitPoints.current + hpMaximumDelta) -
      actor.hitPoints.current;
    const powerDelta =
      adjusted(actor.stats.power, definition.statModifiers.powerPercent) - actor.stats.power;
    const dexterityDelta =
      adjusted(actor.stats.dexterity, definition.statModifiers.dexterityPercent) -
      actor.stats.dexterity;
    return {
      operation: "activate",
      hpMaximumDelta,
      hpCurrentDelta,
      powerDelta,
      dexterityDelta,
      actionConsumption,
      stability: "unknown",
      cooldownRemaining: actor.transformationCooldown?.remainingOwnerTurns ?? 0,
      currentDurationTurns: 0,
      netCombatValue: hpCurrentDelta + powerDelta + dexterityDelta,
      gainedCapabilities: capabilityTypesFor(definition, mastery),
      lostCapabilities: [],
    };
  }
  if (active === undefined || active.baseline === undefined) return undefined;
  const hpMaximumDelta = active.baseline.maximumHitPoints - actor.hitPoints.maximum;
  const revertedCurrent = Math.min(
    active.baseline.maximumHitPoints,
    Math.max(
      0,
      actor.hitPoints.current - (actor.hitPoints.maximum - active.baseline.maximumHitPoints),
    ),
  );
  const hpCurrentDelta = revertedCurrent - actor.hitPoints.current;
  const powerDelta = active.baseline.stats.power - actor.stats.power;
  const dexterityDelta = active.baseline.stats.dexterity - actor.stats.dexterity;
  return {
    operation: "deactivate",
    hpMaximumDelta,
    hpCurrentDelta,
    powerDelta,
    dexterityDelta,
    actionConsumption,
    stability: actor.transformationCooldown === undefined ? "stable" : "unstable",
    cooldownRemaining: actor.transformationCooldown?.remainingOwnerTurns ?? 0,
    currentDurationTurns: Math.max(0, state.turnNumber - active.activatedOnTurn),
    netCombatValue: hpCurrentDelta + powerDelta + dexterityDelta,
    gainedCapabilities: [],
    lostCapabilities: capabilityTypesFor(definition, mastery),
  };
};

const scarcityFor = (
  state: ActiveFightState,
  actor: CombatantState,
  decision: LegalDecision,
  scarcity: readonly AuthoritativeDecisionScarcity[],
): readonly StrategicScarcityFact[] => {
  const scarcityKindFor = (
    kind: AuthoritativeDecisionScarcity["kind"],
  ): StrategicScarcityFact["kind"] => {
    if (kind === "move-use") return "move";
    if (kind === "item-use") return "item";
    return "transformation-opportunity";
  };
  const values = scarcity.map((entry) => ({
    kind: scarcityKindFor(entry.kind),
    used: entry.used,
    ...(entry.limit === undefined ? {} : { limit: entry.limit }),
    ...(entry.remaining === undefined ? {} : { remaining: entry.remaining }),
    finalUse: entry.remaining === 1,
    renewable: entry.kind === "transformation" ? ("never" as const) : ("unknown" as const),
    consumedByDecision: true,
  }));
  const activeEffectFacts = state.activeEffects
    .filter((effect) => activeEffectTarget(effect) === actor.id)
    .flatMap((effect) => {
      const lifecycle = (effect as { readonly lifecycle?: { readonly remainingUses?: number } })
        .lifecycle;
      return lifecycle?.remainingUses === undefined
        ? []
        : [
            {
              kind: "effect" as const,
              executorType: effect.type,
              used: 0,
              remaining: lifecycle.remainingUses,
              finalUse: lifecycle.remainingUses === 1,
              renewable: "unknown" as const,
              consumedByDecision: false,
            },
          ];
    });
  const cooldown = actor.transformationCooldown;
  const cooldownFact =
    cooldown === undefined
      ? []
      : [
          {
            kind: "cooldown-renewal" as const,
            used: 0,
            remaining: cooldown.remainingOwnerTurns,
            finalUse: false,
            renewable: "slow" as const,
            consumedByDecision: decision.type === "activate-transformation",
          },
        ];
  return [...values, ...activeEffectFacts, ...cooldownFact];
};

const pendingOptionsFor = (
  state: ActiveFightState,
  decision: LegalDecision,
  costs: readonly AuthoritativeDecisionCost[],
  effects: readonly DecisionEffectFact[],
  scarcity: readonly StrategicScarcityFact[],
): readonly StrategicPendingOptionFact[] => {
  if (state.pendingDecision === undefined) return [];
  const selected = new Set(
    decision.type === "respond-to-pending-decision" ? decision.selectedOptionIds : [],
  );
  return state.pendingDecision.options.map((option) => {
    const optionScarcity =
      option.deactivationNegation?.useLimit === undefined
        ? []
        : [
            {
              kind: "reaction" as const,
              executorType: "deactivation-negation",
              used: 0,
              limit: option.deactivationNegation.useLimit.count,
              remaining: option.deactivationNegation.useLimit.count,
              finalUse: option.deactivationNegation.useLimit.count === 1,
              renewable: "never" as const,
              consumedByDecision: selected.has(option.id),
            },
          ];
    return {
      optionId: option.id,
      role: option.type,
      selected: selected.has(option.id),
      decline: option.type === "decline",
      targetIds: option.combatantId === undefined ? [] : [option.combatantId],
      associatedCosts: selected.has(option.id) ? costs : [],
      associatedEffects: selected.has(option.id) ? effects : [],
      associatedScarcity: selected.has(option.id)
        ? [...scarcity, ...optionScarcity]
        : optionScarcity,
    };
  });
};

const controlImpactsFor = (state: ActiveFightState, actorId: CombatantId) => {
  const impacts: StrategicControlImpact[] = [];
  const effectTypes = new Map<string, number>();
  for (const effect of state.activeEffects) {
    const targetId = activeEffectTarget(effect);
    if (targetId === undefined) continue;
    const type = effect.type;
    const duplicateCount = effectTypes.get(`${targetId}:${type}`) ?? 0;
    effectTypes.set(`${targetId}:${type}`, duplicateCount + 1);
    const affectedOptionCount = enumerateLegalDecisions(state, targetId).length;
    impacts.push({
      relation: relationFor(targetId, actorId),
      executorType: type,
      kind: effectKindFor(type, effect),
      duration: durationFor(effectDuration(effect)),
      stacks: stacksFor(effect),
      redundant: duplicateCount > 0,
      affectedOptionCount,
      affectedOptionCountKnown: true,
    });
  }
  for (const combatant of Object.values(state.combatants))
    for (const status of combatant.activeStatuses) {
      impacts.push({
        relation: relationFor(combatant.id, actorId),
        executorType: "active-status",
        kind: "status",
        duration: durationFor(status.duration),
        stacks: stacksFor(status),
        redundant: false,
        affectedOptionCount: 0,
        affectedOptionCountKnown: false,
      });
    }
  return impacts;
};

export const strategicContextFor = (
  state: ActiveFightState,
  decision: LegalDecision,
  actionConsumption: DecisionActionConsumption,
  costs: readonly AuthoritativeDecisionCost[],
  effects: readonly DecisionEffectFact[],
  scarcity: readonly AuthoritativeDecisionScarcity[],
  selection: DecisionSelectionFact | undefined,
  mechanicsView?: CombatMechanicsView,
): StrategicContextSummary => {
  const actor = state.combatants[decision.actorId];
  const opponent =
    Object.values(state.combatants).find((candidate) => candidate.id !== actor.id) ?? actor;
  const latest = state.actionHistory.at(-1);
  const recentOutcome = latest !== undefined && "outcome" in latest ? latest.outcome : undefined;
  const unknownFacts: string[] = [];
  const transformation = transformationFor(
    state,
    decision,
    actor,
    actionConsumption,
    mechanicsView,
  );
  const strategicScarcity = scarcityFor(state, actor, decision, scarcity);
  const pendingOptions = pendingOptionsFor(state, decision, costs, effects, strategicScarcity);
  if (
    (decision.type === "activate-transformation" ||
      decision.type === "deactivate-transformation") &&
    transformation === undefined
  )
    unknownFacts.push("transformation-delta");
  return {
    version: "strategic-context:v1",
    completeness: unknownFacts.length === 0 ? "complete" : "partial",
    unknownFacts,
    actor: activeCombatantFact(state, actor),
    opponent: activeCombatantFact(state, opponent),
    turn: {
      number: state.turnNumber,
      phase: state.phase,
      activeCombatantId: state.activeCombatantId,
      actorHasInitiative: state.activeCombatantId === actor.id,
    },
    ...(latest === undefined
      ? {}
      : {
          recentAction: {
            type: latest.type,
            relation: relationFor(latest.actorId, actor.id),
            turnNumber: latest.turnNumber,
            ...(recentOutcome === undefined ? {} : { outcome: recentOutcome }),
          },
        }),
    pendingWork: {
      active: state.pendingDecision !== undefined,
      ...(state.pendingDecision === undefined
        ? {}
        : {
            pendingDecisionId: state.pendingDecision.id,
            type: state.pendingDecision.type,
            optional: state.pendingDecision.optional === true,
            ...(selection === undefined ? {} : { selection }),
          }),
      optionCount: state.pendingDecision?.options.length ?? 0,
      candidateCount:
        state.pendingDecision?.candidates?.length ?? state.pendingDecision?.options.length ?? 0,
      optional: state.pendingDecision?.optional === true,
    },
    horizon: horizonFor(actor, opponent),
    controlImpacts: controlImpactsFor(state, actor.id),
    ...(transformation === undefined ? {} : { transformation }),
    scarcity: [
      ...strategicScarcity,
      ...pendingOptions.flatMap((option) => option.associatedScarcity),
    ],
    pendingOptions,
  };
};
