import { GLOBAL_RULES } from "@dragonball-resurgence/game-config";

import type { RandomSource } from "./dependencies.js";
import { publishCalculationTrace, type CalculationTraceSink } from "./calculation-pipeline.js";
import { calculateFinalRollResult } from "./roll-calculations.js";

export interface AttackRollDefinition {
  readonly dice: number;
  readonly sides: number;
}

export interface ContestedAttackRollInput {
  readonly attackerDexterityBonus: number;
  readonly attack: AttackRollDefinition;
  /** Number of leading attack dice stopped by a declared Block. */
  readonly blockedDice?: number;
  readonly defenderDexterityBonus: number;
  /** Dice sides for each unblocked defense roll; defaults to the standard die. */
  readonly defenseSides?: number;
  /** A declared modifier to the defender's roll result, applied before comparison. */
  readonly defenderResultModifier?: number;
  /** Selects the best or worst result from a fixed number of candidate dice. */
  readonly rollSelection?: {
    readonly roll: "attack" | "defense";
    readonly diceCount: number;
    readonly selection: "highest" | "lowest";
  };
  /** Selected Destruction Mastery attacks cannot be stopped by natural defense rolls up to this value. */
  readonly naturalDefenseStopPreventionAtMost?: number;
  /** Replays a previously rolled contest while applying a later reaction modifier. */
  readonly naturalRolls?: readonly ContestedAttackNaturalRoll[];
  /** Per-die results declared by a validated after-defense-roll effect. */
  readonly resultOverrides?: readonly ("stopped" | "successful" | undefined)[];
  /** Persisted numeric result substitutions, applied after natural dice and stat modifiers. */
  readonly numericResultOverrides?: readonly (
    { readonly attack?: number; readonly defense?: number } | undefined
  )[];
  /** Deterministic modifier evaluated immediately before each die resolves. */
  readonly beforeDieResultModifier?: (
    index: number,
    priorRolls: readonly AttackDieRoll[],
  ) => { readonly attack?: number; readonly defense?: number } | undefined;
  /** Deterministic hook for effects that observe each fully resolved die. */
  readonly afterDieResolved?: (index: number, rolls: readonly AttackDieRoll[]) => void;
  /** Declarative constraints on whether a die may count as successful or stopped. */
  readonly resolutionThresholds?: readonly ResolutionThresholdRule[];
  readonly diagnosticTraceSink?: CalculationTraceSink;
}

export interface ResolutionThresholdRule {
  readonly outcome: "successful" | "stopped";
  readonly roll: "attack" | "defense";
  readonly comparison: "at-least" | "at-most";
  readonly value: number;
  readonly relativeTo?: "attack-roll" | "defense-roll";
  readonly relativeOperation?: "add" | "multiply";
  readonly resultScope: "current-attack" | "matching-die";
}

export interface AttackDieRoll {
  readonly attackNaturalResult: number;
  readonly attackResult: number;
  readonly defenseNaturalResult?: number;
  readonly defenseResult?: number;
  readonly outcome: "blocked" | "stopped" | "successful";
  /** Candidate facts retained when advantage/disadvantage selected among dice. */
  readonly attackCandidates?: readonly RollCandidateFact[];
  readonly selectedAttackCandidateIndex?: number;
  readonly defenseCandidates?: readonly RollCandidateFact[];
  readonly selectedDefenseCandidateIndex?: number;
}

export interface RollCandidateFact {
  readonly candidateIndex: number;
  readonly naturalValue: number;
  readonly finalResult: number;
}

/** Natural die values retained by a suspended reaction before its final resolution. */
export interface ContestedAttackNaturalRoll {
  readonly attack: number;
  readonly defense?: number;
}

const resolvedRollResult = (
  naturalValue: number,
  statContribution: number,
  numericOverride: number | undefined,
  dynamicModifier: number,
  diagnosticTraceSink?: CalculationTraceSink,
) => {
  const result = calculateFinalRollResult({
    candidateNaturalValue: naturalValue,
    statContribution: statContribution + dynamicModifier,
    enforceStructuralMinimum: false,
    operations: [
      ...(numericOverride === undefined
        ? []
        : [
            { operation: "set" as const, amount: numericOverride, provenance: "roll:substitution" },
          ]),
    ],
    retainTrace: diagnosticTraceSink !== undefined,
  });
  return publishCalculationTrace(result, diagnosticTraceSink);
};

