import type {
  EffectDefinition,
  EffectSelection,
  NumericExpression,
} from "@dragonball-resurgence/game-data";

type SelectionBearingEffect = Pick<EffectDefinition, "selectionSpec"> & {
  /** Legacy serialized snapshots may still contain this field. */
  readonly selectionLimit?: number;
};

/** Returns the statically known limit used by validation and catalog accounting. */
export const staticSelectionLimit = (effect: SelectionBearingEffect): number | undefined => {
  const selection = effect.selectionSpec;
  if (selection?.type === "one") return 1;
  if (selection?.type === "up-to" && selection.limit.type === "literal")
    return selection.limit.value;
  return (effect as { readonly selectionLimit?: number }).selectionLimit;
};

export const selectionType = (
  effect: SelectionBearingEffect,
): EffectSelection["type"] | undefined => effect.selectionSpec?.type;

export const hasSelectionSpec = (effect: SelectionBearingEffect): boolean =>
  effect.selectionSpec !== undefined ||
  (effect as { readonly selectionLimit?: number }).selectionLimit !== undefined;

export const isLiteralSelectionLimit = (
  expression: NumericExpression,
): expression is Extract<NumericExpression, { readonly type: "literal" }> =>
  expression.type === "literal";
