import { isUseAvailable } from "./availability.js";
import {
  calculateCost,
  calculateDamage,
  publishCalculationTrace,
  type CalculationTraceSink,
} from "./calculation-pipeline.js";
import { CANONICAL_COMBAT_MECHANICS_VIEW, type CombatRules } from "./mechanics-view.js";

export interface AttackRollQualificationInput {
  readonly attackerDexterity: number;
  readonly defenderDexterity: number;
  readonly diceCount: number;
  readonly diceSides: number;
  readonly naturalAttackResult: number;
  readonly naturalDefenseResult: number;
  readonly outcome: "successful" | "stopped";
  readonly rules?: CombatRules;
}

export const qualifiesForCritical = ({
  attackerDexterity,
  defenderDexterity,
  diceCount,
  diceSides,
  naturalAttackResult,
  rules = CANONICAL_COMBAT_MECHANICS_VIEW.rules,
}: AttackRollQualificationInput) =>
  diceCount <= rules.combat.criticalHit.maximumEligibleAttackDice &&
  naturalAttackResult >= diceSides - (attackerDexterity > defenderDexterity ? 1 : 0);

export const qualifiesForCounter = ({
  attackerDexterity,
  defenderDexterity,
  naturalDefenseResult,
  outcome,
  rules = CANONICAL_COMBAT_MECHANICS_VIEW.rules,
}: AttackRollQualificationInput) =>
  outcome === "stopped" &&
  naturalDefenseResult >=
    rules.combat.standardDieSides -
      (defenderDexterity > attackerDexterity
        ? rules.combat.counter.higherDexterityNaturalRollReduction
        : 0);

export const calculateAttackDamage = (
  baseDamage: number,
  critical: boolean,
  diagnosticTraceSink?: CalculationTraceSink,
  rules: CombatRules = CANONICAL_COMBAT_MECHANICS_VIEW.rules,
) =>
  publishCalculationTrace(
    calculateDamage({
      baseDamage,
      modifiers:
        critical === false
          ? []
          : [
              {
                operation: "multiply",
                amount: rules.combat.criticalHit.baseDamageMultiplier,
                provenance: "combat:critical-hit",
              },
            ],
      retainTrace: diagnosticTraceSink !== undefined,
    }),
    diagnosticTraceSink,
  );

export const calculateKiCost = (
  baseCost: number,
  modifiers: readonly number[],
  diagnosticTraceSink?: CalculationTraceSink,
) =>
  publishCalculationTrace(
    calculateCost({
      baseCost,
      operations: modifiers.map((amount, index) => ({
        operation: "add" as const,
        amount,
        provenance: `combat:cost-modifier:${index}`,
      })),
      retainTrace: diagnosticTraceSink !== undefined,
    }),
    diagnosticTraceSink,
  );

export const calculateBlockKiCost = (
  opponentBaseCost: number,
  adjustment: number,
  diagnosticTraceSink?: CalculationTraceSink,
  rules: CombatRules = CANONICAL_COMBAT_MECHANICS_VIEW.rules,
) =>
  publishCalculationTrace(
    calculateCost({
      baseCost: opponentBaseCost,
      operations: [
        { operation: "add", amount: adjustment, provenance: "combat:block-cost-adjustment" },
      ],
      bounds: [
        {
          type: "minimum",
          value: rules.combat.blockMinimumKiCost,
          provenance: "combat:block-minimum-ki-cost",
        },
      ],
      retainTrace: diagnosticTraceSink !== undefined,
    }),
    diagnosticTraceSink,
  );

export const resolveMultiDieBlock = (diceCount: number) => {
  if (!Number.isInteger(diceCount) || diceCount < 1) {
    throw new RangeError("A multi-die attack must have at least one die.");
  }
  const blockedDice = Math.ceil(diceCount / 2);
  return { blockedDice, defendingDice: diceCount - blockedDice };
};

export const resolveMultiDieOutcomes = (
  attackResults: readonly number[],
  defenseResults: readonly number[],
) => {
  if (attackResults.length !== defenseResults.length) {
    throw new RangeError("Attack and defense result counts must match.");
  }
  return attackResults.map((attackResult, index) => attackResult >= defenseResults[index]);
};

export const isRestrictedUseAvailable = (used: number, limit: number | undefined) =>
  isUseAvailable(used, limit);

export const isSignatureTurnAvailable = (
  turnNumber: number,
  rules: CombatRules = CANONICAL_COMBAT_MECHANICS_VIEW.rules,
) => turnNumber >= rules.combat.signatureTechniqueMinimumTurn;

export const canContinueCounterChain = (
  counterAttackCount: number,
  rules: CombatRules = CANONICAL_COMBAT_MECHANICS_VIEW.rules,
) => counterAttackCount < rules.combat.engineeringSafeguards.maximumConsecutiveCounterAttacks;
