import type { ItemDefinition, ItemUsePolicy } from "@dragonball-resurgence/game-data";

import type { CombatantState } from "./contracts.js";
import { calculateValue } from "./calculation-pipeline.js";

export type CombatItemPreventedOutcome = "break" | "sever";

export interface ItemResourceResolution {
  readonly hitPoints: number;
  readonly ki: number;
}

const itemActivationTimingForText = (effectText: string): ItemUsePolicy["timing"] => {
  if (/when you lose a battle/iu.test(effectText)) return "defeat-interrupt";
  if (/does not take up your turn/iu.test(effectText)) return "free";
  return "action";
};

/** Returns the normalized item policy, including a deterministic legacy fallback. */
export const itemUsePolicyFor = (item: ItemDefinition): ItemUsePolicy | undefined => {
  if (item.usePolicy !== undefined) return item.usePolicy;
  // eslint-disable-next-line sonarjs/deprecation -- normalize legacy serialized snapshots.
  const legacyMaxUses = item.maxUses;
  if (legacyMaxUses === undefined) return undefined;
  return { timing: itemActivationTimingForText(item.effectText), consumableUses: legacyMaxUses };
};

export const itemUseLimitFor = (item: ItemDefinition): number | undefined => {
  const policy = itemUsePolicyFor(item);
  if (policy === undefined) return undefined;
  const limits = [policy.consumableUses, policy.restrictedUses].filter(
    (limit): limit is number => limit !== undefined,
  );
  return limits.length === 0 ? undefined : Math.min(...limits);
};

/** Applies a typed race-specific capacity override while retaining the ordinary item capacity. */
export const itemUseLimitForCombatant = (
  item: ItemDefinition,
  combatant: CombatantState,
): number | undefined => {
  const ordinary = itemUseLimitFor(item);
  const raceLimit = (item.effects ?? [])
    .flatMap((effect) =>
      effect.type === "item-state-rule" && effect.operation === "limit-race-item-uses"
        ? [effect]
        : [],
    )
    .find((effect) => effect.raceId === combatant.raceId)?.amount;
  return raceLimit === undefined ? ordinary : Math.max(ordinary ?? 0, raceLimit);
};

export const itemResourceGainForRace = (
  item: ItemDefinition,
  combatant: CombatantState,
): Readonly<{ readonly hitPoints: number; readonly ki: number }> => {
  let hitPoints = 0;
  let ki = 0;
  for (const effect of item.effects ?? []) {
    if (
      effect.type !== "item-state-rule" ||
      effect.operation !== "grant-resource-when-race" ||
      effect.raceId !== combatant.raceId ||
      effect.resource === undefined
    )
      continue;
    if (effect.resource === "hp") hitPoints += effect.amount ?? 0;
    else ki += effect.amount ?? 0;
  }
  return { hitPoints, ki };
};

export const itemUseGroupsFor = (item: ItemDefinition) => itemUsePolicyFor(item)?.groups ?? [];

export const itemTimingAllowsPhase = (
  item: ItemDefinition,
  phase: "upkeep" | "action" | "counter" | "end",
): boolean => {
  const timing = itemUsePolicyFor(item)?.timing;
  if (phase === "action") return timing === "action" || timing === "free";
  return timing === "upkeep" && phase === "upkeep";
};

/** A shared capability predicate used by both legal-decision enumeration and submission. */
export const isCombatUsableItem = (item: ItemDefinition): boolean =>
  itemUsePolicyFor(item) !== undefined &&
  (isCombatResourceItem(item) ||
    isCombatRollModifierItem(item) ||
    isCombatDamageModifierItem(item) ||
    (item.effects?.some(
      (effect) =>
        effect.type === "item-state-rule" &&
        [
          "pay-activation-ki",
          "heal-current-hp",
          "modify-all-roll-sides",
          "activate-on-advanced-attack",
          "activate-after-defense-roll",
          "modify-selected-roll",
          "grant-ki-per-combat",
          "resolve-self-destruct",
          "grant-resource-when-race",
        ].includes(effect.operation),
    ) ??
      false));

const adjustedByPercent = (value: number, percent: number, provenance: string) =>
  calculateValue({
    baseValue: value,
    operations: [
      {
        operation: "multiply",
        amount: 1 + percent / 100,
        provenance,
      },
    ],
    rounding: { type: "integer", provenance: `${provenance}:rounding` },
  }).value;

/**
 * Applies the combat-relevant passive equipment bonuses at fight creation.
 * Items without a combat stat effect deliberately remain inventory only.
 */
