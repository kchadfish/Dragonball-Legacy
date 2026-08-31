import {
  legalDecisionEvaluatorRegistry,
  legalDecisionTypes,
  pendingDecisionEvaluatorRegistry,
  pendingDecisionTypes,
  responseShapeEvaluatorRegistry,
  responseShapeTypes,
  immediateUtilityEvaluatorRegistry,
  IMMEDIATE_UTILITY_EVALUATOR,
  type AiEvaluatorRegistryEntry,
  type ResponseShapeType,
  contextualEvaluatorRegistryEntries,
} from "../packages/ai-engine/src/index.js";
import {
  registeredScopeDecisions,
  type ScopeDecision,
} from "../packages/combat-engine/src/index.js";
import fixture from "../docs/architecture/ai-engine-legal-decision-fixtures.json" with { type: "json" };

export interface AiCapabilityMatrixRow extends AiEvaluatorRegistryEntry {
  readonly kind: "legal-decision" | "pending-decision" | "response-shape";
}

export interface AiCoverageEvidence {
  readonly id: string;
  readonly kind: "legal-decision" | "pending-decision" | "response-shape";
  readonly surface: string;
  readonly source: string;
  readonly behavior: string;
}

export interface AiCapabilityGap {
  readonly roadmapId: string;
  readonly capability: string;
  readonly status: "complete" | "ready" | "deferred";
  readonly prerequisite: string;
  readonly proofTarget: string;
  readonly proof: { readonly status: "verified" | "ready" | "deferred"; readonly evidence: string };
}

export interface AiImmediateEvaluatorRow {
  readonly id: string;
  readonly code: string;
  readonly evaluator: typeof IMMEDIATE_UTILITY_EVALUATOR;
  readonly status: "complete";
  readonly proof: string;
}

export interface AiContextualEvaluatorRow {
  readonly id: string;
  readonly code: string;
  readonly evaluator: { readonly id: string; readonly version: string };
  readonly status: "complete";
  readonly proof: string;
}

export interface AiCapabilityMatrix {
  readonly schemaVersion: "ai-engine-capability-matrix:v6";
  readonly scopeVersion: string;
  readonly generatedAt: string;
  readonly authority: Readonly<Record<string, string>>;
  readonly legalSurfaces: readonly AiCapabilityMatrixRow[];
  readonly pendingSurfaces: readonly AiCapabilityMatrixRow[];
  readonly responseShapes: readonly AiCapabilityMatrixRow[];
  readonly immediateEvaluators: readonly AiImmediateEvaluatorRow[];
  readonly contextualEvaluators: readonly AiContextualEvaluatorRow[];
  readonly exclusions: readonly ScopeDecision[];
  readonly coverageEvidence: readonly AiCoverageEvidence[];
  readonly capabilityGaps: readonly AiCapabilityGap[];
  readonly consumerProofs: readonly {
    readonly id: string;
    readonly status: "verified";
    readonly evidence: string;
  }[];
  readonly invariants: readonly { readonly id: string; readonly evidence: string }[];
  readonly autonomousScenarios: readonly { readonly id: string; readonly evidence: string }[];
}

interface AiFixture {
  readonly scopeVersion: string;
  readonly generatedAt: string;
  readonly authority: Readonly<Record<string, string>>;
  readonly ordinaryLegalDecisionFixtures: readonly {
    readonly id: string;
    readonly sourceTest: string;
    readonly sourceBehavior: string;
    readonly legalDecisions: readonly { readonly type: string }[];
  }[];
  readonly pendingDecisionFixtures: readonly {
    readonly id: string;
    readonly sourceTest: string;
    readonly sourceBehavior: string;
    readonly pendingDecision: { readonly type: string };
  }[];
  readonly selectionCardinalityFixtures: readonly {
    readonly selection: { readonly type: string };
    readonly sourceTest: string;
    readonly responseStatus: string;
  }[];
  readonly declaredPendingTypesWithoutCurrentPublicTransitionFixture: readonly string[];
}

const sourceFixture = fixture as AiFixture;

