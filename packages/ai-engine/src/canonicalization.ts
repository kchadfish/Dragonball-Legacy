const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stable(entry)]),
    );
  return value;
};

export const canonicalJson = (value: unknown): string => JSON.stringify(stable(value));

/** Stable, version-independent FNV-1a hash used for replay identity. */
export const canonicalHash = (value: unknown): string => {
  const input = canonicalJson(value);
  let hash = 2_166_136_261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

export const canonicalLegalSetHash = (decisions: readonly unknown[]): string =>
  canonicalHash(
    [...decisions].sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))),
  );
