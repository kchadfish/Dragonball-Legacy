import { describe, expect, it } from "vitest";

import { createAiRandomSource } from "@dragonball-resurgence/ai-engine";
import { createBranchCombatDependencies } from "@dragonball-resurgence/combat-engine";

import { certifyAutomatedNpcCatalog, runAutonomousNpcFight } from "./certification.js";
import { AUTOMATED_NPC_POLICY_ASSIGNMENTS } from "./catalog.js";
import { materializeNpcCombatant } from "./normalization.js";

describe("NPC autonomous certification", () => {
  it("halts externally without changing the authoritative snapshot", () => {
    const first = materializeNpcCombatant("npc-earth-east-limax-1");
    const second = materializeNpcCombatant("npc-namek-steelpan-1");
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    const result = runAutonomousNpcFight({
      combatants: [
        { npcId: "npc-earth-east-limax-1", materialized: first.value },
        { npcId: "npc-namek-steelpan-1", materialized: second.value },
      ],
      dependencies: createBranchCombatDependencies({
        rootSeed: 42,
        branchPath: ["certification", "halt"],
        fixedTime: new Date("2026-01-01T00:00:00.000Z"),
        workBudget: { maxNodes: 100, maxProbes: 100 },
      }),
      aiRandom: createAiRandomSource({
        rootSeed: 42,
        profileVersion: "npc-policy:v1",
        evaluatorVersion: "npc-certification:v1",
        purpose: "certification",
      }),
      limits: { maximumTransitions: 1 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("maximum-transitions");
    expect(result.state.version).toBeGreaterThanOrEqual(0);
    expect(result.telemetry).toContainEqual({
      type: "safeguard-halt",
      reason: "maximum-transitions",
    });
  });

  it("smoke-certifies every automated NPC through the real combat engine", () => {
    const rows = certifyAutomatedNpcCatalog({
      dependenciesForPair: (pair, index) =>
        createBranchCombatDependencies({
          rootSeed: 100 + index,
          branchPath: ["catalog-certification", ...pair],
          fixedTime: new Date("2026-01-01T00:00:00.000Z"),
          workBudget: { maxNodes: 400, maxProbes: 400 },
        }),
      aiRandomForPair: (_pair, index) =>
        createAiRandomSource({
          rootSeed: 1_000 + index,
          profileVersion: "npc-policy:v1",
          evaluatorVersion: "npc-certification:v1",
          purpose: "catalog-certification",
        }),
      limits: { maximumTurns: 40, maximumTransitions: 250, noProgressLimit: 12 },
    });
    expect(rows).toHaveLength(Object.keys(AUTOMATED_NPC_POLICY_ASSIGNMENTS).length);
    expect(
      rows.some((row) => !row.result.ok && row.result.reason === "materialization-failure"),
    ).toBe(false);
    const unexpected = rows
      .filter(
        (row) =>
          !row.result.ok &&
          "state" in row.result &&
          !["maximum-turns", "maximum-transitions", "semantic-no-progress"].includes(
            row.result.reason,
          ),
      )
      .map((row) => ({
        pair: row.pair,
        reason: row.result.ok || !("state" in row.result) ? undefined : row.result.reason,
        failure: "failure" in row.result ? row.result.failure : undefined,
      }));
    expect(unexpected).toEqual([]);
  }, 90_000);
});
