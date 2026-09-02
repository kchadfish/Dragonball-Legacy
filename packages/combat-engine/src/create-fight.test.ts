import { describe, expect, it } from "vitest";

import type {
  ActiveExtraActionEffect,
  ActiveScheduledResourceEffect,
  CreateFightInput,
  FightState,
} from "./index.js";
import { advanceFight, CANONICAL_COMBAT_MECHANICS_VIEW, createFight } from "./index.js";
import {
  activeEffectIdSchema,
  combatantIdSchema,
  combatDecisionIdSchema,
  combatEventIdSchema,
  fightIdSchema,
  pendingDecisionIdSchema,
  resolutionFrameIdSchema,
  scheduledWorkIdSchema,
} from "./ids.js";
import { validateFightState } from "./invariants.js";
import { createTestCombatDependencies } from "./testing/index.js";

const firstCombatantId = combatantIdSchema.parse("combatant:goku");
const secondCombatantId = combatantIdSchema.parse("combatant:vegeta");

const input: CreateFightInput = {
  mode: "spar",
  combatants: [
    {
      maximumHitPoints: 150,
      stats: { power: 20, dexterity: 4, dexterityBonus: 1 },
      moveIds: ["move-freestyle-hidden-power-level"],
    },
    {
      maximumHitPoints: 125,
      stats: { power: 18, dexterity: 5, dexterityBonus: 2 },
      moveIds: ["move-afterlife-give-me-energy"],
    },
  ],
};

const createDependencies = () =>
  createTestCombatDependencies([], new Date("2026-08-04T12:00:00.000Z"), {
    fightIds: [fightIdSchema.parse("fight:opening-spar")],
    combatantIds: [firstCombatantId, secondCombatantId],
    eventIds: [
      combatEventIdSchema.parse("event:fight-started"),
      combatEventIdSchema.parse("event:turn-started"),
    ],
  });

