import type { TransformationDefinition } from "@dragonball-resurgence/game-data";

import type { CombatantState } from "./contracts.js";

export interface TransformationBaseline {
  readonly maximumHitPoints: number;
  readonly hpBonus?: number;
  readonly stats: CombatantState["stats"];
  readonly slotCapacities?: NonNullable<CombatantState["slotCapacities"]>;
  readonly slotCapacityModifications?: NonNullable<CombatantState["slotCapacityModifications"]>;
}

export interface TransformedCombatant {
  readonly baseline: TransformationBaseline;
  readonly combatant: CombatantState;
}

const adjusted = (value: number, percent: number) => Math.round(value * (1 + percent / 100));

/** Applies converted transformation stat modifiers while retaining exact reversal data. */
export const applyTransformation = (
  combatant: CombatantState,
  transformation: TransformationDefinition,
): TransformedCombatant => {
  const baseline: TransformationBaseline = {
    maximumHitPoints: combatant.hitPoints.maximum,
    stats: combatant.stats,
    ...(combatant.slotCapacities === undefined ? {} : { slotCapacities: combatant.slotCapacities }),
    ...(combatant.slotCapacityModifications === undefined
      ? {}
      : { slotCapacityModifications: combatant.slotCapacityModifications }),
  };
  const maximumHitPoints = adjusted(
    baseline.maximumHitPoints,
    transformation.statModifiers.hpPercent,
  );
  const hpBonus = maximumHitPoints - baseline.maximumHitPoints;
  return {
    baseline: { ...baseline, hpBonus },
    combatant: {
      ...combatant,
      hitPoints: {
        maximum: maximumHitPoints,
        current: Math.min(maximumHitPoints, combatant.hitPoints.current + hpBonus),
      },
      stats: {
        ...combatant.stats,
        power: adjusted(baseline.stats.power, transformation.statModifiers.powerPercent),
        dexterity: adjusted(
          baseline.stats.dexterity,
          transformation.statModifiers.dexterityPercent,
        ),
      },
    },
  };
};

/** Reverts only the converted stat layer; unrelated combat state remains untouched. */
export const revertTransformation = (
  combatant: CombatantState,
  baseline: TransformationBaseline,
): CombatantState => {
  const hpBonus =
    baseline.hpBonus ?? Math.max(0, combatant.hitPoints.maximum - baseline.maximumHitPoints);
  const currentAfterBonus = Math.min(
    baseline.maximumHitPoints,
    Math.max(0, combatant.hitPoints.current - hpBonus),
  );
  const current =
    combatant.status === "active" && combatant.hitPoints.current > 0 && currentAfterBonus === 0
      ? 1
      : currentAfterBonus;
  return {
    ...combatant,
    hitPoints: { maximum: baseline.maximumHitPoints, current },
    stats: baseline.stats,
    ...(baseline.slotCapacities === undefined ? {} : { slotCapacities: baseline.slotCapacities }),
    ...(baseline.slotCapacityModifications === undefined
      ? {}
      : { slotCapacityModifications: baseline.slotCapacityModifications }),
  };
};
