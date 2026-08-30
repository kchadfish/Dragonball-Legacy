/* eslint-disable sonarjs/no-nested-conditional */
import {
  ITEM_DEFINITIONS,
  MOVE_DEFINITIONS,
  type ItemDefinition,
  type MoveDefinition,
  type NumericExpression,
} from "@dragonball-resurgence/game-data";
import { GLOBAL_RULES } from "@dragonball-resurgence/game-config";

import type { ActiveFightState, FightState, LegalDecision, PendingDecision } from "./contracts.js";
import { compileEffectPlan } from "./effect-executors.js";
import { compileItemEffectPlan } from "./item-effect-adapters.js";
import { itemUsePolicyFor } from "./item-effects-runtime.js";
import {
  enumerateLegalDecisions,
  probeLegalDecisionCosts,
  probeLegalDecisionScarcity,
  type AuthoritativeDecisionCost,
  type AuthoritativeDecisionScarcity,
} from "./progress-fight.js";
import type { CombatantId } from "./ids.js";
import { evaluateDurableNumericExpression } from "./declarative-runtime.js";
import { calculateAttackDamage } from "./combat-mechanics.js";
import { strategicContextFor, type StrategicContextSummary } from "./strategic-context.js";

export type DecisionCategory =
  | "pass"
  | "power-up"
  | "surrender"
  | "basic-attack"
  | "move"
  | "transformation"
  | "item"
  | "pending-response";

export type DecisionActionConsumption = "action" | "free" | "response";

export type DecisionEffectCategory =
  | "damage"
  | "resource"
  | "status"
  | "roll"
  | "control"
  | "selection"
  | "transformation"
  | "cost"
  | "restriction"
  | "terminal"
  | "other";

export type DecisionEffectTiming =
  | "action-phase"
  | "before-attack-roll"
  | "before-defense-roll"
  | "after-defense-roll"
  | "on-stopped"
  | "on-success"
  | "on-combat-result"
  | "on-damage"
  | "on-move-use"
  | "on-cost-modified"
  | "on-power-up"
  | "on-resource-gain"
  | "on-resource-drain"
  | "on-resource-threshold"
  | "on-roll-modified"
  | "on-roll-result"
  | "start-combat"
  | "upkeep-phase"
  | "turn-end"
  | "passive"
  | "response"
  | "other";

export interface DecisionEffectFact {
  readonly type: string;
  readonly category: DecisionEffectCategory;
  readonly timing: DecisionEffectTiming;
  readonly sourceDefinitionId: string;
  readonly sourceEffectIndex: number;
}

export interface DecisionTargetFact {
  readonly type: "combatant";
  readonly combatantId: CombatantId;
  readonly relation: "self" | "opponent" | "pending";
}

export interface DecisionSelectionFact {
  readonly pendingDecisionId: PendingDecision["id"];
  readonly type: NonNullable<PendingDecision["selection"]>["type"] | "options";
  readonly candidateIds: readonly string[];
  readonly optional: boolean;
  readonly selectedOptionIds: readonly string[];
}

export interface DecisionOutcomeProbeReference {
  readonly type: "combat-transition";
  readonly decisionKey: string;
}

/** Combat-authored setup facts; AI may weight them but cannot derive legality from them. */
export interface DecisionTacticalSetupFact {
  readonly role: "setup" | "control";
  readonly eligibleFollowUpCategories: readonly string[];
  readonly eligibleFollowUpIds?: readonly string[];
  readonly targetRelation: "self" | "opponent" | "both";
  readonly window: {
    readonly scope: "same-action" | "next-action" | "next-turn" | "several-turns" | "combat";
    readonly duration?: number;
  };
  readonly controlImpact:
    "none" | "resource-denial" | "option-removal" | "action-denial" | "stat-improvement";
  readonly available: boolean;
}

export type ImmediateOutcomeCertainty = "guaranteed" | "possible" | "unknown";
export type ImmediateOutcomeTiming = "immediate" | "delayed";

export interface ImmediateOutcomeRange {
  readonly minimum: number;
  readonly maximum: number;
}

