/**
 * Canonical JSON is deliberately small and platform-neutral. It is used for
 * identities, not as a persistence serializer for arbitrary user input.
 */
export const canonicalJson = (value: unknown): string => {
  const normalize = (entry: unknown): unknown => {
    if (entry === undefined) return undefined;
    if (typeof entry === "number" && !Number.isFinite(entry))
      throw new TypeError("Canonical JSON cannot contain a non-finite number.");
    if (typeof entry === "bigint" || typeof entry === "function" || typeof entry === "symbol")
      throw new TypeError("Canonical JSON supports JSON-compatible values only.");
    if (Array.isArray(entry)) return entry.map((item) => normalize(item) ?? null);
    if (entry !== null && typeof entry === "object") {
      return Object.fromEntries(
        Object.entries(entry as Readonly<Record<string, unknown>>)
          .sort(([left], [right]) => left.localeCompare(right))
          .flatMap(([key, item]) => {
            const normalized = normalize(item);
            return normalized === undefined ? [] : [[key, normalized]];
          }),
      );
    }
    return entry;
  };

  return JSON.stringify(normalize(value));
};

/** Stable, non-cryptographic content identity for deterministic report keys. */
export const canonicalHash = (value: unknown): string => {
  const serialized = canonicalJson(value);
  let hash = 2_166_136_261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return `fnv1a-32:${hash.toString(16).padStart(8, "0")}`;
};
