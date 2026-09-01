import type {
  ActiveEffectId,
  CombatDecisionId,
  CombatEventId,
  CombatantId,
  FightId,
  PendingDecisionId,
  ResolutionFrameId,
  ScheduledWorkId,
} from "./ids.js";
import type { CalculationTraceEntry, CalculationTraceSink } from "./calculation-pipeline.js";
import { mechanicsViewFor, type CombatMechanicsView } from "./mechanics-view.js";

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

const hashSeedParts = (parts: readonly string[]): number => {
  let hash = 2_166_136_261;
  for (const part of parts) {
    for (let index = 0; index < part.length; index += 1) {
      hash ^= part.charCodeAt(index);
      hash = Math.imul(hash, 16_777_619) >>> 0;
    }
    hash ^= 0;
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash >>> 0;
};

/** Derives a stable unsigned seed from semantic inputs, independent of call order. */
export const deriveDeterministicSeed = (parts: readonly (string | number)[]): number =>
  hashSeedParts(parts.map(String));

export interface KeyedRandomSource {
  readonly rootSeed: number;
  seedFor(key: string): number;
  integer(key: string, minimum: number, maximum: number): number;
}

/** AI-only keyed randomness; each operation is derived afresh from its semantic key. */
export class DerivedKeyedRandomSource implements KeyedRandomSource {
  readonly rootSeed: number;
  readonly #namespace: readonly string[];

  constructor(rootSeed: number, namespace: readonly string[] = []) {
    if (!Number.isInteger(rootSeed) || rootSeed < 0 || rootSeed >= maximumUint32)
      throw new RangeError("Root seed must be an unsigned 32-bit integer.");
    this.rootSeed = rootSeed;
    this.#namespace = [...namespace];
  }

  seedFor(key: string): number {
    return deriveDeterministicSeed([this.rootSeed, ...this.#namespace, key]);
  }

  integer(key: string, minimum: number, maximum: number): number {
    return new SeededRandomSource(this.seedFor(key)).integer(minimum, maximum);
  }
}

export const createAiRandomSource = (input: {
  readonly rootSeed: number;
  readonly profileVersion: string;
  readonly evaluatorVersion: string;
  readonly purpose: string;
}): DerivedKeyedRandomSource =>
  new DerivedKeyedRandomSource(input.rootSeed, [
    "ai",
    input.profileVersion,
    input.evaluatorVersion,
    input.purpose,
  ]);

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

/** A branch-local clock whose value cannot drift with wall time. */
export class FixedClock implements Clock {
  readonly #value: Date;

  constructor(value: Date) {
    this.#value = new Date(value);
    if (Number.isNaN(this.#value.valueOf())) throw new RangeError("Clock value must be valid.");
  }

  now(): Date {
    return new Date(this.#value);
  }
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
  nextScheduledWorkId(): ScheduledWorkId;
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

  nextScheduledWorkId(): ScheduledWorkId {
    return nextSystemId("scheduled-work") as ScheduledWorkId;
  }
}

const branchId = (branchPath: readonly string[]) =>
  deriveDeterministicSeed(["branch-id", ...branchPath]).toString(36);

/** Branch-local deterministic IDs; no production fight ID source is shared. */
export class BranchCombatIdSource implements CombatIdSource {
  readonly #prefix: string;
  readonly #counts = new Map<string, number>();

  constructor(branchPath: readonly string[]) {
    const path = branchPath.length === 0 ? ["root"] : branchPath;
    this.#prefix = `analysis-${branchId(path)}`;
  }

  #next(prefix: string): string {
    const count = this.#counts.get(prefix) ?? 0;
    this.#counts.set(prefix, count + 1);
    return `${prefix}:${this.#prefix}-${count}`;
  }

  nextFightId(): FightId {
    return this.#next("fight") as FightId;
  }

  nextCombatantId(): CombatantId {
    return this.#next("combatant") as CombatantId;
  }

  nextDecisionId(): CombatDecisionId {
    return this.#next("decision") as CombatDecisionId;
  }

  nextEventId(): CombatEventId {
    return this.#next("event") as CombatEventId;
  }

  nextPendingDecisionId(): PendingDecisionId {
    return this.#next("pending-decision") as PendingDecisionId;
  }

  nextActiveEffectId(): ActiveEffectId {
    return this.#next("active-effect") as ActiveEffectId;
  }

  nextResolutionFrameId(): ResolutionFrameId {
    return this.#next("resolution-frame") as ResolutionFrameId;
  }

  nextScheduledWorkId(): ScheduledWorkId {
    return this.#next("scheduled-work") as ScheduledWorkId;
  }
}

export interface CombatDependencies {
  readonly random: RandomSource;
  readonly clock: Clock;
  readonly ids: CombatIdSource;
  /** Opt-in calculation diagnostics; never part of authoritative fight state. */
  readonly retainDiagnosticTrace?: boolean;
  /** Ephemeral sink installed by a public transition while diagnostics are requested. */
  readonly diagnosticTraceSink?: CalculationTraceSink;
  /** Opt-in mechanic telemetry; never enters FightState, events, or replay identity. */
  readonly retainMechanicObservations?: boolean;
  /** The immutable catalog/configuration environment for this transition. */
  readonly mechanicsView?: CombatMechanicsView;
}

export { mechanicsViewFor };

export interface BranchCombatDependencies extends CombatDependencies {
  readonly branchPath: readonly string[];
  readonly branchSeed: number;
  readonly workBudget: {
    readonly maxNodes: number;
    readonly maxProbes: number;
  };
}

/** Creates isolated dependencies for one speculative branch. */
export const createBranchCombatDependencies = (input: {
  readonly rootSeed: number;
  readonly branchPath: readonly string[];
  readonly fixedTime: Date;
  readonly workBudget: { readonly maxNodes: number; readonly maxProbes: number };
}): BranchCombatDependencies => {
  if (
    !Number.isInteger(input.workBudget.maxNodes) ||
    input.workBudget.maxNodes < 0 ||
    !Number.isInteger(input.workBudget.maxProbes) ||
    input.workBudget.maxProbes < 0
  )
    throw new RangeError("Branch work budgets must be non-negative integers.");
  const branchPath = [...input.branchPath];
  const branchSeed = deriveDeterministicSeed(["combat-branch", input.rootSeed, ...branchPath]);
  return {
    random: new SeededRandomSource(branchSeed),
    clock: new FixedClock(input.fixedTime),
    ids: new BranchCombatIdSource(branchPath),
    branchPath,
    branchSeed,
    workBudget: { ...input.workBudget },
  };
};

export type CombatDiagnosticTrace = readonly CalculationTraceEntry[];
