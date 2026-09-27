import type { CombatEvent, LegalDecision } from "@dragonball-resurgence/combat-engine";

import { canonicalHash } from "./canonical.js";
import {
  addSimulationSequenceCounts,
  renderSimulationSequenceCounts,
  simulationSequenceOccurrences,
  type SequenceCount,
} from "./sequence-counts.js";
import type { SimulationFightExecutionResult } from "./contracts.js";

export interface SimulationSequenceToken {
  readonly index: number;
  readonly kind: "action" | "event";
  readonly token: string;
  readonly actorId?: string;
  readonly sourceId?: string;
  readonly turnNumber?: number;
  readonly preconditions?: readonly string[];
}

export interface SimulationSequenceFrame {
  readonly decision?: LegalDecision;
  readonly events: readonly CombatEvent[];
  readonly turnNumber?: number;
}

export interface SimulationSequence {
  readonly sequenceId: string;
  readonly outcome?: "win" | "loss" | "other";
  readonly tokens: readonly SimulationSequenceToken[];
}

export interface SimulationSequenceEdge {
  readonly pattern: readonly string[];
  readonly order: 2 | 3;
  readonly support: number;
  readonly sequenceCount: number;
  readonly conversionRate: number;
  readonly outcomeAssociation: number;
  readonly minTurnDistance: number;
  readonly maxTurnDistance: number;
}

const actionTokenFor = (
  decision: LegalDecision,
  turnNumber?: number,
): Omit<SimulationSequenceToken, "index"> => {
  let token: string = decision.type;
  let sourceId: string | undefined;
  if (decision.type === "use-move") {
    token = `use-move:${decision.moveId}`;
    sourceId = decision.moveId;
  } else if (decision.type === "use-item") {
    token = `use-item:${decision.itemId}`;
    sourceId = decision.itemId;
  } else if (decision.type === "basic-attack") token = `basic-attack:${decision.basicAttack}`;
  else if (decision.type === "activate-transformation") sourceId = decision.transformationId;
  return { kind: "action", token, actorId: decision.actorId, sourceId, turnNumber };
};

const eventTokenFor = (
  event: CombatEvent,
  turnNumber?: number,
): Omit<SimulationSequenceToken, "index"> => {
  let actorId: string | undefined;
  if ("combatantId" in event) actorId = event.combatantId;
  else if ("sourceCombatantId" in event) actorId = event.sourceCombatantId;
  let preconditions: readonly string[] | undefined;
  if (event.type === "status-applied") preconditions = [`status:${event.statusId}`];
  else if (event.type === "move-removed-from-combat")
    preconditions = [`restricted-use-exhausted:${event.moveId}`];
  else if (event.type === "action-skipped") preconditions = [`action-skipped:${event.reason}`];
  else if (event.type === "attack-resolved") preconditions = [`attack-outcome:${event.outcome}`];
  return {
    kind: "event",
    token: `event:${event.type}`,
    actorId,
    sourceId: event.sourceDefinitionId,
    turnNumber,
    ...(preconditions === undefined ? {} : { preconditions }),
  };
};

const meaningfulEventTypes = new Set<CombatEvent["type"]>([
  "move-used",
  "item-used",
  "attack-resolved",
  "effect-activated",
  "effect-expired",
  "effect-deactivated",
  "effect-negated",
  "effect-replaced",
  "move-selection-updated",
  "move-removed-from-combat",
  "status-applied",
  "status-removed",
  "transformation-activated",
  "transformation-deactivated",
  "transformation-cooldown-started",
  "ki-changed",
  "damage-applied",
  "action-skipped",
  "deferred-move-scheduled",
  "deferred-move-cancelled",
  "deferred-move-performed",
  "counter-chain-limit-reached",
  "combatant-defeated",
  "fight-ended",
]);

const tokensForFrames = (
  frames: readonly SimulationSequenceFrame[],
): readonly SimulationSequenceToken[] =>
  frames
    .flatMap((frame) => [
      ...(frame.decision === undefined ? [] : [actionTokenFor(frame.decision, frame.turnNumber)]),
      ...[...frame.events]
        .filter((event) => meaningfulEventTypes.has(event.type))
        .sort((left, right) => left.sequence - right.sequence)
        .map((event) => eventTokenFor(event, frame.turnNumber)),
    ])
    .map((token, index) => ({ ...token, index }));

export const normalizeSimulationSequenceFrames = (
  frames: readonly SimulationSequenceFrame[],
  sequenceId = canonicalHash(frames),
  outcome?: SimulationSequence["outcome"],
): SimulationSequence => ({
  sequenceId,
  outcome,
  tokens: tokensForFrames(frames),
});

export const simulationSequenceForResult = (
  result: SimulationFightExecutionResult,
): SimulationSequence | undefined => {
  if (result.diagnostics?.sequenceFrames === undefined) return undefined;
  const winnerId = result.completion?.winnerCombatantId;
  let outcome: SimulationSequence["outcome"] = "other";
  if (winnerId === result.fighterAId) outcome = "win";
  else if (winnerId === result.fighterBId) outcome = "loss";
  return normalizeSimulationSequenceFrames(
    result.diagnostics.sequenceFrames,
    result.runId,
    outcome,
  );
};

export const normalizeSimulationSequence = (
  decisions: readonly LegalDecision[],
  events: readonly CombatEvent[],
  sequenceId = canonicalHash({ decisions, events }),
  outcome?: SimulationSequence["outcome"],
): SimulationSequence => ({
  sequenceId,
  outcome,
  tokens: tokensForFrames([...decisions.map((decision) => ({ decision, events: [] })), { events }]),
});

/** Descriptive P(full contiguous pattern in fight | prefix in fight), not causal conversion. */
export const analyzeSimulationSequences = (
  sequences: readonly SimulationSequence[],
  order: 2 | 3 = 2,
): readonly SimulationSequenceEdge[] => {
  const counts = new Map<string, SequenceCount>();
  const unique = new Map(sequences.map((sequence) => [sequence.sequenceId, sequence]));
  for (const sequence of unique.values())
    addSimulationSequenceCounts(
      counts,
      simulationSequenceOccurrences(sequence),
      sequence.outcome === "win",
    );
  return renderSimulationSequenceCounts(counts, unique.size, order).slice(0, 10);
};