export interface ImmediateResourceOutcome {
  readonly target: "self" | "opponent";
  readonly resource: "hp" | "ki";
  readonly operation: "cost" | "gain" | "loss";
  readonly declared?: number;
  readonly effective?: number;
  readonly amount?: ImmediateOutcomeRange;
  readonly overflow?: ImmediateOutcomeRange;
  readonly timing: ImmediateOutcomeTiming;
  readonly certainty: ImmediateOutcomeCertainty;
}

export interface ImmediateDamageOutcome {
  readonly target: "self" | "opponent";
  readonly amount?: ImmediateOutcomeRange;
  readonly guaranteedLethality: boolean;
  readonly possibleLethality: boolean;
  readonly overkill?: ImmediateOutcomeRange;
  readonly selfHarm: boolean;
  readonly timing: ImmediateOutcomeTiming;
  readonly certainty: ImmediateOutcomeCertainty;
}

export interface ImmediateHealingOutcome {
  readonly target: "self" | "opponent";
  readonly amount?: ImmediateOutcomeRange;
  readonly overflow?: ImmediateOutcomeRange;
  readonly timing: ImmediateOutcomeTiming;
  readonly certainty: ImmediateOutcomeCertainty;
}

export interface ImmediateActionOutcome {
  readonly free: boolean;
  readonly extraOwnActions: number;
  readonly skippedOwnActions: number;
  readonly skippedOpponentActions: number;
  readonly response: boolean;
  readonly delayed: boolean;
  readonly certainty: ImmediateOutcomeCertainty;
}

export interface ImmediateOutcomeSummary {
  readonly version: "immediate-outcome:v1";
  readonly completeness: "complete" | "partial";
  readonly resources: readonly ImmediateResourceOutcome[];
  readonly damage: readonly ImmediateDamageOutcome[];
  readonly healing: readonly ImmediateHealingOutcome[];
  readonly defeatPrevention: {
    readonly guaranteed: boolean;
    readonly possible: boolean;
    readonly certainty: ImmediateOutcomeCertainty;
  };
  readonly actions: ImmediateActionOutcome;
  readonly unknownFacts: readonly string[];
}

export interface CombatDecisionDescriptor {
  readonly key: string;
  readonly identity: {
    readonly type: LegalDecision["type"];
    readonly category: DecisionCategory;
  };
  readonly actionConsumption: DecisionActionConsumption;
  readonly costs: readonly AuthoritativeDecisionCost[];
  readonly effects: readonly DecisionEffectFact[];
  readonly scarcity: readonly AuthoritativeDecisionScarcity[];
  readonly targets: readonly DecisionTargetFact[];
  readonly selection?: DecisionSelectionFact;
  readonly terminal: "none" | "surrender-loss";
  readonly immediateOutcome: ImmediateOutcomeSummary;
  readonly tacticalSetup?: DecisionTacticalSetupFact;
  /** Versioned non-authoritative context for strategic weighting. */
  readonly strategicContext?: StrategicContextSummary;
  readonly outcomeProbe: DecisionOutcomeProbeReference;
}

const effectCategoryFor = (type: string): DecisionEffectCategory => {
  if (/(damage|combat-result)/u.test(type)) return "damage";
  if (/(modify-cost|cost)/u.test(type)) return "cost";
  if (/(resource|ki-cost)/u.test(type)) return "resource";
  if (/(status|stun)/u.test(type)) return "status";
  if (/(roll|critical)/u.test(type)) return "roll";
  if (/(select|copy|source)/u.test(type)) return "selection";
  if (/(transformation|revert)/u.test(type)) return "transformation";
  if (/(prevent|negate|suppress|lock|force|skip|deactivate|remove|substitute|exchange)/u.test(type))
    return "control";
  if (/(use|capacity|limit)/u.test(type)) return "restriction";
  if (/(terminal|surrender)/u.test(type)) return "terminal";
  return "other";
};

const effectTimingFor = (timing: string): DecisionEffectTiming => {
  const known: readonly DecisionEffectTiming[] = [
    "action-phase",
    "before-attack-roll",
    "before-defense-roll",
    "after-defense-roll",
    "on-stopped",
    "on-success",
    "on-combat-result",
    "on-damage",
    "on-move-use",
    "on-cost-modified",
    "on-power-up",
    "on-resource-gain",
    "on-resource-drain",
    "on-resource-threshold",
    "on-roll-modified",
    "on-roll-result",
    "start-combat",
    "upkeep-phase",
    "turn-end",
    "passive",
    "response",
  ];
  return known.includes(timing as DecisionEffectTiming)
    ? (timing as DecisionEffectTiming)
    : "other";
};

