import { describe, expect, it } from "vitest";

import { MOVE_SOURCE_DEFINITIONS, UNRESOLVED_MOVE_SOURCES } from "./move-source-definitions.js";

describe("move source definitions", () => {
  it("creates stable definitions only for complete move sources", () => {
    expect(MOVE_SOURCE_DEFINITIONS).toHaveLength(499);
    expect(new Set(MOVE_SOURCE_DEFINITIONS.map((move) => move.id))).toHaveLength(
      MOVE_SOURCE_DEFINITIONS.length,
    );
    expect(MOVE_SOURCE_DEFINITIONS.every((move) => move.id.startsWith("move-"))).toBe(true);
  });

  it("keeps incomplete move entries out of the generated move catalog", () => {
    expect(UNRESOLVED_MOVE_SOURCES).toHaveLength(0);
    expect(UNRESOLVED_MOVE_SOURCES.every((move) => move.reason.length > 0)).toBe(true);
  });
});