const entryRows = (
  kind: AiCapabilityMatrixRow["kind"],
  entries: readonly AiEvaluatorRegistryEntry[],
): readonly AiCapabilityMatrixRow[] => entries.map((entry) => ({ ...entry, kind }));

const responseEvidenceFor = (type: ResponseShapeType): AiCoverageEvidence => {
  const source = sourceFixture.selectionCardinalityFixtures.find(
    (candidate) => candidate.selection.type === type,
  );
  if (source !== undefined)
    return {
      id: `fixture:response-${type}`,
      kind: "response-shape",
      surface: type,
      source: source.sourceTest,
      behavior: source.responseStatus,
    };
  return {
    id: "fixture:engine-authored-options",
    kind: "response-shape",
    surface: type,
    source: "docs/architecture/ai-engine-legal-decision-fixtures.json",
    behavior: "engine-authored options have no declarative selection metadata",
  };
};

export const createAiCapabilityMatrix = (): AiCapabilityMatrix => {
  const legalSurfaces = entryRows("legal-decision", Object.values(legalDecisionEvaluatorRegistry));
  const pendingSurfaces = entryRows(
    "pending-decision",
    Object.values(pendingDecisionEvaluatorRegistry),
  );
  const responseShapes = entryRows("response-shape", Object.values(responseShapeEvaluatorRegistry));
  const coverageEvidence: AiCoverageEvidence[] = [];
  for (const fixtureEntry of sourceFixture.ordinaryLegalDecisionFixtures) {
    for (const decision of fixtureEntry.legalDecisions) {
      coverageEvidence.push({
        id: `${fixtureEntry.id}:legal-${decision.type}`,
        kind: "legal-decision",
        surface: decision.type,
        source: fixtureEntry.sourceTest,
        behavior: fixtureEntry.sourceBehavior,
      });
    }
  }
  for (const fixtureEntry of sourceFixture.pendingDecisionFixtures)
    coverageEvidence.push({
      id: `${fixtureEntry.id}:pending-${fixtureEntry.pendingDecision.type}`,
      kind: "pending-decision",
      surface: fixtureEntry.pendingDecision.type,
      source: fixtureEntry.sourceTest,
      behavior: fixtureEntry.sourceBehavior,
    });
  coverageEvidence.push(...responseShapeTypes.map(responseEvidenceFor));
  for (const row of legalSurfaces)
    if (!coverageEvidence.some((entry) => entry.kind === row.kind && entry.surface === row.surface))
      coverageEvidence.push({
        id: `registry:${row.id}`,
        kind: row.kind,
        surface: row.surface,
        source: row.focusedProof,
        behavior: "public legal-decision union member accounted by the baseline evaluator",
      });
  for (const row of pendingSurfaces)
    if (!coverageEvidence.some((entry) => entry.kind === row.kind && entry.surface === row.surface))
      coverageEvidence.push({
        id: `registry:${row.id}`,
        kind: row.kind,
        surface: row.surface,
        source: row.focusedProof,
        behavior: "closed pending-decision union member accounted by the baseline evaluator",
      });

  return {
    schemaVersion: "ai-engine-capability-matrix:v6",
    scopeVersion: sourceFixture.scopeVersion,
    generatedAt: sourceFixture.generatedAt,
    authority: {
      ...sourceFixture.authority,
      publicDescriptors: "packages/combat-engine/src/decision-descriptors.ts",
    },
    legalSurfaces,
    pendingSurfaces,
    responseShapes,
    immediateEvaluators: immediateUtilityEvaluatorRegistry.map((code) => ({
      id: `ai-evaluator:${code}`,
      code,
      evaluator: IMMEDIATE_UTILITY_EVALUATOR,
      status: "complete" as const,
      proof: "packages/ai-engine/src/immediate-utility.test.ts",
    })),
    contextualEvaluators: contextualEvaluatorRegistryEntries,
    exclusions: registeredScopeDecisions,
    coverageEvidence: coverageEvidence.sort((left, right) => left.id.localeCompare(right.id)),
    capabilityGaps: [
      {
        roadmapId: "AI-200",
        capability: "structured score-factor and diagnostic foundation",
        status: "complete",
        prerequisite: "Phase 1 accounting and AI-030 baseline",
        proofTarget: "focused score-factor and diagnostic tests",
        proof: { status: "verified", evidence: "packages/ai-engine/src/immediate-utility.test.ts" },
      },
      {
        roadmapId: "AI-210 through AI-240",
        capability: "resource, terminal, action-economy utility, and baseline chooser",
        status: "complete",
        prerequisite: "AI-200",
        proofTarget: "authoritative feature and chooser behavior tests",
        proof: { status: "verified", evidence: "packages/ai-engine/src/immediate-utility.test.ts" },
      },
      {
        roadmapId: "AI-300 through AI-340",
        capability: "state, status, transformation, scarcity, and pending-choice context",
        status: "complete",
        prerequisite: "AI-200 through AI-240",
        proofTarget: "state-aware evaluator and pending parity tests",
        proof: {
          status: "verified",
          evidence: "packages/ai-engine/src/contextual-utility.test.ts",
        },
      },
      {
        roadmapId: "AI-400 through AI-430",
        capability: "typed personality, difficulty, and controlled variation",
        status: "complete",
        prerequisite: "AI-200 through AI-340",
        proofTarget: "profile, noise, and terminal-protection tests",
        proof: { status: "verified", evidence: "packages/ai-engine/src/phases-4-8.test.ts" },
      },
      {
        roadmapId: "AI-500 through AI-540",
        capability: "descriptor-driven setup, combo, denial, and advisory hints",
        status: "complete",
        prerequisite: "AI-400 through AI-430",
        proofTarget: "setup graph and validated hint tests",
        proof: {
          status: "verified",
          evidence:
            "packages/ai-engine/src/phases-4-8.test.ts; packages/game-data/src/ai-hints.test.ts",
        },
      },
      {
        roadmapId: "AI-600 through AI-640",
        capability: "combat-owned outcome estimation, expected utility, and pruning",
        status: "complete",
        prerequisite: "PRE-030 and AI-500 through AI-540",
        proofTarget: "outcome classification, uncertainty, and pruning tests",
        proof: { status: "verified", evidence: "packages/ai-engine/src/phases-4-8.test.ts" },
      },
      {
        roadmapId: "AI-700 through AI-750",
        capability: "isolated bounded shallow lookahead and pending expansion",
        status: "complete",
        prerequisite: "PRE-040 and AI-600 through AI-640",
        proofTarget: "branch isolation and deterministic budget tests",
        proof: {
          status: "verified",
          evidence:
            "packages/ai-engine/src/phases-4-8.test.ts; packages/combat-engine/src/analysis.test.ts",
        },
      },
      {
        roadmapId: "AI-800 through AI-840",
        capability: "structured diagnostics, explanations, retention, and replay",
        status: "complete",
        prerequisite: "AI-700 through AI-750",
        proofTarget: "diagnostic retention and replay identity tests",
        proof: { status: "verified", evidence: "packages/ai-engine/src/phases-4-8.test.ts" },
      },
      {
        roadmapId: "AI-900 through AI-930",
        capability:
          "validated NPC policy phases, tactical priorities, and public transition adapter",
        status: "complete",
        prerequisite: "AI-840",
        proofTarget: "NPC consumer readiness and legal-object handoff",
        proof: { status: "verified", evidence: "packages/npc-ai/src/index.test.ts" },
      },
      {
        roadmapId: "AI-1000 through AI-1040",
        capability:
          "canonical selector, deterministic bounded consumer mode, reduced diagnostics, and AI-vs-AI proof",
        status: "complete",
        prerequisite: "AI-900 through AI-930",
        proofTarget: "consumer isolation and bounded autonomous driver",
        proof: { status: "verified", evidence: "packages/ai-engine/src/phases-9-11.test.ts" },
      },
      {
        roadmapId: "AI-1100 through AI-1150",
        capability:
          "decision-quality closure, deterministic invariants, scenarios, and final accounting",
        status: "complete",
        prerequisite: "AI-1000 through AI-1040",
        proofTarget: "closure validator and representative quality cases",
        proof: { status: "verified", evidence: "packages/ai-engine/src/phases-9-11.test.ts" },
      },
    ],
    consumerProofs: [
      { id: "npc-adapter", status: "verified", evidence: "packages/npc-ai/src/index.test.ts" },
      {
        id: "canonical-ai-selector",
        status: "verified",
        evidence: "packages/ai-engine/src/phases-9-11.test.ts",
      },
      {
        id: "public-combat-handoff",
        status: "verified",
        evidence: "packages/npc-ai/src/index.test.ts",
      },
    ],
    invariants: [
      { id: "legal-subset", evidence: "packages/ai-engine/src/phases-9-11.test.ts" },
      { id: "empty-set", evidence: "packages/ai-engine/src/safe-fallback.test.ts" },
      { id: "input-order", evidence: "packages/ai-engine/src/contextual-utility.test.ts" },
      {
        id: "state-and-catalog-immutability",
        evidence: "packages/ai-engine/src/phases-9-11.test.ts",
      },
      { id: "diagnostic-invariance", evidence: "packages/ai-engine/src/phases-9-11.test.ts" },
      { id: "same-seed-replay", evidence: "packages/ai-engine/src/phases-4-8.test.ts" },
      { id: "live-rng-isolation", evidence: "packages/ai-engine/src/phases-9-11.test.ts" },
      { id: "branch-and-batch-isolation", evidence: "packages/ai-engine/src/phases-4-8.test.ts" },
      { id: "id-independent-reasoning", evidence: "packages/ai-engine/src/phases-9-11.test.ts" },
      { id: "safe-search-exhaustion", evidence: "packages/ai-engine/src/phases-4-8.test.ts" },
      {
        id: "pending-choice-parity",
        evidence: "packages/ai-engine/src/contextual-utility.test.ts",
      },
    ],
    autonomousScenarios: [
      { id: "balanced", evidence: "packages/ai-engine/src/phases-9-11.test.ts" },
      { id: "power-vs-dexterity", evidence: "packages/ai-engine/src/phases-9-11.test.ts" },
      { id: "defense-vs-burst", evidence: "packages/ai-engine/src/phases-9-11.test.ts" },
      { id: "status-vs-damage", evidence: "packages/ai-engine/src/phases-9-11.test.ts" },
      {
        id: "ki-denial-vs-efficient-offense",
        evidence: "packages/ai-engine/src/phases-9-11.test.ts",
      },
      { id: "transformation-heavy", evidence: "packages/ai-engine/src/phases-9-11.test.ts" },
      { id: "restricted-use-pressure", evidence: "packages/ai-engine/src/phases-9-11.test.ts" },
    ],
  };
};

