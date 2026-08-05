import { describe, expect, it } from "vitest";

import {
  RULE_SECTION_DEFINITIONS,
  SAGA_DEFINITIONS,
  SAGA_SOURCE_DEFINITION,
} from "./saga-rule-definitions.js";
import { validateRuleSectionDefinitions, validateSagaDefinitions } from "./validation.js";

describe("saga and rule definitions", () => {
  it("preserves both sagas and the complete canonical saga source", () => {
    expect(SAGA_SOURCE_DEFINITION).toMatchObject({
      id: "saga-outline",
      source: { path: "reference/saga/saga1+2.md" },
    });
    expect(SAGA_SOURCE_DEFINITION.content).toBe(SAGA_SOURCE_DEFINITION.source.text);
    expect(SAGA_DEFINITIONS).toHaveLength(2);
    expect(SAGA_DEFINITIONS.map((saga) => saga.id)).toEqual([
      "saga-1-the-dragon-ball-hunt",
      "saga-2-the-broken-seal",
    ]);
    expect(SAGA_DEFINITIONS.every((saga) => saga.source.text.includes(saga.overview))).toBe(true);
    expect(SAGA_DEFINITIONS.flatMap((saga) => saga.sections)).toHaveLength(33);
    expect(
      SAGA_DEFINITIONS.flatMap((saga) => saga.sections).every((section) =>
        section.source.text.includes(section.content),
      ),
    ).toBe(true);
  });

  it("converts every numbered rule chapter with its source text", () => {
    expect(RULE_SECTION_DEFINITIONS).toHaveLength(12);
    expect(RULE_SECTION_DEFINITIONS.map((section) => section.number)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(RULE_SECTION_DEFINITIONS.map((section) => section.title)).toContain("Weekly Actions");
    expect(RULE_SECTION_DEFINITIONS.map((section) => section.title)).toContain(
      "Terrestrial Combat System",
    );
    expect(
      RULE_SECTION_DEFINITIONS.every(
        (section) =>
          section.source.path === "reference/rules.md" &&
          section.source.text.includes(section.content),
      ),
    ).toBe(true);
  });

  it("rejects invalid source-derived saga and rule data", () => {
    const saga = SAGA_DEFINITIONS[0];
    const rule = RULE_SECTION_DEFINITIONS[0];
    if (saga === undefined || rule === undefined)
      throw new Error("Expected generated source data.");

    expect(validateSagaDefinitions([{ ...saga, id: "saga invalid" }])).toContain(
      "Invalid saga ID: saga invalid",
    );
    expect(
      validateRuleSectionDefinitions([
        { ...rule, number: 0, source: { ...rule.source, path: "bad" } },
      ]),
    ).toEqual(
      expect.arrayContaining([
        `Invalid rule section number: ${rule.id}`,
        `Invalid rule section source path: ${rule.id}`,
      ]),
    );
  });
});
