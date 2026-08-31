import { GLOBAL_RULES, RULES_VERSION, type RulesVersion } from "@dragonball-resurgence/game-config";
import {
  GENERIC_CLASS_DEFINITIONS,
  ITEM_DEFINITIONS,
  MOVE_DEFINITIONS,
  RACE_DEFINITIONS,
  TRANSFORMATION_DEFINITIONS,
  type GenericClassDefinition,
  type ItemDefinition,
  type MoveDefinition,
  type RaceDefinition,
  type TransformationDefinition,
} from "@dragonball-resurgence/game-data";
import { z } from "zod";

import { compileEffectPlan, type CompiledEffect } from "./effect-executors.js";
import { compileItemEffectPlan, type CompiledItemEffect } from "./item-effect-adapters.js";

export const mechanicsViewIdentitySchema = z
  .object({
    schemaVersion: z.literal("combat-mechanics-view:v1"),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .strict();

export type MechanicsViewIdentity = z.infer<typeof mechanicsViewIdentitySchema>;

type WidenLiteral<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends readonly unknown[]
        ? readonly WidenLiteral<T[number]>[]
        : T extends object
          ? { readonly [K in keyof T]: WidenLiteral<T[K]> }
          : T;

export type CombatRules = WidenLiteral<typeof GLOBAL_RULES>;

export interface CombatMechanicsViewInput {
  readonly rules: CombatRules;
  readonly rulesVersion: RulesVersion;
  readonly moves: readonly MoveDefinition[];
  readonly items: readonly ItemDefinition[];
  readonly transformations: readonly TransformationDefinition[];
  readonly races: readonly RaceDefinition[];
  readonly genericClasses: readonly GenericClassDefinition[];
}

export interface CombatMechanicsView extends CombatMechanicsViewInput {
  /** Compatibility label for advisory consumers; identity.contentHash is authoritative. */
  readonly version: string;
  readonly identity: MechanicsViewIdentity;
  readonly indexes: {
    readonly moves: ReadonlyMap<MoveDefinition["id"], MoveDefinition>;
    readonly items: ReadonlyMap<ItemDefinition["id"], ItemDefinition>;
    readonly transformations: ReadonlyMap<TransformationDefinition["id"], TransformationDefinition>;
    readonly races: ReadonlyMap<RaceDefinition["id"], RaceDefinition>;
    readonly genericClasses: ReadonlyMap<GenericClassDefinition["id"], GenericClassDefinition>;
    readonly raceTraits: ReadonlyMap<string, RaceDefinition["racialTraits"][number]>;
    readonly raceClasses: ReadonlyMap<string, RaceDefinition["classes"][number]>;
  };
  readonly compiledEffectPlans: ReadonlyMap<string, CompiledEffect>;
  readonly compiledItemEffectPlans: ReadonlyMap<string, CompiledItemEffect>;
}

class ImmutableMap<TKey, TValue> implements ReadonlyMap<TKey, TValue> {
  readonly #entries: ReadonlyMap<TKey, TValue>;

  constructor(entries: Iterable<readonly [TKey, TValue]>) {
    this.#entries = new Map(entries);
  }

  get size(): number {
    return this.#entries.size;
  }

  get(key: TKey): TValue | undefined {
    return this.#entries.get(key);
  }

  has(key: TKey): boolean {
    return this.#entries.has(key);
  }

  entries(): IterableIterator<[TKey, TValue]> {
    return this.#entries.entries();
  }

  keys(): IterableIterator<TKey> {
    return this.#entries.keys();
  }

  values(): IterableIterator<TValue> {
    return this.#entries.values();
  }

  forEach(callbackfn: (value: TValue, key: TKey, map: ReadonlyMap<TKey, TValue>) => void): void {
    this.#entries.forEach((value, key) => callbackfn(value, key, this));
  }

  [Symbol.iterator](): IterableIterator<[TKey, TValue]> {
    return this.entries();
  }
}

const freezeDeep = <T>(value: T, seen = new WeakSet<object>()): T => {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) value.forEach((entry) => freezeDeep(entry, seen));
  else Object.values(value).forEach((entry) => freezeDeep(entry, seen));
  return Object.freeze(value);
};

const sortedById = <T extends { readonly id: string }>(entries: readonly T[]): readonly T[] =>
  [...entries].sort((left, right) => left.id.localeCompare(right.id));

const canonicalContent = (input: CombatMechanicsViewInput) => ({
  rulesVersion: input.rulesVersion,
  rules: input.rules,
  moves: sortedById(input.moves),
  items: sortedById(input.items),
  transformations: sortedById(input.transformations),
  races: sortedById(input.races),
  genericClasses: sortedById(input.genericClasses),
});

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
};

