import { describe, expect, it } from "vitest";

import { CANONICAL_COMBAT_MECHANICS_VIEW } from "@dragonball-resurgence/combat-engine";

import {
  createSyntheticArchetypes,
  resumeSimulationStatisticsCatalogV4,
  runSimulationStatisticsCatalogV4,
  validateSimulationStatisticsCatalogV4Closure,
  simulationV4SparseStatusFor,
  simulationV4TransferSourceFor,
  simulationV4StatArmTemplateFor,
  simulationV4ItemArmTemplateFor,
  simulationV4MoveRemovalArmTemplateFor,
  simulationV4ControlDefinitionIdsFor,
  materializeSimulationTemplate,
} from "./index.js";
import { SIMULATION_DEFAULT_LIMITS } from "./policy.js";

describe("v4 statistics catalog runner", () => {
  const templates = createSyntheticArchetypes(CANONICAL_COMBAT_MECHANICS_VIEW).slice(0, 2);

  it("classifies sparse continuation boundaries without overstating evidence", () => {
    expect(
      simulationV4SparseStatusFor({
        eligibilityDenominator: 29,
        executionDenominator: 9,
        achievedPairs: 399,
      }),
    ).toBe("pending");
    expect(
      simulationV4SparseStatusFor({
        eligibilityDenominator: 0,
        executionDenominator: 0,
        achievedPairs: 400,
      }),
    ).toBe("never-eligible");
    expect(
      simulationV4SparseStatusFor({
        eligibilityDenominator: 30,
        executionDenominator: 10,
        achievedPairs: 100,
      }),
    ).toBe("sufficient");
  });

  it("resumes only missing iterations and matches a one-shot artifact", () => {
    const oneShot = runSimulationStatisticsCatalogV4({ templates, targetPairs: 2, batchSize: 1 });
    const firstLook = runSimulationStatisticsCatalogV4({ templates, targetPairs: 1, batchSize: 1 });
    const resumed = resumeSimulationStatisticsCatalogV4(firstLook.checkpoint, {
      templates,
      targetPairs: 2,
      batchSize: 1,
    });
    expect(resumed.artifact.artifactHash).toBe(oneShot.artifact.artifactHash);
    expect(resumed.completedBasePairs).toBe(2);
    const workerRun = runSimulationStatisticsCatalogV4({
      templates,
      targetPairs: 2,
      batchSize: 2,
      workers: 2,
    });
    expect(workerRun.artifact.artifactHash).toBe(oneShot.artifact.artifactHash);
  }, 180_000);

  it("rejects a lowered target and reports incomplete closure explicitly", () => {
    const firstLook = runSimulationStatisticsCatalogV4({ templates, targetPairs: 1, batchSize: 1 });
    expect(() =>
      resumeSimulationStatisticsCatalogV4(firstLook.checkpoint, {
        templates,
        targetPairs: 0,
      }),
    ).toThrow(/between 1 and 400/);
    const issues = validateSimulationStatisticsCatalogV4Closure(
      firstLook.artifact,
      firstLook.checkpoint,
    );
    expect(issues.some((issue) => issue.includes("fewer than 100"))).toBe(true);
  }, 180_000);

  it("keeps controlled and diagnostic evidence in separately dimensioned artifacts", () => {
    const controlled = runSimulationStatisticsCatalogV4({
      templates,
      targetPairs: 1,
      batchSize: 1,
      schedule: "controlled",
    });
    const diagnostic = runSimulationStatisticsCatalogV4({
      templates,
      targetPairs: 1,
      batchSize: 1,
      schedule: "diagnostic",
    });
    expect(controlled.artifact.generatedFrom).toMatchObject({
      evidenceRole: "controlled",
      exposurePopulation: "isolation",
    });
    expect(diagnostic.artifact.generatedFrom).toMatchObject({
      evidenceRole: "diagnostic",
      exposurePopulation: "forced",
    });
    expect(
      Object.values(controlled.artifact.metrics).every(
        (metric) => metric.dimensions.evidenceRole === "controlled",
      ),
    ).toBe(true);
    expect(
      Object.values(controlled.artifact.metrics)
        .filter((metric) => metric.metricId === "simulation:fixed-total-sp-effect")
        .some((metric) => metric.pairedObservations.length > 0),
    ).toBe(true);
    expect(
      Object.values(diagnostic.artifact.metrics).every(
        (metric) => metric.dimensions.evidenceRole === "diagnostic",
      ),
    ).toBe(true);
  }, 60_000);

  it("uses fixed-total transfer ties in HP, Power, Dexterity order", () => {
    const template = {
      ...templates[0]!,
      specializationPointsDistribution: { hp: 2, power: 2, dexterity: 1, total: 5 },
    };
    expect(simulationV4TransferSourceFor(template, "dexterity")).toBe("hp");
    const variant = simulationV4StatArmTemplateFor(template, "dexterity");
    expect(variant.specializationPointsDistribution).toEqual({
      hp: 1,
      power: 2,
      dexterity: 2,
      total: 5,
    });
    expect(variant.maximumHitPoints).toBe(template.maximumHitPoints - 1);
    expect(variant.stats.dexterity).toBe(template.stats.dexterity + 1);
    const baselineInput = materializeSimulationTemplate(template);
    const variantInput = materializeSimulationTemplate(variant);
    expect(baselineInput.ok && variantInput.ok).toBe(true);
    if (baselineInput.ok && variantInput.ok)
      expect(variantInput.value.input).not.toEqual(baselineInput.value.input);
  });

  it("uses removal or replacement arms for item and move controls", () => {
    const source = {
      ...templates[0]!,
      itemIds: ["item-first", "item-second"],
      moveIds: ["move-first", "move-second"],
    };
    const itemArm = simulationV4ItemArmTemplateFor(source, "item-first", "item-third");
    expect(itemArm.replacementId).toBe("item-third");
    expect(itemArm.template.itemIds).toEqual(["item-second", "item-third"]);
    const moveArm = simulationV4MoveRemovalArmTemplateFor(source, "move-first");
    expect(moveArm.moveIds).toEqual(["move-second"]);
  });

  it("uses matched legal control targets for each controlled arm", () => {
    expect(
      simulationV4ControlDefinitionIdsFor({
        schedule: "controlled",
        branch: "baseline",
        itemTarget: "item-original",
      }),
    ).toEqual(["item-original"]);
    expect(
      simulationV4ControlDefinitionIdsFor({
        schedule: "controlled",
        branch: "variant",
        itemTarget: "item-original",
        replacementItemId: "item-replacement",
      }),
    ).toEqual(["item-replacement"]);
    expect(
      simulationV4ControlDefinitionIdsFor({
        schedule: "controlled",
        branch: "baseline",
        moveTarget: "move-removed",
      }),
    ).toEqual(["move-removed"]);
    expect(
      simulationV4ControlDefinitionIdsFor({
        schedule: "controlled",
        branch: "variant",
        moveTarget: "move-removed",
      }),
    ).toEqual(["basic-attack"]);
    expect(
      simulationV4ControlDefinitionIdsFor({
        schedule: "controlled",
        branch: "baseline",
        transformationTarget: "transformation-target",
      }),
    ).toEqual(["basic-attack"]);
    expect(
      simulationV4ControlDefinitionIdsFor({
        schedule: "controlled",
        branch: "variant",
        transformationTarget: "transformation-target",
      }),
    ).toEqual(["transformation-target"]);
  });

  it("allows long natural fights to finish before the simulation safeguard fires", () => {
    expect(SIMULATION_DEFAULT_LIMITS.maximumTurns).toBe(250);
  });
});
