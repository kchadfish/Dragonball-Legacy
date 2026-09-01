import { parentPort, workerData, type MessagePort } from "node:worker_threads";

import { createCombatMechanicsView } from "@dragonball-resurgence/combat-engine";

import { runSimulationFight } from "./runner.js";
import type { SimulationFightRequest } from "./contracts.js";

interface WorkerReply {
  readonly type: "result" | "error";
  readonly result?: ReturnType<typeof runSimulationFight>;
  readonly detail?: string;
}

const replyPort = (workerData as { readonly replyPort: MessagePort }).replyPort;
if (parentPort === null) throw new Error("Simulation worker requires a parent port.");

parentPort.on("message", (value) => {
  const message = value as { readonly request: SimulationFightRequest };
  try {
    const sourceView = message.request.mechanicsView;
    const mechanicsView = createCombatMechanicsView({
      rules: sourceView.rules,
      rulesVersion: sourceView.rulesVersion,
      moves: sourceView.moves,
      items: sourceView.items,
      transformations: sourceView.transformations,
      races: sourceView.races,
      genericClasses: sourceView.genericClasses,
    });
    const result = runSimulationFight({ ...message.request, mechanicsView });
    replyPort.postMessage({ type: "result", result } satisfies WorkerReply);
  } catch (error) {
    replyPort.postMessage({
      type: "error",
      detail: error instanceof Error ? error.message : String(error),
    } satisfies WorkerReply);
  }
});
