import { describe, expect, it } from "vitest";

import {
  createCombatCapabilityMatrix,
  renderCombatCapabilityMatrix,
} from "./combat-capability-matrix.js";

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
    expect(rendered).toContain("## Unsupported in-scope priorities");
    expect(rendered).toContain("| Rank | Prerequisite | Effect type | Occurrences | Definitions |");
    expect(rendered).toMatch(/\| 1 \| .+ \| .+ \| \d+ \| \d+ \|/);
  });

  it("classifies exact successful CONSTANT Skill activation choices", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (row) => row.effectType === "activate" && row.capabilityId === "activate.v1",
    );

    expect(rows.map((row) => row.sourceDefinitionId)).toEqual([
      "move-freestyle-monkey-sweep",
      "move-freestyle-tricky-sword-maneuvers",
      "move-kiihakai-kinetic-outburst",
      "move-kiihakai-triple-torpedo",
    ]);
    expect(rows.every((row) => row.status === "supported-generic")).toBe(true);
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

  it("classifies the stopped-fraction lock while retaining Anger's unsupported source cost", () => {
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
        status: "unsupported-in-scope",
        reason: expect.stringContaining("source-move-ki-cost"),
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

  it("classifies Creationist's exclusive cost-modified alternatives through the pending cost executor", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (candidate) =>
        candidate.sourceDefinitionId === "move-haokiru-creationist" &&
        candidate.effectIndex !== undefined,
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
          row.sourceDefinitionId === "move-freestyle-underdog-evasion") &&
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
    ]);
    expect(
      deferred.every(
        (row) =>
          row.capabilityId === "set-combat-result.v1" &&
          row.executor === "combat-result-override" &&
          row.focusedCoverage === "progress-fight.test.ts",
      ),
    ).toBe(true);
    expect(rows.filter((row) => row.status === "unsupported-in-scope")).toHaveLength(4);
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
    ).toEqual(["lock", "modify-cost"]);
    expect(
      rows
        .filter((row) => row.status === "unsupported-in-scope")
        .every((row) => row.prerequisite === "generic pending-choice compilation and resolution"),
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

    for (const effectIndex of [1, 3])
      expect(
        matrix.occurrences.find(
          (row) =>
            row.sourceDefinitionId === "move-afterlife-petrifying-spit" &&
            row.effectIndex === effectIndex,
        ),
      ).toMatchObject({ status: "unsupported-in-scope" });
  });

  it("classifies exact future-turn action restrictions through the durable generic executor", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (row) => row.effectType === "skip-action",
    );
    const supported = rows.filter((row) => row.status === "supported-generic");
    const unsupported = rows.filter((row) => row.status === "unsupported-in-scope");

    expect(rows).toHaveLength(10);
    expect(supported).toHaveLength(8);
    expect(
      supported.every(
        (row) => row.capabilityId === "skip-action.v1" && row.executor === "action-restriction",
      ),
    ).toBe(true);
    expect(unsupported.map((row) => [row.sourceDefinitionId, row.effectIndex])).toEqual([
      ["move-afterlife-petrifying-spit", 3],
      ["move-kiihakai-power-boost", 0],
    ]);
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
        status: "unsupported-in-scope",
        prerequisite: "typed compiled damage context and resolution-local state",
      }),
      expect.objectContaining({
        sourceDefinitionId: "move-midorikatai-war-cry",
        status: "supported-generic",
        capabilityId: "damage-modifier.v1",
        executor: "damage-modifier",
      }),
    ]);
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

  it("classifies flat, scope-backed floating bundles through the lifecycle executor", () => {
    const matrix = createCombatCapabilityMatrix();
    const rows = matrix.occurrences.filter(
      (row) => row.effectType === "create-floating-effect" && row.status === "supported-generic",
    );

    expect(rows).toHaveLength(16);
    expect(rows.every((row) => row.capabilityId === "create-floating-effect.v1")).toBe(true);
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

    expect(rows).toHaveLength(5);
    expect(
      rows.every(
        (row) =>
          (row.effectType === "create-floating-effect" &&
            row.capabilityId === "create-floating-effect.v1") ||
          (row.effectType === "modify-cost" && row.capabilityId === "modify-cost.v1"),
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
      "move-freestyle-sense-power-level#0",
      "move-freestyle-sense-power-level#1",
      "move-freestyle-sense-power-level#2",
      "move-haokiru-conservation-mastery#1",
      "move-haokiru-focused-mastery#0",
      "move-haokiru-focused-mastery#1",
      "move-kurokonwaku-control-mastery#1",
    ]);
    expect(supported.every((row) => row.executor !== null)).toBe(true);
  });

  it("classifies same-turn and next-turn action allowances through one scheduler", () => {
    const matrix = createCombatCapabilityMatrix();
    const rows = matrix.occurrences.filter((row) => row.effectType === "grant-extra-action");
    const supported = rows.filter((row) => row.status === "supported-generic");
    const unsupported = rows.filter((row) => row.status === "unsupported-in-scope");

    expect(rows).toHaveLength(19);
    expect(supported).toHaveLength(16);
    expect(unsupported).toHaveLength(3);
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
    expect(supported).toHaveLength(4);
    expect(unsupported).toHaveLength(1);
    expect(
      supported.every(
        (row) =>
          row.capabilityId === "grant-combat-outcome.v1" &&
          row.executor === "combat-outcome-status" &&
          row.focusedCoverage === "progress-fight.test.ts, move-effects-runtime.test.ts",
      ),
    ).toBe(true);
    expect(unsupported[0]).toMatchObject({
      sourceDefinitionId: "move-kiihakai-ki-barbs",
      effectIndex: 2,
      prerequisite: "typed executor accounting and compiled effect-plan validation",
    });
  });

  it("classifies exact damage and roll protection through the v2 move-modification executor", () => {
    const matrix = createCombatCapabilityMatrix();
    const protectedMoves = new Set([
      "move-afterlife-heat-dome-attack",
      "move-haokiru-five-finger-shot",
      "move-haokiru-neutralization",
      "move-midorikatai-knee-stomp",
      "move-midorikatai-energy-breaker",
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
          row.capabilityId === "prevent-move-modification.v2" &&
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
      "move-aoyosumu-super-arm-bar-takedown",
      "move-kurokonwaku-breaking-the-cycle",
      "move-kurokonwaku-neuron-disruptor",
    ]);
    expect(
      supported.every(
        (row) =>
          row.capabilityId === "modify-remaining-uses.v1" &&
          row.executor === "restricted-use-limit",
      ),
    ).toBe(true);
    expect(unsupported.map((row) => row.sourceDefinitionId)).toEqual([
      "move-aoyosumu-ceasefire-mastery",
      "move-haokiru-halting-stance",
      "move-kurokonwaku-spiked-ball",
    ]);
  });

  it("classifies exact current-action tag additions without claiming selection or style lifecycles", () => {
    const rows = createCombatCapabilityMatrix().occurrences.filter(
      (row) => row.effectType === "modify-move-classification",
    );
    const supported = rows.filter((row) => row.status === "supported-generic");
    const unsupported = rows.filter((row) => row.status === "unsupported-in-scope");

    expect(rows).toHaveLength(8);
    expect(supported.map((row) => row.sourceDefinitionId)).toEqual([
      "move-akaikaru-shock-fist",
      "move-akaikaru-blitzkrieg",
      "move-akaikaru-no-shadow-kick",
      "move-kiihakai-turn-up-the-heat",
    ]);
    expect(
      supported.every(
        (row) =>
          row.capabilityId === "modify-move-classification.v1" &&
          row.executor === "current-action-move-classification",
      ),
    ).toBe(true);
    expect(unsupported).toHaveLength(4);
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
          status: "unsupported-in-scope",
          prerequisite: "generic pending-choice compilation and resolution",
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
});
