/** Shared counter/availability primitives for move and effect uses. */
export const isUseAvailable = (used: number, limit: number | undefined): boolean =>
  limit === undefined || (Number.isInteger(used) && used >= 0 && used < limit);

export const consumeUse = (used: number): number => {
  if (!Number.isInteger(used) || used < 0)
    throw new RangeError("Use counters must be non-negative integers.");
  return used + 1;
};

/** Whether a finite persisted allowance still has a consumable use. */
export const hasRemainingUses = (remaining: number): boolean =>
  Number.isInteger(remaining) && remaining > 0;

/** Consumes one persisted allowance, returning zero when it is exhausted. */
export const consumeRemainingUse = (remaining: number): number => {
  if (!hasRemainingUses(remaining))
    throw new RangeError("Remaining-use counters must be positive integers.");
  return remaining - 1;
};