const decisionCategoryFor = (decision: LegalDecision): DecisionCategory => {
  switch (decision.type) {
    case "respond-to-pending-decision":
      return "pending-response";
    case "activate-transformation":
    case "deactivate-transformation":
      return "transformation";
    case "use-item":
      return "item";
    case "use-move":
      return "move";
    case "pass":
    case "power-up":
    case "surrender":
    case "basic-attack":
      return decision.type;
  }
};

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
};

/** Stable identity used by keyed AI randomness and diagnostics. */
export const canonicalDecisionKey = (decision: LegalDecision): string => {
  const normalized =
    decision.type === "respond-to-pending-decision"
      ? {
          ...decision,
          optionId: undefined,
          optionIds: undefined,
          selectedOptionIds: [...decision.selectedOptionIds].sort((left, right) =>
            left.localeCompare(right),
          ),
        }
      : decision;
  return JSON.stringify(stableValue(normalized));
};

const compiledMoveEffects = (move: MoveDefinition): readonly DecisionEffectFact[] =>
  (move.effects ?? []).flatMap((effect, sourceEffectIndex) => {
    const compiled = compileEffectPlan({
      sourceDefinitionId: move.id,
      effectIndex: sourceEffectIndex,
      effect,
      allowFloatingOnMoveUse: true,
      allowPendingChoice: true,
    });
    return compiled.ok
      ? [
          {
            type: compiled.value.type,
            category: effectCategoryFor(compiled.value.type),
            timing: effectTimingFor(effect.trigger),
            sourceDefinitionId: move.id,
            sourceEffectIndex,
          },
        ]
      : [];
  });

const compiledItemEffects = (item: ItemDefinition): readonly DecisionEffectFact[] =>
  (item.effects ?? []).flatMap((effect, sourceEffectIndex) => {
    const compiled = compileItemEffectPlan({ item, effectIndex: sourceEffectIndex });
    if (!compiled.ok) return [];
    const type = compiled.value.normalized?.type ?? compiled.value.adapter.effectType;
    return [
      {
        type,
        category: effectCategoryFor(type),
        timing: effectTimingFor(effect.trigger),
        sourceDefinitionId: item.id,
        sourceEffectIndex,
      },
    ];
  });

const targetFactsFor = (
  state: ActiveFightState,
  decision: LegalDecision,
): readonly DecisionTargetFact[] => {
  if (decision.type === "basic-attack" || decision.type === "use-move") {
    return [
      {
        type: "combatant",
        combatantId: decision.targetCombatantId,
        relation: decision.targetCombatantId === decision.actorId ? "self" : "opponent",
      },
    ];
  }
  if (decision.type !== "respond-to-pending-decision") return [];
  return state.pendingDecision === undefined
    ? []
    : state.pendingDecision.options
        .filter((option) => decision.selectedOptionIds.includes(option.id))
        .flatMap((option) => {
          const combatantId =
            option.combatantId ??
            (option.candidate?.type === "combatant" ? option.candidate.id : undefined);
          return combatantId === undefined
            ? []
            : [{ type: "combatant" as const, combatantId, relation: "pending" as const }];
        });
};

const selectionFor = (
  state: ActiveFightState,
  decision: Extract<LegalDecision, { readonly type: "respond-to-pending-decision" }>,
): DecisionSelectionFact | undefined => {
  const pending = state.pendingDecision;
  if (pending === undefined || pending.id !== decision.pendingDecisionId) return undefined;
  return {
    pendingDecisionId: pending.id,
    type: pending.selection?.type ?? "options",
    candidateIds:
      pending.candidates?.map((candidate) => `${candidate.type}:${candidate.id}`) ??
      pending.options.map((option) => option.id),
    optional: pending.optional === true,
    selectedOptionIds: [...decision.selectedOptionIds],
  };
};

