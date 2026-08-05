export interface RulesVersion {
  readonly value: string;
  readonly sourcePath: string;
}

/**
 * Stable values transcribed from the canonical rules reference. Narrative and
 * conditional rules remain source-traceable sections in the game-data package.
 */
export const RULES_VERSION: RulesVersion = {
  value: "legacy-reference-2026-08",
  sourcePath: "reference/rules.md",
} as const;

export const GLOBAL_RULES = {
  sourcePath: "reference/rules.md",
  weeklyActions: {
    days: 7,
    minimumWordsPerDay: 100,
    storyPostBonus: {
      requiredPosts: 7,
      zenni: 200,
      baseExperienceMultiplier: 0.5,
    },
    maximumExperienceSparsOrBattles: 4,
  },
  movesetSlots: {
    mastery: 1,
    skill: 4,
    advancedAttack: 5,
    signatureTechnique: 2,
    block: 2,
  },
  inventory: {
    startingSlots: 4,
    equippedSlots: {
      weapon: 1,
      upperBody: 1,
      lowerBody: 1,
      accessory: 2,
    },
  },
  marketplace: {
    resaleValuePercent: 25,
    maximumTradesPerItemPerWeek: 1,
  },
  modifierResolution: {
    percentage: {
      stacking: "additive",
      application: "multiply-base-once",
      rounding: "nearest-integer",
    },
  },
  characterCreation: {
    startingZenni: 200,
  },
  statPoints: {
    perLevel: 4,
    hitPointsPerPoint: 50,
    powerPerPoint: 20,
    dexterityPerPoint: 1,
    minimumAllocationPercentPerStat: 20,
  },
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
    maximumStatPercentDamageModification: 40,
    maximumAttackDamagePercentModification: 50,
    blockMinimumKiCost: 1,
    /**
     * Engineering safeguards are explicit implementation limits, not rules
     * transcribed from the canonical reference. They protect deterministic
     * resolution from an unbounded reaction loop until a source-backed rule
     * replaces them.
     */
    engineeringSafeguards: {
      maximumConsecutiveCounterAttacks: 3,
    },
    battleRecoveryPercentOfMaximumHitPointsPerRoleplayDay: 20,
    break: {
      damagePenaltyPercentPerStack: 10,
      maximumStacks: 4,
      durationDays: 7,
    },
    sever: { damagePenaltyPercentPerLimb: 25 },
  },
  transformations: {
    rollThresholdHitPointsPercent: 50,
    revertRollMaximum: 5,
    turnsBeforeRetransformation: 5,
    transformationDieSidesGainedPerCombat: 10,
    maximumTransformationDieSides: 100,
  },
} as const;
