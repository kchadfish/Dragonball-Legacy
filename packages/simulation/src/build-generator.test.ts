import { describe, expect, it } from "vitest";

import { CANONICAL_COMBAT_MECHANICS_VIEW } from "@dragonball-resurgence/combat-engine";

import {
  generateSimulationBuilds,
  SIMULATION_BUILD_GENERATOR_VERSION,
  type SimulationBuildGeneratorInput,
} from "./build-generator.js";
import { materializeSimulationTemplate } from "./templates.js";

const request: SimulationBuildGeneratorInput = {
  maximumBuilds: 6,
  checkpointIds: ["early", "tf1"],
  styleIds: ["style-akaikaru", "style-freestyle"],
  archetypes: ["balanced", "high-power", "transformation"],
  scenarioRoles: ["baseline", "transformation-timing"],
};

describe("deterministic simulation build generation", () => {
  it("generates repeatable synthetic builds outside the TF1 anchors", () => {
    const first = generateSimulationBuilds(
      { ...request, seed: 17 },
      CANONICAL_COMBAT_MECHANICS_VIEW,
    );
    const second = generateSimulationBuilds(
      { ...request, seed: 17 },
      CANONICAL_COMBAT_MECHANICS_VIEW,
    );

    expect(first.manifest).toEqual(second.manifest);
    expect(first.builds).toEqual(second.builds);
    expect(first.manifest.schemaVersion).toBe(SIMULATION_BUILD_GENERATOR_VERSION);
    expect(first.builds.length).toBeGreaterThan(0);
    expect(first.builds.every((build) => build.kind === "synthetic")).toBe(true);
    expect(
      first.builds.every(
        (build) =>
          !build.id.startsWith("simulation-template:tf1-") &&
          build.source.sourceKind === "synthetic",
      ),
    ).toBe(true);
    expect(first.manifest.source.mechanicsIdentity).toBe(
      CANONICAL_COMBAT_MECHANICS_VIEW.identity.contentHash,
    );
  });

  it("validates generated builds through the normal template boundary", () => {
    const result = generateSimulationBuilds(
      {
        ...request,
        maximumBuilds: 10,
        seed: 29,
      },
      CANONICAL_COMBAT_MECHANICS_VIEW,
    );

    expect(result.manifest.acceptedCount).toBe(result.builds.length);
    for (const build of result.builds) {
      const materialized = materializeSimulationTemplate(build, CANONICAL_COMBAT_MECHANICS_VIEW);
      expect(materialized.ok).toBe(true);
      if (!materialized.ok) continue;
      const race = CANONICAL_COMBAT_MECHANICS_VIEW.indexes.races.get(build.raceId);
      expect(race?.classes.some((entry) => entry.id === build.classId)).toBe(true);
      expect(
        build.moveIds.every((moveId) => {
          const move = CANONICAL_COMBAT_MECHANICS_VIEW.indexes.moves.get(moveId);
          return (move?.styleId ?? "style-freestyle") === build.styleId;
        }),
      ).toBe(true);
    }
  });

  it("changes the deterministic sample when the injected seed changes", () => {
    const first = generateSimulationBuilds(
      { ...request, maximumBuilds: 4, seed: 31 },
      CANONICAL_COMBAT_MECHANICS_VIEW,
    );
    const second = generateSimulationBuilds(
      { ...request, maximumBuilds: 4, seed: 32 },
      CANONICAL_COMBAT_MECHANICS_VIEW,
    );

    expect(first.manifest.manifestHash).not.toBe(second.manifest.manifestHash);
  });

  it("changes generated builds when the requested archetype changes", () => {
    const balanced = generateSimulationBuilds(
      { ...request, maximumBuilds: 4, seed: 37, archetypes: ["balanced"] },
      CANONICAL_COMBAT_MECHANICS_VIEW,
    );
    const defensive = generateSimulationBuilds(
      { ...request, maximumBuilds: 4, seed: 37, archetypes: ["defensive"] },
      CANONICAL_COMBAT_MECHANICS_VIEW,
    );

    expect(balanced.manifest.manifestHash).not.toBe(defensive.manifest.manifestHash);
    expect(balanced.builds.map((build) => build.id)).not.toEqual(
      defensive.builds.map((build) => build.id),
    );
  });

  it("rejects unknown requested styles instead of emitting unverifiable builds", () => {
    expect(() =>
      generateSimulationBuilds(
        { ...request, styleIds: ["style-does-not-exist"] },
        CANONICAL_COMBAT_MECHANICS_VIEW,
      ),
    ).toThrow("Unknown generated-build style IDs");
  });
});