const actionConsumptionFor = (
  state: ActiveFightState,
  decision: LegalDecision,
): DecisionActionConsumption => {
  if (decision.type === "respond-to-pending-decision") return "response";
  if (decision.type === "use-item") {
    const item = ITEM_DEFINITIONS.find((candidate) => candidate.id === decision.itemId);
    const timing = item === undefined ? undefined : itemUsePolicyFor(item)?.timing;
    return timing === "free" ? "free" : "action";
  }
  if (decision.type === "activate-transformation") {
    const combatant = state.combatants[decision.actorId];
    return combatant.freeTransformationActions !== undefined &&
      combatant.freeTransformationActions > 0
      ? "free"
      : "action";
  }
  return "action";
};

const effectsFor = (decision: LegalDecision): readonly DecisionEffectFact[] => {
  if (decision.type === "use-move") {
    const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === decision.moveId);
    return move === undefined ? [] : compiledMoveEffects(move);
  }
  if (decision.type === "use-item") {
    const item = ITEM_DEFINITIONS.find((candidate) => candidate.id === decision.itemId);
    return item === undefined ? [] : compiledItemEffects(item);
  }
  return [];
};

type SummaryEffect = {
  readonly type: string;
  readonly trigger?: string;
  readonly target?: "self" | "opponent";
  readonly resource?: "hp" | "ki";
  readonly operation?: string;
  readonly amount?: NumericExpression | number;
  readonly conditions?: readonly unknown[];
  readonly aspects?: readonly string[];
  readonly activationCost?: {
    readonly resource: "hp" | "ki";
    readonly amount: NumericExpression;
    readonly timing:
      "declaration" | "activation" | "pre-roll" | "post-resolution" | "per-selected-target";
  };
};

const summaryEffectsFor = (decision: LegalDecision): readonly SummaryEffect[] => {
  if (decision.type === "use-move") {
    const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === decision.moveId);
    return (move?.effects ?? []) as readonly SummaryEffect[];
  }
  if (decision.type === "use-item") {
    const item = ITEM_DEFINITIONS.find((candidate) => candidate.id === decision.itemId);
    return (item?.effects ?? []) as readonly SummaryEffect[];
  }
  return [];
};

const tacticalSetupFor = (
  state: ActiveFightState,
  decision: LegalDecision,
  effects: readonly DecisionEffectFact[],
): DecisionTacticalSetupFact | undefined => {
  const setupEffect = effects.find((effect) =>
    ["status", "control", "resource", "transformation"].includes(effect.category),
  );
  if (setupEffect === undefined) return undefined;
  const summary = summaryEffectsFor(decision).find((effect) => effect.type === setupEffect.type);
  const targetRelation = summary?.target === "opponent" ? "opponent" : "self";
  const controlImpact =
    setupEffect.category === "resource"
      ? "resource-denial"
      : /skip|lock|prevent|force|restrict/u.test(setupEffect.type)
        ? "option-removal"
        : setupEffect.category === "transformation"
          ? "stat-improvement"
          : "option-removal";
  const eligibleFollowUpCategories =
    controlImpact === "resource-denial"
      ? ["move", "power-up"]
      : setupEffect.category === "transformation"
        ? ["move", "basic-attack", "transformation"]
        : ["move", "basic-attack", "pending-response"];
  const available = enumerateLegalDecisions(state, decision.actorId).some(
    (candidate) =>
      candidate !== decision &&
      (candidate.type === "use-move" ||
        candidate.type === "basic-attack" ||
        candidate.type === "power-up"),
  );
  return {
    role: setupEffect.category === "control" ? "control" : "setup",
    eligibleFollowUpCategories,
    targetRelation,
    window: {
      scope:
        summary?.type === "schedule-effect" || summary?.type === "defer-move"
          ? "several-turns"
          : "next-turn",
    },
    controlImpact,
    available,
  };
};

const summaryNumericContextFor = (state: ActiveFightState, decision: LegalDecision) => {
  const actor = state.combatants[decision.actorId];
  const targetId =
    decision.type === "basic-attack" || decision.type === "use-move"
      ? decision.targetCombatantId
      : decision.actorId;
  const opponent = state.combatants[targetId] ?? actor;
  return {
    self: actor,
    opponent,
    turnNumber: state.turnNumber,
    participantCount: Object.keys(state.combatants).length,
    completedTurnCount: state.turnNumber - 1,
    actionHistory: state.actionHistory,
    activeEffects: state.activeEffects,
    moves: new Map(MOVE_DEFINITIONS.map((candidate) => [candidate.id, candidate])),
    moveActivationCounts: new Map(
      state.actionHistory
        .filter((action) => action.type === "use-move")
        .map((action) => [action.moveId, 1]),
    ),
  };
};

