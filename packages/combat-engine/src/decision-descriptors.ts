import {
  ITEM_DEFINITIONS,
  MOVE_DEFINITIONS,
  type ItemDefinition,
  type MoveDefinition,
} from "@dragonball-resurgence/game-data";

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

/** Describes one engine-enumerated decision from compiled combat facts. */
export const describeLegalDecision = (
  state: FightState,
  decision: LegalDecision,
): CombatDecisionDescriptor => {
  const activeState = state.status === "active" ? state : undefined;
  const category = decisionCategoryFor(decision);
  const key = canonicalDecisionKey(decision);
  return {
    key,
    identity: { type: decision.type, category },
    actionConsumption:
      activeState === undefined ? "response" : actionConsumptionFor(activeState, decision),
    costs: activeState === undefined ? [] : probeLegalDecisionCosts(activeState, decision),
    effects: effectsFor(decision),
    scarcity: activeState === undefined ? [] : probeLegalDecisionScarcity(activeState, decision),
    targets: activeState === undefined ? [] : targetFactsFor(activeState, decision),
    ...(activeState === undefined || decision.type !== "respond-to-pending-decision"
      ? {}
      : { selection: selectionFor(activeState, decision) }),
    terminal: decision.type === "surrender" ? "surrender-loss" : "none",
    outcomeProbe: { type: "combat-transition", decisionKey: key },
  };
};

export const describeLegalDecisions = (
  state: FightState,
  actorId: CombatantId,
): readonly CombatDecisionDescriptor[] =>
  enumerateLegalDecisions(state, actorId).map((decision) => describeLegalDecision(state, decision));
