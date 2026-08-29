/** The ordered stages shared by combat value calculations. */
export type CalculationStage =
  "prevention" | "replacement" | "set" | "additive" | "multiplicative" | "rounding" | "bounds";

export type CalculationTraceStatus = "applied" | "skipped";

/** Stable source or compiled-operation identity retained in diagnostics. */
export type CalculationProvenance = `${string}`;

export interface CalculationTraceEntry {
  readonly stage: CalculationStage;
  readonly provenance: CalculationProvenance;
  readonly input: number;
  readonly output: number;
  readonly status: CalculationTraceStatus;
}

export type CalculationTraceSink = (entries: readonly CalculationTraceEntry[]) => void;

/** Publish opt-in diagnostics without coupling calculation callers to transition state. */
export const publishCalculationTrace = <
  T extends {
    readonly trace?: readonly CalculationTraceEntry[];
    readonly value?: number;
    readonly finalResult?: number;
  },
>(
  result: T,
  sink: CalculationTraceSink | undefined,
): number => {
  if (sink !== undefined && result.trace !== undefined) sink(result.trace);
  const value = result.value ?? result.finalResult;
  if (value === undefined) throw new RangeError("Traceable calculation result requires a value.");
  return value;
};

/** Prevents the complete calculation and supplies the value callers require. */
export interface CalculationPrevention {
  readonly preventedValue: number;
  readonly provenance: CalculationProvenance;
}

/** Prevents one modifier while allowing the rest of the calculation to run. */
export interface CalculationModifierPrevention {
  readonly provenance: CalculationProvenance;
}

export type CalculationOperationKind = "set" | "add" | "multiply";

export interface CalculationOperation {
  readonly operation: CalculationOperationKind;
  readonly amount: number;
  readonly provenance: CalculationProvenance;
  /** Compiled/source order within a stage. Array order breaks ties. */
  readonly order?: number;
  /** Additive percentages use this declared base rather than the running value. */
  readonly percentageBase?: number;
  /** A prevented modifier is retained in the trace as skipped. */
  readonly prevented?: boolean;
}

export interface CalculationReplacement {
  readonly value: number;
  readonly provenance: CalculationProvenance;
  readonly order?: number;
  readonly prevented?: boolean;
}

export interface CalculationBound {
  readonly type: "minimum" | "maximum";
  readonly value: number;
  readonly provenance: CalculationProvenance;
  /** Compiled/source order for conflicting bounds. Array order breaks ties. */
  readonly order?: number;
  readonly prevented?: boolean;
}

export interface CalculationRounding {
  readonly type: "integer";
  readonly provenance?: CalculationProvenance;
}

export interface CalculationInput {
  readonly baseValue: number;
  readonly operations?: readonly CalculationOperation[];
  readonly replacements?: readonly CalculationReplacement[];
  readonly bounds?: readonly CalculationBound[];
  readonly prevention?: CalculationPrevention;
  readonly modifierPreventions?: readonly CalculationModifierPrevention[];
  readonly rounding?: CalculationRounding;
  /** Diagnostics are opt-in so normal transitions retain their existing shape. */
  readonly retainTrace?: boolean;
}

export interface CalculationResult {
  readonly value: number;
  readonly trace?: readonly CalculationTraceEntry[];
}

export interface DamageCalculationModifier {
  readonly operation: CalculationOperationKind;
  readonly amount: number;
  readonly provenance: CalculationProvenance;
  readonly basis?: "power-percent" | "damage-percent";
  readonly cap?: { readonly type: "minimum" | "maximum"; readonly value: number };
  readonly capOnly?: boolean;
  readonly prevented?: boolean;
  readonly order?: number;
}

export interface DamageCalculationInput {
  readonly baseDamage: number;
  readonly modifiers?: readonly DamageCalculationModifier[];
  readonly prevention?: CalculationPrevention;
  readonly modifierPreventions?: readonly CalculationModifierPrevention[];
  readonly retainTrace?: boolean;
}

export interface CostCalculationInput {
  readonly baseCost: number;
  readonly operations?: readonly CalculationOperation[];
  readonly replacements?: readonly CalculationReplacement[];
  readonly bounds?: readonly CalculationBound[];
  readonly prevention?: CalculationPrevention;
  readonly modifierPreventions?: readonly CalculationModifierPrevention[];
  readonly retainTrace?: boolean;
}

const calculationStages: readonly CalculationStage[] = [
  "prevention",
  "replacement",
  "set",
  "additive",
  "multiplicative",
  "rounding",
  "bounds",
];

