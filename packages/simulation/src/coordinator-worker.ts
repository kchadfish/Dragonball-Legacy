import { parentPort, workerData, type MessagePort } from "node:worker_threads";

import {
  createCombatMechanicsView,
  type CombatMechanicsView,
} from "@dragonball-resurgence/combat-engine";

import { runSimulationFight } from "./runner.js";
import type { SimulationFightRequest } from "./contracts.js";

interface WorkerReply {
  readonly type: "result" | "error";
  readonly result?: ReturnType<typeof runSimulationFight>;
  readonly detail?: string;
}

type CompactSimulationFightRequest = Omit<SimulationFightRequest, "mechanicsView">;
type WorkerMessage =
  | { readonly type: "initialize"; readonly mechanicsView: SimulationFightRequest["mechanicsView"] }
  | {
      readonly type: "fight";
      readonly mechanicsIdentity: string;
      readonly request: CompactSimulationFightRequest;
    };

const replyPort = (workerData as { readonly replyPort: MessagePort }).replyPort;
if (parentPort === null) throw new Error("Simulation worker requires a parent port.");
replyPort.unref();

const mechanicsViews = new Map<string, CombatMechanicsView>();

const mechanicsViewFor = (
  sourceView: SimulationFightRequest["mechanicsView"],
): CombatMechanicsView => {
  const identity = sourceView.identity.contentHash;
  const cached = mechanicsViews.get(identity);
  if (cached !== undefined) return cached;
  const mechanicsView = createCombatMechanicsView({
    rules: sourceView.rules,
    rulesVersion: sourceView.rulesVersion,
    moves: sourceView.moves,
    items: sourceView.items,
    transformations: sourceView.transformations,
    races: sourceView.races,
    genericClasses: sourceView.genericClasses,
  });
  mechanicsViews.set(identity, mechanicsView);
  return mechanicsView;
};

parentPort.on("message", (value) => {
  try {
    const message = value as WorkerMessage;
    if (message.type === "initialize") {
      mechanicsViewFor(message.mechanicsView);
      return;
    }
    const mechanicsView = mechanicsViews.get(message.mechanicsIdentity);
    if (mechanicsView === undefined)
      throw new Error(`Worker mechanics view is not initialized: ${message.mechanicsIdentity}.`);
    const result = runSimulationFight({ ...message.request, mechanicsView });
    replyPort.postMessage({ type: "result", result } satisfies WorkerReply);
  } catch (error) {
    replyPort.postMessage({
      type: "error",
      detail: error instanceof Error ? error.message : String(error),
    } satisfies WorkerReply);
  }
});
