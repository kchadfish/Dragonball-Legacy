import { MessageChannel, Worker, receiveMessageOnPort } from "node:worker_threads";

import {
  type SimulationCoordinatorRequest,
  type SimulationCoordinatorResult,
  type SimulationFightExecutionResult,
  type SimulationFailure,
  type SimulationFightMetrics,
} from "./contracts.js";
import { runSimulationFight } from "./runner.js";

type CoordinatorResult = SimulationCoordinatorResult["results"][number];
type CompactSimulationFightRequest = Omit<
  SimulationCoordinatorRequest["requests"][number],
  "mechanicsView"
>;

/** Internal execution controls that do not alter the public fight contract. */
export interface SimulationCoordinatorExecutionOptions {
  /** Stream progress without retaining the completed result array. */
  readonly retainResults?: boolean;
}

type CoordinatorRequest = SimulationCoordinatorRequest & SimulationCoordinatorExecutionOptions;

const failureFor = (
  request: SimulationCoordinatorRequest["requests"][number],
): SimulationFailure => ({
  type: "unexpected-runner-failure",
  detail: `Simulation request ${request.runId} did not produce a result.`,
});

const isSuccessfulTermination = (
  reason: SimulationFightExecutionResult["terminationReason"],
): reason is "engine-completed" | "coverage-satisfied" =>
  reason === "engine-completed" || reason === "coverage-satisfied";

const failureForResult = (
  fightRequest: SimulationCoordinatorRequest["requests"][number],
  result: SimulationFightExecutionResult,
): SimulationFailure => {
  if (result.failure !== undefined) return result.failure;
  switch (result.terminationReason) {
    case "engine-completed":
    case "coverage-satisfied":
      return failureFor(fightRequest);
    case "maximum-turns":
    case "maximum-transitions":
    case "semantic-no-progress":
      return { type: "exhausted-safeguard", reason: result.terminationReason };
    case "cancelled":
      return { type: "cancelled" };
    case "combat-failure":
      return { type: "combat-failure", failure: result.finalState };
    case "ai-failure":
      return { type: "ai-failure", failure: result.finalState };
    case "unsupported-scope":
      return { type: "unsupported-scope", detail: "Scenario is outside executable scope." };
    case "invalid-fixture":
      return { type: "malformed-input", detail: "Fixture failed simulation template validation." };
    default:
      return failureFor(fightRequest);
  }
};

const normalizeResult = (
  fightRequest: SimulationCoordinatorRequest["requests"][number],
  result: SimulationFightExecutionResult,
): CoordinatorResult => {
  if (isSuccessfulTermination(result.terminationReason)) return { ok: true, value: result };
  return { ok: false, error: failureForResult(fightRequest, result) };
};

/** Deterministic bounded local scheduler with stable request-index ordering. */
export const runSimulationRequests = (request: CoordinatorRequest): SimulationCoordinatorResult => {
  const concurrency = request.concurrency ?? 1;
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new RangeError("Simulation concurrency must be a positive integer.");
  const retainResults = request.retainResults !== false;
  const results: Array<CoordinatorResult | undefined> = [];
  let stoppedEarly = false;
  let nextIndex = 0;
  let completed = 0;
  const control =
    request.onMetrics === undefined
      ? request.control
      : { ...request.control, onMetrics: request.onMetrics };
  while (nextIndex < request.requests.length && !stoppedEarly) {
    const batchSize = Math.min(concurrency, request.requests.length - nextIndex);
    for (let slot = 0; slot < batchSize && !stoppedEarly; slot += 1) {
      const index = nextIndex;
      nextIndex += 1;
      const fightRequest = request.requests[index];
      const normalized = normalizeResult(fightRequest, runSimulationFight(fightRequest, control));
      if (retainResults) results[index] = normalized;
      completed += 1;
      request.onProgress?.({
        completed,
        total: request.requests.length,
        runId: fightRequest.runId,
        result: normalized,
      });
      if (!normalized.ok && request.stoppingPolicy === "fail-fast") stoppedEarly = true;
    }
  }
  return {
    results: results.filter((result): result is CoordinatorResult => result !== undefined),
    stoppedEarly,
  };
};

