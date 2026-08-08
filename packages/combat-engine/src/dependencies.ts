import type {
  ActiveEffectId,
  CombatDecisionId,
  CombatEventId,
  CombatantId,
  FightId,
  PendingDecisionId,
  ResolutionFrameId,
} from "./ids.js";

const maximumUint32 = 2 ** 32;

const validateIntegerRange = (minimum: number, maximum: number) => {
  if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || minimum > maximum) {
    throw new RangeError("Random integer bounds must be ordered integers.");
  }
  if (maximum - minimum >= maximumUint32) {
    throw new RangeError("Random integer range must be smaller than 2^32.");
  }
};

const unbiasedInteger = (nextUint32: () => number, minimum: number, maximum: number) => {
  validateIntegerRange(minimum, maximum);
  const range = maximum - minimum + 1;
  const acceptanceLimit = Math.floor(maximumUint32 / range) * range;
  let value = nextUint32();
  while (value >= acceptanceLimit) value = nextUint32();
  return minimum + (value % range);
};

export interface RandomSource {
  integer(minimum: number, maximum: number): number;
}

/** Cryptographically backed randomness for production composition only. */
export class SystemRandomSource implements RandomSource {
  integer(minimum: number, maximum: number): number {
    const values = new Uint32Array(1);
    return unbiasedInteger(
      () => {
        globalThis.crypto.getRandomValues(values);
        return values[0];
      },
      minimum,
      maximum,
    );
  }
}

/** Deterministic pseudo-randomness for simulations and reproducible tests. */
export class SeededRandomSource implements RandomSource {
  #state: number;

  constructor(seed: number) {
    if (!Number.isInteger(seed) || seed < 0 || seed >= maximumUint32) {
      throw new RangeError("Seed must be an unsigned 32-bit integer.");
    }
    this.#state = seed;
  }

  integer(minimum: number, maximum: number): number {
    return unbiasedInteger(() => this.nextUint32(), minimum, maximum);
  }

  private nextUint32(): number {
    this.#state = (Math.imul(1_664_525, this.#state) + 1_013_904_223) >>> 0;
    return this.#state;
  }
}

export interface Clock {
  now(): Date;
}

/** Production wall clock, kept behind an injectable boundary. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export interface CombatIdSource {
  nextFightId(): FightId;
  nextCombatantId(): CombatantId;
  nextDecisionId(): CombatDecisionId;
  nextEventId(): CombatEventId;
  nextPendingDecisionId(): PendingDecisionId;
  nextActiveEffectId(): ActiveEffectId;
  nextResolutionFrameId(): ResolutionFrameId;
}

const nextSystemId = <TPrefix extends string>(prefix: TPrefix) =>
  `${prefix}:${globalThis.crypto.randomUUID()}`;

/** Production ID source; deterministic ID sources remain available for tests. */
export class SystemCombatIdSource implements CombatIdSource {
  nextFightId(): FightId {
    return nextSystemId("fight") as FightId;
  }

  nextCombatantId(): CombatantId {
    return nextSystemId("combatant") as CombatantId;
  }

  nextDecisionId(): CombatDecisionId {
    return nextSystemId("decision") as CombatDecisionId;
  }

  nextEventId(): CombatEventId {
    return nextSystemId("event") as CombatEventId;
  }

  nextPendingDecisionId(): PendingDecisionId {
    return nextSystemId("pending-decision") as PendingDecisionId;
  }

  nextActiveEffectId(): ActiveEffectId {
    return nextSystemId("active-effect") as ActiveEffectId;
  }

  nextResolutionFrameId(): ResolutionFrameId {
    return nextSystemId("resolution-frame") as ResolutionFrameId;
  }
}

export interface CombatDependencies {
  readonly random: RandomSource;
  readonly clock: Clock;
  readonly ids: CombatIdSource;
}
