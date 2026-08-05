import type { CombatDependencies, CombatIdSource, Clock, RandomSource } from "../dependencies.js";
import type {
  ActiveEffectId,
  CombatDecisionId,
  CombatEventId,
  CombatantId,
  FightId,
  PendingDecisionId,
} from "../ids.js";

export class SequenceRandomSource implements RandomSource {
  readonly #values: readonly number[];
  #index = 0;

  constructor(values: readonly number[]) {
    this.#values = values;
  }

  integer(minimum: number, maximum: number): number {
    const value = this.#values[this.#index++];
    if (value === undefined) throw new Error("SequenceRandomSource is exhausted.");
    if (value < minimum || value > maximum) {
      throw new RangeError(
        `Expected a value between ${minimum} and ${maximum}; received ${value}.`,
      );
    }
    return value;
  }
}

export class FixedClock implements Clock {
  readonly #value: Date;

  constructor(value: Date) {
    this.#value = new Date(value);
  }

  now(): Date {
    return new Date(this.#value);
  }
}

export interface CombatIdSequences {
  readonly activeEffectIds?: readonly ActiveEffectId[];
  readonly combatantIds?: readonly CombatantId[];
  readonly decisionIds?: readonly CombatDecisionId[];
  readonly eventIds?: readonly CombatEventId[];
  readonly fightIds?: readonly FightId[];
  readonly pendingDecisionIds?: readonly PendingDecisionId[];
}

const takeSequenceValue = <T>(values: readonly T[], name: string): readonly [T, readonly T[]] => {
  const [value, ...remaining] = values;
  if (value === undefined) throw new Error(`SequenceCombatIdSource is exhausted for ${name}.`);
  return [value, remaining];
};

export class SequenceCombatIdSource implements CombatIdSource {
  #activeEffectIds: readonly ActiveEffectId[];
  #combatantIds: readonly CombatantId[];
  #decisionIds: readonly CombatDecisionId[];
  #eventIds: readonly CombatEventId[];
  #fightIds: readonly FightId[];
  #pendingDecisionIds: readonly PendingDecisionId[];

  constructor(sequences: CombatIdSequences) {
    this.#activeEffectIds = sequences.activeEffectIds ?? [];
    this.#combatantIds = sequences.combatantIds ?? [];
    this.#decisionIds = sequences.decisionIds ?? [];
    this.#eventIds = sequences.eventIds ?? [];
    this.#fightIds = sequences.fightIds ?? [];
    this.#pendingDecisionIds = sequences.pendingDecisionIds ?? [];
  }

  nextFightId(): FightId {
    const [value, remaining] = takeSequenceValue(this.#fightIds, "fightIds");
    this.#fightIds = remaining;
    return value;
  }

  nextCombatantId(): CombatantId {
    const [value, remaining] = takeSequenceValue(this.#combatantIds, "combatantIds");
    this.#combatantIds = remaining;
    return value;
  }

  nextDecisionId(): CombatDecisionId {
    const [value, remaining] = takeSequenceValue(this.#decisionIds, "decisionIds");
    this.#decisionIds = remaining;
    return value;
  }

  nextEventId(): CombatEventId {
    const [value, remaining] = takeSequenceValue(this.#eventIds, "eventIds");
    this.#eventIds = remaining;
    return value;
  }

  nextPendingDecisionId(): PendingDecisionId {
    const [value, remaining] = takeSequenceValue(this.#pendingDecisionIds, "pendingDecisionIds");
    this.#pendingDecisionIds = remaining;
    return value;
  }

  nextActiveEffectId(): ActiveEffectId {
    const [value, remaining] = takeSequenceValue(this.#activeEffectIds, "activeEffectIds");
    this.#activeEffectIds = remaining;
    return value;
  }
}

export const createTestCombatDependencies = (
  randomValues: readonly number[],
  clock: Date,
  ids: CombatIdSequences,
): CombatDependencies => ({
  random: new SequenceRandomSource(randomValues),
  clock: new FixedClock(clock),
  ids: new SequenceCombatIdSource(ids),
});