interface WorkerReply {
  readonly type: "result" | "error";
  readonly result?: SimulationFightExecutionResult;
  readonly detail?: string;
  readonly fatal?: boolean;
  readonly metrics?: SimulationFightMetrics;
}

interface PooledWorker {
  readonly worker: Worker;
  readonly port: MessageChannel["port1"];
  mechanicsIdentity?: string;
  busy: boolean;
}

interface ActiveWorker {
  readonly pooled: PooledWorker;
  readonly index: number;
}

interface WorkerBatchState {
  readonly active: ActiveWorker[];
  readonly resultSlots: Array<CoordinatorResult | undefined>;
  readonly retainResults: boolean;
  completed: number;
  nextIndex: number;
  stoppedEarly: boolean;
}

const workerModuleUrl = (): URL =>
  new URL(
    import.meta.url.endsWith(".ts") ? "./coordinator-worker.ts" : "./coordinator-worker.js",
    import.meta.url,
  );

const createWorker = (): PooledWorker => {
  const channel = new MessageChannel();
  const moduleUrl = workerModuleUrl();
  const importExpression = moduleUrl.pathname.endsWith(".ts")
    ? `import { tsImport } from "tsx/esm/api"; tsImport(${JSON.stringify(moduleUrl.href)}, import.meta.url)`
    : `import(${JSON.stringify(moduleUrl.href)})`;
  const bootstrap = `
    import { workerData } from "node:worker_threads";
    ${importExpression}.catch((error) => {
      workerData.replyPort.postMessage({ type: "error", fatal: true, detail: error instanceof Error ? error.message : String(error) });
    });
  `;
  const worker = new Worker(bootstrap, {
    eval: true,
    execArgv: process.execArgv,
    workerData: { replyPort: channel.port2 },
    transferList: [channel.port2],
  });
  channel.port1.unref();
  worker.unref();
  return { worker, port: channel.port1, busy: false };
};

const workerPool: PooledWorker[] = [];

const acquireWorker = (): PooledWorker => {
  const available = workerPool.find((candidate) => !candidate.busy);
  const pooled = available ?? createWorker();
  if (available === undefined) workerPool.push(pooled);
  pooled.busy = true;
  return pooled;
};

const releaseWorker = (pooled: PooledWorker): void => {
  pooled.busy = false;
};

const discardWorker = (pooled: PooledWorker): void => {
  const poolIndex = workerPool.indexOf(pooled);
  if (poolIndex >= 0) workerPool.splice(poolIndex, 1);
  void pooled.worker.terminate();
};

const terminateWorkers = (workers: readonly ActiveWorker[]): void => {
  for (const activeWorker of workers) discardWorker(activeWorker.pooled);
};

const normalizedWorkerReply = (
  request: SimulationCoordinatorRequest["requests"][number],
  reply: WorkerReply,
): CoordinatorResult =>
  reply.type === "result" && reply.result !== undefined
    ? normalizeResult(request, reply.result)
    : {
        ok: false,
        error: {
          type: "unexpected-runner-failure",
          detail: reply.detail ?? "Worker did not return a simulation result.",
        },
      };

const launchWorker = (
  state: WorkerBatchState,
  requests: readonly SimulationCoordinatorRequest["requests"][number][],
): void => {
  const index = state.nextIndex++;
  const pooled = acquireWorker();
  state.active.push({ pooled, index });
  const request = requests[index]!;
  if (pooled.mechanicsIdentity !== request.mechanicsView.identity.contentHash) {
    pooled.worker.postMessage({
      type: "initialize",
      mechanicsView: request.mechanicsView,
    });
    pooled.mechanicsIdentity = request.mechanicsView.identity.contentHash;
  }
  const compactRequest: CompactSimulationFightRequest = { ...request };
  Reflect.deleteProperty(compactRequest, "mechanicsView");
  pooled.worker.postMessage({
    type: "fight",
    mechanicsIdentity: request.mechanicsView.identity.contentHash,
    request: compactRequest satisfies CompactSimulationFightRequest,
  });
};

