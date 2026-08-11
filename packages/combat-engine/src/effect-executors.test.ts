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

  it("keeps the runtime registry exhaustively named", () => {
    expect(Object.keys(effectExecutorRegistry).sort()).toEqual([
      "apply-status",
      "deactivate",
      "force-action",
      "lock",
      "modify-cost",
      "modify-damage",
      "modify-resource",
      "modify-roll",
      "prevent-combat-result",
      "prevent-move-use",
      "prevent-resolution",
      "prevent-roll-modification",
      "prevent-status",
      "set-resolution-threshold",
      "set-roll-definition",
      "set-roll-result",
      "skip-action",
    ]);
  });
});
