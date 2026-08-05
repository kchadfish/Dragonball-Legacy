import { describe, expect, it } from "vitest";

import { GLOBAL_RULES, RULES_VERSION } from "./index.js";

describe("global rules", () => {
  it("exposes stable universal values from the canonical rules source", () => {
    expect(RULES_VERSION).toEqual({
      value: "legacy-reference-2026-08",
      sourcePath: "reference/rules.md",
    });
    expect(GLOBAL_RULES).toMatchObject({
      sourcePath: "reference/rules.md",
      weeklyActions: {
        days: 7,
        minimumWordsPerDay: 100,
        maximumExperienceSparsOrBattles: 4,
      },
      movesetSlots: {
        mastery: 1,
        skill: 4,
        advancedAttack: 5,
        signatureTechnique: 2,
        block: 2,
      },
      inventory: { startingSlots: 4 },
      marketplace: { resaleValuePercent: 25, maximumTradesPerItemPerWeek: 1 },
      modifierResolution: {
        percentage: {
          stacking: "additive",
          application: "multiply-base-once",
          rounding: "nearest-integer",
        },
      },
      characterCreation: { startingZenni: 200 },
      combat: {
        maximumKi: 10,
        startingKi: 5,
        powerUpKiGain: 3,
        standardDieSides: 30,
        basicAttackPowerDamagePercent: 10,
        minimumDexterityBonus: -4,
        maximumDexterityBonus: 5,
        phases: ["upkeep", "action", "counter", "end"],
        initiative: {
          ordering: "highest-dexterity-first",
          tiedDexterityTieBreakerDieSides: 100,
        },
        criticalHit: {
          baseDamageMultiplier: 2,
          maximumEligibleAttackDice: 1,
          higherDexterityNaturalRollReduction: 1,
        },
        counter: {
          higherDexterityNaturalRollReduction: 1,
          requiresStoppedAttack: true,
        },
        signatureTechniqueMinimumTurn: 10,
        advancedAttackModificationLimit: 10,
        signatureTechniqueModificationLimit: 5,
        engineeringSafeguards: { maximumConsecutiveCounterAttacks: 3 },
      },
    });
  });

  it("keeps engineering safeguards distinct from transcribed combat rules", () => {
    expect(GLOBAL_RULES.combat.engineeringSafeguards).toEqual({
      maximumConsecutiveCounterAttacks: 3,
    });
    expect(GLOBAL_RULES.combat).not.toHaveProperty("counterChainLimit");
  });
});
