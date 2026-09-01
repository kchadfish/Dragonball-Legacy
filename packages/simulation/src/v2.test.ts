import { describe, expect, it } from "vitest";

import {
  CANONICAL_COMBAT_MECHANICS_VIEW,
  combatantIdSchema,
  type LegalDecision,
} from "@dragonball-resurgence/combat-engine";
import { normalProfile } from "@dragonball-resurgence/ai-engine";

import {
  SIMULATION_PRECISION_LOOKS,
  SIMULATION_NATURAL_AI_PROFILES,
  addSimulationStratifiedObservation,
  approveSimulationTf1Overlay,
  canonicalHash,
  createSimulationExposureRecipes,
  createSimulationMoveCoverageDataset,
  createSimulationMoveCoverageArtifact,
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
  runSimulationMoveCoverage,
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
        (template) => template.loadoutOverlay?.status === "draft" && template.moveIds.length === 14,
      ),
    ).toBe(true);
    const tf1Template = TF1_SIMULATION_TEMPLATES[0]!;
    expect(validateSimulationTemplate(tf1Template).ok).toBe(false);
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

  it("requires path-specific exercise before a coverage cell can be sufficient", () => {
    const baseCell = {
      cellId: "simulation-cell:path-exercise",
      moveId: "move-akaikaru-firestorm",
      scenarioFamily: "move-isolation",
      checkpointId: "early",
      population: "isolation" as const,
      strata: { category: "advanced-attack" },
      targetFights: 1,
      minimumEligibleStates: 1,
      completedFights: 1,
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
      targetFights: 1,
      minimumEligibleStates: 1,
      concurrency: 1,
      population: "isolation",
    });
    expect(
      isolation.artifact.coverageCells
        .filter((cell) => cell.population === "natural")
        .every((cell) => cell.status === "not-scheduled"),
    ).toBe(true);
    expect(isolation.artifact.errors).toHaveLength(isolation.failures.length);
    expect(isolation.artifact.coverageCells.some((cell) => cell.population === "forced")).toBe(
      false,
    );
  }, 15_000);

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
    const requests = [requestFor(0), requestFor(1)];
    const sequential = runSimulationRequests({
      requests,
      stoppingPolicy: "continue",
      concurrency: 1,
    });
    const workers = runSimulationRequestsWithWorkers({
      requests,
      stoppingPolicy: "continue",
      workers: 2,
    });
    expect(canonicalHash(sequential.results)).toBe(canonicalHash(workers.results));
  });
});
