import { describe, expect, it } from "vitest";

import {
  AUTOMATED_NPC_POLICY_ASSIGNMENTS,
  NPC_POLICY_CATALOG,
  SYNTHETIC_THREE_PHASE_BOSS_POLICY,
  SYNTHETIC_TWO_PHASE_BOSS_POLICY,
  validateNpcPolicyCatalog,
} from "./catalog.js";
import { resolveNpcAiPhase, validateNpcAiPolicy } from "./index.js";
import type { CombatantId, FightId, FightState } from "@dragonball-resurgence/combat-engine";

const selfId = "combatant:self" as CombatantId;
const opponentId = "combatant:opponent" as CombatantId;
const state = (turnNumber: number, hp: number): FightState => ({
  id: "fight:catalog" as FightId,
  schemaVersion: 4,
  version: turnNumber,
  rulesVersion: { value: "rules-v1", sourcePath: "test" },
  mode: "spar",
  turnNumber,
  combatants: {
    [selfId]: {
      id: selfId,
      hitPoints: { current: hp, maximum: 100 },
      ki: { current: 5, maximum: 10 },
      stats: { power: 20, dexterity: 5, dexterityBonus: 0 },
      moveIds: [],
      moveUses: {},
      activeStatuses: [],
      status: "active",
    },
    [opponentId]: {
      id: opponentId,
      hitPoints: { current: 100, maximum: 100 },
      ki: { current: 5, maximum: 10 },
      stats: { power: 20, dexterity: 5, dexterityBonus: 0 },
      moveIds: [],
      moveUses: {},
      activeStatuses: [],
      status: "active",
    },
  },
  activeEffects: [],
  actionHistory: [],
  resolutionFrames: [],
  scheduledWork: [],
  eventSequence: 0,
  status: "active",
  phase: "action",
  activeCombatantId: selfId,
});

describe("NPC policy catalog", () => {
  it("has stable IDs and exhaustive assignments", () => {
    expect(validateNpcPolicyCatalog()).toEqual({ ok: true, issues: [] });
    expect(new Set(NPC_POLICY_CATALOG.map((policy) => policy.id)).size).toBe(
      NPC_POLICY_CATALOG.length,
    );
    expect(Object.keys(AUTOMATED_NPC_POLICY_ASSIGNMENTS).length).toBeGreaterThan(0);
  });

  it("certifies synthetic phase thresholds and overlap priority", () => {
    expect(validateNpcAiPolicy(SYNTHETIC_TWO_PHASE_BOSS_POLICY).ok).toBe(true);
    expect(validateNpcAiPolicy(SYNTHETIC_THREE_PHASE_BOSS_POLICY).ok).toBe(true);
    expect(resolveNpcAiPhase(SYNTHETIC_TWO_PHASE_BOSS_POLICY, state(1, 100), selfId).phaseId).toBe(
      "phase-opening",
    );
    expect(resolveNpcAiPhase(SYNTHETIC_TWO_PHASE_BOSS_POLICY, state(4, 40), selfId).phaseId).toBe(
      "phase-enraged",
    );
    expect(resolveNpcAiPhase(SYNTHETIC_THREE_PHASE_BOSS_POLICY, state(4, 30), selfId).phaseId).toBe(
      "phase-enraged",
    );
  });
});
