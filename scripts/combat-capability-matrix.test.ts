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
    expect(rendered).toContain("cap=maximum:roll");
    expect(rendered).toContain("cap=maximum:total");
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

  it("classifies durable damage lifecycles as generic damage-modifier coverage", () => {
    const matrix = createCombatCapabilityMatrix();
    const sourceIds = new Set([
      "move-midorikatai-monster-mash",
      "move-midorikatai-ankle-buster",
      "move-midorikatai-one-two-punch",
      "move-freestyle-underdog-dropkick",
      "move-haokiru-soul-breaker",
      "move-aoyosumu-swift-neck-chop",
    ]);
    const rows = matrix.occurrences.filter(
      (row) => sourceIds.has(row.sourceDefinitionId) && row.effectType === "modify-damage",
    );
    const supportedRows = rows.filter((row) => row.status === "supported-generic");

    expect(supportedRows.length).toBeGreaterThanOrEqual(7);
    expect(
      supportedRows.every(
        (row) => row.capabilityId === "damage-modifier.v1" && row.executor === "damage-modifier",
      ),
    ).toBe(true);
  });

  it("classifies prior-action conditions as generic executor coverage", () => {
    const matrix = createCombatCapabilityMatrix();
    const sourceIds = new Set([
      "move-midorikatai-smackdown",
      "move-afterlife-final-revenger",
      "move-afterlife-masenko",
    ]);
    const rows = matrix.occurrences.filter(
      (row) =>
        sourceIds.has(row.sourceDefinitionId) && row.variant.includes("conditions=prior-action"),
    );

    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.status === "supported-generic")).toBe(true);
  });

  it("classifies action-sequence conditions as generic executor coverage", () => {
    const matrix = createCombatCapabilityMatrix();
    const sourceIds = new Set([
      "move-akaikaru-berserker-mastery",
      "move-aoyosumu-sky-dance-technique",
      "move-kurokonwaku-kick-them-when-they-re-down",
      "move-midorikatai-violence-party",
    ]);
    const rows = matrix.occurrences.filter(
      (row) =>
        sourceIds.has(row.sourceDefinitionId) && row.variant.includes("conditions=action-sequence"),
    );

    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.status === "supported-generic")).toBe(true);
  });

  it("classifies deterministic on-damage modifiers as generic coverage", () => {
    const matrix = createCombatCapabilityMatrix();
    const rows = matrix.occurrences.filter(
      (row) =>
        row.effectType === "modify-damage" &&
        row.variant.includes("trigger=on-damage") &&
        row.status === "supported-generic",
    );
    expect(rows.map((row) => row.sourceDefinitionId)).toEqual(["move-haokiru-advanced-behavior"]);
  });

  it("classifies resource-comparison conditions across cost, damage, and resource effects", () => {
    const matrix = createCombatCapabilityMatrix();
    const sourceIds = new Set([
      "move-haokiru-focused-spirit-cutter",
      "move-haokiru-dragon-effect",
      "move-kurokonwaku-tesla-coil",
    ]);
    const rows = matrix.occurrences.filter(
      (row) => sourceIds.has(row.sourceDefinitionId) && row.variant.includes("resource-comparison"),
    );

    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.status === "supported-generic")).toBe(true);
  });

  it("classifies durable move-effect conditions through the generic executors", () => {
    const matrix = createCombatCapabilityMatrix();
    const rows = matrix.occurrences.filter(
      (row) =>
        row.sourceDefinitionId === "move-afterlife-x20-kaioken-kamehameha" &&
        row.variant.includes("conditions=move-effect-active"),
    );

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === "supported-generic")).toBe(true);
    expect(rows.every((row) => row.capabilityId !== null && row.executor !== null)).toBe(true);
  });

  it("classifies resource-threshold triggers through the generic executors", () => {
    const matrix = createCombatCapabilityMatrix();
    const rows = matrix.occurrences.filter((row) =>
      row.variant.includes("trigger=on-resource-threshold"),
    );

    expect(rows).toHaveLength(7);
    expect(rows.every((row) => row.status === "supported-generic")).toBe(true);
    expect(rows.every((row) => row.executor !== null && row.focusedCoverage !== null)).toBe(true);
  });

  it("classifies Mass Genocide's per-die result dispatch through the generic executor", () => {
    const matrix = createCombatCapabilityMatrix();
    const rows = matrix.occurrences.filter(
      (row) =>
        row.sourceDefinitionId === "move-afterlife-mass-genocide-attack" &&
        row.trigger === "on-roll-result",
    );

    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.variant.includes("trigger=on-roll-result"))).toBe(true);
    expect(rows.every((row) => row.status === "supported-generic")).toBe(true);
    expect(rows.every((row) => row.executor === "roll-modifier")).toBe(true);
  });

  it("classifies explicit roll-cap scopes through the generic roll executor", () => {
    const matrix = createCombatCapabilityMatrix();
    const rows = matrix.occurrences.filter(
      (row) =>
        (row.sourceDefinitionId === "move-afterlife-vanishing-ball" ||
          row.sourceDefinitionId === "move-aoyosumu-slow-charge") &&
        row.effectType === "modify-roll",
    );

    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.status === "supported-generic")).toBe(true);
    expect(rows.every((row) => row.capabilityId === "modify-roll.v1")).toBe(true);
  });

  it("classifies active-move and moveset count variants through generic executors", () => {
    const matrix = createCombatCapabilityMatrix();
    const sourceIds = new Set([
      "move-afterlife-wolf-fang-fist",
      "move-akaikaru-accelerated-shoulder-tackle",
      "move-freestyle-heart-stab",
      "move-kiihakai-twisting-beam",
    ]);
    const rows = matrix.occurrences.filter((row) => sourceIds.has(row.sourceDefinitionId));

    expect(rows).toHaveLength(7);
    expect(rows.every((row) => row.status === "supported-generic")).toBe(true);
    expect(rows.every((row) => row.capabilityId !== null && row.executor !== null)).toBe(true);
  });

  it("classifies flat, scope-backed floating bundles through the lifecycle executor", () => {
    const matrix = createCombatCapabilityMatrix();
    const rows = matrix.occurrences.filter(
      (row) => row.effectType === "create-floating-effect" && row.status === "supported-generic",
    );

    expect(rows).toHaveLength(6);
    expect(rows.every((row) => row.capabilityId === "create-floating-effect.v1")).toBe(true);
    expect(rows.every((row) => row.executor === "floating-effect-lifecycle")).toBe(true);
  });

  it("classifies the exact same-turn extra-action slice through one scheduler", () => {
    const matrix = createCombatCapabilityMatrix();
    const rows = matrix.occurrences.filter((row) => row.effectType === "grant-extra-action");
    const supported = rows.filter((row) => row.status === "supported-generic");
    const unsupported = rows.filter((row) => row.status === "unsupported-in-scope");

    expect(rows).toHaveLength(19);
    expect(supported).toHaveLength(7);
    expect(unsupported).toHaveLength(12);
    expect(
      supported.every(
        (row) =>
          row.capabilityId === "grant-extra-action.v1" &&
          row.executor === "extra-action-scheduler" &&
          row.focusedCoverage === "progress-fight.test.ts",
      ),
    ).toBe(true);
    expect(unsupported.every((row) => row.prerequisite !== null)).toBe(true);
  });
});
