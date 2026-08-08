import type { TransformationDefinition } from "@dragonball-resurgence/game-data";

import type { CombatantState } from "./contracts.js";

export interface TransformationBaseline {
  readonly currentHitPoints: number;
  readonly maximumHitPoints: number;
  readonly stats: CombatantState["stats"];
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
  const baseline = {
    currentHitPoints: combatant.hitPoints.current,
    maximumHitPoints: combatant.hitPoints.maximum,
    stats: combatant.stats,
  };
  const maximumHitPoints = adjusted(
    baseline.maximumHitPoints,
    transformation.statModifiers.hpPercent,
  );
  return {
    baseline,
    combatant: {
      ...combatant,
      hitPoints: {
        maximum: maximumHitPoints,
        current: Math.min(
          maximumHitPoints,
          adjusted(combatant.hitPoints.current, transformation.statModifiers.hpPercent),
        ),
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
): CombatantState => ({
  ...combatant,
  hitPoints: {
    maximum: baseline.maximumHitPoints,
    current: Math.min(baseline.maximumHitPoints, baseline.currentHitPoints),
  },
  stats: baseline.stats,
});