const assertAttackDefinition = ({ dice, sides }: AttackRollDefinition) => {
  if (!Number.isInteger(dice) || dice < 1 || !Number.isInteger(sides) || sides < 1) {
    throw new RangeError("Attack rolls require positive integer dice and sides.");
  }
};

const assertNaturalRolls = (
  ...[attack, defenseSides, blockedDice, naturalRolls, resultOverrides, numericResultOverrides]: [
    attack: AttackRollDefinition,
    defenseSides: number,
    blockedDice: number,
    naturalRolls: readonly ContestedAttackNaturalRoll[] | undefined,
    resultOverrides: readonly ("stopped" | "successful" | undefined)[] | undefined,
    numericResultOverrides:
      readonly ({ readonly attack?: number; readonly defense?: number } | undefined)[] | undefined,
  ]
) => {
  if (naturalRolls !== undefined && naturalRolls.length !== attack.dice) {
    throw new RangeError("Persisted attack rolls must contain one value per attack die.");
  }
  if (resultOverrides !== undefined && resultOverrides.length !== attack.dice) {
    throw new RangeError("Persisted result overrides must contain one entry per attack die.");
  }
  if (numericResultOverrides !== undefined && numericResultOverrides.length !== attack.dice) {
    throw new RangeError(
      "Persisted numeric result overrides must contain one entry per attack die.",
    );
  }
  assertNumericResultOverrides(numericResultOverrides);
  assertPersistedDieValues(attack, defenseSides, blockedDice, naturalRolls);
};

const assertResolutionThresholdShape = (threshold: ResolutionThresholdRule) => {
  if (threshold.outcome !== "successful" && threshold.outcome !== "stopped")
    throw new RangeError("Resolution thresholds must contain a valid outcome.");
  if (threshold.roll !== "attack" && threshold.roll !== "defense")
    throw new RangeError("Resolution thresholds must contain a valid roll.");
  if (threshold.comparison !== "at-least" && threshold.comparison !== "at-most")
    throw new RangeError("Resolution thresholds must contain a valid comparison.");
  if (!Number.isFinite(threshold.value))
    throw new RangeError("Resolution thresholds must contain a finite value.");
  if (threshold.resultScope !== "current-attack" && threshold.resultScope !== "matching-die")
    throw new RangeError("Resolution thresholds must contain a valid result scope.");
};

const assertRelativeResolutionThreshold = (threshold: ResolutionThresholdRule) => {
  if (threshold.relativeTo === undefined) {
    if (threshold.relativeOperation !== undefined)
      throw new RangeError("A relative threshold operation requires a referenced roll.");
    return;
  }
  if (threshold.relativeOperation === undefined)
    throw new RangeError("A relative threshold requires an explicit operation.");
  if (threshold.relativeTo === "attack-roll" && threshold.roll === "attack")
    throw new RangeError("A relative threshold must compare opposite roll results.");
  if (threshold.relativeTo === "defense-roll" && threshold.roll === "defense")
    throw new RangeError("A relative threshold must compare opposite roll results.");
};

const assertResolutionThresholds = (thresholds: readonly ResolutionThresholdRule[] | undefined) => {
  for (const threshold of thresholds ?? []) {
    assertResolutionThresholdShape(threshold);
    assertRelativeResolutionThreshold(threshold);
  }
};

const assertRollSelection = (
  selection: ContestedAttackRollInput["rollSelection"],
  attack: AttackRollDefinition,
) => {
  if (selection === undefined) return;
  if (selection.roll !== "attack" && selection.roll !== "defense")
    throw new RangeError("Roll selection must name an attack or defense roll.");
  if (!Number.isInteger(selection.diceCount) || selection.diceCount < 2)
    throw new RangeError("Roll selection requires at least two candidate dice.");
  if (selection.selection !== "highest" && selection.selection !== "lowest")
    throw new RangeError("Roll selection must choose the highest or lowest result.");
  if (selection.roll === "attack" && selection.diceCount < 2)
    throw new RangeError("Attack roll selection requires multiple candidate dice.");
  if (attack.dice < 1) throw new RangeError("Roll selection requires a valid attack.");
};

