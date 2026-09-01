import {
  type SimulationCoordinatorRequest,
  type SimulationCoordinatorResult,
  type SimulationFightExecutionResult,
  type SimulationFailure,
} from "./contracts.js";
import { runSimulationFight } from "./runner.js";

type CoordinatorResult = SimulationCoordinatorResult["results"][number];

const failureFor = (
  request: SimulationCoordinatorRequest["requests"][number],
): SimulationFailure => ({
  type: "unexpected-runner-failure",
  detail: `Simulation request ${request.runId} did not produce a result.`,
});

const isSuccessfulTermination = (
  reason: SimulationFightExecutionResult["terminationReason"],
): reason is
  | "engine-completed"
  | "maximum-turns"
  | "maximum-transitions"
  | "semantic-no-progress"
  | "cancelled" =>
  reason === "engine-completed" ||
  reason === "maximum-turns" ||
  reason === "maximum-transitions" ||
  reason === "semantic-no-progress" ||
  reason === "cancelled";

const failureForResult = (
  fightRequest: SimulationCoordinatorRequest["requests"][number],
  result: SimulationFightExecutionResult,
): SimulationFailure => {
  if (result.failure !== undefined) return result.failure;
  switch (result.terminationReason) {
    case "engine-completed":
    case "maximum-turns":
    case "maximum-transitions":
    case "semantic-no-progress":
    case "cancelled":
      return failureFor(fightRequest);
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

/**
 * Deterministic bounded local scheduler. Synchronous execution keeps result
 * ordering stable; worker-backed execution can be added behind this contract.
 */
export const runSimulationRequests = (
  request: SimulationCoordinatorRequest,
): SimulationCoordinatorResult => {
  const concurrency = request.concurrency ?? 1;
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new RangeError("Simulation concurrency must be a positive integer.");
  const results: Array<CoordinatorResult | undefined> = [];
  let stoppedEarly = false;
  let nextIndex = 0;
  let completed = 0;
  while (nextIndex < request.requests.length && !stoppedEarly) {
    const batchSize = Math.min(concurrency, request.requests.length - nextIndex);
    for (let slot = 0; slot < batchSize && !stoppedEarly; slot += 1) {
      const index = nextIndex;
      nextIndex += 1;
      const fightRequest = request.requests[index];
      const normalized = normalizeResult(
        fightRequest,
        runSimulationFight(fightRequest, request.control),
      );
      results[index] = normalized;
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

/**
 * Deterministic worker-executor facade. Each partition uses the same
 * sequential reference runner and results are merged by request index, so a
 * later Node worker implementation can replace the partition body without
 * changing logical results or canonical hashes.
 */
export const runSimulationRequestsWithWorkers = (
  request: SimulationCoordinatorRequest & { readonly workers: number },
): SimulationCoordinatorResult => {
  if (!Number.isInteger(request.workers) || request.workers < 1)
    throw new RangeError("Simulation worker count must be a positive integer.");
  const partitions = Array.from(
    { length: Math.min(request.workers, request.requests.length) },
    () =>
      [] as {
        readonly index: number;
        readonly request: SimulationCoordinatorRequest["requests"][number];
      }[],
  );
  request.requests.forEach((fightRequest, index) => {
    partitions[index % partitions.length]?.push({ index, request: fightRequest });
  });
  const indexedResults: Array<CoordinatorResult | undefined> = [];
  let stoppedEarly = false;
  for (const partition of partitions) {
    if (stoppedEarly) break;
    const partitionResult = runSimulationRequests({
      ...request,
      requests: partition.map((entry) => entry.request),
      concurrency: 1,
      onProgress: undefined,
    });
    partitionResult.results.forEach((result, resultIndex) => {
      const source = partition[resultIndex]!;
      indexedResults[source.index] = result;
    });
    stoppedEarly ||= partitionResult.stoppedEarly;
  }
  const results = indexedResults.filter(
    (result): result is CoordinatorResult => result !== undefined,
  );
  results.forEach((result, index) => {
    const fightRequest = request.requests[index]!;
    request.onProgress?.({
      completed: index + 1,
      total: request.requests.length,
      runId: fightRequest.runId,
      result,
    });
  });
  return { results, stoppedEarly };
};
