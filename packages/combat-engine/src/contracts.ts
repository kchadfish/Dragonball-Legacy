import { GLOBAL_RULES, type RulesVersion } from "@dragonball-resurgence/game-config";
import type {
  ItemId,
  MoveId,
  MoveSelectorCondition,
  StatusId,
  TransformationId,
} from "@dragonball-resurgence/game-data";
import { z } from "zod";

import type {
  ActiveEffectId,
  CombatDecisionId,
  CombatEventId,
  CombatantId,
  FightId,
  PendingDecisionId,
  ResolutionFrameId,
} from "./ids.js";

export type CombatMode = "spar" | "battle";

export type CombatPhase = "upkeep" | "action" | "counter" | "end";

export interface CombatResources {
  readonly current: number;
  readonly maximum: number;
}

export interface CombatantStats {
  readonly power: number;
  readonly dexterity: number;
  readonly dexterityBonus: number;
}

/** A combat-local status whose semantics remain owned by game data and the effect runtime. */
export interface ActiveStatus {
  readonly statusId: StatusId;
  readonly sourceCombatantId: CombatantId;
  readonly sourceDefinitionId: string;
  readonly stacks: number;
  readonly duration:
    | { readonly type: "combat" }
    | {
        readonly type: "turns";
        readonly ownerCombatantId: CombatantId;
        readonly remaining: number;
      }
    | { readonly type: "uses"; readonly remaining: number };
}

/** The transformation currently active on a combatant; permanent unlocks remain outside combat. */
export interface ActiveTransformation {
  readonly transformationId: TransformationId;
  readonly activatedOnTurn: number;
  readonly baseline?: {
    readonly currentHitPoints: number;
    readonly maximumHitPoints: number;
    readonly stats: CombatantStats;
  };
}

export interface CombatantState {
  readonly id: CombatantId;
  readonly hitPoints: CombatResources;
  readonly ki: CombatResources;
  readonly stats: CombatantStats;
  readonly moveIds: readonly MoveId[];
  readonly itemIds?: readonly ItemId[];
  readonly transformationIds?: readonly TransformationId[];
  readonly moveUses: Readonly<Record<MoveId, number>>;
  /** Per-fight consumption counts for combat-usable inventory items. */
  readonly itemUses?: Readonly<Record<ItemId, number>>;
  readonly activeStatuses: readonly ActiveStatus[];
  readonly transformation?: ActiveTransformation;
  readonly status: "active" | "defeated";
}

