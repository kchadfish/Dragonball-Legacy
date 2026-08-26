import { GLOBAL_RULES } from "@dragonball-resurgence/game-config";

import {
  resolveContestedAttackRolls,
  type AttackDieRoll,
  type AttackRollDefinition,
  type ContestedAttackNaturalRoll,
  type ResolutionThresholdRule,
} from "./attack-rolls.js";
import { qualifiesForCounter, qualifiesForCritical } from "./combat-mechanics.js";

import type { CombatantState } from "./contracts.js";
import type { RandomSource } from "./dependencies.js";

export interface MoveAttackDefinition {
  readonly attack: AttackRollDefinition;
  readonly attackResultModifier?: number;
  readonly criticalThresholds?: readonly {
    readonly threshold: number;
    readonly basis: "natural-result" | "final-result";
  }[];
  readonly defenseSides?: number;
  readonly defenseResultModifier?: number;
  readonly rollSelection?: {
    readonly roll: "attack" | "defense";
    readonly diceCount: number;
    readonly selection: "highest" | "lowest";
  };
  readonly naturalDefenseStopPreventionAtMost?: number;
  readonly preventCritical?: boolean;
  readonly preventCounter?: boolean;
  /** Previously rolled dice for resuming a post-roll reaction deterministically. */
  readonly naturalRolls?: readonly ContestedAttackNaturalRoll[];
  /** Declarative after-defense-roll results to use when replaying persisted dice. */
  readonly resultOverrides?: readonly ("stopped" | "successful" | undefined)[];
  readonly numericResultOverrides?: readonly (
    { readonly attack?: number; readonly defense?: number } | undefined
  )[];
  readonly beforeDieResultModifier?: (
    index: number,
    priorRolls: readonly AttackDieRoll[],
  ) => { readonly attack?: number; readonly defense?: number } | undefined;
  /** Deterministic hook for effects that observe each fully resolved die. */
  readonly afterDieResolved?: (index: number, rolls: readonly AttackDieRoll[]) => void;
  readonly resolutionThresholds?: readonly ResolutionThresholdRule[];
  readonly baseDamage: number;
  /** A converted `damagePerHit` move deals its listed damage for every successful die. */
  readonly damagePerHit?: boolean;
}

export interface MoveAttackResolution {
  readonly counter: boolean;
  readonly critical: boolean;
  readonly damage: number;
  readonly rolls: readonly AttackDieRoll[];
  readonly successfulHitCount: number;
  readonly totalDice: number;
}

const damageForSuccessfulDice = (
  baseDamage: number,
  dice: number,
  successfulHitCount: number,
  critical: boolean,
  damagePerHit: boolean,
) =>
  Math.round(
    (damagePerHit ? baseDamage : baseDamage / dice) * successfulHitCount * (critical ? 2 : 1),
  );

/** Resolves a converted attack before move effects are applied. */
export const resolveMoveAttack = (
  attacker: CombatantState,
  defender: CombatantState,
  definition: MoveAttackDefinition,
  random: RandomSource,
  blockedDice = 0,
): MoveAttackResolution => {
  if (definition.criticalThresholds?.some(({ threshold }) => !Number.isFinite(threshold))) {
    throw new RangeError("Critical thresholds must be finite numbers.");
  }
  const rolls = resolveContestedAttackRolls(
    {
      attack: definition.attack,
      blockedDice,
      attackerDexterityBonus:
        attacker.stats.dexterityBonus + (definition.attackResultModifier ?? 0),
      defenderDexterityBonus: defender.stats.dexterityBonus,
      defenseSides: definition.defenseSides,
      defenderResultModifier: definition.defenseResultModifier,
      rollSelection: definition.rollSelection,
      naturalDefenseStopPreventionAtMost: definition.naturalDefenseStopPreventionAtMost,
      naturalRolls: definition.naturalRolls,
      resultOverrides: definition.resultOverrides,
      numericResultOverrides: definition.numericResultOverrides,
      beforeDieResultModifier: definition.beforeDieResultModifier,
      afterDieResolved: definition.afterDieResolved,
      resolutionThresholds: definition.resolutionThresholds,
    },
    random,
  );
  const successful = rolls.filter((roll) => roll.outcome === "successful");
  const firstRoll = rolls.at(0);
  const critical =
    definition.preventCritical !== true &&
    rolls.length === 1 &&
    firstRoll !== undefined &&
    (qualifiesForCritical({
      attackerDexterity: attacker.stats.dexterity,
      defenderDexterity: defender.stats.dexterity,
      diceCount: definition.attack.dice,
      diceSides: definition.attack.sides,
      naturalAttackResult: firstRoll.attackNaturalResult,
      naturalDefenseResult: firstRoll.defenseNaturalResult ?? 0,
      outcome: firstRoll.outcome === "successful" ? "successful" : "stopped",
    }) ||
      (definition.criticalThresholds ?? []).some(({ basis, threshold }) =>
        basis === "natural-result"
          ? firstRoll.attackNaturalResult >= threshold
          : firstRoll.attackResult >= threshold,
      ));
  const counter =
    definition.preventCounter !== true &&
    successful.length === 0 &&
    rolls.some(
      (roll) =>
        roll.defenseNaturalResult !== undefined &&
        qualifiesForCounter({
          attackerDexterity: attacker.stats.dexterity,
          defenderDexterity: defender.stats.dexterity,
          diceCount: definition.attack.dice,
          diceSides: definition.attack.sides,
          naturalAttackResult: roll.attackNaturalResult,
          naturalDefenseResult: roll.defenseNaturalResult,
          outcome: "stopped",
        }),
    );

  return {
    rolls,
    totalDice: definition.attack.dice,
    successfulHitCount: successful.length,
    critical,
    counter,
    damage: damageForSuccessfulDice(
      definition.baseDamage,
      definition.attack.dice,
      successful.length,
      critical,
      definition.damagePerHit === true,
    ),
  };
};

export const defaultMoveAttackRoll = (): AttackRollDefinition => ({
  dice: 1,
  sides: GLOBAL_RULES.combat.standardDieSides,
});
