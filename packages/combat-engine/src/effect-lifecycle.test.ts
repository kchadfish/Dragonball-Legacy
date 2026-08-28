import { describe, expect, it } from "vitest";

import {
  isValidEffectLifecycle,
  normalizeLegacyEffectLifecycle,
  normalizeEffectLifecycle,
  normalizeEffectsLifecycle,
  lifecycleRecordForEffect,
  activateEffectLifecycle,
  deactivateEffectLifecycle,
  reactivateEffectLifecycle,
  transitionEffectLifecycle,
  transitionEffectsLifecycle,
  isEffectActive,
} from "./effect-lifecycle.js";

describe("effect lifecycle", () => {
  it.each([
    "combat",
    "owner-turn",
    "matching-action",
    "matching-roll",
    "combat-result",
    "resource-threshold",
    "roll-threshold",
    "perfect-roll",
    "turn-start-roll",
  ] as const)("advances duration at the %s boundary", (boundary) => {
    const result = transitionEffectLifecycle(
      `effect:${boundary}`,
      { state: "active", duration: { boundary, remaining: 2 } },
      boundary,
    );
    expect(result.lifecycle).toEqual({
      state: "active",
      duration: { boundary, remaining: 1 },
    });
    expect(result.events).toEqual([]);
  });

  it("consumes uses before expiring at the matching boundary", () => {
    const result = transitionEffectLifecycle(
      "effect:test",
      { state: "active", remainingUses: 1 },
      "matching-action",
    );
    expect(result.lifecycle.state).toBe("expired");
    expect(result.events.map((event) => event.type)).toEqual([
      "effect-use-consumed",
      "effect-expired",
    ]);
  });

  it("treats normalized object deactivation as inactive", () => {
    expect(isEffectActive({ lifecycle: { state: "deactivated" } })).toBe(false);
    expect(isEffectActive({ lifecycle: { state: "active" } })).toBe(true);
  });

  it("applies uses before duration and emits deterministic lifecycle events", () => {
    const result = transitionEffectLifecycle(
      "effect:ordered",
      {
        state: "active",
        remainingUses: 1,
        duration: { boundary: "matching-roll", remaining: 1 },
      },
      "matching-roll",
    );
    expect(result.lifecycle.state).toBe("expired");
    expect(result.events.map((event) => event.type)).toEqual([
      "effect-use-consumed",
      "effect-expired",
    ]);
  });

  it("does not consume the activation boundary", () => {
    const result = transitionEffectLifecycle(
      "effect:test",
      { state: "active", duration: { boundary: "owner-turn", remaining: 1 } },
      "owner-turn",
      false,
    );
    expect(result).toEqual({
      lifecycle: { state: "active", duration: { boundary: "owner-turn", remaining: 1 } },
      events: [],
    });
  });

  it("automatically skips the activating event when sequence metadata matches", () => {
    const lifecycle = {
      state: "active" as const,
      activationBoundary: "matching-action" as const,
      activationTurn: 4,
      activationEventSequence: 12,
      duration: { boundary: "matching-action" as const, remaining: 1 },
    };
    const result = transitionEffectLifecycle("effect:activation", lifecycle, {
      boundary: "matching-action",
      turnNumber: 4,
      eventSequence: 12,
    });
    expect(result).toEqual({ lifecycle, events: [] });
  });

  it("records activation metadata without consuming the boundary", () => {
    expect(
      activateEffectLifecycle(
        { state: "active", duration: { boundary: "owner-turn", remaining: 1 } },
        { activationBoundary: "owner-turn", activationTurn: 3, activationEventSequence: 8 },
      ),
    ).toMatchObject({
      state: "active",
      activationBoundary: "owner-turn",
      activationTurn: 3,
      activationEventSequence: 8,
    });
  });

  it("emits a structured event when entering deactivation or cooldown", () => {
    expect(
      deactivateEffectLifecycle("effect:deactivate", { state: "active" }, "deactivated").events,
    ).toEqual([{ type: "effect-deactivated", effectId: "effect:deactivate" }]);
    expect(
      deactivateEffectLifecycle("effect:cooldown", { state: "active" }, "cooldown").events,
    ).toEqual([{ type: "effect-cooldown-started", effectId: "effect:cooldown" }]);
  });

  it("rejects non-finite or non-positive lifecycle counters", () => {
    expect(
      isValidEffectLifecycle({ state: "active", duration: { boundary: "combat", remaining: 0 } }),
    ).toBe(false);
    expect(isValidEffectLifecycle({ state: "active", remainingUses: Number.NaN })).toBe(false);
    expect(isValidEffectLifecycle({ state: "active", activationTurn: -1 })).toBe(false);
    expect(
      isValidEffectLifecycle({ state: "active", cooldown: { boundary: "combat", remaining: -1 } }),
    ).toBe(false);
    expect(isValidEffectLifecycle({ state: "cooldown" })).toBe(false);
    expect(isValidEffectLifecycle({ state: "active", duration: { boundary: "combat" } })).toBe(
      false,
    );
    expect(isValidEffectLifecycle({ state: "active", duration: null })).toBe(false);
    expect(isValidEffectLifecycle({ state: "active", cooldown: { remaining: 1 } })).toBe(false);
  });

  it("preserves persisted effect order and event order", () => {
    const result = transitionEffectsLifecycle(
      [
        { id: "effect:first", lifecycle: { state: "active", remainingUses: 1 } },
        { id: "effect:second", lifecycle: { state: "active", remainingUses: 1 } },
      ],
      "matching-action",
    );
    expect(result.effects).toEqual([]);
    expect(result.events.map((event) => event.effectId)).toEqual([
      "effect:first",
      "effect:first",
      "effect:second",
      "effect:second",
    ]);
    expect(
      deactivateEffectLifecycle("effect:expired", { state: "expired" }, "deactivated"),
    ).toEqual({
      lifecycle: { state: "expired" },
      events: [],
    });
  });

  it("supports explicit boundary context and durable reactivation", () => {
    const skipped = transitionEffectLifecycle(
      "effect:context",
      { state: "active", remainingUses: 1 },
      { boundary: "matching-roll", matchingBoundary: false },
    );
    expect(skipped.lifecycle.remainingUses).toBe(1);
    expect(reactivateEffectLifecycle({ state: "deactivated" }).lifecycle.state).toBe("active");
  });

  it("does not consume a threshold lifecycle until its boundary fact is resolved", () => {
    const lifecycle = {
      state: "active" as const,
      duration: { boundary: "roll-threshold" as const, remaining: 1 },
    };
    expect(
      transitionEffectLifecycle("effect:threshold", lifecycle, {
        boundary: "roll-threshold",
        boundarySatisfied: false,
      }),
    ).toEqual({ lifecycle, events: [] });
    expect(
      transitionEffectLifecycle("effect:threshold", lifecycle, {
        boundary: "roll-threshold",
        boundarySatisfied: true,
      }).lifecycle.state,
    ).toBe("expired");
  });

  it.each([
    ["combat", { boundary: "combat", remaining: 1 }],
    ["owner-turn", { boundary: "owner-turn", remaining: 2 }],
    ["matching-roll", { boundary: "matching-roll", remaining: 1 }],
  ] as const)("decrements the %s duration only at its boundary", (boundary, duration) => {
    const skipped = transitionEffectLifecycle(
      "effect:duration",
      { state: "active", duration },
      { boundary: boundary === "combat" ? "owner-turn" : "combat" },
    );
    expect(skipped.lifecycle.duration).toEqual(duration);
    const applied = transitionEffectLifecycle(
      "effect:duration",
      { state: "active", duration },
      boundary,
    );
    expect(applied.lifecycle.duration?.remaining).toBe(duration.remaining - 1);
  });

  it.each([
    "combat",
    "owner-turn",
    "matching-action",
    "matching-roll",
    "combat-result",
    "resource-threshold",
    "roll-threshold",
    "perfect-roll",
    "turn-start-roll",
  ] as const)("accepts the %s lifecycle boundary", (boundary) => {
    const result = transitionEffectLifecycle(
      "effect:boundary",
      { state: "active", duration: { boundary, remaining: 2 } },
      boundary,
    );
    expect(result.lifecycle.duration?.remaining).toBe(1);
  });

  it("starts cooldown without consuming a deactivated effect", () => {
    const result = transitionEffectLifecycle(
      "effect:cooldown",
      { state: "cooldown", cooldown: { boundary: "owner-turn", remaining: 1 } },
      "owner-turn",
    );
    expect(result.lifecycle.state).toBe("active");
    expect(result.lifecycle.cooldown?.remaining).toBe(0);
  });

  it("normalizes legacy specialized counters for backward-read compatibility", () => {
    expect(normalizeLegacyEffectLifecycle({ lifecycle: "deactivated", remainingTurns: 2 })).toEqual(
      {
        state: "deactivated",
        duration: { boundary: "owner-turn", remaining: 2 },
      },
    );
    expect(normalizeLegacyEffectLifecycle({ remainingActions: 1 })).toEqual({
      state: "active",
      duration: { boundary: "matching-action", remaining: 1 },
    });
    expect(normalizeLegacyEffectLifecycle({ lifecycle: "cooldown", remainingTurns: 2 })).toEqual({
      state: "cooldown",
      cooldown: { boundary: "owner-turn", remaining: 2 },
    });
  });

  it("promotes typed duration payloads to the shared lifecycle record", () => {
    expect(
      normalizeLegacyEffectLifecycle({
        type: "modify-damage",
        duration: { type: "turns", ownerCombatantId: "combatant:a", remaining: 2 },
      }),
    ).toEqual({
      state: "active",
      duration: { boundary: "owner-turn", remaining: 2 },
    });
    expect(
      normalizeEffectLifecycle({
        id: "effect:combat",
        type: "action-lock",
        duration: { type: "combat" },
      }).lifecycle,
    ).toEqual({ state: "active", duration: { boundary: "combat", remaining: 1 } });
    expect(normalizeLegacyEffectLifecycle({ duration: { type: "uses", remaining: 2 } })).toEqual({
      state: "active",
      duration: { boundary: "matching-action", remaining: 2 },
    });
    expect(normalizeLegacyEffectLifecycle({ remainingAttacks: 1 })).toEqual({
      state: "active",
      duration: { boundary: "matching-action", remaining: 1 },
    });
    expect(normalizeLegacyEffectLifecycle({ duration: { type: "turns", remaining: 0 } })).toEqual({
      state: "expired",
    });
  });

  it("adds a canonical lifecycle record to a legacy snapshot effect", () => {
    const normalized = normalizeEffectLifecycle({
      id: "effect:legacy",
      lifecycle: "deactivated",
      remainingTurns: 2,
    });
    expect(normalized.lifecycle).toEqual({
      state: "deactivated",
      duration: { boundary: "owner-turn", remaining: 2 },
    });
  });

  it("rejects zero-valued cooldown counters", () => {
    expect(
      isValidEffectLifecycle({
        state: "active",
        cooldown: { boundary: "owner-turn", remaining: 0 },
      }),
    ).toBe(false);
  });

  it("normalizes effect collections without reordering them", () => {
    const effects = normalizeEffectsLifecycle([
      { id: "effect:first", remainingActions: 1 },
      { id: "effect:second", lifecycle: "deactivated" },
    ]);
    expect(effects.map((effect) => effect.id)).toEqual(["effect:first", "effect:second"]);
    expect(effects[0]?.lifecycle?.duration?.boundary).toBe("matching-action");
  });

  it("prefers an explicit nested lifecycle over legacy counters", () => {
    expect(
      lifecycleRecordForEffect({
        lifecycle: { state: "cooldown", cooldown: { boundary: "combat", remaining: 2 } },
        remainingTurns: 1,
      }),
    ).toEqual({ state: "cooldown", cooldown: { boundary: "combat", remaining: 2 } });
  });

  it("normalizes an exhausted legacy counter as expired", () => {
    expect(lifecycleRecordForEffect({ id: "effect:expired", remainingActions: 0 })).toEqual({
      state: "expired",
    });
  });

  it("treats cooldown and expired effects as unavailable while preserving legacy activity", () => {
    expect(isEffectActive({ id: "legacy" })).toBe(true);
    expect(
      isEffectActive({
        id: "cooldown",
        lifecycle: { state: "cooldown", cooldown: { boundary: "combat", remaining: 1 } },
      }),
    ).toBe(false);
    expect(isEffectActive({ id: "expired", lifecycle: { state: "expired" } })).toBe(false);
  });

  it("treats malformed nested lifecycle records as unavailable", () => {
    expect(
      isEffectActive({
        id: "effect:malformed",
        lifecycle: { state: "cooldown", cooldown: { boundary: "combat", remaining: 0 } },
      }),
    ).toBe(false);
  });

  it("treats unknown legacy lifecycle strings as unavailable", () => {
    expect(isEffectActive({ lifecycle: "unknown" })).toBe(false);
    expect(isValidEffectLifecycle({ state: "unknown" })).toBe(false);
  });
});
