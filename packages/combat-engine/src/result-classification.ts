import { CANONICAL_COMBAT_MECHANICS_VIEW, type CombatRules } from "./mechanics-view.js";

export type CombatResultOutcome = "blocked" | "stopped" | "successful";

export type CombatResultKind = "blocked" | "stopped" | "successful" | "critical" | "counter";

export interface ResultClassificationInput {
  /** The result that first triggered downstream result effects. */
  readonly initiallyTriggeredResult: CombatResultOutcome;
  /** The result after set/replacement, prevention, and result modifiers. */
  readonly finalResult: CombatResultOutcome;
  readonly diceCount: number;
  readonly diceSides: number;
  readonly naturalAttackResult?: number;
  readonly naturalDefenseResult?: number;
  readonly attackerDexterity: number;
  readonly defenderDexterity: number;
  readonly criticalPrevented?: boolean;
  readonly counterPrevented?: boolean;
  readonly rules?: CombatRules;
}

export interface ResultClassification {
  readonly initiallyTriggeredResult: CombatResultOutcome;
  readonly finalResult: CombatResultOutcome;
  readonly kind: CombatResultKind;
  readonly critical: boolean;
  readonly counter: boolean;
}

const criticalEligible = (input: ResultClassificationInput) =>
  input.finalResult === "successful" &&
  input.criticalPrevented !== true &&
  input.diceCount <=
    (input.rules ?? CANONICAL_COMBAT_MECHANICS_VIEW.rules).combat.criticalHit
      .maximumEligibleAttackDice &&
  input.naturalAttackResult !== undefined &&
  input.naturalAttackResult >=
    input.diceSides - (input.attackerDexterity > input.defenderDexterity ? 1 : 0);

const counterEligible = (input: ResultClassificationInput) =>
  input.finalResult === "stopped" &&
  input.counterPrevented !== true &&
  input.naturalDefenseResult !== undefined &&
  input.naturalDefenseResult >=
    (input.rules ?? CANONICAL_COMBAT_MECHANICS_VIEW.rules).combat.standardDieSides -
      (input.defenderDexterity > input.attackerDexterity
        ? (input.rules ?? CANONICAL_COMBAT_MECHANICS_VIEW.rules).combat.counter
            .higherDexterityNaturalRollReduction
        : 0);

/** Classify only after final roll/result calculation; natural facts are retained. */
export const classifyCombatResult = (input: ResultClassificationInput): ResultClassification => {
  const critical = criticalEligible(input);
  const counter = counterEligible(input);
  let kind: CombatResultKind = input.finalResult;
  if (input.finalResult === "blocked") {
    kind = "blocked";
  } else if (critical) {
    kind = "critical";
  } else if (counter) {
    kind = "counter";
  }
  return {
    initiallyTriggeredResult: input.initiallyTriggeredResult,
    finalResult: input.finalResult,
    kind,
    critical,
    counter,
  };
};
