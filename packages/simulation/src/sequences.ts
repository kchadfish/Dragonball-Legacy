import type { CombatEvent, LegalDecision } from "@dragonball-resurgence/combat-engine";

import { canonicalHash } from "./canonical.js";

export interface SimulationSequenceToken {
  readonly index: number;
  readonly kind: "action" | "event";
  readonly token: string;
  readonly actorId?: string;
  readonly sourceId?: string;
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
}

const actionTokenFor = (decision: LegalDecision): Omit<SimulationSequenceToken, "index"> => {
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
  return { kind: "action", token, actorId: decision.actorId, sourceId };
};

const eventTokenFor = (event: CombatEvent): Omit<SimulationSequenceToken, "index"> => {
  let actorId: string | undefined;
  if ("combatantId" in event) actorId = event.combatantId;
  else if ("sourceCombatantId" in event) actorId = event.sourceCombatantId;
  return {
    kind: "event",
    token: `event:${event.type}`,
    actorId,
    sourceId: event.sourceDefinitionId,
  };
};

export const normalizeSimulationSequence = (
  decisions: readonly LegalDecision[],
  events: readonly CombatEvent[],
  sequenceId = canonicalHash({ decisions, events }),
  outcome?: SimulationSequence["outcome"],
): SimulationSequence => ({
  sequenceId,
  outcome,
  tokens: [...decisions.map(actionTokenFor), ...events.map(eventTokenFor)].map((token, index) => ({
    ...token,
    index,
  })),
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
    { pattern: readonly string[]; sequences: Set<string>; outcomes: number; occurrences: number }
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
      };
      entry.sequences.add(sequence.sequenceId);
      entry.occurrences += 1;
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
    }))
    .sort((left, right) => canonicalHash(left.pattern).localeCompare(canonicalHash(right.pattern)));
};
