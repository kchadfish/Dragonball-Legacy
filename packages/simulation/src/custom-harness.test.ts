import { describe, expect, it } from "vitest";

import { CANONICAL_COMBAT_MECHANICS_VIEW } from "@dragonball-resurgence/combat-engine";

import { executeCustomMoveHarness, SIMULATION_CUSTOM_DOSSIER_VERSION } from "./custom-harness.js";

const sourceMove = CANONICAL_COMBAT_MECHANICS_VIEW.moves.find(
  (move) => move.category === "advanced-attack" && move.styleId === "style-akaikaru",
)!;

const draft = {
  schemaVersion: "simulation-custom-draft:v1" as const,
  draftId: "custom-move-draft:harness-test",
  version: 1,
  move: { ...sourceMove, id: "move-custom-harness-test" },
  rationale: "Exercise the executable custom-move harness.",
  intendedContext: "deterministic one-pair validation",
  proposedSourceText: "synthetic focused test input",
};

describe("executable custom-move harness", () => {
  it("classifies malformed structured input without executing it", () => {
    const dossier = executeCustomMoveHarness({
      schemaVersion: "simulation-custom-draft:v1",
      draftId: "custom-move-draft:malformed-harness",
      version: 1,
      move: {},
      rationale: "missing definition",
      intendedContext: "test",
      proposedSourceText: "test",
    });

    expect(dossier.schemaVersion).toBe(SIMULATION_CUSTOM_DOSSIER_VERSION);
    expect(dossier.preflight.classification).toBe("malformed");
    expect(dossier.executedArms).toEqual([]);
    expect(dossier.conclusion).toBe("cannot-evaluate");
  });

  it("executes mirrored population-separated arms with generated builds and controls", () => {
    const dossier = executeCustomMoveHarness(draft, {
      pairCount: 1,
      maximumBuilds: 4,
      workers: 4,
      maximumTurns: 2,
      maximumTransitions: 4,
      semanticNoProgressLimit: 2,
      bootstrapResamples: 25,
    });

    expect(dossier.preflight.classification).toBe("executable");
    expect(dossier.generatedBuilds.length).toBeGreaterThanOrEqual(2);
    expect(dossier.buildGenerationManifest?.manifestHash).toBe(dossier.buildGenerationManifestHash);
    expect(dossier.executedArms).toEqual([
      "baseline",
      "addition",
      "replacement",
      "renamed-control",
      "stronger-control",
    ]);
    expect(dossier.populationEvidence).toHaveLength(5 * 3);
    expect(dossier.populationEvidence.every((entry) => entry.pairCount === 1)).toBe(true);
    expect(dossier.controlValidation).toEqual({
      renamedControlMechanicallyEquivalent: true,
      strongerControlMechanicallyDistinct: true,
      strongerControlAvailable: true,
    });
    expect(Object.keys(dossier.replaySeeds).length).toBe(5 * 3);
    expect(dossier.dossierHash).toMatch(/^fnv1a-32:/u);
  }, 120_000);
});
