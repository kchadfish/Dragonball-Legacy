import type { EffectDefinition } from "@dragonball-resurgence/game-data";

type DamageModifierEffect = Extract<EffectDefinition, { readonly type: "modify-damage" }>;

const isLiteral = (value: unknown, expected: number) =>
  typeof value === "object" &&
  value !== null &&
  "type" in value &&
  value.type === "literal" &&
  "value" in value &&
  value.value === expected;

/** The exact durable action modifier represented by the counter-count variant. */
// eslint-disable-next-line complexity -- This exact capability matcher intentionally enumerates the declarative contract.
export const isCombatResultCountNextActionsDamageModifier = (effect: DamageModifierEffect) =>
  effect.trigger === "action-phase" &&
  effect.target === "self" &&
  effect.operation === "add" &&
  effect.percent?.type === "combat-result-count" &&
  effect.percent.actor === "self" &&
  effect.percent.result === "counter" &&
  effect.percent.perResult === 5 &&
  effect.percent.minimum === 5 &&
  effect.percent.maximum === 15 &&
  effect.selector?.type === "move-selector" &&
  effect.selector.subject === "target" &&
  effect.selector.category === "advanced-attack" &&
  effect.selector.styleId !== undefined &&
  effect.scope?.type === "next-actions" &&
  isLiteral(effect.scope.count, 2) &&
  effect.activationCost?.resource === "ki" &&
  isLiteral(effect.activationCost.amount, 2) &&
  effect.activationCost.minimum === undefined &&
  effect.duration === undefined &&
  effect.cap === undefined &&
  effect.useLimit === undefined &&
  effect.stacking === undefined &&
  effect.optional !== true &&
  effect.activationGroup === undefined &&
  effect.exclusiveActivationGroup === undefined &&
  (effect.conditions?.length ?? 0) === 0;

/** The exact selected-future-attack damage replacement variant. */
// eslint-disable-next-line complexity -- This exact capability matcher intentionally enumerates the declarative contract.
export const isSelectedMoveUntilAttackThresholdDamageModifier = (effect: DamageModifierEffect) =>
  effect.trigger === "on-success" &&
  effect.target === "opponent" &&
  effect.operation === "set" &&
  isLiteral(effect.percent, 0) &&
  effect.selector?.type === "move-selector" &&
  effect.selector.subject === "target" &&
  effect.selector.category === "advanced-attack" &&
  effect.duration?.type === "until-roll-threshold" &&
  effect.duration.roll === "attack" &&
  effect.duration.comparison === "at-least" &&
  isLiteral(effect.duration.value, 25) &&
  effect.scope === undefined &&
  effect.activationCost === undefined &&
  effect.cap === undefined &&
  effect.useLimit === undefined &&
  effect.stacking === "prevent" &&
  effect.optional !== true &&
  effect.activationGroup === undefined &&
  effect.exclusiveActivationGroup === undefined &&
  (effect.conditions?.length ?? 0) === 0;
