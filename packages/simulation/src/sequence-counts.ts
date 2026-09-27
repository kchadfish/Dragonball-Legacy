import { z } from "zod";
import { canonicalHash } from "./canonical.js";
import type { SimulationSequence, SimulationSequenceEdge } from "./sequences.js";

export const sequenceOccurrenceSchema = z
  .object({
    pattern: z.array(z.string()).min(1).max(3),
    minTurnDistance: z.number().nonnegative(),
    maxTurnDistance: z.number().nonnegative(),
  })
  .strict();
export type SequenceOccurrence = z.infer<typeof sequenceOccurrenceSchema>;
export const sequenceCountSchema = sequenceOccurrenceSchema.extend({
  fights: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
});
export type SequenceCount = z.infer<typeof sequenceCountSchema>;

/** One entry per distinct pattern per fight, with distances from real occurrences. */
export const simulationSequenceOccurrences = (
  sequence: SimulationSequence,
): SequenceOccurrence[] => {
  const patterns = new Map<string, SequenceOccurrence>();
  for (const order of [1, 2, 3])
    for (let i = 0; i + order <= sequence.tokens.length; i++) {
      const tokens = sequence.tokens.slice(i, i + order);
      const pattern = tokens.map((t) => t.token);
      const key = JSON.stringify(pattern);
      const distance = Math.max(0, (tokens.at(-1)?.turnNumber ?? 0) - (tokens[0]?.turnNumber ?? 0));
      const prior = patterns.get(key);
      patterns.set(key, {
        pattern,
        minTurnDistance: Math.min(prior?.minTurnDistance ?? distance, distance),
        maxTurnDistance: Math.max(prior?.maxTurnDistance ?? distance, distance),
      });
    }
  return [...patterns.values()].sort((a, b) =>
    canonicalHash(a.pattern).localeCompare(canonicalHash(b.pattern)),
  );
};
export const addSimulationSequenceCounts = (
  counts: Map<string, SequenceCount>,
  occurrences: readonly SequenceOccurrence[],
  won: boolean,
): void => {
  for (const entry of occurrences) {
    const key = JSON.stringify(entry.pattern),
      prior = counts.get(key);
    counts.set(key, {
      ...entry,
      fights: (prior?.fights ?? 0) + 1,
      wins: (prior?.wins ?? 0) + Number(won),
      minTurnDistance: Math.min(
        prior?.minTurnDistance ?? entry.minTurnDistance,
        entry.minTurnDistance,
      ),
      maxTurnDistance: Math.max(
        prior?.maxTurnDistance ?? entry.maxTurnDistance,
        entry.maxTurnDistance,
      ),
    });
  }
};
export const renderSimulationSequenceCounts = (
  counts: ReadonlyMap<string, SequenceCount>,
  total: number,
  order: 2 | 3,
): SimulationSequenceEdge[] =>
  [...counts.values()]
    .filter((c) => c.pattern.length === order)
    .map((c) => ({
      pattern: c.pattern,
      order,
      support: total === 0 ? 0 : c.fights / total,
      sequenceCount: c.fights,
      conversionRate:
        c.fights / (counts.get(JSON.stringify(c.pattern.slice(0, -1)))?.fights ?? c.fights),
      outcomeAssociation: c.wins / c.fights,
      minTurnDistance: c.minTurnDistance,
      maxTurnDistance: c.maxTurnDistance,
    }))
    .sort(
      (a, b) =>
        b.support - a.support || canonicalHash(a.pattern).localeCompare(canonicalHash(b.pattern)),
    );
