import { describe, expect, it } from "vitest";

import { GAME_DATA_DOCUMENTS } from "./reference-documents.js";
import { validateGameDataDocuments } from "./validation.js";

describe("game-data reference catalog", () => {
  it("preserves every reference document in a valid static catalog", () => {
    expect(GAME_DATA_DOCUMENTS).toHaveLength(104);
    expect(validateGameDataDocuments(GAME_DATA_DOCUMENTS)).toEqual([]);
  });

  it("classifies the primary game-data source categories", () => {
    const kinds = new Set(GAME_DATA_DOCUMENTS.map((document) => document.kind));

    expect(kinds).toEqual(
      new Set([
        "rules",
        "moves",
        "items",
        "race",
        "transformations",
        "quest",
        "location",
        "trainers",
        "reference",
      ]),
    );
  });

  it("uses the canonical Transformation Ability terminology", () => {
    const legacyDocuments = GAME_DATA_DOCUMENTS.filter((document) =>
      /\bspecial traits?\b/iu.test(document.content),
    );

    expect(legacyDocuments).toEqual([]);
    expect(
      GAME_DATA_DOCUMENTS.some((document) =>
        document.content.includes("Transformation Abilities:"),
      ),
    ).toBe(true);
  });
});
