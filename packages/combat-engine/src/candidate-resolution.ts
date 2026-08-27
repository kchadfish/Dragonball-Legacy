import type {
  MoveDefinition,
  MoveId,
  MoveSelectorCondition,
} from "@dragonball-resurgence/game-data";

import type {
  ActiveCombatEffect,
  CombatActionRecord,
  CombatantState,
  FightState,
  PendingDecision,
  PendingDecisionOption,
  RespondToPendingDecision,
} from "./contracts.js";
import type { ActiveEffectId, CombatDecisionId, CombatantId } from "./ids.js";
import { matchesMoveSelector } from "./selector-matching.js";

export type CombatCandidate =
  | {
      readonly type: "combatant";
      readonly id: CombatantId;
      readonly combatant: CombatantState;
      readonly relation: "self" | "opponent" | "participant";
    }
  | {
      readonly type: "move";
      readonly id: MoveId;
      readonly move: MoveDefinition;
      readonly ownerCombatantId: CombatantId;
      readonly source: "moveset" | "active-constant";
    }
  | {
      readonly type: "active-effect";
      readonly id: ActiveEffectId;
      readonly effect: ActiveCombatEffect;
    }
  | {
      readonly type: "source-effect";
      readonly id: string;
      readonly sourceDefinitionId: string;
      readonly effectIndex: number;
      readonly effect: NonNullable<MoveDefinition["effects"]>[number];
    }
  | {
      readonly type: "source-action";
      readonly id: CombatDecisionId;
      readonly action: Extract<CombatActionRecord, { readonly type: "basic-attack" | "use-move" }>;
    };

export type CandidateReference =
  | { readonly type: "combatant"; readonly id: CombatantId }
  | { readonly type: "move"; readonly id: MoveId; readonly ownerCombatantId: CombatantId }
  | { readonly type: "active-effect"; readonly id: ActiveEffectId }
  | { readonly type: "source-effect"; readonly id: string }
  | { readonly type: "source-action"; readonly id: CombatDecisionId };

export interface CandidateResolutionOptions {
  readonly includeActiveConstants?: boolean;
  readonly includeDeactivatedConstants?: boolean;
  readonly selector?: MoveSelectorCondition;
}

export type PendingSelectionType =
  "select-combatant" | "select-move" | "select-source-action" | "select-source-effect";

export interface PendingSelectionInput {
  readonly id: PendingDecision["id"];
  readonly stateVersion: number;
  readonly combatantId: CombatantId;
  readonly type: PendingSelectionType;
  readonly candidates: readonly CombatCandidate[];
  readonly selection: NonNullable<PendingDecision["selection"]>;
  readonly optional?: boolean;
  readonly optionIdPrefix?: string;
}

const candidateRelation = (
  combatantId: CombatantId,
  actorId: CombatantId,
  relation: "self" | "opponent" | "participants",
): "self" | "opponent" | "participant" => {
  if (combatantId === actorId) return "self";
  if (relation === "opponent") return "opponent";
  return "participant";
};

const moveMapFrom = (
  moves: ReadonlyMap<string, MoveDefinition> | readonly MoveDefinition[],
): ReadonlyMap<string, MoveDefinition> => {
  if (moves instanceof Map) return moves;
  return new Map((moves as readonly MoveDefinition[]).map((move) => [move.id, move] as const));
};

export const resolveCombatantCandidates = (
  state: FightState,
  actorId: CombatantId,
  relation: "self" | "opponent" | "participants" = "participants",
): readonly Extract<CombatCandidate, { readonly type: "combatant" }>[] =>
  Object.values(state.combatants)
    .filter((combatant) => combatant.status === "active")
    .filter((combatant) => {
      if (relation === "participants") return true;
      if (relation === "self") return combatant.id === actorId;
      return combatant.id !== actorId;
    })
    .map((combatant) => ({
      type: "combatant" as const,
      id: combatant.id,
      combatant,
      relation: candidateRelation(combatant.id, actorId, relation),
    }));

