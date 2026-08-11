import { describe, expect, it } from "vitest";

import {
  createCombatCapabilityMatrix,
  renderCombatCapabilityMatrix,
} from "./combat-capability-matrix.js";

describe("combat capability matrix", () => {
  it("accounts for every converted structured effect with an explicit status", () => {
    const matrix = createCombatCapabilityMatrix();
    expect(matrix.occurrences.length).toBeGreaterThan(0);
    expect(
      matrix.occurrences.every(
        (row) =>
          row.sourceDefinitionId.length > 0 &&
          row.effectType.length > 0 &&
          row.variant.length > 0 &&
          row.reason.length > 0 &&
          (row.status === "audited-out-of-scope"
            ? row.approvedExclusion !== null
            : row.status === "unsupported-in-scope"
              ? row.prerequisite !== null
              : row.executor !== null && row.focusedCoverage !== null),
      ),
    ).toBe(true);
  });

  it("renders stable, reviewable records", () => {
    const rendered = renderCombatCapabilityMatrix();
    expect(rendered).toContain("| move-afterlife-kaio-ken |");
    expect(rendered).toContain("modify-damage");
    expect(rendered).toContain("unsupported-in-scope");
    expect(rendered).toContain("audited-out-of-scope");
    expect(rendered).toContain("source-text-only abilities are not executable");
  });

  it("classifies successful-hit-count effects as generic executor coverage", () => {
    const matrix = createCombatCapabilityMatrix();
    const sourceIds = new Set([
      "move-afterlife-bakuretsu-ranma",
      "move-aoyosumu-tears-of-the-mystic",
      "move-haokiru-dragon-swipes",
    ]);
    const rows = matrix.occurrences.filter((row) => sourceIds.has(row.sourceDefinitionId));

    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.status === "supported-generic")).toBe(true);
    expect(
      rows.every(
        (row) => row.capabilityId === "modify-roll.v1" || row.capabilityId === "damage-modifier.v1",
      ),
    ).toBe(true);
  });
});
