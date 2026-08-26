import { MOVE_DEFINITIONS } from "@dragonball-resurgence/game-data";
import type { MoveDefinition } from "@dragonball-resurgence/game-data";
import { describe, expect, it } from "vitest";

import {
  adjustedMoveDamage,
  classifyCurrentActionMove,
  moveEffectsForTrigger,
  rerollEffectsAfterDefense,
  rerollEffectsOnRollResult,
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
  it("emits the exact modifier-transformer applications at their declared boundaries", () => {
    const hellzone = moves.get("move-afterlife-hellzone-grenade");
    const phoenix = moves.get("move-haokiru-phoenix-tackle");
    if (hellzone === undefined || phoenix === undefined)
      throw new Error("Expected modifier-transformer test moves.");

    const costEffects = moveEffectsForTrigger(hellzone, "on-success", {
      ...context,
      successfulHitCount: 7,
      triggeringMove: hellzone,
    });
    expect(costEffects.costModifierTransformers).toEqual([
      expect.objectContaining({ multiplier: 2, scope: "next-cost-modification" }),
    ]);

    const resourceEffects = moveEffectsForTrigger(phoenix, "on-success", {
      ...context,
      rolls: [
        {
          attackNaturalResult: 20,
          attackResult: 20,
          outcome: "successful" as const,
        },
      ],
      triggeringMove: phoenix,
    });
    expect(resourceEffects.resourceModifierTransformers).toEqual([
      expect.objectContaining({
        multiplier: 2,
        scope: "next-turn",
        cap: { type: "maximum", value: 30 },
      }),
    ]);
  });

  it("honors a durable stat-comparison override in a conditional effect", () => {
    const move = moves.get("move-afterlife-kaio-ken-attack");
    if (move === undefined) throw new Error("Expected Kaio-Ken Attack data.");

    const effects = moveEffectsForTrigger(move, "on-success", {
      ...context,
      triggeringMove: move,
      activeEffects: [
        {
          id: "active-effect:kaio-ken-comparison" as never,
          type: "set-stat-comparison" as const,
          sourceCombatantId: self.id,
          targetCombatantId: self.id,
          sourceDefinitionId: "move-afterlife-kaio-ken",
          leftCombatantId: self.id,
          rightCombatantId: opponent.id,
          stat: "dexterity" as const,
          comparison: "higher-than" as const,
          duration: { type: "turns" as const, ownerCombatantId: self.id, remaining: 2 },
        },
      ],
    });

    expect(effects.resolutionThresholds).toEqual([
      expect.objectContaining({
        target: "self",
        roll: "defense",
        comparison: "at-least",
        value: 8,
        scope: "next-action",
      }),
    ]);
  });

  it("applies a durable declared-style classification to matching future moves", () => {
    const cascade = moves.get("move-freestyle-ki-color-cascade");
    if (cascade === undefined) throw new Error("Expected Ki Color Cascade data.");

    const classified = classifyCurrentActionMove(cascade, {
      ...context,
      self: { ...self, declaredStyleId: "style-akaikaru" },
      activeEffects: [
        {
          id: "active-effect:ki-color-cascade" as never,
          type: "modify-move-classification" as const,
          sourceCombatantId: self.id,
          targetCombatantId: self.id,
          sourceDefinitionId: cascade.id,
          sourceEffectIndex: 0,
          selector: {
            type: "move-selector" as const,
            subject: "source" as const,
            styleId: "style-freestyle",
            sourceText: "Your Freestyle attacks",
          },
          classification: { type: "replace-style" as const, style: "declared-style" as const },
          duration: {
            type: "turns" as const,
            ownerCombatantId: self.id,
            remaining: 4,
          },
        },
      ],
    });

    expect(classified.move.styleId).toBe("style-akaikaru");
  });

  it("resolves counted next-actions cost modifiers as typed applications", () => {
    const move = moves.get("move-kurokonwaku-sixty-second-meltdown");
    if (move === undefined) throw new Error("Expected Sixty Second Meltdown.");

    const effects = moveEffectsForTrigger(move, "on-success", {
      ...context,
      triggeringMove: move,
      rolls: [
        {
          attackNaturalResult: 20,
          attackResult: 20,
          defenseNaturalResult: 1,
          defenseResult: 1,
          outcome: "successful" as const,
        },
      ],
      enabledOptionalEffectIndices: [0, 1],
    });

    expect(effects.extraActions).toEqual([
      expect.objectContaining({
        sourceDefinitionId: move.id,
        maximumActions: 2,
        phase: "action",
        moveCategory: "advanced-attack",
      }),
    ]);
    expect(effects.costModifications).toEqual([
      {
        target: "self",
        operation: "add",
        amount: -1,
        minimum: 1,
        scope: "next-actions",
        remaining: 2,
      },
    ]);
  });

  it("persists BOOMerang's deferred cost expression with its source move selector", () => {
    const boomerang = moves.get("move-kiihakai-boomerang");
    if (boomerang === undefined) throw new Error("Expected BOOMerang data.");

    expect(
      moveEffectsForTrigger(boomerang, "on-success", {
        ...context,
        triggeringMove: boomerang,
        successfulHitCount: 1,
      }).costModifications,
    ).toEqual([
      {
        target: "self",
        operation: "set",
        amount: 3,
        amountExpression: { type: "next-move-ki-cost", actor: "opponent" },
        selector: {
          type: "move-selector",
          subject: "source",
          ids: [boomerang.id],
          sourceText: "this attack",
        },
        scope: "next-turn",
      },
    ]);
  });

  it("resolves Channeling Mastery's selected Signature cost and typed HP activation", () => {
    const mastery = moves.get("move-haokiru-channeling-mastery");
    const triggeringMove = moves.get("move-afterlife-spirit-bomb");
    if (mastery === undefined || triggeringMove === undefined)
      throw new Error("Expected Channeling Mastery and Spirit Bomb.");

    const effects = moveEffectsForTrigger(mastery, "on-move-use", {
      ...context,
      triggeringMove,
      triggeringMoveOwner: "self",
      activeEffects: [],
      enabledOptionalEffectIndices: [3],
    });

    expect(effects.currentActionCostModifications).toEqual([
      {
        target: "self",
        operation: "add",
        amount: -3,
        minimum: 3,
        selector: {
          type: "move-selector",
          subject: "source",
          category: "signature",
          sourceText: "When you perform a Signature Technique",
        },
        sourceDefinitionId: mastery.id,
        sourceEffectIndex: 3,
        sourceCombatantId: self.id,
        activationCost: { resource: "hp", amount: 5 },
      },
    ]);
  });

  it("normalizes grouped Rollback Barrage reactivation into a bounded application", () => {
    const rollback = moves.get("move-kiihakai-rollback-barrage");
    if (rollback === undefined) throw new Error("Expected Rollback Barrage.");

    const effects = moveEffectsForTrigger(rollback, "on-success", {
      ...context,
      successfulHitCount: 5,
      enabledOptionalEffectIndices: [0],
    });

    expect(effects.activations).toEqual([
      expect.objectContaining({
        selector: expect.objectContaining({ category: "skill", constant: true }),
        selectionLimit: 2,
        reactivationOnly: true,
        optional: true,
      }),
    ]);
  });

  it("emits a typed source move-removal application without interpreting source prose", () => {
    const move = moves.get("move-freestyle-nullifying-sphere");
    if (move === undefined) throw new Error("Expected Nullifying Sphere.");

    const effects = moveEffectsForTrigger(move, "action-phase", {
      ...context,
      self: { ...self, moveIds: [move.id, "move-afterlife-spirit-bomb"] },
      opponent: { ...opponent, moveIds: ["move-afterlife-spirit-bomb"] },
    });

    expect(effects.moveRemovals).toEqual([{ target: "self", move: "source", effectIndex: 0 }]);
  });

  it("serializes Creationist's exclusive on-cost-modified alternatives", () => {
    const creationist = moves.get("move-haokiru-creationist");
    const triggeringMove = moves.get("move-haokiru-focused-spirit-cutter");
    if (creationist === undefined || triggeringMove === undefined)
      throw new Error("Expected Creationist and a Haokiru cost-modified attack.");

    const pending = moveEffectsForTrigger(creationist, "on-cost-modified", {
      ...context,
      triggeringMove,
      triggeringMoveOwner: "self",
      collectPendingChoices: true,
    });
    expect(pending.pendingEffectChoices.map((choice) => choice.effectIndices)).toEqual([[0], [1]]);

    expect(
      moveEffectsForTrigger(creationist, "on-cost-modified", {
        ...context,
        triggeringMove,
        triggeringMoveOwner: "self",
        enabledOptionalEffectIndices: [0],
      }).currentActionCostModifications,
    ).toEqual([expect.objectContaining({ operation: "add", amount: 0, minimum: 0 })]);
    expect(
      moveEffectsForTrigger(creationist, "on-cost-modified", {
        ...context,
        triggeringMove,
        triggeringMoveOwner: "self",
        enabledOptionalEffectIndices: [1],
      }).currentActionCostModifications,
    ).toEqual([expect.objectContaining({ operation: "add", amount: -1 })]);
  });

  it("serializes Spinebreaker's exclusive success alternatives", () => {
    const spinebreaker = moves.get("move-akaikaru-spinebreaker");
    if (spinebreaker === undefined) throw new Error("Expected Spinebreaker.");

    const pending = moveEffectsForTrigger(spinebreaker, "on-success", {
      ...context,
      self: { ...self, moveIds: [spinebreaker.id] },
      triggeringMove: spinebreaker,
      triggeringMoveOwner: "self",
      rolls: [
        {
          attackNaturalResult: 25,
          attackResult: 25,
          defenseNaturalResult: 1,
          defenseResult: 1,
          outcome: "successful" as const,
        },
      ],
      collectPendingChoices: true,
    });

    expect(pending.pendingEffectChoices).toEqual([
      expect.objectContaining({ effectIndices: [1] }),
      expect.objectContaining({ effectIndices: [2] }),
    ]);
    expect(
      moveEffectsForTrigger(spinebreaker, "on-success", {
        ...context,
        self: { ...self, moveIds: [spinebreaker.id] },
        triggeringMove: spinebreaker,
        triggeringMoveOwner: "self",
        rolls: [
          {
            attackNaturalResult: 25,
            attackResult: 25,
            defenseNaturalResult: 1,
            defenseResult: 1,
            outcome: "successful" as const,
          },
        ],
        enabledOptionalEffectIndices: [1],
      }).statuses,
    ).toEqual([expect.objectContaining({ target: "opponent" })]);
  });

  it("offers Halcyon Blow only after a prior-turn HP gain", () => {
    const halcyon = moves.get("move-haokiru-halcyon-blow");
    if (halcyon === undefined) throw new Error("Expected Halcyon Blow.");

    const priorAction = {
      type: "use-move" as const,
      decisionId: "decision:halcyon-prior" as never,
      actorId: self.id,
      targetCombatantId: opponent.id,
      moveId: "move-afterlife-spirit-bomb" as never,
      turnNumber: 4,
      phase: "action" as const,
      resourceChanges: [
        {
          affectedCombatantId: self.id,
          resource: "hp" as const,
          operation: "gain" as const,
          amount: 10,
          turnNumber: 4,
        },
      ],
    };
    const pending = moveEffectsForTrigger(halcyon, "on-success", {
      ...context,
      actionHistory: [priorAction],
      collectPendingChoices: true,
    });
    expect(pending.activations).toEqual([
      expect.objectContaining({ effectIndex: 0, optional: true }),
    ]);

    expect(
      moveEffectsForTrigger(halcyon, "on-success", {
        ...context,
        actionHistory: [priorAction],
        enabledOptionalEffectIndices: [0],
      }).activations,
    ).toEqual([expect.objectContaining({ selector: expect.objectContaining({ constant: true }) })]);
    expect(
      moveEffectsForTrigger(halcyon, "on-success", {
        ...context,
        actionHistory: [],
        collectPendingChoices: true,
      }).activations,
    ).toEqual([]);
  });

  it("resolves source-aware prior activation and calculated-cost modifiers", () => {
    const shadowStalker = moves.get("move-kurokonwaku-shadow-stalker");
    const impulsive = moves.get("move-akaikaru-impulsive");
    const sweetDreams = moves.get("move-kurokonwaku-sweet-dreams");
    if (shadowStalker === undefined || impulsive === undefined || sweetDreams === undefined)
      throw new Error("Expected source-aware cost test moves.");

    expect(
      moveEffectsForTrigger(shadowStalker, "passive", {
        ...context,
        self: { ...self, moveUses: { [shadowStalker.id]: 2 } },
      }).currentActionCostModifications,
    ).toEqual([expect.objectContaining({ operation: "add", amount: 2, target: "self" })]);

    expect(
      moveEffectsForTrigger(impulsive, "on-move-use", {
        ...context,
        self: { ...self, moveUses: { [impulsive.id]: 3 } },
        triggeringMove: impulsive,
        triggeringMoveOwner: "self",
      }).currentActionCostModifications,
    ).toEqual([expect.objectContaining({ operation: "add", amount: 6, target: "self" })]);

    expect(
      moveEffectsForTrigger(sweetDreams, "passive", {
        ...context,
        triggeringMove: sweetDreams,
        triggeringMoveOwner: "self",
      }).currentActionCostModifications,
    ).toEqual([
      expect.objectContaining({ operation: "set", amount: 4, minimum: 3, target: "self" }),
    ]);
  });

  it("resolves Shadow Stalker's source-aware KI activation cost", () => {
    const shadowStalker = moves.get("move-kurokonwaku-shadow-stalker");
    if (shadowStalker === undefined) throw new Error("Expected Shadow Stalker.");

    expect(
      moveEffectsForTrigger(shadowStalker, "on-success", {
        ...context,
        triggeringMove: shadowStalker,
        rolls: [
          {
            attackNaturalResult: 25,
            attackResult: 25,
            defenseNaturalResult: 1,
            defenseResult: 1,
            outcome: "successful" as const,
          },
        ],
      }).activations,
    ).toEqual([
      expect.objectContaining({
        activationCost: { amount: 2 },
        sourceDefinitionId: shadowStalker.id,
      }),
    ]);
  });

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

  it("resolves the exact before-defense and stored-roll reroll choices", () => {
    const willingSacrifice = moves.get("move-haokiru-willing-sacrifice");
    const kiTrap = moves.get("move-kurokonwaku-ki-trap");
    if (willingSacrifice === undefined || kiTrap === undefined)
      throw new Error("Expected pending reroll test moves.");

    const beforeDefense = moveEffectsForTrigger(willingSacrifice, "before-defense-roll", {
      ...context,
      self: { ...self, moveIds: [willingSacrifice.id] },
      collectPendingChoices: true,
    });
    expect(beforeDefense.pendingEffectChoices).toEqual([
      expect.objectContaining({ sourceDefinitionId: willingSacrifice.id, effectIndices: [1] }),
    ]);
    expect(
      moveEffectsForTrigger(willingSacrifice, "before-defense-roll", {
        ...context,
        self: { ...self, moveIds: [willingSacrifice.id] },
        enabledOptionalEffectIndices: [1],
      }).rerolls,
    ).toEqual([
      expect.objectContaining({
        target: "opponent",
        roll: "attack",
        rerollScope: "single-result",
        duration: { type: "next-rolls", roll: "attack", remaining: 3 },
      }),
    ]);

    const storedSelf = {
      ...self,
      moveIds: [kiTrap.id],
      storedRolls: {
        "ki-trap-roll": {
          sourceDefinitionId: kiTrap.id,
          storageKey: "ki-trap-roll",
          naturalResults: [12],
          sides: 30,
          storedOnTurn: 5,
        },
      },
    };
    expect(
      rerollEffectsOnRollResult(kiTrap, {
        ...context,
        self: storedSelf,
        rolls: [
          {
            attackNaturalResult: 12,
            attackResult: 12,
            defenseNaturalResult: 5,
            defenseResult: 5,
            outcome: "successful",
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        sourceDefinitionId: kiTrap.id,
        roll: "attack",
        rerollScope: "single-result",
        trigger: "on-roll-result",
        useLimit: { scope: "combat", count: 1 },
      }),
    ]);
  });

  it("resolves deferred successful rerolls with typed future lifecycles", () => {
    const bracedEnergyBeam = moves.get("move-aoyosumu-braced-energy-beam");
    const tigerStrikes = moves.get("move-aoyosumu-tiger-strikes");
    if (bracedEnergyBeam === undefined || tigerStrikes === undefined)
      throw new Error("Expected deferred reroll test moves.");

    const successfulRoll = [
      {
        attackNaturalResult: 20,
        attackResult: 20,
        defenseNaturalResult: 1,
        defenseResult: 1,
        outcome: "successful" as const,
      },
    ];

    expect(
      moveEffectsForTrigger(tigerStrikes, "on-success", {
        ...context,
        triggeringMove: tigerStrikes,
        rolls: successfulRoll,
        enabledOptionalEffectIndices: [0],
      }).rerolls,
    ).toEqual([
      expect.objectContaining({
        target: "self",
        roll: "defense",
        optional: true,
        duration: { type: "next-roll", roll: "defense" },
        resultModifier: 3,
      }),
    ]);

    expect(
      moveEffectsForTrigger(bracedEnergyBeam, "on-success", {
        ...context,
        triggeringMove: bracedEnergyBeam,
        rolls: successfulRoll,
      }).rerolls,
    ).toEqual([
      expect.objectContaining({
        target: "opponent",
        roll: "attack",
        optional: false,
        duration: { type: "next-action" },
        conditions: [
          expect.objectContaining({
            type: "roll-threshold",
            comparison: "at-least",
          }),
        ],
      }),
    ]);
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

    const selfWithHighRoll = {
      ...selfWithLowRoll,
      storedRolls: {
        "healing-ray-result": {
          sourceDefinitionId: healingRay.id,
          storageKey: "healing-ray-result",
          naturalResults: [12],
          sides: 30,
          storedOnTurn: context.turnNumber,
        },
      },
    };
    expect(
      moveEffectsForTrigger(healingRay, "on-roll-result", {
        ...context,
        self: selfWithHighRoll,
        collectPendingChoices: true,
      }).pendingEffectChoices,
    ).toEqual([
      {
        sourceDefinitionId: healingRay.id,
        effectIndices: [1],
        activationGroup: "healing-ray-target",
      },
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

  it("resolves a selected cross-trigger beam response resource effect", () => {
    const x20 = moves.get("move-afterlife-x20-kaioken-kamehameha");
    const beam = moves.get("move-afterlife-kamehameha");
    if (x20 === undefined || beam === undefined) throw new Error("Expected x20 beam moves.");

    expect(
      moveEffectsForTrigger(x20, "on-damage", {
        ...context,
        self: { ...self, moveIds: [x20.id] },
        triggeringMove: beam,
        incomingDamage: 0,
        enabledOptionalEffectIndices: [5],
      }).resources,
    ).toEqual([
      expect.objectContaining({
        resource: "hp",
        operation: "lose",
        amount: 6,
        target: "opponent",
      }),
    ]);
  });

  it("reindexes stored move selections and gates Impulsive modifiers to the selected move", () => {
    const impulsive = moves.get("move-akaikaru-impulsive");
    const backBrainKick = moves.get("move-akaikaru-back-brain-kick");
    const backflipKick = moves.get("move-akaikaru-backflip-kick");
    if (impulsive === undefined || backBrainKick === undefined || backflipKick === undefined)
      throw new Error("Expected Impulsive selection moves.");

    const upkeepEffects = moveEffectsForTrigger(impulsive, "upkeep-phase", {
      ...context,
      self: {
        ...self,
        moveIds: [impulsive.id, backBrainKick.id, backflipKick.id],
      },
    });
    expect(upkeepEffects.storedMoveSelectionRequests).toEqual([
      {
        target: "self",
        sourceDefinitionId: impulsive.id,
        effectIndex: 1,
        storageKey: "impulsive-advanced-attack-index",
        selectionKey: "impulsive-selected-advanced-attack",
        selector: expect.objectContaining({ category: "advanced-attack" }),
        ordering: "character-sheet-top-to-bottom",
        reindex: "on-moveset-change",
      },
    ]);

    const selectedContext = {
      ...context,
      self: {
        ...self,
        moveIds: [impulsive.id, backBrainKick.id, backflipKick.id],
        storedMoveSelections: {
          "impulsive-selected-advanced-attack": {
            sourceDefinitionId: impulsive.id,
            selectionKey: "impulsive-selected-advanced-attack",
            moveId: backflipKick.id,
            selectedOnTurn: context.turnNumber,
          },
        },
      },
      triggeringMove: backflipKick,
    };
    expect(
      moveEffectsForTrigger(impulsive, "passive", selectedContext).damageModifications,
    ).toEqual([expect.objectContaining({ amount: 2, operation: "add", basis: "power-percent" })]);
    expect(
      moveEffectsForTrigger(impulsive, "passive", {
        ...selectedContext,
        triggeringMove: backBrainKick,
      }).damageModifications,
    ).toEqual([]);
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

  it("resolves the exact typed resource listeners without source-text inference", () => {
    const shotgun = moves.get("move-akaikaru-shotgun-blast");
    const dragonPride = moves.get("move-haokiru-dragon-s-pride");
    const kiTrap = moves.get("move-kurokonwaku-ki-trap");
    if (shotgun === undefined || dragonPride === undefined || kiTrap === undefined)
      throw new Error("Expected typed resource-listener moves.");

    const priorShotgun = {
      type: "use-move" as const,
      decisionId: "decision:shotgun-prior" as never,
      actorId: self.id,
      targetCombatantId: opponent.id,
      moveId: shotgun.id,
      turnNumber: 5,
      phase: "action" as const,
      outcome: "successful" as const,
    };
    expect(
      moveEffectsForTrigger(shotgun, "on-roll-modified", {
        ...context,
        self: { ...self, moveIds: [shotgun.id] },
        sourceDefinitionId: shotgun.id,
        turnNumber: 7,
        actionHistory: [priorShotgun],
        currentAction: { ...priorShotgun, decisionId: "decision:shotgun-current" as never },
        rollModification: {
          actor: "self",
          roll: "attack",
          modifiers: ["sides", "result"],
          excludeSource: "dexterity",
        },
      }).resources,
    ).toEqual([expect.objectContaining({ resource: "ki", target: "self", amount: 1 })]);

    expect(
      moveEffectsForTrigger(kiTrap, "on-roll-result", {
        ...context,
        self: {
          ...self,
          moveIds: [kiTrap.id],
          storedRolls: {
            "ki-trap-roll": {
              sourceDefinitionId: kiTrap.id,
              storageKey: "ki-trap-roll",
              naturalResults: [7],
              sides: 30,
              storedOnTurn: 5,
            },
          },
        },
        sourceDefinitionId: kiTrap.id,
        rolls: [
          {
            attackNaturalResult: 7,
            attackResult: 7,
            defenseNaturalResult: 1,
            defenseResult: 1,
            outcome: "successful",
          },
        ],
      }).resources,
    ).toEqual([
      expect.objectContaining({
        resource: "hp",
        target: "opponent",
        amount: 60,
        sourceDefinitionId: kiTrap.id,
        sourceEffectIndex: 1,
        useLimit: { scope: "combat", count: 1 },
        preventable: false,
      }),
    ]);

    expect(
      moveEffectsForTrigger(dragonPride, "start-combat", {
        ...context,
        self: { ...self, specializationPoints: 4 },
        opponent: { ...opponent, specializationPoints: 4 },
        sourceDefinitionId: dragonPride.id,
      }).resources,
    ).toEqual([
      expect.objectContaining({
        resource: "hp",
        target: "self",
        amount: 10,
        activationCost: { resource: "ki", amount: 1 },
      }),
    ]);
  });

  it("applies a stopped-fraction lock only when the persisted attack rolls cross the strict half boundary", () => {
    const anger = moves.get("move-freestyle-anger-manipulation");
    const firestorm = moves.get("move-akaikaru-firestorm");
    if (anger === undefined || firestorm === undefined)
      throw new Error("Expected Anger Manipulation test moves.");

    const stoppedRolls = [
      { attackNaturalResult: 10, attackResult: 10, outcome: "stopped" as const },
      { attackNaturalResult: 11, attackResult: 11, outcome: "stopped" as const },
      { attackNaturalResult: 12, attackResult: 12, outcome: "successful" as const },
    ];
    expect(
      stoppedMoveEffects(anger, {
        ...context,
        triggeringMove: firestorm,
        triggeringMoveOwner: "self",
        rolls: stoppedRolls,
      }).locks,
    ).toEqual([
      expect.objectContaining({
        target: "self",
        affectedType: "attack",
        duration: { type: "turns", remaining: 1 },
      }),
    ]);

    expect(
      stoppedMoveEffects(anger, {
        ...context,
        triggeringMove: firestorm,
        triggeringMoveOwner: "self",
        rolls: [
          stoppedRolls[0],
          { ...stoppedRolls[1], outcome: "successful" as const },
          stoppedRolls[2],
        ],
      }).locks,
    ).toEqual([]);
    expect(
      stoppedMoveEffects(anger, {
        ...context,
        triggeringMove: firestorm,
        triggeringMoveOwner: "self",
        rolls: [
          stoppedRolls[0],
          stoppedRolls[1],
          { ...stoppedRolls[2], outcome: "blocked" as const },
          { attackNaturalResult: 13, attackResult: 13, outcome: "successful" as const },
        ],
      }).locks,
    ).toEqual([]);
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

  it("retains the triggering move selector on successful-effect negation", () => {
    const untroubledMind = moves.get("move-aoyosumu-the-untroubled-mind");
    const triggeringMove = moves.get("move-akaikaru-firestorm");
    if (untroubledMind === undefined || triggeringMove === undefined)
      throw new Error("Expected successful-effect negation test moves.");

    const effects = moveEffectsForTrigger(untroubledMind, "on-success", {
      ...context,
      currentAction: {
        type: "use-move",
        decisionId: "decision:negation-runtime" as never,
        actorId: opponent.id,
        targetCombatantId: self.id,
        moveId: triggeringMove.id,
        turnNumber: 5,
        phase: "action",
        outcome: "successful",
        critical: false,
        counter: false,
      },
      triggeringMove,
      triggeringMoveOwner: "opponent",
    });

    expect(effects.negations).toEqual([
      expect.objectContaining({
        target: "opponent",
        aspects: [],
        selector: expect.objectContaining({ restriction: "unrestricted" }),
      }),
    ]);
  });

  it("serializes a combat-limited successful-effect negation with provenance", () => {
    const suckerPunch = moves.get("move-midorikatai-sucker-punch");
    const triggeringMove = moves.get("move-aoyosumu-the-untroubled-mind");
    if (suckerPunch === undefined || triggeringMove === undefined)
      throw new Error("Expected combat-limited successful-effect negation test moves.");

    const effects = moveEffectsForTrigger(suckerPunch, "on-success", {
      ...context,
      currentAction: {
        type: "use-move",
        decisionId: "decision:limited-negation-runtime" as never,
        actorId: opponent.id,
        targetCombatantId: self.id,
        moveId: triggeringMove.id,
        turnNumber: 5,
        phase: "action",
        outcome: "successful",
        critical: false,
        counter: false,
      },
      triggeringMove,
      triggeringMoveOwner: "opponent",
    });

    expect(effects.negations).toEqual([
      expect.objectContaining({
        sourceDefinitionId: suckerPunch.id,
        sourceEffectIndex: 0,
        useLimit: { scope: "combat", count: 1 },
        selector: expect.objectContaining({ category: "skill", subject: "target" }),
      }),
    ]);
  });

  it("resolves Cancellation Master's on-move-use negation and its triggering cost", () => {
    const mastery = moves.get("move-kurokonwaku-cancellation-mastery");
    const triggeringMove = moves.get("move-freestyle-nullifying-sphere");
    if (mastery === undefined || triggeringMove === undefined)
      throw new Error("Expected Cancellation Mastery runtime test moves.");

    const effects = moveEffectsForTrigger(mastery, "on-move-use", {
      ...context,
      triggeringMove,
      triggeringMoveOwner: "opponent",
      enabledOptionalEffectIndices: [1],
    });

    expect(effects.negations).toEqual([
      expect.objectContaining({
        target: "opponent",
        aspects: [],
        selector: expect.objectContaining({ category: "skill", constant: false }),
        activationCost: { resource: "ki", amount: 1, minimum: 1 },
      }),
    ]);
  });

  it("resolves Leg Vice's opponent on-move-use dexterity restriction", () => {
    const legVice = moves.get("move-midorikatai-leg-vice");
    const triggeringMove = moves.get("move-afterlife-kamehameha");
    if (legVice === undefined || triggeringMove === undefined)
      throw new Error("Expected Leg Vice runtime test moves.");

    const effects = moveEffectsForTrigger(legVice, "on-move-use", {
      ...context,
      triggeringMove,
      triggeringMoveOwner: "opponent",
    });

    expect(effects.statModifications).toEqual([
      expect.objectContaining({
        target: "opponent",
        stat: "dexterity-bonus",
        operation: "set",
        amount: 0,
        duration: expect.objectContaining({ type: "turns", remaining: 2 }),
      }),
    ]);
  });

  it("resolves a selected successful attack's current-resolution suppression", () => {
    const breakout = moves.get("move-aoyosumu-breakout");
    const triggeringMove = moves.get("move-akaikaru-firestorm");
    if (breakout === undefined || triggeringMove === undefined)
      throw new Error("Expected current-resolution suppression test moves.");

    const effects = moveEffectsForTrigger(breakout, "on-success", {
      ...context,
      currentAction: {
        type: "use-move",
        decisionId: "decision:suppression-runtime" as never,
        actorId: opponent.id,
        targetCombatantId: self.id,
        moveId: triggeringMove.id,
        turnNumber: 5,
        phase: "action",
        outcome: "successful",
        critical: false,
        counter: false,
      },
      triggeringMove,
      triggeringMoveOwner: "opponent",
    });

    expect(effects.suppressions).toEqual([
      expect.objectContaining({
        target: "opponent",
        aspects: ["all-effects"],
        duration: { type: "current-resolution" },
        selector: expect.objectContaining({ category: "advanced-attack" }),
      }),
    ]);
  });

  it("resolves blocked attack damage only when the block phase supplies it", () => {
    const display = moves.get("move-haokiru-display-of-endurance");
    if (display === undefined) throw new Error("Expected Display of Endurance.");

    const stopped = stoppedMoveEffects(display, { ...context, blockedAttackDamage: 7 });
    expect(stopped.resources).toEqual([
      expect.objectContaining({ resource: "hp", operation: "lose", amount: 4 }),
    ]);
    expect(stopped.floatingEffects).toEqual([
      expect.objectContaining({
        floatingEffectId: "display-of-endurance-blocked-damage-heal",
        blockedAttackDamage: 7,
      }),
    ]);
    const doubleArmCannon = moves.get("move-haokiru-double-arm-cannon");
    if (doubleArmCannon === undefined) throw new Error("Expected Double Arm Cannon.");
    expect(
      successfulMoveEffects(doubleArmCannon, {
        ...context,
        includeActiveFloatingEffects: true,
        activeEffects: [
          {
            id: "active-effect:display-endurance-heal" as never,
            type: "floating-effect",
            sourceCombatantId: self.id,
            targetCombatantId: self.id,
            sourceDefinitionId: display.id,
            sourceEffectIndex: 1,
            floatingEffectId: stopped.floatingEffects[0].floatingEffectId,
            effects: stopped.floatingEffects[0].effects,
            termination: stopped.floatingEffects[0].termination,
            scope: { type: "combat" },
            blockedAttackDamage: 7,
            createdOnTurn: 5,
          },
        ],
      }).resources,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resource: "hp", operation: "gain", amount: 7 }),
      ]),
    );
    expect(stoppedMoveEffects(display, context).resources).toEqual([]);
  });

  it("resolves an activation-unavailable floating condition from its transition context", () => {
    const monkeySweep = moves.get("move-freestyle-monkey-sweep");
    if (monkeySweep === undefined) throw new Error("Expected Monkey Sweep.");

    expect(
      successfulMoveEffects(monkeySweep, {
        ...context,
        activationUnavailableSelectors: [
          {
            type: "move-selector",
            subject: "source",
            ids: ["move-freestyle-monkey-maneuvers"],
            sourceText: "cannot be activated by this attack",
          },
        ],
      }).floatingEffects,
    ).toEqual([
      expect.objectContaining({
        floatingEffectId: "monkey-sweep-unavailable-next-stun-or-break-bonus",
        scope: expect.objectContaining({ type: "next-action" }),
      }),
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
    const soulBreaker = moves.get("move-haokiru-soul-breaker");
    if (soulBreaker === undefined) throw new Error("Expected Soul Breaker data.");
    expect(moveEffectsForTrigger(soulBreaker, "on-success", context).suppressions).toEqual([
      expect.objectContaining({
        aspects: ["successful-effects"],
        duration: { type: "following-action", remaining: 2 },
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

  it("narrows the paired Breaking the Cycle suppressions to the selected moves", () => {
    const breaking = moves.get("move-kurokonwaku-breaking-the-cycle");
    const selectedMoveId = "move-kurokonwaku-darkness-buster" as const;
    if (breaking === undefined || moves.get(selectedMoveId) === undefined)
      throw new Error("Expected Breaking the Cycle suppression data.");

    expect(
      moveEffectsForTrigger(breaking, "on-success", {
        ...context,
        self: { ...self, moveIds: [selectedMoveId] },
        opponent: { ...opponent, moveIds: [selectedMoveId] },
        enabledOptionalEffectIndices: [1, 2],
      }).suppressions,
    ).toEqual([]);

    expect(
      moveEffectsForTrigger(breaking, "on-success", {
        ...context,
        self: { ...self, moveIds: [selectedMoveId] },
        opponent: { ...opponent, moveIds: [selectedMoveId] },
        enabledOptionalEffectIndices: [1, 2],
        selectedSuppressionMoveIds: { 1: selectedMoveId, 2: selectedMoveId },
      }).suppressions,
    ).toEqual([
      expect.objectContaining({ target: "self", selectedMoveId }),
      expect.objectContaining({ target: "opponent", selectedMoveId }),
    ]);
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

  it("persists and executes Spiked Ball's selected-move Ki-drain replacement", () => {
    const spikedBall = moves.get("move-kurokonwaku-spiked-ball");
    const dimensionScream = moves.get("move-kurokonwaku-dimension-scream");
    if (spikedBall === undefined || dimensionScream === undefined)
      throw new Error("Expected Spiked Ball data.");

    const selected = successfulMoveEffects(spikedBall, {
      ...context,
      triggeringMove: spikedBall,
      enabledOptionalEffectIndices: [1, 2],
      selectedMoveIds: { 1: dimensionScream.id },
    });
    expect(selected.moveEffectReplacements).toEqual([
      expect.objectContaining({
        sourceDefinitionId: spikedBall.id,
        sourceEffectIndex: 2,
        target: "self",
        targetMoveId: dimensionScream.id,
        replacement: expect.objectContaining({
          trigger: "on-resource-drain",
          resource: "ki",
          operation: "gain",
        }),
      }),
    ]);

    const activeReplacement = {
      id: "active-effect:spiked-ball-runtime" as never,
      type: "move-effect-replacement" as const,
      sourceCombatantId: self.id,
      targetCombatantId: self.id,
      sourceDefinitionId: spikedBall.id,
      sourceEffectIndex: 2,
      targetMoveId: dimensionScream.id,
      replacement: selected.moveEffectReplacements![0].replacement,
      remainingTriggers: 1,
    };
    expect(
      moveEffectsForTrigger(dimensionScream, "on-resource-drain", {
        ...context,
        self: { ...self, moveIds: [dimensionScream.id] },
        activeEffects: [activeReplacement],
        resourceChange: {
          subject: "self",
          resource: "ki",
          operation: "lose",
          amount: 3,
        },
      }).resources,
    ).toEqual([
      expect.objectContaining({
        target: "self",
        resource: "ki",
        operation: "gain",
        amount: 3,
      }),
    ]);
  });

  it("gates successful effects only after Rage Mastery's grouped activation is selected", () => {
    const rageMastery = moves.get("move-akaikaru-rage-mastery");
    const spikedBall = moves.get("move-kurokonwaku-spiked-ball");
    const chainedStrikes = moves.get("move-akaikaru-chained-strikes");
    if (rageMastery === undefined || spikedBall === undefined || chainedStrikes === undefined)
      throw new Error("Expected Rage Mastery and Spiked Ball data.");

    const passive = moveEffectsForTrigger(rageMastery, "passive", {
      ...context,
      self: { ...self, moveIds: [rageMastery.id, "move-akaikaru-chained-strikes"] },
      triggeringMove: chainedStrikes,
      enabledOptionalEffectIndices: [0, 1],
      resolvedOptionalEffectIndices: [0, 1],
    });
    expect(passive.requireAllDiceSuccess).toBe(true);

    const incomplete = successfulMoveEffects(spikedBall, {
      ...context,
      successfulHitCount: 1,
      rolls: [
        { attackNaturalResult: 20, attackResult: 20, outcome: "successful" },
        { attackNaturalResult: 1, attackResult: 1, outcome: "stopped" },
      ],
      successfulEffectsRequireAllDice: passive.requireAllDiceSuccess,
    });
    expect(incomplete.resources).toEqual([]);
    expect(incomplete.remainingUseModifications).toEqual([]);

    const complete = successfulMoveEffects(spikedBall, {
      ...context,
      successfulHitCount: 2,
      rolls: [
        { attackNaturalResult: 20, attackResult: 20, outcome: "successful" },
        { attackNaturalResult: 21, attackResult: 21, outcome: "successful" },
      ],
      successfulEffectsRequireAllDice: passive.requireAllDiceSuccess,
      enabledOptionalEffectIndices: [1, 2],
    });
    expect(complete.remainingUseModifications).toHaveLength(1);
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
        sourceDefinitionId: "move-akaikaru-chained-strikes",
        useLimit: expect.objectContaining({ scope: "turn", count: 1 }),
        effectIndex: 0,
      },
    ]);
  });

  it("dispatches a next-turn upkeep extra action with its declared phase", () => {
    const destructoDisc = moves.get("move-afterlife-destructo-disc");
    if (destructoDisc === undefined) throw new Error("Expected Destructo Disc data.");

    expect(
      moveEffectsForTrigger(destructoDisc, "on-success", {
        ...context,
        rolls: [
          {
            attackNaturalResult: 20,
            attackResult: 20,
            defenseNaturalResult: 1,
            defenseResult: 1,
            outcome: "successful",
          },
        ],
      }).extraActions,
    ).toEqual([
      {
        target: "self",
        phase: "upkeep",
        moveCategory: "power-up",
        sourceMoveOnly: false,
        scope: "next-turn",
        sourceDefinitionId: "move-afterlife-destructo-disc",
        effectIndex: 0,
      },
    ]);
  });

  it("retains exact activation costs on action and next-turn upkeep applications", () => {
    const limbTwist = moves.get("move-akaikaru-limb-twist");
    const launchingKick = moves.get("move-kurokonwaku-launching-kick");
    if (limbTwist === undefined || launchingKick === undefined)
      throw new Error("Expected activation-cost extra-action data.");

    expect(
      moveEffectsForTrigger(limbTwist, "on-success", {
        ...context,
        enabledOptionalEffectIndices: [0],
      }).extraActions,
    ).toEqual([
      expect.objectContaining({
        phase: "action",
        scope: "current-turn",
        activationCost: { resource: "ki", amount: 1 },
      }),
    ]);
    expect(
      moveEffectsForTrigger(launchingKick, "on-success", {
        ...context,
        enabledOptionalEffectIndices: [0],
      }).extraActions,
    ).toEqual([
      expect.objectContaining({
        phase: "upkeep",
        scope: "next-turn",
        activationCost: { resource: "ki", amount: 1 },
      }),
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
            moveId: "move-afterlife-masenko",
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

  it("applies cap-only damage modifiers and totals the last advanced attacks", () => {
    const tornadoUppercut = moves.get("move-haokiru-tornado-uppercut");
    const vengeanceWave = moves.get("move-haokiru-vengeance-wave");
    if (tornadoUppercut === undefined || vengeanceWave === undefined)
      throw new Error("Expected Haokiru damage definitions.");

    expect(adjustedMoveDamage(tornadoUppercut, 20, context)).toBe(11);
    expect(
      moveEffectsForTrigger(vengeanceWave, "passive", {
        ...context,
        actionHistory: [
          {
            type: "use-move",
            decisionId: "decision:prior-vengeance-one" as never,
            actorId: opponent.id,
            targetCombatantId: self.id,
            moveId: "move-afterlife-masenko",
            turnNumber: 3,
            phase: "action",
            outcome: "successful",
            damageDealt: 10,
          },
          {
            type: "use-move",
            decisionId: "decision:prior-vengeance-two" as never,
            actorId: opponent.id,
            targetCombatantId: self.id,
            moveId: "move-afterlife-masenko",
            turnNumber: 4,
            phase: "action",
            outcome: "successful",
            damageDealt: 20,
          },
        ],
      }).damageModifications,
    ).toEqual([
      expect.objectContaining({
        operation: "set",
        amount: 30,
        basis: "power-percent",
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

  it("matches a floating bundle only when the current attack targets its retained target", () => {
    const solarFlare = moves.get("move-afterlife-solar-flare");
    const triggeringMove = moves.get("move-afterlife-kamehameha");
    const nestedBundle = solarFlare?.effects?.[2];
    if (
      solarFlare === undefined ||
      triggeringMove === undefined ||
      nestedBundle?.type !== "create-floating-effect"
    )
      throw new Error("Expected Solar Flare's same-target floating bundle.");

    const activeFloating = {
      id: "active-effect:solar-flare-same-target" as never,
      type: "floating-effect" as const,
      sourceCombatantId: self.id,
      targetCombatantId: opponent.id,
      sourceDefinitionId: solarFlare.id,
      sourceEffectIndex: 2,
      floatingEffectId: nestedBundle.floatingEffectId,
      effects: nestedBundle.effects ?? [],
      termination: [],
      scope: { type: "next-action" as const },
      createdOnTurn: context.turnNumber,
    };
    const currentAction = {
      type: "use-move" as const,
      decisionId: "decision:solar-flare-same-target" as never,
      actorId: self.id,
      targetCombatantId: opponent.id,
      moveId: triggeringMove.id,
      turnNumber: context.turnNumber,
      phase: "action" as const,
    };

    expect(
      moveEffectsForTrigger(solarFlare, "before-attack-roll", {
        ...context,
        triggeringMove,
        currentAction,
        activeEffects: [activeFloating],
        includeActiveFloatingEffects: true,
      }).rollDefinitions,
    ).toEqual([expect.objectContaining({ target: "self", sides: 35 })]);

    expect(
      moveEffectsForTrigger(solarFlare, "before-attack-roll", {
        ...context,
        triggeringMove,
        currentAction: { ...currentAction, targetCombatantId: self.id },
        activeEffects: [activeFloating],
        includeActiveFloatingEffects: true,
      }).rollDefinitions,
    ).toEqual([]);
  });

  it("resolves floating activation costs and combat limits as typed application data", () => {
    const hiddenPower = moves.get("move-freestyle-hidden-power-level");
    if (hiddenPower === undefined) throw new Error("Expected Hidden Power Level.");

    const floating = moveEffectsForTrigger(hiddenPower, "upkeep-phase", {
      ...context,
      self: { ...self, ki: { current: 8, maximum: 10 } },
    }).floatingEffects;

    expect(floating).toEqual([
      expect.objectContaining({
        sourceEffectIndex: 0,
        floatingEffectId: "hidden-power-level-zero-ki-recovery",
        activationCost: { resource: "ki", amount: 2 },
        useLimit: { scope: "combat", count: 1 },
      }),
    ]);
  });

  it("resolves a floating bundle's direct attack-roll threshold duration", () => {
    const dragonDust = moves.get("move-haokiru-dragon-dust");
    if (dragonDust === undefined) throw new Error("Expected Dragon Dust.");

    expect(moveEffectsForTrigger(dragonDust, "on-success", context).floatingEffects).toEqual([
      expect.objectContaining({
        floatingEffectId: "dragon-dust-hp-gain-retaliation",
        target: "opponent",
        duration: {
          type: "until-roll-threshold",
          roll: "attack",
          comparison: "at-least",
          value: 23,
        },
        useLimit: { scope: "turn", count: 1 },
      }),
    ]);
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

  it("creates Backflip Kick's floating application from the fully resolved die", () => {
    const backflipKick = moves.get("move-akaikaru-backflip-kick");
    if (backflipKick === undefined) throw new Error("Expected Backflip Kick data.");

    const effects = moveEffectsForTrigger(backflipKick, "on-roll-result", {
      ...context,
      rolls: [
        {
          attackNaturalResult: 30,
          attackResult: 30,
          defenseNaturalResult: 1,
          defenseResult: 1,
          outcome: "successful" as const,
        },
      ],
    });

    expect(effects.floatingEffects).toEqual([
      expect.objectContaining({
        sourceEffectIndex: 0,
        floatingEffectId: "backflip-kick-next-dexterity-stun",
        scope: expect.objectContaining({ type: "next-action" }),
      }),
    ]);
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

  it("resolves historical opponent-effect KI loss for Halting Stance", () => {
    const haltingStance = moves.get("move-haokiru-halting-stance");
    if (haltingStance === undefined) throw new Error("Expected Halting Stance data.");
    const currentAction = {
      type: "use-move" as const,
      decisionId: "decision:halting-stance" as never,
      actorId: self.id,
      targetCombatantId: opponent.id,
      moveId: haltingStance.id,
      outcome: "stopped" as const,
      critical: false,
      counter: false,
      turnNumber: 5,
      phase: "action" as const,
    };
    const priorOpponentAction = {
      type: "use-move" as const,
      decisionId: "decision:opponent-ki-drain" as never,
      actorId: opponent.id,
      targetCombatantId: self.id,
      moveId: "move-afterlife-life-drain" as never,
      turnNumber: 2,
      phase: "action" as const,
      resourceChanges: [
        {
          affectedCombatantId: self.id,
          resource: "ki" as const,
          operation: "lose" as const,
          amount: 2,
          turnNumber: 2,
          cause: "opponent-effect" as const,
        },
      ],
    };

    expect(
      moveEffectsForTrigger(haltingStance, "on-stopped", {
        ...context,
        currentAction,
        actionHistory: [priorOpponentAction],
      }).remainingUseModifications,
    ).toEqual([
      expect.objectContaining({
        amount: 1,
        selector: expect.objectContaining({ ids: [haltingStance.id] }),
      }),
    ]);
    expect(
      moveEffectsForTrigger(haltingStance, "on-stopped", {
        ...context,
        currentAction,
        actionHistory: [],
      }).remainingUseModifications,
    ).toEqual([]);
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
    ).toEqual([
      expect.objectContaining({
        operation: "multiply",
        amount: 150,
        basis: "damage-percent",
        target: "opponent",
      }),
    ]);
    expect(
      moveEffectsForTrigger(muscleInfusion, "on-damage", responseContext).damageModifications,
    ).toEqual([]);

    expect(
      moveEffectsForTrigger(muscleInfusion, "on-damage", {
        ...responseContext,
        collectPendingChoices: true,
      }).pendingEffectChoices,
    ).toEqual([{ effectIndices: [0], sourceDefinitionId: muscleInfusion.id }]);

    expect(
      moveEffectsForTrigger(muscleInfusion, "on-damage", {
        ...responseContext,
        enabledOptionalEffectIndices: [0],
      }).damageModifications,
    ).toEqual([
      expect.objectContaining({
        operation: "add",
        amount: -50,
        target: "opponent",
        sourceCombatantId: opponent.id,
        sourceDefinitionId: muscleInfusion.id,
        useLimit: { scope: "combat", count: 2 },
        activationCost: { resource: "ki", amount: 1 },
      }),
    ]);
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

  it("keeps effect prevention lifecycle scopes explicit and deterministic", () => {
    const stateOfZen = moves.get("move-aoyosumu-state-of-zen");
    const healingRay = moves.get("move-haokiru-healing-ray");
    const staticShot = moves.get("move-kiihakai-static-shot");
    if (stateOfZen === undefined || healingRay === undefined || staticShot === undefined)
      throw new Error("Expected effect-prevention scope test moves.");

    expect(
      moveEffectsForTrigger(stateOfZen, "passive", context).moveModificationPreventions,
    ).toEqual([expect.objectContaining({ aspects: ["dice-sides", "effects", "roll-results"] })]);
    expect(
      moveEffectsForTrigger(staticShot, "on-success", {
        ...context,
        triggeringMove: staticShot,
        rolls: [
          {
            attackNaturalResult: 20,
            attackResult: 20,
            defenseNaturalResult: 1,
            defenseResult: 1,
            outcome: "successful" as const,
          },
        ],
      }).moveModificationPreventions,
    ).toEqual([expect.objectContaining({ availableFromTurn: context.turnNumber + 1 })]);

    const storedRolls = {
      "healing-ray-result": {
        sourceDefinitionId: healingRay.id,
        storageKey: "healing-ray-result",
        naturalResults: [12],
        sides: 30,
        storedOnTurn: context.turnNumber,
      },
    };
    expect(
      moveEffectsForTrigger(healingRay, "on-roll-result", {
        ...context,
        self: { ...self, storedRolls },
      }).currentActionMoveModificationPreventions,
    ).toEqual([
      expect.objectContaining({
        aspects: ["effects"],
        selector: expect.objectContaining({ ids: [healingRay.id] }),
      }),
    ]);
  });

  it("emits converted successful resource and status changes when their condition matches", () => {
    const lightGrenade = moves.get("move-afterlife-light-grenade");
    const meteorSmash = moves.get("move-afterlife-meteor-smash");
    const breakerBreaker = moves.get("move-midorikatai-breaker-breaker");
    if (lightGrenade === undefined || meteorSmash === undefined || breakerBreaker === undefined)
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
    expect(successfulMoveEffects(breakerBreaker, { ...context, turnNumber: 1 }).statuses).toEqual([
      expect.objectContaining({
        target: "opponent",
        status: expect.objectContaining({
          statusId: "break",
          sourceDefinitionId: breakerBreaker.id,
          duration: expect.objectContaining({ type: "turns", remaining: 1 }),
        }),
      }),
    ]);
    expect(successfulMoveEffects(breakerBreaker, context).statuses).toEqual([]);
  });

  it("matches passive combat-outcome conditions against durable outcome statuses", () => {
    const monkeySweep = moves.get("move-freestyle-monkey-sweep");
    if (monkeySweep === undefined) throw new Error("Expected Monkey Sweep.");

    const effects = moveEffectsForTrigger(monkeySweep, "passive", {
      ...context,
      opponent: {
        ...opponent,
        activeStatuses: [
          {
            statusId: "break",
            sourceCombatantId: self.id,
            sourceDefinitionId: "move-afterlife-meteor-smash",
            stacks: 1,
            duration: { type: "combat" as const },
          },
        ],
      },
    });

    expect(effects.resolutionPreventions).toEqual([{ target: "self", prevention: "block" }]);
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
      {
        target: "self",
        roll: "attack",
        modifier: "result",
        amount: 3,
        sourceDefinitionId: "move-afterlife-light-grenade",
        sourceEffectIndex: 0,
      },
      {
        target: "self",
        roll: "attack",
        modifier: "sides",
        amount: 2,
        sourceDefinitionId: "move-afterlife-light-grenade",
        sourceEffectIndex: 1,
      },
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
        sourceDefinitionId: "move-afterlife-light-grenade",
        sourceEffectIndex: 0,
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
      {
        target: "self",
        roll: "attack",
        dice: 2,
        sides: 20,
        sourceDefinitionId: "move-afterlife-light-grenade",
        sourceEffectIndex: 0,
      },
    ]);
  });

  it("extracts the exact current-action and next-roll selection applications", () => {
    const applications = [
      moveEffectsForTrigger(moves.get("move-akaikaru-bullrush")!, "on-success", {
        ...context,
        successfulHitCount: 2,
      }).rollSelections,
      moveEffectsForTrigger(moves.get("move-aoyosumu-floating-drop")!, "on-success", {
        ...context,
        actionHistory: [
          {
            type: "use-move" as const,
            decisionId: "decision:prior" as never,
            actorId: self.id,
            targetCombatantId: opponent.id,
            moveId: "move-aoyosumu-floating-drop",
            turnNumber: 4,
            phase: "action" as const,
            outcome: "stopped" as const,
            critical: false,
            counter: false,
          },
        ],
      }).rollSelections,
      moveEffectsForTrigger(moves.get("move-kiihakai-fade-attack")!, "passive", context)
        .rollSelections,
    ];

    expect(applications).toEqual([
      [
        expect.objectContaining({
          roll: "attack",
          diceCount: 2,
          selection: "highest",
          scope: "next-roll",
        }),
      ],
      [],
      [
        expect.objectContaining({
          roll: "defense",
          diceCount: 2,
          selection: "lowest",
          scope: "current-action",
        }),
      ],
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
      [
        {
          target: "self",
          roll: "defense",
          value: 0,
          resultScope: "matching-die",
          sourceDefinitionId: "move-afterlife-light-grenade",
          sourceEffectIndex: 0,
        },
      ],
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

  it("collects and resolves Power Boost's exact action-phase skip choice", () => {
    const powerBoost = moves.get("move-kiihakai-power-boost");
    if (powerBoost === undefined) throw new Error("Expected Power Boost data.");
    const pending = moveEffectsForTrigger(powerBoost, "action-phase", {
      ...context,
      collectPendingChoices: true,
    });
    expect(pending.pendingEffectChoices).toEqual([
      {
        sourceDefinitionId: powerBoost.id,
        effectIndices: [0],
      },
    ]);
    expect(
      moveEffectsForTrigger(powerBoost, "action-phase", {
        ...context,
        enabledOptionalEffectIndices: [0],
        resolvedOptionalEffectIndices: [0],
      }).actionRestrictions,
    ).toEqual([{ target: "self", remainingTurns: 1, effectIndex: 0 }]);
  });

  it("stops only a matching non-Signature attack for Focus Breaker", () => {
    const focusBreaker = moves.get("move-kiihakai-focus-breaker");
    const energyAttack = moves.get("move-afterlife-masenko");
    const signature = moves.get("move-afterlife-spirit-bomb");
    if (focusBreaker === undefined || energyAttack === undefined || signature === undefined)
      throw new Error("Expected Focus Breaker test data.");
    expect(
      moveEffectsForTrigger(focusBreaker, "before-defense-roll", {
        ...context,
        triggeringMove: energyAttack,
        enabledOptionalEffectIndices: [0],
      }).combatResultOverrides,
    ).toEqual([{ target: "opponent", result: "stopped", resultScope: "current-attack" }]);
    expect(
      moveEffectsForTrigger(focusBreaker, "before-defense-roll", {
        ...context,
        triggeringMove: signature,
        enabledOptionalEffectIndices: [0],
      }).combatResultOverrides,
    ).toEqual([]);
  });

  it("resolves High Threshold's exact total-HP defense substitution", () => {
    const highThreshold = moves.get("move-haokiru-high-threshold");
    const energyAttack = moves.get("move-afterlife-masenko");
    if (highThreshold === undefined || energyAttack === undefined)
      throw new Error("Expected High Threshold test data.");
    const effects = moveEffectsForTrigger(highThreshold, "before-defense-roll", {
      ...context,
      triggeringMove: energyAttack,
      enabledOptionalEffectIndices: [0],
    });
    expect(effects.resources).toEqual([
      {
        resource: "hp",
        target: "self",
        operation: "lose",
        amount: 10,
        cause: "non-damage-effect",
      },
    ]);
    expect(effects.combatResultOverrides).toEqual([
      { target: "opponent", result: "stopped", resultScope: "current-attack" },
    ]);
  });

  it("resolves passive slot capacity changes with source provenance", () => {
    const mastery = moves.get("move-aoyosumu-technique-mastery");
    if (mastery === undefined) throw new Error("Expected Technique Mastery data.");

    expect(moveEffectsForTrigger(mastery, "passive", context).slotCapacityModifications).toEqual([
      {
        sourceCombatantId: self.id,
        sourceDefinitionId: mastery.id,
        sourceEffectIndex: 0,
        slot: "skill",
        amount: 1,
      },
    ]);
  });

  it("retains Smackdown requirement suppression and Domination reduction cost", () => {
    const smackdown = moves.get("move-midorikatai-smackdown");
    const domination = moves.get("move-midorikatai-domination-mastery");
    if (smackdown === undefined || domination === undefined)
      throw new Error("Expected Midorikatai mastery data.");

    const smackdownEffects = moveEffectsForTrigger(smackdown, "on-success", {
      ...context,
      triggeringMove: smackdown,
    });
    expect(smackdownEffects.suppressions).toEqual([
      expect.objectContaining({
        requirement: "Bukujutsu",
        aspects: [],
        duration: { type: "turns", remaining: 2 },
      }),
    ]);

    const dominationEffects = moveEffectsForTrigger(domination, "passive", {
      ...context,
      triggeringMove: smackdown,
    });
    expect(dominationEffects.damageReductionCostModifications).toEqual([
      expect.objectContaining({ amount: 1, resource: "ki", reductions: "reduce-or-nullify" }),
    ]);
  });
});
