import { MOVE_DEFINITIONS } from "@dragonball-resurgence/game-data";
import type { MoveDefinition } from "@dragonball-resurgence/game-data";
import { describe, expect, it } from "vitest";

import {
  adjustedMoveDamage,
  moveEffectsForTrigger,
  stoppedMoveEffects,
  successfulMoveEffects,
} from "./move-effects-runtime.js";

const self = {
  id: "combatant:self" as never,
  hitPoints: { current: 50, maximum: 100 },
  ki: { current: 5, maximum: 10 },
  stats: { power: 20, dexterity: 5, dexterityBonus: 0 },
  moveIds: ["move-afterlife-spirit-bomb"],
  moveUses: {},
  activeStatuses: [],
  status: "active" as const,
};
const opponent = { ...self, id: "combatant:opponent" as never };
const moves = new Map(MOVE_DEFINITIONS.map((move) => [move.id, move]));
const context = {
  self,
  opponent,
  turnNumber: 5,
  completedTurnCount: 4,
  moves,
  moveActivationCounts: new Map([["move-afterlife-give-me-energy", 2]]),
  successfulHitCount: 4,
};

describe("converted move effects", () => {
  it("applies a converted passive damage expression using durable activation history", () => {
    const move = moves.get("move-afterlife-spirit-bomb");
    if (move === undefined) throw new Error("Expected Spirit Bomb data.");

    expect(adjustedMoveDamage(move, 20, context)).toBe(30);
  });

  it("emits converted successful resource and status changes when their condition matches", () => {
    const lightGrenade = moves.get("move-afterlife-light-grenade");
    const meteorSmash = moves.get("move-afterlife-meteor-smash");
    if (lightGrenade === undefined || meteorSmash === undefined)
      throw new Error("Expected move data.");

    expect(successfulMoveEffects(lightGrenade, context).resources).toEqual([
      { resource: "hp", target: "self", operation: "gain", amount: 5 },
    ]);
    expect(successfulMoveEffects(meteorSmash, context).statuses).toEqual([
      expect.objectContaining({
        target: "opponent",
        status: expect.objectContaining({ statusId: "stun" }),
      }),
    ]);
  });

  it("serializes converted locks with their declarative selector and duration", () => {
    const dodonRay = moves.get("move-afterlife-dodon-ray");
    if (dodonRay === undefined) throw new Error("Expected Dodon Ray data.");

    expect(successfulMoveEffects(dodonRay, context).locks).toEqual([
      expect.objectContaining({
        target: "opponent",
        affectedType: "skill",
        duration: { type: "combat" },
      }),
    ]);
  });

  it("extracts a duration-bound combat-result prevention after a successful move", () => {
    const returnFire = moves.get("move-aoyosumu-return-fire");
    if (returnFire === undefined) throw new Error("Expected Return Fire data.");

    expect(
      successfulMoveEffects(returnFire, { ...context, successfulHitCount: 1 })
        .combatResultPreventions,
    ).toEqual([
      {
        target: "opponent",
        result: "critical",
        duration: { type: "turns", remaining: 4 },
      },
    ]);
  });

  it("extracts current-roll result and side modifications before an attack roll", () => {
    const baseMove = moves.get("move-afterlife-light-grenade");
    if (baseMove === undefined) throw new Error("Expected Light Grenade data.");
    const move = {
      ...baseMove,
      effects: [
        {
          trigger: "before-attack-roll",
          target: "self",
          type: "modify-roll",
          roll: "attack",
          modifier: "result",
          amount: { type: "literal", value: 3 },
          sourceText: "Gain +3 to your attack roll.",
        },
        {
          trigger: "before-attack-roll",
          target: "self",
          type: "modify-roll",
          roll: "attack",
          modifier: "sides",
          amount: { type: "literal", value: 2 },
          sourceText: "Gain +2 attack die sides.",
        },
      ],
    } as MoveDefinition;

    expect(moveEffectsForTrigger(move, "before-attack-roll", context).rollModifications).toEqual([
      { target: "self", roll: "attack", modifier: "result", amount: 3 },
      { target: "self", roll: "attack", modifier: "sides", amount: 2 },
    ]);
  });

  it("extracts a declarative attack roll definition before random dice are consumed", () => {
    const baseMove = moves.get("move-afterlife-light-grenade");
    if (baseMove === undefined) throw new Error("Expected Light Grenade data.");
    const move = {
      ...baseMove,
      effects: [
        {
          trigger: "before-attack-roll",
          target: "self",
          type: "set-roll-definition",
          roll: "attack",
          dice: 2,
          sides: 20,
          sourceText: "Roll 2d20 instead.",
        },
      ],
    } as MoveDefinition;

    expect(moveEffectsForTrigger(move, "before-attack-roll", context).rollDefinitions).toEqual([
      { target: "self", roll: "attack", dice: 2, sides: 20 },
    ]);
  });

  it("extracts a matching-die result override without rolling again", () => {
    const baseMove = moves.get("move-afterlife-light-grenade");
    if (baseMove === undefined) throw new Error("Expected Light Grenade data.");
    const move = {
      ...baseMove,
      effects: [
        {
          trigger: "before-defense-roll",
          target: "self",
          type: "set-roll-result",
          roll: "defense",
          value: { type: "literal", value: 0 },
          resultScope: "matching-die",
          sourceText: "Set the matching defense die to zero.",
        },
      ],
    } as MoveDefinition;

    expect(moveEffectsForTrigger(move, "before-defense-roll", context).rollResultOverrides).toEqual(
      [{ target: "self", roll: "defense", value: 0, resultScope: "matching-die" }],
    );
  });

  it("serializes converted status prevention with its durable duration", () => {
    const heartPunch = moves.get("move-aoyosumu-heart-punch");
    if (heartPunch === undefined) throw new Error("Expected Heart Punch data.");

    expect(
      successfulMoveEffects(heartPunch, { ...context, successfulHitCount: 1 }).statusPreventions,
    ).toEqual([
      expect.objectContaining({
        target: "self",
        statusId: "stun",
        duration: { type: "turns", remaining: 6 },
      }),
    ]);
  });

  it("applies participant-targeted converted locks to both combatants", () => {
    const torpedoKick = moves.get("move-akaikaru-torpedo-kick");
    if (torpedoKick === undefined) throw new Error("Expected Torpedo Kick data.");

    expect(successfulMoveEffects(torpedoKick, context).locks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: "self", affectedType: "block" }),
        expect.objectContaining({ target: "opponent", affectedType: "block" }),
      ]),
    );
  });

  it("preserves a converted constant-skill deactivation as an unresolved choice", () => {
    const telekinesis = moves.get("move-afterlife-telekinesis");
    if (telekinesis === undefined) throw new Error("Expected Telekinesis data.");

    expect(
      successfulMoveEffects(telekinesis, {
        ...context,
        successfulHitCount: 1,
        rolls: [
          {
            attackNaturalResult: 20,
            attackResult: 20,
            defenseNaturalResult: 1,
            defenseResult: 1,
            outcome: "successful",
          },
        ],
      }).deactivations,
    ).toEqual([
      expect.objectContaining({
        target: "opponent",
        count: 1,
        optional: false,
        sourceDefinitionId: telekinesis.id,
      }),
    ]);
  });

  it("evaluates converted roll-threshold conditions from durable attack-roll records", () => {
    const kienzan = moves.get("move-afterlife-kienzan");
    if (kienzan === undefined) throw new Error("Expected Kienzan data.");

    const effects = successfulMoveEffects(kienzan, {
      ...context,
      successfulHitCount: 1,
      rolls: [
        {
          attackNaturalResult: 28,
          attackResult: 28,
          defenseNaturalResult: 1,
          defenseResult: 1,
          outcome: "successful",
        },
      ],
    });

    expect(effects.statuses).toEqual([
      expect.objectContaining({
        target: "opponent",
        status: expect.objectContaining({ statusId: "sever" }),
      }),
    ]);

    expect(
      successfulMoveEffects(kienzan, {
        ...context,
        successfulHitCount: 1,
        rolls: [
          {
            attackNaturalResult: 27,
            attackResult: 27,
            defenseNaturalResult: 1,
            defenseResult: 1,
            outcome: "successful",
          },
        ],
      }).statuses,
    ).toEqual([]);
  });

  it("evaluates converted roll comparison, stat, paid-cost, and resource conditions", () => {
    const hypersonicKnockout = moves.get("move-akaikaru-hypersonic-knockout");
    const spinebuster = moves.get("move-midorikatai-spinebuster");
    const eggsplosives = moves.get("move-kurokonwaku-eggsplosives");
    if (
      hypersonicKnockout === undefined ||
      spinebuster === undefined ||
      eggsplosives === undefined
    ) {
      throw new Error("Expected converted condition move data.");
    }
    const successfulRoll = {
      attackNaturalResult: 30,
      attackResult: 30,
      defenseNaturalResult: 10,
      defenseResult: 10,
      outcome: "successful" as const,
    };
    const highDexterityContext = {
      ...context,
      self: { ...self, stats: { ...self.stats, dexterityBonus: 2 } },
      opponent: { ...opponent, stats: { ...opponent.stats, dexterityBonus: 0 } },
      successfulHitCount: 1,
      rolls: [successfulRoll],
    };

    expect(successfulMoveEffects(hypersonicKnockout, highDexterityContext).statuses).toHaveLength(
      4,
    );
    expect(
      successfulMoveEffects(spinebuster, { ...highDexterityContext, paidKiCost: 4 }).statuses,
    ).toHaveLength(1);
    expect(
      successfulMoveEffects(eggsplosives, {
        ...highDexterityContext,
        opponent: { ...opponent, ki: { current: 0, maximum: 10 } },
      }).statuses,
    ).toHaveLength(1);
  });

  it("evaluates a passive mastery after-defense effect against its triggering attack", () => {
    const afterImage = moves.get("move-kurokonwaku-after-image-mastery");
    const eggsplosives = moves.get("move-kurokonwaku-eggsplosives");
    if (afterImage === undefined || eggsplosives === undefined)
      throw new Error("Expected Kurokonwaku move data.");

    expect(
      moveEffectsForTrigger(afterImage, "after-defense-roll", {
        ...context,
        triggeringMove: eggsplosives,
        rolls: [
          {
            attackNaturalResult: 20,
            attackResult: 20,
            defenseNaturalResult: 10,
            defenseResult: 10,
            outcome: "successful",
          },
        ],
      }).resources,
    ).toEqual([
      { resource: "ki", target: "opponent", operation: "drain", amount: 1 },
      { resource: "ki", target: "opponent", operation: "drain", amount: 1 },
    ]);
  });

  it("emits converted stopped-trigger resource effects", () => {
    const firewall = moves.get("move-akaikaru-firewall");
    if (firewall === undefined) throw new Error("Expected Firewall data.");

    expect(stoppedMoveEffects(firewall, { ...context, successfulHitCount: 0 }).resources).toEqual([
      { resource: "ki", target: "self", operation: "gain", amount: 1 },
    ]);
  });

  it("emits a conditioned action-phase forced-action instruction", () => {
    const opportunist = moves.get("move-aoyosumu-opportunist");
    if (opportunist === undefined) throw new Error("Expected Opportunist data.");

    expect(moveEffectsForTrigger(opportunist, "action-phase", context).forcedActions).toEqual([
      {
        target: "opponent",
        allowedCategories: ["advanced-attack", "signature"],
        allowPass: true,
      },
    ]);
    expect(
      moveEffectsForTrigger(opportunist, "action-phase", {
        ...context,
        opponent: { ...opponent, ki: { current: 4, maximum: 10 } },
      }).forcedActions,
    ).toEqual([]);
  });
});
