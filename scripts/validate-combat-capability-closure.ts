import {
  GENERIC_CLASS_DEFINITIONS,
  ITEM_DEFINITIONS,
  MOVE_DEFINITIONS,
  RACE_DEFINITIONS,
  TRANSFORMATION_DEFINITIONS,
} from "../packages/game-data/src/index.js";

import {
  createCombatCapabilityMatrix,
  type CombatCapabilityMatrix,
} from "./combat-capability-matrix.js";
import { scopeDecisionForId } from "../packages/combat-engine/src/scope-decisions.js";

const sourceDefinitionFor = (sourceDefinitionId: string) => {
  const transformationId = sourceDefinitionId.split(":")[0];
  const transformation = TRANSFORMATION_DEFINITIONS.find(
    (candidate) => candidate.id === transformationId,
  );
  if (transformation !== undefined)
    return transformation.abilities[
      sourceDefinitionId.split(":")[1] as "novice" | "intermediate" | "mastered"
    ];
  const traitMarker = sourceDefinitionId.indexOf(":trait:");
  const classMarker = sourceDefinitionId.indexOf(":class:");
  const marker = Math.max(traitMarker, classMarker);
  const catalogId = marker < 0 ? sourceDefinitionId : sourceDefinitionId.slice(marker + 7);
  return [
    ...MOVE_DEFINITIONS,
    ...ITEM_DEFINITIONS,
    ...RACE_DEFINITIONS.flatMap((race) => [...race.racialTraits, ...race.classes]),
    ...GENERIC_CLASS_DEFINITIONS,
  ].find((candidate) => candidate.id === catalogId);
};

export const validateCombatCapabilityClosure = (
  matrix = createCombatCapabilityMatrix(),
): readonly string[] => {
  const issues: string[] = [];
  for (const row of matrix.occurrences) {
    if (row.status === "unsupported-in-scope")
      issues.push(`${row.sourceDefinitionId}#${row.effectIndex}: unsupported in scope`);
    if (row.status === "audited-out-of-scope" && row.approvedExclusion === null)
      issues.push(`${row.sourceDefinitionId}#${row.effectIndex}: missing approved exclusion`);
    if (row.status === "supported-generic" || row.status === "supported-named") {
      if (row.capabilityId === null || row.executor === null || row.focusedCoverage === null)
        issues.push(`${row.sourceDefinitionId}#${row.effectIndex}: incomplete support contract`);
      if (
        row.effectType !== "source-text-only" &&
        (row.origin === "race" || row.origin === "generic-class" || row.origin === "transformation")
      ) {
        const definition = sourceDefinitionFor(row.sourceDefinitionId);
        const effect = definition?.effects?.[row.effectIndex];
        if (effect?.sourceClauseOrder === undefined)
          issues.push(
            `${row.sourceDefinitionId}#${row.effectIndex}: missing source clause coverage`,
          );
      }
    }
    if (row.scopeDecisionId !== null && scopeDecisionForId(row.scopeDecisionId) === undefined)
      issues.push(`${row.sourceDefinitionId}#${row.effectIndex}: invalid scope decision ID`);
  }
  return issues;
};

export const assertCombatCapabilityClosure = (matrix?: CombatCapabilityMatrix) => {
  const issues = validateCombatCapabilityClosure(matrix);
  if (issues.length > 0)
    throw new Error(
      `Combat capability closure has ${issues.length} issue(s):\n${issues.join("\n")}`,
    );
};

const issues = validateCombatCapabilityClosure();
if (issues.length > 0) {
  console.error(issues.join("\n"));
  process.exitCode = 1;
} else console.log("Combat capability closure is complete.");
