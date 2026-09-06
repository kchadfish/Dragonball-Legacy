import { describe, expect, it } from "vitest";

import { CANONICAL_COMBAT_MECHANICS_VIEW } from "@dragonball-resurgence/combat-engine";

import {
  SIMULATION_COVERAGE_PRECISION_LOOKS,
  SIMULATION_NATURAL_COVERAGE_DEFAULT_TARGET_PAIRS,
  SIMULATION_PRECISION_LOOKS,
  createSimulationCompletionAudit,
  createSimulationCoverageCell,
  createSimulationCoverageMatrix,
  createSimulationMoveBalanceReport,
  createSimulationMoveCoverageArtifact,
  createSimulationMoveCoverageDataset,
  simulationNaturalCoverageMinimumEligibleStatesFor,
  simulationReportEvidenceLevelFor,
  nextSimulationCoveragePrecisionLook,
  createSimulationNaturalCoverageRequests,
  runSimulationMoveCoverage,
  updateSimulationCoverageCell,
  updateSimulationMoveCoverage,
  validateSimulationProductionClosure,
} from "./index.js";

describe("progressive catalog precision looks", () => {
  it("declares every look and derives the evidence-level boundaries", () => {
    const expected = [50, 100, 250, 500, 1_000, 2_000, 5_000, 10_000];
    expect(SIMULATION_PRECISION_LOOKS).toEqual(expected);
    expect(SIMULATION_COVERAGE_PRECISION_LOOKS).toEqual(expected);
    expect(nextSimulationCoveragePrecisionLook(50)).toBe(100);
    expect(nextSimulationCoveragePrecisionLook(100)).toBe(250);
    expect(nextSimulationCoveragePrecisionLook(250)).toBe(500);
    expect(simulationReportEvidenceLevelFor(0)).toBe("pilot");
    expect(simulationReportEvidenceLevelFor(49)).toBe("pilot");
    expect(simulationReportEvidenceLevelFor(50)).toBe("screening");
    expect(simulationReportEvidenceLevelFor(99)).toBe("screening");
    expect(simulationReportEvidenceLevelFor(100)).toBe("confirmation");
    expect(simulationReportEvidenceLevelFor(249)).toBe("confirmation");
    expect(simulationReportEvidenceLevelFor(250)).toBe("production-candidate");
  });

  it("uses Natural defaults and caps later eligibility at the production requirement", () => {
    expect(SIMULATION_NATURAL_COVERAGE_DEFAULT_TARGET_PAIRS).toBe(50);
    expect(simulationNaturalCoverageMinimumEligibleStatesFor(50)).toBe(50);
    expect(simulationNaturalCoverageMinimumEligibleStatesFor(100)).toBe(100);
    expect(simulationNaturalCoverageMinimumEligibleStatesFor(250)).toBe(250);
    expect(simulationNaturalCoverageMinimumEligibleStatesFor(10_000)).toBe(250);
  });

  it("extends the deterministic Natural schedule without replaying prior run IDs", () => {
    const requestsAt = (targetPairs: number) =>
      createSimulationNaturalCoverageRequests({
        targetPairs,
        moveIds: ["move-akaikaru-firestorm"],
        fightLimit: targetPairs * 2,
      });
    const at50 = requestsAt(50);
    const at100 = requestsAt(100);
    const at250 = requestsAt(250);
    const idsAt = (requests: readonly { readonly runId: string }[]) =>
      requests.map((request) => request.runId);

    expect(at50).toHaveLength(100);
    expect(at100).toHaveLength(200);
    expect(at250).toHaveLength(500);
    expect(idsAt(at100).slice(0, at50.length)).toEqual(idsAt(at50));
    expect(idsAt(at250).slice(0, at100.length)).toEqual(idsAt(at100));
    expect(new Set(idsAt(at100).slice(at50.length)).size).toBe(100);
    expect(new Set(idsAt(at250).slice(at100.length)).size).toBe(300);
  }, 120_000);

  it("continues an incomplete look with fresh mirrored replacement pairs", () => {
    const options = {
      moveIds: ["move-akaikaru-firestorm"],
      population: "natural" as const,
      targetPairs: 1,
      minimumEligibleStates: 1,
      concurrency: 1,
      limits: { maximumTurns: 1, maximumTransitions: 8, semanticNoProgressLimit: 4 },
    };
    const initial = runSimulationMoveCoverage(options);
    const initialAttempts =
      initial.artifact.generatedFrom.populationAttemptedFightsByMoveAndContext?.natural[
        "move-akaikaru-firestorm"
      ]?.["target-present"];
    const initialErrorRunIds = new Set(initial.artifact.errors.map((error) => error.runId));
    const resumed = runSimulationMoveCoverage({
      ...options,
      retryFailed: true,
      resumeFrom: initial.artifact,
    });
    const resumedAttempts =
      resumed.artifact.generatedFrom.populationAttemptedFightsByMoveAndContext?.natural[
        "move-akaikaru-firestorm"
      ]?.["target-present"];

    expect(initialAttempts).toBe(2);
    expect(resumed.artifact.generatedFrom.targetPairs).toBe(1);
    expect(resumedAttempts).toBe(4);
    expect(resumed.artifact.errors.length).toBeGreaterThan(0);
    expect(resumed.artifact.errors.every((error) => !initialErrorRunIds.has(error.runId))).toBe(
      true,
    );
  }, 60_000);

  it("accepts a complete screening look while production closure rejects it explicitly", () => {
    const dataset = createSimulationMoveCoverageDataset();
    const records = dataset.records.map((record) =>
      updateSimulationMoveCoverage(record, record.funnel, {
        naturalStatus: "observed-sufficient",
      }),
    );
    const screeningDataset = createSimulationMoveCoverageDataset(
      CANONICAL_COMBAT_MECHANICS_VIEW,
      records,
    );
    const cells = createSimulationCoverageMatrix(screeningDataset, ["move-isolation"], "early", {
      targetPairs: 50,
      minimumEligibleStates: 50,
      populations: ["natural"],
      mechanicPaths: ["decision", "trigger"],
    }).map((cell) =>
      updateSimulationCoverageCell(cell, {
        completedFights: 100,
        eligibleStates: 50,
        selectedStates: cell.mechanicPath === "decision" ? 50 : 0,
        triggeredStates: cell.mechanicPath === "trigger" ? 50 : 0,
      }),
    );

    const screening = createSimulationCompletionAudit(screeningDataset, cells, {
      purpose: "screening",
      populations: ["natural"],
    });
    expect(screening.complete).toBe(true);

    const productionIssues = validateSimulationProductionClosure(cells);
    expect(productionIssues).toEqual(
      expect.arrayContaining([
        expect.stringContaining("at least 250 completed pairs"),
        expect.stringContaining("configured precision look of at least 250 pairs"),
      ]),
    );
    const production = createSimulationCompletionAudit(screeningDataset, cells, {
      purpose: "production",
      populations: ["natural"],
    });
    expect(production.complete).toBe(false);
    expect(production.issues.join("\n")).toMatch(/at least 250 completed pairs/);
  });

  it("derives report evidence from observed pairs and labels non-production evidence", () => {
    const dataset = createSimulationMoveCoverageDataset();
    const artifactFor = (targetPairs: number) =>
      createSimulationMoveCoverageArtifact({
        generatedFrom: {
          mechanicsIdentity: dataset.mechanicsIdentity,
          scenarioFamily: "move-isolation",
          checkpointId: "early",
          targetPairs,
          minimumEligibleStates: Math.min(targetPairs, 250),
          isolationRunCount: 1,
          naturalPopulation: "approved",
          source: "test:progressive-precision",
        },
        dataset,
        coverageCells: [],
      });
    const screening = createSimulationMoveBalanceReport(dataset, undefined, {
      generatedFrom: artifactFor(50).generatedFrom,
    });
    expect(screening.evidenceLevel).toBe("screening");
    expect(screening.evidenceLevel).not.toBe("production-ready");
  }, 30_000);

  it("does not let an unresolved failure pass production closure", () => {
    const cell = createSimulationCoverageCell({
      cellId: "simulation-cell:production-failure",
      moveId: "move-akaikaru-firestorm",
      scenarioFamily: "move-isolation",
      mechanicPath: "decision",
      checkpointId: "early",
      population: "natural",
      strata: { exposureContext: "target-present" },
      targetPairs: 250,
      minimumEligibleStates: 250,
      completedFights: 0,
      eligibleStates: 0,
      selectedStates: 0,
      triggeredStates: 0,
      status: "unobserved",
    });
    const issues = validateSimulationProductionClosure(
      [
        createSimulationCoverageCell({
          ...cell,
          samplingStatus: "failed",
          observationStatus: "observed",
          failureType: "runner-failure",
        }),
      ],
      [{ type: "combat-failure" }],
    );
    expect(issues.join("\n")).toMatch(/zero unresolved failures/);
  });
});
