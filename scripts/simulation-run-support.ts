import { mkdirSync, renameSync, statfsSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  canonicalJson,
  type SimulationStatisticsBackfillCheckpointV1,
  type SimulationV4CatalogCheckpoint,
} from "@dragonball-resurgence/simulation";

type Checkpoint = SimulationV4CatalogCheckpoint | SimulationStatisticsBackfillCheckpointV1;

export const SIMULATION_HEARTBEAT_INTERVAL_MS = 15 * 60 * 1_000;

export interface SimulationCheckpointReporter {
  (checkpoint: Checkpoint): void;
  heartbeat(checkpoint: Checkpoint, inFlightFights?: number, force?: boolean): void;
}

export const simulationSavedFights = (checkpoint: Checkpoint): number => {
  if (checkpoint.schemaVersion === "simulation-statistics-backfill-checkpoint:v1")
    return checkpoint.cells.reduce((sum, cell) => sum + cell.pairIdentities.length, 0);
  const branches = checkpoint.manifest.evidenceRoles[0] === "controlled" ? 2 : 1;
  return checkpoint.cells.reduce(
    (sum, cell) =>
      sum +
      cell.completedIterations.length * 2 * branches +
      Object.keys(cell.acceptedMirrorResults).length,
    0,
  );
};

/** Guards run after an atomic save, so a resource stop leaves resumable progress. */
export const createSimulationCheckpointReporter = (path: string, initialSaved: number) => {
  const started = Date.now();
  let initialBytes: number | undefined;
  let lastDurableCheckpoint = "none";
  let lastHeartbeatAt = started;
  mkdirSync(dirname(path), { recursive: true });
  const writeProgress = (
    checkpoint: Checkpoint,
    uncheckpointedFights: number,
    updatedAt: string,
    heartbeatAt: string | null,
    enforceResourceGuard: boolean,
  ): void => {
    const content = `${canonicalJson(checkpoint)}\n`;
    const bytes = Buffer.byteLength(content);
    initialBytes ??= bytes;
    const filesystem = statfsSync(dirname(path));
    const freeBytes = filesystem.bavail * filesystem.bsize;
    if (freeBytes < bytes * 2)
      throw new Error(
        `Insufficient storage for atomic checkpoint; previous checkpoint retained: ${path}`,
      );
    const saved = simulationSavedFights(checkpoint);
    const invocation = saved - initialSaved;
    const analytics = checkpoint.schemaVersion === "simulation-statistics-backfill-checkpoint:v1";
    const target = analytics
      ? checkpoint.manifest.targetPairs
      : checkpoint.manifest.requestedTargetPairs;
    const controlled = analytics
      ? checkpoint.manifest.evidenceRole === "controlled"
      : checkpoint.manifest.evidenceRoles[0] === "controlled";
    const required = checkpoint.cells.length * target * (controlled ? 4 : 2);
    const elapsed = (Date.now() - started) / 1000;
    const rate = invocation / Math.max(elapsed, 0.001);
    const continuationPairs = analytics
      ? 0
      : checkpoint.cells.reduce(
          (sum, cell) =>
            sum + cell.completedIterations.filter((iteration) => iteration >= target).length,
          0,
        );
    const continuationFights = analytics
      ? 0
      : continuationPairs * (controlled ? 4 : 2) +
        checkpoint.cells.reduce(
          (sum, cell) =>
            sum +
            Object.keys(cell.acceptedMirrorResults).filter(
              (key) => Number(key.split(":")[0]) >= target,
            ).length,
          0,
        );
    const remaining = Math.max(0, required - (saved - continuationFights));
    const rss = process.memoryUsage().rss;
    const status = {
      saved,
      invocation,
      remaining,
      targetPairs: target,
      continuationPairs,
      continuationFights,
      elapsedSeconds: elapsed,
      fightsPerSecond: rate,
      nominalEtaSeconds: rate > 0 ? Math.ceil(remaining / rate) : null,
      lastDurableCheckpoint,
      lastHeartbeatAt: heartbeatAt,
      updatedAt,
      uncheckpointedFights,
      checkpointBytes: bytes,
      checkpointGrowthBytes: bytes - initialBytes,
      rssBytes: rss,
      freeBytes,
      failures: checkpoint.cells.reduce((sum, cell) => sum + cell.failures.length, 0),
    };
    const progressPath = `${path}.progress.json`;
    const temporaryProgressPath = `${progressPath}.tmp-${process.pid}`;
    writeFileSync(temporaryProgressPath, `${JSON.stringify(status, null, 2)}\n`);
    renameSync(temporaryProgressPath, progressPath);
    console.error(JSON.stringify(status));
    const projectedGrowth =
      invocation > 0 ? (Math.max(0, bytes - initialBytes) / invocation) * remaining : 0;
    if (
      enforceResourceGuard &&
      (freeBytes < Math.max(2 * 1024 ** 3, projectedGrowth * 2) || rss > 12 * 1024 ** 3)
    )
      throw new Error(`Resource guard stopped execution after durable checkpoint: ${path}`);
  };

  const report = ((checkpoint: Checkpoint): void => {
    const timestamp = new Date().toISOString();
    const content = `${canonicalJson(checkpoint)}\n`;
    const bytes = Buffer.byteLength(content);
    const filesystem = statfsSync(dirname(path));
    const freeBytes = filesystem.bavail * filesystem.bsize;
    if (freeBytes < bytes * 2)
      throw new Error(
        `Insufficient storage for atomic checkpoint; previous checkpoint retained: ${path}`,
      );
    const temporaryPath = `${path}.tmp-${process.pid}`;
    writeFileSync(temporaryPath, content);
    renameSync(temporaryPath, path);
    lastDurableCheckpoint = timestamp;
    writeProgress(checkpoint, 0, timestamp, null, true);
  }) as SimulationCheckpointReporter;

  report.heartbeat = (checkpoint, inFlightFights = 0, force = false): void => {
    const now = Date.now();
    if (!force && now - lastHeartbeatAt < SIMULATION_HEARTBEAT_INTERVAL_MS) return;
    lastHeartbeatAt = now;
    const timestamp = new Date(now).toISOString();
    writeProgress(checkpoint, inFlightFights, timestamp, timestamp, false);
  };

  return report;
};
