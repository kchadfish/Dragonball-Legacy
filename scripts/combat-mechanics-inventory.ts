import { ITEM_DEFINITIONS } from "../packages/game-data/src/item-definitions.js";
import { MOVE_DEFINITIONS } from "../packages/game-data/src/move-definitions.js";
import {
  GENERIC_CLASS_DEFINITIONS,
  RACE_DEFINITIONS,
} from "../packages/game-data/src/race-definitions.js";
import { TRANSFORMATION_DEFINITIONS } from "../packages/game-data/src/transformation-definitions.js";

type CountByKey = Readonly<Record<string, number>>;

export interface CombatMechanicsInventory {
  readonly moveDefinitions: {
    readonly total: number;
    readonly withEffects: number;
    readonly withoutEffects: readonly string[];
  };
  readonly transformationAbilities: {
    readonly total: number;
    readonly withStructuredEffects: number;
    readonly sourceTextOnly: number;
  };
  readonly raceAbilities: {
    readonly traits: number;
    readonly classes: number;
    readonly genericClasses: number;
  };
  readonly itemDefinitions: {
    readonly total: number;
    readonly withEffects: number;
    readonly executableRules: number;
    readonly nonExecutableRules: number;
  };
  readonly effects: {
    readonly byOrigin: CountByKey;
    readonly byType: CountByKey;
    readonly byTrigger: CountByKey;
    readonly byTarget: CountByKey;
    readonly conditions: CountByKey;
    readonly durations: CountByKey;
    readonly scopes: CountByKey;
  };
  readonly sourceExpressions: readonly string[];
  readonly unresolvedRuleReasons: CountByKey;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const increment = (counts: Record<string, number>, key: string): void => {
  counts[key] = (counts[key] ?? 0) + 1;
};

const sortedCounts = (counts: Record<string, number>): CountByKey =>
  Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));

const stringProperty = (value: UnknownRecord, key: string): string | undefined => {
  const property = value[key];
  return typeof property === "string" ? property : undefined;
};

const collectSourceExpressions = (
  value: unknown,
  path: string,
  sourceExpressions: string[],
  unresolvedRuleReasons: Record<string, number>,
): void => {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      collectSourceExpressions(
        entry,
        `${path}[${index}]`,
        sourceExpressions,
        unresolvedRuleReasons,
      );
    });
    return;
  }

  if (!isRecord(value)) return;

  if (value.type === "source-expression") sourceExpressions.push(path);
  const unresolvedReason = stringProperty(value, "unresolvedReason");
  if (unresolvedReason !== undefined) increment(unresolvedRuleReasons, unresolvedReason);

  for (const [key, entry] of Object.entries(value)) {
    collectSourceExpressions(entry, `${path}.${key}`, sourceExpressions, unresolvedRuleReasons);
  }
};

