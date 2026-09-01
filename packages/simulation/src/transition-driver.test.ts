import { describe, expect, it } from "vitest";

import type {
  CombatDependencies,
  CombatRuntime,
  FightState,
} from "@dragonball-resurgence/combat-engine";

import { runSimulationTransitionDriver } from "./transition-driver.js";

describe("simulation transition driver", () => {
  it("retains the authoritative state when a decision boundary throws", () => {
    const state = { status: "active", version: 3 } as unknown as FightState;
    const result = runSimulationTransitionDriver({
      runtime: {
        getDecisionPoint: () => {
          throw new Error("decision boundary diagnostic");
        },
      } as unknown as CombatRuntime,
      initial: { state, events: [] },
      dependencies: {} as CombatDependencies,
      limits: {
        maximumTurns: 10,
        maximumTransitions: 10,
        semanticNoProgressLimit: 3,
      },
      chooseDecision: () => ({ error: { type: "cancelled" } }),
    });
    expect(result).toEqual({
      ok: false,
      state,
      failure: {
        type: "unexpected-runner-failure",
        detail: "decision boundary diagnostic",
      },
    });
  });
});
