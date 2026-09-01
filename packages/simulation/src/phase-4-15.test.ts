import { describe, expect, it } from "vitest";

import { CANONICAL_COMBAT_MECHANICS_VIEW } from "@dragonball-resurgence/combat-engine";
import type { CombatantId } from "@dragonball-resurgence/combat-engine";
import { SIMULATION_QUALITY_PROFILE } from "@dragonball-resurgence/ai-engine";

import {
  adjustSimulationPValues,
  analyzeSimulationSequences,
  compareHumanPolicyDistributions,
  createHumanObservationDataset,
  createSimulationComparableCohort,
  createSimulationCoverageCell,
  createSimulationCoverageMatrix,
  createSyntheticArchetypes,
  estimateSimulationBudget,
  createSimulationMoveBalanceReport,
  createSimulationMoveCoverageDataset,
  createSimulationMoveCoverageArtifact,
  createSimulationCompletionAudit,
  normalizeSimulationSequence,
  createSimulationPerformanceProfile,
  compareSimulationPerformanceProfiles,
  renderSimulationReportCsv,
  renderSimulationReportJson,
  renderSimulationReportMarkdown,
  mergeSimulationCoverageCells,
  updateSimulationCoverageCell,
  validateSimulationCoverageCells,
  validateSimulationMoveClosure,
  validateSimulationMoveCoverageArtifact,
  excludeSimulationMoveCoverage,
} from "./index.js";

