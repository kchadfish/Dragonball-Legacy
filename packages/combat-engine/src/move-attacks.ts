import { GLOBAL_RULES } from "@dragonball-resurgence/game-config";

import {
  resolveContestedAttackRolls,
  type AttackDieRoll,
  type AttackRollDefinition,
  type ContestedAttackNaturalRoll,
  type ResolutionThresholdRule,
} from "./attack-rolls.js";
import { qualifiesForCounter, qualifiesForCritical } from "./combat-mechanics.js";
import {
  calculateDamage,
  publishCalculationTrace,
  type CalculationTraceSink,
} from "./calculation-pipeline.js";
import { classifyCombatResult } from "./result-classification.js";
import {
  executeScheduledCombatResult,
  scheduledCombatResultOperation,
} from "./fight-flow-scheduler.js";

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
  readonly diagnosticTraceSink?: CalculationTraceSink;
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
  diagnosticTraceSink?: CalculationTraceSink,
) =>
  publishCalculationTrace(
    calculateDamage({
      baseDamage: (damagePerHit ? baseDamage : baseDamage / dice) * successfulHitCount,
      modifiers: critical
        ? [{ operation: "multiply", amount: 2, provenance: "damage:critical-multiplier" }]
        : [],
      retainTrace: diagnosticTraceSink !== undefined,
    }),
    diagnosticTraceSink,
  );

const finalOutcomeForRolls = (
  rolls: readonly AttackDieRoll[],
  successfulHitCount: number,
): "blocked" | "stopped" | "successful" => {
  if (successfulHitCount > 0) return "successful";
  if (rolls.some((roll) => roll.outcome === "stopped")) return "stopped";
  return "blocked";
};

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
      diagnosticTraceSink: definition.diagnosticTraceSink,
    },
    random,
  );
  const initiallyTriggeredResult = finalOutcomeForRolls(
    rolls,
    rolls.filter((roll) => roll.outcome === "successful").length,
  );
  const resultOperation = scheduledCombatResultOperation({
    sourceId: "move-attack",
    result: initiallyTriggeredResult === "blocked" ? "stopped" : initiallyTriggeredResult,
  });
  const finalResult = executeScheduledCombatResult(resultOperation.operation);
  const successful = rolls.filter((roll) => roll.outcome === "successful");
  const firstRoll = rolls.at(0);
  const finalOutcome = finalResult;
  const classification =
    firstRoll === undefined
      ? undefined
      : classifyCombatResult({
          initiallyTriggeredResult,
          finalResult: finalOutcome,
          diceCount: definition.attack.dice,
          diceSides: definition.attack.sides,
          naturalAttackResult: firstRoll.attackNaturalResult,
          naturalDefenseResult: firstRoll.defenseNaturalResult,
          attackerDexterity: attacker.stats.dexterity,
          defenderDexterity: defender.stats.dexterity,
          criticalPrevented: definition.preventCritical,
          counterPrevented: definition.preventCounter,
        });
  const criticalThresholdMatch =
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
  const counterThresholdMatch =
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
  const critical = (classification?.critical ?? false) || criticalThresholdMatch;
  const counter = rolls.length === 1 ? (classification?.counter ?? false) : counterThresholdMatch;

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
      definition.diagnosticTraceSink,
    ),
  };
};

export const defaultMoveAttackRoll = (): AttackRollDefinition => ({
  dice: 1,
  sides: GLOBAL_RULES.combat.standardDieSides,
});
