import { describe, expect, it } from "vitest";

import { MOVE_DEFINITIONS } from "@dragonball-resurgence/game-data";

import {
  compileEffectPlan,
  effectExecutorRegistry,
  executeCompiledEffect,
} from "./effect-executors.js";

const moveWithId = (moveId: string) => {
  const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === moveId);
  if (move === undefined) throw new Error(`Missing test move ${moveId}.`);
  return move;
};

const effectAt = (moveId: string, effectIndex: number) => {
  const move = moveWithId(moveId);
  const effect = move.effects?.[effectIndex];
  if (effect === undefined) throw new Error(`Missing effect ${moveId}#${effectIndex}.`);
  return { move, effect };
};

const firstEffectOfType = (moveId: string, type: string) => {
  const move = moveWithId(moveId);
  const effectIndex = move.effects?.findIndex((effect) => effect.type === type) ?? -1;
  if (effectIndex < 0) throw new Error(`Missing ${type} effect on ${moveId}.`);
  return effectAt(moveId, effectIndex);
};

describe("declarative effect executor registry", () => {
  it("compiles and executes a supported damage effect with durable provenance", () => {
    const { move, effect } = effectAt("move-afterlife-kamehameha", 0);
    const compiled = compileEffectPlan({
      sourceDefinitionId: move.id,
      effectIndex: 0,
      effect,
    });

    expect(compiled).toMatchObject({
      ok: true,
      value: {
        type: "modify-damage",
        sourceDefinitionId: move.id,
        effectIndex: 0,
      },
    });
    if (!compiled.ok) return;

    expect(executeCompiledEffect(compiled.value, { move, target: "self" })).toMatchObject({
      type: "declarative-effect",
      sourceDefinitionId: move.id,
      effectIndex: 0,
      target: "self",
      effect: { type: "modify-damage" },
    });
  });

  it("rejects an optional activation-group effect instead of compiling it as automatic work", () => {
    const { move, effect } = effectAt("move-kiihakai-orange-burst", 0);
    const compiled = compileEffectPlan({
      sourceDefinitionId: move.id,
      effectIndex: 0,
      effect,
    });

    expect(compiled).toMatchObject({ ok: false });
    if (compiled.ok) return;
    expect(compiled.issues).toContainEqual(
      expect.objectContaining({
        code: "requires-pending-choice",
        sourceDefinitionId: move.id,
        effectIndex: 0,
      }),
    );
  });

  it("rejects an effect discriminant without a registered executor", () => {
    const { move, effect } = effectAt("move-afterlife-give-me-energy", 0);
    const compiled = compileEffectPlan({
      sourceDefinitionId: move.id,
      effectIndex: 0,
      effect,
    });

    expect(compiled).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "unsupported-effect-type",
          sourceDefinitionId: move.id,
          effectIndex: 0,
        }),
      ],
    });
  });

  it("compiles direct resolution thresholds and rejects relative-roll variants", () => {
    const direct = effectAt("move-afterlife-scatter-shot", 0);
    expect(
      compileEffectPlan({
        sourceDefinitionId: direct.move.id,
        effectIndex: 0,
        effect: direct.effect,
      }),
    ).toMatchObject({ ok: true });

    const relative = effectAt("move-afterlife-s-s-deadly-bomb", 0);
    const rejected = compileEffectPlan({
      sourceDefinitionId: relative.move.id,
      effectIndex: 0,
      effect: relative.effect,
    });
    expect(rejected).toMatchObject({ ok: false });
    if (rejected.ok) return;
    expect(rejected.issues).toContainEqual(
      expect.objectContaining({ code: "unsupported-variant" }),
    );
  });

  it("compiles a flat floating bundle and rejects lifecycle variants it cannot persist", () => {
    const supported = effectAt("move-akaikaru-anger-management", 0);
    expect(
      compileEffectPlan({
        sourceDefinitionId: supported.move.id,
        effectIndex: 0,
        effect: supported.effect,
      }),
    ).toMatchObject({ ok: true });

    const unsupported = effectAt("move-haokiru-dragon-dust", 0);
    const rejected = compileEffectPlan({
      sourceDefinitionId: unsupported.move.id,
      effectIndex: 0,
      effect: unsupported.effect,
    });
    expect(rejected).toMatchObject({ ok: false });
    if (rejected.ok) return;
    expect(rejected.issues).toContainEqual(
      expect.objectContaining({ code: "unsupported-variant" }),
    );
  });

  it("compiles same-turn source-move extra actions and rejects scheduled variants", () => {
    const supported = effectAt("move-akaikaru-chained-strikes", 0);
    expect(
      compileEffectPlan({
        sourceDefinitionId: supported.move.id,
        effectIndex: 0,
        effect: supported.effect,
      }),
    ).toMatchObject({ ok: true });

    const scheduled = effectAt("move-afterlife-destructo-disc", 0);
    const rejected = compileEffectPlan({
      sourceDefinitionId: scheduled.move.id,
      effectIndex: 0,
      effect: scheduled.effect,
    });
    expect(rejected).toMatchObject({ ok: false });
    if (rejected.ok) return;
    expect(rejected.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "unsupported-variant" })]),
    );
  });

  it("compiles the exact initial reroll variants and retains their source identity", () => {
    for (const moveId of [
      "move-akaikaru-swift-reaction",
      "move-kurokonwaku-second-chance",
      "move-aoyosumu-zen-explosion",
    ]) {
      const { move, effect } = firstEffectOfType(moveId, "reroll");
      const compiled = compileEffectPlan({
        sourceDefinitionId: move.id,
        effectIndex: move.effects?.indexOf(effect) ?? 0,
        effect,
      });
      expect(compiled).toMatchObject({
        ok: true,
        value: { type: "reroll", sourceDefinitionId: move.id },
      });
    }
  });

  it("keeps the runtime registry exhaustively named", () => {
    expect(Object.keys(effectExecutorRegistry).sort()).toEqual([
      "apply-status",
      "create-floating-effect",
      "deactivate",
      "force-action",
      "grant-extra-action",
      "lock",
      "modify-cost",
      "modify-damage",
      "modify-resource",
      "modify-roll",
      "prevent-combat-result",
      "prevent-move-modification",
      "prevent-move-use",
      "prevent-resolution",
      "prevent-resource-modification",
      "prevent-roll-modification",
      "prevent-status",
      "reroll",
      "set-resolution-threshold",
      "set-roll-definition",
      "set-roll-result",
      "skip-action",
    ]);
  });
});
