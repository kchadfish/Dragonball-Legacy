import { describe, expect, it } from "vitest";

import { NPC_DEFINITIONS } from "@dragonball-resurgence/game-data";

import {
  NPC_NORMALIZATION_OVERLAYS,
  assessNpcReadiness,
  materializeNpcCombatant,
  npcReadinessMatrix,
} from "./normalization.js";

describe("NPC normalization and readiness", () => {
  it("accounts for every canonical NPC exactly once", () => {
    const rows = npcReadinessMatrix();
    expect(rows).toHaveLength(NPC_DEFINITIONS.length);
    expect(new Set(rows.map((row) => row.npcId)).size).toBe(NPC_DEFINITIONS.length);
    expect(rows.every((row) => row.sourceReference.path.startsWith("reference/"))).toBe(true);
  });

  it("materializes an automated NPC without mutating canonical data", () => {
    const before = JSON.stringify(
      NPC_DEFINITIONS.find((npc) => npc.id === "npc-earth-east-limax-1"),
    );
    const result = materializeNpcCombatant("npc-earth-east-limax-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stats.dexterityBonus).toBe(0);
    expect(result.value.moveIds).toHaveLength(9);
    expect(JSON.stringify(NPC_DEFINITIONS.find((npc) => npc.id === "npc-earth-east-limax-1"))).toBe(
      before,
    );
  });

  it("fails closed for relative source stats and unresolved mechanics", () => {
    const relative = NPC_DEFINITIONS.find((npc) => npc.id === "npc-basbas-bogro-1")!;
    const result = assessNpcReadiness(relative);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.row.issues.map((issue) => issue.reason)).toEqual(
      expect.arrayContaining(["relative-stat", "unresolved-move", "unknown-equipment"]),
    );
    expect(materializeNpcCombatant(relative.id).ok).toBe(false);
  });

  it("keeps the normalization overlay narrower than the canonical catalog", () => {
    expect(NPC_NORMALIZATION_OVERLAYS.every((overlay) => overlay.npcId.startsWith("npc-"))).toBe(
      true,
    );
    expect(
      NPC_NORMALIZATION_OVERLAYS.every(
        (overlay) => overlay.dexterityAllocationPercent !== undefined,
      ),
    ).toBe(true);
    expect(NPC_NORMALIZATION_OVERLAYS.some((overlay) => "moveIds" in overlay)).toBe(false);
  });
});