// SHA-256 is kept local so the mechanics identity is usable without a Node
// runtime dependency or an asynchronous WebCrypto boundary.
const sha256 = (text: string): string => {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const initial = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const bytes = new TextEncoder().encode(text);
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const bitLength = bytes.length * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bitLength >>> 0);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 2 ** 32));
  const hash = [...initial];
  const rotate = (value: number, amount: number) => (value >>> amount) | (value << (32 - amount));
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words = new Array<number>(64).fill(0);
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index += 1) {
      const value = words[index - 15];
      const previous = words[index - 2];
      words[index] =
        (words[index - 16] +
          (rotate(value, 7) ^ rotate(value, 18) ^ (value >>> 3)) +
          words[index - 7] +
          (rotate(previous, 17) ^ rotate(previous, 19) ^ (previous >>> 10))) >>>
        0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const choice = (e & f) ^ (~e & g);
      const temporary1 =
        (h +
          (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) +
          choice +
          constants[index] +
          words[index]) >>>
        0;
      const temporary2 =
        ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      [h, g, f, e, d, c, b, a] = [
        g,
        f,
        e,
        (d + temporary1) >>> 0,
        c,
        b,
        a,
        (temporary1 + temporary2) >>> 0,
      ];
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }
  return hash.map((value) => value.toString(16).padStart(8, "0")).join("");
};

const contentHashFor = (input: CombatMechanicsViewInput): string => {
  const serialized = JSON.stringify(stableValue(canonicalContent(input)));
  return sha256(serialized);
};

const duplicateIds = (entries: readonly { readonly id: string }[]) => {
  const seen = new Set<string>();
  return entries.flatMap((entry) => (seen.has(entry.id) ? [entry.id] : (seen.add(entry.id), [])));
};

const validateInput = (input: CombatMechanicsViewInput): void => {
  if (
    typeof input !== "object" ||
    !Array.isArray(input.moves) ||
    !Array.isArray(input.items) ||
    !Array.isArray(input.transformations) ||
    !Array.isArray(input.races) ||
    !Array.isArray(input.genericClasses) ||
    typeof input.rules !== "object" ||
    typeof input.rulesVersion !== "object" ||
    typeof input.rulesVersion.value !== "string" ||
    typeof input.rulesVersion.sourcePath !== "string"
  )
    throw new TypeError("A combat mechanics view requires rules and all catalog collections.");
  const collections = [
    ["move", input.moves],
    ["item", input.items],
    ["transformation", input.transformations],
    ["race", input.races],
    ["generic class", input.genericClasses],
  ] as const;
  const duplicates = collections.flatMap(([label, entries]) =>
    duplicateIds(entries).map((id) => `${label}:${id}`),
  );
  if (duplicates.length > 0)
    throw new RangeError(`Duplicate mechanics IDs: ${duplicates.join(", ")}.`);

  const nestedIds = [
    ...input.races.flatMap((race: RaceDefinition) =>
      race.racialTraits.map((trait) => `race-trait:${trait.id}`),
    ),
    ...input.races.flatMap((race: RaceDefinition) =>
      race.classes.map((classDefinition) => `race-class:${classDefinition.id}`),
    ),
  ];
  const duplicateNestedIds = duplicateIds(nestedIds.map((id: string) => ({ id })));
  if (duplicateNestedIds.length > 0)
    throw new RangeError(`Duplicate mechanics IDs: ${duplicateNestedIds.join(", ")}.`);

  const transformationIds = new Set(input.transformations.map((entry) => entry.id));
  const raceIds = new Set(input.races.map((entry) => entry.id));
  const unresolved: string[] = [];
  input.races.forEach((race: RaceDefinition) => {
    race.transformationIds.forEach((id: string) => {
      if (!transformationIds.has(id)) unresolved.push(`race ${race.id} transformation ${id}`);
    });
  });
  input.transformations.forEach((transformation: TransformationDefinition) => {
    if (!raceIds.has(transformation.raceId))
      unresolved.push(`transformation ${transformation.id} race ${transformation.raceId}`);
  });
  if (unresolved.length > 0)
    throw new RangeError(`Invalid mechanics view: ${unresolved.join("; ")}.`);
};

const viewRegistry = new Map<string, CombatMechanicsView>();