export const createCombatMechanicsInventory = (): CombatMechanicsInventory => {
  const effectOrigins: Record<string, number> = {};
  const effectTypes: Record<string, number> = {};
  const effectTriggers: Record<string, number> = {};
  const effectTargets: Record<string, number> = {};
  const conditions: Record<string, number> = {};
  const durations: Record<string, number> = {};
  const scopes: Record<string, number> = {};
  const sourceExpressions: string[] = [];
  const unresolvedRuleReasons: Record<string, number> = {};

  const collectEffects = (effects: readonly unknown[] | undefined, origin: string): void => {
    for (const effect of effects ?? []) {
      if (!isRecord(effect)) continue;

      increment(effectOrigins, origin);
      const type = stringProperty(effect, "type");
      if (type !== undefined) increment(effectTypes, type);
      const trigger = stringProperty(effect, "trigger");
      if (trigger !== undefined) increment(effectTriggers, trigger);
      const target = stringProperty(effect, "target");
      if (target !== undefined) increment(effectTargets, target);

      const effectConditions = effect.conditions;
      if (Array.isArray(effectConditions)) {
        for (const condition of effectConditions) {
          if (!isRecord(condition)) continue;
          const conditionType = stringProperty(condition, "type");
          if (conditionType !== undefined) increment(conditions, conditionType);
        }
      }

      if (isRecord(effect.duration)) {
        const durationType = stringProperty(effect.duration, "type");
        if (durationType !== undefined) increment(durations, durationType);
      }
      if (isRecord(effect.scope)) {
        const scopeType = stringProperty(effect.scope, "type");
        if (scopeType !== undefined) increment(scopes, scopeType);
      }
    }
  };

  const movesWithoutEffects = MOVE_DEFINITIONS.filter(
    (move) => (move.effects?.length ?? 0) === 0,
  ).map((move) => move.id);
  for (const move of MOVE_DEFINITIONS) collectEffects(move.effects, "move");

  const transformationAbilities = TRANSFORMATION_DEFINITIONS.flatMap((transformation) =>
    Object.values(transformation.abilities),
  );
  for (const ability of transformationAbilities) collectEffects(ability.effects, "transformation");

  for (const item of ITEM_DEFINITIONS) collectEffects(item.effects, "item");

  for (const move of MOVE_DEFINITIONS) {
    collectSourceExpressions(move, `moves.${move.id}`, sourceExpressions, unresolvedRuleReasons);
  }
  for (const transformation of TRANSFORMATION_DEFINITIONS) {
    collectSourceExpressions(
      transformation,
      `transformations.${transformation.id}`,
      sourceExpressions,
      unresolvedRuleReasons,
    );
  }
  for (const item of ITEM_DEFINITIONS) {
    collectSourceExpressions(item, `items.${item.id}`, sourceExpressions, unresolvedRuleReasons);
  }
  for (const race of RACE_DEFINITIONS) {
    collectSourceExpressions(race, `races.${race.id}`, sourceExpressions, unresolvedRuleReasons);
  }
  for (const classDefinition of GENERIC_CLASS_DEFINITIONS)
    collectEffects(classDefinition.effects, "generic-class");

  const itemRules = ITEM_DEFINITIONS.flatMap((item) => item.rules);

  return {
    moveDefinitions: {
      total: MOVE_DEFINITIONS.length,
      withEffects: MOVE_DEFINITIONS.length - movesWithoutEffects.length,
      withoutEffects: movesWithoutEffects,
    },
    transformationAbilities: {
      total: transformationAbilities.length,
      withStructuredEffects: transformationAbilities.filter(
        (ability) => (ability.effects?.length ?? 0) > 0,
      ).length,
      sourceTextOnly: transformationAbilities.filter(
        (ability) => ability.effectText !== undefined && (ability.effects?.length ?? 0) === 0,
      ).length,
    },
    raceAbilities: {
      traits: RACE_DEFINITIONS.flatMap((race) => race.racialTraits).length,
      classes: RACE_DEFINITIONS.flatMap((race) => race.classes).length,
      genericClasses: GENERIC_CLASS_DEFINITIONS.length,
    },
    itemDefinitions: {
      total: ITEM_DEFINITIONS.length,
      withEffects: ITEM_DEFINITIONS.filter((item) => (item.effects?.length ?? 0) > 0).length,
      executableRules: itemRules.filter((rule) => rule.executable).length,
      nonExecutableRules: itemRules.filter((rule) => !rule.executable).length,
    },
    effects: {
      byOrigin: sortedCounts(effectOrigins),
      byType: sortedCounts(effectTypes),
      byTrigger: sortedCounts(effectTriggers),
      byTarget: sortedCounts(effectTargets),
      conditions: sortedCounts(conditions),
      durations: sortedCounts(durations),
      scopes: sortedCounts(scopes),
    },
    sourceExpressions: sourceExpressions.sort(),
    unresolvedRuleReasons: sortedCounts(unresolvedRuleReasons),
  };
};

if (process.argv[1]?.endsWith("combat-mechanics-inventory.ts")) {
  console.log(JSON.stringify(createCombatMechanicsInventory(), null, 2));
}
