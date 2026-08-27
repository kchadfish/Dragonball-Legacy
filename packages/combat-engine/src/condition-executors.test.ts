import {
  MOVE_DEFINITIONS,
  type EffectCondition,
  type EffectDefinition,
} from "@dragonball-resurgence/game-data";
import { describe, expect, it } from "vitest";

import {
  combatTriggers,
  conditionExecutorCapabilities,
  conditionIsAvailableAtTrigger,
} from "./condition-executors.js";
import { compileEffectPlan } from "./effect-executors.js";
import { conditionContextViews, effectConditionsMatch } from "./move-effects-runtime.js";

const conditionTypes = [
  "combat-result",
  "combat-outcome",
  "roll-threshold",
  "perfect-roll",
  "roll-comparison",
  "roll-die-result",
  "roll-die-threshold",
  "roll-modification",
  "stored-roll-match",
  "stored-roll-threshold",
  "stored-move-selection",
  "move-selector",
  "moveset",
  "moveset-move-count",
  "prior-action",
  "no-prior-action",
  "action-sequence",
  "active-move-count",
  "prior-turn-restriction",
  "location",
  "target-relation",
  "status",
  "move-effect-active",
  "move-effect-inactive",
  "activation-unavailable",
  "incoming-damage",
  "successful-hit-count",
  "stopped-hit-fraction",
  "attack-roll-resolution",
  "move-use-count",
  "defense-response",
  "combat-state",
  "combat-context",
  "combat-turn",
  "transformation-mastery",
  "resource-threshold",
  "resource-comparison",
  "resource-change",
  "move-modification",
  "stat-comparison",
  "level-comparison",
  "paid-ki-cost",
] as const satisfies readonly EffectCondition["type"][];

const self = {
  id: "combatant:self" as never,
  hitPoints: { current: 50, maximum: 100 },
  ki: { current: 5, maximum: 10 },
  stats: { power: 20, dexterity: 5, dexterityBonus: 0 },
  moveIds: [],
  moveUses: {},
  storedRolls: {},
  activeStatuses: [],
  status: "active" as const,
};
const opponent = { ...self, id: "combatant:opponent" as never };
const baseContext = {
  self,
  opponent,
  turnNumber: 1,
  completedTurnCount: 0,
  moves: new Map(MOVE_DEFINITIONS.map((move) => [move.id, move])),
  moveActivationCounts: new Map<string, number>(),
  successfulHitCount: 0,
};

describe("condition executor registry", () => {
  it("accounts exhaustively for every condition and combat trigger discriminant", () => {
    expect(Object.keys(conditionExecutorCapabilities).sort()).toEqual([...conditionTypes].sort());
    expect(new Set(combatTriggers).size).toBe(combatTriggers.length);
  });

  it("exposes durable, resolution-local, and stored views over authoritative context", () => {
    const context = {
      ...baseContext,
      rolls: [{ attackNaturalResult: 4, attackResult: 4, outcome: "stopped" as const }],
      selectedNumericValues: { amount: 2 },
    };
    const views = conditionContextViews(context);

    expect(views.durable.self).toBe(context.self);
    expect(views.resolutionLocal.rolls).toBe(context.rolls);
    expect(views.stored.selectedNumericValues).toBe(context.selectedNumericValues);
  });

  it("uses the shared registry to reject a trigger that cannot supply a condition", () => {
    const source = MOVE_DEFINITIONS.find((move) => move.id === "move-afterlife-light-grenade");
    const original = source?.effects?.[0];
    if (source === undefined || original === undefined)
      throw new Error("Expected Light Grenade test definition.");
    const effect = {
      ...original,
      trigger: "start-combat",
      conditions: [
        {
          type: "incoming-damage",
          subject: "self",
          comparison: "at-least",
          value: { type: "literal", value: 1 },
          sourceText: "test condition",
        },
      ],
    } as EffectDefinition;

    expect(conditionIsAvailableAtTrigger(effect.conditions![0]!, effect.trigger)).toBe(false);
    expect(
      compileEffectPlan({ sourceDefinitionId: source.id, effectIndex: 0, effect }),
    ).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: "unsupported-condition" })],
    });
  });

  it("implements single-die and all-dice stopped semantics with actor perspective", () => {
    const condition = {
      type: "attack-roll-resolution",
      actor: "self",
      anyOf: ["single-die-stopped", "all-dice-stopped"],
      sourceText: "stopped attack",
    } as const satisfies EffectCondition;
    const stopped = { attackNaturalResult: 5, attackResult: 5, outcome: "stopped" as const };
    const successful = {
      attackNaturalResult: 20,
      attackResult: 20,
      outcome: "successful" as const,
    };

    expect(effectConditionsMatch([condition], { ...baseContext, rolls: [stopped] })).toBe(true);
    expect(effectConditionsMatch([condition], { ...baseContext, rolls: [stopped, stopped] })).toBe(
      true,
    );
    expect(
      effectConditionsMatch([condition], { ...baseContext, rolls: [stopped, successful] }),
    ).toBe(false);
    expect(
      effectConditionsMatch([{ ...condition, actor: "opponent" }], {
        ...baseContext,
        rolls: [stopped],
      }),
    ).toBe(false);
  });

  it("distinguishes unavailable required context from a normal false condition", () => {
    const condition = {
      type: "incoming-damage",
      subject: "self",
      comparison: "at-least",
      value: { type: "literal", value: 1 },
      sourceText: "incoming damage",
    } as const satisfies EffectCondition;

    expect(() =>
      effectConditionsMatch([condition], { ...baseContext, requireConditionContext: true }),
    ).toThrow(/requires unavailable context: incoming-damage/u);
    expect(
      effectConditionsMatch([condition], {
        ...baseContext,
        requireConditionContext: true,
        incomingDamage: 0,
      }),
    ).toBe(false);
  });
});
