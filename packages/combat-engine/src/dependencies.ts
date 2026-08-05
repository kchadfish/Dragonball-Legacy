import type {
  ActiveEffectId,
  CombatDecisionId,
  CombatEventId,
  CombatantId,
  FightId,
  PendingDecisionId,
} from "./ids.js";

export interface RandomSource {
  integer(minimum: number, maximum: number): number;
}

export interface Clock {
  now(): Date;
}

export interface CombatIdSource {
  nextFightId(): FightId;
  nextCombatantId(): CombatantId;
  nextDecisionId(): CombatDecisionId;
  nextEventId(): CombatEventId;
  nextPendingDecisionId(): PendingDecisionId;
  nextActiveEffectId(): ActiveEffectId;
}

export interface CombatDependencies {
  readonly random: RandomSource;
  readonly clock: Clock;
  readonly ids: CombatIdSource;
}
