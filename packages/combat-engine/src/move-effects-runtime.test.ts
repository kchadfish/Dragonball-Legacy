import { MOVE_DEFINITIONS } from "@dragonball-resurgence/game-data";
import type { MoveDefinition } from "@dragonball-resurgence/game-data";
import { describe, expect, it } from "vitest";

import {
  adjustedMoveDamage,
  moveEffectsForTrigger,
  rerollEffectsAfterDefense,
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
  it("resolves the selected Straining Bodyslam activation group before the attack roll", () => {
    const move = moves.get("move-freestyle-straining-bodyslam");
    if (move === undefined) throw new Error("Expected Straining Bodyslam.");

    expect(
      moveEffectsForTrigger(move, "before-attack-roll", {
        ...context,
        self: { ...self, hitPoints: { current: 100, maximum: 100 } },
        enabledOptionalEffectIndices: [0, 1],
      }).resources,
    ).toEqual([
      expect.objectContaining({
        resource: "hp",
        target: "self",
        operation: "lose",
        amount: 10,
      }),
    ]);
  });

  it("resolves compiled after-defense rerolls without applying bonuses to the original roll", () => {
    const swiftReaction = moves.get("move-akaikaru-swift-reaction");
    const zenExplosion = moves.get("move-aoyosumu-zen-explosion");
    const secondChance = moves.get("move-kurokonwaku-second-chance");
    const tigerStrikes = moves.get("move-aoyosumu-tiger-strikes");
    const triggeringMove = moves.get("move-akaikaru-firestorm");
    if (
      swiftReaction === undefined ||
      zenExplosion === undefined ||
      secondChance === undefined ||
      tigerStrikes === undefined ||
      triggeringMove === undefined
    )
      throw new Error("Expected reroll test moves.");

    const rolls = [
      {
        attackNaturalResult: 10,
        attackResult: 10,
        defenseNaturalResult: 7,
        defenseResult: 7,
        outcome: "successful" as const,
        damage: 0,
      },
    ];
    const rerollContext = { ...context, rolls, triggeringMove };

    expect(rerollEffectsAfterDefense(swiftReaction, rerollContext)).toEqual([
      expect.objectContaining({
        sourceDefinitionId: swiftReaction.id,
        roll: "attack",
        rerollScope: "entire-attack",
        resultModifier: 0,
      }),
    ]);
    expect(rerollEffectsAfterDefense(secondChance, rerollContext)).toEqual([
      expect.objectContaining({
        sourceDefinitionId: secondChance.id,
        roll: "defense",
        rerollScope: "single-result",
        resultModifier: 5,
      }),
    ]);
    expect(rerollEffectsAfterDefense(zenExplosion, rerollContext)).toEqual([
      expect.objectContaining({
        sourceDefinitionId: zenExplosion.id,
        roll: "defense",
        requiresPriorSourceResult: "successful",
      }),
    ]);
    expect(rerollEffectsAfterDefense(tigerStrikes, rerollContext)).toEqual([]);
    expect(
      rerollEffectsAfterDefense(zenExplosion, {
        ...rerollContext,
        rolls: [{ ...rolls[0], defenseNaturalResult: 8, defenseResult: 8 }],
      }),
    ).toEqual([]);
  });

  it("emits stored-roll requests and evaluates immediate thresholds from combat state", () => {
    const healingRay = moves.get("move-haokiru-healing-ray");
    const solarFlare = moves.get("move-afterlife-solar-flare");
    if (healingRay === undefined || solarFlare === undefined)
      throw new Error("Expected stored-roll test moves.");

    expect(
      moveEffectsForTrigger(healingRay, "action-phase", {
        ...context,
        self: { ...self, moveIds: [healingRay.id] },
      }).storedRollRequests,
    ).toEqual([
      {
        target: "self",
        sourceDefinitionId: healingRay.id,
        effectIndex: 0,
        storageKey: "healing-ray-result",
        dice: 1,
        sides: 30,
      },
    ]);

    const selfWithLowRoll = {
      ...self,
      moveIds: [healingRay.id],
      storedRolls: {
        "healing-ray-result": {
          sourceDefinitionId: healingRay.id,
          storageKey: "healing-ray-result",
          naturalResults: [9],
          sides: 30,
          storedOnTurn: context.turnNumber,
        },
      },
    };
    expect(
      moveEffectsForTrigger(healingRay, "on-roll-result", {
        ...context,
        self: selfWithLowRoll,
      }).resources,
    ).toEqual([
      expect.objectContaining({ resource: "ki", operation: "gain", amount: 1, target: "self" }),
    ]);

    const solarOwner = {
      ...self,
      moveIds: [solarFlare.id],
      storedRolls: {
        "solar-flare-roll": {
          sourceDefinitionId: solarFlare.id,
          storageKey: "solar-flare-roll",
          naturalResults: [15],
          sides: 30,
          storedOnTurn: context.turnNumber,
        },
      },
    };
    expect(
      moveEffectsForTrigger(solarFlare, "on-roll-result", {
        ...context,
        self: solarOwner,
      }).statuses,
    ).toEqual([
      expect.objectContaining({
        target: "opponent",
        status: expect.objectContaining({ statusId: "stun" }),
      }),
    ]);
  });

  it("resolves reroll applications with dynamic limits and typed bonuses", () => {
    const swiftReaction = moves.get("move-akaikaru-swift-reaction");
    const secondChance = moves.get("move-kurokonwaku-second-chance");
    if (swiftReaction === undefined || secondChance === undefined)
      throw new Error("Expected reroll definitions.");

    expect(moveEffectsForTrigger(swiftReaction, "after-defense-roll", context).rerolls).toEqual([
      expect.objectContaining({
        roll: "attack",
        rerollScope: "entire-attack",
        useLimit: { scope: "combat", count: 1 },
        activationResource: "ki",
        activationCost: 1,
      }),
    ]);
    expect(moveEffectsForTrigger(secondChance, "after-defense-roll", context).rerolls).toEqual([
      expect.objectContaining({
        roll: "defense",
        rerollScope: "single-result",
        bonus: 5,
        useLimit: { scope: "combat", count: 1 },
      }),
    ]);
  });

  it("emits exact restricted-use changes and evaluates moveset exclusions", () => {
    const x20 = moves.get("move-afterlife-x20-kaioken-kamehameha");
    const breaking = moves.get("move-kurokonwaku-breaking-the-cycle");
    const superArmBar = moves.get("move-aoyosumu-super-arm-bar-takedown");
    if (x20 === undefined || breaking === undefined || superArmBar === undefined)
      throw new Error("Expected restricted-use test moves.");

    expect(successfulMoveEffects(x20, context).remainingUseModifications).toEqual([
      {
        sourceCombatantId: self.id,
        sourceDefinitionId: x20.id,
        target: "self",
        amount: 2,
        selector: expect.objectContaining({ ids: ["move-afterlife-kaio-ken"] }),
      },
    ]);

    const eligible = { ...self, moveIds: [breaking.id] };
    expect(
      moveEffectsForTrigger(breaking, "passive", { ...context, self: eligible })
        .remainingUseModifications,
    ).toHaveLength(1);
    expect(
      moveEffectsForTrigger(breaking, "passive", {
        ...context,
        self: {
          ...eligible,
          moveIds: [...eligible.moveIds, "move-kurokonwaku-concussion-shot"],
        },
      }).remainingUseModifications,
    ).toEqual([]);

    const currentAction = {
      type: "use-move" as const,
      decisionId: "decision:super-arm-bar-current" as never,
      actorId: self.id,
      targetCombatantId: opponent.id,
      moveId: superArmBar.id,
      turnNumber: context.turnNumber,
      phase: "action" as const,
      outcome: "stopped" as const,
      critical: false,
      counter: false,
    };
    expect(
      stoppedMoveEffects(superArmBar, { ...context, currentAction }).remainingUseModifications,
    ).toHaveLength(1);
    expect(
      stoppedMoveEffects(superArmBar, {
        ...context,
        actionHistory: [{ ...currentAction, decisionId: "decision:super-arm-bar-prior" as never }],
        currentAction,
      }).remainingUseModifications,
    ).toEqual([]);
  });

  it("retains scheduled numeric work and resolved lifecycle controls for its boundary", () => {
    const bombTag = moves.get("move-aoyosumu-bomb-tag");
    if (bombTag === undefined) throw new Error("Expected Bomb Tag data.");

    expect(successfulMoveEffects(bombTag, context).scheduledResources).toEqual([
      {
        target: "opponent",
        effectIndex: 0,
        timing: { type: "turn-start", subject: "opponent", turnsAfter: 2 },
        repeat: "once",
        resource: "hp",
        operation: "damage",
        amount: { type: "stat-percent", subject: "self", stat: "power", percent: 35 },
        stacking: "prevent",
        cancellation: {
          actor: "opponent",
          result: "successful",
          moveSelector: expect.objectContaining({ tags: ["physical"] }),
          target: "source",
        },
      },
    ]);
  });

  it("resolves phase-local resource expressions from typed attack context", () => {
    const energyAbsorption = moves.get("move-haokiru-energy-absorption");
    const phantomBarrage = moves.get("move-haokiru-phantom-barrage");
    const doubleArmCannon = moves.get("move-haokiru-double-arm-cannon");
    const dragonFire = moves.get("move-haokiru-dragon-fire");
    const serenityExplosion = moves.get("move-aoyosumu-serenity-explosion");
    const kiLockUp = moves.get("move-haokiru-ki-lock-up");
    const dragonBlast = moves.get("move-haokiru-dragon-blast");
    const rapture = moves.get("move-haokiru-rapture");
    if (
      energyAbsorption === undefined ||
      phantomBarrage === undefined ||
      doubleArmCannon === undefined ||
      dragonFire === undefined ||
      serenityExplosion === undefined ||
      kiLockUp === undefined ||
      dragonBlast === undefined ||
      rapture === undefined
    )
      throw new Error("Expected phase-local resource test moves.");

    const triggering = { triggeringMove: dragonBlast, triggeringMoveOwner: "opponent" as const };
    expect(
      stoppedMoveEffects(energyAbsorption, {
        ...context,
        ...triggering,
        rolls: [
          {
            attackNaturalResult: 20,
            attackResult: 20,
            defenseNaturalResult: 20,
            defenseResult: 20,
            outcome: "stopped",
          },
        ],
      }).resources,
    ).toEqual([expect.objectContaining({ resource: "ki", amount: 1 })]);
    expect(
      successfulMoveEffects(phantomBarrage, {
        ...context,
        triggeringMove: phantomBarrage,
        triggeringMoveOwner: "self",
        successfulHitCount: 3,
      }).resources,
    ).toEqual([expect.objectContaining({ resource: "hp", amount: 3 })]);
    expect(
      successfulMoveEffects(doubleArmCannon, { ...context, successfulHitCount: 2 }).resources,
    ).toEqual([expect.objectContaining({ resource: "hp", amount: 10 })]);
    expect(
      successfulMoveEffects(dragonFire, {
        ...context,
        rolls: [
          { attackNaturalResult: 21, attackResult: 21, outcome: "successful" },
          { attackNaturalResult: 25, attackResult: 25, outcome: "successful" },
          { attackNaturalResult: 20, attackResult: 20, outcome: "successful" },
        ],
      }).resources,
    ).toEqual([expect.objectContaining({ resource: "hp", amount: 10 })]);
    expect(
      successfulMoveEffects(serenityExplosion, {
        ...context,
        self: { ...self, stats: { ...self.stats, dexterityBonus: 3 } },
        opponent: {
          ...opponent,
          stats: { ...opponent.stats, dexterity: 4, dexterityBonus: -1 },
        },
      }).resources,
    ).toEqual([expect.objectContaining({ resource: "hp", amount: 60, target: "opponent" })]);
    expect(stoppedMoveEffects(kiLockUp, { ...context, ...triggering }).resources).toEqual([
      expect.objectContaining({ resource: "ki", amount: 3 }),
    ]);
    expect(successfulMoveEffects(rapture, { ...context, currentDamage: 15 }).resources).toEqual([
      expect.objectContaining({ resource: "hp", amount: 4 }),
    ]);
  });

  it("resolves typed stat modifiers without interpreting source prose", () => {
    const rocketFire = moves.get("move-midorikatai-rocket-fire");
    if (rocketFire === undefined) throw new Error("Expected Rocket Fire data.");

    expect(moveEffectsForTrigger(rocketFire, "on-success", context).statModifications).toEqual([
      {
        target: "self",
        stat: "dexterity",
        operation: "set",
        amount: 1,
        duration: { type: "turns", ownerCombatantId: self.id, remaining: 2 },
      },
    ]);
  });

  it("retains next-action and next-roll stat scopes as typed applications", () => {
    const naginata = moves.get("move-akaikaru-naginata");
    const dazzlingGymnastics = moves.get("move-akaikaru-dazzling-gymnastics");
    if (naginata === undefined || dazzlingGymnastics === undefined)
      throw new Error("Expected stat-scope test moves.");

    expect(moveEffectsForTrigger(naginata, "on-success", context).statModifications).toEqual([
      expect.objectContaining({
        stat: "dexterity-bonus",
        operation: "multiply",
        amount: 2,
        scope: "next-action",
      }),
      expect.objectContaining({
        stat: "dexterity-bonus",
        operation: "multiply",
        amount: 2,
        scope: "next-roll",
        roll: "defense",
      }),
    ]);
    expect(
      moveEffectsForTrigger(dazzlingGymnastics, "on-stopped", context).statModifications,
    ).toEqual([
      expect.objectContaining({
        stat: "dexterity-bonus",
        operation: "add",
        amount: 1,
        duration: expect.objectContaining({ type: "turns", remaining: 3 }),
      }),
    ]);
  });

  it("resolves durable suppressions and filters only their declared aspect", () => {
    const dismissiveKick = moves.get("move-kurokonwaku-dismissive-kick");
    const powerDrill = moves.get("move-midorikatai-power-drill");
    const rocketFire = moves.get("move-midorikatai-rocket-fire");
    const spiritBomb = moves.get("move-afterlife-spirit-bomb");
    if (
      dismissiveKick === undefined ||
      powerDrill === undefined ||
      rocketFire === undefined ||
      spiritBomb === undefined
    )
      throw new Error("Expected suppression test moves.");

    expect(moveEffectsForTrigger(dismissiveKick, "on-success", context).suppressions).toEqual([
      expect.objectContaining({
        target: "opponent",
        aspects: ["successful-effects"],
        duration: { type: "turns", remaining: 2 },
      }),
    ]);
    expect(moveEffectsForTrigger(powerDrill, "on-success", context).suppressions).toEqual([
      expect.objectContaining({
        target: "opponent",
        aspects: ["successful-effects"],
        duration: { type: "next-actions", remaining: 1 },
      }),
    ]);

    const suppression = (aspects: readonly ("all-effects" | "successful-effects")[]) => ({
      id: "active-effect:suppression-test" as never,
      type: "suppress" as const,
      sourceCombatantId: opponent.id,
      targetCombatantId: self.id,
      sourceDefinitionId: "move-kurokonwaku-dismissive-kick" as never,
      aspects,
      duration: { type: "combat" as const },
    });
    const successfulOnly = { ...context, activeEffects: [suppression(["successful-effects"])] };
    expect(
      moveEffectsForTrigger(rocketFire, "on-success", successfulOnly).statModifications,
    ).toEqual([]);
    expect(
      moveEffectsForTrigger(spiritBomb, "passive", successfulOnly).damageModifications,
    ).not.toEqual([]);
    expect(
      moveEffectsForTrigger(spiritBomb, "passive", {
        ...context,
        activeEffects: [suppression(["all-effects"])],
      }).damageModifications,
    ).toEqual([]);
  });

  it("resolves a suppression threshold from the current single-die attack", () => {
    const dimensionScream = moves.get("move-kurokonwaku-dimension-scream");
    if (dimensionScream === undefined) throw new Error("Expected Dimension Scream data.");
    const effects = moveEffectsForTrigger(dimensionScream, "on-success", {
      ...context,
      rolls: [
        {
          attackNaturalResult: 25,
          attackResult: 25,
          defenseNaturalResult: 10,
          defenseResult: 10,
          outcome: "successful",
        },
      ],
      currentAction: {
        type: "use-move",
        decisionId: "decision:dimension-scream-current" as never,
        actorId: self.id,
        targetCombatantId: opponent.id,
        moveId: dimensionScream.id,
        turnNumber: context.turnNumber,
        phase: "action",
        attackRollResult: 25,
        defenseRollResult: 10,
        outcome: "successful",
        critical: false,
        counter: false,
      },
    });
    expect(effects.suppressions).toEqual([
      expect.objectContaining({
        aspects: ["all-effects"],
        duration: {
          type: "until-roll-threshold",
          roll: "attack",
          comparison: "at-least",
          value: 26,
        },
      }),
    ]);
  });

  it("evaluates Zen Explosion's defense threshold at the reaction roll", () => {
    const zenExplosion = moves.get("move-aoyosumu-zen-explosion");
    if (zenExplosion === undefined) throw new Error("Expected Zen Explosion data.");

    expect(
      moveEffectsForTrigger(zenExplosion, "after-defense-roll", {
        ...context,
        rolls: [
          {
            attackNaturalResult: 10,
            attackResult: 11,
            defenseNaturalResult: 1,
            defenseResult: 0,
            outcome: "successful",
          },
        ],
      }).rerolls,
    ).toEqual([expect.objectContaining({ roll: "defense" })]);
    expect(
      moveEffectsForTrigger(zenExplosion, "after-defense-roll", {
        ...context,
        rolls: [
          {
            attackNaturalResult: 10,
            attackResult: 11,
            defenseNaturalResult: 10,
            defenseResult: 9,
            outcome: "successful",
          },
        ],
      }).rerolls,
    ).toEqual([]);
  });

  it("dispatches a same-turn source-move extra action with its use limit", () => {
    const chainedStrikes = moves.get("move-akaikaru-chained-strikes");
    if (chainedStrikes === undefined) throw new Error("Expected Chained Strikes data.");

    expect(moveEffectsForTrigger(chainedStrikes, "on-success", context).extraActions).toEqual([
      {
        target: "self",
        phase: "action",
        moveCategory: "advanced-attack",
        sourceMoveOnly: true,
        scope: "current-turn",
        useLimit: expect.objectContaining({ scope: "turn", count: 1 }),
        effectIndex: 0,
      },
    ]);
  });

  it("resolves prior single-die defense results and clamps a damage cap", () => {
    const weepingWillow = moves.get("move-aoyosumu-weeping-willow");
    if (weepingWillow === undefined) throw new Error("Expected Weeping Willow data.");

    expect(
      moveEffectsForTrigger(weepingWillow, "before-attack-roll", {
        ...context,
        actionHistory: [
          {
            type: "use-move",
            decisionId: "decision:prior-defense-for-weeping-willow" as never,
            actorId: opponent.id,
            targetCombatantId: self.id,
            moveId: "move-afterlife-masenko" as never,
            turnNumber: 4,
            phase: "action",
            attackRollResult: 12,
            defenseRollResult: 30,
          },
        ],
      }).damageModifications,
    ).toEqual([
      expect.objectContaining({
        operation: "set",
        amount: 12,
        cap: { type: "maximum", value: 10 },
      }),
    ]);
  });

  it("dispatches nested effects from a durable floating bundle without source-text interpretation", () => {
    const backflipKick = moves.get("move-akaikaru-backflip-kick");
    const nestedBundle = backflipKick?.effects?.[0];
    if (backflipKick === undefined || nestedBundle?.type !== "create-floating-effect")
      throw new Error("Expected Backflip Kick's floating bundle.");

    const activeFloating = {
      id: "active-effect:backflip-floating" as never,
      type: "floating-effect" as const,
      sourceCombatantId: self.id,
      targetCombatantId: self.id,
      sourceDefinitionId: backflipKick.id,
      floatingEffectId: nestedBundle.floatingEffectId,
      effects: nestedBundle.effects ?? [],
      termination: (nestedBundle.termination ?? []).map(({ trigger, actor, selector }) => ({
        trigger,
        actor,
        ...(selector === undefined ? {} : { selector }),
      })),
      scope: { type: "next-action" as const },
      createdOnTurn: 4,
    };

    expect(
      moveEffectsForTrigger(backflipKick, "passive", {
        ...context,
        includeActiveFloatingEffects: true,
        activeEffects: [activeFloating],
      }).resolutionPreventions,
    ).toEqual([expect.objectContaining({ target: "self", prevention: "block" })]);
    expect(
      moveEffectsForTrigger(backflipKick, "passive", {
        ...context,
        turnNumber: 4,
        includeActiveFloatingEffects: true,
        activeEffects: [
          {
            ...activeFloating,
            scope: { type: "next-turn" as const, combatantId: self.id },
          },
        ],
      }).resolutionPreventions,
    ).toEqual([]);
  });

  it("evaluates active and inactive move-effect conditions from durable effects", () => {
    const x20 = moves.get("move-afterlife-x20-kaioken-kamehameha");
    if (x20 === undefined) throw new Error("Expected move-effect condition test moves.");

    const activeKaioKen = {
      id: "active-effect:kaio-ken" as never,
      type: "active-constant" as const,
      sourceCombatantId: self.id,
      targetCombatantId: self.id,
      sourceDefinitionId: "move-afterlife-kaio-ken" as never,
      activatedOnTurn: 5,
      duration: "combat" as const,
    };
    const x20Effects = moveEffectsForTrigger(x20, "passive", {
      ...context,
      activeEffects: [activeKaioKen],
    });
    expect(x20Effects.damageModifications).toEqual([
      expect.objectContaining({ amount: 5, basis: "power-percent" }),
    ]);
    expect(x20Effects.currentActionCostModifications).toEqual([
      expect.objectContaining({ operation: "add", amount: -2 }),
    ]);

    const x20DamageEffect = x20.effects?.[0];
    if (x20DamageEffect?.type !== "modify-damage" || x20DamageEffect.conditions?.[0] === undefined)
      throw new Error("Expected X20 damage condition.");
    const inactiveX20 = {
      ...x20,
      effects: [
        {
          ...x20DamageEffect,
          conditions: [{ ...x20DamageEffect.conditions[0], type: "move-effect-inactive" as const }],
        },
      ],
    } as MoveDefinition;
    const inactiveX20Effects = moveEffectsForTrigger(inactiveX20, "passive", {
      ...context,
      activeEffects: [],
    });
    expect(inactiveX20Effects.damageModifications).toEqual([
      expect.objectContaining({ amount: 5, basis: "power-percent" }),
    ]);
    const activeX20Effects = moveEffectsForTrigger(inactiveX20, "passive", {
      ...context,
      activeEffects: [
        {
          ...activeKaioKen,
        },
      ],
    });
    expect(activeX20Effects.damageModifications).toEqual([]);
  });

  it("resolves active-move, moveset, and current-use count conditions", () => {
    const wolfFang = moves.get("move-afterlife-wolf-fang-fist");
    const shoulderTackle = moves.get("move-akaikaru-accelerated-shoulder-tackle");
    const tortureRack = moves.get("move-midorikatai-torture-rack");
    const expertSwordplay = moves.get("move-freestyle-expert-swordplay");
    if (
      wolfFang === undefined ||
      shoulderTackle === undefined ||
      tortureRack === undefined ||
      expertSwordplay === undefined
    )
      throw new Error("Expected count-condition test moves.");

    const activeExpertSwordplay = {
      id: "active-effect:expert-swordplay" as never,
      type: "active-constant" as const,
      sourceCombatantId: self.id,
      targetCombatantId: self.id,
      sourceDefinitionId: expertSwordplay.id,
      activatedOnTurn: 5,
      duration: "combat" as const,
    };
    expect(
      moveEffectsForTrigger(wolfFang, "before-attack-roll", {
        ...context,
        activeEffects: [],
      }).rollModifications,
    ).toEqual([expect.objectContaining({ amount: 5 })]);
    expect(
      moveEffectsForTrigger(wolfFang, "before-attack-roll", {
        ...context,
        activeEffects: [activeExpertSwordplay, activeExpertSwordplay],
      }).rollModifications,
    ).toEqual([expect.objectContaining({ amount: 2 })]);

    const physicalAdvancedAttackIds = MOVE_DEFINITIONS.filter(
      (move) => move.category === "advanced-attack" && move.tags.includes("physical"),
    )
      .slice(0, 5)
      .map((move) => move.id);
    const fourMoveMovesetEffects = moveEffectsForTrigger(shoulderTackle, "on-success", {
      ...context,
      self: { ...self, moveIds: physicalAdvancedAttackIds.slice(0, 4) },
    });
    expect(fourMoveMovesetEffects.rollModifications).toEqual([
      expect.objectContaining({ amount: 3 }),
    ]);
    const fiveMoveMovesetEffects = moveEffectsForTrigger(shoulderTackle, "on-success", {
      ...context,
      self: { ...self, moveIds: physicalAdvancedAttackIds },
    });
    expect(fiveMoveMovesetEffects.rollModifications).toEqual([
      expect.objectContaining({ amount: 4 }),
      expect.objectContaining({ amount: 4, scope: "next-action" }),
    ]);

    const currentAction = {
      type: "use-move" as const,
      decisionId: "decision:current-torture-rack" as never,
      actorId: self.id,
      targetCombatantId: opponent.id,
      moveId: tortureRack.id,
      turnNumber: 5,
      phase: "action" as const,
    };
    const supportedTortureRack = {
      ...tortureRack,
      effects: [
        {
          ...tortureRack.effects?.[1],
          roll: "attack" as const,
        },
      ],
    } as MoveDefinition;
    expect(
      moveEffectsForTrigger(supportedTortureRack, "on-success", {
        ...context,
        currentAction,
      }).rollModifications,
    ).toEqual([expect.objectContaining({ amount: 2 })]);
    expect(
      moveEffectsForTrigger(supportedTortureRack, "on-success", {
        ...context,
        actionHistory: [currentAction],
        currentAction: { ...currentAction, decisionId: "decision:second-torture-rack" as never },
      }).rollModifications,
    ).toEqual([]);
  });

  it("dispatches a resource-threshold effect only when the durable state crosses it", () => {
    const eternalMastery = moves.get("move-haokiru-eternal-mastery");
    if (eternalMastery === undefined) throw new Error("Expected Eternal Mastery data.");

    const previous = { ...self, hitPoints: { ...self.hitPoints, current: 0 } };
    const crossed = moveEffectsForTrigger(eternalMastery, "on-resource-threshold", {
      ...context,
      self: { ...self, hitPoints: { ...self.hitPoints, current: -1 } },
      previousResourceState: { self: previous, opponent },
    });
    expect(crossed.resources).toEqual([
      expect.objectContaining({ resource: "hp", operation: "gain", amount: 10, target: "self" }),
    ]);

    const alreadyBelow = moveEffectsForTrigger(eternalMastery, "on-resource-threshold", {
      ...context,
      self: { ...self, hitPoints: { ...self.hitPoints, current: -2 } },
      previousResourceState: {
        self: { ...self, hitPoints: { ...self.hitPoints, current: -1 } },
        opponent,
      },
    });
    expect(alreadyBelow.resources).toEqual([]);
  });

  it("dispatches Mass Genocide's next-die result modifier from prior resolved dice", () => {
    const massGenocide = moves.get("move-afterlife-mass-genocide-attack");
    if (massGenocide === undefined) throw new Error("Expected Mass Genocide Attack data.");

    const firstDieSuccessful = moveEffectsForTrigger(massGenocide, "on-roll-result", {
      ...context,
      rolls: [
        {
          attackNaturalResult: 20,
          attackResult: 20,
          defenseNaturalResult: 1,
          defenseResult: 1,
          outcome: "successful" as const,
        },
      ],
    });
    expect(firstDieSuccessful.rollModifications).toEqual([
      expect.objectContaining({ dieIndex: 2, amount: 2, roll: "attack", modifier: "result" }),
    ]);

    const firstDieStopped = moveEffectsForTrigger(massGenocide, "on-roll-result", {
      ...context,
      rolls: [
        {
          attackNaturalResult: 10,
          attackResult: 10,
          defenseNaturalResult: 20,
          defenseResult: 20,
          outcome: "stopped" as const,
        },
      ],
    });
    expect(firstDieStopped.rollModifications).toEqual([]);
  });

  it("evaluates prior-action conditions from the latest structured action record", () => {
    const smackdown = moves.get("move-midorikatai-smackdown");
    const masenko = moves.get("move-afterlife-masenko");
    if (smackdown === undefined || masenko === undefined)
      throw new Error("Expected prior-action test moves.");

    const priorAdvancedAttack = {
      type: "use-move" as const,
      decisionId: "decision:prior-advanced-attack" as never,
      actorId: opponent.id,
      targetCombatantId: self.id,
      moveId: "move-midorikatai-rocket-fire" as never,
      turnNumber: 4,
      phase: "action" as const,
      outcome: "successful" as const,
      critical: false,
      counter: false,
    };

    expect(
      moveEffectsForTrigger(smackdown, "passive", {
        ...context,
        actionHistory: [priorAdvancedAttack],
      }).damageModifications,
    ).toEqual([expect.objectContaining({ amount: 3, basis: "power-percent" })]);

    expect(
      moveEffectsForTrigger(smackdown, "passive", {
        ...context,
        actionHistory: [
          priorAdvancedAttack,
          {
            type: "power-up" as const,
            decisionId: "decision:power-up" as never,
            actorId: opponent.id,
            turnNumber: 5,
            phase: "action" as const,
          },
        ],
      }).damageModifications,
    ).toEqual([]);

    expect(
      moveEffectsForTrigger(masenko, "on-success", {
        ...context,
        actionHistory: [priorAdvancedAttack],
      }).rollModifications,
    ).toEqual([]);
    expect(
      moveEffectsForTrigger(masenko, "on-success", {
        ...context,
        actionHistory: [],
      }).rollModifications,
    ).toEqual([expect.objectContaining({ amount: -5 })]);
  });

  it("resolves combat-result history for passive damage and roll modifiers", () => {
    const lettingOffSteam = moves.get("move-akaikaru-letting-off-steam");
    if (lettingOffSteam === undefined) throw new Error("Expected Letting Off Steam data.");

    const priorStoppedAttack = {
      type: "use-move" as const,
      decisionId: "decision:prior-stopped-attack" as never,
      actorId: self.id,
      targetCombatantId: opponent.id,
      moveId: "move-akaikaru-firestorm" as never,
      outcome: "stopped" as const,
      critical: false,
      counter: false,
      turnNumber: 4,
      phase: "action" as const,
    };
    const resolved = moveEffectsForTrigger(lettingOffSteam, "passive", {
      ...context,
      actionHistory: [priorStoppedAttack, { ...priorStoppedAttack, turnNumber: 5 }],
    });

    expect(resolved.damageModifications).toEqual([
      expect.objectContaining({ amount: 2, basis: "power-percent" }),
    ]);
    expect(resolved.rollModifications).toEqual([
      expect.objectContaining({ amount: 2, roll: "attack", modifier: "result" }),
    ]);
  });

  it("evaluates action sequences with the current attack and ignores non-attack actions", () => {
    const skyDance = moves.get("move-aoyosumu-sky-dance-technique");
    if (skyDance === undefined) throw new Error("Expected Sky Dance Technique data.");

    const stoppedAction = (turnNumber: number) => ({
      type: "use-move" as const,
      decisionId: `decision:stopped-${turnNumber}` as never,
      actorId: self.id,
      targetCombatantId: opponent.id,
      moveId: skyDance.id,
      turnNumber,
      phase: "action" as const,
      outcome: "stopped" as const,
      critical: false,
      counter: false,
    });
    const currentAction = stoppedAction(5);

    expect(
      moveEffectsForTrigger(skyDance, "on-stopped", {
        ...context,
        actionHistory: [
          stoppedAction(3),
          {
            type: "power-up" as const,
            decisionId: "decision:power-up-sequence" as never,
            actorId: self.id,
            turnNumber: 4,
            phase: "action" as const,
          },
          stoppedAction(4),
        ],
        currentAction,
      }).resources,
    ).toEqual([
      {
        resource: "ki",
        target: "self",
        operation: "lose",
        amount: 1,
        cause: "non-damage-effect",
        sourceCombatantId: self.id,
        sourceStyleId: "style-aoyosumu",
      },
    ]);

    expect(
      moveEffectsForTrigger(skyDance, "on-stopped", {
        ...context,
        actionHistory: [stoppedAction(3), { ...stoppedAction(4), outcome: "successful" }],
        currentAction,
      }).resources,
    ).toEqual([]);
  });

  it("resolves deterministic on-damage modifiers from the current attack context", () => {
    const advancedBehavior = moves.get("move-haokiru-advanced-behavior");
    const criticalMass = moves.get("move-midorikatai-critical-mass-mastery");
    const muscleInfusion = moves.get("move-haokiru-muscle-infusion");
    const currentAction = {
      type: "use-move" as const,
      decisionId: "decision:on-damage" as never,
      actorId: self.id,
      targetCombatantId: opponent.id,
      moveId: "move-afterlife-masenko" as never,
      turnNumber: context.turnNumber,
      phase: "action" as const,
      outcome: "successful" as const,
      critical: true,
      counter: false,
    };
    const responseContext = {
      ...context,
      self: opponent,
      opponent: self,
      currentAction,
      rolls: [
        {
          attackNaturalResult: 20,
          attackResult: 20,
          defenseNaturalResult: 15,
          defenseResult: 15,
          outcome: "successful" as const,
        },
      ],
      incomingDamage: 40,
      triggeringMove: moves.get("move-afterlife-masenko"),
    };
    if (
      advancedBehavior === undefined ||
      criticalMass === undefined ||
      muscleInfusion === undefined
    )
      throw new Error("Expected on-damage test moves.");

    expect(
      moveEffectsForTrigger(advancedBehavior, "on-damage", responseContext).damageModifications,
    ).toEqual([
      expect.objectContaining({
        operation: "add",
        amount: -10,
        basis: "damage-percent",
        target: "opponent",
      }),
    ]);
    expect(
      moveEffectsForTrigger(criticalMass, "on-damage", responseContext).damageModifications,
    ).toEqual([]);
    expect(
      moveEffectsForTrigger(muscleInfusion, "on-damage", responseContext).damageModifications,
    ).toEqual([]);
  });

  it("applies a converted passive damage expression using durable activation history", () => {
    const move = moves.get("move-afterlife-spirit-bomb");
    if (move === undefined) throw new Error("Expected Spirit Bomb data.");

    expect(adjustedMoveDamage(move, 20, context)).toBe(30);
  });

  it("compiles durable damage lifecycles with their declared basis and availability", () => {
    const ankleBuster = moves.get("move-midorikatai-ankle-buster");
    const monsterMash = moves.get("move-midorikatai-monster-mash");
    const oneTwoPunch = moves.get("move-midorikatai-one-two-punch");
    const swiftNeckChop = moves.get("move-aoyosumu-swift-neck-chop");
    if (
      ankleBuster === undefined ||
      monsterMash === undefined ||
      oneTwoPunch === undefined ||
      swiftNeckChop === undefined
    )
      throw new Error("Expected durable damage modifier move data.");

    const ankleEffects = successfulMoveEffects(ankleBuster, {
      ...context,
      opponent: { ...opponent, stats: { ...opponent.stats, power: 10 } },
    }).damageModifications;
    expect(ankleEffects).toHaveLength(2);
    expect(ankleEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          amount: -10,
          basis: "damage-percent",
          duration: { type: "turns", ownerCombatantId: opponent.id, remaining: 2 },
        }),
      ]),
    );

    expect(successfulMoveEffects(monsterMash, context).damageModifications).toEqual([
      expect.objectContaining({
        amount: -4,
        basis: "power-percent",
        duration: { type: "combat" },
      }),
    ]);

    expect(successfulMoveEffects(oneTwoPunch, context).damageModifications).toEqual([
      expect.objectContaining({
        amount: -2,
        basis: "power-percent",
        availableFromTurn: context.turnNumber + 1,
        duration: { type: "turns", ownerCombatantId: opponent.id, remaining: 1 },
      }),
    ]);

    expect(
      moveEffectsForTrigger(swiftNeckChop, "before-attack-roll", {
        ...context,
        self: { ...self, stats: { ...self.stats, dexterity: 6 } },
      }).damageModifications,
    ).toEqual([expect.objectContaining({ amount: 1, basis: "power-percent" })]);

    const thresholdMove = {
      ...swiftNeckChop,
      effects: [
        {
          trigger: "on-success",
          target: "opponent",
          type: "modify-damage",
          operation: "add",
          percent: { type: "literal", value: -10 },
          duration: {
            type: "until-roll-threshold",
            roll: "attack",
            comparison: "at-least",
            value: { type: "literal", value: 25 },
            sourceText: "until an attack result of 25",
          },
          sourceText: "damage threshold test",
        },
      ],
    } as MoveDefinition;
    expect(successfulMoveEffects(thresholdMove, context).damageModifications).toEqual([
      expect.objectContaining({
        duration: {
          type: "until-roll-threshold",
          combatantId: opponent.id,
          roll: "attack",
          comparison: "at-least",
          value: 25,
        },
      }),
    ]);

    const operationMove = {
      ...swiftNeckChop,
      effects: [
        {
          trigger: "on-success",
          target: "self",
          type: "modify-damage",
          operation: "multiply",
          percent: { type: "damage-percent", percent: 50 },
          duration: {
            type: "turns",
            turns: { type: "literal", value: 0 },
            sourceText: "for zero turns",
          },
          sourceText: "damage operation test",
        },
        {
          trigger: "on-success",
          target: "self",
          type: "modify-damage",
          operation: "set",
          percent: { type: "literal", value: 3 },
          duration: { type: "combat", sourceText: "for combat" },
          sourceText: "damage replacement test",
        },
        {
          trigger: "on-success",
          target: "self",
          type: "modify-damage",
          operation: "add",
          percent: { type: "literal", value: 1 },
          scope: { type: "next-turn", subject: "self", sourceText: "on your next turn" },
          sourceText: "next-turn damage test",
        },
        {
          trigger: "on-success",
          target: "self",
          type: "modify-damage",
          operation: "set",
          percent: { type: "literal", value: 4 },
          duration: {
            type: "turns",
            turns: { type: "literal", value: 2 },
            sourceText: "for two turns",
          },
          sourceText: "self duration test",
        },
        {
          trigger: "on-success",
          target: "self",
          type: "modify-damage",
          operation: "add",
          percent: { type: "literal", value: 2 },
          duration: {
            type: "until-roll-threshold",
            roll: "attack",
            comparison: "at-most",
            value: { type: "literal", value: 10 },
            sourceText: "until an attack result of 10",
          },
          sourceText: "self threshold test",
        },
      ],
    } as MoveDefinition;
    expect(successfulMoveEffects(operationMove, context).damageModifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "set",
          amount: 1,
          basis: "power-percent",
          duration: { type: "combat" },
        }),
        expect.objectContaining({
          availableFromTurn: context.turnNumber + 1,
          duration: {
            type: "turns",
            ownerCombatantId: self.id,
            remaining: 1,
          },
        }),
        expect.objectContaining({
          amount: 1,
          duration: { type: "turns", ownerCombatantId: self.id, remaining: 2 },
        }),
        expect.objectContaining({
          duration: {
            type: "until-roll-threshold",
            combatantId: self.id,
            roll: "attack",
            comparison: "at-most",
            value: 10,
          },
        }),
      ]),
    );
  });

  it("evaluates an unscoped passive damage modifier through the generic runtime", () => {
    const energyGorged = moves.get("move-midorikatai-energy-gorged");
    if (energyGorged === undefined) throw new Error("Expected Energy Gorged data.");

    expect(adjustedMoveDamage(energyGorged, 13, context)).toBe(15);
  });

  it("applies passive replacement and multiplicative damage operations only to matching moves", () => {
    const baseMove = moves.get("move-afterlife-light-grenade");
    const triggeringMove = moves.get("move-afterlife-spirit-bomb");
    if (baseMove === undefined || triggeringMove === undefined)
      throw new Error("Expected passive damage test moves.");

    const move = {
      ...baseMove,
      effects: [
        {
          trigger: "passive",
          target: "self",
          type: "modify-damage",
          operation: "set",
          percent: { type: "literal", value: 8 },
          sourceText: "set passive damage",
        },
        {
          trigger: "passive",
          target: "self",
          type: "modify-damage",
          operation: "multiply",
          percent: { type: "literal", value: 50 },
          sourceText: "multiply passive damage",
        },
        {
          trigger: "passive",
          target: "self",
          type: "modify-damage",
          operation: "add",
          percent: { type: "literal", value: 100 },
          selector: {
            type: "move-selector",
            subject: "source",
            ids: ["move-afterlife-spirit-bomb"],
            sourceText: "Spirit Bomb only",
          },
          sourceText: "selector passive damage",
        },
        {
          trigger: "passive",
          target: "self",
          type: "modify-damage",
          operation: "add",
          percent: {
            type: "move-activation-count",
            moveId: "move-missing-for-coverage",
            perActivation: 1,
          },
          sourceText: "unresolved passive damage",
        },
      ],
    } as MoveDefinition;

    expect(adjustedMoveDamage(move, 20, context)).toBe(1);
    expect(adjustedMoveDamage(move, 20, { ...context, triggeringMove })).toBe(21);
  });

  it("compiles a cost-only move-modification prevention as a typed generic application", () => {
    const spikedBall = moves.get("move-kurokonwaku-spiked-ball");
    if (spikedBall === undefined) throw new Error("Expected Spiked Ball data.");

    expect(
      moveEffectsForTrigger(spikedBall, "passive", context).moveModificationPreventions,
    ).toEqual([
      expect.objectContaining({
        target: "self",
        actor: "any",
        aspects: ["cost"],
        selector: expect.objectContaining({ ids: ["move-kurokonwaku-spiked-ball"] }),
        operations: ["reduce"],
        duration: { type: "combat" },
      }),
    ]);
  });

  it("compiles damage-reduction prevention with explicit status-source exceptions", () => {
    const heatDomeAttack = moves.get("move-afterlife-heat-dome-attack");
    if (heatDomeAttack === undefined) throw new Error("Expected Heat Dome Attack data.");

    expect(successfulMoveEffects(heatDomeAttack, context).moveModificationPreventions).toEqual([
      expect.objectContaining({
        target: "self",
        actor: "opponent",
        aspects: ["damage"],
        operations: ["reduce"],
        exceptSourceStatusIds: ["break", "sever"],
        selector: expect.objectContaining({
          categories: ["advanced-attack", "signature"],
        }),
        duration: { type: "combat" },
      }),
    ]);
  });

  it("emits converted successful resource and status changes when their condition matches", () => {
    const lightGrenade = moves.get("move-afterlife-light-grenade");
    const meteorSmash = moves.get("move-afterlife-meteor-smash");
    if (lightGrenade === undefined || meteorSmash === undefined)
      throw new Error("Expected move data.");

    expect(successfulMoveEffects(lightGrenade, context).resources).toEqual([
      {
        resource: "hp",
        target: "self",
        operation: "gain",
        amount: 5,
        cause: "non-damage-effect",
        sourceCombatantId: self.id,
      },
    ]);
    expect(successfulMoveEffects(meteorSmash, context).statuses).toEqual([
      expect.objectContaining({
        target: "opponent",
        status: expect.objectContaining({ statusId: "stun" }),
      }),
    ]);
  });

  it("emits typed current-attack result overrides without executing source prose", () => {
    const backSuplex = moves.get("move-midorikatai-back-suplex");
    const superKamehameha = moves.get("move-afterlife-super-kamehameha");
    if (backSuplex === undefined || superKamehameha === undefined)
      throw new Error("Expected combat-result override moves.");

    expect(moveEffectsForTrigger(backSuplex, "passive", context).combatResultOverrides).toEqual([
      { target: "self", result: "successful", resultScope: "current-attack" },
    ]);
    expect(
      successfulMoveEffects(superKamehameha, {
        ...context,
        rolls: [
          {
            attackNaturalResult: 28,
            attackResult: 28,
            defenseNaturalResult: 1,
            defenseResult: 1,
            outcome: "successful",
          },
        ],
        successfulHitCount: 1,
      }).combatResultOverrides,
    ).toEqual([{ target: "self", result: "critical", resultScope: "current-attack" }]);
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

  it("normalizes direct current and future resolution thresholds without approximating context-bound values", () => {
    const scatterShot = moves.get("move-afterlife-scatter-shot");
    const epitaphToWar = moves.get("move-aoyosumu-epitaph-to-war");
    if (scatterShot === undefined || epitaphToWar === undefined)
      throw new Error("Expected resolution-threshold move data.");

    expect(
      moveEffectsForTrigger(scatterShot, "passive", {
        ...context,
        self: { ...self, stats: { ...self.stats, power: 30 } },
        opponent: { ...opponent, stats: { ...opponent.stats, power: 20 } },
      }).resolutionThresholds,
    ).toEqual([
      {
        target: "opponent",
        outcome: "stopped",
        roll: "defense",
        comparison: "at-least",
        value: 11,
        resultScope: "current-attack",
      },
    ]);

    expect(successfulMoveEffects(epitaphToWar, context).resolutionThresholds).toEqual([
      {
        target: "opponent",
        outcome: "successful",
        roll: "attack",
        comparison: "at-least",
        value: 25,
        resultScope: "current-attack",
        scope: "next-action",
      },
      {
        target: "opponent",
        outcome: "successful",
        roll: "attack",
        comparison: "at-least",
        value: 13,
        resultScope: "current-attack",
        duration: { type: "combat" },
      },
    ]);
  });

  it("preserves counted scopes when normalizing generic roll modifiers", () => {
    const baseMove = moves.get("move-afterlife-light-grenade");
    if (baseMove === undefined) throw new Error("Expected Light Grenade data.");
    const move = {
      ...baseMove,
      effects: [
        {
          trigger: "on-success",
          target: "self",
          type: "modify-roll",
          roll: "attack",
          modifier: "result",
          amount: { type: "literal", value: 2 },
          scope: {
            type: "next-rolls",
            roll: "attack",
            count: { type: "literal", value: 3 },
            sourceText: "the next three attack rolls",
          },
          sourceText: "Gain +2 to the next three attack rolls.",
        },
      ],
    } as MoveDefinition;

    expect(successfulMoveEffects(move, context).rollModifications).toEqual([
      {
        target: "self",
        roll: "attack",
        modifier: "result",
        amount: 2,
        scope: "next-rolls",
        remaining: 3,
      },
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

  it("serializes both resource-prevention operations from a conditioned move", () => {
    const vanishingBall = moves.get("move-afterlife-vanishing-ball");
    if (vanishingBall === undefined) throw new Error("Expected Vanishing Ball data.");

    expect(
      successfulMoveEffects(vanishingBall, {
        ...context,
        mode: "battle",
        successfulHitCount: 1,
        rolls: [
          {
            attackNaturalResult: 31,
            attackResult: 31,
            defenseNaturalResult: 1,
            defenseResult: 1,
            outcome: "successful",
          },
        ],
      }).resourceModificationPreventions,
    ).toEqual([
      {
        target: "opponent",
        resource: "hp",
        operation: "gain",
        duration: { type: "combat" },
      },
      {
        target: "opponent",
        resource: "hp",
        operation: "set",
        duration: { type: "combat" },
      },
    ]);
  });

  it("normalizes next-actions roll-modification prevention without widening it to combat", () => {
    const bigBangAttack = moves.get("move-afterlife-big-bang-attack");
    if (bigBangAttack === undefined) throw new Error("Expected Big Bang Attack data.");

    expect(successfulMoveEffects(bigBangAttack, context).rollModificationPreventions).toEqual([
      expect.objectContaining({
        target: "opponent",
        roll: "attack",
        modifier: "sides",
        duration: { type: "next-actions", remaining: 2 },
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

  it("evaluates one-based roll-die conditions against persisted attack-roll records", () => {
    const burningSlash = moves.get("move-afterlife-burning-slash");
    if (burningSlash === undefined) throw new Error("Expected Burning Slash data.");
    const successfulRoll = {
      attackNaturalResult: 28,
      attackResult: 28,
      defenseNaturalResult: 1,
      defenseResult: 1,
      outcome: "successful" as const,
    };

    expect(
      successfulMoveEffects(burningSlash, {
        ...context,
        successfulHitCount: 6,
        rolls: Array.from({ length: 6 }, () => successfulRoll),
      }).damageModifications,
    ).toEqual([expect.objectContaining({ target: "self", operation: "add", amount: 3 })]);
    expect(
      successfulMoveEffects(burningSlash, {
        ...context,
        successfulHitCount: 5,
        rolls: [
          ...Array.from({ length: 5 }, () => successfulRoll),
          {
            attackNaturalResult: 1,
            attackResult: 1,
            defenseNaturalResult: 1,
            defenseResult: 1,
            outcome: "stopped" as const,
          },
        ],
      }).damageModifications,
    ).toEqual([]);
  });

  it("resolves successful-hit-count expressions from the completed attack", () => {
    const bakuretsuRanma = moves.get("move-afterlife-bakuretsu-ranma");
    const dragonSwipes = moves.get("move-haokiru-dragon-swipes");
    if (bakuretsuRanma === undefined || dragonSwipes === undefined)
      throw new Error("Expected successful-hit-count move data.");

    expect(
      successfulMoveEffects(bakuretsuRanma, {
        ...context,
        successfulHitCount: 7,
      }).rollModifications,
    ).toEqual([
      expect.objectContaining({
        target: "opponent",
        roll: "attack",
        modifier: "result",
        amount: -7,
        scope: "next-roll",
      }),
    ]);
    expect(
      successfulMoveEffects(dragonSwipes, {
        ...context,
        successfulHitCount: 5,
      }).damageModifications,
    ).toEqual([
      expect.objectContaining({
        target: "opponent",
        operation: "add",
        amount: -5,
        scope: "next-action",
      }),
    ]);
  });

  it("resolves resource-from-threshold roll penalties and defaults omitted caps to amount", () => {
    const cursedSpheres = moves.get("move-kurokonwaku-cursed-spheres");
    if (cursedSpheres === undefined) throw new Error("Expected Cursed Spheres data.");

    expect(
      successfulMoveEffects(cursedSpheres, {
        ...context,
        opponent: { ...opponent, ki: { ...opponent.ki, current: 8 } },
        successfulHitCount: 2,
      }).rollModifications,
    ).toEqual([
      expect.objectContaining({
        amount: -2,
        cap: { type: "maximum", scope: "amount", value: -5 },
        roll: "attack",
      }),
      expect.objectContaining({
        amount: -2,
        cap: { type: "maximum", scope: "amount", value: -5 },
        roll: "defense",
      }),
    ]);
    expect(
      successfulMoveEffects(cursedSpheres, {
        ...context,
        opponent: { ...opponent, ki: { ...opponent.ki, current: 0 } },
        successfulHitCount: 2,
      }).rollModifications,
    ).toEqual([
      expect.objectContaining({ amount: -10, roll: "attack" }),
      expect.objectContaining({ amount: -10, roll: "defense" }),
    ]);
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

  it("evaluates current and total resource comparisons without source-text inference", () => {
    const focusedSpiritCutter = moves.get("move-haokiru-focused-spirit-cutter");
    if (focusedSpiritCutter === undefined) throw new Error("Expected Focused Spirit Cutter data.");

    const lowerCurrentHp = {
      ...context,
      self: { ...self, hitPoints: { current: 40, maximum: 100 } },
      opponent: { ...opponent, hitPoints: { current: 50, maximum: 100 } },
    };
    expect(
      moveEffectsForTrigger(focusedSpiritCutter, "passive", lowerCurrentHp)
        .currentActionCostModifications,
    ).toEqual([expect.objectContaining({ operation: "add", amount: -1, target: "self" })]);
    expect(
      moveEffectsForTrigger(focusedSpiritCutter, "passive", {
        ...lowerCurrentHp,
        self: { ...lowerCurrentHp.self, hitPoints: { current: 60, maximum: 100 } },
      }).currentActionCostModifications,
    ).toEqual([]);
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
      {
        resource: "ki",
        target: "opponent",
        operation: "drain",
        amount: 1,
        cause: "non-damage-effect",
        sourceCombatantId: self.id,
        sourceStyleId: "style-kurokonwaku",
      },
      {
        resource: "ki",
        target: "opponent",
        operation: "drain",
        amount: 1,
        cause: "non-damage-effect",
        sourceCombatantId: self.id,
        sourceStyleId: "style-kurokonwaku",
      },
    ]);
  });

  it("emits converted stopped-trigger resource effects", () => {
    const firewall = moves.get("move-akaikaru-firewall");
    if (firewall === undefined) throw new Error("Expected Firewall data.");

    expect(stoppedMoveEffects(firewall, { ...context, successfulHitCount: 0 }).resources).toEqual([
      {
        resource: "ki",
        target: "self",
        operation: "gain",
        amount: 1,
        cause: "non-damage-effect",
        sourceCombatantId: self.id,
        sourceStyleId: "style-akaikaru",
      },
    ]);
  });

  it("carries converted minimum resource caps into the typed change", () => {
    const goBoom = moves.get("move-kurokonwaku-go-boom");
    if (goBoom === undefined) throw new Error("Expected Go Boom data.");

    expect(stoppedMoveEffects(goBoom, context).resources).toEqual([
      expect.objectContaining({
        resource: "hp",
        target: "opponent",
        operation: "lose",
        amount: 3,
        cap: { type: "minimum", value: 1 },
      }),
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

  it("resolves next-turn and counted action restrictions without reading source text", () => {
    const heatSeekingBlast = moves.get("move-kiihakai-heat-seeking-blast");
    const shadowRealm = moves.get("move-kurokonwaku-shadow-realm");
    if (heatSeekingBlast === undefined || shadowRealm === undefined)
      throw new Error("Expected action-restriction test moves.");

    expect(
      moveEffectsForTrigger(heatSeekingBlast, "before-attack-roll", context).actionRestrictions,
    ).toEqual([
      {
        target: "self",
        blockedCategories: ["basic-attack", "advanced-attack", "signature"],
        remainingTurns: 1,
        effectIndex: 0,
      },
    ]);
    expect(successfulMoveEffects(shadowRealm, context).actionRestrictions).toEqual([
      {
        target: "self",
        blockedCategories: ["basic-attack", "advanced-attack", "signature"],
        remainingTurns: 2,
        effectIndex: 1,
      },
    ]);
  });
});