export const createCombatMechanicsView = (input: CombatMechanicsViewInput): CombatMechanicsView => {
  validateInput(input);
  const moves = sortedById(input.moves).map((entry) => freezeDeep(structuredClone(entry)));
  const items = sortedById(input.items).map((entry) => freezeDeep(structuredClone(entry)));
  const transformations = sortedById(input.transformations).map((entry) =>
    freezeDeep(structuredClone(entry)),
  );
  const races = sortedById(input.races).map((entry) => freezeDeep(structuredClone(entry)));
  const genericClasses = sortedById(input.genericClasses).map((entry) =>
    freezeDeep(structuredClone(entry)),
  );
  const frozenInput = freezeDeep({
    rules: structuredClone(input.rules),
    rulesVersion: structuredClone(input.rulesVersion),
    moves,
    items,
    transformations,
    races,
    genericClasses,
  });
  const compiledEffectPlans = new Map<string, CompiledEffect>();
  for (const move of moves)
    move.effects?.forEach((effect, effectIndex) => {
      const result = compileEffectPlan({
        effect,
        sourceDefinitionId: move.id,
        effectIndex,
        origin: "move",
      });
      if (result.ok) compiledEffectPlans.set(`${move.id}:${effectIndex}`, result.value);
    });
  const compiledItemEffectPlans = new Map<string, CompiledItemEffect>();
  for (const item of items)
    item.effects?.forEach((_, effectIndex) => {
      const result = compileItemEffectPlan({ item, effectIndex });
      if (result.ok) compiledItemEffectPlans.set(`${item.id}:${effectIndex}`, result.value);
    });
  const identity: MechanicsViewIdentity = Object.freeze({
    schemaVersion: "combat-mechanics-view:v1",
    contentHash: contentHashFor(frozenInput),
  });
  const view = Object.freeze({
    ...frozenInput,
    version: frozenInput.rulesVersion.value,
    identity,
    indexes: Object.freeze({
      moves: new ImmutableMap(moves.map((entry) => [entry.id, entry] as const)),
      items: new ImmutableMap(items.map((entry) => [entry.id, entry] as const)),
      transformations: new ImmutableMap(transformations.map((entry) => [entry.id, entry] as const)),
      races: new ImmutableMap(races.map((entry) => [entry.id, entry] as const)),
      genericClasses: new ImmutableMap(genericClasses.map((entry) => [entry.id, entry] as const)),
      raceTraits: new ImmutableMap(
        races.flatMap((race) => race.racialTraits.map((entry) => [entry.id, entry] as const)),
      ),
      raceClasses: new ImmutableMap(
        races.flatMap((race) => race.classes.map((entry) => [entry.id, entry] as const)),
      ),
    }),
    compiledEffectPlans: new ImmutableMap(compiledEffectPlans),
    compiledItemEffectPlans: new ImmutableMap(compiledItemEffectPlans),
  });
  viewRegistry.set(identity.contentHash, view);
  return view;
};

export const CANONICAL_COMBAT_MECHANICS_VIEW = createCombatMechanicsView({
  rules: GLOBAL_RULES,
  rulesVersion: RULES_VERSION,
  moves: MOVE_DEFINITIONS,
  items: ITEM_DEFINITIONS,
  transformations: TRANSFORMATION_DEFINITIONS,
  races: RACE_DEFINITIONS,
  genericClasses: GENERIC_CLASS_DEFINITIONS,
});

export const mechanicsViewFor = (view: CombatMechanicsView | undefined): CombatMechanicsView =>
  view ?? CANONICAL_COMBAT_MECHANICS_VIEW;

export const mechanicsViewForState = (state: {
  readonly mechanicsView?: MechanicsViewIdentity;
}): CombatMechanicsView =>
  state.mechanicsView === undefined
    ? CANONICAL_COMBAT_MECHANICS_VIEW
    : (viewRegistry.get(state.mechanicsView.contentHash) ?? CANONICAL_COMBAT_MECHANICS_VIEW);

export const isCanonicalMechanicsViewIdentity = (
  identity: MechanicsViewIdentity | undefined,
): boolean =>
  identity === undefined ||
  (identity.schemaVersion === CANONICAL_COMBAT_MECHANICS_VIEW.identity.schemaVersion &&
    identity.contentHash === CANONICAL_COMBAT_MECHANICS_VIEW.identity.contentHash);

export const mechanicsViewMatchesState = (
  state: { readonly mechanicsView?: MechanicsViewIdentity },
  view: CombatMechanicsView = CANONICAL_COMBAT_MECHANICS_VIEW,
): boolean =>
  state.mechanicsView === undefined
    ? isCanonicalMechanicsViewIdentity(view.identity)
    : state.mechanicsView.schemaVersion === view.identity.schemaVersion &&
      state.mechanicsView.contentHash === view.identity.contentHash;