const assertNumericResultOverrides = (
  numericResultOverrides:
    readonly ({ readonly attack?: number; readonly defense?: number } | undefined)[] | undefined,
) => {
  for (const override of numericResultOverrides ?? []) {
    const attackIsInvalid = override?.attack !== undefined && !Number.isFinite(override.attack);
    const defenseIsInvalid = override?.defense !== undefined && !Number.isFinite(override.defense);
    if (attackIsInvalid || defenseIsInvalid) {
      throw new RangeError("Persisted numeric result overrides must be finite numbers.");
    }
  }
};

const assertPersistedDieValues = (
  attack: AttackRollDefinition,
  defenseSides: number,
  blockedDice: number,
  naturalRolls: readonly ContestedAttackNaturalRoll[] | undefined,
) => {
  for (const [index, roll] of naturalRolls?.entries() ?? []) {
    if (!Number.isInteger(roll.attack) || roll.attack < 1 || roll.attack > attack.sides) {
      throw new RangeError("Persisted attack rolls must be within their attack die sides.");
    }
    const requiresDefense = index >= blockedDice;
    if (
      requiresDefense &&
      (!Number.isInteger(roll.defense) ||
        roll.defense === undefined ||
        roll.defense < 1 ||
        roll.defense > defenseSides)
    ) {
      throw new RangeError("Each unblocked persisted attack roll requires a valid defense die.");
    }
    if (!requiresDefense && roll.defense !== undefined) {
      throw new RangeError("Blocked persisted attack rolls must not retain a defense die.");
    }
  }
};

const resolvedUnblockedDie = (
  ...[
    attackNaturalResult,
    attackResult,
    persisted,
    index,
    input,
    random,
    dynamicResultModifier,
    candidateFacts,
  ]: [
    attackNaturalResult: number,
    attackResult: number,
    persisted: ContestedAttackNaturalRoll | undefined,
    index: number,
    input: ContestedAttackRollInput,
    random: RandomSource,
    dynamicResultModifier: { readonly attack?: number; readonly defense?: number } | undefined,
    candidateFacts?: Pick<
      AttackDieRoll,
      | "attackCandidates"
      | "selectedAttackCandidateIndex"
      | "defenseCandidates"
      | "selectedDefenseCandidateIndex"
    >,
  ]
): AttackDieRoll => {
  const defenseNaturalResult =
    persisted?.defense ??
    random.integer(1, input.defenseSides ?? GLOBAL_RULES.combat.standardDieSides);
  const defenseResult = resolvedRollResult(
    defenseNaturalResult,
    input.defenderDexterityBonus,
    input.numericResultOverrides?.[index]?.defense,
    (input.defenderResultModifier ?? 0) + (dynamicResultModifier?.defense ?? 0),
    input.diagnosticTraceSink,
  );
  const defaultOutcome =
    attackResult >= defenseResult ? ("successful" as const) : ("stopped" as const);
  const protectedOutcome =
    defaultOutcome === "stopped" &&
    input.naturalDefenseStopPreventionAtMost !== undefined &&
    defenseNaturalResult <= input.naturalDefenseStopPreventionAtMost
      ? ("successful" as const)
      : defaultOutcome;
  const outcome = resolutionThresholdOutcome(
    protectedOutcome,
    attackResult,
    defenseResult,
    input.resolutionThresholds,
  );
  return {
    attackNaturalResult,
    attackResult,
    defenseNaturalResult,
    defenseResult,
    outcome: input.resultOverrides?.[index] ?? outcome,
    ...candidateFacts,
  };
};