const assertFinite = (value: number, label: string) => {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite.`);
};

const stageForOperation = (operation: CalculationOperationKind): CalculationStage => {
  switch (operation) {
    case "set":
      return "set";
    case "add":
      return "additive";
    case "multiply":
      return "multiplicative";
  }
};

const ordered = <T extends { readonly order?: number }>(values: readonly T[]) =>
  values
    .map((value, index) => ({ value, index }))
    .sort(
      (left, right) =>
        (left.value.order ?? left.index) - (right.value.order ?? right.index) ||
        left.index - right.index,
    )
    .map(({ value }) => value);

const orderedOperations = (operations: readonly CalculationOperation[]) =>
  operations
    .map((operation, index) => ({
      operation,
      index,
      stage: stageForOperation(operation.operation),
    }))
    .sort(
      (left, right) =>
        calculationStages.indexOf(left.stage) - calculationStages.indexOf(right.stage) ||
        (left.operation.order ?? left.index) - (right.operation.order ?? right.index) ||
        left.index - right.index,
    )
    .map(({ operation }) => operation);

const traceEntry = (
  stage: CalculationStage,
  provenance: CalculationProvenance,
  input: number,
  output: number,
  status: CalculationTraceStatus,
): CalculationTraceEntry => ({ stage, provenance, input, output, status });

const modifierIsPrevented = (
  operation: CalculationOperation | CalculationBound,
  modifierPreventions: readonly CalculationModifierPrevention[],
) =>
  operation.prevented === true ||
  modifierPreventions.some(({ provenance }) => provenance === operation.provenance);

const applyCalculationReplacements = (
  value: number,
  replacements: readonly CalculationReplacement[],
  trace?: CalculationTraceEntry[],
) => {
  let current = value;
  for (const replacement of ordered(replacements)) {
    assertFinite(replacement.value, "Calculation replacement value");
    const replacementInput = current;
    if (replacement.prevented === true) {
      trace?.push(
        traceEntry(
          "replacement",
          replacement.provenance,
          replacementInput,
          replacementInput,
          "skipped",
        ),
      );
      continue;
    }
    current = replacement.value;
    trace?.push(
      traceEntry("replacement", replacement.provenance, replacementInput, current, "applied"),
    );
  }
  return current;
};

const applyCalculationOperation = (
  value: number,
  operation: CalculationOperation,
  modifierPreventions: readonly CalculationModifierPrevention[],
  trace?: CalculationTraceEntry[],
) => {
  assertFinite(operation.amount, "Calculation operation amount");
  const stage = stageForOperation(operation.operation);
  if (modifierIsPrevented(operation, modifierPreventions)) {
    trace?.push(traceEntry(stage, operation.provenance, value, value, "skipped"));
    return value;
  }

  let current = value;
  switch (operation.operation) {
    case "set":
      current = operation.amount;
      break;
    case "add":
      current +=
        operation.percentageBase === undefined
          ? operation.amount
          : percentageOfCalculationBase(operation.percentageBase, operation.amount);
      break;
    case "multiply":
      current *= operation.amount;
      break;
  }
  assertFinite(current, "Calculated value");
  trace?.push(traceEntry(stage, operation.provenance, value, current, "applied"));
  return current;
};

const applyCalculationOperations = (
  value: number,
  operations: readonly CalculationOperation[],
  modifierPreventions: readonly CalculationModifierPrevention[],
  trace?: CalculationTraceEntry[],
) => {
  let current = value;
  for (const operation of orderedOperations(operations)) {
    current = applyCalculationOperation(current, operation, modifierPreventions, trace);
  }
  return current;
};

const damageOperationAmount = (baseDamage: number, modifier: DamageCalculationModifier) => {
  if (modifier.basis === "damage-percent" && modifier.operation === "set") {
    return percentageOfCalculationBase(baseDamage, modifier.amount);
  }
  if (modifier.basis !== undefined && modifier.operation === "multiply") {
    return modifier.amount / 100;
  }
  return modifier.amount;
};

/** Round a completed formula exactly once using the engine's integer rule. */
export const roundCalculationToInteger = (value: number) => {
  assertFinite(value, "Calculation value");
  return Math.round(value);
};

/** Resolve a declared percentage against its explicit calculation base. */
export const percentageOfCalculationBase = (base: number, percentage: number) => {
  assertFinite(base, "Percentage base");
  assertFinite(percentage, "Percentage");
  return (base * percentage) / 100;
};

/** Apply ordered minimum/maximum bounds without changing their declared order. */
export const applyCalculationBounds = (
  value: number,
  bounds: readonly CalculationBound[],
  modifierPreventions: readonly CalculationModifierPrevention[] = [],
  trace?: CalculationTraceEntry[],
) => {
  let current = value;
  for (const bound of ordered(bounds)) {
    assertFinite(bound.value, "Calculation bound");
    const input = current;
    if (modifierIsPrevented(bound, modifierPreventions)) {
      trace?.push(traceEntry("bounds", bound.provenance, input, input, "skipped"));
      continue;
    }
    current =
      bound.type === "minimum" ? Math.max(current, bound.value) : Math.min(current, bound.value);
    trace?.push(traceEntry("bounds", bound.provenance, input, current, "applied"));
  }
  return current;
};

/**
 * Resolve a numeric combat formula using the ND-070 precedence model.
 * Operation kinds choose their stage; callers never need to pre-sort modifiers.
 */
export const calculateValue = (input: CalculationInput): CalculationResult => {
  assertFinite(input.baseValue, "Calculation base value");
  const trace: CalculationTraceEntry[] | undefined = input.retainTrace === false ? undefined : [];
  const modifierPreventions = input.modifierPreventions ?? [];

  if (input.prevention !== undefined) {
    assertFinite(input.prevention.preventedValue, "Prevented calculation value");
    trace?.push(
      traceEntry(
        "prevention",
        input.prevention.provenance,
        input.baseValue,
        input.prevention.preventedValue,
        "applied",
      ),
    );
    return { value: input.prevention.preventedValue, ...(trace === undefined ? {} : { trace }) };
  }

  let value = applyCalculationReplacements(input.baseValue, input.replacements ?? [], trace);
  value = applyCalculationOperations(value, input.operations ?? [], modifierPreventions, trace);

  if (input.rounding !== undefined) {
    const roundingInput = value;
    value = roundCalculationToInteger(value);
    trace?.push(
      traceEntry(
        "rounding",
        input.rounding.provenance ?? "rounding",
        roundingInput,
        value,
        "applied",
      ),
    );
  }

  value = applyCalculationBounds(value, input.bounds ?? [], modifierPreventions, trace);
  return { value, ...(trace === undefined ? {} : { trace }) };
};

/** Resolve damage modifiers against their declared power/damage percentage basis. */
export const calculateDamage = (input: DamageCalculationInput): CalculationResult => {
  const modifiers = input.modifiers ?? [];
  const operations = modifiers.flatMap((modifier) => {
    if (modifier.capOnly === true && modifier.cap !== undefined) return [];
    const amount = damageOperationAmount(input.baseDamage, modifier);
    return [
      {
        operation: modifier.operation,
        amount,
        ...(modifier.basis === "damage-percent" && modifier.operation === "add"
          ? { percentageBase: input.baseDamage }
          : {}),
        provenance: modifier.provenance,
        ...(modifier.order === undefined ? {} : { order: modifier.order }),
        ...(modifier.prevented === true ? { prevented: true } : {}),
      },
    ];
  });
  const bounds = modifiers.flatMap((modifier) =>
    modifier.cap === undefined
      ? []
      : [
          {
            type: modifier.cap.type,
            value: modifier.cap.value,
            provenance: `${modifier.provenance}:cap`,
            ...(modifier.order === undefined ? {} : { order: modifier.order }),
            ...(modifier.prevented === true ? { prevented: true } : {}),
          },
        ],
  );
  return calculateValue({
    baseValue: input.baseDamage,
    operations,
    bounds: [...bounds, { type: "minimum", value: 0, provenance: "damage:minimum-zero" }],
    prevention: input.prevention,
    modifierPreventions: input.modifierPreventions,
    rounding: { type: "integer", provenance: "damage:rounding" },
    retainTrace: input.retainTrace,
  });
};

/** Resolve any Ki, activation, or other spendable-resource cost through the shared pipeline. */
export const calculateCost = (input: CostCalculationInput): CalculationResult =>
  calculateValue({
    baseValue: input.baseCost,
    operations: input.operations,
    replacements: input.replacements,
    bounds: [
      { type: "minimum", value: 0, provenance: "cost:minimum-zero" },
      ...(input.bounds ?? []),
    ],
    prevention: input.prevention,
    modifierPreventions: input.modifierPreventions,
    rounding: { type: "integer", provenance: "cost:rounding" },
    retainTrace: input.retainTrace,
  });

/** Publicly exposes the stage order used by all calculation categories. */
export const CALCULATION_STAGE_ORDER = calculationStages;
