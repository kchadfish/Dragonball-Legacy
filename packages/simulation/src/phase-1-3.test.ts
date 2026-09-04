import { describe, expect, it } from "vitest";

import { SIMULATION_QUALITY_PROFILE } from "@dragonball-resurgence/ai-engine";
import {
  BranchCombatIdSource,
  CANONICAL_COMBAT_MECHANICS_VIEW,
  FixedClock,
  SeededRandomSource,
  createCombatRuntime,
} from "@dragonball-resurgence/combat-engine";

import {
  ALL_SIMULATION_TEMPLATES,
  TF1_SIMULATION_TEMPLATES,
  allocateSimulationSeed,
  allocateSimulationSeeds,
  canonicalHash,
  createSimulationClosureReport,
  createSimulationCheckpoint,
  createSimulationCheckpointCatalog,
  createSimulationMoveCoverageDataset,
  createSimulationVariant,
  applySimulationVariantToRequest,
  createScenario,
  createSyntheticArchetypes,
  materializeSimulationTemplate,
  runSimulationRequests,
  runSimulationFight,
  runSimulationMatrix,
  runSimulationSeriesBatches,
  runSimulationSeries,
  reviewCustomMove,
  expandSimulationScenarios,
  SIMULATION_SCENARIO_FAMILIES,
  simulationReplayRecordSchema,
  simulationTemplateSchema,
  validateSimulationCheckpoint,
  verifySimulationReplay,
  validateSimulationTemplate,
} from "./index.js";

const baseSeed = {
  rootSeed: 42,
  scenarioId: "simulation-scenario:smoke" as const,
  scenarioHash: "scenario-hash",
  variantId: "simulation-variant:baseline" as const,
  pairId: "pair:a-b",
  iteration: 0,
  mirror: "original" as const,
  templateAHash: "a",
  templateBHash: "b",
  strategyAId: "profile:simulation-quality",
  strategyBId: "profile:simulation-quality",
};

