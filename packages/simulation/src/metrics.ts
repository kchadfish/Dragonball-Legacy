import type { CombatEvent, FightState } from "@dragonball-resurgence/combat-engine";
import { z } from "zod";

import { canonicalHash } from "./canonical.js";
import type { SimulationFightExecutionResult } from "./contracts.js";
import type { SimulationMoveCoveragePopulation } from "./move-coverage.js";
import {
  addSimulationValue,
  createSimulationMeanVariance,
  mergeSimulationMeanVariances,
  type SimulationMeanVariance,
} from "./statistics.js";

export const SIMULATION_MOVE_METRICS_SCHEMA_VERSION = "simulation-move-metrics:v1" as const;

const nonNegativeInteger = z.number().int().nonnegative();
const finiteNumber = z.number().refine(Number.isFinite, "Number must be finite.");
const meanVarianceSchema = z
  .object({ count: nonNegativeInteger, mean: finiteNumber, m2: finiteNumber.nonnegative() })
  .strict();
const counterRecordSchema = z.record(z.string().min(1), nonNegativeInteger);
const meansFor = () =>
  z
    .object({
      hp: meanVarianceSchema,
      ki: meanVarianceSchema,
    })
    .strict();

export interface SimulationMoveMetrics {
  readonly schemaVersion: typeof SIMULATION_MOVE_METRICS_SCHEMA_VERSION;
  readonly moveId: string;
  readonly population: SimulationMoveCoveragePopulation;
  readonly completedFights: number;
  readonly errorCount: number;
  readonly wins: Readonly<{ readonly a: number; readonly b: number; readonly draw: number }>;
  readonly fightLength: SimulationMeanVariance;
  readonly remainingResources: Readonly<{
    readonly a: Readonly<{
      readonly hp: SimulationMeanVariance;
      readonly ki: SimulationMeanVariance;
    }>;
    readonly b: Readonly<{
      readonly hp: SimulationMeanVariance;
      readonly ki: SimulationMeanVariance;
    }>;
  }>;
  readonly damage: Readonly<{
    readonly a: SimulationMeanVariance;
    readonly b: SimulationMeanVariance;
  }>;
  readonly overkill: Readonly<{
    readonly a: SimulationMeanVariance;
    readonly b: SimulationMeanVariance;
  }>;
  readonly kiEfficiency: SimulationMeanVariance;
  readonly actionEconomy: Readonly<{
    readonly actorActions: SimulationMeanVariance;
    readonly pendingResponses: SimulationMeanVariance;
    readonly completedActions: SimulationMeanVariance;
    readonly skippedActions: number;
  }>;
  readonly attackOutcomes: Readonly<{
    readonly attempted: number;
    readonly successful: number;
    readonly stopped: number;
    readonly critical: number;
    readonly counter: number;
  }>;
  readonly statuses: Readonly<{
    readonly applied: number;
    readonly removed: number;
    readonly rolled: number;
    readonly lockoutEvents: number;
  }>;
  readonly transformations: Readonly<{
    readonly activated: number;
    readonly deactivated: number;
    readonly rolled: number;
    readonly cooldownsStarted: number;
  }>;
  readonly restrictedUse: Readonly<{
    readonly moveUses: number;
    readonly limitChanges: number;
    readonly movesRemoved: number;
  }>;
  readonly sequences: Readonly<{
    readonly deferredScheduled: number;
    readonly deferredCancelled: number;
    readonly deferredPerformed: number;
    readonly counterChainLimits: number;
  }>;
  readonly stalls: Readonly<{
    readonly actionSkips: number;
    readonly maximumTurns: number;
    readonly maximumTransitions: number;
    readonly semanticNoProgress: number;
  }>;
  readonly eventCounts: Readonly<Record<string, number>>;
  readonly moveUses: Readonly<Record<string, number>>;
  readonly itemUses: Readonly<Record<string, number>>;
  readonly statusCounts: Readonly<Record<string, number>>;
  readonly perDieOutcomes: Readonly<Record<string, number>>;
  readonly orientationCounts: Readonly<Record<"original" | "mirrored", number>>;
  readonly policyCounts: Readonly<Record<string, number>>;
  readonly observability: Readonly<{
    readonly diagnosticFights: number;
    readonly summaryOnlyFights: number;
  }>;
  readonly metricHash: string;
}