export const resolveMoveCandidates = (
  state: FightState,
  ownerCombatantId: CombatantId,
  moves: ReadonlyMap<string, MoveDefinition> | readonly MoveDefinition[],
  options: CandidateResolutionOptions = {},
): readonly Extract<CombatCandidate, { readonly type: "move" }>[] => {
  const moveMap = moveMapFrom(moves);
  const owner = Object.values(state.combatants).find(
    (combatant) => combatant.id === ownerCombatantId,
  );
  if (owner === undefined) return [];
  const candidates = owner.moveIds.flatMap((moveId) => {
    const move = moveMap.get(moveId);
    return move === undefined ||
      (options.selector !== undefined && !matchesMoveSelector(move, options.selector))
      ? []
      : [
          {
            type: "move" as const,
            id: move.id,
            move,
            ownerCombatantId,
            source: "moveset" as const,
          },
        ];
  });
  if (options.includeActiveConstants !== true) return candidates;
  const activeConstants = state.activeEffects.flatMap((effect) => {
    if (
      effect.type !== "active-constant" ||
      effect.sourceCombatantId !== ownerCombatantId ||
      (effect.lifecycle === "deactivated" && options.includeDeactivatedConstants !== true)
    )
      return [];
    const move = effect.replacement?.sourceMoveSnapshot ?? moveMap.get(effect.sourceDefinitionId);
    return move === undefined ||
      (options.selector !== undefined && !matchesMoveSelector(move, options.selector))
      ? []
      : [
          {
            type: "move" as const,
            id: move.id,
            move,
            ownerCombatantId,
            source: "active-constant" as const,
          },
        ];
  });
  return [...candidates, ...activeConstants].filter(
    (candidate, index, all) => all.findIndex((other) => other.id === candidate.id) === index,
  );
};

export const resolveActiveEffectCandidates = (
  state: FightState,
  ownerCombatantId?: CombatantId,
): readonly Extract<CombatCandidate, { readonly type: "active-effect" }>[] =>
  state.activeEffects
    .filter(
      (effect) => ownerCombatantId === undefined || effect.sourceCombatantId === ownerCombatantId,
    )
    .map((effect) => ({ type: "active-effect" as const, id: effect.id, effect }));

export const resolveSourceEffectCandidates = (
  move: MoveDefinition,
): readonly Extract<CombatCandidate, { readonly type: "source-effect" }>[] =>
  (move.effects ?? []).map((effect, effectIndex) => ({
    type: "source-effect" as const,
    id: `${move.id}:${effectIndex}`,
    sourceDefinitionId: move.id,
    effectIndex,
    effect,
  }));

export const resolveSourceActionCandidates = (
  state: FightState,
  actorId?: CombatantId,
): readonly Extract<CombatCandidate, { readonly type: "source-action" }>[] =>
  state.actionHistory.flatMap((action) => {
    if (action.type !== "basic-attack" && action.type !== "use-move") return [];
    if (actorId !== undefined && action.actorId !== actorId) return [];
    return [{ type: "source-action" as const, id: action.decisionId, action }];
  });

export const candidateReference = (candidate: CombatCandidate): CandidateReference => {
  switch (candidate.type) {
    case "combatant":
      return { type: candidate.type, id: candidate.id };
    case "move":
      return {
        type: candidate.type,
        id: candidate.id,
        ownerCombatantId: candidate.ownerCombatantId,
      };
    case "active-effect":
      return { type: candidate.type, id: candidate.id };
    case "source-effect":
      return { type: candidate.type, id: candidate.id };
    case "source-action":
      return { type: candidate.type, id: candidate.id };
  }
};

export const candidateReferenceId = (reference: CandidateReference) =>
  `${reference.type}:${reference.id}`;

