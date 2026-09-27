import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { readJson, writeStudyJson } from "./study-storage.js";

const directory = resolve(process.argv[2] ?? "artifacts/simulation/study-8000/balance-20260926");
const started = Date.now();
let exited = false;
const sharded = existsSync(join(directory, "shard.json"));
const phase = process.argv[3];
if (sharded && phase !== "pilot" && phase !== "confirmation")
  throw new Error("A shard supervisor requires explicit pilot or confirmation phase");
const runner = sharded ? "scripts/simulation-study-shards.ts" : "scripts/simulation-study.ts";
const command = sharded ? `run-${phase}` : "resume";
const child = spawn(process.execPath, ["--import", "tsx", runner, command, "--dir", directory], {
  stdio: "inherit",
});
const heartbeat = (): void => {
  const progress = existsSync(join(directory, "progress.json"))
    ? readJson(join(directory, "progress.json"))
    : null;
  const lastResult = (progress as { lastResultAt?: string } | null)?.lastResultAt;
  const sinceLastResultSeconds =
    (Date.now() - (lastResult ? Date.parse(lastResult) : started)) / 1000;
  writeStudyJson(join(directory, "heartbeat.json"), {
    heartbeatAt: new Date().toISOString(),
    supervisorPid: process.pid,
    workerCoordinatorPid: child.pid,
    coordinatorExited: exited,
    sinceLastResultSeconds,
    stalled: !exited && sinceLastResultSeconds >= 1800,
    elapsedSeconds: (Date.now() - started) / 1000,
    progress,
    note: "Heartbeat is supervisor liveness. Check lastResultAt and lastSnapshotAt for actual progress.",
  });
};
heartbeat();
const timer = setInterval(heartbeat, 900000);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    child.kill(signal);
  });
child.on("error", (error) => {
  console.error(error);
  clearInterval(timer);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  exited = true;
  clearInterval(timer);
  heartbeat();
  console.log(JSON.stringify({ event: "study-exit", code, signal }));
  process.exitCode = code ?? 1;
});
