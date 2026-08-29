import { GLOBAL_RULES } from "@dragonball-resurgence/game-config";
import { isUseAvailable } from "./availability.js";
import {
  calculateCost,
  calculateDamage,
  publishCalculationTrace,
  type CalculationTraceSink,
} from "./calculation-pipeline.js";

export interface AttackRollQualificationInput {
  readonly attackerDexterity: number;
  readonly defenderDexterity: number;
  readonly diceCount: number;
  readonly diceSides: number;
  readonly naturalAttackResult: number;
  readonly naturalDefenseResult: number;
  readonly outcome: "successful" | "stopped";
}

export const qualifiesForCritical = ({
  attackerDexterity,
  defenderDexterity,
  diceCount,
  diceSides,
  naturalAttackResult,
}: AttackRollQualificationInput) =>
  diceCount <= GLOBAL_RULES.combat.criticalHit.maximumEligibleAttackDice &&
  naturalAttackResult >= diceSides - (attackerDexterity > defenderDexterity ? 1 : 0);

export const qualifiesForCounter = ({
  attackerDexterity,
  defenderDexterity,
  naturalDefenseResult,
  outcome,
}: AttackRollQualificationInput) =>
  outcome === "stopped" &&
  naturalDefenseResult >=
    GLOBAL_RULES.combat.standardDieSides -
      (defenderDexterity > attackerDexterity
        ? GLOBAL_RULES.combat.counter.higherDexterityNaturalRollReduction
        : 0);

export const calculateAttackDamage = (
  baseDamage: number,
  critical: boolean,
  diagnosticTraceSink?: CalculationTraceSink,
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
                amount: GLOBAL_RULES.combat.criticalHit.baseDamageMultiplier,
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
          value: GLOBAL_RULES.combat.blockMinimumKiCost,
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

export const isSignatureTurnAvailable = (turnNumber: number) =>
  turnNumber >= GLOBAL_RULES.combat.signatureTechniqueMinimumTurn;

export const canContinueCounterChain = (counterAttackCount: number) =>
  counterAttackCount < GLOBAL_RULES.combat.engineeringSafeguards.maximumConsecutiveCounterAttacks;