const optionTypeForCandidate = (candidate: CombatCandidate): PendingDecisionOption["type"] => {
  if (candidate.type === "combatant") return "select-combatant";
  if (candidate.type === "move") return "select-move";
  if (candidate.type === "source-action") return "select-source-action";
  if (candidate.type === "source-effect") return "select-source-effect";
  return "activate-effect";
};

/** Builds a serializable pending choice from one resolved candidate snapshot. */
export const createPendingSelection = (
  input: PendingSelectionInput,
): PendingDecision | undefined => {
  if (input.candidates.length === 0) return undefined;
  const options = input.candidates.map((candidate) => {
    const reference = candidateReference(candidate);
    const option: PendingDecisionOption = {
      id: `${input.optionIdPrefix ?? "candidate"}:${candidateReferenceId(reference)}`,
      type: optionTypeForCandidate(candidate),
      candidate: reference,
    };
    if (candidate.type === "combatant") return { ...option, combatantId: candidate.id };
    if (candidate.type === "move") return { ...option, moveId: candidate.id };
    if (candidate.type === "active-effect") return { ...option, activeEffectId: candidate.id };
    if (candidate.type === "source-action") return { ...option, sourceActionId: candidate.id };
    return { ...option, effectIndices: [candidate.effectIndex] };
  });
  return {
    id: input.id,
    stateVersion: input.stateVersion,
    combatantId: input.combatantId,
    type: input.type,
    candidates: input.candidates.map(candidateReference),
    selection: input.selection,
    ...(input.optional === undefined ? {} : { optional: input.optional }),
    options: [
      ...options,
      ...(input.optional === true ? [{ id: "decline", type: "decline" as const }] : []),
    ],
  };
};

export type PendingSelectionValidation =
  | { readonly ok: true; readonly options: readonly PendingDecisionOption[] }
  | { readonly ok: false; readonly reason: "not-configured" | "invalid-selection" };

/**
 * Validates a generic response against the exact persisted candidate set.
 * Specialized legacy pending decisions intentionally bypass this helper by
 * omitting `candidates` until their migration is complete.
 */
export const validatePendingSelection = (
  pending: PendingDecision,
  decision: Pick<RespondToPendingDecision, "optionId" | "optionIds">,
  // eslint-disable-next-line complexity, sonarjs/cognitive-complexity -- Validation keeps cardinality and exact-candidate checks together.
): PendingSelectionValidation => {
  if (pending.candidates === undefined) return { ok: false, reason: "not-configured" };
  const optionIds = [...new Set([decision.optionId, ...(decision.optionIds ?? [])])];
  if (optionIds.length === 1 && optionIds[0] === "decline") {
    return pending.optional === true
      ? { ok: true, options: [] }
      : { ok: false, reason: "invalid-selection" };
  }
  const options = optionIds.flatMap((optionId) => {
    const option = pending.options.find((candidate) => candidate.id === optionId);
    return option === undefined ? [] : [option];
  });
  if (
    options.length !== optionIds.length ||
    options.some((option) => option.candidate === undefined)
  )
    return { ok: false, reason: "invalid-selection" };
  const offered = new Set(pending.candidates.map(candidateReferenceId));
  const selected = options.map((option) => candidateReferenceId(option.candidate!));
  if (
    new Set(selected).size !== selected.length ||
    selected.some((candidateId) => !offered.has(candidateId))
  )
    return { ok: false, reason: "invalid-selection" };
  const selection = pending.selection;
  if (selection?.type === "one" && selected.length !== 1) {
    return { ok: false, reason: "invalid-selection" };
  }
  if (selection?.type === "up-to") {
    const limit =
      selection.limit.type === "literal" ? selection.limit.value : pending.candidates.length;
    if (selected.length < 1 || selected.length > limit) {
      return { ok: false, reason: "invalid-selection" };
    }
  }
  if (selection?.type === "all" && selected.length !== pending.candidates.length) {
    return { ok: false, reason: "invalid-selection" };
  }
  return { ok: true, options };
};