describe("createFight", () => {
  it("persists canonical race and transformation profiles without legacy IDs", () => {
    const result = createFight(
      {
        mode: "spar",
        combatants: [
          {
            maximumHitPoints: 100,
            stats: { power: 20, dexterity: 4, dexterityBonus: 0 },
            moveIds: [],
            raceId: "race-humans",
            transformationProfiles: [
              {
                transformationId: "transformation-humans-1-high-tension",
                rollSides: 20,
                mastery: "novice",
              },
            ],
          },
          {
            maximumHitPoints: 100,
            stats: { power: 18, dexterity: 5, dexterityBonus: 0 },
            moveIds: [],
          },
        ],
      },
      createDependencies(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const combatant = result.value.state.combatants[firstCombatantId];
    expect(result.value.state.schemaVersion).toBe(5);
    expect(combatant).toMatchObject({
      raceId: "race-humans",
      transformationProfiles: [
        {
          transformationId: "transformation-humans-1-high-tension",
          rollSides: 20,
          mastery: "novice",
        },
      ],
    });
    expect(combatant).not.toHaveProperty("transformationIds");
    expect(combatant).not.toHaveProperty("masteredTransformationIds");
  });

  it("normalizes legacy transformation IDs and derives the fixed HP bonus on migration", () => {
    const createdFight = createFight(
      {
        ...input,
        combatants: [
          {
            ...input.combatants[0],
            maximumHitPoints: 150,
            transformationIds: ["transformation-humans-1-high-tension"],
            masteredTransformationIds: ["transformation-humans-1-high-tension"],
          },
          input.combatants[1],
        ],
      },
      createDependencies(),
    );
    if (!createdFight.ok) throw new Error("Expected initial fight creation to succeed.");
    const legacyCombatant = createdFight.value.state.combatants[firstCombatantId];
    const result = advanceFight(
      {
        ...createdFight.value.state,
        schemaVersion: 2,
        combatants: {
          ...createdFight.value.state.combatants,
          [firstCombatantId]: {
            ...legacyCombatant,
            transformationProfiles: undefined,
            transformationIds: ["transformation-humans-1-high-tension"],
            masteredTransformationIds: ["transformation-humans-1-high-tension"],
            hitPoints: { current: 160, maximum: 175 },
            transformation: {
              transformationId: "transformation-humans-1-high-tension",
              activatedOnTurn: 1,
              baseline: {
                currentHitPoints: 150,
                maximumHitPoints: 150,
                stats: legacyCombatant.stats,
              },
            },
          },
        },
      },
      createDependencies(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const combatant = result.value.state.combatants[firstCombatantId];
    expect(result.value.state.schemaVersion).toBe(5);
    expect(combatant.transformationProfiles).toEqual([
      {
        transformationId: "transformation-humans-1-high-tension",
        rollSides: 100,
        mastery: "mastered",
      },
    ]);
    expect(combatant.transformation?.baseline).toEqual({
      maximumHitPoints: 150,
      hpBonus: 25,
      stats: legacyCombatant.stats,
    });
  });

  it("rejects mismatched race ownership and out-of-scope canonical transformations", () => {
    const result = createFight(
      {
        mode: "spar",
        combatants: [
          {
            maximumHitPoints: 100,
            stats: { power: 20, dexterity: 4, dexterityBonus: 0 },
            moveIds: [],
            raceId: "race-humans",
            transformationProfiles: [
              {
                transformationId: "transformation-ghost-2-ghoul",
                rollSides: 20,
                mastery: "novice",
              },
            ],
          },
          input.combatants[1],
        ],
      },
      createDependencies(),
    );
    expect(result).toMatchObject({ ok: false, error: { type: "invalid-fight-setup" } });
  });

  it("accepts cross-race trait snapshots and validates selected trait/class identity", () => {
    const valid = createFight(
      {
        ...input,
        combatants: [
          {
            ...input.combatants[0],
            raceId: "race-humans",
            raceTraitIds: ["race-trait-saiyans-saiyan-might"],
            classId: "generic-class-weaponmaster",
          },
          input.combatants[1],
        ],
      },
      createDependencies(),
    );
    expect(valid.ok).toBe(true);
    if (valid.ok)
      expect(valid.value.state.combatants[firstCombatantId]).toMatchObject({
        raceTraitIds: ["race-trait-saiyans-saiyan-might"],
        classId: "generic-class-weaponmaster",
      });

    const duplicateTrait = createFight(
      {
        ...input,
        combatants: [
          {
            ...input.combatants[0],
            raceTraitIds: ["race-trait-saiyans-saiyan-might", "race-trait-saiyans-saiyan-might"],
            classId: "generic-class-weaponmaster",
          },
          input.combatants[1],
        ],
      },
      createDependencies(),
    );
    expect(duplicateTrait).toMatchObject({ ok: false, error: { type: "invalid-fight-setup" } });
    if (!duplicateTrait.ok && duplicateTrait.error.type === "invalid-fight-setup")
      expect(duplicateTrait.error.issues.map((issue) => issue.message)).toEqual([
        "Race trait IDs must not contain duplicates.",
      ]);

    const unknownClass = createFight(
      {
        ...input,
        combatants: [
          {
            ...input.combatants[0],
            raceTraitIds: ["race-trait-saiyans-saiyan-might"],
            classId: "generic-class-does-not-exist",
          },
          input.combatants[1],
        ],
      },
      createDependencies(),
    );
    expect(unknownClass).toMatchObject({ ok: false, error: { type: "invalid-fight-setup" } });
    if (!unknownClass.ok && unknownClass.error.type === "invalid-fight-setup")
      expect(unknownClass.error.issues.map((issue) => issue.message)).toEqual([
        "Unknown class ID: generic-class-does-not-exist.",
      ]);
  });

  it("applies selected innate start-combat resources through the public transition", () => {
    const createdFight = createFight(
      {
        ...input,
        combatants: [
          {
            ...input.combatants[0],
            raceId: "race-namek",
            raceTraitIds: ["race-trait-namek-meditative-preparation"],
          },
          input.combatants[1],
        ],
      },
      createDependencies(),
    );
    if (!createdFight.ok) throw new Error("Expected initial fight creation to succeed.");
    const advanced = advanceFight(createdFight.value.state, createDependencies());
    expect(advanced).toMatchObject({ ok: true });
    if (advanced.ok) expect(advanced.value.state.combatants[firstCombatantId].ki.current).toBe(7);
  });

  it("resolves selected start-combat stored rolls before thresholded Ki setup", () => {
    const dependencies = createTestCombatDependencies([5], new Date("2026-08-04T12:00:00.000Z"), {
      fightIds: [fightIdSchema.parse("fight:demonic-potential")],
      combatantIds: [firstCombatantId, secondCombatantId],
      eventIds: [
        combatEventIdSchema.parse("event:demonic-potential-start"),
        combatEventIdSchema.parse("event:demonic-potential-turn"),
      ],
    });
    const result = createFight(
      {
        ...input,
        combatants: [
          {
            ...input.combatants[0],
            raceId: "race-makaioshin",
            raceTraitIds: ["race-trait-makaioshin-demonic-potential"],
          },
          input.combatants[1],
        ],
      },
      dependencies,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.combatants[firstCombatantId].ki.current).toBe(10);
    expect(
      result.value.state.combatants[firstCombatantId].storedRolls?.["demonic-potential-start-roll"],
    ).toMatchObject({ naturalResults: [5], sides: 10 });
  });

  it("normalizes a legacy snapshot without a schema marker at the public boundary", () => {
    const createdFight = createFight(input, createDependencies());
    if (!createdFight.ok) throw new Error("Expected initial fight creation to succeed.");
    const legacyState = { ...createdFight.value.state };
    Reflect.deleteProperty(legacyState, "schemaVersion");
    const result = advanceFight(legacyState, createDependencies());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.schemaVersion).toBe(5);
  });

  it("migrates scheduling-only v1 effects into queued work at the public boundary", () => {
    const createdFight = createFight(input, createDependencies());
    if (!createdFight.ok) throw new Error("Expected initial fight creation to succeed.");
    const legacyEffect: ActiveExtraActionEffect = {
      id: activeEffectIdSchema.parse("active-effect:legacy-extra-action"),
      type: "extra-action",
      sourceCombatantId: secondCombatantId,
      targetCombatantId: secondCombatantId,
      sourceDefinitionId: "move-afterlife-give-me-energy",
      sourceEffectIndex: 0,
      phase: "action",
      sourceMoveOnly: false,
      remainingActions: 1,
      availableFromTurn: 1,
      expiresAfterTurn: 1,
    };
    const result = advanceFight(
      {
        ...createdFight.value.state,
        schemaVersion: 1,
        activeEffects: [legacyEffect],
      },
      createDependencies(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state).toMatchObject({
      schemaVersion: 5,
      activeEffects: [],
      scheduledWork: [
        expect.objectContaining({
          sourceEffectId: legacyEffect.id,
          operation: expect.objectContaining({ type: "extra-action" }),
        }),
      ],
    });
  });

  it("executes a migrated v1 scheduled resource without an active-effect mirror", () => {
    const dependencies = createTestCombatDependencies([], new Date("2026-08-29T12:00:00.000Z"), {
      fightIds: [fightIdSchema.parse("fight:legacy-scheduled-resource")],
      combatantIds: [firstCombatantId, secondCombatantId],
      activeEffectIds: [activeEffectIdSchema.parse("active-effect:legacy-resource")],
      eventIds: Array.from({ length: 40 }, (_, index) =>
        combatEventIdSchema.parse(`event:legacy-scheduled-resource-${index}`),
      ),
    });
    const createdFight = createFight(input, dependencies);
    if (!createdFight.ok || createdFight.value.state.status !== "active")
      throw new Error("Expected initial fight creation to succeed.");
    const initialState = createdFight.value.state;
    const sourceCombatantId = initialState.activeCombatantId;
    const targetCombatantId = Object.values(initialState.combatants).find(
      (combatant) => combatant.id !== sourceCombatantId,
    )!.id;
    const legacyEffect: ActiveScheduledResourceEffect = {
      id: activeEffectIdSchema.parse("active-effect:legacy-resource"),
      type: "scheduled-resource",
      sourceCombatantId,
      targetCombatantId,
      sourceDefinitionId: "move-afterlife-burning-shoot",
      sourceEffectIndex: 0,
      timing: { type: "turn-end", combatantId: sourceCombatantId },
      remainingBoundaries: 1,
      repeat: "once",
      resource: "hp",
      operation: "damage",
      amount: { type: "literal", value: 4 },
    };
    const legacyState: FightState = {
      ...initialState,
      schemaVersion: 1,
      phase: "end",
      activeEffects: [legacyEffect],
    };
    const result = advanceFight(legacyState, dependencies);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.combatants[targetCombatantId].hitPoints.current).toBe(
      initialState.combatants[targetCombatantId].hitPoints.current - 4,
    );
    expect(result.value.state.activeEffects).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "scheduled-resource" })]),
    );
    expect(result.value.state.scheduledWork).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: expect.objectContaining({ type: "resource" }),
        }),
      ]),
    );
  });

  it("creates a deterministic, valid initial 1v1 state without mutating setup input", () => {
    const originalInput = structuredClone(input);
    const result = createFight(input, createDependencies());

    expect(result).toEqual({
      ok: true,
      value: {
        state: {
          id: fightIdSchema.parse("fight:opening-spar"),
          schemaVersion: 5,
          mechanicsView: CANONICAL_COMBAT_MECHANICS_VIEW.identity,
          version: 0,
          rulesVersion: { value: "legacy-reference-2026-08", sourcePath: "reference/rules.md" },
          mode: "spar",
          status: "active",
          turnNumber: 1,
          phase: "upkeep",
          activeCombatantId: secondCombatantId,
          activeEffects: [],
          actionHistory: [],
          resolutionFrames: [],
          scheduledWork: [],
          combatants: {
            [firstCombatantId]: {
              id: firstCombatantId,
              hitPoints: { current: 150, maximum: 150 },
              ki: { current: 5, maximum: 10 },
              stats: { power: 20, dexterity: 4, dexterityBonus: 1 },
              moveIds: ["move-freestyle-hidden-power-level"],
              slotCapacities: {
                mastery: 1,
                skill: 4,
                "advanced-attack": 5,
                signature: 2,
                block: 2,
              },
              slotCapacityModifications: [],
              moveUses: {},
              moveUseLimitModifiers: {},
              storedRolls: {},
              itemUses: {},
              activeStatuses: [],
              transformationProfiles: [],
              status: "active",
            },
            [secondCombatantId]: {
              id: secondCombatantId,
              hitPoints: { current: 125, maximum: 125 },
              ki: { current: 5, maximum: 10 },
              stats: { power: 18, dexterity: 5, dexterityBonus: 2 },
              moveIds: ["move-afterlife-give-me-energy"],
              slotCapacities: {
                mastery: 1,
                skill: 4,
                "advanced-attack": 5,
                signature: 2,
                block: 2,
              },
              slotCapacityModifications: [],
              moveUses: {},
              moveUseLimitModifiers: {},
              storedRolls: {},
              itemUses: {},
              activeStatuses: [],
              transformationProfiles: [],
              status: "active",
            },
          },
          eventSequence: 2,
        },
        events: expect.arrayContaining([
          {
            id: combatEventIdSchema.parse("event:fight-started"),
            sequence: 1,
            fightId: fightIdSchema.parse("fight:opening-spar"),
            type: "fight-started",
            mode: "spar",
          },
          {
            id: combatEventIdSchema.parse("event:turn-started"),
            sequence: 2,
            fightId: fightIdSchema.parse("fight:opening-spar"),
            type: "turn-started",
            combatantId: secondCombatantId,
            turnNumber: 1,
          },
        ]),
      },
    });
    expect(input).toEqual(originalInput);
  });

  it("rejects malformed setup before consuming fight IDs", () => {
    const result = createFight(
      {
        ...input,
        unexpected: true,
        combatants: [input.combatants[0]],
      },
      createDependencies(),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        type: "invalid-fight-setup",
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "" }),
          expect.objectContaining({ path: "combatants" }),
        ]),
      },
    });
  });

  it("materializes passive move-slot capacity modifiers in the initial state", () => {
    const result = createFight(
      {
        ...input,
        combatants: [
          { ...input.combatants[0], moveIds: ["move-aoyosumu-technique-mastery"] },
          input.combatants[1],
        ],
      },
      createDependencies(),
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        state: {
          combatants: {
            [firstCombatantId]: {
              slotCapacities: { skill: 5 },
              slotCapacityModifications: [
                {
                  sourceDefinitionId: "move-aoyosumu-technique-mastery",
                  sourceEffectIndex: 0,
                  slot: "skill",
                  amount: 1,
                },
              ],
            },
          },
        },
      },
    });
    if (!result.ok) throw new Error("Expected the capacity-modifier fight to be valid.");
    expect(validateFightState(result.value.state)).toEqual([]);
    expect(result.value.state.version).toBe(0);
  });

  it("uses injected 1d100 rolls to resolve equal-Dexterity initiative", () => {
    const result = createFight(
      {
        ...input,
        combatants: [
          { ...input.combatants[0], stats: { ...input.combatants[0].stats, dexterity: 4 } },
          { ...input.combatants[1], stats: { ...input.combatants[1].stats, dexterity: 4 } },
        ],
      },
      createTestCombatDependencies([12, 82], new Date("2026-08-04T12:00:00.000Z"), {
        fightIds: [fightIdSchema.parse("fight:tied-initiative")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: [
          combatEventIdSchema.parse("event:fight-started"),
          combatEventIdSchema.parse("event:initiative-first"),
          combatEventIdSchema.parse("event:initiative-second"),
          combatEventIdSchema.parse("event:turn-started"),
        ],
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        state: { activeCombatantId: secondCombatantId, eventSequence: 4 },
        events: expect.arrayContaining([
          expect.objectContaining({ type: "fight-started", sequence: 1 }),
          expect.objectContaining({
            type: "initiative-rolled",
            combatantId: firstCombatantId,
            naturalResult: 12,
            sequence: 2,
          }),
          expect.objectContaining({
            type: "initiative-rolled",
            combatantId: secondCombatantId,
            naturalResult: 82,
            sequence: 3,
          }),
          expect.objectContaining({ type: "turn-started", sequence: 4 }),
        ]),
      },
    });
  });

  it("rerolls an equal initiative tie until one combatant wins", () => {
    const result = createFight(
      {
        ...input,
        combatants: [
          { ...input.combatants[0], stats: { ...input.combatants[0].stats, dexterity: 4 } },
          { ...input.combatants[1], stats: { ...input.combatants[1].stats, dexterity: 4 } },
        ],
      },
      createTestCombatDependencies([40, 40, 3, 4], new Date("2026-08-04T12:00:00.000Z"), {
        fightIds: [fightIdSchema.parse("fight:rerolled-initiative")],
        combatantIds: [firstCombatantId, secondCombatantId],
        eventIds: Array.from({ length: 6 }, (_, index) =>
          combatEventIdSchema.parse(`event:initiative-reroll-${index + 1}`),
        ),
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        state: { activeCombatantId: secondCombatantId, eventSequence: 6 },
        events: expect.arrayContaining([
          expect.objectContaining({ type: "initiative-rolled", naturalResult: 40 }),
          expect.objectContaining({ type: "initiative-rolled", naturalResult: 40 }),
          expect.objectContaining({ type: "initiative-rolled", naturalResult: 3 }),
          expect.objectContaining({ type: "initiative-rolled", naturalResult: 4 }),
        ]),
      },
    });
  });

  it("rejects duplicate moves in a combatant's initial move list", () => {
    const result = createFight(
      {
        ...input,
        combatants: [
          {
            ...input.combatants[0],
            moveIds: ["move-freestyle-hidden-power-level", "move-freestyle-hidden-power-level"],
          },
          input.combatants[1],
        ],
      },
      createDependencies(),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        type: "invalid-fight-setup",
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "combatants.0.moveIds.1" }),
        ]),
      },
    });
  });

  it("accepts the configured negative Dexterity Bonus range and rejects values above it", () => {
    const negativeBonusResult = createFight(
      {
        ...input,
        combatants: [
          { ...input.combatants[0], stats: { ...input.combatants[0].stats, dexterityBonus: -4 } },
          input.combatants[1],
        ],
      },
      createDependencies(),
    );
    const excessiveBonusResult = createFight(
      {
        ...input,
        combatants: [
          { ...input.combatants[0], stats: { ...input.combatants[0].stats, dexterityBonus: 6 } },
          input.combatants[1],
        ],
      },
      createDependencies(),
    );

    expect(negativeBonusResult.ok).toBe(true);
    expect(excessiveBonusResult).toMatchObject({
      ok: false,
      error: {
        type: "invalid-fight-setup",
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "combatants.0.stats.dexterityBonus" }),
        ]),
      },
    });
  });

  it("rejects a move ID that is not present in converted game data", () => {
    const result = createFight(
      {
        ...input,
        combatants: [
          { ...input.combatants[0], moveIds: ["move-not-converted"] },
          input.combatants[1],
        ],
      },
      createDependencies(),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        type: "invalid-fight-setup",
        issues: expect.arrayContaining([
          expect.objectContaining({
            path: "combatants.0.moveIds.0",
            message: expect.stringContaining("Unknown move ID"),
          }),
        ]),
      },
    });
  });

  it("returns a typed state failure when an ID source produces duplicate combatant IDs", () => {
    const result = createFight(
      input,
      createTestCombatDependencies([], new Date("2026-08-04T12:00:00.000Z"), {
        fightIds: [fightIdSchema.parse("fight:opening-spar")],
        combatantIds: [firstCombatantId, firstCombatantId],
        eventIds: [
          combatEventIdSchema.parse("event:fight-started"),
          combatEventIdSchema.parse("event:turn-started"),
        ],
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        type: "invalid-fight-state",
        violations: expect.arrayContaining([
          expect.objectContaining({ type: "invalid-combatant-count" }),
        ]),
      },
    });
  });
});