const summaryAmountFor = (
  value: NumericExpression | number | undefined,
  context: ReturnType<typeof summaryNumericContextFor>,
): number | undefined => {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (value === undefined) return undefined;
  const resolved = evaluateDurableNumericExpression(value, context);
  return resolved === undefined || !Number.isFinite(resolved) ? undefined : Math.max(0, resolved);
};

const rangeFor = (amount: number | undefined): ImmediateOutcomeRange | undefined =>
  amount === undefined ? undefined : { minimum: amount, maximum: amount };

const certaintyFor = (conditional: boolean, known: boolean): ImmediateOutcomeCertainty => {
  if (!known) return "unknown";
  return conditional ? "possible" : "guaranteed";
};

// Descriptor assembly intentionally keeps all conservative immediate facts at one transition boundary.
/* eslint-disable sonarjs/cognitive-complexity, complexity, max-lines-per-function */
const immediateOutcomeFor = (
  state: ActiveFightState,
  decision: LegalDecision,
  costs: readonly AuthoritativeDecisionCost[],
  actionConsumption: DecisionActionConsumption,
): ImmediateOutcomeSummary => {
  const context = summaryNumericContextFor(state, decision);
  const actor = state.combatants[decision.actorId];
  const targetId =
    decision.type === "basic-attack" || decision.type === "use-move"
      ? decision.targetCombatantId
      : decision.actorId;
  const target = state.combatants[targetId] ?? actor;
  const unknownFacts: string[] = [];
  const resources: ImmediateResourceOutcome[] = costs.map((cost) => ({
    target: "self",
    resource: cost.resource,
    operation: "cost",
    declared: cost.declared,
    effective: cost.effective,
    amount: { minimum: cost.effective, maximum: cost.effective },
    overflow: { minimum: 0, maximum: 0 },
    timing: cost.timing === "declaration" ? "immediate" : "delayed",
    certainty: "guaranteed",
  }));
  if (decision.type === "power-up") {
    const declared = GLOBAL_RULES.combat.powerUpKiGain;
    const effective = Math.min(declared, Math.max(0, actor.ki.maximum - actor.ki.current));
    resources.push({
      target: "self",
      resource: "ki",
      operation: "gain",
      declared,
      effective,
      amount: { minimum: effective, maximum: effective },
      overflow: {
        minimum: Math.max(0, declared - effective),
        maximum: Math.max(0, declared - effective),
      },
      timing: "immediate",
      certainty: "guaranteed",
    });
  }
  const damage: ImmediateDamageOutcome[] = [];
  const healing: ImmediateHealingOutcome[] = [];
  let completeness: ImmediateOutcomeSummary["completeness"] = "complete";
  const markUnknown = (fact: string) => {
    completeness = "partial";
    unknownFacts.push(fact);
  };
  // Effects are normalized here so every resource mutation shares the same certainty and overflow rules.
  /* eslint-disable sonarjs/cognitive-complexity, complexity */
  const addResourceFact = (
    effect: SummaryEffect,
    amount: number | undefined,
    timing: ImmediateOutcomeTiming = "immediate",
  ) => {
    const resource = effect.resource;
    if (
      resource === undefined ||
      (effect.operation !== "gain" &&
        effect.operation !== "lose" &&
        effect.operation !== "drain" &&
        effect.operation !== "set")
    )
      return;
    const targetKind = effect.target === "opponent" ? "opponent" : "self";
    const subject = targetKind === "self" ? actor : target;
    const range = rangeFor(amount);
    const conditional = (effect.conditions?.length ?? 0) > 0;
    const certainty = certaintyFor(conditional, range !== undefined);
    if (range === undefined) markUnknown(`${effect.type}:${resource}`);
    const current = resource === "hp" ? subject.hitPoints : subject.ki;
    const gain = effect.operation === "gain";
    const overflow =
      range === undefined || !gain
        ? undefined
        : {
            minimum: Math.max(0, range.minimum - (current.maximum - current.current)),
            maximum: Math.max(0, range.maximum - (current.maximum - current.current)),
          };
    resources.push({
      target: targetKind,
      resource,
      operation: gain ? "gain" : "loss",
      ...(amount === undefined ? {} : { declared: amount, effective: amount }),
      ...(range === undefined ? {} : { amount: range }),
      ...(overflow === undefined ? {} : { overflow }),
      timing,
      certainty,
    });
    if (resource === "hp" && gain) {
      healing.push({
        target: targetKind,
        ...(range === undefined ? {} : { amount: range }),
        ...(overflow === undefined ? {} : { overflow }),
        timing,
        certainty,
      });
    }
    if (resource === "hp" && !gain) {
      const possibleDamage =
        range === undefined
          ? undefined
          : {
              minimum: 0,
              maximum: Math.min(subject.hitPoints.current, range.maximum),
            };
      const overkill =
        range === undefined
          ? undefined
          : { minimum: 0, maximum: Math.max(0, range.maximum - subject.hitPoints.current) };
      damage.push({
        target: targetKind,
        ...(possibleDamage === undefined
          ? {}
          : {
              amount: possibleDamage,
              ...(overkill === undefined ? {} : { overkill }),
            }),
        guaranteedLethality: range !== undefined && range.minimum >= subject.hitPoints.current,
        possibleLethality: range !== undefined && range.maximum >= subject.hitPoints.current,
        selfHarm: targetKind === "self",
        timing,
        certainty,
      });
    }
  };

  const summaryEffects = summaryEffectsFor(decision);
  for (const cost of summaryEffects) {
    const amount = summaryAmountFor(cost.activationCost?.amount, context);
    if (cost.activationCost !== undefined) {
      if (amount === undefined) markUnknown(`${cost.type}:activation-cost`);
      resources.push({
        target: "self",
        resource: cost.activationCost.resource,
        operation: "cost",
        ...(amount === undefined
          ? {}
          : {
              declared: amount,
              effective: amount,
              amount: { minimum: amount, maximum: amount },
              overflow: { minimum: 0, maximum: 0 },
            }),
        timing: cost.activationCost.timing === "declaration" ? "immediate" : "delayed",
        certainty: certaintyFor((cost.conditions?.length ?? 0) > 0, amount !== undefined),
      });
    }
    if (cost.type === "modify-resource")
      addResourceFact(cost, summaryAmountFor(cost.amount, context));
    else if (cost.type === "item-modify-resource")
      addResourceFact(cost, summaryAmountFor(cost.amount, context));
    else if (
      cost.type === "schedule-effect" ||
      cost.type === "defer-move" ||
      cost.type === "delayed-deactivate"
    )
      markUnknown(`${cost.type}:delayed`);
    else if (cost.type !== "grant-extra-action" && cost.type !== "skip-action")
      markUnknown(`${cost.type}:unsupported`);
  }

  let directAttack: number | undefined;
  if (decision.type === "basic-attack") {
    directAttack = Math.round(
      (actor.stats.power * GLOBAL_RULES.combat.basicAttackPowerDamagePercent) / 100,
    );
  } else if (decision.type === "use-move") {
    const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === decision.moveId);
    const percent = summaryAmountFor(move?.mechanics.attack?.baseDamagePercent, context);
    if (percent !== undefined) directAttack = Math.round((actor.stats.power * percent) / 100);
  }
  if (directAttack !== undefined) {
    const move =
      decision.type === "use-move"
        ? MOVE_DEFINITIONS.find((candidate) => candidate.id === decision.moveId)
        : undefined;
    const attack = move?.mechanics.attack;
    const count = attack?.damagePerHit === true ? (attack.attackRoll?.dice ?? 1) : 1;
    const minimum = 0;
    const maximum = calculateAttackDamage(directAttack, true) * count;
    damage.push({
      target: "opponent",
      amount: { minimum, maximum },
      guaranteedLethality: minimum >= target.hitPoints.current,
      possibleLethality: maximum >= target.hitPoints.current,
      overkill: {
        minimum: Math.max(0, minimum - target.hitPoints.current),
        maximum: Math.max(0, maximum - target.hitPoints.current),
      },
      selfHarm: false,
      timing: "immediate",
      certainty: "possible",
    });
  } else if (decision.type === "basic-attack" || decision.type === "use-move")
    markUnknown("attack-damage");

  if (decision.type === "activate-transformation" || decision.type === "deactivate-transformation")
    markUnknown("transformation-outcome");
  if (decision.type === "respond-to-pending-decision" && state.pendingDecision !== undefined)
    markUnknown("pending-response-outcome");
  if (decision.type === "use-item" && summaryEffects.length === 0) markUnknown("item-outcome");
  const summaryEffectTypes = summaryEffects.map((effect) => effect.type);
  const extraOwnActions = summaryEffectTypes.filter((type) => type === "grant-extra-action").length;
  const skippedOpponentActions = summaryEffectTypes.filter((type) => type === "skip-action").length;
  const skippedOwnActions = summaryEffectTypes.filter(
    (type) => type === "skip-action" && decision.actorId === targetId,
  ).length;
  const delayed = summaryEffectTypes.some((type) =>
    ["schedule-effect", "defer-move", "delayed-deactivate"].includes(type),
  );
  const actions: ImmediateActionOutcome = {
    free: actionConsumption === "free",
    extraOwnActions,
    skippedOwnActions,
    skippedOpponentActions,
    response: actionConsumption === "response",
    delayed,
    certainty: delayed ? "possible" : "guaranteed",
  };
  if (decision.type === "respond-to-pending-decision" && state.pendingDecision === undefined)
    markUnknown("pending-decision");
  return {
    version: "immediate-outcome:v1",
    completeness,
    resources,
    damage,
    healing,
    defeatPrevention: { guaranteed: false, possible: false, certainty: "unknown" },
    actions,
    unknownFacts,
  };
};