const cell = (value: string | readonly string[]): string =>
  (Array.isArray(value) ? value.join("; ") : value).replaceAll("|", "\\|");

const renderRows = (rows: readonly AiCapabilityMatrixRow[]): string =>
  rows
    .map(
      (row) =>
        `| ${cell(row.id)} | ${cell(row.surface)} | ${cell(row.classification)} | ${cell(row.roadmapOwner)} | ${cell(row.featureExtractor)} | ${cell(row.prerequisites)} | ${cell(row.representativeScenario)} | ${cell(row.focusedProof)} | ${cell(row.proofTarget ?? "")} |`,
    )
    .join("\n");

const renderSection = (title: string, rows: readonly AiCapabilityMatrixRow[]): string =>
  `## ${title}\n\n| ID | Surface | Classification | Roadmap owner | Feature extractor | Prerequisites | Representative scenario | Focused proof | Proof target |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${renderRows(rows)}`;

export const renderAiCapabilityMatrix = (matrix = createAiCapabilityMatrix()): string => {
  const evidence = matrix.coverageEvidence
    .map(
      (entry) =>
        `| ${cell(entry.id)} | ${cell(entry.kind)} | ${cell(entry.surface)} | ${cell(entry.source)} | ${cell(entry.behavior)} |`,
    )
    .join("\n");
  const exclusions = matrix.exclusions
    .map((entry) => `| ${cell(entry.id)} | ${cell(entry.category)} | ${cell(entry.reason)} |`)
    .join("\n");
  const gaps = matrix.capabilityGaps
    .map(
      (entry) =>
        `| ${cell(entry.roadmapId)} | ${cell(entry.capability)} | ${cell(entry.status)} | ${cell(entry.prerequisite)} | ${cell(entry.proofTarget)} | ${cell(`${entry.proof.status}: ${entry.proof.evidence}`)} |`,
    )
    .join("\n");
  const consumerProofs = matrix.consumerProofs
    .map((entry) => `| ${cell(entry.id)} | ${cell(entry.status)} | ${cell(entry.evidence)} |`)
    .join("\n");
  const invariants = matrix.invariants
    .map((entry) => `| ${cell(entry.id)} | ${cell(entry.evidence)} |`)
    .join("\n");
  const scenarios = matrix.autonomousScenarios
    .map((entry) => `| ${cell(entry.id)} | ${cell(entry.evidence)} |`)
    .join("\n");
  return `# AI-engine capability matrix

Generated from scope \`${matrix.scopeVersion}\` on ${matrix.generatedAt}. This is an accounting artifact; combat-engine descriptors remain authoritative for mechanics.

## Authority

| Record | Path |
| --- | --- |
${Object.entries(matrix.authority)
  .map(([key, value]) => `| ${cell(key)} | ${cell(value)} |`)
  .join("\n")}

${renderSection("Legal decision surfaces", matrix.legalSurfaces)}

${renderSection("Pending decision surfaces", matrix.pendingSurfaces)}

${renderSection("Response shapes", matrix.responseShapes)}

## Immediate utility evaluators

| ID | Code | Evaluator | Status | Proof |
| --- | --- | --- | --- | --- |
${matrix.immediateEvaluators.map((entry) => `| ${cell(entry.id)} | ${cell(entry.code)} | ${cell(`${entry.evaluator.id}@${entry.evaluator.version}`)} | ${cell(entry.status)} | ${cell(entry.proof)} |`).join("\n")}

## Contextual evaluators

| ID | Code | Evaluator | Status | Proof |
| --- | --- | --- | --- | --- |
${matrix.contextualEvaluators.map((entry) => `| ${cell(entry.id)} | ${cell(entry.code)} | ${cell(`${entry.evaluator.id}@${entry.evaluator.version}`)} | ${cell(entry.status)} | ${cell(entry.proof)} |`).join("\n")}

## Approved exclusions

| Scope decision ID | Category | Reason |
| --- | --- | --- |
${exclusions}

## Coverage evidence

| ID | Kind | Surface | Source | Behavior |
| --- | --- | --- | --- | --- |
${evidence}

## Capability gaps by reusable roadmap capability

| Roadmap | Capability | Status | Prerequisite | Proof target | Proof |
| --- | --- | --- | --- | --- | --- |
${gaps}

## Consumer proofs

| Consumer proof | Status | Evidence |
| --- | --- | --- |
${consumerProofs}

## Determinism and isolation invariants

| Invariant | Evidence |
| --- | --- |
${invariants}

## Autonomous scenario coverage

| Scenario | Evidence |
| --- | --- |
${scenarios}

## Accounting totals

| Surface group | Count |
| --- | ---: |
| Legal decisions | ${matrix.legalSurfaces.length} |
| Pending decisions | ${matrix.pendingSurfaces.length} |
| Response shapes | ${matrix.responseShapes.length} |
| Approved exclusions | ${matrix.exclusions.length} |
| Coverage evidence rows | ${matrix.coverageEvidence.length} |
`;
};

if (!process.env.VITEST && process.argv[1]?.endsWith("ai-capability-matrix.ts"))
  process.stdout.write(renderAiCapabilityMatrix());

export { legalDecisionTypes, pendingDecisionTypes, responseShapeTypes };
