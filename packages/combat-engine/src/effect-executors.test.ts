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
  it("compiles the exact successful CONSTANT Skill activation variant", () => {
    const { move, effect } = firstEffectOfType("move-freestyle-monkey-sweep", "activate");
    const compiled = compileEffectPlan({
      sourceDefinitionId: move.id,
      effectIndex: move.effects!.indexOf(effect),
      effect,
      allowPendingChoice: true,
    });

    expect(compiled).toMatchObject({ ok: true, value: { type: "activate" } });
    if (!compiled.ok) return;
    expect(executeCompiledEffect(compiled.value, { move, target: "self" }).effect).toMatchObject({
      type: "activate",
      trigger: "on-success",
      target: "self",
    });
  });

  it("compiles exact stored rolls and only their faithfully executable immediate consumers", () => {
    for (const moveId of [
      "move-afterlife-solar-flare",
      "move-afterlife-petrifying-spit",
      "move-akaikaru-impulsive",
      "move-haokiru-healing-ray",
      "move-kurokonwaku-ki-trap",
    ]) {
      const { move, effect } = effectAt(moveId, 0);
      expect(
        compileEffectPlan({ sourceDefinitionId: move.id, effectIndex: 0, effect }),
        moveId,
      ).toMatchObject({ ok: true, value: { type: "roll-and-store" } });
    }

    for (const [moveId, effectIndex] of [
      ["move-afterlife-solar-flare", 1],
      ["move-haokiru-healing-ray", 4],
    ] as const) {
      const { move, effect } = effectAt(moveId, effectIndex);
      expect(compileEffectPlan({ sourceDefinitionId: move.id, effectIndex, effect })).toMatchObject(
        { ok: true },
      );
    }

    const petrifyingStatus = effectAt("move-afterlife-petrifying-spit", 1);
    expect(
      compileEffectPlan({
        sourceDefinitionId: petrifyingStatus.move.id,
        effectIndex: 1,
        effect: petrifyingStatus.effect,
      }),
    ).toMatchObject({ ok: false });

    const initialSkip = effectAt("move-afterlife-petrifying-spit", 2);
    expect(
      compileEffectPlan({
        sourceDefinitionId: initialSkip.move.id,
        effectIndex: 2,
        effect: initialSkip.effect,
      }),
    ).toMatchObject({ ok: true, value: { type: "skip-action" } });
  });

  it("compiles exact future-turn action restrictions and rejects choice or turn-end lifecycles", () => {
    for (const [moveId, effectIndex] of [
      ["move-afterlife-petrifying-spit", 2],
      ["move-aoyosumu-serenity-wave", 0],
      ["move-aoyosumu-serenity-wave", 1],
      ["move-aoyosumu-sonic-whisper", 0],
      ["move-kiihakai-focus-buster", 0],
      ["move-kiihakai-focus-buster", 1],
      ["move-kiihakai-heat-seeking-blast", 0],
      ["move-kurokonwaku-shadow-realm", 1],
    ] as const) {
      const { move, effect } = effectAt(moveId, effectIndex);
      expect(
        compileEffectPlan({ sourceDefinitionId: move.id, effectIndex, effect }),
        `${moveId}#${effectIndex}`,
      ).toMatchObject({ ok: true, value: { type: "skip-action" } });
    }

    for (const [moveId, effectIndex] of [
      ["move-afterlife-petrifying-spit", 3],
      ["move-kiihakai-power-boost", 0],
    ] as const) {
      const { move, effect } = effectAt(moveId, effectIndex);
      expect(
        compileEffectPlan({ sourceDefinitionId: move.id, effectIndex, effect }),
        `${moveId}#${effectIndex}`,
      ).toMatchObject({ ok: false });
    }
  });

  it("compiles exact current-action tag additions and rejects selection or style lifecycles", () => {
    const supported = [
      "move-akaikaru-shock-fist",
      "move-akaikaru-blitzkrieg",
      "move-akaikaru-no-shadow-kick",
      "move-kiihakai-turn-up-the-heat",
    ];
    for (const moveId of supported) {
      const move = moveWithId(moveId);
      const effectIndex =
        move.effects?.findIndex((effect) => effect.type === "modify-move-classification") ?? -1;
      const effect = move.effects?.[effectIndex];
      if (effect === undefined) throw new Error(`Missing classification effect ${moveId}.`);
      expect(
        compileEffectPlan({ sourceDefinitionId: move.id, effectIndex, effect }),
        `${moveId}#${effectIndex}`,
      ).toMatchObject({ ok: true, value: { type: "modify-move-classification" } });
    }

    for (const moveId of [
      "move-akaikaru-intensity-mastery",
      "move-freestyle-ki-color-cascade",
      "move-haokiru-karmic-chameleon-mastery",
    ]) {
      const move = moveWithId(moveId);
      const effectIndex =
        move.effects?.findIndex((effect) => effect.type === "modify-move-classification") ?? -1;
      const effect = move.effects?.[effectIndex];
      if (effect === undefined) throw new Error(`Missing classification effect ${moveId}.`);
      expect(compileEffectPlan({ sourceDefinitionId: move.id, effectIndex, effect })).toMatchObject(
        {
          ok: false,
        },
      );
    }
  });

  it("compiles exact restricted-use changes and rejects choice or history-dependent variants", () => {
    const supported = [
      "move-afterlife-x20-kaioken-kamehameha",
      "move-aoyosumu-super-arm-bar-takedown",
      "move-kurokonwaku-breaking-the-cycle",
      "move-kurokonwaku-neuron-disruptor",
    ];
    for (const moveId of supported) {
      const move = moveWithId(moveId);
      const effectIndex =
        move.effects?.findIndex((effect) => effect.type === "modify-remaining-uses") ?? -1;
      const effect = move.effects?.[effectIndex];
      if (effect === undefined) throw new Error(`Missing restricted-use effect ${moveId}.`);
      expect(
        compileEffectPlan({ sourceDefinitionId: move.id, effectIndex, effect }),
        `${moveId}#${effectIndex}`,
      ).toMatchObject({ ok: true, value: { type: "modify-remaining-uses" } });
    }

    for (const moveId of ["move-aoyosumu-ceasefire-mastery", "move-haokiru-halting-stance"]) {
      const move = moveWithId(moveId);
      const effectIndex =
        move.effects?.findIndex((effect) => effect.type === "modify-remaining-uses") ?? -1;
      const effect = move.effects?.[effectIndex];
      if (effect === undefined) throw new Error(`Missing restricted-use effect ${moveId}.`);
      expect(compileEffectPlan({ sourceDefinitionId: move.id, effectIndex, effect })).toMatchObject(
        {
          ok: false,
        },
      );
    }
  });

  it("compiles every non-choice scheduled resource occurrence and rejects the pending choice", () => {
    const supported = [
      "move-afterlife-burning-shoot",
      "move-akaikaru-continuous-knee-smash",
      "move-akaikaru-prism-inferno",
      "move-aoyosumu-bomb-tag",
      "move-freestyle-bullet-ballet",
      "move-freestyle-cannons-sparking",
      "move-kurokonwaku-poison-mist",
      "move-kurokonwaku-shadow-realm",
    ];
    for (const moveId of supported) {
      const move = moveWithId(moveId);
      const effectIndex =
        move.effects?.findIndex((effect) => effect.type === "schedule-effect") ?? -1;
      const effect = move.effects?.[effectIndex];
      if (effect === undefined) throw new Error(`Missing scheduled effect ${moveId}.`);
      expect(
        compileEffectPlan({ sourceDefinitionId: move.id, effectIndex, effect }),
        `${moveId}#${effectIndex}`,
      ).toMatchObject({ ok: true, value: { type: "schedule-effect" } });
    }

    const straining = moveWithId("move-freestyle-straining-bodyslam");
    const effectIndex =
      straining.effects?.findIndex((effect) => effect.type === "schedule-effect") ?? -1;
    const effect = straining.effects?.[effectIndex];
    if (effect === undefined) throw new Error("Missing Straining Bodyslam schedule.");
    expect(
      compileEffectPlan({ sourceDefinitionId: straining.id, effectIndex, effect }),
    ).toMatchObject({ ok: false });
  });

  it("only compiles Straining Bodyslam's grouped effects when pending choice is explicit", () => {
    const move = moveWithId("move-freestyle-straining-bodyslam");
    const effects = move.effects ?? [];
    expect(
      compileEffectPlan({
        sourceDefinitionId: move.id,
        effectIndex: 0,
        effect: effects[0]!,
      }),
    ).toMatchObject({ ok: false, issues: [{ code: "requires-pending-choice" }] });
    expect(
      compileEffectPlan({
        sourceDefinitionId: move.id,
        effectIndex: 0,
        effect: effects[0]!,
        allowPendingChoice: true,
      }),
    ).toMatchObject({ ok: true, value: { type: "modify-resource" } });
  });

  it("compiles floating bundles with an attack roll threshold duration", () => {
    const supported = effectAt("move-kiihakai-the-rising-sun", 0);
    expect(
      compileEffectPlan({
        sourceDefinitionId: supported.move.id,
        effectIndex: 0,
        effect: supported.effect,
      }),
    ).toMatchObject({
      ok: true,
      value: { type: "create-floating-effect" },
    });

    const supportedThreshold = effectAt("move-haokiru-dragon-dust", 0);
    expect(
      compileEffectPlan({
        sourceDefinitionId: supportedThreshold.move.id,
        effectIndex: 0,
        effect: supportedThreshold.effect,
      }),
    ).toMatchObject({ ok: true, value: { type: "create-floating-effect" } });

    const unsupported = {
      ...supportedThreshold.effect,
      duration: {
        type: "until-roll-threshold" as const,
        roll: "transformation" as const,
        comparison: "at-least" as const,
        value: { type: "literal" as const, value: 23 },
        sourceText: "test",
      },
    };
    expect(
      compileEffectPlan({
        sourceDefinitionId: supportedThreshold.move.id,
        effectIndex: 0,
        effect: unsupported as never,
      }),
    ).toMatchObject({ ok: false, issues: [{ code: "unsupported-variant" }] });
  });

  it("compiles a resource change with a typed numeric cap", () => {
    const { move, effect } = effectAt("move-kiihakai-power-surge-mastery", 1);
    const compiled = compileEffectPlan({
      sourceDefinitionId: move.id,
      effectIndex: 1,
      effect,
    });

    expect(compiled).toMatchObject({
      ok: true,
      value: {
        type: "modify-resource",
        sourceDefinitionId: move.id,
        effectIndex: 1,
      },
    });
  });

  it("compiles Psycho Driver's deferred damage-based resource change", () => {
    const { move, effect } = effectAt("move-kurokonwaku-psycho-driver", 0);
    const compiled = compileEffectPlan({
      sourceDefinitionId: move.id,
      effectIndex: 0,
      effect,
    });

    expect(compiled).toMatchObject({
      ok: true,
      value: {
        type: "modify-resource",
        sourceDefinitionId: move.id,
        effectIndex: 0,
      },
    });

    const unsupported = {
      ...effect,
      activationCost: {
        resource: "ki" as const,
        operation: "lose" as const,
        amount: { type: "literal" as const, value: 1 },
      },
    };
    expect(
      compileEffectPlan({
        sourceDefinitionId: move.id,
        effectIndex: 0,
        effect: unsupported,
      }),
    ).toMatchObject({ ok: false, issues: [{ code: "unsupported-variant" }] });
  });

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
    const { move, effect } = effectAt("move-kiihakai-fierce-focus-mastery", 2);
    const compiled = compileEffectPlan({
      sourceDefinitionId: move.id,
      effectIndex: 2,
      effect,
    });

    expect(compiled).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "unsupported-effect-type",
          sourceDefinitionId: move.id,
          effectIndex: 2,
        }),
      ],
    });
  });

  it("compiles direct and typed relative resolution thresholds", () => {
    const direct = effectAt("move-afterlife-scatter-shot", 0);
    expect(
      compileEffectPlan({
        sourceDefinitionId: direct.move.id,
        effectIndex: 0,
        effect: direct.effect,
      }),
    ).toMatchObject({ ok: true });

    const relative = effectAt("move-afterlife-s-s-deadly-bomb", 0);
    const compiledRelative = compileEffectPlan({
      sourceDefinitionId: relative.move.id,
      effectIndex: 0,
      effect: relative.effect,
    });
    expect(compiledRelative).toMatchObject({ ok: true });
  });

  it("compiles current-attack combat-result overrides with explicit timing", () => {
    const backSuplex = effectAt("move-midorikatai-back-suplex", 0);
    expect(
      compileEffectPlan({
        sourceDefinitionId: backSuplex.move.id,
        effectIndex: 0,
        effect: backSuplex.effect,
      }),
    ).toMatchObject({ ok: true });

    const deferred = effectAt("move-aoyosumu-tranquil-strike", 0);
    const rejected = compileEffectPlan({
      sourceDefinitionId: deferred.move.id,
      effectIndex: 0,
      effect: deferred.effect,
    });
    expect(rejected).toMatchObject({ ok: false });
    if (rejected.ok) return;
    expect(rejected.issues).toContainEqual(
      expect.objectContaining({ code: "unsupported-variant" }),
    );
  });

  it("compiles durable stat modifiers and rejects undispatched trigger variants", () => {
    const supported = effectAt("move-midorikatai-rocket-fire", 0);
    expect(
      compileEffectPlan({
        sourceDefinitionId: supported.move.id,
        effectIndex: 0,
        effect: supported.effect,
      }),
    ).toMatchObject({ ok: true });

    const undispatched = {
      ...supported,
      effect: { ...supported.effect, trigger: "on-roll-modified" as const },
    };
    const rejected = compileEffectPlan({
      sourceDefinitionId: undispatched.move.id,
      effectIndex: 1,
      effect: undispatched.effect,
    });
    expect(rejected).toMatchObject({ ok: false });
    if (rejected.ok) return;
    expect(rejected.issues).toContainEqual(
      expect.objectContaining({
        code: "unsupported-trigger",
        sourceDefinitionId: undispatched.move.id,
      }),
    );

    const unsupportedScope = compileEffectPlan({
      sourceDefinitionId: supported.move.id,
      effectIndex: 0,
      effect: {
        ...supported.effect,
        scope: { type: "next-phase", subject: "self", phase: "action", sourceText: "test" },
      } as never,
    });
    expect(unsupportedScope).toMatchObject({ ok: false });

    const immediate = compileEffectPlan({
      sourceDefinitionId: supported.move.id,
      effectIndex: 0,
      effect: { ...supported.effect, duration: undefined } as never,
    });
    expect(immediate).toMatchObject({ ok: false });
  });

  it("compiles durable suppressions and rejects resolution-local variants", () => {
    const supported = effectAt("move-kurokonwaku-dismissive-kick", 0);
    expect(
      compileEffectPlan({
        sourceDefinitionId: supported.move.id,
        effectIndex: 0,
        effect: supported.effect,
      }),
    ).toMatchObject({ ok: true });

    const nextAction = effectAt("move-midorikatai-power-drill", 0);
    expect(
      compileEffectPlan({
        sourceDefinitionId: nextAction.move.id,
        effectIndex: 0,
        effect: nextAction.effect,
      }),
    ).toMatchObject({ ok: true });

    const currentResolution = effectAt("move-aoyosumu-breakout", 1);
    const rejected = compileEffectPlan({
      sourceDefinitionId: currentResolution.move.id,
      effectIndex: 1,
      effect: currentResolution.effect,
    });
    expect(rejected).toMatchObject({ ok: false });
    if (rejected.ok) return;
    expect(rejected.issues).toContainEqual(
      expect.objectContaining({
        code: "unsupported-variant",
        sourceDefinitionId: currentResolution.move.id,
      }),
    );

    const compileVariant = (effect: unknown) =>
      compileEffectPlan({
        sourceDefinitionId: supported.move.id,
        effectIndex: 0,
        effect: effect as never,
      });

    expect(compileVariant({ ...supported.effect, aspects: [] })).toMatchObject({ ok: false });
    expect(compileVariant({ ...supported.effect, aspects: ["unsupported-aspect"] })).toMatchObject({
      ok: false,
    });
    expect(
      compileVariant({
        ...supported.effect,
        scope: { type: "following-action", offset: 2, sourceText: "test" },
        duration: undefined,
      }),
    ).toMatchObject({ ok: false });
    expect(
      compileVariant({
        ...supported.effect,
        scope: { type: "next-action", sourceText: "test" },
        duration: { type: "combat", sourceText: "test" },
      }),
    ).toMatchObject({ ok: false });
    expect(
      compileVariant({
        ...supported.effect,
        duration: {
          type: "until-resource-threshold",
          subject: "opponent",
          resource: "hp",
          comparison: "at-most",
          value: { type: "literal", value: 10 },
          sourceText: "test",
        },
      }),
    ).toMatchObject({ ok: false });
    expect(
      compileVariant({
        ...supported.effect,
        duration: {
          type: "until-roll-threshold",
          roll: "defense",
          comparison: "at-least",
          value: { type: "literal", value: 10 },
          sourceText: "test",
        },
      }),
    ).toMatchObject({ ok: false });
    expect(
      compileVariant({
        ...supported.effect,
        duration: {
          type: "turns",
          turns: { type: "unsupported-expression" },
          sourceText: "test",
        },
      }),
    ).toMatchObject({ ok: false });
    expect(
      compileVariant({
        ...supported.effect,
        activationCost: {
          resource: "ki",
          amount: { type: "literal", value: 1 },
          operation: "lose",
        },
      }),
    ).toMatchObject({ ok: false });
  });

  it("compiles flat floating bundles and preserves supported lifecycle variants", () => {
    const supported = effectAt("move-akaikaru-anger-management", 0);
    expect(
      compileEffectPlan({
        sourceDefinitionId: supported.move.id,
        effectIndex: 0,
        effect: supported.effect,
      }),
    ).toMatchObject({ ok: true });

    const threshold = effectAt("move-haokiru-dragon-dust", 0);
    const compiledThreshold = compileEffectPlan({
      sourceDefinitionId: threshold.move.id,
      effectIndex: 0,
      effect: threshold.effect,
    });
    expect(compiledThreshold).toMatchObject({
      ok: true,
      value: { type: "create-floating-effect" },
    });

    const costed = effectAt("move-freestyle-hidden-power-level", 0);
    expect(
      compileEffectPlan({
        sourceDefinitionId: costed.move.id,
        effectIndex: 0,
        effect: costed.effect,
      }),
    ).toMatchObject({ ok: true, value: { type: "create-floating-effect" } });
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

  it("compiles exact on-move-use lifecycle variants and rejects other trigger owners", () => {
    const floating = effectAt("move-akaikaru-chained-mastery", 1);
    expect(
      compileEffectPlan({
        sourceDefinitionId: floating.move.id,
        effectIndex: 1,
        effect: floating.effect,
      }),
    ).toMatchObject({ ok: true });

    const cost = effectAt("move-akaikaru-relentless", 1);
    expect(
      compileEffectPlan({
        sourceDefinitionId: cost.move.id,
        effectIndex: 1,
        effect: cost.effect,
      }),
    ).toMatchObject({ ok: true });

    const unsupported = effectAt("move-kurokonwaku-cancellation-mastery", 0);
    const rejected = compileEffectPlan({
      sourceDefinitionId: unsupported.move.id,
      effectIndex: 0,
      effect: unsupported.effect,
    });
    expect(rejected).toMatchObject({ ok: false });
    if (rejected.ok) return;
    expect(rejected.issues).toContainEqual(
      expect.objectContaining({ code: "unsupported-trigger" }),
    );
  });

  it("compiles rules-backed roll-cap bypass effects as durable roll modifiers", () => {
    for (const [moveId, effectIndex] of [
      ["move-aoyosumu-opportunist", 2],
      ["move-midorikatai-flawless-execution-mastery", 1],
    ] as const) {
      const { move, effect } = effectAt(moveId, effectIndex);
      const compiled = compileEffectPlan({
        sourceDefinitionId: move.id,
        effectIndex,
        effect,
      });

      expect(compiled).toMatchObject({
        ok: true,
        value: {
          type: "modify-roll",
          definition: { cap: { type: "allow-exceed" } },
        },
      });
    }
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

  it("compiles every exact final-result critical threshold occurrence", () => {
    for (const [moveId, effectIndex] of [
      ["move-akaikaru-volcanic-smash", 0],
      ["move-aoyosumu-crescent-kick", 0],
      ["move-midorikatai-critical-mass-mastery", 0],
      ["move-midorikatai-critical-mass-mastery", 1],
    ] as const) {
      const { move, effect } = effectAt(moveId, effectIndex);

      expect(
        compileEffectPlan({ sourceDefinitionId: move.id, effectIndex, effect }),
        `${moveId}#${effectIndex}`,
      ).toMatchObject({
        ok: true,
        value: { type: "modify-critical-threshold" },
      });
    }
  });

  it("compiles exact after-defense rerolls and rejects unresolved reroll lifecycles", () => {
    for (const [moveId, effectIndex] of [
      ["move-akaikaru-swift-reaction", 0],
      ["move-aoyosumu-zen-explosion", 0],
      ["move-kurokonwaku-second-chance", 0],
    ] as const) {
      const { move, effect } = effectAt(moveId, effectIndex);

      expect(
        compileEffectPlan({ sourceDefinitionId: move.id, effectIndex, effect }),
        `${moveId}#${effectIndex}: ${JSON.stringify(
          compileEffectPlan({ sourceDefinitionId: move.id, effectIndex, effect }),
        )}`,
      ).toMatchObject({ ok: true, value: { type: "reroll" } });
    }

    for (const [moveId, effectIndex] of [
      ["move-aoyosumu-braced-energy-beam", 0],
      ["move-aoyosumu-tiger-strikes", 0],
      ["move-haokiru-willing-sacrifice", 1],
      ["move-kurokonwaku-ki-trap", 2],
    ] as const) {
      const { move, effect } = effectAt(moveId, effectIndex);

      expect(
        compileEffectPlan({ sourceDefinitionId: move.id, effectIndex, effect }),
        `${moveId}#${effectIndex}`,
      ).toMatchObject({ ok: false });
    }
  });

  it("keeps the runtime registry exhaustively named", () => {
    expect(Object.keys(effectExecutorRegistry).sort()).toEqual([
      "activate",
      "apply-status",
      "create-floating-effect",
      "deactivate",
      "force-action",
      "grant-extra-action",
      "lock",
      "modify-cost",
      "modify-critical-threshold",
      "modify-damage",
      "modify-move-classification",
      "modify-remaining-uses",
      "modify-resource",
      "modify-roll",
      "modify-stat",
      "negate",
      "prevent-combat-result",
      "prevent-move-modification",
      "prevent-move-use",
      "prevent-resolution",
      "prevent-resource-modification",
      "prevent-roll-modification",
      "prevent-status",
      "reroll",
      "roll-and-store",
      "schedule-effect",
      "set-combat-result",
      "set-resolution-threshold",
      "set-roll-definition",
      "set-roll-result",
      "skip-action",
      "suppress",
    ]);
  });
});
