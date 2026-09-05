import { describe, expect, it } from "vitest";

import { CANONICAL_COMBAT_MECHANICS_VIEW } from "@dragonball-resurgence/combat-engine";
import { SIMULATION_QUALITY_PROFILE } from "@dragonball-resurgence/ai-engine";

import {
  aggregateSimulationCoverageCellStatus,
  createSimulationCompletionAudit,
  createSimulationCoverageCell,
  createSimulationMoveCoverageArtifact,
  createSimulationMoveCoverageDataset,
  createSimulationMoveMetrics,
  createSimulationNaturalCoverageTemplates,
  createSyntheticArchetypes,
  createScenario,
  mergeSimulationMoveMetrics,
  runSimulationMoveCoverage,
  runSimulationFight,
  runSimulationCoverageBenchmark,
  simulationMoveCoverageArtifactSchema,
  updateSimulationCoverageCell,
  validateSimulationCoverageCells,
  validateSimulationMoveClosure,
} from "./index.js";

describe("simulation catalog v3 contracts", () => {
  it("passes the fixed two-move all-population Normal coverage benchmark", () => {
    const started = Date.now();
    const result = runSimulationCoverageBenchmark();
    expect(result).toMatchObject({
      benchmarkId: "catalog-v3",
      workerCount: 4,
      moveIds: ["move-akaikaru-delta-storm", "move-akaikaru-stampede-rush"],
      populations: ["natural", "isolation", "forced"],
      requestCount: 12,
      failureCount: 0,
      result: "passed",
    });
    expect(result.outputBytes).toBeLessThan(64 * 1024);
    expect(Date.now() - started).toBeLessThan(60_000);
  }, 60_000);

  it("rejects v1 and v2 artifacts instead of migrating them", () => {
    expect(
      simulationMoveCoverageArtifactSchema.safeParse({
        schemaVersion: "simulation-move-coverage-artifact:v1",
      }).success,
    ).toBe(false);
    expect(
      simulationMoveCoverageArtifactSchema.safeParse({
        schemaVersion: "simulation-move-coverage-artifact:v2",
      }).success,
    ).toBe(false);
  });

  it("serializes target pairs and separates sampling from observation", () => {
    const cell = createSimulationCoverageCell({
      cellId: "simulation-cell:v3-pairs",
      moveId: "move-akaikaru-firestorm",
      scenarioFamily: "move-isolation",
      checkpointId: "early",
      population: "isolation",
      strata: { exposureContext: "target-present", profile: "controlled-legal" },
      targetPairs: 1,
      minimumEligibleStates: 1,
      completedFights: 0,
      eligibleStates: 0,
      evidenceRole: "mechanic-exposure",
      samplingStatus: "not-started",
      observationStatus: "never-eligible",
    });
    const sufficient = updateSimulationCoverageCell(cell, {
      completedFights: 2,
      eligibleStates: 1,
      selectedStates: 0,
      triggeredStates: 0,
    });
    expect(sufficient).toMatchObject({
      targetPairs: 1,
      samplingStatus: "sufficient",
      observationStatus: "eligible-never-selected",
    });
    expect(Object.keys(sufficient)).not.toContain("targetFights");
    expect(JSON.stringify(sufficient)).not.toContain("targetFights");
    expect(validateSimulationCoverageCells([sufficient])).toEqual([]);
  });

  it("allows balance controls to close sampling without claiming mechanic observation", () => {
    const makeCell = (
      exposureContext: "target-present" | "target-removed",
      evidenceRole: "mechanic-exposure" | "balance-control",
      mechanicPath: "decision" | "trigger",
    ) =>
      updateSimulationCoverageCell(
        createSimulationCoverageCell({
          cellId: `simulation-cell:v3-${exposureContext}-${mechanicPath}`,
          moveId: "move-akaikaru-firestorm",
          scenarioFamily: "move-isolation",
          checkpointId: "early",
          population: "isolation",
          strata: { exposureContext, profile: "controlled-legal" },
          mechanicPath,
          targetPairs: 1,
          minimumEligibleStates: 1,
          completedFights: 0,
          eligibleStates: 0,
          evidenceRole,
          samplingStatus: "not-started",
          observationStatus:
            evidenceRole === "balance-control" ? "not-applicable" : "never-eligible",
        }),
        {
          completedFights: 2,
          eligibleStates: evidenceRole === "balance-control" ? 0 : 1,
          selectedStates: mechanicPath === "decision" && evidenceRole !== "balance-control" ? 1 : 0,
          triggeredStates: mechanicPath === "trigger" && evidenceRole !== "balance-control" ? 1 : 0,
        },
      );
    const targetDecision = makeCell("target-present", "mechanic-exposure", "decision");
    const targetTrigger = makeCell("target-present", "mechanic-exposure", "trigger");
    const removedDecision = makeCell("target-removed", "balance-control", "decision");
    const removedTrigger = makeCell("target-removed", "balance-control", "trigger");
    expect(aggregateSimulationCoverageCellStatus([targetDecision, targetTrigger])).toBe(
      "observed-sufficient",
    );
    expect(removedDecision).toMatchObject({
      samplingStatus: "sufficient",
      observationStatus: "not-applicable",
    });
    expect(
      validateSimulationCoverageCells([
        targetDecision,
        targetTrigger,
        removedDecision,
        removedTrigger,
      ]),
    ).toEqual([]);
  });

  it("emits a compact resumable artifact after each coverage request batch", () => {
    const checkpoints: unknown[] = [];
    const result = runSimulationMoveCoverage({
      population: "forced",
      targetPairs: 1,
      minimumEligibleStates: 1,
      moveIds: ["move-akaikaru-firestorm"],
      concurrency: 1,
      onCheckpoint: (artifact) => checkpoints.push(artifact),
    });
    expect(checkpoints).toHaveLength(1);
    expect(simulationMoveCoverageArtifactSchema.safeParse(checkpoints[0]).success).toBe(true);
    expect(
      (checkpoints[0] as { generatedFrom: { checkpoint?: unknown } }).generatedFrom.checkpoint,
    ).toMatchObject({
      batchSize: 25,
    });
    expect(result.artifact.schemaVersion).toBe("simulation-move-coverage-artifact:v3");
  }, 15_000);

  it("allows sufficient natural denominators with zero natural selections", () => {
    const cells = (["decision", "trigger"] as const).map((mechanicPath) =>
      updateSimulationCoverageCell(
        createSimulationCoverageCell({
          cellId: `simulation-cell:v3-natural-zero-${mechanicPath}`,
          moveId: "move-akaikaru-firestorm",
          scenarioFamily: "move-isolation",
          checkpointId: "early",
          population: "natural",
          mechanicPath,
          strata: { exposureContext: "target-present", profile: "profile:normal" },
          targetPairs: 1,
          minimumEligibleStates: 1,
          completedFights: 0,
          eligibleStates: 0,
          evidenceRole: "natural-observation",
          samplingStatus: "not-started",
          observationStatus: "never-eligible",
        }),
        { completedFights: 2, eligibleStates: 1 },
      ),
    );
    expect(cells.every((cell) => cell.samplingStatus === "sufficient")).toBe(true);
    expect(cells[0]?.observationStatus).toBe("eligible-never-selected");
    expect(cells[1]?.observationStatus).toBe("untriggered");
    expect(aggregateSimulationCoverageCellStatus(cells)).toBe("observed-sufficient");
  });

  it("keeps metrics in separate strata", () => {
    const present = createSimulationMoveMetrics(
      "move-akaikaru-firestorm",
      "isolation",
      "simulation-stratum:isolation:present",
    );
    const removed = createSimulationMoveMetrics(
      "move-akaikaru-firestorm",
      "isolation",
      "simulation-stratum:isolation:removed",
    );
    expect(() => mergeSimulationMoveMetrics(present, removed)).toThrow(
      /matching move and population/,
    );
  });

  it("preserves authoritative hashes while coverage omits diagnostic arrays", () => {
    const template = createSyntheticArchetypes()[0]!;
    const targetMove = template.moveIds[0]!;
    const scenario = (retention: "coverage" | "diagnostic") =>
      createScenario({
        id: "simulation-scenario:v3-retention",
        family: "symmetric-control",
        checkpointId: "early",
        templateAId: template.id,
        templateBId: template.id,
        variantId: "simulation-variant:baseline",
        retention,
        limits: { maximumTurns: 2, maximumTransitions: 30, semanticNoProgressLimit: 3 },
        stoppingPolicy: "continue",
        deferred: false,
      });
    const requestFor = (retention: "coverage" | "diagnostic") => ({
      schemaVersion: "simulation-contracts:v1" as const,
      runId: "simulation-run:v3-retention",
      scenario: scenario(retention),
      templateA: template,
      templateB: template,
      profileA: SIMULATION_QUALITY_PROFILE,
      profileB: SIMULATION_QUALITY_PROFILE,
      rootSeed: 7,
      fixedTime: new Date("2026-01-01T00:00:00.000Z"),
      mechanicsView: CANONICAL_COMBAT_MECHANICS_VIEW,
      decisionPolicy: {
        type: "controlled-legal-preference" as const,
        preferredDefinitionIds: [targetMove],
        baselineDefinitionId: "basic-attack",
        fallback: "first-legal" as const,
      },
    });
    const diagnostic = runSimulationFight(requestFor("diagnostic"));
    const coverage = runSimulationFight(requestFor("coverage"));
    expect(coverage.stateHash).toBe(diagnostic.stateHash);
    expect(coverage.eventHash).toBe(diagnostic.eventHash);
    expect(coverage.decisionHash).toBe(diagnostic.decisionHash);
    expect(coverage.transitions).toEqual([]);
    expect(coverage.diagnostics).toBeUndefined();
    expect(coverage.coverage?.terminalHashes).toEqual({
      state: diagnostic.stateHash,
      events: diagnostic.eventHash,
      decisions: diagnostic.decisionHash,
    });
    expect(Object.keys(coverage.coverage?.counters.eventCounts ?? {}).length).toBeGreaterThan(0);
    expect(coverage.replay.legalSetHashes).toEqual([]);
    expect(coverage.replay.decisions).toEqual([]);
    expect(coverage.replay.transitionHashes).toEqual([]);
  }, 30_000);

  it("deduplicates shared natural fights while crediting every equipped move", () => {
    const templates = createSimulationNaturalCoverageTemplates();
    const fallbackTemplates = templates.filter((template) =>
      template.id.startsWith("simulation-template:natural-coverage-"),
    );
    expect(fallbackTemplates.length).toBeGreaterThan(0);
    expect(new Set(fallbackTemplates.map((template) => template.maximumHitPoints))).toEqual(
      new Set([40]),
    );
    const firstTemplateIdForMove = new Map(
      CANONICAL_COMBAT_MECHANICS_VIEW.moves.map((move) => [
        move.id,
        templates
          .filter((template) => template.moveIds.includes(move.id))
          .sort((left, right) => left.id.localeCompare(right.id))[0]?.id,
      ]),
    );
    const sharedMoveIds = new Map<string, string[]>();
    for (const [moveId, templateId] of firstTemplateIdForMove) {
      if (templateId === undefined) continue;
      const moveIdsForTemplate = sharedMoveIds.get(templateId) ?? [];
      moveIdsForTemplate.push(moveId);
      sharedMoveIds.set(templateId, moveIdsForTemplate);
    }
    const moveIds = [...sharedMoveIds.values()]
      .find((candidate) => candidate.length >= 2)
      ?.slice(0, 2);
    if (moveIds === undefined) throw new Error("Expected moves with a shared natural template.");
    const result = runSimulationMoveCoverage({
      moveIds,
      population: "natural",
      naturalProfileId: "profile:normal",
      targetPairs: 1,
      minimumEligibleStates: 1,
      concurrency: 1,
      limits: { maximumTurns: 1, maximumTransitions: 8, semanticNoProgressLimit: 4 },
    });
    expect(result.runCount).toBe(2);
    for (const moveId of moveIds)
      expect(result.failures.map(({ moveId: failedMoveId }) => failedMoveId)).toContain(moveId);
    expect(
      moveIds.every(
        (moveId) =>
          result.artifact.generatedFrom.populationAttemptedFightsByMoveAndContext?.natural[
            moveId
          ]?.["target-present"] === 2,
      ),
    ).toBe(true);
    expect(result.artifact.coverageCells).toEqual(
      expect.arrayContaining(
        moveIds.flatMap((moveId) =>
          ["decision", "trigger"].map((mechanicPath) =>
            expect.objectContaining({
              moveId,
              population: "natural",
              mechanicPath,
              strata: expect.objectContaining({ exposureContext: "target-present" }),
            }),
          ),
        ),
      ),
    );
  }, 120_000);

  it("stops forced coverage early without counting a fight or precision statistic", () => {
    const moveId = "move-aoyosumu-braced-energy-beam";
    const result = runSimulationMoveCoverage({
      moveIds: [moveId],
      population: "forced",
      targetPairs: 1,
      minimumEligibleStates: 1,
      concurrency: 1,
      limits: { maximumTurns: 30, maximumTransitions: 500, semanticNoProgressLimit: 20 },
    });
    const cells = result.artifact.coverageCells.filter(
      (cell) => cell.moveId === moveId && cell.population === "forced",
    );
    expect(result.failures).toEqual([]);
    expect(result.runCount).toBe(2);
    expect(cells.every((cell) => cell.coverageSatisfiedRuns === 2)).toBe(true);
    expect(cells.every((cell) => cell.completedFights === 0)).toBe(true);
    expect(cells.every((cell) => cell.samplingStatus === "sufficient")).toBe(true);
    expect(cells.every((cell) => cell.precision?.status === "not-applicable")).toBe(true);
    expect(result.artifact.metricsByStratum?.forced).toMatchObject({});
    expect(result.artifact.metricsByMove?.forced[moveId]?.completedFights).toBe(0);
  }, 30_000);

  it("closes a sufficient forced sample whose observation is never eligible", () => {
    const moveId = "move-afterlife-angry-explosion";
    const result = runSimulationMoveCoverage({
      moveIds: [moveId],
      population: "forced",
      targetPairs: 1,
      minimumEligibleStates: 1,
      concurrency: 1,
      limits: { maximumTurns: 30, maximumTransitions: 500, semanticNoProgressLimit: 20 },
    });
    const record = result.artifact.dataset.records.find((candidate) => candidate.moveId === moveId);
    const move = CANONICAL_COMBAT_MECHANICS_VIEW.moves.find((candidate) => candidate.id === moveId);
    if (record === undefined || move === undefined) throw new Error("Expected focused move data.");
    const focusedView = { ...CANONICAL_COMBAT_MECHANICS_VIEW, moves: [move] };
    const focusedDataset = createSimulationMoveCoverageDataset(focusedView, [
      { ...record, isolationStatus: "observed-sufficient" },
    ]);
    expect(record?.forcedStatus).toBe("never-eligible");
    expect(
      validateSimulationMoveClosure(focusedDataset, {}, focusedView, {
        allowNaturalNotScheduled: true,
      }),
    ).toEqual([]);
  }, 30_000);

  it("records stalled isolation attempts as failures without completed evidence", () => {
    const moveId = "move-akaikaru-firestorm";
    const result = runSimulationMoveCoverage({
      moveIds: [moveId],
      population: "isolation",
      targetPairs: 1,
      minimumEligibleStates: 1,
      concurrency: 1,
      limits: { maximumTurns: 1, maximumTransitions: 8, semanticNoProgressLimit: 4 },
    });
    const targetCell = result.artifact.coverageCells.find(
      (cell) =>
        cell.moveId === moveId &&
        cell.population === "isolation" &&
        cell.strata.exposureContext === "target-present" &&
        cell.mechanicPath === "decision",
    );
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.failures.every(({ failure }) => failure.type === "exhausted-safeguard")).toBe(
      true,
    );
    expect(targetCell).toMatchObject({ completedFights: 0, samplingStatus: "failed" });
    expect(
      result.artifact.generatedFrom.representativeReplaySeedsByMove?.isolation[moveId],
    ).not.toEqual([]);
  }, 30_000);

  it("requires exclusion reasons for excluded coverage cells", () => {
    const dataset = createSimulationMoveCoverageDataset();
    const missingReason = createSimulationCoverageCell({
      cellId: "simulation-cell:v3-excluded",
      moveId: dataset.records[0]!.moveId,
      scenarioFamily: "move-isolation",
      checkpointId: "early",
      population: "isolation",
      strata: { exposureContext: "target-removed" },
      targetPairs: 1,
      minimumEligibleStates: 1,
      completedFights: 0,
      eligibleStates: 0,
      evidenceRole: "balance-control",
      samplingStatus: "excluded",
      observationStatus: "not-applicable",
    });
    expect(validateSimulationCoverageCells([missingReason])).toContain(
      "Excluded coverage cell lacks an exclusion reason: simulation-cell:v3-excluded",
    );
    const cell = createSimulationCoverageCell({
      ...missingReason,
      exclusionReason: "No comparable control was available.",
    });
    expect(validateSimulationCoverageCells([cell])).toEqual([]);
    const artifact = createSimulationMoveCoverageArtifact({
      generatedFrom: {
        mechanicsIdentity: dataset.mechanicsIdentity,
        scenarioFamily: "move-isolation",
        checkpointId: "early",
        targetPairs: 1,
        minimumEligibleStates: 1,
        isolationRunCount: 1,
        naturalPopulation: "draft",
        source: "test:v3",
      },
      dataset,
      coverageCells: [cell],
    });
    expect(createSimulationCompletionAudit(dataset, artifact.coverageCells).complete).toBe(false);
  });
});
