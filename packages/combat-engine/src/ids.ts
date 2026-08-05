import { z } from "zod";

declare const combatIdBrand: unique symbol;

type CombatId<TPrefix extends string> = string & {
  readonly [combatIdBrand]: TPrefix;
};

const idSuffixPattern = "[a-z0-9]+(?:-[a-z0-9]+)*";

const createCombatIdSchema = <TPrefix extends string>(prefix: TPrefix) =>
  z
    .string()
    .regex(new RegExp(`^${prefix}:${idSuffixPattern}$`, "u"))
    .transform((value): CombatId<TPrefix> => value as CombatId<TPrefix>);

export type FightId = CombatId<"fight">;
export type CombatantId = CombatId<"combatant">;
export type CombatDecisionId = CombatId<"decision">;
export type CombatEventId = CombatId<"event">;
export type PendingDecisionId = CombatId<"pending-decision">;
export type ActiveEffectId = CombatId<"active-effect">;

export const fightIdSchema = createCombatIdSchema("fight");
export const combatantIdSchema = createCombatIdSchema("combatant");
export const combatDecisionIdSchema = createCombatIdSchema("decision");
export const combatEventIdSchema = createCombatIdSchema("event");
export const pendingDecisionIdSchema = createCombatIdSchema("pending-decision");
export const activeEffectIdSchema = createCombatIdSchema("active-effect");
