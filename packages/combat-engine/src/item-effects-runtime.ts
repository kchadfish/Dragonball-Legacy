import type { ItemDefinition } from "@dragonball-resurgence/game-data";

import type { CombatantState } from "./contracts.js";

export interface ItemResourceResolution {
  readonly hitPoints: number;
  readonly ki: number;
}

const adjustedByPercent = (value: number, percent: number) =>
  Math.round(value * (1 + percent / 100));

/**
 * Applies the combat-relevant passive equipment bonuses at fight creation.
 * Items without a combat stat effect deliberately remain inventory only.
 */
export const applyCombatItemPassives = (
  combatant: CombatantState,
  items: readonly ItemDefinition[],
): CombatantState =>
  items.reduce((current, item) => {
    for (const effect of item.effects ?? []) {
      if (effect.trigger !== "passive" || effect.type !== "item-modify-stat-percent") continue;
      const affectsPower = effect.stat === "power" || effect.stat === "all-stats";
      const affectsDexterity = effect.stat === "dexterity" || effect.stat === "all-stats";
      const affectsHitPoints = effect.stat === "hp" || effect.stat === "all-stats";
      const maximumHitPoints = affectsHitPoints
        ? adjustedByPercent(current.hitPoints.maximum, effect.percent)
        : current.hitPoints.maximum;
      current = {
        ...current,
        hitPoints: {
          maximum: maximumHitPoints,
          current: affectsHitPoints
            ? Math.min(
                maximumHitPoints,
                adjustedByPercent(current.hitPoints.current, effect.percent),
              )
            : current.hitPoints.current,
        },
        stats: {
          ...current.stats,
          power: affectsPower
            ? adjustedByPercent(current.stats.power, effect.percent)
            : current.stats.power,
          dexterity: affectsDexterity
            ? adjustedByPercent(current.stats.dexterity, effect.percent)
            : current.stats.dexterity,
        },
      };
    }
    return current;
  }, combatant);

const isItemResourceEffect = (
  effect: NonNullable<ItemDefinition["effects"]>[number],
): effect is Extract<
  NonNullable<ItemDefinition["effects"]>[number],
  { readonly type: "item-modify-resource" }
> => effect.type === "item-modify-resource";

type CommonItemResourceEffect = Extract<
  NonNullable<ItemDefinition["effects"]>[number],
  { readonly type: "modify-resource" }
>;

const isCommonItemResourceEffect = (
  effect: NonNullable<ItemDefinition["effects"]>[number],
): effect is CommonItemResourceEffect =>
  effect.type === "modify-resource" &&
  effect.trigger === "on-move-use" &&
  effect.target === "self" &&
  (effect.operation === "gain" || effect.operation === "lose") &&
  effect.amount !== undefined &&
  (effect.amount.type === "literal" ||
    (effect.amount.type === "resource-percent" && effect.amount.subject === "self"));

/** True when an item has a fully representable, immediate combat resource effect. */
export const isCombatResourceItem = (item: ItemDefinition) =>
  item.effects?.some(
    (effect) =>
      (isItemResourceEffect(effect) &&
        effect.trigger === "combat-action" &&
        effect.target === "self") ||
      isCommonItemResourceEffect(effect),
  ) ?? false;

const amountFor = (
  amount: Extract<
    NonNullable<ItemDefinition["effects"]>[number],
    { readonly type: "item-modify-resource" | "modify-resource" }
  >["amount"],
  combatant: CombatantState,
  resource: "hp" | "ki",
) => {
  if (amount === undefined) return 0;
  if (amount.type === "literal" && "value" in amount) return amount.value;
  if (amount.type !== "resource-percent" || !("basis" in amount) || !("percent" in amount))
    return 0;
  const values = resource === "hp" ? combatant.hitPoints : combatant.ki;
  const basis = amount.basis === "current" ? values.current : values.maximum;
  return Math.round((basis * amount.percent) / 100);
};

const updated = (current: number, maximum: number, operation: "gain" | "lose", amount: number) =>
  Math.min(maximum, Math.max(0, operation === "gain" ? current + amount : current - amount));

/** Resolves converted non-spaceship resource effects from an item trigger. */
export const resolveItemResources = (
  item: ItemDefinition,
  trigger: "combat-action" | "on-item-use" | "on-move-use",
  self: CombatantState,
): ItemResourceResolution => {
  let hitPoints = self.hitPoints.current;
  let ki = self.ki.current;
  for (const effect of item.effects ?? []) {
    const isLegacy = isItemResourceEffect(effect);
    const isCommon = isCommonItemResourceEffect(effect);
    if ((!isLegacy && !isCommon) || effect.trigger !== trigger || effect.target !== "self")
      continue;
    if (effect.operation !== "gain" && effect.operation !== "lose") continue;
    const amount = amountFor(effect.amount, self, effect.resource);
    if (effect.resource === "hp")
      hitPoints = updated(hitPoints, self.hitPoints.maximum, effect.operation, amount);
    else ki = updated(ki, self.ki.maximum, effect.operation, amount);
  }
  return { hitPoints, ki };
};
