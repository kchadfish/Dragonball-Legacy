import { describe, expect, it } from "vitest";

import { MOVE_DEFINITIONS } from "@dragonball-resurgence/game-data";

import type { CombatantState } from "./contracts.js";
import { evaluateDurableNumericExpression, matchesMoveSelector } from "./index.js";
import { combatantIdSchema } from "./ids.js";

const selfId = combatantIdSchema.parse("combatant:runtime-self");
const opponentId = combatantIdSchema.parse("combatant:runtime-opponent");

const combatant = (id: typeof selfId, power: number, dexterityBonus: number): CombatantState => ({
  id,
  hitPoints: { current: 50, maximum: 100 },
  ki: { current: 4, maximum: 10 },
  stats: { power, dexterity: 5, dexterityBonus },
  moveIds: ["move-akaikaru-firestorm", "move-akaikaru-blown-fuse"],
  moveUses: {},
  activeStatuses: [],
  status: "active",
});

const moveMap = new Map(MOVE_DEFINITIONS.map((move) => [move.id, move]));

describe("declarative move runtime", () => {
  it("evaluates durable numeric expressions from authoritative fight state", () => {
    const self = combatant(selfId, 35, 3);
    const opponent = combatant(opponentId, 20, -1);
    const context = {
      self,
      opponent,
      turnNumber: 4,
      participantCount: 2,
      completedTurnCount: 3,
      moves: moveMap,
      moveActivationCounts: new Map([["move-akaikaru-firestorm", 2]]),
    };

    expect(
      evaluateDurableNumericExpression(
        { type: "stat-percent", subject: "self", stat: "power", percent: 20 },
        context,
      ),
    ).toBe(7);
    expect(
      evaluateDurableNumericExpression(
        { type: "resource-percent", subject: "self", resource: "hp", basis: "total", percent: 15 },
        context,
      ),
    ).toBe(15);
    expect(
      evaluateDurableNumericExpression(
        { type: "moveset-move-count", subject: "self", category: "advanced-attack" },
        context,
      ),
    ).toBe(2);
    expect(
      evaluateDurableNumericExpression(
        { type: "moveset-tag-count", subject: "self", tag: "energy", perMove: 2, maximum: 3 },
        context,
      ),
    ).toBe(3);
    expect(
      evaluateDurableNumericExpression(
        { type: "move-activation-count", moveId: "move-akaikaru-firestorm", perActivation: 3 },
        context,
      ),
    ).toBe(6);
    expect(
      evaluateDurableNumericExpression(
        { type: "paid-activation-cost", resource: "ki" },
        { ...context, paidActivationCost: 4 },
      ),
    ).toBe(4);
    expect(
      evaluateDurableNumericExpression({ type: "prior-roll-result", roll: "attack" }, context),
    ).toBeUndefined();

    expect(
      evaluateDurableNumericExpression(
        { type: "prior-roll-result", roll: "defense", multiplier: 2 },
        {
          ...context,
          actionHistory: [
            {
              type: "use-move",
              decisionId: "decision:prior-defense" as never,
              actorId: opponentId,
              targetCombatantId: selfId,
              moveId: "move-akaikaru-firestorm" as never,
              turnNumber: 3,
              phase: "action",
              attackRollResult: 18,
              defenseRollResult: 27,
            },
          ],
        },
      ),
    ).toBe(54);
  });

  it("evaluates active CONSTANT counts from durable effects", () => {
    const self = combatant(selfId, 35, 3);
    const opponent = combatant(opponentId, 20, -1);
    const context = {
      self,
      opponent,
      turnNumber: 4,
      participantCount: 2,
      completedTurnCount: 3,
      moves: moveMap,
      activeEffects: [
        {
          id: "active-effect:expert-swordplay" as never,
          type: "active-constant" as const,
          sourceCombatantId: selfId,
          targetCombatantId: selfId,
          sourceDefinitionId: "move-freestyle-expert-swordplay" as never,
          activatedOnTurn: 2,
          duration: "combat" as const,
        },
      ],
    };

    expect(
      evaluateDurableNumericExpression(
        {
          type: "active-move-effect-text-count",
          subject: "self",
          category: "skill",
          constant: true,
          effectTextIncludes: "Swordplay",
          perMove: 2,
        },
        context,
      ),
    ).toBe(2);
    expect(
      evaluateDurableNumericExpression(
        {
          type: "active-move-count",
          subject: "self",
          category: "skill",
          constant: true,
          perMove: 2,
        },
        context,
      ),
    ).toBe(2);
  });

  it("evaluates combat-result history without counting non-attack actions", () => {
    const self = combatant(selfId, 35, 3);
    const opponent = combatant(opponentId, 20, -1);
    const history = [
      {
        type: "use-move" as const,
        decisionId: "decision:successful-self" as never,
        actorId: selfId,
        targetCombatantId: opponentId,
        moveId: "move-akaikaru-firestorm" as never,
        outcome: "successful" as const,
        critical: false,
        counter: false,
        turnNumber: 1,
        phase: "action" as const,
      },
      {
        type: "power-up" as const,
        decisionId: "decision:power-up" as never,
        actorId: selfId,
        turnNumber: 2,
        phase: "action" as const,
      },
      {
        type: "use-move" as const,
        decisionId: "decision:stopped-self-1" as never,
        actorId: selfId,
        targetCombatantId: opponentId,
        moveId: "move-akaikaru-firestorm" as never,
        outcome: "stopped" as const,
        critical: false,
        counter: false,
        turnNumber: 3,
        phase: "action" as const,
      },
      {
        type: "use-move" as const,
        decisionId: "decision:stopped-self-2" as never,
        actorId: selfId,
        targetCombatantId: opponentId,
        moveId: "move-akaikaru-firestorm" as never,
        outcome: "stopped" as const,
        critical: false,
        counter: true,
        turnNumber: 4,
        phase: "action" as const,
      },
    ];
    const context = {
      self,
      opponent,
      turnNumber: 5,
      participantCount: 2,
      completedTurnCount: 4,
      moves: moveMap,
      actionHistory: history,
    };

    expect(
      evaluateDurableNumericExpression(
        {
          type: "consecutive-combat-results",
          actor: "self",
          result: "stopped",
          resetBy: "successful",
          perResult: 5,
          maximum: 8,
        },
        context,
      ),
    ).toBe(8);
    expect(
      evaluateDurableNumericExpression(
        { type: "combat-result-count", actor: "self", result: "counter", perResult: 1 },
        context,
      ),
    ).toBe(1);
    expect(
      evaluateDurableNumericExpression(
        {
          type: "combat-result-count",
          actor: "self",
          result: "successful",
          perResult: 5,
          minimum: 5,
          maximum: 15,
        },
        context,
      ),
    ).toBe(5);
  });

  it("matches converted selectors without using source text as executable behavior", () => {
    const firestorm = moveMap.get("move-akaikaru-firestorm");
    const blownFuse = moveMap.get("move-akaikaru-blown-fuse");
    if (firestorm === undefined || blownFuse === undefined)
      throw new Error("Expected converted moves.");

    expect(
      matchesMoveSelector(firestorm, {
        type: "move-selector",
        subject: "target",
        category: "advanced-attack",
        tags: ["energy", "volley"],
        attackRoll: { dice: 3, sides: 30 },
        baseKiCost: { comparison: "exactly", value: { type: "literal", value: 1 } },
        sourceText: "test",
      }),
    ).toBe(true);
    expect(
      matchesMoveSelector(blownFuse, {
        type: "move-selector",
        subject: "target",
        restriction: "restricted",
        sourceText: "test",
      }),
    ).toBe(false);
  });
});
