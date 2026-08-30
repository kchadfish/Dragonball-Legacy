import { describe, expect, it } from "vitest";

import type { CombatantId, FightId, LegalDecision } from "@dragonball-resurgence/combat-engine";

import {
  type AiDecisionRequest,
  type AiMechanicsView,
  type AiProfile,
  type DiagnosticRetention,
  selectSafeLegalDecision,
} from "./index.js";
import { createAiRandomSource } from "./random.js";

const attackerId = "combatant:attacker" as CombatantId;
const defenderId = "combatant:defender" as CombatantId;

const profile: AiProfile = {
  identity: { id: "profile:baseline", version: "profile-v1" },
  personality: { version: "personality-v1", values: { aggression: 0 } },
  difficulty: { version: "difficulty-v1", level: "normal" },
};

const mechanics: AiMechanicsView = {
  version: "mechanics-v1",
  moves: [],
  items: [],
  transformations: [],
};

const state = {
  id: "fight:fixture" as FightId,
  schemaVersion: 4 as const,
  version: 3,
  rulesVersion: { gameData: "game-data-v1", config: "config-v1", engine: "engine-v1" },
  mode: "spar" as const,
  turnNumber: 1,
  combatants: {
    [attackerId]: { id: attackerId },
    [defenderId]: { id: defenderId },
  },
  activeEffects: [],
  actionHistory: [],
  resolutionFrames: [],
  scheduledWork: [],
  eventSequence: 0,
  status: "active" as const,
  phase: "action" as const,
  activeCombatantId: attackerId,
} as unknown as AiDecisionRequest["state"];

const random = createAiRandomSource({
  rootSeed: 12345,
  profileVersion: profile.identity.version,
  evaluatorVersion: "fallback-v1",
  purpose: "safe-fallback",
});

const requestFor = (
  legalDecisions: readonly LegalDecision[],
  diagnosticRetention?: DiagnosticRetention,
  randomness: "enabled" | "disabled" = "disabled",
): AiDecisionRequest => ({
  state,
  actorId: attackerId,
  legalDecisions,
  profile,
  mechanics,
  dependencies: { random, randomness },
  ...(diagnosticRetention === undefined ? {} : { diagnosticRetention }),
});

const ordinaryDecisions: readonly LegalDecision[] = [
  { type: "pass", actorId: attackerId },
  { type: "power-up", actorId: attackerId },
  { type: "surrender", actorId: attackerId },
  {
    type: "basic-attack",
    actorId: attackerId,
    basicAttack: "basic-punch",
    targetCombatantId: defenderId,
  },
  { type: "use-move", actorId: attackerId, moveId: "move:test", targetCombatantId: defenderId },
  { type: "activate-transformation", actorId: attackerId, transformationId: "transformation:test" },
  { type: "deactivate-transformation", actorId: attackerId },
  { type: "use-item", actorId: attackerId, itemId: "item:test" },
  {
    type: "respond-to-pending-decision",
    actorId: attackerId,
    pendingDecisionId: "pending-decision:test" as never,
    optionId: "candidate:one",
    selectedOptionIds: ["candidate:one", "candidate:two"],
  },
];

