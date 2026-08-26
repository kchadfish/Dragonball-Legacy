import { describe, expect, it } from "vitest";

import {
  createCombatCapabilityMatrix,
  renderCombatCapabilityMatrix,
} from "./combat-capability-matrix.js";

const runtimeValue = (value: unknown): unknown => value;

describe("combat capability matrix", () => {
  it("accounts for every converted structured effect with an explicit status", () => {
    const matrix = createCombatCapabilityMatrix();
    expect(matrix.occurrences.length).toBeGreaterThan(0);
    expect(
      matrix.occurrences.every(
        (row) =>
          row.sourceDefinitionId.length > 0 &&
          row.effectType.length > 0 &&
          row.variant.length > 0 &&
          row.reason.length > 0 &&
          (row.status === "audited-out-of-scope"
            ? row.approvedExclusion !== null
            : row.status === "unsupported-in-scope"
              ? row.prerequisite !== null
              : row.executor !== null && row.focusedCoverage !== null),
      ),
    ).toBe(true);
  });

  it("renders stable, reviewable records", () => {
    const rendered = renderCombatCapabilityMatrix();
    expect(rendered).toContain("| move-afterlife-kaio-ken |");
    expect(rendered).toContain("modify-damage");
    expect(rendered).toContain("unsupported-in-scope");
    expect(rendered).toContain("audited-out-of-scope");
    expect(rendered).toContain("source-text-only abilities are not executable");
    expect(rendered).toContain("cap=maximum:roll");
    expect(rendered).toContain("cap=maximum:total");
    expect(rendered).toContain("policy=prevent-duplicate");
    expect(rendered).toContain("| Conflict policy |");
    expect(rendered).toContain("## Unsupported in-scope priorities");
    expect(rendered).toContain("| Rank | Prerequisite | Effect type | Occurrences | Definitions |");
    expect(createCombatCapabilityMatrix().occurrences).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "unsupported-in-scope" })]),
    );
  });

  it("classifies exact successful CONSTANT Skill activation choices", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (row) => row.effectType === "activate" && row.capabilityId === "activate.v1",
    );

    expect(rows.map((row) => row.sourceDefinitionId)).toEqual([
      "move-freestyle-monkey-sweep",
      "move-freestyle-tricky-sword-maneuvers",
      "move-haokiru-halcyon-blow",
      "move-kiihakai-fierce-focus-mastery",
      "move-kiihakai-synergy",
      "move-kiihakai-kinetic-outburst",
      "move-kiihakai-triple-torpedo",
      "move-kurokonwaku-shadow-stalker",
    ]);
    expect(rows.every((row) => row.status === "supported-generic")).toBe(true);
  });

  it("closes both Fierce Focus deactivation-negation occurrences", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (row) =>
        row.sourceDefinitionId === "move-kiihakai-fierce-focus-mastery" &&
        row.effectType === "negate-deactivation",
    );

    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          effectIndex: 2,
          status: "supported-generic",
          capabilityId: "negate-deactivation.v1",
          executor: "deactivation-negation",
        }),
        expect.objectContaining({
          effectIndex: 3,
          status: "supported-generic",
          capabilityId: "negate-deactivation.v1",
          executor: "deactivation-negation",
        }),
      ]),
    );
  });

  it("classifies Aura Clash's two exact END-phase transformation opportunities", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (row) => row.sourceDefinitionId === "move-kiihakai-aura-clash",
    );

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          effectIndex: 0,
          effectType: "force-transformation",
          status: "supported-generic",
          capabilityId: "force-transformation.v1",
          executor: "forced-transformation-opportunity",
        }),
        expect.objectContaining({
          effectIndex: 1,
          effectType: "force-transformation",
          status: "supported-generic",
          capabilityId: "force-transformation.v1",
          executor: "forced-transformation-opportunity",
        }),
      ]),
    );
  });

  it("classifies exact constant reactivation variants through the shared activation executor", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (row) =>
        row.effectType === "reactivate-recent-skill" ||
        row.effectType === "reactivate-deactivated-constant-skill",
    );

    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          effectType: "reactivate-recent-skill",
          status: "supported-generic",
          capabilityId: "reactivate-constant-skill.v1",
        }),
        expect.objectContaining({
          effectType: "reactivate-deactivated-constant-skill",
          status: "supported-generic",
          capabilityId: "reactivate-constant-skill.v1",
        }),
      ]),
    );
  });

  it("classifies the exact restricted upkeep suppressions through the generic executor", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (row) =>
        row.sourceDefinitionId === "move-freestyle-showdown" ||
        row.sourceDefinitionId === "move-midorikatai-against-the-odds",
    );

    expect(rows.every((row) => row.status === "supported-generic")).toBe(true);
    expect(rows.every((row) => row.capabilityId === "suppress.v1")).toBe(true);
    expect(rows).toHaveLength(2);
  });

  it("closes the exact deferred-move catalog variants", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (row) => row.effectType === "defer-move",
    );

    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceDefinitionId: "move-afterlife-warp-kamehameha",
          effectIndex: 0,
          status: "supported-generic",
          capabilityId: "defer-move.v1",
          executor: "deferred-move-scheduling",
        }),
        expect.objectContaining({
          sourceDefinitionId: "move-afterlife-death-ball",
          effectIndex: 0,
          status: "supported-generic",
          capabilityId: "defer-move.v1",
          executor: "deferred-move-scheduling",
        }),
      ]),
    );
  });

  it("classifies Vile Energy's bounded repeat-until activation generically", () => {
    expect(
      createCombatCapabilityMatrix().occurrences.find(
        (row) =>
          row.sourceDefinitionId === "move-freestyle-vile-energy" && row.effectType === "activate",
      ),
    ).toMatchObject({
      status: "supported-generic",
      capabilityId: "activate.v2",
      executor: "constant-activation-selection",
    });
  });

  it("classifies Overdrive and Big Shot activation variants with linked delayed deactivation", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (row) =>
        row.sourceDefinitionId === "move-kiihakai-overdrive-blast" ||
        row.sourceDefinitionId === "move-kiihakai-big-shot",
    );

    expect(rows).toContainEqual(
      expect.objectContaining({
        sourceDefinitionId: "move-kiihakai-overdrive-blast",
        effectIndex: 0,
        status: "supported-generic",
        capabilityId: "activate.v3",
        executor: "constant-activation-selection",
      }),
    );
    expect(rows).toContainEqual(
      expect.objectContaining({
        sourceDefinitionId: "move-kiihakai-big-shot",
        effectIndex: 0,
        status: "supported-generic",
        capabilityId: "activate.v4",
        executor: "constant-activation-selection",
      }),
    );
    expect(rows).toContainEqual(
      expect.objectContaining({
        sourceDefinitionId: "move-kiihakai-big-shot",
        effectIndex: 1,
        status: "supported-generic",
        capabilityId: "activate.v4",
        executor: "constant-activation-selection",
      }),
    );
  });

  it("classifies the exact Flashback copied attack through the generic executor", () => {
    const row = createCombatCapabilityMatrix().occurrences.find(
      (candidate) =>
        candidate.sourceDefinitionId === "move-kurokonwaku-flashback" &&
        candidate.effectType === "copy-move-effect",
    );

    expect(row).toMatchObject({
      status: "supported-generic",
      capabilityId: "copy-move-effect.v1",
      executor: "copied-attack-action",
      focusedCoverage: "progress-fight.test.ts, effect-executors.test.ts",
    });
  });

  it("classifies All-Out Triumphant Beam's transformation reversion generically", () => {
    expect(
      createCombatCapabilityMatrix().occurrences.find(
        (row) => row.sourceDefinitionId === "move-freestyle-all-out-triumphant-beam",
      ),
    ).toMatchObject({
      effectType: "revert-transformation",
      status: "supported-generic",
      capabilityId: "revert-transformation.v1",
      executor: "transformation-lifecycle",
    });
  });

  it("classifies Mimicry Mastery's selected opponent attack through the generic executor", () => {
    const row = createCombatCapabilityMatrix().occurrences.find(
      (candidate) =>
        candidate.sourceDefinitionId === "move-kurokonwaku-mimicry-mastery" &&
        candidate.effectIndex === 2 &&
        candidate.effectType === "copy-move-effect",
    );

    expect(row).toMatchObject({
      status: "supported-generic",
      capabilityId: "copy-move-effect.v1",
      executor: "copied-attack-action",
      focusedCoverage: "progress-fight.test.ts, effect-executors.test.ts",
    });
  });

  it("classifies Karmic Possession's selected prior successful effect separately", () => {
    const row = createCombatCapabilityMatrix().occurrences.find(
      (candidate) =>
        candidate.sourceDefinitionId === "move-aoyosumu-karmic-possession" &&
        candidate.effectType === "copy-move-effect",
    );

    expect(row).toMatchObject({
      status: "supported-generic",
      capabilityId: "copy-move-effect.v2",
      executor: "copied-successful-effect-attack",
      focusedCoverage: "progress-fight.test.ts, effect-executors.test.ts",
    });
  });

  it("classifies Mind Reading's exact prior attack snapshot separately", () => {
    const row = createCombatCapabilityMatrix().occurrences.find(
      (candidate) =>
        candidate.sourceDefinitionId === "move-haokiru-mind-reading" &&
        candidate.effectType === "copy-move-effect",
    );

    expect(row).toMatchObject({
      status: "supported-generic",
      capabilityId: "copy-move-effect.v3",
      executor: "copied-attack-resolution-snapshot",
      focusedCoverage: "progress-fight.test.ts, effect-executors.test.ts",
    });
  });

  it("classifies the executable counter-action variants and preserves duration", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (candidate) => candidate.effectType === "grant-counter-action",
    );
    expect(rows).toContainEqual(
      expect.objectContaining({
        sourceDefinitionId: "move-aoyosumu-counterstrike-mastery",
        status: "supported-generic",
        capabilityId: "grant-counter-action.v1",
        executor: "counter-action",
      }),
    );
    expect(rows).toContainEqual(
      expect.objectContaining({
        sourceDefinitionId: "move-aoyosumu-reversal-of-fortune",
        status: "supported-generic",
        capabilityId: "grant-counter-action.v1",
        executor: "counter-action",
      }),
    );
    expect(rows).toContainEqual(
      expect.objectContaining({
        sourceDefinitionId: "move-aoyosumu-straightjacket",
        status: "supported-generic",
        capabilityId: "grant-counter-action.v1",
        executor: "counter-action",
      }),
    );
  });

  it("classifies Monkey Sweep's durable combat-outcome prevention generically", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (candidate) =>
        candidate.sourceDefinitionId === "move-freestyle-monkey-sweep" &&
        candidate.effectType === "prevent-resolution",
    );

    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "supported-generic",
          capabilityId: "prevent-resolution.v1",
          executor: "resolution-prevention",
          focusedCoverage:
            "basic-attack.test.ts, move-effects-runtime.test.ts, progress-fight.test.ts",
        }),
      ]),
    );
  });

  it("classifies Anger's stopped-fraction reward and lock through generic executors", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (row) => row.sourceDefinitionId === "move-freestyle-anger-manipulation",
    );

    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual(
      expect.objectContaining({
        effectIndex: 1,
        status: "supported-generic",
        capabilityId: "lock.v1",
        executor: "action-lock",
      }),
    );
    expect(rows).toContainEqual(
      expect.objectContaining({
        effectIndex: 0,
        status: "supported-generic",
        capabilityId: "modify-resource.v1",
        executor: "resource-change",
        focusedCoverage: "progress-fight.test.ts, move-effects-runtime.test.ts",
      }),
    );
  });

  it("classifies Energy Slasher's next-turn resource schedule through the generic executor", () => {
    const row = createCombatCapabilityMatrix().occurrences.find(
      (candidate) =>
        candidate.sourceDefinitionId === "move-kiihakai-energy-slasher" &&
        candidate.effectIndex === 0,
    );

    expect(row).toMatchObject({
      status: "supported-generic",
      capabilityId: "modify-resource.v1",
      executor: "resource-change",
      focusedCoverage: "progress-fight.test.ts",
    });
  });

  it("classifies both Ki Barbs alternatives through the pending damage executor", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (row) => row.sourceDefinitionId === "move-kiihakai-ki-barbs",
    );

    expect(rows).toContainEqual(
      expect.objectContaining({
        effectIndex: 0,
        status: "supported-generic",
        capabilityId: "damage-modifier.v1",
        executor: "damage-modifier",
        focusedCoverage: "basic-attack.test.ts, progress-fight.test.ts",
      }),
    );
    expect(rows).toContainEqual(
      expect.objectContaining({
        effectIndex: 1,
        status: "supported-generic",
        capabilityId: "damage-modifier.v1",
        executor: "damage-modifier",
        focusedCoverage: "basic-attack.test.ts, progress-fight.test.ts",
      }),
    );
  });

  it("classifies Channeling Master's optional Signature cost through the pending cost executor", () => {
    const row = createCombatCapabilityMatrix().occurrences.find(
      (candidate) =>
        candidate.sourceDefinitionId === "move-haokiru-channeling-mastery" &&
        candidate.effectIndex === 3,
    );

    expect(row).toMatchObject({
      status: "supported-generic",
      capabilityId: "modify-cost.v1",
      executor: "cost-modifier",
      focusedCoverage: "progress-fight.test.ts, move-effects-runtime.test.ts",
    });
  });

  it("classifies BOOMerang's deferred next-move cost separately from start-combat selection", () => {
    const matrix = createCombatCapabilityMatrix();
    expect(
      matrix.occurrences.find(
        (candidate) =>
          candidate.sourceDefinitionId === "move-kiihakai-boomerang" && candidate.effectIndex === 0,
      ),
    ).toMatchObject({
      status: "supported-generic",
      capabilityId: "modify-cost.v2",
      executor: "cost-modifier",
    });
    expect(
      matrix.occurrences.find(
        (candidate) =>
          candidate.sourceDefinitionId === "move-kurokonwaku-control-mastery" &&
          candidate.effectIndex === 0,
      ),
    ).toMatchObject({
      status: "supported-generic",
      capabilityId: "modify-cost.v3",
      executor: "cost-modifier",
    });
  });

  it("classifies Creationist's exclusive cost-modified alternatives through the pending cost executor", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (candidate) =>
        candidate.sourceDefinitionId === "move-haokiru-creationist" &&
        runtimeValue(candidate.effectIndex) !== undefined,
    );

    expect(rows).toHaveLength(2);
    expect(
      rows.every(
        (row) =>
          row.status === "supported-generic" &&
          row.capabilityId === "modify-cost.v1" &&
          row.executor === "cost-modifier",
      ),
    ).toBe(true);
  });

  it("classifies after-defense per-die combat-result reactions through the generic executor", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (row) => row.effectType === "set-combat-result",
    );
    const supported = rows.filter(
      (row) =>
        row.status === "supported-generic" &&
        (row.sourceDefinitionId === "move-aoyosumu-close-shave" ||
          row.sourceDefinitionId === "move-freestyle-energy-redirection") &&
        row.variant.includes("trigger=after-defense-roll") &&
        row.variant.includes("scope=none"),
    );
    const deferred = rows.filter(
      (row) =>
        row.status === "supported-generic" &&
        (row.sourceDefinitionId === "move-aoyosumu-tranquil-strike" ||
          row.sourceDefinitionId === "move-freestyle-underdog-evasion" ||
          row.sourceDefinitionId === "move-kurokonwaku-living-voodoo") &&
        row.variant.includes("trigger=on-stopped") &&
        row.variant.includes("scope=next-action"),
    );

    expect(rows).toHaveLength(12);
    expect(supported.map((row) => row.sourceDefinitionId)).toEqual([
      "move-aoyosumu-close-shave",
      "move-freestyle-energy-redirection",
    ]);
    expect(
      supported.every(
        (row) =>
          row.capabilityId === "set-combat-result.v1" &&
          row.executor === "combat-result-override" &&
          row.focusedCoverage === "progress-fight.test.ts",
      ),
    ).toBe(true);
    expect(deferred.map((row) => row.sourceDefinitionId)).toEqual([
      "move-aoyosumu-tranquil-strike",
      "move-freestyle-underdog-evasion",
      "move-kurokonwaku-living-voodoo",
    ]);
    expect(
      deferred.every(
        (row) =>
          row.capabilityId === "set-combat-result.v1" &&
          row.executor === "combat-result-override" &&
          row.focusedCoverage === "progress-fight.test.ts",
      ),
    ).toBe(true);
    expect(rows).toContainEqual(
      expect.objectContaining({
        sourceDefinitionId: "move-akaikaru-dazzling-gymnastics",
        status: "supported-generic",
        capabilityId: "set-combat-result.v1",
        executor: "combat-result-override",
        focusedCoverage: "basic-attack.test.ts",
      }),
    );
    expect(rows.filter((row) => row.status === "unsupported-in-scope")).toHaveLength(0);
  });

  it("classifies all exact catalog reroll choices through the generic reaction", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (row) => row.effectType === "reroll",
    );
    expect(rows).toContainEqual(
      expect.objectContaining({
        sourceDefinitionId: "move-aoyosumu-braced-energy-beam",
        status: "supported-generic",
        capabilityId: "reroll.v1",
        executor: "reroll-reaction",
      }),
    );
    expect(rows).toContainEqual(
      expect.objectContaining({
        sourceDefinitionId: "move-aoyosumu-tiger-strikes",
        status: "supported-generic",
        capabilityId: "reroll.v1",
        executor: "reroll-reaction",
      }),
    );
    expect(
      rows.filter(
        (row) =>
          row.sourceDefinitionId === "move-haokiru-willing-sacrifice" ||
          row.sourceDefinitionId === "move-kurokonwaku-ki-trap",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "supported-generic",
          capabilityId: "reroll.v1",
          executor: "reroll-reaction",
        }),
      ]),
    );
  });

  it("classifies blocked-damage floating snapshots through the generic lifecycle", () => {
    const row = createCombatCapabilityMatrix().occurrences.find(
      (candidate) =>
        candidate.sourceDefinitionId === "move-haokiru-display-of-endurance" &&
        candidate.effectIndex === 1,
    );

    expect(row).toMatchObject({
      status: "supported-generic",
      capabilityId: "create-floating-effect.v1",
      executor: "floating-effect-lifecycle",
      focusedCoverage: "basic-attack.test.ts, progress-fight.test.ts, move-effects-runtime.test.ts",
    });
  });

  it("classifies action-phase extra-action allowances with the durable scheduler", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (row) =>
        row.effectType === "grant-extra-action" && row.variant.includes("trigger=action-phase"),
    );

    expect(rows.map((row) => row.sourceDefinitionId)).toEqual([
      "move-afterlife-petrifying-spit",
      "move-afterlife-special-fighting-pose-3",
      "move-haokiru-willing-sacrifice",
    ]);
    expect(
      rows.every(
        (row) =>
          row.status === "supported-generic" &&
          row.capabilityId === "grant-extra-action.v2" &&
          row.executor === "extra-action-scheduler",
      ),
    ).toBe(true);
  });

  it("classifies optional post-defense rerolls through the serialized generic reaction", () => {
    const matrix = createCombatCapabilityMatrix();
    const sourceIds = [
      "move-akaikaru-swift-reaction",
      "move-aoyosumu-zen-explosion",
      "move-kurokonwaku-second-chance",
    ];
    const rows = matrix.occurrences.filter(
      (row) => sourceIds.includes(row.sourceDefinitionId) && row.effectType === "reroll",
    );

    expect(rows).toHaveLength(3);
    expect(
      rows.every(
        (row) =>
          row.status === "supported-generic" &&
          row.capabilityId === "reroll.v1" &&
          row.executor === "reroll-reaction" &&
          row.focusedCoverage.includes("basic-attack.test.ts"),
      ),
    ).toBe(true);
  });

  it("classifies representable on-deactivated listeners through the generic trigger boundary", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter((row) =>
      row.variant.includes("trigger=on-deactivated"),
    );
    expect(rows).toHaveLength(4);
    expect(
      rows.filter((row) => row.status === "supported-generic").map((row) => row.effectType),
    ).toEqual(["lock", "negate-deactivation", "negate-deactivation", "modify-cost"]);
    expect(
      rows
        .filter((row) => row.status === "unsupported-in-scope")
        .every((row) => row.prerequisite === "generic pending-choice compilation and resolution"),
    ).toBe(true);
  });

  it("keeps ally targeting and temporary opponent-technique identity mutation out of 1v1 scope", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (row) =>
        row.sourceDefinitionId === "move-haokiru-healing-ray" ||
        row.sourceDefinitionId === "move-haokiru-karmic-chameleon-mastery",
    );

    expect(rows.filter((row) => row.status === "audited-out-of-scope")).toHaveLength(7);
    expect(
      rows
        .filter((row) => row.status === "audited-out-of-scope")
        .every((row) => row.approvedExclusion !== null),
    ).toBe(true);
  });

  it("classifies all canonical stored writes and only exact immediate threshold consumers", () => {
    const matrix = createCombatCapabilityMatrix();
    const storedWrites = matrix.occurrences.filter((row) => row.effectType === "roll-and-store");
    expect(storedWrites).toHaveLength(5);
    expect(
      storedWrites.every(
        (row) =>
          row.status === "supported-generic" &&
          row.capabilityId === "roll-and-store.v1" &&
          row.executor === "stored-roll-state",
      ),
    ).toBe(true);

    for (const [sourceDefinitionId, effectIndex] of [
      ["move-afterlife-solar-flare", 1],
      ["move-haokiru-healing-ray", 4],
    ] as const)
      expect(
        matrix.occurrences.find(
          (row) => row.sourceDefinitionId === sourceDefinitionId && row.effectIndex === effectIndex,
        ),
      ).toMatchObject({ status: "supported-generic" });

    expect(
      matrix.occurrences.find(
        (row) =>
          row.sourceDefinitionId === "move-afterlife-petrifying-spit" && row.effectIndex === 1,
      ),
    ).toMatchObject({ status: "supported-generic", executor: "status-lifecycle" });

    expect(
      matrix.occurrences.find(
        (row) =>
          row.sourceDefinitionId === "move-afterlife-petrifying-spit" && row.effectIndex === 3,
      ),
    ).toMatchObject({
      status: "supported-generic",
      capabilityId: "skip-action.v2",
      executor: "status-backed-action-restriction",
    });
  });

  it("classifies exact future-turn action restrictions through the durable generic executor", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (row) => row.effectType === "skip-action",
    );
    const supported = rows.filter((row) => row.status === "supported-generic");
    const unsupported = rows.filter((row) => row.status === "unsupported-in-scope");

    expect(rows).toHaveLength(10);
    expect(supported).toHaveLength(10);
    expect(
      supported.every(
        (row) =>
          (row.capabilityId === "skip-action.v1" && row.executor === "action-restriction") ||
          (row.capabilityId === "skip-action.v2" &&
            row.executor === "status-backed-action-restriction") ||
          (row.capabilityId === "skip-action.v3" && row.executor === "action-phase-skip-choice"),
      ),
    ).toBe(true);
    expect(unsupported).toHaveLength(0);
  });

  it("classifies exact post-defense critical and counter negations", () => {
    const matrix = createCombatCapabilityMatrix();
    const rows = matrix.occurrences.filter(
      (row) =>
        row.sourceDefinitionId === "move-kurokonwaku-cancellation-mastery" &&
        row.effectType === "negate",
    );

    expect(rows).toHaveLength(4);
    expect(rows.filter((row) => [3, 4].includes(row.effectIndex))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "supported-generic",
          capabilityId: "negate.v1",
          executor: "negation",
          focusedCoverage: "progress-fight.test.ts",
        }),
      ]),
    );
    expect(rows.find((row) => row.effectIndex === 2)).toMatchObject({
      status: "supported-generic",
      capabilityId: "negate.v1",
      executor: "negation",
    });
  });

  it("classifies combat-limited successful-effect negation as generic coverage", () => {
    const row = createCombatCapabilityMatrix().occurrences.find(
      (candidate) =>
        candidate.sourceDefinitionId === "move-midorikatai-sucker-punch" &&
        candidate.effectIndex === 0,
    );
    expect(row).toMatchObject({
      status: "supported-generic",
      capabilityId: "negate.v1",
      executor: "negation",
      focusedCoverage: "progress-fight.test.ts",
    });
  });

  it("classifies successful-hit-count effects as generic executor coverage", () => {
    const matrix = createCombatCapabilityMatrix();
    const sourceIds = new Set([
      "move-afterlife-bakuretsu-ranma",
      "move-aoyosumu-tears-of-the-mystic",
      "move-haokiru-dragon-swipes",
    ]);
    const rows = matrix.occurrences.filter((row) => sourceIds.has(row.sourceDefinitionId));

    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.status === "supported-generic")).toBe(true);
    expect(
      rows.every(
        (row) => row.capabilityId === "modify-roll.v1" || row.capabilityId === "damage-modifier.v1",
      ),
    ).toBe(true);
  });

  it("classifies durable damage lifecycles as generic damage-modifier coverage", () => {
    const matrix = createCombatCapabilityMatrix();
    const sourceIds = new Set([
      "move-midorikatai-monster-mash",
      "move-midorikatai-ankle-buster",
      "move-midorikatai-one-two-punch",
      "move-freestyle-underdog-dropkick",
      "move-haokiru-soul-breaker",
      "move-aoyosumu-swift-neck-chop",
    ]);
    const rows = matrix.occurrences.filter(
      (row) => sourceIds.has(row.sourceDefinitionId) && row.effectType === "modify-damage",
    );
    const supportedRows = rows.filter((row) => row.status === "supported-generic");

    expect(supportedRows.length).toBeGreaterThanOrEqual(7);
    expect(
      supportedRows.every(
        (row) => row.capabilityId === "damage-modifier.v1" && row.executor === "damage-modifier",
      ),
    ).toBe(true);
  });

  it("classifies combat-limited action and upkeep damage modifiers generically", () => {
    const matrix = createCombatCapabilityMatrix();
    const rows = matrix.occurrences.filter(
      (row) =>
        (row.sourceDefinitionId === "move-afterlife-special-fighting-pose-1" &&
          row.effectIndex === 0) ||
        (row.sourceDefinitionId === "move-midorikatai-war-cry" && row.effectIndex === 0) ||
        (row.sourceDefinitionId === "move-aoyosumu-quiet-preparation" && row.effectIndex === 0),
    );

    expect(rows).toEqual([
      expect.objectContaining({
        sourceDefinitionId: "move-afterlife-special-fighting-pose-1",
        status: "supported-generic",
        capabilityId: "damage-modifier.v1",
        executor: "damage-modifier",
      }),
      expect.objectContaining({
        sourceDefinitionId: "move-aoyosumu-quiet-preparation",
        status: "supported-generic",
        capabilityId: "damage-modifier.v1",
        executor: "combat-result-count-damage-modifier",
      }),
      expect.objectContaining({
        sourceDefinitionId: "move-midorikatai-war-cry",
        status: "supported-generic",
        capabilityId: "damage-modifier.v1",
        executor: "damage-modifier",
      }),
    ]);
  });

  it("classifies Lights Out Strike as a selected future damage modifier", () => {
    expect(
      createCombatCapabilityMatrix().occurrences.find(
        (row) =>
          row.sourceDefinitionId === "move-aoyosumu-lights-out-strike" && row.effectIndex === 0,
      ),
    ).toMatchObject({
      status: "supported-generic",
      capabilityId: "damage-modifier.v2",
      executor: "selected-move-damage-modifier",
    });
  });

  it("classifies prior-action conditions as generic executor coverage", () => {
    const matrix = createCombatCapabilityMatrix();
    const sourceIds = new Set([
      "move-midorikatai-smackdown",
      "move-afterlife-final-revenger",
      "move-afterlife-masenko",
    ]);
    const rows = matrix.occurrences.filter(
      (row) =>
        sourceIds.has(row.sourceDefinitionId) && row.variant.includes("conditions=prior-action"),
    );

    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.status === "supported-generic")).toBe(true);
  });

  it("classifies the skipped-turn following-action damage variant generically", () => {
    expect(
      createCombatCapabilityMatrix().occurrences.find(
        (row) => row.sourceDefinitionId === "move-kiihakai-power-boost" && row.effectIndex === 1,
      ),
    ).toMatchObject({
      status: "supported-generic",
      capabilityId: "damage-modifier.v1",
      executor: "damage-modifier",
    });
  });

  it("classifies action-sequence conditions as generic executor coverage", () => {
    const matrix = createCombatCapabilityMatrix();
    const sourceIds = new Set([
      "move-akaikaru-berserker-mastery",
      "move-aoyosumu-sky-dance-technique",
      "move-kurokonwaku-kick-them-when-they-re-down",
      "move-midorikatai-violence-party",
    ]);
    const rows = matrix.occurrences.filter(
      (row) =>
        sourceIds.has(row.sourceDefinitionId) && row.variant.includes("conditions=action-sequence"),
    );

    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.status === "supported-generic")).toBe(true);
  });

  it("classifies deterministic on-damage modifiers as generic coverage", () => {
    const matrix = createCombatCapabilityMatrix();
    const rows = matrix.occurrences.filter(
      (row) =>
        row.effectType === "modify-damage" &&
        row.variant.includes("trigger=on-damage") &&
        row.status === "supported-generic",
    );
    expect(rows.map((row) => row.sourceDefinitionId)).toEqual([
      "move-haokiru-muscle-infusion",
      "move-haokiru-advanced-behavior",
      "move-midorikatai-critical-mass-mastery",
    ]);
  });

  it("classifies resource-comparison conditions across cost, damage, and resource effects", () => {
    const matrix = createCombatCapabilityMatrix();
    const sourceIds = new Set([
      "move-haokiru-focused-spirit-cutter",
      "move-haokiru-dragon-effect",
      "move-kurokonwaku-tesla-coil",
    ]);
    const rows = matrix.occurrences.filter(
      (row) => sourceIds.has(row.sourceDefinitionId) && row.variant.includes("resource-comparison"),
    );

    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.status === "supported-generic")).toBe(true);
  });

  it("classifies durable move-effect conditions through the generic executors", () => {
    const matrix = createCombatCapabilityMatrix();
    const rows = matrix.occurrences.filter(
      (row) =>
        row.sourceDefinitionId === "move-afterlife-x20-kaioken-kamehameha" &&
        row.variant.includes("conditions=move-effect-active"),
    );

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === "supported-generic")).toBe(true);
    expect(rows.every((row) => row.capabilityId !== null && row.executor !== null)).toBe(true);
  });

  it("classifies resource-threshold triggers through the generic executors", () => {
    const matrix = createCombatCapabilityMatrix();
    const rows = matrix.occurrences.filter((row) =>
      row.variant.includes("trigger=on-resource-threshold"),
    );

    expect(rows).toHaveLength(7);
    expect(rows.every((row) => row.status === "supported-generic")).toBe(true);
    expect(rows.every((row) => row.executor !== null && row.focusedCoverage !== null)).toBe(true);
  });

  it("classifies Mass Genocide's per-die result dispatch through the generic executor", () => {
    const matrix = createCombatCapabilityMatrix();
    const rows = matrix.occurrences.filter(
      (row) =>
        row.sourceDefinitionId === "move-afterlife-mass-genocide-attack" &&
        row.trigger === "on-roll-result",
    );

    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.variant.includes("trigger=on-roll-result"))).toBe(true);
    expect(rows.every((row) => row.status === "supported-generic")).toBe(true);
    expect(rows.every((row) => row.executor === "roll-modifier")).toBe(true);
  });

  it("classifies explicit roll-cap scopes through the generic roll executor", () => {
    const matrix = createCombatCapabilityMatrix();
    const rows = matrix.occurrences.filter(
      (row) =>
        (row.sourceDefinitionId === "move-afterlife-vanishing-ball" ||
          row.sourceDefinitionId === "move-aoyosumu-slow-charge") &&
        row.effectType === "modify-roll",
    );

    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.status === "supported-generic")).toBe(true);
    expect(rows.every((row) => row.capabilityId === "modify-roll.v1")).toBe(true);
  });

  it("classifies active-move and moveset count variants through generic executors", () => {
    const matrix = createCombatCapabilityMatrix();
    const sourceIds = new Set([
      "move-afterlife-wolf-fang-fist",
      "move-akaikaru-accelerated-shoulder-tackle",
      "move-freestyle-heart-stab",
      "move-kiihakai-twisting-beam",
    ]);
    const rows = matrix.occurrences.filter((row) => sourceIds.has(row.sourceDefinitionId));

    expect(rows).toHaveLength(7);
    expect(rows.every((row) => row.status === "supported-generic")).toBe(true);
    expect(rows.every((row) => row.capabilityId !== null && row.executor !== null)).toBe(true);
  });

  it("classifies passive moveset slot capacity changes through the generic executor", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (row) => row.effectType === "modify-slot-capacity",
    );

    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.status === "supported-generic")).toBe(true);
    expect(rows.every((row) => row.capabilityId === "modify-slot-capacity.v1")).toBe(true);
    expect(rows.every((row) => row.executor === "moveset-slot-capacity")).toBe(true);
  });

  it("classifies flat, scope-backed floating bundles through the lifecycle executor", () => {
    const matrix = createCombatCapabilityMatrix();
    const rows = matrix.occurrences.filter(
      (row) => row.effectType === "create-floating-effect" && row.status === "supported-generic",
    );

    expect(rows).toHaveLength(21);
    expect(
      rows
        .filter((row) => row.sourceDefinitionId !== "move-kurokonwaku-vampiric-lust")
        .every((row) => row.capabilityId === "create-floating-effect.v1"),
    ).toBe(true);
    expect(rows).toContainEqual(
      expect.objectContaining({
        sourceDefinitionId: "move-kurokonwaku-vampiric-lust",
        capabilityId: "create-floating-effect.v2",
      }),
    );
    expect(rows.every((row) => row.executor === "floating-effect-lifecycle")).toBe(true);
    expect(
      rows.some(
        (row) => row.sourceDefinitionId === "move-afterlife-solar-flare" && row.effectIndex === 2,
      ),
    ).toBe(true);
    expect(
      rows.some(
        (row) =>
          row.sourceDefinitionId === "move-kiihakai-ki-jammer" &&
          row.variant.includes("duration=until-combat-result"),
      ),
    ).toBe(true);
    expect(rows.some((row) => row.sourceDefinitionId === "move-freestyle-hidden-power-level")).toBe(
      true,
    );
    expect(rows).toContainEqual(
      expect.objectContaining({
        sourceDefinitionId: "move-freestyle-monkey-sweep",
        effectIndex: 4,
        status: "supported-generic",
        capabilityId: "create-floating-effect.v1",
        executor: "floating-effect-lifecycle",
        focusedCoverage:
          "basic-attack.test.ts, progress-fight.test.ts, move-effects-runtime.test.ts",
      }),
    );
    expect(
      rows.some(
        (row) =>
          row.sourceDefinitionId === "move-midorikatai-fall-7-times-get-up-8" &&
          row.variant.includes("conditions=action-sequence"),
      ),
    ).toBe(true);
    expect(
      rows.some(
        (row) =>
          row.sourceDefinitionId === "move-haokiru-dragon-dust" &&
          row.variant.includes("duration=until-roll-threshold"),
      ),
    ).toBe(true);
  });

  it("classifies exact on-move-use follow-ups and cost modifiers generically", () => {
    const matrix = createCombatCapabilityMatrix();
    const rows = matrix.occurrences.filter(
      (row) =>
        row.origin === "move" &&
        row.trigger === "on-move-use" &&
        row.status === "supported-generic",
    );

    expect(rows).toHaveLength(13);
    expect(
      rows.every(
        (row) =>
          (row.effectType === "create-floating-effect" &&
            row.capabilityId === "create-floating-effect.v1") ||
          (row.effectType === "modify-cost" && row.capabilityId === "modify-cost.v1") ||
          (row.sourceDefinitionId === "move-kurokonwaku-cancellation-mastery" &&
            row.effectType === "negate" &&
            row.capabilityId === "negate.v1") ||
          (row.sourceDefinitionId === "move-kurokonwaku-cancellation-mastery" &&
            row.effectType === "deactivate" &&
            row.capabilityId === "deactivate.v1") ||
          (row.sourceDefinitionId === "move-haokiru-channeling-mastery" &&
            (row.effectType === "modify-damage" || row.effectType === "prevent-resolution") &&
            row.capabilityId === "pending-choice.v1") ||
          (row.sourceDefinitionId === "move-midorikatai-leg-vice" &&
            (row.effectType === "modify-stat" || row.effectType === "prevent-resolution") &&
            row.capabilityId !== null) ||
          (row.sourceDefinitionId === "move-midorikatai-grapple" &&
            row.effectType === "reactivate-deactivated-constant-skill" &&
            row.capabilityId === "reactivate-constant-skill.v1") ||
          (row.sourceDefinitionId === "move-midorikatai-test-of-strength" &&
            row.effectType === "resolve-contest" &&
            row.capabilityId === "resolve-contest.v1"),
      ),
    ).toBe(true);
  });

  it("classifies common item resource effects through the shared item executor", () => {
    const matrix = createCombatCapabilityMatrix();
    const rows = matrix.occurrences.filter(
      (row) =>
        row.origin === "item" &&
        row.effectType === "modify-resource" &&
        row.trigger === "on-move-use",
    );

    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.status === "supported-generic")).toBe(true);
    expect(rows.every((row) => row.capabilityId === "modify-resource.v1")).toBe(true);
    expect(rows.every((row) => row.executor === "item-resource")).toBe(true);
  });

  it("classifies exact defensive BREAK/SEVER prevention items through the shared response executor", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (row) => row.effectType === "item-prevent-combat-outcome" && row.trigger === "combat-action",
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.sourceDefinitionId).sort()).toEqual([
      "item-technology-cybernetic-replacements",
      "item-technology-spare-parts",
    ]);
    expect(
      rows.every(
        (row) =>
          row.status === "supported-generic" &&
          row.capabilityId === "item-prevent-combat-outcome.v1" &&
          row.executor === "item-combat-outcome-prevention",
      ),
    ).toBe(true);
  });

  it("classifies Psycho Driver's deferred resource effect through the generic lifecycle", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (row) => row.sourceDefinitionId === "move-kurokonwaku-psycho-driver",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      effectType: "modify-resource",
      status: "supported-generic",
      capabilityId: "modify-resource.v1",
      executor: "resource-change",
    });
  });

  it("classifies Bloodletter's turn-limited resource event generically", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (row) => row.sourceDefinitionId === "move-kurokonwaku-bloodletter",
    );

    expect(rows).toEqual([
      expect.objectContaining({
        effectType: "modify-resource",
        variant: expect.stringContaining("duration=turns"),
        status: "supported-generic",
        capabilityId: "modify-resource.v1",
        executor: "resource-change",
      }),
    ]);
  });

  it("classifies standard roll-cap bypass effects through the generic roll executor", () => {
    const matrix = createCombatCapabilityMatrix();
    const rows = matrix.occurrences.filter(
      (row) =>
        row.effectType === "modify-roll" &&
        row.variant.includes("cap=allow-exceed") &&
        row.status === "supported-generic",
    );

    expect(rows).toHaveLength(5);
    expect(rows.map((row) => `${row.sourceDefinitionId}#${row.effectIndex}`)).toEqual([
      "move-afterlife-multi-form#1",
      "move-afterlife-super-galick-gun#0",
      "move-afterlife-death-ball#1",
      "move-aoyosumu-opportunist#2",
      "move-midorikatai-flawless-execution-mastery#1",
    ]);
    expect(rows.every((row) => row.capabilityId === "modify-roll.v1")).toBe(true);
    expect(rows.every((row) => row.executor === "roll-modifier")).toBe(true);
  });

  it("classifies the representable start-combat boundary generically", () => {
    const matrix = createCombatCapabilityMatrix();
    const supported = matrix.occurrences.filter(
      (row) => row.trigger === "start-combat" && row.status === "supported-generic",
    );

    expect(supported.map((row) => `${row.sourceDefinitionId}#${row.effectIndex}`)).toEqual([
      "move-akaikaru-intensity-mastery#0",
      "move-aoyosumu-ceasefire-mastery#0",
      "move-freestyle-sense-power-level#0",
      "move-freestyle-sense-power-level#1",
      "move-freestyle-sense-power-level#2",
      "move-haokiru-conservation-mastery#1",
      "move-haokiru-focused-mastery#0",
      "move-haokiru-focused-mastery#1",
      "move-haokiru-focused-mastery#2",
      "move-haokiru-dragon-s-pride#0",
      "move-kiihakai-destruction-mastery#0",
      "move-kiihakai-fierce-focus-mastery#0",
      "move-kiihakai-fierce-focus-mastery#1",
      "move-kurokonwaku-control-mastery#0",
      "move-kurokonwaku-control-mastery#1",
      "move-kurokonwaku-control-mastery#2",
    ]);
    expect(supported.every((row) => row.executor !== null)).toBe(true);
  });

  it("closes every exact typed modify-resource listener occurrence", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (row) =>
        row.effectType === "modify-resource" &&
        [
          "move-akaikaru-shotgun-blast",
          "move-haokiru-dragon-s-pride",
          "move-kurokonwaku-ki-trap",
        ].includes(row.sourceDefinitionId),
    );

    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.effectType === "modify-resource")).toBe(true);
    expect(rows.every((row) => row.status === "supported-generic")).toBe(true);
    expect(rows.every((row) => row.capabilityId === "modify-resource.v1")).toBe(true);
    expect(rows.every((row) => row.executor === "resource-change")).toBe(true);
  });

  it("closes Healing Ray's representable self-choice occurrence without aliasing ally", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (row) =>
        row.sourceDefinitionId === "move-haokiru-healing-ray" &&
        (row.effectIndex === 1 || row.effectIndex === 2),
    );

    expect(rows).toContainEqual(
      expect.objectContaining({
        effectIndex: 1,
        target: "self",
        status: "supported-generic",
        capabilityId: "modify-resource.v1",
        executor: "resource-change",
      }),
    );
    expect(rows).toContainEqual(
      expect.objectContaining({
        effectIndex: 2,
        target: "ally",
        status: "audited-out-of-scope",
        approvedExclusion:
          "ally-targeted resource changes are outside the active 1v1 and remote-target scope",
      }),
    );
  });

  it("classifies x20's selected cross-trigger HP loss through the pending executor", () => {
    expect(
      createCombatCapabilityMatrix().occurrences.find(
        (row) =>
          row.sourceDefinitionId === "move-afterlife-x20-kaioken-kamehameha" &&
          row.effectIndex === 5,
      ),
    ).toMatchObject({
      status: "supported-generic",
      capabilityId: "pending-choice.v1",
      executor: "optional-effect-choice",
      focusedCoverage:
        "progress-fight.test.ts, move-effects-runtime.test.ts, effect-executors.test.ts",
    });
  });

  it("classifies same-turn and next-turn action allowances through one scheduler", () => {
    const matrix = createCombatCapabilityMatrix();
    const rows = matrix.occurrences.filter((row) => row.effectType === "grant-extra-action");
    const supported = rows.filter((row) => row.status === "supported-generic");
    const unsupported = rows.filter((row) => row.status === "unsupported-in-scope");

    expect(rows).toHaveLength(19);
    expect(supported).toHaveLength(19);
    expect(unsupported).toHaveLength(0);
    expect(
      supported.every(
        (row) =>
          row.capabilityId === "grant-extra-action.v2" &&
          row.executor === "extra-action-scheduler" &&
          row.focusedCoverage === "progress-fight.test.ts",
      ),
    ).toBe(true);
    expect(
      supported.some(
        (row) =>
          row.sourceDefinitionId === "move-kiihakai-synergy" &&
          row.effectIndex === 0 &&
          row.trigger === "on-roll-result",
      ),
    ).toBe(true);
    expect(
      supported
        .filter(
          (row) =>
            row.sourceDefinitionId === "move-akaikaru-limb-twist" ||
            row.sourceDefinitionId === "move-kurokonwaku-launching-kick",
        )
        .map((row) => [row.sourceDefinitionId, row.status, row.capabilityId, row.executor]),
    ).toEqual([
      [
        "move-akaikaru-limb-twist",
        "supported-generic",
        "grant-extra-action.v2",
        "extra-action-scheduler",
      ],
      [
        "move-kurokonwaku-launching-kick",
        "supported-generic",
        "grant-extra-action.v2",
        "extra-action-scheduler",
      ],
    ]);
    expect(unsupported.every((row) => row.prerequisite !== null)).toBe(true);
    expect(
      supported.some(
        (row) =>
          row.sourceDefinitionId === "move-afterlife-kienzan" &&
          row.scope === "next-turn" &&
          row.executor === "extra-action-scheduler",
      ),
    ).toBe(true);
    expect(
      supported.some(
        (row) =>
          row.sourceDefinitionId === "move-aoyosumu-technique-mastery" &&
          row.trigger === "passive" &&
          row.executor === "extra-action-scheduler",
      ),
    ).toBe(true);
    expect(
      supported.some(
        (row) =>
          row.sourceDefinitionId === "move-afterlife-destructo-disc" &&
          row.scope === "next-turn" &&
          row.executor === "extra-action-scheduler",
      ),
    ).toBe(true);
    expect(
      supported.some(
        (row) =>
          row.sourceDefinitionId === "move-freestyle-multitasking-kick" &&
          row.scope === "next-turn" &&
          row.executor === "extra-action-scheduler",
      ),
    ).toBe(true);
    expect(
      supported.some(
        (row) =>
          row.sourceDefinitionId === "move-aoyosumu-sky-dance-technique" &&
          row.scope === "next-turn" &&
          row.executor === "extra-action-scheduler",
      ),
    ).toBe(true);
  });

  it("classifies current-attack combat outcomes without claiming deferred selectors", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (row) => row.effectType === "grant-combat-outcome",
    );
    const supported = rows.filter((row) => row.status === "supported-generic");
    const unsupported = rows.filter((row) => row.status === "unsupported-in-scope");

    expect(rows).toHaveLength(5);
    expect(supported).toHaveLength(5);
    expect(unsupported).toHaveLength(0);
    expect(
      supported.every(
        (row) =>
          row.capabilityId === "grant-combat-outcome.v1" &&
          row.executor === "combat-outcome-status" &&
          row.focusedCoverage === "progress-fight.test.ts, move-effects-runtime.test.ts",
      ),
    ).toBe(true);
  });

  it("classifies exact damage, roll, effect, and scoped protection through the v3 move-modification executor", () => {
    const matrix = createCombatCapabilityMatrix();
    const protectedMoves = new Set([
      "move-afterlife-heat-dome-attack",
      "move-haokiru-five-finger-shot",
      "move-haokiru-neutralization",
      "move-midorikatai-knee-stomp",
      "move-midorikatai-energy-breaker",
      "move-aoyosumu-state-of-zen",
      "move-haokiru-healing-ray",
      "move-kiihakai-static-shot",
    ]);
    const rows = matrix.occurrences.filter(
      (row) =>
        row.effectType === "prevent-move-modification" &&
        protectedMoves.has(row.sourceDefinitionId),
    );

    expect(rows).toHaveLength(protectedMoves.size);
    expect(
      rows.every(
        (row) =>
          row.status === "supported-generic" &&
          row.capabilityId === "prevent-move-modification.v3" &&
          row.executor === "move-modification-prevention",
      ),
    ).toBe(true);
  });

  it("classifies exact restricted-use changes without claiming choice or history variants", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (row) => row.effectType === "modify-remaining-uses",
    );
    const supported = rows.filter((row) => row.status === "supported-generic");
    const unsupported = rows.filter((row) => row.status === "unsupported-in-scope");

    expect(rows).toHaveLength(7);
    expect(supported.map((row) => row.sourceDefinitionId)).toEqual([
      "move-afterlife-x20-kaioken-kamehameha",
      "move-aoyosumu-ceasefire-mastery",
      "move-aoyosumu-super-arm-bar-takedown",
      "move-haokiru-halting-stance",
      "move-kurokonwaku-breaking-the-cycle",
      "move-kurokonwaku-neuron-disruptor",
      "move-kurokonwaku-spiked-ball",
    ]);
    expect(
      supported.every(
        (row) =>
          row.capabilityId === "modify-remaining-uses.v1" &&
          row.executor === "restricted-use-limit",
      ),
    ).toBe(true);
    expect(unsupported).toHaveLength(0);
  });

  it("classifies exact current-action tags and the durable declared-style lifecycle", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (row) => row.effectType === "modify-move-classification",
    );
    const supported = rows.filter((row) => row.status === "supported-generic");
    const unsupported = rows.filter((row) => row.status === "unsupported-in-scope");

    expect(rows).toHaveLength(8);
    expect(supported.map((row) => row.sourceDefinitionId)).toEqual([
      "move-akaikaru-intensity-mastery",
      "move-akaikaru-shock-fist",
      "move-akaikaru-blitzkrieg",
      "move-akaikaru-no-shadow-kick",
      "move-freestyle-ki-color-cascade",
      "move-kiihakai-turn-up-the-heat",
    ]);
    expect(
      supported
        .filter((row) => row.sourceDefinitionId !== "move-akaikaru-intensity-mastery")
        .every(
          (row) =>
            row.capabilityId === "modify-move-classification.v1" &&
            row.executor === "move-classification-lifecycle",
        ),
    ).toBe(true);
    expect(supported).toContainEqual(
      expect.objectContaining({
        sourceDefinitionId: "move-akaikaru-intensity-mastery",
        capabilityId: "modify-move-classification.v2",
        executor: "start-combat-selection",
      }),
    );
    expect(unsupported).toHaveLength(0);
  });

  it("classifies scheduled resource boundaries through the generic scheduler", () => {
    const matrix = createCombatCapabilityMatrix();
    const rows = matrix.occurrences.filter((row) => row.effectType === "schedule-effect");
    const supported = rows.filter((row) => row.status === "supported-generic");
    const pending = rows.filter((row) => row.status === "unsupported-in-scope");

    expect(rows).toHaveLength(9);
    expect(supported).toHaveLength(9);
    expect(supported.every((row) => row.capabilityId === "schedule-effect.v1")).toBe(true);
    expect(supported.every((row) => row.executor === "scheduled-resource")).toBe(true);
    expect(pending).toHaveLength(0);
  });

  it("classifies the supported grouped pending-choice variants without widening optional coverage", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (row) =>
        row.sourceDefinitionId === "move-freestyle-straining-bodyslam" ||
        row.sourceDefinitionId === "move-freestyle-straining-knockback",
    );

    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.status === "supported-generic")).toBe(true);
    expect(rows.map((row) => row.capabilityId).sort()).toEqual(
      [
        "modify-cost.v1",
        "modify-resource.v1",
        "modify-resource.v1",
        "modify-roll.v1",
        "schedule-effect.v1",
      ].sort(),
    );

    expect(
      createCombatCapabilityMatrix().occurrences.filter(
        (row) => row.sourceDefinitionId === "move-haokiru-tornado-uppercut",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          effectIndex: 2,
          status: "supported-generic",
          capabilityId: "modify-resource-cost.v1",
          executor: "resource-cost-modifier",
        }),
        expect.objectContaining({
          effectIndex: 3,
          status: "supported-generic",
          capabilityId: "modify-resource-cost.v1",
          executor: "resource-cost-modifier",
        }),
      ]),
    );

    expect(
      createCombatCapabilityMatrix().occurrences.find(
        (row) => row.sourceDefinitionId === "move-freestyle-effortless",
      ),
    ).toMatchObject({
      status: "supported-generic",
      capabilityId: "pending-choice.v1",
      executor: "optional-effect-choice",
    });
  });

  it("classifies exact defense substitution choices through the generic pending executor", () => {
    const row = createCombatCapabilityMatrix().occurrences.find(
      (candidate) =>
        candidate.sourceDefinitionId === "move-haokiru-high-threshold" &&
        candidate.effectIndex === 0,
    );

    expect(row).toMatchObject({
      status: "supported-generic",
      capabilityId: "pending-choice.v1",
      executor: "optional-effect-choice",
    });
  });

  it("classifies Slow Charge's exact floating-effect termination choice", () => {
    expect(
      createCombatCapabilityMatrix().occurrences.find(
        (candidate) =>
          candidate.sourceDefinitionId === "move-aoyosumu-slow-charge" &&
          candidate.effectIndex === 2,
      ),
    ).toMatchObject({
      status: "supported-generic",
      capabilityId: "end-floating-effect.v1",
      executor: "selected-floating-effect-termination",
    });
  });

  it("classifies Speed Demon's exact upkeep defense definition", () => {
    expect(
      createCombatCapabilityMatrix().occurrences.find(
        (candidate) =>
          candidate.sourceDefinitionId === "move-akaikaru-speed-demon" &&
          candidate.effectIndex === 0,
      ),
    ).toMatchObject({
      status: "supported-generic",
      capabilityId: "set-roll-definition.v1",
      executor: "next-defense-roll-definition",
    });
  });

  it("classifies Downward Spiral's exact passive activation override", () => {
    expect(
      createCombatCapabilityMatrix().occurrences.find(
        (candidate) =>
          candidate.sourceDefinitionId === "move-kiihakai-downward-spiral" &&
          candidate.effectIndex === 0,
      ),
    ).toMatchObject({
      status: "supported-generic",
      capabilityId: "override-skill-activation-prevention.v1",
      executor: "passive-skill-activation-override",
    });
  });

  it("classifies Breaker Breaker's exact next matching BREAK multiplier", () => {
    expect(
      createCombatCapabilityMatrix().occurrences.find(
        (candidate) =>
          candidate.sourceDefinitionId === "move-midorikatai-breaker-breaker" &&
          candidate.effectIndex === 1,
      ),
    ).toMatchObject({
      status: "supported-generic",
      capabilityId: "modify-combat-outcome.v1",
      executor: "next-matching-break-multiplier",
    });
  });

  it("classifies Spiked Ball's exact selected-move replacement", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (row) => row.sourceDefinitionId === "move-kurokonwaku-spiked-ball",
    );

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          effectIndex: 2,
          effectType: "replace-move-effect",
          status: "supported-generic",
          capabilityId: "replace-move-effect.v1",
          executor: "move-effect-replacement-selection",
        }),
      ]),
    );
  });

  it("classifies Follow Up's persistent selected-source copy", () => {
    expect(
      createCombatCapabilityMatrix().occurrences.find(
        (row) => row.sourceDefinitionId === "move-akaikaru-follow-up" && row.effectIndex === 0,
      ),
    ).toMatchObject({
      status: "supported-generic",
      capabilityId: "copy-move-effect.v4",
      executor: "persistent-selected-copy-attack",
    });
  });

  it("classifies Rage Mastery's exact grouped all-dice success gate", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (row) => row.sourceDefinitionId === "move-akaikaru-rage-mastery",
    );

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          effectIndex: 2,
          effectType: "require-all-dice-success",
          status: "supported-generic",
          capabilityId: "require-all-dice-success.v1",
          executor: "all-dice-success-gate",
        }),
      ]),
    );
  });

  it("classifies complete Supernova pre-roll choices as one generic supported group", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (row) => row.sourceDefinitionId === "move-afterlife-supernova",
    );

    expect(rows).toHaveLength(3);
    expect(rows.slice(0, 2)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          effectIndex: 0,
          status: "supported-generic",
          capabilityId: "modify-cost.v1",
          executor: "cost-modifier",
        }),
        expect.objectContaining({
          effectIndex: 1,
          status: "supported-generic",
          capabilityId: "set-roll-definition.v1",
          executor: "roll-definition",
        }),
      ]),
    );
    expect(rows[2]).toMatchObject({
      status: "supported-generic",
      capabilityId: "modify-roll.v1",
      executor: "roll-modifier",
    });
  });

  it("classifies Super Galick Gun's complete after-defense choice as one generic group", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (row) => row.sourceDefinitionId === "move-afterlife-super-galick-gun",
    );

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          effectIndex: 0,
          status: "supported-generic",
          capabilityId: "modify-roll.v1",
        }),
        expect.objectContaining({
          effectIndex: 1,
          status: "supported-generic",
          capabilityId: "set-combat-result.v1",
        }),
      ]),
    );
  });

  it("classifies Orange Burst's post-success damage/deactivation group generically", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (row) => row.sourceDefinitionId === "move-kiihakai-orange-burst",
    );

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          effectIndex: 0,
          status: "supported-generic",
          capabilityId: "damage-modifier.v1",
        }),
        expect.objectContaining({
          effectIndex: 1,
          status: "supported-generic",
          capabilityId: "deactivate.v1",
        }),
      ]),
    );
  });

  it("classifies the exact lifecycle deactivation catalog occurrences generically", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (row) =>
        row.effectType === "deactivate" &&
        (row.sourceDefinitionId === "move-akaikaru-relentless" ||
          row.sourceDefinitionId === "move-akaikaru-impulsive"),
    );

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === "supported-generic")).toBe(true);
    expect(rows.every((row) => row.capabilityId === "deactivate.v1")).toBe(true);
  });

  it("classifies Sixty Second Meltdown's grouped extra-action cost effects generically", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (row) => row.sourceDefinitionId === "move-kurokonwaku-sixty-second-meltdown",
    );

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          effectIndex: 0,
          status: "supported-generic",
          capabilityId: "grant-extra-action.v2",
          executor: "extra-action-scheduler",
        }),
        expect.objectContaining({
          effectIndex: 1,
          status: "supported-generic",
          capabilityId: "modify-cost.v1",
          executor: "cost-modifier",
        }),
      ]),
    );
  });

  it("classifies every exact critical-threshold occurrence through the generic attack resolver", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (row) => row.effectType === "modify-critical-threshold",
    );

    expect(rows.map((row) => `${row.sourceDefinitionId}#${row.effectIndex}`)).toEqual([
      "move-akaikaru-volcanic-smash#0",
      "move-aoyosumu-crescent-kick#0",
      "move-midorikatai-critical-mass-mastery#0",
      "move-midorikatai-critical-mass-mastery#1",
    ]);
    expect(
      rows.every(
        (row) =>
          row.status === "supported-generic" &&
          row.capabilityId === "modify-critical-threshold.v1" &&
          row.executor === "critical-threshold",
      ),
    ).toBe(true);
  });

  it("classifies Critical Mass Master's critical on-damage modifier generically", () => {
    expect(
      createCombatCapabilityMatrix().occurrences.find(
        (row) =>
          row.sourceDefinitionId === "move-midorikatai-critical-mass-mastery" &&
          row.effectIndex === 2,
      ),
    ).toMatchObject({
      status: "supported-generic",
      capabilityId: "damage-modifier.v1",
      executor: "damage-modifier",
      focusedCoverage: "basic-attack.test.ts, progress-fight.test.ts",
    });
  });

  it("classifies Muscle Infusion's serialized on-damage choice generically", () => {
    const rows = createCombatCapabilityMatrix().occurrences;
    expect(
      rows.find(
        (row) => row.sourceDefinitionId === "move-haokiru-muscle-infusion" && row.effectIndex === 0,
      ),
    ).toMatchObject({
      status: "supported-generic",
      capabilityId: "damage-modifier.v1",
      executor: "damage-modifier",
    });
  });

  it("classifies automatic roll-modifier transformations without widening Stoicism", () => {
    const rows = createCombatCapabilityMatrix().occurrences;
    expect(
      rows.filter(
        (row) =>
          row.sourceDefinitionId === "move-akaikaru-agile-medley" ||
          row.sourceDefinitionId === "move-akaikaru-rolling-thunder",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceDefinitionId: "move-akaikaru-agile-medley",
          status: "supported-generic",
          capabilityId: "modify-roll-modifier.v1",
          executor: "roll-modifier-transformer",
        }),
        expect.objectContaining({
          sourceDefinitionId: "move-akaikaru-rolling-thunder",
          status: "supported-generic",
          capabilityId: "modify-roll-modifier.v1",
          executor: "roll-modifier-transformer",
        }),
      ]),
    );
    expect(rows.find((row) => row.sourceDefinitionId === "move-aoyosumu-stoicism")).toMatchObject({
      status: "supported-generic",
      capabilityId: "modify-roll-modifier.v1",
      executor: "roll-modifier-transformer",
    });
  });
});