export const applyCombatItemPassives = (
  combatant: CombatantState,
  items: readonly ItemDefinition[],
): CombatantState =>
  items.reduce((current, item) => {
    for (const [effectIndex, effect] of (item.effects ?? []).entries()) {
      if (effect.trigger !== "passive" || effect.type !== "item-modify-stat-percent") continue;
      const provenance = `${item.id}:${effectIndex}`;
      const affectsPower = effect.stat === "power" || effect.stat === "all-stats";
      const affectsDexterity = effect.stat === "dexterity" || effect.stat === "all-stats";
      const affectsHitPoints = effect.stat === "hp" || effect.stat === "all-stats";
      const maximumHitPoints = affectsHitPoints
        ? adjustedByPercent(current.hitPoints.maximum, effect.percent, `${provenance}:max-hp`)
        : current.hitPoints.maximum;
      current = {
        ...current,
        hitPoints: {
          maximum: maximumHitPoints,
          current: affectsHitPoints
            ? Math.min(
                maximumHitPoints,
                adjustedByPercent(current.hitPoints.current, effect.percent, `${provenance}:hp`),
              )
            : current.hitPoints.current,
        },
        stats: {
          ...current.stats,
          power: affectsPower
            ? adjustedByPercent(current.stats.power, effect.percent, `${provenance}:power`)
            : current.stats.power,
          dexterity: affectsDexterity
            ? adjustedByPercent(current.stats.dexterity, effect.percent, `${provenance}:dexterity`)
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

/** Returns the exact BREAK/SEVER outcomes prevented by a defensive combat item. */
export const combatItemPreventedOutcomes = (
  item: ItemDefinition,
): readonly CombatItemPreventedOutcome[] =>
  item.effects?.flatMap((effect) =>
    effect.trigger === "combat-action" && effect.type === "item-prevent-combat-outcome"
      ? effect.outcomes
      : [],
  ) ?? [];

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

type ResolvableItemResourceEffect = Extract<
  NonNullable<ItemDefinition["effects"]>[number],
  { readonly type: "item-modify-resource" | "modify-resource" }
>;

const resolvedResourceValue = (
  item: ItemDefinition,
  effect: ResolvableItemResourceEffect,
  self: CombatantState,
  current: number,
  maximum: number,
) => {
  const resource = effect.resource === "hp" ? "hp" : "ki";
  const amount = amountFor(effect.amount, self, resource);
  return calculateValue({
    baseValue: current,
    operations: [
      {
        operation: "add",
        amount: effect.operation === "gain" ? amount : -amount,
        provenance: `${item.id}:${effect.sourceClauseOrder ?? 0}:${resource}`,
      },
    ],
    bounds: [
      { type: "minimum", value: 0, provenance: `${item.id}:minimum-${resource}` },
      { type: "maximum", value: maximum, provenance: `${item.id}:maximum-${resource}` },
    ],
    rounding: { type: "integer", provenance: `${item.id}:rounding-${resource}` },
  }).value;
};

const resourceEffectFor = (
  effect: NonNullable<ItemDefinition["effects"]>[number],
  trigger: "combat-action" | "on-item-use" | "on-move-use",
): ResolvableItemResourceEffect | undefined => {
  if (isItemResourceEffect(effect)) {
    if (
      effect.trigger === trigger &&
      effect.target === "self" &&
      (effect.operation === "gain" || effect.operation === "lose")
    ) {
      return effect;
    }
    return undefined;
  }
  if (isCommonItemResourceEffect(effect) && effect.trigger === trigger) return effect;
  return undefined;
};

/** Resolves converted non-spaceship resource effects from an item trigger. */
export const resolveItemResources = (
  item: ItemDefinition,
  trigger: "combat-action" | "on-item-use" | "on-move-use",
  self: CombatantState,
): ItemResourceResolution => {
  let hitPoints = self.hitPoints.current;
  let ki = self.ki.current;
  for (const effect of item.effects ?? []) {
    const resourceEffect = resourceEffectFor(effect, trigger);
    if (resourceEffect === undefined) continue;
    const resource = resourceEffect.resource === "hp" ? "hp" : "ki";
    const current = resource === "hp" ? hitPoints : ki;
    const maximum = resource === "hp" ? self.hitPoints.maximum : self.ki.maximum;
    const result = resolvedResourceValue(item, resourceEffect, self, current, maximum);
    if (resource === "hp") hitPoints = result;
    else ki = result;
  }
  return { hitPoints, ki };
};

const isCombatRollModifierItem = (item: ItemDefinition) =>
  item.effects?.some(
    (effect) =>
      (effect.type === "item-modify-roll" &&
        (effect.trigger === "combat-action" ||
          effect.trigger === "before-roll" ||
          effect.trigger === "after-defense-roll")) ||
      (effect.type === "item-state-rule" &&
        ["modify-all-roll-sides", "modify-selected-roll", "set-attack-roll-result"].includes(
          effect.operation,
        )),
  ) ?? false;

const isCombatDamageModifierItem = (item: ItemDefinition) =>
  item.effects?.some(
    (effect) =>
      effect.type === "item-modify-damage" ||
      (effect.type === "item-state-rule" &&
        ["make-advanced-attack-unblockable", "stop-low-roll-unrestricted-attack"].includes(
          effect.operation,
        )),
  ) ?? false;
