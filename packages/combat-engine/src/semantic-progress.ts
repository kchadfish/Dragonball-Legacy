import type { FightState } from "./contracts.js";

export interface CombatSemanticProgressIdentity {
  readonly schemaVersion: "combat-semantic-progress:v1";
  readonly hash: string;
  readonly canonicalState: string;
}

const generatedIdPrefixes = [
  "fight:",
  "decision:",
  "event:",
  "pending-decision:",
  "active-effect:",
  "resolution-frame:",
  "scheduled-work:",
] as const;

const canonicalize = (value: unknown, generatedIds: Map<string, string>): unknown => {
  if (typeof value === "string") {
    const prefix = generatedIdPrefixes.find((candidate) => value.startsWith(candidate));
    if (prefix === undefined) return value;
    const existing = generatedIds.get(value);
    if (existing !== undefined) return existing;
    const normalized = `${prefix}semantic-${generatedIds.size + 1}`;
    generatedIds.set(value, normalized);
    return normalized;
  }
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry, generatedIds));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Readonly<Record<string, unknown>>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry, generatedIds)]),
  );
};

const hashCanonicalState = (value: string): string => {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

/**
 * Produces combat-semantic identity without transition bookkeeping or opaque
 * generated-ID values. Exact snapshots and replay hashes remain separate.
 */
export const createCombatSemanticProgressIdentity = (
  state: Readonly<FightState>,
): CombatSemanticProgressIdentity => {
  const semanticState: Record<string, unknown> = { ...state };
  Reflect.deleteProperty(semanticState, "id");
  Reflect.deleteProperty(semanticState, "version");
  Reflect.deleteProperty(semanticState, "eventSequence");
  const canonicalState = JSON.stringify(canonicalize(semanticState, new Map()));
  return {
    schemaVersion: "combat-semantic-progress:v1",
    hash: hashCanonicalState(canonicalState),
    canonicalState,
  };
};

export const hasSameCombatSemanticProgress = (
  left: Readonly<FightState>,
  right: Readonly<FightState>,
): boolean => {
  const leftIdentity = createCombatSemanticProgressIdentity(left);
  const rightIdentity = createCombatSemanticProgressIdentity(right);
  return (
    leftIdentity.hash === rightIdentity.hash &&
    leftIdentity.canonicalState === rightIdentity.canonicalState
  );
};
