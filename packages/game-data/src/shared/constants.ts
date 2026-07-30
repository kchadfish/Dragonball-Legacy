export const MOVE_CATEGORY = {
  MASTERY: "mastery",
  SKILL: "skill",
  ADVANCED_ATTACK: "advanced-attack",
  SIGNATURE: "signature",
  BLOCK: "block",
} as const;

export const ATTACK_TYPE = {
  PHYSICAL: "physical",
  ENERGY: "energy",
} as const;

export const ATTACK_TAG = {
  PHYSICAL: "physical",
  ENERGY: "energy",
  PUNCH: "punch",
  KICK: "kick",
  BEAM: "beam",
  BLAST: "blast",
  VOLLEY: "volley",
  WEAPON: "weapon",
  HOLD: "hold",
  THROW: "throw",
} as const;

export const EFFECT_TRIGGER = {
  PASSIVE: "passive",
  START_COMBAT: "start-combat",
  UPKEEP_PHASE: "upkeep-phase",
  ACTION_PHASE: "action-phase",
  ON_POWER_UP: "on-power-up",
  ON_RESOURCE_DRAIN: "on-resource-drain",
  ON_RESOURCE_GAIN: "on-resource-gain",
  ON_MOVE_USE: "on-move-use",
  ON_COST_MODIFIED: "on-cost-modified",
  ON_COMBAT_RESULT: "on-combat-result",
  ON_ROLL_RESULT: "on-roll-result",
  ON_RESOURCE_THRESHOLD: "on-resource-threshold",
  ON_ROLL_MODIFIED: "on-roll-modified",
  BEFORE_ATTACK_ROLL: "before-attack-roll",
  BEFORE_DEFENSE_ROLL: "before-defense-roll",
  AFTER_DEFENSE_ROLL: "after-defense-roll",
  ON_SUCCESS: "on-success",
  ON_STOPPED: "on-stopped",
  ON_DAMAGE: "on-damage",
  ON_DEACTIVATED: "on-deactivated",
  TURN_END: "turn-end",
  OUT_OF_COMBAT: "out-of-combat",
} as const;

export const EFFECT_TARGET = {
  SELF: "self",
  OPPONENT: "opponent",
  ALLY: "ally",
  ALLIES: "allies",
  PARTICIPANTS: "participants",
  INTERFERERS: "interferers",
  REMOTE_TARGET: "remote-target",
} as const;

export const STATUS_STACKING = {
  NONE: "none",
  STACKS: "stacks",
  REFRESH_DURATION: "refresh-duration",
} as const;

export const TRANSFORMATION_MASTERY = {
  NOVICE: "novice",
  INTERMEDIATE: "intermediate",
  MASTERED: "mastered",
} as const;

export const ITEM_CATEGORY = {
  EQUIPMENT: "equipment",
  CONSUMABLE: "consumable",
  SHIP: "ship",
  SHIP_ADDON: "ship-addon",
  SPECIAL: "special",
} as const;

export const LOCATION_TYPE = {
  PLANET: "planet",
  REGION: "region",
  SPECIAL: "special",
} as const;