export const simulationMoveMetricsSchema = z
  .object({
    schemaVersion: z.literal(SIMULATION_MOVE_METRICS_SCHEMA_VERSION),
    moveId: z.string().min(1),
    population: z.enum(["natural", "isolation", "forced"]),
    completedFights: nonNegativeInteger,
    errorCount: nonNegativeInteger,
    wins: z
      .object({ a: nonNegativeInteger, b: nonNegativeInteger, draw: nonNegativeInteger })
      .strict(),
    fightLength: meanVarianceSchema,
    remainingResources: z.object({ a: meansFor(), b: meansFor() }).strict(),
    damage: z.object({ a: meanVarianceSchema, b: meanVarianceSchema }).strict(),
    overkill: z.object({ a: meanVarianceSchema, b: meanVarianceSchema }).strict(),
    kiEfficiency: meanVarianceSchema,
    actionEconomy: z
      .object({
        actorActions: meanVarianceSchema,
        pendingResponses: meanVarianceSchema,
        completedActions: meanVarianceSchema,
        skippedActions: nonNegativeInteger,
      })
      .strict(),
    attackOutcomes: z
      .object({
        attempted: nonNegativeInteger,
        successful: nonNegativeInteger,
        stopped: nonNegativeInteger,
        critical: nonNegativeInteger,
        counter: nonNegativeInteger,
      })
      .strict(),
    statuses: z
      .object({
        applied: nonNegativeInteger,
        removed: nonNegativeInteger,
        rolled: nonNegativeInteger,
        lockoutEvents: nonNegativeInteger,
      })
      .strict(),
    transformations: z
      .object({
        activated: nonNegativeInteger,
        deactivated: nonNegativeInteger,
        rolled: nonNegativeInteger,
        cooldownsStarted: nonNegativeInteger,
      })
      .strict(),
    restrictedUse: z
      .object({
        moveUses: nonNegativeInteger,
        limitChanges: nonNegativeInteger,
        movesRemoved: nonNegativeInteger,
      })
      .strict(),
    sequences: z
      .object({
        deferredScheduled: nonNegativeInteger,
        deferredCancelled: nonNegativeInteger,
        deferredPerformed: nonNegativeInteger,
        counterChainLimits: nonNegativeInteger,
      })
      .strict(),
    stalls: z
      .object({
        actionSkips: nonNegativeInteger,
        maximumTurns: nonNegativeInteger,
        maximumTransitions: nonNegativeInteger,
        semanticNoProgress: nonNegativeInteger,
      })
      .strict(),
    eventCounts: counterRecordSchema,
    moveUses: counterRecordSchema,
    itemUses: counterRecordSchema,
    statusCounts: counterRecordSchema,
    perDieOutcomes: counterRecordSchema,
    orientationCounts: z
      .object({ original: nonNegativeInteger, mirrored: nonNegativeInteger })
      .strict(),
    policyCounts: counterRecordSchema,
    observability: z
      .object({ diagnosticFights: nonNegativeInteger, summaryOnlyFights: nonNegativeInteger })
      .strict(),
    metricHash: z.string().min(1),
  })
  .strict();

const emptyResources = () => ({
  hp: createSimulationMeanVariance(),
  ki: createSimulationMeanVariance(),
});

