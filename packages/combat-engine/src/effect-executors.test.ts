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

  it("compiles Vile Energy's bounded active-count activation variant", () => {
    const { move, effect } = firstEffectOfType("move-freestyle-vile-energy", "activate");
    const compiled = compileEffectPlan({
      sourceDefinitionId: move.id,
      effectIndex: move.effects!.indexOf(effect),
      effect,
      allowPendingChoice: true,
    });

    expect(compiled).toMatchObject({ ok: true, value: { type: "activate" } });
  });

  it("compiles paired start-combat cost selection and deferred END-phase activation", () => {
    const fierceCost = effectAt("move-kiihakai-fierce-focus-mastery", 0);
    const fierceActivation = effectAt("move-kiihakai-fierce-focus-mastery", 1);
    const synergy = effectAt("move-kiihakai-synergy", 2);

    expect(
      compileEffectPlan({
        sourceDefinitionId: fierceCost.move.id,
        effectIndex: 0,
        effect: fierceCost.effect,
      }),
    ).toMatchObject({ ok: true, value: { type: "modify-cost" } });
    expect(
      compileEffectPlan({
        sourceDefinitionId: fierceActivation.move.id,
        effectIndex: 1,
        effect: fierceActivation.effect,
        allowPendingChoice: true,
      }),
    ).toMatchObject({ ok: true, value: { type: "activate" } });
    expect(
      compileEffectPlan({
        sourceDefinitionId: synergy.move.id,
        effectIndex: 2,
        effect: synergy.effect,
        allowPendingChoice: true,
      }),
    ).toMatchObject({ ok: true, value: { type: "activate" } });
  });

  it("compiles Rollback Barrage's grouped reactivation variant", () => {
    const { move, effect } = effectAt("move-kiihakai-rollback-barrage", 0);
    const compiled = compileEffectPlan({
      sourceDefinitionId: move.id,
      effectIndex: 0,
      effect,
      allowPendingChoice: true,
    });

    expect(compiled).toMatchObject({ ok: true, value: { type: "activate" } });

    expect(
      compileEffectPlan({
        sourceDefinitionId: move.id,
        effectIndex: move.effects!.indexOf(effect),
        effect: {
          ...effect,
          activationCost: {
            resource: "hp",
            operation: "lose",
            amount: { type: "literal", value: 2 },
          },
        },
        allowPendingChoice: true,
      }),
    ).toMatchObject({ ok: false, issues: [{ code: "unsupported-variant" }] });
  });

  it("compiles Shadow Stalker's source-aware KI activation cost", () => {
    const { move, effect } = firstEffectOfType("move-kurokonwaku-shadow-stalker", "activate");
    const compiled = compileEffectPlan({
      sourceDefinitionId: move.id,
      effectIndex: move.effects!.indexOf(effect),
      effect,
      allowPendingChoice: true,
    });

    expect(compiled).toMatchObject({ ok: true, value: { type: "activate" } });
  });

  it("compiles exact prior successful-effect, last-unrestricted, and selected opponent copied attacks", () => {
    const flashback = firstEffectOfType("move-kurokonwaku-flashback", "copy-move-effect");
    expect(
      compileEffectPlan({
        sourceDefinitionId: flashback.move.id,
        effectIndex: flashback.move.effects!.indexOf(flashback.effect),
        effect: flashback.effect,
      }),
    ).toMatchObject({ ok: true, value: { type: "copy-move-effect" } });

    const followUp = firstEffectOfType("move-akaikaru-follow-up", "copy-move-effect");
    const rejected = compileEffectPlan({
      sourceDefinitionId: followUp.move.id,
      effectIndex: followUp.move.effects!.indexOf(followUp.effect),
      effect: followUp.effect,
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok)
      expect(rejected.issues.some((issue) => issue.code === "unsupported-variant")).toBe(true);

    const karmic = firstEffectOfType("move-aoyosumu-karmic-possession", "copy-move-effect");
    expect(
      compileEffectPlan({
        sourceDefinitionId: karmic.move.id,
        effectIndex: karmic.move.effects!.indexOf(karmic.effect),
        effect: karmic.effect,
      }),
    ).toMatchObject({ ok: true, value: { type: "copy-move-effect" } });

    const mimicry = firstEffectOfType("move-kurokonwaku-mimicry-mastery", "copy-move-effect");
    expect(
      compileEffectPlan({
        sourceDefinitionId: mimicry.move.id,
        effectIndex: mimicry.move.effects!.indexOf(mimicry.effect),
        effect: mimicry.effect,
      }),
    ).toMatchObject({ ok: true, value: { type: "copy-move-effect" } });
  });

  it("compiles Anger Manipulation's stopped-fraction reward from its triggering attack cost", () => {
    const anger = moveWithId("move-freestyle-anger-manipulation");
    const lock = anger.effects?.[1];
    const resource = anger.effects?.[0];
    if (lock === undefined || resource === undefined) throw new Error("Missing Anger effects.");

    expect(
      compileEffectPlan({ sourceDefinitionId: anger.id, effectIndex: 1, effect: lock }),
    ).toMatchObject({ ok: true, value: { type: "lock" } });
    expect(
      compileEffectPlan({ sourceDefinitionId: anger.id, effectIndex: 0, effect: resource }),
    ).toMatchObject({ ok: true, value: { type: "modify-resource" } });
  });

  it("compiles current-attack combat outcomes and rejects deferred selectors", () => {
    for (const [moveId, effectIndex] of [
      ["move-afterlife-guldo-special", 0],
      ["move-afterlife-guldo-special", 1],
      ["move-akaikaru-delta-storm", 0],
      ["move-midorikatai-breaker-breaker", 0],
    ] as const) {
      const { move, effect } = effectAt(moveId, effectIndex);
      expect(
        compileEffectPlan({ sourceDefinitionId: move.id, effectIndex, effect }),
        `${moveId}#${effectIndex}`,
      ).toMatchObject({ ok: true, value: { type: "grant-combat-outcome" } });
    }

    const deferred = effectAt("move-kiihakai-ki-barbs", 2);
    expect(
      compileEffectPlan({
        sourceDefinitionId: deferred.move.id,
        effectIndex: 2,
        effect: deferred.effect,
      }),
    ).toMatchObject({ ok: false });
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
      ["move-akaikaru-impulsive", 1],
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

  it("compiles source move removal and rejects selector-driven target removal", () => {
    const source = effectAt("move-freestyle-nullifying-sphere", 0);
    expect(
      compileEffectPlan({
        sourceDefinitionId: source.move.id,
        effectIndex: 0,
        effect: source.effect,
      }),
    ).toMatchObject({ ok: true, value: { type: "remove-move-from-combat" } });

    const selected = effectAt("move-freestyle-straining-concussion-wave", 1);
    const rejected = compileEffectPlan({
      sourceDefinitionId: selected.move.id,
      effectIndex: 1,
      effect: selected.effect,
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok)
      expect(rejected.issues.some((issue) => issue.code === "requires-pending-choice")).toBe(true);
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
      if (moveId === "move-kurokonwaku-ki-trap") {
        expect(
          compileEffectPlan({ sourceDefinitionId: move.id, effectIndex, effect }),
          `${moveId}#${effectIndex}`,
        ).toMatchObject({ ok: false });
      }
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

  it("compiles each Ki Barbs damage alternative only when pending choice is explicit", () => {
    const move = moveWithId("move-kiihakai-ki-barbs");
    for (const effectIndex of [0, 1]) {
      const effect = move.effects?.[effectIndex];
      if (effect === undefined) throw new Error(`Missing Ki Barbs effect ${effectIndex}.`);
      const rejected = compileEffectPlan({
        sourceDefinitionId: move.id,
        effectIndex,
        effect,
      });
      expect(rejected.ok).toBe(false);
      if (!rejected.ok)
        expect(rejected.issues.some((issue) => issue.code === "requires-pending-choice")).toBe(
          true,
        );
      expect(
        compileEffectPlan({
          sourceDefinitionId: move.id,
          effectIndex,
          effect,
          allowPendingChoice: true,
        }),
      ).toMatchObject({ ok: true, value: { type: "modify-damage" } });
    }
  });

  it("compiles Channeling Mastery's optional Signature cost choice only with pending state", () => {
    const move = moveWithId("move-haokiru-channeling-mastery");
    const effect = move.effects?.[3];
    if (effect === undefined) throw new Error("Missing Channeling Mastery cost effect.");

    const rejected = compileEffectPlan({ sourceDefinitionId: move.id, effectIndex: 3, effect });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok)
      expect(rejected.issues.some((issue) => issue.code === "requires-pending-choice")).toBe(true);
    expect(
      compileEffectPlan({
        sourceDefinitionId: move.id,
        effectIndex: 3,
        effect,
        allowPendingChoice: true,
      }),
    ).toMatchObject({ ok: true, value: { type: "modify-cost" } });
  });

  it("compiles Tornado Uppercut's exact deferred HP-cost alternatives and rejects passive listeners", () => {
    const tornado = moveWithId("move-haokiru-tornado-uppercut");
    for (const effectIndex of [2, 3] as const) {
      const effect = tornado.effects?.[effectIndex];
      if (effect === undefined) throw new Error(`Missing Tornado Uppercut effect ${effectIndex}.`);
      expect(
        compileEffectPlan({
          sourceDefinitionId: tornado.id,
          effectIndex,
          effect,
        }),
        `${tornado.id}#${effectIndex}`,
      ).toMatchObject({ ok: false, issues: [{ code: "requires-pending-choice" }] });
      expect(
        compileEffectPlan({
          sourceDefinitionId: tornado.id,
          effectIndex,
          effect,
          allowPendingChoice: true,
        }),
        `${tornado.id}#${effectIndex}`,
      ).toMatchObject({ ok: true, value: { type: "modify-resource-cost" } });
    }

    const effortless = moveWithId("move-freestyle-effortless");
    const passive = effortless.effects?.[0];
    if (passive === undefined) throw new Error("Missing Effortless resource-cost listener.");
    const rejected = compileEffectPlan({
      sourceDefinitionId: effortless.id,
      effectIndex: 0,
      effect: passive,
      allowPendingChoice: true,
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok)
      expect(rejected.issues.some((issue) => issue.code === "unsupported-variant")).toBe(true);
  });

  it("compiles Creationist's exclusive cost-modified alternatives only with pending state", () => {
    const move = moveWithId("move-haokiru-creationist");
    for (const effectIndex of [0, 1]) {
      const effect = move.effects?.[effectIndex];
      if (effect === undefined) throw new Error(`Missing Creationist effect ${effectIndex}.`);
      const rejected = compileEffectPlan({
        sourceDefinitionId: move.id,
        effectIndex,
        effect,
      });
      expect(rejected.ok).toBe(false);
      if (!rejected.ok)
        expect(rejected.issues.some((issue) => issue.code === "requires-pending-choice")).toBe(
          true,
        );
      expect(
        compileEffectPlan({
          sourceDefinitionId: move.id,
          effectIndex,
          effect,
          allowPendingChoice: true,
        }),
      ).toMatchObject({ ok: true, value: { type: "modify-cost" } });
    }
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

  it("compiles Bloodletter's typed turn-limited resource-event change", () => {
    const { move, effect } = effectAt("move-kurokonwaku-bloodletter", 0);
    expect(
      compileEffectPlan({ sourceDefinitionId: move.id, effectIndex: 0, effect }),
    ).toMatchObject({
      ok: true,
      value: { type: "modify-resource", sourceDefinitionId: move.id, effectIndex: 0 },
    });
  });

  it("compiles Energy Slasher's durable next-turn power-up resource change", () => {
    const { move, effect } = effectAt("move-kiihakai-energy-slasher", 0);
    expect(
      compileEffectPlan({ sourceDefinitionId: move.id, effectIndex: 0, effect }),
    ).toMatchObject({
      ok: true,
      value: { type: "modify-resource", sourceDefinitionId: move.id, effectIndex: 0 },
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

  it("compiles the exact typed resource-listener variants", () => {
    for (const [moveId, effectIndex] of [
      ["move-akaikaru-shotgun-blast", 0],
      ["move-haokiru-dragon-s-pride", 0],
      ["move-kurokonwaku-ki-trap", 1],
    ] as const) {
      const { move, effect } = effectAt(moveId, effectIndex);
      expect(
        compileEffectPlan({ sourceDefinitionId: move.id, effectIndex, effect }),
        `${moveId}#${effectIndex}`,
      ).toMatchObject({
        ok: true,
        value: { type: "modify-resource", sourceDefinitionId: move.id, effectIndex },
      });
    }
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

  it("compiles combat-limited action and upkeep damage modifiers as one generic capability", () => {
    for (const [moveId, effectIndex] of [
      ["move-afterlife-special-fighting-pose-1", 0],
      ["move-midorikatai-war-cry", 0],
    ] as const) {
      const { move, effect } = effectAt(moveId, effectIndex);
      expect(
        compileEffectPlan({ sourceDefinitionId: move.id, effectIndex, effect }),
        `${moveId}#${effectIndex}`,
      ).toMatchObject({ ok: true, value: { type: "modify-damage" } });
    }

    const { move, effect } = effectAt("move-midorikatai-war-cry", 0);
    expect(
      compileEffectPlan({
        sourceDefinitionId: move.id,
        effectIndex: 0,
        effect: { ...effect, useLimit: { scope: "turn", count: 1, sourceText: "test" } },
      }),
    ).toMatchObject({ ok: false, issues: [{ code: "unsupported-variant" }] });
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

  it("compiles Orange Burst's grouped post-success damage and deactivation effects when enabled", () => {
    for (const effectIndex of [0, 1] as const) {
      const { move, effect } = effectAt("move-kiihakai-orange-burst", effectIndex);
      expect(
        compileEffectPlan({
          sourceDefinitionId: move.id,
          effectIndex,
          effect,
          allowPendingChoice: true,
        }),
        `${move.id}#${effectIndex}`,
      ).toMatchObject({ ok: true });
    }
  });

  it("compiles Sixty Second Meltdown's grouped extra-action cost effects when enabled", () => {
    for (const effectIndex of [0, 1] as const) {
      const { move, effect } = effectAt("move-kurokonwaku-sixty-second-meltdown", effectIndex);
      expect(
        compileEffectPlan({
          sourceDefinitionId: move.id,
          effectIndex,
          effect,
          allowPendingChoice: true,
        }),
        `${move.id}#${effectIndex}`,
      ).toMatchObject({ ok: true });
    }
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
    expect(
      compileEffectPlan({
        sourceDefinitionId: deferred.move.id,
        effectIndex: 0,
        effect: deferred.effect,
      }),
    ).toMatchObject({ ok: true });

    const deferredPerDie = effectAt("move-kurokonwaku-living-voodoo", 0);
    expect(
      compileEffectPlan({
        sourceDefinitionId: deferredPerDie.move.id,
        effectIndex: 0,
        effect: deferredPerDie.effect,
      }),
    ).toMatchObject({ ok: true });
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
      effect: { ...supported.effect, trigger: "turn-end" as const },
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

  it("compiles durable and following-action suppressions", () => {
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

    const followingAction = effectAt("move-haokiru-soul-breaker", 3);
    expect(
      compileEffectPlan({
        sourceDefinitionId: followingAction.move.id,
        effectIndex: 3,
        effect: followingAction.effect,
      }),
    ).toMatchObject({ ok: true });

    const currentResolution = effectAt("move-aoyosumu-breakout", 1);
    expect(
      compileEffectPlan({
        sourceDefinitionId: currentResolution.move.id,
        effectIndex: 1,
        effect: currentResolution.effect,
      }),
    ).toMatchObject({ ok: true, value: { type: "suppress" } });

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
    ).toMatchObject({ ok: true });
    expect(
      compileVariant({
        ...supported.effect,
        scope: { type: "following-action", offset: 0, sourceText: "test" },
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

    const solarFlare = effectAt("move-afterlife-solar-flare", 2);
    expect(
      compileEffectPlan({
        sourceDefinitionId: solarFlare.move.id,
        effectIndex: 2,
        effect: solarFlare.effect,
      }),
    ).toMatchObject({ ok: true, value: { type: "create-floating-effect" } });
  });

  it("compiles same-turn and next-turn upkeep extra actions", () => {
    const supported = effectAt("move-akaikaru-chained-strikes", 0);
    expect(
      compileEffectPlan({
        sourceDefinitionId: supported.move.id,
        effectIndex: 0,
        effect: supported.effect,
      }),
    ).toMatchObject({ ok: true });

    const scheduled = effectAt("move-afterlife-destructo-disc", 0);
    const compiledScheduled = compileEffectPlan({
      sourceDefinitionId: scheduled.move.id,
      effectIndex: 0,
      effect: scheduled.effect,
    });
    expect(compiledScheduled).toMatchObject({
      ok: true,
      value: { type: "grant-extra-action" },
    });

    const upkeepSkill = effectAt("move-aoyosumu-sky-dance-technique", 0);
    expect(
      compileEffectPlan({
        sourceDefinitionId: upkeepSkill.move.id,
        effectIndex: 0,
        effect: upkeepSkill.effect,
      }),
    ).toMatchObject({ ok: true, value: { type: "grant-extra-action" } });
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

  it("compiles automatic roll-modifier transformations and defers paid choices", () => {
    for (const [moveId, effectIndex, operation] of [
      ["move-akaikaru-agile-medley", 0, "increment"],
      ["move-akaikaru-rolling-thunder", 1, "multiplier"],
    ] as const) {
      const { move, effect } = effectAt(moveId, effectIndex);
      expect(
        compileEffectPlan({ sourceDefinitionId: move.id, effectIndex, effect }),
        `${moveId}#${effectIndex}`,
      ).toMatchObject({
        ok: true,
        value: {
          type: "modify-roll-modifier",
          definition: { modifier: "any", [operation]: expect.anything() },
        },
      });
    }

    const stoicism = firstEffectOfType("move-aoyosumu-stoicism", "modify-roll-modifier");
    const rejected = compileEffectPlan({
      sourceDefinitionId: stoicism.move.id,
      effectIndex: stoicism.move.effects?.indexOf(stoicism.effect) ?? 0,
      effect: stoicism.effect,
    });
    expect(rejected).toMatchObject({ ok: false });
    if (rejected.ok) return;
    expect(rejected.issues).toContainEqual(
      expect.objectContaining({ code: "requires-pending-choice" }),
    );
  });

  it("compiles each exact roll-selection lifecycle variant", () => {
    for (const moveId of [
      "move-akaikaru-bullrush",
      "move-aoyosumu-floating-drop",
      "move-kiihakai-fade-attack",
    ]) {
      const { move, effect } = firstEffectOfType(moveId, "set-roll-selection");
      expect(
        compileEffectPlan({
          sourceDefinitionId: move.id,
          effectIndex: move.effects?.indexOf(effect) ?? 0,
          effect,
        }),
        moveId,
      ).toMatchObject({
        ok: true,
        value: { type: "set-roll-selection", definition: { type: "set-roll-selection" } },
      });
    }

    const { move, effect } = firstEffectOfType("move-kiihakai-fade-attack", "set-roll-selection");
    const rejected = compileEffectPlan({
      sourceDefinitionId: move.id,
      effectIndex: move.effects?.indexOf(effect) ?? 0,
      effect: {
        ...effect,
        scope: { type: "next-roll", roll: "defense", sourceText: "invalid test scope" },
      },
    });
    expect(rejected).toMatchObject({ ok: false });
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

  it("compiles Critical Mass Master's typed critical on-damage modifier", () => {
    const { move, effect } = effectAt("move-midorikatai-critical-mass-mastery", 2);

    expect(
      compileEffectPlan({ sourceDefinitionId: move.id, effectIndex: 2, effect }),
    ).toMatchObject({
      ok: true,
      value: { type: "modify-damage", definition: { operation: "multiply" } },
    });
  });

  it("compiles Muscle Infusion's exact serialized on-damage choice", () => {
    const { move, effect } = effectAt("move-haokiru-muscle-infusion", 0);

    expect(
      compileEffectPlan({
        sourceDefinitionId: move.id,
        effectIndex: 0,
        effect,
        allowPendingChoice: true,
      }),
    ).toMatchObject({
      ok: true,
      value: { type: "modify-damage", definition: { trigger: "on-damage" } },
    });
  });

  it("compiles exact reroll lifecycles and rejects unresolved future-choice variants", () => {
    for (const [moveId, effectIndex] of [
      ["move-akaikaru-swift-reaction", 0],
      ["move-aoyosumu-zen-explosion", 0],
      ["move-kurokonwaku-second-chance", 0],
      ["move-aoyosumu-braced-energy-beam", 0],
      ["move-aoyosumu-tiger-strikes", 0],
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
      ["move-haokiru-willing-sacrifice", 1],
      ["move-kurokonwaku-ki-trap", 2],
      ["move-kurokonwaku-ki-trap", 3],
    ] as const) {
      const { move, effect } = effectAt(moveId, effectIndex);

      if (moveId === "move-kurokonwaku-ki-trap") {
        expect(
          compileEffectPlan({ sourceDefinitionId: move.id, effectIndex, effect }),
          `${moveId}#${effectIndex}`,
        ).toMatchObject({ ok: false });
      }
      expect(
        compileEffectPlan({
          sourceDefinitionId: move.id,
          effectIndex,
          effect,
          allowPendingChoice: true,
        }),
        `${moveId}#${effectIndex} pending choice`,
      ).toMatchObject({ ok: true, value: { type: "reroll" } });
    }
  });

  it("compiles the exact post-defense stun, critical, and counter negation variants", () => {
    for (const effectIndex of [3, 4]) {
      const { move, effect } = effectAt("move-kurokonwaku-cancellation-mastery", effectIndex);
      expect(
        compileEffectPlan({ sourceDefinitionId: move.id, effectIndex, effect }),
        `${move.id}#${effectIndex}`,
      ).toMatchObject({ ok: true, value: { type: "negate" } });
    }

    const stun = effectAt("move-kurokonwaku-cancellation-mastery", 2);
    expect(
      compileEffectPlan({
        sourceDefinitionId: stun.move.id,
        effectIndex: 2,
        effect: stun.effect,
      }),
    ).toMatchObject({ ok: true, value: { type: "negate" } });
  });

  it("compiles successful-effect negation selected by the triggering move", () => {
    const { move, effect } = effectAt("move-aoyosumu-the-untroubled-mind", 0);
    expect(
      compileEffectPlan({ sourceDefinitionId: move.id, effectIndex: 0, effect }),
    ).toMatchObject({ ok: true, value: { type: "negate" } });
  });

  it("compiles combat-limited successful-effect negation listeners", () => {
    const { move, effect } = effectAt("move-midorikatai-sucker-punch", 0);
    expect(
      compileEffectPlan({ sourceDefinitionId: move.id, effectIndex: 0, effect }),
    ).toMatchObject({ ok: true, value: { type: "negate" } });
  });

  it("compiles Display of Endurance's persisted blocked-damage follow-up", () => {
    const immediate = effectAt("move-haokiru-display-of-endurance", 0);
    expect(
      compileEffectPlan({
        sourceDefinitionId: immediate.move.id,
        effectIndex: 0,
        effect: immediate.effect,
      }),
    ).toMatchObject({ ok: true, value: { type: "modify-resource" } });

    const floating = effectAt("move-haokiru-display-of-endurance", 1);
    expect(
      compileEffectPlan({
        sourceDefinitionId: floating.move.id,
        effectIndex: 1,
        effect: floating.effect,
      }),
    ).toMatchObject({
      ok: true,
      value: {
        type: "create-floating-effect",
        definition: {
          effects: [
            expect.objectContaining({
              type: "modify-resource",
              amount: { type: "blocked-attack-damage", multiplier: 1 },
            }),
          ],
        },
      },
    });
  });

  it("keeps the runtime registry exhaustively named", () => {
    expect(Object.keys(effectExecutorRegistry).sort()).toEqual([
      "activate",
      "apply-status",
      "copy-move-effect",
      "create-floating-effect",
      "deactivate",
      "force-action",
      "grant-combat-outcome",
      "grant-counter-action",
      "grant-extra-action",
      "lock",
      "modify-cost",
      "modify-critical-threshold",
      "modify-damage",
      "modify-move-classification",
      "modify-remaining-uses",
      "modify-resource",
      "modify-resource-cost",
      "modify-roll",
      "modify-roll-modifier",
      "modify-slot-capacity",
      "modify-stat",
      "negate",
      "prevent-combat-result",
      "prevent-move-modification",
      "prevent-move-use",
      "prevent-resolution",
      "prevent-resource-modification",
      "prevent-roll-modification",
      "prevent-status",
      "remove-move-from-combat",
      "reroll",
      "roll-and-store",
      "schedule-effect",
      "select-move-by-stored-roll",
      "set-combat-result",
      "set-resolution-threshold",
      "set-roll-definition",
      "set-roll-result",
      "set-roll-selection",
      "skip-action",
      "suppress",
    ]);
  });
});