const createFightCombatantInputSchema = z
  .object({
    maximumHitPoints: z.number().positive(),
    stats: z
      .object({
        power: z.number().nonnegative(),
        dexterity: z.number().nonnegative(),
        dexterityBonus: z
          .number()
          .min(GLOBAL_RULES.combat.minimumDexterityBonus)
          .max(GLOBAL_RULES.combat.maximumDexterityBonus),
      })
      .strict(),
    moveIds: z.array(z.string().min(1)).superRefine((moveIds, context) => {
      const seenMoveIds = new Set<string>();

      for (const [index, moveId] of moveIds.entries()) {
        if (seenMoveIds.has(moveId)) {
          context.addIssue({
            code: "custom",
            message: "Move IDs must not contain duplicates.",
            path: [index],
          });
        }
        seenMoveIds.add(moveId);
      }
    }),
    itemIds: z
      .array(z.string().min(1))
      .superRefine((itemIds, context) => {
        const seenItemIds = new Set<string>();
        for (const [index, itemId] of itemIds.entries()) {
          if (seenItemIds.has(itemId)) {
            context.addIssue({
              code: "custom",
              message: "Item IDs must not contain duplicates.",
              path: [index],
            });
          }
          seenItemIds.add(itemId);
        }
      })
      .optional(),
    transformationIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const createFightInputSchema = z
  .object({
    mode: z.enum(["spar", "battle"]),
    combatants: z.tuple([createFightCombatantInputSchema, createFightCombatantInputSchema]),
  })
  .strict();

export type CreateFightInput = z.output<typeof createFightInputSchema>;

export interface FightSetupIssue {
  readonly path: string;
  readonly message: string;
}

export interface PendingDecisionOption {
  readonly id: string;
  readonly type:
    | "activate-effect"
    | "decline"
    | "roll-defense"
    | "select-combatant"
    | "select-move"
    | "use-block";
  readonly combatantId?: CombatantId;
  readonly itemId?: ItemId;
  readonly moveId?: MoveId;
}

export interface PendingDecision {
  readonly id: PendingDecisionId;
  readonly stateVersion: number;
  readonly combatantId: CombatantId;
  readonly type:
    | "defense-response"
    | "post-defense-roll"
    | "optional-effect"
    | "select-combatant"
    | "select-move";
  readonly options: readonly PendingDecisionOption[];
}

export interface AdvancedAttackCostSelector {
  readonly category: "advanced-attack";
  readonly baseKiCost: number;
}

/** A serializable temporary modifier that expires after one matching action. */
export interface ActiveCostModifierEffect {
  readonly id: ActiveEffectId;
  readonly type: "modify-ki-cost";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly amount: number;
  readonly selector: AdvancedAttackCostSelector;
  readonly scope: "next-eligible-action";
}

/** A combat-persistent item modifier applied to a named roll before it is made. */
export interface ActiveRollModifierEffect {
  readonly id: ActiveEffectId;
  readonly type: "modify-roll";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: ItemId;
  readonly roll: "attack" | "defense";
  readonly modifier: "result" | "sides";
  readonly amount: number;
  readonly duration: "combat";
}

/** A resolved move effect that modifies its owner's immediately following action. */
export interface ActiveNextActionModifierEffect {
  readonly id: ActiveEffectId;
  readonly type: "modify-next-action";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly modifier:
    | { readonly type: "damage"; readonly amount: number }
    | {
        readonly type: "roll";
        readonly roll: "attack" | "defense";
        readonly modifier: "result" | "sides";
        readonly amount: number;
      };
}

/** A combat-item damage bonus retained until its declared attack uses are spent. */
export interface ActiveItemDamageModifierEffect {
  readonly id: ActiveEffectId;
  readonly type: "modify-item-next-attack-damage";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: ItemId;
  readonly amount: number;
  readonly remainingAttacks: number;
}

/** A serialized instruction limiting its target's immediately next action. */
export interface ActiveForcedActionEffect {
  readonly id: ActiveEffectId;
  readonly type: "force-next-action";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly allowedCategories: readonly ("advanced-attack" | "signature")[];
  readonly allowedTags?: readonly string[];
  readonly allowPass: boolean;
  readonly fallback?: "basic-attack";
}

/** A serialized, target-local prohibition created by a converted LOCK effect. */
export interface ActiveActionLockEffect {
  readonly id: ActiveEffectId;
  readonly type: "action-lock";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly affectedType: "attack" | "block" | "escape" | "mastery" | "move" | "power-up" | "skill";
  readonly selector?: MoveSelectorCondition;
  readonly duration:
    | { readonly type: "combat" }
    | { readonly type: "turns"; readonly ownerCombatantId: CombatantId; readonly remaining: number }
    | {
        readonly type: "until-roll-threshold";
        readonly combatantId: CombatantId;
        readonly roll: "attack" | "defense" | "transformation";
        readonly comparison: "at-least" | "at-most";
        readonly value: number;
      }
    | {
        readonly type: "until-resource-threshold";
        readonly combatantId: CombatantId;
        readonly resource: "hp" | "ki";
        readonly comparison: "at-least" | "at-most";
        readonly value: number;
      }
    | {
        readonly type: "until-combat-result";
        readonly combatantId: CombatantId;
        readonly result: "successful" | "stopped" | "critical" | "counter";
        readonly selector?: MoveSelectorCondition;
      }
    | {
        readonly type: "until-turn-start-roll-threshold";
        readonly combatantId: CombatantId;
        readonly dice: number;
        readonly sides: number;
        readonly comparison: "at-least" | "at-most";
        readonly value: number;
        readonly remainingIgnoredChecks: number;
      };
}

/** A selector-scoped prevention retained independently from ordinary action locks. */
export interface ActiveMoveUsePreventionEffect {
  readonly id: ActiveEffectId;
  readonly type: "prevent-move-use";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly operation: "use" | "activate" | "deactivate";
  readonly selector?: MoveSelectorCondition;
  readonly duration: ActiveActionLockEffect["duration"];
}

/** A duration-bound prohibition on applying a specific combat status. */
export interface ActiveStatusPreventionEffect {
  readonly id: ActiveEffectId;
  readonly type: "prevent-status";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly statusId: StatusId;
  readonly duration: ActiveActionLockEffect["duration"];
}

/** A duration-bound prohibition on a combat result earned by its target. */
export interface ActiveCombatResultPreventionEffect {
  readonly id: ActiveEffectId;
  readonly type: "prevent-combat-result";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly result: "critical" | "counter" | "sever";
  readonly selector?: MoveSelectorCondition;
  readonly duration: ActiveActionLockEffect["duration"];
}

/** Prevents matching attack or defense roll modifiers while its duration remains active. */
export interface ActiveRollModificationPreventionEffect {
  readonly id: ActiveEffectId;
  readonly type: "prevent-roll-modification";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly roll: "attack" | "defense";
  readonly modifier: "result" | "sides" | "any";
  readonly selector?: MoveSelectorCondition;
  readonly duration: ActiveActionLockEffect["duration"];
}

/** A combat-local CONSTANT Skill that has been explicitly activated by its owner. */
export interface ActiveConstantEffect {
  readonly id: ActiveEffectId;
  readonly type: "active-constant";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly activatedOnTurn: number;
  readonly duration: "combat";
  /** Omitted legacy values are active; deactivation remains durable for reactivation effects. */
  readonly lifecycle?: "active" | "deactivated";
  readonly deactivatedOnTurn?: number;
}

export type ActiveCombatEffect =
  | ActiveCostModifierEffect
  | ActiveRollModifierEffect
  | ActiveNextActionModifierEffect
  | ActiveItemDamageModifierEffect
  | ActiveForcedActionEffect
  | ActiveActionLockEffect
  | ActiveMoveUsePreventionEffect
  | ActiveStatusPreventionEffect
  | ActiveCombatResultPreventionEffect
  | ActiveRollModificationPreventionEffect
  | ActiveConstantEffect;

/**
 * A completed player action, retained as minimal rule-relevant history rather
 * than reconstructed from display-oriented combat events.
 */
export type CombatActionRecord =
  | {
      readonly type: "activate-transformation" | "pass" | "power-up" | "surrender";
      readonly decisionId: CombatDecisionId;
      readonly actorId: CombatantId;
      readonly turnNumber: number;
      readonly phase: "action" | "counter";
    }
  | {
      readonly type: "basic-attack";
      readonly decisionId: CombatDecisionId;
      readonly actorId: CombatantId;
      readonly targetCombatantId: CombatantId;
      readonly basicAttack: BasicAttackType;
      readonly turnNumber: number;
      readonly phase: "action" | "counter";
    }
  | {
      readonly type: "use-move";
      readonly decisionId: CombatDecisionId;
      readonly actorId: CombatantId;
      readonly targetCombatantId: CombatantId;
      readonly moveId: MoveId;
      readonly turnNumber: number;
      readonly phase: "action" | "counter";
    }
  | {
      readonly type: "use-item";
      readonly decisionId: CombatDecisionId;
      readonly actorId: CombatantId;
      readonly itemId: ItemId;
      readonly turnNumber: number;
      readonly phase: "action" | "counter";
    };

/**
 * Serializable suspended work. Concrete stages are intentionally narrow and
 * will be widened only by the attack, counter, and effect-resolution slices.
 */
export type ResolutionFrame =
  | {
      readonly id: ResolutionFrameId;
      readonly type: "attack";
      readonly decisionId: CombatDecisionId;
      readonly attackerId: CombatantId;
      readonly targetCombatantId: CombatantId;
      readonly returnPhase: "action" | "counter";
      readonly stage: "awaiting-counter";
    }
  | {
      readonly id: ResolutionFrameId;
      readonly type: "attack";
      readonly decisionId: CombatDecisionId;
      readonly attackerId: CombatantId;
      readonly targetCombatantId: CombatantId;
      readonly returnPhase: "action" | "counter";
      readonly stage: "awaiting-defense";
      readonly pendingDecisionId: PendingDecisionId;
      readonly attack:
        | { readonly type: "basic-attack"; readonly basicAttack: BasicAttackType }
        | { readonly type: "move"; readonly moveId: MoveId };
    }
  | {
      readonly id: ResolutionFrameId;
      readonly type: "attack";
      readonly decisionId: CombatDecisionId;
      readonly attackerId: CombatantId;
      readonly targetCombatantId: CombatantId;
      readonly returnPhase: "action" | "counter";
      readonly stage: "awaiting-post-defense-reaction";
      readonly pendingDecisionId: PendingDecisionId;
      /** The participant who must select the currently offered after-roll reaction. */
      readonly reactionCombatantId: CombatantId;
      readonly attack:
        | { readonly type: "basic-attack"; readonly basicAttack: BasicAttackType }
        | { readonly type: "move"; readonly moveId: MoveId };
      /** All rolled dice are persisted before an after-roll reaction can modify resolution. */
      readonly naturalRolls: readonly { readonly attack: number; readonly defense: number }[];
      /** Declarative after-defense effects resolved from the persisted roll results. */
      readonly resultOverrides: readonly ("stopped" | "successful" | undefined)[];
      /** Numeric substitutions established before the contest, retained for deterministic replay. */
      readonly numericResultOverrides: readonly (
        { readonly attack?: number; readonly defense?: number } | undefined
      )[];
    }
  | {
      readonly id: ResolutionFrameId;
      readonly type: "effect";
      readonly sourceCombatantId: CombatantId;
      readonly targetCombatantId: CombatantId;
      readonly sourceDefinitionId: string;
      readonly effectIndex: number;
      readonly returnPhase: CombatPhase;
      readonly trigger: "upkeep" | "action" | "end" | "on-success" | "on-stopped";
      readonly pendingDecisionId?: PendingDecisionId;
      readonly eligibleMoveIds?: readonly MoveId[];
      readonly remainingSelections?: number;
      /** Whether this serialized selection may be declined by its acting combatant. */
      readonly optional?: boolean;
    };

interface FightStateBase {
  readonly id: FightId;
  readonly version: number;
  readonly rulesVersion: RulesVersion;
  readonly mode: CombatMode;
  readonly turnNumber: number;
  readonly combatants: Readonly<Record<CombatantId, CombatantState>>;
  readonly activeEffects: readonly ActiveCombatEffect[];
  readonly actionHistory: readonly CombatActionRecord[];
  readonly resolutionFrames: readonly ResolutionFrame[];
  readonly eventSequence: number;
}

export interface ActiveFightState extends FightStateBase {
  readonly status: "active";
  readonly phase: CombatPhase;
  readonly activeCombatantId: CombatantId;
  readonly pendingDecision?: PendingDecision;
}

export interface CompletedFightState extends FightStateBase {
  readonly status: "completed";
  readonly completion: {
    readonly type: "cancelled" | "defeat" | "surrender";
    readonly winnerCombatantId?: CombatantId;
  };
}

export type FightState = ActiveFightState | CompletedFightState;

export interface FightStateInvariantViolation {
  readonly type:
    | "invalid-active-combatant"
    | "invalid-active-effect"
    | "invalid-action-history"
    | "invalid-combatant-count"
    | "invalid-combatant-identity"
    | "invalid-combatant-state"
    | "invalid-completion"
    | "invalid-resolution-frame"
    | "invalid-pending-decision"
    | "invalid-resource"
    | "invalid-rules-version"
    | "invalid-state-counter"
    | "invalid-stat"
    | "invalid-status"
    | "invalid-transformation"
    | "invalid-use-count";
  readonly message: string;
  readonly subject?: string;
}

export interface PassDecision {
  readonly type: "pass";
  readonly id: CombatDecisionId;
  readonly actorId: CombatantId;
  readonly expectedStateVersion: number;
}

export interface PowerUpDecision {
  readonly type: "power-up";
  readonly id: CombatDecisionId;
  readonly actorId: CombatantId;
  readonly expectedStateVersion: number;
}

export interface SurrenderDecision {
  readonly type: "surrender";
  readonly id: CombatDecisionId;
  readonly actorId: CombatantId;
  readonly expectedStateVersion: number;
}

/** Authorization for moderator cancellation belongs to the calling application. */
export interface CancelFightDecision {
  readonly type: "cancel-fight";
  readonly id: CombatDecisionId;
  readonly expectedStateVersion: number;
}

export type BasicAttackType = "basic-punch" | "basic-kick" | "basic-ki-blast";

export interface BasicAttackDecision {
  readonly type: "basic-attack";
  readonly id: CombatDecisionId;
  readonly actorId: CombatantId;
  readonly expectedStateVersion: number;
  readonly basicAttack: BasicAttackType;
  readonly targetCombatantId: CombatantId;
}

export interface UseMoveDecision {
  readonly type: "use-move";
  readonly id: CombatDecisionId;
  readonly actorId: CombatantId;
  readonly expectedStateVersion: number;
  readonly moveId: MoveId;
  readonly targetCombatantId: CombatantId;
}

export interface ActivateTransformationDecision {
  readonly type: "activate-transformation";
  readonly id: CombatDecisionId;
  readonly actorId: CombatantId;
  readonly expectedStateVersion: number;
  readonly transformationId: TransformationId;
}

export interface UseItemDecision {
  readonly type: "use-item";
  readonly id: CombatDecisionId;
  readonly actorId: CombatantId;
  readonly expectedStateVersion: number;
  readonly itemId: ItemId;
}

export interface RespondToPendingDecision {
  readonly type: "respond-to-pending-decision";
  readonly id: CombatDecisionId;
  readonly actorId: CombatantId;
  readonly expectedStateVersion: number;
  readonly pendingDecisionId: PendingDecisionId;
  readonly optionId: string;
}

export type CombatDecision =
  | PassDecision
  | PowerUpDecision
  | SurrenderDecision
  | CancelFightDecision
  | BasicAttackDecision
  | UseMoveDecision
  | ActivateTransformationDecision
  | UseItemDecision
  | RespondToPendingDecision;

export type LegalDecision =
  | {
      readonly type: "pass";
      readonly actorId: CombatantId;
    }
  | {
      readonly type: "power-up";
      readonly actorId: CombatantId;
    }
  | {
      readonly type: "surrender";
      readonly actorId: CombatantId;
    }
  | {
      readonly type: "basic-attack";
      readonly actorId: CombatantId;
      readonly basicAttack: BasicAttackType;
      readonly targetCombatantId: CombatantId;
    }
  | {
      readonly type: "use-move";
      readonly actorId: CombatantId;
      readonly moveId: MoveId;
      readonly targetCombatantId: CombatantId;
    }
  | {
      readonly type: "activate-transformation";
      readonly actorId: CombatantId;
      readonly transformationId: TransformationId;
    }
  | {
      readonly type: "use-item";
      readonly actorId: CombatantId;
      readonly itemId: ItemId;
    }
  | {
      readonly type: "respond-to-pending-decision";
      readonly actorId: CombatantId;
      readonly pendingDecisionId: PendingDecisionId;
      readonly optionId: string;
    };

export interface CombatEventBase {
  readonly id: CombatEventId;
  readonly sequence: number;
  readonly fightId: FightId;
  readonly causedByDecisionId?: CombatDecisionId;
  readonly causedByEffectId?: ActiveEffectId;
  readonly sourceDefinitionId?: string;
}

export interface FightStartedEvent extends CombatEventBase {
  readonly type: "fight-started";
  readonly mode: CombatMode;
}

export interface TurnStartedEvent extends CombatEventBase {
  readonly type: "turn-started";
  readonly combatantId: CombatantId;
  readonly turnNumber: number;
}

export interface InitiativeRolledEvent extends CombatEventBase {
  readonly type: "initiative-rolled";
  readonly combatantId: CombatantId;
  readonly naturalResult?: number;
  readonly result: number;
}

export interface PhaseChangedEvent extends CombatEventBase {
  readonly type: "phase-changed";
  readonly phase: CombatPhase;
}

export interface MoveUsedEvent extends CombatEventBase {
  readonly type: "move-used";
  readonly combatantId: CombatantId;
  readonly moveId: MoveId;
  readonly targetCombatantId: CombatantId;
}

export interface ItemUsedEvent extends CombatEventBase {
  readonly type: "item-used";
  readonly combatantId: CombatantId;
  readonly itemId: ItemId;
}

export interface AttackRolledEvent extends CombatEventBase {
  readonly type: "attack-rolled";
  readonly combatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly basicAttack?: BasicAttackType;
  readonly moveId?: MoveId;
  readonly naturalResult: number;
  readonly result: number;
}

export interface DefenseRolledEvent extends CombatEventBase {
  readonly type: "defense-rolled";
  readonly combatantId: CombatantId;
  readonly sourceCombatantId: CombatantId;
  readonly naturalResult: number;
  readonly result: number;
}

export interface DefenseRequestedEvent extends CombatEventBase {
  readonly type: "defense-requested";
  readonly attackerCombatantId: CombatantId;
  readonly defenderCombatantId: CombatantId;
  readonly pendingDecisionId: PendingDecisionId;
}

export interface AttackResolvedEvent extends CombatEventBase {
  readonly type: "attack-resolved";
  readonly combatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly basicAttack?: BasicAttackType;
  readonly moveId?: MoveId;
  readonly outcome: "successful" | "stopped";
  /** Whether the natural attack roll qualified for the shared critical rule. */
  readonly critical: boolean;
  /** Whether the stopped defense qualified to hand off to the Counter phase. */
  readonly counter: boolean;
}

export interface EffectActivatedEvent extends CombatEventBase {
  readonly type: "effect-activated";
  readonly activeEffectId: ActiveEffectId;
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
}

export interface EffectExpiredEvent extends CombatEventBase {
  readonly type: "effect-expired";
  readonly activeEffectId: ActiveEffectId;
  readonly targetCombatantId: CombatantId;
}

/** A CONSTANT Skill was explicitly removed from the active combat effects. */
export interface EffectDeactivatedEvent extends CombatEventBase {
  readonly type: "effect-deactivated";
  readonly activeEffectId: ActiveEffectId;
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
}

/** A mandatory duration check, retained so turn-start randomness is replayable. */
export interface EffectRolledEvent extends CombatEventBase {
  readonly type: "effect-rolled";
  readonly activeEffectId: ActiveEffectId;
  readonly combatantId: CombatantId;
  readonly naturalResult: number;
  readonly result: number;
}

export interface StatusAppliedEvent extends CombatEventBase {
  readonly type: "status-applied";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly statusId: StatusId;
  readonly stacks: number;
}

export interface StatusRemovedEvent extends CombatEventBase {
  readonly type: "status-removed";
  readonly targetCombatantId: CombatantId;
  readonly statusId: StatusId;
}

export interface TransformationActivatedEvent extends CombatEventBase {
  readonly type: "transformation-activated";
  readonly combatantId: CombatantId;
  readonly transformationId: TransformationId;
}

export interface TransformationDeactivatedEvent extends CombatEventBase {
  readonly type: "transformation-deactivated";
  readonly combatantId: CombatantId;
  readonly transformationId: TransformationId;
}

export interface KiChangedEvent extends CombatEventBase {
  readonly type: "ki-changed";
  readonly combatantId: CombatantId;
  readonly amount: number;
  readonly remainingKi: number;
}

export interface DamageAppliedEvent extends CombatEventBase {
  readonly type: "damage-applied";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly amount: number;
  readonly remainingHitPoints: number;
}

export interface CombatantDefeatedEvent extends CombatEventBase {
  readonly type: "combatant-defeated";
  readonly combatantId: CombatantId;
}

export interface ActionSkippedEvent extends CombatEventBase {
  readonly type: "action-skipped";
  readonly combatantId: CombatantId;
  readonly reason: "status" | "effect";
}

export interface CounterChainLimitReachedEvent extends CombatEventBase {
  readonly type: "counter-chain-limit-reached";
  readonly counterAttackCount: number;
}

export interface CombatantSurrenderedEvent extends CombatEventBase {
  readonly type: "combatant-surrendered";
  readonly combatantId: CombatantId;
}

export interface FightEndedEvent extends CombatEventBase {
  readonly type: "fight-ended";
  readonly completion: CompletedFightState["completion"];
}

export type CombatEvent =
  | FightStartedEvent
  | TurnStartedEvent
  | InitiativeRolledEvent
  | PhaseChangedEvent
  | MoveUsedEvent
  | ItemUsedEvent
  | AttackRolledEvent
  | DefenseRolledEvent
  | DefenseRequestedEvent
  | AttackResolvedEvent
  | EffectActivatedEvent
  | EffectExpiredEvent
  | EffectDeactivatedEvent
  | EffectRolledEvent
  | StatusAppliedEvent
  | StatusRemovedEvent
  | TransformationActivatedEvent
  | TransformationDeactivatedEvent
  | KiChangedEvent
  | DamageAppliedEvent
  | CombatantDefeatedEvent
  | ActionSkippedEvent
  | CounterChainLimitReachedEvent
  | CombatantSurrenderedEvent
  | FightEndedEvent;

export interface CombatTransition {
  readonly state: FightState;
  readonly events: readonly CombatEvent[];
  readonly pendingDecision?: PendingDecision;
}

export type CombatFailure =
  | {
      readonly type: "invalid-fight-setup";
      readonly issues: readonly FightSetupIssue[];
    }
  | {
      readonly type: "invalid-fight-state";
      readonly violations: readonly FightStateInvariantViolation[];
    }
  | {
      readonly type: "stale-decision";
      readonly expectedVersion: number;
      readonly actualVersion: number;
    }
  | {
      readonly type: "wrong-phase";
      readonly expected: readonly CombatPhase[];
      readonly actual: CombatPhase | "completed";
    }
  | {
      readonly type: "not-active-combatant";
      readonly combatantId: CombatantId;
      readonly activeCombatantId?: CombatantId;
    }
  | {
      readonly type: "invalid-target";
      readonly targetCombatantId: CombatantId;
    }
  | {
      readonly type: "insufficient-ki";
      readonly required: number;
      readonly available: number;
    }
  | {
      readonly type: "unknown-move";
      readonly moveId: MoveId;
    }
  | {
      readonly type: "move-not-owned";
      readonly moveId: MoveId;
      readonly combatantId: CombatantId;
    }
  | {
      readonly type: "unknown-item";
      readonly itemId: ItemId;
    }
  | {
      readonly type: "item-not-owned";
      readonly itemId: ItemId;
      readonly combatantId: CombatantId;
    }
  | {
      readonly type: "item-use-exhausted";
      readonly itemId: ItemId;
    }
  | {
      readonly type: "move-locked";
      readonly moveId: MoveId;
    }
  | {
      readonly type: "restricted-use-exhausted";
      readonly moveId: MoveId;
    }
  | {
      readonly type: "signature-turn-requirement";
      readonly moveId: MoveId;
      readonly minimumTurn: number;
      readonly currentTurn: number;
    }
  | {
      readonly type: "block-limit-reached";
      readonly combatantId: CombatantId;
    }
  | {
      readonly type: "action-skipped";
      readonly combatantId: CombatantId;
    }
  | {
      readonly type: "no-pending-decision";
      readonly pendingDecisionId: PendingDecisionId;
    }
  | {
      readonly type: "invalid-pending-decision-option";
      readonly pendingDecisionId: PendingDecisionId;
      readonly optionId: string;
    }
  | {
      readonly type: "unsupported-mechanic";
      readonly mechanic: string;
    }
  | {
      readonly type: "illegal-decision";
      readonly decisionType: CombatDecision["type"];
    };

export type CombatResult<TSuccess> =
  | { readonly ok: true; readonly value: TSuccess }
  | { readonly ok: false; readonly error: CombatFailure };