const metricWithoutHash = (moveId: string, population: SimulationMoveCoveragePopulation) => ({
  schemaVersion: SIMULATION_MOVE_METRICS_SCHEMA_VERSION,
  moveId,
  population,
  completedFights: 0,
  errorCount: 0,
  wins: { a: 0, b: 0, draw: 0 },
  fightLength: createSimulationMeanVariance(),
  remainingResources: { a: emptyResources(), b: emptyResources() },
  damage: { a: createSimulationMeanVariance(), b: createSimulationMeanVariance() },
  overkill: { a: createSimulationMeanVariance(), b: createSimulationMeanVariance() },
  kiEfficiency: createSimulationMeanVariance(),
  actionEconomy: {
    actorActions: createSimulationMeanVariance(),
    pendingResponses: createSimulationMeanVariance(),
    completedActions: createSimulationMeanVariance(),
    skippedActions: 0,
  },
  attackOutcomes: { attempted: 0, successful: 0, stopped: 0, critical: 0, counter: 0 },
  statuses: { applied: 0, removed: 0, rolled: 0, lockoutEvents: 0 },
  transformations: { activated: 0, deactivated: 0, rolled: 0, cooldownsStarted: 0 },
  restrictedUse: { moveUses: 0, limitChanges: 0, movesRemoved: 0 },
  sequences: {
    deferredScheduled: 0,
    deferredCancelled: 0,
    deferredPerformed: 0,
    counterChainLimits: 0,
  },
  stalls: { actionSkips: 0, maximumTurns: 0, maximumTransitions: 0, semanticNoProgress: 0 },
  eventCounts: {},
  moveUses: {},
  itemUses: {},
  statusCounts: {},
  perDieOutcomes: {},
  orientationCounts: { original: 0, mirrored: 0 },
  policyCounts: {},
  observability: { diagnosticFights: 0, summaryOnlyFights: 0 },
});

const withHash = (metric: ReturnType<typeof metricWithoutHash>): SimulationMoveMetrics =>
  simulationMoveMetricsSchema.parse({ ...metric, metricHash: canonicalHash(metric) });

export const createSimulationMoveMetrics = (
  moveId: string,
  population: SimulationMoveCoveragePopulation,
): SimulationMoveMetrics => withHash(metricWithoutHash(moveId, population));

const incrementRecord = (record: Readonly<Record<string, number>>, key: string, amount = 1) => ({
  ...record,
  [key]: (record[key] ?? 0) + amount,
});