describe("simulation Phase 4 through 15 foundations", () => {
  it("normalizes authoritative actions and analyzes sequence support", () => {
    const sequences = [
      normalizeSimulationSequence(
        [
          { type: "pass", actorId: "a" as CombatantId },
          { type: "pass", actorId: "b" as CombatantId },
        ],
        [],
        "fight:a",
        "win",
      ),
      normalizeSimulationSequence(
        [{ type: "pass", actorId: "a" as CombatantId }],
        [],
        "fight:b",
        "loss",
      ),
    ];
    const edges = analyzeSimulationSequences(sequences);
    expect(edges).toEqual([
      expect.objectContaining({ pattern: ["pass", "pass"], sequenceCount: 1, support: 0.5 }),
    ]);
  });

  it("keeps human calibration data anonymized and separate from policy evidence", () => {
    const dataset = createHumanObservationDataset("human-fixture", "calibration", "rules:v1", [
      {
        observationId: "observation:b",
        anonymizedParticipantId: "participant:2",
        rulesVersion: "rules:v1",
        checkpointId: "early",
        selectedAction: "pass",
        missingness: "none",
        skillUncertainty: "unknown",
        selectionBias: ["synthetic-fixture"],
        consent: "synthetic-fixture",
      },
      {
        observationId: "observation:a",
        anonymizedParticipantId: "participant:1",
        rulesVersion: "rules:v1",
        checkpointId: "early",
        selectedAction: "power-up",
        missingness: "none",
        skillUncertainty: "unknown",
        selectionBias: ["synthetic-fixture"],
        consent: "synthetic-fixture",
      },
    ]);
    const comparison = compareHumanPolicyDistributions(dataset, "profile:test:v1", [
      "pass",
      "pass",
    ]);
    expect(comparison.externalEvidence).toBe("absent");
    expect(comparison.sampleCount).toBe(2);
    expect(comparison.totalVariationDistance).toBe(0.5);
  });

  it("renders deterministic move reports and exploratory statistics", () => {
    const report = createSimulationMoveBalanceReport(createSimulationMoveCoverageDataset());
    expect(renderSimulationReportJson(report)).toContain(report.freshnessHash);
    expect(renderSimulationReportCsv(report).split("\n")[0]).toContain("moveId");
    expect(renderSimulationReportMarkdown(report)).toContain("Simulation move balance matrix");
    expect(adjustSimulationPValues([{ identity: "p", pValue: 0.01 }])[0]).toMatchObject({
      adjustedPValue: 0.01,
      exploratoryFlag: true,
    });
  });

  it("tracks coverage strata, comparable cohorts, and bounded budget estimates", () => {
    const move = CANONICAL_COMBAT_MECHANICS_VIEW.moves[0]!;
    const cell = createSimulationCoverageCell({
      cellId: "simulation-cell:test",
      moveId: move.id,
      scenarioFamily: "move-isolation",
      checkpointId: "early",
      population: "isolation",
      strata: { side: "original" },
      targetFights: 10,
      minimumEligibleStates: 10,
      completedFights: 0,
      eligibleStates: 0,
      status: "unobserved",
    });
    const sufficient = updateSimulationCoverageCell(cell, {
      completedFights: 10,
      eligibleStates: 10,
      selectedStates: 10,
    });
    expect(sufficient.status).toBe("observed-sufficient");
    expect(validateSimulationCoverageCells([sufficient])).toEqual([]);
    const half = updateSimulationCoverageCell(cell, {
      completedFights: 5,
      eligibleStates: 5,
      selectedStates: 5,
    });
    expect(mergeSimulationCoverageCells(half, half).status).toBe("observed-sufficient");
    expect(
      createSimulationCoverageMatrix(
        createSimulationMoveCoverageDataset(),
        ["move-isolation"],
        "early",
      ),
    ).toHaveLength(createSimulationMoveCoverageDataset().records.length * 2);
    const cohort = createSimulationComparableCohort(
      CANONICAL_COMBAT_MECHANICS_VIEW,
      move.id,
      {
        category: move.category,
        timing: "action",
        scope: "single-target",
        acquisition: "catalog",
        resourceModel: "ki",
        role: "damage",
        effects: [],
        usageContext: "synthetic-control",
      },
      { memberMoveIds: [move.id], rationale: "Pinned fixture cohort" },
    );
    expect(cohort.source).toBe("staff-override");
    const template = createSyntheticArchetypes()[0];
    const estimate = estimateSimulationBudget(
      {
        schemaVersion: "simulation-contracts:v1",
        seriesId: "simulation-series:budget",
        baseRequest: {
          schemaVersion: "simulation-contracts:v1",
          runId: "simulation-run:budget",
          scenario: {
            schemaVersion: "simulation-contracts:v1",
            id: "simulation-scenario:budget",
            family: "symmetric-control",
            checkpointId: "early",
            templateAId: template.id,
            templateBId: template.id,
            variantId: "simulation-variant:baseline",
            retention: "summary",
            limits: { maximumTurns: 1, maximumTransitions: 10, semanticNoProgressLimit: 1 },
            stoppingPolicy: "continue",
            deferred: false,
          },
          templateA: template,
          templateB: template,
          profileA: SIMULATION_QUALITY_PROFILE,
          profileB: SIMULATION_QUALITY_PROFILE,
          rootSeed: 1,
          fixedTime: new Date("2026-01-01T00:00:00.000Z"),
          mechanicsView: CANONICAL_COMBAT_MECHANICS_VIEW,
        },
        iterations: 2,
        mirrored: true,
        stoppingPolicy: "continue",
      },
      {
        maximumFights: 4,
        maximumTransitions: 40,
        maximumDiagnosticTransitions: 40,
        maximumOutputBytes: 10000,
      },
    );
    expect(estimate.withinBudget).toBe(true);
  });

  it("profiles pipeline stages without putting timing into logical simulation hashes", () => {
    const baseline = createSimulationPerformanceProfile([{ stage: "combat", units: 10 }]);
    const candidate = createSimulationPerformanceProfile([{ stage: "combat", units: 12 }]);
    const drift = compareSimulationPerformanceProfiles(baseline, candidate, 0.1);
    expect(drift.find((entry) => entry.stage === "combat")).toMatchObject({ finding: "drift" });
    expect(baseline.profileHash).not.toBe(candidate.profileHash);
  });

  it("requires sufficient move and cell evidence for completion", () => {
    const dataset = createSimulationMoveCoverageDataset();
    const first = dataset.records[0]!;
    const observed = {
      ...first,
      isolationStatus: "observed" as const,
    };
    expect(
      validateSimulationMoveClosure({
        ...dataset,
        records: [observed, ...dataset.records.slice(1)],
      }),
    ).toContain(`Move lacks sufficient isolation coverage or reviewed exclusion: ${first.moveId}`);
    const artifact = createSimulationMoveCoverageArtifact({
      generatedFrom: {
        mechanicsIdentity: dataset.mechanicsIdentity,
        scenarioFamily: "move-isolation",
        checkpointId: "early",
        targetFights: 10,
        minimumEligibleStates: 10,
        isolationRunCount: 10,
        naturalPopulation: "reviewed-exclusion",
        source: "test",
      },
      dataset,
      coverageCells: [],
    });
    expect(validateSimulationMoveCoverageArtifact(artifact)).toEqual([]);
    const audit = createSimulationCompletionAudit(dataset, []);
    expect(audit.complete).toBe(false);
    expect(
      excludeSimulationMoveCoverage(first, "natural", "Reviewed test exclusion.").naturalStatus,
    ).toBe("excluded");
  });
});
