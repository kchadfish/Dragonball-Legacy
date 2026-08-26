import { describe, expect, it } from "vitest";

import type { EffectDefinition } from "@dragonball-resurgence/game-data";

import type { ActiveCombatEffect, ConflictPolicy } from "./contracts.js";
import { compileEffectPlan } from "./effect-executors.js";
import { activeEffectIdSchema, combatantIdSchema } from "./ids.js";
import { conflictKeyFor, resolveActiveEffectConflicts } from "./conflict-policy.js";

const sourceCombatantId = combatantIdSchema.parse("combatant:source");
const targetCombatantId = combatantIdSchema.parse("combatant:target");

const effect = (id: string, overrides: Partial<ActiveCombatEffect> = {}): ActiveCombatEffect =>
  ({
    id: activeEffectIdSchema.parse(`active-effect:${id}`),
    type: "modify-next-action",
    sourceCombatantId,
    targetCombatantId,
    sourceDefinitionId: "move:test-effect",
    sourceEffectIndex: 0,
    scope: "next-action",
    modifier: { type: "damage", amount: 10 },
    ...overrides,
  }) as ActiveCombatEffect;

const policy = (conflictPolicy: ConflictPolicy) => ({ conflictPolicy });

describe("durable effect conflict policy", () => {
  it("stacks ordinary modifiers by default but preserves target identity in the key", () => {
    const first = effect("first");
    const second = effect("second", { modifier: { type: "damage", amount: 20 } });
    const result = resolveActiveEffectConflicts([first], [second]);

    expect(result.effects).toHaveLength(2);
    expect(conflictKeyFor(first)).not.toBe(
      conflictKeyFor(effect("different-target", { targetCombatantId: sourceCombatantId })),
    );
  });

  it("prevents only the matching effect and leaves different scopes independent", () => {
    const first = effect("first", policy({ type: "prevent-duplicate" }));
    const duplicate = effect("duplicate", policy({ type: "prevent-duplicate" }));
    const differentScope = effect("different-scope", {
      ...policy({ type: "prevent-duplicate" }),
      scope: "next-roll",
    });

    const result = resolveActiveEffectConflicts([first], [duplicate, differentScope]);

    expect(result.effects.map((candidate) => candidate.id)).toEqual([first.id, differentScope.id]);
    expect(result.decisions.map((decision) => decision.action)).toEqual(["discard", "append"]);
  });

  it("replaces a matching effect while retaining the existing identity when requested", () => {
    const first = effect("first");
    const incoming = effect("replacement", {
      ...policy({ type: "replace", provenance: "existing" }),
      modifier: { type: "damage", amount: 25 },
    });

    const result = resolveActiveEffectConflicts([first], [incoming]);

    expect(result.effects).toHaveLength(1);
    expect(result.effects[0]).toMatchObject({ id: first.id, modifier: { amount: 25 } });
    expect(result.decisions[0]?.action).toBe("replace");
  });

  it("refreshes duration and remaining uses without changing the active effect ID", () => {
    const first = effect("first", {
      duration: { type: "next-action", combatantId: targetCombatantId },
      remaining: 1,
    });
    const incoming = effect("refresh", {
      ...policy({
        type: "refresh",
        duration: "incoming",
        uses: "incoming",
        provenance: "existing",
      }),
      duration: { type: "next-actions", ownerCombatantId: targetCombatantId, remaining: 3 },
      remaining: 3,
    });

    const result = resolveActiveEffectConflicts([first], [incoming]);

    expect(result.effects[0]).toMatchObject({
      id: first.id,
      duration: { type: "next-actions" },
      remaining: 3,
    });
    expect(result.decisions[0]?.action).toBe("refresh");
  });

  it("retains the highest or lowest value with explicit tie behavior", () => {
    const highest = effect("highest", {
      ...policy({ type: "retain", selection: "highest", value: "amount", tie: "incoming" }),
      modifier: { type: "damage", amount: 20 },
    });
    const higher = effect("higher", {
      ...policy({ type: "retain", selection: "highest", value: "amount", tie: "incoming" }),
      modifier: { type: "damage", amount: 30 },
    });
    const tie = effect("tie", {
      ...policy({ type: "retain", selection: "highest", value: "amount", tie: "incoming" }),
      modifier: { type: "damage", amount: 30 },
    });

    const result = resolveActiveEffectConflicts([highest], [higher, tie]);

    expect(result.effects).toHaveLength(1);
    expect(result.effects[0]?.id).toBe(tie.id);
    expect(result.decisions.map((decision) => decision.action)).toEqual(["replace", "replace"]);
  });

  it("rejects a retain policy when the effect has no safely comparable value", () => {
    const incoming = effect("unsupported", {
      ...policy({ type: "retain", selection: "highest", value: "amount", tie: "existing" }),
      modifier: { type: "roll-definition", roll: "attack", sides: 30 },
    });

    const result = resolveActiveEffectConflicts([], [incoming]);

    expect(result.effects).toEqual([]);
    expect(result.decisions[0]?.action).toBe("unsupported");
  });

  it("accepts supported source-backed conflict policies during compilation", () => {
    const definition: EffectDefinition = {
      type: "modify-damage",
      trigger: "passive",
      target: "self",
      operation: "add",
      percent: { type: "literal", value: 10 },
      conflictPolicy: {
        type: "retain",
        selection: "highest",
        value: "amount",
        tie: "existing",
        sourceText: "retain the highest modifier",
      },
      sourceText: "add 10% damage",
    };

    expect(
      compileEffectPlan({ sourceDefinitionId: "move:test", effectIndex: 0, effect: definition }),
    ).toMatchObject({ ok: true });
  });

  it("reports unsupported source-backed conflict policy variants", () => {
    const definition: EffectDefinition = {
      type: "apply-status",
      trigger: "passive",
      target: "self",
      statusId: "status-burn",
      conflictPolicy: {
        type: "retain",
        selection: "highest",
        value: "amount",
        tie: "existing",
        sourceText: "retain the highest status",
      },
      sourceText: "apply burn",
    };

    expect(
      compileEffectPlan({ sourceDefinitionId: "move:test", effectIndex: 0, effect: definition }),
    ).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "unsupported-variant",
          message: "Highest/lowest conflict policies require a safely comparable modifier amount.",
        }),
      ],
    });
  });
});