/** Describes one engine-enumerated decision from compiled combat facts. */
export const describeLegalDecision = (
  state: FightState,
  decision: LegalDecision,
): CombatDecisionDescriptor => {
  const activeState = state.status === "active" ? state : undefined;
  const category = decisionCategoryFor(decision);
  const key = canonicalDecisionKey(decision);
  const actionConsumption =
    activeState === undefined ? "response" : actionConsumptionFor(activeState, decision);
  const costs = activeState === undefined ? [] : probeLegalDecisionCosts(activeState, decision);
  const effects = effectsFor(decision);
  const effectiveScarcity =
    activeState === undefined ? [] : probeLegalDecisionScarcity(activeState, decision);
  const selection =
    activeState === undefined || decision.type !== "respond-to-pending-decision"
      ? undefined
      : selectionFor(activeState, decision);
  const tacticalSetup =
    activeState === undefined ? undefined : tacticalSetupFor(activeState, decision, effects);
  const terminal = decision.type === "surrender" ? "surrender-loss" : "none";
  return {
    key,
    identity: { type: decision.type, category },
    actionConsumption,
    costs,
    effects,
    scarcity: effectiveScarcity,
    targets: activeState === undefined ? [] : targetFactsFor(activeState, decision),
    ...(selection === undefined ? {} : { selection }),
    ...(tacticalSetup === undefined ? {} : { tacticalSetup }),
    terminal,
    immediateOutcome:
      activeState === undefined
        ? {
            version: "immediate-outcome:v1",
            completeness: "partial",
            resources: [],
            damage: [],
            healing: [],
            defeatPrevention: { guaranteed: false, possible: false, certainty: "unknown" },
            actions: {
              free: false,
              extraOwnActions: 0,
              skippedOwnActions: 0,
              skippedOpponentActions: 0,
              response: true,
              delayed: false,
              certainty: "unknown",
            },
            unknownFacts: ["state"],
          }
        : immediateOutcomeFor(activeState, decision, costs, actionConsumption),
    ...(activeState === undefined
      ? {}
      : {
          strategicContext: strategicContextFor(
            activeState,
            decision,
            actionConsumption,
            costs,
            effects,
            effectiveScarcity,
            selection,
          ),
        }),
    outcomeProbe: { type: "combat-transition", decisionKey: key },
  };
};

export const describeLegalDecisions = (
  state: FightState,
  actorId: CombatantId,
): readonly CombatDecisionDescriptor[] =>
  enumerateLegalDecisions(state, actorId).map((decision) => describeLegalDecision(state, decision));