const mergeRecords = (
  left: Readonly<Record<string, number>>,
  right: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> => {
  const result: Record<string, number> = { ...left };
  for (const [key, value] of Object.entries(right)) result[key] = (result[key] ?? 0) + value;
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
};

const sum = (left: number, right: number): number => left + right;

const mergeMeans = (left: SimulationMeanVariance, right: SimulationMeanVariance) =>
  mergeSimulationMeanVariances(left, right);

const combatantIdsFor = (state: FightState): readonly [string | undefined, string | undefined] => {
  const ids = Object.keys(state.combatants);
  return [ids[0], ids[1]];
};

const winnerFor = (
  result: SimulationFightExecutionResult,
  aId: string | undefined,
  bId: string | undefined,
): "a" | "b" | "draw" => {
  const winner = result.completion?.winnerCombatantId;
  if (winner === aId) return "a";
  if (winner === bId) return "b";
  return "draw";
};

const eventsFor = (result: SimulationFightExecutionResult): readonly CombatEvent[] =>
  result.transitions.flatMap((transition) => transition.events);

/* eslint-disable sonarjs/cognitive-complexity, complexity -- These helpers fold the finite combat event vocabulary into metric counters. */
const overkillFor = (
  result: SimulationFightExecutionResult,
): Readonly<{ readonly a: number; readonly b: number }> => {
  const [aId, bId] = combatantIdsFor(result.finalState);
  const initialState = result.transitions[0]?.state ?? result.finalState;
  const hp: Record<string, number> = Object.fromEntries(
    Object.values(initialState.combatants).map((combatant) => [
      combatant.id,
      combatant.hitPoints.current,
    ]),
  );
  const overkill = { a: 0, b: 0 };
  for (const transition of result.transitions) {
    for (const event of transition.events) {
      const facts = event as unknown as Record<string, unknown>;
      if (facts.type === "damage-applied") {
        const target = typeof facts.targetCombatantId === "string" ? facts.targetCombatantId : "";
        const amount = typeof facts.amount === "number" ? facts.amount : 0;
        const before = hp[target] ?? 0;
        const value = Math.max(0, amount - before);
        if (target === bId) overkill.a += value;
        if (target === aId) overkill.b += value;
        if (typeof facts.remainingHitPoints === "number") hp[target] = facts.remainingHitPoints;
      } else if (
        facts.type === "hp-changed" &&
        typeof facts.targetCombatantId === "string" &&
        typeof facts.remainingHitPoints === "number"
      ) {
        hp[facts.targetCombatantId] = facts.remainingHitPoints;
      }
    }
  }
  return overkill;
};

const eventMetricCountsFor = (events: readonly CombatEvent[]) => {
  const counts = {
    attackOutcomes: { attempted: 0, successful: 0, stopped: 0, critical: 0, counter: 0 },
    statuses: { applied: 0, removed: 0, rolled: 0, lockoutEvents: 0 },
    transformations: { activated: 0, deactivated: 0, rolled: 0, cooldownsStarted: 0 },
    restrictedUse: { moveUses: 0, limitChanges: 0, movesRemoved: 0 },
    sequences: {
      deferredScheduled: 0,
      deferredCancelled: 0,
      deferredPerformed: 0,
      counterChainLimits: 0,
    },
    stalls: { actionSkips: 0, maximumTurns: 0, maximumTransitions: 0, semanticNoProgress: 0 },
    eventCounts: {} as Record<string, number>,
    statusCounts: {} as Record<string, number>,
    kiSpent: 0,
    kiGained: 0,
  };
  for (const event of events) {
    const type = event.type;
    counts.eventCounts = incrementRecord(counts.eventCounts, type);
    if (type === "attack-resolved") {
      counts.attackOutcomes.attempted += 1;
      counts.attackOutcomes[event.outcome] += 1;
      if (event.critical) counts.attackOutcomes.critical += 1;
      if (event.counter) counts.attackOutcomes.counter += 1;
    }
    if (type === "status-applied") {
      counts.statuses.applied += 1;
      counts.statusCounts = incrementRecord(counts.statusCounts, event.statusId);
    }
    if (type === "status-removed") counts.statuses.removed += 1;
    if (type === "status-rolled") counts.statuses.rolled += 1;
    if (type === "action-skipped") {
      counts.statuses.lockoutEvents += 1;
      counts.stalls.actionSkips += 1;
    }
    if (type === "transformation-activated") counts.transformations.activated += 1;
    if (type === "transformation-deactivated") counts.transformations.deactivated += 1;
    if (type === "transformation-rolled") counts.transformations.rolled += 1;
    if (type === "transformation-cooldown-started") counts.transformations.cooldownsStarted += 1;
    if (type === "move-used") counts.restrictedUse.moveUses += 1;
    if (type === "move-use-limit-changed") counts.restrictedUse.limitChanges += 1;
    if (type === "move-removed-from-combat") {
      counts.restrictedUse.movesRemoved += 1;
      counts.statuses.lockoutEvents += 1;
    }
    if (type === "deferred-move-scheduled") counts.sequences.deferredScheduled += 1;
    if (type === "deferred-move-cancelled") counts.sequences.deferredCancelled += 1;
    if (type === "deferred-move-performed") counts.sequences.deferredPerformed += 1;
    if (type === "counter-chain-limit-reached") counts.sequences.counterChainLimits += 1;
    if (type === "ki-changed") {
      if (event.amount < 0) counts.kiSpent += -event.amount;
      else counts.kiGained += event.amount;
    }
  }
  return counts;
};
/* eslint-enable sonarjs/cognitive-complexity, complexity */

export interface SimulationMoveMetricObservation {
  readonly result: SimulationFightExecutionResult;
  readonly mirror: "original" | "mirrored";
  readonly policy: string;
}

export const addSimulationMoveMetricObservation = (
  metric: SimulationMoveMetrics,
  observation: SimulationMoveMetricObservation,
): SimulationMoveMetrics => {
  const { result, mirror, policy } = observation;
  const [aId, bId] = combatantIdsFor(result.finalState);
  const a = Object.values(result.finalState.combatants).find((combatant) => combatant.id === aId);
  const b = Object.values(result.finalState.combatants).find((combatant) => combatant.id === bId);
  const eventCounts = eventMetricCountsFor(eventsFor(result));
  const overkill = overkillFor(result);
  const damageA = bId === undefined ? 0 : (result.summary.damageByCombatant[bId] ?? 0);
  const damageB = aId === undefined ? 0 : (result.summary.damageByCombatant[aId] ?? 0);
  const next = {
    ...metric,
    completedFights: metric.completedFights + 1,
    wins: {
      ...metric.wins,
      [winnerFor(result, aId, bId)]: metric.wins[winnerFor(result, aId, bId)] + 1,
    },
    fightLength: addSimulationValue(metric.fightLength, result.finalState.turnNumber),
    remainingResources: {
      a: {
        hp: addSimulationValue(metric.remainingResources.a.hp, a?.hitPoints.current ?? 0),
        ki: addSimulationValue(metric.remainingResources.a.ki, a?.ki.current ?? 0),
      },
      b: {
        hp: addSimulationValue(metric.remainingResources.b.hp, b?.hitPoints.current ?? 0),
        ki: addSimulationValue(metric.remainingResources.b.ki, b?.ki.current ?? 0),
      },
    },
    damage: {
      a: addSimulationValue(metric.damage.a, damageA),
      b: addSimulationValue(metric.damage.b, damageB),
    },
    overkill: {
      a: addSimulationValue(metric.overkill.a, overkill.a),
      b: addSimulationValue(metric.overkill.b, overkill.b),
    },
    kiEfficiency:
      eventCounts.kiSpent > 0
        ? addSimulationValue(metric.kiEfficiency, (damageA + damageB) / eventCounts.kiSpent)
        : metric.kiEfficiency,
    actionEconomy: {
      actorActions: addSimulationValue(
        metric.actionEconomy.actorActions,
        result.summary.actorActions,
      ),
      pendingResponses: addSimulationValue(
        metric.actionEconomy.pendingResponses,
        result.summary.pendingResponses,
      ),
      completedActions: addSimulationValue(
        metric.actionEconomy.completedActions,
        result.summary.completedActions,
      ),
      skippedActions: metric.actionEconomy.skippedActions + eventCounts.stalls.actionSkips,
    },
    attackOutcomes: {
      attempted: metric.attackOutcomes.attempted + eventCounts.attackOutcomes.attempted,
      successful: metric.attackOutcomes.successful + eventCounts.attackOutcomes.successful,
      stopped: metric.attackOutcomes.stopped + eventCounts.attackOutcomes.stopped,
      critical: metric.attackOutcomes.critical + eventCounts.attackOutcomes.critical,
      counter: metric.attackOutcomes.counter + eventCounts.attackOutcomes.counter,
    },
    statuses: {
      applied: metric.statuses.applied + eventCounts.statuses.applied,
      removed: metric.statuses.removed + eventCounts.statuses.removed,
      rolled: metric.statuses.rolled + eventCounts.statuses.rolled,
      lockoutEvents: metric.statuses.lockoutEvents + eventCounts.statuses.lockoutEvents,
    },
    transformations: {
      activated: metric.transformations.activated + eventCounts.transformations.activated,
      deactivated: metric.transformations.deactivated + eventCounts.transformations.deactivated,
      rolled: metric.transformations.rolled + eventCounts.transformations.rolled,
      cooldownsStarted:
        metric.transformations.cooldownsStarted + eventCounts.transformations.cooldownsStarted,
    },
    restrictedUse: {
      moveUses: metric.restrictedUse.moveUses + eventCounts.restrictedUse.moveUses,
      limitChanges: metric.restrictedUse.limitChanges + eventCounts.restrictedUse.limitChanges,
      movesRemoved: metric.restrictedUse.movesRemoved + eventCounts.restrictedUse.movesRemoved,
    },
    sequences: {
      deferredScheduled:
        metric.sequences.deferredScheduled + eventCounts.sequences.deferredScheduled,
      deferredCancelled:
        metric.sequences.deferredCancelled + eventCounts.sequences.deferredCancelled,
      deferredPerformed:
        metric.sequences.deferredPerformed + eventCounts.sequences.deferredPerformed,
      counterChainLimits:
        metric.sequences.counterChainLimits + eventCounts.sequences.counterChainLimits,
    },
    stalls: {
      actionSkips: metric.stalls.actionSkips + eventCounts.stalls.actionSkips,
      maximumTurns:
        metric.stalls.maximumTurns + (result.terminationReason === "maximum-turns" ? 1 : 0),
      maximumTransitions:
        metric.stalls.maximumTransitions +
        (result.terminationReason === "maximum-transitions" ? 1 : 0),
      semanticNoProgress:
        metric.stalls.semanticNoProgress +
        (result.terminationReason === "semantic-no-progress" ? 1 : 0),
    },
    eventCounts: mergeRecords(metric.eventCounts, eventCounts.eventCounts),
    moveUses: mergeRecords(metric.moveUses, result.summary.moveUses),
    itemUses: mergeRecords(metric.itemUses, result.summary.itemUses),
    statusCounts: mergeRecords(metric.statusCounts, eventCounts.statusCounts),
    perDieOutcomes: mergeRecords(metric.perDieOutcomes, result.summary.perDieOutcomes),
    orientationCounts: {
      ...metric.orientationCounts,
      [mirror]: metric.orientationCounts[mirror] + 1,
    },
    policyCounts: incrementRecord(metric.policyCounts, policy),
    observability: {
      diagnosticFights:
        metric.observability.diagnosticFights + (result.transitions.length > 0 ? 1 : 0),
      summaryOnlyFights:
        metric.observability.summaryOnlyFights + (result.transitions.length === 0 ? 1 : 0),
    },
  } satisfies Omit<SimulationMoveMetrics, "metricHash"> & { metricHash: string };
  return withHash(next);
};

export const markSimulationMoveMetricError = (
  metric: SimulationMoveMetrics,
): SimulationMoveMetrics => withHash({ ...metric, errorCount: metric.errorCount + 1 });

export const mergeSimulationMoveMetrics = (
  left: SimulationMoveMetrics,
  right: SimulationMoveMetrics,
): SimulationMoveMetrics => {
  if (left.moveId !== right.moveId || left.population !== right.population)
    throw new RangeError("Move metrics must have matching move and population identities.");
  return withHash({
    ...left,
    completedFights: sum(left.completedFights, right.completedFights),
    errorCount: sum(left.errorCount, right.errorCount),
    wins: {
      a: sum(left.wins.a, right.wins.a),
      b: sum(left.wins.b, right.wins.b),
      draw: sum(left.wins.draw, right.wins.draw),
    },
    fightLength: mergeMeans(left.fightLength, right.fightLength),
    remainingResources: {
      a: {
        hp: mergeMeans(left.remainingResources.a.hp, right.remainingResources.a.hp),
        ki: mergeMeans(left.remainingResources.a.ki, right.remainingResources.a.ki),
      },
      b: {
        hp: mergeMeans(left.remainingResources.b.hp, right.remainingResources.b.hp),
        ki: mergeMeans(left.remainingResources.b.ki, right.remainingResources.b.ki),
      },
    },
    damage: {
      a: mergeMeans(left.damage.a, right.damage.a),
      b: mergeMeans(left.damage.b, right.damage.b),
    },
    overkill: {
      a: mergeMeans(left.overkill.a, right.overkill.a),
      b: mergeMeans(left.overkill.b, right.overkill.b),
    },
    kiEfficiency: mergeMeans(left.kiEfficiency, right.kiEfficiency),
    actionEconomy: {
      actorActions: mergeMeans(left.actionEconomy.actorActions, right.actionEconomy.actorActions),
      pendingResponses: mergeMeans(
        left.actionEconomy.pendingResponses,
        right.actionEconomy.pendingResponses,
      ),
      completedActions: mergeMeans(
        left.actionEconomy.completedActions,
        right.actionEconomy.completedActions,
      ),
      skippedActions: sum(left.actionEconomy.skippedActions, right.actionEconomy.skippedActions),
    },
    attackOutcomes: {
      attempted: sum(left.attackOutcomes.attempted, right.attackOutcomes.attempted),
      successful: sum(left.attackOutcomes.successful, right.attackOutcomes.successful),
      stopped: sum(left.attackOutcomes.stopped, right.attackOutcomes.stopped),
      critical: sum(left.attackOutcomes.critical, right.attackOutcomes.critical),
      counter: sum(left.attackOutcomes.counter, right.attackOutcomes.counter),
    },
    statuses: {
      applied: sum(left.statuses.applied, right.statuses.applied),
      removed: sum(left.statuses.removed, right.statuses.removed),
      rolled: sum(left.statuses.rolled, right.statuses.rolled),
      lockoutEvents: sum(left.statuses.lockoutEvents, right.statuses.lockoutEvents),
    },
    transformations: {
      activated: sum(left.transformations.activated, right.transformations.activated),
      deactivated: sum(left.transformations.deactivated, right.transformations.deactivated),
      rolled: sum(left.transformations.rolled, right.transformations.rolled),
      cooldownsStarted: sum(
        left.transformations.cooldownsStarted,
        right.transformations.cooldownsStarted,
      ),
    },
    restrictedUse: {
      moveUses: sum(left.restrictedUse.moveUses, right.restrictedUse.moveUses),
      limitChanges: sum(left.restrictedUse.limitChanges, right.restrictedUse.limitChanges),
      movesRemoved: sum(left.restrictedUse.movesRemoved, right.restrictedUse.movesRemoved),
    },
    sequences: {
      deferredScheduled: sum(left.sequences.deferredScheduled, right.sequences.deferredScheduled),
      deferredCancelled: sum(left.sequences.deferredCancelled, right.sequences.deferredCancelled),
      deferredPerformed: sum(left.sequences.deferredPerformed, right.sequences.deferredPerformed),
      counterChainLimits: sum(
        left.sequences.counterChainLimits,
        right.sequences.counterChainLimits,
      ),
    },
    stalls: {
      actionSkips: sum(left.stalls.actionSkips, right.stalls.actionSkips),
      maximumTurns: sum(left.stalls.maximumTurns, right.stalls.maximumTurns),
      maximumTransitions: sum(left.stalls.maximumTransitions, right.stalls.maximumTransitions),
      semanticNoProgress: sum(left.stalls.semanticNoProgress, right.stalls.semanticNoProgress),
    },
    eventCounts: mergeRecords(left.eventCounts, right.eventCounts),
    moveUses: mergeRecords(left.moveUses, right.moveUses),
    itemUses: mergeRecords(left.itemUses, right.itemUses),
    statusCounts: mergeRecords(left.statusCounts, right.statusCounts),
    perDieOutcomes: mergeRecords(left.perDieOutcomes, right.perDieOutcomes),
    orientationCounts: {
      original: sum(left.orientationCounts.original, right.orientationCounts.original),
      mirrored: sum(left.orientationCounts.mirrored, right.orientationCounts.mirrored),
    },
    policyCounts: mergeRecords(left.policyCounts, right.policyCounts),
    observability: {
      diagnosticFights: sum(
        left.observability.diagnosticFights,
        right.observability.diagnosticFights,
      ),
      summaryOnlyFights: sum(
        left.observability.summaryOnlyFights,
        right.observability.summaryOnlyFights,
      ),
    },
  });
};