describe("simulation Phase 1 through 3 contracts", () => {
  it("allocates independent semantic namespaces regardless of request order", () => {
    const combat = allocateSimulationSeed({ ...baseSeed, namespace: "combat" });
    const aiA = allocateSimulationSeed({ ...baseSeed, namespace: "ai-a" });
    const aiB = allocateSimulationSeed({ ...baseSeed, namespace: "ai-b" });
    const diagnosticRerun = allocateSimulationSeed({
      ...baseSeed,
      namespace: "diagnostic-rerun",
    });
    expect({
      combat: combat.seed,
      aiA: aiA.seed,
      aiB: aiB.seed,
      diagnosticRerun: diagnosticRerun.seed,
    }).toEqual({
      combat: 3401746360,
      aiA: 1068189856,
      aiB: 2981279707,
      diagnosticRerun: 2447722428,
    });
    expect(new Set([combat.seed, aiA.seed, aiB.seed]).size).toBe(3);
    expect(
      allocateSimulationSeeds([
        { ...baseSeed, namespace: "ai-b" },
        { ...baseSeed, namespace: "combat" },
        { ...baseSeed, namespace: "ai-a" },
      ]),
    ).toEqual(
      allocateSimulationSeeds([
        { ...baseSeed, namespace: "ai-a" },
        { ...baseSeed, namespace: "combat" },
        { ...baseSeed, namespace: "ai-b" },
      ]),
    );
    const primarySeed = allocateSimulationSeed({ ...baseSeed, namespace: "combat" });
    const withUnrelatedScenario = allocateSimulationSeeds([
      { ...baseSeed, namespace: "combat" },
      {
        ...baseSeed,
        scenarioId: "simulation-scenario:unrelated",
        scenarioHash: "unrelated-scenario-hash",
        namespace: "combat",
      },
    ]);
    expect(
      withUnrelatedScenario.find((entry) => entry.key?.scenarioId === baseSeed.scenarioId)?.seed,
    ).toBe(primarySeed.seed);
    expect(combat.key?.pairId).toBe(baseSeed.pairId);
  }, 20_000);

  it("rejects malformed runtime contracts and preserves ordered arrays in hashes", () => {
    expect(() =>
      simulationTemplateSchema.parse({ schemaVersion: "simulation-contracts:v0" }),
    ).toThrow();
    expect(canonicalHash({ moves: ["a", "b"] })).not.toBe(canonicalHash({ moves: ["b", "a"] }));
    expect(() => canonicalHash({ value: Number.POSITIVE_INFINITY })).toThrow(TypeError);
  });

  it("converts every source sheet with provenance and explicit blockers", () => {
    expect(TF1_SIMULATION_TEMPLATES).toHaveLength(36);
    expect(new Set(TF1_SIMULATION_TEMPLATES.map((template) => template.id)).size).toBe(36);
    expect(
      TF1_SIMULATION_TEMPLATES.every((template) =>
        template.source.path.startsWith("balance-testing/"),
      ),
    ).toBe(true);
    expect(TF1_SIMULATION_TEMPLATES.every((template) => template.source.text.includes("TF1"))).toBe(
      true,
    );
    expect(
      TF1_SIMULATION_TEMPLATES.every((template) => template.loadoutOverlay?.status === "draft"),
    ).toBe(true);
    expect(TF1_SIMULATION_TEMPLATES.every((template) => template.moveIds.length >= 14)).toBe(true);
    expect(TF1_SIMULATION_TEMPLATES.every((template) => template.itemIds.length > 0)).toBe(true);
    expect(TF1_SIMULATION_TEMPLATES.every((template) => template.raceTraitIds.length > 0)).toBe(
      true,
    );
    expect(
      TF1_SIMULATION_TEMPLATES.every((template) => validateSimulationTemplate(template).ok),
    ).toBe(true);
    expect(TF1_SIMULATION_TEMPLATES[0]?.moveIds.slice(0, 3)).toEqual([
      "move-akaikaru-adrenaline-rush-mastery",
      "move-akaikaru-swift-reaction",
      "move-akaikaru-speed-demon",
    ]);
    expect(TF1_SIMULATION_TEMPLATES[0]).toMatchObject({
      itemIds: ["item-equipment-nanomachine", "item-technology-self-destruct-device"],
      raceTraitIds: ["race-trait-bio-androids-regeneration", "race-trait-saiyans-saiyan-might"],
      startingKi: 5,
      maximumKi: 10,
      specialization: { type: "strength", level: 1, damageType: "physical" },
    });
    expect(TF1_SIMULATION_TEMPLATES[10]).toMatchObject({ startingKi: 6 });
    expect(TF1_SIMULATION_TEMPLATES[10]?.raceTraitIds).toEqual([
      "race-trait-bio-androids-regeneration",
      "race-trait-saiyans-saiyan-might",
      "race-trait-namek-meditative-preparation",
    ]);
    expect(TF1_SIMULATION_TEMPLATES[31]?.itemQuantities).toEqual({
      "item-equipment-first-aid-kit": 2,
    });
  });

  it("materializes every TF1 template and crosses the normal combat boundary", () => {
    const materialized = TF1_SIMULATION_TEMPLATES.map((template) =>
      materializeSimulationTemplate(template, CANONICAL_COMBAT_MECHANICS_VIEW),
    );
    expect(materialized.every((result) => result.ok)).toBe(true);
    const runtime = createCombatRuntime(CANONICAL_COMBAT_MECHANICS_VIEW);
    const setupResults = materialized.map((result, index) =>
      result.ok
        ? runtime.createFight(
            { mode: "spar", combatants: [result.value.input, result.value.input] },
            {
              random: new SeededRandomSource(index + 1),
              clock: new FixedClock(new Date("2026-01-01T00:00:00.000Z")),
              ids: new BranchCombatIdSource([`tf1-boundary-${index + 1}`]),
              mechanicsView: CANONICAL_COMBAT_MECHANICS_VIEW,
            },
          )
        : result,
    );
    expect(setupResults.every((result) => result.ok)).toBe(true);
    const template = TF1_SIMULATION_TEMPLATES[0]!;
    const scenario = createScenario({
      id: "simulation-scenario:tf1-boundary",
      family: "symmetric-control",
      checkpointId: "tf1",
      templateAId: template.id,
      templateBId: template.id,
      variantId: "simulation-variant:baseline",
      retention: "summary",
      limits: { maximumTurns: 1, maximumTransitions: 8, semanticNoProgressLimit: 4 },
      stoppingPolicy: "continue",
      deferred: false,
    });
    const result = runSimulationFight({
      schemaVersion: "simulation-contracts:v1",
      runId: "simulation-run:tf1-boundary",
      scenario,
      templateA: template,
      templateB: template,
      profileA: SIMULATION_QUALITY_PROFILE,
      profileB: SIMULATION_QUALITY_PROFILE,
      rootSeed: 1,
      fixedTime: new Date("2026-01-01T00:00:00.000Z"),
      mechanicsView: CANONICAL_COMBAT_MECHANICS_VIEW,
    });
    expect(result.failure).toMatchObject({
      type: "exhausted-safeguard",
      reason: "maximum-turns",
    });
  }, 30_000);

  it("materializes all synthetic archetypes without creating runtime state", () => {
    const templates = createSyntheticArchetypes();
    expect(templates).toHaveLength(12);
    for (const template of templates) {
      const result = materializeSimulationTemplate(template);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.value.input.moveIds).toEqual(template.moveIds);
      expect(Object.isFrozen(result.value.input)).toBe(true);
    }
  });

  it("creates a typed static coverage record for every canonical move", () => {
    const dataset = createSimulationMoveCoverageDataset();
    expect(dataset.records.length).toBeGreaterThan(0);
    expect(new Set(dataset.records.map((record) => record.moveId)).size).toBe(
      dataset.records.length,
    );
    expect(dataset.records.every((record) => record.naturalStatus === "unobserved")).toBe(true);
    expect(dataset.records.every((record) => record.capabilityIdentity.length > 0)).toBe(true);
  });

  it("creates isolated immutable mechanics variants and custom review dossiers", () => {
    const base = CANONICAL_COMBAT_MECHANICS_VIEW;
    const move = base.moves[0]!;
    const variant = createSimulationVariant(base, {
      variantId: "simulation-variant:cost-adjustment",
      label: "Cost adjustment",
      patches: [
        {
          type: "override-move",
          moveId: move.id,
          fields: { kiCost: (move.kiCost ?? 0) + 1 },
        },
      ],
    });
    expect(variant.mechanicsView.identity.contentHash).not.toBe(base.identity.contentHash);
    expect(variant.diff[0].moveId).toBe(move.id);
    expect(base.indexes.moves.get(move.id)).toEqual(move);
    const variantRequest = applySimulationVariantToRequest(
      {
        schemaVersion: "simulation-contracts:v1",
        runId: "simulation-run:variant",
        scenario: createScenario({
          id: "simulation-scenario:variant",
          family: "symmetric-control",
          checkpointId: "early",
          templateAId: "simulation-template:synthetic-balanced",
          templateBId: "simulation-template:synthetic-balanced",
          variantId: "simulation-variant:baseline",
          retention: "summary",
          limits: { maximumTurns: 1, maximumTransitions: 1, semanticNoProgressLimit: 1 },
          stoppingPolicy: "continue",
          deferred: false,
        }),
        templateA: createSyntheticArchetypes()[0],
        templateB: createSyntheticArchetypes()[0],
        profileA: SIMULATION_QUALITY_PROFILE,
        profileB: SIMULATION_QUALITY_PROFILE,
        rootSeed: 1,
        fixedTime: new Date("2026-01-01T00:00:00.000Z"),
        mechanicsView: base,
      },
      variant,
    );
    expect(variantRequest.mechanicsView.identity).toEqual(variant.mechanicsView.identity);
    const review = reviewCustomMove({
      schemaVersion: "simulation-custom-draft:v1",
      draftId: "custom-move-draft:review",
      version: 1,
      move: { ...move, id: "custom-move:review" },
      rationale: "Test draft",
      intendedContext: "single-target comparison",
      proposedSourceText: "typed fixture",
    });
    expect(review.preflight.classification).toBe("executable");
    expect(review.experimentPlan?.mirrored).toBe(true);
  });

  it("expands and closes deterministic synthetic coverage", () => {
    const templates = ALL_SIMULATION_TEMPLATES();
    const scenario = createScenario({
      id: "simulation-scenario:closure",
      family: "symmetric-control",
      checkpointId: "early",
      templateAId: templates.at(-1)!.id,
      templateBId: templates.at(-1)!.id,
      variantId: "simulation-variant:baseline",
      retention: "summary",
      limits: { maximumTurns: 1, maximumTransitions: 1, semanticNoProgressLimit: 1 },
      stoppingPolicy: "continue",
      deferred: false,
    });
    const closure = createSimulationClosureReport(templates, [scenario]);
    expect(closure.sourceSheetCount).toBe(36);
    expect(closure.syntheticArchetypeCount).toBe(12);
    expect(closure.rows).toHaveLength(48);
    const customCheckpoints = createSimulationCheckpointCatalog([
      { id: "custom", label: "Custom", order: 0 },
    ]);
    const expansion = expandSimulationScenarios(
      templates,
      ["symmetric-control"],
      scenario.limits,
      customCheckpoints,
    );
    expect(expansion.checkpointCatalogHash).toBe(customCheckpoints.catalogHash);
    expect(expansion.scenarios[0].checkpointId).toBe("custom");

    const fullExpansion = expandSimulationScenarios(templates);
    expect(new Set(fullExpansion.scenarios.map((candidate) => candidate.family))).toEqual(
      new Set(SIMULATION_SCENARIO_FAMILIES),
    );
    expect(fullExpansion.scenarios.every((candidate) => candidate.note !== undefined)).toBe(true);
    expect(
      fullExpansion.scenarios.find((candidate) => candidate.family === "transformation-timing"),
    ).toMatchObject({ checkpointId: "tf1" });
    const syntheticIds = new Set(createSyntheticArchetypes().map((template) => template.id));
    expect(
      fullExpansion.scenarios.every(
        (candidate) =>
          syntheticIds.has(candidate.templateAId) && syntheticIds.has(candidate.templateBId),
      ),
    ).toBe(true);
    const canonicalBefore = canonicalHash(CANONICAL_COMBAT_MECHANICS_VIEW);
    ALL_SIMULATION_TEMPLATES();
    expect(canonicalHash(CANONICAL_COMBAT_MECHANICS_VIEW)).toBe(canonicalBefore);
  });

  it("runs a deterministic synthetic fight through the public boundaries", () => {
    const template = createSyntheticArchetypes()[0];
    const scenario = createScenario({
      id: "simulation-scenario:runner",
      family: "symmetric-control",
      checkpointId: "early",
      templateAId: template.id,
      templateBId: template.id,
      variantId: "simulation-variant:baseline",
      retention: "diagnostic",
      limits: { maximumTurns: 2, maximumTransitions: 30, semanticNoProgressLimit: 3 },
      stoppingPolicy: "continue",
      deferred: false,
    });
    const request = {
      schemaVersion: "simulation-contracts:v1" as const,
      runId: "simulation-run:runner",
      scenario,
      templateA: template,
      templateB: template,
      profileA: SIMULATION_QUALITY_PROFILE,
      profileB: SIMULATION_QUALITY_PROFILE,
      rootSeed: 7,
      fixedTime: new Date("2026-01-01T00:00:00.000Z"),
      mechanicsView: CANONICAL_COMBAT_MECHANICS_VIEW,
    };
    const first = runSimulationFight(request);
    const second = runSimulationFight(request);
    expect(first.terminationReason).toBe("maximum-turns");
    expect(first.stateHash).toBe(second.stateHash);
    expect(first.eventHash).toBe(second.eventHash);
    expect(first.decisionHash).toBe(second.decisionHash);
    expect(first.diagnostics?.selectedDecisions.length).toBeGreaterThan(0);
    const summaryRun = runSimulationFight({
      ...request,
      scenario: { ...scenario, retention: "summary" },
    });
    expect(summaryRun.stateHash).toBe(first.stateHash);
    expect(summaryRun.eventHash).toBe(first.eventHash);
    expect(summaryRun.decisionHash).toBe(first.decisionHash);
    expect(summaryRun.transitions).toHaveLength(0);
    expect(first.replay.replayVersion).toBe("simulation-replay:v1");
    expect(simulationReplayRecordSchema.safeParse(first.replay).success).toBe(true);
    expect(verifySimulationReplay(first.replay, request)).toMatchObject({ ok: true });

    const changedDecisionReplay = {
      ...first.replay,
      decisions: [...first.replay.decisions, first.replay.decisions[0]],
    };
    expect(verifySimulationReplay(changedDecisionReplay, request)).toMatchObject({
      ok: false,
      divergence: { type: "ai", path: "decisions.length" },
    });

    const changedTransitionReplay = {
      ...first.replay,
      transitionHashes: ["tampered", ...first.replay.transitionHashes.slice(1)],
    };
    expect(verifySimulationReplay(changedTransitionReplay, request)).toMatchObject({
      ok: false,
      divergence: { type: "combat", path: "transitionHashes[0]" },
    });

    expect(
      verifySimulationReplay({ ...first.replay, replayVersion: "simulation-replay:v0" }, request),
    ).toMatchObject({
      ok: false,
      divergence: { type: "schema" },
    });

    const series = runSimulationSeries({
      schemaVersion: "simulation-contracts:v1",
      seriesId: "simulation-series:runner",
      baseRequest: request,
      iterations: 1,
      mirrored: true,
      stoppingPolicy: "continue",
      concurrency: 2,
    });
    expect(series.specs).toHaveLength(2);
    expect(series.specs[0].iteration).toBe(0);
    expect(series.specs[1].mirror).toBe("mirrored");
    expect(series.specs[1].request.templateA.id).toBe(series.specs[0].request.templateB.id);
    expect(series.results).toHaveLength(2);
    expect(series.incompletePairCount).toBe(1);
    const batched = runSimulationSeriesBatches(
      {
        schemaVersion: "simulation-contracts:v1",
        seriesId: "simulation-series:batched",
        baseRequest: request,
        iterations: 1,
        mirrored: true,
        stoppingPolicy: "continue",
      },
      { batchSize: 1 },
    );
    expect(batched.batchCount).toBe(2);
    expect(batched.results).toBeUndefined();
    expect(batched.accumulator.completedCount).toBe(0);
    expect(series.checkpoint.entries).toHaveLength(2);
    expect(
      createSimulationCheckpoint(
        {
          seriesId: "simulation-series:runner",
          baseRequest: request,
          iterations: 1,
          mirrored: true,
          stoppingPolicy: "continue",
        },
        series,
      ),
    ).toEqual(series.checkpoint);
    expect(
      validateSimulationCheckpoint(
        {
          seriesId: "simulation-series:runner",
          baseRequest: request,
          iterations: 1,
          mirrored: true,
          stoppingPolicy: "continue",
        },
        series.checkpoint,
      ),
    ).toMatchObject({ ok: true });
    const resumed = runSimulationSeries({
      schemaVersion: "simulation-contracts:v1",
      seriesId: "simulation-series:runner",
      baseRequest: request,
      iterations: 1,
      mirrored: true,
      stoppingPolicy: "continue",
      checkpoint: series.checkpoint,
    });
    expect(resumed.resumedFightCount).toBe(0);
    expect(resumed.results).toHaveLength(2);
    expect(resumed.incompletePairCount).toBe(1);
    expect(
      runSimulationMatrix({
        schemaVersion: "simulation-contracts:v1",
        matrixId: "simulation-matrix:runner",
        series: [
          {
            schemaVersion: "simulation-contracts:v1",
            seriesId: "simulation-series:matrix-runner",
            baseRequest: request,
            iterations: 1,
            mirrored: false,
            stoppingPolicy: "continue",
          },
        ],
        maximumFights: 1,
      }).estimatedFightCount,
    ).toBe(1);
    expect(() =>
      runSimulationSeries({
        schemaVersion: "simulation-contracts:v1",
        seriesId: "simulation-series:runner",
        baseRequest: { ...request, rootSeed: 8 },
        iterations: 1,
        mirrored: true,
        stoppingPolicy: "continue",
        checkpoint: series.checkpoint,
      }),
    ).toThrow(RangeError);
  }, 20_000);

  it("contains invalid, cancelled, and deferred requests without contaminating later fights", () => {
    const synthetic = createSyntheticArchetypes()[0];
    const blocked = {
      ...TF1_SIMULATION_TEMPLATES[0],
      moveIds: ["move:missing"],
    };
    const scenarioFor = (id: string, deferred = false) =>
      createScenario({
        id: `simulation-scenario:${id}`,
        family: deferred ? "custom-move-addition" : "symmetric-control",
        checkpointId: "early",
        templateAId: synthetic.id,
        templateBId: synthetic.id,
        variantId: "simulation-variant:baseline",
        retention: "summary",
        limits: { maximumTurns: 1, maximumTransitions: 1, semanticNoProgressLimit: 1 },
        stoppingPolicy: "continue",
        deferred,
      });
    const requestFor = (template: typeof synthetic, scenario = scenarioFor("containment")) => ({
      schemaVersion: "simulation-contracts:v1" as const,
      runId: `simulation-run:${scenario.id.slice("simulation-scenario:".length)}`,
      scenario,
      templateA: template,
      templateB: template,
      profileA: SIMULATION_QUALITY_PROFILE,
      profileB: SIMULATION_QUALITY_PROFILE,
      rootSeed: 9,
      fixedTime: new Date("2026-01-01T00:00:00.000Z"),
      mechanicsView: CANONICAL_COMBAT_MECHANICS_VIEW,
    });
    const cancelled = runSimulationFight(requestFor(synthetic), { isCancelled: () => true });
    expect(cancelled.terminationReason).toBe("cancelled");
    expect(
      runSimulationFight(requestFor(synthetic, scenarioFor("deferred", true))).terminationReason,
    ).toBe("unsupported-scope");
    const coordinated = runSimulationRequests({
      requests: [requestFor(blocked, scenarioFor("blocked")), requestFor(synthetic)],
      stoppingPolicy: "continue",
    });
    expect(coordinated.results).toHaveLength(2);
    expect(coordinated.results[0]).toMatchObject({ ok: false, error: { type: "malformed-input" } });
    expect(coordinated.results[1]).toMatchObject({
      ok: false,
      error: { type: "exhausted-safeguard", reason: "maximum-turns" },
    });

    const progress: number[] = [];
    const scheduled = runSimulationRequests({
      requests: [requestFor(synthetic), requestFor(synthetic, scenarioFor("second"))],
      stoppingPolicy: "continue",
      concurrency: 2,
      onProgress: ({ completed }) => progress.push(completed),
    });
    const sequential = runSimulationRequests({
      requests: [requestFor(synthetic), requestFor(synthetic, scenarioFor("second"))],
      stoppingPolicy: "continue",
      concurrency: 1,
    });
    expect(progress).toEqual([1, 2]);
    expect(scheduled.results.map((result) => result.ok)).toEqual(
      sequential.results.map((result) => result.ok),
    );
    expect(
      scheduled.results.map((result) => (result.ok ? result.value.stateHash : result.error)),
    ).toEqual(
      sequential.results.map((result) => (result.ok ? result.value.stateHash : result.error)),
    );
    expect(() =>
      runSimulationRequests({ requests: [], stoppingPolicy: "continue", concurrency: 0 }),
    ).toThrow(RangeError);
  });
});
