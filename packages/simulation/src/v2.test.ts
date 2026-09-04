import { describe, expect, it } from "vitest";

import {
  CANONICAL_COMBAT_MECHANICS_VIEW,
  combatantIdSchema,
  type LegalDecision,
} from "@dragonball-resurgence/combat-engine";
import { normalProfile, SIMULATION_QUALITY_PROFILE } from "@dragonball-resurgence/ai-engine";

import {
  SIMULATION_PRECISION_LOOKS,
  SIMULATION_NATURAL_AI_PROFILES,
  addSimulationStratifiedObservation,
  approveSimulationTf1Overlay,
  canonicalHash,
  createSimulationExposureRecipes,
  createSimulationMoveCoverageDataset,
  createSimulationMoveCoverageArtifact,
  createSimulationMoveBalanceReport,
  createSimulationNaturalCoverageTemplates,
  runSimulationBenchmark,
  mergeSimulationMoveCoverageArtifacts,
  recordSimulationMoveFunnel,
  createSimulationCoverageMatrix,
  createSimulationCoverageCell,
  updateSimulationCoverageCell,
  createSimulationStratifiedAccumulator,
  createSyntheticArchetypes,
  createSimulationFightSpecs,
  createScenario,
  mergeSimulationStratifiedAccumulators,
  runSimulationRequests,
  runSimulationRequestsWithWorkers,
  runSimulationFight,
  runSimulationMoveCoverage,
  runSimulationMoveCoverageCatalog,
  resumeSimulationMoveCoverage,
  SIMULATION_MOVE_COVERAGE_EXPOSURE_CONTEXTS,
  nextSimulationCoveragePrecisionLook,
  selectForcedSimulationDecision,
  simulationMoveCoverageArtifactSchema,
  validateSimulationMoveCoverageArtifact,
  TF1_SIMULATION_TEMPLATES,
  validateSimulationTemplate,
  type SimulationFightRequest,
  type SimulationSeriesRequest,
} from "./index.js";