describe("validateFightState", () => {
  it("accepts persisted cost and resource modifier-transformer effects", () => {
    const createdFight = createFight(input, createDependencies());
    if (!createdFight.ok) throw new Error("Expected initial fight creation to succeed.");

    const validState = {
      ...createdFight.value.state,
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:valid-cost-modifier"),
          type: "modify-next-action",
          sourceCombatantId: firstCombatantId,
          targetCombatantId: firstCombatantId,
          sourceDefinitionId: "move-afterlife-hellzone-grenade",
          modifier: { type: "cost-modifier", multiplier: 1.5 },
        },
        {
          id: activeEffectIdSchema.parse("active-effect:valid-resource-modifier"),
          type: "modify-next-action",
          sourceCombatantId: firstCombatantId,
          targetCombatantId: firstCombatantId,
          sourceDefinitionId: "move-haokiru-phoenix-tackle",
          scope: "next-turn",
          availableFromTurn: createdFight.value.state.turnNumber + 1,
          modifier: {
            type: "resource-modifier",
            resource: "hp",
            operation: "gain",
            multiplier: 2,
            cap: { type: "maximum", value: 66 },
          },
        },
      ],
    } as FightState;

    expect(validateFightState(validState)).toEqual([]);
  });

  it("rejects a floating relation target that is not an active combatant", () => {
    const createdFight = createFight(input, createDependencies());
    if (!createdFight.ok) throw new Error("Expected initial fight creation to succeed.");

    const invalidState = {
      ...createdFight.value.state,
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:invalid-floating-relation"),
          type: "floating-effect",
          sourceCombatantId: firstCombatantId,
          targetCombatantId: firstCombatantId,
          targetRelationCombatantId: combatantIdSchema.parse("combatant:unknown"),
          sourceDefinitionId: "move-afterlife-solar-flare",
          floatingEffectId: "solar-flare-same-turn-single-die-follow-up",
          effects: [],
          termination: [],
          scope: { type: "combat" },
          createdOnTurn: 1,
        },
      ],
    } as FightState;

    expect(validateFightState(invalidState)).toContainEqual(
      expect.objectContaining({ type: "invalid-active-effect" }),
    );
  });

  it("rejects active effects with invalid shared identity metadata", () => {
    const createdFight = createFight(input, createDependencies());
    if (!createdFight.ok) throw new Error("Expected initial fight creation to succeed.");
    const invalidState = {
      ...createdFight.value.state,
      activeEffects: [
        {
          id: activeEffectIdSchema.parse("active-effect:invalid-identity"),
          type: "action-restriction",
          sourceCombatantId: firstCombatantId,
          targetCombatantId: firstCombatantId,
          sourceDefinitionId: "",
          sourceEffectIndex: -1,
          remainingTurns: 1,
          availableFromTurn: 1,
        },
      ],
    } as FightState;
    expect(validateFightState(invalidState)).toContainEqual(
      expect.objectContaining({ type: "invalid-active-effect" }),
    );
  });

  it("identifies broken state counters, resources, and active combatant ownership", () => {
    const createdFight = createFight(input, createDependencies());
    if (!createdFight.ok) throw new Error("Expected initial fight creation to succeed.");

    const invalidState = {
      ...createdFight.value.state,
      version: -1,
      activeCombatantId: firstCombatantId,
      combatants: {
        ...createdFight.value.state.combatants,
        [firstCombatantId]: {
          ...createdFight.value.state.combatants[firstCombatantId],
          ki: { current: 11, maximum: 10 },
          status: "defeated",
        },
      },
    } as FightState;

    expect(validateFightState(invalidState)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "invalid-state-counter" }),
        expect.objectContaining({ type: "invalid-resource", subject: firstCombatantId }),
        expect.objectContaining({ type: "invalid-active-combatant", subject: firstCombatantId }),
      ]),
    );
  });

  it("accepts the current fight-state schema version", () => {
    const createdFight = createFight(input, createDependencies());
    if (!createdFight.ok) throw new Error("Expected initial fight creation to succeed.");

    expect(
      validateFightState({
        ...createdFight.value.state,
        schemaVersion: 5,
      } as unknown as FightState),
    ).not.toContainEqual(expect.objectContaining({ type: "invalid-schema-version" }));
  });

  it("rejects malformed scheduled work before a transition can use it", () => {
    const createdFight = createFight(input, createDependencies());
    if (!createdFight.ok) throw new Error("Expected initial fight creation to succeed.");
    const malformedWork = {
      id: scheduledWorkIdSchema.parse("scheduled-work:malformed"),
      insertionOrder: 1,
      ownerCombatantId: combatantIdSchema.parse("combatant:missing"),
      timing: { type: "immediate" },
      operation: {
        type: "resource",
        resource: "ki",
        operation: "gain",
        amount: { type: "literal", value: Number.NaN },
      },
    };

    expect(
      validateFightState({
        ...createdFight.value.state,
        scheduledWork: [malformedWork],
      } as unknown as FightState),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "invalid-scheduled-work" })]),
    );
  });

  it("identifies malformed pending decisions and completed-fight winners", () => {
    const createdFight = createFight(input, createDependencies());
    if (!createdFight.ok) throw new Error("Expected initial fight creation to succeed.");

    const invalidPendingDecisionState = {
      ...createdFight.value.state,
      pendingDecision: {
        id: pendingDecisionIdSchema.parse("pending-decision:choose-effect"),
        stateVersion: 1,
        combatantId: firstCombatantId,
        type: "optional-effect",
        options: [],
      },
    } as FightState;
    const invalidCompletedState = {
      ...createdFight.value.state,
      status: "completed",
      completion: { type: "defeat" },
    } as FightState;

    expect(validateFightState(invalidPendingDecisionState)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "invalid-pending-decision" })]),
    );
    expect(validateFightState(invalidCompletedState)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "invalid-completion" })]),
    );
  });

  it("rejects malformed combat-local restricted-use modifiers", () => {
    const createdFight = createFight(input, createDependencies());
    if (!createdFight.ok) throw new Error("Expected initial fight creation to succeed.");
    const combatant = createdFight.value.state.combatants[firstCombatantId];
    const stateWith = (moveIds: readonly string[], moveUseLimitModifiers: Record<string, number>) =>
      ({
        ...createdFight.value.state,
        combatants: {
          ...createdFight.value.state.combatants,
          [firstCombatantId]: { ...combatant, moveIds, moveUseLimitModifiers },
        },
      }) as FightState;

    for (const state of [
      stateWith(combatant.moveIds, { "move-not-owned": 1 }),
      stateWith(combatant.moveIds, { "move-freestyle-hidden-power-level": 1 }),
      stateWith(["move-kurokonwaku-breaking-the-cycle"], {
        "move-kurokonwaku-breaking-the-cycle": 0,
      }),
    ]) {
      expect(validateFightState(state)).toContainEqual(
        expect.objectContaining({ type: "invalid-combatant-state" }),
      );
    }
  });

  it("accepts canonical stored rolls and rejects malformed or unowned records", () => {
    const createdFight = createFight(
      {
        ...input,
        combatants: [
          { ...input.combatants[0], moveIds: ["move-haokiru-healing-ray"] },
          input.combatants[1],
        ],
      },
      createDependencies(),
    );
    if (!createdFight.ok) throw new Error("Expected initial fight creation to succeed.");
    const combatant = createdFight.value.state.combatants[firstCombatantId];
    const withStoredRoll = (storedRolls: NonNullable<typeof combatant.storedRolls>) =>
      ({
        ...createdFight.value.state,
        combatants: {
          ...createdFight.value.state.combatants,
          [firstCombatantId]: { ...combatant, storedRolls },
        },
      }) as FightState;
    const valid = withStoredRoll({
      "healing-ray-result": {
        sourceDefinitionId: "move-haokiru-healing-ray",
        storageKey: "healing-ray-result",
        naturalResults: [9],
        sides: 30,
        storedOnTurn: 1,
      },
    });
    const invalid = withStoredRoll({
      "healing-ray-result": {
        sourceDefinitionId: "move-haokiru-healing-ray",
        storageKey: "different-key",
        naturalResults: [31],
        sides: 30,
        storedOnTurn: 2,
      },
    });

    expect(validateFightState(valid)).toEqual([]);
    expect(validateFightState(invalid)).toContainEqual(
      expect.objectContaining({ type: "invalid-combatant-state", subject: firstCombatantId }),
    );
  });

  it("accepts canonical stored move selections and rejects unowned selections", () => {
    const createdFight = createFight(
      {
        ...input,
        combatants: [
          {
            ...input.combatants[0],
            moveIds: [
              "move-akaikaru-impulsive",
              "move-akaikaru-back-brain-kick",
              "move-akaikaru-backflip-kick",
            ],
          },
          input.combatants[1],
        ],
      },
      createDependencies(),
    );
    if (!createdFight.ok) throw new Error("Expected initial fight creation to succeed.");
    const combatant = createdFight.value.state.combatants[firstCombatantId];
    const withSelection = (
      storedMoveSelections: NonNullable<typeof combatant.storedMoveSelections>,
    ) =>
      ({
        ...createdFight.value.state,
        combatants: {
          ...createdFight.value.state.combatants,
          [firstCombatantId]: { ...combatant, storedMoveSelections },
        },
      }) as FightState;
    const valid = withSelection({
      "impulsive-selected-advanced-attack": {
        sourceDefinitionId: "move-akaikaru-impulsive",
        selectionKey: "impulsive-selected-advanced-attack",
        moveId: "move-akaikaru-backflip-kick",
        selectedOnTurn: 1,
      },
    });
    const invalid = withSelection({
      "impulsive-selected-advanced-attack": {
        sourceDefinitionId: "move-akaikaru-impulsive",
        selectionKey: "impulsive-selected-advanced-attack",
        moveId: "move-not-owned",
        selectedOnTurn: 1,
      },
    });

    expect(validateFightState(valid)).toEqual([]);
    expect(validateFightState(invalid)).toContainEqual(
      expect.objectContaining({ type: "invalid-combatant-state", subject: firstCombatantId }),
    );
  });

  it("identifies invalid temporary state for uses, statuses, transformations, history, and frames", () => {
    const createdFight = createFight(input, createDependencies());
    if (!createdFight.ok) throw new Error("Expected initial fight creation to succeed.");

    const invalidState = {
      ...createdFight.value.state,
      combatants: {
        ...createdFight.value.state.combatants,
        [firstCombatantId]: {
          ...createdFight.value.state.combatants[firstCombatantId],
          moveUses: { "move-not-owned": 0 },
          activeStatuses: [
            {
              statusId: "",
              sourceCombatantId: firstCombatantId,
              sourceDefinitionId: "",
              stacks: 0,
              duration: { type: "turns", ownerCombatantId: firstCombatantId, remaining: 0 },
            },
          ],
          transformation: { transformationId: "", activatedOnTurn: 2 },
        },
      },
      actionHistory: [
        {
          type: "use-move",
          decisionId: combatDecisionIdSchema.parse("decision:invalid-history"),
          actorId: firstCombatantId,
          targetCombatantId: firstCombatantId,
          moveId: "",
          turnNumber: 0,
          phase: "action",
        },
      ],
      resolutionFrames: [
        {
          id: resolutionFrameIdSchema.parse("resolution-frame:invalid"),
          type: "attack",
          decisionId: combatDecisionIdSchema.parse("decision:invalid-frame"),
          attackerId: firstCombatantId,
          targetCombatantId: firstCombatantId,
          returnPhase: "action",
          stage: "awaiting-counter",
        },
      ],
    } as FightState;

    expect(validateFightState(invalidState)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "invalid-use-count" }),
        expect.objectContaining({ type: "invalid-status" }),
        expect.objectContaining({ type: "invalid-transformation" }),
        expect.objectContaining({ type: "invalid-action-history" }),
        expect.objectContaining({ type: "invalid-resolution-frame" }),
      ]),
    );
  });

  it("accepts serializable temporary state that future effect slices can resume", () => {
    const createdFight = createFight(input, createDependencies());
    if (!createdFight.ok) throw new Error("Expected initial fight creation to succeed.");

    const stateWithTemporaryState = {
      ...createdFight.value.state,
      combatants: {
        ...createdFight.value.state.combatants,
        [firstCombatantId]: {
          ...createdFight.value.state.combatants[firstCombatantId],
          moveUses: { "move-freestyle-hidden-power-level": 1 },
          activeStatuses: [
            {
              statusId: "cooldown",
              sourceCombatantId: firstCombatantId,
              sourceDefinitionId: "move-freestyle-hidden-power-level",
              stacks: 1,
              duration: { type: "uses", remaining: 1 },
            },
          ],
          transformation: {
            transformationId: "transformation-ghost-2-ghoul",
            activatedOnTurn: 1,
          },
        },
      },
      actionHistory: [
        {
          type: "pass",
          decisionId: combatDecisionIdSchema.parse("decision:recorded-pass"),
          actorId: firstCombatantId,
          turnNumber: 1,
          phase: "action",
        },
      ],
      resolutionFrames: [
        {
          id: resolutionFrameIdSchema.parse("resolution-frame:pending-effect"),
          type: "effect",
          sourceCombatantId: firstCombatantId,
          targetCombatantId: secondCombatantId,
          sourceDefinitionId: "move-freestyle-hidden-power-level",
          effectIndex: 0,
          returnPhase: "action",
          trigger: "action",
        },
      ],
    } as FightState;

    expect(validateFightState(stateWithTemporaryState)).toEqual([]);
  });

  it("rejects action locks whose duration refers to a nonparticipant", () => {
    const createdFight = createFight(input, createDependencies());
    if (!createdFight.ok || createdFight.value.state.status !== "active") {
      throw new Error("Expected an active initial fight state.");
    }
    const invalidState: FightState = {
      ...createdFight.value.state,
      activeEffects: [
        {
          id: "active-effect:invalid-lock" as never,
          type: "action-lock",
          sourceCombatantId: firstCombatantId,
          targetCombatantId: secondCombatantId,
          sourceDefinitionId: "move-afterlife-dodon-ray",
          affectedType: "skill",
          duration: {
            type: "until-roll-threshold",
            combatantId: "combatant:missing" as never,
            roll: "attack",
            comparison: "at-least",
            value: 20,
          },
        },
      ],
    };

    expect(validateFightState(invalidState)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "invalid-active-effect" })]),
    );
  });

  it("rejects counted roll modifiers without a positive remaining count", () => {
    const createdFight = createFight(input, createDependencies());
    if (!createdFight.ok || createdFight.value.state.status !== "active") {
      throw new Error("Expected an active initial fight state.");
    }
    const invalidState: FightState = {
      ...createdFight.value.state,
      activeEffects: [
        {
          id: "active-effect:invalid-counted-roll" as never,
          type: "modify-next-action",
          sourceCombatantId: firstCombatantId,
          targetCombatantId: secondCombatantId,
          sourceDefinitionId: "move-aoyosumu-bullwhip",
          scope: "next-rolls",
          remaining: 0,
          modifier: { type: "roll", roll: "defense", modifier: "result", amount: 2 },
        },
      ],
    };

    expect(validateFightState(invalidState)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "invalid-active-effect" })]),
    );
  });

  it("rejects malformed scheduled resource state", () => {
    const createdFight = createFight(input, createDependencies());
    if (!createdFight.ok || createdFight.value.state.status !== "active") {
      throw new Error("Expected an active initial fight state.");
    }
    const invalidState: FightState = {
      ...createdFight.value.state,
      activeEffects: [
        {
          id: "active-effect:invalid-schedule" as never,
          type: "scheduled-resource",
          sourceCombatantId: firstCombatantId,
          targetCombatantId: secondCombatantId,
          sourceDefinitionId: "move-afterlife-burning-shoot",
          sourceEffectIndex: 0,
          timing: { type: "turn-start", combatantId: secondCombatantId },
          remainingBoundaries: 0,
          repeat: "each-turn",
          resource: "hp",
          operation: "lose",
          amount: { type: "literal", value: -1 },
        },
      ],
    };

    expect(validateFightState(invalidState)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "invalid-active-effect" })]),
    );
  });

  it("rejects malformed durable action restrictions", () => {
    const createdFight = createFight(input, createDependencies());
    if (!createdFight.ok || createdFight.value.state.status !== "active") {
      throw new Error("Expected an active initial fight state.");
    }
    const invalidState: FightState = {
      ...createdFight.value.state,
      activeEffects: [
        {
          id: "active-effect:invalid-action-restriction" as never,
          type: "action-restriction",
          sourceCombatantId: firstCombatantId,
          targetCombatantId: secondCombatantId,
          sourceDefinitionId: "move-aoyosumu-serenity-wave",
          sourceEffectIndex: 0,
          blockedCategories: ["basic-attack", "basic-attack"],
          availableFromTurn: 0,
          remainingTurns: 0,
        },
      ],
    };

    expect(validateFightState(invalidState)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "invalid-active-effect" })]),
    );
  });

  it("keeps pending choices, counter phase, and fight completion structurally consistent", () => {
    const createdFight = createFight(input, createDependencies());
    if (!createdFight.ok) throw new Error("Expected initial fight creation to succeed.");
    if (createdFight.value.state.status !== "active") {
      throw new Error("Expected an active initial fight state.");
    }
    const initialState = createdFight.value.state;

    const counterFrame = {
      id: resolutionFrameIdSchema.parse("resolution-frame:counter"),
      type: "attack" as const,
      decisionId: combatDecisionIdSchema.parse("decision:counter"),
      attackerId: firstCombatantId,
      targetCombatantId: secondCombatantId,
      returnPhase: "action" as const,
      stage: "awaiting-counter" as const,
    };
    const invalidPendingDecisionState: FightState = {
      ...initialState,
      pendingDecision: {
        id: pendingDecisionIdSchema.parse("pending-decision:invalid-option"),
        stateVersion: 0,
        combatantId: firstCombatantId,
        type: "select-move",
        options: [
          {
            id: "unowned-move",
            type: "select-move",
            moveId: "move-afterlife-give-me-energy",
          },
        ],
      },
    };
    const counterWithoutFrame: FightState = {
      ...initialState,
      phase: "counter",
    };
    const counterFrameOutsideCounterPhase: FightState = {
      ...initialState,
      resolutionFrames: [counterFrame],
    };
    const defenseWithoutFrame: FightState = {
      ...initialState,
      pendingDecision: {
        id: pendingDecisionIdSchema.parse("pending-decision:defense-without-frame"),
        stateVersion: 0,
        combatantId: secondCombatantId,
        type: "defense-response",
        options: [{ id: "roll", type: "roll-defense" }],
      },
    };
    const completedWithFrame = {
      ...createdFight.value.state,
      status: "completed",
      completion: { type: "cancelled" as const },
      resolutionFrames: [counterFrame],
    } as FightState;

    expect(validateFightState(invalidPendingDecisionState)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "invalid-pending-decision" })]),
    );
    expect(validateFightState(counterWithoutFrame)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "invalid-resolution-frame" })]),
    );
    expect(validateFightState(counterFrameOutsideCounterPhase)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "invalid-resolution-frame" })]),
    );
    expect(validateFightState(defenseWithoutFrame)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "invalid-resolution-frame" })]),
    );
    expect(validateFightState(completedWithFrame)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "invalid-completion" })]),
    );
  });
});