describe("safe legal fallback", () => {
  it("accepts every ordinary LegalDecision discriminant and preserves the supplied object", () => {
    const result = selectSafeLegalDecision(requestFor(ordinaryDecisions));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(ordinaryDecisions).toContain(result.value.decision);
      expect(result.value.decision).toBe(result.value.selectedDecision);
    }

    const pending = ordinaryDecisions[ordinaryDecisions.length - 1];
    const pendingResult = selectSafeLegalDecision(requestFor([pending]));
    expect(pendingResult.ok).toBe(true);
    if (pendingResult.ok && pendingResult.value.decision.type === "respond-to-pending-decision") {
      expect(pendingResult.value.decision).toBe(pending);
      expect(pendingResult.value.decision.selectedOptionIds).toEqual([
        "candidate:one",
        "candidate:two",
      ]);
    }
  });

  it("avoids surrender when any viable alternative exists and permits surrender alone", () => {
    const surrender: LegalDecision = { type: "surrender", actorId: attackerId };
    const pass: LegalDecision = { type: "pass", actorId: attackerId };

    const avoided = selectSafeLegalDecision(requestFor([surrender, pass]));
    const onlyChoice = selectSafeLegalDecision(requestFor([surrender]));

    expect(avoided.ok && avoided.value.decision).toBe(pass);
    expect(onlyChoice.ok && onlyChoice.value.decision).toBe(surrender);
  });

  it("reports empty, completed, actor, candidate, and duplicate failures", () => {
    const pass: LegalDecision = { type: "pass", actorId: attackerId };
    expect(selectSafeLegalDecision(requestFor([]))).toMatchObject({
      ok: false,
      error: { type: "empty-legal-set" },
    });
    expect(
      selectSafeLegalDecision({
        ...requestFor([pass]),
        state: {
          ...state,
          status: "completed",
          completion: { type: "cancelled" },
        },
      }),
    ).toMatchObject({ ok: false, error: { type: "completed-state" } });
    expect(selectSafeLegalDecision({ ...requestFor([pass]), actorId: defenderId })).toMatchObject({
      ok: false,
      error: { type: "actor-mismatch" },
    });
    expect(
      selectSafeLegalDecision(requestFor([{ type: "pass", actorId: defenderId } as LegalDecision])),
    ).toMatchObject({ ok: false, error: { type: "candidate-actor-mismatch" } });
    expect(selectSafeLegalDecision(requestFor([pass, pass]))).toMatchObject({
      ok: false,
      error: { type: "duplicate-candidate" },
    });
  });

  it("is invariant to input order, unrelated candidates, disabled randomness, and diagnostics", () => {
    const candidates: readonly LegalDecision[] = [
      { type: "pass", actorId: attackerId },
      { type: "power-up", actorId: attackerId },
      { type: "surrender", actorId: attackerId },
    ];
    const first = selectSafeLegalDecision(requestFor(candidates, "none", "enabled"));
    const permuted = selectSafeLegalDecision(
      requestFor([candidates[2], candidates[0], candidates[1]], "full", "enabled"),
    );
    const withUnrelated = selectSafeLegalDecision(
      requestFor(
        [...candidates, { type: "use-item", actorId: attackerId, itemId: "item:unrelated" }],
        "ranked-summary",
        "enabled",
      ),
    );
    const disabled = selectSafeLegalDecision(requestFor(candidates, "selection-only", "disabled"));

    expect(first.ok && permuted.ok && first.value.decision).toBe(
      permuted.ok ? permuted.value.decision : undefined,
    );
    expect(first.ok && disabled.ok && first.value.decision).toBe(
      disabled.ok ? disabled.value.decision : undefined,
    );
    expect(withUnrelated.ok).toBe(true);
    if (first.ok && permuted.ok && disabled.ok && withUnrelated.ok) {
      expect(permuted.value.diagnostics?.evaluations?.map((entry) => entry.canonicalKey)).toEqual(
        permuted.value.evaluations.map((entry) => entry.canonicalKey),
      );
      expect(first.value.evaluations).toEqual([]);
      expect(disabled.value.evaluations).toHaveLength(1);
      expect(withUnrelated.value.decision).not.toBe(candidates[2]);
    }
  });

  it("does not mutate frozen state or mechanics inputs", () => {
    const frozenState = Object.freeze(state);
    const frozenMechanics = Object.freeze(mechanics);
    const result = selectSafeLegalDecision({
      ...requestFor([{ type: "pass", actorId: attackerId }]),
      state: frozenState,
      mechanics: frozenMechanics,
    });

    expect(result.ok).toBe(true);
    expect(frozenState).toBe(state);
    expect(frozenMechanics).toBe(mechanics);
  });
});
