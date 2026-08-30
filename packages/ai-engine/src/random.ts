import {
  createAiRandomSource as createCombatAiRandomSource,
  type DerivedKeyedRandomSource,
} from "@dragonball-resurgence/combat-engine";

export interface AiRandomSource {
  readonly rootSeed: number;
  readonly profileVersion: string;
  readonly evaluatorVersion: string;
  readonly purpose: string;
  probability(key: string, chancePercent: number): boolean;
  boundedScoreNoise(key: string, minimum: number, maximum: number): number;
  selectMistake<T>(
    key: string,
    candidates: readonly { readonly key: string; readonly value: T }[],
  ): T;
  tieBreak(key: string): number;
}

const validatePercent = (chancePercent: number): void => {
  if (!Number.isFinite(chancePercent) || chancePercent < 0 || chancePercent > 100) {
    throw new RangeError("AI probability must be between 0 and 100.");
  }
};

const validateBounds = (minimum: number, maximum: number): void => {
  if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || minimum > maximum) {
    throw new RangeError("AI score-noise bounds must be ordered integers.");
  }
};

export class DerivedAiRandomSource implements AiRandomSource {
  readonly rootSeed: number;
  readonly profileVersion: string;
  readonly evaluatorVersion: string;
  readonly purpose: string;
  readonly #source: DerivedKeyedRandomSource;

  constructor(input: {
    readonly rootSeed: number;
    readonly profileVersion: string;
    readonly evaluatorVersion: string;
    readonly purpose: string;
  }) {
    this.rootSeed = input.rootSeed;
    this.profileVersion = input.profileVersion;
    this.evaluatorVersion = input.evaluatorVersion;
    this.purpose = input.purpose;
    this.#source = createCombatAiRandomSource(input);
  }

  probability(key: string, chancePercent: number): boolean {
    validatePercent(chancePercent);
    return this.#source.integer(`probability:${key}`, 1, 100) <= chancePercent;
  }

  boundedScoreNoise(key: string, minimum: number, maximum: number): number {
    validateBounds(minimum, maximum);
    return this.#source.integer(`score-noise:${key}`, minimum, maximum);
  }

  selectMistake<T>(
    key: string,
    candidates: readonly { readonly key: string; readonly value: T }[],
  ): T {
    if (candidates.length === 0)
      throw new RangeError("Cannot select a mistake from no candidates.");
    const ordered = [...candidates].sort((left, right) => left.key.localeCompare(right.key));
    return ordered[this.#source.integer(`mistake:${key}`, 0, ordered.length - 1)].value;
  }

  tieBreak(key: string): number {
    return this.#source.integer(`tie-break:${key}`, 0, 4_294_967_295);
  }
}

export const createAiRandomSource = (input: {
  readonly rootSeed: number;
  readonly profileVersion: string;
  readonly evaluatorVersion: string;
  readonly purpose: string;
}): AiRandomSource => new DerivedAiRandomSource(input);

export const keyedProbabilityCheck = (
  random: AiRandomSource,
  key: string,
  chancePercent: number,
): boolean => random.probability(key, chancePercent);

export const boundedScoreNoise = (
  random: AiRandomSource,
  key: string,
  minimum: number,
  maximum: number,
): number => random.boundedScoreNoise(key, minimum, maximum);

export const selectMistake = <T>(
  random: AiRandomSource,
  key: string,
  candidates: readonly { readonly key: string; readonly value: T }[],
): T => random.selectMistake(key, candidates);

export const tieBreak = (random: AiRandomSource, key: string): number => random.tieBreak(key);
