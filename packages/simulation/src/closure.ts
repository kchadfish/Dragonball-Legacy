import type { CombatMechanicsView } from "@dragonball-resurgence/combat-engine";

import { canonicalHash } from "./canonical.js";
import {
  type SimulationClosureReport,
  type SimulationScenario,
  type SimulationTemplate,
} from "./contracts.js";
import { validateSimulationTemplate } from "./templates.js";

export const createSimulationClosureReport = (
  templates: readonly SimulationTemplate[],
  scenarios: readonly SimulationScenario[],
  view?: CombatMechanicsView,
): SimulationClosureReport => {
  const ordered = [...templates].sort((left, right) => left.id.localeCompare(right.id));
  const rows = ordered.map((template) => {
    const validation = validateSimulationTemplate(template, view);
    const templateScenarios = scenarios.filter(
      (scenario) => scenario.templateAId === template.id || scenario.templateBId === template.id,
    );
    return {
      templateId: template.id,
      sourcePath: template.source.path,
      kind: template.kind,
      materializable: validation.ok,
      referenceValid: validation.ok || validation.error.type !== "unknown-reference",
      profileAssigned: template.aiProfileId.length > 0,
      scenarioCount: templateScenarios.length,
      gaps: template.gaps.map((gap) => `${gap.kind}: ${gap.reason}`),
    };
  });
  return Object.freeze({
    schemaVersion: "simulation-contracts:v1",
    rows: Object.freeze(rows),
    sourceSheetCount: rows.filter((row) => row.kind === "tf1-source").length,
    syntheticArchetypeCount: rows.filter((row) => row.kind === "synthetic").length,
    reportHash: canonicalHash(rows),
  });
};
