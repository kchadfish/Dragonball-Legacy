import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canonicalHash,
  readSimulationStatisticsBackfillCheckpointV1,
} from "@dragonball-resurgence/simulation";
import {
  createSimulationCheckpointReporter,
  SIMULATION_HEARTBEAT_INTERVAL_MS,
} from "./simulation-run-support.js";

const directories: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("simulation checkpoint progress reporter", () => {
  it("writes timed progress heartbeats without advancing the durable checkpoint", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const directory = mkdtempSync(join(tmpdir(), "simulation-heartbeat-"));
    directories.push(directory);
    const manifest = {
      mechanicsIdentity: "fixture-mechanics",
      mechanicsVersion: "1",
      rootSeed: 1,
      fixedTime: "2026-01-01T00:00:00.000Z",
      aiProfile: { id: "fixture-policy", version: "1" },
      templateCatalogIdentity: "fixture-templates",
      scenarioCatalogIdentity: "fixture-scenarios",
      seedScheduleIdentity: "fixture-seeds",
      evidenceRole: "natural-balance",
      targetPairs: 100,
      workers: 1,
      maximumInFlight: 1,
      checkpointEveryPairs: 5,
      metricDefinitionIds: [],
      collectors: ["metrics"],
    };
    const value = {
      schemaVersion: "simulation-statistics-backfill-checkpoint:v1",
      baseline: { checkpointHash: "fixture-checkpoint", artifactHash: "fixture-artifact" },
      quarantinedEvidence: [],
      manifest,
      manifestHash: canonicalHash(manifest),
      cells: [
        {
          cellId: "fixture-cell",
          templateAId: "a",
          templateBId: "b",
          pairIdentities: [],
          collectorCompletion: { metrics: [], sequences: [], anomalies: [] },
          failures: [],
          disposition: "selected",
        },
      ],
      partialMetrics: {},
      sequences: [],
      anomalyFindings: [],
    };
    const checkpoint = readSimulationStatisticsBackfillCheckpointV1({
      ...value,
      checkpointHash: canonicalHash(value),
    });
    const checkpointPath = join(directory, "run.checkpoint.json");
    const report = createSimulationCheckpointReporter(checkpointPath, 0);

    report(checkpoint);
    const durableContent = readFileSync(checkpointPath, "utf8");
    const progressPath = `${checkpointPath}.progress.json`;
    const initialProgress = JSON.parse(readFileSync(progressPath, "utf8")) as {
      lastDurableCheckpoint: string;
      lastHeartbeatAt: string | null;
      uncheckpointedFights: number;
      updatedAt: string;
    };
    expect(initialProgress.lastHeartbeatAt).toBeNull();

    vi.advanceTimersByTime(SIMULATION_HEARTBEAT_INTERVAL_MS - 1);
    report.heartbeat(checkpoint, 17);
    expect(JSON.parse(readFileSync(progressPath, "utf8")).uncheckpointedFights).toBe(0);

    vi.advanceTimersByTime(1);
    report.heartbeat(checkpoint, 17);
    const heartbeatProgress = JSON.parse(
      readFileSync(progressPath, "utf8"),
    ) as typeof initialProgress;
    expect(heartbeatProgress.uncheckpointedFights).toBe(17);
    expect(heartbeatProgress.lastHeartbeatAt).not.toBeNull();
    expect(heartbeatProgress.updatedAt).not.toBe(initialProgress.updatedAt);
    expect(heartbeatProgress.lastDurableCheckpoint).toBe(initialProgress.lastDurableCheckpoint);
    expect(readFileSync(checkpointPath, "utf8")).toBe(durableContent);
  });
});