const consumeWorkerReply = (
  state: WorkerBatchState,
  activeIndex: number,
  requests: readonly SimulationCoordinatorRequest["requests"][number][],
  stoppingPolicy: SimulationCoordinatorRequest["stoppingPolicy"],
  onProgress: SimulationCoordinatorRequest["onProgress"],
  onMetrics: SimulationCoordinatorRequest["onMetrics"],
): boolean => {
  const activeWorker = state.active[activeIndex]!;
  const reply = receiveMessageOnPort(activeWorker.pooled.port)?.message as WorkerReply | undefined;
  if (reply === undefined) return false;
  state.active.splice(activeIndex, 1);
  if (reply.fatal === true) discardWorker(activeWorker.pooled);
  else releaseWorker(activeWorker.pooled);
  const request = requests[activeWorker.index]!;
  const normalized = normalizedWorkerReply(request, reply);
  if (reply.metrics !== undefined) onMetrics?.(reply.metrics);
  if (state.retainResults) state.resultSlots[activeWorker.index] = normalized;
  state.completed += 1;
  onProgress?.({
    completed: state.completed,
    total: requests.length,
    runId: request.runId,
    result: normalized,
  });
  if (!normalized.ok && stoppingPolicy === "fail-fast") {
    state.stoppedEarly = true;
    terminateWorkers(state.active);
    state.active.length = 0;
  } else if (state.nextIndex < requests.length) launchWorker(state, requests);
  return true;
};

const consumeAvailableWorkerReplies = (
  state: WorkerBatchState,
  requests: readonly SimulationCoordinatorRequest["requests"][number][],
  stoppingPolicy: SimulationCoordinatorRequest["stoppingPolicy"],
  onProgress: SimulationCoordinatorRequest["onProgress"],
  onMetrics: SimulationCoordinatorRequest["onMetrics"],
): boolean => {
  let progressed = false;
  for (let activeIndex = state.active.length - 1; activeIndex >= 0; activeIndex -= 1) {
    if (consumeWorkerReply(state, activeIndex, requests, stoppingPolicy, onProgress, onMetrics))
      progressed = true;
    if (state.stoppedEarly) break;
  }
  return progressed;
};

const runWorkerBatch = (
  requests: readonly SimulationCoordinatorRequest["requests"][number][],
  workers: number,
  stoppingPolicy: SimulationCoordinatorRequest["stoppingPolicy"],
  retainResults: boolean,
  onProgress?: SimulationCoordinatorRequest["onProgress"],
  onMetrics?: SimulationCoordinatorRequest["onMetrics"],
): SimulationCoordinatorResult => {
  if (requests.length === 0) return { results: [], stoppedEarly: false };
  const state: WorkerBatchState = {
    active: [],
    resultSlots: [],
    retainResults,
    completed: 0,
    nextIndex: 0,
    stoppedEarly: false,
  };
  const waitBuffer = new Int32Array(new SharedArrayBuffer(4));
  while (state.active.length < Math.min(workers, requests.length)) launchWorker(state, requests);
  while (state.active.length > 0) {
    if (!consumeAvailableWorkerReplies(state, requests, stoppingPolicy, onProgress, onMetrics))
      Atomics.wait(waitBuffer, 0, 0, 1);
  }
  return {
    results: state.resultSlots.filter(
      (result): result is CoordinatorResult => result !== undefined,
    ),
    stoppedEarly: state.stoppedEarly,
  };
};

/** Executes requests on actual Node worker threads and merges by request index. */
export const runSimulationRequestsWithWorkers = (
  request: CoordinatorRequest & { readonly workers: number },
): SimulationCoordinatorResult => {
  if (!Number.isInteger(request.workers) || request.workers < 1)
    throw new RangeError("Simulation worker count must be a positive integer.");
  if (request.control !== undefined)
    return runSimulationRequests({
      ...request,
      concurrency: request.workers,
    });
  return runWorkerBatch(
    request.requests,
    request.workers,
    request.stoppingPolicy,
    request.retainResults !== false,
    request.onProgress,
    request.onMetrics,
  );
};