const resolutionThresholdOutcome = (
  defaultOutcome: "successful" | "stopped",
  attackResult: number,
  defenseResult: number,
  thresholds: readonly ResolutionThresholdRule[] | undefined,
) => {
  if (thresholds === undefined || thresholds.length === 0) return defaultOutcome;
  const successfulThresholds = thresholds.filter((threshold) => threshold.outcome === "successful");
  const stoppedThresholds = thresholds.filter((threshold) => threshold.outcome === "stopped");
  const thresholdMatches = (threshold: ResolutionThresholdRule) => {
    const result = threshold.roll === "attack" ? attackResult : defenseResult;
    const thresholdValue = resolutionThresholdValue(threshold, attackResult, defenseResult);
    const comparisonMatches =
      threshold.comparison === "at-least" ? result >= thresholdValue : result <= thresholdValue;
    return threshold.outcome === "stopped" && threshold.comparison === "at-most"
      ? !comparisonMatches
      : comparisonMatches;
  };

  if (
    defaultOutcome === "successful" &&
    successfulThresholds.some((threshold) => !thresholdMatches(threshold))
  )
    return "stopped";
  if (
    defaultOutcome === "stopped" &&
    stoppedThresholds.some((threshold) => !thresholdMatches(threshold))
  )
    return "successful";
  return defaultOutcome;
};

const resolutionThresholdValue = (
  threshold: ResolutionThresholdRule,
  attackResult: number,
  defenseResult: number,
) => {
  if (threshold.relativeTo === undefined) return threshold.value;
  const referenceResult = threshold.relativeTo === "attack-roll" ? attackResult : defenseResult;
  if (threshold.relativeOperation === "add") return referenceResult + threshold.value;
  return referenceResult * threshold.value;
};

const resolveContestedAttackDie = (
  input: ContestedAttackRollInput,
  random: RandomSource,
  index: number,
  dynamicResultModifier: { readonly attack?: number; readonly defense?: number } | undefined,
  // eslint-disable-next-line complexity -- The die resolver intentionally keeps persisted-roll, selection, block, and defense branches together.
): AttackDieRoll => {
  const persisted = input.naturalRolls?.[index];
  const selection = input.rollSelection;
  const attackCandidates =
    persisted === undefined && selection?.roll === "attack"
      ? Array.from({ length: selection.diceCount }, () => random.integer(1, input.attack.sides))
      : [persisted?.attack ?? random.integer(1, input.attack.sides)];
  const attackResults = attackCandidates.map((natural) =>
    resolvedRollResult(
      natural,
      input.attackerDexterityBonus,
      input.numericResultOverrides?.[index]?.attack,
      dynamicResultModifier?.attack ?? 0,
      input.diagnosticTraceSink,
    ),
  );
  const selectedAttackIndex =
    selection?.selection === "lowest"
      ? attackResults.reduce(
          (selected, result, candidate) =>
            result < attackResults[selected] ? candidate : selected,
          0,
        )
      : attackResults.reduce(
          (selected, result, candidate) =>
            result > attackResults[selected] ? candidate : selected,
          0,
        );
  const attackNaturalResult = attackCandidates[selectedAttackIndex];
  const attackCandidateFacts =
    selection?.roll === "attack"
      ? {
          attackCandidates: attackCandidates.map((naturalValue, candidateIndex) => ({
            candidateIndex,
            naturalValue,
            finalResult: attackResults[candidateIndex]!,
          })),
          selectedAttackCandidateIndex: selectedAttackIndex,
        }
      : undefined;
  const attackResult = resolvedRollResult(
    attackNaturalResult,
    input.attackerDexterityBonus,
    input.numericResultOverrides?.[index]?.attack,
    dynamicResultModifier?.attack ?? 0,
    input.diagnosticTraceSink,
  );
  if (index < (input.blockedDice ?? 0)) {
    return {
      attackNaturalResult,
      attackResult,
      outcome: "blocked",
      ...attackCandidateFacts,
    };
  }
  if (persisted === undefined && selection?.roll === "defense") {
    const defenseSides = input.defenseSides ?? GLOBAL_RULES.combat.standardDieSides;
    const defenseCandidates = Array.from({ length: selection.diceCount }, () =>
      random.integer(1, defenseSides),
    );
    const defenseResults = defenseCandidates.map((natural) =>
      resolvedRollResult(
        natural,
        input.defenderDexterityBonus,
        input.numericResultOverrides?.[index]?.defense,
        (input.defenderResultModifier ?? 0) + (dynamicResultModifier?.defense ?? 0),
        input.diagnosticTraceSink,
      ),
    );
    const selectedDefenseIndex =
      selection.selection === "lowest"
        ? defenseResults.reduce(
            (selected, result, candidate) =>
              result < defenseResults[selected] ? candidate : selected,
            0,
          )
        : defenseResults.reduce(
            (selected, result, candidate) =>
              result > defenseResults[selected] ? candidate : selected,
            0,
          );
    const defenseCandidateFacts = {
      defenseCandidates: defenseCandidates.map((naturalValue, candidateIndex) => ({
        candidateIndex,
        naturalValue,
        finalResult: defenseResults[candidateIndex]!,
      })),
      selectedDefenseCandidateIndex: selectedDefenseIndex,
    };
    return resolvedUnblockedDie(
      attackNaturalResult,
      attackResult,
      { attack: attackNaturalResult, defense: defenseCandidates[selectedDefenseIndex] },
      index,
      input,
      random,
      dynamicResultModifier,
      { ...attackCandidateFacts, ...defenseCandidateFacts },
    );
  }
  return resolvedUnblockedDie(
    attackNaturalResult,
    attackResult,
    persisted,
    index,
    input,
    random,
    dynamicResultModifier,
    attackCandidateFacts,
  );
};