describe("simulation v2 contracts", () => {
  it("represents the exact 499-move catalog and rejects v1 coverage artifacts", () => {
    const dataset = createSimulationMoveCoverageDataset();
    expect(dataset.schemaVersion).toBe("simulation-move-coverage:v2");
    expect(dataset.records).toHaveLength(499);
    expect(dataset.records.every((record) => record.requiredMechanicPaths.length === 2)).toBe(true);
    expect(
      simulationMoveCoverageArtifactSchema.safeParse({
        schemaVersion: "simulation-move-coverage-artifact:v1",
      }).success,
    ).toBe(false);
  });

  it("keeps v2 coverage errors typed and bound into the artifact hash", () => {
    const dataset = createSimulationMoveCoverageDataset();
    const artifact = createSimulationMoveCoverageArtifact({
      generatedFrom: {
        mechanicsIdentity: dataset.mechanicsIdentity,
        scenarioFamily: "move-isolation",
        checkpointId: "early",
        targetFights: 1,
        minimumEligibleStates: 1,
        isolationRunCount: 1,
        naturalPopulation: "draft",
        source: "test:v2-errors",
      },
      dataset,
      coverageCells: createSimulationCoverageMatrix(dataset, ["move-isolation"], "early", {
        targetFights: 1,
        minimumEligibleStates: 1,
        populations: ["isolation"],
        mechanicPaths: ["decision"],
      }),
      errors: [
        {
          moveId: dataset.records[0]!.moveId,
          runId: "simulation-run:test-error",
          type: "runner-failure",
          detail: "fixture failure retained for rerun",
        },
      ],
    });
    expect(artifact.errors).toHaveLength(1);
    expect(validateSimulationMoveCoverageArtifact(artifact)).not.toContain(
      "Coverage artifact hash is stale or invalid.",
    );
    expect(() =>
      simulationMoveCoverageArtifactSchema.parse({
        ...artifact,
        errors: [{ ...artifact.errors[0], type: "free-text-exclusion" }],
      }),
    ).toThrow();
  });

  it("generates draft TF1 overlays with canonical slot limits and explicit approval", () => {
    const templates = createSyntheticArchetypes();
    expect(templates).toHaveLength(12);
    expect(TF1_SIMULATION_TEMPLATES).toHaveLength(36);
    expect(
      TF1_SIMULATION_TEMPLATES.every(
        (template) => template.loadoutOverlay?.status === "draft" && template.moveIds.length >= 14,
      ),
    ).toBe(true);
    const tf1Template = TF1_SIMULATION_TEMPLATES[0]!;
    expect(validateSimulationTemplate(tf1Template).ok).toBe(true);
    const approved = approveSimulationTf1Overlay(tf1Template, "staff:test-overlay");
    expect(approved.loadoutOverlay?.status).toBe("approved");
    expect(validateSimulationTemplate(approved).ok).toBe(true);
    expect(
      TF1_SIMULATION_TEMPLATES.map((template) =>
        validateSimulationTemplate(approveSimulationTf1Overlay(template, "staff:test-overlay")),
      ).every((result) => result.ok),
    ).toBe(true);
  });

  it("keeps forced exposure separate and selects only an engine-legal decision", () => {
    const actorId = combatantIdSchema.parse("combatant:v2-actor");
    const targetId = combatantIdSchema.parse("combatant:v2-target");
    const targetMove = CANONICAL_COMBAT_MECHANICS_VIEW.moves[0]!.id;
    const legalDecisions = [
      { type: "pass", actorId },
      { type: "use-move", actorId, targetCombatantId: targetId, moveId: targetMove },
    ] as unknown as LegalDecision[];
    const selected = selectForcedSimulationDecision(legalDecisions, {
      type: "forced-target-first",
      targetDefinitionId: targetMove,
      fallback: "first-legal",
    });
    expect(selected).toEqual(legalDecisions[1]);
    const recipes = createSimulationExposureRecipes();
    expect(recipes).toHaveLength(499 * 3);
    expect(recipes.filter((recipe) => recipe.population === "forced")).toHaveLength(499);
    expect(
      recipes.filter((recipe) => recipe.decisionPolicy.type === "forced-target-first"),
    ).toHaveLength(499);
    expect(new Set(recipes.map((recipe) => recipe.category))).toEqual(
      new Set(["mastery", "skill", "advanced-attack", "signature", "block"]),
    );
    expect(new Set(recipes.map((recipe) => recipe.scenarioFamily))).toEqual(
      new Set([
        "natural-style-mastery",
        "resource-control",
        "cross-archetype",
        "signature-horizon",
        "defensive-response",
      ]),
    );
    expect(SIMULATION_NATURAL_AI_PROFILES).toEqual([
      "profile:normal",
      "profile:hard",
      "profile:simulation-quality",
    ]);
  });

  it("keeps activated modifiers valid through pending-response continuations", () => {
    const result = runSimulationMoveCoverage({
      moveIds: [
        "move-afterlife-burning-shoot",
        "move-haokiru-phoenix-tackle",
        "move-kurokonwaku-poison-mist",
        "move-haokiru-willing-sacrifice",
      ],
      population: "forced",
      targetPairs: 1,
      minimumEligibleStates: 1,
      limits: { maximumTurns: 30, maximumTransitions: 500, semanticNoProgressLimit: 20 },
      concurrency: 1,
    });

    expect(result.failures).toEqual([]);
    expect(result.artifact.errors).toEqual([]);
  }, 30_000);

  it("counts triggered move-used events separately from submitted move resolutions", () => {
    const moveId = "move-aoyosumu-braced-energy-beam";
    const base = createSyntheticArchetypes()[0]!;
    const styleId = CANONICAL_COMBAT_MECHANICS_VIEW.moves.find(
      (move) => move.id === moveId,
    )?.styleId;
    if (styleId === undefined) throw new Error(`Missing canonical style for ${moveId}.`);
    const templateA = {
      ...base,
      id: "simulation-template:v2-funnel-attacker",
      styleId,
      moveIds: [moveId],
    };
    const templateB = {
      ...base,
      id: "simulation-template:v2-funnel-defender",
      moveIds: [],
    };
    const result = runSimulationFight({
      schemaVersion: "simulation-contracts:v1",
      runId: "simulation-run:v2-funnel",
      scenario: createScenario({
        id: "simulation-scenario:v2-funnel",
        family: "move-isolation",
        checkpointId: "early",
        templateAId: templateA.id,
        templateBId: templateB.id,
        variantId: "simulation-variant:baseline",
        retention: "diagnostic",
        limits: { maximumTurns: 30, maximumTransitions: 500, semanticNoProgressLimit: 20 },
        stoppingPolicy: "continue",
        deferred: false,
      }),
      templateA,
      templateB,
      profileA: SIMULATION_QUALITY_PROFILE,
      profileB: SIMULATION_QUALITY_PROFILE,
      rootSeed: 1_427_251_991,
      iteration: 0,
      mirror: "original",
      fixedTime: new Date("2026-01-01T00:00:00.000Z"),
      mechanicsView: CANONICAL_COMBAT_MECHANICS_VIEW,
      decisionPolicy: {
        type: "forced-target-first",
        targetDefinitionId: moveId,
        fallback: "first-legal",
      },
    });
    expect(result.failure?.type).toBe("exhausted-safeguard");
    expect(result.diagnostics?.evaluations).toEqual([]);
    expect(result.diagnostics?.moveFunnels[moveId]).toMatchObject({
      submitted: 2,
      resolved: 2,
      successful: 1,
      valueProducing: 1,
    });
  }, 180_000);

  it("uses repository-authoritative TF1 overlays for natural exposure by default", () => {
    const moveId = TF1_SIMULATION_TEMPLATES[0]!.moveIds[0]!;
    const result = runSimulationMoveCoverage({
      moveIds: [moveId],
      targetPairs: 1,
      minimumEligibleStates: 1,
      population: "natural",
      naturalProfileId: "profile:normal",
      limits: { maximumTurns: 1, maximumTransitions: 8, semanticNoProgressLimit: 4 },
      concurrency: 1,
    });
    expect(result.artifact.generatedFrom.naturalPopulation).toBe("approved");
    expect(result.artifact.generatedFrom.naturalOverlayApprovalReference).toBe(
      "repository:balance-testing/tf1:v1",
    );
    expect(new Set(result.artifact.coverageCells.map((cell) => cell.cellId)).size).toBe(
      result.artifact.coverageCells.length,
    );
    expect(result.artifact.coverageCells.every((cell) => cell.population === "natural")).toBe(true);
    const report = createSimulationMoveBalanceReport(result.artifact.dataset, undefined, {
      generatedFrom: result.artifact.generatedFrom,
      coverageCells: result.artifact.coverageCells,
    });
    expect(report.generatedFrom).toMatchObject({
      naturalProfileId: "profile:normal",
      naturalOverlayAuthority: "repository",
      templateProvenance: "repository:balance-testing/tf1:v1",
      precisionLook: 1,
    });
  }, 180_000);

  it("keeps the complete natural universe and exposure contexts deterministic", () => {
    const templates = createSimulationNaturalCoverageTemplates();
    expect(templates.some((template) => template.kind === "tf1-source")).toBe(true);
    expect(
      templates.some((template) => template.source.path === "simulation/generated-builds"),
    ).toBe(true);
    expect(
      templates.some((template) => template.source.path === "simulation/synthetic-archetypes"),
    ).toBe(true);
    expect(new Set(templates.flatMap((template) => template.moveIds))).toEqual(
      new Set(CANONICAL_COMBAT_MECHANICS_VIEW.moves.map((move) => move.id)),
    );
    expect(
      templates
        .filter((template) => template.kind === "tf1-source")
        .flatMap((template) => template.gaps)
        .some((gap) => gap.kind === "capability"),
    ).toBe(true);

    const result = runSimulationMoveCoverage({
      moveIds: ["move-akaikaru-firestorm"],
      targetPairs: 1,
      minimumEligibleStates: 1,
      population: "isolation",
      limits: { maximumTurns: 1, maximumTransitions: 8, semanticNoProgressLimit: 4 },
      concurrency: 1,
    });
    expect(result.artifact.generatedFrom.exposureContexts).toEqual(
      SIMULATION_MOVE_COVERAGE_EXPOSURE_CONTEXTS,
    );
    expect(
      new Set(
        result.artifact.coverageCells
          .filter((cell) => cell.population === "isolation")
          .map((cell) => cell.strata.exposureContext),
      ),
    ).toEqual(new Set(SIMULATION_MOVE_COVERAGE_EXPOSURE_CONTEXTS));
  }, 90_000);

  it("advances only through the declared precision looks", () => {
    expect(nextSimulationCoveragePrecisionLook(250)).toBe(500);
    expect(nextSimulationCoveragePrecisionLook(2_000)).toBe(5_000);
    expect(() => nextSimulationCoveragePrecisionLook(10_000)).toThrow(/No declared/);
  });

  it("records Wilson precision and keeps low-precision production cells open", () => {
    const cell = createSimulationCoverageCell({
      cellId: "simulation-cell:precision",
      moveId: "move-akaikaru-firestorm",
      scenarioFamily: "move-isolation",
      mechanicPath: "decision",
      checkpointId: "early",
      population: "isolation",
      strata: { category: "advanced-attack", exposureContext: "target-present" },
      targetFights: 250,
      minimumEligibleStates: 250,
      completedFights: 0,
      eligibleStates: 0,
      selectedStates: 0,
      triggeredStates: 0,
      status: "unobserved",
    });
    const low = updateSimulationCoverageCell(cell, {
      completedFights: 500,
      eligibleStates: 250,
      selectedStates: 125,
    });
    expect(low.precision).toMatchObject({
      completedPairs: 250,
      targetPairs: 250,
      status: "low-precision",
    });
    expect(low.status).toBe("observed-low-sample");
    const precise = updateSimulationCoverageCell(cell, {
      completedFights: 500,
      eligibleStates: 250,
      selectedStates: 250,
    });
    expect(precise.precision?.status).toBe("precise");
    expect(precise.status).toBe("observed-sufficient");
  });

  it("requires path-specific exercise before a coverage cell can be sufficient", () => {
    const baseCell = {
      cellId: "simulation-cell:path-exercise",
      moveId: "move-akaikaru-firestorm",
      scenarioFamily: "move-isolation",
      checkpointId: "early",
      population: "isolation" as const,
      strata: { category: "advanced-attack" },
      targetPairs: 1,
      minimumEligibleStates: 1,
      completedFights: 2,
      eligibleStates: 1,
    };
    expect(() =>
      createSimulationCoverageCell({
        ...baseCell,
        mechanicPath: "decision",
        selectedStates: 0,
        status: "observed-sufficient",
      }),
    ).toThrow();
    const decision = createSimulationCoverageCell({
      ...baseCell,
      mechanicPath: "decision",
      selectedStates: 0,
      status: "unobserved",
    });
    expect(updateSimulationCoverageCell(decision, baseCell)).toMatchObject({
      status: "eligible-never-selected",
    });
    const trigger = createSimulationCoverageCell({
      ...baseCell,
      cellId: "simulation-cell:path-trigger",
      mechanicPath: "trigger",
      triggeredStates: 1,
      status: "unobserved",
    });
    expect(updateSimulationCoverageCell(trigger, baseCell).status).toBe("observed-sufficient");
  });

  it("keeps catalog populations and runner failures separate", () => {
    const moveId = "move-akaikaru-firestorm";
    const isolation = runSimulationMoveCoverage({
      moveIds: [moveId],
      targetPairs: 1,
      minimumEligibleStates: 1,
      concurrency: 1,
      population: "isolation",
      limits: { maximumTurns: 1, maximumTransitions: 8, semanticNoProgressLimit: 4 },
    });
    expect(
      isolation.artifact.coverageCells
        .filter((cell) => cell.population === "natural")
        .every((cell) => cell.status === "not-scheduled"),
    ).toBe(true);
    expect(isolation.artifact.generatedFrom.naturalPopulation).toBe("draft");
    expect(isolation.artifact.generatedFrom.naturalPopulationBlocker).toMatch(
      /natural population coverage was not scheduled/i,
    );
    expect(isolation.artifact.errors).toHaveLength(isolation.failures.length);
    expect(isolation.artifact.errors.every((error) => error.population === "isolation")).toBe(true);
    expect(
      isolation.artifact.generatedFrom.representativeReplaySeedsByMove?.isolation[moveId],
    ).toHaveLength(2);
    expect(isolation.artifact.metricsByMove?.isolation[moveId]).toMatchObject({
      moveId,
      population: "isolation",
      completedFights: 0,
      errorCount: 6,
      observability: { diagnosticFights: 0, summaryOnlyFights: 0 },
      orientationCounts: { original: 0, mirrored: 0 },
    });
    expect(isolation.artifact.stratifiedAccumulators?.isolation[moveId]).toMatchObject({
      stratumId: `isolation:${moveId}`,
      completedPairs: 0,
      errorCount: 0,
    });
    const report = createSimulationMoveBalanceReport(isolation.artifact.dataset, undefined, {
      errors: isolation.artifact.errors,
      coverageCells: isolation.artifact.coverageCells,
      metricsByMove: isolation.artifact.metricsByMove,
      stratifiedAccumulators: isolation.artifact.stratifiedAccumulators,
      generatedFrom: isolation.artifact.generatedFrom,
    });
    expect(
      report.pairedEffects.find(
        (effect) => effect.id === `isolation:${moveId}:target-control-damage`,
      ),
    ).toMatchObject({ completedPairs: 0, intervalMethod: "not-estimated" });
    expect(isolation.artifact.coverageCells.some((cell) => cell.population === "forced")).toBe(
      false,
    );
  }, 15_000);

  it("merges population artifacts with separate denominators", () => {
    const moveId = "move-akaikaru-firestorm";
    const funnel = {
      equipped: 1,
      eligible: 1,
      affordable: 1,
      selected: 1,
      submitted: 1,
      resolved: 1,
      successful: 1,
      valueProducing: 1,
      decisionFunnel: {
        equipped: 1,
        eligible: 1,
        affordable: 1,
        selected: 1,
        submitted: 1,
        resolved: 1,
        successful: 1,
        valueProducing: 1,
      },
      triggerFunnel: {
        applicable: 1,
        triggered: 1,
        activated: 1,
        resolved: 1,
        successful: 1,
        valueProducing: 1,
      },
    } as const;
    const artifactFor = (population: "isolation" | "forced") => {
      const dataset = recordSimulationMoveFunnel(
        createSimulationMoveCoverageDataset(),
        { [moveId]: funnel },
        population,
        { targetFights: 1, minimumEligibleStates: 1 },
      );
      const cells = createSimulationCoverageMatrix(dataset, ["move-isolation"], "early", {
        targetFights: 1,
        minimumEligibleStates: 1,
        populations: [population],
        mechanicPaths: ["decision", "trigger"],
      }).map((cell) =>
        updateSimulationCoverageCell(cell, {
          completedFights: 2,
          eligibleStates: 1,
          selectedStates: cell.mechanicPath === "decision" ? 1 : 0,
          triggeredStates: cell.mechanicPath === "trigger" ? 1 : 0,
        }),
      );
      return createSimulationMoveCoverageArtifact({
        generatedFrom: {
          mechanicsIdentity: dataset.mechanicsIdentity,
          scenarioFamily: "move-isolation",
          checkpointId: "early",
          targetFights: 1,
          minimumEligibleStates: 1,
          isolationRunCount: 1,
          population,
          populationRunCounts: {
            natural: 0,
            isolation: population === "isolation" ? 1 : 0,
            forced: population === "forced" ? 1 : 0,
          },
          naturalPopulation: "draft",
          source: `test:${population}`,
        },
        dataset,
        coverageCells: cells,
      });
    };
    const merged = mergeSimulationMoveCoverageArtifacts([
      artifactFor("isolation"),
      artifactFor("forced"),
    ]);
    const record = merged.dataset.records.find((candidate) => candidate.moveId === moveId)!;
    expect(record.populationFunnels?.isolation.eligible).toBe(1);
    expect(record.populationFunnels?.forced.eligible).toBe(1);
    expect(record.funnel.eligible).toBe(2);
    expect(record.isolationStatus).toBe("observed-sufficient");
    expect(record.forcedStatus).toBe("observed-sufficient");
    expect(merged.generatedFrom.populationRunCounts).toEqual({
      natural: 0,
      isolation: 1,
      forced: 1,
    });
  }, 15_000);

  it("resumes a population artifact without replaying prior deterministic attempts", () => {
    const moveId = "move-akaikaru-firestorm";
    const initial = runSimulationMoveCoverage({
      moveIds: [moveId],
      targetPairs: 1,
      minimumEligibleStates: 1,
      concurrency: 1,
      population: "isolation",
      limits: { maximumTurns: 30, maximumTransitions: 500, semanticNoProgressLimit: 20 },
    });
    const resumed = resumeSimulationMoveCoverage(initial.artifact, {
      targetPairs: 2,
      minimumEligibleStates: 1,
      concurrency: 1,
      moveIds: [moveId],
      limits: { maximumTurns: 30, maximumTransitions: 500, semanticNoProgressLimit: 20 },
    });
    const cell = resumed.artifact.coverageCells.find(
      (candidate) => candidate.moveId === moveId && candidate.mechanicPath === "decision",
    );
    expect(resumed.runCount).toBe(6);
    expect(resumed.artifact.generatedFrom.targetFights).toBe(2);
    expect(resumed.artifact.generatedFrom.populationAttemptedFightsByMove?.isolation[moveId]).toBe(
      12,
    );
    expect(cell?.targetFights).toBe(2);
    expect(cell?.completedFights).toBe(4);
    expect(resumed.artifact.errors).toHaveLength(initial.artifact.errors.length);
  }, 15_000);

  it("resumes a merged catalog artifact without pooling population attempts", () => {
    const moveId = "move-akaikaru-firestorm";
    const limits = { maximumTurns: 30, maximumTransitions: 500, semanticNoProgressLimit: 20 };
    const initial = runSimulationMoveCoverageCatalog({
      moveIds: [moveId],
      targetPairs: 1,
      minimumEligibleStates: 1,
      concurrency: 1,
      populations: ["isolation", "forced"],
      limits,
    });
    const resumed = runSimulationMoveCoverageCatalog({
      moveIds: [moveId],
      targetPairs: 2,
      minimumEligibleStates: 1,
      concurrency: 1,
      populations: ["isolation", "forced"],
      resumeFrom: initial.artifact,
      limits,
    });
    expect(resumed.runCount).toBe(8);
    expect(resumed.artifact.generatedFrom.population).toBeUndefined();
    expect(resumed.artifact.generatedFrom.populationAttemptedFightsByMove).toMatchObject({
      isolation: { [moveId]: 12 },
      forced: { [moveId]: 4 },
    });
    expect(resumed.artifact.generatedFrom.populationRunCounts).toMatchObject({
      isolation: 12,
      forced: 4,
    });
  }, 30_000);

  it("adds an absent population at the current precision during catalog resume", () => {
    const moveId = "move-akaikaru-firestorm";
    const limits = { maximumTurns: 30, maximumTransitions: 500, semanticNoProgressLimit: 20 };
    const isolation = runSimulationMoveCoverageCatalog({
      moveIds: [moveId],
      targetPairs: 1,
      minimumEligibleStates: 1,
      concurrency: 1,
      populations: ["isolation"],
      limits,
    });
    const merged = runSimulationMoveCoverageCatalog({
      moveIds: [moveId],
      targetPairs: 1,
      minimumEligibleStates: 1,
      concurrency: 1,
      populations: ["forced"],
      resumeFrom: isolation.artifact,
      limits,
    });
    expect(merged.runCount).toBe(2);
    expect(merged.artifact.generatedFrom.population).toBeUndefined();
    expect(merged.artifact.generatedFrom.populationRunCounts).toMatchObject({
      isolation: 6,
      forced: 2,
    });
    expect(
      merged.artifact.coverageCells.filter(
        (cell) => cell.moveId === moveId && cell.population === "forced",
      ),
    ).toHaveLength(2);
  }, 30_000);

  it("uses one semantic pair identity for mirrored orientations", () => {
    const template = createSyntheticArchetypes()[0]!;
    const baseRequest: SimulationFightRequest = {
      schemaVersion: "simulation-contracts:v1",
      runId: "simulation-run:v2-pair",
      scenario: createScenario({
        id: "simulation-scenario:v2-pair",
        family: "symmetric-control",
        checkpointId: "early",
        templateAId: template.id,
        templateBId: template.id,
        variantId: "simulation-variant:baseline",
        retention: "summary",
        limits: { maximumTurns: 1, maximumTransitions: 8, semanticNoProgressLimit: 4 },
        stoppingPolicy: "continue",
        deferred: false,
      }),
      templateA: template,
      templateB: template,
      profileA: normalProfile,
      profileB: normalProfile,
      rootSeed: 17,
      fixedTime: new Date("2026-01-01T00:00:00.000Z"),
      mechanicsView: CANONICAL_COMBAT_MECHANICS_VIEW,
    };
    const series = {
      schemaVersion: "simulation-contracts:v1" as const,
      seriesId: "simulation-series:v2-pair",
      baseRequest,
      iterations: 1,
      mirrored: true,
      stoppingPolicy: "continue" as const,
    } satisfies SimulationSeriesRequest;
    const specs = createSimulationFightSpecs(series);
    expect(specs).toHaveLength(2);
    expect(specs[0]!.pairId).toBe(specs[1]!.pairId);
    expect(specs[0]!.mirror).not.toBe(specs[1]!.mirror);
  });

  it("merges stratified accumulators independent of partitioning", () => {
    const observations = [
      {
        pairId: "pair:a",
        winner: "a" as const,
        turns: 4,
        damageA: 9,
        damageB: 3,
        representativeSeed: 2,
      },
      {
        pairId: "pair:b",
        winner: "b" as const,
        turns: 6,
        damageA: 4,
        damageB: 8,
        representativeSeed: 1,
      },
    ];
    let sequential = createSimulationStratifiedAccumulator("stratum:test");
    for (const observation of observations)
      sequential = addSimulationStratifiedObservation(sequential, observation);
    const first = addSimulationStratifiedObservation(
      createSimulationStratifiedAccumulator("stratum:test"),
      observations[0]!,
    );
    const second = addSimulationStratifiedObservation(
      createSimulationStratifiedAccumulator("stratum:test"),
      observations[1]!,
    );
    const merged = mergeSimulationStratifiedAccumulators(first, second);
    expect(merged.accumulatorHash).toBe(sequential.accumulatorHash);
    expect(SIMULATION_PRECISION_LOOKS).toEqual([250, 500, 1_000, 2_000, 5_000, 10_000]);
  });

  it("keeps sequential and worker-partitioned request results canonical", () => {
    const template = createSyntheticArchetypes()[0]!;
    const requestFor = (index: number): SimulationFightRequest => ({
      schemaVersion: "simulation-contracts:v1",
      runId: `simulation-run:v2-worker-${index}`,
      scenario: createScenario({
        id: `simulation-scenario:v2-worker-${index}`,
        family: "symmetric-control",
        checkpointId: "early",
        templateAId: template.id,
        templateBId: template.id,
        variantId: "simulation-variant:baseline",
        retention: "summary",
        limits: { maximumTurns: 1, maximumTransitions: 8, semanticNoProgressLimit: 4 },
        stoppingPolicy: "continue",
        deferred: false,
      }),
      templateA: template,
      templateB: template,
      profileA: normalProfile,
      profileB: normalProfile,
      rootSeed: 23,
      fixedTime: new Date("2026-01-01T00:00:00.000Z"),
      mechanicsView: CANONICAL_COMBAT_MECHANICS_VIEW,
    });
    const requests = [0, 1, 2, 3].map(requestFor);
    const sequential = runSimulationRequests({
      requests,
      stoppingPolicy: "continue",
      concurrency: 1,
    });
    const oneWorker = runSimulationRequestsWithWorkers({
      requests,
      stoppingPolicy: "continue",
      workers: 1,
    });
    const twoWorkers = runSimulationRequestsWithWorkers({
      requests,
      stoppingPolicy: "continue",
      workers: 2,
    });
    const fourWorkers = runSimulationRequestsWithWorkers({
      requests,
      stoppingPolicy: "continue",
      workers: 4,
    });
    const streamedByRunId = new Map<string, (typeof sequential.results)[number]>();
    const streamed = runSimulationRequestsWithWorkers({
      requests,
      stoppingPolicy: "continue",
      workers: 2,
      retainResults: false,
      onProgress: (progress) => streamedByRunId.set(progress.runId, progress.result),
    });
    const expectedHash = canonicalHash(sequential.results);
    expect(canonicalHash(oneWorker.results)).toBe(expectedHash);
    expect(canonicalHash(twoWorkers.results)).toBe(expectedHash);
    expect(canonicalHash(fourWorkers.results)).toBe(expectedHash);
    expect(streamed.results).toHaveLength(0);
    expect(canonicalHash(requests.map((request) => streamedByRunId.get(request.runId)))).toBe(
      expectedHash,
    );
  }, 90_000);

  it("keeps batched cross-move coverage canonical across worker counts and pool reuse", () => {
    const moveIds = ["move-akaikaru-firestorm", "move-aoyosumu-braced-energy-beam"];
    const options = {
      moveIds,
      population: "forced" as const,
      targetPairs: 1,
      minimumEligibleStates: 1,
      limits: { maximumTurns: 30, maximumTransitions: 500, semanticNoProgressLimit: 20 },
    };
    const oneWorker = runSimulationMoveCoverage({ ...options, workers: 1 });
    const twoWorkers = runSimulationMoveCoverage({ ...options, workers: 2 });
    const reusedPool = runSimulationMoveCoverage({ ...options, workers: 2 });
    const expectedHash = canonicalHash(oneWorker.artifact);
    expect(oneWorker.runCount).toBe(moveIds.length * 2);
    expect(canonicalHash(twoWorkers.artifact)).toBe(expectedHash);
    expect(canonicalHash(reusedPool.artifact)).toBe(expectedHash);
  }, 30_000);

  it("executes the fast benchmark preset with canonical output", () => {
    const result = runSimulationBenchmark({
      benchmarkId: "fast",
      iterations: 1,
    });

    expect(result.result).toBe("passed");
    expect(result.completedCount).toBe(1);
    expect(result.totalTransitions).toBe(0);
    expect(result.benchmarkHash).toMatch(/^fnv1a-32:/);
  }, 30_000);
});
