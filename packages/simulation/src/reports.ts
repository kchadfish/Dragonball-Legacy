import { canonicalHash, canonicalJson } from "./canonical.js";
import type {
  SimulationMoveCoverageDataset,
  SimulationMoveCoverageRecord,
} from "./move-coverage.js";

export interface SimulationReportRow {
  readonly id: string;
  readonly values: Readonly<Record<string, string | number | boolean | null>>;
}

export interface SimulationReport {
  readonly schemaVersion: "simulation-report:v1";
  readonly reportId: string;
  readonly title: string;
  readonly generatedFrom: Readonly<{
    readonly scopeVersion: string;
    readonly mechanicsIdentity: string;
    readonly inputHash: string;
  }>;
  readonly columns: readonly string[];
  readonly rows: readonly SimulationReportRow[];
  readonly freshnessHash: string;
  readonly reportHash: string;
}

const rowForMove = (record: SimulationMoveCoverageRecord): SimulationReportRow => ({
  id: record.moveId,
  values: {
    moveId: record.moveId,
    name: record.moveName,
    category: record.category,
    naturalStatus: record.naturalStatus,
    isolationStatus: record.isolationStatus,
    equipped: record.funnel.equipped,
    eligible: record.funnel.eligible,
    affordable: record.funnel.affordable,
    selected: record.funnel.selected,
    submitted: record.funnel.submitted,
    resolved: record.funnel.resolved,
    successful: record.funnel.successful,
    valueProducing: record.funnel.valueProducing,
  },
});

export const createSimulationMoveBalanceReport = (
  dataset: SimulationMoveCoverageDataset,
  reportId = "simulation-report:move-balance",
): SimulationReport => {
  const columns = [
    "moveId",
    "name",
    "category",
    "naturalStatus",
    "isolationStatus",
    "equipped",
    "eligible",
    "affordable",
    "selected",
    "submitted",
    "resolved",
    "successful",
    "valueProducing",
  ] as const;
  const rows = [...dataset.records]
    .sort((left, right) => left.moveId.localeCompare(right.moveId))
    .map(rowForMove);
  const generatedFrom = {
    scopeVersion: "simulation-scope:v1",
    mechanicsIdentity: dataset.mechanicsIdentity,
    inputHash: dataset.datasetHash,
  } as const;
  const freshnessHash = canonicalHash({ generatedFrom, columns, rows });
  return {
    schemaVersion: "simulation-report:v1",
    reportId,
    title: "Simulation move balance matrix",
    generatedFrom,
    columns,
    rows,
    freshnessHash,
    reportHash: canonicalHash({
      reportId,
      title: "Simulation move balance matrix",
      generatedFrom,
      columns,
      rows,
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
  const header = `# ${report.title}\n\nFreshness hash: \`${report.freshnessHash}\`\n\n`;
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
  return `${header}${table.join("\n")}\n`;
};
