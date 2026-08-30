import {
  legalDecisionTypes,
  pendingDecisionTypes,
  responseShapeTypes,
} from "../packages/ai-engine/src/index.js";
import { scopeDecisionForId } from "../packages/combat-engine/src/index.js";

import {
  createAiCapabilityMatrix,
  type AiCapabilityMatrix,
  type AiCapabilityMatrixRow,
} from "./ai-capability-matrix.js";

const expectedByKind = {
  "legal-decision": legalDecisionTypes,
  "pending-decision": pendingDecisionTypes,
  "response-shape": responseShapeTypes,
} as const;

const rowsFor = (
  matrix: AiCapabilityMatrix,
  kind: AiCapabilityMatrixRow["kind"],
): readonly AiCapabilityMatrixRow[] => {
  if (kind === "legal-decision") return matrix.legalSurfaces;
  if (kind === "pending-decision") return matrix.pendingSurfaces;
  return matrix.responseShapes;
};

const checkRows = (
  matrix: AiCapabilityMatrix,
  kind: AiCapabilityMatrixRow["kind"],
  issues: string[],
): void => {
  const rows = rowsFor(matrix, kind);
  const expected = expectedByKind[kind] as readonly string[];
  const actual = rows.map((row) => row.surface);
  for (const surface of expected)
    if (actual.filter((candidate) => candidate === surface).length !== 1)
      issues.push(`${kind} surface ${surface} must be registered exactly once.`);
  for (const surface of actual)
    if (!expected.includes(surface)) issues.push(`${kind} has unknown surface ${surface}.`);

  for (const row of rows) {
    const classification: string = row.classification;
    if (
      classification !== "supported" &&
      classification !== "baseline" &&
      classification !== "unsupported" &&
      classification !== "audited-out-of-scope"
    )
      issues.push(`${row.id}: missing or invalid classification.`);
    if (row.id.length === 0) issues.push(`${kind}:${row.surface}: missing ID.`);
    if (row.featureExtractor.length === 0) issues.push(`${row.id}: missing feature extractor.`);
    if (row.representativeScenario.length === 0) issues.push(`${row.id}: missing scenario.`);
    if (
      (classification === "supported" || classification === "baseline") &&
      row.focusedProof.length === 0
    )
      issues.push(`${row.id}: supported/baseline entry is missing focused proof.`);
    if (classification === "unsupported") {
      if (row.prerequisites.length === 0)
        issues.push(`${row.id}: unsupported entry needs prerequisites.`);
      if (row.proofTarget === undefined || row.proofTarget.length === 0)
        issues.push(`${row.id}: unsupported entry needs a proof target.`);
    }
  }
};

export const validateAiCapabilityClosure = (
  matrix: AiCapabilityMatrix = createAiCapabilityMatrix(),
): readonly string[] => {
  const issues: string[] = [];
  const schemaVersion: string = matrix.schemaVersion;
  const scopeVersion: string = matrix.scopeVersion;
  if (schemaVersion !== "ai-engine-capability-matrix:v4")
    issues.push("Invalid AI capability matrix schema version.");
  if (scopeVersion !== "ai-combat-scope:v1")
    issues.push("AI capability matrix must use ai-combat-scope:v1.");
  checkRows(matrix, "legal-decision", issues);
  checkRows(matrix, "pending-decision", issues);
  checkRows(matrix, "response-shape", issues);
  if (matrix.immediateEvaluators.length === 0)
    issues.push("Immediate utility evaluator registry must not be empty.");
  const evaluatorCodes = new Set(matrix.immediateEvaluators.map((entry) => entry.code));
  if (evaluatorCodes.size !== matrix.immediateEvaluators.length)
    issues.push("Immediate utility evaluator codes must be unique.");
  for (const evaluator of matrix.immediateEvaluators) {
    if (evaluator.status !== "complete") issues.push(`${evaluator.id}: evaluator is not complete.`);
    if (evaluator.proof.length === 0) issues.push(`${evaluator.id}: missing proof.`);
  }
  if (matrix.contextualEvaluators.length === 0)
    issues.push("Contextual evaluator registry must not be empty.");
  for (const evaluator of matrix.contextualEvaluators) {
    if (evaluator.status !== "complete") issues.push(`${evaluator.id}: evaluator is not complete.`);
    if (evaluator.proof.length === 0) issues.push(`${evaluator.id}: missing proof.`);
  }

  const ids = [...matrix.legalSurfaces, ...matrix.pendingSurfaces, ...matrix.responseShapes].map(
    (row) => row.id,
  );
  for (const id of new Set(ids))
    if (ids.filter((candidate) => candidate === id).length > 1)
      issues.push(`Duplicate evaluator ID ${id}.`);

  for (const exclusion of matrix.exclusions) {
    if (scopeDecisionForId(exclusion.id) === undefined)
      issues.push(`Invalid approved exclusion ${exclusion.id}.`);
    const version: number = exclusion.version;
    if (version !== 1) issues.push(`Unsupported exclusion version ${exclusion.id}.`);
  }
  const exclusionIds = matrix.exclusions.map((exclusion) => exclusion.id);
  if (new Set(exclusionIds).size !== exclusionIds.length)
    issues.push("Approved exclusions must have unique IDs.");

  const evidenceKeys = new Set(
    matrix.coverageEvidence.map((entry) => `${entry.kind}:${entry.surface}`),
  );
  for (const kind of ["legal-decision", "pending-decision", "response-shape"] as const)
    for (const row of rowsFor(matrix, kind))
      if (
        !evidenceKeys.has(`${kind}:${row.surface}`) &&
        !(kind === "pending-decision" && row.surface.startsWith("select-source-"))
      )
        issues.push(`${row.id}: missing focused coverage evidence.`);
  return issues;
};

export const assertAiCapabilityClosure = (matrix?: AiCapabilityMatrix): void => {
  const issues = validateAiCapabilityClosure(matrix);
  if (issues.length > 0)
    throw new Error(`AI capability closure has ${issues.length} issue(s):\n${issues.join("\n")}`);
};

const issues = validateAiCapabilityClosure();
if (!process.env.VITEST && issues.length > 0) {
  console.error(issues.join("\n"));
  process.exitCode = 1;
} else if (!process.env.VITEST) console.log("AI capability closure is complete.");
