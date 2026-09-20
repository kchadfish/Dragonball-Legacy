import type { CombatEvent, LegalDecision } from "@dragonball-resurgence/combat-engine";

import { canonicalHash } from "./canonical.js";
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

const patternsFor = (
  tokens: readonly SimulationSequenceToken[],
  order: 2 | 3,
): readonly string[][] =>
  Array.from({ length: Math.max(0, tokens.length - order + 1) }, (_, index) =>
    tokens.slice(index, index + order).map((token) => token.token),
  );

export const analyzeSimulationSequences = (
  sequences: readonly SimulationSequence[],
  order: 2 | 3 = 2,
): readonly SimulationSequenceEdge[] => {
  const counts = new Map<
    string,
    {
      pattern: readonly string[];
      sequences: Set<string>;
      outcomes: number;
      occurrences: number;
      turnDistances: number[];
    }
  >();
  for (const sequence of sequences) {
    const seen = new Set<string>();
    for (const pattern of patternsFor(sequence.tokens, order)) {
      const key = canonicalHash(pattern);
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = counts.get(key) ?? {
        pattern,
        sequences: new Set<string>(),
        outcomes: 0,
        occurrences: 0,
        turnDistances: [],
      };
      entry.sequences.add(sequence.sequenceId);
      entry.occurrences += 1;
      const firstTurn = sequence.tokens.find((token) => token.token === pattern[0])?.turnNumber;
      const lastTurn = sequence.tokens.find((token) => token.token === pattern.at(-1))?.turnNumber;
      if (firstTurn !== undefined && lastTurn !== undefined)
        entry.turnDistances.push(Math.max(0, lastTurn - firstTurn));
      if (sequence.outcome === "win") entry.outcomes += 1;
      counts.set(key, entry);
    }
  }
  const sequenceCount = new Set(sequences.map((sequence) => sequence.sequenceId)).size;
  return [...counts.values()]
    .map((entry) => ({
      pattern: entry.pattern,
      order,
      support: sequenceCount === 0 ? 0 : entry.sequences.size / sequenceCount,
      sequenceCount: entry.sequences.size,
      conversionRate: entry.occurrences === 0 ? 0 : entry.sequences.size / entry.occurrences,
      outcomeAssociation: entry.sequences.size === 0 ? 0 : entry.outcomes / entry.sequences.size,
      minTurnDistance: entry.turnDistances.length === 0 ? 0 : Math.min(...entry.turnDistances),
      maxTurnDistance: entry.turnDistances.length === 0 ? 0 : Math.max(...entry.turnDistances),
    }))
    .sort(
      (left, right) =>
        right.support - left.support ||
        right.sequenceCount - left.sequenceCount ||
        canonicalHash(left.pattern).localeCompare(canonicalHash(right.pattern)),
    )
    .slice(0, 10);
};
