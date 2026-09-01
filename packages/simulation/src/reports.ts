import { canonicalHash, canonicalJson } from "./canonical.js";
import type { SimulationCoverageArtifactError } from "./coverage-artifacts.js";
import type {
  SimulationMoveCoverageDataset,
  SimulationMoveCoverageRecord,
} from "./move-coverage.js";

export interface SimulationReportRow {
  readonly id: string;
  readonly values: Readonly<Record<string, string | number | boolean | null>>;
}

export interface SimulationReport {
  readonly schemaVersion: "simulation-report:v2";
  readonly reportId: string;
  readonly title: string;
  readonly generatedFrom: Readonly<{
    readonly scopeVersion: string;
    readonly mechanicsIdentity: string;
    readonly inputHash: string;
    readonly coverageSchemaVersion: string;
  }>;
  readonly manifest: Readonly<{
    readonly populations: readonly ["natural", "isolation", "forced"];
    readonly strata: readonly string[];
    readonly denominators: readonly string[];
    readonly precisionLooks: readonly number[];
  }>;
  readonly columns: readonly string[];
  readonly rows: readonly SimulationReportRow[];
  readonly anomalies: readonly string[];
  readonly followUpTargets: readonly string[];
  readonly errors: readonly SimulationCoverageArtifactError[];
  readonly freshnessHash: string;
  readonly reportHash: string;
}

const rowForMove = (
  record: SimulationMoveCoverageRecord,
  errors: readonly SimulationCoverageArtifactError[],
): SimulationReportRow => {
  const moveErrors = errors.filter((error) => error.moveId === record.moveId);
  return {
    id: record.moveId,
    values: {
      moveId: record.moveId,
      name: record.moveName,
      category: record.category,
      naturalStatus: record.naturalStatus,
      isolationStatus: record.isolationStatus,
      forcedStatus: record.forcedStatus,
      equipped: record.funnel.equipped,
      eligible: record.funnel.eligible,
      affordable: record.funnel.affordable,
      selected: record.funnel.selected,
      submitted: record.funnel.submitted,
      resolved: record.funnel.resolved,
      successful: record.funnel.successful,
      valueProducing: record.funnel.valueProducing,
      decisionEligible: record.funnel.decisionFunnel.eligible,
      decisionSelected: record.funnel.decisionFunnel.selected,
      triggerApplicable: record.funnel.triggerFunnel.applicable,
      triggerActivated: record.funnel.triggerFunnel.activated,
      triggerResolved: record.funnel.triggerFunnel.resolved,
      triggerValueProducing: record.funnel.triggerFunnel.valueProducing,
      errorCount: moveErrors.length,
      errors: moveErrors.length === 0 ? null : JSON.stringify(moveErrors),
      followUp: [record.naturalStatus, record.isolationStatus, record.forcedStatus].some(
        (status) => status !== "observed-sufficient" && status !== "sufficient",
      ),
    },
  };
};

export const createSimulationMoveBalanceReport = (
  dataset: SimulationMoveCoverageDataset,
  reportId = "simulation-report:move-balance",
  options: Readonly<{ readonly errors?: readonly SimulationCoverageArtifactError[] }> = {},
): SimulationReport => {
  const errors = Object.freeze([...(options.errors ?? [])]);
  const columns = [
    "moveId",
    "name",
    "category",
    "naturalStatus",
    "isolationStatus",
    "forcedStatus",
    "equipped",
    "eligible",
    "affordable",
    "selected",
    "submitted",
    "resolved",
    "successful",
    "valueProducing",
    "decisionEligible",
    "decisionSelected",
    "triggerApplicable",
    "triggerActivated",
    "triggerResolved",
    "triggerValueProducing",
    "errorCount",
    "errors",
    "followUp",
  ] as const;
  const rows = [...dataset.records]
    .sort((left, right) => left.moveId.localeCompare(right.moveId))
    .map((record) => rowForMove(record, errors));
  const generatedFrom = {
    scopeVersion: "simulation-scope:v2",
    mechanicsIdentity: dataset.mechanicsIdentity,
    inputHash: dataset.datasetHash,
    coverageSchemaVersion: "simulation-move-coverage:v2",
  } as const;
  const manifest = {
    populations: ["natural", "isolation", "forced"] as const,
    strata: ["category"] as const,
    denominators: ["completed-fights", "eligible-states", "selected-states", "triggered-states"],
    precisionLooks: [250, 500, 1_000, 2_000, 5_000, 10_000],
  } as const;
  const followUpTargets = rows
    .filter((row) => row.values.followUp === true)
    .map((row) => row.id)
    .sort((left, right) => left.localeCompare(right));
  const anomalies = Object.freeze(
    [
      errors.map((error) => `${error.moveId} (${error.runId}): ${error.type} — ${error.detail}`),
      ...rows
        .filter((row) => row.values.isolationStatus === "runner-failure")
        .map((row) => `${row.id}: runner-failure status requires rerun evidence.`),
    ].flat(),
  );
  const freshnessHash = canonicalHash({
    generatedFrom,
    manifest,
    columns,
    rows,
    anomalies,
    followUpTargets,
    errors,
  });
  return {
    schemaVersion: "simulation-report:v2",
    reportId,
    title: "Simulation move balance matrix",
    generatedFrom,
    manifest,
    columns,
    rows,
    anomalies,
    followUpTargets,
    errors,
    freshnessHash,
    reportHash: canonicalHash({
      reportId,
      title: "Simulation move balance matrix",
      generatedFrom,
      manifest,
      columns,
      rows,
      anomalies,
      followUpTargets,
      errors,
    }),
  };
};

export const createSimulationMoveDossiers = (
  dataset: SimulationMoveCoverageDataset,
): readonly SimulationReport[] =>
  [...dataset.records]
    .sort((left, right) => left.moveId.localeCompare(right.moveId))
    .map((record) =>
      createSimulationMoveBalanceReport(
        { ...dataset, records: [record] },
        `simulation-report:move-${record.moveId.replaceAll(":", "-")}`,
      ),
    );

export const renderSimulationReportJson = (report: SimulationReport): string =>
  canonicalJson(report);

const escapeCsv = (value: string | number | boolean | null): string => {
  const text = value === null ? "" : String(value);
  return /[",\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export const renderSimulationReportCsv = (report: SimulationReport): string => {
  const lines = [report.columns.join(",")];
  for (const row of report.rows)
    lines.push(report.columns.map((column) => escapeCsv(row.values[column] ?? null)).join(","));
  return `${lines.join("\n")}\n`;
};

export const renderSimulationReportMarkdown = (report: SimulationReport): string => {
  const header = `# ${report.title}\n\nFreshness hash: \`${report.freshnessHash}\`\n\nErrors: ${report.errors.length}\n\n`;
  const rows = report.rows.map((row) =>
    report.columns.map((column) => String(row.values[column] ?? "")),
  );
  const widths = report.columns.map((column, index) =>
    Math.max(3, column.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const lineFor = (values: readonly string[]): string =>
    `| ${values.map((value, index) => value.padEnd(widths[index]!)).join(" | ")} |`;
  const table = [
    lineFor(report.columns),
    lineFor(widths.map((width) => "-".repeat(width))),
    ...rows.map(lineFor),
  ];
  const errorSection =
    report.errors.length === 0
      ? ""
      : `\n\n## Errors\n\n${report.errors
          .map((error) => `- ${error.moveId} — ${error.runId} — ${error.type}: ${error.detail}`)
          .join("\n")}\n`;
  return `${header}${table.join("\n")}\n${errorSection}`;
};