/**
 * Rolls a source-defined attack one die at a time. A Block stops its leading
 * dice (the rules prescribe ceiling-half for a multi-die attack); the remaining
 * dice receive independent standard defensive rolls.
 */
export const resolveContestedAttackRolls = (
  {
    attack,
    attackerDexterityBonus,
    blockedDice = 0,
    defenderDexterityBonus,
    defenseSides = GLOBAL_RULES.combat.standardDieSides,
    defenderResultModifier = 0,
    naturalRolls,
    resultOverrides,
    numericResultOverrides,
    beforeDieResultModifier,
    afterDieResolved,
    resolutionThresholds,
    rollSelection,
    naturalDefenseStopPreventionAtMost,
    diagnosticTraceSink,
  }: ContestedAttackRollInput,
  random: RandomSource,
): readonly AttackDieRoll[] => {
  assertAttackDefinition(attack);
  if (!Number.isInteger(blockedDice) || blockedDice < 0 || blockedDice > attack.dice) {
    throw new RangeError("Blocked dice must be an integer within the attack's dice count.");
  }
  if (!Number.isInteger(defenseSides) || defenseSides < 1) {
    throw new RangeError("Defense rolls require positive integer sides.");
  }
  assertNaturalRolls(
    attack,
    defenseSides,
    blockedDice,
    naturalRolls,
    resultOverrides,
    numericResultOverrides,
  );
  assertResolutionThresholds(resolutionThresholds);
  assertRollSelection(rollSelection, attack);

  const input: ContestedAttackRollInput = {
    attack,
    attackerDexterityBonus,
    blockedDice,
    defenderDexterityBonus,
    defenseSides,
    defenderResultModifier,
    naturalRolls,
    resultOverrides,
    numericResultOverrides,
    beforeDieResultModifier,
    afterDieResolved,
    resolutionThresholds,
    rollSelection,
    naturalDefenseStopPreventionAtMost,
    diagnosticTraceSink,
  };
  const rolls: AttackDieRoll[] = [];
  for (let index = 0; index < attack.dice; index += 1) {
    rolls.push(
      resolveContestedAttackDie(
        input,
        random,
        index,
        input.beforeDieResultModifier?.(index, rolls),
      ),
    );
    input.afterDieResolved?.(index, rolls);
  }
  return rolls;
};

/** The rules block the first half of a multi-die attack, rounded up. */
export const blockedDiceForDeclaredBlock = (attackDice: number) => {
  if (!Number.isInteger(attackDice) || attackDice < 1) {
    throw new RangeError("An attack must roll at least one die.");
  }
  return Math.ceil(attackDice / 2);
};
