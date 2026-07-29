import { describe, expect, it } from "vitest";

import { validateReferenceMarkdown } from "./reference-markdown-validation.js";

describe("reference Markdown validation", () => {
  it("accepts canonical terminology and fields", () => {
    expect(
      validateReferenceMarkdown(
        "Aoyosumu\nRequirements: None\nDescription: Text\nLocation: Earth\nDexterity: 5",
      ),
    ).toEqual([]);
  });

  it("reports deprecated terminology and incomplete requirement fields", () => {
    expect(
      validateReferenceMarkdown("Aoyusumu\nRequirement(s): N/A\nRequirements:\nDexerity: 5"),
    ).toEqual([
      { message: "Use the canonical Aoyosumu style spelling.", line: 1 },
      {
        message: "Use `Requirements:` as the canonical requirements field.",
        line: 2,
      },
      {
        message: "Use `Requirements: None` instead of a blank requirements field.",
        line: 3,
      },
      { message: "Use `Dexterity:` as the canonical stat field.", line: 4 },
    ]);
  });

  it("rejects BBCode move-entry markers", () => {
    expect(
      validateReferenceMarkdown("[*] Move [FREESTYLE, SKILL]", {
        isMoveDocument: true,
      }),
    ).toEqual([
      {
        message: "Use Markdown move headings instead of BBCode list-entry markers.",
        line: 1,
      },
    ]);
  });
});
